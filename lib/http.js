'use strict';

// Never put URLs, bodies, cookies or raw exception messages in diagnostics.
class UpstreamError extends Error {
  constructor(diagnostic) {
    super(`Upstream ${diagnostic.service}: ${diagnostic.kind}`);
    this.name = 'UpstreamError';
    this.diagnostic = diagnostic;
  }
}
function networkDiagnostic(error) {
  const codes = [];
  const visit = (e, depth = 0) => {
    if (!e || depth > 5) return;
    for (const code of [e.code, e.name]) {
      if (/^(?:E[A-Z0-9_]+|UND_ERR_[A-Z_]+|CERT_[A-Z_]+|ERR_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|TimeoutError|AbortError)$/.test(code || '')) codes.push(code);
    }
    visit(e.cause, depth + 1);
    if (Array.isArray(e.errors)) e.errors.slice(0, 8).forEach(x => visit(x, depth + 1));
  };
  visit(error);
  const unique = [...new Set(codes)];
  const kind = unique.some(c => /TIMEOUT|TimeoutError|AbortError/.test(c)) ? 'timeout'
    : unique.some(c => /TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c)) ? 'tls_error'
    : unique.some(c => /ENOTFOUND|EAI_AGAIN/.test(c)) ? 'dns_error'
    : unique.includes('ECONNRESET') ? 'connection_reset' : 'network_error';
  return { kind, codes: unique };
}
async function readLimited(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('BODY_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function requestText(url, {
  service = 'cinemacity', stage = 'public', headers = {}, method = 'GET', body,
  timeoutMs = 12000, maxBytes = 2 * 1024 * 1024, fetchImpl = globalThis.fetch,
  allowRedirect = true
} = {}) {
  const start = Date.now();
  const initial = new URL(url);
  if (initial.protocol !== 'https:' || initial.username || initial.password) throw new UpstreamError({ service, stage, kind: 'unsafe_url' });
  const signal = AbortSignal.timeout(timeoutMs);
  let current = initial;
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await fetchImpl(current.href, { method, body, headers, redirect: 'manual', signal });
      const diagnostic = {
        service, stage, kind: 'ok', httpStatus: response.status,
        cloudflare: /cloudflare/i.test(response.headers.get('server') || ''),
        challenge: response.headers.get('cf-mitigated') === 'challenge',
        elapsedMs: Date.now() - start
      };
      if (diagnostic.challenge) {
        await response.body?.cancel();
        throw new UpstreamError({ ...diagnostic, kind: 'cloudflare_challenge' });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (!allowRedirect) return { text: '', response, diagnostic: { ...diagnostic, kind: 'redirect' } };
        const location = response.headers.get('location');
        const next = location && new URL(location, current);
        // Session cookies must never leave the configured HTTPS origin.
        if (!next || next.origin !== initial.origin || next.username || next.password || redirects >= 3) {
          throw new UpstreamError({ ...diagnostic, kind: 'redirect_rejected' });
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new UpstreamError({ ...diagnostic, kind: response.status === 403 ? 'http_forbidden' : response.status === 401 ? 'http_unauthorized' : 'http_error' });
      }
      const text = await readLimited(response, maxBytes);
      return { text, response, diagnostic: { ...diagnostic, elapsedMs: Date.now() - start } };
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const detail = error.message === 'BODY_TOO_LARGE' ? { kind: 'body_too_large' } : networkDiagnostic(error);
    throw new UpstreamError({ service, stage, ...detail, elapsedMs: Date.now() - start });
  }
}
module.exports = { requestText, networkDiagnostic, UpstreamError };
