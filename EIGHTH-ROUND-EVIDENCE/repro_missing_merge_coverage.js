'use strict';
const assert=require('node:assert/strict');const path=require('node:path');
const root=path.resolve(process.env.MIMATAVERN_ROOT||path.join(__dirname,'..')),deep=x=>x===undefined?undefined:structuredClone(x),raw=new Map();
function db(){return {close(){},transaction(){let pending=0,finished=false,abort=false;const staged=new Map([...raw].map(([k,v])=>[k,deep(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){abort=true;setImmediate(()=>tx.onabort?.())}};
const done=()=>{if(finished||abort||pending)return;finished=true;setImmediate(()=>{if(!abort){raw.clear();for(const [k,v]of staged)raw.set(k,deep(v));tx.oncomplete?.();}})};
const obj={get(key){pending++;const req={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{req.result=deep(staged.get(key));req.onsuccess?.();pending--;setImmediate(done)});return req;},put(value,key){staged.set(key,deep(value));return{}},delete(key){staged.delete(key);return{}}};tx.objectStore=()=>obj;return tx;}};}
global.window=global;global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r;}};
global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,y)=>pref.set(x,y)};
require(path.join(root,'local-store.js'));require(path.join(root,'standalone-core.js'));
let handler=()=>'',calls=0;
global.fetch=async(_url,opts)=>{calls++;const payload=JSON.parse(opts.body);const output=handler(payload);return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content:output},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content:output},finish_reason:'stop'}]})};};
const route=(a,b,c)=>MimaStandalone.handle(a,b,c);
(async()=>{
await MimaStandalone.init(); MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',stream:false,contextWindowTokens:32768});
const session=(await route('/sessions','POST',{title:'R7 coverage counterexample'})).data;
const msgs=Array.from({length:60},(_,i)=>({id:'q'+i,role:i%2?'assistant':'user',content:'第'+i+'条剧情：'+('第'+i+'次活动有独立人物、独立时间和独立事件。').repeat(45),rawContent:'第'+i+'条剧情：'+('第'+i+'次活动有独立人物、独立时间和独立事件。').repeat(45),versions:[]}));
await route(`/sessions/${session.id}`,'PATCH',{messages:msgs,promptSettings:{recentMessageLimit:12}});
const seen=[];
handler=payload=>{
 const p=payload.messages.at(-1).content;
 const merge=p.includes('【已校验的分片摘要】');
 const matches=[...p.matchAll(/第(\d+)条剧情/g)];
 const i=merge?0:Number(matches[0]?.[1]||0);
 seen.push({merge,foundIndexes:[...new Set(matches.map(m=>Number(m[1])))].slice(0,12),picked:i});
 return JSON.stringify({memory:msgs[i].content,evidence:[{quote:msgs[i].content}]});
};
const result=await MimaStandalone.runRecordedMemory('rolling',session.id,{}).then(x=>({success:true,data:x})).catch(e=>({success:false,code:e.code,message:e.message}));
const after=(await route(`/sessions/${session.id}`,'GET')).data;
const job=await MimaLocalStore.getMemoryJob(session.id,'rolling');
const output={result:{success:result.success,code:result.code}, calls,stages:seen,rawHistory:after.messages.length,markedSummarized:after.lastSummarizedIndex,summaryMentionsLastIndex:after.rollingSummary.includes('第41条剧情'),summaryMentionsFirstIndex:after.rollingSummary.includes('第0条剧情'),summaryLength:after.rollingSummary.length,jobStatus:job.status};
console.log(JSON.stringify(output,null,2));
if(result.success&&after.lastSummarizedIndex>=40&&!after.rollingSummary.includes('第41条剧情')){console.error('FAIL: R8-ROLLING-COVERAGE: merged summary omits last chunk but marks 42 messages covered');process.exitCode=1;} else console.log('PASS: final merged memory does not falsely cover omitted chunk');
})().catch(e=>{console.error(e);process.exitCode=1});
