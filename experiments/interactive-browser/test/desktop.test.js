'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),{once}=require('node:events'),{createHash}=require('node:crypto');
const {WebSocket}=require('ws'),{createServer,staticFile}=require('../server'),{browserArgs,childEnv}=require('../desktop'),{validKey}=require('../access');
const key='x'.repeat(43),config={hash:createHash('sha256').update(key).digest('hex'),expires:Date.now()+3600000};
test('browser starts directly, with a dedicated profile and no automation/debugging flags',()=>{
  const args=browserArgs('/tmp/test-profile');assert.ok(args.includes('--user-data-dir=/tmp/test-profile'));assert.ok(args.includes('--app=https://cinemacity.cc/'));assert.doesNotMatch(args.join(' '),/headless|automation|remote-debugging|webdriver/i);
});
test('desktop processes do not inherit private environment variables',()=>{
  process.env.CC_DESKTOP_TEST_SECRET='synthetic';const env=childEnv('/tmp/profile',':91');assert.equal(env.CC_DESKTOP_TEST_SECRET,undefined);assert.equal(env.HOME,'/tmp/profile');assert.equal(env.DISPLAY,':91');delete process.env.CC_DESKTOP_TEST_SECRET;
});
test('only the interface and noVNC JavaScript modules are served',()=>{
  assert.ok(staticFile('/novnc/core/rfb.js'));assert.ok(staticFile('/novnc/vendor/pako/lib/zlib/inflate.js'));
  for(const url of ['/config.json','/server.js','/.env','/novnc/core/../../server.js','/novnc/core/rfb.js?anything','/node_modules/ws/package.json'])assert.equal(staticFile(url),null);
});
test('secret expires and malformed credentials do not authenticate',()=>{assert.equal(validKey(key,config),true);assert.equal(validKey(key,config,config.expires),false);assert.equal(validKey('bad',config),false);});
async function setup(t,overrides={}){
  let launched=0,closed=0,resolveCleanup;const cleaned=new Promise(resolve=>{resolveCleanup=resolve;});
  const received=[];const tcp=net.createServer(socket=>{socket.write('RFB 003.008\n');socket.on('data',b=>{received.push(b.toString());socket.write(b);});});tcp.listen(0,'127.0.0.1');await once(tcp,'listening');
  const server=createServer({config,sessionMs:10000,launch:async()=>{launched++;return {port:tcp.address().port,close:async()=>{closed++;resolveCleanup();}};},...overrides});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>tcp.close(r));});
  return {origin,url:'ws://127.0.0.1:'+server.address().port+'/desktop',received,cleaned,launched:()=>launched,closed:()=>closed};
}
test('GET cannot launch a desktop or download config',async t=>{const f=await setup(t);assert.equal((await fetch(f.origin+'/')).status,200);assert.equal((await fetch(f.origin+'/config.json')).status,404);assert.equal(f.launched(),0);});
test('wrong key closes the connection without creating a desktop',async t=>{const f=await setup(t),ws=new WebSocket(f.url,{origin:f.origin});await once(ws,'open');ws.send(JSON.stringify({type:'auth',key:'y'.repeat(43)}));await once(ws,'close');assert.equal(f.launched(),0);});
test('cross-origin control connections are rejected before upgrade',async t=>{
  const f=await setup(t),ws=new WebSocket(f.url,{origin:'https://evil.example'});ws.on('error',()=>{});const rejected=new Promise(resolve=>ws.on('unexpected-response',(req,res)=>{res.resume();ws.terminate();resolve(res.statusCode);}));assert.equal(await rejected,403);assert.equal(f.launched(),0);
});
test('authenticated connection relays binary VNC data and destroys its desktop on disconnect',async t=>{
  const f=await setup(t),ws=new WebSocket(f.url,{origin:f.origin});t.after(()=>ws.terminate());
  const ready=new Promise(resolve=>ws.on('message',(b,binary)=>{if(!binary&&JSON.parse(b).type==='ready')resolve(JSON.parse(b));}));
  await once(ws,'open');ws.send(JSON.stringify({type:'auth',key}));assert.equal((await ready).mode,'conventional_desktop');
  const banner=once(ws,'message');ws.send(JSON.stringify({type:'begin'}));assert.equal((await banner)[0].toString(),'RFB 003.008\n');
  const echo=once(ws,'message');ws.send(Buffer.from('synthetic-input'));assert.equal((await echo)[0].toString(),'synthetic-input');
  ws.close();await once(ws,'close');await f.cleaned;assert.equal(f.launched(),1);assert.equal(f.closed(),1);assert.deepEqual(f.received,['synthetic-input']);
});
test('connection deadline terminates the desktop',async t=>{
  const f=await setup(t,{sessionMs:100}),ws=new WebSocket(f.url,{origin:f.origin});await once(ws,'open');ws.send(JSON.stringify({type:'auth',key}));await once(ws,'close');await f.cleaned;assert.equal(f.closed(),1);
});
