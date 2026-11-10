/**
 * 🍷 咪嘛馆 Standalone Core
 * 浏览器本地 Story DB + Prompt Assembler + OpenAI-compatible API client。
 * 与 MIMAMAO Telegram / 宅邸后端完全隔离。
 */
(() => {
  'use strict';

  const API_CONFIG_KEY = 'MIMAMAO_TAVERN_STANDALONE_API_V1';
  let state = { storeRevision: 0, schemaVersion: 4, sessions: [], masks: [], presets: [], worldbooks: [], cssPresets: [], cssCategoriesV1: [], resourceCategoriesV1:{presets:[],worldbook:[]}, regexPacks: [], theaterCards: [], quickCommands: [], settingTemplates: [], novelProjects: [], themeSettings:{theme:'default',updatedAt:''} };
  let lastUsage = null; // v1.1.4: upstream usage/cache telemetry only; never treated as canonical story data.
  // A live attempt in this JS realm must never be settled by recovery while its
  // own model call or canonical commit is still in progress.
  const inFlightStoryAttempts=new Set();
  // Emergency copies survive view changes when IndexedDB cannot save a return.
  // They are deliberately page-local, and the draft UI explains the limitation.
  const volatileHtmlRepairDrafts = new Map();
  const htmlDraftKey = (sessionId,messageId) => JSON.stringify([sessionId,messageId]);

  const nowIso = () => new Date().toISOString();
  const stableRecordCreatedAt = x => x.createdAt || x.updatedAt || (x.id ? '' : nowIso());
  function stableLegacyId(prefix,seed){const h=fingerprint(seed).split(':')[1];return prefix+'_'+h;}
  const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const arr = v => Array.isArray(v) ? v : [];
  const text = v => String(v ?? '').replace(/\uFFFD+/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const list = v => arr(v).map(text).filter(Boolean);
  function worldbookKeywords(value,field,useRegex=false){
    if(value===undefined||value===null||value==='')return [];
    if(Array.isArray(value))return list(value);
    if(typeof value==='string'){
      // SillyTavern exports sometimes use one comma-separated string instead of an array.
      // A regex containing a comma is one expression, never split its grammar.
      return (useRegex?[value]:value.split(/[,，\r\n]/)).map(text).filter(Boolean);
    }
    throw new ApiError('E_WORLDBOOK_KEYWORDS_INVALID',`世界书 ${field} 必须为字符串或字符串数组，未保存不兼容的关键词。`);
  }
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
  // SHA-256 of the actual CSS bytes (not an updatedAt-only hint). The digest is
  // checked against the canonical CSS record inside the same IndexedDB CAS
  // transaction as selection. Synchronous hashing is necessary because an IDB
  // readwrite transaction cannot await crypto.subtle without losing ownership.
  const cssShaK=[
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function cssSha256(source){
    const data=new TextEncoder().encode(String(source??'')),len=data.length;
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const words=new Uint32Array(64),blocks=Math.ceil((len+9)/64);
    const rot=(x,n)=>(x>>>n)|(x<<(32-n));
    for(let block=0;block<blocks;block++){
      for(let i=0;i<16;i++){
        let v=0;for(let j=0;j<4;j++){
          const k=block*64+i*4+j;
          const b=k<len?data[k]:k===len?0x80:k>=blocks*64-8?(k<blocks*64-4?((Math.floor(len/0x20000000)>>>((blocks*64-5-k)*8))&255):(((len*8)>>>((blocks*64-1-k)*8))&255)):0;
          v=(v<<8)|b;
        }words[i]=v>>>0;
      }
      for(let i=16;i<64;i++){
        const x=words[i-15],y=words[i-2];
        const a=rot(x,7)^rot(x,18)^(x>>>3),b=rot(y,17)^rot(y,19)^(y>>>10);
        words[i]=(words[i-16]+a+words[i-7]+b)>>>0;
      }
      let [a,b,c,d,e,f,g,z]=h;
      for(let i=0;i<64;i++){
        const s1=rot(e,6)^rot(e,11)^rot(e,25),choose=(e&f)^(~e&g);
        const t1=(z+s1+choose+cssShaK[i]+words[i])>>>0;
        const s0=rot(a,2)^rot(a,13)^rot(a,22),majority=(a&b)^(a&c)^(b&c);
        const t2=(s0+majority)>>>0;
        z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      for(const [i,v] of [a,b,c,d,e,f,g,z].entries())h[i]=(h[i]+v)>>>0;
    }
    return h.map(x=>x.toString(16).padStart(8,'0')).join('');
  }
  function cssSelectionIdentity(p){
    if(!p)return null;
    return JSON.stringify(['css-selection-sha256-v1',p.id||'',cssSha256(p.css),p.scope||'',p.surface||'',p.atelierReleaseKey||'',p.updatedAt||'']);
  }
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
      time: msg.time || '', mode: msg.mode || 'story_mode', emotion: msg.emotion || null,
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
        structureMode:input.outputContract.structureMode==='three_part_html_status'?'three_part_html_status':'legacy',
        strictValues:input.outputContract.strictValues===true,
        strictTemplatePath:input.outputContract.strictTemplatePath===true,
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
    const createdAt = s.createdAt || s.updatedAt || (s.id ? '' : nowIso());
    return {
      id: s.id || makeId('sess'), recordRevision:Math.max(0,Number(s.recordRevision)||0), title: text(s.title || '未命名咪嘛宇宙'), createdAt,
      updatedAt: s.updatedAt || createdAt, mode: 'tavern', characterMode: 'tavern',
      loadedUserMaskId: s.loadedUserMaskId || null, loadedCharMaskId: s.loadedCharMaskId || null,
      enabledPersonaSources: { sandalphonPersona: false, userPersona: false, telegramContext: false, longTermMemory: false, sandalphonState: false },
      enabledContextSources: { storySummary: true, recentMessages: true, telegramContext: false, vectorMemory: false },
      worldbookIds: list(s.worldbookIds), presetIds: list(s.presetIds), theaterCardIds:list(s.theaterCardIds), openingId: s.openingId || null,
      canonLevel: s.canonLevel || 'alternate', status: s.status || 'active',
      messages: arr(s.messages).map((msg,index)=>normalizeMessage({...msg,id:msg.id||stableLegacyId('legacy_msg',JSON.stringify([s.id||s.title||'',index,msg]))})),
      pendingGeneration: s.pendingGeneration&&typeof s.pendingGeneration==='object'?clone(s.pendingGeneration):null,
      lastGeneration: s.lastGeneration&&typeof s.lastGeneration==='object'?clone(s.lastGeneration):null,
      legacyMemoryQuarantined:s.legacyMemoryQuarantined===true, promptLineageProjection:s.promptLineageProjection===true, archivedBranches: arr(s.archivedBranches), deletedMessages: arr(s.deletedMessages).map((msg,index)=>normalizeMessage({...msg,id:msg.id||stableLegacyId('legacy_deleted_msg',JSON.stringify([s.id||s.title||'',index,msg]))})),
      summary: text(s.summary), rollingSummary: text(s.rollingSummary || s.summary), longSummary: text(s.longSummary),
      sceneSummary: text(s.sceneSummary), characterPsychSummary: text(s.characterPsychSummary), relationshipSummary: text(s.relationshipSummary),
      unresolvedHooks: list(s.unresolvedHooks), pinnedFacts: list(s.pinnedFacts),
      rollingArchive:arr(s.rollingArchive).map(a=>clone(a)),
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
    const createdAt = stableRecordCreatedAt(m);
    const type = text(m.type || m.kind || 'character') === 'user' ? 'user' : 'character';
    // An explicitly cleared Persona is different from an old card with no
    // content field. Never trim or replace the author's original rich text.
    const content=Object.prototype.hasOwnProperty.call(m,'content')?m.content:
      Object.prototype.hasOwnProperty.call(m,'persona')?m.persona:m.description;
    return {
      id: m.id || makeId('mask'), type, name: text(m.name || '未命名面具'), source: text(m.source || 'manual'),
      description: String(m.description ?? ''), content: String(content ?? ''), scenario: String(m.scenario ?? ''),
      firstMessage: String(m.firstMessage ?? m.first_mes ?? ''), exampleDialogue: String(m.exampleDialogue ?? m.mes_example ?? ''),
      creatorNotes: String(m.creatorNotes ?? m.creator_notes ?? ''), remark: String(m.remark ?? ''), avatar: text(m.avatar), aliases: list(m.aliases), tags: list(m.tags),
      enabled: m.enabled !== false, createdAt, updatedAt: m.updatedAt || createdAt
    };
  }

  function normalizePreset(p = {}) {
    const createdAt = stableRecordCreatedAt(p);
    return { id: p.id || makeId('preset'), name: text(p.name || '未命名预设'), type: text(p.type || 'style'),
      description: text(p.description), content: String(p.content??''), category:text(p.category||'未分类').slice(0,60), favorite:!!p.favorite, priority: Number.isFinite(Number(p.priority)) ? Number(p.priority) : 50,
      enabled: p.enabled !== false, createdAt, updatedAt: p.updatedAt || createdAt };
  }

  function normalizeCssPreset(p = {}) {
    const createdAt = stableRecordCreatedAt(p);
    const legacyScope=['story','global','app'].includes(p.scope)?p.scope:(['novel','assistant','chat'].includes(p.scope)?p.scope:'story');
    const inferredSurface=legacyScope==='app'?'global':(legacyScope==='novel'?'novel':(legacyScope==='assistant'?'assistant':'chat'));
    const surface=['global','chat','novel','assistant'].includes(p.surface)?p.surface:inferredSurface;
    return { id:p.id || makeId('css'), name:text(p.name || '未命名 CSS'), css:String(p.css || ''), scope:legacyScope, surface, category:text(p.category||'未分类').slice(0,60), favorite:!!p.favorite, atelierReleaseKey:/^css-release:[a-zA-Z0-9:_-]{1,180}$/.test(String(p.atelierReleaseKey||''))?p.atelierReleaseKey:'', createdAt, updatedAt:p.updatedAt || createdAt };
  }

  function normalizeWorldbookEntry(e = {}) {
    const createdAt = stableRecordCreatedAt(e);
    return { id: e.id || makeId('wbe'), name: text(e.name || '未命名条目'), content: String(e.content ?? ''),
      keywords: worldbookKeywords(e.keywords ?? e.key ?? e.keys,'keywords',!!e.useRegex),
      secondaryKeywords: worldbookKeywords(e.secondaryKeywords ?? e.keysecondary,'secondaryKeywords',!!e.useRegex), enabled: e.enabled !== false,
      alwaysActive: !!e.alwaysActive, matchMode: e.matchMode === 'all' ? 'all' : 'any', caseSensitive: !!e.caseSensitive,
      useRegex: !!e.useRegex, priority: Number.isFinite(Number(e.priority)) ? Number(e.priority) : 50,
      scanDepth: clampInt(e.scanDepth, 1, 200, 12), depth: clampInt(e.depth, 0, 200, 0),
      position: ['front','middle','back'].includes(e.position) ? e.position : 'middle',
      maxChars: clampInt(e.maxChars, 0, 100000, 0), createdAt, updatedAt: e.updatedAt || createdAt };
  }


  function normalizeRegexPack(p = {}) {
    if (window.MimaRegexEngine?.normalizePack) return window.MimaRegexEngine.normalizePack(p);
    const createdAt = stableRecordCreatedAt(p);
    return { id:p.id||makeId('regexp'), name:text(p.name||'未命名正则包'), description:text(p.description), priority:Number.isFinite(Number(p.priority))?Number(p.priority):50, enabled:p.enabled!==false, rules:arr(p.rules), createdAt, updatedAt:p.updatedAt||createdAt };
  }

  function normalizeWorldbook(w = {}) {
    const createdAt = stableRecordCreatedAt(w);
    return { id: w.id || makeId('wb'), name: text(w.name || '未命名世界书'), description: text(w.description),
      enabled: w.enabled !== false, entries: arr(w.entries).map((entry,index)=>normalizeWorldbookEntry({...entry,id:entry.id||stableLegacyId('legacy_wbe',JSON.stringify([w.id||w.name,index,entry])),createdAt:entry.createdAt||entry.updatedAt||w.createdAt||w.updatedAt||''})), tags: list(w.tags), category:text(w.category||'未分类').slice(0,60), favorite:!!w.favorite,
      createdAt, updatedAt: w.updatedAt || createdAt };
  }

  // Configuration templates have no History, generated Memory, source cursor,
  // running jobs, API credentials, character reply or owner private notes.
  const templateFields=['presetIds','worldbookIds','regexPackIds','theaterCardIds','loadedUserMaskId','customCssId','customCssEnabled','promptSettings','renderMode','memoryInject'];
  function normalizeSettingTemplate(t={}){
    const raw=t.config&&typeof t.config==='object'&&!Array.isArray(t.config)?t.config:{};
    const config={};
    for(const key of templateFields)if(Object.prototype.hasOwnProperty.call(raw,key)){
      if(['presetIds','worldbookIds','regexPackIds','theaterCardIds'].includes(key))config[key]=list(raw[key]);
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
      revision:Math.max(0,Number(t.revision)||0),isDefault:t.isDefault===true,config,createdAt:String(t.createdAt||t.updatedAt||(t.id?'':nowIso())),updatedAt:String(t.updatedAt||t.createdAt||(t.id?'':nowIso()))};
  }
  function templateFromSession(session,include={}){
    const c={};
    if(include.presets!==false)c.presetIds=list(session.presetIds);
    if(include.worldbooks!==false)c.worldbookIds=list(session.worldbookIds);
    if(include.regex!==false)c.regexPackIds=list(session.regexPackIds);
    c.theaterCardIds=list(session.theaterCardIds);
    if(include.userMask===true)c.loadedUserMaskId=session.loadedUserMaskId||null;
    if(include.css===true){c.customCssId=session.customCssId||null;c.customCssEnabled=session.customCssEnabled!==false;}
    if(include.context!==false){c.promptSettings=clone(session.promptSettings);if(c.promptSettings.outputContract)c.promptSettings.outputContract.templateMessageId='';c.promptSettings.autoRollingEnabled=false;c.promptSettings.summaryEnabled=false;c.renderMode=session.renderMode;}
    if(include.memoryInject===true)c.memoryInject={injectCore:session.manualMemory.settings.injectCore,injectFacts:session.manualMemory.settings.injectFacts};
    return normalizeSettingTemplate({config:c}).config;
  }
  function templateMissing(state,c){const missing=[];
    const refs=[['presetIds','presets'],['worldbookIds','worldbooks'],['regexPackIds','regexPacks'],['theaterCardIds','theaterCards']];
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
  function legacyRoot(table,prefix,normalizer){
    return arr(table).map((record,index)=>normalizer(record.id?record:{...record,id:stableLegacyId(prefix,JSON.stringify([index,record]))}));
  }
  // NovelEngine is intentionally unchanged: stabilize only missing legacy
  // fields *at the persistence read boundary* (not the creation APIs).
  function stableLegacyNovel(p,index){
    const id=p.id||stableLegacyId('legacy_novel',JSON.stringify([index,p]));
    const stamp=p.createdAt||p.updatedAt||'';
    const chapters=(arr(p.chapters).length?arr(p.chapters):[{title:'正文',order:0,segments:[]}]).map((chapter,ci)=>{
      const cid=chapter.id||stableLegacyId('legacy_chapter',JSON.stringify([id,ci,chapter]));
      return {...chapter,id:cid,createdAt:chapter.createdAt||chapter.updatedAt||stamp,updatedAt:chapter.updatedAt||chapter.createdAt||stamp,
        segments:arr(chapter.segments).map((segment,si)=>({ ...segment,
          id:segment.id||stableLegacyId('legacy_segment',JSON.stringify([cid,si,segment])),
          createdAt:segment.createdAt||segment.updatedAt||chapter.createdAt||stamp,updatedAt:segment.updatedAt||segment.createdAt||chapter.createdAt||stamp }))};
    });
    return {...p,id,createdAt:stamp,chapters,
      drafts:arr(p.drafts).map((draft,di)=>({...draft,id:draft.id||stableLegacyId('legacy_draft',JSON.stringify([id,di,draft])),createdAt:draft.createdAt||draft.updatedAt||stamp})),
      generations:arr(p.generations).map((g,gi)=>({...g,id:g.id||stableLegacyId('legacy_generation',JSON.stringify([id,gi,g])),startedAt:g.startedAt||stamp}))};
  }
  function theaterAccess(value={},strict=false){
    const origins=[];
    for(const entry of arr(value?.origins))try{
      const u=new URL(String(entry));
      if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid origin');
      if(!origins.includes(u.origin))origins.push(u.origin);
    }catch(e){if(strict)throw new ApiError('E_THEATER_ORIGIN','联网来源请填写完整 HTTPS 来源，如 https://example.com；不能含路径、通配符或账号');}
    if(origins.length>32)throw new ApiError('E_THEATER_ORIGIN','每个素材最多授权 32 个 HTTPS 来源');
    const runScripts=value?.runScripts===true;
    if(strict&&value?.readMessages===true&&!runScripts)throw new ApiError('E_THEATER_SCRIPT_TRUST','读取原文前，需要先明确授权此源码的脚本执行与联网能力');
    return {runScripts,readMessages:runScripts&&value?.readMessages===true,origins};
  }
  function normalizePlayResource(p={},kind='command'){
    const createdAt=stableRecordCreatedAt(p);
    return {id:p.id||makeId(kind==='theater'?'theater':'command'),name:text(p.name)||(kind==='theater'?'未命名小剧场':'未命名指令'),
      content:String(p.content??''),enabled:p.enabled!==false,category:text(p.category),
      ...(kind==='theater'?{kind:p.kind==='js'?'js':'html',access:theaterAccess(p.access)}:{mode:p.mode==='fill'?'fill':'send'}),
      sourceData:String(p.sourceData??''),createdAt,updatedAt:p.updatedAt||createdAt};
  }
  async function savePlayResource(table,body,id=null){
    const old=id?state[table].find(p=>p.id===id):null;
    if(id&&!old)throw new ApiError('E_CANONICAL_STALE','该资料已删除，未用旧编辑重新创建');
    if(typeof body?.content!=='string'||!body.content.trim())throw new ApiError('E_PLAY_RESOURCE_EMPTY','内容不能为空');
    const kind=table==='theaterCards'?'theater':'command';
    if(kind==='theater'&&body.kind!==undefined&&!['html','js'].includes(body.kind))throw new ApiError('E_PLAY_RESOURCE_KIND','小剧场类型必须是 HTML 或 JS');
    if(kind==='command'&&body.mode!==undefined&&!['send','fill'].includes(body.mode))throw new ApiError('E_PLAY_RESOURCE_MODE','指令动作必须是直接发送或仅填入');
    const value=normalizePlayResource({...old,...body,id:old?.id||makeId(kind),createdAt:old?.createdAt||nowIso(),updatedAt:nowIso()},kind);
    if(kind==='theater')value.access=body.accessGrant?theaterAccess(body.accessGrant,true):
      old&&old.content===value.content&&old.kind===value.kind?theaterAccess(old.access):theaterAccess();
    return commitResource(table,value,body.updatedAt);
  }
  async function importPlayResources(body){
    for(const key of ['theaterCards','quickCommands'])if(body?.[key]!==undefined&&!Array.isArray(body[key]))throw new ApiError('E_PLAY_IMPORT_INVALID','导入集合必须为数组，资料库未更改');
    const theaters=arr(body?.theaterCards),commands=arr(body?.quickCommands);
    if(!theaters.length&&!commands.length)throw new ApiError('E_PLAY_IMPORT_EMPTY','没有可导入的小剧场或指令');
    const prepare=(rows,kind)=>rows.map(p=>{if(!p||typeof p.content!=='string'||!p.content.trim()||kind==='theater'&&!['html','js'].includes(p.kind)||kind==='command'&&p.mode!==undefined&&!['send','fill'].includes(p.mode))throw new ApiError('E_PLAY_IMPORT_INVALID','导入内容或类型无效，资料库未更改');return normalizePlayResource({...p,access:{},id:makeId(kind),createdAt:nowIso(),updatedAt:nowIso()},kind);});
    const nextTheaters=prepare(theaters,'theater'),nextCommands=prepare(commands,'command');
    return commitLibraryEdit(stored=>{stored.theaterCards.push(...nextTheaters);stored.quickCommands.push(...nextCommands);return {theaterCards:clone(nextTheaters),quickCommands:clone(nextCommands)};});
  }
  function normalizeCategoryRecords(raw){return (Array.isArray(raw)?raw:[]).map(x=>({id:x.id,name:x.name,createdAt:x.createdAt||''}));}
  function normalizedCategoryGroups(raw){return {presets:normalizeCategoryRecords(raw?.presets),worldbook:normalizeCategoryRecords(raw?.worldbook)};}
  function normalizeState(raw = {}) {
    return {
      schemaVersion: 4, storeRevision: Math.max(0,Number(raw.storeRevision)||0),
      __resourceSignature:typeof raw.__resourceSignature==='string'?raw.__resourceSignature:null,
      __appearanceRevision:(()=>{const stamp=String(raw.__resourceSignature||'');
        if(/^\d+:\d+:\d+:\d+$/.test(stamp)){const n=Number(stamp.split(':')[1]);if(Number.isSafeInteger(n))return n;}
        return Number.isSafeInteger(raw.__appearanceRevision)?raw.__appearanceRevision:null;})(),
      sessions: legacyRoot(raw.sessions,'legacy_session',normalizeSession), masks: legacyRoot(raw.masks,'legacy_mask',normalizeMask),
      presets: legacyRoot(raw.presets,'legacy_preset',normalizePreset), worldbooks: legacyRoot(raw.worldbooks,'legacy_worldbook',normalizeWorldbook), cssPresets: legacyRoot(raw.cssPresets,'legacy_css',normalizeCssPreset),
      cssCategoriesV1:normalizeCategoryRecords(raw.cssCategoriesV1),resourceCategoriesV1:normalizedCategoryGroups(raw.resourceCategoriesV1),
      regexPacks: legacyRoot(raw.regexPacks,'legacy_regexpack',normalizeRegexPack),
      theaterCards:legacyRoot(raw.theaterCards,'legacy_theater',p=>normalizePlayResource(p,'theater')),quickCommands:legacyRoot(raw.quickCommands,'legacy_command',p=>normalizePlayResource(p,'command')),settingTemplates:legacyRoot(raw.settingTemplates,'legacy_template',normalizeSettingTemplate),
      novelProjects: arr(raw.novelProjects).map((p,index)=>{const x=stableLegacyNovel(p,index);return window.MimaNovelEngine?.normalizeProject?window.MimaNovelEngine.normalizeProject(x):x;}),
      sessionOrganizationV1:raw.sessionOrganizationV1??null,
      themeSettings: window.MimaThemeEngine?.normalizeSettings?window.MimaThemeEngine.normalizeSettings(raw.themeSettings||{}):{theme:'default',updatedAt:'',...(raw.themeSettings||{})}
    };
  }

  // Canonical edits never mutate a shared global object before the IDB commit.
  // Serialize with story saves; each task reads the latest verified record, edits
  // a detached copy and publishes to RAM only after the CAS transaction finishes.
  const NO_LIBRARY_WRITE = Symbol('no-library-write');
  function commitLibraryEdit(edit){
    const commit=async()=>{
      try{
        const stored=normalizeState(await window.MimaLocalStore.loadState());
        const result=edit(stored);
        if(result&&result[NO_LIBRARY_WRITE]===true){state=stored;return result.value;}
        const committed=await window.MimaLocalStore.saveState(stored,stored.storeRevision);
        state={...stored,storeRevision:committed.storeRevision,
          __resourceSignature:null,__appearanceRevision:committed.storeRevision};
        return result;
      }catch(error){
        // A real CAS refusal must not leave obsolete resources on screen. The
        // failed proposal has never touched state, and a verified reload may
        // safely expose the current winner without disguising the failure.
        try{state=normalizeState(await window.MimaLocalStore.loadState());}
        catch(readError){console.error('E_CANONICAL_REFRESH_FAILED_AFTER_WRITE',readError);}
        throw error;
      }
    };
    const task=sessionSaveTail.then(commit,commit);
    sessionSaveTail=task.then(()=>{},()=>{});
    return task;
  }
  const categorySpec={css:['cssPresets','cssCategoriesV1'],presets:['presets','presets'],worldbook:['worldbooks','worldbook']};
  function categoryEntries(stored,kind){return kind==='css'?stored.cssCategoriesV1:stored.resourceCategoriesV1[kind];}
  function categoryResources(stored,kind){return stored[categorySpec[kind][0]];}
  function categoryView(stored,kind){
    const registered=categoryEntries(stored,kind);const seen=new Set(registered.map(x=>x.name));
    return [...registered.map(x=>({...x})),...[...new Set(categoryResources(stored,kind).map(x=>x.category||'未分类'))].filter(name=>name!=='未分类'&&!seen.has(name)).map(name=>({id:'legacy:'+name,name,legacy:true}))];
  }
  async function changeCategories(kind,body){
    if(!categorySpec[kind])throw new ApiError('E_CATEGORY_KIND','未知分类类型');
    const action=body?.action,expected=kind==='css'?body?.expectedAppearanceRevision:body?.expectedRevision;
    const execute=stored=>{
      // CSS uses the appearance overlay; other resources use the canonical state.
      // This check executes inside the same IDB readwrite transaction as the edit.
      if(!Number.isSafeInteger(expected)||expected<0||stored.storeRevision!==expected)
        throw new ApiError('E_CATEGORY_STALE','分类库已变化，请刷新后重试');
      const records=categoryEntries(stored,kind),items=categoryResources(stored,kind);
      const nameOf=x=>String(x||'').trim();const old=nameOf(body?.oldName),name=nameOf(body?.name);
      const existing=new Set([...records.map(x=>x.name),...items.map(x=>x.category||'未分类')]);
      if(['create','rename'].includes(action)){
        if(!name||name.length>60||name==='未分类')throw new ApiError('E_CATEGORY_NAME','分类名称必须为 1～60 字且不能使用保留名称');
        if([...existing].some(x=>x.toLocaleLowerCase()===name.toLocaleLowerCase()&&x!==old))throw new ApiError('E_CATEGORY_DUPLICATE','已经存在同名分类');
      }
      if(action==='create'){records.push({id:makeId('category'),name,createdAt:nowIso()});}
      else if(action==='rename'||action==='delete'){
        if(!old||old==='未分类'||!existing.has(old))throw new ApiError('E_CATEGORY_MISSING','分类已经消失，请刷新');
        if(action==='rename'&&name===old)return {changed:0,items:0};
        const idx=records.findIndex(x=>x.name===old);
        if(idx>=0){if(action==='delete')records.splice(idx,1);else records[idx].name=name;}
        else if(action==='rename')records.push({id:makeId('category'),name,createdAt:nowIso()});
        for(const item of items)if(item.category===old)item.category=action==='delete'?'未分类':name;
      }else if(action==='move'){
        const ids=body?.ids;
        if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw new ApiError('E_CATEGORY_ITEMS','未选择有效的移动项目');
        if(name!=='未分类'&&!existing.has(name))throw new ApiError('E_CATEGORY_MISSING','目标分类不存在');
        const selectedIds=new Set(ids),existingIds=new Set(items.map(item=>item.id));
        if(ids.some(id=>!existingIds.has(id)))throw new ApiError('E_CATEGORY_ITEMS','待移动记录已变化，不执行部分移动');
        for(const item of items)if(selectedIds.has(item.id))item.category=name;
      }else throw new ApiError('E_CATEGORY_ACTION','不支持的分类操作');
      return {kind,action,category:name,items:items.length,categories:categoryView(stored,kind)};
    };
    return (kind==='css'?commitAppearanceEdit:commitLibraryEdit)(execute);
  }
  function normalizeAppearance(raw){
    return {...raw,cssPresets:legacyRoot(raw.cssPresets,'legacy_css',normalizeCssPreset),cssCategoriesV1:normalizeCategoryRecords(raw.cssCategoriesV1),
      themeSettings:window.MimaThemeEngine?.normalizeSettings?window.MimaThemeEngine.normalizeSettings(raw.themeSettings||{}):{theme:'default',...(raw.themeSettings||{})}};
  }
  function commitAppearanceEdit(edit,{checkCanonical=null}={}){
    const commit=async()=>{
      let result;
      try{
        const receipt=await window.MimaLocalStore.commitAppearance(raw=>{
          const stored=normalizeAppearance(raw);result=edit(stored);
          if(result&&result[NO_LIBRARY_WRITE]===true){result=result.value;return false;}
          Object.assign(raw,stored);
        },{checkCanonical,withRevision:true});
        // Publish only the global revision proven by the SAME committed IDB tx.
        // Keep the complete resource signature unknown: another tab could have
        // edited presets/templates before this appearance commit, while this
        // window still holds their old bytes. The next resource refresh must
        // not mistake that stale cache for a verified complete snapshot.
        state={...window.MimaLocalStore.mergeAppearance(state,normalizeAppearance(receipt.appearance)),
          storeRevision:receipt.storeRevision,__resourceSignature:null,
          __appearanceRevision:receipt.appearanceRevision};
        return result;
      }catch(error){
        try{
          // A single readonly transaction prevents pairing new appearance bytes
          // with an older/newer global head after a cross-tab concurrent edit.
          const receipt=await window.MimaLocalStore.loadAppearanceWithRevision();
          state={...window.MimaLocalStore.mergeAppearance(state,normalizeAppearance(receipt.appearance)),
            storeRevision:receipt.storeRevision,__resourceSignature:null,
            __appearanceRevision:receipt.appearanceRevision};
        }catch(readError){console.error('E_APPEARANCE_REFRESH_FAILED_AFTER_WRITE',readError);}
        throw error;
      }
    };
    const task=sessionSaveTail.then(commit,commit);sessionSaveTail=task.then(()=>{},()=>{});return task;
  }
  function resourceChanged(a,b){return JSON.stringify(a) !== JSON.stringify(b);}
  function cssRendererChanged(a,b){return ['css','scope','surface','atelierReleaseKey'].some(key=>(a?.[key]||'')!==(b?.[key]||''));}
  function cssHasCanonicalReferences(base,appearance,id){
    // Base and overlay are read in one IDB write transaction with competing
    // session saves. Disabled but retained links are also protected.
    return (base.sessions||[]).some(s=>s.customCssId===id)||
      (base.novelProjects||[]).some(p=>p.appearance?.customCssId===id)||
      (base.settingTemplates||[]).some(t=>t.config?.customCssId===id)||
      appearance.themeSettings?.globalCssPresetId===id;
  }
  function assertResourceFresh(table,id,stored){
    const seen=state[table].find(item=>item.id===id)||null;
    const current=stored[table].find(item=>item.id===id)||null;
    if(resourceChanged(seen,current))throw new ApiError('E_CANONICAL_CONFLICT',
      '资料在其他窗口或任务中发生变化，请刷新后重新编辑：'+table+'/'+id);
    return current;
  }
  function commitResource(table,value,expectedUpdatedAt,expectedPresetToken=undefined){
    const input=clone(value);
    const checkReference=table==='cssPresets'&&state.cssPresets.some(old=>old.id===input.id&&cssRendererChanged(old,input))?
      (base,appearance)=>{
        if(cssHasCanonicalReferences(base,appearance,input.id))
          throw new ApiError('E_CSS_REFERENCED_FORK_REQUIRED','这份 CSS 正被剧情、全局、小说或模板引用；已保护原件，请另存为未启用的新预设');
      }:null;
    const edit=stored=>{
      const current=assertResourceFresh(table,input.id,stored);
      if(current&&expectedUpdatedAt&&String(expectedUpdatedAt)!==String(current.updatedAt||''))
        throw new ApiError('E_CANONICAL_CONFLICT','资源已更新，旧编辑不能覆盖新内容：'+table+'/'+input.id);
      const items=stored[table],index=items.findIndex(x=>x.id===input.id);
      if(index<0)items.push(input);else items[index]=input;
      return clone(input);
    };
    if(table==='presets'){
      // PATCH must bring the editor-open baseline, never borrow a freshly refreshed token.
      if(!(expectedPresetToken===null||typeof expectedPresetToken==='string'))
        throw new ApiError('E_PRESET_BASELINE_REQUIRED','预设编辑已过期：未带打开编辑器时的版本信息，原内容未覆盖');
      const commit=async()=>{
        await refreshPersistedResources();
        const current=state.presets.find(item=>item.id===input.id)||null;
        if(current&&expectedUpdatedAt&&String(expectedUpdatedAt)!==String(current.updatedAt||''))
          throw new ApiError('E_CANONICAL_CONFLICT','资源已更新，旧编辑不能覆盖新内容：presets/'+input.id);
        const saved=await window.MimaLocalStore.commitPreset(input.id,input,state.storeRevision,expectedPresetToken);
        const index=state.presets.findIndex(item=>item.id===input.id);
        const next=state.presets.slice();if(index<0)next.push(input);else next[index]=input;
        state={...state,presets:next,storeRevision:saved.storeRevision,__resourceSignature:null};
        return clone(input);
      };
      const task=sessionSaveTail.then(commit,commit);sessionSaveTail=task.then(()=>{},()=>{});return task;
    }
    return table==='cssPresets'?commitAppearanceEdit(edit,{checkCanonical:checkReference}):commitLibraryEdit(edit);
  }
  function unlinkTemplateResource(db,table,id){
    const mapping={masks:'loadedUserMaskId',presets:'presetIds',worldbooks:'worldbookIds',cssPresets:'customCssId',regexPacks:'regexPackIds',theaterCards:'theaterCardIds'};
    const key=mapping[table];if(!key)return;
    for(const template of db.settingTemplates){
      const config=template.config||{};
      const old=config[key];
      if(Array.isArray(old)){
        if(!old.includes(id))continue;
        config[key]=old.filter(x=>x!==id);
      }else if(old===id){
        config[key]=null;
        if(key==='customCssId')config.customCssEnabled=false;
      }else continue;
      template.revision=(Number(template.revision)||0)+1;
      template.updatedAt=nowIso();
    }
  }
  function deleteResource(table,id,unlink){
    if(table==='cssPresets')return commitAppearanceEdit(stored=>{
      const current=assertResourceFresh(table,id,stored);
      if(!current)return {[NO_LIBRARY_WRITE]:true,value:{deleted:false}};
      stored.cssPresets=stored.cssPresets.filter(item=>item.id!==id);
      if(stored.themeSettings?.globalCssPresetId===id)stored.themeSettings={...stored.themeSettings,globalCssPresetId:null,globalCssEnabled:false};
      if(!stored.deletedCssIds.includes(id)){stored.deletedCssIds.push(id);stored.deletedCssAt={...stored.deletedCssAt,[id]:nowIso()};}
      return {deleted:true,id};
    });
    return commitLibraryEdit(stored=>{
      const current=assertResourceFresh(table,id,stored);
      if(!current)return {[NO_LIBRARY_WRITE]:true,value:{deleted:false}};
      stored[table]=stored[table].filter(item=>item.id!==id);
      unlink?.(stored,id);
      unlinkTemplateResource(stored,table,id);
      return {deleted:true,id};
    });
  }
  // An all-or-nothing operation. Keep stale selections and in-flight reply owners
  // out of the transaction, then let LocalStore recheck canonical revisions.
  async function bulkDeleteCanonical(kind,body={}){
    const ids=body.ids,expectedRevision=body.expectedRevision;
    if(!['css','presets','worldbook','sessions'].includes(kind)||!Array.isArray(ids)||!ids.length||
       ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||
       !Number.isSafeInteger(expectedRevision)||expectedRevision<0)
      throw new ApiError('E_BULK_DELETE_INVALID','请选择有效的资源或剧情；本次没有删除');
    const commit=async()=>{
      // Never cut a running generation off from its canonical owner.
      if(kind==='sessions')for(const attempt of inFlightStoryAttempts){
        let owner=null;try{owner=JSON.parse(attempt).sessionId}catch{}
        if(ids.includes(owner))throw new ApiError('E_BULK_DELETE_GENERATING','选中剧情正在生成，先完成或停止该任务；没有删除任何剧情');
      }
      const saved=await window.MimaLocalStore.commitBulkDelete(kind,ids,expectedRevision);
      // Transaction completion is authoritative. A read failure afterwards is
      // a refresh failure, never evidence the already-committed delete failed.
      try{state=normalizeState(await window.MimaLocalStore.loadState());}
      catch(error){console.error('E_BULK_DELETE_POST_COMMIT_REFRESH',error);
        // Do not return failure, which would invite a repeat destructive request.
        return {...saved,refreshed:false,refreshError:String(error?.message||error)};
      }
      if(kind==='css')try{window.MimaThemeEngine?.apply?.(state.themeSettings);}
        catch(e){console.error('E_THEME_APPLY_AFTER_BULK_DELETE',e);}
      return {...saved,refreshed:true};
    };
    const task=sessionSaveTail.then(commit,commit);
    sessionSaveTail=task.then(()=>{},()=>{});
    return task;
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

  // Session organization is a separate small IDB sidecar, not session.status,
  // archivedBranches, or a full canonical library save.
  async function organizationAction(action){
    const committed=await window.MimaLocalStore.commitSessionOrganization(action,action.expectedRevision);
    state.sessionOrganizationV1=committed;
    return committed;
  }
  function sessionSummaries() {
    return state.sessions.map(s => ({ id:s.id,title:s.title,mode:s.mode,canonLevel:s.canonLevel,status:s.status,updatedAt:s.updatedAt,
      createdAt:s.createdAt,messageCount:s.messages.length,presetIds:s.presetIds,worldbookIds:s.worldbookIds,
      loadedUserMaskId:s.loadedUserMaskId,loadedCharMaskId:s.loadedCharMaskId,regexPackIds:s.regexPackIds }))
      .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  // Keep the tab's other resources and Sessions untouched when publishing a
  // single successful CAS. The selected row is the only History being cloned.
  function publishSession(session,storeRevision=null){
    const i=state.sessions.findIndex(x=>x.id===session.id);
    const previous=i>=0?state.sessions[i]:null;
    if(previous&&Number(previous.recordRevision||0)>Number(session.recordRevision||0))return previous;
    const sessions=state.sessions.slice();
    if(i<0)sessions.push(session);else sessions[i]=session;
    const revision=storeRevision===null?state.storeRevision:Math.max(state.storeRevision,storeRevision);
    state={...state,sessions,storeRevision:revision};
    return session;
  }
  // The durable resource signature consists of four monotone revision counters:
  // base, appearance, presets, templates. A whole-library promotion raises the
  // base to the latest global revision and resets overlays to that base; a
  // targeted resource commit increments exactly its own overlay counter.
  // A Session-only write never advances these four counters.
  const RESOURCE_PUBLICATION_FIELDS=['masks','presets','worldbooks','cssPresets',
    'cssCategoriesV1','resourceCategoriesV1','regexPacks','theaterCards',
    'quickCommands','settingTemplates','novelProjects','themeSettings'];
  function captureResourcePublication(){
    return RESOURCE_PUBLICATION_FIELDS.map(key=>state[key]);
  }
  function resourcePublicationChanged(captured){
    return RESOURCE_PUBLICATION_FIELDS.some((key,i)=>state[key]!==captured[i]);
  }
  function parseResourceSignature(signature){
    if(typeof signature!=='string'||!/^\d+:\d+:\d+:\d+$/.test(signature))return null;
    const values=signature.split(':').map(Number);
    return values.every(n=>Number.isSafeInteger(n)&&n>=0)?values:null;
  }
  // Called synchronously immediately before publishing any snapshot. Never
  // compare a signature as a string or use the global Session storeRevision.
  // true = keep the already published resources; false = publish candidate.
  function rejectLateResourcePublication(captured,incomingSignature){
    if(!resourcePublicationChanged(captured))return false;
    const candidate=parseResourceSignature(incomingSignature);
    const current=parseResourceSignature(state.__resourceSignature);
    if(!candidate||!current)throw new ApiError('E_RESOURCE_REFRESH_CONFLICT',
      '本窗口有尚未同步的资料变更，旧读取未覆盖；请重新执行本次操作');
    const candidateAtLeast=current.every((v,i)=>candidate[i]>=v);
    const currentAtLeast=candidate.every((v,i)=>current[i]>=v);
    if(currentAtLeast)return true; // equal or older: never re-publish it
    if(candidateAtLeast)return false; // strictly newer: do not block a valid update
    // Incomparable component revisions mean storage authority is ambiguous.
    // Do not guess by Promise completion or perform an unbounded retry.
    throw new ApiError('E_RESOURCE_REFRESH_CONFLICT',
      '资料修订来源发生交错，未覆盖已加载资料；请重新执行本次操作');
  }
  async function refreshPersistedSession(id){
    const publicationAtStart=captureResourcePublication();
    const snapshot=await window.MimaLocalStore.loadSessionRecord(id,{withRevision:true});
    let record=snapshot?.session?normalizeSession(snapshot.session):null;
    let resources=null;
    // A global revision includes Session commits. A Session refresh alone must
    // NEVER mark the old Persona/Worldbook/Preset cache as current.
    if(snapshot?.resourceSignature!==state.__resourceSignature){
      // If a newer local commit completed while this snapshot was in flight,
      // re-read rather than publishing older resource bytes to the prompt.
      for(let attempt=0;attempt<2;attempt++){
        resources=normalizeState(await window.MimaLocalStore.loadResourceSnapshot(id));
        if(resources.storeRevision>=state.storeRevision)break;
        if(attempt===1)throw new ApiError('E_RESOURCE_REFRESH_CONFLICT','资料正在更新，旧资料未用于生成，请重新操作');
      }
      record=resources.sessions.find(x=>x.id===id)||null;
    }
    if(resources){
      const head=await window.MimaLocalStore.loadResourceRevision();
      if(head.resourceSignature!==resources.__resourceSignature){
        if(head.resourceSignature!==state.__resourceSignature)
          throw new ApiError('E_RESOURCE_REFRESH_CONFLICT','资源在读取期间发生变化，请重新打开剧情；旧快照未覆盖');
        resources=null;
      }
    }
    if(resources&&rejectLateResourcePublication(publicationAtStart,resources.__resourceSignature))resources=null;
    const sessions=state.sessions.slice(),i=sessions.findIndex(x=>x.id===id);
    const current=i>=0?sessions[i]:null;
    // Never let a late GET erase a Session just published by a newer writer.
    if(record&&current&&Number(current.recordRevision||0)>Number(record.recordRevision||0))record=current;
    if(!record&&current&&Number(state.storeRevision)>Number(resources?.storeRevision??snapshot?.storeRevision??0))record=current;
    if(record){if(i<0)sessions.push(record);else sessions[i]=record;}
    else if(i>=0)sessions.splice(i,1);

    if(resources)state={...state,...resources,sessions,storeRevision:Math.max(state.storeRevision,resources.storeRevision)};
    else state={...state,sessions,storeRevision:Math.max(state.storeRevision,snapshot?.storeRevision??0)};
    return state;
  }
  async function refreshPersistedResources(){
    const publicationAtStart=captureResourcePublication();
    const head=await window.MimaLocalStore.loadResourceRevision();
    if(head.resourceSignature===state.__resourceSignature){
      state={...state,storeRevision:Math.max(state.storeRevision,head.storeRevision)};return state;
    }
    const resources=normalizeState(await window.MimaLocalStore.loadResourceSnapshot());
    // Both asynchronous reads may finish out of order across tabs. The final
    // lightweight IDB head is authoritative, never the completion order.
    const verified=await window.MimaLocalStore.loadResourceRevision();
    if(resources.__resourceSignature!==verified.resourceSignature){
      if(state.__resourceSignature===verified.resourceSignature)return state;
      throw new ApiError('E_RESOURCE_REFRESH_CONFLICT','资料在读取时发生更新，旧资料未覆盖内存；请重新操作');
    }
    if(rejectLateResourcePublication(publicationAtStart,resources.__resourceSignature))return state;
    state={...state,...resources,sessions:state.sessions,
      storeRevision:Math.max(state.storeRevision,resources.storeRevision,verified.storeRevision)};
    return state;
  }
  let sessionSaveTail=Promise.resolve();
  function saveSession(s,{allowCreate=false,signal=null}={}) {
    const requested=clone(s);
    const commit=async()=>{
      try{
        if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
        const normalized=normalizeSession({...requested,updatedAt:nowIso()});
        const expected=Number(normalized.recordRevision)||0;
        const saved=await window.MimaLocalStore.commitSessionRecord(normalized,expected,{allowCreate,signal});
        const session=normalizeSession(saved.session);
        publishSession(session,saved.storeRevision);
        s.recordRevision=session.recordRevision;
        return session;
      }catch(error){
        if(error?.name!=='AbortError')try{await refreshPersistedSession(requested.id);}
        catch(readError){console.error('E_STORY_REFRESH_FAILED_AFTER_WRITE',readError);}
        throw error;
      }
    };
    const task=sessionSaveTail.then(commit,commit);
    sessionSaveTail=task.then(()=>{},()=>{});
    return task;
  }
  async function editSettingTemplate(action,body={}){
    const commit=async()=>{try{
      if(body.fromSessionId)await refreshPersistedSession(body.fromSessionId);
      await refreshPersistedResources();
      const committed=await window.MimaLocalStore.commitSettingTemplates(templates=>{
        // Only the small independent list is changed. Canonical readers merge it.
        const stored={settingTemplates:templates,sessions:state.sessions};
      let result=null;
      if(action==='save'){
        const existing=stored.settingTemplates.find(x=>x.id===body.id);
        if(existing&&existing.revision!==Number(body.expectedRevision))throw new ApiError('E_SETTINGS_TEMPLATE_STALE','模板已在别处修改，请刷新再保存');
        if(body.id&&!existing)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','模板已不存在，不能复活旧记录');
        const cfg=body.fromSessionId?templateFromSession(stored.sessions.find(s=>s.id===body.fromSessionId)||(()=>{throw new ApiError('E_STORY_SESSION_MISSING','模板来源剧情不存在')})(),body.include||{}):body.config;
        const next=normalizeSettingTemplate({id:existing?.id,name:body.name||existing?.name,config:cfg,createdAt:existing?.createdAt,isDefault:existing?.isDefault===true,updatedAt:nowIso(),revision:(existing?.revision||0)+1});
        if(existing)stored.settingTemplates.splice(stored.settingTemplates.findIndex(x=>x.id===next.id),1,next);else stored.settingTemplates.push(next);
        result=next;
      }else if(action==='default'){
        if(body.id&&!stored.settingTemplates.some(x=>x.id===body.id))throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','指定模板已不存在');
        stored.settingTemplates.forEach(x=>{x.isDefault=x.id===body.id;x.revision++;x.updatedAt=nowIso();});
        result=stored.settingTemplates;
      }else if(action==='delete'){
        const existing=stored.settingTemplates.find(x=>x.id===body.id);
        if(!existing)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','指定模板已不存在');
        if(existing.revision!==Number(body.expectedRevision))throw new ApiError('E_SETTINGS_TEMPLATE_STALE','模板版本已经变化');
        stored.settingTemplates.splice(stored.settingTemplates.findIndex(x=>x.id===body.id),1);result={deleted:true,id:body.id};
      }else throw new ApiError('E_SETTINGS_TEMPLATE_ACTION','无效模板操作');
        return result;
      },state.storeRevision,state.settingTemplates);
      state={...state,settingTemplates:committed.templates,storeRevision:committed.storeRevision,__resourceSignature:null};
      return committed.value;
    }catch(error){
      try{state=normalizeState(await window.MimaLocalStore.loadState());}
      catch(readError){console.error('E_TEMPLATE_REFRESH_FAILED_AFTER_WRITE',readError);}
      throw error;
    }};
    const task=sessionSaveTail.then(commit,commit);
    sessionSaveTail=task.then(()=>{},()=>{});
    return task;
  }
  async function createSessionUsingTemplate(body){
    // A template's resource references are protected by a global revision CAS,
    // while the newly created Session is the ONLY large record written.
    const commit=async()=>{try{
      await refreshPersistedResources();
      const stored=state,id=String(body.settingTemplateId||'');
      const tpl=id==='default'?stored.settingTemplates.find(x=>x.isDefault):stored.settingTemplates.find(x=>x.id===id);
      if(!tpl)throw new ApiError('E_SETTINGS_TEMPLATE_MISSING','设置模板已删除，未创建剧情');
      const input=appliedSessionSettings(body,tpl,stored);
      const candidate=normalizeSession({...input,id:makeId('sess'),createdAt:nowIso(),updatedAt:nowIso(),messages:[],recordRevision:0});
      const committed=await window.MimaLocalStore.commitSessionRecord(candidate,0,{allowCreate:true,expectedGlobalRevision:stored.storeRevision});
      return publishSession(normalizeSession(committed.session),committed.storeRevision);
    }catch(error){try{state=normalizeState(await window.MimaLocalStore.loadState());}
      catch(readError){console.error('E_SESSION_TEMPLATE_REFRESH_FAILED',readError);}throw error;}};
    const task=sessionSaveTail.then(commit,commit);sessionSaveTail=task.then(()=>{},()=>{});return task;
  }
  async function saveMask(m){return commitResource('masks',normalizeMask({...m,updatedAt:nowIso()}),m.updatedAt);}
  async function savePreset(p,expectedToken){return commitResource('presets',normalizePreset({...p,updatedAt:nowIso()}),p.updatedAt,expectedToken);}
  async function saveWorldbook(w){return commitResource('worldbooks',normalizeWorldbook({...w,updatedAt:nowIso()}),w.updatedAt);}
  async function saveCssPreset(p){return commitResource('cssPresets',normalizeCssPreset({...p,updatedAt:nowIso()}),p.updatedAt);}
  // Import every selected CSS in ONE appearance transaction: no partial saves,
  // implicit application or rewriting existing presets when a file name repeats.
  async function importCssPresetsBatch(body={}){
    const entries=body.items,addCategories=body.newCategories||[];
    const expected=body.expectedAppearanceRevision;
    if(!Number.isSafeInteger(expected)||expected<0)throw new ApiError('E_CSS_IMPORT_STALE','CSS 库版本尚未确认，请重新选择文件');
    if(!Array.isArray(entries)||!entries.length||!Array.isArray(addCategories))
      throw new ApiError('E_CSS_IMPORT_ITEMS','没有可导入的 CSS 文件');
    const allowedScopes=new Set(['app','story','global','novel','assistant']);
    const prepared=entries.map((entry,index)=>{
      if(!entry||typeof entry!=='object'||typeof entry.css!=='string'||typeof entry.name!=='string'||!entry.name.trim()||
        !allowedScopes.has(entry.scope)||typeof entry.category!=='string'||!entry.category.trim()||entry.category.trim().length>60)
        throw new ApiError('E_CSS_IMPORT_ITEMS',`第 ${index+1} 份 CSS 的名称、内容或分类不合法，整批未保存`);
      const scope=entry.scope;
      return {name:entry.name.trim(),css:entry.css,category:entry.category.trim(),scope,
        surface:scope==='app'?'global':scope==='novel'?'novel':scope==='assistant'?'assistant':'chat'};
    });
    return commitAppearanceEdit(stored=>{
      // This comparison executes inside the same readwrite IndexedDB transaction
      // that appends all presets and registers their new categories.
      if(stored.storeRevision!==expected)
        throw new ApiError('E_CSS_IMPORT_STALE','导入期间 CSS 库已在其他窗口变化；未保存任何文件，请重新选择');
      const categories=categoryView(stored,'css').map(c=>c.name);
      const names=new Set(categories.map(name=>name.toLocaleLowerCase()));
      for(const input of addCategories){
        if(typeof input!=='string'||!input.trim()||input.trim().length>60||input.trim()==='未分类')
          throw new ApiError('E_CATEGORY_NAME','新分类名称必须为 1～60 字且不可使用「未分类」');
        const name=input.trim(),folded=name.toLocaleLowerCase();
        if(names.has(folded))throw new ApiError('E_CATEGORY_DUPLICATE','新分类已经存在或重复：'+name);
        names.add(folded);
        stored.cssCategoriesV1.push({id:makeId('category'),name,createdAt:nowIso()});
      }
      const permitted=new Set([...categoryView(stored,'css').map(c=>c.name),'未分类']);
      if(prepared.some(entry=>!permitted.has(entry.category)))
        throw new ApiError('E_CATEGORY_MISSING','部分目标分类已变化，整批 CSS 未保存');
      const occupied=new Set(stored.cssPresets.map(item=>item.id));
      const saved=[];
      for(const input of prepared){
        const preset=normalizeCssPreset({...input,createdAt:nowIso(),updatedAt:nowIso(),favorite:false});
        if(occupied.has(preset.id))throw new ApiError('E_CSS_IMPORT_ID','新 CSS ID 冲突，整批未保存');
        occupied.add(preset.id);stored.cssPresets.push(preset);
        saved.push({id:preset.id,name:preset.name,category:preset.category,scope:preset.scope});
      }
      // Never change themeSettings, global/session pointers or existing CSS bytes.
      return {count:saved.length,items:saved};
    });
  }
  async function publishAtelierCss(body){
    if(!body||!body.preset||typeof body.preset!=='object')throw Error('工坊正式发布缺少 CSS 快照');
    const input=body.preset;
    if(!/^css-atl-[a-f0-9]{64}$/.test(input.id||'')||!/^css-release:[a-zA-Z0-9:_-]{1,180}$/.test(input.atelierReleaseKey||''))throw Error('工坊发布指纹无效');
    if(input.scope!=='app'||input.surface!=='global')throw Error('工坊 CSS 必须以全局主题方式发布');
    const result=await commitAppearanceEdit(stored=>{
      const preset=normalizeCssPreset({...input,createdAt:nowIso(),updatedAt:nowIso()});
      const old=stored.cssPresets.find(x=>x.id===preset.id||x.atelierReleaseKey===preset.atelierReleaseKey);
      if(old&&(old.id!==preset.id||old.atelierReleaseKey!==preset.atelierReleaseKey||old.css!==preset.css))throw Error('同一工坊发布指纹对应不同 CSS，拒绝覆盖历史版本');
      if(!old)stored.cssPresets.push(preset);
      if(!body.prepareOnly)stored.themeSettings=window.MimaThemeEngine?.normalizeSettings?window.MimaThemeEngine.normalizeSettings({...stored.themeSettings,globalCssPresetId:preset.id,globalCssEnabled:true,updatedAt:nowIso()}):{...stored.themeSettings,globalCssPresetId:preset.id,globalCssEnabled:true,updatedAt:nowIso()};
      return {preset:clone(old||preset),themeSettings:clone(stored.themeSettings)};
    });
    try{window.MimaThemeEngine?.apply?.(state.themeSettings);}catch(e){console.error('[Atelier] canonical CSS committed; theme repaint pending',e);}
    return {...result,storeRevision:state.storeRevision};
  }
  // Assistant Studio: a regular CSS becomes canonical global UI CSS in one
  // store transaction; do not create a fake Atelier asset/legacy active pointer.
  async function publishAssistantCss(body={}){
    const input=body.preset||{};
    if(input.scope!=='app'||input.surface!=='global'||!String(input.css||'').trim())throw Error('助手全局 CSS 作用域或正文无效');
    const result=await commitAppearanceEdit(stored=>{
      const preset=normalizeCssPreset({...input,atelierReleaseKey:'',updatedAt:nowIso()});
      const existing=stored.cssPresets.find(p=>p.id===preset.id);
      if(existing&&(existing.css!==preset.css||existing.scope!=='app'||existing.atelierReleaseKey))throw Error('同 ID 助手 CSS 与原版本冲突；拒绝修改既有预设');
      if(!existing)stored.cssPresets.push(preset);
      if(!body.prepareOnly)stored.themeSettings=window.MimaThemeEngine?.normalizeSettings?window.MimaThemeEngine.normalizeSettings({...stored.themeSettings,globalCssPresetId:preset.id,globalCssEnabled:true,updatedAt:nowIso()}):{...stored.themeSettings,globalCssPresetId:preset.id,globalCssEnabled:true,updatedAt:nowIso()};
      return {preset:clone(existing||preset),themeSettings:clone(stored.themeSettings)};
    });
    try{window.MimaThemeEngine?.apply?.(state.themeSettings);}catch(e){console.error('[Assistant CSS] canonical global CSS committed, repaint pending',e);}
    return result;
  }
  async function mountAssistantResources(body={}){
    const targetId=String(body.sessionId||'');if(!targetId)throw new ApiError('E_ASSISTANT_SESSION_REQUIRED','请选择原目标剧情');
    const adds={presetIds:String(body.presetId||''),regexPackIds:String(body.regexId||''),customCssId:String(body.cssId||'')};
    if(!Object.values(adds).some(Boolean))throw Error('没有可挂载的助手资源');
    return commitLibraryEdit(stored=>{
      const session=stored.sessions.find(s=>s.id===targetId);
      if(!session)throw new ApiError('E_STORY_SESSION_MISSING','原剧情已删除：资源已经保存，但挂载未执行');
      if(adds.presetIds&&!stored.presets.some(x=>x.id===adds.presetIds))throw Error('要挂载的预设不存在');
      if(adds.regexPackIds&&!stored.regexPacks.some(x=>x.id===adds.regexPackIds))throw Error('要挂载的正则包不存在');
      if(adds.customCssId&&!stored.cssPresets.some(x=>x.id===adds.customCssId))throw Error('要挂载的 CSS 不存在');
      if(adds.presetIds)session.presetIds=[...new Set([...arr(session.presetIds),adds.presetIds])];
      if(adds.regexPackIds)session.regexPackIds=[...new Set([...arr(session.regexPackIds),adds.regexPackIds])];
      if(adds.customCssId){session.customCssId=adds.customCssId;session.customCssEnabled=true;}
      session.recordRevision=(Number(session.recordRevision)||0)+1;session.updatedAt=nowIso();
      return clone(session);
    });
  }
  // A regex bundle and its accompanying preset must either both be recorded,
  // with the optional session mounts, or neither be recorded.
  async function publishAssistantRegexBundle(body={}){
    const input=body.regexPack||{},presetInput=body.preset||{};
    const checked=window.MimaRegexEngine?.validatePack?.(input);
    if(!checked?.ok)throw Error('Regex Bundle 含无效正则：'+(checked?.invalid||[]).map(x=>x.error).join('；'));
    if(!String(presetInput.content||'').trim())throw Error('Regex Bundle 配套预设为空');
    return commitLibraryEdit(stored=>{
      const regex=normalizeRegexPack({...checked.pack,id:input.id,updatedAt:nowIso()});
      const preset=normalizePreset({...presetInput,updatedAt:nowIso()});
      const oldRegex=stored.regexPacks.find(x=>x.id===regex.id),oldPreset=stored.presets.find(x=>x.id===preset.id);
      if(oldRegex&&JSON.stringify(oldRegex.rules)!==JSON.stringify(regex.rules))throw Error('Regex Bundle ID 冲突，拒绝覆盖旧正则');
      if(oldPreset&&oldPreset.content!==preset.content)throw Error('Regex Bundle 配套预设 ID 冲突，拒绝覆盖旧预设');
      if(!oldRegex)stored.regexPacks.push(regex);
      if(!oldPreset)stored.presets.push(preset);
      let mounted=false;
      if(body.sessionId){const session=stored.sessions.find(x=>x.id===body.sessionId);
        if(!session)throw Error('目标剧情已不存在，未写入 Bundle');
        session.regexPackIds=[...new Set([...arr(session.regexPackIds),regex.id])];
        session.presetIds=[...new Set([...arr(session.presetIds),preset.id])];
        session.recordRevision=(Number(session.recordRevision)||0)+1;session.updatedAt=nowIso();mounted=true;
      }
      return {regexPack:clone(oldRegex||regex),preset:clone(oldPreset||preset),mounted};
    });
  }
  async function saveRegexPack(p){
    const checked=window.MimaRegexEngine?.validatePack?window.MimaRegexEngine.validatePack(p):{ok:true,pack:normalizeRegexPack(p),invalid:[]};
    if(!checked.ok)throw new ApiError('E_REGEX_INVALID',`正则包含无效规则：${checked.invalid.map(x=>`${x.name}: ${x.error}`).join('；')}`,{hint:'请检查 Pattern（匹配式）与 Flags（标志）；无效规则不会被静默保存。'});
    return commitResource('regexPacks',normalizeRegexPack({...checked.pack,updatedAt:nowIso()}),p.updatedAt);
  }
  async function saveNovelProject(p,{allowCreate=false}={}){
    if(!window.MimaNovelEngine)throw new Error('Novel Engine 未加载');
    const n=window.MimaNovelEngine.normalizeProject({...p,updatedAt:nowIso()});
    return commitLibraryEdit(stored=>{
      const existing=stored.novelProjects.find(x=>x.id===n.id);
      if(!existing&&!allowCreate)throw new ApiError('E_CANONICAL_STALE','小说已删除，迟到结果不能复活它');
      if(existing&&Number(existing.recordRevision)!==Number(n.recordRevision))
        throw new ApiError('E_CANONICAL_STALE','小说已被其他任务修改，旧章节、草稿或记忆不得覆盖新版本');
      if(existing&&allowCreate)throw new ApiError('E_CANONICAL_CONFLICT','同 ID 小说已经存在，禁止覆盖旧项目');
      const result={...n,recordRevision:(Number(n.recordRevision)||0)+1};
      const index=stored.novelProjects.findIndex(x=>x.id===result.id);
      if(index<0)stored.novelProjects.push(result);else stored.novelProjects[index]=result;
      // Do not change caller revision before the actual durable commit.
      return result;
    }).then(result=>{p.recordRevision=result.recordRevision;return result;});
  }
  async function commitGlobalCssSelection(body={}){
    const expected=body.expected||{},candidate=body.candidate||{},identity=body.identity;
    const next=await commitAppearanceEdit(stored=>{
      const current=stored.themeSettings||{};
      if((current.globalCssPresetId||null)!==(expected.globalCssPresetId||null)||
         (current.globalCssEnabled!==false)!==(expected.globalCssEnabled!==false)||
         (current.updatedAt||'')!==(expected.updatedAt||''))
        throw new ApiError('E_CSS_SELECTION_STALE','全局外观已在其他窗口改变，本次不覆盖');
      const actual=stored.cssPresets.find(p=>p.id===candidate.globalCssPresetId);
      if(!actual||actual.scope!=='app'||!identity||cssSelectionIdentity(actual)!==identity)
        throw new ApiError('E_CSS_CANDIDATE_CHANGED','候选全局 CSS 已变化，本次不应用旧版本');
      const appliedAt=new Date(Math.max(Date.now(),(Date.parse(current.updatedAt)||0)+1)).toISOString();
      stored.themeSettings=window.MimaThemeEngine?.normalizeSettings?
        window.MimaThemeEngine.normalizeSettings({...current,globalCssPresetId:actual.id,globalCssEnabled:true,updatedAt:appliedAt}):
        {...current,globalCssPresetId:actual.id,globalCssEnabled:true,updatedAt:appliedAt};
      return clone(stored.themeSettings);
    });
    try{window.MimaThemeEngine?.apply?.(next);}catch(error){console.error('E_THEME_APPLY_AFTER_CSS_SELECTION',error);}
    return next;
  }
  function readCssSelectionCanonical(sessionIds=[]){
    // One verified canonical snapshot contains the selection AND its CSS bytes.
    // Queue with local writes; never settle a crash receipt from tab-local RAM.
    const read=async()=>{
      const persisted=await window.MimaLocalStore.loadCssSelectionSnapshot(sessionIds);
      for(const session of persisted.sessions)publishSession(normalizeSession(session));
      state={...state,themeSettings:persisted.themeSettings,cssPresets:persisted.cssPresets,
        storeRevision:persisted.storeRevision,__appearanceRevision:persisted.appearanceRevision,
        __resourceSignature:null};
      return persisted;
    };
    const task=sessionSaveTail.then(read,read);sessionSaveTail=task.then(()=>{},()=>{});return task;
  }
  async function saveThemeSettings(input={}){
    const baseline=clone(state.themeSettings);
    const next=await commitAppearanceEdit(stored=>{
      if(resourceChanged(baseline,stored.themeSettings))
        throw new ApiError('E_CANONICAL_CONFLICT','外观已在其他窗口修改，请刷新后再调整');
      stored.themeSettings=window.MimaThemeEngine?.normalizeSettings?
        window.MimaThemeEngine.normalizeSettings({...stored.themeSettings,...input,updatedAt:nowIso()}):
        {...stored.themeSettings,...input,updatedAt:nowIso()};
      return clone(stored.themeSettings);
    });
    try{window.MimaThemeEngine?.apply?.(next);}catch(e){console.error('E_THEME_APPLY_AFTER_CANONICAL_COMMIT',e);}
    return next;
  }

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
  async function applyRegexForSessionAsync(sessionOrId,input,phase='display',diagnostics=null,options={}){
    const session=typeof sessionOrId==='string'?getSession(sessionOrId):sessionOrId;
    if(!session)return String(input??'');
    const raw=String(input??''),packs=activeRegexPacks(session);
    const transformed=await window.MimaRegexEngine.applyAsync(raw,packs,phase,diagnostics,options);
    return phase==='display'||phase==='prompt'?resolveMacrosForSession(session,transformed):transformed;
  }

  // The visible transcript must not create one native Worker per historical
  // assistant message. The full payload is still transformed without touching
  // canonical History, using bounded groups in the caller.
  function hasActiveRegexForSession(sessionOrId,phase='display'){
    const session=typeof sessionOrId==='string'?getSession(sessionOrId):sessionOrId;
    return !!session && activeRegexPacks(session).some(pack=>arr(pack.rules).some(rule=>rule&&rule.enabled!==false&&(rule.phase||'display')===phase));
  }
  async function applyRegexBatchForSessionAsync(sessionOrId,inputs,phase='display',options={}){
    const originals=arr(inputs).map(input=>String(input??''));
    if(!originals.length)return [];
    const session=typeof sessionOrId==='string'?getSession(sessionOrId):sessionOrId;
    if(!session)return originals;
    const results=await window.MimaRegexEngine.applyBatchAsync(originals.map(input=>({input,phase})),activeRegexPacks(session),options);
    if(!Array.isArray(results)||results.length!==originals.length)throw new Error('E_REGEX_BATCH_MISMATCH: 正则线程返回的项目数量不一致');
    return results.map(item=>{
      if(!item||typeof item.output!=='string')throw new Error('E_REGEX_BATCH_MALFORMED: 正则线程缺少结果');
      return phase==='display'||phase==='prompt'?resolveMacrosForSession(session,item.output):item.output;
    });
  }

  function historyHtmlProjection(textInput,session){
    const content=String(textInput??'');
    if(session?.promptSettings?.historyHtmlMode==='raw')return {text:content,changed:false,beforeChars:content.length,afterChars:content.length,reason:'disabled'};
    const engine=window.MimaHistoryHtmlProjection;
    // No weak regular-expression replacement when the parser module is missing.
    if(!engine?.project)throw new ApiError('E_HISTORY_HTML_PROJECTION_UNAVAILABLE','历史 HTML 投影模块未加载；已中止新请求，不会损坏剧情。',{hint:'请检查 history-html-projection.js 是否与当前版本一并部署，以及浏览器是否使用了旧缓存。'});
    return engine.project(content);
  }
  function messagePromptContent(m,session,stats=null,precomputed=null){
    const original=precomputed===null?applyRegexForSession(session,m?.content||'', 'prompt'):resolveMacrosForSession(session,precomputed);
    const projection=historyHtmlProjection(original,session);
    if(stats)stats.set(m.id,projection);
    // Historical status panels and fabricated social feeds are snapshots,
    // not assertions about the current scene. Keep every source character
    // in canonical History; only annotate *older* projected prompt messages.
    const isOldStatus=session?.promptSettings?.historyHtmlMode!=='raw'&&
      /<[^>]+class\s*=\s*["'][^"']*mima-(?:current|gaze|bond|abyss|pulse|cocoon|echo|pets|nexus)/i.test(original);
    return isOldStatus?'【历史回合来源提示：以下状态栏、朋友圈、论坛、推送、搜索均是当时的虚构快照，并非当前最新事件；正文仍属于剧情历史。】\n'+projection.text:projection.text;
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
  function userMessagePromptContent(m,session,precomputed=null){
    const content=precomputed===null?window.MimaRegexEngine.apply(String(m?.content??''),activeRegexPacks(session),'prompt'):precomputed;
    return compileUserInputForPrompt(session,content,inputSemanticMode(session,m));
  }
  function keywordMatches(hay, keyword, entry) {
    const k=String(keyword||'').trim(); if(!k)return false;
    if(entry.useRegex)throw new ApiError('E_WORLDBOOK_ASYNC_REQUIRED','正则世界书只能在隔离线程匹配');
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
  async function collectWorldbookEntriesAsync(session,signal=null){
    const books=mountedWorldbooks(session).map(clone);
    const booksSignature=JSON.stringify(books);
    const items=books.flatMap(book=>arr(book.entries).map(entry=>({book,entry})));
    // Pass exactly the union of each entry's configured scanDepth, not the
    // entire long canonical History. The source History is never modified.
    const depth=items.reduce((n,x)=>Math.max(n,Math.max(1,Number(x.entry.scanDepth)||12)),0);
    const msg=depth?(session.messages||[]).filter(m=>m?.content&&m.role!=='system'&&m.role!=='director').slice(-depth).map(m=>String(m.content)):[];
    if(!window.MimaWorldbookMatcher?.evaluate)throw new ApiError('E_WORLDBOOK_ISOLATION_UNAVAILABLE','世界书隔离模块未加载；未发送请求');
    const results=await window.MimaWorldbookMatcher.evaluate(items.map(x=>x.entry),msg,{signal});
    if(JSON.stringify(mountedWorldbooks(session))!==booksSignature)throw new ApiError('E_WORLDBOOK_SOURCE_CHANGED','世界书在匹配期间被修改，请重新生成；未使用旧规则继续');
    const matched=[],skipped=[];
    items.forEach((item,i)=>{const activation=results[i],row={...item,activation};(activation.active?matched:skipped).push(row);});
    matched.sort((a,b)=>Number(a.entry.depth||0)-Number(b.entry.depth||0)||Number(a.entry.priority??50)-Number(b.entry.priority??50));
    return {matched,skipped};
  }
  function formatMask(mask,kind){if(!mask)return'';const blocks=[`【${kind==='user'?'当前玩家 Persona':'当前角色 Persona'}：${mask.name}】`];if(mask.description)blocks.push(`简介：${mask.description}`);
    // normalizeMask intentionally keeps legacy content = description fallback.
    // Never send that same fallback a second time in one provider request.
    if(mask.content&&mask.content.trim()!==mask.description.trim())blocks.push(mask.content);
    if(mask.scenario&&kind==='character')blocks.push(`【角色卡 Scenario】\n${mask.scenario}`);if(mask.exampleDialogue&&kind==='character')blocks.push(`【Example Dialogue】\n${mask.exampleDialogue}`);return blocks.join('\n');}
  // The owner chooses reference material for memory generation independently
  // of ordinary story prompt mounting and forward memory-injection toggles.
  function memoryReferenceSnapshot(session,verifiedMatchedRefs=null){
    const settings=normalizeManualMemory(session.manualMemory).settings.summaryContext;
    const records=[];
    const add=(kind,id,content,authority)=>{if(String(content||'').trim())records.push({kind,id,content:String(content),authority});};
    if(settings.userPersona){const mask=enabledMask(session.loadedUserMaskId);if(!mask)throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选玩家 Persona 未挂载或被关闭');add('user_persona',mask.id,formatMask(mask,'user'),'background_only');}
    if(settings.characterPersona){const mask=enabledMask(session.loadedCharMaskId);if(!mask)throw new ApiError('E_MEMORY_REFERENCE_MISSING','所选角色 Persona 未挂载或被关闭');add('character_persona',mask.id,formatMask(mask,'character'),'background_only');}
    const mounted=new Set(arr(session.presetIds));
    for(const id of settings.presetIds){const preset=getPreset(id);if(!mounted.has(id)||!preset||preset.enabled===false)throw new ApiError('E_MEMORY_REFERENCE_MISSING','选择用于记忆的预设已卸载或停用：'+id);add('preset',id,resolveMacrosForSession(session,preset.content),'generation_instruction');}
    if(settings.worldbookMode!=='none'){
      const activated=settings.worldbookMode==='matched_entries'?
        new Set((verifiedMatchedRefs??window.MimaWorldbookRefs?.resolveMatchedWorldbookRefs?.({bookIds:settings.worldbookIds,books:settings.worldbookIds.map(id=>getWorldbook(id)).filter(Boolean),messages:session.messages})??[]).map(ref=>JSON.stringify(ref))):null;
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
  async function memoryReferenceSnapshotAsync(session,signal=null){
    const settings=normalizeManualMemory(session.manualMemory).settings.summaryContext;
    let refs=null;
    if(settings.worldbookMode==='matched_entries'){
      const books=settings.worldbookIds.map(id=>getWorldbook(id)).filter(Boolean);
      const booksSignature=JSON.stringify(books);
      const entries=books.flatMap(book=>arr(book.entries).map(entry=>({bookId:book.id,entry})));
      const depth=entries.reduce((n,x)=>Math.max(n,Math.max(1,Number(x.entry.scanDepth)||12)),0);
      const msg=depth?(session.messages||[]).filter(m=>m?.content&&m.role!=='system'&&m.role!=='director').slice(-depth).map(m=>String(m.content)):[];
      if(!window.MimaWorldbookMatcher?.evaluate)throw new ApiError('E_WORLDBOOK_ISOLATION_UNAVAILABLE','记忆来源匹配 Worker 未加载');
      const matched=await window.MimaWorldbookMatcher.evaluate(entries.map(x=>x.entry),msg,{signal});
      if(JSON.stringify(settings.worldbookIds.map(id=>getWorldbook(id)).filter(Boolean))!==booksSignature)throw new ApiError('E_MEMORY_REFERENCE_CHANGED','记忆世界书在匹配期间已修改，不能使用过期激活结果');
      refs=entries.filter((item,i)=>matched[i].active).map(x=>[x.bookId,x.entry.id]);
    }
    return {records:memoryReferenceSnapshot(session,refs),matchedRefs:refs};
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
    // Continuation sends the real assistant tail. It does not inject an extra
    // narrative/director instruction; the owner controls prose in her presets.
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
    const rollingStatus=rollingCoverageStatus(session);
    const rollingSourceCurrent=rollingStatus.valid||(!rollingStatus.stale&&!replay&&!session.legacyMemoryQuarantined);
    const rollingIncluded=options.excludeRollingSummary!==true&&session.promptSettings?.injectSavedRolling!==false&&!!rollingText&&rollingSourceCurrent;
    memoryTrace.push({kind:'rolling',chars:rollingText.length,injected:rollingIncluded,sourceCurrent:rollingSourceCurrent,
      reason:options.excludeRollingSummary===true?'explicit_exclusion':session.promptSettings?.injectSavedRolling===false?'disabled':!rollingText?'empty':replay&&!rollingSourceCurrent?'historical_replay_boundary':rollingSourceCurrent?'included':'source_changed_excluded'});
    if(rollingIncluded)add('story_summary',`【剧情摘要 / Rolling Summary】\n${rollingText}`);
    const coreSourceCurrent=memorySourceValid(session,memory.core);
    const coreIncluded=!!(memory.settings.injectCore&&memory.core.content&&(!replay||coreSourceCurrent));
    memoryTrace.push({kind:'core',verification:memory.core.verification.status,sourceCount:memory.core.sourceCount,
      source:memory.core.source,sourceCurrent:coreSourceCurrent,chars:memory.core.content.length,injected:coreIncluded,
      reason:!memory.settings.injectCore?'disabled':!memory.core.content?'empty':replay&&!coreSourceCurrent?'historical_replay_boundary':coreSourceCurrent?'included':'source_changed_included'});
    if(coreIncluded){
      const label=memory.core.verification.status==='human_confirmed'?'玩家手工编辑':'自动整理（可编辑）';
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
        const label=x.verification.status==='human_confirmed'?'玩家手工编辑':'自动整理（可编辑）';
        return `【第 ${x.startRound}–${x.endRound} 轮 · ${label}】\n${x.content}`;
      }).join('\n\n')}`);
    }
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.sceneSummary)add('scene_summary',`【当前场景摘要】\n${session.sceneSummary}`);
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.characterPsychSummary)add('character_psych',`【角色心理状态摘要】\n${session.characterPsychSummary}`);
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.relationshipSummary)add('relationship_summary',`【关系变化摘要】\n${session.relationshipSummary}`);
    if(!session.legacyMemoryQuarantined&&!session.promptLineageProjection&&session.unresolvedHooks?.length)add('unresolved_hooks',`【未解决伏笔】\n${session.unresolvedHooks.map(x=>`- ${x}`).join('\n')}`);
    if(session.userNotes)add('user_notes',`【玩家备注】\n${session.userNotes}`);
    if(session.aiNotes)add('ai_notes',`【补充备注】\n${session.aiNotes}`);
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
      const shape=htmlContract.structureMode==='three_part_html_status'?'明确启用三段式：先 .mima-current 环境栏，中间保留非空剧情正文，末尾依次且各仅一个 .mima-gaze、.mima-bond、.mima-abyss、.mima-pulse、.mima-cocoon、.mima-echo、.mima-pets、.mima-nexus。':'旧版自定义选择器结构模式；';
      add('html_structure_contract',`【HTML 状态栏格式：要按照格式输出。${shape}必需结构选择器：${htmlContract.requiredSelectors||'(无额外选择器)'}。正文槽：${htmlContract.bodySelector||'(未标注)'}。状态槽：${htmlContract.statusSelector||'(未标注)'}。HTML 标签须完整；旧状态不等于本轮状态，无法确认的值标为待确认。】${sourceSafeShell}`);
    }
    if(options.directorNote||session.directorNote)add('director_note',options.directorNote||session.directorNote);
    return {prompt:chunks.join('\n\n'),sections,memoryTrace};
  }
  function toHistoryMessage(m,session,stats=null,precomputed=null){
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
    const content=m.role==='user'?userMessagePromptContent(m,session,precomputed):messagePromptContent(m,session,stats,precomputed);
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
  // The same exact model identity must govern plan, chunking and provider call.
  function memoryEffectiveConfig(base,model=''){
    return effectiveRequestConfig({...base,model:String(model||base.model||'').trim()});
  }
  function rollingCoverageStatus(session){
    const cursor=Math.max(0,Math.floor(Number(session.lastSummarizedIndex)||0));
    const count=Math.floor(Number(session.rollingSourceCount)||0);
    const text=String(session.rollingSummary||session.summary||session.longSummary||'');
    const valid=!!text&&cursor>0&&count===cursor&&session.messages.length>=cursor&&
      !!session.rollingSourceFingerprint&&memorySourceFingerprint(session.messages,cursor)===session.rollingSourceFingerprint;
    return {valid,stale:!!text&&cursor>0&&!valid,start:valid?cursor:0,covered:cursor};
  }
  function promptBudget(cfg=getApiConfig()){
    const configured=Number(cfg.contextWindowTokens);
    const verified=Number.isFinite(configured)&&configured>=4096;
    if(!verified){
      // Unknown means unknown. Do not invent a 32k window, use it to reject
      // complete canonical History, or pretend an unverified model has one.
      // Without a declared window, assemble keeps complete original History;
      // the Provider is authoritative about whether it can accept the request.
      return {windowTokens:null,reserve:null,usable:null,verified:false};
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
  async function assemble(sessionInput,options={}){
    const session=normalizeSession(sessionInput),activation=await collectWorldbookEntriesAsync(session,options.signal);
    const budget=Math.max(1000,Number(session.promptSettings?.worldbookBudgetChars||16000)),budgeted=enforceBudget(activation.matched,budget),matched=budgeted.kept;
    const worldbookMountTrace=arr(session.worldbookIds).map(id=>{const book=getWorldbook(id);return {bookId:id,bookName:book?.name||'',mounted:true,enabled:book?.enabled!==false&&!!book,reason:!book?'missing_book':book.enabled===false?'disabled_book':'enabled'};});
    const maskTrace=[{kind:'character',id:session.loadedCharMaskId},{kind:'user',id:session.loadedUserMaskId}].map(x=>{const mask=x.id?getMask(x.id):null;return {kind:x.kind,id:x.id||null,loaded:!!mask,enabled:!!mask&&mask.enabled!==false,injected:!!enabledMask(x.id),reason:!x.id?'not_mounted':!mask?'missing_mask':mask.enabled===false?'disabled':'included',name:mask?.name||'',chars:mask&&mask.enabled!==false?formatMask(mask,x.kind).length:0};});
    const presetTrace=arr(session.presetIds).map(id=>{const preset=getPreset(id);return {id,name:preset?.name||'',priority:preset?.priority??null,mounted:true,enabled:!!preset&&preset.enabled!==false,injected:!!preset&&preset.enabled!==false&&!!text(preset.content),role:'system',reason:!preset?'missing_preset':preset.enabled===false?'disabled':!text(preset.content)?'empty':'included',chars:preset?.content?.length||0};});
    // R11: Project the entire canonical History when the configured model can
    // carry it. A fixed recentMessageLimit governs background summarization,
    // never truncates a sufficiently large model's input.
    const promptCap=promptBudget(),visibleHistory=session.messages.filter(m=>m.role!=='director');
    const projectionPackets=await window.MimaRegexEngine.applyBatchAsync(
      visibleHistory.map(m=>({input:String(m.content??''),phase:'prompt'})),activeRegexPacks(session),{signal:options.signal});
    const promptProjection=new Map(visibleHistory.map((m,i)=>[m.id,projectionPackets[i].output]));

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
      const projected=(preservePrefix||preserveLatest)?toHistoryMessage(m,{...session,promptSettings:{...session.promptSettings,historyHtmlMode:'raw'}},htmlProjectionStats,promptProjection.get(m.id)??null):toHistoryMessage(m,session,htmlProjectionStats,promptProjection.get(m.id)??null);
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
    if(promptCap.verified){
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
    // Only an explicitly declared context creates a retrieval budget.
    // With unknown capacity no history is projected away; optional retrieval
    // has no missing old groups to recover, so it needs no guessed allowance.
    const retrievalCap=promptCap.verified?promptCap.usable:0;
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
  function defaultApiConfig(){return{apiBase:'',apiKey:'',model:'',chatEndpoint:'',modelsEndpoint:'',extraHeaders:'',sendTemperature:true,temperature:0.85,sendTopP:false,topP:1,stream:false,maxTokens:0,outputLimitMode:'global',globalMaxTokens:0,modelOutputProfiles:{},contextWindowTokens:0,continuationMode:'assistant_tail',prefixReturnsSuffix:false,thinkingMode:'normal',showThinking:true,reasoningEffort:'inherit',requestGeminiThoughts:false};}
  // An API window is a declaration for an exact endpoint + model, not a global
  // entitlement. Preserve the legacy configuration for its ORIGINAL identity.
  // Never silently carry a 1M window over to another channel or model.
  function apiCapacityIdentity(cfg){return JSON.stringify([String(cfg?.apiBase||'').trim().replace(/\/+$/,''),String(cfg?.chatEndpoint||'').trim(),String(cfg?.model||'').trim()]);}
  // Freeze capacity at the exact endpoint and model being called. Helpers
  // must NEVER inherit a larger main-model window after changing model.
  function effectiveRequestConfig(input){
    const cfg={...defaultApiConfig(),...(input||{})},identity=apiCapacityIdentity(cfg);
    const profile=Number(cfg.modelCapacityProfiles?.[identity]);
    const hasExplicitIdentity=cfg.contextWindowIdentity===identity;
    const declared=hasExplicitIdentity?Number(cfg.contextWindowTokens):0;
    cfg.contextWindowTokens=Number.isSafeInteger(profile)&&profile>=4096?profile:
      Number.isSafeInteger(declared)&&declared>=4096?declared:0;
    cfg.contextWindowIdentity=identity;
    // A model-local output ceiling must never inherit the last selected model's
    // max_tokens when callers temporarily choose another model (e.g. Memory).
    if(cfg.outputLimitMode==='model'){
      const value=Number(cfg.modelOutputProfiles?.[identity]);
      cfg.maxTokens=Number.isSafeInteger(value)&&value>=0&&value<=100000000?value:0;
    }
    return cfg;
  }

  function apiCapacityEntries(raw){
    const profiles=raw?.modelCapacityProfiles&&typeof raw.modelCapacityProfiles==='object'&&!Array.isArray(raw.modelCapacityProfiles)?{...raw.modelCapacityProfiles}:{};
    const identity=String(raw?.contextWindowIdentity||apiCapacityIdentity(raw));
    const n=Number(raw?.contextWindowTokens);
    if(n>=4096&&Number.isSafeInteger(n)&&!Object.hasOwn(profiles,identity))profiles[identity]=n;
    return profiles;
  }
  function apiOutputProfiles(raw){
    const entries=raw?.modelOutputProfiles&&typeof raw.modelOutputProfiles==='object'&&!Array.isArray(raw.modelOutputProfiles)?raw.modelOutputProfiles:{};
    return Object.fromEntries(Object.entries(entries).filter(([key,value])=>key.length<=1024&&Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=100000000).map(([key,value])=>[key,Number(value)]));
  }
  function outputLimitNumber(value){
    const n=Number(value);
    if(!Number.isSafeInteger(n)||n<0||n>100000000)throw new ApiError('E_API_OUTPUT_LIMIT_INVALID','最大输出 Tokens 必须是 0 至 100000000 的整数。');
    return n;
  }
  function getApiConfig(){
    try{
      const raw=JSON.parse(localStorage.getItem(API_CONFIG_KEY)||'{}'),profiles=apiCapacityEntries(raw),identity=apiCapacityIdentity(raw);
      const n=Number(profiles[identity]);
      const mode=raw.outputLimitMode==='model'?'model':'global';
      // Old installs only have maxTokens: it remains their explicit global value.
      const globalMaxTokens=outputLimitNumber(raw.globalMaxTokens??raw.maxTokens??0);
      const modelOutputProfiles=apiOutputProfiles(raw);
      const maxTokens=mode==='model'?(modelOutputProfiles[identity]??0):globalMaxTokens;
      return {...defaultApiConfig(),...raw,contextWindowTokens:Number.isSafeInteger(n)&&n>=4096?n:0,
        contextWindowIdentity:identity,modelCapacityProfiles:profiles,
        outputLimitMode:mode,globalMaxTokens,modelOutputProfiles,maxTokens};
    }catch(_){return defaultApiConfig();}
  }
  function saveApiConfig(cfg){
    const old=getApiConfig(),next={...defaultApiConfig(),...cfg},identity=apiCapacityIdentity(next),previousIdentity=apiCapacityIdentity(old);
    const profiles={...old.modelCapacityProfiles,...(cfg?.modelCapacityProfiles||{})};
    const explicit=cfg?.capacityExplicit===true||!localStorage.getItem(API_CONFIG_KEY);
    const submitted=Number(next.contextWindowTokens);
    if(explicit){
      if(!Number.isSafeInteger(submitted)||submitted<0||submitted>100000000)throw new ApiError('E_API_CAPACITY_INVALID','模型上下文窗口必须是有效的非负整数。');
      if(submitted>=4096)profiles[identity]=submitted;else delete profiles[identity];
    }else if(identity===previousIdentity&&Number.isSafeInteger(submitted)&&submitted>=4096){profiles[identity]=submitted;}
    const known=Number(profiles[identity]);next.contextWindowTokens=Number.isSafeInteger(known)&&known>=4096?known:0;
    next.contextWindowIdentity=identity;next.modelCapacityProfiles=profiles;delete next.capacityExplicit;
    next.outputLimitMode=cfg?.outputLimitMode==='model'?'model':'global';
    const outputProfiles={...old.modelOutputProfiles,...apiOutputProfiles(cfg)};
    const outputExplicit=cfg?.outputLimitExplicit===true||!localStorage.getItem(API_CONFIG_KEY);
    if(outputExplicit){
      const value=outputLimitNumber(next.maxTokens);
      if(next.outputLimitMode==='model'){
        outputProfiles[identity]=value;
        next.globalMaxTokens=Object.hasOwn(cfg||{},'globalMaxTokens')?outputLimitNumber(cfg.globalMaxTokens):old.globalMaxTokens;
      }else next.globalMaxTokens=value;
    }else next.globalMaxTokens=old.globalMaxTokens;
    next.globalMaxTokens=outputLimitNumber(next.globalMaxTokens??old.globalMaxTokens);
    next.modelOutputProfiles=outputProfiles;
    next.maxTokens=next.outputLimitMode==='model'?(outputProfiles[identity]??0):next.globalMaxTokens;
    delete next.outputLimitExplicit;
    next.temperature=clampTemp(next.temperature);next.stream=!!next.stream;
    if(!Number.isFinite(Number(next.topP))||Number(next.topP)<0||Number(next.topP)>1)throw new ApiError('E_API_TOP_P_INVALID','Top-p 必须介于 0 到 1。');
    next.topP=Number(next.topP);next.sendTopP=next.sendTopP===true;
    next.thinkingMode=['normal','character','prose'].includes(next.thinkingMode)?next.thinkingMode:'normal';
    next.reasoningEffort=['inherit','low','medium','high'].includes(next.reasoningEffort)?next.reasoningEffort:'inherit';
    next.showThinking=next.showThinking!==false;next.requestGeminiThoughts=next.requestGeminiThoughts===true;
    localStorage.setItem(API_CONFIG_KEY,JSON.stringify(next));return next;
  }
  // Backup/file import is an authoritative whole-configuration replacement, NOT
  // an ordinary settings control edit. Never merge the previous model profiles.
  function validateApiConfigSnapshot(raw,{commit=false}={}){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError('E_API_BACKUP_INVALID','接口配置备份必须是对象');
    if(raw.outputLimitMode!==undefined&&!['global','model'].includes(raw.outputLimitMode))
      throw new ApiError('E_API_BACKUP_INVALID','输出上限模式无效');
    if(raw.modelOutputProfiles!==undefined&&(!raw.modelOutputProfiles||typeof raw.modelOutputProfiles!=='object'||Array.isArray(raw.modelOutputProfiles)))
      throw new ApiError('E_API_BACKUP_INVALID','模型输出上限列表无效');
    const entries=raw.modelOutputProfiles||{};
    const modelOutputProfiles=Object.create(null);
    for(const [key,value] of Object.entries(entries)){
      if(!key||key.length>1024)throw new ApiError('E_API_BACKUP_INVALID','模型身份标识无效');
      modelOutputProfiles[key]=outputLimitNumber(value);
    }
    const next={...defaultApiConfig(),...raw},identity=apiCapacityIdentity(next);
    const hasTop=Object.prototype.hasOwnProperty.call(raw,'maxTokens');
    const topValue=hasTop?outputLimitNumber(raw.maxTokens):null;
    next.outputLimitMode=raw.outputLimitMode==='model'?'model':'global';
    next.globalMaxTokens=outputLimitNumber(raw.globalMaxTokens??(next.outputLimitMode==='global'?raw.maxTokens:0)??0);
    if(next.outputLimitMode==='model'){
      if(topValue!==null&&Object.prototype.hasOwnProperty.call(modelOutputProfiles,identity)&&modelOutputProfiles[identity]!==topValue)
        throw new ApiError('E_API_BACKUP_CONFLICT','当前模型输出上限与独立配置表冲突，未覆盖原设置');
      if(topValue!==null&&!Object.prototype.hasOwnProperty.call(modelOutputProfiles,identity))modelOutputProfiles[identity]=topValue;
    }
    next.modelOutputProfiles={...modelOutputProfiles};
    next.maxTokens=next.outputLimitMode==='model'?(modelOutputProfiles[identity]??0):next.globalMaxTokens;
    if(raw.modelCapacityProfiles!==undefined&&(!raw.modelCapacityProfiles||typeof raw.modelCapacityProfiles!=='object'||Array.isArray(raw.modelCapacityProfiles)))
      throw new ApiError('E_API_BACKUP_INVALID','上下文容量配置表无效');
    const capacities=apiCapacityEntries(raw);
    for(const [key,value] of Object.entries(capacities)){
      if(!key||key.length>1024||!Number.isSafeInteger(Number(value))||Number(value)<4096||Number(value)>100000000)
        throw new ApiError('E_API_BACKUP_INVALID','模型上下文容量无效');
    }
    next.modelCapacityProfiles=capacities;
    const declared=Number(capacities[identity]);next.contextWindowTokens=Number.isSafeInteger(declared)&&declared>=4096?declared:0;
    next.contextWindowIdentity=identity;
    if(!Number.isFinite(Number(next.topP))||Number(next.topP)<0||Number(next.topP)>1)throw new ApiError('E_API_TOP_P_INVALID','Top-p 必须介于 0 到 1');
    next.topP=Number(next.topP);next.sendTopP=next.sendTopP===true;
    if(!Number.isFinite(Number(next.temperature)))throw new ApiError('E_API_BACKUP_INVALID','温度无效');
    next.temperature=clampTemp(next.temperature);
    next.stream=!!next.stream;next.showThinking=next.showThinking!==false;next.requestGeminiThoughts=next.requestGeminiThoughts===true;
    next.thinkingMode=['normal','character','prose'].includes(next.thinkingMode)?next.thinkingMode:'normal';
    next.reasoningEffort=['inherit','low','medium','high'].includes(next.reasoningEffort)?next.reasoningEffort:'inherit';
    delete next.outputLimitExplicit;delete next.capacityExplicit;
    if(!commit)return next;
    localStorage.setItem(API_CONFIG_KEY,JSON.stringify(next));
    const verified=getApiConfig();
    if(verified.outputLimitMode!==next.outputLimitMode||verified.globalMaxTokens!==next.globalMaxTokens||
      verified.maxTokens!==next.maxTokens||JSON.stringify(verified.modelOutputProfiles)!==JSON.stringify(next.modelOutputProfiles))
      throw new ApiError('E_API_BACKUP_VERIFY','接口备份保存后核对失败，设置未确认');
    return verified;
  }
  function replaceApiConfigSnapshot(raw){return validateApiConfigSnapshot(raw,{commit:true});}
  function captureApiConfigBytes(){return localStorage.getItem(API_CONFIG_KEY);}
  function restoreApiConfigBytes(bytes){if(bytes===null)localStorage.removeItem(API_CONFIG_KEY);else localStorage.setItem(API_CONFIG_KEY,bytes);}
  function baseWithoutSlash(s){return String(s||'').trim().replace(/\/+$/,'');}

  class ApiError extends Error {
    constructor(code,message,{status=0,hint='',details=''}={}){super(message);this.name='ApiError';this.code=code||'E_API_UNKNOWN';this.status=Number(status)||0;this.hint=hint||apiErrorHint(this.code,this.status,message);this.details=details||'';}
  }
  function apiErrorHint(code,status,message=''){
    const m=String(message||'');
    if(status===400&&/(?:prompt_rejected|prompt[_ -]?blocked|prohibited[_ -]?content|blocked by upstream content policy|content[_ -]?filter|prohibited.use.policy)/i.test(m))return '接口明确报告内容政策拦截。本轮请求已被服务端拒绝，原始请求与剧情已保留，不会自动重复计费。';
    if(code==='E_HTML_STRUCTURE_MISSING'||code==='E_HTML_REQUIRED_NODE_MISSING')return '模型已返回正文，但本机启用的 HTML 结构合同未满足，因此未自动提交到剧情。原文留存在独立诊断中；可查看、下载或经确认手动恢复，无须再请求模型。';
    if(String(code||'').startsWith('E_HTML_'))return '这是本机 HTML 检查、修复或保存阶段的反馈；原剧情未被失败候选覆盖。请按具体原因检查模板、选择器或待确认字段。';
    if(code==='E_API_CONFIG')return '请检查 API Base URL（基础地址）、模型名和高级端点设置。';
    if(code==='E_API_NETWORK_CORS')return '浏览器没有拿到可读取的响应。常见原因是 CORS（跨域）被 API 服务拦截、域名不可达、HTTPS 证书异常或网络中断。';
    if(code==='E_API_BAD_JSON')return '接口返回了网页、网关文本或其他非 JSON 内容。通常是 API 地址填错、反代报错，或服务端没有按 OpenAI-compatible 格式响应。';
    if(code==='E_API_EMPTY_REPLY')return '接口请求成功，但可见正文为空。常见原因是中转兼容层只返回 reasoning_content、模型输出被过滤/截断、max_tokens 太小，或上游返回格式异常。咪嘛馆现在会拦截空回复，不再把空白消息写进剧情。';
    if(code==='E_API_UNRECOGNIZED_RESPONSE')return '接口返回成功，但响应结构不是咪嘛馆可识别的 OpenAI-compatible 文本格式。可检查中转站是否使用了自定义响应结构。';
    if(code==='E_STREAM_PARSE')return '流式数据没有按 SSE/NDJSON 的常见格式返回，可能是中转站的流式兼容实现异常。可暂时关闭 Streaming（流式传输）再试。';
    if(code==='E_STREAM_INTERRUPTED')return '已取得 HTTP 响应头，但流式正文未可靠结束；浏览器读取、网络连接或服务端中途关闭均可能造成此情况，单凭本机信息不能判定责任方。咪嘛馆不会自动再次计费重试，已写盘片段可从失败面板免费查看。';
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
    const localCode=e?.code||/^E_HTML_[A-Z0-9_]+/.exec(m)?.[0];
    if(localCode&&String(localCode).startsWith('E_HTML_'))return new ApiError(localCode,m,{details:e?.details||'',hint:'这是本机 HTML 检查或修复阶段的问题；未修改剧情。请检查提示中的结构、选择器或模板。'});
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
    const eventType=String(data?.type||'');
    if(eventType&&/(?:reasoning|thinking|audio|image|function_call|tool_call|annotation|refusal)\b/i.test(eventType)&&!/output_text\.delta$/i.test(eventType))return '';
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
    let buffer='',reply='',eventCount=0,finalPayload=null,streamUsage=null,receivedDone=false,finishReason='',finishKind='unknown',badEvents=0,refusalSeen=false,terminalConflict=false,firstByteMarked=false,transportBytes=0;
    let thoughtText='',thoughtSource='',thoughtStart=null,firstContentAt=null,reasoningTokens=null,lastThoughtUiAt=-Infinity;
    let lastReadAt=0,lastDeltaAt=0,readCount=0;
    // A provider may send complete reasoning snapshots instead of append-only deltas.
    // Count cumulative/replayed frames without adding their already-seen prefix again.
    let thoughtSnapshotsMerged=0;
    const startedAt=performance.now();
    const publishMeta=()=>{if(onProgress?.resultMeta)Object.assign(onProgress.resultMeta,{finishReason:finishReason||'unknown',finishKind,receivedDone,refused:refusalSeen,transportBytes,eventCount,badEvents,lastReadAt,lastDeltaAt,readCount});};
    let eventType='message',eventData=[];
    const consumePayload=(payloadText,eventType='message')=>{
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
      const thought=extractProviderThought(payload,true),usageTokens=thinkingUsageTokens(payload);
      if(usageTokens!==null)reasoningTokens=usageTokens;
      if(thought){
        if(thoughtStart===null)thoughtStart=performance.now();
        const incoming=thought.text;
        if(thought.updateMode==='snapshot'){
          // message.reasoning_content is a full message snapshot, not a delta.
          if(thoughtText)thoughtSnapshotsMerged++;
          thoughtText=incoming;
        }else if(thoughtText&&incoming.length>thoughtText.length&&incoming.startsWith(thoughtText)){
          // Some OpenAI-compatible relays incorrectly send an expanding cumulative
          // snapshot in delta.reasoning_content. The existing prefix is not new text.
          thoughtText=incoming;thoughtSnapshotsMerged++;
        }else if(thoughtText.length>=64&&incoming===thoughtText){
          // A repeated whole, substantial frame is almost certainly a replay.
          // Do not suppress normal short repeated deltas (e.g. two identical words).
          thoughtSnapshotsMerged++;
        }else{
          thoughtText+=incoming;
        }
        thoughtSource=thoughtSource||thought.source;
        const uiNow=performance.now();if(uiNow-lastThoughtUiAt>=120){lastThoughtUiAt=uiNow;emitProgress(onProgress,{phase:'thinking',thinkingText:thoughtText,thinkingSource:thoughtSource,detail:thoughtSnapshotsMerged?'已合并上游重复/累计 Thinking 帧；继续等待剧情正文':'已收到上游 Thinking 内容（可能仅为摘要）'});}
      }
      const piece=extractStreamDelta(payload);if(piece){lastDeltaAt=Date.now();if(firstContentAt===null)firstContentAt=performance.now();reply+=piece;emitProgress(onProgress,{phase:'streaming',percent:Math.min(90,58+Math.log10(reply.length+1)*12),receivedChars:reply.length,delta:piece,streamText:reply,detail:`已接收 ${reply.length} 个字符`});}
    };
    // SSE dispatch is defined by a blank line, not by each data: field.
    // Some nonconforming relays omit the separators: preserve their former
    // single-line behavior when every data field is independently valid JSON.
    const flushEvent=()=>{
      if(!eventData.length){eventType='message';return;}
      const parts=eventData;const kind=eventType;eventData=[];eventType='message';
      const joined=parts.join('\n');
      if(parts.length>1){
        let validTogether=false;try{JSON.parse(joined);validTogether=true;}catch(_){}
        if(!validTogether&&parts.every(part=>part==='[DONE]'||(()=>{try{JSON.parse(part);return true}catch(_){return false}})())){
          for(const part of parts)consumePayload(part,kind);return;
        }
      }
      consumePayload(joined,kind);
    };
    const consumeLine=line=>{
      const raw=String(line??'');if(raw===''){flushEvent();return;}
      if(raw.startsWith(':'))return;
      if(raw.startsWith('event:')){eventType=raw.slice(6).trim()||'message';return;}
      if(raw.startsWith('data:')){eventData.push(raw.slice(5).replace(/^ /,''));return;}
      if(raw.trimStart().startsWith('{')){flushEvent();consumePayload(raw.trim());}
    };
    try{
      while(true){const {done,value}=await reader.read();lastReadAt=Date.now();readCount++;if(done)break;transportBytes+=value?.byteLength||0;if(!firstByteMarked){firstByteMarked=true;onProgress?.onTiming?.('first_byte',{chunkBytes:value?.byteLength||0});emitProgress(onProgress,{phase:'stream_transport',percent:56,receivedChars:0,transportBytes,detail:'已收到响应体数据，仍等待第一段可见正文（0 字）'});}buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)consumeLine(line)}
      buffer+=decoder.decode();if(buffer)for(const line of buffer.split(/\r?\n/))consumeLine(line);
      flushEvent();
    }catch(e){
      publishMeta();
      if(reply&&e&&typeof e==='object')e.partialDraft=reply.slice(0,24000);
      if(e?.name==='AbortError'||e instanceof ApiError)throw e;
      // Some browsers throw TypeError from reader.read() even if our own
      // AbortController initiated the shutdown. Keep user stop distinct.
      if(onProgress?.signal?.aborted){
        const aborted=new DOMException('已主动停止生成','AbortError');aborted.partialDraft=reply.slice(0,24000);throw aborted;
      }
      try{onProgress?.onTiming?.('stream_read_error',{transportStage:'stream_read',lastReadAt,lastDeltaAt,receivedChars:reply.length,
        receivedBytes:transportBytes,eventCount,badEvents,readCount,signalAborted:false,
        visibility:typeof document!=='undefined'?document.visibilityState:'unknown',
        errorName:String(e?.name||'unknown').slice(0,60),errorMessage:String(e?.message||e).slice(0,160)});}catch(_){}
      // The response headers were already received. A later body read failure
      // is not evidence of a fetch-before-response CORS failure, even when
      // Safari reports the same TypeError('Load failed') for both situations.
      throw Object.assign(new ApiError('E_STREAM_INTERRUPTED',reply
        ?`流式连接在接收 ${reply.length} 字符后异常终止。未将部分文本当成角色回复。`
        :'已收到 HTTP 响应头，但流式正文未完整传输；本轮没有确认收到可恢复的正文字符。',{
          status:res.status,details:`stage: stream_read; receivedChars: ${reply.length}; receivedBytes: ${transportBytes}; events: ${eventCount}; malformedEvents: ${badEvents}; reads: ${readCount}; lastReadAt: ${lastReadAt||'unknown'}; lastDeltaAt: ${lastDeltaAt||'unknown'}; visibility: ${typeof document!=='undefined'?document.visibilityState:'unknown'}; signalAborted: ${!!onProgress?.signal?.aborted}; cause: ${String(e?.name||'unknown').slice(0,60)}: ${String(e?.message||String(e)).slice(0,160)}`,
          hint:'响应头成功不代表正文生成成功。请核对本机流式片段账本；没有片段时无法恢复文字。不要自动重复计费。'
        }),{partialDraft:reply.slice(0,24000)});
    }
    onProgress?.onTiming?.('last_delta',{receivedChars:reply.length,events:eventCount,receivedDone});
    if(!reply&&finalPayload){try{reply=extractReply(finalPayload)}catch(e){if(e instanceof ApiError&&e.code==='E_API_UPSTREAM')throw e;}}
    publishMeta();
    if(refusalSeen){const issue=new ApiError('E_API_REFUSAL','流式响应包含明确拒绝字段，未提交角色回复。',{status:res.status,details:JSON.stringify({stage:'provider_terminal_admission',finishKind,finishReason,eventCount})});issue.partialDraft=reply.slice(0,24000);throw issue;}
    if(terminalConflict){const issue=new ApiError('E_API_TERMINAL_CONFLICT','响应包含相互矛盾的终止状态，无法证明正文完整。',{status:res.status,details:JSON.stringify({stage:'provider_terminal_admission',finishKind,finishReason,eventCount})});issue.partialDraft=reply.slice(0,24000);throw issue;}
    if(!reply&&finishKind!=='unknown')assertFinishState({finishKind,finishReason},0);
    if(!reply)throw new ApiError(badEvents?'E_STREAM_PARSE':'E_API_EMPTY_REPLY',badEvents?'模型流包含无法解析的数据，未获得正文。':'流式请求结束，但模型没有返回可见正文。',{status:res.status,details:`stage: ${badEvents?'stream_parse':'stream_eof'}; stream events: ${eventCount}; malformed events: ${badEvents}`});
    if(onProgress?.resultMeta){onProgress.resultMeta.finishReason=finishReason||'unknown';onProgress.resultMeta.finishKind=finishKind;onProgress.resultMeta.receivedDone=receivedDone;}
    // A known malformed event must not be re-labelled as a clean EOF.
    // A verified provider length/safety terminal, however, keeps its actual
    // classification even when unrelated malformed auxiliary frames exist.
    if(badEvents&&finishKind==='unknown')throw Object.assign(new ApiError('E_STREAM_PARSE','收到无法解析的流式事件；不能证明正文完整。',{status:res.status,details:`stage: stream_parse; malformedEvents: ${badEvents}; receivedChars: ${reply.length}; receivedBytes: ${transportBytes}; events: ${eventCount}; receivedDone: ${receivedDone}`}),{partialDraft:reply.slice(0,24000)});
    if(!receivedDone&&finishKind==='unknown')throw Object.assign(new ApiError('E_STREAM_INTERRUPTED','流式响应已结束，但缺少完成标记，未提交部分正文。',{status:res.status,details:`stage: stream_eof; receivedChars: ${reply.length}; receivedBytes: ${transportBytes}; events: ${eventCount}; receivedDone: false`}),{partialDraft:reply.slice(0,24000)});
    // [DONE] terminates transport, not provider admission.
    if(!(allowIncompleteDraft&&finishKind==='truncated'))try{assertFinishState({finishKind,finishReason},reply.length)}catch(e){e.partialDraft=reply.slice(0,24000);throw e;}
    if(badEvents)throw Object.assign(new ApiError('E_STREAM_PARSE','收到无法解析的流式事件；不能证明正文完整。',{status:res.status,details:`stage: stream_parse; malformedEvents: ${badEvents}; receivedChars: ${reply.length}; receivedBytes: ${transportBytes}; receivedDone: ${receivedDone}`}),{partialDraft:reply.slice(0,24000)});
    if(thoughtText)emitProgress(onProgress,{phase:'thinking',thinkingText:thoughtText,thinkingSource:thoughtSource,detail:'上游 Thinking 内容接收完成'});
    if(streamUsage)emitProgress(onProgress,{phase:'cache_usage',percent:92,detail:streamUsage.cachedTokens>0?`上游报告缓存命中 ${streamUsage.cachedTokens} tokens`:'上游返回 usage',usage:clone(streamUsage)});
    if(onProgress?.resultMeta){onProgress.resultMeta.finishReason=finishReason||'unknown';onProgress.resultMeta.finishKind=finishKind;onProgress.resultMeta.receivedDone=receivedDone;
      onProgress.resultMeta.thinking={kind:'provider_returned',source:thoughtSource||null,text:thoughtText,reasoningTokens,thoughtSnapshotsMerged,
        observedThinkingMs:thoughtStart!==null&&firstContentAt!==null?Math.max(0,Math.round(firstContentAt-thoughtStart)):null,
        firstContentWaitMs:firstContentAt!==null?Math.max(0,Math.round(firstContentAt-startedAt)):null,
        totalResponseMs:Math.max(0,Math.round(performance.now()-startedAt)),
        timingNote:'客户端观测值；不是供应商内部推理总用时'};}
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
  // No program-authored character/roleplay presentation instruction is appended
  // to ordinary story messages. Prompt ownership belongs to the user's mounts.
  // Earlier releases did append one of two precise, one-line English suffixes.
  // Strip those generated suffixes ONLY when replaying an old frozen snapshot;
  // never rewrite ordinary authored prompts or canonical history.
  function stripRetiredStoryProtocol(body){
    const messages=body?.messages;
    if(!Array.isArray(messages))return body;
    const index=messages.map(m=>m?.role).lastIndexOf('system');
    if(index<0||typeof messages[index]?.content!=='string')return body;
    const value=messages[index].content;
    const suffix=/\n\nRoleplay presentation rule: (?:Maintain the established character's subjective consciousness, perception and knowledge\.|Output only the complete in-world narrative response according to the existing scene and formatting contract\.)[^\n]*?(?:never add required new tags or alter existing response structure\.|This instruction does not disable the provider's internal reasoning\.)$/;
    if(!suffix.test(value))return body;
    const clean=value.replace(suffix,'');
    if(clean)messages[index].content=clean;
    else messages[index].content=''; // retain snapshot source index identity
    return body;
  }
  function thinkingText(value){
    if(typeof value==='string')return value;
    if(Array.isArray(value))return value.map(thinkingText).join('');
    if(value&&typeof value==='object'){
      if(typeof value.text==='string')return value.text;
      if(typeof value.summary==='string')return value.summary;
      if(typeof value.content==='string')return value.content;
      if(Array.isArray(value.content))return value.content.map(thinkingText).join('');
      if(Array.isArray(value.parts))return value.parts.map(thinkingText).join('');
    }
    return '';
  }
  function extractProviderThought(payload,stream=false){
    const choice=payload?.choices?.[0]||{};
    const isDelta=stream&&choice.delta&&typeof choice.delta==='object';
    const msg=stream?(isDelta?choice.delta:(choice.message||{})):(choice.message||{});
    let source='';let value='';
    // These are alternative provider aliases for the SAME reasoning payload.
    // Concatenating every nonempty alias repeats one chunk two or four times.
    for(const key of ['reasoning_content','reasoning','thinking','thoughts']){
      const candidate=thinkingText(msg[key]);if(candidate){value=candidate;source=key;break;}
    }
    const content=msg.content;
    const parts=Array.isArray(content)?content:Array.isArray(content?.parts)?content.parts:[];
    const partText=parts.filter(part=>part?.thought===true||['reasoning','thinking'].includes(part?.type)).map(thinkingText).join('');
    if(partText){
      if(!value){value=partText;source='thought_part';}
      else if(!value.includes(partText)&&!partText.includes(value))value+=partText;
    }
    return value?{text:value,source,updateMode:isDelta?'delta':'snapshot'}:null;
  }
  function thinkingUsageTokens(payload){const u=payload?.usage||payload?.usageMetadata||payload?.usage_metadata||{};
    return finiteUsageNumber(u.completion_tokens_details?.reasoning_tokens,u.reasoning_tokens,u.thoughtsTokenCount,u.thoughts_token_count,u.output_token_details?.reasoning_tokens);
  }
  function makeApiBody(messages,cfg,temperature,options={}){
    if(options.requestBody)return stripRetiredStoryProtocol(clone(options.requestBody));
    const body={model:cfg.model,messages:options.continuation?continuationProjection(messages,cfg):clone(messages)};
    if(options.storyThinking===true&&['low','medium','high'].includes(cfg.reasoningEffort))body.reasoning_effort=cfg.reasoningEffort;
    // Optional, explicit Google-compatible extension. Unsupported proxies must
    // report an HTTP failure; never retry silently with altered semantics.
    if(options.storyThinking===true&&cfg.requestGeminiThoughts===true)
      body.extra_body={google:{thinking_config:{include_thoughts:true}}};
    const stream=options.streamOverride===undefined?!!cfg.stream:!!options.streamOverride;
    if(stream)body.stream=true;
    if(cfg.sendTemperature!==false)body.temperature=clampTemp(temperature);
    if(cfg.sendTopP===true)body.top_p=Number(cfg.topP);
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
    for(const key of ['stream','temperature','top_p','max_tokens','reasoning_effort','extra_body'])if(Object.hasOwn(body,key))safe[key]=clone(body[key]);
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
    for(const key of ['stream','temperature','top_p','max_tokens','reasoning_effort','extra_body'])if(Object.hasOwn(snapshot.requestBody,key))body[key]=clone(snapshot.requestBody[key]);
    return stripRetiredStoryProtocol(body);
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
    const cfg=effectiveRequestConfig(cfgInput);if(!cfg.model)throw new ApiError('E_API_CONFIG','还没有选择/填写 Model（模型）');const {chat}=buildEndpoints(cfg);
    // The actual serialized request, not a UI toggle, decides how its response is parsed.
    // A frozen retry can legitimately carry an earlier stream setting.
    // Direct memory / novel / auxiliary calls do not pass through assemble().
    // They still must never submit input + output above a *declared* window.
    if(Number(cfg.contextWindowTokens)>=4096){
      const output=Number(cfg.maxTokens)>0?Math.floor(Number(cfg.maxTokens)):Math.max(1024,Math.min(4096,Math.floor(Number(cfg.contextWindowTokens)*.5)));
      const estimated=messages.reduce((sum,m)=>{
        if(Array.isArray(m?.content))return sum+m.content.reduce((subtotal,part)=>subtotal+(part?.type==='image_url'?2500:estimateTokens(part?.text||'')),0)+8;
        return sum+estimateTokens(m?.content||'')+8;
      },0);
      if(output>=Math.floor(Number(cfg.contextWindowTokens)*.85)||estimated+output>Math.floor(Number(cfg.contextWindowTokens)*.85))
        throw new ApiError('E_CONTEXT_BUDGET_CONFIG','模型输入与保留输出超过声明的上下文窗口；未请求 Provider。',{
          details:JSON.stringify({estimatedInputTokens:estimated,reservedOutputTokens:output,windowTokens:Number(cfg.contextWindowTokens),stage:options.memoryContext?.stage||'provider_request'}),
          hint:'请检查上下文窗口与 max_tokens 配置；不会自动改变设置或删除 Persona/History。'});
    }
    const body=makeApiBody(messages,cfg,temperature,options),streamEnabled=body.stream===true,serializationStartedAt=Date.now();
    const requestJson=JSON.stringify(body),requestBytes=new TextEncoder().encode(requestJson).byteLength;
    // Record an immutable payload fingerprint and the exact message-role/size
    // shape at the network boundary. NEVER store raw story text or credentials.
    // Repeating a failed stage can now prove whether the same body was sent.
    const payloadShape=Array.isArray(body.messages)?body.messages.map(m=>({role:String(m.role||''),chars:typeof m.content==='string'?m.content.length:null})):[];
    const perfClock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const transportClock=perfClock();
    const requestId=makeId('req'),diag={requestId,jobId:options.memoryContext?.jobId||null,attemptId:options.memoryContext?.attemptId||null,stage:options.memoryContext?.stage||'story',model:body.model,endpointOrigin:(()=>{try{return new URL(chat).origin}catch{return 'unknown'}})(),requestFields:Object.keys(body).sort(),messageCount:body.messages.length,messageShape:payloadShape,requestFingerprint:fingerprint(requestJson),temperaturePresent:Object.hasOwn(body,'temperature'),maxTokens:body.max_tokens??null,topP:body.top_p??null,reasoningEffort:body.reasoning_effort??null,outputLimitMode:cfg.outputLimitMode||'global',geminiThoughts:body.extra_body?.google?.thinking_config?.include_thoughts===true,stream:streamEnabled,requestBytes,serializationElapsedMs:Date.now()-serializationStartedAt,
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
        if(issue.code==='E_API_TRUNCATED'&&Number.isSafeInteger(body.max_tokens)&&body.max_tokens>0)
          issue.hint=`本轮实际发送 max_tokens=${body.max_tokens}（${cfg.outputLimitMode==='model'?'按模型独立':'全局'}输出上限），服务端返回了非正常完成标记。请核对诊断中的 finishReason 与该模型已确认的输出容量；原文仍可从诊断账本手动恢复。`;
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
    emitProgress(options.onProgress,{phase:'requesting',percent:42,streamRequested:streamEnabled,detail:`正在请求 ${cfg.model} · 实际发送${streamEnabled?'流式':'非流式'}参数${streamEnabled?'（stream: true）':''}`});
    const fetchStartedAt=Date.now(),requestStartedAt=new Date(fetchStartedAt).toISOString();
    timing('fetch_start');
    try{options.onDiagnostic?.({type:'fetch_invoked',requestId});}catch(e){console.error('请求尝试状态记录失败，不影响真实发送',e);}
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
    const jsonResponse=/application\/json/i.test(contentType);
    const effectiveResponseMode=streamEnabled?(jsonResponse?'json_fallback':'streaming'):'json';
    try{options.onDiagnostic?.({type:'response_mode',requestId,requestedStream:streamEnabled,actualMode:effectiveResponseMode,responseContentType:contentType.slice(0,100),httpStatus:res.status});}
    catch(e){console.error('响应模式诊断失败，生成不受影响',e);}
    if(streamEnabled&&jsonResponse){
      // A gateway may ignore stream:true and return a complete JSON body. Keep
      // the valid reply and report the real transport mode; never invent deltas.
      emitProgress(options.onProgress,{phase:'stream_fallback',percent:55,streamRequested:true,actualResponseMode:'json',receivedChars:0,
        detail:'已发送 stream:true，但接口返回整包 JSON；本轮只能在接收完整正文后显示，并非实时流式。'});
    }
    if(streamEnabled&&!jsonResponse){
      emitProgress(options.onProgress,{phase:'stream_headers',percent:55,receivedChars:0,detail:`HTTP ${res.status} 响应头已收到；等待第一段模型正文（0 字）…`});
      let firstVisibleMarked=false,lastChars=0;
      const streamProgress=ev=>{if(ev.streamText!==undefined){lastChars=ev.streamText.length;if(!firstVisibleMarked&&lastChars){firstVisibleMarked=true;timing('first_visible_delta',{receivedChars:lastChars});}const projected=prefixResponseText(ev.streamText,body,cfg,true);options.onReceivedText?.(projected);options.onProgress?.({...ev,streamText:projected});}else options.onProgress?.(ev);};
      streamProgress.resultMeta=options.resultMeta;streamProgress.onTiming=timing;streamProgress.signal=signal;try{
        const received=await readStreamingReply(res,streamProgress,cfg.model,options.allowIncompleteDraft===true);
        timing('stream_finish',{receivedChars:received.length});
        const streamed=text(prefixResponseText(received,body,cfg));
        options.onReceivedText?.(streamed);
        if(!streamed)throw new ApiError('E_API_EMPTY_REPLY','前缀续写没有返回新的正文，原回复未改动。');
        try{options.onDiagnostic?.({type:'provider_result',finishKind:options.resultMeta?.finishKind||'unknown',finishReason:options.resultMeta?.finishReason||'unknown',responseChars:streamed.length});}catch(e){console.error('诊断事件回调失败',e);}
        return streamed;
      }catch(e){
        if(options.resultMeta?.finishReason)try{options.onDiagnostic?.({type:'provider_result',finishKind:options.resultMeta.finishKind,finishReason:options.resultMeta.finishReason,responseChars:e?.partialDraft?.length||0});}catch(diagErr){console.error('诊断事件回调失败',diagErr);}
        throw responseFailure(e,'stream',{streamDetails:String(e?.details||'').slice(0,500)});}
    }
    emitProgress(options.onProgress,{phase:'receiving',percent:68,streamRequested:streamEnabled,actualResponseMode:effectiveResponseMode,detail:streamEnabled?'接口未提供流式事件，正在读取完整 JSON 正文…':'模型已响应，正在解析非流式正文…'});
    timing('json_receive_start');
    let data;try{data=await parseJsonResponse(res,'API');}
    catch(e){throw responseFailure(e,'response_body_parse');}
    timing('json_receive_done');
    captureUsageMetrics(data,cfg.model,options.onProgress);
    const ending=finishState(data);
    observedFinish=ending;
    if(options.resultMeta){options.resultMeta.finishReason=ending.reason;options.resultMeta.finishKind=ending.kind;options.resultMeta.refused=!!data?.choices?.[0]?.message?.refusal;options.resultMeta.requestId=requestId;}
    try{options.onDiagnostic?.({type:'provider_result',finishKind:ending.kind,finishReason:ending.reason,responseChars:0});}catch(e){console.error('诊断事件回调失败',e);}
    options.onReceivedText?.(prefixResponseText(contentPiece(data?.choices?.[0]?.message?.content??data?.choices?.[0]?.text??''),body,cfg,true));
    if(ending.kind==='blocked'||ending.kind==='abnormal'){
      const evidence=contentPiece(data?.choices?.[0]?.message?.content??data?.choices?.[0]?.text??'');
      try{assertFinishState({finishKind:ending.kind,finishReason:ending.reason},evidence.length);}
      catch(e){e.partialDraft=evidence.slice(0,24000);throw responseFailure(e,'provider_terminal_admission',{finishKind:ending.kind,finishReason:ending.reason});}
    }
    let reply;try{reply=extractReply(data)}catch(e){throw responseFailure(e,'response_shape',{
      responseShape:Object.keys(data||{}).slice(0,20),messageShape:Object.keys(data?.choices?.[0]?.message||{}).slice(0,20)});}
    reply=text(prefixResponseText(reply,body,cfg));
    options.onReceivedText?.(reply);
    if(options.resultMeta){const returned=extractProviderThought(data);options.resultMeta.thinking={
      kind:'provider_returned',source:returned?.source||null,text:returned?.text||'',reasoningTokens:thinkingUsageTokens(data),
      observedThinkingMs:null,firstContentWaitMs:null,totalResponseMs:Math.max(0,Date.now()-fetchStartedAt),
      timingNote:'非流式响应不可分辨思考用时，显示的是完整响应等待时间'};}
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
  function novelModelConfig(project){const base=getApiConfig(),n=project.modelSettings||{};const cfg=effectiveRequestConfig({...base,model:text(n.model)||base.model,sendTemperature:typeof n.sendTemperature==='boolean'?n.sendTemperature:base.sendTemperature,temperature:n.temperature!==null&&n.temperature!==undefined&&Number.isFinite(Number(n.temperature))?Number(n.temperature):base.temperature,stream:typeof n.streaming==='boolean'?n.streaming:base.stream});if(Number(n.maxTokens)>0){cfg.maxTokens=Number(n.maxTokens);cfg.outputLimitMode='global';}return cfg;}
  function createBlankNovel(body={}){const p=window.MimaNovelEngine.createProjectFromText({title:body.title||'未命名小说',sourceName:'',sourceEncoding:'utf-8',text:''});p.createdFrom='manual';return p;}
  async function patchNovelProject(id,body={}){const p=getNovelProject(id),allowed=['title','activeChapterId','presetIds','worldbookIds','modelSettings','generationSettings','appearance','macroUserMaskId','macroCharMaskId'];for(const k of allowed)if(Object.prototype.hasOwnProperty.call(body,k))p[k]=clone(body[k]);return saveNovelProject(p);}
  function novelAssets(){return{presets:state.presets,worldbooks:state.worldbooks,masks:state.masks,cssPresets:state.cssPresets,themeSettings:state.themeSettings};}
  async function novelPromptPreview(id,body={}){await refreshPersistedResources();const p=getNovelProject(id);return (await window.MimaNovelPromptAssembler.assemble({project:p,presets:state.presets,worldbooks:state.worldbooks,masks:state.masks,directorNote:body.directorNote||'',mode:body.mode||'continue',draftText:body.draftText||''})).inspector;}
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
    await refreshPersistedResources();
    const engine=window.MimaNovelEngine;let p=getNovelProject(id);
    const originalChapterId=p.activeChapterId,createNewChapter=body.newChapter===true&&!body.draftId;
    if(createNewChapter)p=engine.appendNewChapter(p,'');
    const resumeDraft=body.draftId?findDraft(p,body.draftId):null;
    let chapter,gen,draft;
    if(resumeDraft){
      if(['accepted','rejected'].includes(resumeDraft.status))throw new Error('当前 Draft 已终结，不能继续补写');
      draft=resumeDraft;gen=findGeneration(p,draft.generationId);if(!gen)throw new Error('Draft 对应的 Generation 不存在');
      chapter=assertNovelDraftBaseCurrent(p,draft,gen);
      gen.status='generating';draft.status='generating';gen.error='';
    }else{
      chapter=engine.getChapter(p,createNewChapter?p.activeChapterId:(body.chapterId||p.activeChapterId));if(!chapter)throw new Error('未找到续写章节');p.activeChapterId=chapter.id;
      gen=engine.normalizeGeneration({projectId:p.id,chapterId:chapter.id,directorNote:String(body.directorNote||''),minimumChars:Math.max(0,Number(body.minimumChars??p.generationSettings?.minimumChars)||0),status:'generating',inputSnapshot:{chapterRevision:chapter.revision,chapterHash:engine.chapterHash(chapter)}});
      draft=engine.normalizeDraft({projectId:p.id,chapterId:chapter.id,generationId:gen.id,status:'generating'});gen.draftId=draft.id;p.generations.push(gen);p.drafts.push(draft);
    }
    if(Object.prototype.hasOwnProperty.call(body,'directorNote'))gen.directorNote=String(body.directorNote||'');
    if(Object.prototype.hasOwnProperty.call(body,'minimumChars'))gen.minimumChars=Math.max(0,Number(body.minimumChars)||0);
    // Each explicit continuation takes new ownership. A late response from the
    // previous run cannot write into a new run's Draft (even after browser refresh).
    const runIdentity=engine.makeId('novel-run');gen.runIdentity=runIdentity;
    if(createNewChapter){chapter.autoCreatedRunId=runIdentity;chapter.autoCreatedOriginalChapterId=originalChapterId;chapter.autoCreatedInitialTitle=chapter.title;}

    const minimumChars=Math.max(0,Number(gen.minimumChars)||0),maxAppend=Number.isFinite(Number(p.generationSettings?.maxAppendAttempts))?Math.max(0,Math.min(8,Number(p.generationSettings.maxAppendAttempts))):3;
    // Budget/macro validation must run before creating any persistent candidate
    // chapter, so a rejected prompt never leaves an empty chapter behind.
    if(createNewChapter)await window.MimaNovelPromptAssembler.assemble({project:p,presets:state.presets,worldbooks:state.worldbooks,masks:state.masks,directorNote:gen.directorNote,mode:'continue',draftText:'',minimumChars});
    const cfg=novelModelConfig(p);
    if(createNewChapter&&(!cfg.apiBase||!cfg.model))throw new ApiError('E_NOVEL_API_MISSING','小说模型未配置，未创建空章节');
    await saveNovelProject(p);let callsThisRun=0;
    let checkpointTimer=null,checkpointError=null,checkpointSerial=Promise.resolve(),lastCheckpointLength=draft.content.length;
    // All checkpoints and the terminal commit use fresh canonical project state.
    // Never replace unrelated chapter edits, preset mounts, or an accepted Draft.
    function queueCheckpoint(force=false){
      if(checkpointTimer!==null){clearTimeout(checkpointTimer);checkpointTimer=null;}
      const copy={content:String(draft.content||''),updatedAt:draft.updatedAt,status:draft.status,metadata:clone(draft.metadata),genStatus:gen.status,error:gen.error,completedAt:gen.completedAt,attempts:clone(gen.attempts)};
      checkpointSerial=checkpointSerial.then(async()=>{
        if(checkpointError)throw checkpointError;
        const latest=getNovelProject(id),target=findDraft(latest,draft.id),owner=findGeneration(latest,gen.id);
        if(!target||!owner||target.generationId!==gen.id||owner.runIdentity!==runIdentity)throw new ApiError('E_NOVEL_RUN_STALE','小说续写身份已改变，旧请求不能覆盖新的 Draft');
        if(['accepted','rejected'].includes(target.status))throw new ApiError('E_NOVEL_DRAFT_FINAL','草稿已采纳或删除，旧结果不能覆盖');
        if(!copy.content.startsWith(target.content))throw new ApiError('E_NOVEL_DRAFT_CONFLICT','小说草稿已被改写，不允许旧流式片段覆盖用户编辑');
        target.content=copy.content;target.updatedAt=copy.updatedAt;
        target.status=copy.status;target.metadata={...target.metadata,...copy.metadata,checkpointAt:nowIso(),runIdentity};
        owner.status=copy.genStatus;owner.error=copy.error;owner.completedAt=copy.completedAt;owner.attempts=copy.attempts;
        const stored=await saveNovelProject(latest);
        lastCheckpointLength=Math.max(lastCheckpointLength,copy.content.length);
        return stored;
      }).catch(e=>{checkpointError=e;throw e;});
      // A stream progress callback cannot await storage. Consume the rejection
      // here and propagate it explicitly at the terminal boundary.
      checkpointSerial.catch(()=>{});
      return checkpointSerial;
    }
    function scheduleCheckpoint(){
      if(draft.content.length<=lastCheckpointLength||checkpointTimer!==null)return;
      checkpointTimer=setTimeout(()=>{checkpointTimer=null;queueCheckpoint();},650);
    }
    async function flushCheckpoint(){
      if(checkpointTimer!==null||draft.content.length!==lastCheckpointLength||gen.status!=='generating')return queueCheckpoint(true);
      return checkpointSerial;
    }
    try{
      while(true){
        if(checkpointError)throw checkpointError;
        const mode=draft.content?'append':'continue';
        const built=await window.MimaNovelPromptAssembler.assemble({project:p,presets:state.presets,worldbooks:state.worldbooks,masks:state.masks,directorNote:gen.directorNote,mode,draftText:draft.content,minimumChars});
        const before=draft.content;
        const proxy=ev=>{if(ev?.streamText!==undefined){draft.content=engine.appendDraftText(before,ev.streamText||'');draft.updatedAt=nowIso();scheduleCheckpoint();}if(progress)progress({...ev,novelDraftText:draft.content,generationId:gen.id,draftId:draft.id});};
        const resultMeta={};const reply=await callModelWithConfig(built.messages,cfg,cfg.temperature,signal,{streamOverride:cfg.stream,onProgress:proxy,resultMeta,allowIncompleteDraft:true,continuation:mode==='append'});
        draft.content=engine.appendDraftText(before,reply);draft.updatedAt=nowIso();callsThisRun++;
        gen.attempts.push({index:gen.attempts.length,manualResume:!!resumeDraft,chars:engine.countVisibleChars(reply),totalChars:engine.countVisibleChars(draft.content),completedAt:nowIso(),finishReason:resultMeta.finishReason||'unknown'});
        const count=engine.countVisibleChars(draft.content);
        if(resultMeta.refused||resultMeta.finishKind==='truncated'||['length','content_filter','tool_calls'].includes(resultMeta.finishReason)){draft.status='incomplete';draft.metadata={...draft.metadata,finishReason:resultMeta.finishReason||'refusal',achievedChars:count,requiredChars:minimumChars};gen.status='incomplete';gen.completedAt=nowIso();break;}
        if(count>=minimumChars){draft.status='ready';gen.status='ready';gen.completedAt=nowIso();break;}
        if(callsThisRun>=maxAppend+1){draft.status='incomplete';draft.metadata={...draft.metadata,achievedChars:count,requiredChars:minimumChars};gen.status='incomplete';gen.completedAt=nowIso();break;}
        // Persist each completed model request before the next potentially billed append.
        await flushCheckpoint();
      }
      const saved=await flushCheckpoint();
      return{project:saved,draft:findDraft(saved,draft.id),generation:findGeneration(saved,gen.id)};
    }catch(e){
      const count=engine.countVisibleChars(draft.content);draft.status='interrupted';draft.metadata={...draft.metadata,achievedChars:count,requiredChars:minimumChars,error:e?.message||String(e)};gen.status='interrupted';gen.error=e?.message||String(e);gen.completedAt=nowIso();
      let saved=null;try{saved=await flushCheckpoint();}catch(saveError){
        throw new ApiError('E_NOVEL_CHECKPOINT',`续写中断且本地 Draft 保存未确认：${saveError.message}；请查看小说项目中的已保存片段，不要自动重复付费请求`);
      }
      if(count>0)return{project:saved,draft:findDraft(saved,draft.id),generation:findGeneration(saved,gen.id),interrupted:true};
      if(createNewChapter){
        // Remove only our untouched empty candidate. A user edit, another
        // generation, or a changed ownership marker must never be deleted.
        const latest=getNovelProject(id),candidate=engine.getChapter(latest,chapter.id);
        const ownDrafts=latest.drafts.filter(d=>d.chapterId===chapter.id),ownRuns=latest.generations.filter(g=>g.chapterId===chapter.id);
        if(candidate&&candidate.autoCreatedRunId===runIdentity&&candidate.title===chapter.autoCreatedInitialTitle&&candidate.updatedAt===candidate.createdAt&&candidate.revision===chapter.revision&&candidate.segments.length===0&&
           !engine.getChapterText(candidate).trim()&&ownDrafts.length===1&&ownDrafts[0].id===draft.id&&
           ownRuns.length===1&&ownRuns[0].id===gen.id&&latest.chapterOrder.length>1){
          latest.chapters=latest.chapters.filter(c=>c.id!==chapter.id);
          latest.chapterOrder=latest.chapterOrder.filter(x=>x!==chapter.id);
          latest.drafts=latest.drafts.filter(d=>d.id!==draft.id);
          latest.generations=latest.generations.filter(g=>g.id!==gen.id);
          if(latest.activeChapterId===chapter.id)latest.activeChapterId=latest.chapterOrder.includes(originalChapterId)?originalChapterId:latest.chapterOrder[latest.chapterOrder.length-1];
          try{await saveNovelProject(latest)}catch(cleanupError){console.warn('自动新章节回收未完成：保留候选供人工核对',cleanupError)}
        }
      }
      throw e;
    }finally{if(checkpointTimer!==null)clearTimeout(checkpointTimer);}
  }

  // Explicit recovery for a browser-terminated request. Never automatically
  // erase an unknown-running request: the user must confirm this cleanup.
  async function discardEmptyAutoNovelChapter(id,chapterId){
    const engine=window.MimaNovelEngine,p=getNovelProject(id),chapter=engine.getChapter(p,chapterId);
    if(!chapter?.autoCreatedRunId)throw new ApiError('E_NOVEL_NOT_AUTO','仅支持撤销自动创建的候选空章节');
    const drafts=p.drafts.filter(d=>d.chapterId===chapterId),runs=p.generations.filter(g=>g.chapterId===chapterId);
    if(p.chapterOrder.length<=1||chapter.revision!==1||chapter.updatedAt!==chapter.createdAt||
      chapter.title!==chapter.autoCreatedInitialTitle||chapter.segments.length||engine.getChapterText(chapter)||
      drafts.length!==1||runs.length!==1||runs[0].id!==drafts[0].generationId||
      runs[0].runIdentity!==chapter.autoCreatedRunId||String(drafts[0].content||'').length)
      throw new ApiError('E_NOVEL_AUTO_CHANGED','该章节或其 Draft 已变化，为防误删，必须保留；可按正常章节操作处理');
    p.chapters=p.chapters.filter(c=>c.id!==chapterId);
    p.chapterOrder=p.chapterOrder.filter(x=>x!==chapterId);
    p.drafts=p.drafts.filter(d=>d.chapterId!==chapterId);
    p.generations=p.generations.filter(g=>g.chapterId!==chapterId);
    if(p.activeChapterId===chapterId)p.activeChapterId=p.chapterOrder.includes(chapter.autoCreatedOriginalChapterId)?chapter.autoCreatedOriginalChapterId:p.chapterOrder[p.chapterOrder.length-1];
    return saveNovelProject(p);
  }
  async function patchNovelDraft(id,draftId,body={}){const p=getNovelProject(id),d=findDraft(p,draftId);if(!d)throw new Error('未找到草稿');if(d.status==='accepted')throw new Error('已采纳草稿不能再编辑');d.content=String(body.content??d.content);d.updatedAt=nowIso();if(['interrupted','incomplete','generating'].includes(d.status)){d.status='ready';const g=findGeneration(p,d.generationId);if(g){g.runIdentity=window.MimaNovelEngine.makeId('novel-manual-edit');g.status='ready';}}return saveNovelProject(p);}
  async function rejectNovelDraft(id,draftId){const p=getNovelProject(id),d=findDraft(p,draftId);if(!d)throw new Error('未找到草稿');if(d.status==='accepted')throw new Error('已采纳草稿不能删除');d.status='rejected';d.updatedAt=nowIso();const g=findGeneration(p,d.generationId);if(g)g.status='rejected';return saveNovelProject(p);}
  async function regenerateNovelDraft(id,draftId,body={},signal=null,progress=null){
    await refreshPersistedResources();const p=getNovelProject(id),old=findDraft(p,draftId);if(!old)throw new Error('未找到草稿');
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
    const budget=promptBudget(cfg);
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
    const budget=promptBudget(cfg),results=[],referenceTokens=refs.reduce((n,m)=>n+estimateTokens(m.content)+8,0);
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
      // factChunkRounds controls the narrative grouping INSIDE one summary,
      // never the number of paid requests. Read the selected timeline whole.
      const recentRounds=clampInt(opts.recentRounds,1,100000,total),a=opts.scope==='all'?1:Math.max(1,total-recentRounds+1),b=total;
      const tag=`fact_range_${a}_${b}`,source=formatRoundRange(data,a,b,{includeOpening:a===1,session});
      const chunks=memorySourceParts(source,refs,cfg,'facts');
      const leaves=chunks.map((_,i)=>tag+'_part_'+i);
      registerLeaves(chunks,leaves,[a,b]);
      facts[tag]={source,chunks,mergeGraph:memoryMergeGraph(tag,leaves,referenceTokens,budget,cfg,results,[a,b])};
    }
    // Stable topological stages include EVERY paid merge before approval.
    else if(kind==='rolling'){
      if(!budget.verified)throw new ApiError('E_MEMORY_ROLLING_WINDOW_UNVERIFIED','自动滚动记忆未声明真实模型窗口，无法证明合并容量；未进行付费请求。');
      const msgs=session.messages||[],safeWindow=Math.max(18,Number(session.promptSettings?.recentMessageLimit||34)-4);
      const end=msgs.length-safeWindow,start=rollingCoverageStatus(session).start;
      if(end<=start)throw new ApiError('E_MEMORY_ROLLING_NO_SOURCE','滚动记忆无新来源。');
      const sourceParts=rollingSourceParts(session,start,end,25000);
      const source=['【已验证且来源未变更的长期摘要】\n'+(rollingCoverageStatus(session).valid?session.rollingSummary:'(无：原摘要来源已变更，需从原始历史重建)'),
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
    await refreshPersistedSession(id);const original=getSession(id);if(!original)throw new ApiError('E_STORY_SESSION_MISSING','剧情不存在');
    const session=normalizeSession(clone(original)),{records:refs}=await memoryReferenceSnapshotAsync(session);
    const referenceMessages=referencePromptMessages(refs);
    const options={...opts,model:String(opts.model??session.manualMemory.settings.memoryModel??'').trim()};
    const cfg=memoryEffectiveConfig(getApiConfig(),options.model);
    const planned=memoryWorkPlan(kind,session,options,referenceMessages,cfg);
    const digest=await exactDigest({kind,sessionId:id,options:{...options,approvedPlanDigest:undefined},source:planned.core?.source||planned.rolling?.source||Object.values(planned.facts).map(x=>x.source),references:refs,
      api:[cfg.contextWindowTokens,cfg.maxTokens,cfg.model,options.model],planVersion:planned.summary.planVersion,stages:planned.summary.stages});
    return {...planned.summary,digest};
  }
  // Bind each fact part to the exact model-visible characters and their
  // canonical message offsets. A >28k-character utterance can straddle parts;
  // validating both parts against the entire round falsely expands authority.
  function factOutputPlan(messages,requested,roundCount=1,groupRounds=10){
    // Previously each X-round group had its OWN output target. One-call mode
    // must preserve the combined detail budget instead of shrinking N groups
    // into one group's character allowance.
    const groups=Math.max(1,Math.ceil(roundCount/Math.max(1,groupRounds)));
    const advisedChars=requested*groups;
    if(advisedChars>250000)throw new ApiError('E_MEMORY_FACT_TARGET_TOO_LARGE',
      '选中范围的事实记忆目标字数超出单条记忆保存上限；尚未请求模型。请缩小轮数范围或每组字数。');
    return {requestedChars:requested,advisedChars,groupRounds,groups,sourceMessageCount:arr(messages).length};
  }
  async function summarizeFactText(sourceText,targetChars,temp,signal,progress,label='事实记忆',job=null,rangeTag='fact',rangeScope=null,rangeMessages=[],sourceSession=null,groupRounds=10){
    const chunks=(job?.workPlan?.facts?.[rangeTag]?.chunks||memorySourceParts(sourceText,job?.referenceMessages||[])).map(x=>x.text),partials=[];
    // A long message can be split at 28k characters. These identities bind
    // each stage to its actual model-visible slice, not the whole range.
    const partScopes=chunks.map((part,partIndex)=>({...rangeScope,modelVisibleSlice:{partIndex,startOffset:0,endExclusive:part.length,sourceFingerprint:fingerprint(part)}}));
    for(let i=0;i<chunks.length;i++){
      emitProgress(progress,{phase:'memory_fact',percent:12+Math.round(((i+.25)/chunks.length)*62),detail:`${label} · 正在总结 ${i+1}/${chunks.length}`});
      const prompt=[
        {role:'system',content:'你是“咪嘛馆”的事实记忆整理器。只记录输入剧情中明确发生过的事实，不补充、不猜测、不续写，不把推测写成事实。'+MEMORY_TIME_CONTRACT},
        {role:'user',content:`【剧情原文】\n${chunks[i]}\n\n请将上面的剧情整理成高密度“事实记忆”。逐一保留每件独立的已发生事件及其人物、物品、地点、否定、时间关系；同一行为发生两次不能合并成一次。不能杜撰新事件。按时间顺序整理，可以每 ${groupRounds} 轮设一个分类段落，但不得割裂因果；这是一份覆盖所选全部剧情的事实档案，不是让你分别处理各段。建议容量最多约 ${targetChars} 字，但事件完整性高于字数：不能为了压缩而丢掉任何一件事；材料少时更短即可。`}
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
    await refreshPersistedSession(id);const store=window.MimaLocalStore;
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
      opts.memoryStreamMode=['on','off'].includes(opts.memoryStreamMode)?opts.memoryStreamMode:original.manualMemory.settings.memoryStreamMode;
      const cfg=memoryEffectiveConfig(getApiConfig(),opts.model);const configSignature=fingerprint([cfg.apiBase,cfg.chatEndpoint,cfg.model,cfg.sendTemperature,cfg.maxTokens,cfg.stream,original.promptSettings?.historyHtmlMode||'semantic',window.MimaHistoryHtmlProjection?.version||'missing']);
      const {records:referenceRecords,matchedRefs:referenceSelection}=await memoryReferenceSnapshotAsync(original,generationAbort.signal);
      const referenceMessages=referencePromptMessages(referenceRecords);
      const referenceDigest=await exactDigest(referenceRecords);
      // The exact selected-source versions used to build referenceRecords
      // must also match the durable store, before any paid model call begins.
      const referenceContract=store.memoryReferenceContract?.(state,id,referenceSelection);
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
      job=await store.beginMemoryJob({sessionId:id,kind,options:opts,sourceHash,sourceCount:original.messages.length,sourceFingerprint,targetBaseline,configSignature,expectedReferenceContract:referenceContract,referenceSelection});
      job.referenceMessages=referenceMessages;job.referenceDigest=referenceDigest;job.workPlan=proposed;job.effectiveMemoryConfig=cfg;
      await store.checkpointMemoryJob(job,'reference_snapshot',{digest:referenceDigest,selected:referenceRecords.map(x=>({kind:x.kind,id:x.id,authority:x.authority})),chars:referenceMessages.reduce((n,x)=>n+x.content.length,0)});
      // Proof of what this summary ACTUALLY reads. The all-story mode reads
      // every nonempty user/assistant timeline entry, applying configured
      // user-input semantics / HTML semantic projection; it is not the same as
      // injecting ALL story-play system instructions or a byte-identical backup.
      if(kind==='core'){
        const timeline=storyRoundData(original),included=[...timeline.opening,...timeline.rounds.flatMap(r=>r.messages)];
        const source=proposed.core?.source||'';
        await store.checkpointMemoryJob(job,'source_audit',{
          sourceMode:opts.source==='facts'?'saved_facts':'full_eligible_story_timeline',
          canonicalHistoryCount:original.messages.length,timelineMessageCount:included.length,
          timelineRoundCount:timeline.rounds.length,openingMessageCount:timeline.opening.length,
          sourceTextChars:source.length,sourceTextEstimatedTokens:estimateTokens(source),
          sourceProjection:original.promptSettings?.historyHtmlMode==='raw'?'raw_html':'semantic_html_projection',
          userInputSemanticProjection:true,referenceRecords:referenceRecords.length,
          referenceMessageChars:referenceMessages.reduce((n,x)=>n+x.content.length,0),
          fullEligibleTimelineIncluded:opts.source!=='facts',
          stageCount:proposed.summary?.requestCount||0,
          ...(proposed.core?.chunks?{sourceParts:proposed.core.chunks.map(x=>({startOffset:x.startOffset,endExclusive:x.endExclusive}))}:{})
        });
      }
      if(kind==='facts'){
        const timeline=storyRoundData(original),first=opts.scope==='all'?1:Math.max(1,timeline.rounds.length-clampInt(opts.recentRounds,1,100000,timeline.rounds.length)+1);
        const source=Object.values(proposed.facts||{})[0]?.source||'';
        await store.checkpointMemoryJob(job,'source_audit',{
          sourceMode:'selected_story_timeline_single_logical_summary',canonicalHistoryCount:original.messages.length,
          timelineRoundCount:timeline.rounds.length,selectedStartRound:first,selectedEndRound:timeline.rounds.length,
          sourceTextChars:source.length,sourceTextEstimatedTokens:estimateTokens(source),
          sourceProjection:original.promptSettings?.historyHtmlMode==='raw'?'raw_html':'semantic_html_projection',
          referenceRecords:referenceRecords.length,referenceMessageChars:referenceMessages.reduce((n,x)=>n+x.content.length,0),
          stageCount:proposed.summary?.requestCount||0,fullEligibleTimelineIncluded:first===1,
          sourceParts:Object.values(proposed.facts||{})[0]?.chunks.map(x=>({startOffset:x.startOffset,endExclusive:x.endExclusive}))||[]
        });
      }
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
    publishSession(normalizeSession(committed.sessions.find(s=>s.id===job.sessionId)),committed.storeRevision);
    return getSession(job.sessionId);
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
    const reject=(reason)=>{const error=new ApiError('E_MEMORY_OUTPUT_INVALID','记忆正文未通过自动入库检查；生成原文会保存在失败草稿里，旧记忆保持不变。',
      {details:JSON.stringify({stage,reason,finishReason,chars:original.length})});
      error.validationReason=reason;error.candidateForReview=original;throw error;};
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
    let lastVisibleDraft='';
    try{
      const prompt=actualPrompt;
      const memoryCfg=job?.effectiveMemoryConfig||memoryEffectiveConfig(getApiConfig(),job?.options?.model||'');
      if(job){const declared=promptBudget(memoryCfg);const estimated=prompt.reduce((n,m)=>n+estimateTokens(m.content)+8,0);
        if(declared.verified&&estimated>declared.usable)throw new ApiError('E_MEMORY_REFERENCE_BUDGET','记忆请求包含的参考资料超过已配置模型窗口；不会静默裁剪。',{details:JSON.stringify({stage,estimated,usable:declared.usable})});}
      const modelProgress=ev=>{if(typeof ev?.streamText==='string')lastVisibleDraft=ev.streamText;if(job?.progress){emitProgress(job.progress,{...ev,jobId:job.id,attemptId:job.attemptId,stageKey:stage,sourceRange:stageScope||null});}};
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
      // A refused, truncated or format-invalid response is NOT a valid memory.
      // Persist its exact visible body separately, before settling the failed job.
      const rawDraft=String(e.candidateForReview||(lastVisibleDraft.length>String(e.partialDraft||'').length?lastVisibleDraft:e.partialDraft)||'');
      if(rawDraft&&job){
        try{
          await window.MimaLocalStore.putMemoryRejectedDraft(job,stage,rawDraft,{
            reason:e.validationReason||e.code||e.name||'E_MEMORY_INVALID',finishReason:meta.finishReason||'unknown',
            sourceRange:stageScope||null,sourceHash:job.sourceHash||''});
          await checkpoint(job,stage+'_rejected_draft_saved',{chars:rawDraft.length,reason:e.validationReason||e.code||'invalid',finishReason:meta.finishReason||'unknown'});
        }catch(saveError){
          e.rejectedDraftSaveError=String(saveError?.message||saveError);
          e.details=[String(e.details||''),'Rejected draft was not saved: '+e.rejectedDraftSaveError].filter(Boolean).join('\n');
        }
      }
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
    // The selected timeline is one logical summary; split ONLY if the actual
    // configured model context cannot fit it, after the paid plan is approved.
    ranges.push([start,total]);
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
      const outputPlan=factOutputPlan(rangeMessages,targetChars,b-a+1,chunkRounds);
      await checkpoint(job,'fact_range_output_plan',{startRound:a,endRound:b,...outputPlan});
      const content=await summarizeFactText(source,outputPlan.advisedChars,temp,signal,report,`第 ${a}–${b} 轮`,job,rangeTag,rangeScope,rangeMessages,session,chunkRounds);
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
    state=await refreshPersistedSession(id);
    const session=getSession(id);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','剧情已不存在');
    const memory=normalizeManualMemory(session.manualMemory),ids=arr(opts.factIds).map(String),unique=[...new Set(ids)];
    if(unique.length<2||unique.length!==ids.length)throw new ApiError('E_MEMORY_MERGE_SELECTION','至少选择两条不同的事实记忆');
    const facts=unique.map(key=>memory.facts.find(f=>f.id===key));
    if(facts.some(f=>!f))throw new ApiError('E_MEMORY_MERGE_SOURCE_CHANGED','选中的记忆已变化，请刷新');
    facts.sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound);
    const temperature=clampTemp(opts.temperature??memory.settings.summaryTemperature),targetChars=clampInt(opts.targetChars,100,250000,6000);
    const model=String((opts.model??memory.settings.memoryModel)||'').trim();
    const cfg=memoryEffectiveConfig(getApiConfig(),model);
    const {records:referenceSnapshot,matchedRefs:referenceSelection}=await memoryReferenceSnapshotAsync(session,signal);
    const mergeReferenceContract=window.MimaLocalStore?.memoryReferenceContract?.(state,id,referenceSelection);
    if(!mergeReferenceContract)throw new ApiError('E_MEMORY_REFERENCE_CONTRACT_UNAVAILABLE','事实合并参考合同不可用，已中止请求');
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
    const graphRows=[],budget=promptBudget(cfg);
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
      targetChars,temperature,model:cfg.model,referenceDigest:await exactDigest(referenceSnapshot),
      referenceContract:mergeReferenceContract,referenceSelection,outputDigest:await exactDigest(output)});
    emitProgress(progress,{phase:'memory_merge_preview',percent:100,detail:'合并候选已持久保存，原记忆尚未变更'});
    return draft;
  }
  async function commitFactMerge(id,body){
    if(typeof window.MimaLocalStore?.commitFactMerge!=='function')throw new ApiError('E_MEMORY_MERGE_STORE_UNAVAILABLE','合并事务不可用；旧记忆保持不变');
    const stateRecord=await window.MimaLocalStore.commitFactMerge(id,body);
    publishSession(normalizeSession(stateRecord.sessions.find(s=>s.id===id)),stateRecord.storeRevision);return getSession(id);
  }
  async function undoFactMerge(id){
    if(typeof window.MimaLocalStore?.undoFactMerge!=='function')throw new ApiError('E_MEMORY_MERGE_STORE_UNAVAILABLE','合并撤销不可用');
    const stateRecord=await window.MimaLocalStore.undoFactMerge(id);
    publishSession(normalizeSession(stateRecord.sessions.find(s=>s.id===id)),stateRecord.storeRevision);return getSession(id);
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
    const pending=end-rollingCoverageStatus(session).start;
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
    if(unsummarizedEnd<=8||rollingCoverageStatus(session).start>=unsummarizedEnd){if(job)await window.MimaLocalStore.settleMemoryJob(job,'skipped','E_MEMORY_ALREADY_COVERED');return session;}
    const coverage=rollingCoverageStatus(session),start=coverage.start;
    const sourceParts=rollingSourceParts(session,start,unsummarizedEnd,25000);
    const chunk=sourceParts.map(p=>p.text).join('\n');
    if(!chunk.trim()){if(job)await window.MimaLocalStore.settleMemoryJob(job,'skipped','E_MEMORY_SOURCE_EMPTY');return session;}
    emitProgress(progress,{phase:'summary',percent:20,detail:'正在整理较早剧情摘要…'});
    // One scalar rollingSummary replaces all earlier ones; a fixed 1000-char
    // instruction cannot be allowed to erase previously covered events.
    // The model may exceed that soft target; coverage remains the authority.
    const rollingLengthInstruction='优先完整保留旧摘要里仍由剧情原文支持的事件，并加入本次新增的每一个独立事件；不能为了压缩到 1000 字而丢失人物、物品、先后顺序、否定、承诺或发生次数。仅在完整覆盖能够满足时才尽量控制在 1000 字左右；否则允许更长。';
    const p=[{role:'system',content:'你是独立剧情档案助手。只总结实际发生过的剧情，不添加新事实，不混入其他世界。'+MEMORY_TIME_CONTRACT},{role:'user',content:`【已验证旧摘要】\n${coverage.valid?session.rollingSummary:'(无；旧摘要来源失效，本次只能从完整原文重新建立)'}\n\n【本次新增旧剧情】\n${chunk}\n\n请输出更新后的剧情摘要，保留：已发生事件、人物关系变化、身体/心理状态、重要物品与地点、未解决伏笔。${rollingLengthInstruction}`}];
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
    // Explicitly confirmed recovery of a retained provider response is a human
    // override, NOT an automatic model admission. The original rejection,
    // contract settings and raw diagnostic remain intact. Re-running the same
    // (possibly false-positive) format gate here made recovery impossible.
    // All canonical ownership/fingerprint/one-time settlement checks remain in
    // restoreRejectedReply; display still uses the existing Safe HTML sanitizer.
    if(meta.manualRecovery===true)return reply;
    if(meta.outputContract?.completeHtml===true)validateCompleteHtml(reply);
    if(meta.outputContract?.requireHtml===true||meta.outputContract?.completeHtml===true&&meta.outputContract?.strictValues===true){
      const validator=window.MimaHtmlStructure;
      if(!validator?.inspect)throw new ApiError('E_HTML_CONTRACT_RUNTIME_MISSING','HTML 结构校验模块未加载，拒绝伪成功');
      const verdict=validator.inspect(reply,meta.outputContract);
      if(!verdict.ok&&verdict.code==='E_HTML_VALUE_INVALID')throw new ApiError('E_HTML_VALUE_INVALID','回复中的进度数值未满足已开启的严格数值检查。',{details:JSON.stringify({missing:verdict.missing,stage:'story_output_contract'})});
      if(!verdict.ok)throw new ApiError(verdict.code||(verdict.status==='plain_text'?'E_HTML_STRUCTURE_MISSING':'E_HTML_REQUIRED_NODE_MISSING'),
        verdict.status==='config_error'?'HTML 选择器配置无效，请修正长剧情设置；原返回已保留。':verdict.status==='syntax_error'?'回复的 HTML 标签残缺或交叉；原文已保留，未自动重刷收费模型。':'回复缺少主人指定的 HTML 结构；候选已保留在生成诊断中，不会后台重刷收费模型。',{
          details:JSON.stringify({missing:verdict.missing,stage:'story_output_contract'})});
    }
    return reply;
  }
  function validateCompleteHtml(raw){
    // Use the same tokenizer as the opt-in HTML structure inspector. A separate
    // regex stack previously accepted <div/> in text/html and misread JS strings.
    const validator=window.MimaHtmlStructure;
    if(!validator?.rawBalance)throw new ApiError('E_HTML_VALIDATOR_UNAVAILABLE','HTML 检查器未加载，禁止静默放过待验收正文。');
    const check=validator.rawBalance(String(raw??''));
    if(!check.ok)throw new ApiError('E_STORY_OUTPUT_INCOMPLETE','回复未满足已开启的 HTML 完整性检查，未提交残缺正文。',{
      details:JSON.stringify({stage:'story_output_contract',reason:check.reason,offset:check.offset})});
    return raw;
  }
  async function processStoryTurn(id,userText,action='send',signal,temp=.85,options={},progress=null){
    const preparationStartedAt=Date.now();
    // Never assemble from an old in-memory UI snapshot when another tab or
    // independent memory job has already committed to canonical IndexedDB.
    // A failed read is NOT an empty memory store and must abort this request.
    state=await refreshPersistedSession(id);
    let session=getSession(id);
    if(!session)throw new ApiError('E_STORY_SESSION_MISSING','剧本档案丢失猫！',{hint:'本地剧情 Session（剧情会话）不存在或已被删除，请重新打开剧情。'});
    session=normalizeSession(session);
    // A verified UI target is scoped to one immutable transcript snapshot.
    // Refuse a cross-tab change BEFORE a paid Provider call, not after generation.
    if(action==='regenerate'&&options?.expectedSourceFingerprint){
      const actualFingerprint=memorySourceFingerprint(session.messages,session.messages.length);
      if(actualFingerprint!==options.expectedSourceFingerprint||Number(session.recordRevision)!==Number(options.expectedRecordRevision))
        throw new ApiError('E_STORY_REGEN_CANONICAL_CHANGED','核对后剧情又发生变化，已阻止按旧目标重说。',{hint:'重新核对剧情再点「重说」；没有调用模型。'});
    }
    let canonicalFingerprint=null;
    const priorPending=session.pendingGeneration;
    // Prepared/unknown work is a real unresolved transaction. No second paid call
    // or unrelated timeline mutation until a human explicitly fences that attempt.
    if(priorPending?.status==='prepared'&&!(action==='retry'&&options.confirmUnknownTakeover===true))
      throw new ApiError('E_GENERATION_OUTCOME_UNKNOWN','上一轮生成状态不明，未发送新的收费请求。',{hint:'请先免费核对原任务；如仍未知，可自行确认新尝试可能再次计费。'});
    if(action==='retry'&&priorPending?.status==='prepared'&&options.confirmUnknownTakeover!==true)
      throw new ApiError('E_GENERATION_TAKEOVER_CONFIRM_REQUIRED','原任务仍未确认，必须人工同意后才允许新尝试。');
    const retryPending=action==='retry'?session.pendingGeneration:null;
    if(action==='retry'){
      if(!retryPending?.snapshot)throw new ApiError('E_STORY_RETRY_MISSING','没有可重试的未结算请求。');
      canonicalFingerprint=memorySourceFingerprint(session.messages,session.messages.length);
      if(retryPending.canonicalFingerprint!==canonicalFingerprint)throw new ApiError('E_STORY_RETRY_STALE','失败后剧情原文已变化，不能把旧请求提交到新时间线。');
      action=retryPending.action;
      options={...options,targetMessageId:retryPending.targetMessageId};
    }
    emitProgress(progress,{phase:'preparing',percent:8,detail:'正在整理本轮上下文…'});
    // Start a diagnostic BEFORE prompt assembly. Otherwise capacity errors
    // never appear in the owner's request diagnostics at all.
    const journal=window.MimaDiagnosticJournal;
    const diagnosticId=journal?.begin?.({sessionId:id,turnId:options.diagnosticTurnId||'',traceId:options.diagnosticTraceId||'',action,
      attemptId:retryPending?.id||''});
    let diagnosticCandidate='';
    let unsavedUserInput=false,commitStarted=false,submittedMessageId=null;
    if(action==='send'&&!retryPending){
      if(!String(userText||'').trim())throw new ApiError('E_STORY_EMPTY_INPUT','还没有输入内容猫！',{hint:'请输入动作、语言或剧情后再发送。'});
      const originalUserText=String(userText||'');const transformedUserText=await applyRegexForSessionAsync(session,originalUserText,'input',null,{signal});
      const userMsg=makeMessage('user',transformedUserText,session,{source:'manual_send',submissionTraceId:String(options.diagnosticTraceId||''),regexInputApplied:transformedUserText!==originalUserText,inputSemanticMode:inputSemanticMode(session),inputSemanticParserVersion:'1.1.7'});userMsg.rawContent=originalUserText;session.messages.push(userMsg);submittedMessageId=userMsg.id;
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
      requestBody=restoreGenerationRequest(originalSnapshot,promptSession,sourceFingerprint);snapshot=clone(originalSnapshot);stripRetiredStoryProtocol(snapshot.requestBody);
      if(retryPending&&options.retryParameters==='current'){
        // Only the explicitly selected transport parameters change. Lore,
        // memory, presets and player text remain those of the frozen request.
        const frozenMessages=requestBody.messages.map(m=>({role:m.role,content:m.content}));
        requestBody=makeApiBody(frozenMessages,cfg,cfg.temperature??temp,{continuation:action==='continue',storyThinking:true});
        snapshot=generationSnapshot(session,promptSession,requestBody,originalSnapshot.messageSources,action,action==='continue'?target?.id:null,sourceFingerprint);
      }
      emitProgress(progress,{phase:'prompt_ready',percent:34,detail:retryPending?(options.retryParameters==='current'?'保留原轮冻结消息，使用当前 API 模型与参数重试；不重复玩家消息。':'按原模型和参数重试冻结请求；API 设置变更不会改变本次请求。'):'使用原轮冻结上下文重新采样；旧回复与版本不进入请求。'});
    }else{
      built=await assemble(promptSession,{...opts,signal,preserveTerminalAssistant:action==='continue'&&cfg.continuationMode==='deepseek_prefix'});
      requestBody=makeApiBody(built.messages,cfg,temp,{continuation:action==='continue',storyThinking:true});
      snapshot=generationSnapshot(session,promptSession,requestBody,built.messageSources,action,action==='continue'?target?.id:null,sourceFingerprint,built.inspector?.contextTrace);
      const detail=action==='regenerate'&&target&&options.regenerationContext!=='current'?'旧记录没有请求快照，已明确使用当前挂载重建原轮。':action==='continue'?(cfg.continuationMode==='deepseek_prefix'?'按已声明的 prefix 协议请求续写。':'普通 Chat 后续 assistant 生成；接口未声明原文前缀补全，连续性由上下文和玩家预设决定。'):`Prompt（提示词）已组装 · ${requestBody.messages.length} 条消息`;
      emitProgress(progress,{phase:'prompt_ready',percent:34,detail});
    }
    // "Original request" carries its ORIGINAL model. The currently selected
    // channel/model must not silently turn an old replay into a different,
    // unapproved charge or appear as if the new model were being used.
    if(originalSnapshot&&String(requestBody.model)!==String(cfg.model)){
      throw new ApiError('E_GENERATION_FROZEN_MODEL_MISMATCH','旧生成快照绑定的模型与当前 API 设置不同，未发送旧模型请求。',{
        details:JSON.stringify({frozenModel:String(requestBody.model),currentModel:String(cfg.model),requestSent:false,action}),
        hint:'如需使用新模型，请选择「按当前挂载重说」或「按当前 API 参数重试」，不要使用「按原请求重试」；旧剧情和快照保留。'});
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
    // An unverified window cannot be compared against a fabricated limit.
    // Keep the frozen payload byte-for-byte and leave capacity adjudication
    // to the Provider, with no local retry or automatic substitution.
    const currentTransportStream=cfg.stream===true;
    const frozenTransportStream=requestBody.stream===true;
    if(originalSnapshot&&currentTransportStream!==frozenTransportStream){
      emitProgress(progress,{phase:'request_mode_frozen',percent:35,streamRequested:frozenTransportStream,
        detail:`这次沿用原请求快照：${frozenTransportStream?'流式':'非流式'}（当前 API 设置为${currentTransportStream?'流式':'非流式'}）。如需改为当前模式，请选择按当前参数重试/重说。`});
    }
    cfg={...cfg,model:requestBody.model,stream:frozenTransportStream,sendTemperature:Object.hasOwn(requestBody,'temperature'),sendTopP:Object.hasOwn(requestBody,'top_p'),topP:Object.hasOwn(requestBody,'top_p')?requestBody.top_p:cfg.topP,maxTokens:requestBody.max_tokens||0};
    messages=requestBody.messages;
    pending={id:retryPending?.id||makeId('generation'),action,targetMessageId:target?.id||null,snapshot,canonicalFingerprint,status:'prepared',attempt:(retryPending?.attempt||0)+1,
      ownerId:String(options.diagnosticTraceId||''),preparedAt:nowIso()};
    // The new player message and its frozen request share one CAS commit.
    // Both are durable before fetch without rewriting the full library twice.
    commitStarted=true;
    session=await saveSession({...session,pendingGeneration:pending,lastGeneration:{id:pending.id,attempt:pending.attempt,action:pending.action,status:'prepared',preparedAt:pending.preparedAt}});
    emitProgress(progress,{phase:'generation_prepared',generationId:pending.id,attempt:pending.attempt,percent:38,detail:'本轮请求已持久准备；正在进行恢复账本核对。'});
    if(unsavedUserInput){unsavedUserInput=false;emitProgress(progress,{phase:'saved_user',sessionId:id,messageId:submittedMessageId,recordRevision:session.recordRevision,traceId:String(options.diagnosticTraceId||''),generationId:pending.id,attempt:pending.attempt,percent:38,detail:'主人消息与本轮请求已安全写入本地剧情。'});}
    }catch(preparationError){
      // Distinguish local, zero-Provider-call rejection from network/Provider
      // failure and retain it by traceId even if the prompt never existed.
      if(diagnosticId){
        const liveCfg=getApiConfig();
        try{await journal.event(diagnosticId,{type:'preflight_failure',code:preparationError?.code||'E_STORY_PREFLIGHT',
          message:preparationError?.message||String(preparationError),details:preparationError?.details||'',
          model:liveCfg.model,endpointOrigin:(()=>{try{return new URL(liveCfg.apiBase).origin}catch{return ''}})(),
          configuredWindow:Number(liveCfg.contextWindowTokens)||0,sourceCount:session.messages.length,
          requestSent:false,preparationElapsedMs:Date.now()-preparationStartedAt});}
        catch(diagnosticError){console.error('本地预检失败日志保存失败，但保留原始预检错误',{code:preparationError?.code,diagnosticError});}
      }
      // Invalid presets/budget/assembly must not discard a submitted player
      // message. A failed CAS is never retried against newer canonical data.
      if(unsavedUserInput&&!commitStarted){
        try{session=await saveSession(session);emitProgress(progress,{phase:'saved_user',sessionId:id,messageId:submittedMessageId,recordRevision:session.recordRevision,traceId:String(options.diagnosticTraceId||''),percent:14,detail:'主人消息已保留；本轮请求准备失败，尚未发送。'});}
        catch(storageError){console.error('请求准备失败且玩家消息保存失败；未覆盖新时间线',{sessionId:id,error:storageError});}
      }
      throw preparationError;
    }
    const identity={sessionId:id,generationId:pending.id,attempt:pending.attempt};
    const recoverStore=window.MimaLocalStore;
    // Independent IDB record must commit BEFORE a Provider request. A quota failure
    // here refuses the request; it must not mutate History or pretend dispatch success.
    try{
      await recoverStore.generationReceipt(identity,'PREPARED_COMMITTED',{
        ownerId:pending.ownerId,sourceFingerprint:pending.canonicalFingerprint,recordRevision:session.recordRevision});
    }catch(recoveryError){
      try{const latestState=await refreshPersistedSession(id),live=latestState.sessions.find(x=>x.id===id);
        if(live?.pendingGeneration?.id===pending.id&&live.pendingGeneration.attempt===pending.attempt){state=latestState;await saveSession({...live,pendingGeneration:{...live.pendingGeneration,status:'failed',errorCode:'E_GENERATION_RECEIPT_UNAVAILABLE'},lastGeneration:{id:pending.id,attempt:pending.attempt,action:pending.action,status:'failed',preparedAt:pending.preparedAt,settledAt:nowIso(),errorCode:'E_GENERATION_RECEIPT_UNAVAILABLE'}});}}
      catch(err){console.error('恢复账本错误后无法结算 prepared；保留原状态',{sessionId:id,generationId:pending.id,error:err});}
      throw new ApiError('E_GENERATION_RECEIPT_UNAVAILABLE','本地恢复账本无法提交，未向模型发送请求。',{details:String(recoveryError)});
    }
    if(diagnosticId){
      // This association survives a failed/lost request-log row, without
      // exposing text or credentials and without stopping a valid request.
      try{await journal.event(diagnosticId,{type:'generation_prepared',generationId:pending.id,generationAttempt:pending.attempt,
        ownerTraceId:pending.ownerId,model:cfg.model});}catch(error){console.error('生成身份诊断保存失败，独立流式账本仍为恢复来源',{sessionId:id,error});}
    }
    let lastStream='',queuedChars=0,queuedOrdinal=0,persistedChars=0,lastDraftAttemptAt=0,draftDegraded=false;
    let draftTail=Promise.resolve();
    const queueDraft=(force=false)=>{
      if(draftDegraded||lastStream.length<=queuedChars)return;
      if(!force&&lastStream.length-queuedChars<512&&Date.now()-lastDraftAttemptAt<350)return;
      lastDraftAttemptAt=Date.now();
      const chunk=lastStream.slice(queuedChars),offset=queuedChars,seq=queuedOrdinal++;
      queuedChars=lastStream.length;
      draftTail=draftTail.then(async()=>{
        if(draftDegraded)return;
        const receipt=await recoverStore.generationAppendFragment(identity,seq,offset,chunk);
        // Only a committed IndexedDB receipt can advance durable evidence.
        persistedChars=receipt.persistedChars;
      }).catch(err=>{
        if(draftDegraded)return;
        draftDegraded=true;console.error('draft_storage_degraded; canonical 未改动',{sessionId:id,generationId:pending.id,attempt:pending.attempt,persistedChars,stage:'generation_draft_write',error:err});
        emitProgress(progress,{phase:'draft_storage_degraded',detail:'流式草稿保存失败；已保存的剧情未改变，后续片段不再伪称已持久化。'});
      });
    };
    const generationProgress=ev=>{
      if(ev?.streamText!==undefined){const incoming=String(ev.streamText||'');
        if(incoming.length>=lastStream.length&&
          // Provider adapter already appended a verified delta to its own reply.
          // Avoid rescanning the entire cumulative prefix for every SSE chunk.
          ((typeof ev.delta==='string'&&ev.delta.length>0&&incoming.length===lastStream.length+ev.delta.length&&incoming.endsWith(ev.delta))||
            incoming.startsWith(lastStream))){
          lastStream=incoming;queueDraft();
        }else if(incoming!==lastStream)console.warn('流式文本发生非增量替换，拒绝将错误片段拼入暂存',{sessionId:id,generationId:pending.id});
      }
      emitProgress(progress,ev);
    };
    const storyResultMeta={};
    // Diagnostics intentionally live outside state, local-store, History,
    // versions, rolling/core/fact memory and the backup/export contract.
    const storyClock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now(),storyTimelineStart=storyClock();
    const storyMark=(phase,extra={})=>{if(diagnosticId)void journal.event(diagnosticId,{type:'timing',phase,generationId:pending.id,attempt:pending.attempt,elapsedAfterPreparedMs:Math.round((storyClock()-storyTimelineStart)*100)/100,preparationElapsedMs:Date.now()-preparationStartedAt,...extra});};
    storyMark('canonical_snapshot_persisted',{messageCount:messages.length});
    const liveAttemptKey=JSON.stringify(identity);
    inFlightStoryAttempts.add(liveAttemptKey);
    try{
    await recoverStore.generationReceipt(identity,'REQUEST_DISPATCH_ATTEMPT',{requestDispatchAttempted:true,ownerId:pending.ownerId});
    if(diagnosticId)try{await journal.event(diagnosticId,{type:'dispatch_attempt',generationId:pending.id,generationAttempt:pending.attempt,model:cfg.model});}
    catch(error){console.error('付费请求的诊断事件没有保存；不能据此判定未请求模型',{sessionId:id,error});}
    const replyRaw=await callModelWithConfig(messages,cfg,temp,signal,{onProgress:generationProgress,resultMeta:storyResultMeta,requestBody,messageSources:snapshot.messageSources,
      onReceivedText:value=>{diagnosticCandidate=String(value||'');},
      storyContext:{sessionId:id,generationId:pending.id,generationAttempt:pending.attempt,preparationElapsedMs:Date.now()-preparationStartedAt},
      onDiagnostic:event=>{if(diagnosticId)void journal.event(diagnosticId,event);}});
    if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
    diagnosticCandidate=replyRaw;
    // Durable full-size copy is made BEFORE any automatic HTML/format admission.
    // Diagnostic previews are intentionally bounded, but Owner recovery is not.
    if(diagnosticId&&String(replyRaw).trim()){
      try{await journal.retainCandidate(diagnosticId,replyRaw);}
      catch(storageError){throw new ApiError('E_CANDIDATE_PERSIST_FAILED','模型已返回正文，但完整恢复候选无法持久化；不把原文误报为空回复。',{details:String(storageError)});}
    }
    // Non-stream replies have no recoverable intermediate bytes; complete stream
    // fragments are flushed before any canonical admission/settlement.
    if(lastStream){queueDraft(true);await draftTail;}
    storyMark('provider_reply_parsed',{chars:replyRaw.length});
    const admissionMeta={...storyResultMeta,outputContract:session.promptSettings?.outputContract};
    // HTML structure is admitted on the canonical post-output-regex text.
    // Raw transport still checks refusal and the preexisting balanced-HTML
    // option, but existing output-regex transformations may legitimately add
    // the explicitly required structure. Do not discard them before running.
    // Format admission belongs to the post-output-regex canonical reply.
    // A raw transport fragment may be completed by the user's output regex;
    // reject only if the final would-be stored reply violates the contract.
    // Refusal and nonempty response checks still run on the raw transport.
    const rawAdmissionMeta={...admissionMeta,outputContract:{...(admissionMeta.outputContract||{}),completeHtml:false,requireHtml:false}};
    validateStoryReply(replyRaw,rawAdmissionMeta);
    // Hard invariant: never persist a blank assistant message.
    if(!text(replyRaw))throw new ApiError('E_API_EMPTY_REPLY','模型返回空白正文，已阻止写入剧情。');
    storyMark('raw_validated');
    const reply=await applyRegexForSessionAsync(session,replyRaw,'output',null,{signal});
    storyMark('output_regex_done',{chars:reply.length});
    // Keep the complete original provider text for manual recovery if an output
    // regex erases/mangles it. The transformed text is not the raw reply.
    // Output regex is a second admission boundary: it must not turn an
    // accepted provider response into an empty or provider-voice refusal.
    const boundTemplate=session.promptSettings?.outputContract?.templateMessageId
      ?session.messages.find(m=>m.id===session.promptSettings.outputContract.templateMessageId&&m.role==='assistant') : null;
    const canonicalAdmissionMeta={...admissionMeta,outputContract:{...(admissionMeta.outputContract||{}),...(boundTemplate?{templateHtml:boundTemplate.content}:{})}};
    // Admission belongs to the canonical *eventually committed* content.
    // A suffix containing only closing HTML tags is correctly judged after
    // attaching it to the previous assistant message, not as a standalone page.
    const proposedContinuationKind=action==='continue'&&target?window.MimaHtmlStructure?.continuationKind?.(target.content,reply,session.promptSettings?.outputContract):'suffix';
    const wouldCommit=action==='continue'&&target&&proposedContinuationKind==='suffix'?target.content+'\n'+reply:reply;
    validateStoryReply(wouldCommit,canonicalAdmissionMeta);
    if(!text(reply))throw new ApiError('E_API_EMPTY_REPLY','输出正则处理后没有有效角色正文；未提交空白消息。');
    // Display regex MUST NOT run before the canonical save. The transcript's
    // independent, cancellable display queue evaluates it after persistence.
    // An empty renderedContent means "projection not materialized", not empty History.
    storyMark('display_deferred_until_after_canonical');
    if(diagnosticId){
      void (async()=>{try{
        const regexVersions=activeRegexPacks(session).map(p=>({id:p.id,updatedAt:p.updatedAt||'',rules:arr(p.rules).length}));
        const hashes=await Promise.all([replyRaw,reply].map(v=>exactDigest(v)));
        await journal.event(diagnosticId,{type:'transformation_provenance',generationId:pending.id,attempt:pending.attempt,
          regexVersions,raw:{chars:replyRaw.length,sha256:hashes[0]},canonical:{chars:reply.length,sha256:hashes[1]},
          display:{status:'deferred_until_canonical_commit'},admissionStage:'post_output_regex',
          contractMode:session.promptSettings?.outputContract?.structureMode||'legacy'});
      }catch(error){console.warn('回复诊断写入失败，不影响原文入库',{sessionId:id,error});}})();
    }
    emitProgress(progress,{phase:'saving',percent:95,detail:'正在保存角色回复…'});
    // Provider-returned visible reasoning/summary stays in per-reply metadata;
    // never merge it into History.content, prompt construction or memory.
    const thinkingRecord=storyResultMeta.thinking?clone(storyResultMeta.thinking):null;
    const continuationKind=proposedContinuationKind;
    if(action==='continue'&&target&&continuationKind!=='suffix'){
      // A complete next reply is a *new* message; appending two complete status shells
      // would corrupt both. Preserve raw and canonical sources with stable lineage.
      const full=makeMessage('assistant',reply,session,{source:'continue_full_reply',continuedFromMessageId:target.id,generationSnapshot:snapshot});
      full.rawContent=replyRaw;full.renderedContent='';full.metadata={...(full.metadata||{}),...(thinkingRecord?{thinking:thinkingRecord}:{}),continuationMode:continuationKind==='full_reply'?'separate_complete_reply':'separate_ambiguous_status_overlap',previousMessageId:target.id};
      session.messages.push(full);
      storyMark('full_reply_continuation_separated',{previousMessageId:target.id});
    }else if(action==='continue'&&target){
      const i=session.messages.findIndex(m=>m.id===target.id),previousContent=session.messages[i].content,previousRaw=session.messages[i].rawContent||previousContent;archiveVersion(session.messages[i],'continue_before_append');session.messages[i].content=`${previousContent}\n${reply}`;session.messages[i].rawContent=`${previousRaw}\n${replyRaw}`;session.messages[i].renderedContent='';session.messages[i].metadata={...(session.messages[i].metadata||{}),continuedAt:nowIso(),...(thinkingRecord?{thinkingContinuations:[...(session.messages[i].metadata?.thinkingContinuations||[]),thinkingRecord]}:{})};session.messages[i].tokenEstimate=estimateTokens(session.messages[i].content);
    }else if(action==='regenerate'&&target){
      const i=session.messages.findIndex(m=>m.id===target.id);
      if(i<0)throw new ApiError('E_STORY_REGEN_TARGET_MISSING','要重说的那条回复在保存前消失了，已阻止覆盖其他剧情。');
      archiveVersion(session.messages[i],classifyStoryReply(session.messages[i].rawContent||session.messages[i].content).blocked?'legacy_refusal_evidence':'regenerate');session.legacyMemoryQuarantined=true;session.messages[i].content=reply;session.messages[i].rawContent=replyRaw;session.messages[i].renderedContent='';session.messages[i].isEdited=false;const regeneratedMetadata={...(session.messages[i].metadata||{})};delete regeneratedMetadata.thinkingContinuations;session.messages[i].metadata={...regeneratedMetadata,regeneratedAt:nowIso(),regeneratedTargetId:target.id,generationSnapshot:snapshot,thinking:thinkingRecord};session.messages[i].tokenEstimate=estimateTokens(reply);
    }else{
      const assistantMsg=makeMessage('assistant',reply,session,action==='auto_advance'?{source:'auto_advance',directorNote:opts.directorNote,generationSnapshot:snapshot,thinking:thinkingRecord}:{source:'model_reply',generationSnapshot:snapshot,thinking:thinkingRecord});assistantMsg.rawContent=replyRaw;assistantMsg.renderedContent='';session.messages.push(assistantMsg);
    }
    // A memory job may have committed while Provider was generating. Rebase only
    // when the original story prefix has not changed. Never overwrite memory.
    if(action==='continue'&&target&&isManuallyRecoveredReply(sourceBeforeReply.find(m=>m.id===target.id))){
      const continued=session.messages.find(m=>m.id===target.id);continued.metadata.manualRecovery={...continued.metadata.manualRecovery,contentFingerprint:manualReplyFingerprint(continued)};
    }
    const generatedMessages=clone(session.messages);let saved=null;
    for(let commitAttempt=0;commitAttempt<3;commitAttempt++){
      const persisted=await refreshPersistedSession(id);
      const latest=persisted.sessions.find(x=>x.id===id);
      if(signal?.aborted)throw new DOMException('生成已取消，结果未提交','AbortError');
      if(!latest||latest.pendingGeneration?.id!==pending.id||latest.pendingGeneration.attempt!==pending.attempt||latest.pendingGeneration.status!=='prepared'||JSON.stringify(latest.messages)!==JSON.stringify(sourceBeforeReply))throw new ApiError('E_CANONICAL_CONFLICT','生成期间剧情原文被其他操作修改；拒绝以旧回复覆盖新时间线。');
      // Rebase the one generated turn onto a verified current Session. Style,
      // manual memory and other settings changed while thinking are retained.
      state=persisted;
      try{saved=await saveSession({...latest,messages:generatedMessages,pendingGeneration:null,lastGeneration:{id:pending.id,attempt:pending.attempt,action:pending.action,status:'completed',preparedAt:pending.preparedAt,settledAt:nowIso(),resultMessageId:action==='regenerate'&&target?.id?target.id:action==='continue'&&continuationKind==='suffix'&&target?.id?target.id:[...generatedMessages].reverse().find(m=>m.role==='assistant')?.id||null},legacyMemoryQuarantined:latest.legacyMemoryQuarantined||session.legacyMemoryQuarantined},{signal});break;}
      catch(e){if(!String(e?.message||'').includes('E_CANONICAL_CONFLICT')||commitAttempt===2)throw e;}
    }
    storyMark('canonical_committed',{messageCount:saved.messages.length});
    void recoverStore.generationReceipt(identity,'CANONICAL_COMMITTED',{finishKind:storyResultMeta.finishKind||'',finishReason:storyResultMeta.finishReason||'unknown'}).catch(err=>console.error('完成回执独立日志保存失败；canonical 已成功',{sessionId:id,generationId:pending.id,error:err}));
    // Auto summary is a lower-priority independent job; never block Direct Reply.
    queueRollingSummary(id,temp);
    emitProgress(progress,{phase:'done',percent:100,detail:'剧情生成完成。'});
    if(diagnosticId){
      // Canonical settlement already succeeded. Diagnostics are an independent
      // projection and cannot convert a delivered reply into a false failure.
      try{await journal.event(diagnosticId,{type:'settlement',status:'committed',finishKind:storyResultMeta.finishKind,finishReason:storyResultMeta.finishReason});
        void journal.discardCandidate(diagnosticId).catch(error=>console.error('已提交候选清理失败（不影响正式剧情）',error));}
      catch(error){console.error('E_DIAGNOSTIC_COMMIT_DEGRADED：剧情已提交，诊断写入失败；勿重发或重复计费',{sessionId:id,generationId:pending.id,attempt:pending.attempt,error});
        try{emitProgress(progress,{phase:'diagnostic_degraded',detail:'剧情已成功保存，但诊断记录写入失败；无需重新生成。'});}
        catch(uiError){console.error('已提交剧情的辅助进度通知失败；不逆转 canonical',{sessionId:id,generationId:pending.id,error:uiError});}}
    }
    return saved;
    }catch(e){
      queueDraft(true);await draftTail;
      // The independently stored fragments remain readable after a safety
      // terminal/transport error. Never present a storage write failure as saved.
      if(lastStream&&draftDegraded){
        const prior=String(e?.details||'');
        if(e&&typeof e==='object')e.details=(prior+'\nE_STREAM_DRAFT_STORAGE_DEGRADED: 已收到 '+lastStream.length+' 字符，但本机片段写入失败；不能承诺完整保留。').slice(0,7000);
      }
      // Persist only request lifecycle metadata, never rejected model content in canonical data.
      try{
        const persisted=await refreshPersistedSession(id),latest=persisted.sessions.find(x=>x.id===id);
        if(latest?.pendingGeneration?.id===pending.id&&latest.pendingGeneration.attempt===pending.attempt&&latest.pendingGeneration.status==='prepared'){
          state=persisted;await saveSession({...latest,pendingGeneration:{...latest.pendingGeneration,status:'failed',errorCode:e?.code||e?.name||'E_STORY_RUNTIME'},lastGeneration:{id:pending.id,attempt:pending.attempt,action:pending.action,status:e?.name==='AbortError'?'aborted':'failed',preparedAt:pending.preparedAt,settledAt:nowIso(),errorCode:e?.code||e?.name||'E_STORY_RUNTIME'}});
          void recoverStore.generationReceipt(identity,e?.name==='AbortError'?'ABORTED_SETTLED':'FAILED_SETTLED',{errorCode:e?.code||e?.name||'E_STORY_RUNTIME'}).catch(err=>console.error('失败回执记录失败；canonical 已结算',{sessionId:id,generationId:pending.id,error:err}));
        }
      }catch(storageError){console.error('生成失败状态无法保存；原始剧情未作为空库覆盖',{sessionId:id,generationId:pending.id,error:storageError});}
      if(diagnosticId){
        const code=e?.code||'E_STORY_RUNTIME';
        // Keep all received text independently of the bounded error payload.
        const retained=diagnosticCandidate||lastStream||String(e?.partialDraft||'');
        const limited=!diagnosticCandidate&&!lastStream&&typeof e?.partialDraft==='string'&&e.partialDraft.length>=24000;
        if(retained&&!limited)try{await journal.retainCandidate(diagnosticId,retained);}catch(storageError){console.error('完整失败正文保存失败，未伪报保存成功',storageError);}
        try{await journal.event(diagnosticId,{type:'settlement',status:e?.name==='AbortError'?'aborted':code==='E_CANONICAL_CONFLICT'?'conflict':'rejected',
          code,message:e?.message||String(e),details:e?.details||'',httpStatus:e?.status||0,
          rawRejectedReply:retained,rawLimited:limited,finishKind:storyResultMeta.finishKind||'',finishReason:storyResultMeta.finishReason||''});}catch(logError){console.error('诊断失败结算持久化失败（不改变剧情错误原因）',logError);}
      }
      throw e;
    }finally{inFlightStoryAttempts.delete(liveAttemptKey);}
  }
  // Explicit recovery from a lost UI owner. The upstream request can remain
  // billable: this settles ONLY the local canonical lock, never reports API cancel.
  async function abandonUnknownStoryGeneration(id,body={}){
    const store=window.MimaLocalStore;
    const persisted=await refreshPersistedSession(id);
    const session=persisted.sessions.find(s=>s.id===id);
    const pending=session?.pendingGeneration;
    if(!session||!pending||pending.status!=='prepared'||
       pending.id!==String(body.generationId||'')||pending.attempt!==Number(body.attempt))
      throw new ApiError('E_UNKNOWN_GENERATION_IDENTITY_CHANGED','原任务状态已改变，未修改剧情。请免费重新核对。');
    // Releasing a lost request only fences its old commit; it never restores,
    // rewinds or replaces messages. A changed transcript is therefore a reason
    // to RETIRE the obsolete attempt, not to permanently deny release.
    const sourceChanged=pending.canonicalFingerprint!==memorySourceFingerprint(session.messages,session.messages.length);
    const identity={sessionId:id,generationId:pending.id,attempt:pending.attempt};
    // Missing/corrupt recovery store is not proof of missing data. Never claim
    // a successful transition if the independent receipt cannot even be read.
    const recovery=await store.generationRead(identity),oldReceipt=recovery?.receipt||{};
    state=persisted;
    const saved=await saveSession({...session,pendingGeneration:{...pending,status:'failed',errorCode:'E_GENERATION_OWNER_ABANDONED',abandonedAt:nowIso(),sourceChangedAtRelease:sourceChanged},lastGeneration:{id:pending.id,attempt:pending.attempt,action:pending.action,status:'interrupted',preparedAt:pending.preparedAt,settledAt:nowIso(),sourceChangedAtRelease:sourceChanged}});
    // generationReceipt replaces the top-level receipt record. Carry forward
    // transport-dispatch evidence instead of rewriting an attempted paid request
    // as if it was never sent.
    try{await store.generationReceipt(identity,'OWNER_ABANDONED',{
      errorCode:'E_GENERATION_OWNER_ABANDONED',
      ownerId:oldReceipt.ownerId||pending.ownerId,
      sourceFingerprint:oldReceipt.sourceFingerprint||pending.canonicalFingerprint,
      ...(oldReceipt.recordRevision!==undefined?{recordRevision:oldReceipt.recordRevision}:{}),
      ...(oldReceipt.requestDispatchAttempted!==undefined?{requestDispatchAttempted:oldReceipt.requestDispatchAttempted}:{}),
      ...(oldReceipt.finishKind!==undefined?{finishKind:oldReceipt.finishKind}:{})
    });}
    catch(error){console.warn('本机已解锁，恢复回执的辅助更新失败；原草稿未清空',{sessionId:id,error});}
    return saved;
  }
  // An HTML-invalid Provider reply is not a canonical assistant message. This
  // pathway repairs the durable rejected diagnostic without a second API call,
  // and still settles the original failed generation exactly once.
  async function prepareRejectedHtmlRepair(id,diagnosticId){
    const record=await window.MimaDiagnosticJournal.recoveryCandidate(diagnosticId);
    if(record.sessionId!==id||String(record.action||'').startsWith('compat_'))throw new ApiError('E_HTML_REPAIR_OWNER','诊断不属于原生剧情。');
    state=await refreshPersistedSession(id);
    const session=getSession(id),pending=session?.pendingGeneration;
    if(!pending||pending.id!==record.generationId||pending.attempt!==record.generationAttempt||pending.status!=='failed'||pending.action!==record.action||
      pending.canonicalFingerprint!==memorySourceFingerprint(session.messages,session.messages.length))
      throw new ApiError('E_HTML_REPAIR_RECOVERY_STALE','失败生成已更换或剧情变化，不生成过期候选。');
    const source=await window.MimaDiagnosticJournal.candidatePreview(record.id);
    if(!source.complete||!source.raw?.trim())throw new ApiError('E_HTML_REPAIR_RAW_INCOMPLETE','诊断缺少完整的原始正文，不允许猜测或补造。');
    const raw=source.raw;
    const contract=session.promptSettings?.outputContract||{};
    const template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    const validator=window.MimaHtmlStructure;
    if(!validator?.repairAttempt)throw new ApiError('E_HTML_REPAIR_RUNTIME_MISSING','本地 HTML 修复模块未加载');
    // Prefer an exact lexical suffix fix over reconstructing a body/template.
    // If lexical closure is impossible, retain the legacy template restoration.
    const attempt=validator.repairAttempt(raw,template?.content,contract),repairMode=attempt.repairMode;
    const templateDependent=repairMode==='template_restore'||contract.strictTemplatePath===true&&!!template;
    const templateDigest=templateDependent?await exactDigest({content:template.content,contract}):'';
    const messageId='rejected_'+record.id;
    const candidate={version:1,sessionId:id,messageId,recoveryDiagnosticId:record.id,recoveryGenerationId:pending.id,
      recoveryAttempt:pending.attempt,baseContentDigest:await exactDigest({raw,canonicalFingerprint:pending.canonicalFingerprint}),
      templateMessageId:templateDependent?template.id:null,templateDigest,contractDigest:await exactDigest(contract),repairMode,
      proposedContent:attempt.proposedContent,oldContent:raw,repairActions:attempt.repairActions,
      confidence:attempt.confidence,missingFields:attempt.missingFields,provenance:'code_generated_recovery',state:'pending',createdAt:nowIso()};
    candidate.id=await exactDigest({id,messageId,baseContentDigest:candidate.baseContentDigest,templateDigest,proposedContent:candidate.proposedContent});
    await window.MimaLocalStore.putHtmlRepairCandidate(candidate);
    return candidate;
  }
  async function restoreRejectedReply(id,body={}){
    if(body.confirmed!==true)throw new ApiError('E_REPLY_RECOVERY_CONFIRM','请先确认将已收到的文本手动恢复到原剧情。');
    const record=await window.MimaDiagnosticJournal.recoveryCandidate(body.diagnosticId,{allowPartial:body.allowPartial===true&&!body.htmlCandidateId,allowUnsettled:body.allowUnsettled===true&&!body.htmlCandidateId});
    if(record.sessionId!==id||String(record.action||'').startsWith('compat_'))throw new ApiError('E_REPLY_RECOVERY_OWNER','诊断不属于这个原生剧情。');
    const persisted=await refreshPersistedSession(id),sourceSession=persisted.sessions.find(s=>s.id===id),session=sourceSession?normalizeSession(clone(sourceSession)):null;
    if(!session)throw new ApiError('E_STORY_SESSION_MISSING','原剧情已删除，未重建或覆盖存档。');
    const previous=session.messages.find(m=>m.metadata?.manualRecovery?.diagnosticId===record.id||arr(m.metadata?.manualRecoveryIds).includes(record.id)||
      (m.metadata?.manualRecovery?.generationId===record.generationId&&m.metadata?.manualRecovery?.attempt===record.generationAttempt));
    if(previous)return {session,messageId:previous.id,alreadyRestored:true,action:record.action};
    const currentPending=session.pendingGeneration;
    const originalStillCurrent=!!record.generationId&&!!currentPending&&currentPending.id===record.generationId&&currentPending.attempt===record.generationAttempt&&
      (currentPending.status==='failed'||(body.allowUnsettled===true&&currentPending.status==='prepared'&&['requesting','provider_returned'].includes(record.status)))&&currentPending.action===record.action;
    // A second failed attempt can replace the pending generation even though the
    // original send's saved user message is STILL the last canonical message.
    // The Owner may explicitly append that retained response exactly once. Never
    // overwrite a newer assistant, append after another user, or steal an active
    // request; storage CAS still protects multi-tab mutations at commit time.
    const lastMessage=session.messages.at(-1);
    const olderSendAppend=!originalStillCurrent&&body.recoverSupersededAsLatest===true&&record.action==='send'&&
      !!record.traceId&&lastMessage?.role==='user'&&lastMessage.metadata?.submissionTraceId===record.traceId&&
      (!currentPending||['failed','aborted'].includes(currentPending.status));
    if(!originalStillCurrent&&!olderSendAppend)
      throw new ApiError('E_REPLY_RECOVERY_STALE','原失败任务已被新尝试替换；若原用户发言仍是当前最后一条且新任务已结束，可在明确确认后补回独立回复。否则请从诊断下载原文，禁止覆盖新剧情。');
    const pending=olderSendAppend?{id:record.generationId,attempt:record.generationAttempt,action:'send',status:'failed',
      canonicalFingerprint:memorySourceFingerprint(session.messages,session.messages.length),snapshot:null,preparedAt:record.createdAt}:currentPending;
    if(body.allowUnsettled===true&&pending.status==='prepared'){
      const identity={sessionId:id,generationId:pending.id,attempt:pending.attempt};
      if(inFlightStoryAttempts.has(JSON.stringify(identity)))
        throw new ApiError('E_GENERATION_STILL_ACTIVE','原任务在当前页面仍在生成或结算，禁止手动抢先恢复。');
      const retained=await window.MimaLocalStore.generationRead(identity);
      if(!retained.complete||(!retained.text&&record.recoverySource!=='full_candidate'))
        throw new ApiError('E_GENERATION_RECEIPT_INCOMPLETE','本机账本不完整，不能将未知请求当作成功恢复。');
      if(record.recoverySource!=='full_candidate'&&record.rawRejectedReply!==retained.text)
        throw new ApiError('E_GENERATION_RECOVERY_SOURCE_MISMATCH','恢复文本与原流式账本不一致，已阻止错写剧情。');
    }
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
      if(c.contractDigest!==await exactDigest(contract))throw new ApiError('E_HTML_REPAIR_CONTRACT_CHANGED','合同已变化，拒绝使用旧候选。');
      if(c.repairMode==='tag_closure'){
        // Recompute against the immutable Provider raw: exact equality and a
        // complete closing-tag grammar are required at commit time.
        const closureTemplate=c.templateMessageId?session.messages.find(x=>x.id===c.templateMessageId):null;
        if(c.templateMessageId&&(!closureTemplate||c.templateDigest!==await exactDigest({content:closureTemplate.content,contract})))throw new ApiError('E_HTML_REPAIR_TEMPLATE_STALE','模板已变化。');
        const fresh=window.MimaHtmlStructure.repairAttempt(raw,closureTemplate?.content,contract);
        if(fresh.proposedContent!==c.proposedContent||fresh.oldContent!==raw||c.missingFields?.length)
          throw new ApiError('E_HTML_REPAIR_SOURCE_CHANGED','原文或补全算法结果不匹配');
        recoveredContent=fresh.proposedContent;
      }else{
        const template=session.messages.find(x=>x.id===c.templateMessageId);
        if(!template||c.templateDigest!==await exactDigest({content:template.content,contract})||
          window.MimaHtmlStructure.propose(raw,template.content,contract).proposedContent!==c.proposedContent)
          throw new ApiError('E_HTML_REPAIR_TEMPLATE_STALE','模板或结构已变化，拒绝修复。');
        try{recoveredContent=window.MimaHtmlStructure.finalizeProposal(raw,template.content,contract,c.proposedContent,body.dynamicValues||{});}
        catch(error){throw new ApiError('E_HTML_REPAIR_OWNER_CONFIRMATION_REQUIRED',String(error.message||error));}
      }
      htmlRepair=c;
    }
    validateStoryReply(recoveredContent,{manualRecovery:true,outputContract:session.promptSettings?.outputContract});
    let target=pending.targetMessageId?session.messages.find(m=>m.id===pending.targetMessageId&&m.role==='assistant'):null;
    if((action==='continue'||pending.targetMessageId)&&!target)throw new ApiError('E_REPLY_RECOVERY_TARGET','原回复目标已不存在，未覆盖其他消息。');
    state=persisted;
    const recoveryContinuationKind=action==='continue'&&target?window.MimaHtmlStructure?.continuationKind?.(target.content,recoveredContent,session.promptSettings?.outputContract):'suffix';
    if(target&&action==='continue'&&recoveryContinuationKind!=='suffix'){
      const originalTarget=target;
      target=makeMessage('assistant',recoveredContent,session,{source:'manual_diagnostic_recovery',continuedFromMessageId:originalTarget.id});
      target.rawContent=raw;target.isEdited=!!htmlRepair;target.metadata={...(target.metadata||{}),continuationMode:recoveryContinuationKind==='full_reply'?'separate_complete_reply':'separate_ambiguous_status_overlap',previousMessageId:originalTarget.id};
      session.messages.push(target);
    }else if(target&&(action==='continue'||action==='regenerate')){
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
      manualRecovery:{diagnosticId:record.id,generationId:pending.id,attempt:pending.attempt,action,restoredAt:nowIso(),providerFinishReason:record.finishReason||'',partialCapture:record.recoveryIsPartial===true,recoverySource:record.recoverySource,formatCheckOwnerOverride:!htmlRepair,olderSendAppend:olderSendAppend===true,originalRejectionCode:String(record.error?.code||''),contentFingerprint:manualReplyFingerprint(target)}};
    target.renderedContent='';target.tokenEstimate=estimateTokens(target.content);
    // Explicit human action only: no Provider, retry or background summary.
    let saved;
    if(htmlRepair){
      const normalized=normalizeSession({...session,pendingGeneration:null,lastGeneration:{id:pending.id,attempt:pending.attempt,action,preparedAt:pending.preparedAt,settledAt:nowIso(),status:'completed',resultMessageId:target.id,manualRecovery:true},legacyMemoryQuarantined:true,updatedAt:nowIso()});
      const initialRecordRevision=Number(session.recordRevision)||0;
      normalized.recordRevision=initialRecordRevision+1;
      const committed=await window.MimaLocalStore.commitHtmlRepair(normalized,Number(persisted.storeRevision)||0,id,htmlRepair.messageId,htmlRepair.id,initialRecordRevision);
      saved=publishSession(normalizeSession(committed.session),committed.storeRevision);
    }else saved=await saveSession({...session,pendingGeneration:null,lastGeneration:{id:pending.id,attempt:pending.attempt,action,preparedAt:pending.preparedAt,settledAt:nowIso(),status:'completed',resultMessageId:target.id,manualRecovery:true},legacyMemoryQuarantined:true});
    return {session:saved,messageId:target.id,alreadyRestored:false,action};
  }
  async function restoreFailedStreamLedger(id,body={}){
    if(body.confirmed!==true||body.allowPartial!==true)throw new ApiError('E_LEDGER_RECOVERY_CONFIRM','必须确认仅恢复本机实际保存的片段，不能补造末尾。');
    const generationId=String(body.generationId||''),attempt=Number(body.attempt);
    if(!generationId||!Number.isSafeInteger(attempt)||attempt<1)throw new ApiError('E_GENERATION_IDENTITY_INVALID','原请求身份无效。');
    const persisted=await refreshPersistedSession(id);
    const rawSession=persisted.sessions.find(s=>s.id===id),session=rawSession?normalizeSession(clone(rawSession)):null;
    if(!session)throw new ApiError('E_STORY_SESSION_MISSING','剧情已不存在，不能恢复到别的剧情。');
    const recovered=session.messages.find(m=>m.metadata?.manualRecovery?.generationId===generationId&&m.metadata?.manualRecovery?.attempt===attempt);
    if(recovered)return {session,messageId:recovered.id,alreadyRestored:true,action:'send'};
    const pending=session.pendingGeneration;
    if(!pending||pending.id!==generationId||pending.attempt!==attempt||pending.action!=='send'||pending.status!=='failed'||
      session.lastGeneration?.status!=='failed'||session.lastGeneration?.id!==generationId||session.lastGeneration?.attempt!==attempt)
      throw new ApiError('E_LEDGER_RECOVERY_STALE','本轮不再是最近一次已结算的失败发送；未覆盖新剧情。');
    if(inFlightStoryAttempts.has(JSON.stringify({sessionId:id,generationId,attempt})))
      throw new ApiError('E_GENERATION_STILL_ACTIVE','原请求仍在本窗口执行，不允许抢先恢复。');
    if(pending.canonicalFingerprint!==memorySourceFingerprint(session.messages,session.messages.length))
      throw new ApiError('E_CANONICAL_CONFLICT','剧情正文已经变化，不能插入旧片段。');
    const last=session.messages.at(-1);
    if(last?.role!=='user'||!pending.ownerId||last.metadata?.submissionTraceId!==pending.ownerId)
      throw new ApiError('E_LEDGER_RECOVERY_OWNER','原主人消息不是剧情最后一条，或原发送身份无法核实。');
    const read=await window.MimaLocalStore.generationRead({sessionId:id,generationId,attempt}),receipt=read.receipt;
    if(!read.complete||!read.text?.trim()||!receipt||Number(receipt.fragmentCount)<1||Number(receipt.persistedChars)!==read.text.length||
      (receipt.ownerId&&receipt.ownerId!==pending.ownerId)||
      !(receipt.requestDispatchAttempted===true||receipt.stage==='FAILED_SETTLED'))
      throw new ApiError('E_LEDGER_RECOVERY_NO_TEXT','本机没有能核对来源的请求正文片段；没有修改剧情。');
    const raw=read.text;
    validateStoryReply(raw,{manualRecovery:true,outputContract:session.promptSettings?.outputContract});
    const msg=makeMessage('assistant',raw,session,{source:'manual_stream_ledger_recovery'});
    msg.rawContent=raw;
    msg.metadata={...(msg.metadata||{}),manualRecovery:{diagnosticId:'ledger:'+generationId+':'+attempt,
      generationId,attempt,action:'send',restoredAt:nowIso(),partialCapture:true,
      recoverySource:'verified_stream_fragments',formatCheckOwnerOverride:true,contentFingerprint:manualReplyFingerprint(msg)}};
    msg.renderedContent='';
    msg.tokenEstimate=estimateTokens(raw);session.messages.push(msg);
    state=persisted;
    const saved=await saveSession({...session,pendingGeneration:null,
      lastGeneration:{id:generationId,attempt,action:'send',preparedAt:pending.preparedAt,settledAt:nowIso(),status:'completed',
        resultMessageId:msg.id,manualRecovery:true,partialCapture:true},legacyMemoryQuarantined:true});
    return {session:saved,messageId:msg.id,alreadyRestored:false,action:'send',partialCapture:true};
  }
  async function inspectHtmlMessage(id,msgId){
    state=await refreshPersistedSession(id);
    const session=getSession(id),message=session?.messages.find(x=>x.id===msgId);
    if(!message)throw new ApiError('E_HTML_REPAIR_TARGET_MISSING','原消息不存在。');
    const contract=session.promptSettings?.outputContract||{},template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    const context={...contract,templateHtml:template?.content||''},validator=window.MimaHtmlStructure;
    const raw=String(message.rawContent??message.content),canonical=String(message.content||'');
    const trace=[];let before=canonical;
    for(const pack of activeRegexPacks(session))for(const rule of arr(pack.rules).filter(r=>r.enabled!==false&&(r.phase||'display')==='display')){
      const after=await window.MimaRegexEngine.applyAsync(before,[{...pack,rules:[rule]}],'display');
      const a=validator.inspect(before,context),b=validator.inspect(after,context);
      if(a.ok&&!b.ok)trace.push({name:rule.name||rule.id||pack.name||pack.id,missing:b.missing});
      before=after;
    }
    const diagnostics=[],display=await applyRegexForSessionAsync(session,canonical,'display',diagnostics);
    if(typeof window.sanitizeAllowedHtml!=='function')throw new ApiError('E_HTML_RENDERER_UNAVAILABLE','原生安全渲染器未加载，无法核对最终显示；请完整更新页面。');
    const safe=window.sanitizeAllowedHtml(display,'mima_diagnostic');
    return {raw:validator.inspect(raw,context),canonical:validator.inspect(canonical,context),
      display:validator.inspect(display,context),safe:validator.inspect(safe,context),
      renderMode:session.renderMode,trace,rules:activeRegexPacks(session).filter(p=>arr(p.rules).some(r=>r.enabled!==false)).map(p=>({id:p.id,name:p.name||p.title||p.id})),diagnostics};
  }
  async function prepareHtmlRepair(id,msgId){
    state=await refreshPersistedSession(id);
    const source=getSession(id),session=source?normalizeSession(clone(source)):null,message=session?.messages.find(x=>x.id===msgId);
    if(!session||!message||message.role!=='assistant')throw new ApiError('E_HTML_REPAIR_TARGET_MISSING','目标角色回复不存在。');
    const contract=session.promptSettings?.outputContract||{};
    const template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    const validator=window.MimaHtmlStructure;
    if(!validator?.repairAttempt)throw new ApiError('E_HTML_REPAIR_RUNTIME_MISSING','HTML 代码修复模块未加载。');
    const targetDigest=await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions});
    const attempt=validator.repairAttempt(message.content,template?.content,contract),repairMode=attempt.repairMode;
    const templateDependent=repairMode==='template_restore'||contract.strictTemplatePath===true&&!!template;
    const templateDigest=templateDependent?await exactDigest({content:template.content,contract}):'';
    const candidate={version:1,sessionId:id,messageId:msgId,branchId:message.branchId||'main',baseMessageVersion:arr(message.versions).length,
      baseContentDigest:targetDigest,repairMode,templateMessageId:templateDependent?template.id:null,templateDigest,contractDigest:await exactDigest(contract),
      proposedContent:attempt.proposedContent,oldContent:message.content,repairActions:attempt.repairActions,
      confidence:attempt.confidence,missingFields:attempt.missingFields,provenance:'code_generated',state:'pending',createdAt:nowIso()};
    candidate.id=await exactDigest({id,msgId,targetDigest,templateDigest,proposedContent:candidate.proposedContent});
    if(!window.MimaLocalStore?.putHtmlRepairCandidate)throw new ApiError('E_HTML_REPAIR_STORE_MISSING','修复候选存储不可用，未改动剧情。');
    await window.MimaLocalStore.putHtmlRepairCandidate(candidate);
    return candidate;
  }
  async function prepareAiHtmlRepair(id,msgId,body={}){
    if(body.confirmedCharge!==true)throw new ApiError('E_HTML_AI_CHARGE_NOT_APPROVED','主人未确认付费重排；请求 0 次。');
    state=await refreshPersistedSession(id);
    const source=getSession(id),session=source?normalizeSession(clone(source)):null,message=session?.messages.find(x=>x.id===msgId);
    if(!message||message.role!=='assistant')throw new ApiError('E_HTML_AI_TARGET_MISSING','目标角色回复不存在。');
    const contract=session.promptSettings?.outputContract||{},template=session.messages.find(x=>x.id===contract.templateMessageId&&x.role==='assistant');
    if(!contract.requireHtml||!template||!contract.bodySelector)throw new ApiError('E_HTML_AI_TEMPLATE_MISSING','请选择有效 HTML 模板与唯一正文槽。');
    const validator=window.MimaHtmlStructure;
    if(!validator?.verifyReformat)throw new ApiError('E_HTML_AI_RUNTIME_MISSING','独立 HTML 安全验证未加载，拒绝付费请求。');
    // Reject unsupported status data BEFORE the charge. Do not ask a model to
    // guess missing state values, even when the resulting HTML looks plausible.
    const admitted=validator.aiAdmission(message.content,template.content,contract);
    if(admitted.deterministicAvailable)return {...await prepareHtmlRepair(id,msgId),apiRequests:0};
    const targetDigest=await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions});
    const templateDigest=await exactDigest({content:template.content,contract});
    const sys='你是严格的 HTML 排版器，不是剧情写手。唯一允许的任务是把原 HTML 中明确位于正文槽的逐字文本按固定模板复原。状态栏每个动态字段必须换成模板标注的【待确认】占位；不得沿用模板的旧状态，不得新增人物事实或改变 CSS、节点、属性。只输出完整 HTML。';
    const user=`【原始正文】\n${message.content}\n\n【必须原样使用的目标骨架】\n${admitted.targetHtml}\n\n【必须逐字保留的正文】\n${admitted.expectedProse}\n\n【待确认字段映射】\n${JSON.stringify(admitted.missingFields)}\n\n【正文槽】\n${contract.bodySelector}\n\n原样保留骨架中每一个精确占位符，不得填入新事实；仅允许正文槽之外容器之间的排版换行。`;
    const cfg=getApiConfig();
    let returned='';
    const draftId=makeId('html_draft');
    const keepDraft=async(error)=>{
      const draft={id:draftId,sessionId:id,messageId:msgId,content:returned||String(error?.partialDraft||''),
        oldContent:message.content,baseContentDigest:targetDigest,templateDigest,createdAt:nowIso(),
        accepted:false,errorCode:error?.code||'E_HTML_AI_RESULT_UNSAFE',reason:String(error?.message||error||'未采纳的模型返回')};
      if(!draft.content)return;
      const key=htmlDraftKey(id,msgId);
      try{
        await window.MimaLocalStore.putHtmlRepairDraft(draft);
        const previous=volatileHtmlRepairDrafts.get(key);
        if(previous&&previous.createdAt<=draft.createdAt)volatileHtmlRepairDrafts.delete(key);
        if(error&&typeof error==='object')error.htmlRepairDraftId=draft.id;
      }catch(saveError){
        const recoveryDraft={...draft,persisted:false,reason:'完整返回暂存在本页，未能保存到本机。刷新或关闭页面前请复制或下载；原剧情未修改。'};
        volatileHtmlRepairDrafts.set(key,recoveryDraft);
        const failure=new ApiError('E_HTML_AI_DRAFT_SAVE_FAILED',recoveryDraft.reason,{details:String(saveError.message)});
        failure.partialDraft=draft.content;failure.recoveryDraft=recoveryDraft;throw failure;
      }
    };
    try{returned=await callModelWithConfig([{role:'system',content:sys},{role:'user',content:user}],cfg,0.1,null,{streamOverride:false,onReceivedText:value=>{returned=String(value||'');}});}
    catch(error){await keepDraft(error);throw error;}
    try{

    // Reopen canonical after the awaited paid request. A concurrent edit is a
    // conflict, even if a model returned perfectly valid HTML.
    const fresh=await refreshPersistedSession(id),current=fresh.sessions.find(x=>x.id===id);
    const original=current?.messages.find(x=>x.id===msgId),ref=current?.messages.find(x=>x.id===template.id);
    if(!original||!ref||await exactDigest({content:original.content,rawContent:original.rawContent,versions:original.versions})!==targetDigest||
       await exactDigest({content:ref.content,contract:current.promptSettings?.outputContract})!==templateDigest)
      throw new ApiError('E_HTML_AI_SOURCE_STALE','本次付费重排期间原文或模板变化，拒绝旧返回值。');
    let checkedAi;try{checkedAi=validator.verifyReformat(message.content,returned,template.content,contract);}
    catch(e){throw new ApiError('E_HTML_AI_RESULT_UNSAFE','模型未能保留精确正文/结构，旧剧情未修改。',{details:String(e.message||e)});}
    const candidate={version:1,sessionId:id,messageId:msgId,branchId:message.branchId||'main',baseMessageVersion:arr(message.versions).length,
      baseContentDigest:targetDigest,templateMessageId:template.id,templateDigest,contractDigest:await exactDigest(contract),
      proposedContent:checkedAi.normalizedContent,oldContent:message.content,repairActions:['one_paid_reformat_attempt','exact_content_verification'],
      confidence:'exact_content_checked',missingFields:checkedAi.missingFields||[],provenance:'ai_reformatted',state:'pending',createdAt:nowIso()};
    candidate.id=await exactDigest({id,msgId,targetDigest,templateDigest,proposedContent:candidate.proposedContent});
    await window.MimaLocalStore.putHtmlRepairCandidate(candidate);
    const emergencyKey=htmlDraftKey(id,msgId),previousEmergency=volatileHtmlRepairDrafts.get(emergencyKey);
    if(previousEmergency&&previousEmergency.createdAt<=candidate.createdAt)volatileHtmlRepairDrafts.delete(emergencyKey);
    return candidate;
    }catch(error){await keepDraft(error);throw error;}
  }
  async function readHtmlRepairDraft(id,msgId){
    const emergency=volatileHtmlRepairDrafts.get(htmlDraftKey(id,msgId));
    if(emergency)return emergency;
    const [draft,candidate]=await Promise.all([
      window.MimaLocalStore.getHtmlRepairDraft(id,msgId),
      window.MimaLocalStore.getHtmlRepairCandidate(id,msgId)
    ]);
    // A paid result can finish after its originating view has been closed.
    // Keep that pending result readable without another model request.
    if(candidate?.state==='pending'&&candidate.provenance==='ai_reformatted'&&
       candidate.sessionId===id&&candidate.messageId===msgId&&
       (!draft||String(candidate.createdAt)>=String(draft.createdAt))){
      const persisted=await window.MimaLocalStore.loadSessionRecord(id);
      const target=arr(persisted?.messages).find(m=>m.id===msgId);
      const message=target?normalizeMessage(target):null;
      if(message&&candidate.baseContentDigest===await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions}))
        return {id:candidate.id,sessionId:id,messageId:msgId,content:candidate.proposedContent,createdAt:candidate.createdAt,accepted:false,
          reason:'这份重排结果已通过生成时的本地核验，尚未确认保存。可以复制或转入手动编辑；原剧情未修改。'};
    }
    return draft;
  }
  async function applyHtmlRepair(id,msgId,candidateId,dynamicValues={}){
    const c=await window.MimaLocalStore.getHtmlRepairCandidate(id,msgId);
    if(!c||c.id!==candidateId||c.state!=='pending')throw new ApiError('E_HTML_REPAIR_CANDIDATE_MISSING','候选不存在或已经结算。');
    // Read current canonical, not an obsolete UI snapshot; stale tabs fail closed.
    state=await refreshPersistedSession(id);
    const source=getSession(id),session=source?normalizeSession(clone(source)):null,message=session?.messages.find(x=>x.id===msgId);
    if(!message||message.role!=='assistant'||(message.branchId||'main')!==c.branchId||arr(message.versions).length!==c.baseMessageVersion||
      await exactDigest({content:message.content,rawContent:message.rawContent,versions:message.versions})!==c.baseContentDigest)
      throw new ApiError('E_HTML_REPAIR_CAS_STALE','消息或支线已经变化，禁止用过期修复覆盖。');
    const contract=session.promptSettings?.outputContract||{},template=session.messages.find(x=>x.id===c.templateMessageId);
    if(((c.repairMode!=='tag_closure'||c.templateMessageId)&&(!template||await exactDigest({content:template.content,contract})!==c.templateDigest))||await exactDigest(contract)!==c.contractDigest)
      throw new ApiError('E_HTML_REPAIR_TEMPLATE_STALE','模板或结构合同已变化，拒绝旧候选。');
    const validator=window.MimaHtmlStructure;
    let approvedContent;
    if(c.repairMode==='tag_closure'){
      const fresh=validator.repairAttempt(message.content,template?.content,contract);
      if(fresh.proposedContent!==c.proposedContent||c.missingFields?.length)throw new ApiError('E_HTML_REPAIR_SOURCE_CHANGED','补全候选与当前原文不符。');
      approvedContent=fresh.proposedContent;
    }else if(c.provenance==='ai_reformatted'){
      try{
        const verified=validator.verifyReformat(message.content,c.proposedContent,template.content,contract);
        for(const field of verified.missingFields||[]){if(!Object.hasOwn(dynamicValues,field.key)||!String(dynamicValues[field.key]).trim())throw new Error('E_HTML_REPAIR_DYNAMIC_FIELD_MISSING: '+field.key);}
        // AI's output already matches the exact static skeleton. Substitute
        // only owner-verified dynamic values using the shared validator.
        approvedContent=validator.finalizeWithProse(validator.aiAdmission(message.content,template.content,contract).expectedProse,
          template.content,contract,c.proposedContent,dynamicValues,message.content);
      }catch(e){throw new ApiError('E_HTML_AI_RESULT_UNSAFE',String(e.message||e));}
    }else{
      try{approvedContent=validator.finalizeProposal(message.content,template.content,contract,c.proposedContent,dynamicValues,message.content);}
      catch(error){throw new ApiError('E_HTML_REPAIR_OWNER_CONFIRMATION_REQUIRED',String(error.message||error));}
    }
    archiveVersion(message,'owner_html_code_repair');
    message.content=approvedContent;message.renderedContent='';
    // The raw provider content remains immutable evidence.
    message.isEdited=true;message.metadata={...message.metadata,htmlCodeRepair:{candidateId:c.id,originalRawPreserved:true,approvedAt:nowIso()}};
    message.tokenEstimate=estimateTokens(message.content);session.legacyMemoryQuarantined=true;
    const initialRecordRevision=Number(session.recordRevision)||0;
    const normalized=normalizeSession({...session,updatedAt:nowIso(),recordRevision:initialRecordRevision+1});
        const committed=await window.MimaLocalStore.commitHtmlRepair(normalized,Number(state.storeRevision)||0,id,msgId,c.id,initialRecordRevision);
    return publishSession(normalizeSession(committed.session),committed.storeRevision);
  }
  // Edit only a detached canonical session. A display-regex Worker may yield;
  // leaking the edit into global state before CAS could let another save persist it.
  async function editMessage(id,msgId,content,opts={}){const source=getSession(id),s=source?normalizeSession(clone(source)):null;if(!s)throw new Error('未找到剧本');const i=s.messages.findIndex(m=>m.id===msgId);if(i<0)throw new Error('未找到消息');const msg=s.messages[i];archiveVersion(msg,'manual_edit');msg.content=String(content||'');msg.rawContent=msg.content;msg.renderedContent='';if(msg.role==='assistant'){delete msg.metadata.thinking;delete msg.metadata.thinkingContinuations;}if(msg.role==='user')msg.metadata={...(msg.metadata||{}),inputSemanticMode:inputSemanticMode(s),inputSemanticParserVersion:'1.1.7'};msg.isEdited=true;msg.editedAt=nowIso();msg.tokenEstimate=estimateTokens(msg.content);s.legacyMemoryQuarantined=true;if(opts.truncateAfter){const removed=s.messages.slice(i+1);if(removed.length){s.archivedBranches=arr(s.archivedBranches);s.archivedBranches.push({id:makeId('branch'),fromMessageId:msg.id,reason:'edit_truncate_after',archivedAt:nowIso(),messages:removed});s.messages=s.messages.slice(0,i+1);}}return saveSession(s);}
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
    msg.renderedContent=''; // Display is recomputed on demand after canonical restore.
    msg.isEdited=version.isEdited===true;
    msg.metadata={...(version.metadata&&typeof version.metadata==='object'?clone(version.metadata):{}),
      restoredAt:nowIso(),restoredVersionIndex:index,restoredVersionId:version.versionId||null};
    if(version.messageTime)msg.time=version.messageTime;
    msg.tokenEstimate=estimateTokens(msg.content);session.legacyMemoryQuarantined=true;
    // saveSession checks the persisted session revision plus the whole-store
    // CAS. Neither a concurrent edit nor a late result can be overwritten.
    return saveSession(session);
  }
  // Deleted-message archives and visible History must settle together.
  // Do not mutate the shared session if the subsequent IDB CAS fails.
  async function deleteMessage(id,msgId){
    const source=getSession(id),s=source?normalizeSession(clone(source)):null;if(!s)throw new Error('未找到剧本');
    const i=s.messages.findIndex(m=>m.id===msgId);if(i<0)throw new Error('未找到消息');
    const [removed]=s.messages.splice(i,1);
    const recovery=normalizeMessage({...clone(removed),metadata:{...(removed?.metadata||{}),deletedAt:nowIso(),deleteReason:'manual_delete'}});
    s.deletedMessages=arr(s.deletedMessages);s.deletedMessages.push(recovery);s.legacyMemoryQuarantined=true;
    if(Number.isFinite(Number(s.lastSummarizedIndex)))s.lastSummarizedIndex=Math.max(0,Math.min(Number(s.lastSummarizedIndex),s.messages.length));
    return saveSession(s);
  }
  async function addOpening(id,content){const source=getSession(id),s=source?normalizeSession(clone(source)):null;if(!s)throw new Error('未找到剧本');if(!String(content||'').trim())throw new Error('开场白为空');const msg=makeMessage('assistant',content,s,{source:'character_first_message'});msg.renderedContent='';s.messages.push(msg);return saveSession(s);}
  async function previewPrompt(id,opts={}){const s=getSession(id);if(!s)throw new Error('未找到剧本');const c=normalizeSession(clone(s));if(String(opts.draft||'').trim())c.messages.push(makeMessage('user',opts.draft,c,{source:'prompt_preview_draft',inputSemanticMode:inputSemanticMode(c),inputSemanticParserVersion:'1.1.7'}));return (await assemble(c,{directorNote:opts.directorNote||''})).inspector;}

  // ---------- Local route compatibility ----------
  function ok(data){return{success:true,data};}
  function fail(msg,extra={}){return{success:false,msg,...extra};}
  // Resource IDs are opaque storage keys. Decode one URL path segment exactly once;
  // a literal `%2F` ID and an ID containing `/` must never alias each other.
  function decodeResourcePathId(segment){
    try{return decodeURIComponent(segment);}catch(_){throw new ApiError('E_RESOURCE_ID_ENCODING','资源地址编码无效，未修改任何数据');}
  }
  function resourcePathMatch(path,pattern){
    const match=path.match(pattern);
    if(match)match[1]=decodeResourcePathId(match[1]);
    return match;
  }
  // Match the encoded path first, then resolve each opaque ID segment once.
  // Never decode an entire path: an ID containing / must remain one segment.
  function pathIdMatch(path,pattern){
    const m=path.match(pattern);
    if(m)for(let i=1;i<m.length;i++)if(m[i]!==undefined)m[i]=decodeResourcePathId(m[i]);
    return m;
  }
  async function handle(endpoint,method='GET',body=null,signal=null,progress=null){
    try{
      const path=String(endpoint||'').split('?')[0];
      if(path==='/css-selection/canonical-view'&&method==='POST'){
        if(!Array.isArray(body?.sessionIds)||body.sessionIds.some(id=>typeof id!=='string'))throw new ApiError('E_CSS_RECOVERY_INPUT','CSS 恢复会话列表无效');
        return ok(await readCssSelectionCanonical(body.sessionIds));
      }
      if(path==='/atelier/publish'&&method==='POST')return ok(await publishAtelierCss(body));
      if(path==='/assistant/css-publish'&&method==='POST')return ok(await publishAssistantCss(body));
      if(path==='/assistant/mount'&&method==='POST')return ok(await mountAssistantResources(body));
      if(path==='/assistant/regex-bundle'&&method==='POST')return ok(await publishAssistantRegexBundle(body));
      if(path==='/theme'&&method==='GET')return ok(clone(state.themeSettings));
      if(path==='/theme/css-selection'&&method==='POST')return ok(await commitGlobalCssSelection(body||{}));
      if(path==='/theme/css-disable'&&method==='POST')return ok(await commitAppearanceEdit(stored=>{
        const current=stored.themeSettings||{};
        if(body?.expected&&((current.globalCssPresetId||null)!==(body.expected.globalCssPresetId||null)||
          (current.globalCssEnabled!==false)!==(body.expected.globalCssEnabled!==false)||
          (current.updatedAt||'')!==(body.expected.updatedAt||'')))
          throw new ApiError('E_CSS_SELECTION_STALE','全局外观已改变，取消操作未覆盖其他窗口的新选择');
        const appliedAt=new Date(Math.max(Date.now(),(Date.parse(current.updatedAt)||0)+1)).toISOString();
        stored.themeSettings={...current,...(body?.clearSelection?{globalCssPresetId:null}:{}),globalCssEnabled:false,updatedAt:appliedAt};
        return clone(stored.themeSettings);
      }));
      if(path==='/theme'&&method==='PATCH')return ok(await saveThemeSettings(body||{}));
      if(path==='/novel-assets'&&method==='GET')return ok(novelAssets());
      if(path==='/novels'&&method==='GET')return ok(novelSummaries());
      if(path==='/novels'&&method==='POST')return ok(await saveNovelProject(createBlankNovel(body||{}),{allowCreate:true}));
      if(path==='/novels/import'&&method==='POST'){const p=window.MimaNovelEngine.createProjectFromText({title:body?.title,sourceName:body?.sourceName||'',sourceEncoding:body?.sourceEncoding||'utf-8',text:body?.text||''});return ok(await saveNovelProject(p,{allowCreate:true}));}
      let nm=pathIdMatch(path,/^\/novels\/([^/]+)$/);if(nm&&method==='GET'){const p=getNovel(nm[1]);return p?ok(p):fail('未找到小说项目');}
      if(nm&&method==='PATCH')return ok(await patchNovelProject(nm[1],body||{}));
      if(nm&&method==='DELETE')return ok(await deleteResource('novelProjects',nm[1]));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/chapters$/);if(nm&&method==='POST'){const p=getNovelProject(nm[1]);return ok(await saveNovelProject(window.MimaNovelEngine.appendNewChapter(p,body?.title||'')));}
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/chapters\/([^/]+)\/discard-empty-auto$/);if(nm&&method==='POST')return ok(await discardEmptyAutoNovelChapter(nm[1],nm[2]));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/reparse$/);if(nm&&method==='POST'){const p=getNovelProject(nm[1]);return ok(await saveNovelProject(window.MimaNovelEngine.reparseImportedProject(p)));}
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/chapters\/([^/]+)$/);if(nm&&method==='PATCH'){const p=getNovelProject(nm[1]),next=window.MimaNovelEngine.editChapter(p,nm[2],body?.action||'replace_text',body||{});return ok(await saveNovelProject(next));}
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/test-connection$/);if(nm&&method==='POST'){const p=getNovelProject(nm[1]),cfg=novelModelConfig(p);const stages=[{stage:'summary_nonstream',stream:false},{stage:'continuation',stream:cfg.stream}],out={model:cfg.model,streamSetting:cfg.stream};
        for(const step of stages){try{const reply=await callModelWithConfig([{role:'user',content:'请回复：连接成功'}],cfg,cfg.temperature,signal,{streamOverride:step.stream,onProgress:progress});out[step.stage]={ok:true,chars:reply.length};}
          catch(e){if(e instanceof ApiError)e.details=[`novel_test_stage: ${step.stage}`,e.details].filter(Boolean).join('; ');throw e;}}
        return ok(out);}
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/prompt-preview$/);if(nm&&method==='POST')return ok(await novelPromptPreview(nm[1],body||{}));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/continue$/);if(nm&&method==='POST')return ok(await continueNovel(nm[1],body||{},signal,progress));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/drafts\/([^/]+)$/);if(nm&&method==='PATCH')return ok(await patchNovelDraft(nm[1],nm[2],body||{}));
      if(nm&&method==='DELETE')return ok(await rejectNovelDraft(nm[1],nm[2]));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/drafts\/([^/]+)\/continue$/);if(nm&&method==='POST')return ok(await continueNovel(nm[1],{...(body||{}),draftId:nm[2]},signal,progress));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/drafts\/([^/]+)\/regenerate$/);if(nm&&method==='POST')return ok(await regenerateNovelDraft(nm[1],nm[2],body||{},signal,progress));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/drafts\/([^/]+)\/accept$/);if(nm&&method==='POST')return ok(await acceptNovelDraft(nm[1],nm[2],signal,progress));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/memory\/chapter\/([^/]+)$/);if(nm&&method==='POST')return ok(await updateNovelMemory(nm[1],nm[2],signal,progress));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/memory\/rebuild$/);if(nm&&method==='POST')return ok(await rebuildNovelMemory(nm[1],signal,progress));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/memory\/legacy-review$/);if(nm&&method==='POST')return ok(await reviewLegacyMemoryItem(nm[1],body||{}));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/memory$/);if(nm&&method==='PATCH')return ok(await patchNovelMemory(nm[1],body||{}));
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/export\/txt$/);if(nm&&method==='GET'){const p=getNovelProject(nm[1]);return ok({name:`${p.title||'novel'}.txt`,text:window.MimaNovelEngine.exportProjectText(p)});}
      nm=pathIdMatch(path,/^\/novels\/([^/]+)\/export\/json$/);if(nm&&method==='GET'){const p=getNovelProject(nm[1]);return ok({name:`${p.title||'novel'}.json`,project:clone(p)});}

      if(path==='/setting-templates'&&method==='GET')return ok(state.settingTemplates);
      if(path==='/setting-templates'&&method==='POST')return ok(await editSettingTemplate('save',body||{}));
      if(path==='/setting-templates/default'&&method==='POST')return ok(await editSettingTemplate('default',body||{}));
      let templateRoute=pathIdMatch(path,/^\/setting-templates\/([^/]+)$/);
      if(templateRoute&&method==='PATCH')return ok(await editSettingTemplate('save',{...(body||{}),id:templateRoute[1]}));
      if(templateRoute&&method==='DELETE')return ok(await editSettingTemplate('delete',{...(body||{}),id:templateRoute[1]}));
      if(path==='/sessions/bulk-delete'&&method==='POST')return ok(await bulkDeleteCanonical('sessions',body||{}));
      if(path==='/session-organization'&&method==='GET')return ok(await window.MimaLocalStore.loadSessionOrganization());
      if(path==='/session-organization/actions'&&method==='POST')return ok(await organizationAction(body||{}));
      if(path==='/sessions'&&method==='GET')return ok(sessionSummaries());
      if(path==='/sessions/full'&&method==='GET')return ok((await window.MimaLocalStore.loadState()).sessions);
      if(path==='/sessions'&&method==='POST'){if(body?.settingTemplateId)return ok(await createSessionUsingTemplate(body));const s=await saveSession(normalizeSession({...body,id:makeId('sess'),createdAt:nowIso(),updatedAt:nowIso(),messages:[]}),{allowCreate:true});return ok(s);}
      if(path==='/sessions/import'&&method==='POST'){const s=normalizeSession({...body,id:makeId('sess'),title:`${text(body?.title||'导入剧情')} · 导入`,createdAt:nowIso(),updatedAt:nowIso()});return ok(await saveSession(s,{allowCreate:true}));}
      let m=pathIdMatch(path,/^\/sessions\/([^/]+)\/canonical-view$/);
      if(m&&method==='GET'){
        // Normal GET uses the tab-local projected state. Regeneration requires
        // an independently confirmed canonical storage read instead.
        const verified=await window.MimaLocalStore.loadSessionRecord(m[1]);
        return verified?ok(clone(verified)):fail('canonical 剧情不存在',{code:'E_STORY_SESSION_MISSING'});
      }
      m=pathIdMatch(path,/^\/sessions\/([^/]+)$/);if(m&&method==='GET'){await refreshPersistedSession(m[1]);const s=getSession(m[1]);return s?ok(s):fail('未找到剧本');}
      if(m&&method==='PATCH'){const s=getSession(m[1]);return s?ok(await saveSession({...s,...body,id:s.id,createdAt:s.createdAt})):fail('未找到剧本');}
      if(m&&method==='DELETE'){
        const id=m[1];
        const change=async()=>{
          for(const attempt of inFlightStoryAttempts){
            let owner=null;try{owner=JSON.parse(attempt).sessionId}catch{}
            if(owner===id)throw new ApiError('E_SESSION_DELETE_GENERATING','剧情仍在生成，先结算该任务；未删除剧情');
          }
          const current=getSession(id);if(!current)throw new ApiError('E_STORY_SESSION_MISSING','该剧情未在当前窗口加载，禁止无版本校验删除');
          const result=await window.MimaLocalStore.deleteSessionRecord(id,current.recordRevision);
          if(result.deleted){state={...state,sessions:state.sessions.filter(x=>x.id!==id),sessionOrganizationV1:result.organization,storeRevision:result.storeRevision};}
          return {deleted:result.deleted,...(result.deleted?{id,organization:result.organization}:{})};};
        const task=sessionSaveTail.then(change,change);sessionSaveTail=task.then(()=>{},()=>{});return ok(await task);
      }
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/css-disable$/);if(m&&method==='POST'){
        const session=getSession(m[1]);if(!session)throw new ApiError('E_STORY_SESSION_MISSING','原剧情不存在，未改变其他剧情');
        if(body?.expected&&(session.recordRevision!==body.expected.recordRevision||
          (session.customCssId||null)!==(body.expected.customCssId||null)||
          (session.customCssEnabled!==false)!==(body.expected.customCssEnabled!==false)))
          throw new ApiError('E_CSS_SELECTION_STALE','原剧情 CSS 已改变，本次取消未覆盖新选择');
        return ok(await saveSession({...session,customCssId:body?.clearSelection?null:session.customCssId,customCssEnabled:false}));
      }
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/css-selection$/);if(m&&method==='POST'){
        const id=m[1],result=await window.MimaLocalStore.commitSessionCssSelection(id,body?.expected||{},body?.candidate||{},body?.identity,
          (actual,expectedIdentity)=>cssSelectionIdentity(actual)===expectedIdentity);
        return ok(publishSession(normalizeSession(result.session),result.storeRevision));
      }
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/generation-abandon$/);if(m&&method==='POST')return ok(await abandonUnknownStoryGeneration(m[1],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/chat$/);if(m&&method==='POST')return ok(await processStoryTurn(m[1],body?.text,body?.action||'send',signal,body?.temperature,{directorNote:body?.directorNote||'',targetMessageId:body?.targetMessageId||null,expectedRecordRevision:body?.expectedRecordRevision??null,expectedSourceFingerprint:body?.expectedSourceFingerprint||null,diagnosticTurnId:body?.diagnosticTurnId||'',diagnosticTraceId:body?.diagnosticTraceId||'',regenerationContext:body?.regenerationContext||'original',retryParameters:body?.retryParameters==='current'?'current':'original',confirmUnknownTakeover:body?.confirmUnknownTakeover===true},progress));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/recover-reply$/);if(m&&method==='POST')return ok(await restoreRejectedReply(m[1],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/recover-stream-ledger$/);if(m&&method==='POST')return ok(await restoreFailedStreamLedger(m[1],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/recover-reply\/html-repair$/);if(m&&method==='POST')return ok(await prepareRejectedHtmlRepair(m[1],body?.diagnosticId));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/prompt-preview$/);if(m&&method==='POST'){await refreshPersistedSession(m[1]);return ok(await previewPrompt(m[1],body||{}));}
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/opening$/);if(m&&method==='POST')return ok(await addOpening(m[1],body?.content||''));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair\/inspect$/);if(m&&method==='GET')return ok(await inspectHtmlMessage(m[1],m[2]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair\/draft$/);if(m&&method==='GET')return ok(await readHtmlRepairDraft(m[1],m[2]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair$/);if(m&&method==='POST')return ok(await prepareHtmlRepair(m[1],m[2]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair\/approve$/);if(m&&method==='POST')return ok(await applyHtmlRepair(m[1],m[2],body?.candidateId,body?.dynamicValues||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)\/html-repair\/ai$/);if(m&&method==='POST')return ok(await prepareAiHtmlRepair(m[1],m[2],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)$/);if(m&&method==='PATCH')return ok(await editMessage(m[1],m[2],body?.content,{truncateAfter:!!body?.truncateAfter}));
      if(m&&method==='DELETE')return ok(await deleteMessage(m[1],m[2]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/messages\/([^/]+)\/versions\/(\d+)\/restore$/);if(m&&method==='POST')return ok(await restoreMessageVersion(m[1],m[2],Number(m[3]),body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory$/);if(m&&method==='PATCH')return ok(await updateManualMemory(m[1],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/plan$/);if(m&&method==='POST')return ok(await previewMemoryPlan(body?.kind==='facts'?'facts':'core',m[1],body?.options||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/core$/);if(m&&method==='POST')return ok(await runRecordedMemory('core',m[1],body||{},signal,progress));
      if(m&&method==='DELETE')return ok(await deleteCoreMemory(m[1]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/rolling\/plan$/);if(m&&method==='POST')return ok(await previewMemoryPlan('rolling',m[1],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/rolling\/run$/);if(m&&method==='POST')return ok(await runRecordedMemory('rolling',m[1],body||{},signal,progress));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/rolling$/);if(m&&method==='POST'){const result=await window.MimaLocalStore.updateRollingMemory(m[1],body?.action||'revoke');await refreshPersistedSession(m[1]);return ok(getSession(m[1])||result);}
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts\/merge-plan$/);if(m&&method==='POST')return ok(await previewFactMerge(m[1],{...(body||{}),planOnly:true},signal,null));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts\/merge-preview$/);if(m&&method==='POST')return ok(await previewFactMerge(m[1],body||{},signal,progress));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts\/merge-commit$/);if(m&&method==='POST')return ok(await commitFactMerge(m[1],body||{}));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts\/merge-undo$/);if(m&&method==='POST')return ok(await undoFactMerge(m[1]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts$/);if(m&&method==='POST')return ok(await runRecordedMemory('facts',m[1],body||{},signal,progress));
      if(m&&method==='DELETE')return ok(await deleteFactMemory(m[1]));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts\/([^/]+)$/);if(m&&method==='PATCH')return ok(await editFactMemory(m[1],m[2],body?.content));
      m=pathIdMatch(path,/^\/sessions\/([^/]+)\/memory\/facts\/([^/]+)$/);if(m&&method==='DELETE')return ok(await deleteFactMemory(m[1],m[2]));

      if(path==='/resources/bulk-delete'&&method==='POST')return ok(await bulkDeleteCanonical(body?.kind,body||{}));
      if(path==='/masks'&&method==='GET')return ok(state.masks);
      if(path==='/masks'&&method==='POST')return ok(await saveMask(body||{}));
      m=resourcePathMatch(path,/^\/masks\/([^/]+)$/);if(m&&method==='PATCH'){const old=getMask(m[1]);return old?ok(await saveMask({...old,...body,id:m[1]})):fail('未找到面具');}
      if(m&&method==='DELETE')return ok(await deleteResource('masks',m[1],(db,id)=>{for(const s of db.sessions){if(s.loadedCharMaskId===id||s.loadedUserMaskId===id){if(s.loadedCharMaskId===id)s.loadedCharMaskId=null;if(s.loadedUserMaskId===id)s.loadedUserMaskId=null;s.recordRevision++;}}for(const project of db.novelProjects){let changed=false;if(project.macroUserMaskId===id){project.macroUserMaskId=null;changed=true;}if(project.macroCharMaskId===id){project.macroCharMaskId=null;changed=true;}if(changed)project.recordRevision=(Number(project.recordRevision)||0)+1;}}));

      m=resourcePathMatch(path,/^\/presets\/([^/]+)\/latest$/);
      if(m&&method==='GET'){await refreshPersistedResources();return ok(getPreset(m[1])||null);}
      if(path==='/presets'&&method==='GET')return ok(state.presets);
      if(path==='/presets'&&method==='POST')return ok(await savePreset(body||{},null));
      m=resourcePathMatch(path,/^\/presets\/([^/]+)$/);if(m&&method==='PATCH'){const old=getPreset(m[1]);return old?ok(await savePreset({...old,...body,id:m[1]},body?.expectedToken)):fail('未找到预设');}
      if(m&&method==='DELETE')return ok(await deleteResource('presets',m[1],(db,id)=>{for(const s of db.sessions)if(s.presetIds.includes(id)){s.presetIds=s.presetIds.filter(x=>x!==id);s.recordRevision++;}for(const p of db.novelProjects)if(p.presetIds.includes(id)){p.presetIds=p.presetIds.filter(x=>x!==id);p.recordRevision++;}}));

      m=path.match(/^\/resource-categories\/(css|presets|worldbook)$/);if(m&&method==='GET')return ok({records:categoryView(state,m[1]),storeRevision:state.storeRevision});
      if(m&&method==='POST')return ok(await changeCategories(m[1],body||{}));
      if(path==='/css-presets/import-batch'&&method==='POST')return ok(await importCssPresetsBatch(body||{}));
      if(path==='/css-presets'&&method==='GET')return ok(state.cssPresets);
      if(path==='/css-presets'&&method==='POST')return ok(await saveCssPreset(body||{}));
      m=resourcePathMatch(path,/^\/css-presets\/([^/]+)$/);if(m&&method==='PATCH'){const old=getCssPreset(m[1]);return old?ok(await saveCssPreset({...old,...body,id:m[1]})):fail('未找到 CSS Preset');}
      if(m&&method==='DELETE'){
        const receipt=await deleteResource('cssPresets',m[1],(db,id)=>{if(db.themeSettings?.globalCssPresetId===id)db.themeSettings={...db.themeSettings,globalCssPresetId:null,globalCssEnabled:false};for(const sess of db.sessions){if(sess.customCssId===id){sess.customCssId=null;sess.customCssEnabled=false;sess.recordRevision++;}}for(const p of db.novelProjects){if(p.appearance?.customCssId===id){p.appearance.customCssId=null;p.appearance.customCssEnabled=false;p.recordRevision++;}}});
        if(receipt.deleted)try{window.MimaThemeEngine?.apply?.(state.themeSettings);}catch(e){console.error('E_THEME_APPLY_AFTER_CSS_DELETE',e);}
        return ok(receipt);
      }

      if(path==='/regex-packs'&&method==='GET')return ok(state.regexPacks);
      if(path==='/play-tools'&&method==='GET'){state=normalizeState(await window.MimaLocalStore.loadState());return ok({theaterCards:clone(state.theaterCards),quickCommands:clone(state.quickCommands)});}
      if(path==='/play-tools/import'&&method==='POST')return ok(await importPlayResources(body));
      const playRoute=path.match(/^\/(theater-cards|quick-commands)(?:\/([^/]+))?$/);
      if(playRoute){const table=playRoute[1]==='theater-cards'?'theaterCards':'quickCommands',id=playRoute[2]?decodeResourcePathId(playRoute[2]):null;
        if(!id&&method==='POST')return ok(await savePlayResource(table,body||{}));
        if(id&&method==='PATCH')return ok(await savePlayResource(table,body||{},id));
        if(id&&method==='DELETE'){
          const receipt=await deleteResource(table,id,table==='theaterCards'?(db,deleted)=>{for(const session of db.sessions)if(arr(session.theaterCardIds).includes(deleted)){session.theaterCardIds=session.theaterCardIds.filter(x=>x!==deleted);session.recordRevision=(Number(session.recordRevision)||0)+1;session.updatedAt=nowIso();}}:null);
          if(receipt.deleted!==true)return ok(receipt);
          if(table==='theaterCards'){
            const operationId=makeId('theater_unlink');
            try{
              await window.MimaLocalStore.putPlayToolLocal('unlink-job:'+operationId,{operationId,id,phase:'delete-committed',affected:[],createdAt:nowIso(),error:''});
              return ok({...receipt,operationId,compatCleanup:'pending'});
            }catch(e){console.error('E_THEATER_UNLINK_JOB_AFTER_DELETE',e);return ok({...receipt,compatCleanup:'manual-reconciliation-required'});}
          }
          return ok(receipt);
        }
      }
      if(path==='/regex-packs'&&method==='POST')return ok(await saveRegexPack(body||{}));
      m=resourcePathMatch(path,/^\/regex-packs\/([^/]+)$/);if(m&&method==='PATCH'){const old=getRegexPack(m[1]);return old?ok(await saveRegexPack({...old,...body,id:m[1]})):fail('未找到正则包');}
      if(m&&method==='DELETE')return ok(await deleteResource('regexPacks',m[1],(db,id)=>{for(const sess of db.sessions)if(sess.regexPackIds.includes(id)){sess.regexPackIds=sess.regexPackIds.filter(x=>x!==id);sess.recordRevision++;}}));

      if(path==='/worldbooks'&&method==='GET')return ok(state.worldbooks);
      if(path==='/worldbooks'&&method==='POST')return ok(await saveWorldbook(body||{}));
      m=resourcePathMatch(path,/^\/worldbooks\/([^/]+)\/canonical-view$/);if(m&&method==='GET'){const persisted=normalizeState(await window.MimaLocalStore.loadState());const book=persisted.worldbooks.find(w=>w.id===m[1]);return book?ok(clone(book)):fail('已保存世界书未找到',{code:'E_WORLDBOOK_CANONICAL_MISSING'});}
      m=resourcePathMatch(path,/^\/worldbooks\/([^/]+)$/);if(m&&method==='GET'){const w=getWorldbook(m[1]);return w?ok(w):fail('未找到世界书');}
      if(m&&method==='PATCH'){const old=getWorldbook(m[1]);return old?ok(await saveWorldbook({...old,...body,id:m[1]})):fail('未找到世界书');}
      if(m&&method==='DELETE')return ok(await deleteResource('worldbooks',m[1],(db,id)=>{for(const s of db.sessions)if(s.worldbookIds.includes(id)){s.worldbookIds=s.worldbookIds.filter(x=>x!==id);s.recordRevision++;}for(const p of db.novelProjects)if(p.worldbookIds.includes(id)){p.worldbookIds=p.worldbookIds.filter(x=>x!==id);p.recordRevision++;}}));
      return fail(`Standalone 未实现路径：${method} ${path}`);
    }catch(e){
      if(e?.name==='AbortError')return{success:false,aborted:true,code:'E_ABORTED',msg:'生成已停止'};
      const err=e instanceof ApiError?e:asApiError(e,'E_STORY_RUNTIME');
      return fail(err.message||String(err),{repairDraftId:e?.htmlRepairDraftId||'',recoveryDraft:e?.recoveryDraft||null,partialDraftTruncated:typeof err.partialDraft==='string'&&err.partialDraft.length>24000,code:err.code||'E_STORY_RUNTIME',status:err.status||0,hint:err.hint||apiErrorHint(err.code,err.status,err.message),details:err.details||'',partialDraft:typeof err.partialDraft==='string'?err.partialDraft.slice(0,24000):''});
    }
  }

  async function exportLibrary(){
    // schemaVersion=4 spans multiple historical release shapes; new backups
    // declare the independently versioned full-data contract on export.
    const snapshot=normalizeState(await window.MimaLocalStore.loadState());
    delete snapshot.__resourceSignature; // internal cache stamp is not user backup data
    delete snapshot.__appearanceRevision; // internal UI CAS token never enters backups
    // Some historical/offline consumers supply only loadState/saveState. The
    // production store always has the validator; do not claim a modern
    // verified contract when that validator is not connected.
    if(typeof window.MimaLocalStore?.validateLibrary==='function'){
      snapshot.backupContractRevision=2;
      window.MimaLocalStore.validateLibrary(snapshot);
    }
    return snapshot;
  }
  function validateLibrary(raw){return window.MimaLocalStore.validateLibrary(raw);}
  async function prepareLibraryImport(raw,{templatePolicy='replace',mergeMode='replace'}={}){
    const verified=validateLibrary(raw);
    if(!['replace','preserve','merge'].includes(templatePolicy))throw new ApiError('E_TEMPLATE_IMPORT_POLICY','未知的模板恢复策略，未写入资料库');
    // A fresh verified read is mandatory. Never take preservation templates from
    // a stale in-memory state or reinterpret an unreadable library as empty.
    const before=normalizeState(await window.MimaLocalStore.loadState());
    let next=normalizeState(verified);
    // Backup/imported authorizations cannot grant a new plugin private access.
    // Keep only permissions already granted locally for the identical source.
    for(const card of next.theaterCards){const old=before.theaterCards.find(x=>x.id===card.id);card.access=old&&old.content===card.content&&old.kind===card.kind?theaterAccess(old.access):theaterAccess();}
    if(!['replace','merge-new-only','empty-only'].includes(mergeMode))throw new ApiError('E_NATIVE_RESTORE_MODE','未知原生库恢复模式');
    const incomingHasOrganization=Object.prototype.hasOwnProperty.call(verified,'sessionOrganizationV1');
    const sourceOrganization=incomingHasOrganization?next.sessionOrganizationV1:null;
    const previousOrganization=before.sessionOrganizationV1||{version:1,revision:0,groups:[],placements:{},updatedAt:''};
    if(mergeMode!=='replace'){
      const tables=['sessions','masks','presets','worldbooks','cssPresets','regexPacks','theaterCards','quickCommands','settingTemplates','novelProjects'];
      const currentHasData=tables.some(name=>before[name].length>0);
      // Empty-only includes appearance configuration. A browser with only a
      // chosen theme/CSS is NOT an empty target. Old checks counted arrays
      // exclusively and silently overwrote the owner's only local settings.
      const themeAppearance=t=>JSON.stringify([t?.theme,t?.globalCssPresetId,t?.globalCssEnabled]);
      const emptyTheme=normalizeState({}).themeSettings;
      const existingCustomizedTheme=themeAppearance(before.themeSettings)!==themeAppearance(emptyTheme);
      const existingCategories=before.cssCategoriesV1.length||before.resourceCategoriesV1.presets.length||before.resourceCategoriesV1.worldbook.length;
      if(mergeMode==='empty-only'&&(currentHasData||existingCustomizedTheme||existingCategories||previousOrganization.groups.length||Object.keys(previousOrganization.placements).length))
        throw new ApiError('E_NATIVE_RESTORE_NOT_EMPTY','原生资料库含剧情、资料或自定义外观；空库模式拒绝覆盖');
      if(mergeMode==='merge-new-only'){
        const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
        const merged={...next};
        for(const name of tables){
          const existing=new Map(before[name].map(item=>[item.id,item]));
          for(const item of next[name]){
            const old=existing.get(item.id);
            if(old&&!same(old,item))throw new ApiError('E_NATIVE_RESTORE_ID_CONFLICT','原生库同 ID 资料内容不同，禁止静默覆盖：'+name+'/'+item.id);
            existing.set(item.id,old||item);
          }
          merged[name]=[...existing.values()];
        }
        // updatedAt is audit metadata, not an appearance setting. The same
        // explicit appearance identity is used by both safe merge modes.
        if(existingCustomizedTheme&&themeAppearance(before.themeSettings)!==themeAppearance(next.themeSettings))
          throw new ApiError('E_NATIVE_RESTORE_THEME_CONFLICT','本机已有自定义主题，与备份不同；即使没有剧情记录，也禁止静默覆盖，请先导出本机设置');
        const mergeCategoryRecords=(a,b,at)=>{const combined=new Map(a.map(x=>[x.id,x]));for(const item of b){const prev=combined.get(item.id);
          if(prev&&JSON.stringify(prev)!==JSON.stringify(item))throw new ApiError('E_CATEGORY_RESTORE_CONFLICT','同 ID 分类内容冲突：'+at);
          if([...combined.values()].some(x=>x.id!==item.id&&x.name.toLocaleLowerCase()===item.name.toLocaleLowerCase()))throw new ApiError('E_CATEGORY_RESTORE_NAME_CONFLICT','分类名称冲突：'+at+'/'+item.name);
          combined.set(item.id,prev||item);}return [...combined.values()];};
        merged.cssCategoriesV1=mergeCategoryRecords(before.cssCategoriesV1,next.cssCategoriesV1,'css');
        merged.resourceCategoriesV1={presets:mergeCategoryRecords(before.resourceCategoriesV1.presets,next.resourceCategoriesV1.presets,'presets'),worldbook:mergeCategoryRecords(before.resourceCategoriesV1.worldbook,next.resourceCategoriesV1.worldbook,'worldbook')};
        merged.themeSettings=existingCustomizedTheme?before.themeSettings:next.themeSettings;
        // Merging the archive directory is as strict as merging sessions: no
        // silent category or placement overwrite for the same ID.
        if(incomingHasOrganization){
          const groups=new Map(previousOrganization.groups.map(g=>[g.id,g]));
          for(const group of sourceOrganization.groups){const old=groups.get(group.id);if(old&&JSON.stringify(old)!==JSON.stringify(group))throw new ApiError('E_ORGANIZATION_IMPORT_CONFLICT','分类 ID 冲突：'+group.id);
            if([...groups.values()].some(g=>g.id!==group.id&&g.name.toLocaleLowerCase()===group.name.toLocaleLowerCase()))throw new ApiError('E_ORGANIZATION_IMPORT_CONFLICT','分类重名：'+group.name);
            groups.set(group.id,old||group);}
          const placements={...previousOrganization.placements};
          for(const [id,place] of Object.entries(sourceOrganization.placements)){if(placements[id]&&JSON.stringify(placements[id])!==JSON.stringify(place))throw new ApiError('E_ORGANIZATION_IMPORT_CONFLICT','会话归档位置冲突：'+id);placements[id]=place;}
          const ordered=[...groups.values()].sort((a,b)=>a.order-b.order);
          merged.sessionOrganizationV1={version:1,revision:Math.max(previousOrganization.revision,sourceOrganization.revision)+1,groups:ordered.map((g,i)=>({...g,order:i})),placements,updatedAt:nowIso()};
        }
        next=merged;
      }
      validateLibrary(next);
    }
    if(!incomingHasOrganization){
      // Old backups never contained this field. Keep local placements only
      // for sessions that still exist after the import; never empty the user's
      // archive just because the old exporter did not know it existed.
      const ids=new Set(next.sessions.map(x=>x.id));
      next.sessionOrganizationV1={...previousOrganization,placements:Object.fromEntries(Object.entries(previousOrganization.placements).filter(([id])=>ids.has(id)))};
    }else if(mergeMode!=='merge-new-only')next.sessionOrganizationV1=sourceOrganization;
    window.MimaLocalStore.validateSessionOrganization(next.sessionOrganizationV1,new Set(next.sessions.map(x=>x.id)));
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
    return {next,beforeRevision:before.storeRevision,beforeOrganizationRevision:previousOrganization.revision,templatePolicy};
  }
  async function previewLibraryImport(raw,options={}){
    const plan=await prepareLibraryImport(raw,options);
    return {valid:true,templatePolicy:plan.templatePolicy,sourceRevision:plan.beforeRevision,templateCount:plan.next.settingTemplates.length};
  }
  async function importLibrary(raw,options={}){
    const plan=await prepareLibraryImport(raw,options);
    // The final CAS is the authority. A second tab may commit after preflight.
    const committed=await window.MimaLocalStore.saveState(plan.next,plan.beforeRevision,{organizationImport:true,expectedOrganizationRevision:plan.beforeOrganizationRevision});
    state=normalizeState(committed);
    state.__appearanceRevision=state.storeRevision; // canonical promotion resets the overlay to the new base
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
  // Normalized CSS presets contain scalar fields; copy their records without serializing History or immutable CSS strings.
  window.MimaStandalone={getPlayTools:()=>({theaterCards:state.theaterCards.map(p=>({...p})),quickCommands:state.quickCommands.map(p=>({...p}))}),init,handle,previewMemoryPlan,memorySourceParts,memoryWorkPlan,runRecordedMemory,memorySourceFingerprint,memoryFactSignature,manualReplyFingerprint,isManuallyRecoveredReply,getApiConfig,saveApiConfig,validateApiConfigSnapshot,replaceApiConfigSnapshot,captureApiConfigBytes,restoreApiConfigBytes,apiCapacityIdentity,effectiveRequestConfig,buildEndpoints,listModels,listModelsWithConfig,testApi,callModel,callModelWithConfig,validateStoryReply,classifyStoryReply,applyRegexForSession,applyRegexForSessionAsync,applyRegexBatchForSessionAsync,hasActiveRegexForSession,resolveMacrosForSession,compileUserInputForPrompt,exportLibrary,importLibrary,previewLibraryImport,validateLibrary,assemble,getLastUsage,getPhoneResources:()=>({masks:clone(state.masks),presets:clone(state.presets),worldbooks:clone(state.worldbooks),themeSettings:clone(state.themeSettings),storeRevision:state.storeRevision}),getThemeSettings:()=>clone(state.themeSettings),cssSelectionIdentity,getResourceCategoryList:kind=>categorySpec[kind]?categoryView(state,kind):[],getStoreRevision:()=>state.storeRevision,getAppearanceRevision:()=>state.__appearanceRevision,getCssAppearance:()=>({themeSettings:clone(state.themeSettings),cssPresets:state.cssPresets.map(p=>({...p}))}),getState:()=>clone(state)};
})();
