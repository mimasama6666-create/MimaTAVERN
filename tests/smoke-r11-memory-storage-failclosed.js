'use strict';
// Standalone transaction-completion and canonical-data integrity regressions.
// This is a deterministic IndexedDB transaction simulation, not a browser IDB conformance test.
const assert=require('node:assert/strict');
const backing=new Map();
let mode='normal';
function fakeDB(){return {close(){},transaction(){
  const tx={oncomplete:null,onabort:null,onerror:null,error:null,abort(){setImmediate(()=>tx.onabort?.())}};
  tx.objectStore=()=>({
    get(key){const request={result:undefined,error:null,onsuccess:null,onerror:null};
      setImmediate(()=>{request.result=backing.get(key);request.onsuccess?.();
        setImmediate(()=>{if(mode==='abort-read')tx.onabort?.();else tx.oncomplete?.();});});
      return request;},
    put(value,key){setImmediate(()=>{if(mode==='abort-write')tx.onabort?.();else {backing.set(key,value);tx.oncomplete?.();}});return {};},
    delete(){return {};}
  });return tx;
}};}
global.window=global;
global.indexedDB={open(){const req={result:fakeDB(),onsuccess:null,onerror:null};setImmediate(()=>req.onsuccess?.());return req;}};
require('../local-store.js');
(async()=>{
  // Uninitialized (verified nonexistent) data may still create the first blank state.
  mode='normal';backing.clear();
  const pristine=await MimaLocalStore.loadState();
  assert.deepEqual(pristine.sessions,[]);
  assert.deepEqual(pristine.worldbooks,[]);
  console.log('PASS genuinely nonexistent canonical store may initialize safely');
  // A request onsuccess is NOT transaction commit. A subsequent abort must fail closed.
  mode='abort-read';
  await assert.rejects(MimaLocalStore.loadState(),/E_CANONICAL_READ_ABORTED|E_CANONICAL_READ_FAILED/);
  await assert.rejects(MimaLocalStore.getMemoryJob('session','core'),/E_CANONICAL_READ_ABORTED|E_CANONICAL_READ_FAILED/);
  console.log('PASS aborted read cannot appear successful to library or memory journal');
  mode='normal';
  for(const malformed of [null,[],{schemaVersion:4,sessions:[]},false,{schemaVersion:4,storeRevision:'broken',sessions:[],masks:[],presets:[],worldbooks:[]},{schemaVersion:99,sessions:[],masks:[],presets:[],worldbooks:[]}]){
    backing.set('state',malformed);
    await assert.rejects(MimaLocalStore.loadState(),/E_CANONICAL_STATE_UNVERIFIED/);
  }
  console.log('PASS malformed existing state never becomes a blank or partial library');
  const valid={schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{}};
  backing.set('state',valid);
  assert.deepEqual((await MimaLocalStore.loadState()).sessions,[]);
  backing.set('state',{storeRevision:0,sessions:[]});
  await assert.rejects(MimaLocalStore.saveState(valid,0),/E_CANONICAL_STATE_UNVERIFIED/);
  backing.set('state',{...valid,storeRevision:'broken'});
  await assert.rejects(MimaLocalStore.saveState(valid,0),/E_CANONICAL_STATE_UNVERIFIED/);
  console.log('PASS compare-and-swap refuses overwrite of corrupted canonical data');
  backing.set('state',valid);
  mode='abort-write';
  await assert.rejects(MimaLocalStore.saveSettingsSnapshot({memory:'must-not-commit'}),/E_CANONICAL_WRITE_ABORTED/);
  assert.equal(backing.has('settings_snapshot_v1'),false);
  console.log('PASS aborted settings write settles as failure, not a hanging promise');
})().catch(e=>{console.error(e);process.exitCode=1;});
