/* MIMA Theme Atelier — mobile-first visual editor, no direct access to story stores. */
(()=>{'use strict';
const C=window.MimaAtelierCore;if(!C){console.error('MimaAtelierCore missing');return;}
const $=id=>shadow?.getElementById(id),esc=C.esc,cl=C.clone,uid=C.uid;
let catalogSearch='',catalogKind='all',catalogPage=0,previewCandidate=null,previewLayer='combined';
let host=null,shadow=null,project=null,tab='design',selected=['shell'],patternId=null,stickerId=null,undo=[],redo=[],saveTimer=null,previewStyle=null,statusTimer=null,opened=false,drag=null,applying=false,activeVersion=0,sceneMode='day',previewMode='structure',previewDevice='fit',gestureKey=null,saveQueue=Promise.resolve(),draftVersions=new Map(),fullscreen=false,previewTimer=null,beforeSnapshot=null,compareBefore=false,openingPromise=null,draftConflict=null,changingProject=false,liveDocked=false,liveRevisionTimer=null,liveDockOpId=null,pickingRealArea=false;
const FIELD_GROUPS={
 '材质与颜色':[
 ['material','材质类型','select',['flat','minimal','glass','neo','skeuo','clay','aqua','brutal']],['fill','背景颜色','color'],['alpha','背景不透明度','range',0,100,1],['ink','文字颜色','color'],['gradient','渐变类型','select',['none','linear','radial','conic']],['gradientTo','渐变第二色','color'],['angle','渐变角度','range',0,360,1],['imageOpacity','背景图片可见度','range',0,100,1],['imagePosX','背景图横向焦点','range',0,100,1],['imagePosY','背景图纵向焦点','range',0,100,1],['maskColor','遮罩颜色','color'],['maskOpacity','有图片时的背景遮罩浓度','range',0,100,1]],
 '边框与形状':[['radius','圆角','range',0,100,1],['border','边框粗细','range',0,20,.5],['borderColor','描边颜色','color'],['borderAlpha','边框透明度','range',0,100,1],['borderTop','上边框（-1 随统一）','range',-1,20,.5],['borderRight','右边框（-1 随统一）','range',-1,20,.5],['borderBottom','下边框（-1 随统一）','range',-1,20,.5],['borderLeft','左边框（-1 随统一）','range',-1,20,.5],['paddingX','水平内边距（-1 继承）','range',-1,80,1],['paddingY','垂直内边距（-1 继承）','range',-1,80,1],['shape','外形','select',['round','pill','cookie','cloud','ticket','hexagon']],['ornament','附加外壳装饰','select',['none','double','dotted','cream','inset']]],
 '万象风格细节':[['visualEffect','纹理与效果','select',['none','stars','lace','bubbles','grain','paper','scanlines','pixels','grid','gloss','holo','ornate','watercolor','waves','dots','geometric','stripes','marble']],['decorColor','效果颜色','color'],['decorOpacity','效果透明度','range',0,100,1],['decorSize','纹理尺寸','range',6,100,1]],
 '阴影与玻璃':[['shadow','阴影强度','range',0,50,1],['shadowY','阴影位移','range',0,30,1],['blur','磨砂 / 背景图片模糊（按选中区域）','range',0,60,1]],
 '文字与动态':[['fontSize','字体大小','range',8,38,.5],['stroke','文字描边粗细','range',0,4,.2],['strokeColor','文字描边颜色','color'],['textShadow','文字阴影','range',0,20,.5],['animation','动画','select',['none','float','glow']],['animationDuration','动画周期（秒）','range',.2,30,.2]]
};
const LABELS={flat:'平面',minimal:'极简',glass:'磨砂',neo:'新拟物',skeuo:'复古拟物',clay:'软陶',aqua:'水晶',brutal:'粗野',none:'无',linear:'线性',radial:'径向',conic:'角向',round:'普通圆角',pill:'胶囊',cookie:'饼干',cloud:'云朵',ticket:'票券',hexagon:'六角',float:'悬浮',glow:'呼吸亮度',double:'双重包边',dotted:'点状花边',cream:'奶油外壳',inset:'内部细边',stars:'星空',lace:'蕾丝',bubbles:'水泡',grain:'细腻颗粒',paper:'纸纹',scanlines:'屏幕扫描线',pixels:'像素块',grid:'网格',gloss:'镜面高光',holo:'全息彩光',ornate:'古典纹章',watercolor:'水彩叠色',waves:'波浪纹',dots:'波点',geometric:'几何',stripes:'斜条纹',marble:'大理石'};
const PATTERN_LABELS={dots:'韩系波点',grid:'细格纹',stripes:'横斜条纹',diagonal:'斜线',checker:'棋盘格',waves:'水波纹',rings:'同心圆',radial:'放射纹',diamond:'菱格',cross:'十字',halftone:'半调点'};
function note(s,error=false){const n=$('atl-status');if(n){n.textContent=s;n.dataset.error=error?'1':'0';}clearTimeout(statusTimer);statusTimer=setTimeout(()=>{if(n)n.textContent=''},5800)}
function start(){if(host)return;host=document.createElement('div');host.id='mima-atelier-host';host.style.cssText='display:none;position:fixed;inset:0;z-index:2147483000';document.body.appendChild(host);shadow=host.attachShadow({mode:'open'});shadow.innerHTML=`<link rel="stylesheet" href="./atelier/atelier-ui.css?v=20261022-r19-atelier-live-dock"><main class="atl-app"><header class="atl-header"><button data-action="close" aria-label="关闭">‹</button><div class="atl-heading"><b>✦ MIMA THEME ATELIER</b><small>咪嘛馆 · 独立主题工坊</small></div><button data-action="undo" title="撤销">↶</button><button data-action="redo" title="重做">↷</button><button class="atl-pick-real" data-action="pick-real-area" type="button" aria-pressed="false">点选真实区域</button><button class="atl-exit-live" data-action="exit-live-editor" type="button">结束真实编辑</button><button class="atl-apply" data-action="saveapply">保存并应用</button></header><div class="atl-main"><section class="atl-preview-section"><div class="atl-preview-toolbar"><strong id="atl-project-name">主题工坊</strong><div><button data-action="before">修改前比较</button><button data-action="sandbox-preview">脱敏结构预览</button><button data-action="live-editor" title="不离开编辑器，直接在真实剧情页面调整样式">★ 真实页面边看边调</button><button data-action="live-preview">单独试穿</button><select id="atl-preview-layer" aria-label="预览 CSS 来源"><option value="combined">叠加现有 CSS</option><option value="atelier">仅工坊效果</option></select><select id="atl-device" aria-label="模拟预览尺寸"><option value="fit">自适应</option><option value="compact">小手机</option><option value="phone">大手机</option><option value="landscape">手机横屏</option><option value="tablet">平板</option></select><button data-action="expand" aria-label="放大预览" aria-pressed="false">⛶ 全屏</button></div></div><div class="atl-preview-frame" id="atl-preview-frame" data-device="fit"><button type="button" class="atl-exit-fullscreen" data-action="exit-fullscreen" aria-label="退出全屏预览">✕ 退出全屏</button><iframe id="atl-sandbox-preview" title="隔离结构快照试穿预览（模拟界面结构）" sandbox="" hidden></iframe><div id="atl-preview" data-atl-preview="1"><div class="atl-scene"><div class="atl-demo-top"><span>☰ 剧情</span><b>✦ 咪嘛馆</b><span>功能　设置</span></div><div class="atl-demo-chat"><div class="atl-demo-message" data-demo-role="assistant"><strong>圣德芬 · 剧情示例</strong><p>柔和的阳光落在窗边，咖啡香气悄悄漫开。这里会实时显示你制作的主题。</p></div><div class="atl-demo-message atl-demo-user" data-demo-role="user"><strong>你 · 对话示例</strong><p>我想看看新的主题是什么样子！</p></div><div class="atl-demo-session-list"><div class="atl-demo-session-item">✦ 独立宇宙 <small>12 条剧情</small></div><div class="atl-demo-session-item">✧ 另一段旅途 <small>9 条剧情</small></div></div><div class="atl-demo-card"><b>✧ 角色状态栏</b><div class="atl-demo-status"><span>心情　☕ 温柔</span><div class="atl-demo-progress"><i></i></div></div></div><div class="atl-demo-buttonrow"><button class="atl-demo-primary" type="button">主要按钮</button><button class="atl-demo-secondary" type="button">次要按钮</button></div></div><div class="atl-demo-composer"><input class="atl-demo-field" placeholder="输入剧情和对话……" readonly><button class="atl-demo-send" type="button">➤</button></div><div id="atl-preview-stickers" class="atl-preview-stickers"></div></div></div></div><div class="atl-preview-foot"><span>材质草图＝示意；结构预览＝近似；点「真实页面边看边调」可用实际剧情 DOM 与全部 CSS 边编辑边试穿（不保存）。</span><span id="atl-selected-label"></span></div></section><section class="atl-editor"><nav class="atl-tabs"><button data-tab="templates">模板</button><button data-tab="design">样式</button><button data-tab="patterns">纹样</button><button data-tab="stickers">贴纸</button><button data-tab="project">工程</button></nav><div id="atl-effect-warnings" class="atl-effect-warnings" role="note" hidden></div><div id="atl-editor-content" class="atl-editor-content"></div><p id="atl-status" class="atl-status" role="status"></p></section></div></main><input type="file" id="atl-image-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden><input type="file" id="atl-font-input" accept=".ttf,.otf,.woff,.woff2" hidden><input type="file" id="atl-project-input" accept=".json,.css,.zip,application/json,text/css,application/zip" hidden>`;
shadow.addEventListener('click',onClick);shadow.addEventListener('input',onInput);shadow.addEventListener('change',onChange);shadow.addEventListener('focusout',()=>{gestureKey=null});document.addEventListener('keydown',e=>{if(opened&&fullscreen&&e.key==='Escape'){e.preventDefault();setFullscreen(false);}});
$('atl-image-input').addEventListener('change',onImage);$('atl-font-input').addEventListener('change',onFont);$('atl-project-input').addEventListener('change',onImport);
document.addEventListener('click',onRealSelectionCapture,true);
$('atl-preview-stickers').addEventListener('pointerdown',onPointerDown);shadow.addEventListener('pointermove',onPointerMove);shadow.addEventListener('pointerup',onPointerUp);
}
// Structural snapshots retain shared immutable base64 strings while making edited fields independent.
function snapshot(value){return {...value,elements:Object.fromEntries(Object.entries(value.elements||{}).map(([k,v])=>[k,{...v}])),patterns:(value.patterns||[]).map(v=>({...v})),stickers:(value.stickers||[]).map(v=>({...v})),fonts:(value.fonts||[]).map(v=>({...v})),favorites:(value.favorites||[]).map(v=>({...v,style:{...v.style}})),regions:{...value.regions},variants:value.variants?.night?{...value.variants,night:{elements:Object.fromEntries(Object.entries(value.variants.night.elements).map(([k,v])=>[k,{...v}])),patterns:value.variants.night.patterns.map(v=>({...v}))}}:{}};}
function push(key=null){if(!project)return;if(key&&gestureKey===key)return;gestureKey=key;undo.push(snapshot(project));if(undo.length>60)undo.shift();redo=[];}
function previewSource(){return previewCandidate||{...project,...edition(),variants:{}};}
function cancelLiveRevision(){clearTimeout(liveRevisionTimer);liveRevisionTimer=null;}
function scheduleLiveRevision(){
 if(!liveDocked||!liveDockOpId)return;
 cancelLiveRevision();
 const opId=liveDockOpId;
 liveRevisionTimer=setTimeout(()=>{
  liveRevisionTimer=null;
  if(!liveDocked||liveDockOpId!==opId)return;
  try{C.updateLivePreview(previewSource(),opId);}
  catch(error){console.error('[Atelier] in-place preview update rejected',opId,error);showRecoveryStatus(error);}
 },110);
}
function changed(){previewCandidate=null;project.updatedAt=Math.max(Date.now(),(project.updatedAt||0)+1);refreshPreview();renderStatus();scheduleDraft();}
function queueDraft(){if(!project)return Promise.resolve();const data=snapshot(project),id=data.id;
 const job=async()=>{if(project?.id!==id)return null;if(draftConflict?.id===id)throw draftConflict.error;
  const last=draftVersions.get(id);if(last!==undefined)data.draftVersion=last;
  try{const saved=await C.saveDraft(data);draftVersions.set(id,saved.draftVersion);if(project?.id===id)project.draftVersion=saved.draftVersion;draftConflict=null;return saved;}
  catch(e){if(e?.code==='E_ATL_DRAFT_CONFLICT')draftConflict={id,error:e};throw e;}};
 saveQueue=saveQueue.catch(()=>{}).then(job);return saveQueue;
}
async function persistBeforeSwitch(){
 clearTimeout(saveTimer);
 try{await queueDraft();return true;}catch(err){
  if(err?.code!=='E_ATL_DRAFT_CONFLICT')throw err;
  // Preserve the user's most recent edits as an independent copy; never write into a stale canonical ID.
  const copy=await C.forkDraft(snapshot(project));
  note('原主题有版本冲突，当前编辑已安全另存为独立草稿：'+copy.name);
  draftVersions.set(copy.id,copy.draftVersion);
  if(project?.id===err.draftId){project=C.normalized(copy);window.sessionStorage.setItem('mima-atl-current',project.id);}
  draftConflict=null;
  return true;
 }
}
async function switchToTheme(next){if(changingProject)return;changingProject=true;try{
 await persistBeforeSwitch();project=C.normalized(next);previewCandidate=null;beforeSnapshot=snapshot(project);compareBefore=false;
 draftConflict=null;draftVersions.set(project.id,project.draftVersion||0);sceneMode='day';
 window.sessionStorage.setItem('mima-atl-current',project.id);undo=[];redo=[];selected=['shell'];changed();render();
 }finally{changingProject=false;}}
async function saveCssToLibrary(source=project,{updateDraft=true}={}){
 const project=source;
 if(typeof window.MimaStandalone?.handle!=='function')throw new Error('正式 CSS 资源库接口未就绪');
 const css=C.exportPresetCss(project);const oldId=project.linkedCssId||'';
 // Ignore volatile save timestamps and linked library id. Identical content always maps
 // to one immutable CSS asset snapshot, making retry after a lost receipt reconcilable.
 const persistent=C.clone(project);delete persistent.updatedAt;delete persistent.draftVersion;delete persistent.linkedCssId;
 if(!globalThis.crypto?.subtle)throw Error('当前上下文不支持安全摘要，CSS 库同步暂不可用；工坊已发布的主题不会回滚。');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(persistent))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const releaseKey='css-release:'+project.id+':'+digest;
 const verifiedCssState=window.MimaStandalone?.getState?.();if(!Array.isArray(verifiedCssState?.cssPresets))throw Error('正式 CSS 列表未经过验证，拒绝在未知归属状态下覆盖或新建');
 const oldResource=verifiedCssState.cssPresets.find(x=>x.id===oldId);
 const existing=verifiedCssState.cssPresets.find(x=>x.atelierReleaseKey===releaseKey);
 const safeOldId=existing?.id||(oldResource?.atelierReleaseKey?oldId:''); // Never overwrite an unrelated old preset.
 if(!(await C.get(releaseKey)))await C._historySave(releaseKey,project); // Do not overwrite an existing immutable asset snapshot on retries.
 if(css.length>200000)throw Error('生成的 CSS 仍过大（'+css.length+' 字符）；原有预设未写入，请检查高级 CSS。');
 const body={name:project.name+' · 工坊导出',css,scope:'app',surface:'global',category:'主题工坊',favorite:false,atelierReleaseKey:releaseKey};
 let result=safeOldId?await window.MimaStandalone.handle('/css-presets/'+encodeURIComponent(safeOldId),'PATCH',body):null;
 // If the linked CSS resource was deleted, make a new record rather than silently claiming update success.
 if(!result?.success&&safeOldId){const missing=/未找到 CSS Preset|not found|不存在/i.test(String(result?.msg||''));if(!missing)throw new Error('原 CSS 资源更新失败，未新建重复记录：'+(result?.msg||result?.code||'未知原因'));}
 if(!result?.success){result=await window.MimaStandalone.handle('/css-presets','POST',body);}
 if(!result?.success||!result.data?.id)throw new Error(result?.msg||result?.code||'CSS 预设提交失败');
 if(updateDraft){project.linkedCssId=result.data.id;await queueDraft();}
 try{await window.MimaTavernBridge?.reload?.();}catch(e){console.warn('[Atelier] CSS library reload deferred',e);}
 return result.data;
}

function scheduleDraft(){clearTimeout(saveTimer);if(draftConflict?.id===project?.id)return;saveTimer=setTimeout(()=>{queueDraft().then(()=>{if(opened)renderStatus('草稿已自动保存')}).catch(e=>{console.error('[Atelier] draft commit failed',e);note('草稿保存失败：'+e.message,true)})},700);}
function setFullscreen(on){fullscreen=!!on;const frame=$('atl-preview-frame');if(!frame)return;frame.classList.toggle('fullscreen',fullscreen);const b=shadow.querySelector('[data-action="expand"]');if(b){b.setAttribute('aria-pressed',String(fullscreen));b.setAttribute('aria-label',fullscreen?'退出全屏预览':'放大预览');b.textContent=fullscreen?'退出全屏':'⛶ 全屏';}if(fullscreen)frame.querySelector('.atl-exit-fullscreen')?.focus({preventScroll:true});}
// Render a bounded, read-only structural snapshot of the ACTUAL mounted app DOM.
// The snapshot is scrubbed before embedding in sandbox.srcdoc; user dialogue,
// attributes containing data, URLs, third-party widgets, and form values never cross.
function structuralMirrorMarkup(){
 const live=document.querySelector('.app-shell');if(!live)return '';
 const permitted=new Set(['DIV','MAIN','HEADER','FOOTER','SECTION','ARTICLE','ASIDE','NAV','SPAN','P','B','I','STRONG','SMALL','LABEL','BUTTON','INPUT','TEXTAREA','DETAILS','SUMMARY','PROGRESS','SYSTEM','UL','LI','H1','H2','H3','FORM']);
 // Only known application selectors survive; arbitrary DOM attributes, CSS
 // classes and IDs may contain user-supplied card/plot text and are not copied.
 const safeClasses=new Set(('app-shell topbar glass-bar top-title-wrap top-title top-character icon-btn ghost-btn primary-btn send-btn nav-label top-avatar context-ribbon chat-box tavern-story-scope message assistant-msg user-msg msg-header msg-content tavern-story-content safe-html-content story-prose story-paragraph library-card composer-shell composer-row toolbar field modal-panel settings-panel settings-content settings-section session-drawer session-list session-item drawer-head drawer-footer scrim hidden panel-card chip-btn session-row selected active form-row').split(' '));
 const safeIds=new Set(('story-chat-box session-drawer session-list top-avatar drawer-scrim').split(' '));
 const safeRoles=new Set(('button navigation main region group status dialog tablist tab option checkbox textbox list listitem').split(' '));
 let nodes=0;
 function build(el,depth=0){
  if(!el||!permitted.has(el.tagName)||depth>15||nodes++>440)return '';
  if(el.closest('#mima-atelier-host,.mima-atl-region-decor,#mima-atelier-decor-root,#mima-atelier-decor-front'))return '';
  // Only style selectors and semantic structure survive; no actual story or personal data.
  const attrs=[];
  const classes=[...el.classList].filter(x=>safeClasses.has(x));
  if(classes.length)attrs.push(` class="${classes.join(' ')}"`);
  if(safeIds.has(el.id))attrs.push(` id="${el.id}"`);
  const role=el.getAttribute('role');if(safeRoles.has(role))attrs.push(` role="${role}"`);
  const type=el.getAttribute('type');if(['text','search','number','button','submit','checkbox','radio','range'].includes(type))attrs.push(` type="${type}"`);
  for(const name of ['aria-expanded','aria-pressed']){const val=el.getAttribute(name);if(val==='true'||val==='false')attrs.push(` ${name}="${val}"`);}
  if(el.hasAttribute('aria-label'))attrs.push(` aria-label="${el.tagName==='BUTTON'?'界面操作':el.tagName==='INPUT'?'输入示例':'界面组件'}"`);
  const safeAttrs=attrs.join('');
  if(el.tagName==='INPUT')return `<input${safeAttrs} placeholder="输入示例" readonly>`;
  if(el.tagName==='TEXTAREA')return `<textarea${safeAttrs} readonly>剧情输入示例</textarea>`;
  const skip=el.id==='story-chat-box'||el.classList.contains('session-list');
  let children=[...el.children];
  if(el.id==='story-chat-box'){
   const messages=children.filter(x=>x.matches?.('article.message,.message'));
   children=messages.slice(-3).concat(children.filter(x=>x.matches?.('.library-card')).slice(0,1));
  }else if(el.classList.contains('session-list'))children=children.slice(0,3);
  else if(children.length>30)children=children.slice(0,15);
  let content=children.map(x=>build(x,depth+1)).join('');
  if(!content){content=el.tagName==='PROGRESS'?'':el.matches?.('.story-paragraph,p')?'这是用于对照排版与玻璃质感的示例剧情。':el.matches?.('summary')?'HTML 状态栏示例':el.matches?.('.msg-header')?'剧情角色':el.matches?.('button')?'按钮示例':'';}
  const tag=el.tagName.toLowerCase();return `<${tag}${safeAttrs}>${content}</${tag}>`;
 }
 const side=document.querySelector('.session-drawer');const modal=document.querySelector('.modal-panel');
 const shell=build(live);return (side?build(side):'')+shell+(modal?build(modal):'');
}
function sandboxDocument(){
 const chosen=previewCandidate||project;
 const source=compareBefore&&beforeSnapshot?beforeSnapshot:previewCandidate?(sceneMode==='night'&&chosen.variants?.night?{...chosen,...chosen.variants.night,variants:{}}:chosen):{...project,...edition(),variants:{}};
 const safeCss=css=>String(css||'').replace(/</g,'\\3c '); // Never let a CSS value close an HTML <style> element.
 const currentTheme=document.documentElement.getAttribute('data-mima-theme');
 const themed=sceneMode==='night'?'midnight':sceneMode==='day'?'':currentTheme;
 const legacyLayers=C.liveLegacyLayers();
 const atlas=safeCss(C.compile(source,'live'));
 const presentation=C.presentationLayers(source,legacyLayers,previewLayer);const plan=presentation.plan;
 const cascade=presentation.layers.map(layer=>`<style data-r19-layer="${layer.id}" media="${esc(layer.media||'all')}">${safeCss(layer.kind==='atelier'?atlas:layer.css)}</style>`).join('');
 const template=`<!doctype html><html ${plan.themeEnabled?'data-mima-atelier-active="1"':''} ${themed?`data-mima-theme="${esc(themed)}"`:''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./style.css"><link rel="stylesheet" href="./theme-skin.css"><link rel="stylesheet" href="./chat-wallpaper.css"><style>html,body{min-height:100%;margin:0}body{overflow:hidden}.app-shell{height:100dvh;min-height:0;max-width:100%}.topbar{min-height:58px}.chat-box{padding:12px;overflow:auto;min-height:0}.message{margin-bottom:14px}.msg-content{padding:14px}.story-prose{line-height:inherit}.settings-section{padding:12px 0}.session-drawer .session-list{min-width:0}.session-list{min-width:0}.modal-panel{max-height:none;margin:8px 10px;padding:12px}.tavern-story-content.safe-html-content details{padding:10px}.composer-shell{margin:0}.composer-row textarea{min-height:46px}.demo-wallpaper{background:repeating-linear-gradient(45deg,#4447 0 4px,#eee5 4px 12px);height:45px;opacity:.55}</style>${cascade}</head><body><aside class="session-drawer"><div class="session-list"><div class="session-item">独立宇宙 · 我的故事</div><div class="session-item">夜间咖啡馆</div><div class="session-item">第三个故事</div></div></aside><div class="app-shell"><header class="topbar glass-bar"><button class="icon-btn">☰</button><div class="top-title-wrap"><b class="top-character">咪嘛馆</b><span class="top-title">角色与剧情</span></div><button class="ghost-btn">功能</button><button class="ghost-btn">设置</button></header><div class="context-ribbon">独立宇宙 · 主题样式镜像</div><main id="story-chat-box" class="chat-box tavern-story-scope"><div class="demo-wallpaper"></div><article class="message assistant-msg"><div class="msg-header">角色 · 长篇剧情</div><div class="msg-content tavern-story-content"><div class="story-prose"><p class="story-paragraph">窗外的光落在书页上，玻璃映出缓慢移动的树影。长篇正文在这里保留独立字体、字距、行高与排版。</p><p class="story-paragraph">第二段剧情用来核对透明磨砂与原生正文是否冲突。</p></div></div></article><article class="message user-msg"><div class="msg-header">你 · 用户消息</div><div class="msg-content tavern-story-content"><p class="story-paragraph">我想看清楚真正的磨砂玻璃。</p></div></article><article class="message assistant-msg"><div class="msg-header">角色 · 带状态栏</div><div class="msg-content tavern-story-content safe-html-content"><details open><summary>Current Status（HTML 状态栏示例）</summary><p>心情：温柔 ／ 时间：22:15</p><progress value="65" max="100"></progress></details><system><b>系统信息</b> · <span>保留内嵌状态栏自己的样式</span></system></div></article><div class="library-card">普通卡片 · 不应改变表单内部排版</div></main><footer class="composer-shell glass-bar"><div class="composer-row"><textarea placeholder="写下你的动作或语言……"></textarea><button class="send-btn">➤</button></div><div class="toolbar"><button class="primary-btn">主要按钮</button><button class="ghost-btn">次要按钮</button></div></footer></div><div class="modal-panel settings-panel"><div class="settings-content"><section class="settings-section"><h3>设置页实际结构</h3><label>接口设置 <input class="field" value="示例内容" readonly></label><p>设置分组不应被当作装饰卡片裁剪。</p></section></div></div></body></html>`;
  const structural=structuralMirrorMarkup();
  if(!structural)return template;
  // Current live DOM geometry must not be overridden by made-up sandbox spacings.
  const unsimulated=template.replace(/<style>html,body\{min-height:100%;margin:0\}[\s\S]*?<\/style>/,
    '<style>html,body{min-height:100%;margin:0}body{overflow:hidden}.app-shell{height:100dvh;min-height:0}</style>');
  return unsimulated.replace(/<body>[\s\S]*<\/body>/,`<body>${structural}</body>`);
}
function refreshSandbox(){if(!opened||previewMode!=='sandbox')return;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{const frame=$('atl-sandbox-preview');if(frame&&opened&&previewMode==='sandbox'){try{frame.srcdoc=sandboxDocument();}catch(e){note('高级 CSS 沙箱预览失败：'+e.message,true)}}},180);}
function setPreviewMode(mode){previewMode=mode;const isolated=mode==='sandbox',frame=$('atl-sandbox-preview');frame.hidden=!isolated;$('atl-preview').hidden=isolated;const button=shadow.querySelector('[data-action="sandbox-preview"]');if(button){button.textContent=isolated?'返回材质草图':'同源级联结构预览';button.setAttribute('aria-pressed',String(isolated));}if(isolated){refreshSandbox();note('结构级联预览使用同一 CSS 优先级；隐去真实剧情及作者私有 HTML/CSS，不能当作像素级上机验收。');}else refreshPreview();}

