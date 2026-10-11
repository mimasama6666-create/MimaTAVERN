'use strict';
const root=process.env.MIMA_SOURCE_ROOT || process.cwd();
global.window=global;global.MimaThemeEngine={apply:()=>{},normalizeSettings:x=>x};global.localStorage={getItem:()=>null,setItem:()=>{}};
const mem=new Map(); const copy=x=>x===undefined?undefined:structuredClone(x);
global.indexedDB={open(){const req={result:{close(){},transaction(){let pending=0,done=false,aborted=false;const staged=new Map([...mem].map(([k,v])=>[k,copy(v)]));const tx={oncomplete:null,onabort:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};const maybe=()=>{if(done||aborted||pending)return;done=true;setImmediate(()=>{if(!aborted){mem.clear();for(let [k,v] of staged)mem.set(k,copy(v));tx.oncomplete?.()}})};const store={get(k){pending++;const r={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{r.result=copy(staged.get(k));r.onsuccess?.();pending--;setImmediate(maybe)});return r},put(v,k){staged.set(k,copy(v))},delete(k){staged.delete(k)}};tx.objectStore=()=>store;return tx}}};setImmediate(()=>req.onsuccess?.());return req}};
require(root+'/local-store.js');require(root+'/standalone-core.js');
(async()=>{
 await MimaStandalone.init();let ss=(await MimaStandalone.handle('/sessions','POST',{title:'长篇模拟'})).data;
 for(let n of [30,100,200,500]){
 let msg=Array.from({length:n*2},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'固定的长剧情测试文本；'+('一段真实剧情的角色行动和详细对白'.repeat(30)),rawContent:'固定的长剧情测试文本；'+('一段真实剧情的角色行动和详细对白'.repeat(30)),versions:[]}));
 const r=await MimaStandalone.handle('/sessions/'+ss.id,'PATCH',{messages:msg,promptSettings:{recentMessageLimit:12}});
 if(!r.success)throw new Error(JSON.stringify(r));
 const p=(await MimaStandalone.handle('/sessions/'+ss.id+'/prompt-preview','POST')).data;
 console.log(JSON.stringify({rounds:n,estimatedInputTokens:p.estimatedInputTokens,rawMessagesInPrompt:p.recentMessageCount,configuredRecentLimit:p.recentMessageLimit,unsummarizedGapCount:p.unsummarizedGapCount,systemChars:p.systemChars}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
