'use strict';
const BASE='https://cinemacity.cc';
const {authenticationState,loginForm}=require('./site');
const {networkDiagnostic}=require('./http');
const {createLocalProvider}=require('./local-provider');
const MAX_BYTES=2*1024*1024;
function safeURL(value){try{const u=new URL(value);return u.origin===BASE&&!u.username&&!u.password;}catch{return false;}}
function revoked(value){try{return new URL(value).searchParams.get('cc_device_guard')==='device_revoked';}catch{return false;}}
function responseSignal(response){
  const h=response.headers(),status=response.status(),challenge=h['cf-mitigated']==='challenge';
  return {httpStatus:status,challenge,cloudflare:/cloudflare/i.test(h.server || ''),
    kind:challenge?'cloudflare_challenge':status>=200&&status<300?'ok':status===403?'http_forbidden':'http_error'};
}
async function probe({launch,username,password}){
  const result={credentialsConfigured:Boolean(username&&password),credentialsSubmitted:false,authenticated:false,cookiesImported:false};
  if(!result.credentialsConfigured)return {...result,stage:'configuration',kind:'missing_credentials',checkedAt:new Date().toISOString()};
  let browser,stage='login_form',approvedAction=null,postCount=0,denied=false;
  try{
    browser=await launch();
    const version=await browser.version();if(/^(?:HeadlessChrome|Chrome)\/\d+(?:\.\d+)*$/.test(version))result.version=version;
    const page=await browser.newPage();
    // Standard browser JavaScript; no stealth or imported browser profile.
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      try{
        const url=request.url(),method=request.method();
        if(!safeURL(url)||revoked(url)){denied=true;await request.abort('blockedbyclient');return;}
        if(request.redirectChain().length>3){denied=true;await request.abort('blockedbyclient');return;}
        if(method==='POST'){
          if(stage!=='login'||url!==approvedAction||postCount){denied=true;await request.abort('blockedbyclient');return;}
          postCount++;result.credentialsSubmitted=true;
        }else if(method!=='GET'){denied=true;await request.abort('blockedbyclient');return;}
        await request.continue();
      }catch{/* No request or secret logging. */}
    });
    async function navigate(path){
      const response=await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:15000});
      if(!response)throw Object.assign(new Error('no_response'),{code:'ERR_FAILED'});
      const signal=responseSignal(response);result[stage]=signal;
      if(!safeURL(response.url())||revoked(response.url())){signal.kind='redirect_rejected';return null;}
      const title=await page.title();
      if(signal.challenge||/^(?:just a moment|un momento|attention required)(?:[.!…\s]|$)/i.test(title)){
        signal.challenge=true;signal.kind='cloudflare_challenge';return null;
      }
      const captcha=await page.$('iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"], .g-recaptcha');
      if(captcha){signal.kind='interactive_verification';return null;}
      if(signal.kind!=='ok')return null;
      if(Number(response.headers()['content-length'])>MAX_BYTES){signal.kind='body_too_large';return null;}
      const body=await response.buffer();
      if(body.byteLength>MAX_BYTES){signal.kind='body_too_large';return null;}
      return body.toString('utf8');
    }
    const html=await navigate('/');
    if(html===null)return {...result,stage,kind:result[stage].kind};
    if(authenticationState(html)!==true){
      const form=loginForm(html,BASE);approvedAction=form.action;
      const selector='form[data-cc-login-form]';
      const live=await page.$eval(selector,form=>({method:form.method,action:form.action,hidden:form.querySelector('input[name="login"]')?.value,
        username:!!form.querySelector('input[name="login_name"]'),password:!!form.querySelector('input[name="login_password"]')}));
      if(live.method.toLowerCase()!=='post'||live.action!==approvedAction||live.hidden!=='submit'||!live.username||!live.password)
        return {...result,stage,kind:'login_form_unavailable'};
      await page.type(selector+' input[name="login_name"]',username);
      await page.type(selector+' input[name="login_password"]',password);
      stage='login';
      const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===approvedAction,{timeout:12000});
      // requestSubmit respects the site's normal submit handlers and validation.
      const [submitted]=await Promise.all([responsePromise,page.$eval(selector,form=>form.requestSubmit())]);
      result.login=responseSignal(submitted);
      if(result.login.challenge)return {...result,stage,kind:'cloudflare_challenge'};
    }
    stage='verify';const verified=await navigate('/');
    if(verified===null)return {...result,stage,kind:result[stage].kind};
    result.authenticated=authenticationState(verified)===true;
    if(!result.authenticated)return {...result,stage,kind:'session_unconfirmed'};
    stage='robots_context';
    if(await navigate('/robots.txt')===null)return {...result,stage,kind:result[stage].kind};
    stage='streams';
    async function fetchSite(url){
      if(!safeURL(url))throw Error('unsafe_url');
      const data=await page.evaluate(async({url,limit})=>{
        const response=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(10000)});
        if(response.headers.get('cf-mitigated')==='challenge')return {kind:'cloudflare_challenge'};
        if(!response.ok)return {kind:'http_error'};
        const reader=response.body.getReader();let text='',size=0;const decoder=new TextDecoder();
        try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)return {kind:'body_too_large'};text+=decoder.decode(part.value,{stream:true});}}
        finally{await reader.cancel().catch(()=>{});}
        text+=decoder.decode();return {kind:'ok',text};
      },{url,limit:MAX_BYTES});
      if(data.kind!=='ok')throw {diagnostic:{kind:data.kind}};
      return data.text;
    }
    const provider=createLocalProvider({base:BASE,fetchSite,userAgent:'CinemaCity-session-probe'});
    const streams=await provider.getStreams({title:'Tulsa King',year:'2022',mediaType:'tv',season:1,episode:1});
    result.streamCount=streams.length;
    return {...result,stage,kind:streams.length?'session_and_stream_verified':'authenticated_no_stream'};
  }catch(error){
    const known=new Set(['login_form_unavailable','unsafe_login_action','login_required','empty_player_file','player_payload_missing','catalog_empty','cloudflare_challenge','body_too_large','http_error']);
    const diagnostic=error?.diagnostic;
    return {...result,stage,kind:denied?'request_rejected':known.has(diagnostic?.kind)?diagnostic.kind:networkDiagnostic(error).kind};
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}
async function runSessionProbe(options){
  const start=Date.now();const result=await probe(options);
  return {...result,elapsedMs:Date.now()-start,checkedAt:new Date().toISOString()};
}
module.exports={runSessionProbe,safeURL,revoked};
