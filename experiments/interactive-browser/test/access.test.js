'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{once}=require('node:events');
const {WebSocket}=require('ws'),{createServer}=require('../server');
const {validKey,validOrigin,allowedURL,command,authenticated,control}=require('../controller');
const key='a'.repeat(43),config={hash:createHash('sha256').update(key).digest('hex'),expires:Date.now()+3600000};
test('secret and deadline are required; comparison does not accept malformed values',()=>{
  assert.equal(validKey(key,config),true);for(const value of ['',null,['a'],'b'.repeat(43)])assert.equal(validKey(value,config),false);
  assert.equal(validKey(key,config,config.expires),false);
});
test('only same host browser origins may open a control connection',()=>{
  assert.ok(validOrigin('https://preview.vercel.app','preview.vercel.app'));assert.equal(validOrigin('https://evil.example','preview.vercel.app'),false);assert.equal(validOrigin(undefined,'preview.vercel.app'),false);
});
test('navigation is limited to CinemaCity, with HTTPS verification resources allowed',()=>{
  assert.ok(allowedURL('https://cinemacity.cc/index.php?do=register',true));
  assert.ok(allowedURL('https://challenges.cloudflare.com/turnstile/v0/x',false));
  for(const url of ['file:///etc/passwd','http://cinemacity.cc/','https://127.0.0.1/','https://cinemacity.cc.evil.test/','https://u:p@cinemacity.cc/','https://cinemacity.cc:444/'])assert.equal(allowedURL(url),false);
  assert.equal(allowedURL('https://challenges.cloudflare.com/',true),false);
});
test('control protocol rejects arbitrary evaluation, URLs, cookie access and invalid coordinates',()=>{
  for(const value of [{type:'eval',script:'anything'},{type:'cookies'},{type:'goto',url:'https://evil.test'},{type:'key',key:'F12'},{type:'text',text:'x'.repeat(2049)},{type:'click',x:-1,y:0},{type:'click',x:0,y:720},null])assert.throws(()=>command(value));
  assert.deepEqual(command({type:'scroll',delta:9999}),{type:'scroll',delta:720});
});
test('verification reads an explicit server-authentication marker, not the page title',()=>{
  assert.equal(authenticated('<title>Welcome</title>'),null);assert.equal(authenticated('window.CCDeviceGuardRuntime={authenticated:true};'),true);assert.equal(authenticated('window.CCDeviceGuardRuntime={authenticated:false};'),false);
});
test('manual typed text is delivered only to the focused remote field',async()=>{
  const received=[];await control({keyboard:{insertText:async text=>received.push(text)}},{type:'text',text:'synthetic-test-value'});assert.deepEqual(received,['synthetic-test-value']);
});
async function fixture(t){
  const calls={launched:0,closed:0,text:[],screenshot:0};const keyboard={insertText:async text=>calls.text.push(text),press:async()=>{}};
  const page={setViewport:async()=>{},setRequestInterception:async()=>{},on:()=>{},setJavaScriptEnabled:async()=>{},goto:async()=>{},content:async()=> 'window.CCDeviceGuardRuntime={authenticated:true};',keyboard,mouse:{click:async()=>{},wheel:async()=>{}},screenshot:async()=>{calls.screenshot++;return Buffer.from('synthetic-jpeg');}};
  const server=createServer({config,sessionMs:10000,idleMs:10000,launch:async()=>{calls.launched++;return {newPage:async()=>page,version:async()=> 'Chrome/synthetic',on:()=>{},close:async()=>{calls.closed++;}};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port,origin='http://127.0.0.1:'+port;
  t.after(()=>new Promise(resolve=>server.close(resolve)));return {server,calls,origin,url:'ws://127.0.0.1:'+port+'/remote'};
}
test('HTTP exposes only the interface; config and source are not downloadable',async t=>{
  const f=await fixture(t);for(const p of ['/config.json','/server.js','/.env']){const r=await fetch(f.origin+p);assert.equal(r.status,404);}
  const r=await fetch(f.origin+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(f.calls.launched,0);
});
test('wrong key closes WebSocket without starting Chromium',async t=>{
  const f=await fixture(t),ws=new WebSocket(f.url,{origin:f.origin});await once(ws,'open');ws.send(JSON.stringify({type:'auth',key:'b'.repeat(43)}));await once(ws,'close');assert.equal(f.calls.launched,0);
});
test('authenticated WebSocket connects to one browser, receives frames and verifies the session',async t=>{
  const f=await fixture(t),ws=new WebSocket(f.url,{origin:f.origin});t.after(()=>ws.terminate());const messages=[];
  const ready=new Promise(resolve=>ws.on('message',b=>{const m=JSON.parse(b);messages.push(m);if(m.type==='ready')resolve();}));
  await once(ws,'open');ws.send(JSON.stringify({type:'auth',key}));await ready;
  const verified=new Promise(resolve=>ws.on('message',b=>{if(JSON.parse(b).type==='verification')resolve(JSON.parse(b));}));
  ws.send(JSON.stringify({type:'text',text:'synthetic-test-value'}));ws.send(JSON.stringify({type:'verify'}));assert.equal((await verified).authenticated,true);
  const frame=new Promise(resolve=>ws.on('message',b=>{if(JSON.parse(b).type==='frame')resolve(JSON.parse(b));}));assert.match((await frame).image,/^data:image\/jpeg;base64,/);
  ws.send(JSON.stringify({type:'close'}));await once(ws,'close');assert.equal(f.calls.launched,1);assert.equal(f.calls.closed,1);assert.deepEqual(f.calls.text,['synthetic-test-value']);assert.ok(!JSON.stringify(messages).includes(key));assert.ok(!JSON.stringify(messages).includes('synthetic-test-value'));
});
