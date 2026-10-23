'use strict';
// Adapted from the user's working local CinemaCity addon (2026-10-23).
// Only catalog/player logic is imported. No Chrome, browser cookies or API keys.
const cheerio = require('cheerio');
const { UpstreamError } = require('./http');
const { authenticationState } = require('./site');

function createLocalProvider({ base, fetchSite, userAgent }) {
  const STREAM_HEADERS = { 'User-Agent':userAgent, Referer:base+'/', Origin:base };
  const QUALITY_RANK = { '4K':0, '1080p':1, '720p':2, '480p':3, '360p':4, HD:5, Auto:6 };
  let catalog = null, expires = 0, pending = null;

  function normalizeTitle(value) {
    return String(value || '')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  function titleScore(found, wanted, context, year) {
    const a = normalizeTitle(found);
    const b = normalizeTitle(wanted);
    if (!a || !b) return 0;

    const foundTokens = a.split(' ');
    const wantedTokens = b.split(' ');
    let score = 0;

    if (a === b) {
      score = 100;
    } else if (
      wantedTokens.length >= 2 &&
      wantedTokens.every((token, index) => token === foundTokens[index])
    ) {
      score = 70;
    } else if (b.length >= 4 && a.includes(b)) {
      score = 55;
    } else if (a.length >= 4 && b.includes(a)) {
      score = 45;
    } else {
      return 0;
    }

    const foundYear = String(context || '').match(/\b(19|20)\d{2}\b/);
    if (year && foundYear) {
      score += foundYear[0] === String(year) ? 20 : -10;
    }

    return score;
  }


  function parseCatalogUrl(url) {
    const match = String(url || '').match(
      /\/(movies|tv-series)\/(\d+)-([^/]+?)\.html(?:[?#].*)?$/i
    );

    if (!match) return null;

    const type = match[1].toLowerCase() === 'movies' ? 'movie' : 'series';
    let slug = match[3];

    try {
      slug = decodeURIComponent(slug);
    } catch {
      // Keep the raw slug.
    }

    const yearMatch = slug.match(/-((?:19|20)\d{2})$/);
    const year = yearMatch ? yearMatch[1] : null;
    if (yearMatch) slug = slug.slice(0, -5);

    const title = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) return null;

    return { url: String(url), type, title, year };
  }


  function pickCatalogEntry(entries, title, year, mediaType) {
    const wantedType = mediaType === 'tv' ? 'series' : 'movie';
    const preferred = entries.filter((entry) => entry.type === wantedType);
    const pool = preferred;
    let best = null;

    for (const entry of pool) {
      const context = entry.year || entry.url;
      const score = titleScore(entry.title, title, context, year);

      if (score > 0 && (!best || score > best.score)) {
        best = { entry, score };
      }
    }

    return best;
  }


  function decodeBase64(value) {
    try {
      return Buffer.from(String(value), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  function readJsValue(text, start) {
    let index = start;

    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) return '';

    const first = text[index];

    if (first === '"' || first === "'") {
      const quote = first;
      let escaped = false;

      for (let i = index + 1; i < text.length; i += 1) {
        const char = text[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\') {
          escaped = true;
          continue;
        }

        if (char === quote) {
          return text.slice(index, i + 1);
        }
      }

      return '';
    }

    if (first === '[' || first === '{') {
      const open = first;
      const close = first === '[' ? ']' : '}';
      let depth = 0;
      let quote = null;
      let escaped = false;

      for (let i = index; i < text.length; i += 1) {
        const char = text[i];

        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = null;
          continue;
        }

        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }

        if (char === open) {
          depth += 1;
        } else if (char === close) {
          depth -= 1;
          if (depth === 0) return text.slice(index, i + 1);
        }
      }

      return '';
    }

    const end = text.slice(index).search(/[,;\r\n}]/);
    return end === -1 ? text.slice(index) : text.slice(index, index + end);
  }

  function parseLooseValue(text) {
    let index = 0;

    const skip = () => {
      while (index < text.length && /\s/.test(text[index])) index += 1;
    };

    const parseString = () => {
      const quote = text[index];
      index += 1;
      let out = '';

      while (index < text.length) {
        const char = text[index];
        index += 1;

        if (char === quote) return out;

        if (char === '\\') {
          const next = text[index];
          index += 1;

          if (next === 'n') out += '\n';
          else if (next === 'r') out += '\r';
          else if (next === 't') out += '\t';
          else if (next === 'b') out += '\b';
          else if (next === 'f') out += '\f';
          else if (next === 'u') {
            const hex = text.slice(index, index + 4);
            if (/^[0-9a-f]{4}$/i.test(hex)) {
              out += String.fromCharCode(parseInt(hex, 16));
              index += 4;
            } else {
              out += 'u';
            }
          } else if (next !== '\n' && next !== '\r') {
            out += next;
          }
        } else {
          out += char;
        }
      }

      throw new Error('unterminated string');
    };

    const parseKey = () => {
      skip();
      if (text[index] === '"' || text[index] === "'") return parseString();

      const start = index;
      while (index < text.length && /[A-Za-z0-9_$-]/.test(text[index])) index += 1;
      return text.slice(start, index);
    };

    const parseArray = () => {
      index += 1;
      const out = [];
      skip();
      if (text[index] === ']') {
        index += 1;
        return out;
      }

      while (index < text.length) {
        out.push(parseValue());
        skip();

        if (text[index] === ',') {
          index += 1;
          skip();
          if (text[index] === ']') {
            index += 1;
            break;
          }
          continue;
        }

        if (text[index] === ']') {
          index += 1;
          break;
        }

        throw new Error('invalid array');
      }

      return out;
    };

    const parseObject = () => {
      index += 1;
      const out = {};
      skip();
      if (text[index] === '}') {
        index += 1;
        return out;
      }

      while (index < text.length) {
        const key = parseKey();
        skip();
        if (text[index] !== ':') throw new Error('invalid object');
        index += 1;
        out[key] = parseValue();
        skip();

        if (text[index] === ',') {
          index += 1;
          skip();
          if (text[index] === '}') {
            index += 1;
            break;
          }
          continue;
        }

        if (text[index] === '}') {
          index += 1;
          break;
        }

        throw new Error('invalid object');
      }

      return out;
    };

    const parseValue = () => {
      skip();
      const char = text[index];

      if (char === '"' || char === "'") return parseString();
      if (char === '[') return parseArray();
      if (char === '{') return parseObject();

      const start = index;
      while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
      const token = text.slice(start, index);

      if (!token) throw new Error('unexpected input');
      if (token === 'true') return true;
      if (token === 'false') return false;
      if (token === 'null' || token === 'undefined') return null;

      const number = Number(token);
      return Number.isNaN(number) ? token : number;
    };

    const result = parseValue();
    skip();
    if (index < text.length) throw new Error('trailing data');
    return result;
  }

  function parseJsValue(raw) {
    const text = raw.trim();
    if (!text) return null;
    if (text[0] === '"' || text[0] === "'") {
      if (text[0] === '"') {
        try {
          return JSON.parse(text);
        } catch {
          return text.slice(1, -1).replace(/\\(.)/g, '$1');
        }
      }
      return text.slice(1, -1).replace(/\\(.)/g, '$1');
    }

    if (text[0] === '[' || text[0] === '{') {
      try {
        return JSON.parse(text);
      } catch {
        try {
          return parseLooseValue(text);
        } catch {
          return text;
        }
      }
    }

    return text;
  }

  function isUsableFileValue(value) {
    if (typeof value === 'string') return value.trim().length > 5;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Boolean(value.file || value.folder);
    return false;
  }

  function looksLikeMedia(value) {
    if (typeof value === 'string') return /https?:\/\//i.test(value) || /\.m3u8|\.mp4/i.test(value);
    try {
      return /https?:\/\//i.test(JSON.stringify(value));
    } catch {
      return false;
    }
  }

  function extractFileValue(decoded) {
    const regex = /\bfile\s*:/g;
    let fallback = null;
    let match;

    while ((match = regex.exec(decoded)) !== null) {
      const raw = readJsValue(decoded, regex.lastIndex);
      if (!raw) continue;

      const value = parseJsValue(raw);
      if (!isUsableFileValue(value)) continue;
      if (looksLikeMedia(value)) return value;
      if (!fallback) fallback = value;
    }

    return fallback;
  }

  function coerceFileData(value) {
    if (value == null) return null;

    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return null;

      if ((text.startsWith('[') || text.startsWith('{')) && text.length > 5) {
        try {
          return JSON.parse(text);
        } catch {
          try {
            return parseLooseValue(text);
          } catch {
            return text;
          }
        }
      }

      return text;
    }

    return value;
  }

  function extractFileData(html) {
    const $ = cheerio.load(html);
    let result = null;
    let empty = false;

    $('script').each((_, element) => {
      if (result) return false;

      const script = $(element).html() || '';
      if (!script.includes('atob')) return;

      const regex = /atob\s*\(\s*(['"])([\s\S]*?)\1\s*\)/g;
      let match;

      while ((match = regex.exec(script)) !== null) {
        const decoded = decodeBase64(match[2]);
        if (!decoded) continue;
        if (/\bfile\s*:\s*(['"])\1/.test(decoded)) empty = true;

        const value = extractFileValue(decoded);
        if (value == null) continue;

        result = coerceFileData(value);
        if (result) break;
      }
    });

    return { data:result, empty };
  }

  function matchesSeason(season, title) {
    if (season == null) return false;
    const regex = new RegExp(`\\b(?:season|s)\\s*0*${season}\\b`, 'i');
    return regex.test(String(title || ''));
  }

  function matchesEpisode(episode, title) {
    if (episode == null) return false;
    const regex = new RegExp(`\\b(?:episode|e)\\s*0*${episode}\\b`, 'i');
    return regex.test(String(title || ''));
  }

  function collectEpisodeFiles(nodes, season, episode, inSeason, files) {
    if (!Array.isArray(nodes)) return;

    for (const node of nodes) {
      if (!inSeason || !node || node.file == null) continue;
      if (matchesEpisode(episode, node.title || node.name)) {
        files.push(node.file);
      }
    }

    if (files.length) return;

    for (const node of nodes) {
      if (!node || !Array.isArray(node.folder)) continue;
      if (/\b(?:season|s)\s*\d+\b/i.test(node.title || node.name || '') && !matchesSeason(season,node.title || node.name)) continue;
      const childInSeason = inSeason || matchesSeason(season, node.title || node.name);
      collectEpisodeFiles(node.folder, season, episode, childInSeason, files);
      if (files.length) return;
    }

    if (inSeason) {
      const episodes = nodes.filter((node) => node && node.file != null);
      if (!episodes.some(node=>/\b(?:episode|e)\s*\d+\b/i.test(node.title || node.name || '')) && episodes.length >= episode) {
        files.push(episodes[episode - 1].file);
      }
    }
  }

  function findEpisodeFiles(data, season, episode) {
    const roots = Array.isArray(data)
      ? data
      : data && Array.isArray(data.folder)
        ? data.folder
        : [];

    if (!roots.length) return [];

    const seasonNode = roots.find(
      (node) => node && matchesSeason(season, node.title || node.name)
    );
    let scope = roots;
    let inSeason = season === 1 && roots.every(node=>!node?.folder);

    if (seasonNode) {
      inSeason = true;
      if (Array.isArray(seasonNode.folder)) scope = seasonNode.folder;
      else if (seasonNode.file != null) return [seasonNode.file];
      else scope = [];
    }

    const files = [];
    collectEpisodeFiles(scope, season, episode, inSeason, files);
    return files;
  }

  function collectMovieFiles(data) {
    const files = [];

    const visit = (value) => {
      if (typeof value === 'string') {
        if (value.trim()) files.push(value);
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }

      if (value && typeof value === 'object') {
        if (typeof value.file === 'string') visit(value.file);
        else if (Array.isArray(value.folder)) visit(value.folder);
      }
    };

    visit(data);
    return files;
  }

  function extractQuality(url) {
    const low = String(url || '').toLowerCase();
    if (low.includes('2160') || low.includes('4k')) return '4K';
    if (low.includes('1080')) return '1080p';
    if (low.includes('720')) return '720p';
    if (low.includes('480')) return '480p';
    if (low.includes('360')) return '360p';
    if (low.includes('master.m3u8') || low.includes('.urlset/')) return 'Auto';
    return 'HD';
  }

  function normalizeQuality(label, url) {
    const raw = String(label || '').trim();
    const low = raw.toLowerCase();

    if (/2160|4k|uhd/.test(low)) return '4K';
    if (/1080/.test(low)) return '1080p';
    if (/720/.test(low)) return '720p';
    if (/480/.test(low)) return '480p';
    if (/360/.test(low)) return '360p';
    if (low === 'auto' || /master\.m3u8/i.test(url)) return 'Auto';
    if (raw) return raw;

    return extractQuality(url);
  }

  function addStream(url, displayTitle, quality, streams, seen) {
    let clean = String(url || '').trim();
    clean = clean.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    clean = clean.replace(/^["'<\s]+|["'>\s]+$/g, '').replace(/[\]"']+$/g, '');

    if (!/^https?:\/\//i.test(clean) || clean.length < 15) return;
    if (seen.has(clean)) return;
    seen.add(clean);

    const finalQuality = normalizeQuality(quality, clean);

    streams.push({
      rank: QUALITY_RANK[finalQuality] == null ? 7 : QUALITY_RANK[finalQuality],
      stream: {
        name: 'CinemaCity',
        title: `${finalQuality} | ${displayTitle}`,
        url: clean,
        behaviorHints: {
          notWebReady: true,
          bingeGroup: 'cinemacity',
          proxyHeaders: { request: STREAM_HEADERS }
        },
        headers: STREAM_HEADERS
      }
    });
  }

  function processFileValue(value, displayTitle, streams, seen) {
    if (Array.isArray(value)) {
      for (const item of value) processFileValue(item, displayTitle, streams, seen);
      return;
    }

    if (value && typeof value === 'object') {
      if (typeof value.file === 'string') {
        processFileValue(value.file, displayTitle, streams, seen);
      } else if (Array.isArray(value.folder)) {
        processFileValue(value.folder, displayTitle, streams, seen);
      }
      return;
    }

    if (typeof value !== 'string') return;

    const text = value.trim();
    if (!text) return;

    if ((text.startsWith('[') || text.startsWith('{')) && text.length > 5) {
      try {
        processFileValue(JSON.parse(text), displayTitle, streams, seen);
        return;
      } catch {
        try {
          processFileValue(parseLooseValue(text), displayTitle, streams, seen);
          return;
        } catch {
          // Keep treating it as a plain string.
        }
      }
    }

    // Commas inside a URLset are part of one HLS URL, not quality separators.
    if (/\.urlset\/master\.m3u8/i.test(text)) {
      const labeled = text.match(/^\[([^\]]+)\](https?:\/\/.*)$/);
      addStream(labeled ? labeled[2] : text,displayTitle,labeled ? labeled[1] : '',streams,seen);
      return;
    }
    const labeled = [
      ...text.matchAll(/\[([^\]\r\n]{1,24})\]\s*(https?:\/\/[^\s"'<>,[\]]+)/g)
    ];
    if (labeled.length) {
      for (const match of labeled) addStream(match[2],displayTitle,match[1],streams,seen);
      return;
    }
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean);

    if (parts.length > 1) {
      for (const part of parts) {
        if (/^https?:\/\//i.test(part)) addStream(part, displayTitle, '', streams, seen);
      }
      return;
    }

    const urls = text.match(/https?:\/\/[^\s"'<>,[\]]+/g) || [];
    for (const url of urls) {
      addStream(url, displayTitle, '', streams, seen);
    }
  }

  function formatDisplayTitle(media) {
    const base = media.title || media.originalTitle || 'CinemaCity';

    if (
      media.mediaType === 'tv' &&
      media.season != null &&
      media.episode != null
    ) {
      const season = String(media.season).padStart(2, '0');
      const episode = String(media.episode).padStart(2, '0');
      return `${base} S${season}E${episode}`;
    }

    return media.year ? `${base} (${media.year})` : base;
  }


  async function loadCatalog() {
    if (catalog && Date.now() < expires) return catalog;
    if (pending) return pending;
    pending = (async () => {
      const xml = await fetchSite(base+'/news_pages.xml', 'catalog');
      const $ = cheerio.load(xml, {xmlMode:true});
      const entries = $('loc').toArray().flatMap(el => {
        try {
          const url = new URL($(el).text().trim(), base);
          if (url.origin !== new URL(base).origin || url.username || url.password) return [];
          const entry = parseCatalogUrl(url.href);
          return entry ? [entry] : [];
        } catch { return []; }
      });
      if (!entries.length) throw new UpstreamError({service:'cinemacity',stage:'catalog',kind:'catalog_empty'});
      catalog = entries;
      expires = Date.now()+12*60*60*1000;
      return catalog;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function getStreams(media) {
    if (media.mediaType === 'tv' && (media.season == null || media.episode == null)) return [];
    const entries = await loadCatalog();
    let best = null;
    for (const title of new Set([media.title,media.originalTitle].filter(Boolean))) {
      const candidate = pickCatalogEntry(entries,title,media.year,media.mediaType);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
    if (!best) return [];
    const html = await fetchSite(best.entry.url,'detail');
    const { data:fileData, empty } = extractFileData(html);
    if (!fileData) {
      const kind = authenticationState(html) === false ? 'login_required' : empty ? 'empty_player_file' : 'player_payload_missing';
      throw new UpstreamError({service:'cinemacity',stage:'detail',kind});
    }
    const files = media.mediaType === 'tv' ? findEpisodeFiles(fileData,media.season,media.episode) : collectMovieFiles(fileData);
    const streams = [], seen = new Set();
    for (const file of files) processFileValue(file,formatDisplayTitle(media),streams,seen);
    streams.sort((a,b)=>a.rank-b.rank);
    return streams.map(item=>item.stream);
  }
  return { getStreams };
}
module.exports = { createLocalProvider };
