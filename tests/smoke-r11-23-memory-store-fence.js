'use strict';
const assert=require('node:assert/strict');
const cp=v=>v===undefined?undefined:structuredClone(v),records=new Map();
const original={schemaVersion:4,storeRevision:7,sessions:[{id:'s1',messages:[],rollingArchive:[],rollingSummary:'可信摘要',lastSummarizedIndex:3}]};
records.set('state',cp(original));
function fakeDb(){return {close(){},transaction(){
 let active=0,completed=false,aborted=false;const staged=new Map([...records].map(([k,v])=>[k,cp(v)]));
 const tx={onabort:null,oncomplete:null,onerror:null,error:null,abort(){if(aborted)return;aborted=true;setImmediate(()=>tx.onabort?.())}};
 const done=()=>{if(active||completed||aborted)return;completed=true;setImmediate(()=>{if(aborted)return;records.clear();for(const [k,v] of staged)records.set(k,cp(v));tx.oncomplete?.()})};
 tx.objectStore=()=>({get(k){active++;const q={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{q.result=cp(staged.get(k));q.onsuccess?.();active--;setImmediate(done)});return q},put(v,k){staged.set(k,cp(v));setImmediate(done)},delete(k){staged.delete(k);setImmediate(done)}});
 return tx;
 }}};
global.window=global;global.indexedDB={open(){const q={result:fakeDb(),onsuccess:null};setImmediate(()=>q.onsuccess?.());return q}};
require('../local-store.js');
(async()=>{
 await assert.rejects(MimaLocalStore.loadState(),/E_CANONICAL|E_.*(STATE|STORE)|验证|损坏|结构/);
 await assert.rejects(MimaLocalStore.updateRollingMemory('s1','revoke'),/E_MEMORY_STORE_UNVERIFIED/);
 assert.deepEqual(records.get('state'),original,'memory writer must never overwrite incomplete canonical document');
 // A concurrent ordinary edit must obey the identical record guard.
 await assert.rejects(MimaLocalStore.commitState({schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[]},7),/E_CANONICAL|E_.*(STORE|STATE)/);
 assert.deepEqual(records.get('state'),original,'ordinary state writer must not erase damaged state');
 console.log('PASS memory partial writer fenced on damaged canonical state, with intact bytes');
})().catch(e=>{console.error(e);process.exitCode=1});
