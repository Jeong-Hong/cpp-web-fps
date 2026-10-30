// Transport evidence only: injected fake room, not C++ gameplay evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

function http(origin, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin, { path, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

const moduleUrl = new URL('../server/app.mjs', import.meta.url);
const env = { ...process.env, TMP: 'D:/Tools/Hermes/profiles/omh/cache/scratch', TEMP: 'D:/Tools/Hermes/profiles/omh/cache/scratch', TMPDIR: 'D:/Tools/Hermes/profiles/omh/cache/scratch' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeFactory() {
  const rooms = [];
  function factory() {
    const ids = new Set();
    const room = {
      inputs: [], ticks: [], destroyed: false,
      join() { for (let id = 0; id < 4; id++) if (!ids.has(id)) { ids.add(id); return id; } return -1; },
      leave(id) { ids.delete(id); },
      input(id, input) { room.inputs.push({ id, ...input }); return true; },
      tick(dt) { room.ticks.push(dt); },
      snapshot() { return { time: room.ticks.length * 1000 / 60, players: [...ids].map(id => ({ id, hp: 100, ack: -1 })) }; },
      destroy() { room.destroyed = true; ids.clear(); },
    };
    rooms.push(room);
    return room;
  }
  factory.rooms = rooms;
  return factory;
}

async function fixture(options = {}) {
  const { createApp } = await import(moduleUrl);
  const engineFactory = Object.hasOwn(options, 'engineFactory') ? options.engineFactory : fakeFactory();
  const app = await createApp({ engineFactory, autoTick: false, ...options });
  const address = await app.listen('127.0.0.1', 0);
  const origin = `http://127.0.0.1:${address.port}`;
  const clients = [];
  async function connect(extra = {}) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { origin, ...extra });
    const inbox = [], waiters = [];
    ws.on('message', data => { const value = JSON.parse(String(data)); const waiter = waiters.shift(); if (waiter) waiter(value); else inbox.push(value); });
    const closed = new Promise(resolve => ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
    ws.on('error', () => {}); // Observed by open rejection/close assertions; no unhandled test event.
    clients.push(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return {
      ws, closed, inbox,
      send(value) { ws.send(typeof value === 'string' ? value : JSON.stringify(value)); },
      next() {
        if (inbox.length) return Promise.resolve(inbox.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { const at = waiters.indexOf(onValue); if (at >= 0) waiters.splice(at, 1); reject(new Error('message timeout')); }, 1500);
          function onValue(value) { clearTimeout(timer); resolve(value); }
          waiters.push(onValue);
        });
      },
    };
  }
  return { app, engineFactory, origin, connect, async close() { for (const ws of clients) ws.terminate(); await app.close(); } };
}

async function create(client, name = 'tester') {
  client.send({ type: 'create', name });
  const welcome = await client.next();
  assert.equal(welcome.type, 'welcome');
  const state = await client.next();
  assert.equal(state.type, 'state');
  return welcome;
}

const input = (seq = 0, extra = {}) => ({ type: 'input', seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, fire: false, reload: false, sprint: false, ...extra });

const invalidMessages = [
  ['unknown field / spoofed id', { type: 'create', name: 'a', id: 0 }, 'INVALID_MESSAGE'],
  ['array', [], 'INVALID_MESSAGE'],
  ['array message type', { type: ['create'], name: 'a' }, 'INVALID_MESSAGE'],
  ['object message type', { type: {}, name: 'a' }, 'INVALID_MESSAGE'],
  ['null', null, 'INVALID_MESSAGE'],
  ['invalid JSON', '{broken', 'INVALID_MESSAGE'],
  ['unknown type', { type: 'state' }, 'INVALID_MESSAGE'],
  ['missing field', { type: 'create' }, 'INVALID_MESSAGE'],
  ['empty name', { type: 'create', name: '   ' }, 'INVALID_NAME'],
  ['long scalar name', { type: 'create', name: '😀'.repeat(17) }, 'INVALID_NAME'],
  ['non-string name', { type: 'create', name: 123 }, 'INVALID_NAME'],
  ['unpaired high surrogate', { type: 'create', name: '\ud800' }, 'INVALID_NAME'],
  ['unpaired low surrogate', { type: 'create', name: '\udfff' }, 'INVALID_NAME'],
  ['C0 newline name', { type: 'create', name: 'a\n' }, 'INVALID_NAME'],
  ['C1 name', { type: 'create', name: '\u0085a' }, 'INVALID_NAME'],
  ['DEL name', { type: 'create', name: '\u007f' }, 'INVALID_NAME'],
  ['lowercase code', { type: 'join', name: 'a', code: 'abcdef' }, 'INVALID_CODE'],
  ['whitespace code', { type: 'join', name: 'a', code: ' ABCDEF' }, 'INVALID_CODE'],
  ['non-string code', { type: 'join', name: 'a', code: 123456 }, 'INVALID_CODE'],
  ['huge finite magnitude', input(0, { yaw: 1e100 }), 'INVALID_MESSAGE'],
  ['nonfinite JSON magnitude', JSON.stringify(input()).replace('"yaw":0', '"yaw":1e400'), 'INVALID_MESSAGE'],
  ['numeric string', input(0, { forward: '1' }), 'INVALID_MESSAGE'],
  ['flag not boolean', input(0, { fire: 1 }), 'INVALID_MESSAGE'],
  ['fractional sequence', input(1.5), 'INVALID_MESSAGE'],
  ['large sequence', input(2147483648), 'INVALID_MESSAGE'],
  ['negative sequence', input(-1), 'INVALID_MESSAGE'],
  ['yaw outside bounds', input(0, { yaw: Math.PI + 0.00001 }), 'INVALID_MESSAGE'],
  ['pitch outside bounds', input(0, { pitch: -1.450001 }), 'INVALID_MESSAGE'],
  ['strafe outside bounds', input(0, { strafe: -1.001 }), 'INVALID_MESSAGE'],
  ['unsafe ping', { type: 'ping', stamp: 9007199254740992 }, 'INVALID_MESSAGE'],
];
for (const [label, value, code] of invalidMessages) {
  test(`strict protocol rejects ${label} without entering engine`, async () => {
    const f = await fixture();
    try {
      const client = await f.connect();
      client.send(value);
      const error = await client.next();
      assert.equal(error.type, 'error');
      assert.equal(error.code, code);
      assert.deepEqual(Object.keys(error).sort(), ['code', 'message', 'type']);
      assert.equal((await client.closed).code, 1008);
      assert.equal(f.engineFactory.rooms.length, 0);
    } finally { await f.close(); }
  });
}

// Vertical 2: a reliable ping is also a causal barrier for following socket assertions.
test('ping echoes only the allowed safe integer in idle and active states', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    client.send({ type: 'ping', stamp: Number.MIN_SAFE_INTEGER });
    assert.deepEqual(await client.next(), { type: 'pong', stamp: Number.MIN_SAFE_INTEGER });
    await create(client, '😀'.repeat(16));
    client.send({ type: 'ping', stamp: Number.MAX_SAFE_INTEGER });
    assert.deepEqual(await client.next(), { type: 'pong', stamp: Number.MAX_SAFE_INTEGER });
  } finally { await f.close(); }
});

