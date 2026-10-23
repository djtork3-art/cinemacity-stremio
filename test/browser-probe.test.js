'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runProbe,networkDiagnostic} = require('../lib/browser-probe');

const TARGET = 'https://cinemacity.cc/news_pages.xml';
const okNode = async () => ({text:'<urlset/>',diagnostic:{kind:'ok',httpStatus:200,cloudflare:false,challenge:false}});

function mockBrowser({status = 200,headers = {'content-type':'application/xml'},body = '<urlset/>',gotoError,version = 'HeadlessChrome/138.0.7204.0',responseUrl = TARGET,requests = []} = {}) {
  const calls = {closed:0,buffer:0,continued:[],aborted:[],javascript:null,interception:null};
  const main = {};
  const handlers = {};
  const page = {
    setJavaScriptEnabled:async enabled => {calls.javascript = enabled;},
    setRequestInterception:async enabled => {calls.interception = enabled;},
    mainFrame:() => main,
    on:(event,handler) => {handlers[event] = handler;},
    goto:async (url,options) => {
      calls.goto = {url,options};
      let response;
      const values = [{url:TARGET,main:true,navigation:true,method:'GET'},...requests];
      for (const [index,value] of values.entries()) {
        let continued = false;
        const request = {
          url:() => value.url, method:() => value.method || 'GET',
          isNavigationRequest:() => value.navigation === true,
          frame:() => value.main ? main : {},redirectChain:() => value.redirect ? [{}] : [],
          continue:async () => {continued = true;calls.continued.push(value.url);},
          abort:async () => {calls.aborted.push(value.url);}
        };
        await handlers.request(request);
        if (continued && (index === 0 || value.response)) {
          const details = index === 0 ? {status,headers,body,url:responseUrl} : value.response;
          response = {
            status:() => details.status,url:() => details.url || value.url,headers:() => details.headers || {},request:() => request,
            buffer:async () => {calls.buffer++;return Buffer.from(details.body || '');}
          };
          handlers.response(response);
        }
      }
      if (gotoError) throw gotoError;
      return response;
    }
  };
  const launch = async () => ({newPage:async()=>page,version:async()=>version,close:async()=>{calls.closed++;}});
  return {launch,calls};
}

test('compares only the fixed catalog target and closes the browser', async () => {
  const {launch,calls} = mockBrowser({requests:[
    {url:'https://other.test/image.png',navigation:false},
    {url:TARGET,navigation:false,main:true}
  ]});
  let nodeCall;
  const result = await runProbe({launch,url:'https://private.test/secret',requestText:async (url,options) => {
    nodeCall = {url,options};return okNode();
  }});
  assert.equal(nodeCall.url,TARGET);
  assert.deepEqual(nodeCall.options,{service:'cinemacity',stage:'catalog',timeoutMs:12000,maxBytes:2*1024*1024,allowRedirect:false});
  assert.deepEqual(calls.goto,{url:TARGET,options:{timeout:20000,waitUntil:'domcontentloaded'}});
  assert.equal(calls.javascript,false);
  assert.equal(calls.interception,true);
  assert.deepEqual(calls.continued,[TARGET]);
  assert.equal(calls.aborted.length,2);
  assert.equal(calls.closed,1);
  assert.equal(result.node.kind,'ok');
  assert.equal(result.browser.kind,'ok');
  assert.equal(result.browser.contentType,'xml');
  assert.equal(result.browser.version,'HeadlessChrome/138.0.7204.0');
  assert.match(result.checkedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(result),/https?:\/\/|<urlset|private|secret/);
});

test('stops on a Cloudflare header without reading or calling it success', async () => {
  const {launch,calls} = mockBrowser({status:200,headers:{'cf-mitigated':'challenge',server:'cloudflare','content-type':'text/html','set-cookie':'private-session'},body:'private html'});
  const result = await runProbe({launch,requestText:async()=>{throw {diagnostic:{kind:'cloudflare_challenge',httpStatus:403,challenge:true,cloudflare:true,url:TARGET,cookie:'private-session'}};}});
  assert.equal(result.node.kind,'cloudflare_challenge');
  assert.equal(result.browser.kind,'cloudflare_challenge');
  assert.equal(result.browser.httpStatus,200);
  assert.equal(result.browser.challenge,true);
  assert.equal(calls.buffer,0);
  assert.equal(calls.closed,1);
  assert.doesNotMatch(JSON.stringify(result),/private|session|html>|set-cookie|https/);
});

