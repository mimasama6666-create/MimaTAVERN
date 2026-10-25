/* Shared killable worldbook matcher for story, memory and novel. */
(()=>{'use strict';
 const fail=(code,message)=>Object.assign(new Error(message),{code});
 async function evaluate(entries,messages,{signal,budgetMs=2200}={}){
  if(!Array.isArray(entries)||!Array.isArray(messages))throw fail('E_WORLDBOOK_INPUT_INVALID','世界书匹配参数无效');
  if(!entries.length)return [];
  if(typeof Worker!=='function'||typeof document==='undefined'||location.protocol==='file:')throw fail('E_WORLDBOOK_ISOLATION_UNAVAILABLE','浏览器没有可用的世界书隔离线程，未发送生成请求');
  const packet={entries,messages:messages.map(x=>String(x??''))};
  let size;try{size=JSON.stringify(packet).length;}catch(e){throw fail('E_WORLDBOOK_INPUT_INVALID','世界书资料无法序列化：'+e.message);}
  if(size>16*1024*1024)throw fail('E_WORLDBOOK_INPUT_LIMIT','世界书隔离输入超过 16MiB；没有删减源资料');
  return new Promise((resolve,reject)=>{
   let worker,timer,finished=false;
   const cleanup=()=>{if(finished)return false;finished=true;clearTimeout(timer);signal?.removeEventListener?.('abort',abort);worker?.terminate();return true;};
   const abort=()=>{if(cleanup())reject(fail('E_WORLDBOOK_ABORTED','世界书匹配已取消'))};
   try{worker=new Worker(new URL('./worldbook-match-worker.js?wb=20261025-r4',document.baseURI),{name:'mima-worldbook-match'});}
   catch(e){reject(fail('E_WORLDBOOK_ISOLATION_UNAVAILABLE','世界书线程加载失败：'+String(e.message||e)));return;}
   worker.onmessage=e=>{if(!cleanup())return;const packet=e.data;if(packet?.ok&&Array.isArray(packet.results)&&packet.results.length===entries.length)resolve(packet.results);else reject(fail('E_WORLDBOOK_MATCH_FAILED',packet?.error||'匹配结果无效'));};
   worker.onerror=e=>{if(cleanup())reject(fail('E_WORLDBOOK_MATCH_FAILED','世界书隔离执行失败：'+String(e?.message||e)));};
   timer=setTimeout(()=>{if(cleanup())reject(fail('E_REGEX_BUDGET','世界书匹配超过 '+budgetMs+'ms，线程已经终止，没有跳过规则发送请求'));},Math.max(250,Math.min(8000,Number(budgetMs)||2200)));
   if(signal?.aborted){abort();return;}
   signal?.addEventListener?.('abort',abort,{once:true});
   try{worker.postMessage(packet)}catch(e){if(cleanup())reject(fail('E_WORLDBOOK_MATCH_FAILED','世界书线程传参失败：'+e.message));}
  });
 }
 window.MimaWorldbookMatcher=Object.freeze({evaluate});
})();
