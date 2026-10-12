'use strict';
// R11 TEST HARNESS: Synthetic PNG -> sealed IndexedDB-like transactions ->
// opening -> one mocked model turn -> source recovery. NOT a real browser E2E.
// In-memory IDB simulator does not prove abort rollback semantics of real IDB.
const assert=require('node:assert/strict');
const saved=new Map();
const ensure=n=>{if(!saved.has(n))saved.set(n,new Map());return saved.get(n);};
const clone=v=>v===undefined?v:structuredClone(v);
const db={close(){},objectStoreNames:{contains:n=>saved.has(n)},createObjectStore(n){ensure(n)},transaction(names,mode){
 let pending=0,done=false,aborted=false;
 const tx={oncomplete:null,onabort:null,error:null,abort(){if(aborted||done)return;aborted=true;setImmediate(()=>tx.onabort?.())}};
 const finish=()=>{if(!done&&!aborted&&pending===0){done=true;setImmediate(()=>tx.oncomplete?.())}};
 const submit=(fn)=>{pending++;const q={onsuccess:null,onerror:null,result:undefined,error:null,transaction:tx};setImmediate(()=>{
   if(aborted)return;try{q.result=clone(fn());q.onsuccess?.({target:q});}catch(e){q.error=e;q.onerror?.({target:q});tx.error=e;tx.abort();}
   pending--;setImmediate(finish);
 });return q;};
 tx.objectStore=name=>{const map=ensure(name);return {
  get:id=>submit(()=>map.get(id)),
  getAll:()=>submit(()=>[...map.values()]),
  getAllKeys:()=>submit(()=>[...map.keys()]),
  add:v=>submit(()=>{if(map.has(v.id))throw new Error('Duplicate key '+v.id);map.set(v.id,clone(v));return v.id}),
  put:v=>submit(()=>{map.set(v.id,clone(v));return v.id}),
  delete:id=>submit(()=>map.delete(id))
 }};
 return tx;
}};
global.indexedDB={open(){const q={onsuccess:null,onerror:null,onupgradeneeded:null,result:db,oldVersion:0};setImmediate(()=>{q.onupgradeneeded?.();setImmediate(()=>q.onsuccess?.());});return q}};
// Load the real production reply validator; only the paid Provider transport is mocked.
global.window=global;require('../standalone-core.js');
const validateStoryReply=global.MimaStandalone.validateStoryReply;
global.MimaStandalone={validateStoryReply,getApiConfig:()=>({contextWindowTokens:1000000,maxTokens:2048}),callModelWithConfig:async messages=>{
 assert(messages.some(m=>m.content.includes('R11 Card V3')),'character description reached model');
 assert(messages.some(m=>m.content.includes('红色钥匙')),'user input reached model');
 return '已读到红色钥匙。';
}};
const png=require('../png-card-import.js');global.MimaPngCardImport=png;
const importer=require('../compat-import.js'),store=require('../compat-store.js'),runtime=require('../compat-runtime.js');global.MimaCompatStore=store;
// Embed only tiny synthetic PNG bytes so the smoke runs from a Windows checkout
// without Python, external files, network, or any user's real card.
const dualPng=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000001467445587463686172610065794a7a6347566a496a6f67496d4e6f59584a6858324e68636d5266646a49694c4341696333426c593139325a584a7a61573975496a6f67496a49754d43497349434a6b59585268496a6f6765794a755957316c496a6f67496c49784d53424459584a6b4946597949697767496d526c63324e796158423061573975496a6f67496c597949474e6f59584a685933526c6369497349434a6d61584a7a644639745a584d694f6941695347567362473867566a49694c43416959326868636d466a6447567958324a76623273694f694237496d3568625755694f694169596d3976617931324d69497349434a6c626e52796157567a496a6f6757337369615751694f6941784c4341695932397563335268626e51694f694230636e566c4c43416959323975644756756443493649434a574d69426962323972496e31646658313903ba118c0000021974455874636376330065794a7a6347566a496a6f67496d4e6f59584a6858324e68636d5266646a4d694c4341696333426c593139325a584a7a61573975496a6f67496a4d754d43497349434a6b59585268496a6f6765794a755957316c496a6f67496c49784d53424459584a6b4946597a49697767496d526c63324e796158423061573975496a6f67496c597a49474e6f59584a685933526c6369497349434a6d61584a7a644639745a584d694f6941695347567362473867566a4d694c434169595778305a584a755958526c583264795a5756306157356e63794936494673695433526f5a584967566a4d6958537767496d4e6f59584a685933526c636c396962323972496a6f6765794a755957316c496a6f67496d4a7662327374646a4d694c4341695a573530636d6c6c6379493649467437496d6c6b496a6f674d697767496d4e76626e4e3059573530496a6f6764484a315a537767496d4e76626e526c626e51694f694169566a4d67596d397661794a395858307349434a6c6548526c626e4e706232357a496a6f6765794a795a57646c6546397a59334a706348527a496a6f675733736963324e7961584230546d46745a53493649434a305a584e3049697767496d5a70626d52535a57646c6543493649434a68596d4d694c434169636d56776247466a5a564e30636d6c755a79493649434a6b5a5759694c43416963477868593256745a573530496a6f67577a4664665631396658303dccfa68990000000049454e44ae426082','hex');
const badPng=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000001467445587463686172610065794a7a6347566a496a6f67496d4e6f59584a6858324e68636d5266646a49694c4341696333426c593139325a584a7a61573975496a6f67496a49754d43497349434a6b59585268496a6f6765794a755957316c496a6f67496c49784d53424459584a6b4946597949697767496d526c63324e796158423061573975496a6f67496c597949474e6f59584a685933526c6369497349434a6d61584a7a644639745a584d694f6941695347567362473867566a49694c43416959326868636d466a6447567958324a76623273694f694237496d3568625755694f694169596d3976617931324d69497349434a6c626e52796157567a496a6f6757337369615751694f6941784c4341695932397563335268626e51694f694230636e566c4c43416959323975644756756443493649434a574d69426962323972496e31646658313903ba118c0000000e7445587463637633006261646261736536346d5e0ad00000000049454e44ae426082','hex');
(async()=>{
  const scan=await importer.inspectBytes(new Uint8Array(dualPng),'legacy-dual.png');
  assert.equal(scan.resources.filter(r=>r.kind==='character').length,1);
  const current=scan.resources.find(r=>r.kind==='character');
  assert(current.path.includes('ccv3'),'current parser prefers ccv3');
  const sourceId='sha256:'+scan.sha256;
  const capsule={sha256:scan.sha256,filename:scan.filename,format:scan.format,bytes:scan.bytes,versions:scan.versions,warnings:scan.warnings};
  // This is an old-style projection from exactly the same capsule bytes:
  // chara/V2 appeared first, ccv3/V3 next. Current R11 parser exposes only V3.
  const legacyV2={kind:'character',name:'R11 Card V2',path:'png.chara[0].data',raw:{name:'R11 Card V2',description:'旧版角色'},index:0};
  const oldProjection=[legacyV2,...scan.resources.map((r,i)=>({...r,index:i+1}))];
  assert.equal((await store.importSource(capsule,oldProjection)).reused,false);
  const reused=await store.importSource(capsule,scan.resources);
  assert.equal(reused.reused,true);
  assert.equal(reused.resources,oldProjection.length,'do not claim new scanner resource count as persisted count');
  assert.equal(reused.projectionChanged,true,'old dual parser is not identical to new single-authority parser');
  const persisted=await store.all('resource_ir');
  assert.equal(persisted.find(r=>r.sourceId===sourceId&&r.index===current.index).raw.name,'R11 Card V2','old positional selection would choose V2');
  const selected=runtime.resolveCharacterSelection(sourceId,current,persisted);
  assert.equal(selected.raw.name,current.raw.name);
  assert.equal(selected.path,current.path);
  assert.notEqual(selected.index,current.index,'new projection index should not matter');
  const session=await runtime.createSession(sourceId,{characterResourceId:selected.id});
  assert.equal(session.characterResourceId,selected.id);
  const prompt=await runtime.preview(session.id,'红色钥匙在哪里');
  assert(prompt.messages.some(m=>m.content.includes('R11 Card V3')));
  assert(!prompt.messages.some(m=>m.content.includes('旧版角色')),'V2 must not leak into V3 prompt');
  const reply=await runtime.send(session.id,'红色钥匙在哪里');
  assert.equal(reply.reply,'已读到红色钥匙。');
  assert.equal((await runtime.turnJournal(session.id))[0].settlement,'committed');
  const all=await store.snapshot();store.verifyRelationships(all.records);await store.verifySources(all.records);
  const before=JSON.stringify(all.records.messages);
  const conflict={...current,raw:{...current.raw,name:'被污染的新角色'}};
  assert.throws(()=>runtime.resolveCharacterSelection(sourceId,conflict,persisted),e=>e.code==='E_RESOURCE_VERSION_CONFLICT');
  assert.throws(()=>runtime.resolveCharacterSelection(sourceId,{...current,path:'png.ccv3[999].data'},persisted),e=>e.code==='E_RESOURCE_VERSION_CONFLICT');
  assert.throws(()=>runtime.resolveCharacterSelection(sourceId,legacyV2,[legacyV2,legacyV2].map((r,i)=>({...r,sourceId,id:sourceId+'#'+i}))),e=>e.code==='E_RESOURCE_VERSION_CONFLICT');
  assert.equal(JSON.stringify((await store.snapshot()).records.messages),before,'conflict cannot mutate committed messages');
  console.log('PASS old dual-V2/V3 resource index -> verified reuse -> select original V3 by immutable path+raw -> real runtime session -> mocked provider -> committed journal -> no V2 leakage');
})().catch(e=>{console.error(e);process.exitCode=1});
