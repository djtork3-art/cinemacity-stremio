'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runSessionProbe,safeURL,revoked,verificationResource}=require('../lib/session-probe');
const BASE='https://cinemacity.cc',action=BASE+'/index.php?do=register';
const form='<form data-cc-login-form method="post" action="/index.php?do=register"><input name="login_name"><input name="login_password"><input name="login" type="hidden" value="submit"></form>';
const user='<script>window.CCDeviceGuardRuntime={authenticated:true};</script>',guest='<script>window.CCDeviceGuardRuntime={authenticated:false};</script>';
function fixture({challenge=false,verified=true,automatic=false}={}){
  const calls={closed:0,post:0,typed:0,fetches:0,waited:0,verificationPosts:0},handlers={},frame={};let homes=0,resolvePost,currentBody='',currentURL=BASE+'/',challengeActive=challenge;
  function response(url,body,status=200,headers={},method='GET'){return {url:()=>url,status:()=>status,headers:()=>headers,buffer:async()=>Buffer.from(body),request:()=>({method:()=>method,isNavigationRequest:()=>method==='GET',frame:()=>frame})};}
  const page={
    setRequestInterception:async()=>{},on:(type,fn)=>{handlers[type]=fn;},mainFrame:()=>frame,
    goto:async(url)=>{assert.ok(url.startsWith(BASE));currentURL=url;let r;
      if(challengeActive){currentBody='<title>Just a moment</title>';r=response(url,currentBody,403,{'cf-mitigated':'challenge',server:'cloudflare'});}
      else {currentBody=url.endsWith('/robots.txt')?'User-agent: *':(++homes===1?guest+form:(verified?user:guest));r=response(url,currentBody);}
      handlers.response?.(r);return r;},
    title:async()=>challengeActive?'Just a moment...':'CinemaCity',$:async()=>null,content:async()=>currentBody,
    waitForFunction:async(fn,options)=>{
      calls.waited++;assert.equal(options.timeout,25000);
      if(challengeActive){
        await handlers.request({url:()=>BASE+'/cdn-cgi/challenge-platform/h/g/flow/normal',method:()=> 'POST',postData:()=> '{}',redirectChain:()=>[],isNavigationRequest:()=>false,
          continue:async()=>{calls.verificationPosts++;},abort:async()=>{throw Error('standard verification was blocked');}});
        if(!automatic)throw Object.assign(new Error('bounded wait'),{name:'TimeoutError'});
        challengeActive=false;currentBody=guest+form;homes=1;handlers.response?.(response(currentURL,currentBody));
      }
    },
    type:async(selector,value)=>{calls.typed++;assert.ok(['synthetic-user','synthetic-password'].includes(value));},
    waitForResponse:()=>new Promise(resolve=>{resolvePost=resolve;}),
    $eval:async(selector,fn)=>{
      if(fn.toString().includes('requestSubmit')){
        const req={url:()=>action,method:()=> 'POST',redirectChain:()=>[],isNavigationRequest:()=>false,continue:async()=>{calls.post++;},abort:async()=>{throw Error('unexpected rejection');}};
        await handlers.request(req);resolvePost(response(action,user,200,{},'POST'));return;
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
  assert.equal(calls.waited,1);assert.equal(calls.verificationPosts,1);
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
test('normal automatic page completion may proceed to the genuine login without a fabricated interaction',async()=>{
  const {launch,calls}=fixture({challenge:true,automatic:true});const r=await runSessionProbe({launch,username:'synthetic-user',password:'synthetic-password'});
  assert.equal(r.kind,'session_and_stream_verified');assert.equal(r.login_form.initialHttpStatus,403);assert.equal(r.login_form.httpStatus,200);
  assert.equal(r.login_form.loadReady,true);assert.equal(r.verificationRequests,1);assert.equal(calls.verificationPosts,1);assert.equal(calls.post,1);assert.equal(calls.closed,1);
});
test('verification resources are limited to HTTPS origins operated by the site or Cloudflare',()=>{
  assert.equal(verificationResource(BASE+'/cdn-cgi/challenge-platform/normal'),true);
  assert.equal(verificationResource('https://challenges.cloudflare.com/turnstile/v0/api.js'),true);
  assert.equal(verificationResource('https://test.challenges.cloudflare.com/a'),true);
  assert.equal(verificationResource('https://test.dnstest.dev/a'),true);
  for(const url of ['http://challenges.cloudflare.com/a','https://challenges.cloudflare.com.evil.test/a','https://u:p@challenges.cloudflare.com/a','https://foreign.test/a'])assert.equal(verificationResource(url),false);
});
