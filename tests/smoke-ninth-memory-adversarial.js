 'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const cp=x=>x===undefined?undefined:structuredClone(x),storage=new Map();
function db(){return{close(){},transaction(){let pending=0,finished=false,aborted=false;const staged=new Map([...storage].map(([k,v])=>[k,cp(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(finished||aborted||pending)return;finished=true;setImmediate(()=>{if(!aborted){storage.clear();for(const [k,v]of staged)storage.set(k,cp(v));tx.oncomplete?.();}})}const store={get(k){pending++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=cp(staged.get(k));r.onsuccess?.();pending--;setImmediate(done)});return r;},put(v,k){staged.set(k,cp(v));return{}},delete(k){staged.delete(k);return{}}};tx.objectStore=()=>store;return tx;}}}
global.window=global;global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,v)=>pref.set(x,v)};
require('../local-store.js');require('../standalone-core.js');
const normal='玩家和守卫连续二十四天将收到的求援信封存到档案室，并反复确认封条完好。';
let payload=normal,code=200,requests=0;
global.fetch=async()=>{requests++;if(code!==200)return{ok:false,status:code,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({error:{message:'test '+code}})};const value=payload;return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content:value},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content:value},finish_reason:'stop'}]})}};
const route=(a,b,c)=>MimaStandalone.handle(a,b,c);
const dayMessages=Array.from({length:42},(_,i)=>({id:'day-'+i,role:i%2?'assistant':'user',content:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,rawContent:`第${i+1}天，玩家和守卫一起将第${i+1}封求援信放进档案室，清点信封并确认封条完好。`,versions:[]}));
const message=(id,content)=>({id,role:'user',content,rawContent:content,versions:[]});
async function examine(label,messages,result,expectedCode='',apiCode=200){
 const s=(await route('/sessions','POST',{title:label})).data;
 await route(`/sessions/${s.id}`,'PATCH',{messages,promptSettings:{recentMessageLimit:12}});
 payload=result;code=apiCode;
 const before=requests;
 const ran=await MimaStandalone.runRecordedMemory('rolling',s.id,{}).then(v=>({ok:true,cursor:v.lastSummarizedIndex})).catch(e=>({ok:false,code:e.code}));
 const stored=(await route(`/sessions/${s.id}`,'GET')).data;
 const job=await MimaLocalStore.getMemoryJob(s.id,'rolling');
 assert.equal(stored.messages.length,messages.length,label+' History preserved');
 if(expectedCode){assert.equal(ran.ok,false,label+' should reject');assert.equal(ran.code,expectedCode,label+' error code');assert.equal(stored.lastSummarizedIndex,0,label+' false cursor');assert.equal(stored.rollingSummary,'',label+' no false summary');}
 else{assert.equal(ran.ok,true,JSON.stringify({label,ran}));assert.equal(stored.lastSummarizedIndex,24,label+' cursor');assert.equal(stored.rollingSummary,result.startsWith('{')?JSON.parse(result).memory:result,label+' text');assert.equal(job.status,'committed');}
 console.log('PASS',label,{code:ran.code||'committed',requests:requests-before,cursor:stored.lastSummarizedIndex,job:job.status});
}
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://127.0.0.1:5000/v1',model:'mock',stream:false,contextWindowTokens:32768});
 const evidence=[{quote:dayMessages[0].content},{quote:dayMessages[23].content}];
 await examine('normal JSON paraphrase',dayMessages,JSON.stringify({memory:normal,evidence}));
 await examine('normal plain text paraphrase',dayMessages,normal);
 await examine('wrong series count',dayMessages,JSON.stringify({memory:normal.replace('二十四','二十三'),evidence}),'E_MEMORY_NEEDS_REVIEW');
 await examine('omits other days',dayMessages,JSON.stringify({memory:dayMessages[0].content,evidence}),'E_MEMORY_NEEDS_REVIEW');
 await examine('invented destruction',dayMessages,JSON.stringify({memory:normal+'守卫随后烧毁了所有信件。',evidence}),'E_MEMORY_NEEDS_REVIEW');
 const rumors=Array.from({length:42},(_,i)=>message('rumor'+i,`第${i+1}天，守卫听说国王已经遇难，但没有证据证实此传闻。`));
 await examine('rumor promoted to fact',rumors,'守卫连续二十四天确认国王已经遇难。','E_MEMORY_NEEDS_REVIEW');
 const refused=Array.from({length:42},(_,i)=>message('ref'+i,`第${i+1}天，玩家拒绝答应守卫偷走钥匙。`));
 await examine('refusal inverted',refused,'玩家连续二十四天同意守卫偷走钥匙。','E_MEMORY_NEEDS_REVIEW');
 await examine('429 failed no cursor',dayMessages,normal,'E_API_HTTP_429',429);
 await examine('400 failed no cursor',dayMessages,normal,'E_API_HTTP_400',400);
})().catch(e=>{console.error(e);process.exitCode=1});
