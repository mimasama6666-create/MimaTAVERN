/* Read-only, version-bound compatibility card launch plan.
 * No source scripts are executed and no canonical store is changed here.
 * Runtime remains the authority over which sources reach Provider payloads.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatOnboarding=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const liveKinds=new Set(['world_info','regex','prompt_presets','variable_schema']);
const passiveKinds=new Set(['css','html_template','media','script_source','quick_reply','plugin_bundle']);
function belongsToCard(selected,item){
 if(item.kind==='character')return item===selected||(item.id&&selected.id&&item.id===selected.id);
 const owner=/^(png\.(?:chara|ccv3)\[\d+\])(?:\.|$)/.exec(String(item.path||''));
 if(owner)return owner[1]===String(selected.path||'').replace(/\.data$/,'');
 return true; // JSON/CHARX: no second version's card-data prefix
}
function allItems(resources,selected){
 if(!selected||selected.kind!=='character'||!Array.isArray(resources))fail('E_CARD_SELECTION','请选择有效的角色版本');
 const sourceId=selected.sourceId;
 if(sourceId&&resources.some(x=>x.sourceId&&x.sourceId!==sourceId))fail('E_SOURCE_CORRUPT','角色资源不能跨来源混合');
 if(!resources.includes(selected)&&!resources.some(x=>x.id&&selected.id&&x.id===selected.id))fail('E_CARD_SELECTION','所选角色不属于当前来源清单');
 return resources.filter(x=>belongsToCard(selected,x)&&x.kind!=='raw_unknown');
}
function make(resources,selected){
 const included=allItems(resources,selected),counts={world_info:0,worldbookEntries:0,worldbookEnabled:0,regex:0,prompt_presets:0,variable_schema:0,script_source:0,css:0,html_template:0,media:0,quick_reply:0,plugin_bundle:0};
 const active=[],manual=[];
 for(const x of included){
  if(x.kind==='character')continue;
  if(!(x.kind in counts))continue;
  if(x.kind==='world_info'){
   counts.world_info++;
   const entries=x.raw?.entries;
   const parts=Array.isArray(entries)?entries:entries&&typeof entries==='object'?Object.values(entries):[];
   counts.worldbookEntries+=parts.length;
   counts.worldbookEnabled+=parts.filter(e=>e&&e.disable!==true&&e.enabled!==false).length;
  }else if(x.kind==='regex')counts.regex+=Array.isArray(x.raw)?x.raw.length:1;
  else if(x.kind==='script_source')counts.script_source+=Array.isArray(x.raw)?x.raw.length:1;
  else counts[x.kind]++;
  if(liveKinds.has(x.kind))active.push(x);
  if(passiveKinds.has(x.kind))manual.push(x);
 }
 const name=String(selected.raw?.nickname||selected.raw?.name||selected.name||'未命名角色');
 const flags={hasSystemPrompt:!!String(selected.raw?.system_prompt||'').trim(),hasPostHistory:!!String(selected.raw?.post_history_instructions||'').trim()};
 const warnings=[];
 if(manual.some(x=>x.kind==='script_source'))warnings.push('酒馆助手 JavaScript 仍需单独授权，不能通过一键挂载自动运行');
 if(manual.some(x=>x.kind==='css'||x.kind==='html_template'))warnings.push('卡内 CSS、HTML 只支持手动受限预览/启用，不自动执行');
 if(counts.worldbookEntries>counts.worldbookEnabled)warnings.push('世界书中禁用的条目保持禁用，关键词条目只有命中时才发送');
 return Object.freeze({name,selectedId:selected.id||null,selectedPath:selected.path,sourceId:selected.sourceId||null,resources:included,active,manual,counts,flags,warnings});
}
function assertRuntime(plan,resources){
 if(!plan||!Array.isArray(resources))fail('E_MOUNT_UNVERIFIED','准备挂载的来源清单丢失');
 const activeIds=new Set(resources.map(x=>x.id).filter(Boolean));
 for(const x of plan.active){
  if(x.id&&!activeIds.has(x.id))fail('E_MOUNT_UNVERIFIED','剧情创建后未找到应有的内置资料：'+x.path);
 }
 const other=resources.filter(x=>x.kind==='character'&&x.id!==plan.selectedId);
 if(other.length)fail('E_MOUNT_UNVERIFIED','剧情意外混入另一个角色版本');
 return true;
}
return Object.freeze({make,assertRuntime});
});
