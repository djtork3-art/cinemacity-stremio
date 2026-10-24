'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
function validKey(key,config,now=Date.now()){return now<config.expires&&typeof key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key)&&timingSafeEqual(createHash('sha256').update(key).digest(),Buffer.from(config.hash,'hex'));}
function validOrigin(origin,host){try{const u=new URL(origin);return ['https:','http:'].includes(u.protocol)&&u.host===host;}catch{return false;}}
module.exports={validKey,validOrigin};
