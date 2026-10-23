'use strict';
const fs = require('node:fs');
const { authenticationState } = require('../lib/site');

// A fully offline check of the actual handler. No credentials or page scripts run.
process.env.TMDB_API_KEY = 'offline-fixture';
process.env.CINEMACITY_COOKIE = '';
process.env.CINEMACITY_USERNAME = '';
process.env.CINEMACITY_PASSWORD = '';
process.env.CINEMACITY_ENABLE_LOGIN = 'false';
process.env.CINEMACITY_URL = 'https://offline.test';
const { streamHandler } = require('../index');

async function run() {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('missing_files');
  const saved = { fetch:global.fetch, info:console.info, warn:console.warn, error:console.error };
  const results = [];
  try {
    for (const path of paths) {
      const html = fs.readFileSync(path,'utf8');
      let requests = 0;
      const diagnostics = [];
      global.fetch = async input => {
        requests++;
        const url = new URL(input);
        if (url.origin === 'https://api.themoviedb.org') return new Response(JSON.stringify({name:'Offline sample'}));
        if (url.origin !== 'https://offline.test') throw new Error('unexpected_offline_request');
        if (url.pathname.endsWith('.html')) return new Response(html);
        if (url.pathname === '/news_pages.xml') return new Response('<urlset><url><loc>https://offline.test/tv-series/1-offline-sample-2026.html</loc></url></urlset>');
        throw new Error('unexpected_offline_request');
      };
      console.info = console.warn = () => {};
      console.error = (_, diagnostic) => { diagnostics.push({service:diagnostic.service,stage:diagnostic.stage,kind:diagnostic.kind}); };
      const result = await streamHandler({type:'series',id:'tmdb:1:1:1'});
      results.push({offline:true,authenticated:authenticationState(html),episode:'S1E1',
        streamCount:result.streams.length,allStreamsHavePlaybackHints:result.streams.length ? result.streams.every(s=>s.behaviorHints?.notWebReady===true) : null,
        syntheticRequests:requests,diagnostics});
    }
  } finally {
    global.fetch = saved.fetch; console.info = saved.info; console.warn = saved.warn; console.error = saved.error;
  }
  console.log(JSON.stringify(results,null,2));
}
run().catch(()=>{console.error('No se pudo analizar el archivo. Uso: node scripts/inspect-html.js archivo.html [otro.html]');process.exitCode=1;});
