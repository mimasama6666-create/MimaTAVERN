'use strict';
// The old two-all() implementation could straddle an atomic writer: first
// read new messages, then read old journals, incorrectly reporting corruption.
const assert=require('node:assert/strict');
global.window=global;
const sid='compat_ledger_atomic',tid='turn_atomic';let atomicTransactions=0,legacySeparateReads=0;
let snapshot={
  compat_sessions:[{id:sid,pendingTurnId:null,revision:2}],
  messages:[{id:'u_'+tid,sessionId:sid,turnId:tid,role:'user',canonicalContent:'你好',status:'committed',sequence:0},{id:'a_'+tid,sessionId:sid,turnId:tid,role:'assistant',canonicalContent:'你好！',status:'committed',sequence:1}],
  events_jobs:[{id:tid,sessionId:sid,attemptId:'attempt_atomic',settlement:'committed',sequence:0}]
};
function atomicDb(){return{close(){},transaction(names,mode){
  assert.equal(mode,'readonly');atomicTransactions++;
  const captured=structuredClone(snapshot),tx={oncomplete:null,onabort:null,error:null};let pending=0,done=false;
  const finish=()=>{if(!pending&&!done){done=true;setImmediate(()=>tx.oncomplete?.())}};
  tx.objectStore=name=>{assert(names.includes(name));return{get(id){pending++;const q={onsuccess:null,onerror:null,result:null};setImmediate(()=>{q.result=captured[name].find(x=>x.id===id);q.onsuccess?.();pending--;setImmediate(finish)});return q;},getAll(){pending++;const q={onsuccess:null,onerror:null,result:null};setImmediate(()=>{q.result=captured[name];q.onsuccess?.();pending--;setImmediate(finish)});return q;}}};
  return tx;
}}}
global.MimaCompatStore={
  open:async()=>atomicDb(),
  all:async()=>{legacySeparateReads++;throw new Error('old cross-transaction all() must not be used');},
  get:async()=>{throw new Error('journal snapshot must include session in same transaction');}
};
const runtime=require('../compat-runtime.js');
(async()=>{
  const messages=await runtime.sessionMessages(sid);
  assert.equal(messages.length,2);
  assert(messages.every(m=>m.status==='committed'));
  const jobs=await runtime.turnJournal(sid);
  assert.equal(jobs.length,1);assert.equal(jobs[0].settlement,'committed');
  assert.equal(atomicTransactions,2);assert.equal(legacySeparateReads,0);
  // A truly missing journal in the same snapshot still fails closed.
  snapshot={...snapshot,events_jobs:[]};
  await assert.rejects(()=>runtime.sessionMessages(sid),e=>e.code==='E_STORE_UNVERIFIED');
  snapshot={...snapshot,compat_sessions:[{id:sid,pendingTurnId:tid,revision:1}]};
  await assert.rejects(()=>runtime.turnJournal(sid),e=>e.code==='E_STORE_UNVERIFIED');
  console.log('PASS atomic IDB readonly ledger snapshots; no independent reads; real missing journal still fails closed');
})().catch(e=>{console.error(e);process.exitCode=1});
