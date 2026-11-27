/* Exact SHA-256 evidence, with cancellation-owned scheduling and a cooperative
 * local implementation when background crypto cannot be used. */
(function(root){'use strict';
 const scriptUrl=document.currentScript.src;
 let worker=null,active=null,nextId=0,scheduled=false,workerUnavailable=typeof Worker!=='function';
 const queue=[];
 const aborted=()=>new DOMException('操作已取消','AbortError');
 function check(signal){if(signal?.aborted)throw aborted();}
 let channel=null;const turns=new Map();let nextTurn=0;
 const yieldTask=()=>new Promise(resolve=>{
  if(!channel&&typeof MessageChannel==='function'){
   channel=new MessageChannel();channel.port1.onmessage=event=>{const resume=turns.get(event.data);turns.delete(event.data);resume?.();};
  }
  if(channel){const id=++nextTurn;turns.set(id,resolve);channel.port2.postMessage(id);}else setTimeout(resolve,0);
 });
 async function yieldingHash(bytes,signal){
  check(signal);await yieldTask();check(signal);if(!root.MimaSHA256?.create)throw Error('本地 SHA-256 校验组件未加载，未采用未核实结果');
  const hash=root.MimaSHA256.create();
  for(let offset=0;offset<bytes.length;offset+=65536){
   check(signal);hash.update(bytes.subarray(offset,Math.min(offset+65536,bytes.length)));
   if(offset+65536<bytes.length)await yieldTask();
  }
  check(signal);return hash.hex();
 }
 function retire(instance){
  if(!instance)return;instance.thread.onmessage=null;instance.thread.onerror=null;instance.thread.onmessageerror=null;instance.thread.terminate();
  if(worker===instance)worker=null;
 }
 function schedule(){if(scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;pump();});}
 function finish(job,error,value){
  if(job.done)return;job.done=true;job.signal?.removeEventListener('abort',job.cancel);job.bytes=null;
  if(active===job)active=null;
  if(error)job.reject(error);else job.resolve(value);schedule();
 }
 function newWorker(){
  const instance={thread:new Worker(new URL('./request-hash-worker.js?v=20261127-r31',scriptUrl)),ready:false};worker=instance;
  instance.thread.onmessage=event=>{
   if(worker!==instance)return;const packet=event.data;
   if(packet?.type==='ready'){instance.ready=true;schedule();return;}
   const job=active;if(!job||job.worker!==instance||packet?.id!==job.id)return;
   if(packet.error){retire(instance);finish(job,Error(packet.error));}
   else if(!/^[0-9a-f]{64}$/.test(packet.sha256||'')){retire(instance);finish(job,Error('请求 SHA-256 结果无效'));}
   else finish(job,null,packet.sha256);
  };
  const fail=()=>{
   if(worker!==instance)return;const job=active,started=instance.ready;retire(instance);
   // A worker blocked before readiness has not accepted any input. Select the
   // local SHA capability without replaying a failed calculation.
   if(!started)workerUnavailable=true;
   if(job?.worker===instance)finish(job,Error('请求哈希线程失败；未采用未核实结果'));
   else schedule();
  };
  instance.thread.onerror=fail;instance.thread.onmessageerror=fail;return instance;
 }
 function pump(){
  if(active)return;
  while(queue[0]?.done)queue.shift();if(!queue.length)return;
  if(!workerUnavailable){
   if(!worker){try{newWorker();}catch(_){workerUnavailable=true;}}
   if(!workerUnavailable&&!worker?.ready)return;
  }
  const job=queue.shift();if(job.done){schedule();return;}active=job;
  if(workerUnavailable){
   yieldingHash(job.bytes,job.signal).then(value=>finish(job,null,value),error=>finish(job,error));return;
  }
  const instance=worker;job.worker=instance;
  const bytes=job.bytes,buffer=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.slice().buffer;
  try{instance.thread.postMessage({id:job.id,buffer},[buffer]);job.bytes=null;}
  catch(error){retire(instance);finish(job,error);}
 }
 function hashOwned(bytes,{signal}={}){
  check(signal);const subtle=root.crypto?.subtle;
  if(subtle&&typeof subtle.digest==='function')return new Promise((resolve,reject)=>{
   const cleanup=()=>signal?.removeEventListener('abort',cancel),cancel=()=>{cleanup();reject(aborted());};
   signal?.addEventListener('abort',cancel,{once:true});
   try{subtle.digest('SHA-256',bytes).then(result=>{
    cleanup();if(signal?.aborted){reject(aborted());return;}
    resolve(Array.from(new Uint8Array(result),n=>n.toString(16).padStart(2,'0')).join(''));
   },error=>{cleanup();reject(error);});}catch(error){cleanup();reject(error);}
  });
  return new Promise((resolve,reject)=>{
   const job={id:++nextId,bytes,signal,resolve,reject,done:false,worker:null,cancel:null};
   job.cancel=()=>{
    if(job.done)return;
    if(active===job&&job.worker)retire(job.worker);
    const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);
    finish(job,aborted());
    if(!active&&!queue.length&&worker&&!worker.ready)retire(worker);
   };
   signal?.addEventListener('abort',job.cancel,{once:true});queue.push(job);schedule();
  });
 }
 async function digestText(value,options={}){
  check(options.signal);const bytes=new TextEncoder().encode(String(value)),length=bytes.byteLength;
  return {sha256:await hashOwned(bytes,options),bytes:length};
 }
 async function digestBytes(value,options={}){
  check(options.signal);
  const input=ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):value instanceof ArrayBuffer?new Uint8Array(value):null;
  if(!input)throw new TypeError('SHA-256 requires bytes');
  // Public binary callers retain their bytes for backup encoding and checks.
  const bytes=input.slice(),length=bytes.byteLength;
  return {sha256:await hashOwned(bytes,options),bytes:length};
 }
 async function digestBlob(blob,options={}){
  check(options.signal);const bytes=new Uint8Array(await blob.arrayBuffer());check(options.signal);
  return {sha256:await hashOwned(bytes,options),bytes:blob.size};
 }
 async function digestTexts(values,options={}){
  check(options.signal);const result=new Array(values.length),controller=new AbortController();let next=0;
  const cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel,{once:true});
  try{await Promise.all(Array.from({length:Math.min(4,values.length)},async()=>{
   while(next<values.length){check(controller.signal);const index=next++;result[index]=await digestText(values[index],{signal:controller.signal});}
  }));return result;}catch(error){controller.abort();throw error;}
  finally{options.signal?.removeEventListener('abort',cancel);}
 }
 root.MimaRequestHash=Object.freeze({digestText,digestTexts,digestBytes,digestBlob});
})(window);
