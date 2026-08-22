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
let activeRequest = null;
let isGenerating = false;
let settingsTab = 'roles';
let editorState = null;
let pendingPersonaType = 'character';
let fontRecords = [];
let memoryGenerating = false;

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

async function fetchStory(endpoint, method='GET', body=null, useAbort=false, progress=null) {
    if (useAbort) {
        if (activeRequest) activeRequest.abort();
        activeRequest = new AbortController();
    }
    try {
        return await MimaStandalone.handle(endpoint, method, body, useAbort ? activeRequest.signal : null, progress);
    } catch (err) {
        if (err?.name === 'AbortError') return { success:false, aborted:true, code:'E_ABORTED', msg:'操作已停止' };
        const info=describeApiError(err);
        return { success:false, msg:info.message, code:info.code, status:info.status, hint:info.hint, details:info.details };
    }
}

function openDrawer(){qs('session-drawer').classList.add('open');qs('drawer-scrim').classList.remove('hidden')}
function closeDrawer(){qs('session-drawer').classList.remove('open');qs('drawer-scrim').classList.add('hidden')}
function openSettings(tab='roles'){settingsTab=tab;qs('settings-modal').classList.remove('hidden');renderSettings()}
function closeSettings(){qs('settings-modal').classList.add('hidden')}
function switchSettingsTab(tab){settingsTab=tab;renderSettings()}
function syncAppearancePreviewMode(on){
    const panel=qs('settings-modal')?.querySelector('.settings-panel');
    if(!panel)return;
    let stage=qs('appearance-preview-stage');
    if(on){
        panel.classList.add('appearance-preview-mode');
        if(!stage){
            stage=document.createElement('section');
            stage.id='appearance-preview-stage';
            stage.className='appearance-preview-stage';
            panel.insertBefore(stage,qs('settings-content'));
        }
        renderAppearancePreview();
    }else{
        panel.classList.remove('appearance-preview-mode');
        if(stage)stage.remove();
    }
}
function renderAppearancePreview(){
    const stage=qs('appearance-preview-stage');if(!stage)return;
    const safeOn=currentSessionData?.renderMode==='safe_html';
    stage.innerHTML=`<div class="appearance-preview-head"><div><span class="eyebrow">LIVE PREVIEW（实时预览）</span><strong>正文排版实验室</strong></div><div class="appearance-preview-badges"><span class="tag">不会写入剧情</span><span class="tag ${safeOn?'preview-safe-on':'preview-safe-off'}">Safe HTML ${safeOn?'ON':'OFF'}</span></div></div>
    <div class="appearance-preview-scroll"><div class="typography-preview-page">
      <article class="message assistant-msg typography-preview-message"><div class="msg-header">Character（示范角色） · 默认示范文本</div><div class="msg-content tavern-story-content${safeOn?' safe-html-content':''}">
        <div class="story-prose story-paragraph">雨声落在窗沿上，像有人用指尖轻轻敲着玻璃。她把书页压住，抬眼望向你："还没有睡吗？"</div>
        <div class="story-prose story-paragraph">这是第二段示范文字。请拖动下面的字号、行间距、段间距、字间距与首行缩进；这里会立刻跟着改变，用来观察长篇小说阅读时最真实的密度和呼吸感。</div>
        <div class="story-prose story-paragraph">第三段故意写得稍长一些：当屏幕宽度变窄时，你可以更直观地判断字距是否太松、行距是否拥挤，以及二 em 首行缩进是不是正好符合你习惯的中文小说版式。</div>
      </div></article>
      ${safeOn?`<article class="message assistant-msg typography-preview-safe-demo"><div class="msg-header">Safe HTML（兼容测试）</div><div class="msg-content tavern-story-content safe-html-content"><p class="typography-preview-html-prose">这是一段被 &lt;p&gt; 包住的 Safe HTML 正文。字体、字号、行高与字间距会继承当前正文排版。</p><system class="typography-preview-statusbar"><strong>STATUS BAR</strong><span>自带 CSS 的状态栏仍保持自己的字号与布局，不会被首行缩进或段间距挤坏。</span><div class="typography-preview-status-row"><span>心情　平静</span><span>时间　23:48</span></div></system></div></article>`:`<div class="typography-preview-safe-placeholder">开启下方「允许 Safe HTML 状态栏渲染」后，这里会出现 HTML 正文 + 状态栏兼容性示范。</div>`}
    </div></div>`;
}
function closeEditor(){qs('editor-modal').classList.add('hidden');editorState=null}
function openNewSessionModal(){qs('new-session-modal').classList.remove('hidden');setTimeout(()=>qs('new-session-title').focus(),50)}
function closeNewSessionModal(){qs('new-session-modal').classList.add('hidden')}
function toggleDirector(){qs('director-wrap').classList.toggle('collapsed')}

async function loadAll() {
    const [s,m,p,w,c] = await Promise.all([fetchStory('/sessions'),fetchStory('/masks'),fetchStory('/presets'),fetchStory('/worldbooks'),fetchStory('/css-presets')]);
    sessions=s.data||[]; masks=m.data||[]; presets=p.data||[]; worldbooks=w.data||[]; cssPresets=c.data||[];
    renderSessions();
    if (currentSessionId) {
        const exists=sessions.some(x=>x.id===currentSessionId);
        if (exists) await openSession(currentSessionId,false);
        else { currentSessionId=null; currentSessionData=null; refreshHeader(); refreshChatBox(); }
    }
    if (!currentSessionId && sessions.length) await openSession(sessions[0].id,false);
    if (!qs('settings-modal').classList.contains('hidden')) renderSettings();
}

