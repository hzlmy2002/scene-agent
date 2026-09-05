import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
// Build and relocate bundles outside this repo: no accidental dependency on its node_modules.
test('all plugin bundles run standalone with five tools after relocation',async()=>{
 execFileSync(process.execPath,['scripts/package-plugins.mjs']);
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'aisa-bundles-'));
 try{for(const host of ['codex','claude-code','hermes']){
 const root=path.join(tmp,host);await fs.cp(`plugins/${host}/aisa-web-market`,root,{recursive:true});
 const cfg=JSON.parse(await fs.readFile(path.join(root,host==='hermes'?'mcp.json':'.mcp.json'),'utf8'));
 const entry=cfg.mcpServers['aisa-web-market'];
 const args=entry.args.map(x=>x.replace('${PLUGIN_ROOT}',root).replace('${CLAUDE_PLUGIN_ROOT}',root));
 const client=new Client({name:'bundle-test',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args,cwd:tmp,env:{PATH:process.env.PATH,AISA_API_KEY:''},stderr:'pipe'});
 try{await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,5);for(const t of tools.tools){assert.equal(typeof t.inputSchema,'object');assert.equal(t.inputSchema.additionalProperties,false);}}finally{await client.close();}
 }}finally{await fs.rm(tmp,{recursive:true,force:true});}
});
