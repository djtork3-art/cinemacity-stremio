'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {requestText,networkDiagnostic} = require('../lib/http');
test('classifies nested/aggregate resets without leaking messages', () => {
  const e = new TypeError('secret URL', {cause:new AggregateError([Object.assign(new Error('secret cookie'),{code:'ECONNRESET'})])});
  assert.equal(networkDiagnostic(e).kind,'connection_reset');
  assert.doesNotMatch(JSON.stringify(networkDiagnostic(e)),/secret/);
  assert.equal(networkDiagnostic({code:'CERT_HAS_EXPIRED'}).kind,'tls_error');
  assert.equal(networkDiagnostic({code:'ENOTFOUND'}).kind,'dns_error');
  assert.equal(networkDiagnostic({name:'TimeoutError'}).kind,'timeout');
});
test('403 alone does not claim a Cloudflare challenge', async () => {
  await assert.rejects(requestText('https://site.test/', {fetchImpl:async()=>new Response('',{status:403,headers:{server:'cloudflare'}})}), e=>{
    assert.equal(e.diagnostic.kind,'http_forbidden'); assert.equal(e.diagnostic.challenge,false); return true;
  });
});
test('challenge header is detected even on HTTP 200', async () => {
  await assert.rejects(requestText('https://site.test/',{fetchImpl:async()=>new Response('do not parse',{headers:{'cf-mitigated':'challenge'}})}),e=>e.diagnostic.kind==='cloudflare_challenge');
});
test('cookies cannot be sent across an origin redirect or HTTPS downgrade', async () => {
  for (const location of ['https://other.test/','http://site.test/','https://user:secret@site.test/']) {
    let calls = 0;
    await assert.rejects(requestText('https://site.test/',{headers:{Cookie:'own-session'},fetchImpl:async()=>{
      calls++; return new Response(null,{status:302,headers:{location}});
    }}),e=>e.diagnostic.kind==='redirect_rejected');
    assert.equal(calls,1);
  }
});
test('same-origin redirects are bounded and preserve timeout signal', async () => {
  let signal, calls=0;
  await assert.rejects(requestText('https://site.test/',{fetchImpl:async(url,opts)=>{
    calls++; if (signal) assert.equal(opts.signal,signal); signal=opts.signal;
    return new Response(null,{status:302,headers:{location:'/loop'}});
  }}),e=>e.diagnostic.kind==='redirect_rejected');
  assert.equal(calls,4);
});
test('limits response bodies and catches body read failures', async () => {
  await assert.rejects(requestText('https://site.test/',{maxBytes:3,fetchImpl:async()=>new Response('1234')}),e=>e.diagnostic.kind==='body_too_large');
  await assert.rejects(requestText('https://site.test/',{fetchImpl:async()=>new Response(new ReadableStream({start(c){c.error(Object.assign(new Error('private'),{code:'ECONNRESET'}));}}))}),e=>e.diagnostic.kind==='connection_reset');
});
test('timeout covers a stalled body, not only headers', async () => {
  // Real sockets keep the loop alive; this synthetic stream needs a handle.
  const keepAlive = setInterval(()=>{},1000);
  try {
  await assert.rejects(requestText('https://site.test/',{timeoutMs:20,fetchImpl:async(url,{signal})=>new Response(new ReadableStream({start(c){
    signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});
  }}))}),e=>e.diagnostic.kind==='timeout');
  } finally { clearInterval(keepAlive); }
});
