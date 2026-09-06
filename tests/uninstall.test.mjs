import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {PassThrough, Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {installedClients, install} from '../dist/install.js';
import {chooseUninstall, parseSelection} from '../dist/interactive.js';
const clients=['codex','claude-code','hermes'];
test('uninstall selections support multiple clients, all, cancellation and invalid input',()=>{
 assert.deepEqual(parseSelection('3,1,3',clients),['hermes','codex']);
 assert.deepEqual(parseSelection('0',clients),clients);
 for(const value of [''])assert.deepEqual(parseSelection(value,clients),[]);
 for(const value of ['4','-1','1x','0,1','all','cancel'])assert.throws(()=>parseSelection(value,clients));
});
test('interactive uninstall retries invalid selection and returns selected clients',async()=>{
 const input=new PassThrough();input.isTTY=true;let questions=0;let displayed='';
 const output=new Writable({write(chunk,encoding,done){
  displayed+=chunk.toString();
  if(chunk.toString().includes('Choose client numbers'))setImmediate(()=>input.write(++questions===1?'9\n':'1,3\n'));
  done();
 }});
 assert.deepEqual(await chooseUninstall(clients,{input,output}),['codex','hermes']);
 assert.ok(displayed.indexOf('0. Uninstall all') < displayed.indexOf('1. codex'));
 input.destroy();output.destroy();
});
test('uninstall discovers managed installations only; non-TTY does not remove anything',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-uninstall-')));
 try {
  await fs.mkdir(path.join(home,'.hermes'));
  assert.deepEqual(await installedClients(home),[]);
  await install('codex',{home});await install('claude-code',{home});
  assert.deepEqual(await installedClients(home),['codex','claude-code']);
  const result=spawnSync(process.execPath,['dist/cli.js','uninstall','--home',home],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.match(result.stderr,/requires a terminal/);
  assert.deepEqual(await installedClients(home),['codex','claude-code']);
  const explicit=spawnSync(process.execPath,['dist/cli.js','uninstall','--home',home,'--client','codex'],{encoding:'utf8',timeout:5000});
  assert.equal(explicit.status,0,explicit.stderr);assert.deepEqual(await installedClients(home),['claude-code']);
 } finally {await fs.rm(home,{recursive:true,force:true});}
});

import {cleanupUninstall} from '../dist/uninstall.js';
import {saveSession, authFile} from '../dist/oauth.js';
test('last uninstall removes OAuth, state and empty directories, preserves other user data',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-clean-')));
 try {
  await install('codex',{home});await install('hermes',{home});
  await fs.writeFile(path.join(home,'.hermes/keep.txt'),'user data');
  await saveSession(authFile(home),{client_id:'test-client',access_token:'test-access',refresh_token:'test-refresh',expires_at:1});
  let revoked=0;
  const fetcher=async(url,init)=>{revoked++;assert.equal(url,'https://clerk.aisa.one/oauth/token/revoke');assert.equal(init.body.get('token'),'test-refresh');return new Response(null,{status:200});};
  await install('codex',{home,remove:true});
  assert.equal((await cleanupUninstall(home,fetcher)).credentialsCleared,false);
  assert.equal(revoked,0);await fs.access(authFile(home));
  await install('hermes',{home,remove:true});
  assert.equal((await cleanupUninstall(home,fetcher)).credentialsCleared,true);
  assert.equal(revoked,1);
  await assert.rejects(fs.access(path.join(home,'.aisa')));
  await assert.rejects(fs.access(path.join(home,'.agents')));
  assert.equal(await fs.readFile(path.join(home,'.hermes/keep.txt'),'utf8'),'user data');
  await assert.rejects(fs.access(path.join(home,'.hermes/config.yaml')));
 } finally {await fs.rm(home,{recursive:true,force:true});}
});
test('orphan OAuth credentials can be cleaned even if remote revocation fails',async()=>{
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-orphan-')));
 try {
  await saveSession(authFile(home),{client_id:'c',access_token:'a',refresh_token:'r',expires_at:1});
  const result=await cleanupUninstall(home,async()=>{throw Error('offline');});
  assert.equal(result.credentialsCleared,true);assert.match(result.warning,/revocation/);
  assert.deepEqual(await fs.readdir(home),[]);
 } finally {await fs.rm(home,{recursive:true,force:true});}
});
