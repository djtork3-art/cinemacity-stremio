'use strict';
// Temporary anonymous experiment. No account data or configurable target.
const {runProbe}=require('../lib/browser-probe');
const {requestText}=require('../lib/http');
const DEADLINE=Date.parse('2026-10-23T18:00:00Z');
let pending;
async function launch() {
  const [{default:chromium},{default:puppeteer}]=await Promise.all([
    import('@sparticuz/chromium'),import('puppeteer-core')
  ]);
  return puppeteer.launch({
    executablePath:await chromium.executablePath(),headless:'shell',
    // Lambda provides process isolation; retain TLS and browser web security.
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process'],
    timeout:20000
  });
}
module.exports=async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') {res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
  if(Date.now()>DEADLINE) {res.setHeader('Cache-Control','no-store');return res.status(410).json({error:'experiment_expired'});}
  // One result per warm instance, CDN cached. No retry or background polling.
  pending ||= runProbe({launch,requestText});
  try {
    const result=await pending;
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=3600');
    return res.status(200).json({experiment:'robots-context-fetch',accountAccessTested:false,...result});
  } catch {
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({error:'experiment_failed'});
  }
};
