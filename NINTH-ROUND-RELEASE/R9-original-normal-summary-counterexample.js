'use strict';
const path=require('node:path');
const root=path.resolve(process.env.MIMATAVERN_ROOT);
const assert=require('node:assert/strict');
const cp=x=>x===undefined?undefined:structuredClone(x);
const data=new Map();
function db(){return{close(){},transaction(){let n=0,ended=false,aborted=false;const copy=new Map([...data].map(([k,v])=>[k,cp(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(ended||aborted||n)return;ended=true;setImmediate(()=>{if(!aborted){data.clear();for(const [k,v]of copy)data.set(k,cp(v));tx.oncomplete?.();}})}const obj={get(k){n++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=cp(copy.get(k));r.onsuccess?.();n--;setImmediate(done)});return r;},put(v,k){copy.set(k,cp(v));return{}},delete(k){copy.delete(k);return{}}};tx.objectStore=()=>obj;return tx;}}}
global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,y)=>pref.set(x,y)};
require(path.join(root,'local-store.js'));require(path.join(root,'standalone-core.js'));
let calls=0,outputs=[];
global.fetch=async (_url,opts)=>{calls++;const body=JSON.parse(opts.body);outputs.push(body.messages?.at(-1)?.content?.slice(0,70)); const content=JSON.stringify({memory:'玩家和守卫连续二十四天将收到的求援信封存到档案室，并反复确认封条完好。',evidence:[{quote:messages[0].content},{quote:messages[23].content}]});return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]})};};
const messages=Array.from({length:42},(_,i)=>({id:'day-'+i,role:i%2?'assistant':'user',content:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,rawContent:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,versions:[]}));
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://127.0.0.1:5999/v1',model:'local-test',stream:false,contextWindowTokens:32768});
 const s=(await MimaStandalone.handle('/sessions','POST',{title:'日常正常摘要兼容测试'})).data;
 await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
 const result=await MimaStandalone.runRecordedMemory('rolling',s.id,{}).then(v=>({ok:true,cursor:v.lastSummarizedIndex})).catch(e=>({ok:false,code:e.code,reason:e.message}));
 const stored=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;
 const job=await MimaLocalStore.getMemoryJob(s.id,'rolling');
 console.log(JSON.stringify({result,historyLength:stored.messages.length,summaryCursor:stored.lastSummarizedIndex,summaryLength:stored.rollingSummary.length,jobStatus:job.status,requests:calls,sourceChars:messages.slice(0,24).map(x=>x.content).join('').length,normalSummaryChars:'玩家和守卫连续二十四天将收到的求援信封存到档案室，并反复确认封条完好。'.length,checkpoints:job.checkpoints.map(x=>({stage:x.stage,reason:x.reason,missingCount:x.missingCount}))},null,2));
 assert.equal(stored.messages.length,42);assert.equal(stored.lastSummarizedIndex,0);assert.equal(job.status,'needs_review');
 console.log('REPRODUCED: faithful compact multi-event summary stays review, no automatic rolling memory commit');
})().catch(e=>{console.error(e);process.exitCode=1})
