'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runSessionProbe,safeURL,revoked}=require('../lib/session-probe');
const BASE='https://cinemacity.cc',action=BASE+'/index.php?do=register';
const form='<form data-cc-login-form method="post" action="/index.php?do=register"><input name="login_name"><input name="login_password"><input name="login" type="hidden" value="submit"></form>';
const user='<script>window.CCDeviceGuardRuntime={authenticated:true};</script>',guest='<script>window.CCDeviceGuardRuntime={authenticated:false};</script>';
function fixture({challenge=false,verified=true}={}){
  const calls={closed:0,post:0,typed:0,fetches:0},handlers={},frame={};let homes=0,resolvePost;
  function response(url,body,status=200,headers={}){return {url:()=>url,status:()=>status,headers:()=>headers,buffer:async()=>Buffer.from(body),request:()=>({method:()=> 'POST'})};}
  const page={
    setRequestInterception:async()=>{},on:(type,fn)=>{handlers[type]=fn;},mainFrame:()=>frame,
    goto:async(url)=>{assert.ok(url.startsWith(BASE));if(challenge)return response(url,'<title>Just a moment</title>',403,{'cf-mitigated':'challenge',server:'cloudflare'});
      if(url.endsWith('/robots.txt'))return response(url,'User-agent: *');homes++;return response(url,homes===1?guest+form:(verified?user:guest));},
    title:async()=>challenge?'Just a moment...':'CinemaCity',$:async()=>null,
    type:async(selector,value)=>{calls.typed++;assert.ok(['synthetic-user','synthetic-password'].includes(value));},
    waitForResponse:()=>new Promise(resolve=>{resolvePost=resolve;}),
    $eval:async(selector,fn)=>{
      if(fn.toString().includes('requestSubmit')){
        const req={url:()=>action,method:()=> 'POST',redirectChain:()=>[],continue:async()=>{calls.post++;},abort:async()=>{throw Error('unexpected rejection');}};
        await handlers.request(req);resolvePost(response(action,user));return;
      }
      return {method:'post',action,hidden:'submit',username:true,password:true};
    },
    evaluate:async(fn,args)=>{calls.fetches++;if(args.url.endsWith('/news_pages.xml'))return {kind:'ok',text:`<urlset><url><loc>${BASE}/tv-series/1-tulsa-king-2022.html</loc></url></urlset>`};
      return {kind:'ok',text:user+`<script>atob('${Buffer.from('file: [{title:"Season 1",folder:[{title:"Episode 1",file:"https://fixture.test/video.m3u8"}]}]').toString('base64')}')</script>`};}
  };
  return {calls,launch:async()=>({version:async()=> 'HeadlessChrome/153.0.8010.0',newPage:async()=>page,close:async()=>{calls.closed++;}})};
}
test('missing credentials do not launch a browser',async()=>{const r=await runSessionProbe({launch:()=>{throw Error('must not run');}});assert.equal(r.kind,'missing_credentials');assert.equal(r.credentialsSubmitted,false);});
test('a challenge before login never submits credentials and closes the browser',async()=>{
  const {launch,calls}=fixture({challenge:true});const r=await runSessionProbe({launch,username:'synthetic-user',password:'synthetic-password'});
  assert.equal(r.kind,'cloudflare_challenge');assert.equal(r.stage,'login_form');assert.equal(r.credentialsSubmitted,false);assert.equal(calls.post,0);assert.equal(calls.typed,0);assert.equal(calls.closed,1);assert.ok(r.checkedAt);
});
test('a normal login is verified afresh before fetching catalog and counting streams',async()=>{
  const {launch,calls}=fixture();const r=await runSessionProbe({launch,username:'synthetic-user',password:'synthetic-password'});
  assert.equal(r.kind,'session_and_stream_verified');assert.equal(r.credentialsSubmitted,true);assert.equal(r.authenticated,true);assert.equal(r.streamCount,1);assert.equal(calls.post,1);assert.equal(calls.fetches,2);assert.equal(calls.closed,1);
  assert.doesNotMatch(JSON.stringify(r),/synthetic-user|synthetic-password|fixture.test|cookie=/);
});
test('a completed POST does not prove authentication',async()=>{
  const {launch,calls}=fixture({verified:false});const r=await runSessionProbe({launch,username:'synthetic-user',password:'synthetic-password'});
  assert.equal(r.kind,'session_unconfirmed');assert.equal(r.authenticated,false);assert.equal(calls.post,1);assert.equal(calls.fetches,0);assert.equal(calls.closed,1);
});
test('only the exact secure site can receive account traffic',()=>{
  assert.equal(safeURL(BASE+'/'),true);for(const url of ['http://cinemacity.cc/','https://u:p@cinemacity.cc/','https://foreign.test/'])assert.equal(safeURL(url),false);
  assert.equal(revoked(BASE+'/?cc_device_guard=device_revoked'),true);
});
