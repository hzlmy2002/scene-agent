import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {accessToken, authFile, callbackCode, readSession, saveSession, tokenSession} from '../dist/oauth.js';
import {setupCredentialResolver} from '../dist/credentials.js';
import {install} from '../dist/install.js';
import {ApiClient, paths} from '../dist/api.js';
async function profile(run) {
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'aisa-oauth-')));
 try {await run(home,authFile(home));} finally {await fs.rm(home,{recursive:true,force:true});}
}
const session = {client_id:'test-client',access_token:'test-access',refresh_token:'test-refresh',expires_at:0};
test('manual callback requires full matching URL, state and unique code',()=>{
 const redirect='http://127.0.0.1:49173/callback';
 assert.equal(callbackCode(redirect+'?code=abc&state=expected',redirect,'expected'),'abc');
 for(const input of ['abc',redirect+'?code=abc',redirect+'?code=abc&state=wrong','http://127.0.0.1:1/callback?code=abc&state=expected',redirect+'?code=a&code=b&state=expected',redirect+'?code=a&state=expected&iss=https://evil.example',redirect+'?error=access_denied&state=expected']) assert.throws(()=>callbackCode(input,redirect,'expected'));
});
test('concurrent processes sharing a file refresh once and keep rotated tokens',()=>profile(async(home,file)=>{
 await saveSession(file,session);let calls=0;
 const fetcher=async(url,init)=>{
   calls++;assert.equal(url,'https://clerk.aisa.one/oauth/token');
   assert.equal(init.body.get('grant_type'),'refresh_token');assert.equal(init.body.get('refresh_token'),'test-refresh');
   assert.equal(init.body.get('client_id'),'test-client');assert.equal(init.body.has('client_secret'),false);
   await new Promise(r=>setTimeout(r,25));
   return Response.json({token_type:'Bearer',access_token:'next-access',refresh_token:'next-refresh',expires_in:3600});
 };
 assert.deepEqual(await Promise.all([accessToken(file,fetcher),accessToken(file,fetcher),accessToken(file,fetcher)]),['next-access','next-access','next-access']);
 assert.equal(calls,1);assert.equal((await readSession(file)).refresh_token,'next-refresh');
 if(process.platform!=='win32') assert.equal((await fs.stat(file)).mode&0o777,0o600);
 await assert.rejects(fs.access(file+'.lock'));
}));
test('refresh failure preserves credentials, releases lock and never exposes provider body',()=>profile(async(home,file)=>{
 await saveSession(file,session);
 await assert.rejects(accessToken(file,async()=>new Response('test-secret-detail',{status:400})),e=>e.message.includes('400')&&!e.message.includes('test-secret-detail'));
 assert.deepEqual(await readSession(file),session);await assert.rejects(fs.access(file+'.lock'));
}));
test('valid tokens do not refresh; absent refresh token requires login after expiry',()=>profile(async(home,file)=>{
 assert.equal(await accessToken(file),undefined);
 await saveSession(file,{...session,expires_at:Date.now()+3600000});
 assert.equal(await accessToken(file,()=>{throw Error('unexpected network');}),'test-access');
 await saveSession(file,{...session,refresh_token:undefined});
 await assert.rejects(accessToken(file),/expired/);
}));
test('token responses are validated and optional refresh token preserves old one',()=>{
 assert.equal(tokenSession('c',{token_type:'bearer',access_token:'new',expires_in:3600},session).refresh_token,'test-refresh');
 assert.throws(()=>tokenSession('c',{token_type:'Bearer',access_token:'new',expires_in:-1}));
 assert.throws(()=>tokenSession('c',{token_type:'Basic',access_token:'new',expires_in:3600}));
});
test('OAuth configuration shares file across all clients and removes saved API Key',()=>profile(async(home,file)=>{
 await saveSession(file,{...session,expires_at:Date.now()+3600000});
 const savedEnv=process.env.AISA_API_KEY;delete process.env.AISA_API_KEY;
 try {
 const resolve=setupCredentialResolver({home});
 for(const client of ['codex','claude-code','hermes']) {
   await install(client,{home,resolveKey:async()=> 'old-key'});
   const result=await install(client,{home,resolveKey:async()=>resolve()});
   const text=await fs.readFile(result.config,'utf8');
   assert.match(text,/AISA_AUTH_FILE/);assert.ok(text.includes(file));assert.ok(!text.includes('old-key'));assert.ok(!text.includes('test-access'));
   await install(client,{home,resolveKey:resolve});
 }
 } finally {if(savedEnv===undefined)delete process.env.AISA_API_KEY;else process.env.AISA_API_KEY=savedEnv;}
}));
test('API requests use configured OAuth token even when parent exports a key',()=>profile(async(home,file)=>{
 await saveSession(file,{...session,expires_at:Date.now()+3600000});
 const before={key:process.env.AISA_API_KEY,file:process.env.AISA_AUTH_FILE};
 process.env.AISA_API_KEY='old-env-key';process.env.AISA_AUTH_FILE=file;
 try {
   const api=new ApiClient(undefined,async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer test-access');return Response.json({data:[]});});
   await api.get(paths.geography,{domain:'example.com'});
 } finally {
   if(before.key===undefined)delete process.env.AISA_API_KEY;else process.env.AISA_API_KEY=before.key;
   if(before.file===undefined)delete process.env.AISA_AUTH_FILE;else process.env.AISA_AUTH_FILE=before.file;
 }
}));

import {PassThrough, Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {login} from '../dist/oauth.js';
for (const manual of [true,false]) test(`OAuth login completes via ${manual?'pasted URL':'HTTP callback'} with PKCE`,()=>profile(async(home,file)=>{
 const input=new PassThrough();input.isTTY=true;
 let authorization, registered, launched=0, requests=0, callbackRequest;
 const output=new Writable({write(chunk,encoding,done){
   const match=chunk.toString().match(/https:\/\/clerk\.aisa\.one\/oauth\/authorize\?[^\s]+/);
   if(match){
     authorization=new URL(match[0]);
     const callback=new URL(authorization.searchParams.get('redirect_uri'));
     callback.search=new URLSearchParams({code:'test-code',state:authorization.searchParams.get('state')}).toString();
     if(manual) setImmediate(()=>input.write(callback.href+'\n'));
     else callbackRequest=fetch(callback).then(response=>assert.equal(response.status,200));
   }
   done();
 }});
 const fetcher=async(url,init)=>{
   requests++;
   if(url.endsWith('oauth-authorization-server')) return Response.json({issuer:'https://clerk.aisa.one',registration_endpoint:'https://clerk.aisa.one/oauth/register',authorization_endpoint:'https://clerk.aisa.one/oauth/authorize',token_endpoint:'https://clerk.aisa.one/oauth/token',code_challenge_methods_supported:['S256']});
   if(url.endsWith('/register')) {registered=JSON.parse(init.body);return Response.json({client_id:'test-client',token_endpoint_auth_method:'none'});}
   assert.ok(url.endsWith('/token'));
   assert.equal(init.body.get('redirect_uri'),registered.redirect_uris[0]);
   assert.equal(init.body.get('code'),'test-code');
   assert.equal(init.body.get('grant_type'),'authorization_code');
   assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
   assert.equal(init.body.has('client_secret'),false);
   return Response.json({token_type:'Bearer',access_token:'test-access',refresh_token:'test-refresh',expires_in:3600});
 };
 await login(file,manual,{input,output,fetcher,launch(){launched++;}});
 if(callbackRequest)await callbackRequest;
 assert.equal(launched,manual?0:1);assert.equal(requests,3);
 assert.equal(registered.token_endpoint_auth_method,'none');
 assert.equal((await readSession(file)).refresh_token,'test-refresh');
 input.destroy();output.destroy();
}));

test('fresh setup starts OAuth immediately once, with API Key fallback on failure',()=>profile(async(home,file)=>{
 const old=process.env.AISA_API_KEY;delete process.env.AISA_API_KEY;
 try {
   let logins=0,keys=0;
   const io={interactive:()=>true,report:()=>{},login:async()=>{logins++;},promptKey:async()=>{keys++;return 'fallback-key';}};
   const resolver=setupCredentialResolver({home},io);
   assert.deepEqual(await resolver(),{oauthFile:file});assert.deepEqual(await resolver(),{oauthFile:file});
   assert.equal(logins,1);assert.equal(keys,0);
   const fallback=setupCredentialResolver({home},{...io,login:async()=>{logins++;throw Error('OAuth unavailable');}});
   assert.equal(await fallback(),'fallback-key');assert.equal(await fallback(),'fallback-key');assert.equal(keys,1);
   const explicit=setupCredentialResolver({home,auth:'key'},io);
   assert.equal(await explicit(),'fallback-key');assert.equal(logins,2);
 } finally {if(old===undefined)delete process.env.AISA_API_KEY;else process.env.AISA_API_KEY=old;}
}));

test('typing key exits OAuth callback wait without exchanging a token',()=>profile(async(home,file)=>{
 const input=new PassThrough();input.isTTY=true;let requests=0;
 const output=new Writable({write(chunk,encoding,done){
   if(chunk.toString().includes('Paste callback URL:'))setImmediate(()=>input.write('key\n'));
   done();
 }});
 const fetcher=async(url)=>{
   requests++;
   if(url.endsWith('oauth-authorization-server'))return Response.json({issuer:'https://clerk.aisa.one',registration_endpoint:'https://clerk.aisa.one/oauth/register',authorization_endpoint:'https://clerk.aisa.one/oauth/authorize',token_endpoint:'https://clerk.aisa.one/oauth/token',code_challenge_methods_supported:['S256']});
   return Response.json({client_id:'test-client',token_endpoint_auth_method:'none'});
 };
 await assert.rejects(login(file,true,{input,output,fetcher,launch(){}}),/Switched to API Key/);
 assert.equal(requests,2);assert.equal(await readSession(file),undefined);
 input.destroy();output.destroy();
}));
