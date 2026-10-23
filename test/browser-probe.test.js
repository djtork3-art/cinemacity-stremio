'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runProbe,networkDiagnostic} = require('../lib/browser-probe');

const TARGET = 'https://cinemacity.cc/news_pages.xml';
const okNode = async () => ({text:'<urlset/>',diagnostic:{kind:'ok',httpStatus:200,cloudflare:false,challenge:false}});

function mockBrowser({status = 200,headers = {'content-type':'application/xml'},body = '<urlset/>',gotoError,version = 'HeadlessChrome/138.0.7204.0',responseUrl = TARGET,requests = []} = {}) {
  const calls = {closed:0,buffer:0,continued:[],aborted:[],javascript:null,interception:null};
  const main = {};
  let requestHandler;
  const page = {
    setJavaScriptEnabled:async enabled => {calls.javascript = enabled;},
    setRequestInterception:async enabled => {calls.interception = enabled;},
    mainFrame:() => main,
    on:(event,handler) => {assert.equal(event,'request');requestHandler = handler;},
    goto:async (url,options) => {
      calls.goto = {url,options};
      const values = [{url:TARGET,main:true,navigation:true,method:'GET'},...requests];
      for (const value of values) {
        await requestHandler({
          url:() => value.url, method:() => value.method || 'GET',
          isNavigationRequest:() => value.navigation === true,
          frame:() => value.main ? main : {},redirectChain:() => value.redirect ? [{}] : [],
          continue:async () => {calls.continued.push(value.url);},
          abort:async () => {calls.aborted.push(value.url);}
        });
      }
      if (gotoError) throw gotoError;
      return {
        status:() => status,url:() => responseUrl,headers:() => headers,
        buffer:async () => {calls.buffer++;return Buffer.from(body);}
      };
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

test('rejects another main-frame URL and any redirect without following it', async () => {
  for (const request of [
    {url:'https://other.test/login?secret=value',main:true,navigation:true},
    {url:TARGET,main:true,navigation:true,redirect:true}
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
