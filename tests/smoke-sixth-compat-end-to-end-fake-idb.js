'use strict';
/* Actual importer, store and runtime wired together; fake IDB only, no browser conformance claim. */
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
global.window=global;
const tables=new Map(),names=new Set();const clone=v=>v===undefined?undefined:structuredClone(v);
const fakeDb=()=>({close(){},objectStoreNames:{contains:k=>names.has(k)},createObjectStore(k){names.add(k);tables.set(k,new Map())},transaction(arr){const stores=Array.isArray(arr)?arr:[arr],staged=new Map(stores.map(k=>[k,new Map([...tables.get(k)].map(([id,v])=>[id,clone(v)]))]));let pending=0,completed=false,aborted=false;const tx={oncomplete:null,onabort:null,onerror:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};
 const finish=()=>{if(pending||completed||aborted)return;completed=true;setImmediate(()=>{if(!aborted){for(const [k,items]of staged)tables.set(k,items);tx.oncomplete?.();}})};
 const obj=k=>({get(id){pending++;const r={result:null,onsuccess:null,onerror:null};setImmediate(()=>{if(!aborted){r.result=clone(staged.get(k).get(id));r.onsuccess?.()}pending--;setImmediate(finish)});return r},getAll(){pending++;const r={result:null,onsuccess:null,onerror:null};setImmediate(()=>{if(!aborted){r.result=[...staged.get(k).values()].map(clone);r.onsuccess?.()}pending--;setImmediate(finish)});return r},getAllKeys(){pending++;const r={result:null,onsuccess:null,onerror:null};setImmediate(()=>{if(!aborted){r.result=[...staged.get(k).keys()];r.onsuccess?.()}pending--;setImmediate(finish)});return r},add(v){const id=v.id;if(staged.get(k).has(id))throw new Error('duplicate '+id);staged.get(k).set(id,clone(v));return{}},put(v){staged.get(k).set(v.id,clone(v));return{}},delete(id){staged.get(k).delete(id);return{}}});tx.objectStore=obj;setImmediate(finish);return tx;}});
global.indexedDB={open(){const req={result:fakeDb(),onupgradeneeded:null,onsuccess:null,onerror:null,oldVersion:names.size?1:0};setImmediate(()=>{if(!names.size)req.onupgradeneeded?.();req.onsuccess?.()});return req;}};
global.MimaPngCardImport=require('../png-card-import.js');const importer=require('../compat-import.js');const store=require('../compat-store.js');global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');const runtime=require('../compat-runtime.js');
const calls=[];global.MimaStandalone={getApiConfig:()=>({apiBase:'mock',model:'local-review'}),callModelWithConfig:async payload=>{calls.push(clone(payload));return '角色回复：我听见了你的问题。';}};
(async()=>{
 const file=process.env.MIMA_PRIVATE_PNG;if(!file){console.log('SKIP: real PNG not provided');return;}
 console.log('R6 TRACE 1 parser'); const card=await importer.inspectBytes(fs.readFileSync(file),'real-original.png');
 assert(card.resources.filter(r=>r.kind==='character').length>=2);
 const source={sha256:card.sha256,filename:card.filename,format:card.format,bytes:card.bytes,versions:card.versions,warnings:card.warnings};
 console.log('R6 TRACE 2 import'); const result=await store.importSource(source,card.resources);assert.equal(result.reused,false);
 console.log('R6 TRACE 3 reimport'); const reused=await store.importSource(source,card.resources);assert.equal(reused.reused,true);
 const selected=(await store.all('resource_ir')).find(r=>r.kind==='character'&&r.path.includes('ccv3'));
 console.log('R6 TRACE 4 create'); const session=await runtime.createSession(result.id,{characterResourceId:selected.id,greetingIndex:0});assert(session.id);
 console.log('R6 TRACE 5 preview'); const before=await runtime.preview(session.id,'偷看手机');
 assert.equal(before.worldInfo.inserted.length,5);
 assert(!before.messages[0].content.includes('偷看手机'));
 assert(before.messages.some(m=>m.role==='user'&&m.content.includes('偷看手机')));
 // Source fragments stay out of true system role, while available to the roleplay provider.
 assert(before.messages.some(m=>m.content.includes('王爱英')));
 console.log('R6 TRACE 6 send'); const sent=await runtime.send(session.id,'偷看手机');assert(sent.reply.includes('角色回复'));
 await runtime.send(session.id,'第二轮，我们接着前面的剧情继续。');
 await runtime.send(session.id,'第三轮，角色还记得之前说过的话吗？');
 const persisted=await runtime.sessionMessages(session.id);assert.equal(persisted.filter(m=>m.role==='assistant'&&m.status==='committed'&&!m.opening).length,3);
 assert((await runtime.turnJournal(session.id)).some(j=>j.settlement==='committed'));
 assert.equal((await runtime.getSession(session.id)).pendingTurnId,null);
 delete require.cache[require.resolve('../compat-runtime.js')];const afterModuleReload=require('../compat-runtime.js');
 assert.equal((await afterModuleReload.getSession(session.id)).id,session.id);
 assert.equal((await afterModuleReload.sessionMessages(session.id)).filter(m=>m.role==='assistant'&&!m.opening).length,3);
 assert.equal(calls.length,3);assert(calls[0].some(m=>m.content.includes('偷看手机')));
 const external=await importer.inspectBytes(Buffer.from(JSON.stringify({entries:[{uid:9,constant:true,position:0,content:'这是一条来自独立来源的世界书内容'}],name:'追加世界书'})),'extra.json');
 const extra=await store.importSource({sha256:external.sha256,filename:external.filename,format:external.format,bytes:external.bytes,versions:external.versions,warnings:external.warnings},external.resources);
 const extraWorld=(await store.all('resource_ir')).find(r=>r.sourceId===extra.id&&r.kind==='world_info');assert(extraWorld);
 await runtime.mountResource(session.id,extraWorld.id);
 const mounted=await runtime.preview(session.id,'你好',{acceptGaps:true});assert(mounted.messages.some(m=>m.content.includes('来自独立来源')));
 await runtime.unmountResource(session.id,extraWorld.id);
 const noMount=await runtime.preview(session.id,'你好');assert(!noMount.messages.some(m=>m.content.includes('来自独立来源')));
 const all=await store.snapshot();assert(all.records.source_capsules.length===2);assert(all.records.messages.some(m=>m.role==='assistant'&&m.status==='committed'));
 store.verifyRelationships(all.records);await store.verifySources(all.records);
 console.log('PASS actual private PNG dual-version read -> SHA import & dedup -> explicit CCV3 -> create -> WI trigger -> 3 mock provider turns -> journal settled -> module reload reads 3 turns -> external mount/unmount -> durable snapshot');
 console.log('UNTESTED: actual paid Provider / browser IndexedDB / official SillyTavern golden');
})().catch(e=>{console.error(e);process.exitCode=1});
