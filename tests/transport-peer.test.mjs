import test from 'node:test';
import assert from 'node:assert/strict';

function socket({ immediate = false } = {}) {
  return {
    readyState: 1, bufferedAmount: 0, sent: [], callbacks: [], closes: [], terminated: false,
    send(data, callback) { this.sent.push(JSON.parse(data)); if (immediate) callback(); else this.callbacks.push(callback); },
    flush(error) { const callback = this.callbacks.shift(); assert.ok(callback); callback(error); },
    close(code, reason) { this.closes.push({ code, reason }); this.readyState = 2; },
    terminate() { this.terminated = true; this.readyState = 3; },
  };
}

// This fake sender is deliberate: a real ws receiver cannot deterministically stall send callbacks.
test('peer serializes reliable controls and coalesces only the latest full snapshot', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  const ws = socket();
  const peer = createPeer(ws);
  peer.control({ type: 'welcome' });
  peer.state({ type: 'state', time: 1 });
  peer.state({ type: 'state', time: 2 });
  peer.control({ type: 'pong', stamp: 1 });
  peer.control({ type: 'pong', stamp: 2 });
  assert.deepEqual(ws.sent, [{ type: 'welcome' }]);
  ws.flush(); ws.flush(); ws.flush();
  assert.deepEqual(ws.sent, [{ type: 'welcome' }, { type: 'pong', stamp: 1 }, { type: 'pong', stamp: 2 }, { type: 'state', time: 2 }]);
  ws.flush();
  peer.dispose();
});

test('peer bounds reliable control count including in-flight write at 32', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  const ws = socket();
  const peer = createPeer(ws);
  for (let i = 0; i < 32; i++) peer.control({ type: 'pong', stamp: i });
  assert.deepEqual(ws.closes, []);
  peer.control({ type: 'pong', stamp: 33 });
  assert.deepEqual(ws.closes, [{ code: 1013, reason: 'Slow receiver.' }]);
  ws.flush();
  assert.equal(ws.sent.length, 1);
  peer.dispose();
});

test('peer bounds retained UTF-8 bytes including in-flight frames and mailbox', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  const ws = socket();
  const value = { type: 'state', text: '😀'.repeat(8) };
  const size = Buffer.byteLength(JSON.stringify(value));
  const peer = createPeer(ws, { maxQueuedBytes: size * 2 });
  peer.state(value); // in flight
  peer.state(value); // latest mailbox
  for (let i = 0; i < 10000; i++) peer.state(value);
  assert.deepEqual(ws.closes, []);
  peer.control({ type: 'pong', stamp: 1 });
  assert.equal(ws.closes[0]?.code, 1013);
  peer.dispose();
});

test('peer closes only itself when native buffered bytes exceed inclusive limit', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  const ws = socket();
  const peer = createPeer(ws, { maxBufferedBytes: 64 });
  ws.bufferedAmount = 64;
  peer.control({ type: 'pong' });
  assert.deepEqual(ws.closes, []);
  ws.bufferedAmount = 65;
  peer.state({ type: 'state' });
  assert.equal(ws.closes[0]?.code, 1013);
  peer.dispose();
});

test('leave clears pending state without losing reliable controls', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  const ws = socket();
  const peer = createPeer(ws);
  peer.control({ type: 'welcome' });
  peer.state({ type: 'state', room: 'OLD000' });
  peer.clearState();
  peer.control({ type: 'left' });
  ws.flush(); ws.flush();
  assert.deepEqual(ws.sent, [{ type: 'welcome' }, { type: 'left' }]);
  peer.state({ type: 'state', time: 1 });
  peer.state({ type: 'state', time: 2 });
  peer.dispose();
  ws.flush();
  assert.equal(ws.sent.length, 3);
});

test('terminal error drains reliable controls before close and discards state', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  const ws = socket();
  const peer = createPeer(ws);
  peer.control({ type: 'welcome' });
  peer.state({ type: 'state' });
  peer.control({ type: 'error', code: 'INVALID_MESSAGE' });
  peer.end(1008, 'Invalid message.');
  assert.deepEqual(ws.closes, []);
  ws.flush();
  assert.equal(ws.sent.at(-1).type, 'error');
  ws.flush();
  assert.deepEqual(ws.closes, [{ code: 1008, reason: 'Invalid message.' }]);
  peer.state({ type: 'state', time: 9 });
  peer.control({ type: 'pong' });
  assert.equal(ws.sent.length, 2);
});

test('blocked write is reaped at 10 seconds even if no new output arrives', async () => {
  const { createPeer } = await import('../server/peer.mjs');
  let clock = 0;
  const ws = socket();
  const peer = createPeer(ws, { now: () => clock });
  peer.control({ type: 'welcome' });
  assert.equal(typeof peer.poll, 'function');
  clock = 9999; peer.poll();
  assert.deepEqual(ws.closes, []);
  clock = 10000; peer.poll();
  assert.equal(ws.closes[0]?.code, 1013);
  assert.equal(ws.terminated, true);
  ws.flush();
  assert.equal(ws.sent.length, 1);
});

for (const mode of ['callback', 'throw']) {
  test(`peer reports ${mode} send failure as fixed diagnostic and closes 1011`, async () => {
    const { createPeer } = await import('../server/peer.mjs');
    const ws = socket();
    const diagnostics = [];
    const peer = createPeer(ws, { onError: code => diagnostics.push(code) });
    if (mode === 'throw') ws.send = () => { throw new Error('secret payload'); };
    assert.doesNotThrow(() => peer.control({ type: 'welcome' }));
    if (mode === 'callback') ws.flush(new Error('secret payload'));
    assert.deepEqual(diagnostics, ['send_error']);
    assert.deepEqual(ws.closes, [{ code: 1011, reason: 'Internal server error.' }]);
    peer.state({ type: 'state' });
    assert.equal(ws.sent.length, mode === 'throw' ? 0 : 1);
    peer.dispose();
  });
}
