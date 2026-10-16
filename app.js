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
let memoryTask = null; // UI-independent, single owner for story-memory requests.
let liveStreamState = null;
let deferredGenerationProgress = null;
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
function closeSettings(){settingsNavigationTouched=true;++settingsRenderEpoch;qs('settings-modal').classList.add('hidden');if(deferredGenerationProgress){if(ownsVisibleGeneration(deferredGenerationProgress.owner))setGenerationProgress(deferredGenerationProgress.payload);deferredGenerationProgress=null}if(liveStreamState)liveStreamState.visualPaused=false}
function switchSettingsTab(tab){settingsNavigationTouched=true;settingsTab=tab;renderSettings()}
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
function openNewSessionModal(){qs('new-session-modal').classList.remove('hidden');setTimeout(()=>qs('new-session-title').focus(),50)}
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
        if(sessions.some(x=>x.id===selectedAtStart)) await openSession(selectedAtStart,false);
        else {currentSessionId=null;currentSessionData=null;sessionNavigationEpoch++;refreshHeader();refreshChatBox();}
    }
    if(!currentSessionId&&sessions.length)await openSession(sessions[0].id,false);
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
    const res=await fetchStory('/sessions','POST',{title,mode,characterMode:mode,canonLevel:'alternate',enabledPersonaSources:{sandalphonPersona:mode==='sandalphon',userPersona:mode==='sandalphon',telegramContext:false,longTermMemory:false,sandalphonState:false},enabledContextSources:{storySummary:true,recentMessages:true,telegramContext:false,vectorMemory:false},promptSettings:{recentMessageLimit:34,worldbookBudgetChars:16000,summaryEnabled:true,pinnedFactsEnabled:true}});
    if(!res.success)return toast(res.msg||'创建失败');
    closeNewSessionModal(); qs('new-session-title').value=''; await loadAll(); await openSession(res.data.id,true); openSettings('roles');
}
async function openSession(id, close=true){
    const epoch=++sessionNavigationEpoch;
    const res=await fetchStory(`/sessions/${id}`);
    if(epoch!==sessionNavigationEpoch)return null; // Later navigation owns the page.
    if(!res.success||res.data?.id!==id){toast(res.msg||'打开剧情失败：返回了不同的会话');return null;}
    const switched=currentSessionId!==id;
    if(switched)preserveComposerDraft(currentSessionId);
    currentSessionId=id;currentSessionData=res.data;
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
        pending=jobs.filter(job=>job&&['needs_review','interrupted'].includes(job.status));
    }catch(e){loadError=e;}
    if(generation!==memoryRibbonGeneration||sessionId!==currentSessionId)return;
    if(!loadError&&!pending.length)return;
    const ribbon=qs('context-ribbon');if(!ribbon)return;
    ribbon.classList.remove('hidden');
    const status=document.createElement('span');
    status.textContent=loadError?' · 剧情记忆状态无法读取，请检查任务记录。':` · 剧情记忆有 ${pending.length} 项待核对，原始剧情已保留。`;
    ribbon.appendChild(status);
    const open=document.createElement('button');open.type='button';open.className='tool-mini';open.textContent='查看记忆';
    open.addEventListener('click',()=>openSettings('memory'));ribbon.appendChild(open);
}

