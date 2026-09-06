import {emitKeypressEvents} from 'node:readline';
import {authFile, readSession, login} from './oauth.js';

// Read from the terminal without echoing credentials or consuming MCP stdin.
export async function promptKey(): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw Error('AISA_API_KEY is missing. Run setup in an interactive terminal to save a key, or set AISA_API_KEY before running setup.');
  }
  process.stderr.write('Enter AISA_API_KEY (saved locally in the client MCP configuration; input hidden): ');
  const input = process.stdin;
  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      input.setRawMode(wasRaw);
      input.pause();
      process.stderr.write('\n');
      if (error) reject(error); else resolve(value.trim());
    };
    const onEnd = () => finish(Error('Key input ended; setup cancelled.'));
    const onError = () => finish(Error('Could not read key; setup cancelled.'));
    const onKey = (text: string | undefined, key: {name?: string; ctrl?: boolean; meta?: boolean}) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(Error('Setup cancelled.'));
      if (key.name === 'return' || key.name === 'enter') {
        if (!value.trim()) { process.stderr.write('\nKey cannot be empty. Enter AISA_API_KEY: '); return; }
        return finish();
      }
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (key.ctrl && key.name === 'u') { value = ''; return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
  });
}

export async function resolveSetupKey(savedKey?: string): Promise<string | undefined> {
  if (savedKey?.trim()) return savedKey;
  // Preserve the existing environment-based setup; only prompted keys are saved.
  if (process.env.AISA_API_KEY?.trim()) return undefined;
  return promptKey();
}

export function sharedSetupKeyResolver(resolve = resolveSetupKey) {
  let requested: Promise<string | undefined> | undefined;
  return (savedKey?: string): Promise<string | undefined> => {
    // Keep each client's existing credentials. Share only the newly requested key.
    if (savedKey?.trim()) return Promise.resolve(savedKey);
    return requested ??= resolve();
  };
}

export type SetupCredential = string | {oauthFile: string} | undefined;
export function setupCredentialResolver(options: {home?: string; auth?: string; noBrowser?: boolean}, io = {
  login, promptKey,
  interactive: () => Boolean(process.stdin.isTTY && process.stderr.isTTY),
  report: (message: string) => {process.stderr.write(message + '\n');},
}) {
  if (options.auth && !['oauth', 'key'].includes(options.auth)) throw Error('Choose --auth oauth or key.');
  let pending: Promise<SetupCredential> | undefined;
  const file = authFile(options.home);
  return (savedKey?: string): Promise<SetupCredential> => {
    if (!options.auth && savedKey?.trim()) return Promise.resolve(savedKey);
    if (!options.auth && process.env.AISA_API_KEY?.trim()) return Promise.resolve(undefined);
    return pending ??= (async () => {
      if (!options.auth && await readSession(file)) return {oauthFile: file};
      if (options.auth === 'key') return process.env.AISA_API_KEY?.trim() || await io.promptKey();
      if (!io.interactive()) throw Error('No credentials. Run setup in an interactive terminal for OAuth, or set AISA_API_KEY.');
      try {
        await io.login(file, options.noBrowser);
      } catch (error) {
        io.report(error instanceof Error ? error.message : 'OAuth login failed.');
        io.report('Use an API Key instead (Ctrl+C to cancel setup).');
        return await io.promptKey();
      }
      return {oauthFile: file};
    })();
  };
}
