/* Whole-tavern migration. Independent stores commit separately; no cross-DB atomic claim. */
(()=>{'use strict';
 const FORMAT='MIMA_TAVERN_MIGRATION',VERSION=2,CHUNK=192*1024;
 const NAMES=['native','compat','phone','atelier','wallpapers','fonts','sounds','prefs','playtools'];
 const LABELS={native:'原生剧情、记忆与角色面具',compat:'酒馆兼容库与来源',phone:'小手机全部表与原始媒体',atelier:'工坊项目与素材',wallpapers:'已保存壁纸',fonts:'本地字体原件',sounds:'个人点击音效原件',prefs:'接口与界面偏好',playtools:'工具草稿与清理记录'};
 const PREFS=['mimamao_tavern_url_fonts_v1','MIMATAVERN_UI_DENSITY_V1','MIMAMAO_TAVERN_TEMP','storyFontUrl','storyFontFamily','MIMAMAO_TAVERN_STORY_TYPO_V1','mimamao_tavern_ui_font','mimamao_tavern_story_font','mimamao_tavern_font_weight_v1','mimamao_tavern_font_subsets_v1','MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1','mima-r19-ui-feedback-prefs-v1','mima-r19-last-session-v1'];
 const SESSION_PREFS=['mima-r19-unsent-v1:','mima-r19-reader-v1:'];
 const prefKeys=library=>[...PREFS,...(library.sessions||[]).flatMap(session=>SESSION_PREFS.map(prefix=>prefix+session.id))];
 const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=0x4000)s+=String.fromCharCode(...bytes.subarray(i,i+0x4000));return btoa(s)};
 const unb64=s=>{if(typeof s!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error('归档二进制编码无效');return Uint8Array.from(atob(s),x=>x.charCodeAt(0))};
 let busy=false,activeId=null;
 const liveRestoreTokens=new Set(),liveStagingTokens=new Set();
 const restoreSignal=typeof BroadcastChannel==='function'?new BroadcastChannel('mima-whole-restore-live-v1'):null;
 if(restoreSignal)restoreSignal.addEventListener('message',event=>{
  const message=event.data;
  if(message?.type==='probe'&&(liveRestoreTokens.has(message.token)||liveStagingTokens.has(message.token)))restoreSignal.postMessage({type:'alive',id:message.id,token:message.token});
 });
 async function checkManualTakeover(token){
  if(liveRestoreTokens.has(token)||liveStagingTokens.has(token))throw Error('E_RESTORE_OWNED：当前窗口仍在运行归档事务');
  if(!restoreSignal)return; // The user must explicitly confirm every old tab is closed.
  const id='probe-'+[...crypto.getRandomValues(new Uint8Array(12))].map(x=>x.toString(16).padStart(2,'0')).join('');
  let alive=false;
  await new Promise(resolve=>{
   const listener=event=>{if(event.data?.type==='alive'&&event.data?.id===id&&event.data?.token===token)alive=true;};
   restoreSignal.addEventListener('message',listener);
   restoreSignal.postMessage({type:'probe',id,token});
   setTimeout(()=>{restoreSignal.removeEventListener('message',listener);resolve()},400);
  });
  if(alive)throw Error('E_RESTORE_OWNED：旧窗口仍在执行恢复，禁止抢占，请先停止并关闭旧窗口');
 }

 function journalDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open('mimamao_tavern_migration_v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('迁移日志被其他窗口阻塞'))})}
 async function journal(key,value){const db=await journalDB();return new Promise((resolve,reject)=>{const tx=db.transaction('kv',arguments.length===1?'readonly':'readwrite'),os=tx.objectStore('kv');let result,issue;const q=arguments.length===1?os.get(key):os.put(value,key);q.onsuccess=()=>result=q.result;q.onerror=()=>{issue=q.error;tx.abort()};tx.oncomplete=()=>{db.close();resolve(arguments.length===1?result:value)};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('迁移日志写入失败'))}})}
 // Same-origin IndexedDB readwrite transactions are the only authority for a
 // restore owner and its receipt. No timeout/auto-steal: a suspended tab must
 // never silently lose its right to an in-flight data import.
 async function restoreJournal(id,mode,{receipt=null,token=null,expectedOwner=null}={}){
  const db=await journalDB();return new Promise((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),os=tx.objectStore('kv');
   const ownerKey='restore-owner:'+id,receiptKey='receipt:'+id;
   let owner,prior,done=0,problem=null,result=null;
   const fail=error=>{problem=error;try{tx.abort()}catch(_){}};
   const finish=()=>{
    if(++done!==2)return;
    try{
     const version=Number(prior?._restoreRevision)||0;
     if(mode==='prepare'){
      if(owner)throw Error('E_RESTORE_OWNED：另一窗口正在恢复，无法重新预检覆盖收据');
      if(version!==(Number(receipt?._restoreRevision)||0))throw Error('E_RESTORE_RECEIPT_CHANGED');
      result={...receipt,updatedAt:new Date().toISOString(),_restoreRevision:version+1};
      os.put(result,receiptKey);os.put(id,'latest');
     }else if(mode==='claim'){
      if(!prior)throw Error('没有可继续的迁移日志');
      if(owner){
       if(!expectedOwner||owner.token!==expectedOwner)throw Error('E_RESTORE_OWNED：其他恢复窗口拥有执行权；请先关闭旧窗口并人工核对');
      }else if(expectedOwner)throw Error('E_RESTORE_OWNER_CHANGED：恢复占用状态已变化，请重新核对');
      result={...prior,_restoreRevision:version+1,updatedAt:new Date().toISOString()};
      os.put({token,claimedAt:new Date().toISOString(),manualTakeover:!!expectedOwner},ownerKey);
      os.put(result,receiptKey);os.put(id,'latest');
     }else{
      if(!owner||owner.token!==token)throw Error('E_RESTORE_OWNER_LOST：本窗口已失去恢复所有权，禁止继续写收据');
      if(version!==(Number(receipt?._restoreRevision)||0))throw Error('E_RESTORE_RECEIPT_CHANGED：收据已被其他窗口修改');
      result={...receipt,updatedAt:new Date().toISOString(),_restoreRevision:version+1};
      os.put(result,receiptKey);os.put(id,'latest');
      if(mode==='release')os.delete(ownerKey);
     }
    }catch(error){fail(error)}
   };
   const a=os.get(ownerKey),b=os.get(receiptKey);
   a.onsuccess=()=>{owner=a.result;finish()};b.onsuccess=()=>{prior=b.result;finish()};
   a.onerror=()=>fail(a.error||Error('读取恢复所有权失败'));
   b.onerror=()=>fail(b.error||Error('读取恢复收据失败'));
   tx.oncomplete=()=>{db.close();resolve(result)};
   tx.onabort=()=>{db.close();reject(problem||tx.error||Error('恢复日志事务中止'))};
  });
 }
 async function saveReceipt(receipt){const saved=await restoreJournal(receipt.id,'prepare',{receipt});Object.assign(receipt,saved);activeId=receipt.id;paintReceipt(receipt);return receipt}
 async function saveOwnedReceipt(receipt,token,release=false){const saved=await restoreJournal(receipt.id,release?'release':'update',{receipt,token});Object.assign(receipt,saved);activeId=receipt.id;paintReceipt(receipt);if(release){const b=document.getElementById('tavern-migration-takeover');if(b)b.hidden=true;}return receipt}

 async function readPrefs(includeApiKey){const values={};for(const key of prefKeys(await MimaStandalone.exportLibrary())){const v=localStorage.getItem(key);if(v!==null)values[key]=v}const api={...MimaStandalone.getApiConfig()};if(!includeApiKey){api.apiKey='';api.extraHeaders=''}return {values,api,credentialsIncluded:includeApiKey}}
 async function collect(name,includeApiKey){switch(name){
  case 'native':await MimaLocalStore.exportAll();return MimaStandalone.exportLibrary();
  case 'compat':return MimaCompatStore.snapshot();
  case 'phone':{const tables=await MimaPhoneBackup.snapshot();if(!includeApiKey)tables.prefs=tables.prefs.map(row=>row.key==='main'&&row.phoneApi&&typeof row.phoneApi==='object'?{...row,phoneApi:{...row.phoneApi,apiKey:'',extraHeaders:''}}:row);return tables}
  case 'atelier':return MimaAtelierCore.exportRecords();
  case 'wallpapers':return MimaChatWallpaper.exportRecords();
  case 'fonts':return MimaFontManager.all();
  case 'sounds':return (await MimaInteraction.exportSounds()).map(r=>{const [header,data]=r.data.split(',');return {kind:r.kind,name:r.name,blob:new Blob([unb64(data)],{type:header.slice(5).split(';')[0]})}});
  case 'prefs':return readPrefs(includeApiKey);
  case 'playtools':return MimaLocalStore.exportPlayToolRecords();
 }}
 // An index is not proof that all surviving original bytes have been archived.
 // Inventory compares keys without decoding large fonts. A deleted legacy record
 // with an explicit tombstone is intentionally outside the active library.
 function verifyFontCoverage(snapshot,archivedIds){
  const meta=snapshot.modern.metadata,deleted=new Set(snapshot.modern.tombstoneIds);
  const oldUnindexed=snapshot.legacy.ids.filter(id=>!meta.some(m=>m.id===id&&m.storage==='legacy')&&!deleted.has(id));
  // Tombstones may coexist with still-readable v2 bytes after interrupted
  // migrations or older releases. Never call such an archive complete.
  const orphan=snapshot.modern.orphanBinaryIds;
  const markedMeta=meta.filter(m=>deleted.has(m.id)).map(m=>m.id);
  const missing=[...snapshot.modern.missingBinaryIds,...snapshot.modern.legacyIndexesWithoutSource.filter(id=>!deleted.has(id))];
  const uncovered=archivedIds?meta.filter(m=>!archivedIds.has(m.id)).map(m=>m.id):[];
  if(oldUnindexed.length||orphan.length||markedMeta.length||missing.length||uncovered.length){
   throw Error('本地字体库存与整馆归档不完整，已阻止“完整备份”成功：旧库无索引 '+oldUnindexed.length+' 份，新库孤立原件 '+orphan.length+' 份，删除标记与索引冲突 '+markedMeta.length+' 份，索引指向缺失原件 '+missing.length+' 份，归档未覆盖 '+uncovered.length+' 份。请先在外观页运行只读字体检查，保全仍存在的原始字节；当前数据库未被改动。');
  }
 }
 const fontInventoryKey=a=>JSON.stringify({legacy:a.legacy.ids.slice().sort(),meta:a.modern.metadata.map(m=>[m.id,m.storage,m.size,m.health]).sort((x,y)=>String(x[0]).localeCompare(String(y[0]))),binary:a.modern.binaryIds.slice().sort(),missing:a.modern.missingBinaryIds.slice().sort(),tombstones:a.modern.tombstoneIds.slice().sort()});
 // Encode binary objects as bounded base64 lines, never JSON-stringify all phone
 // media into one giant string. Blob parts retain their backing storage.
 async function build({includeApiKey=false,onProgress=()=>{}}={}){
  await MimaPlayTools?.flushDrafts?.();window.preserveComposerDraft?.();window.r19PersistReading?.();const parts=[],manifest=[],binary=[];let binaryId=0;
  const fontBefore=await MimaFontManager.auditStoredFonts();verifyFontCoverage(fontBefore);
  let archivedFontIds=null;
  const line=async payload=>{const text=JSON.stringify(payload),hash=await sha(text);parts.push(new Blob([JSON.stringify({sha256:hash,payload:text})+'\n']));manifest.push(hash)};
  const encode=async value=>{
   if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
    const kind=value instanceof Blob?'blob':value instanceof Uint8Array?'uint8':'buffer';
    const blob=value instanceof Blob?value:new Blob([ArrayBuffer.isView(value)?value:new Uint8Array(value)]),id='b'+(++binaryId);
    const ref={id,kind,mime:blob.type,size:blob.size};binary.push({ref,blob});return {__mimaMigrationBinary:ref};
   }
   if(Array.isArray(value)){const out=[];for(const item of value)out.push(await encode(item));return out}
   if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value)){if(k==='__mimaMigrationBinary'||k==='__proto__'||k==='constructor'||k==='prototype')throw Error('归档含保留字段：'+k);if(v!==undefined)out[k]=await encode(v)}return out}
   return value;
  };
  await line({kind:'header',format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),sections:NAMES,credentialsIncluded:includeApiKey,consistency:'各库独立事务快照；导出期间请暂停编辑及生成'});
  const signature=async value=>{if(value instanceof Blob)return {type:value.type,size:value.size,hash:await sha(await value.arrayBuffer())};if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))return {hash:await sha(ArrayBuffer.isView(value)?value:new Uint8Array(value))};if(Array.isArray(value)){const a=[];for(const x of value)a.push(await signature(x));return a}if(value&&typeof value==='object'){const o={};for(const[k,v]of Object.entries(value))if(v!==undefined)o[k]=await signature(v);return o}return value};
  const captured={};
  for(const name of NAMES){onProgress('正在读取 '+LABELS[name]);const data=await collect(name,includeApiKey),encoded=await encode(data);if(name==='fonts'){archivedFontIds=new Set(data.map(font=>String(font.id)));verifyFontCoverage(fontBefore,archivedFontIds)}captured[name]=JSON.stringify(await signature(data));await line({kind:'section',name,data:encoded})}
  for(const {ref,blob} of binary){const total=Math.ceil(blob.size/CHUNK);for(let i=0;i<total;i++)await line({kind:'chunk',id:ref.id,index:i,total,data:b64(new Uint8Array(await blob.slice(i*CHUNK,(i+1)*CHUNK).arrayBuffer()))});}
  for(const name of NAMES){onProgress('正在核对导出一致性：'+LABELS[name]);if(captured[name]!==JSON.stringify(await signature(await collect(name,includeApiKey))))throw Error('导出期间 '+LABELS[name]+' 已改变，请暂停编辑/生成后重试');}
  const fontAfter=await MimaFontManager.auditStoredFonts();verifyFontCoverage(fontAfter,archivedFontIds);
  if(fontInventoryKey(fontBefore)!==fontInventoryKey(fontAfter))throw Error('字体库存于导出期间发生变化，未生成完整归档，请停止其他标签页的字体操作后重试');
  // All records are validated before a downloadable artifact is offered.
  const footer={kind:'footer',entries:manifest.length,sha256:await sha(manifest.join('\n'))};parts.push(new Blob([JSON.stringify(footer)+'\n']));
  const blob=new Blob(parts,{type:'application/x-mima-tavern-migration'});
  await preflight((await inspect(blob)).data);
  const finalInventory=await MimaFontManager.auditStoredFonts();verifyFontCoverage(finalInventory,archivedFontIds);
  if(fontInventoryKey(fontBefore)!==fontInventoryKey(finalInventory))throw Error('预检期间字体库存发生变化，未生成完整归档');
  onProgress('整馆归档已校验，可保存到文件');return blob;
 }
 async function* lines(file){
  const reader=file.stream().getReader(),decoder=new TextDecoder();let buffer='';
  try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let cut;while((cut=buffer.indexOf('\n'))>=0){const row=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(row)yield row}if(buffer.length>256*1024*1024)throw Error('归档单段过大，已停止');if(done)break}if(buffer.trim())yield buffer}finally{reader.releaseLock()}
 }
 async function inspect(file){
  if(!(file instanceof Blob))throw Error('请选择整馆 .mimatavern 文件');const hashes=[],sections={},chunks=new Map();let header=null,footer=null;
  for await(const row of lines(file)){
   const envelope=JSON.parse(row);if(footer)throw Error('归档结束后含多余内容');
   if(envelope.kind==='footer'){footer=envelope;continue}
   if(typeof envelope.payload!=='string'||await sha(envelope.payload)!==envelope.sha256)throw Error('归档段 SHA-256 校验失败');hashes.push(envelope.sha256);const p=JSON.parse(envelope.payload);
   if(p.kind==='header'){if(header||hashes.length!==1||p.format!==FORMAT||![1,VERSION].includes(p.version)||JSON.stringify(p.sections)!==JSON.stringify(p.version===1?NAMES.filter(n=>n!=='sounds'):NAMES))throw Error('整馆归档版本或目录不支持');header=p}
   else if(!header)throw Error('归档缺少头部');
   else if(p.kind==='section'){if(!header.sections.includes(p.name)||Object.hasOwn(sections,p.name))throw Error('归档段未知或重复');sections[p.name]=p.data}
   else if(p.kind==='chunk'){if(!/^b[1-9]\d*$/.test(p.id)||!Number.isSafeInteger(p.index)||!Number.isSafeInteger(p.total)||p.total<1||p.index<0||p.index>=p.total||p.data.length>CHUNK*2)throw Error('媒体分段序号无效');let c=chunks.get(p.id);if(!c){c={total:p.total,parts:[]};chunks.set(p.id,c)}if(c.total!==p.total||c.parts.length!==p.index)throw Error('媒体分段重复或缺失');c.parts.push(new Blob([unb64(p.data)]))}
   else throw Error('归档含未知记录');
  }
  if(!header||!footer||footer.entries!==hashes.length||footer.sha256!==await sha(hashes.join('\n'))||(header.version===1?NAMES.filter(n=>n!=='sounds'):NAMES).some(n=>!Object.hasOwn(sections,n)))throw Error('归档未完成或总校验失败');
  const used=new Set();const decode=async value=>{
   if(value&&typeof value==='object'&&Object.hasOwn(value,'__mimaMigrationBinary')){const r=value.__mimaMigrationBinary;if(!r||!/^b[1-9]\d*$/.test(r.id)||used.has(r.id)||!['blob','uint8','buffer'].includes(r.kind)||!Number.isSafeInteger(r.size)||r.size<0)throw Error('二进制引用无效或重复');used.add(r.id);const c=chunks.get(r.id);if(r.size&&(!c||c.parts.length!==c.total))throw Error('媒体原件不完整');const blob=new Blob(c?.parts||[],{type:r.mime||''});if(blob.size!==r.size)throw Error('媒体原件大小不符');return r.kind==='blob'?blob:r.kind==='uint8'?new Uint8Array(await blob.arrayBuffer()):blob.arrayBuffer()}
   if(Array.isArray(value)){const a=[];for(const x of value)a.push(await decode(x));return a}if(value&&typeof value==='object'){const o={};for(const[k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw Error('归档字段无效');o[k]=await decode(v)}return o}return value;
  };
  const data=await decode(sections);if(header.version===1)data.sounds=[];data.phoneCredentialsOmitted=header.credentialsIncluded!==true;if([...chunks.keys()].some(id=>!used.has(id)))throw Error('归档存在未引用媒体');return {id:footer.sha256,header,data};
 }
 async function portableFonts(records){if(!Array.isArray(records))throw Error('字体迁移结构无效');return records.map(r=>{if(!(r.buffer instanceof ArrayBuffer))throw Error('字体原件缺失');return {...r,buffer:undefined,bufferBase64:b64(new Uint8Array(r.buffer))}})}
 async function portableSounds(records){if(!Array.isArray(records))throw Error('个人音效迁移格式无效');const raw=[];for(const r of records){if(!(r?.blob instanceof Blob))throw Error('个人音效缺少原始媒体');raw.push({kind:r.kind,name:r.name,data:'data:'+r.blob.type+';base64,'+b64(new Uint8Array(await r.blob.arrayBuffer()))})}return MimaInteraction.validateSounds(raw)}
 function prefsPlan(src,library){
  if(!src||!src.values||typeof src.values!=='object'||Array.isArray(src.values)||!src.api||typeof src.api!=='object'||Array.isArray(src.api))throw Error('偏好备份结构无效');
  const additions=[],preserved=[];for(const[k,v]of Object.entries(src.values)){
   if(!prefKeys(library).includes(k)||typeof v!=='string')throw Error('偏好键或值无效');
   if(k==='mimamao_tavern_font_weight_v1'||k==='mimamao_tavern_font_subsets_v1'){
    let cfg;try{cfg=JSON.parse(v)}catch(_){throw Error('字体外观偏好归档无效：'+k)}
    const valid=k==='mimamao_tavern_font_weight_v1'
      ?cfg?.version===1&&['ui','story'].every(t=>cfg[t]&&typeof cfg[t].enabled==='boolean'&&typeof cfg[t].synthesis==='boolean'&&Number.isFinite(cfg[t].value)&&cfg[t].value>=1&&cfg[t].value<=1000)
      :cfg?.version===1&&['ui','story'].every(t=>cfg[t]===null||(cfg[t]&&typeof cfg[t].family==='string'&&Array.isArray(cfg[t].ids)&&cfg[t].ids.length<=32&&cfg[t].ids.every(id=>typeof id==='string'&&id.length<150)&&new Set(cfg[t].ids).size===cfg[t].ids.length));
    if(!valid)throw Error('字体外观偏好归档无效：'+k);
   }
   const old=localStorage.getItem(k);if(old===null)additions.push([k,v]);else if(old!==v)preserved.push(k)
  }
  return {additions,preserved};
 }
 async function preflight(data){
  await MimaLocalStore.exportAll();const plans={};plans.native=await MimaStandalone.previewLibraryImport(data.native,{mergeMode:'merge-new-only',templatePolicy:'merge'});
  plans.compat=await MimaCompatStore.restoreVerified({...data.compat,integrityVerified:true},{dryRun:true,mode:'merge-new-only'});if(plans.compat.conflicts.length)throw Error('兼容库记录冲突 '+plans.compat.conflicts.length+' 项，未开始恢复');
  plans.phone=await MimaPhoneBackup.previewArchive(data.phone,{credentialsOmitted:data.phoneCredentialsOmitted===true});plans.atelier=await MimaAtelierCore.previewRecordImport(data.atelier);plans.wallpapers=await MimaChatWallpaper.previewRecordImport(data.wallpapers);
  const fonts=await portableFonts(data.fonts);plans.fonts={toAdd:(await MimaFontManager.planPortableImport(fonts)).records.length};plans.sounds=await MimaInteraction.previewSoundMerge(await portableSounds(data.sounds||[]));const prefPlan=prefsPlan(data.prefs,data.native);plans.prefs={toAdd:prefPlan.additions.map(([key])=>key),preserved:prefPlan.preserved};plans.playtools=await MimaLocalStore.importPlayToolRecords(data.playtools,{dryRun:true});return plans;
 }
 async function prepare(file){const archive=await inspect(file),plans=await preflight(archive.data),old=await journal('receipt:'+archive.id);
  // Persist the verified original file BEFORE any store mutation. If quota is
  // unavailable, stop here; never offer a resumable restore without its source.
  await journal('archive:'+archive.id,file);if(old){if(old.error){old.history=[...(old.history||[]),{at:old.updatedAt,error:old.error}];delete old.error}old.status='prepared';old.plans=plans;return saveReceipt(old)}return saveReceipt({id:archive.id,createdAt:new Date().toISOString(),status:'prepared',strategy:'merge-new-only',stages:Object.fromEntries(NAMES.map(n=>[n,{status:'pending'}])),plans,warning:'各库分阶段提交；中断保留已提交阶段，不自动回滚。可在此页继续。'});
 }
 async function runStage(name,data){switch(name){
  case 'native':{await MimaLocalStore.exportAll();await MimaStandalone.importLibrary(data.native,{mergeMode:'merge-new-only',templatePolicy:'merge'});return {committed:true}}
  case 'compat':return MimaCompatStore.restoreVerified({...data.compat,integrityVerified:true},{dryRun:false,mode:'merge-new-only'});
  case 'phone':return MimaPhoneBackup.restoreArchive(data.phone,{credentialsOmitted:data.phoneCredentialsOmitted===true});
  case 'atelier':return MimaAtelierCore.importRecords(data.atelier);
  case 'wallpapers':return MimaChatWallpaper.importRecords(data.wallpapers);
  case 'fonts':return MimaFontManager.commitPortablePlan(await MimaFontManager.planPortableImport(await portableFonts(data.fonts)));
  case 'sounds':return MimaInteraction.mergeSounds(await portableSounds(data.sounds||[]));
  case 'playtools':return MimaLocalStore.importPlayToolRecords(data.playtools);
  case 'prefs':{const plan=prefsPlan(data.prefs,data.native),added=[];for(const[k,v]of plan.additions){if(localStorage.getItem(k)===null){localStorage.setItem(k,v);added.push(k)}}const apiKey='MIMAMAO_TAVERN_STANDALONE_API_V1';let apiPreserved=true;if(localStorage.getItem(apiKey)===null){MimaStandalone.saveApiConfig({...data.prefs.api,apiKey:typeof data.prefs.api.apiKey==='string'?data.prefs.api.apiKey:'',extraHeaders:typeof data.prefs.api.extraHeaders==='string'?data.prefs.api.extraHeaders:''});apiPreserved=false}MimaInteraction.reloadPreferences();return {added,preserved:plan.preserved,apiPreserved};}
 }}
 async function resumeArchive(id,archive,validateData,commitStage,{expectedOwner=null}={}){
  const token='restore-'+[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const execute=async()=>{
   if(expectedOwner)await checkManualTakeover(expectedOwner);
   const receipt=await restoreJournal(id,'claim',{token,expectedOwner});
   liveRestoreTokens.add(token);
   try{
    if(receipt.status==='complete'){await validateData(archive.data);await saveOwnedReceipt(receipt,token,true);return receipt;}
    // The full archive is checked against live databases on each continuation;
    // each merge-new-only stage then rechecks its own target before committing.
    await validateData(archive.data);
    receipt.history=Array.isArray(receipt.history)?receipt.history:[];
    if(receipt.error)receipt.history.push({at:receipt.updatedAt,error:receipt.error});
    delete receipt.error;receipt.status='running';await saveOwnedReceipt(receipt,token);
    for(const name of NAMES){
     // Each merge-new-only runStage rechecks live target records in its own
     // store; a previous receipt alone never authorizes skipping this step.
     receipt.stages[name]={status:'running',startedAt:new Date().toISOString()};
     await saveOwnedReceipt(receipt,token);
     const result=await commitStage(name,archive.data);
     receipt.stages[name]={status:'committed',completedAt:new Date().toISOString(),result};
     await saveOwnedReceipt(receipt,token);
    }
    receipt.status='complete';delete receipt.error;receipt.completedAt=new Date().toISOString();await saveOwnedReceipt(receipt,token,true);return receipt;
   }catch(error){
    receipt.status='interrupted';receipt.error=error?.message||String(error);
    for(const stage of Object.values(receipt.stages||{}))if(stage.status==='running'){
     stage.status='unconfirmed';stage.error='该阶段是否已提交须按真实数据库核对：'+receipt.error;
    }
    try{await saveOwnedReceipt(receipt,token,true)}catch(releaseError){
     throw Error('恢复中断且所有权未能可靠释放；保留收据并人工核对后接管。原错误：'+receipt.error+'；结算错误：'+releaseError.message);
    }
    throw error;
   }finally{liveRestoreTokens.delete(token)}
  };
  if(navigator.locks?.request)return navigator.locks.request('mima-whole-tavern-restore',{mode:'exclusive'},execute);
  return execute();
 }

 async function resume(id,options={}){
  const file=await journal('archive:'+id);if(!(file instanceof Blob))throw Error('恢复源文件不可读，请重新选择原文件');
  const archive=await inspect(file);if(archive.id!==id)throw Error('暂存恢复源不一致');
  return resumeArchive(id,archive,preflight,runStage,options);
 }
 // V3 readers hold only verified frame offsets. Business payloads are decoded
 // one stage at a time, never all nine stores or all font buffers at once.
 async function preflightV3Stream(source){
  await MimaLocalStore.exportAll();const plans={};
  for(const name of NAMES){
   const value=await source.readSection(name);
   switch(name){
    case 'native':plans.native=await MimaStandalone.previewLibraryImport(value,{mergeMode:'merge-new-only',templatePolicy:'merge'});break;
    case 'compat':plans.compat=await MimaCompatStore.restoreVerified({...value,integrityVerified:true},{dryRun:true,mode:'merge-new-only'});
      if(plans.compat.conflicts.length)throw Error('兼容库记录冲突 '+plans.compat.conflicts.length+' 项，未开始恢复');break;
    case 'phone':plans.phone=await MimaPhoneBackup.previewArchive(value,{credentialsOmitted:source.manifest.credentialsIncluded!==true});break;
    case 'atelier':plans.atelier=await MimaAtelierCore.previewRecordImport(value);break;
    case 'wallpapers':plans.wallpapers=await MimaChatWallpaper.previewRecordImport(value);break;
    case 'fonts':{
     let count=0;for(const row of value){const plan=await MimaFontManager.planBinaryFontRestore(row);count+=plan.records.length;}
     plans.fonts={toAdd:count};break;
    }
    case 'sounds':plans.sounds=await MimaInteraction.previewSoundMerge(await portableSounds(value||[]));break;
    case 'prefs':{
     const native=await source.readSection('native'),plan=prefsPlan(value,native);
     plans.prefs={toAdd:plan.additions.map(([key])=>key),preserved:plan.preserved};break;
    }
    case 'playtools':plans.playtools=await MimaLocalStore.importPlayToolRecords(value,{dryRun:true});break;
   }
  }
  return plans;
 }
 async function runStageV3Stream(name,source){
  const value=await source.readSection(name);
  if(name==='fonts'){
   let committed=0;
   try{for(const row of value){const plan=await MimaFontManager.planBinaryFontRestore(row);
    if(plan.records.length){await MimaFontManager.commitPortablePlan(plan,{deferRefresh:true});committed+=plan.records.length;}}
   }finally{await MimaFontManager.refreshAfterBinaryRestore();}
   return {committed};
  }
  if(name==='prefs')return runStage(name,{native:await source.readSection('native'),prefs:value});
  return runStage(name,{[name]:value,phoneCredentialsOmitted:source.manifest.credentialsIncluded!==true});
 }
 const stagingKey=id=>'v3-staging:'+id;
 async function stagingTransaction(work){
  const db=await journalDB();try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),kv=tx.objectStore('kv');let outcome,issue;
   const abort=e=>{issue=e;try{tx.abort()}catch(_){}};
   try{work(kv,abort,value=>{outcome=value});}catch(e){abort(e)}
   tx.oncomplete=()=>resolve(outcome);tx.onabort=()=>reject(issue||tx.error||Error('整馆分卷暂存事务失败'));
  });}finally{db.close()}
 }
 function stagingToken(){return 'stage-'+[...crypto.getRandomValues(new Uint8Array(24))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 async function startV3Staging(manifest,token){
  const id=manifest.sha256;
  await stagingTransaction((kv,abort)=>{
   const req=kv.get(stagingKey(id)),receipt=kv.get('receipt:'+id),owner=kv.get('restore-owner:'+id);
   let stage,prior,owned,checks=0;const finish=()=>{if(++checks!==3)return;
    if(stage||prior||owned){abort(Error('该归档已有暂存、恢复进度或所有权；禁止覆盖，请先核对收据'));return;}
    kv.add({id,token,status:'staging',manifest,indices:[],createdAt:new Date().toISOString()},stagingKey(id));
   };
   req.onsuccess=()=>{stage=req.result;finish()};receipt.onsuccess=()=>{prior=receipt.result;finish()};owner.onsuccess=()=>{owned=owner.result;finish()};
   req.onerror=()=>abort(req.error);receipt.onerror=()=>abort(receipt.error);owner.onerror=()=>abort(owner.error);
  });
 }
 async function writeV3Volume(id,token,index,file){
  await stagingTransaction((kv,abort)=>{
   const req=kv.get(stagingKey(id));req.onsuccess=()=>{
    const r=req.result;if(!r||r.status!=='staging'||r.token!==token||r.indices.length!==index){abort(Error('暂存身份或分卷序号变化，拒绝写入'));return;}
    kv.put(file,'v3-volume:'+id+':'+index);kv.put({...r,indices:[...r.indices,index]},stagingKey(id));
   };req.onerror=()=>abort(req.error);
  });
 }
 async function discardStaging(id,token,{allowReady=false}={}){
  await stagingTransaction((kv,abort)=>{
   const req=kv.get(stagingKey(id));req.onsuccess=()=>{
    const r=req.result;if(!r)return;
    if(token&&r.token!==token){abort(Error('暂存所有者变化，拒绝清理'));return;}
    if(r.status!=='staging'&&!allowReady){abort(Error('已可恢复的归档暂存不能作为失败数据清理'));return;}
    const owner=kv.get('restore-owner:'+id),receipt=kv.get('receipt:'+id);
    let checks=0,owned,record;
    const check=()=>{if(++checks!==2)return;
     if(owned||record?.status==='running'||record?.status==='prepared'||record?.status==='interrupted'){
      abort(Error('归档已进入恢复流程，禁止清理来源'));return;
     }
     for(const i of r.indices)kv.delete('v3-volume:'+id+':'+i);
     kv.delete(stagingKey(id));
    };
    owner.onsuccess=()=>{owned=owner.result;check()};receipt.onsuccess=()=>{record=receipt.result;check()};
    owner.onerror=()=>abort(owner.error);receipt.onerror=()=>abort(receipt.error);
   };req.onerror=()=>abort(req.error);
  });
 }
 async function loadV3Source(id,{allowStaging=false}={}){
  const stage=await journal(stagingKey(id)),saved=stage?.status==='ready'||allowStaging&&stage?.status==='staging'
   ?{manifest:stage.manifest,volumes:stage.manifest.volumes,manifestName:'咪嘛馆_'+stage.manifest.archiveId+'.mimavolumes.json'}
   :await journal('v3-manifest:'+id);
  if(!saved?.manifest||!Array.isArray(saved.volumes))throw Error('整馆分卷暂存信息缺失，请重新选择全部文件');
  const files=[new File([JSON.stringify(saved.manifest)],saved.manifestName||'backup.mimavolumes.json',{type:'application/json'})];
  for(const vol of saved.volumes){
   const item=await journal('v3-volume:'+id+':'+vol.index);
   if(!(item instanceof Blob))throw Error('整馆第 '+(vol.index+1)+' 卷暂存缺失，拒绝恢复');
   files.push(new File([item],vol.name,{type:'application/octet-stream'}));
  }
  const source=await MimaBackupVolumes.open(files);
  if(source.id!==id)throw Error('整馆分卷身份变化，拒绝写库');
  return source;
 }
 async function completeV3Staging(id,token,plans){
  let result;
  await stagingTransaction((kv,abort)=>{
   const req=kv.get(stagingKey(id)),owner=kv.get('restore-owner:'+id),receipt=kv.get('receipt:'+id);
   let stage,owned,old,checks=0;
   const finish=()=>{if(++checks!==3)return;
    if(!stage||stage.token!==token||stage.status!=='staging'||stage.indices.length!==stage.manifest.volumes.length||owned||old){
     abort(Error('整馆暂存或恢复状态变化，拒绝创建假收据'));return;
    }
    result={id,createdAt:new Date().toISOString(),status:'prepared',archiveFormat:'v3',strategy:'merge-new-only',
      stages:Object.fromEntries(NAMES.map(n=>[n,{status:'pending'}])),plans,
      warning:'全部分卷和九库已预检；逐阶段只增加缺失记录，出现冲突则停止。',_restoreRevision:1};
    kv.put({...stage,status:'ready',token:null,verifiedAt:new Date().toISOString()},stagingKey(id));
    kv.put(result,'receipt:'+id);kv.put(id,'latest');
   };
   req.onsuccess=()=>{stage=req.result;finish()};owner.onsuccess=()=>{owned=owner.result;finish()};receipt.onsuccess=()=>{old=receipt.result;finish()};
   req.onerror=()=>abort(req.error);owner.onerror=()=>abort(owner.error);receipt.onerror=()=>abort(receipt.error);
  });
  activeId=id;paintReceipt(result);return result;
 }
 async function prepareVolumes(inputFiles){
  const parsed=await MimaBackupVolumes.readManifest(inputFiles),id=parsed.manifest.sha256;
  const existing=await journal('receipt:'+id);
  if(existing){const source=await loadV3Source(id);const plans=await preflightV3Stream(source);
   if(existing.archiveFormat!=='v3')throw Error('此归档已有另一种格式的恢复收据');
   return existing.status==='complete'?existing:saveReceipt({...existing,status:'prepared',plans});
  }
  const execute=async()=>{
   const token=stagingToken();let started=false;
   // Estimate is advisory, not a substitute for the actual IDB commit.
   // Refuse only when the browser explicitly reports less free origin quota
   // than the validated source bytes plus a small transaction reserve.
   const totalBytes=parsed.manifest.volumes.reduce((n,v)=>n+v.size,0);
   const budget=await navigator.storage?.estimate?.().catch(()=>null);
   if(budget&&Number.isFinite(budget.quota)&&Number.isFinite(budget.usage)&&
      budget.quota-budget.usage < totalBytes+8*1024*1024)
    throw Error('网站剩余容量不足以暂存此整馆归档：需要约 '+Math.ceil((totalBytes+8*1024*1024)/1048576)+' MiB；请保存外部备份并释放当前站点空间后重试，未修改原数据。');
   try{
    await startV3Staging(parsed.manifest,token);started=true;liveStagingTokens.add(token);
    for(let i=0;i<parsed.volumes.length;i++){
     const file=parsed.volumes[i],info=parsed.manifest.volumes[i];
     if(await MimaBackupVolumes.sha(file)!==info.sha256)throw Error('第 '+(i+1)+' 卷哈希不符，未暂存');
     await writeV3Volume(id,token,i,file);
     status('已验证并暂存第 '+(i+1)+' / '+parsed.volumes.length+' 卷，正在继续');
    }
    const source=await loadV3Source(id,{allowStaging:true});
    const plans=await preflightV3Stream(source);
    return completeV3Staging(id,token,plans);
   }catch(error){
    if(started){try{await discardStaging(id,token);}catch(cleanError){
     throw Error('暂存失败且清理未完成；原件未写入业务库。请使用“清理失败的分卷导入”回收本次暂存。原错误：'+error.message+'；清理错误：'+cleanError.message);
    }}
    if(error?.name==='QuotaExceededError'||/quota|storage.*full/i.test(error?.message||''))
     throw Error('网站存储配额不足，未开始业务库恢复，已回收本次未完成的归档暂存。请检查手机可用空间或改在容量更大的设备恢复。');
    throw error;
   }finally{liveStagingTokens.delete(token);}
  };
  if(navigator.locks?.request)return navigator.locks.request('mima-v3-import-'+id,{mode:'exclusive',ifAvailable:true},lock=>{
   if(!lock)throw Error('其他标签正在暂存同一归档');return execute();
  });
  return execute();
 }
 async function resumeV3(id,{expectedOwner=null}={}){
  const token=stagingToken();
  const execute=async()=>{
   if(expectedOwner)await checkManualTakeover(expectedOwner);
   // Never claim ownership or touch user stores before source and all frames
   // have been verified. Every continuation preflights all nine sections.
   const source=await loadV3Source(id);
   const plans=await preflightV3Stream(source);
   const receipt=await restoreJournal(id,'claim',{token,expectedOwner});liveRestoreTokens.add(token);
   try{
    if(receipt.status==='complete'){await saveOwnedReceipt(receipt,token,true);return receipt;}
    receipt.plans=plans;receipt.history=Array.isArray(receipt.history)?receipt.history:[];
    if(receipt.error)receipt.history.push({at:receipt.updatedAt,error:receipt.error});
    delete receipt.error;receipt.status='running';await saveOwnedReceipt(receipt,token);
    for(const name of NAMES){
     // Reload and recheck each stage when it commits; the plan from global
     // preflight cannot authorize overwriting a live record.
     receipt.stages[name]={status:'running',startedAt:new Date().toISOString()};
     await saveOwnedReceipt(receipt,token);
     const result=await runStageV3Stream(name,source);
     receipt.stages[name]={status:'committed',completedAt:new Date().toISOString(),result};
     await saveOwnedReceipt(receipt,token);
    }
    receipt.status='complete';delete receipt.error;receipt.completedAt=new Date().toISOString();
    await saveOwnedReceipt(receipt,token,true);return receipt;
   }catch(error){
    receipt.status='interrupted';receipt.error=error?.message||String(error);
    for(const stage of Object.values(receipt.stages||{}))if(stage.status==='running'){
     stage.status='unconfirmed';stage.error='须按真实数据库核对：'+receipt.error;
    }
    try{await saveOwnedReceipt(receipt,token,true);}catch(e){throw Error('恢复中断且所有权未释放，请先核对旧窗口。原错误：'+receipt.error+'；结算错误：'+e.message);}
    throw error;
   }finally{liveRestoreTokens.delete(token);}
  };
  if(navigator.locks?.request)return navigator.locks.request('mima-whole-tavern-restore',{mode:'exclusive'},execute);
  return execute();
 }
 async function releaseV3StagingUI(){
  return guarded(async()=>{
   if(!activeId)throw Error('请先选择已恢复的整馆归档');
   const id=activeId,receipt=await journal('receipt:'+id);
   if(receipt?.archiveFormat!=='v3'||receipt.status!=='complete')throw Error('整馆恢复尚未完成，拒绝清理恢复源');
   if(receipt.stagingReleased){status('该归档临时副本已清理');return;}
   const stage=await journal(stagingKey(id)),legacy=await journal('v3-manifest:'+id);
   const volumes=stage?.manifest?.volumes||legacy?.volumes;
   if(!Array.isArray(volumes))throw Error('暂存清单缺失，无法确认清理范围');
   if(!confirm('整馆恢复已完成。确认设备“文件”App 中已保存全部备份卷及最终清单？只删除当前归档的网站暂存副本，不碰原数据库。'))return;
   await stagingTransaction((kv,abort)=>{
    const a=kv.get('receipt:'+id),b=kv.get('restore-owner:'+id),c=kv.get(stagingKey(id));
    let r,owner,current,checks=0;
    const finish=()=>{if(++checks!==3)return;
     if(owner||r?.status!=='complete'||r?.stagingReleased||r?._restoreRevision!==receipt._restoreRevision||
        (stage?.manifest&&current?.manifest?.sha256!==stage.manifest.sha256)){
      abort(Error('其他窗口改变了归档恢复状态，拒绝清理'));return;
     }
     kv.put({...r,stagingReleased:true,stagingReleasedAt:new Date().toISOString(),_restoreRevision:r._restoreRevision+1},'receipt:'+id);
     for(const vol of volumes)kv.delete('v3-volume:'+id+':'+vol.index);
     kv.delete(stagingKey(id));kv.delete('v3-manifest:'+id);
    };
    a.onsuccess=()=>{r=a.result;finish()};b.onsuccess=()=>{owner=b.result;finish()};c.onsuccess=()=>{current=c.result;finish()};
    a.onerror=()=>abort(a.error);b.onerror=()=>abort(b.error);c.onerror=()=>abort(c.error);
   });
   status('当前归档已完成的临时分卷副本已清理；真实数据与设备外文件未改变。');
  });
 }
 async function cleanupInterruptedV3UI(){
  return guarded(async()=>{
   const db=await journalDB(),stale=[];
   try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('kv','readonly'),req=tx.objectStore('kv').openCursor();
    req.onsuccess=()=>{const cur=req.result;if(!cur)return;
     if(String(cur.key).startsWith('v3-staging:')&&cur.value?.status==='staging')stale.push(cur.value);cur.continue();
    };req.onerror=()=>reject(req.error);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
   });}finally{db.close();}
   if(!stale.length){status('没有未完成的整馆分卷暂存。');return;}
   if(!confirm('发现 '+stale.length+' 个未完成的分卷导入。请先关闭其他咪嘛馆标签页并确认没有导入正在进行；只清理这些未完成的分卷暂存，不删除原数据。继续？'))return;
   for(const item of stale){
    const clean=async()=>{await checkManualTakeover(item.token);await discardStaging(item.id,item.token);};
    if(navigator.locks?.request)await navigator.locks.request('mima-v3-import-'+item.id,{mode:'exclusive',ifAvailable:true},async lock=>{
     if(!lock)throw Error('其他标签正在暂存该归档，拒绝清理');await clean();
    });else await clean();
   }
   status('已清理 '+stale.length+' 个未完成的分卷导入暂存；原数据与完整恢复收据保持不变。');
  });
 }

 const V3_PROGRESS='mimatavern_whole_volume_progress_v3';
 const V3_OWNER='v3-whole-export-owner';
 async function v3OwnerChange(mode,token,expectedOwner=null){
  const db=await journalDB();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),kv=tx.objectStore('kv');
   let value,issue;const req=kv.get(V3_OWNER);
   req.onsuccess=()=>{try{const old=req.result;
    if(mode==='acquire'){
     if(old?.token&&old.token!==expectedOwner)throw Error('E_V3_OWNED：另一个标签持有整馆分卷进度。请关闭原标签再人工接管。');
     if(expectedOwner&&!old?.token)throw Error('旧占用已变化，取消接管');
     kv.put({token,claimedAt:new Date().toISOString(),archiveId:progressV3()?.archiveId},V3_OWNER);
    }else if(mode==='release'){
     if(old?.token!==token)throw Error('分卷所有权已变化，拒绝冒险结算');
     kv.delete(V3_OWNER);
    }value=true;
   }catch(e){issue=e;tx.abort();}};
   req.onerror=()=>{issue=req.error;tx.abort();};
   tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(issue||tx.error||Error('分卷所有权事务失败'));
  });}finally{db.close()}
 }
 async function withV3Owner(fn,expectedOwner=null){
  if(navigator.locks?.request){
   if(expectedOwner)throw Error('当前浏览器可自动释放终止标签的锁，不需要强制接管');
   return navigator.locks.request('mima-whole-v3-export',{mode:'exclusive',ifAvailable:true},lock=>{
    if(!lock)throw Error('E_V3_OWNED：另一个标签正在整馆分卷备份');return fn();
   });
  }
  const token='v3-'+(crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''));
  await v3OwnerChange('acquire',token,expectedOwner);
  const oldButton=document.getElementById('tavern-migration-v3-takeover');
  if(oldButton)delete oldButton.dataset.expectedOwner;
  try{return await fn();}finally{await v3OwnerChange('release',token)}
 }

 let volumeWait=null;
 function progressV3(){
  const text=localStorage.getItem(V3_PROGRESS);if(!text)return null;
  const p=JSON.parse(text);
  if(p?.version!==3||!/^[a-z0-9_-]{2,128}$/i.test(p.archiveId)||
      !Array.isArray(p.confirmed)||p.confirmed.length>1000||
      p.confirmed.some((v,i)=>v.index!==i||!/^[a-f0-9]{64}$/.test(v.sha256)))
   throw Error('上次整馆分卷进度损坏，请先保留原始记录，不能自动跳过旧卷');
  return p;
 }
 function recordV3(p){localStorage.setItem(V3_PROGRESS,JSON.stringify(p));}
 function volumePanel(label){const panel=document.getElementById('tavern-migration-v3-panel');
  if(!panel)throw Error('整馆分卷保存界面不可用');panel.replaceChildren();
  const tip=document.createElement('p');tip.textContent=label;tip.className='row-sub';panel.append(tip);return panel;
 }
 function volumeConfirmation(job,p,statusText){
  return new Promise((resolve,reject)=>{
   const panel=volumePanel(statusText+' '+job.name+'（'+(job.size/1048576).toFixed(2)+' MiB；SHA '+job.sha256.slice(0,12)+'）');
   volumeWait={job,p};
   let requested=false;
   const save=document.createElement('button');save.type='button';save.className='primary-btn';save.textContent='保存当前文件到“文件”';
   save.onclick=()=>{
    requested=false;
    try{void Promise.resolve(MimaFileExport.save(job.name,job.blob,job.name.endsWith('.json')?'application/json':'application/octet-stream'))
     .then(r=>{
      requested=r==='download_requested'||r==='shared';
      status(requested?'文件保存入口已使用；请核对“文件”App 后再确认。':
       '文件未保存（'+r+'），请重新打开保存入口。');
     })
     .catch(e=>{requested=false;status('保存入口失败：'+(e.message||e));});
    }catch(e){requested=false;status('保存入口无法启动：'+(e.message||e));}
   };
   const confirm=document.createElement('button');confirm.type='button';confirm.className='ghost-btn';confirm.textContent='我已在设备外确认保存';
   confirm.onclick=()=>{
    if(!requested){status('请先打开保存入口，在“文件”App 核实文件后再确认。');return;}
    try{if(typeof job.index==='number'){const confirmed=[...p.confirmed,{index:job.index,sha256:job.sha256,size:job.size,name:job.name}];
     const updated={...p,confirmed,stage:'emitting'};recordV3(updated);Object.assign(p,updated);
    }else{p.stage='complete';p.manifestSha=job.sha256;recordV3(p);}
    volumeWait=null;panel.replaceChildren();resolve(true);
    }catch(e){status('保存进度持久化失败，未继续下一卷：'+(e.message||e));}
   };
   const stop=document.createElement('button');stop.type='button';stop.className='ghost-btn';stop.textContent='暂停（保留已确认卷）';
   stop.onclick=()=>{volumeWait=null;panel.replaceChildren();reject(Error('备份已暂停。已确认的卷保留在“文件”App；重新开始可按哈希核对并继续。'));};
   panel.append(save,confirm,stop);
  });
 }
 const exportVolumesUI=(options={})=>guarded(()=>{const old=document.getElementById('tavern-migration-v3-takeover')?.dataset.expectedOwner;return withV3Owner(async()=>{
  const includeApiKey=!!document.getElementById('tavern-migration-secrets')?.checked;
  if(includeApiKey&&!confirm('整馆分卷将包含接口密钥和请求头，只能保存在自己的设备。继续？'))return;
  let p=progressV3();
  if(p?.stage==='complete')p=null;
  if(p&&p.includeApiKey!==includeApiKey)throw Error('本次包含密钥选项和上次不同。请先完成原进度或清除旧进度后开始新备份。');
  if(!p){p={version:3,archiveId:'mima_'+(crypto.randomUUID?.()||[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('')).replace(/[^a-z0-9_-]/ig,''),
    createdAt:new Date().toISOString(),includeApiKey,confirmed:[],stage:'emitting'};recordV3(p);}
  await MimaPlayTools?.flushDrafts?.();window.preserveComposerDraft?.();window.r19PersistReading?.();
  let inventory=null;
  const manifest=await MimaBackupVolumes.create({archiveId:p.archiveId,createdAt:p.createdAt,includeApiKey,
   getSection:collect,
   getFonts:async (op,meta)=>{
    if(op==='inventory'){
     inventory=await MimaFontManager.listBackupInventory();verifyFontCoverage(inventory.audit);return inventory;
    }
    if(op==='source')return MimaFontManager.openBackupSource(meta.id);
    if(op==='assert')return MimaFontManager.assertBackupInventory(inventory);
    throw Error('未知字体备份读取操作');
   },
   onProgress:status,
   onVolume:async v=>{
    const earlier=p.confirmed[v.index];
    if(earlier){if(earlier.sha256!==v.sha256||earlier.size!==v.size||earlier.name!==v.name)
       throw Error('已确认的第 '+(v.index+1)+' 卷与当前源码数据不一致，禁止混合两次归档；旧卷保留。');
      status('第 '+(v.index+1)+' 卷已确认且哈希一致，跳过重复保存');return;
    }
    if(v.index!==p.confirmed.length)throw Error('分卷顺序和保存进度不一致');
    await volumeConfirmation(v,p,'第 '+(v.index+1)+' 卷准备保存');
   }});
  const fileName='咪嘛馆_'+p.archiveId+'.mimavolumes.json';
  const manifestBlob=new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'});
  await volumeConfirmation({name:fileName,size:manifestBlob.size,sha256:manifest.sha256,blob:manifestBlob},p,'最后一步：保存整馆分卷清单');
  status('整馆 '+manifest.volumes.length+' 卷与最终清单均已由你确认保存。请在“文件”App 保留全部文件；只有重新导入核验后才能确认外部文件字节完整。');
 },options.expectedOwner||old||null)});
 const takeoverVolumesUI=()=>guarded(async()=>{
  if(navigator.locks?.request)throw Error('当前浏览器支持自动锁释放，请关闭正在执行备份的其他标签后重试');
  const old=await journal(V3_OWNER);
  if(!old?.token){status('没有滞留的整馆分卷所有权，可直接继续备份。');return;}
  if(!confirm('必须确认之前执行整馆分卷的所有其他标签页均已关闭，并核对“文件”App 中已保存的卷后，才能人工接管。继续？'))return;
  // Exit the guard before handing off to exportVolumesUI, otherwise busy stays true.
  const button=document.getElementById('tavern-migration-v3-takeover');
  if(button)button.dataset.expectedOwner=old.token;
  status('已记录旧租约身份；请点击“分卷整馆备份”继续，已确认卷将按 SHA 核对。');
 });
 function chooseVolumesUI(){const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.mimavol,.json';
  input.onchange=()=>guarded(async()=>{if(!input.files?.length)return;
   status('正在逐卷核对大小、SHA、章节和原件；通过后才开始预检');
   const r=await prepareVolumes(input.files);activeId=r.id;paintReceipt(r);status('整馆分卷全部预检通过，可以执行逐库恢复。');});input.click();}
 function status(text){const node=document.getElementById('tavern-migration-status');if(node)node.textContent=text}
 function paintReceipt(r){const node=document.getElementById('tavern-migration-receipt');if(!node)return;node.textContent=(r.status==='complete'?'全部项目已恢复；请刷新页面加载结果。':r.status==='prepared'?'全部项目预检通过，尚未开始本次恢复。':r.status==='running'?'正在按项目恢复…':'恢复已中断，可以核对后继续。')+'\n'+NAMES.map(n=>LABELS[n]+'：'+({pending:'尚未开始',running:'正在恢复',committed:'已恢复',unconfirmed:'结果待核对'}[r.stages[n]?.status]||'尚未开始')).join('\n')+(r.error?'\n停止原因：'+r.error:'')+'\n已恢复的内容会保留，继续时会核对并补齐缺失资料，不会重复添加。';const resumeButton=document.getElementById('tavern-migration-resume');if(resumeButton)resumeButton.hidden=r.status==='complete';}
 async function guarded(fn){if(busy)return;busy=true;try{await fn()}catch(e){status('未完成：'+e.message);console.error('[Tavern migration]',e)}finally{busy=false}}
 function download(file,name){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 function markup(){return `<div class="data-backup-card"><div class="row-title">整馆可迁移备份（包含小手机与兼容库）</div><p class="row-sub">包含剧情原文、记忆、角色面具、酒馆存档，小手机聊天／动态／钱包及媒体原件，以及工坊、壁纸、字体、个人音效、外观开关、未发送正文／导演草稿和阅读位置。导出时请暂停编辑与生成。恢复只补充缺失资料，同一条资料内容不同时会停下说明；工坊冲突草稿会另存副本。已有界面偏好、草稿和接口配置优先保留，差异可在恢复收据中查看。作者脚本授权需重新确认。<strong>各项目分别保存，中断后可继续，已完成部分不会回退。</strong></p><label class="check-row"><input id="tavern-migration-secrets" type="checkbox">导出时包含剧情/手机接口密钥与自定义请求头（敏感）</label><div class="toolbar"><button class="primary-btn" onclick="MimaTavernBackup.exportVolumesUI()">⇩ 分卷整馆备份（适合手机大字库）</button><button class="ghost-btn" onclick="MimaTavernBackup.chooseVolumesUI()">⇧ 校验／恢复整馆分卷</button><button id="tavern-migration-v3-takeover" class="ghost-btn" onclick="MimaTavernBackup.takeoverVolumesUI()">核对后接管中断的分卷任务</button><button class="ghost-btn" onclick="MimaTavernBackup.exportUI()">旧版单文件整馆归档</button><button class="ghost-btn" onclick="MimaTavernBackup.chooseUI()">⇧ 预检整馆归档</button><button id="tavern-migration-resume" class="ghost-btn" hidden onclick="MimaTavernBackup.resumeUI()">继续已预检恢复</button><button id="tavern-migration-takeover" class="ghost-btn" hidden onclick="MimaTavernBackup.takeoverUI()">核对后人工接管中断恢复</button><button class="ghost-btn" onclick="MimaTavernBackup.releaseV3StagingUI()">清理已完成恢复的临时备份副本</button><button class="ghost-btn" onclick="MimaTavernBackup.cleanupInterruptedV3UI()">清理失败的分卷导入</button><button class="ghost-btn" onclick="MimaTavernBackup.receiptUI()">导出恢复收据</button><button class="ghost-btn" onclick="MimaTavernBackup.draftsUI()">查看可恢复工具草稿</button></div><div id="tavern-migration-v3-panel" class="toolbar" style="display:flex;flex-wrap:wrap;gap:8px" aria-live="polite"></div><p id="tavern-migration-status" class="helper" role="status" aria-live="polite">手机大库建议整馆分卷，每卷约 16 MiB，全部保存后保留最终清单；旧单文件/JSON 仍可使用，但大字库下旧格式可能占用数倍内存并导致浏览器终止。</p><pre id="tavern-migration-receipt" style="white-space:pre-wrap;overflow-wrap:anywhere" aria-live="polite"></pre><div id="tavern-migration-drafts"></div></div>`}
 async function mount(){const id=await journal('latest');if(id){activeId=id;const r=await journal('receipt:'+id);if(r)paintReceipt(r);const owner=await journal('restore-owner:'+id);const b=document.getElementById('tavern-migration-takeover');if(b)b.hidden=!owner;}}
 const exportUI=()=>guarded(async()=>{const includeApiKey=!!document.getElementById('tavern-migration-secrets')?.checked;if(includeApiKey&&!confirm('归档将包含接口密钥与自定义请求头，请仅保存在自己的设备。继续？'))return;const blob=await build({includeApiKey,onProgress:status});download(blob,'咪嘛馆_整馆_'+new Date().toISOString().slice(0,10)+'.mimatavern');status('整馆归档已导出；请确认文件已保存。')});
 function chooseUI(){const input=document.createElement('input');input.type='file';input.accept='.mimatavern';input.onchange=()=>guarded(async()=>{if(!input.files?.[0])return;status('正在分段校验并预检所有数据库…');const r=await prepare(input.files[0]);activeId=r.id;paintReceipt(r);status('预检完成。点“继续已预检恢复”后开始逐库新增；冲突不会覆盖。')});input.click()}
 const resumeUI=()=>guarded(async()=>{if(!activeId)throw Error('请先预检归档');try{const receipt=await journal('receipt:'+activeId);await (receipt?.archiveFormat==='v3'?resumeV3(activeId):resume(activeId));status('全部阶段已提交，请刷新页面加载恢复内容。')}catch(error){if(String(error.message||'').includes('E_RESTORE_OWNED')){const b=document.getElementById('tavern-migration-takeover');if(b)b.hidden=false;}throw error;}});
 const takeoverUI=()=>guarded(async()=>{
  if(!activeId)throw Error('没有可接管的恢复');
  const owner=await journal('restore-owner:'+activeId),receipt=await journal('receipt:'+activeId),file=await journal('archive:'+activeId);
  const v3=receipt?.archiveFormat==='v3';
  if(!owner){await (v3?resumeV3(activeId):resume(activeId));return;}
  if(!receipt||(!v3&&!(file instanceof Blob)))throw Error('原始归档或收据缺失，拒绝接管');
  const archive=v3?await loadV3Source(activeId):await inspect(file);
  if(archive.id!==activeId)throw Error('归档身份不一致，拒绝接管');
  await (v3?preflightV3Stream(archive):preflight(archive.data));
  const unconfirmed=NAMES.filter(n=>['running','unconfirmed'].includes(receipt.stages?.[n]?.status));
  if(!confirm('只有确认其他咪嘛馆标签页已全部关闭、旧恢复没有在运行，才能人工接管。当前未确认阶段：'+(unconfirmed.join('、')||'无')+'。接管会重新核对真实数据库并只补缺失记录，不覆盖现有记录。若无法确认旧窗口已关闭，请取消。继续？'))return;
  await (v3?resumeV3(activeId,{expectedOwner:owner.token}):resume(activeId,{expectedOwner:owner.token}));status('人工接管完成，请核对恢复收据。');
 });
 const receiptUI=()=>guarded(async()=>{if(!activeId)throw Error('暂无恢复收据');download(new Blob([JSON.stringify(await journal('receipt:'+activeId),null,2)],{type:'application/json'}),'咪嘛馆_迁移收据.json')});
 const draftsUI=()=>guarded(async()=>{const rows=await MimaLocalStore.exportPlayToolRecords(),box=document.getElementById('tavern-migration-drafts');if(!box)return;box.replaceChildren();for(const[key,value]of rows.filter(([key])=>key.startsWith('play_tools_v1:draft:'))){const b=document.createElement('button');b.className='ghost-btn';b.textContent='打开草稿 '+key.slice('play_tools_v1:draft:'.length,60);b.onclick=()=>guarded(()=>MimaPlayTools.restoreMigrationDraft(value));box.append(b)}if(!box.childNodes.length)box.textContent='没有已保存的工具草稿。'});
 window.MimaTavernBackup=Object.freeze({build,inspect,preflight,prepare,resume,prepareVolumes,resumeV3,releaseV3StagingUI,cleanupInterruptedV3UI,markup,mount,exportUI,exportVolumesUI,takeoverVolumesUI,chooseUI,chooseVolumesUI,resumeUI,takeoverUI,receiptUI,draftsUI});
})();
