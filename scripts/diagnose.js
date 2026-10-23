'use strict';
const dns = require('node:dns').promises;
const tls = require('node:tls');
const https = require('node:https');
const { requestText, networkDiagnostic } = require('../lib/http');

function tlsProbe(host) {
  return new Promise(resolve => {
    const start = Date.now();
    const socket = tls.connect({ host, port:443, servername:host, rejectUnauthorized:true, ALPNProtocols:['http/1.1'] });
    const timer = setTimeout(() => { socket.destroy(); resolve({kind:'timeout',stage:'tls',elapsedMs:Date.now()-start}); }, 8000);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve({kind:'ok',stage:'tls',authorized:socket.authorized,protocol:socket.getProtocol(),alpn:socket.alpnProtocol || null,elapsedMs:Date.now()-start});
      socket.destroy();
    });
    socket.once('error', e => { clearTimeout(timer); resolve({stage:'tls',...networkDiagnostic(e),elapsedMs:Date.now()-start}); });
  });
}
function httpsProbe(url) {
  return new Promise(resolve => {
    const start = Date.now();
    const request = https.get(url, {rejectUnauthorized:true, agent:false}, response => {
      resolve({kind:'http_response',stage:'https_http1',httpStatus:response.statusCode,
        cloudflare:/cloudflare/i.test(response.headers.server || ''),challenge:response.headers['cf-mitigated'] === 'challenge',
        protocol:response.socket.getProtocol(),alpn:response.socket.alpnProtocol || null,elapsedMs:Date.now()-start});
      response.destroy();
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), {code:'ETIMEDOUT'})), 8000);
    request.once('close', () => clearTimeout(timer));
    request.once('error', e => resolve({stage:'https_http1',...networkDiagnostic(e),elapsedMs:Date.now()-start}));
  });
}
async function run() {
  const report = {checkedAt:new Date().toISOString(), platform:process.platform,
    runtime:{node:process.versions.node,undici:process.versions.undici || null,openssl:process.versions.openssl},
    environment:{nodeOptionsPresent:Boolean(process.env.NODE_OPTIONS),proxyVariablesPresent:['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].some(k=>Boolean(process.env[k]))},
    credentialMode:'none', probes:[]};
  // Intentionally ignore site credentials and API keys. A TMDB 401 proves HTTP connectivity.
  const targets = [
    ['cinemacity', 'https://cinemacity.cc/'],
    ['tmdb', 'https://api.themoviedb.org/3/configuration']
  ];
  if (process.argv[2]) {
    const addon = new URL(process.argv[2]);
    if (addon.protocol !== 'https:' || addon.username || addon.password || addon.search || addon.hash || addon.pathname !== '/') throw new Error('Usa solo el origen HTTPS público del addon, sin rutas ni credenciales.');
    targets.push(['addon_manifest',new URL('/manifest.json',addon).href],['addon_health',new URL('/health.json',addon).href]);
  }
  for (const [service, target] of targets) {
    const host = new URL(target).hostname;
    const probe = {service,host};
    if (service === 'cinemacity') {
      try { const records = await dns.lookup(host, {all:true}); probe.dns = {kind:'ok', families:[...new Set(records.map(r=>r.family))]}; }
      catch(e) { probe.dns = networkDiagnostic(e); }
      probe.tls = await tlsProbe(host);
      probe.https = await httpsProbe(target);
    }
    try {
      const result = await requestText(target,{service,stage:'fetch',timeoutMs:10000,maxBytes:512*1024});
      probe.fetch = result.diagnostic;
      if (service === 'addon_manifest') {
        const data = JSON.parse(result.text);
        probe.addon = {id:data.id,version:data.version};
      }
      if (service === 'addon_health') {
        const data = JSON.parse(result.text);
        // Only expose explicitly safe fields, never blindly echo remote JSON.
        probe.addon = {version:data.version, publicPage:data.publicPage && {
          kind:data.publicPage.kind,httpStatus:data.publicPage.httpStatus,challenge:data.publicPage.challenge,
          cloudflare:data.publicPage.cloudflare,codes:data.publicPage.codes
        }};
      }
    } catch(e) { probe.fetch = e.diagnostic || networkDiagnostic(e); }
    report.probes.push(probe);
  }
  console.log(JSON.stringify(report,null,2));
}
run().catch(() => { console.error('Diagnóstico inválido. Usa: npm run diagnose -- https://tu-addon.vercel.app'); process.exitCode=1; });
