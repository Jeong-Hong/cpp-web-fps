// ABI contract evidence with a fake Module; not a real Wasm gameplay test.
import test from 'node:test';
import assert from 'node:assert/strict';

function moduleStub() {
  const calls = [];
  const module = {
    _room_create() { calls.push(['create']); return 128; },
    _room_destroy(...args) { calls.push(['destroy', ...args]); },
    _room_join(...args) { calls.push(['join', ...args]); return 2; },
    _room_leave(...args) { calls.push(['leave', ...args]); },
    _room_input(...args) { calls.push(['input', ...args]); return 1; },
    _room_tick(...args) { calls.push(['tick', ...args]); },
    _room_snapshot(...args) { calls.push(['snapshot', ...args]); return 256; },
    UTF8ToString(ptr) { calls.push(['string', ptr]); return JSON.stringify({ time: 50, players: [{ id: 2, hp: 100 }] }); },
  };
  return { module, calls };
}
const input = { type: 'input', seq: 5, forward: 1, strafe: -1, yaw: 0.25, pitch: 0.5, fire: true, reload: false, sprint: true };

test('engine awaits Emscripten factory then forwards exact room ABI with no JS gameplay', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  let initialized = false;
  const createRoom = await loadEngine(async () => { await Promise.resolve(); initialized = true; return stub.module; });
  assert.equal(initialized, true);
  const room = createRoom();
  assert.equal(room.join(), 2);
  assert.equal(room.input(2, input), true);
  room.tick(1 / 60);
  assert.deepEqual(room.snapshot(), { time: 50, players: [{ id: 2, hp: 100 }] });
  room.leave(2);
  room.destroy();
  assert.deepEqual(stub.calls, [
    ['create'], ['join', 128], ['input', 128, 2, 1, -1, 0.25, 0.5, 1, 0, 1, 5],
    ['tick', 128, 1 / 60], ['snapshot', 128], ['string', 256], ['leave', 128, 2], ['destroy', 128],
  ]);
});

test('engine destroys exactly once and prevents calls through a freed pointer', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  const createRoom = await loadEngine(async () => stub.module);
  const room = createRoom();
  room.destroy(); room.destroy();
  assert.deepEqual(stub.calls, [['create'], ['destroy', 128]]);
  for (const run of [() => room.join(), () => room.leave(0), () => room.input(0, input), () => room.tick(1 / 60), () => room.snapshot()]) assert.throws(run, /destroyed/);
  assert.deepEqual(stub.calls, [['create'], ['destroy', 128]]);
});

for (const bad of [
  { ...input, seq: 2147483648 }, { ...input, seq: -1 }, { ...input, forward: Infinity },
  { ...input, strafe: 1.00001 }, { ...input, yaw: 1e100 }, { ...input, pitch: '0' },
  { ...input, fire: 1 }, { ...input, reload: null }, { ...input, sprint: 'false' }, { ...input, id: 0 },
]) {
  test(`bridge rejects invalid input before numeric ABI conversion: ${JSON.stringify(bad)}`, async () => {
    const { loadEngine } = await import('../server/engine.mjs');
    const stub = moduleStub();
    const room = (await loadEngine(async () => stub.module))();
    assert.throws(() => room.input(2, bad));
    assert.equal(stub.calls.filter(call => call[0] === 'input').length, 0);
    room.destroy();
  });
}

test('engine rejects zero allocation pointer and missing ABI exports', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  stub.module._room_create = () => 0;
  const createRoom = await loadEngine(async () => stub.module);
  assert.throws(createRoom, /allocation/);
  delete stub.module._room_input;
  await assert.rejects(loadEngine(async () => stub.module), /ABI/);
});
