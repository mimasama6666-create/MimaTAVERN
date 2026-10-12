 'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const cp=x=>x===undefined?undefined:structuredClone(x),storage=new Map();
function db(){return{close(){},transaction(){let pending=0,finished=false,aborted=false;const staged=new Map([...storage].map(([k,v])=>[k,cp(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(finished||aborted||pending)return;finished=true;setImmediate(()=>{if(!aborted){storage.clear();for(const [k,v]of staged)storage.set(k,cp(v));tx.oncomplete?.();}})}const store={get(k){pending++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=cp(staged.get(k));r.onsuccess?.();pending--;setImmediate(done)});return r;},put(v,k){staged.set(k,cp(v));return{}},delete(k){staged.delete(k);return{}}};tx.objectStore=()=>store;return tx;}}}
global.window=global;global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,v)=>pref.set(x,v)};
require('../local-store.js');require('../standalone-core.js');

const normal='玩家和守卫连续二十四天将收到的求援信封存到档案室，并反复确认封条完好。';
const dayMessages=Array.from({length:42},(_,i)=>({id:'d'+i,role:i%2?'assistant':'user',content:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,rawContent:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,versions:[]}));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
let gate=null,requested=0,chatCount=0;
const response=value=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content:value},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content:value},finish_reason:'stop'}]})});
global.fetch=async(_url,opts)=>{
 const prompt=JSON.parse(opts.body).messages?.[0]?.content||'';
 if(prompt.includes('剧情档案助手')){requested++;const old=gate;if(old)await old.promise;return response(normal);}
 chatCount++;return response('角色回复 '+chatCount);
};
const route=(a,b,c)=>MimaStandalone.handle(a,b,c);
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',stream:false,contextWindowTokens:32768});
 const s=(await route('/sessions','POST',{title:'R9 append-only background concurrency'})).data;
 await route(`/sessions/${s.id}`,'PATCH',{messages:dayMessages,promptSettings:{recentMessageLimit:12}});
 gate=defer();requested=0;
 const pending=MimaStandalone.runRecordedMemory('rolling',s.id,{});
 for(let i=0;i<80&&requested<1;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(requested,1,'rolling started');
 const chat=await route(`/sessions/${s.id}/chat`,'POST',{text:'主人决定继续探险',action:'send'});
 assert.equal(chat.success,true,JSON.stringify(chat));assert(chat.data.messages.at(-1).content.includes('角色回复'));
 gate.resolve();gate=null;
 const result=await pending;assert.equal(result.lastSummarizedIndex,24);
 const after=(await route(`/sessions/${s.id}`,'GET')).data;
 assert.equal(after.messages.length,44);assert(after.messages.some(x=>x.content==='主人决定继续探险'));
 assert.equal((await MimaLocalStore.getMemoryJob(s.id,'rolling')).status,'committed');
 console.log('PASS R9 Direct Reply proceeds while rolling provider awaits; append-only chat preserved after summary settlement');
 const t=(await route('/sessions','POST',{title:'R9 stale edit during summarization'})).data;
 await route(`/sessions/${t.id}`,'PATCH',{messages:dayMessages,promptSettings:{recentMessageLimit:12}});
 gate=defer();const start=requested;
 const inFlight=MimaStandalone.runRecordedMemory('rolling',t.id,{}).then(()=>({ok:true})).catch(e=>({ok:false,code:e.code}));
 for(let i=0;i<80&&requested<=start;i++)await new Promise(r=>setTimeout(r,5));
 assert(requested>start,'second request started');
 const edit=await route(`/sessions/${t.id}/messages/d0`,'PATCH',{content:'第1天的封条实际已经破损。'});
 assert.equal(edit.success,true,JSON.stringify(edit));
 gate.resolve();gate=null;
 const run=await inFlight;assert.equal(run.ok,false);assert.equal(run.code,'E_MEMORY_SOURCE_STALE',JSON.stringify(run));
 const final=(await route(`/sessions/${t.id}`,'GET')).data;
 assert.equal(final.lastSummarizedIndex,0);assert.equal(final.rollingSummary,'');
 assert.equal(final.messages[0].content,'第1天的封条实际已经破损。');
 console.log('PASS R9 original-history edit fences stale memory response; no cursor or summary overwrite');
})().catch(e=>{console.error(e);process.exitCode=1});
