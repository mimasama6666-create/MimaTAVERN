'use strict';
// Verify the actual session PATCH -> IndexedDB completion -> reload ->
// prompt projection path, not just a UI handler mock.
const assert=require('node:assert/strict');
const cp=v=>v===undefined?undefined:structuredClone(v),dbRecords=new Map();
function fakeDb(){return {close(){},transaction(){
 let active=0,completed=false,aborted=false;const staged=new Map([...dbRecords].map(([k,v])=>[k,cp(v)]));
 const tx={oncomplete:null,onabort:null,onerror:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};
 const done=()=>{if(active||completed||aborted)return;completed=true;setImmediate(()=>{dbRecords.clear();for(const [k,v] of staged)dbRecords.set(k,cp(v));tx.oncomplete?.()})};
 tx.objectStore=()=>({get(k){active++;const req={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{req.result=cp(staged.get(k));req.onsuccess?.();active--;setImmediate(done)});return req},put(v,k){staged.set(k,cp(v))},delete(k){staged.delete(k)}});
 return tx;
 }}};
global.window=global;global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};
const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)};
global.indexedDB={open(){const req={result:fakeDb(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req}};
require('../local-store.js');require('../standalone-core.js');
(async()=>{
 await MimaStandalone.init();
 const created=await MimaStandalone.handle('/sessions','POST',{title:'持续上下文的剧情'});
 assert(created.success,created.msg);const id=created.data.id;
 assert.equal(created.data.promptSettings.recentMessageLimit,34);
 const change=await MimaStandalone.handle(`/sessions/${id}`,'PATCH',{promptSettings:{...created.data.promptSettings,recentMessageLimit:100}});
 assert(change.success,change.msg);assert.equal(change.data.promptSettings.recentMessageLimit,100);
 await MimaStandalone.init();
 const reloaded=await MimaStandalone.handle(`/sessions/${id}`,'GET');
 assert(reloaded.success,reloaded.msg);assert.equal(reloaded.data.promptSettings.recentMessageLimit,100);
 const preview=await MimaStandalone.handle(`/sessions/${id}/prompt-preview`,'POST',{draft:'继续剧情'});
 assert(preview.success,preview.msg);
 assert.equal((await MimaStandalone.handle(`/sessions/${id}`,'GET')).data.promptSettings.recentMessageLimit,100);
 assert.equal(dbRecords.get('state').sessions[0].promptSettings.recentMessageLimit,100);
 console.log('PASS actual 34 -> PATCH 100 -> committed state -> init reload 100 -> prompt preview still 100');
})().catch(e=>{console.error(e);process.exitCode=1});
