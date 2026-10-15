/* Only this adapter commits author variables; never model turn events_jobs. */
(function(root){'use strict';const C=()=>root.MimaAuthorContract,S=()=>root.MimaCompatStore;
 const names=['compat_sessions','messages','events_jobs','variables','grants','resource_ir','sidecar_links'];
 function atomic(sessionId,mode,work){return S().open().then(db=>new Promise((resolve,reject)=>{
  let issue,result,remaining=names.length;const rows={},tx=db.transaction(names,mode);
  const bad=e=>{issue=e;try{tx.abort();}catch(_){} };
  for(const name of names){let q;const store=tx.objectStore(name);
   if(name==='compat_sessions')q=store.get(sessionId);
   else if(['messages','events_jobs'].includes(name)){
    if(!store.indexNames.contains('sessionId')){bad(C().fail('E_AUTHOR_UNVERIFIED','兼容会话索引缺失'));break;}q=store.index('sessionId').getAll(sessionId);
   }else q=store.getAll();
   q.onerror=()=>bad(q.error||C().fail('E_AUTHOR_UNVERIFIED','作者数据读取失败：'+name));
   q.onsuccess=()=>{rows[name]=name==='compat_sessions'?(q.result?[q.result]:[]):['variables','grants','sidecar_links'].includes(name)?q.result.filter(x=>x.sessionId===sessionId):q.result;
    if(--remaining)return;try{if(!rows.compat_sessions.length)throw C().fail('E_AUTHOR_UNAVAILABLE','故事已不存在');C().verify(rows);result=work(rows,tx);}catch(e){bad(e);}};
  }
  tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||C().fail('E_AUTHOR_UNVERIFIED','作者事务中止'));};
 }));}
 function checkOwner(rows,owner){
  const session=rows.compat_sessions[0],resource=rows.resource_ir.find(x=>x.id===owner.resourceId);
  C().owner(owner,resource);
  const graph=session.mountGraph||[],base=resource.sourceId===session.sourceId;
  const chosen=rows.resource_ir.find(x=>x.id===session.characterResourceId),prefix=chosen?.path.replace(/\.data$/,'');
  const cardRoot=/^(png\.(?:chara|ccv3)\[\d+\])(?:\.|$)/.exec(resource.path);
  if(owner.sessionId!==session.id||!(base&&(!cardRoot||cardRoot[1]===prefix)||graph.some(x=>x.enabled&&x.resourceId===resource.id&&x.sourceId===resource.sourceId&&x.path===resource.path)))throw C().fail('E_AUTHOR_OWNER','脚本没有挂载到这个故事的所选角色');
  return session;
 }
 function authorized(rows,owner,revision){
  checkOwner(rows,owner);const grant=rows.grants.find(g=>g.id===C().grantId(owner));
  if(!grant||grant.kind!=='author_grant_v1'||grant.revokedAt||revision!==undefined&&grant.revision!==revision)throw C().fail('E_AUTHOR_REVOKED','作者授权已撤销或发生变化');return grant;
 }
 function view(rows,owner,grant){
  const session=rows.compat_sessions[0],history=C().messages(rows.messages,rows.events_jobs),allowed=grant?.capabilities||[],tables=rows.variables.filter(x=>x.kind==='helper_table_v1');
  const selected=owner?tables.filter(x=>allowed.includes(x.scope+'.read')&&(x.scope!=='script'||x.owner===C().scriptKey(owner))):tables;
  return {version:C().version,sessionId:session.id,sessionRevision:session.revision,canonicalFingerprint:C().canonicalFingerprint(rows.messages,rows.events_jobs),variableRevision:session.authorVariableRevision||0,
   owner:owner?C().clone(owner):null,grantRevision:grant?.revision,capabilities:allowed,
   messages:(!owner||allowed.includes('messages.read')||allowed.includes('message.read')?history:[]).map((m,index)=>({stableId:m.id,message_id:index,name:m.role==='user'?session.userName||'玩家':rows.resource_ir.find(x=>x.id===session.characterResourceId)?.raw?.name||'角色',role:m.role,is_hidden:m.isHidden===true||m.is_hidden===true,message:!owner||allowed.includes('messages.read')?String(m.canonicalContent||''):'',sequence:m.sequence})),
   tables:C().clone(selected),pendingTurnId:session.pendingTurnId||null};
 }
 async function grant(owner,requested,live=()=>true){const caps=C().permissions(requested);return atomic(owner.sessionId,'readwrite',(rows,tx)=>{
  if(!live())throw C().fail('E_AUTHOR_STALE','授权动作已取消或故事已切换');
  const session=checkOwner(rows,owner);if(session.pendingTurnId)throw C().fail('E_AUTHOR_BUSY','请等待当前回合结算后再授权');
  const id=C().grantId(owner),old=rows.grants.find(g=>g.id===id);
  if(old&&!old.revokedAt)throw C().fail('E_AUTHOR_PERMISSION','已有授权，请先撤销再更改权限');
  const record={id,kind:'author_grant_v1',sessionId:owner.sessionId,owner:C().clone(owner),capabilities:caps,revision:(old?.revision||0)+1,revokedAt:null,createdAt:new Date().toISOString()};tx.objectStore('grants').put(record);return record;
 });}
 async function revoke(owner){return atomic(owner.sessionId,'readwrite',(rows,tx)=>{
  checkOwner(rows,owner);const g=rows.grants.find(x=>x.id===C().grantId(owner));if(!g)return {notGranted:true};
  const next={...g,revokedAt:new Date().toISOString(),revision:g.revision+1};tx.objectStore('grants').put(next);return next;
 });}
 async function prepare(owner,grantRevision,live=()=>true){return atomic(owner.sessionId,'readwrite',(rows,tx)=>{
  if(!live())throw C().fail('E_AUTHOR_STALE','作者快照动作已取消或故事已切换');
  const grant=authorized(rows,owner,grantRevision),session=rows.compat_sessions[0],history=C().messages(rows.messages,rows.events_jobs),desired=[];
  for(const scope of ['chat','message','script'])if(grant.capabilities.includes(scope+'.read')){
   const owners=scope==='message'?history.map(x=>x.id):[scope==='chat'?'':C().scriptKey(owner)];
   for(const target of owners)if(!rows.variables.some(x=>x.id===C().tableId(owner.sessionId,scope,target)))desired.push({scope,target});
  }
  if(desired.length){
   if(!grant.capabilities.includes('tables.initialize'))throw C().fail('E_AUTHOR_INITIALIZE','本故事缺少变量表；需明确勾选“首次初始化变量表”，不会把读取错误当空表');
   if(session.pendingTurnId)throw C().fail('E_AUTHOR_BUSY','回合生成中不能初始化作者变量');
   for(const {scope,target} of desired){const row={id:C().tableId(owner.sessionId,scope,target),kind:'helper_table_v1',sessionId:owner.sessionId,scope,owner:target,value:{},revision:1,provenance:C().clone(owner),createdAtSequence:history.at(-1)?.sequence??-1,lastOperationId:null};tx.objectStore('variables').add(row);rows.variables.push(row);}
   session.revision++;session.authorVariableRevision=(session.authorVariableRevision||0)+1;tx.objectStore('compat_sessions').put(session);
  }
  return view(rows,owner,grant);
 });}
 async function snapshot(sessionId){return atomic(sessionId,'readonly',rows=>view(rows,null,null));}
 async function check(owner,revision){return atomic(owner.sessionId,'readonly',rows=>{authorized(rows,owner,revision);return true;});}
 async function commit(owner,revision,base,operation,changes,live){
  if(!Array.isArray(changes)||!changes.length||changes.length>128)throw C().fail('E_AUTHOR_VALUE','作者写入批次无效');
  if(!base||!Array.isArray(base.tables)||new Set(base.tables.map(x=>x.id)).size!==base.tables.length||!Number.isSafeInteger(base.sessionRevision)||typeof base.canonicalFingerprint!=='string')throw C().fail('E_AUTHOR_UNVERIFIED','作者动作缺少完整读取快照');
  const verified=changes.map(x=>({...x,value:C().value(x.value)})),payloadHash=C().hash(JSON.stringify({base,changes:verified})),id=C().operationId(owner.sessionId,operation);
  return atomic(owner.sessionId,'readwrite',(rows,tx)=>{
   const grant=authorized(rows,owner,revision),session=rows.compat_sessions[0];
   if(!live())throw C().fail('E_AUTHOR_STALE','作者页面已停止或切换');
   const previous=rows.sidecar_links.find(x=>x.id===id);
   if(previous){if(previous.payloadHash!==payloadHash||previous.grantId!==grant.id)throw C().fail('E_AUTHOR_CONFLICT','相同操作 ID 对应了不同内容');return previous;}
   if(C().canonicalFingerprint(rows.messages,rows.events_jobs)!==base.canonicalFingerprint||session.pendingTurnId)throw C().fail('E_AUTHOR_CONFLICT','剧情原文已变化或正在生成，未覆盖新状态');
   const visible=rows.variables.filter(x=>x.kind==='helper_table_v1'&&grant.capabilities.includes(x.scope+'.read')&&(x.scope!=='script'||x.owner===C().scriptKey(owner)));
   if(base.tables.length!==visible.length||base.tables.some(x=>!visible.some(t=>t.id===x.id&&t.revision===x.revision)))throw C().fail('E_AUTHOR_CONFLICT','作者所读取的变量表已变化，未覆盖新状态');
   const history=C().messages(rows.messages,rows.events_jobs),atSequence=history.at(-1)?.sequence??-1,updates=[],seen=new Set();
   for(const change of verified){
    const old=rows.variables.find(x=>x.id===change.id);
    if(!old||seen.has(old.id)||old.revision!==change.expectedRevision||!grant.capabilities.includes(old.scope+'.write')||old.scope==='script'&&old.owner!==C().scriptKey(owner))throw C().fail('E_AUTHOR_CONFLICT','变量权限或修订已变化，整批未提交');
    seen.add(old.id);const next={...old,value:change.value,revision:old.revision+1,lastOperationId:id};updates.push({old,next});
   }
   const receipt={id,kind:'helper_operation_v1',operationId:operation,sessionId:owner.sessionId,grantId:grant.id,grantRevision:grant.revision,payloadHash,atSequence,sessionRevision:session.revision+1,variableRevision:(session.authorVariableRevision||0)+1,
    changes:updates.map(({old,next})=>({id:next.id,scope:next.scope,owner:next.owner,previousValue:old.value,value:next.value,revision:next.revision})),committedAt:new Date().toISOString()};
   for(const {next} of updates)tx.objectStore('variables').put(next);tx.objectStore('sidecar_links').add(receipt);
   tx.objectStore('compat_sessions').put({...session,revision:receipt.sessionRevision,authorVariableRevision:receipt.variableRevision});return receipt;
  });
 }
 function forkRows(tx,rows,newSessionId,messageIds,cutoff){
  C().verify(rows);const receipts=rows.sidecar_links.filter(x=>x.kind==='helper_operation_v1');
  for(const old of rows.variables.filter(x=>x.kind==='helper_table_v1'&&x.createdAtSequence<=cutoff)){
   if(old.scope==='message'&&!messageIds.has(old.owner))continue;
   let value=C().clone(old.value);
   for(const op of receipts.filter(x=>x.atSequence>cutoff).sort((a,b)=>b.sessionRevision-a.sessionRevision)){
    const change=op.changes.find(x=>x.id===old.id);if(change)value=C().clone(change.previousValue);
   }
   const target=old.scope==='message'?messageIds.get(old.owner):old.owner;
   tx.objectStore('variables').add({...old,id:C().tableId(newSessionId,old.scope,target),sessionId:newSessionId,owner:target,value,revision:1,lastOperationId:null,forkedFrom:{sessionId:old.sessionId,tableId:old.id,cutoff}});
  }
 }
 root.MimaAuthorStore=Object.freeze({grant,revoke,prepare,snapshot,check,commit,forkRows});
})(typeof window!=='undefined'?window:globalThis);
