/* Independent compat database. This file never opens or mutates the legacy database. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatStore=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const DB='mimamao_tavern_compat_v1',VERSION=2;
// Add-only migration: existing records and primary keys remain untouched.
const SECONDARY_INDEXES=Object.freeze({resource_ir:'sourceId',messages:'sessionId',events_jobs:'sessionId'});
const STORES=['source_capsules','assets','resource_ir','resource_projections','compat_sessions','messages','variables','grants','events_jobs','import_journal','sidecar_links'];
const error=(code,message)=>Object.assign(new Error(message),{code});
async function hashBytes(bytes){if(!(bytes instanceof Uint8Array))throw error('E_STORE_UNVERIFIED','原始文件字节不可用');
 if(!globalThis.crypto?.subtle){if(globalThis.MimaSHA256?.digest)return globalThis.MimaSHA256.digest(bytes);throw error('E_STORE_UNVERIFIED','SHA256 校验组件不可用');}
 return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function verifySources(records){const all=records.source_capsules;if(!Array.isArray(all))throw error('E_STORE_UNVERIFIED','来源记录缺失');const ids=new Set();for(const item of all){if(!item||typeof item.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(item.sha256)||item.id!=='sha256:'+item.sha256||!(item.bytes instanceof Uint8Array)||item.bytes.length>32*1024*1024||ids.has(item.id))throw error('E_SOURCE_CORRUPT','备份中来源包对象/索引异常');ids.add(item.id);if(await hashBytes(item.bytes)!==item.sha256)throw error('E_SOURCE_CORRUPT','原始来源包 SHA256 不符：'+item.id);}for(const item of records.resource_ir||[])if(!ids.has(item.sourceId))throw error('E_SOURCE_CORRUPT','资源引用不存在的来源包');return true;}
function verifyRelationships(records){
 const map=name=>new Map((records[name]||[]).map(x=>[x.id,x]));
 const capsules=map('source_capsules'),ir=map('resource_ir'),sessions=map('compat_sessions'),messages=map('messages'),jobs=map('events_jobs'),grants=map('grants');
 const requireRef=(exists,label)=>{if(!exists)throw error('E_SOURCE_CORRUPT','备份关系失效：'+label);};
 for(const r of ir.values())requireRef(capsules.has(r.sourceId),'resource source '+r.id);
 for(const item of records.assets||[])if(item.sourceId)requireRef(capsules.has(item.sourceId),'asset source '+item.id);
 for(const item of records.resource_projections||[]){if(item.sourceId)requireRef(capsules.has(item.sourceId),'projection source '+item.id);if(item.resourceId)requireRef(ir.has(item.resourceId),'projection resource '+item.id);}
 for(const sess of sessions.values()){
   requireRef(capsules.has(sess.sourceId),'session source '+sess.id);
   requireRef(ir.get(sess.characterResourceId)?.sourceId===sess.sourceId,'session character '+sess.id);
   if(sess.pendingTurnId)requireRef(jobs.get(sess.pendingTurnId)?.sessionId===sess.id&&jobs.get(sess.pendingTurnId)?.settlement==='pending','pending journal '+sess.id);
   for(const mount of sess.mountGraph||[]){
     requireRef(ir.get(mount.resourceId)?.sourceId===mount.sourceId&&mount.sourceId==='sha256:'+mount.sha256,'mount '+sess.id);
     if(mount.trustedCreativeRole!==undefined){
       requireRef(typeof mount.trustedCreativeRole==='boolean'&&['preset','prompt_presets'].includes(mount.kind)&&ir.get(mount.resourceId)?.kind===mount.kind,
         'invalid preset role grant '+sess.id);
     }
   }
 }
 for(const m of messages.values()){
   requireRef(sessions.has(m.sessionId),'message session '+m.id);
   if(m.turnId)requireRef(jobs.get(m.turnId)?.sessionId===m.sessionId,'message turn '+m.id);
   if(!['pending','committed','failed','aborted'].includes(m.status))throw error('E_SOURCE_CORRUPT','无效消息结算状态 '+m.id);
   if(m.mvuStateAfter!==undefined){
    requireRef(m.role==='assistant'&&m.status==='committed'&&!!m.turnId,'MVU state must belong to committed assistant '+m.id);
    const state=m.mvuStateAfter;
    if(!state||typeof state!=='object'||Array.isArray(state)||JSON.stringify(state).length>64000)throw error('E_SOURCE_CORRUPT','MVU 状态快照无效 '+m.id);
   }
 }
 for(const j of jobs.values()){
   requireRef(sessions.has(j.sessionId),'journal session '+j.id);
   const user=messages.get(j.msgId||'u_'+j.id);
   if(j.kind==='assistant_continuation'){
    requireRef(user?.turnId===j.parentTurnId&&user?.role==='user','continuation parent input '+j.id);
    requireRef(messages.get(j.assistantId)?.turnId===j.parentTurnId&&messages.get(j.assistantId)?.role==='assistant','continuation assistant '+j.id);
   }else requireRef(user?.turnId===j.id&&user?.role==='user','journal input '+j.id);
   if(!['pending','committed','failed','aborted'].includes(j.settlement))throw error('E_SOURCE_CORRUPT','无效 journal settlement '+j.id);
   if(j.settlement==='pending')requireRef(sessions.get(j.sessionId)?.pendingTurnId===j.id,'journal has no owning pending session '+j.id);
   if(j.settlement==='committed'&&j.kind!=='assistant_continuation')requireRef(messages.get('a_'+j.id)?.role==='assistant','committed journal missing assistant '+j.id);
 }
 for(const g of grants.values())requireRef(sessions.has(g.sessionId),'grant session '+g.id);
 for(const v of records.variables||[])if(v.sessionId)requireRef(sessions.has(v.sessionId),'variable session '+v.id);
 for(const j of records.import_journal||[])if(j.sourceId)requireRef(capsules.has(j.sourceId),'import journal source '+j.id);
 return true;
}
const check=(v,what)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw error('E_STORE_UNVERIFIED',what+' 必须是对象');return v;};
function open(){if(typeof indexedDB==='undefined')return Promise.reject(error('E_STORE_UNVERIFIED','IndexedDB 不可用，拒绝初始化空资料库'));
 return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{const db=r.result;if(r.oldVersion>VERSION)throw error('E_STORE_UNVERIFIED','资料库版本比当前引擎新');for(const n of STORES){const object=db.objectStoreNames.contains(n)?(r.transaction?r.transaction.objectStore(n):typeof db.version!=='number'?null:(()=>{throw error('E_STORE_UNVERIFIED','数据库升级事务缺失')})()):db.createObjectStore(n,{keyPath:'id'});
   const indexField=SECONDARY_INDEXES[n];if(indexField){if(typeof object?.createIndex!=='function'){if(typeof db.version!=='number')continue;throw error('E_STORE_UNVERIFIED','兼容库索引升级不可用：'+n);}
    if(!object.indexNames.contains(indexField))object.createIndex(indexField,indexField,{unique:false});}}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(error('E_STORE_UNVERIFIED','兼容资料库无法验证或打开: '+r.error));r.onblocked=()=>reject(error('E_STORE_UNVERIFIED','资料库升级受到另一个页面阻挡'));});}
async function transact(names,mode,work){const db=await open();return new Promise((resolve,reject)=>{let tx,output,rootError;try{tx=db.transaction(names,mode);output=work(tx);}catch(e){db.close();try{tx?.abort();}catch(_){}reject(e);return;}
 tx.oncomplete=()=>{db.close();resolve(output);};tx.onabort=()=>{db.close();reject(rootError||tx.error||error('E_STORE_UNVERIFIED','事务已中止'));};tx.onerror=()=>{rootError??=tx.error;};});}
async function get(store,id){if(!STORES.includes(store))throw error('E_STORE_UNVERIFIED','未知 store');const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');let found,issue;const r=tx.objectStore(store).get(id);r.onsuccess=()=>found=r.result;r.onerror=()=>issue=r.error;tx.oncomplete=()=>{db.close();if(issue)reject(issue);else resolve(found===undefined?null:found);};tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','读取失败'));};});}
async function all(store){if(!STORES.includes(store))throw error('E_STORE_UNVERIFIED','未知 store');const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');let result,issue;const r=tx.objectStore(store).getAll();r.onsuccess=()=>result=r.result;r.onerror=()=>issue=r.error;tx.oncomplete=()=>{db.close();if(issue)reject(issue);else resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','枚举失败'));};});}
// Indexed reads avoid a full scan on every story turn. Browser schema v2
// is mandatory. Old isolated test doubles without db.version emulate v1.
async function byIndex(name,field,key){
 if(SECONDARY_INDEXES[name]!==field)throw error('E_STORE_UNVERIFIED','不支持的来源索引');
 const db=await open();return new Promise((resolve,reject)=>{
  let tx,request,issue,result;
  try{
   tx=db.transaction(name,'readonly');const target=tx.objectStore(name);
   if(typeof target.index==='function' && target.indexNames?.contains(field))request=target.index(field).getAll(key);
   else if(typeof db.version!=='number')request=target.getAll();
   else throw error('E_STORE_UNVERIFIED','兼容库索引缺失，拒绝假装没有数据：'+name+'.'+field);
   request.onsuccess=()=>{result=typeof db.version==='number'?request.result:request.result.filter(x=>x?.[field]===key);};
   request.onerror=()=>{issue=request.error;};
  }catch(e){db.close();try{tx?.abort();}catch(_){}reject(e);return;}
  tx.oncomplete=()=>{db.close();if(issue||!Array.isArray(result))reject(issue||error('E_STORE_UNVERIFIED','按来源查询不完整'));else resolve(result);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','按来源查询中止'));};
 });
}
function putCAS(store,value,expected=null){check(value,'保存资源');if(!STORES.includes(store)||!String(value.id||'').trim())return Promise.reject(error('E_STORE_UNVERIFIED','缺少主键'));
const dbPromise=open();return dbPromise.then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');const s=tx.objectStore(store);let result,issue;const read=s.get(value.id);read.onsuccess=()=>{const old=read.result;const revision=old?.revision??0;if(expected===null?(old!==undefined):revision!==expected){issue=error('E_CANONICAL_CONFLICT','资料已变化，拒绝覆盖 '+value.id);tx.abort();return;}if(store==='source_capsules'&&old!==undefined){issue=error('E_CANONICAL_CONFLICT','不可改写原始来源包');tx.abort();return;}result={...value,revision:revision+1};s.put(result);};read.onerror=()=>{issue=read.error;tx.abort();};tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error);};}));}
// The grant and the variable revision are checked in ONE IndexedDB readwrite
// transaction. A previously checked grant is not sufficient: revoke can win
// the race between rpc() and a later variable putCAS().
async function putVariableWithGrant(grantId,grantRevision,value,expectedRevision){
 check(value,'插件变量');
 if(typeof grantId!=='string'||!Number.isSafeInteger(grantRevision)||grantRevision<1||
    !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
    typeof value.id!=='string'||typeof value.sessionId!=='string'||typeof value.pluginHash!=='string'||
    value.id!==value.sessionId+':'+value.pluginHash||grantId!==value.id||
    !value.value||typeof value.value!=='object'||Array.isArray(value.value)||
    JSON.stringify(value.value).length>256*1024)
  throw error('E_PLUGIN_PERMISSION_DENIED','插件变量或授权标识不合法');
 const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction(['grants','variables'],'readwrite');let receipt,issue;
  const deny=(e)=>{issue=e;try{tx.abort();}catch(_){}};
  const grantReq=tx.objectStore('grants').get(grantId);
  grantReq.onsuccess=()=>{
   const g=grantReq.result;
   if(!g||g.revision!==grantRevision||g.revokedAt||g.id!==grantId||
      g.sessionId!==value.sessionId||g.pluginHash!==value.pluginHash||
      !Array.isArray(g.capabilities)||!g.capabilities.includes('vars.write')){
    deny(error('E_PLUGIN_STALE_FRAME','插件写入时授权已撤销或发生变化'));return;
   }
   const oldReq=tx.objectStore('variables').get(value.id);
   oldReq.onsuccess=()=>{
    const old=oldReq.result,rev=old?.revision??0;
    if(rev!==expectedRevision||expectedRevision===0&&old!==undefined){
      deny(error('E_CANONICAL_CONFLICT','插件变量已变化，拒绝覆盖 '+value.id));return;
    }
    receipt={...value,revision:rev+1};
    tx.objectStore('variables').put(receipt);
   };
   oldReq.onerror=()=>deny(oldReq.error||error('E_STORE_UNVERIFIED','插件变量版本读取失败'));
  };
  grantReq.onerror=()=>deny(grantReq.error||error('E_STORE_UNVERIFIED','插件授权读取失败'));
  tx.oncomplete=()=>{db.close();resolve(receipt);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','插件变量事务已中止'));};
 });
}
function uid(prefix='id'){return prefix+'_'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));}
async function importSource(capsule,resources){check(capsule,'来源包');if(typeof capsule.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(capsule.sha256)||!(capsule.bytes instanceof Uint8Array))throw error('E_SOURCE_CORRUPT','原始字节或 SHA256 缺失');if(capsule.bytes.length>32*1024*1024)throw error('E_DECOMPRESS_BUDGET','单个来源包超过 32 MB');if(!Array.isArray(resources)||resources.length>5000)throw error('E_DECOMPRESS_BUDGET','资源数量无效');
 if(await hashBytes(capsule.bytes)!==capsule.sha256)throw error('E_SOURCE_CORRUPT','来源包哈希和提交字节不一致');
 const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['source_capsules','resource_ir','import_journal'],'readwrite');let issue,result;const s=tx.objectStore('source_capsules'),ir=tx.objectStore('resource_ir'),journal=tx.objectStore('import_journal');const id='sha256:'+capsule.sha256;const q=s.get(id);q.onerror=()=>{issue=q.error;tx.abort();};q.onsuccess=()=>{if(q.result){const existing=q.result.bytes;if(q.result.sha256!==capsule.sha256||q.result.id!==id||!(existing instanceof Uint8Array)||existing.length!==capsule.bytes.length||existing.some((byte,k)=>byte!==capsule.bytes[k])){issue=error('E_SOURCE_CORRUPT','已存来源包字节与相同哈希的输入不一致');tx.abort();return;}
 // A SHA-matched capsule with missing or corrupt resource IR is not a
 // successful re-import. Do not overwrite its immutable original resources:
 // old session IDs depend on them, including dual-version PNG imports.
 if(typeof db.version==='number'&&!ir.indexNames?.contains('sourceId')){issue=error('E_STORE_UNVERIFIED','来源索引缺失，禁止同源资源假成功');tx.abort();return;}
 const checkResources=typeof ir.index==='function'&&ir.indexNames?.contains('sourceId')?ir.index('sourceId').getAll(id):ir.getAll();checkResources.onerror=()=>{issue=checkResources.error;tx.abort();};
 checkResources.onsuccess=()=>{const saved=checkResources.result.filter(v=>v.sourceId===id);
  if(!saved.length||saved.some(v=>v.sourceId!==id||typeof v.path!=='string'||!v.path||typeof v.kind!=='string'||!v.kind||!v.id?.startsWith(id+'#'))){issue=error('E_STORE_UNVERIFIED','已存同源卡片的资源索引缺失或损坏；为保护旧剧情，拒绝假装重新导入成功');tx.abort();return;}
  result={id,reused:true,resources:saved.length,projectionChanged:saved.length!==resources.length||resources.some(v=>!saved.some(x=>x.path===v.path&&x.kind===v.kind&&JSON.stringify(x.raw)===JSON.stringify(v.raw)))};
 };return;}
 s.add({...capsule,id,revision:1,importedAt:new Date().toISOString()});for(let i=0;i<resources.length;i++){const item=check(resources[i],'资源');ir.add({...item,id:id+'#'+i,sourceId:id,revision:1});}journal.add({id,sourceId:id,count:resources.length,status:'committed',revision:1,createdAt:new Date().toISOString()});result={id,reused:false,resources:resources.length};};tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','来源导入事务失败'));};});}
async function snapshot(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORES,'readonly');const records={},errors=[];for(const n of STORES){const r=tx.objectStore(n).getAll();r.onsuccess=()=>records[n]=r.result;r.onerror=()=>errors.push(r.error);}tx.oncomplete=()=>{db.close();if(errors.length)reject(errors[0]);else resolve({contractRevision:1,dbName:DB,dbVersion:VERSION,records});};tx.onabort=()=>{db.close();reject(tx.error||error('E_STORE_UNVERIFIED','快照失败'));};});}
function bytesToBase64(bytes){let chunks=[];for(let i=0;i<bytes.length;i+=0x4000)chunks.push(String.fromCharCode(...bytes.subarray(i,i+0x4000)));return btoa(chunks.join(''));}
function base64ToBytes(s){if(typeof s!=='string'||s.length>60*1024*1024||!/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(s))throw error('E_SOURCE_CORRUPT','备份编码无效');const bin=atob(s),b=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return b;}
function jsonify(snapshot){const replacer=(_,v)=>v instanceof Uint8Array?{__mimaBytes:bytesToBase64(v)}:v;return JSON.stringify(snapshot,replacer);}
async function packBackup(snapshot){
 const payload=jsonify(snapshot),sha256=await hashBytes(new TextEncoder().encode(payload));
 return JSON.stringify({contractRevision:2,format:'mimatavern-compat-snapshot-sha256-v2',integrity:{algorithm:'SHA-256',sha256},snapshot:JSON.parse(payload)});
}
async function unpackBackup(raw){
 if(typeof raw!=='string'||raw.length>180*1024*1024)throw error('E_DECOMPRESS_BUDGET','备份过大');
 const envelope=JSON.parse(raw);
 if(envelope?.format==='mimatavern-compat-snapshot-sha256-v2'){
  const payload=JSON.stringify(envelope.snapshot);
  if(envelope.contractRevision!==2||envelope.integrity?.algorithm!=='SHA-256'||await hashBytes(new TextEncoder().encode(payload))!==envelope.integrity.sha256)throw error('E_SOURCE_CORRUPT','备份外层 SHA256 校验失败');
  const data=parseBackup(payload);data.integrityVerified=true;return data;
 }
 const data=parseBackup(raw);data.integrityVerified=false;return data;
}
function parseBackup(str){if(typeof str!=='string'||str.length>180*1024*1024)throw error('E_STORE_UNVERIFIED','备份不是文本或超出安全上限');const parsed=JSON.parse(str,(_,v)=>v&&v.__mimaBytes?base64ToBytes(v.__mimaBytes):v);if(parsed.contractRevision!==1||parsed.dbName!==DB||!parsed.records||STORES.some(s=>!Array.isArray(parsed.records[s])))throw error('E_STORE_UNVERIFIED','兼容备份合同或 store 缺失');return parsed;}
async function restoreVerified(parsed,{dryRun=true,mode='merge-new-only',allowLegacyUnsealed=false}={}){
 if(!parsed||parsed.contractRevision!==1||parsed.dbName!==DB||![1,VERSION].includes(parsed.dbVersion)||!parsed.records||STORES.some(n=>!Array.isArray(parsed.records[n])))throw error('E_STORE_UNVERIFIED','未校验备份');
 if(!['merge-new-only','empty-only'].includes(mode))throw error('E_IMPORT_CONFLICT','未知恢复模式，不允许覆盖');
 const recordIds=new Set();for(const name of STORES){if(parsed.records[name].length>200000)throw error('E_DECOMPRESS_BUDGET','单表备份记录数超出上限');for(const item of parsed.records[name]){if(!item||typeof item.id!=='string'||!item.id.trim()||recordIds.has(name+':'+item.id))throw error('E_STORE_UNVERIFIED','备份重复主键/无效记录');recordIds.add(name+':'+item.id);}}
 await verifySources(parsed.records);verifyRelationships(parsed.records);
 // Read-only inspection is allowed regardless of existing data. Never conflate
 // current DB non-empty with a malformed backup, or destroy canonical records.
 const current=await snapshot();await verifySources(current.records);verifyRelationships(current.records);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const inspect=(existing)=>{
  const additions={},conflicts=[];let existingCount=0;
  for(const n of STORES){const known=new Map(existing[n].map(item=>[item.id,item]));additions[n]=[];
   if(mode==='empty-only'&&known.size)conflicts.push({store:n,reason:'target_nonempty'});
   for(const item of parsed.records[n]){const old=known.get(item.id);if(old===undefined)additions[n].push(item);else{existingCount++;if(!same(old,item))conflicts.push({store:n,id:item.id,reason:'id_collision_changed'});}}
  }
  if(!conflicts.length){const combined=Object.fromEntries(STORES.map(n=>[n,[...existing[n],...additions[n]]]));verifyRelationships(combined);}
  return{additions,conflicts,existingCount,counts:Object.fromEntries(STORES.map(n=>[n,parsed.records[n].length])),willAdd:Object.fromEntries(STORES.map(n=>[n,additions[n].length]))};
 };
 const initial=inspect(current.records);
 if(dryRun)return{dryRun:true,mode,counts:initial.counts,willAdd:initial.willAdd,alreadyPresent:initial.existingCount,conflicts:initial.conflicts};
 if(!parsed.integrityVerified&&!allowLegacyUnsealed)throw error('E_SOURCE_CORRUPT','旧版无外层哈希的备份只能预检查；写入需手动确认旧格式风险');
 if(initial.conflicts.length)throw error('E_IMPORT_CONFLICT','备份记录与现有资料冲突，拒绝覆盖；冲突数：'+initial.conflicts.length);
 // Single readwrite transaction: re-read all stores and verify all IDs and
 // cross-store references *inside the write lock*. No stale preflight can
 // overwrite newer revisions or silently skip a changed record.
 const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORES,'readwrite'),live={},fail=e=>{issue=e;try{tx.abort();}catch(_){}},requests=[];
  let issue,result,completed=0;
  for(const n of STORES){const q=tx.objectStore(n).getAll();requests.push(q);
   q.onsuccess=()=>{live[n]=q.result;if(++completed!==STORES.length)return;
    try{
     const checkResult=inspect(live);
     if(checkResult.conflicts.length)throw error('E_IMPORT_CONFLICT','恢复前目标库已改变或包含同名不同内容；拒绝覆盖（'+checkResult.conflicts.length+' 冲突）');
     for(const name of STORES)for(const item of checkResult.additions[name])tx.objectStore(name).add(item);
     result={restored:true,mode,added:checkResult.willAdd,alreadyPresent:checkResult.existingCount};
    }catch(e){fail(e);}
   };
   q.onerror=()=>fail(q.error||error('E_STORE_UNVERIFIED','恢复事务读取失败：'+n));
  }
  tx.oncomplete=()=>{db.close();resolve(result);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','恢复事务被中止，资料未写入'));};
 });
}
return Object.freeze({DB,VERSION,STORES,error,uid,open,get,all,byIndex,putCAS,putVariableWithGrant,importSource,snapshot,jsonify,packBackup,unpackBackup,parseBackup,restoreVerified,verifySources,verifyRelationships});
});
