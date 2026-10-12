'use strict';
const assert=require('node:assert/strict');global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');const RT=require('../compat-runtime.js');
(async()=>{
 const card={kind:'character',id:'c',raw:{name:'Mirra',description:'secret character info'}};
 const wi={kind:'world_info',id:'w',raw:{entries:[{uid:'lore',key:'secret',content:'secret world detail',position:0},{uid:'inchat',key:'secret',content:'secret at depth',position:4,depth:0}]}};
 const rules={kind:'regex',id:'r',raw:[
   {placement:[1],findRegex:'/secret/g',replaceString:'PLAYER_CHANGED'},
   {placement:[5],findRegex:'/secret/g',replaceString:'LORE_CHANGED'}
 ]};
 const original=JSON.stringify([card,wi,rules]);
 const session={id:'routing-example',sourceId:'sha256:x',worldInfoScanDepth:2};
 const result=await RT.createEnvelopeAsync(session,[card,wi,rules],[],'secret');
 const cardProjection=result.messages.find(m=>m.cardResourceProjection===true);
 assert(cardProjection, 'Static resource projection must be identified');
 assert(cardProjection.content.includes('secret character info'),'user-input regex must not rewrite card text');
 assert(cardProjection.content.includes('LORE_CHANGED world detail'),'World Info phase 5 should transform lore');
 assert(!cardProjection.content.includes('PLAYER_CHANGED character'));
 assert(result.messages.some(m=>m.worldInfoEntryId==='inchat'&&m.content.includes('LORE_CHANGED at depth')));
 assert(result.messages.some(m=>m.role==='user'&&m.content==='PLAYER_CHANGED'),'Only user text receives user-input replacement');
 assert(result.regexTrace.some(t=>t.phase===5),'World Info stage recorded');
 assert(JSON.stringify([card,wi,rules])===original,'immutable raw resource inputs');
 console.log('PASS R11.12 regex routing; static card immune to user regex; WI phase5 and user phase1 separate');
})().catch(e=>{console.error(e);process.exitCode=1});
