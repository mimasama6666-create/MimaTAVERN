'use strict';
// Provider + fake IndexedDB integration: positive compression and negative omissions.
const assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const CASES=[
 ['victim omitted',['艾琳杀死了甲方。','艾琳杀死了乙方。'],'艾琳杀死了甲方。',false],
 ['location omitted',['艾琳在东城击败了士兵。','艾琳在西城击败了士兵。'],'艾琳在东城击败了士兵。',false],
 ['repeated action omitted',['艾琳杀死了甲方。'],'艾琳杀死了甲方。',false],
 ['repeated short consent',['同意。'],'同意。',false],
 ['second sentence omitted',['艾琳拒绝了请求。守卫把钥匙送回码头。'],'艾琳拒绝了请求。',false],
 ['explicit repeat count',['艾琳杀死了甲方。'],'艾琳杀死了甲方共二十四次。',true],
 ['invented victim within repeat',['艾琳杀死了甲方。'],'艾琳杀死了乙方共二十四次。',false],
 ['invented extra victim',['艾琳杀死了甲方。'],'艾琳杀死了甲方和乙方二十四次。',false],
 ['both victims counted',['艾琳杀死了甲方。','艾琳杀死了乙方。'],'艾琳杀死了甲方十二次，艾琳杀死了乙方十二次。',true]
];
if(!process.env.R10_CASE){
 for(let i=0;i<CASES.length;i++){
  const r=spawnSync(process.execPath,[__filename],{env:{...process.env,R10_CASE:String(i)},encoding:'utf8',timeout:25000});
  if(r.status!==0)console.error(CASES[i][0],r.stdout,r.stderr);
  assert.equal(r.status,0,`R10 ${CASES[i][0]} integration`);
  console.log('PASS',CASES[i][0]);
 }
}else{
 const c=CASES[Number(process.env.R10_CASE)],data=new Map(),cp=x=>x===undefined?undefined:structuredClone(x);
 function db(){return{close(){},transaction(){let n=0,ended=false,aborted=false;const copy=new Map([...data].map(([k,v])=>[k,cp(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(ended||aborted||n)return;ended=true;setImmediate(()=>{if(!aborted){data.clear();for(const [k,v]of copy)data.set(k,cp(v));tx.oncomplete?.();}})}const obj={get(k){n++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=cp(copy.get(k));r.onsuccess?.();n--;setImmediate(done)});return r;},put(v,k){copy.set(k,cp(v));return{}},delete(k){copy.delete(k);return{}}};tx.objectStore=()=>obj;return tx;}}}
 global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,y)=>pref.set(x,y)};
 require(path.join(__dirname,'..','local-store.js'));require(path.join(__dirname,'..','standalone-core.js'));
 let requests=0;global.fetch=async()=>{requests++;const content=c[2];return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})};};
 (async()=>{await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://127.0.0.1:5999/v1',model:'local-test',stream:false});const s=(await MimaStandalone.handle('/sessions','POST',{title:c[0]})).data;
 const messages=Array.from({length:42},(_,i)=>({id:'event-'+i,role:i%2?'assistant':'user',content:i<24?c[1][i%c[1].length]:'后续日常剧情。',rawContent:i<24?c[1][i%c[1].length]:'后续日常剧情。',versions:[]}));
 await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
 const result=await MimaStandalone.runRecordedMemory('rolling',s.id,{}).then(()=>true).catch(e=>{assert.equal(e.code,'E_MEMORY_NEEDS_REVIEW');return false});
 const saved=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data,job=await MimaLocalStore.getMemoryJob(s.id,'rolling');
 assert.equal(requests,1);assert.equal(saved.messages.length,42);assert.equal(result,c[3]);assert.equal(saved.lastSummarizedIndex,c[3]?24:0);assert.equal(job.status,c[3]?'committed':'needs_review');
 if(!c[3])assert(job.checkpoints.some(x=>(x.stage==='rolling_final_coverage'&&x.missingCount>0)||x.stage.endsWith('_needs_review')));
 })().catch(e=>{console.error(e);process.exitCode=1});
}
