/* Optional isolated worker for CCv3 use_regex World Info keys.
 * The established synchronous worldInfo API remains available for non-regex cards.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatWorldInfoIsolation=api;})(typeof window!=='undefined'?window:globalThis,function(root){
 'use strict';
 const fail=(code,message)=>Object.assign(new Error(message),{code});
 function makeWorker(){
  if(typeof window!=='undefined'&&typeof Worker!=='undefined'){if(root.location?.protocol==='file:')throw fail('E_WORKER_FILE_ORIGIN','本地 file:// 打开无法安全启动世界书 Worker。请通过部署后的 HTTPS 地址游玩；不会跳过这次匹配后假装成功。');if(typeof Worker!=='undefined')return new Worker(new URL('./compat-worldinfo-worker.js?v=20261027-f2',document.baseURI),{name:'mima-worldinfo'});}
  if(typeof require==='function'){const wt=require('node:worker_threads'),path=require('node:path');return new wt.Worker(path.join(__dirname,'compat-worldinfo-worker.js'));}
  throw fail('E_REGEX_ISOLATION_UNAVAILABLE','此浏览器不支持世界书正则隔离 Worker');
 }
 function evaluate(entries,history,settings,{signal,budgetMs=1800}={}){
  if(!Array.isArray(entries)||!Array.isArray(history))return Promise.reject(fail('E_WORLDINFO_WORKER_FAILED','世界书参数无效'));
  let serialized;
  try{serialized=JSON.stringify({entries,history,settings});}catch(e){return Promise.reject(fail('E_WORLDINFO_WORKER_FAILED','世界书参数不能安全序列化：'+e.message));}
  if(serialized.length>8*1024*1024)return Promise.reject(fail('E_REGEX_BUDGET','世界书和扫描历史超过隔离配额；未丢弃任何剧情原文'));
  let worker;try{worker=makeWorker();}catch(e){return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
   let finished=false;
   const cleanup=()=>{if(finished)return false;finished=true;clearTimeout(timer);signal?.removeEventListener?.('abort',abort);worker.removeEventListener?.('message',message);worker.removeEventListener?.('error',failure);worker.removeAllListeners?.('message');worker.removeAllListeners?.('error');worker.terminate();return true;};
   const abort=()=>{if(cleanup())reject(fail('E_REGEX_ABORTED','世界书隔离匹配已经取消'));};
   const message=e=>{if(!cleanup())return;const packet=e?.data??e;if(packet?.ok&&packet.result&&Array.isArray(packet.result.inserted))resolve(packet.result);else reject(fail(packet?.error?.code||'E_WORLDINFO_WORKER_FAILED',packet?.error?.message||'世界书结果未被验证'));};
   const failure=e=>{if(cleanup())reject(fail('E_WORLDINFO_WORKER_FAILED',String(e?.message||e)));};
   const timer=setTimeout(()=>{if(cleanup())reject(fail('E_REGEX_BUDGET','世界书正则匹配超出隔离运行预算；没有跳过规则继续生成'));},Math.max(300,Math.min(5000,Number(budgetMs)||1800)));
   if(typeof worker.addEventListener==='function'){worker.addEventListener('message',message);worker.addEventListener('error',failure);}else{worker.on('message',message);worker.on('error',failure);}
   if(signal?.aborted){abort();return;}signal?.addEventListener?.('abort',abort,{once:true});
   worker.postMessage({entries,history,settings});
  });
 }
 return Object.freeze({evaluate});
});
