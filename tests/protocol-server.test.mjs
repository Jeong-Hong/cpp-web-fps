import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, ProtocolError } from '../server/protocol.mjs';

const input = (extra = {}) => ({
  type: 'input', seq: 0, forward: 0, strafe: 0, yaw: 0, pitch: 0,
  fire: false, reload: false, sprint: false, jump: false, crouch: false, weapon: 0, grenade: false,
  ...extra,
});
const parse = value => parseMessage(JSON.stringify(value));

test('strict v2 input accepts the complete action shape unchanged', () => {
  for (const value of [input(), input({ jump: true, crouch: true, weapon: 1, grenade: true })]) {
    let actual;
    assert.doesNotThrow(() => { actual = parse(value); }, 'strict v2 input must be accepted');
    assert.deepEqual(actual, value);
  }
});

test('strict v2 weapon accepts only integer zero or one', () => {
  for (const weapon of [0, 1]) assert.equal(parse(input({ weapon })).weapon, weapon);
  for (const weapon of [-1, -0.00001, 0.5, 1.00001, 2, 2147483647, 2147483648, 1e100, null, '0', '1', true, false, [], {}]) {
    assert.throws(() => parse(input({ weapon })),
      error => error instanceof ProtocolError && error.code === 'INVALID_MESSAGE' && error.message === 'Invalid message.',
      `weapon must reject ${JSON.stringify(weapon)}`);
  }
});

test('strict v2 input refuses every omitted field and the old network shape', () => {
  for (const field of Object.keys(input())) {
    const value = input();
    delete value[field];
    assert.throws(() => parse(value), { code: 'INVALID_MESSAGE', message: 'Invalid message.' }, `missing ${field} must be rejected`);
  }
  const { jump, crouch, weapon, grenade, ...legacy } = input();
  assert.throws(() => parse(legacy), { code: 'INVALID_MESSAGE', message: 'Invalid message.' }, 'legacy input must not acquire defaults');
});

test('strict v2 input refuses unknown and client-owned state fields', () => {
  for (const field of ['extra', 'id', 'x', 'y', 'z', 'hp', 'owner', 'target', 'vx', 'vy', 'vz', 'fuse', 'damage', 'grenades', '__proto__']) {
    assert.throws(() => parse(input({ [field]: 0 })),
      { code: 'INVALID_MESSAGE', message: 'Invalid message.' }, `unknown ${field} must be rejected`);
  }
});

test('strict v2 preserves inclusive movement and sequence bounds before conversion', () => {
  for (const extra of [
    { seq: 0, forward: -1, strafe: -1, yaw: -Math.PI, pitch: -1.45 },
    { seq: 2147483647, forward: 1, strafe: 1, yaw: Math.PI, pitch: 1.45 },
  ]) assert.deepEqual(parse(input(extra)), input(extra));
  for (const extra of [
    { seq: -1 }, { seq: 2147483648 }, { seq: 0.5 }, { seq: '0' },
    { forward: -1.00001 }, { forward: 1.00001 }, { strafe: -1.00001 }, { strafe: 1.00001 },
    { yaw: -Math.PI - 0.00001 }, { yaw: Math.PI + 0.00001 }, { pitch: -1.450001 }, { pitch: 1.450001 },
    { forward: '0' }, { strafe: null }, { yaw: 1e100 }, { pitch: Infinity },
  ]) assert.throws(() => parse(input(extra)), { code: 'INVALID_MESSAGE', message: 'Invalid message.' });
  assert.throws(() => parseMessage(JSON.stringify(input()).replace('"yaw":0', '"yaw":1e400')),
    { code: 'INVALID_MESSAGE', message: 'Invalid message.' });
  assert.throws(() => parseMessage(Buffer.from(JSON.stringify(input())), true),
    { code: 'INVALID_MESSAGE', message: 'Invalid message.' });
});

test('strict v2 action flags require exact booleans', () => {
  for (const field of ['jump', 'crouch', 'grenade']) {
    for (const value of [0, 1, null, 'true', 'false', [], {}]) {
      assert.throws(() => parse(input({ [field]: value })),
        error => error instanceof ProtocolError && error.code === 'INVALID_MESSAGE' && error.message === 'Invalid message.',
        `${field} must reject non-boolean ${JSON.stringify(value)}`);
    }
  }
});
