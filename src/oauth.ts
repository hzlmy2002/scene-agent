import {promises as fs} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {createHash, randomBytes, randomUUID, randomInt} from 'node:crypto';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';

const issuer = 'https://clerk.aisa.one';
export const authFile = (home = homedir()) => path.resolve(home, '.aisa/oauth.json');
export interface Session {client_id: string; access_token: string; refresh_token?: string; expires_at: number}
export async function readSession(file = process.env.AISA_AUTH_FILE || authFile()): Promise<Session | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof value.client_id !== 'string' || typeof value.access_token !== 'string' || !Number.isFinite(value.expires_at)
      || (value.refresh_token !== undefined && typeof value.refresh_token !== 'string')) throw Error();
    return value;
  } catch (e: any) {
    if (e.code === 'ENOENT') return undefined;
    throw Error('Cannot read OAuth credentials. Run setup --auth oauth to sign in again.');
  }
}
export async function saveSession(file: string, session: Session) {
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {await fs.writeFile(tmp, JSON.stringify(session), {flag: 'wx', mode: 0o600}); await fs.rename(tmp, file);}
  finally {await fs.rm(tmp, {force: true});}
}
async function request(url: string, init?: RequestInit, fetcher: typeof fetch = fetch) {
  let response: Response;
  try {response = await fetcher(url, {...init, redirect: 'error', signal: AbortSignal.timeout(20_000)});}
  catch {throw Error('OAuth service unavailable. Retry setup or use --auth key.');}
  if (!response.ok) throw Error(`OAuth request failed (HTTP ${response.status}). Run setup --auth oauth to sign in again.`);
  try {return await response.json();} catch {throw Error('OAuth service returned invalid JSON.');}
}
export function tokenSession(client_id: string, body: any, previous?: Session): Session {
  if (body.token_type?.toLowerCase() !== 'bearer' || typeof body.access_token !== 'string' || !body.access_token
    || !Number.isFinite(body.expires_in) || body.expires_in <= 0
    || (body.refresh_token !== undefined && typeof body.refresh_token !== 'string')) throw Error('OAuth service returned an invalid token response.');
  return {client_id, access_token: body.access_token, refresh_token: body.refresh_token || previous?.refresh_token, expires_at: Date.now() + body.expires_in * 1000};
}
// A file lock serializes refreshes across the three clients as well as concurrent tools.
export async function accessToken(file = process.env.AISA_AUTH_FILE || authFile(), fetcher: typeof fetch = fetch): Promise<string | undefined> {
  const current = await readSession(file);
  if (!current) return undefined;
  if (current.expires_at > Date.now() + 60_000) return current.access_token;
  const lock = `${file}.lock`;
  let fd;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {fd = await fs.open(lock, 'wx', 0o600); break;}
    catch (e: any) {if (e.code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 250));}
  }
  if (!fd) throw Error('OAuth credentials are busy. If a process crashed, remove oauth.json.lock after stopping the other AIsa processes.');
  try {
    const latest = await readSession(file);
    if (!latest) return undefined;
    if (latest.expires_at > Date.now() + 60_000) return latest.access_token;
    if (!latest.refresh_token) throw Error('OAuth session expired. Run setup --auth oauth to sign in again.');
    const body = await request(`${issuer}/oauth/token`, {method: 'POST', body: new URLSearchParams({grant_type: 'refresh_token', client_id: latest.client_id, refresh_token: latest.refresh_token})}, fetcher);
    const next = tokenSession(latest.client_id, body, latest);
    await saveSession(file, next);
    return next.access_token;
  } finally {await fd.close(); await fs.rm(lock, {force: true});}
}
export function callbackCode(raw: string, redirect: string, state: string): string {
  let url: URL;
  try {url = new URL(raw.trim());} catch {throw Error('Paste the complete callback URL, including code and state.');}
  const expected = new URL(redirect);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw Error('Callback URL does not match this login attempt.');
  if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) throw Error('Callback state does not match this login attempt.');
  if (url.searchParams.has('iss') && url.searchParams.get('iss') !== issuer) throw Error('Callback issuer does not match AIsa.');
  if (url.searchParams.has('error')) throw Error('OAuth authorization was declined. Run setup again or choose --auth key.');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.getAll('code').length !== 1) throw Error('Callback URL has no unique authorization code.');
  return code;
}
function openBrowser(url: string) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, {stdio: 'ignore', detached: true});
  child.on('error', () => {process.stderr.write('Could not open a browser. Open the printed URL on another device.\n');});
  child.unref();
}
export async function login(file: string, noBrowser = false, io = {input: process.stdin, output: process.stderr, fetcher: fetch, launch: openBrowser}) {
  const {input, output, fetcher, launch} = io;
  if (!input.isTTY) throw Error('OAuth setup requires an interactive terminal. Use AISA_API_KEY for unattended setup.');
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  let redirect = '';
  let complete: (code: string) => void = () => {};
  const server = createServer((req, res) => {
    try {
      const code = callbackCode(new URL(req.url || '/', redirect).href, redirect, state);
      res.writeHead(200, {'Content-Type': 'text/plain'}).end('AIsa authorization received. You can return to the terminal.');
      complete(code);
    } catch {res.writeHead(400, {'Content-Type': 'text/plain'}).end('Invalid callback. Return to the terminal or retry authorization.');}
  });
  let lines: ReturnType<typeof createInterface> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (noBrowser) {
      // Manual mode also works where binding a local port is forbidden.
      redirect = `http://127.0.0.1:${randomInt(49152, 65536)}/callback`;
    } else {
      await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', () => {server.removeListener('error', reject); resolve();});})
        .catch(() => {throw Error('Cannot listen for OAuth callback. Retry setup --auth oauth --no-browser to paste the callback manually.');});
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('Could not start OAuth callback listener.');
      redirect = `http://127.0.0.1:${address.port}/callback`;
    }
    const metadata = await request(`${issuer}/.well-known/oauth-authorization-server`, undefined, fetcher);
    if (metadata.issuer !== issuer || metadata.registration_endpoint !== `${issuer}/oauth/register`
      || metadata.authorization_endpoint !== `${issuer}/oauth/authorize` || metadata.token_endpoint !== `${issuer}/oauth/token`
      || !metadata.code_challenge_methods_supported?.includes('S256')) throw Error('Unexpected AIsa OAuth discovery metadata.');
    const client = await request(metadata.registration_endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_name: 'AIsa Scene Agents', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'profile email offline_access'})}, fetcher);
    if (!client.client_id || client.token_endpoint_auth_method !== 'none') throw Error('OAuth registration did not return a public client.');
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: 'profile email offline_access', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'}).toString();
    const code = await new Promise<string>((resolve, reject) => {
      complete = resolve;
      timer = setTimeout(() => reject(Error('OAuth login timed out after 5 minutes. Run setup again.')), 300_000);
      lines = createInterface({input: input, output: output});
      lines.on('line', line => {
        if (!line.trim()) return;
        if (line.trim().toLowerCase() === 'key') {reject(Error('Switched to API Key.')); return;}
        try {resolve(callbackCode(line, redirect, state));}
        catch (e) {output.write(`${(e as Error).message}\nPaste callback URL: `);}
      });
      lines.once('SIGINT', () => reject(Error('OAuth login cancelled.')));
      lines.once('close', () => reject(Error('OAuth input closed. Run setup again.')));
      output.write(`Open this URL to sign in:\n${url.href}\n\nWaiting for browser callback. Alternatively paste the COMPLETE callback URL here, or type key to use an API Key.\nOn another device, localhost may fail to load; copy the URL from its address bar.\nPaste callback URL: `);
      if (!noBrowser) launch(url.href);
    });
    lines?.close(); input.pause();
    if (timer) clearTimeout(timer);
    const body = await request(metadata.token_endpoint, {method: 'POST', body: new URLSearchParams({grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: redirect, code_verifier: verifier})}, fetcher);
    await saveSession(file, tokenSession(client.client_id, body));
    output.write('\nOAuth login saved.\n');
    if (!body.refresh_token) output.write('No refresh token was issued; sign in again when this session expires.\n');
  } finally {
    if (timer) clearTimeout(timer);
    lines?.close(); input.pause();
    server.close(); server.closeAllConnections();
  }
}