// Recovery state belongs to Core, not to a second UI boolean.
let liveReturnButton=null,suspendedDraft=false;
const previewState=()=>C.getPreviewState();
const isPreviewPending=()=>!!previewState().opId;
function ensureReturnButton(){
 if(liveReturnButton?.isConnected)return liveReturnButton;
 liveReturnButton=document.createElement('button');liveReturnButton.type='button';
 liveReturnButton.id='mima-atelier-return';
 liveReturnButton.style.cssText='position:fixed;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));z-index:2147483647;padding:10px 14px;border-radius:13px;background:#252630;color:white;border:2px solid white;box-shadow:0 6px 25px #0007;font:600 14px system-ui;';
 liveReturnButton.addEventListener('click',()=>endRealPagePreview().catch(err=>{
  console.error('[Atelier] retry preview recovery failed',err);showRecoveryStatus(err);
 }));
 document.body.appendChild(liveReturnButton);return liveReturnButton;
}
function ensureRecoveryPanel(){
 if(!shadow)return null;let n=$('atl-preview-recovery');if(n)return n;
 n=document.createElement('aside');n.id='atl-preview-recovery';n.hidden=true;
 n.style.cssText='padding:10px;background:#fff0d7;color:#403125;border:2px solid #b67f41;z-index:3;position:relative;font:13px/1.45 system-ui';
 const detail=document.createElement('div');detail.dataset.recoveryDetail='1';n.appendChild(detail);
 const retry=document.createElement('button');retry.type='button';retry.textContent='↻ 重试核对正式主题';
 retry.addEventListener('click',()=>endRealPagePreview().catch(err=>showRecoveryStatus(err)));
 const exit=document.createElement('button');exit.type='button';exit.textContent='只读退出编辑器（保留恢复任务）';
 exit.addEventListener('click',()=>readOnlyExit().catch(err=>note('草稿未保存，退出取消：'+err.message,true)));
 n.append(retry,exit);shadow.querySelector('.atl-app')?.prepend(n);return n;
}
function showRecoveryStatus(err){
 if(!host)return;
 const problem=previewState();
 const n=ensureRecoveryPanel();
 if(n){n.hidden=false;n.querySelector('[data-recovery-detail]').textContent=`${problem.phase} · ${problem.reason||err?.message||'正式主题尚未核验'} · ${problem.opId||'无操作'}`;}
 note('试穿恢复尚未核验。可重试，或只读离开；绝不覆盖用户存档。',true);
}
function syncPreviewControls(){
 // A core-created recovery obligation must remain visible even when the editor
 // was never opened (or opening IndexedDB later becomes unavailable).
 if(!host&&isPreviewPending())start();
 if(!host)return;const state=previewState(),pending=!!state.opId;
 const n=ensureRecoveryPanel();
 if(n){n.hidden=!(pending&&state.phase==='RECOVERY_REQUIRED');if(pending)n.querySelector('[data-recovery-detail]').textContent=`${state.phase} · ${state.reason||'试穿未结束'} · ${state.opId}`;}
 if(pending){ensureReturnButton().textContent=state.phase==='RECOVERY_REQUIRED'?'↻ 重试核对正式主题':'↩ 返回主题工坊（未保存）';
  liveReturnButton.hidden=host.style.display!=='none';}
 else {liveReturnButton?.remove();liveReturnButton=null;}
}
window.addEventListener('mima-atelier-preview-state-change',syncPreviewControls);
const REAL_PICK_PRIORITY=['status','safeHtmlHost','message','button','secondary','field','topbar','composer','panel','shell'];
function onRealSelectionCapture(event){
 if(!liveDocked||!pickingRealArea||!event.target||!host)return;
 if(event.composedPath().includes(host))return; // Never consume editor buttons or recovery.
 const node=event.target.nodeType===1?event.target:event.target.parentElement;
 if(!node)return;
 event.preventDefault();event.stopImmediatePropagation();
 let matched=null;
 for(const key of REAL_PICK_PRIORITY){
  const rule=C.TARGETS[key]?.real;if(!rule)continue;
  try{const candidates=rule.split(',').map(x=>x.trim()).filter(Boolean);
   if(candidates.some(selector=>node.closest(selector))){matched=key;break;}
  }catch(error){console.error('[Atelier] invalid live selector',key,error);}
 }
 if(matched){selected=[matched];tab='design';render();refreshPreview();
  note('已选中真实页面的「'+C.TARGETS[matched].label+'」。更改会临时显示在上方页面，正式发布需点击「保存并应用」。');
 }else note('此位置不属于工坊授权区域；请在样式页选择其他区域。',true);
 setRealPicking(false);
}
function setRealPicking(enabled){
 pickingRealArea=!!enabled&&liveDocked;
 const b=shadow?.querySelector('[data-action="pick-real-area"]');
 if(b){b.setAttribute('aria-pressed',String(pickingRealArea));b.textContent=pickingRealArea?'取消点选':'点选真实区域';}
}
function setLiveDock(enabled){
 liveDocked=!!enabled;
 if(!enabled){setRealPicking(false);cancelLiveRevision();liveDockOpId=null;}
 if(!host)return;
 host.classList.toggle('atl-live-dock',!!enabled);
 if(enabled){
  host.style.cssText='display:block;position:fixed;inset:auto 0 0 0;height:min(48dvh,480px);z-index:2147483000';
 }else{
  host.style.cssText='display:block;position:fixed;inset:0;z-index:2147483000';
 }
}
async function beginDockedLiveEditor(){
 if(isPreviewPending())return showRecoveryStatus();
 try{
  const result=await C.beginLivePreview(previewSource());
  liveDockOpId=result.opId;
  setFullscreen(false);
  setLiveDock(true);syncPreviewControls();
  note('真实页面正使用当前临时草稿；可直接改颜色、磨砂和高级 CSS。退出会核对正式主题，不保存试穿。');
 }catch(err){syncPreviewControls();if(isPreviewPending())showRecoveryStatus(err);throw err;}
}
async function beginRealPagePreview(){
 if(isPreviewPending())return showRecoveryStatus();
 try{await C.beginLivePreview(previewCandidate||{...project,...edition(),variants:{}});}
 catch(err){syncPreviewControls();if(isPreviewPending())showRecoveryStatus(err);throw err;}
 host.style.display='none';syncPreviewControls();
}
async function endRealPagePreview(){
 cancelLiveRevision();
 if(!isPreviewPending()){if(liveDocked)setLiveDock(false);syncPreviewControls();return;}
 try{await C.endLivePreview();}
 catch(err){host.style.display=opened?'block':'none';syncPreviewControls();showRecoveryStatus(err);throw err;}
 if(liveDocked)setLiveDock(false);
 host.style.display=opened?'block':'none';syncPreviewControls();
 if(opened)refreshPreview();
 note('已核对最新正式主题并返回；试穿没有提交。');
}
async function readOnlyExit(){
 // Explicitly retain Core recovery debt; closing the editor is not settlement.
 clearTimeout(saveTimer);suspendedDraft=true;setFullscreen(false);setLiveDock(false);
 // Read-only exit never depends on a broken IndexedDB write. The working draft
 // remains in this tab's memory, not a fabricated durable save.
 host.style.display='none';opened=false;C.releaseAssets('preview');
 document.documentElement.classList.remove('mima-atl-editing');
 syncPreviewControls();
}
function renderStatus(message){
 $('atl-project-name').textContent=project?.name||'未命名主题';
 $('atl-selected-label').textContent=selected.map(x=>C.TARGETS[x]?.label||x).join('、');
 const warnings=$('atl-effect-warnings');
 if(warnings&&project){const all=C.appearanceWarnings({...project,...edition(),variants:{}});
  warnings.hidden=!all.length;warnings.replaceChildren(...all.map(msg=>{const p=document.createElement('p');p.textContent=msg;return p;}));}
 if(message)note(message);
}
async function open(){if(opened)return;if(openingPromise)return openingPromise;openingPromise=(async()=>{start();await C.ready;await saveQueue;const active=C.getActive();activeVersion=active.version;
 if(suspendedDraft&&project){host.style.display='block';opened=true;suspendedDraft=false;
 document.documentElement.classList.add('mima-atl-editing');setFullscreen(false);render();refreshPreview();syncPreviewControls();
 note('已恢复本页保留的未保存草稿。存储故障期间不要刷新页面；可重试核对正式主题。',true);return;}
 const draftId=window.sessionStorage.getItem('mima-atl-current'),recent=await C.get('lastEdited');let loaded=draftId?await C.get('project:'+draftId):null;
 if(!loaded&&recent?.id)loaded=await C.get('project:'+recent.id);
 if(!loaded&&active.id)loaded=await C.get('project:'+active.id);
 project=loaded?C.normalized(loaded):C.baseTheme();previewCandidate=null;beforeSnapshot=snapshot(project);compareBefore=false;draftVersions.set(project.id,project.draftVersion||0);
 window.sessionStorage.setItem('mima-atl-current',project.id);host.style.display='block';opened=true;syncPreviewControls();
 document.documentElement.classList.add('mima-atl-editing');setFullscreen(false);render();refreshPreview();renderStatus();
 if(!loaded){await queueDraft();renderStatus('已创建并保存首份草稿');}
})();try{return await openingPromise;}finally{openingPromise=null;}
}

