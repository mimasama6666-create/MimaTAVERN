/**
 * 🍷 咪嘛馆 Standalone Core
 * 浏览器本地 Story DB + Prompt Assembler + OpenAI-compatible API client。
 * 与 MIMAMAO Telegram / 宅邸后端完全隔离。
 */
(() => {
  'use strict';

  const API_CONFIG_KEY = 'MIMAMAO_TAVERN_STANDALONE_API_V1';
  let state = { storeRevision: 0, schemaVersion: 4, sessions: [], masks: [], presets: [], worldbooks: [], cssPresets: [], regexPacks: [], novelProjects: [], themeSettings:{theme:'default',updatedAt:''} };
  let lastUsage = null; // v1.1.4: upstream usage/cache telemetry only; never treated as canonical story data.

  const nowIso = () => new Date().toISOString();
  const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const arr = v => Array.isArray(v) ? v : [];
  const text = v => String(v ?? '').replace(/\uFFFD+/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const list = v => arr(v).map(text).filter(Boolean);
  const clone = v => JSON.parse(JSON.stringify(v));
  const clampInt = (v, min, max, fallback) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const clampTemp = v => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0.1, Math.min(2, n)) : 0.85;
  };
  const estimateTokens = t => Math.ceil(String(t || '').length / 2.5);

  function fingerprint(data){const str=JSON.stringify(data);let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return 'fnv1a32:'+((h>>>0).toString(16).padStart(8,'0'))+':'+str.length;}
  function memorySourceFingerprint(messages,count){return fingerprint((messages||[]).slice(0,count).map(m=>[m.id,m.role,m.content,m.rawContent,m.versions,m.isEdited,m.branchId]));}
  function memorySourceValid(session,item){
    if(item.stale)return false;
    // A player's explicit manual text has its own human authority. It is not
    // an unverified model summary and does not acquire a history dependency.
    if(item.source==='manual'&&item.verification?.status==='human_confirmed'&&!item.sourceFingerprint&&!item.sourceHash)return true;
    const ids=arr(item.sourceMessageIds);
    if(ids.length||item.sourceHash){
      if(!ids.length||!item.sourceHash||new Set(ids).size!==ids.length)return false;
      const source=[];let previous=-1;
      for(const id of ids){const index=session.messages.findIndex(m=>m.id===id);if(index<=previous)return false;source.push(session.messages[index]);previous=index;}
      return memorySourceFingerprint(source,source.length)===item.sourceHash;
    }
    // Legacy records retain the existing prefix fence; no invented migration
    // can retroactively prove a narrower source range for an old summary.
    return !(!item.sourceFingerprint&&(session.legacyMemoryQuarantined||session.promptLineageProjection))&&(!item.sourceFingerprint||!!item.sourceCount&&session.messages.length>=item.sourceCount&&memorySourceFingerprint(session.messages,item.sourceCount)===item.sourceFingerprint);
  }
  function normalizeMessage(msg = {}) {
    return {
      id: msg.id || makeId('msg'), role: msg.role || 'user',
      content: String(msg.content ?? ""), rawContent: String(msg.rawContent ?? msg.content ?? ""), renderedContent: String(msg.renderedContent ?? ""),
      time: msg.time || nowIso(), mode: msg.mode || 'story_mode', emotion: msg.emotion || null,
      metadata: {...(msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {}),...(!msg.time?{memoryTimeUnverified:true}:{})},
      canonLevel: msg.canonLevel || 'alternate', isEdited: !!msg.isEdited,
      parentMessageId: msg.parentMessageId || null, branchId: msg.branchId || 'main',
      tokenEstimate: Number(msg.tokenEstimate) || estimateTokens(msg.content), versions: arr(msg.versions)
    };
  }

  function normalizePromptSettings(input = {}) {
    return {
      recentMessageLimit: clampInt(input.recentMessageLimit, 6, 200, 34),
      worldbookBudgetChars: clampInt(input.worldbookBudgetChars, 1000, 1000000, 16000),
      summaryEnabled: input.summaryEnabled !== false,
      pinnedFactsEnabled: input.pinnedFactsEnabled !== false,
      showInjectionLabels: input.showInjectionLabels !== false,
      summaryTriggerMessages: clampInt(input.summaryTriggerMessages, 12, 200, 28),
      ...(input.outputContract?.completeHtml===true?{outputContract:{completeHtml:true}}:{}),
      inputSemanticMode: ['auto','dialogue_first','quote_dialogue','raw'].includes(input.inputSemanticMode) && (input.inputSemanticMode==='raw'||input.inputSemanticExplicit===true) ? input.inputSemanticMode : 'raw',
      inputSemanticExplicit: input.inputSemanticExplicit===true,
      legacyInputSemanticMode: ['auto','dialogue_first','quote_dialogue'].includes(input.legacyInputSemanticMode) ? input.legacyInputSemanticMode : input.inputSemanticExplicit!==true&&['auto','dialogue_first','quote_dialogue'].includes(input.inputSemanticMode) ? input.inputSemanticMode : null
    };
  }

  function normalizeMemoryVerification(v={}){
    // Canonical provenance records never store arbitrary model instructions.
    const status=['extractive_verified','human_confirmed','source_bounded','legacy_unverified'].includes(v?.status)?v.status:'legacy_unverified';
    return {status,stage:String(v?.stage||'').slice(0,100),
      citations:arr(v?.citations).slice(0,100).map(c=>({messageId:String(c.messageId||''),role:String(c.role||''),start:Math.max(0,Number(c.start)||0),end:Math.max(0,Number(c.end)||0),quote:String(c.quote||'').slice(0,4000)})).filter(c=>c.messageId&&c.end>=c.start)};
  }
  function normalizeFactMemory(m = {}) {
    const startRound=clampInt(m.startRound,1,1000000,1), endRound=clampInt(m.endRound,startRound,1000000,startRound);
    return {
      id:m.id||makeId('factmem'), startRound, endRound, content:text(m.content),
      createdAt:m.createdAt||nowIso(), updatedAt:m.updatedAt||m.createdAt||nowIso(),
      source:text(m.source||'manual_fact_summary'), targetChars:clampInt(m.targetChars,80,4000,360),
      temperature:clampTemp(m.temperature??0.35), sourceMessageCount:Math.max(0,Number(m.sourceMessageCount)||0), sourceCount:Math.max(0,Number(m.sourceCount)||0),sourceFingerprint:String(m.sourceFingerprint||''),
      // Do not add empty fields to legacy facts: facts-derived cores hash the
      // normalized records, so a harmless schema extension must not stale them.
      ...(Object.hasOwn(m,'sourceMessageIds')||Object.hasOwn(m,'sourceHash')?{sourceMessageIds:list(m.sourceMessageIds),sourceHash:String(m.sourceHash||'')}:{}),
      stale:m.stale===true,verification:normalizeMemoryVerification(m.verification)
    };
  }
  function normalizeManualMemory(input = {}) {
    const coreInput=input.core&&typeof input.core==='object'?input.core:{};
    return {
      core:{
        content:text(coreInput.content), updatedAt:coreInput.updatedAt||'', source:['context','facts','manual'].includes(coreInput.source)?coreInput.source:'context',
        targetChars:clampInt(coreInput.targetChars,100,12000,1000), temperature:clampTemp(coreInput.temperature??0.35),
        sourceRoundCount:Math.max(0,Number(coreInput.sourceRoundCount)||0), sourceFactCount:Math.max(0,Number(coreInput.sourceFactCount)||0),sourceCount:Math.max(0,Number(coreInput.sourceCount)||0),sourceFingerprint:String(coreInput.sourceFingerprint||''),sourceFactsHash:String(coreInput.sourceFactsHash||''),stale:coreInput.stale===true,verification:normalizeMemoryVerification(coreInput.verification)
      },
      facts:arr(input.facts).map(normalizeFactMemory).filter(x=>x.content),
      settings:{
        injectCore:input.settings?.injectCore!==false,
        injectFacts:input.settings?.injectFacts!==false,
        factInjectionLimit:clampInt(input.settings?.factInjectionLimit,1,100,12),
        summaryTemperature:clampTemp(input.settings?.summaryTemperature??0.35)
      }
    };
  }

  function normalizeSession(s = {}) {
    const createdAt = s.createdAt || nowIso();
    return {
      id: s.id || makeId('sess'), recordRevision:Math.max(0,Number(s.recordRevision)||0), title: text(s.title || '未命名咪嘛宇宙'), createdAt,
      updatedAt: s.updatedAt || createdAt, mode: 'tavern', characterMode: 'tavern',
      loadedUserMaskId: s.loadedUserMaskId || null, loadedCharMaskId: s.loadedCharMaskId || null,
      enabledPersonaSources: { sandalphonPersona: false, userPersona: false, telegramContext: false, longTermMemory: false, sandalphonState: false },
      enabledContextSources: { storySummary: true, recentMessages: true, telegramContext: false, vectorMemory: false },
      worldbookIds: list(s.worldbookIds), presetIds: list(s.presetIds), openingId: s.openingId || null,
      canonLevel: s.canonLevel || 'alternate', status: s.status || 'active',
      messages: arr(s.messages).map(normalizeMessage),
      pendingGeneration: s.pendingGeneration&&typeof s.pendingGeneration==='object'?clone(s.pendingGeneration):null,
      legacyMemoryQuarantined:s.legacyMemoryQuarantined===true, promptLineageProjection:s.promptLineageProjection===true, archivedBranches: arr(s.archivedBranches), deletedMessages: arr(s.deletedMessages).map(normalizeMessage),
      summary: text(s.summary), rollingSummary: text(s.rollingSummary || s.summary), longSummary: text(s.longSummary),
      sceneSummary: text(s.sceneSummary), characterPsychSummary: text(s.characterPsychSummary), relationshipSummary: text(s.relationshipSummary),
      unresolvedHooks: list(s.unresolvedHooks), pinnedFacts: list(s.pinnedFacts),
      rollingArchive:arr(s.rollingArchive).slice(-8).map(a=>({savedAt:String(a.savedAt||''),summary:String(a.summary||''),rollingSummary:String(a.rollingSummary||''),longSummary:String(a.longSummary||''),lastSummarizedIndex:Math.max(0,Number(a.lastSummarizedIndex)||0),rollingSourceCount:Math.max(0,Number(a.rollingSourceCount)||0),rollingSourceFingerprint:String(a.rollingSourceFingerprint||''),rollingVerification:normalizeMemoryVerification(a.rollingVerification)})),
      lastSummarizedIndex: Number.isFinite(Number(s.lastSummarizedIndex)) ? Number(s.lastSummarizedIndex) : 0,rollingSourceCount:Math.max(0,Number(s.rollingSourceCount)||0),rollingSourceFingerprint:String(s.rollingSourceFingerprint||''),rollingVerification:normalizeMemoryVerification(s.rollingVerification),
      tags: list(s.tags), lastScene: text(s.lastScene), userNotes: text(s.userNotes), aiNotes: text(s.aiNotes),
      directorNote: text(s.directorNote), storyState: s.storyState && typeof s.storyState === 'object' ? s.storyState : {},
      promptSettings: normalizePromptSettings({...s.promptSettings,...(arr(s.messages).length&&!s.promptSettings?.inputSemanticMode&&!s.promptSettings?.legacyInputSemanticMode?{legacyInputSemanticMode:'auto'}:{})}),
      manualMemory: normalizeManualMemory(s.manualMemory || {}),
      customCssId: s.customCssId || null, customCssEnabled: s.customCssEnabled !== false,
      regexPackIds: list(s.regexPackIds),
      renderMode: s.renderMode || 'text'
    };
  }

  function normalizeMask(m = {}) {
    const createdAt = m.createdAt || nowIso();
    const type = text(m.type || m.kind || 'character') === 'user' ? 'user' : 'character';
    return {
      id: m.id || makeId('mask'), type, name: text(m.name || '未命名面具'), source: text(m.source || 'manual'),
      description: text(m.description), content: text(m.content || m.persona || m.description), scenario: text(m.scenario),
      firstMessage: text(m.firstMessage || m.first_mes), exampleDialogue: text(m.exampleDialogue || m.mes_example),
      creatorNotes: text(m.creatorNotes || m.creator_notes), avatar: text(m.avatar), aliases: list(m.aliases), tags: list(m.tags),
      enabled: m.enabled !== false, createdAt, updatedAt: m.updatedAt || createdAt
    };
  }

  function normalizePreset(p = {}) {
    const createdAt = p.createdAt || nowIso();
    return { id: p.id || makeId('preset'), name: text(p.name || '未命名预设'), type: text(p.type || 'style'),
      description: text(p.description), content: text(p.content), priority: Number.isFinite(Number(p.priority)) ? Number(p.priority) : 50,
      enabled: p.enabled !== false, createdAt, updatedAt: p.updatedAt || createdAt };
  }

  function normalizeCssPreset(p = {}) {
    const createdAt = p.createdAt || nowIso();
    const legacyScope=['story','global','app'].includes(p.scope)?p.scope:(['novel','assistant','chat'].includes(p.scope)?p.scope:'story');
    const inferredSurface=legacyScope==='app'?'global':(legacyScope==='novel'?'novel':(legacyScope==='assistant'?'assistant':'chat'));
    const surface=['global','chat','novel','assistant'].includes(p.surface)?p.surface:inferredSurface;
    return { id:p.id || makeId('css'), name:text(p.name || '未命名 CSS'), css:String(p.css || ''), scope:legacyScope, surface, createdAt, updatedAt:p.updatedAt || createdAt };
  }

  function normalizeWorldbookEntry(e = {}) {
    const createdAt = e.createdAt || nowIso();
    return { id: e.id || makeId('wbe'), name: text(e.name || '未命名条目'), content: text(e.content),
      keywords: list(e.keywords), secondaryKeywords: list(e.secondaryKeywords), enabled: e.enabled !== false,
      alwaysActive: !!e.alwaysActive, matchMode: e.matchMode === 'all' ? 'all' : 'any', caseSensitive: !!e.caseSensitive,
      useRegex: !!e.useRegex, priority: Number.isFinite(Number(e.priority)) ? Number(e.priority) : 50,
      scanDepth: clampInt(e.scanDepth, 1, 200, 12), depth: clampInt(e.depth, 0, 200, 0),
      position: ['front','middle','back'].includes(e.position) ? e.position : 'middle',
      maxChars: clampInt(e.maxChars, 0, 100000, 0), createdAt, updatedAt: e.updatedAt || createdAt };
  }


  function normalizeRegexPack(p = {}) {
    if (window.MimaRegexEngine?.normalizePack) return window.MimaRegexEngine.normalizePack(p);
    const createdAt = p.createdAt || nowIso();
    return { id:p.id||makeId('regexp'), name:text(p.name||'未命名正则包'), description:text(p.description), priority:Number.isFinite(Number(p.priority))?Number(p.priority):50, enabled:p.enabled!==false, rules:arr(p.rules), createdAt, updatedAt:p.updatedAt||createdAt };
  }

  function normalizeWorldbook(w = {}) {
    const createdAt = w.createdAt || nowIso();
    return { id: w.id || makeId('wb'), name: text(w.name || '未命名世界书'), description: text(w.description),
      enabled: w.enabled !== false, entries: arr(w.entries).map(normalizeWorldbookEntry), tags: list(w.tags),
      createdAt, updatedAt: w.updatedAt || createdAt };
  }

  function normalizeState(raw = {}) {
    return {
      schemaVersion: 4, storeRevision: Math.max(0,Number(raw.storeRevision)||0),
      sessions: arr(raw.sessions).map(normalizeSession), masks: arr(raw.masks).map(normalizeMask),
      presets: arr(raw.presets).map(normalizePreset), worldbooks: arr(raw.worldbooks).map(normalizeWorldbook), cssPresets: arr(raw.cssPresets).map(normalizeCssPreset),
      regexPacks: arr(raw.regexPacks).map(normalizeRegexPack),
      novelProjects: arr(raw.novelProjects).map(x=>window.MimaNovelEngine?.normalizeProject?window.MimaNovelEngine.normalizeProject(x):x),
      themeSettings: window.MimaThemeEngine?.normalizeSettings?window.MimaThemeEngine.normalizeSettings(raw.themeSettings||{}):{theme:'default',updatedAt:''}
    };
  }

  async function persist() {
    const snapshot=clone(state), revision=Number(state.storeRevision)||0;
    try {
      const committed=await window.MimaLocalStore.saveState(snapshot,revision);
      // Concurrent writers must not restore a stale in-memory snapshot after commit.
      state.storeRevision=committed.storeRevision;
      return committed;
    } catch(e) {
      // Reload only verified persisted data; never initialize blank state on read failure.
      state=normalizeState(await window.MimaLocalStore.loadState());
      throw e;
    }
  }
  async function init() {
    state = normalizeState(await window.MimaLocalStore.loadState());window.MimaThemeEngine?.apply?.(state.themeSettings);
    // Browser-only startup: pick up a crashed Rolling job after its durable
    // owner lease has expired. A surviving other tab keeps its lease; no dual
    // settlement, and nothing here blocks a user's Direct Reply.
    if(typeof document!=='undefined'&&typeof window.MimaLocalStore?.getMemoryJob==='function')
      setTimeout(()=>resumeExpiredRollingJobs().catch(e=>console.warn('Memory recovery scan failed',{code:e.code||e.message,stage:'startup_scan'})),0);
    return state;
  }

  function getSession(id) { return state.sessions.find(x => x.id === id); }
  function getMask(id) { return state.masks.find(x => x.id === id); }
  // Keep disabled resources in canonical storage; only the prompt and retrieval
  // layers must respect their enabled state. Never erase a mounted mask ID.
  function enabledMask(id) { const mask=id?getMask(id):null; return mask&&mask.enabled!==false?mask:null; }
  function getPreset(id) { return state.presets.find(x => x.id === id); }
  function getWorldbook(id) { return state.worldbooks.find(x => x.id === id); }
  function getCssPreset(id) { return state.cssPresets.find(x => x.id === id); }
  function getRegexPack(id) { return state.regexPacks.find(x => x.id === id); }
  function getNovel(id) { return state.novelProjects.find(x => x.id === id); }

  function sessionSummaries() {
    return state.sessions.map(s => ({ id:s.id,title:s.title,mode:s.mode,canonLevel:s.canonLevel,status:s.status,updatedAt:s.updatedAt,
      createdAt:s.createdAt,messageCount:s.messages.length,presetIds:s.presetIds,worldbookIds:s.worldbookIds,
      loadedUserMaskId:s.loadedUserMaskId,loadedCharMaskId:s.loadedCharMaskId,regexPackIds:s.regexPackIds }))
      .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  // In one tab, A and B may finish independently. Both must start their
  // canonical write from the latest verified snapshot, not a shared stale
  // global `state`. Serialize only the short save transaction, never Provider
  // generation: Direct Reply for each session remains independent.
  let sessionSaveTail=Promise.resolve();
  function saveSession(s,{allowCreate=false,signal=null}={}) {
    const requested=clone(s);
    const commit=async()=>{
      if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
      const persisted=normalizeState(await window.MimaLocalStore.loadState());
      if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
      const normalized=normalizeSession({...requested,updatedAt:nowIso()});
      const i=persisted.sessions.findIndex(x=>x.id===normalized.id);
      if(i<0&&!allowCreate)throw new ApiError('E_STORY_SESSION_MISSING','Session 已删除，旧请求不得复活它');
      if(i>=0&&Number(persisted.sessions[i].recordRevision)!==Number(normalized.recordRevision))
        throw new ApiError('E_CANONICAL_CONFLICT','当前剧情已发生新修改，本轮旧结果未提交');
      normalized.recordRevision++;
      if(i>=0)persisted.sessions[i]=normalized;else persisted.sessions.push(normalized);
      // CAS protects other tabs and the independent memory ledger. A conflict
      // is surfaced rather than overwritten; no fallback to blank storage.
      const committed=await window.MimaLocalStore.saveState(persisted,Number(persisted.storeRevision)||0,{signal});
      state=normalizeState(committed);
      s.recordRevision=normalized.recordRevision;
      return normalized;
    };
    const task=sessionSaveTail.then(commit,commit);
    sessionSaveTail=task.then(()=>{},()=>{});
    return task;
  }
  async function saveMask(m) { const n=normalizeMask({ ...m, updatedAt:nowIso() }); const i=state.masks.findIndex(x=>x.id===n.id); if(i>=0)state.masks[i]=n;else state.masks.push(n); await persist(); return n; }
  async function savePreset(p) { const n=normalizePreset({ ...p, updatedAt:nowIso() }); const i=state.presets.findIndex(x=>x.id===n.id); if(i>=0)state.presets[i]=n;else state.presets.push(n); await persist(); return n; }
  async function saveWorldbook(w) { const n=normalizeWorldbook({ ...w, updatedAt:nowIso() }); const i=state.worldbooks.findIndex(x=>x.id===n.id); if(i>=0)state.worldbooks[i]=n;else state.worldbooks.push(n); await persist(); return n; }
  async function saveCssPreset(p) { const n=normalizeCssPreset({ ...p, updatedAt:nowIso() }); const i=state.cssPresets.findIndex(x=>x.id===n.id); if(i>=0)state.cssPresets[i]=n;else state.cssPresets.push(n); await persist(); return n; }
  async function saveRegexPack(p) { const checked=window.MimaRegexEngine?.validatePack?window.MimaRegexEngine.validatePack(p):{ok:true,pack:normalizeRegexPack(p),invalid:[]}; if(!checked.ok)throw new ApiError('E_REGEX_INVALID',`正则包含无效规则：${checked.invalid.map(x=>`${x.name}: ${x.error}`).join('；')}`,{hint:'请检查 Pattern（匹配式）与 Flags（标志）；无效规则不会被静默保存。'}); const n=normalizeRegexPack({ ...checked.pack, updatedAt:nowIso() }); const i=state.regexPacks.findIndex(x=>x.id===n.id); if(i>=0)state.regexPacks[i]=n;else state.regexPacks.push(n); await persist(); return n; }
  async function saveNovelProject(p,{allowCreate=false}={}) {
    if(!window.MimaNovelEngine)throw new Error('Novel Engine 未加载');
    const n=window.MimaNovelEngine.normalizeProject({...p,updatedAt:nowIso()});
    const i=state.novelProjects.findIndex(x=>x.id===n.id);
    if(i<0 && !allowCreate)throw new ApiError('E_CANONICAL_STALE','小说已删除，迟到结果不允许重新创建');
    if(i>=0 && Number(state.novelProjects[i].recordRevision)!==Number(n.recordRevision))throw new ApiError('E_CANONICAL_STALE','小说正文/章节/草稿已更新，旧异步结果不能覆盖新编辑');
    n.recordRevision++;
    if(i>=0)state.novelProjects[i]=n;else state.novelProjects.push(n);
    await persist();p.recordRevision=n.recordRevision;return n;
  }
  async function saveThemeSettings(input={}) { state.themeSettings=window.MimaThemeEngine?.normalizeSettings?window.MimaThemeEngine.normalizeSettings({...state.themeSettings,...input,updatedAt:nowIso()}):{theme:text(input.theme||'default'),updatedAt:nowIso()}; window.MimaThemeEngine?.apply?.(state.themeSettings); await persist(); return clone(state.themeSettings); }

  // ---------- Prompt Assembler ----------
  const asText = v => String(v || '').trim();
  const clip = (t,max=0) => { const s=asText(t); return max>0&&s.length>max ? `${s.slice(0,max)}\n[…已按条目预算截断…]` : s; };
  function macroContext(sessionOrId){
    const session=typeof sessionOrId==='string'?getSession(sessionOrId):sessionOrId;
    const userMask=session?.loadedUserMaskId?getMask(session.loadedUserMaskId):null;
    const charMask=session?.loadedCharMaskId?getMask(session.loadedCharMaskId):null;
    return {userName:asText(userMask?.name)||'你',charName:asText(charMask?.name)||'角色'};
  }
  function resolveMacrosForSession(sessionOrId,input){
    const raw=String(input??'');
    if(!window.MimaPersonaMacroResolver?.resolve)return raw;
    return window.MimaPersonaMacroResolver.resolve(raw,macroContext(sessionOrId));
  }
  function activeRegexPacks(session){return arr(session?.regexPackIds).map(getRegexPack).filter(p=>p&&p.enabled!==false).sort((a,b)=>Number(a.priority??50)-Number(b.priority??50));}
  function applyRegexForSession(sessionOrId,input,phase='display',diagnostics=null){const session=typeof sessionOrId==='string'?getSession(sessionOrId):sessionOrId;if(!session)return String(input??'');const transformed=window.MimaRegexEngine?.apply?window.MimaRegexEngine.apply(String(input??''),activeRegexPacks(session),phase,diagnostics):String(input??'');return phase==='display'||phase==='prompt'?resolveMacrosForSession(session,transformed):transformed;}
  function messagePromptContent(m,session){return applyRegexForSession(session,m?.content||'', 'prompt');}
  function inputSemanticMode(session,message=null){
    const stored=message?.metadata?.inputSemanticMode;
    if(['auto','dialogue_first','quote_dialogue','raw'].includes(stored))return stored;
    const configured=message&&!stored?(session?.promptSettings?.legacyInputSemanticMode||session?.promptSettings?.inputSemanticMode):session?.promptSettings?.inputSemanticMode;
    return ['auto','dialogue_first','quote_dialogue','raw'].includes(configured)?configured:'raw';
  }
  function compileUserInputForPrompt(sessionOrId,input,modeOverride=null){
    const session=typeof sessionOrId==='string'?getSession(sessionOrId):sessionOrId;
    const mode=modeOverride||inputSemanticMode(session);
    const raw=mode==='raw'?String(input??''):resolveMacrosForSession(session,String(input??''));
    if(mode==='raw'||!window.MimaUserInputSemanticParser?.compile)return raw;
    return window.MimaUserInputSemanticParser.compile(raw,{mode}).prompt;
  }
  function userMessagePromptContent(m,session){
    const content=window.MimaRegexEngine?.apply?window.MimaRegexEngine.apply(String(m?.content??''),activeRegexPacks(session),'prompt'):String(m?.content??'');
    return compileUserInputForPrompt(session,content,inputSemanticMode(session,m));
  }
  function keywordMatches(hay, keyword, entry) {
    const k=String(keyword||'').trim(); if(!k)return false;
    if(entry.useRegex){ try{return new RegExp(k,entry.caseSensitive?'u':'iu').test(String(hay||''));}catch(_){return false;} }
    const a=entry.caseSensitive?String(hay||''):String(hay||'').toLocaleLowerCase();
    const b=entry.caseSensitive?k:k.toLocaleLowerCase(); return a.includes(b);
  }
  function entryActivation(entry, session) {
    if(!entry||entry.enabled===false||!asText(entry.content))return {active:false,reason:'disabled_or_empty'};
    if(entry.alwaysActive)return {active:true,reason:'always'};
    const scanDepth=Math.max(1,Number(entry.scanDepth||12));
    const hay=(session.messages||[]).filter(m=>m?.content&&m.role!=='system'&&m.role!=='director').slice(-scanDepth).map(m=>m.content).join('\n');
    const primary=arr(entry.keywords).filter(Boolean), secondary=arr(entry.secondaryKeywords).filter(Boolean);
    if(!primary.length)return {active:false,reason:'no_keyword'};
    const hits=primary.filter(k=>keywordMatches(hay,k,entry));
    const primaryOk=entry.matchMode==='all'?hits.length===primary.length:hits.length>0;
    if(!primaryOk)return {active:false,reason:'primary_miss',hits};
    if(secondary.length){const secondaryHits=secondary.filter(k=>keywordMatches(hay,k,entry)); if(!secondaryHits.length)return {active:false,reason:'secondary_miss',hits,secondaryHits}; return {active:true,reason:'keyword',hits,secondaryHits};}
    return {active:true,reason:'keyword',hits};
  }
  function mountedWorldbooks(session){return arr(session.worldbookIds).map(getWorldbook).filter(w=>w&&w.enabled!==false);}
  // Priority determines sending order: lower numbers first, including 0.
  // Equal priorities retain this session's mount order. This does not assign
  // provider weights or automatically resolve conflicts in free-text rules.
  function sortedPresets(session){return arr(session.presetIds).map(getPreset).filter(p=>p&&p.enabled!==false).sort((a,b)=>Number(a.priority??50)-Number(b.priority??50));}
  function collectWorldbookEntries(session){const matched=[],skipped=[];for(const book of mountedWorldbooks(session)){for(const entry of arr(book.entries)){const activation=entryActivation(entry,session),item={book,entry,activation};(activation.active?matched:skipped).push(item);}}matched.sort((a,b)=>Number(a.entry.depth||0)-Number(b.entry.depth||0)||Number(a.entry.priority??50)-Number(b.entry.priority??50));return {matched,skipped};}
  function formatMask(mask,kind){if(!mask)return'';const blocks=[`【${kind==='user'?'当前玩家 Persona':'当前角色 Persona'}：${mask.name}】`];if(mask.description)blocks.push(`简介：${mask.description}`);
    // normalizeMask intentionally keeps legacy content = description fallback.
    // Never send that same fallback a second time in one provider request.
    if(mask.content&&mask.content.trim()!==mask.description.trim())blocks.push(mask.content);
    if(mask.scenario&&kind==='character')blocks.push(`【角色卡 Scenario】\n${mask.scenario}`);if(mask.exampleDialogue&&kind==='character')blocks.push(`【Example Dialogue】\n${mask.exampleDialogue}`);return blocks.join('\n');}
  function joinWb(items,label){if(!items.length)return'';return `【Worldbook · ${label}】\n`+items.map(({book,entry})=>`【${book.name} / ${entry.name}】\n${clip(entry.content,entry.maxChars)}`).join('\n\n');}
  function buildSystemPrompt(session,options={},matched=[]){
    const front=matched.filter(x=>Number(x.entry.depth||0)===0&&x.entry.position==='front');
    const middle=matched.filter(x=>Number(x.entry.depth||0)===0&&x.entry.position==='middle');
    const back=matched.filter(x=>Number(x.entry.depth||0)===0&&x.entry.position==='back');
    const chunks=[],sections=[];const add=(name,content,source={})=>{const resolved=String(resolveMacrosForSession(session,content)??'');if(!resolved.trim())return;chunks.push(resolved);sections.push({name,chars:resolved.length,content:resolved,source:{kind:name.includes('memory')||name.includes('summary')?'memory':name.startsWith('worldbook')?'world_info':name.includes('persona')?'persona':name==='director_note'?'director_note':'player_material',sourceId:name,section:name,...source}});};
    const ps=sortedPresets(session);for(const preset of ps)add('presets',preset.content,{kind:'preset',sourceId:preset.id,resourceId:preset.id,name:preset.name,priority:preset.priority});
    add('worldbook_front',joinWb(front,'System Front'),{sourceId:front.map(x=>x.entry.id).join(','),resourceId:front.map(x=>x.book.id).join(',')});
    if(session.loadedUserMaskId)add('user_persona',formatMask(enabledMask(session.loadedUserMaskId),'user'),{sourceId:session.loadedUserMaskId,resourceId:session.loadedUserMaskId});
    if(session.loadedCharMaskId)add('character_persona',formatMask(enabledMask(session.loadedCharMaskId),'character'),{sourceId:session.loadedCharMaskId,resourceId:session.loadedCharMaskId});
    add('worldbook_middle',joinWb(middle,'System Middle'),{sourceId:middle.map(x=>x.entry.id).join(','),resourceId:middle.map(x=>x.book.id).join(',')});
    if(session.promptSettings?.pinnedFactsEnabled!==false&&session.pinnedFacts?.length)add('pinned_facts',`【Pinned Facts】\n${session.pinnedFacts.map(x=>`- ${x}`).join('\n')}`);
    if(options.excludeRollingSummary!==true&&session.promptSettings?.summaryEnabled!==false&&(!session.rollingSourceFingerprint?!(session.legacyMemoryQuarantined||session.promptLineageProjection):session.rollingSourceCount>0&&session.messages.length>=session.rollingSourceCount&&memorySourceFingerprint(session.messages,session.rollingSourceCount)===session.rollingSourceFingerprint)&&(session.rollingSummary||session.summary||session.longSummary))add('story_summary',`【剧情摘要 / Rolling Summary】\n${session.rollingSummary||session.summary||session.longSummary}`);
    const memory=normalizeManualMemory(session.manualMemory||{});const memoryTrace=[];
    const coreValid=memorySourceValid(session,memory.core)&&(memory.core.source!=='facts'||!memory.core.sourceFactsHash||fingerprint(memory.facts)===memory.core.sourceFactsHash);
    memoryTrace.push({kind:'core',verification:memory.core.verification.status,sourceCount:memory.core.sourceCount,source:memory.core.source,chars:memory.core.content.length,injected:!!(memory.settings.injectCore&&memory.core.content&&coreValid),reason:!coreValid?'stale_source':!memory.settings.injectCore?'disabled':memory.core.content?'included':'empty'});
    if(memory.settings.injectCore&&memory.core.content&&coreValid){
      const trust=memory.core.verification.status;
      const label=trust==='human_confirmed'?'玩家亲自确认':trust==='extractive_verified'?'已逐字核对原文':trust==='source_bounded'?'来自原文的有界意译，尚非独立证实事实':'未核实旧资料，仅供剧情参考';
      add('manual_core_memory',`【核心记忆 / Core Memory】【可信等级：${label}】\n${memory.core.content}`);
    }
    if(memory.settings.injectFacts&&memory.facts.length){
      const selected=memory.facts.filter(f=>memorySourceValid(session,f)).sort((a,b)=>Number(a.endRound||0)-Number(b.endRound||0)||String(a.updatedAt||'').localeCompare(String(b.updatedAt||''))).slice(-memory.settings.factInjectionLimit);
      memoryTrace.push(...memory.facts.map(f=>({kind:'fact',verification:f.verification.status,id:f.id,sourceCount:f.sourceCount,startRound:f.startRound,endRound:f.endRound,chars:f.content.length,injected:selected.some(x=>x.id===f.id),reason:!memorySourceValid(session,f)?'stale_source':selected.some(x=>x.id===f.id)?'included':'injection_limit'})));
      if(selected.length)add('manual_fact_memories',`【事实记忆 / Fact Memories】\n${selected.map(x=>{
        const trust=x.verification.status;
        const label=trust==='human_confirmed'?'玩家确认':trust==='extractive_verified'?'原文摘录已校验':trust==='source_bounded'?'有界意译待逐条核实':'未核实旧资料';
        return `【第 ${x.startRound}–${x.endRound} 轮 · ${label}】\n${x.content}`;
      }).join('\n\n')}`);
    }
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.sceneSummary)add('scene_summary',`【当前场景摘要】\n${session.sceneSummary}`);
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.characterPsychSummary)add('character_psych',`【角色心理状态摘要】\n${session.characterPsychSummary}`);
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.relationshipSummary)add('relationship_summary',`【关系变化摘要】\n${session.relationshipSummary}`);
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.unresolvedHooks?.length)add('unresolved_hooks',`【未解决伏笔】\n${session.unresolvedHooks.map(x=>`- ${x}`).join('\n')}`);
    if(session.userNotes)add('user_notes',`【玩家备注】\n${session.userNotes}`);
    if(session.aiNotes)add('ai_notes',`【AI 备注】\n${session.aiNotes}`);
    add('worldbook_back',joinWb(back,'System Back'),{sourceId:back.map(x=>x.entry.id).join(','),resourceId:back.map(x=>x.book.id).join(',')});
    if(options.directorNote||session.directorNote)add('director_note',options.directorNote||session.directorNote);
    return {prompt:chunks.join('\n\n'),sections,memoryTrace};
  }
  function toHistoryMessage(m,session){
    if(!m?.content)return null;
    // Preserve legacy evidence in canonical/version storage, but never replay
    // a positively identified provider refusal as character dialogue.
    if(m.role==='assistant'&&classifyStoryReply(m.rawContent||m.content).blocked)return null;
    const content=m.role==='user'?userMessagePromptContent(m,session):messagePromptContent(m,session);
    const role=['system','user','assistant'].includes(m.role)?m.role:'system';
    return {role,content,source:{kind:'canonical_history',sourceId:m.id,messageId:m.id,originalRole:m.role}};
  }
  function applyDepth(history,items,session){
    const result=history.slice(),debug=[];
    const sorted=items.slice().sort((a,b)=>Number(b.entry.depth||0)-Number(a.entry.depth||0)||Number(a.entry.priority??50)-Number(b.entry.priority??50));
    for(const {book,entry} of sorted){
      const depth=Math.max(1,Number(entry.depth||1)),anchor=Math.max(0,result.length-depth);
      let index=entry.position==='front'?Math.max(0,anchor-1):entry.position==='back'?Math.min(result.length,anchor+1):anchor;
      // Reference data never impersonates a player turn or displaces the latest real input.
      let lastUser=-1;for(let i=result.length-1;i>=0;i--)if(result[i].source?.kind==='canonical_history'&&result[i].role==='user'){lastUser=i;break;}
      if(lastUser>=0)index=Math.min(index,lastUser);
      const content=resolveMacrosForSession(session,clip(entry.content,entry.maxChars));
      result.splice(index,0,{role:'system',content,source:{kind:'world_info',sourceId:entry.id,resourceId:book.id,name:entry.name,depth,position:entry.position}});
      debug.push({bookId:book.id,bookName:book.name,entryId:entry.id,entryName:entry.name,depth,position:entry.position,insertedAt:index,transportRole:'system',chars:content.length});
    }
    return {messages:result,debug};
  }
  function enforceBudget(matched,budget){let used=0;const kept=[],dropped=[];const sorted=matched.slice().sort((a,b)=>Number(a.entry.priority??50)-Number(b.entry.priority??50)||Number(a.entry.depth||0)-Number(b.entry.depth||0));
    for(const item of sorted){const cost=clip(item.entry.content,item.entry.maxChars).length;
      if(used+cost<=budget){kept.push(item);used+=cost;}
      else dropped.push({...item,activation:{...item.activation,reason:'budget',neededChars:cost,remainingChars:Math.max(0,budget-used)}});
    }return{kept,dropped,used};}
  // The complete source chronology remains in the canonical session. Projection
  // is a traceable retrieval operation, NEVER a mutation of History. An
  // unknown provider context is NOT a verified 32k provider limit. The 32k
  // estimate may govern optional old-history retrieval, never block mandatory
  // Persona/Worldbook/recent History before the provider sees it.
  function promptBudget(){
    const cfg=getApiConfig(),configured=Number(cfg.contextWindowTokens);
    const verified=Number.isFinite(configured)&&configured>=4096;
    if(!verified){
      const provisionalWindow=32768;
      const provisionalReserve=Math.max(1024,Number(cfg.maxTokens)>0?Math.floor(Number(cfg.maxTokens)):4096);
      return {windowTokens:null,reserve:null,usable:null,verified:false,
        provisionalRetrievalTokens:Math.max(0,Math.floor(provisionalWindow*.85)-provisionalReserve)};
    }
    const windowTokens=Math.floor(configured);
    const reserve=Math.max(1024,Number(cfg.maxTokens)>0?Math.floor(Number(cfg.maxTokens)):Math.min(4096,Math.floor(windowTokens*.5)));
    const usable=Math.floor(windowTokens*.85)-reserve;
    if(usable<=0)throw new ApiError('E_CONTEXT_BUDGET_CONFIG','配置的最大输出 Tokens 已占满模型上下文窗口；请求没有合法输入预算。',{
      details:JSON.stringify({windowTokens,reservedOutputTokens:reserve,maxTokens:cfg.maxTokens,availableInputTokens:usable,windowVerified:true}),
      hint:'请核实提供商的真实上下文窗口与最大输出额度，在 API 设置中自行修正；不会自动改变设置或删减剧情。'});
    return {windowTokens,reserve,usable,verified:true,provisionalRetrievalTokens:null};
  }
  function retrievalTerms(input){
    const source=String(input||'').toLowerCase(),pieces=(source.match(/[\p{Script=Han}]{2,}|[a-z0-9_]{3,}/gu)||[]);
    const terms=new Set();for(const part of pieces){
      if(/[\p{Script=Han}]/u.test(part)){for(let i=0;i<part.length-1;i++)terms.add(part.slice(i,i+2));}
      else terms.add(part);
    }
    return [...terms].filter(x=>!['剧情','角色','继续','主人','回复','这样','发生','故事','之后','可以'].includes(x)).slice(0,120);
  }
  function retrieveRawGap(session,history,coreCount,anchor,available){
    const older=history.slice(0,Math.max(0,history.length-coreCount));
    if(!older.length||available<=0)return {chosen:[],omitted:older,usedTokens:0,terms:[]};
    const terms=retrievalTerms(anchor),generic=!terms.length,atoms=[];
    // Whole player/assistant turns are the minimum retrieval unit; do not
    // manufacture an isolated assistant answer without its triggering turn.
    for(let i=0;i<older.length;){
      const pair=older[i]?.role==='user'&&older[i+1]?.role==='assistant';
      const group=older.slice(i,i+(pair?2:1));i+=group.length;
      const rows=group.map(m=>({m,projected:toHistoryMessage(m,session)}));
      const content=group.map(m=>String(m.rawContent||m.content||'')).join('\n');
      const cost=rows.reduce((n,r)=>n+(r.projected?estimateTokens(r.projected.content)+10:0),0);
      atoms.push({rows,index:i-group.length,content,cost,createdAt:group[0]?.createdAt||'',
        pinned:group.some(m=>m.metadata?.pinned===true)});
    }
    const engine=globalThis.MimaHistorySearch;
    // Explicit aliases belong to the mounted local masks. They are query
    // synonyms only, not additional character knowledge or canonical facts.
    const aliases={};
    for(const id of [session.loadedCharMaskId,session.loadedUserMaskId]){
      const mask=enabledMask(id);
      if(mask?.name&&Array.isArray(mask.aliases)&&mask.aliases.length){
        aliases[mask.name]=mask.aliases;
      }
    }
    const rankings=engine?.rank?.(anchor,atoms.map((a,i)=>({id:i,text:a.content,createdAt:a.createdAt})),{aliases})||[];
    const byRank=new Map(rankings.map(x=>[x.id,x.score]));
    const event=/藏在|藏入|埋在|送给|交给|交付|约定|承诺|誓言|答应|秘密|线索|发现|失踪|得知|决定|钥匙|项链|戒指|地图|地址|位置|身份|十年前|回忆|记得|遗忘|失去|夺走|留下|带走|交代|保管|never|promise|hid|gave|revealed|remember/iu;
    for(const [idx,item] of atoms.entries()){
      const lexical=byRank.get(idx)??terms.reduce((n,t)=>n+(item.content.toLowerCase().includes(t)?1:0),0);
      item.score=(item.pinned?100:0)+(generic?(event.test(item.content)?12:0)+(item.index===0?2:0):lexical*5);
    }
    atoms.sort((a,b)=>b.score-a.score||(generic?a.index-b.index:b.index-a.index));
    const cap=generic?Math.min(available,Math.max(350,Math.floor(available*.35))):available;
    let usedTokens=0;const chosenAtoms=[];
    for(const atom of atoms){if(atom.score<=0||usedTokens+atom.cost>cap)continue;chosenAtoms.push(atom);usedTokens+=atom.cost;}
    chosenAtoms.sort((a,b)=>a.index-b.index);
    const chosen=chosenAtoms.flatMap(a=>a.rows.map((row,j)=>({...row,index:a.index+j})));
    const chosenIds=new Set(chosen.map(x=>x.m.id));
    return {chosen,omitted:older.filter(m=>!chosenIds.has(m.id)),usedTokens,terms};
  }
  function assemble(sessionInput,options={}){
    const session=normalizeSession(sessionInput),activation=collectWorldbookEntries(session);
    const budget=Math.max(1000,Number(session.promptSettings?.worldbookBudgetChars||16000)),budgeted=enforceBudget(activation.matched,budget),matched=budgeted.kept;
    const worldbookMountTrace=arr(session.worldbookIds).map(id=>{const book=getWorldbook(id);return {bookId:id,bookName:book?.name||'',mounted:true,enabled:book?.enabled!==false&&!!book,reason:!book?'missing_book':book.enabled===false?'disabled_book':'enabled'};});
    const maskTrace=[{kind:'character',id:session.loadedCharMaskId},{kind:'user',id:session.loadedUserMaskId}].map(x=>{const mask=x.id?getMask(x.id):null;return {kind:x.kind,id:x.id||null,loaded:!!mask,enabled:!!mask&&mask.enabled!==false,injected:!!enabledMask(x.id),reason:!x.id?'not_mounted':!mask?'missing_mask':mask.enabled===false?'disabled':'included',name:mask?.name||'',chars:mask&&mask.enabled!==false?formatMask(mask,x.kind).length:0};});
    const presetTrace=arr(session.presetIds).map(id=>{const preset=getPreset(id);return {id,name:preset?.name||'',priority:preset?.priority??null,mounted:true,enabled:!!preset&&preset.enabled!==false,injected:!!preset&&preset.enabled!==false&&!!text(preset.content),role:'system',reason:!preset?'missing_preset':preset.enabled===false?'disabled':!text(preset.content)?'empty':'included',chars:preset?.content?.length||0};});
    // R11: Project the entire canonical History when the configured model can
    // carry it. A fixed recentMessageLimit governs background summarization,
    // never truncates a sufficiently large model's input.
    const promptCap=promptBudget(),visibleHistory=session.messages.filter(m=>m.role!=='director');
    const limit=Math.max(6,Number(session.promptSettings?.recentMessageLimit||34));
    const depthOnly=matched.filter(x=>Number(x.entry.depth||0)>0);
    let sys=buildSystemPrompt(session,{...options,excludeRollingSummary:true},matched);
    let recentRaw=visibleHistory.slice(),projectedAway=[],estimatedBase=null;
    // Reserve a margin for JSON encoding, message roles, and protocol overhead.
    // Context estimates are intentionally marked as estimates in the Inspector.
    const baseTokens=(raw,system)=>{
      const current=raw.map(m=>toHistoryMessage(m,session)).filter(Boolean);
      const inserted=applyDepth(current,depthOnly,session);
      return estimateTokens(system.prompt)+inserted.messages.reduce((n,m)=>n+estimateTokens(m.content)+8,0)+Math.max(160,Math.ceil(system.prompt.length*.08));
    };
    function discardOldestCompleteTurn(){
      if(recentRaw.length<=2)return false;
      // Player+reply are an indivisible turn; an initial assistant greeting is
      // its own atom. No source messages or store records are ever deleted.
      let count=recentRaw[0]?.role==='user'&&recentRaw[1]?.role==='assistant'?2:1;
      if(recentRaw.length-count<2)return false;
      const removed=recentRaw.slice(0,count);
      projectedAway.push(...removed);recentRaw=recentRaw.slice(count);
      if(estimatedBase!==null)estimatedBase-=removed.reduce((n,m)=>n+estimateTokens(toHistoryMessage(m,session)?.content||'')+8,0);
      return true;
    }
    if(promptCap.verified){
      estimatedBase=baseTokens(recentRaw,sys);
      while(estimatedBase>promptCap.usable){if(!discardOldestCompleteTurn()){
        throw new ApiError('E_CONTEXT_BUDGET_BASE','当前人物设定、世界书和最新剧情已经超过模型已配置的输入窗口，无法在不破坏必需内容的情况下发送。',{
          details:JSON.stringify({stage:'r11_full_history',windowTokens:promptCap.windowTokens,usableTokens:promptCap.usable,estimatedTokens:estimatedBase,temporarilyOmittedCount:projectedAway.length}),
          hint:'请核实模型上下文窗口或由玩家主动调整设置。原始 History、Persona、世界书均未修改。'});
      }}
      if(projectedAway.length){
        // Confirm actual depth-inserted projection at the boundary, without
        // rescanning all 3000 turns on every discard.
        estimatedBase=baseTokens(recentRaw,sys);
        while(estimatedBase>promptCap.usable){if(!discardOldestCompleteTurn())throw new ApiError('E_CONTEXT_BUDGET_BASE','最新原始剧情超过已配置窗口，已保留本地 History。');}
        // Use a trusted-source rolling summary only when original history has
        // actually been left out of this particular provider request.
        sys=buildSystemPrompt(session,options,matched);
        estimatedBase=baseTokens(recentRaw,sys);
        while(estimatedBase>promptCap.usable){if(!discardOldestCompleteTurn()){
          throw new ApiError('E_CONTEXT_BUDGET_BASE','旧剧情摘要及当前必需材料超过已配置窗口。已保留完整原始存档，未发送。',{
            details:JSON.stringify({stage:'r11_summary_projection',usableTokens:promptCap.usable,estimatedTokens:estimatedBase}),
            hint:'请确认窗口或自行调整摘要/提示词设置；不会删除原始数据。'});
        }}
      }
      if(projectedAway.length){
        // A compact prompt must have room to retrieve relevant original source
        // events; otherwise even a perfect index cannot return old memories.
        const retrievalHeadroom=Math.min(1800,Math.floor(promptCap.usable*.18));
        estimatedBase=baseTokens(recentRaw,sys);
        while(estimatedBase>promptCap.usable-retrievalHeadroom&&recentRaw.length>2){
          if(!discardOldestCompleteTurn())break;
        }
      }
    }
    const canonicalHistoryCount=visibleHistory.filter(m=>m.metadata?.source!=='prompt_preview_draft').length;
    const recent=recentRaw.map(m=>toHistoryMessage(m,session)).filter(Boolean);
    const baseline=applyDepth(recent,depthOnly,session),baselineTokens=baseTokens(recentRaw,sys);
    const summaryValid=!session.rollingSourceFingerprint?!(session.legacyMemoryQuarantined||session.promptLineageProjection):session.rollingSourceCount>0&&session.messages.length>=session.rollingSourceCount&&memorySourceFingerprint(session.messages,session.rollingSourceCount)===session.rollingSourceFingerprint;
    const coverageStart=summaryValid?Math.max(0,session.lastSummarizedIndex||0):0;
    const needsRawGap=projectedAway.length>0;
    const pendingRaw=needsRawGap?visibleHistory.slice():[];
    const recentIds=new Set(recentRaw.map(m=>m.id));
    // Search the entire canonical history, including the part already covered
    // by a rolling summary; coverage is not deletion or a retrieval exclusion.
    const uncoveredOlder=visibleHistory.filter(m=>!recentIds.has(m.id));
    const anchor=options.draft||recentRaw.filter(m=>m.role==='user').slice(-1).map(m=>m.rawContent||m.content).join(' ')||recentRaw.slice(-1).map(m=>m.rawContent||m.content).join(' ');
    // In unverified mode this is a SOFT optional retrieval budget, not a
    // fabricated upper bound on the model or on mandatory prompt materials.
    const retrievalCap=promptCap.verified?promptCap.usable:promptCap.provisionalRetrievalTokens;
    const retrievalBudget=Math.min(Math.floor(retrievalCap*.38),Math.max(0,retrievalCap-baselineTokens-600));
    const candidateHistory=uncoveredOlder;
    const retrieved=retrieveRawGap(session,candidateHistory,0,anchor,retrievalBudget);
    const trace={pendingRawCount:pendingRaw.length,uncoveredRawCount:uncoveredOlder.length,retrievedCount:retrieved.chosen.length,
      fullHistoryPreferred:true,allHistoryIncluded:uncoveredOlder.length===0,temporarilyOmittedTurnIds:projectedAway.map(m=>m.id),canonicalHistoryCount,
      omittedCount:retrieved.omitted.length,retrievedIds:retrieved.chosen.map(x=>x.m.id),omittedIds:retrieved.omitted.slice(0,60).map(x=>x.id),
      sourceFingerprint:memorySourceFingerprint(session.messages.filter(m=>m.metadata?.source!=='prompt_preview_draft'),session.messages.filter(m=>m.metadata?.source!=='prompt_preview_draft').length),sourceCount:session.messages.filter(m=>m.metadata?.source!=='prompt_preview_draft').length,
      sourceWindow:promptCap.windowTokens,budgetVerified:promptCap.verified,budgetPolicy:promptCap.verified?'configured_hard_limit':'unverified_provider_authoritative',baselineEstimateTokens:baselineTokens,retrievalEstimateTokens:retrieved.usedTokens,
      coverageComplete:!retrieved.omitted.length,summarySourceValid:summaryValid,summarySourceCount:session.rollingSourceCount,
      retrievalMode:retrieved.terms.length?'lexical_events':'continuation_event_index',unverifiedPastCount:retrieved.omitted.length};
    const recall=tracked=>tracked.map(x=>x.projected).filter(Boolean);
    const olderMessages=recall(retrieved.chosen);
    // Content comes from mounted resources and verified memory only. Source metadata stays outside the API.
    const sections=sys.sections.map(x=>({role:'system',content:x.content,source:x.source}));
    const depthApplied=applyDepth([...olderMessages,...recent],depthOnly,session);
    const ordered=[...sections,...depthApplied.messages];
    const messages=ordered.map(({role,content})=>({role,content}));
    const messageSources=ordered.map(x=>x.source||{kind:'canonical_history'});
    for(const row of presetTrace){const index=messageSources.findIndex(x=>x.kind==='preset'&&x.sourceId===row.id);row.sendIndex=index<0?null:index+1;row.injected=index>=0;}
    presetTrace.sort((a,b)=>(a.sendIndex??Number.MAX_SAFE_INTEGER)-(b.sendIndex??Number.MAX_SAFE_INTEGER));
    const header=sections.map(x=>x.content).join('\n\n');
    const estimatedInputTokens=messages.reduce((sum,m)=>sum+estimateTokens(m?.content||''),0);
    if(promptCap.verified&&estimatedInputTokens>promptCap.usable)throw new ApiError('E_CONTEXT_BUDGET','上下文检索结果超过已配置的模型预算，已中止发送但保留全部资料。',{details:JSON.stringify({estimatedInputTokens,promptCap,trace})});
    return{messages,messageSources,inspector:{systemChars:header.length,estimatedInputTokens,recentMessageCount:recent.length,unsummarizedGapCount:uncoveredOlder.length,recentMessageLimit:limit,fullHistoryPreferred:true,canonicalHistoryCount,temporarilyOmittedCount:projectedAway.length,allHistoryIncluded:uncoveredOlder.length===0,finalMessageCount:messages.length,
      contextTrace:trace,worldbookBudgetChars:budget,worldbookUsedChars:budgeted.used,upstreamUsage:lastUsage?clone(lastUsage):null,
      sections:sys.sections.map(({name,chars,source})=>({name,chars,transportRole:'system',source})),memoryTrace:sys.memoryTrace,
      presetConflictPolicy:{kind:'deterministic_order_only',semanticConflictsResolved:false,notice:'优先级只确定排列顺序；自由文本规则之间的语义冲突没有自动裁决。'},
      maskTrace,presetTrace,worldbookMountTrace,userMaterialPreview:'',
      // Legacy systemPreview remains for existing clients, but must not be labeled
      // as actual system-role content in the GUI.
      actualSystemRole:'system',userMaterialRole:null,messageSources,
      rollingTrace:{sourceCount:session.rollingSourceCount||0,valid:summaryValid,coverage:trace},
      matchedWorldbookEntries:matched.map(({book,entry,activation:a})=>({bookId:book.id,bookName:book.name,entryId:entry.id,entryName:entry.name,depth:entry.depth,position:entry.position,priority:entry.priority,reason:a.reason,hits:a.hits||[],secondaryHits:a.secondaryHits||[]})),
      skippedWorldbookEntries:[...activation.skipped,...budgeted.dropped].map(({book,entry,activation:a})=>({bookId:book.id,bookName:book.name,entryId:entry.id,entryName:entry.name,reason:a.reason,neededChars:a.neededChars||0,remainingChars:a.remainingChars??null})),
      depthInjections:depthApplied.debug,systemPreview:header,actualSystemPreview:header,messagePreview:messages.map((m,index)=>({index,role:m.role,content:m.content}))}};
  }

  // ---------- API ----------
  // V1.0.2 patch: keep the old OpenAI-compatible route, but add strict empty-reply protection,
  // structured diagnostics, real streaming, and a persisted temperature setting.
  function defaultApiConfig(){return{apiBase:'',apiKey:'',model:'',chatEndpoint:'',modelsEndpoint:'',extraHeaders:'',sendTemperature:true,temperature:0.85,stream:false,maxTokens:0,contextWindowTokens:0,continuationMode:'assistant_tail',prefixReturnsSuffix:false};}
  function getApiConfig(){try{return{...defaultApiConfig(),...JSON.parse(localStorage.getItem(API_CONFIG_KEY)||'{}')}}catch(_){return defaultApiConfig();}}
  function saveApiConfig(cfg){const next={...defaultApiConfig(),...cfg};next.temperature=clampTemp(next.temperature);next.stream=!!next.stream;localStorage.setItem(API_CONFIG_KEY,JSON.stringify(next));return next;}
  function baseWithoutSlash(s){return String(s||'').trim().replace(/\/+$/,'');}

  class ApiError extends Error {
    constructor(code,message,{status=0,hint='',details=''}={}){super(message);this.name='ApiError';this.code=code||'E_API_UNKNOWN';this.status=Number(status)||0;this.hint=hint||apiErrorHint(this.code,this.status,message);this.details=details||'';}
  }
  function apiErrorHint(code,status,message=''){
    const m=String(message||'');
    if(status===400&&/(?:prompt_rejected|blocked by upstream content policy|content[_ -]?filter|prohibited.use.policy)/i.test(m))return '接口明确报告内容政策拦截。本轮请求已被服务端拒绝，原始请求与剧情已保留，不会自动重复计费。';
    if(code==='E_API_CONFIG')return '请检查 API Base URL（基础地址）、模型名和高级端点设置。';
    if(code==='E_API_NETWORK_CORS')return '浏览器没有拿到可读取的响应。常见原因是 CORS（跨域）被 API 服务拦截、域名不可达、HTTPS 证书异常或网络中断。';
    if(code==='E_API_BAD_JSON')return '接口返回了网页、网关文本或其他非 JSON 内容。通常是 API 地址填错、反代报错，或服务端没有按 OpenAI-compatible 格式响应。';
    if(code==='E_API_EMPTY_REPLY')return '接口请求成功，但可见正文为空。常见原因是中转兼容层只返回 reasoning_content、模型输出被过滤/截断、max_tokens 太小，或上游返回格式异常。咪嘛馆现在会拦截空回复，不再把空白消息写进剧情。';
    if(code==='E_API_UNRECOGNIZED_RESPONSE')return '接口返回成功，但响应结构不是咪嘛馆可识别的 OpenAI-compatible 文本格式。可检查中转站是否使用了自定义响应结构。';
    if(code==='E_STREAM_PARSE')return '流式数据没有按 SSE/NDJSON 的常见格式返回，可能是中转站的流式兼容实现异常。可暂时关闭 Streaming（流式传输）再试。';
    if(code==='E_STREAM_INTERRUPTED')return '流式连接已经建立，但接收过程中被网络 / CDN / 中转节点中断。咪嘛馆不会自动再次计费重试；可以点击“仅重试本轮”手动重试，且不会重复写入玩家消息。';
    if(status===400)return '请求参数不被接口接受。常见原因是模型名错误、该模型不支持 temperature / stream / max_tokens，或接口格式不兼容。';
    if(status===402)return '上游/中转站计费网关拒绝了本次请求。余额非零也可能因为模型倍率、分组额度、预授权或请求的最大输出额度过高而被拒绝。';
    if(status===401)return 'API Key（密钥）无效、过期，或 Authorization 认证格式不被服务端接受。';
    if(status===403)return '服务端拒绝访问。可能是账号权限、来源限制、地区限制、模型权限或 CORS 策略。';
    if(status===404)return '请求端点或模型不存在。请重点检查 Base URL（基础地址）、Chat Endpoint（聊天端点）以及模型名。';
    if(status===413)return '提交到 API 的正文或上下文超过当前接口允许的请求体大小；请先识别章节再单章分析，不要把整本书作为一个章节提交。';
    if(status===408||status===504)return '请求超时。可能是模型生成过慢、上游拥堵或网关超时。';
    if(status===524)return '接口返回 HTTP 524 超时。该状态码本身不能确定原因；请核对本轮发送参数、响应耗时及服务端请求 ID。修改 API 设置后可选择“原上下文 · 当前 API 参数”重试。';
    if(status===409)return '服务端状态冲突，可能是上游会话/任务状态异常；稍后重试通常可恢复。';
    if(status===422)return '请求字段格式可解析但无法处理，通常是模型参数或消息格式不兼容。';
    if(status===429)return '触发频率/额度限制。请检查中转站余额、并发限制、RPM/TPM 或模型额度。';
    if(status>=500)return '上游或中转服务器异常。通常不是本地剧情数据损坏，可稍后重试或切换模型/线路。';
    if(/model/i.test(m))return '请检查模型是否存在、是否有权限，以及模型名是否与“拉取模型”返回的一致。';
    return '请检查 API 配置、网络、中转站状态与模型兼容性；错误码可用于进一步定位。';
  }
  function asApiError(e,fallback='E_API_REQUEST'){
    if(e?.name==='AbortError')return e;
    if(e instanceof ApiError)return e;
    const m=e?.message||String(e);
    if(e instanceof TypeError||/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m))return new ApiError('E_API_NETWORK_CORS',m);
    return new ApiError(fallback,m);
  }
  function httpApiError(status,message,details=''){
    return new ApiError(`E_API_HTTP_${status||0}`,message||`API 请求失败 HTTP ${status}`,{status,hint:apiErrorHint('',Number(status)||0,message),details});
  }
  function emitProgress(fn,payload){if(typeof fn==='function'){try{fn(payload)}catch(_){}}}
  function finiteUsageNumber(...values){for(const v of values){if(v===null||v===undefined||v==='')continue;const n=Number(v);if(Number.isFinite(n)&&n>=0)return Math.floor(n)}return null;}
  function extractUsageMetrics(payload,model=''){
    const u=payload?.usage||payload?.usageMetadata||payload?.usage_metadata||null;if(!u||typeof u!=='object')return null;
    const inputTokens=finiteUsageNumber(u.prompt_tokens,u.input_tokens,u.promptTokenCount,u.prompt_token_count,u.inputTokenCount);
    const outputTokens=finiteUsageNumber(u.completion_tokens,u.output_tokens,u.candidatesTokenCount,u.candidates_token_count,u.outputTokenCount);
    const totalTokens=finiteUsageNumber(u.total_tokens,u.totalTokenCount,u.total_token_count,(inputTokens!==null&&outputTokens!==null)?inputTokens+outputTokens:null);
    const cachedTokens=finiteUsageNumber(
      u.total_cached_tokens,
      u.cachedContentTokenCount,
      u.cached_content_token_count,
      u.prompt_tokens_details?.cached_tokens,
      u.input_tokens_details?.cached_tokens,
      u.inputTokensDetails?.cachedTokens,
      payload?.usageMetadata?.cachedContentTokenCount,
      payload?.usage_metadata?.cached_content_token_count
    );
    if(inputTokens===null&&outputTokens===null&&totalTokens===null&&cachedTokens===null)return null;
    return {model:String(model||payload?.model||''),inputTokens,outputTokens,totalTokens,cachedTokens,observedAt:nowIso()};
  }
  function captureUsageMetrics(payload,model='',onProgress=null){
    const usage=extractUsageMetrics(payload,model);if(!usage)return null;lastUsage=usage;
    if(usage.cachedTokens!==null){emitProgress(onProgress,{phase:'cache_usage',percent:86,detail:usage.cachedTokens>0?`上游报告缓存命中 ${usage.cachedTokens} tokens`:'上游返回 usage；本次报告缓存命中 0 tokens',usage:clone(usage)});}
    return usage;
  }
  function getLastUsage(){return lastUsage?clone(lastUsage):null;}
  function buildEndpoints(cfg=getApiConfig()){
    let base=baseWithoutSlash(cfg.apiBase); if(!base)throw new ApiError('E_API_CONFIG','还没有配置 API Base URL（基础地址）');
    let chat,models;
    try{
      if(cfg.chatEndpoint)chat=new URL(cfg.chatEndpoint,base.endsWith('/')?base:base+'/').toString();
      else if(/\/chat\/completions$/i.test(base))chat=base;
      else if(/\/v1$/i.test(base))chat=`${base}/chat/completions`;
      else chat=`${base}/v1/chat/completions`;
      if(cfg.modelsEndpoint)models=new URL(cfg.modelsEndpoint,base.endsWith('/')?base:base+'/').toString();
      else if(/\/chat\/completions$/i.test(base))models=base.replace(/\/chat\/completions$/i,'/models');
      else if(/\/v1$/i.test(base))models=`${base}/models`;
      else models=`${base}/v1/models`;
    }catch(e){throw new ApiError('E_API_CONFIG',`API 地址无法解析：${e.message}`);}
    return{chat,models};
  }
  function parseExtraHeaders(raw){if(!String(raw||'').trim())return{};try{const o=JSON.parse(raw);return o&&typeof o==='object'&&!Array.isArray(o)?o:{}}catch(_){throw new ApiError('E_API_CONFIG','Extra Headers（额外请求头）必须是 JSON 对象');}}
  function apiHeaders(cfg){const h={'Content-Type':'application/json',...parseExtraHeaders(cfg.extraHeaders)};if(cfg.apiKey)h.Authorization=`Bearer ${cfg.apiKey}`;return h;}
  function contentPiece(v){
    if(typeof v==='string')return v;
    if(Array.isArray(v))return v.map(contentPiece).join('');
    if(v&&typeof v==='object'){
      if(typeof v.text==='string')return v.text;
      if(typeof v.content==='string')return v.content;
      if(typeof v.output_text==='string')return v.output_text;
      if(Array.isArray(v.content))return v.content.map(contentPiece).join('');
    }
    return'';
  }
  function extractReply(data){
    const choice=data?.choices?.[0],message=choice?.message||{};
    // A recognized field is allowed to be empty here; callModel will classify that as E_API_EMPTY_REPLY.
    if(message.refusal)throw new ApiError('E_API_REFUSAL','模型明确拒绝提供正文，未将拒绝字段存入记忆。');
    if(Object.prototype.hasOwnProperty.call(message,'content'))return contentPiece(message.content);
    if(Object.prototype.hasOwnProperty.call(message,'text'))return contentPiece(message.text);
    if(Object.prototype.hasOwnProperty.call(message,'refusal'))throw new ApiError('E_API_REFUSAL','模型明确拒绝提供正文，未将拒绝字段存入记忆。');
    // A 200 response containing only private reasoning has no user-visible content.
    // Classify the recognized response shape as E_API_EMPTY_REPLY, never as memory.
    if(['reasoning_content','reasoning','thinking'].some(field=>Object.prototype.hasOwnProperty.call(message,field)))return '';
    if(choice&&Object.prototype.hasOwnProperty.call(choice,'text'))return contentPiece(choice.text);
    if(choice?.delta&&Object.prototype.hasOwnProperty.call(choice.delta,'content'))return contentPiece(choice.delta.content);
    if(Object.prototype.hasOwnProperty.call(data||{},'output_text'))return contentPiece(data.output_text);
    if(Object.prototype.hasOwnProperty.call(data||{},'response'))return contentPiece(data.response);
    if(Object.prototype.hasOwnProperty.call(data||{},'result'))return contentPiece(data.result);
    if(Array.isArray(data?.output))return data.output.flatMap(x=>arr(x?.content)).map(contentPiece).join('');
    if(data?.error?.message)throw new ApiError('E_API_UPSTREAM',data.error.message,{status:Number(data?.error?.status)||0});
    throw new ApiError('E_API_UNRECOGNIZED_RESPONSE','API 没有返回可识别的文本内容');
  }
  function extractStreamDelta(data){
    const choice=data?.choices?.[0],delta=choice?.delta||{};
    const candidates=[delta.content,delta.text,choice?.text,data?.delta,data?.output_text];
    if(typeof data?.type==='string'&&/output_text\.delta$/i.test(data.type))candidates.unshift(data.delta);
    for(const candidate of candidates){const out=contentPiece(candidate);if(out)return out;}
    return'';
  }
  async function parseJsonResponse(res,label='API'){
    let raw='';try{raw=await res.text()}catch(e){throw new ApiError('E_API_BAD_JSON',`${label} 响应读取失败：${e.message}`,{status:res.status});}
    let data;try{data=raw?JSON.parse(raw):{}}catch(_){throw new ApiError('E_API_BAD_JSON',`${label} 返回非 JSON（HTTP ${res.status}）`,{status:res.status,details:`Content-Type: ${res.headers?.get?.('content-type')||'unknown'}`});}
    if(!res.ok)throw httpApiError(res.status,data?.error?.message||data?.message||`${label} 请求失败 HTTP ${res.status}`);
    return data;
  }
  // A protocol terminator is not a successful generation. Normalize the small
  // number of published OpenAI/Gemini/proxy terminal enums, reject unknowns.
  function finishState(payload){
    const c=payload?.choices?.[0]||{},candidate=payload?.candidates?.[0]||{};
    const response=payload?.response||{};
    const raw=c.finish_reason??c.finishReason??c.stop_reason??candidate.finishReason??candidate.finish_reason??payload?.promptFeedback?.blockReason??payload?.prompt_feedback?.block_reason??payload?.finish_reason??payload?.finishReason??payload?.stop_reason??response?.stop_reason??response?.finish_reason??null;
    const status=response?.status??payload?.status??null;
    const explicit=raw==null?String(status||'').trim():String(raw).trim();
    const normalized=explicit.toLowerCase().replace(/[\s-]+/g,'_');
    if(['stop','end_turn','end_turn_token','eos','eos_token','completed','complete','finished','success','stop_sequence'].includes(normalized))return {kind:'complete',reason:explicit};
    if(['length','max_tokens','max_output_tokens','max_tokens_reached','token_limit','model_length'].includes(normalized))return {kind:'truncated',reason:explicit};
    if(['content_filter','safety','prohibited_content','blocked','blocklist','spii','recitation','policy_violation','refusal','malformed_function_call'].includes(normalized))return {kind:'blocked',reason:explicit};
    if(normalized==='incomplete')return {kind:'truncated',reason:explicit};
    if(normalized==='failed'||normalized==='cancelled'||normalized==='canceled'||normalized==='error')return {kind:'abnormal',reason:explicit};
    return {kind:'unknown',reason:explicit||'missing'};
  }
  function assertFinishState(meta,visibleChars=0){
    const kind=meta?.finishKind||'unknown',reason=meta?.finishReason||'missing';
    if(kind==='complete')return;
    const code=kind==='truncated'?'E_API_TRUNCATED':kind==='blocked'?'E_API_REFUSAL':kind==='abnormal'?'E_API_TERMINATED':'E_API_FINISH_UNKNOWN';
    throw new ApiError(code,kind==='truncated'?'模型达到输出上限，未把残缺正文提交为角色回复。':kind==='blocked'?'上游终止原因为内容拦截，未提交角色回复。':'模型没有提供可靠的正常完成标记，未提交角色回复。',{
      details:JSON.stringify({stage:'provider_terminal_admission',finishKind:kind,finishReason:reason,receivedChars:visibleChars}),
      hint:'原始剧情与已提交的消息保持不变；保留玩家输入，可在确认模型输出后手动继续原任务。'});
  }
  async function readStreamingReply(res,onProgress,model='',allowIncompleteDraft=false){
    if(!res.body?.getReader)throw new ApiError('E_STREAM_PARSE','当前浏览器无法读取流式响应。',{status:res.status});
    const reader=res.body.getReader(),decoder=new TextDecoder();
    let buffer='',reply='',eventCount=0,finalPayload=null,streamUsage=null,receivedDone=false,finishReason='',finishKind='unknown',badEvents=0,refusalSeen=false,terminalConflict=false;
    const publishMeta=()=>{if(onProgress?.resultMeta)Object.assign(onProgress.resultMeta,{finishReason:finishReason||'unknown',finishKind,receivedDone,refused:refusalSeen});};
    let eventType='message';
    const consumeLine=line=>{
      const raw=String(line||'').trim();if(!raw)return;if(raw.startsWith(':'))return;
      if(raw.startsWith('event:')){eventType=raw.slice(6).trim()||'message';return}
      if(!raw.startsWith('data:')&&!raw.startsWith('{'))return;
      const payloadText=raw.startsWith('data:')?raw.slice(5).trim():raw;
      if(payloadText==='[DONE]'){receivedDone=true;return}if(!payloadText)return;
      let payload;try{payload=JSON.parse(payloadText)}catch(_){badEvents++;return}
      if(eventType==='error'||payload?.error){throw new ApiError('E_API_UPSTREAM',String(payload?.error?.message||payload?.message||'上游通过 SSE 返回错误事件'),{status:Number(payload?.error?.status||payload?.status)||res.status,details:`stage: stream_event; events: ${eventCount}`})}
      eventCount++;finalPayload=payload;
      const ending=finishState(payload);
      const refusal=payload?.choices?.[0]?.delta?.refusal??payload?.choices?.[0]?.message?.refusal;
      if(refusal!==undefined&&refusal!==null&&String(refusal).trim()){refusalSeen=true;finishReason='refusal';finishKind='blocked';}
      if(!refusalSeen&&ending.reason!=='missing'){
        const known=finishKind!=='unknown',nextKnown=ending.kind!=='unknown';
        if(known&&nextKnown&&finishKind!==ending.kind){
          terminalConflict=true;
          // A later transport terminal cannot turn an observed failure into success.
          if(finishKind==='complete'){finishReason=ending.reason;finishKind=ending.kind;}
        }else if(!known||nextKnown){finishReason=ending.reason;finishKind=ending.kind;}
      }
      publishMeta();
      const observed=captureUsageMetrics(payload,model,null);if(observed)streamUsage=observed;
      const piece=extractStreamDelta(payload);if(piece){reply+=piece;emitProgress(onProgress,{phase:'streaming',percent:Math.min(90,58+Math.log10(reply.length+1)*12),receivedChars:reply.length,delta:piece,streamText:reply,detail:`已接收 ${reply.length} 个字符`});}
    };
    try{
      while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)consumeLine(line)}
      buffer+=decoder.decode();if(buffer.trim())for(const line of buffer.split(/\r?\n/))consumeLine(line);
    }catch(e){
      publishMeta();
      if(reply&&e&&typeof e==='object')e.partialDraft=reply.slice(0,24000);
      if(e?.name==='AbortError'||e instanceof ApiError)throw e;
      if(reply)throw Object.assign(new ApiError('E_STREAM_INTERRUPTED',`流式连接在接收 ${reply.length} 字符后异常终止。未将部分文本当成角色回复。`,{status:res.status,details:`stage: stream_read; events: ${eventCount}; cause: ${e?.name||'unknown'}: ${e?.message||String(e)}`}),{partialDraft:reply.slice(0,24000)});
      throw asApiError(e,'E_API_NETWORK_CORS');
    }
    if(!reply&&finalPayload){try{reply=extractReply(finalPayload)}catch(e){if(e instanceof ApiError&&e.code==='E_API_UPSTREAM')throw e;}}
    publishMeta();
    if(refusalSeen){const issue=new ApiError('E_API_REFUSAL','流式响应包含明确拒绝字段，未提交角色回复。',{status:res.status,details:JSON.stringify({stage:'provider_terminal_admission',finishKind,finishReason,eventCount})});issue.partialDraft=reply.slice(0,24000);throw issue;}
    if(terminalConflict){const issue=new ApiError('E_API_TERMINAL_CONFLICT','响应包含相互矛盾的终止状态，无法证明正文完整。',{status:res.status,details:JSON.stringify({stage:'provider_terminal_admission',finishKind,finishReason,eventCount})});issue.partialDraft=reply.slice(0,24000);throw issue;}
    if(!reply&&finishKind!=='unknown')assertFinishState({finishKind,finishReason},0);
    if(!reply)throw new ApiError(badEvents?'E_STREAM_PARSE':'E_API_EMPTY_REPLY',badEvents?'模型流包含无法解析的数据，未获得正文。':'流式请求结束，但模型没有返回可见正文。',{status:res.status,details:`stream events: ${eventCount}; malformed events: ${badEvents}`});
    if(onProgress?.resultMeta){onProgress.resultMeta.finishReason=finishReason||'unknown';onProgress.resultMeta.finishKind=finishKind;onProgress.resultMeta.receivedDone=receivedDone;}
    if(!receivedDone&&finishKind==='unknown')throw Object.assign(new ApiError('E_STREAM_INTERRUPTED','流式响应已结束，但缺少完成标记，未提交部分正文。',{status:res.status,details:`stage: stream_eof; receivedChars: ${reply.length}; events: ${eventCount}`}),{partialDraft:reply.slice(0,24000)});
    // [DONE] only terminates transport. It does not turn length/safety/missing into success.
    if(!(allowIncompleteDraft&&finishKind==='truncated'))try{assertFinishState({finishKind,finishReason},reply.length)}catch(e){e.partialDraft=reply.slice(0,24000);throw e;}
    if(badEvents)throw Object.assign(new ApiError('E_STREAM_PARSE','收到无法解析的流式事件；不能证明正文完整。',{status:res.status,details:`malformedEvents: ${badEvents}; receivedChars: ${reply.length}`}),{partialDraft:reply.slice(0,24000)});
    if(streamUsage)emitProgress(onProgress,{phase:'cache_usage',percent:92,detail:streamUsage.cachedTokens>0?`上游报告缓存命中 ${streamUsage.cachedTokens} tokens`:'上游返回 usage',usage:clone(streamUsage)});
    if(onProgress?.resultMeta){onProgress.resultMeta.finishReason=finishReason||'unknown';onProgress.resultMeta.finishKind=finishKind;onProgress.resultMeta.receivedDone=receivedDone;}
    return text(reply);
  }
  function continuationProjection(messages,cfg){
    const projected=clone(messages),last=projected[projected.length-1];
    if(last?.role!=='assistant')throw new ApiError('E_CONTINUATION_CONTEXT','续写请求必须以真实 assistant 正文结束。');
    if(cfg.continuationMode==='deepseek_prefix'){
      const {chat}=buildEndpoints(cfg),url=new URL(chat);
      if(url.hostname==='api.deepseek.com'&&!url.pathname.startsWith('/beta/'))
        throw new ApiError('E_CONTINUATION_CONFIG','DeepSeek 前缀续写需要 Beta 端点。',{hint:'使用支持 prefix 的 Beta 端点，或选择普通 Chat 后续生成；不会自动更换端点或补写玩家指令。'});
      last.prefix=true;
    }
    return projected;
  }
  function makeApiBody(messages,cfg,temperature,options={}){
    if(options.requestBody)return clone(options.requestBody);
    const body={model:cfg.model,messages:options.continuation?continuationProjection(messages,cfg):clone(messages)};
    const stream=options.streamOverride===undefined?!!cfg.stream:!!options.streamOverride;
    if(stream)body.stream=true;
    if(cfg.sendTemperature!==false)body.temperature=clampTemp(temperature);
    if(Number(cfg.maxTokens)>0)body.max_tokens=Math.floor(Number(cfg.maxTokens));
    return body;
  }
  function generationSnapshot(session,promptSession,body,messageSources=[],operation='send',excludeReferenceId=null,sourceFingerprint=null){
    const safe={model:body.model,messages:body.messages.map((m,index)=>{
      const original=messageSources[index]?.kind==='canonical_history'?promptSession.messages.find(x=>x.id===messageSources[index].messageId):null;
      const row={role:m.role};if(m.prefix===true)row.prefix=true;
      // Unchanged canonical content is referenced, never duplicated or truncated.
      if(original&&original.id!==excludeReferenceId&&original.content===m.content)
        row.contentRef={messageId:original.id,contentHash:fingerprint(original.content)};
      else row.content=m.content;
      return row;
    })};
    for(const key of ['stream','temperature','max_tokens'])if(Object.hasOwn(body,key))safe[key]=body[key];
    return {version:1,operation,requestBody:safe,messageSources:clone(messageSources),sourceCount:promptSession.messages.length,sourceFingerprint:sourceFingerprint??memorySourceFingerprint(promptSession.messages,promptSession.messages.length)};
  }
  function restoreGenerationRequest(snapshot,promptSession,sourceFingerprint=null){
    if(snapshot?.version!==1||!snapshot.requestBody?.model||!Array.isArray(snapshot.requestBody.messages))
      throw new ApiError('E_GENERATION_SNAPSHOT_INVALID','原轮请求快照结构无法核实。');
    if(snapshot.sourceCount!==promptSession.messages.length||snapshot.sourceFingerprint!==(sourceFingerprint??memorySourceFingerprint(promptSession.messages,promptSession.messages.length)))
      throw new ApiError('E_GENERATION_SNAPSHOT_STALE','原轮上下文已被编辑，无法使用原请求快照。',{hint:'原始版本仍保留；选择“按当前挂载重说”可从当前时间线重新生成。'});
    const body={model:String(snapshot.requestBody.model),messages:snapshot.requestBody.messages.map(m=>{
      let content=m.content;
      if(m.contentRef){const source=promptSession.messages.find(x=>x.id===m.contentRef.messageId);
        if(!source||fingerprint(source.content)!==m.contentRef.contentHash)throw new ApiError('E_GENERATION_SNAPSHOT_STALE','原轮请求引用的历史内容已经变化。');content=source.content;}
      if(!['system','user','assistant'].includes(m.role)||typeof content!=='string')throw new ApiError('E_GENERATION_SNAPSHOT_INVALID','请求快照包含无效消息。');
      return {role:m.role,content,...(m.prefix===true?{prefix:true}:{})};
    })};
    for(const key of ['stream','temperature','max_tokens'])if(Object.hasOwn(snapshot.requestBody,key))body[key]=snapshot.requestBody[key];
    return body;
  }
  function prefixResponseText(value,body,cfg,partial=false){
    const last=body.messages[body.messages.length-1],raw=String(value??'');
    if(last?.prefix!==true||cfg.prefixReturnsSuffix===true)return raw;
    const prefix=partial?String(last.content??''):text(last.content);
    const candidate=partial?raw:text(raw);
    if(partial&&prefix.startsWith(candidate))return '';
    if(candidate.startsWith(prefix))return candidate.slice(prefix.length);
    if(partial)return ''; // wait for final validation; never preview an invalid prefix as new text
    try{validateStoryReply(candidate);}catch(e){e.partialDraft=candidate.slice(0,24000);throw e;}
    const issue=new ApiError('E_PREFIX_RESPONSE_MISMATCH','前缀续写响应未包含已声明的原文前缀，原回复未改动。',{hint:'核对接口返回格式；只有确实返回纯后缀的兼容接口才勾选“仅回后缀”。不会自动改请求、换模型或补写指令。'});
    issue.partialDraft=candidate.slice(0,24000);throw issue;
  }
  async function callModelWithConfig(messages,cfgInput,temperature=0.85,signal,options={}){
    const cfg={...defaultApiConfig(),...(cfgInput||{})};if(!cfg.model)throw new ApiError('E_API_CONFIG','还没有选择/填写 Model（模型）');const {chat}=buildEndpoints(cfg);
    const streamEnabled=options.streamOverride===undefined?!!cfg.stream:!!options.streamOverride;
    // Direct memory / novel / auxiliary calls do not pass through assemble().
    // They still must never submit input + output above a *declared* window.
    if(Number(cfg.contextWindowTokens)>=4096){
      const output=Number(cfg.maxTokens)>0?Math.floor(Number(cfg.maxTokens)):Math.max(1024,Math.min(4096,Math.floor(Number(cfg.contextWindowTokens)*.5)));
      const estimated=messages.reduce((sum,m)=>sum+estimateTokens(m?.content||'')+8,0);
      if(output>=Math.floor(Number(cfg.contextWindowTokens)*.85)||estimated+output>Math.floor(Number(cfg.contextWindowTokens)*.85))
        throw new ApiError('E_CONTEXT_BUDGET_CONFIG','模型输入与保留输出超过声明的上下文窗口；未请求 Provider。',{
          details:JSON.stringify({estimatedInputTokens:estimated,reservedOutputTokens:output,windowTokens:Number(cfg.contextWindowTokens),stage:options.memoryContext?.stage||'provider_request'}),
          hint:'请检查上下文窗口与 max_tokens 配置；不会自动改变设置或删除 Persona/History。'});
    }
    const body=makeApiBody(messages,cfg,temperature,options),serializationStartedAt=Date.now();
    const requestJson=JSON.stringify(body),requestBytes=new TextEncoder().encode(requestJson).byteLength;
    const requestId=makeId('req'),diag={requestId,jobId:options.memoryContext?.jobId||null,attemptId:options.memoryContext?.attemptId||null,stage:options.memoryContext?.stage||'story',model:body.model,endpointOrigin:(()=>{try{return new URL(chat).origin}catch{return 'unknown'}})(),requestFields:Object.keys(body).sort(),messageCount:body.messages.length,temperaturePresent:Object.hasOwn(body,'temperature'),maxTokens:body.max_tokens||null,stream:streamEnabled,requestBytes,serializationElapsedMs:Date.now()-serializationStartedAt,
      generationId:options.storyContext?.generationId||null,generationAttempt:options.storyContext?.generationAttempt||null,preparationElapsedMs:options.storyContext?.preparationElapsedMs??null};
    const diagnostic=extra=>JSON.stringify({...diag,...extra});
    // Exact body.messages at the fetch boundary. Credentials, auth headers and
    // extraHeaders never enter the independent diagnostics database.
    try{options.onDiagnostic?.({type:'request',request:body,messageSources:options.messageSources||[],...diag});}
    catch(e){console.error('诊断事件回调失败；真实模型请求继续执行',e);}
    emitProgress(options.onProgress,{phase:'requesting',percent:42,detail:`正在请求 ${cfg.model}`});
    const fetchStartedAt=Date.now(),requestStartedAt=new Date(fetchStartedAt).toISOString();
    let res;try{res=await fetch(chat,{method:'POST',headers:apiHeaders(cfg),body:requestJson,signal,mode:'cors',credentials:'omit',cache:'no-store'});}catch(e){
      const err=asApiError(e);
      if(err instanceof ApiError&&err.code==='E_API_NETWORK_CORS'){
        let endpoint='';try{endpoint=new URL(chat).origin}catch(_){}
        const online=(typeof navigator!=='undefined'&&typeof navigator.onLine==='boolean')?String(navigator.onLine):'unknown';
        err.details=[err.details,`stage: fetch_before_response`,`endpoint: ${endpoint||'unknown'}`,`navigator.onLine: ${online}`].filter(Boolean).join('; ');
      }
      err.details=diagnostic({errorSource:'transport',causeCode:err.code||'E_API_NETWORK',requestStartedAt,fetchElapsedMs:Date.now()-fetchStartedAt});throw err;
    }
    // Record only named public correlation headers, never arbitrary response
    // headers, credentials or the private request URL/query string.
    const safeId=value=>{const s=String(value??'');return /^[A-Za-z0-9_.:-]{1,200}$/.test(s)?s:null;};
    const responseTiming={requestStartedAt,responseReceivedAt:new Date().toISOString(),fetchElapsedMs:Date.now()-fetchStartedAt,httpStatus:res.status,requestBytes,
      providerRequestId:safeId(res.headers?.get?.('x-request-id')||res.headers?.get?.('request-id')),cfRay:safeId(res.headers?.get?.('cf-ray'))};
    try{options.onDiagnostic?.({type:'transport_response',...responseTiming});}catch(e){console.error('诊断事件回调失败；真实响应继续解析',e);}
    if(!res.ok){
      const responseBodyStartedAt=Date.now();
      let data={};try{data=await (res.clone?res.clone():res).json()}catch(_){}
      const err=data?.error&&typeof data.error==='object'?data.error:{};
      const field=value=>typeof value==='string'||typeof value==='number'?String(value).slice(0,200):null;
      const message=err.message||data?.message||`API 请求失败 HTTP ${res.status}`;
      const messageRequestId=typeof message==='string'?message.match(/\(request id:\s*([A-Za-z0-9_.:-]{1,200})\)\s*$/i)?.[1]:null;
      const providerError={type:field(err.type),code:field(err.code),param:field(err.param),requestId:safeId(err.request_id||data?.request_id||messageRequestId)};
      const problem=httpApiError(res.status,message);
      if(err.code==='model_not_found'&&/No available channel for model/i.test(String(message)))problem.hint='中转报告当前模型在该分组下没有可用渠道。请中转管理员按上游 request id 核查模型映射与渠道状态；连续重试同一路由无法修复渠道配置。';
      problem.details=diagnostic({errorSource:'http',...responseTiming,providerError,responseBodyElapsedMs:Date.now()-responseBodyStartedAt,responseShape:Object.keys(data||{}).slice(0,20)});throw problem;
    }
    const contentType=String(res.headers?.get?.('content-type')||'').toLowerCase();
    if(streamEnabled&&!/application\/json/i.test(contentType)){
      emitProgress(options.onProgress,{phase:'streaming',percent:55,detail:'连接成功，正在接收流式正文…'});
      const streamProgress=ev=>options.onProgress?.(ev.streamText===undefined?ev:{...ev,streamText:prefixResponseText(ev.streamText,body,cfg,true)});streamProgress.resultMeta=options.resultMeta;try{
        const received=await readStreamingReply(res,streamProgress,cfg.model,options.allowIncompleteDraft===true);
        const streamed=text(prefixResponseText(received,body,cfg));
        if(!streamed)throw new ApiError('E_API_EMPTY_REPLY','前缀续写没有返回新的正文，原回复未改动。');
        try{options.onDiagnostic?.({type:'provider_result',finishKind:options.resultMeta?.finishKind||'unknown',finishReason:options.resultMeta?.finishReason||'unknown',responseChars:streamed.length});}catch(e){console.error('诊断事件回调失败',e);}
        return streamed;
      }catch(e){
        if(options.resultMeta?.finishReason)try{options.onDiagnostic?.({type:'provider_result',finishKind:options.resultMeta.finishKind,finishReason:options.resultMeta.finishReason,responseChars:e?.partialDraft?.length||0});}catch(diagErr){console.error('诊断事件回调失败',diagErr);}
        if(e instanceof ApiError)e.details=diagnostic({errorSource:'stream',httpStatus:res.status,errorCode:e.code,streamDetails:String(e.details||'').slice(0,500)});throw e;}
    }
    emitProgress(options.onProgress,{phase:'receiving',percent:68,detail:'模型已响应，正在解析正文…'});
    const data=await parseJsonResponse(res,'API');
    captureUsageMetrics(data,cfg.model,options.onProgress);
    const ending=finishState(data);
    if(options.resultMeta){options.resultMeta.finishReason=ending.reason;options.resultMeta.finishKind=ending.kind;options.resultMeta.refused=!!data?.choices?.[0]?.message?.refusal;options.resultMeta.requestId=requestId;}
    try{options.onDiagnostic?.({type:'provider_result',finishKind:ending.kind,finishReason:ending.reason,responseChars:0});}catch(e){console.error('诊断事件回调失败',e);}
    if(ending.kind==='blocked'||ending.kind==='abnormal'){
      const evidence=contentPiece(data?.choices?.[0]?.message?.content??data?.choices?.[0]?.text??'');
      try{assertFinishState({finishKind:ending.kind,finishReason:ending.reason},evidence.length);}catch(e){e.partialDraft=evidence.slice(0,24000);throw e;}
    }
    let reply;try{reply=extractReply(data)}catch(e){const cause=asApiError(e,'E_API_UNRECOGNIZED_RESPONSE');if(cause instanceof ApiError)cause.details=diagnostic({errorSource:'response_shape',errorCode:cause.code,httpStatus:res.status,responseShape:Object.keys(data||{}).slice(0,20),messageShape:Object.keys(data?.choices?.[0]?.message||{}).slice(0,20)});throw cause;}
    reply=text(prefixResponseText(reply,body,cfg));
    try{options.onDiagnostic?.({type:'provider_result',finishKind:ending.kind,finishReason:ending.reason,responseChars:reply.length});}catch(e){console.error('诊断事件回调失败',e);}
    if(options.resultMeta){options.resultMeta.finishReason=ending.reason;options.resultMeta.finishKind=ending.kind;options.resultMeta.refused=!!data?.choices?.[0]?.message?.refusal;options.resultMeta.usage=data?.usage||null;options.resultMeta.requestId=requestId;}
    if(!(options.allowIncompleteDraft===true&&ending.kind==='truncated'))try{assertFinishState({finishKind:ending.kind,finishReason:ending.reason},reply.length)}catch(e){e.partialDraft=reply.slice(0,24000);throw e;}
    if(!reply)throw new ApiError('E_API_EMPTY_REPLY','API 请求成功，但模型返回了空白正文。',{status:res.status,details:diagnostic({errorSource:'response_body',httpStatus:res.status,contentType,finishReason:data?.choices?.[0]?.finish_reason||'unknown',responseShape:Object.keys(data||{}).slice(0,20),messageShape:Object.keys(data?.choices?.[0]?.message||{}).slice(0,20),visibleChars:0})});
    emitProgress(options.onProgress,{phase:'received',percent:90,receivedChars:reply.length,detail:`正文接收完成 · ${reply.length} 字符`});
    return reply;
  }
  async function callModel(messages,temperature=0.85,signal,options={}){return callModelWithConfig(messages,getApiConfig(),temperature,signal,options);}
  async function listModelsWithConfig(cfgInput){const cfg={...defaultApiConfig(),...(cfgInput||{})},{models}=buildEndpoints(cfg);let res;try{res=await fetch(models,{headers:apiHeaders(cfg)});}catch(e){throw asApiError(e,'E_MODELS_NETWORK');}const data=await parseJsonResponse(res,'模型列表');const raw=arr(data?.data||data?.models||data);const modelsOut=raw.map(x=>typeof x==='string'?x:(x?.id||x?.name)).filter(Boolean).sort();if(!modelsOut.length)throw new ApiError('E_MODELS_EMPTY','接口可访问，但没有返回可选择的模型。',{status:res.status,hint:'可能是模型列表端点不兼容、账号没有模型权限，或需要在 Models Endpoint（模型端点）中手动指定路径。'});return modelsOut;}
  async function listModels(){return listModelsWithConfig(getApiConfig());}
  async function testApi(){const models=await listModels();return{ok:true,models,count:models.length};}

  // ---------- Novel Studio ----------
  function novelSummaries(){return state.novelProjects.map(p=>({id:p.id,title:p.title,updatedAt:p.updatedAt,createdAt:p.createdAt,sourceName:p.sourceName,chapterCount:arr(p.chapterOrder).length,activeChapterId:p.activeChapterId,memoryStatus:p.memoryStatus?.status||'missing'})).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));}
  function getNovelProject(id){const p=getNovel(id);if(!p)throw new Error('未找到小说项目');return clone(p);}
  function novelModelConfig(project){const base=getApiConfig(),n=project.modelSettings||{};return{...base,model:text(n.model)||base.model,sendTemperature:typeof n.sendTemperature==='boolean'?n.sendTemperature:base.sendTemperature,temperature:n.temperature!==null&&n.temperature!==undefined&&Number.isFinite(Number(n.temperature))?Number(n.temperature):base.temperature,stream:typeof n.streaming==='boolean'?n.streaming:base.stream,maxTokens:Number(n.maxTokens)>0?Number(n.maxTokens):base.maxTokens};}
  function createBlankNovel(body={}){const p=window.MimaNovelEngine.createProjectFromText({title:body.title||'未命名小说',sourceName:'',sourceEncoding:'utf-8',text:''});p.createdFrom='manual';return p;}
  async function patchNovelProject(id,body={}){const p=getNovelProject(id),allowed=['title','activeChapterId','presetIds','worldbookIds','modelSettings','generationSettings','appearance'];for(const k of allowed)if(Object.prototype.hasOwnProperty.call(body,k))p[k]=clone(body[k]);return saveNovelProject(p);}
  function novelAssets(){return{presets:state.presets,worldbooks:state.worldbooks,cssPresets:state.cssPresets,themeSettings:state.themeSettings};}
  function novelPromptPreview(id,body={}){const p=getNovelProject(id);return window.MimaNovelPromptAssembler.assemble({project:p,presets:state.presets,worldbooks:state.worldbooks,directorNote:body.directorNote||'',mode:body.mode||'continue',draftText:body.draftText||''}).inspector;}
  function analysisPrompt(project,chapter){const body=window.MimaNovelEngine.getChapterText(chapter);return[
    {role:'system',content:'你是小说剧情档案整理器。只提取已经发生的事实，禁止预测未来、补写剧情或把本轮导演要求当事实。只输出严格 JSON，不要 Markdown。'},
    {role:'user',content:`请分析以下章节，并输出 {"summary":{"overview":"","events":[],"characterChanges":[],"revealedFacts":[],"openThreads":[],"foreshadowing":[],"endingState":""},"delta":{"storyOverview":"","currentSituation":"","characterStates":[],"relationships":[],"timeline":[],"openThreads":[],"foreshadowing":[],"revealedFacts":[],"locations":[],"closedThreads":[],"resolvedForeshadowing":[]}}。\n\n【${chapter.title}】\n${body}`}
  ];}
  async function analyzeNovelChapterInMemory(project,chapter,signal=null,progress=null){const engine=window.MimaNovelEngine,memory=window.MimaNovelMemory;if(!engine||!memory)throw new Error('Novel Memory 未加载');const body=engine.getChapterText(chapter);if(!body.trim())return project;const cfg=novelModelConfig(project),raw=await callModelWithConfig(analysisPrompt(project,chapter),cfg,0.25,signal,{streamOverride:false,onProgress:progress}),parsed=memory.validateAnalysisPayload(raw),revision=chapter.revision,hash=engine.chapterHash(chapter),summary={...parsed.summary,sourceRevision:revision,sourceHash:hash,generatedAt:nowIso()};chapter.summary=summary;chapter.summarySourceRevision=revision;chapter.summarySourceHash=hash;chapter.summaryStatus='fresh';chapter.memoryDelta=clone(parsed.delta);project.narrativeState=memory.deriveFromChapters(project);const otherCovered=project.chapters.filter(c=>engine.getChapterText(c).trim()&&c.id!==chapter.id);const hasStale=otherCovered.some(c=>c.summaryStatus==='stale'||(c.summaryStatus==='fresh'&&memory.isSummaryStale(c)));const hasMissing=otherCovered.some(c=>c.summaryStatus==='missing'||!c.summarySourceRevision||!c.summarySourceHash);project.memoryStatus={status:hasStale?'stale':(hasMissing?'missing':'fresh'),error:'',updatedAt:nowIso()};return project;}
  async function updateNovelMemory(id,chapterId,signal=null,progress=null){const p=getNovelProject(id),c=window.MimaNovelEngine.getChapter(p,chapterId||p.activeChapterId);if(!c)throw new Error('未找到章节');try{await analyzeNovelChapterInMemory(p,c,signal,progress);return await saveNovelProject(p);}catch(e){const latest=getNovel(id);if(latest&&Number(latest.recordRevision)===Number(p.recordRevision)){const patched=clone(latest);patched.memoryStatus={status:'degraded',error:e?.message||String(e),updatedAt:nowIso()};await saveNovelProject(patched);}throw e;}}
  async function rebuildNovelMemory(id,signal=null,progress=null){const original=clone(getNovelProject(id)),p=clone(original);p.narrativeState=window.MimaNovelMemory.seedForRebuild(p.narrativeState);p.legacyNarrativeCheckpoint=null;for(const c of p.chapters){c.summaryStatus='missing';c.summarySourceRevision=0;c.summarySourceHash='';}try{for(const [i,chapterId] of p.chapterOrder.entries()){const c=window.MimaNovelEngine.getChapter(p,chapterId);if(c&&window.MimaNovelEngine.getChapterText(c).trim()){emitProgress(progress,{phase:'novel_memory_rebuild',percent:6+Math.round((i/p.chapterOrder.length)*85),detail:`剧情档案 · 正在分析 ${i+1}/${p.chapterOrder.length} 章 · ${c.title}`});await analyzeNovelChapterInMemory(p,c,signal,progress);}}p.memoryStatus={status:'fresh',error:'',updatedAt:nowIso()};return await saveNovelProject(p);}catch(e){const current=getNovel(id);if(current&&Number(current.recordRevision)===Number(original.recordRevision)){const marked=clone(current);marked.memoryStatus={status:'degraded',error:e?.message||String(e),updatedAt:nowIso()};await saveNovelProject(marked);}throw e;}}
  function findDraft(p,id){return arr(p.drafts).find(x=>x.id===id)||null;}function findGeneration(p,id){return arr(p.generations).find(x=>x.id===id)||null;}
  function assertNovelDraftBaseCurrent(project,draft,generation){
    const engine=window.MimaNovelEngine,chapter=engine.getChapter(project,draft.chapterId);if(!chapter)throw new Error('Draft 对应章节不存在');
    const snap=generation?.inputSnapshot||{};if(snap.requiresRebase||draft.metadata?.requiresRebase)throw new Error('合并章节后的草稿已保留，但旧输入基础改变；请重写草稿后采纳');const hasRevision=Object.prototype.hasOwnProperty.call(snap,'chapterRevision'),hasHash=!!snap.chapterHash;
    const revisionChanged=hasRevision&&Number(snap.chapterRevision)!==Number(chapter.revision),hashChanged=hasHash&&String(snap.chapterHash)!==engine.chapterHash(chapter);
    if(revisionChanged||hashChanged)throw new Error('Draft 基于旧版正文；当前章节已经修改。请重写 Draft 后再继续或采纳。');
    return chapter;
  }
  async function continueNovel(id,body={},signal=null,progress=null){
    const engine=window.MimaNovelEngine,p=getNovelProject(id),resumeDraft=body.draftId?findDraft(p,body.draftId):null;
    let chapter,gen,draft;
    if(resumeDraft){
      if(['accepted','rejected'].includes(resumeDraft.status))throw new Error('当前 Draft 已终结，不能继续补写');
      draft=resumeDraft;gen=findGeneration(p,draft.generationId);if(!gen)throw new Error('Draft 对应的 Generation 不存在');
      chapter=assertNovelDraftBaseCurrent(p,draft,gen);
      gen.status='generating';draft.status='generating';gen.error='';
    }else{
      chapter=engine.getChapter(p,body.chapterId||p.activeChapterId);if(!chapter)throw new Error('未找到续写章节');p.activeChapterId=chapter.id;
      gen=engine.normalizeGeneration({projectId:p.id,chapterId:chapter.id,directorNote:String(body.directorNote||''),minimumChars:Math.max(0,Number(body.minimumChars??p.generationSettings?.minimumChars)||0),status:'generating',inputSnapshot:{chapterRevision:chapter.revision,chapterHash:engine.chapterHash(chapter)}});
      draft=engine.normalizeDraft({projectId:p.id,chapterId:chapter.id,generationId:gen.id,status:'generating'});gen.draftId=draft.id;p.generations.push(gen);p.drafts.push(draft);
    }
    if(Object.prototype.hasOwnProperty.call(body,'directorNote'))gen.directorNote=String(body.directorNote||'');
    if(Object.prototype.hasOwnProperty.call(body,'minimumChars'))gen.minimumChars=Math.max(0,Number(body.minimumChars)||0);
    const minimumChars=Math.max(0,Number(gen.minimumChars)||0),maxAppend=Number.isFinite(Number(p.generationSettings?.maxAppendAttempts))?Math.max(0,Math.min(8,Number(p.generationSettings.maxAppendAttempts))):3;
    await saveNovelProject(p);const cfg=novelModelConfig(p);let callsThisRun=0;
    try{
      while(true){
        const mode=draft.content?'append':'continue';
        const built=window.MimaNovelPromptAssembler.assemble({project:p,presets:state.presets,worldbooks:state.worldbooks,directorNote:gen.directorNote,mode,draftText:draft.content,minimumChars});
        const before=draft.content;
        const proxy=ev=>{if(ev?.streamText!==undefined){draft.content=engine.appendDraftText(before,ev.streamText||'');draft.updatedAt=nowIso();}if(progress)progress({...ev,novelDraftText:draft.content,generationId:gen.id,draftId:draft.id});};
        const resultMeta={};const reply=await callModelWithConfig(built.messages,cfg,cfg.temperature,signal,{streamOverride:cfg.stream,onProgress:proxy,resultMeta,allowIncompleteDraft:true,continuation:mode==='append'});
        draft.content=engine.appendDraftText(before,reply);draft.updatedAt=nowIso();callsThisRun++;
        gen.attempts.push({index:gen.attempts.length,manualResume:!!resumeDraft,chars:engine.countVisibleChars(reply),totalChars:engine.countVisibleChars(draft.content),completedAt:nowIso(),finishReason:resultMeta.finishReason||'unknown'});
        const count=engine.countVisibleChars(draft.content);
        if(resultMeta.refused||resultMeta.finishKind==='truncated'||['length','content_filter','tool_calls'].includes(resultMeta.finishReason)){draft.status='incomplete';draft.metadata={...draft.metadata,finishReason:resultMeta.finishReason||'refusal',achievedChars:count,requiredChars:minimumChars};gen.status='incomplete';gen.completedAt=nowIso();break;}
        if(count>=minimumChars){draft.status='ready';gen.status='ready';gen.completedAt=nowIso();break;}
        if(callsThisRun>=maxAppend+1){draft.status='incomplete';draft.metadata={...draft.metadata,achievedChars:count,requiredChars:minimumChars};gen.status='incomplete';gen.completedAt=nowIso();break;}
      }
      await saveNovelProject(p);return{project:p,draft,generation:gen};
    }catch(e){
      const count=engine.countVisibleChars(draft.content);draft.status='interrupted';draft.metadata={...draft.metadata,achievedChars:count,requiredChars:minimumChars,error:e?.message||String(e)};gen.status='interrupted';gen.error=e?.message||String(e);gen.completedAt=nowIso();await saveNovelProject(p);if(count>0)return{project:p,draft,generation:gen,interrupted:true};throw e;
    }
  }
  async function patchNovelDraft(id,draftId,body={}){const p=getNovelProject(id),d=findDraft(p,draftId);if(!d)throw new Error('未找到草稿');if(d.status==='accepted')throw new Error('已采纳草稿不能再编辑');d.content=String(body.content??d.content);d.updatedAt=nowIso();if(['interrupted','incomplete'].includes(d.status))d.status='ready';return saveNovelProject(p);}
  async function rejectNovelDraft(id,draftId){const p=getNovelProject(id),d=findDraft(p,draftId);if(!d)throw new Error('未找到草稿');if(d.status==='accepted')throw new Error('已采纳草稿不能删除');d.status='rejected';d.updatedAt=nowIso();const g=findGeneration(p,d.generationId);if(g)g.status='rejected';return saveNovelProject(p);}
  async function regenerateNovelDraft(id,draftId,body={},signal=null,progress=null){
    const p=getNovelProject(id),old=findDraft(p,draftId);if(!old)throw new Error('未找到草稿');
    if(old.status==='accepted')throw new Error('已采纳草稿不能重写，请改为编辑原文或开启下一轮续写');
    // Regeneration is an alternate draft, not destructive replacement. Preserve the old candidate even on provider failure.
    const previous=findGeneration(p,old.generationId);
    return continueNovel(id,{...body,chapterId:old.chapterId,directorNote:body.directorNote??previous?.directorNote??''},signal,progress);
  }
  async function acceptNovelDraft(id,draftId,signal=null,progress=null){const engine=window.MimaNovelEngine,p=getNovelProject(id),d=findDraft(p,draftId);if(!d)throw new Error('未找到草稿');if(d.status==='accepted')return p;if(!['ready','incomplete','interrupted'].includes(d.status))throw new Error('当前草稿状态不能采纳');const g0=findGeneration(p,d.generationId);if(!g0)throw new Error('Draft 对应的 Generation 不存在');assertNovelDraftBaseCurrent(p,d,g0);const committed=engine.appendAcceptedSegment(p,d.chapterId,d);const cd=findDraft(committed,draftId);if(cd)cd.status='accepted';const g=findGeneration(committed,d.generationId);if(g){g.status='accepted';g.completedAt=g.completedAt||nowIso();}committed.memoryStatus={status:'stale',error:'',updatedAt:nowIso()};const saved=await saveNovelProject(committed);try{return await updateNovelMemory(saved.id,d.chapterId,signal,progress);}catch(e){const latest=getNovelProject(saved.id),c=engine.getChapter(latest,d.chapterId);if(c)c.summaryStatus=c.summarySourceRevision?'stale':'missing';latest.memoryStatus={status:'degraded',error:e?.message||String(e),updatedAt:nowIso()};return saveNovelProject(latest);}}
  async function reviewLegacyMemoryItem(id,body={}){
    const p=getNovelProject(id),memory=window.MimaNovelMemory,engine=window.MimaNovelEngine;
    const checkpoint=p.legacyNarrativeCheckpoint;
    if(memory.legacyCheckpointStatus(p,p.activeChapterId)!=='needs_review')throw new Error('旧资料不处于可核查状态，不能直接升格为已发生事实');
    const field=String(body.field||''),index=Number(body.index),chapterId=String(body.chapterId||'');
    const allowed=['storyOverview','currentSituation','characterStates','relationships','timeline','openThreads','foreshadowing','revealedFacts','locations'];
    if(!allowed.includes(field)||!Number.isInteger(index)||index<0)throw new Error('旧事实核查条目无效');
    const source=checkpoint.state?.[field],value=Array.isArray(source)?source[index]:(index===0?source:undefined);
    if(value===undefined||value===null||value==='')throw new Error('旧事实条目不存在');
    const chapter=engine.getChapter(p,chapterId),currentIndex=p.chapterOrder.indexOf(chapterId),activeIndex=p.chapterOrder.indexOf(p.activeChapterId);
    if(!chapter||currentIndex<0||currentIndex>activeIndex||chapter.summaryStatus!=='fresh'||memory.isSummaryStale(chapter))throw new Error('指定来源章节尚未验证或不在当前时间线');
    const review={field,index,chapterId,chapterRevision:chapter.revision,chapterHash:engine.chapterHash(chapter),summaryGeneratedAt:String(chapter.summary?.generatedAt||'')};
    checkpoint.reviews=Array.isArray(checkpoint.reviews)?checkpoint.reviews:[];
    checkpoint.reviews=checkpoint.reviews.filter(x=>!(x.field===field&&x.index===index));
    checkpoint.reviews.push(review);
    return saveNovelProject(p);
  }
  async function patchNovelMemory(id,body={}){const p=getNovelProject(id);p.narrativeState=window.MimaNovelMemory.applyManualPatch(p.narrativeState,body);return saveNovelProject(p);}

  // ---------- Story Engine ----------
  function makeMessage(role,content,session,metadata={}){return normalizeMessage({id:makeId('msg'),role,content,rawContent:content,time:nowIso(),mode:'story_mode',canonLevel:session.canonLevel||'alternate',metadata,branchId:'main',tokenEstimate:estimateTokens(content)});}
  function archiveVersion(msg,reason){
    msg.versions=arr(msg.versions);
    msg.versions.push({versionId:makeId('ver'),content:msg.content,
      rawContent:typeof msg.rawContent==='string'?msg.rawContent:msg.content,
      renderedContent:typeof msg.renderedContent==='string'?msg.renderedContent:'',
      isEdited:!!msg.isEdited,metadata:clone(msg.metadata&&typeof msg.metadata==='object'?msg.metadata:{}),
      messageTime:msg.time||'',time:nowIso(),reason:reason||'regenerate'});
  }
  function actionOptions(action,userText,options={}){
    const o={};if(action==='continue')o.continuation=true;
    if(action==='auto_advance')o.directorNote=String(options.directorNote||userText||'');
    else if(options.directorNote)o.directorNote=options.directorNote;
    return o;
  }
  function lastIndexByRole(messages,role){for(let i=messages.length-1;i>=0;i--){if(messages[i]?.role===role)return i;}return -1;}
  function resolveRegenerationTarget(session,requestedId=''){
    const messages=arr(session?.messages);
    const latestUserIndex=lastIndexByRole(messages,'user');
    const latestAssistantIndex=lastIndexByRole(messages,'assistant');
    const requested=text(requestedId);
    if(requested){
      const requestedIndex=messages.findIndex(m=>m?.id===requested);
      if(requestedIndex<0||messages[requestedIndex]?.role!=='assistant')throw new ApiError('E_STORY_REGEN_TARGET_MISSING','要重说的那条回复已经不存在，已阻止覆盖其他剧情。',{hint:'请刷新剧情后再点一次“重说”。'});
      if(requestedIndex!==latestAssistantIndex||requestedIndex<latestUserIndex)throw new ApiError('E_STORY_REGEN_TARGET_STALE','剧情在点击“重说”后发生了变化，已阻止覆盖更早的回复。',{hint:'请刷新剧情后重新点击“重说”，系统只会替换当前最后一轮 Assistant（助手）回复。'});
      return messages[requestedIndex];
    }
    // 只有最后一条 assistant 确实属于当前最后一轮 user 时才允许原位替换。
    // 如果最新消息是 user（例如编辑并截断后的新时间线），则返回 null，后续只追加新回复，绝不误伤上一轮。
    if(latestAssistantIndex>=0&&latestAssistantIndex>latestUserIndex)return messages[latestAssistantIndex];
    if(latestUserIndex<0&&latestAssistantIndex>=0)return messages[latestAssistantIndex];
    return null;
  }
  function storyRoundData(session){
    const opening=[],rounds=[];let current=null;
    for(const msg of arr(session?.messages)){
      if(!msg?.content||(msg.role!=='user'&&msg.role!=='assistant'))continue;
      if(msg.role==='user'){
        current={index:rounds.length+1,messages:[msg]};rounds.push(current);
      }else if(current){current.messages.push(msg);}else opening.push(msg);
    }
    return{opening,rounds};
  }
  // Wall-clock receipt is NOT story-world time. Keep the distinction explicit:
  // a line written four days ago cannot silently become "yesterday" today.
  function memoryTimestampLabel(m){
    if(m?.metadata?.memoryTimeUnverified)return '';
    const date=Date.parse(String(m?.time||''));
    return Number.isFinite(date)?`【现实消息记录于 ${new Date(date).toISOString()}；不是剧情内日期】\n`:'';
  }
  const MEMORY_TIME_CONTRACT='时间校验：现实消息记录时间与剧情内日期不同。不得将旧消息无依据改写成“昨天”“今天”“前天”“刚才”；剧情人物原话中的相对时间仅相对于其说话当时。没有可信剧情日期时写“具体剧情日期未明确”，保留先后顺序。';
  function formatTimelineBlock(label,messages,session){
    const ctx=macroContext(session);
    const body=arr(messages).map(m=>memoryTimestampLabel(m)+(m.role==='user'?`${ctx.userName}（玩家输入语义）：\n${compileUserInputForPrompt(session,m.content,inputSemanticMode(session,m))}`:`${ctx.charName}：${resolveMacrosForSession(session,m.content)}`)).join('\n');
    return body?`${label}\n${body}`:'';
  }
  function formatRoundRange(data,startRound,endRound,{includeOpening=false,session=null}={}){
    const blocks=[];
    if(includeOpening&&data.opening.length)blocks.push(formatTimelineBlock('【角色开场 / 第 1 轮之前】',data.opening,session));
    for(const r of data.rounds.filter(x=>x.index>=startRound&&x.index<=endRound))blocks.push(formatTimelineBlock(`【第 ${r.index} 轮】`,r.messages,session));
    return blocks.filter(Boolean).join('\n\n');
  }
  function splitTextBlocks(textInput,maxChars=28000){
    const blocks=String(textInput||'').split(/\n{2,}(?=【)/).filter(Boolean),out=[];let cur='';
    const push=()=>{if(cur.trim())out.push(cur.trim());cur='';};
    for(const block of blocks){
      if(block.length>maxChars){push();for(let i=0;i<block.length;i+=maxChars)out.push(block.slice(i,i+maxChars));continue;}
      if(cur&&cur.length+2+block.length>maxChars)push();
      cur+=(cur?'\n\n':'')+block;
    }
    push();return out.length?out:[String(textInput||'')];
  }
  // Bind each fact part to the exact model-visible characters and their
  // canonical message offsets. A >28k-character utterance can straddle parts;
  // validating both parts against the entire round falsely expands authority.
  function factSourcePartScopes(sourceText,chunks,rangeScope,rangeMessages,session){
    if(chunks.length===1)return [rangeScope];
    const visible=String(sourceText||''),spans=[];
    let cursor=0;
    const ctx=macroContext(session);
    for(const m of rangeMessages){
      const body=m.role==='user'?compileUserInputForPrompt(session,m.content,inputSemanticMode(session,m)):resolveMacrosForSession(session,m.content);
      const actor=m.role==='user'?ctx.userName+'（玩家输入语义）：\n':ctx.charName+'：';
      const match=actor+body;
      const at=visible.indexOf(match,cursor);
      if(at<0)throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED','事实分片未能对应原始剧情，已停止提交；原文未修改。');
      const originalIndex=session.messages.findIndex(x=>x.id===m.id);
      if(originalIndex<0)throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED','事实分片引用的剧情消息已丢失。');
      spans.push({messageIndex:originalIndex,messageId:m.id,role:m.role,start:at+actor.length,end:at+match.length,body});
      cursor=at+match.length;
    }
    let searchAt=0;
    return chunks.map((chunk,i)=>{
      const start=visible.indexOf(chunk,searchAt);
      if(start<0)throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED','事实分片文本与原始生成材料不一致。');
      const end=start+chunk.length;searchAt=end;
      const parts=spans.flatMap(span=>{
        const lo=Math.max(start,span.start),hi=Math.min(end,span.end);
        if(hi<=lo)return [];
        const partText=visible.slice(lo,hi),localStart=lo-span.start;
        // Only exact canonical substrings can become a verified source.
        // Macro/regex transformations without a raw anchor are review-only.
        const canonical=session.messages[span.messageIndex];
        const raw=String(canonical?.rawContent||canonical?.content||'');
        const candidateOffset=raw===span.body?localStart:raw.indexOf(partText);
        const at=raw!==span.body&&candidateOffset>=0&&raw.indexOf(partText,candidateOffset+1)>=0?-1:candidateOffset;
        return [{messageId:span.messageId,messageIndex:span.messageIndex,role:span.role,
          startChar:localStart,endChar:localStart+partText.length,sourceStart:at,
          exactRawAnchor:at>=0,text:partText}];
      });
      if(!parts.length)throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED',`事实分片 ${i+1} 无可核对的剧情正文。`);
      return {...rangeScope,sourceStartIndex:Math.min(...parts.map(x=>x.messageIndex)),
        sourceEndExclusive:Math.max(...parts.map(x=>x.messageIndex))+1,
        sourceParts:parts.map(({text,...part})=>part),
        sourceRecordFragments:parts};
    });
  }
  // A fixed 360-character instruction is physically inconsistent with a
  // promise to preserve every independent event in a ten-round range. Plan a
  // soft output length from canonical events, never from fabricated summaries.
  // This changes only the Provider request; the stored user preference remains
  // intact, and the original source + mandatory coverage checks stay in force.
  function factOutputPlan(messages,requested){
    const records=arr(messages).filter(m=>m.role==='user'||m.role==='assistant');
    const clauses=records.reduce((n,m)=>n+String(m.rawContent||m.content||'').split(/[。！？；;\n]+/)
      .filter(t=>t.trim()).length,0);
    const advised=Math.min(12000,Math.max(requested,clauses*46));
    return {requestedChars:requested,advisedChars:advised,canonicalClauses:clauses,sourceMessageCount:records.length};
  }
  async function summarizeFactText(sourceText,targetChars,temp,signal,progress,label='事实记忆',job=null,rangeTag='fact',rangeScope=null,rangeMessages=[],sourceSession=null){
    const chunks=splitTextBlocks(sourceText,28000),partials=[];
    const partScopes=job&&sourceSession?factSourcePartScopes(sourceText,chunks,rangeScope,rangeMessages,sourceSession):chunks.map(()=>rangeScope);
    for(let i=0;i<chunks.length;i++){
      emitProgress(progress,{phase:'memory_fact',percent:12+Math.round(((i+.25)/chunks.length)*62),detail:`${label} · 正在总结 ${i+1}/${chunks.length}`});
      const prompt=[
        {role:'system',content:'你是“咪嘛馆”的事实记忆整理器。只记录输入剧情中明确发生过的事实，不补充、不猜测、不续写，不把推测写成事实。'+MEMORY_TIME_CONTRACT},
        {role:'user',content:`【剧情原文】\n${chunks[i]}\n\n请将上面的剧情整理成高密度“事实记忆”。逐一保留每件独立的已发生事件及其人物、物品、地点、否定、时间关系；同一行为发生两次不能合并成一次。不能杜撰新事件。按情节连续叙述，无须机械标序号。建议容量最多约 ${targetChars} 字，但事件完整性高于字数：不能为了压缩而丢掉任何一件事；材料少时更短即可。`}
      ];
      const stage=rangeTag+'_part_'+i;
      if(job){(job.stageScopes||(job.stageScopes={}))[stage]=partScopes[i]||rangeScope||{sourceStartIndex:0,sourceEndExclusive:job.sourceCount};}
      partials.push(await memoryModel(prompt,temp,signal,job,stage));
    }
    if(partials.length===1)return partials[0];
    emitProgress(progress,{phase:'memory_fact_merge',percent:78,detail:`${label} · 正在合并超长分片`});
    if(job)(job.stageScopes||(job.stageScopes={}))[rangeTag+'_merge']=rangeScope||{sourceStartIndex:0,sourceEndExclusive:job.sourceCount};
    return await memoryModel([
      {role:'system',content:'你是“咪嘛馆”的事实记忆整理器。把多个同一剧情区间的分段摘要合并为一个事实摘要。不得新增事实。'+MEMORY_TIME_CONTRACT},
      {role:'user',content:`【分段事实摘要】\n${partials.map((x,i)=>`[${i+1}] ${x}`).join('\n\n')}\n\n合并表达中的重复措辞，但独立发生的相同事件要保留其发生次数。保留每一来源分片里的所有独立事件、先后、人物、地点及否定；允许超过 ${targetChars} 字，不能靠删事件换取压缩率。`}
    ],temp,signal,job,rangeTag+'_merge');
  }
  function assertMemoryTaskActive(signal){
    if(signal?.aborted)throw new DOMException('记忆总结已由用户停止。','AbortError');
  }
  function commitMemoryIntoLatest(snapshot,kind,sourceType,apply){
    const latestRaw=getSession(snapshot.id);
    if(!latestRaw)throw new ApiError('E_STORY_SESSION_MISSING','会话已删除，迟到的记忆结果不能复活会话。');
    const latest=normalizeSession(latestRaw),base=normalizeSession(snapshot);
    // Full source prefix check: append-only chat is safe; edits, deletions, forks are not.
    const baselineMsgs=JSON.stringify(base.messages);
    if(JSON.stringify(latest.messages.slice(0,base.messages.length))!==baselineMsgs)
      throw new ApiError('E_MEMORY_SOURCE_STALE','总结过程中原剧情发生修改，结果尚未保存；请重新总结。');
    const oldMem=normalizeManualMemory(base.manualMemory),nowMem=normalizeManualMemory(latest.manualMemory);
    if(kind==='facts' && JSON.stringify(oldMem.facts)!==JSON.stringify(nowMem.facts))
      throw new ApiError('E_MEMORY_FACTS_CONFLICT','总结过程中事实记忆已被修改，未用旧结果覆盖新修改。');
    if(kind==='core' && JSON.stringify(oldMem.core)!==JSON.stringify(nowMem.core))
      throw new ApiError('E_MEMORY_CORE_CONFLICT','总结过程中核心记忆已被修改，未用旧结果覆盖新修改。');
    if(kind==='core'&&sourceType==='facts'&&JSON.stringify(oldMem.facts)!==JSON.stringify(nowMem.facts))
      throw new ApiError('E_MEMORY_SOURCE_STALE','用于总结的事实记忆已变化，请重新生成核心记忆。');
    latest.manualMemory=apply(nowMem);
    return latest;
  }
  async function runRecordedMemory(kind,id,opts={},signal=null,progress=null){
    const store=window.MimaLocalStore;
    const snapshot=getSession(id);if(!snapshot)throw new ApiError('E_STORY_SESSION_MISSING','剧情已不存在');
    if(typeof store?.beginMemoryJob!=='function')return kind==='core'?generateCoreMemory(id,opts,signal,progress):kind==='facts'?generateFactMemories(id,opts,signal,progress):refreshSummary(snapshot,opts.temperature,signal,progress);
    const original=normalizeSession(clone(snapshot));if(kind==='rolling'&&!summaryNeeded(original))return original;let job=null,heartbeat=null;
    try{
      const cfg=getApiConfig();const configSignature=fingerprint([cfg.apiBase,cfg.chatEndpoint,cfg.model,cfg.sendTemperature,cfg.maxTokens,cfg.stream]);
      const sourceFingerprint=memorySourceFingerprint(original.messages,original.messages.length);
      const targetBaseline=kind==='rolling'?JSON.stringify([original.rollingSummary||'',original.lastSummarizedIndex||0]):JSON.stringify(kind==='core'?normalizeManualMemory(original.manualMemory).core:normalizeManualMemory(original.manualMemory).facts);
      const sourceHash=fingerprint([sourceFingerprint,kind==='core'&&opts.source==='facts'?original.manualMemory.facts:null,kind==='rolling'?original.rollingSummary:null]);
      job=await store.beginMemoryJob({sessionId:id,kind,options:opts,sourceHash,sourceCount:original.messages.length,sourceFingerprint,targetBaseline,configSignature});
      if(typeof store.heartbeatMemoryJob==='function'&&typeof setInterval==='function'){
        heartbeat=setInterval(()=>store.heartbeatMemoryJob(job).catch(e=>{
          console.warn('Memory lease heartbeat failed',{sessionId:id,kind,jobId:job.id,attemptId:job.attemptId,stage:'heartbeat',code:e.code||e.message});
        }),10000);
      }
      await store.checkpointMemoryJob(job,'request_planned',{sourceCount:original.messages.length,sourceRevision:original.recordRevision});
      if(kind==='core')return await generateCoreMemory(id,opts,signal,progress,job,original);
      if(kind==='facts')return await generateFactMemories(id,opts,signal,progress,job,original);
      return await refreshSummary(original,opts.temperature,signal,progress,job);
    }catch(e){if(job){try{await store.settleMemoryJob(job,signal?.aborted||e.name==='AbortError'?'aborted':e.code==='E_MEMORY_NEEDS_REVIEW'?'needs_review':'failed',e.code||e.message||'E_MEMORY_FAILED');}catch(settle){e.settlementError=settle.message;}}throw e;}
    finally{if(heartbeat!==null)clearInterval(heartbeat);}
  }
  async function checkpoint(job,stage,info={}){if(job)await window.MimaLocalStore.checkpointMemoryJob(job,stage,info);}
  async function storeMemoryResult(job,snapshot,patch){
    const normalizedPatch=patch.manualMemory?{...patch,manualMemory:normalizeManualMemory(patch.manualMemory)}:patch;
    const committed=await window.MimaLocalStore.commitMemoryJob(job,snapshot,normalizedPatch);
    // Merge persisted current state, not the stale pre-request snapshot.
    state=normalizeState(committed);return getSession(job.sessionId);
  }
  // Verification of a quote is NOT verification of a model's interpretation.
  // Only extractive statements actually present in the supplied source can
  // acquire verified status without a human decision. Abstractive narratives
  // remain durable journal candidates, never canonical facts by default.
  // A source-memory record is NOT a story utterance. It carries an explicit
  // provenance chain; only human-approved or original-quote-verified facts may
  // act as sources for a downstream core memory. Legacy/stale facts stay in the
  // Store and remain visible for review but never acquire authority by copying.
  function trustedFactForCore(session,fact){
    if(!fact||fact.stale===true||!memorySourceValid(session,fact))return false;
    const verification=fact.verification||{};
    if(verification.status==='human_confirmed'){
      // An explicit human confirmation is itself an authority. Where it has
      // source citations, those references must still match the current history.
      return !arr(verification.citations).length||arr(verification.citations).every(c=>{
        const m=arr(session.messages).find(m=>m.id===c.messageId);
        const body=String(m?.rawContent||m?.content||'');
        return !!m&&body.slice(c.start,c.end)===c.quote;
      });
    }
    // A normal, bounded abstraction is not verbatim, but it can still be a
    // validated derived view. Recheck the original turn range now instead of
    // silently treating every automatically verified fact as untrusted.
    // Existing legacy/migrated records do not inherit trust from their label.
    if(verification.status==='source_bounded'){
      if(!fact.sourceCount||!fact.sourceFingerprint||!arr(verification.citations).length)return false;
      const data=storyRoundData(session);
      const selected=[...(fact.startRound===1?data.opening:[]),
        ...data.rounds.filter(r=>r.index>=fact.startRound&&r.index<=fact.endRound).flatMap(r=>r.messages)];
      if(!selected.length||!sourceEventLedger(selected,fact.content).complete)return false;
      return verification.citations.every(c=>{
        const m=arr(session.messages).find(m=>m.id===c.messageId);
        const body=String(m?.rawContent||m?.content||'');
        return !!m&&body.slice(c.start,c.end)===c.quote;
      });
    }
    if(verification.status!=='extractive_verified'||!arr(verification.citations).length)return false;
    return verification.citations.every(c=>{
      const m=arr(session.messages).find(m=>m.id===c.messageId);
      const body=String(m?.rawContent||m?.content||'');
      return !!m&&body.slice(c.start,c.end)===c.quote;
    });
  }
  // R9: verify source-derived event units, not the presence of an entire
  // utterance in an abbreviated summary. This is a conservative, deterministic
  // *bounded* abstraction verifier, NOT a semantic truth oracle. A source
  // citation alone never counts as event coverage. Unsupported/ambiguous
  // interpretations remain reviewable, with the existing journal and cursor.
  function memoryEventKey(text){
    return String(text||'').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
  }
  function chineseCount(n){
    if(n<1||n>999)return String(n);
    const digit='零一二三四五六七八九';
    if(n<10)return digit[n];
    if(n<20)return '十'+(n===10?'':digit[n%10]);
    if(n<100)return digit[Math.floor(n/10)]+'十'+(n%10?digit[n%10]:'');
    return digit[Math.floor(n/100)]+'百'+(n%100?(n%100<10?'零':'')+chineseCount(n%100):'');
  }
  function eventFrameFlags(t){
    t=String(t||'');
    return {
      neg:/(?:没有|并未|未曾|不曾|否认|绝非|并不|不是|不会|拒绝|无意)/.test(t),
      rumor:/(?:谣言|造谣|传闻|据说|听说|声称|未经证实|尚未证实|没有确证)/.test(t),
      conditional:/(?:假设|假如|如果|倘若|可能|或许|猜测|怀疑|似乎)/.test(t),
      dream:/(?:梦见|梦中|梦里|幻想|想象)/.test(t)
    };
  }
  function eventActionGuard(source,summary){
    // High-impact changes require a matching source action family. Every
    // asserted group must already occur in the canonical material; shared
    // names/objects or made-up citations cannot make a reversal permissible.
    const families=[['谋杀','杀害','杀死','杀人','杀'],['营救','救出','拯救','救'],['偷走','偷窃','盗窃','窃取','偷'],['背叛'],['绑架'],['纵火','放火'],['烧毁','焚毁','烧掉'],['摧毁','毁灭','毁掉'],['伤害','攻击','打伤'],['死亡','死去','遇难'],['怀孕'],['离婚'],['结婚'],['欺骗','骗'],['拒绝'],['同意','答应'],['承诺','许诺','约定','契约'],['原谅'],['复活'],['自杀'],['伪造'],['掉包'],['失踪']];
    return families.every(group=>!group.some(w=>summary.includes(w))||group.some(w=>source.includes(w)));
  }
  // R10: event-unit coverage must bind *each* canonical event to a particular
  // summary claim. Shared words, an action anywhere in the summary, or citations
  // alone do not prove that two people/objects/locations received the same fate.
  function sourceEventLedger(records,summary){
    const covered=[],missing=[],groups=new Map();
    const source=arr(records).filter(m=>['user','assistant','memory_source'].includes(m.role)&&String(m.rawContent||m.content||'').trim());
    const normalize=memoryEventKey;
    const grams=(v,n)=>{v=normalize(v);const out=new Set();for(let i=0;i<=v.length-n;i++)out.add(v.slice(i,i+n));return out;};
    const claims=String(summary||'').split(/[。！？；;\n，,]+/).map(x=>x.trim()).filter(Boolean);
    const normalizedSummary=normalize(summary);
    const exactClaims=new Set(claims.map(normalize));
    const highImpact=['杀死','杀害','谋杀','击败','营救','救出','偷走','盗窃','背叛','烧毁','毁灭','打伤','攻击','拒绝','同意','答应','承诺','约定','原谅','复活','失踪','死亡','死去','伪造','绑架','离婚','结婚','否认'];
    const hasImpact=t=>highImpact.some(w=>t.includes(w));
    // Consent is a *local* semantic family, not an interchangeable substring.
    // It may match different surface verbs only after polarity, actor and
    // recipient checks succeed on the same canonical source clause.
    const consentWords=['答应','同意'];
    const consentEquivalent=(a,b)=>consentWords.some(w=>a.includes(w))&&consentWords.some(w=>b.includes(w));
    const matchedAction=(original,claim,verb)=>verb==='答应'||verb==='同意'
      ?consentWords.find(w=>claim.includes(w))||'':claim.includes(verb)?verb:'';
    // Split true independent sentences; never mistake multiple messages sharing
    // one template for a single event. Preserve offsets for audit/review.
    for(let i=0;i<source.length;i++){
      const m=source[i],body=String(m.rawContent||m.content||'');
      const parts=[...body.matchAll(/[^。！？；;\n]+[。！？；;\n]?/g)];
      for(const match of parts){
        const part=match[0].trim(),norm=normalize(part);
        if(!norm)continue; // "同意" and "拒绝" are meaningful events, not noise.
        const template=norm.replace(/第[0-9一二三四五六七八九十百千]+(天|封|条|轮|日|次)/g,'第#$1');
        const flags=eventFrameFlags(part),key=template+'|'+JSON.stringify(flags);
        if(!groups.has(key))groups.set(key,{template,body:part,normalized:norm,flags,members:[],numbers:[],varied:false});
        const group=groups.get(key);
        const numbers=[...norm.matchAll(/第([0-9]+)(天|封|条|轮|日|次)/g)].map(x=>Number(x[1]));
        group.members.push({record:m,part,index:m.messageIndex??i,offset:match.index||0});
        if(numbers.length)group.numbers.push(numbers[0]);
        if(norm!==group.normalized)group.varied=true;
      }
    }
    const list=[...groups.values()];
    // Extract the discriminating span between near-identical source events.
    // E.g. 艾琳杀死了[甲]方 vs 艾琳杀死了[乙]方; both MUST be accounted for.
    // This is not a semantic theorem: uncertain cases stay reviewable.
    function contrast(a,b){
      const x=a.normalized,y=b.normalized;
      if(x===y)return '';
      let start=0;while(start<Math.min(x.length,y.length)&&x[start]===y[start])start++;
      let end=0;while(end<x.length-start&&end<y.length-start&&x[x.length-1-end]===y[y.length-1-end])end++;
      const diff=x.slice(start,x.length-end);
      // A common object suffix is not evidence that two DIFFERENT actor/action
      // events share a single replaceable object slot. Requiring the entire
      // different actor+verb string verbatim prevents faithful paraphrases
      // of separate events mentioning the same box/person. Subject and verb
      // are instead checked by the local action/actor guards below.
      if(start<3&&(hasImpact(a.body)||hasImpact(b.body)))return '';
      const common=Math.min(start+end,Math.min(x.length,y.length));
      return diff&&common>=Math.max(3,Math.floor(Math.min(x.length,y.length)*0.48))?diff:'';
    }
    function preciseNumber(count,unit='次'){
      return new RegExp('(?:连续|共计|累计|历时|总共|共|合计|前后|一连|整整|重复|先后|发生|做了)?[^。；\\n]{0,3}(?:'+count+'|'+chineseCount(count)+')'+unit).test(summary);
    }
    const eventIdentityAnchors=original=>[...String(original).matchAll(/第\d+(?:天|日|轮|次|条|封)|(?:地图碎片|物品|钥匙|线索|卷轴|档案)\d+/g)].map(x=>normalize(x[0]));
    function eventSlotsPreserved(original,claim,isOrdinalSeries){
      // Actor/object/place assertions are checked against THIS clause; an
      // invented victim must not pass only because actor/action words overlap.
      // Unknown word orders are left for review, not called verified.
      if(isOrdinalSeries)return true; // Quantified canonical ordinal ranges.
      const src=normalize(original),dst=normalize(claim);
      // Event predicates are not interchangeable just because the actor and
      // object overlap. A lexical-only score previously equated getting and
      // losing the same item, or picking it up and borrowing it. Keep this a
      // local, per-claim check; unsupported novel paraphrases go to review.
      const actionFamilies=[
        ['拿到','拿到了','获得','取得','得到','捡到','拾到','找到了','找到'],
        ['遗失','失去','丢失','丢掉','扔掉','抛弃'],
        ['借走','借到','借了','借取'],
        ['交给','交予','递给','送给','赠给','归还'],
        ['偷走','盗走','偷窃','盗窃'],
        ['藏起','藏了','藏在','躲藏'],
        ['躲在','躲进','藏身于'],
        ['发现','看见','看到','目击'],
        ['关闭','关上','关掉'],
        ['打开','开启','开启了'],
        ['拿起','捡起','举起'],
        ['放进','放入','放到','摆进','置于']
      ];
      const actionClass=t=>actionFamilies.findIndex(group=>group.some(w=>t.includes(w)));
      const originalClass=actionClass(src),claimClass=actionClass(dst);
      if(originalClass>=0&&claimClass!==originalClass)return false;
      if(originalClass<0&&claimClass>=0)return false;
      // Distinguish narrative locations attached to ordinary predicates.
      // "躲在柜子里" and "躲在花园里" must not share a factual source.
      const hideLoc=src.match(/(?:躲在|躲进|藏身于)([^，。；;]{2,14})/);
      if(hideLoc&&!dst.includes(hideLoc[1]))return false;
      // A numbered story turn or a numbered unique object is an identity
      // anchor, not interchangeable vocabulary. N-grams from 2..3000 other
      // events cannot prove the missing '第0条/物品0' event. For genuine ordinal
      // series the count/range check above is the only permitted compression.
      const identities=eventIdentityAnchors(original);
      if(identities.some(anchor=>!dst.includes(anchor)))return false;
      const verbs=['杀死','杀害','谋杀','击败','营救','救出','偷走','背叛','绑架','烧毁','放火','拒绝','同意','答应','承诺','约定','原谅','放进','放到','放入','送回','交给','归还','交出','偷窃','摧毁','毁掉','打伤','攻击','关闭','打开','获得','失去','目击',
        '拿到','找到','发现','看到','看见','得到','取得','捡到'];
      const verb=verbs.find(w=>src.includes(w));
      if(!verb)return true;
      const at=src.indexOf(verb),after=src.slice(at+verb.length).replace(/^[了过掉得将把向给]/,'');
      // For a short unambiguous object, the actual object MUST occur locally.
      // Compound objects are separate assertions; they all need grounding.
      const object=after.split(/(?:然后|随后|接着|因此|因为|于是|同时|并且)/)[0];
      if(object&&object.length<=14){
        const items=object.split(/(?:和|与|以及|及)/).filter(t=>t.length>=2);
        // A source location phrase may be moved ahead of the action in a
        // faithful summary: “约定在港口见面” → “在港口约定见面”. The location
        // AND the remaining event must still appear in this same claim.
        const reorderedLocation=(item)=>{
          const match=item.match(/^在(.{2,8}?)(见面|会合|等待|交谈|碰头)$/);
          return !!match&&dst.includes('在'+match[1])&&dst.includes(match[2]);
        };
        if(items.length&&!items.every(t=>dst.includes(t)||reorderedLocation(t)))return false;
      }
      // The candidate must not introduce an additional object into the SAME
      // action claim (e.g. source 甲方 -> claim 甲方和乙方). Check nouns after
      // the matched action rather than relying on global n-gram overlap.
      const claimVerb=matchedAction(original,claim,verb);
      if(hasImpact(original)&&claimVerb){
        const candidateTail=dst.slice(dst.indexOf(claimVerb)+claimVerb.length)
          .replace(/^[了过掉得将把向给]/,'')
          .replace(/(?:共计|累计|总共|共|先后|连续|各|整整)?[0-9一二三四五六七八九十百]+(?:次|回|遍|天|条|封)$/, '');
        const claimedObjects=candidateTail.split(/(?:和|与|以及|及)/).filter(v=>v.length>=2);
        if(claimedObjects.length&&!claimedObjects.every(v=>src.includes(v)))return false;
      }
      const location=src.match(/在([^，。]{2,12}?)(?=击败|杀死|杀害|攻击|拒绝|偷走|放火)/);
      if(location&&!dst.includes(location[1]))return false;
      const prefix=src.slice(0,at).replace(/^(?:第[0-9一二三四五六七八九十百千]+[天日轮次])/, '').replace(/[了将把]/g,'');
      // A location belongs to THIS actor's event, not an unrelated clause.
      // Word order may change (actor 在 place verb / actor verb 在 place),
      // but silently replacing a place must not become a verified fact.
      // Likewise “把/将” are particles, not part of the actor name.
      const withoutObjectMarkers=t=>t.replace(/[把将]/g,'');
      const placePrefix=prefix.match(/^(.{2,12}?)在([^在]{2,12})$/);
      if(placePrefix){
        if(!withoutObjectMarkers(dst).includes(withoutObjectMarkers(placePrefix[1]))||
           !dst.includes(placePrefix[2]))return false;
      }else if(prefix&&prefix.length>=2&&prefix.length<=12&&
         !withoutObjectMarkers(dst).includes(withoutObjectMarkers(prefix))&&
         !withoutObjectMarkers(dst).includes(withoutObjectMarkers(src.slice(0,at))))return false;
      return true;
    }
    // Index identity-bearing claims once. A split source sentence containing
    // a unique '第N条/物品N' anchor otherwise scans up to 3000 unrelated
    // clauses before finding its own evidence (or proving it is missing).
    const identityClaimIndex=new Map();
    for(const claim of claims)for(const anchor of eventIdentityAnchors(claim)){
      if(!identityClaimIndex.has(anchor))identityClaimIndex.set(anchor,[]);
      identityClaimIndex.get(anchor).push(claim);
    }
    for(const group of list){
      const original=group.members.map(x=>x.part).join('\n');
      const allFlags=group.flags;
      const bi=grams(group.body,2),tri=grams(group.body,3);
      // A literal complete source event already contains every discriminating
      // span belonging to that event. Comparing it pairwise with N other
      // events produces O(N²) work without strengthening its proof. Keep the
      // original contrast test for genuinely abstractive/paraphrased claims.
      const literalInFull=normalizedSummary.includes(group.normalized);
      // First fail fast on missing immutable identities. Otherwise a single
      // absent numbered event among 3000 forces a quadratic contrast/claim
      // search even though its canonical ordinal cannot occur in any proof.
      const anchors=eventIdentityAnchors(group.body);
      const missingIdentity=!group.varied&&anchors.some(anchor=>!normalizedSummary.includes(anchor));
      const candidateClaims=!group.varied&&anchors.length?arr(identityClaimIndex.get(anchors[0])).filter(c=>anchors.every(a=>normalize(c).includes(a))):null;
      const differences=(literalInFull||missingIdentity)?[]:list.filter(other=>other!==group).map(other=>contrast(group,other)).filter(Boolean);
      let quantityOK=true;
      if(group.varied){
        const nums=[...new Set(group.numbers)].sort((a,b)=>a-b),n=nums.length;
        const consecutive=n===group.members.length&&nums.every((v,i)=>v===nums[0]+i);
        const units=[...new Set([...group.body.matchAll(/第[0-9一二三四五六七八九十百千]+(天|封|条|轮|日|次)/g)].map(x=>x[1]))];
        const countWords=String(n)+'|'+chineseCount(n);
        const explicit=units.some(unit=>new RegExp('(?:连续|共计|累计|历时|总共|共|合计|前后|一连|整整)[^。；\\n]{0,5}(?:'+countWords+')'+unit).test(summary));
        const first=nums[0],last=nums[nums.length-1];
        const range=units.some(unit=>new RegExp('第(?:'+first+'|'+chineseCount(first)+')(?:'+unit+')?(?:至|到|—|～|~|-)(?:第)?(?:'+last+'|'+chineseCount(last)+')'+unit).test(summary));
        // Explicitly preserving EVERY distinct ordinal source clause is at
        // least as strong as a counted range. Never require the model to
        // collapse 25 verbatim numbered events into one lossy series claim.
        const allMembersQuoted=group.members.every(member=>normalizedSummary.includes(normalize(member.part)));
        quantityOK=allMembersQuoted||(consecutive&&n>1&&(explicit||range));
      }else if(group.members.length>1){
        const n=group.members.length,exact=(normalizedSummary.split(group.normalized).length-1)>=n;
        // Identical canonical messages carry the SAME event text, not n
        // independently discriminable ordinal events. A literal full-source
        // quotation may cover their repeated evidence without inventing a
        // numeric occurrence count. Paraphrases still need an explicit count,
        // and ordinal/actor-differentiated events use the varied branch above.
        // Never grant this exemption to a near-match or a partially quoted event.
        // Byte-for-byte identical, unnumbered neutral messages may be a
        // retransmission of the SAME state; never fabricate n distinct events.
        // Explicit day/ordinal/action identities remain distinct in the
        // varied-series branch, and consequential actions require counts.
        const literalDuplicate=!hasImpact(group.body)&&group.members.every(member=>normalize(member.part)===group.normalized)&&
          normalizedSummary.includes(group.normalized);
        quantityOK=exact||literalDuplicate||['次','回','遍'].some(u=>preciseNumber(n,u));
      }
      // A verbatim canonical utterance may contain commas that the candidate
      // clause splitter treats as separate clauses. Test the whole summary
      // ONLY when it literally contains the whole original event; otherwise
      // each paraphrased claim must satisfy the existing local checks.
      // Exact, standalone source clauses already satisfy the original local
      // polarity/action/actor/contrast checks. Preserve the full conservative
      // scan for anything shortened, rephrased or joined across clauses.
      // A literal whole source clause containing commas may be split into
      // several candidate claims. The byte-identical citation is stronger
      // evidence than the per-claim index and must not be rejected just
      // because ordinal and object anchors appear on different sides of ',' .
      const exactOriginalQuoted=group.members.every(member=>String(summary).includes(member.part));
      const supports=!missingIdentity&&(exactOriginalQuoted||(!group.varied&&group.members.length===1&&exactClaims.has(group.normalized))|| (candidateClaims??(group.varied?[summary]:literalInFull?[...claims,summary]:claims)).some(claim=>{
        const text=normalize(claim),cbi=grams(text,2),ctri=grams(text,3);
        const direct=text.includes(group.normalized);
        const overlap=bi.size>0&&[...bi].filter(g=>cbi.has(g)).length/bi.size>=0.40&&[...tri].filter(g=>ctri.has(g)).length>=2;
        const brief=group.normalized.length<4&&text.includes(group.normalized);
        const flags=eventFrameFlags(claim);
        const framing=Object.keys(allFlags).every(k=>!allFlags[k]||flags[k]);
        const notContradicted=Object.keys(flags).every(k=>!flags[k]||allFlags[k]);
        const actionOK=eventActionGuard(group.body,claim) &&
          (!hasImpact(group.body)||hasImpact(claim) &&
            (highImpact.some(w=>group.body.includes(w)&&claim.includes(w))||consentEquivalent(group.body,claim)));
        // A contrast is anchored to THIS claim, not to unrelated words elsewhere
        // in the candidate. Grouping can compress *ordinals*, not actual actors.
        const distinguish=differences.every(diff=>text.includes(diff));
        const slots=eventSlotsPreserved(group.body,claim,group.varied);
        return (direct||overlap||brief)&&framing&&notContradicted&&actionOK&&distinguish&&slots;
      }));
      const ok=quantityOK&&supports;
      for(const item of group.members){
        const m=item.record,entry={messageId:m.id,index:item.index,eventId:String(m.id)+':'+item.offset,offset:item.offset,
          sourceFingerprint:fingerprint([m.id,m.role,m.rawContent,m.content,m.versions]),anchor:item.part.slice(0,120),
          proof:ok?(group.varied?'bounded_ordinal_series':group.members.length>1?'counted_repeat':'local_event_claim'):null};
        (ok?covered:missing).push(entry);
      }
    }
    const allText=source.map(m=>String(m.rawContent||m.content||'')).join('\n');
    const sourceBi=grams(allText,2),sourceTri=grams(allText,3),normalizedSource=normalize(allText);
    // Bigram overlap against all of History is not proof of a particular
    // actor/action/object. A fabricated high-impact clause can otherwise borrow
    // its verb from one event and its nouns from others. For paraphrased risky
    // claims, require a compatible LOCAL canonical event, not global overlap.
    const sourceClauses=source.flatMap(m=>String(m.rawContent||m.content||'')
      .split(/[。！？；;\n]+/).map(x=>x.trim()).filter(Boolean));
    const riskyClaimSupported=claim=>sourceClauses.some(original=>{
      if(!highImpact.some(w=>claim.includes(w)&&original.includes(w))&&!consentEquivalent(original,claim))return false;
      const src=normalize(original),dst=normalize(claim);
      const sBi=grams(src,2),sTri=grams(src,3),dBi=grams(dst,2),dTri=grams(dst,3);
      if(!sBi.size||[...sBi].filter(g=>dBi.has(g)).length/sBi.size<0.4||![...sTri].some(g=>dTri.has(g)))return false;
      const sourceFlags=eventFrameFlags(original),claimFlags=eventFrameFlags(claim);
      if(!Object.keys(sourceFlags).every(k=>sourceFlags[k]===claimFlags[k]))return false;
      return eventActionGuard(original,claim)&&eventSlotsPreserved(original,claim,false);
    });
    const grounded=claims.length>0&&claims.every(claim=>{
      const token=normalize(claim),bi=grams(token,2),tri=grams(token,3);
      if(normalizedSource.includes(token))return true;
      if(token.length<4)return false;
      const lexical=[...bi].filter(g=>sourceBi.has(g)).length/Math.max(1,bi.size)>=0.29&&[...tri].some(g=>sourceTri.has(g));
      return lexical&&(!hasImpact(claim)||riskyClaimSupported(claim));
    });
    const safe=source.length>0&&grounded&&eventActionGuard(allText,summary)&&
      Object.keys(eventFrameFlags(summary)).every(k=>!eventFrameFlags(summary)[k]||eventFrameFlags(allText)[k]);
    if(!safe)missing.push(...covered.splice(0));
    return {complete:source.length>0&&covered.length+missing.length>0&&missing.length===0,
      covered,missing,expected:covered.length+missing.length,units:list.length,contract:'r10_canonical_event_claims'};
  }
  function validateRollingCoverage(session,start,end,summary,job,stage){
    // A rolling result REPLACES the previous summary. Checking only new messages
    // would permit erasing every older verified event while advancing the cursor.
    // Revalidate the canonical prefix that the replacement claims to cover.
    // Never treat the previous model-written summary as historical evidence.
    const coveredStart=0;
    const source=arr(session.messages).slice(coveredStart,end).map((m,i)=>({...m,messageIndex:coveredStart+i}));
    const proof=sourceEventLedger(source,summary);
    return {...proof,range:[coveredStart,end],newRange:[start,end],stage};
  }
  function validateMemoryCandidate(messages,candidate,stage,finishReason='unknown',requiresSourceLink=false,sourceRecords=[]){
    const originalRaw=String(candidate||'').trim();
    const fenced=originalRaw.match(/^```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/);
    const fenceTag=fenced?.[1]?.toLowerCase()||'';
    const raw=fenced&&['','json','text','txt','plaintext','md','markdown'].includes(fenceTag)?fenced[2].trim():originalRaw;
    // Present the extracted summary rather than requiring users to edit raw JSON.
    let memory=raw,formal=false,evidence=[];
    // Verify against immutable canonical source fragments when available, not
    // the prompt wrapper: it can contain instructions, and the player-only
    // filter misses genuine assistant-origin evidence. Never cite prompt text
    // as proof that a story event actually occurred.
    const source=sourceRecords.length
      ?sourceRecords.filter(m=>m.role!=='memory_source'||m.trustedStatus).map(m=>String(m.rawContent||m.content||'')).join('\n')
      :messages.filter(m=>m.role==='user').map(m=>String(m.content||'')).join('\n');
    const invalid=(reason,review=false)=>{const issue=new ApiError(review?'E_MEMORY_NEEDS_REVIEW':'E_MEMORY_OUTPUT_INVALID',
      review?'摘要包含无法由原文逐字验证的叙述，已作为候选保留，未写入长期记忆。':'记忆候选未通过来源与输出契约校验，旧记忆已保留。',{
      details:JSON.stringify({stage,reason,chars:raw.length,finishReason,formatValidated:true,sourceVerified:!review,factVerified:false}),
      hint:review?'请在记忆任务记录中查看待核查候选；核对原始剧情后可通过手工编辑记忆明确采纳。':'请检查记忆任务阶段诊断；无效输出不能进入长期记忆。'});
      issue.candidateForReview=review?memory:null;issue.validationReason=reason;throw issue;};
    if(!raw||/^(?:\.{3,}|[.…]{2,}|null|undefined|n\/?a|todo|placeholder)$/i.test(raw))invalid('placeholder');
    if(/^(?:system|developer|assistant)\s*:/i.test(raw)||/\[im_start\]|<\|im_start\|>|<!--\s*(system|developer)/i.test(raw))invalid('control_plane');
    if(['length','max_tokens','content_filter'].includes(String(finishReason).toLowerCase()))invalid('truncated_or_filtered');
    if(raw.startsWith('```'))invalid('unsupported_fenced_output');
    if(fenceTag==='json'&&!raw.startsWith('{'))invalid('malformed_structured_output');
    if(raw.startsWith('{')){
      let parsed;try{parsed=JSON.parse(raw);}
      catch{invalid('malformed_structured_output');}
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||typeof parsed.memory!=='string')invalid('structured_schema');
      memory=parsed.memory.trim();formal=true;evidence=Array.isArray(parsed.evidence)?parsed.evidence:[];
      if(!evidence.length||!evidence.every(e=>typeof e?.quote==='string'&&e.quote.trim().length>=3&&source.includes(e.quote.trim())))invalid('evidence_not_in_source');
    }
    if(!memory||/^(?:\.{3,}|null|n\/?a|todo|placeholder)$/i.test(memory))invalid('empty_memory');
    // Time words in an unanchored paraphrase must not become canonical facts.
    if(sourceRecords.length&&!['rolling_part_'].some(x=>stage.startsWith(x))&&/(?:昨天|前天|大前天|今天|明天|刚才|昨晚|昨日|今日)/.test(memory)&&!/(?:昨天|前天|大前天|今天|明天|刚才|昨晚|昨日|今日)/.test(source))invalid('relative_time_not_in_source',true);
    const standaloneRefusal=/^(?:i(?:'| a)?m sorry[,!. ]*(?:but )?(?:i (?:can(?:not|'t)|am unable)|as an ai)|i can(?:not|'t) (?:assist|help|comply)|as an ai (?:language )?model|对不起[，, ]*(?:我无法|我不能|作为)|抱歉[，, ]*(?:我无法|我不能|作为)|很抱歉[，, ]*(?:我无法|我不能|作为))/i;
    if(standaloneRefusal.test(memory)&&!(/(?:说道|回答|告诉|表示|原话|台词|说[:：]|said|replied|quoted|“|「)/i.test(memory)&&source.includes(memory)))invalid('provider_refusal');
    if(standaloneRefusal.test(memory)&&!source.includes(memory))invalid('provider_refusal');
    // Punctuation and whitespace may vary, but actors, tense, negations,
    // identity and commitments may not be invented via a two-character match.
    const normalized=t=>String(t).replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
    const quoteParts=formal?evidence.map(e=>e.quote.trim()):[source];
    const verifiable=quoteParts.some(q=>normalized(q).includes(normalized(memory))) ||
      (formal&&evidence.length>1&&normalized(evidence.map(e=>e.quote).join('')).includes(normalized(memory)));
    // Source-backed normal summary mode: the model selects original utterances,
    // while its *paraphrase* is never silently promoted to a factual authority.
    // Cross-message paraphrases may be used as a proposal only if a conservative
    // lexical guard finds no new event/polarity/epistemic assertion; canonical
    // memory stores the cited source text, not the unverifiable paraphrase.
    let groundedQuotes=null;
    if(!verifiable&&formal&&sourceRecords.length&&evidence.length){
      const linked=evidence.map(e=>{
        const quote=e.quote.trim();
        return sourceRecords.find(m=>(m.role!=='memory_source'||m.trustedStatus)&&
          String(m.rawContent||m.content||'').trim()===quote);
      });
      if(linked.every(Boolean)){
        const base=evidence.map(e=>e.quote.trim()).join('');
        const grams=t=>{const chars=normalized(t);return Array.from({length:Math.max(0,chars.length-1)},(_,i)=>chars.slice(i,i+2));};
        const baseGrams=new Set(grams(base));const candidateGrams=grams(memory);
        const lexicalCoverage=candidateGrams.filter(g=>baseGrams.has(g)).length/Math.max(1,candidateGrams.length);
        const dangerWords=['据说','听说','传闻','谣言','声称','否认','误会','假设','假如','如果','或许','可能','梦见','梦里','想象','似乎','并未','没有','不是','不曾','未曾'];
        const newRisk=dangerWords.some(w=>memory.includes(w)&&!base.includes(w));
        const omittedRisk=dangerWords.some(w=>base.includes(w)&&!memory.includes(w));
        const sourceNeg=/[未不](?:曾|会|要|是|能|再|敢|想|知道|相信|答应|同意|承认|背叛|偷|杀|做)/g;
        const negatives=t=>[...t.matchAll(sourceNeg)].map(x=>x[0]);
        const bNeg=negatives(base.replace(/不相互/g,'不')),mNeg=negatives(memory.replace(/不相互/g,'不'));
        const polarityChanged=bNeg.some(w=>!mNeg.some(x=>x===w))||mNeg.some(w=>!bNeg.includes(w));
        // Reject new high-impact actions even when generic actors and objects
        // overlap; the canonical projection must not launder unsupported claims.
        const actionGroups=[['杀','谋杀','杀害'],['伤害','打伤','攻击'],['救','营救'],['偷','盗窃','偷窃'],['欺骗','骗'],['背叛'],['抢','抢夺'],['放火','纵火'],['绑架'],['怀孕'],['结婚'],['离婚'],['死亡','死去'],['原谅'],['拒绝'],['同意'],['承诺','许诺','约定','契约']];
        const unsupportedAction=actionGroups.some(group=>group.some(w=>memory.includes(w))&&!group.some(w=>base.includes(w)));
        // Require substantial direct overlap; synonyms without a provable
        // source phrase remain pending human review, rather than guessed true.
        if(lexicalCoverage>=0.32&&!newRisk&&!omittedRisk&&!polarityChanged&&!unsupportedAction){
          groundedQuotes=linked.map((src,i)=>`【${src.role==='user'?'玩家':src.role==='assistant'?'角色':'剧情原文'}】${evidence[i].quote.trim()}`);
        }
      }
    }
    // Preserve faithful, source-bounded natural compression as natural text.
    // This independent proof scans all canonical source messages, not merely
    // the two citations selected by the provider. It never upgrades a source-
    // bounded interpretation into an extractively verified historical fact.
    const semanticProof=sourceRecords.length&&sourceEventLedger(sourceRecords,memory);
    const bounded=!!semanticProof?.complete;
    // A fact stage promises exhaustive coverage of its fenced source range.
    // Merely copying one true, whole source message must NOT let an incomplete
    // fact range commit. Core is selective; rolling final keeps its separate
    // coverage / one bounded repair path below.
    // Oversized utterances can be split mid-sentence. A fragment-stage
    // quotation is provisional, never a canonical fact: the mandatory
    // full-range fact_merge validates EVERY original event before commit.
    // An unsplit fact range must satisfy coverage at this stage directly.
    const provisionalFragment=stage.startsWith('fact_')&&/_part_\d+$/.test(stage)&&
      sourceRecords.length>0&&sourceRecords.every(m=>Number.isInteger(m.sourceOriginalOffset))&&verifiable;
    if(stage.startsWith('fact_')&&sourceRecords.length&&!bounded&&!provisionalFragment)
      invalid('fact_range_events_missing',true);
    // Core is selective, unlike exhaustive fact/rolling ranges. A structured
    // core candidate may paraphrase only its *explicitly cited* canonical
    // utterances. Resolve each quote to a complete, currently valid record,
    // then run the exact same local event/polarity/object proof on that set.
    // Never use unrelated History to fill gaps in an invented core claim.
    let selectiveProof=null;
    if(!verifiable&&!bounded&&formal&&stage.startsWith('core_')&&evidence.length&&sourceRecords.length){
      const cited=evidence.map(({quote})=>sourceRecords.find(m=>
        (m.role!=='memory_source'||m.trustedStatus)&&
        String(m.rawContent||m.content||'').trim()===quote.trim()));
      if(cited.every(Boolean))selectiveProof=sourceEventLedger(cited,memory);
    }
    const locallyBounded=!!selectiveProof?.complete;
    if(!verifiable&&!bounded&&!locallyBounded&&!groundedQuotes)invalid(formal?'unsupported_abstractive_claim':'plain_text_requires_review',true);
    if(!verifiable&&!bounded&&!locallyBounded&&groundedQuotes)memory=groundedQuotes.join('\n');
    // An instruction string is not an event source. Resolve actual canonical
    // message IDs and exact byte offsets before reporting evidence as verified.
    const provenance=[];
    const citations=formal?evidence.map(x=>x.quote.trim()):[memory];
    for(const quote of citations){
      const linked=sourceRecords.flatMap(m=>{
        const raw=String(m.rawContent||m.content||'');const offset=raw.indexOf(quote);
        return offset<0?[]:[{messageId:m.id,role:m.role,start:offset+(m.sourceOriginalOffset||0),end:offset+(m.sourceOriginalOffset||0)+quote.length,quote}];
      });
      if(sourceRecords.length&&!linked.length&&!bounded&&!locallyBounded)invalid('evidence_not_in_original_messages',true);
      provenance.push(...linked);
    }
    if(bounded&&!provenance.length){
      // Multi-utterance verbatim summaries can be verifiable as a WHOLE, but
      // cannot occur within any ONE message. Anchor their proven coverage to
      // each canonical fragment rather than falsely reporting no provenance.
      // The audit trail comes from canonical source records, never the
      // provider's selectively cited first/last examples. Bound each anchor
      // to a real source offset without copying massive original messages
      // into the memory metadata; the unchanged History retains full text.
      provenance.length=0;
      for(const m of sourceRecords){
        const body=String(m.rawContent||m.content||'');
        const quote=body.slice(0,120);
        if(quote)provenance.push({messageId:m.id,role:m.role,start:m.sourceOriginalOffset||0,end:(m.sourceOriginalOffset||0)+quote.length,quote});
      }
    }
    if(sourceRecords.length&&!provenance.length)invalid('no_message_provenance',true);
    // A fact-range summary promises coverage of its entire selected range.
    // A core memory is explicitly selective: choosing one true early event is
    // not evidence that other events were lost. Applying the fact completeness
    // heuristic to core_final_* incorrectly rejects legitimate core extracts
    // once the story has enough turns (R11.17 smoke-seventh benchmark).
    // Rolling and fact completeness are still checked on their own scopes.
    if(stage.startsWith('fact_')&&sourceRecords.length>=12){
      const unique=sourceRecords.filter(m=>['user','assistant'].includes(m.role));
      const distinct=new Set(unique.map(m=>String(m.rawContent||m.content||'').trim())).size;
      const citedIds=new Set(provenance.map(x=>x.messageId));
      const earlyIds=new Set(unique.slice(0,Math.max(2,Math.floor(unique.length/5))).map(m=>m.id));
      if(distinct>=6&&citedIds.size>0&&citedIds.size<=2&&[...citedIds].every(id=>earlyIds.has(id)))
        invalid('suspicious_first_round_only',true);
    }
    // Provenance proves that words appeared, not that a rumored, denied or
    // hypothetical event happened. Only a complete source utterance can pass
    // automatic extractive mode. Partial quotations and rephrasings require
    // a reviewable human decision. No claim is promoted solely by its overlap.
    if(sourceRecords.length&&!bounded&&!locallyBounded){
      const supported=provenance.some(p=>{
        const src=sourceRecords.find(m=>m.id===p.messageId);
        const content=String(src?.rawContent||src?.content||'').trim();
        return (normalized(content)===normalized(memory)||!!groundedQuotes&&evidence.some(e=>normalized(e.quote)===normalized(content))) && (p.role!=='memory_source'||!!src?.trustedStatus);
      });
      if(!supported)invalid('claim_not_whole_source_utterance',true);
    }
    return {memory,contract:bounded&&!verifiable?'bounded_source_events':locallyBounded?'selective_bounded_source_events':groundedQuotes?'source_quote_projection':formal?'extractive_json':'extractive_plain_text',evidenceCount:evidence.length,
      provenance,semanticCoverage:bounded||locallyBounded?{unitCount:(bounded?semanticProof:selectiveProof).units,coveredCount:(bounded?semanticProof:selectiveProof).covered.length,
        sourceFingerprint:fingerprint((bounded?semanticProof:selectiveProof).covered.map(x=>x.sourceFingerprint))}:null,
      verification:{format:'valid',source:sourceRecords.length?'message_offsets':'prompt_extract_only',fact:(bounded&&!verifiable)||locallyBounded?'bounded_source':'extractive',stage}};
  }
  async function memoryModel(messages,temp,signal,job,stage){
    const activeSession=job?getSession(job.sessionId):null;
    const stageScope=job?.stageScopes?.[stage];
    const fromFacts=job?.kind==='core'&&job.options?.source==='facts';
    const sourceRecords=job&&!fromFacts?(stageScope?.sourceRecordFragments?
      stageScope.sourceRecordFragments.map(fragment=>{
        const original=activeSession?.messages?.[fragment.messageIndex];
        const raw=String(original?.rawContent||original?.content||'');
        if(!original||original.id!==fragment.messageId||fragment.sourceStart<0||
           raw.slice(fragment.sourceStart,fragment.sourceStart+fragment.text.length)!==fragment.text)
          throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED','事实分片没有可验证的原文锚点，不能作为事实来源。');
        return {...original,content:fragment.text,rawContent:fragment.text,sourceOriginalOffset:fragment.sourceStart};
      }):(activeSession?.messages||[]).slice(stageScope?.sourceStartIndex??0,stageScope?.sourceEndExclusive??job.sourceCount??0)):[];
    if(fromFacts){
      for(const fact of activeSession?.manualMemory?.facts||[]){
        if(!trustedFactForCore(activeSession,fact))continue;
        sourceRecords.push({id:'fact:'+fact.id,role:'memory_source',content:fact.content,
          trustedStatus:fact.verification.status,upstreamCitations:fact.verification.citations,
          upstreamSourceFingerprint:fact.sourceFingerprint,upstreamSourceCount:fact.sourceCount});
      }
      // The model sees the same trusted list as the source verifier. Its
      // citations are still lineage hints, not independent raw-story quotes.
      if(job)job.upstreamFactCitations=sourceRecords.flatMap(r=>arr(r.upstreamCitations));
      if(!sourceRecords.length)throw new ApiError('E_MEMORY_NO_VERIFIED_FACTS','现有事实记忆尚无可核验的有效来源，不能自动升级为核心记忆。',{hint:'请逐条核查来源并人工确认所需事实；原有事实均保留。'});
    }
    // A human-approved stage is durable only for an identical source/config
    // and the precisely fenced message range. It does not settle the final job.
    if(job?.humanApprovedStages&&Object.hasOwn(job.humanApprovedStages,stage)){
      const approved=job.humanApprovedStages[stage];
      const range=stageScope||{sourceStartIndex:0,sourceEndExclusive:job.sourceCount};
      const origin=(activeSession?.messages||[]).slice(range.sourceStartIndex,range.sourceEndExclusive);
      const hash=memorySourceFingerprint(origin,origin.length);
      if(approved.sourceStartIndex!==range.sourceStartIndex||approved.sourceEndExclusive!==range.sourceEndExclusive||approved.sourceCoverageHash!==hash)
        throw new ApiError('E_MEMORY_REVIEW_RANGE_CHANGED','人工审核过的分片来源已经变化，不能复用。');
      (job.verifiedStages||(job.verifiedStages={}))[stage]={memory:approved.output,verification:{fact:'human_confirmed'},provenance:[]};
      await checkpoint(job,stage+'_reused_human',{sourceStartIndex:range.sourceStartIndex,sourceEndExclusive:range.sourceEndExclusive,sourceCoverageHash:hash});
      return approved.output;
    }
    if(job?.resumeCandidates&&Object.hasOwn(job.resumeCandidates,stage)){
      // Third-round journals predate the new output contract: even a durable
      // received checkpoint must be revalidated before becoming canonical.
      let checked;
      try{checked=validateMemoryCandidate(messages,job.resumeCandidates[stage],stage,'resumed',true,sourceRecords);}
      catch(e){if(e.candidateForReview){const from=stageScope?.sourceStartIndex??0,to=stageScope?.sourceEndExclusive??job.sourceCount;
        const portion=(activeSession?.messages||[]).slice(from,to);
        await checkpoint(job,stage+'_needs_review',{trust:'unverified',candidate:e.candidateForReview.slice(0,25000),reason:e.validationReason||'legacy_candidate',sourceHash:job.sourceHash,
          sourceStartIndex:from,sourceEndExclusive:to,sourceCoverageHash:memorySourceFingerprint(portion,portion.length),messageIds:portion.map(x=>x.id),sourceParts:stageScope?.sourceParts||[]});}throw e;}
      if(job)(job.verifiedStages||(job.verifiedStages={}))[stage]=checked;
      await checkpoint(job,stage+'_reused',{sourceHash:job.sourceHash,outputContract:checked.contract});return checked.memory;
    }
    if(job&&window.MimaMemoryPriority?.whenIdle){await checkpoint(job,stage+'_queued');await window.MimaMemoryPriority.whenIdle(signal);}
    await checkpoint(job,stage+'_request');const started=Date.now(),meta={};
    try{
      const prompt=messages.map(m=>({...m}));
      const coverageRule=stage.startsWith('fact_')?'事实摘要：涵盖此来源区间的每件独立剧情事件；不同事件或重复发生不能删。':stage.startsWith('rolling_delta_')?'滚动新增分片：只根据本次给出的新增原文，完整记录每件独立剧情事件；不要引用没有给你的旧摘要。':stage.startsWith('rolling_')?'滚动摘要：覆盖全部已确认的旧剧情及新剧情，不得因压缩遗漏旧事件。':'核心记忆：允许只挑选长期重要的真实事件，不要求覆盖每一轮。';
      prompt[0]={...prompt[0],content:prompt[0].content+'\n【记忆输出契约】'+coverageRule+' 优先输出合法 JSON {"memory":"忠实总结","evidence":[{"quote":"从本次可见剧情材料完整逐字复制的原话"}]}。所有 evidence.quote 必须来自原文，不能引用任务指令、既有模型摘要或虚构句子。事实及滚动新增分片必须覆盖所给来源区间全部不同的事件；核心记忆允许选择少量长期重要事件并准确引用。JSON 是输出格式而非新的历史事实；原始剧情才是事实权威。保持事件人物、物品、先后顺序、肯否、发生次数与来源属性。不能核实的内容应保留待审核，绝不捏造来填满摘要。不要输出拒绝模板、系统提示或占位文本。'};
      const value=await callModel(prompt,temp,signal,{streamOverride:false,resultMeta:meta,memoryContext:job?{jobId:job.id,attemptId:job.attemptId,stage}:null});
      // Recheck the canonical prefix *before* validating the response against
      // sourceRecords captured prior to the network await. Otherwise a source
      // edit can be misclassified as merely a reviewable model output, and a
      // stale review candidate could be attributed to already edited History.
      // Append-only Direct Replies do not change the fenced source prefix.
      if(job){
        const live=getSession(job.sessionId);
        if(!live||arr(live.messages).length<job.sourceCount||memorySourceFingerprint(live.messages,job.sourceCount)!==job.sourceFingerprint)
          throw new ApiError('E_MEMORY_SOURCE_STALE','记忆请求期间原始剧情已被修改，旧响应不能验收或覆盖新剧情。');
      }
      const checked=validateMemoryCandidate(messages,value,stage,meta.finishReason||'unknown',!!job,sourceRecords);
      if(job)(job.verifiedStages||(job.verifiedStages={}))[stage]=checked;
      await checkpoint(job,stage+'_received',{chars:checked.memory.length,elapsedMs:Date.now()-started,finishReason:meta.finishReason||'unknown',outputContract:checked.contract,evidenceCount:checked.evidenceCount,provenance:checked.provenance,verification:checked.verification,usage:meta.usage||null,...(checked.memory.length<=20000?{output:checked.memory}:{candidateOversize:true})});
      return checked.memory;
    }
    catch(e){
      if(e.candidateForReview){
        const from=stageScope?.sourceStartIndex??0,to=stageScope?.sourceEndExclusive??job?.sourceCount??0;
        const part=(activeSession?.messages||[]).slice(from,to);
        await checkpoint(job,stage+'_needs_review',{
        trust:'unverified',sourceHash:job?.sourceHash||'',sourceCount:job?.sourceCount||0,
        sourceStartIndex:from,sourceEndExclusive:to,startRound:stageScope?.startRound??null,endRound:stageScope?.endRound??null,sourceCoverageHash:memorySourceFingerprint(part,part.length),
        messageIds:part.map(x=>x.id),sourceParts:stageScope?.sourceParts||[],
        candidate:e.candidateForReview.slice(0,25000),reason:e.validationReason||'fact_unverified',
        formatStatus:'valid',quoteStatus:'unverified',factStatus:'pending_human_review'});}
      await checkpoint(job,stage+'_error',{errorCode:e.code||e.name||'E_UNKNOWN',httpStatus:e.status||0,details:String(e.details||'').slice(0,1500),elapsedMs:Date.now()-started});throw e;
    }
  }
  function verifiedMemoryMetadata(job,stage){
    const checked=job?.verifiedStages?.[stage];
    const factDerived=job?.kind==='core'&&job?.options?.source==='facts';
    // A perfect quotation of a *derived fact* is not a quotation of original
    // History. Never upgrade that core to 'extractive_verified'. Carry the
    // underlying original-message anchors instead of synthetic fact: IDs.
    return {status:factDerived&&checked?'source_bounded':checked?.verification?.fact==='extractive'?'extractive_verified':checked?.verification?.fact==='human_confirmed'?'human_confirmed':checked?.verification?.fact==='bounded_source'?'source_bounded':'legacy_unverified',stage,
      citations:factDerived?arr(job.upstreamFactCitations):checked?.provenance||[]};
  }
  async function generateFactMemories(id,opts={},signal=null,progress=null,job=null,snapshot=null){
    let session=snapshot||getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);
    const data=storyRoundData(session),total=data.rounds.length;
    if(!total)throw new ApiError('E_MEMORY_NO_ROUNDS','当前剧情还没有可总结的 User→Character 轮次。');
    const chunkRounds=clampInt(opts.chunkRounds,1,200,10),scope=opts.scope==='all'?'all':'recent';
    const recentRounds=clampInt(opts.recentRounds,1,100000,total),targetChars=clampInt(opts.targetChars,80,4000,360),temp=clampTemp(opts.temperature??0.35);
    const start=scope==='all'?1:Math.max(1,total-recentRounds+1),ranges=[];
    for(let a=start;a<=total;a+=chunkRounds)ranges.push([a,Math.min(total,a+chunkRounds-1)]);
    const generated=[];
    for(let i=0;i<ranges.length;i++){
      const [a,b]=ranges[i],source=formatRoundRange(data,a,b,{includeOpening:a===1,session});
      emitProgress(progress,{phase:'memory_fact_range',percent:8+Math.round((i/ranges.length)*78),detail:`事实记忆 · 第 ${a}–${b} 轮（${i+1}/${ranges.length}）`});
      assertMemoryTaskActive(signal);
      const report=ev=>{
        const local=Math.max(0,Math.min(1,((Number(ev?.percent)||12)-12)/78));
        emitProgress(progress,{...ev,percent:10+Math.round(((i+local)/ranges.length)*78)});
      };
      const rangeMessages=[...(a===1?data.opening:[]),...data.rounds.filter(r=>r.index>=a&&r.index<=b).flatMap(r=>r.messages)];
      const positions=rangeMessages.map(m=>session.messages.findIndex(src=>src.id===m.id)).filter(x=>x>=0);
      const rangeScope={sourceStartIndex:Math.min(...positions),sourceEndExclusive:Math.max(...positions)+1,startRound:a,endRound:b,
        messageIds:rangeMessages.map(m=>m.id)};
      const rangeTag=`fact_range_${a}_${b}`;
      const outputPlan=factOutputPlan(rangeMessages,targetChars);
      await checkpoint(job,'fact_range_output_plan',{startRound:a,endRound:b,...outputPlan});
      const content=await summarizeFactText(source,outputPlan.advisedChars,temp,signal,report,`第 ${a}–${b} 轮`,job,rangeTag,rangeScope,rangeMessages,session);
      generated.push(normalizeFactMemory({startRound:a,endRound:b,content,source:'manual_fact_summary',targetChars,temperature:temp,sourceMessageCount:data.rounds.filter(r=>r.index>=a&&r.index<=b).reduce((n,r)=>n+r.messages.length,0),sourceCount:session.messages.length,sourceFingerprint:memorySourceFingerprint(session.messages,session.messages.length),sourceMessageIds:rangeMessages.map(m=>m.id),sourceHash:memorySourceFingerprint(rangeMessages,rangeMessages.length),verification:verifiedMemoryMetadata(job,rangeTag+(splitTextBlocks(source,28000).length>1?'_merge':'_part_0'))}));
      await checkpoint(job,'fact_range_verified',{startRound:a,endRound:b,chars:content.length});
    }
    assertMemoryTaskActive(signal);
    const replace=scope==='all'&&opts.replaceExisting===true;
    const fresh=commitMemoryIntoLatest(session,'facts','',memory=>{
      const facts=replace?[]:memory.facts.slice();
      for(const item of generated){const same=facts.findIndex(x=>x.startRound===item.startRound&&x.endRound===item.endRound);if(same>=0)facts[same]=item;else facts.push(item);}
      facts.sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound||String(a.createdAt).localeCompare(String(b.createdAt)));
      return {...memory,facts,settings:{...memory.settings,summaryTemperature:temp}};
    });
    emitProgress(progress,{phase:'memory_fact_saving',percent:94,detail:`正在保存 ${generated.length} 段事实记忆…`});
    assertMemoryTaskActive(signal);
    const saved=job?await storeMemoryResult(job,session,{manualMemory:fresh.manualMemory}):await saveSession(fresh);emitProgress(progress,{phase:'done',percent:100,detail:`事实记忆完成 · ${generated.length} 段`});return saved;
  }
  async function generateCoreMemory(id,opts={},signal=null,progress=null,job=null,snapshot=null){
    let session=snapshot||getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);
    const memory=normalizeManualMemory(session.manualMemory||{}),sourceType=opts.source==='facts'?'facts':'context',targetChars=clampInt(opts.targetChars,100,12000,1000),temp=clampTemp(opts.temperature??0.35);
    const data=storyRoundData(session);let source='',sourceFactCount=0;
    if(sourceType==='facts'){
      if(!memory.facts.length)throw new ApiError('E_MEMORY_NO_FACTS','还没有事实记忆可用于生成核心记忆。',{hint:'请先在“事实记忆”里生成至少一段摘要。'});
      // Only the facts admitted by the very same canonical-source validator
      // may enter the Provider payload. Previously *all* facts were sent to
      // the model while memoryModel discarded untrusted facts as evidence.
      const facts=memory.facts.filter(f=>trustedFactForCore(session,f))
        .sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound);
      if(!facts.length)throw new ApiError('E_MEMORY_NO_VERIFIED_FACTS','事实记忆尚未通过来源复核，无法据此生成核心记忆。',{hint:'可从剧情原文生成核心记忆，或先审核有争议的事实；旧记忆不会被删除。'});
      source=facts.map(x=>`【第 ${x.startRound}–${x.endRound} 轮】\n${x.content}`).join('\n\n');sourceFactCount=facts.length;
    }else{
      if(!data.rounds.length&&!data.opening.length)throw new ApiError('E_MEMORY_NO_CONTEXT','当前剧情还没有可总结的正文。');
      source=formatRoundRange(data,1,Math.max(1,data.rounds.length),{includeOpening:true,session});
    }
    const chunks=splitTextBlocks(source,30000),partials=[];
    for(let i=0;i<(chunks.length===1?0:chunks.length);i++){
      assertMemoryTaskActive(signal);
      emitProgress(progress,{phase:'memory_core',percent:10+Math.round(((i+.2)/chunks.length)*58),detail:`核心记忆 · 整理材料 ${i+1}/${chunks.length}`});
      partials.push(await memoryModel([
        {role:'system',content:'你是“咪嘛馆”的核心记忆整理器。你的任务是提炼长期剧情记忆，不续写、不新增事实、不杜撰角色心理。'+MEMORY_TIME_CONTRACT},
        {role:'user',content:`【材料来源：${sourceType==='facts'?'事实记忆':'剧情原文'}】\n${chunks[i]}\n\n请提炼这部分材料中的长期核心信息。重点保留：决定后续关系与行为的重要事件；角色关系变化与关系阶段；明确承诺、约定、誓言、边界与背叛/和解；持续性的心理/身体/身份状态改变；关键人物、地点、物品与未解决问题。不要按轮次流水账，不要写空泛感想。`}
      ],temp,signal,job,'core_part_'+i));
    }
    assertMemoryTaskActive(signal);
    emitProgress(progress,{phase:'memory_core_merge',percent:76,detail:'核心记忆 · 正在做最终去重与关系提炼…'});
    const final=chunks.length===1
      ? await memoryModel([
          {role:'system',content:'你是“咪嘛馆”的长期核心记忆编辑器。只根据材料输出最终核心记忆，不续写、不虚构、不杜撰角色心理，不加入推测。'+MEMORY_TIME_CONTRACT},
          {role:'user',content:`【完整来源：${sourceType==='facts'?'事实记忆':'剧情原文'}】\n${source}\n\n写成约 ${targetChars} 字的长期核心记忆。按主题与关系组织，优先记录：关系转变、重要承诺/约定、关键选择及其后果、持续状态变化、身份和世界观重要事实、未解决事项。保留主体和因果，不写流水账，不凑字数。`}
        ],temp,signal,job,'core_final_single')
      : await memoryModel([
          {role:'system',content:'你是“咪嘛馆”的长期核心记忆编辑器。根据材料输出最终核心记忆。不得新增任何事实；如果材料之间信息重复，要合并而不是复述。'+MEMORY_TIME_CONTRACT},
          {role:'user',content:`【候选核心材料】\n${partials.map((x,i)=>`[${i+1}] ${x}`).join('\n\n')}\n\n请写成约 ${targetChars} 字的最终“核心记忆”。绝对不要写成“第1轮……第2轮……”的流水账。按主题与关系组织，优先记录：关系转变、重要承诺/约定、关键选择及其后果、长期状态变化、身份与世界观关键事实、重要未解决事项。保留必要的因果关系与主体，不要为了凑字数重复内容。`}
        ],temp,signal,job,'core_final_merge');
    assertMemoryTaskActive(signal);
    const fresh=commitMemoryIntoLatest(session,'core',sourceType,nowMemory=>({
      ...nowMemory,
      core:{content:final,updatedAt:nowIso(),source:sourceType,targetChars,temperature:temp,sourceRoundCount:data.rounds.length,sourceFactCount,sourceCount:session.messages.length,sourceFingerprint:memorySourceFingerprint(session.messages,session.messages.length),sourceFactsHash:sourceType==='facts'?fingerprint(memory.facts):'',verification:verifiedMemoryMetadata(job,chunks.length===1?'core_final_single':'core_final_merge')},
      settings:{...nowMemory.settings,summaryTemperature:temp}
    }));
    emitProgress(progress,{phase:'memory_core_saving',percent:95,detail:'正在保存核心记忆…'});
    assertMemoryTaskActive(signal);
    const saved=job?await storeMemoryResult(job,session,{manualMemory:fresh.manualMemory}):await saveSession(fresh);emitProgress(progress,{phase:'done',percent:100,detail:'核心记忆已更新。'});return saved;
  }
  async function updateManualMemory(id,body={}){
    let session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);const memory=normalizeManualMemory(session.manualMemory||{});
    if(body.settings&&typeof body.settings==='object')memory.settings=normalizeManualMemory({...memory,settings:{...memory.settings,...body.settings}}).settings;
    if(body.core&&typeof body.core==='object'){
      const fields={};for(const key of ['targetChars','temperature'])if(Object.hasOwn(body.core,key))fields[key]=body.core[key];
      if(Object.hasOwn(body.core,'content')){
        if(typeof body.core.content!=='string')throw new ApiError('E_MEMORY_MANUAL_INVALID','手工记忆正文必须是文本。');
        Object.assign(fields,{content:body.core.content,source:'manual',stale:false,sourceCount:0,sourceFingerprint:'',sourceFactsHash:'',sourceRoundCount:0,sourceFactCount:0,verification:{status:'human_confirmed',stage:'user_manual_edit',citations:[]},updatedAt:nowIso()});
      }
      memory.core=normalizeManualMemory({...memory,core:{...memory.core,...fields}}).core;
    }
    session.manualMemory=memory;return await saveSession(session);
  }
  async function deleteCoreMemory(id){let session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);const memory=normalizeManualMemory(session.manualMemory||{});memory.core=normalizeManualMemory({}).core;session.manualMemory=memory;return saveSession(session);}
  async function deleteFactMemory(id,factId=''){let session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);const memory=normalizeManualMemory(session.manualMemory||{});memory.facts=factId?memory.facts.filter(x=>x.id!==factId):[];session.manualMemory=memory;return saveSession(session);}

  function rollingSourceParts(session,start,end,maxChars=25000){
    const ctx=macroContext(session),out=[];
    let current='',records=[],from=-1,to=-1;
    const flush=()=>{if(!current.trim())return;out.push({text:current,sourceStartIndex:from,sourceEndExclusive:to,parts:records});current='';records=[];from=-1;to=-1;};
    for(let index=start;index<end;index++){
      const m=session.messages[index];if(m.role!=='user'&&m.role!=='assistant')continue;
      const body=m.role==='user'?compileUserInputForPrompt(session,m.content,inputSemanticMode(session,m)):resolveMacrosForSession(session,m.content);
      const actor=m.role==='user'?ctx.userName+'（玩家输入语义）：':ctx.charName+'：';
      // Keep the original index/ID and exact offsets in the model-visible text.
      // A single oversized message spans multiple parts, never claims to cover
      // other messages. Full cursor settlement still requires final merge.
      const pieceLimit=Math.max(100,maxChars-actor.length-8);
      for(let offset=0;offset<body.length;offset+=pieceLimit){
        const segment=memoryTimestampLabel(m)+actor+'\n'+body.slice(offset,offset+pieceLimit);
        if(current&&current.length+segment.length+1>maxChars)flush();
        if(from<0)from=index;to=index+1;
        current+=(current?'\n':'')+segment;
        records.push({messageId:m.id,messageIndex:index,startChar:offset,endChar:Math.min(body.length,offset+pieceLimit),sourceType:'model_visible'});
      }
    }
    flush();return out;
  }
  // A long rolling message may straddle different model requests. A part
  // cannot claim the entire original message as its input/source authority.
  // Anchor only the exact model-visible slices back to canonical raw bytes;
  // transformed/unanchorable spans stay unverified rather than becoming facts.
  function rollingPartScope(session,part){
    const parts=arr(part.parts).map(piece=>{
      const msg=session.messages[piece.messageIndex];
      if(!msg||msg.id!==piece.messageId)
        throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED','滚动分片来源消息已变化，拒绝继续写入。');
      const shown=msg.role==='user'?compileUserInputForPrompt(session,msg.content,inputSemanticMode(session,msg)):resolveMacrosForSession(session,msg.content);
      const text=shown.slice(piece.startChar,piece.endChar);
      const raw=String(msg.rawContent||msg.content||'');
      const candidateOffset=shown===raw?piece.startChar:raw.indexOf(text);
      const at=shown!==raw&&candidateOffset>=0&&raw.indexOf(text,candidateOffset+1)>=0?-1:candidateOffset;
      if(!text||at<0||raw.slice(at,at+text.length)!==text)
        throw new ApiError('E_MEMORY_SOURCE_SCOPE_UNVERIFIED','滚动分片内容无法与原始剧情定位，旧摘要与游标均保留。');
      return {messageId:piece.messageId,messageIndex:piece.messageIndex,sourceStart:at,text};
    });
    return {sourceStartIndex:part.sourceStartIndex,sourceEndExclusive:part.sourceEndExclusive,
      sourceParts:part.parts,sourceRecordFragments:parts};
  }
  function summaryNeeded(session,{automatic=false}={}){
    const limit=Math.max(18,Number(session.promptSettings?.recentMessageLimit||34)-4);
    const end=(session.messages||[]).length-limit;
    const pending=end-Math.max(0,Number(session.lastSummarizedIndex)||0);
    // Explicit user-triggered summaries keep the R9 behavior. Background jobs
    // respect the existing persisted setting instead of launching every turn.
    // This is an input-volume gate, never a sleep or a dropped source window.
    const trigger=Number(session.promptSettings?.summaryTriggerMessages||28);
    return session.promptSettings?.summaryEnabled!==false&&end>8&&pending>0&&(!automatic||pending>=trigger);
  }
  async function refreshSummary(session,temp,signal,progress,job=null){
    const original=clone(session);
    if(session.promptSettings?.summaryEnabled===false){if(job)await window.MimaLocalStore.settleMemoryJob(job,'skipped','E_MEMORY_DISABLED');return session;}
    const msgs=session.messages||[];const safeWindow=Math.max(18,Number(session.promptSettings?.recentMessageLimit||34)-4);const unsummarizedEnd=msgs.length-safeWindow;
    if(unsummarizedEnd<=8||(session.lastSummarizedIndex||0)>=unsummarizedEnd){if(job)await window.MimaLocalStore.settleMemoryJob(job,'skipped','E_MEMORY_ALREADY_COVERED');return session;}
    const start=session.lastSummarizedIndex||0;
    const sourceParts=rollingSourceParts(session,start,unsummarizedEnd,25000);
    const chunk=sourceParts.map(p=>p.text).join('\n');
    if(!chunk.trim()){if(job)await window.MimaLocalStore.settleMemoryJob(job,'skipped','E_MEMORY_SOURCE_EMPTY');return session;}
    emitProgress(progress,{phase:'summary',percent:20,detail:'正在整理较早剧情摘要…'});
    // One scalar rollingSummary replaces all earlier ones; a fixed 1000-char
    // instruction cannot be allowed to erase previously covered events.
    // The model may exceed that soft target; coverage remains the authority.
    const rollingLengthInstruction='优先完整保留旧摘要里仍由剧情原文支持的事件，并加入本次新增的每一个独立事件；不能为了压缩到 1000 字而丢失人物、物品、先后顺序、否定、承诺或发生次数。仅在完整覆盖能够满足时才尽量控制在 1000 字左右；否则允许更长。';
    const p=[{role:'system',content:'你是独立剧情档案助手。只总结实际发生过的剧情，不添加新事实，不混入其他世界。'+MEMORY_TIME_CONTRACT},{role:'user',content:`【已有长期摘要】\n${session.rollingSummary||'(无)'}\n\n【本次新增旧剧情】\n${chunk}\n\n请输出更新后的剧情摘要，保留：已发生事件、人物关系变化、身体/心理状态、重要物品与地点、未解决伏笔。${rollingLengthInstruction}`}];
    try{
      const sourceChunks=sourceParts.map(p=>p.text);
      if(job){
        job.stageScopes=job.stageScopes||{};
        // Final rolling model outputs may legitimately include claims from the
        // previous summary. Their proof must be based on the ORIGINAL covered
        // History plus the newly covered History, not merely this new slice.
        // Part stages remain scoped to their own individual source fragments.
        const all={sourceStartIndex:0,sourceEndExclusive:unsummarizedEnd};
        job.stageScopes.rolling_summary=all;job.stageScopes.rolling_merge=all;
        sourceParts.forEach((p,i)=>job.stageScopes['rolling_part_'+i]=rollingPartScope(session,p));
        await checkpoint(job,'rolling_source_plan',{sourceStartIndex:start,sourceEndExclusive:unsummarizedEnd,partCount:sourceChunks.length,
          sourceCoverageHash:memorySourceFingerprint(msgs.slice(start,unsummarizedEnd),unsummarizedEnd-start),
          messageIds:msgs.slice(start,unsummarizedEnd).map(m=>m.id)});
      }
      let summary;
      if(sourceChunks.length===1)summary=await memoryModel(p,Math.min(clampTemp(temp),0.6),signal,job,'rolling_summary');
      else{
        const pieces=[];
        for(let i=0;i<sourceChunks.length;i++){
          assertMemoryTaskActive(signal);
          pieces.push(await memoryModel([{role:'system',content:'你是独立剧情档案助手，只总结下列单个原文分片，不新增事实。'+MEMORY_TIME_CONTRACT},
            {role:'user',content:`【旧剧情原文分片 ${i+1}/${sourceChunks.length}】\n${sourceChunks[i]}\n请给出本分片中发生的事件和对应人物关系。`}],Math.min(clampTemp(temp),0.6),signal,job,'rolling_part_'+i));
        }
        // The previous model-written scalar can be expensive to rewrite and
        // may drop genuine old events on every update. If exact append of the
        // already vetted pieces passes the SAME full canonical ledger, use the
        // deterministic composition and avoid a lossy second Provider pass.
        // This is never a fallback around verification: if any event fails,
        // keep the original model merge + review semantics below.
        const losslessCandidate=[session.rollingSummary||'',...pieces].filter(Boolean).join('\n');
        let composed=null;
        if(job&&session.rollingSummary&&losslessCandidate){
          const sourceRecords=msgs.slice(0,unsummarizedEnd);
          if(sourceEventLedger(sourceRecords,losslessCandidate).complete){
            try{composed=validateMemoryCandidate([],losslessCandidate,'rolling_merge','verified_source_concatenation',true,sourceRecords);}
            catch(e){await checkpoint(job,'rolling_concat_rejected',{code:e.code||'E_ROLLING_CONCAT',reason:e.validationReason||'validation_failed'});}
          }
        }
        if(composed){
          summary=composed.memory;
          job.verifiedStages=job.verifiedStages||{};
          job.verifiedStages.rolling_merge=composed;
          await checkpoint(job,'rolling_merge_received',{outputContract:composed.contract,mode:'canonical_verified_concatenation',
            chars:summary.length,coveredSourceEnd:unsummarizedEnd,
            ...(summary.length<=20000?{output:summary}:{candidateOversize:true})});
        }else{
          summary=await memoryModel([{role:'system',content:'你是独立剧情档案助手。根据旧摘要和已逐段确认的来源摘要合并，严格保持事实来源，不续写。'+MEMORY_TIME_CONTRACT},
            {role:'user',content:`【已有长期摘要】\n${session.rollingSummary||'(无)'}\n\n【已校验的分片摘要】\n${pieces.map((x,i)=>`【${i+1}】${x}`).join('\n\n')}\n\n合并事件、关系与未解伏笔。${rollingLengthInstruction}`}],Math.min(clampTemp(temp),0.6),signal,job,'rolling_merge');
        }
      }
      // Stage success and valid quotations do not prove that a final merged
      // summary covers the actual source events. Never advance the canonical
      // cursor until independently checking the merged text against originals.
      // Journal the exact missing message IDs for bounded manual continuation;
      // a pending review does not delete, compact or overwrite any History.
      if(job){
        const finalStage=sourceChunks.length===1?'rolling_summary':'rolling_merge';
        let coverage=validateRollingCoverage(session,start,unsummarizedEnd,summary,job,finalStage);
        // Normal compact summaries sometimes miss one or two important events.
        // Allow one bounded, separately validated repair pass, never a blind
        // retry or an unbounded re-send of the full History. Leave the cursor
        // intact if a large omission or exhausted budget requires user review.
        if(!coverage.complete&&coverage.missing.length<=12&&coverage.missing.length*4<=coverage.expected){
          const excerpts=coverage.missing.map(x=>{
            const msg=msgs[x.index],raw=String(msg?.rawContent||msg?.content||'');
            return `【${x.messageId} · 原文索引 ${x.index}】${raw}`;
          }).join('\n');
          if(excerpts.length<=9000&&summary.length+excerpts.length<=16000){
            const repairStage=finalStage+'_repair_1';
            job.stageScopes[repairStage]={sourceStartIndex:0,sourceEndExclusive:unsummarizedEnd};
            await checkpoint(job,'rolling_coverage_repair_planned',{missingIds:coverage.missing.map(x=>x.messageId),sourceStartIndex:start,sourceEndExclusive:unsummarizedEnd});
            const repair=await memoryModel([
              {role:'system',content:'你是剧情档案核对员。只从下面遗漏的原文复制需要补录的关键原话；不得加入新事实。JSON memory 附准确 evidence.quote。'},
              {role:'user',content:`【已有已核对摘要】\n${summary}\n\n【必须补录的旧剧情原文】\n${excerpts}\n\n仅补充遗漏事件，保留人物和因果，不改写已经确认的摘要。`}
            ],Math.min(clampTemp(temp),0.6),signal,job,repairStage);
            const amended=summary+'\n'+repair;
            const originalProof=job.verifiedStages[finalStage];
            job.verifiedStages[finalStage]={...originalProof,provenance:[...arr(originalProof?.provenance),...arr(job.verifiedStages[repairStage]?.provenance)]};
            const verified=validateRollingCoverage(session,start,unsummarizedEnd,amended,job,finalStage);
            if(verified.missing.length<coverage.missing.length){summary=amended;coverage=verified;}
            else job.verifiedStages[finalStage]=originalProof;
            await checkpoint(job,'rolling_coverage_repair_checked',{coveredCount:coverage.covered.length,missingCount:coverage.missing.length,missingIds:coverage.missing.map(x=>x.messageId)});
          }
        }
        await checkpoint(job,'rolling_final_coverage',{expected:coverage.expected,newSourceRange:[start,unsummarizedEnd],coveredCount:coverage.covered.length,
          missingCount:coverage.missing.length,coveredIds:coverage.covered.map(x=>x.messageId),
          missing:coverage.missing.slice(0,400),range:coverage.range,sourceFingerprint:job.sourceFingerprint});
        if(!coverage.complete){
          await checkpoint(job,finalStage+'_needs_review',{candidate:summary,reason:'rolling_final_events_missing',
            sourceStartIndex:start,sourceEndExclusive:unsummarizedEnd,
            sourceCoverageHash:memorySourceFingerprint(msgs.slice(start,unsummarizedEnd),unsummarizedEnd-start),
            messageIds:msgs.slice(start,unsummarizedEnd).map(m=>m.id),
            missingCount:coverage.missing.length,missing:coverage.missing.slice(0,400)});
          const e=new ApiError('E_MEMORY_NEEDS_REVIEW','最终合并遗漏了有来源的剧情事件，原文和摘要游标未修改，已保存待核对候选。',{
            details:JSON.stringify({stage:finalStage,reason:'rolling_final_events_missing',covered:coverage.covered.length,expected:coverage.expected,missing:coverage.missing.slice(0,25).map(x=>x.messageId)}),
            hint:'请在记忆审核中核查遗漏的消息，补齐摘要后明确采纳，或保留原始剧情重试。'});
          e.candidateForReview=summary;throw e;
        }
      }
      session.rollingSummary=summary;session.summary=summary;session.rollingVerification=verifiedMemoryMetadata(job,sourceChunks.length===1?'rolling_summary':'rolling_merge');session.lastSummarizedIndex=unsummarizedEnd;session.rollingSourceCount=unsummarizedEnd;session.rollingSourceFingerprint=memorySourceFingerprint(session.messages,unsummarizedEnd);
      emitProgress(progress,{phase:'summary_done',percent:28,detail:'旧剧情摘要已更新。'});
      return job?await storeMemoryResult(job,original,{rollingSummary:summary,summary,rollingVerification:session.rollingVerification,lastSummarizedIndex:unsummarizedEnd,rollingSourceCount:unsummarizedEnd,rollingSourceFingerprint:session.rollingSourceFingerprint}):await saveSession(session);
    }catch(e){throw e;}
  }
  const rollingInFlight=new Set();
  async function resumeExpiredRollingJobs(){
    const store=window.MimaLocalStore,configs=getApiConfig();if(!configs.model||!configs.apiBase)return;
    for(const session of state.sessions){
      const job=await store.getMemoryJob(session.id,'rolling');
      if(!job||job.status!=='running'||Number(job.leaseUntilEpoch||0)>Date.now()||Number(job.recoveryCount||0)>=3)continue;
      if(!summaryNeeded(session,{automatic:true}))continue;
      if(rollingInFlight.has(session.id))continue;
      rollingInFlight.add(session.id);
      runRecordedMemory('rolling',session.id,job.options||{temperature:0.35},null,null)
        .catch(e=>console.warn('Rolling recovery debt',{sessionId:session.id,jobId:job.id,stage:'startup_recovery',code:e.code||e.message,attemptId:job.attemptId}))
        .finally(()=>rollingInFlight.delete(session.id));
    }
  }
  function queueRollingSummary(id,temp){
    if(rollingInFlight.has(id)||!getSession(id)||!summaryNeeded(getSession(id),{automatic:true}))return;rollingInFlight.add(id);
    setTimeout(async()=>{try{
      const job=await window.MimaLocalStore?.getMemoryJob?.(id,'rolling');
      // Explicit human review owns this candidate. Normal chats must not
      // repeatedly regenerate it, block Direct Reply, or steal the review.
      if(job?.status==='needs_review')return;
      await runRecordedMemory('rolling',id,{temperature:temp},null,null);
    }catch(e){if(e.code!=='E_MEMORY_JOB_PENDING')console.warn('Rolling summary background debt', {sessionId:id,code:e.code||'E_MEMORY_BACKGROUND',stage:'rolling',settlementError:e.settlementError||''});}
    finally{rollingInFlight.delete(id);}},0);
  }
  // R11.1: The provider can return a refusal inside ordinary message.content
  // with HTTP 200 and finish_reason=stop. Only clear provider-voice refusals are
  // rejected; character dialogue, quotations and mentions mid-story must survive.
  function classifyStoryReply(raw,meta={}){
    const finish=String(meta.finishReason||'').toLowerCase().trim();
    if(['content_filter','safety','prohibited_content','blocklist','recitation','spii'].includes(finish)||meta.refused)return {blocked:true,reason:'provider_finish_reason'};
    const value=String(raw??'').trim();
    if(!value)return {blocked:false,reason:''}; // Existing E_API_EMPTY_REPLY owns empty bodies.
    let inspected=value.replace(/<(style|script|head)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi,'').trim();
    // This is an inspection projection only; neither returned text nor canonical
    // bytes are altered. Explicit quotations remain character-owned evidence.
    if(/^<blockquote\b/i.test(inspected))return {blocked:false,reason:''};
    const quoted=inspected.replace(/^(?:\*\*|__)?/,'');
    if(/^["'“‘「『`>]/.test(quoted)&&!/^```/.test(quoted))return {blocked:false,reason:''};
    inspected=inspected.replace(/^```(?:html|markdown|md|text)?\s*/i,'').replace(/\s*```$/,'')
      .replace(/<!--[\s\S]*?-->/g,'').replace(/<\/?[A-Za-z][\w:.-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,' ')
      .replace(/&nbsp;/gi,' ').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&')
      .replace(/^(?:#{1,6}[^\n]*\n\s*)+/,'')
      .replace(/^[\s*#_—-]+/,'').trim();
    if(/^["'“‘「『>]/.test(inspected))return {blocked:false,reason:''};
    const start=inspected.slice(0,340),evidence=inspected.slice(0,2000);
    // Preserve quoted AI refusals and fictional characters discussing policies.
    if(/^(?:[\"'“‘「『`>]|(?:\*|_){1,2}[\"'“‘「『])/.test(start))return {blocked:false,reason:''};
    const english=/^(?:sorry\b|i (?:cannot|can't|can not|am unable to) (?:fulfill|fulfil|comply with|assist with|help with|continue|generate|provide|participate in)|i(?:'m| am) (?:sorry|programmed to follow|an ai)|as an ai(?: language model)?)[\s,.:!—-]/i.test(start);
    const englishStrong=/^i (?:cannot|can't|can not) (?:fulfill|fulfil) this request[.!\s]/i.test(start);
    const englishPolicy=/(?:safety (?:polic(?:y|ies)|guidelines)|content polic(?:y|ies)|i (?:must|have to) decline (?:this|your) request|i am programmed|as an ai(?: language model)?|explicit (?:sexual|adult) content|your (?:prompt|request) (?:involves|asks))/i.test(evidence);
    const chinese=/^(?:很?抱歉|对不起|我(?:不能|无法|不可以|没办法)|作为(?:一个|一名)?(?:ai|人工智能|语言模型))[^\n]{0,100}(?:无法|不能|不可以|生成|协助|帮助|继续|提供|回应|参与|处理)/i.test(start);
    const chineseStrong=/^(?:我(?:无法|不能)(?:继续)?(?:生成|提供|协助|参与|处理)|很?抱歉[，,\s]*我(?:无法|不能))(?:[^\n]{0,50})(?:内容|请求|角色扮演|描写|场景|故事|情节)/.test(start);
    const chinesePolicy=/(?:安全(?:政策|准则|规则|限制|标准)|内容政策|平台(?:政策|规定)|(?:作为|身为)(?:一个|一名)?(?:ai|人工智能|语言模型)|无法(?:生成|参与|继续(?:生成|提供|协助|处理|回答))|不能(?:生成|参与|继续(?:生成|提供|协助|处理|回答))|我(?:必须|只能)拒绝|涉及(?:露骨|色情|性描写)|不(?:能|可以)协助)/i.test(evidence);
    // Gateway responses frequently speak about 'this/previous request' in
    // third person rather than saying 'I cannot'. Require opening provider
    // voice AND a technical refusal act; dialogue mid-scene is not enough.
    const front=start.slice(0,180).replace(/^[\s*#—-]+/,'');
    const thirdParty=/^(?:该|此|本|前一条|上一条|你(?:的)?|您(?:的)?)(?:次|条)?(?:请求|提示词|内容|消息|问题)[^\n]{0,90}(?:因|由于|涉及|包含|触及|违反|不符合|无法|不能|被)/.test(front);
    const explicitBlock=/(?:无法(?:继续)?(?:生成|处理|提供|响应)|不能(?:继续)?(?:生成|提供|处理)|已?(?:被)?(?:拒绝|拦截|阻止)|不(?:予|会)提供|平台安全(?:规范|政策|标准|限制)禁止|违反(?:了)?(?:平台)?(?:安全|内容)(?:政策|规范|准则))/i.test(evidence);
    const providerSafety=/(?:平台|系统|模型|服务商|安全|内容|政策|规范|审核|拦截|限制|request|policy|safety|guidelines)/i.test(evidence);
    const engGateway=/^(?:the (?:previous|last|current|given|above)?\s*(?:request|prompt|content)|this (?:request|content)|your (?:request|prompt))[^\n]{0,110}(?:violat|involv|cannot|can't|prohibit|disallow|not allow|blocked)/i.test(front);
    const engBlocked=/(?:cannot (?:be )?(?:fulfilled|generated|processed)|cannot comply|(?:was|has been|is) (?:blocked|refused)|(?:violates|against) (?:the )?(?:safety|content) (?:policy|guidelines))/i.test(evidence);
    const japanese=/^(?:申し訳|すみません|AIとして|人工知能として)/i.test(start)&&/(?:AI|言語モデル|安全ポリシー|ガイドライン|コンテンツポリシー)/i.test(evidence)&&/(?:対応|生成|提供|お手伝い)(?:することが)?できません|お応えできません/.test(evidence);
    if((english&&(englishPolicy||englishStrong))||(chinese&&(chinesePolicy||chineseStrong))||(thirdParty&&explicitBlock&&providerSafety)||(engGateway&&engBlocked)||japanese)return {blocked:true,reason:'provider_plaintext_refusal'};
    return {blocked:false,reason:''};
  }
  function validateStoryReply(reply,meta={}){
    const result=classifyStoryReply(reply,meta);
    if(result.blocked)throw new ApiError('E_API_REFUSAL_CONTENT','模型返回了拒绝声明，已阻止将其作为角色回复保存或归档。',{hint:'这是模型或网关返回的内容限制，不代表你请求了绘图。可以手动重试或检查模型服务；不会自动重复付费请求。',details:JSON.stringify({stage:'story_reply_admission',reason:result.reason,finishReason:String(meta.finishReason||'unknown'),receivedChars:String(reply||'').length})});
    if(meta.outputContract?.completeHtml===true)validateCompleteHtml(reply);
    return reply;
  }
  function validateCompleteHtml(raw){
    const source=String(raw??''),stack=[],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    const tags=/<!--[\s\S]*?-->|<!(?!--)[^>]*>|<\/?([A-Za-z][\w:.-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
    let match,issue='',cursor=0;
    const unfinished=part=>/<(?:!--|!doctype\b|\/?[A-Za-z][\w:.-]*(?:\s|$))/i.test(part);
    while((match=tags.exec(source))){
      if(unfinished(source.slice(cursor,match.index))){issue='unfinished_markup';break;}
      cursor=tags.lastIndex;
      if(!match[1])continue;
      const tag=match[1].toLowerCase(),close=/^<\//.test(match[0]);
      if(voidTags.has(tag)||/\/\s*>$/.test(match[0]))continue;
      if(close){if(stack.pop()!==tag){issue='mismatched_closing_tag';break;}}
      else if(tag==='script'||tag==='style'){
        const ending=new RegExp('</'+tag+'\\s*>','ig');ending.lastIndex=tags.lastIndex;const found=ending.exec(source);
        if(!found){issue='unclosed_raw_element';break;}tags.lastIndex=ending.lastIndex;cursor=tags.lastIndex;
      }else stack.push(tag);
    }
    if(!issue&&unfinished(source.slice(cursor)))issue='unfinished_markup';
    if(issue||stack.length)throw new ApiError('E_STORY_OUTPUT_INCOMPLETE','回复未满足已开启的 HTML 完整性检查，未提交残缺正文。',{details:JSON.stringify({stage:'story_output_contract',reason:issue||'unclosed_tags',openTags:stack.slice(-12)})});
    return raw;
  }
  async function processStoryTurn(id,userText,action='send',signal,temp=.85,options={},progress=null){
    const preparationStartedAt=Date.now();
    let session=getSession(id);
    if(!session)throw new ApiError('E_STORY_SESSION_MISSING','剧本档案丢失猫！',{hint:'本地剧情 Session（剧情会话）不存在或已被删除，请重新打开剧情。'});
    session=normalizeSession(session);
    let canonicalFingerprint=null;
    const retryPending=action==='retry'?session.pendingGeneration:null;
    if(action==='retry'){
      if(!retryPending?.snapshot)throw new ApiError('E_STORY_RETRY_MISSING','没有可重试的未结算请求。');
      canonicalFingerprint=memorySourceFingerprint(session.messages,session.messages.length);
      if(retryPending.canonicalFingerprint!==canonicalFingerprint)throw new ApiError('E_STORY_RETRY_STALE','失败后剧情原文已变化，不能把旧请求提交到新时间线。');
      action=retryPending.action;
      options={...options,targetMessageId:retryPending.targetMessageId};
    }
    emitProgress(progress,{phase:'preparing',percent:8,detail:'正在整理本轮上下文…'});
    let unsavedUserInput=false,commitStarted=false;
    if(action==='send'&&!retryPending){
      if(!String(userText||'').trim())throw new ApiError('E_STORY_EMPTY_INPUT','还没有输入内容猫！',{hint:'请输入动作、语言或剧情后再发送。'});
      const originalUserText=String(userText||'');const transformedUserText=applyRegexForSession(session,originalUserText,'input');
      const userMsg=makeMessage('user',transformedUserText,session,{source:'manual_send',regexInputApplied:transformedUserText!==originalUserText,inputSemanticMode:inputSemanticMode(session),inputSemanticParserVersion:'1.1.7'});userMsg.rawContent=originalUserText;session.messages.push(userMsg);
      unsavedUserInput=true;
    }
    let sourceBeforeReply,target=null,opts,cfg,built=null,requestBody=null,snapshot=null,messages,pending;
    try{
    // “重说”必须在任何摘要/异步保存之前锁定目标消息 ID，避免后续状态变化后误替换上一轮剧情。
    const requestedTargetId=action==='regenerate'?text(options?.targetMessageId):'';
    const lockedTargetId=action==='regenerate'?(resolveRegenerationTarget(session,requestedTargetId)?.id||null):null;
    sourceBeforeReply=clone(session.messages);
    if(action==='continue'){
      target=[...session.messages].reverse().find(m=>m.role==='assistant');
      if(!target)throw new ApiError('E_STORY_NO_ASSISTANT','还没有 Assistant（助手）回复，无法续写猫！',{hint:'先生成一条角色回复，再使用续写。'});
    }else if(action==='regenerate'&&lockedTargetId){
      target=session.messages.find(m=>m.id===lockedTargetId&&m.role==='assistant')||null;
      if(!target)throw new ApiError('E_STORY_REGEN_TARGET_MISSING','要重说的那条回复在生成前消失了，已阻止覆盖其他剧情。',{hint:'请刷新剧情后再点一次“重说”。'});
    }
    // 当前最后一轮还没有 assistant 时，“重说”退化为生成该轮回复；不会去覆盖上一轮 assistant。
    const promptAction=(action==='regenerate'&&!target)?'respond':action;
    opts=actionOptions(promptAction,userText,options);
    // Regeneration is an alternate completion of the *prior* transcript.
    // Do not let replaced text trigger lore, lexical retrieval or summaries.
    // Canonical session and its versions remain unchanged until settlement.
    const targetIndex=target&&action==='regenerate'?session.messages.findIndex(m=>m.id===target.id):-1;
    const promptSession=targetIndex>=0?normalizeSession({...session,messages:session.messages.slice(0,targetIndex),promptLineageProjection:true}):session;
    // Reuse an exact hash only within this synchronous preparation. Canonical
    // and replacement-prefix hashes remain distinct; no cross-turn cache.
    canonicalFingerprint??=memorySourceFingerprint(session.messages,session.messages.length);
    const sourceFingerprint=promptSession===session?canonicalFingerprint:memorySourceFingerprint(promptSession.messages,promptSession.messages.length);
    cfg=getApiConfig();
    const originalSnapshot=retryPending?.snapshot||(action==='regenerate'&&target&&options.regenerationContext!=='current'?target.metadata?.generationSnapshot:null);
    if(originalSnapshot){
      requestBody=restoreGenerationRequest(originalSnapshot,promptSession,sourceFingerprint);snapshot=clone(originalSnapshot);
      if(retryPending&&options.retryParameters==='current'){
        // Only the explicitly selected transport parameters change. Lore,
        // memory, presets and player text remain those of the frozen request.
        const frozenMessages=requestBody.messages.map(m=>({role:m.role,content:m.content}));
        requestBody=makeApiBody(frozenMessages,cfg,cfg.temperature??temp,{continuation:action==='continue'});
        snapshot=generationSnapshot(session,promptSession,requestBody,originalSnapshot.messageSources,action,action==='continue'?target?.id:null,sourceFingerprint);
      }
      emitProgress(progress,{phase:'prompt_ready',percent:34,detail:retryPending?(options.retryParameters==='current'?'保留原轮冻结消息，使用当前 API 模型与参数重试；不重复玩家消息。':'按原模型和参数重试冻结请求；API 设置变更不会改变本次请求。'):'使用原轮冻结上下文重新采样；旧回复与版本不进入请求。'});
    }else{
      built=assemble(promptSession,opts);
      requestBody=makeApiBody(built.messages,cfg,temp,{continuation:action==='continue'});
      snapshot=generationSnapshot(session,promptSession,requestBody,built.messageSources,action,action==='continue'?target?.id:null,sourceFingerprint);
      const detail=action==='regenerate'&&target&&options.regenerationContext!=='current'?'旧记录没有请求快照，已明确使用当前挂载重建原轮。':action==='continue'?(cfg.continuationMode==='deepseek_prefix'?'按已声明的 prefix 协议请求续写。':'普通 Chat 后续 assistant 生成；接口未声明原文前缀补全，连续性由上下文和玩家预设决定。'):`Prompt（提示词）已组装 · ${requestBody.messages.length} 条消息`;
      emitProgress(progress,{phase:'prompt_ready',percent:34,detail});
    }
    cfg={...cfg,model:requestBody.model,stream:requestBody.stream===true,sendTemperature:Object.hasOwn(requestBody,'temperature'),maxTokens:requestBody.max_tokens||0};
    messages=requestBody.messages;
    pending={id:retryPending?.id||makeId('generation'),action,targetMessageId:target?.id||null,snapshot,canonicalFingerprint,status:'prepared',attempt:(retryPending?.attempt||0)+1};
    // The new player message and its frozen request share one CAS commit.
    // Both are durable before fetch without rewriting the full library twice.
    commitStarted=true;
    session=await saveSession({...session,pendingGeneration:pending});
    if(unsavedUserInput){unsavedUserInput=false;emitProgress(progress,{phase:'saved_user',percent:38,detail:'主人消息与本轮请求已安全写入本地剧情。'});}
    }catch(preparationError){
      // Invalid presets/budget/assembly must not discard a submitted player
      // message. A failed CAS is never retried against newer canonical data.
      if(unsavedUserInput&&!commitStarted){
        try{session=await saveSession(session);emitProgress(progress,{phase:'saved_user',percent:14,detail:'主人消息已保留；本轮请求准备失败，尚未发送。'});}
        catch(storageError){console.error('请求准备失败且玩家消息保存失败；未覆盖新时间线',{sessionId:id,error:storageError});}
      }
      throw preparationError;
    }
    const storyResultMeta={};
    // Diagnostics intentionally live outside state, local-store, History,
    // versions, rolling/core/fact memory and the backup/export contract.
    const journal=window.MimaDiagnosticJournal;
    const diagnosticId=journal?.begin?.({sessionId:id,turnId:options.diagnosticTurnId||'',action});
    let diagnosticCandidate='';
    try{
    const replyRaw=await callModelWithConfig(messages,cfg,temp,signal,{onProgress:progress,resultMeta:storyResultMeta,requestBody,messageSources:snapshot.messageSources,
      storyContext:{sessionId:id,generationId:pending.id,generationAttempt:pending.attempt,preparationElapsedMs:Date.now()-preparationStartedAt},
      onDiagnostic:event=>{if(diagnosticId)void journal.event(diagnosticId,event);}});
    if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
    diagnosticCandidate=replyRaw;
    const admissionMeta={...storyResultMeta,outputContract:session.promptSettings?.outputContract};
    validateStoryReply(replyRaw,admissionMeta);
    // Hard invariant: never persist a blank assistant message.
    if(!text(replyRaw))throw new ApiError('E_API_EMPTY_REPLY','模型返回空白正文，已阻止写入剧情。');
    const reply=applyRegexForSession(session,replyRaw,'output');
    diagnosticCandidate=reply;
    // Output regex is a second admission boundary: it must not turn an
    // accepted provider response into an empty or provider-voice refusal.
    validateStoryReply(reply,admissionMeta);
    if(!text(reply))throw new ApiError('E_API_EMPTY_REPLY','输出正则处理后没有有效角色正文；未提交空白消息。');
    const renderedReply=applyRegexForSession(session,reply,'display');
    emitProgress(progress,{phase:'saving',percent:95,detail:'正在保存角色回复…'});
    if(action==='continue'&&target){
      const i=session.messages.findIndex(m=>m.id===target.id),previousContent=session.messages[i].content,previousRaw=session.messages[i].rawContent||previousContent;archiveVersion(session.messages[i],'continue_before_append');session.messages[i].content=`${previousContent}\n${reply}`;session.messages[i].rawContent=`${previousRaw}\n${replyRaw}`;session.messages[i].renderedContent=applyRegexForSession(session,session.messages[i].content,'display');session.messages[i].metadata={...(session.messages[i].metadata||{}),continuedAt:nowIso()};session.messages[i].tokenEstimate=estimateTokens(session.messages[i].content);
    }else if(action==='regenerate'&&target){
      const i=session.messages.findIndex(m=>m.id===target.id);
      if(i<0)throw new ApiError('E_STORY_REGEN_TARGET_MISSING','要重说的那条回复在保存前消失了，已阻止覆盖其他剧情。');
      archiveVersion(session.messages[i],classifyStoryReply(session.messages[i].rawContent||session.messages[i].content).blocked?'legacy_refusal_evidence':'regenerate');session.legacyMemoryQuarantined=true;session.messages[i].content=reply;session.messages[i].rawContent=replyRaw;session.messages[i].renderedContent=renderedReply;session.messages[i].isEdited=false;session.messages[i].metadata={...(session.messages[i].metadata||{}),regeneratedAt:nowIso(),regeneratedTargetId:target.id,generationSnapshot:snapshot};session.messages[i].tokenEstimate=estimateTokens(reply);
    }else{
      const assistantMsg=makeMessage('assistant',reply,session,action==='auto_advance'?{source:'auto_advance',directorNote:opts.directorNote,generationSnapshot:snapshot}:{source:'model_reply',generationSnapshot:snapshot});assistantMsg.rawContent=replyRaw;assistantMsg.renderedContent=renderedReply;session.messages.push(assistantMsg);
    }
    // A memory job may have committed while Provider was generating. Rebase only
    // when the original story prefix has not changed. Never overwrite memory.
    const generatedMessages=clone(session.messages);let saved=null;
    for(let commitAttempt=0;commitAttempt<3;commitAttempt++){
      const persisted=normalizeState(await window.MimaLocalStore.loadState());
      const latest=persisted.sessions.find(x=>x.id===id);
      if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
      if(!latest||latest.pendingGeneration?.id!==pending.id||latest.pendingGeneration.attempt!==pending.attempt||JSON.stringify(latest.messages)!==JSON.stringify(sourceBeforeReply))throw new ApiError('E_CANONICAL_CONFLICT','生成期间剧情原文被其他操作修改；拒绝以旧回复覆盖新时间线。');
      // Rebase the one generated turn onto a verified current Session. Style,
      // manual memory and other settings changed while thinking are retained.
      state=persisted;
      try{saved=await saveSession({...latest,messages:generatedMessages,pendingGeneration:null,legacyMemoryQuarantined:latest.legacyMemoryQuarantined||session.legacyMemoryQuarantined},{signal});break;}
      catch(e){if(!String(e?.message||'').includes('E_CANONICAL_CONFLICT')||commitAttempt===2)throw e;}
    }
    // Auto summary is a lower-priority independent job; never block Direct Reply.
    queueRollingSummary(id,temp);
    emitProgress(progress,{phase:'done',percent:100,detail:'剧情生成完成。'});
    if(diagnosticId)void journal.event(diagnosticId,{type:'settlement',status:'committed',finishKind:storyResultMeta.finishKind,finishReason:storyResultMeta.finishReason});
    return saved;
    }catch(e){
      // Persist only request lifecycle metadata, never rejected model content in canonical data.
      try{
        const persisted=normalizeState(await window.MimaLocalStore.loadState()),latest=persisted.sessions.find(x=>x.id===id);
        if(latest?.pendingGeneration?.id===pending.id&&latest.pendingGeneration.attempt===pending.attempt){state=persisted;await saveSession({...latest,pendingGeneration:{...latest.pendingGeneration,status:'failed',errorCode:e?.code||e?.name||'E_STORY_RUNTIME'}});}
      }catch(storageError){console.error('生成失败状态无法保存；原始剧情未作为空库覆盖',{sessionId:id,generationId:pending.id,error:storageError});}
      if(diagnosticId){
        const code=e?.code||'E_STORY_RUNTIME';
        void journal.event(diagnosticId,{type:'settlement',status:e?.name==='AbortError'?'aborted':code==='E_CANONICAL_CONFLICT'?'conflict':'rejected',
          code,message:e?.message||String(e),details:e?.details||'',httpStatus:e?.status||0,
          rawRejectedReply:e?.partialDraft||diagnosticCandidate||'',rawLimited:typeof e?.partialDraft==='string'&&e.partialDraft.length>=24000,finishKind:storyResultMeta.finishKind||'',finishReason:storyResultMeta.finishReason||''});
      }
      throw e;
    }
  }
  async function editMessage(id,msgId,content,opts={}){const s=getSession(id);if(!s)throw new Error('未找到剧本');const i=s.messages.findIndex(m=>m.id===msgId);if(i<0)throw new Error('未找到消息');const msg=s.messages[i];archiveVersion(msg,'manual_edit');msg.content=String(content||'');msg.rawContent=msg.content;msg.renderedContent=msg.role==='assistant'?applyRegexForSession(s,msg.content,'display'):msg.content;if(msg.role==='user')msg.metadata={...(msg.metadata||{}),inputSemanticMode:inputSemanticMode(s),inputSemanticParserVersion:'1.1.7'};msg.isEdited=true;msg.editedAt=nowIso();msg.tokenEstimate=estimateTokens(msg.content);s.legacyMemoryQuarantined=true;if(opts.truncateAfter){const removed=s.messages.slice(i+1);if(removed.length){s.archivedBranches=arr(s.archivedBranches);s.archivedBranches.push({id:makeId('branch'),fromMessageId:msg.id,reason:'edit_truncate_after',archivedAt:nowIso(),messages:removed});s.messages=s.messages.slice(0,i+1);}}return saveSession(s);}
  async function restoreMessageVersion(id,msgId,versionIndex,body={}){
    const current=getSession(id);if(!current)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');
    const session=normalizeSession(clone(current)),msg=session.messages.find(m=>m.id===msgId);
    if(!msg)throw new ApiError('E_STORY_VERSION_TARGET_MISSING','目标消息已经不存在，未恢复旧版本。');
    if(typeof body.expectedContent!=='string'||!Number.isInteger(body.expectedVersionCount)||
      body.expectedContent!==msg.content||body.expectedVersionCount!==arr(msg.versions).length)
      throw new ApiError('E_STORY_VERSION_CONFLICT','消息或版本列表已经变化，请刷新后重新选择旧版本。');
    const index=Number(versionIndex);
    if(!Number.isInteger(index)||index<0||index>=msg.versions.length)
      throw new ApiError('E_STORY_VERSION_MISSING','所选旧版本已经不存在。');
    const stored=msg.versions[index],version=typeof stored==='string'?{content:stored}:stored;
    if(!version||typeof version.content!=='string'||!version.content.trim())
      throw new ApiError('E_STORY_VERSION_INVALID','旧版本没有有效正文，未恢复。');
    // Content-only old archives cannot inherit the active version's raw text
    // or generation snapshot. That would attribute a different request/source.
    const raw=typeof version.rawContent==='string'?version.rawContent:version.content;
    if(msg.role==='assistant'){validateStoryReply(raw);validateStoryReply(version.content);}
    archiveVersion(msg,'version_restore');
    msg.content=version.content;msg.rawContent=raw;
    msg.renderedContent=typeof version.renderedContent==='string'?version.renderedContent:
      (msg.role==='assistant'?applyRegexForSession(session,version.content,'display'):version.content);
    msg.isEdited=version.isEdited===true;
    msg.metadata={...(version.metadata&&typeof version.metadata==='object'?clone(version.metadata):{}),
      restoredAt:nowIso(),restoredVersionIndex:index,restoredVersionId:version.versionId||null};
    if(version.messageTime)msg.time=version.messageTime;
    msg.tokenEstimate=estimateTokens(msg.content);session.legacyMemoryQuarantined=true;
    // saveSession checks the persisted session revision plus the whole-store
    // CAS. Neither a concurrent edit nor a late result can be overwritten.
    return saveSession(session);
  }
  async function deleteMessage(id,msgId){
    const s=getSession(id);if(!s)throw new Error('未找到剧本');
    const i=s.messages.findIndex(m=>m.id===msgId);if(i<0)throw new Error('未找到消息');
    const [removed]=s.messages.splice(i,1);
    const recovery=normalizeMessage({...clone(removed),metadata:{...(removed?.metadata||{}),deletedAt:nowIso(),deleteReason:'manual_delete'}});
    s.deletedMessages=arr(s.deletedMessages);s.deletedMessages.push(recovery);s.legacyMemoryQuarantined=true;
    if(Number.isFinite(Number(s.lastSummarizedIndex)))s.lastSummarizedIndex=Math.max(0,Math.min(Number(s.lastSummarizedIndex),s.messages.length));
    return saveSession(s);
  }
  async function addOpening(id,content){const s=getSession(id);if(!s)throw new Error('未找到剧本');if(!String(content||'').trim())throw new Error('开场白为空');const msg=makeMessage('assistant',content,s,{source:'character_first_message'});msg.renderedContent=applyRegexForSession(s,msg.content,'display');s.messages.push(msg);return saveSession(s);}
  function previewPrompt(id,opts={}){const s=getSession(id);if(!s)throw new Error('未找到剧本');const c=normalizeSession(clone(s));if(String(opts.draft||'').trim())c.messages.push(makeMessage('user',opts.draft,c,{source:'prompt_preview_draft',inputSemanticMode:inputSemanticMode(c),inputSemanticParserVersion:'1.1.7'}));return assemble(c,{directorNote:opts.directorNote||''}).inspector;}

  // ---------- Local route compatibility ----------
  function ok(data){return{success:true,data};}
  function fail(msg,extra={}){return{success:false,msg,...extra};}
  async function handle(endpoint,method='GET',body=null,signal=null,progress=null){
    try{
      const path=String(endpoint||'').split('?')[0];
      if(path==='/theme'&&method==='GET')return ok(clone(state.themeSettings));
      if(path==='/theme'&&method==='PATCH')return ok(await saveThemeSettings(body||{}));
      if(path==='/novel-assets'&&method==='GET')return ok(novelAssets());
      if(path==='/novels'&&method==='GET')return ok(novelSummaries());
      if(path==='/novels'&&method==='POST')return ok(await saveNovelProject(createBlankNovel(body||{}),{allowCreate:true}));
      if(path==='/novels/import'&&method==='POST'){const p=window.MimaNovelEngine.createProjectFromText({title:body?.title,sourceName:body?.sourceName||'',sourceEncoding:body?.sourceEncoding||'utf-8',text:body?.text||''});return ok(await saveNovelProject(p,{allowCreate:true}));}
      let nm=path.match(/^\/novels\/([^/]+)$/);if(nm&&method==='GET'){const p=getNovel(nm[1]);return p?ok(p):fail('未找到小说项目');}
      if(nm&&method==='PATCH')return ok(await patchNovelProject(nm[1],body||{}));
      if(nm&&method==='DELETE'){const before=state.novelProjects.length;state.novelProjects=state.novelProjects.filter(x=>x.id!==nm[1]);await persist();return ok({deleted:state.novelProjects.length<before});}
      nm=path.match(/^\/novels\/([^/]+)\/chapters$/);if(nm&&method==='POST'){const p=getNovelProject(nm[1]);return ok(await saveNovelProject(window.MimaNovelEngine.appendNewChapter(p,body?.title||'')));}
      nm=path.match(/^\/novels\/([^/]+)\/reparse$/);if(nm&&method==='POST'){const p=getNovelProject(nm[1]);return ok(await saveNovelProject(window.MimaNovelEngine.reparseImportedProject(p)));}
      nm=path.match(/^\/novels\/([^/]+)\/chapters\/([^/]+)$/);if(nm&&method==='PATCH'){const p=getNovelProject(nm[1]),next=window.MimaNovelEngine.editChapter(p,nm[2],body?.action||'replace_text',body||{});return ok(await saveNovelProject(next));}
      nm=path.match(/^\/novels\/([^/]+)\/test-connection$/);if(nm&&method==='POST'){const p=getNovelProject(nm[1]),cfg=novelModelConfig(p);const stages=[{stage:'summary_nonstream',stream:false},{stage:'continuation',stream:cfg.stream}],out={model:cfg.model,streamSetting:cfg.stream};
        for(const step of stages){try{const reply=await callModelWithConfig([{role:'user',content:'请回复：连接成功'}],cfg,cfg.temperature,signal,{streamOverride:step.stream,onProgress:progress});out[step.stage]={ok:true,chars:reply.length};}
          catch(e){if(e instanceof ApiError)e.details=[`novel_test_stage: ${step.stage}`,e.details].filter(Boolean).join('; ');throw e;}}
        return ok(out);}
      nm=path.match(/^\/novels\/([^/]+)\/prompt-preview$/);if(nm&&method==='POST')return ok(novelPromptPreview(nm[1],body||{}));
      nm=path.match(/^\/novels\/([^/]+)\/continue$/);if(nm&&method==='POST')return ok(await continueNovel(nm[1],body||{},signal,progress));
      nm=path.match(/^\/novels\/([^/]+)\/drafts\/([^/]+)$/);if(nm&&method==='PATCH')return ok(await patchNovelDraft(nm[1],nm[2],body||{}));
      if(nm&&method==='DELETE')return ok(await rejectNovelDraft(nm[1],nm[2]));
      nm=path.match(/^\/novels\/([^/]+)\/drafts\/([^/]+)\/continue$/);if(nm&&method==='POST')return ok(await continueNovel(nm[1],{...(body||{}),draftId:nm[2]},signal,progress));
      nm=path.match(/^\/novels\/([^/]+)\/drafts\/([^/]+)\/regenerate$/);if(nm&&method==='POST')return ok(await regenerateNovelDraft(nm[1],nm[2],body||{},signal,progress));
      nm=path.match(/^\/novels\/([^/]+)\/drafts\/([^/]+)\/accept$/);if(nm&&method==='POST')return ok(await acceptNovelDraft(nm[1],nm[2],signal,progress));
      nm=path.match(/^\/novels\/([^/]+)\/memory\/chapter\/([^/]+)$/);if(nm&&method==='POST')return ok(await updateNovelMemory(nm[1],nm[2],signal,progress));
      nm=path.match(/^\/novels\/([^/]+)\/memory\/rebuild$/);if(nm&&method==='POST')return ok(await rebuildNovelMemory(nm[1],signal,progress));
      nm=path.match(/^\/novels\/([^/]+)\/memory\/legacy-review$/);if(nm&&method==='POST')return ok(await reviewLegacyMemoryItem(nm[1],body||{}));
      nm=path.match(/^\/novels\/([^/]+)\/memory$/);if(nm&&method==='PATCH')return ok(await patchNovelMemory(nm[1],body||{}));
      nm=path.match(/^\/novels\/([^/]+)\/export\/txt$/);if(nm&&method==='GET'){const p=getNovelProject(nm[1]);return ok({name:`${p.title||'novel'}.txt`,text:window.MimaNovelEngine.exportProjectText(p)});}
      nm=path.match(/^\/novels\/([^/]+)\/export\/json$/);if(nm&&method==='GET'){const p=getNovelProject(nm[1]);return ok({name:`${p.title||'novel'}.json`,project:clone(p)});}

      if(path==='/sessions'&&method==='GET')return ok(sessionSummaries());
      if(path==='/sessions/full'&&method==='GET')return ok(state.sessions);
      if(path==='/sessions'&&method==='POST'){const s=await saveSession(normalizeSession({...body,id:makeId('sess'),createdAt:nowIso(),updatedAt:nowIso(),messages:[]}),{allowCreate:true});return ok(s);}
      if(path==='/sessions/import'&&method==='POST'){const s=normalizeSession({...body,id:makeId('sess'),title:`${text(body?.title||'导入剧情')} · 导入`,createdAt:nowIso(),updatedAt:nowIso()});return ok(await saveSession(s,{allowCreate:true}));}
      let m=path.match(/^\/sessions\/([^/]+)$/);if(m&&method==='GET'){const s=getSession(m[1]);return s?ok(s):fail('未找到剧本');}
      if(m&&method==='PATCH'){const s=getSession(m[1]);return s?ok(await saveSession({...s,...body,id:s.id,createdAt:s.createdAt})):fail('未找到剧本');}
      if(m&&method==='DELETE'){const before=state.sessions.length;state.sessions=state.sessions.filter(x=>x.id!==m[1]);await persist();return ok({deleted:state.sessions.length<before});}
      m=path.match(/^\/sessions\/([^/]+)\/chat$/);if(m&&method==='POST')return ok(await processStoryTurn(m[1],body?.text,body?.action||'send',signal,body?.temperature,{directorNote:body?.directorNote||'',targetMessageId:body?.targetMessageId||null,diagnosticTurnId:body?.diagnosticTurnId||'',regenerationContext:body?.regenerationContext||'original',retryParameters:body?.retryParameters==='current'?'current':'original'},progress));
      m=path.match(/^\/sessions\/([^/]+)\/prompt-preview$/);if(m&&method==='POST')return ok(previewPrompt(m[1],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/opening$/);if(m&&method==='POST')return ok(await addOpening(m[1],body?.content||''));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)$/);if(m&&method==='PATCH')return ok(await editMessage(m[1],m[2],body?.content,{truncateAfter:!!body?.truncateAfter}));
      if(m&&method==='DELETE')return ok(await deleteMessage(m[1],m[2]));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/versions\/(\d+)\/restore$/);if(m&&method==='POST')return ok(await restoreMessageVersion(m[1],m[2],Number(m[3]),body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory$/);if(m&&method==='PATCH')return ok(await updateManualMemory(m[1],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/core$/);if(m&&method==='POST')return ok(await runRecordedMemory('core',m[1],body||{},signal,progress));
      if(m&&method==='DELETE')return ok(await deleteCoreMemory(m[1]));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/rolling$/);if(m&&method==='POST'){const result=await window.MimaLocalStore.updateRollingMemory(m[1],body?.action||'revoke');await init();return ok(getSession(m[1])||result);}
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts$/);if(m&&method==='POST')return ok(await runRecordedMemory('facts',m[1],body||{},signal,progress));
      if(m&&method==='DELETE')return ok(await deleteFactMemory(m[1]));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts\/([^/]+)$/);if(m&&method==='DELETE')return ok(await deleteFactMemory(m[1],m[2]));

      if(path==='/masks'&&method==='GET')return ok(state.masks);
      if(path==='/masks'&&method==='POST')return ok(await saveMask(body||{}));
      m=path.match(/^\/masks\/([^/]+)$/);if(m&&method==='PATCH'){const old=getMask(m[1]);return old?ok(await saveMask({...old,...body,id:m[1]})):fail('未找到面具');}
      if(m&&method==='DELETE'){state.masks=state.masks.filter(x=>x.id!==m[1]);for(const s of state.sessions){if(s.loadedCharMaskId===m[1]||s.loadedUserMaskId===m[1]){if(s.loadedCharMaskId===m[1])s.loadedCharMaskId=null;if(s.loadedUserMaskId===m[1])s.loadedUserMaskId=null;s.recordRevision++;}}await persist();return ok({deleted:true});}

      if(path==='/presets'&&method==='GET')return ok(state.presets);
      if(path==='/presets'&&method==='POST')return ok(await savePreset(body||{}));
      m=path.match(/^\/presets\/([^/]+)$/);if(m&&method==='PATCH'){const old=getPreset(m[1]);return old?ok(await savePreset({...old,...body,id:m[1]})):fail('未找到预设');}
      if(m&&method==='DELETE'){state.presets=state.presets.filter(x=>x.id!==m[1]);for(const s of state.sessions)if(s.presetIds.includes(m[1])){s.presetIds=s.presetIds.filter(id=>id!==m[1]);s.recordRevision++;}for(const p of state.novelProjects)if(p.presetIds.includes(m[1])){p.presetIds=p.presetIds.filter(id=>id!==m[1]);p.recordRevision++;}await persist();return ok({deleted:true});}

      if(path==='/css-presets'&&method==='GET')return ok(state.cssPresets);
      if(path==='/css-presets'&&method==='POST')return ok(await saveCssPreset(body||{}));
      m=path.match(/^\/css-presets\/([^/]+)$/);if(m&&method==='PATCH'){const old=getCssPreset(m[1]);return old?ok(await saveCssPreset({...old,...body,id:m[1]})):fail('未找到 CSS Preset');}
      if(m&&method==='DELETE'){state.cssPresets=state.cssPresets.filter(x=>x.id!==m[1]);if(state.themeSettings?.globalCssPresetId===m[1])state.themeSettings={...state.themeSettings,globalCssPresetId:null,globalCssEnabled:false};for(const sess of state.sessions){if(sess.customCssId===m[1]){sess.customCssId=null;sess.customCssEnabled=false;sess.recordRevision++;}}for(const p of state.novelProjects){if(p.appearance?.customCssId===m[1]){p.appearance.customCssId=null;p.appearance.customCssEnabled=false;p.recordRevision++;}}await persist();return ok({deleted:true});}

      if(path==='/regex-packs'&&method==='GET')return ok(state.regexPacks);
      if(path==='/regex-packs'&&method==='POST')return ok(await saveRegexPack(body||{}));
      m=path.match(/^\/regex-packs\/([^/]+)$/);if(m&&method==='PATCH'){const old=getRegexPack(m[1]);return old?ok(await saveRegexPack({...old,...body,id:m[1]})):fail('未找到正则包');}
      if(m&&method==='DELETE'){state.regexPacks=state.regexPacks.filter(x=>x.id!==m[1]);for(const sess of state.sessions)if(sess.regexPackIds.includes(m[1])){sess.regexPackIds=sess.regexPackIds.filter(id=>id!==m[1]);sess.recordRevision++;}await persist();return ok({deleted:true});}

      if(path==='/worldbooks'&&method==='GET')return ok(state.worldbooks);
      if(path==='/worldbooks'&&method==='POST')return ok(await saveWorldbook(body||{}));
      m=path.match(/^\/worldbooks\/([^/]+)$/);if(m&&method==='GET'){const w=getWorldbook(m[1]);return w?ok(w):fail('未找到世界书');}
      if(m&&method==='PATCH'){const old=getWorldbook(m[1]);return old?ok(await saveWorldbook({...old,...body,id:m[1]})):fail('未找到世界书');}
      if(m&&method==='DELETE'){state.worldbooks=state.worldbooks.filter(x=>x.id!==m[1]);for(const s of state.sessions)if(s.worldbookIds.includes(m[1])){s.worldbookIds=s.worldbookIds.filter(id=>id!==m[1]);s.recordRevision++;}for(const p of state.novelProjects)if(p.worldbookIds.includes(m[1])){p.worldbookIds=p.worldbookIds.filter(id=>id!==m[1]);p.recordRevision++;}await persist();return ok({deleted:true});}
      return fail(`Standalone 未实现路径：${method} ${path}`);
    }catch(e){
      if(e?.name==='AbortError')return{success:false,aborted:true,code:'E_ABORTED',msg:'生成已停止'};
      const err=e instanceof ApiError?e:asApiError(e,'E_STORY_RUNTIME');
      return fail(err.message||String(err),{code:err.code||'E_STORY_RUNTIME',status:err.status||0,hint:err.hint||apiErrorHint(err.code,err.status,err.message),details:err.details||'',partialDraft:typeof err.partialDraft==='string'?err.partialDraft.slice(0,24000):''});
    }
  }

  async function exportLibrary(){
    // schemaVersion=4 spans multiple historical release shapes; new backups
    // declare the independently versioned full-data contract on export.
    const snapshot=clone(state);
    // Some historical/offline consumers supply only loadState/saveState. The
    // production store always has the validator; do not claim a modern
    // verified contract when that validator is not connected.
    if(typeof window.MimaLocalStore?.validateLibrary==='function'){
      snapshot.backupContractRevision=1;
      window.MimaLocalStore.validateLibrary(snapshot);
    }
    return snapshot;
  }
  function validateLibrary(raw){return window.MimaLocalStore.validateLibrary(raw);}
  async function importLibrary(raw){
    const verified=validateLibrary(raw), before=state;
    const next=normalizeState(verified);
    // All validation happens before any canonical mutation; persist is atomic CAS.
    next.storeRevision=before.storeRevision;
    state=next;
    try{await persist();window.MimaThemeEngine?.apply?.(state.themeSettings);return clone(state);}catch(e){state=normalizeState(await window.MimaLocalStore.loadState());throw e;}
  }

  window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});
  window.MimaStandalone={init,handle,runRecordedMemory,memorySourceFingerprint,getApiConfig,saveApiConfig,buildEndpoints,listModels,listModelsWithConfig,testApi,callModel,callModelWithConfig,validateStoryReply,classifyStoryReply,applyRegexForSession,resolveMacrosForSession,compileUserInputForPrompt,exportLibrary,importLibrary,validateLibrary,assemble,getLastUsage,getState:()=>clone(state)};
})();
