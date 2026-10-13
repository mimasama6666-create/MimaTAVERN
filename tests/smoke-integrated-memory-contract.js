'use strict';
// Integrated CURRENT-contract test. Offline Provider and transactional fake
// IndexedDB: does not claim real Provider or browser conformance.
const assert=require('node:assert/strict');
const deep=x=>x===undefined?undefined:structuredClone(x),data=new Map();
function db(){return {close(){},transaction(){let pending=0,done=false,aborted=false;const staged=new Map([...data].map(([k,v])=>[k,deep(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){if(done||aborted)return;aborted=true;setImmediate(()=>tx.onabort?.());}};function finish(){if(done||aborted||pending)return;done=true;setImmediate(()=>{if(aborted)return;data.clear();for(const [k,v]of staged)data.set(k,deep(v));tx.oncomplete?.();});}tx.objectStore=()=>({get(key){pending++;const req={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{req.result=deep(staged.get(key));req.onsuccess?.();pending--;setImmediate(finish);});return req;},put(value,key){staged.set(key,deep(value));return {};},delete(key){staged.delete(key);return {};}});return tx;}};}
global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req;}};
global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))};
require('../local-store.js');require('../standalone-core.js');
const text=i=>`第${i}条剧情：旅人在第${i}号房间找到独有的线索${i}。`;
const pair=Array.from({length:4},(_,i)=>({id:'pair-'+i,role:i%2?'assistant':'user',content:text(i),rawContent:text(i),versions:[]}));
let replies=0,modelMode='facts',captured=[];
const makeReply=(msg)=>JSON.stringify({memory:msg.map(m=>m.content).join('\n'),evidence:msg.map(m=>({quote:m.content}))});
global.fetch=async(_url,opts)=>{
  const payload=JSON.parse(opts.body);replies++;captured.push(payload);
  assert(payload.messages[0].content.includes('【记忆输出契约】'));
  assert(payload.messages[0].content.includes('evidence'));
  let outcome;
  if(modelMode==='facts')outcome=makeReply(pair);
  else if(modelMode==='core')outcome=makeReply([pair[1]]);
  else if(modelMode==='rolling')outcome=makeReply(rollingMessages.slice(0,22));
  else if(modelMode==='invalid')outcome=JSON.stringify({memory:'旅人偷走了不曾出现的钥匙。',evidence:[{quote:pair[0].content}]});
  else throw Error('invalid fake stage');
  const response={choices:[{message:{content:outcome},finish_reason:'stop'}]};
  return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>response,text:async()=>JSON.stringify(response)};
};
let rollingMessages=[];
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:29991/v1',model:'fixture',stream:false,contextWindowTokens:32768});
 const route=(path,method,body)=>MimaStandalone.handle(path,method,body);
 const s=(await route('/sessions','POST',{title:'current contract'})).data;
 assert((await route(`/sessions/${s.id}`,'PATCH',{messages:pair})).success);
 const facts=await route(`/sessions/${s.id}/memory/facts`,'POST',{scope:'all',chunkRounds:2,replaceExisting:true});
 assert(facts.success,JSON.stringify(facts));
 assert(facts.data.manualMemory.facts.length===1);
 modelMode='core';
 const core=await route(`/sessions/${s.id}/memory/core`,'POST',{source:'context'});
 assert(core.success,JSON.stringify(core));
 assert(core.data.manualMemory.core.content.includes(pair[1].content));
 modelMode='invalid';
 const invalid=await route(`/sessions/${s.id}/memory/core`,'POST',{source:'context'});
 assert.equal(invalid.success,false);assert.equal(invalid.code,'E_MEMORY_NEEDS_REVIEW');
 const check=(await route(`/sessions/${s.id}`,'GET')).data;
 assert(check.manualMemory.core.content.includes(pair[1].content));assert.equal(check.messages.length,4);
 const rolling=(await route('/sessions','POST',{title:'rolling contract'})).data;
 rollingMessages=Array.from({length:40},(_,i)=>({id:'rolling-'+i,role:i%2?'assistant':'user',content:text(i),rawContent:text(i),versions:[]}));
 assert((await route(`/sessions/${rolling.id}`,'PATCH',{messages:rollingMessages,promptSettings:{recentMessageLimit:22}})).success);
 modelMode='rolling';const rolled=await MimaStandalone.runRecordedMemory('rolling',rolling.id,{});
 assert.equal(rolled.lastSummarizedIndex,22);assert.equal(rolled.messages.length,40);
 assert((await MimaLocalStore.getMemoryJob(rolling.id,'rolling')).status==='committed');
 assert.equal((await MimaLocalStore.getMemoryJob(s.id,'core')).status,'needs_review');
 assert(replies>=4);
 console.log('PASS memory end-to-end: extractive facts/core/rolling, invalid core quarantined, source History preserved, aligned outgoing Provider contract, correct settlement');
})().catch(e=>{console.error(e);process.exitCode=1;});
