/* Request evidence hashing. UTF-8 and SHA-256 remain byte-for-byte compatible.
 * Native asynchronous crypto on secure origins; transferred buffers in a local
 * Worker where SubtleCrypto is unavailable. No synchronous SHA on the UI thread.
 */
(function(root){'use strict';
 const scriptUrl=document.currentScript.src;
 let worker=null,nextId=0;const pending=new Map();
 const aborted=()=>new DOMException('操作已取消','AbortError');
 function check(signal){if(signal?.aborted)throw aborted();}
 function hashWorker(){
  if(worker)return worker;
  if(typeof Worker!=='function')throw Error('当前浏览器无法异步核对请求；未发送请求，请使用支持 WebCrypto 或 Worker 的浏览器');
  const current=new Worker(new URL('./request-hash-worker.js?v=20261127-r30',scriptUrl));
  current.onmessage=event=>{
   const packet=event.data,job=pending.get(packet?.id);if(!job)return;
   pending.delete(packet.id);job.cleanup();
   if(packet.error)job.reject(Error(packet.error));
   else if(!/^[0-9a-f]{64}$/.test(packet.sha256||''))job.reject(Error('请求 SHA-256 结果无效'));
   else job.resolve(packet.sha256);
  };
  const fail=()=>{
   current.terminate();if(worker===current)worker=null;
   for(const job of pending.values()){job.cleanup();job.reject(Error('请求哈希线程失败；未采用未核实结果'));}pending.clear();
  };
  current.onerror=fail;current.onmessageerror=fail;worker=current;return current;
 }
 function digestBytes(bytes,{signal}={}){
  check(signal);
  if(!(bytes instanceof Uint8Array))throw new TypeError('SHA-256 requires Uint8Array');
  const subtle=root.crypto?.subtle;
  if(subtle&&typeof subtle.digest==='function')return new Promise((resolve,reject)=>{
   const cancel=()=>{cleanup();reject(aborted());},cleanup=()=>signal?.removeEventListener('abort',cancel);
   signal?.addEventListener('abort',cancel,{once:true});
   subtle.digest('SHA-256',bytes).then(result=>{
    cleanup();if(signal?.aborted){reject(aborted());return;}
    resolve(Array.from(new Uint8Array(result),n=>n.toString(16).padStart(2,'0')).join(''));
   },error=>{cleanup();reject(error);});
  });
  const current=hashWorker();
  return new Promise((resolve,reject)=>{
   const id=++nextId,cleanup=()=>signal?.removeEventListener('abort',cancel);
   const cancel=()=>{pending.delete(id);cleanup();reject(aborted());};
   pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',cancel,{once:true});
   // Only owned complete buffers are transferred; slices get one bounded copy.
   const buffer=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.slice().buffer;
   try{current.postMessage({id,buffer},[buffer]);}catch(error){pending.delete(id);cleanup();reject(error);}
  });
 }
 async function digestText(value,options={}){
  check(options.signal);const bytes=new TextEncoder().encode(String(value)),length=bytes.byteLength;
  return {sha256:await digestBytes(bytes,options),bytes:length};
 }
 async function digestTexts(values,options={}){
  check(options.signal);const result=new Array(values.length);let next=0;
  // Bound temporary encoded buffers and queued Worker work, preserving order.
  await Promise.all(Array.from({length:Math.min(4,values.length)},async()=>{
   while(next<values.length){check(options.signal);const index=next++;result[index]=await digestText(values[index],options);}
  }));return result;
 }
 root.MimaRequestHash=Object.freeze({digestText,digestTexts});
})(window);
