// ABI contract evidence with a fake Module; not a real Wasm gameplay test.
import test from 'node:test';
import assert from 'node:assert/strict';

const snapshot = {
  time: 50,
  players: [{ id: 2, hp: 100, ammo: 11, vy: 2.5, grounded: false, crouch: true, weapon: 1,
    rifleAmmo: 23, pistolAmmo: 11, grenadeCount: 1, equip: 150 }],
  grenades: [{ id: 7, owner: 2, x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: -6,
    fuse: 2400, explosion: 0, exploding: false }],
};

function moduleStub() {
  const calls = [];
  const module = {
    _room_create() { calls.push(['create']); return 128; },
    _room_destroy(...args) { calls.push(['destroy', ...args]); },
    _room_join(...args) { calls.push(['join', ...args]); return 2; },
    _room_leave(...args) { calls.push(['leave', ...args]); },
    _room_input_v2(...args) { calls.push(['input', ...args]); return 1; },
    _room_tick(...args) { calls.push(['tick', ...args]); },
    _room_snapshot(...args) { calls.push(['snapshot', ...args]); return 256; },
    UTF8ToString(ptr) { calls.push(['string', ptr]); return JSON.stringify(snapshot); },
  };
  return { module, calls };
}
const input = { type: 'input', seq: 5, forward: 1, strafe: -1, yaw: 0.25, pitch: 0.5, fire: true, reload: false, sprint: true, jump: false, crouch: false, weapon: 0, grenade: false };

test('engine awaits Emscripten factory then forwards exact room ABI with no JS gameplay', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  stub.module._room_input = (...args) => { stub.calls.push(['legacy-input', ...args]); return 1; };
  let initialized = false;
  const createRoom = await loadEngine(async () => { await Promise.resolve(); initialized = true; return stub.module; });
  assert.equal(initialized, true);
  const room = createRoom();
  assert.equal(room.join(), 2);
  assert.equal(room.input(2, { ...input, jump: true, weapon: 1 }), true);
  assert.equal(room.input(2, { ...input, seq: 6, fire: false, reload: true, sprint: false, crouch: true, grenade: true }), true);
  room.tick(1 / 60);
  assert.deepEqual(room.snapshot(), snapshot, 'C++ JSON fields and millisecond timers must pass through unchanged');
  room.leave(2);
  room.destroy();
  assert.deepEqual(stub.calls, [
    ['create'], ['join', 128], ['input', 128, 2, 1, -1, 0.25, 0.5, 1, 0, 1, 5, 1, 0, 1, 0],
    ['input', 128, 2, 1, -1, 0.25, 0.5, 0, 1, 0, 6, 0, 1, 0, 1],
    ['tick', 128, 1 / 60], ['snapshot', 128], ['string', 256], ['leave', 128, 2], ['destroy', 128],
  ], '14 v2 ABI arguments must be passed in contract order without legacy fallback');
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

test('engine rejects legacy-only Module before any room allocation', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  delete stub.module._room_input_v2;
  stub.module._room_input = (...args) => { stub.calls.push(['legacy-input', ...args]); return 1; };
  await assert.rejects(loadEngine(async () => stub.module), /Invalid engine ABI/, 'v2 export is mandatory');
  assert.deepEqual(stub.calls, [], 'invalid ABI must not allocate or call the legacy input');
});

test('bridge refuses omitted fields and legacy network inputs before v2 ABI entry', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  const room = (await loadEngine(async () => stub.module))();
  try {
    for (const field of Object.keys(input)) {
      const bad = { ...input };
      delete bad[field];
      assert.throws(() => room.input(2, bad), { code: 'INVALID_MESSAGE', message: 'Invalid message.' }, `missing ${field} must be rejected before ABI entry`);
    }
    const { jump, crouch, weapon, grenade, ...legacy } = input;
    assert.throws(() => room.input(2, legacy), { code: 'INVALID_MESSAGE', message: 'Invalid message.' });
    assert.deepEqual(stub.calls, [['create']], 'omitted actions must never enter v2 ABI');
  } finally { room.destroy(); }
});

test('bridge refuses invalid v2 actions before numeric ABI conversion', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  const room = (await loadEngine(async () => stub.module))();
  try {
    for (const field of ['jump', 'crouch', 'grenade']) {
      for (const value of [0, 1, null, 'false', 'true', [], {}]) {
        assert.throws(() => room.input(2, { ...input, [field]: value }),
          { code: 'INVALID_MESSAGE', message: 'Invalid message.' }, `${field} must be rejected before ABI entry`);
      }
    }
    for (const weapon of [-1, -0.00001, 0.5, 1.00001, 2, 2147483647, 2147483648, 1e100, Infinity, null, '0', '1', true, false, [], {}]) {
      assert.throws(() => room.input(2, { ...input, weapon }),
        { code: 'INVALID_MESSAGE', message: 'Invalid message.' }, `weapon ${JSON.stringify(weapon)} must be rejected before ABI entry`);
    }
    assert.deepEqual(stub.calls, [['create']], 'invalid actions must never enter v2 ABI');
  } finally { room.destroy(); }
});

test('engine preserves native input refusal without adding JS game rules', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  stub.module._room_input_v2 = (...args) => { stub.calls.push(['input', ...args]); return 0; };
  const room = (await loadEngine(async () => stub.module))();
  try {
    assert.equal(room.input(2, input), false);
    assert.deepEqual(stub.calls, [['create'], ['input', 128, 2, 1, -1, 0.25, 0.5, 1, 0, 1, 5, 0, 0, 0, 0]]);
  } finally { room.destroy(); }
});

test('engine rejects zero allocation pointer and missing ABI exports', async () => {
  const { loadEngine } = await import('../server/engine.mjs');
  const stub = moduleStub();
  stub.module._room_create = () => 0;
  const createRoom = await loadEngine(async () => stub.module);
  assert.throws(createRoom, /allocation/);
  delete stub.module._room_input_v2;
  await assert.rejects(loadEngine(async () => stub.module), /ABI/);
});
