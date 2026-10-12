'use strict';
// Dedicated R8 adversarial regression; does not modify any historical assertion.
const assert=require('node:assert/strict'),path=require('node:path');
const deep=x=>x===undefined?undefined:structuredClone(x),raw=new Map();
function db(){return{close(){},transaction(){let pending=0,finished=false,aborted=false;const staged=new Map([...raw].map(([k,v])=>[k,deep(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};const done=()=>{if(finished||aborted||pending)return;finished=true;setImmediate(()=>{if(!aborted){raw.clear();for(const [k,v]of staged)raw.set(k,deep(v));tx.oncomplete?.();}})};const obj={get(key){pending++;const req={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{req.result=deep(staged.get(key));req.onsuccess?.();pending--;setImmediate(done)});return req;},put(v,k){staged.set(k,deep(v));return{}},delete(k){staged.delete(k);return{}}};tx.objectStore=()=>obj;return tx;}}}
global.window=global;global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,v)=>pref.set(x,v)};require('../local-store.js');require('../standalone-core.js');
let responder=()=>'',calls=0;global.fetch=async(_url,opts)=>{calls++;const content=responder(JSON.parse(opts.body));return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})}};
const route=(a,b,c)=>MimaStandalone.handle(a,b,c);
const msg=(id,content)=>({id,role:'user',content,rawContent:content,versions:[]});
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'fake',stream:false,contextWindowTokens:32768});
 const factText='玩家和塔主在清晨约定一起守护铜制钥匙。';
 async function factCase(kind,stale=false,citation){const s=(await route('/sessions','POST',{title:kind})).data;const messages=[msg('original','清晨，塔主在塔顶交付了一把铜制钥匙。'),msg('another','玩家收下了钥匙，把它锁在盒子里。')];const sourceFingerprint=MimaStandalone.memorySourceFingerprint(messages,messages.length);await route(`/sessions/${s.id}`,'PATCH',{messages,manualMemory:{core:{content:''},facts:[{id:'fact-'+kind,startRound:1,endRound:1,content:factText,stale,sourceCount:kind==='human'?0:messages.length,sourceFingerprint:kind==='human'?'':sourceFingerprint,verification:{status:kind==='human'?'human_confirmed':kind==='verified'?'extractive_verified':'legacy_unverified',stage:'source',citations:citation?[citation]:[]}}]}});responder=()=>JSON.stringify({memory:factText,evidence:[{quote:factText}]});const result=await route(`/sessions/${s.id}/memory/core`,'POST',{source:'facts'});return{result,state:(await route(`/sessions/${s.id}`,'GET')).data,job:await MimaLocalStore.getMemoryJob(s.id,'core')};}
 const human=await factCase('human');assert(human.result.success,JSON.stringify(human.result));assert.equal(human.state.manualMemory.core.content,factText);console.log('PASS R8 human_confirmed facts -> core');
 const legacy=await factCase('legacy');assert(!legacy.result.success);assert.equal(legacy.result.code,'E_MEMORY_NO_VERIFIED_FACTS');assert.equal(legacy.state.manualMemory.core.content,'');console.log('PASS R8 legacy_unverified cannot be promoted');
 const stale=await factCase('human',true);assert(!stale.result.success);assert.equal(stale.result.code,'E_MEMORY_NO_VERIFIED_FACTS');console.log('PASS R8 stale human fact cannot be promoted');
 const forged=await factCase('verified',false,{messageId:'original',role:'user',start:0,end:8,quote:'与原文不一致'});assert(!forged.result.success);assert.equal(forged.result.code,'E_MEMORY_NO_VERIFIED_FACTS');console.log('PASS R8 invalid fact citation cannot be laundered');
 // When identical user statements repeat, one verified canonical occurrence
 // covers the duplicate; normal short repetitive stories must not be blocked.
 const good=(await route('/sessions','POST',{title:'repetitive extractive summary'})).data;
 const phrase='玩家把相同的地图放进安全柜，并将柜门锁好。';
 const repeats=Array.from({length:42},(_,i)=>msg('repeat-'+i,phrase));
 await route(`/sessions/${good.id}`,'PATCH',{messages:repeats,promptSettings:{recentMessageLimit:12}});
 responder=()=>JSON.stringify({memory:phrase,evidence:[{quote:phrase}]});
 const ok=await MimaStandalone.runRecordedMemory('rolling',good.id,{});assert.equal(ok.lastSummarizedIndex,24);assert.equal(ok.messages.length,42);console.log('PASS R8 duplicate true-source event rolls without losing repeated originals');
 // Long 2+ chunk coverage: result is valid as a quote but demonstrably omits
 // >90% of independent source messages. Must stop before canonical commit.
 const s=(await route('/sessions','POST',{title:'missing final events'})).data;
 const messages=Array.from({length:60},(_,i)=>msg('event-'+i,'第'+i+'条剧情：第'+i+'次事件由独立人物参与。'.repeat(100)));
 await route(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
 const stages=[];responder=payload=>{const prompt=payload.messages.at(-1).content;const merge=prompt.includes('【已校验的分片摘要】');const n=merge?0:Number(prompt.match(/第(\d+)条剧情/)?.[1]||0);stages.push({merge,n});return JSON.stringify({memory:messages[n].content,evidence:[{quote:messages[n].content}]});};
 const before=await route(`/sessions/${s.id}`,'GET');assert(before.success);
 const failure=await MimaStandalone.runRecordedMemory('rolling',s.id,{}).then(data=>({success:true,data})).catch(e=>({success:false,code:e.code,message:e.message}));assert(!failure.success,JSON.stringify(failure));assert.equal(failure.code,'E_MEMORY_NEEDS_REVIEW');
 const after=(await route(`/sessions/${s.id}`,'GET')).data,job=await MimaLocalStore.getMemoryJob(s.id,'rolling');
 assert.equal(after.lastSummarizedIndex,0);assert.equal(after.rollingSummary,'');assert.equal(after.messages.length,60);assert.equal(job.status,'needs_review');
 const evidence=job.checkpoints.find(x=>x.stage==='rolling_final_coverage');assert(evidence&&evidence.missingCount>=20,JSON.stringify(evidence));assert(stages.length>=3);
 console.log('PASS R8 merge with dropped messages is REVIEW not COMMITTED, journal missingCount='+evidence.missingCount+', source and cursor untouched');
 // The user may explicitly approve a corrected full summary with the same
 // durable plan; merely accepting an individual part never advances the cursor.
 const pending=job.checkpoints.find(x=>x.stage==='rolling_merge_needs_review');assert(pending);
 const approved=await MimaLocalStore.reviewMemoryCandidate(s.id,'rolling',job.id,'accept','人工逐条核查了全部来源并确认结局；原始剧情不删除。');assert.equal(approved.status,'committed');await MimaStandalone.init();
 const confirmed=(await route(`/sessions/${s.id}`,'GET')).data;assert.equal(confirmed.rollingVerification.status,'human_confirmed');assert.equal(confirmed.lastSummarizedIndex,42);assert.equal(confirmed.messages.length,60);console.log('PASS R8 explicit full-scope human approval retains original history');
})().catch(e=>{console.error(e);process.exitCode=1});
