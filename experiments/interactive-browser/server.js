'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {WebSocketServer}=require('ws'),{validKey,validOrigin}=require('./access');
const {createDesktop}=require('./desktop');
function staticFile(url){
  const files={'/':['index.html','text/html'],'/client.js':['client.js','text/javascript'],'/style.css':['style.css','text/css']};
  if(files[url])return {file:path.join(__dirname,files[url][0]),type:files[url][1]};
  if(!/^\/novnc\/(core|vendor)\/[a-zA-Z0-9_./-]+\.js$/.test(url)||url.includes('..'))return null;
  const root=path.join(__dirname,'node_modules','@novnc','novnc');return {file:path.join(root,url.slice('/novnc/'.length)),type:'text/javascript'};
}
function createServer({config,launch=createDesktop,clock=Date.now,sessionMs=240000}){
  const slots=new Set();
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const asset=req.method==='GET'&&staticFile(req.url);if(!asset){res.writeHead(404);res.end();return;}
    fs.readFile(asset.file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',asset.type+'; charset=utf-8');res.end(data);});
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/desktop'||!validOrigin(req.headers.origin,req.headers.host)||clock()>=config.expires){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    let slot,desktop,tcp,closed=false,launching=false,phase='auth',limitTimer;const authTimer=setTimeout(()=>ws.close(1008),10000);
    async function cleanup(){if(closed)return;closed=true;clearTimeout(authTimer);clearTimeout(limitTimer);tcp?.destroy();await desktop?.close().catch(()=>{});if(slot!==undefined&&!launching)slots.delete(slot);}
    ws.on('close',()=>{void cleanup();});ws.on('error',()=>{void cleanup();});
    ws.on('message',(data,binary)=>{
      if(phase==='stream'){
        if(!binary){ws.close(1008);return;}if(tcp?.writableLength>4*1024*1024){ws.close(1008);return;}tcp?.write(data);return;
      }
      let value;try{if(binary||data.length>512)throw Error();value=JSON.parse(data.toString());}catch{ws.close(1008);return;}
      if(phase==='auth'){
        if(value?.type!=='auth'||!validKey(value.key,config,clock())||slots.size>=2){ws.close(1008,'access_denied');return;}
        clearTimeout(authTimer);slot=slots.has(0)?1:0;slots.add(slot);phase='starting';launching=true;
        limitTimer=setTimeout(()=>ws.close(1000,'session_expired'),sessionMs);
        void launch({slot,onExit:()=>ws.close(1011,'desktop_stopped')}).then(async instance=>{
          launching=false;desktop=instance;if(closed){await desktop.close();slots.delete(slot);return;}phase='ready';ws.send(JSON.stringify({type:'ready',seconds:sessionMs/1000,mode:'conventional_desktop'}));
        }).catch(error=>{launching=false;if(closed)slots.delete(slot);if(ws.readyState===1){ws.send(JSON.stringify({type:'error',stage:['display','vnc','browser'].includes(error?.stage)?error.stage:'startup'}));ws.close(1011);}});return;
      }
      if(phase!=='ready'||value?.type!=='begin'){ws.close(1008);return;}
      phase='stream';tcp=net.connect({host:'127.0.0.1',port:desktop.port});
      tcp.on('data',chunk=>{if(ws.readyState!==1)return;if(ws.bufferedAmount>8*1024*1024){ws.close(1008);return;}ws.send(chunk,{binary:true});});
      tcp.on('error',()=>ws.close(1011,'desktop_connection_failed'));tcp.on('close',()=>ws.close(1000));
    });
  });
  server.on('close',()=>{for(const ws of wss.clients)ws.close(1001);wss.close();});return server;
}
module.exports={createServer,staticFile};
if(require.main===module)createServer({config:require('./config.json')}).listen(Number(process.env.PORT||80),'0.0.0.0');
