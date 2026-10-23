'use strict';
const http=require('node:http');
const addon=require('../../api/index');
const {createGate}=require('./gate');
const config=require('./config.json');
const {runSessionProbe,safeURL,verificationResource}=require('../../scripts/check-browser-session');
async function run(){
  process.env.DEBUG='';
  const puppeteer=require('puppeteer-core');
  const launch=()=>puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],timeout:20000});
  let browser;
  const result={browserImplementation:'full-chromium',executable:'/usr/bin/chromium',headless:true,cookiesImported:false};
  try{
    browser=await launch();result.version=await browser.version();
    const page=await browser.newPage();let last;
    page.on('response',r=>{if(r.request().isNavigationRequest()&&r.request().frame()===page.mainFrame())last=r;});
    await page.setRequestInterception(true);
    page.on('request',r=>{const u=r.url();const allowed=(safeURL(u)||verificationResource(u))&&['GET','POST'].includes(r.method());(allowed?r.continue():r.abort()).catch(()=>{});});
    const started=Date.now();
    await page.goto('https://cinemacity.cc/',{waitUntil:'domcontentloaded',timeout:30000});
    try{await page.waitForFunction(()=>!(/just a moment|checking your browser/i.test(document.title)),{timeout:25000});}catch{}
    result.publicPage={httpStatus:last?.status(),challenge:last?.headers()['cf-mitigated']==='challenge',waitedMs:Date.now()-started};
    result.kind=result.publicPage.challenge?'cloudflare_challenge':result.publicPage.httpStatus===200?'public_page_accessible':'http_error';
  }catch(error){result.kind=browser?'navigation_failed':'browser_launch_failed';result.errorCode=String(error?.code||error?.name||'unknown').slice(0,60);}
  finally{await browser?.close().catch(()=>{});}
  result.credentialsConfigured=Boolean(process.env.CINEMACITY_USERNAME&&process.env.CINEMACITY_PASSWORD);
  if(result.kind==='public_page_accessible'&&result.credentialsConfigured)result.session=await runSessionProbe({launch,username:process.env.CINEMACITY_USERNAME,password:process.env.CINEMACITY_PASSWORD});
  return {...result,checkedAt:new Date().toISOString()};
}
const gate=createGate({...config,run});
function decorate(res){res.status=n=>{res.statusCode=n;return res;};res.send=v=>{res.end(v);return res;};res.json=v=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(v));return res;};}
http.createServer(async(req,res)=>{
  decorate(res);
  try{const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/session-probe')return await gate(req,res);
    req.query={path:url.pathname.replace(/^\/+/, '')};
    return await addon(req,res);
  }catch{if(!res.headersSent)res.status(500).json({error:'request_failed'});else res.end();}
}).listen(Number(process.env.PORT||80),'0.0.0.0');
