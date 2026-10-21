/**
 * 🍷 MIMAMAO Tavern V2 UI
 * 独立宇宙优先 · 手机优先 · Persona / Worldbook / Prompt Inspector / Local Font Library
 */
let currentSessionId = null;
let currentSessionData = null;
let sessions = [];
let masks = [];
let presets = [];
let worldbooks = [];
let cssPresets = [];
let regexPacks = [];
let activeRequest = null;
let isGenerating = false;
let settingsTab = 'roles';
let settingsRenderEpoch = 0;
let sessionNavigationEpoch = 0; // Only the most recent user-selected session may own the visible UI.
let settingsNavigationTouched = false;
let editorState = null;
let pendingPersonaType = 'character';
let pngResourceInspection = null;
let pngResourceBusy = false;
let fontRecords = [];
let memoryGenerating = false;
let factMergePlanning = false;
let memoryTask = null; // UI-independent, single owner for story-memory requests.
let memoryMergeDraft = null; // durable candidate mirrored for current UI; canonical facts unchanged until approval
let memoryMergeSaveTimer=null, memoryMergeWrite=Promise.resolve();
let memoryFactEditId = null;
let liveStreamState = null;
let deferredGenerationProgress = null;
let generationPanelMinimized = false;
let contextRecoveryReceipt = null;
let lastGenerationFailure = null;
let currentGenerationAction = null;
let appearancePreviewSurface = 'chat';
// A generation owns exactly one original session; a selected tab is merely a view.
const generationOwners = new Map();
const generationFailures = new Map();
const sessionComposerDrafts = new Map();
let generationSerial = 0;


const TEMP_KEY = 'MIMAMAO_TAVERN_TEMP';
const LEGACY_FONT_URL_KEY = 'storyFontUrl';
const LEGACY_FONT_FAMILY_KEY = 'storyFontFamily';
const STORY_TYPO_KEY = 'MIMAMAO_TAVERN_STORY_TYPO_V1';
const DEFAULT_STORY_TYPO = Object.freeze({ fontSize:16, lineHeight:1.78, paragraphGap:1.05, letterSpacing:0, firstLineIndent:0 });

function clampNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function getStoryTypography(){
    try{
        const raw=JSON.parse(localStorage.getItem(STORY_TYPO_KEY)||'{}');
        return {
            fontSize:clampNumber(raw.fontSize,12,26,DEFAULT_STORY_TYPO.fontSize),
            lineHeight:clampNumber(raw.lineHeight,1.2,2.6,DEFAULT_STORY_TYPO.lineHeight),
            paragraphGap:clampNumber(raw.paragraphGap,0,3,DEFAULT_STORY_TYPO.paragraphGap),
            letterSpacing:clampNumber(raw.letterSpacing,-0.04,0.18,DEFAULT_STORY_TYPO.letterSpacing),
            firstLineIndent:clampNumber(raw.firstLineIndent,0,4,DEFAULT_STORY_TYPO.firstLineIndent)
        };
    }catch(_){return {...DEFAULT_STORY_TYPO}}
}
function applyStoryTypography(cfg=getStoryTypography()){
    const root=document.documentElement;
    root.style.setProperty('--story-font-size',`${cfg.fontSize}px`);
    root.style.setProperty('--story-line-height',String(cfg.lineHeight));
    root.style.setProperty('--story-paragraph-gap',`${cfg.paragraphGap}em`);
    root.style.setProperty('--story-letter-spacing',`${cfg.letterSpacing}em`);
    root.style.setProperty('--story-first-line-indent',`${cfg.firstLineIndent}em`);
}
function storyTypoDisplay(key,value){const n=Number(value);if(key==='fontSize')return `${n.toFixed(n%1?1:0)}px`;if(key==='lineHeight')return n.toFixed(2);return `${n.toFixed(key==='letterSpacing'?3:2)}em`}
function syncStoryTypographyControls(cfg=getStoryTypography()){
    for(const key of Object.keys(DEFAULT_STORY_TYPO)){
        const range=qs(`typo-${key}-range`),num=qs(`typo-${key}-number`),pill=qs(`typo-${key}-value`);
        if(range)range.value=cfg[key];if(num)num.value=cfg[key];if(pill)pill.textContent=storyTypoDisplay(key,cfg[key]);
    }
}
function updateStoryTypography(key,value){
    if(!Object.prototype.hasOwnProperty.call(DEFAULT_STORY_TYPO,key))return;
    const cfg=getStoryTypography(),limits={fontSize:[12,26],lineHeight:[1.2,2.6],paragraphGap:[0,3],letterSpacing:[-.04,.18],firstLineIndent:[0,4]};
    cfg[key]=clampNumber(value,limits[key][0],limits[key][1],DEFAULT_STORY_TYPO[key]);
    localStorage.setItem(STORY_TYPO_KEY,JSON.stringify(cfg));applyStoryTypography(cfg);syncStoryTypographyControls(cfg);
}
function resetStoryTypography(){localStorage.removeItem(STORY_TYPO_KEY);applyStoryTypography(DEFAULT_STORY_TYPO);syncStoryTypographyControls(DEFAULT_STORY_TYPO);toast('剧情正文排版已恢复默认')}

function qs(id) { return document.getElementById(id); }
function qsa(sel, root=document) { return [...root.querySelectorAll(sel)]; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
function arr(v) { return Array.isArray(v) ? v : []; }
function lines(text) { return String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
function csv(text) { return String(text || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function cleanCorruptText(text) {
    let out = String(text ?? '');
    try { out = out.normalize('NFC'); } catch (_) {}
    return out.replace(/\uFFFD+/g,'').replace(/(?:ï¿½)+/g,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
}
function goPhone() { toast('这是独立分享版：没有连接 MIMAMAO 手机或宅邸。'); }

async function fetchStory(endpoint, method='GET', body=null, useAbort=false, progress=null, signalOverride=null) {
    // Chat and background memory summaries have distinct cancellation ownership.
    const controller = useAbort ? new AbortController() : null;
    if (controller) {
        if (activeRequest) activeRequest.abort();
        activeRequest = controller;
    }
    try {
        return await MimaStandalone.handle(endpoint, method, body, controller?.signal || signalOverride, progress);
    } catch (err) {
        if (err?.name === 'AbortError') return { success:false, aborted:true, code:'E_ABORTED', msg:'操作已停止' };
        const info=describeApiError(err);
        return { success:false, msg:info.message, code:info.code, status:info.status, hint:info.hint, details:info.details };
    } finally {
        if(controller && activeRequest===controller) activeRequest=null;
    }
}

function currentGenerationOwner(){return generationOwners.get(currentSessionId)||null;}
function ownsVisibleGeneration(owner){return !!owner && generationOwners.get(owner.sessionId)===owner && currentSessionId===owner.sessionId;}
function preserveComposerDraft(id=currentSessionId){
    if(!id)return;
    const input=qs('story-input'),director=qs('director-note');
    sessionComposerDrafts.set(id,{text:input?.value||'',director:director?.value||''});
}
function restoreComposerDraft(id){
    const draft=sessionComposerDrafts.get(id)||{text:'',director:''};
    if(qs('story-input'))qs('story-input').value=draft.text;
    if(qs('director-note'))qs('director-note').value=draft.director;
    autoResizeInput();
}
function clearSubmittedDraft(owner){
    if(owner.action!=='send'||owner.inputCleared)return;
    owner.inputCleared=true;
    const saved=sessionComposerDrafts.get(owner.sessionId);
    if(saved?.text===owner.text)sessionComposerDrafts.set(owner.sessionId,{...saved,text:''});
    if(ownsVisibleGeneration(owner)){
        const el=qs('story-input');
        if(el?.value===owner.text){el.value='';autoResizeInput();}
    }
}
function restoreGenerationView(){
    const owner=currentGenerationOwner();
    clearLiveStream();
    // A previously displayed error belongs only to the original session.
    lastGenerationFailure=generationFailures.get(currentSessionId)||null;
    currentGenerationAction=owner?.action||null;
    deferredGenerationProgress=null;
    const panel=qs('generation-panel');
    panel?.classList.add('hidden');
    if(owner){
        beginGenerationProgress(owner.action);
        if(owner.lastProgress)setGenerationProgress(owner.lastProgress);
        if(owner.action==='send'&&!owner.userSaved&&!arr(currentSessionData?.messages).some(m=>m.content===owner.text&&m.role==='user'))renderPendingUserMessage(owner.text);
        if(owner.streamText){const st=ensureLiveStreamBubble(owner);if(st){st.targetText=owner.streamText;st.displayText=owner.streamText;renderLiveStreamText();}}
    }else if(lastGenerationFailure){showGenerationError(lastGenerationFailure,lastGenerationFailure.action,true);}
    toggleUIState(generationOwners.size>0);
}
function openDrawer(){qs('session-drawer').classList.add('open');qs('drawer-scrim').classList.remove('hidden')}
function closeDrawer(){qs('session-drawer').classList.remove('open');qs('drawer-scrim').classList.add('hidden')}
function isSettingsOpen(){const modal=qs('settings-modal');return !!modal&&!modal.classList.contains('hidden')}
function openSettings(tab='roles'){settingsNavigationTouched=true;settingsTab=tab;qs('settings-modal').classList.remove('hidden');renderSettings()}
function closeSettings(){if(settingsTab==='templates'&&templateEditorDirty&&!confirm('设置模板有尚未保存的修改，确定关闭并放弃吗？'))return;templateEditorDirty=false;settingsNavigationTouched=true;++settingsRenderEpoch;qs('settings-modal').classList.add('hidden');if(deferredGenerationProgress){if(ownsVisibleGeneration(deferredGenerationProgress.owner))setGenerationProgress(deferredGenerationProgress.payload);deferredGenerationProgress=null}if(liveStreamState)liveStreamState.visualPaused=false}
function switchSettingsTab(tab){if(tab!==settingsTab&&settingsTab==='templates'&&templateEditorDirty&&!confirm('模板修改尚未保存，确定离开并放弃吗？'))return;templateEditorDirty=false;settingsNavigationTouched=true;settingsTab=tab;renderSettings()}
function maybeOpenInitialApiSettings(){
    // This delayed first-run invitation must never override a user's tab selection.
    if(settingsNavigationTouched||isSettingsOpen()||!currentSessionData||MimaStandalone.getApiConfig().apiBase)return false;
    openSettings('api');return true;
}
function settingsRenderIsCurrent(tab,epoch,box){return settingsTab===tab&&epoch===settingsRenderEpoch&&isSettingsOpen()&&box===qs('settings-content')}

function syncAppearancePreviewMode(on){
    const panel=qs('settings-modal')?.querySelector('.settings-panel');
    if(!panel)return;
    let stage=qs('appearance-preview-stage');
    if(on){
        panel.classList.add('appearance-preview-mode');
        if(!stage){
            stage=document.createElement('section');
            stage.id='appearance-preview-stage';
            stage.className='appearance-preview-stage'+((rootHeightForPreview()<480)?' is-collapsed':'');
            panel.insertBefore(stage,qs('settings-content'));
        }
        renderAppearancePreview();
    }else{
        panel.classList.remove('appearance-preview-mode');
        if(stage)stage.remove();
    }
}
function rootHeightForPreview(){return window.visualViewport?.height||window.innerHeight}
function toggleAppearancePreview(){qs('appearance-preview-stage')?.classList.toggle('is-collapsed');renderAppearancePreview()}
function setAppearancePreviewSurface(surface){appearancePreviewSurface=['chat','novel','assistant'].includes(surface)?surface:'chat';renderAppearancePreview()}
function renderAppearancePreview(){
    const stage=qs('appearance-preview-stage');if(!stage)return;
    const safeOn=currentSessionData?.renderMode==='safe_html';
    const tabs=`<div class="appearance-preview-tabs"><button class="${appearancePreviewSurface==='chat'?'active':''}" onclick="setAppearancePreviewSurface('chat')">聊天</button><button class="${appearancePreviewSurface==='novel'?'active':''}" onclick="setAppearancePreviewSurface('novel')">小说</button><button class="${appearancePreviewSurface==='assistant'?'active':''}" onclick="setAppearancePreviewSurface('assistant')">助手</button></div>`;
    if(appearancePreviewSurface==='novel'){stage.innerHTML='<button class="appearance-preview-toggle" type="button" onclick="toggleAppearancePreview()">展开 / 收起预览</button>'+tabs+`<div class="appearance-preview-novel"><div class="eyebrow">NOVEL STUDIO PREVIEW</div><h2>第十二章　午夜钟声</h2><p>雨声落在窗沿上，纸页在灯下泛着柔和的灰。她没有立刻拆开那封信，只把它压在掌心。</p><p>第二段用来确认段距、行高和首行缩进。长篇阅读的舒适度比炫目的特效更重要。</p><div class="novel-memory-card"><h4>剧情档案</h4><p>红色信封的来源仍未揭示；钟楼线正在推进。</p></div><div class="novel-director-box"><label>续写要求</label><div class="field">暂时不要揭露寄信人身份。</div></div><section class="novel-draft"><strong>AI CONTINUATION · Draft</strong><p>新的正文草稿会显示在这里。</p></section><button class="primary-btn">✒ 续写</button></div>`;return}
    if(appearancePreviewSurface==='assistant'){stage.innerHTML='<button class="appearance-preview-toggle" type="button" onclick="toggleAppearancePreview()">展开 / 收起预览</button>'+tabs+`<div class="appearance-preview-assistant"><div class="eyebrow">ASSISTANT STUDIO PREVIEW</div><div class="assistant-chat-text">你：帮我做一个水墨屏风格的 Novel CSS。</div><div class="assistant-chat-text">CSS 美化助手：会使用稳定的 Novel selector 与 reader token。</div></div>`;return}
    stage.innerHTML='<button class="appearance-preview-toggle" type="button" onclick="toggleAppearancePreview()" aria-expanded="'+!stage.classList.contains('is-collapsed')+'">'+(stage.classList.contains('is-collapsed')?'展开排版预览':'收起排版预览')+'</button>'+tabs+`<div class="appearance-preview-head"><div><span class="eyebrow">LIVE PREVIEW（实时预览）</span><strong>正文排版实验室</strong></div><div class="appearance-preview-badges"><span class="tag">不会写入剧情</span><span class="tag ${safeOn?'preview-safe-on':'preview-safe-off'}">Safe HTML ${safeOn?'ON':'OFF'}</span></div></div>
    <div class="appearance-preview-scroll"><div class="typography-preview-page">
      <article class="message assistant-msg typography-preview-message"><div class="msg-header">Character（示范角色） · 默认示范文本</div><div class="msg-content tavern-story-content${safeOn?' safe-html-content':''}">
        <div class="story-prose story-paragraph">雨声落在窗沿上，像有人用指尖轻轻敲着玻璃。她把书页压住，抬眼望向你："还没有睡吗？"</div>
        <div class="story-prose story-paragraph">这是第二段示范文字。请拖动下面的字号、行间距、段间距、字间距与首行缩进；这里会立刻跟着改变，用来观察长篇小说阅读时最真实的密度和呼吸感。</div>
        <div class="story-prose story-paragraph">第三段故意写得稍长一些：当屏幕宽度变窄时，你可以更直观地判断字距是否太松、行距是否拥挤，以及二 em 首行缩进是不是正好符合你习惯的中文小说版式。</div>
      </div></article>
      <article class="message user-msg typography-preview-user"><div class="msg-header">你 · 玩家消息预览</div><div class="msg-content tavern-story-content"><div class="story-prose story-paragraph">这是玩家自己的对话框。字号、行高、字间距、段间距、首行缩进和剧情正文字体都会与正文设置同步。</div><div class="story-prose story-paragraph">第二段用于确认多段玩家消息的排版也能实时变化。</div></div></article>
      ${safeOn?`<article class="message assistant-msg typography-preview-safe-demo"><div class="msg-header">Safe HTML（兼容测试）</div><div class="msg-content tavern-story-content safe-html-content"><p class="story-prose story-paragraph typography-preview-html-prose">这是第一段 Safe HTML 正文。它显式挂载正文排版类，因此字号、行高、字间距、段间距与首行缩进都会实时变化。</p><p class="story-prose story-paragraph typography-preview-html-prose">这是第二段 Safe HTML 正文，用来直观看出段间距和首行缩进；下面的状态栏仍保持自己的 CSS，不会被正文排版强行挤坏。</p><system class="typography-preview-statusbar"><strong>STATUS BAR</strong><span>自带 CSS 的状态栏仍保持自己的字号与布局，不会被首行缩进或段间距挤坏。</span><div class="typography-preview-status-row"><span>心情　平静</span><span>时间　23:48</span></div></system></div></article>`:`<div class="typography-preview-safe-placeholder">开启下方「允许 Safe HTML 状态栏渲染」后，这里会出现 HTML 正文 + 状态栏兼容性示范。</div>`}
    </div></div>`;
}
function closeEditor(){qs('editor-modal').classList.add('hidden');editorState=null}
function openNewSessionModal(){qs('new-session-modal').classList.remove('hidden');refreshSettingTemplateChoices();setTimeout(()=>qs('new-session-title').focus(),50)}
let settingTemplateCache=[];
let selectedTemplateEditId=''; // independent editor, never tied to any session
let templateEditorDirty=false;

async function refreshSettingTemplateChoices(){
    const select=qs('new-session-template');if(!select)return;
    const res=await fetchStory('/setting-templates');
    if(!res.success||!Array.isArray(res.data)){toast('设置模板库读取失败，无法确认可用模板');select.disabled=true;return;}
    settingTemplateCache=res.data;select.disabled=false;
    const previous=select.value;
    select.replaceChildren(new Option('不使用模板',''));
    res.data.forEach(t=>select.add(new Option(`${t.isDefault?'★ ':''}${t.name}`,t.id)));
    if(res.data.some(x=>x.id===previous))select.value=previous;
    else if(res.data.some(x=>x.isDefault))select.value=res.data.find(x=>x.isDefault).id;
    renderSettingTemplatePreview();
}
function renderSettingTemplatePreview(){
    const tpl=settingTemplateCache.find(t=>t.id===qs('new-session-template')?.value),view=qs('new-session-template-preview');if(!view)return;
    if(!tpl){view.textContent='无模板：保留新剧情默认设置';return;}
    const c=tpl.config||{};
    view.textContent=`${tpl.name}：${(c.presetIds||[]).length} 个预设、${(c.worldbookIds||[]).length} 本世界书、${(c.regexPackIds||[]).length} 个正则包；${c.promptSettings?'包含长剧情设置；':''}${c.loadedUserMaskId?'包含用户面具；':''}${c.customCssId?'包含 CSS 皮肤；':''}不复制角色卡、剧情消息、旧记忆或密钥；自动付费旧剧情整理不会继承授权，新剧情需单独确认开启。`;
}
// Standalone template editor: a template is an independently editable resource.
// It never reads the active session and never grants paid auto-summary consent.
function mimaTemplateChecked(ids, list, group){
    const selected=new Set(Array.isArray(ids)?ids:[]);
    const available=new Set(list.map(item=>item.id));
    const missing=[...selected].filter(id=>!available.has(id));
    return `<div class="mima-template-choice-grid">${list.length?list.map(item=>`<label class="mima-template-choice"><input type="checkbox" data-template-group="${group}" value="${escapeHtml(item.id)}" ${selected.has(item.id)?'checked':''}><span>${escapeHtml(item.name||item.id)}</span></label>`).join(''):'<p class="helper">资源库暂无条目，可先在相应设置页创建。</p>'}${missing.map(id=>`<label class="mima-template-choice"><input type="checkbox" data-template-group="${group}" value="${escapeHtml(id)}" checked><span>⚠ 资源缺失：${escapeHtml(id)}（保留引用，取消勾选才移除）</span></label>`).join('')}</div>`;
}
function selectedTemplateForEditor(){return settingTemplateCache.find(t=>t.id===selectedTemplateEditId)||null;}
function templateEditorValue(value){return escapeHtml(value===undefined||value===null?'':String(value));}
async function renderSettingTemplatesTab(box){
    const epoch=settingsRenderEpoch;
    box.innerHTML='<p class="helper">正在读取独立模板库…</p>';
    const res=await fetchStory('/setting-templates');
    if(settingsTab!=='templates'||epoch!==settingsRenderEpoch)return;
    if(!res.success||!Array.isArray(res.data)){
        box.innerHTML='<p role="alert">设置模板库读取失败，未把失败当作空模板。请关闭重试。</p>';return;
    }
    settingTemplateCache=res.data;
    const tpl=selectedTemplateForEditor();
    const cfg=tpl?.config||{};
    const ps=cfg.promptSettings||{};
    const oc=ps.outputContract||{};
    const renderCheck=(id,label,checked)=>`<label class="mima-template-choice"><input id="${id}" type="checkbox" ${checked?'checked':''}>${label}</label>`;
    box.innerHTML=`<section class="settings-section mima-template-editor">
      <h3>🗂️ 剧情设置模板</h3>
      <p class="helper">在这里独立创建、编辑并保存模板。**无需先打开其他剧情**。之后在「新建剧情」或「PNG 角色卡开局」选择挂载；不会携带旧 History、旧记忆、密钥或后台任务。</p>
      <div class="mima-template-chooser"><label class="form-label" for="tpl-edit-choice">选择要编辑的模板</label>
        <select id="tpl-edit-choice" class="field" onchange="chooseIndependentTemplate(this.value)"><option value="">＋ 全新空白模板</option>${settingTemplateCache.map(t=>`<option value="${escapeHtml(t.id)}" ${tpl?.id===t.id?'selected':''}>${t.isDefault?'★ ':''}${escapeHtml(t.name)}</option>`).join('')}</select></div>
      <div class="mima-template-actions"><button class="ghost-btn" onclick="chooseIndependentTemplate('')">＋ 创建空白模板</button><button class="ghost-btn" onclick="importCurrentSessionAsSettingTemplate()">从当前剧情复制配置</button><button class="ghost-btn" onclick="exportSettingTemplate()">导出模板</button><button class="ghost-btn" onclick="document.getElementById('setting-template-file-input').click()">导入模板</button>${tpl?'<button class="ghost-btn" onclick="copyIndependentTemplate()">复制当前模板</button><button class="ghost-btn" onclick="setIndependentTemplateDefault()">设为默认 / 取消默认</button>':''}</div>
      <label class="form-label" for="tpl-edit-name">模板名称</label><input id="tpl-edit-name" class="field" maxlength="120" value="${templateEditorValue(tpl?.name||'')}" placeholder="例如：我的通用长剧情">
      <details class="mima-template-section" open><summary>🧩 预设 · 多选挂载</summary>${mimaTemplateChecked(cfg.presetIds,presets,'presetIds')}</details>
      <details class="mima-template-section" open><summary>📚 世界书 · 多选挂载</summary>${mimaTemplateChecked(cfg.worldbookIds,worldbooks,'worldbookIds')}</details>
      <details class="mima-template-section" open><summary>🧬 正则包 · 多选挂载</summary>${mimaTemplateChecked(cfg.regexPackIds,regexPacks,'regexPackIds')}</details>
      <details class="mima-template-section" open><summary>🤍 用户面具与可选皮肤</summary>
       <div class="form-grid"><div><label class="form-label">用户面具</label><select id="tpl-edit-mask" class="field">${optionList(masks.filter(x=>x.type==='user'),cfg.loadedUserMaskId,'不挂载')}</select></div>
       <div><label class="form-label">CSS 皮肤</label><select id="tpl-edit-css" class="field">${optionList(cssPresets,cfg.customCssId,'不挂载')}</select></div></div>
       ${renderCheck('tpl-edit-css-on','启用选中的 CSS 皮肤',cfg.customCssEnabled!==false)}
      </details>
      <details class="mima-template-section" open><summary>🧠 长剧情 · 上下文设置</summary>
        ${renderCheck('tpl-edit-context-on','这个模板保存长剧情设置',!!cfg.promptSettings)}
        <div class="form-grid">
         <div><label class="form-label">最近 History 条数</label><input id="tpl-edit-recent" class="field" type="number" min="6" max="100000" step="1" value="${templateEditorValue(ps.recentMessageLimit??34)}"></div>
         <div><label class="form-label">世界书预算（字符）</label><input id="tpl-edit-worldbudget" class="field" type="number" min="1000" max="1000000" step="1" value="${templateEditorValue(ps.worldbookBudgetChars??16000)}"></div>
         <div><label class="form-label">自动整理触发阈值（条）</label><input id="tpl-edit-trigger" class="field" type="number" min="12" max="200" step="1" value="${templateEditorValue(ps.summaryTriggerMessages??28)}"></div>
         <div><label class="form-label">整理每次允许的最多请求数</label><input id="tpl-edit-maxrequests" class="field" type="number" min="1" max="20" step="1" value="${templateEditorValue(ps.autoRollingMaxRequests??1)}"></div>
        </div>
        <p class="helper">这里只保存阈值，不会替新剧情授权自动付费整理。完整原始 History 不删除；超过窗口时仍按已有预算合同处理。</p>
        ${renderCheck('tpl-edit-inject-rolling','注入已保存的滚动摘要',ps.injectSavedRolling!==false)}
        ${renderCheck('tpl-edit-pinned','注入固定事实',ps.pinnedFactsEnabled!==false)}
        <label class="form-label">历史 HTML 注入方式</label><select id="tpl-edit-historyhtml" class="field"><option value="semantic" ${ps.historyHtmlMode!=='raw'?'selected':''}>语义内容（节省历史 HTML 代码）</option><option value="raw" ${ps.historyHtmlMode==='raw'?'selected':''}>原始 HTML（保留历史代码）</option></select>
        <label class="form-label">本轮回复显示模式</label><select id="tpl-edit-render" class="field"><option value="text" ${cfg.renderMode!=='safe_html'?'selected':''}>普通文本 / Markdown</option><option value="safe_html" ${cfg.renderMode==='safe_html'?'selected':''}>Safe HTML（受限结构）</option></select>
        ${renderCheck('tpl-edit-require-html','要求模型输出 HTML 状态栏合同',oc.requireHtml===true)}
        ${renderCheck('tpl-edit-complete-html','允许代码补全缺失 HTML 外壳',oc.completeHtml===true)}
        <div class="form-grid"><div><label class="form-label">正文槽选择器</label><input id="tpl-edit-body" class="field" value="${templateEditorValue(oc.bodySelector)}" placeholder=".story-body"></div>
        <div><label class="form-label">状态栏选择器</label><input id="tpl-edit-status" class="field" value="${templateEditorValue(oc.statusSelector)}" placeholder=".status"></div>
        <div class="form-full"><label class="form-label">必须存在的元素选择器</label><input id="tpl-edit-required" class="field" value="${templateEditorValue(oc.requiredSelectors)}" placeholder=".story-body, .status"></div></div>
        <p class="helper">跨剧情不会复制上一轮的 HTML 样本消息 ID。需要参考模板时，开局后再明确绑定本剧情自己的 HTML 格式样本。</p>
       </details>
      <details class="mima-template-section"><summary>🗃️ 记忆注入开关（不含记忆数据）</summary>
        ${renderCheck('tpl-edit-memory-on','为新剧情带入记忆注入开关',!!cfg.memoryInject)}
        ${renderCheck('tpl-edit-memory-core','注入核心记忆',cfg.memoryInject?.injectCore!==false)}
        ${renderCheck('tpl-edit-memory-facts','注入事实记忆',cfg.memoryInject?.injectFacts!==false)}
      </details>
      <div class="mima-template-bottom"><button class="primary-btn" onclick="saveIndependentTemplate()">${tpl?'保存模板修改':'创建并保存模板'}</button>
      ${tpl?'<button class="danger-btn" onclick="deleteIndependentTemplate()">删除这份模板</button>':''}</div>
      <p id="tpl-edit-status-message" class="helper" role="status">${tpl?'正在编辑已保存模板（未点击保存不会改变原件）':'正在创建独立空白模板（尚未保存）'}</p>
     </section>`;
    templateEditorDirty=false;
    box.querySelector('.mima-template-editor')?.addEventListener('input',()=>{templateEditorDirty=true;});
    box.querySelector('.mima-template-editor')?.addEventListener('change',event=>{if(event.target?.id!=='tpl-edit-choice')templateEditorDirty=true;});
}
function chooseIndependentTemplate(id){if(templateEditorDirty&&!confirm('这个模板还没有保存，确定切换并放弃修改吗？')){qs('tpl-edit-choice').value=selectedTemplateEditId;return;}templateEditorDirty=false;selectedTemplateEditId=id||'';renderSettings();}
function templateEditorNumber(id,min,max){const raw=qs(id)?.value.trim()||'';const n=Number(raw);if(raw===''||!Number.isSafeInteger(n)||n<min||n>max)throw Error(`设置值无效：${qs(id)?.previousElementSibling?.textContent||id}（${min}～${max}）`);return n;}
function getIndependentTemplateConfig(){
    const keys=['presetIds','worldbookIds','regexPackIds'];
    const cfg=selectedTemplateForEditor()?.config?clone(selectedTemplateForEditor().config):{};
    for(const key of keys)cfg[key]=Array.from(document.querySelectorAll(`[data-template-group="${key}"]:checked`),x=>x.value);
    cfg.loadedUserMaskId=qs('tpl-edit-mask').value||null;
    cfg.customCssId=qs('tpl-edit-css').value||null;
    cfg.customCssEnabled=qs('tpl-edit-css-on').checked;
    if(qs('tpl-edit-context-on').checked){
      const ps={...(cfg.promptSettings||{})};
      ps.recentMessageLimit=templateEditorNumber('tpl-edit-recent',6,100000);
      ps.worldbookBudgetChars=templateEditorNumber('tpl-edit-worldbudget',1000,1000000);
      ps.summaryTriggerMessages=templateEditorNumber('tpl-edit-trigger',12,200);
      ps.autoRollingMaxRequests=templateEditorNumber('tpl-edit-maxrequests',1,20);
      ps.autoRollingEnabled=false;ps.summaryEnabled=false;
      ps.injectSavedRolling=qs('tpl-edit-inject-rolling').checked;
      ps.pinnedFactsEnabled=qs('tpl-edit-pinned').checked;
      ps.historyHtmlMode=qs('tpl-edit-historyhtml').value;
      cfg.renderMode=qs('tpl-edit-render').value;
      const require=qs('tpl-edit-require-html').checked,complete=qs('tpl-edit-complete-html').checked;
      if(require||complete)ps.outputContract={...(ps.outputContract||{}),requireHtml:require,completeHtml:complete,templateMessageId:'',bodySelector:qs('tpl-edit-body').value.trim(),statusSelector:qs('tpl-edit-status').value.trim(),requiredSelectors:qs('tpl-edit-required').value.trim()};
      else delete ps.outputContract;
      cfg.promptSettings=ps;
    }else{delete cfg.promptSettings;delete cfg.renderMode;}
    if(qs('tpl-edit-memory-on').checked)cfg.memoryInject={injectCore:qs('tpl-edit-memory-core').checked,injectFacts:qs('tpl-edit-memory-facts').checked};
    else delete cfg.memoryInject;
    return cfg;
}
async function saveIndependentTemplate(){
    const old=selectedTemplateForEditor();const name=qs('tpl-edit-name')?.value.trim();if(!name)return toast('请填写模板名称');
    try{
      const config=getIndependentTemplateConfig();
      const res=await fetchStory(old?`/setting-templates/${old.id}`:'/setting-templates',old?'PATCH':'POST',{name,config,...(old?{id:old.id,expectedRevision:old.revision}:{})});
      if(!res.success)throw Error(res.msg||'数据库未确认保存');
      selectedTemplateEditId=res.data.id;templateEditorDirty=false;
      await renderSettingTemplatesTab(qs('settings-content'));
      toast('模板已独立保存；新剧情选择它后才会挂载');
    }catch(e){toast('模板未保存：'+e.message);}
}
async function importCurrentSessionAsSettingTemplate(){
  if(!currentSessionId)return toast('当前没有可复制设置的剧情。可以直接编辑上面的空白模板。');
  const name=qs('tpl-edit-name')?.value.trim()||'当前剧情配置副本';
  if(!confirm('只把当前剧情的挂载配置复制为一份新模板，不复制 History、记忆内容、密钥或付费授权。继续吗？'))return;
  const include={presets:true,worldbooks:true,regex:true,context:true,userMask:true,css:true,memoryInject:true};
  const res=await fetchStory('/setting-templates','POST',{name,fromSessionId:currentSessionId,include});
  if(!res.success)return toast('无法复制设置：'+res.msg);
  selectedTemplateEditId=res.data.id;await renderSettingTemplatesTab(qs('settings-content'));toast('已建立当前配置副本；可在这里单独修改并保存');
}
async function copyIndependentTemplate(){const old=selectedTemplateForEditor();if(!old)return;
  const res=await fetchStory('/setting-templates','POST',{name:old.name+'（副本）',config:old.config});if(!res.success)return toast('复制失败：'+res.msg);selectedTemplateEditId=res.data.id;await renderSettingTemplatesTab(qs('settings-content'));toast('复制完成，原模板未修改');
}
async function setIndependentTemplateDefault(){const old=selectedTemplateForEditor();if(!old)return;
 const res=await fetchStory('/setting-templates/default','POST',{id:old.isDefault?'':old.id});if(!res.success)return toast('更新默认模板失败：'+res.msg);await renderSettingTemplatesTab(qs('settings-content'));toast(old.isDefault?'已取消默认模板':'已设置为默认模板');
}
async function deleteIndependentTemplate(){const old=selectedTemplateForEditor();if(!old||!confirm(`删除设置模板「${old.name}」？已创建的剧情不受影响。`))return;
 const res=await fetchStory(`/setting-templates/${old.id}`,'DELETE',{expectedRevision:old.revision});if(!res.success)return toast('删除失败：'+res.msg);selectedTemplateEditId='';await renderSettingTemplatesTab(qs('settings-content'));
}

function checkedTemplateScopes(){return {presets:qs('tpl-presets').checked,worldbooks:qs('tpl-worldbooks').checked,regex:qs('tpl-regex').checked,userMask:qs('tpl-user-mask').checked,context:qs('tpl-context').checked,memoryInject:qs('tpl-memory').checked,css:qs('tpl-css').checked};}
async function saveCurrentSettingTemplate(overwrite=false){
    // Backwards-compatible direct handler: the old new-session modal no longer
    // owns editable template controls; keep callers functional without throwing.
    if(!qs('tpl-name')){
      if(overwrite){
        const old=selectedTemplateForEditor();if(!old||!currentSessionId)return toast('请先选择已有模板和来源剧情');
        const include={presets:true,worldbooks:true,regex:true,context:true,userMask:true,css:true,memoryInject:true};
        const result=await fetchStory(`/setting-templates/${old.id}`,'PATCH',{id:old.id,name:old.name,expectedRevision:old.revision,fromSessionId:currentSessionId,include});
        if(!result.success)return toast('更新失败：'+result.msg);await renderSettingTemplatesTab(qs('settings-content'));return toast('模板已用当前剧情设置更新');
      }
      return importCurrentSessionAsSettingTemplate();
    }
    if(!currentSessionId)return toast('请先进入需要复制设置的剧情');
    const name=(qs('tpl-name')?.value||'').trim();if(!name)return toast('请填写模板名称');
    const old=settingTemplateCache.find(t=>t.id===qs('new-session-template')?.value);
    if(overwrite&&!old)return toast('请先选择要更新的模板');
    const body={name,fromSessionId:currentSessionId,include:checkedTemplateScopes(),...(overwrite?{id:old.id,expectedRevision:old.revision}:{})};
    const result=await fetchStory(overwrite?`/setting-templates/${old.id}`:'/setting-templates',overwrite?'PATCH':'POST',body);
    if(!result.success)return toast('保存模板失败：'+(result.msg||'未知错误'));
    await refreshSettingTemplateChoices();qs('new-session-template').value=result.data.id;renderSettingTemplatePreview();toast('设置模板已保存，不包含旧剧情、摘要、附件或密钥');
}
async function duplicateSettingTemplate(){
    const src=settingTemplateCache.find(t=>t.id===qs('new-session-template')?.value);if(!src)return toast('请选择模板');
    const res=await fetchStory('/setting-templates','POST',{name:src.name+' · 副本',config:src.config});
    if(!res.success)return toast('复制失败：'+res.msg);await refreshSettingTemplateChoices();qs('new-session-template').value=res.data.id;renderSettingTemplatePreview();
}
async function setDefaultSettingTemplate(){
    const id=qs('new-session-template')?.value||'';
    const res=await fetchStory('/setting-templates/default','POST',{id});
    if(!res.success)return toast('设置默认模板失败：'+res.msg);await refreshSettingTemplateChoices();toast(id?'已设置默认模板':'已关闭默认模板');
}
async function deleteSettingTemplate(){
    const old=settingTemplateCache.find(t=>t.id===qs('new-session-template')?.value);if(!old||!confirm('删除模板不会删除已创建的剧情。确定删除？'))return;
    const res=await fetchStory(`/setting-templates/${old.id}`,'DELETE',{expectedRevision:old.revision});
    if(!res.success)return toast('删除失败：'+res.msg);await refreshSettingTemplateChoices();
}
function exportSettingTemplate(){
    const old=settingsTab==='templates'?selectedTemplateForEditor():settingTemplateCache.find(t=>t.id===qs('new-session-template')?.value);if(!old)return toast('请先选模板');
    downloadJson(`咪嘛馆-剧情设置模板-${old.name}.json`,{format:'mima-session-settings-template',version:1,name:old.name,config:old.config});
}
async function importSettingTemplate(file){if(!file)return;try{
    const raw=JSON.parse(await file.text());if(raw.format!=='mima-session-settings-template'||raw.version!==1||!raw.config||typeof raw.config!=='object')throw Error('不是合法的设置模板');
    const res=await fetchStory('/setting-templates','POST',{name:raw.name,config:raw.config});
    if(!res.success)throw Error(res.msg);selectedTemplateEditId=res.data.id;if(settingsTab==='templates')await renderSettingTemplatesTab(qs('settings-content'));else{await refreshSettingTemplateChoices();qs('new-session-template').value=res.data.id;renderSettingTemplatePreview();}toast('设置模板已导入，资源在创建新剧情时再次校验');
}catch(e){toast('导入模板失败：'+e.message)}}

function closeNewSessionModal(){qs('new-session-modal').classList.add('hidden')}
function toggleDirector(){qs('director-wrap').classList.toggle('collapsed')}

async function loadAll() {
    const selectedAtStart=currentSessionId, navigationAtStart=sessionNavigationEpoch;
    const results=await Promise.all([fetchStory('/sessions'),fetchStory('/masks'),fetchStory('/presets'),fetchStory('/worldbooks'),fetchStory('/css-presets'),fetchStory('/regex-packs')]);
    const names=['sessions','masks','presets','worldbooks','css-presets','regex-packs'];
    // A failed read is NOT a verified empty collection. Keep the previous UI
    // references untouched; callers must see the failure, not an empty library.
    for(let i=0;i<results.length;i++){
        const result=results[i];
        if(!result?.success||!Array.isArray(result.data))
            throw new Error(`E_LIBRARY_READ_UNVERIFIED: ${names[i]} · ${result?.msg||'返回值无法验证'}`);
    }
    [sessions,masks,presets,worldbooks,cssPresets,regexPacks]=results.map(result=>result.data);
    renderSessions();
    // If the player switched sessions while these independent reads ran, no
    // stale loadAll continuation is allowed to navigate back to the old one.
    if(sessionNavigationEpoch!==navigationAtStart)return;
    if(selectedAtStart){
        if(sessions.some(x=>x.id===selectedAtStart)){
            const openingEpoch=sessionNavigationEpoch,opened=await openSession(selectedAtStart,false);
            // A failed GET is NOT a successfully loaded session. Only a newer
            // user navigation is allowed to supersede this particular read.
            if(!opened&&sessionNavigationEpoch===openingEpoch+1)
                throw new Error('E_LIBRARY_SELECTED_SESSION_UNVERIFIED: 当前剧情已列出，但读取详情失败；拒绝进入空白剧情界面');
        }else {currentSessionId=null;currentSessionData=null;sessionNavigationEpoch++;refreshHeader();refreshChatBox();}
    }
    if(!currentSessionId&&sessions.length){
        const openingEpoch=sessionNavigationEpoch,opened=await openSession(sessions[0].id,false);
        if(!opened&&sessionNavigationEpoch===openingEpoch+1)
            throw new Error('E_LIBRARY_DEFAULT_SESSION_UNVERIFIED: 剧情列表已读取，但首个剧情详情未确认；拒绝将空白视为成功');
    }
    applyCustomCss();
    if(isSettingsOpen())renderSettings();
}

function renderSessions() {
    const box=qs('session-list'); box.innerHTML='';
    if(!sessions.length){box.innerHTML='<div class="row-sub">还没有剧情。新建一个独立宇宙吧。</div>';return}
    sessions.forEach(s=>{
        const div=document.createElement('div'); div.className=`session-item ${s.id===currentSessionId?'active':''}`;div.setAttribute('role','button');div.tabIndex=0;
        div.innerHTML=`<div class="session-item-main"><div class="session-name">${escapeHtml(s.title)}</div><div class="session-meta">${escapeHtml(canonLabel(s.canonLevel||'alternate'))} · ${s.messageCount||0} 条 · 📚 ${(s.worldbookIds||[]).length}</div></div><div class="session-item-actions"><button class="session-mini-btn" onclick="event.stopPropagation();openSessionHistoryEditor('${s.id}')">编辑</button><button class="session-mini-btn danger" onclick="event.stopPropagation();deleteSessionFromHistory('${s.id}')">删除</button></div>`;
        div.onclick=()=>openSession(s.id,true);div.onkeydown=e=>{if(e.target===div&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openSession(s.id,true)}}; box.appendChild(div);
    });
}
async function createSession(){
    const title=qs('new-session-title').value.trim()||'未命名咪嘛宇宙';
    const mode=qs('new-session-mode').value||'tavern';
    const templateId=qs('new-session-template')?.value||'';
    const res=await fetchStory('/sessions','POST',{...(templateId?{settingTemplateId:templateId}:{}),title,mode,characterMode:mode,canonLevel:'alternate',enabledPersonaSources:{sandalphonPersona:mode==='sandalphon',userPersona:mode==='sandalphon',telegramContext:false,longTermMemory:false,sandalphonState:false},enabledContextSources:{storySummary:true,recentMessages:true,telegramContext:false,vectorMemory:false},promptSettings:{recentMessageLimit:34,worldbookBudgetChars:16000,summaryEnabled:true,pinnedFactsEnabled:true}});
    if(!res.success)return toast(res.msg||'创建失败');
    closeNewSessionModal(); qs('new-session-title').value=''; await loadAll(); await openSession(res.data.id,true); if(!templateId)openSettings('roles');
}
async function openSession(id, close=true){
    const epoch=++sessionNavigationEpoch;
    const res=await fetchStory(`/sessions/${id}`);
    if(epoch!==sessionNavigationEpoch)return null; // Later navigation owns the page.
    if(!res.success||res.data?.id!==id){toast(res.msg||'打开剧情失败：返回了不同的会话');return null;}
    const switched=currentSessionId!==id;
    if(switched)preserveComposerDraft(currentSessionId);
    currentSessionId=id;currentSessionData=res.data;
    window.MimaChatWallpaper?.onSession?.(id);
    if(close)closeDrawer();refreshHeader();refreshChatBox();
    if(switched){restoreComposerDraft(id);}else{preserveComposerDraft(id);}
    restoreGenerationView();
    applyCustomCss();renderSessions();if(isSettingsOpen())renderSettings();
    return res.data;
}
async function patchCurrent(patch, quiet=false){
    const targetSessionId=currentSessionId;
    if(!targetSessionId)return null;
    const res=await fetchStory(`/sessions/${targetSessionId}`,'PATCH',patch);
    if(!res.success||res.data?.id!==targetSessionId){toast(res.msg||'保存失败：会话数据不一致');return null;}
    if(targetSessionId===currentSessionId){
        currentSessionData=res.data;
        try{await refreshSessionSummaryList()}
        catch(e){console.error('会话变更已保存，但列表读取失败',{targetSessionId,error:e});toast('设置已保存，但会话列表刷新失败；未覆盖存档');}
        if(targetSessionId===currentSessionId){refreshHeader();applyCustomCss();if(!quiet&&isSettingsOpen())renderSettings();}
    }
    return res.data;
}
async function refreshSessionSummaryList(){
    const result=await fetchStory('/sessions');
    if(!result.success||!Array.isArray(result.data))throw new Error('E_SESSION_LIST_UNVERIFIED: '+(result.msg||'会话列表读取失败'));
    sessions=result.data;renderSessions();
}
async function deleteCurrentSession(){
    const targetSessionId=currentSessionId;
    if(!targetSessionId||!confirm('确定删除这个剧情 Session（剧情会话）？此操作不可撤销。'))return;
    const result=await fetchStory(`/sessions/${targetSessionId}`,'DELETE');
    if(!result.success)return toast(result.msg||'删除失败，原剧情仍保留');
    if(currentSessionId===targetSessionId){currentSessionId=null;currentSessionData=null;sessionNavigationEpoch++;closeSettings();}
    await loadAll();
}
function openSessionHistoryEditor(id){const old=sessions.find(x=>x.id===id);if(!old)return;editorState={type:'session-history',id,old};qs('editor-title').textContent='编辑历史剧情';qs('editor-eyebrow').textContent='STORY HISTORY（历史剧情）';qs('editor-body').innerHTML=`<label class="form-label">剧情标题</label><input id="session-history-title" class="field" value="${escapeHtml(old.title||'')}"><p class="helper">这里只修改剧情标题，不会改动剧情消息、角色、世界书、预设、正则或其他存档内容。</p>`;setupEditorButtons(()=>deleteSessionFromHistory(id),saveSessionHistoryEditor);qs('editor-modal').classList.remove('hidden')}
async function saveSessionHistoryEditor(){const id=editorState?.id;if(!id)return;const old=sessions.find(x=>x.id===id);const title=qs('session-history-title').value.trim()||old?.title||'未命名咪嘛宇宙';const res=await fetchStory(`/sessions/${id}`,'PATCH',{title});if(!res.success)return toast(res.msg||'剧情标题保存失败');closeEditor();await loadAll();toast('历史剧情标题已保存')}
async function deleteSessionFromHistory(id){const old=sessions.find(x=>x.id===id);if(!old)return;if(!confirm(`确定删除「${old.title||'未命名咪嘛宇宙'}」？\n\n这会删除该剧情会话与其中的消息，操作不可撤销；角色卡、世界书、预设、正则和 CSS 库不会一起删除。`))return;const res=await fetchStory(`/sessions/${id}`,'DELETE');if(!res.success)return toast(res.msg||'删除剧情失败');if(currentSessionId===id){currentSessionId=null;currentSessionData=null;}if(editorState?.type==='session-history'&&editorState.id===id)closeEditor();await loadAll();toast('历史剧情已删除')}
function exportCurrentSession(){if(currentSessionData)downloadJson(`${currentSessionData.title||'咪嘛馆剧情'}.mimamao-story.json`,currentSessionData)}
function exportStoryTranscript(kind='txt'){
    try{
        if(!currentSessionData)throw new Error('尚未打开剧情');
        const transcript=window.MimaStoryTranscriptExport.build(currentSessionData);
        if(!transcript.messages.length)throw new Error('当前剧情没有可导出的对话正文');
        const filename=(currentSessionData.title||'咪嘛馆剧情');
        if(kind==='txt')downloadText(`${filename}.纯剧情.txt`, '\uFEFF'+window.MimaStoryTranscriptExport.toText(transcript),'text/plain;charset=utf-8');
        else if(kind==='json')downloadJson(`${filename}.纯剧情.json`,transcript);
        else throw new Error('不支持的剧情导出格式');
    }catch(e){console.error('[StoryTranscriptExport] failed',e);toast('纯剧情导出失败：'+(e?.message||e));}
}
function chooseSessionImport(){qs('session-file-input').value='';qs('session-file-input').click()}
async function importSessionFile(file){if(!file)return;try{const raw=JSON.parse(await file.text());const source=raw.data||raw;const res=await fetchStory('/sessions/import','POST',source);if(!res.success)throw new Error(res.msg||'导入失败');await loadAll();await openSession(res.data.id,true);toast(`已导入剧情 ${res.data.title}`)}catch(e){toast(`剧情导入失败：${e.message}`)}}

function currentChar(){return masks.find(x=>x.id===currentSessionData?.loadedCharMaskId)||null}
function currentUser(){return masks.find(x=>x.id===currentSessionData?.loadedUserMaskId)||null}
function refreshHeader(){
    const char=currentChar(); qs('current-character').textContent=char?.name||(currentSessionData?.mode==='sandalphon'?'圣德芬':'未挂载角色');
    qs('current-title').textContent=currentSessionData?.title||'欢迎来到咪嘛馆';
    const av=qs('top-avatar'); av.innerHTML=''; if(char?.avatar){const img=document.createElement('img');img.src=char.avatar;img.onerror=()=>{av.textContent='🤍'};av.appendChild(img)}else av.textContent=char?'🤍':'🍷';
    const mountedBooks=(currentSessionData?.worldbookIds||[]).map(id=>worldbooks.find(w=>w.id===id)).filter(Boolean);
    const ribbon=qs('context-ribbon');
    if(currentSessionData&&(char||mountedBooks.length)){ribbon.classList.remove('hidden');ribbon.textContent=`独立宇宙 · ${char?`🤍 ${char.name}`:'未挂角色'}${mountedBooks.length?` · 📚 ${mountedBooks.map(w=>w.name).join(' / ')}`:''}`}
    else {ribbon.textContent='';ribbon.classList.add('hidden');}
    ribbon.setAttribute('role','button');ribbon.setAttribute('tabindex','0');
    ribbon.setAttribute('aria-label','点击收起或展开独立宇宙信息');ribbon.classList.toggle('mima-ribbon-collapsed',ribbon.dataset.collapsed==='true');
    ribbon.setAttribute('aria-expanded',String(ribbon.dataset.collapsed!=='true'));
    ribbon.onclick=e=>{if(e.target.closest('button'))return;toggleContextRibbon();};
    ribbon.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===ribbon){e.preventDefault();toggleContextRibbon();}};
    // Durable memory jobs are separate from Direct Reply. Never block chat
    // while reading review debt, and never treat a failed IDB read as empty.
    refreshMemoryDebtRibbon(currentSessionId).catch(e=>console.warn('Memory debt UI failed',{sessionId:currentSessionId,error:e.message}));
}
let memoryRibbonGeneration=0;
async function refreshMemoryDebtRibbon(sessionId){
    const generation=++memoryRibbonGeneration;if(!sessionId)return;
    let pending=[],loadError=null;
    try{
        const jobs=await Promise.all(['rolling','facts','core'].map(k=>MimaLocalStore.getMemoryJob(sessionId,k)));
        pending=jobs.filter(job=>job&&['needs_review','interrupted','failed','aborted'].includes(job.status));
    }catch(e){loadError=e;}
    if(generation!==memoryRibbonGeneration||sessionId!==currentSessionId)return;
    if(!loadError&&!pending.length)return;
    const ribbon=qs('context-ribbon');if(!ribbon)return;
    ribbon.classList.remove('hidden');
    const status=document.createElement('span');
    status.textContent=loadError?' · 剧情记忆状态无法读取，请检查任务记录。':` · 剧情记忆有 ${pending.length} 项失败或待恢复任务，原始剧情已保留。`;
    ribbon.appendChild(status);
    const open=document.createElement('button');open.type='button';open.className='tool-mini';open.textContent='查看记忆';
    open.addEventListener('click',()=>openSettings('memory'));ribbon.appendChild(open);
}

function toggleContextRibbon(){const ribbon=qs('context-ribbon');if(!ribbon)return;const collapsed=!(ribbon.dataset.collapsed==='true');ribbon.dataset.collapsed=collapsed?'true':'';ribbon.classList.toggle('mima-ribbon-collapsed',collapsed);ribbon.setAttribute('aria-expanded',String(!collapsed));}
let readingMode=false,readingScroll=0,readingLastTap=0,readingTouchStart=null,readingLastTapPoint=null;
function setImmersiveReading(on){
    const box=qs('story-chat-box');if(!box)return;
    if(on===readingMode)return;
    if(on){readingScroll=box.scrollTop;
        // Close iOS soft keyboard without changing or clearing the input draft.
        if(document.activeElement?.closest?.('.composer-shell'))document.activeElement.blur();
        readingMode=true;document.body.classList.add('mima-reading-mode');
        const hint=qs('mima-reading-hint');if(hint){hint.textContent='沉浸阅读中 · 双击屏幕恢复界面';hint.hidden=false;setTimeout(()=>{if(readingMode)hint.hidden=true;},2200);}
    }else{readingScroll=box.scrollTop;readingMode=false;document.body.classList.remove('mima-reading-mode');qs('mima-reading-hint').hidden=true;}
    requestAnimationFrame(()=>{box.scrollTop=readingScroll;});
}
function setupImmersiveReading(){
    const root=qs('story-chat-box');if(!root)return;
    root.addEventListener('dblclick',e=>{if(!readingMode||e.target.closest('a,button,input,textarea,select,[contenteditable]'))return;setImmersiveReading(false);});
    root.addEventListener('pointerdown',e=>{if(!readingMode||e.pointerType!=='touch')return;
        readingTouchStart={x:e.clientX,y:e.clientY,scrollTop:root.scrollTop,target:e.target};
    });
    root.addEventListener('pointercancel',()=>{readingTouchStart=null;readingLastTap=0;readingLastTapPoint=null;});
    root.addEventListener('pointerup',e=>{
        if(!readingMode||e.pointerType!=='touch')return;
        const start=readingTouchStart;readingTouchStart=null;
        const forbidden=e.target.closest('a,button,input,textarea,select,[contenteditable]')||window.getSelection()?.toString();
        if(!start||forbidden||Math.abs(e.clientX-start.x)>12||Math.abs(e.clientY-start.y)>12||Math.abs(root.scrollTop-start.scrollTop)>5){
            readingLastTap=0;readingLastTapPoint=null;return;
        }
        const now=performance.now();
        if(now-readingLastTap<320&&readingLastTapPoint&&Math.abs(e.clientX-readingLastTapPoint.x)<28&&Math.abs(e.clientY-readingLastTapPoint.y)<28){
            readingLastTap=0;readingLastTapPoint=null;setImmersiveReading(false);
        }else{readingLastTap=now;readingLastTapPoint={x:e.clientX,y:e.clientY};}
    });
}
function renderSettings(){
    const renderEpoch=++settingsRenderEpoch;
    qsa('.settings-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===settingsTab));
    syncAppearancePreviewMode(settingsTab==='appearance');
    const box=qs('settings-content');
    if(settingsTab==='png-resources'){renderPngResourcesTab(box);return;}
    if(settingsTab==='templates'){void renderSettingTemplatesTab(box);return;}
    if(!currentSessionData&&!['appearance','api','data','diagnostics','templates'].includes(settingsTab)){box.innerHTML='<div class="empty-state"><p>选择一种方式开始。</p><div class="toolbar"><button class="primary-btn" onclick="openNewSessionModal()">开始新剧情</button><button class="ghost-btn" onclick="MimaCompatUI.open()">🎴 玩酒馆角色卡</button></div></div>';return}
    if(settingsTab==='roles')renderRolesTab(box);
    else if(settingsTab==='worldbook')renderWorldbookTab(box);
    else if(settingsTab==='presets')renderPresetsTab(box);
    else if(settingsTab==='regex')renderRegexTab(box);
    else if(settingsTab==='context')renderContextTab(box);
    else if(settingsTab==='memory')renderMemoryTab(box);
    else if(settingsTab==='appearance')renderAppearanceTab(box,renderEpoch);
    else if(settingsTab==='api')renderApiTab(box);
    else if(settingsTab==='prompt')renderPromptTab(box);
    else if(settingsTab==='diagnostics')renderDiagnosticsTab(box);
    else if(settingsTab==='data')renderDataTab(box,renderEpoch);
}

function optionList(items, selected, placeholder){return `<option value="">${escapeHtml(placeholder)}</option>`+items.map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===selected?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}
function canonLabel(v){return({temporary:'temporary（临时）',alternate:'alternate（平行）',soft:'soft（软设定）',core:'core（核心）'}[v]||`${v||'alternate'}（设定层级）`)}
function presetTypeLabel(v){return({style:'style（风格）',format:'format（格式）',behavior:'behavior（行为）',model:'model（模型）'}[v]||`${v||'style'}（类型）`)}
function positionLabel(v){return({front:'front（前）',middle:'middle（中）',back:'back（后）'}[v]||`${v||'middle'}（位置）`)}
function renderRolesTab(box){
    const chars=masks.filter(m=>m.type!=='user'), users=masks.filter(m=>m.type==='user');
    box.innerHTML=`
      <section class="settings-section"><h3>当前挂载</h3><p class="helper">角色卡和 User Persona（用户人设）只作用于这个剧情 Session（剧情会话）；不同宇宙可以挂不同的人。</p>
      <div class="mount-row">
       <div class="mount-box"><label class="form-label">🤍 Character（角色）</label><select id="mount-char" class="field">${optionList(chars,currentSessionData.loadedCharMaskId,'不挂载角色卡')}</select></div>
       <div class="mount-box"><label class="form-label">👤 User Persona（用户人设）</label><select id="mount-user" class="field">${optionList(users,currentSessionData.loadedUserMaskId,'不挂载 User Persona（用户人设）')}</select></div>
      </div><div class="toolbar"><button class="primary-btn" onclick="saveRoleMounts()">应用挂载</button>${currentChar()?.firstMessage&&!(currentSessionData.messages||[]).length?'<button class="ghost-btn" onclick="insertCharacterOpening()">✦ 插入角色开场白</button>':''}</div></section>
      <section class="settings-section"><h3>角色卡库</h3><div class="toolbar"><button class="ghost-btn" onclick="openMaskEditor('character')">＋ 新建角色卡</button><button class="ghost-btn" onclick="choosePersonaImport('character')">⇧ 导入 PNG（角色卡） / TXT / JSON</button></div><div id="char-card-grid" class="card-grid"></div></section>
      <section class="settings-section"><h3>User Persona（用户人设）库</h3><div class="toolbar"><button class="ghost-btn" onclick="openMaskEditor('user')">＋ 新建 User Persona（用户人设）</button><button class="ghost-btn" onclick="choosePersonaImport('user')">⇧ 导入 TXT（文本） / JSON（数据）</button></div><div id="user-card-grid" class="card-grid"></div></section>`;
    renderMaskCards(qs('char-card-grid'),chars,'character'); renderMaskCards(qs('user-card-grid'),users,'user');
}
function renderMaskCards(root,items,type){root.innerHTML='';if(!items.length){root.innerHTML='<div class="row-sub">这里还是空的。</div>';return}items.forEach(m=>{const mounted=(type==='user'?currentSessionData.loadedUserMaskId:currentSessionData.loadedCharMaskId)===m.id;const div=document.createElement('div');div.className=`library-card ${mounted?'mounted':''}`;div.innerHTML=`<div class="card-title"><span>${escapeHtml(m.name)}</span>${mounted?'<span class="tag">已挂载</span>':''}</div><div class="card-desc">${escapeHtml(m.description||m.content||'暂无简介')}</div><div class="card-actions"><button class="ghost-btn" onclick="mountMask('${type}','${m.id}')">${mounted?'卸下':'挂载'}</button><button class="ghost-btn" onclick="openMaskEditor('${type}','${m.id}')">编辑</button><button class="ghost-btn" onclick="exportMask('${m.id}')">导出</button></div>`;root.appendChild(div)})}
async function saveRoleMounts(){await patchCurrent({loadedCharMaskId:qs('mount-char').value||null,loadedUserMaskId:qs('mount-user').value||null});refreshChatBox()}
async function mountMask(type,id){const key=type==='user'?'loadedUserMaskId':'loadedCharMaskId';const now=currentSessionData?.[key];await patchCurrent({[key]:now===id?null:id});refreshChatBox()}
async function insertCharacterOpening(){const c=currentChar();if(!c?.firstMessage)return;const res=await fetchStory(`/sessions/${currentSessionId}/opening`,'POST',{content:c.firstMessage});if(res.success){currentSessionData=res.data;closeSettings();refreshChatBox()}else toast(res.msg||'插入失败')}

function openMaskEditor(type,id=null){
    const old=id?masks.find(x=>x.id===id):null; editorState={type:'mask',maskType:type,id,old};
    qs('editor-title').textContent=id?`编辑 ${old?.name||'Persona（人设）'}`:(type==='user'?'新建 User Persona（用户人设）':'新建 Character Card（角色卡）'); qs('editor-eyebrow').textContent=type==='user'?'USER PERSONA（用户人设）':'CHARACTER CARD（角色卡）';
    const m=old||{name:'',description:'',content:'',scenario:'',firstMessage:'',exampleDialogue:'',creatorNotes:'',avatar:'',aliases:[],tags:[]};
    qs('editor-body').innerHTML=`<div class="form-grid">
      <div><label class="form-label">名称</label><input id="mask-name" class="field" value="${escapeHtml(m.name||'')}"></div>
      <div><label class="form-label">头像 URL（链接，可选）</label><input id="mask-avatar" class="field" value="${escapeHtml(m.avatar||'')}"></div>
      <div class="form-full"><label class="form-label">简介</label><textarea id="mask-description" class="field textarea">${escapeHtml(m.description||'')}</textarea></div>
      <div class="form-full"><label class="form-label">Persona（核心设定）</label><textarea id="mask-content" class="field textarea tall">${escapeHtml(m.content||'')}</textarea></div>
      ${type==='character'?`<div class="form-full"><label class="form-label">Scenario（场景设定）</label><textarea id="mask-scenario" class="field textarea">${escapeHtml(m.scenario||'')}</textarea></div><div class="form-full"><label class="form-label">First Message（开场白）</label><textarea id="mask-first" class="field textarea">${escapeHtml(m.firstMessage||'')}</textarea></div><div class="form-full"><label class="form-label">Example Dialogue（示例对话）</label><textarea id="mask-example" class="field textarea">${escapeHtml(m.exampleDialogue||'')}</textarea></div><div class="form-full"><label class="form-label">Creator Notes（创作者备注）</label><textarea id="mask-notes" class="field textarea">${escapeHtml(m.creatorNotes||'')}</textarea></div>`:''}
      <div><label class="form-label">Aliases（别名，逗号分隔）</label><input id="mask-aliases" class="field" value="${escapeHtml(arr(m.aliases).join(', '))}"></div>
      <div><label class="form-label">Tags（标签，逗号分隔）</label><input id="mask-tags" class="field" value="${escapeHtml(arr(m.tags).join(', '))}"></div></div>`;
    setupEditorButtons(id?()=>deleteMask(id):null,saveMaskEditor); qs('editor-modal').classList.remove('hidden');
}
async function saveMaskEditor(){const type=editorState.maskType;const body={type,name:qs('mask-name').value.trim()||'未命名 Persona',avatar:qs('mask-avatar').value.trim(),description:qs('mask-description').value,content:qs('mask-content').value,aliases:csv(qs('mask-aliases').value),tags:csv(qs('mask-tags').value)};if(type==='character')Object.assign(body,{scenario:qs('mask-scenario').value,firstMessage:qs('mask-first').value,exampleDialogue:qs('mask-example').value,creatorNotes:qs('mask-notes').value});const path=editorState.id?`/masks/${editorState.id}`:'/masks';const res=await fetchStory(path,editorState.id?'PATCH':'POST',body);if(res.success){closeEditor();await loadAll();openSettings('roles')}else toast(res.msg||'保存失败')}
async function deleteMask(id){if(!confirm('删除这张 Persona 卡？'))return;await fetchStory(`/masks/${id}`,'DELETE');if(currentSessionData?.loadedCharMaskId===id)await patchCurrent({loadedCharMaskId:null},true);if(currentSessionData?.loadedUserMaskId===id)await patchCurrent({loadedUserMaskId:null},true);closeEditor();await loadAll()}
function choosePersonaImport(type){pendingPersonaType=type;qs('persona-file-input').value='';qs('persona-file-input').click()}
async function importPersonaFile(file){
    if(!file)return;
    try{
        const extension=file.name.toLowerCase().split('.').pop();
        let data={}, warnings=[];
        if(extension==='png'){
            const card=await MimaPngCardImport.parse(file);
            let avatar='';
            try{avatar=await MimaPngCardImport.avatarDataUrl(card.imageBytes)}catch(e){warnings.push(`头像未保存：${e.message}`)}
            data=MimaPngCardImport.toMask(card,pendingPersonaType,file.name,avatar);
            if(card.extras.length)warnings.push(`此版本尚未自动导入这些扩展字段：${card.extras.join('、')}。原 PNG 请保留。`);
        }else if(extension==='json'){
            const raw=JSON.parse(await file.text()), d=raw.data||raw;
            const desc=d.description||'', personality=d.personality||d.persona||d.content||'';
            data={type:pendingPersonaType,name:d.name||file.name.replace(/\.json$/i,''),description:desc,content:personality,scenario:d.scenario||'',firstMessage:d.first_mes||d.firstMessage||'',exampleDialogue:d.mes_example||d.exampleDialogue||'',creatorNotes:d.creator_notes||d.creatorNotes||'',avatar:d.avatar||'',tags:d.tags||[],aliases:d.aliases||[],source:'import_json'};
            if(pendingPersonaType==='user')data.content=d.content||d.persona||data.content;
        }else if(extension==='txt'){
            data={type:pendingPersonaType,name:file.name.replace(/\.txt$/i,''),content:await file.text(),source:'import_txt'};
        }else throw new Error('不支持此文件格式。请选择 TXT、JSON 或 PNG 角色卡。');
        const res=await fetchStory('/masks','POST',data);
        if(!res.success)throw new Error(res.msg||'保存角色卡失败');
        await loadAll();openSettings('roles');toast(`已导入 ${res.data.name}`);
        if(warnings.length)alert(`角色卡「${res.data.name}」已导入，但请留意：\n${warnings.join('\n')}`);
    }catch(e){console.error('角色卡导入失败',e);toast(`角色卡导入失败：${e.message}`)}
}

// PNG Resource Inspector is a review-first import surface. A scan performs no writes.
// Unrecognized or semantically lossy metadata remains fully inspectable and exportable.
function playInspectedPngInCompat(){
    const file=pngResourceInspection?.file;
    if(!file)return toast('请先选择一张 PNG 角色卡。');
    if(typeof MimaCompatUI?.openWithFile!=='function')return toast('酒馆卡功能尚未准备好，请检查脚本是否加载。');
    closeSettings();MimaCompatUI.openWithFile(file).catch(e=>{console.error('Cross-entry handoff failed',e);toast('转入酒馆卡失败：'+e.message)});
}
function choosePngResourceInspection(){const field=qs('png-inspector-input');if(!field)return;field.value='';field.click();}
async function inspectPngResources(file){
    if(!file)return;
    if(pngResourceBusy)return toast('正在保存上次选择，请完成后再解析文件。');
    pngResourceInspection=null;
    try{
        const parsed=await MimaPngCardImport.inspect(file);
        const resources=MimaPngResourceInspector.discover(parsed);
        pngResourceInspection={parsed,resources,file};
        if(settingsTab==='png-resources'&&isSettingsOpen())renderPngResourcesTab(qs('settings-content'));
        toast(`已扫描 PNG：识别 ${resources.length} 个资源/元数据项目；目前尚未写入存档。`);
    }catch(e){console.error('PNG 资源检查失败',e);toast('PNG 资源检查失败：'+e.message)}
}
function pngResourceCategory(kind){return({character:'角色卡',worldbook:'世界书',preset:'提示词预设',css:'CSS 美化',regex:'正则包',metadata:'PNG 原始文本',unknown:'待人工处理'}[kind]||'原始内容')}
function renderPngResourcesTab(box){
    const info=pngResourceInspection;
    box.innerHTML=`<section class="settings-section"><h3>📦 PNG 资源检查器</h3><p class="helper">只读扫描 PNG 全部文本元数据。先查看资源，再选择保存到咪嘛馆资源库；“同时挂载到当前剧情”默认关闭。未知格式、特殊脚本和无法等价转换的世界书规则只开放查看/导出，不会自动执行或吞掉字段。</p><div class="toolbar"><button class="primary-btn" onclick="choosePngResourceInspection()" ${pngResourceBusy?'disabled':''}>⇧ 选择 PNG 角色卡</button></div>${info?`<p class="helper">文件：${escapeHtml(info.parsed.filename)} · ${info.parsed.metadata.length} 个文本元数据区块 · ${info.resources.length} 个可检查项目</p><button class="primary-btn" onclick="playInspectedPngInCompat()">🎴 用这张卡开始聊天（无需再上传）</button>`:'<p class="row-sub">请选择酒馆原始 PNG 角色卡。PNG 截图不会自动伪装成角色卡。</p><button class="ghost-btn" onclick="closeSettings();MimaCompatUI.open()">🎴 玩酒馆角色卡（PNG / JSON / CHARX）</button>'}</section>`;
    if(!info)return;
    const section=document.createElement('section');section.className='settings-section';
    section.innerHTML='<h3>识别结果 · 逐项选择</h3><p class="helper">只有能够等价转换的项目才可勾选。默认不勾选；重复保存同一资源会产生副本，请先检查列表。</p>';
    const list=document.createElement('div');list.className='entry-list';
    info.resources.forEach((resource,index)=>{
        const item=document.createElement('details');item.className='entry-card png-resource-card';
        const summary=document.createElement('summary');
        const title=document.createElement('strong');title.textContent=`${pngResourceCategory(resource.kind)} · ${resource.name}`;
        const loc=document.createElement('div');loc.className='entry-meta';loc.textContent=`路径：${resource.path} · ${resource.canImport?'支持安全导入':'仅检查和导出'}`;
        summary.append(title,loc);item.appendChild(summary);
        const body=document.createElement('div');body.className='png-resource-body';
        if(resource.warnings.length){const warn=document.createElement('p');warn.className='helper';warn.textContent='⚠ '+resource.warnings.join('；');body.appendChild(warn);}
        const buttons=document.createElement('div');buttons.className='toolbar';
        if(resource.canImport){
            const label=document.createElement('label');label.className='check-row';
            const cb=document.createElement('input');cb.type='checkbox';cb.checked=resource.selected&&!resource.imported;cb.disabled=!!resource.imported||pngResourceBusy;
            cb.addEventListener('change',()=>{resource.selected=cb.checked});
            label.append(cb,document.createTextNode(resource.imported?'已保存到资源库':'勾选导入此资源'));
            buttons.appendChild(label);
        }
        const exportButton=document.createElement('button');exportButton.className='ghost-btn';exportButton.type='button';exportButton.textContent='导出当前项目 JSON';
        exportButton.addEventListener('click',()=>downloadJson(`${resource.kind}-${index+1}.json`,{path:resource.path,source:resource.source,converted:resource.payload,warnings:resource.warnings}));
        buttons.appendChild(exportButton);body.appendChild(buttons);
        const pre=document.createElement('pre');pre.className='prompt-pre png-resource-raw';
        pre.textContent=typeof resource.source==='string'?resource.source:JSON.stringify(resource.source,null,2);
        const raw=document.createElement('details');const rawTitle=document.createElement('summary');rawTitle.textContent='完整内容查看 · 原始字段（仅显示，不执行）';raw.append(rawTitle,pre);body.appendChild(raw);
        item.appendChild(body);list.appendChild(item);
    });
    if(!info.resources.length){const empty=document.createElement('p');empty.className='row-sub';empty.textContent='PNG 中没有找到可识别的文本资源。';list.appendChild(empty)}
    section.appendChild(list);box.appendChild(section);
    const all=document.createElement('section');all.className='settings-section';
    const allDetails=document.createElement('details');allDetails.className='entry-card';
    const allSummary=document.createElement('summary');allSummary.textContent='完整内容查看 · PNG 解码数据（包括全部未知字段）';
    const allPre=document.createElement('pre');allPre.className='prompt-pre png-resource-raw';
    allDetails.append(allSummary,allPre);
    allDetails.addEventListener('toggle',()=>{
        if(allDetails.open&&!allPre.textContent){
            allPre.textContent=JSON.stringify({metadata:info.parsed.metadata,card:info.parsed.card?.raw||info.parsed.rawCard||null,cardError:info.parsed.cardError},null,2);
        }
    });
    all.appendChild(allDetails);box.appendChild(all);
    const actions=document.createElement('section');actions.className='settings-section';
    actions.innerHTML=`<h3>保存与挂载</h3><p class="helper">保存角色、世界书、预设和 CSS 时只创建新记录，不覆盖现有记录。勾选挂载后才修改当前剧情的资源引用。CSS 只挂载聊天范围，不会改全局主题；外来正则不自动启用。</p><label class="check-row"><input id="png-mount-current" type="checkbox" ${info.mountCurrent?'checked':''} ${pngResourceBusy?'disabled':''}> 保存成功后同时挂载当前剧情</label><div class="toolbar"><button class="primary-btn" id="png-save-selected" ${pngResourceBusy?'disabled':''} onclick="savePngSelectedResources()">保存选中的资源</button><button class="ghost-btn" onclick="exportPngInspection()">导出完整解析报告 JSON</button></div>`;
    box.appendChild(actions);
    qs('png-mount-current')?.addEventListener('change',e=>{if(pngResourceInspection)pngResourceInspection.mountCurrent=e.target.checked});
}
function exportPngInspection(){
    const info=pngResourceInspection;if(!info)return toast('请先检查一个 PNG。');
    // Preserve unrecognized data. Explicit export, never automatic writes.
    downloadJson(`${info.parsed.filename.replace(/\.png$/i,'')}-完整解码报告.json`,{
        filename:info.parsed.filename,metadata:info.parsed.metadata,
        card:info.parsed.card?.raw||info.parsed.rawCard||null,cardError:info.parsed.cardError,
        resources:info.resources.map(r=>({kind:r.kind,name:r.name,path:r.path,source:r.source,converted:r.payload,warnings:r.warnings}))
    });
}
async function savePngSelectedResources(){
    const info=pngResourceInspection;
    if(!info||pngResourceBusy)return;
    const chosen=info.resources.filter(r=>r.selected&&r.canImport&&!r.imported);
    if(!chosen.length)return toast('请先勾选可导入的项目。');
    const targetSessionId=currentSessionId;
    const mount=!!info.mountCurrent;
    if(mount&&['character','css'].some(kind=>chosen.filter(r=>r.kind===kind).length>1))return toast('同时挂载时只能选择一张角色卡和一份聊天 CSS；其他资源可单独保存。');
    if(mount&&!targetSessionId)return toast('没有打开的剧情，无法自动挂载；可以取消挂载仅保存资源。');
    if(mount&&!confirm('确定将选中的 PNG 资源保存并挂载到当前剧情？已有挂载不删除；CSS 将影响当前聊天显示。'))return;
    pngResourceBusy=true;renderPngResourcesTab(qs('settings-content'));
    const successes=[],failures=[],ids={worldbookIds:[],presetIds:[],regexPackIds:[]};
    let charId=null,cssId=null;
    for(const r of chosen){
        try{
            let endpoint='',payload=r.payload;
            if(r.kind==='character'){
                endpoint='/masks';let avatar='';
                try{avatar=await MimaPngCardImport.avatarDataUrl(r.payload.source.imageBytes)}catch(e){console.warn('PNG 头像缩略图失败',e)}
                payload=MimaPngCardImport.toMask(r.payload.source,'character',info.parsed.filename,avatar);
            }else if(r.kind==='worldbook')endpoint='/worldbooks';
            else if(r.kind==='preset')endpoint='/presets';
            else if(r.kind==='css')endpoint='/css-presets';
            else{failures.push(`${r.name}：没有安全适配器`);continue;}
            const result=await fetchStory(endpoint,'POST',payload);
            if(!result.success||!result.data?.id)throw new Error(result.msg||result.code||'资源保存失败');
            r.imported=true;r.selected=false;successes.push(r.name);
            if(r.kind==='character')charId=result.data.id;
            if(r.kind==='css')cssId=result.data.id;
            if(r.kind==='worldbook')ids.worldbookIds.push(result.data.id);
            if(r.kind==='preset')ids.presetIds.push(result.data.id);
        }catch(e){console.error('PNG 资源保存失败',{name:r.name,kind:r.kind,error:e});failures.push(`${r.name}：${e.message}`);break;}
    }
    if(mount&&successes.length){
        try{
            if(currentSessionId!==targetSessionId)throw new Error('当前剧情已切换；资源已保存在库中，但没有挂载。');
            const latest=await fetchStory(`/sessions/${targetSessionId}`);
            if(!latest.success)throw new Error(latest.msg||'读取最新剧情失败，资源保留在库中');
            const patch={};
            for(const key of ['worldbookIds','presetIds','regexPackIds'])if(ids[key].length)patch[key]=[...new Set([...(latest.data[key]||[]),...ids[key]])];
            if(charId)patch.loadedCharMaskId=charId;
            if(cssId){patch.customCssId=cssId;patch.customCssEnabled=true;}
            if(Object.keys(patch).length){
                const saved=await fetchStory(`/sessions/${targetSessionId}`,'PATCH',patch);
                if(!saved.success)throw new Error(saved.msg||'挂载失败');
                if(currentSessionId===targetSessionId)currentSessionData=saved.data;
            }
        }catch(e){failures.push(`自动挂载：${e.message}`)}
    }
    try{await loadAll();applyCustomCss()}catch(e){failures.push('界面刷新失败：'+e.message)}
    pngResourceBusy=false;
    if(settingsTab==='png-resources'&&isSettingsOpen())renderPngResourcesTab(qs('settings-content'));
    const msg=`资源导入：已保存 ${successes.length} 项${failures.length?`；${failures.length} 项失败或未挂载（详见提示）`:''}。`;
    toast(msg);
    if(failures.length)alert(`${msg}\n${failures.join('\n')}\n成功保存的资源未回滚，不会覆盖旧记录。`);
}

function exportMask(id){const m=masks.find(x=>x.id===id);if(m)downloadJson(`${m.name}.mimamao-persona.json`,m)}

// Presentation metadata only: never alters prompt inclusion or resource mounting.
const mimaLibraryView={presets:{search:'',category:'all',favorites:false},worldbook:{search:'',category:'all',favorites:false},css:{search:'',category:'all',favorites:false}};
function mimaLibraryToolbar(kind,items){const v=mimaLibraryView[kind],cats=[...new Set(items.map(x=>String(x.category||'未分类')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));
 const safe=x=>escapeHtml(x);
 return `<div class="mima-library-filters"><input class="field" aria-label="搜索资源" placeholder="搜索名称、标签和说明" value="${safe(v.search)}" oninput="mimaFilterLibrary('${kind}','search',this.value)"><select class="field" aria-label="资源分类" onchange="mimaFilterLibrary('${kind}','category',this.value)"><option value="all">全部分类</option>${cats.map(c=>`<option value="${safe(c)}" ${v.category===c?'selected':''}>${safe(c)}</option>`).join('')}</select><label class="check-row"><input type="checkbox" ${v.favorites?'checked':''} onchange="mimaFilterLibrary('${kind}','favorites',this.checked)"> ★ 只看收藏</label></div>`;
}
function mimaFilterLibrary(kind,key,value){if(!mimaLibraryView[kind])return;mimaLibraryView[kind][key]=value;
 const items=kind==='presets'?presets:kind==='worldbook'?worldbooks:cssPresets;
 const root=kind==='presets'?qs('preset-list'):kind==='worldbook'?qs('worldbook-list'):qs('css-preset-list');
 // Update just the visible list; do not reset the scroll position or its mounted state.
 if(kind==='presets')fillPresets(root);else if(kind==='worldbook')fillWorldbooks(root);else renderCssPresetLibrary(root);
}
function mimaVisibleResources(kind,items){const v=mimaLibraryView[kind],search=v.search.trim().toLocaleLowerCase();return items.filter(p=>(v.category==='all'||String(p.category||'未分类')===v.category)&&(!v.favorites||p.favorite)&&(!search||[p.name,p.description,p.category,(p.tags||[]).join(' ')].join(' ').toLocaleLowerCase().includes(search)));}
async function mimaToggleFavorite(kind,id){const records=kind==='presets'?presets:kind==='worldbook'?worldbooks:cssPresets;const item=records.find(p=>p.id===id);if(!item)return;
 const route=kind==='presets'?'presets':kind==='worldbook'?'worldbooks':'css-presets';const res=await fetchStory(`/${route}/${encodeURIComponent(id)}`,'PATCH',{favorite:!item.favorite});
 if(!res.success)return toast('收藏保存失败：'+(res.msg||res.code||'未知原因'));
 await loadAll();if(kind==='css')renderCssPresetLibrary(qs('css-preset-list'));else if(kind==='presets')fillPresets(qs('preset-list'));else fillWorldbooks(qs('worldbook-list'));
}
function renderWorldbookTab(box){
 box.innerHTML=`<section class="settings-section"><h3>📚 世界书</h3><p class="helper">收藏和分类仅影响资源库展示，不改变本剧情的世界书挂载与触发规则。</p><div class="toolbar"><button class="primary-btn" onclick="openWorldbookEditor()">＋ 新建世界书</button><button class="ghost-btn" onclick="chooseWorldbookImport()">⇧ 导入 JSON</button></div>${mimaLibraryToolbar('worldbook',worldbooks)}<div id="worldbook-list"></div></section>`;
 fillWorldbooks(qs('worldbook-list'));
}
function fillWorldbooks(root){if(!root)return;const mounted=new Set(currentSessionData.worldbookIds||[]);root.innerHTML='';const items=mimaVisibleResources('worldbook',worldbooks);if(!items.length){root.innerHTML='<div class="row-sub">当前筛选下没有世界书。</div>';return;}
 items.sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||String(a.name).localeCompare(String(b.name),'zh')).forEach(w=>{const row=document.createElement('div');row.className='worldbook-row';row.innerHTML=`<input type="checkbox" ${mounted.has(w.id)?'checked':''} onchange="toggleWorldbookMount('${w.id}',this.checked)"><div class="row-main"><div class="row-title">${escapeHtml(w.name)}</div><div class="row-sub">${escapeHtml(w.category||'未分类')} · ${w.entries?.length||0} 条 · ${escapeHtml(w.description||'无说明')}</div></div><button class="ghost-btn" title="收藏世界书" aria-label="${w.favorite?'取消收藏':'收藏'}" onclick="mimaToggleFavorite('worldbook','${w.id}')">${w.favorite?'★':'☆'}</button><button class="ghost-btn" onclick="openWorldbookEditor('${w.id}')">编辑</button><button class="ghost-btn" onclick="exportWorldbook('${w.id}')">导出</button>`;root.appendChild(row);});
}
async function toggleWorldbookMount(id,on){const set=new Set(currentSessionData.worldbookIds||[]);on?set.add(id):set.delete(id);await patchCurrent({worldbookIds:[...set]},true);refreshHeader();renderSettings()}
function defaultEntry(){return {name:'新条目',content:'',keywords:[],secondaryKeywords:[],enabled:true,alwaysActive:false,matchMode:'any',caseSensitive:false,useRegex:false,priority:50,scanDepth:12,depth:0,position:'middle',maxChars:0}}
function openWorldbookEditor(id=null){const old=id?worldbooks.find(x=>x.id===id):null;editorState={type:'worldbook',id,draft:clone(old||{name:'新世界书',description:'',tags:[],enabled:true,entries:[]})};qs('editor-title').textContent=id?`编辑世界书 · ${old.name}`:'新建世界书';qs('editor-eyebrow').textContent='WORLDBOOK（世界书）';renderWorldbookEditorBody();setupEditorButtons(id?()=>deleteWorldbook(id):null,saveWorldbookEditor);qs('editor-modal').classList.remove('hidden')}
function renderWorldbookEditorBody(){const w=editorState.draft;qs('editor-body').innerHTML=`<div class="form-grid"><div><label class="form-label">世界书名称</label><input id="wb-name" class="field" value="${escapeHtml(w.name||'')}"></div><div><label class="form-label">分类（自定义文件夹名）</label><input id="wb-category" class="field" value="${escapeHtml(w.category||'未分类')}"></div><div><label class="form-label">Tags（标签）</label><input id="wb-tags" class="field" value="${escapeHtml(arr(w.tags).join(', '))}"></div><div class="form-full"><label class="form-label">说明</label><textarea id="wb-desc" class="field textarea">${escapeHtml(w.description||'')}</textarea></div></div><div class="toolbar" style="margin-top:14px"><button class="ghost-btn" onclick="addWorldbookEntry()">＋ 新增条目</button></div><div id="wb-entry-list" class="entry-list"></div>`;const root=qs('wb-entry-list');(w.entries||[]).forEach((e,i)=>{const d=document.createElement('details');d.className='entry-card';d.open=(w.entries.length<=3);d.dataset.entryIndex=i;d.innerHTML=`<summary><strong>${escapeHtml(e.name||`条目 ${i+1}`)}</strong><div class="entry-meta">Depth（深度） ${e.depth??0} · ${escapeHtml(positionLabel(e.position||'middle'))} · priority（优先级） ${e.priority??50}${e.alwaysActive?' · Always（常驻）':''}</div></summary><div class="form-grid" style="margin-top:10px">
<div><label class="form-label">条目名称</label><input data-f="name" class="field" value="${escapeHtml(e.name||'')}"></div><div><label class="form-label">主关键词（逗号分隔）</label><input data-f="keywords" class="field" value="${escapeHtml(arr(e.keywords).join(', '))}"></div><div><label class="form-label">次关键词（可选）</label><input data-f="secondaryKeywords" class="field" value="${escapeHtml(arr(e.secondaryKeywords).join(', '))}"></div><div><label class="form-label">匹配</label><select data-f="matchMode" class="field"><option value="any" ${e.matchMode!=='all'?'selected':''}>任一关键词</option><option value="all" ${e.matchMode==='all'?'selected':''}>全部关键词</option></select></div>
<div><label class="form-label">Depth（深度，0=系统提示区段；世界书仍属于剧情资料，不获得系统权限）</label><input data-f="depth" class="field" type="number" min="0" max="200" step="1" value="${Number(e.depth??0)}"></div><div><label class="form-label">注入位置</label><select data-f="position" class="field"><option value="front" ${e.position==='front'?'selected':''}>前</option><option value="middle" ${e.position==='middle'?'selected':''}>中</option><option value="back" ${e.position==='back'?'selected':''}>后</option></select></div><div><label class="form-label">Priority（优先级，小值优先）</label><input data-f="priority" class="field" type="number" value="${Number(e.priority??50)}"></div><div><label class="form-label">扫描最近消息数</label><input data-f="scanDepth" class="field" type="number" min="1" max="200" step="1" value="${Number(e.scanDepth||12)}"></div><div><label class="form-label">条目最大字符（0=不限）</label><input data-f="maxChars" class="field" type="number" min="0" max="100000" step="1" value="${Number(e.maxChars||0)}"></div>
<div class="form-full"><label class="check-row"><input data-f="enabled" type="checkbox" ${e.enabled!==false?'checked':''}> 启用</label><label class="check-row"><input data-f="alwaysActive" type="checkbox" ${e.alwaysActive?'checked':''}> Always Active（始终激活）</label><label class="check-row"><input data-f="caseSensitive" type="checkbox" ${e.caseSensitive?'checked':''}> 大小写敏感</label><label class="check-row"><input data-f="useRegex" type="checkbox" ${e.useRegex?'checked':''}> Regex（正则）关键词</label></div><div class="form-full"><label class="form-label">注入内容</label><textarea data-f="content" class="field textarea tall">${escapeHtml(e.content||'')}</textarea></div><div class="form-full"><button class="danger-btn" onclick="removeWorldbookEntry(${i})">删除此条目</button></div></div>`;root.appendChild(d)})}
function captureWorldbookDraft(){if(!editorState||editorState.type!=='worldbook')return;const w=editorState.draft;w.name=qs('wb-name')?.value||w.name;w.description=qs('wb-desc')?.value||'';w.tags=csv(qs('wb-tags')?.value||'');w.category=(qs('wb-category')?.value||'未分类').trim().slice(0,60);w.entries=qsa('[data-entry-index]',qs('wb-entry-list')).map(block=>{const get=f=>block.querySelector(`[data-f="${f}"]`);return {id:w.entries[Number(block.dataset.entryIndex)]?.id,name:get('name').value,keywords:csv(get('keywords').value),secondaryKeywords:csv(get('secondaryKeywords').value),matchMode:get('matchMode').value,depth:Number(get('depth').value||0),position:get('position').value,priority:Number(get('priority').value === '' ? 50 : get('priority').value),scanDepth:Number(get('scanDepth').value||12),maxChars:Number(get('maxChars').value||0),enabled:get('enabled').checked,alwaysActive:get('alwaysActive').checked,caseSensitive:get('caseSensitive').checked,useRegex:get('useRegex').checked,content:get('content').value}})}
function addWorldbookEntry(){captureWorldbookDraft();editorState.draft.entries.push(defaultEntry());renderWorldbookEditorBody()}
function removeWorldbookEntry(i){captureWorldbookDraft();editorState.draft.entries.splice(i,1);renderWorldbookEditorBody()}
async function saveWorldbookEditor(){
    captureWorldbookDraft();
    // UI and normalizeWorldbookEntry must agree. Reject lossy normalization
    // rather than claiming to save a value the runtime actually clamps.
    for(const [i,e] of arr(editorState.draft.entries).entries()){
        for(const [key,min,max] of [['depth',0,200],['scanDepth',1,200],['maxChars',0,100000]]){
            if(!Number.isInteger(e[key])||e[key]<min||e[key]>max){
                toast(`世界书条目 ${i+1} 的 ${key} 必须是 ${min}～${max} 的整数，未保存`);return null;
            }
        }
        if(!Number.isFinite(e.priority)){
            toast(`世界书条目 ${i+1} 的优先级不是合法数字，未保存`);return null;
        }
    }
    const res=await fetchStory(editorState.id?`/worldbooks/${editorState.id}`:'/worldbooks',editorState.id?'PATCH':'POST',editorState.draft);
    if(!res.success){toast(res.msg||'保存失败');return null;}
    if(arr(res.data?.entries).length!==arr(editorState.draft.entries).length||
       arr(editorState.draft.entries).some((e,i)=>['depth','scanDepth','maxChars','priority'].some(k=>res.data.entries[i]?.[k]!==e[k]))){
        toast('世界书存档返回的条目设置与输入不一致，请检查设置范围');return null;
    }
    closeEditor();await loadAll();openSettings('worldbook');return res.data;
}
async function deleteWorldbook(id){if(!confirm('删除整个世界书？'))return;await fetchStory(`/worldbooks/${id}`,'DELETE');closeEditor();await loadAll();openSettings('worldbook')}
function chooseWorldbookImport(){qs('worldbook-file-input').value='';qs('worldbook-file-input').click()}
function normalizeImportedWorldbook(raw,name){const src=raw.data||raw;let rawEntries=src.entries||[];if(!Array.isArray(rawEntries)&&rawEntries&&typeof rawEntries==='object')rawEntries=Object.values(rawEntries);const entries=arr(rawEntries).map((e,i)=>({name:e.name||e.comment||`条目 ${i+1}`,content:e.content||'',keywords:e.keywords||e.key||e.keys||[],secondaryKeywords:e.secondaryKeywords||e.keysecondary||[],enabled:e.enabled!==false&&e.disable!==true,alwaysActive:!!(e.alwaysActive||e.constant),matchMode:e.matchMode||'any',caseSensitive:!!e.caseSensitive,useRegex:!!e.useRegex,priority:Number(e.priority??e.order??50),scanDepth:Number(e.scanDepth??12),depth:Number(e.depth??0),position:['front','middle','back'].includes(e.position)?e.position:'middle',maxChars:Number(e.maxChars||0)}));return {name:src.name||name||'导入世界书',description:src.description||'',tags:src.tags||[],entries}}
async function importWorldbookFile(file){if(!file)return;try{const raw=JSON.parse(await file.text());const body=normalizeImportedWorldbook(raw,file.name.replace(/\.json$/i,''));const res=await fetchStory('/worldbooks','POST',body);if(!res.success)throw new Error(res.msg);await loadAll();openSettings('worldbook');toast(`已导入世界书 ${res.data.name}`)}catch(e){toast(`世界书导入失败：${e.message}`)}}
function exportWorldbook(id){const w=worldbooks.find(x=>x.id===id);if(w)downloadJson(`${w.name}.mimamao-worldbook.json`,w)}

function renderPresetsTab(box){
 const active=new Set(arr(currentSessionData.presetIds));box.innerHTML=`<section class="settings-section"><h3>🧩 原生剧情预设</h3><p class="helper">分类与收藏仅用于整理资源库，不改变优先级、启用状态或实际 Prompt 顺序。本剧情已挂载 ${active.size} 项。</p><div class="toolbar"><button class="primary-btn" onclick="openPresetEditor()">＋ 新建预设</button><button class="ghost-btn" onclick="MimaAssistantStudio.open('preset')">✦ 预设助手</button></div>${mimaLibraryToolbar('presets',presets)}<div id="preset-list"></div></section>`;
 fillPresets(qs('preset-list'));
}
function fillPresets(root){if(!root)return;root.innerHTML='';const active=new Set(arr(currentSessionData.presetIds)),mountIndex=new Map(arr(currentSessionData.presetIds).map((id,i)=>[id,i]));
 const ordered=mimaVisibleResources('presets',presets).sort((a,b)=>Number(a.priority??50)-Number(b.priority??50)||(mountIndex.get(a.id)??Number.MAX_SAFE_INTEGER)-(mountIndex.get(b.id)??Number.MAX_SAFE_INTEGER));
 if(!ordered.length){root.innerHTML='<div class="row-sub">当前筛选下没有预设。</div>';return;}
 ordered.forEach(p=>{const r=document.createElement('div');r.className='preset-row';r.innerHTML=`<input type="checkbox" ${active.has(p.id)?'checked':''} onchange="togglePreset('${p.id}',this.checked)"><div class="row-main"><div class="row-title">${escapeHtml(p.name)}</div><div class="row-sub">${escapeHtml(p.category||'未分类')} · ${escapeHtml(presetTypeLabel(p.type||'style'))} · priority ${p.priority??50}</div></div><button class="ghost-btn" title="收藏预设" onclick="mimaToggleFavorite('presets','${p.id}')">${p.favorite?'★':'☆'}</button><button class="ghost-btn" onclick="openPresetEditor('${p.id}')">编辑</button>`;root.appendChild(r);});
}
async function togglePreset(id,on){const set=new Set(currentSessionData.presetIds||[]);on?set.add(id):set.delete(id);await patchCurrent({presetIds:[...set]},true);renderSettings()}
function openPresetEditor(id=null){const p=id?presets.find(x=>x.id===id):{name:'',type:'style',description:'',content:'',priority:50};editorState={type:'preset',id};qs('editor-title').textContent=id?`编辑预设 · ${p.name}`:'新建预设';qs('editor-eyebrow').textContent='PRESET（预设）';qs('editor-body').innerHTML=`<div class="form-grid"><div><label class="form-label">名称</label><input id="pre-name" class="field" value="${escapeHtml(p.name||'')}"></div><div><label class="form-label">类型</label><select id="pre-type" class="field">${['style','format','behavior','model'].map(x=>`<option value="${x}" ${p.type===x?'selected':''}>${presetTypeLabel(x)}</option>`).join('')}</select></div><div><label class="form-label">Priority（发送顺序，小值先发）</label><input id="pre-priority" type="number" class="field" value="${Number(p.priority??50)}"></div><div><label class="form-label">分类</label><input id="pre-category" class="field" value="${escapeHtml(p.category||'未分类')}"></div><div class="form-full"><label class="form-label">说明</label><input id="pre-desc" class="field" value="${escapeHtml(p.description||'')}"></div><div class="form-full"><label class="form-label">内容</label><textarea id="pre-content" class="field textarea tall">${escapeHtml(p.content||'')}</textarea></div></div>`;setupEditorButtons(id?()=>deletePreset(id):null,savePresetEditor);qs('editor-modal').classList.remove('hidden')}
async function savePresetEditor(){const body={name:qs('pre-name').value||'未命名预设',type:qs('pre-type').value,priority:Number(qs('pre-priority').value === '' ? 50 : qs('pre-priority').value),description:qs('pre-desc').value,category:(qs('pre-category').value||'未分类').trim().slice(0,60),content:qs('pre-content').value};const res=await fetchStory(editorState.id?`/presets/${editorState.id}`:'/presets',editorState.id?'PATCH':'POST',body);if(res.success){closeEditor();await loadAll();openSettings('presets')}else toast(res.msg||'保存失败')}
async function deletePreset(id){if(!confirm('删除这个预设？'))return;await fetchStory(`/presets/${id}`,'DELETE');closeEditor();await loadAll();openSettings('presets')}


function regexPhaseLabel(v){return({display:'显示渲染（推荐 / 省 Token）',prompt:'Prompt 注入前',input:'User 发送前',output:'Assistant 保存前'}[v]||v||'display')}
function defaultRegexRule(){return {name:'新规则',pattern:'',replacement:'',flags:'g',phase:'display',priority:50,enabled:true,description:''}}
function renderRegexTab(box){
    const active=new Set(currentSessionData.regexPackIds||[]);
    box.innerHTML=`<section class="settings-section"><h3>🧬 Regex（正则）</h3><p class="helper">正则包是独立 DLC：不会替换旧预设/世界书。最推荐使用 <strong>显示渲染</strong> 阶段——模型只输出短标签，咪嘛馆在前端把它展开成完整 HTML，从而减少上下文里的长 div 代码。Prompt / User / Assistant 保存前阶段也可用，但请只在明确需要时开启。</p><div class="toolbar"><button class="primary-btn" onclick="openRegexPackEditor()">＋ 新建正则包</button><button class="ghost-btn" onclick="chooseRegexImport()">⇧ 导入正则包</button><button class="ghost-btn" onclick="MimaAssistantStudio.open('regex')">✦ 打开正则助手</button></div><div id="regex-pack-list"></div></section>`;
    const root=qs('regex-pack-list');if(!regexPacks.length){root.innerHTML='<div class="row-sub">还没有正则包。可以手工新建，也可以让正则助手从 HTML 输出规范一键生成。</div>';return}
    regexPacks.slice().sort((a,b)=>Number(a.priority??50)-Number(b.priority??50)).forEach(pack=>{const row=document.createElement('div');row.className='preset-row regex-pack-row';row.innerHTML=`<input type="checkbox" ${active.has(pack.id)?'checked':''} onchange="toggleRegexPack('${pack.id}',this.checked)"><div class="row-main"><div class="row-title">${escapeHtml(pack.name)}</div><div class="row-sub">${arr(pack.rules).length} 条规则 · priority ${Number(pack.priority??50)} · ${escapeHtml(pack.description||'无说明')}</div></div><button class="ghost-btn" onclick="openRegexPackEditor('${pack.id}')">编辑</button><button class="ghost-btn" onclick="exportRegexPack('${pack.id}')">导出</button>`;root.appendChild(row)})
}
async function toggleRegexPack(id,on){const set=new Set(currentSessionData.regexPackIds||[]);on?set.add(id):set.delete(id);await patchCurrent({regexPackIds:[...set]},true);refreshChatBox();renderSettings()}
function openRegexPackEditor(id=null){const old=id?regexPacks.find(x=>x.id===id):null;editorState={type:'regex-pack',id,draft:clone(old||{name:'新正则包',description:'',priority:50,enabled:true,rules:[]})};qs('editor-title').textContent=id?`编辑正则 · ${old?.name||''}`:'新建 Regex 正则包';qs('editor-eyebrow').textContent='REGEX PACK（正则包）';renderRegexPackEditorBody();setupEditorButtons(id?()=>deleteRegexPack(id):null,saveRegexPackEditor);qs('editor-modal').classList.remove('hidden')}
function renderRegexPackEditorBody(){const p=editorState.draft;qs('editor-body').innerHTML=`<div class="form-grid"><div><label class="form-label">名称</label><input id="regex-name" class="field" value="${escapeHtml(p.name||'')}"></div><div><label class="form-label">Priority（优先级）</label><input id="regex-priority" class="field" type="number" value="${Number(p.priority??50)}"></div><div class="form-full"><label class="form-label">说明</label><input id="regex-desc" class="field" value="${escapeHtml(p.description||'')}"></div></div><div class="toolbar" style="margin-top:14px"><button class="ghost-btn" onclick="addRegexRule()">＋ 新增规则</button><button class="ghost-btn" onclick="MimaAssistantStudio.open('regex')">✦ 交给正则助手</button></div><div id="regex-rule-list" class="entry-list"></div><section class="regex-tester"><h4>即时测试</h4><textarea id="regex-test-input" class="field textarea" placeholder="粘贴一段模型原始输出进行测试"></textarea><div class="toolbar"><button class="ghost-btn" onclick="testRegexDraft()">运行当前草稿</button></div><pre id="regex-test-output" class="prompt-pre">测试结果会显示在这里。</pre></section>`;const root=qs('regex-rule-list');arr(p.rules).forEach((rule,i)=>{const d=document.createElement('details');d.className='entry-card regex-rule-card';d.open=arr(p.rules).length<=3;d.dataset.regexIndex=i;d.innerHTML=`<summary><strong>${escapeHtml(rule.name||`规则 ${i+1}`)}</strong><div class="entry-meta">${escapeHtml(regexPhaseLabel(rule.phase))} · /${escapeHtml(rule.flags||'g')} · priority ${Number(rule.priority??50)}</div></summary><div class="form-grid" style="margin-top:10px"><div><label class="form-label">规则名称</label><input data-rf="name" class="field" value="${escapeHtml(rule.name||'')}"></div><div><label class="form-label">Phase（阶段）</label><select data-rf="phase" class="field">${['display','prompt','input','output'].map(x=>`<option value="${x}" ${rule.phase===x?'selected':''}>${regexPhaseLabel(x)}</option>`).join('')}</select></div><div><label class="form-label">Flags（标志）</label><input data-rf="flags" class="field" value="${escapeHtml(rule.flags||'g')}" placeholder="gimsu"></div><div><label class="form-label">Priority</label><input data-rf="priority" class="field" type="number" value="${Number(rule.priority??50)}"></div><div class="form-full"><label class="form-label">Pattern（匹配式）</label><textarea data-rf="pattern" class="field textarea mono" spellcheck="false">${escapeHtml(rule.pattern||'')}</textarea></div><div class="form-full"><label class="form-label">Replacement（替换内容，可包含 $1 / $2）</label><textarea data-rf="replacement" class="field textarea tall mono" spellcheck="false">${escapeHtml(rule.replacement||'')}</textarea></div><div class="form-full"><label class="form-label">说明</label><input data-rf="description" class="field" value="${escapeHtml(rule.description||'')}"><label class="check-row"><input data-rf="enabled" type="checkbox" ${rule.enabled!==false?'checked':''}> 启用规则</label><button class="danger-btn" onclick="removeRegexRule(${i})">删除此规则</button></div></div>`;root.appendChild(d)});if(!arr(p.rules).length)root.innerHTML='<div class="row-sub">还没有规则。显示渲染规则最适合“短标签 → 长 HTML 状态栏”。</div>'}
function captureRegexDraft(){if(!editorState||editorState.type!=='regex-pack')return;const p=editorState.draft;p.name=qs('regex-name')?.value||p.name;p.priority=Number(qs('regex-priority')?.value === '' ? 50 : (qs('regex-priority')?.value ?? 50));p.description=qs('regex-desc')?.value||'';p.rules=qsa('[data-regex-index]',qs('regex-rule-list')).map(block=>{const get=f=>block.querySelector(`[data-rf="${f}"]`),old=p.rules[Number(block.dataset.regexIndex)]||{};return{id:old.id,name:get('name').value,phase:get('phase').value,flags:get('flags').value||'g',priority:Number(get('priority').value === '' ? 50 : get('priority').value),pattern:get('pattern').value,replacement:get('replacement').value,description:get('description').value,enabled:get('enabled').checked}})}
function addRegexRule(){captureRegexDraft();editorState.draft.rules.push(defaultRegexRule());renderRegexPackEditorBody()}
function removeRegexRule(i){captureRegexDraft();editorState.draft.rules.splice(i,1);renderRegexPackEditorBody()}
function testRegexDraft(){captureRegexDraft();const result=MimaRegexEngine.validatePack(editorState.draft);const out=qs('regex-test-output');if(!result.ok){out.textContent='❌ '+result.invalid.map(x=>`${x.name}: ${x.error}`).join('\n');return}const input=qs('regex-test-input')?.value||'';out.textContent=MimaRegexEngine.apply(input,[result.pack],'display')}
async function saveRegexPackEditor(){captureRegexDraft();const checked=MimaRegexEngine.validatePack(editorState.draft);if(!checked.ok){toast(`正则无效：${checked.invalid[0]?.name||''} · ${checked.invalid[0]?.error||''}`);return}const res=await fetchStory(editorState.id?`/regex-packs/${editorState.id}`:'/regex-packs',editorState.id?'PATCH':'POST',checked.pack);if(res.success){closeEditor();await loadAll();openSettings('regex')}else toast(res.msg||'保存失败')}
async function deleteRegexPack(id){if(!confirm('删除这个正则包？旧剧情原文不会被删除。'))return;await fetchStory(`/regex-packs/${id}`,'DELETE');closeEditor();await loadAll();openSettings('regex')}
function chooseRegexImport(){qs('regex-file-input').value='';qs('regex-file-input').click()}
async function importRegexFile(file){if(!file)return;try{const raw=JSON.parse(await file.text()),src=raw.data||raw;const checked=MimaRegexEngine.validatePack(src);if(!checked.ok)throw new Error(checked.invalid.map(x=>`${x.name}: ${x.error}`).join('；'));const res=await fetchStory('/regex-packs','POST',{...checked.pack,id:undefined,name:checked.pack.name||file.name.replace(/\.json$/i,'')});if(!res.success)throw new Error(res.msg||'导入失败');await loadAll();openSettings('regex');toast(`已导入正则包 ${res.data.name}`)}catch(e){toast(`正则包导入失败：${e.message}`)}}
function exportRegexPack(id){const p=regexPacks.find(x=>x.id===id);if(p)downloadJson(`${p.name}.mimamao-regex.json`,{format:'mimamao-tavern-regex-pack',version:1,data:p})}

function renderContextTab(box){const ps=currentSessionData.promptSettings||{};box.innerHTML=`<section class="settings-section"><h3>🪐 Session（剧情会话）</h3><div class="form-grid"><div class="form-full"><label class="form-label">标题</label><input id="ctx-title" class="field" value="${escapeHtml(currentSessionData.title||'')}"></div><div><label class="form-label">Canon Level（设定层级）</label><select id="ctx-canon" class="field">${['temporary','alternate','soft','core'].map(x=>`<option value="${x}" ${currentSessionData.canonLevel===x?'selected':''}>${canonLabel(x)}</option>`).join('')}</select></div><div><label class="form-label">Temperature（温度）</label><input id="ctx-temp" class="field" type="number" min="0.1" max="2" step="0.05" value="${getTemp()}"></div></div><p class="helper">Standalone（独立版）中所有 Session（剧情会话）都是浏览器本地独立宇宙，不会写入任何 MIMAMAO / Telegram 世界。</p></section>
<section class="settings-section"><h3>🧠 长剧情与记忆</h3>
    <div class="context-window-link" role="status"><strong>当前 API 模型上下文总窗口：${Number(MimaStandalone.getApiConfig()?.contextWindowTokens)>=4096?`${Number(MimaStandalone.getApiConfig().contextWindowTokens).toLocaleString()} Tokens`:'未配置（0 / 未知）'}</strong><span>它决定能否按 10 轮裁剪；与下面的轮数以及最大输出 Tokens 不同。没有真实容量时不会假装模型支持百万窗口。</span><button type="button" class="ghost-btn" onclick="openSettings('api')">去设置模型实际窗口</button></div><div class="form-grid"><div><label class="form-label">自动整理时，最近多少条剧情保持原样（按消息计）</label><input id="ctx-recent" class="field" type="number" min="6" max="100000" step="1" value="${Number(ps.recentMessageLimit??34)}"><div class="row-sub">这是自动整理时保留的近期消息窗口；模型容量允许时仍优先提供完整原始 History。修改后请点击下方保存。</div></div><div><label class="form-label">Prompt 超窗时每批移出最早完整剧情轮次</label><input id="ctx-trim-batch" class="field" type="number" min="1" max="100" step="1" value="${Number(ps.contextTrimBatchRounds??10)}"><div class="row-sub">默认 10 轮；只有来源已被有效滚动记忆覆盖才允许从单次请求中移出。本地 History 永不删除。</div></div><div><label class="form-label">Prompt 至少保留的最新完整剧情轮次</label><input id="ctx-trim-min-recent" class="field" type="number" min="1" max="100000" step="1" value="${Number(ps.contextMinRecentRounds??20)}"><div class="row-sub">默认 20 轮；保留后仍超窗时停止请求并提示调整，不会擅自牺牲最近剧情。</div></div><div><label class="form-label">较早剧情每积累多少条后可自动整理</label><input id="ctx-summary-trigger" class="field" type="number" min="12" max="200" value="${Number(ps.summaryTriggerMessages||28)}"><div class="row-sub">默认 28 条；不删减原始剧情，也不影响手动整理。</div></div><div><label class="form-label">世界书总预算（字符，最多 1,000,000）</label><input id="ctx-wbbudget" class="field" type="number" min="1000" max="1000000" step="1" value="${Number(ps.worldbookBudgetChars??16000)}"><div class="row-sub">这是本轮命中条目允许占用的字符上限，不保证所有条目都触发；实际仍受模型上下文窗口限制。超过窗口会报错，不会暗中删除原始剧情。</div></div><div class="form-full"><label class="form-label">🎭 AIRP 输入语义</label><select id="ctx-airp-mode" class="field"><option value="auto" ${(ps.inputSemanticMode||'raw')==='auto'?'selected':''}>智能自动（主动选择，可能误判）</option><option value="dialogue_first" ${ps.inputSemanticMode==='dialogue_first'?'selected':''}>对话优先：普通文本=台词，括号=动作/心理</option><option value="quote_dialogue" ${ps.inputSemanticMode==='quote_dialogue'?'selected':''}>引号台词：引号=台词，其余普通文本=动作</option><option value="raw" ${(ps.inputSemanticMode||'raw')==='raw'?'selected':''}>原样发送（默认）：关闭语义解析</option></select><div class="row-sub">默认按原文发送；已存消息保留当时的解析模式。选择并保存非原样模式才会对新消息启用语义改写，可能误判。智能自动会兼容两种常见 AIRP：有明确引号时把引号当台词、周围当动作；没有引号时普通文本默认台词，括号永远不是台词。括号中的明确“心想/内心/OS”等会标记为私密想法。</div></div><div class="form-full"><label class="check-row"><input id="ctx-history-html-projection" type="checkbox" ${ps.historyHtmlMode!=='raw'?'checked':''}> 历史剧情 HTML 转纯文本（仅新模型请求和记忆总结，不改存档、渲染或预设）</label><div class="row-sub">保留 HTML 正文/状态栏文字与数值，去除布局标签、CSS 和装饰代码。预设/世界书/玩家输入不转换；按原请求重说保持旧快照。含真正代码示例的剧情可关闭。</div></div><div class="form-full"><label class="check-row"><input id="ctx-summary" type="checkbox" ${ps.autoRollingEnabled===true?'checked':''}> 自动整理较早剧情（会调用模型，可能收费）</label><label class="check-row"><input id="ctx-inject-saved-rolling" type="checkbox" ${ps.injectSavedRolling!==false?'checked':''}> 让 AI 参考以前保存的剧情摘要（与自动生成独立）</label><div class="row-sub">首次自动整理一般要积累至少 ${Math.max(0,Math.max(18,Number(ps.recentMessageLimit??34)-4)+Number(ps.summaryTriggerMessages||28))} 条消息（当前尚未总结时）；消息不等于问答轮。原始剧情不会删除。曾经失败的任务将暂停，需手动确认才继续。</div><label class="form-label">自动整理单次最多允许多少次模型请求</label><input id="ctx-auto-rolling-budget" class="field" type="number" min="1" max="20" value="${Number(ps.autoRollingMaxRequests||1)}"><label class="check-row"><input id="ctx-complete-html" type="checkbox" ${ps.outputContract?.completeHtml===true?'checked':''}> 明确要求回复 HTML 标签完整闭合（普通文本不受限制）</label><label class="check-row"><input id="ctx-require-html" type="checkbox" ${ps.outputContract?.requireHtml===true?'checked':''}> 独立 HTML 结构合同：必须包含 HTML 及下面的必需结构（默认关闭）</label><div class="row-sub">缺失结构将保护性拒绝自动入库，不会后台重复调用 API；可通过坏回复诊断和手动代码修复处理。</div><label class="form-label">必需 CSS 选择器（每行或逗号分隔）</label><textarea id="ctx-html-selectors" class="field textarea" rows="2">${escapeHtml(ps.outputContract?.requiredSelectors||'')}</textarea><label class="form-label">标准 HTML 参考消息（手动选择，仅角色回复）</label><select id="ctx-html-template-message" class="field"><option value="">不绑定模板</option>${arr(currentSessionData.messages).filter(m=>m.role==='assistant'&&/[<][A-Za-z]/.test(m.content||'')).map(m=>`<option value="${escapeHtml(m.id)}" ${ps.outputContract?.templateMessageId===m.id?'selected':''}>${escapeHtml((m.content||'').replace(/<[^>]*>/g,' ').trim().slice(0,70)||m.id)}</option>`).join('')}</select><label class="form-label">模板的正文容器 CSS 选择器（唯一插槽，手动代码修复必填）</label><input id="ctx-html-body-slot" class="field" value="${escapeHtml(ps.outputContract?.bodySelector||'')}" placeholder="例如 .story-body"><label class="form-label">状态容器 CSS 选择器（含实时数据时不可自动伪造）</label><input id="ctx-html-status-slot" class="field" value="${escapeHtml(ps.outputContract?.statusSelector||'')}" placeholder="例如 .status-panel"><label class="form-label">允许继承固定文字的静态容器选择器（每行一个；仅授权固定标题/说明，不得包含正文槽或状态栏）</label><textarea id="ctx-html-static-slots" class="field textarea" rows="2">${escapeHtml(ps.outputContract?.staticSelectors||'')}</textarea><label class="form-label">允许自动继承固定 CSS 的规则选择器（每行一个；仅当该规则确实不含动态状态时授权）</label><textarea id="ctx-html-static-css" class="field textarea" rows="2">${escapeHtml(ps.outputContract?.staticCssSelectors||'')}</textarea><label class="form-label">明确属于固定布局的 class / 动画名（用空格或换行分隔；例如 card-wrapper，动态状态类不要填）</label><textarea id="ctx-html-static-classes" class="field textarea" rows="2">${escapeHtml(ps.outputContract?.staticClassTokens||'')}</textarea><label class="form-label">固定 HTML/CSS 注释精确白名单（每行一个，仅填写注释内部文字）</label><textarea id="ctx-html-static-comments" class="field textarea" rows="2">${escapeHtml(ps.outputContract?.staticCommentTexts||'')}</textarea><label class="check-row"><input id="ctx-pinned-on" type="checkbox" ${ps.pinnedFactsEnabled!==false?'checked':''}> 注入 Pinned Facts（固定事实）</label></div><div class="form-full"><label class="form-label">📌 Pinned Facts（固定事实，一行一条）</label><textarea id="ctx-pinned" class="field textarea">${escapeHtml(arr(currentSessionData.pinnedFacts).join('\n'))}</textarea></div><div class="form-full"><label class="form-label">玩家备注</label><textarea id="ctx-usernotes" class="field textarea">${escapeHtml(currentSessionData.userNotes||'')}</textarea></div><div class="form-full"><label class="form-label">AI（人工智能）备注</label><textarea id="ctx-ainotes" class="field textarea">${escapeHtml(currentSessionData.aiNotes||'')}</textarea></div></div></section>
<div class="toolbar"><button id="ctx-save" class="primary-btn" type="button" onclick="saveContextSettings()">保存长剧情与会话设置</button><span class="row-sub">保存成功后，重新打开此页面仍会显示你设定的数值。</span></div>
<section class="settings-section"><h3>💾 本地档案</h3><p class="helper">剧情、角色卡、世界书、预设、正则包保存在当前浏览器 IndexedDB（本地数据库）。分享剧情请选“纯剧情 TXT/JSON”，不含预设与历史请求快照；“原始会话存档”和“完整剧情资料备份”保留生成请求快照等私密上下文，仅用于自己的恢复与迁移。字体与 API Key（接口密钥）不会被打进这份“剧情资料备份”。</p><div class="toolbar"><button class="primary-btn" onclick="exportStoryTranscript('txt')">⇩ 纯剧情 TXT</button><button class="ghost-btn" onclick="exportStoryTranscript('json')">⇩ 纯剧情 JSON</button><button class="ghost-btn" onclick="exportCurrentSession()">⇩ 原始会话存档（可导回）</button><button class="ghost-btn" onclick="exportWholeLibrary()">⇩ 完整剧情资料备份</button><button class="ghost-btn" onclick="chooseLibraryImport()">⇧ 导入剧情资料备份</button><button class="danger-btn" onclick="deleteCurrentSession()">删除当前剧情</button></div></section>`}
async function saveContextSettings(){
    if(!currentSessionId)return toast('请先选择剧情会话');
    // Treat the input as authoritative only after validating it. Backend
    // normalization must never silently turn 500,000 into 160,000.
    const numeric=(id,label,min,max,{integer=true}={})=>{
        const field=qs(id),raw=String(field?.value??'').trim(),n=Number(raw);
        if(!raw||!Number.isFinite(n)||(integer&&!Number.isInteger(n))||n<min||n>max){
            toast(`${label}必须是 ${min}～${max} 的${integer?'整数':'数值'}，未保存`);
            field?.focus?.();return null;
        }
        return n;
    };
    const recent=numeric('ctx-recent','近期保留原文消息数',6,100000);
    if(recent===null)return null;
    const trigger=numeric('ctx-summary-trigger','自动整理间隔',12,200);
    if(trigger===null)return null;
    const trimBatch=numeric('ctx-trim-batch','超窗裁剪轮次批量',1,100);
    if(trimBatch===null)return null;
    const trimKeep=numeric('ctx-trim-min-recent','至少保留近期轮数',1,100000);
    if(trimKeep===null)return null;
    const worldBudget=numeric('ctx-wbbudget','世界书字符预算',1000,1000000);
    if(worldBudget===null)return null;
    const temp=numeric('ctx-temp','温度',0.1,2,{integer:false});
    if(temp===null)return null;
    const mode=qs('ctx-airp-mode')?.value||'raw';
    if(!['auto','dialogue_first','quote_dialogue','raw'].includes(mode)){
        toast('无效的 AIRP 输入模式，未保存');return null;
    }
    const rollingMax=numeric('ctx-auto-rolling-budget','自动整理单次请求上限',1,20);
    if(rollingMax===null)return null; // A failed field invalidates the ENTIRE form before confirmation or CAS.
    // Validate all form text BEFORE calling patchCurrent. Backend normalization
    // truncates these fields by contract; truncation after a write is not atomic validation.
    for(const [field,max] of Object.entries({'ctx-html-selectors':600,'ctx-html-template-message':200,
      'ctx-html-body-slot':200,'ctx-html-status-slot':200,'ctx-html-static-slots':600,
      'ctx-html-static-css':2000,'ctx-html-static-comments':4000,'ctx-html-static-classes':4000})){
        const input=qs(field);if(String(input?.value||'').length>max){toast('HTML 合同字段超过 '+max+' 字符，全部设置未保存');input?.focus?.();return null;}
    }
    const wasAuto=currentSessionData.promptSettings?.autoRollingEnabled===true;
    if(qs('ctx-summary').checked&&!wasAuto&&!window.confirm('启用后会在达到剧情阈值时调用模型，可能收费；每个任务最多使用下面设置的请求次数。失败会停止自动重试。确定启用吗？'))return null;
    const expected={...(currentSessionData.promptSettings||{}),recentMessageLimit:recent,
        summaryTriggerMessages:trigger,worldbookBudgetChars:worldBudget,contextTrimBatchRounds:trimBatch,contextMinRecentRounds:trimKeep,
        inputSemanticMode:mode,inputSemanticExplicit:true,historyHtmlMode:qs('ctx-history-html-projection').checked?'semantic':'raw',summaryEnabled:qs('ctx-summary').checked,autoRollingEnabled:qs('ctx-summary').checked,injectSavedRolling:qs('ctx-inject-saved-rolling').checked,autoRollingMaxRequests:rollingMax,
        pinnedFactsEnabled:qs('ctx-pinned-on').checked};
    expected.outputContract=(qs('ctx-complete-html').checked||qs('ctx-require-html')?.checked)?{
       completeHtml:qs('ctx-complete-html').checked,requireHtml:!!qs('ctx-require-html')?.checked,
       requiredSelectors:qs('ctx-html-selectors')?.value||'',templateMessageId:qs('ctx-html-template-message')?.value||'',
       bodySelector:qs('ctx-html-body-slot')?.value||'',statusSelector:qs('ctx-html-status-slot')?.value||'',staticSelectors:qs('ctx-html-static-slots')?.value||'',staticCssSelectors:qs('ctx-html-static-css')?.value||'',staticCommentTexts:qs('ctx-html-static-comments')?.value||'',staticClassTokens:qs('ctx-html-static-classes')?.value||''}:null;
    // Do not overwrite unrelated Persona/source switches while saving context.
    const saved=await patchCurrent({
        title:qs('ctx-title').value||'未命名咪嘛宇宙',
        canonLevel:qs('ctx-canon').value,
        pinnedFacts:lines(qs('ctx-pinned').value),userNotes:qs('ctx-usernotes').value,
        aiNotes:qs('ctx-ainotes').value,promptSettings:expected
    },true);
    if(!saved)return null;
    // Detect unexpected server normalization instead of reporting fake success.
    const actual=saved.promptSettings||{};
    if(Object.keys(expected).some(k=>JSON.stringify(actual[k]??null)!==JSON.stringify(expected[k]??null))){
        toast('保存返回值与设定不一致，请检查存档及设置范围');
        renderSettings();return null;
    }
    localStorage.setItem(TEMP_KEY,String(temp));
    MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),temperature:temp});
    renderSettings();
    toast(`长剧情设置已保存：近期 ${recent} 条，世界书 ${worldBudget.toLocaleString('en-US')} 字符`);
    return saved;
}

function memoryStore(){
    const m=currentSessionData?.manualMemory||{};
    return {core:m.core||{content:'',source:'context',targetChars:1000,temperature:.35},facts:arr(m.facts),settings:{injectCore:m.settings?.injectCore!==false,injectFacts:m.settings?.injectFacts!==false,factInjectionLimit:Number(m.settings?.factInjectionLimit??12),factChunkRounds:Number(m.settings?.factChunkRounds??10),factTargetChars:Number(m.settings?.factTargetChars??1800),factScope:m.settings?.factScope==='all'?'all':'recent',factRecentRounds:Number(m.settings?.factRecentRounds??25),summaryTemperature:Number(m.settings?.summaryTemperature??.35),memoryModel:String(m.settings?.memoryModel||''),memoryStreamMode:['inherit','on','off'].includes(m.settings?.memoryStreamMode)?m.settings.memoryStreamMode:'inherit',summaryContext:{version:1,userPersona:m.settings?.summaryContext?.userPersona===true,characterPersona:m.settings?.summaryContext?.characterPersona===true,presetIds:arr(m.settings?.summaryContext?.presetIds),worldbookMode:m.settings?.summaryContext?.worldbookMode||'none',worldbookIds:arr(m.settings?.summaryContext?.worldbookIds),worldbookEntryIds:arr(m.settings?.summaryContext?.worldbookEntryIds),worldbookEntryRefs:arr(m.settings?.summaryContext?.worldbookEntryRefs)}}};
}
function storyRoundCount(){return arr(currentSessionData?.messages).filter(m=>m?.role==='user').length}
function memoryDateLabel(v){if(!v)return'尚未生成';try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(_){return String(v)}}
function memorySourceLabel(v){return v==='facts'?'事实记忆':v==='manual'?'手工编辑':'剧情原文'}
// Per-session UI drafts are not canonical memory. They only protect unsubmitted
// form edits against progress-driven / navigation-driven rerenders.
const memoryFormDrafts=new Map();
const MEMORY_FORM_DRAFT_IDS=['fact-memory-chunk','fact-memory-target','fact-memory-scope','fact-memory-recent','fact-memory-replace','memory-temp','memory-model','memory-inject-limit','memory-inject-core', 'memory-inject-facts','memory-ref-user','memory-ref-char','memory-ref-mode','core-memory-target','core-memory-source'];
function captureMemoryFormDraft(box){
    const id=box?.dataset?.memoryFormSessionId;
    if(!id)return;
    const form={...(memoryFormDrafts.get(id)||{})};
    for(const key of MEMORY_FORM_DRAFT_IDS){
        const node=box.querySelector('[id="'+key+'"]');
        if(node)form[key]=node.type==='checkbox'?node.checked:node.value;
    }
    if(box.querySelector('[data-memory-ref]')){
        form['memory-ref-preset']=Array.from(box.querySelectorAll('[data-memory-ref="preset"]:checked')).map(n=>n.value);
        form['memory-ref-book']=Array.from(box.querySelectorAll('[data-memory-ref="book"]:checked')).map(n=>n.value);
        form['memory-ref-entry']=Array.from(box.querySelectorAll('[data-memory-ref="entry"]:checked')).map(n=>n.value);
    }
    memoryFormDrafts.set(id,form);
}
function setupMemoryFormDraftCapture(box){
    if(box._mimaMemoryCaptureInstalled)return;
    box._mimaMemoryCaptureInstalled=true;
    box.addEventListener('input',()=>captureMemoryFormDraft(box));
    box.addEventListener('change',()=>captureMemoryFormDraft(box));
}
function memoryFormDraftValue(id,fallback){
    const values=memoryFormDrafts.get(currentSessionId);
    return values&&Object.hasOwn(values,id)?values[id]:fallback;
}
function memoryFormDraftNumber(id,fallback){
    const n=Number(memoryFormDraftValue(id,fallback));
    return Number.isFinite(n)?n:fallback;
}
function memoryFormDraftChecked(id,fallback){return memoryFormDraftValue(id,fallback)===true;}
function renderMemoryTab(box){
    captureMemoryFormDraft(box);
    setupMemoryFormDraftCapture(box);
    // Preserve an owner's unsubmitted edits when refreshes rerender the modal.
    const liveDraft=qs('memory-merge-result');
    if(memoryMergeDraft?.sessionId===currentSessionId&&liveDraft&&memoryMergeDraft.content!==liveDraft.value)queueFactMergeDraftSave(liveDraft.value);
    const mem=memoryStore(),core=mem.core||{},facts=mem.facts.slice().sort((a,b)=>Number(a.startRound||0)-Number(b.startRound||0)||Number(a.endRound||0)-Number(b.endRound||0));
    const refs=mem.settings.summaryContext||{},referenceSelection=(key,fallback)=>arr(memoryFormDraftValue(key,fallback));
    const selectedPresets=new Set(referenceSelection('memory-ref-preset',refs.presetIds));
    const selectedBooks=new Set(referenceSelection('memory-ref-book',refs.worldbookIds));
    const selectedEntries=new Set(referenceSelection('memory-ref-entry',refs.worldbookEntryRefs.map(x=>JSON.stringify([x.bookId,x.entryId]))));
    const legacySelectedEntries=new Set(refs.worldbookEntryIds||[]);
    const mountedPresets=presets.filter(x=>arr(currentSessionData?.presetIds).includes(x.id)&&x.enabled!==false);
    const mountedBooks=worldbooks.filter(x=>arr(currentSessionData?.worldbookIds).includes(x.id)&&x.enabled!==false);
    const refCheckbox=(kind,id,label,on)=>`<label class="check-row"><input data-memory-ref="${kind}" type="checkbox" value="${escapeHtml(id)}" ${on?'checked':''}> ${escapeHtml(label)}</label>`;
    const memoryReferenceControls=`<section class="settings-section"><h3>📚 总结时参考背景（可选）</h3><p class="helper">只作用于新的记忆生成请求，与后续剧情注入开关互不干扰。旧存档默认不读取。预设作为你选中的总结指令，Persona / 世界书只用于背景消歧，不会冒充已发生的剧情；完整内容增加上下文用量。</p><div class="form-grid"><div>${'<label class="form-label">人物设定</label>'}<label class="check-row"><input id="memory-ref-user" type="checkbox" ${memoryFormDraftChecked('memory-ref-user',refs.userPersona)?'checked':''}> 玩家 Persona</label><label class="check-row"><input id="memory-ref-char" type="checkbox" ${memoryFormDraftChecked('memory-ref-char',refs.characterPersona)?'checked':''}> 角色 Persona</label></div><div><label class="form-label">世界书条目选择方式</label><select id="memory-ref-mode" class="field"><option value="none" ${memoryFormDraftValue('memory-ref-mode',refs.worldbookMode)==='none'?'selected':''}>不读取</option><option value="selected_entries" ${memoryFormDraftValue('memory-ref-mode',refs.worldbookMode)==='selected_entries'?'selected':''}>指定条目</option><option value="matched_entries" ${memoryFormDraftValue('memory-ref-mode',refs.worldbookMode)==='matched_entries'?'selected':''}>当前命中条目</option></select></div></div><details><summary>选择已挂载预设（${mountedPresets.length}）</summary>${mountedPresets.map(x=>refCheckbox('preset',x.id,x.name,selectedPresets.has(x.id))).join('')||'<p class="helper">无已挂载预设</p>'}</details><details><summary>选择已挂载世界书及条目（${mountedBooks.length}）</summary>${mountedBooks.map(b=>`<fieldset><legend>${escapeHtml(b.name)}</legend>${refCheckbox('book',b.id,'启用此书作为参考来源',selectedBooks.has(b.id))}${arr(b.entries).filter(e=>e.enabled!==false).map(e=>refCheckbox('entry',JSON.stringify([b.id,e.id]),e.name||e.id,selectedEntries.has(JSON.stringify([b.id,e.id]))||(legacySelectedEntries.has(e.id)&&mountedBooks.reduce((n,w)=>n+arr(w.entries).filter(x=>x.id===e.id).length,0)===1))).join('')}</fieldset>`).join('')||'<p class="helper">无已挂载世界书</p>'}</details><p class="helper">若某个已保存的参考资源后来卸载或关闭，生成时会明确报错，不会静默忽略它。</p></section>`;
    const rounds=storyRoundCount(),temp=Math.max(.1,Math.min(2,Number(mem.settings.summaryTemperature??core.temperature??.35)||.35));
    const overlapCount=facts.reduce((n,f,i)=>n+facts.slice(0,i).filter(prev=>Number(prev.startRound)<=Number(f.endRound)&&Number(f.startRound)<=Number(prev.endRound)).length,0);
    const coreBehind=!!core.content&&core.source!=='manual'&&Number(core.sourceRoundCount||0)>0&&Number(core.sourceRoundCount)<rounds;
    const latestFactRound=facts.reduce((n,f)=>Math.max(n,Number(f.endRound)||0),0);
    const memoryWarnings=[
      ...(overlapCount?[`检测到 ${overlapCount} 组事实记忆轮次范围重叠，可能造成重复注入；旧记忆没有自动删除。`]:[]),
      ...(coreBehind?[`当前核心记忆只涵盖生成时的 ${core.sourceRoundCount} 轮，新增的 ${rounds-Number(core.sourceRoundCount)} 轮尚未压缩进核心记忆。`]:[]),
      ...(core.source==='facts'&&core.sourceFactsHash&&core.sourceFactsHash!==MimaStandalone.memoryFactSignature(facts)?[`核心记忆生成后事实列表已变化；旧核心记忆仍可注入，需要时可手动重新生成。`]:[]),
      ...(facts.length&&latestFactRound<rounds?[`事实记忆目前最多覆盖到第 ${latestFactRound} 轮，之后的轮次尚未总结。`]:[])
    ];
    const factCards=facts.length?facts.map(f=>`<div class="memory-card"><div class="memory-card-head"><div><label class="check-row"><input class="memory-merge-select" type="checkbox" data-fact-id="${escapeHtml(f.id)}" checked> <strong>第 ${Number(f.startRound||0)}–${Number(f.endRound||0)} 轮</strong></label><div class="entry-meta">${escapeHtml(memoryDateLabel(f.updatedAt||f.createdAt))} · 约 ${Number(f.targetChars||0)||'—'} 字 · T=${Number(f.temperature??.35).toFixed(2)}</div></div><div class="toolbar"><button class="tool-mini" onclick="startFactMemoryEdit(${escapeHtml(JSON.stringify(f.id))})">编辑</button><button class="tool-mini" onclick="deleteFactMemory(${escapeHtml(JSON.stringify(f.id))})">删除</button></div></div>${memoryFactEditId===f.id?`<textarea id="fact-edit-${escapeHtml(f.id)}" class="field textarea tall">${escapeHtml(f.content||'')}</textarea><div class="toolbar"><button class="primary-btn" onclick="saveFactMemoryEdit(${escapeHtml(JSON.stringify(f.id))})">保存修改</button><button class="ghost-btn" onclick="cancelFactMemoryEdit()">取消</button></div>`:`<div class="memory-text">${escapeHtml(f.content||'')}</div>`}</div>`).join(''):'<div class="memory-empty">还没有事实记忆。可以按 10 / 25 轮一段开始总结猫。</div>';
    const preview=memoryMergeDraft?.sessionId===currentSessionId?`<div class="memory-card" id="memory-merge-preview"><h4>🧩 AI 二次合并候选 · 原记忆还在</h4><p class="helper">已选择 ${memoryMergeDraft.selectedIds.length} 条 · 第 ${memoryMergeDraft.startRound}–${memoryMergeDraft.endRound} 轮。可先编辑内容，再确认替换；不确认就绝不改动旧记忆。</p><textarea class="field textarea tall" id="memory-merge-result" rows="14" oninput="queueFactMergeDraftSave(this.value)">${escapeHtml(memoryMergeDraft.content||'')}</textarea><div class="toolbar"><button type="button" class="primary-btn" onclick="confirmFactMemoryMerge()">确认合并并保存</button><button type="button" class="ghost-btn" onclick="cancelFactMemoryMerge()">放弃候选，保留原记忆</button></div></div>`:'';
    box.innerHTML=`
    <section class="settings-section memory-overview"><h3>🗃️ 手动记忆总结</h3><p class="helper">使用当前 API 配置与所选记忆模型整理这个 Session（剧情会话）的长期记忆。这里的“1 轮”= 一次 User 发言 + 随后的角色回复；角色开场白会作为第 1 轮之前的前置信息纳入摘要，但不会单独占一轮。</p><div class="memory-stats"><div class="stat-card"><div class="stat-num">${rounds}</div><div class="stat-label">当前剧情轮数</div></div><div class="stat-card"><div class="stat-num">${facts.length}</div><div class="stat-label">事实记忆片段</div></div><div class="stat-card"><div class="stat-num">${core.content?'✓':'—'}</div><div class="stat-label">核心记忆</div></div></div>
    ${memoryWarnings.length?`<p class="helper" role="status">⚠ ${memoryWarnings.map(escapeHtml).join('　')}</p>`:''}<div class="form-grid memory-global-grid"><div><label class="form-label">Summary Temperature（总结温度）</label><input id="memory-temp" class="field" type="number" min="0.1" max="2" step="0.05" value="${escapeHtml(String(memoryFormDraftValue('memory-temp',temp.toFixed(2))))}"><div class="row-sub">独立于剧情温度；若 API 关闭发送温度则请求不会带温度。</div></div><div class="form-full"><label class="form-label">记忆模型（留空沿用剧情模型）</label><div class="inline-field-row"><select id="memory-model-list" class="field" onchange="selectMemoryModel()"><option value="">沿用剧情模型</option>${mem.settings.memoryModel?`<option selected value="${escapeHtml(mem.settings.memoryModel)}">${escapeHtml(mem.settings.memoryModel)}</option>`:''}</select><button class="ghost-btn" type="button" onclick="loadMemoryModels()">拉取模型</button></div><input id="memory-model" class="field" value="${escapeHtml(String(memoryFormDraftValue('memory-model',mem.settings.memoryModel)))}" placeholder="留空沿用剧情模型，也可手填模型 ID"><div class="row-sub">核心、事实、手动合并及后台滚动摘要共用独立记忆模型，具体请求绑定当次模型；不会改 API 页的剧情模型。</div></div><div><label class="form-label">后续剧情注入</label><label class="check-row"><input id="memory-inject-core" type="checkbox" ${memoryFormDraftChecked('memory-inject-core',mem.settings.injectCore)?'checked':''}> 注入核心记忆</label><label class="check-row"><input id="memory-inject-facts" type="checkbox" ${memoryFormDraftChecked('memory-inject-facts',mem.settings.injectFacts)?'checked':''}> 注入事实记忆</label></div><div><label class="form-label">最多注入最近几段事实记忆</label><input id="memory-inject-limit" class="field" type="number" min="0" step="1" value="${escapeHtml(String(memoryFormDraftNumber('memory-inject-limit',mem.settings.factInjectionLimit)))}"><div class="row-sub">填 0 = 注入全部事实记忆；正整数 = 最近指定条数。没有人为 100 条上限，实际请求仍受所用模型上下文容量约束。</div></div></div>
    <div class="form-full"><label class="form-label">记忆生成 Streaming（流式预览，不等于正式保存）</label><select id="memory-stream-mode" class="field"><option value="inherit" ${memoryFormDraftValue('memory-stream-mode',mem.settings.memoryStreamMode||'inherit')==='inherit'?'selected':''}>继承 API 设置</option><option value="on" ${memoryFormDraftValue('memory-stream-mode',mem.settings.memoryStreamMode||'inherit')==='on'?'selected':''}>打开</option><option value="off" ${memoryFormDraftValue('memory-stream-mode',mem.settings.memoryStreamMode||'inherit')==='off'?'selected':''}>关闭</option></select></div><div class="toolbar"><button class="ghost-btn" onclick="saveMemorySettings()" >保存记忆设置</button></div><div id="memory-progress" class="memory-progress ${memoryTask?.sessionId===currentSessionId?'':'hidden'}"><div class="memory-progress-head"><span id="memory-progress-label">正在调用 LLM（大语言模型）…</span><span id="memory-progress-percent">0%</span></div><div class="memory-progress-track"><div id="memory-progress-bar" class="memory-progress-bar"></div></div><div id="memory-progress-detail" class="row-sub"></div><label class="form-label">正在接收的记忆草稿（只读，非已提交）</label><textarea id="memory-stage-draft" class="field textarea tall" readonly style="user-select:text"></textarea><button class="tool-mini" onclick="stopMemorySummary()">停止总结</button></div></section>

    ${memoryReferenceControls}
    <section class="settings-section"><h3>💎 核心记忆</h3><p class="helper">不是流水账。它会从第一轮开始提炼真正影响长期剧情的东西，尤其优先保存关系转变、承诺/约定、重要选择及后果、持续状态变化和未解决事项。也可以直接用已经生成的事实记忆再压缩一次。</p><div class="form-grid"><div><label class="form-label">总结来源</label><select id="core-memory-source" class="field"><option value="context" ${core.source!=='facts'?'selected':''}>从第一轮剧情原文开始总结</option><option value="facts" ${core.source==='facts'?'selected':''}>根据事实记忆总结核心记忆</option></select></div><div><label class="form-label">目标字数</label><input id="core-memory-target" class="field" type="number" min="100" max="12000" step="100" value="${memoryFormDraftNumber('core-memory-target',Number(core.targetChars||1000))}"><div class="memory-quick-targets"><button class="tool-mini" onclick="setCoreMemoryTarget(500)">500</button><button class="tool-mini" onclick="setCoreMemoryTarget(1000)">1000</button><button class="tool-mini" onclick="setCoreMemoryTarget(2000)">2000</button></div></div><div class="form-full"><label class="form-label">核心记忆正文 · ${escapeHtml(memorySourceLabel(core.source))} · ${escapeHtml(memoryDateLabel(core.updatedAt))}</label><textarea id="core-memory-content" class="field textarea tall" placeholder="生成后会显示在这里，也可以手工修订。">${escapeHtml(core.content||'')}</textarea></div></div><div class="toolbar"><button class="primary-btn memory-action" onclick="generateCoreMemory()" ${memoryGenerating?'disabled':''}>✨ 生成 / 重做核心记忆</button><button class="ghost-btn" onclick="saveCoreMemoryEdit()" >保存手工修改</button>${core.content?'<button class="danger-btn" onclick="clearCoreMemory()" '+(memoryGenerating?'disabled':'')+'>清空核心记忆</button>':''}</div></section>

    <section class="settings-section"><h3>🕰️ 旧剧情自动整理（可撤销）</h3><p id="rolling-auto-status" class="helper">正在核对后台状态…</p><p class="helper">${currentSessionData?.promptSettings?.autoRollingEnabled===true?'自动生成已授权；失败后暂停自动收费':'自动生成当前关闭；已有摘要仍可独立选择注入'}。最近保留 ${Number(currentSessionData?.promptSettings?.recentMessageLimit||34)} 条，整理间隔 ${Number(currentSessionData?.promptSettings?.summaryTriggerMessages||28)} 条；首次大约 ${Math.max(18,Number(currentSessionData?.promptSettings?.recentMessageLimit||34)-4)+Number(currentSessionData?.promptSettings?.summaryTriggerMessages||28)} 条消息才触发。完整原始剧情不删除。</p><div class="toolbar"><button type="button" class="ghost-btn" onclick="manualRollingSummary()">查看请求计划并手动整理/恢复</button></div><p class="helper">只影响模型收到的旧剧情摘要，不会删除原始 History。错误摘要可撤销并从第一条重新总结；撤销前的版本暂存供恢复。正在运行的总结任务不能抢占。</p><div class="row-sub">已总结至消息索引 ${Number(currentSessionData?.lastSummarizedIndex||0)}；旧摘要备份 ${Array.isArray(currentSessionData?.rollingArchive)?currentSessionData.rollingArchive.length:0} 份</div><details><summary>查看当前滚动摘要</summary><pre class="memory-review-source">${escapeHtml(currentSessionData?.rollingSummary||currentSessionData?.summary||'(尚未生成)')}</pre></details><div class="toolbar"><button type="button" class="danger-btn" onclick="revokeRollingMemory()" ${memoryGenerating?'disabled':''}>撤销错误滚动摘要（保留原文）</button>${currentSessionData?.rollingArchive?.length?`<button type="button" class="ghost-btn" onclick="restoreRollingMemory()" ${memoryGenerating?'disabled':''}>恢复上一份摘要</button>`:''}</div></section>
    <section class="settings-section"><h3>🧾 事实记忆</h3><p class="helper">把剧情按轮次忠实整理为详细的小段记忆。事件、具体行为、重要对话和关系变化尽量保留；不强制字面审判。已有内容可随时编辑、删除、手动合并。</p><div class="form-grid"><div><label class="form-label">每 X 轮总结一段</label><input id="fact-memory-chunk" class="field" type="number" min="1" max="200" value="${memoryFormDraftNumber('fact-memory-chunk',mem.settings.factChunkRounds)}"></div><div><label class="form-label">每段目标字数</label><input id="fact-memory-target" class="field" type="number" min="80" max="12000" step="20" value="${memoryFormDraftNumber('fact-memory-target',mem.settings.factTargetChars)}"></div><div><label class="form-label">总结范围</label><select id="fact-memory-scope" class="field" onchange="syncFactMemoryScope()"><option value="recent" ${memoryFormDraftValue('fact-memory-scope',mem.settings.factScope)==='recent'?'selected':''}>只总结最近 X 轮</option><option value="all" ${memoryFormDraftValue('fact-memory-scope',mem.settings.factScope)==='all'?'selected':''}>从头到尾全部总结</option></select></div><div id="fact-memory-recent-wrap"><label class="form-label">最近多少轮</label><input id="fact-memory-recent" class="field" type="number" min="1" max="100000" value="${memoryFormDraftNumber('fact-memory-recent',mem.settings.factRecentRounds)}"></div><div class="form-full" id="fact-memory-replace-wrap"><label class="check-row"><input id="fact-memory-replace" type="checkbox" ${memoryFormDraftChecked('fact-memory-replace',false)?'checked':''}> 从头到尾完成后，用新事实记忆整体顶掉旧事实记忆</label><div class="row-sub">只在“从头到尾”模式生效。生成过程中如果 API 失败，旧记忆不会被提前删除。</div></div></div><div class="toolbar"><button class="primary-btn memory-action" onclick="generateFactMemories()" ${memoryGenerating?'disabled':''}>🧠 开始事实总结</button>${facts.length?'<button class="danger-btn" onclick="clearAllFactMemories()" '+(memoryGenerating?'disabled':'')+'>清空全部事实记忆</button>':''}</div><div class="memory-card"><h4>🧩 AI 二次合并事实记忆</h4><p class="helper">勾选下方需要合并的事实记忆（可一次合并 100 条以上），生成候选后手动检查或修改；确认前旧记忆完全不变。</p><label class="form-label">合并后目标字数（软目标，保留细节优先）</label><input class="field" type="number" id="memory-merge-target" min="100" max="250000" value="6000"><div class="toolbar"><button type="button" class="primary-btn" onclick="previewFactMemoryMerge()" ${memoryGenerating||facts.length<2?'disabled':''}>AI 合并已选记忆（仅预览）</button><button type="button" class="ghost-btn" onclick="toggleMergeFactSelection(true)">全选</button><button type="button" class="ghost-btn" onclick="toggleMergeFactSelection(false)">取消全选</button>${facts.length?'<button type="button" class="ghost-btn" onclick="undoFactMemoryMerge()">撤销上一次合并</button>':''}</div></div>${preview}<div class="memory-list">${factCards}</div></section>`;
    box.dataset.memoryFormSessionId=currentSessionId||'';
    syncFactMemoryScope();
    paintMemoryProgress();
    if(qs('memory-stage-draft'))qs('memory-stage-draft').value=memoryTask?.previewText||'';
    refreshDurableMemoryJobs().catch(e=>console.error('Memory journal UI:',e));
    refreshAutoRollingStatus().catch(e=>console.error('Rolling status UI:',e));
    if(!memoryMergeDraft||memoryMergeDraft.sessionId!==currentSessionId)
      restoreFactMergeDraft(currentSessionId).catch(e=>console.error('Durable merge draft read:',e));
}
async function refreshAutoRollingStatus(){
    const el=qs('rolling-auto-status'),s=currentSessionData;if(!el||!s)return;
    const msgCount=(s.messages||[]).length,ps=s.promptSettings||{},safe=Math.max(18,Number(ps.recentMessageLimit||34)-4),trigger=Number(ps.summaryTriggerMessages||28);
    const pending=Math.max(0,msgCount-safe-Math.max(0,Number(s.lastSummarizedIndex)||0));
    const sessionId=s.id;
    let job,preflight;try{[job,preflight]=await Promise.all([MimaLocalStore.getMemoryJob(sessionId,'rolling'),MimaLocalStore.getRollingPreflight(sessionId)])}
    catch(e){if(currentSessionId===sessionId)el.textContent='旧剧情整理状态读取失败（不是没有任务）：'+e.message;return;}
    if(currentSessionId!==sessionId||!el.isConnected)return;
    if(job?.status==='running'&&Number(job.leaseUntilEpoch||0)<=Date.now())el.textContent='旧剧情整理中断：已暂停收费；已有阶段候选可在任务记录中查看，手动继续前会再次确认计划';
    else if(job&&['failed','aborted','needs_review','interrupted'].includes(job.status))el.textContent=`整理失败已暂停 · ${job.code||job.stage||'查看任务诊断'} · 原文和旧摘要保留；不会因下一条剧情自动重新付费`;
    else if(job?.status==='running')el.textContent='整理进行中 · '+String(job.stage||'正在生成');
    else if(preflight?.status==='paused_no_charge'&&ps.autoRollingEnabled&&pending>=trigger){
        const cfg=MimaStandalone.getApiConfig();
        const stale=Number(preflight.sourceRevision)!==Number(s.recordRevision||0)||Number(preflight.sourceCount)!==msgCount||
          Number(preflight.allowedRequests)!==Number(ps.autoRollingMaxRequests||1)||
          (preflight.contextWindowTokens!==null && Number(preflight.contextWindowTokens)!==Number(cfg.contextWindowTokens||0));
        if(stale){el.textContent='旧剧情整理：之前的免费暂停记录已因剧情来源或预算变化而过期，未在后台重新收费或规划。请手动点击「查看请求计划并手动整理/恢复」重新核对。';return;}
        const count=preflight.requestCount?`完整计划预计 ${preflight.requestCount} 次请求`:'模型窗口或完整计划尚未核实';
        const tokens=preflight.estimatedInputTokens?`、预计输入约 ${preflight.estimatedInputTokens} tokens（离线估算）`:'';
        el.textContent=`自动整理已免费暂停：${count}${tokens}；授权上限 ${preflight.allowedRequests} 次。原因：${preflight.detail||preflight.code}。继续可能收费；目前没有发起付费请求。请点击下方「查看请求计划并手动整理/恢复」来决定是否付费。`;
    }else if(!ps.autoRollingEnabled)el.textContent='自动整理：关（已保存的旧摘要仍可按注入开关使用）';
    else if(pending<trigger){
        const configuredWindow=Number(MimaStandalone.getApiConfig()?.contextWindowTokens);
        el.textContent=`等待整理：还差约 ${trigger-pending} 条消息；当前 ${pending}/${trigger} 条较早剧情`+
          (!(configuredWindow>=4096)?'。注意：未声明可核实的模型上下文窗口，达到阈值时将免费暂停，不能直接自动收费。':'');
    }
    else el.textContent=`已满足整理条件：当前 ${pending} 条待整理；最多 ${ps.autoRollingMaxRequests||1} 次 API 请求/任务`;
}
window.addEventListener('mima:rolling-preflight',event=>{
    if(event.detail?.sessionId===currentSessionId)refreshAutoRollingStatus().catch(e=>console.error('Rolling preflight UI:',e));
});
function setCoreMemoryTarget(n){const el=qs('core-memory-target');if(el)el.value=String(n)}
function syncFactMemoryScope(){const scope=qs('fact-memory-scope')?.value||'recent',recent=qs('fact-memory-recent-wrap'),replace=qs('fact-memory-replace-wrap');if(recent)recent.style.display=scope==='recent'?'block':'none';if(replace)replace.style.display=scope==='all'?'block':'none'}
function getMemoryTemperature(){const n=Number(qs('memory-temp')?.value??memoryStore().settings.summaryTemperature??.35);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):.35}
function memoryFloatingElement(){
    let floating=qs('memory-task-floating');
    if(!floating){
        floating=document.createElement('aside');floating.id='memory-task-floating';floating.className='memory-task-floating hidden';
        const label=document.createElement('div');label.id='memory-task-floating-text';
        const actions=document.createElement('div');actions.className='memory-task-actions';
        const view=document.createElement('button');view.type='button';view.className='ghost-btn';view.textContent='查看进度';
        view.addEventListener('click',()=>{
            if(!memoryTask)return;
            if(currentSessionId===memoryTask.sessionId)openSettings('memory');
            else openSession(memoryTask.sessionId,false).then(()=>openSettings('memory'));
        });
        const stop=document.createElement('button');stop.type='button';stop.className='ghost-btn';stop.textContent='停止';stop.addEventListener('click',stopMemorySummary);
        actions.append(view,stop);floating.append(label,actions);document.body.appendChild(floating);
    }
    return floating;
}
function paintMemoryProgress(){
    const task=memoryTask,root=qs('memory-progress');
    if(root){
        const relevant=!!task&&task.sessionId===currentSessionId&&settingsTab==='memory';
        root.classList.toggle('hidden',!relevant);
        if(relevant){
            const payload=task.progress||{},n=Math.max(2,Math.min(100,Number(payload.percent)||2));
            const bar=qs('memory-progress-bar'),pct=qs('memory-progress-percent'),detail=qs('memory-progress-detail'),label=qs('memory-progress-label');
            if(bar)bar.style.width=`${n}%`;
            if(pct)pct.textContent=`${Math.round(n)}%`;
            if(detail)detail.textContent=payload.detail||'正在准备总结…';
            if(label)label.textContent=task.controller.signal.aborted?'正在停止总结…':payload.phase==='done'?'正在确认保存…':`${task.kind==='core'?'核心记忆':task.kind==='merge'?'事实合并':'事实记忆'} · 运行中`;
        }
    }
    const floating=memoryFloatingElement();floating.classList.toggle('hidden',!task);
    if(task){
        const detail=task.progress?.detail||'正在准备材料…';
        qs('memory-task-floating-text').textContent=`🧠 ${task.kind==='core'?'核心记忆':task.kind==='merge'?'事实合并':'事实记忆'} · ${task.sessionTitle} · ${task.controller.signal.aborted?'正在停止…':detail}`;
    }
}
function handleMemoryProgress(payload={}){
    if(!memoryTask)return;
    // Progress belongs to the task, not to the currently mounted settings DOM.
    const prev=Number(memoryTask.progress?.percent)||0;
    memoryTask.progress={...memoryTask.progress,...payload,percent:Math.max(prev,Number(payload.percent)||0)};
    if(typeof payload.streamText==='string')memoryTask.previewText=payload.streamText;
    if(typeof payload.stageContent==='string')memoryTask.previewText=payload.stageContent;
    const draft=qs('memory-stage-draft');if(draft)draft.value=memoryTask.previewText||'';
    paintMemoryProgress();
}
// Read-only owner diagnostics; never duplicate prompt text, API keys or the canonical history.
async function manualRollingSummary(){
    if(!currentSessionId||memoryGenerating)return toast('请先选择空闲的剧情');
    const sessionId=currentSessionId,options={temperature:getMemoryTemperature()};
    const plan=await fetchStory(`/sessions/${sessionId}/memory/rolling/plan`,'POST',options);
    if(!plan.success)return toast('无法规划旧剧情整理：'+(plan.msg||'来源/容量不可验证'));
    const d=plan.data;
    if(!window.confirm(`本次整理预计调用 ${d.requestCount} 次模型请求，可能收费。输入约 ${d.estimatedTotalInputTokens} tokens；保留原始剧情。是否确认？`))return;
    if(memoryGenerating)return toast('已有记忆任务正在运行');
    memoryGenerating=true;
    try{
        const res=await fetchStory(`/sessions/${sessionId}/memory/rolling/run`,'POST',{...options,approvedPlanDigest:d.digest});
        if(!res.success)throw Error(res.msg||'旧剧情整理失败');
        await MimaLocalStore.clearRollingPreflight(sessionId);
        toast('旧剧情整理完成，摘要已安全保存');
        if(currentSessionId===sessionId){currentSessionData=res.data;renderSettings();}
    }catch(e){toast('整理失败，旧摘要仍在：'+e.message)}
    finally{memoryGenerating=false;}
}
function memoryJobDiagnostic(job){
    const checks=Array.isArray(job?.checkpoints)?job.checkpoints:[];
    const failures=checks.filter(p=>/_error$/.test(p.stage||''));
    const latest=failures[failures.length-1]||{};
    let transport={};try{if(typeof latest.details==='string')transport=JSON.parse(latest.details);}catch(_){}
    const output={
        task:{id:job.id,kind:job.kind,status:job.status,stage:job.stage,code:job.code||latest.errorCode||'',startedAt:job.startedAt,updatedAt:job.updatedAt,attemptId:job.attemptId,sourceCount:job.sourceCount,sourceHash:job.sourceHash},
        request:{model:transport.model||job.options?.model||'(沿用当时剧情模型)',httpStatus:Number(latest.httpStatus||transport.httpStatus)||null,endpointOrigin:transport.endpointOrigin||'',requestId:transport.requestId||'',providerRequestId:transport.providerRequestId||transport.providerError?.requestId||'',requestBytes:transport.requestBytes||null,stage:transport.stage||latest.stage||job.stage,requestFields:transport.requestFields||[],providerError:transport.providerError||null,
          failureSource:transport.errorSource||'未记录',finishKind:transport.finishKind||'未记录',finishReason:transport.finishReason||'未记录',responseObserved:!!Number(latest.httpStatus||transport.httpStatus)},
        lastError:{stage:latest.stage||'',time:latest.time||'',code:latest.errorCode||job.code||'',message:latest.errorMessage||'',hint:latest.hint||'',details:latest.details||''},
        checkpoints:checks.slice(-35).map(p=>({stage:p.stage,time:p.time,errorCode:p.errorCode,elapsedMs:p.elapsedMs,chars:p.chars,partCount:p.partCount,finishReason:p.finishReason}))
    };
    return output;
}
function showMemoryJobDetails(job,root){
    if(!root)return;
    root.replaceChildren();
    const data=memoryJobDiagnostic(job);
    const summary=document.createElement('p');summary.className='helper';
    const kindLabels={http:'网关 HTTP 错误',transport:'网络请求未取得可读取响应',stream:'已连接后流式响应出错',provider_refusal:'模型明确拒绝返回正文',provider_terminal_admission:'模型终止原因拒绝/拦截',response_shape:'模型返回内容不可用',response_body_parse:'响应正文解析失败'};
    const observed=data.request.responseObserved;
    const source=data.request.failureSource;
    summary.textContent=`${data.task.kind} · ${data.task.status} · ${data.lastError.code||'无错误码'} · ${observed?'HTTP '+data.request.httpStatus:'HTTP 状态未记录'} · ${kindLabels[source]||'失败来源待核实'} · ${data.request.model}`;
    const pre=document.createElement('pre');pre.className='memory-review-source';pre.style.cssText='white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto;user-select:text';
    pre.textContent=JSON.stringify(data,null,2);
    const buttons=document.createElement('div');buttons.className='toolbar';
    const copy=document.createElement('button');copy.type='button';copy.className='tool-mini';copy.textContent='复制诊断';copy.onclick=()=>{if(!navigator.clipboard?.writeText)return toast('当前浏览器不支持直接复制，请长按选取诊断文字');navigator.clipboard.writeText(pre.textContent).then(()=>toast('已复制记忆任务诊断')).catch(()=>toast('复制失败，请长按选取诊断文字'));};
    const dl=document.createElement('button');dl.type='button';dl.className='tool-mini';dl.textContent='导出诊断 JSON';dl.onclick=()=>downloadJson(`memory-diagnostic-${data.task.kind}-${Date.now()}.json`,data);
    buttons.append(copy,dl);root.append(summary,buttons,pre);
}
async function refreshDurableMemoryJobs(){
    if(!currentSessionId||settingsTab!=='memory')return;
    const host=qs('memory-job-debts')||document.createElement('div');host.id='memory-job-debts';
    if(!host.isConnected)qs('memory-progress')?.parentNode?.appendChild(host);
    const sessionId=currentSessionId;const rows=[];
    for(const kind of ['core','facts','rolling']){
        try{const job=await MimaLocalStore.getMemoryJob(sessionId,kind);
            if(job)rows.push(job);
        }catch(e){host.textContent='记忆任务记录读取失败，禁止当作空任务：'+e.message;return;}
    }
    if(currentSessionId!==sessionId||settingsTab!=='memory')return;
    host.replaceChildren();
    const title=document.createElement('h4');title.textContent='记忆任务诊断与安全恢复';host.appendChild(title);
    const intro=document.createElement('p');intro.className='helper';intro.textContent='显示核心、事实、滚动记忆的最近一次任务，包括失败和成功记录。HTTP 400 拦截并没有产生可恢复的总结文本；查看详情可确认失败阶段和所用模型。所有失败任务不会修改原始剧情及已保存的旧记忆。';host.appendChild(intro);
    if(!rows.length){const empty=document.createElement('p');empty.className='helper';empty.textContent='当前会话没有持久化的记忆任务记录。';host.appendChild(empty);return;}
    for(const job of rows){
        const line=document.createElement('div');line.className='entry-card';
        const label=document.createElement('div');label.textContent=`${job.kind} · ${job.status} · ${job.stage} · ${job.code||''}`;line.appendChild(label);
        const actions=document.createElement('div');actions.className='toolbar';
        const detail=document.createElement('button');detail.type='button';detail.className='tool-mini';detail.textContent='查看详细错误 / 请求摘要';
        const pane=document.createElement('div');pane.hidden=true;detail.onclick=()=>{pane.hidden=!pane.hidden;if(!pane.hidden)showMemoryJobDetails(job,pane);};actions.appendChild(detail);
        const recoverable=['failed','interrupted','aborted','needs_review','running'].includes(job.status);
        if(recoverable){
            const btn=document.createElement('button');btn.className='tool-mini';btn.textContent=job.status==='running'&&Number(job.leaseUntilEpoch||0)>Date.now()?'其他窗口可能仍运行（查看状态）':'按原任务参数安全恢复';
            btn.onclick=()=>resumeMemoryJob(job.kind,job.id);actions.appendChild(btn);
            if(job.kind!=='rolling'){
                const fresh=document.createElement('button');fresh.type='button';fresh.className='tool-mini';fresh.textContent='使用当前设置新建总结';
                fresh.onclick=()=>{if(memoryTask)return toast('请等待当前任务结算再开启新任务');if(job.kind==='core')generateCoreMemory();else generateFactMemories();};actions.appendChild(fresh);
            }
            const discard=document.createElement('button');discard.type='button';discard.className='tool-mini';discard.textContent='废弃失败候选（保留任务记录）';
            discard.onclick=()=>discardMemoryCandidate(job);actions.appendChild(discard);
        }
        line.append(actions,pane);host.appendChild(line);
    }
    // Display verified persisted stage bodies, NOT just bounded diagnostic checkpoints.
    try{
      const parts=[];
      for(const kind of ['core','facts']){
        const job=rows.find(x=>x.kind===kind);
        if(!job)continue;
        const stages=await MimaLocalStore.listMemoryStages(sessionId,kind);
        for(const stage of stages)parts.push({...stage,fromCurrentSource:stage.sourceHash===job.sourceHash});
      }
      if(currentSessionId!==sessionId||settingsTab!=='memory')return;
      if(parts.length){
        const section=document.createElement('section');section.className='entry-card';
        const title=document.createElement('h4');title.textContent=`独立耐久记忆候选（${parts.length} 段）`;section.appendChild(title);
        const note=document.createElement('p');note.className='helper';note.textContent='已通过原任务持久化的阶段正文，可以查看、复制和导出；不等于正式核心/事实已提交。旧阶段不会因停止而清零。';section.appendChild(note);
        for(const stage of parts){
          const group=document.createElement('details');const label=document.createElement('summary');label.textContent=`${stage.fromCurrentSource?'当前来源':'历史来源，仅供查看'} · ${stage.kind} · ${stage.stage} · ${stage.outputLength} 字 · ${stage.createdAt||''}`;group.appendChild(label);
          const body=document.createElement('textarea');body.readOnly=true;body.className='field textarea tall';body.style.userSelect='text';body.value=stage.outputText;group.appendChild(body);
          const buttons=document.createElement('div');buttons.className='toolbar';
          const copy=document.createElement('button');copy.type='button';copy.className='tool-mini';copy.textContent='复制阶段正文';copy.onclick=()=>navigator.clipboard?.writeText(stage.outputText).then(()=>toast('已复制候选')).catch(()=>toast('复制失败，请长按选择文本'));buttons.append(copy);
          const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='tool-mini';exportButton.textContent='导出 TXT';exportButton.onclick=()=>{const blob=new Blob([stage.outputText],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`mima-memory-${stage.kind}-${stage.stage}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};buttons.append(exportButton);group.appendChild(buttons);section.appendChild(group);
        }
        host.appendChild(section);
      }
    }catch(e){const n=document.createElement('p');n.className='helper';n.textContent='耐久记忆候选读取失败，未当作空数据：'+e.message;host.appendChild(n);}
    // Independent durable candidates; only exact complete ranges can be
    // approved, and all+replace keeps its original all-or-nothing contract.
    try{
      const view=await MimaLocalStore.listFactRangeCandidates(sessionId);
      if(currentSessionId!==sessionId||settingsTab!=='memory')return;
      const ranges=view.ranges||[],eligible=ranges.filter(r=>!r.replaceExisting&&r.version===3&&r.referenceContract&&r.referenceDigest&&r.stageDigest);
      if(ranges.length){
        const section=document.createElement('section');section.className='entry-card';
        const h=document.createElement('h4');h.textContent='已保存的事实分片（独立于任务日志）';section.appendChild(h);
        const info=document.createElement('p');info.className='helper';
        info.textContent=ranges.some(r=>r.replaceExisting)?'全部替换模式必须完整总结后一次提交，禁止局部替换。':'下列范围已经生成并保存，但不等于已进入正式事实记忆。原始剧情及旧记忆不会自动改变。';section.appendChild(info);
        for(const range of ranges){
          const label=document.createElement('label');label.className='check-row';
          const cb=document.createElement('input');cb.type='checkbox';cb.className='memory-partial-range';cb.value=range.stage;
          // Pre-R4.7 ranges remain read-only historical evidence: no signed
          // reference/stage contract exists to certify a partial commit.
          const signed=range.version===3&&!!range.referenceContract&&!!range.referenceDigest&&!!range.stageDigest;
          cb.disabled=!signed||range.replaceExisting||!view.job||view.job.status==='committed'||(view.job.status==='running'&&Number(view.job.leaseUntilEpoch||0)>Date.now());
          label.append(cb,document.createTextNode(` 第 ${range.startRound}–${range.endRound} 轮 · ${range.fact?.content?.length||0} 字 · ${signed?'已保存签名候选，须复核来源':'旧版无完整引用签名，保留内容但不可直接提交'}`));section.appendChild(label);
        }
        if(eligible.length){const btn=document.createElement('button');btn.className='tool-mini';btn.type='button';btn.textContent='确认提交选中的完整成功范围';btn.onclick=async()=>{
          const selected=Array.from(section.querySelectorAll('.memory-partial-range:checked')).map(x=>x.value);
          if(!selected.length)return toast('请先选中至少一个成功区段');
          if(!confirm(`仅将选中的 ${selected.length} 个完整范围加入事实记忆？没有选中的空缺仍保持未总结，已有事实不覆盖。`))return;
          try{const operationId=`partial:${view.job.id}:${selected.slice().sort().join('|')}`;
            const snapshot=await MimaLocalStore.loadState();
            const session=snapshot.sessions.find(s=>s.id===sessionId);
            if(!session)throw new Error('E_STORY_SESSION_MISSING');
            // Read and fence the exact current facts. History changes alone
            // must not silently invalidate a manual partial commit.
            const expectedFactsSignature=MimaStandalone.memoryFactSignature(MimaMemoryContracts.normalizeManualMemory(session.manualMemory||{}).facts);
            await MimaLocalStore.commitVerifiedFactRanges(sessionId,view.job.id,selected,operationId,expectedFactsSignature);
            await MimaStandalone.init();
            if(currentSessionId===sessionId){const response=await fetchStory(`/sessions/${sessionId}`);if(response.success)currentSessionData=response.data;renderMemoryTab(qs('settings-content'));}
            toast('选中区段已原子提交；未成功区段和旧记忆未修改。');
          }catch(e){toast('部分提交被保护性拒绝：'+e.message);}
        };section.appendChild(btn);}
        host.appendChild(section);
      }
    }catch(e){const msg=document.createElement('p');msg.className='helper';msg.textContent='已保存事实分片读取失败（不视作空记录）：'+e.message;host.appendChild(msg);}
}
async function discardMemoryCandidate(job){
    if(!confirm('废弃本次失败/待审核的记忆候选？不会删除原始剧情，也不会删除已经提交的记忆。任务日志仍保留用于排障。'))return;
    try{await MimaLocalStore.dismissMemoryJob(currentSessionId,job.kind,job.id);await refreshDurableMemoryJobs();toast('已废弃错误候选，原始剧情和已提交记忆不变。');}
    catch(e){toast('废弃未完成：'+e.message);}
}
async function revokeRollingMemory(){
    if(memoryGenerating)return toast('请先停止本页记忆任务。');
    if(!confirm('撤销当前滚动剧情摘要并把摘要进度归零？原始剧情不会删除，旧摘要会保存一份可恢复副本。'))return;
    const res=await fetchStory(`/sessions/${currentSessionId}/memory/rolling`,'POST',{action:'revoke'});
    if(res.success){currentSessionData=res.data;toast('已撤销滚动摘要，剧情原文保持不变。');renderMemoryTab(qs('settings-content'));}
    else toast(res.msg||'撤销失败');
}
async function restoreRollingMemory(){
    if(memoryGenerating)return toast('请先停止本页记忆任务。');
    if(!confirm('恢复最近一次撤销的滚动摘要？只有原始来源未发生修改时才会恢复。'))return;
    const res=await fetchStory(`/sessions/${currentSessionId}/memory/rolling`,'POST',{action:'restore'});
    if(res.success){currentSessionData=res.data;toast('已恢复上一份滚动摘要。');renderMemoryTab(qs('settings-content'));}
    else toast(res.msg||'恢复失败');
}
async function resumeMemoryJob(kind,jobId){
    try{if(memoryTask)return toast('本页面仍有正在运行的记忆任务，先停止并等待结算。');
        const sessionId=currentSessionId,old=await MimaLocalStore.getMemoryJob(sessionId,kind);
        if(!old||old.id!==jobId)return toast('任务版本已发生变化，请刷新。');
        if(old.status==='running'&&Number(old.leaseUntilEpoch||0)>Date.now()){
            return toast('任务租约仍有效，可能在另一标签页运行；为避免重复结算，当前不能抢占。');
        }
        if(kind==='rolling'){
            const result=await MimaStandalone.runRecordedMemory('rolling',sessionId,old.options||{},null,null);
            toast('原滚动摘要债务已恢复并结算。');return result;
        }
        await runMemorySummary(kind,sessionId,old.options||{});
    }catch(e){toast('恢复任务失败：'+(e.code||e.message));}
    finally{refreshDurableMemoryJobs().catch(console.error);}
}
function stopMemorySummary(){
    if(!memoryTask)return toast('目前没有正在运行的记忆总结。');
    if(!memoryTask.controller.signal.aborted)memoryTask.controller.abort();
    memoryTask.progress={...memoryTask.progress,detail:'已请求停止；不提交尚未完成的结果。'};
    paintMemoryProgress();
}
function validatedSettingNumber(id,label,min,max,integer=true,allowBlank=false){
    const input=qs(id),raw=String(input?.value??'').trim(),value=raw===""&&allowBlank?0:Number(raw);
    if((!raw&&!allowBlank)||!Number.isFinite(value)||(integer&&!Number.isInteger(value))||value<min||value>max){
        toast(`${label}必须在 ${min}～${max} 范围内，未保存`);input?.focus?.();return null;
    }
    return value;
}
async function saveMemorySettings(){
    const limit=validatedSettingNumber('memory-inject-limit','事实记忆注入条数（0 为全部）',0,Number.MAX_SAFE_INTEGER);
    if(limit===null)return null;
    const temperature=validatedSettingNumber('memory-temp','记忆总结温度',0.1,2,false);
    if(temperature===null)return null;
    const factChunkRounds=validatedSettingNumber('fact-memory-chunk','每段事实记忆轮数',1,200);
    const factTargetChars=validatedSettingNumber('fact-memory-target','每段事实记忆目标字数',80,12000);
    const factRecentRounds=validatedSettingNumber('fact-memory-recent','事实记忆最近轮数',1,100000);
    if(factChunkRounds===null||factTargetChars===null||factRecentRounds===null)return null;
    const requested={injectCore:!!qs('memory-inject-core')?.checked,injectFacts:!!qs('memory-inject-facts')?.checked,factInjectionLimit:limit,summaryTemperature:temperature,memoryModel:qs('memory-model')?.value.trim()||'',factChunkRounds,factTargetChars,factScope:qs('fact-memory-scope')?.value==='all'?'all':'recent',factRecentRounds,memoryStreamMode:qs('memory-stream-mode')?.value||'inherit',
      summaryContext:{version:1,userPersona:!!qs('memory-ref-user')?.checked,characterPersona:!!qs('memory-ref-char')?.checked,
        presetIds:Array.from(document.querySelectorAll('#settings-content [data-memory-ref="preset"]:checked')).map(n=>n.value),
        worldbookMode:qs('memory-ref-mode')?.value||'none',
        worldbookIds:Array.from(document.querySelectorAll('#settings-content [data-memory-ref="book"]:checked')).map(n=>n.value),
        worldbookEntryIds:[],worldbookEntryRefs:Array.from(document.querySelectorAll('#settings-content [data-memory-ref="entry"]:checked')).map(n=>{const [bookId,entryId]=JSON.parse(n.value);return {bookId,entryId};})}};
    const targetSessionId=currentSessionId;
    const res=await fetchStory(`/sessions/${targetSessionId}/memory`,'PATCH',{settings:requested});
    if(!res.success){toast(res.msg||'保存失败');return null;}
    const returned=res.data?.manualMemory?.settings||{};
    if(Object.keys(requested).some(k=>JSON.stringify(returned[k])!==JSON.stringify(requested[k]))){
        toast('记忆设置保存后的数值与输入不一致，请检查存档');return null;
    }
    if(currentSessionId===targetSessionId){currentSessionData=res.data;if(isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));}
    toast('记忆设置已保存');return res.data;
}
async function saveCoreMemoryEdit(){
    const targetChars=validatedSettingNumber('core-memory-target','核心记忆目标字数',100,12000);
    if(targetChars===null)return null;
    const temperature=validatedSettingNumber('memory-temp','记忆总结温度',0.1,2,false);
    if(temperature===null)return null;
    const content=qs('core-memory-content')?.value||'';
    const targetSessionId=currentSessionId;
    const res=await fetchStory(`/sessions/${targetSessionId}/memory`,'PATCH',{core:{content,source:'manual',targetChars,temperature},settings:{summaryTemperature:temperature}});
    if(!res.success){toast(res.msg||'保存失败');return null;}
    if(res.data?.manualMemory?.core?.targetChars!==targetChars||res.data?.manualMemory?.settings?.summaryTemperature!==temperature){
        toast('核心记忆保存后的数值与输入不一致，请检查存档');return null;
    }
    if(currentSessionId===targetSessionId){currentSessionData=res.data;if(isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));}
    toast('核心记忆手工修改已保存');return res.data;
}
async function runMemorySummary(kind,sessionId,options){
    const task={kind,sessionId,sessionTitle:currentSessionData?.title||'当前剧情',controller:new AbortController(),progress:{phase:'preparing',percent:4,detail:'正在准备记忆材料…'}};
    memoryGenerating=true;memoryTask=task;
    if(isSettingsOpen()&&settingsTab==='memory'&&currentSessionId===sessionId)renderMemoryTab(qs('settings-content'));
    paintMemoryProgress();
    try{
        // Preview the identical frozen source/reference/window contract BEFORE the first paid POST.
        const planned=await fetchStory(`/sessions/${sessionId}/memory/plan`,'POST',{kind,options},false);
        if(!planned.success){toast('记忆规划失败，没有请求模型：'+(planned.msg||planned.code));return;}
        const plan=planned.data;
        const first=plan.stages.slice(0,12).map(x=>x.stage).join(', ');
        const warning=plan.unknownCapacityWarning?'模型实际窗口未声明；无法保证这一次完整输入被网关接受。\n':'';
        const split=plan.requiresSplit?'已按来源及窗口规划多阶段，每次会重复选中的参考信息。\n':'';
        const approved=confirm(`记忆任务付费前计划（不保证实际费用）\n${warning}${split}预计 API 请求：${plan.requestCount} 次\n输入估算：${plan.estimatedTotalInputTokens} tokens\n输出最大预算估算：${plan.estimatedOutputTokens} tokens\n每次重复参考约：${plan.referenceTokensPerRequest} tokens\n阶段：${first}${plan.requestCount>12?' …':''}\n\n确认才会开始请求；取消不花费本轮 API。`);
        if(!approved){toast('已取消记忆生成，未请求模型。');return;}
        options={...options,approvedPlanDigest:plan.digest};
        const endpoint=`/sessions/${sessionId}/memory/${kind==='core'?'core':'facts'}`;
        const res=await fetchStory(endpoint,'POST',options,false,handleMemoryProgress,task.controller.signal);
        if(!res.success && (res.aborted || task.controller.signal.aborted)){toast('记忆总结已停止，已保存的旧记忆未删除。');return;}
        if(!res.success){
            if(res.code==='E_MEMORY_NEEDS_REVIEW'){
                toast('摘要候选需要核对来源；它并非 API 故障，也没有写入长期记忆。请在下方任务记录中审核或驳回。');
                await refreshDurableMemoryJobs().catch(console.error);return;
            }
            console.error('记忆总结失败',{sessionId,kind,code:res.code,status:res.status,details:res.details,message:res.msg});
            const summary=res.code==='E_API_HTTP_400'&&/blocked|prohibited|content policy|prompt_blocked/i.test(String(res.msg||''))
                ?'HTTP 400 · 接口拒绝提交本次记忆请求'
                :`${res.code||'E_MEMORY_FAILED'} · ${String(res.msg||'未知原因').slice(0,90)}`;
            toast(`记忆总结失败：${summary}。详情与恢复入口在下方「记忆任务诊断」。`);return;
        }
        // Late replies must not switch the user's current session or reopen a closed modal.
        if(currentSessionId===sessionId){
            currentSessionData=res.data;
            refreshHeader();
        }
        try{await refreshSessionSummaryList()}
        catch(e){console.error('记忆已提交但会话列表刷新失败',{sessionId,kind,error:e});toast('记忆已保存；列表读取失败，请检查本地存储');return;}
        toast(`${task.sessionTitle} · ${kind==='core'?'核心':'事实'}记忆已保存到本地。`);
    }catch(e){console.error('记忆总结结算失败',{sessionId,kind,error:e});toast(`记忆总结未能完成：${e?.message||e}`)}
    finally{
        if(memoryTask===task){
            memoryTask=null;memoryGenerating=false;paintMemoryProgress();
            if(currentSessionId===sessionId&&isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));
        }
    }
}
async function generateCoreMemory(){
    if(memoryGenerating)return toast('当前已有一个记忆任务；剧情生成不受限制。');
    const sessionId=currentSessionId,source=qs('core-memory-source')?.value||'context',targetChars=Number(qs('core-memory-target')?.value||1000),temperature=getMemoryTemperature(),model=qs('memory-model')?.value.trim()||'';
    if(source==='facts'&&!memoryStore().facts.length)return toast('还没有事实记忆，请先生成事实记忆。');
    if(!await saveMemorySettings())return;
    await runMemorySummary('core',sessionId,{source,targetChars,temperature,model,memoryStreamMode:qs('memory-stream-mode')?.value||'inherit'});
}
async function generateFactMemories(){
    if(memoryGenerating)return toast('当前已有一个记忆任务；剧情生成不受限制。');
    const sessionId=currentSessionId,scope=qs('fact-memory-scope')?.value||'recent',chunkRounds=Number(qs('fact-memory-chunk')?.value||10),recentRounds=Number(qs('fact-memory-recent')?.value||25),targetChars=Number(qs('fact-memory-target')?.value||360),temperature=getMemoryTemperature(),model=qs('memory-model')?.value.trim()||'',replaceExisting=scope==='all'&&!!qs('fact-memory-replace')?.checked;
    if(!storyRoundCount())return toast('当前还没有可以总结的剧情轮次。');
    if(replaceExisting&&!confirm('这次“从头到尾”总结全部成功后，会用新事实记忆整体替换旧事实记忆。继续吗？'))return;
    if(!await saveMemorySettings())return;
    // Save chosen generation settings before the model call. Provider rejection
    // must not silently revert the owner's configuration to the old defaults.
    const values={factChunkRounds:validatedSettingNumber('fact-memory-chunk','每段事实记忆轮数',1,200),
        factTargetChars:validatedSettingNumber('fact-memory-target','每段事实记忆目标字数',80,12000),
        factRecentRounds:validatedSettingNumber('fact-memory-recent','事实记忆最近轮数',1,100000)};
    if(Object.values(values).some(v=>v===null))return;
    const savedSettings=await fetchStory(`/sessions/${sessionId}/memory`,'PATCH',{settings:{...values,factScope:scope,summaryTemperature:temperature,memoryModel:model}});
    if(!savedSettings.success){toast('事实总结参数未能保存，本次未启动：'+(savedSettings.msg||savedSettings.code||'未知错误'));return;}
    if(currentSessionId===sessionId)currentSessionData=savedSettings.data;
    await runMemorySummary('facts',sessionId,{scope,chunkRounds:values.factChunkRounds,recentRounds:values.factRecentRounds,targetChars:values.factTargetChars,temperature,model,replaceExisting,memoryStreamMode:qs('memory-stream-mode')?.value||'inherit'});
}
async function loadMemoryModels(){
    const select=qs('memory-model-list'),input=qs('memory-model');if(!select||!input)return;
    const previous=input.value.trim();
    try{
        const models=await MimaStandalone.listModels();
        if(!select.isConnected)return;
        select.replaceChildren();const follow=document.createElement('option');follow.value='';follow.textContent='沿用剧情模型';select.appendChild(follow);
        for(const id of models){const option=document.createElement('option');option.value=id;option.textContent=id;select.appendChild(option);}
        if(previous&&!models.includes(previous)){const option=document.createElement('option');option.value=previous;option.textContent=previous+' · 手动';select.appendChild(option);}
        select.value=previous;toast(`已取得 ${models.length} 个模型，选择后请保存记忆设置。`);
    }catch(e){toast('记忆模型列表读取失败：'+(e?.message||e));}
}
function selectMemoryModel(){const select=qs('memory-model-list'),field=qs('memory-model');if(select&&field)field.value=select.value;}
function startFactMemoryEdit(id){memoryFactEditId=id;renderMemoryTab(qs('settings-content'));}
function cancelFactMemoryEdit(){memoryFactEditId=null;renderMemoryTab(qs('settings-content'));}
async function saveFactMemoryEdit(id){
    if(memoryGenerating)return toast('有记忆任务正在运行，请等待结束。');
    const sessionId=currentSessionId,content=qs('fact-edit-'+id)?.value||'';
    if(!content.trim())return toast('正文不能留空，可以使用删除按钮');
    const res=await fetchStory(`/sessions/${sessionId}/memory/facts/${encodeURIComponent(id)}`,'PATCH',{content});
    if(!res.success)return toast(res.msg||'保存失败');
    if(currentSessionId===sessionId){currentSessionData=res.data;memoryFactEditId=null;renderMemoryTab(qs('settings-content'));}
    toast('事实记忆已按手工编辑保存');
}
function toggleMergeFactSelection(enabled){qsa('.memory-merge-select',qs('settings-content')).forEach(x=>{x.checked=enabled;});}
async function restoreFactMergeDraft(sessionId){
    const saved=await window.MimaLocalStore?.getMergeDraft?.(sessionId);
    if(!saved||!['DRAFT_PERSISTED','USER_EDITED'].includes(saved.status)||currentSessionId!==sessionId)return;
    if(memoryMergeDraft?.sessionId===sessionId&&memoryMergeDraft.draftId===saved.draftId)return;
    memoryMergeDraft=saved;memoryMergeDraft._persistedContent=String(saved.content||'');memoryMergeWriteError=null;
    if(isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));
}
// Draft editing is write-through instead of a 350ms unprotected tail window.
// A serial versioned writer coalesces keystrokes but never announces a save
// until IDB transaction completion. Browser termination while a transaction
// is in flight cannot be guaranteed; the old canonical facts remain intact.
let memoryMergeWriteError=null;
function queueFactMergeDraftSave(value){
    const draft=memoryMergeDraft;if(!draft||draft.sessionId!==currentSessionId||!draft.draftId)return;
    draft.content=String(value);
    if(draft._persistedContent===undefined)draft._persistedContent=String(draft.content||'');
    if(draft._saving)return;
    draft._saving=true;
    memoryMergeWrite=memoryMergeWrite.catch(()=>{}).then(async()=>{
        while(draft.status!=='DISCARDED'&&draft.status!=='COMMITTED'&&draft._persistedContent!==draft.content){
            const requested=draft.content;
            const saved=await window.MimaLocalStore.updateMergeDraft(draft.sessionId,draft.draftId,draft.version,requested);
            draft.version=saved.version;draft.updatedAt=saved.updatedAt;
            draft._persistedContent=requested;memoryMergeWriteError=null;
        }
    }).catch(err=>{
        memoryMergeWriteError=err;
        console.error('[MemoryMerge] durable draft save failed',{sessionId:draft.sessionId,draftId:draft.draftId,version:draft.version,error:err});
        toast('合并草稿保存失败，原始记忆未改变：'+err.message);
        throw err;
    }).finally(()=>{draft._saving=false;});
}
async function flushFactMergeDraftSave(){
    clearTimeout(memoryMergeSaveTimer);memoryMergeSaveTimer=null;
    const draft=memoryMergeDraft;
    if(draft?.draftId&&draft.status!=='DISCARDED'&&draft.status!=='COMMITTED'&&!draft._saving&&draft._persistedContent!==draft.content)
        queueFactMergeDraftSave(draft.content);
    await memoryMergeWrite;
    if(memoryMergeWriteError)throw memoryMergeWriteError;
    if(draft?.draftId&&draft.status!=='DISCARDED'&&draft.status!=='COMMITTED'&&draft._persistedContent!==draft.content){
        queueFactMergeDraftSave(draft.content);await memoryMergeWrite;
    }
    if(draft?.draftId&&draft.status!=='DISCARDED'&&draft.status!=='COMMITTED'&&draft._persistedContent!==draft.content)
        throw new Error('E_MEMORY_MERGE_DRAFT_NOT_DURABLE');
}
window.addEventListener('pagehide',()=>{
    // Fire the pending DB transaction now; never claim pagehide guarantees durability.
    if(memoryMergeDraft?.draftId&&memoryMergeDraft._persistedContent!==memoryMergeDraft.content)
        queueFactMergeDraftSave(memoryMergeDraft.content);
});
async function previewFactMemoryMerge(){
    if(memoryGenerating||factMergePlanning)return toast('另一个记忆任务尚未结束');
    const sessionId=currentSessionId,selectedIds=qsa('.memory-merge-select',qs('settings-content')).filter(x=>x.checked).map(x=>x.dataset.factId);
    if(selectedIds.length<2)return toast('请勾选至少两条事实记忆');
    const targetChars=validatedSettingNumber('memory-merge-target','合并目标字数',100,250000);
    if(targetChars===null)return;
    const temperature=getMemoryTemperature(),model=qs('memory-model')?.value.trim()||'';
    // Zero-provider-call preflight. The same backend recomputes this digest
    // immediately before the first paid request; a changed source fails shut.
    const selections={factIds:selectedIds,targetChars,temperature,model};
    factMergePlanning=true;
    let planRes;try{planRes=await fetchStory(`/sessions/${sessionId}/memory/facts/merge-plan`,'POST',selections,false);}
    catch(error){toast('付费前计划获取失败，未发出模型请求：'+(error?.message||error));return;}
    finally{factMergePlanning=false;}
    if(!planRes.success){toast('无法在收费前验证合并计划：'+(planRes.msg||planRes.code||'错误'));return;}
    const plan=planRes.data;
    if(!plan?.planDigest||!Number.isInteger(plan.requestCount)||!plan.requestCount){toast('费用计划无效，已拒绝请求');return;}
    const approved=confirm(`🧠 手动事实二次合并付费前确认\n模型：${plan.model||'当前配置'}\n选中 ${plan.selectedCount} 条事实\n完整阶段数：${plan.requestCount}，最多 ${plan.requestCount} 次模型调用\n预计输入 token 总量约 ${plan.estimatedInputTokens}（离线估算）\n容量：${plan.contextWindowTokens||'未知'} token ${plan.capacityVerifiedForAllStages?'（声明容量内）':'（未验证）'}\n已保存且合同一致的阶段将复用。\n确定批准执行此完整阶段计划？`);
    if(!approved)return toast('主人未批准合并费用：0 次付费请求');
    if(sessionId!==currentSessionId)return toast('已切换剧情，拒绝在旧剧情上执行付费合并');
    const task={kind:'merge',sessionId,sessionTitle:currentSessionData?.title||'当前剧情',controller:new AbortController(),progress:{percent:2,detail:'正在准备合并候选…'}};
    memoryTask=task;memoryGenerating=true;paintMemoryProgress();
    try{
      const res=await fetchStory(`/sessions/${sessionId}/memory/facts/merge-preview`,'POST',{...selections,approvedPlanDigest:plan.planDigest},false,handleMemoryProgress,task.controller.signal);
      if(!res.success){toast(res.aborted?'已停止合并，旧记忆未改动':res.msg||res.code||'合并候选生成失败');return;}
      memoryMergeDraft={...res.data,sessionId,_persistedContent:String(res.data.content||'')};memoryMergeWriteError=null;
      if(currentSessionId===sessionId&&isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));
      toast('合并候选已生成！旧事实记忆仍完整保留，请检查后决定是否保存。');
    }catch(e){toast('合并候选生成失败：'+(e?.message||e));}
    finally{if(memoryTask===task){memoryTask=null;memoryGenerating=false;paintMemoryProgress();if(currentSessionId===sessionId&&isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));}}
}
async function cancelFactMemoryMerge(){
    const draft=memoryMergeDraft;if(!draft)return;
    try{await flushFactMergeDraftSave();await window.MimaLocalStore.updateMergeDraft(draft.sessionId,draft.draftId,draft.version,draft.content,'discard');
    memoryMergeDraft=null;renderMemoryTab(qs('settings-content'));toast('已放弃合并候选，原记忆未改变');}
    catch(e){toast('草稿放弃操作失败，原候选保留：'+e.message);}
}
async function confirmFactMemoryMerge(){
    if(memoryGenerating)return toast('请先等待记忆任务结束');
    const draft=memoryMergeDraft;if(!draft||draft.sessionId!==currentSessionId)return toast('没有可提交的合并候选');
    const content=qs('memory-merge-result')?.value.trim()||'';if(!content)return toast('合并正文为空，请编辑后保存');
    if(!confirm(`将 ${draft.selectedIds.length} 条事实记忆替换为一条合并记忆？原文 History 不变，并可撤销上一次合并。`))return;
    const sessionId=draft.sessionId;
    try{queueFactMergeDraftSave(content);await flushFactMergeDraftSave();}catch(e){return toast('合并候选尚未安全保存，拒绝确认：'+e.message);}
    const res=await fetchStory(`/sessions/${sessionId}/memory/facts/merge-commit`,'POST',{...draft,content});
    if(!res.success)return toast('合并未提交；旧事实记忆仍在：'+(res.msg||res.code||'错误'));
    if(currentSessionId===sessionId){currentSessionData=res.data;memoryMergeDraft=null;renderMemoryTab(qs('settings-content'));}
    toast('合并已保存，旧记忆已备份，可撤销最近一次合并');
}
async function undoFactMemoryMerge(){
    if(memoryGenerating)return toast('有记忆任务正在运行');
    if(!confirm('撤销最近一次手动事实合并？若合并后事实列表已有其他修改，会拒绝覆盖。'))return;
    const sessionId=currentSessionId,res=await fetchStory(`/sessions/${sessionId}/memory/facts/merge-undo`,'POST',{});
    if(!res.success)return toast('未撤销：'+(res.msg||res.code||'无可撤销记录'));
    if(currentSessionId===sessionId){currentSessionData=res.data;memoryMergeDraft=null;renderMemoryTab(qs('settings-content'));}
    toast('已恢复合并前的全部事实记忆，原始剧情未修改');
}
async function clearCoreMemory(){if(!confirm('清空当前核心记忆？剧情原文不会受影响。'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/core`,'DELETE');if(res.success){currentSessionData=res.data;toast('核心记忆已清空');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'清空失败')}
async function deleteFactMemory(id){if(!confirm('删除这一段事实记忆？'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts/${id}`,'DELETE');if(res.success){currentSessionData=res.data;renderMemoryTab(qs('settings-content'))}else toast(res.msg||'删除失败')}
async function clearAllFactMemories(){if(!confirm('清空全部事实记忆？核心记忆和剧情原文不会被删除。'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts`,'DELETE');if(res.success){currentSessionData=res.data;toast('事实记忆已清空');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'清空失败')}
async function exportWholeLibrary(){const data=await MimaStandalone.exportLibrary();downloadJson('mimamao-tavern-full-backup.json',{format:'mimamao-tavern-standalone',version:1,exportedAt:new Date().toISOString(),data});}
function chooseLibraryImport(){qs('library-file-input').value='';qs('library-file-input').click()}
function chooseTemplateRestorePolicy(current,incoming){
    const mine=Array.isArray(current?.settingTemplates)?current.settingTemplates:[];
    const theirs=Array.isArray(incoming?.settingTemplates)?incoming.settingTemplates:[];
    if(!mine.length)return 'replace';
    const choice=window.prompt(`当前有 ${mine.length} 套剧情设置模板，备份包含 ${theirs.length} 套。\n输入 1：完整覆盖（当前模板可能被删除）\n输入 2：保留当前全部模板（备份中的模板不导入）\n输入 3：合并无冲突模板（同 ID 不同内容拒绝）\n取消：不恢复`, '2');
    return ({'1':'replace','2':'preserve','3':'merge'})[String(choice||'').trim()]||null;
}
async function importWholeLibrary(file){
    if(!file)return;
    try{
        const raw=JSON.parse(await file.text()),valid=MimaStandalone.validateLibrary(raw);
        const current=await MimaStandalone.exportLibrary();
        const describe=data=>`会话 ${data.sessions.length} / 小说 ${data.novelProjects?.length||0} / 角色卡 ${data.masks.length} / 世界书 ${data.worldbooks.length} / 预设 ${data.presets.length}`;
        const templatePolicy=chooseTemplateRestorePolicy(current,valid);if(!templatePolicy)return toast('已取消恢复：未写入资料库');
        if(!confirm(`已通过资料库结构校验。\n当前：${describe(current)}\n导入：${describe(valid)}\n\n这会替换当前资料库，建议先导出应急备份。确认覆盖吗？`))return;
        await MimaStandalone.importLibrary(raw,{templatePolicy});currentSessionId=null;currentSessionData=null;await loadAll();toast('完整酒馆备份已导入');
    }catch(e){toast(`备份导入失败（未清空现有资料）：${e.message}`)}
}


const FULL_SETTINGS_FORMAT = 'mimamao-tavern-full-settings';
const FULL_SETTINGS_VERSION = 4;
const FULL_SETTINGS_KEYS = [TEMP_KEY, LEGACY_FONT_URL_KEY, LEGACY_FONT_FAMILY_KEY, STORY_TYPO_KEY, 'mimamao_tavern_ui_font', 'mimamao_tavern_story_font', 'MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1'];

function collectPortableLocalPrefs(){
    const out={};
    for(const key of FULL_SETTINGS_KEYS){const v=localStorage.getItem(key);if(v!==null)out[key]=v}
    return out;
}
function restorePortableLocalPrefs(prefs={}){
    for(const key of FULL_SETTINGS_KEYS){
        if(Object.prototype.hasOwnProperty.call(prefs,key)) localStorage.setItem(key,String(prefs[key]??''));
    }
}
async function buildFullSettingsBackup({includeApiKey=false,includeFonts=true}={}){
    const library=await MimaStandalone.exportLibrary();
    const api={...MimaStandalone.getApiConfig()};
    if(!includeApiKey) api.apiKey='';
    const fonts=includeFonts&&MimaFontManager.exportPortable?await MimaFontManager.exportPortable():[];
    return {
        format:FULL_SETTINGS_FORMAT,
        version:FULL_SETTINGS_VERSION,
        exportedAt:new Date().toISOString(),
        warning:includeApiKey?'此文件包含 API Key（接口密钥），请勿公开分享。':'此文件未包含 API Key（接口密钥）。',
        data:{library,api,localPrefs:collectPortableLocalPrefs(),fonts,selectedFonts:{ui:MimaFontManager.getSelected('ui'),story:MimaFontManager.getSelected('story')}}
    };
}
async function saveFullSettingsSnapshot(){
    try{
        const includeApiKey=!!qs('backup-api-key')?.checked;
        const includeFonts=qs('backup-fonts')?.checked!==false;
        const backup=await buildFullSettingsBackup({includeApiKey,includeFonts});
        await MimaLocalStore.saveSettingsSnapshot(backup);
        const el=qs('data-backup-status');if(el)el.textContent=`✅ 已保存本机快照 · ${new Date().toLocaleString('zh-CN')}。注意：清除“网站数据”会连这个快照一起删除。`;
        toast('咪嘛馆设置数据已保存为本机快照');
    }catch(e){const el=qs('data-backup-status');if(el)el.textContent=`❌ 保存失败：${e.message}`;toast(`保存失败：${e.message}`)}
}
async function exportFullSettingsBackup(){
    try{
        const includeApiKey=!!qs('backup-api-key')?.checked;
        const includeFonts=qs('backup-fonts')?.checked!==false;
        if(includeApiKey&&!confirm('这份备份会包含 API Key（接口密钥）。请只保存在你自己的设备，不要上传到公开仓库或发给别人。继续导出吗？'))return;
        const backup=await buildFullSettingsBackup({includeApiKey,includeFonts});
        const stamp=new Date().toISOString().slice(0,10);
        downloadJson(`mimamao-tavern-settings-${stamp}.json`,backup);
        toast('完整咪嘛馆设置数据已导出');
    }catch(e){toast(`导出失败：${e.message}`)}
}
function chooseFullSettingsImport(){const input=qs('full-settings-file-input');input.value='';input.click()}
async function applyFullSettingsBackup(raw,{fromSnapshot=false,templatePolicy='replace'}={}){
    if(!raw||raw.format!==FULL_SETTINGS_FORMAT||Number(raw.version)>FULL_SETTINGS_VERSION)throw new Error('不是受支持的咪嘛馆完整设置备份');
    const src=raw.data;
    if(!src||typeof src!=='object'||!src.library)throw new Error('备份里缺少剧情资料 library（资料库）');
    // Before changing fonts, preferences or API keys, verify the entire canonical data shape.
    MimaStandalone.validateLibrary(src.library);
    if(src.localPrefs!==undefined&&(!src.localPrefs||typeof src.localPrefs!=='object'||Array.isArray(src.localPrefs)))throw new Error('localPrefs 结构无效');
    if(src.fonts!==undefined&&!Array.isArray(src.fonts))throw new Error('fonts 结构无效');
    // Validate canonical template preservation/merge against the CURRENT DB,
    // and decode/validate every font before any irreversible write.
    if(!MimaStandalone.previewLibraryImport)throw new Error('E_BACKUP_PREFLIGHT_UNAVAILABLE');
    await MimaStandalone.previewLibraryImport(src.library,{templatePolicy});
    const fontPlan=Array.isArray(src.fonts)&&src.fonts.length
      ? await MimaFontManager.planPortableImport(src.fonts) : null;
    const previousApi=MimaStandalone.getApiConfig(),previousPrefs=collectPortableLocalPrefs();
    let fontReceipt=null,canonicalCommitted=false,restoreWarnings=[];
    const selected={ui:MimaFontManager.getSelected('ui'),story:MimaFontManager.getSelected('story')};
    try{
        // Prepare external assets before the final canonical commit. Font imports only add assets;
        // they must never trigger an empty library write on partial import failure.
        if(fontPlan)fontReceipt=await MimaFontManager.commitPortablePlan(fontPlan);
        if(src.api&&typeof src.api==='object'){
            const incoming={...src.api};if(!incoming.apiKey)incoming.apiKey=previousApi.apiKey||'';
            MimaStandalone.saveApiConfig({...previousApi,...incoming});
        }
        restorePortableLocalPrefs(src.localPrefs||{});
        if(src.selectedFonts?.ui!==undefined)MimaFontManager.setSelected('ui',src.selectedFonts.ui||'');
        if(src.selectedFonts?.story!==undefined)MimaFontManager.setSelected('story',src.selectedFonts.story||'');
        const restored=await MimaStandalone.importLibrary(src.library,{templatePolicy}); // last; atomic compare-and-swap
        canonicalCommitted=true; // commit boundary: later UI work must never undo or misreport canonical
        restoreWarnings=Array.isArray(restored?.importWarnings)?restored.importWarnings:[];
    }catch(e){
        if(canonicalCommitted){
            // A post-commit error is NOT a failed DB restore. Keep canonical + font receipt.
            console.error('E_FULL_RESTORE_POST_COMMIT: 资料库已提交，后续非事务步骤失败',e);
            return {canonicalCommitted:true,uiRefreshed:false,warnings:['已提交，后续刷新失败：'+(e?.message||String(e))]};
        }
        let rollbackError=null;
        if(fontReceipt)try{await MimaFontManager.rollbackPortablePlan(fontReceipt);}catch(issue){rollbackError=issue;}
        MimaStandalone.saveApiConfig(previousApi);
        for(const key of FULL_SETTINGS_KEYS){if(Object.prototype.hasOwnProperty.call(previousPrefs,key))localStorage.setItem(key,previousPrefs[key]);else localStorage.removeItem(key)}
        MimaFontManager.setSelected('ui',selected.ui||'');MimaFontManager.setSelected('story',selected.story||'');
        applyStoryTypography();restoreLegacyFont();
        if(rollbackError){const partial=new Error('E_FULL_RESTORE_PARTIAL: 字体回滚失败，本次恢复未完成；请保留网站数据并检查诊断：'+rollbackError.message);partial.cause=e;throw partial;}
        throw e;
    }
    // Canonical is already durable. Appearance and UI refresh cannot retroactively
    // turn this into a failed import (which would tempt a second destructive restore).
    try{
        applyStoryTypography();restoreLegacyFont();
        currentSessionId=null;currentSessionData=null;
        await loadAll();
        if(!fromSnapshot)openSettings('data');
    }catch(e){
        console.error('E_FULL_RESTORE_POST_COMMIT: 资料库已提交，界面刷新失败',e);
        return {canonicalCommitted:true,uiRefreshed:false,warnings:[...restoreWarnings,'外观或页面刷新失败：'+(e?.message||String(e))]};
    }
    return {canonicalCommitted:true,uiRefreshed:true,warnings:restoreWarnings};
}
async function importFullSettingsFile(file){
    if(!file)return;
    if(!confirm('导入完整设置会用备份中的剧情/角色卡/世界书/预设/CSS 数据覆盖当前资料库，并恢复外观与 API 配置。继续吗？'))return;
    try{const raw=JSON.parse(await file.text());const policy=chooseTemplateRestorePolicy(await MimaStandalone.exportLibrary(),raw?.data?.library);if(!policy)return;const result=await applyFullSettingsBackup(raw,{templatePolicy:policy});toast(result?.uiRefreshed?'完整咪嘛馆设置数据已恢复':'资料库已成功恢复，但界面刷新失败；请刷新页面查看，勿重复导入');if(result?.warnings?.length)console.warn('设置恢复附加诊断：',result.warnings)}catch(e){toast(`完整设置导入失败：${e.message}`)}
}
async function restoreSavedSettingsSnapshot(){
    try{
        const snap=await MimaLocalStore.loadSettingsSnapshot();
        if(!snap)return toast('当前浏览器还没有保存过咪嘛馆设置快照');
        if(!confirm(`恢复本机设置快照？\n保存时间：${snap.savedAt||snap.exportedAt||'未知'}\n\n这会覆盖当前剧情资料库。`))return;
        const policy=chooseTemplateRestorePolicy(await MimaStandalone.exportLibrary(),snap?.data?.library);if(!policy)return;
        const result=await applyFullSettingsBackup(snap,{fromSnapshot:true,templatePolicy:policy});
        if(result?.uiRefreshed){openSettings('data');toast('本机设置快照已恢复')}else toast('快照数据已经成功保存，但界面刷新失败；请刷新页面，勿重复恢复');
        if(result?.warnings?.length)console.warn('快照恢复附加诊断：',result.warnings);
    }catch(e){toast(`恢复快照失败：${e.message}`)}
}
async function renderDataTab(box,renderEpoch=++settingsRenderEpoch){
    let snap=null;try{snap=await MimaLocalStore.loadSettingsSnapshot()}catch(_){ }
    if(!settingsRenderIsCurrent('data',renderEpoch,box))return;
    const cfg=MimaStandalone.getApiConfig();
    box.innerHTML=`<section class="settings-section"><h3>💾 Data Backup（数据备份）</h3><p class="helper">这里备份的不只是剧情，还包括角色卡、世界书、预设、正则包、CSS Preset（CSS 预设）、API（接口）参数、温度/流式设置、字体选择；可选把本地字体文件也一起装进备份。普通“刷新 / 强制刷新”不会删除这些数据，但 Safari 的“清除历史记录与网站数据”或删除网站数据会清掉 IndexedDB（本地数据库）和 localStorage（本地存储），所以真正保险的是导出 JSON（数据文件）到“文件”App。</p>
    <div class="data-backup-card"><div class="row-title">本机设置快照</div><div class="row-sub">${snap?`最近保存：${escapeHtml(snap.savedAt||snap.exportedAt||'已保存')}`:'尚未保存本机快照'}</div><div class="toolbar"><button class="primary-btn" onclick="saveFullSettingsSnapshot()">保存咪嘛馆设置数据</button><button class="ghost-btn" onclick="restoreSavedSettingsSnapshot()">恢复本机快照</button></div></div>
    <div class="data-backup-card"><div class="row-title">可迁移完整备份</div><div class="row-sub">导出的文件可以在清缓存、换浏览器、换设备或重新部署后再导入。</div><label class="check-row"><input id="backup-fonts" type="checkbox" checked> 把本地字体文件也加入备份（文件可能变大）</label><label class="check-row"><input id="backup-api-key" type="checkbox"> 把 API Key（接口密钥）加入导出/快照 <strong>（敏感）</strong></label><div class="toolbar"><button class="primary-btn" onclick="exportFullSettingsBackup()">⇩ 导出完整设置</button><button class="ghost-btn" onclick="chooseFullSettingsImport()">⇧ 导入完整设置</button></div><div class="row-sub">当前 API（接口）：${cfg.apiBase?escapeHtml(cfg.apiBase):'未配置'} · Model（模型）：${cfg.model?escapeHtml(cfg.model):'未选择'}</div></div>
    <div id="data-backup-status" class="api-status">${snap?'✅ 当前浏览器已有本机快照。':'建议先保存一次本机快照，再导出一份文件备份。'}</div></section>
    <section class="settings-section"><h3>🧹 Cache（缓存）说明</h3><p class="helper"><strong>只想让 GitHub Pages 加载新代码时，不需要先清除网站数据。</strong>本版已经给 CSS / JS 资源加入版本号 <code>?v=1.1.0</code>，部署后浏览器会把它们当成新资源重新拉取。若仍显示旧页面，先关闭该标签页再重新打开，或做一次强制刷新；不要直接使用会删除网站数据的清理方式，除非你已经导出了完整设置备份。</p></section>`;
}

async function renderAppearanceTab(box,renderEpoch=++settingsRenderEpoch){
    let fontReadError=null,records;
    try{records=await MimaFontManager.all()}catch(error){fontReadError=error;records=[];console.error('外观字体库读取失败，未更改字体存储或偏好',error)}
    if(!settingsRenderIsCurrent('appearance',renderEpoch,box))return;
    if(!fontReadError)fontRecords=records;
    const ui=MimaFontManager.getSelected('ui'),story=MimaFontManager.getSelected('story'),typo=getStoryTypography();const opts=`<option value="">系统默认字体</option>`+(fontReadError?[]:fontRecords).map(f=>`<option value="${escapeHtml(f.family)}">${escapeHtml(f.family)} · ${formatBytes(f.size)}</option>`).join('');const themeState=MimaStandalone.getState?.().themeSettings||{theme:'default'},themeCards=(MimaThemeEngine?.getBuiltins?.()||[]).map(t=>`<button class="novel-theme-card ${themeState.theme===t.id?'active':''}" data-theme-choice="${t.id}" onclick="setBuiltInTheme('${t.id}')"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.description)}</span></button>`).join('');box.innerHTML=`<section class="settings-section"><h3>🌓 Built-in Theme（内置主题）</h3><p class="helper">Default 保留原始外观；深色、电子墨水、暖纸与韩系柔色主题覆盖聊天、设置、小说及助手的常用组件。全局自定义 CSS 仍优先；如果已挂载全局 CSS，实际颜色可能不同。</p><div class="novel-theme-grid">${themeCards}</div></section><section class="settings-section"><h3>🎨 本地字体库</h3><p class="helper">直接导入 TTF / OTF / WOFF / WOFF2（字体文件格式）。文件保存在当前浏览器 IndexedDB，不需要转 URL（链接），也不会上传到服务器。剧情正文字体会作用于普通小说正文；开启 Safe HTML（安全 HTML）后，未自行指定字体的 HTML 正文也会继承它。状态栏若有自己的 CSS 字体设置，仍以状态栏自己的设置为准。</p><div class="toolbar"><button class="primary-btn" onclick="chooseFontImport()">＋ 导入字体文件</button></div><div class="form-grid"><div><label class="form-label">UI（界面）字体</label><select id="font-ui-select" class="field" onchange="changeFont('ui',this.value)">${opts}</select></div><div><label class="form-label">剧情正文字体</label><select id="font-story-select" class="field" onchange="changeFont('story',this.value)">${opts}</select></div></div><div id="font-list" style="margin-top:14px"></div></section>
<section class="settings-section"><h3>📖 Novel Typography（小说正文排版）</h3><p class="helper">进入本页会自动打开上方实时预览。字号、正文字体、行高与字间距也会作为 Safe HTML 的基础继承值；段间距与首行缩进仍只作用于咪嘛馆识别出的普通小说段落，不会强行挤压 &lt;system&gt; / &lt;details&gt; / 表格等状态栏结构。</p>
<div class="typography-grid">
${typographyControlHtml('字号','fontSize',12,26,.5,typo.fontSize,'px')}
${typographyControlHtml('行间距','lineHeight',1.2,2.6,.05,typo.lineHeight,'')}
${typographyControlHtml('段间距','paragraphGap',0,3,.05,typo.paragraphGap,'em')}
${typographyControlHtml('字间距','letterSpacing',-.04,.18,.005,typo.letterSpacing,'em')}
${typographyControlHtml('首行缩进','firstLineIndent',0,4,.25,typo.firstLineIndent,'em')}
</div><div class="typography-indent-hint"><span>中文小说推荐：<strong>2em</strong>（约两个汉字宽）</span><div class="typography-quick-buttons"><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',0)">0</button><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',1)">1em</button><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',2)">2em</button><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',3)">3em</button></div></div><div class="toolbar typography-actions"><button class="ghost-btn" onclick="resetStoryTypography()">恢复默认排版</button></div></section>
<section class="settings-section"><h3>兼容旧版 URL（链接）字体</h3><p class="helper">旧功能保留。如果某个字体只能用网页链接，也仍然可以加载。</p><div class="form-grid"><div><label class="form-label">字体 URL（链接）</label><input id="legacy-font-url" class="field" value="${escapeHtml(localStorage.getItem(LEGACY_FONT_URL_KEY)||'')}"></div><div><label class="form-label">Font Family（字体族名）</label><input id="legacy-font-family" class="field" value="${escapeHtml(localStorage.getItem(LEGACY_FONT_FAMILY_KEY)||'')}"></div><div class="form-full"><button class="ghost-btn" onclick="applyLegacyUrlFont()">应用 URL（链接）字体</button></div></div></section>
${window.MimaChatWallpaper?.markup?.()||''}<section class="settings-section"><h3>🪄 CSS Preset Library（CSS 预设库）</h3><p class="helper">支持直接粘贴或导入<strong>纯 CSS</strong>，不需要手动包 &lt;style&gt;。CSS 可以只美化模型输出的自定义 HTML，也可以覆盖剧情区域，或选择“咪嘛馆全局”直接二改整个 UI（界面）。模型输出本身仍经过 Safe HTML sanitizer（安全 HTML 清洗器），不会执行 &lt;script&gt; / &lt;style&gt;。</p><div class="toolbar css-default-tools"><button class="primary-btn" onclick="openCssPresetEditor()">＋ 新建 CSS（样式）</button><button class="ghost-btn" onclick="chooseCssImport()">⇧ 导入 .css（样式文件）</button><button class="ghost-btn" onclick="copyDefaultCss()">⧉ 一键复制默认 CSS（样式）</button><button class="ghost-btn" onclick="exportDefaultCss()">⇩ 导出默认 CSS（样式）</button><button class="ghost-btn" onclick="forkDefaultCss()">✦ 默认 CSS 二改</button><button class="ghost-btn" onclick="MimaAssistantStudio.open('css')">✦ CSS 美化助手</button><button class="danger-btn" onclick="emergencyDisableCss()">🚑 临时禁用自定义 CSS（样式）</button></div><div class="toolbar"><button class="ghost-btn" onclick="stopAtelierAndRestoreCss()">一键停用工坊并恢复原 CSS</button></div><div class="row-sub css-scope-note">Scope（作用域）：自定义 HTML / Chat / Novel / Assistant / 咪嘛馆全局。Novel 与 Assistant 使用稳定公开 selector；全局 CSS 仍拥有最高覆盖能力。</div><div class="row-sub" style="margin:8px 0 12px">当前聊天：${currentCssPreset()?escapeHtml(currentCssPreset().name):'未挂载'} · ${currentSessionData?.customCssEnabled===false?'已禁用':'已启用'}</div><div class="toolbar">${currentSessionData?.customCssId?'<button class="ghost-btn" onclick="unapplyCss()">取消应用</button>':''}${currentSessionData?.customCssId&&currentSessionData?.customCssEnabled===false?'<button class="ghost-btn" onclick="reenableCss()">重新启用</button>':''}</div><button class="ghost-btn" onclick="unapplyGlobalCssPreset()">取消全局 CSS</button>${mimaLibraryToolbar('css',cssPresets)}<div id="css-preset-list" class="card-grid css-preset-grid" style="margin-top:12px"></div></section>
<section class="settings-section"><h3>显示</h3><label class="check-row"><input id="render-html-setting" type="checkbox" ${currentSessionData?.renderMode==='safe_html'?'checked':''} onchange="toggleSafeHtml(this.checked)"> 允许 Safe HTML（安全 HTML）状态栏渲染</label><p class="helper">开启后会保留正文原有换行与空格，并支持 &lt;system&gt;、&lt;details&gt;、&lt;summary&gt;、区块、表格等安全结构，方便 CSS 状态栏直接生效。</p></section>`;qs('font-ui-select').value=ui;qs('font-story-select').value=story;const root=qs('font-list');if(fontReadError){root.textContent='字体库读取失败，原字体和选择均未更改：'+(fontReadError.message||String(fontReadError));}else if(!fontRecords.length)root.innerHTML='<div class="row-sub">还没有本地字体。</div>';if(!fontReadError)fontRecords.forEach(f=>{const r=document.createElement('div');r.className='font-row';r.innerHTML=`<div class="row-main"><div class="row-title" style="font-family:'${escapeHtml(f.family)}'">Aa　${escapeHtml(f.family)}</div><div class="row-sub">${escapeHtml(f.name)} · ${formatBytes(f.size)}</div></div><button class="danger-btn" onclick="deleteLocalFont('${f.id}')">删除</button>`;root.appendChild(r)});renderCssPresetLibrary(qs('css-preset-list'));syncStoryTypographyControls(typo)}
function typographyControlHtml(label,key,min,max,step,value,unit){return `<div class="typography-control"><div class="typography-control-head"><label class="form-label" for="typo-${key}-range">${label}</label><span id="typo-${key}-value" class="value-pill">${storyTypoDisplay(key,value)}</span></div><div class="typography-control-row"><input id="typo-${key}-range" class="typography-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}" oninput="updateStoryTypography('${key}',this.value)"><input id="typo-${key}-number" class="field typography-number" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}" onchange="updateStoryTypography('${key}',this.value)"><span class="typography-unit">${unit}</span></div></div>`}
async function setBuiltInTheme(theme){const res=await fetchStory('/theme','PATCH',{theme});if(!res.success)return toast(res.msg||'主题切换失败');MimaThemeEngine?.apply?.(res.data);if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast(`主题已切换为 ${theme}`)}
function currentCssPreset(){return cssPresets.find(x=>x.id===currentSessionData?.customCssId)||null}
function ensureCustomCssStyle(){let tag=qs('mima-custom-css-style');if(!tag){tag=document.createElement('style');tag.id='mima-custom-css-style';document.head.appendChild(tag)}return tag}
function stripEmbeddedStyleTags(css){return String(css||'').replace(/<\/?style\b[^>]*>/gi,'')}
function findMatchingBrace(src,open){let depth=0,quote='',comment=false;for(let i=open;i<src.length;i++){const ch=src[i],next=src[i+1];if(comment){if(ch==='*'&&next==='/'){comment=false;i++}continue}if(!quote&&ch==='/'&&next==='*'){comment=true;i++;continue}if(quote){if(ch==='\\'){i++;continue}if(ch===quote)quote='';continue}if(ch==='"'||ch==="'"){quote=ch;continue}if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return i}return-1}
function scopeCssBlock(css,scope){let out='',cursor=0;const src=String(css||'');while(cursor<src.length){const open=src.indexOf('{',cursor);if(open<0){out+=src.slice(cursor);break}const close=findMatchingBrace(src,open);if(close<0){out+=src.slice(cursor);break}const header=src.slice(cursor,open);const trimmed=header.trim();const body=src.slice(open+1,close);if(!trimmed){out+=header+'{'+body+'}'}else if(/^@(media|supports|container|layer|document)\b/i.test(trimmed)){out+=header+'{'+scopeCssBlock(body,scope)+'}'}else if(/^@(keyframes|-webkit-keyframes|font-face|page|property|counter-style)\b/i.test(trimmed)){out+=header+'{'+body+'}'}else if(trimmed.startsWith('@')){out+=header+'{'+body+'}'}else{const lead=header.slice(0,header.indexOf(trimmed));const selectors=trimmed.split(',').map(sel=>sel.trim()).filter(Boolean).map(sel=>{if(sel===scope||sel.startsWith(scope+' ')||sel.startsWith(scope+':'))return sel;if(/^(from|to|\d+(?:\.\d+)?%)$/i.test(sel))return sel;return cssScopeSelector(sel,scope)}).join(', ');out+=lead+selectors+'{'+body+'}'}cursor=close+1}return out}
function cssScopeSelector(selector,scope){
    const clean=selector.trim();if(!clean)return'';
    if(clean===scope||clean.startsWith(scope+' ')||clean.startsWith(scope+':'))return clean;
    // .msg-content IS the scoped story root; nesting it below itself makes user font CSS dead.
    const withoutDocumentRoot=clean.replace(/^(?:html|body|:root)(?=\s|[.#:[>+~]|$)\s*/i,'').trim();
    const match=withoutDocumentRoot.match(/^(?:\.msg-content|\.tavern-story-content)(?=\s|[.#:[>+~]|$)/);
    if(match){
        const rest=withoutDocumentRoot.slice(match[0].length);
        return rest ? ( /^\s/.test(rest)?`${scope} ${rest.trim()}`:`${scope}${rest}`) : scope;
    }
    return withoutDocumentRoot?`${scope} ${withoutDocumentRoot}`:scope;
}
function splitCssSelectorList(input){
    const out=[];let part='',depth=0,quote='',escaped=false;
    for(const ch of String(input)){
        if(escaped){part+=ch;escaped=false;continue;}
        if(ch==='\\'){part+=ch;escaped=true;continue;}
        if(quote){part+=ch;if(ch===quote)quote='';continue;}
        if(ch==='"'||ch==="'"){quote=ch;part+=ch;continue;}
        if(ch==='('||ch==='[')depth++;
        else if(ch===')'||ch===']')depth--;
        if(ch===','&&depth===0){if(part.trim())out.push(part.trim());part='';continue;}
        part+=ch;
    }
    if(part.trim())out.push(part.trim());return out;
}
function scopeCssWithBrowserParser(css,scope){
    if(typeof CSSStyleSheet==='undefined'){if(/@import\s/i.test(css))throw new Error('Scoped CSS 不支持 @import；请使用全局 CSS');return scopeCssBlock(css,scope);}
    const sheet=new CSSStyleSheet();sheet.replaceSync(css);
    const mapRules=rules=>Array.from(rules).map(rule=>{
        if(rule.type===CSSRule.STYLE_RULE)return splitCssSelectorList(rule.selectorText).map(sel=>cssScopeSelector(sel,scope)).join(', ')+'{'+rule.style.cssText+'}';
        if(rule.type===CSSRule.IMPORT_RULE)throw new Error('Scoped CSS 不允许 @import 跨作用域加载外部样式；请使用全局 CSS 或直接粘贴规则');
        if(rule.cssRules&&rule.type!==CSSRule.KEYFRAMES_RULE)return rule.cssText.slice(0,rule.cssText.indexOf('{'))+'{'+mapRules(rule.cssRules)+'}';
        return rule.cssText; // keyframes/font-face preserve legacy behavior (global namespaces)
    }).join('\n');
    return mapRules(sheet.cssRules);
}
function compileCustomCss(preset,targetSurface=null){if(!preset?.css)return'';const clean=stripEmbeddedStyleTags(preset.css);if(preset.scope==='app'||preset.surface==='global'&&preset.scope==='app')return clean;const surface=targetSurface||preset.surface||(preset.scope==='novel'?'novel':preset.scope==='assistant'?'assistant':'chat');if(surface==='novel')return scopeCssWithBrowserParser(clean,'.novel-studio-root');if(surface==='assistant')return scopeCssWithBrowserParser(clean,'.assistant-studio-panel');const scope=preset.scope==='global'?'#story-chat-box.tavern-story-scope':'.tavern-story-content';return scopeCssWithBrowserParser(clean,scope)}
function ensureGlobalCssStyle(){let tag=qs('mima-global-css-style');if(!tag){tag=document.createElement('style');tag.id='mima-global-css-style';document.head.appendChild(tag)}return tag}
let cssPaintEpoch=0;
function applyCustomCss(){
  const generation=++cssPaintEpoch,tag=ensureCustomCssStyle(),globalTag=ensureGlobalCssStyle(),preset=currentCssPreset();
  const safeCssBypass=new URLSearchParams(location.search).get('noCss')==='1';
  const setting=MimaStandalone.getState?.().themeSettings||{},globalPreset=cssPresets.find(x=>x.id===setting.globalCssPresetId&&x.scope==='app');
  // A six-megabyte legacy CSS must not be parsed merely to hide it under an exclusive Atelier theme.
  if(!safeCssBypass&&window.MimaAtelierCore?.getPresentationMode?.()==='atelier-only'){
    tag.textContent='';globalTag.textContent='';window.MimaAtelierCore.releaseAssets('library-session');window.MimaAtelierCore.releaseAssets('library-global');window.MimaAtelierCore.reaffirm();return;
  }
  const sessionPreset=!safeCssBypass&&currentSessionData?.customCssEnabled!==false?preset:null;
  const appPreset=!safeCssBypass&&setting.globalCssEnabled!==false?globalPreset:null;
  const libraryStyle=[{tag,p:sessionPreset},{tag:globalTag,p:appPreset}];
  // New lightweight Atelier CSS references an immutable project snapshot. CSS and assets become visible together.
  for(const item of libraryStyle){const {tag:element,p}=item;
    if(!p){element.textContent='';window.MimaAtelierCore?.releaseAssets?.(element.id==='mima-global-css-style'?'library-global':'library-session');continue;}
    if(p.atelierReleaseKey){
      element.textContent='';
      const engine=window.MimaAtelierCore;
      if(!engine?.resolveLibraryCss){console.warn('[CSS library] Atelier asset bridge not ready',p.id);continue;}
      engine.resolveLibraryCss(p,element.id==='mima-global-css-style'?'library-global':'library-session').then(result=>{
        if(generation!==cssPaintEpoch){result.discard();return;}
        try{element.textContent=compileCustomCss({...p,css:result.css});result.accept();engine.reaffirm();}
        catch(e){result.discard();console.error('[CSS library] asset style application failed',e);toast('工坊预设资源应用失败：'+e.message);}
      }).catch(e=>{if(generation!==cssPaintEpoch)return;console.error('[CSS library] preserved unresolved project',p.id,e);toast('工坊预设资源读取失败（原数据未更改）：'+e.message);});
    }else {
      window.MimaAtelierCore?.releaseAssets?.(element.id==='mima-global-css-style'?'library-global':'library-session');
      try{element.textContent=compileCustomCss(p);}catch(e){element.textContent='';console.error('Scoped CSS 已拒绝无效规则',e);toast(`CSS 作用域解析失败：${e.message}`);}
    }
  }
  window.MimaAtelierCore?.reaffirm?.();
}
window.addEventListener('mima-atelier-presentation-change',()=>applyCustomCss());
window.addEventListener('load',()=>{window.MimaAtelierCore?.ready?.then(()=>applyCustomCss()).catch(e=>console.error('[CSS library] Atelier readiness',e));});
async function selectLegacyCssAppearance(action){const core=window.MimaAtelierCore;const prev=core?.getApplied?.();if(prev)await core.unapply();try{return await action();}catch(e){if(prev){try{await core.apply(prev);}catch(recovery){console.error('[Appearance] cannot restore previous active theme',recovery);toast('普通 CSS 应用失败且工坊恢复失败，原数据均保留：'+recovery.message)}}throw e;}}
async function stopAtelierAndRestoreCss(){try{await window.MimaAtelierCore?.unapply?.();applyCustomCss();toast('工坊外观已停用，普通 CSS 已恢复（无数据删除）');if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));}catch(e){toast('停用工坊失败：'+e.message)}}
async function applyGlobalCssPreset(id){const preset=cssPresets.find(x=>x.id===id&&x.scope==='app');if(!preset)return toast('只能全局应用咪嘛馆全局范围 CSS');try{await selectLegacyCssAppearance(async()=>{const r=await fetchStory('/theme','PATCH',{globalCssPresetId:id,globalCssEnabled:true});if(!r.success)throw Error(r.msg||'全局 CSS 挂载失败')});}catch(e){return toast('切换到普通 CSS 失败：'+e.message)}applyCustomCss();renderCssPresetLibrary(qs('css-preset-list'));toast('已切换为普通全局 CSS（工坊暂已停用，工程保留）')}
async function unapplyGlobalCssPreset(){const r=await fetchStory('/theme','PATCH',{globalCssPresetId:null,globalCssEnabled:false});if(!r.success)return toast(r.msg||'取消失败');applyCustomCss();renderCssPresetLibrary(qs('css-preset-list'));toast('已禁用全局 CSS')}
function cssScopeLabel(scope){return scope==='app'?'咪嘛馆全局 Scope（作用域）':scope==='novel'?'Novel Studio（小说工作区）':scope==='assistant'?'Assistant Studio（助手工作区）':scope==='global'?'剧情面板级 Scope（作用域）':'自定义 HTML 内容级 Scope（作用域）'}
function renderCssPresetLibrary(root){if(!root)return;const active=currentSessionData?.customCssId,globalId=MimaStandalone.getState?.().themeSettings?.globalCssPresetId;
 const list=mimaVisibleResources('css',cssPresets);root.innerHTML='';if(!list.length){root.innerHTML='<div class="row-sub">当前筛选下没有 CSS 预设。</div>';return;}
 list.sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||String(a.name).localeCompare(String(b.name),'zh')).forEach(p=>{const global=p.scope==='app',mounted=global?p.id===globalId:p.id===active;const row=document.createElement('div');row.className=`library-card ${mounted?'mounted':''}`;row.innerHTML=`<div class="card-title"><span>${escapeHtml(p.name)}</span>${mounted?`<span class="tag">${global?'全局挂载':'当前 Session'}</span>`:''}</div><div class="card-desc">${escapeHtml(p.category||'未分类')} · ${cssScopeLabel(p.scope)} · ${String(p.css||'').length} 字符</div><div class="card-actions"><button class="${mounted?'primary-btn':'ghost-btn'}" onclick="${global?'applyGlobalCssPreset':'applyCssPreset'}('${p.id}')">${global?'应用到全局':mounted?'重新启用':'应用到聊天'}</button><button class="ghost-btn" onclick="mimaToggleFavorite('css','${p.id}')">${p.favorite?'★ 已收藏':'☆ 收藏'}</button><button class="ghost-btn" onclick="openCssPresetEditor('${p.id}')">编辑</button>${String(p.css||'').length>200000&&mounted?`<button class="danger-btn" onclick="${global?'unapplyGlobalCssPreset':'unapplyCss'}()">停用大型 CSS</button>`:''}<button class="ghost-btn" onclick="duplicateCssPreset('${p.id}')">复制</button><button class="ghost-btn" onclick="exportCssPreset('${p.id}')">导出</button></div>`;root.appendChild(row);});
}
function openCssPresetEditor(id=null){const p=id?cssPresets.find(x=>x.id===id):{name:'',css:'',scope:'story'};const giant=String(p?.css||'').length>200000;editorState={type:'css-preset',id,giant,loaded:!giant};qs('editor-title').textContent=id?`编辑 CSS · ${p?.name||''}`:'新建 CSS Preset（CSS 预设）';qs('editor-eyebrow').textContent='CSS PRESET（CSS 预设）';qs('editor-body').innerHTML=`<div class="form-grid"><div class="form-full"><label class="form-label">名称</label><input id="css-pre-name" class="field" value="${escapeHtml(p?.name||'')}"></div><div class="form-full"><label class="form-label">分类</label><input id="css-pre-category" class="field" value="${escapeHtml(p?.category||'未分类')}"></div><div class="form-full"><label class="form-label">Scope（作用域）</label><select id="css-pre-scope" class="field"><option value="story" ${p?.scope==='story'||!p?.scope?'selected':''}>自定义 HTML / 剧情内容（最安全）</option><option value="global" ${p?.scope==='global'?'selected':''}>剧情聊天区域</option><option value="app" ${p?.scope==='app'?'selected':''}>咪嘛馆全局 UI + HTML（全局二改）</option><option value="novel" ${p?.scope==='novel'?'selected':''}>Novel Studio（小说）</option><option value="assistant" ${p?.scope==='assistant'?'selected':''}>Assistant Studio（助手）</option></select><div class="row-sub">“咪嘛馆全局”会按原样应用 CSS，可修改顶栏、设置中心、输入框和剧情 HTML；若样式把 UI 隐藏，请重新打开页面后在外观里点“🚑 临时禁用”；极端情况下可在网址末尾加 <code>?noCss=1</code> 进入 CSS 安全模式。</div></div><div class="form-full">${giant?`<div class="row-sub" style="padding:12px;border:1px solid currentColor">这个 CSS 有 ${String(p.css).length.toLocaleString()} 字符，暂不加载到编辑框以免卡住手机。原始内容已保留。<button type="button" class="ghost-btn" onclick="mimaLoadLargeCssForEdit()">确认后加载巨型 CSS</button></div>`:''}<label class="form-label">CSS（样式）</label><textarea id="css-pre-code" class="field textarea tall css-code-editor" spellcheck="false" placeholder="/* 直接写 CSS，不用 <style> */&#10;system, .status-card { padding: 12px; border-radius: 16px; }">${giant?'':escapeHtml(p?.css||'')}</textarea></div></div>`;setupEditorButtons(id?()=>deleteCssPreset(id):null,saveCssPresetEditor);qs('editor-modal').classList.remove('hidden')}
function mimaLoadLargeCssForEdit(){if(editorState?.type!=='css-preset'||!editorState.giant)return;const p=cssPresets.find(x=>x.id===editorState.id);if(!p)return toast('原始 CSS 已不存在；未改变任何数据');if(!confirm(`确定加载 ${String(p.css).length.toLocaleString()} 字符 CSS？低内存手机可能卡顿。`))return;qs('css-pre-code').value=p.css;editorState.loaded=true;}
async function saveCssPresetEditor(){if(editorState?.giant&&!editorState.loaded)return toast('巨型 CSS 尚未加载，不能覆盖原记录。请先确认加载或直接关闭。');const wantedScope=qs('css-pre-scope').value;const body={name:qs('css-pre-name').value.trim()||'未命名 CSS（样式）',category:(qs('css-pre-category').value||'未分类').trim().slice(0,60),scope:['story','global','app','novel','assistant'].includes(wantedScope)?wantedScope:'story',surface:wantedScope==='novel'?'novel':wantedScope==='assistant'?'assistant':wantedScope==='app'?'global':'chat',css:stripEmbeddedStyleTags(qs('css-pre-code').value),atelierReleaseKey:''};const res=await fetchStory(editorState.id?`/css-presets/${editorState.id}`:'/css-presets',editorState.id?'PATCH':'POST',body);if(!res.success)return toast(res.msg||'保存 CSS 失败');const saved=res.data;closeEditor();await loadAll();applyCustomCss();openSettings('appearance');toast(`CSS Preset（CSS 预设）「${saved.name}」已保存`)}
async function applyCssPreset(id){if(!cssPresets.some(x=>x.id===id))return;try{await selectLegacyCssAppearance(async()=>{if(!await patchCurrent({customCssId:id,customCssEnabled:true},true))throw Error('剧情 CSS 设置未保存')});}catch(e){return toast('切换到普通 CSS 失败：'+e.message)}applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('已切换到当前剧情 CSS（工坊停止叠加，工程未删除）')}
async function unapplyCss(){if(!await patchCurrent({customCssId:null,customCssEnabled:false},true))return;applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('当前 Session（剧情会话）已取消 CSS（样式）')}
async function emergencyDisableCss(){window.MimaAtelierCore?.disabled?.();await patchCurrent({customCssEnabled:false},true);ensureCustomCssStyle().textContent='';ensureGlobalCssStyle().textContent='';fetchStory('/theme','PATCH',{globalCssEnabled:false}).then(()=>applyCustomCss());if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('🚑 自定义 CSS（样式）已临时禁用')}
async function reenableCss(){if(!currentSessionData?.customCssId)return toast('当前 Session（剧情会话）没有挂载 CSS（样式）');if(!await patchCurrent({customCssEnabled:true},true))return;applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'))}
async function duplicateCssPreset(id){const p=cssPresets.find(x=>x.id===id);if(!p)return;const res=await fetchStory('/css-presets','POST',{name:`${p.name} · 副本`,css:p.css,scope:p.scope,surface:p.surface,category:p.category,favorite:false});if(res.success){await loadAll();openSettings('appearance');toast('CSS Preset（CSS 预设）已复制')}else toast(res.msg||'复制失败')}
async function deleteCssPreset(id){if(!confirm('删除这个 CSS Preset（CSS 预设）？挂载它的 Session（剧情会话）会自动取消应用。'))return;const res=await fetchStory(`/css-presets/${id}`,'DELETE');if(!res.success)return toast(res.msg||'删除失败');closeEditor();await loadAll();applyCustomCss();openSettings('appearance')}
function chooseCssImport(){qs('css-file-input').value='';qs('css-file-input').click()}
async function importCssFile(file){if(!file)return;
  const picked=prompt('导入后选择作用域：1=咪嘛馆全局（全部界面），2=Novel Studio，3=聊天正文，4=Assistant Studio；取消则不导入。','1');
  if(picked===null)return;const scopes={'1':'app','2':'novel','3':'story','4':'assistant'},scope=scopes[String(picked).trim()];
  if(!scope){alert('请输入 1 / 2 / 3 / 4');return}
  try{const css=stripEmbeddedStyleTags(await file.text());const res=await fetchStory('/css-presets','POST',{name:file.name.replace(/\.css$/i,'')||'导入 CSS（样式）',css,scope,surface:scope==='app'?'global':scope==='novel'?'novel':scope==='assistant'?'assistant':'chat'});
    if(!res.success)throw new Error(res.msg||'导入失败');await loadAll();
    if(scope==='app')await applyGlobalCssPreset(res.data.id);
    else if(scope==='story'&&currentSessionId){await patchCurrent({customCssId:res.data.id,customCssEnabled:true},true);applyCustomCss()}
    openSettings('appearance');toast(scope==='novel'?'CSS 已保存；请在小说项目设置中选择挂载':scope==='assistant'?'CSS 已保存；可在助手工作区使用':`CSS 已按 ${cssScopeLabel(scope)} 导入并应用`);
  }catch(e){toast(`CSS（样式）导入失败：${e.message}`)}
}
function exportCssPreset(id){const p=cssPresets.find(x=>x.id===id);if(!p)return;downloadText(`${p.name||'mimamao'}.css`,p.css||'','text/css;charset=utf-8')}
let defaultCssSourceCache='';
async function loadDefaultCssSource(){
    if(defaultCssSourceCache)return defaultCssSourceCache;
    try{
        const res=await fetch('./style.css?v=1.1.0',{cache:'no-store'});
        if(!res.ok)throw new Error(`HTTP ${res.status}`);
        defaultCssSourceCache=await res.text();
    }catch(fetchErr){
        try{
            const sheet=[...document.styleSheets].find(x=>String(x.href||'').includes('style.css'));
            defaultCssSourceCache=[...(sheet?.cssRules||[])].map(r=>r.cssText).join('\n\n');
        }catch(_){ }
        if(!defaultCssSourceCache)throw new Error(`无法读取默认 CSS：${fetchErr.message}`);
    }
    return defaultCssSourceCache;
}
async function copyTextPortable(text){
    if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return}
    const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(!ok)throw new Error('浏览器拒绝复制到剪贴板');
}
async function copyDefaultCss(){try{const css=await loadDefaultCssSource();await copyTextPortable(css);toast(`默认 CSS（样式）已复制 · ${css.length} 字符`)}catch(e){toast(`复制默认 CSS 失败：${e.message}`)}}
async function exportDefaultCss(){try{const css=await loadDefaultCssSource();downloadText('mimamao-default-v1.0.9.css',css,'text/css;charset=utf-8');toast('咪嘛馆默认 CSS（样式）已导出')}catch(e){toast(`导出默认 CSS 失败：${e.message}`)}}
async function forkDefaultCss(){try{const css=await loadDefaultCssSource();openCssPresetEditor();qs('css-pre-name').value='咪嘛馆默认主题 · 二改';qs('css-pre-scope').value='app';qs('css-pre-code').value=css;toast('默认 CSS 已装进编辑器，可直接全局二改')}catch(e){toast(`载入默认 CSS 失败：${e.message}`)}}
function chooseFontImport(){qs('font-file-input').value='';qs('font-file-input').click()}
async function importFontFile(file){try{const r=await MimaFontManager.importFile(file);fontRecords=await MimaFontManager.all();if(!MimaFontManager.getSelected('story'))MimaFontManager.setSelected('story',r.family);renderAppearanceTab(qs('settings-content'));toast(`字体 ${r.family} 已导入`) }catch(e){toast(e.message)}}
function changeFont(kind,family){MimaFontManager.setSelected(kind,family)}
async function deleteLocalFont(id){if(!confirm('从这个浏览器删除字体？'))return;await MimaFontManager.deleteFont(id);renderAppearanceTab(qs('settings-content'))}
async function toggleSafeHtml(on){await patchCurrent({renderMode:on?'safe_html':'text'},true);refreshChatBox();renderAppearancePreview()}
function formatBytes(n){if(!Number.isFinite(Number(n)))return'';if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(1)} KB`;return`${(n/1024/1024).toFixed(1)} MB`}
function fontFormat(url){const c=String(url).split('?')[0].toLowerCase();if(c.endsWith('.woff2'))return'woff2';if(c.endsWith('.woff'))return'woff';if(c.endsWith('.ttf'))return'truetype';if(c.endsWith('.otf'))return'opentype';return''}
function applyLegacyUrlFont(){
    const url=qs('legacy-font-url').value.trim().replace(/[\n\r\t'"()\\]/g,'');
    const family=(qs('legacy-font-family').value.trim()||'MimaUrlFont').replace(/['"\\;\n\r{}]/g,'');
    if(url){localStorage.setItem(LEGACY_FONT_URL_KEY,url);localStorage.setItem(LEGACY_FONT_FAMILY_KEY,family)}
    else{localStorage.removeItem(LEGACY_FONT_URL_KEY);localStorage.removeItem(LEGACY_FONT_FAMILY_KEY)}
    restoreLegacyFont();
    toast(url?(MimaFontManager.getSelected('story')?'URL 字体已加载；当前独立正文字体优先':'URL 正文字体已应用'):'旧 URL 字体已停用');
}

function renderApiTab(box){
    const c=MimaStandalone.getApiConfig();
    const temp=Number.isFinite(Number(c.temperature))?Number(c.temperature):getTemp();
    box.innerHTML=`<section class="settings-section"><h3>🔌 API（接口）设置</h3><p class="helper">使用你自己的 OpenAI-compatible（兼容 OpenAI 格式）API（接口）。API Key（密钥）只保存在当前浏览器 localStorage（本地存储），不会进入剧情/角色卡/世界书导出文件，也不会发送给咪嘛馆作者。</p>
    <div class="form-grid"><div class="form-full"><label class="form-label">API Base URL（接口基础地址）</label><input id="api-base" class="field" placeholder="https://example.com/v1" value="${escapeHtml(c.apiBase||'')}"><div class="row-sub">支持直接填 .../v1，也支持完整 .../chat/completions 地址。</div></div>
    <div class="form-full"><label class="form-label">API Key（接口密钥）</label><input id="api-key" class="field" type="password" autocomplete="off" placeholder="sk-..." value="${escapeHtml(c.apiKey||'')}"></div>
    <div class="form-full"><label class="form-label">Model（模型）</label><div class="model-picker-stack"><div class="inline-field-row"><select id="api-model-select" class="field" onchange="syncApiModelSelect()"><option value="">先点“拉取模型”，然后从这里展开选择</option>${c.model?`<option value="${escapeHtml(c.model)}" selected>${escapeHtml(c.model)} · 当前</option>`:''}</select><button class="ghost-btn" onclick="loadApiModels()">拉取模型</button></div><input id="api-model" class="field" placeholder="也可以手动填写模型名" value="${escapeHtml(c.model||'')}"><div class="row-sub">iPhone / iPad（苹果移动设备）会使用原生下拉选择器；选择后会自动同步到下方模型名输入框。</div></div></div>
    <div class="form-full"><label class="form-label">Temperature（温度） <span id="api-temp-value" class="value-pill">${temp.toFixed(2)}</span></label><div class="temperature-row"><input id="api-temp-range" class="temp-range" type="range" min="0.1" max="2" step="0.05" value="${temp}" oninput="syncTemperature('range')"><input id="api-temperature" class="field temp-number" type="number" min="0.1" max="2" step="0.05" value="${temp}" oninput="syncTemperature('number')"></div><div class="row-sub">数值越高通常越发散，越低通常越稳定。具体有效范围以模型/中转站为准。</div></div>
    <div><label class="form-label">模型上下文窗口（Tokens，0=未知，不假设硬上限）</label><input id="api-context-window" class="field" type="number" min="0" value="${Number(c.contextWindowTokens||0)}"><div class="row-sub">这是整个输入+输出共享的上下文容量，不等于下方 Max Tokens（只控制输出）。长剧情超过安全阈值时必须填写服务商确认的数值才能免费裁剪预检；不会按模型名字猜容量或删除 History。</div></div><div><label class="form-label">Max Tokens（最大输出 Tokens，0=不发送）</label><input id="api-max-tokens" class="field" type="number" min="0" value="${Number(c.maxTokens||0)}"></div>
    <div class="form-full"><label class="form-label">续写接口方式</label><select id="api-continuation-mode" class="field"><option value="assistant_tail" ${c.continuationMode!=='deepseek_prefix'?'selected':''}>普通 Chat：生成后续 assistant 段落</option><option value="deepseek_prefix" ${c.continuationMode==='deepseek_prefix'?'selected':''}>已确认支持 DeepSeek prefix 的端点</option></select><div class="row-sub">普通 Chat 保留真实 assistant 尾文，不保证原文前缀补全。prefix 模式仅适用于支持该字段的端点；部分模型要求请求以 user 结束，可能不支持无伪玩家消息的续写。失败会保留原文，不自动换端点或追加指令。</div><label class="check-row"><input id="api-prefix-suffix" type="checkbox" ${c.prefixReturnsSuffix===true?'checked':''}> 前缀接口仅回新后缀（仅在接口确实如此时选择；默认按完整前缀响应校验）</label></div>
    <div><label class="check-row api-check"><input id="api-send-temp" type="checkbox" ${c.sendTemperature!==false?'checked':''}> 发送 Temperature（温度）参数</label><label class="check-row"><input id="api-stream" type="checkbox" ${c.stream?'checked':''}> Streaming（流式传输）</label></div>
    <div class="form-full"><details><summary>Advanced（高级设置）</summary><div class="form-grid advanced-grid"><div class="form-full"><label class="form-label">Chat Endpoint Override（聊天端点覆盖，可空）</label><input id="api-chat-endpoint" class="field" placeholder="例如 /v1/chat/completions" value="${escapeHtml(c.chatEndpoint||'')}"></div><div class="form-full"><label class="form-label">Models Endpoint Override（模型端点覆盖，可空）</label><input id="api-models-endpoint" class="field" placeholder="例如 /v1/models" value="${escapeHtml(c.modelsEndpoint||'')}"></div><div class="form-full"><label class="form-label">Extra Headers JSON（额外请求头 JSON 数据，可空）</label><textarea id="api-extra-headers" class="field textarea" placeholder='{"X-Custom-Key":"value"}'>${escapeHtml(c.extraHeaders||'')}</textarea></div></div></details></div></div>
    <div class="toolbar"><button class="primary-btn" onclick="saveApiSettings()">保存 API（接口）</button><button class="ghost-btn" onclick="testApiConnection()">检查模型列表</button><button class="ghost-btn" onclick="chooseApiImport()">⇧ 导入 API（接口）配置</button></div><div id="api-status" class="api-status"></div></section>
    <section class="settings-section"><h3>🌐 浏览器直连说明</h3><p class="helper">Standalone（独立版）是纯前端，因此 API（接口）服务必须允许浏览器跨域（CORS）。如果出现 “Failed to fetch（请求失败） / CORS（跨域）” 而地址和 Key（密钥）都正确，是 API 站点禁止网页直连，不是咪嘛馆剧情配置错误。此时需要换支持 CORS 的中转，或把本静态前端部署到该服务允许的来源。</p></section>`;
}
function syncApiModelSelect(){const sel=qs('api-model-select'),input=qs('api-model');if(sel?.value&&input){input.value=sel.value;MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),model:sel.value});const status=qs('api-status');if(status)status.textContent=`✅ 已选择 Model（模型）：${sel.value}`}}
function syncTemperature(source){const range=qs('api-temp-range'),num=qs('api-temperature'),pill=qs('api-temp-value');let v=Number(source==='range'?range?.value:num?.value);if(!Number.isFinite(v))v=.85;v=Math.max(.1,Math.min(2,v));if(range&&source!=='range')range.value=v;if(num&&source!=='number')num.value=v.toFixed(2);if(pill)pill.textContent=v.toFixed(2)}
function populateApiModelSelect(models){const sel=qs('api-model-select');if(!sel)return;const current=qs('api-model')?.value.trim()||'';sel.innerHTML='<option value="">请选择 Model（模型）</option>'+models.map(x=>`<option value="${escapeHtml(x)}" ${x===current?'selected':''}>${escapeHtml(x)}</option>`).join('');if(current&&!models.includes(current)){const opt=document.createElement('option');opt.value=current;opt.textContent=`${current} · 手动`;opt.selected=true;sel.appendChild(opt)}}
function collectApiForm(){const temp=Math.max(.1,Math.min(2,Number(qs('api-temperature')?.value||.85)));return{apiBase:qs('api-base').value.trim(),apiKey:qs('api-key').value.trim(),model:qs('api-model').value.trim(),chatEndpoint:qs('api-chat-endpoint').value.trim(),modelsEndpoint:qs('api-models-endpoint').value.trim(),extraHeaders:qs('api-extra-headers').value.trim(),sendTemperature:qs('api-send-temp').checked,temperature:temp,stream:qs('api-stream').checked,maxTokens:Number(qs('api-max-tokens').value||0),contextWindowTokens:Number(qs('api-context-window')?.value||0),continuationMode:qs('api-continuation-mode')?.value||'assistant_tail',prefixReturnsSuffix:qs('api-prefix-suffix')?.checked===true}}
function saveApiSettings(){
    try{
        // Invalid numbers must not be silently clamped or saved as defaults.
        const temp=validatedSettingNumber('api-temperature','API 温度',0.1,2,false);
        const windowSize=validatedSettingNumber('api-context-window','模型上下文窗口',0,100000000,true,true);
        const maxTokens=validatedSettingNumber('api-max-tokens','最大输出 Tokens',0,100000000,true,true);
        if(temp===null||windowSize===null||maxTokens===null)return false;
        const c=collectApiForm();
        if(c.extraHeaders)JSON.parse(c.extraHeaders);
        MimaStandalone.saveApiConfig(c);
        const actual=MimaStandalone.getApiConfig();
        if(actual.temperature!==temp||actual.maxTokens!==maxTokens||actual.contextWindowTokens!==windowSize)
            throw new Error('保存后的 API 数值与输入不一致');
        localStorage.setItem(TEMP_KEY,String(c.temperature));
        toast('API（接口）配置只保存到了这个浏览器');
        const el=qs('api-status');if(el)el.textContent='✅ 已保存。';return true;
    }catch(e){
        const info=describeApiError(e);toast(`API（接口）配置错误：${info.message}`);
        const el=qs('api-status');if(el)el.textContent=`❌ ${info.code} · ${info.message}\n可能原因：${info.hint}`;return false;
    }
}
async function loadApiModels(){if(!saveApiSettings())return;const status=qs('api-status');status.textContent='正在拉取模型……';try{const models=await MimaStandalone.listModels();populateApiModelSelect(models);status.textContent=`✅ 拉到 ${models.length} 个 Model（模型）。现在可以点击上方下拉框展开选择，也可以继续手填。`;if(models.length&&!qs('api-model').value){qs('api-model').value=models[0];populateApiModelSelect(models);MimaStandalone.saveApiConfig({...collectApiForm(),model:models[0]})}}catch(e){const info=describeApiError(e);status.textContent=`❌ ${info.code}${info.status?` · HTTP（状态码） ${info.status}`:''}\n${info.message}\n可能原因：${info.hint}`}}
async function testApiConnection(){if(!saveApiSettings())return;const status=qs('api-status');status.textContent='正在读取模型列表……';try{const r=await MimaStandalone.testApi();status.textContent=`✅ 模型列表可访问，共 ${r.count} 个；本操作未测试聊天生成。`;populateApiModelSelect(r.models)}catch(e){const info=describeApiError(e);status.textContent=`❌ ${info.code}${info.status?` · HTTP（状态码） ${info.status}`:''}\n${info.message}\n可能原因：${info.hint}`}}
function describeApiError(e){const message=e?.message||e?.msg||(typeof e==='string'?e:'未知 API 错误');const code=e?.code||(/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)?'E_API_NETWORK_CORS':'E_API_UNKNOWN');const status=Number(e?.status)||0;let hint=e?.hint||'';if(!hint&&code==='E_API_NETWORK_CORS')hint='浏览器 Fetch 在拿不到响应时无法可靠区分 CORS、网络断线、证书错误或“网关错误响应缺少 CORS 头”。如果同一配置一会成功一会失败，更像中转/CDN 节点抖动，而不是你的剧情数据坏了。';if(!hint&&code==='E_STREAM_INTERRUPTED')hint='流式连接已建立后中断。不要自动重复计费；可点击“仅重试本轮”手动重试，玩家消息不会重复写入。';if(!hint&&code==='E_API_REFUSAL_CONTENT')hint='模型把拒绝文本当普通回复返回；正文已拦截且不会进入角色历史或旧版本。可手动重试，不会自动重复计费。';if(!hint)hint='请检查 API（接口）地址、密钥、模型名、参数兼容性以及中转站状态。';return{message,code,status,hint,details:e?.details||'',partialDraft:typeof e?.partialDraft==='string'?e.partialDraft.slice(0,24000):''}}
function friendlyApiError(e){const i=describeApiError(e);return `${i.code}${i.status?` · HTTP（状态码） ${i.status}`:''} · ${i.message}\n可能原因：${i.hint}`}
function chooseApiImport(){qs('api-config-file-input').value='';qs('api-config-file-input').click()}
async function importApiConfigFile(file){if(!file)return;try{const raw=JSON.parse(await file.text()),src=raw.data||raw;const temperature=Number(src.temperature??localStorage.getItem(TEMP_KEY)??.85);MimaStandalone.saveApiConfig({apiBase:src.apiBase||src.baseUrl||src.base_url||'',apiKey:src.apiKey||src.api_key||src.key||'',model:src.model||'',chatEndpoint:src.chatEndpoint||'',modelsEndpoint:src.modelsEndpoint||'',extraHeaders:typeof src.extraHeaders==='string'?src.extraHeaders:src.extraHeaders?JSON.stringify(src.extraHeaders):'',sendTemperature:src.sendTemperature!==false,temperature,stream:!!(src.stream??src.streaming),maxTokens:Number(src.maxTokens||0),contextWindowTokens:Number(src.contextWindowTokens??src.context_window??0),continuationMode:src.continuationMode==='deepseek_prefix'?'deepseek_prefix':'assistant_tail',prefixReturnsSuffix:src.prefixReturnsSuffix===true});localStorage.setItem(TEMP_KEY,String(temperature));renderApiTab(qs('settings-content'));toast('API（接口）配置已导入到当前浏览器')}catch(e){toast(`API（接口）配置导入失败：${e.message}`)}}

function renderPromptTab(box){box.innerHTML=`<section class="settings-section"><h3>🔬 Prompt Inspector（提示词检查器）</h3><p class="helper">只预览、不调用 LLM。咪嘛馆在模型上下文容量允许时优先提供完整原始剧情；每轮各注入一份已启用 Persona / Preset 与预算内命中的 Worldbook。模型窗口不足时按完整轮次分批裁剪，默认每批10轮且至少保留最新20轮；未有可信来源范围的滚动摘要时暂停，不请求 Provider。原始 History 永远完整保留。v1.1.4 还会显示上游返回的缓存命中统计；没有统计不等于没有缓存。</p><div class="toolbar"><button class="primary-btn" onclick="refreshPromptInspector()">扫描本轮 Prompt（提示词）</button><button class="ghost-btn" onclick="switchSettingsTab('diagnostics')">查看真实请求和异常日志</button></div><div id="prompt-inspector"><div class="row-sub">点击上方按钮生成预览。</div></div></section>`}
async function refreshPromptInspector(){
    const targetSessionId=currentSessionId,root=qs('prompt-inspector'),epoch=settingsRenderEpoch;
    if(!targetSessionId||!root)return;
    root.innerHTML='<div class="row-sub">正在组装……</div>';
    const res=await fetchStory(`/sessions/${targetSessionId}/prompt-preview`,'POST',{draft:qs('story-input').value,directorNote:qs('director-note').value});
    if(targetSessionId!==currentSessionId||epoch!==settingsRenderEpoch||root!==qs('prompt-inspector')||settingsTab!=='prompt'||!isSettingsOpen())return;
    if(!res.success){
        root.replaceChildren();
        const error=document.createElement('p');error.className='helper';error.textContent=`本轮请求已暂停（未调用模型）：${res.msg||'预算预检未通过'}${res.code?' · '+res.code:''}`;root.appendChild(error);
        if(res.hint){const guide=document.createElement('p');guide.className='helper';guide.textContent=res.hint;root.appendChild(guide);}
        if(res.code==='E_CONTEXT_MEMORY_COVERAGE'){
            const memory=document.createElement('button');memory.type='button';memory.className='ghost-btn';memory.textContent='查看滚动记忆 / 免费请求计划';memory.onclick=()=>switchSettingsTab('memory');root.appendChild(memory);
        }
        return;
    }
    const d=res.data,u=d.upstreamUsage||MimaStandalone.getLastUsage?.()||null;
    const cached=u?.cachedTokens;
    const cacheText=Number.isFinite(Number(cached))?Number(cached).toLocaleString():'—';
    const cacheNote=u?`最近一次上游 usage${u.model?` · ${escapeHtml(u.model)}`:''}${Number.isFinite(Number(cached))?`：缓存命中 ${Number(cached).toLocaleString()} tokens`:'：未提供 cached tokens 字段'}。`:'当前中转/模型尚未返回可识别的 usage 统计。';
    root.innerHTML=`<div class="prompt-stats"><div class="stat-card"><div class="stat-num">${Number(d.estimatedInputTokens||0).toLocaleString()}</div><div class="stat-label">估算输入 Tokens</div></div><div class="stat-card"><div class="stat-num">${d.recentMessageCount}/${d.recentMessageLimit||'—'}</div><div class="stat-label">最近消息窗口</div></div><div class="stat-card"><div class="stat-num">${d.matchedWorldbookEntries.length}</div><div class="stat-label">世界书命中</div></div><div class="stat-card"><div class="stat-num">${cacheText}</div><div class="stat-label">最近缓存命中 Tokens</div></div><div class="stat-card"><div class="stat-num">${d.systemChars}</div><div class="stat-label">System 字符</div></div><div class="stat-card"><div class="stat-num">${d.finalMessageCount}</div><div class="stat-label">最终 Messages</div></div></div><div class="cache-insight-card"><strong>🧊 Cache Insight（缓存观察）</strong><div class="row-sub">${cacheNote} 缓存是否真正命中由上游 Provider 决定；咪嘛馆不会伪造“已缓存”。</div></div><div class="row-sub">${d.contextTrace?.uncoveredRawCount?`本轮有 ${d.contextTrace.uncoveredRawCount} 条待总结旧原文处于最近窗口外；相关检索 ${d.contextTrace.retrievedCount} 条，未覆盖 ${d.contextTrace.omittedCount} 条（原文仍在本地）。`:'旧原文覆盖无额外缺口。'} ${d.contextTrace?.budgetVerified?'上下文预算：使用玩家配置的模型窗口。':'模型上下文窗口未核实：大请求将拒绝发送；请填写服务商真实窗口，不会猜测 32K 或 100 万容量。'} · 分批移出 ${Number(d.contextTrace?.plannedTrimRounds||0)} 轮，保留至少 ${Number(d.contextTrace?.protectedRecentRounds||20)} 轮，记忆来源覆盖 ${d.contextTrace?.memoryCoverageProof?'已核对':'未验证'}。</div><div class="row-sub">🧹 历史 HTML 净化：${escapeHtml(d.historyHtmlProjection?.mode==='raw'?'已关闭':'已开启')} · 发送历史中转换 ${Number(d.historyHtmlProjection?.changedMessages||0)} / ${Number(d.historyHtmlProjection?.processedMessages||0)} 条角色消息 · 减少 ${Number(d.historyHtmlProjection?.savedChars||0).toLocaleString()} 字符 · 粗估减少 ${Number(d.historyHtmlProjection?.estimatedTokensSaved||0).toLocaleString()} Tokens（不是上游精确计费）。玩家消息与 System 预设不计入此项。</div><h4>本轮 Prompt 构成（字符数，非精确 Tokens）</h4><div class="hit-list">${(d.sections||[]).slice().sort((a,b)=>b.chars-a.chars).map(x=>`<div class="hit-item">${escapeHtml(x.name)}：${Number(x.chars||0).toLocaleString()} 字符</div>`).join('')||'<div class="hit-item">暂无项目</div>'}</div><h4>本轮记忆注入情况</h4><div class="hit-list">${(d.memoryTrace||[]).map(x=>`<div class="hit-item">${x.kind==='rolling'?'滚动剧情摘要':x.kind==='core'?'核心记忆':`事实记忆 第${x.startRound}–${x.endRound}轮`}：${x.injected?'✅ 已进入本轮 System 请求':'— 本轮未注入'} · ${Number(x.chars||0)} 字 · ${escapeHtml(x.reason||'unknown')}${!x.sourceCurrent&&x.injected?' · 旧剧情已修改，但保留玩家选择的记忆注入':''}</div>`).join('')||'<div class="hit-item">没有可用记忆记录</div>'}</div><div class="row-sub">这反映当前时间线的 Prompt 预览；旧轮冻结重说和失败重试仍按原请求快照发送，不自动追加新记忆。</div><h4>本轮世界书</h4><div class="row-sub">本轮预算：${Number(d.worldbookBudgetChars??0).toLocaleString()} 字符，实际占用：${Number(d.worldbookUsedChars??0).toLocaleString()} 字符。未注入条目请核对触发条件与跳过原因。</div><div class="hit-list">${d.matchedWorldbookEntries.length?d.matchedWorldbookEntries.map(x=>`<div class="hit-item">✅ ${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)} · Depth（深度） ${x.depth} · ${escapeHtml(x.position)} · ${escapeHtml(x.reason)}${x.hits?.length?` · 命中：${escapeHtml(x.hits.join(', '))}`:''}</div>`).join(''):'<div class="hit-item">本轮没有触发世界书条目；未触发条目不会进入本轮 Prompt。</div>'}</div><h4 style="margin-top:16px">实际 System 消息（玩家挂载与来源资料）</h4><pre class="prompt-pre">${escapeHtml(d.actualSystemPreview||'')}</pre><h4>旧版资料分栏（本轮资料已按来源列入消息队列）</h4><pre class="prompt-pre">${escapeHtml(d.userMaterialPreview||'（本轮无资料块）')}</pre><h4>面具加载与注入状态</h4><div class="hit-list">${(d.maskTrace||[]).map(x=>`<div class="hit-item">${escapeHtml(x.kind)} / ${escapeHtml(x.name||x.id||'未挂载')}：${escapeHtml(x.reason)} · ${x.injected?'已注入 System 资料':'未注入'}</div>`).join('')}</div><h4>原生预设挂载与实际出站（小值先发，0 最前）</h4><div class="row-sub">未挂载、已禁用和空内容均不会发送。数字只控制排列，无法保证模型服从或自动解决自由文本矛盾；请在下方完整消息队列核对。</div><div class="hit-list">${(d.presetTrace||[]).map(x=>`<div class="hit-item">${escapeHtml(x.name||x.id)}：${escapeHtml(x.reason)} · priority=${x.priority??'—'} · ${x.injected?`消息 #${x.sendIndex} · 已进入 System`:'未注入'}</div>`).join('')||'本轮未挂载预设'}</div><h4>世界书未注入原因</h4><div class="hit-list">${(d.worldbookMountTrace||[]).filter(x=>x.reason!=='enabled').map(x=>`<div class="hit-item">${escapeHtml(x.bookName||x.bookId)}：${escapeHtml(x.reason)}</div>`).join('')}${(d.skippedWorldbookEntries||[]).map(x=>`<div class="hit-item">${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)}：${escapeHtml(x.reason)}${x.reason==='budget'?`（需要 ${x.neededChars} 字符，剩余 ${x.remainingChars}）`:''}</div>`).join('')||'无额外跳过条目'}</div><h4>世界书深度注入（System 来源资料）</h4><div class="hit-list">${(d.depthInjections||[]).map(x=>`<div class="hit-item">${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)} · depth=${x.depth} · ${x.chars} 字符</div>`).join('')||'本轮无深度注入'}</div><details style="margin-top:12px"><summary>查看完整 Message（消息）队列</summary><pre class="prompt-pre">${escapeHtml(d.messagePreview.map(x=>`#${x.index+1} ${x.role}\n${x.content}`).join('\n\n'))}</pre></details>`;
}

// Independent diagnostics viewer. No route into canonical History or Memory.
const diagnosticViewState={scope:'session',kind:'all',selectedId:null};
function renderDiagnosticsTab(box){
    box.innerHTML=`<section class="settings-section"><h3>🧾 生成诊断日志（独立保存）</h3>
    <p class="helper">这里只记录原生正常剧情的真实模型请求、结果和失败证据；不是剧情历史，也不会被模型、预设、记忆或酒馆插件读取。日志保留在当前浏览器的独立 IndexedDB，不随剧情备份导出。Prompt 包含私人剧情，请勿随意分享。</p>
    <div class="toolbar"><label class="form-label">查看范围 <select id="diag-scope" class="field"><option value="session">当前剧情</option><option value="all">全部剧情</option></select></label>
    <label class="form-label">记录类型 <select id="diag-kind" class="field"><option value="all">全部请求</option><option value="errors">只看异常</option></select></label>
    <button class="ghost-btn" id="diag-refresh">刷新日志</button></div>
    <div class="toolbar"><button class="ghost-btn" id="diag-clear-session">清空当前剧情日志</button><button class="ghost-btn danger" id="diag-clear-all">一键清空全部日志</button></div>
    <div id="diag-status" class="row-sub" role="status">正在读取独立日志……</div><div id="diag-list" class="hit-list"></div><div id="diag-detail"></div>
    </section>`;
    const scope=qs('diag-scope'),kind=qs('diag-kind');
    if(!currentSessionId){diagnosticViewState.scope='all';scope.querySelector('option[value="session"]').disabled=true;}
    scope.value=diagnosticViewState.scope;kind.value=diagnosticViewState.kind;
    scope.onchange=()=>{diagnosticViewState.scope=scope.value;diagnosticViewState.selectedId=null;void refreshDiagnosticsView();};
    kind.onchange=()=>{diagnosticViewState.kind=kind.value;diagnosticViewState.selectedId=null;void refreshDiagnosticsView();};
    qs('diag-refresh').onclick=()=>void refreshDiagnosticsView();
    qs('diag-clear-session').disabled=!currentSessionId;
    qs('diag-clear-session').onclick=async()=>{
        const id=currentSessionId;if(!id||!confirm('确定只清除当前剧情的诊断日志？不会删除任何剧情、预设或记忆。'))return;
        try{await MimaDiagnosticJournal.clearSession(id);diagnosticViewState.selectedId=null;await refreshDiagnosticsView();}catch(e){toast(`清理日志失败：${e.message}`)}
    };
    qs('diag-clear-all').onclick=async()=>{
        if(!confirm('确定一键清空本浏览器里所有剧情的诊断日志？此操作不可撤销，但不会删除剧情与记忆。'))return;
        try{await MimaDiagnosticJournal.clearAll();diagnosticViewState.selectedId=null;await refreshDiagnosticsView();}catch(e){toast(`清理日志失败：${e.message}`)}
    };
    void refreshDiagnosticsView();
}
const diagnosticRecoveryBusy=new Set();
async function recoverDiagnosticReply(diagnosticId){
    if(diagnosticRecoveryBusy.has(diagnosticId))return;
    diagnosticRecoveryBusy.add(diagnosticId);
    let restored=false;
    try{
        const record=await MimaDiagnosticJournal.recoveryCandidate(diagnosticId);
        if(!confirm('请先核对详情里的“未采纳的模型文本”。\n\n手动恢复会采用日志已保存的正文，不重新请求模型，不重跑输出正则；显示正则仍生效。\n发送将补回角色回复；重说将替换原目标并归档旧版本；续写将追加到原回复并保留旧版本。\n\n服务端的拦截或截断标记仍保留，手动恢复不保证内容完整。确定恢复到原剧情吗？'))return;
        const selectedAtStart=currentSessionId,navigationAtStart=sessionNavigationEpoch;
        let result;
        if(String(record.action||'').startsWith('compat_')){
            if(typeof window.MimaCompatRuntime?.restoreRejectedReply!=='function')throw new Error('酒馆兼容恢复组件未加载，请完整更新本版本。');
            result=await MimaCompatRuntime.restoreRejectedReply(diagnosticId,{confirmed:true});
        }else{
            const response=await fetchStory('/sessions/'+encodeURIComponent(record.sessionId)+'/recover-reply','POST',{diagnosticId,confirmed:true});
            if(!response.success)throw new Error(response.msg||'未恢复，原剧情保持不变。');
            result=response.data;
        }
        restored=true;
        let notice='';
        try{await MimaDiagnosticJournal.event(diagnosticId,{type:'manual_recovery',messageId:result.messageId,action:result.action});}
        catch(e){notice='；剧情已保存，但日志标记写入失败';console.error('手动恢复已提交，诊断标记未保存',e);}
        try{
            if(String(record.action||'').startsWith('compat_'))document.dispatchEvent(new CustomEvent('mima:manual-reply-restored',{detail:{sessionId:record.sessionId}}));
            else{
                if(currentSessionId===record.sessionId&&selectedAtStart===currentSessionId&&navigationAtStart===sessionNavigationEpoch){
                    currentSessionData=result.session;refreshChatBox({scrollToBottom:false});
                }
                await refreshSessionSummaryList();
            }
        }catch(e){notice+='；界面刷新失败，请重新打开原剧情';console.error('手动恢复已提交，界面刷新失败',e);}
        toast((result.alreadyRestored?'这条回复已经手动恢复，没有重复写入':'已手动恢复到原剧情，没有重新请求模型')+notice);
    }catch(e){toast((restored?'回复已保存，后续操作失败：':'无法恢复：')+e.message);}
    finally{diagnosticRecoveryBusy.delete(diagnosticId);if(settingsTab==='diagnostics')await refreshDiagnosticsView();}
}
async function reviewRejectedDiagnosticHtml(record){
    if(!record?.id||String(record.action||'').startsWith('compat_'))return toast('本入口仅支持原生剧情的失败输出。');
    const result=await fetchStory('/sessions/'+encodeURIComponent(record.sessionId)+'/recover-reply/html-repair','POST',{diagnosticId:record.id},false);
    if(!result.success)return toast('无法安全修复：'+(result.code||result.msg||'未知原因')+'；没有调用 API。');
    const candidate=result.data;
    editorState={type:'rejected_html_code_repair',sessionId:record.sessionId,msg:{id:candidate.messageId},candidate,record};
    qs('editor-title').textContent='拒绝的模型正文 · 手动代码补全预览';
    qs('editor-eyebrow').textContent='原始生成任务 · 0 API 请求 · 待主人确认';
    const body=qs('editor-body');body.replaceChildren();
    const intro=document.createElement('p');intro.textContent='源自失败生成诊断。不会重新采样或续写；确认后将按原生成 ID 保存同一条消息，并保留原始 rawContent 与诊断证据。';body.appendChild(intro);
    for(const [name,txt] of [['未通过 HTML 合同的原始正文',candidate.oldContent],['按固定模板生成的候选',candidate.proposedContent]]){
        const lbl=document.createElement('label');lbl.textContent=name;lbl.className='form-label';
        const area=document.createElement('textarea');area.className='field textarea tall';area.value=txt;area.readOnly=true;body.append(lbl,area);
    }
    appendHtmlRepairDynamicFields(body,candidate);
    setupEditorButtons(null,async()=>{
      if(!confirm('确认使用零 API 代码补全结果恢复原失败生成？旧诊断保留。'))return;
      const e=editorState;
      let dynamicValues;try{dynamicValues=readHtmlRepairDynamicFields();}catch(error){return toast(error.message);}
      const done=await fetchStory('/sessions/'+encodeURIComponent(e.sessionId)+'/recover-reply','POST',
        {diagnosticId:e.record.id,confirmed:true,htmlCandidateId:e.candidate.id,dynamicValues},false);
      if(!done.success)return toast('恢复未提交：'+(done.code||done.msg));
      qs('editor-modal').classList.add('hidden');
      if(currentSessionId===e.sessionId){currentSessionData=done.data.session;refreshChatBox({scrollToBottom:false});}
      await refreshSessionSummaryList();toast('原失败正文已按 HTML 结构修复并恢复，没有再次调用模型。');
      if(settingsTab==='diagnostics')await refreshDiagnosticsView();
    });
    qs('editor-save').textContent='确认恢复修复版';qs('editor-modal').classList.remove('hidden');
}
function diagnosticHtmlCodeRepairButton(record){
    const b=document.createElement('button');b.type='button';b.className='ghost-btn';b.textContent='HTML 免 API 补全';
    b.disabled=!!record.manualRecovery||!record.rawRejectedReply||!!record.rejectedReplyTruncated;
    b.onclick=()=>void reviewRejectedDiagnosticHtml(record);return b;
}
function diagnosticRecoveryButton(record){
    const b=document.createElement('button');b.type='button';b.className='ghost-btn diag-recover-button';
    b.textContent=record.manualRecovery?'♻ 已手动恢复':diagnosticRecoveryBusy.has(record.id)?'正在恢复…':'♻ 手动恢复';
    b.disabled=!!record.manualRecovery||diagnosticRecoveryBusy.has(record.id);
    b.title='恢复已收到的文本，不重新请求模型；空文本、诊断被裁剪或原任务变化时会说明原因。';
    b.onclick=()=>void recoverDiagnosticReply(record.id);return b;
}
async function refreshDiagnosticsView(){
    const epoch=settingsRenderEpoch,sessionId=diagnosticViewState.scope==='session'?currentSessionId:null;
    const root=qs('diag-list'),status=qs('diag-status'),detail=qs('diag-detail');
    if(!root||!status||!detail)return;
    let records;
    try{records=await MimaDiagnosticJournal.list({sessionId,errorsOnly:diagnosticViewState.kind==='errors'});}
    catch(e){if(settingsTab==='diagnostics'&&epoch===settingsRenderEpoch){status.textContent=`独立日志读取失败：${e.message}。原生剧情数据未修改。`;root.textContent='';detail.textContent='';}console.error('诊断日志读取失败',e);return;}
    if(settingsTab!=='diagnostics'||epoch!==settingsRenderEpoch||root!==qs('diag-list'))return;
    const policy=MimaDiagnosticJournal.status(),error=policy.error;
    status.textContent=`${records.length} 条记录 · 自动保留最近 ${policy.limitCount} 条、最长 ${policy.limitDays} 天、约 ${Math.round(policy.limitBytes/1048576)} MB。${error?'最近存储故障：'+error:'日志写入与清理不会修改剧情数据。'}`;
    root.innerHTML='';
    for(const record of records){
        const b=document.createElement('button');b.type='button';b.className='ghost-btn diag-list-item';
        b.setAttribute('aria-pressed',String(diagnosticViewState.selectedId===record.id));
        let label={committed:'✅ 已提交',rejected:'⛔ 已拒绝',aborted:'⏹ 已取消',conflict:'⚠️ 提交冲突',requesting:'⏳ 请求中或异常退出',provider_returned:'⏳ 已返回，待结算',preparing:'⏳ 准备中'}[record.status]||record.status;
        if(record.status==='rejected'){
            const code=record.error?.code||'',http=record.transport?.httpStatus||record.error?.status;
            label=record.finishKind==='blocked'||/REFUSAL/.test(code)?'⛔ 拒绝类回复':record.finishKind==='truncated'||/TRUNCATED/.test(code)?'✂ 回复被截断':/STREAM_INTERRUPTED/.test(code)?'⚠ 连接中断':http>=400?'⚠ 请求失败 · HTTP '+http:'⚠ 未通过提交';
        }

        b.textContent=`${label} · ${new Date(record.createdAt).toLocaleString()} · ${record.action||'send'} · ${record.model||'模型未请求'} · ${record.error?.code||record.finishReason||''}`;
        b.onclick=()=>{diagnosticViewState.selectedId=record.id;void refreshDiagnosticsView();};
        const row=document.createElement('div');row.className='diag-list-row';row.appendChild(b);
        if(['rejected','aborted','conflict'].includes(record.status)){row.appendChild(diagnosticRecoveryButton(record));if(['E_HTML_STRUCTURE_MISSING','E_HTML_REQUIRED_NODE_MISSING','E_STORY_OUTPUT_INCOMPLETE'].includes(record.error?.code))row.appendChild(diagnosticHtmlCodeRepairButton(record));}
        root.appendChild(row);
    }
    if(!records.length)root.textContent='当前范围没有诊断记录。正常剧情可继续使用；只有真实生成操作才会产生记录。';
    const record=records.find(x=>x.id===diagnosticViewState.selectedId);
    detail.innerHTML='';if(!record)return;
    const wrap=document.createElement('div');wrap.className='diag-detail entry-card';
    const request=record.request;
    const responseHttp=Number(record.transport?.httpStatus||record.error?.status||0);
    const fmt=request?.messages?.map((m,i)=>`#${i} ${m.role}${m.prefix===true?' · prefix=true':''} · ${record.messageSources?.[i]?.kind||'未记录来源'} / ${record.messageSources?.[i]?.sourceId||record.messageSources?.[i]?.messageId||''}\n${m.content}`).join('\n\n')||'';
    wrap.innerHTML=`<h4>诊断详情 · ${escapeHtml(record.action)}</h4>
      <div class="row-sub">会话：${escapeHtml(record.sessionId)} · Turn：${escapeHtml(record.turnId)} · Request：${escapeHtml(record.requestId||'请求前失败')}<br>
      结果：${escapeHtml(record.status)} · Model：${escapeHtml(record.model||'未请求')} · 结束：${escapeHtml(record.finishKind||'—')} / ${escapeHtml(record.finishReason||'—')} · HTTP：${responseHttp||'—'}</div>
      <div class="toolbar"><button class="ghost-btn" id="diag-delete-one">删除这条</button><button class="ghost-btn" id="diag-copy-one">复制此条 JSON</button><button class="ghost-btn" id="diag-download-one">下载此条 JSON</button></div>
      <div class="row-sub">请求体：${record.requestBytes?Number(record.requestBytes).toLocaleString()+' bytes':'未记录'} · 准备：${record.preparationElapsedMs==null?'未记录':Number(record.preparationElapsedMs)+' ms'} · 等待响应头：${record.transport?Number(record.transport.fetchElapsedMs)+' ms':'未记录'}${record.transport?.providerRequestId?` · 服务端请求 ID：${escapeHtml(record.transport.providerRequestId)}`:''}${record.transport?.cfRay?` · CF-Ray：${escapeHtml(record.transport.cfRay)}`:''}</div>
      <h4>真实请求内容（不包含 API Key 和请求头）</h4>
      ${record.requestTruncated?'<div class="row-sub">本轮请求超过日志单条上限，未保留完整正文。实际发送不受影响；本条不能作为完整 Prompt 证据。</div>':''}
      ${request?`<div class="row-sub">${request.messages.length} 条消息 · 模型 ${escapeHtml(request.model)} · stream=${request.stream} · max_tokens=${escapeHtml(request.max_tokens??'未设置')}</div><details><summary>展开实际 messages</summary><pre class="prompt-pre">${escapeHtml(fmt)}</pre></details>`:'<div class="row-sub">没有保存完整请求：可能在发送前失败，或超出日志容量上限。</div>'}
      ${record.error?`<h4>错误与拒绝/截断诊断</h4><pre class="prompt-pre">${escapeHtml(JSON.stringify(record.error,null,2))}</pre><h4>未采纳的模型文本（仅诊断）</h4><pre class="prompt-pre">${escapeHtml(record.rawRejectedReply||'没有可保存的失败正文。')}${record.rejectedReplyTruncated?'\n[诊断副本超过上限，后半段未保存]':''}</pre>`:'<div class="row-sub">本条没有失败正文；成功回复仅存于原有剧情，不在此复制第二份。</div>'}`;
    if(['rejected','aborted','conflict'].includes(record.status)){
        wrap.querySelector('.toolbar').appendChild(diagnosticRecoveryButton(record));
        if(['E_HTML_STRUCTURE_MISSING','E_HTML_REQUIRED_NODE_MISSING','E_STORY_OUTPUT_INCOMPLETE'].includes(record.error?.code))wrap.querySelector('.toolbar').appendChild(diagnosticHtmlCodeRepairButton(record));
        const note=document.createElement('p');note.className='helper';
        note.textContent=record.manualRecovery?'这条文本已由你手动恢复。上面的原始错误与结束标记仍作为证据保留。':'确认误拦截后可手动恢复，不重新消耗模型额度。没有正文、日志副本已被裁剪，或原任务已被替换时，系统会说明无法恢复的原因。';
        wrap.querySelector('.toolbar').after(note);
    }
    detail.appendChild(wrap);
    qs('diag-delete-one').onclick=async()=>{
        if(!confirm('删除这条诊断记录？不会删除剧情消息。'))return;
        try{await MimaDiagnosticJournal.remove(record.id);diagnosticViewState.selectedId=null;await refreshDiagnosticsView();}catch(e){toast(`删除日志失败：${e.message}`)}
    };
    qs('diag-copy-one').onclick=async()=>{
        if(!confirm('本记录可能含完整私人 Prompt。确定复制到剪贴板？'))return;
        try{await navigator.clipboard.writeText(JSON.stringify(record,null,2));toast('诊断记录已复制。')}catch(e){toast(`复制失败：${e.message}`)}
    };
    qs('diag-download-one').onclick=()=>downloadJson(`咪嘛馆_诊断_${String(record.requestId||record.id).replace(/[^\w.-]/g,'_')}.json`,record);
}

function setupEditorButtons(deleteFn,saveFn){qs('editor-save').textContent='保存';const del=qs('editor-delete');if(deleteFn){del.classList.remove('hidden');del.onclick=deleteFn}else{del.classList.add('hidden');del.onclick=null}qs('editor-save').onclick=saveFn}
function downloadText(name,text,type='text/plain;charset=utf-8'){return window.MimaFileExport.save(name,String(text??''),type)}
function downloadJson(name,obj){downloadText(name,JSON.stringify(obj,null,2),'application/json;charset=utf-8')}
function toast(text){let t=document.getElementById('mima-toast');if(!t){t=document.createElement('div');t.id='mima-toast';t.style.cssText='position:fixed;z-index:2000;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(48,51,56,.92);color:white;padding:10px 14px;border-radius:999px;font-size:13px;max-width:85vw;text-align:center;transition:.2s';document.body.appendChild(t)}t.textContent=text;t.style.opacity='1';clearTimeout(t._timer);t._timer=setTimeout(()=>t.style.opacity='0',2200)}

function getTemp(){const cfg=MimaStandalone.getApiConfig?.()||{};const n=Number(cfg.temperature??localStorage.getItem(TEMP_KEY)??.85);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):.85}
const memoryPriorityWaiters=new Set();
window.MimaMemoryPriority={
    whenIdle(signal){
        if(!isGenerating)return Promise.resolve();
        return new Promise((resolve,reject)=>{
            const release=()=>{memoryPriorityWaiters.delete(release);signal?.removeEventListener?.('abort',abort);resolve();};
            const abort=()=>{memoryPriorityWaiters.delete(release);reject(new DOMException('记忆等待剧情期间已停止','AbortError'));};
            if(signal?.aborted){abort();return;}
            signal?.addEventListener?.('abort',abort,{once:true});memoryPriorityWaiters.add(release);
        });
    }
};
function toggleUIState(generating){
    // The flag remains globally useful for memory priority; composer controls
    // depend only on the selected session's own request.
    isGenerating=generationOwners.size>0;
    if(!isGenerating){for(const release of [...memoryPriorityWaiters])release();}
    const visible=!!currentGenerationOwner();
    qs('send-btn').disabled=visible;
    qsa('.quick-actions .chip-btn').forEach(b=>{if(b.id!=='stop-btn')b.disabled=visible});
    qs('stop-btn').classList.toggle('hidden',!visible);
    qs('story-input').disabled=visible;
}
function generationActionLabel(action){return action==='regenerate'?'正在重新生成':action==='continue'?'正在续写':action==='auto_advance'?'正在推进剧情':'正在生成剧情'}
function syncGenerationMinimizedBadge(percent=0){const badge=qs('generation-minimized-badge'),ring=badge?.querySelector('.generation-minimized-ring'),pct=qs('generation-minimized-percent');if(!badge||!ring||!pct)return;const n=Math.max(2,Math.min(100,Number(percent)||2));badge.style.setProperty('--generation-mini-progress',`${n}%`);ring.style.setProperty('--generation-mini-progress',`${n}%`);pct.textContent=`${Math.round(n)}%`;}
function setGenerationPanelMinimized(next){const panel=qs('generation-panel'),badge=qs('generation-minimized-badge');generationPanelMinimized=!!next;panel?.classList.toggle('minimized',generationPanelMinimized);const minimizable=!!currentGenerationOwner()||!!panel?.classList.contains('error');badge?.classList.toggle('hidden',!generationPanelMinimized||!minimizable);if(!generationPanelMinimized)badge?.classList.add('hidden');}
function toggleGenerationPanelMinimize(force){if(!currentGenerationOwner()&&!qs('generation-panel')?.classList.contains('error')){dismissGenerationPanel();return;}setGenerationPanelMinimized(force===undefined?!generationPanelMinimized:!!force);}
function restoreGenerationPanel(){setGenerationPanelMinimized(false);}
function setGenerationProgress(payload={}){const panel=qs('generation-panel'),bar=qs('generation-progress-bar'),label=qs('generation-label'),pct=qs('generation-percent'),detail=qs('generation-detail');if(!panel)return;panel.classList.remove('hidden','error','done');const n=Math.max(2,Math.min(100,Number(payload.percent)||2));bar.style.width=`${n}%`;pct.textContent=`${Math.round(n)}%`;syncGenerationMinimizedBadge(n);if(payload.label)label.textContent=payload.label;if(payload.detail)detail.textContent=payload.detail}
function setGenerationRetryVisible(visible){for(const id of ['generation-retry','generation-retry-current'])qs(id)?.classList.toggle('hidden',!visible);}
function beginGenerationProgress(action){deferredGenerationProgress=null;currentGenerationAction=action;lastGenerationFailure=null;contextRecoveryReceipt=null;setGenerationRetryVisible(false);setGenerationPanelMinimized(false);qs('generation-capacity-recovery')?.classList.add('hidden');qs('generation-resume-unanswered')?.classList.add('hidden');const panel=qs('generation-panel');panel?.classList.remove('hidden','error','done');setGenerationProgress({percent:4,label:`🤍 ${generationActionLabel(action)}`,detail:'正在准备本轮剧情…'})}
function isStoryNearBottom(box,threshold=96){return !box||((box.scrollHeight-box.scrollTop-box.clientHeight)<=threshold)}
function updateStoryFollowButton(){const b=qs('story-follow-stream');if(!b)return;b.classList.toggle('hidden',!liveStreamState||liveStreamState.followTail!==false)}
function resumeStoryStreamFollow(){if(!liveStreamState)return;liveStreamState.followTail=true;const box=qs('story-chat-box');if(box)box.scrollTop=box.scrollHeight;updateStoryFollowButton()}
function bindStoryStreamScroll(){const box=qs('story-chat-box');if(!box||box.dataset.streamFollowBound==='1')return;box.dataset.streamFollowBound='1';box.addEventListener('scroll',()=>{if(!liveStreamState)return;liveStreamState.followTail=isStoryNearBottom(box);updateStoryFollowButton()},{passive:true})}
function newGenerationTraceId(){
    // Durable cross-tab identity. UI clock/counter is not a trace identity.
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return 'gen_'+uuid;
    const bytes=new Uint8Array(20);
    if(!globalThis.crypto?.getRandomValues)throw new Error('E_DIAGNOSTIC_SECURE_ID_UNAVAILABLE');
    globalThis.crypto.getRandomValues(bytes);
    return 'gen_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function persistStoryUiTiming(owner,phase,st=null){
    if(!owner||!MimaDiagnosticJournal?.uiTiming)return;
    const timing={sessionId:owner.sessionId,turnId:String(owner.turnId),traceId:owner.traceId,phase,
      elapsedSinceUiSubmitMs:Math.round((performance.now()-owner.uiStartedAt)*100)/100,
      paintDurationMs:st?.lastPaintDurationMs||0,paintCount:st?.paints||0,chars:st?.displayText?.length||0};
    void MimaDiagnosticJournal.uiTiming(timing).catch(e=>console.error('剧情 UI 时间诊断持久化失败',{sessionId:owner.sessionId,turnId:owner.turnId,phase,error:e}));
}
// Latest-snapshot rendering: decouple SSE arrival from the browser's paint budget.
// A completed generation still goes through the original full renderer unchanged.
function renderLiveStreamText(){
    const st=liveStreamState;
    if(!st?.contentNode||!ownsVisibleGeneration(st.owner))return;
    const raw=st.displayText||'';
    const started=performance.now();
    const rendered=MimaStandalone.applyRegexForSession?MimaStandalone.applyRegexForSession(st.owner.sessionId,raw,'display'):raw;
    const allowHtml=currentSessionData?.renderMode==='safe_html';
    st.contentNode.className=`msg-content tavern-story-content live-stream-content${allowHtml?' safe-html-content':''}`;
    st.contentNode.replaceChildren();appendRenderedContent(st.contentNode,rendered,allowHtml,true);
    const box=qs('story-chat-box');if(box&&st.followTail!==false)box.scrollTop=box.scrollHeight;
    st.lastPaintDurationMs=Math.round((performance.now()-started)*100)/100;
    st.paints=(st.paints||0)+1;
    if(st.paints===1)persistStoryUiTiming(st.owner,'ui_first_visible',st);
    updateStoryFollowButton();
}
function ensureLiveStreamBubble(owner=currentGenerationOwner()){
    if(!ownsVisibleGeneration(owner))return null;
    if(liveStreamState?.owner===owner&&liveStreamState.node?.isConnected)return liveStreamState;
    clearLiveStream();const box=qs('story-chat-box');if(!box)return null;
    const div=document.createElement('article');div.className='message assistant-msg live-stream-message';
    const header=document.createElement('div');header.className='msg-header';header.textContent=`${currentChar()?.name||'角色'} · 流式生成中`;
    const content=document.createElement('div');content.className='msg-content tavern-story-content live-stream-content';
    div.append(header,content);box.appendChild(div);
    liveStreamState={owner,node:div,contentNode:content,targetText:'',displayText:'',timer:null,followTail:isStoryNearBottom(box),lastPaintAt:0,paints:0};
    updateStoryFollowButton();return liveStreamState;
}
function pumpLiveStream(){
    const st=liveStreamState;if(!st||st.timer)return;
    // Never rebuild an entire HTML tree one character/12 ms. Skip stale visual
    // snapshots, not bytes: the last received SSE body always wins.
    st.timer=requestAnimationFrame(function drawFrame(now){
        st.timer=null;
        if(liveStreamState!==st||!ownsVisibleGeneration(st.owner))return;
        if(isSettingsOpen()||st.visualPaused)return;
        if(st.targetText===st.displayText)return;
        const minPaintInterval=currentSessionData?.renderMode==='safe_html'?Math.min(550,160+Math.floor(st.targetText.length/2500)*55):Math.min(280,90+Math.floor(st.targetText.length/4000)*30);
        if(now-st.lastPaintAt<minPaintInterval){st.timer=requestAnimationFrame(drawFrame);return;}
        st.displayText=st.targetText;st.lastPaintAt=now;
        renderLiveStreamText();
        if(st.targetText!==st.displayText)pumpLiveStream();
    });
}
function handleGenerationProgress(payload,owner=currentGenerationOwner()){
    if(!owner||generationOwners.get(owner.sessionId)!==owner)return;
    owner.lastProgress=payload;
    if(payload?.phase==='saved_user'){owner.userSaved=true;clearSubmittedDraft(owner);}
    let blocked=false;
    if(payload?.streamText!==undefined){
        const snippet=String(payload.streamText||'');
        blocked=MimaStandalone.classifyStoryReply?.(snippet)?.blocked===true;
        owner.streamText=blocked?'':snippet;
        if(blocked&&ownsVisibleGeneration(owner))clearLiveStream();
    }
    if(!ownsVisibleGeneration(owner))return;
    if(isSettingsOpen())deferredGenerationProgress={owner,payload};else setGenerationProgress(payload);
    if(payload?.streamText!==undefined&&!blocked){
        const st=ensureLiveStreamBubble(owner);
        if(st){st.targetText=owner.streamText;st.visualPaused=isSettingsOpen();pumpLiveStream();}
    }
}
function clearLiveStream(){
    if(liveStreamState?.timer)cancelAnimationFrame(liveStreamState.timer);
    if(liveStreamState?.paints)persistStoryUiTiming(liveStreamState.owner,'ui_last_visible',liveStreamState);
    if(liveStreamState?.node?.isConnected)liveStreamState.node.remove();
    liveStreamState=null;updateStoryFollowButton();
}
function finishGenerationProgress(owner=null){
    if(owner&&!ownsVisibleGeneration(owner))return;
    deferredGenerationProgress=null;lastGenerationFailure=null;currentGenerationAction=null;
    setGenerationRetryVisible(false);
    setGenerationProgress({percent:100,label:'🤍 生成完成',detail:'剧情已保存到本机。'});
    const panel=qs('generation-panel');panel?.classList.add('done');
    setGenerationPanelMinimized(false);
    const sessionId=currentSessionId;
    setTimeout(()=>{if(!currentGenerationOwner()&&currentSessionId===sessionId){panel?.classList.add('hidden');qs('generation-minimized-badge')?.classList.add('hidden');}},650);
}
function showGenerationError(err,action=currentGenerationAction,fromRestore=false){
    deferredGenerationProgress=null;
    setGenerationPanelMinimized(false);
    const info=describeApiError(err),panel=qs('generation-panel'),bar=qs('generation-progress-bar'),label=qs('generation-label'),pct=qs('generation-percent'),detail=qs('generation-detail'),retry=qs('generation-retry');
    if(!panel)return;
    lastGenerationFailure={...info,action};
    if(!fromRestore&&currentSessionId)generationFailures.set(currentSessionId,lastGenerationFailure);
    panel.classList.remove('hidden','done');panel.classList.add('error');bar.style.width='100%';
    pct.textContent=info.status?`HTTP（状态码） ${info.status}`:'ERROR（错误）';label.textContent=`生成失败 · ${info.code}`;
    detail.textContent=`${info.message}\n可能原因：${info.hint}`;
    if(info.details){
        const evidence=document.createElement('details'),caption=document.createElement('summary'),content=document.createElement('pre');
        caption.textContent='展开完整错误诊断（不影响关闭和重试）';
        content.textContent=info.details;content.className='generation-error-diagnostic';
        evidence.append(caption,content);detail.appendChild(evidence);
    }
    if(info.partialDraft){
        const evidence=document.createElement('details'),caption=document.createElement('summary'),content=document.createElement('pre');
        caption.textContent='查看本轮未完成片段（仅诊断，未写入剧情或记忆）';
        content.textContent=info.partialDraft;content.style.whiteSpace='pre-wrap';content.style.overflowWrap='anywhere';
        evidence.append(caption,content);detail.appendChild(evidence);
    }
    const retryable=info.code==='E_API_NETWORK_CORS'||info.code==='E_STREAM_INTERRUPTED'||[408,409,429,502,503,504].includes(info.status)||info.status>=500;
    setGenerationRetryVisible(retryable);
    const recover=qs('generation-capacity-recovery'),status=qs('generation-capacity-status'),input=qs('generation-context-tokens');
    const capacityBlocked=['E_CONTEXT_WINDOW_REQUIRED','E_CONTEXT_BUDGET_CONFIG','E_CONTEXT_RECENT_MINIMUM','E_CONTEXT_MEMORY_COVERAGE','E_CONTEXT_BUDGET'].includes(info.code);
    recover?.classList.toggle('hidden',!capacityBlocked);
    if(status)status.textContent=info.code==='E_CONTEXT_WINDOW_REQUIRED'
      ?'当前保存的模型上下文窗口为 0／未知；其他裁剪与 Max Tokens 设置不会替代它。已暂停且没有发出模型请求。'
      :info.code==='E_CONTEXT_MEMORY_COVERAGE'?'已知窗口但缺少滚动摘要来源覆盖；必须先整理记忆，不能强制丢弃旧剧情。'
      :'模型容量或受保护的最近轮数不满足本轮预算；可核实服务商窗口后免费重新预检。';
    if(input)input.value=Number(MimaStandalone.getApiConfig()?.contextWindowTokens)>=4096?String(MimaStandalone.getApiConfig().contextWindowTokens):'';
    qs('generation-resume-unanswered')?.classList.add('hidden');
    contextRecoveryReceipt=null;
}
function currentRecoverySnapshot(){const session=MimaStandalone.getState()?.sessions?.find(s=>s.id===currentSessionId);return session?{
    sessionId:session.id,recordRevision:session.recordRevision,lastId:session.messages?.at(-1)?.id||'',
    sourceFingerprint:MimaStandalone.memorySourceFingerprint(session.messages||[],session.messages?.length||0)}:null;}
async function saveGenerationContextAndPreview(){
    const status=qs('generation-capacity-status'),input=qs('generation-context-tokens'),resume=qs('generation-resume-unanswered');
    if(resume)resume.classList.add('hidden');contextRecoveryReceipt=null;
    const raw=String(input?.value||'').trim(),n=Number(raw);
    if(!raw||!Number.isSafeInteger(n)||n<4096||n>100000000){if(status)status.textContent='请填写服务商确认的上下文总窗口，整数 4096～100000000 Tokens。未修改设置、未发送请求。';return false;}
    const sessionId=currentSessionId,action=lastGenerationFailure?.action;
    if(!sessionId||currentGenerationOwner()){if(status)status.textContent='当前会话正在生成或已切换，不能重新规划。';return false;}
    try{
        const original=MimaStandalone.getApiConfig();
        MimaStandalone.saveApiConfig({...original,contextWindowTokens:n});
        if(Number(MimaStandalone.getApiConfig()?.contextWindowTokens)!==n)throw new Error('E_CONTEXT_WINDOW_WRITE_VERIFY');
        if(status)status.textContent='窗口设置已单独保存到本浏览器。正在进行零 API 的完整 Prompt 容量预检…';
        const preview=await fetchStory(`/sessions/${sessionId}/prompt-preview`,'POST',{draft:'',directorNote:qs('director-note')?.value||''});
        if(sessionId!==currentSessionId)return false;
        if(!preview.success){const i=describeApiError(preview);if(status)status.textContent=`保存成功，但免费预检仍暂停：${i.code} · ${i.message}。
${i.hint||'请检查记忆来源或窗口设置。'}`;return false;}
        const inspector=preview.data||{},snap=currentRecoverySnapshot();
        if(!snap){if(status)status.textContent='当前会话读取失败。不会自动发送。';return false;}
        const canResume=(action==='send'&&snap.lastId&&MimaStandalone.getState().sessions.find(s=>s.id===sessionId)?.messages?.at(-1)?.role==='user')||action==='continue';
        contextRecoveryReceipt={...snap,contextWindowTokens:n,action,model:original.model};
        const omitted=inspector.temporarilyOmittedCount||0;
        if(status)status.textContent=`免费预检通过：预计输入 ${Number(inspector.estimatedInputTokens||0).toLocaleString()} Tokens；仅本轮请求移出 ${omitted} 条旧消息，本地 History 未动。${canResume?'可手动恢复未完成轮。':'请使用正常的续写／重说按钮重新操作。'}预检不是服务商实际分词保证。`;
        if(canResume)resume?.classList.remove('hidden');
        return true;
    }catch(e){const i=describeApiError(e);if(status)status.textContent=`保存或预检未完成：${i.code} · ${i.message}`;return false;}
}
function resumeGenerationAfterCapacityPreview(){
    const receipt=contextRecoveryReceipt,now=currentRecoverySnapshot(),cfg=MimaStandalone.getApiConfig();
    if(!receipt||!now||currentGenerationOwner()||receipt.sessionId!==currentSessionId||receipt.sourceFingerprint!==now.sourceFingerprint||receipt.recordRevision!==now.recordRevision||receipt.lastId!==now.lastId||Number(cfg.contextWindowTokens)!==receipt.contextWindowTokens||cfg.model!==receipt.model){
      const status=qs('generation-capacity-status');if(status)status.textContent='原会话、模型或剧情在预检后发生了变化，请再次免费预检；没有发送模型请求。';contextRecoveryReceipt=null;qs('generation-resume-unanswered')?.classList.add('hidden');return false;
    }
    contextRecoveryReceipt=null;qs('generation-resume-unanswered')?.classList.add('hidden');
    if(receipt.action==='send')return triggerChat('','regenerate',{regenerationContext:'current'});
    if(receipt.action==='continue')return continueMsg();
    return false;
}
function retryFailedGeneration(parameters='original'){
    if(currentGenerationOwner())return toast('当前剧情正在生成中。');
    const failure=generationFailures.get(currentSessionId);
    if(!failure)return toast('当前剧情没有可重试的失败请求。');
    setGenerationRetryVisible(false);
    return triggerChat('','retry',{retryParameters:parameters==='current'?'current':'original'});
}
function dismissGenerationPanel(){qs('generation-panel')?.classList.add('hidden');qs('generation-minimized-badge')?.classList.add('hidden');generationPanelMinimized=false;}
async function triggerChat(text,actionType='send',generationOptions={}){
    const targetSessionId=currentSessionId;
    if(!targetSessionId)return toast('请先创建一个剧情。');
    if(generationOwners.has(targetSessionId))return toast('当前剧情仍在生成，请先停止或等待本轮完成。');
    const directorNote=qs('director-note').value.trim();
    let targetMessageId=null;
    if(actionType==='regenerate'){
        const msgs=arr(currentSessionData?.messages);let lastUser=-1,lastAssistant=-1;
        for(let i=msgs.length-1;i>=0&&(lastUser<0||lastAssistant<0);i--){if(lastUser<0&&msgs[i]?.role==='user')lastUser=i;if(lastAssistant<0&&msgs[i]?.role==='assistant')lastAssistant=i}
        if(lastAssistant>=0&&(lastUser<0||lastAssistant>lastUser))targetMessageId=msgs[lastAssistant]?.id||null;
    }
    contextRecoveryReceipt=null;
    const owner={turnId:++generationSerial,traceId:newGenerationTraceId(),sessionId:targetSessionId,action:actionType,text:String(text||''),
        controller:new AbortController(),lastProgress:null,streamText:'',userSaved:false,inputCleared:false,uiStartedAt:performance.now()};
    generationOwners.set(targetSessionId,owner);generationFailures.delete(targetSessionId);
    clearLiveStream();
    if(actionType==='send'&&owner.text.trim())renderPendingUserMessage(owner.text);
    toggleUIState(true);beginGenerationProgress(actionType);
    try{
        // Distinct sessions must never abort each other's Direct Reply.
        const res=await fetchStory(`/sessions/${targetSessionId}/chat`,'POST',
            {text,action:actionType,temperature:getTemp(),directorNote,targetMessageId,regenerationContext:generationOptions.regenerationContext||'original',retryParameters:generationOptions.retryParameters||'original',diagnosticTurnId:String(owner.turnId),diagnosticTraceId:owner.traceId},false,
            payload=>handleGenerationProgress(payload,owner),owner.controller.signal);
        if(!res.success&&!res.aborted&&generationOwners.get(targetSessionId)===owner){
            generationFailures.set(targetSessionId,{...describeApiError(res),action:actionType});
        }
        const visible=ownsVisibleGeneration(owner);
        const storyBox=visible?qs('story-chat-box'):null;
        const preserveReading=visible&&liveStreamState?.owner===owner&&liveStreamState.followTail===false;
        const preservedScrollTop=preserveReading&&storyBox?storyBox.scrollTop:null;
        // Final settlement precedes UI unlock; original persisted session is never rewritten to the selected one.
        if(generationOwners.get(targetSessionId)===owner)generationOwners.delete(targetSessionId);
        if(visible){
            clearLiveStream();toggleUIState(false);
            if(res.aborted){
                toast('生成已停止，主人消息已保留。');
                setGenerationProgress({percent:100,label:'已停止生成',detail:'已保存的主人消息仍在剧情中。'});
                const panel=qs('generation-panel');setTimeout(()=>{if(currentSessionId===targetSessionId&&!currentGenerationOwner())panel?.classList.add('hidden')},900);
                await openSession(targetSessionId,false);
            }else if(res.success){
                if(res.data?.id!==targetSessionId)throw new Error('E_GENERATION_WRONG_SESSION: 回复的会话身份不匹配');
                clearSubmittedDraft(owner);
                currentSessionData=res.data;
                refreshChatBox(preserveReading?{scrollTop:preservedScrollTop}:{scrollToBottom:true});
                requestAnimationFrame(()=>{if(currentSessionId===targetSessionId)persistStoryUiTiming(owner,'ui_final_stable');});
                refreshHeader();finishGenerationProgress();
            }else{
                showGenerationError(res,actionType);toast(`生成失败 · ${res.code||'E_UNKNOWN'}`);
                await openSession(targetSessionId,false);
            }
            if(preserveReading&&storyBox&&preservedScrollTop!==null)
                requestAnimationFrame(()=>{if(currentSessionId===targetSessionId)storyBox.scrollTop=preservedScrollTop});
        }else if(res.success){
            clearSubmittedDraft(owner);
        }else if(!res.aborted){
            console.warn('后台剧情生成失败，已登记在原会话，不影响当前剧情',{sessionId:targetSessionId,turnId:owner.turnId,code:res.code||'E_GENERATION_FAILED'});
        }
        try{await refreshSessionSummaryList();}catch(e){console.error('剧情请求已结束但会话列表刷新失败',{targetSessionId,turnId:owner.turnId,error:e});if(currentSessionId===targetSessionId)toast('剧情状态已保存；会话列表暂时无法刷新');}
    }catch(e){
        if(generationOwners.get(targetSessionId)===owner)generationOwners.delete(targetSessionId);
        generationFailures.set(targetSessionId,{...describeApiError(e),action:actionType});
        if(currentSessionId===targetSessionId){clearLiveStream();toggleUIState(false);showGenerationError(e,actionType);toast(`生成失败 · ${e?.code||'E_UNKNOWN'}`);}
        else console.error('其他剧情请求异常，原会话仍持有错误信息',{targetSessionId,turnId:owner.turnId,error:e});
    }finally{
        if(generationOwners.get(targetSessionId)===owner)generationOwners.delete(targetSessionId);
        toggleUIState(false);
    }
}
function stopGeneration(){
    const owner=currentGenerationOwner();
    if(!owner)return;
    owner.controller.abort(); // Only the selected request; settlement happens in triggerChat.
    if(liveStreamState?.owner===owner)clearLiveStream();
}
function sendMsg(){const txt=qs('story-input').value;if(txt.trim())triggerChat(txt,'send')}
function regenerateMsg(){triggerChat('','regenerate')}
function regenerateCurrentMsg(){triggerChat('','regenerate',{regenerationContext:'current'})}
function continueMsg(){triggerChat('','continue')}
function autoAdvance(){triggerChat(qs('director-note').value,'auto_advance')}
function syncComposerContentState(){const el=qs('story-input');if(el)el.classList.toggle('has-content',!!el.value)}
function autoResizeInput(){const el=qs('story-input');el.style.height='auto';el.style.height=Math.min(170,Math.max(46,el.scrollHeight))+'px';syncComposerContentState()}

function refreshChatBox(options={}){const box=qs('story-chat-box'),renderedSessionId=currentSessionId,renderedEpoch=sessionNavigationEpoch,readScroll=readingMode?box.scrollTop:null;box.innerHTML='';if(!currentSessionData||!currentSessionData.messages?.length){box.innerHTML=`<div class="empty-state"><div class="empty-icon">${currentChar()?'🤍':'🍷'}</div><h2>${escapeHtml(currentChar()?.name||'这个宇宙还是空的')}</h2><p>${currentChar()?.firstMessage?'角色卡里有开场白，可以在角色设置中插入。':'写下第一句话，剧情从这里开始。'}</p><button class="ghost-btn" onclick="MimaCompatUI.open()">🎴 或者用酒馆角色卡开始聊天</button></div>`;return}currentSessionData.messages.forEach(renderMessageToUI);requestAnimationFrame(()=>{if(renderedSessionId!==currentSessionId||renderedEpoch!==sessionNavigationEpoch)return;if(readingMode&&Number.isFinite(readScroll))box.scrollTop=readScroll;else if(Number.isFinite(Number(options.scrollTop)))box.scrollTop=Number(options.scrollTop);else if(options.scrollToBottom!==false)box.scrollTop=box.scrollHeight})}
function renderPendingUserMessage(text){const box=qs('story-chat-box');if(!box)return;const div=document.createElement('article');div.className='message user-msg pending-user-message';div.dataset.msgId='pending_'+Date.now();const header=document.createElement('div');header.className='msg-header';header.textContent=`${currentUser()?.name||'你'} · 正在提交`;const content=document.createElement('div');content.className='msg-content tavern-story-content';appendRenderedContent(content,cleanCorruptText(text),false);div.append(header,content);box.appendChild(div);box.scrollTop=box.scrollHeight}
function renderMessageToUI(msg){const box=qs('story-chat-box');const role=msg.role||'system';const div=document.createElement('article');div.className=`message ${role}-msg`;div.dataset.msgId=msg.id||'';const header=document.createElement('div');header.className='msg-header';const roleName=role==='user'?(currentUser()?.name||'你'):(role==='assistant'?(currentChar()?.name||(currentSessionData?.mode==='sandalphon'?'圣德芬':'角色')):'系统');header.textContent=`${roleName}${msg.isEdited?' · 已编辑':''}${msg.versions?.length?` · ${msg.versions.length} 个旧版本`:''}`;div.appendChild(header);const content=document.createElement('div');const allowHtml=role==='assistant'&&currentSessionData?.renderMode==='safe_html';content.className=`msg-content tavern-story-content${allowHtml?' safe-html-content':''}`;const displayText=role==='assistant'&&MimaStandalone.applyRegexForSession?MimaStandalone.applyRegexForSession(currentSessionId,msg.content||'','display'):msg.content||'';appendRenderedContent(content,cleanCorruptText(displayText),allowHtml,role==='assistant');div.appendChild(content);if(role==='user'||role==='assistant'){const tools=document.createElement('div');tools.className='msg-tools';tools.append(makeToolButton('编辑',()=>openMessageEditor(msg,false)),makeToolButton('从这里分支',()=>openMessageEditor(msg,true)),makeToolButton('删除',()=>deleteStoryMessage(msg),true));if(role==='assistant'&&currentSessionData?.promptSettings?.outputContract?.requireHtml)tools.append(makeToolButton('HTML检测 / 代码补全',()=>reviewStoryHtmlRepair(msg)));if(role==='assistant'&&currentSessionData?.promptSettings?.outputContract?.requireHtml)tools.append(makeToolButton('AI重排（另收费）',()=>reviewStoryAiHtmlRepair(msg)));if(role==='assistant'&&msg.versions?.length)tools.append(makeToolButton('看旧版本',()=>showVersions(msg)));div.appendChild(tools)}box.appendChild(div)}
function makeToolButton(text,fn,danger=false){const b=document.createElement('button');b.className=`tool-mini${danger?' danger':''}`;b.textContent=text;b.onclick=fn;return b}
function appendHtmlRepairDynamicFields(body,candidate){
    if(!Array.isArray(candidate.missingFields)||!candidate.missingFields.length)return;
    const alert=document.createElement('p');alert.className='helper';alert.textContent='模板中未经证明可继承的文字、注释、样式、CSS 选择器及状态属性都必须确认来源；旧例子不代表本轮事实。只会提交你明确填写并通过校验的值。';body.appendChild(alert);
    for(const field of candidate.missingFields){
        const wrap=document.createElement('div'),lab=document.createElement('label'),input=document.createElement('input');
        lab.className='form-label';lab.textContent=String(field.label||field.key)+'（原模板例子：'+String(field.previousExample||'')+'，非本轮真实值）';
        input.className='field';input.dataset.htmlDynamicKey=field.key;input.placeholder=field.kind==='css_selector'?'填写本轮 CSS 选择器（完整）':'填写本轮确认值';input.autocomplete='off';
        wrap.append(lab,input);body.appendChild(wrap);
    }
}
function readHtmlRepairDynamicFields(){const result={};for(const el of qs('editor-body').querySelectorAll('[data-html-dynamic-key]')){
    if(!el.value.trim())throw new Error('状态值尚未全部填写，请先确认本轮事实：'+el.dataset.htmlDynamicKey);
    result[el.dataset.htmlDynamicKey]=el.value.trim();
}return result;}
async function reviewStoryHtmlRepair(msg){
    if(!msg?.id||currentGenerationOwner())return toast('当前生成任务尚未完成，不能修复其消息。');
    const sessionId=currentSessionId,contract=currentSessionData?.promptSettings?.outputContract;
    if(!contract?.requireHtml)return toast('请先在长剧情设置里开启独立 HTML 结构合同。');
    const valid=window.MimaHtmlStructure.inspect(msg.content,contract);
    if(valid.ok)return toast('这条消息已满足 HTML 结构合同；未修改原文。');
    if(!contract.templateMessageId)return toast('缺少标准 HTML 模板。请先在长剧情设置里选择一条格式正确的角色回复。');
    const result=await fetchStory(`/sessions/${sessionId}/messages/${msg.id}/html-repair`,'POST',{},false);
    if(!result.success)return toast('代码修复停止：'+(result.code||result.msg||'结构不明确')+'（无额外 API 请求）');
    const candidate=result.data;
    editorState={type:'html_code_repair',msg,candidate,sessionId};
    qs('editor-title').textContent='HTML 免 API 代码补全 · 差异审阅';
    qs('editor-eyebrow').textContent='CODE GENERATED / UNCOMMITTED · 不生成新状态事实';
    const body=qs('editor-body');body.replaceChildren();
    const intro=document.createElement('p');intro.className='helper';intro.textContent='下面是当前原文和按已绑定模板组装的候选。仅主人确认后才归档原版本并应用；关闭不会修改任何剧情。缺失动态状态一律拒绝自动生成。';body.appendChild(intro);
    for(const [label,text] of [['原正文（不变）',candidate.oldContent],['候选 HTML（未提交）',candidate.proposedContent]]){
      const title=document.createElement('label');title.className='form-label';title.textContent=label;
      const area=document.createElement('textarea');area.className='field textarea tall';area.readOnly=true;area.value=text;area.style.userSelect='text';body.append(title,area);
    }
    appendHtmlRepairDynamicFields(body,candidate);
    setupEditorButtons(null,()=>approveStoryHtmlRepair());
    qs('editor-save').textContent='确认应用代码修复';qs('editor-modal').classList.remove('hidden');
}
async function reviewStoryAiHtmlRepair(msg){
    if(!msg?.id||currentGenerationOwner())return toast('当前生成未结算，请先完成原任务。');
    const contract=currentSessionData?.promptSettings?.outputContract;
    if(!contract?.requireHtml||!contract.templateMessageId||!contract.bodySelector)
      return toast('请先绑定 HTML 标准模板和唯一正文槽，再使用 AI 重排。');
    if(!confirm('只有混合 HTML 等代码不能直接恢复、且正文可逐字核验时才尝试。优先使用免费代码补全。这是额外的付费模型请求，明确确认后最多请求一次，不会自动重试。费用取决于当前配置的网关费率，无法在此可靠报价。若原文/模板不能逐字验证，结果会被拒收，仍可能产生一次费用。继续吗？'))return;
    const sessionId=currentSessionId;
    const response=await fetchStory(`/sessions/${sessionId}/messages/${msg.id}/html-repair/ai`,'POST',{confirmedCharge:true},false);
    if(!response.success)return toast('AI 重排失败（不会自动重试）：'+(response.code||response.msg));
    const candidate=response.data;
    editorState={type:'html_code_repair',msg,candidate,sessionId};
    qs('editor-title').textContent='AI HTML 重排 · 严格逐字验证通过 · 未提交';
    qs('editor-eyebrow').textContent='EXPLICIT PAID SINGLE REQUEST / OWNER APPROVAL REQUIRED';
    const body=qs('editor-body');body.replaceChildren();
    const note=document.createElement('p');note.textContent='模型仅完成排版；原文字节及模板静态节点通过了代码核验。主人确认后才写入，原始 rawContent 与版本保留。';body.appendChild(note);
    for(const [label,text] of [['现有正文',candidate.oldContent],['AI 排版候选',candidate.proposedContent]]){
      const title=document.createElement('label');title.className='form-label';title.textContent=label;
      const area=document.createElement('textarea');area.className='field textarea tall';area.readOnly=true;area.value=text;body.append(title,area);
    }
    appendHtmlRepairDynamicFields(body,candidate);
    setupEditorButtons(null,()=>approveStoryHtmlRepair());
    qs('editor-save').textContent='确认应用已验证排版';qs('editor-modal').classList.remove('hidden');
}
async function approveStoryHtmlRepair(){
    const e=editorState;if(e?.type!=='html_code_repair')return;
    if(!confirm('确定应用这份经主人确认状态值的 HTML 修复？原回复仍会在旧版本中保留。'))return;
    let dynamicValues;try{dynamicValues=readHtmlRepairDynamicFields();}catch(err){return toast(err.message);}
    const result=await fetchStory(`/sessions/${e.sessionId}/messages/${e.msg.id}/html-repair/approve`,'POST',{candidateId:e.candidate.id,dynamicValues},false);
    if(!result.success)return toast('代码修复未能提交：'+(result.code||result.msg));
    if(currentSessionId===e.sessionId){currentSessionData=result.data;closeEditor();refreshChatBox();}
    toast('主人已批准代码修复；原始模型回复及旧版本保留。');
}
function openMessageEditor(msg,truncateAfter=false){editorState={type:'message',msg,truncateAfter};qs('editor-title').textContent=truncateAfter?'编辑并从这里建立新时间线':'编辑消息';qs('editor-eyebrow').textContent='STORY MESSAGE（剧情消息）';qs('editor-body').innerHTML=`<label class="form-label">消息内容</label><textarea id="message-edit-content" class="field textarea tall">${escapeHtml(msg.content||'')}</textarea>${truncateAfter?'<p class="helper">保存后，这条消息之后的旧剧情会进入 archivedBranches（归档分支），不会直接丢失。</p>':'<p class="helper">如果这是角色错误输出，也可以直接删除这一条；删除只影响当前剧情历史，不会删除角色卡、预设或其他资料库。</p>'}`;setupEditorButtons(truncateAfter?null:()=>deleteStoryMessage(msg),saveMessageEditor);qs('editor-modal').classList.remove('hidden')}
async function saveMessageEditor(){const {msg,truncateAfter}=editorState;const res=await fetchStory(`/sessions/${currentSessionId}/messages/${msg.id}`,'PATCH',{content:qs('message-edit-content').value,truncateAfter});if(res.success){currentSessionData=res.data;closeEditor();refreshChatBox();if(truncateAfter&&msg.role==='user'&&confirm('现在从这条玩家消息重新生成后续吗？'))await triggerChat('','regenerate')}else toast(res.msg||'编辑失败')}
async function deleteStoryMessage(msg){
    if(!currentSessionId||!msg?.id)return;
    if(currentGenerationOwner())return toast('本剧情正在生成中，请先停止或等待本轮完成后再删除历史消息。');
    const who=msg.role==='assistant'?(currentChar()?.name||'角色'):(currentUser()?.name||'你');
    const preview=String(msg.content||'').replace(/\s+/g,' ').slice(0,72);
    if(!confirm(`确定删除 ${who} 的这条历史消息吗？${preview?`

${preview}${String(msg.content||'').length>72?'…':''}`:''}

它会从当前剧情上下文中移除；为了误删恢复，咪嘛馆只在本 Session 的 deletedMessages 回收记录中保留一份隐藏副本。`))return;
    const storyBox=qs('story-chat-box'),preservedScrollTop=storyBox?.scrollTop??0;
    const res=await fetchStory(`/sessions/${currentSessionId}/messages/${msg.id}`,'DELETE');
    if(!res.success)return toast(res.msg||'删除消息失败');
    currentSessionData=res.data;
    if(editorState?.type==='message'&&editorState.msg?.id===msg.id)closeEditor();
    refreshChatBox({scrollTop:preservedScrollTop});
    await refreshSessionSummaryList();
    toast('这条历史消息已删除');
}
function showVersions(msg){
    editorState={type:'versions',msg,sessionId:currentSessionId,expectedContent:msg.content,expectedVersionCount:arr(msg.versions).length};
    qs('editor-title').textContent='旧版本';qs('editor-eyebrow').textContent='MESSAGE VERSIONS（消息旧版本）';
    const body=qs('editor-body');body.innerHTML=arr(msg.versions).map((v,i)=>({v,i})).reverse().map(({v,i})=>`<div class="entry-card"><div class="entry-meta">${escapeHtml(v.reason||'version（版本）')} · ${escapeHtml(v.time||'')}</div><div style="white-space:pre-wrap;line-height:1.6;margin-top:8px">${escapeHtml(v.content||'')}</div><button type="button" class="tool-mini" data-version-index="${i}">恢复这一版</button></div>`).join('');
    body.querySelectorAll('[data-version-index]').forEach(button=>button.addEventListener('click',()=>restoreMessageVersion(Number(button.dataset.versionIndex))));
    setupEditorButtons(null,closeEditor);qs('editor-save').textContent='关闭';qs('editor-modal').classList.remove('hidden');
}
async function restoreMessageVersion(index){
    const edit=editorState;if(edit?.type!=='versions'||!edit.msg?.id)return;
    if(generationOwners.has(edit.sessionId))return toast('本剧情正在生成，请先停止或等待完成。');
    const res=await fetchStory(`/sessions/${edit.sessionId}/messages/${edit.msg.id}/versions/${index}/restore`,'POST',{expectedContent:edit.expectedContent,expectedVersionCount:edit.expectedVersionCount});
    if(!res.success)return toast(res.msg||'版本恢复失败');
    if(currentSessionId===edit.sessionId){currentSessionData=res.data;closeEditor();refreshChatBox();}
    await refreshSessionSummaryList();toast('版本已恢复，原当前版本也已归档。');
}
let storyInlineMarkdownErrorLogged=false;
function appendProseText(parent,text,inlineMarkdown=false){
    const raw=String(text??'').replace(/\r\n?/g,'\n');if(!raw.trim())return;
    const chunks=raw.split(/\n{2,}/);
    chunks.forEach(chunk=>{
        if(!chunk.trim())return;
        const p=document.createElement('div');p.className='story-prose story-paragraph';
        const prose=chunk.trim();
        if(inlineMarkdown){
            try{
                if(typeof window.MimaCompatMarkdown?.renderStoryInline!=='function')throw new Error('Markdown 正文渲染模块未加载');
                window.MimaCompatMarkdown.renderStoryInline(p,prose);
            }catch(error){
                if(!storyInlineMarkdownErrorLogged){console.error('咪嘛馆正文 Markdown 渲染失败，保留原文展示',error);storyInlineMarkdownErrorLogged=true;}
                p.textContent=prose;
            }
        }else p.textContent=prose;
        parent.appendChild(p);
    });
}
function parseBondMeterPercent(text){
    const raw=String(text||'').replace(/\s+/g,' ').trim();
    if(!raw)return null;
    let match=raw.match(/(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/);
    if(match){
        const current=Number(match[1]),maximum=Number(match[2]);
        if(Number.isFinite(current)&&Number.isFinite(maximum)&&maximum>0)return Math.max(0,Math.min(100,current/maximum*100));
    }
    match=raw.match(/(-?(?:\d+(?:\.\d+)?|\.\d+))\s*%/);
    if(match){
        const numeric=Number(match[1]);
        if(Number.isFinite(numeric))return Math.max(0,Math.min(100,numeric));
    }
    return null;
}
function hydrateSafeHtmlDynamicMeters(root){
    if(!root?.querySelectorAll)return;
    for(const meter of root.querySelectorAll('.mima-meter')){
        const fill=meter.querySelector('.mima-meter-fill');
        if(!fill)continue;
        let percent=null;
        const declared=String(fill.style?.getPropertyValue?.('--value')||'').trim();
        const declaredMatch=declared.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/);
        if(declaredMatch){
            const numeric=Number(declaredMatch[1]);
            if(Number.isFinite(numeric))percent=Math.max(0,Math.min(100,numeric));
        }
        // v1.1.10 fallback: historical/model-generated BOND HTML often carries
        // only the visible "85 / 100" number and no inline --value at all.
        // Derive the bounded visual width from that already-visible value.
        const numberNode=meter.querySelector('.mima-meter-number');
        const fromNumber=parseBondMeterPercent(numberNode?.textContent||'');
        if(fromNumber!==null)percent=fromNumber;
        if(percent===null)continue;
        const safeValue=`${percent}%`;
        fill.style.setProperty('--value',safeValue);
        // Inline !important is intentional here: the value is code-derived and
        // bounded, and it must survive user CSS rules that also use !important.
        fill.style.setProperty('width',safeValue,'important');
    }
}
function appendSafeHtmlWithProse(node,text,inlineMarkdown=false){
    const template=document.createElement('template');
    if(!node.dataset.mimaHtmlScope)node.dataset.mimaHtmlScope='mima_'+Math.random().toString(36).slice(2,12);
    template.innerHTML=sanitizeAllowedHtml(text||'',node.dataset.mimaHtmlScope);
    hydrateSafeHtmlDynamicMeters(template.content);
    let prose='';
    const flush=()=>{if(prose.trim())appendProseText(node,prose,inlineMarkdown);prose=''};
    for(const child of [...template.content.childNodes]){
        if(child.nodeType===Node.TEXT_NODE){prose+=child.nodeValue||'';continue}
        if(child.nodeType===Node.ELEMENT_NODE&&child.tagName==='BR'){prose+='\n';continue}
        flush();node.appendChild(child);
    }
    flush();
}
function appendRenderedContent(node,text,allowHtml=false,inlineMarkdown=false){if(allowHtml){appendSafeHtmlWithProse(node,text,inlineMarkdown);return}appendProseText(node,text,inlineMarkdown)}
function sanitizeSafeInlineStyle(styleText){
    const kept=[];
    for(const declaration of String(styleText||'').split(';')){
        const colon=declaration.indexOf(':');
        if(colon<=0)continue;
        const name=declaration.slice(0,colon).trim().toLowerCase();
        const value=declaration.slice(colon+1).trim();
        // Safe HTML deliberately does NOT allow arbitrary inline CSS. The one
        // legacy dynamic status value we preserve is the BOND meter percentage.
        if(name==='--value'){
            const match=value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/);
            if(!match)continue;
            const numeric=Math.max(0,Math.min(100,Number(match[1])));
            if(Number.isFinite(numeric))kept.push(`--value:${numeric}%`);
        }
    }
    return kept.join(';');
}
// Preserve benign template CSS only inside its own story message. Unlike an
// unscoped <style> in the host page, these rules cannot restyle other messages,
// the composer, settings, or the app shell. Unsafe/network CSS is stripped by
// the existing shared CSSOM sanitizer before scoped reconstruction.
function scopedStoryCss(raw,scope){
    if(!/^[a-zA-Z0-9_]{1,48}$/.test(String(scope)))throw new Error('E_HTML_SCOPE_INVALID');
    const safe=window.MimaCompatSafeHtml?.safeCssText;
    if(typeof safe!=='function'||typeof CSSStyleSheet!=='function')throw new Error('E_HTML_SCOPED_CSS_PARSER_MISSING');
    const sheet=new CSSStyleSheet();sheet.replaceSync(safe(raw));
    const parent=`[data-mima-html-scope="${scope}"]`;
    // Selector lists can contain commas inside :is(), :not(), attribute
    // selectors or quoted strings. Splitting on each comma broadens scopes.
    const splitSelectorList=value=>{
        const out=[];let current='',round=0,square=0,quote='',escaped=false;
        for(const char of String(value||'')){
            if(escaped){current+=char;escaped=false;continue;}
            if(char==='\\'){current+=char;escaped=true;continue;}
            if(quote){current+=char;if(char===quote)quote='';continue;}
            if(char==='\"'||char==="'"){quote=char;current+=char;continue;}
            if(char==='(')round++;else if(char===')')round--;
            else if(char==='[')square++;else if(char===']')square--;
            if(round<0||square<0)throw new Error('E_HTML_SCOPE_SELECTOR_INVALID');
            if(char===','&&round===0&&square===0){if(current.trim())out.push(current.trim());current='';}
            else current+=char;
        }
        if(round||square||quote)throw new Error('E_HTML_SCOPE_SELECTOR_INVALID');
        if(current.trim())out.push(current.trim());
        return out;
    };
    const convert=rules=>Array.from(rules).map(rule=>{
        if(rule.type===1){const selector=splitSelectorList(rule.selectorText).filter(Boolean)
          .map(x=>/^(?:html|body|:root)$/i.test(x)?parent:`${parent} ${x}`).join(', ');
          return selector?selector+' {'+rule.style.cssText+'}':'';
        }
        if(rule.type===4||rule.type===12){const head=rule.cssText.slice(0,rule.cssText.indexOf('{'));
          const nested=convert(rule.cssRules||[]);return nested?head+'{'+nested+'}':'';
        }
        return ''; // Other at-rules need dedicated isolation; do not import them.
    }).filter(Boolean).join('\n');
    return convert(sheet.cssRules);
}
function sanitizeAllowedHtml(html,htmlScope=''){
    const template=document.createElement('template');template.innerHTML=cleanCorruptText(html);
    const allowedTags=new Set(['SYSTEM','DIV','SPAN','P','BR','STRONG','B','EM','I','SMALL','MARK','S','U','SUB','SUP','KBD','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','DETAILS','SUMMARY','BLOCKQUOTE','PRE','CODE','H1','H2','H3','H4','H5','H6','UL','OL','LI','DL','DT','DD','TABLE','CAPTION','COLGROUP','COL','THEAD','TBODY','TFOOT','TR','TD','TH','HR','PROGRESS','METER','STYLE']);
    const blockedTags=new Set(['SCRIPT','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','TEXTAREA','OPTION','META','LINK','BASE','SVG','MATH','VIDEO','AUDIO','SOURCE','TRACK','CANVAS','NOSCRIPT']);
    const allowedAttrs=new Set(['class','title','role','open','colspan','rowspan','scope','value','max','min','low','high','optimum']);
    const nodes=[...template.content.querySelectorAll('*')];
    for(const el of nodes){
        if(blockedTags.has(el.tagName)){el.remove();continue}
        if(el.tagName==='STYLE'){
            if(!htmlScope){el.remove();continue}
            try{el.textContent=scopedStoryCss(el.textContent||'',htmlScope);}catch(error){
                console.error('HTML 静态样式隔离失败，拒绝不安全 CSS；正文保留',error);el.remove();
            }
            continue;
        }
        if(!allowedTags.has(el.tagName)){el.replaceWith(...[...el.childNodes]);continue}
        for(const a of [...el.attributes]){
            const n=a.name.toLowerCase(),v=String(a.value||'');
            if(n==='style'){
                const safeStyle=sanitizeSafeInlineStyle(v);
                if(safeStyle)el.setAttribute('style',safeStyle);else el.removeAttribute(a.name);
                continue;
            }
            const ok=allowedAttrs.has(n)||n.startsWith('data-')||n.startsWith('aria-');
            if(!ok||/^on/i.test(n)||/javascript:|data:text\/html/i.test(v))el.removeAttribute(a.name);
        }
    }
    return template.innerHTML;
}

function restoreLegacyFont(){
    const url=localStorage.getItem(LEGACY_FONT_URL_KEY);
    const tag=qs('legacy-url-font-style')||document.createElement('style');
    tag.id='legacy-url-font-style';if(!tag.isConnected)document.head.appendChild(tag);
    if(!url){tag.textContent='';MimaFontManager?.applySelected?.();return;}
    const family=(localStorage.getItem(LEGACY_FONT_FAMILY_KEY)||'MimaUrlFont').replace(/['"\\;\n\r{}]/g,'');
    const fmt=fontFormat(url);
    // Register the font resource only. FontManager owns both independent
    // variables and chooses an explicit story-library font over this fallback.
    const safeUrl=String(url).replace(/[\n\r"'\\]/g,'');
    tag.textContent=safeUrl.includes('fonts.googleapis.com')||safeUrl.endsWith('.css')?`@import url('${safeUrl}');`:`@font-face{font-family:'${family}';src:url('${safeUrl}')${fmt?` format('${fmt}')`:''};font-display:swap;}`;
    MimaFontManager?.applySelected?.();
}

// Expose inline handlers
Object.assign(window,{importCurrentSessionAsSettingTemplate,chooseIndependentTemplate,saveIndependentTemplate,copyIndependentTemplate,setIndependentTemplateDefault,deleteIndependentTemplate,setImmersiveReading,saveCurrentSettingTemplate,duplicateSettingTemplate,setDefaultSettingTemplate,deleteSettingTemplate,exportSettingTemplate,importSettingTemplate,refreshSettingTemplateChoices,renderSettingTemplatePreview,manualRollingSummary,mimaFilterLibrary,mimaToggleFavorite,goPhone,openDrawer,closeDrawer,openSettings,closeSettings,switchSettingsTab,choosePngResourceInspection,playInspectedPngInCompat,savePngSelectedResources,exportPngInspection,openNewSessionModal,closeNewSessionModal,createSession,deleteCurrentSession,exportCurrentSession,exportStoryTranscript,chooseSessionImport,toggleDirector,saveRoleMounts,mountMask,insertCharacterOpening,openMaskEditor,choosePersonaImport,exportMask,toggleWorldbookMount,openWorldbookEditor,addWorldbookEntry,removeWorldbookEntry,chooseWorldbookImport,exportWorldbook,togglePreset,openPresetEditor,toggleRegexPack,openRegexPackEditor,addRegexRule,removeRegexRule,testRegexDraft,chooseRegexImport,exportRegexPack,saveContextSettings,saveMemorySettings,saveCoreMemoryEdit,generateCoreMemory,generateFactMemories,loadMemoryModels,selectMemoryModel,startFactMemoryEdit,cancelFactMemoryEdit,saveFactMemoryEdit,toggleMergeFactSelection,previewFactMemoryMerge,cancelFactMemoryMerge,confirmFactMemoryMerge,undoFactMemoryMerge,clearCoreMemory,deleteFactMemory,clearAllFactMemories,revokeRollingMemory,restoreRollingMemory,discardMemoryCandidate,setCoreMemoryTarget,syncFactMemoryScope,stopMemorySummary,exportWholeLibrary,chooseLibraryImport,saveFullSettingsSnapshot,restoreSavedSettingsSnapshot,exportFullSettingsBackup,chooseFullSettingsImport,chooseFontImport,changeFont,deleteLocalFont,toggleSafeHtml,applyLegacyUrlFont,openCssPresetEditor,mimaLoadLargeCssForEdit,stopAtelierAndRestoreCss,applyCssPreset,unapplyCss,emergencyDisableCss,reenableCss,duplicateCssPreset,deleteCssPreset,chooseCssImport,exportCssPreset,copyDefaultCss,exportDefaultCss,forkDefaultCss,saveApiSettings,loadApiModels,testApiConnection,chooseApiImport,syncApiModelSelect,syncTemperature,updateStoryTypography,resetStoryTypography,setAppearancePreviewSurface,setBuiltInTheme,dismissGenerationPanel,retryFailedGeneration,resumeStoryStreamFollow,refreshPromptInspector,closeEditor,deleteStoryMessage,sendMsg,regenerateMsg,regenerateCurrentMsg,continueMsg,autoAdvance,restoreMessageVersion,stopGeneration,toggleGenerationPanelMinimize,restoreGenerationPanel,saveGenerationContextAndPreview,resumeGenerationAfterCapacityPreview});


window.MimaTavernBridge={
    getSessionId:()=>currentSessionId,
    getSession:()=>currentSessionData?clone(currentSessionData):null,
    getPresets:()=>clone(presets),
    getRegexPacks:()=>clone(regexPacks),
    getCssPresets:()=>clone(cssPresets),
    getThemeSettings:()=>clone(MimaStandalone.getState?.().themeSettings||{theme:'default'}),
    setThemeSettings:async theme=>(await fetchStory('/theme','PATCH',typeof theme==='string'?{theme}:theme)).data,
    compileCustomCss:(preset,surface)=>compileCustomCss(preset,surface),
    patchCurrent:async patch=>patchCurrent(patch,true),
    reload:async()=>loadAll(),
    openSettings:tab=>openSettings(tab),
    refreshChat:()=>refreshChatBox()
};

// Startup is a distinct read-only admission stage. On failure, never treat
// an unverified IndexedDB read or failed render as a new empty library.
// A manual repeat executes the SAME startup chain; it is not an automatic
// retry and never performs initialization writes or clears user data.
let mimaStartupPending=false, mimaStartupBound=false, mimaStartupReady=false;
function showMimaStartupFailure(stage,error){
    const issue={kind:'mima_startup_read_failure',stage,code:String(error?.code||error?.name||'E_STARTUP_UNKNOWN').slice(0,120),
        message:String(error?.message||error||'未知错误').slice(0,1600),occurredAt:new Date().toISOString(),
        pageVersion:'20261019-r4.2',failureHandlerWroteCanonicalState:false};
    let panel=document.getElementById('mima-startup-failure');
    if(!panel){
        panel=document.createElement('section');panel.id='mima-startup-failure';
        panel.setAttribute('role','alert');
        panel.style.cssText='position:fixed;z-index:2147483646;inset:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,16,24,.94);color:#f8f8fb;font:15px/1.65 system-ui,sans-serif';
        panel.innerHTML='<div style="width:min(520px,100%);padding:24px;background:#292c37;border:1px solid #71778d;border-radius:14px"><h2 style="font-size:20px;margin:0 0 12px">咪嘛馆暂时无法载入资料库</h2><p>原始存档未被清空，也不会自动初始化空存档。请保留当前页面，导出诊断以便排查。</p><pre id="mima-startup-error" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:30vh;overflow:auto"></pre><div style="display:flex;gap:12px;flex-wrap:wrap"><button type="button" id="mima-startup-export">导出错误诊断</button><button type="button" id="mima-startup-retry">手动重新读取</button></div></div>';
        document.body.appendChild(panel);
        panel.querySelector('#mima-startup-export').addEventListener('click',()=>{
            window.MimaFileExport.save('mima-startup-failure.json',JSON.stringify(panel.mimaLastIssue,null,2),'application/json;charset=utf-8');
        });
        panel.querySelector('#mima-startup-retry').addEventListener('click',()=>mimaBoot());
    }
    panel.mimaLastIssue=issue;
    panel.querySelector('#mima-startup-error').textContent=`阶段：${issue.stage}\n错误：${issue.code}\n${issue.message}`;
    panel.style.display='flex';
}
async function mimaBoot(){
    if(mimaStartupPending||mimaStartupReady)return;
    mimaStartupPending=true;
    let stage='init_local_state';
    try{
        // Re-initialization reads the verified canonical state, not an empty fallback.
        await MimaStandalone.init();
        stage='bind_application';
        if(!mimaStartupBound){
            const inputIds=['story-input','session-file-input','png-inspector-input','persona-file-input','worldbook-file-input','regex-file-input','font-file-input','css-file-input','api-config-file-input','library-file-input','full-settings-file-input'];
            const missing=inputIds.filter(id=>!qs(id));
            if(missing.length)throw new Error('E_STARTUP_MISSING_CONTROLS: '+missing.join(','));
            applyStoryTypography();
            restoreLegacyFont();
            try{fontRecords=await MimaFontManager.init()}catch(e){console.warn('本地字体库启动失败',e)}
            qs('story-input').addEventListener('input',autoResizeInput);
    bindStoryStreamScroll();setupImmersiveReading();
    syncComposerContentState();
    qs('session-file-input').addEventListener('change',e=>importSessionFile(e.target.files?.[0]));
    qs('png-inspector-input').addEventListener('change',e=>inspectPngResources(e.target.files?.[0]));
    qs('persona-file-input').addEventListener('change',e=>importPersonaFile(e.target.files?.[0]));
    qs('worldbook-file-input').addEventListener('change',e=>importWorldbookFile(e.target.files?.[0]));
    qs('regex-file-input').addEventListener('change',e=>importRegexFile(e.target.files?.[0]));
    qs('font-file-input').addEventListener('change',e=>importFontFile(e.target.files?.[0]));
    qs('css-file-input').addEventListener('change',e=>importCssFile(e.target.files?.[0]));
    qs('api-config-file-input').addEventListener('change',e=>importApiConfigFile(e.target.files?.[0]));
    qs('library-file-input').addEventListener('change',e=>importWholeLibrary(e.target.files?.[0]));
    qs('full-settings-file-input').addEventListener('change',e=>importFullSettingsFile(e.target.files?.[0]));
            mimaStartupBound=true;
        }
        stage='load_library_and_session';
        await loadAll();
        mimaStartupReady=true;
        document.getElementById('mima-startup-failure')?.remove();
        if(!MimaStandalone.getApiConfig().apiBase)setTimeout(maybeOpenInitialApiSettings,250);
    }catch(e){
        console.error('咪嘛馆启动读取失败，保留原数据与原错误',{stage,error:e});
        showMimaStartupFailure(stage,e);
    }finally{mimaStartupPending=false;}
}
window.addEventListener('load',mimaBoot);
