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
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',contextWindowTokens:32768,stream:false});
 const orig=(await MimaStandalone.handle('/sessions','POST',{title:'500轮连续记忆'})).data;
 for(const n of [50,200,500]){
  const records=Array.from({length:n*2},(_,i)=>({id:'r'+i,role:i%2?'assistant':'user',content:(i===0?'古老物品：蓝宝石项链。':'连续冒险的事件和角色反应')+('柔和爵士音乐回荡在大厅'.repeat(18)),rawContent:(i===0?'古老物品：蓝宝石项链。':'连续冒险的事件和角色反应')+('柔和爵士音乐回荡在大厅'.repeat(18)),versions:[]}));
  const save=await MimaStandalone.handle(`/sessions/${orig.id}`,'PATCH',{messages:records,promptSettings:{recentMessageLimit:12}});assert(save.success,JSON.stringify(save));
  const p=(await MimaStandalone.handle(`/sessions/${orig.id}/prompt-preview`,'POST',{draft:'主人寻找蓝宝石项链'})).data;
  assert(p.estimatedInputTokens<=Math.floor(32768*.85)-4096,'overbudget prompt: '+p.estimatedInputTokens);
  assert.equal(p.recentMessageCount,12,'configured recent history must not be changed');
  assert.equal(p.contextTrace.sourceCount,n*2);assert(p.contextTrace.uncoveredRawCount>0);if(n>=200)assert(p.contextTrace.omittedCount>0);
  assert(p.contextTrace.retrievedIds.includes('r0'),'query-related old source must be indexed by stable id');
  assert.equal((await MimaStandalone.handle(`/sessions/${orig.id}`,'GET')).data.messages.length,n*2,'history was mutated by retrieval');
  console.log('PASS long history rounds='+n+' estimatedTokens='+p.estimatedInputTokens+' retrieved='+p.contextTrace.retrievedCount+' omitted='+p.contextTrace.omittedCount);
 }
 // The user can choose a provider window too small for mandatory Prompt; do not trim Persona/recent and claim success.
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:4096});
 const tiny=await MimaStandalone.handle(`/sessions/${orig.id}/prompt-preview`,'POST',{});
 assert.equal(tiny.success,false);assert.equal(tiny.code,'E_CONTEXT_BUDGET_BASE');
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:32768});
 // memory 429 is isolated from the very next direct reply and doesn't empty the journal or history
 let story=0,rollingStarted,releaseMemory;const seenRolling=new Promise(resolve=>rollingStarted=resolve);
 global.fetch=async(_url,o)=>{const data=JSON.parse(o.body);const isMemory=String(data.messages?.[0]?.content).includes('独立剧情档案助手')||String(data.messages?.[0]?.content).includes('记忆输出契约');
  if(isMemory){rollingStarted();await new Promise(resolve=>releaseMemory=resolve);return apiText('rate limited',429);}story++;return apiText('角色顺利回复 '+story);};
 const a=await MimaStandalone.handle(`/sessions/${orig.id}/chat`,'POST',{text:'继续故事甲',action:'send'});assert(a.success,JSON.stringify(a));
 await seenRolling; // the auxiliary Provider request is actually in flight, not a simulated idle flag
 const b=await MimaStandalone.handle(`/sessions/${orig.id}/chat`,'POST',{text:'继续故事乙',action:'send'});assert(b.success,JSON.stringify(b));
 assert.equal(story,2);assert((await MimaStandalone.handle(`/sessions/${orig.id}`,'GET')).data.messages.length===1004);
 releaseMemory();await new Promise(r=>setTimeout(r,35));
 // independent session for source-backed structured candidate/refusal paths
 const s=(await MimaStandalone.handle('/sessions','POST',{title:'拒绝模板验收'})).data;
 const records=[{id:'u',role:'user',content:'我把蓝宝石项链送给玛丽。',rawContent:'我把蓝宝石项链送给玛丽。',versions:[]},{id:'a',role:'assistant',content:'玛丽接受蓝宝石项链。',rawContent:'玛丽接受蓝宝石项链。',versions:[]}];
 assert((await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages:records})).success);
 const refusal='I am sorry, but I cannot assist with that request.';global.fetch=async()=>apiText(refusal);
 for(const kind of ['core','facts']){
  const r=await MimaStandalone.handle(`/sessions/${s.id}/memory/${kind}`,'POST',kind==='core'?{source:'context'}:{scope:'all'});
  assert.equal(r.success,false,JSON.stringify(r));assert.equal(r.code,'E_MEMORY_OUTPUT_INVALID');
  const latest=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;
  assert.equal(latest.manualMemory.core.content,'');assert.equal(latest.manualMemory.facts.length,0);
 }
 const json=JSON.stringify({memory:'玛丽接受蓝宝石项链。',evidence:[{quote:'玛丽接受蓝宝石项链'}]});
 global.fetch=async()=>apiText(json);const good=await MimaStandalone.handle(`/sessions/${s.id}/memory/core`,'POST',{source:'context'});
 assert(good.success,JSON.stringify(good));assert.equal(good.data.manualMemory.core.content,'玛丽接受蓝宝石项链。');
 const prompt=(await MimaStandalone.handle(`/sessions/${s.id}/prompt-preview`,'POST')).data;
 assert(prompt.memoryTrace.some(x=>x.kind==='core'&&x.injected));assert(prompt.systemPreview.includes('玛丽接受蓝宝石项链。'));
 global.fetch=async()=>apiText(JSON.stringify({memory:'一条无来源记忆',evidence:[{quote:'来源里没有这个句子'}]}));
 const invalid=await MimaStandalone.handle(`/sessions/${s.id}/memory/core`,'POST',{source:'context'});
 if(invalid.code!=='E_MEMORY_OUTPUT_INVALID')console.log('INVALID_DEBUG',JSON.stringify(invalid));assert.equal(invalid.code,'E_MEMORY_OUTPUT_INVALID');
 assert.equal((await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data.manualMemory.core.content,'玛丽接受蓝宝石项链。');
 // Rolling memory also rejects prose refusal, without losing existing archives or blocking a follow-up story.
 const roll=(await MimaStandalone.handle('/sessions','POST',{title:'滚动候选拒绝'})).data;
 const rollMessages=Array.from({length:60},(_,i)=>({id:'roll-'+i,role:i%2?'assistant':'user',content:i%2?'玛丽在月下守住蓝宝石项链':'主人记得蓝宝石项链',rawContent:i%2?'玛丽在月下守住蓝宝石项链':'主人记得蓝宝石项链',versions:[]}));
 assert((await MimaStandalone.handle(`/sessions/${roll.id}`,'PATCH',{messages:rollMessages,promptSettings:{recentMessageLimit:12}})).success);
 global.fetch=async()=>apiText(refusal);
 let rejected=null;try{await MimaStandalone.runRecordedMemory('rolling',roll.id,{temperature:0.3});}catch(e){rejected=e;}
 assert.equal(rejected?.code,'E_MEMORY_OUTPUT_INVALID',String(rejected));
 const afterRoll=(await MimaStandalone.handle(`/sessions/${roll.id}`,'GET')).data;
 assert.equal(afterRoll.rollingSummary,'');assert.equal(afterRoll.messages.length,60);
 const rollJob=await MimaLocalStore.getMemoryJob(roll.id,'rolling');assert.equal(rollJob.status,'failed');
 // Legacy 'received' checkpoints could predate the new output contract: the recovered candidate
 // must still fail source validation, with no new write to the canonical story.
 const poisoned={...rollJob,stage:'rolling_summary_received',status:'interrupted',checkpoints:[{stage:'rolling_summary_received',output:refusal,time:new Date().toISOString()}]};
 durable.set(`memory_job:${roll.id}:rolling`,poisoned);
 let fenced=null;try{await MimaStandalone.runRecordedMemory('rolling',roll.id,{temperature:0.3});}catch(e){fenced=e;}
 assert.equal(fenced?.code,'E_MEMORY_OUTPUT_INVALID',String(fenced));
 assert.equal((await MimaStandalone.handle(`/sessions/${roll.id}`,'GET')).data.rollingSummary,'');
 // Durable lease: current owner cannot be stolen; expiry keeps job ID but changes attempt;
 // old stage/settlement is fenced; no empty-state substitution.
 const st=MimaLocalStore;
 const input={sessionId:s.id,kind:'rolling',options:{temperature:0.3},sourceHash:'s',sourceCount:2,configSignature:'model1'};
 const job=await st.beginMemoryJob(input);await assert.rejects(st.beginMemoryJob(input),/E_MEMORY_JOB_PENDING/);
 const key=`memory_job:${s.id}:rolling`,expired={...durable.get(key),leaseUntilEpoch:Date.now()-1};durable.set(key,expired);
 const resumed=await st.beginMemoryJob(input);assert.equal(resumed.id,job.id);assert.notEqual(resumed.attemptId,job.attemptId);
 assert.equal(resumed.recoveryCount,1);await assert.rejects(st.checkpointMemoryJob(job,'bad_old'),/E_MEMORY_JOB_FENCED/);
 await st.checkpointMemoryJob(resumed,'valid_new');const live=await st.getMemoryJob(s.id,'rolling');assert.equal(live.stage,'valid_new');
 await st.settleMemoryJob(resumed,'aborted','manual_test');
 console.log('PASS fourth memory P0: rejected core/facts refusal; source-proven JSON memory injected; invalid evidence held; exact lease takeover and old-attempt fencing');
})().catch(e=>{console.error(e);process.exitCode=1});
