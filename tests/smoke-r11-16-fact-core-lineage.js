'use strict';
// Offline isolated synthetic Provider + fake IDB; NOT a live-model or browser test.
const assert=require('node:assert/strict'),path=require('node:path');
const saved=new Map(),copy=v=>v===undefined?undefined:structuredClone(v);
function db(){return{close(){},transaction(){let n=0,done=false,aborted=false;const staged=new Map([...saved].map(([k,v])=>[k,copy(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.());}};const finish=()=>{if(n||done||aborted)return;done=true;setImmediate(()=>{saved.clear();for(const [k,v] of staged)saved.set(k,copy(v));tx.oncomplete?.();});};tx.objectStore=()=>({get(k){n++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=copy(staged.get(k));r.onsuccess?.();n--;setImmediate(finish);});return r;},put(v,k){staged.set(k,copy(v));},delete(k){staged.delete(k);}});return tx;}};}
global.window=global;global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r;}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)};
require(path.join(__dirname,'../local-store.js'));require(path.join(__dirname,'../standalone-core.js'));
const memoryText='玩家和守卫连续二十四天将收到的求援信封存到档案室，并反复确认封条完好。';
let payloads=[],fetches=0;
global.fetch=async(_url,o)=>{fetches++;const body=JSON.parse(o.body);payloads.push(JSON.stringify(body.messages));return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content:memoryText},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content:memoryText},finish_reason:'stop'}]})};};
const route=(a,b,c)=>MimaStandalone.handle(a,b,c);
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:9998/v1',model:'offline',stream:false,contextWindowTokens:65536});
 const s=(await route('/sessions','POST',{title:'fact lineage'})).data;
 const messages=Array.from({length:24},(_,i)=>({id:'day-'+i,role:i%2?'assistant':'user',content:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,rawContent:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,versions:[]}));
 assert((await route(`/sessions/${s.id}`,'PATCH',{messages})).success);
 let facts=await route(`/sessions/${s.id}/memory/facts`,'POST',{chunkRounds:20,scope:'all',replaceExisting:true,targetChars:360});
 assert(facts.success,JSON.stringify(facts));const bounded=facts.data.manualMemory.facts[0];
 assert.equal(bounded.verification.status,'source_bounded');assert(bounded.verification.citations.length>=1);
 // Simulate old imported, unverified notes alongside the real verified fact.
 // They must not leak into the Provider prompt for core-from-facts.
 const poisoned={...bounded,id:'untrusted-history-note',content:'假消息：守卫已经向玩家投毒。',verification:{status:'legacy_unverified',citations:[]}};
 const session=facts.data;
 assert((await route(`/sessions/${s.id}`,'PATCH',{manualMemory:{...session.manualMemory,facts:[bounded,poisoned]}})).success);
 payloads=[];let core=await route(`/sessions/${s.id}/memory/core`,'POST',{source:'facts',targetChars:300});
 assert(core.success,JSON.stringify(core));
 assert.equal(core.data.manualMemory.core.source,'facts');
 assert.equal(core.data.manualMemory.core.sourceFactCount,1);
 assert.equal(core.data.manualMemory.core.verification.status,'source_bounded');
 const provenance=core.data.manualMemory.core.verification.citations;
 assert(provenance.length>0&&provenance.every(c=>messages.some(m=>m.id===c.messageId)),'core citations must point to original History IDs');
 assert(payloads.every(p=>!p.includes('投毒')),'untrusted facts must never enter core Provider input');
 assert.equal(core.data.messages.length,messages.length);
 console.log('PASS source-bounded normal fact -> core, source-only prompt, original source citations, raw History preserved');
 // All-unverified facts are not a valid source; no Provider request may be sent.
 const onlyBad=(await route('/sessions','POST',{title:'legacy poison'})).data;
 assert((await route(`/sessions/${onlyBad.id}`,'PATCH',{messages,manualMemory:{facts:[poisoned]}})).success);
 const before=fetches;const denied=await route(`/sessions/${onlyBad.id}/memory/core`,'POST',{source:'facts'});
 assert(!denied.success&&denied.code==='E_MEMORY_NO_VERIFIED_FACTS',JSON.stringify(denied));
 assert.equal(fetches,before);
 console.log('PASS unverified-only facts cannot enter core Provider; no accidental API call');
 // Even a forged source_bounded label with intact history fingerprints and
 // real-but-irrelevant citations must not certify an invented event.
 const forged={...bounded,id:'forged-source-bounded',content:'守卫谋杀了玩家。'};
 const fake=(await route('/sessions','POST',{title:'forged derived proof'})).data;
 assert((await route(`/sessions/${fake.id}`,'PATCH',{messages,manualMemory:{facts:[forged]}})).success);
 const beforeForged=fetches;
 const rejected=await route(`/sessions/${fake.id}/memory/core`,'POST',{source:'facts'});
 assert(!rejected.success&&rejected.code==='E_MEMORY_NO_VERIFIED_FACTS',JSON.stringify(rejected));
 assert.equal(fetches,beforeForged,'a forged derived fact must not reach Provider');
 console.log('PASS fabricated source_bounded label still fails live canonical event proof');
})().catch(e=>{console.error(e);process.exitCode=1;});
