/* Standalone compatibility session and limited, explicitly non-equivalent World Info engine. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatRuntime=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';const store=()=>root.MimaCompatStore;
const error=(code,message)=>Object.assign(new Error(message),{code});const words=s=>Array.isArray(s)?s:typeof s==='string'?s.split(',').map(x=>x.trim()).filter(Boolean):[];
const hashKey=e=>String(e.uid??e.id??e.comment??e.name??'entry');
const flags=['excludeRecursion','preventRecursion','delayUntilRecursion','sticky','cooldown','delay','group','groupOverride','groupWeight','useProbability','scanDepth'];
function wiPosition(e){const ext=e.extensions||{};if(Number.isInteger(ext.position))return ext.position;if(Number.isInteger(e.position))return e.position;return e.position==='before_char'?0:e.position==='after_char'?1:null;}
function unsupportedWI(e){const ext=e.extensions||{},gaps=[];
  const position=wiPosition(e);if(![0,1,4].includes(position))gaps.push('position '+String(e.position)+' requires official ST comparison');
  const n=k=>ext[k]??e[k];
  for(const [key,flag] of [['exclude_recursion','excludeRecursion'],['prevent_recursion','preventRecursion'],['delay_until_recursion','delayUntilRecursion']])if(n(key)===true||e[flag]===true)gaps.push(flag+' recursive activation requires pinned upstream trace');
  for(const key of ['sticky','cooldown','delay','group','outlet_name','vectorized'])if(n(key)!==undefined&&n(key)!==null&&n(key)!==false&&n(key)!==0&&n(key)!=='')gaps.push(key+' requires golden parity');
  if(ext.group_override===true||ext.use_group_scoring===true||e.groupOverride===true)gaps.push('group scoring requires golden parity');
  if(ext.useProbability===true||e.useProbability===true){const chance=Number(ext.probability??e.probability??100);if(chance!==100)gaps.push('probability <100 requires reproducible ST RNG parity');}
  if(Number(ext.scan_depth??e.scanDepth??0)<0)gaps.push('invalid per-entry scanDepth');
  if(ext.role!==undefined&&![0,1,2].includes(Number(ext.role)))gaps.push('unknown in-chat role');
  return gaps;
}
function validRegex(pattern){if(/(?:\w[*+?]){3,}/.test(pattern))throw error('E_REGEX_BUDGET','同步兼容 API 拒绝未证明安全的重复量词，交由隔离 Worker');if(pattern.length>512||/(\([^)]*[+*][^)]*\)[+*{])/.test(pattern)||/\([^)]*\)[+*{]/.test(pattern)||/\\[1-9]/.test(pattern)||/\(\?/.test(pattern))throw error('E_REGEX_BUDGET','复杂/潜在灾难性回溯正则未获沙箱预算校验');let m=pattern.match(/^\/(.*)\/([dgimsuvy]*)$/);const body=m?m[1]:pattern;if(/[.*+?^${}()|[\]\\]/.test(body))throw error('E_REGEX_ISOLATION_REQUIRED','同步兼容 API 仅支持安全字面量模式；复杂正则交给隔离 Worker');return m?new RegExp(m[1],m[2]):null;}
function hasKey(text,key,settings){if(typeof key==='string'&&key.startsWith('/'))throw error('E_REGEX_ISOLATION_REQUIRED','World Info 正则关键词需要隔离 Worker，不能在主线程求值');let src=String(text),k=String(key);if(!settings.caseSensitive){src=src.toLocaleLowerCase();k=k.toLocaleLowerCase();}if(!k)return false;let index=src.indexOf(k);if(index<0)return false;if(settings.matchWholeWords&&/^[\p{Script=Latin}\d_]+$/u.test(k)){const re=new RegExp('(^|[^\\p{L}\\d_])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\d_])','u');return re.test(src);}return true;}
function worldInfo(entries,history,settings={}){
 const inserted=[],skipped=[],matched=[];
 let used=0;const budget=Number.isFinite(settings.budgetChars)?settings.budgetChars:16000;
 const scanDepth=Math.max(0,Number(settings.scanDepth??100));
 const text=history.slice(-scanDepth||0).map(m=>String(m.role)+': '+m.content).join('\n');
 const ordered=[...entries].map((e,idx)=>({e,idx})).sort((a,b)=>Number(b.e?.constant||false)-Number(a.e?.constant||false)||Number(b.e?.insertion_order??b.e?.order??100)-Number(a.e?.insertion_order??a.e?.order??100)||a.idx-b.idx);
 for(const {e,idx} of ordered){
  if(!e||typeof e!=='object'){skipped.push({entryId:String(idx),reason:'invalid object'});continue;}
  const id=hashKey(e),gaps=unsupportedWI(e);
  if(gaps.length){skipped.push({entryId:id,reason:'E_RESOURCE_SEMANTIC_GAP',gaps});continue;}
  if(e.disable===true||e.enabled===false){skipped.push({entryId:id,reason:'disabled'});continue;}
  const primary=words(e.key??e.keys),secondary=words(e.keysecondary??e.secondary_keys);
  const opt={caseSensitive:e.extensions?.case_sensitive??e.caseSensitive??settings.caseSensitive??false,matchWholeWords:e.extensions?.match_whole_words??e.matchWholeWords??settings.matchWholeWords??false};
  const regexKey=!!e.use_regex||!!e.useRegex;
  // Regex WI-key matching belongs in a killable worker; the synchronous legacy path deliberately never evaluates it.
  function hitKey(k){if(regexKey||String(k).startsWith('/')){
    // Literal phrases without regex metacharacters are equivalent for the common card use case.
    if(/[*+?()[\]{}|\\^$.]/.test(String(k)))throw error('E_REGEX_ISOLATION_REQUIRED','正则关键词必须走隔离运行');
  }
    return hasKey(text,k,opt);
  }
  let hit=false;try{
    hit=!!e.constant||primary.some(hitKey);
    if(hit&&e.selective===true&&secondary.length){const found=secondary.filter(hitKey).length,logic=Number(e.extensions?.selectiveLogic??e.selectiveLogic??0);hit=logic===0?found>0:logic===1?found===secondary.length:logic===2?found===0:found!==secondary.length;}
  }catch(ex){skipped.push({entryId:id,reason:ex.code||'E_WORLDINFO_EVAL',gaps:[ex.message]});continue;}
  if(!hit){skipped.push({entryId:id,reason:'no matching key'});continue;}
  const content=String(e.content||'');matched.push({entryId:id,reason:e.constant?'constant':'keyword'});
  if(used+content.length>budget){skipped.push({entryId:id,reason:'budget',chars:content.length});continue;}
  const position=wiPosition(e),depth=position===4?Number(e.extensions?.depth??e.depth??0):0;
  if(!Number.isInteger(depth)||depth<0||depth>100){skipped.push({entryId:id,reason:'E_RESOURCE_SEMANTIC_GAP',gaps:['invalid in-chat depth']});continue;}
  used+=content.length;inserted.push({entryId:id,content,position,depth,order:Number(e.order??e.insertion_order??100),role:position===4?['system','user','assistant'][Number(e.extensions?.role??e.role??0)]:'system',sourcePath:'world_info.entries['+idx+']'});
 }
 inserted.sort((a,b)=>a.order-b.order||Number(a.sourcePath.match(/\d+/)?.[0]??0)-Number(b.sourcePath.match(/\d+/)?.[0]??0));
 return{matched,inserted,skipped,budgetChars:budget,usedChars:used,semanticGaps:skipped.filter(x=>x.gaps),parityVerified:false};
}
function applyRegex(input,rules,phase,{isMarkdown=false,depth=0}={}){let out=String(input),trace=[];for(const [i,r]of rules.entries()){if(!r||r.disabled===true)continue;const placement=r.placement;if(!Array.isArray(placement)||!placement.includes(phase))continue;
if(r.markdownOnly===true&&!isMarkdown||r.promptOnly===true&&isMarkdown||Number.isInteger(r.minDepth)&&depth<r.minDepth||Number.isInteger(r.maxDepth)&&depth>r.maxDepth)continue;
if(r.substituteRegex!==undefined&&r.substituteRegex!==0)throw error('E_REGEX_PHASE_UNSUPPORTED','ST substituteRegex 宏替换尚未对照；规则 '+i+' 已阻断');if((r.trimStrings||[]).length)throw error('E_REGEX_PHASE_UNSUPPORTED','ST trimStrings 尚未对照；规则 '+i+' 已阻断');let re;try{re=validRegex(r.findRegex||'');if(!re)re=new RegExp(r.findRegex||'',r.flags||'g');}catch(e){throw error(e.code||'E_REGEX_PHASE_UNSUPPORTED','正则规则 '+i+' 无法安全执行：'+e.message);}out=out.replace(re,String(r.replaceString??''));trace.push({index:i,phase,beforeLength:String(input).length,afterLength:out.length});}return{output:out,trace};}
function macro(str,ctx){let unsupported=[];const value=String(str??'').replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(original,k)=>{const id=k.trim().toLowerCase();if(id==='char')return ctx.char||'角色';if(id==='user')return ctx.user||'玩家';unsupported.push(id);return original;});return{value,unsupported};}
function entriesFromResources(resources){let entries=[];for(const r of resources)if(r.kind==='world_info'){const b=r.raw;const data=b?.entries;if(Array.isArray(data))entries.push(...data);else if(data&&typeof data==='object')entries.push(...Object.values(data));}return entries;}
function readRegex(resources){const all=[];for(const r of resources)if(r.kind==='regex'){const v=r.raw;if(Array.isArray(v))all.push(...v);else if(v&&typeof v==='object')all.push(v);}return all;}
function createEnvelope(session,resources,messages,userText,{skipRegex=false}={}){const card=resources.find(r=>r.kind==='character')?.raw;if(!card)throw error('E_RESOURCE_SEMANTIC_GAP','本来源没有已选定角色');const name=card.name||'角色',u=session.userName||'玩家';const history=messages.filter(m=>m.status==='committed').map(m=>({role:m.role,content:m.canonicalContent}));
const wi=worldInfo(entriesFromResources(resources),[...history,{role:'user',content:userText}],{budgetChars:session.worldInfoBudget??16000});const regex=readRegex(resources);const ctx={char:name,user:u};const segments=[];let gaps=[...wi.semanticGaps];function add(slot,value){if(!value)return;const expanded=macro(value,ctx);if(expanded.unsupported.length)gaps.push({slot,reason:'E_RESOURCE_SEMANTIC_GAP',macros:expanded.unsupported});segments.push({id:'segment_'+segments.length,slot,role:'system',content:expanded.value,tokenEstimate:Math.ceil(expanded.value.length/3),source:name});}
for(const e of wi.inserted.filter(e=>e.position===0))add('world_info_before',e.content);
add('character_description',card.description);add('personality',card.personality);add('scenario',card.scenario);add('system_prompt',card.system_prompt);
for(const e of wi.inserted.filter(e=>e.position===1))add('world_info_after',e.content);
add('mes_example',card.mes_example);
if(card.post_history_instructions){gaps.push({slot:'post_history_instructions',reason:'exact role/order parity not verified; text retained in last system envelope'});add('post_history_instructions',card.post_history_instructions);}
const content=segments.map(s=>`[${s.slot}]\n${s.content}`).join('\n\n');let userProjection=skipRegex?{output:String(userText),trace:[]}:applyRegex(userText,regex,1,{isMarkdown:false});let assistantHistory=history.map(m=>({role:m.role,content:m.role==='assistant'&&!skipRegex?applyRegex(m.content,regex,2,{isMarkdown:false}).output:m.content}));const payload=[{role:'system',content},...assistantHistory,{role:'user',content:userProjection.output}];
for(const e of wi.inserted.filter(e=>e.position===4).sort((a,b)=>b.depth-a.depth||a.order-b.order)){
  const at=Math.max(1,payload.length-e.depth);payload.splice(at,0,{role:e.role,content:e.content,worldInfoEntryId:e.entryId,worldInfoDepth:e.depth});
}

return{segments,worldInfo:wi,regexTrace:userProjection.trace,messages:payload,gaps,provider:'OpenAI-compatible',estimatedTokens:payload.reduce((n,m)=>n+Math.ceil(m.content.length/3),0)};}
async function getSession(id){const s=await store().get('compat_sessions',id);if(!s)throw error('E_STORE_UNVERIFIED','未找到兼容剧情');return s;}
async function createSession(sourceId,options={}){const source=await store().get('source_capsules',sourceId);if(!source)throw error('E_STORE_UNVERIFIED','来源包不存在');const resources=(await store().all('resource_ir')).filter(r=>r.sourceId===sourceId);const charCandidates=resources.filter(x=>x.kind==='character');const selection=options.characterResourceId?charCandidates.find(x=>x.id===options.characterResourceId):charCandidates.length===1?charCandidates[0]:null;if(!selection)throw error('E_RESOURCE_SEMANTIC_GAP','发现多个角色版本或没有角色；请先明确选择');
const idx=Number(options.greetingIndex??0),card=selection.raw||{},alternates=Array.isArray(card.alternate_greetings)?card.alternate_greetings:[];if(!Number.isInteger(idx)||idx<0||idx>alternates.length)throw error('E_RESOURCE_SEMANTIC_GAP','开场白索引无效');const greeting=String(idx===0?card.first_mes||'':alternates[idx-1]||'');const id=store().uid('compat'),now=new Date().toISOString(),session={id,mode:'native_compat',sourceId,characterResourceId:selection.id,title:options.title||selection.name||'兼容剧情',userName:options.userName||'玩家',activeBranchId:'main',greetingIndex:idx,revision:1,turnIndex:0,pendingTurnId:null,worldInfoBudget:16000,createdAt:now,mountGraph:[],readiness:'limited_runtime'};
const db=await store().open();await new Promise((resolve,reject)=>{const tx=db.transaction(['compat_sessions','messages'],'readwrite');tx.objectStore('compat_sessions').add(session);if(greeting){const spoken=macro(greeting,{char:card.name||'角色',user:session.userName});tx.objectStore('messages').add({id:'opening_'+id,sessionId:id,turnId:null,role:'assistant',rawContent:greeting,canonicalContent:spoken.value,status:'committed',sequence:-1,opening:true,greetingIndex:idx,unknownMacros:spoken.unsupported,revision:1,createdAt:now});}tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||error('E_STORE_UNVERIFIED','建立剧情事务失败'));};});return getSession(id);}
async function sessionMessages(sessionId){
 const [raw,jobs]=await Promise.all([store().all('messages'),store().all('events_jobs')]);
 const settlement=new Map(jobs.filter(j=>j.sessionId===sessionId).map(j=>[j.id,j.settlement]));
 for(const m of raw){if(m.sessionId===sessionId&&m.turnId&&!settlement.has(m.turnId))throw error('E_STORE_UNVERIFIED','消息缺少可验证 turn journal，禁止投影为正常历史：'+m.id);}
 return raw.filter(m=>m.sessionId===sessionId).sort((a,b)=>a.sequence-b.sequence).map(m=>{
  const effective=m.turnId?settlement.get(m.turnId):null;
  if(effective&&effective!=='committed'&&m.status==='committed')return{...m,status:effective,storedStatus:m.status,legacyProjectionQuarantined:true};
  return m;
 });
}

async function mountResource(sessionId,resourceId){
  const [session,resources,sources]=await Promise.all([getSession(sessionId),store().all('resource_ir'),store().all('source_capsules')]);
  const resource=resources.find(r=>r.id===resourceId),source=resource&&sources.find(s=>s.id===resource.sourceId);
  if(!resource||!source||source.sha256!==resource.sourceId.slice(7))throw error('E_STORE_UNVERIFIED','挂载资源的不可变来源指纹缺失');
  if(resource.kind==='character')throw error('E_RESOURCE_SEMANTIC_GAP','禁止把外置角色直接改写当前剧情身份');
  if(!['world_info','regex','preset','prompt_presets','css','html_template','media','script_source'].includes(resource.kind))throw error('E_RESOURCE_SEMANTIC_GAP','该资源只能原样查看，暂不能挂载');
  if(resource.sourceId===session.sourceId)throw error('E_CANONICAL_CONFLICT','本卡包绑定资源已随角色可见，无需重复挂载');
  const graph=Array.isArray(session.mountGraph)?session.mountGraph:[];
  if(graph.some(m=>m.resourceId===resourceId))throw error('E_CANONICAL_CONFLICT','该资源已经挂载');
  const mount={resourceId,sourceId:source.id,sha256:source.sha256,kind:resource.kind,path:resource.path,order:graph.length,enabled:true,unmetDependencies:['preset','prompt_presets'].includes(resource.kind)?['ST prompt-manager preset parity unverified']:resource.kind==='script_source'?['Requires explicit per-script grant and supported API']:[],mountedAt:new Date().toISOString()};
  await store().putCAS('compat_sessions',{...session,mountGraph:[...graph,mount]},session.revision);
  return mount;
}
async function unmountResource(sessionId,resourceId){
  const session=await getSession(sessionId),graph=Array.isArray(session.mountGraph)?session.mountGraph:[];
  if(!graph.some(m=>m.resourceId===resourceId))throw error('E_CANONICAL_CONFLICT','资源没有挂载');
  await store().putCAS('compat_sessions',{...session,mountGraph:graph.filter(m=>m.resourceId!==resourceId)},session.revision);
  return{unmounted:resourceId};
}
async function resolveMedia(sessionId,resourceId){
  const session=await getSession(sessionId),resources=await resourcesFor(session),media=resources.find(r=>r.id===resourceId&&r.kind==='media');
  if(!media)throw error('E_PLUGIN_PERMISSION_DENIED','媒体不是当前剧情已挂载的资源');
  const source=await store().get('source_capsules',media.sourceId);
  if(!source||!(source.bytes instanceof Uint8Array)||!source.sha256||await root.MimaCompatImport.digest(source.bytes)!==source.sha256)throw error('E_SOURCE_CORRUPT','媒体来源包 SHA256 校验失败');
  if(!['charx','zip'].includes(source.format))throw error('E_RESOURCE_SEMANTIC_GAP','此媒体不来自 ZIP/CHARX 可寻址资产');
  const path=media.raw?.embeddedPath||String(media.raw?.uri||'').replace(/^embeded:\/\//,'');
  if(typeof path!=='string'||!path||path.includes('..')||path.startsWith('/')||path.includes('\\'))throw error('E_ZIP_PATH_TRAVERSAL','媒体资产路径不安全');
  const entries=await root.MimaCompatImport.readZip(source.bytes),item=entries.find(x=>x.name===path);
  if(!item)throw error('E_SOURCE_CORRUPT','来源卡包缺少素材：'+path);
  const sha=await root.MimaCompatImport.digest(item.bytes);
  if(media.raw?.sha256&&sha!==media.raw.sha256)throw error('E_SOURCE_CORRUPT','素材哈希与无损索引不一致');
  const mime=media.raw?.mime||(/\.(png)$/i.test(path)?'image/png':/\.(jpe?g)$/i.test(path)?'image/jpeg':/\.(webp)$/i.test(path)?'image/webp':/\.(mp3)$/i.test(path)?'audio/mpeg':/\.(ogg)$/i.test(path)?'audio/ogg':/\.(wav)$/i.test(path)?'audio/wav':'');
  if(!/^image\/(?:png|jpeg|webp)$|^audio\/(?:mpeg|ogg|wav)$/.test(mime))throw error('E_RESOURCE_SEMANTIC_GAP','未知或不安全的媒体类型');
  return{blob:new Blob([item.bytes],{type:mime}),mime,sha256:sha,path};
}
async function resourcesFor(s){
  const all=await store().all('resource_ir'),fromSource=all.filter(r=>r.sourceId===s.sourceId);
  const selected=fromSource.find(r=>r.id===s.characterResourceId&&r.kind==='character');
  if(!selected)throw error('E_STORE_UNVERIFIED','角色资源版本不存在，禁止混用其它版本资源');
  const prefix=selected.path.replace(/\.data$/,'');
  const base=fromSource.filter(item=>{if(item.kind==='character')return item.id===s.characterResourceId;const owner=/^(png\.(?:chara|ccv3)\[\d+\])(?:\.|$)/.exec(item.path);if(owner)return owner[1]===prefix;return true;});
  const graph=Array.isArray(s.mountGraph)?s.mountGraph:[],external=[];
  for(const mount of graph.filter(x=>x.enabled).sort((a,b)=>a.order-b.order)){
    const item=all.find(r=>r.id===mount.resourceId&&r.sourceId===mount.sourceId);
    if(!item)throw error('E_STORE_UNVERIFIED','挂载图引用不存在的资源 '+mount.resourceId);
    if(item.sourceId!=='sha256:'+mount.sha256||item.path!==mount.path||item.kind!==mount.kind)throw error('E_SOURCE_CORRUPT','挂载资源来源指纹或路径被改变');
    if(!base.some(r=>r.id===item.id)&&!external.some(r=>r.id===item.id))external.push(item);
  }
  return [...base,...external];
}
async function createEnvelopeAsync(session,resources,messages,userText,options={}){
  const out=createEnvelope(session,resources,messages,userText,{skipRegex:true}),regex=readRegex(resources);
  const isolate=root.MimaCompatRegexIsolation;
  const warn=(stage,e)=>{out.gaps.push({reason:e.code||'E_REGEX_WORKER_FAILED',stage,details:e.message,rawRetained:true});};
  if(!isolate){if(regex.length)warn('worker',error('E_REGEX_ISOLATION_UNAVAILABLE','无法初始化隔离正则执行器'));return out;}
  const queue=out.messages.map((msg,idx)=>({msg,idx,phase:msg.role==='assistant'?2:msg.role==='user'?1:null})).filter(x=>x.idx>0&&x.phase!==null);
  try{
    const transformed=await isolate.applyBatch(queue.map(x=>({input:x.msg.content,phase:x.phase,options:{isMarkdown:false}})),regex,{signal:options.signal});
    transformed.forEach((item,i)=>{const {msg,idx}=queue[i];if(item.ok){msg.content=item.result.output;out.regexTrace.push(...item.result.trace.map(t=>({...t,messageIndex:idx})));}else warn('prompt '+msg.role+' #'+idx,error(item.error.code,item.error.message));});
  }catch(e){warn('prompt batch',e);/* Preserve canonical message contents on isolation failure. */}
  out.estimatedTokens=out.messages.reduce((n,m)=>n+Math.ceil(m.content.length/3),0);
  return out;
}
async function preview(sessionId,input,options={}){const s=await getSession(sessionId),msgs=await sessionMessages(sessionId),resources=await resourcesFor(s);return createEnvelopeAsync(s,resources,msgs,input,options);}
async function transition(sessionId,work){const db=await store().open();return new Promise((resolve,reject)=>{const tx=db.transaction(['compat_sessions','messages','events_jobs'],'readwrite'),s=tx.objectStore('compat_sessions'),m=tx.objectStore('messages'),j=tx.objectStore('events_jobs');let result,issue;const q=s.get(sessionId);q.onsuccess=()=>{try{const current=q.result;if(!current)throw error('E_STORE_UNVERIFIED','剧情已不存在');result=work(current,{s,m,j});}catch(e){issue=e;tx.abort();}};q.onerror=()=>{issue=q.error;tx.abort();};tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_CANONICAL_CONFLICT','剧情事务中止'));};});}
async function beginTurn(sessionId,text){
  if(!String(text).trim())throw error('E_STORY_RUNTIME','请输入消息');
  return transition(sessionId,(s,{s:sessionStore,m,j})=>{
    if(s.pendingTurnId)throw error('E_CANONICAL_CONFLICT','存在未结算回合，须先恢复、终止或确认原状态');
    const turnId=store().uid('turn'),attemptId=store().uid('attempt'),msgId='u_'+turnId,sequence=s.turnIndex*2,now=new Date().toISOString();
    m.add({id:msgId,sessionId,turnId,role:'user',rawContent:text,canonicalContent:text,status:'pending',sequence,revision:1,createdAt:now});
    j.add({id:turnId,sessionId,msgId,attemptId,attempt:1,sequence,stage:'INPUT_RECORDED',settlement:'pending',revision:1,createdAt:now});
    sessionStore.put({...s,turnIndex:s.turnIndex+1,pendingTurnId:turnId,revision:s.revision+1});
    return{turnId,attemptId,sessionRevision:s.revision+1,msgId,sequence,text};
  });
}
async function finishTurn(sessionId,t,reply,code=''){
  return transition(sessionId,(s,{s:sessionStore,m,j})=>{
    const receipt={turnId:t.turnId,attemptId:t.attemptId,settlement:null};
    const jobRequest=j.get(t.turnId);
    jobRequest.onsuccess=()=>{
      const job=jobRequest.result;
      if(!job||job.sessionId!==sessionId||job.attemptId!==t.attemptId||job.settlement!=='pending'||s.pendingTurnId!==t.turnId){
        /* Do not abort the transaction solely because a fenced old response arrived: no writes occur. */
        return;
      }
      const ok=typeof reply==='string'&&reply.trim().length>0;
      const status=ok?'committed':code==='E_TURN_ABORTED'?'aborted':'failed';
      const msgRequest=m.get(job.msgId);
      msgRequest.onsuccess=()=>{
        const user=msgRequest.result;
        if(!user||user.turnId!==t.turnId||!['pending','failed'].includes(user.status)){try{msgRequest.transaction.abort();}catch(_){}return;}
        receipt.settlement=status;
        m.put({...user,status,revision:(user.revision||0)+1,settledAt:new Date().toISOString()});
        if(ok)m.add({id:'a_'+t.turnId,sessionId,turnId:t.turnId,role:'assistant',rawContent:reply,canonicalContent:reply,status:'committed',sequence:job.sequence+1,revision:1,createdAt:new Date().toISOString()});
        j.put({...job,stage:ok?'CANONICAL_COMMITTED':status==='aborted'?'ABORTED':'FAILED_REQUEST',settlement:status,code,revision:job.revision+1,settledAt:new Date().toISOString()});
        sessionStore.put({...s,pendingTurnId:null,revision:s.revision+1,lastSettledTurnId:t.turnId});
      };
    };
    return receipt;
  });
}
async function turnJournal(sessionId){
  const [session,jobs]=await Promise.all([getSession(sessionId),store().all('events_jobs')]);
  const mine=jobs.filter(j=>j.sessionId===sessionId).sort((a,b)=>(a.sequence??0)-(b.sequence??0));
  if(session.pendingTurnId&&!mine.some(j=>j.id===session.pendingTurnId))throw error('E_STORE_UNVERIFIED','未结算回合缺少 journal，禁止自动重置 pending 标志');
  return mine;
}
async function recoverTurn(sessionId,turnId,action,expectedAttemptId){
  if(!['retry','abort'].includes(action))throw error('E_CANONICAL_CONFLICT','未知恢复操作');
  return transition(sessionId,(s,{s:sessionStore,m,j})=>{
    const receipt={turnId,action};
    const req=j.get(turnId);
    req.onsuccess=()=>{
      const job=req.result;
      if(!job||job.sessionId!==sessionId||(expectedAttemptId!==undefined&&job.attemptId!==expectedAttemptId)||!['pending','failed'].includes(job.settlement)||
         s.pendingTurnId&&s.pendingTurnId!==turnId){try{req.transaction.abort();}catch(_){}return;}
      // A past failed turn cannot be replayed into an already committed newer timeline.
      const tx=req.transaction,jobSeq=job.sequence;
      const all=tx.objectStore('messages').getAll();
      all.onsuccess=()=>{
        if(all.result.some(v=>v.sessionId===sessionId&&v.sequence>jobSeq&&v.status==='committed'&&!v.opening)){tx.abort();return;}
        const request=m.get(job.msgId||'u_'+turnId);
        request.onsuccess=()=>{
          const user=request.result;if(!user||user.sessionId!==sessionId||user.turnId!==turnId){tx.abort();return;}
          const nextRev=s.revision+1;receipt.sessionRevision=nextRev;
          if(action==='abort'){
            m.put({...user,status:'aborted',revision:(user.revision||0)+1});
            j.put({...job,msgId:job.msgId||'u_'+turnId,sequence:jobSeq,attemptId:job.attemptId||'legacy_unknown',stage:'ABORTED_BY_USER',settlement:'aborted',code:'E_TURN_ABORTED',revision:job.revision+1});
            sessionStore.put({...s,pendingTurnId:null,revision:nextRev,lastSettledTurnId:turnId});
          }else{
            const newAttemptId=store().uid('attempt');receipt.attemptId=newAttemptId;
            m.put({...user,status:'pending',revision:(user.revision||0)+1});
            j.put({...job,msgId:job.msgId||'u_'+turnId,sequence:jobSeq,attempt:(job.attempt||1)+1,attemptId:newAttemptId,stage:'RETRY_ADMITTED',settlement:'pending',code:'',revision:job.revision+1});
            sessionStore.put({...s,pendingTurnId:turnId,revision:nextRev});
          }
        };
      };
    };
    return receipt;
  });
}
function notifyPlugins(sessionId,name,payload,eventId){
 const plugins=root.MimaCompatPlugins;if(!plugins?.publish)return;
 Promise.resolve().then(()=>plugins.publish(sessionId,name,payload,eventId)).catch(e=>{
  if(root.console?.warn)root.console.warn('Mima compat plugin delivery failed', {sessionId,turnId:payload.turnId,stage:name,error:e.message});
 });
}
async function dispatch(sessionId,t,options={}){
  try{
    const session=await getSession(sessionId),msgs=await sessionMessages(sessionId),resources=await resourcesFor(session);
    const history=msgs.filter(m=>m.turnId!==t.turnId&&m.sequence<t.sequence),envelope=await createEnvelopeAsync(session,resources,history,t.text,options);
    if(envelope.gaps.length&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','本回合含未确认的语义差异，保留消息待重试');
    const cfg=root.MimaStandalone?.getApiConfig?.();if(!cfg)throw error('E_API_CONFIG','未配置原生 API');
    const reply=await root.MimaStandalone.callModelWithConfig(envelope.messages,cfg,0.85,options.signal,{streamOverride:false});
    if(!String(reply||'').trim())throw error('E_API_EMPTY_REPLY','模型没有返回正文');
    const result=await finishTurn(sessionId,t,String(reply));
    const settled=await store().get('events_jobs',t.turnId);
    if(result.settlement!=='committed'||!settled||settled.attemptId!==t.attemptId||settled.settlement!=='committed')throw error('E_CANONICAL_CONFLICT','回合已由更新的 attempt 处理，旧回复拒绝投递');
    notifyPlugins(sessionId,'turn.committed',{turnId:t.turnId,attemptId:t.attemptId},'turn.committed:'+t.turnId);return{reply:String(reply),turnId:t.turnId,envelope,result};
  }catch(e){
    try{const transitionReceipt=await finishTurn(sessionId,t,null,e.code||'E_STORY_RUNTIME');const final=await store().get('events_jobs',t.turnId);if(transitionReceipt.settlement==='failed'&&final?.attemptId===t.attemptId&&final.settlement==='failed')notifyPlugins(sessionId,'turn.failed',{turnId:t.turnId,attemptId:t.attemptId,code:final.code},'turn.failed:'+t.turnId+':'+t.attemptId);}catch(settle){e.settlementError=settle.message;}
    throw e;
  }
}
async function send(sessionId,text,options={}){
  const check=await preview(sessionId,text,{signal:options.signal});
  if(check.gaps.length&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','资源存在未验证语义，请确认后再发送');
  const t=await beginTurn(sessionId,text);
  return dispatch(sessionId,t,options);
}
async function retryTurn(sessionId,turnId,options={}){
  const before=await store().get('events_jobs',turnId),message=before?await store().get('messages',before.msgId||'u_'+turnId):null;
  if(!before||!message||before.sessionId!==sessionId)throw error('E_STORE_UNVERIFIED','原回合数据无法验证');
  const s=await getSession(sessionId),resources=await resourcesFor(s),msgs=await sessionMessages(sessionId);
  const check=await createEnvelopeAsync(s,resources,msgs.filter(m=>m.sequence<(before.sequence??Math.max(0,(s.turnIndex-1)*2))),message.rawContent,options);
  if(check.gaps.length&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','重试前需要确认资源语义差异');
  const receipt=await recoverTurn(sessionId,turnId,'retry',before.attemptId);
  if(!receipt.attemptId||!receipt.sessionRevision)throw error('E_CANONICAL_CONFLICT','恢复事务未能取得本次 attempt 权威');
  return dispatch(sessionId,{turnId,attemptId:receipt.attemptId,sessionRevision:receipt.sessionRevision,msgId:before.msgId||'u_'+turnId,sequence:before.sequence??Math.max(0,(s.turnIndex-1)*2),text:message.rawContent},options);
}
async function displayMessages(sessionId){
  const s=await getSession(sessionId),resources=await resourcesFor(s),regex=readRegex(resources),items=await sessionMessages(sessionId);
  const assistant=items.filter(m=>m.role==='assistant'&&m.status==='committed');
  let results=[];try{results=await root.MimaCompatRegexIsolation.applyBatch(assistant.map(m=>({input:m.canonicalContent,phase:2,options:{isMarkdown:true}})),regex,{budgetMs:Math.min(5000,300+assistant.length*8)});}
  catch(e){results=assistant.map(()=>({ok:false,error:{code:e.code||'E_REGEX_WORKER_FAILED',message:e.message}}));}
  const byId=new Map(assistant.map((m,i)=>[m.id,results[i]]));
  return items.map(m=>{const packet=byId.get(m.id);if(!packet)return{...m,displayView:m.canonicalContent};return packet.ok?{...m,displayView:packet.result.output,displayTrace:packet.result.trace}:{...m,displayView:m.canonicalContent,displayError:{code:packet.error.code,message:packet.error.message,rawRetained:true}};});
}
return Object.freeze({worldInfo,unsupportedWI,applyRegex,macro,createEnvelope,createEnvelopeAsync,createSession,getSession,sessionMessages,resourcesFor,mountResource,unmountResource,resolveMedia,preview,send,retryTurn,recoverTurn,turnJournal,displayMessages,beginTurn,finishTurn});
});
