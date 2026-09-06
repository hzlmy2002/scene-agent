#!/usr/bin/env node
import {setupCredentialResolver} from './credentials.js';
import {cleanupUninstall} from './uninstall.js';
import {chooseUninstall} from './interactive.js';
import {authFile, readSession} from './oauth.js';
import {parseArgs} from 'node:util';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './server.js';
import {detectClients, installedClients, install, type Client} from './install.js';
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {client: {type: 'string'}, home: {type: 'string'}, auth: {type: 'string'}, 'no-browser': {type: 'boolean'}, 'install-skills': {type: 'boolean'}, help: {type: 'boolean'}}});
  const command = positionals[0] ?? 'serve';
  if (values.help) {
    console.log('aisa-web-market serve [--install-skills --client codex|claude-code|hermes]\naisa-web-market setup [--client codex|claude-code|hermes] [--home directory] [--auth oauth|key] [--no-browser]\naisa-web-market uninstall [--client codex|claude-code|hermes] [--home directory]\naisa-web-market status\nsetup detects all supported clients in your home directory when --client is omitted. setup reuses existing credentials or starts OAuth automatically; type key during login to use an API Key. --auth forces a method. --no-browser prints the OAuth URL without opening it; paste the complete callback URL after login.'); return;
  }
  if (positionals.length > 1) throw Error('Unexpected positional argument.');
  if (command === 'status') {
    const key = !process.env.AISA_AUTH_FILE && process.env.AISA_API_KEY?.trim();
    const oauth = key ? undefined : await readSession(process.env.AISA_AUTH_FILE || authFile(values.home));
    console.log(JSON.stringify({credential_configured: Boolean(key || oauth), authentication: key ? 'key' : oauth ? 'oauth' : 'none', version: '0.1.2'})); return;
  }
  if (command === 'setup' || command === 'uninstall') {
    let clients: Client[];
    if (values.client) clients = [values.client as Client];
    else if (command === 'uninstall') {
      const installed = await installedClients(values.home);
      const selected = await chooseUninstall(installed);
      if (!selected) {console.log('Uninstall cancelled.'); return;}
      clients = selected;
      console.error(`Uninstalling from: ${clients.join(', ')}`);
    } else clients = await detectClients(values.home);
    if (!clients.length && command === 'setup') throw Error('No supported clients detected. Run a client once, or use setup --client codex|claude-code|hermes.');
    if (!values.client && command === 'setup') console.error(`Detected clients: ${clients.join(', ')}`);
    const resolveKey = setupCredentialResolver({home: values.home, auth: values.auth, noBrowser: values['no-browser']});
    for (const client of clients) {
      try {
        console.log(JSON.stringify(await install(client, {home: values.home, remove: command === 'uninstall', resolveKey: command === 'setup' ? resolveKey : undefined})));
      } catch (error) {
        console.error(`${client}: ${error instanceof Error ? error.message : 'Installation failed.'}`);
        process.exitCode = 1;
      }
    }
    if (command === 'uninstall') {
      const cleanup = await cleanupUninstall(values.home);
      if (cleanup.warning) console.error(cleanup.warning);
      console.log(cleanup.credentialsCleared ? 'Uninstalled. Local OAuth login and installation state cleared.' : 'Selected clients removed. OAuth login retained for remaining installations.'); return;
    }
    console.log('Client configuration preserves existing values; serialization may reformat comments. OAuth credentials are shared locally; API Keys are passed through client configuration or the environment. Restart or refresh the client to load skills.'); return;
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
