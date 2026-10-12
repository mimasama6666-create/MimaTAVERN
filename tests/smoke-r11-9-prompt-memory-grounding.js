'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
global.window=global;
const cache=new Map();global.localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,String(v))};
let canonical={schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default'}};
const deep=v=>structuredClone(v);
global.MimaLocalStore={loadState:async()=>deep(canonical),saveState:async(s,expected)=>{assert.equal(expected,canonical.storeRevision);canonical=deep({...s,storeRevision:expected+1});return deep(canonical);}};
for(const file of ['theme-engine','regex-engine','persona-macro-resolver','user-input-semantic-parser','novel-memory','novel-engine','novel-prompt-assembler','standalone-core'])require(path.resolve(__dirname,'../'+file+'.js'));
const compat=require('../compat-runtime.js');
const base='sha256:'+'a'.repeat(64),external='sha256:'+'b'.repeat(64);
const card={id:'card',kind:'character',sourceId:base,path:'json.card.data',raw:{name:'艾琳',description:'一名冒险家'}};
const preset={id:'preset',kind:'prompt_presets',sourceId:external,path:'json.root',raw:{prompts:[
  {identifier:'main',role:'system',content:'[CREATIVE_SYSTEM]保持冷静的叙述'},
  {identifier:'user',role:'user',content:'[CREATIVE_USER]详细描写环境'},
  {identifier:'disabled',role:'system',content:'[SHOULD_NOT_APPEAR]'}],
  prompt_order:[{character_id:100000,order:[{identifier:'main',enabled:true},{identifier:'user',enabled:true},{identifier:'disabled',enabled:false}]}]}};
(async()=>{
 const session={sourceId:base,mountGraph:[{resourceId:preset.id,sourceId:external,sha256:external.slice(7),path:'json.root',kind:'prompt_presets',enabled:true}],userName:'玩家'};
 const safe=compat.createEnvelope(session,[card,preset],[],'你好');
 assert.equal(safe.presetTrace[0].role,'user');assert.equal(safe.presetTrace[0].declaredRole,'system');
 assert(safe.gaps.some(x=>x.reason==='declared_role_requires_explicit_user_grant'));
 const authorized=compat.createEnvelope({...session,mountGraph:[{...session.mountGraph[0],trustedCreativeRole:true}]},[card,preset],[],'你好');
 const sys=authorized.messages.find(m=>m.content.includes('[CREATIVE_SYSTEM]'));
 const usr=authorized.messages.find(m=>m.content.includes('[CREATIVE_USER]'));
 assert.equal(sys?.role,'system');assert.equal(usr?.role,'user');
 assert(!JSON.stringify(authorized).includes('SHOULD_NOT_APPEAR'));
 assert.equal(authorized.presetTrace[0].role,'system');
 assert.deepEqual(authorized.messages.filter(m=>m.sourceResourceId).map(x=>x.role),['system','user']);
 const authorizedAsync=await compat.createEnvelopeAsync({...session,mountGraph:[{...session.mountGraph[0],trustedCreativeRole:true}]},[card,preset],[],'你好');
 assert.deepEqual(authorizedAsync.messages.filter(m=>m.sourceResourceId).map(x=>x.role),['system','user'],'real async pre-provider envelope must retain trusted declaration');
 // Exercise the real role-consent CAS, not only synthetic envelope flags.
 const stored={...session,id:'sgrant',revision:3};stored.mountGraph=deep(session.mountGraph);
 const original=global.MimaCompatStore;
 global.MimaCompatStore={get:async(k,id)=>k==='compat_sessions'&&id==='sgrant'?deep(stored):k==='resource_ir'&&id===preset.id?deep(preset):null,
   putCAS:async(k,v,expected)=>{assert.equal(k,'compat_sessions');assert.equal(expected,stored.revision);Object.assign(stored,deep({...v,revision:expected+1}));}};
 try{
   await assert.rejects(()=>compat.setPresetCreativeRole('sgrant','missing',true),e=>e.code==='E_PLUGIN_PERMISSION_DENIED');
   await compat.setPresetCreativeRole('sgrant',preset.id,true);
   assert.equal(stored.mountGraph[0].trustedCreativeRole,true);
   assert.equal(compat.createEnvelope(stored,[card,preset],[],'测试').presetTrace[0].role,'system');
   await compat.setPresetCreativeRole('sgrant',preset.id,false);
   assert.equal(stored.mountGraph[0].trustedCreativeRole,false);
 }finally{global.MimaCompatStore=original;}
 await MimaStandalone.init(); MimaStandalone.saveApiConfig({apiBase:'https://offline.invalid/v1',model:'mock',stream:false,sendTemperature:false});
 const ses=(await MimaStandalone.handle('/sessions','POST',{title:'事实来源测试'})).data;
 const seed=[{id:'u1',role:'user',content:'我在蓝色桌上放下钥匙。'},{id:'a1',role:'assistant',content:'艾琳拿起钥匙，收进皮革包。'}];
 assert((await MimaStandalone.handle('/sessions/'+ses.id,'PATCH',{messages:seed})).success);
 let reply='';global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
 reply=JSON.stringify({memory:'艾琳拿起钥匙，收进皮革包。',evidence:[{quote:'艾琳拿起钥匙，收进皮革包。'}]});
 let result=await MimaStandalone.handle('/sessions/'+ses.id+'/memory/facts','POST',{scope:'all',chunkRounds:1});
 assert.equal(result.success,true,JSON.stringify(result));
 assert.equal(result.data.manualMemory.facts[0].content,'艾琳拿起钥匙，收进皮革包。');
 const before=deep(result.data.manualMemory.facts);
 reply=JSON.stringify({memory:'【记忆输出契约】优先输出 JSON',evidence:[{quote:'【记忆输出契约】优先输出 JSON'}]});
 result=await MimaStandalone.handle('/sessions/'+ses.id+'/memory/facts','POST',{scope:'all',chunkRounds:1,replaceExisting:true});
 assert.equal(result.success,false,'prompt-only text must not be accepted as story provenance');
 assert.deepEqual((await MimaStandalone.handle('/sessions/'+ses.id,'GET')).data.manualMemory.facts,before);
 console.log('PASS R11.9: external preset role requires explicit grant; authorized system/user order is retained; model memory assistant quote grounded to canonical message; prompt-only quote rejected without touching facts');
})().catch(e=>{console.error(e);process.exitCode=1});