async function close(){if(!host)return;if(isPreviewPending())await endRealPagePreview();if(liveDocked)setLiveDock(false);clearTimeout(saveTimer);await persistBeforeSwitch();setFullscreen(false);clearTimeout(previewTimer);host.style.display='none';opened=false;C.releaseAssets('preview');document.documentElement.classList.remove('mima-atl-editing');}
function render(){if(!opened)return;syncPreviewControls();document.querySelector('html');for(const b of shadow.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===tab);const area=$('atl-editor-content');if(tab==='design')area.innerHTML=renderDesign();else if(tab==='templates'){area.innerHTML=renderTemplates();renderCatalogResults();}else if(tab==='patterns')area.innerHTML=renderPatterns();else if(tab==='stickers')area.innerHTML=renderStickers();else if(tab==='project')area.innerHTML=renderProject();renderStatus();if(tab==='project')showProjects();}
function targetChecks(){return `<div class="atl-picker" role="group" aria-label="选择需要编辑的界面区域">${Object.entries(C.TARGETS).map(([id,t])=>`<label><input type="checkbox" data-target="${id}" ${selected.includes(id)?'checked':''}><span>${esc(t.label)}</span></label>`).join('')}</div><p class="atl-hint">可多选。选「整体背景」时模糊是背景图片的模糊（需有图）；其他面板则是表面磨砂。修改保存于草稿，须试穿后正式应用。</p>${selected.some(k=>(k==='status'||k==='safeHtmlHost')&&!project.regions[k])?'<p class="atl-protected">当前所选的角色 HTML 区域受保护，所以这里的修改不会覆盖角色自己的设计。<button type="button" data-action="authorize-selected">授权工坊接管选中的 HTML 区域</button></p>':''}`}
function fieldControl([k,name,type,a,b,step]){const vals=selected.map(x=>edition().elements[x]?.[k]);const equal=vals.every(v=>v===vals[0]);let value=equal?vals[0]:edition().elements[selected[0]][k],sub=equal?'':`<span class="atl-mixed">不同值</span>`;
 if(k==='blur')name=selected.length===1&&selected[0]==='shell'?'页面背景图片模糊（需先导图）':selected.includes('shell')?'不同区域的背景图模糊 / 表面磨砂':'面板表面磨砂（透过背景看纹理）';
 const inactive=selected.length===1&&!edition().elements[selected[0]]?.image&&['imageOpacity','imagePosX','imagePosY','maskColor','maskOpacity'].includes(k)||k==='blur'&&selected.length===1&&selected[0]==='shell'&&!edition().elements.shell.image;
 if(inactive)sub+='<span class="atl-mixed"> · 请先导入背景图</span>';
 if(type==='select')return `<label class="atl-field"><span>${name}${sub}</span><select data-prop="${k}">${a.map(x=>`<option value="${x}" ${value===x?'selected':''}>${esc(LABELS[x]||x)}</option>`).join('')}</select></label>`;
 if(type==='color')return `<label class="atl-field"><span>${name}${sub}</span><div class="atl-color"><input type="color" data-prop="${k}" value="${C.hex(value)}" ${inactive?'disabled':''}><input type="text" data-color-text="${k}" maxlength="7" value="${C.hex(value)}" ${inactive?'disabled':''} aria-label="${name} HEX"></div></label>`;
 return `<label class="atl-field"><span>${name}${sub}</span><div class="atl-slider"><input type="range" min="${a}" max="${b}" step="${step}" data-prop="${k}" value="${value}" ${inactive?'disabled':''}><input type="number" min="${a}" max="${b}" step="${step}" data-number="${k}" value="${value}" ${inactive?'disabled':''}></div></label>`;}
