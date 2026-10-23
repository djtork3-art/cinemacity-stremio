'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLocalProvider}=require('../lib/local-provider');
const base='https://site.test';
const encode=data=>`<script>atob('${Buffer.from(`file: '${typeof data==='string'?data:JSON.stringify(data)}'`).toString('base64')}')</script>`;
const catalog=urls=>`<urlset>${urls.map(url=>`<url><loc>${url}</loc></url>`).join('')}</urlset>`;
const entry=base+'/tv-series/1-test-show-2026.html';
const media={title:'Test Show',mediaType:'tv',year:'2026',season:1,episode:1};
function make(data,entries=[entry]) {
  const calls=[];
  const provider=createLocalProvider({base,userAgent:'fixture-agent',fetchSite:async(url,stage)=>{calls.push({url,stage});return stage==='catalog'?catalog(entries):encode(data);}});
  return {provider,calls};
}
test('missing seasons and explicitly missing episodes return no substitute',async()=>{
  const {provider}=make([{title:'Season 1',folder:[{title:'Episode 1',file:'https://media.test/one.m3u8'},{title:'Episode 3',file:'https://media.test/three.m3u8'}]}]);
  assert.deepEqual(await provider.getStreams({...media,season:99}),[]);
  assert.deepEqual(await provider.getStreams({...media,episode:2}),[]);
});
test('nested language folders select the requested season and episode',async()=>{
  const {provider}=make([{title:'English',folder:[{title:'Season 1',folder:[{title:'Episode 1',file:'https://media.test/wrong.m3u8'}]},{title:'Season 2',folder:[{title:'Episode 1',file:'https://media.test/right.m3u8'}]}]}]);
  assert.equal((await provider.getStreams({...media,season:2}))[0].url,'https://media.test/right.m3u8');
});
test('labeled comma-separated qualities are preserved and ordered',async()=>{
  const {provider}=make([{title:'Season 1',folder:[{title:'Episode 1',file:'[720p]https://media.test/720.m3u8,[1080p]https://media.test/1080.m3u8'}]}]);
  const streams=await provider.getStreams(media);
  assert.equal(streams.length,2);assert.equal(streams[0].url,'https://media.test/1080.m3u8');
  assert.equal(streams[0].behaviorHints.notWebReady,true);
  assert.equal(streams[0].behaviorHints.proxyHeaders.request.Origin,base);
});
test('commas inside a URLset stay in a single playable URL',async()=>{
  const url='https://media.test/hls/clip/,720p,1080p,.urlset/master.m3u8';
  const {provider}=make([{title:'Season 1',folder:[{title:'Episode 1',file:url}]}]);
  assert.equal((await provider.getStreams(media))[0].url,url);
});
test('unquoted player keys are parsed as data, without executing scripts',async()=>{
  const code='file: [{title:"Season 1", folder:[{title:"Episode 1", file:"https://media.test/file.m3u8"}]}]';
  const provider=createLocalProvider({base,userAgent:'fixture',fetchSite:async(url,stage)=>stage==='catalog'?catalog([entry]):`<script>throw Error('must not execute'); atob('${Buffer.from(code).toString('base64')}')</script>`});
  assert.equal((await provider.getStreams(media))[0].url,'https://media.test/file.m3u8');
});
test('catalog matching uses year, media type and the configured origin',async()=>{
  const movie={title:'Test Film',mediaType:'movie',year:'2026'};
  const pages=[base+'/movies/1-test-film-2020.html',base+'/movies/2-test-film-2026.html',base+'/tv-series/3-test-film-2026.html','https://other.test/movies/4-test-film-2026.html'];
  const {provider,calls}=make('https://media.test/movie.m3u8',pages);
  await provider.getStreams(movie);
  assert.equal(calls[1].url,base+'/movies/2-test-film-2026.html');
  assert.ok(calls.every(c=>new URL(c.url).origin===base));
  const wrong=make('https://media.test/movie.m3u8',[base+'/tv-series/3-test-film-2026.html']);
  assert.deepEqual(await wrong.provider.getStreams(movie),[]);
});
test('concurrent requests share a cached catalog',async()=>{
  const {provider,calls}=make([{title:'Season 1',folder:[{title:'Episode 1',file:'https://media.test/file.m3u8'}]}]);
  await Promise.all([provider.getStreams(media),provider.getStreams(media)]);
  await provider.getStreams(media);
  assert.equal(calls.filter(c=>c.stage==='catalog').length,1);
});
