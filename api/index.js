'use strict';
const { manifest, streamHandler } = require('../index');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const path = String(req.query.path || '').replace(/^\/+/, '');
  if (path === 'manifest.json') return res.status(200).json(manifest);
  const match = path.match(/^stream\/(movie|series)\/([^/]+)\.json$/);
  if (!match) return res.status(404).json({ error: 'Not found' });
  try {
    return res.status(200).json(await streamHandler({ type: match[1], id: decodeURIComponent(match[2]) }));
  } catch (e) {
    console.error('stream handler:', e);
    return res.status(200).json({ streams: [] });
  }
};