test('detects a challenge body even without cf-mitigated', async () => {
  const {launch,calls} = mockBrowser({headers:{'content-type':'text/html'},body:'<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/private"></script>'});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.kind,'cloudflare_challenge');
  assert.equal(result.browser.challenge,true);
  assert.equal(result.browser.contentType,'html');
  assert.equal(calls.closed,1);
  assert.doesNotMatch(JSON.stringify(result),/script|cdn-cgi|private/);
});

test('rejects unrelated navigation and insecure redirects without following them', async () => {
  for (const request of [
    {url:'https://other.test/login?secret=value',main:true,navigation:true},
    {url:'http://cinemacity.cc/unsafe',main:true,navigation:true,redirect:true}
  ]) {
    const {launch,calls} = mockBrowser({requests:[request],gotoError:new Error('private navigation URL')});
    const result = await runProbe({launch,requestText:okNode});
    assert.equal(result.browser.kind,'redirect_rejected');
    assert.equal(calls.aborted.length,1);
    assert.equal(calls.continued.length,1);
    assert.equal(calls.closed,1);
    assert.doesNotMatch(JSON.stringify(result),/private|secret|other.test/);
  }
});

test('rejects oversized browser bodies and does not read a declared oversized body', async () => {
  for (const options of [
    {body:'x'.repeat(2*1024*1024+1)},
    {headers:{'content-length':String(2*1024*1024+1)},body:'small'}
  ]) {
    const {launch,calls} = mockBrowser(options);
    const result = await runProbe({launch,requestText:okNode});
    assert.equal(result.browser.kind,'body_too_large');
    assert.equal(calls.closed,1);
    if (options.headers) assert.equal(calls.buffer,0);
  }
});

test('sanitizes failures and unknown diagnostics and always closes after navigation failure', async () => {
  const failure = Object.assign(new Error('https://private.test/?cookie=SECRET'),{cause:Object.assign(new Error('private body'),{code:'ECONNRESET'})});
  const {launch,calls} = mockBrowser({gotoError:failure,version:'private-version-token'});
  const result = await runProbe({launch,requestText:async()=>{throw {diagnostic:{kind:'private-kind-SECRET',httpStatus:999,cookie:'SECRET'}};}});
  assert.equal(result.node.kind,'network_error');
  assert.equal(result.node.httpStatus,undefined);
  assert.equal(result.browser.kind,'connection_reset');
  assert.deepEqual(result.browser.codes,['ECONNRESET']);
  assert.equal(result.browser.version,undefined);
  assert.equal(calls.closed,1);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|cookie|private/);
  assert.equal(networkDiagnostic({name:'TimeoutError',message:'private'}).kind,'timeout');
});

test('keeps a bare 403 distinct from a Cloudflare challenge', async () => {
  const {launch,calls} = mockBrowser({status:403,headers:{server:'cloudflare','content-type':'text/html'},body:'Access denied'});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.kind,'http_forbidden');
  assert.equal(result.browser.challenge,false);
  assert.equal(result.browser.cloudflare,true);
  assert.equal(calls.closed,1);
});

test('preserves the first challenge response when a later navigation aborts', async () => {
  const {launch,calls} = mockBrowser({status:403,headers:{'cf-mitigated':'challenge',server:'cloudflare','content-type':'text/html'},
    requests:[{url:'https://cinemacity.cc/private-challenge?token=SECRET',main:true,navigation:true,redirect:true}],
    gotoError:new Error('net::ERR_ABORTED at https://cinemacity.cc/private?secret=SECRET')});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.kind,'cloudflare_challenge');
  assert.equal(result.browser.httpStatus,403);
  assert.equal(result.browser.challenge,true);
  assert.equal(result.browser.responseObserved,true);
  assert.equal(result.browser.navigationAllowed,1);
  assert.equal(result.browser.rejectedMain,1);
  assert.equal(result.browser.firstBlockedReason,'challenge_redirect');
  assert.deepEqual(result.browser.codes,['ERR_ABORTED']);
  assert.equal(calls.closed,1);
  assert.equal(calls.buffer,0);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|private|https?:\/\//);
});

