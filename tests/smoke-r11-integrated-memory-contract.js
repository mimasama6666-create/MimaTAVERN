'use strict';
// Canonical-source contract, normal paraphrases, repeated independent events,
// and adaptive fact request. Isolated fake Provider/DB; NOT a real API test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const code=fs.readFileSync(path.join(root,'standalone-core.js'),'utf8');
const isolated={window:{},TextEncoder,console};
vm.runInNewContext(code.replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window._ledger=sourceEventLedger;window._check=validateMemoryCandidate;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});'),isolated);
const { _ledger:ledger,_check:check }=isolated.window;
const m=(id,content,role='user')=>({id,content,rawContent:content,role,versions:[]});
const cases=[
 ['艾琳在港口拿到了地图。','艾琳在港口丢掉了地图。',false],
 ['艾琳在港口拿到了地图。','艾琳在港口借走了地图。',false],
 ['艾琳在港口拿到了地图。','艾琳在港口捡到了地图。',true],
 ['小猫咪躲在柜子里。','小猫咪躲在花园里。',false],
 ['阿树答应保守秘密。','阿树没有答应保守秘密。',false],
 ['艾琳获得红色钥匙。','艾琳取得红色钥匙。',true]
];
for(const [source,summary,expected]of cases)assert.equal(ledger([m('m',source)],summary).complete,expected,source+' -> '+summary);
const repetitions=[m('one','艾琳捡起了石头。'),m('two','艾琳捡起了石头。')];
assert.equal(ledger(repetitions,'艾琳捡起了石头。').complete,true,'identical state retransmissions may dedupe');
const separate=[m('day1','艾琳在第1天捡起石头。'),m('day2','艾琳在第2天捡起石头。')];
assert.equal(ledger(separate,'艾琳在第1天捡起石头。').complete,false,'distinct numbered days cannot be merged');
assert.equal(ledger(repetitions,'艾琳捡起了石头。\n艾琳捡起了石头。').complete,true);
const original=['艾琳在港口拿到地图。','阿树捡起石头。'].map((t,i)=>m('r'+i,t));
assert.throws(()=>check([],JSON.stringify({memory:original[0].content,evidence:[{quote:original[0].content}]}),'fact_range_1_1_part_0','stop',true,original),e=>e.code==='E_MEMORY_NEEDS_REVIEW');
assert.equal(check([],JSON.stringify({memory:original[0].content,evidence:[{quote:original[0].content}]}),'core_final_single','stop',true,original).memory,original[0].content);
// Read the planner inside the same VM rather than guessing Provider settings.
const planCode=code.replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window._plan=factOutputPlan;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});');
const pctx={window:{},TextEncoder,console};vm.runInNewContext(planCode,pctx);
const longEvents=Array.from({length:24},(_,i)=>m('e'+i,`艾琳记录第${i+1}封信。`));
const plan=pctx.window._plan(longEvents,360);
assert.equal(plan.canonicalClauses,24);assert(plan.advisedChars>=1104,JSON.stringify(plan));assert.equal(plan.requestedChars,360);
const short=pctx.window._plan([m('x','艾琳打开箱子。')],360);assert.equal(short.advisedChars,360);
console.log('PASS memory source frame, 2 occurrences, selective-core/fact separation, 24-event target planner');
