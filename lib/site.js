'use strict';
const cheerio = require('cheerio');
const { UpstreamError } = require('./http');

function authenticationState(html) {
  const $ = cheerio.load(html);
  for (const el of $('script:not([src])').toArray()) {
    const match = ($(el).html() || '').match(/\bCCDeviceGuardRuntime\s*=\s*\{\s*authenticated\s*:\s*(true|false)\s*\}/);
    if (match) return match[1] === 'true';
  }
  if ($('[data-cc-auth-state="user"]').length) return true;
  if ($('[data-cc-auth-state="guest"]').length) return false;
  return null;
}
function loginForm(html, base) {
  const $ = cheerio.load(html);
  const form = $('form[data-cc-login-form]').first();
  if (!form.length || (form.attr('method') || 'get').toLowerCase() !== 'post' ||
      !form.find('input[name="login_name"]').length || !form.find('input[name="login_password"]').length) {
    throw new UpstreamError({service:'cinemacity', stage:'login_form', kind:'login_form_unavailable'});
  }
  const action = new URL(form.attr('action') || base, base);
  if (action.origin !== new URL(base).origin || action.protocol !== 'https:' || action.username || action.password) {
    throw new UpstreamError({service:'cinemacity', stage:'login_form', kind:'unsafe_login_action'});
  }
  const fields = new URLSearchParams();
  form.find('input[type="hidden"][name]').each((_, el) => {
    const name = $(el).attr('name');
    if (!['login_name','login_password'].includes(name)) fields.set(name, $(el).attr('value') || '');
  });
  if (fields.get('login') !== 'submit') throw new UpstreamError({service:'cinemacity',stage:'login_form',kind:'login_form_unavailable'});
  return { action:action.href, fields };
}
module.exports = { authenticationState, loginForm };
