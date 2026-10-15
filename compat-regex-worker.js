/* Disposable, isolated regex evaluator. Never load as a main-window script. */
'use strict';
(function(){
  const isNode=typeof process!=='undefined' && !!process.versions?.node;
  const parent=isNode?require('node:worker_threads').parentPort:null;
  function fail(code,message){return Object.assign(new Error(message),{code});}
  function evaluate(packet){
    let out=String(packet.input??'');
    const phase=packet.phase, opts=packet.options||{},trace=[],errors=[];
    if(out.length>262144)throw fail('E_REGEX_BUDGET','正则输入超过 256KiB');
    if(!Array.isArray(packet.rules)||packet.rules.length>200)throw fail('E_REGEX_BUDGET','正则规则数量超出隔离配额');
    for(const [index,r] of packet.rules.entries()){
      if(!r||r.disabled||!Array.isArray(r.placement)||!r.placement.includes(phase)||!r.findRegex)continue;
      const applies=(r.markdownOnly&&opts.isMarkdown)||(r.promptOnly&&opts.isPrompt)||(!r.markdownOnly&&!r.promptOnly&&!opts.isMarkdown&&!opts.isPrompt);
      if(!applies||opts.isEdit&&!r.runOnEdit||typeof opts.depth==='number'&&(r.minDepth!==null&&r.minDepth!==undefined&&Number(r.minDepth)>=-1&&opts.depth<Number(r.minDepth)||r.maxDepth!==null&&r.maxDepth!==undefined&&Number(r.maxDepth)>=0&&opts.depth>Number(r.maxDepth)))continue;
      const beforeRule=out;
      try{
      const substituteMode=Number(r.substituteRegex??0);
      if(![0,1,2].includes(substituteMode))throw fail('E_REGEX_PHASE_UNSUPPORTED','未知正则 Find 宏模式');
      const trims=Array.isArray(r.trimStrings)?r.trimStrings:[];
      if(trims.length>32||trims.some(x=>typeof x!=='string'||x.length>256))throw fail('E_REGEX_BUDGET','Trim Out 项目超出限额');
      const macroContext=opts.macroContext||{};
      const interpolate=(body,escape)=>String(body).replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(token,name)=>{
        const key=name.trim().toLowerCase();
        let val;if(key==='match')return token;
        if(key==='newline')val='\n';else if(key==='noop')val='';
        else if(/^getvar::/i.test(key)){
          const originalKey=name.trim().slice(8),vars=macroContext.variables;
          if(!vars||typeof vars!=='object')throw fail('E_REGEX_PHASE_UNSUPPORTED','缺少已验证的本剧情变量来源');
          val=Object.hasOwn(vars,originalKey)?vars[originalKey]:'';if(typeof val!=='string')val=val==null?'':JSON.stringify(val);
        }else if(['char','user','description','personality','scenario','persona','mesexamples','original'].includes(key)){
          if(typeof macroContext[key]!=='string')throw fail('E_REGEX_PHASE_UNSUPPORTED','正则缺少已验证的 '+key+' 宏上下文');val=macroContext[key];
        }else throw fail('E_REGEX_PHASE_UNSUPPORTED','不支持的正则宏 '+key);
        return escape?val.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g,c=>({'\n':'\\n','\r':'\\r','\t':'\\t','\v':'\\v','\f':'\\f','\0':'\\0'}[c]||'\\'+c)):val;
      });
      let raw=String(r.findRegex||'');
      if(substituteMode)raw=interpolate(raw,substituteMode===2);
      if(raw.length>2048)throw fail('E_REGEX_BUDGET','单规则过长');
      const literal=/^\/(.*)\/([dgimsuvy]*)$/s.exec(raw);let re;
      try{re=literal?new RegExp(literal[1],literal[2]):new RegExp(raw,r.flags||'');}catch(e){throw fail('E_REGEX_PHASE_UNSUPPORTED','规则 '+index+' 编译失败：'+e.message);}
      if(!re.test(out))continue;re.lastIndex=0;
      const beforeLength=out.length;
      const template=interpolate(String(r.replaceString??''),false),resolvedTrims=trims.map(t=>interpolate(t,false));
      const filtered=value=>resolvedTrims.reduce((acc,t)=>t?acc.split(t).join(''):acc,String(value??''));
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
      }catch(e){out=beforeRule;const ref=r.__mimaRegexRef||{};errors.push({code:e.code||'E_REGEX_PHASE_UNSUPPORTED',message:e.message,ruleIndex:index,ruleName:String(r.scriptName||'规则 '+(index+1)),ruleKey:ref.key||null,resourceId:ref.resourceId||null,path:ref.path||null,phase});}
    }
    return{output:out,trace,errors};
  }
  function one(packet){try{const result=evaluate(packet);return{ok:result.errors.length===0,result,...(result.errors.length?{error:result.errors[0]}:{})};}catch(e){return{ok:false,error:{code:e.code||'E_REGEX_PHASE_UNSUPPORTED',message:e.message}};}}
  function handler(packet){if(Array.isArray(packet.batch)){if(packet.batch.length>2000)return{ok:false,error:{code:'E_REGEX_BUDGET',message:'批次数超过 2000'}};return{ok:true,results:packet.batch.map(item=>one({...item,rules:packet.rules}))}}return one(packet);}
  if(parent)parent.on('message',p=>parent.postMessage(handler(p)));
  else self.onmessage=e=>self.postMessage(handler(e.data));
})();
