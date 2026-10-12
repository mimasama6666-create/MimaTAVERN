'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const data=new Map(),copy=x=>x===undefined?undefined:structuredClone(x);
function db(){return{close(){},transaction(){let n=0,ended=false,aborted=false;const snapshot=new Map([...data].map(([k,v])=>[k,copy(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(ended||aborted||n)return;ended=true;setImmediate(()=>{if(!aborted){data.clear();for(const [k,v]of snapshot)data.set(k,copy(v));tx.oncomplete?.();}})}const obj={get(k){n++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=copy(snapshot.get(k));r.onsuccess?.();n--;setImmediate(done)});return r;},put(v,k){snapshot.set(k,copy(v));return{}},delete(k){snapshot.delete(k);return{}}};tx.objectStore=()=>obj;return tx;}}}
global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,y)=>pref.set(x,y)};
require(path.join(root,'local-store.js'));require(path.join(root,'standalone-core.js'));
let chatCalls=0,memoryCalls=0;
global.fetch=async (_url,opts)=>{const body=JSON.parse(opts.body);const memory=body.messages?.[0]?.content?.includes('剧情档案助手');if(memory)memoryCalls++;else chatCalls++;const content=memory?'仅供待审核的摘要。':'守卫继续巡逻。';return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})};};
const tick=()=>new Promise(r=>setTimeout(r,40));
(async()=>{await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://127.0.0.1:5999/v1',model:'local-test',stream:false});const s=(await MimaStandalone.handle('/sessions','POST',{title:'auto trigger'})).data;
const messages=Array.from({length:42},(_,i)=>({id:'auto-'+i,role:i%2?'assistant':'user',content:`第${i+1}天玩家巡视走廊。`,rawContent:`第${i+1}天玩家巡视走廊。`,versions:[]}));await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12,summaryTriggerMessages:28}});
await MimaStandalone.handle(`/sessions/${s.id}/chat`,'POST',{text:'巡逻继续。'});await tick();assert.equal(chatCalls,1);assert.equal(memoryCalls,0,'Below 28 uncovered messages, no automatic memory call');
await MimaStandalone.handle(`/sessions/${s.id}/chat`,'POST',{text:'再次巡逻。'});await tick();assert.equal(chatCalls,2);assert.equal(memoryCalls,1,'At 28 uncovered messages, exactly one background summary request');
const stored=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;assert.equal(stored.messages.length,46);assert.equal(stored.lastSummarizedIndex,0);console.log('PASS persisted trigger=28; no premature automatic calls, background only at threshold; 46 raw messages intact');
})().catch(e=>{console.error(e);process.exitCode=1});
