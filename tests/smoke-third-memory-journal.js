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
let memoryGate=null, memoryRequested=0, storyRequested=0,emptyMemory=false;
const response=(content,status=200)=>({ok:status===200,status,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{total_tokens:25}}),json:async()=>({choices:[{message:{content},finish_reason:'stop'}],usage:{total_tokens:25}}),clone(){return this}});
global.fetch=async (_url,opts)=>{const data=JSON.parse(opts.body);const memory=String(data.messages?.[0]?.content||'').includes('事实记忆整理器')||String(data.messages?.[0]?.content||'').includes('核心记忆');if(memory){memoryRequested++;if(memoryGate)await memoryGate.promise;return response(emptyMemory?'':'好朋友曾把钥匙放进蓝色盒子');}storyRequested++;return response('角色回复');};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4099/v1',model:'mock',stream:false});
 const create=await MimaStandalone.handle('/sessions','POST',{title:'模拟长剧情'});assert(create.success);const id=create.data.id;
 const records=[];for(let k=0;k<6;k++){records.push({id:'u-'+k,role:'user',content:'钥匙在蓝色盒子里',rawContent:'钥匙在蓝色盒子里',versions:[]},{id:'a-'+k,role:'assistant',content:'我会记得蓝色盒子',rawContent:'我会记得蓝色盒子',versions:[]});}
 assert((await MimaStandalone.handle(`/sessions/${id}`,'PATCH',{messages:records})).success);
 memoryGate=defer();let phase='';const memory=MimaStandalone.handle(`/sessions/${id}/memory/facts`,'POST',{chunkRounds:10,scope:'all',replaceExisting:false},null,x=>{phase=x.phase});
 for(let j=0;j<40&&memoryRequested===0;j++)await new Promise(r=>setTimeout(r,5));if(memoryRequested!==1){console.log('memory preflight',await memory,'raw keys', [...raw.keys()]);}assert.equal(memoryRequested,1,'memory background request admitted');
 // Even while summary is pending, main chat is not gated; reply is canonical.
 const chat=await MimaStandalone.handle(`/sessions/${id}/chat`,'POST',{text:'今天继续冒险',action:'send'},null);assert.equal(chat.success,true,JSON.stringify(chat));assert.equal(chat.data.messages.at(-1).content,'角色回复');
 memoryGate.resolve();const mem=await memory;assert.equal(mem.success,true,JSON.stringify(mem));assert(mem.data.manualMemory.facts[0].content.includes('钥匙'));
 assert(mem.data.messages.some(m=>m.content==='今天继续冒险'));
 const inspector=(await MimaStandalone.handle(`/sessions/${id}/prompt-preview`,'POST')).data;
 assert(inspector.sections.some(x=>x.name==='manual_fact_memories'),'confirmed memory injected into next prompt');
 assert(inspector.memoryTrace.some(x=>x.kind==='fact'&&x.injected));
 const journal=await MimaLocalStore.getMemoryJob(id,'facts');assert.equal(journal.status,'committed');assert.equal(journal.sourceCount,12);
 // A stale source must never overwrite canonical memory.
 memoryGate=defer();const second=MimaStandalone.handle(`/sessions/${id}/memory/core`,'POST',{source:'context'},null);for(let j=0;j<40&&memoryRequested<2;j++)await new Promise(r=>setTimeout(r,5));
 assert((await MimaStandalone.handle(`/sessions/${id}/messages/u-0`,'PATCH',{content:'不在蓝色盒子里'})).success);
 memoryGate.resolve();const stale=await second;assert.equal(stale.success,false);assert.match(stale.code,/E_MEMORY_SOURCE_STALE/);
 const latest=(await MimaStandalone.handle(`/sessions/${id}`,'GET')).data;assert.equal(latest.manualMemory.core.content,'');
 assert((await MimaLocalStore.getMemoryJob(id,'core')).status==='failed');
 // Fatal HTTP 200 empty response never destroys preexisting facts.
 emptyMemory=true;memoryGate=null;
 const empty=await MimaStandalone.handle(`/sessions/${id}/memory/facts`,'POST',{chunkRounds:10,scope:'all',replaceExisting:true});assert.equal(empty.success,false);assert.equal(empty.code,'E_API_EMPTY_REPLY');
 const after=(await MimaStandalone.handle(`/sessions/${id}`,'GET')).data;assert(after.manualMemory.facts.length===1);
 // Long session: an async Rolling Summary must not leave an uncovered raw-history gap.
 const long=(await MimaStandalone.handle('/sessions','POST',{title:'记忆压测'})).data;const longId=long.id;
 const longMessages=Array.from({length:65},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',content:'连续旧剧情-'+i,rawContent:'连续旧剧情-'+i,versions:[]}));
 assert((await MimaStandalone.handle(`/sessions/${longId}`,'PATCH',{messages:longMessages,promptSettings:{recentMessageLimit:12}})).success);
 const covered=(await MimaStandalone.handle(`/sessions/${longId}/prompt-preview`,'POST')).data;
 assert(covered.unsummarizedGapCount>0,'pending Rolling Summary must retain not-yet-summarized raw text');
 assert(covered.messagePreview.some(x=>String(x.content).includes('连续旧剧情-0')),'unsummarized original first turn missing from prompt');
 const rollingGate=defer();let rollingCalls=0,storyWhileRolling=0;
 global.fetch=async(_url,o)=>{const data=JSON.parse(o.body);if(String(data.messages?.[0]?.content||'').includes('剧情档案助手')){rollingCalls++;await rollingGate.promise;return response('旧剧情完整浓缩摘要');}storyWhileRolling++;return response('并行角色回复 '+storyWhileRolling);};
 const sendOne=await MimaStandalone.handle(`/sessions/${longId}/chat`,'POST',{text:'新冒险甲',action:'send'});
 assert.equal(sendOne.success,true,JSON.stringify(sendOne));
 for(let i=0;i<40&&rollingCalls===0;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(rollingCalls,1,'should enqueue Rolling model request after direct reply, without waiting');
 const sendTwo=await MimaStandalone.handle(`/sessions/${longId}/chat`,'POST',{text:'新冒险乙',action:'send'});
 assert.equal(sendTwo.success,true,JSON.stringify(sendTwo));
 assert.equal(storyWhileRolling,2,'two Direct Replies should proceed while rolling LLM is pending');
 rollingGate.resolve();
 let rollingJob=null;for(let i=0;i<80;i++){rollingJob=await MimaLocalStore.getMemoryJob(longId,'rolling');if(rollingJob?.status==='committed')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(rollingJob?.status,'committed','Rolling job should settle independently');
 const afterRolling=(await MimaStandalone.handle(`/sessions/${longId}`,'GET')).data;
 assert(afterRolling.messages.some(x=>x.content==='新冒险乙'));
 assert.equal(afterRolling.rollingSummary,'旧剧情完整浓缩摘要');
 console.log('PASS third memory journal: Direct Reply concurrent with Rolling Summary; unsummarized gap preserved, append-only rebase persisted');
 console.log('PASS third memory job transaction fake: chat concurrent, CAS commit, prompt injection, stale source rejection, empty API preserves old, stable job states');
})().catch(e=>{console.error(e);process.exitCode=1});
