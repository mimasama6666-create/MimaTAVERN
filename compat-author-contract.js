/* mima-author-host/1. Explicit Tavern Helper API subset; no host or Provider access. */
(function(root){'use strict';
 const version='mima-author-host/1',caps=['messages.read','chat.read','chat.write','message.read','message.write','script.read','script.write','tables.initialize','ui.mount','events.listen','events.emit'];
 const fail=(code,message)=>Object.assign(new Error(message),{code});
 const clone=v=>JSON.parse(JSON.stringify(v));
 const key=(kind,...parts)=>'mima_author:'+kind+':'+JSON.stringify(parts);
 const scriptKey=o=>JSON.stringify([o.sourceId,o.resourceId,o.path,o.scriptId]);
 const grantId=o=>key('grant',o.sessionId,scriptKey(o),o.scriptHash);
 const tableId=(sessionId,scope,owner='')=>key('table',sessionId,scope,owner);
 const operationId=(sessionId,id)=>key('operation',sessionId,id);
 const canonicalFingerprint=(rows,jobs=[])=>hash(JSON.stringify([rows.map(m=>[m.id,m.status,m.revision,m.turnId,m.sequence,m.canonicalContent]),jobs.map(j=>[j.id,j.settlement,j.revision,j.attemptId])]));
 function value(v){
  const seen=new WeakSet();let count=0;
  function visit(x,depth){if(++count>20000||depth>32)throw fail('E_AUTHOR_VALUE','变量对象超过结构预算');
   if(x===null||typeof x==='boolean'||typeof x==='string')return;
   if(typeof x==='number'&&Number.isFinite(x))return;
   if(!x||typeof x!=='object'||seen.has(x)||(!Array.isArray(x)&&Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null))throw fail('E_AUTHOR_VALUE','变量只能包含无循环的 JSON 数据');
   seen.add(x);for(const item of Object.values(x))visit(item,depth+1);seen.delete(x);
  }
  if(!v||typeof v!=='object'||Array.isArray(v))throw fail('E_AUTHOR_VALUE','变量表必须为对象');visit(v,0);
  const text=JSON.stringify(v);if(text.length>65536)throw fail('E_AUTHOR_VALUE','单个作者变量表超过 64KB');return JSON.parse(text);
 }
 function scripts(resource){
  const out=[],issues=[];
  function walk(raw,path){
   if(Array.isArray(raw)){
    if(raw.length===2&&['script','folder'].includes(raw[0])&&raw[1]&&typeof raw[1]==='object'){walk({...raw[1],type:raw[0]},path+'[1]');return;}
    raw.forEach((item,i)=>walk(item,path+'['+i+']'));return;
   }
   if(raw?.type==='folder'){if(Array.isArray(raw.scripts))walk(raw.scripts,path+'.scripts');else issues.push({path,reason:'folder_without_scripts'});return;}
   const code=typeof raw==='string'?raw:raw?.script??raw?.code??raw?.content;
   if(typeof code!=='string'||!code.trim()){issues.push({path,reason:'script_source_shape_unsupported'});return;}
   if(code.length>262144){issues.push({path,reason:'script_source_budget'});return;}
   const scriptId=typeof raw?.id==='string'&&raw.id?raw.id:path;
   out.push({sourceId:resource.sourceId,resourceId:resource.id,path,scriptId,label:String(raw?.name||raw?.scriptName||'作者脚本'),code});
  }
  walk(resource.raw,resource.path);return {scripts:out,issues};
 }
 function hash(code){if(!root.MimaSHA256?.digest)throw fail('E_AUTHOR_UNAVAILABLE','SHA256 组件未加载');return root.MimaSHA256.digest(new TextEncoder().encode(code));}
 function owner(o,resource){
  if(!o||typeof o.sessionId!=='string'||typeof o.scriptHash!=='string'||!/^[a-f0-9]{64}$/.test(o.scriptHash)||!resource||resource.kind!=='script_source'||resource.sourceId!==o.sourceId||resource.id!==o.resourceId)throw fail('E_AUTHOR_OWNER','作者脚本来源或身份无效');
  const source=scripts(resource).scripts.find(s=>s.path===o.path&&s.scriptId===o.scriptId);
  if(!source||hash(source.code)!==o.scriptHash)throw fail('E_AUTHOR_OWNER','作者脚本字节、路径或版本已变化');return source;
 }
 function permissions(list){
  if(!Array.isArray(list)||list.some(x=>!caps.includes(x)))throw fail('E_AUTHOR_PERMISSION','包含未实现的作者能力');
  for(const scope of ['chat','message','script'])if(list.includes(scope+'.write')&&!list.includes(scope+'.read'))throw fail('E_AUTHOR_PERMISSION','写入 '+scope+' 时需同时明确授权读取该表');
  if(!list.includes('ui.mount'))throw fail('E_AUTHOR_PERMISSION','作者交互界面需要明确授权 ui.mount');return [...new Set(list)];
 }
 function messages(rows,jobs){
  const ledger=new Map(jobs.map(j=>[j.id,j]));
  for(const m of rows)if(m.turnId&&!ledger.has(m.turnId))throw fail('E_AUTHOR_UNVERIFIED','消息缺少原回合结算记录');
  const result=rows.filter(m=>m.status==='committed'&&(!m.turnId||ledger.get(m.turnId)?.settlement==='committed')).sort((a,b)=>a.sequence-b.sequence);
  if(result.some(m=>typeof m.id!=='string'||!m.id||!['system','assistant','user'].includes(m.role)||!Number.isSafeInteger(m.sequence)||typeof m.canonicalContent!=='string'))throw fail('E_AUTHOR_UNVERIFIED','已提交消息的身份、角色或正文无效');
  if(new Set(result.map(m=>m.sequence)).size!==result.length)throw fail('E_AUTHOR_UNVERIFIED','消息楼层序号重复');return result;
 }
 function table(row){
  if(!row||row.kind!=='helper_table_v1'||!['chat','message','script'].includes(row.scope)||typeof row.sessionId!=='string'||typeof row.owner!=='string'||row.id!==tableId(row.sessionId,row.scope,row.owner)||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.createdAtSequence))throw fail('E_AUTHOR_UNVERIFIED','作者变量记录身份或修订无效');
  value(row.value);return row;
 }
 function verify(records,{complete=false}={}){
  const sessions=new Map((records.compat_sessions||[]).map(x=>[x.id,x])),msgs=new Map((records.messages||[]).map(x=>[x.id,x])),jobs=new Map((records.events_jobs||[]).map(x=>[x.id,x])),resources=new Map((records.resource_ir||[]).map(x=>[x.id,x])),grants=new Map((records.grants||[]).map(x=>[x.id,x])),operations=new Map((records.sidecar_links||[]).filter(x=>x.kind==='helper_operation_v1').map(x=>[x.id,x])),tables=new Map((records.variables||[]).filter(x=>x.kind==='helper_table_v1').map(x=>[x.id,x]));
  const checkedSources=new Set(),source=o=>{const id=scriptKey(o)+':'+o.scriptHash;if(!checkedSources.has(id)){owner(o,resources.get(o.resourceId));checkedSources.add(id);}};
  for(const session of sessions.values()){const card=resources.get(session.characterResourceId);if(!card||card.kind!=='character'||card.sourceId!==session.sourceId)throw fail('E_AUTHOR_UNVERIFIED','作者故事缺少已选角色资源');if(session.authorVariableRevision!==undefined&&(!Number.isSafeInteger(session.authorVariableRevision)||session.authorVariableRevision<0))throw fail('E_AUTHOR_UNVERIFIED','作者变量提交版本无效');}
  for(const g of grants.values())if(g.kind==='author_grant_v1'){
   if(!sessions.has(g.sessionId)||g.id!==grantId(g.owner)||g.owner.sessionId!==g.sessionId||!Number.isSafeInteger(g.revision)||g.revision<1)throw fail('E_AUTHOR_UNVERIFIED','作者授权记录损坏');
   permissions(g.capabilities);source(g.owner);
  }
  for(const row of records.variables||[])if(row.kind==='helper_table_v1'){
   table(row);const message=msgs.get(row.owner);
   if(!sessions.has(row.sessionId)||row.scope==='chat'&&row.owner!==''||row.scope==='message'&&(!message||message.sessionId!==row.sessionId||message.status!=='committed'||message.turnId&&jobs.get(message.turnId)?.settlement!=='committed'))throw fail('E_AUTHOR_UNVERIFIED','作者变量不属于该故事/已提交消息');
   if(!row.provenance)throw fail('E_AUTHOR_UNVERIFIED','作者变量缺少来源');source({...row.provenance,sessionId:row.sessionId});
   if(row.scope==='script'&&row.owner!==scriptKey(row.provenance))throw fail('E_AUTHOR_UNVERIFIED','脚本变量命名空间无效');
   if(row.forkedFrom){const ref=row.forkedFrom;if(typeof ref.sessionId!=='string'||typeof ref.tableId!=='string'||!Number.isSafeInteger(ref.cutoff))throw fail('E_AUTHOR_UNVERIFIED','分支作者变量来源无效');
    if(complete){const parent=tables.get(ref.tableId);if(!sessions.has(ref.sessionId)||!parent||parent.sessionId!==ref.sessionId||parent.scope!==row.scope||row.scope==='message'&&msgs.get(row.owner)?.originMessageId!==parent.owner)throw fail('E_AUTHOR_UNVERIFIED','分支作者变量原表或楼层映射失效');}
   }
   if(row.lastOperationId){const operation=operations.get(row.lastOperationId),change=operation?.changes?.find(x=>x.id===row.id);if(!operation||operation.sessionId!==row.sessionId||!change||change.revision!==row.revision||JSON.stringify(change.value)!==JSON.stringify(row.value))throw fail('E_AUTHOR_UNVERIFIED','变量缺少对应正文与修订的已提交回执');}
   else if(row.revision!==1||!row.forkedFrom&&JSON.stringify(row.value)!=='{}')throw fail('E_AUTHOR_UNVERIFIED','作者变量初始化或历史回执缺失');
  }
  for(const op of operations.values()){
   const grant=grants.get(op.grantId);
   if(!sessions.has(op.sessionId)||!grant||grant.kind!=='author_grant_v1'||grant.sessionId!==op.sessionId||op.id!==operationId(op.sessionId,op.operationId)||typeof op.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(op.payloadHash)||!Array.isArray(op.changes)||!op.changes.length||!Number.isSafeInteger(op.atSequence)||!Number.isSafeInteger(op.grantRevision)||op.grantRevision>grant.revision)throw fail('E_AUTHOR_UNVERIFIED','作者操作回执或授权外键无效');
   const seen=new Set();for(const change of op.changes){const current=tables.get(change.id);if(!current||seen.has(change.id)||!['chat','message','script'].includes(change.scope)||change.id!==tableId(op.sessionId,change.scope,change.owner)||!Number.isSafeInteger(change.revision)||change.revision<1||change.revision>current.revision)throw fail('E_AUTHOR_UNVERIFIED','作者操作变量地址无效');seen.add(change.id);value(change.previousValue);value(change.value);}
  }
  return true;
 }
 function readPath(object,path){
  const parts=String(path).split('.');if(!path||parts.some(k=>!k||['__proto__','constructor','prototype'].includes(k)))throw fail('E_AUTHOR_MACRO','变量路径仅支持安全的点分隔键');
  let result=object;for(const part of parts){if(!result||typeof result!=='object'||!Object.hasOwn(result,part))throw fail('E_AUTHOR_MACRO','变量不存在：'+path);result=result[part];}
  return typeof result==='string'?result:JSON.stringify(result);
 }
 root.MimaAuthorContract=Object.freeze({version,caps,fail,clone,key,scriptKey,grantId,tableId,operationId,canonicalFingerprint,value,scripts,hash,owner,permissions,messages,table,verify,readPath});
})(typeof window!=='undefined'?window:globalThis);