function renderSettings(){
    const renderEpoch=++settingsRenderEpoch;
    qsa('.settings-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===settingsTab));
    syncAppearancePreviewMode(settingsTab==='appearance');
    const box=qs('settings-content');
    if(settingsTab==='png-resources'){renderPngResourcesTab(box);return;}
    if(!currentSessionData&&!['appearance','api','data','diagnostics'].includes(settingsTab)){box.innerHTML='<div class="empty-state"><p>选择一种方式开始。</p><div class="toolbar"><button class="primary-btn" onclick="openNewSessionModal()">开始新剧情</button><button class="ghost-btn" onclick="MimaCompatUI.open()">🎴 玩酒馆角色卡</button></div></div>';return}
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

function renderWorldbookTab(box){
    const mounted=new Set(currentSessionData.worldbookIds||[]);
    box.innerHTML=`<section class="settings-section"><h3>📚 世界书</h3><p class="helper">Depth（深度）0 = System Prompt（系统提示词）；可选前 / 中 / 后插槽。Depth &gt; 0 会插进最近聊天历史指定深度。本轮命中情况可去“🔬 Prompt（提示词）”查看。</p><div class="toolbar"><button class="primary-btn" onclick="openWorldbookEditor()">＋ 新建世界书</button><button class="ghost-btn" onclick="chooseWorldbookImport()">⇧ 导入 JSON（数据）</button></div><div id="worldbook-list"></div></section>`;
    const root=qs('worldbook-list'); if(!worldbooks.length){root.innerHTML='<div class="row-sub">还没有世界书。</div>';return}
    worldbooks.forEach(w=>{const row=document.createElement('div');row.className='worldbook-row';row.innerHTML=`<input type="checkbox" ${mounted.has(w.id)?'checked':''} onchange="toggleWorldbookMount('${w.id}',this.checked)"><div class="row-main"><div class="row-title">${escapeHtml(w.name)}</div><div class="row-sub">${w.entries?.length||0} 条 · ${escapeHtml(w.description||'无说明')}</div></div><button class="ghost-btn" onclick="openWorldbookEditor('${w.id}')">编辑</button><button class="ghost-btn" onclick="exportWorldbook('${w.id}')">导出</button>`;root.appendChild(row)})
}
async function toggleWorldbookMount(id,on){const set=new Set(currentSessionData.worldbookIds||[]);on?set.add(id):set.delete(id);await patchCurrent({worldbookIds:[...set]},true);refreshHeader();renderSettings()}
function defaultEntry(){return {name:'新条目',content:'',keywords:[],secondaryKeywords:[],enabled:true,alwaysActive:false,matchMode:'any',caseSensitive:false,useRegex:false,priority:50,scanDepth:12,depth:0,position:'middle',maxChars:0}}
function openWorldbookEditor(id=null){const old=id?worldbooks.find(x=>x.id===id):null;editorState={type:'worldbook',id,draft:clone(old||{name:'新世界书',description:'',tags:[],enabled:true,entries:[]})};qs('editor-title').textContent=id?`编辑世界书 · ${old.name}`:'新建世界书';qs('editor-eyebrow').textContent='WORLDBOOK（世界书）';renderWorldbookEditorBody();setupEditorButtons(id?()=>deleteWorldbook(id):null,saveWorldbookEditor);qs('editor-modal').classList.remove('hidden')}
function renderWorldbookEditorBody(){const w=editorState.draft;qs('editor-body').innerHTML=`<div class="form-grid"><div><label class="form-label">世界书名称</label><input id="wb-name" class="field" value="${escapeHtml(w.name||'')}"></div><div><label class="form-label">Tags（标签）</label><input id="wb-tags" class="field" value="${escapeHtml(arr(w.tags).join(', '))}"></div><div class="form-full"><label class="form-label">说明</label><textarea id="wb-desc" class="field textarea">${escapeHtml(w.description||'')}</textarea></div></div><div class="toolbar" style="margin-top:14px"><button class="ghost-btn" onclick="addWorldbookEntry()">＋ 新增条目</button></div><div id="wb-entry-list" class="entry-list"></div>`;const root=qs('wb-entry-list');(w.entries||[]).forEach((e,i)=>{const d=document.createElement('details');d.className='entry-card';d.open=(w.entries.length<=3);d.dataset.entryIndex=i;d.innerHTML=`<summary><strong>${escapeHtml(e.name||`条目 ${i+1}`)}</strong><div class="entry-meta">Depth（深度） ${e.depth??0} · ${escapeHtml(positionLabel(e.position||'middle'))} · priority（优先级） ${e.priority??50}${e.alwaysActive?' · Always（常驻）':''}</div></summary><div class="form-grid" style="margin-top:10px">
<div><label class="form-label">条目名称</label><input data-f="name" class="field" value="${escapeHtml(e.name||'')}"></div><div><label class="form-label">主关键词（逗号分隔）</label><input data-f="keywords" class="field" value="${escapeHtml(arr(e.keywords).join(', '))}"></div><div><label class="form-label">次关键词（可选）</label><input data-f="secondaryKeywords" class="field" value="${escapeHtml(arr(e.secondaryKeywords).join(', '))}"></div><div><label class="form-label">匹配</label><select data-f="matchMode" class="field"><option value="any" ${e.matchMode!=='all'?'selected':''}>任一关键词</option><option value="all" ${e.matchMode==='all'?'selected':''}>全部关键词</option></select></div>
<div><label class="form-label">Depth（深度，0=系统提示区段；世界书仍属于剧情资料，不获得系统权限）</label><input data-f="depth" class="field" type="number" min="0" max="200" step="1" value="${Number(e.depth??0)}"></div><div><label class="form-label">注入位置</label><select data-f="position" class="field"><option value="front" ${e.position==='front'?'selected':''}>前</option><option value="middle" ${e.position==='middle'?'selected':''}>中</option><option value="back" ${e.position==='back'?'selected':''}>后</option></select></div><div><label class="form-label">Priority（优先级，小值优先）</label><input data-f="priority" class="field" type="number" value="${Number(e.priority??50)}"></div><div><label class="form-label">扫描最近消息数</label><input data-f="scanDepth" class="field" type="number" min="1" max="200" step="1" value="${Number(e.scanDepth||12)}"></div><div><label class="form-label">条目最大字符（0=不限）</label><input data-f="maxChars" class="field" type="number" min="0" max="100000" step="1" value="${Number(e.maxChars||0)}"></div>
<div class="form-full"><label class="check-row"><input data-f="enabled" type="checkbox" ${e.enabled!==false?'checked':''}> 启用</label><label class="check-row"><input data-f="alwaysActive" type="checkbox" ${e.alwaysActive?'checked':''}> Always Active（始终激活）</label><label class="check-row"><input data-f="caseSensitive" type="checkbox" ${e.caseSensitive?'checked':''}> 大小写敏感</label><label class="check-row"><input data-f="useRegex" type="checkbox" ${e.useRegex?'checked':''}> Regex（正则）关键词</label></div><div class="form-full"><label class="form-label">注入内容</label><textarea data-f="content" class="field textarea tall">${escapeHtml(e.content||'')}</textarea></div><div class="form-full"><button class="danger-btn" onclick="removeWorldbookEntry(${i})">删除此条目</button></div></div>`;root.appendChild(d)})}
function captureWorldbookDraft(){if(!editorState||editorState.type!=='worldbook')return;const w=editorState.draft;w.name=qs('wb-name')?.value||w.name;w.description=qs('wb-desc')?.value||'';w.tags=csv(qs('wb-tags')?.value||'');w.entries=qsa('[data-entry-index]',qs('wb-entry-list')).map(block=>{const get=f=>block.querySelector(`[data-f="${f}"]`);return {id:w.entries[Number(block.dataset.entryIndex)]?.id,name:get('name').value,keywords:csv(get('keywords').value),secondaryKeywords:csv(get('secondaryKeywords').value),matchMode:get('matchMode').value,depth:Number(get('depth').value||0),position:get('position').value,priority:Number(get('priority').value === '' ? 50 : get('priority').value),scanDepth:Number(get('scanDepth').value||12),maxChars:Number(get('maxChars').value||0),enabled:get('enabled').checked,alwaysActive:get('alwaysActive').checked,caseSensitive:get('caseSensitive').checked,useRegex:get('useRegex').checked,content:get('content').value}})}
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
  const mountedIds=arr(currentSessionData.presetIds),active=new Set(mountedIds),mountIndex=new Map(mountedIds.map((id,index)=>[id,index]));
  box.innerHTML=`<section class="settings-section"><h3>🧩 原生剧情预设</h3><p class="helper">本剧情已挂载 ${active.size} 项预设。只有勾选挂载且资源已启用的预设才会进入下一轮模型请求；预设保存到资源库不等于自动挂载到所有剧情。发送顺序按优先级数字从小到大排列：0、1、2……；相同数字按本剧情的挂载顺序发送。下方已挂载项目的顺序与实际发送一致。可用「Prompt 检查器」核对完整消息队列。</p><div class="toolbar"><button class="primary-btn" onclick="openPresetEditor()">＋ 新建预设</button><button class="ghost-btn" onclick="MimaAssistantStudio.open('preset')">✦ 打开预设助手</button></div><div id="preset-list"></div></section>`;
  const root=qs('preset-list');if(!presets.length){root.innerHTML='<div class="row-sub">暂无预设。</div>';return}
  const ordered=presets.slice().sort((a,b)=>Number(a.priority??50)-Number(b.priority??50)||(mountIndex.get(a.id)??Number.MAX_SAFE_INTEGER)-(mountIndex.get(b.id)??Number.MAX_SAFE_INTEGER));
  ordered.forEach(p=>{const r=document.createElement('div');r.className='preset-row';r.innerHTML=`<input type="checkbox" ${active.has(p.id)?'checked':''} onchange="togglePreset('${p.id}',this.checked)"><div class="row-main"><div class="row-title">${escapeHtml(p.name)}</div><div class="row-sub">${escapeHtml(presetTypeLabel(p.type||'style'))} · priority（发送顺序） ${p.priority??50}</div></div><button class="ghost-btn" onclick="openPresetEditor('${p.id}')">编辑</button>`;root.appendChild(r)});
}
async function togglePreset(id,on){const set=new Set(currentSessionData.presetIds||[]);on?set.add(id):set.delete(id);await patchCurrent({presetIds:[...set]},true);renderSettings()}
function openPresetEditor(id=null){const p=id?presets.find(x=>x.id===id):{name:'',type:'style',description:'',content:'',priority:50};editorState={type:'preset',id};qs('editor-title').textContent=id?`编辑预设 · ${p.name}`:'新建预设';qs('editor-eyebrow').textContent='PRESET（预设）';qs('editor-body').innerHTML=`<div class="form-grid"><div><label class="form-label">名称</label><input id="pre-name" class="field" value="${escapeHtml(p.name||'')}"></div><div><label class="form-label">类型</label><select id="pre-type" class="field">${['style','format','behavior','model'].map(x=>`<option value="${x}" ${p.type===x?'selected':''}>${presetTypeLabel(x)}</option>`).join('')}</select></div><div><label class="form-label">Priority（发送顺序，小值先发）</label><input id="pre-priority" type="number" class="field" value="${Number(p.priority??50)}"></div><div class="form-full"><label class="form-label">说明</label><input id="pre-desc" class="field" value="${escapeHtml(p.description||'')}"></div><div class="form-full"><label class="form-label">内容</label><textarea id="pre-content" class="field textarea tall">${escapeHtml(p.content||'')}</textarea></div></div>`;setupEditorButtons(id?()=>deletePreset(id):null,savePresetEditor);qs('editor-modal').classList.remove('hidden')}
async function savePresetEditor(){const body={name:qs('pre-name').value||'未命名预设',type:qs('pre-type').value,priority:Number(qs('pre-priority').value === '' ? 50 : qs('pre-priority').value),description:qs('pre-desc').value,content:qs('pre-content').value};const res=await fetchStory(editorState.id?`/presets/${editorState.id}`:'/presets',editorState.id?'PATCH':'POST',body);if(res.success){closeEditor();await loadAll();openSettings('presets')}else toast(res.msg||'保存失败')}
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
<section class="settings-section"><h3>🧠 长剧情 Context（上下文）</h3><div class="form-grid"><div><label class="form-label">最近原文消息数（条，不是回合；最多 200）</label><input id="ctx-recent" class="field" type="number" min="6" max="200" step="1" value="${Number(ps.recentMessageLimit??34)}"><div class="row-sub">这是自动整理时保留的近期消息窗口；模型容量允许时仍优先提供完整原始 History。修改后请点击下方保存。</div></div><div><label class="form-label">累计多少条旧剧情后自动整理记忆</label><input id="ctx-summary-trigger" class="field" type="number" min="12" max="200" value="${Number(ps.summaryTriggerMessages||28)}"><div class="row-sub">默认 28 条；不删减原始剧情，也不影响手动整理。</div></div><div><label class="form-label">世界书总预算（字符，最多 1,000,000）</label><input id="ctx-wbbudget" class="field" type="number" min="1000" max="1000000" step="1" value="${Number(ps.worldbookBudgetChars??16000)}"><div class="row-sub">这是本轮命中条目允许占用的字符上限，不保证所有条目都触发；实际仍受模型上下文窗口限制。超过窗口会报错，不会暗中删除原始剧情。</div></div><div class="form-full"><label class="form-label">🎭 AIRP 输入语义</label><select id="ctx-airp-mode" class="field"><option value="auto" ${(ps.inputSemanticMode||'raw')==='auto'?'selected':''}>智能自动（主动选择，可能误判）</option><option value="dialogue_first" ${ps.inputSemanticMode==='dialogue_first'?'selected':''}>对话优先：普通文本=台词，括号=动作/心理</option><option value="quote_dialogue" ${ps.inputSemanticMode==='quote_dialogue'?'selected':''}>引号台词：引号=台词，其余普通文本=动作</option><option value="raw" ${(ps.inputSemanticMode||'raw')==='raw'?'selected':''}>原样发送（默认）：关闭语义解析</option></select><div class="row-sub">默认按原文发送；已存消息保留当时的解析模式。选择并保存非原样模式才会对新消息启用语义改写，可能误判。智能自动会兼容两种常见 AIRP：有明确引号时把引号当台词、周围当动作；没有引号时普通文本默认台词，括号永远不是台词。括号中的明确“心想/内心/OS”等会标记为私密想法。</div></div><div class="form-full"><label class="check-row"><input id="ctx-summary" type="checkbox" ${ps.summaryEnabled!==false?'checked':''}> 自动 Rolling Summary（滚动摘要）</label><label class="check-row"><input id="ctx-complete-html" type="checkbox" ${ps.outputContract?.completeHtml===true?'checked':''}> 明确要求回复 HTML 标签完整闭合（普通文本不受限制）</label><label class="check-row"><input id="ctx-pinned-on" type="checkbox" ${ps.pinnedFactsEnabled!==false?'checked':''}> 注入 Pinned Facts（固定事实）</label></div><div class="form-full"><label class="form-label">📌 Pinned Facts（固定事实，一行一条）</label><textarea id="ctx-pinned" class="field textarea">${escapeHtml(arr(currentSessionData.pinnedFacts).join('\n'))}</textarea></div><div class="form-full"><label class="form-label">玩家备注</label><textarea id="ctx-usernotes" class="field textarea">${escapeHtml(currentSessionData.userNotes||'')}</textarea></div><div class="form-full"><label class="form-label">AI（人工智能）备注</label><textarea id="ctx-ainotes" class="field textarea">${escapeHtml(currentSessionData.aiNotes||'')}</textarea></div></div></section>
<div class="toolbar"><button id="ctx-save" class="primary-btn" type="button" onclick="saveContextSettings()">保存长剧情与会话设置</button><span class="row-sub">保存成功后，重新打开此页面仍会显示你设定的数值。</span></div>
<section class="settings-section"><h3>💾 本地档案</h3><p class="helper">剧情、角色卡、世界书、预设、正则包保存在当前浏览器 IndexedDB（本地数据库）。建议偶尔导出剧情资料备份；字体与 API Key（接口密钥）不会被打进这份“剧情资料备份”。</p><div class="toolbar"><button class="ghost-btn" onclick="exportCurrentSession()">⇩ 导出当前剧情</button><button class="ghost-btn" onclick="exportWholeLibrary()">⇩ 完整剧情资料备份</button><button class="ghost-btn" onclick="chooseLibraryImport()">⇧ 导入剧情资料备份</button><button class="danger-btn" onclick="deleteCurrentSession()">删除当前剧情</button></div></section>`}
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
    const recent=numeric('ctx-recent','近期原文消息数',6,200);
    if(recent===null)return null;
    const trigger=numeric('ctx-summary-trigger','自动整理间隔',12,200);
    if(trigger===null)return null;
    const worldBudget=numeric('ctx-wbbudget','世界书字符预算',1000,1000000);
    if(worldBudget===null)return null;
    const temp=numeric('ctx-temp','温度',0.1,2,{integer:false});
    if(temp===null)return null;
    const mode=qs('ctx-airp-mode')?.value||'raw';
    if(!['auto','dialogue_first','quote_dialogue','raw'].includes(mode)){
        toast('无效的 AIRP 输入模式，未保存');return null;
    }
    const expected={...(currentSessionData.promptSettings||{}),recentMessageLimit:recent,
        summaryTriggerMessages:trigger,worldbookBudgetChars:worldBudget,
        inputSemanticMode:mode,inputSemanticExplicit:true,summaryEnabled:qs('ctx-summary').checked,
        pinnedFactsEnabled:qs('ctx-pinned-on').checked};
    expected.outputContract=qs('ctx-complete-html').checked?{completeHtml:true}:null;
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
    return {core:m.core||{content:'',source:'context',targetChars:1000,temperature:.35},facts:arr(m.facts),settings:{injectCore:m.settings?.injectCore!==false,injectFacts:m.settings?.injectFacts!==false,factInjectionLimit:Number(m.settings?.factInjectionLimit||12),summaryTemperature:Number(m.settings?.summaryTemperature??.35)}};
}
function storyRoundCount(){return arr(currentSessionData?.messages).filter(m=>m?.role==='user').length}
function memoryDateLabel(v){if(!v)return'尚未生成';try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(_){return String(v)}}
function memorySourceLabel(v){return v==='facts'?'事实记忆':v==='manual'?'手工编辑':'剧情原文'}
function renderMemoryTab(box){
    const mem=memoryStore(),core=mem.core||{},facts=mem.facts.slice().sort((a,b)=>Number(a.startRound||0)-Number(b.startRound||0)||Number(a.endRound||0)-Number(b.endRound||0));
    const rounds=storyRoundCount(),temp=Math.max(.1,Math.min(2,Number(mem.settings.summaryTemperature??core.temperature??.35)||.35));
    const overlapCount=facts.reduce((n,f,i)=>n+facts.slice(0,i).filter(prev=>Number(prev.startRound)<=Number(f.endRound)&&Number(f.startRound)<=Number(prev.endRound)).length,0);
    const coreBehind=!!core.content&&core.source!=='manual'&&Number(core.sourceRoundCount||0)>0&&Number(core.sourceRoundCount)<rounds;
    const latestFactRound=facts.reduce((n,f)=>Math.max(n,Number(f.endRound)||0),0);
    const memoryWarnings=[
      ...(overlapCount?[`检测到 ${overlapCount} 组事实记忆轮次范围重叠，可能造成重复注入；旧记忆没有自动删除。`]:[]),
      ...(coreBehind?[`当前核心记忆只涵盖生成时的 ${core.sourceRoundCount} 轮，新增的 ${rounds-Number(core.sourceRoundCount)} 轮尚未压缩进核心记忆。`]:[]),
      ...(facts.length&&latestFactRound<rounds?[`事实记忆目前最多覆盖到第 ${latestFactRound} 轮，之后的轮次尚未总结。`]:[])
    ];
    const factCards=facts.length?facts.map(f=>`<div class="memory-card"><div class="memory-card-head"><div><strong>第 ${Number(f.startRound||0)}–${Number(f.endRound||0)} 轮</strong><div class="entry-meta">${escapeHtml(memoryDateLabel(f.updatedAt||f.createdAt))} · 约 ${Number(f.targetChars||0)||'—'} 字 · T=${Number(f.temperature??.35).toFixed(2)}</div></div><button class="tool-mini" onclick="deleteFactMemory('${escapeHtml(f.id)}')">删除</button></div><div class="memory-text">${escapeHtml(f.content||'')}</div></div>`).join(''):'<div class="memory-empty">还没有事实记忆。可以按 10 / 25 轮一段开始总结猫。</div>';
    box.innerHTML=`
    <section class="settings-section memory-overview"><h3>🗃️ 手动记忆总结</h3><p class="helper">调用当前 API / Model（模型）整理这个 Session（剧情会话）的长期记忆。这里的“1 轮”= 一次 User 发言 + 随后的角色回复；角色开场白会作为第 1 轮之前的前置信息纳入摘要，但不会单独占一轮。</p><div class="memory-stats"><div class="stat-card"><div class="stat-num">${rounds}</div><div class="stat-label">当前剧情轮数</div></div><div class="stat-card"><div class="stat-num">${facts.length}</div><div class="stat-label">事实记忆片段</div></div><div class="stat-card"><div class="stat-num">${core.content?'✓':'—'}</div><div class="stat-label">核心记忆</div></div></div>
    ${memoryWarnings.length?`<p class="helper" role="status">⚠ ${memoryWarnings.map(escapeHtml).join('　')}</p>`:''}<div class="form-grid memory-global-grid"><div><label class="form-label">Summary Temperature（总结温度）</label><input id="memory-temp" class="field" type="number" min="0.1" max="2" step="0.05" value="${temp.toFixed(2)}"><div class="row-sub">只影响手动记忆总结，不会改你正常跑剧情的温度；若 API 页关闭“发送 Temperature”，则接口不会收到温度参数。</div></div><div><label class="form-label">后续剧情注入</label><label class="check-row"><input id="memory-inject-core" type="checkbox" ${mem.settings.injectCore?'checked':''}> 注入核心记忆</label><label class="check-row"><input id="memory-inject-facts" type="checkbox" ${mem.settings.injectFacts?'checked':''}> 注入事实记忆</label></div><div><label class="form-label">最多注入最近几段事实记忆</label><input id="memory-inject-limit" class="field" type="number" min="1" max="100" value="${Math.max(1,Math.min(100,Number(mem.settings.factInjectionLimit||12)))}"></div></div>
    <div class="toolbar"><button class="ghost-btn" onclick="saveMemorySettings()" >保存记忆设置</button></div><div id="memory-progress" class="memory-progress ${memoryTask?.sessionId===currentSessionId?'':'hidden'}"><div class="memory-progress-head"><span id="memory-progress-label">正在调用 LLM（大语言模型）…</span><span id="memory-progress-percent">0%</span></div><div class="memory-progress-track"><div id="memory-progress-bar" class="memory-progress-bar"></div></div><div id="memory-progress-detail" class="row-sub"></div><button class="tool-mini" onclick="stopMemorySummary()">停止总结</button></div></section>

    <section class="settings-section"><h3>💎 核心记忆</h3><p class="helper">不是流水账。它会从第一轮开始提炼真正影响长期剧情的东西，尤其优先保存关系转变、承诺/约定、重要选择及后果、持续状态变化和未解决事项。也可以直接用已经生成的事实记忆再压缩一次。</p><div class="form-grid"><div><label class="form-label">总结来源</label><select id="core-memory-source" class="field"><option value="context" ${core.source!=='facts'?'selected':''}>从第一轮剧情原文开始总结</option><option value="facts" ${core.source==='facts'?'selected':''}>根据事实记忆总结核心记忆</option></select></div><div><label class="form-label">目标字数</label><input id="core-memory-target" class="field" type="number" min="100" max="12000" step="100" value="${Number(core.targetChars||1000)}"><div class="memory-quick-targets"><button class="tool-mini" onclick="setCoreMemoryTarget(500)">500</button><button class="tool-mini" onclick="setCoreMemoryTarget(1000)">1000</button><button class="tool-mini" onclick="setCoreMemoryTarget(2000)">2000</button></div></div><div class="form-full"><label class="form-label">核心记忆正文 · ${escapeHtml(memorySourceLabel(core.source))} · ${escapeHtml(memoryDateLabel(core.updatedAt))}</label><textarea id="core-memory-content" class="field textarea tall" placeholder="生成后会显示在这里，也可以手工修订。">${escapeHtml(core.content||'')}</textarea></div></div><div class="toolbar"><button class="primary-btn memory-action" onclick="generateCoreMemory()" ${memoryGenerating?'disabled':''}>✨ 生成 / 重做核心记忆</button><button class="ghost-btn" onclick="saveCoreMemoryEdit()" >保存手工修改</button>${core.content?'<button class="danger-btn" onclick="clearCoreMemory()" '+(memoryGenerating?'disabled':'')+'>清空核心记忆</button>':''}</div></section>

    <section class="settings-section"><h3>🕰️ 滚动剧情摘要（可撤销）</h3><p class="helper">只影响模型收到的旧剧情摘要，不会删除原始 History。错误摘要可撤销并从第一条重新总结；撤销前的版本暂存供恢复。正在运行的总结任务不能抢占。</p><div class="row-sub">已总结至消息索引 ${Number(currentSessionData?.lastSummarizedIndex||0)}；旧摘要备份 ${Array.isArray(currentSessionData?.rollingArchive)?currentSessionData.rollingArchive.length:0} 份</div><details><summary>查看当前滚动摘要</summary><pre class="memory-review-source">${escapeHtml(currentSessionData?.rollingSummary||currentSessionData?.summary||'(尚未生成)')}</pre></details><div class="toolbar"><button type="button" class="danger-btn" onclick="revokeRollingMemory()" ${memoryGenerating?'disabled':''}>撤销错误滚动摘要（保留原文）</button>${currentSessionData?.rollingArchive?.length?`<button type="button" class="ghost-btn" onclick="restoreRollingMemory()" ${memoryGenerating?'disabled':''}>恢复上一份摘要</button>`:''}</div></section>
    <section class="settings-section"><h3>🧾 事实记忆</h3><p class="helper">按固定轮数把剧情浓缩成小段事实档案，只写“发生了什么”，不做文学赏析、不乱补设定。最近 X 轮适合日常增量补记；从头到尾适合重建整本事实档案。</p><div class="form-grid"><div><label class="form-label">每 X 轮总结一段</label><input id="fact-memory-chunk" class="field" type="number" min="1" max="200" value="10"></div><div><label class="form-label">每段目标字数</label><input id="fact-memory-target" class="field" type="number" min="80" max="4000" step="20" value="360"></div><div><label class="form-label">总结范围</label><select id="fact-memory-scope" class="field" onchange="syncFactMemoryScope()"><option value="recent" selected>只总结最近 X 轮</option><option value="all">从头到尾全部总结</option></select></div><div id="fact-memory-recent-wrap"><label class="form-label">最近多少轮</label><input id="fact-memory-recent" class="field" type="number" min="1" max="100000" value="25"></div><div class="form-full" id="fact-memory-replace-wrap"><label class="check-row"><input id="fact-memory-replace" type="checkbox"> 从头到尾完成后，用新事实记忆整体顶掉旧事实记忆</label><div class="row-sub">只在“从头到尾”模式生效。生成过程中如果 API 失败，旧记忆不会被提前删除。</div></div></div><div class="toolbar"><button class="primary-btn memory-action" onclick="generateFactMemories()" ${memoryGenerating?'disabled':''}>🧠 开始事实总结</button>${facts.length?'<button class="danger-btn" onclick="clearAllFactMemories()" '+(memoryGenerating?'disabled':'')+'>清空全部事实记忆</button>':''}</div><div class="memory-list">${factCards}</div></section>`;
    syncFactMemoryScope();
    paintMemoryProgress();
    refreshDurableMemoryJobs().catch(e=>console.error('Memory journal UI:',e));
}
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
            if(label)label.textContent=task.controller.signal.aborted?'正在停止总结…':payload.phase==='done'?'正在确认保存…':`${task.kind==='core'?'核心记忆':'事实记忆'} · 运行中`;
        }
    }
    const floating=memoryFloatingElement();floating.classList.toggle('hidden',!task);
    if(task){
        const detail=task.progress?.detail||'正在准备材料…';
        qs('memory-task-floating-text').textContent=`🧠 ${task.kind==='core'?'核心记忆':'事实记忆'} · ${task.sessionTitle} · ${task.controller.signal.aborted?'正在停止…':detail}`;
    }
}
function handleMemoryProgress(payload={}){
    if(!memoryTask)return;
    // Progress belongs to the task, not to the currently mounted settings DOM.
    const prev=Number(memoryTask.progress?.percent)||0;
    memoryTask.progress={...memoryTask.progress,...payload,percent:Math.max(prev,Number(payload.percent)||0)};
    paintMemoryProgress();
}
async function refreshDurableMemoryJobs(){
    if(!currentSessionId||settingsTab!=='memory')return;
    const host=qs('memory-job-debts')||document.createElement('div');host.id='memory-job-debts';
    if(!host.isConnected)qs('memory-progress')?.parentNode?.appendChild(host);
    const sessionId=currentSessionId;const rows=[];
    for(const kind of ['core','facts','rolling']){
        try{const job=await MimaLocalStore.getMemoryJob(sessionId,kind);
            if(job&&job.status!=='committed'&&job.status!=='skipped'&&job.status!=='rejected')rows.push(job);
        }catch(e){host.textContent='记忆任务记录读取失败，禁止当作空任务：'+e.message;return;}
    }
    if(currentSessionId!==sessionId||settingsTab!=='memory')return;
    host.replaceChildren();
    for(const job of rows){const line=document.createElement('div');line.className='entry-card';
        const label=document.createElement('div');label.textContent=`${job.kind} · ${job.status==='running'?'当前页面状态不确定（刷新后需核实）':job.status==='needs_review'?'待人工核对':job.status==='interrupted'?'分片已核对，等待完成剩余总结':job.status} · ${job.stage} · ${job.code||''}`;line.appendChild(label);
        const btn=document.createElement('button');btn.className='tool-mini';btn.textContent=job.status==='running'&&Number(job.leaseUntilEpoch||0)>Date.now()?'其他窗口可能仍运行（查看状态）':'安全恢复 / 重试原任务';
        btn.onclick=()=>resumeMemoryJob(job.kind,job.id);line.appendChild(btn);
        const discard=document.createElement('button');discard.type='button';discard.className='tool-mini';discard.textContent='废弃错误候选（保留任务记录）';
        discard.onclick=()=>discardMemoryCandidate(job);line.appendChild(discard);
        // A factual claim that cannot be proven from original messages is
        // durable *review material*, not an automatically trusted memory.
        const pending=[...(job.checkpoints||[])].reverse().find(c=>c.stage?.endsWith('_needs_review')&&typeof c.candidate==='string'&&
            !(job.checkpoints||[]).some(x=>x.stage==='human_'+c.stage.replace(/_needs_review$/,'')+'_accepted'||x.stage==='human_'+c.stage.replace(/_needs_review$/,'')+'_rejected'));
        if(pending){
            const notice=document.createElement('p');notice.className='helper';notice.textContent=`待人工核查候选 · ${pending.reason||'事实未验证'} · 尚未注入剧情`;
            const missing=Array.isArray(pending.missing)?pending.missing:[];
            if(pending.reason==='rolling_final_events_missing'){
                const warning=document.createElement('p');warning.className='helper';
                warning.textContent=`重要：最终合并未能证明覆盖 ${pending.missingCount||missing.length} 条原始剧情。当前摘要游标没有推进；这不是完成的总结。确认前须补齐遗漏或明确核对原文。`;
                line.appendChild(warning);
                const omissions=document.createElement('details');const omitTitle=document.createElement('summary');
                omitTitle.textContent='查看未覆盖的消息来源与索引';omissions.appendChild(omitTitle);
                const omitBody=document.createElement('pre');omitBody.className='memory-review-source';
                omitBody.textContent=missing.map(x=>`${x.index} [${x.messageId}] ${x.anchor||''}`).join('\n\n')||'已在任务日志记录遗漏详情';
                omissions.appendChild(omitBody);line.appendChild(omissions);
            }
            const preview=document.createElement('textarea');preview.className='field textarea';preview.rows=5;preview.value=pending.candidate;
            const provenance=document.createElement('details');
            const title=document.createElement('summary');title.textContent='查看本次总结来源（核对人物、否定、传言与时序）';provenance.append(title);
            const original=document.createElement('pre');original.className='memory-review-source';
            const messages=(currentSessionData?.messages||[]).slice(pending.sourceStartIndex??0,pending.sourceEndExclusive??job.sourceCount??0);
            // No source truncation or deletion: this collapsible pane is scrollable.
            original.textContent=messages.map(m=>`${m.role==='user'?'玩家':m.role==='assistant'?'角色':m.role} [${m.id}]：${m.rawContent||m.content||''}`).join('\n\n');
            provenance.append(original);
            const approved=document.createElement('label');approved.className='check-row';
            const checkbox=document.createElement('input');checkbox.type='checkbox';approved.append(checkbox,document.createTextNode(' 已逐条核对原始剧情；修正了传闻、否认、假设、人物归属和不实推断'));
            const controls=document.createElement('div');controls.className='toolbar';
            const accept=document.createElement('button');accept.type='button';accept.className='primary-btn';accept.textContent='确认并保存这份记忆';
            accept.onclick=()=>reviewPendingMemory(job,'accept',preview.value,checkbox.checked);
            const reject=document.createElement('button');reject.type='button';reject.className='ghost-btn';reject.textContent='驳回候选，保留旧记忆';
            reject.onclick=()=>reviewPendingMemory(job,'reject','',true);
            controls.append(accept,reject);line.append(notice,preview,provenance,approved,controls);
        }
        host.appendChild(line);
    }
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
async function reviewPendingMemory(job,action,text,approved){
    if(action==='accept'&&!approved)return toast('请先核对来源，再勾选确认。');
    const sessionId=currentSessionId;
    try{
        const reviewResult=await MimaLocalStore.reviewMemoryCandidate(sessionId,job.kind,job.id,action,text);
        await MimaStandalone.init();
        if(currentSessionId===sessionId){const latest=await fetchStory(`/sessions/${sessionId}`,'GET');if(latest.success)currentSessionData=latest.data;}
        if(isSettingsOpen()&&settingsTab==='memory')renderMemoryTab(qs('settings-content'));
        toast(action!=='accept'?'已驳回候选，旧记忆保留。':reviewResult.status==='committed'?
            '完整记忆已根据人工确认入库；原文未更改。':
            '局部分片已确认，尚未覆盖完整剧情。请点击“安全恢复 / 重试原任务”继续剩余分片。');
    }catch(e){console.error('memory review failed',{sessionId,jobId:job.id,kind:job.kind,code:e.code||e.message});toast('核查未提交：'+e.message+'。请刷新任务状态。');}
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
    const limit=validatedSettingNumber('memory-inject-limit','事实记忆注入条数',1,100);
    if(limit===null)return null;
    const temperature=validatedSettingNumber('memory-temp','记忆总结温度',0.1,2,false);
    if(temperature===null)return null;
    const requested={injectCore:!!qs('memory-inject-core')?.checked,injectFacts:!!qs('memory-inject-facts')?.checked,factInjectionLimit:limit,summaryTemperature:temperature};
    const targetSessionId=currentSessionId;
    const res=await fetchStory(`/sessions/${targetSessionId}/memory`,'PATCH',{settings:requested});
    if(!res.success){toast(res.msg||'保存失败');return null;}
    const returned=res.data?.manualMemory?.settings||{};
    if(Object.keys(requested).some(k=>returned[k]!==requested[k])){
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
        const endpoint=`/sessions/${sessionId}/memory/${kind==='core'?'core':'facts'}`;
        const res=await fetchStory(endpoint,'POST',options,false,handleMemoryProgress,task.controller.signal);
        if(!res.success && (res.aborted || task.controller.signal.aborted)){toast('记忆总结已停止，已保存的旧记忆未删除。');return;}
        if(!res.success){
            if(res.code==='E_MEMORY_NEEDS_REVIEW'){
                toast('摘要候选需要核对来源；它并非 API 故障，也没有写入长期记忆。请在下方任务记录中审核或驳回。');
                await refreshDurableMemoryJobs().catch(console.error);return;
            }
            console.error('记忆总结失败',{sessionId,kind,code:res.code,details:res.details});
            toast(`记忆总结失败：${res.msg||res.code||'未知错误'}`);return;
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
    const sessionId=currentSessionId,source=qs('core-memory-source')?.value||'context',targetChars=Number(qs('core-memory-target')?.value||1000),temperature=getMemoryTemperature();
    if(source==='facts'&&!memoryStore().facts.length)return toast('还没有事实记忆，请先生成事实记忆。');
    await runMemorySummary('core',sessionId,{source,targetChars,temperature});
}
async function generateFactMemories(){
    if(memoryGenerating)return toast('当前已有一个记忆任务；剧情生成不受限制。');
    const sessionId=currentSessionId,scope=qs('fact-memory-scope')?.value||'recent',chunkRounds=Number(qs('fact-memory-chunk')?.value||10),recentRounds=Number(qs('fact-memory-recent')?.value||25),targetChars=Number(qs('fact-memory-target')?.value||360),temperature=getMemoryTemperature(),replaceExisting=scope==='all'&&!!qs('fact-memory-replace')?.checked;
    if(!storyRoundCount())return toast('当前还没有可以总结的剧情轮次。');
    if(replaceExisting&&!confirm('这次“从头到尾”总结全部成功后，会用新事实记忆整体替换旧事实记忆。继续吗？'))return;
    await runMemorySummary('facts',sessionId,{scope,chunkRounds,recentRounds,targetChars,temperature,replaceExisting});
}
async function clearCoreMemory(){if(!confirm('清空当前核心记忆？剧情原文不会受影响。'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/core`,'DELETE');if(res.success){currentSessionData=res.data;toast('核心记忆已清空');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'清空失败')}
async function deleteFactMemory(id){if(!confirm('删除这一段事实记忆？'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts/${id}`,'DELETE');if(res.success){currentSessionData=res.data;renderMemoryTab(qs('settings-content'))}else toast(res.msg||'删除失败')}
async function clearAllFactMemories(){if(!confirm('清空全部事实记忆？核心记忆和剧情原文不会被删除。'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts`,'DELETE');if(res.success){currentSessionData=res.data;toast('事实记忆已清空');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'清空失败')}
async function exportWholeLibrary(){const data=await MimaStandalone.exportLibrary();downloadJson('mimamao-tavern-full-backup.json',{format:'mimamao-tavern-standalone',version:1,exportedAt:new Date().toISOString(),data});}
function chooseLibraryImport(){qs('library-file-input').value='';qs('library-file-input').click()}
async function importWholeLibrary(file){
    if(!file)return;
    try{
        const raw=JSON.parse(await file.text()),valid=MimaStandalone.validateLibrary(raw);
        const current=await MimaStandalone.exportLibrary();
        const describe=data=>`会话 ${data.sessions.length} / 小说 ${data.novelProjects?.length||0} / 角色卡 ${data.masks.length} / 世界书 ${data.worldbooks.length} / 预设 ${data.presets.length}`;
        if(!confirm(`已通过资料库结构校验。\n当前：${describe(current)}\n导入：${describe(valid)}\n\n这会替换当前资料库，建议先导出应急备份。确认覆盖吗？`))return;
        await MimaStandalone.importLibrary(raw);currentSessionId=null;currentSessionData=null;await loadAll();toast('完整酒馆备份已导入');
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
async function applyFullSettingsBackup(raw,{fromSnapshot=false}={}){
    if(!raw||raw.format!==FULL_SETTINGS_FORMAT||Number(raw.version)>FULL_SETTINGS_VERSION)throw new Error('不是受支持的咪嘛馆完整设置备份');
    const src=raw.data;
    if(!src||typeof src!=='object'||!src.library)throw new Error('备份里缺少剧情资料 library（资料库）');
    // Before changing fonts, preferences or API keys, verify the entire canonical data shape.
    MimaStandalone.validateLibrary(src.library);
    if(src.localPrefs!==undefined&&(!src.localPrefs||typeof src.localPrefs!=='object'||Array.isArray(src.localPrefs)))throw new Error('localPrefs 结构无效');
    if(src.fonts!==undefined&&!Array.isArray(src.fonts))throw new Error('fonts 结构无效');
    const previousApi=MimaStandalone.getApiConfig(),previousPrefs=collectPortableLocalPrefs();
    const selected={ui:MimaFontManager.getSelected('ui'),story:MimaFontManager.getSelected('story')};
    try{
        // Prepare external assets before the final canonical commit. Font imports only add assets;
        // they must never trigger an empty library write on partial import failure.
        if(Array.isArray(src.fonts)&&src.fonts.length&&MimaFontManager.importPortable)await MimaFontManager.importPortable(src.fonts,{replace:false});
        if(src.api&&typeof src.api==='object'){
            const incoming={...src.api};if(!incoming.apiKey)incoming.apiKey=previousApi.apiKey||'';
            MimaStandalone.saveApiConfig({...previousApi,...incoming});
        }
        restorePortableLocalPrefs(src.localPrefs||{});
        if(src.selectedFonts?.ui!==undefined)MimaFontManager.setSelected('ui',src.selectedFonts.ui||'');
        if(src.selectedFonts?.story!==undefined)MimaFontManager.setSelected('story',src.selectedFonts.story||'');
        await MimaStandalone.importLibrary(src.library); // last; atomic compare-and-swap
    }catch(e){
        MimaStandalone.saveApiConfig(previousApi);
        for(const key of FULL_SETTINGS_KEYS){if(Object.prototype.hasOwnProperty.call(previousPrefs,key))localStorage.setItem(key,previousPrefs[key]);else localStorage.removeItem(key)}
        MimaFontManager.setSelected('ui',selected.ui||'');MimaFontManager.setSelected('story',selected.story||'');
        applyStoryTypography();restoreLegacyFont();
        throw e;
    }
    applyStoryTypography();restoreLegacyFont();
    currentSessionId=null;currentSessionData=null;
    await loadAll();
    if(!fromSnapshot)openSettings('data');
}
async function importFullSettingsFile(file){
    if(!file)return;
    if(!confirm('导入完整设置会用备份中的剧情/角色卡/世界书/预设/CSS 数据覆盖当前资料库，并恢复外观与 API 配置。继续吗？'))return;
    try{const raw=JSON.parse(await file.text());await applyFullSettingsBackup(raw);toast('完整咪嘛馆设置数据已恢复')}catch(e){toast(`完整设置导入失败：${e.message}`)}
}
async function restoreSavedSettingsSnapshot(){
    try{
        const snap=await MimaLocalStore.loadSettingsSnapshot();
        if(!snap)return toast('当前浏览器还没有保存过咪嘛馆设置快照');
        if(!confirm(`恢复本机设置快照？\n保存时间：${snap.savedAt||snap.exportedAt||'未知'}\n\n这会覆盖当前剧情资料库。`))return;
        await applyFullSettingsBackup(snap,{fromSnapshot:true});
        openSettings('data');toast('本机设置快照已恢复');
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
<section class="settings-section"><h3>🪄 CSS Preset Library（CSS 预设库）</h3><p class="helper">支持直接粘贴或导入<strong>纯 CSS</strong>，不需要手动包 &lt;style&gt;。CSS 可以只美化模型输出的自定义 HTML，也可以覆盖剧情区域，或选择“咪嘛馆全局”直接二改整个 UI（界面）。模型输出本身仍经过 Safe HTML sanitizer（安全 HTML 清洗器），不会执行 &lt;script&gt; / &lt;style&gt;。</p><div class="toolbar css-default-tools"><button class="primary-btn" onclick="openCssPresetEditor()">＋ 新建 CSS（样式）</button><button class="ghost-btn" onclick="chooseCssImport()">⇧ 导入 .css（样式文件）</button><button class="ghost-btn" onclick="copyDefaultCss()">⧉ 一键复制默认 CSS（样式）</button><button class="ghost-btn" onclick="exportDefaultCss()">⇩ 导出默认 CSS（样式）</button><button class="ghost-btn" onclick="forkDefaultCss()">✦ 默认 CSS 二改</button><button class="ghost-btn" onclick="MimaAssistantStudio.open('css')">✦ CSS 美化助手</button><button class="danger-btn" onclick="emergencyDisableCss()">🚑 临时禁用自定义 CSS（样式）</button></div><div class="row-sub css-scope-note">Scope（作用域）：自定义 HTML / Chat / Novel / Assistant / 咪嘛馆全局。Novel 与 Assistant 使用稳定公开 selector；全局 CSS 仍拥有最高覆盖能力。</div><div class="row-sub" style="margin:8px 0 12px">当前聊天：${currentCssPreset()?escapeHtml(currentCssPreset().name):'未挂载'} · ${currentSessionData?.customCssEnabled===false?'已禁用':'已启用'}</div><div class="toolbar">${currentSessionData?.customCssId?'<button class="ghost-btn" onclick="unapplyCss()">取消应用</button>':''}${currentSessionData?.customCssId&&currentSessionData?.customCssEnabled===false?'<button class="ghost-btn" onclick="reenableCss()">重新启用</button>':''}</div><button class="ghost-btn" onclick="unapplyGlobalCssPreset()">取消全局 CSS</button><div id="css-preset-list" class="card-grid css-preset-grid" style="margin-top:12px"></div></section>
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
function applyCustomCss(){
  const tag=ensureCustomCssStyle(),globalTag=ensureGlobalCssStyle(),preset=currentCssPreset();
  const safeCssBypass=new URLSearchParams(location.search).get('noCss')==='1';
  try{tag.textContent=safeCssBypass||!currentSessionData||currentSessionData.customCssEnabled===false||!preset?'':compileCustomCss(preset);}catch(e){tag.textContent='';console.error('Scoped CSS 已拒绝无效规则',e);toast(`CSS 作用域解析失败：${e.message}`)}
  const setting=MimaStandalone.getState?.().themeSettings||{},globalPreset=cssPresets.find(x=>x.id===setting.globalCssPresetId&&x.scope==='app');
  globalTag.textContent=safeCssBypass||setting.globalCssEnabled===false||!globalPreset?'':compileCustomCss(globalPreset);
  window.MimaAtelierCore?.reaffirm?.();
}
async function applyGlobalCssPreset(id){const preset=cssPresets.find(x=>x.id===id&&x.scope==='app');if(!preset)return toast('只能全局应用咪嘛馆全局范围 CSS');const r=await fetchStory('/theme','PATCH',{globalCssPresetId:id,globalCssEnabled:true});if(!r.success)return toast(r.msg||'全局 CSS 挂载失败');applyCustomCss();renderCssPresetLibrary(qs('css-preset-list'));toast('已全局应用 CSS：聊天、小说、设置与助手均可受其覆盖')}
async function unapplyGlobalCssPreset(){const r=await fetchStory('/theme','PATCH',{globalCssPresetId:null,globalCssEnabled:false});if(!r.success)return toast(r.msg||'取消失败');applyCustomCss();renderCssPresetLibrary(qs('css-preset-list'));toast('已禁用全局 CSS')}
function cssScopeLabel(scope){return scope==='app'?'咪嘛馆全局 Scope（作用域）':scope==='novel'?'Novel Studio（小说工作区）':scope==='assistant'?'Assistant Studio（助手工作区）':scope==='global'?'剧情面板级 Scope（作用域）':'自定义 HTML 内容级 Scope（作用域）'}
function renderCssPresetLibrary(root){if(!root)return;const active=currentSessionData?.customCssId,globalId=MimaStandalone.getState?.().themeSettings?.globalCssPresetId;root.innerHTML='';if(!cssPresets.length){root.innerHTML='<div class="row-sub">还没有 CSS Preset。可以新建或导入。</div>';return}cssPresets.forEach(p=>{const global=p.scope==='app',mounted=global?p.id===globalId:p.id===active;const row=document.createElement('div');row.className=`library-card ${mounted?'mounted':''}`;row.innerHTML=`<div class="card-title"><span>${escapeHtml(p.name)}</span>${mounted?`<span class="tag">${global?'全局挂载':'当前 Session'}</span>`:''}</div><div class="card-desc">${cssScopeLabel(p.scope)} · ${String(p.css||'').length} 字符</div><div class="card-actions"><button class="${mounted?'primary-btn':'ghost-btn'}" onclick="${global?'applyGlobalCssPreset':'applyCssPreset'}('${p.id}')">${global?'应用到全局':mounted?'重新启用':'应用到聊天'}</button><button class="ghost-btn" onclick="openCssPresetEditor('${p.id}')">编辑</button><button class="ghost-btn" onclick="duplicateCssPreset('${p.id}')">复制</button><button class="ghost-btn" onclick="exportCssPreset('${p.id}')">导出</button></div>`;root.appendChild(row)})}
function openCssPresetEditor(id=null){const p=id?cssPresets.find(x=>x.id===id):{name:'',css:'',scope:'story'};editorState={type:'css-preset',id};qs('editor-title').textContent=id?`编辑 CSS · ${p?.name||''}`:'新建 CSS Preset（CSS 预设）';qs('editor-eyebrow').textContent='CSS PRESET（CSS 预设）';qs('editor-body').innerHTML=`<div class="form-grid"><div class="form-full"><label class="form-label">名称</label><input id="css-pre-name" class="field" value="${escapeHtml(p?.name||'')}"></div><div class="form-full"><label class="form-label">Scope（作用域）</label><select id="css-pre-scope" class="field"><option value="story" ${p?.scope==='story'||!p?.scope?'selected':''}>自定义 HTML / 剧情内容（最安全）</option><option value="global" ${p?.scope==='global'?'selected':''}>剧情聊天区域</option><option value="app" ${p?.scope==='app'?'selected':''}>咪嘛馆全局 UI + HTML（全局二改）</option><option value="novel" ${p?.scope==='novel'?'selected':''}>Novel Studio（小说）</option><option value="assistant" ${p?.scope==='assistant'?'selected':''}>Assistant Studio（助手）</option></select><div class="row-sub">“咪嘛馆全局”会按原样应用 CSS，可修改顶栏、设置中心、输入框和剧情 HTML；若样式把 UI 隐藏，请重新打开页面后在外观里点“🚑 临时禁用”；极端情况下可在网址末尾加 <code>?noCss=1</code> 进入 CSS 安全模式。</div></div><div class="form-full"><label class="form-label">CSS（样式）</label><textarea id="css-pre-code" class="field textarea tall css-code-editor" spellcheck="false" placeholder="/* 直接写 CSS，不用 <style> */&#10;system, .status-card { padding: 12px; border-radius: 16px; }">${escapeHtml(p?.css||'')}</textarea></div></div>`;setupEditorButtons(id?()=>deleteCssPreset(id):null,saveCssPresetEditor);qs('editor-modal').classList.remove('hidden')}
async function saveCssPresetEditor(){const wantedScope=qs('css-pre-scope').value;const body={name:qs('css-pre-name').value.trim()||'未命名 CSS（样式）',scope:['story','global','app','novel','assistant'].includes(wantedScope)?wantedScope:'story',surface:wantedScope==='novel'?'novel':wantedScope==='assistant'?'assistant':wantedScope==='app'?'global':'chat',css:stripEmbeddedStyleTags(qs('css-pre-code').value)};const res=await fetchStory(editorState.id?`/css-presets/${editorState.id}`:'/css-presets',editorState.id?'PATCH':'POST',body);if(!res.success)return toast(res.msg||'保存 CSS 失败');const saved=res.data;closeEditor();await loadAll();applyCustomCss();openSettings('appearance');toast(`CSS Preset（CSS 预设）「${saved.name}」已保存`)}
async function applyCssPreset(id){if(!cssPresets.some(x=>x.id===id))return;if(!await patchCurrent({customCssId:id,customCssEnabled:true},true))return;applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('CSS（样式）已应用到当前 Session（剧情会话）')}
async function unapplyCss(){if(!await patchCurrent({customCssId:null,customCssEnabled:false},true))return;applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('当前 Session（剧情会话）已取消 CSS（样式）')}
async function emergencyDisableCss(){window.MimaAtelierCore?.disabled?.();await patchCurrent({customCssEnabled:false},true);ensureCustomCssStyle().textContent='';ensureGlobalCssStyle().textContent='';fetchStory('/theme','PATCH',{globalCssEnabled:false}).then(()=>applyCustomCss());if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('🚑 自定义 CSS（样式）已临时禁用')}
async function reenableCss(){if(!currentSessionData?.customCssId)return toast('当前 Session（剧情会话）没有挂载 CSS（样式）');if(!await patchCurrent({customCssEnabled:true},true))return;applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'))}
async function duplicateCssPreset(id){const p=cssPresets.find(x=>x.id===id);if(!p)return;const res=await fetchStory('/css-presets','POST',{name:`${p.name} · 副本`,css:p.css,scope:p.scope,surface:p.surface});if(res.success){await loadAll();openSettings('appearance');toast('CSS Preset（CSS 预设）已复制')}else toast(res.msg||'复制失败')}
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
function exportCssPreset(id){const p=cssPresets.find(x=>x.id===id);if(!p)return;const blob=new Blob([p.css||''],{type:'text/css;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(p.name||'mimamao').replace(/[\\/:*?"<>|]/g,'_')}.css`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
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
    <div><label class="form-label">模型上下文窗口（Tokens，0=未知，不假设硬上限）</label><input id="api-context-window" class="field" type="number" min="0" value="${Number(c.contextWindowTokens||0)}"><div class="row-sub">建议按模型提供商的真实数值填写。留空或填 0 时不会误把 32K 当作模型上限；仅对额外旧原文检索使用软预算，真实限制由 API 决定。不会删除 Persona 或 History。</div></div><div><label class="form-label">Max Tokens（最大输出 Tokens，0=不发送）</label><input id="api-max-tokens" class="field" type="number" min="0" value="${Number(c.maxTokens||0)}"></div>
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

function renderPromptTab(box){box.innerHTML=`<section class="settings-section"><h3>🔬 Prompt Inspector（提示词检查器）</h3><p class="helper">只预览、不调用 LLM。咪嘛馆在模型上下文容量允许时优先提供完整原始剧情；每轮各注入一份已启用 Persona / Preset 与预算内命中的 Worldbook。只有已核实的模型窗口不足时，才从本次 Prompt 暂时省略最早剧情，绝不删除本地 History。v1.1.4 还会显示上游返回的缓存命中统计；没有统计不等于没有缓存。</p><div class="toolbar"><button class="primary-btn" onclick="refreshPromptInspector()">扫描本轮 Prompt（提示词）</button><button class="ghost-btn" onclick="switchSettingsTab('diagnostics')">查看真实请求和异常日志</button></div><div id="prompt-inspector"><div class="row-sub">点击上方按钮生成预览。</div></div></section>`}
async function refreshPromptInspector(){
    const targetSessionId=currentSessionId,root=qs('prompt-inspector'),epoch=settingsRenderEpoch;
    if(!targetSessionId||!root)return;
    root.innerHTML='<div class="row-sub">正在组装……</div>';
    const res=await fetchStory(`/sessions/${targetSessionId}/prompt-preview`,'POST',{draft:qs('story-input').value,directorNote:qs('director-note').value});
    if(targetSessionId!==currentSessionId||epoch!==settingsRenderEpoch||root!==qs('prompt-inspector')||settingsTab!=='prompt'||!isSettingsOpen())return;
    if(!res.success){root.textContent=res.msg||'预览失败';return}
    const d=res.data,u=d.upstreamUsage||MimaStandalone.getLastUsage?.()||null;
    const cached=u?.cachedTokens;
    const cacheText=Number.isFinite(Number(cached))?Number(cached).toLocaleString():'—';
    const cacheNote=u?`最近一次上游 usage${u.model?` · ${escapeHtml(u.model)}`:''}${Number.isFinite(Number(cached))?`：缓存命中 ${Number(cached).toLocaleString()} tokens`:'：未提供 cached tokens 字段'}。`:'当前中转/模型尚未返回可识别的 usage 统计。';
    root.innerHTML=`<div class="prompt-stats"><div class="stat-card"><div class="stat-num">${Number(d.estimatedInputTokens||0).toLocaleString()}</div><div class="stat-label">估算输入 Tokens</div></div><div class="stat-card"><div class="stat-num">${d.recentMessageCount}/${d.recentMessageLimit||'—'}</div><div class="stat-label">最近消息窗口</div></div><div class="stat-card"><div class="stat-num">${d.matchedWorldbookEntries.length}</div><div class="stat-label">世界书命中</div></div><div class="stat-card"><div class="stat-num">${cacheText}</div><div class="stat-label">最近缓存命中 Tokens</div></div><div class="stat-card"><div class="stat-num">${d.systemChars}</div><div class="stat-label">System 字符</div></div><div class="stat-card"><div class="stat-num">${d.finalMessageCount}</div><div class="stat-label">最终 Messages</div></div></div><div class="cache-insight-card"><strong>🧊 Cache Insight（缓存观察）</strong><div class="row-sub">${cacheNote} 缓存是否真正命中由上游 Provider 决定；咪嘛馆不会伪造“已缓存”。</div></div><div class="row-sub">${d.contextTrace?.uncoveredRawCount?`本轮有 ${d.contextTrace.uncoveredRawCount} 条待总结旧原文处于最近窗口外；相关检索 ${d.contextTrace.retrievedCount} 条，未覆盖 ${d.contextTrace.omittedCount} 条（原文仍在本地）。`:'旧原文覆盖无额外缺口。'} ${d.contextTrace?.budgetVerified?'上下文预算：使用已配置模型窗口。':'模型上下文窗口未核实：不会以假定的 32K 上限阻断角色回复；检索旧原文仍受软预算约束。建议在 API 设置填写真实窗口以获得准确校验。'}</div><h4>本轮 Prompt 构成（字符数，非精确 Tokens）</h4><div class="hit-list">${(d.sections||[]).slice().sort((a,b)=>b.chars-a.chars).map(x=>`<div class="hit-item">${escapeHtml(x.name)}：${Number(x.chars||0).toLocaleString()} 字符</div>`).join('')||'<div class="hit-item">暂无项目</div>'}</div><h4>本轮世界书</h4><div class="row-sub">本轮预算：${Number(d.worldbookBudgetChars??0).toLocaleString()} 字符，实际占用：${Number(d.worldbookUsedChars??0).toLocaleString()} 字符。未注入条目请核对触发条件与跳过原因。</div><div class="hit-list">${d.matchedWorldbookEntries.length?d.matchedWorldbookEntries.map(x=>`<div class="hit-item">✅ ${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)} · Depth（深度） ${x.depth} · ${escapeHtml(x.position)} · ${escapeHtml(x.reason)}${x.hits?.length?` · 命中：${escapeHtml(x.hits.join(', '))}`:''}</div>`).join(''):'<div class="hit-item">本轮没有触发世界书条目；未触发条目不会进入本轮 Prompt。</div>'}</div><h4 style="margin-top:16px">实际 System 消息（玩家挂载与来源资料）</h4><pre class="prompt-pre">${escapeHtml(d.actualSystemPreview||'')}</pre><h4>旧版资料分栏（本轮资料已按来源列入消息队列）</h4><pre class="prompt-pre">${escapeHtml(d.userMaterialPreview||'（本轮无资料块）')}</pre><h4>面具加载与注入状态</h4><div class="hit-list">${(d.maskTrace||[]).map(x=>`<div class="hit-item">${escapeHtml(x.kind)} / ${escapeHtml(x.name||x.id||'未挂载')}：${escapeHtml(x.reason)} · ${x.injected?'已注入 System 资料':'未注入'}</div>`).join('')}</div><h4>原生预设挂载与实际出站（小值先发，0 最前）</h4><div class="row-sub">未挂载、已禁用和空内容均不会发送。数字只控制排列，无法保证模型服从或自动解决自由文本矛盾；请在下方完整消息队列核对。</div><div class="hit-list">${(d.presetTrace||[]).map(x=>`<div class="hit-item">${escapeHtml(x.name||x.id)}：${escapeHtml(x.reason)} · priority=${x.priority??'—'} · ${x.injected?`消息 #${x.sendIndex} · 已进入 System`:'未注入'}</div>`).join('')||'本轮未挂载预设'}</div><h4>世界书未注入原因</h4><div class="hit-list">${(d.worldbookMountTrace||[]).filter(x=>x.reason!=='enabled').map(x=>`<div class="hit-item">${escapeHtml(x.bookName||x.bookId)}：${escapeHtml(x.reason)}</div>`).join('')}${(d.skippedWorldbookEntries||[]).map(x=>`<div class="hit-item">${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)}：${escapeHtml(x.reason)}${x.reason==='budget'?`（需要 ${x.neededChars} 字符，剩余 ${x.remainingChars}）`:''}</div>`).join('')||'无额外跳过条目'}</div><h4>世界书深度注入（System 来源资料）</h4><div class="hit-list">${(d.depthInjections||[]).map(x=>`<div class="hit-item">${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)} · depth=${x.depth} · ${x.chars} 字符</div>`).join('')||'本轮无深度注入'}</div><details style="margin-top:12px"><summary>查看完整 Message（消息）队列</summary><pre class="prompt-pre">${escapeHtml(d.messagePreview.map(x=>`#${x.index+1} ${x.role}\n${x.content}`).join('\n\n'))}</pre></details>`;
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
        if(['rejected','aborted','conflict'].includes(record.status))row.appendChild(diagnosticRecoveryButton(record));
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
function downloadText(name,text,type='text/plain;charset=utf-8'){const blob=new Blob([String(text??'')],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
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
function setGenerationProgress(payload={}){const panel=qs('generation-panel'),bar=qs('generation-progress-bar'),label=qs('generation-label'),pct=qs('generation-percent'),detail=qs('generation-detail');if(!panel)return;panel.classList.remove('hidden','error','done');const n=Math.max(2,Math.min(100,Number(payload.percent)||2));bar.style.width=`${n}%`;pct.textContent=`${Math.round(n)}%`;if(payload.label)label.textContent=payload.label;if(payload.detail)detail.textContent=payload.detail}
function setGenerationRetryVisible(visible){for(const id of ['generation-retry','generation-retry-current'])qs(id)?.classList.toggle('hidden',!visible);}
function beginGenerationProgress(action){deferredGenerationProgress=null;currentGenerationAction=action;lastGenerationFailure=null;setGenerationRetryVisible(false);const panel=qs('generation-panel');panel?.classList.remove('hidden','error','done');setGenerationProgress({percent:4,label:`🤍 ${generationActionLabel(action)}`,detail:'正在准备本轮剧情…'})}
function isStoryNearBottom(box,threshold=96){return !box||((box.scrollHeight-box.scrollTop-box.clientHeight)<=threshold)}
function updateStoryFollowButton(){const b=qs('story-follow-stream');if(!b)return;b.classList.toggle('hidden',!liveStreamState||liveStreamState.followTail!==false)}
function resumeStoryStreamFollow(){if(!liveStreamState)return;liveStreamState.followTail=true;const box=qs('story-chat-box');if(box)box.scrollTop=box.scrollHeight;updateStoryFollowButton()}
function bindStoryStreamScroll(){const box=qs('story-chat-box');if(!box||box.dataset.streamFollowBound==='1')return;box.dataset.streamFollowBound='1';box.addEventListener('scroll',()=>{if(!liveStreamState)return;liveStreamState.followTail=isStoryNearBottom(box);updateStoryFollowButton()},{passive:true})}
function renderLiveStreamText(){
    const st=liveStreamState;
    if(!st?.contentNode||!ownsVisibleGeneration(st.owner))return;
    const raw=st.displayText||'';
    const rendered=MimaStandalone.applyRegexForSession?MimaStandalone.applyRegexForSession(st.owner.sessionId,raw,'display'):raw;
    const allowHtml=currentSessionData?.renderMode==='safe_html';
    st.contentNode.className=`msg-content tavern-story-content live-stream-content${allowHtml?' safe-html-content':''}`;
    st.contentNode.innerHTML='';appendRenderedContent(st.contentNode,rendered,allowHtml);
    const box=qs('story-chat-box');if(box&&st.followTail!==false)box.scrollTop=box.scrollHeight;
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
    liveStreamState={owner,node:div,contentNode:content,targetText:'',displayText:'',timer:null,followTail:isStoryNearBottom(box)};
    updateStoryFollowButton();return liveStreamState;
}
function pumpLiveStream(){
    const st=liveStreamState;if(!st||st.timer)return;
    st.timer=setInterval(()=>{
        if(liveStreamState!==st||!ownsVisibleGeneration(st.owner)){clearInterval(st.timer);st.timer=null;return;}
        if(isSettingsOpen()||st.visualPaused)return;
        const gap=st.targetText.length-st.displayText.length;if(gap<=0)return;
        const step=gap>500?6:gap>220?4:gap>80?2:1;
        st.displayText=st.targetText.slice(0,st.displayText.length+step);renderLiveStreamText();
    },12);
}
function handleGenerationProgress(payload,owner=currentGenerationOwner()){
    if(!owner||generationOwners.get(owner.sessionId)!==owner)return;
    owner.lastProgress=payload;
    if(payload?.phase==='saved_user'){owner.userSaved=true;clearSubmittedDraft(owner);}
    if(payload?.streamText!==undefined){
        const snippet=String(payload.streamText||'');
        const blocked=MimaStandalone.classifyStoryReply?.(snippet)?.blocked===true;
        owner.streamText=blocked?'':snippet;
        if(blocked&&ownsVisibleGeneration(owner))clearLiveStream();
    }
    if(!ownsVisibleGeneration(owner))return;
    if(isSettingsOpen())deferredGenerationProgress={owner,payload};else setGenerationProgress(payload);
    if(payload?.streamText!==undefined&&!MimaStandalone.classifyStoryReply?.(String(payload.streamText||''))?.blocked){
        const st=ensureLiveStreamBubble(owner);
        if(st){st.targetText=owner.streamText;st.visualPaused=isSettingsOpen();pumpLiveStream();}
    }
}
function clearLiveStream(){
    if(liveStreamState?.timer)clearInterval(liveStreamState.timer);
    if(liveStreamState?.node?.isConnected)liveStreamState.node.remove();
    liveStreamState=null;updateStoryFollowButton();
}
function finishGenerationProgress(owner=null){
    if(owner&&!ownsVisibleGeneration(owner))return;
    deferredGenerationProgress=null;lastGenerationFailure=null;currentGenerationAction=null;
    setGenerationRetryVisible(false);
    setGenerationProgress({percent:100,label:'🤍 生成完成',detail:'剧情已保存到本机。'});
    const panel=qs('generation-panel');panel?.classList.add('done');
    const sessionId=currentSessionId;
    setTimeout(()=>{if(!currentGenerationOwner()&&currentSessionId===sessionId)panel?.classList.add('hidden')},650);
}
function showGenerationError(err,action=currentGenerationAction,fromRestore=false){
    deferredGenerationProgress=null;
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
}
function retryFailedGeneration(parameters='original'){
    if(currentGenerationOwner())return toast('当前剧情正在生成中。');
    const failure=generationFailures.get(currentSessionId);
    if(!failure)return toast('当前剧情没有可重试的失败请求。');
    setGenerationRetryVisible(false);
    return triggerChat('','retry',{retryParameters:parameters==='current'?'current':'original'});
}
function dismissGenerationPanel(){qs('generation-panel')?.classList.add('hidden')}
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
    const owner={turnId:++generationSerial,sessionId:targetSessionId,action:actionType,text:String(text||''),
        controller:new AbortController(),lastProgress:null,streamText:'',userSaved:false,inputCleared:false};
    generationOwners.set(targetSessionId,owner);generationFailures.delete(targetSessionId);
    clearLiveStream();
    if(actionType==='send'&&owner.text.trim())renderPendingUserMessage(owner.text);
    toggleUIState(true);beginGenerationProgress(actionType);
    try{
        // Distinct sessions must never abort each other's Direct Reply.
        const res=await fetchStory(`/sessions/${targetSessionId}/chat`,'POST',
            {text,action:actionType,temperature:getTemp(),directorNote,targetMessageId,regenerationContext:generationOptions.regenerationContext||'original',retryParameters:generationOptions.retryParameters||'original',diagnosticTurnId:String(owner.turnId)},false,
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

function refreshChatBox(options={}){const box=qs('story-chat-box'),renderedSessionId=currentSessionId,renderedEpoch=sessionNavigationEpoch;box.innerHTML='';if(!currentSessionData||!currentSessionData.messages?.length){box.innerHTML=`<div class="empty-state"><div class="empty-icon">${currentChar()?'🤍':'🍷'}</div><h2>${escapeHtml(currentChar()?.name||'这个宇宙还是空的')}</h2><p>${currentChar()?.firstMessage?'角色卡里有开场白，可以在角色设置中插入。':'写下第一句话，剧情从这里开始。'}</p><button class="ghost-btn" onclick="MimaCompatUI.open()">🎴 或者用酒馆角色卡开始聊天</button></div>`;return}currentSessionData.messages.forEach(renderMessageToUI);requestAnimationFrame(()=>{if(renderedSessionId!==currentSessionId||renderedEpoch!==sessionNavigationEpoch)return;if(Number.isFinite(Number(options.scrollTop)))box.scrollTop=Number(options.scrollTop);else if(options.scrollToBottom!==false)box.scrollTop=box.scrollHeight})}
function renderPendingUserMessage(text){const box=qs('story-chat-box');if(!box)return;const div=document.createElement('article');div.className='message user-msg pending-user-message';div.dataset.msgId='pending_'+Date.now();const header=document.createElement('div');header.className='msg-header';header.textContent=`${currentUser()?.name||'你'} · 正在提交`;const content=document.createElement('div');content.className='msg-content tavern-story-content';appendRenderedContent(content,cleanCorruptText(text),false);div.append(header,content);box.appendChild(div);box.scrollTop=box.scrollHeight}
function renderMessageToUI(msg){const box=qs('story-chat-box');const role=msg.role||'system';const div=document.createElement('article');div.className=`message ${role}-msg`;div.dataset.msgId=msg.id||'';const header=document.createElement('div');header.className='msg-header';const roleName=role==='user'?(currentUser()?.name||'你'):(role==='assistant'?(currentChar()?.name||(currentSessionData?.mode==='sandalphon'?'圣德芬':'角色')):'系统');header.textContent=`${roleName}${msg.isEdited?' · 已编辑':''}${msg.versions?.length?` · ${msg.versions.length} 个旧版本`:''}`;div.appendChild(header);const content=document.createElement('div');const allowHtml=role==='assistant'&&currentSessionData?.renderMode==='safe_html';content.className=`msg-content tavern-story-content${allowHtml?' safe-html-content':''}`;const displayText=role==='assistant'&&MimaStandalone.applyRegexForSession?MimaStandalone.applyRegexForSession(currentSessionId,msg.content||'','display'):msg.content||'';appendRenderedContent(content,cleanCorruptText(displayText),allowHtml);div.appendChild(content);if(role==='user'||role==='assistant'){const tools=document.createElement('div');tools.className='msg-tools';tools.append(makeToolButton('编辑',()=>openMessageEditor(msg,false)),makeToolButton('从这里分支',()=>openMessageEditor(msg,true)),makeToolButton('删除',()=>deleteStoryMessage(msg),true));if(role==='assistant'&&msg.versions?.length)tools.append(makeToolButton('看旧版本',()=>showVersions(msg)));div.appendChild(tools)}box.appendChild(div)}
function makeToolButton(text,fn,danger=false){const b=document.createElement('button');b.className=`tool-mini${danger?' danger':''}`;b.textContent=text;b.onclick=fn;return b}
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
function appendProseText(parent,text){
    const raw=String(text??'').replace(/\r\n?/g,'\n');if(!raw.trim())return;
    const chunks=raw.split(/\n{2,}/);
    chunks.forEach(chunk=>{if(!chunk.trim())return;const p=document.createElement('div');p.className='story-prose story-paragraph';p.textContent=chunk.trim();parent.appendChild(p)});
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
function appendSafeHtmlWithProse(node,text){
    const template=document.createElement('template');template.innerHTML=sanitizeAllowedHtml(text||'');
    hydrateSafeHtmlDynamicMeters(template.content);
    let prose='';
    const flush=()=>{if(prose.trim())appendProseText(node,prose);prose=''};
    for(const child of [...template.content.childNodes]){
        if(child.nodeType===Node.TEXT_NODE){prose+=child.nodeValue||'';continue}
        if(child.nodeType===Node.ELEMENT_NODE&&child.tagName==='BR'){prose+='\n';continue}
        flush();node.appendChild(child);
    }
    flush();
}
function appendRenderedContent(node,text,allowHtml=false){if(allowHtml){appendSafeHtmlWithProse(node,text);return}appendProseText(node,text)}
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
function sanitizeAllowedHtml(html){
    const template=document.createElement('template');template.innerHTML=cleanCorruptText(html);
    const allowedTags=new Set(['SYSTEM','DIV','SPAN','P','BR','STRONG','B','EM','I','SMALL','MARK','S','U','SUB','SUP','KBD','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','DETAILS','SUMMARY','BLOCKQUOTE','PRE','CODE','H1','H2','H3','H4','H5','H6','UL','OL','LI','DL','DT','DD','TABLE','CAPTION','COLGROUP','COL','THEAD','TBODY','TFOOT','TR','TD','TH','HR','PROGRESS','METER']);
    const blockedTags=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','TEXTAREA','OPTION','META','LINK','BASE','SVG','MATH','VIDEO','AUDIO','SOURCE','TRACK','CANVAS','NOSCRIPT']);
    const allowedAttrs=new Set(['class','title','role','open','colspan','rowspan','scope','value','max','min','low','high','optimum']);
    const nodes=[...template.content.querySelectorAll('*')];
    for(const el of nodes){
        if(blockedTags.has(el.tagName)){el.remove();continue}
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
Object.assign(window,{goPhone,openDrawer,closeDrawer,openSettings,closeSettings,switchSettingsTab,choosePngResourceInspection,playInspectedPngInCompat,savePngSelectedResources,exportPngInspection,openNewSessionModal,closeNewSessionModal,createSession,deleteCurrentSession,exportCurrentSession,chooseSessionImport,toggleDirector,saveRoleMounts,mountMask,insertCharacterOpening,openMaskEditor,choosePersonaImport,exportMask,toggleWorldbookMount,openWorldbookEditor,addWorldbookEntry,removeWorldbookEntry,chooseWorldbookImport,exportWorldbook,togglePreset,openPresetEditor,toggleRegexPack,openRegexPackEditor,addRegexRule,removeRegexRule,testRegexDraft,chooseRegexImport,exportRegexPack,saveContextSettings,saveMemorySettings,saveCoreMemoryEdit,generateCoreMemory,generateFactMemories,clearCoreMemory,deleteFactMemory,clearAllFactMemories,revokeRollingMemory,restoreRollingMemory,discardMemoryCandidate,setCoreMemoryTarget,syncFactMemoryScope,stopMemorySummary,exportWholeLibrary,chooseLibraryImport,saveFullSettingsSnapshot,restoreSavedSettingsSnapshot,exportFullSettingsBackup,chooseFullSettingsImport,chooseFontImport,changeFont,deleteLocalFont,toggleSafeHtml,applyLegacyUrlFont,openCssPresetEditor,applyCssPreset,unapplyCss,emergencyDisableCss,reenableCss,duplicateCssPreset,deleteCssPreset,chooseCssImport,exportCssPreset,copyDefaultCss,exportDefaultCss,forkDefaultCss,saveApiSettings,loadApiModels,testApiConnection,chooseApiImport,syncApiModelSelect,syncTemperature,updateStoryTypography,resetStoryTypography,setAppearancePreviewSurface,setBuiltInTheme,dismissGenerationPanel,retryFailedGeneration,resumeStoryStreamFollow,refreshPromptInspector,closeEditor,deleteStoryMessage,sendMsg,regenerateMsg,regenerateCurrentMsg,continueMsg,autoAdvance,restoreMessageVersion,stopGeneration});


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

window.addEventListener('load',async()=>{
    applyStoryTypography();
    restoreLegacyFont();
    try{await MimaStandalone.init()}catch(e){console.error('Standalone（独立版）本地数据库启动失败',e);alert('咪嘛馆本地数据库启动失败：'+e.message);return}
    try{fontRecords=await MimaFontManager.init()}catch(e){console.warn('本地字体库启动失败',e)}
    qs('story-input').addEventListener('input',autoResizeInput);
    bindStoryStreamScroll();
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
    try{await loadAll()}catch(e){console.error('咪嘛馆资料库读取失败，未将其当作空库',e);alert('咪嘛馆资料读取失败：'+e.message+'\n原数据未清空，请不要创建新存档覆盖。');return;}
    if(!MimaStandalone.getApiConfig().apiBase) setTimeout(maybeOpenInitialApiSettings,250);
});
