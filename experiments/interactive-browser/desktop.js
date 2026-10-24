'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function browserArgs(profile){return ['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--window-size=1100,720','--window-position=0,0','--app=https://cinemacity.cc/'];}
function childEnv(home,display){return {PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HOME:home,DISPLAY:display,LANG:'en_US.UTF-8',XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')};}
async function stop(child){
  if(!child||child.exitCode!==null||child.signalCode)return;
  await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};const timer=setTimeout(()=>{child.kill('SIGKILL');finish();},1500);child.once('close',finish);child.kill('SIGTERM');});
}
async function createDesktop({slot,onExit=()=>{}}){
  if(![0,1].includes(slot))throw Error('invalid_slot');
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cc-desktop-')),display=':'+(91+slot),port=5991+slot;
  const children=[];let closing=false,stage='display';
  const close=async()=>{if(closing)return;closing=true;for(const child of [...children].reverse())await stop(child);const target=path.resolve(home);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('cc-desktop-'))await fs.rm(target,{recursive:true,force:true}).catch(()=>{});};
  function start(binary,args){const child=spawn(binary,args,{env:childEnv(home,display),stdio:'ignore'});child.on('error',()=>{});child.on('exit',()=>{if(!closing)onExit();});children.push(child);return child;}
  try{
    start('/usr/bin/Xvfb',[display,'-screen','0','1100x720x24','-nolisten','tcp','-ac']);
    let ready=false;
    for(let i=0;i<50;i++){try{await fs.access('/tmp/.X11-unix/X'+(91+slot));ready=true;break;}catch{}await pause(100);}
    if(!ready)throw Error('display_start_failed');
    stage='vnc';start('/usr/bin/x11vnc',['-display',display,'-localhost','-no6','-listen','127.0.0.1','-rfbport',String(port),'-nopw','-forever','-shared','-noxdamage','-quiet']);
    ready=false;
    for(let i=0;i<50;i++){
      ready=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(200);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
      if(ready)break;await pause(100);
    }
    if(!ready)throw Error('vnc_start_failed');
    stage='browser';start('/usr/bin/chromium',browserArgs(path.join(home,'profile')));
    return {port,close,mode:'conventional_desktop'};
  }catch{await close();throw Object.assign(Error('desktop_start_failed'),{stage});}
}
module.exports={createDesktop,browserArgs,childEnv};
