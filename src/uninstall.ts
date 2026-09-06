import {promises as fs} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {installedClients} from './install.js';
import {authFile, readSession} from './oauth.js';

async function prune(dir: string) {
  try {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const entry of await fs.readdir(dir, {withFileTypes: true})) if (entry.isDirectory()) await prune(path.join(dir, entry.name));
    await fs.rmdir(dir);
  } catch (e: any) {if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;}
}
async function empty(dir: string) {
  try {await fs.rmdir(dir);} catch (e: any) {if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;}
}
export async function cleanupUninstall(home = homedir(), fetcher: typeof fetch = fetch) {
  home = path.resolve(home);
  const dir = path.join(home, '.aisa/web-market');
  for (const target of [path.join(home,'.aisa'), dir, authFile(home)]) {
    try {if ((await fs.lstat(target)).isSymbolicLink()) throw Error('Refusing symlinked uninstall credential/state path.');}
    catch (e: any) {if (e.code !== 'ENOENT') throw e;}
  }
  await fs.mkdir(dir, {recursive: true});
  const lock = path.join(dir, 'install.lock');
  let fd;
  try {fd = await fs.open(lock, 'wx', 0o600);} catch {throw Error('Another setup is active; retry uninstall after it finishes.');}
  let cleared = false;
  let warning: string | undefined;
  try {
    const remaining = await installedClients(home);
    for (const [client, root] of [['codex','.agents'],['claude-code','.claude'],['hermes','.hermes']] as const) {
      if (remaining.includes(client)) continue;
      await prune(path.join(home, root, 'skills/aisa-web-market'));
      await empty(path.join(home, root, 'skills'));
      await empty(path.join(home, root));
    }
    if (!remaining.length) {
      const file = authFile(home);
      const tokenLock = `${file}.lock`;
      let tokenFd;
      try {tokenFd = await fs.open(tokenLock, 'wx', 0o600);} catch {throw Error('OAuth credentials are in use; stop AIsa processes and retry uninstall.');}
      try {
        let session;
        try {session = await readSession(file);} catch { /* Corrupt credentials still need local cleanup. */ }
        if (session?.refresh_token) {
          try {
            const response = await fetcher('https://clerk.aisa.one/oauth/token/revoke', {method:'POST', redirect:'error', signal:AbortSignal.timeout(10_000), body:new URLSearchParams({token:session.refresh_token, token_type_hint:'refresh_token', client_id:session.client_id})});
            if (!response.ok) throw Error();
            await response.body?.cancel();
          } catch {warning = 'Local OAuth credentials removed, but server-side revocation could not be confirmed.';}
        }
        await fs.rm(file, {force:true});
        cleared = true;
      } finally {await tokenFd.close(); await fs.rm(tokenLock, {force:true});}
    }
  } finally {await fd.close(); await fs.rm(lock, {force:true});}
  if (cleared) {
    await empty(dir);
    await empty(path.join(home,'.aisa'));
    await empty(path.join(home,'.codex'));
  }
  return {credentialsCleared:cleared, warning};
}
