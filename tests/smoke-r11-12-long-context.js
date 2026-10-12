'use strict';
const assert=require('node:assert/strict');
global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');
const R=require('../compat-runtime.js');
const card={id:'card',kind:'character',raw:{name:'雅尔',description:'守护古老城堡的探索者。'}};
const config={contextWindowTokens:1000000,maxTokens:2048};
global.MimaStandalone={getApiConfig:()=>config};
(async()=>{
 for(const n of [100,1000,3000]){
  const msgs=Array.from({length:n},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',canonicalContent:(i===0?'琥珀机关 位于图书馆最北侧 不能移动':'普通城堡剧情'+i+'安静地向前行走'.repeat(28)),status:'committed'}));
  const before=JSON.stringify(msgs);
  const broad=await R.createEnvelopeAsync({id:'long-context',turnIndex:n/2},[card],msgs,'请继续琥珀机关的探索');
  assert.equal(broad.contextTrace.allHistoryIncluded,true,'1M context retains all '+n+' original messages');
  assert.equal(broad.historyMessageIndices.length,n,'request includes all '+n+' history messages');
  assert.equal(JSON.stringify(msgs),before,'canonical history unchanged under broad config');
  config.contextWindowTokens=8192;
  const narrow=await R.createEnvelopeAsync({id:'long-context',turnIndex:n/2},[card],msgs,'请继续琥珀机关的探索');
  assert(narrow.contextTrace.temporarilyOmittedCount>0,'8K projection must trim old request-only history');
  assert(narrow.contextTrace.remainingOmittedCount>0,'8K genuinely bounded');
  assert(narrow.contextTrace.estimatedInputTokens<8192,'8K estimated capacity respected');
  assert.equal(JSON.stringify(msgs),before,'8K trimming must never mutate canonical History');
  assert(narrow.messages.some(m=>m.content.includes('请继续琥珀机关的探索')));
  config.contextWindowTokens=1000000;
  console.log(`PASS long context ${n} messages: 1M full, 8K request-only trim; no Store mutations`);
 }
})().catch(e=>{console.error(e);process.exitCode=1});
