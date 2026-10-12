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
      const substituteMode=Number(r.substituteRegex??0);
      if(![0,1,2].includes(substituteMode))throw fail('E_REGEX_PHASE_UNSUPPORTED','未知正则 Find 宏模式');
      const trims=Array.isArray(r.trimStrings)?r.trimStrings:[];
      if(trims.length>32||trims.some(x=>typeof x!=='string'||x.length>256))throw fail('E_REGEX_BUDGET','Trim Out 项目超出限额');
      const macroContext=opts.macroContext||{};
      const interpolate=(body,escape)=>String(body).replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,name)=>{
        const key=name.trim().toLowerCase();
        if(key!=='char'&&key!=='user')throw fail('E_REGEX_PHASE_UNSUPPORTED','不支持的正则宏 '+key);
        if(typeof macroContext[key]!=='string'||!macroContext[key])throw fail('E_REGEX_PHASE_UNSUPPORTED','Find Regex 缺少已验证的 '+key+' 宏上下文');
        const val=macroContext[key];return escape?val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):val;
      });
      let raw=String(r.findRegex||'');
      if(substituteMode)raw=interpolate(raw,substituteMode===2);
      if(raw.length>2048)throw fail('E_REGEX_BUDGET','单规则过长');
      const literal=/^\/(.*)\/([dgimsuvy]*)$/s.exec(raw);let re;
      try{re=literal?new RegExp(literal[1],literal[2]):new RegExp(raw,r.flags||'g');}catch(e){throw fail('E_REGEX_PHASE_UNSUPPORTED','规则 '+index+' 编译失败：'+e.message);}
      const beforeLength=out.length;
      const template=String(r.replaceString??'');
      if(/\{\{(?!\s*match\s*\}\})/i.test(template)||trims.some(t=>/\{\{/.test(t)))throw fail('E_REGEX_PHASE_UNSUPPORTED','Replace/Trim 中动态宏尚未获证实，拒绝静默执行');
      const filtered=value=>trims.reduce((acc,t)=>t?acc.split(t).join(''):acc,String(value??''));
      if(trims.length||/\{\{match\}\}|\$0|\$<|\$[1-9]/i.test(template)){
        out=out.replace(re,(match,...args)=>{
          const groups=typeof args.at(-1)==='object'?args.at(-1):{};
          const captures=typeof args.at(-1)==='object'?args.slice(0,-3):args.slice(0,-2);
          return template.replace(/\{\{match\}\}|\$(\$|0|[1-9]\d*|<[^>]+>|&)/gi,(token,target)=>{
            if(/^\{\{/i.test(token)||target==='0'||target==='&')return filtered(match);
            if(target==='$')return '$';
            if(target?.startsWith('<'))return filtered(groups[target.slice(1,-1)]||'');
            return filtered(captures[Number(target)-1]||'');
          });
        });
      }else out=out.replace(re,template);
      if(out.length>524288)throw fail('E_REGEX_BUDGET','正则结果超过 512KiB');
      trace.push({index,phase,beforeLength,afterLength:out.length});
    }
    return{output:out,trace};
  }
  function handler(packet){if(Array.isArray(packet.batch)){if(packet.batch.length>2000)return{ok:false,error:{code:'E_REGEX_BUDGET',message:'批次数超过 2000'}};return{ok:true,results:packet.batch.map(item=>{try{return{ok:true,result:evaluate({...item,rules:packet.rules})}}catch(e){return{ok:false,error:{code:e.code||'E_REGEX_PHASE_UNSUPPORTED',message:e.message}}}})}}try{return{ok:true,result:evaluate(packet)};}catch(e){return{ok:false,error:{code:e.code||'E_REGEX_PHASE_UNSUPPORTED',message:e.message}};}}
  if(parent)parent.on('message',p=>parent.postMessage(handler(p)));
  else self.onmessage=e=>self.postMessage(handler(e.data));
})();
