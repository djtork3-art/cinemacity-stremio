'use strict';
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { createLocalProvider } = require('./lib/local-provider');
const { requestText, UpstreamError } = require('./lib/http');
const { signIn } = require('./lib/session');

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
let loginPending = null;
let retryAfter = 0;
let lastLoginDiagnostic;
async function obtainSession() {
  if (COOKIE || process.env.CINEMACITY_ENABLE_LOGIN !== 'true' || !LOGIN_USER || !LOGIN_PASS) return null;
  if (currentSession && Date.now() < sessionExpires) return currentSession;
  if (loginPending) return loginPending;
  if (Date.now() < retryAfter) throw new UpstreamError({...lastLoginDiagnostic, cooldown:true});
  loginPending = signIn({base:BASE,username:LOGIN_USER,password:LOGIN_PASS,headers}).then(session => {
    currentSession = session;
    sessionExpires = Date.now()+10*60*1000;
    return session;
  }).catch(error => {
    currentSession = null;
    retryAfter = Date.now()+60000;
    lastLoginDiagnostic = error.diagnostic || {service:'cinemacity',stage:'login',kind:'session_unconfirmed'};
    throw error;
  }).finally(()=>{loginPending=null;});
  return loginPending;
}
async function fetchText(url, stage) {
  if (new URL(url).origin !== new URL(BASE).origin) throw new UpstreamError({ service:'cinemacity', stage, kind:'unsafe_url' });
  const cookieJar = await obtainSession();
  return (await requestText(url, { headers, cookieJar, stage })).text;
}
async function metadataJson(url,service,stage) {
  const {text}=await requestText(url,{service,stage});
  try { return JSON.parse(text); } catch { throw new UpstreamError({service,stage,kind:'invalid_json'}); }
}
const yearOf=value=>String(value || '').match(/^\d{4}/)?.[0] || null;
async function mediaInfo(type,id) {
  const kind=type==='series'?'tv':'movie';
  try {
    if(!API_KEY) throw new UpstreamError({service:'tmdb',stage:'configuration',kind:'missing_api_key'});
    let tmdbId=id.startsWith('tmdb:')?id.slice(5):null;
    if(!tmdbId) {
      const found=await metadataJson(`https://api.themoviedb.org/3/find/${id}?external_source=imdb_id&api_key=${encodeURIComponent(API_KEY)}`,'tmdb','lookup');
      tmdbId=found[kind==='tv'?'tv_results':'movie_results']?.[0]?.id;
    }
    if(!/^\d+$/.test(String(tmdbId || ''))) throw new UpstreamError({service:'tmdb',stage:'lookup',kind:'metadata_not_found'});
    const data=await metadataJson(`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(API_KEY)}`,'tmdb','title');
    if(!(data.title || data.name)) throw new UpstreamError({service:'tmdb',stage:'title',kind:'metadata_not_found'});
    return {title:data.title || data.name,originalTitle:data.original_title || data.original_name,year:yearOf(data.release_date || data.first_air_date),mediaType:kind};
  } catch(error) {
    if(!/^tt\d+$/.test(id)) throw error;
    const {meta}=await metadataJson(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`,'cinemeta','title');
    if(!meta?.name) throw new UpstreamError({service:'cinemeta',stage:'title',kind:'metadata_not_found'});
    return {title:meta.name,originalTitle:meta.original_name,year:yearOf(meta.year || meta.releaseInfo),mediaType:kind};
  }
}
const provider=createLocalProvider({base:BASE,fetchSite:fetchText,userAgent:headers['User-Agent']});
const manifest={
  id:'community.cinemacity.bridge',version:'1.3.0',name:'CinemaCity Bridge (no oficial)',
  description:'CinemaCity para Stremio. Catálogo y extracción adaptados del addon local; disponibilidad dependiente del acceso autorizado al origen.',
  resources:['stream'],types:['movie','series'],idPrefixes:['tt','tmdb:'],catalogs:[],behaviorHints:{configurable:true}
};
const builder=new addonBuilder(manifest);
const streamHandler=async({type,id})=>{
  try {
    if(!['movie','series'].includes(type)) return {streams:[]};
    let [mediaId,season,episode]=String(id || '').split(':');
    if(String(id).startsWith('tmdb:')) [mediaId,season,episode]=[`tmdb:${id.split(':')[1]}`,...id.split(':').slice(2)];
    if(!/^(?:tt\d+|tmdb:\d+)$/.test(mediaId) || (type==='series'&&(!/^\d+$/.test(season || '')||!/^\d+$/.test(episode || '')))) return {streams:[]};
    const media=await mediaInfo(type,mediaId);
    return {streams:await provider.getStreams({...media,season:season===undefined?null:Number(season),episode:episode===undefined?null:Number(episode)})};
  } catch(error) {
    const diagnostic=error instanceof UpstreamError?error.diagnostic:{kind:'addon_error'};
    if(diagnostic.kind==='login_required' && currentSession) {
      currentSession=null;sessionExpires=0;retryAfter=Date.now()+60000;lastLoginDiagnostic=diagnostic;
    }
    console.error('CinemaCity:',diagnostic);
    return {streams:[]};
  }
};
builder.defineStreamHandler(streamHandler);
module.exports={manifest,streamHandler};
if(require.main===module) {
  serveHTTP(builder.getInterface(),{port:PORT});
  console.log(`CinemaCity bridge: http://127.0.0.1:${PORT}/manifest.json`);
}
