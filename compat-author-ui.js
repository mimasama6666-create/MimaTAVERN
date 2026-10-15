/* Production adapter: a distinct opt-in mode, never upgrades old visual grants. */
(function(root){'use strict';
 const labels={'messages.read':'读取已提交消息正文','chat.read':'读取本故事变量','chat.write':'写入本故事变量','message.read':'读取消息楼层变量','message.write':'写入消息楼层变量','script.read':'读取当前脚本变量','script.write':'写入当前脚本变量','tables.initialize':'首次初始化缺少的变量表（只创建，不覆盖）','ui.mount':'在隔离页面运行作者界面','events.listen':'订阅本故事消息与跨作者自定义事件','events.emit':'向本故事已授权作者广播自定义事件'};
 function element(tag,text,parent){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(parent)parent.append(node);return node;}
 async function render(session,resources,target,{live,onMessage}){
  if(!live())return;const C=root.MimaAuthorContract,H=root.MimaAuthorHost;
  const section=element('section',undefined,target);section.className='compat-author-tools';
  element('h4','作者交互与高级依赖 · v1 子集',section);
  element('p','独立授权本故事消息与 chat/message/script 变量；按钮写入收到回执后才算保存。保留旧 Worker/可视化入口，不继承它们的授权。',section);
  element('small','可选择真实离线 jQuery/lodash/Vue/Zod，支持固定本地 ES module；任意 CDN、全局/预设/角色/扩展变量、正文改写和 swipes 仍不提供。MVU 原版写入协议尚未接管；已有声明式状态结算保留。可信作者 JS 死循环仍可能卡住浏览器。',section);
  let found=0;
  for(const resource of resources.filter(x=>x.kind==='script_source')){
   const source=C.scripts(resource);
   for(const issue of source.issues)element('p','已保留、尚不支持：'+resource.id+' / '+issue.path+' · '+issue.reason,section);
   for(const script of source.scripts){
    const owner=await H.describe(session.id,resource,script);if(!live())return;found++;
    const row=element('details',undefined,section);row.className='compat-author-resource';element('summary',script.label+' · 未启动 · '+owner.scriptHash.slice(0,12),row);
    element('p','来源 '+owner.sourceId+'\n资源 '+owner.resourceId+'\n路径 '+owner.path+'\n脚本 ID '+owner.scriptId+'\n脚本 SHA256 '+owner.scriptHash,row).className='compat-author-source';
    element('small','API 参照 Tavern Helper 4.11.3 的变量/消息声明；实际能力版本为 mima-author-host/1，未声明原版整体兼容。getChatMessages 的 data 字段需要同时授权消息楼层变量读取。',row);
    const raw=element('details',undefined,row);element('summary','完整作者源码（只读）',raw);element('pre',script.code,raw);
    const permissions=element('fieldset',undefined,row);element('legend','本故事授权范围（默认不勾选）',permissions);const checks={};
    for(const cap of C.caps){const label=element('label',undefined,permissions),box=element('input',undefined,label);box.type='checkbox';checks[cap]=box;label.append(' '+labels[cap]);}
    const actions=element('div',undefined,row);actions.className='compat-actions';
    const dependencies=element('fieldset',undefined,row);element('legend','离线库（固定版本，仅在作者页面加载）',dependencies);const libraryChecks={};
    for(const lib of root.MimaAuthorLibraries.list()){const label=element('label',undefined,dependencies),box=element('input',undefined,label);box.type='checkbox';box.checked=(lib.id==='jquery'?/(?:\bjQuery\b|\$\s*\()/ :lib.id==='lodash'?/(?:\blodash\b|\b_\s*\.)/:lib.id==='vue'?/\b(?:vue|Vue)\b/:/\b(?:zod|z)\b/).test(script.code);libraryChecks[lib.id]=box;label.append(' '+lib.id+' '+lib.version);}
    const modeLabel=element('label','脚本形式 ',dependencies),mode=element('select',undefined,modeLabel);for(const [value,label]of [['classic','普通 JavaScript'],['module','ES module（支持 import 与顶层 await）']]){const opt=element('option',label,mode);opt.value=value;}mode.value=/^\s*(?:import\s|export\s)/m.test(script.code)?'module':'classic';
    element('small','模块名：jquery、lodash、vue、zod、zod/v4。勾选库后，esm.sh / jsDelivr 的未指定版本地址和该精确版本地址也映射到这里显示的离线版本；其它版本与远程模块不替换。消息事件在回合提交后发送；跨作者广播暂不支持回调内再次广播。',dependencies);
    const pick=element('button','选择全部已支持权限',actions);pick.type='button';pick.onclick=()=>Object.values(checks).forEach(x=>x.checked=true);
    const state=element('p','状态：已保留 / 需明确授权；尚未运行作者脚本',row);state.setAttribute('role','status');
    const slot=element('div',undefined,row);slot.className='compat-author-slot';
    const launch=element('button','明确授权并运行作者交互',actions);launch.type='button';let starting=false,launchEpoch=0;
    const isCurrent=()=>live()&&row.isConnected;
    const show=packet=>{if(isCurrent()){row.querySelector('summary').textContent=script.label+' · '+packet.state+' · '+owner.scriptHash.slice(0,12);state.textContent='状态：'+packet.state+' · '+packet.message;if(packet.state==='error')onMessage(packet.message,'error');}};
    launch.onclick=async()=>{
     if(starting||!isCurrent())return;starting=true;launch.disabled=true;
     const ticket=++launchEpoch,current=()=>isCurrent()&&ticket===launchEpoch;let frame;
     try{
      const selected=C.permissions(Object.entries(checks).filter(([,x])=>x.checked).map(([cap])=>cap));
      const libraries=Object.entries(libraryChecks).filter(([,x])=>x.checked).map(([id])=>id),scriptMode=mode.value;
      if(!root.confirm('仅运行你信任的作者源码。\n\n来源：'+owner.sourceId+'\n脚本：'+owner.scriptId+'\n权限：'+selected.map(x=>labels[x]).join('、')+'\n离线库：'+(libraries.join('、')||'无')+'\n所选库的常见未指定版本 CDN 导入将使用界面显示的固定离线版本。其它版本不替换。\n形式：'+scriptMode+'\n\n脚本只在独立无网络页面执行，但任意 JS 死循环仍可能卡住浏览器。确定授权本故事并运行？'))return;
      const old=await root.MimaCompatStore.get('grants',C.grantId(owner));if(!current())throw C.fail('E_AUTHOR_STALE','授权前已停止或切换故事');
      if(old&&!old.revokedAt){if(JSON.stringify([...old.capabilities].sort())!==JSON.stringify([...selected].sort()))throw C.fail('E_AUTHOR_PERMISSION','已有作者授权与当前选择不同，请先撤销再重新授权');}
      else await H.grant(owner,selected,{live:current});
      if(!current())throw C.fail('E_AUTHOR_STALE','授权后已停止或切换故事');
      frame=document.createElement('iframe');frame.title=script.label+' · 作者交互';slot.append(frame);
      await H.mount(owner,script.code,frame,{live:current,libraries,scriptMode,onStatus:packet=>{if(current())show(packet);}});
      if(!current())return;
      onMessage('作者界面已加载；变量只有收到提交回执后才保存，发送/预览会先等待本次作者动作。');
     }catch(e){frame?.remove();if(current())show({state:'error',message:(e.code||'E_AUTHOR_UI')+': '+e.message});}
     finally{starting=false;if(isCurrent())launch.disabled=false;}
    };
    const stop=element('button','停止作者脚本',actions);stop.type='button';stop.onclick=()=>{launchEpoch++;H.stop(C.grantId(owner),'已手动停止');show({state:'stopped',message:'已停止启动或运行；请以已提交变量为准'});};
    const revoke=element('button','撤销作者权限',actions);revoke.type='button';revoke.onclick=async()=>{if(!isCurrent())return;launchEpoch++;try{await H.revoke(owner);if(isCurrent())show({state:'revoked',message:'作者权限已撤销，已保存状态保留'});}catch(e){if(isCurrent())show({state:'error',message:e.message});}};
   }
  }
  if(!found)element('p','当前绑定资源没有本宿主可识别的独立作者脚本；未知资源仍可查看和导出。',section);
  const values=element('details',undefined,section);element('summary','查看本故事已提交的作者变量',values);const read=element('button','刷新已提交变量',values);read.type='button';const output=element('pre','尚未读取',values);
  read.onclick=async()=>{read.disabled=true;try{const snapshot=await root.MimaAuthorStore.snapshot(session.id);if(live()&&output.isConnected)output.textContent=JSON.stringify({storyRevision:snapshot.sessionRevision,variableRevision:snapshot.variableRevision,tables:snapshot.tables.map(t=>({scope:t.scope,owner:t.owner,revision:t.revision,value:t.value}))},null,2);}catch(e){if(live()&&output.isConnected)output.textContent=(e.code||'E_AUTHOR_UNAVAILABLE')+': '+e.message;}finally{if(read.isConnected)read.disabled=false;}};
 }
 root.MimaAuthorUI=Object.freeze({render});
})(typeof window!=='undefined'?window:globalThis);
