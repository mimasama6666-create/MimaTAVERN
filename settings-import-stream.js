/* Legacy settings JSON importer: index the immutable File using byte offsets.
 * The large fonts[] payload is removed before JSON.parse; each record is
 * validated and restored separately, without accumulating all font binaries.
 * No canonical database is changed by prepare() or preflight(). */
window.MimaSettingsJsonImport = (() => {
 'use strict';
 const BLOCK=256*1024;
 const ws=c=>c===32||c===9||c===10||c===13;
 function fail(message){throw Error('设置 JSON 读取失败：'+message+'；未修改资料');}
 async function prepare(file){
  if(!(file instanceof Blob))fail('文件类型无效');
  const frames=[],ranges=[];let target=null,start=-1,end=-1;
  let inString=false,escaped=false,keyChars=null,keyOverflow=false,rootDataCount=0,fontsKeyCount=0;
  for(let offset=0;offset<file.size;offset+=BLOCK){
   const bytes=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+BLOCK)).arrayBuffer());
   for(let j=0;j<bytes.length;j++){
    const c=bytes[j],pos=offset+j;
    if(inString){
     if(escaped){escaped=false;if(keyChars){if(keyChars.length<256)keyChars.push(c);else keyOverflow=true;}continue;}
     if(c===92){escaped=true;if(keyChars){if(keyChars.length<256)keyChars.push(c);else keyOverflow=true;}continue;}
     if(c===34){
      inString=false;
      if(keyChars&&!keyOverflow){try{frames[frames.length-1].lastKey=JSON.parse('"'+new TextDecoder().decode(Uint8Array.from(keyChars))+'"');}catch(_){frames[frames.length-1].lastKey=null;}}
      keyChars=null;continue;
     }
     if(keyChars){if(keyChars.length<256)keyChars.push(c);else keyOverflow=true;}continue;
    }
    if(ws(c))continue;
    const top=frames[frames.length-1];
    if(target===top){
     if(c===44){
      if(!target.itemStart&&target.itemStart!==0 || target.itemEnd<0)fail('字体记录不完整');
      ranges.push([target.itemStart,target.itemEnd]);if(ranges.length>100000)fail('字体记录数超出限制');
      target.itemStart=null;target.itemEnd=-1;target.expectItem=true;target.hadComma=true;
      continue;
     }
     if(c===93){
      if(target.itemStart!==null){if(target.itemEnd<0)fail('字体记录没有结束');ranges.push([target.itemStart,target.itemEnd]);}
      else if(target.hadComma)fail('字体数组末尾存在多余逗号');
      end=pos;frames.pop();target=null;continue;
     }
     if(target.itemEnd>=0)fail('字体记录之间缺少逗号');
     if(target.expectItem&&c!==123)fail('字体数组记录不是对象');
    }
    if(c===34){inString=true;escaped=false;keyOverflow=false;keyChars=top?.type==='object'&&top.expectKey?[]:null;continue;}
    if(c===58&&top?.type==='object'){
     if(top.path===''&&top.lastKey==='data'&&++rootDataCount>1)fail('出现重复 data 字段');
     if(top.path==='data'&&top.lastKey==='fonts'&&++fontsKeyCount>1)fail('出现重复 fonts 字段');
     top.key=top.lastKey;top.lastKey=null;top.expectKey=false;continue;
    }
    if(c===44&&top?.type==='object'){
     top.key=null;top.lastKey=null;top.expectKey=true;continue;
    }
    if(c===123||c===91){
     const path=!top?'':top.type==='object'&&top.path===''&&top.key==='data'?'data':'other';
     if(c===91&&top?.type==='object'&&top.path==='data'&&top.key==='fonts'){
      if(start!==-1)fail('出现重复字体数组');
      start=pos;
     }
     const frame={type:c===123?'object':'array',path,expectKey:c===123,lastKey:null,key:null};
     if(c===91&&start===pos){frame.isFonts=true;frame.expectItem=true;frame.itemStart=null;frame.itemEnd=-1;frame.hadComma=false;target=frame;}
     if(top===target&&c===123){target.itemStart=pos;target.itemEnd=-1;target.expectItem=false;target.hadComma=false;}
     frames.push(frame);continue;
    }
    if(c===125||c===93){
     const frame=frames.pop();
     if(!frame||(c===125&&frame.type!=='object')||(c===93&&frame.type!=='array'))fail('JSON 括号不匹配');
     if(frame.type==='object'&&frames[frames.length-1]===target)target.itemEnd=pos+1;
    }
   }
  }
  if(inString||frames.length)fail('JSON 文件不完整');
  if(start<0){return {raw:JSON.parse(await file.text()),count:0,async preflight(){},async *records(){}};}
  if(end<0)fail('字体数组缺少结尾');
  // JSON.parse validates the complete non-font document. Individual font
  // records get JSON.parse on demand and are preflighted before any writes.
  const stripped=new Blob([file.slice(0,start+1),file.slice(end)],{type:'application/json'});
  let raw;try{raw=JSON.parse(await stripped.text());}catch(e){fail('非字体资料损坏：'+e.message);}
  if(!raw?.data||!Array.isArray(raw.data.fonts)||raw.data.fonts.length)fail('字体字段定位不一致');
  const ids=[];
  const read=async i=>{
   const [a,b]=ranges[i],row=JSON.parse(await file.slice(a,b).text());
   if(!row||typeof row!=='object'||Array.isArray(row))fail('字体记录类型无效');
   // Old archives could omit IDs. Allocate exactly once during preflight and
   // reuse on the second immutable-file read during commit.
   if(ids[i]){if(row.id&&String(row.id)!==ids[i])fail('字体记录身份变化');row.id=ids[i];}
   return row;
  };
  let verified=false;
  return {raw,count:ranges.length,
   async preflight(onProgress=()=>{}){
    if(verified)return;
    const seen=new Set();
    for(let i=0;i<ranges.length;i++){
     const row=await read(i);
     const id=String(row.id||'legacy_import_'+crypto.randomUUID().replace(/-/g,''));
     if(seen.has(id))fail('重复字体 ID：'+id);
     seen.add(id);ids[i]=id;row.id=id;
     await MimaFontManager.planPortableImport([row]);
     onProgress(i+1,ranges.length);
    }
    verified=true;
   },
   async *records(){
    if(!verified)fail('字体尚未完成全量预检');
    for(let i=0;i<ranges.length;i++)yield await read(i);
   }
  };
 }
 return Object.freeze({prepare});
})();
