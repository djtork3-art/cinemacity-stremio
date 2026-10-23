'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.TMDB_API_KEY='synthetic-api-key';
process.env.CINEMACITY_COOKIE='';
process.env.CINEMACITY_USERNAME='synthetic-user';
process.env.CINEMACITY_PASSWORD='synthetic-password';
process.env.CINEMACITY_ENABLE_LOGIN='true';
process.env.CINEMACITY_URL='https://site.test';
const form='<form data-cc-login-form method="post" action="/index.php?do=register"><input name="login_name"><input name="login_password"><input name="login" type="hidden" value="submit"></form>';
const user='<script>window.CCDeviceGuardRuntime={authenticated:true};</script>';
function handler() { delete require.cache[require.resolve('../index')];return require('../index').streamHandler; }
test('concurrent stream requests share one verified sign-in',async t=>{
  const old=global.fetch;t.after(()=>{global.fetch=old;});
  const counts={form:0,post:0,verify:0,search:0,detail:0};
  global.fetch=async(input,options)=>{
    const url=new URL(input);
    if(url.hostname==='api.themoviedb.org')return new Response(JSON.stringify({title:'Sample'}));
    if(options.method==='POST'){
      counts.post++;return new Response(user,{headers:{'Set-Cookie':'account=synthetic-session; Path=/; Secure'}});
    }
    if(url.pathname==='/news_pages.xml'){counts.search++;assert.match(options.headers.Cookie,/account=synthetic-session/);return new Response('<urlset><url><loc>https://site.test/movies/123-sample-2026.html</loc></url></urlset>');}
    if(url.pathname.endsWith('.html')){counts.detail++;return new Response(user+`<script>atob('${Buffer.from('file:"https://media.test/video.m3u8"').toString('base64')}')</script>`);}
    if(!options.headers.Cookie){counts.form++;await new Promise(r=>setTimeout(r,15));return new Response(form);}
    counts.verify++;return new Response(user);
  };
  const run=handler();const results=await Promise.all([run({type:'movie',id:'tmdb:1'}),run({type:'movie',id:'tmdb:2'})]);
  assert.deepEqual(counts,{form:1,post:1,verify:1,search:1,detail:2});
  assert.ok(results.every(r=>r.streams.length===1));
  assert.doesNotMatch(JSON.stringify(results),/synthetic-/);
});
test('failed sign-in is coalesced and subsequent requests respect cooldown',async t=>{
  const old=global.fetch,oldError=console.error;t.after(()=>{global.fetch=old;console.error=oldError;});
  let siteCalls=0;const diagnostics=[];console.error=(_,d)=>diagnostics.push(d);
  global.fetch=async(input,options)=>{
    if(new URL(input).hostname==='api.themoviedb.org')return new Response(JSON.stringify({title:'Sample'}));
    siteCalls++;assert.equal(options.method,'GET');await new Promise(r=>setTimeout(r,15));return new Response('',{status:403,headers:{'cf-mitigated':'challenge'}});
  };
  const run=handler();await Promise.all([run({type:'movie',id:'tmdb:1'}),run({type:'movie',id:'tmdb:2'})]);
  await run({type:'movie',id:'tmdb:3'});
  assert.equal(siteCalls,1);assert.equal(diagnostics.at(-1).cooldown,true);
  assert.doesNotMatch(JSON.stringify(diagnostics),/synthetic-/);
});
