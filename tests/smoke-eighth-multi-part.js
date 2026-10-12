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
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'fake',stream:false,contextWindowTokens:65536});
 for(const plan of [{target:2,count:60,repeats:72},{target:3,count:90,repeats:88},{target:10,count:240,repeats:130}]){
   const s=(await route('/sessions','POST',{title:'R8 multi '+plan.target})).data;
   const messages=Array.from({length:plan.count},(_,i)=>msg('p'+plan.target+'-'+i,`第${i}条剧情：`+'角色在本地日记写下独立的旅程。'.repeat(plan.repeats)));
   await route(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
   let stages=0;responder=payload=>{
      stages++;const text=payload.messages.at(-1).content;
      const n=text.includes('【已校验的分片摘要】')?0:Number(text.match(/第(\d+)条剧情/)?.[1]||0);
      return JSON.stringify({memory:messages[n].content,evidence:[{quote:messages[n].content}]});
   };
   const failed=await MimaStandalone.runRecordedMemory('rolling',s.id,{}).then(()=>({code:'UNEXPECTED_SUCCESS'})).catch(e=>({code:e.code}));
   assert.equal(failed.code,'E_MEMORY_NEEDS_REVIEW',JSON.stringify(failed));
   const j=await MimaLocalStore.getMemoryJob(s.id,'rolling'),source=j.checkpoints.find(c=>c.stage==='rolling_source_plan');
   assert(source.partCount>=plan.target,JSON.stringify({wanted:plan.target,actual:source.partCount}));
   const session=(await route(`/sessions/${s.id}`,'GET')).data;assert.equal(session.messages.length,plan.count);assert.equal(session.lastSummarizedIndex,0);
   assert(j.checkpoints.some(c=>c.stage==='rolling_final_coverage'&&c.missingCount>=plan.count/2));
   console.log('PASS R8 missing merge '+source.partCount+' partitions '+plan.count+' messages; original history retained; journal='+j.status+'; calls='+stages);
 }
 // Small, exactly attributable omission is repaired with ONE extra model call.
 const small=(await route('/sessions','POST',{title:'bounded coverage repair'})).data;
 const a='玩家把一把金钥匙交给塔主，并要求保守秘密。';const b='第二日塔主把那把钥匙藏入书房左侧的抽屉。';
 const messages=Array.from({length:42},(_,i)=>msg('d'+i,i===5?b:a));
 await route(`/sessions/${small.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
 let callsBefore=calls;
 responder=payload=>{const text=payload.messages.at(-1).content;const quote=text.includes('【必须补录的旧剧情原文】')?b:a;return JSON.stringify({memory:quote,evidence:[{quote}]});};
 const result=await MimaStandalone.runRecordedMemory('rolling',small.id,{});
 assert.equal(result.lastSummarizedIndex,24);assert(result.rollingSummary.includes(a)&&result.rollingSummary.includes(b));assert.equal(result.messages.length,42);
 assert.equal(calls-callsBefore,2,'one normal summary plus one bounded repair');
 const job=await MimaLocalStore.getMemoryJob(small.id,'rolling');assert(job.checkpoints.some(c=>c.stage==='rolling_coverage_repair_checked'));
 console.log('PASS R8 bounded source-validated repair restores genuine automatic completion for small omissions');
})().catch(e=>{console.error(e);process.exitCode=1});