test('classifies redirect destinations without returning Location URLs or queries', async () => {
  for (const [location,sameOrigin,destinationKind] of [
    ['/index.php?do=register&token=SECRET',true,'login'],
    ['/index.php?cc_device_guard=device_revoked&token=SECRET',true,'device_guard'],
    ['https://other.test/cdn-cgi/challenge-platform/private?secret=SECRET',false,'challenge'],
    ['/unrelated?private=SECRET',true,'other']
  ]) {
    const {launch,calls} = mockBrowser({status:302,headers:{server:'cloudflare',location},
      requests:[{url:new URL(location,TARGET).href,main:true,navigation:true,redirect:true}],
      gotoError:new Error('net::ERR_ABORTED at private SECRET')});
    const result = await runProbe({launch,requestText:okNode});
    assert.equal(result.browser.kind,'redirect_rejected');
    assert.equal(result.browser.httpStatus,302);
    assert.deepEqual(result.browser.redirect,{sameOrigin,destinationKind});
    assert.equal(result.browser.responseObserved,true);
    assert.equal(calls.continued.length,destinationKind === 'login' || destinationKind === 'other' ? 2 : 1);
    assert.equal(calls.closed,1);
    assert.doesNotMatch(JSON.stringify(result),/SECRET|private|other.test|https?:\/\//);
  }
});

test('extracts only known Chromium codes from raw error messages', () => {
  assert.deepEqual(networkDiagnostic(new Error('net::ERR_ABORTED private SECRET ERR_SECRET')),{kind:'network_error',codes:['ERR_ABORTED']});
  assert.equal(networkDiagnostic(new Error('net::ERR_NAME_NOT_RESOLVED https://secret.test')).kind,'dns_error');
  assert.equal(networkDiagnostic(new Error('net::ERR_CONNECTION_TIMED_OUT secret')).kind,'timeout');
});

test('preserves HTTP 200 when the XML viewer repeats the initial navigation', async () => {
  const {launch,calls} = mockBrowser({status:200,requests:[{url:TARGET,main:true,navigation:true}],gotoError:new Error('net::ERR_ABORTED private SECRET')});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.httpStatus,200);
  assert.equal(result.browser.contentType,'xml');
  assert.equal(result.browser.kind,'navigation_interrupted');
  assert.equal(result.browser.firstBlockedReason,'repeated_navigation');
  assert.equal(result.browser.navigationAllowed,1);
  assert.equal(result.browser.rejectedMain,1);
  assert.equal(result.browser.redirect,undefined);
  assert.equal(calls.closed,1);
  assert.equal(calls.buffer,0);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|private/);
});

test('follows an ordinary same-origin HTTPS 307 and confirms the XML catalog', async () => {
  const {launch,calls} = mockBrowser({status:307,headers:{location:'/catalog/public.xml?opaque=SECRET'},requests:[
    {url:'https://cinemacity.cc/catalog/public.xml?opaque=SECRET',main:true,navigation:true,redirect:true,
      response:{status:200,headers:{'content-type':'application/xml'},body:'<?xml version="1.0"?><urlset><url><loc>https://private.test/secret</loc></url></urlset>'}}
  ]});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.kind,'ok');
  assert.equal(result.browser.httpStatus,200);
  assert.equal(result.browser.catalog,true);
  assert.equal(result.browser.redirectsAllowed,1);
  assert.equal(result.browser.navigationAllowed,2);
  assert.equal(result.browser.rejectedMain,0);
  assert.deepEqual(result.browser.responseChain.map(item=>item.httpStatus),[307,200]);
  assert.equal(result.browser.firstResponse.httpStatus,307);
  assert.deepEqual(result.browser.firstResponse.redirect,{sameOrigin:true,destinationKind:'other'});
  assert.equal(result.browser.redirect,undefined);
  assert.equal(calls.javascript,false);
  assert.equal(calls.closed,1);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|private.test|secret|https?:\/\//);
});

