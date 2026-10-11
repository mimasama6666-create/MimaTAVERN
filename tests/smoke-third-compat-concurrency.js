'use strict';
/* Transaction-callback mock. Not IndexedDB/browser equivalence. */
const assert=require('node:assert/strict');global.window=global;
const records={compat_sessions:new Map(),messages:new Map(),events_jobs:new Map(),resource_ir:new Map(),source_capsules:new Map()};let seq=0;
const copy=v=>v==null?v:structuredClone(v);
global.MimaCompatStore={uid:p=>`${p}-${++seq}`,get:async(t,id)=>copy(records[t].get(id)),all:async t=>[...records[t].values()].map(copy),open:async()=>({close(){},transaction(){let pending=0,finished=false,aborted=false;const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}},complete=()=>{if(!pending&&!finished&&!aborted){finished=true;setImmediate(()=>tx.oncomplete?.());}};tx.objectStore=type=>({get(id){pending++;const req={result:null,transaction:tx};setImmediate(()=>{if(!aborted){req.result=copy(records[type].get(id));req.onsuccess?.();}pending--;setImmediate(complete);});return req;},getAll(){pending++;const req={result:null,transaction:tx};setImmediate(()=>{req.result=[...records[type].values()].map(copy);req.onsuccess?.();pending--;setImmediate(complete);});return req;},put(x){records[type].set(x.id,copy(x))},add(x){if(records[type].has(x.id))throw Error('duplicate');records[type].set(x.id,copy(x));}});return tx;}})};
global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');const rt=require('../compat-runtime.js');
const sid='test-session';records.compat_sessions.set(sid,{id:sid,sourceId:'card',characterResourceId:'char',revision:1,turnIndex:0,pendingTurnId:null,userName:'Player'});records.resource_ir.set('char',{id:'char',sourceId:'card',kind:'character',path:'json.data',raw:{name:'Char'}});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};let current=gate(),events=[];
global.MimaCompatPlugins={publish:async(_s,event,payload)=>events.push({event,...payload})};global.MimaStandalone={getApiConfig:()=>({model:'fake'}),callModelWithConfig:async()=>current.promise};
const tick=()=>new Promise(r=>setTimeout(r,1));
(async()=>{
 const pending=rt.send(sid,'message in flight');for(let i=0;i<80&&!(await rt.getSession(sid)).pendingTurnId;i++)await tick();
 assert((await rt.getSession(sid)).pendingTurnId,'speech turn started');
 const s=records.compat_sessions.get(sid);records.compat_sessions.set(sid,{...s,revision:s.revision+1,styleResourceId:'decorative-css'});
 current.resolve('reply survives CSS edit');const done=await pending;assert.equal(done.reply,'reply survives CSS edit');
 assert.equal((await rt.sessionMessages(sid)).find(x=>x.role==='assistant').canonicalContent,'reply survives CSS edit');
 assert.equal((await rt.getSession(sid)).pendingTurnId,null);
 assert.equal(events.filter(e=>e.event==='turn.committed').length,1);
 current=gate();const discarded=rt.send(sid,'cancel me').catch(e=>e);for(let i=0;i<80&&!(await rt.getSession(sid)).pendingTurnId;i++)await tick();
 const job=(await rt.turnJournal(sid)).at(-1);await rt.recoverTurn(sid,job.id,'abort',job.attemptId);current.resolve('late reply');
 await discarded;assert.equal(events.filter(e=>e.event==='turn.failed').length,0,'aborted attempt does not broadcast failure');
 assert.equal((await rt.turnJournal(sid)).at(-1).settlement,'aborted');
 const regex=[{findRegex:'/cat/g',replaceString:'dog',placement:[1,2]}];
 for(const count of [100,500,1000]){const list=Array.from({length:count},(_,i)=>({input:'cat '+i,phase:2}));const t=performance.now();const out=await global.MimaCompatRegexIsolation.applyBatch(list,regex,{budgetMs:4500});assert.equal(out.length,count);assert.equal(out.at(-1).result.output,'dog '+(count-1));console.log(`regex ${count} items batch elapsed ${Math.round(performance.now()-t)}ms`);}
 await assert.rejects(()=>global.MimaCompatRegexIsolation.applyBatch([{input:'a'.repeat(28),phase:2}],[{findRegex:'a*a*a*a*a*a*a*a*a*a*b',replaceString:'z',placement:[2]}],{budgetMs:125}),e=>e.code==='E_REGEX_BUDGET');
 console.log('PASS third compat: CSS concurrent settlement, aborted late event not failed, 100/500/1000 regex batching, pathological kill');
})().catch(e=>{console.error(e);process.exitCode=1});
