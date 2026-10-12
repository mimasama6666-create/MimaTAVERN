'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=new Map(),copy=x=>x===undefined?undefined:structuredClone(x);
function db(){return{close(){},transaction(){let n=0,ended=false,aborted=false;const snapshot=new Map([...data].map(([k,v])=>[k,copy(v)]));const tx={oncomplete:null,onabort:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())}};function done(){if(ended||aborted||n)return;ended=true;setImmediate(()=>{if(!aborted){data.clear();for(const [k,v]of snapshot)data.set(k,copy(v));tx.oncomplete?.();}})}const obj={get(k){n++;const r={result:undefined,onsuccess:null};setImmediate(()=>{r.result=copy(snapshot.get(k));r.onsuccess?.();n--;setImmediate(done)});return r;},put(v,k){snapshot.set(k,copy(v));return{}},delete(k){snapshot.delete(k);return{}}};tx.objectStore=()=>obj;return tx;}}}
global.window=global;global.indexedDB={open(){const req={result:db(),onsuccess:null};setImmediate(()=>req.onsuccess?.());return req}};global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const pref=new Map();global.localStorage={getItem:x=>pref.get(x)||null,setItem:(x,y)=>pref.set(x,y)};
require(path.join(root,'local-store.js'));require(path.join(root,'standalone-core.js'));
const raw='墨'.repeat(60020),parts=[];
global.fetch=async(url,opt={})=>{
  const prompt=JSON.parse(opt.body).messages.at(-1).content;
  let reply;
  if(prompt.includes('【剧情原文】')){
    const source=prompt.split('【剧情原文】\n')[1].split('\n\n请将上面')[0];
    const longest=Array.from(source.matchAll(/墨+/g)).sort((a,b)=>b[0].length-a[0].length)[0]?.[0]||'';
    assert(longest.length>100,'a part must include original long text');parts.push(longest.length);
    reply=longest;
  }else{reply='墨'.repeat(60);}
  return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:{content:reply},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}]})};
};
(async()=>{await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://127.0.0.1:5999/v1',model:'local-test',stream:false});
  const s=(await MimaStandalone.handle('/sessions','POST',{title:'Long fact exact source fragments'})).data;
  const messages=[{id:'long-user',role:'user',content:raw,rawContent:raw,versions:[]},{id:'short-assistant',role:'assistant',content:'守卫没有回应。',rawContent:'守卫没有回应。',versions:[]}];
  await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{messages});
  try{await MimaStandalone.runRecordedMemory('facts',s.id,{scope:'all',chunkRounds:1});}catch(e){console.log('FACT_ERROR',e.code,e.message,e.details);assert.equal(e.code,'E_MEMORY_NEEDS_REVIEW');}
  const job=await MimaLocalStore.getMemoryJob(s.id,'facts'),verified=job.checkpoints.filter(x=>/^fact_range_1_1_part_\d+_received$/.test(x.stage));
  assert.equal(verified.length,3,JSON.stringify(job.checkpoints.map(x=>x.stage)));
  const anchors=verified.map(x=>x.provenance?.find(y=>y.messageId==='long-user')?.start);
  assert(anchors[0]===0 && anchors[1]>25000 && anchors[2]>50000,JSON.stringify(anchors));
  assert.equal(parts.length,3);
  assert.equal(messages[0].rawContent,raw);
  const live=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;
  assert.equal(live.messages[0].rawContent,raw);
  assert.equal(live.manualMemory.facts.length,0,'no partial fact can be committed as final fact');
  console.log('PASS 60k single utterance split into 3 exact anchored fact parts, offsets',anchors,'no partial canonical commit');
})().catch(e=>{console.error(e);process.exitCode=1});
