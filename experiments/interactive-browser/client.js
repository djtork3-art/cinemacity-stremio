import RFB from '/novnc/core/rfb.js';
let socket,rfb;const $=id=>document.getElementById(id),status=text=>{$('status').textContent=text;};
$('connect').addEventListener('click',()=>{
  if(socket?.readyState===WebSocket.OPEN)return;
  const key=$('key').value;if(!/^[A-Za-z0-9_-]{43}$/.test(key)){status('Introduce la clave temporal.');return;}
  $('connect').disabled=true;status('Iniciando el escritorio en Vercel…');
  socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/desktop');socket.binaryType='arraybuffer';
  socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'auth',key})));
  function ready(event){
    if(typeof event.data!=='string')return;let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='error'){status('No se pudo iniciar el escritorio ('+data.stage+').');return;}
    if(data.type!=='ready')return;socket.removeEventListener('message',ready);
    try{
      rfb=new RFB($('screen'),socket,{shared:false});rfb.scaleViewport=true;rfb.resizeSession=false;
      rfb.addEventListener('connect',()=>{status('Conectado al escritorio convencional en Vercel. Sesión de cuatro minutos.');$('disconnect').hidden=false;});
      rfb.addEventListener('disconnect',()=>{socket.close();});
      rfb.addEventListener('securityfailure',()=>status('El escritorio rechazó la conexión.'));
      socket.send(JSON.stringify({type:'begin'}));
    }catch{status('No se pudo mostrar el escritorio.');socket.close();}
  }
  socket.addEventListener('message',ready);
  socket.addEventListener('close',()=>{$('connect').disabled=false;$('disconnect').hidden=true;rfb?.disconnect();rfb=undefined;$('screen').replaceChildren();status('Escritorio cerrado. Puedes volver a conectar mientras la clave siga vigente.');});
  socket.addEventListener('error',()=>status('No se pudo conectar. Comprueba el acceso a la vista previa de Vercel.'));
});
$('disconnect').addEventListener('click',()=>socket?.close());window.addEventListener('beforeunload',()=>socket?.close());
