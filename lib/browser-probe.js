'use strict';

const TARGET = 'https://cinemacity.cc/news_pages.xml';
const MAX_BYTES = 2 * 1024 * 1024;
const SAFE_KINDS = new Set([
  'ok', 'cloudflare_challenge', 'http_forbidden', 'http_unauthorized',
  'http_error', 'redirect_rejected', 'timeout', 'tls_error', 'dns_error',
  'connection_reset', 'network_error', 'body_too_large', 'unsafe_url'
]);
const CHALLENGE_MARKER = /(?:<title[^>]*>\s*(?:just a moment|un momento|attention required)|\/cdn-cgi\/challenge-platform\/|\bcf-chl-|verificaci[oó]n de seguridad en curso)/i;

function networkDiagnostic(error) {
  const codes = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 4) return;
    for (const code of [value.code, value.name]) {
      if (/^(?:E[A-Z0-9_]+|UND_ERR_[A-Z_]+|CERT_[A-Z_]+|ERR_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|TimeoutError|AbortError)$/.test(code || '')) codes.add(code);
    }
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors)) value.errors.slice(0, 8).forEach(item => visit(item, depth + 1));
  };
  visit(error);
  const list = [...codes];
  const kind = list.some(code => /TIMEOUT|TimeoutError|AbortError/.test(code)) ? 'timeout'
    : list.some(code => /TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) ? 'tls_error'
    : list.some(code => /ENOTFOUND|EAI_AGAIN/.test(code)) ? 'dns_error'
    : codes.has('ECONNRESET') ? 'connection_reset' : 'network_error';
  return {kind, ...(list.length ? {codes:list} : {})};
}

function safeDiagnostic(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {kind:SAFE_KINDS.has(source.kind) ? source.kind : 'network_error'};
  if (Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599) result.httpStatus = source.httpStatus;
  result.challenge = source.challenge === true;
  result.cloudflare = source.cloudflare === true;
  if (result.challenge) result.kind = 'cloudflare_challenge';
  return result;
}

function contentType(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return /^(?:text\/html|application\/xhtml\+xml)$/.test(type) ? 'html'
    : /^(?:application|text)\/(?:[a-z0-9.+-]+\+)?xml$/.test(type) ? 'xml' : 'other';
}

async function nodeProbe(requestText) {
  const start = Date.now();
  if (typeof requestText !== 'function') return {kind:'configuration_error',elapsedMs:Date.now()-start};
  try {
    const response = await requestText(TARGET, {
      service:'cinemacity', stage:'catalog', timeoutMs:12000,
      maxBytes:MAX_BYTES, allowRedirect:false
    });
    const result = safeDiagnostic(response?.diagnostic);
    // A redirect is not a successful comparison with the fixed browser target.
    if (result.httpStatus >= 300 && result.httpStatus < 400) result.kind = 'redirect_rejected';
    if (typeof response?.text === 'string') {
      result.bytes = Buffer.byteLength(response.text);
      if (result.bytes > MAX_BYTES) result.kind = 'body_too_large';
      else if (CHALLENGE_MARKER.test(response.text)) {
        result.challenge = true;
        result.kind = 'cloudflare_challenge';
      }
    }
    return {...result,elapsedMs:Date.now()-start};
  } catch (error) {
    const result = error?.diagnostic ? safeDiagnostic(error.diagnostic) : networkDiagnostic(error);
    return {...result,elapsedMs:Date.now()-start};
  }
}

async function browserProbe(launch) {
  const start = Date.now();
  const result = {kind:'browser_error',challenge:false,cloudflare:false};
  let browser, rejectedNavigation = false;
  try {
    if (typeof launch !== 'function') return {...result,kind:'configuration_error'};
    browser = await launch();
    try {
      const version = await browser.version();
      if (typeof version === 'string' && /^(?:HeadlessChrome|Chrome)\/\d+(?:\.\d+)*$/.test(version)) result.version = version;
    } catch { /* Version is optional; never include the raw error. */ }
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    let initialNavigation = false;
    page.on('request', async request => {
      try {
        const mainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        const allowed = mainNavigation && !initialNavigation && request.method() === 'GET'
          && request.url() === TARGET && request.redirectChain().length === 0;
        if (allowed) {
          initialNavigation = true;
          await request.continue();
        } else {
          if (mainNavigation) rejectedNavigation = true;
          await request.abort('blockedbyclient');
        }
      } catch { /* Interception errors must not produce unhandled rejections. */ }
    });
    const response = await page.goto(TARGET, {timeout:20000,waitUntil:'domcontentloaded'});
    if (!response) return {...result,kind:'navigation_failed'};
    if (rejectedNavigation || response.url() !== TARGET) return {...result,kind:'redirect_rejected'};
    const status = response.status();
    if (!Number.isInteger(status) || status < 100 || status > 599) return result;
    result.httpStatus = status;
    const headers = response.headers();
    result.challenge = headers['cf-mitigated'] === 'challenge';
    result.cloudflare = /cloudflare/i.test(String(headers.server || ''));
    result.contentType = contentType(headers['content-type']);
    if (result.challenge) return {...result,kind:'cloudflare_challenge'};
    if (Number(headers['content-length']) > MAX_BYTES) return {...result,kind:'body_too_large'};
    const buffer = await response.buffer();
    result.bytes = buffer.byteLength;
    if (result.bytes > MAX_BYTES) return {...result,kind:'body_too_large'};
    if (CHALLENGE_MARKER.test(buffer.toString('utf8'))) return {...result,kind:'cloudflare_challenge',challenge:true};
    result.kind = status >= 200 && status < 300 ? 'ok'
      : status >= 300 && status < 400 ? 'redirect_rejected'
      : status === 403 ? 'http_forbidden'
      : status === 401 ? 'http_unauthorized' : 'http_error';
    return result;
  } catch (error) {
    return {...result, ...networkDiagnostic(error), ...(rejectedNavigation ? {kind:'redirect_rejected'} : {})};
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* Cleanup must never disclose an exception. */ }
    }
    result.elapsedMs = Date.now()-start;
  }
}

async function runProbe({launch,requestText} = {}) {
  const node = await nodeProbe(requestText);
  const start = Date.now();
  const browser = await browserProbe(launch);
  browser.elapsedMs = Date.now()-start;
  return {node,browser,checkedAt:new Date().toISOString()};
}

module.exports = {runProbe,networkDiagnostic};
