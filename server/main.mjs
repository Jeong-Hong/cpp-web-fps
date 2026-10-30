import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.mjs';

const help = `CROSSYARD authoritative C++/Wasm server
Usage: node server/main.mjs [--host ADDRESS] [--port PORT]
Default: http://127.0.0.1:8088 (loopback only)
  --host ADDRESS   Explicit local interface IP or localhost; never a wildcard
  --port PORT      Decimal port 0..65535 (0 requests an ephemeral test port)
  --interfaces     Discover local adapter addresses before explicit LAN binding
  --help           Show this help without starting a server
No firewall rules or browser settings are changed. Internet hosting is not configured.
`;

export function parseArgs(args, interfaces = networkInterfaces()) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '--interfaces')) return { action: args[0].slice(2) };
  const options = { host: '127.0.0.1', port: 8088 };
  const seen = new Set();
  const local = new Set(['127.0.0.1', '::1', 'localhost', ...Object.values(interfaces).flat().map(address => address.address)]);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--host', '--port'].includes(flag) || seen.has(flag) || !value) throw new Error('Invalid command arguments. Use --help.');
    seen.add(flag);
    if (flag === '--host') {
      if (value === '0.0.0.0' || value === '::' || (!isIP(value) && value !== 'localhost') || !local.has(value)) throw new Error('Select a specific local address using --interfaces.');
      options.host = value;
    } else {
      if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > 65535) throw new Error('Invalid port.');
      options.port = Number(value);
    }
  }
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.action === 'help') { console.log(help); return; }
  if (options.action === 'interfaces') {
    for (const [name, addresses] of Object.entries(networkInterfaces())) for (const address of addresses) console.log(`${name}: ${address.address} (${address.family})`);
    return;
  }
  const app = await createApp();
  try {
    const address = await app.listen(options.host, options.port);
    const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    console.log(`CROSSYARD http://${host}:${address.port} (C++/Wasm)`);
  } catch (error) { await app.close(); throw error; }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Server could not start. Check --help, build artifacts and the selected address/port.'); process.exitCode = 1; });
}
