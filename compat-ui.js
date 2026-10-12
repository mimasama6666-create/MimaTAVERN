/* Advanced workbench: all DOM and state scoped to #compat-lab; native app remains untouched. */
(function(root){'use strict';if(typeof document==='undefined')return;const $=id=>document.getElementById(id),s=()=>root.MimaCompatStore,i=()=>root.MimaCompatImport,r=()=>root.MimaCompatRuntime;let opened=false,scan=null,activeId='',busy=false,player=null,assetUrls=[],cardPreviewUrl='',scanGeneration=0,sessionGeneration=0;const approvedBasicPreflights=new Map();
function el(tag,props={},parent){const node=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='text')node.textContent=String(v);else if(k==='className')node.className=v;else if(k==='onclick')node.addEventListener('click',v);else if(k==='title')node.title=v;else node.setAttribute(k,v);}if(parent)parent.append(node);return node;}
function clear(node){node.replaceChildren();}function message(text,type='info'){const output=$('compat-notice');output.textContent=text;output.dataset.kind=type;}
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
 el('strong',{text:characters.length?`已识别 ${characters[0].name} · ${characters.length} 个版本可选择`:'已读取资料，但不是可直接聊天的角色卡'},ready);
 if(cardPreviewUrl){URL.revokeObjectURL(cardPreviewUrl);cardPreviewUrl='';}
 if(scan.format==='png'){cardPreviewUrl=URL.createObjectURL(new Blob([scan.bytes],{type:'image/png'}));const cover=el('img',{className:'compat-card-cover',alt:'已选择的角色卡图片'},ready);cover.src=cardPreviewUrl;}
 el('p',{text:`人物设定：${characters.length?'可用于基础聊天':'未识别'}；世界设定：${world?'部分规则可用':'未发现'}；文字效果：${regex?'需要在浏览器中验证':'未发现'}；互动脚本：${scripts?'不会自动执行，部分需完整酒馆':'未发现'}。`},ready);
 for(const w of scan.warnings)el('p',{text:'提示：'+w},ready);
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
 $('compat-create').disabled=!characters.length;refreshGreetingChoice();
}
function refreshGreetingChoice(){const idx=Number($('compat-card-choice').value),item=scan?.resources?.[idx],select=$('compat-greeting-choice');clear(select);if(item?.kind!=='character')return;const d=item.raw||{};el('option',{value:'0',text:'默认开场白 · '+String(d.first_mes||'（无）').slice(0,56)},select);for(const [i,opening] of (Array.isArray(d.alternate_greetings)?d.alternate_greetings:[]).entries())el('option',{value:String(i+1),text:'备用开场 '+(i+1)+' · '+String(opening).slice(0,56)},select);}
async function doImport(fileOverride=null){const generation=++scanGeneration,file=fileOverride&&typeof fileOverride.arrayBuffer==='function'?fileOverride:$('compat-file').files[0];if(!file)return message('请先选择 PNG、JSON、CHARX 或 ZIP','error');scan=null;$('compat-create').disabled=true;$('compat-save').disabled=true;clear($('compat-quick-status'));clear($('compat-card-choice'));clear($('compat-greeting-choice'));message('正在读取角色卡…');try{const next=await i().inspect(file);if(generation!==scanGeneration)return;scan=next;diagnostics();$('compat-save').disabled=false;message(`已读取 ${scan.resources.length} 项资料，选择开场后即可开始聊天；外部代码仍不会自动运行。`);}catch(e){if(generation===scanGeneration)reportImportFailure(e,file);}}
async function commit(){if(!scan)return;try{const result=await s().importSource({sha256:scan.sha256,filename:scan.filename,format:scan.format,bytes:scan.bytes,versions:scan.versions,warnings:scan.warnings},scan.resources);message(result.reused?'相同来源包已存在，未重复写入。':`已原子保存来源包与 ${result.resources} 项资源，不写旧版剧情资料。`);await refreshSourceList();}catch(e){message(`${e.code||'E_IMPORT'}: ${e.message}`,'error');}}
async function create(){if(!scan)return;try{const sourceId='sha256:'+scan.sha256;const found=await s().get('source_capsules',sourceId);if(!found){
  // One deliberate user gesture: lossless save followed by new session.
  // IndexedDB importSource is atomic and idempotent by source SHA256.
  await s().importSource({sha256:scan.sha256,filename:scan.filename,format:scan.format,bytes:scan.bytes,versions:scan.versions,warnings:scan.warnings},scan.resources);
}const selected=Number($('compat-card-choice').value),index=scan.resources[selected]?.index;const rsrc=(await s().all('resource_ir')).find(v=>v.sourceId===sourceId&&v.index===index&&v.kind==='character');if(!rsrc)throw new Error('未找到明确选中的角色来源');const ses=await r().createSession(sourceId,{characterResourceId:rsrc.id,greetingIndex:Number($('compat-greeting-choice').value||0)});await loadSession(ses.id);$('compat-lab').classList.add('in-chat');$('compat-lab').classList.remove('show-advanced');message('已进入角色剧情。人物和原始卡片保存在当前浏览器，原生剧情不受影响。');}catch(e){message(`${e.code||'E_COMPAT'}: ${e.message}`,'error');}}
async function refreshSourceList(){
 const [sources,allResources]=await Promise.all([s().all('source_capsules'),s().all('resource_ir')]);
 const box=$('compat-sources');clear(box);const active=activeId?await r().getSession(activeId):null;
 for(const item of sources){
  const row=el('details',{},box);el('summary',{text:`${item.filename} · SHA256 ${item.sha256.slice(0,16)}`},row);
  el('button',{text:'原样导出',onclick:()=>download(item.filename,new Blob([item.bytes],{type:'application/octet-stream'}),'application/octet-stream')},row);
  if(!active||item.id===active.sourceId)continue;
  for(const res of allResources.filter(x=>x.sourceId===item.id&&['world_info','regex','preset','prompt_presets','css','html_template','media','script_source'].includes(x.kind))){
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
  }
 }
}
async function showTurnControls(sessionId,container){
  const jobs=await r().turnJournal(sessionId);
  for(const j of jobs.filter(j=>['failed','pending'].includes(j.settlement))){
    const row=el('div',{className:'compat-line'},container);
    el('span',{text:`待处理原回合 ${j.id.slice(0,18)} · ${j.settlement} · 第 ${j.attempt||1} 次请求${j.settlement==='pending'?'（刷新后结果未知，重试可能再次调用 Provider）':''}`},row);
    el('button',{text:'按原 turnId 重试',onclick:()=>handleRecovery(sessionId,j.id,'retry',j.attemptId)},row);
    el('button',{text:'终止原回合（保留原文）',onclick:()=>handleRecovery(sessionId,j.id,'abort',j.attemptId)},row);
  }
}
async function handleRecovery(sessionId,turnId,action,expectedAttemptId){
  if(busy)return;busy=true;$('compat-send').disabled=true;
  try{
    if(action==='abort')await r().recoverTurn(sessionId,turnId,'abort',expectedAttemptId);
    else await r().retryTurn(sessionId,turnId,{acceptGaps:$('compat-accept-gaps').checked});
    message(action==='abort'?'已将原回合记为用户终止，原文保留且不会进入后续模型上下文':'已按原回合 ID 重试并完成结算');
  }catch(e){message(`${e.code||'E_TURN_RECOVERY'}: ${e.message}`,'error');}
  finally{busy=false;$('compat-send').disabled=false;await refreshSessionList();if(activeId===sessionId)await refreshMessages();}
}
async function refreshSessionList(){const ses=await s().all('compat_sessions'),box=$('compat-sessions');clear(box);
const shortcuts=$('compat-continue-list');if(shortcuts){clear(shortcuts);if(ses.length){el('strong',{text:'继续之前的酒馆剧情'},shortcuts);for(const item of ses.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,4)){const row=el('div',{className:'compat-line'},shortcuts);el('span',{text:item.title||'未命名剧情'},row);el('button',{text:'继续聊天',onclick:()=>loadSession(item.id)},row);}}}
for(const item of ses){const row=el('div',{className:'compat-line'},box);el('span',{text:item.title+' · 独立剧情'+(item.pendingTurnId?' · 存在未结算回合':'')},row);el('button',{text:'进入',onclick:()=>loadSession(item.id)},row);if(item.id===activeId)await showTurnControls(item.id,box);}}
async function loadSession(id){$('compat-lab').classList.add('in-chat');const generation=++sessionGeneration;if(activeId!==id)root.MimaCompatPlugins?.unmountAll();activeId=id;const ses=await r().getSession(id);if(generation!==sessionGeneration)return;$('compat-current').textContent=`咪嘛馆兼容引擎 · ${ses.title}`;$('compat-conversation').hidden=false;await refreshSessionList();if(generation!==sessionGeneration)return;await refreshSourceList();if(generation!==sessionGeneration)return;await refreshMessages();if(generation!==sessionGeneration)return;await refreshExtensionUI();if(generation!==sessionGeneration)return;await inspectPreview();root.MimaCompatPlugins?.publish?.(id,'session.mounted',{sessionId:id},'session.mounted:'+id+':'+generation)?.catch(e=>message('插件会话事件失败：'+e.message,'error'));}
const STYLE_BASE=`:host{display:block;min-height:90px;max-height:420px;overflow-y:auto;font-family:inherit;color:inherit}article{white-space:pre-wrap;overflow-wrap:anywhere;background:rgba(128,128,128,.1);padding:11px;border-radius:10px;margin:7px 0;line-height:1.55}article.user{margin-left:12%}article.assistant{margin-right:12%}strong{display:block;margin-bottom:7px}`;
function cssSafe(css){if(typeof css!=='string'||css.length>65536||/@(?:import|font-face|namespace|document|property)\b|url\s*\(|expression\s*\(|\\[0-9a-f]{1,6}\s/gi.test(css))throw new Error('E_RESOURCE_SEMANTIC_GAP: 此 CSS 需要外部资源或未验证特性，拒绝自动挂载');return css;}
async function refreshMessages(){if(!activeId)return;const items=await r().displayMessages(activeId),box=$('compat-messages'),shadow=box.shadowRoot||box.attachShadow({mode:'open'});clear(shadow);let css=STYLE_BASE;const session=await r().getSession(activeId);if(session.styleResourceId){const style=await s().get('resource_ir',session.styleResourceId);if(style&&style.kind==='css'){const allowed=(await r().resourcesFor(session)).some(x=>x.id===style.id);if(allowed)css+='\n'+cssSafe(style.raw);}}
el('style',{text:css},shadow);for(const item of items){const article=el('article',{className:'compat-message '+item.role},shadow);el('strong',{text:item.role==='assistant'?'角色':'玩家'},article);el('div',{text:item.displayView},article);if(item.status!=='committed')el('small',{text:'本回合 '+item.status+'（未纳入已完成对话上下文）'},article);if(item.displayError)el('small',{text:'正则显示失败，已显示完整原文：'+item.displayError.code+' '+item.displayError.message},article);}box.scrollTop=box.scrollHeight;}
async function mountStyle(resourceId){const ses=await r().getSession(activeId),res=await s().get('resource_ir',resourceId);if(!res||(res.sourceId!==ses.sourceId&&!(ses.mountGraph||[]).some(m=>m.resourceId===res.id))||res.kind!=='css')throw new Error('CSS 资源未挂载到当前剧情');cssSafe(res.raw);await s().putCAS('compat_sessions',{...ses,styleResourceId:resourceId},ses.revision);await refreshMessages();message('局部 CSS 已启用，只作用于高级剧情的 Shadow DOM；原生主题不变。');}
async function disableStyle(){const ses=await r().getSession(activeId);await s().putCAS('compat_sessions',{...ses,styleResourceId:null},ses.revision);await refreshMessages();message('已卸载局部 CSS，剧情原文未变。');}
function standalonePluginSource(resource){const v=resource.raw;const sources=Array.isArray(v)?v:[v];return sources.map((x,index)=>({label:String(x?.name||x?.scriptName||('脚本 '+(index+1))),code:typeof x==='string'?x:(x?.script||x?.code||x?.content||'')})).filter(x=>typeof x.code==='string'&&x.code.length>0);}
async function refreshExtensionUI(){const target=$('compat-plugins'),cssList=$('compat-css-list'),preview=$('compat-html-preview');clear(target);clear(cssList);clear(preview);if(!activeId)return;
const ses=await r().getSession(activeId),assets=await r().resourcesFor(ses);for(const res of assets.filter(x=>x.kind==='css')){const row=el('div',{className:'compat-line'},cssList);el('span',{text:res.name+' · 未验证第三方 CSS'},row);el('button',{text:ses.styleResourceId===res.id?'已挂载':'手动启用局部 CSS',onclick:()=>mountStyle(res.id).catch(e=>message(e.message,'error'))},row);}if(ses.styleResourceId)el('button',{text:'卸载当前 CSS',onclick:()=>disableStyle().catch(e=>message(e.message,'error'))},cssList);
for(const asset of assets.filter(x=>x.kind==='html_template')){const row=el('div',{className:'compat-line'},preview);el('span',{text:asset.name+' · HTML 模板仅隔离预览'},row);el('button',{text:'预览（无 JS/外链）',onclick:()=>{clear($('compat-html-preview'));const iframe=el('iframe',{sandbox:'',title:'只读 HTML 预览'},$('compat-html-preview'));iframe.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'"><meta charset="utf-8">${String(asset.raw).slice(0,100000)}`;}},row);}
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
for(const res of assets.filter(x=>x.kind==='script_source'))for(const script of standalonePluginSource(res)){const code=script.code;const binary=new TextEncoder().encode(code),hash=await i().digest(binary);const key=ses.id+':'+hash;const row=el('details',{},target);el('summary',{text:script.label+' · 默认不执行 · '+hash.slice(0,12)},row);el('pre',{text:code},row);const caps=el('div',{className:'compat-actions'},row);const checks={};for(const cap of root.MimaCompatPlugins.capabilities){const label=el('label',{},caps),ch=el('input',{type:'checkbox'},label);checks[cap]=ch;label.append(' '+cap);}
const slot=el('div',{className:'compat-plugin-slot'},row);const frame=el('iframe',{title:script.label,style:'width:100%;min-height:100px;border:1px solid #8885'},row);frame.hidden=true;
el('button',{text:'明确授权并运行此脚本',onclick:async()=>{try{const selected=Object.entries(checks).filter(([,v])=>v.checked).map(([k])=>k);if(!selected.length)throw new Error('请至少选择一项具体权限');const existing=await s().get('grants',key);if(existing&&!existing.revokedAt){if(selected.some(cap=>!existing.capabilities.includes(cap)))throw new Error('已有授权不包含新增权限：先撤销，再明确重新授权');}else await root.MimaCompatPlugins.grant(ses.id,hash,selected);frame.hidden=false;await root.MimaCompatPlugins.mount(ses.id,hash,frame,slot,code);message('脚本已在 opaque-origin iframe 启动；只能调用勾选权限内的受控 API，不能代表 Tavern Helper 全面兼容。');}catch(e){message((e.code||'E_PLUGIN')+': '+e.message,'error');}}},row);
el('button',{text:'撤销并卸载',onclick:async()=>{try{await root.MimaCompatPlugins.revoke(ses.id,hash);frame.hidden=true;slot.replaceChildren();message('已撤销当前脚本授权和 iframe。');}catch(e){message(e.message,'error');}}},row);
}}
async function inspectPreview(){if(!activeId)return;try{const preview=await r().preview(activeId,$('compat-input').value||'（未输入）');$('compat-prompt').textContent=JSON.stringify(preview,null,2);$('compat-gap').textContent=preview.gaps.length?'提醒：这张卡有 '+preview.gaps.length+' 项高级效果尚未完整适配。可以直接进行基础剧情；未适配的手机、插件或复杂演出不会自动运行。具体影响请展开本轮追踪。':'人物设定可以用于基础剧情；本引擎尚未与原版酒馆逐项对照。';$('compat-accept-gaps').closest('label').hidden=true;}catch(e){$('compat-prompt').textContent=`${e.code||'E_PREVIEW'}: ${e.message}`;}}
async function send(){
 if(busy||!activeId)return;
 const sessionId=activeId,input=$('compat-input').value.trim();if(!input)return;
 busy=true;$('compat-send').disabled=true;
 try{
   // Preflight is read-only and happens before posting the player's message.
   // Known incompatible effects are disclosed, never silently counted as ran.
   const strict=document.querySelector('input[name="compat-mode"]:checked')?.value==='strict';
   const preflight=await r().preview(sessionId,input);
   if(activeId!==sessionId)return;
   const gaps=Array.isArray(preflight.gaps)?preflight.gaps:[];
   if(gaps.length){
     $('compat-gap').textContent=`本次预计有 ${gaps.length} 项高级规则不能保证运行。基础聊天仍可使用人物设定；未适配的脚本或演出不会擅自执行。点击“查看本轮发送内容”可查看具体缺口。`;
     $('compat-prompt').textContent=JSON.stringify(preflight,null,2);
   }else $('compat-gap').textContent='已完成当前已支持规则的发送前检查；不代表与原版酒馆全部功能等价。';
   if(strict&&gaps.length){message('严格模式已在发送前阻止：请展开本轮发送内容检查缺口，或明确选择基础聊天。','error');return;}
   if(!strict){
     const signature=JSON.stringify(gaps);
     if(approvedBasicPreflights.get(sessionId)!==signature){
       const detail=gaps.slice(0,4).map(x=>x.reason||x.slot||x.entryId||'高级规则缺口').join('；');
       const notice=`这张角色卡将以“基础聊天”方式发送。\n高级脚本、动态状态栏及部分世界书/正则规则未保证按原版酒馆运行。${gaps.length?`\n检测到 ${gaps.length} 项差异：${detail}${gaps.length>4?' 等':''}`:''}\n是否确认使用基础聊天？取消不会发送消息或扣费。`;
       if(!root.confirm(notice)){message('已取消发送，输入仍然保留。');return;}
       approvedBasicPreflights.set(sessionId,signature);
     }
   }
   const response=await r().send(sessionId,input,{basicRoleplay:!strict,strictCompat:strict,acceptGaps:false});
   if(activeId===sessionId){$('compat-input').value='';await refreshMessages();const trigger=response.envelope?.worldInfo;
     $('compat-gap').textContent=trigger?`本轮实际加入 ${trigger.inserted.length} 条世界设定；${trigger.skipped.length} 条未触发或未适配。高级效果差异 ${response.envelope.gaps.length} 项，不会自动执行不可信脚本。`:'回复已保存。';
   }
   message('角色已回复，剧情记录已保存到当前浏览器。');
 }catch(e){message(`${e.code||'E_TURN'}: ${e.message}${e.settlementError?'; settlement: '+e.settlementError:''}`,'error');if(activeId===sessionId)await refreshMessages();}
 finally{busy=false;$('compat-send').disabled=false;await refreshSessionList();}
}
async function exportCompat(){try{const snapshot=await s().snapshot();download('咪嘛馆-兼容资料-哈希备份.json',await s().packBackup(snapshot));message('已导出兼容资料（包含原始卡片与兼容剧情，不包含原生账户密钥）。');}catch(e){message('备份失败，未生成假文件：'+e.message,'error');}}
async function exportBoth(){try{const a=await s().snapshot(),native=await root.MimaStandalone.exportLibrary();root.MimaStandalone.validateLibrary(native);const again=await s().snapshot();const revisionList=o=>JSON.stringify(Object.fromEntries(s().STORES.map(name=>[name,o.records[name].map(x=>[x.id,x.revision??null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))])));const first=revisionList(a),second=revisionList(again);if(first!==second)throw new Error('兼容库资源/会话/消息或权限修订版在快照过程中改变，请重试');const nativeAgain=await root.MimaStandalone.exportLibrary();if(native.storeRevision!==nativeAgain.storeRevision)throw new Error('原生库在快照过程中改变，请重试');const manifest={nativeSha256:await i().digest(new TextEncoder().encode(JSON.stringify(native))),compatSha256:await i().digest(new TextEncoder().encode(s().jsonify(a)))};const envelope={contractRevision:2,label:'non-atomic-dual-snapshot',nativeRevision:native.storeRevision,manifest,compat:a,native};download('咪嘛馆-双库完整备份.json',s().jsonify(envelope));message('双库数据已导出；浏览器两库无法原子同时提交，已对可见修订进行复核。');}catch(e){message('完整备份失败：'+e.message,'error');}}
async function restoreCompat(){const f=$('compat-restore-file').files[0];if(!f)return;try{const parsed=await s().unpackBackup(await f.text());const result=await s().restoreVerified(parsed,{dryRun:true});message('备份关系校验完成（'+(parsed.integrityVerified?'外层 SHA256 已验证':'旧版无外层哈希；仅能人工确认')+'）：'+JSON.stringify(result.counts)+'。未覆盖现有数据。');}catch(e){message('恢复检查失败：'+e.message,'error');}}
async function nativeAudio(file){try{if(player){player.pause();player.remove();player=null;}for(const uri of assetUrls)URL.revokeObjectURL(uri);assetUrls=[];const uri=URL.createObjectURL(file);assetUrls.push(uri);player=el('audio',{controls:'',preload:'none'},$('compat-media'));player.src=uri;await player.play();message('已由用户手势启动当前剧情的本地音频。');}catch(e){message('媒体播放需要用户手势或此格式不受浏览器支持：'+e.message,'error');}}
function stopMedia(){if(player){player.pause();player.remove();player=null;}for(const uri of assetUrls)URL.revokeObjectURL(uri);assetUrls=[];}
function close(){++sessionGeneration;opened=false;if(cardPreviewUrl){URL.revokeObjectURL(cardPreviewUrl);cardPreviewUrl='';}$('compat-lab').classList.add('hidden');$('compat-lab').classList.remove('in-chat');stopMedia();root.MimaCompatPlugins?.unmountAll();}
function open(){opened=true;$('compat-lab').classList.remove('hidden');root.closeDrawer?.();Promise.all([refreshSourceList(),refreshSessionList()]).catch(e=>message('兼容库读取失败，禁止假装无数据：'+e.message,'error'));}
async function openWithFile(file){if(!file||typeof file.arrayBuffer!=='function')throw new Error('选中的原始角色卡已不可用，请重新选择');open();$('compat-lab').classList.remove('in-chat');await doImport(file);}
function toggleManage(){const lab=$('compat-lab');lab.classList.toggle('show-advanced');lab.classList.toggle('in-chat',!lab.classList.contains('show-advanced'));}
function bootstrap(){const actions={'compat-open':open,'compat-close':close,'compat-scan':doImport,'compat-save':commit,'compat-create':create,'compat-send':send,'compat-preview':inspectPreview,'compat-export':exportCompat,'compat-export-both':exportBoth,'compat-restore-check':restoreCompat};for(const [id,fn]of Object.entries(actions))$(id)?.addEventListener('click',fn);$('compat-file')?.addEventListener('change',doImport);$('compat-card-choice')?.addEventListener('change',refreshGreetingChoice);$('compat-input')?.addEventListener('input',()=>{});$('compat-manage-toggle')?.addEventListener('click',toggleManage);$('compat-audio')?.addEventListener('change',ev=>{const f=ev.target.files[0];if(f)nativeAudio(f);});$('compat-quick-status').textContent='选择 PNG、JSON 或 CHARX，即可查看人物并开始聊天。';}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootstrap,{once:true});else bootstrap();root.MimaCompatUI=Object.freeze({open,openWithFile,close});
})(typeof window!=='undefined'?window:globalThis);
