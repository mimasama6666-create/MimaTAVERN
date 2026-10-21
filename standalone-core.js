/**
 * 🍷 咪嘛馆 Standalone Core
 * 浏览器本地 Story DB + Prompt Assembler + OpenAI-compatible API client。
 * 与 MIMAMAO Telegram / 宅邸后端完全隔离。
 */
(() => {
  'use strict';

  const API_CONFIG_KEY = 'MIMAMAO_TAVERN_STANDALONE_API_V1';
  let state = { storeRevision: 0, schemaVersion: 4, sessions: [], masks: [], presets: [], worldbooks: [], cssPresets: [], regexPacks: [], settingTemplates: [], novelProjects: [], themeSettings:{theme:'default',updatedAt:''} };
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
  function manualReplyFingerprint(m){return fingerprint([String(m.content??m.canonicalContent??''),String(m.rawContent??m.content??m.canonicalContent??'')]);}
  function isManuallyRecoveredReply(m){return !!m?.metadata?.manualRecovery?.diagnosticId&&m.metadata.manualRecovery.contentFingerprint===manualReplyFingerprint(m);}
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
      recentMessageLimit: clampInt(input.recentMessageLimit, 6, 100000, 34),
      // Prompt-only, full-turn trimming. Does NOT alter the independent
      // rolling-memory source window, canonical History, or saved summaries.
      contextTrimBatchRounds: clampInt(input.contextTrimBatchRounds, 1, 100, 10),
      contextMinRecentRounds: clampInt(input.contextMinRecentRounds, 1, 100000, 20),
      worldbookBudgetChars: clampInt(input.worldbookBudgetChars, 1000, 1000000, 16000),
      // Legacy summaryEnabled remains readable; new consent is opt-in, never inferred
      // from an old default-true setting that may never have been chosen.
      summaryEnabled: input.autoRollingEnabled === true,
      autoRollingEnabled: input.autoRollingEnabled === true,
      injectSavedRolling: input.injectSavedRolling !== undefined ? input.injectSavedRolling !== false : input.summaryEnabled !== false,
      autoRollingMaxRequests: clampInt(input.autoRollingMaxRequests, 1, 20, 1),
      historyHtmlMode: input.historyHtmlMode==='raw'?'raw':'semantic',
      pinnedFactsEnabled: input.pinnedFactsEnabled !== false,
      showInjectionLabels: input.showInjectionLabels !== false,
      summaryTriggerMessages: clampInt(input.summaryTriggerMessages, 12, 200, 28),
      ...(input.outputContract&&(input.outputContract.completeHtml===true||input.outputContract.requireHtml===true)?{outputContract:{
        completeHtml:input.outputContract.completeHtml===true,
        requireHtml:input.outputContract.requireHtml===true,
        requiredSelectors:String(input.outputContract.requiredSelectors||'').slice(0,600),
        templateMessageId:String(input.outputContract.templateMessageId||'').slice(0,200),
        bodySelector:String(input.outputContract.bodySelector||'').slice(0,200),
        statusSelector:String(input.outputContract.statusSelector||'').slice(0,200),
        staticSelectors:String(input.outputContract.staticSelectors||'').slice(0,600),
        staticCssSelectors:String(input.outputContract.staticCssSelectors||'').slice(0,2000),
        staticCommentTexts:String(input.outputContract.staticCommentTexts||'').slice(0,4000),
        staticClassTokens:String(input.outputContract.staticClassTokens||'').slice(0,4000)
      }}:{}),
      inputSemanticMode: ['auto','dialogue_first','quote_dialogue','raw'].includes(input.inputSemanticMode) && (input.inputSemanticMode==='raw'||input.inputSemanticExplicit===true) ? input.inputSemanticMode : 'raw',
      inputSemanticExplicit: input.inputSemanticExplicit===true,
      legacyInputSemanticMode: ['auto','dialogue_first','quote_dialogue'].includes(input.legacyInputSemanticMode) ? input.legacyInputSemanticMode : input.inputSemanticExplicit!==true&&['auto','dialogue_first','quote_dialogue'].includes(input.inputSemanticMode) ? input.inputSemanticMode : null
    };
  }

  function normalizeMemoryVerification(v={}){
    // Canonical provenance records never store arbitrary model instructions.
    const status=['extractive_verified','human_confirmed','source_bounded','legacy_unverified','model_generated'].includes(v?.status)?v.status:'legacy_unverified';
    return {status,stage:String(v?.stage||'').slice(0,100),
      citations:arr(v?.citations).slice(0,100).map(c=>({messageId:String(c.messageId||''),role:String(c.role||''),start:Math.max(0,Number(c.start)||0),end:Math.max(0,Number(c.end)||0),quote:String(c.quote||'').slice(0,4000)})).filter(c=>c.messageId&&c.end>=c.start)};
  }
  function normalizeFactMemory(m = {}) {
    const startRound=clampInt(m.startRound,1,1000000,1), endRound=clampInt(m.endRound,startRound,1000000,startRound);
    return {
      id:m.id||makeId('factmem'), startRound, endRound, content:text(m.content),
      // Legacy imported facts may lack timestamps. Do not mint a different
      // synthetic timestamp on every read: merge/undo CAS signatures need
      // a deterministic view of the same unchanged canonical bytes.
      createdAt:m.createdAt||'', updatedAt:m.updatedAt||m.createdAt||'',
      source:text(m.source||'manual_fact_summary'), targetChars:clampInt(m.targetChars,80,12000,1800),
      temperature:clampTemp(m.temperature??0.35), sourceMessageCount:Math.max(0,Number(m.sourceMessageCount)||0), sourceCount:Math.max(0,Number(m.sourceCount)||0),sourceFingerprint:String(m.sourceFingerprint||''),
      // Do not add empty fields to legacy facts: facts-derived cores hash the
      // normalized records, so a harmless schema extension must not stale them.
      ...(Object.hasOwn(m,'sourceMessageIds')||Object.hasOwn(m,'sourceHash')?{sourceMessageIds:list(m.sourceMessageIds),sourceHash:String(m.sourceHash||'')}:{}),
      stale:m.stale===true,verification:normalizeMemoryVerification(m.verification)
    };
  }
  function normalizeSummaryContext(raw={}){
    const value=raw&&typeof raw==='object'?raw:{};
    const ids=x=>arr(x).filter(y=>typeof y==='string'&&y.length<=150).slice(0,200);
    return {version:1,userPersona:value.userPersona===true,characterPersona:value.characterPersona===true,
      presetIds:ids(value.presetIds),worldbookMode:['none','selected_entries','matched_entries'].includes(value.worldbookMode)?value.worldbookMode:'none',
      worldbookIds:ids(value.worldbookIds),worldbookEntryIds:ids(value.worldbookEntryIds),
      worldbookEntryRefs:arr(value.worldbookEntryRefs).filter(x=>x&&typeof x.bookId==='string'&&typeof x.entryId==='string').slice(0,200).map(x=>({bookId:x.bookId,entryId:x.entryId}))};
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
        // 0 explicitly means all eligible facts; no artificial 100-item ceiling.
        // Existing saved positive limits retain their exact meaning.
        factInjectionLimit:clampInt(input.settings?.factInjectionLimit,0,Number.MAX_SAFE_INTEGER,12),
        factChunkRounds:clampInt(input.settings?.factChunkRounds,1,200,10),
        factTargetChars:clampInt(input.settings?.factTargetChars,80,12000,1800),
        factScope:input.settings?.factScope==='all'?'all':'recent',
        factRecentRounds:clampInt(input.settings?.factRecentRounds,1,100000,25),
        summaryTemperature:clampTemp(input.settings?.summaryTemperature??0.35),
        memoryModel:String(input.settings?.memoryModel||'').trim().slice(0,240),
        memoryStreamMode:['inherit','on','off'].includes(input.settings?.memoryStreamMode)?input.settings.memoryStreamMode:'inherit',
        summaryContext:normalizeSummaryContext(input.settings?.summaryContext)
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
      description: text(p.description), content: text(p.content), category:text(p.category||'未分类').slice(0,60), favorite:!!p.favorite, priority: Number.isFinite(Number(p.priority)) ? Number(p.priority) : 50,
      enabled: p.enabled !== false, createdAt, updatedAt: p.updatedAt || createdAt };
  }

  function normalizeCssPreset(p = {}) {
    const createdAt = p.createdAt || nowIso();
    const legacyScope=['story','global','app'].includes(p.scope)?p.scope:(['novel','assistant','chat'].includes(p.scope)?p.scope:'story');
    const inferredSurface=legacyScope==='app'?'global':(legacyScope==='novel'?'novel':(legacyScope==='assistant'?'assistant':'chat'));
    const surface=['global','chat','novel','assistant'].includes(p.surface)?p.surface:inferredSurface;
    return { id:p.id || makeId('css'), name:text(p.name || '未命名 CSS'), css:String(p.css || ''), scope:legacyScope, surface, category:text(p.category||'未分类').slice(0,60), favorite:!!p.favorite, atelierReleaseKey:/^css-release:[a-zA-Z0-9:_-]{1,180}$/.test(String(p.atelierReleaseKey||''))?p.atelierReleaseKey:'', createdAt, updatedAt:p.updatedAt || createdAt };
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
      enabled: w.enabled !== false, entries: arr(w.entries).map(normalizeWorldbookEntry), tags: list(w.tags), category:text(w.category||'未分类').slice(0,60), favorite:!!w.favorite,
      createdAt, updatedAt: w.updatedAt || createdAt };
  }

  // Configuration templates have no History, generated Memory, source cursor,
  // running jobs, API credentials, character reply or owner private notes.
  const templateFields=['presetIds','worldbookIds','regexPackIds','loadedUserMaskId','customCssId','customCssEnabled','promptSettings','renderMode','memoryInject'];
  function normalizeSettingTemplate(t={}){
    const raw=t.config&&typeof t.config==='object'&&!Array.isArray(t.config)?t.config:{};
    const config={};
    for(const key of templateFields)if(Object.prototype.hasOwnProperty.call(raw,key)){
      if(['presetIds','worldbookIds','regexPackIds'].includes(key))config[key]=list(raw[key]);
      else if(key==='loadedUserMaskId'||key==='customCssId')config[key]=raw[key]?String(raw[key]):null;
      else if(key==='customCssEnabled')config[key]=raw[key]!==false;
      else if(key==='renderMode')config[key]=raw[key]==='safe_html'?'safe_html':'text';
      else if(key==='promptSettings'){
        const p=normalizePromptSettings(raw[key]);
        // A reference to a message in the SOURCE session must never point into
        // another universe. Owners rebind the template after creation.
        if(p.outputContract)p.outputContract.templateMessageId='';
        p.autoRollingEnabled=false; // paid background work always needs fresh opt-in
        p.summaryEnabled=false;
        config[key]=p;
      }else if(key==='memoryInject')config[key]={injectCore:raw[key]?.injectCore!==false,injectFacts:raw[key]?.injectFacts!==false};
    }
    return {id:String(t.id||makeId('settingtpl')).slice(0,100),name:text(t.name||'未命名剧情模板').slice(0,120),version:1,
      revision:Math.max(0,Number(t.revision)||0),isDefault:t.isDefault===true,config,createdAt:String(t.createdAt||nowIso()),updatedAt:String(t.updatedAt||t.createdAt||nowIso())};
  }
  function templateFromSession(session,include={}){
    const c={};
    if(include.presets!==false)c.presetIds=list(session.presetIds);
    if(include.worldbooks!==false)c.worldbookIds=list(session.worldbookIds);
    if(include.regex!==false)c.regexPackIds=list(session.regexPackIds);
    if(include.userMask===true)c.loadedUserMaskId=session.loadedUserMaskId||null;
    if(include.css===true){c.customCssId=session.customCssId||null;c.customCssEnabled=session.customCssEnabled!==false;}
    if(include.context!==false){c.promptSettings=clone(session.promptSettings);if(c.promptSettings.outputContract)c.promptSettings.outputContract.templateMessageId='';c.promptSettings.autoRollingEnabled=false;c.promptSettings.summaryEnabled=false;c.renderMode=session.renderMode;}
    if(include.memoryInject===true)c.memoryInject={injectCore:session.manualMemory.settings.injectCore,injectFacts:session.manualMemory.settings.injectFacts};
    return normalizeSettingTemplate({config:c}).config;
  }
  function templateMissing(state,c){const missing=[];
    const refs=[['presetIds','presets'],['worldbookIds','worldbooks'],['regexPackIds','regexPacks']];
    for(const [field,table] of refs)for(const id of c[field]||[])if(!state[table].some(x=>x.id===id))missing.push(field+':'+id);
    if(c.loadedUserMaskId&&!state.masks.some(x=>x.id===c.loadedUserMaskId&&x.type==='user'))missing.push('userMask:'+c.loadedUserMaskId);
    if(c.customCssId&&!state.cssPresets.some(x=>x.id===c.customCssId))missing.push('css:'+c.customCssId);
    return missing;
  }
  function appliedSessionSettings(body,template,stored){
    const c=template.config||{},missing=templateMissing(stored,c);
    if(missing.length)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING_RESOURCES','剧情模板所需的预设/世界书/面具/CSS 已缺失，未创建半成品会话',{details:JSON.stringify({missing})});
    const next={...body};
    for(const key of templateFields){if(key==='memoryInject'||!Object.prototype.hasOwnProperty.call(c,key))continue;next[key]=clone(c[key]);}
    if(c.memoryInject){const defaults=normalizeManualMemory();next.manualMemory={...defaults,settings:{...defaults.settings,...c.memoryInject}};}
    return next;
  }
  function normalizeState(raw = {}) {
    return {
      schemaVersion: 4, storeRevision: Math.max(0,Number(raw.storeRevision)||0),
      sessions: arr(raw.sessions).map(normalizeSession), masks: arr(raw.masks).map(normalizeMask),
      presets: arr(raw.presets).map(normalizePreset), worldbooks: arr(raw.worldbooks).map(normalizeWorldbook), cssPresets: arr(raw.cssPresets).map(normalizeCssPreset),
      regexPacks: arr(raw.regexPacks).map(normalizeRegexPack),settingTemplates:arr(raw.settingTemplates).map(normalizeSettingTemplate),
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
  async function editSettingTemplate(action,body={}){
    // Same serialized CAS queue as session saves, but each edit starts with a
    // fresh verified state. Never overwrite a concurrent tab's resource edits.
    const commit=async()=>{
      const stored=normalizeState(await window.MimaLocalStore.loadState());
      let result=null;
      if(action==='save'){
        const existing=stored.settingTemplates.find(x=>x.id===body.id);
        if(existing&&existing.revision!==Number(body.expectedRevision))throw new ApiError('E_SETTINGS_TEMPLATE_STALE','模板已在别处修改，请刷新再保存');
        if(body.id&&!existing)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','模板已不存在，不能复活旧记录');
        const cfg=body.fromSessionId?templateFromSession(stored.sessions.find(s=>s.id===body.fromSessionId)||(()=>{throw new ApiError('E_STORY_SESSION_MISSING','模板来源剧情不存在')})(),body.include||{}):body.config;
        const next=normalizeSettingTemplate({id:existing?.id,name:body.name||existing?.name,config:cfg,createdAt:existing?.createdAt,revision:(existing?.revision||0)+1});
        if(existing)stored.settingTemplates=stored.settingTemplates.map(x=>x.id===next.id?next:x);else stored.settingTemplates.push(next);
        result=next;
      }else if(action==='default'){
        if(body.id&&!stored.settingTemplates.some(x=>x.id===body.id))throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','指定模板已不存在');
        stored.settingTemplates.forEach(x=>{x.isDefault=x.id===body.id;x.revision++;x.updatedAt=nowIso();});
        result=stored.settingTemplates;
      }else if(action==='delete'){
        const existing=stored.settingTemplates.find(x=>x.id===body.id);
        if(!existing)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','指定模板已不存在');
        if(existing.revision!==Number(body.expectedRevision))throw new ApiError('E_SETTINGS_TEMPLATE_STALE','模板版本已经变化');
        stored.settingTemplates=stored.settingTemplates.filter(x=>x.id!==body.id);result={deleted:true};
      }else throw new ApiError('E_SETTINGS_TEMPLATE_ACTION','无效模板操作');
      const committed=await window.MimaLocalStore.saveState(stored,stored.storeRevision);
      state=normalizeState(committed);return result;
    };
    const task=sessionSaveTail.then(commit,commit);sessionSaveTail=task.then(()=>{},()=>{});return task;
  }
  async function createSessionUsingTemplate(body){
    const commit=async()=>{
      const stored=normalizeState(await window.MimaLocalStore.loadState());
      const id=String(body.settingTemplateId||'');
      const tpl=id==='default'?stored.settingTemplates.find(x=>x.isDefault):stored.settingTemplates.find(x=>x.id===id);
      if(!tpl)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','设置模板已删除，未创建剧情');
      const input=appliedSessionSettings(body,tpl,stored);
      const result=normalizeSession({...input,id:makeId('sess'),createdAt:nowIso(),updatedAt:nowIso(),messages:[]});
      result.recordRevision=1;stored.sessions.push(result);
      const committed=await window.MimaLocalStore.saveState(stored,stored.storeRevision);
      state=normalizeState(committed);return result;
    };
    const task=sessionSaveTail.then(commit,commit);sessionSaveTail=task.then(()=>{},()=>{});return task;
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
  function historyHtmlProjection(textInput,session){
    const content=String(textInput??'');
    if(session?.promptSettings?.historyHtmlMode==='raw')return {text:content,changed:false,beforeChars:content.length,afterChars:content.length,reason:'disabled'};
    const engine=window.MimaHistoryHtmlProjection;
    // No weak regular-expression replacement when the parser module is missing.
    if(!engine?.project)throw new ApiError('E_HISTORY_HTML_PROJECTION_UNAVAILABLE','历史 HTML 投影模块未加载；已中止新请求，不会损坏剧情。',{hint:'请检查 history-html-projection.js 是否与当前版本一并部署，以及浏览器是否使用了旧缓存。'});
    return engine.project(content);
  }
  function messagePromptContent(m,session,stats=null){
    const original=applyRegexForSession(session,m?.content||'', 'prompt');
    const projection=historyHtmlProjection(original,session);
    if(stats)stats.set(m.id,projection);
    return projection.text;
  }
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
  // The owner chooses reference material for memory generation independently
  // of ordinary story prompt mounting and forward memory-injection toggles.
  function memoryReferenceSnapshot(session){
    const settings=normalizeManualMemory(session.manualMemory).settings.summaryContext;
    const records=[];
    const add=(kind,id,content,authority)=>{if(String(content||'').trim())records.push({kind,id,content:String(content),authority});};
    if(settings.userPersona){const mask=enabledMask(session.loadedUserMaskId);if(!mask)throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选玩家 Persona 未挂载或被关闭');add('user_persona',mask.id,formatMask(mask,'user'),'background_only');}
    if(settings.characterPersona){const mask=enabledMask(session.loadedCharMaskId);if(!mask)throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选角色 Persona 未挂载或被关闭');add('character_persona',mask.id,formatMask(mask,'character'),'background_only');}
    const mounted=new Set(arr(session.presetIds));
    for(const id of settings.presetIds){const preset=getPreset(id);if(!mounted.has(id)||!preset||preset.enabled===false)throw new ApiError('E_MEMORY_REFERENCE_MISSING','选择用于记忆的预设已卸载或停用：'+id);add('preset',id,resolveMacrosForSession(session,preset.content),'generation_instruction');}
    if(settings.worldbookMode!=='none'){
      const activated=settings.worldbookMode==='matched_entries'?
        new Set((window.MimaWorldbookRefs?.resolveMatchedWorldbookRefs?.({
          bookIds:settings.worldbookIds,
          books:settings.worldbookIds.map(id=>getWorldbook(id)).filter(Boolean),
          messages:session.messages
        })||[]).map(ref=>JSON.stringify(ref))):null;
      if(settings.worldbookMode==='matched_entries'&&!window.MimaWorldbookRefs?.resolveMatchedWorldbookRefs)
        throw new ApiError('E_MEMORY_REFERENCE_RESOLVER_MISSING','记忆匹配规则未加载');
      const mountedBooks=new Set(arr(session.worldbookIds));
      const eligibleBooks=settings.worldbookIds.map(id=>getWorldbook(id)).filter(Boolean);
      // Contract and actual prompt MUST agree on one exact composite ID set.
      const resolver=window.MimaWorldbookRefs?.resolveSelectedWorldbookRefs;
      if(!resolver)throw new ApiError('E_MEMORY_REFERENCE_RESOLVER_MISSING','记忆世界书来源解析器尚未加载');
      let selectedRefs=[];
      if(settings.worldbookMode==='selected_entries'){
        try{selectedRefs=resolver({bookIds:settings.worldbookIds,books:eligibleBooks,scopedRefs:settings.worldbookEntryRefs,legacyIds:settings.worldbookEntryIds});}
        catch(e){throw new ApiError(String(e.message).startsWith('E_MEMORY_REFERENCE_AMBIGUOUS')?'E_MEMORY_REFERENCE_AMBIGUOUS':'E_MEMORY_REFERENCE_MISSING','世界书来源不能唯一验证：'+e.message);}
      }
      const scoped=new Set(selectedRefs.map(ref=>JSON.stringify(ref)));
      for(const id of settings.worldbookIds){const book=getWorldbook(id);if(!mountedBooks.has(id)||!book||book.enabled===false)throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选世界书已卸载或停用：'+id);
        for(const entry of arr(book.entries)){
          if(settings.worldbookMode==='selected_entries'&&!scoped.has(JSON.stringify([book.id,entry.id])))continue;
          if(activated&&!activated.has(JSON.stringify([book.id,entry.id])))continue;
          if(entry.enabled===false){if(settings.worldbookMode==='selected_entries')throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选世界书条目已停用：'+entry.id);continue;}
          add('worldbook',book.id+'/'+entry.id,resolveMacrosForSession(session,entry.content),'background_only');
        }
      }
      if(settings.worldbookMode==='selected_entries')for(const ref of scoped){
        const [bookId,entryId]=JSON.parse(ref);
        if(!records.some(x=>x.kind==='worldbook'&&x.id===bookId+'/'+entryId))throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选世界书条目不存在、已卸载或停用：'+bookId+'/'+entryId);
      }
    }
    return records;
  }
  function referencePromptMessages(records){
    return records.map(x=>({role:'system',content:`【记忆生成参考 / ${x.kind} / ${x.id}】【${x.authority==='generation_instruction'?'用户选择的总结指令':'仅供人物背景消歧，不得记作已发生剧情'}】\n${x.content}`}));
  }
  // Stable serialization keeps stage digests independent of incidental object
  // insertion order while retaining the exact string bytes of model prompts.
  function canonicalSerialize(value){
    return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
      ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  }
  async function exactDigest(value){
    const bytes=new TextEncoder().encode(typeof value==='string'?value:canonicalSerialize(value));
    try {
      if(globalThis.crypto?.subtle?.digest){
        const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
        return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      }
      if(globalThis.MimaSHA256?.digest)return globalThis.MimaSHA256.digest(bytes);
    }catch(error){throw new ApiError('E_MEMORY_DIGEST_UNAVAILABLE','SHA-256 校验过程失败，记忆任务已中止：'+(error?.message||'unknown'));}
    throw new ApiError('E_MEMORY_DIGEST_UNAVAILABLE','当前环境缺少可验证的 SHA-256；记忆数据未修改。');
  }
  // R4.5 used insertion-order JSON serialization and a job-wide source
  // identity. Calculate that historical signature separately: never weaken
  // the current v2 stable-contract signature to make migration look green.
  async function legacyStageDigest(value){
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    try{
      if(globalThis.crypto?.subtle?.digest){
        const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
        return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      }
      if(globalThis.MimaSHA256?.digest)return globalThis.MimaSHA256.digest(bytes);
    }catch(error){throw new ApiError('E_MEMORY_LEGACY_DIGEST_FAILED','旧分片 SHA-256 复核失败：'+(error?.message||'unknown'));}
    throw new ApiError('E_MEMORY_DIGEST_UNAVAILABLE','没有可用的 SHA-256 进行旧分片复核。');
  }
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
    // Canonical, forward-moving chat must inject the memories that the owner
    // saved and enabled. Source fingerprints are diagnostics for revision drift,
    // NOT an authority to silently erase the owner's memory from the request.
    // A historical regeneration is different: its prefix must not read memory
    // derived from turns which have not happened in that replayed timeline.
    const replay=session.promptLineageProjection===true;
    const memory=normalizeManualMemory(session.manualMemory||{}),memoryTrace=[];
    const rollingText=session.rollingSummary||session.summary||session.longSummary;
    const rollingSourceCurrent=!session.rollingSourceFingerprint
      ?!(session.legacyMemoryQuarantined||replay)
      :session.rollingSourceCount>0&&session.messages.length>=session.rollingSourceCount&&memorySourceFingerprint(session.messages,session.rollingSourceCount)===session.rollingSourceFingerprint;
    const rollingIncluded=options.excludeRollingSummary!==true&&session.promptSettings?.injectSavedRolling!==false&&!!rollingText&&(!replay||rollingSourceCurrent);
    memoryTrace.push({kind:'rolling',chars:rollingText.length,injected:rollingIncluded,sourceCurrent:rollingSourceCurrent,
      reason:options.excludeRollingSummary===true?'explicit_exclusion':session.promptSettings?.injectSavedRolling===false?'disabled':!rollingText?'empty':replay&&!rollingSourceCurrent?'historical_replay_boundary':rollingSourceCurrent?'included':'source_changed_included'});
    if(rollingIncluded)add('story_summary',`【剧情摘要 / Rolling Summary】\n${rollingText}`);
    const coreSourceCurrent=memorySourceValid(session,memory.core);
    const coreIncluded=!!(memory.settings.injectCore&&memory.core.content&&(!replay||coreSourceCurrent));
    memoryTrace.push({kind:'core',verification:memory.core.verification.status,sourceCount:memory.core.sourceCount,
      source:memory.core.source,sourceCurrent:coreSourceCurrent,chars:memory.core.content.length,injected:coreIncluded,
      reason:!memory.settings.injectCore?'disabled':!memory.core.content?'empty':replay&&!coreSourceCurrent?'historical_replay_boundary':coreSourceCurrent?'included':'source_changed_included'});
    if(coreIncluded){
      const label=memory.core.verification.status==='human_confirmed'?'玩家手工编辑':'AI总结（可编辑）';
      add('manual_core_memory',`【核心记忆 / Core Memory】【来源：${label}】\n${memory.core.content}`);
    }
    if(memory.facts.length){
      const eligible=memory.facts.filter(f=>!replay||memorySourceValid(session,f))
        .sort((a,b)=>Number(a.endRound||0)-Number(b.endRound||0)||String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
      const selected=memory.settings.injectFacts?(memory.settings.factInjectionLimit===0?eligible:eligible.slice(-memory.settings.factInjectionLimit)):[];
      const selectedIds=new Set(selected.map(f=>f.id));
      memoryTrace.push(...memory.facts.map(f=>{
        const current=memorySourceValid(session,f),injected=selectedIds.has(f.id);
        return {kind:'fact',verification:f.verification.status,id:f.id,sourceCount:f.sourceCount,startRound:f.startRound,
          endRound:f.endRound,sourceCurrent:current,chars:f.content.length,injected,
          reason:!memory.settings.injectFacts?'disabled':replay&&!current?'historical_replay_boundary':!injected?'injection_limit':current?'included':'source_changed_included'};
      }));
      if(selected.length)add('manual_fact_memories',`【事实记忆 / Fact Memories】\n${selected.map(x=>{
        const label=x.verification.status==='human_confirmed'?'玩家手工编辑':'AI总结（可编辑）';
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
    const htmlContract=session.promptSettings?.outputContract;
    if(htmlContract?.requireHtml){
      // Stable opt-in structural contract is independent from the last assistant
      // message and never substitutes a historical example.
      const standard=arr(session.messages).find(x=>x.id===htmlContract.templateMessageId&&x.role==='assistant');
      // A historical reference is layout evidence, NOT current character
      // state. Never elevate its old status attributes, CSS or prose into a
      // fresh system instruction merely because the player selected it.
      let sourceSafeShell='';
      if(standard?.content&&htmlContract.bodySelector){
        try{
          const draft=window.MimaHtmlStructure?.propose('【本轮正文槽：仅使用本轮新内容】',standard.content,htmlContract);
          if(draft?.proposedContent)sourceSafeShell='\n【已移除旧动态值的参考结构；所有待确认字段都不是本轮事实】\n'+draft.proposedContent;
        }catch(e){sourceSafeShell='\n【标准参考消息的动态来源无法验证，仅使用上述显式结构选择器；原参考消息仍安全保存在历史存档。】';}
      }
      add('html_structure_contract',`【本轮 HTML 结构合同：须按 HTML 形式回复；不得只输出纯文本。必需结构选择器：${htmlContract.requiredSelectors||'(只要求 HTML)'}。正文槽：${htmlContract.bodySelector||'(未标注)'}。状态槽：${htmlContract.statusSelector||'(未标注)'}。所有旧状态是历史快照，不得当成当前事实；无法确认的本轮状态请标明待确认。】${sourceSafeShell}`);
    }
    if(options.directorNote||session.directorNote)add('director_note',options.directorNote||session.directorNote);
    return {prompt:chunks.join('\n\n'),sections,memoryTrace};
  }
  function toHistoryMessage(m,session,stats=null){
    if(!m?.content)return null;
    // Preserve legacy evidence in canonical/version storage, but never replay
    // a positively identified provider refusal as character dialogue.
    // Never silently erase previously committed canonical dialogue based on a
    // context-free text regex. Only independently verified provider terminal
    // metadata may quarantine an old turn; explicit manual recovery wins.
    const evidence=m.metadata||{};
    if(m.role==='assistant'&&!isManuallyRecoveredReply(m)&&
      (evidence.providerRefused===true||evidence.providerFinishKind==='blocked'||
       ['content_filter','safety','blocked','prohibited_content','refusal'].includes(evidence.providerFinishReason)))return null;
    const content=m.role==='user'?userMessagePromptContent(m,session):messagePromptContent(m,session,stats);
    if(m.role==='assistant'&&!content.trim())return null;
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
  function retrieveRawGap(session,history,coreCount,anchor,available,projectMessage=m=>toHistoryMessage(m,session)){
    const older=history.slice(0,Math.max(0,history.length-coreCount));
    if(!older.length||available<=0)return {chosen:[],omitted:older,usedTokens:0,terms:[]};
    const terms=retrievalTerms(anchor),generic=!terms.length,atoms=[];
    // Whole player/assistant turns are the minimum retrieval unit; do not
    // manufacture an isolated assistant answer without its triggering turn.
    for(let i=0;i<older.length;){
      const pair=older[i]?.role==='user'&&older[i+1]?.role==='assistant';
      const group=older.slice(i,i+(pair?2:1));i+=group.length;
      const rows=group.map(m=>({m,projected:projectMessage(m)}));
      const content=rows.map(row=>String(row.projected?.content||'')).join('\n');
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
    let sys=buildSystemPrompt(session,options,matched);
    // Per-assembly only: no stale cache when regex, original History or
    // settings change. All cost estimates and retrieval reuse this projection.
    const htmlProjectionStats=new Map(),projectedHistory=new Map();
    // Only the last actually admissible completed character reply is an HTML
    // exemplar. The current visible timeline usually ends in a user message.
    // No inference from HTML-looking text: a newer plain reply supersedes it.
    const eligibleAssistant=m=>m?.role==='assistant'&&!!String(m.content||'').trim()&&
      m.metadata?.source!=='prompt_preview_draft'&&
      (isManuallyRecoveredReply(m)||!(m.metadata?.providerRefused===true||
        m.metadata?.providerFinishKind==='blocked'||
        ['content_filter','safety','blocked','prohibited_content','refusal'].includes(m.metadata?.providerFinishReason)));
    const latestAssistant=[...visibleHistory].reverse().find(eligibleAssistant);
    const lastEligibleAssistantId=latestAssistant?.id||null;
    const latestAssistantHtml={enabled:!!lastEligibleAssistantId&&session.promptSettings?.historyHtmlMode!=='raw',
      selectedMessageId:lastEligibleAssistantId,retainedChars:0,estimatedTokenCost:0,
      reason:lastEligibleAssistantId?'latest_committed_assistant':'no_eligible_assistant'};
    const projectMessage=m=>{
      if(projectedHistory.has(m))return projectedHistory.get(m);
      // A prefix-continuation protocol treats the last assistant message as
      // literal bytes to extend. Projecting that prefix would make the model
      // extend different text than the user's saved reply, breaking append.
      const preservePrefix=options.preserveTerminalAssistant===true&&m===visibleHistory[visibleHistory.length-1]&&m.role==='assistant';
      const preserveLatest=!!lastEligibleAssistantId&&m.id===lastEligibleAssistantId&&m.role==='assistant';
      const projected=(preservePrefix||preserveLatest)?toHistoryMessage(m,{...session,promptSettings:{...session.promptSettings,historyHtmlMode:'raw'}},htmlProjectionStats):toHistoryMessage(m,session,htmlProjectionStats);
      if(preserveLatest&&projected){latestAssistantHtml.retainedChars=projected.content.length;latestAssistantHtml.estimatedTokenCost=estimateTokens(projected.content);}
      projectedHistory.set(m,projected);
      return projected;
    };
    let recentRaw=visibleHistory.slice(),projectedAway=[],estimatedBase=null;
    const trimBatchRounds=session.promptSettings.contextTrimBatchRounds;
    const minRecentRounds=session.promptSettings.contextMinRecentRounds;
    const trimBatches=[];
    // A turn is one player message and all following assistant responses up to
    // the next player message. An initial assistant greeting or an exceptional
    // unmatched message is its own indivisible unit. No turn is split or
    // rewritten. The last twenty units are protected by default.
    const groupedTurns=[];
    for(const m of visibleHistory){
      const previous=groupedTurns[groupedTurns.length-1];
      if(m.role==='user'||!previous||previous[0].role!=='user')groupedTurns.push([m]);
      else previous.push(m);
    }
    let projectedGroups=groupedTurns.slice(),removedGroups=0;
    // Reserve a margin for JSON encoding, message roles and protocol overhead.
    const baseTokens=(raw,system)=>{
      const current=raw.map(projectMessage).filter(Boolean);
      const inserted=applyDepth(current,depthOnly,session);
      return system.sections.reduce((n,row)=>n+estimateTokens(row.content)+8,0)+inserted.messages.reduce((n,m)=>n+estimateTokens(m.content)+8,0)+Math.max(160,Math.ceil(system.prompt.length*.08));
    };
    // A rolling summary is only allowed to stand in for a canonical PREFIX
    // whose source fingerprint and cursor are still current. A core/fact
    // memory, a legacy summary without source proof, or a summary disabled
    // for injection CANNOT satisfy this guarantee. This proves SOURCE RANGE,
    // not semantic fidelity: model summaries still require owner review.
    const summaryInjected=!!sys.memoryTrace.find(x=>x.kind==='rolling'&&x.injected);
    const rollingCount=Math.floor(Number(session.rollingSourceCount)||0);
    const summaryCursor=Math.floor(Number(session.lastSummarizedIndex)||0);
    const rollingProof=Boolean(summaryInjected&&session.rollingSourceFingerprint&&rollingCount>0&&
      summaryCursor>=rollingCount&&session.messages.length>=rollingCount&&
      memorySourceFingerprint(session.messages,rollingCount)===session.rollingSourceFingerprint);
    const canonicalIndex=new Map(session.messages.map((m,i)=>[m.id,i]));
    function trimOldestBatch(){
      if(projectedGroups.length<=minRecentRounds)return false;
      // Never silently change the owner's chosen batch size to a smaller
      // unit. A partial batch would make trace/coverage expectation unclear.
      if(projectedGroups.length-minRecentRounds<trimBatchRounds)return false;
      const take=trimBatchRounds;
      const groups=projectedGroups.slice(0,take);
      const removed=groups.flat();
      if(removed.some(m=>m.id===lastEligibleAssistantId))return false;
      const indexes=removed.map(m=>canonicalIndex.get(m.id));
      if(indexes.some(i=>!Number.isSafeInteger(i))){
        throw new ApiError('E_CONTEXT_SOURCE_IDENTITY','裁剪来源无法对应完整的本地剧情记录，未发送模型请求。');
      }
      const sourceEndExclusive=Math.max(...indexes)+1;
      if(!rollingProof||summaryCursor<sourceEndExclusive||rollingCount<sourceEndExclusive){
        throw new ApiError('E_CONTEXT_MEMORY_COVERAGE','最早剧情尚无可验证来源范围的滚动摘要；已暂停本轮模型请求，不会丢弃旧剧情。',{
          details:JSON.stringify({sourceStartIndex:indexes[0],requiredSourceEndExclusive:sourceEndExclusive,
            summaryCursor,rollingSourceCount:rollingCount,rollingFingerprintCurrent:rollingProof,
            summaryInjected,requiredBatchRounds:take,protectedRecentRounds:minRecentRounds,
            omittedMessages:removed.length}),
          hint:'请到「设置 → 长剧情与记忆」先手动查看滚动记忆的完整请求计划，确认费用并整理到上述来源游标，再重试；本地 History 未删除，也不会自动发起总结收费。'});
      }
      const before=estimatedBase;
      projectedAway.push(...removed);
      projectedGroups=projectedGroups.slice(take);
      recentRaw=projectedGroups.flat();
      removedGroups+=take;
      estimatedBase=baseTokens(recentRaw,sys);
      trimBatches.push({rounds:take,sourceEndExclusive,messageIds:removed.map(m=>m.id),estimatedBeforeTokens:before,estimatedAfterTokens:estimatedBase});
      return true;
    }
    estimatedBase=baseTokens(recentRaw,sys);
    if(!promptCap.verified){
      // Unknown context is NOT a licence to send a potentially million-token
      // prompt. Keep normal smaller legacy sessions working, but block large
      // unverified payloads before transport. Never invent a model capacity.
      if(estimatedBase>promptCap.provisionalRetrievalTokens){
        throw new ApiError('E_CONTEXT_WINDOW_REQUIRED','当前完整剧情预计超过安全检查阈值，但尚未配置模型实际上下文窗口；未发起请求。',{
          details:JSON.stringify({estimatedInputTokens:estimatedBase,configuredWindow:null,
            legacyScreeningThreshold:promptCap.provisionalRetrievalTokens,fullHistoryCount:visibleHistory.length}),
          hint:'请在 API 设置中填写服务商确认支持的模型上下文窗口 Tokens；咪嘛馆不会凭模型名称猜 100 万窗口，也不会默默删减剧情。'});
      }
    }else{
      while(estimatedBase>promptCap.usable){
        if(!trimOldestBatch()){
          throw new ApiError('E_CONTEXT_RECENT_MINIMUM','保留最新完整剧情和固定资料后仍超出本轮模型预算；已暂停且未删除任何 History。',{
            details:JSON.stringify({estimatedInputTokens:estimatedBase,usableTokens:promptCap.usable,
              windowTokens:promptCap.windowTokens,protectedRecentRounds:minRecentRounds,
              totalRounds:groupedTurns.length,alreadyPlannedTrimRounds:removedGroups}),
            hint:'请核实上下文窗口、输出预留或精简自己挂载的固定资料；至少保留的最新 20 轮不能自动裁掉。'});
        }
      }
    }
    const canonicalHistoryCount=visibleHistory.filter(m=>m.metadata?.source!=='prompt_preview_draft').length;
    const recent=recentRaw.map(projectMessage).filter(Boolean);
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
    const candidateHistory=projectedAway.length?[]:uncoveredOlder;
    const retrieved=retrieveRawGap(session,candidateHistory,0,anchor,retrievalBudget,projectMessage);
    const trace={pendingRawCount:pendingRaw.length,uncoveredRawCount:uncoveredOlder.length,retrievedCount:retrieved.chosen.length,
      fullHistoryPreferred:true,allHistoryIncluded:uncoveredOlder.length===0,temporarilyOmittedTurnIds:projectedAway.map(m=>m.id),canonicalHistoryCount,
      omittedCount:retrieved.omitted.length,retrievedIds:retrieved.chosen.map(x=>x.m.id),omittedIds:retrieved.omitted.slice(0,60).map(x=>x.id),
      sourceFingerprint:memorySourceFingerprint(session.messages.filter(m=>m.metadata?.source!=='prompt_preview_draft'),session.messages.filter(m=>m.metadata?.source!=='prompt_preview_draft').length),sourceCount:session.messages.filter(m=>m.metadata?.source!=='prompt_preview_draft').length,
      sourceWindow:promptCap.windowTokens,budgetVerified:promptCap.verified,budgetPolicy:promptCap.verified?'configured_hard_limit':'unverified_provider_authoritative',baselineEstimateTokens:baselineTokens,retrievalEstimateTokens:retrieved.usedTokens,
      coverageComplete:projectedAway.length?rollingProof&&summaryCursor>=Math.max(...projectedAway.map(m=>canonicalIndex.get(m.id)+1)):!retrieved.omitted.length,
      memoryCoverageProof:rollingProof,protectedRecentRounds:minRecentRounds,trimBatchRounds,
      plannedTrimRounds:removedGroups,trimBatches,rollingSummaryCursor:summaryCursor,
      summarySourceValid:summaryValid,summarySourceCount:session.rollingSourceCount,
      retrievalMode:retrieved.terms.length?'lexical_events':'continuation_event_index',unverifiedPastCount:retrieved.omitted.length};
    const recall=tracked=>tracked.map(x=>x.projected).filter(Boolean);
    const olderMessages=recall(retrieved.chosen);
    // Content comes from mounted resources and verified memory only. Source metadata stays outside the API.
    const sections=sys.sections.map(x=>({role:'system',content:x.content,source:x.source}));
    const depthApplied=applyDepth([...olderMessages,...recent],depthOnly,session);
    const ordered=[...sections,...depthApplied.messages];
    const messages=ordered.map(({role,content})=>({role,content}));
    const messageSources=ordered.map(x=>x.source||{kind:'canonical_history'});
    const sentAssistantIds=new Set(messageSources.filter(x=>x.kind==='canonical_history'&&x.originalRole==='assistant').map(x=>x.messageId));
    const sentProjection=[...sentAssistantIds].map(id=>htmlProjectionStats.get(id)).filter(Boolean);
    const historyHtmlProjection={mode:session.promptSettings.historyHtmlMode,processedMessages:sentProjection.length,
      changedMessages:sentProjection.filter(x=>x.changed).length,
      beforeChars:sentProjection.reduce((n,x)=>n+x.beforeChars,0),afterChars:sentProjection.reduce((n,x)=>n+x.afterChars,0),
      estimate:'按字符长度 / 2.5 粗估，实际 Tokens 由模型分词器决定'};
    historyHtmlProjection.savedChars=historyHtmlProjection.beforeChars-historyHtmlProjection.afterChars;
    historyHtmlProjection.estimatedTokensSaved=Math.round(historyHtmlProjection.savedChars/2.5);
    for(const row of presetTrace){const index=messageSources.findIndex(x=>x.kind==='preset'&&x.sourceId===row.id);row.sendIndex=index<0?null:index+1;row.injected=index>=0;}
    presetTrace.sort((a,b)=>(a.sendIndex??Number.MAX_SAFE_INTEGER)-(b.sendIndex??Number.MAX_SAFE_INTEGER));
    const header=sections.map(x=>x.content).join('\n\n');
    const estimatedInputTokens=messages.reduce((sum,m)=>sum+estimateTokens(m?.content||'')+8,0)+Math.max(160,Math.ceil(header.length*.08));
    if(promptCap.verified&&estimatedInputTokens>promptCap.usable)throw new ApiError('E_CONTEXT_BUDGET','上下文检索结果超过已配置的模型预算，已中止发送但保留全部资料。',{details:JSON.stringify({estimatedInputTokens,promptCap,trace})});
    return{messages,messageSources,inspector:{historyHtmlProjection,latestAssistantHtml:{...latestAssistantHtml,
      actuallySent:messageSources.some(x=>x.kind==='canonical_history'&&x.messageId===lastEligibleAssistantId)},systemChars:header.length,estimatedInputTokens,recentMessageCount:recent.length,unsummarizedGapCount:uncoveredOlder.length,recentMessageLimit:limit,fullHistoryPreferred:true,canonicalHistoryCount,temporarilyOmittedCount:projectedAway.length,allHistoryIncluded:uncoveredOlder.length===0,finalMessageCount:messages.length,
      contextTrace:trace,worldbookBudgetChars:budget,worldbookUsedChars:budgeted.used,upstreamUsage:lastUsage?clone(lastUsage):null,
      sections:sys.sections.map(({name,chars,source})=>({name,chars,transportRole:'system',source})),memoryTrace:sys.memoryTrace,
      presetConflictPolicy:{kind:'deterministic_order_only',semanticConflictsResolved:false,notice:'优先级只确定排列顺序；自由文本规则之间的语义冲突没有自动裁决。'},
      maskTrace,presetTrace,worldbookMountTrace,userMaterialPreview:'',
      // Legacy systemPreview remains for existing clients, but must not be labeled
      // as actual system-role content in the GUI.
      actualSystemRole:'system',userMaterialRole:null,messageSources,
      rollingTrace:{sourceCount:session.rollingSourceCount||0,valid:summaryValid,injected:sys.memoryTrace.some(x=>x.kind==='rolling'&&x.injected),coverage:trace},
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
    if(status===400&&/(?:prompt_rejected|prompt[_ -]?blocked|prohibited[_ -]?content|blocked by upstream content policy|content[_ -]?filter|prohibited.use.policy)/i.test(m))return '接口明确报告内容政策拦截。本轮请求已被服务端拒绝，原始请求与剧情已保留，不会自动重复计费。';
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
      // Gemini-style nested content can be carried inside an OpenAI-compatible
      // message.content. Its thought parts must not become visible story text.
      if(v.thought===true||v.type==='reasoning'||v.type==='thinking')return '';
      if(typeof v.text==='string')return v.text;
      if(typeof v.content==='string')return v.content;
      if(typeof v.output_text==='string')return v.output_text;
      if(Array.isArray(v.content))return v.content.map(contentPiece).join('');
      if(Array.isArray(v.parts))return v.parts.map(contentPiece).join('');
      if(v.content&&typeof v.content==='object')return contentPiece(v.content);
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
    let buffer='',reply='',eventCount=0,finalPayload=null,streamUsage=null,receivedDone=false,finishReason='',finishKind='unknown',badEvents=0,refusalSeen=false,terminalConflict=false,firstByteMarked=false;
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
      while(true){const {done,value}=await reader.read();if(done)break;if(!firstByteMarked){firstByteMarked=true;onProgress?.onTiming?.('first_byte',{chunkBytes:value?.byteLength||0});}buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)consumeLine(line)}
      buffer+=decoder.decode();if(buffer.trim())for(const line of buffer.split(/\r?\n/))consumeLine(line);
    }catch(e){
      publishMeta();
      if(reply&&e&&typeof e==='object')e.partialDraft=reply.slice(0,24000);
      if(e?.name==='AbortError'||e instanceof ApiError)throw e;
      if(reply)throw Object.assign(new ApiError('E_STREAM_INTERRUPTED',`流式连接在接收 ${reply.length} 字符后异常终止。未将部分文本当成角色回复。`,{status:res.status,details:`stage: stream_read; events: ${eventCount}; cause: ${e?.name||'unknown'}: ${e?.message||String(e)}`}),{partialDraft:reply.slice(0,24000)});
      throw asApiError(e,'E_API_NETWORK_CORS');
    }
    onProgress?.onTiming?.('last_delta',{receivedChars:reply.length,events:eventCount,receivedDone});
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
  function generationSnapshot(session,promptSession,body,messageSources=[],operation='send',excludeReferenceId=null,sourceFingerprint=null,contextTrace=null){
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
    const trimAudit=contextTrace?.plannedTrimRounds?{
      policyVersion:1,trimBatchRounds:contextTrace.trimBatchRounds,
      protectedRecentRounds:contextTrace.protectedRecentRounds,
      trimmedRounds:contextTrace.plannedTrimRounds,
      batches:contextTrace.trimBatches.map(b=>({rounds:b.rounds,sourceEndExclusive:b.sourceEndExclusive,messageIds:b.messageIds.slice()})),
      rollingSummaryCursor:contextTrace.rollingSummaryCursor,memoryCoverageProof:contextTrace.memoryCoverageProof,
      configuredWindowTokens:contextTrace.sourceWindow,
      // Canonical source identity lives next to this trace, never raw text.
      sourceFingerprint:sourceFingerprint??memorySourceFingerprint(promptSession.messages,promptSession.messages.length)
    }:null;
    return {version:1,operation,requestBody:safe,messageSources:clone(messageSources),sourceCount:promptSession.messages.length,
      sourceFingerprint:sourceFingerprint??memorySourceFingerprint(promptSession.messages,promptSession.messages.length),
      ...(trimAudit?{contextTrimAudit:trimAudit}:{})};
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
    // Record an immutable payload fingerprint and the exact message-role/size
    // shape at the network boundary. NEVER store raw story text or credentials.
    // Repeating a failed stage can now prove whether the same body was sent.
    const payloadShape=Array.isArray(body.messages)?body.messages.map(m=>({role:String(m.role||''),chars:typeof m.content==='string'?m.content.length:null})):[];
    const perfClock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const transportClock=perfClock();
    const requestId=makeId('req'),diag={requestId,jobId:options.memoryContext?.jobId||null,attemptId:options.memoryContext?.attemptId||null,stage:options.memoryContext?.stage||'story',model:body.model,endpointOrigin:(()=>{try{return new URL(chat).origin}catch{return 'unknown'}})(),requestFields:Object.keys(body).sort(),messageCount:body.messages.length,messageShape:payloadShape,requestFingerprint:fingerprint(requestJson),temperaturePresent:Object.hasOwn(body,'temperature'),maxTokens:body.max_tokens||null,stream:streamEnabled,requestBytes,serializationElapsedMs:Date.now()-serializationStartedAt,
      generationId:options.storyContext?.generationId||null,generationAttempt:options.storyContext?.generationAttempt||null,preparationElapsedMs:options.storyContext?.preparationElapsedMs??null};
    const diagnostic=extra=>JSON.stringify({...diag,...extra});
    // Once HTTP response headers exist, a provider refusal, terminal filter or
    // malformed body MUST retain that observed status and the actual failure
    // provenance. These failures are not fetch-before-response network errors.
    // Keep the original terminal evidence in a bounded diagnostic field;
    // never persist the full response, prompt, headers or credentials.
    let observedFinish={kind:'unknown',reason:'unknown'};
    const responseFailure=(error,errorSource,extra={})=>{
      const issue=asApiError(error,'E_API_UNRECOGNIZED_RESPONSE');
      if(issue instanceof ApiError){
        const previous=String(issue.details||'').slice(0,1200);
        let previousFinish={};try{previousFinish=JSON.parse(previous);}catch(_){/* Legacy text error; preserve as text only. */}
        if(!issue.status&&res)issue.status=res.status;
        if(issue.code==='E_API_REFUSAL')issue.hint=errorSource==='response_shape'
          ?'已收到模型/网关的 HTTP 响应，但其中含明确 refusal 拒绝字段；不是没有收到响应。旧剧情与记忆不会自动覆盖，是否产生计费请核对中转站对应 requestId。'
          :'已收到模型/网关的 HTTP 响应，终止状态表明内容被拦截；未把不完整的正文当作成功。是否产生计费需要核对请求记录。';
        issue.details=diagnostic({errorSource:issue.code==='E_API_REFUSAL'&&errorSource==='response_shape'?'provider_refusal':errorSource,
          errorStage:errorSource,httpStatus:res?.status||null,
          finishKind:observedFinish.kind!=='unknown'?observedFinish.kind:previousFinish.finishKind||'unknown',
          finishReason:observedFinish.reason!=='unknown'?observedFinish.reason:previousFinish.finishReason||'unknown',
          errorCode:issue.code,providerTerminalDetails:previous,...extra});
      }
      return issue;
    };
    const timing=(phase,extra={})=>{try{options.onDiagnostic?.({type:'timing',phase,requestId,elapsedFromTransportMs:Math.round((perfClock()-transportClock)*100)/100,...extra});}catch(e){console.error('分段时钟诊断失败，生成不受影响',e);}};
    timing('serialized',{requestBytes,serializationElapsedMs:diag.serializationElapsedMs});
    // Exact body.messages at the fetch boundary. Credentials, auth headers and
    // extraHeaders never enter the independent diagnostics database.
    try{options.onDiagnostic?.({type:'request',request:body,messageSources:options.messageSources||[],...diag});}
    catch(e){console.error('诊断事件回调失败；真实模型请求继续执行',e);}
    emitProgress(options.onProgress,{phase:'requesting',percent:42,detail:`正在请求 ${cfg.model}`});
    const fetchStartedAt=Date.now(),requestStartedAt=new Date(fetchStartedAt).toISOString();
    timing('fetch_start');
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
      let data={},responseKind='json',plainError='';
      // Some OpenAI-compatible gateways return text/plain, an error string,
      // or {error:{status,reason}} instead of {error:{message,code}}.
      // Preserve the provider's actual error classification, not a fake 400.
      try{
        const errorText=await res.text();
        try{data=JSON.parse(errorText);}catch(_){responseKind='text';plainError=errorText.slice(0,320);}
      }catch(_){responseKind='unreadable';}
      const err=data?.error&&typeof data.error==='object'?data.error:{};
      const field=value=>typeof value==='string'||typeof value==='number'?String(value).slice(0,200):null;
      const message=err.message||data?.message||(typeof data?.error==='string'?data.error:null)||(typeof data==='string'?data:null)||plainError||`API 请求失败 HTTP ${res.status}`;
      const messageRequestId=typeof message==='string'?message.match(/\(request id:\s*([A-Za-z0-9_.:-]{1,200})\)\s*$/i)?.[1]:null;
      const providerError={type:field(err.type),code:field(err.code||err.status||data?.code),reason:field(err.reason||err.status||data?.reason),param:field(err.param),requestId:safeId(err.request_id||data?.request_id||messageRequestId)};
      const problem=httpApiError(res.status,message);
      if(err.code==='model_not_found'&&/No available channel for model/i.test(String(message)))problem.hint='中转报告当前模型在该分组下没有可用渠道。请中转管理员按上游 request id 核查模型映射与渠道状态；连续重试同一路由无法修复渠道配置。';
      problem.details=diagnostic({errorSource:'http',...responseTiming,providerError,responseKind,responseBodyElapsedMs:Date.now()-responseBodyStartedAt,responseShape:data&&typeof data==='object'?Object.keys(data).slice(0,20):[]});throw problem;
    }
    timing('headers',{httpStatus:res.status});
    const contentType=String(res.headers?.get?.('content-type')||'').toLowerCase();
    if(streamEnabled&&!/application\/json/i.test(contentType)){
      emitProgress(options.onProgress,{phase:'streaming',percent:55,detail:'连接成功，正在接收流式正文…'});
      let firstVisibleMarked=false,lastChars=0;
      const streamProgress=ev=>{if(ev.streamText!==undefined){lastChars=ev.streamText.length;if(!firstVisibleMarked&&lastChars){firstVisibleMarked=true;timing('first_visible_delta',{receivedChars:lastChars});}}options.onProgress?.(ev.streamText===undefined?ev:{...ev,streamText:prefixResponseText(ev.streamText,body,cfg,true)});};
      streamProgress.resultMeta=options.resultMeta;streamProgress.onTiming=timing;try{
        const received=await readStreamingReply(res,streamProgress,cfg.model,options.allowIncompleteDraft===true);
        timing('stream_finish',{receivedChars:received.length});
        const streamed=text(prefixResponseText(received,body,cfg));
        if(!streamed)throw new ApiError('E_API_EMPTY_REPLY','前缀续写没有返回新的正文，原回复未改动。');
        try{options.onDiagnostic?.({type:'provider_result',finishKind:options.resultMeta?.finishKind||'unknown',finishReason:options.resultMeta?.finishReason||'unknown',responseChars:streamed.length});}catch(e){console.error('诊断事件回调失败',e);}
        return streamed;
      }catch(e){
        if(options.resultMeta?.finishReason)try{options.onDiagnostic?.({type:'provider_result',finishKind:options.resultMeta.finishKind,finishReason:options.resultMeta.finishReason,responseChars:e?.partialDraft?.length||0});}catch(diagErr){console.error('诊断事件回调失败',diagErr);}
        throw responseFailure(e,'stream',{streamDetails:String(e?.details||'').slice(0,500)});}
    }
    emitProgress(options.onProgress,{phase:'receiving',percent:68,detail:'模型已响应，正在解析正文…'});
    timing('json_receive_start');
    let data;try{data=await parseJsonResponse(res,'API');}
    catch(e){throw responseFailure(e,'response_body_parse');}
    timing('json_receive_done');
    captureUsageMetrics(data,cfg.model,options.onProgress);
    const ending=finishState(data);
    observedFinish=ending;
    if(options.resultMeta){options.resultMeta.finishReason=ending.reason;options.resultMeta.finishKind=ending.kind;options.resultMeta.refused=!!data?.choices?.[0]?.message?.refusal;options.resultMeta.requestId=requestId;}
    try{options.onDiagnostic?.({type:'provider_result',finishKind:ending.kind,finishReason:ending.reason,responseChars:0});}catch(e){console.error('诊断事件回调失败',e);}
    if(ending.kind==='blocked'||ending.kind==='abnormal'){
      const evidence=contentPiece(data?.choices?.[0]?.message?.content??data?.choices?.[0]?.text??'');
      try{assertFinishState({finishKind:ending.kind,finishReason:ending.reason},evidence.length);}
      catch(e){e.partialDraft=evidence.slice(0,24000);throw responseFailure(e,'provider_terminal_admission',{finishKind:ending.kind,finishReason:ending.reason});}
    }
    let reply;try{reply=extractReply(data)}catch(e){throw responseFailure(e,'response_shape',{
      responseShape:Object.keys(data||{}).slice(0,20),messageShape:Object.keys(data?.choices?.[0]?.message||{}).slice(0,20)});}
    reply=text(prefixResponseText(reply,body,cfg));
    try{options.onDiagnostic?.({type:'provider_result',finishKind:ending.kind,finishReason:ending.reason,responseChars:reply.length});}catch(e){console.error('诊断事件回调失败',e);}
    if(options.resultMeta){options.resultMeta.finishReason=ending.reason;options.resultMeta.finishKind=ending.kind;options.resultMeta.refused=!!data?.choices?.[0]?.message?.refusal;options.resultMeta.usage=data?.usage||null;options.resultMeta.requestId=requestId;}
    if(!(options.allowIncompleteDraft===true&&ending.kind==='truncated'))try{assertFinishState({finishKind:ending.kind,finishReason:ending.reason},reply.length)}catch(e){e.partialDraft=reply.slice(0,24000);throw responseFailure(e,'provider_terminal_admission',{finishKind:ending.kind,finishReason:ending.reason});}
    if(!reply){
      const msg=data?.choices?.[0]?.message||{},rawContent=msg.content;
      const contentKind=rawContent===null?'null':Array.isArray(rawContent)?'array':typeof rawContent;
      const u=data?.usage||{},parts=Array.isArray(rawContent?.parts)?rawContent.parts:Array.isArray(rawContent)?rawContent:[];
      throw new ApiError('E_API_EMPTY_REPLY','API 请求成功，但没有可见角色正文；已保护原剧情。',{status:res.status,details:diagnostic({
        errorSource:'response_body',httpStatus:res.status,contentType,finishReason:ending.reason,
        responseShape:Object.keys(data||{}).slice(0,20),messageShape:Object.keys(msg).slice(0,20),
        responseContentKind:contentKind,responseContentKeys:rawContent&&typeof rawContent==='object'&&!Array.isArray(rawContent)?Object.keys(rawContent).slice(0,15):[],
        responsePartCount:parts.length,responsePartTypes:parts.slice(0,12).map(p=>String(p?.type||typeof p)),
        completionTokens:finiteUsageNumber(u.completion_tokens,u.output_tokens,u.candidatesTokenCount),
        thinkingTokens:finiteUsageNumber(u.completion_tokens_details?.reasoning_tokens,u.thoughtsTokenCount,u.reasoning_tokens),
        visibleChars:0})});
    }
    timing('provider_text_validated',{receivedChars:reply.length});
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
    const body=arr(messages).map(m=>memoryTimestampLabel(m)+(m.role==='user'?`${ctx.userName}（玩家输入语义）：\n${compileUserInputForPrompt(session,m.content,inputSemanticMode(session,m))}`:`${ctx.charName}：${historyHtmlProjection(resolveMacrosForSession(session,m.content),session).text}`)).join('\n');
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
  // R4.11 memory request planner: no paid request until an exact source/reference
  // plan has been inspected and approved. Unknown provider windows are NEVER
  // guessed as 32k or 1M; the default plan is ONE full request with a warning.
  function memorySourceParts(source,refMessages=[],cfg=getApiConfig(),kind='core'){
    const budget=promptBudget();
    const referenceTokens=refMessages.reduce((n,m)=>n+estimateTokens(m.content)+8,0);
    // Reserve a generous prompt envelope (instructions + origin labels), distinct
    // from the model-output reserve already subtracted by promptBudget().
    const sourceCap=budget.verified?budget.usable-referenceTokens-1536:null;
    if(budget.verified&&sourceCap<512)
      throw new ApiError('E_MEMORY_REFERENCE_BUDGET','模型窗口不足以容纳所选参考、输出和总结指令；未删除任何参考或剧情。',{
        details:JSON.stringify({referenceTokens,usable:budget.usable,windowTokens:budget.windowTokens})});
    const full=String(source||'');
    if(!full)return [];
    if(!budget.verified||estimateTokens(full)<=sourceCap)
      return [{text:full,startOffset:0,endExclusive:full.length,splitOfSingleBlock:false}];
    // Divide at full chronology block boundaries, retaining the original bytes.
    // Large single blocks can only be divided with explicit indexed offsets.
    const breaks=[0],delimiter=/\n\n(?=【)/g;let found;
    while((found=delimiter.exec(full)))breaks.push(found.index+2);
    breaks.push(full.length);
    const out=[];let buf='',start=0;
    const flush=()=>{if(buf){out.push({text:buf,startOffset:start,endExclusive:start+buf.length,splitOfSingleBlock:false});buf='';}};
    for(let j=0;j<breaks.length-1;j++){
      let at=breaks[j],end=breaks[j+1],block=full.slice(at,end);
      if(estimateTokens(block)<=sourceCap){
        if(buf&&estimateTokens(buf+block)>sourceCap)flush();
        if(!buf)start=at;
        buf+=block;continue;
      }
      flush();
      while(at<end){
        let lo=at+1,hi=end,best=at;
        while(lo<=hi){const mid=Math.floor((lo+hi)/2),part=full.slice(at,mid);
          if(estimateTokens(part)<=sourceCap){best=mid;lo=mid+1;}else hi=mid-1;}
        if(best<=at)throw new ApiError('E_MEMORY_CHUNK_BUDGET','单个源片段无法在给定窗口容纳；没有发生无凭据裁切。');
        // Never slice one UTF-16 surrogate pair in two.
        if(best<end&&best>at&&/[\uD800-\uDBFF]/.test(full[best-1])&&/[\uDC00-\uDFFF]/.test(full[best]))best--;
        if(best<=at)throw new ApiError('E_MEMORY_CHUNK_BUDGET','边界落在不可拆字符中，未请求模型。');
        out.push({text:full.slice(at,best),startOffset:at,endExclusive:best,splitOfSingleBlock:true});at=best;
      }
    }
    flush();
    if(out.map(x=>x.text).join('')!==full)throw new ApiError('E_MEMORY_PLAN_SOURCE_LOSS','记忆规划来源范围不连续，禁止开始请求。');
    return out;
  }
  function memorySourceForCore(session,opts){
    const data=storyRoundData(session),memory=normalizeManualMemory(session.manualMemory);
    if(opts.source==='facts'){
      const facts=memory.facts.filter(f=>trustedFactForCore(session,f)).sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound);
      if(!facts.length)throw new ApiError('E_MEMORY_NO_FACTS','没有可用的事实记忆。');
      return facts.map(x=>`【第 ${x.startRound}–${x.endRound} 轮】\n${x.content}`).join('\n\n');
    }
    if(!data.rounds.length&&!data.opening.length)throw new ApiError('E_MEMORY_NO_CONTEXT','当前还没有可总结的剧情正文。');
    return formatRoundRange(data,1,Math.max(1,data.rounds.length),{includeOpening:true,session});
  }
  // G2: A paid plan is an executable, topologically ordered dependency DAG.
  // Every merge (including the final one) has a capacity proof BEFORE any paid leaf.
  // Worst-case child size uses the declared per-request output limit, not a
  // guess based on the desired short summary length.
  function memoryMergeGraph(prefix,leafStages,referenceTokens,budget,cfg,results,rounds=null){
    if(leafStages.length<2)return {levels:[],finalStage:leafStages[0],stages:[]};
    const outputBound=Math.max(256,Math.floor(Number(cfg.maxTokens)>0?Number(cfg.maxTokens):budget.reserve||4096));
    // The application's own estimateTokens() is only approximate; allowance
    // covers numbering, UTF representation and irregular output lengths.
    const perChild=Math.ceil(outputBound*1.6)+48;
    const envelope=referenceTokens+1536;
    // Without a declared context limit no split is authorized by the planner.
    if(!budget.verified)throw new ApiError('E_MEMORY_MERGE_PREFLIGHT_UNVERIFIED','多阶段记忆合并没有已声明的模型窗口；请求 0 次。');
    const maxFanIn=Math.min(32,Math.floor((budget.usable-envelope)/perChild));
    if(maxFanIn<2)throw new ApiError('E_MEMORY_MERGE_PREFLIGHT_UNSATISFIABLE',
      '根据当前窗口、输出上限和全部选中参考，无法完成最小双路合并；未发出任何付费请求。',
      {details:JSON.stringify({usable:budget.usable,referenceTokens,outputBound,perChild,maxFanIn})});
    const levels=[];let layer=leafStages.slice(),level=0;
    while(layer.length>1){
      const groups=[],next=[];
      for(let i=0;i<layer.length;i+=maxFanIn){
        const dependsOn=layer.slice(i,i+maxFanIn);
        if(dependsOn.length===1){next.push(dependsOn[0]);continue;}
        const isFinal=layer.length<=maxFanIn;
        const stage=isFinal?prefix+'_merge':`${prefix}_merge_l${level}_${groups.length}`;
        const inputEstimate=envelope+dependsOn.length*perChild;
        if(inputEstimate>budget.usable)throw new ApiError('E_MEMORY_MERGE_PREFLIGHT_UNSATISFIABLE','中间合并超过窗口，未发起请求。');
        const row={stage,operation:'merge',rounds,sourceRange:null,dependsOn,inputEstimate,outputTokenBound:outputBound,level};
        groups.push(row);results.push(row);next.push(stage);
      }
      levels.push(groups);layer=next;level++;
      if(level>64)throw new ApiError('E_MEMORY_MERGE_DEPTH','合并 DAG 深度超过有界限制，未发起请求。');
    }
    // A carried singleton can become the final dependency only if the last
    // level contains multiple nodes, so the public final ID is always stable.
    return {levels,finalStage:layer[0],stages:levels.flat()};
  }
  function memoryWorkPlan(kind,session,opts,refs,cfg){
    const budget=promptBudget(),results=[],referenceTokens=refs.reduce((n,m)=>n+estimateTokens(m.content)+8,0);
    let core=null,facts={},rolling=null;
    const registerLeaves=(chunks,leafStages,rounds=null)=>{
      chunks.forEach((chunk,i)=>{
        const inputEstimate=estimateTokens(chunk.text)+referenceTokens+1536;
        if(budget.verified&&inputEstimate>budget.usable)
          throw new ApiError('E_MEMORY_PLAN_LEAF_OVERFLOW','源分片和全部参考超过模型声明窗口，付费前中止。',{details:JSON.stringify({inputEstimate,usable:budget.usable,stage:leafStages[i]})});
        results.push({stage:leafStages[i],operation:'source',rounds,sourceRange:[chunk.startOffset,chunk.endExclusive],inputEstimate,
          outputTokenBound:Math.max(256,Number(cfg.maxTokens)||budget.reserve||4096),partialSingleBlock:chunk.splitOfSingleBlock});
      });
    };
    if(kind==='core'){
      const source=memorySourceForCore(session,opts),chunks=memorySourceParts(source,refs,cfg,'core');
      const leaves=chunks.map((_,i)=>chunks.length===1?'core_final_single':'core_part_'+i);
      registerLeaves(chunks,leaves);
      core={source,chunks,mergeGraph:memoryMergeGraph('core_final',leaves,referenceTokens,budget,cfg,results)};
      // Preserve legacy stage name core_final_merge for the root, not core_final_merge_merge.
    }else if(kind==='facts'){
      const data=storyRoundData(session),total=data.rounds.length;
      if(!total)throw new ApiError('E_MEMORY_NO_ROUNDS','当前剧情没有可总结的轮次。');
      const chunkRounds=clampInt(opts.chunkRounds,1,200,10),recentRounds=clampInt(opts.recentRounds,1,100000,total),first=opts.scope==='all'?1:Math.max(1,total-recentRounds+1);
      for(let a=first;a<=total;a+=chunkRounds){
        const b=Math.min(total,a+chunkRounds-1),tag=`fact_range_${a}_${b}`;
        const source=formatRoundRange(data,a,b,{includeOpening:a===1,session}),chunks=memorySourceParts(source,refs,cfg,'facts');
        const leaves=chunks.map((_,i)=>tag+'_part_'+i);
        registerLeaves(chunks,leaves,[a,b]);
        facts[tag]={source,chunks,mergeGraph:memoryMergeGraph(tag,leaves,referenceTokens,budget,cfg,results,[a,b])};
      }
    }
    // Stable topological stages include EVERY paid merge before approval.
    else if(kind==='rolling'){
      if(!budget.verified)throw new ApiError('E_MEMORY_ROLLING_WINDOW_UNVERIFIED','自动滚动记忆未声明真实模型窗口，无法证明合并容量；未进行付费请求。');
      const msgs=session.messages||[],safeWindow=Math.max(18,Number(session.promptSettings?.recentMessageLimit||34)-4);
      const end=msgs.length-safeWindow,start=session.lastSummarizedIndex||0;
      if(end<=start)throw new ApiError('E_MEMORY_ROLLING_NO_SOURCE','滚动记忆无新来源。');
      const sourceParts=rollingSourceParts(session,start,end,25000);
      const source=['【已有长期摘要】\n'+(session.rollingSummary||'(无)'),
        ...sourceParts.map((x,i)=>`【本次新增旧剧情 · 第 ${i+1} 段】\n${x.text}`)].join('\n\n');
      const chunks=memorySourceParts(source,refs,cfg,'rolling');
      const leaves=chunks.map((_,i)=>chunks.length===1?'rolling_summary':'rolling_part_'+i);
      registerLeaves(chunks,leaves);
      rolling={source,chunks,sourceParts,start,end,mergeGraph:memoryMergeGraph('rolling',leaves,referenceTokens,budget,cfg,results)};
    }
    const summary={kind,requestCount:results.length,referenceTokensPerRequest:referenceTokens,
      estimatedTotalInputTokens:results.reduce((n,x)=>n+x.inputEstimate,0),
      estimatedOutputTokens:results.reduce((n,x)=>n+x.outputTokenBound,0),
      contextWindowTokens:budget.verified?budget.windowTokens:null,windowDeclared:budget.verified,
      unknownCapacityWarning:!budget.verified,requiresSplit:results.some(x=>x.operation==='merge'),
      sourceChars:core?.source?.length??rolling?.source?.length??Object.values(facts).reduce((n,x)=>n+x.source.length,0),
      planVersion:3,capacityVerifiedForAllStages:budget.verified,stages:results};
    return {core,facts,rolling,summary};
  }
  async function executeMemoryMergeGraph(graph,leafStages,outputs,{job,signal,progress,kind,targetChars,temp,rangeScope=null,sourceType=''}){
    if(!graph?.stages?.length)return outputs[0];
    const parts=new Map(leafStages.map((stage,i)=>[stage,outputs[i]]));
    for(const node of graph.stages){
      assertMemoryTaskActive(signal);
      const inputs=node.dependsOn.map(dep=>{
        if(!parts.has(dep))throw new ApiError('E_MEMORY_PLAN_DEPENDENCY','已确认合并图存在未结算的上游阶段；未提交核心记忆。');
        return parts.get(dep);
      });
      if(job){(job.stageScopes||(job.stageScopes={}))[node.stage]={...(rangeScope||{sourceStartIndex:0,sourceEndExclusive:job.sourceCount}),
        prerequisiteOutputDigests:await Promise.all(inputs.map(exactDigest))};}
      emitProgress(progress,{phase:'memory_merge',stageKey:node.stage,detail:`记忆合并第 ${node.level+1} 层 · ${node.dependsOn.length} 项`});
      const prompt=kind==='core'?
        [{role:'system',content:'你是咪嘛馆的长期核心记忆编辑器。只合并给定的上游记忆，不能添加事实、遗漏关键关系，也不能续写。'+MEMORY_TIME_CONTRACT},
         {role:'user',content:`【候选核心材料】\n${inputs.map((x,i)=>`[${i+1}] ${x}`).join('\n\n')}\n\n保留重要关系、事件与因果，去重不删独立事实；${node.stage==='core_final_merge'?`最终目标约 ${targetChars} 字。`: '这是中间层整理，不强制压缩掉事实。'}`}]:
      kind==='rolling'?
        [{role:'system',content:'你是咪嘛馆的滚动剧情档案整理器。忠实合并旧档案与新增旧剧情，不遗漏任何独立事件，不擅自杜撰。'+MEMORY_TIME_CONTRACT},
         {role:'user',content:`【滚动记忆上游阶段】\n${inputs.map((x,i)=>`[${i+1}] ${x}`).join('\n\n')}\n\n按照发生顺序保存全部人物、事件、关系、状态、承诺与伏笔；禁止因为合并而删除不同事件或叙述细节。`}]:
        [{role:'system',content:'你是咪嘛馆的事实记忆编辑器。只合并上游已发生事实，不能创造新事实，同一行为多次发生要分别保留。'+MEMORY_TIME_CONTRACT},
         {role:'user',content:`【分段事实摘要】\n${inputs.map((x,i)=>`[${i+1}] ${x}`).join('\n\n')}\n\n合并重复措辞，完整保留不同事件的次数、人物、先后、否定与关系；目标约 ${targetChars} 字但不得删事实。`}];
      // Runtime guard uses the same effective reference injection and budget.
      const merged=await memoryModel(prompt,temp,signal,job,node.stage);
      parts.set(node.stage,merged);
    }
    return parts.get(graph.finalStage);
  }
  async function previewMemoryPlan(kind,id,opts={}){
    const original=getSession(id);if(!original)throw new ApiError('E_STORY_SESSION_MISSING','剧情不存在');
    const session=normalizeSession(clone(original)),cfg=getApiConfig(),refs=memoryReferenceSnapshot(session);
    const referenceMessages=referencePromptMessages(refs);
    const options={...opts,model:String(opts.model??session.manualMemory.settings.memoryModel??'').trim()};
    const planned=memoryWorkPlan(kind,session,options,referenceMessages,cfg);
    const digest=await exactDigest({kind,sessionId:id,options:{...options,approvedPlanDigest:undefined},source:planned.core?.source||planned.rolling?.source||Object.values(planned.facts).map(x=>x.source),references:refs,
      api:[cfg.contextWindowTokens,cfg.maxTokens,cfg.model,options.model],planVersion:planned.summary.planVersion,stages:planned.summary.stages});
    return {...planned.summary,digest};
  }
  // Bind each fact part to the exact model-visible characters and their
  // canonical message offsets. A >28k-character utterance can straddle parts;
  // validating both parts against the entire round falsely expands authority.
  function factOutputPlan(messages,requested){
    // Desired size is a soft goal. The model may exceed it to retain details.
    return {requestedChars:requested,advisedChars:requested,sourceMessageCount:arr(messages).length};
  }
  async function summarizeFactText(sourceText,targetChars,temp,signal,progress,label='事实记忆',job=null,rangeTag='fact',rangeScope=null,rangeMessages=[],sourceSession=null){
    const chunks=(job?.workPlan?.facts?.[rangeTag]?.chunks||memorySourceParts(sourceText,job?.referenceMessages||[])).map(x=>x.text),partials=[];
    // A long message can be split at 28k characters. These identities bind
    // each stage to its actual model-visible slice, not the whole range.
    const partScopes=chunks.map((part,partIndex)=>({...rangeScope,modelVisibleSlice:{partIndex,startOffset:0,endExclusive:part.length,sourceFingerprint:fingerprint(part)}}));
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
    const graph=job?.workPlan?.facts?.[rangeTag]?.mergeGraph;
    if(!graph)throw new ApiError('E_MEMORY_MERGE_PLAN_MISSING','超窗记忆没有预先签发的完整合并 DAG；拒绝继续收费。');
    return executeMemoryMergeGraph(graph,chunks.map((_,i)=>rangeTag+'_part_'+i),partials,
      {job,signal,progress,kind:'facts',targetChars,temp,rangeScope});
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
    if(typeof store?.beginMemoryJob!=='function'||typeof store?.putMemoryStage!=='function'||typeof store?.commitMemoryJob!=='function')
      throw new ApiError('E_MEMORY_STORE_UNAVAILABLE','持久记忆事务不可用；已停止本次请求，不会用无记录的生成流程消耗额度。');
    const original=normalizeSession(clone(snapshot));if(kind==='rolling'&&!summaryNeeded(original))return original;
    opts={...opts,model:String(opts.model??original.manualMemory.settings.memoryModel??'').trim()};
    let job=null,heartbeat=null;
    const generationAbort=new AbortController();
    const forwardAbort=()=>generationAbort.abort();
    if(signal?.aborted)forwardAbort();else signal?.addEventListener?.('abort',forwardAbort,{once:true});
    try{
      const cfg=getApiConfig();const configSignature=fingerprint([cfg.apiBase,cfg.chatEndpoint,opts.model||cfg.model,cfg.sendTemperature,cfg.maxTokens,cfg.stream,original.promptSettings?.historyHtmlMode||'semantic',window.MimaHistoryHtmlProjection?.version||'missing']);
      const referenceRecords=memoryReferenceSnapshot(original);
      const referenceMessages=referencePromptMessages(referenceRecords);
      const referenceDigest=await exactDigest(referenceRecords);
      // The exact selected-source versions used to build referenceRecords
      // must also match the durable store, before any paid model call begins.
      const referenceContract=store.memoryReferenceContract?.(state,id);
      if(!referenceContract)throw new ApiError('E_MEMORY_REFERENCE_CONTRACT_UNAVAILABLE','记忆参考资料版本合同不可用，已停止本次请求');
      const sourceFingerprint=memorySourceFingerprint(original.messages,original.messages.length);
      const targetBaseline=kind==='rolling'?JSON.stringify([original.rollingSummary||'',original.lastSummarizedIndex||0]):JSON.stringify(kind==='core'?normalizeManualMemory(original.manualMemory).core:normalizeManualMemory(original.manualMemory).facts);
      const sourceHash=fingerprint([sourceFingerprint,referenceDigest,kind==='core'&&opts.source==='facts'?original.manualMemory.facts:null,kind==='rolling'?original.rollingSummary:null]);
      const proposed=memoryWorkPlan(kind,original,opts,referenceMessages,cfg);
      if(kind==='rolling'){
        if(opts.autoRolling===true){
          if(original.promptSettings.autoRollingEnabled!==true)
            throw new ApiError('E_ROLLING_AUTO_NOT_AUTHORIZED','未开启允许收费的自动旧剧情整理');
          if(proposed.summary.requestCount>original.promptSettings.autoRollingMaxRequests)
            throw new ApiError('E_ROLLING_AUTO_BUDGET','自动整理的完整阶段图超过主人授权的单次请求预算；未调用模型');
        }else{
          const signed=await previewMemoryPlan('rolling',id,opts);
          if(!opts.approvedPlanDigest||opts.approvedPlanDigest!==signed.digest)
            throw new ApiError('E_MEMORY_PLAN_NOT_CONFIRMED','手动旧剧情整理收费计划未确认，未调用模型');
        }
      }
      if(proposed&&kind!=='rolling'){
        const signed=await previewMemoryPlan(kind,id,opts);
        if(!opts.approvedPlanDigest||opts.approvedPlanDigest!==signed.digest)
          throw new ApiError('E_MEMORY_PLAN_NOT_CONFIRMED','记忆请求计划未确认或来源/配置已变动，未调用付费模型。',{details:JSON.stringify(signed)});
      }
      job=await store.beginMemoryJob({sessionId:id,kind,options:opts,sourceHash,sourceCount:original.messages.length,sourceFingerprint,targetBaseline,configSignature,expectedReferenceContract:referenceContract});
      job.referenceMessages=referenceMessages;job.referenceDigest=referenceDigest;job.workPlan=proposed;
      await store.checkpointMemoryJob(job,'reference_snapshot',{digest:referenceDigest,selected:referenceRecords.map(x=>({kind:x.kind,id:x.id,authority:x.authority})),chars:referenceMessages.reduce((n,x)=>n+x.content.length,0)});
      if(typeof store.heartbeatMemoryJob==='function'&&typeof setInterval==='function'){
        heartbeat=setInterval(()=>store.heartbeatMemoryJob(job).catch(e=>{
          job.leaseError=new ApiError('E_MEMORY_HEARTBEAT_FAILED','记忆任务租约无法续期，已停止当前生成：'+(e?.message||'unknown'));
          console.error('Memory lease heartbeat failed',{sessionId:id,kind,jobId:job.id,attemptId:job.attemptId,stage:'heartbeat',code:e.code||e.message});
          generationAbort.abort();
        }),10000);
      }
      job.progress=progress;
      await store.checkpointMemoryJob(job,'request_planned',{sourceCount:original.messages.length,sourceRevision:original.recordRevision,planVersion:proposed?.summary?.planVersion,requestCount:proposed?.summary?.requestCount,stages:proposed?.summary?.stages});
      if(kind==='core')return await generateCoreMemory(id,opts,generationAbort.signal,progress,job,original);
      if(kind==='facts')return await generateFactMemories(id,opts,generationAbort.signal,progress,job,original);
      return await refreshSummary(original,opts.temperature,generationAbort.signal,progress,job);
    }catch(error){const e=job?.leaseError||error;if(job){try{await store.settleMemoryJob(job,job.leaseError?'failed':signal?.aborted||e.name==='AbortError'?'aborted':e.code==='E_MEMORY_NEEDS_REVIEW'?'needs_review':'failed',e.code||e.message||'E_MEMORY_FAILED');}catch(settle){e.settlementError=settle.message;}}throw e;}
    finally{if(heartbeat!==null)clearInterval(heartbeat);signal?.removeEventListener?.('abort',forwardAbort);}
  }
  async function checkpoint(job,stage,info={}){if(job){if(job.leaseError)throw job.leaseError;await window.MimaLocalStore.checkpointMemoryJob(job,stage,info);}}
  async function storeMemoryResult(job,snapshot,patch){
    if(job?.leaseError)throw job.leaseError;
    const normalizedPatch=patch.manualMemory?{...patch,manualMemory:normalizeManualMemory(patch.manualMemory)}:patch;
    const committed=await window.MimaLocalStore.commitMemoryJob(job,snapshot,normalizedPatch);
    // Merge persisted current state, not the stale pre-request snapshot.
    state=normalizeState(committed);return getSession(job.sessionId);
  }
  // A saved fact remains the owner's editable memory even when its source
  // History was subsequently regenerated or edited. Rebuilding core from facts
  // must use the SAME admitted fact set as forward-chat injection, not silently
  // reject entries using an obsolete source fingerprint.
  function trustedFactForCore(session,fact){return !!fact?.content;}
  // Content accuracy is owner-editable. This gate validates transport/format only;
  // lexical similarity, omission, paraphrase and source citations never veto a memory.
  function validateMemoryCandidate(messages,candidate,stage,finishReason='unknown'){
    const original=String(candidate??'').trim();
    const fence=original.match(/^```(?:json|text|txt|md|markdown)?[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/i);
    let memory=(fence?fence[1]:original).trim();
    const reject=(reason)=>{throw new ApiError('E_MEMORY_OUTPUT_INVALID','模型没有返回可保存的完整记忆正文；旧记忆保持不变。',
      {details:JSON.stringify({stage,reason,finishReason,chars:memory.length})});};
    if(['length','max_tokens','content_filter','safety','prohibited_content'].includes(String(finishReason).toLowerCase()))reject('provider_truncated_or_filtered');
    if(!memory||/^(?:\.{3,}|[.…]{2,}|null|undefined|n\/?a|todo|placeholder)$/i.test(memory))reject('empty_or_placeholder');
    if(/^```/.test(memory))reject('unfinished_fenced_block');
    if(memory.startsWith('{')){
      let json;try{json=JSON.parse(memory);}catch{reject('malformed_json');}
      if(!json||typeof json.memory!=='string')reject('unsupported_json');
      memory=json.memory.trim();
    }
    if(!memory||memory.length>250000)reject('empty_or_oversized');
    if(/^\s*(?:<\|im_start\|>|\[im_start\]|(?:system|developer)\s*:)/i.test(memory))reject('control_plane_response');
    // A sentence that resembles a provider refusal might be a literal plot
    // quotation. The API protocol already reports actual refusal/filter flags;
    // do not judge a memory by a text-prefix classifier.
    return {memory,contract:'owner_editable_summary',evidenceCount:0,provenance:[],verification:{format:'valid',source:'model_summary',fact:'model_generated',stage}};
  }
  async function memoryModel(messages,temp,signal,job,stage){
    const activeSession=job?getSession(job.sessionId):null;
    const stageScope=job?.stageScopes?.[stage];
    // Model responses are authored summaries; source fidelity is steered in
    // the prompt and owner edits, not decided by another brittle text matcher.
    const sourceRecords=[];
    // SHA binds the exact prompt, source slice and reference snapshot without
    // depending on the model name. Already-admitted stages survive refresh and
    // a deliberate switch to another provider/model.
    const actualPrompt=messages.map(m=>({...m}));
    actualPrompt[0]={...actualPrompt[0],content:actualPrompt[0].content+'\n【输出规则】仅输出忠实、清晰、详尽的记忆正文；允许自然意译及合并重复，保留重要细节、发生顺序与人物关系；不要 JSON、来源证明、额外解释或续写。'};
    if(job?.referenceMessages?.length)actualPrompt.splice(1,0,...job.referenceMessages);
    const contractDigest=job?await exactDigest({contractVersion:2,sessionId:job.sessionId,kind:job.kind,
      loadedCharMaskId:activeSession?.loadedCharMaskId||'',stage,
      sourceScope:stageScope||null,sourceLineage:stageScope?arr(activeSession?.messages).slice(stageScope.sourceStartIndex,stageScope.sourceEndExclusive).map(m=>[m.id,m.branchId||'',m.parentMessageId||'',m.metadata?.branchId||'']):null,
      referenceDigest:job.referenceDigest||'',messages:actualPrompt,temperature:temp}):'';
    if(job&&job.kind==='facts'){
      (job.stageContractDigests||(job.stageContractDigests={}))[stage]=contractDigest;
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
      if(job){await window.MimaLocalStore.putMemoryStage(job,stage,contractDigest,approved.output,
        {outputDigest:await exactDigest(approved.output),finishReason:'human_confirmed',verification:{fact:'human_confirmed'}});}
      await checkpoint(job,stage+'_reused_human',{sourceStartIndex:range.sourceStartIndex,sourceEndExclusive:range.sourceEndExclusive,sourceCoverageHash:hash});
      return approved.output;
    }
    if(job&&window.MimaLocalStore?.getMemoryStage){
      const oldDigest=await legacyStageDigest({stage,sourceHash:job.sourceHash,
        sourceFingerprint:job.sourceFingerprint,sourceScope:stageScope||null,
        referenceDigest:job.referenceDigest||'',messages:actualPrompt,temperature:temp});
      const staged=await window.MimaLocalStore.getMemoryStage(job,stage,contractDigest,oldDigest);
      if(staged){
        if(staged.outputLength!==staged.outputText.length||await exactDigest(staged.outputText)!==staged.outputDigest)
          throw new ApiError('E_MEMORY_STAGE_CHECKSUM','记忆候选的长度或 SHA256 校验失败；不会误写长期记忆。');
        const checked=validateMemoryCandidate(messages,staged.outputText,stage,staged.finishReason);
        // A v1 record is reused only if both its historical exact prompt
        // contract and SHA pass. Promote in a fenced v2 transaction; keep
        // the original v1 record untouched for rollback and audit.
        if(staged.version===1)await window.MimaLocalStore.putMemoryStage(job,stage,contractDigest,checked.memory,
          {outputDigest:await exactDigest(checked.memory),finishReason:staged.finishReason,model:staged.model,
            verification:{...checked.verification,legacySource:'R4.5_v1_revalidated'}});
        (job.verifiedStages||(job.verifiedStages={}))[stage]=checked;
        await checkpoint(job,stage+'_reused_durable',{contractDigest,outputDigest:staged.outputDigest,chars:checked.memory.length});
        emitProgress(job?.progress,{phase:'memory_stage_durable',stageKey:stage,stageContent:checked.memory,detail:`已复用耐久候选 ${stage}`});
        return checked.memory;
      }
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
      if(job){
        await window.MimaLocalStore.putMemoryStage(job,stage,contractDigest,checked.memory,
          {outputDigest:await exactDigest(checked.memory),finishReason:'legacy_revalidated',verification:checked.verification});
        (job.verifiedStages||(job.verifiedStages={}))[stage]=checked;
      }
      await checkpoint(job,stage+'_reused',{sourceHash:job.sourceHash,outputContract:checked.contract});return checked.memory;
    }
    if(job&&window.MimaMemoryPriority?.whenIdle){await checkpoint(job,stage+'_queued');await window.MimaMemoryPriority.whenIdle(signal);}
    await checkpoint(job,stage+'_request');const started=Date.now(),meta={};
    try{
      const prompt=actualPrompt;
      const memoryCfg=getApiConfig();if(job?.options?.model)memoryCfg.model=job.options.model;
      if(job){const declared=promptBudget();const estimated=prompt.reduce((n,m)=>n+estimateTokens(m.content)+8,0);
        if(declared.verified&&estimated>declared.usable)throw new ApiError('E_MEMORY_REFERENCE_BUDGET','记忆请求包含的参考资料超过已配置模型窗口；不会静默裁剪。',{details:JSON.stringify({stage,estimated,usable:declared.usable})});}
      const modelProgress=ev=>{if(job?.progress){emitProgress(job.progress,{...ev,jobId:job.id,attemptId:job.attemptId,stageKey:stage,sourceRange:stageScope||null});}};
      const value=await callModelWithConfig(prompt,memoryCfg,temp,signal,{streamOverride:job?.options?.memoryStreamMode==='on'?true:job?.options?.memoryStreamMode==='off'?false:undefined,resultMeta:meta,onProgress:modelProgress,memoryContext:job?{jobId:job.id,attemptId:job.attemptId,stage}:null});
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
      if(job){
        // Fenced durable write occurs before the bounded checkpoint. A failure
        // to persist is a failure, not a pretend success or a lost candidate.
        const outputDigest=await exactDigest(checked.memory);
        await window.MimaLocalStore.putMemoryStage(job,stage,contractDigest,checked.memory,{outputDigest,model:memoryCfg.model,finishReason:meta.finishReason||'unknown',verification:checked.verification});
        (job.verifiedStages||(job.verifiedStages={}))[stage]=checked;
      }
      emitProgress(job?.progress,{phase:'memory_stage_durable',stageKey:stage,stageContent:checked.memory,detail:`已安全保存候选 ${stage}`});
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
      try{await checkpoint(job,stage+'_error',{errorCode:e.code||e.name||'E_UNKNOWN',httpStatus:e.status||0,errorMessage:String(e.message||'').slice(0,2200),hint:String(e.hint||'').slice(0,800),details:String(e.details||'').slice(0,5000),elapsedMs:Date.now()-started});}catch(journalError){e.details=[String(e.details||''),`memoryJournalError: ${journalError.code||journalError.message||String(journalError)}`].filter(Boolean).join('\n');}throw e;
    }
  }
  function verifiedMemoryMetadata(job,stage){
    return {status:'model_generated',stage,citations:[]};
  }
  async function generateFactMemories(id,opts={},signal=null,progress=null,job=null,snapshot=null){
    let session=snapshot||getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);
    const data=storyRoundData(session),total=data.rounds.length;
    if(!total)throw new ApiError('E_MEMORY_NO_ROUNDS','当前剧情还没有可总结的 User→Character 轮次。');
    const chunkRounds=clampInt(opts.chunkRounds,1,200,10),scope=opts.scope==='all'?'all':'recent';
    const recentRounds=clampInt(opts.recentRounds,1,100000,total),targetChars=clampInt(opts.targetChars,80,12000,1800),temp=clampTemp(opts.temperature??0.35);
    const start=scope==='all'?1:Math.max(1,total-recentRounds+1),ranges=[];
    for(let a=start;a<=total;a+=chunkRounds)ranges.push([a,Math.min(total,a+chunkRounds-1)]);
    const generated=[];
    for(let i=0;i<ranges.length;i++){
      const [a,b]=ranges[i],source=formatRoundRange(data,a,b,{includeOpening:a===1,session});
      // Resume only uncommitted source ranges after a partial manual commit.
      // A later owner edit is authoritative and must never be overwritten.
      if(job?.recoverCommittedRanges&&!opts.regenerateExisting&&scope==='recent'){
        const existing=normalizeManualMemory(session.manualMemory).facts.filter(f=>f.startRound<=b&&a<=f.endRound);
        if(existing.length){
          if(existing.length!==1||existing[0].startRound!==a||existing[0].endRound!==b||!memorySourceValid(session,existing[0]))
            throw new ApiError('E_MEMORY_FACT_RANGE_ALREADY_COVERED','已提交事实与当前来源范围重叠或来源改变，自动恢复不会覆盖旧记忆。');
          await checkpoint(job,`fact_range_${a}_${b}_already_committed`,{startRound:a,endRound:b,source:'canonical_verified'});
          emitProgress(progress,{phase:'memory_fact_range_reused_committed',percent:8+Math.round(((i+1)/ranges.length)*78),detail:`第 ${a}–${b} 轮已确认入库，不重复调用 API`});
          continue;
        }
      }
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
      const checkedFact=normalizeFactMemory({startRound:a,endRound:b,content,createdAt:nowIso(),updatedAt:nowIso(),source:'manual_fact_summary',targetChars,temperature:temp,sourceMessageCount:data.rounds.filter(r=>r.index>=a&&r.index<=b).reduce((n,r)=>n+r.messages.length,0),sourceCount:session.messages.length,sourceFingerprint:memorySourceFingerprint(session.messages,session.messages.length),sourceMessageIds:rangeMessages.map(m=>m.id),sourceHash:memorySourceFingerprint(rangeMessages,rangeMessages.length),verification:verifiedMemoryMetadata(job,rangeTag+((job?.workPlan?.facts?.[rangeTag]?.chunks.length||1)>1?'_merge':'_part_0'))});
      if(job){
        if(!window.MimaLocalStore?.putFactRangeCandidate)throw new ApiError('E_MEMORY_FACT_RANGE_STORE_UNAVAILABLE','事实分段存储不可用，不宣告成功');
        const sliced=session.messages.slice(rangeScope.sourceStartIndex,rangeScope.sourceEndExclusive);
        job.loadedCharMaskId=session.loadedCharMaskId||'';
        const finalStage=rangeTag+((job?.workPlan?.facts?.[rangeTag]?.chunks.length||1)>1?'_merge':'_part_0');
        job.factRangeStageDigests ||= {};
        job.factRangeStageDigests[rangeTag]=job.stageContractDigests?.[finalStage];
        await window.MimaLocalStore.putFactRangeCandidate(job,rangeTag,rangeScope,checkedFact,memorySourceFingerprint(sliced,sliced.length),await exactDigest(checkedFact.content));
      }
      generated.push(checkedFact);
      await checkpoint(job,'fact_range_verified',{startRound:a,endRound:b,chars:content.length,durable:!!job});
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
      // Owner-saved facts are admissible input even if earlier plot turns were
      // revised. Source drift is diagnostic metadata, not a content veto.
      const facts=memory.facts.filter(f=>trustedFactForCore(session,f))
        .sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound);
      if(!facts.length)throw new ApiError('E_MEMORY_SOURCE_STALE','现有事实记忆的原始剧情来源已被修改，请检查记忆内容。');
      source=facts.map(x=>`【第 ${x.startRound}–${x.endRound} 轮】\n${x.content}`).join('\n\n');sourceFactCount=facts.length;
    }else{
      if(!data.rounds.length&&!data.opening.length)throw new ApiError('E_MEMORY_NO_CONTEXT','当前剧情还没有可总结的正文。');
      source=formatRoundRange(data,1,Math.max(1,data.rounds.length),{includeOpening:true,session});
    }
    const chunks=(job?.workPlan?.core?.chunks||memorySourceParts(source,job?.referenceMessages||[])).map(x=>x.text),partials=[];
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
          {role:'user',content:`【完整来源：${sourceType==='facts'?'事实记忆':'剧情原文'}】\n${source}\n\n写成约 ${targetChars} 字的长期核心记忆。按主题与关系组织，优先记录关系转变、承诺、重要选择及其后果、持续状态、身份、世界观与未解决事项。保留主体和因果。`}
        ],temp,signal,job,'core_final_single')
      : await executeMemoryMergeGraph(job?.workPlan?.core?.mergeGraph,
          chunks.map((_,i)=>'core_part_'+i),partials,{job,signal,progress,kind:'core',targetChars,temp,sourceType});
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
  function memoryFactSignature(facts){return fingerprint(arr(facts));}
  async function editFactMemory(id,factId,content){
    const session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','剧情已不存在');
    const memory=normalizeManualMemory(session.manualMemory),idx=memory.facts.findIndex(f=>f.id===factId);
    if(idx<0)throw new ApiError('E_MEMORY_FACT_MISSING','记忆已被删除，请刷新');
    const body=String(content??'').trim();if(!body||body.length>250000)throw new ApiError('E_MEMORY_FACT_INVALID','记忆正文为空或过长');
    memory.facts[idx]=normalizeFactMemory({...memory.facts[idx],content:body,source:'manual',sourceCount:0,sourceFingerprint:'',
      sourceMessageIds:[],sourceHash:'',updatedAt:nowIso(),verification:{status:'human_confirmed',stage:'owner_fact_edit',citations:[]}});
    session.manualMemory=memory;return await saveSession(session);
  }
  async function previewFactMerge(id,opts={},signal=null,progress=null){
    // Refresh canon on both zero-API planning and approved execution.
    state=normalizeState(await window.MimaLocalStore.loadState());
    const session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','剧情已不存在');
    const memory=normalizeManualMemory(session.manualMemory),ids=arr(opts.factIds).map(String),unique=[...new Set(ids)];
    if(unique.length<2||unique.length!==ids.length)throw new ApiError('E_MEMORY_MERGE_SELECTION','至少选择两条不同的事实记忆');
    const facts=unique.map(key=>memory.facts.find(f=>f.id===key));
    if(facts.some(f=>!f))throw new ApiError('E_MEMORY_MERGE_SOURCE_CHANGED','选中的记忆已变化，请刷新');
    facts.sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound);
    const temperature=clampTemp(opts.temperature??memory.settings.summaryTemperature),targetChars=clampInt(opts.targetChars,100,250000,6000);
    const cfg=getApiConfig(),model=String((opts.model??memory.settings.memoryModel)||'').trim();if(model)cfg.model=model;
    const referenceSnapshot=memoryReferenceSnapshot(session);
    const referenceMessages=referencePromptMessages(referenceSnapshot);
    const mergeStore=window.MimaLocalStore;
    if(!mergeStore?.getMergeStage||!mergeStore?.putMergeStage||!mergeStore?.createMergeDraft)
      throw new ApiError('E_MEMORY_MERGE_STORE_UNAVAILABLE','合并候选持久化不可用，未调用模型。');
    const oldDraft=await mergeStore.getMergeDraft(id);
    if(oldDraft&&!['DISCARDED','COMMITTED'].includes(oldDraft.status))
      throw new ApiError('E_MEMORY_MERGE_DRAFT_EXISTS','此剧情仍有可恢复的合并草稿，请先确认或放弃，不会重复消耗额度。');
    const checkedMergeStage=async(stage,prompt)=>{
      const contractDigest=await exactDigest({version:3,preflight,sessionId:id,role:stage,
        selectedFactIds:facts.map(x=>x.id),references:referenceSnapshot,
        messages:prompt,temperature,maxTokens:cfg.maxTokens,source:facts.map(x=>[x.id,x.content,x.startRound,x.endRound])});
      const existing=await mergeStore.getMergeStage(id,contractDigest);
      if(existing){
        if(existing.outputLength!==existing.outputText.length||await exactDigest(existing.outputText)!==existing.outputDigest)
          throw new ApiError('E_MEMORY_MERGE_CHECKSUM','已保存的合并阶段校验失败；不会覆盖原始事实。');
        return validateMemoryCandidate([],existing.outputText,stage).memory;
      }
      const output=validateMemoryCandidate([],await callModelWithConfig(prompt,cfg,temperature,signal,{streamOverride:false}),stage).memory;
      await mergeStore.putMergeStage(id,contractDigest,output,await exactDigest(output));
      return output;
    };
    // Explicit manual fact-to-fact consolidation is ALSO a paid memory task.
    // Prove every leaf and every dependency merge fits before the FIRST call.
    // No 16k-char fallback concatenation can masquerade as a merged result.
    const source=facts.map(f=>`【原事实记忆 ${f.id} · 第${f.startRound}–${f.endRound}轮】\n${f.content}`).join('\n\n');
    const chunks=memorySourceParts(source,referenceMessages,cfg,'facts');
    const graphRows=[],budget=promptBudget();
    const referenceTokens=referenceMessages.reduce((n,m)=>n+estimateTokens(m.content)+8,0);
    const leaves=chunks.map((_,i)=>'fact_merge_part_'+i);
    for(let i=0;i<chunks.length;i++){
      const inputEstimate=estimateTokens(chunks[i].text)+referenceTokens+1536;
      if(budget.verified&&inputEstimate>budget.usable)throw new ApiError('E_MEMORY_MERGE_PREFLIGHT_LEAF_OVERFLOW','所选事实记忆超出窗口，未产生任何付费请求');
    }
    const graph=memoryMergeGraph('fact',leaves,referenceTokens,budget,cfg,graphRows);
    // Preserve legacy final-stage public name, but bind its digest to the
    // complete ordered DAG / source / reference contract, not stage labels.
    for(const row of graph.stages){if(row.stage==='fact_merge')row.stage='fact_merge_final';row.dependsOn=row.dependsOn.map(x=>x==='fact_merge'?'fact_merge_final':x);}
    if(graph.finalStage==='fact_merge')graph.finalStage='fact_merge_final';
    const preflight={version:3,leafCount:chunks.length,stages:[...leaves.map((stage,i)=>({stage,operation:'source',sourceRange:[chunks[i].startOffset,chunks[i].endExclusive]})),...graph.stages],
      sourceDigest:await exactDigest(source),referenceDigest:await exactDigest(referenceSnapshot),selectedFactIds:facts.map(x=>x.id)};
    // Bind the actual paid work to all sources, model settings, stage edges,
    // output ceiling and locally declared window. No paid call may precede
    // this digest equality check. Old callers must explicitly authorize.
    const planDigest=await exactDigest({preflight,selected:facts.map(f=>[f.id,f.content,f.startRound,f.endRound]),
      wholeFacts:memory.facts.map(f=>[f.id,f.content,f.startRound,f.endRound,f.source,f.sourceFingerprint,f.sourceHash||'']),
      historyFingerprint:memorySourceFingerprint(session.messages,session.messages.length),
      referenceSnapshot,model:cfg.model,apiKind:cfg.apiType||cfg.provider||'',maxTokens:cfg.maxTokens,
      contextWindowTokens:budget.verified?budget.windowTokens:null,temperature,targetChars});
    const plannedRequests=preflight.stages.length;
    if(opts.planOnly===true)return {
      planDigest,planVersion:4,selectedCount:facts.length,requestCount:plannedRequests,
      sourceCharacters:source.length,model:cfg.model,contextWindowTokens:budget.verified?budget.windowTokens:null,
      capacityVerifiedForAllStages:budget.verified,
      estimatedInputTokens:chunks.reduce((n,c)=>n+estimateTokens(c.text)+referenceTokens+1536,0)
        +graph.stages.reduce((n,x)=>n+(Number(x.inputEstimate)||0),0),
      stages:preflight.stages.map((x,i)=>({index:i+1,id:x.stage,operation:x.operation,
        inputEstimate:x.inputEstimate||null,outputTokenBound:x.outputTokenBound||null,
        dependsOn:x.dependsOn||[],sourceRange:x.sourceRange||null})),
      note:'这是全部阶段最多可能调用的次数；符合合同的已存阶段可恢复复用，实际新请求可能更少。'};
    if(!opts.approvedPlanDigest||opts.approvedPlanDigest!==planDigest)
      throw new ApiError('E_MEMORY_MERGE_CHARGE_PLAN_STALE','二次合并计划尚未由主人确认，或来源/模型/预算已变化；没有发出付费请求。');
    const outputs=new Map();
    for(let i=0;i<chunks.length;i++){
      assertMemoryTaskActive(signal);
      emitProgress(progress,{phase:'memory_merge',percent:5+Math.round(60*i/Math.max(1,chunks.length)),detail:`整理事实记忆 ${i+1}/${chunks.length}`});
      const prompt=[{role:'system',content:'你是咪嘛馆的长期事实记忆整理助手。忠实保留人物、时间顺序、具体经历、对话与细节，不续写，不增加事实。只输出整理后的正文。'},...referenceMessages,
        {role:'user',content:`请整理下面的事实记忆，去除相同事件的冗余描述但保留不同轮次确实重复发生的事情；不得杜撰。\n${chunks[i].text}`}];
      outputs.set(leaves[i],await checkedMergeStage(leaves[i],prompt));
    }
    for(const node of graph.stages){
      assertMemoryTaskActive(signal);
      const parts=node.dependsOn.map(stage=>{
        if(!outputs.has(stage))throw new ApiError('E_MEMORY_MERGE_PLAN_DEPENDENCY','事实合并阶段缺少已验证上游，拒绝继续执行');
        return outputs.get(stage);
      });
      emitProgress(progress,{phase:'memory_merge',percent:65+Math.round(30*node.level/Math.max(1,graph.levels.length)),detail:`合并事实记忆层 ${node.level+1}：${node.dependsOn.length} 个阶段`});
      const prompt=[{role:'system',content:'合并事实记忆上游的所有已发生事件，不遗漏独立事件或更改次数、时间、角色、否定、关系。仅输出合并正文。'+MEMORY_TIME_CONTRACT},...referenceMessages,
        {role:'user',content:`【预先验证容量的合并节点 ${node.stage}】\n${parts.map((x,i)=>`[${i+1}] ${x}`).join('\n\n')}\n\n准确性高于目标 ${targetChars} 字，不能杜撰或擅自删掉不同事件。`}];
      outputs.set(node.stage,await checkedMergeStage(node.stage,prompt));
    }
    const output=outputs.get(graph.finalStage)||outputs.get(leaves[0]);
    if(!output)throw new ApiError('E_MEMORY_MERGE_NO_OUTPUT','事实合并没有全部已完成阶段，未创建可提交候选');
    assertMemoryTaskActive(signal);
    const draft=await mergeStore.createMergeDraft(id,{content:output,selectedIds:facts.map(f=>f.id),sourceSignature:memoryFactSignature(memory.facts),
      sourceHistoryFingerprint:memorySourceFingerprint(session.messages,session.messages.length),
      sourceHistoryCount:session.messages.length,startRound:Math.min(...facts.map(f=>f.startRound)),endRound:Math.max(...facts.map(f=>f.endRound)),
      targetChars,temperature,model:cfg.model,referenceDigest:await exactDigest(referenceSnapshot),outputDigest:await exactDigest(output)});
    emitProgress(progress,{phase:'memory_merge_preview',percent:100,detail:'合并候选已持久保存，原记忆尚未变更'});
    return draft;
  }
  async function commitFactMerge(id,body){
    if(typeof window.MimaLocalStore?.commitFactMerge!=='function')throw new ApiError('E_MEMORY_MERGE_STORE_UNAVAILABLE','合并事务不可用；旧记忆保持不变');
    const stateRecord=await window.MimaLocalStore.commitFactMerge(id,body);
    state=normalizeState(stateRecord);return getSession(id);
  }
  async function undoFactMerge(id){
    if(typeof window.MimaLocalStore?.undoFactMerge!=='function')throw new ApiError('E_MEMORY_MERGE_STORE_UNAVAILABLE','合并撤销不可用');
    const stateRecord=await window.MimaLocalStore.undoFactMerge(id);
    state=normalizeState(stateRecord);return getSession(id);
  }
  async function deleteCoreMemory(id){let session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);const memory=normalizeManualMemory(session.manualMemory||{});memory.core=normalizeManualMemory({}).core;session.manualMemory=memory;return saveSession(session);}
  async function deleteFactMemory(id,factId=''){let session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','未找到剧情 Session。');session=normalizeSession(session);const memory=normalizeManualMemory(session.manualMemory||{});memory.facts=factId?memory.facts.filter(x=>x.id!==factId):[];session.manualMemory=memory;return saveSession(session);}

  function rollingSourceParts(session,start,end,maxChars=25000){
    const ctx=macroContext(session),out=[];
    let current='',records=[],from=-1,to=-1;
    const flush=()=>{if(!current.trim())return;out.push({text:current,sourceStartIndex:from,sourceEndExclusive:to,parts:records});current='';records=[];from=-1;to=-1;};
    for(let index=start;index<end;index++){
      const m=session.messages[index];if(m.role!=='user'&&m.role!=='assistant')continue;
      const body=m.role==='user'?compileUserInputForPrompt(session,m.content,inputSemanticMode(session,m)):historyHtmlProjection(resolveMacrosForSession(session,m.content),session).text;
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
  function summaryNeeded(session,{automatic=false}={}){
    const limit=Math.max(18,Number(session.promptSettings?.recentMessageLimit||34)-4);
    const end=(session.messages||[]).length-limit;
    const pending=end-Math.max(0,Number(session.lastSummarizedIndex)||0);
    // Explicit user-triggered summaries keep the R9 behavior. Background jobs
    // respect the existing persisted setting instead of launching every turn.
    // This is an input-volume gate, never a sleep or a dropped source window.
    const trigger=Number(session.promptSettings?.summaryTriggerMessages||28);
    return (!automatic||session.promptSettings?.autoRollingEnabled===true)&&end>8&&pending>0&&(!automatic||pending>=trigger);
  }
  async function refreshSummary(session,temp,signal,progress,job=null){
    const original=clone(session);
    // Manual rolling is independently permitted even when auto billing is off.
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
      const plan=job?.workPlan?.rolling;
      if(!plan)throw new ApiError('E_MEMORY_ROLLING_PLAN_MISSING','自动滚动记忆没有收费前完成的依赖 DAG，未调用模型。');
      const sourceChunks=plan.chunks.map(x=>x.text);
      if(job){
        job.stageScopes=job.stageScopes||{};
        const all={sourceStartIndex:0,sourceEndExclusive:unsummarizedEnd,sourceType:'rolling_old_and_new_history'};
        job.stageScopes.rolling_summary=all;
        plan.chunks.forEach((x,i)=>job.stageScopes['rolling_part_'+i]={...all,modelVisibleSlice:{startOffset:x.startOffset,endExclusive:x.endExclusive,sourceFingerprint:fingerprint(x.text)}});
        await checkpoint(job,'rolling_source_plan',{sourceStartIndex:start,sourceEndExclusive:unsummarizedEnd,partCount:sourceChunks.length,
          sourceCoverageHash:memorySourceFingerprint(msgs.slice(start,unsummarizedEnd),unsummarizedEnd-start),
          messageIds:msgs.slice(start,unsummarizedEnd).map(m=>m.id),plannedMergeStages:plan.mergeGraph.stages.map(x=>x.stage)});
      }
      let summary;
      if(sourceChunks.length===1){
        summary=await memoryModel([{role:'system',content:'你是独立剧情档案助手。忠实保留已有长期摘要与全部新增旧剧情，禁止新增不存在的事实。'+MEMORY_TIME_CONTRACT},
          {role:'user',content:`【已确认的完整滚动来源】\n${sourceChunks[0]}\n\n${rollingLengthInstruction}`}],
            Math.min(clampTemp(temp),0.6),signal,job,'rolling_summary');
      }else{
        const leaves=[];
        for(let i=0;i<sourceChunks.length;i++){
          assertMemoryTaskActive(signal);
          const stage='rolling_part_'+i;
          leaves.push(await memoryModel([{role:'system',content:'你是咪嘛馆旧剧情档案整理器。忠实提炼以下模型可见片段；保留完整事件与时间关系，不杜撰、不遗漏独立事件。'+MEMORY_TIME_CONTRACT},
            {role:'user',content:`【滚动剧情片段 ${i+1}/${sourceChunks.length}】\n${sourceChunks[i]}\n\n完整提炼该片段中真实的角色、事件与关系。`}],
              Math.min(clampTemp(temp),0.6),signal,job,stage));
        }
        summary=await executeMemoryMergeGraph(plan.mergeGraph,sourceChunks.map((_,i)=>'rolling_part_'+i),leaves,
          {job,signal,progress,kind:'rolling',targetChars:1000,temp:Math.min(clampTemp(temp),0.6),rangeScope:{sourceStartIndex:0,sourceEndExclusive:unsummarizedEnd}});
      }
      // Cursor moves only after every source part and the final summary have
      // completed successfully; semantic compression is owner-editable.
      await checkpoint(job,'rolling_parts_complete',{partCount:sourceChunks.length,sourceEndExclusive:unsummarizedEnd});
      session.rollingSummary=summary;session.summary=summary;session.rollingVerification=verifiedMemoryMetadata(job,sourceChunks.length===1?'rolling_summary':'rolling_merge');session.lastSummarizedIndex=unsummarizedEnd;session.rollingSourceCount=unsummarizedEnd;session.rollingSourceFingerprint=memorySourceFingerprint(session.messages,unsummarizedEnd);
      emitProgress(progress,{phase:'summary_done',percent:28,detail:'旧剧情摘要已更新。'});
      return job?await storeMemoryResult(job,original,{rollingSummary:summary,summary,rollingVerification:session.rollingVerification,lastSummarizedIndex:unsummarizedEnd,rollingSourceCount:unsummarizedEnd,rollingSourceFingerprint:session.rollingSourceFingerprint}):await saveSession(session);
    }catch(e){throw e;}
  }
  const rollingInFlight=new Set();
  async function resumeExpiredRollingJobs(){
    // Do not silently buy another attempt after a browser restart. The stored
    // running lease and durable candidates remain available for owner review;
    // an explicit billing confirmation is needed to continue them.
    const store=window.MimaLocalStore;
    for(const session of state.sessions){
      const job=await store.getMemoryJob(session.id,'rolling');
      if(job?.status==='running'&&Number(job.leaseUntilEpoch||0)<=Date.now())
        console.warn('滚动整理中断，等待主人在记忆页确认继续',{sessionId:session.id,jobId:job.id,code:'E_ROLLING_REQUIRES_REAUTH'});
    }
  }
  function queueRollingSummary(id,temp){
    if(rollingInFlight.has(id)||!getSession(id)||!summaryNeeded(getSession(id),{automatic:true}))return;rollingInFlight.add(id);
    setTimeout(async()=>{try{
      const job=await window.MimaLocalStore?.getMemoryJob?.(id,'rolling');
      // A failed/aborted/needs-review job is a durable billing pause. Do not
      // retry the same rejected source on every new canonical story commit.
      if(job && ['failed','aborted','needs_review','interrupted'].includes(job.status))return;
      // A previous durable pause is itself an owner-action boundary. Do not
      // rebuild the same DAG or write another pause on each story turn. When
      // source/config changes the UI labels the old estimate stale; only an
      // explicit manual preview may re-plan and authorize new paid work.
      const paused=await window.MimaLocalStore?.getRollingPreflight?.(id);
      if(paused?.status==='paused_no_charge')return;
      // Use exactly the same full DAG used by the paid runner, before opening any job.
      const plan=await previewMemoryPlan('rolling',id,{temperature:temp});
      const session=getSession(id);
      if(!session||session.promptSettings.autoRollingEnabled!==true)return;
      const limit=session.promptSettings.autoRollingMaxRequests;
      if(plan.requestCount>limit){
        await window.MimaLocalStore.putRollingPreflight(id,{code:'E_ROLLING_AUTO_BUDGET',requestCount:plan.requestCount,allowedRequests:limit,
          contextWindowTokens:plan.contextWindowTokens,estimatedInputTokens:plan.estimatedTotalInputTokens,sourceCount:session.messages.length,sourceRevision:session.recordRevision,
          detail:'完整阶段图需要 '+plan.requestCount+' 次，当前授权最多 '+limit+' 次。须手动查看完整计划并确认，不能自动增加额度。'});
        window.dispatchEvent?.(new CustomEvent('mima:rolling-preflight',{detail:{sessionId:id}}));
        return;
      }
      await runRecordedMemory('rolling',id,{temperature:temp,autoRolling:true},null,null);
      await window.MimaLocalStore.clearRollingPreflight(id);
    }catch(e){
      if(['E_MEMORY_ROLLING_WINDOW_UNVERIFIED','E_MEMORY_CAPACITY','E_MEMORY_WINDOW_UNVERIFIED','E_ROLLING_AUTO_BUDGET'].includes(e.code)){
        const session=getSession(id);
        // The preflight record is durable even when no paid job was ever created.
        await window.MimaLocalStore.putRollingPreflight(id,{code:e.code,allowedRequests:session?.promptSettings?.autoRollingMaxRequests||1,
          contextWindowTokens:0,sourceCount:session?.messages?.length||0,sourceRevision:session?.recordRevision||0,detail:e.message});
        window.dispatchEvent?.(new CustomEvent('mima:rolling-preflight',{detail:{sessionId:id}}));
      }else if(e.code!=='E_MEMORY_JOB_PENDING')console.warn('Rolling summary background debt', {sessionId:id,code:e.code||'E_MEMORY_BACKGROUND',stage:'rolling',settlementError:e.settlementError||''});
    }
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
    const thirdParty=/^(?:该|此|本|这|前一条|上一条|你(?:的)?|您(?:的)?)(?:次|条)?(?:请求|提示词|内容|消息|问题)[^\n]{0,90}(?:因|由于|涉及|包含|触及|违反|不符合|无法|不能|被)/.test(front);
    const explicitBlock=/(?:无法(?:继续)?(?:生成|处理|提供|响应)|不能(?:继续)?(?:生成|提供|处理)|已?(?:被)?(?:拒绝|拦截|阻止)|不(?:予|会)提供|平台安全(?:规范|政策|标准|限制)禁止|违反(?:了)?(?:平台)?(?:安全|内容)(?:政策|规范|准则))/i.test(evidence);
    const providerSafety=/(?:平台|系统|模型|服务商|安全|内容|政策|规范|审核|拦截|限制|request|policy|safety|guidelines)/i.test(evidence);
    const engGateway=/^(?:the (?:previous|last|current|given|above)?\s*(?:request|prompt|content)|this (?:request|content)|your (?:request|prompt))[^\n]{0,110}(?:violat|involv|cannot|can't|prohibit|disallow|not allow|blocked)/i.test(front);
    const engBlocked=/(?:cannot (?:be )?(?:fulfilled|generated|processed)|cannot comply|(?:was|has been|is) (?:blocked|refused)|(?:violates|against) (?:the )?(?:safety|content) (?:policy|guidelines))/i.test(evidence);
    const japanese=/^(?:申し訳|すみません|AIとして|人工知能として)/i.test(start)&&/(?:AI|言語モデル|安全ポリシー|ガイドライン|コンテンツポリシー)/i.test(evidence)&&/(?:対応|生成|提供|お手伝い)(?:することが)?できません|お応えできません/.test(evidence);
    // A character, fictional AI or stage performer may say 'I cannot generate'
    // inside a complete scene. Text alone is not evidence of the speaker's origin.
    // Keep protocol-level refusal/finish signals authoritative (checked above).
    const fictionalNarration=/(?:[。！？.!?][\s\S]{0,100}(?:她|他|它|机器人|演员|女孩|少年|角色)[^。！？.!?\n]{0,70}(?:说完|说道|说着|回答|低语|转身|望向|走向|关闭|放下|按下|抬起|笑了|哭了))/.test(evidence);
    if(fictionalNarration)return {blocked:false,reason:'in_scene_narration'};
    // Previously '无法生成/不能参与/不能继续' alone satisfied chinesePolicy,
    // and chineseStrong counted ordinary fictional '角色扮演/故事' as evidence.
    // Neither establishes a provider refusal. Require technical attribution.
    const chineseProviderAttribution=/(?:安全(?:政策|准则|规则|标准)|内容政策|平台(?:政策|规定|安全)|(?:作为|身为)(?:一个|一名)?(?:ai|人工智能|语言模型)|我(?:必须|只能)拒绝(?:这|该|您|你)|(?:不符合|违反)(?:平台|服务|内容|安全)|(?:露骨(?:色情)?|色情|性描写)内容|(?:请求|提示词)因(?:内容|安全)审核)/i.test(evidence);
    const chineseExplicitRequest=/^(?:很?抱歉|对不起|我(?:无法|不能|不可以))[^\n]{0,110}(?:您|你的|该|此|这)(?:次|条)?(?:请求|提示词)[^\n]{0,70}(?:无法|不能|拒绝|不予|不符合|涉及|违反)/.test(start);
    if((english&&(englishPolicy||englishStrong))||(chinese&&((chinesePolicy||chineseStrong)&&chineseProviderAttribution||chineseExplicitRequest))||(thirdParty&&explicitBlock&&providerSafety)||(engGateway&&engBlocked)||japanese)return {blocked:true,reason:'provider_plaintext_refusal'};
    return {blocked:false,reason:''};
  }
  function validateStoryReply(reply,meta={}){
    const result=classifyStoryReply(reply,meta);
    if(result.blocked&&meta.manualRecovery!==true)throw new ApiError('E_API_REFUSAL_CONTENT','模型返回了拒绝声明，已阻止将其作为角色回复保存或归档。',{hint:'这是模型或网关返回的内容限制，不代表你请求了绘图。可以检查坏回复并手动恢复；不会自动重复付费请求。',details:JSON.stringify({stage:'story_reply_admission',reason:result.reason,finishReason:String(meta.finishReason||'unknown'),receivedChars:String(reply||'').length})});
    if(meta.outputContract?.completeHtml===true)validateCompleteHtml(reply);
    if(meta.outputContract?.requireHtml===true){
      const validator=window.MimaHtmlStructure;
      if(!validator?.inspect)throw new ApiError('E_HTML_CONTRACT_RUNTIME_MISSING','HTML 结构校验模块未加载，拒绝伪成功');
      const verdict=validator.inspect(reply,meta.outputContract);
      if(!verdict.ok)throw new ApiError(verdict.status==='plain_text'?'E_HTML_STRUCTURE_MISSING':'E_HTML_REQUIRED_NODE_MISSING',
        '回复缺少主人指定的 HTML 结构；候选已保留在生成诊断中，不会后台重刷收费模型。',{
          details:JSON.stringify({missing:verdict.missing,stage:'story_output_contract'})});
    }
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
    // Never assemble from an old in-memory UI snapshot when another tab or
    // independent memory job has already committed to canonical IndexedDB.
    // A failed read is NOT an empty memory store and must abort this request.
    state=normalizeState(await window.MimaLocalStore.loadState());
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
      built=assemble(promptSession,{...opts,preserveTerminalAssistant:action==='continue'&&cfg.continuationMode==='deepseek_prefix'});
      requestBody=makeApiBody(built.messages,cfg,temp,{continuation:action==='continue'});
      snapshot=generationSnapshot(session,promptSession,requestBody,built.messageSources,action,action==='continue'?target?.id:null,sourceFingerprint,built.inspector?.contextTrace);
      const detail=action==='regenerate'&&target&&options.regenerationContext!=='current'?'旧记录没有请求快照，已明确使用当前挂载重建原轮。':action==='continue'?(cfg.continuationMode==='deepseek_prefix'?'按已声明的 prefix 协议请求续写。':'普通 Chat 后续 assistant 生成；接口未声明原文前缀补全，连续性由上下文和玩家预设决定。'):`Prompt（提示词）已组装 · ${requestBody.messages.length} 条消息`;
      emitProgress(progress,{phase:'prompt_ready',percent:34,detail});
    }
    // Frozen retries/regenerations bypass assemble(); capacity checks must not.
    // This only fences requests, never edits their historical frozen content.
    const frozenBudget=promptBudget();
    const frozenSystemChars=requestBody.messages.filter(m=>m.role==='system').reduce((n,m)=>n+String(m.content||'').length,0);
    const frozenEstimate=requestBody.messages.reduce((n,m)=>n+estimateTokens(m.content)+8,0)+Math.max(160,Math.ceil(frozenSystemChars*.08));
    if(frozenBudget.verified&&frozenEstimate>frozenBudget.usable)
      throw new ApiError('E_CONTEXT_FROZEN_BUDGET','冻结的历史请求已经超过当前声明的模型容量；未重复发送旧超大请求。',{
        details:JSON.stringify({estimatedInputTokens:frozenEstimate,usableTokens:frozenBudget.usable,source:'frozen_request'}),
        hint:'请用当前剧情重新规划上下文；旧生成快照和存档保持原样，不自动更换模型或扣费。'});
    if(!frozenBudget.verified&&frozenEstimate>frozenBudget.provisionalRetrievalTokens)
      throw new ApiError('E_CONTEXT_WINDOW_REQUIRED','冻结请求体过大且没有配置真实模型上下文容量；未重复发送。',{
        details:JSON.stringify({estimatedInputTokens:frozenEstimate,source:'frozen_request'}),
        hint:'请先核实并填写模型上下文窗口，再使用当前剧情重新规划；旧快照不变。'});
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
    const diagnosticId=journal?.begin?.({sessionId:id,turnId:options.diagnosticTurnId||'',traceId:options.diagnosticTraceId||'',action});
    let diagnosticCandidate='';
    const storyClock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now(),storyTimelineStart=storyClock();
    const storyMark=(phase,extra={})=>{if(diagnosticId)void journal.event(diagnosticId,{type:'timing',phase,generationId:pending.id,attempt:pending.attempt,elapsedAfterPreparedMs:Math.round((storyClock()-storyTimelineStart)*100)/100,preparationElapsedMs:Date.now()-preparationStartedAt,...extra});};
    storyMark('canonical_snapshot_persisted',{messageCount:messages.length});
    try{
    const replyRaw=await callModelWithConfig(messages,cfg,temp,signal,{onProgress:progress,resultMeta:storyResultMeta,requestBody,messageSources:snapshot.messageSources,
      storyContext:{sessionId:id,generationId:pending.id,generationAttempt:pending.attempt,preparationElapsedMs:Date.now()-preparationStartedAt},
      onDiagnostic:event=>{if(diagnosticId)void journal.event(diagnosticId,event);}});
    if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
    diagnosticCandidate=replyRaw;
    storyMark('provider_reply_parsed',{chars:replyRaw.length});
    const admissionMeta={...storyResultMeta,outputContract:session.promptSettings?.outputContract};
    // HTML structure is admitted on the canonical post-output-regex text.
    // Raw transport still checks refusal and the preexisting balanced-HTML
    // option, but existing output-regex transformations may legitimately add
    // the explicitly required structure. Do not discard them before running.
    const rawAdmissionMeta={...admissionMeta,outputContract:{...(admissionMeta.outputContract||{}),requireHtml:false}};
    validateStoryReply(replyRaw,rawAdmissionMeta);
    // Hard invariant: never persist a blank assistant message.
    if(!text(replyRaw))throw new ApiError('E_API_EMPTY_REPLY','模型返回空白正文，已阻止写入剧情。');
    storyMark('raw_validated');
    const reply=applyRegexForSession(session,replyRaw,'output');
    storyMark('output_regex_done',{chars:reply.length});
    // Keep the complete original provider text for manual recovery if an output
    // regex erases/mangles it. The transformed text is not the raw reply.
    // Output regex is a second admission boundary: it must not turn an
    // accepted provider response into an empty or provider-voice refusal.
    const boundTemplate=session.promptSettings?.outputContract?.templateMessageId
      ?session.messages.find(m=>m.id===session.promptSettings.outputContract.templateMessageId&&m.role==='assistant') : null;
    const canonicalAdmissionMeta={...admissionMeta,outputContract:{...(admissionMeta.outputContract||{}),...(boundTemplate?{templateHtml:boundTemplate.content}:{})}};
    validateStoryReply(reply,canonicalAdmissionMeta);
    if(!text(reply))throw new ApiError('E_API_EMPTY_REPLY','输出正则处理后没有有效角色正文；未提交空白消息。');
    const renderedReply=applyRegexForSession(session,reply,'display');
    storyMark('display_regex_done',{chars:renderedReply.length});
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
    if(action==='continue'&&target&&isManuallyRecoveredReply(sourceBeforeReply.find(m=>m.id===target.id))){
      const continued=session.messages.find(m=>m.id===target.id);continued.metadata.manualRecovery={...continued.metadata.manualRecovery,contentFingerprint:manualReplyFingerprint(continued)};
    }
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
    storyMark('canonical_committed',{messageCount:saved.messages.length});
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
  // An HTML-invalid Provider reply is not a canonical assistant message. This
  // pathway repairs the durable rejected diagnostic without a second API call,
  // and still settles the original failed generation exactly once.
  async function prepareRejectedHtmlRepair(id,diagnosticId){
    const record=await window.MimaDiagnosticJournal.recoveryCandidate(diagnosticId);
    if(record.sessionId!==id||String(record.action||'').startsWith('compat_'))throw new ApiError('E_HTML_REPAIR_OWNER','诊断不属于原生剧情。');
    state=normalizeState(await window.MimaLocalStore.loadState());
    const session=getSession(id),pending=session?.pendingGeneration;
    if(!pending||pending.id!==record.generationId||pending.attempt!==record.generationAttempt||pending.status!=='failed'||pending.action!==record.action||
      pending.canonicalFingerprint!==memorySourceFingerprint(session.messages,session.messages.length))
      throw new ApiError('E_HTML_REPAIR_RECOVERY_STALE','失败生成已更换或剧情变化，不生成过期候选。');
    const raw=String(record.rawRejectedReply||'');
    if(!raw.trim()||record.rejectedReplyTruncated)throw new ApiError('E_HTML_REPAIR_RAW_INCOMPLETE','诊断正文不完整，不允许猜测或补造。');
    const contract=session.promptSettings?.outputContract||{};
    const template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    if(!contract.requireHtml||!template)throw new ApiError('E_HTML_REPAIR_TEMPLATE_MISSING','请先选择有效标准 HTML 模板。');
    const validator=window.MimaHtmlStructure;
    const attempt=validator.propose(raw,template.content,contract);
    const templateDigest=await exactDigest({content:template.content,contract});
    const messageId='rejected_'+record.id;
    const candidate={version:1,sessionId:id,messageId,recoveryDiagnosticId:record.id,recoveryGenerationId:pending.id,
      recoveryAttempt:pending.attempt,baseContentDigest:await exactDigest({raw,canonicalFingerprint:pending.canonicalFingerprint}),
      templateMessageId:template.id,templateDigest,contractDigest:await exactDigest(contract),
      proposedContent:attempt.proposedContent,oldContent:raw,repairActions:attempt.repairActions,
      confidence:attempt.confidence,missingFields:attempt.missingFields,provenance:'code_generated_recovery',state:'pending',createdAt:nowIso()};
    candidate.id=await exactDigest({id,messageId,baseContentDigest:candidate.baseContentDigest,templateDigest,proposedContent:candidate.proposedContent});
    await window.MimaLocalStore.putHtmlRepairCandidate(candidate);
    return candidate;
  }
  async function restoreRejectedReply(id,body={}){
    if(body.confirmed!==true)throw new ApiError('E_REPLY_RECOVERY_CONFIRM','请先确认将已收到的文本手动恢复到原剧情。');
    const record=await window.MimaDiagnosticJournal.recoveryCandidate(body.diagnosticId);
    if(record.sessionId!==id||String(record.action||'').startsWith('compat_'))throw new ApiError('E_REPLY_RECOVERY_OWNER','诊断不属于这个原生剧情。');
    const persisted=normalizeState(await window.MimaLocalStore.loadState()),session=persisted.sessions.find(s=>s.id===id);
    if(!session)throw new ApiError('E_STORY_SESSION_MISSING','原剧情已删除，未重建或覆盖存档。');
    const previous=session.messages.find(m=>m.metadata?.manualRecovery?.diagnosticId===record.id||arr(m.metadata?.manualRecoveryIds).includes(record.id));
    if(previous)return {session,messageId:previous.id,alreadyRestored:true,action:record.action};
    const pending=session.pendingGeneration;
    if(!record.generationId||!pending||pending.id!==record.generationId||pending.attempt!==record.generationAttempt||pending.status!=='failed'||pending.action!==record.action)
      throw new ApiError('E_REPLY_RECOVERY_STALE','原失败任务已被重试、替换或清理，未将旧回复写入新剧情。');
    if(pending.canonicalFingerprint!==memorySourceFingerprint(session.messages,session.messages.length))
      throw new ApiError('E_CANONICAL_CONFLICT','失败后剧情正文或版本已变化，未覆盖当前时间线。');
    const raw=String(record.rawRejectedReply),action=pending.action;
    let recoveredContent=raw,htmlRepair=null;
    if(body.htmlCandidateId){
      const key='rejected_'+record.id,c=await window.MimaLocalStore.getHtmlRepairCandidate(id,key);
      if(!c||c.id!==body.htmlCandidateId||c.state!=='pending'||c.recoveryDiagnosticId!==record.id||
        c.recoveryGenerationId!==pending.id||c.recoveryAttempt!==pending.attempt||c.provenance!=='code_generated_recovery'||
        c.baseContentDigest!==await exactDigest({raw,canonicalFingerprint:pending.canonicalFingerprint}))
        throw new ApiError('E_HTML_REPAIR_RECOVERY_STALE','候选或冻结任务发生变化，未覆盖。');
      const contract=session.promptSettings?.outputContract||{};
      const template=session.messages.find(x=>x.id===c.templateMessageId);
      if(!template||c.templateDigest!==await exactDigest({content:template.content,contract})||
        c.contractDigest!==await exactDigest(contract)||
        window.MimaHtmlStructure.propose(raw,template.content,contract).proposedContent!==c.proposedContent)
        throw new ApiError('E_HTML_REPAIR_TEMPLATE_STALE','模板或结构已变化，拒绝修复。');
      try{recoveredContent=window.MimaHtmlStructure.finalizeProposal(raw,template.content,contract,c.proposedContent,body.dynamicValues||{});}
      catch(error){throw new ApiError('E_HTML_REPAIR_OWNER_CONFIRMATION_REQUIRED',String(error.message||error));}
      htmlRepair=c;
    }
    validateStoryReply(recoveredContent,{manualRecovery:true,outputContract:session.promptSettings?.outputContract});
    let target=pending.targetMessageId?session.messages.find(m=>m.id===pending.targetMessageId&&m.role==='assistant'):null;
    if((action==='continue'||pending.targetMessageId)&&!target)throw new ApiError('E_REPLY_RECOVERY_TARGET','原回复目标已不存在，未覆盖其他消息。');
    state=persisted;
    if(target&&(action==='continue'||action==='regenerate')){
      archiveVersion(target,'manual_recovery_before_'+action);
      if(action==='continue'){
        target.rawContent=String(target.rawContent??target.content)+'\n'+raw;target.content+='\n'+recoveredContent;
      }else{target.rawContent=raw;target.content=recoveredContent;target.isEdited=!!htmlRepair;}
    }else{
      if(!['send','regenerate','auto_advance'].includes(action))throw new ApiError('E_REPLY_RECOVERY_ACTION','这个操作类型不能恢复到剧情。');
      target=makeMessage('assistant',recoveredContent,session,{source:'manual_diagnostic_recovery'});target.rawContent=raw;target.isEdited=!!htmlRepair;session.messages.push(target);
    }
    target.metadata={...(target.metadata||{}),...(htmlRepair?{htmlCodeRepair:{candidateId:htmlRepair.id,originalRawPreserved:true,approvedAt:nowIso(),recoveryDiagnosticId:record.id}}:{}),generationSnapshot:action==='continue'?target.metadata?.generationSnapshot:pending.snapshot,
      manualRecoveryIds:[...new Set([...arr(target.metadata?.manualRecoveryIds),record.id])],
      manualRecovery:{diagnosticId:record.id,generationId:pending.id,attempt:pending.attempt,action,restoredAt:nowIso(),providerFinishReason:record.finishReason||'',contentFingerprint:manualReplyFingerprint(target)}};
    target.renderedContent=applyRegexForSession(session,target.content,'display');target.tokenEstimate=estimateTokens(target.content);
    // Explicit human action only: no Provider, retry or background summary.
    let saved;
    if(htmlRepair){
      const normalized=normalizeSession({...session,pendingGeneration:null,legacyMemoryQuarantined:true,updatedAt:nowIso()});
      const initialRecordRevision=Number(session.recordRevision)||0;
      normalized.recordRevision=initialRecordRevision+1;
      const nextState=clone(persisted),idx=nextState.sessions.findIndex(x=>x.id===id);
      if(idx<0)throw new ApiError('E_STORY_SESSION_MISSING','恢复目标已不存在');
      nextState.sessions[idx]=normalized;
      const committed=await window.MimaLocalStore.commitHtmlRepair(nextState,Number(persisted.storeRevision)||0,id,htmlRepair.messageId,htmlRepair.id,initialRecordRevision);
      state=normalizeState(committed);saved=normalized;
    }else saved=await saveSession({...session,pendingGeneration:null,legacyMemoryQuarantined:true});
    return {session:saved,messageId:target.id,alreadyRestored:false,action};
  }
  async function prepareHtmlRepair(id,msgId){
    state=normalizeState(await window.MimaLocalStore.loadState());
    const session=getSession(id),message=session?.messages.find(x=>x.id===msgId);
    if(!session||!message||message.role!=='assistant')throw new ApiError('E_HTML_REPAIR_TARGET_MISSING','目标角色回复不存在。');
    const contract=session.promptSettings?.outputContract||{};
    if(!contract.requireHtml||!contract.templateMessageId)throw new ApiError('E_HTML_REPAIR_TEMPLATE_MISSING','请先在上下文设置中绑定一条正确的 HTML 模板消息。');
    const template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    if(!template)throw new ApiError('E_HTML_REPAIR_TEMPLATE_STALE','指定格式参考已不在当前剧情中，不能猜测结构。');
    const validator=window.MimaHtmlStructure;
    if(!validator?.propose)throw new ApiError('E_HTML_REPAIR_RUNTIME_MISSING','HTML 代码修复模块未加载。');
    const targetDigest=await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions});
    const templateDigest=await exactDigest({content:template.content,contract});
    const attempt=validator.propose(message.content,template.content,contract);
    const candidate={version:1,sessionId:id,messageId:msgId,branchId:message.branchId||'main',baseMessageVersion:arr(message.versions).length,
      baseContentDigest:targetDigest,templateMessageId:template.id,templateDigest,contractDigest:await exactDigest(contract),
      proposedContent:attempt.proposedContent,oldContent:message.content,repairActions:attempt.repairActions,
      confidence:attempt.confidence,missingFields:attempt.missingFields,provenance:'code_generated',state:'pending',createdAt:nowIso()};
    candidate.id=await exactDigest({id,msgId,targetDigest,templateDigest,proposedContent:candidate.proposedContent});
    if(!window.MimaLocalStore?.putHtmlRepairCandidate)throw new ApiError('E_HTML_REPAIR_STORE_MISSING','修复候选存储不可用，未改动剧情。');
    await window.MimaLocalStore.putHtmlRepairCandidate(candidate);
    return candidate;
  }
  async function prepareAiHtmlRepair(id,msgId,body={}){
    if(body.confirmedCharge!==true)throw new ApiError('E_HTML_AI_CHARGE_NOT_APPROVED','主人未确认付费重排；请求 0 次。');
    state=normalizeState(await window.MimaLocalStore.loadState());
    const session=getSession(id),message=session?.messages.find(x=>x.id===msgId);
    if(!message||message.role!=='assistant')throw new ApiError('E_HTML_AI_TARGET_MISSING','目标角色回复不存在。');
    const contract=session.promptSettings?.outputContract||{},template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    if(!contract.requireHtml||!template||!contract.bodySelector)throw new ApiError('E_HTML_AI_TEMPLATE_MISSING','请选择有效 HTML 模板与唯一正文槽。');
    const validator=window.MimaHtmlStructure;
    if(!validator?.verifyReformat)throw new ApiError('E_HTML_AI_RUNTIME_MISSING','独立 HTML 安全验证未加载，拒绝付费请求。');
    // Reject unsupported status data BEFORE the charge. Do not ask a model to
    // guess missing state values, even when the resulting HTML looks plausible.
    const admitted=validator.aiAdmission(message.content,template.content,contract);
    if(admitted.deterministicAvailable)throw new ApiError('E_HTML_AI_CODE_FIRST','当前正文可用免 API 静态代码补全，请先选择代码修复；不会重复消费 API。');
    const targetDigest=await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions});
    const templateDigest=await exactDigest({content:template.content,contract});
    const sys='你是严格的 HTML 排版器，不是剧情写手。唯一允许的任务是把原 HTML 中明确位于正文槽的逐字文本按固定模板复原。状态栏每个动态字段必须换成模板标注的【待确认】占位；不得沿用模板的旧状态，不得新增人物事实或改变 CSS、节点、属性。只输出完整 HTML。';
    const user=`【原始正文】\n${message.content}\n\n【固定模板】\n${template.content}\n\n【正文槽】\n${contract.bodySelector}\n\n严格保持正文每个原始字符不变。`;
    const cfg=getApiConfig();
    const returned=await callModelWithConfig([{role:'system',content:sys},{role:'user',content:user}],cfg,0.1,null,{streamOverride:false});
    // Reopen canonical after the awaited paid request. A concurrent edit is a
    // conflict, even if a model returned perfectly valid HTML.
    const fresh=normalizeState(await window.MimaLocalStore.loadState()),current=fresh.sessions.find(x=>x.id===id);
    const original=current?.messages.find(x=>x.id===msgId),ref=current?.messages.find(x=>x.id===template.id);
    if(!original||!ref||await exactDigest({content:original.content,rawContent:original.rawContent,versions:original.versions})!==targetDigest||
       await exactDigest({content:ref.content,contract:current.promptSettings?.outputContract})!==templateDigest)
      throw new ApiError('E_HTML_AI_SOURCE_STALE','本次付费重排期间原文或模板变化，拒绝旧返回值。');
    let checkedAi;try{checkedAi=validator.verifyReformat(message.content,returned,template.content,contract);}
    catch(e){throw new ApiError('E_HTML_AI_RESULT_UNSAFE','模型未能保留精确正文/结构，旧剧情未修改。',{details:String(e.message||e)});}
    const candidate={version:1,sessionId:id,messageId:msgId,branchId:message.branchId||'main',baseMessageVersion:arr(message.versions).length,
      baseContentDigest:targetDigest,templateMessageId:template.id,templateDigest,contractDigest:await exactDigest(contract),
      proposedContent:returned,oldContent:message.content,repairActions:['one_paid_reformat_attempt','exact_content_verification'],
      confidence:'exact_content_checked',missingFields:checkedAi.missingFields||[],provenance:'ai_reformatted',state:'pending',createdAt:nowIso()};
    candidate.id=await exactDigest({id,msgId,targetDigest,templateDigest,proposedContent:returned});
    await window.MimaLocalStore.putHtmlRepairCandidate(candidate);
    return candidate;
  }
  async function applyHtmlRepair(id,msgId,candidateId,dynamicValues={}){
    const c=await window.MimaLocalStore.getHtmlRepairCandidate(id,msgId);
    if(!c||c.id!==candidateId||c.state!=='pending')throw new ApiError('E_HTML_REPAIR_CANDIDATE_MISSING','候选不存在或已经结算。');
    // Read current canonical, not an obsolete UI snapshot; stale tabs fail closed.
    state=normalizeState(await window.MimaLocalStore.loadState());
    const session=getSession(id),message=session?.messages.find(x=>x.id===msgId);
    if(!message||message.role!=='assistant'||(message.branchId||'main')!==c.branchId||arr(message.versions).length!==c.baseMessageVersion||
      await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions})!==c.baseContentDigest)
      throw new ApiError('E_HTML_REPAIR_CAS_STALE','消息或支线已经变化，禁止用过期修复覆盖。');
    const contract=session.promptSettings?.outputContract||{},template=session.messages.find(x=>x.id===c.templateMessageId);
    if(!template||await exactDigest({content:template.content,contract})!==c.templateDigest||await exactDigest(contract)!==c.contractDigest)
      throw new ApiError('E_HTML_REPAIR_TEMPLATE_STALE','模板或结构合同已变化，拒绝旧候选。');
    const validator=window.MimaHtmlStructure;
    let approvedContent;
    if(c.provenance==='ai_reformatted'){
      try{
        const verified=validator.verifyReformat(message.content,c.proposedContent,template.content,contract);
        for(const field of verified.missingFields||[]){if(!Object.hasOwn(dynamicValues,field.key)||!String(dynamicValues[field.key]).trim())throw new Error('E_HTML_REPAIR_DYNAMIC_FIELD_MISSING: '+field.key);}
        // AI's output already matches the exact static skeleton. Substitute
        // only owner-verified dynamic values using the shared validator.
        approvedContent=validator.finalizeWithProse(validator.aiAdmission(message.content,template.content,contract).expectedProse,
          template.content,contract,c.proposedContent,dynamicValues);
      }catch(e){throw new ApiError('E_HTML_AI_RESULT_UNSAFE',String(e.message||e));}
    }else{
      try{approvedContent=validator.finalizeProposal(message.content,template.content,contract,c.proposedContent,dynamicValues);}
      catch(error){throw new ApiError('E_HTML_REPAIR_OWNER_CONFIRMATION_REQUIRED',String(error.message||error));}
    }
    archiveVersion(message,'owner_html_code_repair');
    message.content=approvedContent;message.renderedContent=applyRegexForSession(session,message.content,'display');
    // The raw provider content remains immutable evidence.
    message.isEdited=true;message.metadata={...message.metadata,htmlCodeRepair:{candidateId:c.id,originalRawPreserved:true,approvedAt:nowIso()}};
    message.tokenEstimate=estimateTokens(message.content);session.legacyMemoryQuarantined=true;
    const initialRecordRevision=Number(session.recordRevision)||0;
    const normalized=normalizeSession({...session,updatedAt:nowIso(),recordRevision:initialRecordRevision+1});
    const persisted=clone(state),idx=persisted.sessions.findIndex(x=>x.id===id);
    if(idx<0)throw new ApiError('E_STORY_SESSION_MISSING','剧情已不存在');
    persisted.sessions[idx]=normalized;
    const committed=await window.MimaLocalStore.commitHtmlRepair(persisted,Number(state.storeRevision)||0,id,msgId,c.id,initialRecordRevision);
    state=normalizeState(committed);
    return normalized;
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
    if(msg.role==='assistant'){const manualRecovery=isManuallyRecoveredReply({...version,rawContent:raw});validateStoryReply(raw,{manualRecovery});validateStoryReply(version.content,{manualRecovery});}
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

      if(path==='/setting-templates'&&method==='GET')return ok(state.settingTemplates);
      if(path==='/setting-templates'&&method==='POST')return ok(await editSettingTemplate('save',body||{}));
      if(path==='/setting-templates/default'&&method==='POST')return ok(await editSettingTemplate('default',body||{}));
      let templateRoute=path.match(/^\/setting-templates\/([^/]+)$/);
      if(templateRoute&&method==='PATCH')return ok(await editSettingTemplate('save',{...(body||{}),id:templateRoute[1]}));
      if(templateRoute&&method==='DELETE')return ok(await editSettingTemplate('delete',{...(body||{}),id:templateRoute[1]}));
      if(path==='/sessions'&&method==='GET')return ok(sessionSummaries());
      if(path==='/sessions/full'&&method==='GET')return ok(state.sessions);
      if(path==='/sessions'&&method==='POST'){if(body?.settingTemplateId)return ok(await createSessionUsingTemplate(body));const s=await saveSession(normalizeSession({...body,id:makeId('sess'),createdAt:nowIso(),updatedAt:nowIso(),messages:[]}),{allowCreate:true});return ok(s);}
      if(path==='/sessions/import'&&method==='POST'){const s=normalizeSession({...body,id:makeId('sess'),title:`${text(body?.title||'导入剧情')} · 导入`,createdAt:nowIso(),updatedAt:nowIso()});return ok(await saveSession(s,{allowCreate:true}));}
      let m=path.match(/^\/sessions\/([^/]+)$/);if(m&&method==='GET'){const s=getSession(m[1]);return s?ok(s):fail('未找到剧本');}
      if(m&&method==='PATCH'){const s=getSession(m[1]);return s?ok(await saveSession({...s,...body,id:s.id,createdAt:s.createdAt})):fail('未找到剧本');}
      if(m&&method==='DELETE'){const before=state.sessions.length;state.sessions=state.sessions.filter(x=>x.id!==m[1]);await persist();return ok({deleted:state.sessions.length<before});}
      m=path.match(/^\/sessions\/([^/]+)\/chat$/);if(m&&method==='POST')return ok(await processStoryTurn(m[1],body?.text,body?.action||'send',signal,body?.temperature,{directorNote:body?.directorNote||'',targetMessageId:body?.targetMessageId||null,diagnosticTurnId:body?.diagnosticTurnId||'',diagnosticTraceId:body?.diagnosticTraceId||'',regenerationContext:body?.regenerationContext||'original',retryParameters:body?.retryParameters==='current'?'current':'original'},progress));
      m=path.match(/^\/sessions\/([^/]+)\/recover-reply$/);if(m&&method==='POST')return ok(await restoreRejectedReply(m[1],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/recover-reply\/html-repair$/);if(m&&method==='POST')return ok(await prepareRejectedHtmlRepair(m[1],body?.diagnosticId));
      m=path.match(/^\/sessions\/([^/]+)\/prompt-preview$/);if(m&&method==='POST'){state=normalizeState(await window.MimaLocalStore.loadState());return ok(previewPrompt(m[1],body||{}));}
      m=path.match(/^\/sessions\/([^/]+)\/opening$/);if(m&&method==='POST')return ok(await addOpening(m[1],body?.content||''));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair$/);if(m&&method==='POST')return ok(await prepareHtmlRepair(m[1],m[2]));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair\/approve$/);if(m&&method==='POST')return ok(await applyHtmlRepair(m[1],m[2],body?.candidateId,body?.dynamicValues||{}));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair\/ai$/);if(m&&method==='POST')return ok(await prepareAiHtmlRepair(m[1],m[2],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)$/);if(m&&method==='PATCH')return ok(await editMessage(m[1],m[2],body?.content,{truncateAfter:!!body?.truncateAfter}));
      if(m&&method==='DELETE')return ok(await deleteMessage(m[1],m[2]));
      m=path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/versions\/(\d+)\/restore$/);if(m&&method==='POST')return ok(await restoreMessageVersion(m[1],m[2],Number(m[3]),body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory$/);if(m&&method==='PATCH')return ok(await updateManualMemory(m[1],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/plan$/);if(m&&method==='POST')return ok(await previewMemoryPlan(body?.kind==='facts'?'facts':'core',m[1],body?.options||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/core$/);if(m&&method==='POST')return ok(await runRecordedMemory('core',m[1],body||{},signal,progress));
      if(m&&method==='DELETE')return ok(await deleteCoreMemory(m[1]));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/rolling\/plan$/);if(m&&method==='POST')return ok(await previewMemoryPlan('rolling',m[1],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/rolling\/run$/);if(m&&method==='POST')return ok(await runRecordedMemory('rolling',m[1],body||{},signal,progress));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/rolling$/);if(m&&method==='POST'){const result=await window.MimaLocalStore.updateRollingMemory(m[1],body?.action||'revoke');await init();return ok(getSession(m[1])||result);}
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts\/merge-plan$/);if(m&&method==='POST')return ok(await previewFactMerge(m[1],{...(body||{}),planOnly:true},signal,null));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts\/merge-preview$/);if(m&&method==='POST')return ok(await previewFactMerge(m[1],body||{},signal,progress));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts\/merge-commit$/);if(m&&method==='POST')return ok(await commitFactMerge(m[1],body||{}));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts\/merge-undo$/);if(m&&method==='POST')return ok(await undoFactMerge(m[1]));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts$/);if(m&&method==='POST')return ok(await runRecordedMemory('facts',m[1],body||{},signal,progress));
      if(m&&method==='DELETE')return ok(await deleteFactMemory(m[1]));
      m=path.match(/^\/sessions\/([^/]+)\/memory\/facts\/([^/]+)$/);if(m&&method==='PATCH')return ok(await editFactMemory(m[1],m[2],body?.content));
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
  async function prepareLibraryImport(raw,{templatePolicy='replace'}={}){
    const verified=validateLibrary(raw);
    if(!['replace','preserve','merge'].includes(templatePolicy))throw new ApiError('E_TEMPLATE_IMPORT_POLICY','未知的模板恢复策略，未写入资料库');
    // A fresh verified read is mandatory. Never take preservation templates from
    // a stale in-memory state or reinterpret an unreadable library as empty.
    const before=normalizeState(await window.MimaLocalStore.loadState());
    const next=normalizeState(verified);
    if(templatePolicy==='preserve')next.settingTemplates=clone(before.settingTemplates);
    if(templatePolicy==='merge'){
      const combined=new Map(before.settingTemplates.map(t=>[t.id,t]));
      for(const incoming of next.settingTemplates){
        const old=combined.get(incoming.id);
        if(old&&JSON.stringify(old)!==JSON.stringify(incoming))throw new ApiError('E_SETTINGS_TEMPLATE_CONFLICT','恢复模板 ID 冲突，未静默覆盖任何模板：'+incoming.id);
        combined.set(incoming.id,incoming);
      }
      next.settingTemplates=[...combined.values()];
    }
    if(templatePolicy!=='replace'&&next.settingTemplates.filter(t=>t.isDefault).length>1)
      throw new ApiError('E_SETTINGS_TEMPLATE_DEFAULT_CONFLICT','当前与备份同时含默认模板，请选择保留或完整覆盖，未写入');
    // Preserving a template but losing its referenced preset/worldbook/mask/CSS
    // is not preservation. Reject the complete restore without touching History.
    if(templatePolicy!=='replace')for(const template of next.settingTemplates){
      const missing=templateMissing(next,template.config);
      if(missing.length)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING_RESOURCES',
        '恢复后模板依赖缺失，整份备份未写入：'+template.name,{details:JSON.stringify(missing)});
    }
    next.storeRevision=before.storeRevision;
    return {next,beforeRevision:before.storeRevision,templatePolicy};
  }
  async function previewLibraryImport(raw,options={}){
    const plan=await prepareLibraryImport(raw,options);
    return {valid:true,templatePolicy:plan.templatePolicy,sourceRevision:plan.beforeRevision,templateCount:plan.next.settingTemplates.length};
  }
  async function importLibrary(raw,options={}){
    const plan=await prepareLibraryImport(raw,options);
    // The final CAS is the authority. A second tab may commit after preflight.
    state=plan.next;
    try{await persist();}catch(e){state=normalizeState(await window.MimaLocalStore.loadState());throw e;}
    // The canonical transaction has already committed. A rendering error must
    // not be reported as a failed import (nor trigger rollback of other stores).
    let importWarnings=[];
    try{window.MimaThemeEngine?.apply?.(state.themeSettings);}catch(e){
      importWarnings.push('资料库已经提交，但主题应用失败：'+(e?.message||'unknown'));
      console.error('E_THEME_APPLY_AFTER_CANONICAL_COMMIT',e);
    }
    return {...clone(state),...(importWarnings.length?{importWarnings}:{})};
  }

  window.MimaMemoryContracts=Object.freeze({normalizeManualMemory});
  window.MimaStandalone={init,handle,previewMemoryPlan,memorySourceParts,memoryWorkPlan,runRecordedMemory,memorySourceFingerprint,memoryFactSignature,manualReplyFingerprint,isManuallyRecoveredReply,getApiConfig,saveApiConfig,buildEndpoints,listModels,listModelsWithConfig,testApi,callModel,callModelWithConfig,validateStoryReply,classifyStoryReply,applyRegexForSession,resolveMacrosForSession,compileUserInputForPrompt,exportLibrary,importLibrary,previewLibraryImport,validateLibrary,assemble,getLastUsage,getState:()=>clone(state)};
})();
