/* MimaTAVERN R19 — V3 bounded whole-tavern volumes.
 * No source database writes. Browser file shares require explicit human confirmation.
 * This format is distinct from legacy .mimatavern and 16 MiB font-only volumes.
 */
window.MimaBackupVolumes=(()=>{'use strict';
 const MAGIC='MIMAV3\n',VERSION=3,FORMAT='MIMA_WHOLE_TAVERN_VOLUMES',CAP=16*1024*1024,BLOCK=256*1024;
 const SECTIONS=['native','compat','phone','atelier','wallpapers','fonts','sounds','prefs','playtools'];
 const encoder=new TextEncoder(),decoder=new TextDecoder();
 const bytes=s=>encoder.encode(s);
 const hex=a=>[...new Uint8Array(a)].map(b=>b.toString(16).padStart(2,'0')).join('');
 async function sha(value){return hex(await crypto.subtle.digest('SHA-256',value instanceof Blob?await value.arrayBuffer():typeof value==='string'?bytes(value):value));}
 function assertName(name){if(!/^[a-z0-9_-]{2,128}$/i.test(name))throw Error('备份成员标识不合法');return name;}
 function checkSafe(value){if(!Number.isSafeInteger(value)||value<0)throw Error('备份长度或序号不合法');return value;}
 async function create({archiveId,createdAt,includeApiKey,getSection,getFonts,onVolume,onProgress=()=>{}}){
  assertName(archiveId);if(typeof onVolume!=='function')throw Error('缺少逐卷外部保存确认');
  let seq=0,volumeIndex=0,partBytes=MAGIC.length,parts=[bytes(MAGIC)],binaryCount=0,metadataCount=0;
  const volumes=[];const encodedStats={sections:{},binaryCount:0,volumeCount:0};
  async function flush(){
   if(partBytes===MAGIC.length)return;
   const blob=new Blob(parts,{type:'application/octet-stream'}),entry={index:volumeIndex,size:blob.size,sha256:await sha(blob),name:`咪嘛馆_${archiveId}_${String(volumeIndex+1).padStart(3,'0')}.mimavol`};
   // Only one volume is held while awaiting a save confirmation; after return
   // its Blob becomes unreachable from this writer. No huge growing parts[].
   await onVolume({...entry,blob});volumes.push(entry);volumeIndex++;
   parts=[bytes(MAGIC)];partBytes=MAGIC.length;
  }
  async function frame(info,payload){
   if(!(payload instanceof Uint8Array)||payload.length>BLOCK)throw Error('备份内部帧长度超过 256KiB');
   const meta={...info,archiveId,seq:seq++,sha256:await sha(payload)};
   const head=bytes(JSON.stringify(meta));if(head.byteLength>4096)throw Error('备份内部帧头过大');
   const prefix=new Uint8Array(12),view=new DataView(prefix.buffer);
   prefix.set(bytes('MV3F'),0);view.setUint32(4,head.length);view.setUint32(8,payload.length);
   const size=prefix.length+head.length+payload.length;
   if(partBytes+size>CAP)await flush();
   if(partBytes+size>CAP)throw Error('备份单帧超出分卷上限');
   parts.push(prefix,head,payload);partBytes+=size;
  }
  async function framedJSON(name,value){
   const json=bytes(JSON.stringify(value));const total=Math.max(1,Math.ceil(json.length/BLOCK));
   for(let index=0;index<total;index++)await frame({kind:'section',name,index,total},json.subarray(index*BLOCK,(index+1)*BLOCK));
   encodedStats.sections[name]={bytes:json.length,parts:total};
  }
  async function emitBinary(ref,source){
   if(checkSafe(source.size)!==ref.size)throw Error('备份原件尺寸变化：'+ref.id);
   const total=Math.max(1,Math.ceil(ref.size/BLOCK));
   for(let index=0;index<total;index++){
    const start=index*BLOCK,length=Math.min(BLOCK,ref.size-start);
    const data=length?await source.readRange(start,length):new Uint8Array();
    if(data.length!==length)throw Error('备份源短读：'+ref.id);
    await frame({kind:'binary',id:ref.id,index,total,size:ref.size,binaryKind:ref.kind,mime:ref.mime},data);
   }
   binaryCount++;
  }
  function wrap(value,sources){
   if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
    const kind=value instanceof Blob?'blob':value instanceof Uint8Array?'uint8':'buffer';
    const blob=value instanceof Blob?value:new Blob([value]);
    const ref={id:'b'+(++metadataCount),kind,mime:blob.type||'',size:blob.size};
    sources.push({ref,source:{size:blob.size,readRange:async(start,length)=>new Uint8Array(await blob.slice(start,start+length).arrayBuffer()),close(){}}});
    return {__mimaMigrationBinary:ref};
   }
   if(Array.isArray(value))return value.map(v=>wrap(v,sources));
   if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value)){
     if(['__proto__','constructor','prototype','__mimaMigrationBinary'].includes(k))throw Error('备份数据中存在保留字段');
     if(v!==undefined)out[k]=wrap(v,sources);
    }return out;
   }
   return value;
  }
  let fontSnapshot=null;
  for(const name of SECTIONS){
   onProgress('正在生成整馆分卷：'+name);
   if(name==='fonts'){
    const inventory=await getFonts('inventory');fontSnapshot=inventory;
    const records=inventory.records;
    const refs=records.map(meta=>{
     const ref={id:'b'+(++metadataCount),kind:'buffer',mime:'',size:meta.size};
     if(!Number.isSafeInteger(ref.size)||ref.size<=0)throw Error('字体库存中的原件大小无效：'+meta.id);
     return {meta,ref};
    });
    await framedJSON(name,refs.map(({meta,ref})=>({...meta,buffer:{__mimaMigrationBinary:ref}})));
    for(const {meta,ref} of refs){
     const source=await getFonts('source',meta);
     try{await emitBinary(ref,source);await source.confirm();}
     finally{source.close();}
    }
    await getFonts('assert',inventory);
   }else{
    const sources=[];
    // Only one store's export and its binary references are live at a time.
    let data=await getSection(name,includeApiKey);
    const encoded=wrap(data,sources);data=null;
    await framedJSON(name,encoded);
    for(const {ref,source} of sources){try{await emitBinary(ref,source);}finally{source.close();}}
    sources.length=0;
   }
  }
  await flush();
  // Last volume may have sat in a native save sheet for minutes; check again
  // after the user's last acknowledgement, before declaring a final manifest.
  if(fontSnapshot)await getFonts('assert',fontSnapshot);
  const manifest={format:FORMAT,version:VERSION,archiveId,createdAt,credentialsIncluded:includeApiKey,
   sections:SECTIONS.slice(),volumeSizeLimit:CAP,blockSize:BLOCK,frameCount:seq,
   volumes:volumes.map(({name,size,sha256,index})=>({name,size,sha256,index})),
   counters:{binaryCount,sections:encodedStats.sections},consistency:'独立模块快照；备份期间请暂停编辑与生成'};
  manifest.sha256=await sha(JSON.stringify(manifest));
  return manifest;
 }
 // Retain only verified byte ranges. Never retain payload slices for the entire
 // archive or eagerly rebuild all nine stores in memory.
 async function readManifest(files){
  const list=Array.from(files||[]),mans=list.filter(f=>/\.mimavolumes\.json$/i.test(f.name||''));
  if(mans.length!==1)throw Error('请选择一份最终清单（.mimavolumes.json）以及全部卷');
  const manifest=JSON.parse(await mans[0].text()),givenHash=manifest.sha256;
  delete manifest.sha256;
  if(manifest.format!==FORMAT||manifest.version!==VERSION||!assertName(manifest.archiveId)||
     JSON.stringify(manifest.sections)!==JSON.stringify(SECTIONS)||
     !Array.isArray(manifest.volumes)||manifest.volumes.length<1||manifest.volumes.length>1000||
     manifest.volumeSizeLimit!==CAP||manifest.blockSize!==BLOCK||
     !Number.isSafeInteger(manifest.frameCount)||manifest.frameCount<SECTIONS.length||
     givenHash!==await sha(JSON.stringify(manifest)))throw Error('整馆分卷最终清单损坏或版本不支持');
  manifest.sha256=givenHash;
  const byName=new Map();for(const file of list){if(file===mans[0])continue;
   if(!/\.mimavol$/i.test(file.name||'')||byName.has(file.name))throw Error('分卷包含重复或未知文件');byName.set(file.name,file);}
  if(byName.size!==manifest.volumes.length)throw Error('整馆分卷数量不齐');
  const volumes=[];
  for(let i=0;i<manifest.volumes.length;i++){
   const info=manifest.volumes[i],file=byName.get(info.name);
   if(!file||info.index!==i||!Number.isSafeInteger(info.size)||info.size>CAP||info.size<MAGIC.length+12||
      !/^[a-f0-9]{64}$/.test(info.sha256)||file.size!==info.size)throw Error('缺失或尺寸异常的整馆分卷 '+(i+1));
   volumes.push(file);
  }
  return {manifest,volumes};
 }
 async function open(files){
  const {manifest,volumes}=await readManifest(files);
  const sections=new Map(),binaries=new Map();let seq=0;
  for(let index=0;index<volumes.length;index++){
   const file=volumes[index],info=manifest.volumes[index];
   // SHA of one bounded (<= 16 MiB) volume, released after this iteration.
   if(await sha(file)!==info.sha256)throw Error('第 '+(index+1)+' 卷 SHA-256 与清单不符');
   if(decoder.decode(await file.slice(0,MAGIC.length).arrayBuffer())!==MAGIC)throw Error('分卷文件头损坏');
   let pos=MAGIC.length;
   while(pos<file.size){
    if(pos+12>file.size)throw Error('分卷帧头截断');
    const head=new DataView(await file.slice(pos,pos+12).arrayBuffer());
    if(head.getUint32(0)!==0x4d563346)throw Error('分卷帧标记损坏');
    const m=head.getUint32(4),n=head.getUint32(8);
    if(m<1||m>4096||n>BLOCK||pos+12+m+n>file.size)throw Error('分卷帧长度异常');
    const meta=JSON.parse(await file.slice(pos+12,pos+12+m).text());
    const offset=pos+12+m,payload=file.slice(offset,offset+n);pos=offset+n;
    if(meta.archiveId!==manifest.archiveId||meta.seq!==seq++||!/^([a-f0-9]{64})$/.test(meta.sha256)||await sha(payload)!==meta.sha256)
     throw Error('归档标识、帧序号或数据哈希不一致');
    if(!Number.isSafeInteger(meta.index)||!Number.isSafeInteger(meta.total)||meta.total<1||meta.index<0||meta.index>=meta.total)
     throw Error('归档数据块序号无效');
    const entry={file,offset,length:n};
    if(meta.kind==='section'){
     if(!SECTIONS.includes(meta.name))throw Error('归档章节未知');
     let r=sections.get(meta.name);if(!r){r={total:meta.total,parts:[],size:0};sections.set(meta.name,r);}
     if(r.total!==meta.total||r.parts.length!==meta.index)throw Error('归档章节分块不连续');
     r.parts.push(entry);r.size+=n;
    }else if(meta.kind==='binary'){
     if(!/^b[1-9]\d*$/.test(meta.id)||!['blob','buffer','uint8'].includes(meta.binaryKind)||
        !Number.isSafeInteger(meta.size)||meta.size<0||typeof meta.mime!=='string'||meta.mime.length>256)throw Error('归档原件标识无效');
     let b=binaries.get(meta.id);if(!b){b={total:meta.total,parts:[],kind:meta.binaryKind,mime:meta.mime,size:meta.size,bytes:0};binaries.set(meta.id,b);}
     if(b.total!==meta.total||b.parts.length!==meta.index||b.size!==meta.size||b.kind!==meta.binaryKind||b.mime!==meta.mime)
      throw Error('归档原件分块不连续');
     b.parts.push(entry);b.bytes+=n;
    }else throw Error('归档包含未知帧类型');
   }
  }
  if(seq!==manifest.frameCount||sections.size!==SECTIONS.length||SECTIONS.some(n=>!sections.has(n)))throw Error('整馆归档缺少章节或帧');
  for(const [name,r]of sections)if(r.parts.length!==r.total)throw Error('归档章节缺少数据：'+name);
  for(const [id,b]of binaries)if(b.parts.length!==b.total||b.bytes!==b.size)throw Error('归档原件数据不完整：'+id);
  function blobFrom(parts,mime=''){return new Blob(parts.map(p=>p.file.slice(p.offset,p.offset+p.length)),{type:mime});}
  const references=new Set();const decoded=new Map();
  async function readSection(name,{metadataOnly=false}={}){
   const r=sections.get(name);if(!r)throw Error('归档章节不存在：'+name);
   let raw;try{raw=JSON.parse(await blobFrom(r.parts).text());}catch(e){throw Error('归档章节 JSON 损坏：'+name);}
   async function decode(value){
    if(value&&typeof value==='object'&&Object.hasOwn(value,'__mimaMigrationBinary')){
     if(Object.keys(value).length!==1)throw Error('归档二进制引用结构损坏');
     const ref=value.__mimaMigrationBinary,b=binaries.get(ref?.id);
     if(!b||ref.kind!==b.kind||ref.size!==b.size||ref.mime!==b.mime)throw Error('归档原件引用无效：'+ref?.id);
     if(metadataOnly){if(references.has(ref.id))throw Error('归档原件引用重复：'+ref.id);references.add(ref.id);return null;}
     const blob=blobFrom(b.parts,b.mime);
     if(name==='fonts'||b.kind==='blob')return blob;
     const array=await blob.arrayBuffer();return b.kind==='uint8'?new Uint8Array(array):array;
    }
    if(Array.isArray(value)){const out=[];for(const v of value)out.push(await decode(v));return out;}
    if(value&&typeof value==='object'){
     const out={};for(const[k,v]of Object.entries(value)){
      if(['__proto__','constructor','prototype','__mimaMigrationBinary'].includes(k))throw Error('归档章节包含不允许的字段');
      out[k]=await decode(v);
     }return out;
    }return value;
   }
   return decode(raw);
  }
  // Validate all reference identities, including unused and duplicate ones,
  // before business preflight, without decoding any binary into memory.
  for(const name of SECTIONS)await readSection(name,{metadataOnly:true});
  if(references.size!==binaries.size)throw Error('整馆归档包含没有引用的原件');
  async function readChecked(name){
   const value=await readSection(name);
   if(name==='fonts'){
    if(!Array.isArray(value))throw Error('整馆字体索引缺失');
    const ids=new Set();for(const row of value){
     if(!row||typeof row.id!=='string'||!row.id||row.id.length>200||ids.has(row.id)||
       !['ttf','otf','woff','woff2'].includes(String(row.format||'').toLowerCase())||
       !(row.buffer instanceof Blob)||!Number.isSafeInteger(row.size)||row.size<=0||row.size!==row.buffer.size)
      throw Error('整馆字体索引重复、原件缺失或格式无效');
     ids.add(row.id);
    }
   }
   return value;
  }
  return {id:manifest.sha256,manifest,readSection:readChecked,sourceStats:{parts:seq,binaryCount:binaries.size,sectionCount:sections.size}};
 }
 async function inspect(files){
  const archive=await open(files),data={};
  for(const name of SECTIONS)data[name]=await archive.readSection(name);
  data.phoneCredentialsOmitted=archive.manifest.credentialsIncluded!==true;
  return {id:archive.id,manifest:archive.manifest,data};
 }
 return Object.freeze({create,inspect,readManifest,open,sha,SECTIONS,VERSION,CAP});
})();
