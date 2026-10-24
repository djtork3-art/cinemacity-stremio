'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {WebSocketServer}=require('ws');
const {SITE,validKey,validOrigin,allowedURL,command,control}=require('./controller');
function createServer({config,launch,clock=Date.now,sessionMs=240000,idleMs=120000}){
  let active=0;
  const files={'/':'index.html','/client.js':'client.js','/style.css':'style.css'};
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if(req.method!=='GET'||!files[req.url]){res.writeHead(404);res.end();return;}
    const file=files[req.url];res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname,file)));
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:10000,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/remote'||!validOrigin(req.headers.origin,req.headers.host)||clock()>=config.expires){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    let browser,page,authed=false,opening=false,closed=false,counted=false,timer,limitTimer,framesBusy=false,lastAction=clock(),queued=0,chain=Promise.resolve();
    let burstStart=clock(),burst=0;
    const send=x=>{if(ws.readyState===1&&ws.bufferedAmount<1024*1024)ws.send(JSON.stringify(x));};
    const authTimer=setTimeout(()=>ws.close(1008,'authentication_required'),10000);
    async function cleanup(){if(closed)return;closed=true;clearTimeout(authTimer);clearTimeout(limitTimer);clearInterval(timer);if(counted){active--;counted=false;}await browser?.close().catch(()=>{});}
    ws.on('close',()=>{void cleanup();});ws.on('error',()=>{void cleanup();});
    async function start(){
      try{
        browser=await launch();if(closed){await browser.close();return;}
        page=await browser.newPage();await page.setViewport({width:1100,height:720,deviceScaleFactor:1});
        await page.setRequestInterception(true);
        page.on('request',r=>{const main=r.isNavigationRequest()&&r.frame()===page.mainFrame();(allowedURL(r.url(),main)?r.continue():r.abort('blockedbyclient')).catch(()=>{});});
        page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>{});});
        page.on('popup',popup=>{void popup.close().catch(()=>{});});
        browser.on('targetcreated',async target=>{if(target.type()==='page'){const p=await target.page().catch(()=>null);if(p&&p!==page)await p.close().catch(()=>{});}});
        await page.setJavaScriptEnabled(true);
        send({type:'ready',version:await browser.version(),sessionSeconds:sessionMs/1000});
        timer=setInterval(async()=>{
          if(closed||framesBusy)return;
          if(clock()-lastAction>idleMs){send({type:'notice',text:'Sesión cerrada por inactividad. Puedes conectar de nuevo.'});ws.close(1000);return;}
          if(ws.bufferedAmount>512*1024)return;
          framesBusy=true;
          try{const jpeg=await page.screenshot({type:'jpeg',quality:55});send({type:'frame',image:'data:image/jpeg;base64,'+jpeg.toString('base64')});}catch{}finally{framesBusy=false;}
        },1500);
        limitTimer=setTimeout(()=>{send({type:'notice',text:'Terminó la sesión temporal de cuatro minutos.'});ws.close(1000);},sessionMs);
        try{await page.goto(SITE+'/',{waitUntil:'domcontentloaded',timeout:30000});}catch{send({type:'notice',text:'La navegación no terminó. Puedes ver la pantalla y volver a cargar.'});}
      }catch{send({type:'notice',text:'No se pudo iniciar el navegador remoto.'});ws.close(1011);}
    }
    ws.on('message',data=>{
      let value;try{value=JSON.parse(data.toString());}catch{ws.close(1008);return;}
      if(!authed){
        if(opening||value?.type!=='auth'||!validKey(value.key,config,clock())||active>=2){ws.close(1008,'access_denied');return;}
        authed=true;opening=true;active++;counted=true;clearTimeout(authTimer);send({type:'notice',text:'Iniciando Chromium en Vercel…'});void start();return;
      }
      if(clock()-burstStart>1000){burstStart=clock();burst=0;}
      if(++burst>40||queued>=24){ws.close(1008,'too_many_commands');return;}
      let c;try{c=command(value);}catch{ws.close(1008,'invalid_command');return;}
      if(c.type==='close'){ws.close(1000);return;}
      if(!page){send({type:'notice',text:'Espera a que termine de iniciar el navegador.'});return;}
      lastAction=clock();queued++;
      chain=chain.then(async()=>{if(closed)return;try{const result=await control(page,c);if(c.type==='verify')send({type:'verification',...result});}catch{send({type:'notice',text:'La acción no se completó. Revisa la pantalla del navegador.'});}}).finally(()=>{queued--;});
    });
  });
  server.on('close',()=>{for(const client of wss.clients)client.close(1001);wss.close();});
  return server;
}
module.exports={createServer};
if(require.main===module){
  process.env.DEBUG='';
  const puppeteer=require('puppeteer-core'),config=require('./config.json');
  createServer({config,launch:()=>puppeteer.launch({executablePath:'/usr/bin/chromium',headless:false,env:{...process.env,DISPLAY:':99'},args:['--no-sandbox','--disable-dev-shm-usage','--disable-extensions'],timeout:20000})}).listen(Number(process.env.PORT||80),'0.0.0.0');
}