test('validated inputs reach only the socket slot; duplicate and old sequence are ignored', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    await create(client);
    const first = input(0, { forward: -1, strafe: 1, yaw: -Math.PI, pitch: -1.45, fire: true, reload: true, sprint: true });
    const last = input(2147483647, { yaw: Math.PI, pitch: 1.45 });
    client.send(first); client.send(input(0)); client.send(last); client.send(input(1));
    client.send({ type: 'ping', stamp: 1 });
    assert.equal((await client.next()).type, 'pong');
    assert.deepEqual(f.engineFactory.rooms[0].inputs, [{ id: 0, ...first }, { id: 0, ...last }]);
  } finally { await f.close(); }
});

test('leave clears identity and sequence; valid idle input is ignored; empty room is destroyed', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    await create(client);
    client.send(input(9));
    client.send({ type: 'leave' });
    assert.deepEqual(await client.next(), { type: 'left' });
    assert.equal(f.engineFactory.rooms[0].destroyed, true);
    assert.deepEqual(f.app.stats(), { rooms: 0, clients: 1 });
    client.send(input(10));
    client.send({ type: 'ping', stamp: 1 });
    await client.next();
    assert.equal(f.engineFactory.rooms[0].inputs.length, 1);
    await create(client, 'new');
    client.send(input(0));
    client.send({ type: 'ping', stamp: 2 });
    assert.equal((await client.next()).stamp, 2);
    assert.equal(f.engineFactory.rooms[1].inputs[0].seq, 0);
    const serverSocket = [...f.app.wss.clients][0];
    const closed = new Promise(resolve => serverSocket.once('close', resolve));
    client.ws.terminate();
    await closed;
    assert.deepEqual(f.app.stats(), { rooms: 0, clients: 0 });
    assert.equal(f.engineFactory.rooms[1].destroyed, true);
  } finally { await f.close(); }
});

