'use strict';

const TARGET = 'https://cinemacity.cc/news_pages.xml';
const MAX_BYTES = 2 * 1024 * 1024;
const SAFE_KINDS = new Set([
  'ok', 'cloudflare_challenge', 'http_forbidden', 'http_unauthorized',
  'http_error', 'redirect_rejected', 'timeout', 'tls_error', 'dns_error',
  'connection_reset', 'network_error', 'body_too_large', 'unsafe_url'
]);
const CHALLENGE_MARKER = /(?:<title[^>]*>\s*(?:just a moment|un momento|attention required)|\/cdn-cgi\/challenge-platform\/|\bcf-chl-|verificaci[oó]n de seguridad en curso)/i;
// Extract only known Chromium network codes, never a free-form error message.
const CHROMIUM_CODE = /\bnet::(ERR_(?:ABORTED|BLOCKED_BY_CLIENT|NAME_NOT_RESOLVED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|TIMED_OUT|CERT_AUTHORITY_INVALID|CERT_DATE_INVALID|CERT_COMMON_NAME_INVALID|SSL_PROTOCOL_ERROR|HTTP2_PROTOCOL_ERROR|HTTP_RESPONSE_CODE_FAILURE|FAILED|TOO_MANY_REDIRECTS|TUNNEL_CONNECTION_FAILED|NETWORK_CHANGED))\b/g;

function networkDiagnostic(error) {
  const codes = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 4) return;
    for (const code of [value.code, value.name]) {
      if (/^(?:E[A-Z0-9_]+|UND_ERR_[A-Z_]+|CERT_[A-Z_]+|ERR_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|TimeoutError|AbortError)$/.test(code || '')) codes.add(code);
    }
    if (typeof value.message === 'string') {
      for (const match of value.message.matchAll(CHROMIUM_CODE)) codes.add(match[1]);
    }
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors)) value.errors.slice(0, 8).forEach(item => visit(item, depth + 1));
  };
  visit(error);
  const list = [...codes];
  const kind = list.some(code => /TIMEOUT|TIMED_OUT|TimeoutError|AbortError/.test(code)) ? 'timeout'
    : list.some(code => /TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) ? 'tls_error'
    : list.some(code => /ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/.test(code)) ? 'dns_error'
    : codes.has('ECONNRESET') || codes.has('ERR_CONNECTION_RESET') ? 'connection_reset' : 'network_error';
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

function redirectDiagnostic(value) {
  try {
    const url = new URL(value, TARGET);
    const path = url.pathname.toLowerCase();
    const keys = [...url.searchParams.keys()].map(key => key.toLowerCase());
    const destinationKind = /device[_-]?guard/.test(path) || keys.includes('cc_device_guard') ? 'device_guard'
      : /(?:\/cdn-cgi\/challenge|challenge|captcha)/.test(path) || keys.some(key => key.startsWith('__cf_chl')) ? 'challenge'
      : /\/(?:login|log-in|signin|sign-in|register)(?:[/.]|$)/.test(path) || /^(?:login|register)$/i.test(url.searchParams.get('do') || '') ? 'login' : 'other';
    return {sameOrigin:url.origin === new URL(TARGET).origin,destinationKind};
  } catch { return {sameOrigin:false,destinationKind:'other'}; }
}

function httpKind(status) {
  return status >= 200 && status < 300 ? 'ok'
    : status >= 300 && status < 400 ? 'redirect_rejected'
    : status === 403 ? 'http_forbidden'
    : status === 401 ? 'http_unauthorized' : 'http_error';
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
  const result = {kind:'browser_error',challenge:false,cloudflare:false,navigationAllowed:0,rejectedMain:0};
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
    const observeResponse = response => {
      try {
        if (result.responseObserved || response.url() !== TARGET) return;
        const request = response.request();
        if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
        const status = response.status();
        if (!Number.isInteger(status) || status < 100 || status > 599) return;
        const headers = response.headers();
        result.responseObserved = true;
        result.httpStatus = status;
        result.challenge = headers['cf-mitigated'] === 'challenge';
        result.cloudflare = /cloudflare/i.test(String(headers.server || ''));
        result.contentType = contentType(headers['content-type']);
        result.kind = result.challenge ? 'cloudflare_challenge' : httpKind(status);
        if (status >= 300 && status < 400 && typeof headers.location === 'string') result.redirect = redirectDiagnostic(headers.location);
      } catch { /* Only a complete, safe observation is recorded. */ }
    };
    page.on('response', observeResponse);
    page.on('request', async request => {
      try {
        const mainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        const reason = !mainNavigation ? 'frame_mismatch'
          : request.method() !== 'GET' ? 'wrong_method'
          : request.redirectChain().length > 0 ? 'redirect'
          : request.url() !== TARGET ? 'different_url'
          : initialNavigation ? 'repeated_navigation' : null;
        if (!reason) {
          initialNavigation = true;
          result.navigationAllowed++;
          await request.continue();
        } else {
          if (!result.firstBlockedReason) result.firstBlockedReason = reason;
          if (mainNavigation) {
            rejectedNavigation = true;
            result.rejectedMain++;
          }
          await request.abort('blockedbyclient');
        }
      } catch { /* Interception errors must not produce unhandled rejections. */ }
    });
    const response = await page.goto(TARGET, {timeout:20000,waitUntil:'domcontentloaded'});
    if (!response) return {...result,kind:result.responseObserved ? result.kind : 'navigation_failed'};
    observeResponse(response);
    if (result.challenge) return {...result,kind:'cloudflare_challenge'};
    if (rejectedNavigation || response.url() !== TARGET) return {...result,kind:result.httpStatus >= 200 && result.httpStatus < 300 && result.firstBlockedReason === 'repeated_navigation' ? 'navigation_interrupted' : 'redirect_rejected'};
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
    result.kind = httpKind(status);
    return result;
  } catch (error) {
    const diagnostic = networkDiagnostic(error);
    const kind = result.challenge ? 'cloudflare_challenge'
      : result.httpStatus >= 300 ? httpKind(result.httpStatus)
      : rejectedNavigation ? (result.httpStatus >= 200 && result.httpStatus < 300 && result.firstBlockedReason === 'repeated_navigation' ? 'navigation_interrupted' : 'redirect_rejected') : diagnostic.kind;
    return {...result,...diagnostic,kind};
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
