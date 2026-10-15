/* Author variables only enter derived request copies, never source cards or History. */
(function(root){'use strict';const pattern=/\{\{\s*(get_chat_variable|get_message_variable)::([^{}]+?)\s*\}\}/g;
 function needs(out){return out.messages.some(m=>/\{\{\s*get_(?:chat|message)_variable::/.test(m.content));}
 function project(out,snapshot){
  const C=root.MimaAuthorContract,trace=[],byMessage=new Map(snapshot.messages.map(m=>[m.stableId,m]));
  function expand(text,source){return String(text).replace(pattern,(_,kind,argument)=>{
   const scope=kind==='get_chat_variable'?'chat':'message';let path=argument.trim(),owner='';
   if(scope==='message'){
    const parts=path.split('::');if(parts.length>2)throw C.fail('E_AUTHOR_MACRO','消息变量宏参数无效');path=parts[0];
    let target=source?.messageId?byMessage.get(source.messageId):snapshot.messages.at(-1);
    if(parts.length===2){if(!/^-?\d+$/.test(parts[1]))throw C.fail('E_AUTHOR_MACRO','消息变量宏楼层必须为整数');const n=Number(parts[1]);target=snapshot.messages[n<0?snapshot.messages.length+n:n];}
    if(!target)throw C.fail('E_AUTHOR_MACRO','消息变量宏没有已提交的目标楼层');owner=target.stableId;
   }
   const table=snapshot.tables.find(t=>t.scope===scope&&t.owner===owner);
   if(!table)throw C.fail('E_AUTHOR_MACRO_UNAVAILABLE','作者 '+scope+' 变量表尚未经过明确初始化，未发送无法解析的宏');
   const value=C.readPath(table.value,path),item={scope,tableId:table.id,revision:table.revision,key:path,sourceId:source?.sourceId||null,resourceId:source?.resourceId||null,path:source?.path||null,messageId:source?.messageId||null};trace.push(item);return value;
  });}
  out.messages.forEach((message,i)=>{const source=out.messageSources[i]||{},before=trace.length;message.content=expand(message.content,source);if(trace.length>before)source.authorVariables=trace.slice(before);});
  // Inspector segments and source gaps describe the same committed projection.
  for(const segment of out.segments||[])segment.content=expand(segment.content,segment.origin||{});
  out.gaps=out.gaps.map(g=>g.reason==='unsupported_macros_preserved'?{...g,macros:g.macros.filter(x=>!/^get_(?:chat|message)_variable::/.test(x))}:g).filter(g=>g.reason!=='unsupported_macros_preserved'||g.macros.length);
  out.authorVariables={version:C.version,sessionId:snapshot.sessionId,variableRevision:snapshot.variableRevision,sessionRevision:snapshot.sessionRevision,trace};return out;
 }
 async function assertCurrent(out){
  if(!out.authorVariables)return;const session=await root.MimaCompatStore.get('compat_sessions',out.authorVariables.sessionId);
  if(!session||(session.authorVariableRevision||0)!==out.authorVariables.variableRevision)throw root.MimaAuthorContract.fail('E_AUTHOR_CONFLICT','请求冻结前作者变量已变化；未调用模型，请重新发送');
 }
 root.MimaAuthorPrompt=Object.freeze({needs,project,assertCurrent});
})(typeof window!=='undefined'?window:globalThis);
