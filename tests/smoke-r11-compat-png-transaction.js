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
 const b=new Uint8Array(dualPng);
 const scan=await importer.inspectBytes(b,'valid_dual.png');assert.equal(scan.resources.filter(x=>x.kind==='character').length,1);
 const capsule={sha256:scan.sha256,filename:scan.filename,format:scan.format,bytes:scan.bytes,versions:scan.versions,warnings:scan.warnings};
 const r=await store.importSource(capsule,scan.resources);assert.equal(r.reused,false);
 const r2=await store.importSource(capsule,scan.resources);assert.equal(r2.reused,true);
 assert.equal((await store.all('source_capsules')).length,1);
 const card=(await store.all('resource_ir')).find(x=>x.kind==='character');
 const ses=await runtime.createSession(r.id,{characterResourceId:card.id});
 assert((await runtime.sessionMessages(ses.id)).length===1,'opening committed');
 const payload=await runtime.preview(ses.id,'红色钥匙现在在哪里？');assert.equal(payload.contextTrace.allHistoryIncluded,true);
 const receipt=await runtime.send(ses.id,'红色钥匙现在在哪里？');assert.equal(receipt.reply,'已读到红色钥匙。');
 const messages=await runtime.sessionMessages(ses.id);
 assert.deepEqual(messages.filter(x=>x.status==='committed').map(x=>x.role),['assistant','user','assistant']);
 assert.equal((await runtime.turnJournal(ses.id))[0].settlement,'committed');
 // A provider refusal in HTTP 200 content must settle as failed, never as a
 // committed character answer. Retry remains an explicit same-turn action.
 global.MimaStandalone.callModelWithConfig=async()=> 'I cannot fulfill this request. Your prompt involves graphic descriptions. My safety policies prohibit such material.';
 const failedInput='请继续钥匙的剧情';
 await assert.rejects(()=>runtime.send(ses.id,failedInput),e=>e.code==='E_API_REFUSAL_CONTENT');
 const afterRefusal=await runtime.sessionMessages(ses.id);
 assert(!afterRefusal.some(m=>String(m.canonicalContent||'').includes('My safety policies')),'bad provider output did not commit');
 const records=await runtime.turnJournal(ses.id),rejectedJob=records[records.length-1];
 assert.equal(rejectedJob.settlement,'failed');assert.equal(rejectedJob.code,'E_API_REFUSAL_CONTENT');
 assert.equal(afterRefusal.find(m=>m.turnId===rejectedJob.id&&m.role==='user')?.status,'failed','failed request preserves original user message');
 global.MimaStandalone.callModelWithConfig=async()=> '红色钥匙依旧放在桌上。';
 const restored=await runtime.retryTurn(ses.id,rejectedJob.id);
 assert.equal(restored.reply,'红色钥匙依旧放在桌上。');
 const finalJobs=await runtime.turnJournal(ses.id);
 assert.equal(finalJobs[finalJobs.length-1].settlement,'committed');
 assert.equal((await runtime.sessionMessages(ses.id)).filter(m=>m.role==='assistant'&&m.turnId===rejectedJob.id).length,1);
 const snapshot=await store.snapshot();assert.equal(snapshot.records.source_capsules.length,1);
 await store.verifySources(snapshot.records);store.verifyRelationships(snapshot.records);
 assert.deepEqual((await store.get('source_capsules',r.id)).bytes,b);
 const before=(await store.all('source_capsules')).length;
 await assert.rejects(()=>importer.inspectBytes(new Uint8Array(badPng),'bad.png'),e=>e.code==='E_PNG_CARD_INVALID');
 assert.equal((await store.all('source_capsules')).length,before,'failed card cannot create empty source');
 console.log('PASS synthetic PNG -> SHA-verified IDB-style source commit -> one CCv3 role -> greeting -> mocked model turn -> commit -> integrity and recovery read');
})().catch(e=>{console.error(e);process.exitCode=1;});
