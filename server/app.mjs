import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { parseMessage, ProtocolError } from './protocol.mjs';
import { createPeer } from './peer.mjs';
import { loadEngine } from './engine.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/gpu.mjs', ['gpu.mjs', 'text/javascript; charset=utf-8']],
  ['/dist/client.mjs', ['dist/client.mjs', 'text/javascript; charset=utf-8']],
  ['/dist/client.wasm', ['dist/client.wasm', 'application/wasm']],
]);

export async function createApp({ engineFactory, root = fileURLToPath(new URL('../web/', import.meta.url)), autoTick = true, now = () => performance.now(), onError = code => console.error(code) } = {}) {
  const engineLabel = engineFactory === undefined ? 'C++/Wasm' : 'injected';
  if (engineFactory === undefined) engineFactory = await loadEngine();
  if (typeof engineFactory !== 'function') throw new Error('Engine factory required');
  const rooms = new Map();
  const clients = new Set();
  let closing = false;
  let closePromise;
  const stats = () => ({ rooms: rooms.size, clients: clients.size });
  function validHost(req) {
    const host = req.headers.host;
    if (typeof host !== 'string' || /[\s/@\\\\#?]/u.test(host)) return false;
    if (req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host').length !== 1) return false;
    const address = server.address();
    if (!address || typeof address === 'string') return false;
    const hostname = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    const allowed = new Set([`${hostname}:${address.port}`]);
    if (address.address === '127.0.0.1' || address.address === '::1') allowed.add(`localhost:${address.port}`);
    return allowed.has(host);
  }
  async function handleHttp(req, res) {
    if (!validHost(req)) { res.writeHead(403); res.end(); return; }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, engine: engineLabel, ...stats(), tickRate: 60 }));
      return;
    }
    const asset = assets.get(req.url);
    if (!asset) { res.writeHead(404); res.end(); return; }
    const base = await realpath(root);
    const file = await realpath(resolve(base, asset[0]));
    const path = relative(base, file);
    if (path.startsWith('..') || isAbsolute(path)) { res.writeHead(404); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(body);
  }
  const server = createServer((req, res) => {
    handleHttp(req, res).catch(error => {
      const status = ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500;
      if (status === 500) onError('http_error');
      res.writeHead(status); res.end();
    });
  });
  const engineFailure = Symbol('engine failure');
  function failClient(client) {
    if (client.closing) return;
    client.closing = true;
    client.peer.clearState();
    client.peer.control({ type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error.' });
    client.peer.end(1011, 'Internal server error.');
  }
  function failRoom(room) {
    rooms.delete(room.code);
    for (const client of clients) if (client.room === room) {
      client.room = null; client.id = null; client.seq = -1;
      failClient(client);
    }
    if (!room.destroyed) {
      room.destroyed = true;
      try { room.engine.destroy(); } catch { onError('engine_destroy_error'); }
    }
  }
  function engineCall(room, method, ...args) {
    try {
      if (method === 'destroy') room.destroyed = true;
      return room.engine[method](...args);
    } catch { onError('engine_error'); failRoom(room); throw engineFailure; }
  }
  function leave(client) {
    client.peer.clearState();
    const room = client.room;
    if (!room) return;
    engineCall(room, 'leave', client.id);
    delete room.names[client.id];
    client.room = null;
    client.id = null;
    client.seq = -1;
    client.idleDeadline = now() + 10000;
    if (!Object.keys(room.names).length) { rooms.delete(room.code); engineCall(room, 'destroy'); }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const status = req.url !== '/ws' ? 404 : (!validHost(req) || req.headers.origin !== `http://${req.headers.host}`) ? 403 : (closing || clients.size >= 64) ? 503 : 0;
    if (status) { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  function consume(bucket, rate) {
    const time = now();
    bucket.tokens = Math.min(rate, bucket.tokens + Math.max(0, time - bucket.at) * rate / 1000);
    bucket.at = time;
    if (bucket.tokens < 1) throw new ProtocolError('RATE_LIMIT');
    bucket.tokens--;
  }
  wss.on('connection', ws => {
    const client = { ws, room: null, id: null, seq: -1, idleDeadline: now() + 10000, heartbeatAt: now() + 30000, alive: true,
      messageBucket: { tokens: 120, at: now() }, inputBucket: { tokens: 60, at: now() }, closing: false };
    client.peer = createPeer(ws, { now });
    ws.on('pong', () => { client.alive = true; });
    ws.on('error', error => {
      if (!String(error.code).startsWith('WS_ERR_')) console.error('socket_error');
      ws.terminate();
    });
    clients.add(client);
    ws.on('message', (data, isBinary) => {
      if (client.closing) return;
      try {
      let message;
      try {
        message = parseMessage(data, isBinary);
        consume(client.messageBucket, 120);
        if (message.type === 'input') consume(client.inputBucket, 60);
        if (client.room && (message.type === 'create' || message.type === 'join')) throw new ProtocolError('INVALID_MESSAGE');
      }
      catch (error) {
        if (!(error instanceof ProtocolError)) throw error;
        client.closing = true;
        client.peer.control({ type: 'error', code: error.code, message: error.message });
        client.peer.end(1008, error.message);
        return;
      }
      if (message.type === 'ping') {
        client.peer.control({ type: 'pong', stamp: message.stamp });
        return;
      }
      if (message.type === 'leave') {
        leave(client);
        client.peer.control({ type: 'left' });
        return;
      }
      if (message.type === 'input') {
        if (client.room && message.seq > client.seq) {
          engineCall(client.room, 'input', client.id, message);
          client.seq = message.seq;
        }
        return;
      }
      if (message.type === 'create' || message.type === 'join') {
        let room;
        if (message.type === 'create') {
          if (rooms.size >= 16) { client.peer.control({ type: 'error', code: 'SERVER_FULL', message: 'Server is full.' }); return; }
          let code;
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          let engine;
          try { engine = engineFactory(); }
          catch {
            onError('engine_error');
            client.closing = true;
            client.peer.control({ type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error.' });
            client.peer.end(1011, 'Internal server error.');
            return;
          }
          room = { code, engine, names: {}, accumulator: 0, lastTick: now(), steps: 0 };
          rooms.set(code, room);
        } else room = rooms.get(message.code);
        if (!room) { client.peer.control({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found.' }); return; }
        const id = engineCall(room, 'join');
        if (id < 0) { client.peer.control({ type: 'error', code: 'ROOM_FULL', message: 'Room is full.' }); return; }
        room.names[id] = message.name.trim();
        client.room = room;
        client.id = id;
        client.peer.control({ type: 'welcome', room: room.code, id, names: room.names });
        client.peer.state({ type: 'state', room: room.code, names: room.names, ...engineCall(room, 'snapshot') });
      }
      } catch (error) {
        if (error !== engineFailure) { onError('engine_error'); if (client.room) failRoom(client.room); }
        failClient(client);
      }
    });
    ws.on('close', () => {
      clients.delete(client);
      try { leave(client); } catch (error) { if (error !== engineFailure) onError('engine_error'); }
      client.peer.dispose();
    });
  });
  function tick() {
    const time = now();
    for (const client of clients) {
      client.peer.poll();
      if (client.ws.readyState !== 1) continue;
      if (!client.room && time >= client.idleDeadline) { client.ws.close(1008, 'Handshake timeout.'); continue; }
      if (time >= client.heartbeatAt) {
        if (!client.alive) { client.ws.terminate(); continue; }
        client.alive = false;
        client.heartbeatAt = time + 30000;
        client.ws.ping();
      }
    }
    for (const room of rooms.values()) {
      try {
      room.accumulator += Math.min(250, Math.max(0, time - room.lastTick));
      room.lastTick = time;
      let publish = false;
      while (room.accumulator + 1e-6 >= 1000 / 60) {
        engineCall(room, 'tick', 1 / 60);
        room.accumulator -= 1000 / 60;
        if (++room.steps % 3 === 0) publish = true;
      }
      if (publish) {
        const state = { type: 'state', room: room.code, names: room.names, ...engineCall(room, 'snapshot') };
        for (const client of clients) if (client.room === room) client.peer.state(state);
      }
      } catch (error) { if (error !== engineFailure) { onError('engine_error'); failRoom(room); } }
    }
  }
  const timer = autoTick ? setInterval(tick, 1000 / 60) : null;
  timer?.unref();
  return {
    server, wss, stats, tick,
    listen(host = '127.0.0.1', port = 8088) {
      if (closing) return Promise.reject(new Error('App closed'));
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      clearInterval(timer);
      for (const client of clients) {
        client.closing = true;
        client.peer.dispose();
        try { leave(client); } catch (error) { if (error !== engineFailure) onError('engine_error'); }
        client.ws.close(1001, 'Server shutdown.');
      }
      const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); server.closeAllConnections(); }, 500);
      force.unref();
      const httpClosed = new Promise((resolve, reject) => {
        if (!server.listening) { resolve(); return; }
        server.close(error => error ? reject(error) : resolve());
      });
      const wsClosed = new Promise((resolve, reject) => wss.close(error => error ? reject(error) : resolve()));
      closePromise = Promise.all([httpClosed, wsClosed]).then(() => undefined).finally(() => clearTimeout(force));
      return closePromise;
    },
  };
}
