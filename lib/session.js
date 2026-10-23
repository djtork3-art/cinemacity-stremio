'use strict';
const { requestText, UpstreamError } = require('./http');
const { authenticationState, loginForm } = require('./site');

// A private, in-memory jar for the exact configured HTTPS host. No browser imports.
class SiteCookies {
  constructor(base) { this.origin = new URL(base).origin; this.values = new Map(); }
  store(url, headers) {
    const target = new URL(url);
    if (target.origin !== this.origin) return;
    for (const value of headers.getSetCookie?.() || []) {
      const [pair, ...attributes] = value.split(';');
      const split = pair.indexOf('=');
      if (split < 1) continue;
      const name = pair.slice(0,split).trim(), content = pair.slice(split+1).trim();
      if (!/^[!#$%&'*+\-.^_`|~\w]+$/.test(name) || /[\r\n]/.test(content)) continue;
      const attrs = new Map(attributes.map(a => {
        const index = a.indexOf('=');
        return index < 0 ? [a.trim().toLowerCase(),''] : [a.slice(0,index).trim().toLowerCase(),a.slice(index+1).trim()];
      }));
      if (attrs.has('domain') && attrs.get('domain').replace(/^\./,'').toLowerCase() !== target.hostname.toLowerCase()) continue;
      const defaultPath = target.pathname.slice(0,target.pathname.lastIndexOf('/')+1) || '/';
      const path = attrs.get('path')?.startsWith('/') ? attrs.get('path') : defaultPath;
      let expires = Infinity;
      if (attrs.has('expires')) { const time = Date.parse(attrs.get('expires')); if (Number.isFinite(time)) expires = time; }
      if (/^-?\d+$/.test(attrs.get('max-age') || '')) expires = Date.now()+Number(attrs.get('max-age'))*1000;
      const key = `${name}\n${path}`;
      if (!content || expires <= Date.now()) this.values.delete(key);
      else this.values.set(key,{name,content,path,expires});
    }
  }
  header(url) {
    const target = new URL(url);
    if (target.origin !== this.origin) return '';
    return [...this.values.values()].filter(c => c.expires > Date.now() &&
      (target.pathname === c.path || target.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path+'/')))
      .sort((a,b)=>b.path.length-a.path.length).map(c=>`${c.name}=${c.content}`).join('; ');
  }
}
async function signIn({ base, username, password, headers }) {
  const cookieJar = new SiteCookies(base);
  const options = {cookieJar, headers, service:'cinemacity'};
  const page = await requestText(base+'/', {...options, stage:'login_form'});
  const { action, fields } = loginForm(page.text,base);
  fields.set('login_name',username);
  fields.set('login_password',password);
  const submitted = await requestText(action, {...options, stage:'login', method:'POST', body:fields,
    headers:{...headers,'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'}, allowRedirect:false});
  if (submitted.diagnostic.kind === 'redirect') {
    const location = submitted.response.headers.get('location');
    const next = location && new URL(location,action);
    if (!next || next.origin !== new URL(base).origin || next.username || next.password) {
      throw new UpstreamError({service:'cinemacity',stage:'login',kind:'redirect_rejected'});
    }
  }
  const verified = await requestText(base+'/', {...options,stage:'login_verify'});
  if (authenticationState(verified.text) !== true || !cookieJar.header(base+'/')) {
    throw new UpstreamError({service:'cinemacity',stage:'login_verify',kind:'session_unconfirmed'});
  }
  return cookieJar;
}
module.exports = { signIn, SiteCookies };