test('active socket cannot create a second identity or leak its previous room', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    await create(client);
    client.send({ type: 'create', name: 'again' });
    assert.deepEqual(await client.next(), { type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid message.' });
    assert.equal((await client.closed).code, 1008);
    assert.equal(f.engineFactory.rooms.length, 1);
  } finally { await f.close(); }
});

test('room limit is 16 and SERVER_FULL leaves socket idle for join retry', async () => {
  const f = await fixture();
  try {
    const welcomes = [];
    for (let i = 0; i < 16; i++) welcomes.push(await create(await f.connect(), `host${i}`));
    const extra = await f.connect();
    extra.send({ type: 'create', name: 'extra' });
    assert.deepEqual(await extra.next(), { type: 'error', code: 'SERVER_FULL', message: 'Server is full.' });
    assert.equal(f.engineFactory.rooms.length, 16);
    extra.send({ type: 'join', name: 'retry', code: welcomes[0].room });
    assert.equal((await extra.next()).type, 'welcome');
    assert.equal((await extra.next()).players.length, 2);
    assert.deepEqual(f.app.stats(), { rooms: 16, clients: 17 });
  } finally { await f.close(); }
});

test('upgrades require exact same Origin and locally bound Host; route is exact', async () => {
  const f = await fixture();
  try {
    for (const origin of ['http://attacker.invalid', 'null', f.origin + '/', f.origin.replace('http:', 'https:')]) {
      await assert.rejects(f.connect({ origin }), /403/);
    }
    await assert.rejects(f.connect({ origin: undefined }), /403/);
    await assert.rejects(f.connect({ headers: { Host: 'attacker.invalid', Origin: 'http://attacker.invalid' } }), /403/);
    const client = await f.connect();
    client.send({ type: 'ping', stamp: 0 });
    assert.equal((await client.next()).type, 'pong');
    assert.equal((await http(f.origin, '/health', { headers: { Host: 'attacker.invalid' } })).status, 403);
    const wrongRoute = new WebSocket(f.origin.replace('http:', 'ws:') + '/ws?other', { origin: f.origin });
    await assert.rejects(new Promise((resolve, reject) => { wrongRoute.once('open', () => { wrongRoute.terminate(); resolve(); }); wrongRoute.once('error', reject); }), /404/);
  } finally { await f.close(); }
});

test('64 sockets is a hard transport limit and excess upgrade gets HTTP 503', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 64; i++) await f.connect();
    assert.deepEqual(f.app.stats(), { rooms: 0, clients: 64 });
    await assert.rejects(f.connect(), /503/);
    assert.equal(f.app.stats().clients, 64);
  } finally { await f.close(); }
});

test('static root serves only exact web assets with correct Wasm MIME and rejects traversal/methods', async () => {
  const root = await mkdtemp('D:/Tools/Hermes/profiles/omh/cache/scratch/fps-server-static-');
  let f;
  try {
    await mkdir(join(root, 'dist'));
    const assets = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.mjs': ['app.mjs', 'text/javascript'], '/gpu.mjs': ['gpu.mjs', 'text/javascript'], '/dist/client.mjs': ['dist/client.mjs', 'text/javascript'], '/dist/client.wasm': ['dist/client.wasm', 'application/wasm'] };
    for (const [file] of Object.values(assets)) await writeFile(join(root, file), `fixture:${file}`);
    await writeFile(join(root, 'secret.txt'), 'not public');
    f = await fixture({ root });
    for (const [path, [file, mime]] of Object.entries(assets)) {
      const response = await http(f.origin, path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers['content-type'], new RegExp(`^${mime}`));
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(String(response.body), `fixture:${file}`);
    }
    for (const path of ['/secret.txt', '/../package.json', '/%2e%2e/package.json', '/dist/../app.mjs', '/dist%2fclient.wasm', '/app.mjs?secret', '/.git/config', '/server/app.mjs', '/dist/client.wasm/']) {
      assert.equal((await http(f.origin, path)).status, 404, path);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await http(f.origin, '/health', { method });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.allow, 'GET');
    }
  } finally { if (f) await f.close(); await rm(root, { recursive: true, force: true }); }
});

