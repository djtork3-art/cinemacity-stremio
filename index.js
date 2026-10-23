'use strict';
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const cheerio = require('cheerio');
const { requestText, UpstreamError } = require('./lib/http');

const BASE = (process.env.CINEMACITY_URL || 'https://cinemacity.cc').replace(/\/$/, '');
const API_KEY = process.env.TMDB_API_KEY;
const COOKIE = process.env.CINEMACITY_COOKIE || '';
const PORT = Number(process.env.PORT || 7000);
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', Referer: BASE + '/' };
if (COOKIE) headers.Cookie = COOKIE;

// Site credentials live only in server environment variables. Never include them in addon links.
const LOGIN_USER = process.env.CINEMACITY_USERNAME || '';
const LOGIN_PASS = process.env.CINEMACITY_PASSWORD || '';
let currentSession = null;
let sessionExpires = 0;
function cookieHeader(values) {
  return values.map(v => v.split(';')[0].trim()).filter(v => /^[^=;]+=[^;]*$/.test(v)).join('; ');
}
async function obtainSession() {
  if (COOKIE) return COOKIE;
  if (process.env.CINEMACITY_ENABLE_LOGIN !== 'true' || !LOGIN_USER || !LOGIN_PASS) return '';
  if (currentSession && Date.now() < sessionExpires) return currentSession;
  const body = new URLSearchParams({
    login_name: LOGIN_USER,
    login_password: LOGIN_PASS,
    login: 'submit',
  });
  // DataLife Engine commonly accepts its login form at this endpoint.
  // The precise workflow for this CinemaCity installation is not verified.
  const { response: r } = await requestText(BASE + '/index.php?do=login', {
    service: 'cinemacity', stage: 'login', allowRedirect: false,
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const values = r.headers.getSetCookie?.() || (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  const result = cookieHeader(values);
  if (!result || !/dle_user_id=/.test(result) || !/dle_password=|dle_hash=/.test(result)) throw new UpstreamError({service:'cinemacity',stage:'login',kind:'session_unconfirmed'});
  currentSession = result;
  sessionExpires = Date.now() + 10 * 60 * 1000;
  return result;
}
async function fetchText(url, stage) {
  if (new URL(url).origin !== new URL(BASE).origin) throw new UpstreamError({ service:'cinemacity', stage, kind:'unsafe_url' });
  const session = await obtainSession();
  const requestHeaders = { ...headers, ...(session ? {Cookie:session} : {}) };
  return (await requestText(url, { headers: requestHeaders, stage })).text;
}
async function tmdbJson(url, stage) {
  const { text } = await requestText(url, {service:'tmdb', stage});
  try { return JSON.parse(text); } catch { throw new UpstreamError({service:'tmdb',stage,kind:'invalid_json'}); }
}
async function tmdbInfo(type, id) {
  if (!API_KEY) throw new Error('Falta TMDB_API_KEY');
  const kind = type === 'series' ? 'tv' : 'movie';
  let tmdbId = id;
  if (/^tt\d+$/.test(id)) {
    const result = await tmdbJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?external_source=imdb_id&api_key=${encodeURIComponent(API_KEY)}`, 'lookup');
    tmdbId = result[kind === 'tv' ? 'tv_results' : 'movie_results']?.[0]?.id;
  } else if (id.startsWith('tmdb:')) tmdbId = id.slice(5);
  if (!/^\d+$/.test(String(tmdbId || ''))) throw new Error('ID no compatible');
  const data = await tmdbJson(`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(API_KEY)}`, 'title');
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
    const labelMatches = (label, long, short, number) => new RegExp(`\\b(?:${long}\\s*|${short})0*${Number(number)}(?!\\d)`, 'i').test(label || '');
    const s = data.find(x => labelMatches(x.title, 'Season', 'S', season));
    file = s?.folder?.find(x => labelMatches(x.title, 'Episode', 'E', episode))?.file;
  }
  if (typeof file !== 'string') return [];
  const urls = file.includes('.urlset/master.m3u8') ? [file] : (file.includes('[') ? file.split(',') : [file]);
  return urls.flatMap(raw => {
    const m=raw.trim().match(/^\[([^\]]+)\](.*)$/);
    const url=(m?m[2]:raw).trim();
    if (!/^https?:\/\//i.test(url)) return [];
    const hint = { proxyHeaders: { request: { Referer: BASE + '/', 'User-Agent': headers['User-Agent'] } } };
    return [{ name: 'CinemaCity', title: `${title} · ${m?.[1] || quality(url)}`, url, behaviorHints: hint }];
  });
}
const manifest = {
  id: 'community.cinemacity.bridge', version: '1.1.0', name: 'CinemaCity Bridge (no oficial)',
  description: 'Adaptación experimental del proveedor CinemaCity de Nuvio. Requiere TMDB_API_KEY; la disponibilidad depende del sitio origen.',
  resources: ['stream'], types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'], catalogs: [],
  behaviorHints: { configurable: true }
};
const builder = new addonBuilder(manifest);
const streamHandler = async ({type, id}) => {
  try {
    if (!['movie','series'].includes(type)) return { streams: [] };
    let [mediaId, season, episode] = id.split(':');
    if (id.startsWith('tmdb:')) [mediaId, season, episode] = [`tmdb:${id.split(':')[1]}`, ...id.split(':').slice(2)];
    if (!/^(?:tt\d+|tmdb:\d+)$/.test(mediaId) || (type === 'series' && (!/^\d+$/.test(season || '') || !/^\d+$/.test(episode || '')))) return {streams:[]};
    const title = await tmdbInfo(type, mediaId);
    if (!title) return { streams: [] };
    const searchUrl = `${BASE}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(title)}`;
    let page = findTitlePage(await fetchText(searchUrl, 'search'), title);
    if (!page) page = findTitlePage(await fetchText(BASE, 'home'), title);
    if (!page) { console.warn('CinemaCity sin coincidencia:',title); return { streams: [] }; }
    const payload = decodePayload(await fetchText(page, 'detail'));
    if (!payload) console.warn('CinemaCity no encontró datos de reproducción:',title);
    const streams=toStreams(payload,title,type,season,episode);
    console.info('CinemaCity streams encontrados:',streams.length);
    return { streams };
  } catch (err) {
    console.error('CinemaCity:', err instanceof UpstreamError ? err.diagnostic : {kind: 'addon_error'});
    return { streams: [] };
  }
};
builder.defineStreamHandler(streamHandler);
module.exports = { manifest, streamHandler };
if (require.main === module) {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`CinemaCity bridge: http://127.0.0.1:${PORT}/manifest.json`);
}
