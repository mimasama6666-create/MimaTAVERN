/* Advanced workbench: all DOM and state scoped to #compat-lab; native app remains untouched. */
(function(root){'use strict';if(typeof document==='undefined')return;const $=id=>document.getElementById(id),s=()=>root.MimaCompatStore,i=()=>root.MimaCompatImport,r=()=>root.MimaCompatRuntime,onboard=()=>root.MimaCompatOnboarding;let opened=false,scan=null,activeId='',busy=false,creating=false,forking=false,player=null,assetUrls=[],cardPreviewUrl='',scanGeneration=0,sessionGeneration=0,messageRenderGeneration=0;const approvedBasicPreflights=new Map();const busySessions=new Set();let selectedMvuTemplate=null; // ephemeral manual preview; never stored in the chat or card

// Cross-tab signals never carry character text or state. Resolve against the
// canonical turn ledger, then re-read the currently visible session.
let unsubscribeLiveSync=null;
const remoteDeliveries=new Set();
const storyDrafts=new Map();let regexUI=null,readerCoverUrl='',readerCoverSource='',sheetPane='effects';
async function onExternalSettlement(hint){
 if(!opened||!activeId||activeId!==hint.sessionId)return;
 const owner=activeId,generation=sessionGeneration;
 const job=await s().get('events_jobs',hint.jobId);
 if(!job||job.sessionId!==owner||job.id!==hint.jobId||job.attemptId!==hint.attemptId||job.settlement!==hint.settlement||
    (hint.kind==='continuation')!==(job.kind==='assistant_continuation'))return;
 if(!opened||activeId!==owner||sessionGeneration!==generation)return;
 const stableKey=owner+':'+job.id+':'+job.attemptId+':'+job.settlement;
 if(remoteDeliveries.has(stableKey))return;
 remoteDeliveries.add(stableKey);if(remoteDeliveries.size>300)remoteDeliveries.delete(remoteDeliveries.values().next().value);
 await refreshMessages();
 if(!opened||activeId!==owner||sessionGeneration!==generation)return;
 await refreshSessionList();
 // An already-mounted plugin in the other tab also needs post-commit events.
 // Do not trust the cross-tab hint as authority: derive all signals from IDB.
 const plugins=root.MimaCompatPlugins;
 if(!plugins?.publish||job.settlement!=='committed')return;
 if(hint.kind==='turn'){
   await plugins.publish(owner,'turn.committed',{turnId:job.id,attemptId:job.attemptId},'turn.committed:'+job.id);
   const assistant=await s().get('messages','a_'+job.id);
   if(assistant?.sessionId===owner&&assistant.status==='committed'&&assistant.turnId===job.id&&assistant.mvuOperationCount>0)
     await plugins.publish(owner,'mvu.changed',{turnId:job.id,operationCount:assistant.mvuOperationCount},'mvu.changed:'+job.id);
 }else{
   await plugins.publish(owner,'assistant.continued',{turnId:job.parentTurnId,continuationId:job.id},'assistant.continued:'+job.id);
   const backup=await s().get('sidecar_links','continuation_backup_'+job.id);
   if(backup?.sessionId===owner&&backup.parentTurnId===job.parentTurnId&&root.MimaCompatMVU?.extract?.(backup.addedText)?.length)
     await plugins.publish(owner,'mvu.changed',{turnId:job.parentTurnId,continuationId:job.id},'mvu.changed:'+job.id);
 }
}
function listenLiveSync(){if(!unsubscribeLiveSync&&root.MimaCompatLiveSync?.subscribe)unsubscribeLiveSync=root.MimaCompatLiveSync.subscribe(onExternalSettlement);}
function refreshSendAvailability(){for(const id of ['compat-send','compat-continue']){const button=$(id);if(button)button.disabled=!activeId||busySessions.has(activeId);}}
function messageFor(sessionId,generation,text,kind='info'){if(activeId===sessionId&&sessionGeneration===generation)message(text,kind);}
function beginSessionAction(id){if(busySessions.has(id))return false;busySessions.add(id);refreshSendAvailability();return true;}function endSessionAction(id){busySessions.delete(id);refreshSendAvailability();}
function el(tag,props={},parent){const node=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='text')node.textContent=String(v);else if(k==='className')node.className=v;else if(k==='onclick')node.addEventListener('click',v);else if(k==='title')node.title=v;else node.setAttribute(k,v);}if(parent)parent.append(node);return node;}
function clear(node){node.replaceChildren();}
function message(text,type='info'){
 const output=$('compat-notice'),target=$('compat-lab').classList.contains('in-chat')?$('compat-chat-panel'):$('compat-import-panel');if(output.parentNode!==target)target.append(output);output.textContent=text;output.dataset.kind=type;
 if(type==='error'){
  const errors=$('compat-diagnostics');if(errors){
   const row=el('div',{className:'compat-diagnostic-entry'},errors);
   el('small',{text:new Date().toLocaleTimeString()+' · '+String(text).slice(0,3000)},row);
   while(errors.children.length>24)errors.firstElementChild.remove();
  }
 }
}
function download(name,data,type='application/json'){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.download=name.replace(/[\\/:*?"<>|]/g,'_');a.href=url;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function reportImportFailure(e,file){
 // Only metadata about the failure is copyable; character text and binary
 // chunks are deliberately excluded from the diagnostic report.
 const errorCode=String(e?.code||'E_IMPORT');
 const diagnostic={stage:/PNG|CARD|SOURCE/i.test(errorCode)?'png_metadata_or_source_validation':'file_decode_or_import',code:errorCode,
  message:String(e?.message||e),fileType:String(file?.type||'unknown'),bytes:Number(file?.size)||0,
  browserSecureContext:root.isSecureContext===true,sha256Available:!!root.crypto?.subtle};
 const hint=errorCode==='E_PNG_NOT_CHARACTER_CARD'?'这不是原始角色卡，请重新导出带角色资料的 PNG。':
  errorCode==='E_STORE_UNVERIFIED'?'当前页面不能安全校验文件哈希。建议从 HTTPS 或本机 localhost 打开咪嘛馆，不要关闭来源校验。':
  errorCode==='E_PNG_CARD_INVALID'?'图片里有角色数据，但版本或内容损坏；请使用原始文件重新导出，不会改动旧存档。':
  '导入中断，未建立角色剧情；可重选原始文件或展开下方诊断查看失败阶段。';
 message(hint+'\n'+diagnostic.message,'error');
 const container=$('compat-report');clear(container);
 const detail=el('details',{},container);el('summary',{text:'查看导卡技术诊断（不包含角色设定）'},detail);
 el('pre',{text:JSON.stringify(diagnostic,null,2)},detail);
 el('button',{text:'复制精简诊断',onclick:async()=>{
  try{if(!root.navigator?.clipboard?.writeText)throw new Error('当前浏览器不可用');
    await root.navigator.clipboard.writeText(JSON.stringify(diagnostic,null,2));message('已复制精简诊断（不含角色资料）。');
  }catch(ex){message('复制不可用，请手动选择上方诊断文字。','error');}
 }},detail);
}
function readableResource(item){const labels={character:'人物设定',world_info:'世界设定',regex:'文字效果',script_source:'互动脚本',css:'外观效果',prompt_presets:'提示词设置',variable_schema:'变量状态',media:'媒体文件',raw_unknown:'原始内容'};return `${labels[item.kind]||item.kind} · ${item.name} · ${item.kind==='script_source'?'需授权/部分脚本仅完整酒馆可用':item.kind==='raw_unknown'?'可查看原始资料':'已识别（不代表所有规则已运行）'}`;}
function diagnostics(){
 const output=$('compat-report');clear(output);if(!scan)return;
 const counts={};for(const resource of scan.resources)counts[resource.kind]=(counts[resource.kind]||0)+1;
 const characters=scan.resources.map((item,index)=>({...item,index})).filter(x=>x.kind==='character');
 const world=counts.world_info||0,scripts=counts.script_source||0,regex=counts.regex||0;
 const ready=$('compat-quick-status');clear(ready);
 const body=el('div',{className:'compat-card-description'},ready);el('span',{className:'compat-eyebrow',text:'已选择的角色'},body);el('strong',{id:'compat-card-name',text:characters.length?characters[0].name:'已读取外部资料'},body);el('p',{id:'compat-card-description',text:String(characters[0]?.raw?.description||'可以展开下方资料查看完整内容。').slice(0,140)},body);
 if(cardPreviewUrl){URL.revokeObjectURL(cardPreviewUrl);cardPreviewUrl='';}
 if(scan.format==='png'){cardPreviewUrl=URL.createObjectURL(new Blob([scan.bytes],{type:'image/png'}));const cover=el('img',{className:'compat-card-cover',alt:'已选择的角色卡图片'},ready);cover.src=cardPreviewUrl;ready.prepend(cover);}else ready.prepend(el('span',{className:'compat-card-monogram',text:(characters[0]?.name||'卡').slice(0,1)}));
 $('compat-import-panel').dataset.hasCard=String(characters.length>0);
 for(const w of scan.warnings)el('p',{text:'提示：'+w,className:'compat-help'},output);
 el('p',{text:`原始文件已读取，包含 ${scan.resources.length} 个可检查项目。下面可完整查看、导出每一项，不会偷偷删除未识别的数据。`},output);
 const groups={};for(const [index,item]of scan.resources.entries()){(groups[item.kind]||(groups[item.kind]=[])).push({item,index});}
 for(const [kind,items]of Object.entries(groups)){
   const details=el('details',{},output);el('summary',{text:`${readableResource(items[0].item).split(' · ')[0]}（${items.length} 项）`},details);
   for(const {index,item}of items){const sub=el('details',{},details);el('summary',{text:readableResource(item)},sub);
     el('p',{text:'来源路径：'+item.path+'；未自动执行外部脚本或 CSS'},sub);
     el('pre',{text:JSON.stringify(item.raw,null,2)},sub);
     el('button',{text:'导出原始内容',onclick:()=>download(`${scan.filename}-${index}.json`,JSON.stringify(item.raw,null,2))},sub);
   }
 }
 const select=$('compat-card-choice');clear(select);
 for(const x of characters)el('option',{value:String(x.index),text:x.name+' · '+(/ccv3/.test(x.path)?'新版卡片':/chara/.test(x.path)?'旧版卡片':'角色版本')},select);
 const recommended=characters.find(x=>/ccv3/.test(x.path))||characters[0];if(recommended)select.value=String(recommended.index);
 select.hidden=characters.length===1;const versionLabel=document.querySelector('label[for="compat-card-choice"]');if(versionLabel)versionLabel.hidden=characters.length===1;
 $('compat-create').disabled=!characters.length;refreshGreetingChoice();
}
function refreshGreetingChoice(){const idx=Number($('compat-card-choice').value),item=scan?.resources?.[idx],select=$('compat-greeting-choice');clear(select);if(item?.kind!=='character')return;const d=item.raw||{};el('option',{value:'0',text:'默认开场白'},select);for(const [i,opening] of (Array.isArray(d.alternate_greetings)?d.alternate_greetings:[]).entries())el('option',{value:String(i+1),text:'备用开场 '+(i+1)+' · '+String(opening).replace(/<[^>]*>/g,'').slice(0,34)},select);if($('compat-card-name'))$('compat-card-name').textContent=item.name;if($('compat-card-description'))$('compat-card-description').textContent=String(d.description||'查看完整人物资料').slice(0,140);refreshGreetingPreview();showLaunchPlan();}
function refreshGreetingPreview(){const detail=$('compat-greeting-preview');if(!detail)return;const target=detail.querySelector('.story-prose');if(!detail.open){target.textContent='';return;}const card=scan?.resources?.[Number($('compat-card-choice').value)]?.raw,index=Number($('compat-greeting-choice').value||0);target.textContent=String(index===0?card?.first_mes||'（无开场白）':card?.alternate_greetings?.[index-1]||'');}
function showLaunchPlan(){
 const output=$('compat-mount-readiness');if(!output)return;clear(output);
 const choice=scan?.resources?.[Number($('compat-card-choice').value)];
 if(!choice||choice.kind!=='character')return;
 try{
  const plan=onboard().make(scan.resources,choice),c=plan.counts;
  el('strong',{text:'这个故事带来了'},output);
  for(const [label,value,state]of[['人物与开场','所选版本','已读取'],['世界书',c.worldbookEnabled+' 条启用候选','按规则触发'],['正则效果',c.regex+' 条','可本地测试'],['MVU / 变量',c.variable_schema+' 项来源','开场时检查']]){const row=el('div',{className:'compat-capability-row'},output);el('span',{text:label},row);el('small',{text:value},row);el('span',{className:'compat-capability-state',text:state},row);}
  if(c.script_source||c.html_template||plan.warnings.length){const detail=el('details',{},output);el('summary',{text:'查看外观、脚本与兼容说明'},detail);el('p',{text:'安全 CSS 随卡片 HTML 显示；独立模板需手动选择。'+(c.script_source?'此卡另含 '+c.script_source+' 项脚本，原版 Tavern Helper API 尚未完整提供。':'')},detail);if(plan.warnings.length)el('small',{text:plan.warnings.join('；')},detail);}
 }catch(e){el('p',{text:(e.code||'E_MOUNT_PLAN')+': '+e.message},output);}
}
async function doImport(fileOverride=null){const generation=++scanGeneration,file=fileOverride&&typeof fileOverride.arrayBuffer==='function'?fileOverride:$('compat-file').files[0];if(!file)return message('请先选择 PNG、JSON、CHARX 或 ZIP','error');scan=null;$('compat-create').disabled=true;$('compat-save').disabled=true;clear($('compat-quick-status'));clear($('compat-mount-readiness'));clear($('compat-card-choice'));clear($('compat-greeting-choice'));message('正在读取角色卡…');try{const next=await i().inspect(file);if(generation!==scanGeneration)return;scan=next;diagnostics();$('compat-save').disabled=false;message(`已读取 ${scan.resources.length} 项资料，选择开场后即可开始聊天；外部代码仍不会自动运行。`);}catch(e){if(generation===scanGeneration)reportImportFailure(e,file);}}
async function commit(){if(!scan)return;try{const result=await s().importSource({sha256:scan.sha256,filename:scan.filename,format:scan.format,bytes:scan.bytes,versions:scan.versions,warnings:scan.warnings},scan.resources);if(result.projectionChanged)throw Object.assign(new Error('同一原始卡的旧资源清单与新版解析结果不同，已保留原数据；请先备份并在隔离站点确认。'),{code:'E_RESOURCE_PROJECTION_STALE'});message(result.reused?'相同来源包已存在，未重复写入。':`已原子保存来源包与 ${result.resources} 项资源，不写旧版剧情资料。`);await refreshSourceList();}catch(e){message(`${e.code||'E_IMPORT'}: ${e.message}`,'error');}}
async function create(){if(creating||!scan)return;
 const selectedScan=scan,scanTicket=scanGeneration,button=$('compat-create');
 const selectedIndex=Number($('compat-card-choice').value),selectedGreeting=Number($('compat-greeting-choice').value||0),settingTemplateId=String($('compat-setting-template')?.value||'');
 creating=true;button.disabled=true;$('compat-card-choice').disabled=true;$('compat-greeting-choice').disabled=true;if($('compat-setting-template'))$('compat-setting-template').disabled=true;
 try{
  const sourceId='sha256:'+selectedScan.sha256;
  // Always recheck source bytes through the idempotent atomic import. An
  // existing capsule is not evidence that its resource projection is intact.
  const importReceipt=await s().importSource({sha256:selectedScan.sha256,filename:selectedScan.filename,format:selectedScan.format,bytes:selectedScan.bytes,versions:selectedScan.versions,warnings:selectedScan.warnings},selectedScan.resources);
  if(importReceipt.projectionChanged)throw Object.assign(new Error('这张卡的原始字节虽然相同，但旧资料库保存的资源解析清单与当前版本不一致。为保护旧剧情，不会假装挂载成功。请先导出兼容备份，并在独立测试站点核查该卡。'),{code:'E_RESOURCE_PROJECTION_STALE'});
  if(scanGeneration!==scanTicket||scan!==selectedScan)throw Object.assign(new Error('选卡期间已切换文件，本次未建立旧角色剧情；请再次点击开始'),{code:'E_IMPORT_SELECTION_CHANGED'});
  const choice=selectedScan.resources[selectedIndex];
  const resources=await s().byIndex('resource_ir','sourceId',sourceId);
  if(scanGeneration!==scanTicket||scan!==selectedScan)throw Object.assign(new Error('选择的原始卡片已经变化，请重新确认角色'),{code:'E_IMPORT_SELECTION_CHANGED'});
  const saved=r().resolveCharacterSelection(sourceId,choice,resources);
  // The one-click operation uses the selected card version's existing,
  // source-bound resources. It never elevates arbitrary scripts or CSS.
  const plan=onboard().make(resources,saved);
  // Check the exact runtime projection BEFORE creating a persistent session.
  // A bad source/selected version must not leave an orphan conversation.
  const templateBinding=settingTemplateId?await r().prepareNativeTemplateBinding(settingTemplateId):null;
  if(templateBinding?.capabilityContract?.notEquivalent?.length){
   const details=templateBinding.capabilityContract.notEquivalent.map(item=>item.field+'：'+item.note).join('\n');
   // Distinguish the native-template projection from a fully native session.
   // This approval does not grant any background charging rights.
   if(!window.confirm('兼容引擎无法完全等价执行以下模板设置：\n'+details+'\n\n已明确保留原卡 History/预设/世界书，不复制任何旧记忆和收费授权。接受这些差异并建立剧情吗？'))
    throw Object.assign(new Error('主人没有确认跨引擎模板差异，本次未创建剧情'),{code:'E_SETTINGS_TEMPLATE_CAPABILITY_UNCONFIRMED'});
  }
  const prepared=await r().resourcesFor({sourceId,characterResourceId:saved.id,mountGraph:[],nativeTemplateBinding:templateBinding});
  onboard().assertRuntime(plan,prepared);
  if(scanGeneration!==scanTicket||scan!==selectedScan||String($('compat-setting-template')?.value||'')!==settingTemplateId)throw Object.assign(new Error('来源卡或模板在挂载前发生切换，本次未创建剧情'),{code:'E_IMPORT_SELECTION_CHANGED'});
  const ses=await r().createSession(sourceId,{characterResourceId:saved.id,greetingIndex:selectedGreeting,
    settingTemplateId,expectedTemplateSnapshot:templateBinding,acceptedCapabilityDigest:templateBinding?.capabilityContract?.notEquivalent?.length?JSON.stringify(templateBinding.capabilityContract):null,userName:$('compat-player-name')?.value.trim()||'玩家'});
  if($('compat-game-drawer'))$('compat-game-drawer').open=false;
  await loadSession(ses.id);$('compat-lab').classList.add('in-chat');$('compat-lab').classList.remove('show-advanced');message('故事已打开。卡内资料与效果可从顶部查看。');
 }catch(e){message(`${e.code||'E_COMPAT'}: ${e.message}`,'error');}
 finally{creating=false;$('compat-card-choice').disabled=false;$('compat-greeting-choice').disabled=false;if($('compat-setting-template'))$('compat-setting-template').disabled=false;button.disabled=!scan||!scan.resources?.some(item=>item.kind==='character');}}
async function refreshSourceList(){
 const owner=activeId,generation=sessionGeneration;
 const [sources,allResources]=await Promise.all([s().all('source_capsules'),s().all('resource_ir')]);
 if(activeId!==owner||sessionGeneration!==generation)return;
 const active=owner?await r().getSession(owner):null;
 // Late reads from session A have no authority over B's resource controls.
 if(activeId!==owner||sessionGeneration!==generation)return;
 const box=$('compat-sources');clear(box);
 const savedCards=$('compat-saved-card-list');if(savedCards){clear(savedCards);for(const capsule of sources.filter(item=>allResources.some(res=>res.sourceId===item.id&&res.kind==='character'))){const row=el('div',{className:'compat-library-row'},savedCards);el('span',{text:allResources.find(res=>res.sourceId===capsule.id&&res.kind==='character')?.name||capsule.filename},row);el('button',{type:'button',text:'选择开场',onclick:()=>openWithFile(new File([capsule.bytes],capsule.filename,{type:capsule.format==='png'?'image/png':'application/octet-stream'})).catch(e=>message('读取已保存角色卡失败：'+e.message,'error'))},row);}$('compat-saved-cards').hidden=!savedCards.children.length;if(!savedCards.children.length)el('p',{className:'compat-help',text:'保存过的角色卡会留在这里。'},savedCards);}
 for(const item of sources){
  const row=el('details',{},box);el('summary',{text:`${item.filename} · SHA256 ${item.sha256.slice(0,16)}`},row);
  el('button',{text:'原样导出',onclick:()=>download(item.filename,new Blob([item.bytes],{type:'application/octet-stream'}),'application/octet-stream')},row);
  if(!active||item.id===active.sourceId)continue;
  for(const res of allResources.filter(x=>x.sourceId===item.id&&['world_info','regex','preset','prompt_presets','css','html_template','media','script_source','quick_reply'].includes(x.kind))){
   const line=el('div',{className:'compat-line'},row);
   const mount=(active.mountGraph||[]).find(m=>m.resourceId===res.id);
   el('span',{text:`${res.kind} · ${res.name} · 来源 ${res.path} · ${mount?'已挂载（不等于验证可运行）':'可手动挂载'}`},line);
   el('button',{text:mount?'卸载来源资源':'挂载到当前剧情',onclick:async()=>{
    try{
     if(mount)await r().unmountResource(active.id,res.id);else await r().mountResource(active.id,res.id);
     await refreshSourceList();await refreshExtensionUI();await inspectPreview();
     message(mount?'挂载关系已撤销；来源包与原始资源未删除':'已建立可撤销的来源指纹挂载；未验证预设与脚本绝不标记为生效');
    }catch(e){message(`${e.code||'E_MOUNT'}: ${e.message}`,'error');}
   }},line);
   if(mount&&['preset','prompt_presets'].includes(mount.kind))el('button',{text:mount.creativeRoleOverride==='user'?'恢复预设声明角色':'改为 user 资料角色',onclick:async()=>{
     try{
       const next=mount.creativeRoleOverride==='user';
       if(!next&&!root.confirm('仅在当前剧情把这份外部预设改为 user 资料角色发送？原始预设正文和声明角色仍保留，可以随时恢复。'))return;
       await r().setPresetCreativeRole(active.id,res.id,next);
       await refreshSourceList();await inspectPreview();
       message(next?'当前剧情已恢复该外置预设声明的消息角色。':'当前剧情已明确选择把该预设作为 user 资料发送；原始资源仍完整保留。');
     }catch(e){message((e.code||'E_PRESET_PERMISSION')+': '+e.message,'error');}
   }},line);
  }
 }
}
async function showTurnControls(sessionId,container){
  const owner=activeId,generation=sessionGeneration;
  const jobs=await r().turnJournal(sessionId);
  if(owner!==sessionId||activeId!==owner||sessionGeneration!==generation)return;
  for(const j of jobs.filter(j=>['failed','pending'].includes(j.settlement))){
    const row=el('div',{className:'compat-line'},container);
    el('span',{text:`待处理原回合 ${j.id.slice(0,18)} · ${j.settlement} · 第 ${j.attempt||1} 次请求${j.settlement==='pending'?'（刷新后结果未知，不会自动重复发送）':''}`},row);
    if(j.kind==='assistant_continuation'){
     if(j.settlement==='pending')el('button',{text:'终止卡住的续写（保留原回复）',onclick:()=>handleRecovery(sessionId,j.id,'abort-continuation',j.attemptId)},row);
     else el('small',{text:'续写失败，原角色回复保留；可以重新点击「续写角色回复」。'},row);
    }else{
     el('button',{text:'按原 turnId 重试（当前设置）',onclick:()=>handleRecovery(sessionId,j.id,'retry',j.attemptId)},row);
     el('button',{text:'终止原回合（保留原文）',onclick:()=>handleRecovery(sessionId,j.id,'abort',j.attemptId)},row);
    }
  }
}
async function handleRecovery(sessionId,turnId,action,expectedAttemptId){
 if(!beginSessionAction(sessionId))return;const generation=sessionGeneration;
 try{
  if(action==='abort-continuation')await r().abortContinuation(sessionId,turnId,expectedAttemptId);
  else if(action==='abort')await r().recoverTurn(sessionId,turnId,'abort',expectedAttemptId);
  else await r().retryTurn(sessionId,turnId,{acceptGaps:$('compat-accept-gaps').checked,onDiagnostic:actualRequestView(sessionId,generation)});
  messageFor(sessionId,generation,action==='abort'||action==='abort-continuation'?'原回合已终止，旧正文保持不变':'已用当前挂载和 API 设置按原 turnId 完成重试');
 }catch(e){messageFor(sessionId,generation,`${e.code||'E_TURN_RECOVERY'}: ${e.message}`,'error');}
 finally{endSessionAction(sessionId);await refreshSessionList();if(activeId===sessionId&&sessionGeneration===generation)await refreshMessages();}
}

async function refreshSessionList(){const generation=sessionGeneration,ses=await s().all('compat_sessions');if(generation!==sessionGeneration)return;const box=$('compat-sessions');clear(box);
const shortcuts=$('compat-continue-list');if(shortcuts){clear(shortcuts);if(ses.length){el('span',{className:'compat-eyebrow',text:'继续上次的故事'},shortcuts);for(const item of ses.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,4)){const row=el('div',{className:'compat-library-row'},shortcuts);el('span',{className:'compat-story-monogram',text:(item.title||'故').slice(0,1)},row);el('strong',{text:item.title||'未命名剧情'},row);el('button',{text:'继续故事',onclick:()=>loadSession(item.id)},row);}}}
const libraryList=$('compat-library-sessions');if(libraryList){clear(libraryList);$('compat-library-all').hidden=ses.length<=4;for(const item of ses){const row=el('div',{className:'compat-library-row'},libraryList);el('span',{text:item.title||'未命名剧情'},row);el('button',{text:'继续故事',onclick:()=>loadSession(item.id)},row);}}
for(const item of ses){const row=el('div',{className:'compat-line'},box);el('span',{text:item.title+(item.parentSessionId?' · 剧情分支':' · 独立剧情')+(item.pendingTurnId?' · 存在未结算回合':'')},row);el('button',{text:'进入',onclick:()=>loadSession(item.id)},row);if(item.id===activeId){await showTurnControls(item.id,box);if(generation!==sessionGeneration)return;}}}
async function loadSessionData(id){$('compat-lab').classList.add('in-chat');const generation=++sessionGeneration;if(activeId!==id){const drawer=$('compat-game-drawer');if(drawer){drawer.open=false;$('compat-manage-toggle')?.setAttribute('aria-expanded','false');}selectedMvuTemplate=null;const preview=$('compat-mvu-template-output');if(preview)preview.replaceChildren();root.MimaCompatPlugins?.unmountAll();root.MimaAuthorHost?.unmountAll('已离开当前故事；已提交变量保留');if($('compat-stscript-input'))$('compat-stscript-input').value='';if($('compat-stscript-result'))$('compat-stscript-result').textContent='已切换剧情：请手动填写并检查本剧情的脚本。';}activeId=id;refreshSendAvailability();const ses=await r().getSession(id);if(generation!==sessionGeneration)return;$('compat-wi-budget').value=String(ses.worldInfoBudget??16000);$('compat-wi-depth').value=String(ses.worldInfoScanDepth??100);$('compat-wi-recursive').checked=ses.worldInfoRecursiveScan!==false;$('compat-wi-recursion-steps').value=String(ses.worldInfoMaxRecursionSteps??6);$('compat-wi-local-advanced').checked=ses.worldInfoLocalAdvancedRules===true;$('compat-preset-history-slot').checked=ses.experimentalChatHistorySlot===true;$('compat-complete-html').checked=ses.outputContract?.completeHtml===true;$('compat-author-note').value=ses.authorNote?.content||'';$('compat-author-note-depth').value=ses.authorNote?.depth??0;$('compat-persona-description').value=String(ses.personaDescription||'');$('compat-current').textContent=`咪嘛馆兼容引擎 · ${ses.title}`;$('compat-conversation').hidden=false;await refreshSessionList();if(generation!==sessionGeneration)return;await refreshSourceList();if(generation!==sessionGeneration)return;await refreshMessages();if(generation!==sessionGeneration)return;await refreshMountStatus(id,generation);if(generation!==sessionGeneration)return;await refreshExtensionUI();if(generation!==sessionGeneration)return;await inspectPreview();root.MimaCompatPlugins?.publish?.(id,'session.mounted',{sessionId:id},'session.mounted:'+id+':'+generation)?.catch(e=>messageFor(id,generation,'插件会话事件失败：'+e.message,'error'));}
// The optional MVU template belongs in the story flow, after the current
// assistant reply, not in a separate status card above the chat.
function paintMvuTemplate(sessionId,verified,target,css,theme,renderTicket){
 if(!target||!selectedMvuTemplate||selectedMvuTemplate.sessionId!==sessionId)return;
 try{
  if(!verified?.active)throw Object.assign(new Error('没有经过重放验证的 MVU 状态'),{code:'E_MVU_TEMPLATE_STATE'});
  const compiled=root.MimaCompatMvuTemplate.render(selectedMvuTemplate.html,verified.state);
  const wrap=el('div',{className:'compat-inline-mvu-template'},target);
  const controls=target.querySelector('details,button');if(controls)target.insertBefore(wrap,controls);
  makeFluidHtml(wrap,compiled.html,'动态 MVU 状态栏',css,theme,sessionId,renderTicket);
  if(compiled.unsupportedCount)el('small',{text:compiled.unsupportedCount+' 项旧版宏无法执行，请在设置中查看。'},wrap);
 }catch(e){el('small',{text:(e.code||'E_MVU_TEMPLATE')+': '+e.message+'（未改动剧情）'},target);}
}
async function selectMvuTemplate(label,html){
 const owner=activeId,generation=sessionGeneration;if(!owner)return;
 selectedMvuTemplate={sessionId:owner,label:String(label).slice(0,120),html:String(html)};
 if(activeId===owner&&sessionGeneration===generation)await refreshMessages();
}
function clearMvuTemplate(){selectedMvuTemplate=null;const box=$('compat-mvu-template-output');if(box)clear(box);if(activeId)refreshMessages().catch(e=>message('关闭模板显示失败：'+e.message,'error'));}
const STYLE_BASE=`
:host{display:block;overflow:visible;box-sizing:border-box;font-family:var(--font-story,inherit);color:var(--text,inherit)}
*,*:before,*:after{box-sizing:border-box}
article.compat-message{width:min(760px,100%);margin:0 auto 23px;padding:0;background:transparent;color:inherit;line-height:1.76;overflow-wrap:anywhere;white-space:pre-wrap;font-family:var(--font-story,inherit)}
article.compat-message>strong{display:block;margin:0 0 8px;padding:0 5px;font:500 .73rem var(--font-ui,system-ui);letter-spacing:.015em;color:var(--muted,#737781);opacity:.9}
article.compat-message.assistant>div:not(.compat-inline-mvu-template):not(.compat-message-tools){padding:0 5px;font-size:1rem;line-height:1.78}
article.compat-message.user{max-width:650px;width:92%;margin-right:0;margin-left:auto}
article.compat-message.user>div:not(.compat-message-tools){padding:12px 15px;border-radius:19px 19px 6px 19px;border:1px solid var(--line,rgba(255,255,255,.55));background:var(--skin-control,rgba(255,255,255,.6));box-shadow:inset 0 1px rgba(255,255,255,.6),0 5px 19px rgba(40,44,50,.06)}
article.compat-message iframe{width:100%;display:block;border:0;background:transparent;overflow:hidden}
article.compat-message details{margin:6px 4px 0;font:400 .8rem var(--font-ui,system-ui);color:var(--muted,#707782)}
article.compat-message details summary{cursor:pointer;list-style:disclosure-closed}
article.compat-message button{margin:0;padding:5px 8px;border:1px solid var(--line,#aaa5);border-radius:100px;background:var(--skin-control,rgba(255,255,255,.48));font:400 .73rem var(--font-ui,system-ui);color:var(--muted,#6c7279);cursor:pointer}
.compat-message-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 4px 0;opacity:1;transition:opacity .15s}
.compat-message-action-menu{display:block;width:max-content;max-width:100%;margin:3px 4px 0;padding:0;border:0;background:transparent;font-family:var(--font-ui,system-ui)}
.compat-message-action-menu>summary{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:22px;padding:0 9px;list-style:none;border-radius:999px;background:var(--skin-control,rgba(255,255,255,.37));color:var(--muted,#737781);cursor:pointer;font:600 .86rem/1 var(--font-ui,system-ui);opacity:.62}
.compat-message-action-menu>summary::-webkit-details-marker{display:none}
.compat-message-action-menu[open]>summary{opacity:1}
.compat-message-action-menu[open] .compat-message-tools{padding:5px 0}
article:hover .compat-message-tools,article:focus-within .compat-message-tools{opacity:1}
@media(hover:none){.compat-message-tools{opacity:.85}}
@media(max-width:640px){article.compat-message{margin-bottom:19px}article.compat-message.user{width:91%}}
`;
function cssSafe(css){if(typeof css!=='string'||css.length>65536)throw new Error('E_RESOURCE_SEMANTIC_GAP: CSS 必须为 64KB 内的文本');return root.MimaCompatSafeHtml.safeCssText(css);}
// A single host-side listener gates every resize by the live iframe, its
// cryptographic token and the currently displayed session/render generation.
const fluidFrames=new Map(),messageViews=new Map();let renderedSession='',followLatest=true;
root.addEventListener?.('message',event=>{
 const data=event.data;if(!data||typeof data!=='object'||typeof (data.mimaSafeHeight||data.mimaSafeFontResult)!=='string')return;
 const record=fluidFrames.get(data.mimaSafeHeight||data.mimaSafeFontResult);
 if(!record||event.source!==record.iframe.contentWindow||activeId!==record.owner||sessionGeneration!==record.generation||messageRenderGeneration!==record.ticket||!record.iframe.isConnected)return;
 if(data.mimaSafeFontResult){if(data.status==='error'&&!record.fontFailed){record.fontFailed=true;el('small',{className:'compat-render-warning',text:'本地正文字体未能在隔离页面加载：'+String(data.message||'未知错误')},record.iframe.parentElement);}return;}
 const height=Number(data.height);if(!Number.isFinite(height)||height<1)return;
 if(height>200000){record.iframe.hidden=true;if(!record.failed){record.failed=true;el('p',{className:'compat-render-warning',text:'这条 HTML 的显示高度超出预算，请展开下方原文阅读；完整剧情仍已保存。'},record.iframe.parentElement);}return;}
 const box=$('compat-messages'),nearBottom=box&&box.scrollHeight-box.clientHeight-box.scrollTop<96;
 const px=Math.ceil(height);if(Math.abs(px-record.last)<2)return;record.last=px;
 record.iframe.style.height=px+'px';if(nearBottom&&followLatest)requestAnimationFrame(()=>{if(followLatest)box.scrollTop=box.scrollHeight;});
});
function makeFluidHtml(parent,html,title,css,theme,owner,ticket){
 let source;
 const token=Array.from(root.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
 const nonce=Array.from(root.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
 try{
  const rendered=root.MimaCompatMarkdown?.html(html)||html;
  if(rendered.length>root.MimaCompatSafeHtml.maxBytes)throw Object.assign(new Error('Markdown 展开后的 HTML 超过单条隔离显示预算'),{code:'E_DISPLAY_MARKDOWN_EXPANSION'});
  source=root.MimaCompatSafeHtml.srcdoc(rendered,{css,token,nonce,viewportHeight:root.visualViewport?.height||root.innerHeight,...theme});
 }catch(error){
  const reason=(error.code||'E_DISPLAY_COMPILE')+': '+error.message;
  el('p',{className:'compat-render-warning',role:'alert',text:reason+'。以下保留完整显示文字；原始剧情与发送内容未修改。'},parent);
  el('div',{className:'compat-render-original story-prose',text:String(html)},parent);
  const diag=$('compat-display-errors');if(diag)el('p',{className:'compat-render-diagnostic',text:title+' · '+reason+' · session '+owner},diag);
  return null;
 }
 const iframe=el('iframe',{sandbox:'allow-scripts',referrerpolicy:'no-referrer',title,className:'compat-message-html'},parent);
 iframe.style.height='1px';
 fluidFrames.set(token,{iframe,owner,generation:sessionGeneration,ticket,last:0});
 if(theme.localFont)iframe.addEventListener('load',()=>{const record=fluidFrames.get(token);if(record?.iframe.isConnected&&activeId===owner&&sessionGeneration===record.generation)iframe.contentWindow.postMessage({mimaSafeFont:token,family:theme.localFont.family,buffer:theme.localFont.buffer},'*');});
 if(typeof IntersectionObserver==='function'){
  iframe.style.minHeight='80px';const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();iframe.style.minHeight='';iframe.srcdoc=source;}},{root:$('compat-messages'),rootMargin:'1000px'});observer.observe(iframe);
  fluidFrames.get(token).observer=observer;
 }else iframe.srcdoc=source;
 return iframe;
}
function frameTheme(){const node=$('compat-messages');const computed=root.getComputedStyle?.(node),tokens=root.getComputedStyle?.(document.documentElement);
 return{font:computed?.fontFamily||'system-ui,sans-serif',fontSize:tokens?.getPropertyValue('--story-font-size').trim()||computed?.fontSize||'16px',lineHeight:tokens?.getPropertyValue('--story-line-height').trim(),paragraphGap:tokens?.getPropertyValue('--story-paragraph-gap').trim(),letterSpacing:tokens?.getPropertyValue('--story-letter-spacing').trim(),firstLineIndent:tokens?.getPropertyValue('--story-first-line-indent').trim(),color:computed?.color||'#292a30'};}
