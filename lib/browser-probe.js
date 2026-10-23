'use strict';
const ORIGIN='https://cinemacity.cc';
const ROBOTS=ORIGIN+'/robots.txt', CATALOG=ORIGIN+'/news_pages.xml';
const MAX_BYTES=2*1024*1024;
const {networkDiagnostic}=require('./http');
function allowedRequest(url,initial,redirects) {
  try {
    const u=new URL(url);
    if(u.origin!==ORIGIN || u.username || u.password || redirects>3) return false;
    if(!redirects) return u.href===initial;
    return !/challenge|captcha|device[_-]?guard|\/cdn-cgi\//i.test(u.pathname) &&
      ![...u.searchParams.keys()].some(key=>/^__cf_chl|^cc_device_guard$/i.test(key));
  } catch {return false;}
}
function classify(status,headers) {
  const challenge=headers['cf-mitigated']==='challenge';
  return {httpStatus:status,challenge,cloudflare:/cloudflare/i.test(headers.server || ''),
    kind:challenge?'cloudflare_challenge':status>=200&&status<300?'ok':status===403?'http_forbidden':'http_error'};
}
// This function runs in the fresh browser context, not in Node.
async function fetchCatalog({target,limit}) {
  try {
    const response=await fetch(target,{credentials:'include',redirect:'follow',
      headers:{accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'},
      signal:AbortSignal.timeout(12000)});
    const challenge=response.headers.get('cf-mitigated')==='challenge';
    const result={httpStatus:response.status,challenge,
      cloudflare:/cloudflare/i.test(response.headers.get('server') || ''),catalog:false};
    result.kind=challenge?'cloudflare_challenge':response.ok?'ok':response.status===403?'http_forbidden':'http_error';
    if(challenge){await response.body?.cancel();return result;}
    const reader=response.body?.getReader();
    if(!reader)return {...result,kind:'empty_body'};
    const decoder=new TextDecoder();let bytes=0,text='';
    try {
      while(true){const part=await reader.read();if(part.done)break;
        bytes+=part.value.byteLength;
        if(bytes>limit)return {...result,kind:'body_too_large'};
        text+=decoder.decode(part.value,{stream:true});
      }
      text+=decoder.decode();
    }finally{await reader.cancel().catch(()=>{});}
    result.bytes=bytes;
    if(/<title[^>]*>\s*(?:just a moment|un momento|attention required)/i.test(text))
      return {...result,kind:'cloudflare_challenge',challenge:true};
    result.catalog=response.ok&&/<urlset\b/i.test(text)&&/<loc(?:\s|>)/i.test(text);
    if(result.catalog)result.entries=(text.match(/<loc(?:\s|>)/gi)||[]).length;
    return result;
  }catch(error){return {kind:error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'browser_fetch_error',catalog:false};}
}
async function runProbe({launch}) {
  let browser,stage='bootstrap',initialSeen=false;
  const started=Date.now(),result={accountAccessTested:false,cookiesImported:false};
  try {
    browser=await launch();
    const version=await browser.version();
    if(/^(?:HeadlessChrome|Chrome)\/\d+(?:\.\d+)*$/.test(version))result.version=version;
    const page=await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('response',response=>{
      try{
        const request=response.request();
        if(stage==='bootstrap'&&request.isNavigationRequest()&&request.frame()===page.mainFrame())
          result.bootstrap=classify(response.status(),response.headers());
      }catch{/* Only safe response metadata is observed. */}
    });
    page.on('request',async request=>{
      try{
        const redirectCount=request.redirectChain().length;
        const initial=stage==='bootstrap'?ROBOTS:CATALOG;
        const typeOK=stage==='bootstrap'?request.isNavigationRequest()&&request.frame()===page.mainFrame():request.resourceType()==='fetch';
        if(!result.bootstrap?.challenge&&typeOK&&request.method()==='GET'&&allowedRequest(request.url(),initial,redirectCount)&&(!initialSeen||redirectCount>0)){
          initialSeen=true;await request.continue();
        }else await request.abort('blockedbyclient');
      }catch{/* Never log URLs or raw exceptions. */}
    });
    const response=await page.goto(ROBOTS,{waitUntil:'domcontentloaded',timeout:20000});
    if(!response){result.bootstrap={kind:'navigation_failed'};return result;}
    result.bootstrap=classify(response.status(),response.headers());
    if(result.bootstrap.kind!=='ok')return result;
    const body=await response.buffer();
    if(body.byteLength>MAX_BYTES){result.bootstrap.kind='body_too_large';return result;}
    if(/<title[^>]*>\s*(?:just a moment|un momento|attention required)/i.test(body.toString('utf8'))){
      result.bootstrap.kind='cloudflare_challenge';result.bootstrap.challenge=true;return result;
    }
    const current=new URL(page.url());
    if(current.origin!==ORIGIN){result.bootstrap.kind='redirect_rejected';return result;}
    stage='catalog';initialSeen=false;
    result.catalogFetch=await page.evaluate(fetchCatalog,{target:CATALOG,limit:MAX_BYTES});
    return result;
  }catch(error){result.error=networkDiagnostic(error);return result;}
  finally{
    if(browser)await browser.close().catch(()=>{});
    result.elapsedMs=Date.now()-started;result.checkedAt=new Date().toISOString();
  }
}
module.exports={runProbe,fetchCatalog,allowedRequest};
