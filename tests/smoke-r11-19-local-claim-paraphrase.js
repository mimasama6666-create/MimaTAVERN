'use strict';
// Synthetic Provider + durable fake store: tests canonical source -> validation
// -> fact/core commit, negative review and unchanged History, not real browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),copy=v=>v===undefined?undefined:structuredClone(v),data=new Map();
function openDb(){return {close(){},transaction(){let pending=0,done=false,aborted=false;const staged=new Map([...data].map(([k,v])=>[k,copy(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};const settle=()=>{if(done||aborted||pending)return;done=true;setImmediate(()=>{data.clear();for(const[k,v]of staged)data.set(k,copy(v));tx.oncomplete?.()});};tx.objectStore=()=>({get(k){pending++;const r={result:undefined};setImmediate(()=>{r.result=copy(staged.get(k));r.onsuccess?.();pending--;setImmediate(settle)});return r;},put(v,k){staged.set(k,copy(v));return{}},delete(k){staged.delete(k);return{}}});return tx;}};}
global.window=global;global.indexedDB={open(){const r={result:openDb()};setImmediate(()=>r.onsuccess?.());return r;}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v))};require('../local-store.js');require('../standalone-core.js');
const source=fs.readFileSync(path.join(root,'standalone-core.js'),'utf8');const sandbox={window:{},TextEncoder,console};vm.runInNewContext(source.replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window.__ledger=sourceEventLedger;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});'),sandbox);const ledger=sandbox.window.__ledger;
const baseline=process.env.R11_18_CORE_COMPARE;if(baseline){const old={window:{},TextEncoder,console};vm.runInNewContext(fs.readFileSync(baseline,'utf8').replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window.__ledger=sourceEventLedger;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});'),old);assert.equal(old.window.__ledger([{id:'a',role:'user',content:'艾琳答应守护蓝色盒子。'}],'艾琳同意守护蓝色盒子。').complete,false);}
const one=(body)=>[{id:'s',role:'user',rawContent:body,content:body}];
const cases=[
 ['同意/答应','艾琳答应守护蓝色盒子。','艾琳同意守护蓝色盒子。',true],
 ['反向同义词','艾琳同意守护蓝色盒子。','艾琳答应守护蓝色盒子。',true],
 ['把/将与放入','艾琳把钥匙放进蓝色盒子。','艾琳将钥匙放入蓝色盒子。',true],
 ['同地点语序','艾琳与阿树约定在港口见面。','艾琳与阿树在港口约定见面。',true],
 ['拒绝反转','艾琳拒绝答应守护蓝色盒子。','艾琳同意守护蓝色盒子。',false],
 ['追加错误物品','艾琳答应守护蓝色盒子。','艾琳同意守护蓝色盒子和红色盒子。',false],
 ['替换物品','艾琳答应守护蓝色盒子。','艾琳同意守护红色盒子。',false],
 ['替换人物','艾琳答应守护蓝色盒子。','阿树同意守护蓝色盒子。',false],
 ['虚假传闻升格','艾琳听说阿树答应守护蓝色盒子。','艾琳确认阿树同意守护蓝色盒子。',false],
 ['肯否颠倒','艾琳不同意守护蓝色盒子。','艾琳同意守护蓝色盒子。',false],
];for(const [name,input,output,expected]of cases)assert.equal(ledger(one(input),output).complete,expected,name);
const both=[{id:'s1',role:'user',content:'艾琳答应守护蓝色盒子。'},{id:'s2',role:'assistant',content:'阿树把钥匙放进蓝色盒子。'}];
const joined='艾琳同意守护蓝色盒子。阿树将钥匙放入蓝色盒子。';
assert.equal(ledger(both,joined).complete,true,'two genuinely separate paraphrased events');
assert.equal(ledger(both,'艾琳同意守护蓝色盒子。').complete,false,'missing a separate event');
assert.equal(ledger(both,joined+'阿树又偷走一枚戒指。').complete,false,'invented action');
let modelOutput='';let calls=0;
global.fetch=async()=>{calls++;const payload={choices:[{message:{content:modelOutput},finish_reason:'stop'}]};return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>payload,text:async()=>JSON.stringify(payload)};};
const route=(p,m='GET',body=null)=>MimaStandalone.handle(p,m,body);
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'https://example.invalid/v1',model:'mock',stream:false,contextWindowTokens:32768});
 const fact=(await route('/sessions','POST',{title:'source fact'})).data;const factMessages=both.map(m=>({...m,rawContent:m.content,versions:[]}));
 assert((await route(`/sessions/${fact.id}`,'PATCH',{messages:factMessages})).success);
 modelOutput=joined;
 const f=await route(`/sessions/${fact.id}/memory/facts`,'POST',{scope:'all',chunkRounds:1});
 assert.equal(f.success,true,JSON.stringify(f));assert.equal(f.data.manualMemory.facts.length,1);assert.equal(f.data.manualMemory.facts[0].content,joined);
 assert.equal(f.data.manualMemory.facts[0].verification.status,'source_bounded');
 assert.equal((await MimaLocalStore.getMemoryJob(fact.id,'facts')).status,'committed');
 const prior=copy(f.data.manualMemory.facts);
 modelOutput='艾琳同意守护蓝色盒子。';
 const bad=await route(`/sessions/${fact.id}/memory/facts`,'POST',{scope:'all',replaceExisting:true,chunkRounds:1});
 assert.equal(bad.success,false);assert.equal(bad.code,'E_MEMORY_NEEDS_REVIEW');
 assert.deepEqual((await route(`/sessions/${fact.id}`)).data.manualMemory.facts,prior);
 assert.equal((await MimaLocalStore.getMemoryJob(fact.id,'facts')).status,'needs_review');
 const core=(await route('/sessions','POST',{title:'selective core'})).data;
 const messages=Array.from({length:26},(_,i)=>({id:'e'+i,role:i%2?'assistant':'user',content:i===0?'艾琳答应守护蓝色盒子。':`第${i}条剧情：角色获得物品${i}。`,rawContent:i===0?'艾琳答应守护蓝色盒子。':`第${i}条剧情：角色获得物品${i}。`,versions:[]}));
 assert((await route(`/sessions/${core.id}`,'PATCH',{messages})).success);
 modelOutput=JSON.stringify({memory:'艾琳同意守护蓝色盒子。',evidence:[{quote:messages[0].content}]});
 const good=await route(`/sessions/${core.id}/memory/core`,'POST',{source:'context'});
 assert.equal(good.success,true,JSON.stringify(good));assert.equal(good.data.manualMemory.core.content,'艾琳同意守护蓝色盒子。');
 assert.equal(good.data.manualMemory.core.verification.status,'source_bounded');assert.equal(good.data.messages.length,26);
 modelOutput=JSON.stringify({memory:'艾琳同意守护红色盒子。',evidence:[{quote:messages[0].content}]});
 const badCore=await route(`/sessions/${core.id}/memory/core`,'POST',{source:'context'});
 assert.equal(badCore.success,false);assert.equal(badCore.code,'E_MEMORY_NEEDS_REVIEW');
 assert.equal((await route(`/sessions/${core.id}`)).data.manualMemory.core.content,'艾琳同意守护蓝色盒子。');
 modelOutput=JSON.stringify({memory:'艾琳同意守护蓝色盒子。',evidence:[{quote:'无关的假引文'}]});
 const fakeEvidence=await route(`/sessions/${core.id}/memory/core`,'POST',{source:'context'});
 assert.equal(fakeEvidence.success,false);assert.equal(fakeEvidence.code,'E_MEMORY_OUTPUT_INVALID');
 console.log('PASS R11.19: 13 ledger true/false cases, factual paraphrase committed, omitted facts refused, selective cited core paraphrase committed, fabricated object and bogus quotes blocked, canonical History intact; calls='+calls);
})().catch(e=>{console.error(e);process.exitCode=1});
