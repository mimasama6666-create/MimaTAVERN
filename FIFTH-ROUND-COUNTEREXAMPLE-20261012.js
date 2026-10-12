'use strict';
/* Fourth-round source runtime, deterministic fake IndexedDB transactions. Not Chromium conformance. */
const assert=require('node:assert/strict');
const copy=x=>x===undefined?undefined:structuredClone(x);
const durable=new Map();
function db(){return {close(){},transaction(){const staged=new Map([...durable].map(([k,v])=>[k,copy(v)]));let pending=0,ended=false,aborted=false;
 const tx={oncomplete:null,onabort:null,error:null,abort(){if(ended||aborted)return;aborted=true;setImmediate(()=>tx.onabort?.());}};
 const done=()=>{if(pending||ended||aborted)return;ended=true;setImmediate(()=>{if(!aborted){durable.clear();for(const [k,v]of staged)durable.set(k,copy(v));tx.oncomplete?.();}})};
 tx.objectStore=()=>({get(k){pending++;const r={result:undefined,error:null,onsuccess:null,onerror:null};setImmediate(()=>{if(!aborted){r.result=copy(staged.get(k));r.onsuccess?.();}pending--;setImmediate(done)});return r;},put(v,k){staged.set(k,copy(v));return{};},delete(k){staged.delete(k);}});return tx;}}}
global.window=global;global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)};
global.indexedDB={open(){const r={result:db(),onsuccess:null,onerror:null};setImmediate(()=>r.onsuccess?.());return r;}};
require('./local-store.js');require('./standalone-core.js');
const apiText=(body,code=200)=>({ok:code===200,status:code,headers:{get:()=> 'application/json'},clone(){return this},json:async()=>code===200?{choices:[{message:{content:body},finish_reason:'stop'}]}:{error:{message:body}},text:async()=>JSON.stringify(code===200?{choices:[{message:{content:body},finish_reason:'stop'}]}:{error:{message:body}})});
(async()=>{
 await MimaStandalone.init(); MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',contextWindowTokens:32768,stream:false});
 const s=(await MimaStandalone.handle('/sessions','POST',{title:'独立伪记忆回放'})).data;
 const m=[{id:'u',role:'user',content:'我把蓝宝石项链送给玛丽。',rawContent:'我把蓝宝石项链送给玛丽。',versions:[]},{id:'a',role:'assistant',content:'玛丽接受蓝宝石项链。',rawContent:'玛丽接受蓝宝石项链。',versions:[]}];
 console.log('seed', (await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages:m})).success);
 let fake=JSON.stringify({memory:'玛丽把蓝宝石项链献给了从未出现的恶魔，并发誓永远背叛主人。',evidence:[{quote:'玛丽接受蓝宝石项链'}]});
 global.fetch=async()=>apiText(fake);
 const x=await MimaStandalone.handle(`/sessions/${s.id}/memory/core`,'POST',{source:'context'});
 const latest=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;
 console.log('FABRICATED_FIRST',JSON.stringify({ok:x.success,code:x.code||'',message:x.msg||'',persisted:latest.manualMemory.core.content,injects:((await MimaStandalone.handle(`/sessions/${s.id}/prompt-preview`,'POST')).data.systemPreview||'').includes('从未出现的恶魔')}));
 fake=JSON.stringify({memory:'玛丽接受蓝宝石项链。',evidence:[{quote:'玛丽接受蓝宝石项链'}]});
 const y=await MimaStandalone.handle(`/sessions/${s.id}/memory/core`,'POST',{source:'context'});
 console.log('REPEAT_CORE',JSON.stringify({ok:y.success,code:y.code||'',message:y.msg||'',persisted:(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data.manualMemory.core.content}));
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:4096,maxTokens:8192});
 const small=(await MimaStandalone.handle(`/sessions/${s.id}/prompt-preview`,'POST',{draft:'继续'}));
 console.log('IMPOSSIBLE_PROVIDER_BUDGET',JSON.stringify({previewSuccess:small.success,code:small.code||'',estimated:small.data?.estimatedInputTokens||null,window:4096,reservedOutput:8192,invalidRequestPossible:!!small.success}));
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:32768,maxTokens:0});
 const timeline=Array.from({length:200},(_,i)=>({id:'turn'+i,role:i%2?'assistant':'user',content:i===0?'十年前主人把蜂蜜藏在楼梯下的青花瓷罐里。':`第${i}次移动。`,rawContent:i===0?'十年前主人把蜂蜜藏在楼梯下的青花瓷罐里。':`第${i}次移动。`,versions:[]}));
 const ss=(await MimaStandalone.handle('/sessions','POST',{title:'无关键词旧约定'})).data;
 await MimaStandalone.handle(`/sessions/${ss.id}`,'PATCH',{messages:timeline,promptSettings:{recentMessageLimit:12}});
 const continuation=(await MimaStandalone.handle(`/sessions/${ss.id}/prompt-preview`,'POST',{draft:'继续'}));
 console.log('GENERIC_CONTINUATION',JSON.stringify({previewSuccess:continuation.success,oldRetrieved:continuation.data?.contextTrace?.retrievedCount,oldOmitted:continuation.data?.contextTrace?.omittedCount,promptContainsOldPromise:continuation.data?.messagePreview?.some(m=>m.content.includes('青花瓷罐'))}));

})().catch(e=>{console.error(e);process.exitCode=1});
