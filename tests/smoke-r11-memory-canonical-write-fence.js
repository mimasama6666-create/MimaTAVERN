'use strict';
// Memory settlement must never bypass the verified canonical State write contract.
// Read failure or malformed records are not an empty/new library.
const assert=require('node:assert/strict');
const deep=x=>x===undefined?undefined:structuredClone(x);
const data=new Map();
function db(){return{close(){},transaction(){let pending=0,done=false,aborted=false;
 const work=new Map([...data].map(([k,v])=>[k,deep(v)]));
 const tx={oncomplete:null,onabort:null,error:null,abort(){if(aborted)return;aborted=true;setImmediate(()=>tx.onabort?.());}};
 const finish=()=>{if(done||pending||aborted)return;done=true;setImmediate(()=>{if(aborted)return;data.clear();for(const[k,v]of work)data.set(k,deep(v));tx.oncomplete?.();});};
 tx.objectStore=()=>({get(k){pending++;const r={onsuccess:null,onerror:null,result:null};setImmediate(()=>{r.result=deep(work.get(k));r.onsuccess?.();pending--;setImmediate(finish);});return r;},put(v,k){work.set(k,deep(v));pending++;setImmediate(()=>{pending--;setImmediate(finish);});return{};},delete(k){work.delete(k);pending++;setImmediate(()=>{pending--;setImmediate(finish);});return{};}});return tx;}};}
global.window=global;global.indexedDB={open(){const r={result:db()};setImmediate(()=>r.onsuccess?.());return r;}};
const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))};
global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};
require('../local-store.js');require('../standalone-core.js');
(async()=>{
 await MimaStandalone.init();
 const session=(await MimaStandalone.handle('/sessions','POST',{title:'Canonical fence regression'})).data;
 assert(session.id,'created session');
 const original=deep(data.get('state'));
 const corrupt=()=>{const broken=deep(original);delete broken.masks;data.set('state',broken);return deep(broken);};
 const begin=async kind=>MimaLocalStore.beginMemoryJob({sessionId:session.id,kind,options:{source:'context'},sourceHash:'test-hash',sourceCount:session.messages.length,sourceFingerprint:'test-fp',targetBaseline:'test-target',configSignature:'test-config'});
 const job=await begin('rolling');
 let before=corrupt();
 await assert.rejects(()=>MimaLocalStore.commitMemoryJob(job,session,{rollingSummary:'bad-overwrite',lastSummarizedIndex:0}),/E_MEMORY_STORE_UNVERIFIED/);
 assert.deepEqual(data.get('state'),before,'memory task must not overwrite malformed canonical state');
 console.log('PASS memory final commit refuses malformed canonical state');
 data.delete('memory_job:'+session.id+':rolling');
 before=corrupt();
 await assert.rejects(()=>MimaLocalStore.updateRollingMemory(session.id,'revoke'),/E_MEMORY_STORE_UNVERIFIED/);
 assert.deepEqual(data.get('state'),before,'rolling revoke must not rewrite malformed canonical state');
 console.log('PASS rolling revoke refuses malformed canonical state');
 const msg=[{id:'m1',role:'user',content:'艾琳把钥匙交给阿树。',versions:[]}];
 data.set('state',deep(original));
 assert((await MimaStandalone.handle('/sessions/'+session.id,'PATCH',{messages:msg})).success);
 const valid=deep(data.get('state'));
 const currentSession=valid.sessions.find(s=>s.id===session.id);
 const fp=MimaStandalone.memorySourceFingerprint(currentSession.messages,1);
 const coreBase=JSON.stringify(MimaMemoryContracts.normalizeManualMemory(currentSession.manualMemory||{}).core);
 data.set('memory_job:'+session.id+':core',{id:'core_review_job',status:'needs_review',kind:'core',sourceCount:1,sourceFingerprint:fp,targetBaseline:coreBase,options:{source:'context'},checkpoints:[{stage:'core_final_single_needs_review',candidate:'艾琳把钥匙交给阿树。',sourceStartIndex:0,sourceEndExclusive:1,sourceCoverageHash:fp}],revision:1});
 const broken=deep(valid);delete broken.worldbooks;data.set('state',broken);before=deep(broken);
 await assert.rejects(()=>MimaLocalStore.reviewMemoryCandidate(session.id,'core','core_review_job','accept','艾琳把钥匙交给阿树。'),/E_MEMORY_STORE_UNVERIFIED/);
 assert.deepEqual(data.get('state'),before,'human review must not write to malformed canonical state');
 assert.equal(data.get('memory_job:'+session.id+':core').status,'needs_review','journal remains unmodified on aborted transaction');
 console.log('PASS human review refuses malformed canonical state and preserves journal');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
