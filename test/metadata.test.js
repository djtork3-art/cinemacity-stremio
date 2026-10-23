'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.TMDB_API_KEY='';process.env.CINEMACITY_COOKIE='';process.env.CINEMACITY_ENABLE_LOGIN='false';process.env.CINEMACITY_URL='https://site.test';
const {streamHandler}=require('../index');
test('IMDb metadata can use Cinemeta without a borrowed TMDB key or site cookies',async t=>{
  const old=global.fetch;t.after(()=>{global.fetch=old;});const calls=[];
  global.fetch=async(input,options)=>{
    const url=new URL(input);calls.push(url.hostname);
    if(url.hostname==='v3-cinemeta.strem.io'){
      assert.equal(new Headers(options.headers).has('cookie'),false);
      return new Response(JSON.stringify({meta:{name:'Sample',year:'2026'}}));
    }
    if(url.pathname==='/news_pages.xml')return new Response('<urlset><url><loc>https://site.test/movies/1-sample-2026.html</loc></url></urlset>');
    return new Response(`<script>atob('${Buffer.from('file:"https://media.test/file.m3u8"').toString('base64')}')</script>`);
  };
  assert.equal((await streamHandler({type:'movie',id:'tt1234567'})).streams.length,1);
  assert.ok(!calls.includes('api.themoviedb.org'));
});
