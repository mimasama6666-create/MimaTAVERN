'use strict';
const assert=require('node:assert/strict');
const WI=require('../compat-runtime.js');
const e=(id,key,content,extra={})=>({uid:id,key,content,position:0,...extra});
const hist=(content)=>[{role:'user',content}];
let report=WI.worldInfo([
 e('a','seed','The AURORA says EMERALD'),
 e('b','EMERALD','Linked fact'),
 e('c','MISSING','Unrelated')
],hist('seed'),{recursiveScan:true,maxRecursionSteps:4});
assert.deepEqual(report.inserted.map(x=>x.entryId),['a','b']);
assert.equal(report.matched.find(x=>x.entryId==='b').recursionLevel,1);
report=WI.worldInfo([
 e('a','seed','EMERALD',{preventRecursion:true}),e('b','EMERALD','Should not activate')
],hist('seed'),{recursiveScan:true});
assert.deepEqual(report.inserted.map(x=>x.entryId),['a']);
report=WI.worldInfo([
 e('a','seed','EMERALD'),e('b','EMERALD','Should not activate',{excludeRecursion:true})
],hist('seed'),{recursiveScan:true});
assert.deepEqual(report.inserted.map(x=>x.entryId),['a']);
report=WI.worldInfo([
 e('a','seed','EMERALD'),e('b','EMERALD','Recursive only',{delayUntilRecursion:true})
],hist('seed'),{recursiveScan:true});
assert.deepEqual(report.inserted.map(x=>x.entryId),['a','b']);
assert.deepEqual(WI.worldInfo([e('a','seed','not yet',{delay:2})],hist('seed')).inserted,[]);
assert.deepEqual(WI.worldInfo([e('a','seed','yes',{delay:1})],hist('seed')).inserted.map(x=>x.entryId),['a']);
const gated=WI.worldInfo([e('p','seed','Never',{extensions:{useProbability:true,probability:0}}),e('q','seed','Always',{extensions:{useProbability:true,probability:100}})],hist('seed'));
assert.deepEqual(gated.inserted.map(x=>x.entryId),['q']);
assert(gated.skipped.some(x=>x.entryId==='p'&&x.reason==='probability_zero'));
const probabilistic=WI.worldInfo([e('p','seed','random',{extensions:{useProbability:true,probability:50}})],hist('seed'));
assert(!probabilistic.inserted.length);assert(probabilistic.semanticGaps.length);
const all=WI.worldInfo([e('before','seed','before',{position:2}),e('after','seed','after',{position:3})],hist('seed'));
assert.deepEqual(all.inserted.map(x=>x.position),[2,3]);
const card={kind:'character',raw:{name:'角色',mes_example:'EXAMPLES_HERE'}};
const book={kind:'world_info',raw:{entries:[e('before','seed','BEFORE_EXAMPLES',{position:2}),e('after','seed','AFTER_EXAMPLES',{position:3})]}};
const env=WI.createEnvelope({userName:'玩家',worldInfoScanDepth:5},[card,book],[],'seed');
assert.deepEqual(env.segments.map(x=>x.slot),['world_info_before_examples','mes_example','world_info_after_examples']);
assert.equal(env.messages.at(-1).content,'seed');
assert.deepEqual(WI.worldInfo([e('a','seed','EMERALD'),e('b','EMERALD','Cycle links seed')],hist('seed'),{maxRecursionSteps:9}).inserted.map(x=>x.entryId),['a','b']);
console.log('PASS R11.11 selective World Info recursion, delay, exact probability boundaries, example positions');
