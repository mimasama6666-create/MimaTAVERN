'use strict';
const assert=require('node:assert/strict');const path=require('node:path');
const root=path.resolve(__dirname,'..'),deep=x=>x===undefined?undefined:structuredClone(x),raw=new Map();
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
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',stream:false,contextWindowTokens:32768});
 const summary=[];
 for(const size of [10,50,200,500]){
   const sess=(await route('/sessions','POST',{title:'R7 normal-memory-'+size})).data;
   const text=Array.from({length:size},(_,i)=>`第${i}条剧情：角色${i%4}找到了地图碎片${i}，答应守护这段旅程。`);
   await route(`/sessions/${sess.id}`,'PATCH',{messages:text.map((t,i)=>({id:'msg'+size+'-'+i,role:i%2?'assistant':'user',content:t,rawContent:t,versions:[]}))});
   let requestCount=0;
   handler=payload=>{requestCount++;const prompt=payload.messages.at(-1).content;
     const matches=[...prompt.matchAll(/第(\d+)条剧情/g)];const i=Math.min(size-1,Number(matches[0]?.[1]||0));
     const quote=text[i];return JSON.stringify({memory:quote,evidence:[{quote}]});
   };
   const start=performance.now();const result=await route(`/sessions/${sess.id}/memory/core`,'POST',{source:'context'});const took=Math.round(performance.now()-start);
   assert.equal(result.success,true,JSON.stringify({size,result}));
   assert(result.data.manualMemory.core.content.includes('地图碎片'));
   assert.equal(result.data.messages.length,size);
   const job=await MimaLocalStore.getMemoryJob(sess.id,'core');assert.equal(job.status,'committed');
   summary.push({messages:size,requests:requestCount,elapsedMs:took,sourceMessagesRetained:result.data.messages.length,manualReview:0,memoryStored:true});
 }
 console.log(JSON.stringify({environment:'Node offline fake IndexedDB and synthetic cited JSON Provider (NOT actual model success-rate evidence)',summary},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
