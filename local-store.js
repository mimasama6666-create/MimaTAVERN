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
      ['cssPresets', 'regexPacks', 'novelProjects'].every(key =>
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
        !['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects']
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
    const blank = {schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{...EMPTY_THEME}};
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
    const modern={...snapshot,backupContractRevision:1};
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
    if(contractRevision===1){
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
    if(contractRevision!==undefined && (version!==4||contractRevision!==1))invalid('backupContractRevision','不受支持的完整备份契约版本');
    const required=version===4?['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects']:['sessions','masks','presets','worldbooks'];
    for (const key of required) if (!Array.isArray(src[key])) invalid(key,'缺失必需数组字段，拒绝覆盖');
    if(version===4)mustRecord(src.themeSettings,'themeSettings',true);
    for (const key of ['sessions','masks','presets','worldbooks','cssPresets','regexPacks','novelProjects']) mustArray(src[key], key, required.includes(key));
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
  async function getMemoryJob(sessionId,kind){return get(jobKey(sessionId,kind));}
  async function memoryJobTransaction(sessionId,kind,work){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let result,issue;
      const req=kv.get(jobKey(sessionId,kind));req.onerror=()=>{issue=req.error;tx.abort();};
      req.onsuccess=()=>{try{result=work(req.result,kv,tx);}catch(e){issue=e;tx.abort();}};
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_MEMORY_JOURNAL_WRITE_FAILED'));};
    });
  }
  async function beginMemoryJob({sessionId,kind,options,sourceHash,sourceCount,sourceFingerprint,targetBaseline,configSignature}){
    return memoryJobTransaction(sessionId,kind,(old,kv)=>{
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
      const job={resumeCandidates,humanApprovedStages,configSignature,sourceFingerprint,targetBaseline,
        id:recovering?old.id:`mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        attemptId:`a_${Date.now()}_${Math.random().toString(36).slice(2)}`,sessionId,kind,options,sourceHash,sourceCount,
        status:'running',stage:recovering?'recovered_pending':'prepared',startedAt:recovering?old.startedAt:now,updatedAt:now,
        checkpoints:sameSource&&['running','failed','interrupted','aborted'].includes(old?.status)?(old.checkpoints||[]):[],revision:(old?.revision||0)+1,
        leaseUntilEpoch:Date.now()+MEMORY_LEASE_MS,recoveryCount:recovering?(Number(old.recoveryCount||0)+1):0,
        recoveredFromAttemptId:recovering?old.attemptId:null};
      kv.put(job,jobKey(sessionId,kind));return job;
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
      const next={...old,stage,updatedAt:new Date().toISOString(),leaseUntilEpoch:Date.now()+MEMORY_LEASE_MS,revision:old.revision+1,checkpoints:[...(old.checkpoints||[]),{stage,time:new Date().toISOString(),...extra}].slice(-300)};
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
          kv.put({...active,status:'committed',stage:'saved',revision:active.revision+1,updatedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},jobKey(job.sessionId,job.kind));
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
  // Two-phase manual fact consolidation: AI preview performs no writes.
  // Approval and one-step undo are canonical IDB transactions, never whole
  // stale-state saves. No History/Persona/core memory is replaced.
  const factMergeUndoKey=sessionId=>`memory_fact_merge_undo:${sessionId}`;
  async function commitFactMerge(sessionId,body){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let issue,result;
      const fail=m=>{issue=new Error(m);tx.abort();};
      const sr=kv.get(STATE_KEY);sr.onerror=()=>fail('E_MEMORY_MERGE_STATE_READ');
      sr.onsuccess=()=>{
        const canonical=sr.result;
        if(!isCanonicalStateRecord(canonical)){fail('E_MEMORY_STORE_UNVERIFIED');return;}
        const idx=canonical.sessions.findIndex(x=>x?.id===sessionId);if(idx<0){fail('E_STORY_SESSION_MISSING');return;}
        const session=canonical.sessions[idx],contract=window.MimaMemoryContracts,impl=window.MimaStandalone;
        if(!contract?.normalizeManualMemory||!impl?.memoryFactSignature||!impl?.memorySourceFingerprint){fail('E_MEMORY_MERGE_CONTRACT_UNAVAILABLE');return;}
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
      };
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
  window.MimaLocalStore={commitFactMerge,undoFactMerge,updateRollingMemory,dismissMemoryJob,loadState,saveState,commitState,validateLibrary,exportAll,importAll,saveSettingsSnapshot,loadSettingsSnapshot,clearSettingsSnapshot,getMemoryJob,beginMemoryJob,checkpointMemoryJob,settleMemoryJob,interruptMemoryJob,commitMemoryJob,heartbeatMemoryJob,reviewMemoryCandidate};
})();
