/* A conversion package explicitly declares which source fields and rendered
   nodes identify a complete reply. Display regex packages need no contract. */
(() => {
 'use strict';
 const error=(code,message)=>Object.assign(new Error(message),{code});
 const parsed=new WeakMap();
 const htmlTemplate=/<(?:system|status(?:-?bar)?|div|section|article|details|table|aside|main)\b[^>]*>/i;
 function isLegacyConverter(pack) {
  return !!pack?.rules?.some(rule=>rule.enabled!==false&&rule.phase==='display'&&htmlTemplate.test(rule.replacement));
 }
 function read(value) {
  if(value&&typeof value==='object'&&parsed.has(value))return parsed.get(value);
  if(value?.version!==2||typeof value.sample!=='string'||!value.sample.trim()||
    typeof value.requiredSelectors!=='string'||!value.requiredSelectors.trim()||
    !Array.isArray(value.fields)||!value.fields.length)
   throw error('E_COMPACT_CONTRACT_CONFIG','短协议 v2 需要完整输出样例、必需字段及展开后的选择器');
  try{document.querySelector(value.requiredSelectors.replace(/\r?\n/g,','));}
  catch{throw error('E_COMPACT_CONTRACT_CONFIG','短协议的 HTML 选择器无效');}
  const names=new Set();
  const fields=value.fields.map(field=>{
   const name=typeof field?.name==='string'?field.name.trim():'';
   if(!name||names.has(name)||typeof field.pattern!=='string'||!field.pattern||
     !Array.isArray(field.groups)||!field.groups.length||
     field.groups.some(n=>typeof n==='string'?!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(n):!Number.isSafeInteger(n)||n<1))
    throw error('E_COMPACT_CONTRACT_CONFIG','必需字段要指定名称、匹配式和非空捕获组');
   const flags=String(field.flags||'').replace(/[gy]/g,'');
   try{new RegExp(field.pattern,flags);}
   catch{throw error('E_COMPACT_CONTRACT_CONFIG','必需字段的匹配式无效：'+name);}
   names.add(name);
   return {name,pattern:field.pattern,flags,groups:field.groups.slice()};
  });
  if(value.terminal!==undefined&&(typeof value.terminal!=='string'||!value.terminal.trim()))
   throw error('E_COMPACT_CONTRACT_CONFIG','每轮结束标记需填写完整的外层结束行');
  const result={version:2,sample:value.sample,requiredSelectors:value.requiredSelectors,fields,
   ...(value.terminal?{terminal:value.terminal.trim()}:{})};
  parsed.set(value,result);parsed.set(result,result);
  return result;
 }
 function checks(contract) {
  return contract.fields.map(({name,pattern,flags,groups})=>({name,pattern,flags,fields:groups}));
 }
 function inspectProjection(output,contract,resources) {
  // The inert DOM is only a second check. Its implicit closing or reparenting
  // may not repair a malformed source or an incomplete replacement template.
  const syntax=MimaHtmlStructure.rawBalance(output);
  if(!syntax.ok)throw error('E_COMPACT_HTML_SYNTAX','短协议展开的 HTML 不完整：'+syntax.reason);
  const structure={requireHtml:true,completeHtml:true,requiredSelectors:contract?.requiredSelectors||''};
  const original=MimaHtmlStructure.inspect(output,structure);
  if(!original.ok)throw error('E_COMPACT_HTML_STRUCTURE','展开后缺少必要结构：'+original.missing.join('、'));
  const safe=MimaStoryDisplay.inspectionHtml(output,'mima_compact_check',{resources});
  const rendered=MimaHtmlStructure.inspect(safe.html,structure);
  if(!rendered.ok)throw error('E_COMPACT_HTML_STRUCTURE','展示后缺少必要结构：'+rendered.missing.join('、'));
  const fatal=safe.diagnostics.filter(item=>item.kind==='resource');
  if(fatal.length)throw error('E_DISPLAY_STYLE_LOSS',fatal.map(item=>item.reason).join('；'));
  return safe;
 }
 async function preflight(pack,options={}) {
  if(pack.protocolResource){await MimaStoryProtocol.preflight(pack.protocolResource);return pack;}
  if(pack.compactContract==null)return pack;
  const contract=read(pack.compactContract);
  const [result]=await MimaRegexEngine.applyBatchAsync([{input:contract.sample,phase:'display'}],[pack],
    {...options,tracePackId:pack.id,protocol:checks(contract)});
  if(result.missingFields.length)throw error('E_COMPACT_PROTOCOL_MISMATCH','样例缺少必需字段：'+result.missingFields.join('、'));
  if(!result.matchedPack)throw error('E_COMPACT_PROTOCOL_MISMATCH','配套正则未能展开已声明的样例');
  inspectProjection(result.output,contract,pack.displayStyles);
  return {...pack,compactContract:contract};
 }
 window.MimaDisplayContract={read,checks,isLegacyConverter,inspectProjection,preflight};
})();
