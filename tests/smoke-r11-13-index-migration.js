'use strict';
// Contract-level versioned IndexedDB simulator; assertions cover migration,
// session-scoped reads and same-transaction ledger consistency, not browser E2E.
const assert=require('node:assert/strict');
global.window=global;
const data=new Map(),indexes=new Map(),clone=x=>x===undefined?undefined:structuredClone(x);
const stats={scans:[],indexed:[],upgrades:[]};let databaseVersion=1;
const ensure=n=>{if(!data.has(n))data.set(n,new Map());if(!indexes.has(n))indexes.set(n,new Map());return data.get(n);};
const legacyStores=['source_capsules','assets','resource_ir','resource_projections','compat_sessions','messages','variables','grants','events_jobs','import_journal','sidecar_links'];
legacyStores.forEach(ensure);
const crypto=require('node:crypto');
const sourceBytes=new TextEncoder().encode('{"name":"persistent character"}');
const sha=crypto.createHash('sha256').update(sourceBytes).digest('hex'),sourceId='sha256:'+sha;
const capsule={id:sourceId,sha256:sha,bytes:sourceBytes,filename:'legacy.json',format:'json',revision:1};
const legacyResource={id:sourceId+'#0',sourceId,kind:'character',name:'persistent character',path:'json.data',raw:{name:'persistent character'},revision:1};
data.get('source_capsules').set(sourceId,clone(capsule));
data.get('resource_ir').set(legacyResource.id,clone(legacyResource));
const msg=(sessionId,i,role)=>({id:`${role==='user'?'u':'a'}_${sessionId}_${i}`,sessionId,turnId:`turn_${sessionId}_${i}`,role,sequence:i*2+(role==='assistant'?1:0),status:'committed',canonicalContent:`${sessionId}:${i}:${role}`,revision:1});
for(const sid of ['S1','S2']){
 data.get('compat_sessions').set(sid,{id:sid,pendingTurnId:null,revision:1});
 for(let i=0;i<800;i++){
  for(const role of ['user','assistant']){const m=msg(sid,i,role);data.get('messages').set(m.id,m);}
  const job={id:`turn_${sid}_${i}`,sessionId:sid,msgId:`u_${sid}_${i}`,sequence:i*2,settlement:'committed',status:'committed',revision:1};
  data.get('events_jobs').set(job.id,job);
 }
}
const priorMessages=structuredClone([...data.get('messages')]),priorJobs=structuredClone([...data.get('events_jobs')]);
function buildDB(){return {
 get version(){return databaseVersion;},close(){},objectStoreNames:{contains:n=>data.has(n)},
 createObjectStore(n){ensure(n);return object(n,null,true);},
 transaction(names,mode='readonly'){const tableNames=Array.isArray(names)?names:[names];const writable=mode==='readwrite';const staged=new Map(tableNames.map(n=>[n,writable?new Map([...ensure(n)].map(([id,x])=>[id,clone(x)])):ensure(n)]));let pending=0,finished=false,aborted=false;
  const tx={db:db,mode,objectStore:n=>object(n,tx,false,staged.get(n)),oncomplete:null,onabort:null,error:null,
   abort(){if(aborted||finished)return;aborted=true;setImmediate(()=>tx.onabort?.());}};
  function enqueue(fn){pending++;const r={result:undefined,error:null,onsuccess:null,onerror:null,transaction:tx};setImmediate(()=>{
   if(aborted)return;try{r.result=clone(fn());r.onsuccess?.({target:r});}catch(e){r.error=e;tx.error=e;r.onerror?.({target:r});tx.abort();}
   pending--;setImmediate(()=>{if(!pending&&!finished&&!aborted){finished=true;if(writable)for(const [n,map]of staged)data.set(n,map);tx.oncomplete?.();}});
  });return r;}
  tx.submit=enqueue;return tx;
 }
};}
let db;
function object(n,tx,upgrading=false,map=null){const table=map||ensure(n),idx=indexes.get(n);return {
 indexNames:{contains:k=>idx.has(k)},
 createIndex(key,path){if(!upgrading)throw Error('upgrade only');idx.set(key,path);return this.index(key);},
 index(key){if(!idx.has(key))throw Error('Index missing: '+n+'/'+key);const path=idx.get(key);return {getAll(value){stats.indexed.push({n,key,value});return tx.submit(()=>[...table.values()].filter(x=>x?.[path]===value));}};},
 get(id){return tx.submit(()=>table.get(id));},
 getAll(){stats.scans.push(n);return tx.submit(()=>[...table.values()]);},
 getAllKeys(){return tx.submit(()=>[...table.keys()]);},
 add(v){return tx.submit(()=>{if(table.has(v.id))throw Error('duplicate');table.set(v.id,clone(v));return v.id;});},
 put(v){return tx.submit(()=>{table.set(v.id,clone(v));return v.id;})}
};}
db=buildDB();
global.indexedDB={open(name,version){const r={result:db,transaction:null,oldVersion:databaseVersion,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null,error:null};setImmediate(()=>{
 if(version<databaseVersion){r.error=Error('VersionError');r.onerror?.();return;}
 if(version>databaseVersion){r.transaction={objectStore:n=>object(n,null,true)}; // only createIndex executes synchronously in onupgradeneeded
  try{r.onupgradeneeded?.();databaseVersion=version;stats.upgrades.push(version);}catch(e){r.error=e;r.onerror?.();return;}}
 setImmediate(()=>r.onsuccess?.());});return r;}};
