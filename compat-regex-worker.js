/* Disposable, isolated regex evaluator. Never load as a main-window script. */
'use strict';
(function(){
  const isNode=typeof process!=='undefined' && !!process.versions?.node;
  const parent=isNode?require('node:worker_threads').parentPort:null;
  function fail(code,message){return Object.assign(new Error(message),{code});}
  function evaluate(packet){
    let out=String(packet.input??'');
    const phase=packet.phase, opts=packet.options||{},trace=[];
    if(out.length>262144)throw fail('E_REGEX_BUDGET','正则输入超过 256KiB');
    if(!Array.isArray(packet.rules)||packet.rules.length>200)throw fail('E_REGEX_BUDGET','正则规则数量超出隔离配额');
    for(const [index,r] of packet.rules.entries()){
      if(!r||r.disabled===true||!Array.isArray(r.placement)||!r.placement.includes(phase))continue;
      if(r.markdownOnly===true&&!opts.isMarkdown||r.promptOnly===true&&opts.isMarkdown||Number.isInteger(r.minDepth)&&opts.depth<r.minDepth||Number.isInteger(r.maxDepth)&&opts.depth>r.maxDepth)continue;
      if(r.substituteRegex!==undefined&&r.substituteRegex!==0||Array.isArray(r.trimStrings)&&r.trimStrings.length)throw fail('E_REGEX_PHASE_UNSUPPORTED','ST substituteRegex/trimStrings 尚未完成黄金对照，拒绝冒充等价');
      const raw=String(r.findRegex||'');if(raw.length>2048)throw fail('E_REGEX_BUDGET','单规则过长');
      const literal=/^\/(.*)\/([dgimsuvy]*)$/s.exec(raw);let re;
      try{re=literal?new RegExp(literal[1],literal[2]):new RegExp(raw,r.flags||'g');}catch(e){throw fail('E_REGEX_PHASE_UNSUPPORTED','规则 '+index+' 编译失败：'+e.message);}
      const beforeLength=out.length;
      out=out.replace(re,String(r.replaceString??''));
      if(out.length>524288)throw fail('E_REGEX_BUDGET','正则结果超过 512KiB');
      trace.push({index,phase,beforeLength,afterLength:out.length});
    }
    return{output:out,trace};
  }
  function handler(packet){if(Array.isArray(packet.batch)){if(packet.batch.length>2000)return{ok:false,error:{code:'E_REGEX_BUDGET',message:'批次数超过 2000'}};return{ok:true,results:packet.batch.map(item=>{try{return{ok:true,result:evaluate({...item,rules:packet.rules})}}catch(e){return{ok:false,error:{code:e.code||'E_REGEX_PHASE_UNSUPPORTED',message:e.message}}}})}}try{return{ok:true,result:evaluate(packet)};}catch(e){return{ok:false,error:{code:e.code||'E_REGEX_PHASE_UNSUPPORTED',message:e.message}};}}
  if(parent)parent.on('message',p=>parent.postMessage(handler(p)));
  else self.onmessage=e=>self.postMessage(handler(e.data));
})();
