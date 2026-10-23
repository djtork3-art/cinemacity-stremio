'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createGate}=require('../lib/session-probe-gate');
const key='a'.repeat(43),hash=createHash('sha256').update(key).digest('hex');
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.result=v;return this;},send(v){this.result=v;return this;}};}
test('GET exposes only a form and never executes account operations',async()=>{
  let count=0;const route=createGate({hash,expires:100,now:()=>0,run:()=>{count++;}}),res=response();
  await route({method:'GET'},res);assert.equal(res.code,200);assert.match(res.result,/type="password"/);assert.doesNotMatch(res.result,new RegExp(hash));assert.equal(count,0);
});
test('wrong or missing key cannot initiate a session',async()=>{
  let count=0;const route=createGate({hash,expires:100,now:()=>0,run:()=>{count++;}});
  for(const body of [{},'key='+('b'.repeat(43)),{key:['not-string']}]){const res=response();await route({method:'POST',body},res);assert.equal(res.code,404);}
  assert.equal(count,0);
});
test('authenticated concurrent requests share one attempt without echoing the key',async()=>{
  let count=0;const route=createGate({hash,expires:100,now:()=>0,run:async()=>{count++;return {authenticated:false,kind:'cloudflare_challenge'};}});
  const responses=[response(),response()];await Promise.all(responses.map(res=>route({method:'POST',body:'key='+key},res)));
  assert.equal(count,1);for(const res of responses){assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'no-store');assert.doesNotMatch(JSON.stringify(res.result),new RegExp(key));}
});
test('expired attempts and oversized bodies cannot run',async()=>{
  let count=0;const run=()=>{count++;};const expired=createGate({hash,expires:100,now:()=>101,run}),res=response();
  await expired({method:'POST',body:{key}},res);assert.equal(res.code,410);
  const active=createGate({hash,expires:100,now:()=>0,run}),large=response();await active({method:'POST',body:'key='+('x'.repeat(2000))},large);assert.equal(large.code,500);assert.equal(count,0);
});
