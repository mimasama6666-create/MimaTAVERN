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
require('../local-store.js');require('../standalone-core.js');
const apiText=(body,code=200)=>({ok:code===200,status:code,headers:{get:()=> 'application/json'},clone(){return this},json:async()=>code===200?{choices:[{message:{content:body},finish_reason:'stop'}]}:{error:{message:body}},text:async()=>JSON.stringify(code===200?{choices:[{message:{content:body},finish_reason:'stop'}]}:{error:{message:body}})});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',contextWindowTokens:32768,stream:false});
 const session=(await MimaStandalone.handle('/sessions','POST',{title:'Fifth causal memory review'})).data;
 const original=[{id:'u',role:'user',content:'我把蓝宝石项链送给玛丽。',rawContent:'我把蓝宝石项链送给玛丽。',versions:[]},{id:'a',role:'assistant',content:'玛丽接受蓝宝石项链。',rawContent:'玛丽接受蓝宝石项链。',versions:[]}];
 assert((await MimaStandalone.handle(`/sessions/${session.id}`,'PATCH',{messages:original})).success);
 async function generate(input,source='context'){
  global.fetch=async()=>apiText(typeof input==='string'?input:JSON.stringify(input));
  return MimaStandalone.handle(`/sessions/${session.id}/memory/core`,'POST',{source});
 }
 for(const [name,bad] of [
 ['new demon',{memory:'玛丽把蓝宝石项链献给从未出现的恶魔，并发誓永远背叛主人。',evidence:[{quote:'玛丽接受蓝宝石项链'}]}],
 ['reversed actor',{memory:'主人接受了玛丽赠送的蓝宝石项链。',evidence:[{quote:'玛丽接受蓝宝石项链'}]}],
 ['negation',{memory:'玛丽没有接受蓝宝石项链。',evidence:[{quote:'玛丽接受蓝宝石项链'}]}],
 ['new promise',{memory:'玛丽接受蓝宝石项链并发誓背叛主人。',evidence:[{quote:'玛丽接受蓝宝石项链'}]}],
 ['plain unsupported','玛丽向恶魔许下永远背叛主人的诺言。']]){
  const r=await generate(bad);assert.equal(r.success,false,name+JSON.stringify(r));assert.equal(r.code,'E_MEMORY_NEEDS_REVIEW');
  assert.equal((await MimaStandalone.handle(`/sessions/${session.id}`,'GET')).data.manualMemory.core.content,'');
  const j=await MimaLocalStore.getMemoryJob(session.id,'core');assert.equal(j.status,'failed');
  assert(j.checkpoints.some(c=>c.stage?.endsWith('_needs_review')&&c.candidate),'candidate missing from journal');
  console.log('PASS review fenced:',name);
 }
 const proven={memory:'玛丽接受蓝宝石项链。',evidence:[{quote:'玛丽接受蓝宝石项链。'}]};
 for(let n=1;n<=3;n++){
  const done=await generate(proven);assert.equal(done.success,true,'repeat '+n+' '+JSON.stringify(done));
  assert.equal(done.data.manualMemory.core.content,proven.memory);
  assert.equal(done.data.manualMemory.core.verification.status,'extractive_verified');
  assert(done.data.manualMemory.core.verification.citations.some(c=>c.messageId==='a'&&c.start===0));
  const journal=await MimaLocalStore.getMemoryJob(session.id,'core');assert.equal(journal.status,'committed');
  assert(journal.checkpoints.some(c=>c.provenance?.some(p=>p.messageId==='a'&&p.start===0&&p.quote===proven.evidence[0].quote)));
  console.log('PASS repeated core',n);
 }
 const gate=deferred();const started=deferred();let blocked=false;
 global.fetch=async()=>{if(!blocked){blocked=true;started.resolve();await gate.promise;}return apiText(JSON.stringify(proven));};
 const pending=MimaStandalone.handle(`/sessions/${session.id}/memory/core`,'POST',{source:'context'});
 await started.promise;
 assert((await MimaStandalone.handle(`/sessions/${session.id}/memory`,'PATCH',{core:{content:'主人亲自确认的修改：玛丽接受了礼物。'}})).success);
 gate.resolve();const collided=await pending;assert.equal(collided.success,false);assert.match(collided.code,/CORE_CONFLICT/);
 assert.equal((await MimaStandalone.handle(`/sessions/${session.id}`,'GET')).data.manualMemory.core.content,'主人亲自确认的修改：玛丽接受了礼物。');
 console.log('PASS human edit CAS fenced');
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:4096,maxTokens:8192});
 const budget=await MimaStandalone.handle(`/sessions/${session.id}/prompt-preview`,'POST',{draft:'继续'});
 assert.equal(budget.success,false);assert.equal(budget.code,'E_CONTEXT_BUDGET_CONFIG');
 let attempts=0;global.fetch=async()=>{attempts++;return apiText('unexpected call')};
 const impossible=await MimaStandalone.handle(`/sessions/${session.id}/chat`,'POST',{text:'不要改参数',action:'send'});
 assert.equal(impossible.success,false);assert.equal(attempts,0);console.log('PASS budget fails before provider');
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:32768,maxTokens:0});
 for(const rounds of [50,200,500]){
  const long=(await MimaStandalone.handle('/sessions','POST',{title:'Long session '+rounds})).data;
  const lines=Array.from({length:rounds*2},(_,i)=>({id:'event-'+i,role:i%2?'assistant':'user',content:i===0?'十年前主人把蜂蜜藏在楼梯下的青花瓷罐里。':`第${i}次移动。`,rawContent:i===0?'十年前主人把蜂蜜藏在楼梯下的青花瓷罐里。':`第${i}次移动。`,versions:[]}));
  assert((await MimaStandalone.handle(`/sessions/${long.id}`,'PATCH',{messages:lines,promptSettings:{recentMessageLimit:12}})).success);
  const preview=await MimaStandalone.handle(`/sessions/${long.id}/prompt-preview`,'POST',{draft:'继续'});assert(preview.success,JSON.stringify(preview));
  assert(preview.data.contextTrace.retrievedIds.includes('event-0'),'missed original honey');
  assert(preview.data.contextTrace.omittedCount>0);assert(preview.data.estimatedInputTokens<Math.floor(32768*.85)-4096);
  assert.equal((await MimaStandalone.handle(`/sessions/${long.id}`,'GET')).data.messages.length,rounds*2);
  console.log('PASS generic long continuation',rounds,'retrieved',preview.data.contextTrace.retrievedCount,'omitted',preview.data.contextTrace.omittedCount);
 }
 console.log('PASS FIFTH ROUND causal regressions');
})().catch(e=>{console.error(e);process.exitCode=1});