function renderSessions() {
    const box=qs('session-list'); box.innerHTML='';
    if(!sessions.length){box.innerHTML='<div class="row-sub">还没有剧情。新建一个独立宇宙吧。</div>';return}
    sessions.forEach(s=>{
        const div=document.createElement('button'); div.className=`session-item ${s.id===currentSessionId?'active':''}`;
        div.innerHTML=`<div class="session-name">${escapeHtml(s.title)}</div><div class="session-meta">${escapeHtml(canonLabel(s.canonLevel||'alternate'))} · ${s.messageCount||0} 条 · 📚 ${(s.worldbookIds||[]).length}</div>`;
        div.onclick=()=>openSession(s.id,true); box.appendChild(div);
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
    const res=await fetchStory(`/sessions/${id}`); if(!res.success)return toast(res.msg||'打开失败');
    currentSessionId=id; currentSessionData=res.data; if(close)closeDrawer(); refreshHeader(); refreshChatBox(); applyCustomCss(); renderSessions(); if(!qs('settings-modal').classList.contains('hidden'))renderSettings();
}
async function patchCurrent(patch, quiet=false){
    if(!currentSessionId)return null;
    const res=await fetchStory(`/sessions/${currentSessionId}`,'PATCH',patch);
    if(res.success){currentSessionData=res.data;await refreshSessionSummaryList();refreshHeader();applyCustomCss();if(!quiet)renderSettings();return res.data}
    toast(res.msg||'保存失败');return null;
}
async function refreshSessionSummaryList(){const s=await fetchStory('/sessions');sessions=s.data||sessions;renderSessions()}
async function deleteCurrentSession(){if(!currentSessionId||!confirm('确定删除这个剧情 Session（剧情会话）？此操作不可撤销。'))return;await fetchStory(`/sessions/${currentSessionId}`,'DELETE');currentSessionId=null;currentSessionData=null;closeSettings();await loadAll();}
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
    else ribbon.classList.add('hidden');
}

function renderSettings(){
    qsa('.settings-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===settingsTab));
    syncAppearancePreviewMode(settingsTab==='appearance');
    const box=qs('settings-content');
    if(!currentSessionData){box.innerHTML='<div class="empty-state"><p>请先创建或打开一个剧情。</p></div>';return}
    if(settingsTab==='roles')renderRolesTab(box);
    else if(settingsTab==='worldbook')renderWorldbookTab(box);
    else if(settingsTab==='presets')renderPresetsTab(box);
    else if(settingsTab==='context')renderContextTab(box);
    else if(settingsTab==='memory')renderMemoryTab(box);
    else if(settingsTab==='appearance')renderAppearanceTab(box);
    else if(settingsTab==='api')renderApiTab(box);
    else if(settingsTab==='prompt')renderPromptTab(box);
    else if(settingsTab==='data')renderDataTab(box);
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
      <section class="settings-section"><h3>角色卡库</h3><div class="toolbar"><button class="ghost-btn" onclick="openMaskEditor('character')">＋ 新建角色卡</button><button class="ghost-btn" onclick="choosePersonaImport('character')">⇧ 导入 TXT（文本） / JSON（数据）</button></div><div id="char-card-grid" class="card-grid"></div></section>
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
    const text=await file.text();
    let data={};
    if(file.name.toLowerCase().endsWith('.json')){
        try{
            const raw=JSON.parse(text), d=raw.data||raw;
            const desc=d.description||'', personality=d.personality||d.persona||d.content||'';
            data={type:pendingPersonaType,name:d.name||file.name.replace(/\.json$/i,''),description:desc,content:personality,scenario:d.scenario||'',firstMessage:d.first_mes||d.firstMessage||'',exampleDialogue:d.mes_example||d.exampleDialogue||'',creatorNotes:d.creator_notes||d.creatorNotes||'',avatar:d.avatar||'',tags:d.tags||[],aliases:d.aliases||[],source:'import_json'};
            if(pendingPersonaType==='user') data.content=d.content||d.persona||data.content;
        }catch(_){return toast('JSON 角色卡解析失败猫')}
    }else{
        data={type:pendingPersonaType,name:file.name.replace(/\.txt$/i,''),content:text,source:'import_txt'};
    }
    const res=await fetchStory('/masks','POST',data);
    if(res.success){await loadAll();openSettings('roles');toast(`已导入 ${res.data.name}`)}else toast(res.msg||'导入失败');
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
<div><label class="form-label">Depth（深度，0=System（系统））</label><input data-f="depth" class="field" type="number" min="0" max="100" value="${Number(e.depth||0)}"></div><div><label class="form-label">注入位置</label><select data-f="position" class="field"><option value="front" ${e.position==='front'?'selected':''}>前</option><option value="middle" ${e.position==='middle'?'selected':''}>中</option><option value="back" ${e.position==='back'?'selected':''}>后</option></select></div><div><label class="form-label">Priority（优先级，小值优先）</label><input data-f="priority" class="field" type="number" value="${Number(e.priority??50)}"></div><div><label class="form-label">扫描最近消息数</label><input data-f="scanDepth" class="field" type="number" min="1" max="100" value="${Number(e.scanDepth||12)}"></div><div><label class="form-label">条目最大字符（0=不限）</label><input data-f="maxChars" class="field" type="number" min="0" value="${Number(e.maxChars||0)}"></div>
<div class="form-full"><label class="check-row"><input data-f="enabled" type="checkbox" ${e.enabled!==false?'checked':''}> 启用</label><label class="check-row"><input data-f="alwaysActive" type="checkbox" ${e.alwaysActive?'checked':''}> Always Active（始终激活）</label><label class="check-row"><input data-f="caseSensitive" type="checkbox" ${e.caseSensitive?'checked':''}> 大小写敏感</label><label class="check-row"><input data-f="useRegex" type="checkbox" ${e.useRegex?'checked':''}> Regex（正则）关键词</label></div><div class="form-full"><label class="form-label">注入内容</label><textarea data-f="content" class="field textarea tall">${escapeHtml(e.content||'')}</textarea></div><div class="form-full"><button class="danger-btn" onclick="removeWorldbookEntry(${i})">删除此条目</button></div></div>`;root.appendChild(d)})}
function captureWorldbookDraft(){if(!editorState||editorState.type!=='worldbook')return;const w=editorState.draft;w.name=qs('wb-name')?.value||w.name;w.description=qs('wb-desc')?.value||'';w.tags=csv(qs('wb-tags')?.value||'');w.entries=qsa('[data-entry-index]',qs('wb-entry-list')).map(block=>{const get=f=>block.querySelector(`[data-f="${f}"]`);return {id:w.entries[Number(block.dataset.entryIndex)]?.id,name:get('name').value,keywords:csv(get('keywords').value),secondaryKeywords:csv(get('secondaryKeywords').value),matchMode:get('matchMode').value,depth:Number(get('depth').value||0),position:get('position').value,priority:Number(get('priority').value||50),scanDepth:Number(get('scanDepth').value||12),maxChars:Number(get('maxChars').value||0),enabled:get('enabled').checked,alwaysActive:get('alwaysActive').checked,caseSensitive:get('caseSensitive').checked,useRegex:get('useRegex').checked,content:get('content').value}})}
function addWorldbookEntry(){captureWorldbookDraft();editorState.draft.entries.push(defaultEntry());renderWorldbookEditorBody()}
function removeWorldbookEntry(i){captureWorldbookDraft();editorState.draft.entries.splice(i,1);renderWorldbookEditorBody()}
async function saveWorldbookEditor(){captureWorldbookDraft();const res=await fetchStory(editorState.id?`/worldbooks/${editorState.id}`:'/worldbooks',editorState.id?'PATCH':'POST',editorState.draft);if(res.success){closeEditor();await loadAll();openSettings('worldbook')}else toast(res.msg||'保存失败')}
async function deleteWorldbook(id){if(!confirm('删除整个世界书？'))return;await fetchStory(`/worldbooks/${id}`,'DELETE');closeEditor();await loadAll();openSettings('worldbook')}
function chooseWorldbookImport(){qs('worldbook-file-input').value='';qs('worldbook-file-input').click()}
function normalizeImportedWorldbook(raw,name){const src=raw.data||raw;let rawEntries=src.entries||[];if(!Array.isArray(rawEntries)&&rawEntries&&typeof rawEntries==='object')rawEntries=Object.values(rawEntries);const entries=arr(rawEntries).map((e,i)=>({name:e.name||e.comment||`条目 ${i+1}`,content:e.content||'',keywords:e.keywords||e.key||e.keys||[],secondaryKeywords:e.secondaryKeywords||e.keysecondary||[],enabled:e.enabled!==false&&e.disable!==true,alwaysActive:!!(e.alwaysActive||e.constant),matchMode:e.matchMode||'any',caseSensitive:!!e.caseSensitive,useRegex:!!e.useRegex,priority:Number(e.priority??e.order??50),scanDepth:Number(e.scanDepth??12),depth:Number(e.depth??0),position:['front','middle','back'].includes(e.position)?e.position:'middle',maxChars:Number(e.maxChars||0)}));return {name:src.name||name||'导入世界书',description:src.description||'',tags:src.tags||[],entries}}
async function importWorldbookFile(file){if(!file)return;try{const raw=JSON.parse(await file.text());const body=normalizeImportedWorldbook(raw,file.name.replace(/\.json$/i,''));const res=await fetchStory('/worldbooks','POST',body);if(!res.success)throw new Error(res.msg);await loadAll();openSettings('worldbook');toast(`已导入世界书 ${res.data.name}`)}catch(e){toast(`世界书导入失败：${e.message}`)}}
function exportWorldbook(id){const w=worldbooks.find(x=>x.id===id);if(w)downloadJson(`${w.name}.mimamao-worldbook.json`,w)}

function renderPresetsTab(box){const active=new Set(currentSessionData.presetIds||[]);box.innerHTML=`<section class="settings-section"><h3>🧩 酒馆预设</h3><p class="helper">可同时挂多个。Priority（优先级）越小越先进入 Prompt（提示词）。</p><div class="toolbar"><button class="primary-btn" onclick="openPresetEditor()">＋ 新建预设</button></div><div id="preset-list"></div></section>`;const root=qs('preset-list');if(!presets.length){root.innerHTML='<div class="row-sub">暂无预设。</div>';return}presets.slice().sort((a,b)=>(a.priority||50)-(b.priority||50)).forEach(p=>{const r=document.createElement('div');r.className='preset-row';r.innerHTML=`<input type="checkbox" ${active.has(p.id)?'checked':''} onchange="togglePreset('${p.id}',this.checked)"><div class="row-main"><div class="row-title">${escapeHtml(p.name)}</div><div class="row-sub">${escapeHtml(presetTypeLabel(p.type||'style'))} · priority（优先级） ${p.priority||50}</div></div><button class="ghost-btn" onclick="openPresetEditor('${p.id}')">编辑</button>`;root.appendChild(r)})}
async function togglePreset(id,on){const set=new Set(currentSessionData.presetIds||[]);on?set.add(id):set.delete(id);await patchCurrent({presetIds:[...set]},true);renderSettings()}
function openPresetEditor(id=null){const p=id?presets.find(x=>x.id===id):{name:'',type:'style',description:'',content:'',priority:50};editorState={type:'preset',id};qs('editor-title').textContent=id?`编辑预设 · ${p.name}`:'新建预设';qs('editor-eyebrow').textContent='PRESET（预设）';qs('editor-body').innerHTML=`<div class="form-grid"><div><label class="form-label">名称</label><input id="pre-name" class="field" value="${escapeHtml(p.name||'')}"></div><div><label class="form-label">类型</label><select id="pre-type" class="field">${['style','format','behavior','model'].map(x=>`<option value="${x}" ${p.type===x?'selected':''}>${presetTypeLabel(x)}</option>`).join('')}</select></div><div><label class="form-label">Priority（优先级）</label><input id="pre-priority" type="number" class="field" value="${Number(p.priority||50)}"></div><div class="form-full"><label class="form-label">说明</label><input id="pre-desc" class="field" value="${escapeHtml(p.description||'')}"></div><div class="form-full"><label class="form-label">内容</label><textarea id="pre-content" class="field textarea tall">${escapeHtml(p.content||'')}</textarea></div></div>`;setupEditorButtons(id?()=>deletePreset(id):null,savePresetEditor);qs('editor-modal').classList.remove('hidden')}
async function savePresetEditor(){const body={name:qs('pre-name').value||'未命名预设',type:qs('pre-type').value,priority:Number(qs('pre-priority').value||50),description:qs('pre-desc').value,content:qs('pre-content').value};const res=await fetchStory(editorState.id?`/presets/${editorState.id}`:'/presets',editorState.id?'PATCH':'POST',body);if(res.success){closeEditor();await loadAll();openSettings('presets')}else toast(res.msg||'保存失败')}
async function deletePreset(id){if(!confirm('删除这个预设？'))return;await fetchStory(`/presets/${id}`,'DELETE');closeEditor();await loadAll();openSettings('presets')}

function renderContextTab(box){const ps=currentSessionData.promptSettings||{};box.innerHTML=`<section class="settings-section"><h3>🪐 Session（剧情会话）</h3><div class="form-grid"><div class="form-full"><label class="form-label">标题</label><input id="ctx-title" class="field" value="${escapeHtml(currentSessionData.title||'')}"></div><div><label class="form-label">Canon Level（设定层级）</label><select id="ctx-canon" class="field">${['temporary','alternate','soft','core'].map(x=>`<option value="${x}" ${currentSessionData.canonLevel===x?'selected':''}>${canonLabel(x)}</option>`).join('')}</select></div><div><label class="form-label">Temperature（温度）</label><input id="ctx-temp" class="field" type="number" min="0.1" max="2" step="0.05" value="${getTemp()}"></div></div><p class="helper">Standalone（独立版）中所有 Session（剧情会话）都是浏览器本地独立宇宙，不会写入任何 MIMAMAO / Telegram 世界。</p></section>
<section class="settings-section"><h3>🧠 长剧情 Context（上下文）</h3><div class="form-grid"><div><label class="form-label">最近原文消息数</label><input id="ctx-recent" class="field" type="number" min="6" max="200" value="${Number(ps.recentMessageLimit||34)}"></div><div><label class="form-label">世界书总预算（字符）</label><input id="ctx-wbbudget" class="field" type="number" min="1000" max="160000" value="${Number(ps.worldbookBudgetChars||16000)}"></div><div class="form-full"><label class="check-row"><input id="ctx-summary" type="checkbox" ${ps.summaryEnabled!==false?'checked':''}> 自动 Rolling Summary（滚动摘要）</label><label class="check-row"><input id="ctx-pinned-on" type="checkbox" ${ps.pinnedFactsEnabled!==false?'checked':''}> 注入 Pinned Facts（固定事实）</label></div><div class="form-full"><label class="form-label">📌 Pinned Facts（固定事实，一行一条）</label><textarea id="ctx-pinned" class="field textarea">${escapeHtml(arr(currentSessionData.pinnedFacts).join('\n'))}</textarea></div><div class="form-full"><label class="form-label">User（用户）备注</label><textarea id="ctx-usernotes" class="field textarea">${escapeHtml(currentSessionData.userNotes||'')}</textarea></div><div class="form-full"><label class="form-label">AI（人工智能）备注</label><textarea id="ctx-ainotes" class="field textarea">${escapeHtml(currentSessionData.aiNotes||'')}</textarea></div></div></section>
<section class="settings-section"><h3>💾 本地档案</h3><p class="helper">剧情、角色卡、世界书、预设保存在当前浏览器 IndexedDB（本地数据库）。建议偶尔导出剧情资料备份；字体与 API Key（接口密钥）不会被打进备份。</p><div class="toolbar"><button class="ghost-btn" onclick="exportCurrentSession()">⇩ 导出当前剧情</button><button class="ghost-btn" onclick="exportWholeLibrary()">⇩ 完整剧情资料备份</button><button class="ghost-btn" onclick="chooseLibraryImport()">⇧ 导入剧情资料备份</button><button class="danger-btn" onclick="deleteCurrentSession()">删除当前剧情</button></div></section>`}
async function saveContextSettings(){const temp=Math.max(.1,Math.min(2,Number(qs('ctx-temp').value||.85)));localStorage.setItem(TEMP_KEY,String(temp));MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),temperature:temp});await patchCurrent({title:qs('ctx-title').value||'未命名咪嘛宇宙',canonLevel:qs('ctx-canon').value,pinnedFacts:lines(qs('ctx-pinned').value),userNotes:qs('ctx-usernotes').value,aiNotes:qs('ctx-ainotes').value,enabledPersonaSources:{sandalphonPersona:false,userPersona:false,telegramContext:false,longTermMemory:false,sandalphonState:false},promptSettings:{...(currentSessionData.promptSettings||{}),recentMessageLimit:Number(qs('ctx-recent').value||34),worldbookBudgetChars:Number(qs('ctx-wbbudget').value||16000),summaryEnabled:qs('ctx-summary').checked,pinnedFactsEnabled:qs('ctx-pinned-on').checked}});toast('Context（上下文）已保存')}


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
    const factCards=facts.length?facts.map(f=>`<div class="memory-card"><div class="memory-card-head"><div><strong>第 ${Number(f.startRound||0)}–${Number(f.endRound||0)} 轮</strong><div class="entry-meta">${escapeHtml(memoryDateLabel(f.updatedAt||f.createdAt))} · 约 ${Number(f.targetChars||0)||'—'} 字 · T=${Number(f.temperature??.35).toFixed(2)}</div></div><button class="tool-mini" onclick="deleteFactMemory('${escapeHtml(f.id)}')">删除</button></div><div class="memory-text">${escapeHtml(f.content||'')}</div></div>`).join(''):'<div class="memory-empty">还没有事实记忆。可以按 10 / 25 轮一段开始总结猫。</div>';
    box.innerHTML=`
    <section class="settings-section memory-overview"><h3>🗃️ 手动记忆总结</h3><p class="helper">调用当前 API / Model（模型）整理这个 Session（剧情会话）的长期记忆。这里的“1 轮”= 一次 User 发言 + 随后的角色回复；角色开场白会作为第 1 轮之前的前置信息纳入摘要，但不会单独占一轮。</p><div class="memory-stats"><div class="stat-card"><div class="stat-num">${rounds}</div><div class="stat-label">当前剧情轮数</div></div><div class="stat-card"><div class="stat-num">${facts.length}</div><div class="stat-label">事实记忆片段</div></div><div class="stat-card"><div class="stat-num">${core.content?'✓':'—'}</div><div class="stat-label">核心记忆</div></div></div>
    <div class="form-grid memory-global-grid"><div><label class="form-label">Summary Temperature（总结温度）</label><input id="memory-temp" class="field" type="number" min="0.1" max="2" step="0.05" value="${temp.toFixed(2)}"><div class="row-sub">只影响手动记忆总结，不会改你正常跑剧情的温度；若 API 页关闭“发送 Temperature”，则接口不会收到温度参数。</div></div><div><label class="form-label">后续剧情注入</label><label class="check-row"><input id="memory-inject-core" type="checkbox" ${mem.settings.injectCore?'checked':''}> 注入核心记忆</label><label class="check-row"><input id="memory-inject-facts" type="checkbox" ${mem.settings.injectFacts?'checked':''}> 注入事实记忆</label></div><div><label class="form-label">最多注入最近几段事实记忆</label><input id="memory-inject-limit" class="field" type="number" min="1" max="100" value="${Math.max(1,Math.min(100,Number(mem.settings.factInjectionLimit||12)))}"></div></div>
    <div class="toolbar"><button class="ghost-btn" onclick="saveMemorySettings()" ${memoryGenerating?'disabled':''}>保存记忆设置</button></div><div id="memory-progress" class="memory-progress ${memoryGenerating?'':'hidden'}"><div class="memory-progress-head"><span id="memory-progress-label">正在调用 LLM（大语言模型）…</span><span id="memory-progress-percent">0%</span></div><div class="memory-progress-track"><div id="memory-progress-bar" class="memory-progress-bar"></div></div><div id="memory-progress-detail" class="row-sub"></div><button class="tool-mini" onclick="stopMemorySummary()">停止总结</button></div></section>

    <section class="settings-section"><h3>💎 核心记忆</h3><p class="helper">不是流水账。它会从第一轮开始提炼真正影响长期剧情的东西，尤其优先保存关系转变、承诺/约定、重要选择及后果、持续状态变化和未解决事项。也可以直接用已经生成的事实记忆再压缩一次。</p><div class="form-grid"><div><label class="form-label">总结来源</label><select id="core-memory-source" class="field"><option value="context" ${core.source!=='facts'?'selected':''}>从第一轮剧情原文开始总结</option><option value="facts" ${core.source==='facts'?'selected':''}>根据事实记忆总结核心记忆</option></select></div><div><label class="form-label">目标字数</label><input id="core-memory-target" class="field" type="number" min="100" max="12000" step="100" value="${Number(core.targetChars||1000)}"><div class="memory-quick-targets"><button class="tool-mini" onclick="setCoreMemoryTarget(500)">500</button><button class="tool-mini" onclick="setCoreMemoryTarget(1000)">1000</button><button class="tool-mini" onclick="setCoreMemoryTarget(2000)">2000</button></div></div><div class="form-full"><label class="form-label">核心记忆正文 · ${escapeHtml(memorySourceLabel(core.source))} · ${escapeHtml(memoryDateLabel(core.updatedAt))}</label><textarea id="core-memory-content" class="field textarea tall" placeholder="生成后会显示在这里，也可以手工修订。">${escapeHtml(core.content||'')}</textarea></div></div><div class="toolbar"><button class="primary-btn memory-action" onclick="generateCoreMemory()" ${memoryGenerating?'disabled':''}>✨ 生成 / 重做核心记忆</button><button class="ghost-btn" onclick="saveCoreMemoryEdit()" ${memoryGenerating?'disabled':''}>保存手工修改</button>${core.content?'<button class="danger-btn" onclick="clearCoreMemory()" '+(memoryGenerating?'disabled':'')+'>清空核心记忆</button>':''}</div></section>

    <section class="settings-section"><h3>🧾 事实记忆</h3><p class="helper">按固定轮数把剧情浓缩成小段事实档案，只写“发生了什么”，不做文学赏析、不乱补设定。最近 X 轮适合日常增量补记；从头到尾适合重建整本事实档案。</p><div class="form-grid"><div><label class="form-label">每 X 轮总结一段</label><input id="fact-memory-chunk" class="field" type="number" min="1" max="200" value="10"></div><div><label class="form-label">每段目标字数</label><input id="fact-memory-target" class="field" type="number" min="80" max="4000" step="20" value="360"></div><div><label class="form-label">总结范围</label><select id="fact-memory-scope" class="field" onchange="syncFactMemoryScope()"><option value="recent" selected>只总结最近 X 轮</option><option value="all">从头到尾全部总结</option></select></div><div id="fact-memory-recent-wrap"><label class="form-label">最近多少轮</label><input id="fact-memory-recent" class="field" type="number" min="1" max="100000" value="25"></div><div class="form-full" id="fact-memory-replace-wrap"><label class="check-row"><input id="fact-memory-replace" type="checkbox"> 从头到尾完成后，用新事实记忆整体顶掉旧事实记忆</label><div class="row-sub">只在“从头到尾”模式生效。生成过程中如果 API 失败，旧记忆不会被提前删除。</div></div></div><div class="toolbar"><button class="primary-btn memory-action" onclick="generateFactMemories()" ${memoryGenerating?'disabled':''}>🧠 开始事实总结</button>${facts.length?'<button class="danger-btn" onclick="clearAllFactMemories()" '+(memoryGenerating?'disabled':'')+'>清空全部事实记忆</button>':''}</div><div class="memory-list">${factCards}</div></section>`;
    syncFactMemoryScope();
}
function setCoreMemoryTarget(n){const el=qs('core-memory-target');if(el)el.value=String(n)}
function syncFactMemoryScope(){const scope=qs('fact-memory-scope')?.value||'recent',recent=qs('fact-memory-recent-wrap'),replace=qs('fact-memory-replace-wrap');if(recent)recent.style.display=scope==='recent'?'block':'none';if(replace)replace.style.display=scope==='all'?'block':'none'}
function getMemoryTemperature(){const n=Number(qs('memory-temp')?.value??memoryStore().settings.summaryTemperature??.35);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):.35}
function handleMemoryProgress(payload={}){const root=qs('memory-progress');if(!root)return;root.classList.remove('hidden');const n=Math.max(2,Math.min(100,Number(payload.percent)||2));const bar=qs('memory-progress-bar'),pct=qs('memory-progress-percent'),detail=qs('memory-progress-detail'),label=qs('memory-progress-label');if(bar)bar.style.width=`${n}%`;if(pct)pct.textContent=`${Math.round(n)}%`;if(detail&&payload.detail)detail.textContent=payload.detail;if(label)label.textContent=payload.phase==='done'?'记忆总结完成':'正在调用 LLM（大语言模型）…'}
function stopMemorySummary(){if(activeRequest)activeRequest.abort();handleMemoryProgress({percent:100,detail:'正在停止本次总结…'});toast('已发出停止请求；旧记忆不会被提前覆盖。')}
async function saveMemorySettings(){const res=await fetchStory(`/sessions/${currentSessionId}/memory`,'PATCH',{settings:{injectCore:!!qs('memory-inject-core')?.checked,injectFacts:!!qs('memory-inject-facts')?.checked,factInjectionLimit:Number(qs('memory-inject-limit')?.value||12),summaryTemperature:getMemoryTemperature()}});if(res.success){currentSessionData=res.data;toast('记忆设置已保存');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'保存失败')}
async function saveCoreMemoryEdit(){const content=qs('core-memory-content')?.value||'',targetChars=Number(qs('core-memory-target')?.value||1000),temperature=getMemoryTemperature();const res=await fetchStory(`/sessions/${currentSessionId}/memory`,'PATCH',{core:{content,source:'manual',targetChars,temperature},settings:{summaryTemperature:temperature}});if(res.success){currentSessionData=res.data;toast('核心记忆手工修改已保存');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'保存失败')}
async function generateCoreMemory(){
    if(memoryGenerating||isGenerating)return toast('当前还有生成任务在进行。');
    const source=qs('core-memory-source')?.value||'context',targetChars=Number(qs('core-memory-target')?.value||1000),temperature=getMemoryTemperature();
    if(source==='facts'&&!memoryStore().facts.length)return toast('还没有事实记忆猫，请先生成事实记忆。');
    memoryGenerating=true;renderMemoryTab(qs('settings-content'));handleMemoryProgress({percent:4,detail:'正在准备核心记忆材料…'});
    const res=await fetchStory(`/sessions/${currentSessionId}/memory/core`,'POST',{source,targetChars,temperature},true,handleMemoryProgress);memoryGenerating=false;
    if(res.aborted){toast('核心记忆总结已停止');await openSession(currentSessionId,false);openSettings('memory');return}
    if(res.success){currentSessionData=res.data;await refreshSessionSummaryList();toast('核心记忆已生成完成 ✨');renderMemoryTab(qs('settings-content'))}else{toast(`核心记忆失败：${res.msg||res.code||'未知错误'}`);renderMemoryTab(qs('settings-content'))}
}
async function generateFactMemories(){
    if(memoryGenerating||isGenerating)return toast('当前还有生成任务在进行。');
    const scope=qs('fact-memory-scope')?.value||'recent',chunkRounds=Number(qs('fact-memory-chunk')?.value||10),recentRounds=Number(qs('fact-memory-recent')?.value||25),targetChars=Number(qs('fact-memory-target')?.value||360),temperature=getMemoryTemperature(),replaceExisting=scope==='all'&&!!qs('fact-memory-replace')?.checked;
    if(!storyRoundCount())return toast('当前还没有可以总结的剧情轮次猫。');
    if(replaceExisting&&!confirm('这次“从头到尾”总结全部成功后，会用新事实记忆整体替换旧事实记忆。继续吗？'))return;
    memoryGenerating=true;renderMemoryTab(qs('settings-content'));handleMemoryProgress({percent:4,detail:'正在切分事实记忆轮次…'});
    const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts`,'POST',{scope,chunkRounds,recentRounds,targetChars,temperature,replaceExisting},true,handleMemoryProgress);memoryGenerating=false;
    if(res.aborted){toast('事实记忆总结已停止，旧记忆保持不变');await openSession(currentSessionId,false);openSettings('memory');return}
    if(res.success){currentSessionData=res.data;await refreshSessionSummaryList();toast('事实记忆总结完成 🧾');renderMemoryTab(qs('settings-content'))}else{toast(`事实记忆失败：${res.msg||res.code||'未知错误'}`);renderMemoryTab(qs('settings-content'))}
}
async function clearCoreMemory(){if(!confirm('清空当前核心记忆？剧情原文不会受影响。'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/core`,'DELETE');if(res.success){currentSessionData=res.data;toast('核心记忆已清空');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'清空失败')}
async function deleteFactMemory(id){if(!confirm('删除这一段事实记忆？'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts/${id}`,'DELETE');if(res.success){currentSessionData=res.data;renderMemoryTab(qs('settings-content'))}else toast(res.msg||'删除失败')}
async function clearAllFactMemories(){if(!confirm('清空全部事实记忆？核心记忆和剧情原文不会被删除。'))return;const res=await fetchStory(`/sessions/${currentSessionId}/memory/facts`,'DELETE');if(res.success){currentSessionData=res.data;toast('事实记忆已清空');renderMemoryTab(qs('settings-content'))}else toast(res.msg||'清空失败')}
async function exportWholeLibrary(){const data=await MimaStandalone.exportLibrary();downloadJson('mimamao-tavern-full-backup.json',{format:'mimamao-tavern-standalone',version:1,exportedAt:new Date().toISOString(),data});}
function chooseLibraryImport(){qs('library-file-input').value='';qs('library-file-input').click()}
async function importWholeLibrary(file){if(!file)return;if(!confirm('导入完整酒馆备份会覆盖当前浏览器里的剧情/角色卡/世界书/预设。继续吗？'))return;try{const raw=JSON.parse(await file.text());await MimaStandalone.importLibrary(raw);currentSessionId=null;currentSessionData=null;await loadAll();toast('完整酒馆备份已导入')}catch(e){toast(`备份导入失败：${e.message}`)}}


const FULL_SETTINGS_FORMAT = 'mimamao-tavern-full-settings';
const FULL_SETTINGS_VERSION = 2;
const FULL_SETTINGS_KEYS = [TEMP_KEY, LEGACY_FONT_URL_KEY, LEGACY_FONT_FAMILY_KEY, STORY_TYPO_KEY, 'mimamao_tavern_ui_font', 'mimamao_tavern_story_font'];

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
    const src=raw?.data||raw||{};
    if(raw?.format&&raw.format!==FULL_SETTINGS_FORMAT) throw new Error('这不是咪嘛馆完整设置备份文件');
    if(!src.library) throw new Error('备份里缺少剧情资料 library（资料库）');
    await MimaStandalone.importLibrary(src.library);
    if(src.api&&typeof src.api==='object'){
        const old=MimaStandalone.getApiConfig();
        const incoming={...src.api};
        if(!incoming.apiKey) incoming.apiKey=old.apiKey||'';
        MimaStandalone.saveApiConfig({...old,...incoming});
    }
    restorePortableLocalPrefs(src.localPrefs||{});
    applyStoryTypography();
    if(Array.isArray(src.fonts)&&src.fonts.length&&MimaFontManager.importPortable) await MimaFontManager.importPortable(src.fonts,{replace:false});
    if(src.selectedFonts?.ui!==undefined)MimaFontManager.setSelected('ui',src.selectedFonts.ui||'');
    if(src.selectedFonts?.story!==undefined)MimaFontManager.setSelected('story',src.selectedFonts.story||'');
    restoreLegacyFont();
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
async function renderDataTab(box){
    let snap=null;try{snap=await MimaLocalStore.loadSettingsSnapshot()}catch(_){ }
    const cfg=MimaStandalone.getApiConfig();
    box.innerHTML=`<section class="settings-section"><h3>💾 Data Backup（数据备份）</h3><p class="helper">这里备份的不只是剧情，还包括角色卡、世界书、预设、CSS Preset（CSS 预设）、API（接口）参数、温度/流式设置、字体选择；可选把本地字体文件也一起装进备份。普通“刷新 / 强制刷新”不会删除这些数据，但 Safari 的“清除历史记录与网站数据”或删除网站数据会清掉 IndexedDB（本地数据库）和 localStorage（本地存储），所以真正保险的是导出 JSON（数据文件）到“文件”App。</p>
    <div class="data-backup-card"><div class="row-title">本机设置快照</div><div class="row-sub">${snap?`最近保存：${escapeHtml(snap.savedAt||snap.exportedAt||'已保存')}`:'尚未保存本机快照'}</div><div class="toolbar"><button class="primary-btn" onclick="saveFullSettingsSnapshot()">保存咪嘛馆设置数据</button><button class="ghost-btn" onclick="restoreSavedSettingsSnapshot()">恢复本机快照</button></div></div>
    <div class="data-backup-card"><div class="row-title">可迁移完整备份</div><div class="row-sub">导出的文件可以在清缓存、换浏览器、换设备或重新部署后再导入。</div><label class="check-row"><input id="backup-fonts" type="checkbox" checked> 把本地字体文件也加入备份（文件可能变大）</label><label class="check-row"><input id="backup-api-key" type="checkbox"> 把 API Key（接口密钥）加入导出/快照 <strong>（敏感）</strong></label><div class="toolbar"><button class="primary-btn" onclick="exportFullSettingsBackup()">⇩ 导出完整设置</button><button class="ghost-btn" onclick="chooseFullSettingsImport()">⇧ 导入完整设置</button></div><div class="row-sub">当前 API（接口）：${cfg.apiBase?escapeHtml(cfg.apiBase):'未配置'} · Model（模型）：${cfg.model?escapeHtml(cfg.model):'未选择'}</div></div>
    <div id="data-backup-status" class="api-status">${snap?'✅ 当前浏览器已有本机快照。':'建议先保存一次本机快照，再导出一份文件备份。'}</div></section>
    <section class="settings-section"><h3>🧹 Cache（缓存）说明</h3><p class="helper"><strong>只想让 GitHub Pages 加载新代码时，不需要先清除网站数据。</strong>本版已经给 CSS / JS 资源加入版本号 <code>?v=1.0.9</code>，部署后浏览器会把它们当成新资源重新拉取。若仍显示旧页面，先关闭该标签页再重新打开，或做一次强制刷新；不要直接使用会删除网站数据的清理方式，除非你已经导出了完整设置备份。</p></section>`;
}

async function renderAppearanceTab(box){fontRecords=await MimaFontManager.all();const ui=MimaFontManager.getSelected('ui'),story=MimaFontManager.getSelected('story'),typo=getStoryTypography();const opts=`<option value="">系统默认字体</option>`+fontRecords.map(f=>`<option value="${escapeHtml(f.family)}">${escapeHtml(f.family)} · ${formatBytes(f.size)}</option>`).join('');box.innerHTML=`<section class="settings-section"><h3>🎨 本地字体库</h3><p class="helper">直接导入 TTF / OTF / WOFF / WOFF2（字体文件格式）。文件保存在当前浏览器 IndexedDB，不需要转 URL（链接），也不会上传到服务器。剧情正文字体会作用于普通小说正文；开启 Safe HTML（安全 HTML）后，未自行指定字体的 HTML 正文也会继承它。状态栏若有自己的 CSS 字体设置，仍以状态栏自己的设置为准。</p><div class="toolbar"><button class="primary-btn" onclick="chooseFontImport()">＋ 导入字体文件</button></div><div class="form-grid"><div><label class="form-label">UI（界面）字体</label><select id="font-ui-select" class="field" onchange="changeFont('ui',this.value)">${opts}</select></div><div><label class="form-label">剧情正文字体</label><select id="font-story-select" class="field" onchange="changeFont('story',this.value)">${opts}</select></div></div><div id="font-list" style="margin-top:14px"></div></section>
<section class="settings-section"><h3>📖 Novel Typography（小说正文排版）</h3><p class="helper">进入本页会自动打开上方实时预览。字号、正文字体、行高与字间距也会作为 Safe HTML 的基础继承值；段间距与首行缩进仍只作用于咪嘛馆识别出的普通小说段落，不会强行挤压 &lt;system&gt; / &lt;details&gt; / 表格等状态栏结构。</p>
<div class="typography-grid">
${typographyControlHtml('字号','fontSize',12,26,.5,typo.fontSize,'px')}
${typographyControlHtml('行间距','lineHeight',1.2,2.6,.05,typo.lineHeight,'')}
${typographyControlHtml('段间距','paragraphGap',0,3,.05,typo.paragraphGap,'em')}
${typographyControlHtml('字间距','letterSpacing',-.04,.18,.005,typo.letterSpacing,'em')}
${typographyControlHtml('首行缩进','firstLineIndent',0,4,.25,typo.firstLineIndent,'em')}
</div><div class="typography-indent-hint"><span>中文小说推荐：<strong>2em</strong>（约两个汉字宽）</span><div class="typography-quick-buttons"><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',0)">0</button><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',1)">1em</button><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',2)">2em</button><button class="tool-mini" onclick="updateStoryTypography('firstLineIndent',3)">3em</button></div></div><div class="toolbar typography-actions"><button class="ghost-btn" onclick="resetStoryTypography()">恢复默认排版</button></div></section>
<section class="settings-section"><h3>兼容旧版 URL（链接）字体</h3><p class="helper">旧功能保留。如果某个字体只能用网页链接，也仍然可以加载。</p><div class="form-grid"><div><label class="form-label">字体 URL（链接）</label><input id="legacy-font-url" class="field" value="${escapeHtml(localStorage.getItem(LEGACY_FONT_URL_KEY)||'')}"></div><div><label class="form-label">Font Family（字体族名）</label><input id="legacy-font-family" class="field" value="${escapeHtml(localStorage.getItem(LEGACY_FONT_FAMILY_KEY)||'')}"></div><div class="form-full"><button class="ghost-btn" onclick="applyLegacyUrlFont()">应用 URL（链接）字体</button></div></div></section>
<section class="settings-section"><h3>🪄 CSS Preset Library（CSS 预设库）</h3><p class="helper">支持直接粘贴或导入<strong>纯 CSS</strong>，不需要手动包 &lt;style&gt;。CSS 可以只美化模型输出的自定义 HTML，也可以覆盖剧情区域，或选择“咪嘛馆全局”直接二改整个 UI（界面）。模型输出本身仍经过 Safe HTML sanitizer（安全 HTML 清洗器），不会执行 &lt;script&gt; / &lt;style&gt;。</p><div class="toolbar css-default-tools"><button class="primary-btn" onclick="openCssPresetEditor()">＋ 新建 CSS（样式）</button><button class="ghost-btn" onclick="chooseCssImport()">⇧ 导入 .css（样式文件）</button><button class="ghost-btn" onclick="copyDefaultCss()">⧉ 一键复制默认 CSS（样式）</button><button class="ghost-btn" onclick="exportDefaultCss()">⇩ 导出默认 CSS（样式）</button><button class="ghost-btn" onclick="forkDefaultCss()">✦ 默认 CSS 二改</button><button class="danger-btn" onclick="emergencyDisableCss()">🚑 临时禁用自定义 CSS（样式）</button></div><div class="row-sub css-scope-note">Scope（作用域）：自定义 HTML = 只影响每条剧情正文；剧情区域 = 整个聊天面板；咪嘛馆全局 = 顶栏、设置、输入框、剧情 HTML 等全部可改。</div><div class="row-sub" style="margin:8px 0 12px">当前：${currentCssPreset()?escapeHtml(currentCssPreset().name):'未挂载'} · ${currentSessionData.customCssEnabled===false?'已禁用':'已启用'}</div><div class="toolbar">${currentSessionData.customCssId?'<button class="ghost-btn" onclick="unapplyCss()">取消应用</button>':''}${currentSessionData.customCssId&&currentSessionData.customCssEnabled===false?'<button class="ghost-btn" onclick="reenableCss()">重新启用</button>':''}</div><div id="css-preset-list" class="card-grid css-preset-grid" style="margin-top:12px"></div></section>
<section class="settings-section"><h3>显示</h3><label class="check-row"><input id="render-html-setting" type="checkbox" ${currentSessionData.renderMode==='safe_html'?'checked':''} onchange="toggleSafeHtml(this.checked)"> 允许 Safe HTML（安全 HTML）状态栏渲染</label><p class="helper">开启后会保留正文原有换行与空格，并支持 &lt;system&gt;、&lt;details&gt;、&lt;summary&gt;、区块、表格等安全结构，方便 CSS 状态栏直接生效。</p></section>`;qs('font-ui-select').value=ui;qs('font-story-select').value=story;const root=qs('font-list');if(!fontRecords.length)root.innerHTML='<div class="row-sub">还没有本地字体。</div>';fontRecords.forEach(f=>{const r=document.createElement('div');r.className='font-row';r.innerHTML=`<div class="row-main"><div class="row-title" style="font-family:'${escapeHtml(f.family)}'">Aa　${escapeHtml(f.family)}</div><div class="row-sub">${escapeHtml(f.name)} · ${formatBytes(f.size)}</div></div><button class="danger-btn" onclick="deleteLocalFont('${f.id}')">删除</button>`;root.appendChild(r)});renderCssPresetLibrary(qs('css-preset-list'));syncStoryTypographyControls(typo)}
function typographyControlHtml(label,key,min,max,step,value,unit){return `<div class="typography-control"><div class="typography-control-head"><label class="form-label" for="typo-${key}-range">${label}</label><span id="typo-${key}-value" class="value-pill">${storyTypoDisplay(key,value)}</span></div><div class="typography-control-row"><input id="typo-${key}-range" class="typography-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}" oninput="updateStoryTypography('${key}',this.value)"><input id="typo-${key}-number" class="field typography-number" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}" onchange="updateStoryTypography('${key}',this.value)"><span class="typography-unit">${unit}</span></div></div>`}
function currentCssPreset(){return cssPresets.find(x=>x.id===currentSessionData?.customCssId)||null}
function ensureCustomCssStyle(){let tag=qs('mima-custom-css-style');if(!tag){tag=document.createElement('style');tag.id='mima-custom-css-style';document.head.appendChild(tag)}return tag}
function stripEmbeddedStyleTags(css){return String(css||'').replace(/<\/?style\b[^>]*>/gi,'')}
function findMatchingBrace(src,open){let depth=0,quote='',comment=false;for(let i=open;i<src.length;i++){const ch=src[i],next=src[i+1];if(comment){if(ch==='*'&&next==='/'){comment=false;i++}continue}if(!quote&&ch==='/'&&next==='*'){comment=true;i++;continue}if(quote){if(ch==='\\'){i++;continue}if(ch===quote)quote='';continue}if(ch==='"'||ch==="'"){quote=ch;continue}if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return i}return-1}
function scopeCssBlock(css,scope){let out='',cursor=0;const src=String(css||'');while(cursor<src.length){const open=src.indexOf('{',cursor);if(open<0){out+=src.slice(cursor);break}const close=findMatchingBrace(src,open);if(close<0){out+=src.slice(cursor);break}const header=src.slice(cursor,open);const trimmed=header.trim();const body=src.slice(open+1,close);if(!trimmed){out+=header+'{'+body+'}'}else if(/^@(media|supports|container|layer|document)\b/i.test(trimmed)){out+=header+'{'+scopeCssBlock(body,scope)+'}'}else if(/^@(keyframes|-webkit-keyframes|font-face|page|property|counter-style)\b/i.test(trimmed)){out+=header+'{'+body+'}'}else if(trimmed.startsWith('@')){out+=header+'{'+body+'}'}else{const lead=header.slice(0,header.indexOf(trimmed));const selectors=trimmed.split(',').map(sel=>sel.trim()).filter(Boolean).map(sel=>{if(sel===scope||sel.startsWith(scope+' ')||sel.startsWith(scope+':'))return sel;if(/^(from|to|\d+(?:\.\d+)?%)$/i.test(sel))return sel;const normalized=sel.replace(/^(?:html|body|:root)\b\s*/i,'').trim();return normalized?`${scope} ${normalized}`:scope}).join(', ');out+=lead+selectors+'{'+body+'}'}cursor=close+1}return out}
function compileCustomCss(preset){if(!preset?.css)return'';const clean=stripEmbeddedStyleTags(preset.css);if(preset.scope==='app')return clean;const scope=preset.scope==='global'?'#story-chat-box.tavern-story-scope':'.tavern-story-content';return scopeCssBlock(clean,scope)}
function applyCustomCss(){const tag=ensureCustomCssStyle();const preset=currentCssPreset();const safeCssBypass=new URLSearchParams(location.search).get('noCss')==='1';if(safeCssBypass||!currentSessionData||currentSessionData.customCssEnabled===false||!preset){tag.textContent='';return}tag.textContent=compileCustomCss(preset)}
function cssScopeLabel(scope){return scope==='app'?'咪嘛馆全局 Scope（作用域）':scope==='global'?'剧情面板级 Scope（作用域）':'自定义 HTML 内容级 Scope（作用域）'}
function renderCssPresetLibrary(root){if(!root)return;const active=currentSessionData?.customCssId;root.innerHTML='';if(!cssPresets.length){root.innerHTML='<div class="row-sub">还没有 CSS Preset（CSS 预设）。可以新建或直接导入 .css（样式文件）。</div>';return}cssPresets.forEach(p=>{const mounted=p.id===active;const row=document.createElement('div');row.className=`library-card ${mounted?'mounted':''}`;row.innerHTML=`<div class="card-title"><span>${escapeHtml(p.name)}</span>${mounted?'<span class="tag">当前 Session（剧情会话）</span>':''}</div><div class="card-desc">${cssScopeLabel(p.scope)} · ${String(p.css||'').length} 字符</div><div class="card-actions"><button class="${mounted?'primary-btn':'ghost-btn'}" onclick="applyCssPreset('${p.id}')">${mounted?'重新启用':'应用'}</button><button class="ghost-btn" onclick="openCssPresetEditor('${p.id}')">编辑</button><button class="ghost-btn" onclick="duplicateCssPreset('${p.id}')">复制</button><button class="ghost-btn" onclick="exportCssPreset('${p.id}')">导出</button></div>`;root.appendChild(row)})}
function openCssPresetEditor(id=null){const p=id?cssPresets.find(x=>x.id===id):{name:'',css:'',scope:'story'};editorState={type:'css-preset',id};qs('editor-title').textContent=id?`编辑 CSS · ${p?.name||''}`:'新建 CSS Preset（CSS 预设）';qs('editor-eyebrow').textContent='CSS PRESET（CSS 预设）';qs('editor-body').innerHTML=`<div class="form-grid"><div class="form-full"><label class="form-label">名称</label><input id="css-pre-name" class="field" value="${escapeHtml(p?.name||'')}"></div><div class="form-full"><label class="form-label">Scope（作用域）</label><select id="css-pre-scope" class="field"><option value="story" ${p?.scope==='story'||!p?.scope?'selected':''}>自定义 HTML / 剧情内容（最安全）</option><option value="global" ${p?.scope==='global'?'selected':''}>剧情聊天区域</option><option value="app" ${p?.scope==='app'?'selected':''}>咪嘛馆全局 UI + HTML（全局二改）</option></select><div class="row-sub">“咪嘛馆全局”会按原样应用 CSS，可修改顶栏、设置中心、输入框和剧情 HTML；若样式把 UI 隐藏，请重新打开页面后在外观里点“🚑 临时禁用”；极端情况下可在网址末尾加 <code>?noCss=1</code> 进入 CSS 安全模式。</div></div><div class="form-full"><label class="form-label">CSS（样式）</label><textarea id="css-pre-code" class="field textarea tall css-code-editor" spellcheck="false" placeholder="/* 直接写 CSS，不用 <style> */&#10;system, .status-card { padding: 12px; border-radius: 16px; }">${escapeHtml(p?.css||'')}</textarea></div></div>`;setupEditorButtons(id?()=>deleteCssPreset(id):null,saveCssPresetEditor);qs('editor-modal').classList.remove('hidden')}
async function saveCssPresetEditor(){const wantedScope=qs('css-pre-scope').value;const body={name:qs('css-pre-name').value.trim()||'未命名 CSS（样式）',scope:['story','global','app'].includes(wantedScope)?wantedScope:'story',css:stripEmbeddedStyleTags(qs('css-pre-code').value)};const res=await fetchStory(editorState.id?`/css-presets/${editorState.id}`:'/css-presets',editorState.id?'PATCH':'POST',body);if(!res.success)return toast(res.msg||'保存 CSS 失败');const saved=res.data;closeEditor();await loadAll();if(currentSessionData?.customCssId===saved.id)applyCustomCss();openSettings('appearance');toast(`CSS Preset（CSS 预设）「${saved.name}」已保存`)}
async function applyCssPreset(id){if(!cssPresets.some(x=>x.id===id))return;await patchCurrent({customCssId:id,customCssEnabled:true},true);applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('CSS（样式）已应用到当前 Session（剧情会话）')}
async function unapplyCss(){await patchCurrent({customCssId:null,customCssEnabled:false},true);applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('当前 Session（剧情会话）已取消 CSS（样式）')}
async function emergencyDisableCss(){await patchCurrent({customCssEnabled:false},true);ensureCustomCssStyle().textContent='';if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'));toast('🚑 自定义 CSS（样式）已临时禁用')}
async function reenableCss(){if(!currentSessionData?.customCssId)return toast('当前 Session（剧情会话）没有挂载 CSS（样式）');await patchCurrent({customCssEnabled:true},true);applyCustomCss();if(settingsTab==='appearance')renderAppearanceTab(qs('settings-content'))}
async function duplicateCssPreset(id){const p=cssPresets.find(x=>x.id===id);if(!p)return;const res=await fetchStory('/css-presets','POST',{name:`${p.name} · 副本`,css:p.css,scope:p.scope});if(res.success){await loadAll();openSettings('appearance');toast('CSS Preset（CSS 预设）已复制')}else toast(res.msg||'复制失败')}
async function deleteCssPreset(id){if(!confirm('删除这个 CSS Preset（CSS 预设）？挂载它的 Session（剧情会话）会自动取消应用。'))return;const res=await fetchStory(`/css-presets/${id}`,'DELETE');if(!res.success)return toast(res.msg||'删除失败');closeEditor();await loadAll();applyCustomCss();openSettings('appearance')}
function chooseCssImport(){qs('css-file-input').value='';qs('css-file-input').click()}
async function importCssFile(file){if(!file)return;try{const css=stripEmbeddedStyleTags(await file.text());const res=await fetchStory('/css-presets','POST',{name:file.name.replace(/\.css$/i,'')||'导入 CSS（样式）',css,scope:'story'});if(!res.success)throw new Error(res.msg||'导入失败');await loadAll();if(currentSessionId){await patchCurrent({customCssId:res.data.id,customCssEnabled:true},true);applyCustomCss()}openSettings('appearance');toast(`已导入并应用 CSS（样式）「${res.data.name}」`)}catch(e){toast(`CSS（样式）导入失败：${e.message}`)}}
function exportCssPreset(id){const p=cssPresets.find(x=>x.id===id);if(!p)return;const blob=new Blob([p.css||''],{type:'text/css;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(p.name||'mimamao').replace(/[\\/:*?"<>|]/g,'_')}.css`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
let defaultCssSourceCache='';
async function loadDefaultCssSource(){
    if(defaultCssSourceCache)return defaultCssSourceCache;
    try{
        const res=await fetch('./style.css?v=1.0.9',{cache:'no-store'});
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
function applyLegacyUrlFont(){const url=qs('legacy-font-url').value.trim().replace(/[\n\r\t'"()\\]/g,'');const family=(qs('legacy-font-family').value.trim()||'MimaUrlFont').replace(/['"\\;\n\r{}]/g,'');let tag=qs('legacy-url-font-style');if(!tag){tag=document.createElement('style');tag.id='legacy-url-font-style';document.head.appendChild(tag)}if(!url){tag.textContent='';localStorage.removeItem(LEGACY_FONT_URL_KEY);return}const fmt=fontFormat(url);const apply=`.assistant-msg .story-prose,.assistant-msg .msg-content.safe-html-content{font-family:'${family}',var(--font-ui)!important}`;tag.textContent=url.includes('fonts.googleapis.com')||url.endsWith('.css')?`@import url('${url}'); ${apply}`: `@font-face{font-family:'${family}';src:url('${url}')${fmt?` format('${fmt}')`:''};font-display:swap;} ${apply}`;localStorage.setItem(LEGACY_FONT_URL_KEY,url);localStorage.setItem(LEGACY_FONT_FAMILY_KEY,family);toast('URL 字体已应用')}

function renderApiTab(box){
    const c=MimaStandalone.getApiConfig();
    const temp=Number.isFinite(Number(c.temperature))?Number(c.temperature):getTemp();
    box.innerHTML=`<section class="settings-section"><h3>🔌 API（接口）设置</h3><p class="helper">使用你自己的 OpenAI-compatible（兼容 OpenAI 格式）API（接口）。API Key（密钥）只保存在当前浏览器 localStorage（本地存储），不会进入剧情/角色卡/世界书导出文件，也不会发送给咪嘛馆作者。</p>
    <div class="form-grid"><div class="form-full"><label class="form-label">API Base URL（接口基础地址）</label><input id="api-base" class="field" placeholder="https://example.com/v1" value="${escapeHtml(c.apiBase||'')}"><div class="row-sub">支持直接填 .../v1，也支持完整 .../chat/completions 地址。</div></div>
    <div class="form-full"><label class="form-label">API Key（接口密钥）</label><input id="api-key" class="field" type="password" autocomplete="off" placeholder="sk-..." value="${escapeHtml(c.apiKey||'')}"></div>
    <div class="form-full"><label class="form-label">Model（模型）</label><div class="model-picker-stack"><div class="inline-field-row"><select id="api-model-select" class="field" onchange="syncApiModelSelect()"><option value="">先点“拉取模型”，然后从这里展开选择</option>${c.model?`<option value="${escapeHtml(c.model)}" selected>${escapeHtml(c.model)} · 当前</option>`:''}</select><button class="ghost-btn" onclick="loadApiModels()">拉取模型</button></div><input id="api-model" class="field" placeholder="也可以手动填写模型名" value="${escapeHtml(c.model||'')}"><div class="row-sub">iPhone / iPad（苹果移动设备）会使用原生下拉选择器；选择后会自动同步到下方模型名输入框。</div></div></div>
    <div class="form-full"><label class="form-label">Temperature（温度） <span id="api-temp-value" class="value-pill">${temp.toFixed(2)}</span></label><div class="temperature-row"><input id="api-temp-range" class="temp-range" type="range" min="0.1" max="2" step="0.05" value="${temp}" oninput="syncTemperature('range')"><input id="api-temperature" class="field temp-number" type="number" min="0.1" max="2" step="0.05" value="${temp}" oninput="syncTemperature('number')"></div><div class="row-sub">数值越高通常越发散，越低通常越稳定。具体有效范围以模型/中转站为准。</div></div>
    <div><label class="form-label">Max Tokens（最大 Token 数量，0=不发送）</label><input id="api-max-tokens" class="field" type="number" min="0" value="${Number(c.maxTokens||0)}"></div>
    <div><label class="check-row api-check"><input id="api-send-temp" type="checkbox" ${c.sendTemperature!==false?'checked':''}> 发送 Temperature（温度）参数</label><label class="check-row"><input id="api-stream" type="checkbox" ${c.stream?'checked':''}> Streaming（流式传输）</label></div>
    <div class="form-full"><details><summary>Advanced（高级设置）</summary><div class="form-grid advanced-grid"><div class="form-full"><label class="form-label">Chat Endpoint Override（聊天端点覆盖，可空）</label><input id="api-chat-endpoint" class="field" placeholder="例如 /v1/chat/completions" value="${escapeHtml(c.chatEndpoint||'')}"></div><div class="form-full"><label class="form-label">Models Endpoint Override（模型端点覆盖，可空）</label><input id="api-models-endpoint" class="field" placeholder="例如 /v1/models" value="${escapeHtml(c.modelsEndpoint||'')}"></div><div class="form-full"><label class="form-label">Extra Headers JSON（额外请求头 JSON 数据，可空）</label><textarea id="api-extra-headers" class="field textarea" placeholder='{"X-Custom-Key":"value"}'>${escapeHtml(c.extraHeaders||'')}</textarea></div></div></details></div></div>
    <div class="toolbar"><button class="primary-btn" onclick="saveApiSettings()">保存 API（接口）</button><button class="ghost-btn" onclick="testApiConnection()">测试连接</button><button class="ghost-btn" onclick="chooseApiImport()">⇧ 导入 API（接口）配置</button></div><div id="api-status" class="api-status"></div></section>
    <section class="settings-section"><h3>🌐 浏览器直连说明</h3><p class="helper">Standalone（独立版）是纯前端，因此 API（接口）服务必须允许浏览器跨域（CORS）。如果出现 “Failed to fetch（请求失败） / CORS（跨域）” 而地址和 Key（密钥）都正确，是 API 站点禁止网页直连，不是咪嘛馆剧情配置错误。此时需要换支持 CORS 的中转，或把本静态前端部署到该服务允许的来源。</p></section>`;
}
function syncApiModelSelect(){const sel=qs('api-model-select'),input=qs('api-model');if(sel?.value&&input){input.value=sel.value;MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),model:sel.value});const status=qs('api-status');if(status)status.textContent=`✅ 已选择 Model（模型）：${sel.value}`}}
function syncTemperature(source){const range=qs('api-temp-range'),num=qs('api-temperature'),pill=qs('api-temp-value');let v=Number(source==='range'?range?.value:num?.value);if(!Number.isFinite(v))v=.85;v=Math.max(.1,Math.min(2,v));if(range&&source!=='range')range.value=v;if(num&&source!=='number')num.value=v.toFixed(2);if(pill)pill.textContent=v.toFixed(2)}
function populateApiModelSelect(models){const sel=qs('api-model-select');if(!sel)return;const current=qs('api-model')?.value.trim()||'';sel.innerHTML='<option value="">请选择 Model（模型）</option>'+models.map(x=>`<option value="${escapeHtml(x)}" ${x===current?'selected':''}>${escapeHtml(x)}</option>`).join('');if(current&&!models.includes(current)){const opt=document.createElement('option');opt.value=current;opt.textContent=`${current} · 手动`;opt.selected=true;sel.appendChild(opt)}}
function collectApiForm(){const temp=Math.max(.1,Math.min(2,Number(qs('api-temperature')?.value||.85)));return{apiBase:qs('api-base').value.trim(),apiKey:qs('api-key').value.trim(),model:qs('api-model').value.trim(),chatEndpoint:qs('api-chat-endpoint').value.trim(),modelsEndpoint:qs('api-models-endpoint').value.trim(),extraHeaders:qs('api-extra-headers').value.trim(),sendTemperature:qs('api-send-temp').checked,temperature:temp,stream:qs('api-stream').checked,maxTokens:Number(qs('api-max-tokens').value||0)}}
function saveApiSettings(){try{const c=collectApiForm();if(c.extraHeaders)JSON.parse(c.extraHeaders);MimaStandalone.saveApiConfig(c);localStorage.setItem(TEMP_KEY,String(c.temperature));toast('API（接口）配置只保存到了这个浏览器');const el=qs('api-status');if(el)el.textContent='✅ 已保存。';return true}catch(e){const info=describeApiError(e);toast(`API（接口）配置错误：${info.message}`);const el=qs('api-status');if(el)el.textContent=`❌ ${info.code} · ${info.message}\n可能原因：${info.hint}`;return false}}
async function loadApiModels(){if(!saveApiSettings())return;const status=qs('api-status');status.textContent='正在拉取模型……';try{const models=await MimaStandalone.listModels();populateApiModelSelect(models);status.textContent=`✅ 拉到 ${models.length} 个 Model（模型）。现在可以点击上方下拉框展开选择，也可以继续手填。`;if(models.length&&!qs('api-model').value){qs('api-model').value=models[0];populateApiModelSelect(models);MimaStandalone.saveApiConfig({...collectApiForm(),model:models[0]})}}catch(e){const info=describeApiError(e);status.textContent=`❌ ${info.code}${info.status?` · HTTP（状态码） ${info.status}`:''}\n${info.message}\n可能原因：${info.hint}`}}
async function testApiConnection(){if(!saveApiSettings())return;const status=qs('api-status');status.textContent='正在测试 API（接口）……';try{const r=await MimaStandalone.testApi();status.textContent=`✅ API（接口）可访问，模型列表 ${r.count} 个。`;populateApiModelSelect(r.models)}catch(e){const info=describeApiError(e);status.textContent=`❌ ${info.code}${info.status?` · HTTP（状态码） ${info.status}`:''}\n${info.message}\n可能原因：${info.hint}`}}
function describeApiError(e){const message=e?.message||String(e);const code=e?.code||(/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)?'E_API_NETWORK_CORS':'E_API_UNKNOWN');const status=Number(e?.status)||0;let hint=e?.hint||'';if(!hint&&code==='E_API_NETWORK_CORS')hint='如果地址/Key（密钥）正确，通常是 API 没开放浏览器 CORS（跨域），也可能是网络或证书问题。';if(!hint)hint='请检查 API（接口）地址、密钥、模型名、参数兼容性以及中转站状态。';return{message,code,status,hint,details:e?.details||''}}
function friendlyApiError(e){const i=describeApiError(e);return `${i.code}${i.status?` · HTTP（状态码） ${i.status}`:''} · ${i.message}\n可能原因：${i.hint}`}
function chooseApiImport(){qs('api-config-file-input').value='';qs('api-config-file-input').click()}
async function importApiConfigFile(file){if(!file)return;try{const raw=JSON.parse(await file.text()),src=raw.data||raw;const temperature=Number(src.temperature??localStorage.getItem(TEMP_KEY)??.85);MimaStandalone.saveApiConfig({apiBase:src.apiBase||src.baseUrl||src.base_url||'',apiKey:src.apiKey||src.api_key||src.key||'',model:src.model||'',chatEndpoint:src.chatEndpoint||'',modelsEndpoint:src.modelsEndpoint||'',extraHeaders:typeof src.extraHeaders==='string'?src.extraHeaders:src.extraHeaders?JSON.stringify(src.extraHeaders):'',sendTemperature:src.sendTemperature!==false,temperature,stream:!!(src.stream??src.streaming),maxTokens:Number(src.maxTokens||0)});localStorage.setItem(TEMP_KEY,String(temperature));renderApiTab(qs('settings-content'));toast('API（接口）配置已导入到当前浏览器')}catch(e){toast(`API（接口）配置导入失败：${e.message}`)}}

function renderPromptTab(box){box.innerHTML=`<section class="settings-section"><h3>🔬 Prompt Inspector（提示词检查器）</h3><p class="helper">使用当前输入框草稿进行“只预览、不调用 LLM（大语言模型）”的组装。可以直接看到世界书命中、System（系统）插槽和 Depth（深度）注入。</p><div class="toolbar"><button class="primary-btn" onclick="refreshPromptInspector()">扫描本轮 Prompt（提示词）</button></div><div id="prompt-inspector"><div class="row-sub">点击上方按钮生成预览。</div></div></section>`}
async function refreshPromptInspector(){const root=qs('prompt-inspector');root.innerHTML='<div class="row-sub">正在组装……</div>';const res=await fetchStory(`/sessions/${currentSessionId}/prompt-preview`,'POST',{draft:qs('story-input').value,directorNote:qs('director-note').value});if(!res.success){root.textContent=res.msg||'预览失败';return}const d=res.data;root.innerHTML=`<div class="prompt-stats"><div class="stat-card"><div class="stat-num">${d.systemChars}</div><div class="stat-label">System（系统）字符</div></div><div class="stat-card"><div class="stat-num">${d.matchedWorldbookEntries.length}</div><div class="stat-label">世界书命中</div></div><div class="stat-card"><div class="stat-num">${d.finalMessageCount}</div><div class="stat-label">最终 Messages（消息）</div></div></div><h4>本轮世界书</h4><div class="hit-list">${d.matchedWorldbookEntries.length?d.matchedWorldbookEntries.map(x=>`<div class="hit-item">✅ ${escapeHtml(x.bookName)} / ${escapeHtml(x.entryName)} · Depth（深度） ${x.depth} · ${escapeHtml(x.position)} · ${escapeHtml(x.reason)}${x.hits?.length?` · 命中：${escapeHtml(x.hits.join(', '))}`:''}</div>`).join(''):'<div class="hit-item">本轮没有触发世界书条目。</div>'}</div><h4 style="margin-top:16px">System Prompt（系统提示词）</h4><pre class="prompt-pre">${escapeHtml(d.systemPreview)}</pre><details style="margin-top:12px"><summary>查看完整 Message（消息）队列</summary><pre class="prompt-pre">${escapeHtml(d.messagePreview.map(x=>`#${x.index} ${x.role}\n${x.content}`).join('\n\n'))}</pre></details>`}

function setupEditorButtons(deleteFn,saveFn){qs('editor-save').textContent='保存';const del=qs('editor-delete');if(deleteFn){del.classList.remove('hidden');del.onclick=deleteFn}else{del.classList.add('hidden');del.onclick=null}qs('editor-save').onclick=saveFn}
function downloadText(name,text,type='text/plain;charset=utf-8'){const blob=new Blob([String(text??'')],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function downloadJson(name,obj){downloadText(name,JSON.stringify(obj,null,2),'application/json;charset=utf-8')}
function toast(text){let t=document.getElementById('mima-toast');if(!t){t=document.createElement('div');t.id='mima-toast';t.style.cssText='position:fixed;z-index:2000;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(48,51,56,.92);color:white;padding:10px 14px;border-radius:999px;font-size:13px;max-width:85vw;text-align:center;transition:.2s';document.body.appendChild(t)}t.textContent=text;t.style.opacity='1';clearTimeout(t._timer);t._timer=setTimeout(()=>t.style.opacity='0',2200)}

function getTemp(){const cfg=MimaStandalone.getApiConfig?.()||{};const n=Number(cfg.temperature??localStorage.getItem(TEMP_KEY)??.85);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):.85}
function toggleUIState(generating){isGenerating=generating;qs('send-btn').disabled=generating;qsa('.quick-actions .chip-btn').forEach(b=>{if(b.id!=='stop-btn')b.disabled=generating});qs('stop-btn').classList.toggle('hidden',!generating);qs('story-input').disabled=generating}
function generationActionLabel(action){return action==='regenerate'?'正在重新生成':action==='continue'?'正在续写':action==='auto_advance'?'正在推进剧情':'正在生成剧情'}
function setGenerationProgress(payload={}){const panel=qs('generation-panel'),bar=qs('generation-progress-bar'),label=qs('generation-label'),pct=qs('generation-percent'),detail=qs('generation-detail');if(!panel)return;panel.classList.remove('hidden','error','done');const n=Math.max(2,Math.min(100,Number(payload.percent)||2));bar.style.width=`${n}%`;pct.textContent=`${Math.round(n)}%`;if(payload.label)label.textContent=payload.label;if(payload.detail)detail.textContent=payload.detail}
function beginGenerationProgress(action){const panel=qs('generation-panel');panel?.classList.remove('hidden','error','done');setGenerationProgress({percent:4,label:`🤍 ${generationActionLabel(action)}`,detail:'正在准备本轮剧情…'})}
function handleGenerationProgress(payload){setGenerationProgress(payload)}
function finishGenerationProgress(){setGenerationProgress({percent:100,label:'🤍 生成完成',detail:'剧情已保存到本机。'});const panel=qs('generation-panel');panel?.classList.add('done');setTimeout(()=>{if(!isGenerating)panel?.classList.add('hidden')},650)}
function showGenerationError(err){const info=describeApiError(err),panel=qs('generation-panel'),bar=qs('generation-progress-bar'),label=qs('generation-label'),pct=qs('generation-percent'),detail=qs('generation-detail');if(!panel)return;panel.classList.remove('hidden','done');panel.classList.add('error');bar.style.width='100%';pct.textContent=info.status?`HTTP（状态码） ${info.status}`:'ERROR（错误）';label.textContent=`生成失败 · ${info.code}`;detail.textContent=`${info.message}
可能原因：${info.hint}${info.details?`
诊断：${info.details}`:''}`}
function dismissGenerationPanel(){qs('generation-panel')?.classList.add('hidden')}
async function triggerChat(text,actionType='send'){
    if(!currentSessionId)return toast('请先创建一个剧情。');
    if(memoryGenerating)return toast('记忆总结正在进行猫，完成或停止后再生成剧情。');
    const directorNote=qs('director-note').value.trim();
    // 在 UI 当前可见状态下锁定“重说”的确切 assistant 消息。只锁定最后一轮的回复；
    // 如果当前最后一条是 user，则不提供 targetMessageId，Core 会生成新回复而不是误覆盖上一轮。
    let targetMessageId=null;
    if(actionType==='regenerate'){
        const msgs=arr(currentSessionData?.messages);
        let lastUser=-1,lastAssistant=-1;
        for(let i=msgs.length-1;i>=0&&(lastUser<0||lastAssistant<0);i--){if(lastUser<0&&msgs[i]?.role==='user')lastUser=i;if(lastAssistant<0&&msgs[i]?.role==='assistant')lastAssistant=i}
        if(lastAssistant>=0&&(lastUser<0||lastAssistant>lastUser))targetMessageId=msgs[lastAssistant]?.id||null;
    }
    toggleUIState(true);beginGenerationProgress(actionType);
    try{const res=await fetchStory(`/sessions/${currentSessionId}/chat`,'POST',{text,action:actionType,temperature:getTemp(),directorNote,targetMessageId},true,handleGenerationProgress);toggleUIState(false);if(res.aborted){toast('生成已停止，主人消息已保留。');setGenerationProgress({percent:100,label:'已停止生成',detail:'主人消息仍然保存在剧情里，可以直接重试。'});setTimeout(()=>dismissGenerationPanel(),900);await openSession(currentSessionId,false);return}if(res.success){currentSessionData=res.data;qs('story-input').value='';autoResizeInput();refreshChatBox();await refreshSessionSummaryList();refreshHeader();finishGenerationProgress()}else{showGenerationError(res);toast(`生成失败 · ${res.code||'E_UNKNOWN'}`);await openSession(currentSessionId,false)}}catch(e){toggleUIState(false);showGenerationError(e);toast(`生成失败 · ${e?.code||'E_UNKNOWN'}`)}
}
function stopGeneration(){if(activeRequest){activeRequest.abort();activeRequest=null}toggleUIState(false)}
function sendMsg(){const txt=qs('story-input').value.trim();if(txt)triggerChat(txt,'send')}
function regenerateMsg(){triggerChat('','regenerate')}
function continueMsg(){triggerChat('','continue')}
function autoAdvance(){triggerChat(qs('director-note').value.trim()||'请自然推进下一段剧情。','auto_advance')}
function autoResizeInput(){const el=qs('story-input');el.style.height='auto';el.style.height=Math.min(170,Math.max(46,el.scrollHeight))+'px'}

function refreshChatBox(){const box=qs('story-chat-box');box.innerHTML='';if(!currentSessionData||!currentSessionData.messages?.length){box.innerHTML=`<div class="empty-state"><div class="empty-icon">${currentChar()?'🤍':'🍷'}</div><h2>${escapeHtml(currentChar()?.name||'这个宇宙还是空的')}</h2><p>${currentChar()?.firstMessage?'角色卡里有 First Message（开场白），可在 🤍 角色设置中一键插入。':'写下第一句话，剧情从这里开始。'}</p></div>`;return}currentSessionData.messages.forEach(renderMessageToUI);requestAnimationFrame(()=>box.scrollTop=box.scrollHeight)}
function renderMessageToUI(msg){const box=qs('story-chat-box');const role=msg.role||'system';const div=document.createElement('article');div.className=`message ${role}-msg`;div.dataset.msgId=msg.id||'';const header=document.createElement('div');header.className='msg-header';const roleName=role==='user'?(currentUser()?.name||'你 / User（用户）'):(role==='assistant'?(currentChar()?.name||(currentSessionData?.mode==='sandalphon'?'圣德芬':'Character（角色）')):'系统');header.textContent=`${roleName}${msg.isEdited?' · 已编辑':''}${msg.versions?.length?` · ${msg.versions.length} 个旧版本`:''}`;div.appendChild(header);const content=document.createElement('div');const allowHtml=currentSessionData?.renderMode==='safe_html';content.className=`msg-content tavern-story-content${allowHtml?' safe-html-content':''}`;appendRenderedContent(content,cleanCorruptText(msg.content||''),allowHtml);div.appendChild(content);if(role==='user'||role==='assistant'){const tools=document.createElement('div');tools.className='msg-tools';tools.append(makeToolButton('编辑',()=>openMessageEditor(msg,false)),makeToolButton('从这里分支',()=>openMessageEditor(msg,true)));if(role==='assistant'&&msg.versions?.length)tools.append(makeToolButton('看旧版本',()=>showVersions(msg)));div.appendChild(tools)}box.appendChild(div)}
function makeToolButton(text,fn){const b=document.createElement('button');b.className='tool-mini';b.textContent=text;b.onclick=fn;return b}
function openMessageEditor(msg,truncateAfter=false){editorState={type:'message',msg,truncateAfter};qs('editor-title').textContent=truncateAfter?'编辑并从这里建立新时间线':'编辑消息';qs('editor-eyebrow').textContent='STORY MESSAGE（剧情消息）';qs('editor-body').innerHTML=`<label class="form-label">消息内容</label><textarea id="message-edit-content" class="field textarea tall">${escapeHtml(msg.content||'')}</textarea>${truncateAfter?'<p class="helper">保存后，这条消息之后的旧剧情会进入 archivedBranches（归档分支），不会直接丢失。</p>':''}`;setupEditorButtons(null,saveMessageEditor);qs('editor-modal').classList.remove('hidden')}
async function saveMessageEditor(){const {msg,truncateAfter}=editorState;const res=await fetchStory(`/sessions/${currentSessionId}/messages/${msg.id}`,'PATCH',{content:qs('message-edit-content').value,truncateAfter});if(res.success){currentSessionData=res.data;closeEditor();refreshChatBox();if(truncateAfter&&msg.role==='user'&&confirm('现在从这条 User（用户）消息重新生成后续吗？'))await triggerChat('','regenerate')}else toast(res.msg||'编辑失败')}
function showVersions(msg){editorState={type:'versions'};qs('editor-title').textContent='旧版本';qs('editor-eyebrow').textContent='MESSAGE VERSIONS（消息旧版本）';qs('editor-body').innerHTML=arr(msg.versions).slice().reverse().map((v,i)=>`<div class="entry-card"><div class="entry-meta">${escapeHtml(v.reason||'version（版本）')} · ${escapeHtml(v.time||'')}</div><div style="white-space:pre-wrap;line-height:1.6;margin-top:8px">${escapeHtml(v.content||'')}</div></div>`).join('');setupEditorButtons(null,closeEditor);qs('editor-save').textContent='关闭';qs('editor-modal').classList.remove('hidden')}
function appendProseText(parent,text){
    const raw=String(text??'').replace(/\r\n?/g,'\n');if(!raw.trim())return;
    const chunks=raw.split(/\n{2,}/);
    chunks.forEach(chunk=>{if(!chunk.trim())return;const p=document.createElement('div');p.className='story-prose story-paragraph';p.textContent=chunk.trim();parent.appendChild(p)});
}
function appendSafeHtmlWithProse(node,text){
    const template=document.createElement('template');template.innerHTML=sanitizeAllowedHtml(text||'');
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
function sanitizeAllowedHtml(html){
    const template=document.createElement('template');template.innerHTML=cleanCorruptText(html);
    const allowedTags=new Set(['SYSTEM','DIV','SPAN','P','BR','STRONG','B','EM','I','SMALL','MARK','S','U','SUB','SUP','KBD','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','DETAILS','SUMMARY','BLOCKQUOTE','PRE','CODE','H1','H2','H3','H4','H5','H6','UL','OL','LI','DL','DT','DD','TABLE','CAPTION','COLGROUP','COL','THEAD','TBODY','TFOOT','TR','TD','TH','HR']);
    const blockedTags=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','TEXTAREA','OPTION','META','LINK','BASE','SVG','MATH','VIDEO','AUDIO','SOURCE','TRACK','CANVAS','NOSCRIPT']);
    const allowedAttrs=new Set(['class','title','role','open','colspan','rowspan','scope']);
    const nodes=[...template.content.querySelectorAll('*')];
    for(const el of nodes){
        if(blockedTags.has(el.tagName)){el.remove();continue}
        if(!allowedTags.has(el.tagName)){el.replaceWith(...[...el.childNodes]);continue}
        for(const a of [...el.attributes]){
            const n=a.name.toLowerCase(),v=String(a.value||'');
            const ok=allowedAttrs.has(n)||n.startsWith('data-')||n.startsWith('aria-');
            if(!ok||/^on/i.test(n)||/javascript:|data:text\/html/i.test(v))el.removeAttribute(a.name);
        }
    }
    return template.innerHTML;
}

function restoreLegacyFont(){const url=localStorage.getItem(LEGACY_FONT_URL_KEY);if(!url)return;let tag=document.createElement('style');tag.id='legacy-url-font-style';document.head.appendChild(tag);const fam=localStorage.getItem(LEGACY_FONT_FAMILY_KEY)||'MimaUrlFont';const fmt=fontFormat(url);const apply=`.assistant-msg .story-prose,.assistant-msg .msg-content.safe-html-content{font-family:'${fam}',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}`;tag.textContent=url.includes('fonts.googleapis.com')||url.endsWith('.css')?`@import url('${url}'); ${apply}`:`@font-face{font-family:'${fam}';src:url('${url}')${fmt?` format('${fmt}')`:''};font-display:swap;} ${apply}`}

// Expose inline handlers
Object.assign(window,{goPhone,openDrawer,closeDrawer,openSettings,closeSettings,switchSettingsTab,openNewSessionModal,closeNewSessionModal,createSession,deleteCurrentSession,exportCurrentSession,chooseSessionImport,toggleDirector,saveRoleMounts,mountMask,insertCharacterOpening,openMaskEditor,choosePersonaImport,exportMask,toggleWorldbookMount,openWorldbookEditor,addWorldbookEntry,removeWorldbookEntry,chooseWorldbookImport,exportWorldbook,togglePreset,openPresetEditor,saveContextSettings,saveMemorySettings,saveCoreMemoryEdit,generateCoreMemory,generateFactMemories,clearCoreMemory,deleteFactMemory,clearAllFactMemories,setCoreMemoryTarget,syncFactMemoryScope,stopMemorySummary,exportWholeLibrary,chooseLibraryImport,saveFullSettingsSnapshot,restoreSavedSettingsSnapshot,exportFullSettingsBackup,chooseFullSettingsImport,chooseFontImport,changeFont,deleteLocalFont,toggleSafeHtml,applyLegacyUrlFont,openCssPresetEditor,applyCssPreset,unapplyCss,emergencyDisableCss,reenableCss,duplicateCssPreset,deleteCssPreset,chooseCssImport,exportCssPreset,copyDefaultCss,exportDefaultCss,forkDefaultCss,saveApiSettings,loadApiModels,testApiConnection,chooseApiImport,syncApiModelSelect,syncTemperature,updateStoryTypography,resetStoryTypography,dismissGenerationPanel,refreshPromptInspector,closeEditor,sendMsg,regenerateMsg,continueMsg,autoAdvance,stopGeneration});

window.addEventListener('load',async()=>{
    applyStoryTypography();
    restoreLegacyFont();
    try{await MimaStandalone.init()}catch(e){console.error('Standalone（独立版）本地数据库启动失败',e);alert('咪嘛馆本地数据库启动失败：'+e.message);return}
    try{fontRecords=await MimaFontManager.init()}catch(e){console.warn('本地字体库启动失败',e)}
    qs('story-input').addEventListener('input',autoResizeInput);
    qs('story-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendMsg()}});
    qs('session-file-input').addEventListener('change',e=>importSessionFile(e.target.files?.[0]));
    qs('persona-file-input').addEventListener('change',e=>importPersonaFile(e.target.files?.[0]));
    qs('worldbook-file-input').addEventListener('change',e=>importWorldbookFile(e.target.files?.[0]));
    qs('font-file-input').addEventListener('change',e=>importFontFile(e.target.files?.[0]));
    qs('css-file-input').addEventListener('change',e=>importCssFile(e.target.files?.[0]));
    qs('api-config-file-input').addEventListener('change',e=>importApiConfigFile(e.target.files?.[0]));
    qs('library-file-input').addEventListener('change',e=>importWholeLibrary(e.target.files?.[0]));
    qs('full-settings-file-input').addEventListener('change',e=>importFullSettingsFile(e.target.files?.[0]));
    await loadAll();
    if(!MimaStandalone.getApiConfig().apiBase) setTimeout(()=>{ if(currentSessionData) openSettings('api'); },250);
});
