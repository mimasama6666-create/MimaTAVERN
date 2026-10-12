'use strict';
const assert=require('node:assert/strict');
const WI=require('../compat-runtime.js');
function entry(uid,key,overrides={}) {return {uid, key:[key],content:'LORE-'+uid,position:0,order:100,...overrides};}
const history=[{role:'user',content:'古塔的密钥在这里'},{role:'assistant',content:'一个普通句子'},{role:'user',content:'新的地点是集市'}];
function selected(entries,opts){return WI.worldInfo(entries,history,opts).inserted.map(x=>x.entryId);}
assert.deepEqual(selected([entry('old','古塔'),entry('new','集市')],{scanDepth:0}),[],'depth=0 MUST NOT scan all history');
assert.deepEqual(selected([entry('always','ignored',{constant:true}),entry('old','古塔')],{scanDepth:0}),['always'],'constant still active with scanDepth=0');
assert.deepEqual(selected([entry('old','古塔'),entry('new','集市')],{scanDepth:1}),['new'],'depth=1 scans last message only');
assert.deepEqual(selected([entry('old','古塔'),entry('new','集市')],{scanDepth:3}),['old','new'],'depth=3 scans all three in fixture');
assert.deepEqual(selected([entry('per0','集市',{extensions:{scan_depth:0}}),entry('per1','集市',{extensions:{scan_depth:1}}),entry('old1','古塔',{extensions:{scan_depth:1}})],{scanDepth:100}),['per1'],'per-entry 0/1 overrides global');
assert.deepEqual(selected([entry('legacy','集市',{scanDepth:0}),entry('modern','集市',{scan_depth:1})]),['modern'],'both stored override spellings work');
const invalid=WI.worldInfo([entry('bad','集市',{extensions:{scan_depth:-1}})],history);
assert.equal(invalid.inserted.length,0);
assert.equal(invalid.skipped[0].reason,'E_RESOURCE_SEMANTIC_GAP');
// Golden enum map pinned to ST 1.19.0 world-info.js (0 AND_ANY, 1 NOT_ALL,
// 2 NOT_ANY, 3 AND_ALL). Test partial and complete secondary-key contexts.
const selective=(logic)=>entry('logic-'+logic,'集市',{selective:true,keysecondary:['集市','钟楼'],selectiveLogic:logic});
assert.deepEqual([0,1,2,3].map(logic=>selected([selective(logic)],{scanDepth:1}).length>0),[true,true,false,false],'one-of-two secondary keys');
const both=[...history,{role:'user',content:'集市旁有钟楼'}];
assert.deepEqual([0,1,2,3].map(logic=>WI.worldInfo([selective(logic)],both,{scanDepth:1}).inserted.length>0),[true,false,false,true],'both secondary keys');
const unknown=WI.worldInfo([selective(99)],history,{scanDepth:1});
assert.equal(unknown.inserted.length,0);
assert.equal(unknown.skipped[0].reason,'E_RESOURCE_SEMANTIC_GAP');

assert.equal(selected([entry('zeroOrder','集市',{order:0}),entry('fifty','集市',{order:50})]).join(','),'zeroOrder,fifty','preserve order=0');
const originally=JSON.stringify(history),fixture=[entry('frozen','集市')];WI.worldInfo(fixture,history,{scanDepth:1});
assert.equal(JSON.stringify(history),originally,'no rewrite of canonical history');
assert.deepEqual(selected([entry('prefix','玩家')],{scanDepth:1,userName:'玩家',charName:'角色'}),['prefix'],'ST scan names include the actual userName');
assert.deepEqual(selected([entry('prefix','玩家')],{scanDepth:1,userName:'玩家',includeNames:false}),[],'includeNames=false removes role labels');

assert.equal(fixture[0].extensions,undefined,'worldbook object unmodified');
const envelope=WI.createEnvelope({sourceId:'sha256:source',userName:'玩家'},[{kind:'character',raw:{name:'角色'}},{kind:'world_info',raw:{entries:[entry('current','集市',{extensions:{scan_depth:1}}),entry('disabled','古塔',{extensions:{scan_depth:0}})]}}],history,'现在来集市');
assert(envelope.worldInfo.inserted.some(x=>x.entryId==='current'));
assert(!envelope.worldInfo.inserted.some(x=>x.entryId==='disabled'));
assert(envelope.messages.some(x=>x.content.includes('LORE-current')));
assert(!envelope.messages.some(x=>x.content.includes('LORE-disabled')));
const zeroEnvelope=WI.createEnvelope({sourceId:'sha256:source',userName:'玩家',worldInfoScanDepth:0},[{kind:'character',raw:{name:'角色'}},{kind:'world_info',raw:{entries:[entry('suppressed','集市'),entry('constant','无条件',{constant:true})]}}],history,'现在来集市');
assert.deepEqual(zeroEnvelope.worldInfo.inserted.map(x=>x.entryId),['constant'],'session settings are delivered to the real envelope');

console.log('PASS R11.5 worldbook scan-depth matrix (global zero, per-entry overrides, input immutability, actual request envelope)');
