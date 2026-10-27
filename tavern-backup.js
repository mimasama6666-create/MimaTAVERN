/* Whole-tavern migration. Independent stores commit separately; no cross-DB atomic claim. */
(()=>{'use strict';
 const FORMAT='MIMA_TAVERN_MIGRATION',VERSION=2,CHUNK=192*1024;
 const NAMES=['native','compat','phone','atelier','wallpapers','fonts','sounds','prefs','playtools'];
 const LABELS={native:'原生剧情、记忆与角色面具',compat:'酒馆兼容库与来源',phone:'小手机全部表与原始媒体',atelier:'工坊项目与素材',wallpapers:'已保存壁纸',fonts:'本地字体原件',sounds:'个人点击音效原件',prefs:'接口与界面偏好',playtools:'工具草稿与清理记录'};
 const PREFS=['mimamao_tavern_url_fonts_v1','MIMATAVERN_UI_DENSITY_V1','MIMAMAO_TAVERN_TEMP','storyFontUrl','storyFontFamily','MIMAMAO_TAVERN_STORY_TYPO_V1','mimamao_tavern_ui_font','mimamao_tavern_story_font','MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1','mima-r19-ui-feedback-prefs-v1','mima-r19-last-session-v1'];
 const SESSION_PREFS=['mima-r19-unsent-v1:','mima-r19-reader-v1:'];
 const prefKeys=library=>[...PREFS,...(library.sessions||[]).flatMap(session=>SESSION_PREFS.map(prefix=>prefix+session.id))];
 const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=0x4000)s+=String.fromCharCode(...bytes.subarray(i,i+0x4000));return btoa(s)};
 const unb64=s=>{if(typeof s!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error('归档二进制编码无效');return Uint8Array.from(atob(s),x=>x.charCodeAt(0))};
 let busy=false,activeId=null;
 function journalDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open('mimamao_tavern_migration_v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('迁移日志被其他窗口阻塞'))})}
 async function journal(key,value){const db=await journalDB();return new Promise((resolve,reject)=>{const tx=db.transaction('kv',arguments.length===1?'readonly':'readwrite'),os=tx.objectStore('kv');let result,issue;const q=arguments.length===1?os.get(key):os.put(value,key);q.onsuccess=()=>result=q.result;q.onerror=()=>{issue=q.error;tx.abort()};tx.oncomplete=()=>{db.close();resolve(arguments.length===1?result:value)};tx.onabort=()=>{db.close();reject(issue||tx.error||Error('迁移日志写入失败'))}})}
 async function saveReceipt(receipt){receipt.updatedAt=new Date().toISOString();await journal('receipt:'+receipt.id,receipt);await journal('latest',receipt.id);activeId=receipt.id;paintReceipt(receipt);return receipt}
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
 // Encode binary objects as bounded base64 lines, never JSON-stringify all phone
 // media into one giant string. Blob parts retain their backing storage.
 async function build({includeApiKey=false,onProgress=()=>{}}={}){
  await MimaPlayTools?.flushDrafts?.();window.preserveComposerDraft?.();window.r19PersistReading?.();const parts=[],manifest=[],binary=[];let binaryId=0;
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
  for(const name of NAMES){onProgress('正在读取 '+LABELS[name]);const data=await collect(name,includeApiKey),encoded=await encode(data);captured[name]=JSON.stringify(await signature(data));await line({kind:'section',name,data:encoded})}
  for(const {ref,blob} of binary){const total=Math.ceil(blob.size/CHUNK);for(let i=0;i<total;i++)await line({kind:'chunk',id:ref.id,index:i,total,data:b64(new Uint8Array(await blob.slice(i*CHUNK,(i+1)*CHUNK).arrayBuffer()))});}
  for(const name of NAMES){onProgress('正在核对导出一致性：'+LABELS[name]);if(captured[name]!==JSON.stringify(await signature(await collect(name,includeApiKey))))throw Error('导出期间 '+LABELS[name]+' 已改变，请暂停编辑/生成后重试');}
  // All records are validated before a downloadable artifact is offered.
  const footer={kind:'footer',entries:manifest.length,sha256:await sha(manifest.join('\n'))};parts.push(new Blob([JSON.stringify(footer)+'\n']));
  const blob=new Blob(parts,{type:'application/x-mima-tavern-migration'});
  await preflight((await inspect(blob)).data);onProgress('整馆归档已校验，可保存到文件');return blob;
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
  const additions=[],preserved=[];for(const[k,v]of Object.entries(src.values)){if(!prefKeys(library).includes(k)||typeof v!=='string')throw Error('偏好键或值无效');const old=localStorage.getItem(k);if(old===null)additions.push([k,v]);else if(old!==v)preserved.push(k)}
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
 async function resume(id){const execute=async()=>{
  const receipt=await journal('receipt:'+id);if(!receipt)throw Error('没有可继续的迁移日志');const file=await journal('archive:'+id);if(!(file instanceof Blob))throw Error('恢复源文件不可读，请重新选择原文件');const archive=await inspect(file);if(archive.id!==id)throw Error('暂存恢复源不一致');
  // Recheck ALL stores before proceeding, including stages committed before a
  // crash. Never trust a stale receipt to authorize overwriting edited records.
  try{await preflight(archive.data);receipt.history=Array.isArray(receipt.history)?receipt.history:[];if(receipt.error)receipt.history.push({at:receipt.updatedAt,error:receipt.error});delete receipt.error;receipt.status='running';await saveReceipt(receipt);
   for(const name of NAMES){receipt.stages[name]={status:'running',startedAt:new Date().toISOString()};await saveReceipt(receipt);
    const result=await runStage(name,archive.data);receipt.stages[name]={status:'committed',completedAt:new Date().toISOString(),result};await saveReceipt(receipt);
   }
   receipt.status='complete';delete receipt.error;receipt.completedAt=new Date().toISOString();await saveReceipt(receipt);return receipt;
  }catch(e){receipt.status='interrupted';receipt.error=e.message;for(const stage of Object.values(receipt.stages))if(stage.status==='running'){stage.status='unconfirmed';stage.error='提交结果待核实；重新读取后幂等继续。'+e.message}await saveReceipt(receipt);throw e}
 };if(navigator.locks?.request)return navigator.locks.request('mima-whole-tavern-restore',{mode:'exclusive'},execute);return execute()}
 function status(text){const node=document.getElementById('tavern-migration-status');if(node)node.textContent=text}
 function paintReceipt(r){const node=document.getElementById('tavern-migration-receipt');if(!node)return;node.textContent=(r.status==='complete'?'全部项目已恢复；请刷新页面加载结果。':r.status==='prepared'?'全部项目预检通过，尚未开始本次恢复。':r.status==='running'?'正在按项目恢复…':'恢复已中断，可以核对后继续。')+'\n'+NAMES.map(n=>LABELS[n]+'：'+({pending:'尚未开始',running:'正在恢复',committed:'已恢复',unconfirmed:'结果待核对'}[r.stages[n]?.status]||'尚未开始')).join('\n')+(r.error?'\n停止原因：'+r.error:'')+'\n已恢复的内容会保留，继续时会核对并补齐缺失资料，不会重复添加。';const resumeButton=document.getElementById('tavern-migration-resume');if(resumeButton)resumeButton.hidden=r.status==='complete';}
 async function guarded(fn){if(busy)return;busy=true;try{await fn()}catch(e){status('未完成：'+e.message);console.error('[Tavern migration]',e)}finally{busy=false}}
 function download(file,name){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 function markup(){return `<div class="data-backup-card"><div class="row-title">整馆可迁移备份（包含小手机与兼容库）</div><p class="row-sub">包含剧情原文、记忆、角色面具、酒馆存档，小手机聊天／动态／钱包及媒体原件，以及工坊、壁纸、字体、个人音效、外观开关、未发送正文／导演草稿和阅读位置。导出时请暂停编辑与生成。恢复只补充缺失资料，同一条资料内容不同时会停下说明；工坊冲突草稿会另存副本。已有界面偏好、草稿和接口配置优先保留，差异可在恢复收据中查看。作者脚本授权需重新确认。<strong>各项目分别保存，中断后可继续，已完成部分不会回退。</strong></p><label class="check-row"><input id="tavern-migration-secrets" type="checkbox">导出时包含剧情/手机接口密钥与自定义请求头（敏感）</label><div class="toolbar"><button class="primary-btn" onclick="MimaTavernBackup.exportUI()">⇩ 导出整馆归档</button><button class="ghost-btn" onclick="MimaTavernBackup.chooseUI()">⇧ 预检整馆归档</button><button id="tavern-migration-resume" class="ghost-btn" hidden onclick="MimaTavernBackup.resumeUI()">继续已预检恢复</button><button class="ghost-btn" onclick="MimaTavernBackup.receiptUI()">导出恢复收据</button><button class="ghost-btn" onclick="MimaTavernBackup.draftsUI()">查看可恢复工具草稿</button></div><p id="tavern-migration-status" class="helper" role="status" aria-live="polite">新格式 .mimatavern；下方原有 JSON 备份入口继续保留。</p><pre id="tavern-migration-receipt" style="white-space:pre-wrap;overflow-wrap:anywhere" aria-live="polite"></pre><div id="tavern-migration-drafts"></div></div>`}
 async function mount(){const id=await journal('latest');if(id){activeId=id;const r=await journal('receipt:'+id);if(r)paintReceipt(r)}}
 const exportUI=()=>guarded(async()=>{const includeApiKey=!!document.getElementById('tavern-migration-secrets')?.checked;if(includeApiKey&&!confirm('归档将包含接口密钥与自定义请求头，请仅保存在自己的设备。继续？'))return;const blob=await build({includeApiKey,onProgress:status});download(blob,'咪嘛馆_整馆_'+new Date().toISOString().slice(0,10)+'.mimatavern');status('整馆归档已导出；请确认文件已保存。')});
 function chooseUI(){const input=document.createElement('input');input.type='file';input.accept='.mimatavern';input.onchange=()=>guarded(async()=>{if(!input.files?.[0])return;status('正在分段校验并预检所有数据库…');const r=await prepare(input.files[0]);activeId=r.id;paintReceipt(r);status('预检完成。点“继续已预检恢复”后开始逐库新增；冲突不会覆盖。')});input.click()}
 const resumeUI=()=>guarded(async()=>{if(!activeId)throw Error('请先预检归档');await resume(activeId);status('全部阶段已提交，请刷新页面加载恢复内容。')});
 const receiptUI=()=>guarded(async()=>{if(!activeId)throw Error('暂无恢复收据');download(new Blob([JSON.stringify(await journal('receipt:'+activeId),null,2)],{type:'application/json'}),'咪嘛馆_迁移收据.json')});
 const draftsUI=()=>guarded(async()=>{const rows=await MimaLocalStore.exportPlayToolRecords(),box=document.getElementById('tavern-migration-drafts');if(!box)return;box.replaceChildren();for(const[key,value]of rows.filter(([key])=>key.startsWith('play_tools_v1:draft:'))){const b=document.createElement('button');b.className='ghost-btn';b.textContent='打开草稿 '+key.slice('play_tools_v1:draft:'.length,60);b.onclick=()=>guarded(()=>MimaPlayTools.restoreMigrationDraft(value));box.append(b)}if(!box.childNodes.length)box.textContent='没有已保存的工具草稿。'});
 window.MimaTavernBackup=Object.freeze({build,inspect,preflight,prepare,resume,markup,mount,exportUI,chooseUI,resumeUI,receiptUI,draftsUI});
})();
