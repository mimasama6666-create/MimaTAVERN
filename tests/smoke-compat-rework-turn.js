'use strict';
/* Stateful fake IDB with queued request notifications; NOT a browser-IDB conformance test. */
const assert=require('node:assert/strict');global.window=global;
const records={compat_sessions:new Map(),messages:new Map(),events_jobs:new Map(),resource_ir:new Map(),source_capsules:new Map()};
const copy=o=>o==null?o:structuredClone(o);let unique=0;
const store={uid:p=>p+'-'+(++unique),get:async(n,id)=>copy(records[n].get(id)||null),all:async n=>[...records[n].values()].map(copy),open:async()=>({close(){},transaction(names){
  let pending=0,ended=false,aborted=false;const tx={error:null,oncomplete:null,onabort:null};const complete=()=>{if(!pending&&!ended){ended=true;setImmediate(()=>{if(aborted)tx.onabort?.();else tx.oncomplete?.();});}};
  tx.objectStore=n=>({get(id){pending++;const req={result:null,error:null,transaction:tx};setImmediate(()=>{if(!aborted){req.result=copy(records[n].get(id));req.onsuccess?.();}pending--;setImmediate(complete);});return req;},getAll(){pending++;const req={result:null,transaction:tx};setImmediate(()=>{if(!aborted){req.result=[...records[n].values()].map(copy);req.onsuccess?.();}pending--;setImmediate(complete);});return req;},add(val){if(records[n].has(val.id))throw new Error('duplicate id');records[n].set(val.id,copy(val));},put(val){records[n].set(val.id,copy(val));}});
  tx.abort=()=>{aborted=true;ended=true;setImmediate(()=>tx.onabort?.());};return tx;
}})};
global.MimaCompatStore=store;
const rt=require('../compat-runtime.js');const iso=require('../compat-regex-isolation.js');global.MimaCompatRegexIsolation=iso;
const session='session1',source='source1',char='char1';records.compat_sessions.set(session,{id:session,sourceId:source,characterResourceId:char,revision:1,turnIndex:0,pendingTurnId:null,userName:'Tester'});records.resource_ir.set(char,{id:char,sourceId:source,kind:'character',path:'json.data',raw:{name:'A',description:'description'}});
let calls=[],count=0;
require('../standalone-core.js');const productionReplyGuard=global.MimaStandalone.validateStoryReply;
global.MimaStandalone={validateStoryReply:productionReplyGuard,getApiConfig:()=>({mock:true}),callModelWithConfig:async payload=>{calls.push(copy(payload));if(++count===1)throw Object.assign(new Error('provider down'),{code:'E_PROVIDER_FAIL'});return 'reply-'+count;}};
(async()=>{
  await assert.rejects(()=>rt.send(session,'first'),/provider down/);
  let m=await rt.sessionMessages(session);assert.equal(m.length,1);assert.equal(m[0].status,'failed');
  const failed=(await rt.turnJournal(session))[0];assert.equal(failed.settlement,'failed');
  const next=await rt.send(session,'second');assert.equal(next.reply,'reply-2');
  assert(!calls[1].some(x=>x.content==='first'),'failed first message cannot enter second payload');
  const state=await rt.getSession(session);assert.equal(state.pendingTurnId,null);
  // Old shipping package saved failed users as committed. Projection must quarantine it without deleting bytes.
  const legacy=records.messages.get(failed.msgId);records.messages.set(failed.msgId,{...legacy,status:'committed'});
  const quarantined=(await rt.sessionMessages(session)).find(x=>x.id===failed.msgId);
  assert.equal(quarantined.status,'failed');assert.equal(quarantined.storedStatus,'committed');
  records.messages.set(failed.msgId,legacy);

  const t=await rt.beginTurn(session,'third');let pending=await rt.getSession(session);assert.equal(pending.pendingTurnId,t.turnId);
  await assert.rejects(()=>rt.beginTurn(session,'duplicated'),e=>e.code==='E_CANONICAL_CONFLICT');
  // Explicit reload simulation: new runtime works from durable journal, not a JS variable.
  let job=await rt.turnJournal(session);assert.equal(job.at(-1).settlement,'pending');
  await rt.recoverTurn(session,t.turnId,'retry');let updated=(await rt.turnJournal(session)).at(-1);assert.equal(updated.id,t.turnId);assert.notEqual(updated.attemptId,t.attemptId);
  await rt.finishTurn(session,t,'STALE ANSWER');assert.equal((await rt.sessionMessages(session)).some(m=>m.canonicalContent==='STALE ANSWER'),false);
  const retried={...t,attemptId:updated.attemptId,sessionRevision:(await rt.getSession(session)).revision};
  await rt.finishTurn(session,retried,'fresh');assert.equal((await rt.sessionMessages(session)).find(m=>m.turnId===t.turnId&&m.role==='assistant').canonicalContent,'fresh');
  const t2=await rt.beginTurn(session,'cancel me');await rt.recoverTurn(session,t2.turnId,'abort');
  assert.equal((await rt.sessionMessages(session)).find(m=>m.turnId===t2.turnId).status,'aborted');
  await rt.finishTurn(session,t2,'STALE AGAIN');assert.equal((await rt.sessionMessages(session)).some(m=>m.canonicalContent==='STALE AGAIN'),false);
  const results=await Promise.allSettled([rt.beginTurn(session,'racing 1'),rt.beginTurn(session,'racing 2')]);assert.equal(results.filter(v=>v.status==='fulfilled').length,1,'only one active turn');
  const last=(await rt.turnJournal(session)).at(-1);await rt.recoverTurn(session,last.id,'abort');
  const result=await iso.apply('cat cat',[{findRegex:'/cat/g',replaceString:'dog',placement:[2]}],2);assert.equal(result.output,'dog dog');
  await assert.rejects(()=>iso.apply('a'.repeat(28),[{findRegex:'a*a*a*a*a*a*a*a*a*a*b',replaceString:'z',placement:[2]}],2,{budgetMs:125}),e=>e.code==='E_REGEX_BUDGET');
  console.log('PASS P0 lifecycle mock: failure projection, stable retry, stale fencing, abort, competing begins, killable regex');
})().catch(e=>{console.error(e);process.exitCode=1});
