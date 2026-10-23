'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('health coalesces anonymous probes, keeps HTTP status and excludes secrets',async t=>{
  process.env.CINEMACITY_URL='https://site.test';
  process.env.CINEMACITY_COOKIE='private-cookie';
  process.env.CINEMACITY_USERNAME='private-user';
  process.env.CINEMACITY_PASSWORD='private-password';
  let calls=0;
  const old=global.fetch;
  global.fetch=async(url,opts)=>{
    calls++;
    assert.equal(opts.method,'GET');
    assert.equal(new Headers(opts.headers).has('cookie'),false);
    return new Response('',{status:403,headers:{'cf-mitigated':'challenge',server:'cloudflare','set-cookie':'private-cookie'}});
  };
  t.after(()=>{global.fetch=old;});
  const {health}=require('../lib/health');
  const [a,b]=await Promise.all([health(),health()]);
  assert.deepEqual(a,b);
  assert.equal(calls,2);
  assert.equal(a.publicPage.httpStatus,403);
  assert.equal(a.publicPage.reachable,true);
  assert.equal(a.publicPage.kind,'cloudflare_challenge');
  assert.equal(a.authentication.verified,false);
  assert.equal(a.loginEnabled,false);
  assert.doesNotMatch(JSON.stringify(a),/private-/);
  await health(); assert.equal(calls,2);
});
