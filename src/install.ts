import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import TOML from '@iarna/toml';
import YAML from 'yaml';
export type Client = 'codex' | 'claude-code' | 'hermes';
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillName = 'aisa-web-market';
const hash = (x: string) => createHash('sha256').update(x).digest('hex');
async function read(file: string) { try { return await fs.readFile(file, 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return undefined; throw e; } }
async function noSymlinks(target: string) {
  const full = path.resolve(target); let cursor = path.parse(full).root;
  for (const part of full.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw Error(`Refusing symbolic link: ${cursor}`); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
}
async function atomic(file: string, value: string) {
  await noSymlinks(file); await fs.mkdir(path.dirname(file), {recursive: true});
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, value, {mode: 0o600, flag: 'wx'}); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, {force: true}); }
}
function configFor(client: Client, home: string) {
  if (client === 'codex') return {file: path.join(home, '.codex/config.toml'), key: 'mcp_servers', parse: (x: string) => TOML.parse(x) as any, stringify: (x: any) => TOML.stringify(x)};
  if (client === 'hermes') return {file: path.join(home, '.hermes/config.yaml'), key: 'mcp_servers', parse: (x: string) => YAML.parse(x), stringify: (x: any) => YAML.stringify(x)};
  return {file: path.join(home, '.claude.json'), key: 'mcpServers', parse: (x: string) => JSON.parse(x), stringify: (x: any) => JSON.stringify(x, null, 2) + '\n'};
}
function skillRoot(client: Client, home: string) { return path.join(home, client === 'codex' ? '.agents/skills' : client === 'hermes' ? '.hermes/skills' : '.claude/skills', skillName); }
async function skillFiles(root: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const item of await fs.readdir(path.join(root, prefix), {withFileTypes: true})) {
    const relative = path.join(prefix, item.name);
    if (item.isSymbolicLink()) throw Error('Bundled skills must not contain symlinks.');
    if (item.isDirectory()) Object.assign(out, await skillFiles(root, relative));
    else out[relative] = await fs.readFile(path.join(root, relative), 'utf8');
  }
  return out;
}
export async function install(client: Client, options: {home?: string; remove?: boolean; skillsOnly?: boolean} = {}) {
  if (!['codex', 'claude-code', 'hermes'].includes(client)) throw Error('Choose --client codex, claude-code or hermes.');
  const home = path.resolve(options.home ?? homedir());
  const stateDir = path.join(home, '.aisa/web-market');
  await noSymlinks(stateDir); await fs.mkdir(stateDir, {recursive: true});
  const lock = path.join(stateDir, 'install.lock');
  let fd;
  try { fd = await fs.open(lock, 'wx', 0o600); } catch { throw Error('Another setup is running. If it crashed, remove .aisa/web-market/install.lock after confirming no setup is active.'); }
  try {
    const stateFile = path.join(stateDir, `${client}.json`);
    await noSymlinks(stateFile);
    const previous = JSON.parse(await read(stateFile) ?? '{"files":{}}');
    const cfg = configFor(client, home);
    const root = skillRoot(client, home);
    const entry = {command: process.execPath, args: [path.join(packageRoot, 'dist/cli.js'), 'serve'], ...(client === 'codex' ? {env_vars: ['AISA_API_KEY']} : {})};
    const writes = new Map<string, string | undefined>();
    const next: any = {version: '0.1.0', files: {}, config: previous.config};
    const bundled = await skillFiles(path.join(packageRoot, 'skills', skillName));
    for (const relative of new Set([...Object.keys(bundled), ...Object.keys(previous.files)])) {
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('Invalid installer state path.');
      const content = bundled[relative];
      const file = path.join(root, relative); await noSymlinks(file);
      const current = await read(file);
      if (options.remove || content === undefined) {
        if (current !== undefined && previous.files[relative] === hash(current)) writes.set(file, undefined);
        else if (current !== undefined) throw Error(`Preserving modified or unowned skill: ${file}`);
      } else {
        if (current !== undefined && previous.files[relative] !== hash(current)) throw Error(`Preserving modified or unowned skill: ${file}`);
        writes.set(file, content); next.files[relative] = hash(content);
      }
    }
    if (!options.skillsOnly && (!options.remove || previous.config)) {
      await noSymlinks(cfg.file);
      const current = await read(cfg.file); let config: any;
      try { config = current?.trim() ? cfg.parse(current) : {}; } catch { throw Error('Client configuration could not be parsed; no files were changed.'); }
      if (typeof config !== 'object' || Array.isArray(config)) throw Error('Invalid client configuration.');
      config[cfg.key] ??= {};
      if (typeof config[cfg.key] !== 'object' || Array.isArray(config[cfg.key])) throw Error('Invalid MCP configuration section.');
      const existing = config[cfg.key][skillName];
      if (options.remove) {
        if (existing && JSON.stringify(existing) !== JSON.stringify(previous.config)) throw Error('MCP entry has been modified; preserving it.');
        delete config[cfg.key][skillName];
      } else {
        if (existing && JSON.stringify(existing) !== JSON.stringify(previous.config) && JSON.stringify(existing) !== JSON.stringify(entry)) throw Error('An unowned aisa-web-market MCP entry already exists; preserving it.');
        config[cfg.key][skillName] = entry; next.config = entry;
      }
      writes.set(cfg.file, cfg.stringify(config));
    }
    writes.set(stateFile, options.remove ? undefined : JSON.stringify(next, null, 2));
    const backups = new Map<string, string | undefined>();
    try {
      for (const [file, content] of writes) {
        backups.set(file, await read(file));
        if (content === undefined) await fs.rm(file, {force: true}); else await atomic(file, content);
      }
    } catch (e) {
      for (const [file, old] of [...backups].reverse()) {
        if (old === undefined) await fs.rm(file, {force: true}); else await atomic(file, old);
      }
      throw e;
    }
    return {client, skill: root, config: options.skillsOnly ? null : cfg.file, action: options.remove ? 'removed' : 'installed'};
  } finally { await fd.close(); await fs.rm(lock, {force: true}); }
}
