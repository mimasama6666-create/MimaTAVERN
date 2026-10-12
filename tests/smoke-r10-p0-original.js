'use strict';
const path=require('node:path');
const root=process.env.MIMATAVERN_ROOT || path.resolve(__dirname,'..');
const assert=require('node:assert/strict');
const cp=x=>x===undefined?undefined:structuredClone(x);
const data=new Map();
function db(){return{close(){},transaction(){let n=0,ended=false,aborted=false;const copy=new Map([...data].map(([k,v])=>[k,cp(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(ended||aborted||n)return;ended=true;setImmediate(()=>{if(!aborted){data.clear();for(const [k,v]of copy)data.set(k,cp(v));tx.oncomplete?.();}})}const obj={get(k){n++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=cp(copy.get(k));r.onsuccess?.();n--;setImmediate(done)});return r;},put(v,k){copy.set(k,cp(v));return{}},delete(k){copy.delete(k);return{}}};tx.objectStore=()=>obj;return tx;}}}
global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,y)=>pref.set(x,y)};
require(path.join(root,'local-store.js'));require(path.join(root,'standalone-core.js'));
let calls=0,outputs=[];
global.fetch=async (_url,opts)=>{calls++;const body=JSON.parse(opts.body);outputs.push(body.messages?.at(-1)?.content?.slice(0,70)); const content='艾琳杀死了甲方。';return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})};};
const messages=Array.from({length:42},(_,i)=>({id:'event-'+i,role:i%2?'assistant':'user',content:i<24?(i%2?'艾琳杀死了乙方。':'艾琳杀死了甲方。'):'后续日常剧情。',rawContent:i<24?(i%2?'艾琳杀死了乙方。':'艾琳杀死了甲方。'):'后续日常剧情。',versions:[]}));
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://127.0.0.1:5999/v1',model:'local-test',stream:false,contextWindowTokens:32768});
 const s=(await MimaStandalone.handle('/sessions','POST',{title:'False coverage regression demonstrator'})).data;
 await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
 const result=await MimaStandalone.runRecordedMemory('rolling',s.id,{}).then(v=>({ok:true,cursor:v.lastSummarizedIndex})).catch(e=>({ok:false,code:e.code,reason:e.message}));
 const stored=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;
 const job=await MimaLocalStore.getMemoryJob(s.id,'rolling');
 console.log(JSON.stringify({result,historyLength:stored.messages.length,summaryCursor:stored.lastSummarizedIndex,summaryLength:stored.rollingSummary.length,jobStatus:job.status,requests:calls,sourceChars:messages.slice(0,24).map(x=>x.content).join('').length,testSummaryChars:'艾琳杀死了甲方。'.length,checkpoints:job.checkpoints.map(x=>({stage:x.stage,reason:x.reason,missingCount:x.missingCount}))},null,2));
 assert.equal(stored.messages.length,42);assert.equal(result.ok,false,'A summary omitting distinct 乙方 events MUST NOT commit');assert.equal(stored.lastSummarizedIndex,0,'Cursor MUST remain unchanged');assert.equal(job.status,'needs_review','Uncovered source events MUST require review');assert(job.checkpoints.some(x=>x.stage==='rolling_final_coverage'&&x.missingCount>0),'Missing coverage must be explicit');
 console.log('PASS: source event omission did not settle the rolling summary cursor.');
})().catch(e=>{console.error(e);process.exitCode=1})
