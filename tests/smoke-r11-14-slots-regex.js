'use strict';
const assert=require('node:assert/strict');
global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');
const runtime=require('../compat-runtime.js');
(async()=>{
 const source='sha256:'+'a'.repeat(64),outside='sha256:'+'b'.repeat(64);
 const card={id:'char',kind:'character',sourceId:source,raw:{name:'Luna',description:'secret char detail',scenario:'S_SCENE',first_mes:'Hi'}};
 const wi={id:'w',kind:'world_info',sourceId:source,raw:{entries:[{uid:1,position:0,constant:true,content:'secret before'},{uid:2,position:1,constant:true,content:'secret after'}]}};
 const regex={id:'r',kind:'regex',sourceId:source,raw:[
  {placement:[5],findRegex:'/secret/g',replaceString:'LORE'},
  {placement:[1],findRegex:'/secret/g',replaceString:'USER'}]};
 const p={id:'p',kind:'prompt_presets',sourceId:outside,path:'p',raw:{prompts:[{identifier:'main',role:'system',content:'WRITER_RULE'}],prompt_order:[{character_id:100000,order:[{identifier:'main',enabled:true},{identifier:'worldInfoBefore',enabled:true},{identifier:'charDescription',enabled:true},{identifier:'worldInfoAfter',enabled:true},{identifier:'chatHistory',enabled:true}]}]}};
 const resources=[card,wi,regex,p],old=JSON.stringify(resources);
 const s={id:'s',sourceId:source,experimentalChatHistorySlot:true,mountGraph:[{enabled:true,resourceId:'p',sourceId:outside,kind:'prompt_presets',trustedCreativeRole:true}]};
 const result=await runtime.createEnvelopeAsync(s,resources,[{status:'committed',role:'assistant',canonicalContent:'past'}],'secret');
 const joined=result.messages.map(m=>m.content).join('\n');
 for(const phrase of ['LORE before','LORE after','secret char detail','USER','WRITER_RULE'])
  assert(joined.includes(phrase),phrase);
 assert(!joined.includes('secret before')&&!joined.includes('secret after'),'untransformed lore must not be duplicated in other projections');
 assert.equal(joined.split('LORE before').length-1,1);
 assert.equal(joined.split('LORE after').length-1,1);
 assert.equal(joined.split('secret char detail').length-1,1);
 assert(result.messages.find(m=>m.presetDynamicMarker==='charDescription').content.includes('secret char detail'));
 assert(result.messages.find(m=>m.presetDynamicMarker==='worldInfoAfter').content.includes('LORE after'));
 assert.deepEqual(result.historyMessageIndices.map(i=>result.messages[i].content),['past']);
 assert(JSON.stringify(resources)===old,'must not change canonical resource');
 console.log('PASS R11.14 dynamic slots + async World Info regex: no stale projection, no card regex mutation, History intact');
})().catch(e=>{console.error(e);process.exitCode=1});
