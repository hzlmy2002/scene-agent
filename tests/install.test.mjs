import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {install} from '../dist/install.js';
import TOML from '@iarna/toml';
import YAML from 'yaml';
for(const client of ['codex','claude-code','hermes']) test(`${client}: install, idempotent update, preserve other config, uninstall`,async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-install-')));
 try{
 const cfg=client==='codex'?'.codex/config.toml':client==='hermes'?'.hermes/config.yaml':'.claude.json';
 const file=path.join(home,cfg);await fs.mkdir(path.dirname(file),{recursive:true});
 const other={unrelated:'keep',...(client==='claude-code'?{mcpServers:{other:{command:'other'}}}:{mcp_servers:{other:{command:'other'}}})};
 const encode=client==='codex'?TOML.stringify:client==='hermes'?YAML.stringify:JSON.stringify;
 const decode=client==='codex'?TOML.parse:client==='hermes'?YAML.parse:JSON.parse;
 await fs.writeFile(file,encode(other));
 const result=await install(client,{home});await install(client,{home});
 assert.equal(decode(await fs.readFile(file,'utf8')).unrelated,'keep');
 assert.ok((await fs.readFile(path.join(result.skill,'SKILL.md'),'utf8')).includes('aisa-web-market'));
 await install(client,{home,remove:true});
 assert.deepEqual(JSON.parse(JSON.stringify(decode(await fs.readFile(file,'utf8')))),other);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
test('new empty client config installs and modified skills are never overwritten',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-install-')));
 try{const r=await install('claude-code',{home});const skill=path.join(r.skill,'SKILL.md');await fs.writeFile(skill,'user edit');await assert.rejects(install('claude-code',{home}),/Preserving/);await assert.rejects(install('claude-code',{home,remove:true}),/Preserving/);assert.equal(await fs.readFile(skill,'utf8'),'user edit');}finally{await fs.rm(home,{recursive:true,force:true});}
});
test('symlink destination is refused',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-install-')));
 try{await fs.mkdir(path.join(home,'elsewhere'));await fs.symlink(path.join(home,'elsewhere'),path.join(home,'.agents'));await assert.rejects(install('codex',{home}),/symbolic link/);}finally{await fs.rm(home,{recursive:true,force:true});}
});
test('an identical but unowned skill is not adopted and later deleted',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-install-')));
 try{const target=path.join(home,'.agents/skills/aisa-web-market');await fs.mkdir(target,{recursive:true});await fs.copyFile('skills/aisa-web-market/SKILL.md',path.join(target,'SKILL.md'));await assert.rejects(install('codex',{home}),/unowned/);}finally{await fs.rm(home,{recursive:true,force:true});}
});
test('npm/npx installs persist a pinned command rather than disposable cache paths',async()=>{
 const {launchEntry}=await import('../dist/install.js');
 for(const client of ['codex','claude-code','hermes']){
 const entry=launchEntry(client,path.join('/temporary','npm-cache','_npx','hash','node_modules','@aisa','web-market'));
 assert.equal(entry.command,process.platform==='win32'?'npx.cmd':'npx');
 assert.deepEqual(entry.args,['-y','@hzlmy2002/web-market@0.1.2','serve']);
 assert.ok(!JSON.stringify(entry).includes('npm-cache'));
 }
});
for(const client of ['codex','claude-code','hermes']) test(`${client}: saved key survives setup and is absent from installer state`,async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-key-')));
 try{
 const fake='test-only-credential';
 const result=await install(client,{home,resolveKey:async saved=>{assert.equal(saved,undefined);return fake;}});
 const decode=client==='codex'?TOML.parse:client==='hermes'?YAML.parse:JSON.parse;
 const config=decode(await fs.readFile(result.config,'utf8'));
 const entry=(config.mcp_servers??config.mcpServers)['aisa-web-market'];
 assert.deepEqual(entry.env,{AISA_API_KEY:fake});assert.equal(entry.env_vars,undefined);
 assert.ok(!(await fs.readFile(path.join(home,'.aisa/web-market',`${client}.json`),'utf8')).includes(fake));
 await install(client,{home,resolveKey:async saved=>{assert.equal(saved,fake);return saved;}});
 await install(client,{home});
 await install(client,{home,remove:true});
 await assert.rejects(fs.access(result.config), {code:'ENOENT'});
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
test('cancelled credential prompt does not install skills or config',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-cancel-')));
 try{
 await assert.rejects(install('codex',{home,resolveKey:async()=>{throw Error('Setup cancelled.');}}),/cancelled/);
 await assert.rejects(fs.access(path.join(home,'.codex/config.toml')));
 await assert.rejects(fs.access(path.join(home,'.agents/skills/aisa-web-market/SKILL.md')));
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
test('CLI fails promptly without a terminal/key and supports environment-based setup',async()=>{
 const {spawnSync}=await import('node:child_process');
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-cli-key-')));
 const env={...process.env};delete env.AISA_API_KEY;
 try{
 const args=['dist/cli.js','setup','--client','codex','--home',home];
 const missing=spawnSync(process.execPath,args,{env,encoding:'utf8',timeout:5000});
 assert.equal(missing.status,1);assert.match(missing.stderr,/interactive terminal/);
 const configured=spawnSync(process.execPath,args,{env:{...env,AISA_API_KEY:'environment-test-key'},encoding:'utf8',timeout:5000});
 assert.equal(configured.status,0,configured.stderr);
 const content=await fs.readFile(path.join(home,'.codex/config.toml'),'utf8');
 assert.ok(!content.includes('environment-test-key'));assert.match(content,/env_vars/);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
