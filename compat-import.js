/* R1: byte-preserving scanner; no scripts, CSS, or JSON are executed. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatImport=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';const MAX_SOURCE=32*1024*1024,MAX_TEXT=6*1024*1024,MAX_ENTRIES=2048,MAX_UNPACKED=64*1024*1024;
let crcTable;function crc32(b){crcTable??=Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
const fail=(code,msg)=>{throw Object.assign(new Error(msg),{code});};
const decoder=new TextDecoder('utf-8',{fatal:true}),utf8=b=>decoder.decode(b);
function read32(b,i){return(b[i]|b[i+1]<<8|b[i+2]<<16|b[i+3]<<24)>>>0}function read16(b,i){return b[i]|b[i+1]<<8;}
async function digest(b){
 if(root.crypto?.subtle)return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',b))).map(v=>v.toString(16).padStart(2,'0')).join('');
 if(root.MimaSHA256?.digest)return root.MimaSHA256.digest(b);
 fail('E_STORE_UNVERIFIED','此浏览器无法安全计算 SHA256，来源校验未执行');
}
function decodeB64(s){if(typeof s!=='string'||s.length>8*1024*1024)fail('E_SOURCE_CORRUPT','角色数据过大');try{const str=atob(s.trim());let b=Uint8Array.from(str,c=>c.charCodeAt(0));return JSON.parse(utf8(b));}catch(e){fail('E_SOURCE_CORRUPT','卡块 base64/UTF8/JSON 格式错误：'+e.message)}}
function sniffJson(raw){if(Array.isArray(raw))return raw.length&&raw.every(x=>x&&typeof x==='object'&&typeof x.findRegex==='string')?'st_regex':'json_unknown';if(!raw||typeof raw!=='object')return'json_unknown';if(typeof raw.findRegex==='string')return'st_regex';const d=raw.data&&typeof raw.data==='object'?raw.data:raw;
if(raw.spec==='chara_card_v3')return'ccv3';if(raw.spec==='chara_card_v2')return'ccv2';if(raw.entries&&typeof raw.entries==='object')return'world_info';if(typeof d.name==='string'&&(typeof d.description==='string'||typeof d.first_mes==='string'||typeof d.personality==='string'))return'ccv1_variant';if(Array.isArray(raw.regexScripts)||Array.isArray(raw.regex_scripts)||Array.isArray(raw)&&raw.every(x=>'findRegex'in x))return'st_regex';if(raw.prompts||raw.prompt_order||raw.chat_completion_source||raw.openai_max_context)return'st_preset';if(raw.manifest_version||raw.display_name&&raw.js)return'extension_manifest';return'json_unknown';}
function R(kind,name,path,raw,extras={}){return{kind,name:String(name||kind),path,raw,sourceEnabled:extras.sourceEnabled!==false,readiness:'inspect_only',detected:true,preserved:true,converted:false,mounted:false,enabled:false,runtimeVerified:false,semanticGaps:extras.semanticGaps||[],unmetDependencies:extras.unmetDependencies||[],...extras};}
function walkCard(card,prefix='card'){const d=card?.data&&typeof card.data==='object'?card.data:card;const resources=[];if(!d||typeof d!=='object')return resources;
resources.push(R('character',d.name||'未命名角色',prefix+'.data',d,{alternates:Array.isArray(d.alternate_greetings)?d.alternate_greetings:[]}));
let book=d.character_book||d.world_info||d.world_book||d.lorebook;if(book&&typeof book==='object')resources.push(R('world_info',book.name||'角色世界书',prefix+'.data.character_book',book));
for(const field of ['system_prompt','post_history_instructions'])if(typeof d[field]==='string'&&d[field])resources.push(R('prompt_presets',field,prefix+'.data.'+field,d[field]));
let known=new Set(),depthLimit=7;
function nested(o,path,depth){if(depth>depthLimit||!o||typeof o!=='object'||known.has(o))return;known.add(o);
for(const [key,v]of Object.entries(o)){const here=path+'.'+key;if(v===null||v===undefined)continue;const low=key.toLowerCase();
if(['character_book','world_book','world_info','lorebook'].includes(low))continue;
if(['regex_scripts','regexscripts'].includes(low))resources.push(R('regex',key,here,v,{semanticGaps:['ST regex flags require explicit runtime validation']}));
else if((low==='scripts'||low==='script'||low==='js_scripts')&&Array.isArray(v))resources.push(R('script_source',key,here,v,{sourceEnabled:false,unmetDependencies:['Tavern Helper or original host']}));
else if(low==='css'||low==='custom_css'||low==='stylesheet')resources.push(R('css',key,here,v));
else if(/html|template/.test(low)&&typeof v==='string')resources.push(R('html_template',key,here,v,{sourceEnabled:false}));
else if(/(?:quick_repl|quickreply)/.test(low))resources.push(R('quick_reply',key,here,v,{sourceEnabled:false}));
else if(/(?:variables?|mvu)/.test(low))resources.push(R('variable_schema',key,here,v,{sourceEnabled:false}));
else if(low==='assets'&&Array.isArray(v))for(let i=0;i<v.length;i++)resources.push(R('media',v[i]?.name||'asset',here+'['+i+']',v[i],{sourceEnabled:false}));
else if(v&&typeof v==='object')nested(v,here,depth+1);
}}
nested(d.extensions||{},prefix+'.data.extensions',0);return resources;}
async function readZip(bytes){ // validate central-directory boundaries before decompression
const length=bytes.length;let eocd=-1;for(let i=length-22;i>=Math.max(0,length-65557);i--)if(read32(bytes,i)===0x06054b50){eocd=i;break;}if(eocd<0||eocd+22>length)fail('E_SOURCE_CORRUPT','ZIP 结束目录损坏');if(read16(bytes,eocd+4)||read16(bytes,eocd+6))fail('E_SOURCE_CORRUPT','不支持跨磁盘 ZIP');const num=read16(bytes,eocd+10),centralSize=read32(bytes,eocd+12),centralOff=read32(bytes,eocd+16);if(num>MAX_ENTRIES||centralOff+centralSize>eocd)fail('E_DECOMPRESS_BUDGET','ZIP 文件数或中心目录无效');let total=0,ptr=centralOff;const files=[];const seen=new Set();
for(let i=0;i<num;i++){if(ptr+46>length||read32(bytes,ptr)!==0x02014b50)fail('E_SOURCE_CORRUPT','ZIP 中心目录格式损坏');const flags=read16(bytes,ptr+8),method=read16(bytes,ptr+10),expectedCRC=read32(bytes,ptr+16),compressed=read32(bytes,ptr+20),plain=read32(bytes,ptr+24),nameLen=read16(bytes,ptr+28),extraLen=read16(bytes,ptr+30),commentLen=read16(bytes,ptr+32),startDisk=read16(bytes,ptr+34),extAttr=read32(bytes,ptr+38),localOff=read32(bytes,ptr+42);if(ptr+46+nameLen+extraLen+commentLen>length||startDisk)fail('E_SOURCE_CORRUPT','ZIP 条目字段越界');let name;try{name=utf8(bytes.subarray(ptr+46,ptr+46+nameLen))}catch(_){fail('E_SOURCE_CORRUPT','ZIP 条目名称不是 UTF-8（请重新导出）');}
if(!name||name.includes('\\')||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').some(seg=>seg==='..'||seg==='.')||name.includes('\u0000')||name.split('/').length>18)fail('E_ZIP_PATH_TRAVERSAL','ZIP 不安全路径 '+name);if(seen.has(name.toLowerCase()))fail('E_SOURCE_CORRUPT','ZIP 路径重复/大小写冲突：'+name);seen.add(name.toLowerCase());if((extAttr>>>16&0xf000)===0xa000)fail('E_ZIP_PATH_TRAVERSAL','ZIP 不支持符号链接 '+name);if((flags&1)||!([0,8].includes(method))||plain>16*1024*1024||compressed>32*1024*1024||(compressed&&plain/compressed>250))fail('E_DECOMPRESS_BUDGET','ZIP 加密/压缩方法/体积不受支持 '+name);total+=plain;if(total>MAX_UNPACKED)fail('E_DECOMPRESS_BUDGET','ZIP 解压总量超过 64MB');
if(read32(bytes,localOff)!==0x04034b50)fail('E_SOURCE_CORRUPT','ZIP 局部头损坏 '+name);const loName=read16(bytes,localOff+26),loExtra=read16(bytes,localOff+28),dataAt=localOff+30+loName+loExtra;if(dataAt+compressed>centralOff)fail('E_SOURCE_CORRUPT','ZIP 数据边界越界');
files.push({name,method,compressed,plain,dataAt,expectedCRC});ptr+=46+nameLen+extraLen+commentLen;}
if(ptr!==centralOff+centralSize)fail('E_SOURCE_CORRUPT','ZIP 中心目录大小不一致');const outputs=[];
for(const f of files){if(f.name.endsWith('/'))continue;let payload=bytes.subarray(f.dataAt,f.dataAt+f.compressed);if(f.method===8){if(typeof DecompressionStream!=='function')fail('E_DECOMPRESS_BUDGET','当前浏览器不支持 ZIP deflate-raw');const reader=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();let parts=[],n=0;try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>f.plain||n>16*1024*1024)fail('E_DECOMPRESS_BUDGET','ZIP 解压大小不一致');parts.push(p.value);}}finally{try{await reader.cancel()}catch(_){}}payload=new Uint8Array(n);let at=0;for(const part of parts){payload.set(part,at);at+=part.length;}}
if(payload.length!==f.plain||crc32(payload)!==f.expectedCRC)fail('E_SOURCE_CORRUPT','ZIP 文件长度/CRC 校验失败 '+f.name);outputs.push({name:f.name,bytes:payload});}
return outputs;}
async function inspectBytes(bytes,filename='file'){if(!(bytes instanceof Uint8Array)||bytes.length>MAX_SOURCE||!bytes.length)fail('E_DECOMPRESS_BUDGET','文件格式或体积不符合安全上限');const sha256=await digest(bytes),resources=[],warnings=[];let format='unknown',versions=[];
if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){
format='png';
if(!root.MimaPngCardImport?.inspect)fail('E_UNKNOWN_SCHEMA','PNG 角色卡读取组件未加载');
// The PNG parser is the sole authority for CRC, decompression, card validity,
// and ccv3-vs-chara precedence. Never create resource IR from an unvalidated
// parallel base64 decoder. A malformed ccv3 must not fall back to chara.
const file=new Blob([bytes],{type:'image/png'});file.name=filename;
let report;
try{report=await root.MimaPngCardImport.inspect(file);}catch(e){fail('E_PNG_SCAN',e.message);}
const primary=report.card;
if(!primary){
 const reason=report.cardError||'这张图片没有角色卡元数据（chara / ccv3）；请选原始角色卡 PNG，而非截图或重新压缩的图片';
 fail(report.cardError?'E_PNG_CARD_INVALID':'E_PNG_NOT_CHARACTER_CARD',reason);
}
const selectedKey=primary.sourceKeyword||(primary.version==='V3'?'ccv3':'chara');
const matching=report.metadata.map((entry,index)=>({entry,index})).filter(x=>x.entry.keyword===selectedKey);
if(selectedKey!=='v1flat'&&matching.length!==1)fail('E_PNG_CARD_INVALID','同一角色版本存在多个元数据块，无法安全选择');
const selectedIndex=selectedKey==='v1flat'?-1:matching[0].index;
versions=[sniffJson(primary.raw)];
resources.push(...walkCard(primary.raw,selectedKey==='v1flat'?'png.v1flat':`png.${selectedKey}[${selectedIndex}]`));
for(const [index,m] of report.metadata.entries()){
 const chosen=index===selectedIndex;
 resources.push(R('raw_unknown',chosen?`原始 ${selectedKey} 角色卡 JSON`:`PNG 元数据 ${m.keyword}`,
   `png.metadata[${index}]`,chosen?primary.raw:{keyword:m.keyword,type:m.type,text:m.text},
   {sourceEnabled:false}));
}
if(report.metadata.some(m=>m.keyword==='chara')&&report.metadata.some(m=>m.keyword==='ccv3'))
 warnings.push('此 PNG 同时包含 V2/V3；按 CCv3 规范使用新版角色卡，旧版元数据在原始文件中完整保留。');
} else if(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4){format='zip';const entries=await readZip(bytes);const card=entries.find(e=>e.name==='card.json');if(card){format='charx';const raw=JSON.parse(utf8(card.bytes));const t=sniffJson(raw);if(!t.startsWith('ccv'))warnings.push('CHARX card.json 未被识别为角色卡');else{versions.push(t);resources.push(...walkCard(raw,'charx.card'));}resources.push(R('raw_unknown','完整 card.json','charx.card.json',raw,{sourceEnabled:false}));}
let manifest=entries.find(e=>e.name==='manifest.json');if(manifest){let m=JSON.parse(utf8(manifest.bytes));resources.push(R('plugin_bundle',m.display_name||m.name||'扩展 manifest','zip.manifest',m,{sourceEnabled:false,unmetDependencies:['需要验证扩展 API / 授权后在官方宿主运行']}));}
for(const e of entries)if(!['card.json','manifest.json'].includes(e.name)){let mime=/\.(png)$/i.test(e.name)?'image/png':/\.(jpe?g)$/i.test(e.name)?'image/jpeg':/\.(webp)$/i.test(e.name)?'image/webp':/\.(mp3)$/i.test(e.name)?'audio/mpeg':/\.(ogg)$/i.test(e.name)?'audio/ogg':/\.(wav)$/i.test(e.name)?'audio/wav':'';
resources.push(R(mime?'media':'raw_unknown',e.name,'zip/'+e.name,{size:e.bytes.length,mime,sha256:await digest(e.bytes),embeddedPath:e.name},{sourceEnabled:false,unmetDependencies:mime?[]:['未知 ZIP 条目仅保留原始字节']}));}
} else {format='json';if(bytes.length>MAX_TEXT)fail('E_DECOMPRESS_BUDGET','JSON 文字超过 6MB');let raw;try{raw=JSON.parse(utf8(bytes))}catch(e){fail('E_UNKNOWN_SCHEMA','JSON 解析失败：'+e.message);}const kind=sniffJson(raw);versions=[kind];if(kind.startsWith('ccv'))resources.push(...walkCard(raw,'json.card'));else if(kind==='world_info')resources.push(R('world_info',raw.name||'外置世界书','json.root',raw));else if(kind==='st_regex'){const rules=typeof raw.findRegex==='string'?[raw]:(raw.regexScripts||raw.regex_scripts||raw);for(const [i,e]of rules.entries())resources.push(R('regex',e.scriptName||('规则 '+(i+1)),'json.regex['+i+']',e));}else if(kind==='st_preset')resources.push(R('prompt_presets',raw.name||'预设','json.root',raw,{sourceEnabled:false}));else if(kind==='extension_manifest')resources.push(R('plugin_bundle',raw.name||'插件描述','json.root',raw,{sourceEnabled:false}));else{warnings.push('未知 JSON Schema；仅能保留原文');resources.push(R('raw_unknown','未知 JSON','json.root',raw,{sourceEnabled:false}));}}
return{format,versions,sha256,filename,bytes:Uint8Array.from(bytes),resources:resources.map((r,i)=>({...r,index:i,sourcePath:r.path,level:1})),warnings};}
async function inspect(file){if(!file||typeof file.arrayBuffer!=='function')fail('E_SOURCE_CORRUPT','请选择本地文件');const b=new Uint8Array(await file.arrayBuffer());return inspectBytes(b,file.name||'unknown');}
return Object.freeze({inspect,inspectBytes,sniffJson,readZip,walkCard,digest});
});
