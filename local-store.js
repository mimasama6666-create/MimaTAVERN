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
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function set(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  // Serialize compare-and-swap inside a single IndexedDB readwrite transaction.
  // Never treat a failed read as an empty library, and never silently overwrite a newer tab.
  async function commitState(candidate, expectedRevision) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const objectStore = tx.objectStore(STORE);
      let result, problem = null;
      const req = objectStore.get(STATE_KEY);
      req.onerror = () => { problem = req.error || new Error('资料库读取失败'); tx.abort(); };
      req.onsuccess = () => {
        const current = req.result;
        if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
          problem = new Error('资料库内容损坏，拒绝写入'); tx.abort(); return;
        }
        const revision = Number(current?.storeRevision) || 0;
        if (revision !== expectedRevision) {
          problem = new Error('E_CANONICAL_CONFLICT: 其他窗口或任务已更新资料库，请刷新后重试，本次未覆盖新数据');
          tx.abort(); return;
        }
        result = { ...candidate, storeRevision: revision + 1, schemaVersion: 4, savedAt: new Date().toISOString() };
        objectStore.put(result, STATE_KEY);
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(problem || tx.error || new Error('资料库事务中止')); };
      tx.onerror = () => { /* onabort retains the root cause */ };
    });
  }
  async function loadState() {
    const existing = await get(STATE_KEY);
    if (existing && typeof existing === 'object') return existing;
    const blank = {schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{...EMPTY_THEME}};
    return blank; // uninitialized is distinct from a failed read; first write uses CAS
  }
  async function saveState(state, expectedRevision) {
    return commitState({
      ...state,
      schemaVersion:4,
      cssPresets:Array.isArray(state.cssPresets)?state.cssPresets:[],
      regexPacks:Array.isArray(state.regexPacks)?state.regexPacks:[],
      novelProjects:Array.isArray(state.novelProjects)?state.novelProjects:[],
      themeSettings:state.themeSettings&&typeof state.themeSettings==='object'?state.themeSettings:{...EMPTY_THEME},
      savedAt:new Date().toISOString()
    }, expectedRevision === undefined ? Number(state.storeRevision) || 0 : expectedRevision);
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
  window.MimaLocalStore={loadState,saveState,commitState,validateLibrary,exportAll,importAll,saveSettingsSnapshot,loadSettingsSnapshot,clearSettingsSnapshot};
})();
