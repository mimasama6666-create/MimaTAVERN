/* Application controls only. Authored story/HTML and imported content are never decorated. */
(()=>{'use strict';
 const W=window,art={story:'theater',library:'archive',tools:'settings',novel:'compose',article:'compose',chat:'chat',appearance:'appearance',connection:'connection',api:'connection',roles:'heart',context:'memory',memory:'memory',prompt:'preset',worldbook:'worldbook',presets:'preset',regex:'regex',templates:'template',data:'backup',sessions:'archive',history:'archive',task:'template',instructions:'preset',parameters:'settings',chapters:'compose',archive:'archive',guide:'guide'};
 const paths={plus:'M12 5v14M5 12h14',send:'m5 12 7-7 7 7M12 5v14',stop:'M6 6h12v12H6z',edit:'m14 5 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16z',delete:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',copy:'M8 8h12v13H8zM16 8V3H3v13h5',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',preview:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',back:'m14 5-7 7 7 7',close:'m6 6 12 12M6 18 18 6',retry:'M20 8V3l-4 4a8 8 0 1 0 3 10M20 8h-5',save:'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-7h10v7',check:'m4 12 5 5L20 6',up:'m5 15 7-7 7 7',down:'m5 9 7 7 7-7',pin:'m9 3 6 0 0 6 3 3-12 0 3-3zM12 12v9',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7h.01',bolt:'m13 2-9 12h7l-1 8 10-12h-7z'};
 const roots='#settings-modal,#editor-modal,#new-session-modal,#novel-modal,#assistant-modal,#session-drawer,#compat-sheet,#compat-tools-stack,#mima-play-tools,#mima-settings-json-ready,#mima-export-task,.drawer-footer,.topbar,#mima-feature-menu,.quick-actions,.nav-bar,.main-nav,.workspace-dialog';
 const ignore='.tavern-story-content,[data-mima-display-boundary],.assistant-chat-text,.novel-prose-view,.novel-draft-prose,.plain-chat-message pre,.article-version pre,.workspace-rescue pre,pre,code,textarea,[contenteditable],.novel-chapter-item,.novel-project-item';
 function make(name){
  name=({diagnostics:'info',performance:'bolt',updates:'info',css:'appearance',preset:'presets'})[name]||name;
  let el;if(art[name]){el=document.createElement('img');el.src='./assets/mima-gothic-'+art[name]+'.png';el.alt='';el.draggable=false;el.className='mima-ui-icon mima-gothic-ui-icon';el.decoding='async';el.width=24;el.height=24;}
  else if(paths[name]){el=document.createElementNS('http://www.w3.org/2000/svg','svg');el.setAttribute('viewBox','0 0 24 24');el.setAttribute('fill','none');el.setAttribute('stroke','currentColor');el.setAttribute('stroke-width','1.7');el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');const p=document.createElementNS(el.namespaceURI,'path');p.setAttribute('d',paths[name]);el.append(p);el.setAttribute('class','mima-ui-icon mima-ui-action-icon');el.setAttribute('focusable','false');}
  else return null;el.setAttribute('aria-hidden','true');el.dataset.mimaIcon=name;return el;
 }
 function key(el){
  const d=el.dataset;if(d.mimaIcon)return d.mimaIcon;if(d.group)return d.group;if(d.tab&&art[d.tab])return d.tab;if(d.writingMode)return d.writingMode;if(d.appearanceTarget)return ({theme:'appearance','font-settings':'edit','local-fonts':'archive','remote-fonts':'connection','css-presets':'appearance',display:'preview',motion:'bolt',sound:'info'})[d.appearanceTarget];if(d.compatPane)return {character:'roles',effects:'appearance',settings:'tools',archive:'archive'}[d.compatPane];
  const a=d.wAction||d.messageAction||d.versionAction||d.assistantSessionAction||d.novelAction||'';
  const actions={create:'plus',select:'archive',rename:'edit',delete:'delete',archive:'archive',recover:'retry',generate:el.textContent.includes('发送')?'send':'article',stop:'stop',preview:'preview',models:'connection','remove-preset':'delete','preset-up':'up','preset-down':'down','import-source':'upload',sources:'novel','source-project':'novel','take-chapter':'download',export:'download','save-source':'save','article-source':'article','article-result':'presets','close-page':'back','retry-record':'retry','conflict-local':'save','conflict-canonical':'check','rescue-export':'download','rescue-copy':'copy','rescue-dismiss':'close','edit-export':'download','edit-copy':'copy','edit-retry':'retry',regenerate:'retry',request:'preview',source:'article',replace:'check',saveSegment:'save',selectChapter:'novel',selectProject:'novel',previewDraft:'preview',continueDraft:'article',editDraft:'edit',regenerateDraft:'retry',rejectDraft:'delete',acceptDraft:'check'};
  if(actions[a])return actions[a];if(art[a])return a;if(d.assistantSession)return 'archive';
  const code=el.getAttribute('onclick')||'';const section=code.match(/(?:showDrawer|settingsTab|setTab|openSettings|switchSettingsTab)\(['"]([^'"]+)/)?.[1];if(section&&art[section])return section;
  if(/(?:export|download)/i.test(code))return 'download';if(/(?:import|chooseTxt)/i.test(code))return 'upload';
  if(/(?:delete|remove|clearAll)/i.test(code))return 'delete';if(/(?:refresh|reload|reset|recover|recheck|retry)/i.test(code))return 'retry';
  if(/(?:save|apply|mount)/i.test(code))return 'save';if(/(?:preview|inspect|review)/i.test(code))return 'preview';
  if(/(?:Editor|rename|editDraft)/.test(code))return 'edit';if(/(?:create|add[A-Z]|newSession)/.test(code))return 'plus';
  if(/(?:openMimaGuide)/.test(code))return 'guide';if(/(?:License|ReleaseNotice)/.test(code))return 'info';
  const text=el.textContent.replace(/^[＋+↻↺⇧↓↑✓✒☷⚡]\s*/,'').trim();
  if(/^(AI 工具)/.test(text))return 'regex';if(/^(功能)$/.test(text))return 'tools';if(/^小说$/.test(text))return 'novel';if(/^剧情$/.test(text))return 'archive';
  if(/^(返回|取消|关闭|完成\s*\/\s*收起|完成整理)$/.test(text))return 'back';
  if(/^(设置|生成设置|连接与模型|生成参数|当前参数|外观设置|参数)$/.test(text))return 'tools';
  if(/^(会话|历史|会话与历史|项目与章节|章节目录|全部历史)/.test(text))return 'archive';
  if(/^(任务资料|任务资料与|保留资料|设置模板)/.test(text))return 'task';
  if(/^(新建|新增|添加|空白项目)/.test(text))return 'plus';if(/^开始.*剧情/.test(text))return 'story';
  if(/^(复制|拷贝)/.test(text))return 'copy';if(/^(导出|下载|浏览器下载)/.test(text))return 'download';if(/^(导入|上传|选择文件)/.test(text))return 'upload';
  if(/^(预览|查看.*请求|.*请求预览|本章请求|新章请求|实际请求)/.test(text))return 'preview';
  if(/^(删除|移除|清空|批量删除)/.test(text))return 'delete';if(/^(保存|另存|应用|使用此版本)/.test(text))return 'save';
  if(/^(编辑|改名|重命名)/.test(text))return 'edit';if(/^(重说|重写|重新|刷新|重试|恢复)/.test(text))return 'retry';
  if(/^(发送)$/.test(text))return 'send';if(/^(停止)/.test(text))return 'stop';if(/^(生成|续写|优化|新篇章续写)/.test(text))return 'article';
  if(/^(分析|记忆|档案)/.test(text))return 'memory';if(/^(模型|连接)/.test(text))return 'connection';if(/^(外观|CSS 美化)/.test(text))return 'appearance';
  if(/^(固定侧栏)/.test(text))return 'pin';if(/^(上移)/.test(text))return 'up';if(/^(下移)/.test(text))return 'down';return null;
 }
 function decorate(root){
  const controls=root.matches?.('button,summary')?[root]:[...root.querySelectorAll?.('button,summary')||[]];
  for(const el of controls){if(!el.closest(roots)||el.closest(ignore)||el.classList.contains('icon-btn'))continue;
   // Keep hand-authored icons, logos and any per-theme illustrations intact.
   if(el.querySelector('img,svg,.mima-oss-icon,.mima-gothic-inline-icon,.mima-ui-icon'))continue;
   if(el.closest('.settings-tabs,.mima-settings-groups')&&['::before','::after'].some(part=>{const s=getComputedStyle(el,part);return /url\s*\(/i.test([s.backgroundImage,s.maskImage,s.webkitMaskImage,s.content].join(' '));}))continue;
   const label=el.textContent.trim();if(!label||/^[‹›×✕↑↓＋+⚡★☆☷]+$/.test(label)||/^[\p{Extended_Pictographic}©☀☾]/u.test(label))continue;
   const name=key(el);if(!name)continue;const icon=make(name);if(!icon)continue;
   const first=[...el.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);if(first)first.textContent=first.textContent.replace(/^(\s*)[＋+↻↺⇧↓↑✓✒☷⚡]\s*/,'$1');
   el.prepend(icon);el.classList.add('mima-icon-control');
  }
 }
 function start(){
  decorate(document);const observer=new MutationObserver(records=>{
   const nodes=new Set();for(const r of records){const target=r.target.nodeType===1?r.target:r.target.parentElement;if(!target?.closest(roots)||target.closest(ignore))continue;
    if(target.matches('button,summary')){if([...r.addedNodes].every(n=>n.nodeType===1&&n.matches('.mima-ui-icon')))continue;nodes.add(target);}
    else for(const n of r.addedNodes)if(n.nodeType===1&&!n.matches('.mima-ui-icon'))nodes.add(n);
   }for(const node of nodes)if(node.isConnected)decorate(node);
  });
  // UI subtrees only; direct-body popup discovery never observes the story subtree.
  const watch=root=>{decorate(root);observer.observe(root,{childList:true,subtree:true});};
  const mounted=[...document.querySelectorAll(roots)].filter(el=>!el.parentElement?.closest(roots));for(const root of mounted)watch(root);
  new MutationObserver(records=>{for(const r of records)for(const el of r.addedNodes)if(el.nodeType===1&&el.matches(roots))watch(el);}).observe(document.body,{childList:true});
 }
 W.MimaUiIcons={make,decorate};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
