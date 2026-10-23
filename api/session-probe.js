'use strict';
const {createGate}=require('../lib/session-probe-gate');
const {runSessionProbe}=require('../lib/session-probe');
const config=require('../lib/session-probe-config.json');
async function launch(){
  // Prevent optional protocol debug logging of credential input events.
  process.env.DEBUG='';
  const [{default:chromium},{default:puppeteer}]=await Promise.all([import('@sparticuz/chromium'),import('puppeteer-core')]);
  return puppeteer.launch({executablePath:await chromium.executablePath(),headless:'shell',
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process'],timeout:15000});
}
module.exports=createGate({...config,run:()=>runSessionProbe({launch,username:process.env.CINEMACITY_USERNAME,password:process.env.CINEMACITY_PASSWORD})});
