import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {detectClients} from '../dist/install.js';
import {sharedSetupKeyResolver} from '../dist/credentials.js';
async function profile(run) {
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-auto-')));
 try {await run(home);} finally {await fs.rm(home,{recursive:true,force:true});}
}
function setup(home,extra=[]) {
 return spawnSync(process.execPath,['dist/cli.js','setup','--home',home,...extra],{encoding:'utf8',timeout:5000,env:{...process.env,AISA_API_KEY:'test-environment-key'}});
}
test('detects none, single, multiple and all clients; ignores shared skills and wrong marker types',()=>profile(async home=>{
 await fs.mkdir(path.join(home,'.agents'));
 await fs.writeFile(path.join(home,'.codex'),'not a directory');
 assert.deepEqual(await detectClients(home),[]);
 await fs.writeFile(path.join(home,'.claude.json'),'{}');
 assert.deepEqual(await detectClients(home),['claude-code']);
 await fs.mkdir(path.join(home,'.claude'));
 await fs.mkdir(path.join(home,'.hermes'));
 assert.deepEqual(await detectClients(home),['claude-code','hermes']);
 await fs.rm(path.join(home,'.codex'));await fs.mkdir(path.join(home,'.codex'));
 assert.deepEqual(await detectClients(home),['codex','claude-code','hermes']);
}));
test('automatic CLI installs all detected clients and reruns successfully',()=>profile(async home=>{
 for(const dir of ['.codex','.claude','.hermes']) await fs.mkdir(path.join(home,dir));
 for(let i=0;i<2;i++){
 const result=setup(home);assert.equal(result.status,0,result.stderr);
 const lines=result.stdout.split('\n').filter(line=>line.startsWith('{')).map(JSON.parse);
 assert.deepEqual(lines.map(x=>x.client),['codex','claude-code','hermes']);
 for(const item of lines){await fs.access(item.config);await fs.access(path.join(item.skill,'SKILL.md'));}
 }
}));
test('no detection leaves home untouched; explicit client works without detection',()=>profile(async home=>{
 const result=setup(home);assert.equal(result.status,1);assert.match(result.stderr,/No supported clients detected/);
 assert.deepEqual(await fs.readdir(home),[]);
 assert.equal(setup(home,['--client','hermes']).status,0);
 await assert.rejects(fs.access(path.join(home,'.codex')));
}));
test('one client failure does not block other detected clients',()=>profile(async home=>{
 await fs.mkdir(path.join(home,'.codex'));await fs.mkdir(path.join(home,'.hermes'));
 await fs.writeFile(path.join(home,'.codex/config.toml'),'invalid = [');
 const result=setup(home);assert.equal(result.status,1);assert.match(result.stderr,/codex:.*parsed/);
 assert.match(result.stdout,/"client":"hermes"/);
 assert.equal(await fs.readFile(path.join(home,'.codex/config.toml'),'utf8'),'invalid = [');
}));
test('credential prompt is shared once while existing client keys are preserved',async()=>{
 let prompts=0;const resolve=sharedSetupKeyResolver(async()=>{prompts++;return 'new-test-key';});
 assert.equal(await resolve('saved-test-key'),'saved-test-key');
 assert.equal(await resolve(),'new-test-key');assert.equal(await resolve(),'new-test-key');
 assert.equal(await resolve('different-saved-key'),'different-saved-key');assert.equal(prompts,1);
 const cancelled=sharedSetupKeyResolver(async()=>{throw Error('cancelled');});
 await assert.rejects(cancelled(),/cancelled/);await assert.rejects(cancelled(),/cancelled/);
});
