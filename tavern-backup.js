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
 const liveRestoreTokens=new Set();
 const restoreSignal=typeof BroadcastChannel==='function'?new BroadcastChannel('mima-whole-restore-live-v1'):null;
 if(restoreSignal)restoreSignal.addEventListener('message',event=>{
  const message=event.data;
  if(message?.type==='probe'&&liveRestoreTokens.has(message.token))restoreSignal.postMessage({type:'alive',id:message.id,token:message.token});
 });
 async function checkManualTakeover(token){
  if(liveRestoreTokens.has(token))throw Error('E_RESTORE_OWNED：当前窗口仍在恢复');
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
 async function resume(id,{expectedOwner=null}={}){
  // Validate the archived source before claiming execution. Preflight is run
  // again after ownership is acquired and before every resumed stage.
  const file=await journal('archive:'+id);if(!(file instanceof Blob))throw Error('恢复源文件不可读，请重新选择原文件');
  const archive=await inspect(file);if(archive.id!==id)throw Error('暂存恢复源不一致');
  const token='restore-'+[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const execute=async()=>{
   if(expectedOwner)await checkManualTakeover(expectedOwner);
   const receipt=await restoreJournal(id,'claim',{token,expectedOwner});
   liveRestoreTokens.add(token);
   try{
    if(receipt.status==='complete'){await preflight(archive.data);await saveOwnedReceipt(receipt,token,true);return receipt;}
    // The full archive is checked against live databases on each continuation;
    // each merge-new-only stage then rechecks its own target before committing.
    await preflight(archive.data);
    receipt.history=Array.isArray(receipt.history)?receipt.history:[];
    if(receipt.error)receipt.history.push({at:receipt.updatedAt,error:receipt.error});
    delete receipt.error;receipt.status='running';await saveOwnedReceipt(receipt,token);
    for(const name of NAMES){
     // Each merge-new-only runStage rechecks live target records in its own
     // store; a previous receipt alone never authorizes skipping this step.
     receipt.stages[name]={status:'running',startedAt:new Date().toISOString()};
     await saveOwnedReceipt(receipt,token);
     const result=await runStage(name,archive.data);
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

 function status(text){const node=document.getElementById('tavern-migration-status');if(node)node.textContent=text}
 function paintReceipt(r){const node=document.getElementById('tavern-migration-receipt');if(!node)return;node.textContent=(r.status==='complete'?'全部项目已恢复；请刷新页面加载结果。':r.status==='prepared'?'全部项目预检通过，尚未开始本次恢复。':r.status==='running'?'正在按项目恢复…':'恢复已中断，可以核对后继续。')+'\n'+NAMES.map(n=>LABELS[n]+'：'+({pending:'尚未开始',running:'正在恢复',committed:'已恢复',unconfirmed:'结果待核对'}[r.stages[n]?.status]||'尚未开始')).join('\n')+(r.error?'\n停止原因：'+r.error:'')+'\n已恢复的内容会保留，继续时会核对并补齐缺失资料，不会重复添加。';const resumeButton=document.getElementById('tavern-migration-resume');if(resumeButton)resumeButton.hidden=r.status==='complete';}
 async function guarded(fn){if(busy)return;busy=true;try{await fn()}catch(e){status('未完成：'+e.message);console.error('[Tavern migration]',e)}finally{busy=false}}
 function download(file,name){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 function markup(){return `<div class="data-backup-card"><div class="row-title">整馆可迁移备份（包含小手机与兼容库）</div><p class="row-sub">包含剧情原文、记忆、角色面具、酒馆存档，小手机聊天／动态／钱包及媒体原件，以及工坊、壁纸、字体、个人音效、外观开关、未发送正文／导演草稿和阅读位置。导出时请暂停编辑与生成。恢复只补充缺失资料，同一条资料内容不同时会停下说明；工坊冲突草稿会另存副本。已有界面偏好、草稿和接口配置优先保留，差异可在恢复收据中查看。作者脚本授权需重新确认。<strong>各项目分别保存，中断后可继续，已完成部分不会回退。</strong></p><label class="check-row"><input id="tavern-migration-secrets" type="checkbox">导出时包含剧情/手机接口密钥与自定义请求头（敏感）</label><div class="toolbar"><button class="primary-btn" onclick="MimaTavernBackup.exportUI()">⇩ 导出整馆归档</button><button class="ghost-btn" onclick="MimaTavernBackup.chooseUI()">⇧ 预检整馆归档</button><button id="tavern-migration-resume" class="ghost-btn" hidden onclick="MimaTavernBackup.resumeUI()">继续已预检恢复</button><button id="tavern-migration-takeover" class="ghost-btn" hidden onclick="MimaTavernBackup.takeoverUI()">核对后人工接管中断恢复</button><button class="ghost-btn" onclick="MimaTavernBackup.receiptUI()">导出恢复收据</button><button class="ghost-btn" onclick="MimaTavernBackup.draftsUI()">查看可恢复工具草稿</button></div><p id="tavern-migration-status" class="helper" role="status" aria-live="polite">新格式 .mimatavern；下方原有 JSON 备份入口继续保留。</p><pre id="tavern-migration-receipt" style="white-space:pre-wrap;overflow-wrap:anywhere" aria-live="polite"></pre><div id="tavern-migration-drafts"></div></div>`}
 async function mount(){const id=await journal('latest');if(id){activeId=id;const r=await journal('receipt:'+id);if(r)paintReceipt(r);const owner=await journal('restore-owner:'+id);const b=document.getElementById('tavern-migration-takeover');if(b)b.hidden=!owner;}}
 const exportUI=()=>guarded(async()=>{const includeApiKey=!!document.getElementById('tavern-migration-secrets')?.checked;if(includeApiKey&&!confirm('归档将包含接口密钥与自定义请求头，请仅保存在自己的设备。继续？'))return;const blob=await build({includeApiKey,onProgress:status});download(blob,'咪嘛馆_整馆_'+new Date().toISOString().slice(0,10)+'.mimatavern');status('整馆归档已导出；请确认文件已保存。')});
 function chooseUI(){const input=document.createElement('input');input.type='file';input.accept='.mimatavern';input.onchange=()=>guarded(async()=>{if(!input.files?.[0])return;status('正在分段校验并预检所有数据库…');const r=await prepare(input.files[0]);activeId=r.id;paintReceipt(r);status('预检完成。点“继续已预检恢复”后开始逐库新增；冲突不会覆盖。')});input.click()}
 const resumeUI=()=>guarded(async()=>{if(!activeId)throw Error('请先预检归档');try{await resume(activeId);status('全部阶段已提交，请刷新页面加载恢复内容。')}catch(error){if(String(error.message||'').includes('E_RESTORE_OWNED')){const b=document.getElementById('tavern-migration-takeover');if(b)b.hidden=false;}throw error;}});
 const takeoverUI=()=>guarded(async()=>{
  if(!activeId)throw Error('没有可接管的恢复');
  const owner=await journal('restore-owner:'+activeId),receipt=await journal('receipt:'+activeId),file=await journal('archive:'+activeId);
  if(!owner){await resume(activeId);return;}
  if(!(file instanceof Blob)||!receipt)throw Error('原始归档或收据缺失，拒绝接管');
  const archive=await inspect(file);if(archive.id!==activeId)throw Error('归档身份不一致，拒绝接管');
  await preflight(archive.data);
  const unconfirmed=NAMES.filter(n=>['running','unconfirmed'].includes(receipt.stages?.[n]?.status));
  if(!confirm('只有确认其他咪嘛馆标签页已全部关闭、旧恢复没有在运行，才能人工接管。当前未确认阶段：'+(unconfirmed.join('、')||'无')+'。接管会重新核对真实数据库并只补缺失记录，不覆盖现有记录。若无法确认旧窗口已关闭，请取消。继续？'))return;
  await resume(activeId,{expectedOwner:owner.token});status('人工接管完成，请核对恢复收据。');
 });
 const receiptUI=()=>guarded(async()=>{if(!activeId)throw Error('暂无恢复收据');download(new Blob([JSON.stringify(await journal('receipt:'+activeId),null,2)],{type:'application/json'}),'咪嘛馆_迁移收据.json')});
 const draftsUI=()=>guarded(async()=>{const rows=await MimaLocalStore.exportPlayToolRecords(),box=document.getElementById('tavern-migration-drafts');if(!box)return;box.replaceChildren();for(const[key,value]of rows.filter(([key])=>key.startsWith('play_tools_v1:draft:'))){const b=document.createElement('button');b.className='ghost-btn';b.textContent='打开草稿 '+key.slice('play_tools_v1:draft:'.length,60);b.onclick=()=>guarded(()=>MimaPlayTools.restoreMigrationDraft(value));box.append(b)}if(!box.childNodes.length)box.textContent='没有已保存的工具草稿。'});
 window.MimaTavernBackup=Object.freeze({build,inspect,preflight,prepare,resume,markup,mount,exportUI,chooseUI,resumeUI,takeoverUI,receiptUI,draftsUI});
})();
