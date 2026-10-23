'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {runProbe,fetchCatalog,allowedRequest}=require('../lib/browser-probe');
const robots='https://cinemacity.cc/robots.txt',catalog='https://cinemacity.cc/news_pages.xml';
function fixture(status=200,headers={}){
  const calls={closed:0,evaluated:0};const frame={};
  const page={setJavaScriptEnabled:async enabled=>assert.equal(enabled,false),setRequestInterception:async()=>{},on:()=>{},mainFrame:()=>frame,
    goto:async(url)=>{assert.equal(url,robots);return {status:()=>status,headers:()=>headers,buffer:async()=>Buffer.from('User-agent: *')};},
    url:()=>robots,evaluate:async(fn,args)=>{calls.evaluated++;assert.equal(args.target,catalog);return {kind:'ok',catalog:true,entries:1};}};
  return {calls,launch:async()=>({version:async()=> 'HeadlessChrome/153.0.8010.0',newPage:async()=>page,close:async()=>{calls.closed++;}})};
}
test('bootstraps robots before same-origin fetch without imported cookies',async()=>{
  const {calls,launch}=fixture();const r=await runProbe({launch});assert.equal(r.bootstrap.kind,'ok');assert.equal(r.catalogFetch.catalog,true);
  assert.equal(r.cookiesImported,false);assert.equal(calls.closed,1);assert.equal(calls.evaluated,1);
});
test('a bootstrap challenge stops before the catalog fetch',async()=>{
  const {calls,launch}=fixture(403,{'cf-mitigated':'challenge',server:'cloudflare'});const r=await runProbe({launch});
  assert.equal(r.bootstrap.kind,'cloudflare_challenge');assert.equal(calls.evaluated,0);assert.equal(calls.closed,1);
});
test('browser fetch retains URLset XML but never returns its URLs or cookies',async t=>{
  const old=global.fetch;t.after(()=>global.fetch=old);
  global.fetch=async(url,opts)=>{assert.equal(url,catalog);assert.equal(opts.credentials,'include');assert.equal(opts.headers.Cookie,undefined);
    return new Response('<urlset><loc>https://private.example/movie</loc></urlset>');};
  const r=await fetchCatalog({target:catalog,limit:2048});assert.equal(r.catalog,true);assert.equal(r.entries,1);assert.doesNotMatch(JSON.stringify(r),/private|https?:\/\/|cookie/i);
});
test('explicit challenge is detected without reading the body',async t=>{
  const old=global.fetch;t.after(()=>global.fetch=old);
  global.fetch=async()=>new Response('private-body',{status:403,headers:{'cf-mitigated':'challenge'}});
  const r=await fetchCatalog({target:catalog,limit:2048});assert.equal(r.kind,'cloudflare_challenge');assert.equal(r.bytes,undefined);
});
test('body is bounded and a 200 login page is not a catalog',async t=>{
  const old=global.fetch;t.after(()=>global.fetch=old);
  global.fetch=async()=>new Response('x'.repeat(2049));assert.equal((await fetchCatalog({target:catalog,limit:2048})).kind,'body_too_large');
  global.fetch=async()=>new Response('<html><title>Login</title></html>');assert.equal((await fetchCatalog({target:catalog,limit:2048})).catalog,false);
});
test('redirect policy rejects other origins, device guards, challenges, credentials and excess hops',()=>{
  assert.equal(allowedRequest(robots,robots,0),true);assert.equal(allowedRequest(catalog,robots,0),false);
  for(const url of ['http://cinemacity.cc/a','https://foreign.test/a','https://u:p@cinemacity.cc/a','https://cinemacity.cc/captcha','https://cinemacity.cc/?__cf_chl_tk=private','https://cinemacity.cc/?cc_device_guard=private'])assert.equal(allowedRequest(url,robots,1),false);
  assert.equal(allowedRequest(catalog,robots,4),false);assert.equal(allowedRequest(catalog,robots,1),true);
});
test('browser failures are sanitized and the browser is always closed',async()=>{
  let closed=false;const r=await runProbe({launch:async()=>({version:async()=>{throw Object.assign(new Error('private-url-and-secret'),{code:'ECONNRESET'});},close:async()=>{closed=true;}})});
  assert.equal(closed,true);assert.equal(r.error.kind,'connection_reset');assert.doesNotMatch(JSON.stringify(r),/private|secret/);
});
