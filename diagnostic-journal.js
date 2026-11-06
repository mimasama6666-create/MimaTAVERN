/* MimaTAVERN native generation diagnostics: isolated from every canonical store.
   Automatic Prompt assembly, Memory and generation never consume this database.
   Only an explicitly confirmed manual recovery may copy a retained reply back.
   Failed writes are reported, never used to classify a model reply as successful. */
(()=>{'use strict';
 const DB='MimaTAVERN_Native_Diagnostics_V1',STORE='entries',CANDIDATES='full_candidates',META='entry_meta_v1',MAINT='diagnostic_meta_state_v1';
 const LIMIT_COUNT=30,LIMIT_DAYS=14,LIMIT_BYTES=24*1024*1024,MAX_REQUEST_CHARS=4*1024*1024,MAX_BAD_REPLY_CHARS=128*1024;
 let dbPromise=null,queue=Promise.resolve(),lastError='';
 const pickString=(s,max)=>String(s??'').slice(0,max);
 function notice(e){lastError=`${e?.name||'StorageError'}：${e?.message||String(e)}`;console.error('咪嘛馆诊断日志无法持久化（未改写剧情数据库）',e);}
 function open(){
   if(!('indexedDB' in window))return Promise.reject(new Error('当前浏览器不支持 IndexedDB，无法保留诊断日志'));
   if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
     const r=indexedDB.open(DB,4);
     r.onupgradeneeded=(upgrade)=>{
       const db=r.result,st=db.objectStoreNames.contains(STORE)?r.transaction.objectStore(STORE):db.createObjectStore(STORE,{keyPath:'id'});
       // Upgrade the existing diagnostic store in place. IndexedDB builds this
       // index for legacy rows without copying them into application memory.
       if(!st.indexNames.contains('sessionId'))st.createIndex('sessionId','sessionId',{unique:false});
       if(!st.indexNames.contains('traceId'))st.createIndex('traceId','traceId',{unique:false});
       if(!db.objectStoreNames.contains(CANDIDATES))db.createObjectStore(CANDIDATES,{keyPath:'id'});
       const meta=db.objectStoreNames.contains(META)?r.transaction.objectStore(META):db.createObjectStore(META,{keyPath:'id'});
       if(!meta.indexNames.contains('createdAtMs'))meta.createIndex('createdAtMs','createdAtMs');
       if(!meta.indexNames.contains('sessionId'))meta.createIndex('sessionId','sessionId');
       if(!meta.indexNames.contains('generation'))meta.createIndex('generation',['sessionId','generationId','generationAttempt','action']);
       if(!db.objectStoreNames.contains(MAINT))db.createObjectStore(MAINT,{keyPath:'id'});
       // Brand-new installations have no legacy rows to migrate.
       if(upgrade.oldVersion===0)r.transaction.objectStore(MAINT).put({id:'migration',entriesDone:true,candidatesDone:true,entryKey:null,candidateKey:null});
     };
     r.onerror=()=>reject(r.error||new Error('诊断数据库打开失败'));
     r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();dbPromise=null};resolve(db);};
     r.onblocked=()=>reject(new Error('其他标签正在升级诊断日志数据库'));
   }).catch(e=>{dbPromise=null;throw e});
   return dbPromise;
 }
 function waitRequest(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('诊断存储请求失败'))})}
 // Metadata is the only input to routine pruning and list rendering. A legacy
 // full row is materialized only once in a bounded, resumable migration batch.
 function transact(job){const next=queue.then(job).then(value=>{lastError='';return value});queue=next.catch(notice);return next;}
 function finished(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('诊断日志事务已中止'));tx.onerror=()=>reject(tx.error||new Error('诊断日志事务失败'));});}
 function roughSize(row){try{return JSON.stringify(row).length*2}catch(_){return null;}}
 function metadata(row,prior=null){
   return {id:String(row.id),sessionId:String(row.sessionId||''),traceId:String(row.traceId||''),
     action:String(row.action||''),turnId:String(row.turnId||''),requestId:String(row.requestId||''),
     generationId:String(row.generationId||''),generationAttempt:Number(row.generationAttempt)||0,
     createdAt:String(row.createdAt||''),createdAtMs:Number.isFinite(Number(row.createdAtMs))&&Number(row.createdAtMs)>0?Number(row.createdAtMs):null,
     status:String(row.status||''),model:String(row.model||''),phase:String(row.phase||''),
     finishKind:String(row.finishKind||''),finishReason:String(row.finishReason||''),
     errorCode:String(row.error?.code||''),httpStatus:Number(row.transport?.httpStatus||row.error?.status)||0,
     requestSent:row.requestSent!==false,manualRecovery:!!row.manualRecovery,
     entryBytes:roughSize(row),candidateBytes:prior?.candidateBytes??0,
     hasCandidate:prior?.hasCandidate===true,settledAt:row.settledAt||null,
     revision:(Number(prior?.revision)||0)+1};
 }
 const BATCH=6;
 // The checkpoint and metadata rows are updated in the very same transaction;
 // refreshing mid-upgrade repeats at most the unfinished batch, never clears data.
 async function migrationStep(){
   const db=await open(),tx=db.transaction([STORE,CANDIDATES,META,MAINT],'readwrite');
   const entries=tx.objectStore(STORE),candidates=tx.objectStore(CANDIDATES),meta=tx.objectStore(META),control=tx.objectStore(MAINT);
   const saved=await waitRequest(control.get('migration'));
   const state=saved||{id:'migration',entriesDone:false,candidatesDone:false,entryKey:null,candidateKey:null};
   if(!state.entriesDone){
     const range=state.entryKey==null?null:IDBKeyRange.lowerBound(state.entryKey,true);
     const keys=await waitRequest(entries.getAllKeys(range,BATCH));
     for(const id of keys){
       const existing=await waitRequest(meta.get(id));
       if(!existing){const row=await waitRequest(entries.get(id));if(row){
         const candidate=await waitRequest(candidates.get(id));
         const m=metadata(row);if(candidate){m.hasCandidate=true;m.candidateBytes=roughSize(candidate);}meta.put(m);
       }}
     }
     if(keys.length)state.entryKey=keys[keys.length-1];
     if(keys.length<BATCH)state.entriesDone=true;
   }else if(!state.candidatesDone){
     // Check orphan candidates by primary KEY only. Orphans are preserved
     // during migration; subsequent maintenance may discard only verified orphans.
     const range=state.candidateKey==null?null:IDBKeyRange.lowerBound(state.candidateKey,true);
     const keys=await waitRequest(candidates.getAllKeys(range,BATCH));
     for(const id of keys){
       const m=await waitRequest(meta.get(id));
       if(m&&!m.hasCandidate){const c=await waitRequest(candidates.get(id));
         if(c){m.hasCandidate=true;m.candidateBytes=roughSize(c);m.revision++;meta.put(m);}}
       else if(!m){
         const parent=await waitRequest(entries.get(id));
         if(!parent){const c=await waitRequest(candidates.get(id));if(c){
           // A legacy orphan has no verified generation identity. Preserve the
           // bytes until their own 14-day expiry; never attach them to a new turn.
           const at=Date.parse(c.storedAt||'');
           meta.put({id:String(id),sessionId:'',createdAtMs:Number.isFinite(at)?at:Date.now(),
             status:'orphan',orphan:true,entryBytes:0,candidateBytes:roughSize(c),hasCandidate:true,revision:1});
         }}
       }
     }
     if(keys.length)state.candidateKey=keys[keys.length-1];
     if(keys.length<BATCH)state.candidatesDone=true;
   }
   control.put(state);await finished(tx);
   return state.entriesDone&&state.candidatesDone;
 }
 // Strictly no destructive prune while the legacy metadata view is incomplete.
 async function migrated(){
   const db=await open(),tx=db.transaction(MAINT,'readonly');
   const state=await waitRequest(tx.objectStore(MAINT).get('migration'));
   return state?.entriesDone===true&&state?.candidatesDone===true;
 }
 async function ensureMigrated(){
   // Each IndexedDB transaction yields control back to the browser. No onupgrade
   // cursor clones a multi-megabyte Prompt into a single JavaScript array.
   while(!(await migrated()))await migrationStep();
 }
 async function prune(){
   if(!(await migrated()))return false;
   const db=await open(),tx=db.transaction(META,'readonly');
   const rows=await waitRequest(tx.objectStore(META).getAll());
   if(rows.some(m=>!Number.isSafeInteger(m.entryBytes)||m.entryBytes<0||!Number.isFinite(m.createdAtMs)||m.createdAtMs<=0||
     (m.hasCandidate&&(!Number.isSafeInteger(m.candidateBytes)||m.candidateBytes<0))))
     throw Error('E_DIAGNOSTIC_METADATA_INCOMPLETE: 已停止自动清理，原始记录未变更');
   rows.sort((a,b)=>b.createdAtMs-a.createdAtMs||String(b.id).localeCompare(String(a.id)));
   const cutoff=Date.now()-LIMIT_DAYS*86400000,deletes=[];let kept=0,bytes=0,pinned=0;
   for(const m of rows){
     const size=m.entryBytes+(m.hasCandidate?m.candidateBytes:0);
     const active=['preparing','requesting','provider_returned'].includes(m.status)&&m.createdAtMs>=Date.now()-12*3600000;
     const expired=m.createdAtMs<cutoff;
     if(m.orphan&&!expired){pinned++;continue;}
     if(expired||(!m.hasCandidate&&!active&&(kept>=LIMIT_COUNT||bytes+size>LIMIT_BYTES))){deletes.push(m);continue;}
     kept++;bytes+=size;if(m.hasCandidate)pinned++;
   }
   // Re-check revision and candidate ownership in the WRITE transaction. A
   // second tab that retained a reply after the read can never lose it here.
   for(let i=0;i<deletes.length;i+=BATCH){
     const part=deletes.slice(i,i+BATCH),t=db.transaction([STORE,CANDIDATES,META],'readwrite');
     const ms=t.objectStore(META),es=t.objectStore(STORE),cs=t.objectStore(CANDIDATES);
     for(const old of part){const live=await waitRequest(ms.get(old.id));
       if(!live||live.revision!==old.revision||live.hasCandidate!==old.hasCandidate)continue;
       es.delete(old.id);cs.delete(old.id);ms.delete(old.id);
     }
     await finished(t);
   }
   if(bytes>LIMIT_BYTES)console.warn('E_DIAGNOSTIC_SOFT_LIMIT: 完整恢复原文优先保留',{bytes,limit:LIMIT_BYTES,pinned});
   return true;
 }
 // A new generation never initiates a V3 full-Prompt migration. Migration
 // runs on explicit diagnostic access, in short resumable batches. A migrated
 // database retains the normal soft cleanup schedule using metadata only.
 function scheduleMaintenance(){
   Promise.resolve().then(async()=>{if(await migrated())await prune();}).catch(notice);
 }
 function issueId(){return 'd_'+Date.now().toString(36)+'_'+(window.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));}
 function begin({sessionId,action,turnId,attemptId,traceId}={}){
   if(!sessionId)return null;
   const id=issueId(),row={id,sessionId:String(sessionId),turnId:pickString(turnId,100),action:pickString(action,40),createdAt:new Date().toISOString(),createdAtMs:Date.now(),status:'preparing',model:'',requestId:'',messageCount:0,request:null,requestTruncated:false,rawRejectedReply:'',rejectedReplyTruncated:false,error:null,finishKind:'',finishReason:'',settledAt:null};
   row.traceId=pickString(traceId,120);row.replyCaptureVersion=1;if(attemptId)row.attemptId=pickString(attemptId,120);
   void transact(async()=>{const db=await open(),tx=db.transaction([STORE,META],'readwrite');tx.objectStore(STORE).put(row);tx.objectStore(META).put(metadata(row));await finished(tx);}).then(scheduleMaintenance).catch(()=>{});
   return id;
 }
 function event(id,data={}){
   if(!id||!data||!['generation_prepared','dispatch_attempt','request','transport_response','provider_result','settlement','manual_recovery','timing','preflight_failure','transformation_provenance'].includes(data.type))return Promise.resolve();
   return transact(async()=>{
     const db=await open();const tx=db.transaction([STORE,META],'readwrite'),st=tx.objectStore(STORE),ms=tx.objectStore(META),row=await waitRequest(st.get(id));
     // Deleting a record is final, even if a request still runs.
     if(row){
       if(data.type==='generation_prepared'){
         // Write correlation before fetch. Even when the later request-logging
         // transaction fails, verified primary fragments can still be found.
         row.generationId=pickString(data.generationId,120);
         row.generationAttempt=Number(data.generationAttempt)||null;
         row.model=pickString(data.model||row.model,160);
         row.ownerTraceId=pickString(data.ownerTraceId,120);
       }else if(data.type==='dispatch_attempt'){
         row.generationId=pickString(data.generationId||row.generationId,120);
         row.generationAttempt=Number(data.generationAttempt)||row.generationAttempt||null;
         row.model=pickString(data.model||row.model,160);
         row.requestDispatchAttempted=true;
       }else if(data.type==='preflight_failure'){
         row.status='rejected';row.phase='preflight';row.requestSent=false;row.settledAt=new Date().toISOString();
         row.model=pickString(data.model,160);row.endpointOrigin=pickString(data.endpointOrigin,260);
         row.configuredWindow=Number(data.configuredWindow)||0;row.sourceCount=Number(data.sourceCount)||0;
         row.preparationElapsedMs=Number(data.preparationElapsedMs)||0;
         row.error={code:pickString(data.code,120),message:pickString(data.message,3000),details:pickString(data.details,6000),status:0};
       }else if(data.type==='request'){
         const req=data.request||{},safe={model:String(req.model??''),messages:Array.isArray(req.messages)?req.messages.map(m=>({role:String(m.role??''),content:String(m.content??''),...(m.prefix===true?{prefix:true}:{})})):[]};
         for(const key of ['stream','temperature','max_tokens','top_p','reasoning_effort'])if(Object.hasOwn(req,key))safe[key]=req[key];
         // Always keep bounded, non-sensitive evidence even when messages exceed
         // the request-preview size ceiling. Do not store arbitrary extra_body.
         row.requestMeta={model:safe.model,
           max_tokens:Number.isSafeInteger(req.max_tokens)&&req.max_tokens>=0?req.max_tokens:null,
           top_p:Number.isFinite(req.top_p)&&req.top_p>=0&&req.top_p<=1?req.top_p:null,
           reasoning_effort:['low','medium','high'].includes(req.reasoning_effort)?req.reasoning_effort:null,
           temperature:Number.isFinite(req.temperature)?req.temperature:null,
           stream:req.stream===true,
           gemini_thoughts:req.extra_body?.google?.thinking_config?.include_thoughts===true};
         // Exact protocol body, plus source metadata outside the messages. No credentials or headers.
         const sourceKeys=['kind','sourceId','messageId','resourceId','name','section','path','slot','declaredRole','originalRole','depth','position','priority','positionAdaptation','authorVariables'];
         row.messageSources=Array.isArray(data.messageSources)?data.messageSources.map(source=>Object.fromEntries(sourceKeys.filter(key=>Object.hasOwn(source||{},key)).map(key=>[key,source[key]]))):[];
         const all=JSON.stringify(safe);
         row.request=all.length<=MAX_REQUEST_CHARS?safe:null;
         row.requestTruncated=all.length>MAX_REQUEST_CHARS;
         row.requestChars=all.length;row.messageCount=safe.messages.length;row.model=safe.model;row.requestId=pickString(data.requestId,120);row.endpointOrigin=pickString(data.endpointOrigin,260);row.status='requesting';
         row.requestSent=true;row.requestDispatchAttempted=true;
         row.requestBytes=Number(data.requestBytes)||0;row.preparationElapsedMs=Number.isFinite(data.preparationElapsedMs)?data.preparationElapsedMs:null;
         row.serializationElapsedMs=Number(data.serializationElapsedMs)||0;row.generationId=pickString(data.generationId,120);row.generationAttempt=Number(data.generationAttempt)||null;
       }else if(data.type==='timing'){
         row.timings=Array.isArray(row.timings)?row.timings:[];
         row.timings.push({phase:pickString(data.phase,80),requestId:pickString(data.requestId||row.requestId,120),
           generationId:pickString(data.generationId||row.generationId,120),
           generationAttempt:Number(data.attempt)||row.generationAttempt||null,
           elapsedAfterPreparedMs:Number.isFinite(data.elapsedAfterPreparedMs)?Number(data.elapsedAfterPreparedMs):null,
           elapsedFromTransportMs:Number.isFinite(data.elapsedFromTransportMs)?Number(data.elapsedFromTransportMs):null,
           preparationElapsedMs:Number.isFinite(data.preparationElapsedMs)?Number(data.preparationElapsedMs):null,
           serializationElapsedMs:Number.isFinite(data.serializationElapsedMs)?Number(data.serializationElapsedMs):null,
           httpStatus:Number(data.httpStatus)||0,requestBytes:Number(data.requestBytes)||0,
           receivedChars:Number(data.receivedChars)||0,receivedBytes:Number(data.receivedBytes)||0,
           eventCount:Number(data.eventCount)||0,badEvents:Number(data.badEvents)||0,readCount:Number(data.readCount)||0,
           lastReadAt:Number(data.lastReadAt)||0,lastDeltaAt:Number(data.lastDeltaAt)||0,
           transportStage:pickString(data.transportStage,40),signalAborted:data.signalAborted===true,
           visibility:pickString(data.visibility,30),errorName:pickString(data.errorName,60),
           errorMessage:pickString(data.errorMessage,160),
           chars:Number(data.chars)||0,messageCount:Number(data.messageCount)||0,
           recordedAt:new Date().toISOString()});
         row.timings=row.timings.slice(-48);
       }else if(data.type==='transformation_provenance'){
         // Hash-only provenance, never copy private raw text into a metadata row.
         row.transformations=Array.isArray(row.transformations)?row.transformations:[];
         row.transformations.push({generationId:pickString(data.generationId,120),attempt:Number(data.attempt)||null,
           raw:data.raw,canonical:data.canonical,display:data.display,
           regexVersions:data.regexVersions,admissionStage:pickString(data.admissionStage,120),contractMode:pickString(data.contractMode,80),recordedAt:new Date().toISOString()});
         row.transformations=row.transformations.slice(-12);
       }else if(data.type==='transport_response'){
         row.requestDispatchAttempted=true;row.requestSent=true;
         row.transport={requestStartedAt:pickString(data.requestStartedAt,50),responseReceivedAt:pickString(data.responseReceivedAt,50),fetchElapsedMs:Number(data.fetchElapsedMs)||0,httpStatus:Number(data.httpStatus)||0,
           providerRequestId:pickString(data.providerRequestId,200),cfRay:pickString(data.cfRay,200)};
       }else if(data.type==='provider_result'){
         row.finishKind=pickString(data.finishKind,50);row.finishReason=pickString(data.finishReason,120);row.responseChars=Number(data.responseChars)||0;row.status='provider_returned';
       }else if(data.type==='manual_recovery'){
         // Keep the original rejection, finish flag and retained evidence intact.
         row.manualRecovery={restoredAt:new Date().toISOString(),messageId:pickString(data.messageId,120),action:pickString(data.action,40)};
       }else if(data.type==='settlement'){
         row.status=['committed','rejected','aborted','conflict'].includes(data.status)?data.status:'rejected';
         row.settledAt=new Date().toISOString();row.finishKind=pickString(data.finishKind||row.finishKind,50);row.finishReason=pickString(data.finishReason||row.finishReason,120);
         if(row.status!=='committed'){
           const raw=String(data.rawRejectedReply??'');row.rawRejectedReply=raw.slice(0,MAX_BAD_REPLY_CHARS);row.rejectedReplyTruncated=raw.length>MAX_BAD_REPLY_CHARS||data.rawLimited===true;
           row.error={code:pickString(data.code,120),message:pickString(data.message,3000),details:pickString(data.details,6000),status:Number(data.httpStatus)||0};
         }
       }
       st.put(row);const old=await waitRequest(ms.get(id));ms.put(metadata(row,old));
     }
     await finished(tx);
     // Retention is checked on new diagnostic creation and when the owner opens
     // the diagnostic list. Pruning on *every* SSE/timing/settlement event copied
     // all long Prompts into JS during generation and the failure popup.
   });
 }
 // Never join UI events using the legacy page-local turnId. Exact traceId
 // joins are required; unmatched or ambiguous events cannot modify history.
 function uiTiming({sessionId,traceId,phase,elapsedSinceUiSubmitMs,paintDurationMs,paintCount,chars,maxPaintDurationMs,totalPaintDurationMs,lastVisibility,receivedChars,regexParsedChars,htmlSanitizedChars,htmlCachedChars,stableHtmlNodes,fullDomPatches}={}){
   if(!sessionId||!/^gen_[a-f0-9-]{20,80}$/i.test(String(traceId||''))||!/^ui_(first_visible|last_visible|final_stable)$/.test(String(phase||'')))return Promise.resolve();
   return transact(async()=>{
     const db=await open(),tx=db.transaction([STORE,META],'readwrite'),st=tx.objectStore(STORE),ms=tx.objectStore(META);
     // Version 3 indexes all old and new trace IDs. Query *keys*, never clone
     // all diagnostic entries (which can include multi-megabyte Prompts).
     if(!st.indexNames.contains('traceId'))throw Error('E_DIAGNOSTIC_TRACE_INDEX_MISSING');
     const keys=await waitRequest(st.index('traceId').getAllKeys(IDBKeyRange.only(String(traceId)),2));
     if(keys.length>1)throw Error('E_DIAGNOSTIC_TRACE_COLLISION');
     if(keys.length===1){
       const latest=await waitRequest(st.get(keys[0]));
       // Verify BOTH identities after key lookup. Late events must not be
       // written to a new request, nor to a record that has been deleted.
       if(latest&&latest.sessionId===String(sessionId)&&latest.traceId===String(traceId)){
         latest.uiTimings=latest.uiTimings&&typeof latest.uiTimings==='object'?latest.uiTimings:{};
         latest.uiTimings[phase]={elapsedSinceUiSubmitMs:Number(elapsedSinceUiSubmitMs)||0,paintDurationMs:Number(paintDurationMs)||0,
           paintCount:Number(paintCount)||0,chars:Number(chars)||0,
           maxPaintDurationMs:Number(maxPaintDurationMs)||0,totalPaintDurationMs:Number(totalPaintDurationMs)||0,
           lastVisibility:['visible','hidden','prerender','unknown'].includes(lastVisibility)?lastVisibility:'unknown',
           receivedChars:Number(receivedChars)||0,
           regexParsedChars:Number(regexParsedChars)||0,htmlSanitizedChars:Number(htmlSanitizedChars)||0,
           htmlCachedChars:Number(htmlCachedChars)||0,stableHtmlNodes:Number(stableHtmlNodes)||0,
           fullDomPatches:Number(fullDomPatches)||0,
           recordedAt:new Date().toISOString(),generationId:latest.generationId||''};
         st.put(latest);const old=await waitRequest(ms.get(latest.id));ms.put(metadata(latest,old));
       }
     }
     await finished(tx);
   });
 }
 async function get(id){
   await queue;const db=await open(),tx=db.transaction(STORE,'readonly'),done=finished(tx);
   const row=await waitRequest(tx.objectStore(STORE).get(String(id)));await done;return row||null;
 }
 // A format-rejected full Provider reply must never depend on the 128 KiB
 // diagnostic preview or automatic 14-day pruning. Keep the original immutable
 // bytes under diagnosticId, outside canonical History/Memory, before admission.
 async function retainCandidate(id,raw,canonical=null){
   if(!id||typeof raw!=='string'||!raw.length)throw Error('E_CANDIDATE_SOURCE_INVALID');
   const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const rawDigest=await digest(raw),canonicalDigest=typeof canonical==='string'?await digest(canonical):null;
   return transact(async()=>{const db=await open(),tx=db.transaction([STORE,CANDIDATES,META],'readwrite');
     const st=tx.objectStore(CANDIDATES),es=tx.objectStore(STORE),ms=tx.objectStore(META);
     const row=await waitRequest(es.get(id));if(!row)throw Error('E_DIAGNOSTIC_PARENT_MISSING');
     const old=await waitRequest(st.get(id));if(old&&old.rawDigest!==rawDigest)throw Error('E_CANDIDATE_IMMUTABLE_CONFLICT');
     const candidate=old||{id,raw,rawChars:raw.length,rawDigest,canonicalDigest,storedAt:new Date().toISOString(),completeRaw:true};
     if(!old)st.add(candidate);
     const prior=await waitRequest(ms.get(id));const m=metadata(row,prior);m.hasCandidate=true;m.candidateBytes=roughSize(candidate);ms.put(m);
     await finished(tx);return {id,rawChars:raw.length,rawDigest,completeRaw:true};
   });
 }
 async function discardCandidate(id){return transact(async()=>{
   const db=await open(),tx=db.transaction([STORE,CANDIDATES,META],'readwrite'),es=tx.objectStore(STORE),ms=tx.objectStore(META);
   tx.objectStore(CANDIDATES).delete(id);const row=await waitRequest(es.get(id));
   if(row){const old=await waitRequest(ms.get(id));const m=metadata(row,old);m.hasCandidate=false;m.candidateBytes=0;ms.put(m);}
   await finished(tx);
 });}
 async function fullCandidate(id){await queue;const db=await open(),tx=db.transaction(CANDIDATES,'readonly');return (await waitRequest(tx.objectStore(CANDIDATES).get(String(id))))||null;}
 async function recoverySource(record){
   const saved=await fullCandidate(record.id);
   if(saved)return {id:record.id,raw:saved.raw,rawChars:saved.rawChars,complete:true,digest:saved.rawDigest,source:'full_candidate'};
   const raw=String(record.rawRejectedReply||'');
   const legacyLimited=String(record.action||'').startsWith('compat_')&&raw.length===24000&&!record.replyCaptureVersion;
   let ledgerReadError='';
   if(record.phase!=='preflight'&&record.status!=='committed'&&!String(record.action||'').startsWith('compat_')&&record.generationId&&Number.isInteger(record.generationAttempt)&&window.MimaLocalStore?.generationRead){
     try{
     // A missing diagnostic 'request' event does not mean fetch never ran. Use
     // the independently committed generation identity and stream receipt.
     // Never borrow fragments from a different owner, or mix conflicting text.
     const read=await window.MimaLocalStore.generationRead({sessionId:record.sessionId,generationId:record.generationId,attempt:record.generationAttempt});
     const receipt=read.receipt;
     const ownerMatches=!record.traceId||!receipt?.ownerId||receipt.ownerId===record.traceId;
     const dispatched=receipt?.requestDispatchAttempted===true||record.requestDispatchAttempted===true||record.requestSent===true||!!record.transport?.responseReceivedAt;
     const last=record.request?.messages?.at(-1),prefix=last?.role==='assistant'&&last.prefix===true?String(last.content||''):'';
     let matches=typeof read.text==='string'&&read.text.startsWith(raw),prefixObserved=false;
     if(!matches&&prefix){
       if(raw.startsWith(prefix)){matches=read.text?.startsWith(raw.slice(prefix.length));prefixObserved=matches&&raw.length>prefix.length;}
       else if(prefix.startsWith(raw))matches=true;
     }
     if(dispatched&&ownerMatches&&read.complete&&read.text?.trim()&&matches&&read.text.length>=raw.length&&(!raw||record.rejectedReplyTruncated||read.text.length>raw.length)){
       const expected=Math.max(prefixObserved?0:Number(record.responseChars)||0,...(record.timings||[]).map(t=>Math.max(0,(Number(t.receivedChars)||0)-(prefixObserved&&['first_visible_delta','last_delta','stream_finish'].includes(t.phase)?prefix.length:0),Number(t.chars)||0)));
       // Contiguous local fragments are not proof the provider completed. An
       // interrupted stream stays explicitly PARTIAL even when locally intact.
       const complete=record.finishKind==='complete'&&expected>0&&read.text.length>=expected;
       return {id:record.id,raw:read.text,rawChars:read.text.length,complete,digest:null,source:'stream_fragments'};
     }
     }catch(error){ledgerReadError=String(error?.message||error);console.warn('独立流式账本读取失败，保留现有诊断原文',{diagnosticId:record.id,error});}
   }
   return {id:record.id,raw,rawChars:raw.length,complete:!!raw&&!record.rejectedReplyTruncated&&!legacyLimited,digest:null,source:'diagnostic_preview',...(ledgerReadError?{ledgerReadError}:{})};
 }
 async function candidatePreview(id){const record=await get(id);if(!record)throw Error('诊断记录不存在');return recoverySource(record);
 }
 async function recoveryCandidate(id,{allowPartial=false,allowUnsettled=false}={}){
   const row=await get(id),bad=message=>{throw Object.assign(new Error(message),{code:'E_REPLY_RECOVERY_UNAVAILABLE'});};
   if(!row)bad('诊断记录已清理，无法恢复。');
   if(!['rejected','aborted','conflict'].includes(row.status)&&!(allowUnsettled===true&&['requesting','provider_returned'].includes(row.status)&&row.generationId&&Number.isInteger(row.generationAttempt)))bad('本记录不是已结算的坏回复，也不是经主人确认的原生未结算请求。');
   const candidate=await recoverySource(row);
   if(!candidate.raw.trim())bad('这条日志没有收到可恢复的正文；不会重新请求模型。');
   if(!candidate.complete&&!allowPartial)bad('当前仅保留了部分正文，可在手动恢复时确认恢复现有片段；不会补造缺失文字。');
   row.rawRejectedReply=candidate.raw;row.rejectedReplyTruncated=!candidate.complete;
   row.fullCandidateVerified=candidate.source==='full_candidate';row.recoverySource=candidate.source;row.recoveryIsPartial=!candidate.complete;
   return row;
 }
 // Metadata-only identity lookup; never opens an entries cursor for each
 // failed stream and never promotes a still-running generation to a failure.
 async function findGeneration({sessionId,generationId,attempt,action,statuses=null}={}){
   if(!sessionId||!generationId||!Number.isSafeInteger(Number(attempt))||!action)return null;
   await queue;const db=await open();
   const query=async()=>{const tx=db.transaction(META,'readonly'),index=tx.objectStore(META).index('generation');
     const rows=await waitRequest(index.getAll(IDBKeyRange.only([String(sessionId),String(generationId),Number(attempt),String(action)])));
     return rows.filter(x=>!statuses||statuses.includes(x.status)).sort((a,b)=>b.createdAtMs-a.createdAtMs)[0]||null;};
   let found=await query();if(!found&&!(await migrated())){await ensureMigrated();found=await query();}
   return found;
 }
 function findFailedGeneration(identity){return findGeneration({...identity,statuses:['rejected','aborted','conflict']});}
 async function listSummaries({sessionId=null,errorsOnly=false,cursor=0,limit=20}={}){
   await queue;await ensureMigrated();try{await prune();}catch(error){notice(error);}
   const db=await open(),tx=db.transaction(META,'readonly'),meta=tx.objectStore(META);
   const rows=await waitRequest(sessionId?meta.index('sessionId').getAll(IDBKeyRange.only(String(sessionId))):meta.getAll());
   const matches=rows.filter(r=>!r.orphan&&(!errorsOnly||['rejected','aborted','conflict'].includes(r.status)))
     .sort((a,b)=>b.createdAtMs-a.createdAtMs||String(b.id).localeCompare(String(a.id)));
   const start=Number.isSafeInteger(Number(cursor))?Math.max(0,Number(cursor)):0;
   const count=Math.max(1,Math.min(50,Number(limit)||20));
   return {items:matches.slice(start,start+count),nextCursor:start+count<matches.length?start+count:null,total:matches.length};
 }
 // Legacy API is intentionally retained for callers explicitly requesting
 // full records, never used to populate the interactive diagnostics page.
 async function list({sessionId=null,errorsOnly=false}={}){
   const out=await listSummaries({sessionId,errorsOnly,limit:50}),rows=[];let page=out;
   for(;;){for(const item of page.items){const row=await get(item.id);if(row)rows.push(row);}
     if(page.nextCursor==null)break;
     page=await listSummaries({sessionId,errorsOnly,cursor:page.nextCursor,limit:50});
   }
   return rows;
 }
 function remove(id){return transact(async()=>{const db=await open(),tx=db.transaction([STORE,CANDIDATES,META],'readwrite');
   tx.objectStore(STORE).delete(id);tx.objectStore(CANDIDATES).delete(id);tx.objectStore(META).delete(id);await finished(tx);
 });}
 function clearSession(sessionId){return transact(async()=>{
   await ensureMigrated();const db=await open(),tx=db.transaction(META,'readonly');
   const rows=await waitRequest(tx.objectStore(META).index('sessionId').getAllKeys(IDBKeyRange.only(String(sessionId))));
   for(let i=0;i<rows.length;i+=BATCH){const t=db.transaction([STORE,CANDIDATES,META],'readwrite');
     for(const id of rows.slice(i,i+BATCH)){const live=await waitRequest(t.objectStore(META).get(id));
       if(live?.sessionId!==String(sessionId))continue;
       t.objectStore(STORE).delete(id);t.objectStore(CANDIDATES).delete(id);t.objectStore(META).delete(id);
     }await finished(t);
   }
 });}
 function clearAll(){return transact(async()=>{const db=await open(),tx=db.transaction([STORE,CANDIDATES,META,MAINT],'readwrite');
   for(const name of [STORE,CANDIDATES,META,MAINT])tx.objectStore(name).clear();await finished(tx);
 });}
 function status(){return {error:lastError,limitCount:LIMIT_COUNT,limitDays:LIMIT_DAYS,limitBytes:LIMIT_BYTES,database:DB};}
 window.MimaDiagnosticJournal=Object.freeze({begin,event,uiTiming,get,findGeneration,findFailedGeneration,recoveryCandidate,retainCandidate,discardCandidate,fullCandidate,candidatePreview,listSummaries,list,remove,clearSession,clearAll,status});
})();
