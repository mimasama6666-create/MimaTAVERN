'use strict';
// R11.27: A partial new snapshot must never silently erase other user's
// CSS/font/theme, history, presets or novel projects. No browser/provider mock GO.
const assert=require('node:assert/strict');
const copy=x=>x===undefined?undefined:structuredClone(x);
const disk=new Map();
function openFakeDb(){
  return {close(){},transaction(){
    const staged=new Map([...disk].map(([k,v])=>[k,copy(v)]));let pending=0,aborted=false,finished=false;
    const tx={oncomplete:null,onabort:null,onerror:null,error:null,
      abort(){if(aborted)return;aborted=true;setImmediate(()=>tx.onabort?.());}};
    function complete(){if(finished||aborted||pending)return;finished=true;setImmediate(()=>{
      if(aborted)return;disk.clear();for(const[k,v]of staged)disk.set(k,copy(v));tx.oncomplete?.();});}
    tx.objectStore=()=>({
      get(key){pending++;const q={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{
        q.result=copy(staged.get(key));q.onsuccess?.();pending--;setImmediate(complete);});return q;},
      put(value,key){pending++;staged.set(key,copy(value));setImmediate(()=>{pending--;setImmediate(complete);});return {};},
      delete(key){pending++;staged.delete(key);setImmediate(()=>{pending--;setImmediate(complete);});return {};}
    });return tx;
  }};
}
global.window=global;global.indexedDB={open(){const r={result:openFakeDb(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r;}};
require('../local-store.js');
(async()=>{
  const full={schemaVersion:4,storeRevision:7,
    sessions:[{id:'s1',messages:[{id:'m1',role:'user',content:'历史不可丢'}]}],
    masks:[{id:'mask',content:'人物设定'}],presets:[{id:'p',content:'创作预设'}],worldbooks:[{id:'wb',entries:[{id:'entry',content:'世界书原文'}]}],
    cssPresets:[{id:'skin',css:'body { font-family: custom-font }'}],
    regexPacks:[{id:'regex',rules:[]}], novelProjects:[{id:'novel',chapters:[]}],themeSettings:{theme:'custom',customFont:'myfont'}};
  disk.set('state',copy(full));
  for(const removed of ['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects','themeSettings']){
    const partial=copy(full);delete partial[removed];
    await assert.rejects(()=>MimaLocalStore.saveState(partial,7),/E_CANONICAL_CANDIDATE_UNVERIFIED/,'saveState should reject missing '+removed);
    await assert.rejects(()=>MimaLocalStore.commitState(partial,7),/E_CANONICAL_CANDIDATE_UNVERIFIED/,'commitState should reject missing '+removed);
    assert.deepEqual(disk.get('state'),full,'original canonical bytes stay intact after missing '+removed);
  }
  const malformed=copy(full);malformed.cssPresets='';
  await assert.rejects(()=>MimaLocalStore.saveState(malformed,7),/E_CANONICAL_CANDIDATE_UNVERIFIED/);
  assert.deepEqual(disk.get('state'),full);
  // Existing optional collections must not be normalized to [] when malformed.
  for(const key of ['cssPresets','regexPacks','novelProjects','themeSettings']){
    const corrupt=copy(full);corrupt[key]='wrong-type';disk.set('state',copy(corrupt));
    await assert.rejects(()=>MimaLocalStore.loadState(),/E_CANONICAL_STATE_UNVERIFIED/);
    await assert.rejects(()=>MimaLocalStore.commitState(full,7),/E_CANONICAL_STATE_UNVERIFIED/);
    assert.deepEqual(disk.get('state'),corrupt,'corrupted optional field must remain untouched');
  }
  disk.set('state',copy(full));
  const actual=copy(full);actual.sessions[0].messages.push({id:'m2',role:'assistant',content:'正常更新'});
  const saved=await MimaLocalStore.saveState(actual,7);
  assert.equal(saved.storeRevision,8);
  assert.equal(saved.sessions[0].messages.length,2);
  assert.deepEqual(saved.cssPresets,full.cssPresets);
  assert.deepEqual(saved.themeSettings,full.themeSettings);
  assert.deepEqual(disk.get('state'),saved);
  const stale=copy(full);
  await assert.rejects(()=>MimaLocalStore.saveState(stale,7),/E_CANONICAL_CONFLICT/);
  assert.deepEqual(disk.get('state'),saved);
  // An explicit deliberate empty collection is valid; missing is never empty.
  const cleared=copy(saved);cleared.regexPacks=[];
  const committed=await MimaLocalStore.commitState(cleared,8);
  assert.deepEqual(committed.regexPacks,[]);
  assert.deepEqual(committed.cssPresets,full.cssPresets);
  console.log('PASS canonical writers reject partial snapshots with intact disk; full CAS and intentional empty collection retain behavior');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
