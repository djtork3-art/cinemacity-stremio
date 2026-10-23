'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {signIn,SiteCookies}=require('../lib/session');
const {authenticationState,loginForm}=require('../lib/site');
const base='https://site.test';
const form=action=>`<form data-cc-login-form method="post" action="${action}"><input name="login_name"><input name="login_password" type="password"><input type="hidden" name="login" value="submit"><input type="hidden" name="csrf" value="synthetic-action-token"></form>`;
const authenticated='<script>window.CCDeviceGuardRuntime={authenticated:true};</script>';
test('authentication state uses explicit markers, not incidental text',()=>{
  assert.equal(authenticationState(authenticated),true);
  assert.equal(authenticationState('<script>window.CCDeviceGuardRuntime={authenticated:false};</script>'),false);
  assert.equal(authenticationState('<p>authenticated:true</p>'),null);
});
test('login requires a recognized same-origin HTTPS POST form',()=>{
  for(const action of ['https://other.test/','http://site.test/','https://name:secret@site.test/']) assert.throws(()=>loginForm(form(action),base),e=>e.diagnostic.kind==='unsafe_login_action');
  assert.throws(()=>loginForm('<form></form>',base),e=>e.diagnostic.kind==='login_form_unavailable');
});
test('sign-in discovers the observed action and verifies cookies against a fresh page',async t=>{
  const old=global.fetch; t.after(()=>{global.fetch=old;});let calls=0;
  global.fetch=async(url,options)=>{
    calls++;
    if(calls===1){assert.equal(url,base+'/');return new Response(form('/index.php?do=register'),{headers:{'Set-Cookie':'device=own-server-session; Path=/; Secure; HttpOnly'}});}
    if(calls===2){
      assert.equal(url,base+'/index.php?do=register');assert.equal(options.method,'POST');
      assert.equal(options.body.get('login_name'),'own-test-user');assert.equal(options.body.get('login_password'),'own-test-password');
      assert.equal(options.body.get('csrf'),'synthetic-action-token');
      assert.equal(options.headers.Cookie,'device=own-server-session');
      return new Response('',{status:302,headers:{Location:'/', 'Set-Cookie':'account=own-test-session; Path=/; Secure; HttpOnly'}});
    }
    assert.equal(calls,3);assert.equal(url,base+'/');
    assert.match(options.headers.Cookie,/account=own-test-session/);
    return new Response(authenticated);
  };
  const jar=await signIn({base,username:'own-test-user',password:'own-test-password',headers:{}});
  assert.match(jar.header(base+'/'),/account=own-test-session/);
  assert.equal(jar.header('https://other.test/'),'');assert.equal(calls,3);
});
test('a challenge stops sign-in before credentials are submitted',async t=>{
  const old=global.fetch;t.after(()=>{global.fetch=old;});let calls=0;
  global.fetch=async(url,options)=>{calls++;assert.equal(options.method,'GET');return new Response('',{status:403,headers:{'cf-mitigated':'challenge'}});};
  await assert.rejects(signIn({base,username:'own-test-user',password:'own-test-password',headers:{}}),e=>e.diagnostic.kind==='cloudflare_challenge'&&e.diagnostic.stage==='login_form');
  assert.equal(calls,1);
});
test('setting cookies alone does not prove authentication',async t=>{
  const old=global.fetch;t.after(()=>{global.fetch=old;});let calls=0;
  global.fetch=async()=>++calls===1?new Response(form('/index.php?do=register')):new Response('<script>window.CCDeviceGuardRuntime={authenticated:false};</script>',{headers:{'Set-Cookie':'PHPSESSID=synthetic; Path=/'}});
  await assert.rejects(signIn({base,username:'own-test-user',password:'own-test-password',headers:{}}),e=>e.diagnostic.kind==='session_unconfirmed');
  assert.equal(calls,3);
});
test('a foreign redirect after login is rejected before verification',async t=>{
  const old=global.fetch;t.after(()=>{global.fetch=old;});let calls=0;
  global.fetch=async()=>++calls===1?new Response(form('/index.php?do=register')):new Response(null,{status:302,headers:{Location:'https://other.test/'}});
  await assert.rejects(signIn({base,username:'own-test-user',password:'own-test-password',headers:{}}),e=>e.diagnostic.kind==='redirect_rejected');
  assert.equal(calls,2);
});
test('jar enforces origin, cookie paths, expiry and exact domain',()=>{
  const jar=new SiteCookies(base);
  const headers=new Headers();
  for(const value of ['root=a; Path=/; Secure','scoped=b; Path=/account; Secure','bad=c; Domain=other.test; Path=/','gone=d; Max-Age=0; Path=/']) headers.append('Set-Cookie',value);
  jar.store(base+'/',headers);
  assert.equal(jar.header(base+'/'),'root=a');
  assert.equal(jar.header(base+'/account/profile'),'scoped=b; root=a');
  assert.equal(jar.header(base+'/accounting'),'root=a');
  assert.equal(jar.header('http://site.test/'),'');
  jar.store(base+'/',new Headers({'Set-Cookie':'root=; Max-Age=0; Path=/'}));
  assert.equal(jar.header(base+'/'),'');
});
