'use strict';
// Genuine route, original ledger, fake Provider and transaction simulator.
// Long rolling continuation must preserve old events without a lossy merge call.
const assert=require('node:assert/strict');
const deep=v=>v===undefined?v:structuredClone(v),disk=new Map();
function db(){return{close(){},transaction(){let pending=0,done=false,aborted=false;const work=new Map([...disk].map(([k,v])=>[k,deep(v)])),tx={oncomplete:null,onabort:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};
function finish(){if(done||aborted||pending)return;done=true;setImmediate(()=>{disk.clear();for(const[k,v]of work)disk.set(k,deep(v));tx.oncomplete?.();});}
tx.objectStore=()=>({get(k){pending++;const r={onsuccess:null,result:undefined};setImmediate(()=>{r.result=deep(work.get(k));r.onsuccess?.();pending--;setImmediate(finish)});return r;},put(v,k){work.set(k,deep(v));return{};},delete(k){work.delete(k);return{}}});return tx;}}}
global.window=global;global.indexedDB={open(){const r={result:db()};setImmediate(()=>r.onsuccess?.());return r;}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};
const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))};
require('../local-store.js');require('../standalone-core.js');
const messages=Array.from({length:60},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:`角色第${i}条档案：`+'文'.repeat(970)+`第${i}条已经核实。`,versions:[]}));
const sourceText=i=>messages[i].content;
const summary=messages.slice(0,10).map(m=>m.content).join('\n');
let requestCount=0,dropEvent=null;global.fetch=async(_,options)=>{requestCount++;
 const p=JSON.parse(options.body).messages.at(-1).content;
 assert(p.includes('旧剧情原文分片'),'must ask provider ONLY about new source parts');
 const rawChunk=p.split(/【旧剧情原文分片 \d+\/\d+】\n/)[1]?.split('\n请给出本分片')[0]||'';
 const answer=rawChunk.split('\n').filter(line=>line.startsWith('角色第')&&(dropEvent===null||!line.startsWith('角色第'+dropEvent+'条'))).join('\n');
 assert(answer.length,'must include source literals');
 const payload={choices:[{message:{content:answer},finish_reason:'stop'}]};
 return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>payload,text:async()=>JSON.stringify(payload)};
};
(async()=>{await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4501/v1',model:'fake',stream:false,contextWindowTokens:1000000});
 const s=(await MimaStandalone.handle('/sessions','POST',{title:'rolling-partial-append'})).data;
 const prep=await MimaStandalone.handle('/sessions/'+s.id,'PATCH',{messages,rollingSummary:summary,summary,lastSummarizedIndex:10,
  rollingSourceCount:10,rollingSourceFingerprint:MimaStandalone.memorySourceFingerprint(messages,10),promptSettings:{recentMessageLimit:22}});
 assert(prep.success,JSON.stringify(prep));
 const result=await MimaStandalone.runRecordedMemory('rolling',s.id,{});
 assert.equal(result.lastSummarizedIndex,42);assert.equal(result.messages.length,60);
 for(let i=0;i<42;i++)assert(result.rollingSummary.includes(sourceText(i)),'event lost '+i);
 const job=await MimaLocalStore.getMemoryJob(s.id,'rolling');assert.equal(job.status,'committed');
 assert(job.checkpoints.some(x=>x.stage==='rolling_merge_received'&&x.mode==='canonical_verified_concatenation'));
 assert.equal(requestCount,2,'two source chunks, zero extra merge requests');
 console.log('PASS long rolling continuation: 42 original source events, 2 part requests, zero lossy merge, durable cursor, all History intact');
 // One omitted event must not pass even when all remaining source fragments
 // and the previous canonical rolling summary are genuine.
 dropEvent=11;
 const bad=(await MimaStandalone.handle('/sessions','POST',{title:'rolling-omission'})).data;
 const prepared=await MimaStandalone.handle('/sessions/'+bad.id,'PATCH',{messages,rollingSummary:summary,summary,lastSummarizedIndex:10,
  rollingSourceCount:10,rollingSourceFingerprint:MimaStandalone.memorySourceFingerprint(messages,10),promptSettings:{recentMessageLimit:22}});
 assert(prepared.success,JSON.stringify(prepared));
 let err=null;try{await MimaStandalone.runRecordedMemory('rolling',bad.id,{})}catch(e){err=e;}
 assert(err&&err.code==='E_MEMORY_NEEDS_REVIEW','missing event must be review-only');
 const after=(await MimaStandalone.handle('/sessions/'+bad.id,'GET')).data;
 assert.equal(after.lastSummarizedIndex,10,'invalid candidate must not move canonical cursor');
 assert.equal(after.rollingSummary,summary,'invalid candidate must not overwrite old rolling memory');
 assert.equal(after.messages.length,60,'invalid candidate must not prune History');
 const badJob=await MimaLocalStore.getMemoryJob(bad.id,'rolling');assert.equal(badJob.status,'needs_review');
 console.log('PASS negative: rolling missing one source event stays needs_review with stable cursor and History');
})().catch(e=>{console.error('ERROR',e.code,e.details||e.message);process.exitCode=1});
