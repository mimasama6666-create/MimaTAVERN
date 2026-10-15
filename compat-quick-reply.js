/* SillyTavern Quick Reply v2 manual adapter. Never auto-runs or evaluates JS. */
(function(root){'use strict';
 const fail=message=>Object.assign(new Error(message),{code:'E_QUICK_REPLY_UNSUPPORTED'}),autoKeys=['executeOnStartup','executeOnUser','executeOnAi','executeOnChatChange','executeOnGroupMemberDraft','executeOnNewChat','executeBeforeGeneration'];
 function parse(resource){
  const groups=[],issues=[];let count=0;
  const issue=(path,message)=>issues.push({path,message});
  function group(raw,path){
   if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.qrList)){issue(path,'不识别的快捷回复结构，保留原始内容');return;}
   if(raw.version!==undefined&&raw.version!==2){issue(path,'只支持 Quick Reply v2');return;}
   if(['disableSend','placeBeforeInput','injectInput'].some(k=>raw[k]!==undefined&&typeof raw[k]!=='boolean')){issue(path,'发送/注入选项必须为布尔值');return;}
   const replies=[],seen=new Set();
   for(const [index,item]of raw.qrList.entries()){
    const at=path+'.qrList['+index+']';
    if(++count>512)throw fail('单个来源超过 512 个快捷回复，未截断或执行');
    if(!item||typeof item!=='object'||typeof item.message!=='string'||item.message.length>16384||item.label!==undefined&&typeof item.label!=='string'||['isHidden',...autoKeys].some(k=>item[k]!==undefined&&typeof item[k]!=='boolean')){issue(at,'按钮文字、消息或开关格式无效');continue;}
    const id=String(item.id??index);if(seen.has(id)){issue(at,'同组按钮 ID 重复');continue;}seen.add(id);
    replies.push({id,path:at,label:item.label||'未命名按钮',title:String(item.title||''),message:item.message,isHidden:item.isHidden===true,automatic:autoKeys.filter(k=>item[k]===true),hasContext:Array.isArray(item.contextList)&&item.contextList.length>0});
   }
   groups.push({path,name:String(raw.name||resource.name||'快捷回复'),disableSend:raw.disableSend===true,placeBeforeInput:raw.placeBeforeInput===true,injectInput:raw.injectInput===true,replies});
  }
  const raw=resource.raw;
  if(Array.isArray(raw)){if(raw.length>32)throw fail('快捷回复组超过 32 个');if(raw.every(x=>x&&typeof x.message==='string'))group({version:2,name:resource.name,qrList:raw},resource.path);else raw.forEach((x,i)=>group(x,resource.path+'['+i+']'));}
  else group(raw,resource.path);
  return {groups,issues};
 }
 function expand(message,context,{script=false}={}){
  let unknown=false;const result=message.replace(/\{\{\s*([^{}]*?)\s*\}\}/g,(token,key)=>{
   const name=key.trim().toLowerCase();if(['char','user','input'].includes(name))return String(context[name]||'');
   // These values belong to the individual STscript step, after earlier pipe
   // commands have run. Plain chat/fill buttons still reject them.
   if(script&&/^(?:pipe|getvar::[\p{L}\p{N}_-]+)$/iu.test(name))return token;
   unknown=true;return token;
  });
  const remaining=script?result.replace(/\{\{\s*(?:pipe|getvar::[\p{L}\p{N}_-]+)\s*\}\}/giu,''):result;
  if(unknown||remaining.includes('{{')||remaining.includes('}}'))throw fail('快捷回复含未支持的宏，未把宏或命令当成玩家台词发送');return result;
 }
 function element(tag,text,parent){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(parent)parent.append(node);return node;}
 async function render(session,resources,bar,settings,options){
  if(!options.live())return;bar.replaceChildren();bar.hidden=true;
  const section=element('section',undefined,settings);section.className='compat-qr-settings';element('h4','快捷回复 · 当前故事',section);
  const isLive=()=>options.live()&&section.isConnected;
  element('p','勾选后在输入栏显示原卡按钮。点击“发送”走当前故事的正式发送流程；斜杠脚本只运行已支持的 STscript。自动钩子和右键子菜单仍保留为未适配，不会自动运行。',section);
  const enabled=new Set(session.quickReplySettings?.enabledResources||[]),current=new Map();let running=false,undo=null;
  const undoButton=element('button','恢复填入前的草稿',section);undoButton.type='button';undoButton.disabled=true;
  undoButton.onclick=()=>{if(!isLive()||!undo||options.isBusy())return;if(options.getDraft()!==undo.inserted){options.onMessage('输入已改变，未用旧草稿覆盖。','error');return;}options.onFill(undo.previous);undo=null;undoButton.disabled=true;};
  async function act(resource,group,reply,fillOnly=false){
   if(running||!isLive()||options.isBusy())return;running=true;
   try{
    const previous=options.getDraft(),context=await options.getContext(),latest=await root.MimaCompatRuntime.getSession(session.id),bound=await root.MimaCompatRuntime.resourcesFor(latest);
    if(!isLive()||options.getDraft()!==previous||!bound.some(x=>x.id===resource.id&&x.sourceId===resource.sourceId&&x.path===resource.path))throw fail('读取按钮时来源、故事或输入已变化，未覆盖草稿');
    const raw=group.injectInput&&previous.length?(group.placeBeforeInput?reply.message+' '+previous:previous+' '+reply.message):reply.message+' ';
    const script=raw[0]==='/'&&!group.disableSend&&!fillOnly,text=expand(raw,{...context,input:previous},{script});
    if(!text.trim())throw fail('快捷回复内容为空');
    const slash=text[0]==='/'&&!group.disableSend&&!fillOnly;
    if(slash){root.MimaCompatSTscript.compile(text);await options.onRun(text);return;}
    if(!isLive())return;undo={previous,inserted:text};undoButton.disabled=false;options.onFill(text);
    if(!fillOnly&&!group.disableSend){await options.onSend();if(isLive()&&options.getDraft()==='')undo.inserted='';}else options.onMessage('快捷回复已填入；可修改后再发送。');
   }catch(e){if(isLive())options.onMessage((e.code||'E_QUICK_REPLY')+': '+e.message,'error');}
   finally{running=false;}
  }
  function paint(){
   if(!isLive())return;bar.replaceChildren();let visible=0;
   for(const {resource,groups}of current.values())if(enabled.has(resource.id))for(const group of groups){
    for(const reply of group.replies.filter(x=>!x.isHidden)){
     const line=element('span',undefined,bar);line.className='compat-qr-button-pair';
     const action=element('button',(reply.message[0]==='/'&&!group.disableSend?'运行脚本 · ':group.disableSend?'填入 · ':'发送 · ')+reply.label,line);action.type='button';action.title=reply.title||group.name;action.onclick=()=>act(resource,group,reply);
     if(!group.disableSend){const fill=element('button','填入',line);fill.type='button';fill.title='仅填入 '+reply.label;fill.onclick=()=>act(resource,group,reply,true);}visible++;
    }
   }bar.hidden=visible===0;
  }
  for(const resource of resources.filter(x=>x.kind==='quick_reply')){
   const block=element('details',undefined,section);element('summary',resource.name,block);
   element('small','来源 '+resource.sourceId+' · '+resource.id+' · '+resource.path,block);
   let parsed;try{parsed=parse(resource);}catch(e){element('p',e.message,block);continue;}
   current.set(resource.id,{resource,groups:parsed.groups});
   for(const problem of parsed.issues)element('p',problem.path+'：'+problem.message,block);
   if(!parsed.groups.some(x=>x.replies.length))continue;
   const label=element('label',undefined,block),check=element('input',undefined,label);check.type='checkbox';check.checked=enabled.has(resource.id);label.append(' 在输入栏显示这组按钮（仅当前故事）');
   check.onchange=async()=>{check.disabled=true;const requested=check.checked;try{
    if(!isLive()||options.isBusy())throw fail('故事正在操作或已切换');
    const latest=await root.MimaCompatRuntime.getSession(session.id),assets=await root.MimaCompatRuntime.resourcesFor(latest);
    if(!isLive()||latest.pendingTurnId||!assets.some(x=>x.id===resource.id&&x.sourceId===resource.sourceId&&x.path===resource.path))throw fail('来源或故事状态已变化，未保存旧设置');
    const ids=new Set(latest.quickReplySettings?.enabledResources||[]);requested?ids.add(resource.id):ids.delete(resource.id);
    await root.MimaCompatStore.putCAS('compat_sessions',{...latest,quickReplySettings:{...latest.quickReplySettings,enabledResources:[...ids]}},latest.revision);
    requested?enabled.add(resource.id):enabled.delete(resource.id);paint();
   }catch(e){if(isLive()){check.checked=enabled.has(resource.id);options.onMessage(e.message,'error');}}finally{check.disabled=false;}};
   for(const group of parsed.groups){element('p',group.name+' · '+group.replies.length+' 个按钮 · '+group.replies.filter(x=>x.isHidden).length+' 个原始隐藏按钮',block);
    for(const reply of group.replies){const item=element('details',undefined,block);element('summary',reply.label+(reply.isHidden?'（原始隐藏）':''),item);element('pre',reply.message,item);if(reply.automatic.length||reply.hasContext)element('small','保留但未运行：'+[...reply.automatic,...(reply.hasContext?['contextList']:[])].join('、'),item);}
   }
  }
  if(!current.size)element('p','没有已识别的快捷回复。可在“我的卡片与外部资源”导入酒馆 v2 快捷回复 JSON，并挂载到当前故事。',section);
  paint();
 }
 root.MimaCompatQuickReply=Object.freeze({version:'mima-quick-reply/1',parse,expand,render});
})(typeof window!=='undefined'?window:globalThis);
