/* Author iframe lifecycle. Existing Worker/visual grants retain their old meaning. */
(function(root){'use strict';const records=new Map(),pendingOwners=new Map(),generations=new Map(),eventSessions=new Set(),C=()=>root.MimaAuthorContract,S=()=>root.MimaAuthorStore;
 function status(record,state,message){record.state=state;if(record.active&&records.get(record.id)===record&&record.live())record.onStatus?.({state,message});}
 function fault(record,e){if(record.failed)return;record.failed=e;status(record,'error',(e.code||'E_AUTHOR_HOST')+': '+e.message);if(record.active)record.port?.postMessage({type:'unavailable',code:e.code||'E_AUTHOR_HOST',message:e.message});for(const w of record.waiters.values())w.reject(e);record.waiters.clear();}
 function stop(id,reason='作者脚本已停止'){
  generations.set(id,(generations.get(id)||0)+1);pendingOwners.delete(id);
  const record=records.get(id);if(!record)return;record.active=false;records.delete(id);
  for(const w of record.waiters.values())w.reject(C().fail('E_AUTHOR_STALE',reason));record.waiters.clear();
  record.port?.close();record.frame.remove();record.onStatus?.({state:'stopped',message:reason+(record.state==='pending'?'；未收到回执的动作请以已提交变量为准':'')});
 }
 function unmountAll(reason){for(const id of new Set([...records.keys(),...pendingOwners.keys()]))stop(id,reason);}
 function stopSession(sessionId,reason){const ids=new Set([...records.values()].filter(r=>r.owner.sessionId===sessionId).map(r=>r.id));for(const [id,pending]of pendingOwners)if(pending.sessionId===sessionId)ids.add(id);for(const id of ids)stop(id,reason);}
 function state(sessionId){return [...records.values()].filter(r=>r.owner.sessionId===sessionId&&r.active&&r.live()).map(r=>({version:'mima-author-host/1',owner:{...r.owner},grantRevision:r.grant.revision,capabilities:[...r.grant.capabilities],libraries:r.libraries,scriptMode:r.scriptMode,state:r.state,frozen:!!r.frozen}));}
 async function describe(sessionId,resource,script){
  const owner={sessionId,sourceId:resource.sourceId,resourceId:resource.id,path:script.path,scriptId:script.scriptId,scriptHash:C().hash(script.code)};
  C().owner(owner,resource);return owner;
 }
 function wait(record,token,label,timeout=4000){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{record.waiters.delete(token);const e=C().fail('E_AUTHOR_UNRESPONSIVE',label+'未收到作者回执；请查看已提交状态，停止脚本后再操作');fault(record,e);reject(e);},timeout);
  record.waiters.set(token,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});
 });}
 function reply(record,packet){if(record.active&&record.live()&&records.get(record.id)===record)record.port.postMessage(packet);}
 async function syncPeers(sender){
  // Publish committed state before acknowledging a completed UI action. Do not
  // replace a peer's dirty snapshot or interfere with turn/event settlement.
  if(eventSessions.has(sender.owner.sessionId)||sender.freezes)return;
  const peers=[...records.values()].filter(r=>r!==sender&&r.owner.sessionId===sender.owner.sessionId&&r.active&&r.live()&&r.initialized&&!r.failed&&!r.freezes);
  await Promise.all(peers.map(record=>{
   const work=(record.syncTail||Promise.resolve()).then(async()=>{
    if(!record.active||!record.live()||record.failed||record.freezes||eventSessions.has(record.owner.sessionId))return;
    const snapshot=await S().prepare(record.owner,record.grant.revision,()=>record.active&&record.live());
    if(snapshot.pendingTurnId||record.freezes||record.failed)return;
    const token=root.MimaCompatStore.uid('author_sync'),ack=wait(record,token,'作者共享变量刷新');
    reply(record,{type:'sync',snapshot,token});const applied=await ack;
    if(applied&&snapshot.sessionRevision>=record.snapshot.sessionRevision)record.snapshot=snapshot;
   });
   // The sender's write is already committed. A broken peer has no authority
   // to turn that successful write into a failed or repeated operation.
   record.syncTail=work.catch(e=>{if(record.active&&record.live())fault(record,e);});return record.syncTail;
  }));
 }
 async function mount(owner,source,frame,{onStatus,live,libraries=[],scriptMode='classic'}={}){
  if(!(frame instanceof HTMLIFrameElement)||typeof live!=='function'||!live())throw C().fail('E_AUTHOR_STALE','作者挂载目标已失效');
  if(typeof source!=='string'||C().hash(source)!==owner.scriptHash)throw C().fail('E_AUTHOR_OWNER','待执行源码与已声明的脚本 SHA256 不一致');
  const id=C().grantId(owner);stop(id,'作者宿主重新启动');
  const generation=generations.get(id),current=()=>generations.get(id)===generation&&live();pendingOwners.set(id,{sessionId:owner.sessionId,generation});
  try{
  if(!['classic','module'].includes(scriptMode))throw C().fail('E_AUTHOR_API_UNSUPPORTED','脚本模式无效');
  const dependencies=root.MimaAuthorLibraries?.select(libraries);if(!dependencies)throw C().fail('E_AUTHOR_DEPENDENCY','离线依赖组件未加载');
  const grant=await root.MimaCompatStore.get('grants',id);if(!grant||grant.kind!=='author_grant_v1'||grant.revokedAt)throw C().fail('E_AUTHOR_PERMISSION','请明确授予本故事作者权限');
  const snapshot=await S().prepare(owner,grant.revision,current);if(!current())throw C().fail('E_AUTHOR_STALE','读取作者快照后已停止或切换故事');
  const channel=new MessageChannel(),record={id,owner,grant,frame,port:channel.port1,onStatus,live:current,active:true,initialized:false,snapshot,libraries:dependencies.map(x=>({id:x.id,version:x.version})),scriptMode,state:'loading',tail:Promise.resolve(),batches:new Map(),emissions:new Map(),waiters:new Map(),failed:null,freezes:0};records.set(id,record);
  const readyToken=root.MimaCompatStore.uid('author_ready'),ready=wait(record,readyToken,'作者与离线依赖初始化',12000);
  // Readiness is separately acknowledged; script execution is never an implicit save.
  channel.port1.onmessage=event=>{try{
   const packet=event.data;if(!record.active||!record.live()||records.get(id)!==record||!packet||typeof packet!=='object')return;
   if(packet.type==='emit'){
    if(!Number.isSafeInteger(packet.localId)||packet.localId<1){fault(record,C().fail('E_AUTHOR_BUDGET','作者事件编号无效'));return;}
    const payload=C().value({name:packet.name,args:packet.args}),signature=JSON.stringify(payload),previous=record.emissions.get(packet.localId);
    if(previous&&previous.signature!==signature)throw C().fail('E_AUTHOR_CONFLICT','同一事件编号包含不同内容');
    if(!previous&&record.emissions.size>=2048)throw C().fail('E_AUTHOR_BUDGET','作者事件超出本次挂载预算');
    const work=previous?.promise||emitCustom(record,payload);if(!previous)record.emissions.set(packet.localId,{signature,promise:work});
    work.then(()=>reply(record,{type:'emit-result',localId:packet.localId})).catch(e=>reply(record,{type:'emit-result',localId:packet.localId,error:{code:e.code||'E_AUTHOR_EVENT',message:e.message}}));return;
   }
   if(packet.type==='commit'){
    if(!Number.isSafeInteger(packet.localId)||packet.localId<1){fault(record,C().fail('E_AUTHOR_BUDGET','作者批次编号无效'));return;}
    const signature=JSON.stringify({base:packet.base,changes:packet.changes}),previous=record.batches.get(packet.localId);
    if(previous){if(previous.signature!==signature){fault(record,C().fail('E_AUTHOR_CONFLICT','同一作者批次包含不同内容'));return;}previous.promise.then(receipt=>reply(record,{type:'commit-result',localId:packet.localId,receipt})).catch(e=>reply(record,{type:'commit-result',localId:packet.localId,error:{code:e.code,message:e.message}}));return;}
    if(record.batches.size>=2048)throw C().fail('E_AUTHOR_BUDGET','作者批次超过本次挂载预算，请停止后重新启动');
    const operation=root.MimaCompatStore.uid('author_op');status(record,'pending','作者变量正在提交，尚未保存');
    const work=record.tail.then(async()=>{
     if(record.failed||!record.active||!record.live()||record.frozen)throw C().fail('E_AUTHOR_STALE','作者页面已暂停或停止');
     const receipt=await S().commit(owner,grant.revision,packet.base,operation,packet.changes,()=>record.active&&record.live()&&!record.frozen);
     try{await S().check(owner,grant.revision);}catch(e){throw Object.assign(C().fail(e.code||'E_AUTHOR_REVOKED','变量已提交，但回执阶段授权发生变化；请以已提交变量为准'),{committed:true,operationId:receipt.operationId});}return receipt;
    });
    record.batches.set(packet.localId,{signature,promise:work});record.tail=work;
    work.then(async receipt=>{await syncPeers(record);reply(record,{type:'commit-result',localId:packet.localId,receipt});}).catch(e=>{reply(record,{type:'commit-result',localId:packet.localId,error:{code:e.code||'E_AUTHOR_COMMIT',message:e.message}});fault(record,e);});return;
   }
   if(packet.type==='state'){status(record,packet.state,String(packet.message||''));if(packet.state==='error')fault(record,C().fail('E_AUTHOR_SCRIPT',String(packet.message||'作者脚本异常')));return;}
   if(packet.type==='frozen'||packet.type==='snapshot-ready'||packet.type==='sync-ready'){
    const waiter=record.waiters.get(packet.token);if(waiter){record.waiters.delete(packet.token);if(packet.type==='frozen')record.frozen=true;waiter.resolve(packet.applied===true);}return;
   }
   if(packet.type==='ready'){
    S().check(owner,grant.revision).then(async()=>{if(!record.active||!record.live())throw C().fail('E_AUTHOR_STALE','作者初始化已失效');record.initialized=true;await syncPeers(record);record.waiters.get(readyToken)?.resolve();record.waiters.delete(readyToken);}).catch(e=>fault(record,e));
   }
  }catch(e){fault(record,e);}};
  frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
  frame.addEventListener('load',async()=>{
   try{await S().check(owner,grant.revision);if(!record.active||!record.live()||!frame.isConnected)throw C().fail('E_AUTHOR_STALE','作者页面加载途中已切换');frame.contentWindow.postMessage({type:'mima-author-init',source,snapshot,libraries:dependencies,scriptMode},'*',[channel.port2]);
    frame.addEventListener('load',()=>{if(records.get(id)===record)stop(id,'作者页面发生导航，已停止');},{once:true});
   }catch(e){fault(record,e);}
  },{once:true});
  frame.addEventListener('error',()=>fault(record,C().fail('E_AUTHOR_UNAVAILABLE','作者隔离页面加载失败')),{once:true});
  frame.src='./author-frame.html?v=r16-1-20261015-1';
  await ready;if(pendingOwners.get(id)?.generation===generation)pendingOwners.delete(id);return {id,version:C().version};
  }catch(e){if(generations.get(id)===generation)stop(id,'作者启动失败：'+e.message);throw e;}
 }
 async function freeze(record,mode){record.freezes++;const token=root.MimaCompatStore.uid('author_freeze'),promise=wait(record,token,'作者变量保存');reply(record,{type:'freeze',token,forEvent:mode==='event'});await promise;await record.tail;await S().check(record.owner,record.grant.revision);}
 async function refresh(record,events=[]){
  if(!record.active||!record.live()||record.failed)return;
  const snapshot=await S().prepare(record.owner,record.grant.revision,()=>record.active&&record.live()&&records.get(record.id)===record);await S().check(record.owner,record.grant.revision);
  const allowed=record.grant.capabilities.includes('events.listen')?events:[];
  record.frozen=false;const token=root.MimaCompatStore.uid('author_refresh'),ack=wait(record,token,'作者快照与事件结算');reply(record,{type:'snapshot',snapshot,events:allowed,token});await ack;record.snapshot=snapshot;
 }
 function messageEvents(before,after,kind,succeeded){
  if(!succeeded||!['send','retry','continue'].includes(kind))return [];
  const old=new Map(before.messages.map(x=>[x.stableId,x])),events=[];
  for(const m of after.messages){const prior=old.get(m.stableId);
   if(!prior&&['user','assistant'].includes(m.role))events.push({name:m.role==='user'?'message_sent':'message_received',args:[m.message_id]});
   else if(prior&&m.message!==prior.message)events.push({name:'message_updated',args:[m.message_id]});
  }
  const last=after.messages.filter(m=>m.role==='assistant').at(-1);if(last&&events.length)events.push({name:'generation_ended',args:[last.message_id]});return events;
 }
 async function emitCustom(sender,payload){
  const sessionId=sender.owner.sessionId;
  if(!sender.grant.capabilities.includes('events.emit')||typeof payload.name!=='string'||!/^[^\u0000-\u001f]{1,128}$/.test(payload.name)||/^(?:message_|generation_|js_|chat_id_changed|app_ready|mima\.)/i.test(payload.name)||!Array.isArray(payload.args)||payload.args.length>32)throw C().fail('E_AUTHOR_EVENT','未授权的事件，或试图发送保留的宿主事件');
  const active=[...records.values()].filter(r=>r.owner.sessionId===sessionId&&r.active&&r.live());
  if(eventSessions.has(sessionId)||active.some(r=>r.freezes||r.failed))throw C().fail('E_AUTHOR_EVENT_REENTRANT','事件结算或剧情操作期间不支持嵌套跨作者广播');
  eventSessions.add(sessionId);
  try{await S().check(sender.owner,sender.grant.revision);await Promise.all(active.map(r=>freeze(r,'event')));
   const results=await Promise.allSettled(active.map(r=>refresh(r,[payload])));results.forEach((x,i)=>{if(x.status==='rejected')fault(active[i],x.reason);});const failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;
   await S().check(sender.owner,sender.grant.revision);
  }catch(e){for(const record of active)if(record.frozen&&!record.failed)fault(record,C().fail(e.code||'E_AUTHOR_EVENT','广播未完整结算；已提交变量保留：'+e.message));throw e;}
  finally{for(const record of active)record.freezes=Math.max(0,record.freezes-1);eventSessions.delete(sessionId);}
 }
 async function withTurn(sessionId,work,kind='preview'){
  const active=[...records.values()].filter(r=>r.owner.sessionId===sessionId&&r.active&&r.live());
  if(!active.length)return work();
  if(eventSessions.has(sessionId)||active.some(r=>r.freezes||r.failed||!r.initialized))throw C().fail('E_AUTHOR_BUSY','作者初始化/事件尚未结算或上次失败，请处理或停止脚本后再发送');
  let succeeded=false;
  try{
   await Promise.all(active.map(freeze));
   const result=await work();succeeded=true;return result;
  }finally{
   const resumed=await Promise.allSettled(active.map(async record=>{
    try{if(!record.active||!record.live()||record.failed)return;
    const snapshot=await S().prepare(record.owner,record.grant.revision,()=>record.active&&record.live()&&records.get(record.id)===record);
    const events=messageEvents(record.snapshot,snapshot,kind,succeeded);await refresh(record,events);
    }finally{record.freezes=Math.max(0,record.freezes-1);}
   }));
   resumed.forEach((item,i)=>{if(item.status==='rejected'){fault(active[i],item.reason);console.error('剧情生命周期与作者刷新分别结算',item.reason);}});
  }
 }
 async function revoke(owner){stop(C().grantId(owner),'作者权限已撤销');return S().revoke(owner);}
 root.MimaAuthorHost=Object.freeze({version:'mima-author-host/1',describe,mount,grant:(owner,caps,options={})=>S().grant(owner,caps,options.live||(()=>true)),revoke,stop,stopSession,unmountAll,withTurn,state});
})(typeof window!=='undefined'?window:globalThis);
