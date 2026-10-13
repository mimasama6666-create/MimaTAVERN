'use strict';
// R11.17: rolling replacement must neither reject true old+new claims nor
// certify a new-only summary which erases already covered original events.
const assert=require('node:assert/strict'),path=require('node:path');
const deep=x=>x===undefined?undefined:structuredClone(x), dbData=new Map();
function db(){return {close(){},transaction(){let pending=0,done=false,aborted=false;const staged=new Map([...dbData].map(([k,v])=>[k,deep(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};
 const finish=()=>{if(done||aborted||pending)return;done=true;setImmediate(()=>{if(aborted)return;dbData.clear();for(const [k,v] of staged)dbData.set(k,deep(v));tx.oncomplete?.();});};
 tx.objectStore=()=>({get(key){pending++;const req={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{req.result=deep(staged.get(key));req.onsuccess?.();pending--;setImmediate(finish)});return req;},put(v,key){staged.set(key,deep(v));return{}},delete(key){staged.delete(key);return{}}});return tx;}};}
global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req;}};
const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};
require(path.join(__dirname,'../local-store.js'));require(path.join(__dirname,'../standalone-core.js'));
const content=i=>`事件${String.fromCodePoint(0x4e00+i)}记录在不同的档案中。`;
const messages=Array.from({length:40},(_,i)=>({id:'rolling-'+i,role:i%2?'assistant':'user',content:content(i),rawContent:content(i),versions:[]}));
const run=id=>MimaStandalone.runRecordedMemory('rolling',id,{}).then(data=>({ok:true,data})).catch(e=>({ok:false,code:e.code||e.message}));
const mk=async(label)=>{const s=(await MimaStandalone.handle('/sessions','POST',{title:label})).data;
 const prep=await MimaStandalone.handle('/sessions/'+s.id,'PATCH',{messages,rollingSummary:messages.slice(0,10).map(m=>m.content).join('\n'),summary:messages.slice(0,10).map(m=>m.content).join('\n'),lastSummarizedIndex:10,rollingSourceCount:10,rollingSourceFingerprint:MimaStandalone.memorySourceFingerprint(messages,10),promptSettings:{recentMessageLimit:22}});
 assert(prep.success,JSON.stringify(prep));return s.id;};
let response='',sent=0;global.fetch=async()=>{sent++;const payload={choices:[{message:{content:response},finish_reason:'stop'}]};return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>payload,text:async()=>JSON.stringify(payload)};};
(async()=>{await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'synthetic',stream:false,contextWindowTokens:32768});
 if(process.env.R11_NEGATIVE_ONLY!=='1'){
 const a=await mk('old and new');response=JSON.stringify({memory:messages.slice(0,22).map(m=>m.content).join('\n'),evidence:messages.slice(0,22).map(m=>({quote:m.content}))});const positive=await run(a);assert(positive.ok,JSON.stringify({ok:positive.ok,code:positive.code}));
 assert.equal(positive.data.lastSummarizedIndex,22);assert.equal(positive.data.messages.length,40);
 assert(positive.data.rollingSummary.includes(content(0))&&positive.data.rollingSummary.includes(content(21)));
 console.log('PASS positive old+new anchored rolling summary commits once');
 }
 const b=await mk('new-only omission');response=JSON.stringify({memory:messages.slice(10,22).map(m=>m.content).join('\n'),evidence:messages.slice(10,22).map(m=>({quote:m.content}))});const negative=await run(b);
 assert.equal(negative.ok,false,JSON.stringify({ok:negative.ok,code:negative.code,cursor:negative.data?.lastSummarizedIndex}));assert.equal(negative.code,'E_MEMORY_NEEDS_REVIEW');
 const after=(await MimaStandalone.handle('/sessions/'+b,'GET')).data;
 assert.equal(after.lastSummarizedIndex,10);assert(after.rollingSummary.includes(content(0)));
 const job=await MimaLocalStore.getMemoryJob(b,'rolling');assert.equal(job.status,'needs_review');
 assert(job.checkpoints.some(c=>c.stage==='rolling_summary_needs_review'||c.stage==='rolling_final_coverage'));
 console.log('PASS negative erasure of old events refuses cursor advancement and retains canonical summary');
 console.log('calls=',sent);
})().catch(e=>{console.error(e);process.exitCode=1});
