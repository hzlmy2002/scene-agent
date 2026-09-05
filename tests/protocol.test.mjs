import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../dist/server.js';
test('real stdio initialize, exactly five tools, missing credential tool error',async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/cli.js','serve'],env:{PATH:process.env.PATH,AISA_API_KEY:''},stderr:'pipe'});
 const client=new Client({name:'test',version:'1'});
 try{await client.connect(transport);const list=await client.listTools();assert.equal(list.tools.length,5);assert.ok(list.tools.every(t=>t.outputSchema&&t.annotations.readOnlyHint));const r=await client.callTool({name:'AIsa_website_keywords',arguments:{domain:'site.com',month:'2026-06'}});assert.equal(r.isError,true);assert.ok(r.content[0].text.includes('missing_credentials'));}finally{await client.close();}
});
test('successful protocol call returns validated structured output',async()=>{
 const server=createServer({async get(){return {data:[{keyword:'example',position:4}]};}});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);
 const client=new Client({name:'test',version:'1'});
 try{await client.connect(b);const r=await client.callTool({name:'AIsa_website_keywords',arguments:{domain:'site.com',month:'2026-06'}});assert.ok(!r.isError);assert.equal(r.structuredContent.data[0].position,4);}finally{await client.close();await server.close();}
});
test('protocol rejects unsupported filter instead of silently stripping it',async()=>{
 const server=createServer({get(){assert.fail('invalid request must not reach API');}});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);const client=new Client({name:'test',version:'1'});
 try{await client.connect(b);const r=await client.callTool({name:'AIsa_website_keywords',arguments:{domain:'site.com',month:'2026-06',traffic_source:'organic'}});assert.equal(r.isError,true);}finally{await client.close();await server.close();}
});
test('first-start skill installation keeps stdout a valid MCP stream',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-first-start-')));
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/cli.js','serve','--install-skills','--client','hermes','--home',home],env:{PATH:process.env.PATH,AISA_API_KEY:''},stderr:'pipe'});
 const client=new Client({name:'first-start',version:'1'});
 try{await client.connect(transport);assert.equal((await client.listTools()).tools.length,5);assert.ok((await fs.readFile(path.join(home,'.hermes/skills/aisa-web-market/SKILL.md'),'utf8')).includes('aisa-web-market'));}finally{await client.close();await fs.rm(home,{recursive:true,force:true});}
});
