'use strict';
// Synthetic V2/V3 PNG; no private card, real parser/store/runtime and in-memory IndexedDB emulator.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const cloned=x=>x===undefined?undefined:structuredClone(x);
global.window=global;
const tables=new Map(),names=new Set();
const db=()=>({close(){},objectStoreNames:{contains:k=>names.has(k)},createObjectStore(k){names.add(k);tables.set(k,new Map())},transaction(arr){const keys=Array.isArray(arr)?arr:[arr],stage=new Map(keys.map(k=>[k,new Map([...tables.get(k)].map(([id,v])=>[id,cloned(v)]))]));let pending=0,closed=false,aborted=false;const tx={oncomplete:null,onabort:null,onerror:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};const finish=()=>{if(pending||closed||aborted)return;closed=true;setImmediate(()=>{if(!aborted){for(const [k,v]of stage)tables.set(k,v);tx.oncomplete?.()}})};const object=k=>({get(id){pending++;const r={result:undefined,onsuccess:null,onerror:null,transaction:tx};setImmediate(()=>{if(!aborted){r.result=cloned(stage.get(k).get(id));r.onsuccess?.()}pending--;setImmediate(finish)});return r},getAll(){pending++;const r={result:undefined,onsuccess:null,onerror:null,transaction:tx};setImmediate(()=>{if(!aborted){r.result=[...stage.get(k).values()].map(cloned);r.onsuccess?.()}pending--;setImmediate(finish)});return r},getAllKeys(){pending++;const r={result:undefined,onsuccess:null,onerror:null,transaction:tx};setImmediate(()=>{if(!aborted){r.result=[...stage.get(k).keys()];r.onsuccess?.()}pending--;setImmediate(finish)});return r},add(v){const id=v.id;if(stage.get(k).has(id))throw new Error('duplicate '+id);stage.get(k).set(id,cloned(v));return{}},put(v){stage.get(k).set(v.id,cloned(v));return{}},delete(id){stage.get(k).delete(id);return{}}});tx.objectStore=object;setImmediate(finish);return tx}});
global.indexedDB={open(){const req={result:db(),onupgradeneeded:null,onsuccess:null,onerror:null,oldVersion:names.size?1:0};setImmediate(()=>{if(!names.size)req.onupgradeneeded?.();req.onsuccess?.()});return req}};
global.MimaPngCardImport=require('../png-card-import.js');const importer=require('../compat-import.js');const store=require('../compat-store.js');global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');const runtime=require('../compat-runtime.js');
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(b){let c=0xffffffff;for(const n of b)c=crcTable[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(kind,content){const name=Buffer.from(kind),data=Buffer.from(content),size=Buffer.alloc(4),tail=Buffer.alloc(4),payload=Buffer.concat([name,data]);size.writeUInt32BE(data.length);tail.writeUInt32BE(crc(payload));return Buffer.concat([size,payload,tail]);}
function cardPng(v2,v3){const rec=(k,o)=>chunk('tEXt',Buffer.from(k+'\0'+Buffer.from(JSON.stringify(o),'utf8').toString('base64')));return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',Buffer.from('00000001000000010806000000','hex')),rec('chara',v2),rec('ccv3',v3),chunk('IDAT',zlib.deflateSync(Buffer.from([0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
const card={spec:'chara_card_v3',data:{name:'测试旅行者',description:'随身携带蓝色指南针',personality:'审慎',first_mes:'{{char}}：欢迎你，{{user}}。',alternate_greetings:['{{char}}：我们从港口出发。'],character_book:{entries:[{uid:11,key:['指南针'],content:'蓝色指南针指向港口',position:0},{uid:12,constant:true,content:'天空总是灰色的',position:0}]}}};
let calls=[],rejectNext=false;
global.MimaStandalone={getApiConfig:()=>({apiBase:'http://127.0.0.1:1/v1',model:'synthetic-test',contextWindowTokens:20000}),callModelWithConfig:async messages=>{calls.push(cloned(messages));if(rejectNext){rejectNext=false;throw Object.assign(new Error('synthetic provider 429'),{code:'E_API_LIMIT',status:429})}return '角色说：指南针还在我手里。'},validateStoryReply:txt=>{assert(txt.includes('角色说'))}};
(async()=>{
 const png=cardPng({name:'旧版旅行者',description:'已弃用的旧版本'},card);
 const scanned=await importer.inspectBytes(png,'synthetic-ccv3.png');assert(scanned.versions.includes('ccv3'));assert.equal(scanned.resources.filter(r=>r.kind==='character').length,1,'V2 fallback must not become a second playable card');
 const params={sha256:scanned.sha256,filename:scanned.filename,format:scanned.format,bytes:scanned.bytes,versions:scanned.versions,warnings:scanned.warnings};
 const imported=await store.importSource(params,scanned.resources);assert.equal((await store.importSource(params,scanned.resources)).reused,true);
 const selected=(await store.all('resource_ir')).find(r=>r.sourceId===imported.id&&r.kind==='character');assert(selected.path.includes('ccv3'));
 const session=await runtime.createSession(imported.id,{characterResourceId:selected.id,greetingIndex:1});assert(session.id);
 const savedBudget=await store.putCAS('compat_sessions',{...session,worldInfoBudget:500000},session.revision);assert.equal(savedBudget.worldInfoBudget,500000);assert.equal((await runtime.getSession(session.id)).worldInfoBudget,500000);
 const before=await runtime.preview(session.id,'指南针现在在哪里？');assert.equal(before.worldInfo.budgetChars,500000);
 const largeWI=[{uid:300,constant:true,content:'世界书条目：'+'星'.repeat(220000),position:0}];
 assert.equal(runtime.worldInfo(largeWI,[{role:'user',content:'触发'}],{budgetChars:16000}).inserted.length,0);
 assert.equal(runtime.worldInfo(largeWI,[{role:'user',content:'触发'}],{budgetChars:500000}).inserted.length,1);assert.equal(before.worldInfo.inserted.length,2);assert(before.messages.some(m=>m.content.includes('蓝色指南针指向港口')));
 const opening=(await runtime.sessionMessages(session.id)).find(m=>m.opening);assert(opening.canonicalContent.includes('我们从港口出发'));
 const first=await runtime.send(session.id,'指南针现在在哪里？');assert(first.reply.includes('指南针'));assert(first.envelope.messages.some(m=>m.content.includes('蓝色指南针指向港口')));
 assert.equal(calls.length,1);assert.equal((await runtime.getSession(session.id)).pendingTurnId,null);
 rejectNext=true;await assert.rejects(()=>runtime.send(session.id,'第二轮，接着说'),e=>e.code==='E_API_LIMIT');
 const failed=(await runtime.turnJournal(session.id)).find(j=>j.settlement==='failed');assert(failed);assert.equal((await runtime.sessionMessages(session.id)).filter(m=>m.status==='failed').length,1);
 const recovered=await runtime.retryTurn(session.id,failed.id);assert(recovered.reply.includes('指南针'));
 const messages=await runtime.sessionMessages(session.id);assert.equal(messages.filter(m=>m.role==='assistant'&&!m.opening).length,2);assert.equal(messages.filter(m=>m.role==='user'&&m.status==='committed').length,2);
 assert.equal((await runtime.getSession(session.id)).pendingTurnId,null);
 delete require.cache[require.resolve('../compat-runtime.js')];const restart=require('../compat-runtime.js');assert.equal((await restart.sessionMessages(session.id)).length,5);
 const snap=await store.snapshot();store.verifyRelationships(snap.records);await store.verifySources(snap.records);
 assert.equal(calls.length,3);
 console.log('PASS synthetic PNG dual metadata -> V3 authority -> SHA import/dedup -> alternate greeting -> worldbook -> outbound provider payload -> 429 failed journal -> original turn retry -> settlement -> module reload -> sealed snapshot');
 console.log('NOT TESTED actual browser IDB, real Provider, actual owner PNG or official ST parity');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
