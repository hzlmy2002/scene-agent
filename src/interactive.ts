import {createInterface} from 'node:readline';
import type {Client} from './install.js';

export function parseSelection(answer: string, clients: Client[]): Client[] {
  const value = answer.trim().toLowerCase();
  if (!value) return [];
  if (value === '0') return [...clients];
  const parts = value.split(/[\s,]+/);
  if (parts.some(part => !/^[1-9]\d*$/.test(part) || Number(part) > clients.length)) throw Error('Enter listed numbers (for example 1,2), 0 for all, or press Enter to cancel.');
  return [...new Set(parts.map(part => clients[Number(part) - 1]))];
}
export async function chooseUninstall(clients: Client[], io = {input: process.stdin, output: process.stderr}): Promise<Client[] | undefined> {
  if (!io.input.isTTY) throw Error('Interactive uninstall requires a terminal. For scripts, use uninstall --client codex|claude-code|hermes.');
  io.output.write('Remove AIsa Web Market MCP configuration and installed Skills from:\n');
  io.output.write('  0. Uninstall all and clear OAuth login / installation state\n');
  clients.forEach((client, index) => io.output.write(`  ${index + 1}. ${client}\n`));
  io.output.write('  Enter / Ctrl+C: Cancel\nRemoving the last client also clears OAuth login and installation state. Modified files will be preserved.\n');
  const rl = createInterface(io);
  try {
    return await new Promise<Client[] | undefined>((resolve, reject) => {
      rl.once('SIGINT', () => resolve(undefined));
      rl.once('close', () => resolve(undefined));
      rl.once('error', reject);
      const ask = () => rl.question('Choose client numbers, 0 for all, or Enter to cancel: ', answer => {
        try {const selected = parseSelection(answer, clients); resolve(answer.trim() === '0' || selected.length ? selected : undefined);}
        catch (error) {io.output.write(`${(error as Error).message}\n`); ask();}
      });
      ask();
    });
  } finally {rl.close(); io.input.pause();}
}
