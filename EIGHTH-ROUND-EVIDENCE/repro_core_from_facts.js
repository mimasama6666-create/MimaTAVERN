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
await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'http://localhost:4009/v1',model:'mock',stream:false,contextWindowTokens:32768});
const s=(await route('/sessions','POST',{title:'Core from verified facts'})).data;
const messages=[{id:'o0',role:'user',content:'清晨，他们在塔顶见面。',rawContent:'清晨，他们在塔顶见面。',versions:[]},{id:'o1',role:'assistant',content:'对方交付了钥匙，结束约会。',rawContent:'对方交付了钥匙，结束约会。',versions:[]}];
const fact='玩家和塔主在清晨约定一起守护铜制钥匙。';
const manualMemory={core:{content:''},facts:[{id:'verified1',startRound:1,endRound:1,content:fact,verification:{status:'human_confirmed',stage:'user_manual_edit'}}]};
const patched=await route(`/sessions/${s.id}`,'PATCH',{messages,manualMemory});
console.log('fact loaded',patched.data.manualMemory.facts.map(x=>x.verification));
handler=()=>JSON.stringify({memory:fact,evidence:[{quote:fact}]});
const result=await route(`/sessions/${s.id}/memory/core`,'POST',{source:'facts'});
const after=(await route(`/sessions/${s.id}`,'GET')).data;
console.log(JSON.stringify({success:result.success,code:result.code,details:result.details,core:after.manualMemory.core.content,job:(await MimaLocalStore.getMemoryJob(s.id,'core')).status},null,2));
if(!result.success){console.error('FAIL: R8-CORE-TRUSTED-FACTS: verified fact quote refused');process.exitCode=1;} else console.log('PASS: verified facts may be consolidated to core memory');
})().catch(e=>{console.error(e);process.exitCode=1});