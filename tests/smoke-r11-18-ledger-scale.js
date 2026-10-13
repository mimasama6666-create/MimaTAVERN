'use strict';
// Pure offline coverage-performance sample, not provider or IndexedDB benchmark.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const source=fs.readFileSync(path.resolve(__dirname,'../standalone-core.js'),'utf8');
const ctx={window:{},TextEncoder,console};
vm.runInNewContext(source.replace('window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});','window.__ledger=sourceEventLedger;window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});'),ctx);
const result=[];
for(const count of [100,500,1000,3000]){
 const entries=Array.from({length:count},(_,i)=>({id:'event-'+i,role:'user',content:`第${i}条剧情：角色${i%4}在档案室找到物品${i}，与同伴讨论它的用途。`,rawContent:`第${i}条剧情：角色${i%4}在档案室找到物品${i}，与同伴讨论它的用途。`}));
 console.log('SCALE_START',count);const complete=entries.map(x=>x.content).join('\n');const start=performance.now(),proof=ctx.window.__ledger(entries,complete),ms=Math.round(performance.now()-start);
 assert.equal(proof.complete,true,'all original events must remain verifiable');assert.equal(proof.covered.length,count);
 console.log('SCALE_COMPLETE',count,ms);
 const dropped=ctx.window.__ledger(entries,entries.slice(1).map(x=>x.content).join('\n'));
 console.log('SCALE_MISSING_REJECTED',count);
 assert.equal(dropped.complete,false,'missing original first event must not pass');
 result.push({events:count,completeCoverageMs:ms,missingEventRejected:!dropped.complete,units:proof.expected});
}
console.log(JSON.stringify({environment:'Node deterministic event-ledger sample, not Provider/browser',result},null,2));
