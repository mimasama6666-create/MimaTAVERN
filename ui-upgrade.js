/* Settings hierarchy and scoped component layout; canonical settings stay in app.js. */
(()=>{'use strict';
 const groups=[['story','剧情',['roles','context','memory','prompt']],['library','资料库',['png-resources','worldbook','presets','regex','templates']],['appearance','外观',['appearance']],['connection','连接',['api']],['tools','管理',['data','diagnostics','performance','updates']]];
 const searchIndex=[
 ['角色与用户人设','roles','角色 persona 面具 挂载 开场白'],['上下文与模型容量','context','历史 窗口 保留 裁剪 温度'],['输入与历史格式','context','输入语义 历史html 纯文本','ctx-airp-mode'],['状态栏与HTML检查','context','html 选择器 短协议 正则 合同 完整性','ctx-complete-html'],['记忆与摘要','memory','核心 事实 总结 滚动 手动恢复'],['世界书','worldbook','关键词 常驻 条目'],['预设','presets','提示词 规则 风格'],['正则转换与预览','regex','regex 美化 状态栏 助手 测试'],['自定义标签与结尾标签','regex','语义标签 自定义标签 结尾 结束标记 协议','regex-contract-pack'],['设置模板','templates','默认 模板 配置'],['角色卡资源解析','png-resources','png 导入 sillytavern'],['本地字体管理','appearance','字体 ttf ttc otf woff 补字 批量 字重','mima-local-fonts'],['字体与阅读排版','appearance','字号 行距 字体 预览 正文','mima-font-settings'],['网络字体管理','appearance','字体 链接 url','mima-remote-fonts'],['CSS与主题','appearance','css 主题 日夜 夜间 美化 布局 工坊'],['界面显示比例','appearance','大小 密度 缩放 80 100','mima-ui-density'],['API连接与模型','api','接口 地址 key 模型 流式 tokens'],['提示词检查','prompt','prompt 实际请求 注入'],['备份与恢复','data','数据 备份 导入 导出 云端 github hf'],['故障诊断','diagnostics','坏回复 错误 日志 恢复 html'],['性能检查','performance','压力 卡顿 运行'],['更新说明','updates','版本 更新 公告']
 ];
 const foldStates=new Map();let observer=null;
 const $=id=>document.getElementById(id);
 function reveal(el){for(let p=el;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;el.scrollIntoView({block:'center'});if(/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))el.focus({preventScroll:true});}
 function directory(tab){
  const strip=$('settings-modal')?.querySelector('.settings-tabs');if(!strip)return;
  let nav=$('mima-settings-directory');if(!nav){
   nav=document.createElement('div');nav.id='mima-settings-directory';nav.innerHTML='<div class="mima-settings-groups" role="navigation" aria-label="设置分类"></div><div class="mima-settings-search"><input class="field" type="search" aria-label="搜索设置" placeholder="搜索设置、功能或字体…"><div class="mima-settings-results" role="list" hidden></div></div>';strip.before(nav);
   const bar=nav.firstElementChild;for(const [id,label,tabs]of groups){const b=document.createElement('button');b.type='button';b.dataset.group=id;b.textContent=label;b.onclick=()=>window.switchSettingsTab(tabs[0]);bar.append(b);}
   const input=nav.querySelector('input'),results=nav.querySelector('.mima-settings-results');
   input.addEventListener('input',()=>{results.replaceChildren();const q=input.value.trim().toLocaleLowerCase();results.hidden=!q;if(!q)return;
    const matches=searchIndex.filter(r=>(r[0]+' '+r[2]).toLocaleLowerCase().includes(q));
    for(const [label,target,,field]of matches){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{input.value='';results.hidden=true;await window.openSettings(target);if(field){const el=$(field);if(el)reveal(el);}};results.append(b);}
    if(!matches.length){const empty=document.createElement('span');empty.textContent='没有匹配项，可换一个关键词。';results.append(empty);}
   });
  }
  const current=groups.find(g=>g[2].includes(tab))||groups[0];
  for(const b of nav.querySelectorAll('[data-group]')){const active=b.dataset.group===current[0];b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');}
  for(const b of strip.querySelectorAll('button')){const extra=/openMimaGuide/.test(b.getAttribute('onclick')||'')?'tools':'library';b.hidden=b.dataset.tab?!current[2].includes(b.dataset.tab):current[0]!==extra;}
  if(!observer){observer=new MutationObserver(()=>{const active=strip.querySelector('button.active[data-tab]')?.dataset.tab;if(active)enhance(active);});observer.observe($('settings-content'),{childList:true});}
 }
 function fold(parent,label,key,children,open=false){
  const details=document.createElement('details');details.className='mima-settings-fold';details.dataset.foldKey=key;details.open=foldStates.has(key)?foldStates.get(key):open;
  const summary=document.createElement('summary');summary.textContent=label;const body=document.createElement('div');body.className='mima-settings-fold-body';body.append(...children);details.append(summary,body);details.addEventListener('toggle',()=>foldStates.set(key,details.open));parent.append(details);return details;
 }
 function context(root){
  const section=$('ctx-recent')?.closest('.settings-section'),grid=$('ctx-recent')?.closest('.form-grid');if(!section||!grid)return;
  const inputs=[...grid.children],auto=$('ctx-summary')?.closest('.form-full');
  const capacity=inputs.filter(n=>n.contains($('ctx-recent'))||n.contains($('ctx-trim-batch'))||n.contains($('ctx-trim-min-recent'))||n.contains($('ctx-summary-trigger'))||n.contains($('ctx-wbbudget')));
  const semantics=inputs.filter(n=>n.contains($('ctx-airp-mode'))||n.contains($('ctx-history-html-projection')));
  const html=[];if(auto){let taking=false;for(const node of [...auto.children]){if(node.contains($('ctx-complete-html')))taking=true;if(node.contains($('ctx-pinned-on')))taking=false;if(taking)html.push(node);}}
  const notes=inputs.filter(n=>n.contains($('ctx-pinned'))||n.contains($('ctx-usernotes'))||n.contains($('ctx-ainotes')));
  const mount=document.createElement('div');mount.className='form-full mima-settings-group-stack';grid.prepend(mount);
  fold(mount,'容量与历史窗口','context-capacity',capacity);fold(mount,'输入与历史格式','context-input',semantics);
  if(auto)fold(mount,'自动摘要与已存记忆','context-auto',[auto]);fold(mount,'状态栏与 HTML 完整性','context-html',html);
  fold(mount,'固定设定与会话笔记','context-notes',notes);
 }
 function memory(root){const sections=[...root.querySelectorAll(':scope > .settings-section')];sections.forEach((section,i)=>{if(i===0)return;const h=section.querySelector('h3');if(!h)return;const placeholder=document.createElement('div');section.before(placeholder);const heading=h.textContent.trim();h.remove();const f=fold(placeholder,heading,'memory-'+i,[section]);placeholder.replaceWith(f);});}
 function enhance(tab){
  const root=$('settings-content');if(!root||!root.firstElementChild)return;const first=root.firstElementChild;if(first.dataset.mimaLayout===tab)return;first.dataset.mimaLayout=tab;
  if(tab==='context')context(root);if(tab==='memory')memory(root);
  if(tab==='templates')for(const d of root.querySelectorAll('.mima-template-section')){const key='template-'+d.querySelector('summary')?.textContent.trim();d.open=foldStates.has(key)?foldStates.get(key):d.dataset.defaultOpen==='true';d.addEventListener('toggle',()=>foldStates.set(key,d.open));}
 }
 window.MimaSettingsLayout={directory,enhance};
})();