async function resolveFrameCss(session){
 const resources=await r().resourcesFor(session),parts=[],failures=[];
 // CSS declared in the selected card is display-only: it goes to an opaque
 // no-network frame, never to the parent page, prompt, or canonical history.
 const candidate=session.styleResourceId?resources.filter(x=>x.kind==='css'&&x.id===session.styleResourceId):
   resources.filter(x=>x.kind==='css'&&x.sourceId===session.sourceId&&x.sourceEnabled!==false);
 for(const item of candidate){
  try{if(typeof item.raw!=='string')throw new Error('CSS 不是纯文本');parts.push(cssSafe(item.raw));}
  catch(e){failures.push(item.name+': '+e.message);}
 }
 let font=null;try{font=await resolveLocalFrameFont();}catch(e){failures.push('本地正文字体读取失败：'+e.message);}
 return{css:parts.join('\n'),failures,font,auto:!session.styleResourceId&&parts.length>0};
}
let localFrameFontCache=null;
async function resolveLocalFrameFont(){
 const family=root.MimaFontManager?.getSelected('story');if(!family)return null;
 const face=[...document.fonts].find(item=>item.family.replace(/^['"]|['"]$/g,'')===family);
 if(localFrameFontCache?.family===family&&localFrameFontCache.face===face)return localFrameFontCache.promise;
 const promise=root.MimaFontManager.all().then(records=>{const record=records.find(item=>item.family===family);if(!record?.buffer)throw new Error('所选字体没有可验证的本地文件');return{id:record.id,family:record.family,buffer:record.buffer};});
 localFrameFontCache={family,face,promise};try{return await promise;}catch(e){localFrameFontCache=null;throw e;}
}
async function refreshMessages(){if(!activeId)return;
 const sessionId=activeId,generation=sessionGeneration,renderTicket=++messageRenderGeneration;
 // Prepare the complete view off-DOM first: a slow regex Worker/IDB read
 // from session A must not overwrite the currently open session B.
 const items=await r().displayMessages(sessionId);
 if(activeId!==sessionId||sessionGeneration!==generation||messageRenderGeneration!==renderTicket)return;
 const session=await r().getSession(sessionId);
 let css=STYLE_BASE;
 const frameStyles=await resolveFrameCss(session);
 // Imported CSS is never injected into the host/outer Shadow DOM. It is
 // scoped exclusively to each opaque iframe with a restrictive network CSP.
 if(activeId!==sessionId||sessionGeneration!==generation||messageRenderGeneration!==renderTicket)return;
 let verifiedMvu=null;const mvuNode=$('compat-mvu-state'),statusNode=$('compat-mvu-live-status');if(mvuNode){try{const state=await r().currentMvuState(sessionId);verifiedMvu=state;if(activeId!==sessionId||sessionGeneration!==generation||messageRenderGeneration!==renderTicket)return;
  mvuNode.textContent=state.active?JSON.stringify(state.state,null,2):'当前卡片没有可安全解析的 MVU 初始值；复杂 YAML/Zod 仍需原版插件。';
  if(state.gaps.length)mvuNode.textContent+='\n\n未实现/无效的初始化：'+state.gaps.map(x=>x.reason).join(', ');

  if(statusNode){clear(statusNode);if(state.active){const table=el('dl',{className:'compat-mvu-readonly'},statusNode);const rows=root.MimaCompatMVU?.statusRows?.(state.state,{limit:40})||[];for(const row of rows){const group=el('div',{className:'compat-mvu-pair'},table);el('dt',{text:row.path},group);el('dd',{text:row.value},group);}if(rows.length===40)el('small',{text:'仅展示前 40 项；完整状态在下方，未裁剪存档。'},statusNode);}else el('small',{text:'暂无可验证的动态变量状态。'},statusNode);}
 }catch(e){if(activeId!==sessionId||sessionGeneration!==generation||messageRenderGeneration!==renderTicket)return;if(statusNode){clear(statusNode);el('small',{text:'状态校验失败，原存档未修改。'},statusNode);}mvuNode.textContent='MVU 状态验证失败（未清空存档）：'+(e.code||'E_MVU')+' '+e.message;}}
 const box=$('compat-messages'),shadow=box; // R12.2: safe text uses native DOM; untrusted HTML remains in opaque sandbox iframe
 // Old resize messages cannot change a newly rendered conversation.
 for(const old of box.querySelectorAll('.compat-inline-mvu-template'))old.remove();
 const sameSession=renderedSession===sessionId;
 const wasFollowing=!sameSession||box.scrollHeight-box.scrollTop-box.clientHeight<96;
 const anchor=sameSession?[...box.children].find(n=>n.getBoundingClientRect().bottom>box.getBoundingClientRect().top):null;
 const anchorOffset=anchor?anchor.getBoundingClientRect().top-box.getBoundingClientRect().top:0;
 if(!sameSession){for(const record of fluidFrames.values())record.observer?.disconnect();fluidFrames.clear();messageViews.clear();clear(box);renderedSession=sessionId;}
 followLatest=wasFollowing;
 const errorMap=new Map();for(const item of items)for(const issue of item.displayErrors||(item.displayError?[item.displayError]:[])){const key=[issue.code,issue.ruleKey,issue.path,issue.message].join('|'),existing=errorMap.get(key);if(existing)existing.count++;else errorMap.set(key,{...issue,count:1});}const regexErrors=[...errorMap.values()];
 const diag=$('compat-display-errors');if(diag){clear(diag);for(const e of regexErrors){const row=el('div',{className:'compat-regex-diagnostic'},diag);el('strong',{text:(e.ruleName||'显示规则')+' · '+(e.code||'E_REGEX')},row);el('p',{text:e.message+'（影响 '+e.count+' 条显示，原始正文保留）'},row);if(e.path)el('small',{text:'来源：'+e.path},row);el('button',{type:'button',text:'打开正则工具',onclick:()=>openSheet('effects')},row);}
 for(const error of frameStyles.failures)el('p',{text:'角色卡 CSS 未加载：'+error},diag);}
 const used=new Set();let cursor=shadow.firstElementChild;
 const theme={...frameTheme(),localFont:frameStyles.font};let lastAssistant=null;
 for(const item of items){
 const key=item.id||item.turnId+':'+item.role+':'+item.sequence,view=String(item.displayView??''),prior=messageViews.get(key);
 const signature=JSON.stringify([item.role,item.status,session.title,frameStyles.css,theme,item.displayError||null]);used.add(key);
 if(prior&&prior.view===view&&prior.signature===signature){
  const article=prior.article;if(article!==cursor)shadow.insertBefore(article,cursor);cursor=article.nextElementSibling;
  for(const record of fluidFrames.values())if(article.contains(record.iframe)){record.ticket=renderTicket;record.generation=generation;}
  if(item.role==='assistant'&&item.status==='committed')lastAssistant=article;continue;
 }
 if(prior?.article===cursor)cursor=cursor.nextElementSibling;prior?.article.remove();
 const article=el('article',{className:'message '+(item.role==='assistant'?'assistant-msg':item.role==='user'?'user-msg':'system-msg')+' compat-message '+item.role},shadow);if(item.role==='assistant'&&item.status==='committed')lastAssistant=article;
 el('div',{className:'msg-header',text:item.role==='assistant'?(session.title||'角色').split(/[\/｜|]/)[0].trim():'你'},article);const content=el('div',{className:'msg-content tavern-story-content'},article);
 const safe=root.MimaCompatSafeHtml?.classify(view,item.role,item.status);
 if(safe?.showHtml){
   // Text and its own HTML/CSS flow together in a borderless, auto-sized
   // sandbox. No fixed-height viewport and no screenshot-like status card.
   makeFluidHtml(content,view,'角色回复（内嵌 HTML 状态栏）',frameStyles.css,theme,sessionId,renderTicket);
   const source=el('details',{},content);el('summary',{text:'查看本条原始文字'},source);source.addEventListener('toggle',()=>{if(source.open&&!source.querySelector('pre'))el('pre',{text:item.canonicalContent},source);else if(!source.open)source.querySelector('pre')?.remove();});
 }else{const prose=el('div',{className:'story-prose'},content);if(root.MimaCompatMarkdown?.render)root.MimaCompatMarkdown.render(prose,view);else prose.textContent=view;if(safe?.oversize)el('small',{text:'内容超过隔离 HTML 单条预算，仍以原文显示，不裁剪剧情数据。'},content);}
 if(item.status!=='committed')el('small',{text:'本回合 '+item.status+'（未纳入已完成对话上下文）'},article);
 if(item.role==='assistant'&&item.status==='committed'&&(item.turnId||item.opening)){
   const actionMenu=el('details',{className:'compat-message-action-menu'},article);el('summary',{text:'···',title:'操作这条消息'},actionMenu);const actionBar=el('div',{className:'compat-message-tools'},actionMenu);
   el('button',{text:'从这里另开分支',onclick:()=>forkFromTurn(sessionId,item.turnId||null)},actionBar);
   if(item.turnId)el('button',{text:'按当前挂载重说（保存旧分支）',onclick:()=>forkEditTurn(sessionId,item.turnId,'regenerate')},actionBar);
 }
 if(item.role==='user'&&item.status==='committed'&&item.turnId){
   const actionMenu=el('details',{className:'compat-message-action-menu'},article);el('summary',{text:'···',title:'操作这条消息'},actionMenu);const actionBar=el('div',{className:'compat-message-tools'},actionMenu);
   el('button',{text:'编辑此句并重生成（新分支）',onclick:()=>forkEditTurn(sessionId,item.turnId,'edit')},actionBar);
   el('button',{text:'删除此轮及之后（新分支）',onclick:()=>forkEditTurn(sessionId,item.turnId,'delete')},actionBar);
 }
 messageViews.set(key,{article,view,signature});if(article!==cursor)shadow.insertBefore(article,cursor);cursor=article.nextElementSibling;
 }
 for(const [key,entry]of messageViews)if(!used.has(key)){entry.article.remove();messageViews.delete(key);}
 for(const [token,record]of fluidFrames)if(!record.iframe.isConnected){record.observer?.disconnect();fluidFrames.delete(token);}else{record.ticket=renderTicket;record.generation=generation;}
 if(lastAssistant&&selectedMvuTemplate?.sessionId===sessionId)paintMvuTemplate(sessionId,verifiedMvu,lastAssistant,frameStyles.css,theme,renderTicket);
 const oldPreview=$('compat-mvu-template-output');if(oldPreview)clear(oldPreview);
 const info=$('compat-story-status');if(info){clear(info);if(regexErrors.length||frameStyles.failures.length){el('span',{text:regexErrors.length?regexErrors.length+' 条显示规则需要处理，原始正文保留。':'部分卡片 CSS 未能加载。'},info);el('button',{type:'button',text:'查看原因',onclick:()=>{openSheet('archive');$('compat-diagnostics-panel').open=true;}},info);}}
 if($('compat-lab').classList.contains('in-chat'))$('compat-head-subtitle').textContent='独立剧情 · '+items.filter(x=>x.status==='committed').length+' 条消息';
 if(wasFollowing)box.scrollTop=box.scrollHeight;
 else if(anchor?.isConnected)box.scrollTop+=anchor.getBoundingClientRect().top-box.getBoundingClientRect().top-anchorOffset;
 syncLatestButton();
}
function syncLatestButton(){const box=$('compat-messages'),button=$('compat-follow-latest');if(button)button.hidden=!box||box.scrollHeight-box.scrollTop-box.clientHeight<96;}

async function forkFromTurn(sessionId,turnId){
 if(busySessions.has(sessionId)||creating||forking)return messageFor(sessionId,sessionGeneration,'请先等待当前操作结束，再创建剧情分支。','error');
 if(!root.confirm('从这里另开剧情分支？原剧情和已保存的变量不会改变。'))return;
 forking=true;const startedGeneration=sessionGeneration;const requestId='fork_'+String(root.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g,'');
 try{const result=await r().forkSession(sessionId,turnId,{requestId});if(activeId===sessionId&&sessionGeneration===startedGeneration){await loadSession(result.sessionId);messageFor(result.sessionId,sessionGeneration,'已建立独立剧情分支，之前的剧情、变量和原存档均保留。');}}
 catch(e){messageFor(sessionId,startedGeneration,(e.code||'E_BRANCH')+': '+e.message,'error');}
 finally{forking=false;}
}
async function forkEditTurn(sessionId,turnId,action){
 if(forking||busySessions.has(sessionId))return messageFor(sessionId,sessionGeneration,'当前剧情有操作正在执行','error');
 const viewGeneration=sessionGeneration;forking=true;
 try{
  const session=await r().getSession(sessionId);if(session.pendingTurnId)throw new Error('存在未结算回合，不能改变剧情时间线');
  const history=await r().sessionMessages(sessionId),target=history.find(m=>m.role==='user'&&m.turnId===turnId&&m.status==='committed');
  const response=history.find(m=>m.role==='assistant'&&m.turnId===turnId&&m.status==='committed');
  if(!target||!response)throw new Error('只支持从已经完整结算的回合编辑/删除/重说');
  const prior=history.filter(m=>m.role==='assistant'&&!m.opening&&m.status==='committed'&&m.sequence<target.sequence).at(-1);
  let nextText=target.rawContent;
  if(action==='edit'){
   const edited=root.prompt('编辑玩家这一句；原剧情将完整保留，新剧情会从此处重新生成。',target.rawContent);
   if(edited===null)return;if(!edited.trim())throw new Error('修改后的文字不能是空白');nextText=edited;
  }
  const question=action==='delete'?'新建分支并删去选中回合以及之后的剧情？原分支不会删除。':action==='regenerate'?'从该轮之前另开分支，用原玩家消息和当前挂载重新生成？这不是重发原请求，新分支的世界书抽样可能变化；原回复完整保留。':'将修改后的玩家消息按当前挂载发送到新分支？原剧情完整保留。';
  if(!root.confirm(question))return;
  const requestId='forkedit_'+String(root.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g,'');
  const child=await r().forkSession(sessionId,prior?.turnId||null,{requestId});
  if(activeId!==sessionId||sessionGeneration!==viewGeneration)return; // persisted fork belongs to A even if B is now open
  await loadSession(child.sessionId);
  if(action==='delete'){messageFor(child.sessionId,sessionGeneration,'已在新分支删除所选回合及后续内容；旧剧情没有删改。');return;}
  $('compat-input').value=nextText;
  messageFor(child.sessionId,sessionGeneration,'已打开新分支并填入'+(action==='regenerate'?'原玩家消息':'修改后的消息')+'。本次使用当前挂载和 API 设置，原轮请求未冻结。点击发送后重新生成；旧分支保留。');
 }catch(e){messageFor(sessionId,viewGeneration,`${e.code||'E_BRANCH_EDIT'}: ${e.message}`,'error');}
 finally{forking=false;}
}
async function continueReply(){
 const sessionId=activeId,generation=sessionGeneration;if(!sessionId||!beginSessionAction(sessionId))return;
 try{
  if(!root.confirm('续写最近一条角色回复？这会调用一次模型，成功后接在原回复末尾，原文同时保存到续写版本记录。'))return;
  const strict=document.querySelector('input[name="compat-mode"]:checked')?.value==='strict';
  const response=await r().continueAssistant(sessionId,{strictCompat:strict,onDiagnostic:actualRequestView(sessionId,generation)});
  if(activeId===sessionId&&sessionGeneration===generation){await refreshMessages();messageFor(sessionId,generation,'角色回复已续写；原段落已保存在版本记录，旧剧情不丢失。');}
 }catch(e){messageFor(sessionId,generation,`${e.code||'E_CONTINUE'}: ${e.message}${e.settlementError?'; settlement: '+e.settlementError:''}`,'error');
  if(activeId===sessionId&&sessionGeneration===generation)await refreshMessages();}
 finally{endSessionAction(sessionId);await refreshSessionList();}
}
async function mountStyle(resourceId){const ses=await r().getSession(activeId),assets=await r().resourcesFor(ses),res=assets.find(x=>x.id===resourceId);
 if(!res||res.kind!=='css')throw new Error('CSS 资源未挂载到当前剧情');cssSafe(res.raw);await s().putCAS('compat_sessions',{...ses,styleResourceId:resourceId},ses.revision);await refreshMessages();message('当前剧情的卡片 CSS 已启用，作用于隔离 HTML 和剧情视图；原生主题不变。');}
async function disableStyle(){const ses=await r().getSession(activeId);await s().putCAS('compat_sessions',{...ses,styleResourceId:null},ses.revision);await refreshMessages();message('已取消手动 CSS 指定，恢复卡片原始启用的安全 CSS（若有）；剧情原文未变。');}
function standalonePluginSource(resource){const v=resource.raw;const sources=Array.isArray(v)?v:[v];return sources.map((x,index)=>({label:String(x?.name||x?.scriptName||('脚本 '+(index+1))),code:typeof x==='string'?x:(x?.script||x?.code||x?.content||'')})).filter(x=>typeof x.code==='string'&&x.code.length>0);}
async function refreshExtensionUI(){const owner=activeId,generation=sessionGeneration;if(!owner)return;
root.MimaAuthorHost?.unmountAll('扩展面板重新载入，作者脚本已停止；已提交变量保留');
const ses=await r().getSession(owner);if(activeId!==owner||sessionGeneration!==generation)return;
const assets=await r().resourcesFor(ses);if(activeId!==owner||sessionGeneration!==generation)return;
const target=$('compat-plugins'),cssList=$('compat-css-list'),preview=$('compat-html-preview');clear(target);clear(cssList);clear(preview);for(const res of assets.filter(x=>x.kind==='css')){const row=el('div',{className:'compat-line'},cssList);el('span',{text:res.name+' · 安全 CSS 可在隔离 HTML 内生效（不执行 JS）'},row);el('button',{text:ses.styleResourceId===res.id?'已挂载':'手动启用局部 CSS',onclick:()=>mountStyle(res.id).catch(e=>message(e.message,'error'))},row);}if(ses.styleResourceId)el('button',{text:'卸载当前 CSS',onclick:()=>disableStyle().catch(e=>message(e.message,'error'))},cssList);
// The source's enabled/disabled flags are never changed. Even disabled
// worldbook HTML can be chosen manually for a harmless read-only preview.
for(const wb of assets.filter(x=>x.kind==='world_info')){
 const raw=wb.raw?.entries,entries=Array.isArray(raw)?raw:raw&&typeof raw==='object'?Object.values(raw):[];
 for(const entry of entries.slice(0,200)){
  const content=String(entry?.content||'');
  const htmlLike=/(?:<\/?(?:div|table|section|style|article|dl|header|main)\b|\{\{\s*mvu:\/)/i.test(content);
  const declaredStatus=/状态栏|status.?bar|status.?panel/i.test(String(entry?.comment||entry?.name||''));
  if(!(htmlLike||declaredStatus)||content.length>100000)continue;
  const sourceDisabled=entry?.enabled===false||entry?.disable===true;
  const label=wb.name+' / '+String(entry?.comment||entry?.name||'状态栏模板').slice(0,64)+(sourceDisabled?'（原卡禁用）':'');
  const row=el('div',{className:'compat-line'},preview);
  el('span',{text:label+' · 仅手动隔离预览，原世界书启用状态不变'},row);
  if(htmlLike)el('button',{text:'手动隔离预览状态栏模板',onclick:()=>selectMvuTemplate(label,content)},row);
  else el('button',{text:'查看原始状态栏指令（不会执行）',onclick:()=>selectMvuTemplate(label,'<pre>'+content.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</pre>')},row);
 }
}
for(const asset of assets.filter(x=>x.kind==='html_template')){const row=el('div',{className:'compat-line'},preview);el('button',{text:'绑定 MVU 状态安全预览',onclick:()=>selectMvuTemplate(asset.name,asset.raw)},row);el('span',{text:asset.name+' · HTML 模板仅隔离预览'},row);el('button',{text:'预览（无 JS/外链）',onclick:()=>{clear($('compat-html-preview'));const iframe=el('iframe',{sandbox:'',title:'只读 HTML 预览'},$('compat-html-preview'));iframe.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'"><meta charset="utf-8">${String(asset.raw).slice(0,100000)}`;}},row);}
for(const asset of assets.filter(x=>x.kind==='media')){
 const row=el('div',{className:'compat-line'},preview);
 el('span',{text:'媒体素材：'+asset.name+' · '+(asset.raw?.embeddedPath||asset.raw?.uri||'未关联路径')},row);
 el('button',{text:'手动查看/播放 CHARX 素材',onclick:async()=>{
  try{const result=await r().resolveMedia(activeId,asset.id);const url=URL.createObjectURL(result.blob);assetUrls.push(url);
   if(result.mime.startsWith('audio/')){if(player){player.pause();player.remove();}player=el('audio',{controls:'',preload:'none'},row);player.src=url;await player.play();}
   else{const img=el('img',{alt:'当前卡包媒体',style:'max-width:260px;max-height:300px'},row);img.src=url;}
  }catch(e){message(`${e.code||'E_MEDIA'}: ${e.message}`,'error');}
 }},row);
}
for(const res of assets.filter(x=>x.kind==='script_source'))for(const script of standalonePluginSource(res)){const code=script.code;const binary=new TextEncoder().encode(code),hash=await i().digest(binary);if(activeId!==owner||sessionGeneration!==generation)return;const key=ses.id+':'+hash;const row=el('details',{},target);el('summary',{text:script.label+' · 默认不执行 · '+hash.slice(0,12)},row);el('pre',{text:code},row);const caps=el('div',{className:'compat-actions'},row);const checks={};for(const cap of root.MimaCompatPlugins.capabilities){const label=el('label',{},caps),ch=el('input',{type:'checkbox'},label);checks[cap]=ch;label.append(' '+cap);}
if(activeId!==owner||sessionGeneration!==generation)return;
const slot=el('div',{className:'compat-plugin-slot'},row);const frame=el('iframe',{title:script.label,style:'width:100%;min-height:100px;border:1px solid #8885'},row);frame.hidden=true;
const visualFrame=el('iframe',{title:script.label+' 独立可视化沙箱',style:'width:100%;height:390px;max-width:100%;border:1px solid #8885'},row);visualFrame.hidden=true;
// Both modes share the SAME grant record. Switching modes unmounts the old
// frame; a script never gets new permissions merely from switching modes.
async function startPlugin(mode){const launchOwner=owner,launchGeneration=generation;
 if(activeId!==launchOwner||sessionGeneration!==launchGeneration)throw new Error('已经切换剧情，取消旧脚本启动');
 const selected=Object.entries(checks).filter(([,v])=>v.checked).map(([k])=>k);
 if(!selected.length)throw new Error('请至少选择一项具体权限');
 if(mode==='visual'&&!selected.includes('ui.mount'))throw new Error('可视化沙箱需要勾选 ui.mount 权限');
 const existing=await s().get('grants',key);
 if(activeId!==launchOwner||sessionGeneration!==launchGeneration)throw new Error('脚本授权读取后剧情已切换');
 if(existing&&!existing.revokedAt){if(selected.some(cap=>!existing.capabilities.includes(cap)))throw new Error('已有授权不包含新增权限：先撤销，再明确重新授权');}
 else await root.MimaCompatPlugins.grant(ses.id,hash,selected);
 if(activeId!==launchOwner||sessionGeneration!==launchGeneration)throw new Error('启动途中已经切换剧情');
 frame.hidden=mode!=='worker';visualFrame.hidden=mode!=='visual';
 const targetFrame=mode==='visual'?visualFrame:frame;
 await root.MimaCompatPlugins.mount(ses.id,hash,targetFrame,slot,code,{mode});
 if(activeId!==launchOwner||sessionGeneration!==launchGeneration){root.MimaCompatPlugins.unmountOne(ses.id,hash);throw new Error('挂载完成时已切换剧情');}
 message(mode==='visual'?'可视化脚本只在独立沙箱绘制界面，无法读取任何剧情/变量、也无法联网；原版插件互动能力仍不完整。':'已在隔离 Worker 启动脚本；只支持已授权的 SDK。');
} 
el('button',{text:'明确授权并运行 Worker 脚本',onclick:()=>startPlugin('worker').catch(e=>message((e.code||'E_PLUGIN')+': '+e.message,'error'))},row);
el('button',{text:'试运行隔离可视化界面（需 ui.mount）',onclick:()=>startPlugin('visual').catch(e=>message((e.code||'E_PLUGIN')+': '+e.message,'error'))},row);
el('button',{text:'撤销并卸载',onclick:async()=>{try{await root.MimaCompatPlugins.revoke(ses.id,hash);frame.hidden=true;visualFrame.hidden=true;slot.replaceChildren();message('已撤销当前脚本授权和 iframe。');}catch(e){message(e.message,'error');}}},row);
}
if(root.MimaCompatQuickReply)await root.MimaCompatQuickReply.render(ses,assets,$('compat-quick-replies'),target,{
 live:()=>opened&&$('compat-lab').classList.contains('in-chat')&&activeId===owner&&sessionGeneration===generation,
 isBusy:()=>busySessions.has(owner),getDraft:()=>$('compat-input').value,onFill:text=>{$('compat-input').value=text;$('compat-input').focus();},onSend:send,
 getContext:async()=>{const session=await r().getSession(owner),card=await s().get('resource_ir',session.characterResourceId);return {char:card?.raw?.nickname||card?.raw?.name||'角色',user:session.userName||'玩家'};},
 onRun:async source=>{$('compat-stscript-input').value=source;$('compat-stscript-panel').open=true;openSheet('settings');await manualSTscript(false);},onMessage:(text,kind)=>messageFor(owner,generation,text,kind)
});
if(root.MimaAuthorUI)await root.MimaAuthorUI.render(ses,assets,target,{live:()=>opened&&$('compat-lab')?.classList.contains('in-chat')&&activeId===owner&&sessionGeneration===generation,onMessage:(text,kind)=>messageFor(owner,generation,text,kind)});
else el('p',{text:'作者交互组件未加载；旧脚本模式仍保留。'},target);
}
async function saveWorldInfoScanDepth(){
 if(!activeId)return;
 const sessionId=activeId,field=$('compat-wi-depth'),button=$('compat-wi-save'),raw=field.value.trim();
 const budgetRaw=$('compat-wi-budget').value.trim(),budget=Number(budgetRaw);
 if(!budgetRaw||!Number.isSafeInteger(budget)||budget<1000||budget>1000000){message('兼容剧情世界书预算只能为 1000～1000000 个字符；旧设置未修改。','error');return;}
 const depth=Number(raw),stepsRaw=$('compat-wi-recursion-steps').value.trim(),steps=Number(stepsRaw),recursive=$('compat-wi-recursive').checked,localAdvanced=$('compat-wi-local-advanced').checked,experimentalSlot=$('compat-preset-history-slot').checked;
 const personaDescription=$('compat-persona-description').value;if(personaDescription.length>12000){message('玩家 Persona 描述最长 12000 字符；没有保存旧设置。','error');return;}
 if(!raw||!Number.isSafeInteger(depth)||depth<0||depth>1000||!stepsRaw||!Number.isSafeInteger(steps)||steps<1||steps>12){message('世界书扫描条数必须是 0～1000，递归层数必须是 1～12；没有保存旧设置。','error');return;}
 const noteDepth=Number($('compat-author-note-depth').value);if(!Number.isInteger(noteDepth)||noteDepth<0||noteDepth>100)return message('作者注记深度须为 0～100 的整数，未保存。','error');
 button.disabled=true;
 try{
  const session=await r().getSession(sessionId);
  if(activeId!==sessionId)return;
  const saved=await s().putCAS('compat_sessions',{...session,worldInfoBudget:budget,worldInfoScanDepth:depth,worldInfoRecursiveScan:recursive,worldInfoMaxRecursionSteps:steps,worldInfoLocalAdvancedRules:localAdvanced,experimentalChatHistorySlot:experimentalSlot,personaDescription,outputContract:{completeHtml:$('compat-complete-html').checked},authorNote:{content:$('compat-author-note').value,depth:Number($('compat-author-note-depth').value),role:'system'}},session.revision);
  const verified=await r().getSession(sessionId);
  if(saved?.worldInfoBudget!==budget||verified.worldInfoBudget!==budget||verified.revision!==saved.revision)throw Object.assign(new Error('预算持久化结果与提交值不一致，当前值不能标记为保存成功'),{code:'E_STORE_UNVERIFIED'});
  if(activeId===sessionId){await inspectPreview();message('已保存世界书预算 '+budget+' 字符、扫描范围 '+depth+' 条、递归 '+(recursive?'开启':'关闭')+'、上限 '+steps+' 层；本地近似概率/分组 '+(localAdvanced?'开启':'关闭')+'，预设动态插槽 '+(experimentalSlot?'开启':'关闭')+'。其它剧情和原始卡片未修改。');}
 }catch(e){message(`${e.code||'E_STORE_UNVERIFIED'}: 世界书设置保存失败，原值未被假装提交：${e.message}`,'error');}
 finally{button.disabled=false;}
}
function actualRequestView(owner,generation){return event=>{if(event?.type!=='request'||activeId!==owner||sessionGeneration!==generation)return;$('compat-prompt').textContent=JSON.stringify({view:'Provider 最终发送请求',request:event.request,messageSources:event.messageSources||[]},null,2);};}
async function inspectPreview(){const owner=activeId,generation=sessionGeneration;if(!owner)return;try{const preview=await r().preview(owner,$('compat-input').value||'（未输入）');if(activeId!==owner||sessionGeneration!==generation)return;$('compat-prompt').textContent=JSON.stringify({view:'发送前预检（实际请求以发送日志为准）',...preview},null,2);$('compat-gap').textContent=preview.gaps.length?'提醒：这张卡有 '+preview.gaps.length+' 项高级效果尚未完整适配。可以直接进行基础剧情；未适配的手机、插件或复杂演出不会自动运行。具体影响请展开本轮追踪。':'人物设定可以用于基础剧情；本引擎尚未与原版酒馆逐项对照。';$('compat-accept-gaps').closest('label').hidden=true;}catch(e){if(activeId===owner&&sessionGeneration===generation)$('compat-prompt').textContent=`${e.code||'E_PREVIEW'}: ${e.message}`;}}
async function send(){
 if(!activeId)return;
 const sessionId=activeId,input=$('compat-input').value;if(!input.trim())return;
 if(!beginSessionAction(sessionId))return;const generation=sessionGeneration;
 try{
   // Preflight is read-only and happens before posting the player's message.
   // Known incompatible effects are disclosed, never silently counted as ran.
   const strict=document.querySelector('input[name="compat-mode"]:checked')?.value==='strict';
   const preflight=await r().preview(sessionId,input);
   if(activeId!==sessionId||sessionGeneration!==generation)return;
   const gaps=Array.isArray(preflight.gaps)?preflight.gaps:[];
   if(gaps.length){
     $('compat-gap').textContent=`本次预计有 ${gaps.length} 项高级规则不能保证运行。基础聊天仍可使用人物设定；未适配的脚本或演出不会擅自执行。点击“查看本轮发送内容”可查看具体缺口。`;
     $('compat-prompt').textContent=JSON.stringify({view:'发送前预检（实际请求以发送日志为准）',...preflight},null,2);
   }else $('compat-gap').textContent='已完成当前已支持规则的发送前检查；不代表与原版酒馆全部功能等价。';
   if(strict&&gaps.length){messageFor(sessionId,generation,'严格模式已在发送前阻止：请展开本轮发送内容检查缺口，或明确选择基础聊天。','error');return;}
   if(!strict){
     const signature=JSON.stringify(gaps);
     if(approvedBasicPreflights.get(sessionId)!==signature){
       const detail=gaps.slice(0,4).map(x=>x.reason||x.slot||x.entryId||'高级规则缺口').join('；');
       const notice=`这张角色卡将以“基础聊天”方式发送。\n高级脚本、动态状态栏及部分世界书/正则规则未保证按原版酒馆运行。${gaps.length?`\n检测到 ${gaps.length} 项差异：${detail}${gaps.length>4?' 等':''}`:''}\n是否确认使用基础聊天？取消不会发送消息或扣费。`;
       if(!root.confirm(notice)){messageFor(sessionId,generation,'已取消发送，输入仍然保留。');return;}
       approvedBasicPreflights.set(sessionId,signature);
     }
   }
   const response=await r().send(sessionId,input,{basicRoleplay:!strict,strictCompat:strict,acceptGaps:false,onDiagnostic:actualRequestView(sessionId,generation)});
   if(activeId===sessionId&&sessionGeneration===generation){if($('compat-input').value===input)$('compat-input').value='';await refreshMessages();const trigger=response.envelope?.worldInfo;
     $('compat-gap').textContent=trigger?`本轮实际加入 ${trigger.inserted.length} 条世界设定；${trigger.skipped.length} 条未触发或未适配。高级效果差异 ${response.envelope.gaps.length} 项，不会自动执行不可信脚本。`:'回复已保存。';
   }
   messageFor(sessionId,generation,'角色已回复，剧情记录已保存到当前浏览器。');
 }catch(e){messageFor(sessionId,generation,`${e.code||'E_TURN'}: ${e.message}${e.settlementError?'; settlement: '+e.settlementError:''}`,'error');if(activeId===sessionId&&sessionGeneration===generation)await refreshMessages();}
 finally{endSessionAction(sessionId);await refreshSessionList();}
}
async function manualSTscript(dryRun=false){
 const sessionId=activeId,generation=sessionGeneration;
 const result=$('compat-stscript-result'),source=$('compat-stscript-input')?.value||'';
 if(!sessionId){result.textContent='请先进入兼容剧情';return;}
 const button=$('compat-stscript-run');if(button?.disabled)return;let actionStarted=false;
 try{
  const engine=root.MimaCompatSTscript;
  if(!engine)throw new Error('STscript 模块未加载');
  const commands=engine.compile(source);
  if(dryRun){result.textContent='检查通过：'+commands.map(x=>'/'+x.cmd).join(' → ')+'。只校验语法，没有执行或写入变量。';return;}
  const session=await r().getSession(sessionId);
  if(activeId!==sessionId||sessionGeneration!==generation)return;
  if(!root.confirm('确定仅在当前兼容剧情手动运行 '+commands.length+' 个支持的 STscript 命令？涉及变量修改将作为一次事务保存，绝不调用模型。'))return;
  button.disabled=true;
  const card=await s().get('resource_ir',session.characterResourceId);
  if(activeId!==sessionId||sessionGeneration!==generation)return;
  const name=card?.raw?.nickname||card?.raw?.name||'角色';
  if(!beginSessionAction(sessionId))throw new Error('当前故事有操作正在执行');actionStarted=true;
  const output=await engine.execute(sessionId,source,{char:name,user:session.userName||'玩家'},{live:()=>opened&&$('compat-lab').classList.contains('in-chat')&&activeId===sessionId&&sessionGeneration===generation});
  if(activeId===sessionId&&sessionGeneration===generation){
   result.textContent='执行 '+(output.aborted?'中止':'完成')+'；'+(output.committed?'变量事务已提交，修订 '+output.revision:'没有变量写入')+'。\n输出：\n'+(output.logs.join('\n')||'(无)')+'\n管道结果：'+String(typeof output.pipe==='string'?output.pipe:JSON.stringify(output.pipe));
  }
 }catch(e){if(activeId===sessionId&&sessionGeneration===generation)result.textContent=(e.code||'E_STSCRIPT')+': '+e.message+'；未报告任何假成功。';}
 finally{if(actionStarted)endSessionAction(sessionId);if(button)button.disabled=false;}
}
async function exportCompat(){try{const snapshot=await s().snapshot();download('咪嘛馆-兼容资料-哈希备份.json',await s().packBackup(snapshot));message('已导出兼容资料（包含原始卡片与兼容剧情，不包含原生账户密钥）。');}catch(e){message('备份失败，未生成假文件：'+e.message,'error');}}
async function exportBoth(){try{const a=await s().snapshot(),native=await root.MimaStandalone.exportLibrary();root.MimaStandalone.validateLibrary(native);const again=await s().snapshot();const revisionList=o=>JSON.stringify(Object.fromEntries(s().STORES.map(name=>[name,o.records[name].map(x=>[x.id,x.revision??null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))])));const first=revisionList(a),second=revisionList(again);if(first!==second)throw new Error('兼容库资源/会话/消息或权限修订版在快照过程中改变，请重试');const nativeAgain=await root.MimaStandalone.exportLibrary();if(native.storeRevision!==nativeAgain.storeRevision)throw new Error('原生库在快照过程中改变，请重试');const manifest={nativeSha256:await i().digest(new TextEncoder().encode(JSON.stringify(native))),compatSha256:await i().digest(new TextEncoder().encode(s().jsonify(a)))};const envelope={contractRevision:2,label:'non-atomic-dual-snapshot',nativeRevision:native.storeRevision,manifest,compat:a,native};download('咪嘛馆-双库完整备份.json',s().jsonify(envelope));message('双库数据已导出；浏览器两库无法原子同时提交，已对可见修订进行复核。');}catch(e){message('完整备份失败：'+e.message,'error');}}
let inspectedBackup=null;
async function restoreCompat(apply=false){
 const file=$('compat-restore-file').files[0];if(!file)return message('先选择兼容资料备份 JSON','error');
 try{
  const raw=await file.text(),hash=await i().digest(new TextEncoder().encode(raw));
  const parsed=await s().unpackBackup(raw),result=await s().restoreVerified(parsed,{dryRun:true,mode:'merge-new-only'});
  if(!apply){inspectedBackup={hash};
   message('备份校验通过（'+(parsed.integrityVerified?'SHA256 已验证':'旧版无外层哈希，仅可人工确认')+'），预计新增 '+Object.values(result.willAdd).reduce((a,b)=>a+b,0)+' 条记录；已有相同记录 '+result.alreadyPresent+' 条；冲突 '+result.conflicts.length+' 条。'+(result.conflicts.length?'存在同名不同内容，无法安全合并；已有资料不会改动。':'可以确认后安全补回缺失的记录。'));
   return;
  }
  if(inspectedBackup?.hash!==hash)throw new Error('恢复文件与上次预检查不同，请重新点击只读检查');
  if(result.conflicts.length)throw new Error('现有资料与备份存在 '+result.conflicts.length+' 个同 ID 冲突，不会覆盖；请在隔离站点恢复');
  if(!root.confirm('仅向兼容数据库添加缺失且经完整校验的记录，绝不覆盖已有任何记录。确认恢复吗？'))return;
  let allowLegacyUnsealed=false;
  if(!parsed.integrityVerified){if(!root.confirm('这是旧版未封装 SHA256 的备份。虽然已核对每份来源字节，但无法证明备份外层未被编辑。仍要按只增不覆盖方式恢复？'))return;allowLegacyUnsealed=true;}
  const saved=await s().restoreVerified(parsed,{dryRun:false,mode:'merge-new-only',allowLegacyUnsealed});
  inspectedBackup=null;await refreshSessionList();await refreshSourceList();
  message('兼容库事务已提交，新增 '+Object.values(saved.added).reduce((a,b)=>a+b,0)+' 条记录；原生存档与已有兼容条目未覆盖。');
 }catch(e){message('恢复'+(apply?'执行':'检查')+'失败，未报告假成功：'+(e.code||'E_RESTORE')+' '+e.message,'error');}
}

async function nativeAudio(file){try{if(player){player.pause();player.remove();player=null;}for(const uri of assetUrls)URL.revokeObjectURL(uri);assetUrls=[];const uri=URL.createObjectURL(file);assetUrls.push(uri);player=el('audio',{controls:'',preload:'none'},$('compat-media'));player.src=uri;await player.play();message('已由用户手势启动当前剧情的本地音频。');}catch(e){message('媒体播放需要用户手势或此格式不受浏览器支持：'+e.message,'error');}}
function stopMedia(){if(player){player.pause();player.remove();player=null;}for(const uri of assetUrls)URL.revokeObjectURL(uri);assetUrls=[];}
function close(){closeSheet();if(activeId)storyDrafts.set(activeId,$('compat-input').value);if(unsubscribeLiveSync){unsubscribeLiveSync();unsubscribeLiveSync=null;}++sessionGeneration;opened=false;clearMvuTemplate();if(cardPreviewUrl){URL.revokeObjectURL(cardPreviewUrl);cardPreviewUrl='';}$('compat-lab').classList.add('hidden');$('compat-lab').classList.remove('in-chat');stopMedia();root.MimaCompatPlugins?.unmountAll();root.MimaAuthorHost?.unmountAll('已离开当前故事；已提交变量保留');}
async function refreshCompatSettingTemplates(){
 const select=$('compat-setting-template');if(!select)return;
 // Distinguish an explicit "no template" choice from the initial blank placeholder.
 // Never replace an in-progress choice with a background default refresh.
 if(select.dataset.mimaExplicitChoiceBound!=='1'){
  select.addEventListener('change',()=>{select.dataset.mimaExplicitChoice='1';});
  select.dataset.mimaExplicitChoiceBound='1';
 }
 const previous=select.value;
 const explicit=select.dataset.mimaExplicitChoice==='1';
 const refreshEpoch=String(Number(select.dataset.mimaRefreshEpoch||'0')+1);
 select.dataset.mimaRefreshEpoch=refreshEpoch;
 const state=await root.MimaLocalStore.loadState();
 if(select.dataset.mimaRefreshEpoch!==refreshEpoch)return; // stale asynchronous refresh
 if(!Array.isArray(state.settingTemplates))throw new Error('E_SETTINGS_TEMPLATE_STORE_UNVERIFIED');
 const livePrevious=select.value;
 const userHasChanged=livePrevious!==previous||(select.dataset.mimaExplicitChoice==='1'&&!explicit);
 clear(select);el('option',{value:'',text:'不使用模板（角色卡独立配置）'},select);
 for(const item of state.settingTemplates)el('option',{value:item.id,text:item.name+(item.isDefault?'（默认）':'')},select);
 const desired=userHasChanged?livePrevious:previous;
 if(explicit||userHasChanged){
  // If explicitly chosen template was deleted, do not silently substitute another.
  select.value=[...select.options].some(o=>o.value===desired)?desired:'';
 }else if(desired&&[...select.options].some(o=>o.value===desired))select.value=desired;
 else select.value=String(state.settingTemplates.find(item=>item.isDefault)?.id||'');
}
function open(){opened=true;
 refreshCompatSettingTemplates().catch(e=>message('读取剧情设置模板失败：'+e.message+'，不会假装已挂载','error'));listenLiveSync();$('compat-lab').classList.remove('hidden');showLibrary();root.closeDrawer?.();Promise.all([refreshSourceList(),refreshSessionList()]).catch(e=>message('兼容库读取失败，禁止假装无数据：'+e.message,'error'));}
async function openWithFile(file){if(!file||typeof file.arrayBuffer!=='function')throw new Error('选中的原始角色卡已不可用，请重新选择');open();await doImport(file);}
function closeSheet(){const sheet=$('compat-sheet');if(sheet?.open)sheet.close();const drawer=$('compat-game-drawer');if(drawer)drawer.open=false;$('compat-manage-toggle')?.setAttribute('aria-expanded','false');}
function selectPane(pane){sheetPane=['character','effects','settings','archive'].includes(pane)?pane:'effects';for(const button of document.querySelectorAll('[data-compat-pane]')){const selected=button.dataset.compatPane===sheetPane;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}for(const section of document.querySelectorAll('.compat-sheet-pane'))section.hidden=section.id!=='compat-pane-'+sheetPane;}
function openSheet(pane='effects'){if(!activeId)return;selectPane(pane);const sheet=$('compat-sheet');if(!sheet.open)sheet.showModal();$('compat-game-drawer').open=true;$('compat-manage-toggle').setAttribute('aria-expanded','true');}
function toggleManage(){if($('compat-sheet')?.open)closeSheet();else openSheet('effects');}
function showLibrary(){root.MimaAuthorHost?.unmountAll('已返回故事库；已提交变量保留');if(activeId)storyDrafts.set(activeId,$('compat-input').value);closeSheet();$('compat-lab').classList.remove('in-chat');$('compat-head-title').textContent='酒馆游玩版';$('compat-head-subtitle').textContent='打开一个故事，慢慢读下去。';$('compat-head-avatar').replaceChildren(document.createTextNode('馆'));const notice=$('compat-notice');if(notice)$('compat-import-panel').append(notice);}
async function loadSession(id){
 if(activeId)storyDrafts.set(activeId,$('compat-input').value);closeSheet();
 // Restore the target draft before making the reader interactive. A delayed
 // source/preview load must never overwrite text entered in the meantime.
 $('compat-input').value=storyDrafts.get(id)||'';
 const loading=loadSessionData(id),generation=sessionGeneration;await loading;if(activeId!==id||sessionGeneration!==generation)return;
 const session=await r().getSession(id);if(activeId!==id||sessionGeneration!==generation)return;
 if(session.turnIndex===0){followLatest=false;$('compat-messages').scrollTop=0;syncLatestButton();}
 await refreshCharacterInfo(id,sessionGeneration);if(activeId!==id)return;
 await regexUI?.refresh();
}
async function refreshCharacterInfo(id,generation){
 const session=await r().getSession(id),resources=await r().resourcesFor(session),capsule=await s().get('source_capsules',session.sourceId);if(activeId!==id||sessionGeneration!==generation)return;
 const card=resources.find(x=>x.kind==='character'),data=card?.raw||{},target=$('compat-role-info');clear(target);
 const hero=el('div',{className:'compat-role-hero'},target),avatar=el('span',{className:'compat-avatar compat-role-avatar',text:(data.name||session.title||'角').slice(0,1)},hero);
 const body=el('div',{},hero);el('span',{className:'compat-eyebrow',text:'当前人物'},body);el('h3',{text:data.name||session.title},body);el('p',{className:'compat-help',text:'你在故事中的称呼：'+(session.userName||'玩家')},body);
 const headAvatar=$('compat-head-avatar');if(readerCoverSource!==session.sourceId){if(readerCoverUrl)URL.revokeObjectURL(readerCoverUrl);readerCoverUrl='';readerCoverSource=session.sourceId;if(capsule?.format==='png'&&capsule.bytes instanceof Uint8Array)readerCoverUrl=URL.createObjectURL(new Blob([capsule.bytes],{type:'image/png'}));}
 headAvatar.replaceChildren(document.createTextNode((data.name||session.title||'角').slice(0,1)));
 if(readerCoverUrl){for(const container of[avatar,headAvatar]){clear(container);el('img',{src:readerCoverUrl,alt:'角色卡原图'},container);}}
 for(const [field,label]of[['description','人物设定'],['personality','性格'],['scenario','故事背景'],['system_prompt','卡内系统提示'],['post_history_instructions','卡内后置提示'],['mes_example','对话示例']])if(data[field]){const detail=el('details',{className:'compat-info-section'},target);el('summary',{text:label},detail);const content=el('div',{className:'compat-full-text'},detail);detail.addEventListener('toggle',()=>{content.textContent=detail.open?String(data[field]):'';});}
 const full=el('details',{className:'compat-info-section'},target);el('summary',{text:'完整人物与原始资源'},full);full.addEventListener('toggle',()=>{if(full.open&&!full.querySelector('pre'))el('pre',{text:JSON.stringify(data,null,2)},full);else if(!full.open)full.querySelector('pre')?.remove();});
 if(capsule)el('button',{type:'button',text:'导出原始角色卡',onclick:()=>download(capsule.filename,new Blob([capsule.bytes],{type:'application/octet-stream'}),'application/octet-stream')},target);
 const matrix=el('details',{className:'compat-info-section'},target);el('summary',{text:'这张卡的兼容能力'},matrix);
 for(const [name,state]of[['人物 / 开场 / 原始资源','可读取与查看'],['世界书 / 预设','按已实现的触发与插槽生成'],['正则 / HTML / 安全 CSS','支持本地测试与隔离显示'],['MVU','声明式初值与更新；完整原版写入协议尚未接管'],['Tavern Helper / 作者 JS','授权消息/变量/事件、离线 jQuery/lodash/Vue/Zod 与本地模块；其它接口需适配']]){const row=el('div',{className:'compat-capability-row'},matrix);el('strong',{text:name},row);el('small',{text:state},row);}
}
async function importResource(file,ticket={id:activeId,generation:sessionGeneration}){
 if(!ticket.id)throw new Error('请先进入一个故事，再导入外部资源');
 const imported=await i().inspect(file);if(activeId!==ticket.id||sessionGeneration!==ticket.generation)throw new Error('读取资源期间已切换故事，本次未挂载');
 const allowed=new Set(['regex','world_info','preset','prompt_presets','quick_reply','script_source']);if(!imported.resources.length||imported.resources.some(resource=>!allowed.has(resource.kind)))throw Object.assign(new Error('此入口支持正则、世界书、预设、Quick Reply v2 和作者脚本 JSON；角色卡请从故事页选择。脚本导入后仍需单独授权。'),{code:'E_RESOURCE_IMPORT_KIND'});
 const capsule={sha256:imported.sha256,filename:imported.filename,format:imported.format,bytes:imported.bytes,versions:imported.versions,warnings:imported.warnings};
 const regexOnly=imported.resources.every(resource=>resource.kind==='regex');
 const receipt=await (regexOnly?s().importRegexSource(capsule,imported.resources):s().importSource(capsule,imported.resources));
 if(receipt.projectionChanged)throw Object.assign(new Error('此来源的旧投影与新版解析不同，已保留原数据；未挂载不一致的资源。'),{code:'E_RESOURCE_PROJECTION_STALE'});
 const resources=await s().byIndex('resource_ir','sourceId',receipt.id),ids=receipt.resourceIds||resources.filter(x=>allowed.has(x.kind)).map(x=>x.id);
 for(const resourceId of ids){if(activeId!==ticket.id||sessionGeneration!==ticket.generation)throw new Error('故事已切换，剩余资源未挂载；已保存来源保持可查看');const session=await r().getSession(ticket.id);if(session.sourceId!==receipt.id&&!session.mountGraph?.some(m=>m.resourceId===resourceId))await r().mountResource(ticket.id,resourceId);}
 if(activeId===ticket.id&&sessionGeneration===ticket.generation){await refreshSourceList();await refreshMessages();await refreshMountStatus(ticket.id,ticket.generation);await refreshExtensionUI();await inspectPreview();messageFor(ticket.id,ticket.generation,'已挂载 '+ids.length+' 项外部资料。正则、快捷回复与作者脚本可在对应工具中配置；导入不自动运行脚本，原始来源完整保留。');}
 return{resourceIds:ids};
}
function setupPlaySheet(){
 const character=$('compat-pane-character'),effects=$('compat-pane-effects'),settings=$('compat-pane-settings'),archive=$('compat-pane-archive'),tools=$('compat-tools-stack');
 const roleInfo=el('div',{id:'compat-role-info'},character);character.append($('compat-mount-status'));
 const sourceActions=el('div',{className:'compat-tool-actions'});$('compat-report').before(sourceActions);sourceActions.append($('compat-scan'),$('compat-save'));
 $('compat-continue').textContent='续写';$('compat-continue').title='续写最近的角色回复';$('compat-preview').textContent='本轮内容';$('compat-preview').title='查看本轮实际发送内容';$('compat-manage-toggle').textContent='⋯';$('compat-manage-toggle').title='正则、外观与更多工具';
 for(const detail of [...tools.children]){const heading=detail.querySelector('summary')?.textContent||'';if(/互动功能/.test(heading))effects.append(detail);else if(/卡片|备份|酒馆服务|Prompt/.test(heading))archive.append(detail);else settings.append(detail);}
 archive.append($('compat-diagnostics-panel'));
 $('compat-sheet-close').addEventListener('click',closeSheet);$('compat-sheet').addEventListener('close',()=>{$('compat-game-drawer').open=false;$('compat-manage-toggle').setAttribute('aria-expanded','false');});
 for(const button of document.querySelectorAll('[data-compat-pane]'))button.addEventListener('click',()=>selectPane(button.dataset.compatPane));
 $('compat-sheet-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const buttons=[...document.querySelectorAll('[data-compat-pane]')],index=buttons.findIndex(x=>x.dataset.compatPane===sheetPane),next=buttons[(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];selectPane(next.dataset.compatPane);next.focus();});
 $('compat-back-library').addEventListener('click',showLibrary);$('compat-open-info').addEventListener('click',()=>openSheet('character'));$('compat-open-settings').addEventListener('click',()=>openSheet('settings'));
 $('compat-greeting-preview').addEventListener('toggle',refreshGreetingPreview);$('compat-greeting-choice').addEventListener('change',()=>{refreshGreetingPreview();showLaunchPlan();});
 regexUI=root.MimaCompatRegexUI?.create($('compat-regex-tools'),{owner:()=>({id:activeId,generation:sessionGeneration}),notify:(text,isError,ticket)=>messageFor(ticket.id,ticket.generation,text,isError?'error':'info'),importResource,onChange:async ticket=>{if(activeId!==ticket.id||sessionGeneration!==ticket.generation)return;await refreshMessages();await inspectPreview();}});
 selectPane('effects');
}
function makePlayLayout(){
 // Reparent existing interactive elements; preserve their IDs/listeners and data bindings.
 const drawer=$('compat-game-drawer'),tools=$('compat-tools-stack'),conversation=$('compat-conversation');
 if(!drawer||!tools||!conversation||drawer.dataset.initialized)return;
 drawer.dataset.initialized='true';
 const primary=conversation.querySelector('#compat-send')?.closest('.compat-actions');
 const world=$('compat-wi-budget')?.closest('.compat-actions');
 const prompt=$('compat-prompt')?.closest('details');
 const audio=$('compat-audio')?.closest('.compat-actions');
 const modes=el('details',{},tools);el('summary',{text:'生成模式和兼容策略'},modes);
 for(const node of [...(primary?.querySelectorAll('.compat-mode-label, .compat-gap-choice')||[])])modes.append(node);
 const worldDetail=el('details',{},tools);el('summary',{text:'世界书、预设和玩家 Persona'},worldDetail);if(world)worldDetail.append(world);
 const statusPreview=$('compat-mvu-template-output');if(statusPreview)$('compat-status-display')?.append(statusPreview);
 const templateEditor=$('compat-mvu-template-custom')?.closest('details');
 tools.append($('compat-mvu-panel'));
 if(templateEditor)tools.append(templateEditor);
 if(prompt){const detail=el('details',{},tools);el('summary',{text:'实际 Prompt 与世界书触发追踪'},detail);detail.append(prompt);}
 tools.append($('compat-stscript-panel'));
 if(audio){const detail=el('details',{},tools);el('summary',{text:'手动本地音频'},detail);detail.append(audio);}
 const gap=$('compat-gap');if(gap)$('compat-diagnostics-panel').append(gap);
 if(primary){primary.id='compat-primary-actions';$('compat-composer').append(primary);}
 for(const section of [...document.querySelectorAll('#compat-lab > .compat-main > .compat-advanced-panel')]){
  const heading=section.querySelector('h3')?.textContent||'高级设置';
  const detail=el('details',{},tools);el('summary',{text:heading},detail);detail.append(section);
 }
 const notice=$('compat-notice');if(notice)$('compat-chat-panel').append(notice);
 drawer.addEventListener('toggle',()=>{$('compat-manage-toggle')?.setAttribute('aria-expanded',String(drawer.open));});
}
async function refreshMountStatus(sessionId,generation){
 const status=$('compat-mount-status');if(!status)return;
 try{
  const ses=await r().getSession(sessionId),resources=await r().resourcesFor(ses);
  if(activeId!==sessionId||sessionGeneration!==generation)return;
  clear(status);
  const counts={};for(const resource of resources)counts[resource.kind]=(counts[resource.kind]||0)+1;
  const byKind=[['character','人物设定'],['world_info','世界书'],['preset','预设'],['prompt_presets','预设资料'],['regex','显示正则'],['variable_schema','MVU 资料'],['html_template','HTML 模板'],['script_source','插件脚本'],['quick_reply','快捷回复'],['css','CSS']];
  el('strong',{text:'当前剧情资源实际绑定 · '+resources.length+' 项'},status);
  el('small',{text:'以下列出已绑定资源，不代表本轮全部触发。原卡声明启用的安全 CSS 会用于隔离 HTML 状态栏，插件脚本仍需单独授权。'},status);
  const list=el('div',{className:'compat-mount-grid'},status);
  for(const [kind,label] of byKind){const group=resources.filter(x=>x.kind===kind),row=el('div',{className:'compat-mount-item'},list);el('strong',{text:label+' '+group.length},row);el('small',{text:kind==='script_source'?'仅保留 · 需授权':kind==='world_info'?'按原卡 enabled 与关键词触发':kind==='regex'?'仅规则适配成功后应用':kind==='html_template'?'HTML 模板可手动安全嵌入':kind==='css'?'原卡安全 CSS 自动作用于隔离状态栏':'按所选版本绑定'},row);}
  const role=$('compat-role-heading');if(role)role.textContent=ses.title||'当前角色剧情';const heading=$('compat-head-title');if(heading)heading.textContent=ses.title||'当前角色剧情';const subheading=$('compat-head-subtitle');if(subheading)subheading.textContent='酒馆角色剧情 · 独立存档';
 }catch(e){if(activeId===sessionId&&sessionGeneration===generation){clear(status);el('span',{text:'资源核对失败（没有更改挂载）：'+(e.code||'E_MOUNT_STATUS')+' '+e.message},status);}}
}
function bootstrap(){
 makePlayLayout();
 setupPlaySheet();
 const latest=el('button',{id:'compat-follow-latest',text:'回到最新消息',hidden:'hidden',onclick:()=>{const box=$('compat-messages');followLatest=true;box.scrollTop=box.scrollHeight;syncLatestButton();}},$('compat-conversation'));
 $('compat-composer')?.before(latest);
 $('compat-messages')?.addEventListener('scroll',()=>{const box=$('compat-messages');followLatest=box.scrollHeight-box.scrollTop-box.clientHeight<96;syncLatestButton();},{passive:true});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&opened&&activeId){refreshMessages().catch(e=>messageFor(activeId,sessionGeneration,'恢复显示后状态刷新失败：'+e.message,'error'));}});
 document.addEventListener('mima:manual-reply-restored',event=>{
  const sessionId=event.detail?.sessionId,generation=sessionGeneration;
  if(!opened||!sessionId||activeId!==sessionId)return;
  Promise.resolve().then(async()=>{await refreshMessages();if(activeId!==sessionId||sessionGeneration!==generation)return;await refreshSessionList();}).catch(e=>messageFor(sessionId,generation,'回复已恢复，界面刷新失败：'+e.message,'error'));
 });
 const actions={'compat-open':open,'compat-close':close,'compat-scan':doImport,'compat-save':commit,'compat-create':create,'compat-send':send,'compat-continue':continueReply,'compat-preview':inspectPreview,'compat-wi-save':saveWorldInfoScanDepth,'compat-export':exportCompat,'compat-export-both':exportBoth,'compat-restore-check':()=>restoreCompat(false),'compat-restore-apply':()=>restoreCompat(true),'compat-stscript-check':()=>manualSTscript(true),'compat-stscript-run':()=>manualSTscript(false),'compat-mvu-template-clear':clearMvuTemplate,'compat-mvu-template-custom-run':()=>selectMvuTemplate('当前剧情临时自定义模板',$('compat-mvu-template-custom').value)};for(const [id,fn]of Object.entries(actions))$(id)?.addEventListener('click',fn);$('compat-restore-file')?.addEventListener('change',()=>{inspectedBackup=null;});$('compat-file')?.addEventListener('change',doImport);$('compat-card-choice')?.addEventListener('change',refreshGreetingChoice);$('compat-input')?.addEventListener('input',()=>{});$('compat-manage-toggle')?.addEventListener('click',toggleManage);$('compat-audio')?.addEventListener('change',ev=>{const f=ev.target.files[0];if(f)nativeAudio(f);});$('compat-quick-status').textContent='选择 PNG、JSON 或 CHARX，即可查看人物并开始聊天。';}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootstrap,{once:true});else bootstrap();root.MimaCompatUI=Object.freeze({open,openWithFile,close});
})(typeof window!=='undefined'?window:globalThis);
