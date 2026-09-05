import {build} from 'esbuild';
import {promises as fs} from 'node:fs';
import path from 'node:path';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const json = (p, x) => fs.writeFile(p, JSON.stringify(x, null, 2) + '\n');
for (const client of ['codex', 'claude-code', 'hermes']) {
  const root = path.resolve('plugins', client, 'aisa-web-market');
  await fs.mkdir(path.join(root, 'dist'), {recursive: true});
  await fs.cp('skills', path.join(root, 'skills'), {recursive: true});
  await fs.copyFile('README.md', path.join(root, 'README.md'));
  await json(path.join(root, 'package.json'), {name: `aisa-web-market-${client}`, version: pkg.version, type: 'module', private: true, engines: pkg.engines});
  await build({entryPoints: ['src/cli.ts'], outfile: path.join(root, 'dist/cli.js'), bundle: true, platform: 'node', target: 'node22', format: 'esm', banner: {js: "import {createRequire as aisaCreateRequire} from 'node:module'; const require = aisaCreateRequire(import.meta.url);"}, legalComments: 'eof'});
  const base = {name: 'aisa-web-market', version: pkg.version, description: pkg.description, author: {name: 'AIsa'}};
  const entry = {command: 'node', args: [`\${${client === 'claude-code' ? 'CLAUDE_PLUGIN_ROOT' : 'PLUGIN_ROOT'}}/dist/cli.js`, 'serve']};
  if (client === 'codex') {
    await fs.mkdir(path.join(root, '.codex-plugin'), {recursive: true});
    await json(path.join(root, '.codex-plugin/plugin.json'), {...base, skills: './skills/', mcpServers: './.mcp.json', interface: {displayName: 'AIsa Web Market', shortDescription: 'Website competitors, traffic and keyword gaps', longDescription: 'Five focused AIsa API tools with a website competitive analysis skill.', developerName: 'AIsa', category: 'Productivity', capabilities: ['Read'], defaultPrompt: ['Compare traffic and keyword samples for these websites.']}});
    await json(path.join(root, '.mcp.json'), {mcpServers: {'aisa-web-market': {...entry, env_vars: ['AISA_API_KEY']}}});
  } else if (client === 'claude-code') {
    await fs.mkdir(path.join(root, '.claude-plugin'), {recursive: true});
    await json(path.join(root, '.claude-plugin/plugin.json'), base);
    await json(path.join(root, '.mcp.json'), {mcpServers: {'aisa-web-market': {...entry, type: 'stdio', env: {AISA_API_KEY: '${AISA_API_KEY}'}}}});
  } else {
    await json(path.join(root, 'plugin.json'), {$schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...base});
    await json(path.join(root, 'mcp.json'), {$schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {'aisa-web-market': {...entry, type: 'stdio'}}});
  }
  console.log(root);
}