test('server clock advances injected engine at 60 Hz and publishes full states at 20 Hz', async () => {
  let clock = 1000;
  const f = await fixture({ now: () => clock });
  try {
    const client = await f.connect();
    const welcome = await create(client);
    assert.equal(typeof f.app.tick, 'function');
    clock += 50;
    f.app.tick();
    const state = await client.next();
    assert.equal(state.room, welcome.room);
    assert.deepEqual(state.names, { 0: 'tester' });
    assert.equal(state.time, 50);
    assert.deepEqual(f.engineFactory.rooms[0].ticks, [1 / 60, 1 / 60, 1 / 60]);
    f.app.tick();
    assert.equal(f.engineFactory.rooms[0].ticks.length, 3);
    clock += 50;
    f.app.tick();
    assert.equal((await client.next()).time, 100);
  } finally { await f.close(); }
});

test('idle handshake expires at 10 seconds, including renewed idle after leave', async () => {
  let clock = 0;
  const f = await fixture({ now: () => clock });
  try {
    const client = await f.connect();
    clock = 9999; f.app.tick();
    assert.equal(client.ws.readyState, WebSocket.OPEN);
    clock = 10000; f.app.tick();
    const result = await Promise.race([client.closed, pause(200).then(() => { throw new Error('idle deadline not enforced'); })]);
    assert.equal(result.code, 1008);
    const renewed = await f.connect();
    await create(renewed);
    clock = 20000; f.app.tick();
    await renewed.next(); // state from active room; not an idle timeout.
    renewed.send({ type: 'leave' });
    assert.equal((await renewed.next()).type, 'left');
    clock = 29999; f.app.tick();
    assert.equal(renewed.ws.readyState, WebSocket.OPEN);
    clock = 30000; f.app.tick();
    assert.equal((await Promise.race([renewed.closed, pause(200).then(() => { throw new Error('renewed idle deadline not enforced'); })])).code, 1008);
  } finally { await f.close(); }
});

test('transport heartbeat pings at 30 seconds and removes non-pong peers without hurting healthy sockets', async () => {
  let clock = 0;
  const f = await fixture({ now: () => clock });
  try {
    const silent = await f.connect({ autoPong: false });
    await create(silent);
    const healthy = await f.connect();
    await create(healthy);
    const healthyServer = [...f.app.wss.clients][1];
    let pings = 0;
    silent.ws.on('ping', () => pings++);
    clock = 29999; f.app.tick();
    assert.equal(pings, 0);
    const pong = new Promise(resolve => healthyServer.once('pong', resolve));
    clock = 30000; f.app.tick();
    await Promise.race([pong, pause(200).then(() => { throw new Error('heartbeat missing'); })]);
    assert.equal(pings, 1);
    clock = 60000; f.app.tick();
    assert.equal((await Promise.race([silent.closed, pause(200).then(() => { throw new Error('heartbeat timeout missing'); })])).code, 1006);
    healthy.send({ type: 'ping', stamp: 42 });
    let message;
    do { message = await healthy.next(); } while (message.type === 'state');
    assert.deepEqual(message, { type: 'pong', stamp: 42 });
    assert.equal(f.engineFactory.rooms[0].destroyed, true);
    assert.equal(healthy.ws.readyState, WebSocket.OPEN);
  } finally { await f.close(); }
});

test('message token bucket allows 120 burst, refills by server time, then closes RATE_LIMIT', async () => {
  let clock = 0;
  const f = await fixture({ now: () => clock });
  try {
    const client = await f.connect();
    for (let i = 0; i < 120; i++) {
      client.send({ type: 'ping', stamp: i });
      assert.equal((await client.next()).stamp, i);
    }
    clock = 1000;
    client.send({ type: 'ping', stamp: 121 });
    assert.equal((await client.next()).stamp, 121);
    for (let i = 1; i < 120; i++) { client.send({ type: 'ping', stamp: i }); await client.next(); }
    client.send({ type: 'ping', stamp: 122 });
    assert.deepEqual(await client.next(), { type: 'error', code: 'RATE_LIMIT', message: 'Rate limit exceeded.' });
    assert.equal((await client.closed).code, 1008);
  } finally { await f.close(); }
});

