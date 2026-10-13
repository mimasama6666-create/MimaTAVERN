'use strict';
// R11.20: canonical fact-range coverage, selective core, and per-event slots.
// Runs against actual memory routes with a deterministic Provider and durable
// fake DB. This is not a live-provider or real-browser success-rate test.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),clone=v=>v===undefined?undefined:structuredClone(v),disk=new Map();
function db(){return {close(){},transaction(){let pending=0,done=false,aborted=false;const next=new Map([...disk].map(([k,v])=>[k,clone(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};const settle=()=>{if(done||aborted||pending)return;done=true;setImmediate(()=>{if(aborted)return;disk.clear();for(const [k,v]of next)disk.set(k,clone(v));tx.oncomplete?.();});};tx.objectStore=()=>({get(k){pending++;const r={result:undefined};setImmediate(()=>{r.result=clone(next.get(k));r.onsuccess?.();pending--;setImmediate(settle);});return r;},put(v,k){next.set(k,clone(v));return{}},delete(k){next.delete(k);return{}}});return tx;}};}
global.window=global;global.indexedDB={open(){const r={result:db()};setImmediate(()=>r.onsuccess?.());return r;}};
global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:k=>pref.get(k)||null,setItem:(k,v)=>pref.set(k,String(v))};
require('../local-store.js');require('../standalone-core.js');
const code=fs.readFileSync(path.join(root,'standalone-core.js'),'utf8');
const scope={window:{},TextEncoder,console};vm.runInNewContext(code.replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window.__validate=validateMemoryCandidate;window.__ledger=sourceEventLedger;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});'),scope);
const validate=scope.window.__validate,ledger=scope.window.__ledger;
const one=content=>[{id:'x',role:'user',rawContent:content,content}];
const source=['艾琳答应守护蓝色盒子。','阿树把钥匙放进蓝色盒子。'];
const records=source.map((content,i)=>({id:'e'+i,role:i?'assistant':'user',rawContent:content,content}));
const payload=(memory,quotes)=>JSON.stringify({memory,evidence:quotes.map(quote=>({quote}))});
const partial=payload(source[0],[source[0]]);
assert.equal(ledger(records,source.join('\n')).complete,true);
assert.equal(ledger(records,source[0]).complete,false);
assert.throws(()=>validate([],partial,'fact_range_1_1_part_0','stop',true,records),e=>e.code==='E_MEMORY_NEEDS_REVIEW'&&e.validationReason==='fact_range_events_missing');
assert.throws(()=>validate([],source[0],'fact_range_1_1_part_0','stop',true,records),e=>e.validationReason==='fact_range_events_missing');
assert.equal(validate([],payload(source.join('\n'),source),'fact_range_1_1_part_0','stop',true,records).memory,source.join('\n'));
assert.equal(validate([],partial,'core_final_single','stop',true,records).memory,source[0]);
const slots=[
 ['艾琳在港口拿到地图。','艾琳在树林拿到地图。',false],
 ['艾琳拿到红色钥匙。','艾琳拿到蓝色钥匙。',false],
 ['艾琳发现红色的门。','艾琳发现蓝色的门。',false],
 ['艾琳在港口拿到地图。','艾琳在港口拿到了地图。',true],
 ['艾琳拿到红色钥匙。','艾琳拿到了红色钥匙。',true],
 ['艾琳与阿树约定在港口见面。','艾琳与阿树在港口约定见面。',true]
];
for(const [raw,memory,ok] of slots)assert.equal(ledger(one(raw),memory).complete,ok,raw+' => '+memory);
let answer='',requests=0;global.fetch=async()=>{requests++;const json={choices:[{message:{content:answer},finish_reason:'stop'}]};return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>json,text:async()=>JSON.stringify(json)};};
const api=(path,method='GET',body=null)=>MimaStandalone.handle(path,method,body);
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'https://example.invalid/v1',model:'fake',stream:false});
 const session=(await api('/sessions','POST',{title:'fact coverage candidate'})).data,id=session.id;
 assert((await api('/sessions/'+id,'PATCH',{messages:records.map(r=>({...r,versions:[]}))})).success);
 answer=payload(source[0],[source[0]]);
 const bad=await api('/sessions/'+id+'/memory/facts','POST',{scope:'all',chunkRounds:1,replaceExisting:true});
 assert.equal(bad.success,false);assert.equal(bad.code,'E_MEMORY_NEEDS_REVIEW');
 const unchanged=(await api('/sessions/'+id)).data;assert.equal(unchanged.manualMemory.facts.length,0);assert.equal(unchanged.messages.length,2);
 assert.equal((await MimaLocalStore.getMemoryJob(id,'facts')).status,'needs_review');
 // Start a different source range to avoid consuming the intentionally
 // pending review job. A complete fact candidate must still commit.
 const complete=(await api('/sessions','POST',{title:'complete fact range'})).data;
 assert((await api('/sessions/'+complete.id,'PATCH',{messages:records.map(r=>({...r,versions:[]}))})).success);
 answer=payload(source.join('\n'),source);
 const good=await api('/sessions/'+complete.id+'/memory/facts','POST',{scope:'all',chunkRounds:1});
 assert.equal(good.success,true,JSON.stringify(good));
 assert.equal(good.data.manualMemory.facts[0].content,source.join('\n'));
 assert.equal((await MimaLocalStore.getMemoryJob(complete.id,'facts')).status,'committed');
 // A true opening event is source-grounded, but opening-only output
 // cannot silently erase the following user/assistant events in a fact range.
 const opening=(await api('/sessions','POST',{title:'opening plus events'})).data;
 const openingTexts=['开场传令员公布了暗号。','玩家走进庭院。','守卫关闭了大门。'];
 const openingMessages=openingTexts.map((content,i)=>({id:'opening'+i,role:i===1?'user':'assistant',content,rawContent:content,versions:[]}));
 assert((await api('/sessions/'+opening.id,'PATCH',{messages:openingMessages})).success);
 answer=payload(openingTexts[0],[openingTexts[0]]);
 const openingOnly=await api('/sessions/'+opening.id+'/memory/facts','POST',{scope:'all',chunkRounds:2});
 assert.equal(openingOnly.success,false);assert.equal(openingOnly.code,'E_MEMORY_NEEDS_REVIEW');
 assert.equal((await api('/sessions/'+opening.id)).data.manualMemory.facts.length,0);
 const core=(await api('/sessions','POST',{title:'selective core'})).data;
 assert((await api('/sessions/'+core.id,'PATCH',{messages:records.map(r=>({...r,versions:[]}))})).success);
 answer=partial;
 const coreResult=await api('/sessions/'+core.id+'/memory/core','POST',{source:'context'});
 assert.equal(coreResult.success,true,JSON.stringify(coreResult));
 assert.equal(coreResult.data.manualMemory.core.content,source[0]);
 console.log('PASS R11.20: fact partial JSON/plain rejected; full fact committed; core selective committed; event locations/objects bound; old History unchanged; requests='+requests);
})().catch(e=>{console.error(e);process.exitCode=1});
