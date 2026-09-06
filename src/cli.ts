#!/usr/bin/env node
import {sharedSetupKeyResolver} from './credentials.js';
import {parseArgs} from 'node:util';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './server.js';
import {detectClients, install, type Client} from './install.js';
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {client: {type: 'string'}, home: {type: 'string'}, 'install-skills': {type: 'boolean'}, help: {type: 'boolean'}}});
  const command = positionals[0] ?? 'serve';
  if (values.help) {
    console.log('aisa-web-market serve [--install-skills --client codex|claude-code|hermes]\naisa-web-market setup [--client codex|claude-code|hermes] [--home directory]\naisa-web-market uninstall --client codex|claude-code|hermes [--home directory]\naisa-web-market status\nsetup detects all supported clients in your home directory when --client is omitted. Set AISA_API_KEY in the server environment. setup prompts for a missing key and saves it in the client MCP configuration.'); return;
  }
  if (positionals.length > 1) throw Error('Unexpected positional argument.');
  if (command === 'status') { console.log(JSON.stringify({credential_configured: Boolean(process.env.AISA_API_KEY?.trim()), authentication: 'bearer', version: '0.1.2'})); return; }
  if (command === 'setup' || command === 'uninstall') {
    if (command === 'uninstall' && !values.client) throw Error('--client is required for uninstall.');
    const clients = values.client ? [values.client as Client] : await detectClients(values.home);
    if (!clients.length) throw Error('No supported clients detected. Run a client once, or use setup --client codex|claude-code|hermes.');
    if (!values.client) console.error(`Detected clients: ${clients.join(', ')}`);
    const resolveKey = sharedSetupKeyResolver();
    for (const client of clients) {
      try {
        console.log(JSON.stringify(await install(client, {home: values.home, remove: command === 'uninstall', resolveKey: command === 'setup' ? resolveKey : undefined})));
      } catch (error) {
        console.error(`${client}: ${error instanceof Error ? error.message : 'Installation failed.'}`);
        process.exitCode = 1;
      }
    }
    console.log('Client configuration preserves existing values; serialization may reformat comments. A saved key is passed directly to the MCP process; otherwise ensure the client inherits AISA_API_KEY. Restart or refresh the client to load skills.'); return;
  }
  if (command !== 'serve') throw Error('Unknown command. Use --help.');
  if (values['install-skills']) {
    if (!values.client) throw Error('--install-skills requires --client.');
    console.error(JSON.stringify(await install(values.client as Client, {home: values.home, skillsOnly: true})));
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { void server.close().finally(() => process.exit(0)); });
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Startup failed.'); process.exitCode = 1; });
