'use strict';
// Production memory routes, synthetic IndexedDB, no paid LLM calls.
// Verify verbatim repeated neutral events succeed without hiding independent
// source differences, explicit action counts or serious omitted events.
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const cases=[
  {name:'identical neutral original quotation',events:['玩家把相同的地图放进安全柜，并将柜门锁好。'],reply:'玩家把相同的地图放进安全柜，并将柜门锁好。',success:true,calls:1},
  {name:'independent victims omitted',events:['艾琳杀死了甲方。','艾琳杀死了乙方。'],reply:'艾琳杀死了甲方。',success:false,calls:1},
  {name:'repeated consequential action needs count',events:['艾琳杀死了甲方。'],reply:'艾琳杀死了甲方。',success:false,calls:1},
  {name:'explicit counted consequential action',events:['艾琳杀死了甲方。'],reply:'艾琳杀死了甲方共二十四次。',success:true,calls:1},
  {name:'single missing neutral event repaired',events:['玩家把一把金钥匙交给塔主，并要求保守秘密。'],other:'第二日塔主把那把钥匙藏入书房左侧的抽屉。',reply:'玩家把一把金钥匙交给塔主，并要求保守秘密。',success:true,calls:2}
];
if(process.env.R11_10_CASE===undefined){
 for(let i=0;i<cases.length;i++){
   const p=spawnSync(process.execPath,[__filename],{encoding:'utf8',timeout:25000,env:{...process.env,R11_10_CASE:String(i)}});
   assert.equal(p.status,0,cases[i].name+'\n'+p.stdout+'\n'+p.stderr);
   console.log('PASS R11.10',cases[i].name);
 }
}else{
 const c=cases[Number(process.env.R11_10_CASE)];
 const records=new Map(),clone=x=>x===undefined?undefined:structuredClone(x);
 function db(){return{close(){},transaction(){let pending=0,closed=false,aborted=false;const staged=new Map([...records].map(([k,v])=>[k,clone(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.());}};
  function finish(){if(closed||aborted||pending)return;closed=true;setImmediate(()=>{if(aborted)return;records.clear();for(const [k,v]of staged)records.set(k,clone(v));tx.oncomplete?.();});}
  tx.objectStore=()=>({get(id){pending++;const req={onsuccess:null,result:undefined};setImmediate(()=>{req.result=clone(staged.get(id));req.onsuccess?.();pending--;setImmediate(finish);});return req;},put(v,id){staged.set(id,clone(v));return{};},delete(id){staged.delete(id);return{};}});return tx;}}}
 global.window=global;global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r;}};
 global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:k=>pref.get(k)||null,setItem:(k,v)=>pref.set(k,String(v))};
 require(path.join(__dirname,'../local-store.js'));require(path.join(__dirname,'../standalone-core.js'));
 let calls=0;global.fetch=async(_url,opts)=>{calls++;const prompt=JSON.parse(opts.body).messages.at(-1).content;
   const content=c.other&&prompt.includes('【必须补录的旧剧情原文】')?c.other:c.reply;
   return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})};};
 (async()=>{await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4132/v1',model:'fake',stream:false,contextWindowTokens:32768});
  const session=(await MimaStandalone.handle('/sessions','POST',{title:'R11.10 source ledger'})).data;
  const messages=Array.from({length:42},(_,i)=>{const text=i<24?(c.other&&i===5?c.other:c.events[i%c.events.length]):'随后继续了正常生活。';return{id:'e'+i,role:i%2?'assistant':'user',content:text,rawContent:text,versions:[]};});
  assert((await MimaStandalone.handle('/sessions/'+session.id,'PATCH',{messages,promptSettings:{recentMessageLimit:12}})).success);
  const result=await MimaStandalone.runRecordedMemory('rolling',session.id,{}).then(()=>true).catch(e=>{assert.equal(e.code,'E_MEMORY_NEEDS_REVIEW');return false;});
  const saved=(await MimaStandalone.handle('/sessions/'+session.id,'GET')).data;
  assert.equal(result,c.success);assert.equal(calls,c.calls);assert.equal(saved.lastSummarizedIndex,c.success?24:0);assert.equal(saved.messages.length,42);
  if(c.other&&result)assert(saved.rollingSummary.includes(c.other));
 })().catch(e=>{console.error(e);process.exitCode=1});
}
