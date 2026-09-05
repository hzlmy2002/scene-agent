#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './server.js';
import {install, type Client} from './install.js';
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {client: {type: 'string'}, home: {type: 'string'}, 'install-skills': {type: 'boolean'}, help: {type: 'boolean'}}});
  const command = positionals[0] ?? 'serve';
  if (values.help) {
    console.log('aisa-web-market serve [--install-skills --client codex|claude-code|hermes]\naisa-web-market setup|uninstall --client codex|claude-code|hermes [--home directory]\naisa-web-market status\nSet AISA_API_KEY in the server environment. setup never stores the token.'); return;
  }
  if (positionals.length > 1) throw Error('Unexpected positional argument.');
  if (command === 'status') { console.log(JSON.stringify({credential_configured: Boolean(process.env.AISA_API_KEY?.trim()), authentication: 'bearer', version: '0.1.0'})); return; }
  if (command === 'setup' || command === 'uninstall') {
    if (!values.client) throw Error('--client is required.');
    console.log(JSON.stringify(await install(values.client as Client, {home: values.home, remove: command === 'uninstall'})));
    console.log('Client configuration preserves existing values; serialization may reformat comments. Ensure AISA_API_KEY reaches the client process. Restart or refresh the client to load skills.'); return;
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
