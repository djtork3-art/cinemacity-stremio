'use strict';
let socket;
const $=id=>document.getElementById(id),status=text=>{$('status').textContent=text;};
function send(value){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
$('connect').addEventListener('click',()=>{
  if(socket?.readyState===WebSocket.OPEN)return;
  const key=$('key').value;if(!/^[A-Za-z0-9_-]{43}$/.test(key)){status('Introduce la clave temporal.');return;}
  socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/remote');
  $('connect').disabled=true;status('Conectando con Vercel…');
  socket.addEventListener('open',()=>{socket.send(JSON.stringify({type:'auth',key}));});
  socket.addEventListener('message',event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='frame'){$('screen').src=message.image;return;}
    if(message.type==='ready'){$('controls').hidden=false;status('Conectado a '+message.version+'. Sesión temporal de '+Math.round(message.sessionSeconds/60)+' minutos.');return;}
    if(message.type==='notice')status(message.text);
    if(message.type==='verification')status(message.authenticated===true?'CinemaCity declara la sesión autenticada en este navegador.':message.authenticated===false?'CinemaCity indica que no has iniciado sesión.':'La página actual no permite confirmar la sesión.');
  });
  socket.addEventListener('close',()=>{$('connect').disabled=false;$('controls').hidden=true;$('screen').removeAttribute('src');status('Conexión cerrada. Puedes conectar otra vez mientras la clave siga vigente.');});
  socket.addEventListener('error',()=>status('No se pudo conectar. Comprueba el acceso a esta vista previa de Vercel.'));
});
document.querySelectorAll('[data-command]').forEach(b=>b.addEventListener('click',()=>send({type:b.dataset.command})));
document.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('click',()=>send({type:'key',key:b.dataset.key})));
const screen=$('screen');
screen.addEventListener('click',event=>{if(!screen.naturalWidth)return;const r=screen.getBoundingClientRect();send({type:'click',x:Math.min(1099,Math.floor((event.clientX-r.left)*1100/r.width)),y:Math.min(719,Math.floor((event.clientY-r.top)*720/r.height))});screen.focus();});
screen.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&['v','V'].includes(event.key))return;
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key.length===1){event.preventDefault();send({type:'text',text:event.key});return;}
  if(['Tab','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Home','End','PageUp','PageDown'].includes(event.key)){event.preventDefault();send({type:'key',key:event.key});}
});
screen.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData.getData('text');if(text&&text.length<=2048)send({type:'text',text});});
screen.addEventListener('wheel',event=>{event.preventDefault();send({type:'scroll',delta:event.deltaY});},{passive:false});
$('send').addEventListener('click',()=>{const text=$('text').value;if(text&&text.length<=2048){send({type:'text',text});$('text').value='';screen.focus();}});
window.addEventListener('beforeunload',()=>socket?.close());
