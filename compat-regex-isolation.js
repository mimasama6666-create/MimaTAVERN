/* Enforced killable worker; no main-thread fallback for untrusted expressions. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatRegexIsolation=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';
function fail(code,message,details={}){return Object.assign(new Error(message),details,{code});}
function resolveWorker(){
  if(typeof window!=='undefined'&&typeof Worker!=='undefined'){if(root.location?.protocol==='file:')throw fail('E_WORKER_FILE_ORIGIN','本地 file:// 打开无法安全启动正则 Worker。请上传 Git 网页版并从 HTTPS 链接游玩；此次未执行正则，也未改动剧情。');if(typeof Worker!=='undefined')return new Worker(new URL('./compat-regex-worker.js?advanced=redesign-20261014-1&r14=20261015-1',document.baseURI),{name:'mima-compat-regex'});}
  if(typeof require==='function'){const wt=require('node:worker_threads'),path=require('node:path');return new wt.Worker(path.join(__dirname,'compat-regex-worker.js'));}
  throw fail('E_REGEX_ISOLATION_UNAVAILABLE','此环境无可终止的 Worker，外来正则不能执行');
}
function apply(input,rules,phase,options={}){
  return run([{input:String(input),phase,options}],rules,options).then(out=>{const item=out[0];if(!item.ok)throw fail(item.error.code,item.error.message,{...item.error,result:item.result});return item.result;});
}
function applyBatch(items,rules,options={}){return run(items,rules,options);}
function run(items,rules,options={}){
  if(!Array.isArray(rules)||!rules.length||!items.some(x=>rules.some(r=>r&&!r.disabled&&Array.isArray(r.placement)&&r.placement.includes(x.phase))))return Promise.resolve(items.map(x=>({ok:true,result:{output:String(x.input),trace:[]}})));
  const budgetMs=Math.max(40,Math.min(5000,Number(options.budgetMs??Math.min(3500,250+items.length*8))));
  let worker;try{worker=resolveWorker();}catch(e){return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
    let settled=false;const cleanup=()=>{if(settled)return false;settled=true;clearTimeout(timer);options.signal?.removeEventListener?.('abort',onAbort);worker.removeEventListener?.('message',onMessage);worker.removeEventListener?.('error',onError);worker.removeAllListeners?.('message');worker.removeAllListeners?.('error');worker.terminate();return true;};
    const onAbort=()=>{if(cleanup())reject(fail('E_REGEX_ABORTED','正则任务已取消，原文仍可查看'));};
    const onMessage=e=>{if(!cleanup())return;const packet=e?.data??e;if(packet.ok)resolve(packet.results);else reject(fail(packet.error?.code||'E_REGEX_PHASE_UNSUPPORTED',packet.error?.message||'正则执行失败'));};
    const onError=e=>{if(cleanup())reject(fail('E_REGEX_WORKER_FAILED','正则隔离进程失败：'+(e?.message||e)))};
    const timer=setTimeout(()=>{if(cleanup())reject(fail('E_REGEX_BUDGET','正则隔离执行超过 '+budgetMs+'ms，已终止 Worker；原文保留'));},budgetMs);
    if(typeof worker.addEventListener==='function'){worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);}
    else{worker.on('message',onMessage);worker.on('error',onError);}
    if(options.signal?.aborted){onAbort();return;}options.signal?.addEventListener?.('abort',onAbort,{once:true});
    worker.postMessage({batch:items.map(item=>({input:String(item.input),phase:item.phase,options:{isMarkdown:!!(item.options?.isMarkdown??options.isMarkdown),isPrompt:!!(item.options?.isPrompt??options.isPrompt),isEdit:!!(item.options?.isEdit??options.isEdit),depth:item.options?.depth??options.depth,macroContext:item.options?.macroContext??options.macroContext??{}}})),rules});
  });
}
return Object.freeze({apply,applyBatch});
});
