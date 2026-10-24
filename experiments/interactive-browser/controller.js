'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const SITE='https://cinemacity.cc';
const KEYS=new Set(['Tab','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Home','End','PageUp','PageDown','Space']);
function validKey(key,config,now=Date.now()){
  return now<config.expires&&typeof key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key)&&
    timingSafeEqual(createHash('sha256').update(key).digest(),Buffer.from(config.hash,'hex'));
}
function validOrigin(origin,host){try{const u=new URL(origin);return ['https:','http:'].includes(u.protocol)&&u.host===host;}catch{return false;}}
function allowedURL(value,main=false){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
    if(u.origin===SITE)return true;
    if(main)return false;
    return ['challenges.cloudflare.com','static.cloudflareinsights.com','dnstest.dev'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));
  }catch{return false;}
}
function command(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_command');
  if(['home','reload','back','verify','close'].includes(value.type))return {type:value.type};
  if(value.type==='click'&&Number.isInteger(value.x)&&Number.isInteger(value.y)&&value.x>=0&&value.x<1100&&value.y>=0&&value.y<720)return {type:'click',x:value.x,y:value.y};
  if(value.type==='text'&&typeof value.text==='string'&&value.text.length>0&&value.text.length<=2048)return {type:'text',text:value.text};
  if(value.type==='key'&&KEYS.has(value.key))return {type:'key',key:value.key};
  if(value.type==='scroll'&&Number.isFinite(value.delta))return {type:'scroll',delta:Math.max(-720,Math.min(720,value.delta))};
  throw Error('invalid_command');
}
function authenticated(html){const m=html.match(/\bCCDeviceGuardRuntime\s*=\s*\{\s*authenticated\s*:\s*(true|false)\s*\}/);return m?m[1]==='true':null;}
async function control(page,c){
  if(c.type==='home')return page.goto(SITE+'/',{waitUntil:'domcontentloaded',timeout:30000});
  if(c.type==='reload')return page.reload({waitUntil:'domcontentloaded',timeout:30000});
  if(c.type==='back')return page.goBack({waitUntil:'domcontentloaded',timeout:30000});
  if(c.type==='click')return page.mouse.click(c.x,c.y);
  if(c.type==='text')return page.keyboard.insertText(c.text);
  if(c.type==='key')return page.keyboard.press(c.key);
  if(c.type==='scroll')return page.mouse.wheel({deltaY:c.delta});
  if(c.type==='verify')return {authenticated:authenticated(await page.content())};
}
module.exports={SITE,validKey,validOrigin,allowedURL,command,authenticated,control};
