/* MimaTAVERN R19 — opt-in manual cloud backup, independent of local receipts. */
window.MimaCloudBackup=(()=>{'use strict';
 const C=window.MimaCloudCrypto,T=window.MimaCloudTargets,ROOT=T.ROOT;
 const PREFIX='snapshots/',hex=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{32}$/.test(x);
 const manifestKey=id=>ROOT+PREFIX+id+'/manifest.mimaenc';
 const completeKey=id=>ROOT+PREFIX+id+'/complete.mimaenc';
 const deletingKey=id=>ROOT+PREFIX+id+'/deleting.mimaenc';
 const deleteOwnerKey=ROOT+'delete-owner.json';
 const volumeKey=(id,i)=>ROOT+PREFIX+id+'/'+String(i+1).padStart(4,'0')+'.mimaenc';
 const readJSON=async(blob,label)=>{if(!(blob instanceof Blob)||blob.size>2*1048576)throw Error(label+'大小异常');try{return JSON.parse(await blob.text())}catch(_){throw Error(label+'不是有效 JSON')}};
 function database(){return new Promise((resolve,reject)=>{const q=indexedDB.open('mima_cloud_backup_v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||Error('云端任务记录数据库打不开'));q.onblocked=()=>reject(Error('另一个标签阻塞了云端记录数据库升级'))})}
 async function record(key,value){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('kv',arguments.length===1?'readonly':'readwrite'),os=tx.objectStore('kv');let result,issue;const q=arguments.length===1?os.get(key):os.put(value,key);q.onsuccess=()=>result=q.result;q.onerror=()=>{issue=q.error;tx.abort()};tx.oncomplete=()=>resolve(arguments.length===1?result:value);tx.onabort=()=>reject(issue||tx.error||Error('云备份记录提交失败'))})}finally{db.close()}}
 function targetId(config){return config.type+'|'+config.address}
 function safe(config,token){return T.connect(T.parse(config.type,config.address),token)}
 async function configure(config){const parsed=T.parse(config.type,config.address);await record('config',{type:parsed.type,address:parsed.address});return parsed}
 const savedConfig=()=>record('config');
 const jobKey=config=>'job:'+targetId(config);
 const archiveKey=config=>'archived-jobs:'+targetId(config);
 async function unfinishedJobs(config){const live=await record(jobKey(config)),archived=await record(archiveKey(config))||[];
  return [...(live&&live.stage!=='complete'&&live.stage!=='cleaned'?[live]:[]),...archived.filter(x=>x.stage!=='complete'&&x.stage!=='cleaned')].filter((x,i,a)=>a.findIndex(y=>y.snapshotId===x.snapshotId)===i);
 }
 const unfinished=async config=>(await unfinishedJobs(config))[0]||null;
 async function saveJob(config,job,isArchived){if(isArchived){const all=await record(archiveKey(config))||[],idx=all.findIndex(x=>x.snapshotId===job.snapshotId);
   if(idx<0)throw Error('旧云端任务身份已变化，请重新查看未完成任务');all[idx]=job;await record(archiveKey(config),all)}else await record(jobKey(config),job)}
 async function forgetJob(config,id){const live=await record(jobKey(config));if(live?.snapshotId===id)await record(jobKey(config),{...live,stage:'cleaned'});
  const archived=await record(archiveKey(config))||[];if(archived.some(x=>x.snapshotId===id))await record(archiveKey(config),archived.filter(x=>x.snapshotId!==id));
 }
 async function readVault(provider){const blob=await provider.get(ROOT+'vault.json');return blob?C.checkVault(await readJSON(blob,'云端加密仓库信息')):null}
 async function getVault(provider,create,password){
  // Read the HF revision BEFORE checking for an absent vault. A second
  // browser cannot overwrite the first browser's newly committed identity.
  const parentCommit=create&&provider.revision?await provider.revision():undefined;
  let vault=await readVault(provider);
  if(!vault&&create){const candidate=await C.protectVault(C.createVault(),password),data=new Blob([JSON.stringify(candidate)],{type:'application/json'});
   let conflicted=false;try{await provider.put(ROOT+'vault.json',data,{ifAbsent:true,parentCommit})}
   catch(error){const other=await readVault(provider);if(!other)throw error;vault=other;conflicted=true}
   const observed=await readVault(provider);
   if(!observed)throw Error('云端加密仓库初始化未读回，拒绝继续');
   if(!conflicted&&JSON.stringify(candidate)!==JSON.stringify(observed))throw Error('另一个设备修改了仓库身份，请重新连接核对');
   vault=observed;
  }
  if(!vault)throw Error('该云端尚未建立咪嘛馆加密备份仓库');return vault;
 }
 let cancelling=false,active=false;
 const stopIfNeeded=()=>{if(cancelling)throw Error('已暂停当前云端任务，已验证的卷仍保留；继续前会重新核对来源')};
 const cancel=()=>{if(active)cancelling=true;return active};
 async function guarded(fn){if(active)throw Error('本标签已有云端作业，不能重复执行');active=true;cancelling=false;try{return await fn()}finally{active=false;cancelling=false}}
 async function needsPasswordConfirmation({config,token}){const provider=safe(config,token);await provider.check();return !(await readVault(provider))}
 async function testConnection({config,token,onProgress=()=>{}}){return guarded(async()=>{
  const provider=safe(config,token);onProgress('正在检查仓库和权限');await provider.check();
  const key=ROOT+'_probe/'+hex()+'.txt',payload=new Blob([hex()],{type:'text/plain'});let written=false;
  try{onProgress('正在写入独立测试对象');await provider.put(key,payload);written=true;
   const fetched=await provider.get(key);if(!fetched||fetched.size!==payload.size||await C.hashBlob(fetched)!==await C.hashBlob(payload))throw Error('写入虽有响应，但远端读回测试没有通过');
  }finally{if(written){onProgress('正在清理测试对象');await provider.delete(key)}}
  onProgress('已完成读写、读回校验和测试文件清理');return true;
 })}
 async function putChecked(provider,key,cipher,sha,onProgress){
  stopIfNeeded();const old=await provider.get(key);
  if(old){if(old.size!==cipher.size||await C.hashBlob(old)!==sha)throw Error('远端已有同名但内容不同的密文，禁止覆盖或混合快照');onProgress('远端对象已存在且校验一致，安全复用');return}
  try{await provider.put(key,cipher)}catch(error){
   // A server can commit a write and lose the response. Inspect bytes first.
   const after=await provider.get(key).catch(()=>null);
   if(!after||after.size!==cipher.size||await C.hashBlob(after)!==sha)throw error;
  }
  const received=await provider.get(key);
  if(!received||received.size!==cipher.size||await C.hashBlob(received)!==sha)throw Error('远端上传结果无法完整读回校验；未宣告备份成功');
 }
 function verifyPlan(job,entry){const e=job.manifest?.volumes?.[entry.index];if(!e||e.sha256!==entry.sha256||e.size!==entry.size||e.name!==entry.name)throw Error('E_SOURCE_CHANGED：原存档已变化，禁止把不同时间的分卷混成一个快照；请重新创建备份')}
 async function backup({config,token,password,includeApiKey=false,resume=false,resumeSnapshotId=null,preservePrevious=false,onProgress=()=>{}}){return guarded(async()=>{
  const provider=safe(config,token);await provider.check();stopIfNeeded();
  return MimaTavernBackup.withCloudV3Owner(async()=>{
   const vault=await getVault(provider,true,password),master=await C.unlock(vault,password),key=jobKey(config);
   const live=await record(key),archived=await record(archiveKey(config))||[];
   let job=resume?(resumeSnapshotId?[live,...archived].find(x=>x?.snapshotId===resumeSnapshotId):await unfinished(config)):null;
   if(resume&&(!job||job.stage==='complete'||job.stage==='cleaned'))throw Error('找不到指定的未完成备份');
   const isArchived=!!(job&&live?.snapshotId!==job.snapshotId);
   if(job&&(job.vaultId!==vault.vaultId||job.includeApiKey!==!!includeApiKey||job.target!==targetId(config)))throw Error('云端仓库或密钥选项已变化，不能续传这份快照');
   if(!job){
    if(live&&live.stage!=='complete'&&live.stage!=='cleaned'&&!preservePrevious)throw Error('已有未完成备份，必须选择继续旧任务，或明确保留旧任务后新建');
    if(live&&live.stage!=='complete'&&live.stage!=='cleaned')await record(archiveKey(config),[...archived.filter(x=>x.snapshotId!==live.snapshotId),live]);
    const id=hex();job={snapshotId:id,archiveId:'mima_'+id,createdAt:new Date().toISOString(),target:targetId(config),vaultId:vault.vaultId,includeApiKey:!!includeApiKey,stage:'capturing',manifest:null,confirmed:[]};await record(key,job);
   }
   const persist=()=>saveJob(config,job,isArchived);
   if(await provider.get(deletingKey(job.snapshotId)))throw Error('这份云端快照已进入删除流程，禁止再续传');
   const options={archiveId:job.archiveId,createdAt:job.createdAt,includeApiKey:job.includeApiKey};
   if(!job.manifest){
    onProgress('先生成 V3 全卷校验表；不缓存整馆明文、不触网上传');
    const entries=[];
    const m=await MimaTavernBackup.createCloudV3Source({...options,onVolume:async v=>{stopIfNeeded();entries.push({index:v.index,name:v.name,size:v.size,sha256:v.sha256});onProgress('已计算 V3 '+(v.index+1)+' 卷校验值')},onProgress});
    if(m.volumes.length!==entries.length||m.volumes.some((v,i)=>v.index!==entries[i]?.index||v.name!==entries[i]?.name||v.size!==entries[i]?.size||v.sha256!==entries[i]?.sha256))throw Error('V3 生成器卷列表不一致');
    job.manifest=m;job.stage='uploading';await persist();
   }
   const confirmed=job.confirmed||[];
   const rebuilt=await MimaTavernBackup.createCloudV3Source({...options,onVolume:async v=>{
    stopIfNeeded();if(await provider.get(deletingKey(job.snapshotId)))throw Error('云端快照正在删除，禁止继续写入');verifyPlan(job,v);
    const i=v.index,old=confirmed[i];
    if(old){if(old.index!==i||old.sha256!==v.sha256||old.size!==v.size)throw Error('已上传卷与原 V3 指纹不一致');
     const remote=await provider.get(volumeKey(job.snapshotId,i));
     if(!remote||remote.size!==old.cipherSize||await C.hashBlob(remote)!==old.cipherSha)throw Error('此前已确认的云端第 '+(i+1)+' 卷损坏或缺失，拒绝拼卷');
     onProgress('已复核远端旧卷 '+(i+1)+' / '+job.manifest.volumes.length);return;
    }
    if(i!==confirmed.length)throw Error('云端卷收据不连续，禁止跳过未验证卷');
    onProgress('加密第 '+(i+1)+' / '+job.manifest.volumes.length+' 卷');
    const encrypted=await C.encrypt({vault,master,snapshotId:job.snapshotId,kind:'volume',index:i,blob:v.blob});
    onProgress('上传并读回校验第 '+(i+1)+' 卷');
    await putChecked(provider,volumeKey(job.snapshotId,i),encrypted.cipher,encrypted.sha256,onProgress);
    confirmed.push({index:i,sha256:v.sha256,size:v.size,cipherSha:encrypted.sha256,cipherSize:encrypted.size});
    job.confirmed=confirmed;await persist();onProgress('云端第 '+(i+1)+' 卷已经读回验证');
   },onProgress});
   if(rebuilt.sha256!==job.manifest.sha256||confirmed.length!==job.manifest.volumes.length)throw Error('全卷状态与初始快照不同，禁止发布完整标志');
   stopIfNeeded();if(await provider.get(deletingKey(job.snapshotId)))throw Error('云端快照正在删除，拒绝发布');job.stage='manifest';await persist();
   const m=await C.encrypt({vault,master,snapshotId:job.snapshotId,kind:'manifest',blob:new Blob([JSON.stringify(job.manifest)],{type:'application/json'})});
   await putChecked(provider,manifestKey(job.snapshotId),m.cipher,m.sha256,onProgress);
   stopIfNeeded();if(await provider.get(deletingKey(job.snapshotId)))throw Error('云端快照正在删除，拒绝发布');job.stage='publishing';await persist();
   const complete={format:'MIMA_CLOUD_COMPLETE',version:1,vaultId:vault.vaultId,snapshotId:job.snapshotId,archiveId:job.archiveId,createdAt:job.createdAt,manifestSha:job.manifest.sha256,manifestCipherSha:m.sha256,manifestCipherSize:m.size,volumes:confirmed,credentialsIncluded:job.includeApiKey};
   const c=await C.encrypt({vault,master,snapshotId:job.snapshotId,kind:'complete',blob:new Blob([JSON.stringify(complete)],{type:'application/json'})});
   await putChecked(provider,completeKey(job.snapshotId),c.cipher,c.sha256,onProgress);
   stopIfNeeded();job.stage='complete';job.completedAt=new Date().toISOString();await persist();
   onProgress('完整快照已发布、读回验证；共 '+confirmed.length+' 卷');return complete;
  });
 })}
 function verifyComplete(obj,vault,id){
  if(obj?.format!=='MIMA_CLOUD_COMPLETE'||obj.version!==1||obj.vaultId!==vault.vaultId||obj.snapshotId!==id||!uuid(id)||obj.archiveId!=='mima_'+id||!Number.isFinite(Date.parse(obj.createdAt))||!/^[a-f0-9]{64}$/.test(obj.manifestSha)||!/^[a-f0-9]{64}$/.test(obj.manifestCipherSha)||!Number.isSafeInteger(obj.manifestCipherSize)||!Array.isArray(obj.volumes)||obj.volumes.length<1||obj.volumes.length>1000)throw Error('云端完成标志不完整或无效');
  for(let i=0;i<obj.volumes.length;i++){const v=obj.volumes[i];if(v.index!==i||!Number.isSafeInteger(v.size)||v.size<1||!Number.isSafeInteger(v.cipherSize)||v.cipherSize<1||!/^([a-f0-9]{64})$/.test(v.sha256)||!/^([a-f0-9]{64})$/.test(v.cipherSha))throw Error('云端完成标志包含非法卷')}return obj;
 }
 async function readComplete(provider,vault,master,id){
  if(!uuid(id))throw Error('云端快照 ID 无效');const blob=await provider.get(completeKey(id));if(!blob)throw Error('远端缺少快照完成标志');
  const content=await C.decrypt({vault,master,snapshotId:id,kind:'complete',cipher:blob});return verifyComplete(await readJSON(content,'云端完成标志'),vault,id);
 }
 function groupedObjects(keys){const map=new Map();for(const key of keys){const m=key.match(/^mimatavern-cloud\/v1\/snapshots\/([a-f0-9]{32})\/([^/]+)$/);if(!m)continue;
   if(!map.has(m[1]))map.set(m[1],new Set());map.get(m[1]).add(m[2]);}return map}
 async function list({config,token,password,onProgress=()=>{}}){return guarded(async()=>{
  const provider=safe(config,token);await provider.check();const vault=await getVault(provider,false),master=await C.unlock(vault,password);
  const keys=await provider.listAll(ROOT+PREFIX),groups=groupedObjects(keys),snapshots=[],issues=[],pending=[],invalid=[];
  if(groups.size>250)throw Error('云端快照目录超过 250 个，请优先清理未完成对象再继续');
  for(const [id,names] of groups){
   if(names.has('deleting.mimaenc')){
    try{await readDeleting(provider,vault,master,id);pending.push({snapshotId:id,state:'deleting',objects:names.size})}
    catch(e){issues.push(id+': 删除标记无法认证：'+e.message)}continue;
   }
   if(!names.has('complete.mimaenc')){pending.push({snapshotId:id,state:'unfinished',objects:names.size});continue}
   try{snapshots.push(await readComplete(provider,vault,master,id))}catch(e){issues.push(id+': '+e.message);invalid.push({snapshotId:id,state:'invalid',objects:names.size,reason:e.message})}
  }
  snapshots.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  onProgress('已发布 '+snapshots.length+' 份；可管理未完成／删除中 '+pending.length+' 份'+(issues.length?'；异常 '+issues.length+' 份':''));
  return {snapshots,issues,pending,invalid};
 })}
 async function readDeleting(provider,vault,master,id){const blob=await provider.get(deletingKey(id));if(!blob)return null;
  const plain=await C.decrypt({vault,master,snapshotId:id,kind:'deleting',cipher:blob}),data=await readJSON(plain,'云端删除收据');
  if(data?.format!=='MIMA_CLOUD_DELETING'||data.version!==1||data.snapshotId!==id||data.vaultId!==vault.vaultId)throw Error('云端删除收据身份不匹配');return data;
 }
 async function prepareRestore({config,token,password,id,onProgress=()=>{}}){return guarded(async()=>{
  const provider=safe(config,token);await provider.check();const vault=await getVault(provider,false),master=await C.unlock(vault,password);
  const done=await readComplete(provider,vault,master,id);
  const encryptedManifest=await provider.get(manifestKey(id));if(!encryptedManifest||encryptedManifest.size!==done.manifestCipherSize||await C.hashBlob(encryptedManifest)!==done.manifestCipherSha)throw Error('云端最终清单丢失或校验不一致');
  const plain=await C.decrypt({vault,master,snapshotId:id,kind:'manifest',cipher:encryptedManifest}),manifest=await readJSON(plain,'V3 原始清单');
  if(manifest.sha256!==done.manifestSha||manifest.archiveId!==done.archiveId||manifest.volumes.length!==done.volumes.length||manifest.credentialsIncluded!==done.credentialsIncluded)throw Error('云端已发布清单与 V3 原始清单不一致');
  const receipt=await MimaTavernBackup.prepareCloudV3({manifest,onProgress,readVolume:async info=>{
   stopIfNeeded();const data=done.volumes[info.index];if(!data||data.index!==info.index||data.sha256!==info.sha256||data.size!==info.size)throw Error('云端卷索引与 V3 清单不一致');
   onProgress('正在下载并验证 '+(info.index+1)+' / '+done.volumes.length+' 卷');
   const cipher=await provider.get(volumeKey(id,info.index));if(!cipher||cipher.size!==data.cipherSize||await C.hashBlob(cipher)!==data.cipherSha)throw Error('云端第 '+(info.index+1)+' 卷缺失或密文校验错误');
   return C.decrypt({vault,master,snapshotId:id,kind:'volume',index:info.index,cipher});
  }});
  return {receipt,complete:done};
 })}
 async function restore(id){return guarded(()=>MimaTavernBackup.resumeV3(id))}
 // Delete authority is a fixed, remotely atomically-created object, shared by
 // every device. It is deliberately NOT an expiring lease: timeouts cannot give
 // a second browser ownership while the first might still be deleting.
 function validateLock(value,vault){
  if(value?.format!=='MIMA_CLOUD_DELETE_OWNER'||value.version!==1||value.vaultId!==vault.vaultId||!uuid(value.ownerId)||!uuid(value.snapshotId)||!Number.isFinite(Date.parse(value.createdAt)))throw Error('云端删除独占记录损坏，已停止所有删除；请先人工核对');
  return value;
 }
 async function inspectLock(provider,vault){const data=await provider.get(deleteOwnerKey);return data?validateLock(await readJSON(data,'云端删除独占记录'),vault):null}
 async function acquireDeleteLock(provider,vault,id){
  if(typeof provider.createExclusive!=='function'||typeof provider.releaseExclusive!=='function')throw Error('该云端网关未提供可靠的跨设备原子删除锁释放；云端删除暂不可用，上传和恢复不受影响');
  if(await inspectLock(provider,vault))throw Error('云仓库已有删除事务独占权。请检查其它设备的删除任务；如上次异常退出，请在云端卡片手动解除锁');
  const owner={format:'MIMA_CLOUD_DELETE_OWNER',version:1,vaultId:vault.vaultId,ownerId:hex(),snapshotId:id,createdAt:new Date().toISOString()};
  try{await provider.createExclusive(deleteOwnerKey,new Blob([JSON.stringify(owner)],{type:'application/json'}))}
  catch(error){const current=await inspectLock(provider,vault).catch(()=>null);if(current)throw Error('另一台设备正在操作云端删除（独占事务 '+current.ownerId.slice(0,8)+'），本次没有删除任何对象');throw error}
  const confirmed=await inspectLock(provider,vault);
  if(confirmed?.ownerId!==owner.ownerId||confirmed.snapshotId!==id)throw Error('删除独占权未成功读回校验，已停止删除；如有遗留锁请人工处理');
  return owner;
 }
 async function requireLock(provider,vault,owner){const actual=await inspectLock(provider,vault);if(actual?.ownerId!==owner.ownerId||actual.snapshotId!==owner.snapshotId)throw Error('删除独占身份已变化，立即停止远端删除');}
 async function releaseLock(provider,vault,owner){
  await requireLock(provider,vault,owner);
  await provider.releaseExclusive(deleteOwnerKey,{ownerId:owner.ownerId});
  if(await provider.get(deleteOwnerKey))throw Error('删除事务已停止，远端存在新锁或原锁未释放，请在云端卡片核对');
 }
 async function deleteLockStatus({config,token,password}){return guarded(async()=>{
  const p=safe(config,token);await p.check();const v=await getVault(p,false);await C.unlock(v,password);return inspectLock(p,v);
 })}
 async function clearAbandonedDeleteLock({config,token,password,ownerId}){return guarded(async()=>{
  const p=safe(config,token);await p.check();const v=await getVault(p,false);await C.unlock(v,password);
  const lock=await inspectLock(p,v);if(!lock)throw Error('仓库目前没有遗留删除锁');
  if(lock.ownerId!==ownerId)throw Error('锁的事务身份已变化，请重新检查，禁止解除');
  // Explicit manual recovery only. No expiry, automatic takeover or background unlock.
  if(typeof p.releaseExclusive!=='function')throw Error('此网关无法保证原子解除独占锁，必须由服务端安全协调器处理');
  await p.releaseExclusive(deleteOwnerKey,{ownerId:lock.ownerId});
  if(await p.get(deleteOwnerKey))throw Error('远端已出现另一把锁或原锁仍存在；请刷新核对，禁止继续删除');
  return lock;
 })}
 async function verifyAlternative(provider,vault,master,id,onProgress){
  const done=await readComplete(provider,vault,master,id);
  const manifestCipher=await provider.get(manifestKey(id));
  if(!manifestCipher||manifestCipher.size!==done.manifestCipherSize||await C.hashBlob(manifestCipher)!==done.manifestCipherSha)throw Error('V3 清单密文丢失或哈希不符');
  const plain=await C.decrypt({vault,master,snapshotId:id,kind:'manifest',cipher:manifestCipher});
  const manifest=await readJSON(plain,'V3 清单');
  if(manifest.format!=='MIMA_WHOLE_TAVERN_VOLUMES'||manifest.version!==MimaBackupVolumes.VERSION||manifest.archiveId!==done.archiveId||manifest.credentialsIncluded!==done.credentialsIncluded||
   manifest.volumeSizeLimit!==MimaBackupVolumes.CAP||manifest.blockSize!==256*1024||!Number.isSafeInteger(manifest.frameCount)||manifest.frameCount<9||
   JSON.stringify(manifest.sections)!==JSON.stringify(MimaBackupVolumes.SECTIONS)||!Array.isArray(manifest.volumes)||manifest.volumes.length!==done.volumes.length||manifest.sha256!==done.manifestSha)throw Error('V3 清单协议与完成标志不一致');
  const withoutHash={...manifest};delete withoutHash.sha256;
  if(await MimaBackupVolumes.sha(JSON.stringify(withoutHash))!==manifest.sha256)throw Error('V3 原始清单 SHA 校验失败');
  for(let i=0;i<manifest.volumes.length;i++){
   const item=manifest.volumes[i],expected=done.volumes[i];
   if(item.index!==i||!Number.isSafeInteger(item.size)||item.size<16||item.size>MimaBackupVolumes.CAP||!/^([a-f0-9]{64})$/.test(item.sha256)||
    typeof item.name!=='string'||!item.name.endsWith('.mimavol')||expected.index!==i||expected.size!==item.size||expected.sha256!==item.sha256)throw Error('V3 第 '+(i+1)+' 卷清单不一致');
   stopIfNeeded();const cipher=await provider.get(volumeKey(id,i));
   if(!cipher||cipher.size!==expected.cipherSize||await C.hashBlob(cipher)!==expected.cipherSha)throw Error('第 '+(i+1)+' 卷密文缺失或传输校验失败');
   const decrypted=await C.decrypt({vault,master,snapshotId:id,kind:'volume',index:i,cipher});
   if(decrypted.size!==item.size||await C.hashBlob(decrypted)!==item.sha256)throw Error('第 '+(i+1)+' 卷 V3 明文哈希不一致');
   // Check V3 framing magic; the signed manifest and authenticated per-volume
   // SHA provide byte-for-byte identity without retaining an entire archive.
   if(await decrypted.slice(0,7).text()!=='MIMAV3\n')throw Error('第 '+(i+1)+' 卷 V3 文件头无效');
   onProgress('已验证保留快照 '+id.slice(0,8)+' 的 '+(i+1)+' / '+manifest.volumes.length+' 卷');
  }
  return done;
 }
 async function removeSnapshot({config,token,password,id,allowInvalid=false,confirmDelete,onProgress=()=>{}}){return guarded(async()=>{
  if(!uuid(id))throw Error('云端快照身份无效');
  const provider=safe(config,token);await provider.check();const vault=await getVault(provider,false),master=await C.unlock(vault,password);
  // Hold remote authority across ALL reads, protection checks, writes and deletes.
  const lock=await acquireDeleteLock(provider,vault,id);let primaryError=null,result;
  try{
   let keys=await provider.listAll(ROOT+PREFIX),groups=groupedObjects(keys),names=groups.get(id);
   if(!names?.size){const jobs=await unfinishedJobs(config);if(jobs.some(j=>j.snapshotId===id)){await forgetJob(config,id);result=true}
    else throw Error('远端已找不到该快照对象；请刷新列表');}
   else{
    let tombstone=await readDeleting(provider,vault,master,id),kind=names.has('complete.mimaenc')?'complete':'unfinished',healthy=0;
    if(!tombstone){
     if(names.has('complete.mimaenc')){
      // Separate network failure from cryptographic corruption. A connection
      // error must never authorize the more permissive invalid-object path.
      const completeBytes=await provider.get(completeKey(id));
      if(!completeBytes)throw Error('目标完成标志在远端已不存在，请刷新列表');
      try{
       const authenticated=await C.decrypt({vault,master,snapshotId:id,kind:'complete',cipher:completeBytes});
       verifyComplete(await readJSON(authenticated,'云端完成标志'),vault,id);
      }catch(error){
       if(!allowInvalid)throw Error('目标快照完成标志异常；请从异常对象管理入口单独确认清理。详情：'+error.message);
       kind='invalid';
      }
      if(kind==='complete'&&allowInvalid)throw Error('目标完成标志已重新验证为正常，不能沿用异常清理授权；请刷新列表');
      if(kind==='complete'){
       // A filename or valid complete marker alone is not proof another
       // recoverable archive exists. Read back and authenticate every volume.
       for(const [other,otherNames] of groups){if(other===id||!otherNames.has('complete.mimaenc')||otherNames.has('deleting.mimaenc'))continue;
        try{await verifyAlternative(provider,vault,master,other,onProgress);healthy++;break}
        catch(e){onProgress('其它快照 '+other.slice(0,8)+' 不可作为删除保险：'+e.message)}
       }
       onProgress('其它经完整密文和 V3 分卷核验的可恢复备份：'+healthy+' 份');
       if(!healthy)throw Error('拒绝删除：这是仓库中目前唯一已证实可恢复的完整备份；损坏或缺卷的标志不能算作备用');
      }
     }else if(allowInvalid)throw Error('目标没有异常完成标志，请刷新云端列表后按正常未完成残卷处理');
     stopIfNeeded();await requireLock(provider,vault,lock);
     if(typeof confirmDelete==='function'&&!(await confirmDelete({snapshotId:id,kind,verifiedAlternatives:healthy})))throw Error('用户取消删除，仓库内容未修改');
     const body={format:'MIMA_CLOUD_DELETING',version:1,vaultId:vault.vaultId,snapshotId:id};
     const encrypted=await C.encrypt({vault,master,snapshotId:id,kind:'deleting',blob:new Blob([JSON.stringify(body)])});
     stopIfNeeded();await requireLock(provider,vault,lock);
     await putChecked(provider,deletingKey(id),encrypted.cipher,encrypted.sha256,onProgress);
     tombstone=await readDeleting(provider,vault,master,id);
     if(!tombstone)throw Error('删除收据没有成功发布，尚未开始清理');
    }else if(typeof confirmDelete==='function'&&!(await confirmDelete({snapshotId:id,kind:'deleting',verifiedAlternatives:null})))throw Error('用户取消继续清理，残卷未更改');
    const deletable=name=>name==='complete.mimaenc'||name==='manifest.mimaenc'||/^\d{4}\.mimaenc$/.test(name);
    const entries=[...names].filter(deletable).sort((a,b)=>a==='complete.mimaenc'?-1:b==='complete.mimaenc'?1:0);
    for(let i=0;i<entries.length;i++){
     stopIfNeeded();await requireLock(provider,vault,lock);
     const key=ROOT+PREFIX+id+'/'+entries[i];await provider.delete(key);
     onProgress('删除中 '+(i+1)+' / '+entries.length+'，可中断后继续');
    }
    await requireLock(provider,vault,lock);
    keys=await provider.listAll(ROOT+PREFIX);names=groupedObjects(keys).get(id)||new Set();
    if([...names].some(deletable)||[...names].some(n=>n!=='deleting.mimaenc'))throw Error('快照目录还有尚未清理的对象，删除标记保留，可稍后继续');
    await provider.delete(deletingKey(id));
    const verify=await provider.listAll(ROOT+PREFIX);
    if(groupedObjects(verify).has(id))throw Error('远端仍有快照文件，删除未完成，请刷新后继续清理');
    await forgetJob(config,id);result=true;
   }
  }catch(error){primaryError=error}
  try{await releaseLock(provider,vault,lock)}catch(error){if(primaryError)throw Error(primaryError.message+'；此外独占锁释放失败：'+error.message);throw error}
  if(primaryError)throw primaryError;return result;
 })}
 return Object.freeze({configure,savedConfig,unfinished,unfinishedJobs,needsPasswordConfirmation,testConnection,backup,list,prepareRestore,restore,removeSnapshot,deleteLockStatus,clearAbandonedDeleteLock,cancel});
})();