function edition(){return sceneMode==='night'&&project.variants?.night?project.variants.night:project;}
function renderDesign(){return `<div class="atl-section"><h2>场景变体</h2><select id="atl-scene-mode"><option value="day" ${sceneMode==='day'?'selected':''}>日间 / 基础主题</option><option value="night" ${sceneMode==='night'?'selected':''}>夜间主题（随系统深色偏好启用）</option></select><p class="atl-hint">夜间变体首次打开时复制当前材质，之后单独编辑并自动随系统切换。贴纸继续共享。</p></div><div class="atl-section"><h2>真实界面布局</h2><label class="atl-field"><span>区域排版方式</span><select id="atl-layout"><option value="story" ${project.layoutRecipe==='story'?'selected':''}>原始小说正文（默认）</option>${['role-bubble','soft-dock','editorial','photo-journal'].map(x=>`<option value="${x}" ${project.layoutRecipe===x?'selected':''}>${{ 'role-bubble':'韩系左右气泡','soft-dock':'悬浮玻璃气泡','editorial':'编辑杂志列表','photo-journal':'摄影日记浮层'}[x]}</option>`).join('')}${(window.MimaAtelierCatalog?.layout||[]).filter(x=>window.MimaAtelierAtlas?.hasLayout(x.id)).map(x=>`<option value="${x.id}" ${project.layoutRecipe===x.id?'selected':''}>会话列表：${esc(x.name)}</option>`).join('')}</select></label><p class="atl-hint">布局只适配当前确有语义的消息 / 会话列表；不会生成虚假的通讯录、任务或图片内容。</p></div><div class="atl-section atl-getting-started"><h2>编辑当前主题 · 三步即可</h2><p>① 选择下方区域（默认「整体背景」）　② 调颜色、透明度、磨砂与纹样　③ 点上方「真实页面边看边调」，满意后「保存并应用」</p><p>颜色只会修改所选区域；结构预览是估计，角色自绘 HTML 默认受保护。</p><button type="button" data-action="live-preview">↗ 在当前剧情试穿（不保存）</button></div><div class="atl-section"><h2>选中区域</h2>${targetChecks()}${selected.includes('message')?'<p class="atl-hint">普通剧情颜色和正文字体分别在「主题工程」中授权；选中区域仅编辑材质，不会暗中更改正文排版。</p>':''}<div class="atl-actions"><button data-action="copy-style">复制第一个样式</button><button data-action="paste-style">粘贴样式到选中区域</button><button data-action="favorite-save">收藏为材质</button></div><div class="atl-actions">${(project.favorites||[]).map(x=>`<button data-favorite="${esc(x.id)}">♡ ${esc(x.name)}</button>`).join('')}</div></div>${Object.entries(FIELD_GROUPS).map(([name,items])=>`<details class="atl-section" open><summary>${name}</summary><div class="atl-fields">${items.map(fieldControl).join('')}</div></details>`).join('')}<div class="atl-section"><h2>字体库与独立排版</h2><label class="atl-field"><span>选中区域字体</span><select data-prop="fontFamily"><option value="inherit">保留咪嘛馆原始字体</option><option value="system-ui">系统 UI 字体</option><option value="serif">衬线字体</option><option value="monospace">等宽字体</option>${(project.fonts||[]).map(f=>`<option value="${f.family}" ${edition().elements[selected[0]].fontFamily===f.family?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label><button data-action="import-font">＋ 导入字体（TTF/OTF/WOFF）</button><p class="atl-hint">字体留在原工程中；运行时和普通预设通过临时 Blob URL 使用，精简 CSS 不重复写入字体。ZIP 可携带完整素材。</p></div><div class="atl-section"><h2>选中区域背景素材</h2><button data-action="background-image">导入背景图</button><button data-action="clear-background">移除背景图</button><p class="atl-hint">素材仍安全保存在工程数据中，运行时用 Blob URL 引用；普通 CSS 不重复携带 base64，完整 ZIP 会携带图片。</p></div>`;}
function renderTemplates(){return `<section class="atl-section"><h2>万象风格库 · 148 + 韩系 5 套</h2><p class="atl-hint">StyleKit 130 视觉适配、18 布局目录，另有主人收藏的 5 个韩系家族。预览不修改草稿；点「创建」会先安全保存旧草稿。颜色、花纹、玻璃、圆角均可继续编辑。StyleKit 部分模板为咪嘛馆本地风格适配，并非官方像素级复刻。</p><div class="atl-catalog-toolbar"><input id="atl-catalog-search" type="search" placeholder="搜索韩系、哥特、玻璃、像素..." value="${esc(catalogSearch)}" autocomplete="off"><select id="atl-catalog-kind"><option value="all" ${catalogKind==='all'?'selected':''}>所有风格（153）</option><option value="inspo" ${catalogKind==='inspo'?'selected':''}>主人收藏（5）</option><option value="visual" ${catalogKind==='visual'?'selected':''}>StyleKit 视觉（130）</option><option value="layout" ${catalogKind==='layout'?'selected':''}>StyleKit 布局（18）</option></select></div><div id="atl-catalog-preview-label" class="atl-catalog-preview-label" ${previewCandidate?'':'hidden'}>正在试穿，不会修改草稿。 <button data-action="cancel-catalog-preview" type="button">退出试穿</button></div><div id="atl-catalog-results"></div></section><section class="atl-section"><h2>原装 24 套完整模板（全部保留）</h2><p class="atl-hint">原来的创建、素材与混搭能力都没有改动。</p><div class="atl-template-grid">${C.STYLES.map(([id,name,kind,bg,accent])=>`<button data-template="${id}" class="atl-template" title="${esc(kind)}"><span class="atl-template-art" style="--template-bg:${bg};--template-accent:${accent};"><i></i><em></em></span><b>${esc(name)}</b><small>${esc(kind)}</small></button>`).join('')}</div></section><section class="atl-section"><h2>原装模板混搭器</h2><p class="atl-hint">只从指定旧模板提取选中区域的材质；不会覆盖其他区域。</p><select id="atl-mix-template">${C.STYLES.map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join('')}</select><button data-action="mix-template">把原装材质混入选中区域</button></section>`;}
function renderCatalogResults(){const el=$('atl-catalog-results'),cat=window.MimaAtelierCatalog,atlas=window.MimaAtelierAtlas;if(!el||!cat||!atlas){if(el)el.textContent='风格库未能安全初始化。';return;}
 const q=catalogSearch.trim().toLocaleLowerCase();const entries=cat.items.filter(x=>(catalogKind==='all'||x.type===catalogKind)&&(!q||(x.name+' '+x.id).toLocaleLowerCase().includes(q)));
 const pages=Math.max(1,Math.ceil(entries.length/14));catalogPage=C.clamp(catalogPage,0,pages-1);const items=entries.slice(catalogPage*14,catalogPage*14+14);
 el.innerHTML=`<p class="atl-hint">共 ${entries.length} 套 · 第 ${catalogPage+1}/${pages} 页。<b>已适配</b>为本地可编辑视觉配方；未提供的官方原色不会伪称核验。</p><div class="atl-catalog-grid">${items.map(item=>{const pal=atlas.getPalette(item),layout=item.type==='layout',supported=!layout||atlas.hasLayout(item.id);return `<div class="atl-catalog-card"><div class="atl-catalog-art" style="--atlas-bg:${pal[1]};--atlas-ink:${pal[0]};--atlas-accent:${pal[2]}"><div class="atl-catalog-art-top"><i></i><b>✦</b><i></i></div><div class="atl-catalog-art-dialog"><span></span><span></span></div><div class="atl-catalog-art-dock"><i></i><i></i><i></i></div></div><b>${esc(item.name)}</b><small>${item.type==='inspo'?'韩系收藏 · 完整家族':layout?'布局 · 会话列表':item.paletteVerified?'StyleKit · 原色已核验':'StyleKit · 适配配色'}${!supported?' · 当前未适配':''}</small><div class="atl-catalog-actions">${supported?`<button data-catalog-try="${item.id}">试穿</button><button data-catalog-create="${item.id}">${layout?'选用布局':'创建主题'}</button>`:`<span class="atl-hint">现有 DOM 不支持直接套用</span>`}${!layout?`<button data-catalog-borrow="${item.id}">借用选中区域</button>`:''}</div></div>`}).join('')}</div><div class="atl-catalog-pages"><button data-action="catalog-prev" ${catalogPage===0?'disabled':''}>上一页</button><span>${catalogPage+1} / ${pages}</span><button data-action="catalog-next" ${catalogPage>=pages-1?'disabled':''}>下一页</button></div>`;
}
function renderPatterns(){const arr=edition().patterns;const chosen=arr.find(x=>x.id===patternId)||arr[arr.length-1];if(chosen)patternId=chosen.id;return `<section class="atl-section"><h2>程序化纹样（无需图片）</h2><div class="atl-actions"><select id="atl-new-pattern-type">${C.PATTERNS.filter(x=>x!=='none').map(x=>`<option value="${x}">${PATTERN_LABELS[x]}</option>`).join('')}</select><button data-action="add-pattern" class="atl-primary">＋ 添加纹样</button></div><div class="atl-layer-list">${arr.map(x=>`<button data-pattern-select="${x.id}" class="atl-layer ${x.id===patternId?'selected':''}"><span>▦ ${PATTERN_LABELS[x.type]||x.type}</span><small>${C.TARGETS[x.target]?.label||x.target}</small></button>`).join('')}</div></section>${chosen?`<section class="atl-section"><h2>纹样参数</h2><label class="atl-field"><span>应用区域</span><select data-pattern-key="target">${Object.entries(C.TARGETS).map(([x,t])=>`<option value="${x}" ${chosen.target===x?'selected':''}>${t.label}</option>`).join('')}</select></label><label class="atl-field"><span>图案颜色</span><div class="atl-color"><input data-pattern-key="color" type="color" value="${chosen.color}"></div></label>${[['size','间距 / 比例',5,160,1],['weight','线宽 / 点大小',.5,25,.5],['opacity','透明度',0,100,1],['angle','角度',0,360,1],['offsetX','水平偏移 px',-500,500,1],['offsetY','垂直偏移 px',-500,500,1]].map(([k,l,a,b,step])=>`<label class="atl-field"><span>${l}</span><div class="atl-slider"><input data-pattern-key="${k}" type="range" min="${a}" max="${b}" step="${step}" value="${chosen[k]}"><input data-pattern-number="${k}" type="number" min="${a}" max="${b}" step="${step}" value="${chosen[k]}"></div></label>`).join('')}<label class="atl-check"><input type="checkbox" data-pattern-key="enabled" ${chosen.enabled?'checked':''}> 显示纹样</label><button data-action="duplicate-pattern">复制纹样</button><button data-action="pattern-up">上移一层</button><button data-action="pattern-down">下移一层</button><button data-action="delete-pattern">删除纹样</button></section>`:''}`;}
function stickerMessageOptions(chosen){
 const messages=[...document.querySelectorAll('#story-chat-box article.message[data-msg-id]')].filter(x=>x.dataset.msgId);
 const ids=[...new Set(messages.map(x=>x.dataset.msgId))];
 if(chosen?.targetMessageId&&!ids.includes(chosen.targetMessageId))ids.unshift(chosen.targetMessageId);
 return `<label class="atl-field"><span>指定剧情消息</span><select data-sticker-key="targetMessageId"><option value="">旧版：首条消息</option>${ids.map(id=>`<option value="${esc(id)}" ${chosen?.targetMessageId===id?'selected':''}>${esc(id)}</option>`).join('')}</select></label><p class="atl-hint">按消息 ID 绑定；消息不存在时隐藏贴纸，不会误贴到其他剧情。</p>`;
}
function renderStickers(){const chosen=project.stickers.find(x=>x.id===stickerId)||project.stickers.at(-1);if(chosen)stickerId=chosen.id;return `<section class="atl-section"><h2>自由贴图图层</h2><div class="atl-actions"><button class="atl-primary" data-action="add-sticker">＋ 导入透明贴纸</button><button data-action="pick-palette">从贴图提取颜色</button></div><p class="atl-hint">在预览中拖动贴纸；位置按锚点区域的百分比保存，缩放和旋转可精调。装饰默认不阻挡点击。</p><div class="atl-layer-list">${project.stickers.map((s,i)=>`<button data-sticker-select="${s.id}" class="atl-layer ${s.id===stickerId?'selected':''}"><span>${s.hidden?'◌':'🖼'} ${esc(s.name||`贴纸 ${i+1}`)}</span><small>${C.TARGETS[s.anchor]?.label||s.anchor}</small></button>`).join('')}</div></section>${chosen?`<section class="atl-section"><h2>${esc(chosen.name)}</h2><div class="atl-sticker-head"><img src="${chosen.src}" alt="已导入的贴纸"></div><label class="atl-field"><span>图层位置</span><select data-sticker-key="plane"><option value="behind" ${chosen.plane==='behind'?'selected':''}>背景装饰（位于正文下方）</option><option value="front" ${chosen.plane==='front'?'selected':''}>前景贴纸（限制在锚点区域）</option></select></label><label class="atl-field"><span>固定锚点</span><select data-sticker-key="anchor">${Object.entries(C.TARGETS).map(([id,t])=>`<option value="${id}" ${chosen.anchor===id?'selected':''}>${t.label}</option>`).join('')}</select></label>${['message','status'].includes(chosen.anchor)?stickerMessageOptions(chosen):''}${[['x','水平位置 %',-150,250,1],['y','垂直位置 %',-150,250,1],['width','相对锚点宽度 %',4,200,1],['rotate','旋转角度',-360,360,1],['opacity','透明度 %',0,100,1]].map(([k,n,a,b,step])=>`<label class="atl-field"><span>${n}</span><div class="atl-slider"><input data-sticker-key="${k}" type="range" min="${a}" max="${b}" step="${step}" value="${chosen[k]}"><input data-sticker-number="${k}" type="number" min="${a}" max="${b}" step="${step}" value="${chosen[k]}"></div></label>`).join('')}<label class="atl-check"><input type="checkbox" data-sticker-key="hidden" ${chosen.hidden?'checked':''}> 隐藏该贴纸</label><button data-action="duplicate-sticker">复制图层</button><button data-action="layer-up">上移一层</button><button data-action="layer-down">下移一层</button><button data-action="delete-sticker">删除图层</button></section>`:''}`;}
function renderProject(){return `<section class="atl-section"><h2>主题工程</h2><p class="atl-hint">新版本：按区域授权工坊接管，普通全局 CSS 和原有素材不删除。工坊单独模式仅临时隐藏旧 CSS 的视觉效果，原挂载 ID、配置与数据都不修改；停用工坊会立即恢复。混搭仍受选择器优先级和 !important 影响。</p><label class="atl-field"><span>主题叠加优先级</span><select id="atl-css-priority"><option value="atelier-only" ${project.cssPriority==='atelier-only'?'selected':''}>只用工坊（暂时隐藏旧 CSS，停用自动恢复，推荐）</option><option value="legacy-only" ${project.cssPriority==='legacy-only'?'selected':''}>只用普通 CSS（保留工坊工程）</option><option value="mix-legacy" ${project.cssPriority==='mix-legacy'?'selected':''}>混搭：普通 CSS 后加载</option><option value="mix-atelier" ${project.cssPriority==='mix-atelier'?'selected':''}>混搭：工坊后加载</option></select></label><label class="atl-field"><span>夜间变体</span><select id="atl-night-mode"><option value="app" ${project.nightMode==='app'?'selected':''}>跟随咪嘛馆深色主题</option><option value="system" ${project.nightMode==='system'?'selected':''}>跟随系统</option><option value="light" ${project.nightMode==='light'?'selected':''}>固定日间配色</option><option value="dark" ${project.nightMode==='dark'?'selected':''}>固定夜间配色</option></select></label><div class="atl-region-grid" role="group" aria-label="工坊授权区域">${Object.entries(C.TARGETS).map(([key,meta])=>`<label class="atl-check"><input type="checkbox" data-region="${key}" ${project.regions?.[key]!==false?'checked':''}>${esc(meta.label)}</label>`).join('')}</div><label class="atl-check"><input type="checkbox" id="atl-prose-ink" ${project.textPolicy?.storyProse?.inkMode==='explicit'?'checked':''}>使用工坊颜色覆盖普通剧情正文（不影响字号/字体）</label><label class="atl-check"><input type="checkbox" id="atl-prose-typography" ${project.textPolicy?.storyProse?.typographyMode==='explicit'?'checked':''}>使用工坊字号与字体覆盖普通剧情正文</label><label class="atl-check"><input type="checkbox" id="atl-status-ink" ${project.textPolicy?.statusHtml?.inkMode==='explicit'?'checked':''}>明确接管 HTML 状态栏文字颜色（默认不接管状态栏）</label><p class="atl-hint">角色卡 HTML 状态栏默认不接管。取消某区域只停用该区域工坊 CSS，不删除编辑数据。若高级 CSS 另写全局选择器，该设置无法自动隔离它。</p></section><section class="atl-section"><h2>主题名称与保存</h2><label class="atl-field"><span>主题名称</span><input data-name type="text" maxlength="80" value="${esc(project.name)}"></label><div class="atl-actions"><button data-action="save-draft">保存草稿</button><button class="atl-primary" data-action="saveapply">保存并应用</button><button data-action="unapply">停用工坊主题</button></div><p class="atl-hint">保存草稿不改变正在使用的 CSS。正式应用是独立挂载，不覆盖默认主题和旧 CSS。出现遮挡时可在网址添加 ?noCss=1 紧急进入。</p></section><section class="atl-section"><h2>导入与导出</h2><div class="atl-actions"><button data-action="export-css">导出 .css</button><button data-action="retry-css-sync" type="button">↻ 只重试正式主题的 CSS 库同步</button><button data-action="save-css-library">保存到正式 CSS 预设库</button><button data-action="export-zip">导出完整 .zip</button><button data-action="export-json">工程 .json</button><button data-action="import">导入工程 / CSS</button></div><p class="atl-hint">普通 .css 默认轻量导出，不嵌入图片/字体；在咪嘛馆正式 CSS 库中会关联独立资源快照，仍能使用完整素材。跨网站完整迁移请选 ZIP（附带图片/字体）；高级 CSS 仍原样保留。</p></section><section class="atl-section"><h2>高级 CSS（原样保留）</h2><p class="atl-hint">这是不受可视化编辑器解析的高级覆盖层。只输入可信 CSS，避免隐藏按钮或影响故事操作。</p><textarea data-extra-css spellcheck="false" rows="7" placeholder="/* 手写扩展 CSS */">${esc(project.extraCss)}</textarea></section><section class="atl-section"><h2>主题体检 / 历史</h2><div class="atl-actions"><button data-action="inspect">检查冲突和素材</button><button data-action="export-diagnostics">导出脱敏外观诊断</button><button data-action="snapshot">保存历史快照</button><button data-action="restore-history">恢复最近快照</button></div><pre id="atl-inspection"></pre></section><section class="atl-section"><h2>我的主题版本</h2><p class="atl-hint">手动保存的版本和自动防丢草稿独立陈列。打开任何版本不会要求覆盖其他主题；冲突草稿会自动另存副本。</p><div id="atl-saved-projects">正在读取……</div><button data-action="new-project">新建主题</button></section>`;}
// One anchor resolver for paint, drag and future preview controls; never
// silently reposition a bound sticker onto a different message.
function previewStickerAnchor(sticker,prev){
 if(sticker.targetMessageId&&['message','status'].includes(sticker.anchor)){
  const msg=[...prev.querySelectorAll('[data-atl-preview-message-id]')].find(el=>el.dataset.atlPreviewMessageId===sticker.targetMessageId);
  return sticker.anchor==='status'?msg?.querySelector('.atl-demo-status')||null:msg||null;
 }
 return sticker.anchor==='shell'?prev.querySelector('.atl-scene'):prev.querySelector(C.TARGETS[sticker.anchor].preview.split(',')[0]);
}
function refreshPreview(){if(!project||!opened)return;try{if(!previewStyle){previewStyle=document.createElement('style');previewStyle.id='atl-live-style';shadow.appendChild(previewStyle);}const chosen=previewCandidate||project;const paint=compareBefore&&beforeSnapshot?beforeSnapshot:previewCandidate?(sceneMode==='night'&&chosen.variants?.night?{...chosen,...chosen.variants.night,variants:{}}:chosen):{...project,...edition(),variants:{}};previewStyle.textContent=C.previewCss(paint);refreshSandbox();const prev=$('atl-preview');prev.querySelectorAll('[data-atl-area]').forEach(x=>x.removeAttribute('data-atl-area'));for(const [k,t] of Object.entries(C.TARGETS)){for(const el of prev.querySelectorAll(t.preview)){el.dataset.atlArea=k;el.classList.toggle('atl-selected',selected.includes(k));}}
 const previewStickers=(compareBefore&&beforeSnapshot?beforeSnapshot:project).stickers.filter(s=>!s.hidden);
 const chat=prev.querySelector('.atl-demo-chat');let messageHost=chat.querySelector('[data-atl-message-samples]');
 const targetedIds=new Set(previewStickers.filter(s=>s.targetMessageId&&['message','status'].includes(s.anchor)).map(s=>s.targetMessageId));
 if(targetedIds.size){
  if(!messageHost){messageHost=document.createElement('div');messageHost.dataset.atlMessageSamples='1';messageHost.style.display='contents';chat.insertBefore(messageHost,chat.firstChild);}
  const liveMessages=[...document.querySelectorAll('#story-chat-box article.message[data-msg-id]')].filter(el=>el.dataset.msgId);
  const sampled=liveMessages.filter((el,i)=>targetedIds.has(el.dataset.msgId)||i>=liveMessages.length-2);
  messageHost.replaceChildren();
  for(const [i,real] of sampled.entries()){
    const demo=document.createElement('div');demo.className='atl-demo-message'+(real.classList.contains('user-msg')?' atl-demo-user':'');
    demo.dataset.atlPreviewMessageId=real.dataset.msgId;
    const name=document.createElement('strong');name.textContent='示例消息 '+(i+1);
    const prose=document.createElement('p');prose.textContent='脱敏剧情样例，用于核对消息位置和贴纸锚点。';
    const status=document.createElement('div');status.className='atl-demo-status';status.textContent='状态栏示例';
    demo.append(name,prose,status);messageHost.appendChild(demo);
  }
  prev.querySelectorAll('.atl-demo-message:not([data-atl-preview-message-id])').forEach(el=>el.hidden=true);
 }else{
  messageHost?.remove();prev.querySelectorAll('.atl-demo-message:not([data-atl-preview-message-id])').forEach(el=>el.hidden=false);
 }
 const layer=$('atl-preview-stickers');layer.innerHTML='';previewStickers.forEach(s=>{
  const targeted=!!(s.targetMessageId&&['message','status'].includes(s.anchor));
  const area=previewStickerAnchor(s,prev);if(!area)return;
  const box=area.getBoundingClientRect(),parent=prev.querySelector('.atl-scene').getBoundingClientRect();
  const region=document.createElement('div');region.dataset.atlPreviewHost=s.anchor;if(targeted)region.dataset.atlPreviewMessageId=s.targetMessageId;
  region.style.cssText=`position:absolute;left:${box.left-parent.left}px;top:${box.top-parent.top}px;width:${box.width}px;height:${box.height}px;overflow:${s.plane==='front'&&s.anchor!=='shell'?'hidden':'visible'};z-index:${s.plane==='front'?15:4};pointer-events:none;`;
  const el=document.createElement('img');el.src=s.src;el.alt=s.name;el.dataset.stickerDrag=s.id;el.draggable=false;
  el.style.cssText=`position:absolute;left:${box.width*s.x/100}px;top:${box.height*s.y/100}px;width:${box.width*s.width/100}px;transform:translate(-50%,-50%) rotate(${s.rotate}deg);opacity:${s.opacity/100};pointer-events:auto;touch-action:none;cursor:grab;`;
  region.appendChild(el);layer.appendChild(region);
 });
 scheduleLiveRevision();}catch(e){note('实时预览编译失败：'+e.message,true);console.error('[Theme Atelier] preview',e)}}
function changeProp(key,val){if(!selected.length)return;const schema=Object.values(FIELD_GROUPS).flat().find(x=>x[0]===key);if(!schema&&key!=='fontFamily')return;if(selected.every(id=>String(edition().elements[id][key])===String(val)))return;push('element:'+sceneMode+':'+selected.join(',')+':'+key);if(schema?.[2]==='range')val=C.clamp(val,schema[3],schema[4]);if(schema?.[2]==='color')val=C.hex(val);if(key==='ink'&&selected.includes('message')){project.textPolicy=C.normalizeTextPolicy(project.textPolicy,project.proseTypography);project.textPolicy.storyProse.inkMode='explicit';}for(const id of selected){const e=edition().elements[id];const from=e.material;e[key]=val;if(key==='material'&&['glass','aqua'].includes(val)&&!['glass','aqua'].includes(from)&&e.blur===0){e.blur=val==='glass'?16:12;e.alpha=Math.min(e.alpha,72);}}changed();}
function currentPattern(){return edition().patterns.find(x=>x.id===patternId)}function currentSticker(){return project.stickers.find(x=>x.id===stickerId)}
function onInput(e){const t=e.target;if(t.id==='atl-catalog-search'){catalogSearch=t.value;catalogPage=0;renderCatalogResults();return;}if(t.dataset.prop){changeProp(t.dataset.prop,t.value);if(t.dataset.prop==='material'){render();return;}const pair=shadow.querySelector(`[data-number="${t.dataset.prop}"]`);if(pair)pair.value=t.value;const pair2=shadow.querySelector(`[data-color-text="${t.dataset.prop}"]`);if(pair2)pair2.value=t.value;return;}
 if(t.dataset.prop==='fontFamily'){changeProp('fontFamily',t.value);return;}
 if(t.dataset.colorText){if(/^#[a-fA-F0-9]{6}$/.test(t.value))changeProp(t.dataset.colorText,t.value);return;}
 if(t.dataset.number){changeProp(t.dataset.number,t.value);const pair=shadow.querySelector(`[data-prop="${t.dataset.number}"]`);if(pair)pair.value=t.value;return;}
 if(t.dataset.patternKey||t.dataset.patternNumber){const k=t.dataset.patternKey||t.dataset.patternNumber,p=currentPattern();if(!p)return;if(String(p[k])===String(k==='enabled'?t.checked:k==='target'?t.value:k==='color'?C.hex(t.value):+t.value))return;push('pattern:'+p.id+':'+k);p[k]=k==='enabled'?t.checked:k==='target'?t.value:k==='color'?C.hex(t.value):+t.value;changed();const p2=shadow.querySelector(`[data-pattern-${t.dataset.patternNumber?'key':'number'}="${k}"]`);if(p2&&k!=='target'&&k!=='color')p2.value=p[k];return;}
 if(t.dataset.stickerKey||t.dataset.stickerNumber){const k=t.dataset.stickerKey||t.dataset.stickerNumber,s=currentSticker();if(!s)return;if(String(s[k])===String(k==='hidden'?t.checked:k==='anchor'||k==='plane'||k==='targetMessageId'?t.value:+t.value))return;push('sticker:'+s.id+':'+k);s[k]=k==='hidden'?t.checked:k==='anchor'||k==='plane'||k==='targetMessageId'?t.value:+t.value;changed();const p2=shadow.querySelector(`[data-sticker-${t.dataset.stickerNumber?'key':'number'}="${k}"]`);if(p2&&k!=='anchor'&&k!=='plane'&&k!=='hidden')p2.value=s[k];return;}
 if(t.hasAttribute('data-name')){if(project.name!==t.value.slice(0,80)){push('project-name');project.name=t.value.slice(0,80);changed();}return;}
 if(t.hasAttribute('data-extra-css')){if(project.extraCss!==t.value){push('extra-css');project.extraCss=t.value;changed();}return;}}
function onChange(e){const t=e.target;gestureKey=null;if(t.id==='atl-css-priority'||t.id==='atl-night-mode'){push();project[t.id==='atl-css-priority'?'cssPriority':'nightMode']=t.value;changed();render();if(t.id==='atl-css-priority')setPreviewMode('sandbox');return;}if(['atl-prose-typography','atl-prose-ink','atl-status-ink'].includes(t.id)){push();project.textPolicy=C.normalizeTextPolicy(project.textPolicy,project.proseTypography);const entry=t.id==='atl-status-ink'?project.textPolicy.statusHtml:t.id==='atl-prose-ink'?project.textPolicy.storyProse:project.textPolicy.storyProse;entry[t.id==='atl-prose-typography'?'typographyMode':'inkMode']=t.checked?'explicit':'inherit';if(t.id==='atl-prose-typography')project.proseTypography=t.checked;changed();render();return;}if(t.dataset.region){push();project.regions[t.dataset.region]=t.checked;changed();render();return;}if(t.id==='atl-catalog-kind'){catalogKind=t.value;catalogPage=0;renderCatalogResults();return;}if(t.id==='atl-layout'){if(project.layoutRecipe===t.value)return;push();project.layoutRecipe=t.value;changed();render();return;}if(t.id==='atl-preview-layer'){previewLayer=t.value;setPreviewMode('sandbox');return;}if(t.id==='atl-device'){previewDevice=t.value;$('atl-preview-frame').dataset.device=previewDevice;return;}if(t.dataset.prop==='fontFamily'){changeProp('fontFamily',t.value);return;}if(t.id==='atl-scene-mode'){if(t.value==='night'&&!project.variants.night){push();project.variants.night={elements:cl(project.elements),patterns:cl(project.patterns)};}sceneMode=t.value;render();refreshPreview();scheduleDraft();return;}if(t.dataset.target){selected=t.checked?[...new Set([...selected,t.dataset.target])]:selected.filter(x=>x!==t.dataset.target);if(!selected.length)selected=[t.dataset.target];render();refreshPreview();}else if(t.dataset.patternKey==='target'||t.dataset.stickerKey==='anchor'||t.dataset.stickerKey==='targetMessageId')render();}
function onClick(e){const t=e.target.closest('button');if(!t){const area=e.target.closest('[data-atl-area]');if(area){const name=area.dataset.atlArea;selected=e.ctrlKey||e.shiftKey?[...new Set([...selected,name])]:[name];tab='design';render();refreshPreview();}return;}if(t.dataset.favorite){const f=(project.favorites||[]).find(x=>x.id===t.dataset.favorite);if(f){push();selected.forEach(k=>edition().elements[k]=cl(f.style));changed();render();}return;}if(t.dataset.tab){previewCandidate=null;tab=t.dataset.tab;render();refreshPreview();return;}
 if(t.dataset.catalogTry){try{const item=window.MimaAtelierCatalog.find(t.dataset.catalogTry);if(!item)return;if(item.type==='layout'){if(!window.MimaAtelierAtlas.hasLayout(item.id))return note('此布局还不兼容真实会话 DOM',true);previewCandidate=C.normalized(project);previewCandidate.layoutRecipe=item.id;}else previewCandidate=window.MimaAtelierAtlas.make(item.id);compareBefore=false;refreshPreview();const lbl=$('atl-catalog-preview-label');if(lbl)lbl.hidden=false;note('正在试穿 '+item.name+'，当前草稿与正式主题均未修改');}catch(err){note('试穿失败：'+err.message,true)}return;}
 if(t.dataset.catalogCreate){const item=window.MimaAtelierCatalog.find(t.dataset.catalogCreate);if(!item)return;
  if(item.type==='layout'){if(!window.MimaAtelierAtlas.hasLayout(item.id))return note('此布局当前不支持套用',true);push();project.layoutRecipe=item.id;changed();render();return note('布局已加入草稿，保存并应用后启用');}
  if(!confirm(`从「${item.name}」创建新主题？旧草稿将安全留在自动草稿列表中。`))return;
  switchToTheme(window.MimaAtelierAtlas.make(item.id)).then(()=>note('已创建新主题草稿，旧草稿不会被覆盖')).catch(err=>note('创建失败：'+err.message,true));return;}
 if(t.dataset.catalogBorrow){const item=window.MimaAtelierCatalog.find(t.dataset.catalogBorrow);if(!item||item.type==='layout')return;if(!confirm(`只把「${item.name}」的材质套进所选的 ${selected.map(k=>C.TARGETS[k]?.label||k).join('、')}？其他区域、贴纸、字体、自定义 CSS 不会改变。`))return;try{push();for(const key of selected)project=window.MimaAtelierAtlas.borrow(project,item.id,key);previewCandidate=null;changed();render();note('已将所选区域材质借到当前草稿，尚未正式应用。');}catch(err){note('区域借用失败：'+err.message,true)}return;}
 if(t.dataset.template){if(!confirm(`使用「${t.textContent.trim()}」新建主题？旧草稿自动保留。`))return;
  switchToTheme(C.baseTheme(t.dataset.template)).catch(e=>note('创建失败：'+e.message,true));return;}
 if(t.dataset.patternSelect){patternId=t.dataset.patternSelect;render();return;}if(t.dataset.stickerSelect){stickerId=t.dataset.stickerSelect;tab='stickers';render();return;}
 const choice=t.dataset.action;if(!choice){const area=t.closest('[data-atl-area]');if(area){const name=area.dataset.atlArea;selected=e.ctrlKey||e.shiftKey?[...new Set([...selected,name])]:[name];tab='design';render();refreshPreview();}return;}
 actions(choice).catch(err=>{console.error('[Theme Atelier]',choice,err);note(err.message||String(err),true)});
}
let styleClipboard=null;
async function actions(a){if(a==='close')return close();if(a==='catalog-prev'||a==='catalog-next'){catalogPage=Math.max(0,catalogPage+(a==='catalog-next'?1:-1));renderCatalogResults();return;}if(a==='cancel-catalog-preview'){previewCandidate=null;refreshPreview();render();return;}if(a==='expand')return setFullscreen(!fullscreen);if(a==='exit-fullscreen')return setFullscreen(false);if(a==='sandbox-preview')return setPreviewMode(previewMode==='sandbox'?'structure':'sandbox');if(a==='live-preview')return beginRealPagePreview();if(a==='live-editor')return beginDockedLiveEditor();if(a==='exit-live-editor')return endRealPagePreview();if(a==='pick-real-area'){setRealPicking(!pickingRealArea);return note(pickingRealArea?'点一下上方真实页面要编辑的区域；这一点击只会选择，不会触发页面按钮。':'已退出真实页面点选。');}if(a==='before'){compareBefore=!compareBefore;$('atl-preview').classList.remove('compare');const b=shadow.querySelector('[data-action="before"]');if(b)b.textContent=compareBefore?'返回修改后':'修改前比较';refreshPreview();return;}
 if(a==='undo'){if(undo.length){redo.push(snapshot(project));project=C.normalized(undo.pop());gestureKey=null;changed();render();}return;}
 if(a==='redo'){if(redo.length){undo.push(snapshot(project));project=C.normalized(redo.pop());gestureKey=null;changed();render();}return;}
 if(a==='favorite-save'){const value=prompt('给这个材质起个名字（会保存按钮、颜色、边框、文字等全部属性）：',C.TARGETS[selected[0]].label+' 收藏');if(!value?.trim())return;push();project.favorites.push({id:uid(),name:value.slice(0,80),style:cl(edition().elements[selected[0]])});changed();render();return note('材质已经收藏');}
 if(a==='copy-style'){styleClipboard=cl(edition().elements[selected[0]]);return note('样式已复制，可多选后粘贴');}
 if(a==='paste-style'){if(!styleClipboard)return note('请先复制样式',true);push();selected.forEach(x=>edition().elements[x]=cl(styleClipboard));changed();render();return;}
 if(a==='add-pattern'){const type=$('atl-new-pattern-type').value;push();const pat={id:uid(),type,target:selected[0]||'shell',size:22,weight:2,color:'#ad8aa0',opacity:35,angle:45,enabled:true};edition().patterns.push(pat);patternId=pat.id;changed();render();return;}
 if(a==='delete-pattern'){push();edition().patterns=edition().patterns.filter(x=>x.id!==patternId);patternId=null;changed();render();return;}
 if(a==='duplicate-pattern'){const p=currentPattern();if(!p)return;push();const newp={...cl(p),id:uid()};edition().patterns.push(newp);patternId=newp.id;changed();render();return;}
 if(a==='pattern-up'||a==='pattern-down'){const pats=edition().patterns,index=pats.findIndex(p=>p.id===patternId),next=index+(a==='pattern-up'?-1:1);if(index>=0&&next>=0&&next<pats.length){push();[pats[index],pats[next]]=[pats[next],pats[index]];changed();render();}return;}
 if(a==='import-font'){$('atl-font-input').value='';$('atl-font-input').click();return;}
 if(a==='background-image'||a==='add-sticker'){imageIntent=a;$('atl-image-input').value='';$('atl-image-input').click();return;}
 if(a==='clear-background'){push();selected.forEach(k=>edition().elements[k].image='');changed();render();return;}
 if(a==='duplicate-sticker'){const s=currentSticker();if(!s)return;push();const x={...cl(s),id:uid(),x:s.x+5,y:s.y+5};project.stickers.push(x);stickerId=x.id;changed();render();return;}
 if(a==='layer-up'||a==='layer-down'){const index=project.stickers.findIndex(x=>x.id===stickerId);const next=index+(a==='layer-up'?1:-1);if(index>=0&&next>=0&&next<project.stickers.length){push();[project.stickers[index],project.stickers[next]]=[project.stickers[next],project.stickers[index]];changed();render();}return;}
 if(a==='delete-sticker'){push();project.stickers=project.stickers.filter(x=>x.id!==stickerId);stickerId=null;changed();render();return;}
 if(a==='pick-palette'){const s=currentSticker();if(!s)return note('请先选择贴纸',true);const color=await colorFromDataURL(s.src);push();edition().elements[selected[0]].fill=color;changed();tab='design';render();return note('已从贴图提取颜色：'+color);}
 if(a==='mix-template'){const tmp=C.baseTheme($('atl-mix-template').value);push();selected.forEach(k=>{const image=edition().elements[k].image;edition().elements[k]={...tmp.elements[k],image};});changed();render();return;}
 if(a==='save-draft'){clearTimeout(saveTimer);await persistBeforeSwitch();const key=await C.saveManual(project);render();return note('手动版本已独立保存（'+key.slice(0,18)+'…），正式主题不变');}
 if(a==='saveapply'){if(previewCandidate)return note('你正在试穿风格，请先「创建主题」或退出试穿，再保存应用；试穿本身不改变当前草稿。',true);if(applying)return;applying=true;try{if(isPreviewPending())await endRealPagePreview();clearTimeout(saveTimer);await queueDraft();const applied=await C.apply(project,{syncCssLibrary:true});activeVersion=C.getActive().version;
      const receipt=applied.receipt||C.getLastApplyReceipt?.()||{};
      const auditHint=receipt.warnings?.length?`；计算样式有 ${receipt.warnings.length} 项提示，请打开「主题体检」确认`:'；真实设备最终像素尚未验证';
      let saved=null;
      try{saved=await saveCssToLibrary();}
      catch(exportError){console.error('[Atelier] applied, CSS library write unverified',exportError);
       try{await C.settleCssSync(applied.releaseKey,'LIBRARY_SYNC_FAILED_REPAIRABLE',{error:exportError.message});}
       catch(syncError){console.error('[Atelier] CSS sync status unverified',syncError);}
       note('工坊主题已正式应用，但 CSS 库未确认写入：'+exportError.message+'。请使用「只重试 CSS 库同步」，不要重新发布。',true);
      }
      if(saved){try{await C.settleCssSync(applied.releaseKey,'LIBRARY_SYNC_COMMITTED',{cssPresetId:saved.id});
          note('工坊主题已正式应用（像素待验）'+auditHint+'，CSS 库已保存：「'+saved.name+'」。');}
        catch(settlementError){console.error('[Atelier] CSS preset persisted but receipt failed',settlementError);
          note('CSS 库已经返回保存成功，但结算记录未核验：'+settlementError.message+'。请只重试核对，不要重新发布。',true);}}
      }finally{applying=false;}return;}
 if(a==='unapply'){if(isPreviewPending())await endRealPagePreview();await C.unapply();activeVersion=C.getActive().version;return note('工坊主题已停用，原始主题继续保留');}
 if(a==='authorize-selected'){
  const keys=selected.filter(k=>k==='status'||k==='safeHtmlHost');if(!keys.length)return note('先选择「HTML 状态栏」或「Safe HTML 外宿主」',true);
  push();keys.forEach(k=>{project.regions[k]=true;});changed();render();
  return note('已授权工坊接管：'+keys.map(k=>C.TARGETS[k].label).join('、')+'；尚未正式发布。');
 }
 if(a==='new-project'){await switchToTheme(C.baseTheme());return note('新草稿已创建，旧草稿仍在');}
 if(a==='export-json')return download(`${nameFile(project.name)}.atelier.json`,JSON.stringify(project,null,2),'application/json');
 if(a==='export-css'){const media=project.fonts.length+Object.values(project.elements).filter(x=>x.image).length;download(`${nameFile(project.name)}.css`,C.exportPresetCss(project),'text/css');if(media)note(`已导出轻量 CSS（${media} 个图片/字体资源未嵌入）；完整迁移请导出 ZIP。`);return;}
 if(a==='save-css-library'){await persistBeforeSwitch();const saved=await saveCssToLibrary();return note('已存入正式外观 → CSS 预设：'+saved.name+'（不会重复挂载）'+(project.stickers.length?'；动态贴纸仍需工坊主题':'') );}
 if(a==='retry-css-sync'){
  const current=await C.get('active');if(!current?.releaseKey)throw Error('没有可重试同步的正式版本');
  const task=await C.cssSyncStatus(current.releaseKey);
  if(!task)return note('当前正式主题没有待重试的同步任务',true);
  if(task.phase==='LIBRARY_SYNC_COMMITTED')return note('当前正式主题的 CSS 库已完成同步，无须再次发布');
  const stored=await C.get(current.releaseKey);
  if(!stored)throw Error('正式主题快照无法确认；禁止用当前草稿假冒历史版本');
  let saved;
  try{saved=await saveCssToLibrary(C.normalized(stored),{updateDraft:false});}
  catch(e){await C.settleCssSync(current.releaseKey,'LIBRARY_SYNC_FAILED_REPAIRABLE',{error:e.message}).catch(x=>console.error('[Atelier] sync receipt failed',x));throw e;}
  try{await C.settleCssSync(current.releaseKey,'LIBRARY_SYNC_COMMITTED',{cssPresetId:saved.id});
      note('仅 CSS 库同步成功；正式主题、当前草稿和历史数据均未重新发布');}
  catch(e){console.error('[Atelier] CSS preset saved, receipt unverified',e);note('CSS 库已保存，但本地回执未核验：'+e.message,true);}
  return;
 }
 if(a==='export-zip')return exportZip();
 if(a==='import'){$('atl-project-input').value='';$('atl-project-input').click();return;}
 if(a==='inspect')return inspect();if(a==='export-diagnostics')return download('mima-appearance-diagnostics.json',JSON.stringify(await C.appearanceDiagnostics(),null,2),'application/json');
 if(a==='snapshot'){const key=`history:${project.id}:${Date.now()}`;await queueDraft();await C._historySave(key,project);return note('历史版本已保存');}
 if(a==='restore-history'){const p=await C._historyLatest(project.id);if(!p)return note('暂时没有历史快照',true);push();project=C.normalized(p);changed();render();return note('已从最近历史快照恢复到草稿，尚未正式应用');}
 if(a.startsWith('load:')){const saved=await C.get('project:'+a.slice(5));if(!saved)throw new Error('主题不存在，可能已被其他窗口移除');await switchToTheme(saved);return note('已载入自动草稿，旧编辑已保护');}
 if(a.startsWith('manual:')){const saved=await C.get(a);if(!saved)throw new Error('手动版本已不存在');const fork=await C.forkDraft({...saved,id:uid(),draftVersion:0,linkedCssId:''});await switchToTheme(fork);return note('手动版本已作为新的独立草稿打开，原版本不变');}
 if(a==='fork-conflict'){const copy=await C.forkDraft(snapshot(project));await switchToTheme(copy);return note('发生版本冲突的作品已另存为独立草稿');}

}
function nameFile(s){return String(s||'theme').replace(/[\\/:*?"<>|]/g,'_').slice(0,72)}
function download(name,content,type){const mime=type==='application/zip'?type:`${type};charset=utf-8`;return window.MimaFileExport.save(name,content,mime)}
async function onFont(e){const file=e.target.files?.[0];if(!file)return;try{const ext=(file.name.split('.').pop()||'').toLowerCase();if(!['ttf','otf','woff','woff2'].includes(ext))throw new Error('格式只支持 TTF、OTF、WOFF、WOFF2');if(file.size>8*1024*1024)throw new Error('单个字体超过 8MB 限制');const src=await readData(file);const family='MimaAtelierFont_'+uid().replace(/[^A-Za-z0-9]/g,'');push();project.fonts.push({family,name:file.name.slice(0,80),format:ext,src:src.replace(/^data:[^;,]+;base64,/,`data:application/octet-stream;base64,`)});selected.forEach(k=>edition().elements[k].fontFamily=family);changed();render();note('字体已内嵌入主题工程');}catch(err){note('字体导入失败：'+err.message,true)}}
let imageIntent='add-sticker';
async function onImage(e){const file=e.target.files?.[0];if(!file)return;try{if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw new Error('仅支持 PNG/JPEG/WebP/GIF');if(file.size>5*1024*1024)throw new Error('单张素材限制 5MB，可先压缩图片');const src=await readData(file);push();if(imageIntent==='background-image')selected.forEach(id=>edition().elements[id].image=src);else{const s={id:uid(),name:file.name.slice(0,65),src,anchor:'shell',x:50,y:75,width:28,rotate:0,opacity:100,hidden:false,plane:'behind'};project.stickers.push(s);stickerId=s.id;tab='stickers';}changed();render();}catch(err){note('导入图片失败：'+err.message,true)}}
function readData(file){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(fr.error||Error('文件读取失败'));fr.readAsDataURL(file);})}
function colorFromDataURL(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{try{const c=document.createElement('canvas');c.width=c.height=32;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0,32,32);const d=ctx.getImageData(0,0,32,32).data,colors=[];for(let i=0;i<d.length;i+=16)if(d[i+3]>150)colors.push([d[i],d[i+1],d[i+2]]);if(!colors.length)throw Error('图片无不透明色彩');const q=colors.reduce((sum,c)=>sum.map((v,j)=>v+c[j]),[0,0,0]);resolve('#'+q.map(v=>Math.round(v/colors.length).toString(16).padStart(2,'0')).join(''));}catch(e){reject(e)}};im.onerror=()=>reject(Error('图片无法读取颜色'));im.src=src})}
async function showProjects(){const area=$('atl-saved-projects');if(!area)return;
 try{const [ids,manual]=await Promise.all([C.listProjects(),C.listManual()]);const values=await Promise.all(ids.map(id=>C.get('project:'+id)));
 const btn=(p,action,label)=>`<button data-action="${esc(action)}" class="atl-project-item">${esc(p.name)}<small>${label} · ${new Date(p.manualSavedAt||p.updatedAt).toLocaleString()}</small></button>`;
 const man=manual.filter(v=>v.project).sort((a,b)=>(b.project.manualSavedAt||0)-(a.project.manualSavedAt||0));
 const drafts=values.filter(Boolean).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
 area.innerHTML=`<h3>★ 手动保存的版本 (${man.length})</h3>${man.map(v=>btn(v.project,v.key,'手动保存')).join('')||'<p class="atl-hint">尚无手动版本，点击「保存草稿」可建立版本。</p>'}<h3>◌ 自动防丢草稿 (${drafts.length})</h3>${drafts.map(p=>btn(p,'load:'+p.id,'自动草稿')).join('')||'<p class="atl-hint">暂无草稿</p>'}`;
 }catch(e){area.textContent='读取失败：'+e.message;}}
function inspect(){const issues=[];if(project.stickers.length>12)issues.push('贴纸超过 12 张，低性能手机可能出现渲染负担。');for(const s of project.stickers)if(s.anchor!=='shell'&&s.width>100)issues.push(`${s.name} 宽度超过锚点区域，可能遮挡内容。`);for(const [k,e] of Object.entries(project.elements)){if(e.alpha===0&&e.ink===e.fill)issues.push(`${C.TARGETS[k].label} 文字可能不易阅读。`);if(e.blur>=40)issues.push(`${C.TARGETS[k].label} 背景模糊较高。`);if(['glass','aqua'].includes(e.material)&&e.blur===0)issues.push(`${C.TARGETS[k].label} 选择玻璃但手动关闭了背景模糊（0px）。`);if(['glass','aqua'].includes(e.material)&&e.alpha>=92)issues.push(`${C.TARGETS[k].label} 背景很不透明（${e.alpha}%），可能遮住实际磨砂效果。`);}const activated=C.getApplied(),userLayers=['mima-custom-css-style','mima-global-css-style'].map(id=>({id,css:document.getElementById(id)?.textContent||''})).filter(x=>x.css.trim());
 if(userLayers.length){issues.push(`当前加载 ${userLayers.length} 层旧 CSS：${userLayers.map(x=>x.id).join('、')}。工坊工程优先级：${C.resolvePresentationPlan(project).mode}。`);const locks=userLayers.reduce((n,x)=>n+(x.css.match(/!important\b/gi)||[]).length,0);if(locks)issues.push(`旧 CSS 中检测到 ${locks} 处 !important；即使工坊区域优先也可能被覆盖，建议用合成预览逐区核对。`);}else issues.push('未发现已挂载的旧自定义 CSS 样式标签；内置主题仍参与页面样式。');
 if(activated?.id){for(const [label,selector] of [['顶栏','.topbar'],['消息','.assistant-msg > .msg-content'],['底栏','.composer-shell']]){const el=document.querySelector(selector);if(!el)continue;const cs=getComputedStyle(el);issues.push(`当前已挂载主题 ${label}：背景模糊 ${cs.backdropFilter||cs.webkitBackdropFilter||'未读取'}；裁剪 ${cs.clipPath||'未读取'}。`);}}
 if(project.extraCss){
 issues.push('存在高级 CSS：结构镜像仅模拟常见咪嘛馆元素，不代表真实角色卡或插件全部 DOM。');
 const important=(project.extraCss.match(/!important\b/gi)||[]).length;
 if(important)issues.push(`高级 CSS 包含 ${important} 个 !important 声明，注意与全局主题的覆盖优先级。`);
 if(/@import\b/i.test(project.extraCss))issues.push('发现 @import：外部 CSS 可能依赖网络加载，建议在正式应用前检查。');
 if(/(?:^|[},])\s*(?:html|body|:root|\*)(?=\s*[,>{:#.\[]|\s*\{)/im.test(project.extraCss))issues.push('高级 CSS 包含全局选择器，可能覆盖其他页面或旧主题。');
}if(C.getApplied()?.id){issues.push('当前页面只读计算样式：'+JSON.stringify(C.renderAudit()));}issues.push('精简 CSS '+C.exportPresetCss(project).length+' 字符；工程内媒体数据 '+(project.fonts.reduce((n,f)=>n+(f.src?.length||0),0)+Object.values(project.elements).reduce((n,e)=>n+(e.image?.length||0),0))+' 字符，CSS 不重复展开。');$('atl-inspection').textContent=issues.join('\n')||'未发现常规规则风险。';note('体检已完成（规则检查，不是浏览器实测）');}
function onPointerDown(e){const el=e.target.closest('[data-sticker-drag]');if(!el)return;const s=project.stickers.find(x=>x.id===el.dataset.stickerDrag);if(!s)return;const area=previewStickerAnchor(s,$('atl-preview'));if(!area)return;const r=area.getBoundingClientRect(),pr=$('atl-preview').querySelector('.atl-scene').getBoundingClientRect();drag={id:s.id,startX:e.clientX,startY:e.clientY,x:s.x,y:s.y,w:r.width,h:r.height,baseLeft:r.left-pr.left,baseTop:r.top-pr.top};push();el.setPointerCapture(e.pointerId);e.preventDefault()}
function onPointerMove(e){if(!drag)return;const s=project.stickers.find(x=>x.id===drag.id);if(!s)return;s.x=C.clamp(drag.x+(e.clientX-drag.startX)/Math.max(1,drag.w)*100,-150,250);s.y=C.clamp(drag.y+(e.clientY-drag.startY)/Math.max(1,drag.h)*100,-150,250);const el=$('atl-preview-stickers')?.querySelector(`[data-sticker-drag="${s.id}"]`);if(el){el.style.left=`${drag.w*s.x/100}px`;el.style.top=`${drag.h*s.y/100}px`;}scheduleDraft();}
function onPointerUp(){if(!drag)return;drag=null;changed();if(tab==='stickers')render()}
async function onImport(e){const file=e.target.files?.[0];if(!file)return;try{let p;if(file.size>24*1024*1024)throw Error('工程文件超过 24MB，请先压缩素材再导入');const bytes=await file.arrayBuffer();if(file.name.toLowerCase().endsWith('.zip')){const entries=await unzipProjectZip(new Uint8Array(bytes));const data=entries['theme.atelier.json'];if(!data)throw new Error('ZIP 不包含可编辑的 theme.atelier.json');p=JSON.parse(new TextDecoder().decode(data));}else if(file.name.toLowerCase().endsWith('.css')){p=C.baseTheme();p.name=file.name.replace(/\.css$/i,'')+' · CSS 导入';p.extraCss=new TextDecoder().decode(bytes);}else p=JSON.parse(new TextDecoder().decode(bytes));p=C.normalized(p);p.id=uid();p.draftVersion=0;p.linkedCssId='';await switchToTheme(p);tab='design';render();note('导入成功，已建立独立草稿；尚未挂载');}catch(err){note('导入失败：'+err.message,true)}}
function crc(bytes){let x=~0;for(const b of bytes){x^=b;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0);}return (~x)>>>0;}
function zipStored(files){const enc=new TextEncoder(),parts=[],central=[];let offset=0;const le=(view,pos,v,len)=>{if(len===2)view.setUint16(pos,v,true);else view.setUint32(pos,v,true)};
 for(const [name,value] of Object.entries(files)){const n=enc.encode(name),data=value instanceof Uint8Array?value:enc.encode(value),check=crc(data),a=new Uint8Array(30+n.length+data.length),dv=new DataView(a.buffer);le(dv,0,0x04034b50,4);le(dv,4,20,2);le(dv,6,0x0800,2);le(dv,8,0,2);le(dv,14,check,4);le(dv,18,data.length,4);le(dv,22,data.length,4);le(dv,26,n.length,2);a.set(n,30);a.set(data,30+n.length);parts.push(a);
 const b=new Uint8Array(46+n.length),c=new DataView(b.buffer);le(c,0,0x02014b50,4);le(c,4,20,2);le(c,6,20,2);le(c,8,0x0800,2);le(c,16,check,4);le(c,20,data.length,4);le(c,24,data.length,4);le(c,28,n.length,2);le(c,42,offset,4);b.set(n,46);central.push(b);offset+=a.length;}
 const size=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);le(e,0,0x06054b50,4);le(e,8,central.length,2);le(e,10,central.length,2);le(e,12,size,4);le(e,16,offset,4);return new Blob([...parts,...central,end],{type:'application/zip'});}
async function unzipProjectZip(bytes){
 // Read the central directory, not the local header: ZIP writers may use data descriptors.
 // Check CRC, bounds and all entry names before touching the existing draft.
 if(bytes.byteLength>24*1024*1024)throw Error('ZIP 文件超过 24MB');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>v.getUint16(i,true),u32=i=>v.getUint32(i,true);
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){eocd=i;break;}
 if(eocd<0)throw Error('不是完整的标准 ZIP（找不到中央目录）');
 if(u16(eocd+4)!==0||u16(eocd+6)!==0||u16(eocd+8)!==u16(eocd+10))throw Error('不支持多磁盘 ZIP');
 const count=u16(eocd+10),start=u32(eocd+16),centralSize=u32(eocd+12);
 if(count>100||start+centralSize>eocd||count===0)throw Error('ZIP 文件数量或中央目录无效');
 if(count===65535||start===0xffffffff)throw Error('暂不支持 ZIP64 工程');
 const names=new Set(),records=[],decoder=new TextDecoder('utf-8',{fatal:true});let pos=start,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>eocd||u32(pos)!==0x02014b50)throw Error('ZIP 中央目录结构不完整');
  const flags=u16(pos+8),method=u16(pos+10),check=u32(pos+16),size=u32(pos+20),length=u32(pos+24),n=u16(pos+28),extra=u16(pos+30),comment=u16(pos+32),offset=u32(pos+42);
  if((flags&1)!==0)throw Error('不支持加密 ZIP');
  if(method!==0&&method!==8)throw Error('ZIP 使用了不支持的压缩算法（只支持储存或 Deflate）');
  if(size===0xffffffff||length===0xffffffff||offset===0xffffffff)throw Error('不支持 ZIP64 大文件');
  if(pos+46+n+extra+comment>eocd)throw Error('ZIP 文件名边界损坏');
  const name=decoder.decode(bytes.subarray(pos+46,pos+46+n));
  if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(x=>x==='..'||x==='.')||/^[a-zA-Z]:/.test(name))throw Error('ZIP 包含非法路径');
  if(names.has(name))throw Error('ZIP 包含重复文件名：'+name);names.add(name);
  total+=length;if(length>64*1024*1024||total>120*1024*1024)throw Error('ZIP 解压后内容过大');
  if(offset+30>start||u32(offset)!==0x04034b50)throw Error('ZIP 本地文件头损坏');
  const localNameLen=u16(offset+26),localExtraLen=u16(offset+28),dataOffset=offset+30+localNameLen+localExtraLen;
  if(dataOffset+size>start)throw Error('ZIP 压缩数据越界');
  if(decoder.decode(bytes.subarray(offset+30,offset+30+localNameLen))!==name)throw Error('ZIP 文件名不一致');
  records.push({name,method,check,length,dataOffset,size});pos+=46+n+extra+comment;
 }
 if(pos!==start+centralSize)throw Error('ZIP 目录长度不匹配');
 if(!names.has('theme.atelier.json'))throw Error('ZIP 不包含可编辑的 theme.atelier.json；纯 CSS 请使用「导入 CSS」');
 const out={};for(const r of records){
  if(r.name.endsWith('/'))continue;
  const compressed=bytes.subarray(r.dataOffset,r.dataOffset+r.size);
  let raw;
  if(r.method===0)raw=compressed.slice();
  else{
   if(typeof DecompressionStream!=='function')throw Error('当前浏览器不支持 ZIP Deflate 解压，请使用工坊的无压缩 ZIP 或导入 JSON');
   try{const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));raw=new Uint8Array(await new Response(stream).arrayBuffer());}
   catch(err){throw Error('ZIP Deflate 解压失败：'+(err?.message||String(err)));}
  }
  if(raw.length!==r.length||crc(raw)!==r.check)throw Error('ZIP 素材 CRC/大小校验失败：'+r.name);
  out[r.name]=raw;
 }
 return out;
}
function exportZip(){const pack=C.portableBundle(project);const files={'theme.atelier.json':JSON.stringify(project,null,2),'theme.css':pack.css,'README.txt':'MIMA Theme Atelier portable ZIP. theme.css references assets/ (keep relative paths together). The editable full-fidelity project is theme.atelier.json; import it through Atelier. Dynamic stickers still require the Atelier DOM. Commercial distribution must respect asset copyrights.',...pack.files};download(`${nameFile(project.name)}.atelier.zip`,zipStored(files),'application/zip')}
window.MimaThemeAtelier={open:()=>open().catch(err=>{console.error('[Theme Atelier] could not open without verified data',err);alert('主题工坊无法安全打开：'+err.message+'\n原有主题与咪嘛馆存档未被重置。');}),close:()=>close().catch(err=>{console.error('[Atelier] close prevented by unsaved changes',err);note('草稿未保存，暂不关闭：'+err.message,true)}),isOpen:()=>opened};
})();