const store=require('../compat-store.js');global.MimaCompatStore=store;
const runtime=require('../compat-runtime.js');
(async()=>{
 const opened=await store.open();assert.equal(opened.version,2);opened.close();
 assert.deepEqual(stats.upgrades,[2]);
 assert.equal(indexes.get('messages').get('sessionId'),'sessionId');
 assert.equal(indexes.get('events_jobs').get('sessionId'),'sessionId');
 assert.equal(indexes.get('resource_ir').get('sourceId'),'sourceId');
 assert.deepEqual([...data.get('messages')],priorMessages,'schema migration must not mutate canonical messages');
 assert.deepEqual([...data.get('events_jobs')],priorJobs,'schema migration must not mutate journals');
 stats.scans.length=0;stats.indexed.length=0;
 const s1=await runtime.sessionMessages('S1'),s2=await runtime.sessionMessages('S2'),ledger=await runtime.turnJournal('S1');
 assert.equal(s1.length,1600);assert.equal(s2.length,1600);assert.equal(ledger.length,800);
 assert(s1.every(m=>m.sessionId==='S1')&&s2.every(m=>m.sessionId==='S2'));
 assert.deepEqual(stats.scans,[],'hot path must not do cross-session getAll');
 const resources=await store.byIndex('resource_ir','sourceId',sourceId);assert.equal(resources.length,1);
 assert.deepEqual(resources[0],legacyResource);
 assert.equal((await store.importSource(capsule,[{kind:'character',name:legacyResource.name,path:'json.data',raw:legacyResource.raw}])).reused,true);
 assert.deepEqual([...data.get('source_capsules').values()][0].bytes,sourceBytes);
 assert.deepEqual(stats.scans,[],'idempotent import must not scan unrelated resources');

 assert(stats.indexed.filter(x=>x.n==='messages').length>=2);
 assert(stats.indexed.filter(x=>x.n==='events_jobs').length>=3);
 const b=await store.byIndex('resource_ir','sourceId','missing');assert.deepEqual(b,[]);
 const sid='S1',unfinished={...data.get('events_jobs').get(`turn_${sid}_3`),settlement:'failed'};data.get('events_jobs').set(unfinished.id,unfinished);
 const projected=await runtime.sessionMessages(sid);assert.equal(projected.find(x=>x.id==='a_S1_3').status,'failed');
 data.get('events_jobs').delete('turn_S1_5');
 await assert.rejects(()=>runtime.sessionMessages(sid),e=>e.code==='E_STORE_UNVERIFIED','orphaned turn must fail closed');
 // A broken production v2 index must never masquerade as an empty session.
 indexes.get('messages').delete('sessionId');
 await assert.rejects(()=>runtime.sessionMessages('S1'),e=>e.code==='E_STORE_UNVERIFIED');
 indexes.get('messages').set('sessionId','sessionId');
 indexes.get('resource_ir').delete('sourceId');
 await assert.rejects(()=>store.byIndex('resource_ir','sourceId',sourceId),e=>e.code==='E_STORE_UNVERIFIED');
 indexes.get('resource_ir').set('sourceId','sourceId');
 const snap=await store.snapshot();assert.equal(snap.dbVersion,2);assert.equal(snap.records.messages.length,3200);

 const legacy={...snap,dbVersion:1};const packed=await store.packBackup(legacy),unpacked=await store.unpackBackup(packed);
 assert.equal(unpacked.dbVersion,1);assert.equal(unpacked.integrityVerified,true);
 console.log('PASS indexed migration: v1 -> v2 add-only, 3200 messages + 1600 journals retained, session-scoped consistent reads, orphan/failure quarantined, full snapshot complete, signed v1 backup import accepted');
 console.log('SCANS_IN_NORMAL_READ=0; INDEXED_READS='+stats.indexed.length+'; explicit backup full getAll expected');
})().catch(e=>{console.error(e);process.exitCode=1;});
