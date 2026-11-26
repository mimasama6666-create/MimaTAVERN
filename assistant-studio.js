/**
 * ✦ MimaTAVERN Assistant Studio
 * Regex Assistant / Preset Assistant / CSS Beauty Assistant
 * Uses the story API connection, but keeps an independent model / temperature / persona per assistant.
 */
(() => {
  'use strict';

  const STORAGE_KEY='MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1';
  const SAVE_GUARD_DB='mimamao_tavern_assistant_write_guard_v1';
  let saveQueue=Promise.resolve(),recoveryQueue=Promise.resolve(),saveGuardDBPromise=null,confirmedState=null,unsavedRescue=[],recoveryNotice='';
  const pendingRecovery=new Map();let recoveryWriteProblem=null;
  let profileSaveTimer=null,profileSaveWaiters=[],persistedRecoveryCount=0;
  const TYPES=['regex','preset','css'];
  const META={
    regex:{title:'正则助手',icon:'<img src="./assets/mima-gothic-regex.png" class="mima-gothic-ui-icon" alt="" aria-hidden="true" draggable="false">',quick:'HTML 状态栏 → 正则省 Token',placeholder:'把输出规范 / HTML 状态栏 / 正则需求贴给我……'},
    preset:{title:'预设助手',icon:'<img src="./assets/mima-gothic-preset.png" class="mima-gothic-ui-icon" alt="" aria-hidden="true" draggable="false">',quick:'生成可直接保存的预设',placeholder:'告诉我你想要的文风、行为规则、输出格式……'},
    css:{title:'CSS 美化助手',icon:'🎨',quick:'设计可直接保存的 CSS',placeholder:'告诉我你想把咪嘛馆 / 状态栏美化成什么样……'}
  };
  const DEFAULTS={
    regex:{model:'',temperature:.3,stream:true,maxTokens:0,persona:'你是谨慎、精确、特别擅长 JavaScript RegExp 与提示词压缩的前端工具设计师。',style:'优先给可直接使用的结果；命名清楚；避免脆弱的超长正则；对动态字段使用捕获组。'},
    preset:{model:'',temperature:.65,stream:true,maxTokens:0,persona:'你是高级 AIRP 提示词 / 预设设计师，擅长把模糊审美要求写成可执行的模型约束。',style:'高信息密度、少废话、规则结构清晰；不擅自删减用户已有要求。'},
    css:{model:'',temperature:.7,stream:true,maxTokens:0,persona:'你是移动端视觉设计师与 CSS 专家，擅长轻盈玻璃、二次元与小说阅读界面的精细美化。',style:'优先兼容 iOS Safari；只写 CSS；避免破坏布局、按钮可点击性和 Safe HTML。'}
  };
  let storedOriginal=null,storageProblem=null,damagedRaw=null,storedEnvelope={},storageRevision=null,loadingState=null;
  let state=loadState();
  let activeType='regex',renderedType=null;
  let assistantCssTail=Promise.resolve(),assistantCssLease=null,assistantCssKey='',assistantCssIntent=0;
  let controller=null;
  let generating=false,stateOperationBusy=false,stateOperationDone=Promise.resolve(),finishStateOperation=null;
  let draftAssistantText='';
  let cachedModels=[];
  let nextQuickMode='';
  let generationMode='send';
  let regeneratingIndex=-1;
  let editingIndex=-1;
  let assistantFollowTail=true;
  let generationEpoch=0; // Late replies from aborted/restored sessions may never rewrite new data.

  function clone(v){return JSON.parse(JSON.stringify(v));}
  function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));}
  function clampTemp(v,fallback=.5){const n=Number(v);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):fallback;}
  function loadState(){
    let raw={},original=null;storageProblem=null;damagedRaw=null;
    try{
      original=localStorage.getItem(STORAGE_KEY);
      if(original!==null){
        raw=JSON.parse(original);
        // Earlier legitimate saves always include both sections. A partly
        // written/truncated document cannot safely be interpreted as empty.
        if(!raw||typeof raw!=='object'||Array.isArray(raw)||!raw.profiles||typeof raw.profiles!=='object'||Array.isArray(raw.profiles)||!raw.threads||typeof raw.threads!=='object'||Array.isArray(raw.threads)||TYPES.some(type=>!Array.isArray(raw.threads[type])))
          throw Error('助手历史内容不完整');
      }
      if(original!==null)verifyState(raw);
      storedOriginal=original;storedEnvelope=raw;
    }catch(error){
      // Never transform corrupt JSON (or storage access failure) into a new
      // empty history. Keep the byte-for-byte original available for rescue.
      storageProblem=error?.message||String(error);damagedRaw=original;
      storedOriginal=original;storedEnvelope={};raw={};
    }
    return normalizeState(raw);
  }
  function normalizeState(raw={}){
    const profiles={},threads={};
    for(const type of TYPES){
      const profile={...DEFAULTS[type],...(raw.profiles?.[type]||{})};
      profile.temperature=clampTemp(profile.temperature,DEFAULTS[type].temperature);
      profile.maxTokens=Math.max(0,Math.min(131072,Math.floor(Number(profile.maxTokens)||0)));
      profile.stream=profile.stream!==false;profile.sendTemperature=profile.sendTemperature!==false;
      profile.capacityProfiles={...(profile.capacityProfiles||{})};
      // Import the former scalar once, under its original endpoint/model only.
      // A subsequent explicit 'inherit' must never resurrect that old override.
      if(profile.capacityMapVersion!==1){
        const n=Number(profile.contextWindowTokens),id=profile.contextWindowIdentity;
        if(typeof id==='string'&&id&&Number.isSafeInteger(n)&&n>=4096&&!Object.hasOwn(profile.capacityProfiles,id))profile.capacityProfiles[id]=n;
        profile.capacityMapVersion=1;
      }
      profiles[type]=profile;threads[type]=Array.isArray(raw.threads?.[type])?raw.threads[type]:[];
    }
    return {...raw,profiles,threads,tasks:Object.fromEntries(TYPES.map(type=>[type,{...emptyTask(),...raw.tasks?.[type]}])),ui:{...raw.ui,configOpen:!!raw.ui?.configOpen,cssPresetId:String(raw.ui?.cssPresetId||'')}};
  }
  function verifyState(raw){
    for(const p of Object.values(raw?.profiles||{}))if(p?.capacityProfiles!==undefined&&(!p.capacityProfiles||typeof p.capacityProfiles!=='object'||Array.isArray(p.capacityProfiles)||Object.entries(p.capacityProfiles).some(([id,n])=>!id||!Number.isSafeInteger(n)||n<4096)))throw Error('助手模型容量映射损坏，原数据未覆盖');
    if(raw?.tasks&&TYPES.some(type=>raw.tasks[type]&&(!Array.isArray(raw.tasks[type].versions)||raw.tasks[type].versions.some(v=>!v||typeof v.content!=='string'||typeof v.id!=='string')||Object.values(raw.tasks[type].current||{}).some(id=>!raw.tasks[type].versions.some(v=>v.id===id)))))throw Error('助手任务资料的版本引用损坏，原数据未覆盖');
    if(!raw||typeof raw.profiles!=='object'||!raw.profiles||!raw.threads||
      raw.recoveryBranches!==undefined&&!Array.isArray(raw.recoveryBranches)||
      TYPES.some(type=>!Array.isArray(raw.threads[type])||raw.threads[type].some(row=>!row||typeof row.content!=='string')))
      throw Error('助手历史记录结构不完整');
    return raw;
  }
  function openSaveGuard(){
    if(saveGuardDBPromise)return saveGuardDBPromise;
    saveGuardDBPromise=new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){reject(Error('E_ASSISTANT_GUARD_UNAVAILABLE'));return;}
      const request=indexedDB.open(SAVE_GUARD_DB,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('guard'))request.result.createObjectStore('guard');};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();saveGuardDBPromise=null;loadingState=null;storageProblem='助手存储事务版本已改变，请重新打开助手';};resolve(request.result);};
      request.onerror=()=>{saveGuardDBPromise=null;reject(request.error||Error('E_ASSISTANT_GUARD_OPEN'));};
      request.onblocked=()=>{saveGuardDBPromise=null;reject(Error('E_ASSISTANT_GUARD_BLOCKED'));};
    });
    return saveGuardDBPromise;
  }
  const stateKey='assistant-state-v2',recoveryKey='assistant-recovery-v2';
  const threadKey=type=>'assistant-thread-v2:'+type;
  const taskKey=type=>'assistant-task-v1:'+type;
  function emptyTask(){return {versions:[],current:{},segmentStart:0};}
  async function readDurableRecords(){
    const db=await openSaveGuard();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('guard','readonly'),store=tx.objectStore('guard');
      const head=store.get(stateKey),recovery=store.get(recoveryKey),reads=TYPES.map(type=>store.get(threadKey(type))),tasks=TYPES.map(type=>store.get(taskKey(type)));
      tx.oncomplete=()=>resolve({head:head.result,recoveryBranches:recovery.result,threads:Object.fromEntries(TYPES.map((type,i)=>[type,reads[i].result])),tasks:Object.fromEntries(TYPES.map((type,i)=>[type,tasks[i].result]))});
      tx.onabort=()=>reject(tx.error||Error('助手历史读取失败'));
    });
  }
  async function readDurable(){
    const saved=await readDurableRecords(),head=saved.head;
    if(head===undefined){
      if(TYPES.some(type=>saved.threads[type]!==undefined))throw Error('助手记录缺少版本索引，原线程仍在，请导出救援记录');
      return null;
    }
    if(head.version!==2||!Number.isSafeInteger(head.revision))throw Error('助手保存版本无法核实');
    const {version,revision,taskRecords,...data}=head;
    if(taskRecords===1&&TYPES.some(type=>!saved.tasks[type]||!Array.isArray(saved.tasks[type].versions)))throw Error('助手任务资料读取不完整，未用空资料覆盖');
    return {revision,data:verifyState({...data,tasks:taskRecords===1?saved.tasks:data.tasks,threads:saved.threads}),recoveryBranches:saved.recoveryBranches};
  }
  function retainRecoveryBranch(branch){
    const record={...clone(branch),id:branch.id||'recovery-'+(globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random())};
    unsavedRescue.push(record);
    return persistRecoveryRecord(record);
  }
  function persistRecoveryRecord(record){
    pendingRecovery.set(record.id,record);
    const task=recoveryQueue.then(async()=>{
      const db=await openSaveGuard();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('guard','readwrite'),store=tx.objectStore('guard'),read=store.get(recoveryKey);let problem;
        read.onsuccess=()=>{try{const previous=read.result;if(previous!==undefined&&!Array.isArray(previous))throw Error('救援记录结构损坏，未覆盖原件');const existing=previous?.find(row=>row.id===record.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(record))throw Error('救援记录身份冲突，未覆盖原件');if(!existing)store.put([...(previous||[]),record],recoveryKey);}catch(error){problem=error;tx.abort();}};
        tx.oncomplete=()=>resolve(record.id);tx.onabort=()=>reject(problem||tx.error||Error('未能保存救援内容'));
      });
    });
    recoveryQueue=task.then(()=>{pendingRecovery.delete(record.id);if(!pendingRecovery.size)recoveryWriteProblem=null;},error=>{recoveryWriteProblem=error.message;storageProblem='救援分支尚未保全：'+error.message;recoveryNotice='未保存内容仍保留在本页，保全写入失败，请先导出救援记录：'+error.message;notify(recoveryNotice);});
    return task;
  }
  async function loadDurable(){
    const saved=await readDurable();
    if(!saved){storageRevision=null;state=loadState();if(storageProblem)throw Error(storageProblem);}
    else{storageRevision=saved.revision;state=normalizeState(saved.data);delete state.taskRecords;storageProblem=pendingRecovery.size?'救援分支尚未保全：'+recoveryWriteProblem:null;persistedRecoveryCount=Array.isArray(saved.recoveryBranches)?saved.recoveryBranches.length:0;if(persistedRecoveryCount&&!pendingRecovery.size)recoveryNotice='有 '+persistedRecoveryCount+' 份保留的未保存内容，可从救援导出取回。';}
    confirmedState=snapshotState(null);
  }
  function ensureState(){
    if(!loadingState)loadingState=loadDurable().catch(error=>{
      loadingState=null;storageProblem=error.message;throw error;
    });
    return loadingState;
  }
  // Three-way recovery is exceptional work, never part of a slider event.
  // A conflicting local branch is kept separately; it cannot replace live history.
  function beginStateOperation({stopActive=false}={}){
    if(stateOperationBusy)return false;
    if(generating&&!stopActive)throw Error('请先停止或结算正在生成的助手回复');
    stateOperationBusy=true;stateOperationDone=new Promise(resolve=>finishStateOperation=resolve);captureComposer(true);
    const edited=editingIndex>=0?document.getElementById('assistant-edit-'+editingIndex):null;
    if(edited&&edited.value!==thread()[editingIndex]?.content)void retainRecoveryBranch({capturedAt:new Date().toISOString(),reason:'unsaved_history_edit',type:activeType,messageIndex:editingIndex,content:String(edited.value),originalContent:thread()[editingIndex]?.content||''}).catch(()=>{});
    retainInterruptedDraft();editingIndex=-1;regeneratingIndex=-1;generationMode='send';generationEpoch++;
    controller?.abort();controller=null;generating=false;draftAssistantText='';
    try{render();}catch(error){stateOperationBusy=false;finishStateOperation?.();finishStateOperation=null;throw error;}return true;
  }
  function endStateOperation(){stateOperationBusy=false;try{render();}finally{finishStateOperation?.();finishStateOperation=null;}}
  async function recoverState(){
    if(!beginStateOperation({stopActive:true}))return {status:'BUSY',error:'正在重新读取助手记录'};
    try{

    captureComposer(true);
    await flushProfileSave();await saveQueue;await recoveryQueue;
    const local=snapshotState(null),base=confirmedState,hadProblem=!!storageProblem;
    try{
      for(const record of [...pendingRecovery.values()])await persistRecoveryRecord(record);
      await loadDurable();
      const fresh=state,changedThreads=[],conflicts=[];
      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      if(base){
        for(const type of TYPES){
          for(const key of new Set([...Object.keys(base.profiles[type]),...Object.keys(local.profiles[type])])){
            const old=base.profiles[type][key],mine=local.profiles[type][key],latest=fresh.profiles[type][key];
            if(same(mine,old))continue;
            if(same(latest,old)||same(latest,mine))fresh.profiles[type][key]=mine;else conflicts.push(type+' / '+key);
          }
          if(!same(local.tasks?.[type],base.tasks?.[type])){
            if(same(fresh.tasks[type],base.tasks?.[type])||same(fresh.tasks[type],local.tasks[type])){fresh.tasks[type]=local.tasks[type];changedThreads.push(type);}else conflicts.push(META[type].title+'任务资料');
          }
          if(!same(local.threads[type],base.threads[type])){
            if(same(fresh.threads[type],base.threads[type])||same(fresh.threads[type],local.threads[type])){
              fresh.threads[type]=local.threads[type];changedThreads.push(type);
            }else conflicts.push(META[type].title+'聊天');
          }
        }
        for(const key of Object.keys(local.ui))if(!same(local.ui[key],base.ui[key])){
          if(same(fresh.ui[key],base.ui[key]))fresh.ui[key]=local.ui[key];else if(!same(fresh.ui[key],local.ui[key]))conflicts.push('界面 / '+key);
        }
      }
      if(conflicts.length||!base&&hadProblem)await retainRecoveryBranch({capturedAt:new Date().toISOString(),reason:'concurrent_edit',conflicts,data:local});
      if(pendingRecovery.size)throw Error('仍有救援分支未完成保全，请导出原始救援记录');
      if(conflicts.length)recoveryNotice='已重新读取最新记录；发生冲突的本页内容完整保留在救援导出中：'+conflicts.join('、');
      else recoveryNotice='已重新核实持久记录，本页未保存的修改已恢复。';
      storageProblem=null;loadingState=Promise.resolve();
      if(base){await saveState(changedThreads.length?null:'');}
      render();return {status:conflicts.length?'RECOVERED_WITH_LOCAL_BRANCH':'RECOVERED',conflicts};
    }catch(error){state=local;confirmedState=base;try{await retainRecoveryBranch({capturedAt:new Date().toISOString(),reason:'recovery_failed',data:local});}catch(_){}storageProblem=error.message;loadingState=null;render();return {status:'FAILED',error:error.message};}
      }finally{endStateOperation();}
  }
  async function lockedSave(snapshot,type,{onlyIfEmpty=false,recoveryBranches}={}){
    if(storageProblem)throw Error('助手历史读取未确认：'+storageProblem);
    const db=await openSaveGuard();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('guard','readwrite'),store=tx.objectStore('guard');
      const request=store.get(stateKey);
      let committed=null,problem=null,preserved=false;
      request.onsuccess=()=>{
        try{
          const head=request.result;
          if(onlyIfEmpty&&(head||localStorage.getItem(STORAGE_KEY)!==null)){preserved=true;return;}
          if((head?.revision??null)!==storageRevision||
            (!head&&localStorage.getItem(STORAGE_KEY)!==storedOriginal))throw Error('E_ASSISTANT_STALE_STATE');
          committed=(head?.revision||0)+1;
          const {threads,tasks,...meta}=snapshot;
          store.put({...meta,taskRecords:1,version:2,revision:committed},stateKey);
          for(const key of (!head||head.taskRecords!==1||type===null?TYPES:type?[type]:[]))if(tasks[key]||!head||head.taskRecords!==1)store.put(tasks[key]||state.tasks[key],taskKey(key));
          for(const key of (head&&type!==null?(type?[type]:[]):TYPES))store.put(threads[key],threadKey(key));
          if(recoveryBranches!==undefined){const read=store.get(recoveryKey);read.onsuccess=()=>{try{if(!Array.isArray(recoveryBranches)||read.result!==undefined&&!Array.isArray(read.result))throw Error('救援记录无法核实，未覆盖');const rows=[...(read.result||[])];for(const row of recoveryBranches)if(!row.id||!rows.some(previous=>previous.id===row.id))rows.push(row);store.put(rows,recoveryKey);}catch(error){problem=error;tx.abort();}};}
        }catch(error){problem=error;tx.abort();}
      };
      tx.oncomplete=()=>{
        if(preserved){resolve({status:'PRESERVED'});return;}
        if(committed===null){reject(Error('助手记录未提交'));return;}
        storageRevision=committed;confirmedState={...snapshot,tasks:{...confirmedState?.tasks,...snapshot.tasks},threads:{...confirmedState?.threads,...snapshot.threads}};resolve({status:'SAVED',revision:committed});
      };
      tx.onabort=()=>reject(problem||tx.error||Error('助手记录未提交'));
    });
  }
  function snapshotState(type){
    const {threads,tasks,...meta}=state;
    const selected=type===null?TYPES:type?[type]:[];
    const copies=Object.fromEntries(selected.map(key=>[key,typeof structuredClone==='function'?structuredClone(threads[key]):clone(threads[key])]));
    // The migration transaction can need all three threads even for a prefs edit.
    return {...meta,profiles:Object.fromEntries(TYPES.map(key=>[key,{...state.profiles[key]}])),ui:{...state.ui},
      tasks:Object.fromEntries(selected.filter(key=>type===null||!confirmedState?.tasks?.[key]||tasks[key].revision!==confirmedState.tasks[key].revision).map(key=>[key,clone(tasks[key])])),threads:copies};
  }
  function saveState(type=activeType){
    const snapshot=snapshotState(storageRevision===null?null:type);
    const job=saveQueue.then(()=>lockedSave(snapshot,type)).catch(error=>{
      storageProblem=error.message==='E_ASSISTANT_STALE_STATE'?'其他窗口已更新助手记录，请重新打开':error.message;
      notify('助手记录尚未保存：'+storageProblem);throw error;
    });
    saveQueue=job.catch(()=>{});
    return job;
  }
  async function exportPortableState(){
    if(stateOperationBusy||generating)throw Error('助手正在生成或恢复，请完成本次操作后再做完整备份；当前内容仍保留在本页');
    if(storageProblem||pendingRecovery.size||recoveryWriteProblem)throw Error('助手最新修改尚未完整提交，完整备份未生成；请重新读取并恢复保存，或导出原始数据救援以保留本页最新内容。'+(storageProblem||recoveryWriteProblem||''));
    await ensureState();
    await flushProfileSave();await saveQueue;await recoveryQueue;
    if(storageProblem||pendingRecovery.size||recoveryWriteProblem||JSON.stringify(snapshotState(null))!==JSON.stringify(confirmedState))throw Error('助手最新修改尚未完整提交，完整备份未生成；请重新读取并恢复保存，或导出原始数据救援以保留本页最新内容。'+(storageProblem||recoveryWriteProblem||''));
    const saved=await readDurable();
    if(storageProblem||pendingRecovery.size||JSON.stringify(snapshotState(null))!==JSON.stringify(confirmedState))throw Error('备份读取期间助手内容发生变化或尚未保全，完整备份未生成；最新内容仍保留在本页及原始救援导出中');
    if(saved){if(saved.recoveryBranches!==undefined&&!Array.isArray(saved.recoveryBranches))throw Error('救援记录损坏，请使用原始数据救援导出');if(saved.revision<storageRevision||unsavedRescue.some(row=>!saved.recoveryBranches?.some(stored=>stored.id===row.id&&JSON.stringify(stored)===JSON.stringify(row))))throw Error('助手保存或救援收据未核实，完整备份未生成，请导出原始数据救援');return JSON.stringify({...saved.data,...(saved.recoveryBranches?.length?{recoveryBranches:saved.recoveryBranches}:{})});}
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw!==null)verifyState(JSON.parse(raw));
    return raw;
  }
  function validatePortableState(raw){return verifyState(typeof raw==='string'?JSON.parse(raw):raw);}
  async function restorePortableState(raw,options={}){
    if(!beginStateOperation())throw Error('助手记录正在重新读取，请稍后再恢复');
    let local=null,base=null;
    try{
    const {recoveryBranches,...portable}=validatePortableState(raw);
    if(recoveryBranches!==undefined&&!Array.isArray(recoveryBranches))throw Error('备份中的救援记录无效');
    const incoming=normalizeState(portable);
    await flushProfileSave();await saveQueue;await recoveryQueue;
    if(generating)throw Error('请先结算正在生成的助手回复');
    local=snapshotState(null);base=confirmedState;
    if(base&&JSON.stringify(local)!==JSON.stringify(base))await retainRecoveryBranch({capturedAt:new Date().toISOString(),reason:'before_backup_restore',data:local});
    // Read the exact current revision for the explicit restore action.
    await loadDurable();
    const result=await lockedSave(clone(incoming),null,{...options,recoveryBranches});
    if(result.status==='SAVED'){state=incoming;loadingState=Promise.resolve();render();}
    return result;
    }catch(error){
      if(local){state=local;confirmedState=base;loadingState=null;storageProblem=error.message;try{await retainRecoveryBranch({capturedAt:new Date().toISOString(),reason:'backup_restore_failed',data:local});}catch(_){}}
      throw error;
      }finally{endStateOperation();}
  }
  async function previewPortableRestore(raw,{onlyIfEmpty=true}={}){
    validatePortableState(raw);await flushProfileSave();await saveQueue;await recoveryQueue;
    const saved=await readDurable();
    const legacy=localStorage.getItem(STORAGE_KEY);
    return {status:onlyIfEmpty&&(saved||legacy!==null)?'PRESERVED':'READY',
      authority:saved?'indexeddb':legacy!==null?'legacy':'empty',revision:saved?.revision??null};
  }
  async function exportRawState(){
    let current=null,currentReadError=null,legacy=null,legacyReadError=null;
    try{current=await readDurableRecords();}catch(error){currentReadError=error.message;}
    try{legacy=localStorage.getItem(STORAGE_KEY);}catch(error){legacyReadError=error.message;}
    const raw=JSON.stringify({format:'mima-assistant-rescue',version:1,exportedAt:new Date().toISOString(),
      current:{authority:'indexeddb',records:current,readError:currentReadError},
      legacyMigrationBackup:{authority:'legacy-backup',raw:legacy,readError:legacyReadError},
      unsaved:{data:snapshotState(null),branches:unsavedRescue,pendingRecoveryIds:[...pendingRecovery.keys()],saveError:storageProblem,recoveryError:recoveryWriteProblem,stream:draftAssistantText,
        composers:Object.fromEntries(TYPES.map(type=>[type,MimaUiDrafts.get('assistant:'+type)]))}},null,2);
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='咪嘛馆_助手数据救援.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    return raw;
  }
  function flushProfileSave(){
    if(!profileSaveTimer)return Promise.resolve();
    clearTimeout(profileSaveTimer);profileSaveTimer=null;
    const waiters=profileSaveWaiters;profileSaveWaiters=[];
    return saveState('').then(result=>{waiters.forEach(w=>w(result));return result;},error=>{waiters.forEach(w=>w({status:'FAILED',error:error.message}));return {status:'FAILED'};});
  }
  function scheduleProfileSave(){
    if(profileSaveTimer)clearTimeout(profileSaveTimer);
    profileSaveTimer=setTimeout(()=>{void flushProfileSave();},160);
    return new Promise(resolve=>profileSaveWaiters.push(resolve));
  }
  function profile(){return state.profiles[activeType];}
  function thread(){return state.threads[activeType];}
  function notify(msg){if(typeof window.toast==='function')window.toast(msg);else console.log(msg);}
  function formatTime(v){try{return new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}catch(_){return''}}

  // v1.1.5 Artifact Protocol V2: large regex/HTML/CSS payloads are transported as
  // segmented text blocks instead of one giant JSON string. Legacy V1 JSON remains readable.
  function extractArtifactV2(raw){
    const text=String(raw||'');
    const marker=text.match(/<MIMA_ARTIFACT_V2\b([^>]*)>([\s\S]*?)<\/MIMA_ARTIFACT_V2>/i);
    if(!marker)return {found:false,source:'',attrs:'',candidate:'',full:''};
    return {found:true,source:'v2',attrs:marker[1]||'',candidate:marker[2]||'',full:marker[0]};
  }
  function artifactV2Kind(attrs){
    const m=String(attrs||'').match(/\bkind\s*=\s*["']([^"']+)["']/i);
    return String(m?.[1]||'').trim();
  }
  function unwrapArtifactBlockValue(raw,{trim=true}={}){
    let text=String(raw??'');
    const cdata=text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i);
    if(/^\s*<!\[CDATA\[/.test(text)&&!cdata)throw Error('CDATA 内容包含未转义的 ]]> 或缺少正确结束符，请先安全编码再保存，原文未修改');
    if(cdata){
      text=cdata[1];
      if(text.startsWith('\r\n'))text=text.slice(2);else if(text.startsWith('\n'))text=text.slice(1);
      if(text.endsWith('\r\n'))text=text.slice(0,-2);else if(text.endsWith('\n'))text=text.slice(0,-1);
      return text;
    }
    return trim?text.trim():text;
  }
  function firstTaggedBlock(text,tag,{required=false,trim=true}={}){
    const re=new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i');
    const m=String(text||'').match(re);
    if(!m){if(required)throw new Error(`V2 工件缺少 <${tag}>`);return ''}
    return unwrapArtifactBlockValue(m[1],{trim});
  }
  function allTaggedBlocks(text,tag){
    const out=[],re=new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'ig');let m;
    while((m=re.exec(String(text||''))))out.push(m[1]);
    return out;
  }
  function artifactNumber(v,fallback=50){const raw=String(v??'').trim();if(!raw)return fallback;const n=Number(raw);return Number.isFinite(n)?n:fallback;}
  function artifactBool(v,fallback=true){const x=String(v??'').trim().toLowerCase();if(x==='true'||x==='1'||x==='yes')return true;if(x==='false'||x==='0'||x==='no')return false;return fallback;}
  function parseV2Preset(block){
    return {name:firstTaggedBlock(block,'NAME',{required:true}),type:firstTaggedBlock(block,'TYPE')||'style',description:firstTaggedBlock(block,'DESCRIPTION'),priority:artifactNumber(firstTaggedBlock(block,'PRIORITY'),50),content:firstTaggedBlock(block,'CONTENT',{required:true,trim:false})};
  }
  function parseV2RegexPack(block){
    const ruleBlocks=allTaggedBlocks(block,'RULE');
    const rules=ruleBlocks.map((ruleBlock,idx)=>({name:firstTaggedBlock(ruleBlock,'NAME')||`Rule ${idx+1}`,pattern:firstTaggedBlock(ruleBlock,'PATTERN',{required:true,trim:false}),replacement:firstTaggedBlock(ruleBlock,'REPLACEMENT',{required:true,trim:false}),flags:firstTaggedBlock(ruleBlock,'FLAGS')||'g',phase:firstTaggedBlock(ruleBlock,'PHASE')||'display',priority:artifactNumber(firstTaggedBlock(ruleBlock,'PRIORITY'),50),enabled:artifactBool(firstTaggedBlock(ruleBlock,'ENABLED'),true),description:firstTaggedBlock(ruleBlock,'DESCRIPTION')}));
    if(!rules.length)throw new Error('V2 Regex Bundle 没有任何 <RULE>');
    const header=String(block||'').replace(/<RULE\b[^>]*>[\s\S]*?<\/RULE>/ig,'');
    const contractBlock=firstTaggedBlock(header,'COMPACT_CONTRACT',{trim:false});
    let compactContract;
    if(contractBlock){
      const fields=allTaggedBlocks(contractBlock,'FIELD').map(block=>({
        name:firstTaggedBlock(block,'NAME',{required:true}),pattern:firstTaggedBlock(block,'PATTERN',{required:true,trim:false}),
        flags:firstTaggedBlock(block,'FLAGS'),groups:firstTaggedBlock(block,'GROUPS',{required:true}).split(',').map(x=>x.trim()).map(x=>/^\d+$/.test(x)?Number(x):x)
      }));
      const terminal=firstTaggedBlock(contractBlock,'END_MARKER');
      compactContract={version:Number(firstTaggedBlock(contractBlock,'VERSION',{required:true})),
        sample:firstTaggedBlock(contractBlock,'SAMPLE',{required:true,trim:false}),
        requiredSelectors:firstTaggedBlock(contractBlock,'SELECTORS',{required:true}),fields,...(terminal?{terminal}:{})};
    }
    return {name:firstTaggedBlock(header,'NAME',{required:true}),description:firstTaggedBlock(header,'DESCRIPTION'),priority:artifactNumber(firstTaggedBlock(header,'PRIORITY'),50),enabled:artifactBool(firstTaggedBlock(header,'ENABLED'),true),rules,...(compactContract?{compactContract}:{})};
  }
  function parseV2Artifact(raw){
    const extracted=extractArtifactV2(raw);if(!extracted.found)return {found:false,artifact:null,error:'',source:'',protocol:''};
    try{
      const kind=artifactV2Kind(extracted.attrs);if(!kind)throw new Error('V2 工件缺少 kind 属性');
      let artifact;
      if(kind==='regex_bundle')artifact={kind,preset:parseV2Preset(firstTaggedBlock(extracted.candidate,'PRESET',{required:true,trim:false})),regexPack:parseV2RegexPack(firstTaggedBlock(extracted.candidate,'REGEX_PACK',{required:true,trim:false}))};
      else if(kind==='preset')artifact={kind,preset:parseV2Preset(firstTaggedBlock(extracted.candidate,'PRESET',{required:true,trim:false}))};
      else if(kind==='css_preset'){
        const block=firstTaggedBlock(extracted.candidate,'CSS_PRESET',{required:true,trim:false});artifact={kind,cssPreset:{name:firstTaggedBlock(block,'NAME',{required:true}),scope:firstTaggedBlock(block,'SCOPE')||'story',surface:firstTaggedBlock(block,'SURFACE')||'',css:firstTaggedBlock(block,'CSS',{required:true,trim:false})}};
      }else throw new Error(`不支持的 V2 kind：${kind}`);
      return {found:true,artifact,error:'',source:'v2',protocol:'v2',repaired:false,repairLevel:'',full:extracted.full};
    }catch(e){return {found:true,artifact:null,error:e?.message||String(e),source:'v2',protocol:'v2',repaired:false,repairLevel:'',full:extracted.full};}
  }

  function extractArtifactCandidate(raw){
    const text=String(raw||'');
    const marker=text.match(/<MIMA_ARTIFACT>\s*([\s\S]*?)\s*<\/MIMA_ARTIFACT>/i);
    if(marker)return {found:true,source:'marker',candidate:marker[1],full:marker[0]};
    const fenced=text.match(/```json\s*([\s\S]*?)```/i);
    if(fenced)return {found:true,source:'fence',candidate:fenced[1],full:fenced[0]};
    return {found:false,source:'',candidate:'',full:''};
  }
  function escapeRawJsonControls(text){
    let out='',inString=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inString){
        if(escaped){out+=ch;escaped=false;continue}
        if(ch==='\\'){out+=ch;escaped=true;continue}
        if(ch==='"'){out+=ch;inString=false;continue}
        if(ch==='\n'){out+='\\n';continue}
        if(ch==='\r'){out+='\\r';continue}
        if(ch==='\t'){out+='\\t';continue}
        out+=ch;continue;
      }
      out+=ch;if(ch==='"')inString=true;
    }
    return out;
  }
  function removeTrailingJsonCommas(text){
    let out='',inString=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inString){out+=ch;if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch==='"')inString=false;continue}
      if(ch==='"'){inString=true;out+=ch;continue}
      if(ch===','){let j=i+1;while(j<text.length&&/\s/.test(text[j]))j++;if(text[j]==='}'||text[j]===']')continue}
      out+=ch;
    }
    return out;
  }
  // v1.1.4 Artifact Self-Healing: safe syntax repair only. Never eval model output.
  function stripLooseJsonComments(text){
    let out='',quote='',escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i],next=text[i+1];
      if(quote){out+=ch;if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch===quote)quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;out+=ch;continue}
      if(ch==='/'&&next==='/'){i+=2;while(i<text.length&&text[i]!=='\n'&&text[i]!=='\r')i++;if(i<text.length)out+=text[i];continue}
      if(ch==='/'&&next==='*'){i+=2;while(i<text.length-1&&!(text[i]==='*'&&text[i+1]==='/'))i++;i++;continue}
      out+=ch;
    }
    return out;
  }
  function quoteBareJsonKeys(text){
    let out='',quote='',escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quote){out+=ch;if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch===quote)quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;out+=ch;continue}
      out+=ch;
      if(ch!=='{'&&ch!==',')continue;
      let j=i+1,ws='';while(j<text.length&&/\s/.test(text[j])){ws+=text[j];j++}
      const m=text.slice(j).match(/^([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/);
      if(!m)continue;
      const key=m[1],colonIndex=j+m[0].lastIndexOf(':');
      out+=ws+JSON.stringify(key)+text.slice(j+key.length,colonIndex+1);
      i=colonIndex;
    }
    return out;
  }
  function decodeLooseSingleQuotedBody(body){
    let out='';
    for(let i=0;i<body.length;i++){
      const ch=body[i];if(ch!=='\\'){out+=ch;continue}
      const next=body[++i];if(next===undefined){out+='\\';break}
      const map={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
      if(Object.prototype.hasOwnProperty.call(map,next)){out+=map[next];continue}
      if(next==='\\'||next==="'"||next==='"'||next==='/'){out+=next;continue}
      if(next==='u'&&/^[0-9a-fA-F]{4}$/.test(body.slice(i+1,i+5))){out+=String.fromCharCode(parseInt(body.slice(i+1,i+5),16));i+=4;continue}
      // Unknown escapes are important in regex (e.g. \s). Preserve the slash.
      out+='\\'+next;
    }
    return out;
  }
  function convertSingleQuotedJsonStrings(text){
    let out='',inDouble=false,doubleEscaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inDouble){out+=ch;if(doubleEscaped){doubleEscaped=false;continue}if(ch==='\\'){doubleEscaped=true;continue}if(ch==='"')inDouble=false;continue}
      if(ch==='"'){inDouble=true;out+=ch;continue}
      if(ch!=="'"){out+=ch;continue}
      let body='',escaped=false,closed=false;
      for(i=i+1;i<text.length;i++){
        const c=text[i];
        if(escaped){body+='\\'+c;escaped=false;continue}
        if(c==='\\'){escaped=true;continue}
        if(c==="'"){closed=true;break}
        body+=c;
      }
      if(!closed){out+="'"+body;break}
      out+=JSON.stringify(decodeLooseSingleQuotedBody(body));
    }
    return out;
  }
  function escapeInvalidJsonBackslashes(text){
    let out='',inString=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(!inString){out+=ch;if(ch==='"')inString=true;continue}
      if(escaped){out+=ch;escaped=false;continue}
      if(ch==='"'){out+=ch;inString=false;continue}
      if(ch!=='\\'){out+=ch;continue}
      const next=text[i+1];
      if(next&&'"\\/bfnrt'.includes(next)){out+=ch;escaped=true;continue}
      if(next==='u'&&/^[0-9a-fA-F]{4}$/.test(text.slice(i+2,i+6))){out+=ch;escaped=true;continue}
      out+='\\\\';
    }
    return out;
  }
  function normalizeArtifactJson(raw){
    let text=String(raw||'').replace(/^\uFEFF/,'').replace(/\u00a0/g,' ').trim();
    text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)text=text.slice(first,last+1);
    text=escapeRawJsonControls(text);
    text=removeTrailingJsonCommas(text);
    return text.trim();
  }
  function repairLooseArtifactJson(raw){
    let text=String(raw||'').replace(/^\uFEFF/,'').replace(/\u00a0/g,' ').trim();
    text=text.replace(/^```(?:json|json5|javascript|js)?\s*/i,'').replace(/\s*```$/,'').trim();
    const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)text=text.slice(first,last+1);
    text=stripLooseJsonComments(text);
    text=quoteBareJsonKeys(text);
    text=convertSingleQuotedJsonStrings(text);
    text=escapeRawJsonControls(text);
    text=escapeInvalidJsonBackslashes(text);
    text=removeTrailingJsonCommas(text);
    return text.trim();
  }
  function parseArtifactDetailed(raw){
    const v2=parseV2Artifact(raw);if(v2.found)return v2;
    const extracted=extractArtifactCandidate(raw);if(!extracted.found)return {found:false,artifact:null,error:'',source:'',protocol:'',repaired:false,repairLevel:'',full:''};
    const candidates=[
      {text:String(extracted.candidate||'').trim(),repaired:false,repairLevel:'strict'},
      {text:normalizeArtifactJson(extracted.candidate),repaired:true,repairLevel:'safe'},
      {text:repairLooseArtifactJson(extracted.candidate),repaired:true,repairLevel:'self_heal'}
    ];
    const seen=new Set();let lastError='';
    for(const attempt of candidates){
      if(!attempt.text||seen.has(attempt.text))continue;seen.add(attempt.text);
      try{const obj=JSON.parse(attempt.text);if(obj&&typeof obj==='object'&&!Array.isArray(obj)&&obj.kind)return {found:true,artifact:obj,error:'',source:extracted.source,protocol:'v1',repaired:attempt.repaired,repairLevel:attempt.repairLevel,full:extracted.full};lastError='JSON 已解析，但缺少 kind 字段。'}catch(e){lastError=e?.message||String(e)}
    }
    return {found:true,artifact:null,error:lastError||'无法解析工件 JSON。',source:extracted.source,protocol:'v1',repaired:false,repairLevel:'',full:extracted.full};
  }
  function parseArtifact(raw){return parseArtifactDetailed(raw).artifact;}
  function visibleAssistantText(raw){let text=String(raw||'').replace(/<MIMA_ARTIFACT_V2\b[^>]*>[\s\S]*?<\/MIMA_ARTIFACT_V2>/ig,'').replace(/<MIMA_ARTIFACT>[\s\S]*?<\/MIMA_ARTIFACT>/ig,'');const cutV2=text.search(/<MIMA_ARTIFACT_V2\b/i),cutV1=text.search(/<MIMA_ARTIFACT>/i);const cuts=[cutV2,cutV1].filter(n=>n>=0);if(cuts.length)text=text.slice(0,Math.min(...cuts));return text.trim();}
  function artifactJsonProtocol(){return `【Legacy MIMA_ARTIFACT V1 兼容说明】\n咪嘛馆仍能读取旧的 <MIMA_ARTIFACT>{...JSON...}</MIMA_ARTIFACT> 历史工件，但新工件不要再使用巨大 JSON。不得使用 eval / Function 执行任何工件。`;}
  function artifactV2Protocol(){return `【MIMA_ARTIFACT_V2 · Zero-Escape 工件协议】\n大型 Regex / HTML / CSS 必须使用 V2 分段工件，禁止把整包重新塞进 JSON 字符串。\n\n通用硬规则：\n1. 最外层必须是 <MIMA_ARTIFACT_V2 kind="..."></MIMA_ARTIFACT_V2>。\n2. PATTERN / REPLACEMENT / CONTENT / CSS 的正文必须放在 <![CDATA[ ... ]]> 中；其中的双引号、反斜杠、HTML 标签、$1/$2 都按原文书写，不做 JSON 转义。\n3. 不要套 Markdown code fence。不要额外再输出 V1 JSON 工件。\n4. 名称、说明、flags、phase 等小字段写普通标签文本。\n5. Regex rule 顺序必须与设计顺序一致。\n6. Replacement 仍禁止 script、onerror/onload 等可执行代码。\n7. 输出前检查所有开始/结束标签成对。\n\nRegex Bundle 结构：\n<MIMA_ARTIFACT_V2 kind="regex_bundle">\n<PRESET>\n<NAME>名称</NAME><TYPE>format</TYPE><DESCRIPTION>说明</DESCRIPTION><PRIORITY>50</PRIORITY>\n<CONTENT><![CDATA[\n完整配套预设，可自由包含 \"、\\、HTML 示例\n]]></CONTENT>\n</PRESET>\n<REGEX_PACK>\n<NAME>正则包名称</NAME><DESCRIPTION>说明</DESCRIPTION><PRIORITY>50</PRIORITY><ENABLED>true</ENABLED>\n<RULE>\n<NAME>规则名</NAME>\n<PATTERN><![CDATA[\n浏览器 JavaScript RegExp pattern 原文\n]]></PATTERN>\n<REPLACEMENT><![CDATA[\n<div class="mima-panel">$1</div>\n]]></REPLACEMENT>\n<FLAGS>g</FLAGS><PHASE>display</PHASE><PRIORITY>50</PRIORITY><ENABLED>true</ENABLED><DESCRIPTION>说明</DESCRIPTION>\n</RULE>\n</REGEX_PACK>\n</MIMA_ARTIFACT_V2>\n\nPreset 使用 kind="preset" + <PRESET>...</PRESET>；CSS 使用 kind="css_preset" + <CSS_PRESET><NAME>...</NAME><SCOPE>novel</SCOPE><SURFACE>novel</SURFACE><CSS><![CDATA[...]]></CSS></CSS_PRESET>。`;}

  function baseSystem(type){
    if(type==='regex')return `${contractProtocol}\n\n你是“咪嘛馆 Regex 正则助手”。你帮助用户设计正则包，并把冗长 HTML 输出规范转换成“模型输出短协议 + 前端 display 正则展开完整 HTML”的省 Token 方案。\n\n硬规则：\n1. 不删除用户原有输出字段，只压缩重复 HTML 壳。\n2. 优先使用 phase=display，让 compact 原文保留在剧情 Prompt 中，完整 HTML 只在前端显示时展开。只有用户明确需要时才使用 input/prompt/output。\n3. 正则必须是浏览器 JavaScript RegExp 可用语法；flags 通常为 g 或 gi；replacement 可以使用 $1/$2。\n4. Replacement 只能是文本/HTML，不得包含 script、事件处理器或可执行代码。\n5. 如果用户提供 HTML 状态栏：先抽取真正动态字段，再设计短标签协议。协议应明显短于 HTML。\n6. “配套预设”必须明确告诉剧情模型只输出短协议，而不是完整 HTML。\n7. 需要交付可保存成果时，解释后输出且只输出一个 MIMA_ARTIFACT_V2 regex_bundle。大型 pattern / replacement / preset content 必须直接写在 CDATA 段中，绝对不要再手写巨大 JSON escape。`;
    if(type==='preset')return `你是“咪嘛馆 Preset 预设助手”。你负责写作/改写 AIRP 预设、文风规则、角色行为约束、输出格式协议与模型控制提示。\n\n硬规则：\n1. 用户已有规则一律保留，除非用户明确要求删除。\n2. 把审美要求转换成可执行、可判断、低歧义的提示词；避免空泛“写得更好”。\n3. 可以设计 style / format / behavior / model 类型预设。\n4. 需要交付可保存预设时，使用 MIMA_ARTIFACT_V2 kind="preset"；完整预设内容直接放 CONTENT 的 CDATA，不做 JSON escape。`;
    return `你是“咪嘛馆 CSS 美化助手”。你负责为咪嘛馆 UI、剧情区域与 Safe HTML 状态栏设计纯 CSS。\n\n硬规则：\n1. 只生成 CSS，不使用 JavaScript，不要求修改旧 HTML 结构，除非用户明确说可以。\n2. 默认移动端/iOS Safari 优先，保持按钮可点、文字可读、输入框可用。\n3. 若用户给现有 CSS，优先增量覆盖，不顺手重构或删掉正常规则。\n4. scope 可选 story（自定义 HTML/剧情内容）、global（剧情聊天区域）、app（全局 UI + HTML）、novel（Novel Studio）、assistant（Assistant Studio）。Novel 稳定 selector：.novel-studio-root / .novel-reader / .novel-sidebar / .novel-inspector / .novel-draft / .novel-memory-card / .novel-director-box；稳定 token：--reader-bg / --reader-text / --reader-muted / --reader-line。\n5. 内置主题位于 Core CSS 层，自定义 CSS 应作为最后覆盖层；不要依赖 nth-child 等脆弱选择器。\n6. 需要交付可保存 CSS 时，使用 MIMA_ARTIFACT_V2 kind="css_preset"；CSS 直接放 CSS 的 CDATA，不做 JSON escape。`;
  }
  const contractProtocol='短协议转换才加入 <COMPACT_CONTRACT>，放在 REGEX_PACK 标题之后、RULE 之前。包含 <VERSION>2</VERSION>、<SAMPLE><![CDATA[一份包含所有动态字段的真实短协议样例]]></SAMPLE>、<SELECTORS>展开后必需的唯一元素选择器，用逗号分隔</SELECTORS> 和一个或多个 <FIELD><NAME>字段名称</NAME><PATTERN><![CDATA[能验证完整原始字段及结束边界的正则]]></PATTERN><FLAGS></FLAGS><GROUPS>1,2</GROUPS></FIELD>。GROUPS 是必须非空的捕获组序号或名称。用户要求编号格式的单轮结束控制时，加入 <END_MARKER>最后一个外层结束行</END_MARKER>。配套 CONTENT 中给出开闭栏目、逐行的两位记录编号及 ¦ 分隔的〈字段〉说明，各栏完整，正文位置写作〔角色正文：…〕。普通替换规则省略 COMPACT_CONTRACT。CONTENT 只放可直接注入的剧情输出格式。';
  function systemPrompt(type){const p=state.profiles[type];return `${baseSystem(type)}\n\n${artifactV2Protocol()}\n\n${artifactJsonProtocol()}\n\n【助手 Persona】\n${p.persona||'(无额外 persona)'}\n\n【设计风格】\n${p.style||'(无额外风格)'}`;}
  function quickInstruction(type){
    if(type==='regex')return '【快捷任务：HTML 状态栏 → 正则省 Token】请把我下面提供的输出规范中重复、冗长的 HTML 壳转换为短协议，并生成配套 format 预设 + display 正则包。动态字段必须完整保留。务必输出 MIMA_ARTIFACT_V2 regex_bundle 工件。';
    if(type==='preset')return '【快捷任务：生成可保存预设】请把我的需求写成一个可以直接挂载到咪嘛馆的预设，并输出 MIMA_ARTIFACT_V2 preset 工件。';
    return '【快捷任务：生成可保存 CSS】请按我的要求设计一份可直接保存的咪嘛馆 CSS Preset，并输出 MIMA_ARTIFACT_V2 css_preset 工件。';
  }

  function captureComposer(flush=false){
    const input=document.getElementById('assistant-input');if(!input||!renderedType)return;
    const key='assistant:'+renderedType,previous=MimaUiDrafts.get(key);
    const value={text:input.value,start:input.selectionStart,end:input.selectionEnd,scroll:input.scrollTop};
    if(!previous||previous.text!==value.text||previous.start!==value.start||previous.end!==value.end)MimaUiDrafts.put(key,value,{immediate:flush});else if(flush)MimaUiDrafts.flush(key);
  }
  function cssPickerHtml(){const presets=(window.MimaTavernBridge?.getCssPresets?.()||[]).filter(p=>p.scope==='assistant'||p.surface==='assistant');return `<label class="form-label" for="assistant-css-choice">助手外观</label><select id="assistant-css-choice" class="field" onchange="MimaAssistantStudio.applyCssPreset(this.value)"><option value="">使用默认外观</option>${presets.map(p=>`<option value="${esc(p.id)}" ${state.ui.cssPresetId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`;}
  function applyCssPreset(id,{restore=false}={}){
    const intent=++assistantCssIntent;
    const run=async()=>{
      await ensureState();
      if(intent!==assistantCssIntent)return {status:'STALE'};
      const panel=document.querySelector('.assistant-studio-panel');
      let tag=document.getElementById('assistant-custom-css');
      if(!tag){tag=document.createElement('style');tag.id='assistant-custom-css';document.head.append(tag);}
      const priorCss=tag.textContent,priorId=state.ui.cssPresetId;
      let prepared=null,painted=false,committed=false;
      try{
        const bypass=window.MimaCssRecoveryBypass===true||new URLSearchParams(location.search).get('noCss')==='1';
        if(bypass&&id&&!restore)throw Error('当前停用了自定义外观');
        const meta=id&&!bypass?(window.MimaTavernBridge.getCssPresets().find(p=>p.id===id)):null;
        const key=meta?JSON.stringify([id,meta.contentHash,meta.contentRevision]):'';
        if(restore&&key===assistantCssKey&&(!id||meta||bypass))return {status:'APPLIED'};
        let css='';
        if(id&&!bypass){
          if(!meta&&restore){
            tag.textContent='';assistantCssLease?.release();assistantCssLease=null;assistantCssKey='';
            throw Error('已选助手外观不在资料库中，可重新选择');
          }
          const result=await MimaStandalone.handle('/css-presets/'+encodeURIComponent(id)+'/content','GET');
          const preset=result.data;
          if(!result.success||!(preset.scope==='assistant'||preset.surface==='assistant'))throw Error(result.msg||'这份外观不属于助手');
          prepared=await MimaCssResources.prepare(preset.css);
          css=window.MimaTavernBridge.compileCustomCss({...preset,css:prepared.css},'assistant');
          const latest=await MimaStandalone.handle('/css-presets/'+encodeURIComponent(id)+'/content','GET');
          if(!latest.success||MimaStandalone.cssSelectionIdentity(latest.data)!==MimaStandalone.cssSelectionIdentity(preset))throw Error('外观在准备期间更新，请重新选择');
        }
        if(intent!==assistantCssIntent)return {status:'STALE'};
        tag.textContent=css;painted=true;
        if(panel){
          const computed=getComputedStyle(panel);
          if(computed.display==='none'||computed.visibility==='hidden'||Number(computed.opacity)<.01)
            throw Error('此样式使助手主界面不可见');
        }
        if(!restore){state.ui.cssPresetId=id;await saveState('');committed=true;}
        prepared?.accept();assistantCssLease?.release();assistantCssLease=prepared;prepared=null;assistantCssKey=key;
        const select=document.getElementById('assistant-css-choice');
        if(select)select.value=state.ui.cssPresetId;
        return {status:'APPLIED',id};
      }catch(error){
        if(painted)tag.textContent=priorCss;
        if(!restore&&!committed)state.ui.cssPresetId=priorId;
        const select=document.getElementById('assistant-css-choice');if(select)select.value=state.ui.cssPresetId;
        notify('助手外观未应用：'+error.message);
        return {status:'FAILED',error:error.message};
      }finally{prepared?.discard();}
    };
    const job=assistantCssTail.then(run,run);assistantCssTail=job.catch(()=>{});
    return job.catch(error=>({status:'FAILED',error:error.message}));
  }
  function syncCssCatalog(){
    const select=document.getElementById('assistant-css-choice');
    if(select){
      const temp=document.createElement('template');temp.innerHTML=cssPickerHtml();
      select.replaceChildren(...temp.content.querySelector('select').childNodes);
      select.value=state.ui.cssPresetId;
    }
    if(!document.getElementById('assistant-modal')?.classList.contains('hidden'))
      return applyCssPreset(state.ui.cssPresetId,{restore:true});
  }
  async function open(type='regex'){
    if(stateOperationBusy)await stateOperationDone;
    if(storageProblem&&!generating)await recoverState();
    else try{await ensureState();}catch(error){notify('助手历史读取失败：'+error.message);}
    if(generating&&TYPES.includes(type)&&type!==activeType){notify('当前助手尚在生成。请先停止或完成本轮，再切换工具；旧回复不会写入其他助手。');return;}
    if(TYPES.includes(type))activeType=type;
    const modal=document.getElementById('assistant-modal');if(!modal)return;
    modal.classList.remove('hidden');nextQuickMode='';assistantFollowTail=true;render();void applyCssPreset(state.ui.cssPresetId,{restore:true});
  }
  function close(){captureComposer(true);retainInterruptedDraft();void flushProfileSave();generationEpoch++;if(controller)controller.abort();controller=null;generating=false;draftAssistantText='';generationMode='send';regeneratingIndex=-1;editingIndex=-1;document.getElementById('assistant-modal')?.classList.add('hidden');}
  function switchType(type){if(!TYPES.includes(type)||generating||stateOperationBusy)return;activeType=type;nextQuickMode='';draftAssistantText='';editingIndex=-1;assistantFollowTail=true;render();}
  function setQuickMode(){if(stateOperationBusy)return;nextQuickMode=activeType;render();setTimeout(()=>document.getElementById('assistant-input')?.focus(),20);}

  const taskKinds={template:'原始模板',fields:'字段表',plan:'当前方案',published:'已发布版本'};
  function taskContext(){const task=state.tasks[activeType];return {start:task.segmentStart||0,...(Number.isSafeInteger(task.segmentBoundary)?{boundary:task.segmentBoundary}:{}),refs:{...task.current}};}
  function nextTaskSequence(){state.ui.taskSequence=Math.max(Date.now(),Number(state.ui.taskSequence||0)+1);return state.ui.taskSequence;}
  function assistantConfig(overrides={}){
    const p=profile(),story=window.MimaStandalone.getApiConfig(),model=(p.model||story.model||'').trim(),identity=window.MimaStandalone.apiCapacityIdentity({...story,model});
    const capacity=Number(p.capacityProfiles?.[identity])||0,maxTokens=Number(p.maxTokens)||0;
    const cfg=window.MimaStandalone.effectiveRequestConfig({...story,model,temperature:p.temperature,stream:p.stream,sendTemperature:p.sendTemperature!==false,
      // Output is always owned by this assistant, including the deliberate 0.
      outputLimitMode:'global',globalMaxTokens:maxTokens,maxTokens,
      ...(capacity?{modelCapacityProfiles:{...story.modelCapacityProfiles,[identity]:capacity},contextWindowIdentity:identity,contextWindowTokens:capacity}:{}),...overrides});
    cfg.assistantCapacityOverride=capacity;cfg.assistantCapacitySource=capacity?'independent':cfg.contextWindowTokens?'inherited':'unknown';return cfg;
  }
  function requestCapacity(messages,cfg){
    const estimatedInputTokens=messages.reduce((n,m)=>n+Math.ceil(m.content.length/2.5)+8,0),windowTokens=Number(cfg.contextWindowTokens)||0,reservedOutputTokens=Number(cfg.maxTokens)>0?Number(cfg.maxTokens):Math.max(1024,Math.min(4096,Math.floor(windowTokens*.5)));
    return {messages,cfg,estimatedInputTokens,reservedOutputTokens,windowTokens,over:windowTokens>=4096&&(estimatedInputTokens+reservedOutputTokens>Math.floor(windowTokens*.85)||reservedOutputTokens>=Math.floor(windowTokens*.85))};
  }
  function buildTaskRequest(items=thread(),context=taskContext()){
    const task=state.tasks[activeType],start=Math.max(0,Math.min(items.length,Number(context.start)||0));
    const chosen=Number.isSafeInteger(context.boundary)?items.filter(m=>!Number.isSafeInteger(m.taskSequence)||m.taskSequence>context.boundary):items.slice(start);
    const history=chosen.map(m=>({role:m.role,content:m.role==='user'?(m.requestContent||m.content):m.content}));
    const resources=[];for(const [kind,id]of Object.entries(context.refs||{})){const version=task.versions.find(v=>v.id===id);if(!version)throw Error('本轮依赖的任务资料版本缺失，未发送请求');if(!history.some(m=>m.content.includes(version.content)))resources.push('【'+taskKinds[kind]+' · '+version.id+'】\n'+version.content);}
    const messages=[{role:'system',content:systemPrompt(activeType)},...(resources.length?[{role:'system',content:'【本工作段保留的任务资料】\n'+resources.join('\n\n')}]:[]),...history];
    return {...requestCapacity(messages,assistantConfig()),context:clone(context)};
  }
  function taskPanelHtml(){const task=state.tasks[activeType],cfg=assistantConfig();return `<details class="mima-settings-fold assistant-task-panel"><summary>任务资料与请求预览 · ${task.versions.length} 个版本</summary><div class="mima-settings-fold-body"><p class="row-sub">模板、字段表、方案和发布版本独立保存。开始新工作段会保留全部历史与这些资料；普通发送仍使用完整历史。</p><label class="form-label">资料类型</label><select id="assistant-task-kind" class="field">${Object.entries(taskKinds).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select><label class="form-label">从历史取用，或在下方粘贴原文</label><select class="field" onchange="MimaAssistantStudio.takeTaskSource(this.value)"><option value="">选择历史消息</option>${thread().map((m,i)=>`<option value="${i}">${i+1} · ${m.role==='user'?'我':'助手'} · ${esc(m.content.slice(0,35))}</option>`).join('')}</select><textarea id="assistant-task-source" class="field textarea" placeholder="完整任务资料"></textarea><button class="ghost-btn" onclick="MimaAssistantStudio.saveTaskResource()">保存为新资料版本</button><label class="form-label">已保存版本</label><select id="assistant-task-version" class="field">${task.versions.map(v=>`<option value="${esc(v.id)}">${taskKinds[v.kind]} · ${esc(v.time)}${task.current[v.kind]===v.id?' · 当前':''}</option>`).join('')}</select><button class="ghost-btn" onclick="MimaAssistantStudio.useTaskVersion()">使用此版本</button><label class="form-label">当前连接及模型的助手容量（0=沿用 API 设置）</label><input id="assistant-context-window" class="field" type="number" min="0" step="1024" value="${cfg.assistantCapacityOverride}" onchange="MimaAssistantStudio.setProfileField('contextWindowTokens',this.value)"><div id="assistant-capacity-status" class="row-sub" role="status">${cfg.assistantCapacitySource==='independent'?'助手独立容量：'+cfg.contextWindowTokens.toLocaleString()+' Tokens':cfg.assistantCapacitySource==='inherited'?'沿用当前连接及模型：'+cfg.contextWindowTokens.toLocaleString()+' Tokens':'当前连接及模型尚未声明容量；完整历史不会按假定窗口截断'}</div><div class="toolbar"><button class="ghost-btn" onclick="MimaAssistantStudio.previewRequest()">预览实际请求</button><button class="ghost-btn" onclick="MimaAssistantStudio.startWorkSegment()">保留资料，开始新工作段</button></div><div id="assistant-request-preview" role="status"></div></div></details>`;}
  function takeTaskSource(index){const row=thread()[Number(index)];if(row)document.getElementById('assistant-task-source').value=row.content;}
  async function saveTaskResource(){if(generating||stateOperationBusy)return;const content=document.getElementById('assistant-task-source')?.value||'',kind=document.getElementById('assistant-task-kind')?.value;if(!content.trim()||!taskKinds[kind])return notify('请填写完整资料');const task=state.tasks[activeType],version={id:'task-'+crypto.randomUUID(),kind,content,time:new Date().toISOString()};task.versions.push(version);task.current[kind]=version.id;task.revision=(task.revision||0)+1;try{await saveState();}catch(_){return;}render();notify('任务资料已保存为独立版本');}
  async function useTaskVersion(){if(generating||stateOperationBusy)return;const task=state.tasks[activeType],version=task.versions.find(v=>v.id===document.getElementById('assistant-task-version')?.value);if(!version)return;task.current[version.kind]=version.id;task.revision=(task.revision||0)+1;try{await saveState();}catch(_){return;}render();}
  async function startWorkSegment(){if(generating||stateOperationBusy)return;if(!Object.keys(state.tasks[activeType].current).length)return notify('请先保存本任务需要保留的模板、字段表或方案，再开始新工作段');const task=state.tasks[activeType];for(const m of thread())if(!Number.isSafeInteger(m.taskSequence))m.taskSequence=nextTaskSequence();task.segmentBoundary=Number(thread().at(-1)?.taskSequence)||nextTaskSequence();task.segmentStart=thread().length;task.revision=(task.revision||0)+1;try{await saveState();}catch(_){return;}render();notify('新工作段已开始；全部历史和资料版本仍保留');}
  function previewRequest(plan=null){
    try{if(!plan){const raw=document.getElementById('assistant-input')?.value||'';plan=buildTaskRequest([...thread(),...(raw.trim()?[{role:'user',content:nextQuickMode===activeType?quickInstruction(activeType)+'\n\n【用户素材】\n'+raw:raw}]:[])]);}
      const panel=document.querySelector('.assistant-task-panel');if(panel)panel.open=true;const out=document.getElementById('assistant-request-preview');out.replaceChildren();const status=document.createElement('p');status.textContent=`输入估算 ${plan.estimatedInputTokens} Tokens，保留输出 ${plan.reservedOutputTokens}，窗口 ${plan.windowTokens||'未声明'}。${plan.over?'容量不足，尚未调用模型。可选择更大窗口的模型并填写对应容量，或保留资料开始新工作段。':'按下发送后将提交下面的完整内容。'}`;out.append(status);for(const message of plan.messages){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=message.role+' · '+message.content.length+' 字符';pre.textContent=message.content;details.append(summary,pre);out.append(details);}return plan;
    }catch(error){notify(error.message);return null;}
  }
  function profileFormHtml(){const p=profile(),storyCfg=window.MimaStandalone?.getApiConfig?.()||{};const model=p.model||storyCfg.model||'未选择';return `<details class="assistant-config-card" ${state.ui.configOpen?'open':''} ontoggle="MimaAssistantStudio.setConfigOpen(this.open)"><summary class="assistant-config-summary"><span><strong>⚙ 助手模型设置</strong><span class="assistant-config-summary-model">${esc(model)} · T ${Number(p.temperature).toFixed(2)}</span></span></summary><div class="assistant-config-body"><div class="assistant-config-head"><strong>独立助手模型</strong><span class="tag">正文模型不受影响</span></div><label class="form-label">Model（模型）</label><div class="inline-field-row"><select id="assistant-model-select" class="field" onchange="MimaAssistantStudio.selectModel(this.value)"><option value="">${p.model?esc(p.model):`沿用当前名称：${esc(storyCfg.model||'未选择')}`}</option>${cachedModels.map(m=>`<option value="${esc(m)}" ${m===p.model?'selected':''}>${esc(m)}</option>`).join('')}</select><button class="ghost-btn" onclick="MimaAssistantStudio.loadModels()">拉取模型</button></div><input id="assistant-model-manual" class="field" placeholder="也可以手动填写，例如 gpt-5.6-sol" value="${esc(p.model||'')}" onchange="MimaAssistantStudio.setProfileField('model',this.value)"><label class="form-label">Temperature（温度） <span id="assistant-temp-value" class="value-pill">${Number(p.temperature).toFixed(2)}</span></label><input class="temp-range" type="range" min="0.1" max="2" step="0.05" value="${Number(p.temperature)}" oninput="MimaAssistantStudio.setProfileField('temperature',this.value);document.getElementById('assistant-temp-value').textContent=Number(this.value).toFixed(2)"><label class="form-label">Assistant Max Tokens（助手独立最大输出，0=不发送限制）</label><input class="field" type="number" min="0" max="131072" step="256" value="${Number(p.maxTokens||0)}" onchange="MimaAssistantStudio.setProfileField('maxTokens',this.value)"><div class="row-sub">不会再继承正文的 Max Tokens。建议先保持 0；若中转站要求显式限制，可填 4096–8192。</div><label class="check-row"><input type="checkbox" ${p.stream?'checked':''} onchange="MimaAssistantStudio.setProfileField('stream',this.checked)"> 助手 Streaming（流式）</label><label class="check-row"><input type="checkbox" ${p.sendTemperature!==false?'checked':''} onchange="MimaAssistantStudio.setProfileField('sendTemperature',this.checked)"> 向助手模型发送 Temperature</label><details class="assistant-persona-details"><summary>Persona / 设计风格</summary><label class="form-label">助手 Persona</label><textarea class="field textarea" onchange="MimaAssistantStudio.setProfileField('persona',this.value)">${esc(p.persona||'')}</textarea><label class="form-label">设计风格</label><textarea class="field textarea" onchange="MimaAssistantStudio.setProfileField('style',this.value)">${esc(p.style||'')}</textarea></details><div class="row-sub">助手继承正文 API 的 Base URL / Key / Headers，但 <strong>Model、Temperature 与 Max Tokens 分开保存</strong>。正文的巨大输出上限不会再被助手请求继承。</div></div></details>`;}

  function artifactButtons(detail,index,msg){
    const artifact=detail?.artifact||null;
    if(!artifact){
      if(!detail?.found)return'';
      const attempts=Array.isArray(msg?.repairAttempts)?msg.repairAttempts:[];
      const latest=attempts[attempts.length-1];
      const attemptHtml=latest?`<details class="assistant-repair-attempt"><summary>查看最近 AI 修复结果 · ${latest.success?'成功':'未通过本地验收'}</summary><div class="row-sub">${esc(latest.time||'')} · ${esc(latest.model||'未知模型')}${latest.error?` · ${esc(latest.error)}`:''}</div><pre class="prompt-pre">${esc(latest.content||'(空回复)')}</pre></details>`:'';
      const heading=detail.protocol==='v2'?'⚠️ 检测到 MIMA V2 工件，但结构没有成功解析':'⚠️ 检测到 MIMA 工件，但 JSON 没有成功解析';
      return `<div class="assistant-artifact-card assistant-artifact-error"><strong>${heading}</strong><div class="row-sub">已经先执行本地安全解析/自愈（免费），仍无法确定结构。原工件完整保留，不会写入半残正则。</div><div class="assistant-artifact-error-detail">${esc(detail.error||'未知解析错误')}</div><div class="assistant-artifact-billing-note">✨ AI 救援修复会真实调用当前助手模型，可能产生 API 费用；不会自动重试第二次。</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.repairArtifact(${index})" title="🩹 修复此工件">✨ AI 救援修复（会计费）</button><button class="ghost-btn" onclick="MimaAssistantStudio.regenerate(${index})">↻ 让助手重做</button><button class="ghost-btn" onclick="MimaAssistantStudio.startEdit(${index})">编辑原文</button></div>${attemptHtml}</div>`;
    }
    const protocol=detail?.protocol==='v2'?'<span class="tag">V2 Zero-Escape</span>':'<span class="tag">Legacy V1</span>';
    const repaired=detail?.repaired?`<span class="tag">${detail.repairLevel==='self_heal'?'已自愈 JSON':'已自动修复 JSON 格式'}</span>`:'';
    if(artifact.kind==='regex_bundle')return `<div class="assistant-artifact-card"><div class="assistant-artifact-title"><strong><img src="./assets/mima-gothic-regex.png" class="mima-gothic-ui-icon" alt="" aria-hidden="true" draggable="false"> 已识别 Regex Bundle</strong>${protocol}${repaired}</div><div class="row-sub">包含配套预设 + 正则包，可一键保存并挂载到当前剧情。</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'all')">一键保存 + 挂载</button><button class="ghost-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'regex')">只存正则</button><button class="ghost-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'preset')">只存预设</button></div><details><summary>查看解析后的 canonical 工件</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    if(artifact.kind==='preset')return `<div class="assistant-artifact-card"><div class="assistant-artifact-title"><strong><img src="./assets/mima-gothic-preset.png" class="mima-gothic-ui-icon" alt="" aria-hidden="true" draggable="false"> 已识别 Preset</strong>${protocol}${repaired}</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'preset')">保存并挂载预设</button></div><details><summary>查看解析后的 canonical 工件</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    if(artifact.kind==='css_preset')return `<div class="assistant-artifact-card"><div class="assistant-artifact-title"><strong>🎨 已识别 CSS Preset</strong>${protocol}${repaired}</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'css')">保存并按目标作用域处理</button></div><details><summary>查看解析后的 canonical 工件</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    return `<div class="assistant-artifact-card assistant-artifact-error"><strong>⚠️ 未支持的工件类型</strong><div class="row-sub">kind = ${esc(artifact.kind||'(empty)')}。原文未删除。</div></div>`;
  }
  function messagesHtml(){
    const items=thread();
    let html=items.map((m,i)=>{const artifactDetail=m.role==='assistant'?parseArtifactDetailed(m.content):{found:false,artifact:null,error:'',repaired:false};const shown=m.role==='assistant'?visibleAssistantText(m.content):m.content;const editing=editingIndex===i;const actions=generating?'':`<span class="assistant-msg-actions">${m.role==='assistant'?`<button onclick="MimaAssistantStudio.regenerate(${i})">↻ 重说</button>`:''}<button onclick="MimaAssistantStudio.startEdit(${i})">编辑</button><button class="danger" onclick="MimaAssistantStudio.deleteMessage(${i})">删除</button></span>`;const body=editing?`<div class="assistant-history-editor"><textarea id="assistant-edit-${i}" class="field textarea">${esc(m.content)}</textarea><div class="assistant-history-edit-actions"><button class="ghost-btn" onclick="MimaAssistantStudio.cancelEdit()">取消</button><button class="primary-btn" onclick="MimaAssistantStudio.saveEdit(${i})">保存编辑</button></div><div class="row-sub">只修改本地助手历史，不会自动调用模型，也不会删除已经保存的预设 / 正则 / CSS。</div></div>`:`<div class="assistant-chat-text">${esc(shown).replace(/\n/g,'<br>')}</div>${artifactButtons(artifactDetail,i,m)}`;let card=`<article class="assistant-chat-msg ${m.role==='user'?'assistant-chat-user':'assistant-chat-ai'}"><div class="assistant-chat-meta"><span>${m.role==='user'?'你':META[activeType].title} · ${formatTime(m.time)}${m.editedAt?' · 已编辑':''}</span>${actions}</div>${body}</article>`;if(generating&&(generationMode==='regenerate'||generationMode==='repair')&&regeneratingIndex===i)card+=`<article class="assistant-chat-msg assistant-chat-ai assistant-chat-streaming"><div class="assistant-chat-meta"><span>${META[activeType].title} · ${generationMode==='repair'?'正在修复工件':'正在重说'}</span></div><div class="assistant-chat-text">${esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>')}</div></article>`;return card}).join('');
    if(generating&&generationMode==='send'){html+=`<article class="assistant-chat-msg assistant-chat-ai assistant-chat-streaming"><div class="assistant-chat-meta"><span>${META[activeType].title} · 正在生成</span></div><div class="assistant-chat-text">${esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>')}</div></article>`;}
    if(!html)html='<div class="assistant-empty"><div class="empty-icon">'+META[activeType].icon+'</div><strong>'+META[activeType].title+'已就位</strong><p>它有独立模型、温度、Persona 与聊天记录。你可以把素材直接贴进下面的大输入框。</p></div>';
    return html;
  }

  function isAssistantNearBottom(sc,threshold=88){return !sc||((sc.scrollHeight-sc.scrollTop-sc.clientHeight)<=threshold);}
  function updateAssistantFollowButton(){const b=document.getElementById('assistant-follow-stream');if(!b)return;b.classList.toggle('hidden',!generating||assistantFollowTail);}
  function bindAssistantScroll(){const sc=document.getElementById('assistant-chat-scroll');if(!sc)return;sc.addEventListener('scroll',()=>{if(!generating)return;assistantFollowTail=isAssistantNearBottom(sc);updateAssistantFollowButton();},{passive:true});}
  function followLatest(){assistantFollowTail=true;const sc=document.getElementById('assistant-chat-scroll');if(sc)sc.scrollTop=sc.scrollHeight;updateAssistantFollowButton();}
  function render(){
    const oldTask=document.getElementById('assistant-task-source');if(oldTask&&renderedType)MimaUiDrafts.put('assistant-task:'+renderedType,{text:oldTask.value,kind:document.getElementById('assistant-task-kind')?.value||'template'});
    captureComposer();
    const root=document.getElementById('assistant-studio-root');if(!root)return;
    const oldSc=document.getElementById('assistant-chat-scroll'),oldScrollTop=oldSc?.scrollTop||0;
    const preserveReading=!!oldSc&&!assistantFollowTail;
    const meta=META[activeType];document.getElementById('assistant-studio-title').textContent=meta.title;
    const lastAi=lastAssistantIndex();
    root.classList.toggle('assistant-config-open',!!state.ui.configOpen);
    root.innerHTML=`<aside class="assistant-sidebar"><div class="assistant-type-tabs">${TYPES.map(t=>`<button class="assistant-type-btn ${t===activeType?'active':''}" onclick="MimaAssistantStudio.switchType('${t}')">${META[t].icon} ${META[t].title}</button>`).join('')}</div>${profileFormHtml()}${taskPanelHtml()}${cssPickerHtml()}${recoveryNotice?`<div class="row-sub" role="status">${esc(recoveryNotice)}${unsavedRescue.length||persistedRecoveryCount?'<button class="ghost-btn" onclick="MimaAssistantStudio.exportRawState()">导出保留的未保存内容</button>':''}</div>`:''}${storageProblem?`<div class="row-sub" role="alert"><button class="ghost-btn" onclick="MimaAssistantStudio.recoverState()">重新读取并恢复保存</button>助手本地历史读取异常，已暂停所有保存，以保护原记录。<button class="ghost-btn" onclick="MimaAssistantStudio.exportRawState()">导出原始助手记录</button></div>`:''}<button class="assistant-clear-btn" onclick="MimaAssistantStudio.clearThread()" ${generating?'disabled':''}>清空聊天</button></aside><section class="assistant-main"><div class="assistant-chat-scroll" id="assistant-chat-scroll">${messagesHtml()}</div><button id="assistant-follow-stream" class="assistant-follow-stream hidden" onclick="MimaAssistantStudio.followLatest()">↓ 跟随输出</button><div class="assistant-composer"><div class="assistant-quick-row"><button class="chip-btn ${nextQuickMode===activeType?'active':''}" onclick="MimaAssistantStudio.setQuickMode()" ${generating?'disabled':''}>⚡ ${meta.quick}</button><button class="chip-btn" onclick="MimaAssistantStudio.regenerate(${lastAi})" ${generating||lastAi<0?'disabled':''}>↻ 重说上一条</button>${generating?'<button class="chip-btn danger" onclick="MimaAssistantStudio.stop()">■ 停止</button>':''}</div>${nextQuickMode===activeType?'<div class="assistant-mode-banner">下一条会以快捷任务模式发送；原文不会被改写后再存。</div>':''}<div class="assistant-input-row"><textarea id="assistant-input" rows="3" placeholder="${esc(meta.placeholder)}" ${generating?'disabled':''}></textarea><button class="send-btn assistant-send-btn" onclick="MimaAssistantStudio.send()" ${generating?'disabled':''}>➤</button></div><div class="row-sub assistant-enter-hint">Enter 只换行；点击发送才调用助手模型。</div></div></section>`;
    if(stateOperationBusy){for(const control of root.querySelectorAll('button,input,select,textarea'))control.disabled=true;root.setAttribute('aria-busy','true');}else root.removeAttribute('aria-busy');
    const taskDraft=MimaUiDrafts.get('assistant-task:'+activeType),taskInput=document.getElementById('assistant-task-source');if(taskInput&&taskDraft){taskInput.value=taskDraft.text||'';document.getElementById('assistant-task-kind').value=taskDraft.kind||'template';}
    taskInput?.addEventListener('input',()=>MimaUiDrafts.put('assistant-task:'+activeType,{text:taskInput.value,kind:document.getElementById('assistant-task-kind')?.value||'template'}));
    renderedType=activeType;const composer=document.getElementById('assistant-input'),draft=MimaUiDrafts.get('assistant:'+activeType);if(composer&&draft){composer.value=draft.text||'';try{composer.setSelectionRange(draft.start||0,draft.end||0)}catch(_){}composer.scrollTop=draft.scroll||0;}composer?.addEventListener('input',()=>captureComposer());
    requestAnimationFrame(()=>{const sc=document.getElementById('assistant-chat-scroll');if(sc){if(preserveReading)sc.scrollTop=oldScrollTop;else if(assistantFollowTail)sc.scrollTop=sc.scrollHeight;}bindAssistantScroll();updateAssistantFollowButton();});
  }
  async function setConfigOpen(open){if(stateOperationBusy)return;state.ui.configOpen=!!open;try{await saveState('')}catch(_){render();return}const root=document.getElementById('assistant-studio-root');root?.classList.toggle('assistant-config-open',!!open);}

  async function setProfileField(key,value,rerender=false){
    if(stateOperationBusy)return;
    const p=profile();
    if(key==='contextWindowTokens'){
      const n=Number(value);if(n!==0&&(!Number.isSafeInteger(n)||n<4096))return notify('上下文窗口请填写 0 或至少 4096 的整数');
      const story=window.MimaStandalone.getApiConfig(),id=window.MimaStandalone.apiCapacityIdentity({...story,model:p.model||story.model||''}),next={...p.capacityProfiles};
      if(n)next[id]=n;else delete next[id];p.capacityProfiles=next;p.capacityMapVersion=1;
    }
    else if(key==='temperature')p.temperature=clampTemp(value,p.temperature);
    else if(key==='maxTokens')p.maxTokens=Math.max(0,Math.min(131072,Math.floor(Number(value)||0)));
    else if(key==='stream'||key==='sendTemperature')p[key]=!!value;
    else p[key]=String(value??'');
    // Parameters and UI never snapshot or write a chat thread.
    if(key==='temperature')await scheduleProfileSave();
    else{await flushProfileSave();try{await saveState('');}catch(_){/* Keep the user's unsaved selection for recovery. */}}
    if(rerender||key==='model'||key==='contextWindowTokens')render();
  }
  async function selectModel(value){if(value)await setProfileField('model',value,true);}
  async function loadModels(){
    if(stateOperationBusy)return;
    try{cachedModels=await window.MimaStandalone.listModels();const p=profile();if(!p.model&&cachedModels.length){p.model=cachedModels[0];await saveState('')}render();notify(`助手可选模型已拉取：${cachedModels.length} 个`);}catch(e){notify(`拉取助手模型失败：${e.message||e}`)}
  }
  async function clearThread(){if(stateOperationBusy||generating)return;if(!confirm(`清空${META[activeType].title}的本地聊天记录？不会删除已保存的预设/正则/CSS。`))return;state.threads[activeType]=[];state.tasks[activeType].segmentStart=0;state.tasks[activeType].segmentBoundary=0;state.tasks[activeType].revision=(state.tasks[activeType].revision||0)+1;editingIndex=-1;try{await saveState()}catch(_){/* Preserve unsaved edits for recovery. */}render();}
  function lastAssistantIndex(){for(let i=thread().length-1;i>=0;i--)if(thread()[i]?.role==='assistant')return i;return-1;}
  function startEdit(index){if(generating||stateOperationBusy||!thread()[index])return;editingIndex=index;render();requestAnimationFrame(()=>{const el=document.getElementById(`assistant-edit-${index}`);if(el){el.focus();el.setSelectionRange?.(el.value.length,el.value.length);el.scrollIntoView?.({block:'center'})}});}
  function cancelEdit(){editingIndex=-1;render();}
  async function saveEdit(index){if(generating||stateOperationBusy)return;const msg=thread()[index],el=document.getElementById(`assistant-edit-${index}`);if(!msg||!el)return;const content=String(el.value??'');if(!content.trim())return notify('历史消息不能保存为空；如果不要这条，请直接点“删除”。');if(msg.content!==content){delete msg.savedArtifactIds;}msg.content=content;if(msg.role==='user')msg.requestContent=msg.quickMode?`${quickInstruction(activeType)}\n\n【用户素材】\n${content}`:content;msg.editedAt=new Date().toISOString();try{await saveState()}catch(_){render();return}editingIndex=-1;render();notify('历史消息已编辑');}
  async function deleteMessage(index){if(generating||stateOperationBusy||!thread()[index])return;if(!confirm('删除这一条助手历史消息？只删除本地聊天记录，不会删除已经保存的预设 / 正则 / CSS。'))return;thread().splice(index,1);editingIndex=-1;try{await saveState()}catch(_){render();return}render();notify('这条历史消息已删除');}
  function retainInterruptedDraft(){
    if(draftAssistantText){recoveryNotice='已保留停止前收到的回复，可从救援导出取回。';void retainRecoveryBranch({capturedAt:new Date().toISOString(),reason:'stopped_generation',type:activeType,mode:generationMode,content:draftAssistantText}).catch(()=>{});}
  }
  function stop(){retainInterruptedDraft();generationEpoch++;if(controller)controller.abort();controller=null;generating=false;draftAssistantText='';generationMode='send';regeneratingIndex=-1;render();}

  async function send(){
    if(generating||stateOperationBusy)return;
    const input=document.getElementById('assistant-input');const raw=input?.value||'';if(!raw.trim())return;
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model){notify('先去 🔌 API 设置配置连接，并给助手选择一个模型猫。');return;}
    const quickMode=nextQuickMode===activeType;const userContent=(quickMode?`${quickInstruction(activeType)}\n\n【用户素材】\n${raw}`:raw);
    // Acquire the turn synchronously: IndexedDB save may take arbitrarily long.
    // No second send, type switch, or regeneration can enter before persistence.
    const requestContext=taskContext(),plan=buildTaskRequest([...thread(),{role:'user',content:userContent}],requestContext);if(plan.over){previewRequest(plan);return;}
    const turnThread=thread(),turnMessage={role:'user',content:raw,taskSequence:nextTaskSequence(),taskContext:requestContext,...(quickMode?{requestContent:userContent}:{}),quickMode,time:new Date().toISOString()};
    generating=true;generationMode='send';regeneratingIndex=-1;editingIndex=-1;draftAssistantText='';assistantFollowTail=true;
    const runEpoch=++generationEpoch;
    controller=new AbortController();const turnSignal=controller.signal;
    turnThread.push(turnMessage);render();
    try{await saveState()}catch(_){
      // Remove exactly this unsaved turn, never the current thread's last item.
      const at=turnThread.indexOf(turnMessage);if(at!==-1)turnThread.splice(at,1);
      if(runEpoch===generationEpoch){generating=false;controller=null;generationMode='send';render();const draft=document.getElementById('assistant-input');if(draft)draft.value=raw;}
      return;
    }
    if(runEpoch!==generationEpoch||turnSignal.aborted)return; // Stopped/closed while saving: no billable request.
    const currentInput=document.getElementById('assistant-input');
    if(currentInput?.value===raw){currentInput.value='';MimaUiDrafts.remove('assistant:'+activeType);}
    nextQuickMode='';render();
    const {messages,cfg}=plan;
    try{
      const reply=await window.MimaStandalone.callModelWithConfig(messages,cfg,p.temperature,turnSignal,{streamOverride:p.stream,onProgress:payload=>{if(runEpoch===generationEpoch&&payload?.streamText!==undefined){draftAssistantText=String(payload.streamText||'');const textEl=document.querySelector('.assistant-chat-streaming .assistant-chat-text');if(textEl)textEl.innerHTML=esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>');const sc=document.getElementById('assistant-chat-scroll');if(sc&&assistantFollowTail)sc.scrollTop=sc.scrollHeight;updateAssistantFollowButton();}}});
      if(runEpoch!==generationEpoch)return;
      thread().push({role:'assistant',content:reply,taskSequence:nextTaskSequence(),taskContext:requestContext,time:new Date().toISOString()});await saveState();if(runEpoch!==generationEpoch)return;generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;render();
    }catch(e){if(runEpoch!==generationEpoch)return;generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('助手生成已停止');render();return}if(storageProblem){notify('助手回复已经生成，但保存历史失败。当前页面保留回复，请先复制需要保全的内容；不会假称已保存。');render();return}const status=Number(e?.status)||0;const billing=/余额|insufficient|balance|quota|credit|billing/i.test(String(e?.message||''));const extra=billing?'；这是上游/中转站计费拒绝，不代表本地数据丢失。已确保助手不再继承正文 Max Tokens，可保持助手 Max Tokens=0 后重试。':(e?.hint?`；${e.hint}`:'');notify(`助手调用失败${status?` · HTTP ${status}`:''}：${e.message||e}${extra}`);render();}
  }

  async function regenerate(index){
    if(generating||stateOperationBusy)return;
    const items=thread();index=Number(index);if(!Number.isInteger(index)||index<0)index=lastAssistantIndex();const target=items[index];if(!target||target.role!=='assistant')return notify('还没有可以重说的助手回复。');
    const before=items.slice(0,index);if(!before.some(m=>m.role==='user'))return notify('这条回复前没有用户消息，无法安全重说。');
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model){notify('先去 🔌 API 设置配置连接，并给助手选择一个模型猫。');return;}
    const plan=buildTaskRequest(before,target.taskContext||{start:0,refs:{}});if(plan.over){previewRequest(plan);return;}const {messages,cfg}=plan;
    generating=true;generationMode='regenerate';regeneratingIndex=index;editingIndex=-1;draftAssistantText='';assistantFollowTail=true;render();
    controller=new AbortController();const runEpoch=++generationEpoch;
    try{
      const reply=await window.MimaStandalone.callModelWithConfig(messages,cfg,p.temperature,controller.signal,{streamOverride:p.stream,onProgress:payload=>{if(runEpoch===generationEpoch&&payload?.streamText!==undefined){draftAssistantText=String(payload.streamText||'');const streamCards=document.querySelectorAll?.('.assistant-chat-streaming .assistant-chat-text');const textEl=streamCards?.[streamCards.length-1];if(textEl)textEl.innerHTML=esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>');const sc=document.getElementById('assistant-chat-scroll');if(sc&&assistantFollowTail)sc.scrollTop=sc.scrollHeight;updateAssistantFollowButton();}}});
      if(runEpoch!==generationEpoch)return;
      const current=thread()[index];if(current!==target||current.role!=='assistant')throw new Error('历史位置已经变化，为避免覆盖错误消息，本次重说未写入。');rotateSavedArtifactIdentity(current,reply,'regenerate');current.content=reply;current.time=new Date().toISOString();current.regeneratedAt=current.time;await saveState();if(runEpoch!==generationEpoch)return;generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;render();notify('助手已经重说这一条 ✨');
    }catch(e){if(runEpoch!==generationEpoch)return;generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('助手重说已停止，原回复保留');render();return}if(storageProblem){notify('助手已经生成重说内容，但历史没有保存；当前页面保留文字供复制。');render();return}const status=Number(e?.status)||0;const billing=/余额|insufficient|balance|quota|credit|billing/i.test(String(e?.message||''));const extra=billing?'；这是上游/中转站计费拒绝，原回复仍然保留。':(e?.hint?`；${e.hint}`:'');notify(`助手重说失败${status?` · HTTP ${status}`:''}：${e.message||e}${extra}`);render();}
  }

  async function repairArtifact(index){
    if(generating||stateOperationBusy)return;
    const items=thread();index=Number(index);const target=items[index];if(!target||target.role!=='assistant')return notify('没有找到要修复的助手工件。');
    const detailBefore=parseArtifactDetailed(target.content);if(!detailBefore.found)return notify('这条回复没有 MIMA 工件标记。');
    if(detailBefore.artifact)return notify('这条工件已经能被本地解析，不需要再调用 AI 修复。');
    if(typeof confirm==='function'&&!confirm('AI 救援修复会真实调用当前助手模型并可能产生 API 费用。只调用一次，不会自动重试。继续吗？'))return;
    const legacy=extractArtifactCandidate(target.content),v2=extractArtifactV2(target.content);
    const originalBlock=v2.found?v2.full:(legacy.found?legacy.full:'');if(!originalBlock)return notify('没有找到可送修的完整工件块。');
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model)return notify('先配置 API，并给助手选择模型猫。');
    const repairSystem=`你是 MIMA 工件“运输层救援器”。输入可能是坏掉的 Legacy JSON，也可能是不完整的 V2。你的唯一任务是：在不改变任何业务语义的前提下，把它重新封装成 MIMA_ARTIFACT_V2 Zero-Escape 格式。\n\n绝对禁止：删除规则、合并规则、改写 pattern、改写 replacement、改写 HTML/CSS、缩短 preset、改变字段顺序、重新设计内容。\n允许且必须做的只有：恢复明显的字符串边界/字段归属，并把大文本原样放进对应 CDATA。\n输出且只输出一个完整 <MIMA_ARTIFACT_V2 ...>...</MIMA_ARTIFACT_V2>，不要解释，不要 Markdown code fence，不要再输出 JSON。\n\n${artifactV2Protocol()}`;
    const repairUser=`下面是原始工件。把它逐字段搬运到 V2；业务内容与规则顺序全部保持原样：\n\n${originalBlock}`;
    const repairTemp=Math.min(.2,Math.max(.1,Number(p.temperature)||.1)),cfg=assistantConfig({temperature:repairTemp,stream:false});
    const repairPlan=requestCapacity([{role:'system',content:repairSystem},{role:'user',content:repairUser}],cfg);
    if(repairPlan.over){previewRequest(repairPlan);return notify('此工件超出当前助手模型容量，尚未调用 API；请调整此连接及模型的容量或选择更大窗口的模型。');}
    generating=true;generationMode='repair';regeneratingIndex=index;editingIndex=-1;draftAssistantText='';assistantFollowTail=true;render();controller=new AbortController();const runEpoch=++generationEpoch;
    let reply='';
    try{
      reply=await window.MimaStandalone.callModelWithConfig(repairPlan.messages,cfg,repairTemp,controller.signal,{streamOverride:false});
      if(runEpoch!==generationEpoch)return;
      const current=thread()[index];if(current!==target||current.role!=='assistant')throw new Error('历史位置已经变化，为避免覆盖错误消息，本次修复未写入。');
      const parsed=parseArtifactDetailed(reply),repairAccepted=!!parsed.artifact&&parsed.protocol==='v2';
      current.repairAttempts=Array.isArray(current.repairAttempts)?current.repairAttempts:[];
      const repairError=repairAccepted?'':(parsed.artifact?'AI 返回了 Legacy V1，而不是要求的 V2 Zero-Escape 工件':(parsed.error||'AI 返回的 V2 工件仍无法解析'));
      const attempt={time:new Date().toISOString(),model,content:reply,success:repairAccepted,error:repairError};
      current.repairAttempts.push(attempt);if(current.repairAttempts.length>5)current.repairAttempts=current.repairAttempts.slice(-5);
      if(!repairAccepted){await saveState();if(runEpoch!==generationEpoch)return;throw new Error(`AI 已返回内容并完成计费，但本地验收未通过：${repairError}。修复结果已保存，可展开查看；不会自动再次调用模型。`)}
      const repairedV2=extractArtifactV2(reply);if(!repairedV2.found)throw new Error('AI 修复结果通过解析，但没有可保存的 V2 原始块。');
      current.versions=Array.isArray(current.versions)?current.versions:[];current.versions.push({content:current.content,time:new Date().toISOString(),reason:'artifact_v2_ai_rescue'});
      const repairedContent=String(current.content||'').replace(originalBlock,repairedV2.full);rotateSavedArtifactIdentity(current,repairedContent,'repair');current.content=repairedContent;current.editedAt=new Date().toISOString();current.artifactRepairedAt=current.editedAt;current.artifactProtocol='v2';
      await saveState();if(runEpoch!==generationEpoch)return;generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;render();notify('工件已转换为 V2 Zero-Escape，并通过本地校验 ✨');
    }catch(e){
      if(runEpoch!==generationEpoch)return;
      const current=thread()[index];if(reply&&current&&current.role==='assistant'&&!(current.repairAttempts||[]).some(a=>a.content===reply)){
        current.repairAttempts=Array.isArray(current.repairAttempts)?current.repairAttempts:[];current.repairAttempts.push({time:new Date().toISOString(),model,content:reply,success:false,error:e?.message||String(e)});current.repairAttempts=current.repairAttempts.slice(-5);try{await saveState()}catch(_){/* Retain result in memory for copying. */}
      }
      if(runEpoch!==generationEpoch)return;
      generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('AI 救援修复已停止，原工件完整保留');render();return}notify(`修复工件失败：${e.message||e}；原工件完整保留。`);render();
    }
  }
  // A saved artifact ID names immutable content, NOT a mutable chat message.
  // Preserve the old mapping for archived versions and reuse it only when the
  // entire reply text is identical. A new generated reply gets new IDs.
  function rotateSavedArtifactIdentity(msg,nextContent,reason){
    const before=String(msg.content??''),after=String(nextContent??'');
    if(before===after)return;
    if(msg.savedArtifactIds&&Object.keys(msg.savedArtifactIds).length){
      msg.savedArtifactVersions=Array.isArray(msg.savedArtifactVersions)?msg.savedArtifactVersions:[];
      if(!msg.savedArtifactVersions.some(v=>v.content===before))msg.savedArtifactVersions.push({content:before,ids:{...msg.savedArtifactIds},time:new Date().toISOString(),reason});
    }
    const prior=(msg.savedArtifactVersions||[]).find(v=>v.content===after&&v.ids);
    if(prior)msg.savedArtifactIds={...prior.ids};else delete msg.savedArtifactIds;
  }
  async function stableArtifactId(msg,key,prefix,type=activeType){
    if(!msg.savedArtifactIds)msg.savedArtifactIds={};
    if(!msg.savedArtifactIds[key]){msg.savedArtifactIds[key]=`${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;await saveState(type);}
    return msg.savedArtifactIds[key];
  }
  async function saveArtifact(index,mode){
    if(stateOperationBusy)return;
    const sourceType=activeType,msg=thread()[index];const detail=parseArtifactDetailed(msg?.content);const artifact=detail.artifact;if(!artifact)return notify(detail.found?`检测到工件标记，但解析失败：${detail.error}`:'这条消息没有可保存的工件。');
    const bridge=window.MimaTavernBridge,session=bridge?.getSession?.(),cssTarget=bridge?.getCssTarget?.();
    let phase='尚未提交',savedRegex=null,savedPreset=null,savedCss=null;
    try{
      if(artifact.kind==='regex_bundle'&&mode==='all'){
        if(!artifact.preset?.content)throw Error('Bundle 缺少配套预设');
        const bundleId=await stableArtifactId(msg,'regex','regex-asst',sourceType);
        const pack={...artifact.regexPack,id:bundleId,rules:(artifact.regexPack.rules||[]).map((r,i)=>({...r,id:r.id||`${bundleId}-rule-${i}`}))},preset={...artifact.preset,id:await stableArtifactId(msg,'preset','preset-asst',sourceType)};
        const r=await window.MimaStandalone.handle('/assistant/regex-bundle','POST',{regexPack:pack,preset,sessionId:session?.id||null});
        if(!r.success)throw Error(r.msg||'Bundle 事务提交失败');phase='两份资源已原子提交';
        await bridge?.syncResources?.({sessionId:session?.id,storeRevision:r.data.storeRevision});
        return notify(r.data.mounted?'正则包和预设已在同一次事务中保存并挂载':'正则包和预设已同时保存；打开剧情后可挂载');
      }
      if(artifact.kind==='regex_bundle'&&(mode==='regex'||mode==='preset')){
        if(mode==='regex'){
          const bundleId=await stableArtifactId(msg,'regex','regex-asst',sourceType);
          const checked=window.MimaRegexEngine.validatePack({...artifact.regexPack,id:bundleId,rules:(artifact.regexPack.rules||[]).map((r,i)=>({...r,id:r.id||`${bundleId}-rule-${i}`}))});
          if(!checked.ok)throw Error('正则无效：'+checked.invalid.map(x=>x.error).join('；'));
          const r=await window.MimaStandalone.handle('/regex-packs','POST',checked.pack);if(!r.success)throw Error(r.msg||'正则保存失败');savedRegex=r.data;
        }else{
          if(!artifact.preset?.content)throw Error('缺少预设内容');
          const r=await window.MimaStandalone.handle('/presets','POST',{...artifact.preset,id:await stableArtifactId(msg,'preset','preset-asst',sourceType)});if(!r.success)throw Error(r.msg||'预设保存失败');savedPreset=r.data;
        }
      }else if(artifact.kind==='preset'&&mode==='preset'){
        if(!artifact.preset?.content)throw Error('缺少预设内容');
        const r=await window.MimaStandalone.handle('/presets','POST',{...artifact.preset,id:await stableArtifactId(msg,'preset','preset-asst',sourceType)});if(!r.success)throw Error(r.msg||'预设保存失败');savedPreset=r.data;
      }
      if(artifact.kind==='css_preset'&&mode==='css'){
        const css=artifact.cssPreset;
        if(!String(css?.css||'').trim())throw Error('CSS 内容为空');
        if(!['app','global','story','novel','assistant'].includes(css.scope))throw Error('CSS 作用域未知，未写入数据');
        const input={...css,id:await stableArtifactId(msg,'css','css-asst',sourceType),atelierReleaseKey:''};
        if(css.scope==='app'){
          if(/[?&]noCss=1(?:&|$)/.test(window.location?.search||''))throw Error('当前是 CSS 紧急禁用模式，未提交新全局主题；请退出安全模式再应用');
          input.surface='global';
          const r=await window.MimaStandalone.handle('/assistant/css-publish','POST',{preset:input,prepareOnly:true});
          if(!r.success)throw Error(r.msg||'全局 CSS 保存失败');phase='CSS 已保存到库';savedCss=r.data.preset;
          const visual=await bridge?.applyCssPreset?.(savedCss.id,{surface:'global'});
          if(visual?.status!=='APPLIED')return notify(visual?.status==='SAVED_VISUAL_UNCERTAIN'?`全局 CSS「${savedCss.name}」已保存，显示安全待确认`:`CSS「${savedCss.name}」已保留在库中，应用尚未确认：${visual?.error||visual?.status||'显示未确认'}`);
          const selected=bridge?.getThemeSettings?.();
          if(selected?.globalCssPresetId!==savedCss.id)throw Error('全局选择回读与提交不一致，主库已提交但显示状态未知');
          return notify(`全局 CSS「${savedCss.name}」已保存并在全局画面生效`);
        }
        input.surface=css.scope==='novel'?'novel':css.scope==='assistant'?'assistant':'chat';
        const r=await window.MimaStandalone.handle('/css-presets','POST',input);if(!r.success)throw Error(r.msg||'CSS 保存失败');savedCss=r.data;phase='CSS 已保存';
        if(css.scope==='assistant'){await bridge?.reload?.();const applied=await applyCssPreset(savedCss.id);return notify(applied.status==='APPLIED'?`助手外观「${savedCss.name}」已保存并应用`:'外观已保存，当前应用未完成');}
        if(css.scope==='novel'){
          await bridge?.reload?.();return notify(`CSS「${savedCss.name}」已存入${css.scope==='novel'?'小说':'助手'}专用资源库；请在对应页面选择应用（当前剧情及全局主题未改变）`);
        }
      }
      phase='工件已保存';
      if(session?.id){
        const patch={sessionId:session.id,presetId:savedPreset?.id||'',regexId:savedRegex?.id||'',cssId:savedCss&&['story','global'].includes(savedCss.scope)?savedCss.id:''};
        if(patch.presetId||patch.regexId){
          // This exact session remains the target even if the user switches
          // stories while resource saving is pending. Backend uses latest
          // canonical lists, never the stale client-side session snapshot.
          const mounted=await window.MimaStandalone.handle('/assistant/mount','POST',{...patch,cssId:''});
          if(!mounted.success)throw Error(mounted.msg||'原剧情挂载失败，资源仍已保存');
        }
        if(patch.cssId){const visual=await bridge?.applyCssPreset?.(patch.cssId,cssTarget||{id:session.id,epoch:-1});if(visual?.status!=='APPLIED')return notify(`CSS「${savedCss.name}」已保留在库中，当前剧情应用未确认：${visual?.error||visual?.status||'显示未确认'}`);}
        await bridge?.syncResources?.({sessionId:session?.id});
      }
      if(savedCss)notify(session?`当前剧情 CSS「${savedCss.name}」已保存并选择；全局主题未改变`:`CSS「${savedCss.name}」已保存；进入剧情后可选择应用`);
      else if(savedRegex&&savedPreset)notify('正则包和配套预设已保存');
      else if(savedRegex)notify(session?`正则包「${savedRegex.name}」已保存并挂载`:`正则包「${savedRegex.name}」已保存`);
      else if(savedPreset)notify(session?`预设「${savedPreset.name}」已保存并挂载`:`预设「${savedPreset.name}」已保存`);
    }catch(e){notify(`${phase==='尚未提交'?'保存失败':phase+'，后续操作未完成'}：${e.message||e}。可再次执行同一工件以安全补完。`)}
  }

  async function reloadState(){if(stateOperationBusy){await stateOperationDone;if(storageProblem)throw Error(storageProblem);return clone(state);}captureComposer(true);retainInterruptedDraft();generationEpoch++;controller?.abort();controller=null;generating=false;const result=await recoverState();editingIndex=-1;regeneratingIndex=-1;draftAssistantText='';nextQuickMode='';generationMode='send';render();if(result.status==='FAILED')throw Error(result.error);return clone(state);}
  window.MimaAssistantStudio={takeTaskSource,saveTaskResource,useTaskVersion,startWorkSegment,previewRequest,buildTaskRequest,applyCssPreset,syncCssCatalog,reloadState,exportRawState,exportPortableState,previewPortableRestore,recoverState,flushProfileSave,validatePortableState,restorePortableState,open,close,switchType,setQuickMode,setConfigOpen,setProfileField,selectModel,loadModels,clearThread,startEdit,cancelEdit,saveEdit,deleteMessage,stop,send,regenerate,repairArtifact,followLatest,saveArtifact,inspectArtifact:raw=>clone(parseArtifactDetailed(raw)),getState:()=>clone(state)};
})();
