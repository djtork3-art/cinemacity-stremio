'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
async function readKey(req){
  let body=req.body;
  if(body===undefined){
    const chunks=[];let size=0;
    for await(const part of req){const b=Buffer.from(part);size+=b.length;if(size>1024)throw Error('invalid_body');chunks.push(b);}
    body=Buffer.concat(chunks).toString('utf8');
  }
  if(Buffer.isBuffer(body))body=body.toString('utf8');
  if(typeof body==='string'){
    if(Buffer.byteLength(body)>1024)throw Error('invalid_body');
    body=Object.fromEntries(new URLSearchParams(body));
  }
  return typeof body?.key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(body.key)?body.key:null;
}
function createGate({hash,expires,run,now=Date.now}){
  let pending;
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'");
    if(now()>expires)return res.status(410).json({error:'experiment_expired'});
    if(req.method==='GET'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.status(200).send('<!doctype html><html lang="es"><meta charset="utf-8"><title>Prueba privada de CinemaCity</title><h1>Prueba privada de sesión en Vercel</h1><form method="POST" action="/api/session-probe"><label>Clave temporal <input name="key" type="password" autocomplete="off" required></label><button type="submit">Ejecutar prueba privada</button></form></html>');
    }
    if(req.method!=='POST')return res.status(404).json({error:'not_found'});
    try{
      const key=await readKey(req);
      if(!key||!timingSafeEqual(createHash('sha256').update(key).digest(),Buffer.from(hash,'hex')))
        return res.status(404).json({error:'not_found'});
      pending ||= Promise.resolve().then(run);
      return res.status(200).json(await pending);
    }catch{return res.status(500).json({error:'session_probe_failed'});}
  };
}
module.exports={createGate};
