/* Dedicated killable World Info matcher. Untrusted regexes never execute on the UI thread. */
'use strict';
(function(){
 const isNode=typeof process!=='undefined'&&!!process.versions?.node;
 const parent=isNode?require('node:worker_threads').parentPort:null;
 const runtime=isNode?require('./compat-runtime.js'):(importScripts('./compat-runtime.js'),self.MimaCompatRuntime);
 function processPacket(packet){
  try{
   if(!packet||!Array.isArray(packet.entries)||!Array.isArray(packet.history)||!packet.settings)throw Error('世界书消息结构无效');
   if(packet.entries.length>2000||packet.history.length>50000)throw Error('世界书超出隔离处理配额');
   const entries=packet.entries,history=packet.history;
   if(entries.some(e=>e&&typeof e==='object'&&JSON.stringify(e).length>131072))throw Error('单条世界书数据超出隔离处理配额');
   const result=runtime.worldInfo(entries,history,{...packet.settings,isolatedRegexWorldInfo:true});
   return{ok:true,result};
  }catch(e){return{ok:false,error:{code:e.code||'E_WORLDINFO_WORKER_FAILED',message:String(e.message||e)}};}
 }
 if(parent)parent.on('message',packet=>parent.postMessage(processPacket(packet)));
 else self.onmessage=e=>self.postMessage(processPacket(e.data));
})();
