'use strict';
// R11.18 regression: core is selective; rolling/facts remain exhaustive.
// Uses synthetic Provider and fake transaction store; not a real API / browser test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),oldPath=process.env.R11_17_CORE_FOR_COMPARE||'';
const cp=v=>v===undefined?undefined:structuredClone(v),raw=new Map();
function db(){return{close(){},transaction(){let pending=0,closed=false,aborted=false;const staged=new Map([...raw].map(([k,v])=>[k,cp(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};
 const done=()=>{if(closed||aborted||pending)return;closed=true;setImmediate(()=>{raw.clear();for(const[k,v]of staged)raw.set(k,cp(v));tx.oncomplete?.()})};
 tx.objectStore=()=>({get(key){pending++;const r={result:undefined};setImmediate(()=>{r.result=cp(staged.get(key));r.onsuccess?.();pending--;setImmediate(done)});return r;},put(v,k){staged.set(k,cp(v));return{}},delete(k){staged.delete(k);return{}}});return tx;}}}
global.window=global;global.indexedDB={open(){const r={result:db()};setImmediate(()=>r.onsuccess?.());return r}};
global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:k=>pref.get(k)||null,setItem:(k,v)=>pref.set(k,v)};
require('../local-store.js');require('../standalone-core.js');
let reply='',requests=0;
global.fetch=async()=>{requests++;const result={choices:[{message:{content:reply},finish_reason:'stop'}]};return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>result,text:async()=>JSON.stringify(result)}};
const route=(a,b,c)=>MimaStandalone.handle(a,b,c);
function sourceProbe(file){const source=fs.readFileSync(file,'utf8');const sandbox={window:{},TextEncoder,console};vm.runInNewContext(source.replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window.__ledger=sourceEventLedger;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});'),sandbox);return sandbox.window.__ledger;}
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'synthetic',stream:false,contextWindowTokens:32768});
 const core=(await route('/sessions','POST',{title:'core selective true'})).data;
 const messages=Array.from({length:50},(_,i)=>({id:'sel-'+i,role:i%2?'assistant':'user',content:`第${i}条剧情：角色${i%4}找到了地图碎片${i}，答应守护这段旅程。`,rawContent:`第${i}条剧情：角色${i%4}找到了地图碎片${i}，答应守护这段旅程。`,versions:[]}));
 assert((await route(`/sessions/${core.id}`,'PATCH',{messages})).success);
 reply=JSON.stringify({memory:messages[0].content,evidence:[{quote:messages[0].content}]});
 const accepted=await route(`/sessions/${core.id}/memory/core`,'POST',{source:'context'});
 assert.equal(accepted.success,true,JSON.stringify(accepted));assert.equal(accepted.data.manualMemory.core.content,messages[0].content);
 assert.equal(accepted.data.messages.length,50);assert.equal((await MimaLocalStore.getMemoryJob(core.id,'core')).status,'committed');
 const before=accepted.data.manualMemory.core.content;
 reply=JSON.stringify({memory:'角色0杀害了同伴。',evidence:[{quote:messages[0].content}]});
 const rejected=await route(`/sessions/${core.id}/memory/core`,'POST',{source:'context'});
 assert.equal(rejected.success,false);assert.equal(rejected.code,'E_MEMORY_NEEDS_REVIEW');
 assert.equal((await route(`/sessions/${core.id}`,'GET')).data.manualMemory.core.content,before);
 const fact=(await route('/sessions','POST',{title:'facts complete'})).data;
 const f=messages.slice(0,12).map((x,i)=>({...x,id:'fact'+i}));assert((await route(`/sessions/${fact.id}`,'PATCH',{messages:f})).success);
 reply=JSON.stringify({memory:f[0].content,evidence:[{quote:f[0].content}]});
 const onlyFirst=await route(`/sessions/${fact.id}/memory/facts`,'POST',{scope:'all',chunkRounds:6});
 assert.equal(onlyFirst.success,false);assert.equal(onlyFirst.code,'E_MEMORY_NEEDS_REVIEW');
 assert.equal((await route(`/sessions/${fact.id}`,'GET')).data.manualMemory.facts.length,0);
 const ledger=sourceProbe(path.join(root,'standalone-core.js'));
 const source=[
  '艾琳杀死了甲方。','艾琳杀死了乙方。','玩家拒绝同意偷走钥匙。',
  '守卫说国王遇难是未经证实的传闻。','玩家将银戒交给玛丽。'
 ].map((content,i)=>({id:'case'+i,role:i%2?'assistant':'user',content,rawContent:content}));
 const scenarios=[
  ['complete',source.map(x=>x.content).join('\n')],
  ['missing victim',source.filter(x=>!x.content.includes('乙方')).map(x=>x.content).join('\n')],
  ['invented victim',source.map(x=>x.content).join('\n')+'\n艾琳杀死了丙方。'],
  ['inverted refusal',source.map(x=>x.content).join('\n').replace('拒绝同意','同意')],
  ['rumor upgraded',source.map(x=>x.content).join('\n').replace('是未经证实的传闻','已经确定')],
  ['invented destruction',source.map(x=>x.content).join('\n')+'\n守卫烧毁了所有信件。']
 ];
 const expected=[true,false,false,false,false,false];
 for(let i=0;i<scenarios.length;i++){
  const r=ledger(source,scenarios[i][1]);assert.equal(r.complete,expected[i],scenarios[i][0]);
 }
 if(oldPath){const old=sourceProbe(oldPath);for(const [name,value]of scenarios){const previous=old(source,value),current=ledger(source,value);if(name==='invented victim'){assert.equal(previous.complete,true,'baseline must reproduce fabricated-victim false positive');assert.equal(current.complete,false);}else{assert.equal(current.complete,previous.complete,'ledger semantic regression: '+name);if(previous.complete)assert.equal(current.missing.length,previous.missing.length,'ledger positive coverage regression: '+name);}}}
 console.log('PASS core selective true with 50 messages; invented core blocked; fact first-only still blocked; 6 event-coverage positive/negative cases'+(oldPath?' compared to R11.17':''));
 console.log('provider calls',requests);
})().catch(e=>{console.error(e);process.exitCode=1});
