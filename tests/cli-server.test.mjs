import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mainPath = fileURLToPath(new URL('../server/main.mjs', import.meta.url));
const env = { ...process.env, TEMP: 'D:/Tools/Hermes/profiles/omh/cache/scratch', TMP: 'D:/Tools/Hermes/profiles/omh/cache/scratch', TMPDIR: 'D:/Tools/Hermes/profiles/omh/cache/scratch' };

// CLI probes never bind a non-loopback address.
test('CLI help documents loopback defaults, explicit host/port and interface discovery', () => {
  const help = execFileSync(process.execPath, [mainPath, '--help'], { encoding: 'utf8', env, timeout: 3000 });
  assert.match(help, /127\.0\.0\.1/);
  assert.match(help, /8088/);
  for (const flag of ['--host', '--port', '--interfaces']) assert.ok(help.includes(flag));
});

test('CLI starts real Wasm server on owned ephemeral loopback port and exits on teardown', async () => {
  const child = spawn(process.execPath, [mainPath, '--host', '127.0.0.1', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let output = '', errors = '';
  child.stderr.on('data', data => { errors += data; });
  let timer;
  try {
    const origin = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CLI startup timeout')), 4000);
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`CLI exited without listening: ${errors}`)));
    });
    clearTimeout(timer);
    const health = await (await fetch(origin + '/health')).json();
    assert.deepEqual(health, { ok: true, engine: 'C++/Wasm', rooms: 0, clients: 0, tickRate: 60 });
    assert.equal(errors, '');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});

test('CLI host selection requires a specific discovered local address and strict numeric port', async () => {
  const { parseArgs } = await import('../server/main.mjs');
  const interfaces = { test: [{ address: '192.168.5.10', family: 'IPv4' }] };
  assert.deepEqual(parseArgs([], interfaces), { host: '127.0.0.1', port: 8088 });
  assert.deepEqual(parseArgs(['--host', '192.168.5.10', '--port', '9000'], interfaces), { host: '192.168.5.10', port: 9000 });
  assert.deepEqual(parseArgs(['--port', '0'], interfaces), { host: '127.0.0.1', port: 0 });
  for (const args of [
    ['--host', '0.0.0.0'], ['--host', '::'], ['--host', '8.8.8.8'], ['--host', 'attacker.invalid'],
    ['--port', '1e3'], ['--port', '-1'], ['--port', '65536'], ['--port', 'NaN'], ['--port'],
    ['--host'], ['--host', '--port'], ['--port', '9000', '--port', '9001'], ['--unknown'],
  ]) assert.throws(() => parseArgs(args, interfaces));
});
