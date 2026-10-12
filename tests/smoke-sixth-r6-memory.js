'use strict';
/* Deterministic IndexedDB-like fake: validates transaction callbacks and data lifecycle, NOT browser IDB conformance. */
const assert=require('node:assert/strict');
const raw=new Map();const deep=v=>v===undefined?undefined:structuredClone(v);let openCount=0;
const mkdb=()=>({close(){},transaction(){let pending=0,completed=false,aborted=false;let abortIssue=null;const staged=new Map([...raw].map(([k,v])=>[k,deep(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){if(aborted||completed)return;aborted=true;setImmediate(()=>tx.onabort?.())}};const maybe=()=>{if(completed||aborted||pending)return;completed=true;setImmediate(()=>{if(!aborted){raw.clear();for(const [k,v]of staged)raw.set(k,deep(v));tx.oncomplete?.();}})};const store={get(key){pending++;const req={result:undefined,error:null,transaction:tx,onsuccess:null,onerror:null};setImmediate(()=>{if(!aborted){req.result=deep(staged.get(key));req.onsuccess?.();}pending--;setImmediate(maybe)});return req;},put(value,key){staged.set(key,deep(value));return {};},delete(key){staged.delete(key);return {};}};tx.objectStore=()=>store;return tx;}});
// Workaround: operations begin immediately in their own fake transaction, tests avoid simultaneous same-store writes.
global.window=global;global.indexedDB={open(){openCount++;const req={result:mkdb(),onsuccess:null,onerror:null,onupgradeneeded:null};setImmediate(()=>req.onsuccess?.());return req;}};
global.MimaThemeEngine={apply:()=>{},normalizeSettings:x=>x};
const pref=new Map();global.localStorage={getItem:k=>pref.get(k)||null,setItem:(k,v)=>pref.set(k,v)};
require('../local-store.js');require('../standalone-core.js');

const response=(content,status=200)=>({ok:status===200,status,headers:{get:()=> 'application/json'},clone(){return this},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})});
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',contextWindowTokens:32768,stream:false});
 const created=await MimaStandalone.handle('/sessions','POST',{title:'第六轮记忆核查'});assert(created.success);
 const id=created.data.id, original=[
 {id:'u',role:'user',content:'有人造谣玛丽背叛了我们，但我知道她并没有。',rawContent:'有人造谣玛丽背叛了我们，但我知道她并没有。',versions:[]},
 {id:'a',role:'assistant',content:'玛丽说她收下了蓝宝石项链。',rawContent:'玛丽说她收下了蓝宝石项链。',versions:[]}
 ];
 assert((await MimaStandalone.handle(`/sessions/${id}`,'PATCH',{messages:original})).success);
 const malicious={memory:'玛丽背叛了我们',evidence:[{quote:'有人造谣玛丽背叛了我们，但我知道她并没有。'}]};
 global.fetch=async()=>response(JSON.stringify(malicious));
 const rejected=await MimaStandalone.handle(`/sessions/${id}/memory/core`,'POST',{source:'context'});
 assert.equal(rejected.success,false,JSON.stringify(rejected));assert.equal(rejected.code,'E_MEMORY_NEEDS_REVIEW');
 let journal=await MimaLocalStore.getMemoryJob(id,'core');assert.equal(journal.status,'failed');
 assert.equal((await MimaStandalone.handle(`/sessions/${id}`,'GET')).data.manualMemory.core.content,'');
 let changed=await MimaLocalStore.reviewMemoryCandidate(id,'core',journal.id,'accept','有人散播玛丽背叛的谣言，玩家明确否认了这一说法。');
 assert.equal(changed.status,'committed');await MimaStandalone.init();
 const session=(await MimaStandalone.handle(`/sessions/${id}`,'GET')).data;
 assert.equal(session.manualMemory.core.verification.status,'human_confirmed');
 assert.match(session.manualMemory.core.content,/明确否认/);
 const preview=(await MimaStandalone.handle(`/sessions/${id}/prompt-preview`,'POST',{draft:'继续'})).data;
 assert(preview.messagePreview.some(x=>x.role==='user'&&x.content.includes('明确否认')),'reviewed memory not injected');
 assert(!preview.messagePreview[0].content.includes('明确否认'),'narrative memory promoted into system role');
 assert.equal(session.messages.length,2);
 console.log('PASS rumor stays review, human adoption CAS persists, next prompt data only');
 // human edit fencing: unchanged source but changed target refuses stale approval
 global.fetch=async()=>response('陌生角色突然成为皇帝。');
 const pending=await MimaStandalone.handle(`/sessions/${id}/memory/core`,'POST',{source:'context'});
 assert.equal(pending.code,'E_MEMORY_NEEDS_REVIEW');journal=await MimaLocalStore.getMemoryJob(id,'core');
 assert((await MimaStandalone.handle(`/sessions/${id}/memory`,'PATCH',{core:{content:'经过主人亲自修正的事实'}})).success);
 await assert.rejects(()=>MimaLocalStore.reviewMemoryCandidate(id,'core',journal.id,'accept','错误覆盖'),/E_MEMORY_REVIEW_TARGET_CHANGED/);
 await MimaStandalone.init();
 assert.equal((await MimaStandalone.handle(`/sessions/${id}`,'GET')).data.manualMemory.core.content,'经过主人亲自修正的事实');
 console.log('PASS human edit fences pending approval');
 // fact candidate accepted under same source and inserted into prompt data
 global.fetch=async()=>response('某个人散布谣言，关系出现变化。');
 const f=await MimaStandalone.handle(`/sessions/${id}/memory/facts`,'POST',{scope:'all',chunkRounds:10});
 assert.equal(f.code,'E_MEMORY_NEEDS_REVIEW');const fj=await MimaLocalStore.getMemoryJob(id,'facts');
 await MimaLocalStore.reviewMemoryCandidate(id,'facts',fj.id,'accept','玩家听到了玛丽背叛的谣言，明确否认传闻。');
 await MimaStandalone.init();
 assert((await MimaStandalone.handle(`/sessions/${id}`,'GET')).data.manualMemory.facts.some(x=>x.verification.status==='human_confirmed'));
 console.log('PASS fact review accepted');
 // Rolling Summary must not claim that recent unsummarized tail is covered.
 const history=Array.from({length:60},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:i===0?'收到一封声称国王已经去世的匿名信，但没有确证。':`第${i}轮旅行。`,rawContent:i===0?'收到一封声称国王已经去世的匿名信，但没有确证。':`第${i}轮旅行。`,versions:[]}));
 const long=(await MimaStandalone.handle('/sessions','POST',{title:'滚动审阅'})).data;
 assert((await MimaStandalone.handle(`/sessions/${long.id}`,'PATCH',{messages:history,promptSettings:{recentMessageLimit:12}})).success);
 global.fetch=async()=>response('国王在旅途中遇难。');
 let rollingError;
 try{await MimaStandalone.runRecordedMemory('rolling',long.id,{temperature:0.3});}catch(e){rollingError=e;}
 assert.equal(rollingError?.code,'E_MEMORY_NEEDS_REVIEW');
 const rj=await MimaLocalStore.getMemoryJob(long.id,'rolling');assert.equal(rj.status,'failed');
 await MimaLocalStore.reviewMemoryCandidate(long.id,'rolling',rj.id,'accept','主人收到了匿名来信，但国王的生死仍然没有证实。');
 await MimaStandalone.init();
 const after=(await MimaStandalone.handle(`/sessions/${long.id}`,'GET')).data;
 assert.equal(after.rollingVerification.status,'human_confirmed');
 assert.equal(after.lastSummarizedIndex,42);
 assert.equal(after.rollingSourceCount,42);
 const memory=(await MimaStandalone.handle(`/sessions/${long.id}/prompt-preview`,'POST',{draft:'继续'})).data;
 assert(memory.messagePreview.some(x=>x.role==='user'&&x.content.includes('没有证实')));
 assert(!memory.messagePreview[0].content.includes('没有证实'));
 assert.equal(after.messages.length,60);
 console.log('PASS rolling review accepted, accurate coverage fingerprint, all messages retained');
 console.log('PASS SIXTH ROUND memory review + trust projection');
})().catch(e=>{console.error(e);process.exitCode=1});
