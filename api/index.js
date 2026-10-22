'use strict';
const { manifest, streamHandler } = require('../index');
const landing = require('../landing');
function config(value) {
  const m = /^m([01])s([01])q(all|4k|1080p|720p|hd)$/.exec(value || '');
  if (!m) return null;
  return { movies: m[1]==='1', series: m[2]==='1', quality: m[3] };
}
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const path = String(req.query.path || '').replace(/^\/+/, '');
  if (!path) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).send(landing); }
  const parts = path.match(/^(?:c\/([^/]+)\/)?(.*)$/);
  const chosen = parts[1] ? config(parts[1]) : {movies:true,series:true,quality:'all'};
  if (!chosen) return res.status(404).json({ error: 'Invalid configuration' });
  const endpoint = parts[2];
  if (endpoint === 'manifest.json') {
    return res.status(200).json({...manifest, behaviorHints:{...manifest.behaviorHints, configurable:true}, types:[...(chosen.movies?['movie']:[]),...(chosen.series?['series']:[])]});
  }
  const match = endpoint.match(/^stream\/(movie|series)\/([^/]+)\.json$/);
  if (!match) return res.status(404).json({ error: 'Not found' });
  if ((match[1]==='movie'&&!chosen.movies)||(match[1]==='series'&&!chosen.series)) return res.status(200).json({streams:[]});
  try {
    const result = await streamHandler({ type:match[1], id:decodeURIComponent(match[2]) });
    const streams = (result.streams||[]).filter(s=>{
      if(chosen.quality==='all')return true;
      const desc=(s.title||'').toLowerCase();
      if(chosen.quality==='hd')return !/(4k|2160p|1080p|720p)/.test(desc);
      if(chosen.quality==='4k')return /4k|2160p/.test(desc);
      return desc.includes(chosen.quality);
    });
    return res.status(200).json({ streams });
  } catch (e) { console.error('stream handler:',e); return res.status(200).json({streams:[]}); }
};
