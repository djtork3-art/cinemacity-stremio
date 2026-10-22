'use strict';
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const cheerio = require('cheerio');

const BASE = (process.env.CINEMACITY_URL || 'https://cinemacity.cc').replace(/\/$/, '');
const API_KEY = process.env.TMDB_API_KEY;
const COOKIE = process.env.CINEMACITY_COOKIE || '';
const PORT = Number(process.env.PORT || 7000);
const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; Stremio-CinemaCity-Bridge/1.0)', Referer: BASE + '/' };
if (COOKIE) headers.Cookie = COOKIE;

async function fetchText(url, opts={}) {
  const r = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.text();
}
async function tmdbInfo(type, id) {
  if (!API_KEY) throw new Error('Falta TMDB_API_KEY');
  const kind = type === 'series' ? 'tv' : 'movie';
  let tmdbId = id;
  if (/^tt\d+$/.test(id)) {
    const found = await fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?external_source=imdb_id&api_key=${encodeURIComponent(API_KEY)}`);
    if (!found.ok) throw new Error('TMDB lookup falló');
    const result = await found.json();
    tmdbId = result[kind === 'tv' ? 'tv_results' : 'movie_results']?.[0]?.id;
  } else if (id.startsWith('tmdb:')) tmdbId = id.slice(5);
  if (!/^\d+$/.test(String(tmdbId || ''))) throw new Error('ID no compatible');
  const res = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(API_KEY)}`);
  if (!res.ok) throw new Error('Consulta TMDB falló');
  const data = await res.json();
  return data.title || data.name;
}
function titleMatches(candidate, requested) {
  const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = norm(candidate), b = norm(requested);
  return a.length > 2 && b.length > 2 && (a === b || (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b)));
}
function findTitlePage(html, title) {
  const $ = cheerio.load(html);
  let url;
  $('div.dar-short_item').each((_,el) => {
    if (url) return;
    $(el).find('a[href*=".html"]').each((_,a) => {
      if (url) return;
      const name = $(a).text().split('(')[0].trim();
      if (titleMatches(name,title)) {
        try { const parsed = new URL($(a).attr('href'), BASE); if (parsed.origin === new URL(BASE).origin) url = parsed.href; } catch {}
      }
    });
  });
  return url;
}
function decodePayload(html) {
  const $ = cheerio.load(html);
  for (const el of $('script').toArray()) {
    const script = $(el).html() || '';
    const matches = script.matchAll(/atob\s*\(\s*(['"])(.*?)\1\s*\)/g);
    for (const m of matches) {
      let decoded;
      try { decoded = Buffer.from(m[2], 'base64').toString('utf8'); } catch { continue; }
      const file = decoded.match(/\bfile\s*:\s*(['"])(.*?)\1/s) || decoded.match(/\bfile\s*:\s*(\[.*?\])/s);
      if (!file) continue;
      const value = file[2] || file[1];
      if (value?.startsWith('[') || value?.startsWith('{')) {
        try { return JSON.parse(value.replace(/\\(.)/g,'$1')); } catch {
          try { return JSON.parse(value); } catch {}
        }
      }
      if (value) return value;
    }
  }
  return null;
}
function quality(u) {
  const x=u.toLowerCase();
  return x.includes('2160p')||x.includes('4k')?'4K':(['1080p','720p','480p','360p'].find(q=>x.includes(q))||'HD');
}
function toStreams(data, title, type, season, episode) {
  let file = null;
  if (type === 'movie') {
    file = Array.isArray(data) ? (data.find(x=>!x.folder && x.file)||data[0])?.file : data;
  } else if (Array.isArray(data)) {
    const s = data.find(x => (x.title||'').includes(`Season ${season}`) || (x.title||'').includes(`S${season}`));
    file = s?.folder?.find(x => (x.title||'').includes(`Episode ${episode}`) || (x.title||'').includes(`E${episode}`))?.file;
  }
  if (typeof file !== 'string') return [];
  const urls = file.includes('.urlset/master.m3u8') ? [file] : (file.includes('[') ? file.split(',') : [file]);
  return urls.flatMap(raw => {
    const m=raw.trim().match(/^\[([^\]]+)\](.*)$/);
    const url=(m?m[2]:raw).trim();
    if (!/^https?:\/\//i.test(url)) return [];
    return [{ name: 'CinemaCity', title: `${title} · ${m?.[1] || quality(url)}`, url }];
  });
}
const manifest = {
  id: 'community.cinemacity.bridge', version: '1.0.0', name: 'CinemaCity Bridge (no oficial)',
  description: 'Adaptación experimental del proveedor CinemaCity de Nuvio. Requiere TMDB_API_KEY; la disponibilidad depende del sitio origen.',
  resources: ['stream'], types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'], catalogs: [],
  behaviorHints: { configurable: false }
};
const builder = new addonBuilder(manifest);
const streamHandler = async ({type, id}) => {
  try {
    if (!['movie','series'].includes(type)) return { streams: [] };
    let [mediaId, season, episode] = id.split(':');
    if (id.startsWith('tmdb:')) [mediaId, season, episode] = [`tmdb:${id.split(':')[1]}`, ...id.split(':').slice(2)];
    const title = await tmdbInfo(type, mediaId);
    if (!title) return { streams: [] };
    const searchUrl = `${BASE}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(title)}`;
    let page = findTitlePage(await fetchText(searchUrl), title);
    if (!page) page = findTitlePage(await fetchText(BASE), title);
    if (!page) return { streams: [] };
    const payload = decodePayload(await fetchText(page));
    return { streams: toStreams(payload, title, type, season, episode) };
  } catch (err) {
    console.error('CinemaCity:', err.message);
    return { streams: [] };
  }
};
builder.defineStreamHandler(streamHandler);
module.exports = { manifest, streamHandler };
if (require.main === module) {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`CinemaCity bridge: http://127.0.0.1:${PORT}/manifest.json`);
}