test('blocks challenge and device-guard redirect destinations before requesting them', async () => {
  for (const [location,kind] of [
    ['/cdn-cgi/challenge-platform/private?token=SECRET','challenge'],
    ['/index.php?cc_device_guard=device_revoked&token=SECRET','device_guard']
  ]) {
    const {launch,calls} = mockBrowser({status:302,headers:{location},requests:[
      {url:new URL(location,TARGET).href,main:true,navigation:true,redirect:true}
    ],gotoError:new Error('net::ERR_ABORTED private SECRET')});
    const result = await runProbe({launch,requestText:okNode});
    assert.equal(result.browser.kind,'redirect_rejected');
    assert.equal(result.browser.httpStatus,302);
    assert.equal(result.browser.firstBlockedReason,kind === 'challenge' ? 'challenge_redirect' : 'device_guard_redirect');
    assert.equal(result.browser.redirectsAllowed,0);
    assert.equal(result.browser.responseChain.length,1);
    assert.deepEqual(calls.continued,[TARGET]);
    assert.equal(calls.aborted.length,1);
    assert.doesNotMatch(JSON.stringify(result),/SECRET|private|https?:\/\//);
  }
});

test('rejects cross-origin, HTTPS downgrade and URL userinfo in redirects', async () => {
  for (const location of ['https://other.test/catalog.xml','http://cinemacity.cc/catalog.xml','https://user:SECRET@cinemacity.cc/catalog.xml']) {
    const {launch,calls} = mockBrowser({status:307,headers:{location},requests:[
      {url:location,main:true,navigation:true,redirect:true}
    ],gotoError:new Error('net::ERR_ABORTED SECRET')});
    const result = await runProbe({launch,requestText:okNode});
    assert.equal(result.browser.firstBlockedReason,'unsafe_redirect');
    assert.equal(result.browser.redirectsAllowed,0);
    assert.equal(result.browser.kind,'redirect_rejected');
    assert.deepEqual(calls.continued,[TARGET]);
    assert.doesNotMatch(JSON.stringify(result),/SECRET|other.test|https?:\/\//);
  }
});

test('allows no more than three ordinary redirects and records no more than four responses', async () => {
  const requests = Array.from({length:4},(_,index)=>({
    url:`https://cinemacity.cc/catalog/${index+1}.xml`,main:true,navigation:true,redirect:true,
    response:{status:307,headers:{location:`/catalog/${index+2}.xml`}}
  }));
  const {launch,calls} = mockBrowser({status:307,headers:{location:'/catalog/1.xml'},requests,gotoError:new Error('net::ERR_ABORTED')});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.kind,'redirect_rejected');
  assert.equal(result.browser.firstBlockedReason,'redirect_limit');
  assert.equal(result.browser.redirectsAllowed,3);
  assert.equal(result.browser.navigationAllowed,4);
  assert.equal(result.browser.responseChain.length,4);
  assert.equal(calls.continued.length,4);
  assert.equal(calls.aborted.length,1);
});

test('an anonymous HTTP 200 login page is not a catalog', async () => {
  const {launch,calls} = mockBrowser({status:302,headers:{location:'/login'},requests:[
    {url:'https://cinemacity.cc/login',main:true,navigation:true,redirect:true,
      response:{status:200,headers:{'content-type':'text/html'},body:'<html><form>Login</form></html>'}}
  ]});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.httpStatus,200);
  assert.equal(result.browser.catalog,false);
  assert.equal(result.browser.destinationKind,'login');
  assert.equal(result.browser.contentType,'html');
  assert.equal(calls.javascript,false);
});

test('stops without another request after a challenge response in an ordinary redirect chain', async () => {
  const {launch,calls} = mockBrowser({status:307,headers:{location:'/catalog.xml'},requests:[
    {url:'https://cinemacity.cc/catalog.xml',main:true,navigation:true,redirect:true,
      response:{status:403,headers:{'cf-mitigated':'challenge',server:'cloudflare','content-type':'text/html'}}},
    {url:'https://cinemacity.cc/catalog.xml',main:true,navigation:true,redirect:true}
  ],gotoError:new Error('net::ERR_ABORTED private')});
  const result = await runProbe({launch,requestText:okNode});
  assert.equal(result.browser.kind,'cloudflare_challenge');
  assert.equal(result.browser.httpStatus,403);
  assert.equal(result.browser.challenge,true);
  assert.equal(result.browser.catalog,false);
  assert.equal(result.browser.responseChain.length,2);
  assert.equal(result.browser.firstBlockedReason,'challenge_redirect');
  assert.equal(calls.continued.length,2);
  assert.equal(calls.buffer,0);
});
