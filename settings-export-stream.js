/* Legacy-compatible settings JSON writer. Stream one immutable font source at a
 * time; never make a second all-fonts/Base64 object. Desktop File System Access
 * and OPFS are capability-checked and do not silently fall back to RAM. */
window.MimaSettingsJsonStream = (() => {
 'use strict';
 const DIRECTORY='mima-settings-json-export-v1';
 const BLOCK=192*1024; // divisible by three, so each Base64 fragment has no padding
 let active=false,ready=null;
 const textBytes=(x)=>new TextEncoder().encode(x);
 function b64(bytes){
  if(typeof bytes.toBase64==='function')return bytes.toBase64();
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
 }
 function safeName(n){return String(n).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,140)||'mima-settings.json';}
 async function directory(){const storage=navigator.storage;if(typeof storage?.getDirectory!=='function'){const e=Error('此浏览器没有低内存文件写出接口');e.code='E_NO_JSON_STREAM_SINK';throw e;}return (await storage.getDirectory()).getDirectoryHandle(DIRECTORY,{create:true});}
 function checkInventory(inventory){
  const d=inventory.defects||{};const bad=Object.entries(d).filter(([,list])=>Array.isArray(list)&&list.length);
  if(bad.length)throw Error('字体库存有未索引、缺失或冲突的原件（'+bad.map(([k,v])=>k+':'+v.length).join('，')+'）。为避免生成不完整 JSON，请先在字体管理查看只读检查结果');
 }
 async function openSink(name){
  if(typeof window.showSaveFilePicker==='function'){
   let handle;
   try{handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'JSON',accept:{'application/json':['.json']}}]});}
   catch(e){if(e?.name==='AbortError')throw Error('已取消选择保存位置，未写入文件');throw e;}
   const writable=await handle.createWritable();return {writable,kind:'external',async finish(){await writable.close();return {mode:'external',name};},async abort(){try{await writable.abort()}catch(_){}}};
  }
  const dir=await directory(),tmp='settings-'+Date.now()+'-'+crypto.randomUUID()+'--'+name;
  const file=await dir.getFileHandle(tmp,{create:true});const writable=await file.createWritable();
  return {writable,kind:'opfs',async finish(){await writable.close();return {mode:'opfs',name,dir,file,tmp};},async abort(){try{await writable.abort()}catch(_){}try{await dir.removeEntry(tmp)}catch(_){}}};
 }
 function showReady(job){
  ready=job;
  let root=document.getElementById('mima-settings-json-ready');
  if(!root){root=document.createElement('div');root.id='mima-settings-json-ready';root.setAttribute('role','status');root.style.cssText='position:fixed;bottom:calc(18px + env(safe-area-inset-bottom, 0px));left:12px;right:12px;max-width:460px;margin:auto;z-index:2147483600;padding:14px;border-radius:14px;color:white;background:#242730;box-shadow:0 8px 32px #0007;font:14px/1.5 system-ui';document.body.appendChild(root);}
  root.replaceChildren();
  const desc=document.createElement('div');desc.textContent='JSON 已写入本站临时文件。现在请点「保存到文件」导出到设备；清除网站数据会丢失临时文件。';root.appendChild(desc);
  const save=document.createElement('button');save.textContent='保存到文件 / 浏览器下载';save.style.cssText='margin:9px 8px 3px 0;padding:9px;border-radius:8px;';
  save.onclick=()=>{if(!ready)return;void Promise.resolve(MimaFileExport.save(ready.name,ready.file,'application/json;charset=utf-8')).catch(error=>{desc.textContent='文件保存未完成：'+error.message+'。临时文件还在，可重试。';});};root.appendChild(save);
  const close=document.createElement('button');close.textContent='关闭（保留临时文件）';close.style.cssText='padding:9px;border-radius:8px';close.onclick=()=>root.remove();root.appendChild(close);
 }
 // Native JSON schema, emitted without a global JSON.stringify on multi-MB
 // libraries, CSS, wallpaper records or generated prose.
 async function valueJSON(value,emit,seen=new Set()){
  if(value && typeof value.toJSON==='function')value=value.toJSON();
  if(value===null||typeof value!=='object'){
   if(typeof value==='string'){
    await emit('"');
    for(let i=0;i<value.length;i+=32768)await emit(JSON.stringify(value.slice(i,i+32768)).slice(1,-1));
    await emit('"');return;
   }
   const scalar=JSON.stringify(value);
   if(scalar===undefined)throw Error('不支持写入非 JSON 值');
   await emit(scalar);return;
  }
  if(seen.has(value))throw Error('备份资料存在循环引用，无法生成有效 JSON');
  seen.add(value);
  try{
   const array=Array.isArray(value);
   await emit(array?'[':'{');
   let first=true;
   if(array){
    for(let i=0;i<value.length;i++){
     let item=value[i];if(item===undefined||typeof item==='function'||typeof item==='symbol')item=null;
     await emit(i?',':'');await valueJSON(item,emit,seen);
    }
   }else{
    for(const key of Object.keys(value)){
     const item=value[key];if(item===undefined||typeof item==='function'||typeof item==='symbol')continue;
     await emit(first?'':',');first=false;
     await valueJSON(key,emit);await emit(':');await valueJSON(item,emit,seen);
    }
   }
   await emit(array?']':'}');
  }finally{seen.delete(value);}
 }
 async function writeCompat({name,loadData,includeFonts,onProgress}){
  // This is explicitly opt-in: the original single-Blob download is retained
  // where neither native disk streaming nor OPFS is supported. Never drop the
  // user's fonts or silently create a huge in-memory backup.
  const inventory=includeFonts?await MimaFontManager.listBackupInventory():null;
  if(inventory)checkInventory(inventory);
  const bytes=(inventory?.records||[]).reduce((n,r)=>n+Number(r.size||0),0);
  const warning='当前浏览器缺少低内存文件写入接口。\n\n兼容旧 JSON 下载会在内存中生成整个文件'+
   (includeFonts?'（包含全部 '+inventory.records.length+' 份字体，约 '+(bytes/1048576).toFixed(1)+' MiB 原件）':'')+
   '，大型备份可能导致页面退出。建议优先使用 V3 分卷备份。\n\n仍要使用原来的完整 JSON 下载吗？';
  if(!confirm(warning))throw Error('已取消兼容 JSON 导出，原资料未修改');
  onProgress('正在生成用户确认的兼容 JSON；请勿关闭此页面…');
  const {data,warning:privacy}=await loadData();
  const fonts=inventory?await MimaFontManager.exportPortable():[];
  if(inventory)await MimaFontManager.assertBackupInventory(inventory);
  const payload=JSON.stringify({format:'mimamao-tavern-full-settings',version:4,exportedAt:new Date().toISOString(),warning:privacy||'',data:{...data,fonts}});
  const result=await window.MimaFileExport.save(name,new Blob([payload],{type:'application/json;charset=utf-8'}),'application/json;charset=utf-8');
  if(['not_saved','blocked','unsupported'].includes(result)){onProgress('系统保存未完成，请使用文件保存面板重新操作');return 'compat_pending';}
  onProgress('兼容 JSON 已提交下载或分享；请确认文件实际存在');
  return 'compat';
 }
 async function write({name,loadData,includeFonts,onProgress=()=>{}}){
  if(active)throw Error('已经有设置 JSON 正在写入，请勿重复启动');active=true;
  let sink=null,finished=false;
  try{
   // Must request external save handle before any async collection, while the
   // click gesture is live; on mobile use independent OPFS staging instead.
   try{sink=await openSink(safeName(name));}
   catch(e){if(e?.code==='E_NO_JSON_STREAM_SINK')return await writeCompat({name:safeName(name),loadData,includeFonts,onProgress});throw e;}
   let queued='',queuedBytes=0;
   const flush=async()=>{if(queued){await sink.writable.write(textBytes(queued));queued='';queuedBytes=0;}};
   const emit=async str=>{
    // Bound the encoded staging buffer as well as the native write size.
    if(str.length>131072){await flush();await sink.writable.write(textBytes(str));return;}
    if(queuedBytes+str.length>131072)await flush();
    queued+=str;queuedBytes+=str.length;
   };
   onProgress('正在读取剧情、设置和资源…');
   const {data,warning}=await loadData();
   const fields={...data};delete fields.fonts;
   const inventory=includeFonts?await MimaFontManager.listBackupInventory():null;
   if(inventory)checkInventory(inventory);
   await emit('{"format":"mimamao-tavern-full-settings","version":4,"exportedAt":'+JSON.stringify(new Date().toISOString())+',"warning":'+JSON.stringify(warning||'')+',"data":{');
   let first=true;
   for(const [key,value] of Object.entries(fields)){
    if(key==='warning')continue;
    await emit((first?'':',')+JSON.stringify(key)+':');await valueJSON(value,emit);first=false;
   }
   await emit((first?'':',')+'"fonts":[');
   for(let i=0;i<(inventory?.records.length||0);i++){
    onProgress('正在写入字体 '+(i+1)+' / '+inventory.records.length+'（原字节逐块输出）');
    const meta=inventory.records[i],source=await MimaFontManager.openBackupSource(meta.id);
    try{
     if(meta.size!==source.size)throw Error('字体长度在导出期间变化：'+meta.id);
     const row={id:meta.id,name:meta.name,family:meta.family,format:meta.format,size:source.size,createdAt:meta.createdAt,
      sourceUrlFontId:meta.sourceUrlFontId,sourceUrl:meta.sourceUrl,health:meta.health,diagnostic:meta.diagnostic};
     await emit((i?',':'')+JSON.stringify({...row,bufferBase64:''}).replace(/"bufferBase64":""}$/, '"bufferBase64":"'));
     for(let start=0;start<source.size;start+=BLOCK){const bytes=await source.readRange(start,Math.min(BLOCK,source.size-start));await emit(b64(bytes));}
     await emit('"}');await source.confirm();
    }finally{source.close();}
   }
   if(inventory)await MimaFontManager.assertBackupInventory(inventory);
   onProgress('字体库存复核完成，正在写入文件结尾…');
   await emit(']}}');await flush();
   const completed=await sink.finish();finished=true;
   if(completed.mode==='opfs'){
    const file=await completed.file.getFile();showReady({...completed,file});
   }
   return completed.mode;
  }finally{if(!finished&&sink)await sink.abort();active=false;}
 }
 async function cleanup(){
  if(active)throw Error('正在写入 JSON，不能清理临时文件');
  const dir=await directory(),names=[];
  for await(const [name,handle] of dir.entries())if(handle.kind==='file'&&/^settings-[\w.-]+\.json$/.test(name))names.push(name);
  if(!names.length)return '没有需要清理的设置 JSON 临时文件';
  if(!confirm('确定删除本站 '+names.length+' 份设置 JSON 临时文件？请先确认已经保存到设备“文件”App。不会删除剧情、字体原件或本机快照。'))return '已取消清理';
  for(const name of names)await dir.removeEntry(name);
  ready=null;document.getElementById('mima-settings-json-ready')?.remove();
  return '已清理 '+names.length+' 份临时 JSON；原始数据未修改';
 }
 async function resume(){
  if(active)throw Error('正在导出设置 JSON，不能重新打开临时文件');
  const dir=await directory(),names=[];
  for await(const [name,handle] of dir.entries())if(handle.kind==='file'&&/^settings-[\w.-]+\.json$/.test(name))names.push(name);
  if(!names.length)return '没有待保存的临时设置 JSON 文件';
  names.sort().reverse();const tmp=names[0],file=await (await dir.getFileHandle(tmp)).getFile();
  if(!file.size)throw Error('临时 JSON 文件为空，请清理后重做');
  const name=tmp.includes('--')?tmp.split('--').slice(1).join('--'):'mimamao-tavern-settings-recovered.json';
  showReady({name,file,tmp,dir});
  return '已打开最近的临时 JSON，请点击保存到设备';
 }
 return Object.freeze({write,cleanup,resume,encodeBase64Block:b64});
})();
