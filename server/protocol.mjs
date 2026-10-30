const fields = {
  create: ['type', 'name'],
  join: ['type', 'name', 'code'],
  input: ['type', 'seq', 'forward', 'strafe', 'yaw', 'pitch', 'fire', 'reload', 'sprint'],
  leave: ['type'],
  ping: ['type', 'stamp'],
};

export const errorMessages = Object.freeze({
  INVALID_MESSAGE: 'Invalid message.', INVALID_NAME: 'Invalid name.', INVALID_CODE: 'Invalid room code.',
  ROOM_NOT_FOUND: 'Room not found.', ROOM_FULL: 'Room is full.', SERVER_FULL: 'Server is full.',
  RATE_LIMIT: 'Rate limit exceeded.', INTERNAL_ERROR: 'Internal server error.',
});

export class ProtocolError extends Error {
  constructor(code) { super(errorMessages[code]); this.code = code; }
}
const invalid = (code = 'INVALID_MESSAGE') => { throw new ProtocolError(code); };
const finiteRange = (value, lo, hi) => typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;

// Validate magnitudes/types before passing numbers into Wasm's i32/f32 ABI.
export function parseMessage(data, isBinary = false) {
  if (isBinary) invalid();
  let message;
  try { message = JSON.parse(String(data)); } catch { invalid(); }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') invalid();
  const expected = Object.hasOwn(fields, message.type) ? fields[message.type] : null;
  if (!expected || Object.keys(message).length !== expected.length || expected.some(key => !Object.hasOwn(message, key))) invalid();
  if (message.type === 'create' || message.type === 'join') {
    if (typeof message.name !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(message.name)) invalid('INVALID_NAME');
    // With the u flag a valid surrogate pair is one code point, not a surrogate.
    if (/[\ud800-\udfff]/u.test(message.name)) invalid('INVALID_NAME');
    message.name = message.name.trim();
    const length = [...message.name].length;
    if (length < 1 || length > 16) invalid('INVALID_NAME');
    if (message.type === 'join' && (typeof message.code !== 'string' || !/^[0-9A-F]{6}$/.test(message.code))) invalid('INVALID_CODE');
  }
  if (message.type === 'input') {
    if (!Number.isInteger(message.seq) || !finiteRange(message.seq, 0, 2147483647) ||
        !finiteRange(message.forward, -1, 1) || !finiteRange(message.strafe, -1, 1) ||
        !finiteRange(message.yaw, -Math.PI, Math.PI) || !finiteRange(message.pitch, -1.45, 1.45) ||
        ['fire', 'reload', 'sprint'].some(key => typeof message[key] !== 'boolean')) invalid();
  }
  if (message.type === 'ping' && !Number.isSafeInteger(message.stamp)) invalid();
  return message;
}
