'use strict';
const { requestText, networkDiagnostic } = require('./http');
let cached;
let expires = 0;
let pending;
async function health() {
  if (cached && Date.now() < expires) return cached;
  if (pending) return pending;
  pending = (async () => {
    const base = (process.env.CINEMACITY_URL || 'https://cinemacity.cc').replace(/\/$/, '');
    const check = async (path, stage) => {
      try {
        const { diagnostic } = await requestText(base + path, {stage, timeoutMs:8000, maxBytes:512 * 1024, allowRedirect:false});
        return { reachable:true, ...diagnostic };
      } catch (e) {
        const diagnostic = e.diagnostic || networkDiagnostic(e);
        return { reachable:Boolean(diagnostic.httpStatus), ...diagnostic };
      }
    };
    const [publicPage, loginPage] = await Promise.all([check('/', 'public'), check('/index.php?do=register', 'login_page')]);
    cached = {
      addon:'CinemaCity', version:require('../package.json').version, checkedAt:new Date().toISOString(),
      runtime:{ node:process.versions.node, undici:process.versions.undici || null, openssl:process.versions.openssl },
      tmdbConfigured:Boolean(process.env.TMDB_API_KEY),
      loginConfigured:Boolean(process.env.CINEMACITY_USERNAME && process.env.CINEMACITY_PASSWORD),
      loginEnabled:process.env.CINEMACITY_ENABLE_LOGIN === 'true',
      publicPage, loginPage,
      authentication:{verified:false, status:'not_tested'}, authenticatedSearch:{verified:false,status:'not_tested'}
    };
    expires = Date.now() + 30000;
    return cached;
  })();
  try { return await pending; } finally { pending = null; }
}
module.exports = { health };
