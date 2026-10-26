/**
 * 🍷 咪嘛馆 Standalone 本地数据库
 * 所有剧情/角色卡/世界书/预设/小说项目仅保存在当前浏览器 IndexedDB。
 */
(() => {
  const DB_NAME = 'mimamao_tavern_standalone';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const STATE_KEY = 'state';
  const SETTINGS_SNAPSHOT_KEY = 'settings_snapshot_v1';
  const EMPTY_THEME = { theme: 'default', updatedAt: '' };

  // All canonical state writers, including memory-specific IDB transactions,
  // must agree on the same minimum verified-record contract. An existing
  // malformed document is never a valid baseline for partial memory updates.
  function isCanonicalStateRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      [2, 3, 4].includes(value.schemaVersion) &&
      ['sessions', 'masks', 'presets', 'worldbooks'].every(key => Array.isArray(value[key])) &&
      // Older v2/v3 / early v4 snapshots may lack these collections. However,
      // a PRESENT but malformed collection is corruption, never "empty".
      ['cssPresets', 'regexPacks', 'novelProjects', 'settingTemplates', 'theaterCards', 'quickCommands'].every(key =>
        value[key] === undefined || Array.isArray(value[key])) &&
      (value.themeSettings === undefined ||
        (value.themeSettings !== null && typeof value.themeSettings === 'object' &&
         !Array.isArray(value.themeSettings))) &&
      (value.storeRevision === undefined ||
        (Number.isInteger(value.storeRevision) && value.storeRevision >= 0));
  }
  // Unlike a migration reader, a canonical writer must receive a COMPLETE
  // snapshot. saveState previously filled missing secondary collections with
  // [], so a partial caller payload could silently erase CSS, regex or novels.
  // Keep legacy v2/v3 READ compatibility; writes always target schema v4.
  function assertWritableState(candidate) {
    if (!isCanonicalStateRecord(candidate) || candidate.schemaVersion !== 4 ||
        !['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects','settingTemplates']
          .every(key => Array.isArray(candidate[key])) ||
        !candidate.themeSettings || typeof candidate.themeSettings !== 'object' ||
        Array.isArray(candidate.themeSettings)) {
      throw new Error('E_CANONICAL_CANDIDATE_UNVERIFIED: 写入资料库必须提供完整的七类资源和外观设置，拒绝覆盖');
    }
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function get(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let value, issue;
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      // A request's onsuccess is not evidence that its containing IndexedDB
      // transaction committed. A later abort must never turn into a verified
      // "missing" state or an empty memory journal.
      req.onsuccess = () => { value = req.result; };
      req.onerror = () => { issue = req.error || new Error('E_CANONICAL_READ_FAILED'); try { tx.abort(); } catch { /* IndexedDB may already be aborting; tx.onabort settles. */ } };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(issue || tx.error || new Error('E_CANONICAL_READ_ABORTED')); };
      tx.onerror = () => { issue = issue || tx.error || new Error('E_CANONICAL_READ_FAILED'); };
    });
  }
  async function set(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let issue;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { issue = issue || tx.error || new Error('E_CANONICAL_WRITE_FAILED'); };
      tx.onabort = () => { db.close(); reject(issue || tx.error || new Error('E_CANONICAL_WRITE_ABORTED')); };
    });
  }
  async function listPlayToolLocal(prefix){
    const db=await openDb(),start='play_tools_v1:'+prefix;
    return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).getAll(IDBKeyRange.bound(start,start+'\uffff'));let result,issue;
      req.onsuccess=()=>result=req.result;req.onerror=()=>{issue=req.error;tx.abort();};tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('清理日志读取失败'));};});
  }
  // Serialize compare-and-swap inside a single IndexedDB readwrite transaction.
  // Never treat a failed read as an empty library, and never silently overwrite a newer tab.
  async function commitState(candidate, expectedRevision, {signal=null}={}) {
    assertWritableState(candidate);
    const db = await openDb();
    if(signal?.aborted){db.close();throw new DOMException('生成已取消，资料库未提交','AbortError');}
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const objectStore = tx.objectStore(STORE);
      let result, problem = null;
      const cancel=()=>{problem=new DOMException('生成已取消，资料库未提交','AbortError');try{tx.abort();}catch(e){if(e?.name!=='InvalidStateError')problem=e;}};
      signal?.addEventListener?.('abort',cancel,{once:true});
      const release=()=>signal?.removeEventListener?.('abort',cancel);
      const req = objectStore.get(STATE_KEY);
      req.onerror = () => { problem = req.error || new Error('资料库读取失败'); tx.abort(); };
      req.onsuccess = () => {
        if(signal?.aborted){cancel();return;}
        const current = req.result;
        for(const key of ['theaterCards','quickCommands'])if(Array.isArray(current?.[key])&&!Array.isArray(candidate[key])){problem=new Error('E_CANONICAL_CANDIDATE_UNVERIFIED: 写入缺少 '+key+'，拒绝丢弃新功能资料');tx.abort();return;}
        if (current !== undefined && !isCanonicalStateRecord(current)) {
          problem = new Error('E_CANONICAL_STATE_UNVERIFIED: 资料库内容损坏，拒绝写入'); tx.abort(); return;
        }
        const revision = Number(current?.storeRevision) || 0;
        if (revision !== expectedRevision) {
          problem = new Error('E_CANONICAL_CONFLICT: 其他窗口或任务已更新资料库，请刷新后重试，本次未覆盖新数据');
          tx.abort(); return;
        }
        result = { ...candidate, storeRevision: revision + 1, schemaVersion: 4, savedAt: new Date().toISOString() };
        objectStore.put(result, STATE_KEY);
      };
      tx.oncomplete = () => { release();db.close();resolve(result); };
      tx.onabort = () => { release();db.close();reject(problem || tx.error || new Error('资料库事务中止')); };
      tx.onerror = () => { /* onabort retains the root cause */ };
    });
  }
  async function loadState() {
    const existing = await get(STATE_KEY);
    // Only an actually absent record authorizes first-run initialization.
    // Null, arrays and partially damaged canonical snapshots are NOT absence.
    if (existing !== undefined) {
      if (!isCanonicalStateRecord(existing))
        throw new Error('E_CANONICAL_STATE_UNVERIFIED: 已存在的本地资料库结构无法核实，停止初始化与写入');
      return existing;
    }
    const blank = {schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],theaterCards:[],quickCommands:[],settingTemplates:[],novelProjects:[],themeSettings:{...EMPTY_THEME}};
    return blank; // verified nonexistent; first write still uses CAS
  }
  async function saveState(state, expectedRevision, options={}) {
    // Never turn a missing caller field into an empty persisted collection.
    // Only the explicit first-run loadState() may create a new blank library.
    assertWritableState(state);
    return commitState({
      ...state,
      schemaVersion:4,
      cssPresets:Array.isArray(state.cssPresets)?state.cssPresets:[],
      regexPacks:Array.isArray(state.regexPacks)?state.regexPacks:[],
      novelProjects:Array.isArray(state.novelProjects)?state.novelProjects:[],
      themeSettings:state.themeSettings&&typeof state.themeSettings==='object'?state.themeSettings:{...EMPTY_THEME},
      savedAt:new Date().toISOString()
    }, expectedRevision === undefined ? Number(state.storeRevision) || 0 : expectedRevision,options);
  }
  // The original schemaVersion=4 was reused in several shipped releases.
  // Backup contract revisions are separate from the on-disk schema: marking
  // a *new* export never retroactively marks an older IndexedDB snapshot.
  async function exportAll(){
    const snapshot=await loadState();
    validateLibrary(snapshot);
    const modern={...snapshot,theaterCards:snapshot.theaterCards||[],quickCommands:snapshot.quickCommands||[],backupContractRevision:2};
    if(snapshot.schemaVersion===4){
      // Standalone Core normally migrates legacy snapshots on load. Direct
      // low-level exports must still be able to preserve an older raw store.
      try { validateLibrary(modern); return modern; }
      catch { return snapshot; } // Already validated above; never invent fields.
    }
    return snapshot;
  }
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function invalid(path, explanation) { throw new Error(`备份 ${path} ${explanation}`); }
  function mustObject(value, path) { if (!isRecord(value)) invalid(path, '必须为对象'); }
  function mustArray(value, path, required = false) {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) invalid(path, '必须为数组');
    return value;
  }
  function mustString(value, path, required = false) {
    if (value === undefined && !required) return;
    if (typeof value !== 'string') invalid(path, '必须为字符串');
  }
  function mustNullableRecord(value, path, required = false) {
    if (value === undefined && required) invalid(path, '字段缺失');
    if (value !== undefined && value !== null) mustObject(value, path);
  }
  function mustRecord(value, path, required = false) {
    if ((value === undefined || value === null) && !required) return;
    mustObject(value, path);
  }
  // v4 exports are already normalized; missing user-authored text must never
  // be normalized to an empty string during a destructive full-library import.
  // Empty strings are valid; absence and non-strings are not. v2/v3 retain their
  // historical optional fields and are migrated only after validation.
  function persistedTextFields(item, fields, path, version) {
    for (const field of fields) mustString(item[field], `${path}.${field}`, version >= 4);
  }
  const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  // These are signatures of actual v1.3.1/v1.3.2/v1.3.3 exports,
  // not a request to downgrade arbitrary damaged schema-v4 backups.
  // In particular, dropping a single field from a later project cannot
  // transform it into a v1.3.1 project.
  function legacyProjectContract(src, project, path, contractRevision){
    if(contractRevision===1||contractRevision===2){
      if(!Number.isInteger(project.recordRevision)||project.recordRevision<0)invalid(`${path}.recordRevision`,'完整快照修订号缺失或无效');
      return 'current';
    }
    if(hasOwn(project,'legacyNarrativeCheckpoint')){
      if(!Number.isInteger(project.recordRevision)||project.recordRevision<0)invalid(`${path}.recordRevision`,'v1.3.3+ 备份修订号缺失或无效');
      return 'v133';
    }
    if(hasOwn(project,'recordRevision'))return 'v132';
    if(src.storeRevision===undefined && !hasOwn(project,'recordRevision') &&
       !hasOwn(project,'legacyNarrativeCheckpoint') &&
       Array.isArray(project.chapters) && project.chapters.every(c=>isRecord(c)&&!hasOwn(c,'memoryDelta')))
      return 'v131';
    invalid(path,'历史 v4 来源结构不完整或无法核验，拒绝将可能损坏的备份降级为旧版');
  }
  function mustStringList(value, path, required = false) {
    const list=mustArray(value,path,required);
    list.forEach((item,i)=>mustString(item,`${path}[${i}]`,true));
    return list;
  }
  function validateItems(items, path, {requireId = true, validate} = {}) {
    const seen = new Set();
    items.forEach((item, index) => {
      const at = `${path}[${index}]`;
      mustObject(item, at);
      const id = item.id;
      if ((requireId || id !== undefined) && (typeof id !== 'string' || !id.trim())) invalid(`${at}.id`, '缺失或无效');
      if (typeof id === 'string') {
        if (seen.has(id)) invalid(`${at}.id`, '重复 ID');
        seen.add(id);
      }
      validate?.(item, at);
    });
    return seen;
  }
  function validateMessages(items, path, version) {
    validateItems(items, path, {requireId: version >= 4, validate: (m, at) => {
      mustString(m.content, `${at}.content`, true);
      mustString(m.rawContent, `${at}.rawContent`,version>=4);
      mustString(m.renderedContent, `${at}.renderedContent`,version>=4);
      mustString(m.role, `${at}.role`, true);
      mustRecord(m.metadata, `${at}.metadata`);
      const versions = mustArray(m.versions, `${at}.versions`,version>=4);
      versions.forEach((v, i) => { if (!isRecord(v) && typeof v !== 'string') invalid(`${at}.versions[${i}]`, '结构无效'); if(isRecord(v))mustString(v.content,`${at}.versions[${i}].content`,version>=4); });
    }});
  }
  function validateLibrary(raw) {
    if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new Error('备份不是资料库 JSON 对象');
    if(raw.format && !['mimamao-tavern-standalone','mimamao-tavern-full-settings'].includes(raw.format))throw new Error('备份格式不属于咪嘛馆');
    if(raw.format==='mimamao-tavern-full-settings' && !raw.data?.library)throw new Error('完整设置备份缺少 library');
    const src=raw.format==='mimamao-tavern-full-settings'?raw.data.library:(raw.data||raw);
    if(!src || typeof src!=='object' || Array.isArray(src))throw new Error('资料库主体格式无效');
    // A v4 snapshot has *seven* mandatory collections. Earlier schema 2/3
    // archives predate Novel Studio; only those explicitly versioned archives
    // may legitimately omit newer collections.
    if(!['sessions','masks','presets','worldbooks'].every(key=>Array.isArray(src[key])))throw new Error('资料库缺失必需的数组字段（sessions/masks/presets/worldbooks），拒绝空库覆盖');
    const version=src.schemaVersion;
    if (!Number.isInteger(version) || version < 2 || version > 4) throw new Error('备份 schemaVersion 缺失或不受支持（仅接受 2/3/4）');
    const contractRevision=src.backupContractRevision;
    if(contractRevision!==undefined && (version!==4||![1,2].includes(contractRevision)))invalid('backupContractRevision','不受支持的完整备份契约版本');
    const required=version===4?['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects',...(contractRevision===2?['theaterCards','quickCommands']:[])]:['sessions','masks','presets','worldbooks'];
    for (const key of required) if (!Array.isArray(src[key])) invalid(key,'缺失必需数组字段，拒绝覆盖');
    if(version===4)mustRecord(src.themeSettings,'themeSettings',true);
    for (const key of ['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects','settingTemplates','theaterCards','quickCommands']) mustArray(src[key], key, required.includes(key));
    validateItems(src.sessions, 'sessions', {validate:(s,at)=>{
      persistedTextFields(s,['summary','rollingSummary','longSummary','sceneSummary','characterPsychSummary','relationshipSummary','lastScene','userNotes','aiNotes','directorNote'],at,version);
      validateMessages(mustArray(s.messages, `${at}.messages`, true), `${at}.messages`, version);
      validateMessages(mustArray(s.deletedMessages, `${at}.deletedMessages`, version>=4), `${at}.deletedMessages`, version);
      const branches=mustArray(s.archivedBranches, `${at}.archivedBranches`,version>=4);
      validateItems(branches,`${at}.archivedBranches`,{requireId:version>=4,validate:(branch,bp)=>{
        validateMessages(mustArray(branch.messages,`${bp}.messages`,version>=4),`${bp}.messages`,version);
      }});
      for(const key of ['worldbookIds','presetIds','regexPackIds','tags','pinnedFacts','unresolvedHooks']) mustStringList(s[key], `${at}.${key}`,version>=4);
      if (version>=4) mustRecord(s.manualMemory,`${at}.manualMemory`,true);
      if (s.manualMemory !== undefined) {
        mustObject(s.manualMemory, `${at}.manualMemory`);
        validateItems(mustArray(s.manualMemory.facts, `${at}.manualMemory.facts`,version>=4), `${at}.manualMemory.facts`, {requireId:version>=4,validate:(f,fp)=>mustString(f.content,`${fp}.content`,version>=4)});
        mustRecord(s.manualMemory.core, `${at}.manualMemory.core`,version>=4);
        if(s.manualMemory.core)mustString(s.manualMemory.core.content,`${at}.manualMemory.core.content`,version>=4);
        mustRecord(s.manualMemory.settings, `${at}.manualMemory.settings`,version>=4);
      }
      mustRecord(s.storyState, `${at}.storyState`,version>=4);
      mustRecord(s.promptSettings, `${at}.promptSettings`,version>=4);
    }});
    validateItems(src.masks, 'masks', {validate:(m,at)=>{
      persistedTextFields(m,['content','description','scenario','firstMessage','exampleDialogue','creatorNotes'],at,version);
      for (const key of ['aliases','tags']) mustStringList(m[key],`${at}.${key}`,version>=4);
    }});
    validateItems(src.presets, 'presets',{validate:(p,at)=>persistedTextFields(p,['content','description'],at,version)});
    validateItems(src.worldbooks, 'worldbooks', {validate:(w,at)=>{
      validateItems(mustArray(w.entries, `${at}.entries`, true), `${at}.entries`, {requireId:version>=4, validate:(e,ep)=>{
        mustString(e.content,`${ep}.content`,version>=4);
        mustStringList(e.keywords,`${ep}.keywords`,version>=4);
        mustStringList(e.secondaryKeywords,`${ep}.secondaryKeywords`,version>=4);
      }});
      mustStringList(w.tags,`${at}.tags`,version>=4);
    }});
    validateItems(src.cssPresets||[], 'cssPresets', {validate:(c,at)=>mustString(c.css,`${at}.css`,version>=4)});
    validateItems(src.regexPacks||[], 'regexPacks', {validate:(p,at)=>{
      validateItems(mustArray(p.rules,`${at}.rules`,version>=4),`${at}.rules`,{requireId:false,validate:(rule,rp)=>persistedTextFields(rule,['pattern','replacement'],rp,version)});
    }});
    mustArray(src.theaterCards,'theaterCards',false);mustArray(src.quickCommands,'quickCommands',false);
    validateItems(src.theaterCards||[],'theaterCards',{validate:(p,at)=>{mustString(p.content,`${at}.content`,true);if(!['html','js'].includes(p.kind))invalid(`${at}.kind`,'不支持的小剧场类型');}});
    validateItems(src.quickCommands||[],'quickCommands',{validate:(p,at)=>{mustString(p.content,`${at}.content`,true);if(p.mode!==undefined&&!['send','fill'].includes(p.mode))invalid(`${at}.mode`,'不支持的指令动作');}});
    for(const [i,session]of src.sessions.entries())mustStringList(session.theaterCardIds,`sessions[${i}].theaterCardIds`,false);
    validateItems(src.novelProjects||[], 'novelProjects', {validate:(p,at)=>{
      const release=version===4?legacyProjectContract(src,p,at,contractRevision):'old';
      const chapterItems=mustArray(p.chapters,`${at}.chapters`,true);
      const ids=validateItems(chapterItems,`${at}.chapters`,{validate:(c,cp)=>{
        mustString(c.title,`${cp}.title`);
        const segments=mustArray(c.segments,`${cp}.segments`,true);
        validateItems(segments,`${cp}.segments`,{validate:(s,sp)=>{
          mustString(s.content,`${sp}.content`,true);
          mustString(s.kind,`${sp}.kind`);
          if(s.generationId!==undefined&&s.generationId!==null)mustString(s.generationId,`${sp}.generationId`);
        }});
        mustRecord(c.summary,`${cp}.summary`,version>=4);
        if(c.summary){
          for(const key of ['events','revealedFacts','openThreads','foreshadowing'])mustStringList(c.summary[key],`${cp}.summary.${key}`,version>=4);
          validateItems(mustArray(c.summary.characterChanges,`${cp}.summary.characterChanges`,version>=4),`${cp}.summary.characterChanges`,{requireId:false});
          for(const key of ['overview','endingState'])mustString(c.summary[key],`${cp}.summary.${key}`,version>=4);
        }
        // v1.3.1 really emitted chapters without memoryDelta. Later versions
        // always emitted it (including an explicit null for unanalyzed chapters).
        mustNullableRecord(c.memoryDelta,`${cp}.memoryDelta`,version>=4&&release!=='v131');
        if(c.memoryDelta){
          validateNarrative(c.memoryDelta,`${cp}.memoryDelta`);
          for(const key of ['closedThreads','resolvedForeshadowing'])mustStringList(c.memoryDelta[key],`${cp}.memoryDelta.${key}`);
        }
      }});
      if(!ids.size)invalid(`${at}.chapters`,'不能为空');
      const order=mustArray(p.chapterOrder,`${at}.chapterOrder`,true),seenOrder=new Set();
      for(const [i,id] of order.entries()){
        if(typeof id!=='string'||!ids.has(id)||seenOrder.has(id))invalid(`${at}.chapterOrder[${i}]`,'章节目录引用无效或重复');
        seenOrder.add(id);
      }
      if(seenOrder.size!==ids.size)invalid(`${at}.chapterOrder`,'章节目录缺少章节引用');
      if(p.activeChapterId!==undefined&&p.activeChapterId!==null&&!ids.has(p.activeChapterId))invalid(`${at}.activeChapterId`,'章节引用无效');
      for(const key of ['presetIds','worldbookIds'])mustStringList(p[key],`${at}.${key}`,version>=4);
      mustString(p.sourceText,`${at}.sourceText`,version>=4);
      mustRecord(p.narrativeState,`${at}.narrativeState`,version>=4);
      if(p.narrativeState){
        // A new/unanalysed novel legitimately stores {}. Once narrative
        // state has been constructed by the memory engine (including a manual
        // patch), the engine always emits manualOverrides, even if it is {}.
        // Missing it from this mature snapshot destroys owner-authored facts.
        const matureKeys=['storyOverview','currentSituation','characterStates','relationships','timeline','openThreads','foreshadowing','revealedFacts','locations','sourceChapterRevisions','lastUpdatedAt'];
        const mature=matureKeys.some(key=>hasOwn(p.narrativeState,key));
        validateNarrative(p.narrativeState,`${at}.narrativeState`,false,mature);
      }
      // The checkpoint did not exist in v1.3.1 or v1.3.2, although both
      // used schemaVersion=4. It became an explicit nullable field in 1.3.3.
      mustNullableRecord(p.legacyNarrativeCheckpoint,`${at}.legacyNarrativeCheckpoint`,version>=4&&['current','v133'].includes(release));
      if(p.legacyNarrativeCheckpoint){
        const cp=p.legacyNarrativeCheckpoint;
        if(cp.kind!=='legacy_narrative_checkpoint_v1'||!ids.has(cp.throughChapterId))invalid(`${at}.legacyNarrativeCheckpoint`,'类型或章节引用无效');
        mustRecord(cp.state,`${at}.legacyNarrativeCheckpoint.state`,true);
        validateNarrative(cp.state,`${at}.legacyNarrativeCheckpoint.state`);
        const reviews=mustArray(cp.reviews,`${at}.legacyNarrativeCheckpoint.reviews`);
        reviews.forEach((r,i)=>{
          const rp=`${at}.legacyNarrativeCheckpoint.reviews[${i}]`;
          mustObject(r,rp);
          if(!['storyOverview','currentSituation','characterStates','relationships','timeline','openThreads','foreshadowing','revealedFacts','locations'].includes(r.field))invalid(`${rp}.field`,'核查项类型无效');
          if(!ids.has(r.chapterId))invalid(`${rp}.chapterId`,'来源章节不存在');
          if(!Number.isInteger(r.index)||r.index < 0)invalid(`${rp}.index`,'条目序号无效');
          mustString(r.chapterHash,`${rp}.chapterHash`,true);
        });
        validateItems(mustArray(cp.sourceChapters,`${at}.legacyNarrativeCheckpoint.sourceChapters`,true),`${at}.legacyNarrativeCheckpoint.sourceChapters`,{validate:(src,sp)=>{
          if(!ids.has(src.id))invalid(`${sp}.id`,'来源章节不存在');
          mustString(src.hash,`${sp}.hash`,true);
        }});
      }
      for(const key of ['modelSettings','generationSettings','appearance','memoryStatus'])mustRecord(p[key],`${at}.${key}`,version>=4);
      const drafts=mustArray(p.drafts,`${at}.drafts`,version>=4),gens=mustArray(p.generations,`${at}.generations`,version>=4);
      const draftIds=validateItems(drafts,`${at}.drafts`,{validate:(d,dp)=>{
        if(typeof d.chapterId!=='string'||!ids.has(d.chapterId))invalid(`${dp}.chapterId`,'章节引用损坏');
        mustString(d.content,`${dp}.content`,true);
        mustRecord(d.metadata,`${dp}.metadata`,version>=4);
      }});
      const generationIds=validateItems(gens,`${at}.generations`,{validate:(g,gp)=>{
        if(typeof g.chapterId!=='string'||!ids.has(g.chapterId))invalid(`${gp}.chapterId`,'章节引用损坏');
        mustArray(g.attempts,`${gp}.attempts`,version>=4).forEach((attempt,i)=>mustObject(attempt,`${gp}.attempts[${i}]`));
        persistedTextFields(g,['directorNote','error'],gp,version);
        mustRecord(g.inputSnapshot,`${gp}.inputSnapshot`,version>=4);
      }});
      for(const [i,d] of drafts.entries())if(d.generationId && !generationIds.has(d.generationId))invalid(`${at}.drafts[${i}].generationId`,'Generation 引用损坏');
      for(const [i,g] of gens.entries())if(g.draftId && !draftIds.has(g.draftId))invalid(`${at}.generations[${i}].draftId`,'Draft 引用损坏');
    }});
    return src;
  }
  function validateNarrative(state,path,required = false,manualRequired = false){
    for(const key of ['timeline','openThreads','foreshadowing','revealedFacts','locations'])mustStringList(state[key],`${path}.${key}`,required);
    for(const key of ['characterStates','relationships']){
      mustArray(state[key],`${path}.${key}`,required).forEach((item,i)=>mustObject(item,`${path}.${key}[${i}]`));
    }
    for(const key of ['storyOverview','currentSituation'])mustString(state[key],`${path}.${key}`,required);
    mustRecord(state.sourceChapterRevisions,`${path}.sourceChapterRevisions`,required);
    mustRecord(state.manualOverrides,`${path}.manualOverrides`,required||manualRequired);
    if(state.manualOverrides){
      const patch=state.manualOverrides;
      for(const key of ['storyOverview','currentSituation'])if(hasOwn(patch,key))mustString(patch[key],`${path}.manualOverrides.${key}`,true);
      for(const key of ['timeline','openThreads','foreshadowing','revealedFacts','locations'])
        if(hasOwn(patch,key))mustStringList(patch[key],`${path}.manualOverrides.${key}`,true);
      for(const key of ['characterStates','relationships'])if(hasOwn(patch,key))
        mustArray(patch[key],`${path}.manualOverrides.${key}`,true).forEach((item,i)=>mustObject(item,`${path}.manualOverrides.${key}[${i}]`));
    }
  }
  async function importAll(raw){
    const src=validateLibrary(raw);
    // Preserve the historical low-level entrypoint, but let the same Core
    // normalizer migrate v2/v3 and early-v4 projects before committing. A
    // raw shallow put of a v1.3.1 project would leave a schema-v4 record with
    // no memoryDelta/checkpoint and falsely suggest it was fully migrated.
    if(typeof window.MimaStandalone?.importLibrary==='function')return window.MimaStandalone.importLibrary(raw);
    const isOld=src.schemaVersion<4||src.novelProjects.some(p=>
      !hasOwn(p,'recordRevision')||!hasOwn(p,'legacyNarrativeCheckpoint')||p.chapters.some(c=>!hasOwn(c,'memoryDelta')));
    if(isOld)throw new Error('旧版资料导入需要已加载的 Standalone Core 完成无损迁移，本次未写入');
    const next={
      schemaVersion:4,
      sessions:Array.isArray(src.sessions)?src.sessions:[],
      masks:Array.isArray(src.masks)?src.masks:[],
      presets:Array.isArray(src.presets)?src.presets:[],
      worldbooks:Array.isArray(src.worldbooks)?src.worldbooks:[],
      cssPresets:Array.isArray(src.cssPresets)?src.cssPresets:[],
      regexPacks:Array.isArray(src.regexPacks)?src.regexPacks:[],
      theaterCards:Array.isArray(src.theaterCards)?src.theaterCards:[],quickCommands:Array.isArray(src.quickCommands)?src.quickCommands:[],
      settingTemplates:Array.isArray(src.settingTemplates)?src.settingTemplates:[],
      novelProjects:Array.isArray(src.novelProjects)?src.novelProjects:[],
      themeSettings:src.themeSettings&&typeof src.themeSettings==='object'?src.themeSettings:{...EMPTY_THEME}
    };
    const current=await loadState();return saveState(next, Number(current.storeRevision)||0);
  }
  async function saveSettingsSnapshot(snapshot){ return set(SETTINGS_SNAPSHOT_KEY,{...(snapshot||{}),savedAt:new Date().toISOString()}); }
  async function loadSettingsSnapshot(){ const existing=await get(SETTINGS_SNAPSHOT_KEY); return existing&&typeof existing==='object'?existing:null; }
  async function clearSettingsSnapshot(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(SETTINGS_SNAPSHOT_KEY);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();reject(tx.error)}});
  }

  // Durable per-session memory journal is stored next to, but independent from,
  // the canonical state record. No new database/version or destructive migration.
  const jobKey=(sessionId,kind)=>`memory_job:${sessionId}:${kind}`;
  const MEMORY_LEASE_MS=45000; // durable ownership, not a Provider request timeout
  // Contract covers ONLY the owner's chosen reference resources. Comparing an
  // unrelated preset or appended History would incorrectly discard good work.
  // It is deliberately a canonical-state projection, not a UI cache or a
  // digest of the assistant's prose (which cannot establish resource version).
  function memoryReferenceContract(canonical,sessionId,referenceSelection=null){
    if(!isCanonicalStateRecord(canonical))throw new Error('E_MEMORY_REFERENCE_STATE_UNVERIFIED');
    const session=canonical.sessions.find(s=>s?.id===sessionId);
    if(!session)throw new Error('E_STORY_SESSION_MISSING');
    const raw=session.manualMemory?.settings?.summaryContext||{};
    const ids=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x):[];
    const mode=['selected_entries','matched_entries'].includes(raw.worldbookMode)?raw.worldbookMode:'none';
    const context={userPersona:raw.userPersona===true,characterPersona:raw.characterPersona===true,
      presetIds:ids(raw.presetIds),worldbookMode:mode,worldbookIds:ids(raw.worldbookIds),
      worldbookEntryIds:ids(raw.worldbookEntryIds),
      worldbookEntryRefs:Array.isArray(raw.worldbookEntryRefs)?raw.worldbookEntryRefs
        .filter(r=>r&&typeof r.bookId==='string'&&typeof r.entryId==='string').map(r=>[r.bookId,r.entryId]):[]};
    const find=(list,id,kind)=>{
      const v=(list||[]).find(item=>item?.id===id);
      if(!v||v.enabled===false)throw new Error('E_MEMORY_REFERENCE_MISSING:'+kind+':'+id);
      return v;
    };
    const safeText=v=>String(v??'').replace(/\uFFFD+/g,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
    const maskRecord=(id,kind)=>{
      const m=find(canonical.masks,id,kind),description=safeText(m.description);
      return {id:m.id,name:safeText(m.name||'未命名面具'),description,
        content:safeText(m.content||m.persona||m.description),
        scenario:safeText(m.scenario),exampleDialogue:safeText(m.exampleDialogue||m.mes_example)};
    };
    const entryRecord=e=>({id:e.id,content:safeText(e.content),enabled:e.enabled!==false,
      keywords:ids(e.keywords),secondaryKeywords:ids(e.secondaryKeywords),
      alwaysActive:e.alwaysActive===true,matchMode:e.matchMode==='all'?'all':'any',
      caseSensitive:e.caseSensitive===true,useRegex:e.useRegex===true,
      scanDepth:Number.isFinite(Number(e.scanDepth))?Number(e.scanDepth):12,
      depth:Number.isFinite(Number(e.depth))?Number(e.depth):0,
      priority:Number.isFinite(Number(e.priority))?Number(e.priority):50,
      position:['front','middle','back'].includes(e.position)?e.position:'middle',
      maxChars:Number.isFinite(Number(e.maxChars))?Number(e.maxChars):0});
    // Canonicalize legacy aliases against the exact mounted books once.
    // A change to a DIFFERENT book's same-named entry cannot invalidate this task.
    const refs=window.MimaWorldbookRefs;
    const referencedBooks=mode==='none'?[]:context.worldbookIds.map(id=>{
      if(!ids(session.worldbookIds).includes(id))throw new Error('E_MEMORY_REFERENCE_UNMOUNTED:worldbook:'+id);
      return find(canonical.worldbooks,id,'worldbook');
    });
    if(mode!=='none'&&(!refs?.resolveSelectedWorldbookRefs||!refs?.resolveMatchedWorldbookRefs))throw Error('E_MEMORY_REFERENCE_RESOLVER_MISSING');
    if(mode==='matched_entries'&&!Array.isArray(referenceSelection)&&referencedBooks.some(book=>(book.entries||[]).some(entry=>entry.useRegex===true&&entry.enabled!==false)))throw Error('E_MEMORY_REFERENCE_ASYNC_REQUIRED');
    const effectiveRefs=mode==='selected_entries'?refs.resolveSelectedWorldbookRefs({
      bookIds:context.worldbookIds,books:referencedBooks,
      scopedRefs:context.worldbookEntryRefs,legacyIds:context.worldbookEntryIds
    }):mode==='matched_entries'&&Array.isArray(referenceSelection)?referenceSelection:
      mode==='matched_entries'?refs.resolveMatchedWorldbookRefs({bookIds:context.worldbookIds,books:referencedBooks,messages:session.messages}):[];
    if(mode==='matched_entries'&&Array.isArray(referenceSelection)){
      const valid=new Set(referencedBooks.flatMap(book=>(book.entries||[]).map(entry=>JSON.stringify([book.id,entry.id]))));
      if(effectiveRefs.some(ref=>!Array.isArray(ref)||!valid.has(JSON.stringify(ref))))throw Error('E_MEMORY_REFERENCE_MISSING:matched_entry');
      // RegExp results were verified in an isolated Worker BEFORE the job.
      // Bind every activation input, including nonmatching rule metadata and
      // history windows. The IDB transaction can recheck bytes without
      // executing unbounded user regex. Nonmatching content is not signed.
      context.activationSource=referencedBooks.flatMap(book=>(book.entries||[]).map(entry=>({bookId:book.id,id:entry.id,
        enabled:entry.enabled!==false,alwaysActive:entry.alwaysActive===true,
        // A previously empty unmatched entry can become active solely when
        // content is added, even if keywords and History do not change.
        contentPresent:!!String(entry.content??'').trim(),
        keywords:ids(entry.keywords),secondaryKeywords:ids(entry.secondaryKeywords),
        matchMode:entry.matchMode==='all'?'all':'any',caseSensitive:entry.caseSensitive===true,
        useRegex:entry.useRegex===true,scanDepth:Number(entry.scanDepth)||12})));
      const depth=context.activationSource.reduce((n,e)=>Math.max(n,Math.max(1,e.scanDepth)),0);
      context.activationHistory=depth?(session.messages||[]).filter(m=>m?.content&&m.role!=='system'&&m.role!=='director')
        .slice(-depth).map(m=>String(m.content)):[];
    }
    context.worldbookEntryRefs=effectiveRefs;
    context.worldbookEntryIds=[]; // obsolete aliases must not alter the effective digest
    const scoped=new Set(effectiveRefs.map(ref=>JSON.stringify(ref)));
    const chosen={context,
      characterPersona:context.characterPersona?maskRecord(session.loadedCharMaskId,'character'):null,
      userPersona:context.userPersona?maskRecord(session.loadedUserMaskId,'user'):null,
      presets:context.presetIds.map(id=>{
        if(!ids(session.presetIds).includes(id))throw new Error('E_MEMORY_REFERENCE_UNMOUNTED:preset:'+id);
        const p=find(canonical.presets,id,'preset');return {id:p.id,content:safeText(p.content)};
      }),
      worldbooks:mode==='none'?[]:context.worldbookIds.map(id=>{
        if(!ids(session.worldbookIds).includes(id))throw new Error('E_MEMORY_REFERENCE_UNMOUNTED:worldbook:'+id);
        const book=find(canonical.worldbooks,id,'worldbook');
        const selected=(mode==='selected_entries'||mode==='matched_entries')?(book.entries||[]).filter(e=>scoped.has(JSON.stringify([id,e.id]))):(book.entries||[]);
        return {id,entries:selected.map(entryRecord)};
      })
    };
    const stable=(v)=>JSON.stringify(v,(_key,x)=>x&&typeof x==='object'&&!Array.isArray(x)
      ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
    if(!window.MimaSHA256?.digest)throw new Error('E_MEMORY_REFERENCE_HASH_UNAVAILABLE');
    return window.MimaSHA256.digest(new TextEncoder().encode(stable(chosen)));
  }
  const htmlRepairKey=(id,msgId)=>'html_repair_candidate_v1:'+id+':'+msgId;
  const htmlRepairArchiveKey=id=>'html_repair_immutable_v2:'+id;
  async function putHtmlRepairCandidate(candidate){
    if(!candidate?.id||candidate.state!=='pending'||typeof candidate.proposedContent!=='string')throw Error('E_HTML_REPAIR_INVALID');
    // Keep all superseded pending candidates for audit. Pointer + immutable
    // content share one transaction; a second tab may replace only the pointer,
    // never destroy an older attempted repair.
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      kv.put(candidate,htmlRepairArchiveKey(candidate.id));
      kv.put(candidate,htmlRepairKey(candidate.sessionId,candidate.messageId));
      tx.oncomplete=()=>{db.close();resolve(candidate)};
      tx.onabort=()=>{db.close();reject(tx.error||Error('E_HTML_REPAIR_STORE_FAILED'))};
    });
  }
  async function getHtmlRepairCandidate(sessionId,msgId){return get(htmlRepairKey(sessionId,msgId));}
  async function setHtmlRepairCandidateState(sessionId,msgId,id,state){
    if(!['approved','rejected'].includes(state))throw Error('E_HTML_REPAIR_STATUS_INVALID');
    const key=htmlRepairKey(sessionId,msgId),db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),req=kv.get(key);let problem;
      req.onerror=()=>{problem=req.error;tx.abort();};req.onsuccess=()=>{
        if(!req.result||req.result.id!==id||req.result.state!=='pending'){problem=Error('E_HTML_REPAIR_FENCED');tx.abort();return;}
        const settled={...req.result,state,settledAt:new Date().toISOString()};
        kv.put(settled,key);kv.put(settled,htmlRepairArchiveKey(id));
      };
      tx.oncomplete=()=>{db.close();resolve(state);};tx.onabort=()=>{db.close();reject(problem||tx.error||Error('E_HTML_REPAIR_STORE_FAILED'));};
    });
  }
  // A repair approval and canonical story write are one settlement. A failed
  // candidate-state update must never leave a silently committed story, or the
  // reverse. The IDB transaction fences both the candidate pointer and the
  // canonical record against independent tabs and retained old candidates.
  async function commitHtmlRepair(candidateState,expectedRevision,sessionId,messageId,candidateId,expectedRecordRevision){
    assertWritableState(candidateState);
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      let presentState=false,presentCandidate=false,current,repair,result,problem;
      const fail=e=>{problem=e;try{tx.abort();}catch(_){/* onabort reports */}};
      const settle=()=>{
        if(!presentState||!presentCandidate)return;
        if(current!==undefined&&!isCanonicalStateRecord(current))return fail(Error('E_CANONICAL_STATE_UNVERIFIED'));
        if(!current)return fail(Error('E_CANONICAL_STATE_NOT_FOUND'));
        const revision=Number(current.storeRevision)||0;
        if(revision!==expectedRevision)return fail(Error('E_CANONICAL_CONFLICT: repair revision changed'));
        if(!repair||repair.id!==candidateId||repair.state!=='pending'||repair.sessionId!==sessionId||repair.messageId!==messageId)
          return fail(Error('E_HTML_REPAIR_FENCED'));
        const currentSession=current.sessions.find(x=>x.id===sessionId);
        const candidateSession=candidateState.sessions.find(x=>x.id===sessionId);
        if(!currentSession||!candidateSession||
          Number(currentSession.recordRevision||0)!==Number(expectedRecordRevision||0)||
          Number(candidateSession.recordRevision||0)!==Number(expectedRecordRevision||0)+1)
          return fail(Error('E_HTML_REPAIR_STALE_SESSION'));
        // Any unrelated canonical collection changed since preview fails closed.
        result={...candidateState,storeRevision:revision+1,schemaVersion:4,savedAt:new Date().toISOString()};
        const settled={...repair,state:'approved',settledAt:result.savedAt};
        kv.put(result,STATE_KEY);
        kv.put(settled,htmlRepairKey(sessionId,messageId));
        kv.put(settled,htmlRepairArchiveKey(candidateId));
      };
      const a=kv.get(STATE_KEY),b=kv.get(htmlRepairKey(sessionId,messageId));
      a.onerror=()=>fail(a.error||Error('E_CANONICAL_READ_FAILED'));
      b.onerror=()=>fail(b.error||Error('E_HTML_REPAIR_READ_FAILED'));
      a.onsuccess=()=>{current=a.result;presentState=true;settle();};
      b.onsuccess=()=>{repair=b.result;presentCandidate=true;settle();};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(problem||tx.error||Error('E_HTML_REPAIR_ATOMIC_ABORT'))};
      tx.onerror=()=>{ /* onabort preserves root error */ };
    });
  }
  const rollingPreflightKey=sessionId=>'memory_rolling_preflight_v1:'+sessionId;
  async function getRollingPreflight(sessionId){return get(rollingPreflightKey(sessionId));}
  async function putRollingPreflight(sessionId,record){
    if(!sessionId||!record||!['E_ROLLING_AUTO_BUDGET','E_MEMORY_ROLLING_WINDOW_UNVERIFIED','E_MEMORY_CAPACITY','E_MEMORY_WINDOW_UNVERIFIED'].includes(String(record.code)))
      throw Error('E_ROLLING_PREFLIGHT_INVALID');
    // Single transaction fences late older attempts against the current
    // canonical source. An unrelated or stale tab cannot overwrite the report.
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let result,problem;
      const req=kv.get(STATE_KEY);
      req.onerror=()=>{problem=req.error||Error('E_CANONICAL_READ_FAILED');tx.abort();};
      req.onsuccess=()=>{
        try{
          const current=req.result;
          if(!isCanonicalStateRecord(current))throw Error('E_CANONICAL_STATE_UNVERIFIED');
          const session=current.sessions.find(item=>item.id===sessionId);
          if(!session||Number(session.recordRevision||0)!==Number(record.sourceRevision||0)||
             session.messages?.length!==Number(record.sourceCount||0))throw Error('E_ROLLING_PREFLIGHT_SOURCE_CHANGED');
          result={version:1,kind:'rolling_preflight',sessionId,status:'paused_no_charge',
            code:String(record.code),requestCount:Number(record.requestCount)||null,
            allowedRequests:Number(record.allowedRequests)||1,contextWindowTokens:Number(record.contextWindowTokens)||null,
            estimatedInputTokens:Number(record.estimatedInputTokens)||null,
            sourceCount:Number(record.sourceCount)||0,sourceRevision:Number(record.sourceRevision)||0,
            detail:String(record.detail||'').slice(0,600),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
          kv.put(result,rollingPreflightKey(sessionId));
        }catch(e){problem=e;tx.abort();}
      };
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onerror=()=>{problem=problem||tx.error;};
      tx.onabort=()=>{db.close();reject(problem||tx.error||Error('E_ROLLING_PREFLIGHT_WRITE_FAILED'));};
    });
  }
  async function clearRollingPreflight(sessionId){
    // Keep successful old jobs and history untouched; only retire this diagnostic.
    const db=await openDb();return new Promise((resolve,reject)=>{
      let issue;const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(rollingPreflightKey(sessionId));
      tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>{issue=tx.error;};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_ROLLING_PREFLIGHT_DELETE_FAILED'));};
    });
  }
  async function getMemoryJob(sessionId,kind){return get(jobKey(sessionId,kind));}
  async function memoryJobTransaction(sessionId,kind,work){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let result,issue;
      const req=kv.get(jobKey(sessionId,kind));req.onerror=()=>{issue=req.error;tx.abort();};
      req.onsuccess=()=>{try{result=work(req.result,kv,tx);}catch(e){issue=e;tx.abort();}};
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_JOURNAL_WRITE_FAILED'));};
    });
  }
  // Checkpoints are a bounded diagnostic ledger. Accepted stage candidates
  // require an independent durable key in the SAME verified IndexedDB store.
  const stageRecordKey=(job,stage,digest)=>'memory_stage_v1:'+job.sessionId+':'+job.kind+':'+stage+':'+digest;
  // v2 is addressed by the full effective stage contract, NOT the whole job.
  // Append-only History must not invalidate an already checked stage.
  const stageV2Key=digest=>'memory_stage_v2:'+digest;
  async function getMemoryStage(job,stage,digest,legacyDigest=null){
    const candidate=await get(stageV2Key(digest));
    if(candidate){
      if(candidate.status!=='STAGED'||candidate.version!==2||candidate.sessionId!==job.sessionId||candidate.kind!==job.kind||candidate.stage!==stage||candidate.contractDigest!==digest||typeof candidate.outputText!=='string')
        throw new Error('E_MEMORY_STAGE_CONTRACT_MISMATCH');
      return candidate;
    }
    // Legacy v1 records are left untouched; only identical complete-job source
    // and exactly matching old contracts can ever be reused.
    const legacy=await get(stageRecordKey(job,stage,legacyDigest||digest));
    if(!legacy)return null;
    if(legacy.version!==1||legacy.status!=='STAGED'||legacy.sessionId!==job.sessionId||legacy.kind!==job.kind||legacy.stage!==stage||legacy.sourceHash!==job.sourceHash||legacy.sourceFingerprint!==job.sourceFingerprint||legacy.contractDigest!==(legacyDigest||digest)||typeof legacy.outputText!=='string'||!legacy.outputDigest)
      throw new Error('E_MEMORY_STAGE_CONTRACT_MISMATCH');
    return legacy;
  }
  async function listMemoryStages(sessionId,kind){
    if(typeof sessionId!=='string'||!['core','facts','rolling'].includes(kind))throw Error('E_MEMORY_STAGE_LIST_SCOPE');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),cursor=tx.objectStore(STORE).openCursor(),entries=[];let issue;
      cursor.onerror=()=>{issue=cursor.error;tx.abort();};
      cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;
        const x=entry.value;
        if(typeof entry.key==='string'&&entry.key.startsWith('memory_stage_v2:')&&x?.status==='STAGED'&&x?.version===2&&x.sessionId===sessionId&&x.kind===kind&&typeof x.outputText==='string')entries.push(x);
        entry.continue();};
      tx.oncomplete=()=>{db.close();resolve(entries.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))));};
      tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_STAGE_LIST_READ_FAILED'));};
    });
  }
  // Failed provider replies are evidence, never approved memory. Retain their
  // visible text in a separate durable archive with attempt identity and cause.
  async function putMemoryRejectedDraft(job,stage,rawText,meta={}){
    const text=String(rawText??'');if(!text)return null;
    const key=`memory_rejected_v1:${job.sessionId}:${job.kind}:${job.id}:${job.attemptId}:${stage}`;
    return memoryJobTransaction(job.sessionId,job.kind,(old,kv)=>{
      if(old?.id!==job.id||old?.attemptId!==job.attemptId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const record={version:1,status:'REJECTED',sessionId:job.sessionId,kind:job.kind,
        jobId:job.id,attemptId:job.attemptId,stage,sourceHash:job.sourceHash,
        sourceCount:job.sourceCount,sourceRange:meta.sourceRange||null,
        finishReason:String(meta.finishReason||'unknown'),reason:String(meta.reason||'invalid'),
        text,truncatedForStorage:false,
        chars:text.length,createdAt:new Date().toISOString()};
      kv.put(record,key);return record;
    });
  }
  async function listMemoryRejectedDrafts(sessionId,kind){
    if(typeof sessionId!=='string'||!['core','facts','rolling'].includes(kind))throw Error('E_MEMORY_REJECTED_SCOPE');
    const prefix=`memory_rejected_v1:${sessionId}:${kind}:`;
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),cursor=tx.objectStore(STORE).openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff')),out=[];let issue;
      cursor.onerror=()=>{issue=cursor.error;tx.abort();};
      cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;
        if(typeof entry.key==='string'&&entry.key.startsWith(prefix)&&entry.value?.status==='REJECTED')out.push(entry.value);
        entry.continue();};
      tx.oncomplete=()=>{db.close();resolve(out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))));};
      tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_REJECTED_READ'));};
    });
  }
  async function inspectLegacyMemoryStages(sessionId,kind){
    if(!['core','facts','rolling'].includes(kind)||typeof sessionId!=='string')throw new Error('E_MEMORY_LEGACY_SCOPE_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).openCursor();let issue;const entries=[];
      const prefix='memory_stage_v1:'+sessionId+':'+kind+':';
      req.onerror=()=>{issue=req.error;tx.abort();};
      req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;
        if(typeof cursor.key==='string'&&cursor.key.startsWith(prefix)){
          const value=cursor.value;
          entries.push({stage:String(value?.stage||''),contractDigest:String(value?.contractDigest||''),
            outputLength:Number(value?.outputLength)||String(value?.outputText||'').length,
            verifiedForCurrentRequest:false,status:'LEGACY_READ_ONLY',createdAt:String(value?.createdAt||'')});
        }cursor.continue();};
      tx.oncomplete=()=>{db.close();resolve(entries);};tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_LEGACY_READ_FAILED'));};
    });
  }
  async function putMemoryStage(job,stage,digest,content,meta={}){
    if(typeof content!=='string'||!content.trim())throw new Error('E_MEMORY_STAGE_INVALID');
    return memoryJobTransaction(job.sessionId,job.kind,(old,kv)=>{
      if(old?.id!==job.id||old?.attemptId!==job.attemptId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const record={version:2,status:'STAGED',sessionId:job.sessionId,kind:job.kind,stage,contractDigest:digest,
        sourceHash:job.sourceHash,sourceFingerprint:job.sourceFingerprint,sourceCount:job.sourceCount,
        sourceRange:job.stageScopes?.[stage]||null,referenceDigest:job.referenceDigest||'',
        outputText:content,outputLength:content.length,outputDigest:meta.outputDigest||'',
        model:meta.model||'',finishReason:meta.finishReason||'',createdAt:new Date().toISOString(),
        jobId:job.id,attemptId:job.attemptId,verification:meta.verification||null};
      kv.put(record,stageV2Key(digest));return record;
    });
  }
  async function beginMemoryJob({sessionId,kind,options,sourceHash,sourceCount,sourceFingerprint,targetBaseline,configSignature,expectedReferenceContract=null,referenceSelection=null}){
    const referenceContract=memoryReferenceContract(await loadState(),sessionId,referenceSelection);
    if(expectedReferenceContract!==null&&referenceContract!==expectedReferenceContract)throw new Error('E_MEMORY_REFERENCE_CHANGED_BEFORE_REQUEST');
    return memoryJobTransaction(sessionId,kind,(old,kv,tx)=>{
      const live=old?.status==='running'&&Number(old.leaseUntilEpoch||0)>Date.now();
      if(live)throw new Error('E_MEMORY_JOB_PENDING: 另一个尚有租约的 attempt 正在运行；不能竞争结算');
      if(old?.status==='running'&&Number(old.recoveryCount||0)>=3)throw new Error('E_MEMORY_RECOVERY_LIMIT: 连续恢复已达到上限，请检查后台任务错误记录并人工操作');
      const sameSource=old?.sourceHash===sourceHash&&old?.configSignature===configSignature&&JSON.stringify(old?.options)===JSON.stringify(options);
      const resumeCandidates={},humanApprovedStages={};
      if(sameSource&&['running','failed','interrupted','aborted'].includes(old?.status)){
        for(const candidate of old.checkpoints||[]){
          if(typeof candidate.output==='string'&&candidate.stage.endsWith('_received'))resumeCandidates[candidate.stage.slice(0,-9)]=candidate.output;
          if(typeof candidate.output==='string'&&candidate.stage.startsWith('human_')&&candidate.stage.endsWith('_accepted')){
            const stage=candidate.stage.slice(6,-9);
            humanApprovedStages[stage]={output:candidate.output,sourceStartIndex:candidate.sourceStartIndex,sourceEndExclusive:candidate.sourceEndExclusive,sourceCoverageHash:candidate.sourceCoverageHash};
          }
        }
      }
      const now=new Date().toISOString(),recovering=old?.status==='running';
      const resumeIdentity=sameSource&&['running','failed','interrupted','aborted','needs_review'].includes(old?.status)&&old?.referenceContract===referenceContract;
      const priorAttempts=resumeIdentity?[...(old.recoverableAttempts||[]),old.attemptId].filter(Boolean):[];
      const job={resumeCandidates,humanApprovedStages,configSignature,sourceFingerprint,targetBaseline,referenceSelection,
        referenceContract,recoverableAttempts:[...new Set(priorAttempts)],
        recoverCommittedRanges:old?.status==='partially_committed'||old?.recoverCommittedRanges===true,
        id:resumeIdentity?old.id:`mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        attemptId:`a_${Date.now()}_${Math.random().toString(36).slice(2)}`,sessionId,kind,options,sourceHash,sourceCount,
        status:'running',stage:recovering?'recovered_pending':'prepared',code:'',startedAt:resumeIdentity?old.startedAt:now,updatedAt:now,
        checkpoints:[...(resumeIdentity?(old.checkpoints||[]):[]),{stage:'attempt_started',time:now,attemptId:null,previousAttemptId:resumeIdentity?old.attemptId:null,priorStatus:old?.status||null}].slice(-300),revision:(old?.revision||0)+1,
        leaseUntilEpoch:Date.now()+MEMORY_LEASE_MS,recoveryCount:recovering?(Number(old.recoveryCount||0)+1):0,
        recoveredFromAttemptId:resumeIdentity?old.attemptId:null};
      job.checkpoints[job.checkpoints.length-1].attemptId=job.attemptId;
      const sr=kv.get(STATE_KEY);
      sr.onerror=()=>tx.abort();
      sr.onsuccess=()=>{
        try{
          if(memoryReferenceContract(sr.result,sessionId,referenceSelection)!==referenceContract){tx.abort();return;}
          const liveSession=sr.result.sessions.find(x=>x?.id===sessionId);
          if(!Array.isArray(liveSession?.messages)||liveSession.messages.length<sourceCount||
             window.MimaStandalone?.memorySourceFingerprint?.(liveSession.messages,sourceCount)!==sourceFingerprint){tx.abort();return;}
          kv.put(job,jobKey(sessionId,kind));
        }catch(error){tx.abort();}
      };
      return job;
    });
  }
  async function heartbeatMemoryJob(job){
    return memoryJobTransaction(job.sessionId,job.kind,(old,kv)=>{
      if(old?.id!==job.id||old?.attemptId!==job.attemptId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const next={...old,updatedAt:new Date().toISOString(),leaseUntilEpoch:Date.now()+MEMORY_LEASE_MS,revision:old.revision+1};
      kv.put(next,jobKey(job.sessionId,job.kind));return next;
    });
  }
  async function checkpointMemoryJob(job,stage,extra={}){
    return memoryJobTransaction(job.sessionId,job.kind,(old,kv)=>{
      if(old?.id!==job.id||old?.attemptId!==job.attemptId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const next={...old,stage,updatedAt:new Date().toISOString(),leaseUntilEpoch:Date.now()+MEMORY_LEASE_MS,revision:old.revision+1,checkpoints:[...(old.checkpoints||[]),{stage,time:new Date().toISOString(),...extra,attemptId:job.attemptId}].slice(-300)};
      kv.put(next,jobKey(job.sessionId,job.kind));return next;
    });
  }
  async function settleMemoryJob(job,status,code=''){
    return memoryJobTransaction(job.sessionId,job.kind,(old,kv)=>{
      if(old?.id!==job.id||old?.attemptId!==job.attemptId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const next={...old,status,stage:status==='aborted'?'aborted':status==='skipped'?'skipped':status==='needs_review'?'awaiting_review':'failed',code:String(code).slice(0,120),updatedAt:new Date().toISOString(),revision:old.revision+1};
      kv.put(next,jobKey(job.sessionId,job.kind));return next;
    });
  }
  async function interruptMemoryJob(sessionId,kind,expectedId){
    return memoryJobTransaction(sessionId,kind,(old,kv)=>{
      if(!old||old.id!==expectedId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const next={...old,status:'interrupted',stage:'user_interrupted',code:'E_MEMORY_RECOVERY_REQUESTED',updatedAt:new Date().toISOString(),revision:old.revision+1};
      kv.put(next,jobKey(sessionId,kind));return next;
    });
  }
  // Atomic settlement checks source history and target memory in the *current*
  // canonical document under the same IDB readwrite transaction. A concurrent
  // chat/CSS/other session save cannot be overwritten with an old snapshot.
  async function commitMemoryJob(job,snapshot,patch){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let problem,committed;
      const fail=(message)=>{problem=new Error(message);tx.abort();};
      const jr=kv.get(jobKey(job.sessionId,job.kind));jr.onerror=()=>fail('E_MEMORY_JOURNAL_READ');
      jr.onsuccess=()=>{
        const active=jr.result;if(!active||active.id!==job.id||active.attemptId!==job.attemptId||active.status!=='running'){fail('E_MEMORY_JOB_FENCED');return;}
        const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{
          const current=sr.result;if(!isCanonicalStateRecord(current)){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const index=current.sessions.findIndex(x=>x.id===job.sessionId);if(index<0){fail('E_STORY_SESSION_MISSING');return;}
          const latest=current.sessions[index];
          if(!active.referenceContract||memoryReferenceContract(current,job.sessionId,active.referenceSelection)!==active.referenceContract){fail('E_MEMORY_REFERENCE_CHANGED');return;}
          if(!Array.isArray(latest.messages)||JSON.stringify(latest.messages.slice(0,snapshot.messages.length))!==JSON.stringify(snapshot.messages)){fail('E_MEMORY_SOURCE_STALE');return;}
          // Compare the same normalized, versioned contract on BOTH sides.
          // Presence of implicit defaults such as stale:false is not an edit;
          // actual content, revision metadata or stale:true still fences.
          const contract=window.MimaMemoryContracts;
          if(!contract||typeof contract.normalizeManualMemory!=='function'){fail('E_MEMORY_CONTRACT_UNAVAILABLE');return;}
          const currentMemory=contract.normalizeManualMemory(latest.manualMemory||{});
          const baselineMemory=contract.normalizeManualMemory(snapshot.manualMemory||{});
          if(job.kind==='facts'&&JSON.stringify(currentMemory.facts)!==JSON.stringify(baselineMemory.facts)){fail('E_MEMORY_FACTS_CONFLICT');return;}
          if(job.kind==='core'&&(JSON.stringify(currentMemory.core)!==JSON.stringify(baselineMemory.core)||(job.options?.source==='facts'&&JSON.stringify(currentMemory.facts)!==JSON.stringify(baselineMemory.facts)))){fail('E_MEMORY_CORE_CONFLICT');return;}
          if(job.kind==='rolling'&&(latest.rollingSummary!==snapshot.rollingSummary||latest.lastSummarizedIndex!==snapshot.lastSummarizedIndex)){fail('E_MEMORY_ROLLING_CONFLICT');return;}
          let currentPatch=patch;
          if(job.kind==='facts'||job.kind==='core'){
            if(!patch.manualMemory){fail('E_MEMORY_PATCH_INVALID');return;}
            const requested=contract.normalizeManualMemory(patch.manualMemory);
            const field=job.kind==='facts'?'facts':'core';
            // Independent facts/core jobs own only their target. The other
            // target and injection settings may have changed in another tab
            // after the producer built its patch; preserve the current ones.
            const settings={...currentMemory.settings};
            if(currentMemory.settings.summaryTemperature===baselineMemory.settings.summaryTemperature)
              settings.summaryTemperature=requested.settings.summaryTemperature;
            currentPatch={...patch,manualMemory:{...currentMemory,[field]:requested[field],settings}};
          }
          const changed={...latest,...currentPatch,recordRevision:(Number(latest.recordRevision)||0)+1,updatedAt:new Date().toISOString()};
          const sessions=current.sessions.slice();sessions[index]=changed;
          committed={...current,sessions,storeRevision:(Number(current.storeRevision)||0)+1,savedAt:new Date().toISOString()};
          kv.put(committed,STATE_KEY);
          kv.put({...active,status:'committed',stage:'saved',code:'',lastCommittedAttemptId:job.attemptId,revision:active.revision+1,updatedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},jobKey(job.sessionId,job.kind));
        };
      };
      tx.oncomplete=()=>{db.close();resolve(committed);};tx.onabort=()=>{db.close();reject(problem||tx.error||new Error('E_MEMORY_COMMIT_ABORTED'));};
    });
  }
  // Human approval is a single canonical DB transaction: journal stage,
  // source prefix and memory target baseline are checked under one write lock.
  async function reviewMemoryCandidate(sessionId,kind,jobId,decision,editedText){
    if(!['core','facts','rolling'].includes(kind)||!['accept','reject'].includes(decision))throw new Error('E_MEMORY_REVIEW_ACTION');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let issue,result;
      const fail=m=>{issue=new Error(m);tx.abort();};
      const jr=kv.get(jobKey(sessionId,kind));jr.onerror=()=>fail('E_MEMORY_REVIEW_JOURNAL_READ');
      jr.onsuccess=()=>{
        const job=jr.result;
        if(!job||job.id!==jobId||!['failed','interrupted','aborted','needs_review'].includes(job.status)){fail('E_MEMORY_REVIEW_FENCED');return;}
        const candidate=[...(job.checkpoints||[])].reverse().find(x=>x.stage?.endsWith('_needs_review')&&typeof x.candidate==='string'&&
          !(job.checkpoints||[]).some(y=>y.stage==='human_'+x.stage.replace(/_needs_review$/,'')+'_accepted'||y.stage==='human_'+x.stage.replace(/_needs_review$/,'')+'_rejected'));
        if(!candidate){fail('E_MEMORY_REVIEW_NOT_FOUND');return;}
        const reviewStage=candidate.stage.replace(/_needs_review$/,'');
        if((job.checkpoints||[]).some(x=>x.stage==='human_'+reviewStage+'_accepted'||x.stage==='human_'+reviewStage+'_rejected')){fail('E_MEMORY_REVIEW_ALREADY_SETTLED');return;}
        const text=String(editedText||'').trim();
        if(decision==='accept'&&(!text||text.length>25000)){fail('E_MEMORY_REVIEW_INVALID_TEXT');return;}
        const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_REVIEW_STATE_READ');sr.onsuccess=()=>{
          const state=sr.result;
          if(!isCanonicalStateRecord(state)){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const idx=state.sessions.findIndex(x=>x?.id===sessionId);
          if(idx<0){fail('E_STORY_SESSION_MISSING');return;}
          const session=state.sessions[idx];
          if(!job.referenceContract||memoryReferenceContract(state,sessionId,job.referenceSelection)!==job.referenceContract){fail('E_MEMORY_REVIEW_REFERENCE_CHANGED');return;}
          if(!job.sourceFingerprint||window.MimaStandalone?.memorySourceFingerprint(session.messages.slice(0,job.sourceCount),job.sourceCount)!==job.sourceFingerprint){fail('E_MEMORY_REVIEW_SOURCE_CHANGED');return;}
          const contract=window.MimaMemoryContracts;
          if(!contract?.normalizeManualMemory){fail('E_MEMORY_CONTRACT_UNAVAILABLE');return;}
          const mem=contract.normalizeManualMemory(session.manualMemory||{});
          const target=kind==='rolling'?JSON.stringify([session.rollingSummary||'',session.lastSummarizedIndex||0]):JSON.stringify(kind==='core'?mem.core:mem.facts);
          if(target!==job.targetBaseline){fail('E_MEMORY_REVIEW_TARGET_CHANGED');return;}
          const stamp=new Date().toISOString();
          const sourceStartIndex=Number(candidate.sourceStartIndex),sourceEndExclusive=Number(candidate.sourceEndExclusive);
          const fullCount=job.sourceCount;
          if(!Number.isInteger(sourceStartIndex)||!Number.isInteger(sourceEndExclusive)||sourceStartIndex<0||sourceEndExclusive>fullCount||sourceEndExclusive<=sourceStartIndex){fail('E_MEMORY_REVIEW_RANGE_UNKNOWN');return;}
          const slice=session.messages.slice(sourceStartIndex,sourceEndExclusive);
          const sourceCoverageHash=window.MimaStandalone.memorySourceFingerprint(slice,slice.length);
          if(sourceCoverageHash!==candidate.sourceCoverageHash){fail('E_MEMORY_REVIEW_RANGE_CHANGED');return;}
          const reviewStageId='human_'+reviewStage+'_'+(decision==='accept'?'accepted':'rejected');
          const review={stage:reviewStageId,time:stamp,sourceCount:fullCount,
            sourceStartIndex,sourceEndExclusive,sourceCoverageHash,startRound:candidate.startRound??null,endRound:candidate.endRound??null,
            messageIds:slice.map(x=>x.id),reason:candidate.reason,editChars:text.length,...(decision==='accept'?{output:text}:{})};
          const isRollingFinal=kind==='rolling'&&(reviewStage==='rolling_summary'||reviewStage==='rolling_merge');
          const plan=[...(job.checkpoints||[])].reverse().find(x=>x.stage==='rolling_source_plan');
          let canCommitRolling=false;
          if(isRollingFinal&&plan&&sourceStartIndex===plan.sourceStartIndex&&sourceEndExclusive===plan.sourceEndExclusive){
            canCommitRolling=reviewStage==='rolling_summary'&&plan.partCount===1 ||
              reviewStage==='rolling_merge'&&plan.partCount>1&&Array.from({length:plan.partCount},(_,i)=>i).every(i=>
                (job.checkpoints||[]).some(x=>x.stage==='rolling_part_'+i+'_received'||x.stage==='human_rolling_part_'+i+'_accepted'));
          }
          const coreFinal=kind==='core'&&/^core_final_(single|merge)$/.test(reviewStage);
          // A reviewed *part* is a durable stage result, not canonical memory.
          // Resuming the same source processes all other parts and the final merge.
          const writeCanonical=decision==='accept'&&(canCommitRolling||coreFinal);
          const updatedJob={...job,revision:job.revision+1,updatedAt:stamp,stage:reviewStageId,
            status:decision==='reject'?'rejected':writeCanonical?'committed':'interrupted',
            ...(writeCanonical||decision==='reject'?{finishedAt:stamp}:{}),
            checkpoints:[...(job.checkpoints||[]),review].slice(-300)};
          if(writeCanonical){
            const verification={status:'human_confirmed',stage:review.stage,citations:[],sourceType:'reviewed_story_material',reviewedAt:stamp,
              sourceStartIndex,sourceEndExclusive,sourceCoverageHash};
            let patch={};
            if(kind==='core'){
              mem.core={...mem.core,content:text,source:job.options?.source||'context',updatedAt:stamp,
                sourceCount:job.sourceCount,sourceFingerprint:job.sourceFingerprint,verification};
              patch={manualMemory:mem};
            }else if(kind==='rolling'){
              const fullEnd=plan.sourceEndExclusive;
              patch={rollingSummary:text,summary:text,rollingVerification:verification,
                lastSummarizedIndex:fullEnd,rollingSourceCount:fullEnd,
                rollingSourceFingerprint:window.MimaStandalone.memorySourceFingerprint(session.messages,fullEnd)};
            }
            const revised={...session,...patch,recordRevision:(Number(session.recordRevision)||0)+1,updatedAt:stamp};
            state.sessions[idx]=revised;kv.put({...state,storeRevision:(Number(state.storeRevision)||0)+1,savedAt:stamp},STATE_KEY);
          }
          kv.put(updatedJob,jobKey(sessionId,kind));result={status:updatedJob.status,kind,sessionId,jobId};
        };
      };
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_REVIEW_ABORTED'));};
    });
  }
  // Atomic rolling-memory revocation / restoration. Neither operation touches
  // messages, canonical History, Persona, worldbooks, or assistant memory.
  async function updateRollingMemory(sessionId,action='revoke'){
    if(!['revoke','restore'].includes(action))throw new Error('E_MEMORY_ROLLING_ACTION');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let problem,result;
      const fail=m=>{problem=new Error(m);tx.abort();};
      const jr=kv.get(jobKey(sessionId,'rolling'));
      jr.onerror=()=>fail('E_MEMORY_JOURNAL_READ');
      jr.onsuccess=()=>{
        const job=jr.result;
        if(job?.status==='running'&&Number(job.leaseUntilEpoch||0)>Date.now()){fail('E_MEMORY_JOB_PENDING');return;}
        const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_STORE_READ');
        sr.onsuccess=()=>{
          const state=sr.result;
          if(!isCanonicalStateRecord(state)){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const index=state.sessions.findIndex(s=>s?.id===sessionId);
          if(index<0){fail('E_STORY_SESSION_MISSING');return;}
          const session=state.sessions[index],archive=Array.isArray(session.rollingArchive)?session.rollingArchive.slice(-8):[];
          const keys=['summary','rollingSummary','longSummary','lastSummarizedIndex','rollingSourceCount','rollingSourceFingerprint','rollingVerification'];
          const patch={};
          if(action==='revoke'){
            if(session.rollingSummary||session.summary||session.longSummary||session.lastSummarizedIndex){
              const saved={savedAt:new Date().toISOString()};for(const key of keys)saved[key]=session[key];archive.push(saved);
            }
            Object.assign(patch,{summary:'',rollingSummary:'',longSummary:'',lastSummarizedIndex:0,rollingSourceCount:0,rollingSourceFingerprint:'',rollingVerification:{status:'legacy_unverified',stage:'revoked',citations:[]},rollingArchive:archive.slice(-8)});
          }else{
            if(session.rollingSummary||session.summary||session.longSummary||session.lastSummarizedIndex){fail('E_MEMORY_RESTORE_TARGET_NOT_EMPTY');return;}
            const saved=archive[archive.length-1];if(!saved){fail('E_MEMORY_RESTORE_NOT_FOUND');return;}
            const sourceCount=Number(saved.rollingSourceCount)||0;
            if(sourceCount>session.messages.length||sourceCount>0&&(!saved.rollingSourceFingerprint||!window.MimaStandalone?.memorySourceFingerprint||window.MimaStandalone.memorySourceFingerprint(session.messages,sourceCount)!==saved.rollingSourceFingerprint)){
              fail('E_MEMORY_RESTORE_SOURCE_CHANGED');return;
            }
            for(const key of keys)patch[key]=saved[key];patch.rollingArchive=archive.slice(0,-1);
          }
          const sessions=state.sessions.slice();sessions[index]={...session,...patch,updatedAt:new Date().toISOString(),recordRevision:(Number(session.recordRevision)||0)+1};
          kv.put({...state,sessions,storeRevision:(Number(state.storeRevision)||0)+1,savedAt:new Date().toISOString()},STATE_KEY);
          if(job&&action==='revoke')kv.put({...job,status:'discarded',stage:'user_revoked_summary',updatedAt:new Date().toISOString(),revision:(Number(job.revision)||0)+1},jobKey(sessionId,'rolling'));
          result={sessionId,action,archiveCount:patch.rollingArchive.length};
        };
      };
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(problem||tx.error||new Error('E_MEMORY_ROLLING_ABORTED'));};
    });
  }
  async function dismissMemoryJob(sessionId,kind,expectedId){
    if(!['core','facts','rolling'].includes(kind))throw new Error('E_MEMORY_JOB_KIND');
    return memoryJobTransaction(sessionId,kind,(old,kv)=>{
      if(!old||old.id!==expectedId)throw new Error('E_MEMORY_JOB_FENCED');
      if(old.status==='committed'||old.status==='skipped'||old.status==='rejected'||old.status==='discarded')throw new Error('E_MEMORY_JOB_ALREADY_SETTLED');
      if(old.status==='running'&&Number(old.leaseUntilEpoch||0)>Date.now())throw new Error('E_MEMORY_JOB_PENDING');
      const next={...old,status:'discarded',stage:'user_discarded_candidate',updatedAt:new Date().toISOString(),revision:(Number(old.revision)||0)+1};
      kv.put(next,jobKey(sessionId,kind));return next;
    });
  }
  // Durable AI merge stages and one review draft per Session. These records
  // never modify canonical facts before the owner confirms in a CAS transaction.
  const mergeStageKey=(sessionId,digest)=>`memory_merge_stage_v2:${sessionId}:${digest}`;
  const mergeDraftKey=sessionId=>`memory_merge_draft_v1:${sessionId}`;
  async function getMergeStage(sessionId,digest){const record=await get(mergeStageKey(sessionId,digest));
    if(record&&(record.status!=='STAGED'||record.sessionId!==sessionId||record.contractDigest!==digest||typeof record.outputText!=='string'))throw new Error('E_MEMORY_MERGE_STAGE_INVALID');
    return record||null;
  }
  async function putMergeStage(sessionId,digest,content,outputDigest){
    if(!content?.trim()||!outputDigest)throw new Error('E_MEMORY_MERGE_STAGE_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),req=kv.get(mergeStageKey(sessionId,digest));let error,result;
      req.onerror=()=>{error=req.error;tx.abort();};req.onsuccess=()=>{
        const old=req.result;if(old){if(old.status!=='STAGED'||old.outputDigest!==outputDigest){error=new Error('E_MEMORY_MERGE_STAGE_CONFLICT');tx.abort();return;}result=old;return;}
        result={version:2,status:'STAGED',sessionId,contractDigest:digest,outputText:content,outputLength:content.length,outputDigest,createdAt:new Date().toISOString()};kv.put(result,mergeStageKey(sessionId,digest));
      };tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(error||tx.error||new Error('E_MEMORY_MERGE_STAGE_WRITE'));};});
  }
  async function getMergeDraft(sessionId){return await get(mergeDraftKey(sessionId))||null;}
  async function createMergeDraft(sessionId,draft){
    const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let result,error;
      const fail=msg=>{error=new Error(msg);tx.abort();};
      const oldReq=kv.get(mergeDraftKey(sessionId));oldReq.onerror=()=>fail('E_MEMORY_MERGE_DRAFT_READ');oldReq.onsuccess=()=>{
        const old=oldReq.result;
        if(old&&!['DISCARDED','COMMITTED'].includes(old.status)){fail('E_MEMORY_MERGE_DRAFT_EXISTS');return;}
        const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{
          const state=sr.result,impl=window.MimaStandalone,contract=window.MimaMemoryContracts;
          if(!isCanonicalStateRecord(state)||!impl?.memoryFactSignature||!contract?.normalizeManualMemory){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const session=state.sessions.find(x=>x.id===sessionId);
          if(!session){fail('E_STORY_SESSION_MISSING');return;}
          if(!draft.referenceContract||memoryReferenceContract(state,sessionId,draft.referenceSelection)!==draft.referenceContract){fail('E_MEMORY_MERGE_REFERENCE_CHANGED');return;}
          if(impl.memoryFactSignature(contract.normalizeManualMemory(session.manualMemory).facts)!==draft.sourceSignature||
            session.messages.length<draft.sourceHistoryCount||
            impl.memorySourceFingerprint(session.messages,draft.sourceHistoryCount)!==draft.sourceHistoryFingerprint){fail('E_MEMORY_MERGE_SOURCE_CHANGED');return;}
          const stamp=new Date().toISOString();result={...draft,draftId:`merge_${Date.now()}_${Math.random().toString(36).slice(2)}`,sessionId,version:1,status:'DRAFT_PERSISTED',createdAt:stamp,updatedAt:stamp};kv.put(result,mergeDraftKey(sessionId));
        };};tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(error||tx.error||new Error('E_MEMORY_MERGE_DRAFT_WRITE'));};});
  }
  async function updateMergeDraft(sessionId,draftId,expectedVersion,content,action='edit'){
    const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),req=kv.get(mergeDraftKey(sessionId));let error,result;
      const fail=msg=>{error=new Error(msg);tx.abort();};req.onerror=()=>fail('E_MEMORY_MERGE_DRAFT_READ');req.onsuccess=()=>{
        const old=req.result;if(!old||old.draftId!==draftId||old.version!==expectedVersion||!['DRAFT_PERSISTED','USER_EDITED'].includes(old.status)){fail('E_MEMORY_MERGE_DRAFT_CONFLICT');return;}
        if(action==='edit'&&(typeof content!=='string'||content.length>250000)){fail('E_MEMORY_MERGE_INVALID');return;}
        result={...old,version:old.version+1,status:action==='discard'?'DISCARDED':'USER_EDITED',content:action==='discard'?old.content:String(content),updatedAt:new Date().toISOString()};kv.put(result,mergeDraftKey(sessionId));
      };tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(error||tx.error||new Error('E_MEMORY_MERGE_DRAFT_WRITE'));};});
  }
  // Individual verified fact ranges remain reviewable if a later range fails.
  // A staged candidate is NOT a canonical fact or a settled job.
  const factStageText=v=>String(v??'').replace(/\uFFFD+/g,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
  const factRangeKey=(jobId,stage)=>`memory_fact_range_v2:${jobId}:${stage}`;
  const factRangeReceiptKey=op=>`memory_fact_receipt_v1:${op}`;
  async function putFactRangeCandidate(job,stage,scope,fact,sourceSliceFingerprint,outputDigest){
    if(!fact?.content||!scope||!outputDigest||!sourceSliceFingerprint)throw new Error('E_MEMORY_FACT_RANGE_INVALID');
    return memoryJobTransaction(job.sessionId,job.kind,(old,kv,tx)=>{
      if(job.kind!=='facts'||old?.id!==job.id||old?.attemptId!==job.attemptId||old.status!=='running')throw new Error('E_MEMORY_JOB_FENCED');
      const stageDigest=job.factRangeStageDigests?.[stage];
      if(!old.referenceContract||!stageDigest||!job.referenceDigest)throw new Error('E_MEMORY_FACT_STAGE_CONTRACT_MISSING');
      const record={version:3,status:'STAGED',sessionId:job.sessionId,kind:'facts',stage,jobId:job.id,attemptId:job.attemptId,
        startRound:scope.startRound,endRound:scope.endRound,sourceStartIndex:scope.sourceStartIndex,sourceEndExclusive:scope.sourceEndExclusive,
        messageIds:scope.messageIds,loadedCharMaskId:job.loadedCharMaskId||'',sourceSliceFingerprint,outputDigest,fact,
        referenceContract:old.referenceContract,referenceDigest:job.referenceDigest,stageDigest,
        replaceExisting:job.options?.scope==='all'&&job.options?.replaceExisting===true,createdAt:new Date().toISOString()};
      const verified=kv.get(stageV2Key(stageDigest));
      verified.onerror=()=>tx.abort();
      verified.onsuccess=()=>{
        const stageRecord=verified.result;
        if(!stageRecord||stageRecord.status!=='STAGED'||stageRecord.kind!=='facts'||
           stageRecord.sessionId!==job.sessionId||stageRecord.contractDigest!==stageDigest||
           factStageText(stageRecord.outputText)!==fact.content||stageRecord.referenceDigest!==job.referenceDigest||
           window.MimaSHA256.digest(new TextEncoder().encode(stageRecord.outputText))!==stageRecord.outputDigest){tx.abort();return;}
        const request=kv.get(STATE_KEY);
        request.onerror=()=>tx.abort();
        request.onsuccess=()=>{
          try{if(memoryReferenceContract(request.result,job.sessionId,job.referenceSelection)!==record.referenceContract)tx.abort();
            else kv.put({...record,stageOutputDigest:stageRecord.outputDigest},factRangeKey(job.id,stage));}
          catch(e){tx.abort();}
        };
      };
      return record;
    });
  }
  async function listFactRangeCandidates(sessionId){
    const job=await getMemoryJob(sessionId,'facts');if(!job)return {job:null,ranges:[]};
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),kv=tx.objectStore(STORE),prefix=`memory_fact_range_v2:${job.id}:`,out=[];let problem;
      const req=kv.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
      req.onsuccess=()=>{const cursor=req.result;if(cursor){const r=cursor.value;if(r?.sessionId===sessionId&&r.jobId===job.id)out.push({...r,fact:{...r.fact,content:r.fact.content}});cursor.continue();}};
      req.onerror=()=>{problem=req.error;tx.abort();};
      tx.oncomplete=()=>{db.close();resolve({job:{id:job.id,status:job.status,stage:job.stage,leaseUntilEpoch:job.leaseUntilEpoch},ranges:out.sort((a,b)=>a.startRound-b.startRound)});};
      tx.onabort=()=>{db.close();reject(problem||tx.error||new Error('E_MEMORY_FACT_RANGE_READ'));};
    });
  }
  async function commitVerifiedFactRanges(sessionId,jobId,stageIds,operationId,expectedFactsSignature=null){
    if(!Array.isArray(stageIds)||!stageIds.length||stageIds.length>200||new Set(stageIds).size!==stageIds.length||!operationId||String(operationId).length>200)
      throw new Error('E_MEMORY_FACT_RANGE_SELECTION_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let result,problem;
      const fail=code=>{problem=new Error(code);tx.abort();};
      const receipt=kv.get(factRangeReceiptKey(operationId));receipt.onerror=()=>fail('E_MEMORY_FACT_RECEIPT_READ');receipt.onsuccess=()=>{
        if(receipt.result){if(receipt.result.sessionId!==sessionId||receipt.result.jobId!==jobId||JSON.stringify(receipt.result.stages.slice().sort())!==JSON.stringify(stageIds.slice().sort())){fail('E_MEMORY_FACT_OPERATION_COLLISION');return;}
          const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{if(!isCanonicalStateRecord(sr.result)){fail('E_MEMORY_STORE_UNVERIFIED');return;}result=sr.result;};return;}
        const jr=kv.get(jobKey(sessionId,'facts'));jr.onerror=()=>fail('E_MEMORY_JOURNAL_READ');jr.onsuccess=()=>{
          const job=jr.result;if(!job||job.id!==jobId||job.kind!=='facts'||(job.status==='running'&&Number(job.leaseUntilEpoch||0)>Date.now())||!['failed','interrupted','aborted','needs_review','partially_committed','running'].includes(job.status)){fail('E_MEMORY_FACT_JOB_UNAVAILABLE');return;}
          if(job.options?.scope==='all'&&job.options?.replaceExisting===true){fail('E_MEMORY_FACT_REPLACE_ATOMIC_REQUIRED');return;}
          const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{
            const canonical=sr.result,impl=window.MimaStandalone,contracts=window.MimaMemoryContracts;
            if(!isCanonicalStateRecord(canonical)||!impl?.memorySourceFingerprint||!contracts?.normalizeManualMemory||!window.MimaSHA256?.digest){fail('E_MEMORY_STORE_UNVERIFIED');return;}
            const index=canonical.sessions.findIndex(x=>x.id===sessionId);if(index<0){fail('E_STORY_SESSION_MISSING');return;}
            const live=canonical.sessions[index],memory=contracts.normalizeManualMemory(live.manualMemory||{}),selected=[];
            if(expectedFactsSignature!==null){
              if(!impl.memoryFactSignature||impl.memoryFactSignature(memory.facts)!==expectedFactsSignature){fail('E_MEMORY_FACT_TARGET_CHANGED');return;}
            }
            const collect=i=>{
              if(i===stageIds.length){
                const ranges=selected.slice().sort((a,b)=>a.startRound-b.startRound);
                if(ranges.some((r,j)=>j>0&&r.startRound<=ranges[j-1].endRound)){fail('E_MEMORY_FACT_RANGE_OVERLAP');return;}
                const existing=memory.facts;
                if(ranges.some(r=>existing.some(f=>f.startRound<=r.endRound&&r.startRound<=f.endRound))){fail('E_MEMORY_FACT_RANGE_ALREADY_COVERED');return;}
                const unique=new Set(existing.map(f=>f.id));if(ranges.some(r=>unique.has(r.fact.id))){fail('E_MEMORY_FACT_ID_CONFLICT');return;}
                const updated={...live,manualMemory:{...memory,facts:existing.concat(ranges.map(r=>r.fact)).sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound)},recordRevision:(Number(live.recordRevision)||0)+1,updatedAt:new Date().toISOString()};
                const sessions=canonical.sessions.slice();sessions[index]=updated;result={...canonical,sessions,storeRevision:(Number(canonical.storeRevision)||0)+1,savedAt:new Date().toISOString()};
                kv.put(result,STATE_KEY);
                kv.put({sessionId,jobId,operationId,stages:stageIds,rounds:ranges.map(r=>[r.startRound,r.endRound]),committedAt:new Date().toISOString()},factRangeReceiptKey(operationId));
                kv.put({...job,status:'partially_committed',stage:'partial_fact_ranges_committed',revision:(Number(job.revision)||0)+1,updatedAt:new Date().toISOString()},jobKey(sessionId,'facts'));
                return;
              }
              const req=kv.get(factRangeKey(jobId,stageIds[i]));req.onerror=()=>fail('E_MEMORY_FACT_RANGE_READ');req.onsuccess=()=>{
                const r=req.result;if(!r||r.sessionId!==sessionId||r.jobId!==jobId||(![job.attemptId,...(job.recoverableAttempts||[])].includes(r.attemptId))||r.status!=='STAGED'||r.replaceExisting||!r.fact?.content||!Number.isInteger(r.sourceStartIndex)||r.sourceStartIndex<0||!Number.isInteger(r.sourceEndExclusive)||r.sourceEndExclusive>live.messages.length||r.sourceStartIndex>=r.sourceEndExclusive||!r.sourceSliceFingerprint){fail('E_MEMORY_FACT_RANGE_INVALID');return;}
                if(r.version!==3||!r.stageDigest||!r.referenceDigest||!r.referenceContract||
                   r.referenceContract!==job.referenceContract){fail('E_MEMORY_FACT_CONTRACT_UNVERIFIED');return;}
                try{if(memoryReferenceContract(canonical,sessionId,job.referenceSelection)!==r.referenceContract){fail('E_MEMORY_FACT_REFERENCE_CHANGED');return;}}
                catch(e){fail('E_MEMORY_FACT_REFERENCE_CHANGED');return;}
                const slice=live.messages.slice(r.sourceStartIndex,r.sourceEndExclusive);
                if(impl.memorySourceFingerprint(slice,slice.length)!==r.sourceSliceFingerprint||r.loadedCharMaskId!==(live.loadedCharMaskId||'')){fail('E_MEMORY_FACT_RANGE_SOURCE_CHANGED');return;}
                if(window.MimaSHA256.digest(new TextEncoder().encode(r.fact.content))!==r.outputDigest){fail('E_MEMORY_FACT_RANGE_CHECKSUM');return;}
                const stageReq=kv.get(stageV2Key(r.stageDigest));stageReq.onerror=()=>fail('E_MEMORY_FACT_STAGE_READ');
                stageReq.onsuccess=()=>{const stage=stageReq.result;
                  if(!stage||stage.status!=='STAGED'||stage.contractDigest!==r.stageDigest||stage.kind!=='facts'||
                    stage.sessionId!==sessionId||stage.referenceDigest!==r.referenceDigest||
                    stage.outputDigest!==r.stageOutputDigest||factStageText(stage.outputText)!==r.fact.content||
                    window.MimaSHA256.digest(new TextEncoder().encode(stage.outputText))!==stage.outputDigest){fail('E_MEMORY_FACT_STAGE_CHANGED');return;}
                  selected.push(r);collect(i+1);
                };
              };
            };collect(0);
          };
        };
      };
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(problem||tx.error||new Error('E_MEMORY_FACT_PARTIAL_COMMIT_FAILED'));};
    });
  }
  // Two-phase manual fact consolidation: AI preview performs no writes.
  // Approval and one-step undo are canonical IDB transactions, never whole
  // stale-state saves. No History/Persona/core memory is replaced.
  const factMergeUndoKey=sessionId=>`memory_fact_merge_undo:${sessionId}`;
  async function commitFactMerge(sessionId,body){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let issue,result;
      const fail=m=>{issue=new Error(m);tx.abort();};
      const proceed=draft=>{const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_MERGE_STATE_READ');
      sr.onsuccess=()=>{
        const canonical=sr.result;
        if(!isCanonicalStateRecord(canonical)){fail('E_MEMORY_STORE_UNVERIFIED');return;}
        const idx=canonical.sessions.findIndex(x=>x?.id===sessionId);if(idx<0){fail('E_STORY_SESSION_MISSING');return;}
        const session=canonical.sessions[idx],contract=window.MimaMemoryContracts,impl=window.MimaStandalone;
        if(!contract?.normalizeManualMemory||!impl?.memoryFactSignature||!impl?.memorySourceFingerprint){fail('E_MEMORY_MERGE_CONTRACT_UNAVAILABLE');return;}
        // Never commit an AI-generated merge against changed reference material.
        // Older persisted drafts have no proof: require an explicit additional
        // owner approval rather than destroying those historical candidates.
        if(draft?.referenceContract){
          try{if(memoryReferenceContract(canonical,sessionId,draft.referenceSelection)!==draft.referenceContract){fail('E_MEMORY_MERGE_REFERENCE_CHANGED');return;}}
          catch(e){fail('E_MEMORY_MERGE_REFERENCE_CHANGED');return;}
        }else if(body?.legacyReferenceApproved!==true){fail('E_MEMORY_MERGE_LEGACY_REFERENCE_REVIEW');return;}
        const manual=contract.normalizeManualMemory(session.manualMemory||{}),facts=manual.facts;
        const selectedIds=Array.isArray(body?.selectedIds)?body.selectedIds:[],chosen=new Set(selectedIds);
        const content=String(body?.content??'').trim();
        if(chosen.size<2||chosen.size!==selectedIds.length||selectedIds.some(id=>typeof id!=='string')||
           !content||content.length>250000){fail('E_MEMORY_MERGE_INVALID');return;}
        if(impl.memoryFactSignature(facts)!==body.sourceSignature){fail('E_MEMORY_MERGE_SOURCE_CHANGED');return;}
        const count=Number(body.sourceHistoryCount);
        if(!Number.isInteger(count)||count<0||session.messages.length<count||
          impl.memorySourceFingerprint(session.messages,count)!==body.sourceHistoryFingerprint){fail('E_MEMORY_MERGE_HISTORY_CHANGED');return;}
        const selected=facts.filter(f=>chosen.has(f.id));
        if(selected.length!==chosen.size){fail('E_MEMORY_MERGE_SELECTION_CHANGED');return;}
        const startRound=Math.min(...selected.map(x=>x.startRound)),endRound=Math.max(...selected.map(x=>x.endRound));
        const stamp=new Date().toISOString(),id=`factmerge_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const merged={id,startRound,endRound,content,source:'manual_fact_merge',createdAt:stamp,updatedAt:stamp,
          targetChars:Math.min(4000,Math.max(80,Number(body.targetChars)||content.length)),temperature:Number(body.temperature)||.35,
          sourceCount:count,sourceFingerprint:body.sourceHistoryFingerprint,verification:{status:'model_generated',stage:'owner_approved_merge',citations:[]}};
        const nextFacts=contract.normalizeManualMemory({facts:facts.filter(f=>!chosen.has(f.id)).concat(merged)}).facts.sort((a,b)=>a.startRound-b.startRound||a.endRound-b.endRound);
        const next={...session,manualMemory:{...manual,facts:nextFacts},recordRevision:(Number(session.recordRevision)||0)+1,updatedAt:stamp};
        const sessions=canonical.sessions.slice();sessions[idx]=next;
        result={...canonical,sessions,storeRevision:(Number(canonical.storeRevision)||0)+1,savedAt:stamp};
        kv.put(result,STATE_KEY);
        kv.put({sessionId,mergedId:id,originalFacts:facts,afterSignature:impl.memoryFactSignature(nextFacts),
          selectedIds,createdAt:stamp},factMergeUndoKey(sessionId));
        if(draft)kv.put({...draft,status:'COMMITTED',version:draft.version+1,committedAt:stamp},mergeDraftKey(sessionId));
      };};
      if(body?.draftId){const dr=kv.get(mergeDraftKey(sessionId));dr.onerror=()=>fail('E_MEMORY_MERGE_DRAFT_READ');dr.onsuccess=()=>{
        const draft=dr.result;if(!draft||draft.draftId!==body.draftId||draft.version!==body.version||!['DRAFT_PERSISTED','USER_EDITED'].includes(draft.status)||draft.content!==body.content||draft.sourceSignature!==body.sourceSignature||JSON.stringify(draft.selectedIds)!==JSON.stringify(body.selectedIds)){fail('E_MEMORY_MERGE_DRAFT_CONFLICT');return;}proceed(draft);
      };}else proceed(null);
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_MERGE_ABORTED'));};
    });
  }
  async function undoFactMerge(sessionId){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let issue,result;
      const fail=m=>{issue=new Error(m);tx.abort();};
      const undoReq=kv.get(factMergeUndoKey(sessionId));undoReq.onerror=()=>fail('E_MEMORY_MERGE_UNDO_READ');
      undoReq.onsuccess=()=>{
        const undo=undoReq.result;if(!undo){fail('E_MEMORY_MERGE_UNDO_UNAVAILABLE');return;}
        const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_MERGE_STATE_READ');
        sr.onsuccess=()=>{
          const current=sr.result,impl=window.MimaStandalone,contract=window.MimaMemoryContracts;
          if(!isCanonicalStateRecord(current)||!impl?.memoryFactSignature||!contract?.normalizeManualMemory){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const idx=current.sessions.findIndex(s=>s?.id===sessionId);if(idx<0){fail('E_STORY_SESSION_MISSING');return;}
          const session=current.sessions[idx],manual=contract.normalizeManualMemory(session.manualMemory||{});
          if(impl.memoryFactSignature(manual.facts)!==undo.afterSignature){fail('E_MEMORY_MERGE_UNDO_CONFLICT');return;}
          const updated={...session,manualMemory:{...manual,facts:undo.originalFacts},recordRevision:(Number(session.recordRevision)||0)+1,updatedAt:new Date().toISOString()};
          const sessions=current.sessions.slice();sessions[idx]=updated;
          result={...current,sessions,storeRevision:(Number(current.storeRevision)||0)+1,savedAt:new Date().toISOString()};
          kv.put(result,STATE_KEY);kv.delete(factMergeUndoKey(sessionId));
        };
      };
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_MERGE_UNDO_ABORTED'));};
    });
  }
  // R19 crash recovery diagnostics: separate keys under the existing DB/kv schema.
  // No generation sidecar is authoritative over canonical Session + CAS revision.
  const generationKey=(id)=>'r19-generation:'+String(id.sessionId)+':'+String(id.generationId)+':'+String(id.attempt);
  function verifiedGenerationId(id){
    if(!id||!id.sessionId||!id.generationId||!Number.isSafeInteger(Number(id.attempt))||Number(id.attempt)<1)
      throw new Error('E_GENERATION_IDENTITY_INVALID');
    return {sessionId:String(id.sessionId),generationId:String(id.generationId),attempt:Number(id.attempt)};
  }
  async function generationReceipt(id,stage,extra={}){
    const identity=verifiedGenerationId(id),key=generationKey(identity),db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let outcome,issue=null;
      const request=store.get(key);
      request.onsuccess=()=>{
        const old=request.result;
        if(old!==undefined&&(!old||old.generationId!==identity.generationId||old.attempt!==identity.attempt||old.sessionId!==identity.sessionId)){
          issue=new Error('E_GENERATION_RECEIPT_CORRUPT');tx.abort();return;
        }
        outcome={...identity,stage:String(stage),ownerId:String(extra.ownerId||old?.ownerId||''),
          startedAt:old?.startedAt||Date.now(),lastSeenAt:Date.now(),
          fragmentCount:old?.fragmentCount||0,persistedChars:old?.persistedChars||0,
          ...Object.fromEntries(Object.entries(extra).filter(([k])=>['sourceFingerprint','recordRevision','ownerId','finishKind','errorCode','requestDispatchAttempted'].includes(k)))};
        store.put(outcome,key);
      };
      request.onerror=()=>{issue=request.error;tx.abort()};
      tx.oncomplete=()=>{db.close();resolve(outcome)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_GENERATION_RECEIPT_ABORT'))};
    });
  }
  async function generationAppendFragment(id,ordinal,offset,piece){
    const identity=verifiedGenerationId(id),key=generationKey(identity),db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let result,issue=null;
      const req=store.get(key);
      req.onsuccess=()=>{
        const old=req.result;
        if(!old||old.sessionId!==identity.sessionId||old.generationId!==identity.generationId||old.attempt!==identity.attempt){issue=new Error('E_GENERATION_RECEIPT_MISSING');tx.abort();return;}
        if(ordinal!==old.fragmentCount||offset!==old.persistedChars||typeof piece!=='string'||!piece.length){issue=new Error('E_GENERATION_FRAGMENT_ORDER');tx.abort();return;}
        result={...old,fragmentCount:ordinal+1,persistedChars:offset+piece.length,lastSeenAt:Date.now(),stage:'RESPONSE_IN_PROGRESS'};
        store.put({identity,ordinal,offset,piece},key+':fragment:'+ordinal);store.put(result,key);
      };
      req.onerror=()=>{issue=req.error;tx.abort()};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_GENERATION_FRAGMENT_ABORT'))};
    });
  }
  async function generationRead(id){
    const identity=verifiedGenerationId(id),key=generationKey(identity),receipt=await get(key);
    if(!receipt)return {receipt:null,text:'',complete:false};
    if(receipt.sessionId!==identity.sessionId||receipt.generationId!==identity.generationId||receipt.attempt!==identity.attempt)
      throw new Error('E_GENERATION_RECEIPT_CORRUPT');
    let text='';
    for(let i=0;i<receipt.fragmentCount;i++){
      const f=await get(key+':fragment:'+i);
      if(!f||f.ordinal!==i||f.offset!==text.length||f.identity?.generationId!==identity.generationId||f.identity?.attempt!==identity.attempt)
        throw new Error('E_GENERATION_FRAGMENT_INCOMPLETE');
      text+=f.piece;
    }
    if(text.length!==receipt.persistedChars)throw new Error('E_GENERATION_FRAGMENT_INCOMPLETE');
    return {receipt,text,complete:true};
  }
  window.MimaLocalStore={listPlayToolLocal,getPlayToolLocal:key=>get('play_tools_v1:'+key),putPlayToolLocal:(key,value)=>set('play_tools_v1:'+key,value),generationReceipt,generationAppendFragment,generationRead,getRollingPreflight,putRollingPreflight,clearRollingPreflight,commitHtmlRepair,putHtmlRepairCandidate,getHtmlRepairCandidate,setHtmlRepairCandidateState,listMemoryStages,inspectLegacyMemoryStages,putMemoryRejectedDraft,listMemoryRejectedDrafts,memoryReferenceContract,putFactRangeCandidate,listFactRangeCandidates,commitVerifiedFactRanges,getMergeStage,putMergeStage,getMergeDraft,createMergeDraft,updateMergeDraft,commitFactMerge,undoFactMerge,updateRollingMemory,dismissMemoryJob,loadState,saveState,commitState,validateLibrary,exportAll,importAll,saveSettingsSnapshot,loadSettingsSnapshot,clearSettingsSnapshot,getMemoryJob,getMemoryStage,putMemoryStage,beginMemoryJob,checkpointMemoryJob,settleMemoryJob,interruptMemoryJob,commitMemoryJob,heartbeatMemoryJob,reviewMemoryCandidate};
})();
