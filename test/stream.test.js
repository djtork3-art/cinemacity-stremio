'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
process.env.TMDB_API_KEY='test-private-key';
process.env.CINEMACITY_COOKIE='test-private-session';
process.env.CINEMACITY_URL='https://site.test';
const {streamHandler} = require('../index');
const originalFetch = global.fetch;
const search = '<div class="dar-short_item"><a href="/123.html">Test Movie (2026)</a></div>';
const detail = data => `<script>atob('${Buffer.from(`file: '${typeof data === 'string' ? data : JSON.stringify(data)}'`).toString('base64')}')</script>`;
function mock(t, page) {
  const calls=[];
  global.fetch=async(url,opts)=>{
    calls.push({url,opts});
    if (url.startsWith('https://api.themoviedb.org/')) {
      assert.equal(new Headers(opts.headers).has('cookie'),false);
      return new Response(JSON.stringify({title:'Test Movie'}));
    }
    assert.equal(new URL(url).origin,'https://site.test');
    return page(url,opts);
  };
  t.after(()=>{global.fetch=originalFetch;});
  return calls;
}
test('full movie flow returns stream and never exposes cookie/API key',async t=>{
  mock(t,url=>new Response(url.includes('story=')?search:detail('https://media.test/movie.m3u8')));
  const result=await streamHandler({type:'movie',id:'tmdb:123'});
  assert.equal(result.streams[0].url,'https://media.test/movie.m3u8');
  assert.doesNotMatch(JSON.stringify(result),/test-private/);
});
test('series selects episode 1 instead of episode 10',async t=>{
  mock(t,url=>new Response(url.includes('story=')?search:detail([
    {title:'Season 10',folder:[{title:'Episode 1',file:'https://media.test/wrong-season.m3u8'}]},
    {title:'Season 1',folder:[{title:'Episode 10',file:'https://media.test/wrong-episode.m3u8'},{title:'Episode 1',file:'https://media.test/correct.m3u8'}]}
  ])));
  assert.equal((await streamHandler({type:'series',id:'tmdb:123:1:1'})).streams[0].url,'https://media.test/correct.m3u8');
});
test('blocked search stops without fallback, login or secret logs',async t=>{
  const calls=mock(t,()=>new Response('',{status:403,headers:{'cf-mitigated':'challenge'}}));
  const errors=[]; const old=console.error; console.error=(...args)=>errors.push(args);
  t.after(()=>{console.error=old;});
  assert.deepEqual(await streamHandler({type:'movie',id:'tmdb:123'}),{streams:[]});
  assert.equal(calls.length,2);
  assert.equal(errors[0][1].stage,'search');
  assert.equal(errors[0][1].kind,'cloudflare_challenge');
  assert.doesNotMatch(JSON.stringify(errors),/test-private/);
});
test('invalid episode/ID does not contact upstream',async t=>{
  const calls=mock(t,()=>{throw new Error('must not fetch');});
  assert.deepEqual(await streamHandler({type:'series',id:'tmdb:123:1:abc'}),{streams:[]});
  assert.deepEqual(await streamHandler({type:'movie',id:'garbage'}),{streams:[]});
  assert.equal(calls.length,0);
});
