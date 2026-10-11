/* PNG Character Card decoder. Standalone/browser-local; no network, eval, or Store writes.
 * Supports standard tEXt chara/ccv3 and zTXt/iTXt equivalents; the V3 payload wins.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MimaPngCardImport=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const PNG_SIGNATURE=[137,80,78,71,13,10,26,10];
  const MAX_PNG_BYTES=20*1024*1024;
  const MAX_TEXT_BYTES=4*1024*1024;
  const MAX_CHUNKS=15000;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const outOfSpec=(why)=>new Error('PNG 角色卡解析失败：'+why);
  const strBytes=(s)=>Array.from(s).map(c=>c.charCodeAt(0));
  const read32=(bytes,at)=>(bytes[at]*16777216+bytes[at+1]*65536+bytes[at+2]*256+bytes[at+3])>>>0;
  let crcTable;
  function crc32(bytes,start,end){
    if(!crcTable){crcTable=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c>>>0;}}
    let c=0xffffffff;
    for(let i=start;i<end;i++)c=crcTable[(c^bytes[i])&255]^(c>>>8);
    return(c^0xffffffff)>>>0;
  }
  function ascii(bytes,start,end){let s='';for(let i=start;i<end;i++)s+=String.fromCharCode(bytes[i]);return s;}
  function nul(bytes,start,end){for(let i=start;i<end;i++)if(bytes[i]===0)return i;return -1;}
  async function inflated(bytes){
    if(typeof DecompressionStream!=='function')throw outOfSpec('此浏览器不支持压缩 PNG 文本块，建议将角色卡重新导出为标准 PNG。');
    let reader;
    try{
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      reader=stream.getReader();const parts=[];let length=0;
      for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_TEXT_BYTES)throw outOfSpec('解压后的角色卡数据过大。');parts.push(part.value);}
      const output=new Uint8Array(length);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;
    }catch(e){if(e.message.startsWith('PNG 角色卡解析失败'))throw e;throw outOfSpec('压缩文本数据不完整或已损坏。');}
    finally{try{await reader?.cancel()}catch(_){}}
  }
  async function candidate(type,payload){
    let at=nul(payload,0,payload.length);
    if(at<1||at>79)return null;
    const keyword=ascii(payload,0,at);
    if(keyword!=='chara'&&keyword!=='ccv3')return null;
    let body;
    if(type==='tEXt')body=payload.subarray(at+1);
    else if(type==='zTXt'){
      if(at+2>payload.length||payload[at+1]!==0)throw outOfSpec('角色卡 zTXt 压缩标志错误。');
      body=await inflated(payload.subarray(at+2));
    }else{
      if(at+3>=payload.length)throw outOfSpec('角色卡 iTXt 头部不完整。');
      const flag=payload[at+1],method=payload[at+2];
      if((flag!==0&&flag!==1)||method!==0)throw outOfSpec('角色卡 iTXt 压缩字段无效。');
      const langEnd=nul(payload,at+3,payload.length);
      if(langEnd<0)throw outOfSpec('角色卡 iTXt 语言字段不完整。');
      const translatedEnd=nul(payload,langEnd+1,payload.length);
      if(translatedEnd<0)throw outOfSpec('角色卡 iTXt 名称字段不完整。');
      body=flag===1?await inflated(payload.subarray(translatedEnd+1)):payload.subarray(translatedEnd+1);
    }
    if(body.length>MAX_TEXT_BYTES)throw outOfSpec('角色卡元数据过大。');
    return {keyword,text:decoder.decode(body)};
  }
  function decodeBase64Json(input){
    const clean=input.trim();
    if(!clean||clean.length>MAX_TEXT_BYTES||clean.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean))throw outOfSpec('角色卡的 Base64 编码无效。');
    let binary;
    try{binary=atob(clean)}catch(_){throw outOfSpec('角色卡的 Base64 无法解码。');}
    if(binary.length>MAX_TEXT_BYTES)throw outOfSpec('角色卡内容超过体积限制。');
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    let raw;
    try{raw=JSON.parse(decoder.decode(bytes))}catch(_){throw outOfSpec('角色卡 UTF-8 JSON 数据无效。');}
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw outOfSpec('角色卡 JSON 必须是对象。');
    return raw;
  }
  function validateCard(raw,keyword){
    if(raw.spec!==undefined&&raw.spec!=='chara_card_v2'&&raw.spec!=='chara_card_v3')throw outOfSpec('不认识的角色卡 spec。');
    if(keyword==='ccv3'&&raw.spec&&raw.spec!=='chara_card_v3')throw outOfSpec('ccv3 数据的版本标识不匹配。');
    const d=raw.data!==undefined?raw.data:raw;
    if(!d||typeof d!=='object'||Array.isArray(d))throw outOfSpec('角色卡 data 不是对象。');
    for(const key of ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions']){
      if(d[key]!==undefined&&typeof d[key]!=='string')throw outOfSpec(`角色卡 ${key} 字段不是文本。`);
    }
    if(!d.name?.trim())throw outOfSpec('角色卡缺少名称。');
    if(!['description','personality','scenario','first_mes','mes_example'].some(k=>d[k]?.trim())&&!d.content?.trim())throw outOfSpec('角色卡没有可导入的设定内容。');
    if(d.tags!==undefined&&(!Array.isArray(d.tags)||!d.tags.every(x=>typeof x==='string')))throw outOfSpec('tags 字段格式错误。');
    return d;
  }
  async function parse(file){
    if(!file||typeof file.arrayBuffer!=='function')throw outOfSpec('未选择有效文件。');
    if(file.size>MAX_PNG_BYTES)throw outOfSpec('PNG 超过 20MB 安全上限。');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length>MAX_PNG_BYTES||bytes.length<45||PNG_SIGNATURE.some((n,i)=>bytes[i]!==n))throw outOfSpec('不是合法 PNG 文件。');
    const found=new Map(), imageParts=[bytes.subarray(0,8)];let offset=8,ended=false,seenIHDR=false,chunkCount=0;
    while(offset<bytes.length){
      if(++chunkCount>MAX_CHUNKS)throw outOfSpec('PNG 区块数量异常。');
      if(offset+12>bytes.length)throw outOfSpec('PNG 区块头部不完整。');
      const start=offset,length=read32(bytes,offset),type=ascii(bytes,offset+4,offset+8);
      const stop=offset+12+length;
      if(length>MAX_PNG_BYTES||stop>bytes.length)throw outOfSpec('PNG 区块长度无效。');
      if(crc32(bytes,offset+4,offset+8+length)!==read32(bytes,offset+8+length))throw outOfSpec(`PNG ${type} 区块 CRC 校验失败。`);
      if(!seenIHDR){if(type!=='IHDR'||length!==13)throw outOfSpec('PNG 缺少正确的 IHDR。');seenIHDR=true;}
      if(type==='tEXt'||type==='zTXt'||type==='iTXt'){
        const payload=bytes.subarray(offset+8,offset+8+length);
        const entry=await candidate(type,payload);
        if(entry){if(found.has(entry.keyword))throw outOfSpec('检测到重复的角色卡数据块，已拒绝不明确的版本。');found.set(entry.keyword,entry.text);}
      }else imageParts.push(bytes.subarray(start,stop));
      offset=stop;
      if(type==='IEND'){if(length!==0||offset!==bytes.length)throw outOfSpec('PNG 结束区块不正确。');ended=true;break;}
    }
    if(!ended)throw outOfSpec('PNG 缺少结束区块。');
    // If V3 is present, NEVER silently fall back to V2 when the V3 data is corrupt.
    const keyword=found.has('ccv3')?'ccv3':found.has('chara')?'chara':null;
    if(!keyword)throw new Error('这是一张普通 PNG 图片，没有找到 chara / ccv3 角色卡数据。请导入原始角色卡文件，而不是截图或压缩后的图片。');
    const raw=decodeBase64Json(found.get(keyword));const card=validateCard(raw,keyword);
    const extras=['system_prompt','post_history_instructions','alternate_greetings','group_only_greetings','character_book','extensions','creator_notes_multilingual','assets'].filter(k=>card[k]!==undefined&&card[k]!==null&&(typeof card[k]!=='string'||card[k].trim()));
    return {raw,card,version:keyword==='ccv3'?'V3':(raw.spec==='chara_card_v2'?'V2':'V1/V2'),extras,imageBytes:new Blob(imageParts,{type:'image/png'})};
  }
  function toMask(parsed,type,filename,avatar){
    const d=parsed.card;
    const name=d.name.trim()||filename.replace(/\.png$/i,'');
    return {type,name,description:d.description||'',content:d.personality||d.persona||d.content||'',scenario:d.scenario||'',firstMessage:d.first_mes||'',exampleDialogue:d.mes_example||'',creatorNotes:d.creator_notes||'',avatar:avatar||'',tags:d.tags||[],aliases:[],source:'import_png_'+parsed.version.toLowerCase().replace(/\W+/g,'')};
  }
  function avatarDataUrl(blob){
    // A small, local, metadata-free thumbnail avoids persisting the entire PNG card twice.
    if(typeof document==='undefined'||typeof URL==='undefined'||!URL.createObjectURL)return Promise.reject(new Error('此环境暂不支持本地头像缩略图。'));
    return new Promise((resolve,reject)=>{
      const uri=URL.createObjectURL(blob),img=new Image();
      const cleanup=()=>URL.revokeObjectURL(uri);
      img.onerror=()=>{cleanup();reject(new Error('PNG 图片本体无法解码，角色文本仍可导入。'));};
      img.onload=()=>{
        try{
          const w=img.naturalWidth,h=img.naturalHeight;
          if(!w||!h)throw new Error('图片尺寸无效。');
          const scale=Math.min(1,512/Math.max(w,h));const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
          canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
          let result=canvas.toDataURL('image/webp',0.83);
          if(!result.startsWith('data:image/webp;'))result=canvas.toDataURL('image/jpeg',0.8);
          if(result.length>900000)throw new Error('头像缩略图超出存储限制。');
          resolve(result);
        }catch(e){reject(e)}finally{cleanup()}
      };
      img.src=uri;
    });
  }
  // Inspection runs without a character-card write. Include every PNG textual
  // metadata chunk, not only chara/ccv3; preserve unknown types as view-only.
  async function inspect(file){
    if(!file||typeof file.arrayBuffer!=='function')throw outOfSpec('未选择有效 PNG。');
    if(file.size>MAX_PNG_BYTES)throw outOfSpec('PNG 超过 20MB 安全上限。');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length<45||bytes.length>MAX_PNG_BYTES||PNG_SIGNATURE.some((n,i)=>bytes[i]!==n))throw outOfSpec('不是合法 PNG 文件。');
    const metadata=[];let offset=8,count=0,ended=false,total=0,hasCard=false;
    while(offset<bytes.length){
      if(++count>MAX_CHUNKS)throw outOfSpec('PNG 区块数量异常。');
      if(offset+12>bytes.length)throw outOfSpec('PNG 区块头部不完整。');
      const len=read32(bytes,offset),type=ascii(bytes,offset+4,offset+8),stop=offset+len+12;
      if(len>MAX_PNG_BYTES||stop>bytes.length)throw outOfSpec('PNG 区块长度无效。');
      if(count===1&&(type!=='IHDR'||len!==13))throw outOfSpec('PNG 缺少 IHDR。');
      if(crc32(bytes,offset+4,offset+8+len)!==read32(bytes,offset+8+len))throw outOfSpec(`PNG ${type} 区块 CRC 校验失败。`);
      if(['tEXt','zTXt','iTXt'].includes(type)){
        if(metadata.length>=256)throw outOfSpec('文本元数据区块超过 256 个。');
        const payload=bytes.subarray(offset+8,offset+8+len),at=nul(payload,0,payload.length);
        if(at<1||at>79)throw outOfSpec('PNG 文本元数据关键字无效。');
        const keyword=ascii(payload,0,at);let body;
        if(type==='tEXt')body=payload.subarray(at+1);
        else if(type==='zTXt'){
          if(at+2>payload.length||payload[at+1]!==0)throw outOfSpec('zTXt 压缩方法无效。');
          body=await inflated(payload.subarray(at+2));
        }else{
          if(at+3>=payload.length)throw outOfSpec('iTXt 字段不完整。');
          const flag=payload[at+1],method=payload[at+2],lang=nul(payload,at+3,payload.length);
          if(![0,1].includes(flag)||method!==0||lang<0)throw outOfSpec('iTXt 压缩/语言字段无效。');
          const translated=nul(payload,lang+1,payload.length);
          if(translated<0)throw outOfSpec('iTXt 翻译名称无效。');
          body=flag?await inflated(payload.subarray(translated+1)):payload.subarray(translated+1);
        }
        total+=body.byteLength;
        if(total>MAX_TEXT_BYTES)throw outOfSpec('PNG 文本元数据总量超过 4MB。');
        const text=(type==='iTXt'||['chara','ccv3'].includes(keyword)?decoder:new TextDecoder('windows-1252')).decode(body);
        metadata.push({keyword,type,text});
        if(keyword==='chara'||keyword==='ccv3')hasCard=true;
      }
      offset=stop;
      if(type==='IEND'){
        if(len!==0||offset!==bytes.length)throw outOfSpec('PNG 结束区块无效。');
        ended=true;break;
      }
    }
    if(!ended)throw outOfSpec('PNG 缺少结束区块。');
    let card=null,cardError='',rawCard=null;
    if(hasCard){
      const candidateKeyword=metadata.some(x=>x.keyword==='ccv3')?'ccv3':'chara';
      const matches=metadata.filter(x=>x.keyword===candidateKeyword);
      // A valid JSON payload can still be a non-importable character. Keep it
      // inspectable so an embedded worldbook isn't mistaken for absent data.
      if(matches.length===1){try{rawCard=decodeBase64Json(matches[0].text)}catch(e){cardError=e.message;}}
      else cardError='PNG 存在重复的首选角色卡文本块，无法确定权威数据。';
      if(!cardError){try{card=await parse(file)}catch(e){cardError=e.message;}}
    }
    return {filename:file.name||'card.png',metadata,card,rawCard,cardError};
  }
  return Object.freeze({parse,inspect,toMask,avatarDataUrl,MAX_PNG_BYTES});
});
