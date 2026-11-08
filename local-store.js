/**
 * 🍷 咪嘛馆 Standalone 本地数据库
 * 所有剧情/角色卡/世界书/预设/小说项目仅保存在当前浏览器 IndexedDB。
 */
(() => {
  const DB_NAME = 'mimamao_tavern_standalone';
  // V6 fences older bundles so they cannot write obsolete whole-library state
  // over independent Session records and appearance/preset overlays.
  const DB_VERSION = 7;
  const STORE = 'kv';
  const STATE_KEY = 'state';
  const SESSION_HEAD_KEY = 'session_partition_head_v1';
  const SESSION_PREFIX = 'session_record_v1:';
  const LEGACY_STATE_KEY = 'state_pre_session_partition_v1';
  const APPEARANCE_KEY = 'appearance_v1';
  const APPEARANCE_META_KEY = 'appearance_revision_head_v1';
  const PRESETS_KEY = 'presets_overlay_head_v1';
  const PRESET_RECORD_PREFIX = 'presets_overlay_record_v1:';
  const PRESET_BASE_INDEX_KEY = 'presets_cas_baseline_v1';
  const TEMPLATE_OVERLAY_KEY = 'setting_templates_overlay_v1';
  const TEMPLATE_META_KEY = 'setting_templates_revision_head_v1';
  const BASE_REVISION_KEY = 'canonical_base_revision_v1';
  const ORG_KEY='session_organization_v1';
  const SESSION_IDS_KEY='session_organization_session_ids_v1';
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
  function blankState() {
    return {schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],cssCategoriesV1:[],resourceCategoriesV1:{presets:[],worldbook:[]},regexPacks:[],theaterCards:[],quickCommands:[],settingTemplates:[],novelProjects:[],themeSettings:{...EMPTY_THEME}};
  }
  // Small, independent directory. No History, Memory or CSS bytes in its CAS.
  const blankSessionOrganization=()=>({version:1,revision:0,groups:[],placements:{},updatedAt:''});
  function validateSessionOrganization(value,knownIds=null){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||
      !Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.groups)||
      !value.placements||typeof value.placements!=='object'||Array.isArray(value.placements)||
      typeof value.updatedAt!=='string')throw Error('E_SESSION_ORGANIZATION_CORRUPT: 归档目录结构无法核实');
    const ids=new Set(),names=new Set(),orders=new Set();
    for(const g of value.groups){
      if(!g||typeof g!=='object'||!/^sg_[a-zA-Z0-9_-]{3,80}$/.test(g.id||'')||
        typeof g.name!=='string'||!g.name.trim()||g.name!==g.name.trim()||g.name.length>60||
        !Number.isSafeInteger(g.order)||g.order<0||typeof g.createdAt!=='string'||typeof g.updatedAt!=='string'||
        ids.has(g.id)||names.has(g.name.toLocaleLowerCase())||orders.has(g.order))
        throw Error('E_SESSION_ORGANIZATION_CORRUPT: 归档分类无效或重名');
      ids.add(g.id);names.add(g.name.toLocaleLowerCase());orders.add(g.order);
    }
    for(const [id,place] of Object.entries(value.placements)){
      if(!id||id.length>256||knownIds&& !knownIds.has(id)||!place||typeof place!=='object'||
        place.archived!==true||typeof place.archivedAt!=='string'||
        !(place.groupId===null||typeof place.groupId==='string'&&ids.has(place.groupId)))
        throw Error('E_SESSION_ORGANIZATION_CORRUPT: 归档会话引用无效');
    }
    return value;
  }
  function verifiedOrganization(value){return validateSessionOrganization(value===undefined?blankSessionOrganization():value);}
  async function loadSessionOrganization(){return verifiedOrganization(await get(ORG_KEY));}
  // All changes and the small session-id index are inspected in ONE IDB tx.
  async function commitSessionOrganization(action,expectedRevision){
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!action||typeof action!=='object')throw Error('E_ORGANIZATION_INVALID_ACTION');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),r=kv.get(ORG_KEY),i=kv.get(SESSION_IDS_KEY);
      let issue,result,ready=0;
      const fail=e=>{issue=e;try{tx.abort();}catch{}};
      const work=()=>{if(++ready!==2)return;try{
        const existing=verifiedOrganization(r.result);
        if(existing.revision!==expectedRevision)throw Error('E_SESSION_ORGANIZATION_CONFLICT: 归档目录已在别处修改，请刷新后重试');
        if(!Array.isArray(i.result)||i.result.some(x=>typeof x!=='string'))throw Error('E_SESSION_INDEX_UNAVAILABLE: 会话索引不可验证，归档未修改');
        const known=new Set(i.result);
        validateSessionOrganization(existing,known);
        const next={...existing,groups:existing.groups.map(x=>({...x})),placements:{...existing.placements}};
        const stamp=new Date().toISOString(),id=action.id;
        const group=()=>next.groups.find(g=>g.id===id);
        const name=()=>{const value=action.name;if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>60)throw Error('分类名称需要 1–60 字且不可首尾留空');
          if(next.groups.some(g=>g.id!==id&&g.name.toLocaleLowerCase()===value.toLocaleLowerCase()))throw Error('已有同名分类');return value;};
        switch(action.type){
          case 'create-group':{
            if(typeof id!=='string'||!/^sg_[a-zA-Z0-9_-]{3,80}$/.test(id)||group())throw Error('E_ORGANIZATION_GROUP_ID');
            const value=name();next.groups.push({id,name:value,order:next.groups.reduce((n,g)=>Math.max(n,g.order),-1)+1,createdAt:stamp,updatedAt:stamp});break;}
          case 'rename-group':{const g=group();if(!g)throw Error('分类不存在');g.name=name();g.updatedAt=stamp;break;}
          case 'delete-group':{if(!group())throw Error('分类不存在');next.groups=next.groups.filter(g=>g.id!==id);
            for(const [sid,place] of Object.entries(next.placements))if(place.groupId===id)next.placements[sid]={...place,groupId:null};break;}
          case 'place-session':
          case 'place-sessions':{
            const ids=action.type==='place-session'?[id]:action.ids;
            if(!Array.isArray(ids)||ids.length<1||ids.length>10000||ids.some(sid=>typeof sid!=='string'||!known.has(sid))||new Set(ids).size!==ids.length)
              throw Error('E_ORGANIZATION_SESSION_IDS: 剧情不存在、重复选择或已经删除');
            if(action.archived!==true&&action.archived!==false)throw Error('E_ORGANIZATION_ARCHIVED_INVALID');
            const gid=action.archived?(action.groupId??null):null;
            if(gid!==null&&!next.groups.some(g=>g.id===gid))throw Error('目标分类不存在或已更改');
            // All selected placements are validated before this one revision
            // commits. No partial batch, no History/Memory reserialization.
            for(const sid of ids){
              if(action.archived)next.placements[sid]={archived:true,groupId:gid,archivedAt:next.placements[sid]?.archivedAt||stamp};
              else delete next.placements[sid];
            }
            break;}
          default:throw Error('E_ORGANIZATION_ACTION_UNKNOWN');
        }
        next.revision++;next.updatedAt=stamp;validateSessionOrganization(next,known);
        kv.put(next,ORG_KEY);result=next;
      }catch(e){fail(e)}};
      r.onsuccess=work;i.onsuccess=work;r.onerror=()=>fail(r.error);i.onerror=()=>fail(i.error);
      tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_ORGANIZATION_TX_ABORT'))};
    });
  }
  function appearanceFromState(value) {
    return {version:1,baseRevision:Number(value?.storeRevision)||0,storeRevision:Number(value?.storeRevision)||0,
      cssPresets:value?.cssPresets||[],cssCategoriesV1:value?.cssCategoriesV1||[],themeSettings:value?.themeSettings||{...EMPTY_THEME},deletedCssIds:[],deletedCssAt:{},savedAt:value?.savedAt||''};
  }
  function assertAppearance(value) {
    if(!value||value.version!==1||!Number.isInteger(value.storeRevision)||value.storeRevision<0||
      !Number.isInteger(value.baseRevision)||value.baseRevision<0||value.baseRevision>value.storeRevision||
      !Array.isArray(value.cssPresets)||!value.themeSettings||typeof value.themeSettings!=='object'||Array.isArray(value.themeSettings)||
      !Array.isArray(value.deletedCssIds)||value.deletedCssIds.some(id=>typeof id!=='string')||
      (value.cssCategoriesV1!==undefined&&!Array.isArray(value.cssCategoriesV1)))
      throw Error('E_APPEARANCE_UNVERIFIED: 外观记录无法核实，拒绝覆盖');
    return value;
  }
  // Apply deletion metadata without inspecting or cloning any message/chapter.
  // Tombstones remain until a complete canonical write folds them into state.
  function mergeAppearance(base,appearance) {
    assertAppearance(appearance);
    const next={...base,cssPresets:appearance.cssPresets,cssCategoriesV1:appearance.cssCategoriesV1??base.cssCategoriesV1??[],themeSettings:appearance.themeSettings,storeRevision:base.storeRevision,savedAt:appearance.savedAt};
    if(!appearance.deletedCssIds.length)return next;
    const deleted=new Set(appearance.deletedCssIds);
    next.sessions=(base.sessions||[]).map(s=>deleted.has(s.customCssId)?{...s,customCssId:null,customCssEnabled:false,recordRevision:(Number(s.recordRevision)||0)+1}:s);
    next.novelProjects=(base.novelProjects||[]).map(p=>deleted.has(p.appearance?.customCssId)?{...p,appearance:{...p.appearance,customCssId:null,customCssEnabled:false},recordRevision:(Number(p.recordRevision)||0)+1}:p);
    next.settingTemplates=(base.settingTemplates||[]).map(t=>deleted.has(t.config?.customCssId)?{...t,config:{...t.config,customCssId:null,customCssEnabled:false},revision:(Number(t.revision)||0)+1,updatedAt:appearance.deletedCssAt?.[t.config.customCssId]||appearance.savedAt}:t);
    return next;
  }
  // Tiny durable sidecar for Session CAS: never deserialize CSS images or
  // CSS strings merely to edit one message. Maintained atomically with overlay.
  function appearanceMeta(value){
    return {version:1,baseRevision:value.baseRevision,storeRevision:value.storeRevision,
      deletedCssIds:[...value.deletedCssIds]};
  }
  function assertAppearanceMeta(value,baseRev=null){
    if(!value||value.version!==1||!Number.isSafeInteger(value.baseRevision)||
      !Number.isSafeInteger(value.storeRevision)||value.baseRevision<0||
      value.storeRevision<value.baseRevision||!Array.isArray(value.deletedCssIds)||
      value.deletedCssIds.some(x=>typeof x!=='string')||
      (baseRev!==null&&value.baseRevision!==baseRev))
      throw Error('E_APPEARANCE_HEAD_UNVERIFIED');
    return value;
  }
  function verifiedTemplateMeta(value,baseRev){
    if(!value||value.version!==1||value.baseRevision!==baseRev||
      !Number.isSafeInteger(value.storeRevision)||value.storeRevision<baseRev)
      throw Error('E_SETTING_TEMPLATE_HEAD_UNVERIFIED');
    return value;
  }
  function globalRevisionLight(baseRev,meta,presets,templates,head){
    const app=assertAppearanceMeta(meta,baseRev),t=verifiedTemplateMeta(templates,baseRev),p=assertPresetsOverlay(presets);
    if(p.baseRevision!==baseRev)throw Error('E_PRESET_BASE_CONFLICT');
    return baseRev+(app.storeRevision-baseRev)+(p.storeRevision-baseRev)+
      (t?t.storeRevision-baseRev:0)+verifiedSessionHead(head,baseRev).storeRevision-baseRev;
  }
  function presetsFromState(value){
    const revision=Math.max(0,Number(value?.storeRevision)||0);
    return {version:1,baseRevision:revision,storeRevision:revision,changes:[],savedAt:value?.savedAt||''};
  }
  function assertPresetsOverlay(value){
    if(!value||value.version!==1||
       !Number.isInteger(value.baseRevision)||value.baseRevision<0||
       !Number.isInteger(value.storeRevision)||value.storeRevision<value.baseRevision||
       !Array.isArray(value.changes)||value.changes.some(id=>typeof id!=='string'||!id)||
       new Set(value.changes).size!==value.changes.length||
       value.changes.length>value.storeRevision-value.baseRevision)
      throw Error('E_PRESETS_OVERLAY_UNVERIFIED: 预设存储无法核实，拒绝覆盖');
    return value;
  }
  // Stable, compact target-record CAS. The full preset text stays in its own
  // original base or overlay record; the baseline index never duplicates it.
  function presetCasToken(row){
    if(!row)return null;
    const serialized=JSON.stringify([row.id,row.updatedAt||row.createdAt||'',row.name||'未命名预设',row.content||'',
      row.category||'未分类',row.enabled!==false,row.type||'style',row.description||'',
      !!row.favorite,Number.isFinite(Number(row.priority))?Number(row.priority):50]);
    let h1=0x811c9dc5,h2=0x9e3779b9;
    for(let i=0;i<serialized.length;i++){
      const c=serialized.charCodeAt(i);h1=Math.imul(h1^c,0x01000193);
      h2=Math.imul(h2^c,0x5bd1e995);
    }
    return serialized.length+':'+(h1>>>0).toString(16)+':'+(h2>>>0).toString(16);
  }
  function presetBaseIndexFromState(state){
    return {version:1,baseRevision:Number(state?.storeRevision)||0,
      entries:Object.fromEntries((state?.presets||[]).map(row=>[row.id,presetCasToken(row)]))};
  }
  function verifiedPresetBaseIndex(value,baseRevision){
    if(!value||value.version!==1||value.baseRevision!==baseRevision||
       !value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))
      throw Error('E_PRESET_BASE_INDEX_UNVERIFIED');
    return value;
  }
  function resourceSignature(baseRev,appearanceRev,presetRev,templateRev){
    return [baseRev,appearanceRev,presetRev,templateRev].join(':');
  }
  // Base snapshot owns every unmodified preset. Each modified preset has ONE
  // durable, ID-keyed record. No preset save rewrites a different preset.
  function mergePresets(base,appearance,head,changed){
    assertPresetsOverlay(head);
    const baseRev=Number(base?.storeRevision)||0;
    if(head.baseRevision!==baseRev||appearance.baseRevision!==baseRev)
      throw Error('E_PRESETS_BASE_CONFLICT: 预设基线版本不一致');
    const result=mergeAppearance(base,appearance);
    const pending=new Map(changed);
    const merged=[];
    for(const row of base.presets||[]){
      if(!pending.has(row.id)){merged.push(row);continue;}
      const patch=pending.get(row.id);pending.delete(row.id);
      if(patch!==null)merged.push(patch);
    }
    // New records preserve first-edit order, not an arbitrary object hash order.
    for(const id of head.changes)if(pending.has(id)){
      const patch=pending.get(id);if(patch!==null)merged.push(patch);
    }
    result.presets=merged;
    result.storeRevision=baseRev+(appearance.storeRevision-baseRev)+(head.storeRevision-baseRev);
    return result;
  }
  // ONE preset ID + small CAS head in the same transaction. The global
  // revision checks protect concurrent edits and ensure old view cannot win.
  async function commitPreset(id,record,expectedRevision,expectedToken){
    if(typeof id!=='string'||!id||!record||record.id!==id||typeof record.content!=='string'||
       !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
       !(expectedToken===null||typeof expectedToken==='string'))
      throw Error('E_PRESET_EDIT_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      const a=kv.get(PRESETS_KEY),b=kv.get(BASE_REVISION_KEY),c=kv.get(APPEARANCE_META_KEY),
        t=kv.get(TEMPLATE_META_KEY),h=kv.get(SESSION_HEAD_KEY),
        i=kv.get(PRESET_BASE_INDEX_KEY),r=kv.get(PRESET_RECORD_PREFIX+id);
      let issue,result,ready=0;
      const fail=e=>{issue=e;try{tx.abort();}catch{}};
      const settle=()=>{if(++ready!==7)return;try{
        const head=assertPresetsOverlay(a.result),base=b.result,appearance=assertAppearanceMeta(c.result);
        if(!base||!Number.isInteger(base.revision)||base.revision!==head.baseRevision||appearance.baseRevision!==base.revision)
          throw Error('E_PRESETS_BASE_CONFLICT: 资料库基线已经改变，本次未覆盖');
        const index=verifiedPresetBaseIndex(i.result,base.revision);
        const target=head.changes.includes(id)?r.result:undefined;
        if(head.changes.includes(id)&&(!target||target.id!==id))
          throw Error('E_PRESET_FRAGMENT_INCOMPLETE');
        const actualToken=target?presetCasToken(target):
          Object.prototype.hasOwnProperty.call(index.entries,id)?index.entries[id]:null;
        if(actualToken!==expectedToken)
          throw Error('E_PRESET_RECORD_CONFLICT: 这条预设已在其他窗口更新，旧编辑未覆盖，请重新打开预设');
        const templateHead=verifiedTemplateMeta(t.result,base.revision);
        const globalRevision=globalRevisionLight(base.revision,appearance,head,templateHead,h.result);
        if(expectedRevision!==globalRevision)
          throw Error('E_CANONICAL_CONFLICT: 资料在其他窗口或任务已更新，旧编辑未覆盖');
        const next={...head,changes:head.changes.includes(id)?head.changes:[...head.changes,id],
          storeRevision:head.storeRevision+1,savedAt:new Date().toISOString()};
        assertPresetsOverlay(next);
        kv.put(record,PRESET_RECORD_PREFIX+id);kv.put(next,PRESETS_KEY);
        result={value:record,storeRevision:globalRevision+1};
      }catch(e){fail(e)}};
      for(const req of [a,b,c,t,h,i,r]){req.onsuccess=settle;req.onerror=()=>fail(req.error);}
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_PRESET_COMMIT_ABORTED'))};
    });
  }
  function verifiedTemplateOverlay(value,baseRevision){
    if(value===undefined)return null;
    if(!value||value.version!==1||value.baseRevision!==baseRevision||
       !Number.isSafeInteger(value.storeRevision)||value.storeRevision<baseRevision||
       !Array.isArray(value.templates))throw Error('E_SETTING_TEMPLATE_OVERLAY_CORRUPT: 模板增量记录无法核实');
    const ids=new Set();
    for(const t of value.templates){
      if(!t||typeof t!=='object'||typeof t.id!=='string'||!t.id||ids.has(t.id)||
         !Number.isSafeInteger(t.revision)||t.revision<0||typeof t.name!=='string'||
         !t.config||typeof t.config!=='object'||Array.isArray(t.config))
        throw Error('E_SETTING_TEMPLATE_OVERLAY_CORRUPT: 模板条目不完整');
      ids.add(t.id);
    }
    return value;
  }
  // A template save must never clone/rewrite a long History/Memory document.
  // Version and cross-tab CAS use the SAME global revision as canonical saves.
  async function commitSettingTemplates(edit,expectedRevision,initialTemplates){
    if(typeof edit!=='function'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
       !Array.isArray(initialTemplates))throw Error('E_SETTING_TEMPLATE_EDIT_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      const b=kv.get(BASE_REVISION_KEY),a=kv.get(APPEARANCE_META_KEY),p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_OVERLAY_KEY),h=kv.get(SESSION_HEAD_KEY);
      let ready=0,issue,result;
      const fail=e=>{issue=e;try{tx.abort()}catch{}};
      const commit=()=>{if(++ready!==5)return;try{
        const base=b.result,app=assertAppearanceMeta(a.result),presets=assertPresetsOverlay(p.result);
        if(!base||!Number.isSafeInteger(base.revision)||base.revision<0||
           app.baseRevision!==base.revision||presets.baseRevision!==base.revision)
          throw Error('E_SETTING_TEMPLATE_BASE_CONFLICT: 主库版本无法核实');
        const prior=verifiedTemplateOverlay(t.result,base.revision);
        const globalRevision=base.revision+(app.storeRevision-base.revision)+
          (presets.storeRevision-base.revision)+(prior?prior.storeRevision-base.revision:0)+(verifiedSessionHead(h.result,base.revision).storeRevision-base.revision);
        if(globalRevision!==expectedRevision)
          throw Error('E_CANONICAL_CONFLICT: 资料已在其它窗口或任务修改，请刷新后重试');
        // Initial templates come from the verified in-memory canonical snapshot,
        // fenced by the composite global revision above; no large base read.
        const records=(prior?prior.templates:initialTemplates).map(row=>({...row}));
        const value=edit(records);if(value&&typeof value.then==='function')throw Error('E_SETTING_TEMPLATE_ASYNC_EDIT');
        if(globalRevision>=Number.MAX_SAFE_INTEGER)throw Error('E_CANONICAL_REVISION_OVERFLOW');
        const next={version:1,baseRevision:base.revision,
          storeRevision:base.revision+(prior?prior.storeRevision-base.revision:0)+1,
          templates:records,savedAt:new Date().toISOString()};
        verifiedTemplateOverlay(next,base.revision);
        kv.put(next,TEMPLATE_OVERLAY_KEY);
        kv.put({version:1,baseRevision:base.revision,storeRevision:next.storeRevision},TEMPLATE_META_KEY);
        result={value,templates:records,storeRevision:globalRevision+1};
      }catch(e){fail(e)}};
      for(const req of [b,a,p,t,h]){req.onsuccess=commit;req.onerror=()=>fail(req.error)}
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_SETTING_TEMPLATE_TX_ABORT'))};
    });
  }
  // V6: canonical resources are a small base, whereas each History/Memory
  // Session is an independent key. Only explicit library snapshots enumerate all IDs.
  function sessionDirectoryRow(s){
    return {id:s.id,title:s.title,mode:s.mode,canonLevel:s.canonLevel,status:s.status,
      createdAt:s.createdAt,updatedAt:s.updatedAt,messageCount:Array.isArray(s.messages)?s.messages.length:0,
      recordRevision:Number(s.recordRevision)||0,customCssId:s.customCssId||null,customCssEnabled:s.customCssEnabled!==false,presetIds:s.presetIds||[],worldbookIds:s.worldbookIds||[],
      regexPackIds:s.regexPackIds||[],loadedUserMaskId:s.loadedUserMaskId||null,loadedCharMaskId:s.loadedCharMaskId||null};
  }
  function verifiedSessionHead(head,baseRev=null){
    if(!head||head.version!==1||!Number.isSafeInteger(head.baseRevision)||
       !Number.isSafeInteger(head.storeRevision)||head.baseRevision<0||head.storeRevision<head.baseRevision||
       !Array.isArray(head.ids)||!Array.isArray(head.directory)||head.ids.length!==head.directory.length||
       head.ids.some(id=>typeof id!=='string'||!id)||new Set(head.ids).size!==head.ids.length||
       head.directory.some((d,i)=>!d||d.id!==head.ids[i]||!Number.isSafeInteger(d.recordRevision)||d.recordRevision<0)||
       (baseRev!==null&&head.baseRevision!==baseRev))throw Error('E_SESSION_PARTITION_UNVERIFIED: 分区会话目录或版本异常，拒绝继续写入');
    return head;
  }
  function globalRevision(baseRev,app,presets,templates,head){
    const t=verifiedTemplateOverlay(templates,baseRev);
    return baseRev+(assertAppearance(app).storeRevision-baseRev)+
      (assertPresetsOverlay(presets).storeRevision-baseRev)+(t?t.storeRevision-baseRev:0)+
      (head?verifiedSessionHead(head,baseRev).storeRevision-baseRev:0);
  }
  function readCanonical(kv,sessionId=null){
    const result={},requests={},fragments=new Map(),sessions=new Map();
    let pending=0,failed=false,head=null,base=null;
    const fail=e=>{if(failed)return;failed=true;result.error=e;result.onerror?.({target:result});};
    const enqueue=(name,key,handler=null)=>{
      pending++;const r=kv.get(key);requests[name]=r;
      r.onsuccess=()=>{if(failed)return;try{handler?.(r.result);pending--;if(pending===0)finish();}catch(e){fail(e);}};
      r.onerror=()=>fail(r.error||Error('E_CANONICAL_FRAGMENT_READ'));return r;
    };
    function finish(){if(failed)return;try{
      base=requests.base.result;
      if(base!==undefined&&!isCanonicalStateRecord(base))throw Error('E_CANONICAL_STATE_UNVERIFIED');
      const app=assertAppearance(requests.appearance.result),presets=assertPresetsOverlay(requests.presets.result),
            templates=requests.templates.result,org=verifiedOrganization(requests.organization.result),baseRev=Number(base?.storeRevision)||0;
      if(app.baseRevision!==baseRev||presets.baseRevision!==baseRev)throw Error('E_CANONICAL_BASE_CONFLICT');
      const changed=new Map();for(const id of presets.changes){const value=fragments.get(id);
        if(!value||value.id!==id||typeof value.content!=='string')throw Error('E_PRESET_FRAGMENT_INCOMPLETE');changed.set(id,value);}
      const mergedBase=base||blankState();
      if(head){
        verifiedSessionHead(head,baseRev);
        if(Array.isArray(base?.sessions)&&base.sessions.length)throw Error('E_SESSION_PARTITION_BASE_NOT_EMPTY');
        const ids=sessionId===null?head.ids:(head.ids.includes(sessionId)?[sessionId]:[]);
        mergedBase.sessions=ids.map(id=>{
          const row=sessions.get(id),metadata=head.directory[head.ids.indexOf(id)];
          if(!row||row.id!==id||Number(row.recordRevision||0)!==metadata.recordRevision)
            throw Error('E_SESSION_PARTITION_RECORD_MISSING: '+id);
          return row;
        });
      }
      const merged=mergePresets(mergedBase,app,presets,changed);
      const overlay=verifiedTemplateOverlay(templates,baseRev);
      if(overlay){const removed=new Set(app.deletedCssIds||[]);
        merged.settingTemplates=overlay.templates.map(t=>removed.has(t.config?.customCssId)?
          {...t,config:{...t.config,customCssId:null,customCssEnabled:false}}:t);}
      merged.storeRevision=globalRevision(baseRev,app,presets,templates,head);
      merged.__resourceSignature=resourceSignature(baseRev,app.storeRevision,presets.storeRevision,overlay?.storeRevision??baseRev);
      merged.sessionOrganizationV1=org;result.result=merged;
      result.onsuccess?.({target:result});
    }catch(e){fail(e);}}
    // Queue every dynamic fragment before its parent's completion is counted.
    enqueue('base',STATE_KEY);
    enqueue('appearance',APPEARANCE_KEY);
    enqueue('organization',ORG_KEY);
    enqueue('templates',TEMPLATE_OVERLAY_KEY);
    enqueue('presets',PRESETS_KEY,value=>{for(const id of assertPresetsOverlay(value).changes)
      enqueue('preset:'+id,PRESET_RECORD_PREFIX+id,v=>fragments.set(id,v));});
    enqueue('partition',SESSION_HEAD_KEY,value=>{
      if(value===undefined)return;
      head=verifiedSessionHead(value);
      for(const id of (sessionId===null?head.ids:(head.ids.includes(sessionId)?[sessionId]:[])))
        enqueue('session:'+id,SESSION_PREFIX+id,v=>sessions.set(id,v));
    });
    return result;
  }
  function putCanonical(kv,value,prior=null){
    const oldHead=kv.get(PRESETS_KEY);
    oldHead.onsuccess=()=>{try{for(const id of assertPresetsOverlay(oldHead.result).changes)kv.delete(PRESET_RECORD_PREFIX+id);}
      catch(_){try{kv.transaction.abort();}catch{}}};
    oldHead.onerror=()=>{try{kv.transaction.abort();}catch{}};
    const {sessionOrganizationV1:_organization,__resourceSignature:_resourceSignature,
      __appearanceRevision:_appearanceRevision,...canonicalValue}=value;
    const ids=value.sessions.map(s=>s.id),revision=value.storeRevision;
    if(new Set(ids).size!==ids.length)throw Error('E_SESSION_DUPLICATE_IDS');
    if(prior)for(const s of prior.sessions||[])if(!ids.includes(s.id))kv.delete(SESSION_PREFIX+s.id);
    for(const session of value.sessions)kv.put(session,SESSION_PREFIX+session.id);
    kv.put({version:1,baseRevision:revision,storeRevision:revision,ids,
      directory:value.sessions.map(sessionDirectoryRow),updatedAt:new Date().toISOString()},SESSION_HEAD_KEY);
    kv.put({...canonicalValue,sessions:[]},STATE_KEY);
    kv.put(ids,SESSION_IDS_KEY);
    kv.put(appearanceFromState(value),APPEARANCE_KEY);
    kv.put(appearanceMeta(appearanceFromState(value)),APPEARANCE_META_KEY);
    kv.put(presetsFromState(value),PRESETS_KEY);
    kv.put(presetBaseIndexFromState(value),PRESET_BASE_INDEX_KEY);
    kv.put({revision},BASE_REVISION_KEY);
    kv.delete(TEMPLATE_OVERLAY_KEY);
    kv.put({version:1,baseRevision:revision,storeRevision:revision},TEMPLATE_META_KEY);
  }
  // One atomic promotion. If the transaction aborts, old canonical and all
  // overlays survive untouched; the next load retries. No half-adopted authority.
  let partitionPromise=null;
  function ensureSessionPartition(){
    if(partitionPromise)return partitionPromise;
    partitionPromise=(async()=>{
      const db=await openDb();return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),marker=kv.get(SESSION_HEAD_KEY);
        let issue,created=false;
        const fail=e=>{issue=e;try{tx.abort();}catch{}};
        marker.onerror=()=>fail(marker.error);
        marker.onsuccess=()=>{
          if(marker.result!==undefined){try{verifiedSessionHead(marker.result);return;}catch(e){fail(e);return;}}
          const old=readCanonical(kv);old.onerror=()=>fail(old.error);
          old.onsuccess=()=>{try{
            const canonical=old.result;
            if(!isCanonicalStateRecord(canonical))throw Error('E_CANONICAL_MIGRATION_SOURCE_CORRUPT');
            const ids=canonical.sessions.map(s=>s.id);
            if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)
              throw Error('E_SESSION_MIGRATION_DUPLICATE_ID');
            // Protected rollback snapshot contains the merged, actually visible
            // pre-migration data, not an outdated base missing CSS/preset overlays.
            kv.add(canonical,LEGACY_STATE_KEY);
            const revised={...canonical,storeRevision:(Number(canonical.storeRevision)||0)+1};
            putCanonical(kv,revised,canonical);created=true;
          }catch(e){fail(e);}};
        };
        tx.oncomplete=()=>{db.close();resolve(created);};
        tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_SESSION_PARTITION_MIGRATION_ABORT'))};
      });
    })().catch(e=>{partitionPromise=null;throw e;});
    return partitionPromise;
  }
  async function loadSessionRecord(id,{withRevision=false}={}){
    await ensureSessionPartition();if(typeof id!=='string'||!id)throw Error('E_SESSION_ID_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),kv=tx.objectStore(STORE),h=kv.get(SESSION_HEAD_KEY),r=kv.get(SESSION_PREFIX+id),a=kv.get(APPEARANCE_META_KEY),b=kv.get(BASE_REVISION_KEY),p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_META_KEY);
      let issue,result;
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_SESSION_READ_ABORT'))};
      const inspect=()=>{if([h,r,a,b,p,t].some(req=>req.readyState!=='done'))return;try{
        const head=verifiedSessionHead(h.result),index=head.ids.indexOf(id),s=r.result;
        if(index<0){
          if(s!==undefined)throw Error('E_SESSION_ORPHAN_RECORD');
          result=withRevision?{session:null,
            storeRevision:globalRevisionLight(b.result.revision,a.result,p.result,t.result,head),
            resourceSignature:resourceSignature(b.result.revision,a.result.storeRevision,p.result.storeRevision,t.result.storeRevision)}:null;
          return;
        }
        if(!s||s.id!==id||Number(s.recordRevision||0)!==head.directory[index].recordRevision)
          throw Error('E_SESSION_PARTITION_RECORD_MISSING');
        const deleted=new Set(assertAppearanceMeta(a.result,head.baseRevision).deletedCssIds);
        const projected=deleted.has(s.customCssId)?{...s,customCssId:null,customCssEnabled:false,
          recordRevision:(Number(s.recordRevision)||0)+1}:s;
        result=withRevision?{session:projected,storeRevision:globalRevisionLight(b.result.revision,a.result,p.result,t.result,head),baseRevision:head.baseRevision,
          resourceSignature:resourceSignature(b.result.revision,a.result.storeRevision,p.result.storeRevision,t.result.storeRevision)}:projected;
      }catch(e){issue=e;tx.abort();}};
      for(const req of [h,r,a,b,p,t]){req.onsuccess=inspect;req.onerror=()=>{issue=req.error;tx.abort()}};
    });
  }
  // One canonical resource snapshot, optionally with ONE requested Session.
  // It never reads another Session's History/Memory, even on a cross-tab refresh.
  async function loadResourceSnapshot(sessionId=undefined){
    await ensureSessionPartition();const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),req=readCanonical(tx.objectStore(STORE),sessionId);
      let result,issue;
      req.onsuccess=()=>{result=req.result};req.onerror=()=>{issue=req.error;try{tx.abort()}catch{}};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_RESOURCE_SNAPSHOT_ABORT'))};
    });
  }
  // Version-only probe for rare resource-edit/template paths. No CSS/Persona bytes.
  async function loadResourceRevision(){
    await ensureSessionPartition();const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),kv=tx.objectStore(STORE),b=kv.get(BASE_REVISION_KEY),
        a=kv.get(APPEARANCE_META_KEY),p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_META_KEY),h=kv.get(SESSION_HEAD_KEY);
      let result,issue;
      const inspect=()=>{if([b,a,p,t,h].some(req=>req.readyState!=='done'))return;try{
        const base=b.result?.revision;
        result={resourceSignature:resourceSignature(base,
          assertAppearanceMeta(a.result,base).storeRevision,assertPresetsOverlay(p.result).storeRevision,
          verifiedTemplateMeta(t.result,base).storeRevision),
          storeRevision:globalRevisionLight(base,a.result,p.result,t.result,h.result)};
      }catch(e){issue=e;tx.abort()}};
      for(const req of [b,a,p,t,h]){req.onsuccess=inspect;req.onerror=()=>{issue=req.error;tx.abort()}};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_RESOURCE_REVISION_ABORT'))};
    });
  }
  async function loadSessionDirectory(){
    await ensureSessionPartition();const head=verifiedSessionHead(await get(SESSION_HEAD_KEY));
    return head.directory.map(d=>({...d}));
  }
  async function loadCssSelectionSnapshot(ids=[]){
    await ensureSessionPartition();const selected=[...new Set(ids)];
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),kv=tx.objectStore(STORE),
        h=kv.get(SESSION_HEAD_KEY),a=kv.get(APPEARANCE_KEY),b=kv.get(BASE_REVISION_KEY),
        p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_OVERLAY_KEY),rows=new Map();
      let result,issue,done=0,need=5;
      const fail=e=>{issue=e;try{tx.abort()}catch{}};
      const settle=()=>{if(++done!==need)return;try{
        const head=verifiedSessionHead(h.result,b.result?.revision);
        const deleted=new Set(assertAppearance(a.result).deletedCssIds);
        const sessions=selected.map(id=>{const index=head.ids.indexOf(id);if(index<0)return null;
          const row=rows.get(id);if(!row||row.id!==id||Number(row.recordRevision||0)!==head.directory[index].recordRevision)
          throw Error('E_SESSION_PARTITION_RECORD_MISSING');
          return deleted.has(row.customCssId)?{...row,customCssId:null,customCssEnabled:false,
            recordRevision:(Number(row.recordRevision)||0)+1}:row;
        }).filter(Boolean);
        result={themeSettings:a.result.themeSettings,cssPresets:a.result.cssPresets,sessions,
          appearanceRevision:a.result.storeRevision,
          storeRevision:globalRevision(b.result.revision,a.result,p.result,t.result,head)};
      }catch(e){fail(e)}};
      h.onsuccess=()=>{try{const head=verifiedSessionHead(h.result);
        for(const id of selected.filter(x=>head.ids.includes(x))){need++;const r=kv.get(SESSION_PREFIX+id);r.onsuccess=()=>{rows.set(id,r.result);settle()};r.onerror=()=>fail(r.error);}
        settle();}catch(e){fail(e)}};
      for(const r of [a,b,p,t]){r.onsuccess=settle;r.onerror=()=>fail(r.error)}
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_CSS_CANONICAL_READ_ABORT'))};
    });
  }
  async function commitSessionRecord(candidate,expectedRecordRevision,{allowCreate=false,signal=null,expectedGlobalRevision=null}={}){
    if(!candidate||typeof candidate.id!=='string'||!candidate.id||!Array.isArray(candidate.messages)||
       !Number.isSafeInteger(Number(expectedRecordRevision))||Number(expectedRecordRevision)<0)
      throw Error('E_SESSION_CANDIDATE_INVALID');
    await ensureSessionPartition();const db=await openDb();
    if(signal?.aborted){db.close();throw new DOMException('生成已取消','AbortError');}
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      const h=kv.get(SESSION_HEAD_KEY),r=kv.get(SESSION_PREFIX+candidate.id),b=kv.get(BASE_REVISION_KEY),
            a=kv.get(APPEARANCE_META_KEY),p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_META_KEY);
      let issue,result;
      const abort=()=>{issue=new DOMException('生成已取消，写入未提交','AbortError');try{tx.abort()}catch{}};
      signal?.addEventListener?.('abort',abort,{once:true});
      const inspect=()=>{if([h,r,b,a,p,t].some(x=>x.readyState!=='done'))return;try{
        if(signal?.aborted)return abort();
        const head=verifiedSessionHead(h.result),base=b.result;
        if(!base||base.revision!==head.baseRevision)throw Error('E_SESSION_PARTITION_BASE_CONFLICT');
        const revision=globalRevisionLight(base.revision,a.result,p.result,t.result,head);
        const index=head.ids.indexOf(candidate.id),existing=r.result;
        if((index<0)!==(existing===undefined))throw Error('E_SESSION_PARTITION_DIRECTORY_CONFLICT');
        if(index<0&&!allowCreate)throw Error('E_STORY_SESSION_MISSING');
        if(expectedGlobalRevision!==null&&globalRevisionLight(base.revision,a.result,p.result,t.result,head)!==expectedGlobalRevision)
          throw Error('E_CANONICAL_CONFLICT: 模板创建所依赖的资源已在其他窗口修改，请刷新后重试');
        const removedCss=new Set(assertAppearanceMeta(a.result,base.revision).deletedCssIds);
        const effectiveExistingRevision=Number(existing?.recordRevision||0)+(existing&&removedCss.has(existing.customCssId)?1:0);
        if(index>=0&&effectiveExistingRevision!==Number(expectedRecordRevision))
          throw Error('E_CANONICAL_CONFLICT: 此剧情已在其他窗口修改，旧结果未写入');
        if(index<0&&Number(expectedRecordRevision)!==Number(candidate.recordRevision||0))
          throw Error('E_SESSION_CREATE_REVISION_CONFLICT');
        if(index>=0&&Number(candidate.recordRevision||0)!==Number(expectedRecordRevision))
          throw Error('E_SESSION_CANDIDATE_STALE');
        if(revision>=Number.MAX_SAFE_INTEGER)throw Error('E_CANONICAL_REVISION_OVERFLOW');
        const session={...candidate,recordRevision:Number(expectedRecordRevision)+1,updatedAt:new Date().toISOString()};
        const ids=head.ids.slice(),directory=head.directory.slice(),row=sessionDirectoryRow(session);
        if(index<0){ids.push(candidate.id);directory.push(row);kv.put(ids,SESSION_IDS_KEY);}
        else directory[index]=row;
        kv.put(session,SESSION_PREFIX+session.id);
        kv.put({...head,ids,directory,storeRevision:head.storeRevision+1,updatedAt:session.updatedAt},SESSION_HEAD_KEY);
        result={session,storeRevision:revision+1};
      }catch(e){issue=e;tx.abort();}};
      for(const req of [h,r,b,a,p,t]){req.onsuccess=inspect;req.onerror=()=>{issue=req.error;tx.abort()}};
      const close=()=>{signal?.removeEventListener?.('abort',abort);db.close()};
      tx.oncomplete=()=>{close();resolve(result)};
      tx.onabort=()=>{close();reject(issue||tx.error||Error('E_SESSION_COMMIT_ABORT'))};
    });
  }
  // Delete only the chosen Session, its small directory row, and the matching
  // archive placement in one transaction. Other sessions and resources stay put.
  async function deleteSessionRecord(id,expectedRecordRevision=null){
    await ensureSessionPartition();const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),h=kv.get(SESSION_HEAD_KEY),r=kv.get(SESSION_PREFIX+id),o=kv.get(ORG_KEY),b=kv.get(BASE_REVISION_KEY),a=kv.get(APPEARANCE_META_KEY),p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_META_KEY);
      let result,issue;
      const inspect=()=>{if([h,r,o,b,a,p,t].some(x=>x.readyState!=='done'))return;try{
        const head=verifiedSessionHead(h.result),index=head.ids.indexOf(id),session=r.result;
        if(index<0){if(session!==undefined)throw Error('E_SESSION_ORPHAN_RECORD');result={deleted:false};return;}
        if(!session||session.id!==id||Number(session.recordRevision||0)!==head.directory[index].recordRevision)
          throw Error('E_SESSION_PARTITION_RECORD_MISSING');
        const deletedCss=new Set(assertAppearanceMeta(a.result,b.result.revision).deletedCssIds);
        const effectiveRevision=Number(session.recordRevision||0)+(deletedCss.has(session.customCssId)?1:0);
        if(expectedRecordRevision!==null&&effectiveRevision!==Number(expectedRecordRevision))
          throw Error('E_CANONICAL_CONFLICT: 被删除的剧情已更新，未覆盖');
        const org=verifiedOrganization(o.result),nextOrg={...org,placements:{...org.placements}};
        if(nextOrg.placements[id]){delete nextOrg.placements[id];nextOrg.revision++;nextOrg.updatedAt=new Date().toISOString();}
        const ids=head.ids.filter(x=>x!==id),directory=head.directory.filter(x=>x.id!==id),stamp=new Date().toISOString();
        const rev=globalRevisionLight(b.result.revision,a.result,p.result,t.result,head);
        kv.delete(SESSION_PREFIX+id);kv.put(ids,SESSION_IDS_KEY);
        kv.put({...head,ids,directory,storeRevision:head.storeRevision+1,updatedAt:stamp},SESSION_HEAD_KEY);
        if(nextOrg.revision!==org.revision)kv.put(nextOrg,ORG_KEY);
        result={deleted:true,storeRevision:rev+1,organization:nextOrg};
      }catch(e){issue=e;tx.abort()}};
      for(const req of [h,r,o,b,a,p,t]){req.onsuccess=inspect;req.onerror=()=>{issue=req.error;tx.abort()}};
      tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_SESSION_DELETE_ABORT'))};
    });
  }
  // R19: one IndexedDB transaction for every explicitly selected bulk deletion.
  // Resource changes touch independent overlays and *only* Session records whose
  // compact directory rows actually reference a removed ID. No History scan and
  // no sequence of non-atomic single DELETE requests.
  async function commitBulkDelete(kind,ids,expectedRevision){
    if(!['css','presets','worldbook','sessions'].includes(kind)||!Array.isArray(ids)||!ids.length||
       ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||
       !Number.isSafeInteger(expectedRevision)||expectedRevision<0)
      throw Error('E_BULK_DELETE_INVALID: 选择无效，原件未变更');
    await ensureSessionPartition();
    const selected=new Set(ids),db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),data=new Map();
      let pending=0,issue=null,receipt=null,writing=false;
      const fail=e=>{if(issue)return;issue=e||Error('E_BULK_DELETE_READ');try{tx.abort()}catch{}};
      const read=(key,tag,after)=>{
        pending++;
        const req=kv.get(key);
        req.onsuccess=()=>{if(issue)return;try{
          data.set(tag,req.result);after?.(req.result);
          if(--pending===0&&!writing){writing=true;commit();}
        }catch(e){fail(e)}};
        req.onerror=()=>fail(req.error);
      };
      const snapshot={base:STATE_KEY,appearance:APPEARANCE_KEY,appearanceMeta:APPEARANCE_META_KEY,
        presets:PRESETS_KEY,presetIndex:PRESET_BASE_INDEX_KEY,
        templates:TEMPLATE_OVERLAY_KEY,templateMeta:TEMPLATE_META_KEY,
        head:SESSION_HEAD_KEY,organization:ORG_KEY,sessionIds:SESSION_IDS_KEY};
      for(const [tag,key] of Object.entries(snapshot))read(key,tag,tag==='head'?head=>{
        const rows=verifiedSessionHead(head).directory;
        const needed=kind==='sessions'?ids:rows.filter(row=>{
          if(kind==='css')return selected.has(row.customCssId);
          const refs=kind==='presets'?row.presetIds:row.worldbookIds;
          return Array.isArray(refs)&&refs.some(id=>selected.has(id));
        }).map(row=>row.id);
        for(const id of needed)read(SESSION_PREFIX+id,'session:'+id);
      }:tag==='presets'&&kind==='presets'?head=>{
        for(const id of assertPresetsOverlay(head).changes.filter(id=>selected.has(id)))
          read(PRESET_RECORD_PREFIX+id,'preset:'+id);
      }:undefined);
      function commit(){try{
        const base=data.get('base'),app=assertAppearance(data.get('appearance')),
          preset=assertPresetsOverlay(data.get('presets')),head=verifiedSessionHead(data.get('head')),
          org=verifiedOrganization(data.get('organization'));
        if(!isCanonicalStateRecord(base)||base.schemaVersion!==4||
           !Array.isArray(base.sessions)||base.sessions.length)
          throw Error('E_BULK_DELETE_BASE_UNVERIFIED');
        const oldBaseRev=base.storeRevision;
        if(head.baseRevision!==oldBaseRev||app.baseRevision!==oldBaseRev||preset.baseRevision!==oldBaseRev)
          throw Error('E_BULK_DELETE_BASE_CONFLICT');
        const oldMeta=assertAppearanceMeta(data.get('appearanceMeta'),oldBaseRev),
          oldTemplateMeta=verifiedTemplateMeta(data.get('templateMeta'),oldBaseRev),
          oldTemplate=verifiedTemplateOverlay(data.get('templates'),oldBaseRev),
          oldIndex=verifiedPresetBaseIndex(data.get('presetIndex'),oldBaseRev);
        if(oldMeta.storeRevision!==app.storeRevision||
           !Array.isArray(data.get('sessionIds'))||
           JSON.stringify(data.get('sessionIds'))!==JSON.stringify(head.ids))
          throw Error('E_BULK_DELETE_DIRECTORY_CONFLICT');
        const rev=globalRevisionLight(oldBaseRev,oldMeta,preset,oldTemplateMeta,head);
        if(rev!==expectedRevision)
          throw Error('E_BULK_DELETE_CONFLICT: 资料库或剧情已在其他窗口更新，整批取消，请刷新选择');
        const catalog=kind==='sessions'?head.ids:
          kind==='css'?app.cssPresets.map(x=>x.id):
          kind==='worldbook'?base.worldbooks.map(x=>x.id):
          [...new Set([...base.presets.map(x=>x.id),...preset.changes])];
        if(ids.some(id=>!catalog.includes(id)))
          throw Error('E_BULK_DELETE_MISSING: 选中的记录已变化，整批未删除');
        if(kind==='presets')for(const id of ids.filter(id=>preset.changes.includes(id))){
          const row=data.get('preset:'+id);
          if(!row||row.id!==id||typeof row.content!=='string')throw Error('E_BULK_DELETE_PRESET_FRAGMENT_INVALID');
        }
        const stamp=new Date().toISOString(),rebase=kind==='presets'||kind==='worldbook';
        const newBaseRev=oldBaseRev+(rebase?1:0);
        if(newBaseRev>=Number.MAX_SAFE_INTEGER)throw Error('E_BULK_DELETE_REVISION_OVERFLOW');
        const unlinkIds=values=>Array.isArray(values)?values.filter(id=>!selected.has(id)):values;
        let changedSessions=0;
        const newRows=head.directory.map((meta,i)=>{
          const deleting=kind==='sessions'&&selected.has(meta.id);
          if(deleting){const row=data.get('session:'+meta.id);
            if(!row||row.id!==meta.id||Number(row.recordRevision||0)!==meta.recordRevision)
              throw Error('E_BULK_DELETE_SESSION_CONFLICT');
            // Prepared generations may still hold model responses and send jobs;
            // never delete their canonical owner before settlement.
            if(row.pendingGeneration&&!['failed','aborted','interrupted','completed'].includes(row.pendingGeneration.status)||
               ['prepared','running','streaming'].includes(row.lastGeneration?.status))
              throw Error('E_BULK_DELETE_GENERATING: 选中剧情仍有生成任务，请结算后再删除');
            kv.delete(SESSION_PREFIX+meta.id);changedSessions++;return null;
          }
          let next=null;
          const uses=kind==='css'?selected.has(meta.customCssId):
            kind==='presets'?Array.isArray(meta.presetIds)&&meta.presetIds.some(id=>selected.has(id)):
            kind==='worldbook'?Array.isArray(meta.worldbookIds)&&meta.worldbookIds.some(id=>selected.has(id)):false;
          if(uses){const row=data.get('session:'+meta.id);
            if(!row||row.id!==meta.id||Number(row.recordRevision||0)!==meta.recordRevision)
              throw Error('E_BULK_DELETE_SESSION_CONFLICT: 引用剧情被更改，整批取消');
            // Resource unlinking during a live reply can invalidate the reply's
            // canonical owner; block the whole transaction rather than racing it.
            if(row.pendingGeneration&&!['failed','aborted','interrupted','completed'].includes(row.pendingGeneration.status)||
               ['prepared','running','streaming'].includes(row.lastGeneration?.status))
              throw Error('E_BULK_DELETE_GENERATING: 有剧情正在使用选中资源生成，整批取消');
            if(kind==='css')next={...row,customCssId:null,customCssEnabled:false};
            else if(kind==='presets')next={...row,presetIds:unlinkIds(row.presetIds)};
            else next={...row,worldbookIds:unlinkIds(row.worldbookIds)};
            next.recordRevision=meta.recordRevision+1;next.updatedAt=stamp;
            kv.put(next,SESSION_PREFIX+meta.id);changedSessions++;
          }
          return next?sessionDirectoryRow(next):meta;
        }).filter(Boolean);
        let nextHead={...head,baseRevision:newBaseRev,storeRevision:head.storeRevision+(rebase?1:0)+(changedSessions?1:0),
          ids:kind==='sessions'?head.ids.filter(id=>!selected.has(id)):head.ids.slice(),directory:newRows,updatedAt:stamp};
        if(kind==='sessions'){
          const placements={...org.placements};let orgChanged=false;
          for(const id of ids)if(placements[id]){delete placements[id];orgChanged=true;}
          if(orgChanged){const nextOrg={...org,placements,revision:org.revision+1,updatedAt:stamp};
            validateSessionOrganization(nextOrg,new Set(nextHead.ids));kv.put(nextOrg,ORG_KEY);}
          else validateSessionOrganization(org,new Set(nextHead.ids));
          kv.put(nextHead.ids,SESSION_IDS_KEY);
        }
        if(changedSessions||rebase||kind==='sessions')kv.put(nextHead,SESSION_HEAD_KEY);
        if(kind==='css'){
          const existing=new Set(app.deletedCssIds),deletedCssAt={...(app.deletedCssAt||{})};
          for(const id of ids){existing.add(id);deletedCssAt[id]=stamp;}
          const nextApp={...app,cssPresets:app.cssPresets.filter(x=>!selected.has(x.id)),
            themeSettings:selected.has(app.themeSettings.globalCssPresetId)?
              {...app.themeSettings,globalCssPresetId:null,globalCssEnabled:false}:app.themeSettings,
            deletedCssIds:[...existing],deletedCssAt,storeRevision:app.storeRevision+1,savedAt:stamp};
          assertAppearance(nextApp);kv.put(nextApp,APPEARANCE_KEY);
          kv.put(appearanceMeta(nextApp),APPEARANCE_META_KEY);
        }
        if(rebase){
          const nextBase={...base,storeRevision:newBaseRev};
          if(kind==='presets')nextBase.presets=base.presets.filter(x=>!selected.has(x.id));
          if(kind==='worldbook')nextBase.worldbooks=base.worldbooks.filter(x=>!selected.has(x.id));
          nextBase.novelProjects=(base.novelProjects||[]).map(p=>{
            const key=kind==='presets'?'presetIds':'worldbookIds';
            if(!Array.isArray(p[key])||!p[key].some(id=>selected.has(id)))return p;
            return {...p,[key]:unlinkIds(p[key]),recordRevision:(Number(p.recordRevision)||0)+1,updatedAt:stamp};
          });
          assertWritableState(nextBase);kv.put(nextBase,STATE_KEY);kv.put({revision:newBaseRev},BASE_REVISION_KEY);
          const nextApp={...app,baseRevision:newBaseRev,storeRevision:app.storeRevision+1};
          kv.put(nextApp,APPEARANCE_KEY);kv.put(appearanceMeta(nextApp),APPEARANCE_META_KEY);
          const nextPreset={...preset,baseRevision:newBaseRev,storeRevision:preset.storeRevision+1,
            changes:kind==='presets'?preset.changes.filter(id=>!selected.has(id)):preset.changes};
          assertPresetsOverlay(nextPreset);kv.put(nextPreset,PRESETS_KEY);
          if(kind==='presets'){
            kv.put({...oldIndex,baseRevision:newBaseRev,
              entries:Object.fromEntries(Object.entries(oldIndex.entries).filter(([id])=>!selected.has(id)))},PRESET_BASE_INDEX_KEY);
            for(const id of ids.filter(id=>preset.changes.includes(id)))kv.delete(PRESET_RECORD_PREFIX+id);
          }else kv.put({...oldIndex,baseRevision:newBaseRev},PRESET_BASE_INDEX_KEY);
        }
        // Template overlays own edited template references, even when the base
        // still holds a legacy copy. Rebase alongside base resources atomically.
        const originals=oldTemplate?oldTemplate.templates:base.settingTemplates;
        let updatedTemplates=0;
        const updated=originals.map(template=>{
          const config=template.config||{},key=kind==='css'?'customCssId':kind==='presets'?'presetIds':'worldbookIds';
          const linked=kind==='sessions'?false:
            kind==='css'?selected.has(config.customCssId):
            Array.isArray(config[key])&&config[key].some(id=>selected.has(id));
          if(!linked)return template;
          updatedTemplates++;
          return {...template,config:kind==='css'?{...config,customCssId:null,customCssEnabled:false}:
            {...config,[key]:unlinkIds(config[key])},revision:(Number(template.revision)||0)+1,updatedAt:stamp};
        });
        if(updatedTemplates||rebase){
          const nextTemplateRev=(oldTemplate?.storeRevision??oldBaseRev)+(rebase?1:0)+(updatedTemplates?1:0);
          if(oldTemplate||updatedTemplates)kv.put({version:1,baseRevision:newBaseRev,
            storeRevision:nextTemplateRev,templates:updated,savedAt:stamp},TEMPLATE_OVERLAY_KEY);
          kv.put({version:1,baseRevision:newBaseRev,storeRevision:nextTemplateRev},TEMPLATE_META_KEY);
        }
        const bumpedBase=oldBaseRev+(rebase?1:0);
        const newRev=rev+(rebase?1:0)+(kind==='css'?1:0)+(changedSessions?1:0)+(updatedTemplates?1:0);
        receipt={kind,deleted:ids.length,ids:ids.slice(),affectedSessions:changedSessions,
          affectedTemplates:updatedTemplates,storeRevision:newRev,baseRevision:bumpedBase};
      }catch(e){fail(e)}}
      tx.oncomplete=()=>{db.close();resolve(receipt)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_BULK_DELETE_TX_ABORT'))};
    });
  }

  // CSS selection is less frequent than a message save, but it also must not
  // enumerate/rewrite every Session. Validate the exact CSS candidate and the
  // target Session inside the same IDB commit (cross-tab edit/delete fencing).
  async function commitSessionCssSelection(id,expected,candidate,cssIdentity,validateIdentity){
    await ensureSessionPartition();const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE),h=kv.get(SESSION_HEAD_KEY),r=kv.get(SESSION_PREFIX+id),a=kv.get(APPEARANCE_KEY),b=kv.get(BASE_REVISION_KEY),p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_META_KEY);
      let result,issue;
      const inspect=()=>{if([h,r,a,b,p,t].some(x=>x.readyState!=='done'))return;try{
        const head=verifiedSessionHead(h.result),index=head.ids.indexOf(id),session=r.result;
        if(index<0||!session||session.id!==id||Number(session.recordRevision||0)!==head.directory[index].recordRevision)
          throw Error('E_STORY_SESSION_MISSING');
        const app=assertAppearance(a.result),deleted=new Set(app.deletedCssIds||[]);
        const projected=deleted.has(session.customCssId)?{...session,customCssId:null,customCssEnabled:false,recordRevision:(Number(session.recordRevision)||0)+1}:session;
        if(Number(projected.recordRevision||0)!==Number(expected?.recordRevision)||
          (projected.customCssId||null)!==(expected?.customCssId||null)||
          (projected.customCssEnabled!==false)!==(expected?.customCssEnabled!==false))throw Error('E_CSS_SELECTION_STALE');
        const selected=app.cssPresets.find(x=>x.id===candidate?.customCssId);
        if(!selected||selected.scope==='app'||typeof validateIdentity!=='function'||!validateIdentity(selected,cssIdentity))
          throw Error('E_CSS_CANDIDATE_CHANGED');
        const globalRev=globalRevisionLight(b.result.revision,appearanceMeta(app),p.result,t.result,head),stamp=new Date().toISOString();
        const value={...projected,customCssId:candidate.customCssId,customCssEnabled:!!candidate.customCssEnabled,
          recordRevision:Number(projected.recordRevision||0)+1,updatedAt:stamp};
        const directory=head.directory.slice();directory[index]=sessionDirectoryRow(value);
        kv.put(value,SESSION_PREFIX+id);kv.put({...head,directory,storeRevision:head.storeRevision+1,updatedAt:stamp},SESSION_HEAD_KEY);
        result={session:value,storeRevision:globalRev+1};
      }catch(e){issue=e;tx.abort()}};
      for(const req of [h,r,a,b,p,t]){req.onsuccess=inspect;req.onerror=()=>{issue=req.error;tx.abort()}};
      tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_SESSION_CSS_SELECTION_ABORT'))};
    });
  }
  // Re-use a transaction's verified scoped read for memory and repair edits.
  // This writes ONLY the selected Session and the small revision head.
  function putScopedSession(kv,scopedState,sessionId){
    const session=scopedState.sessions.find(x=>x.id===sessionId);
    if(!session)throw Error('E_STORY_SESSION_MISSING');
    const req=kv.get(SESSION_HEAD_KEY);
    req.onsuccess=()=>{try{
      const head=verifiedSessionHead(req.result),index=head.ids.indexOf(sessionId);
      if(index<0)throw Error('E_STORY_SESSION_MISSING');
      const directory=head.directory.slice();directory[index]=sessionDirectoryRow(session);
      kv.put(session,SESSION_PREFIX+sessionId);
      kv.put({...head,directory,storeRevision:head.storeRevision+1,updatedAt:new Date().toISOString()},SESSION_HEAD_KEY);
    }catch(e){try{kv.transaction.abort()}catch{}}};
    req.onerror=()=>{try{kv.transaction.abort()}catch{}};
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      let rejected=false,upgradeIssue;
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onblocked=()=>{rejected=true;reject(Error('E_DATABASE_UPGRADE_BLOCKED: 请关闭其他旧版咪嘛馆窗口后重试，资料未被覆盖'));};
      req.onupgradeneeded = event => {
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
        if(rejected){req.transaction.abort();return;}
        const kv=req.transaction.objectStore(STORE),old=kv.get(STATE_KEY);
        old.onsuccess=()=>{try{
          if(old.result!==undefined&&!isCanonicalStateRecord(old.result))throw Error('E_CANONICAL_STATE_UNVERIFIED: 旧资料结构无法核实，停止升级');
          // v2 already has an appearance overlay. Never overwrite it on v3 upgrade.
          if(event.oldVersion<2)kv.put(appearanceFromState(old.result),APPEARANCE_KEY);
          if(event.oldVersion<3){kv.put(presetsFromState(old.result),PRESETS_KEY);
            kv.put({revision:Number(old.result?.storeRevision)||0},BASE_REVISION_KEY);}
          if(event.oldVersion<4)kv.put((old.result?.sessions||[]).map(s=>s.id),SESSION_IDS_KEY);
          if(event.oldVersion<7)kv.put(presetBaseIndexFromState(old.result),PRESET_BASE_INDEX_KEY);
        }catch(error){upgradeIssue=error;req.transaction.abort();}};
      };
      req.onsuccess = () => {const db=req.result;db.onversionchange=()=>db.close();if(rejected)db.close();else resolve(db);};
      req.onerror = () => reject(upgradeIssue||req.error);
    });
  }
  async function loadAppearance(){const value=await get(APPEARANCE_KEY);return assertAppearance(value);}
  // The appearance bytes and all five lightweight revision heads must come
  // from ONE IDB snapshot. Two independent reads can combine different tabs'
  // commits and incorrectly publish a stale resource signature to RAM.
  async function loadAppearanceWithRevision(){
    await ensureSessionPartition();const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),kv=tx.objectStore(STORE);
      const a=kv.get(APPEARANCE_KEY),b=kv.get(BASE_REVISION_KEY),
        p=kv.get(PRESETS_KEY),t=kv.get(TEMPLATE_META_KEY),h=kv.get(SESSION_HEAD_KEY);
      let result,issue;
      const inspect=()=>{if([a,b,p,t,h].some(req=>req.readyState!=='done'))return;try{
        const appearance=assertAppearance(a.result),base=b.result?.revision;
        if(!Number.isSafeInteger(base)||appearance.baseRevision!==base)
          throw Error('E_APPEARANCE_BASE_CONFLICT: 外观版本与资料库基线不一致');
        const preset=assertPresetsOverlay(p.result),template=verifiedTemplateMeta(t.result,base);
        const global=globalRevisionLight(base,appearanceMeta(appearance),preset,template,h.result);
        result={appearance,storeRevision:global,appearanceRevision:appearance.storeRevision,
          resourceSignature:resourceSignature(base,appearance.storeRevision,preset.storeRevision,template.storeRevision)};
      }catch(e){issue=e;tx.abort()}};
      for(const req of [a,b,p,t,h]){req.onsuccess=inspect;req.onerror=()=>{issue=req.error;tx.abort()}};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_APPEARANCE_SNAPSHOT_ABORT'))};
    });
  }
  // edit is synchronous and receives a detached, small IDB clone. False means
  // no write; exceptions abort. No state document or message is read here.
  async function commitAppearance(edit,{signal=null,checkCanonical=null,withRevision=false}={}) {
    const db=await openDb();
    if(signal?.aborted){db.close();throw new DOMException('外观保存已取消','AbortError');}
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);let result,issue;
      const abort=()=>{issue=new DOMException('外观保存已取消','AbortError');try{tx.abort();}catch{}};
      signal?.addEventListener?.('abort',abort,{once:true});
      const req=kv.get(APPEARANCE_KEY);
      // Renderer-content PATCH is the only frequent appearance write that
      // needs the large canonical base. Keep ordinary category/name/preview
      // writes on the lightweight overlay-only path.
      const baseReq=typeof checkCanonical==='function'?kv.get(STATE_KEY):null;
      const sessionHeadReq=baseReq?kv.get(SESSION_HEAD_KEY):null;
      const templateOverlayReq=baseReq?kv.get(TEMPLATE_OVERLAY_KEY):null;
      // Read the SAME lightweight revision heads in the writing transaction.
      // Never reconstruct the global revision from the appearance counter.
      const baseHeadReq=withRevision?kv.get(BASE_REVISION_KEY):null;
      const presetHeadReq=withRevision?kv.get(PRESETS_KEY):null;
      const templateHeadReq=withRevision?kv.get(TEMPLATE_META_KEY):null;
      const globalSessionHeadReq=withRevision&&!baseReq?kv.get(SESSION_HEAD_KEY):sessionHeadReq;
      let ready=0,receipt=null;
      const inspect=()=>{if(++ready!==(baseReq?4:1)+(withRevision?(baseReq?3:4):0))return;try{
        const value=assertAppearance(req.result),revision=value.storeRevision,baseRevision=value.baseRevision;
        if(baseReq){
          if(!isCanonicalStateRecord(baseReq.result)||Number(baseReq.result.storeRevision||0)!==baseRevision)
            throw Error('E_APPEARANCE_BASE_CONFLICT: CSS 引用基线无法核实，未覆盖');
          const directory=verifiedSessionHead(sessionHeadReq.result,baseRevision).directory;
          const currentTemplates=verifiedTemplateOverlay(templateOverlayReq.result,baseRevision);
          const verdict=checkCanonical({...baseReq.result,sessions:directory,
            settingTemplates:currentTemplates?currentTemplates.templates:baseReq.result.settingTemplates},value);
          if(verdict&&typeof verdict.then==='function')throw Error('E_APPEARANCE_ASYNC_CHECK');
        }
        const outcome=edit(value);if(outcome&&typeof outcome.then==='function')throw Error('E_APPEARANCE_ASYNC_EDIT');
        if(outcome===false)result=value;
        else {
          result={...value,baseRevision,storeRevision:revision+1,savedAt:new Date().toISOString()};assertAppearance(result);
        }
        if(withRevision){
          const base=baseHeadReq.result?.revision,preset=assertPresetsOverlay(presetHeadReq.result),
            template=verifiedTemplateMeta(templateHeadReq.result,base);
          if(!Number.isSafeInteger(base)||result.baseRevision!==base)
            throw Error('E_APPEARANCE_BASE_CONFLICT: 资料库基线已变化，本次未写入');
          const global=globalRevisionLight(base,appearanceMeta(result),preset,template,globalSessionHeadReq.result);
          if(!Number.isSafeInteger(global)||global>=Number.MAX_SAFE_INTEGER)
            throw Error('E_CANONICAL_REVISION_OVERFLOW');
          receipt={appearance:result,storeRevision:global,appearanceRevision:result.storeRevision,
            resourceSignature:resourceSignature(base,result.storeRevision,preset.storeRevision,template.storeRevision)};
        }
        if(outcome===false)return;
        if(signal?.aborted){abort();return;}kv.put(result,APPEARANCE_KEY);kv.put(appearanceMeta(result),APPEARANCE_META_KEY);
      }catch(error){issue=error;tx.abort();}};
      req.onerror=()=>{issue=req.error;tx.abort();};req.onsuccess=inspect;
      if(baseReq){baseReq.onerror=()=>{issue=baseReq.error;tx.abort();};baseReq.onsuccess=inspect;
        sessionHeadReq.onerror=()=>{issue=sessionHeadReq.error;tx.abort()};sessionHeadReq.onsuccess=inspect;
        templateOverlayReq.onerror=()=>{issue=templateOverlayReq.error;tx.abort()};templateOverlayReq.onsuccess=inspect;}
      if(withRevision)for(const r of [baseHeadReq,presetHeadReq,templateHeadReq,...(baseReq?[]:[globalSessionHeadReq])]){
        r.onerror=()=>{issue=r.error;tx.abort()};r.onsuccess=inspect;
      }
      const close=()=>{signal?.removeEventListener?.('abort',abort);db.close();};
      tx.oncomplete=()=>{close();resolve(withRevision?receipt:result);};
      tx.onabort=()=>{close();reject(issue||tx.error||Error('E_APPEARANCE_WRITE_ABORTED'));};
    });
  }
  async function get(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let value, issue;
      const tx = db.transaction(STORE, 'readonly');
      const req = key===STATE_KEY?readCanonical(tx.objectStore(STORE)):tx.objectStore(STORE).get(key);
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
  // Tool drafts are independent kv records; enumerate keys as well as values.
  async function exportPlayToolRecords(){
    const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),os=tx.objectStore(STORE),range=IDBKeyRange.bound('play_tools_v1:','play_tools_v1:\uffff'),k=os.getAllKeys(range),v=os.getAll(range);let issue;
      k.onerror=()=>{issue=k.error;tx.abort()};v.onerror=()=>{issue=v.error;tx.abort()};
      tx.oncomplete=()=>{db.close();if(k.result.length!==v.result.length)return reject(Error('工具草稿快照不完整'));resolve(k.result.map((key,i)=>[key,v.result[i]]))};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('工具草稿读取中断'))};});
  }
  async function importPlayToolRecords(rows,{dryRun=false}={}){
    if(!Array.isArray(rows))throw Error('工具本地记录格式错误');const seen=new Set();
    for(const row of rows){if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!row[0].startsWith('play_tools_v1:')||seen.has(row[0]))throw Error('工具记录键无效或重复');seen.add(row[0]);}
    const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,dryRun?'readonly':'readwrite'),os=tx.objectStore(STORE),range=IDBKeyRange.bound('play_tools_v1:','play_tools_v1:\uffff'),k=os.getAllKeys(range),v=os.getAll(range);let issue,count=0,ready=0;
      const go=()=>{if(++ready!==2)return;try{const current=new Map(k.result.map((key,i)=>[key,v.result[i]]));for(const [key,value] of rows){const old=current.get(key);if(old!==undefined&&JSON.stringify(old)!==JSON.stringify(value))throw Error('工具草稿或清理日志冲突，拒绝覆盖：'+key);if(old===undefined){count++;if(!dryRun)os.add(value,key);}}}catch(e){issue=e;tx.abort()}};
      k.onsuccess=go;v.onsuccess=go;k.onerror=()=>{issue=k.error;tx.abort()};v.onerror=()=>{issue=v.error;tx.abort()};tx.oncomplete=()=>{db.close();resolve({added:count,dryRun})};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('工具记录导入中断'))};});
  }
  // Serialize compare-and-swap inside a single IndexedDB readwrite transaction.
  // Never treat a failed read as an empty library, and never silently overwrite a newer tab.
  async function commitState(candidate, expectedRevision, {signal=null,organizationImport=false,expectedOrganizationRevision=null}={}) {
    await ensureSessionPartition();
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
      const req = readCanonical(objectStore);
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
        let org=verifiedOrganization(current?.sessionOrganizationV1);
        const sessionIds=new Set(candidate.sessions.map(x=>x.id));
        if(organizationImport){
          if(org.revision!==expectedOrganizationRevision){problem=Error('E_SESSION_ORGANIZATION_CONFLICT: 恢复时目录已被其它标签更改');tx.abort();return;}
          try{
            const imported=validateSessionOrganization(candidate.sessionOrganizationV1,sessionIds);
            const revision=Math.max(org.revision,imported.revision);
            if(revision>=Number.MAX_SAFE_INTEGER)throw Error('E_SESSION_ORGANIZATION_REVISION_OVERFLOW');
            // Keep local CAS monotonic across full restores; the imported
            // directory content is exact, but a stale tab cannot reuse an old
            // revision after a backup with a smaller source revision arrives.
            org={...imported,revision:revision+1};
          }catch(error){problem=error;tx.abort();return;}
          objectStore.put(org,ORG_KEY);
        }else{
          const placements=Object.fromEntries(Object.entries(org.placements).filter(([id])=>sessionIds.has(id)));
          if(Object.keys(placements).length!==Object.keys(org.placements).length){
            org={...org,placements,revision:org.revision+1,updatedAt:new Date().toISOString()};
            objectStore.put(org,ORG_KEY);
          }
        }
        result = { ...candidate,sessionOrganizationV1:org, storeRevision: revision + 1, schemaVersion: 4, savedAt: new Date().toISOString() };
        putCanonical(objectStore,result,current);
      };
      tx.oncomplete = () => { release();db.close();resolve(result); };
      tx.onabort = () => { release();db.close();reject(problem || tx.error || new Error('资料库事务中止')); };
      tx.onerror = () => { /* onabort retains the root cause */ };
    });
  }
  async function loadState() {
    await ensureSessionPartition();
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
    const {__resourceSignature:_internalResourceRevision,...snapshot}=await loadState();
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
    if(Object.prototype.hasOwnProperty.call(src,'sessionOrganizationV1'))validateSessionOrganization(src.sessionOrganizationV1,new Set(src.sessions.map(s=>s.id)));
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
    // Optional on old archives, strictly verified when present. Category records
    // never replace resource IDs or CSS/source bytes.
    function validCategories(rows,path){
      if(!Array.isArray(rows))invalid(path,'分类注册表必须为数组');
      const ids=new Set(),names=new Set();
      for(const [i,item]of rows.entries()){
        if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||!item.id||typeof item.name!=='string'||
          !item.name.trim()||item.name!==item.name.trim()||item.name.length>60||item.name==='未分类'||ids.has(item.id)||names.has(item.name.toLocaleLowerCase()))invalid(path+'['+i+']','分类 ID 或名称无效/重复');
        ids.add(item.id);names.add(item.name.toLocaleLowerCase());
      }
    }
    if(src.cssCategoriesV1!==undefined)validCategories(src.cssCategoriesV1,'cssCategoriesV1');
    if(src.resourceCategoriesV1!==undefined){const categories=src.resourceCategoriesV1;
      if(!categories||typeof categories!=='object'||Array.isArray(categories)||!Array.isArray(categories.presets)||!Array.isArray(categories.worldbook))invalid('resourceCategoriesV1','分类结构不完整');
      validCategories(categories.presets,'resourceCategoriesV1.presets');validCategories(categories.worldbook,'resourceCategoriesV1.worldbook');
    }

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
      cssPresets:Array.isArray(src.cssPresets)?src.cssPresets:[],cssCategoriesV1:src.cssCategoriesV1??[],resourceCategoriesV1:src.resourceCategoriesV1??{presets:[],worldbook:[]},
      regexPacks:Array.isArray(src.regexPacks)?src.regexPacks:[],
      theaterCards:Array.isArray(src.theaterCards)?src.theaterCards:[],quickCommands:Array.isArray(src.quickCommands)?src.quickCommands:[],
      settingTemplates:Array.isArray(src.settingTemplates)?src.settingTemplates:[],
      novelProjects:Array.isArray(src.novelProjects)?src.novelProjects:[],
      themeSettings:src.themeSettings&&typeof src.themeSettings==='object'?src.themeSettings:{...EMPTY_THEME}
    };
    const current=await loadState();
    const sourceOrg=Object.prototype.hasOwnProperty.call(src,'sessionOrganizationV1')?src.sessionOrganizationV1:null;
    next.sessionOrganizationV1=sourceOrg||{...current.sessionOrganizationV1,placements:Object.fromEntries(Object.entries(current.sessionOrganizationV1?.placements||{}).filter(([id])=>next.sessions.some(x=>x.id===id)))};
    validateSessionOrganization(next.sessionOrganizationV1,new Set(next.sessions.map(x=>x.id)));
    return saveState(next,Number(current.storeRevision)||0,{organizationImport:true,expectedOrganizationRevision:current.sessionOrganizationV1?.revision??0});
  }
  async function saveSettingsSnapshot(snapshot){ return set(SETTINGS_SNAPSHOT_KEY,{...(snapshot||{}),savedAt:new Date().toISOString()}); }
  async function loadSettingsSnapshot(){ const current=await loadSettingsSnapshotV2();if(current)return current;const existing=await get(SETTINGS_SNAPSHOT_KEY);return existing&&typeof existing==='object'?existing:null; }
  async function loadSettingsSnapshotSummary(){
    const head=await get('settings_snapshot_v2_head');
    if(head){const summary=await get('settings_snapshot_v2_summary');
      if(!summary||summary.snapshotId!==head)throw Error('快照概览与当前记录不一致；原数据未修改');
      return summary;
    }
    return loadSettingsSnapshot(); // Unmodified old v1 snapshots remain readable.
  }
  async function clearSettingsSnapshot(){
    // Keep the historical clear API functional for both versions. This is an
    // explicit delete, not a failed-load migration or background cleanup.
    return snapshotWrite((kv,setResult,fail)=>{
      const stage=kv.get(SNAP_V2_STAGE);
      stage.onsuccess=()=>{
        if(stage.result){fail(Error('本机快照正在保存，拒绝清空'));return;}
        const cursor=kv.openCursor();
        cursor.onsuccess=()=>{const c=cursor.result;
          if(!c)return;
          const k=String(c.key);
          if(k===SETTINGS_SNAPSHOT_KEY||k.startsWith('settings_snapshot_v2_'))kv.delete(c.key);
          c.continue();
        };
        cursor.onerror=()=>fail(cursor.error||Error('快照删除列表读取失败'));
        setResult(true);
      };
    });
  }

  // V5.51: versioned, immutable local settings snapshots. The previous head
  // remains intact until every font Blob and the new manifest have committed.
  // Each staged font and its ledger entry commit in ONE IDB transaction.
  const SNAP_V2_HEAD='settings_snapshot_v2_head', SNAP_V2_STAGE='settings_snapshot_v2_stage';
  const snapshotManifestKey=id=>'settings_snapshot_v2_manifest:'+id;
  const snapshotBinaryKey=(id,fontId)=>'settings_snapshot_v2_blob:'+id+':'+fontId;
  async function snapshotWrite(fn){
    const db=await openDb();return new Promise((resolve,reject)=>{
      let answer,reason;const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      const fail=e=>{reason=e instanceof Error?e:Error(String(e));try{tx.abort()}catch(_){}};
      try{fn(kv,x=>{answer=x},fail)}catch(e){fail(e)}
      tx.oncomplete=()=>{db.close();resolve(answer)};
      tx.onabort=()=>{db.close();reject(reason||tx.error||Error('E_SETTINGS_SNAPSHOT_ABORTED'))};
    });
  }
  function snapshotToken(){return 's'+(crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2));}
  async function beginSettingsSnapshotV2(expectedFonts){
    if(!Number.isSafeInteger(expectedFonts)||expectedFonts<0)throw Error('快照字体数量不合法');
    const token=snapshotToken();
    await snapshotWrite((kv,setResult,fail)=>{
      const req=kv.get(SNAP_V2_STAGE);
      req.onsuccess=()=>{
        if(req.result){fail(Error('有未结束的本机快照保存。请确认没有其他标签正在写入，再清理未完成快照'));return;}
        kv.put({token,expectedFonts,fonts:[],createdAt:new Date().toISOString()},SNAP_V2_STAGE);setResult(token);
      };
    });return token;
  }
  async function stageSettingsSnapshotFontV2(token,row,blob){
    if(!row||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.size)||row.size<=0||
       !(blob instanceof Blob)||blob.size!==row.size||!(/^[0-9a-f]{64}$/i).test(row.sha256||''))throw Error('本机快照字体原件/指纹无效');
    await snapshotWrite((kv,setResult,fail)=>{
      const req=kv.get(SNAP_V2_STAGE);
      req.onsuccess=()=>{
        const stage=req.result;
        if(!stage||stage.token!==token||stage.fonts.length>=stage.expectedFonts||stage.fonts.some(x=>x.id===row.id)){
          fail(Error('快照保存所有权或字体索引冲突'));return;
        }
        kv.put(blob,snapshotBinaryKey(token,row.id));
        kv.put({...stage,fonts:[...stage.fonts,row]},SNAP_V2_STAGE);setResult(true);
      };
    });
  }
  async function completeSettingsSnapshotV2(token,snapshot){
    if(!snapshot?.data?.library||!Array.isArray(snapshot.data.fonts)||snapshot.data.fonts.length)
      throw Error('快照清单格式无效');
    return snapshotWrite((kv,setResult,fail)=>{
      const stageReq=kv.get(SNAP_V2_STAGE),headReq=kv.get(SNAP_V2_HEAD);
      let stage,head,done=0;
      const finish=()=>{if(++done!==2)return;
        if(!stage||stage.token!==token||stage.fonts.length!==stage.expectedFonts){fail(Error('快照字体尚未全部保存，拒绝提交'));return;}
        const value={...snapshot,snapshotId:token,snapshotFontRecords:stage.fonts,savedAt:new Date().toISOString(),previousSnapshotId:head||null};
        kv.put(value,snapshotManifestKey(token));kv.put(token,SNAP_V2_HEAD);
        kv.put({snapshotId:token,savedAt:value.savedAt,fontCount:stage.fonts.length},'settings_snapshot_v2_summary');
        kv.delete(SNAP_V2_STAGE);setResult(value);
      };
      stageReq.onsuccess=()=>{stage=stageReq.result;finish()};headReq.onsuccess=()=>{head=headReq.result;finish()};
    });
  }
  async function discardFailedSettingsSnapshotV2(token=null){
    return snapshotWrite((kv,setResult,fail)=>{
      const req=kv.get(SNAP_V2_STAGE);
      req.onsuccess=()=>{
        const stage=req.result;
        if(!stage){setResult(false);return;}
        if(token&&stage.token!==token){fail(Error('另一标签的快照所有权发生变化，拒绝清理'));return;}
        for(const row of stage.fonts||[])kv.delete(snapshotBinaryKey(stage.token,row.id));
        kv.delete(SNAP_V2_STAGE);setResult(true);
      };
    });
  }
  async function hasIncompleteSettingsSnapshotV2(){return !!await get(SNAP_V2_STAGE)};
  async function loadSettingsSnapshotV2(){
    const head=await get(SNAP_V2_HEAD);if(!head)return null;
    const record=await get(snapshotManifestKey(head));
    if(!record||record.snapshotId!==head)throw Error('本机快照索引与清单不一致，保留现有资料');
    return record;
  }
  async function loadSettingsSnapshotFontV2(token,id){
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),kv=tx.objectStore(STORE);
      let head,manifest,blob,received=0,issue;
      const validate=()=>{if(++received!==3)return;
        if(head!==token||manifest?.snapshotId!==token||!manifest.snapshotFontRecords?.some(x=>x.id===id)||!(blob instanceof Blob)){
          issue=Error('本机快照字体原件已缺失或版本变化：'+id);try{tx.abort()}catch(_){}
        }
      };
      for(const [key,assign] of [[SNAP_V2_HEAD,x=>head=x],[snapshotManifestKey(token),x=>manifest=x],[snapshotBinaryKey(token,id),x=>blob=x]]){
        const req=kv.get(key);req.onsuccess=()=>{assign(req.result);validate()};req.onerror=()=>{issue=req.error;try{tx.abort()}catch(_){}};
      }
      tx.oncomplete=()=>{db.close();resolve(blob)};
      tx.onabort=()=>{db.close();reject(issue||tx.error||Error('E_SETTINGS_SNAPSHOT_READ'))};
    });
  }
  async function pruneOldSettingsSnapshotsV2(){
    const head=await get(SNAP_V2_HEAD),latest=head?await get(snapshotManifestKey(head)):null;
    if(!head||!latest?.previousSnapshotId)return false;
    // Prune only the predecessor of the current head, not any active snapshot.
    return snapshotWrite((kv,setResult,fail)=>{
      const h=kv.get(SNAP_V2_HEAD),m=kv.get(snapshotManifestKey(head)),old=kv.get(snapshotManifestKey(latest.previousSnapshotId));
      let current,entry,previous,n=0;
      const finish=()=>{if(++n!==3)return;
        if(current!==head||entry?.previousSnapshotId!==latest.previousSnapshotId){fail(Error('快照已被其他标签替换，停止回收旧版本'));return;}
        if(previous?.snapshotId===latest.previousSnapshotId){
          for(const row of previous.snapshotFontRecords||[])kv.delete(snapshotBinaryKey(previous.snapshotId,row.id));
          kv.delete(snapshotManifestKey(previous.snapshotId));
        }
        kv.put({...entry,previousSnapshotId:previous?.previousSnapshotId||null},snapshotManifestKey(head));setResult(true);
      };
      h.onsuccess=()=>{current=h.result;finish()};m.onsuccess=()=>{entry=m.result;finish()};old.onsuccess=()=>{previous=old.result;finish()};
    });
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
  // Separate unadopted output journal: never a canonical story/candidate.
  async function putHtmlRepairDraft(draft){
    if(!draft?.id||!draft.sessionId||!draft.messageId||typeof draft.content!=='string'||draft.accepted!==false)throw Error('E_HTML_AI_DRAFT_INVALID');
    const db=await openDb();return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),kv=tx.objectStore(STORE);
      kv.put(draft,'html_repair_draft_v1:'+draft.sessionId+':'+draft.messageId);
      kv.put(draft,'html_repair_draft_archive_v1:'+draft.id);
      tx.oncomplete=()=>{db.close();resolve(draft)};
      tx.onabort=()=>{db.close();reject(tx.error||Error('E_HTML_AI_DRAFT_SAVE_FAILED'))};
    });
  }
  const getHtmlRepairDraft=(sessionId,messageId)=>get('html_repair_draft_v1:'+sessionId+':'+messageId);
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
    const approvedSession=Array.isArray(candidateState?.sessions)?candidateState.sessions.find(s=>s.id===sessionId):candidateState;
    if(!approvedSession||approvedSession.id!==sessionId||!Array.isArray(approvedSession.messages))
      throw Error('E_HTML_REPAIR_SESSION_INVALID');
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
        const candidateSession=approvedSession;
        if(!currentSession||!candidateSession||
          Number(currentSession.recordRevision||0)!==Number(expectedRecordRevision||0)||
          Number(candidateSession.recordRevision||0)!==Number(expectedRecordRevision||0)+1)
          return fail(Error('E_HTML_REPAIR_STALE_SESSION'));
        // The repair candidate and this one Session commit atomically.
        // A whole-library clone is neither a valid prerequisite nor a write target.
        const savedAt=new Date().toISOString();
        result={session:candidateSession,storeRevision:revision+1};
        const settled={...repair,state:'approved',settledAt:savedAt};
        putScopedSession(kv,{sessions:[candidateSession]},sessionId);
        kv.put(settled,htmlRepairKey(sessionId,messageId));
        kv.put(settled,htmlRepairArchiveKey(candidateId));
      };
      const a=readCanonical(kv,sessionId),b=kv.get(htmlRepairKey(sessionId,messageId));
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
      const req=readCanonical(kv,sessionId);
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
      const sr=readCanonical(kv,sessionId);
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
        const sr=readCanonical(kv,job.sessionId);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{
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
          putScopedSession(kv,committed,job.sessionId);
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
        const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_REVIEW_STATE_READ');sr.onsuccess=()=>{
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
            state.sessions[idx]=revised;putScopedSession(kv,state,sessionId);
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
        const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_STORE_READ');
        sr.onsuccess=()=>{
          const state=sr.result;
          if(!isCanonicalStateRecord(state)){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const index=state.sessions.findIndex(s=>s?.id===sessionId);
          if(index<0){fail('E_STORY_SESSION_MISSING');return;}
          const session=state.sessions[index],archive=Array.isArray(session.rollingArchive)?session.rollingArchive.slice():[];
          const keys=['summary','rollingSummary','longSummary','lastSummarizedIndex','rollingSourceCount','rollingSourceFingerprint','rollingVerification'];
          const patch={};
          if(action==='revoke'){
            if(session.rollingSummary||session.summary||session.longSummary||session.lastSummarizedIndex){
              const saved={savedAt:new Date().toISOString()};for(const key of keys)saved[key]=session[key];archive.push(saved);
            }
            Object.assign(patch,{summary:'',rollingSummary:'',longSummary:'',lastSummarizedIndex:0,rollingSourceCount:0,rollingSourceFingerprint:'',rollingVerification:{status:'legacy_unverified',stage:'revoked',citations:[]},rollingArchive:archive});
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
          putScopedSession(kv,{...state,sessions},sessionId);
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
        const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{
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
        const request=readCanonical(kv,job.sessionId);
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
          const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{if(!isCanonicalStateRecord(sr.result)){fail('E_MEMORY_STORE_UNVERIFIED');return;}result=sr.result;};return;}
        const jr=kv.get(jobKey(sessionId,'facts'));jr.onerror=()=>fail('E_MEMORY_JOURNAL_READ');jr.onsuccess=()=>{
          const job=jr.result;if(!job||job.id!==jobId||job.kind!=='facts'||(job.status==='running'&&Number(job.leaseUntilEpoch||0)>Date.now())||!['failed','interrupted','aborted','needs_review','partially_committed','running'].includes(job.status)){fail('E_MEMORY_FACT_JOB_UNAVAILABLE');return;}
          if(job.options?.scope==='all'&&job.options?.replaceExisting===true){fail('E_MEMORY_FACT_REPLACE_ATOMIC_REQUIRED');return;}
          const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_STORE_READ');sr.onsuccess=()=>{
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
                putScopedSession(kv,result,sessionId);
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
      const proceed=draft=>{const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_MERGE_STATE_READ');
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
        putScopedSession(kv,result,sessionId);
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
        const sr=readCanonical(kv,sessionId);sr.onerror=()=>fail('E_MEMORY_MERGE_STATE_READ');
        sr.onsuccess=()=>{
          const current=sr.result,impl=window.MimaStandalone,contract=window.MimaMemoryContracts;
          if(!isCanonicalStateRecord(current)||!impl?.memoryFactSignature||!contract?.normalizeManualMemory){fail('E_MEMORY_STORE_UNVERIFIED');return;}
          const idx=current.sessions.findIndex(s=>s?.id===sessionId);if(idx<0){fail('E_STORY_SESSION_MISSING');return;}
          const session=current.sessions[idx],manual=contract.normalizeManualMemory(session.manualMemory||{});
          if(impl.memoryFactSignature(manual.facts)!==undo.afterSignature){fail('E_MEMORY_MERGE_UNDO_CONFLICT');return;}
          const updated={...session,manualMemory:{...manual,facts:undo.originalFacts},recordRevision:(Number(session.recordRevision)||0)+1,updatedAt:new Date().toISOString()};
          const sessions=current.sessions.slice();sessions[idx]=updated;
          result={...current,sessions,storeRevision:(Number(current.storeRevision)||0)+1,savedAt:new Date().toISOString()};
          putScopedSession(kv,result,sessionId);kv.delete(factMergeUndoKey(sessionId));
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
        // Every stage update replaces the single receipt record. Preserve actual
        // request-dispatch evidence, source identity and verified stream outcome;
        // FAILED_SETTLED must not silently turn a paid fetch into 'not requested'.
        const fields=['sourceFingerprint','recordRevision','ownerId','finishKind','finishReason','errorCode','requestDispatchAttempted'];
        const previous=Object.fromEntries(fields.filter(k=>old&&Object.hasOwn(old,k)).map(k=>[k,old[k]]));
        const updates=Object.fromEntries(Object.entries(extra).filter(([k])=>fields.includes(k)));
        outcome={...identity,...previous,stage:String(stage),ownerId:String(extra.ownerId||old?.ownerId||''),
          startedAt:old?.startedAt||Date.now(),lastSeenAt:Date.now(),
          fragmentCount:old?.fragmentCount||0,persistedChars:old?.persistedChars||0,...updates};
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
  async function generationStatus(id){
    const identity=verifiedGenerationId(id),receipt=await get(generationKey(identity));
    if(!receipt)return null;
    if(receipt.sessionId!==identity.sessionId||receipt.generationId!==identity.generationId||receipt.attempt!==identity.attempt)
      throw new Error('E_GENERATION_RECEIPT_CORRUPT');
    return {...identity,stage:String(receipt.stage||''),fragmentCount:Number(receipt.fragmentCount)||0,
      persistedChars:Number(receipt.persistedChars)||0,ownerId:String(receipt.ownerId||'')};
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
  window.MimaLocalStore={commitBulkDelete,loadSessionRecord,loadResourceSnapshot,loadResourceRevision,loadAppearanceWithRevision,presetCasToken,loadSessionDirectory,loadCssSelectionSnapshot,commitSessionRecord,deleteSessionRecord,commitSessionCssSelection,commitSettingTemplates,validateSessionOrganization,loadSessionOrganization,commitSessionOrganization,commitPreset,putHtmlRepairDraft,getHtmlRepairDraft,loadAppearance,commitAppearance,mergeAppearance,exportPlayToolRecords,importPlayToolRecords,listPlayToolLocal,getPlayToolLocal:key=>get('play_tools_v1:'+key),putPlayToolLocal:(key,value)=>set('play_tools_v1:'+key,value),generationReceipt,generationAppendFragment,generationStatus,generationRead,getRollingPreflight,putRollingPreflight,clearRollingPreflight,commitHtmlRepair,putHtmlRepairCandidate,getHtmlRepairCandidate,setHtmlRepairCandidateState,listMemoryStages,inspectLegacyMemoryStages,putMemoryRejectedDraft,listMemoryRejectedDrafts,memoryReferenceContract,putFactRangeCandidate,listFactRangeCandidates,commitVerifiedFactRanges,getMergeStage,putMergeStage,getMergeDraft,createMergeDraft,updateMergeDraft,commitFactMerge,undoFactMerge,updateRollingMemory,dismissMemoryJob,loadState,saveState,commitState,validateLibrary,exportAll,importAll,saveSettingsSnapshot,loadSettingsSnapshot,loadSettingsSnapshotSummary,clearSettingsSnapshot,beginSettingsSnapshotV2,stageSettingsSnapshotFontV2,completeSettingsSnapshotV2,discardFailedSettingsSnapshotV2,hasIncompleteSettingsSnapshotV2,loadSettingsSnapshotFontV2,pruneOldSettingsSnapshotsV2,getMemoryJob,getMemoryStage,putMemoryStage,beginMemoryJob,checkpointMemoryJob,settleMemoryJob,interruptMemoryJob,commitMemoryJob,heartbeatMemoryJob,reviewMemoryCandidate};
})();