test('input bucket limits 60 burst before Wasm including correctly shaped stale input', async () => {
  const f = await fixture({ now: () => 0 });
  try {
    const client = await f.connect();
    await create(client);
    for (let seq = 0; seq < 60; seq++) client.send(input(seq));
    client.send(input(0));
    assert.deepEqual(await client.next(), { type: 'error', code: 'RATE_LIMIT', message: 'Rate limit exceeded.' });
    assert.equal((await client.closed).code, 1008);
    assert.equal(f.engineFactory.rooms[0].inputs.length, 60);
  } finally { await f.close(); }
});

test('UTF-8 payload byte limit accepts 1024 and rejects 1025 with close 1009', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    const wire = JSON.stringify({ type: 'ping', stamp: 7 });
    client.send(wire.padEnd(1024, ' '));
    assert.deepEqual(await client.next(), { type: 'pong', stamp: 7 });
    client.send(wire.padEnd(1025, ' '));
    assert.equal((await Promise.race([client.closed, pause(200).then(() => { throw new Error('payload limit not enforced'); })])).code, 1009);
  } finally { await f.close(); }
});

test('blocked sender never stalls shared ticks or a healthy peer and holds one latest state', async () => {
  let clock = 0;
  const f = await fixture({ now: () => clock });
  try {
    const slow = await f.connect();
    await create(slow);
    const healthy = await f.connect();
    await create(healthy);
    const slowServer = [...f.app.wss.clients][0];
    const original = slowServer.send.bind(slowServer);
    const blocked = [];
    slowServer.send = (data, callback) => {
      const message = JSON.parse(data);
      if (message.type === 'state') blocked.push({ message, callback });
      else original(data, callback);
    };
    for (let i = 1; i <= 5; i++) {
      clock = i * 50;
      assert.equal(f.app.tick(), undefined);
      assert.equal((await healthy.next()).time, i * 50);
    }
    assert.equal(f.engineFactory.rooms[0].ticks.length, 15);
    assert.equal(blocked.length, 1);
    blocked[0].callback();
    assert.equal(blocked.length, 2);
    assert.equal(blocked[1].message.time, 250);
  } finally { await f.close(); }
});

test('shared tick reaps an expired blocked sender and cleans its room', async () => {
  let clock = 0;
  const f = await fixture({ now: () => clock });
  try {
    const slow = await f.connect();
    await create(slow);
    const slowServer = [...f.app.wss.clients][0];
    slowServer.send = () => {}; // Intentionally never completes a transport write.
    clock = 50; f.app.tick();
    clock = 10049; f.app.tick();
    assert.equal(slow.ws.readyState, WebSocket.OPEN);
    clock = 10050; f.app.tick();
    assert.equal((await Promise.race([slow.closed, pause(200).then(() => { throw new Error('blocked sender was not reaped'); })])).code, 1006);
    const response = await fetch(f.origin + '/health');
    assert.equal((await response.json()).rooms, 0);
    assert.equal(f.engineFactory.rooms[0].destroyed, true);
  } finally { await f.close(); }
});

