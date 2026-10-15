/* MimaTAVERN native generation diagnostics: isolated from every canonical store.
   Automatic Prompt assembly, Memory and generation never consume this database.
   Only an explicitly confirmed manual recovery may copy a retained reply back.
   Failed writes are reported, never used to classify a model reply as successful. */
(()=>{'use strict';
 const DB='MimaTAVERN_Native_Diagnostics_V1',STORE='entries';
 const LIMIT_COUNT=30,LIMIT_DAYS=14,LIMIT_BYTES=24*1024*1024,MAX_REQUEST_CHARS=4*1024*1024,MAX_BAD_REPLY_CHARS=128*1024;
 let dbPromise=null,queue=Promise.resolve(),lastError='';
 const pickString=(s,max)=>String(s??'').slice(0,max);
 function notice(e){lastError=`${e?.name||'StorageError'}：${e?.message||String(e)}`;console.error('咪嘛馆诊断日志无法持久化（未改写剧情数据库）',e);}
 function open(){
   if(!('indexedDB' in window))return Promise.reject(new Error('当前浏览器不支持 IndexedDB，无法保留诊断日志'));
   if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
     const r=indexedDB.open(DB,1);
     r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE)){const store=db.createObjectStore(STORE,{keyPath:'id'});store.createIndex('sessionId','sessionId',{unique:false});}};
     r.onerror=()=>reject(r.error||new Error('诊断数据库打开失败'));
     r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();dbPromise=null};resolve(db);};
     r.onblocked=()=>reject(new Error('其他标签正在升级诊断日志数据库'));
   }).catch(e=>{dbPromise=null;throw e});
   return dbPromise;
 }
 function waitRequest(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('诊断存储请求失败'))})}
 async function readAll(){const db=await open();const tx=db.transaction(STORE,'readonly');return waitRequest(tx.objectStore(STORE).getAll());}
 function transact(job){const next=queue.then(job).then(value=>{lastError='';return value});queue=next.catch(notice);return next;}
 function finished(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('诊断日志事务已中止'));tx.onerror=()=>reject(tx.error||new Error('诊断日志事务失败'))})}
 function roughSize(row){try{return JSON.stringify(row).length*2}catch(_){return 0}}
 async function prune(){
   const db=await open(),rows=await readAll(),now=Date.now();
   rows.sort((a,b)=>Number(b.createdAtMs||0)-Number(a.createdAtMs||0));
   const deletes=[],cutoff=now-LIMIT_DAYS*86400000;let kept=0,bytes=0;
   for(const row of rows){const size=roughSize(row);if(Number(row.createdAtMs||0)<cutoff||kept>=LIMIT_COUNT||bytes+size>LIMIT_BYTES)deletes.push(row.id);else{kept++;bytes+=size;}}
   if(deletes.length){const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);deletes.forEach(id=>st.delete(id));await finished(tx);}
 }
 function issueId(){return 'd_'+Date.now().toString(36)+'_'+(window.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));}
 function begin({sessionId,action,turnId,attemptId}={}){
   if(!sessionId)return null;
   const id=issueId(),row={id,sessionId:String(sessionId),turnId:pickString(turnId,100),action:pickString(action,40),createdAt:new Date().toISOString(),createdAtMs:Date.now(),status:'preparing',model:'',requestId:'',messageCount:0,request:null,requestTruncated:false,rawRejectedReply:'',rejectedReplyTruncated:false,error:null,finishKind:'',finishReason:'',settledAt:null};
   row.replyCaptureVersion=1;if(attemptId)row.attemptId=pickString(attemptId,120);
   void transact(async()=>{const db=await open(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(row);await finished(tx);await prune();});
   return id;
 }
 function event(id,data={}){
   if(!id||!data||!['request','transport_response','provider_result','settlement','manual_recovery'].includes(data.type))return Promise.resolve();
   return transact(async()=>{
     const db=await open();const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),row=await waitRequest(st.get(id));
     // Deleting a record is final, even if a request still runs.
     if(row){
       if(data.type==='request'){
         const req=data.request||{},safe={model:String(req.model??''),messages:Array.isArray(req.messages)?req.messages.map(m=>({role:String(m.role??''),content:String(m.content??''),...(m.prefix===true?{prefix:true}:{})})):[]};
         for(const key of ['stream','temperature','max_tokens'])if(Object.hasOwn(req,key))safe[key]=req[key];
         // Exact protocol body, plus source metadata outside the messages. No credentials or headers.
         const sourceKeys=['kind','sourceId','messageId','resourceId','name','section','path','slot','declaredRole','originalRole','depth','position','priority','positionAdaptation','authorVariables'];
         row.messageSources=Array.isArray(data.messageSources)?data.messageSources.map(source=>Object.fromEntries(sourceKeys.filter(key=>Object.hasOwn(source||{},key)).map(key=>[key,source[key]]))):[];
         const all=JSON.stringify(safe);
         row.request=all.length<=MAX_REQUEST_CHARS?safe:null;
         row.requestTruncated=all.length>MAX_REQUEST_CHARS;
         row.requestChars=all.length;row.messageCount=safe.messages.length;row.model=safe.model;row.requestId=pickString(data.requestId,120);row.endpointOrigin=pickString(data.endpointOrigin,260);row.status='requesting';
         row.requestBytes=Number(data.requestBytes)||0;row.preparationElapsedMs=Number.isFinite(data.preparationElapsedMs)?data.preparationElapsedMs:null;
         row.serializationElapsedMs=Number(data.serializationElapsedMs)||0;row.generationId=pickString(data.generationId,120);row.generationAttempt=Number(data.generationAttempt)||null;
       }else if(data.type==='transport_response'){
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
       st.put(row);
     }
     await finished(tx);
     await prune();
   });
 }
 async function get(id){
   await queue;const db=await open(),tx=db.transaction(STORE,'readonly'),done=finished(tx);
   const row=await waitRequest(tx.objectStore(STORE).get(String(id)));await done;return row||null;
 }
 async function recoveryCandidate(id){
   const row=await get(id),bad=message=>{throw Object.assign(new Error(message),{code:'E_REPLY_RECOVERY_UNAVAILABLE'});};
   if(!row)bad('诊断记录已清理，无法恢复。');
   if(!['rejected','aborted','conflict'].includes(row.status))bad('本记录不是已结算的坏回复。');
   if(!String(row.rawRejectedReply||'').trim())bad('这条日志没有收到可恢复的正文；不会重新请求模型。');
   if(row.rejectedReplyTruncated===true)bad('诊断副本已被裁剪，缺少的正文无法恢复；原记录保留。');
   // Old compat errors did not mark the transport partialDraft's 24k cap.
   if(String(row.action||'').startsWith('compat_')&&row.rawRejectedReply.length===24000&&!row.replyCaptureVersion)bad('旧日志无法确认正文是否已被裁剪，未改写剧情。');
   return row;
 }
 async function list({sessionId=null,errorsOnly=false}={}){
   await transact(prune);await queue;const rows=await readAll();
   return rows.filter(x=>(!sessionId||x.sessionId===sessionId)&&(!errorsOnly||['rejected','aborted','conflict'].includes(x.status))).sort((a,b)=>b.createdAtMs-a.createdAtMs);
 }
 function remove(id){return transact(async()=>{const db=await open(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);await finished(tx)});}
 function clearSession(sessionId){return transact(async()=>{const rows=await readAll(),db=await open(),tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);rows.filter(x=>x.sessionId===sessionId).forEach(x=>st.delete(x.id));await finished(tx)});}
 function clearAll(){return transact(async()=>{const db=await open(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();await finished(tx)});}
 function status(){return {error:lastError,limitCount:LIMIT_COUNT,limitDays:LIMIT_DAYS,limitBytes:LIMIT_BYTES,database:DB};}
 window.MimaDiagnosticJournal=Object.freeze({begin,event,get,recoveryCandidate,list,remove,clearSession,clearAll,status});
})();
