'use strict';
// R11 contract: exactly the same canonical History, two model capacities.
const assert=require('node:assert/strict');
const cp=x=>x===undefined?undefined:structuredClone(x), dbRecords=new Map();
function fakeDb(){return {
 close(){},
 transaction(){
  let n=0,ended=false,aborted=false;
  const staged=new Map([...dbRecords].map(([k,v])=>[k,cp(v)]));
  const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};
  const done=()=>{if(n||ended||aborted)return;ended=true;setImmediate(()=>{dbRecords.clear();for(const [k,v] of staged)dbRecords.set(k,cp(v));tx.oncomplete?.()})};
  tx.objectStore=()=>({
    get(k){n++;const q={result:undefined,onsuccess:null};setImmediate(()=>{q.result=cp(staged.get(k));q.onsuccess?.();n--;setImmediate(done)});return q;},
    put(v,k){staged.set(k,cp(v))},delete(k){staged.delete(k)}
  });return tx;
 }
}}
global.window=global;global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)};
global.indexedDB={open(){const q={result:fakeDb(),onsuccess:null};setImmediate(()=>q.onsuccess?.());return q}};
require('../local-store.js');require('../standalone-core.js');
(async()=>{
 await MimaStandalone.init();
 const sid=(await MimaStandalone.handle('/sessions','POST',{title:'R11 240轮投影'})).data.id;
 const history=Array.from({length:240},(_,i)=>({id:'r11msg-'+i,role:i%2?'assistant':'user',content:i===2?'第1章艾琳把密室钥匙藏进了海边灯塔，不能告诉对手。':`剧情事件 ${i}。`+'岁月流逝，人物前进，故事仍然保持其细节。'.repeat(42),rawContent:i===2?'第1章艾琳把密室钥匙藏进了海边灯塔，不能告诉对手。':`剧情事件 ${i}。`+'岁月流逝，人物前进，故事仍然保持其细节。'.repeat(42)}));
 assert((await MimaStandalone.handle(`/sessions/${sid}`,'PATCH',{messages:history,promptSettings:{recentMessageLimit:34},lastSummarizedIndex:220,rollingSummary:'剧情发生了很多事情。',rollingSourceCount:220})).success);
 MimaStandalone.saveApiConfig({apiBase:'https://mock.invalid/v1',model:'model-1m',contextWindowTokens:1000000});
 const full=await MimaStandalone.handle(`/sessions/${sid}/prompt-preview`,'POST',{draft:'后来怎样？'});
 assert(full.success,JSON.stringify(full));assert.equal(full.data.contextTrace.allHistoryIncluded,true);
 const texts=full.data.messagePreview.map(m=>m.content).join('\n');
 for(const m of history)assert(texts.includes(m.content),'1M full projection lost source '+m.id);
 assert(!full.data.sections.some(x=>x.name==='story_summary'),'full History must not redundantly insert rolling summary');
 console.log('PASS 1M: 240 canonical History messages all included, no forced recentMessageLimit=34 truncation');
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:8192,maxTokens:1024});
 const trim=await MimaStandalone.handle(`/sessions/${sid}/prompt-preview`,'POST',{draft:'密室钥匙原来在哪？'});
 assert(trim.success,JSON.stringify(trim));assert(trim.data.contextTrace.temporarilyOmittedTurnIds.length>0);
 assert(trim.data.messagePreview.some(m=>m.content.includes(history.at(-1).content)));
 assert(trim.data.contextTrace.retrievedIds.includes('r11msg-2'),'covered old source must remain eligible for original-text retrieval');
 const persisted=(await MimaStandalone.handle(`/sessions/${sid}`,'GET')).data.messages;
 assert.equal(persisted.length,240);assert.deepEqual(persisted.map(x=>x.id),history.map(x=>x.id));
 console.log('PASS 8K: older whole turns only removed from request, covered-source original text retrieved, canonical unchanged');
 // Larger deterministic synthetic chronology: no external model or browser.
 const long=Array.from({length:3000},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',content:'长篇剧情第'+i+'条，天束在图书馆整理文献，继续演绎。'.repeat(4),rawContent:'长篇剧情第'+i+'条，天束在图书馆整理文献，继续演绎。'.repeat(4)}));
 assert((await MimaStandalone.handle(`/sessions/${sid}`,'PATCH',{messages:long,rollingSummary:'',lastSummarizedIndex:0,rollingSourceCount:0})).success);
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:1000000,maxTokens:4096});
 const p3000=await MimaStandalone.handle(`/sessions/${sid}/prompt-preview`,'POST',{draft:'继续'});
 assert(p3000.success,JSON.stringify(p3000).slice(0,1000));
 assert.equal(p3000.data.contextTrace.canonicalHistoryCount,3000);
 assert.equal(p3000.data.contextTrace.allHistoryIncluded,true);
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:8192,maxTokens:1024});
 const small=await MimaStandalone.handle(`/sessions/${sid}/prompt-preview`,'POST',{draft:'图书馆文献最后放在哪里？'});
 assert(small.success,JSON.stringify(small).slice(0,1000));
 assert(small.data.contextTrace.temporarilyOmittedTurnIds.length>1000);
 assert.equal((await MimaStandalone.handle(`/sessions/${sid}`,'GET')).data.messages.length,3000);
 console.log('PASS 3000 messages: 1M full and 8K projected, canonical 3000 messages persist');

})().catch(e=>{console.error(e);process.exitCode=1});