test('engine creation failure becomes fixed 1011 response and observable sanitized diagnostic', async () => {
  const diagnostics = [];
  const f = await fixture({ engineFactory: () => { throw new Error('private engine detail'); }, onError: code => diagnostics.push(code) });
  try {
    const client = await f.connect();
    client.send({ type: 'create', name: 'not reflected' });
    assert.deepEqual(await client.next(), { type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error.' });
    assert.equal((await client.closed).code, 1011);
    assert.deepEqual(diagnostics, ['engine_error']);
    assert.equal(f.app.stats().rooms, 0);
    assert.equal((await fetch(f.origin + '/health')).status, 200);
  } finally { await f.close(); }
});

for (const method of ['input', 'tick', 'snapshot', 'leave', 'destroy']) {
  test(`engine ${method} failure isolates the affected room and does not leak exceptions`, async () => {
    let clock = 0;
    const diagnostics = [];
    const f = await fixture({ now: () => clock, onError: code => diagnostics.push(code) });
    try {
      const broken = await f.connect();
      await create(broken);
      const healthy = await f.connect();
      await create(healthy);
      f.engineFactory.rooms[0][method] = () => { throw new Error('private engine detail'); };
      if (method === 'input') broken.send(input());
      else if (method === 'leave' || method === 'destroy') broken.send({ type: 'leave' });
      else { clock = 50; assert.doesNotThrow(() => f.app.tick()); }
      assert.deepEqual(await broken.next(), { type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error.' });
      assert.equal((await broken.closed).code, 1011);
      assert.ok(diagnostics.length > 0);
      assert.ok(diagnostics.every(code => /^engine(_destroy)?_error$/.test(code)));
      assert.equal(f.app.stats().rooms, 1);
      healthy.send({ type: 'ping', stamp: 3 });
      let response;
      do { response = await healthy.next(); } while (response.type === 'state');
      assert.equal(response.stamp, 3);
    } finally { await f.close(); }
  });
}

test('REAL C++/Wasm default engine loads, joins and acknowledges input through actual socket', async () => {
  let clock = 0;
  const f = await fixture({ engineFactory: undefined, now: () => clock });
  try {
    assert.equal((await (await fetch(f.origin + '/health')).json()).engine, 'C++/Wasm');
    const client = await f.connect();
    const welcome = await create(client, 'real-Wasm');
    client.send(input(0));
    client.send({ type: 'ping', stamp: 0 });
    assert.equal((await client.next()).type, 'pong');
    clock = 50; f.app.tick();
    const state = await client.next();
    assert.equal(state.type, 'state');
    assert.equal(state.room, welcome.room);
    assert.equal(state.players.length, 1);
    assert.equal(state.players[0].ack, 0);
    assert.ok(Number.isFinite(state.players[0].x));
    assert.ok(state.time > 0);
  } finally { await f.close(); }
});

test('app close owns live socket teardown, destroys rooms and is idempotent', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    await create(client);
    await Promise.race([f.app.close(), pause(300).then(() => { throw new Error('close left WebSockets open'); })]);
    assert.equal((await client.closed).code, 1001);
    assert.deepEqual(f.app.stats(), { rooms: 0, clients: 0 });
    assert.equal(f.engineFactory.rooms[0].destroyed, true);
    await f.app.close();
    assert.equal(f.app.server.listening, false);
  } finally { await f.close(); }
});

test('unexpected static delivery error returns empty 500 and a sanitized observable diagnostic', async () => {
  const diagnostics = [];
  const f = await fixture({ root: 42, onError: code => diagnostics.push(code) });
  try {
    const response = await http(f.origin, '/');
    assert.equal(response.status, 500);
    assert.equal(String(response.body), '');
    assert.deepEqual(diagnostics, ['http_error']);
  } finally { await f.close(); }
});

// Vertical 1: actual ephemeral HTTP listener, explicit fake-engine health.
test('health reports actual transport counts without claiming injected engine is Wasm', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.origin + '/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, engine: 'injected', rooms: 0, clients: 0, tickRate: 60 });
    assert.deepEqual(f.app.stats(), { rooms: 0, clients: 0 });
  } finally { await f.close(); }
});

test('create assigns socket identity and sends welcome before authoritative snapshot', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    const welcome = await create(client, '  한글😀  ');
    assert.match(welcome.room, /^[0-9A-F]{6}$/);
    assert.equal(welcome.id, 0);
    assert.deepEqual(welcome.names, { 0: '한글😀' });
    assert.deepEqual(f.app.stats(), { rooms: 1, clients: 1 });
    const response = await fetch(f.origin + '/health');
    assert.equal((await response.json()).clients, 1);
    assert.equal(f.engineFactory.rooms.length, 1);
  } finally { await f.close(); }
});

test('four socket memberships share a room; fifth can recover from ROOM_FULL and ROOM_NOT_FOUND', async () => {
  const f = await fixture();
  try {
    const owner = await f.connect();
    const welcome = await create(owner);
    for (let id = 1; id < 4; id++) {
      const client = await f.connect();
      client.send({ type: 'join', name: `peer${id}`, code: welcome.room });
      const joined = await client.next();
      assert.equal(joined.type, 'welcome');
      assert.equal(joined.id, id);
      assert.equal(joined.room, welcome.room);
      assert.equal((await client.next()).players.length, id + 1);
    }
    const fifth = await f.connect();
    fifth.send({ type: 'join', name: 'extra', code: welcome.room });
    assert.equal((await fifth.next()).code, 'ROOM_FULL');
    fifth.send({ type: 'join', name: 'extra', code: welcome.room === '000000' ? 'FFFFFF' : '000000' });
    assert.equal((await fifth.next()).code, 'ROOM_NOT_FOUND');
    await create(fifth, 'retry');
    assert.deepEqual(f.app.stats(), { rooms: 2, clients: 5 });
  } finally { await f.close(); }
});
