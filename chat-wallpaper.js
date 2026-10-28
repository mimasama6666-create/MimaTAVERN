/* MIMA Chat Wallpaper R4: opt-in Blob persistence. No theme/History writes. */
(()=>{'use strict';
const DB='mima-chat-wallpaper-v1',STORE='wallpapers';
let sessionId=null,current=null,url=null,seq=0,dbTask=null;
const defaults=()=>({fit:'cover',focusX:50,focusY:50,mask:0,blur:0});
const safeOpts=v=>({fit:v?.fit==='contain'?'contain':'cover',focusX:limit(v?.focusX,0,100,50),focusY:limit(v?.focusY,0,100,50),mask:limit(v?.mask,0,95,v?24:0),blur:limit(v?.blur,0,30,0)});
function limit(x,a,b,f){x=Number(x);return Number.isFinite(x)?Math.min(b,Math.max(a,x)):f;}
function database(){return dbTask||(dbTask=new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||Error('背景图数据库打开失败'));q.onblocked=()=>reject(Error('背景数据库被其他页面占用'));}).catch(e=>{dbTask=null;throw e}));}
async function read(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);tx.onerror=()=>reject(tx.error);});}
async function write(key,record){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('背景保存被取消'));tx.onerror=()=>reject(tx.error);});}
async function remove(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('背景删除被取消'));tx.onerror=()=>reject(tx.error);});}
function msg(s){const e=document.getElementById('mima-wallpaper-message');if(e)e.textContent=s;else console.info('[ChatWallpaper]',s);}
function eraseURL(){if(url){URL.revokeObjectURL(url);url=null;}}
// Inspect compressed containers before asking the browser to allocate decoded pixels.
const WALL_LIMITS=Object.freeze({bytes:10*1024*1024,decodePixels:16*1024*1024,edge:8192,displayPixels:4*1024*1024,displayEdge:2560,animatedPixels:2*1024*1024,frames:120,framePixels:64*1024*1024});
async function wallpaperInfo(blob){
 if(!(blob instanceof Blob)||!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)||blob.size>WALL_LIMITS.bytes)throw Error('仅支持 10 MB 内 PNG、JPEG、WebP、GIF 图片');
 const bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer),str=(p,n)=>String.fromCharCode(...bytes.subarray(p,p+n));let width=0,height=0,frames=1,animated=false;
 const need=(p,n)=>{if(p<0||p+n>bytes.length)throw Error('图片容器不完整，未显示或改写原图');};
 if(blob.type==='image/png'){
  need(0,24);if(str(0,8)!=='\x89PNG\r\n\x1a\n'||str(12,4)!=='IHDR'||v.getUint32(8)!==13)throw Error('PNG 图片头无效');width=v.getUint32(16);height=v.getUint32(20);
  for(let p=8;p+12<=bytes.length;){const n=v.getUint32(p);need(p+8,n+4);if(str(p+4,4)==='acTL'){need(p+8,8);frames=v.getUint32(p+8);animated=true;}if(str(p+4,4)==='fcTL'){if(n!==26)throw Error('PNG 动画帧结构无效');const fw=v.getUint32(p+12),fh=v.getUint32(p+16),fx=v.getUint32(p+20),fy=v.getUint32(p+24);if(!fw||!fh||fx+fw>width||fy+fh>height)throw Error('PNG 动画帧尺寸超出画布');}p+=n+12;}
 }else if(blob.type==='image/gif'){
  need(0,13);if(!/^GIF8[79]a$/.test(str(0,6)))throw Error('GIF 图片头无效');width=v.getUint16(6,true);height=v.getUint16(8,true);let p=13+((bytes[10]&128)?3*(1<<((bytes[10]&7)+1)):0),count=0;
  const subblocks=()=>{for(;;){need(p,1);const n=bytes[p++];if(!n)return;need(p,n);p+=n;}};
  while(p<bytes.length){const type=bytes[p++];if(type===0x3b)break;if(type===0x21){need(p,1);p++;subblocks();}else if(type===0x2c){need(p,9);const flags=bytes[p+8],w=v.getUint16(p+4,true),h=v.getUint16(p+6,true);if(!w||!h||v.getUint16(p,true)+w>width||v.getUint16(p+2,true)+h>height)throw Error('GIF 帧尺寸超出画布');p+=9;if(flags&128)p+=3*(1<<((flags&7)+1));need(p,1);p++;subblocks();count++;}else throw Error('GIF 帧结构无效');}
  frames=Math.max(1,count);animated=frames>1;
 }else if(blob.type==='image/webp'){
  need(0,20);if(str(0,4)!=='RIFF'||str(8,4)!=='WEBP')throw Error('WebP 图片头无效');let count=0;
  const raster=(kind,p,n,maxW,maxH)=>{let w,h;if(kind==='VP8 '){if(n<10)throw Error('WebP 图片帧无效');need(p,10);if(str(p+3,3)!=='\x9d\x01\x2a')throw Error('WebP 图片帧无效');w=v.getUint16(p+6,true)&0x3fff;h=v.getUint16(p+8,true)&0x3fff;}else if(kind==='VP8L'){if(n<5)throw Error('WebP 图片帧无效');need(p,5);if(bytes[p]!==0x2f)throw Error('WebP 图片帧无效');const bits=v.getUint32(p+1,true);w=1+(bits&0x3fff);h=1+((bits>>>14)&0x3fff);}else return null;if(!w||!h||w>WALL_LIMITS.edge||h>WALL_LIMITS.edge||w*h>WALL_LIMITS.decodePixels||(maxW&&w>maxW)||(maxH&&h>maxH))throw Error('WebP 实际像素尺寸超出画布或预算');return {w,h};};
  for(let p=12;p+8<=bytes.length;){const n=v.getUint32(p+4,true),kind=str(p,4);need(p+8,n);
   if(kind==='VP8X'){need(p+8,10);animated=!!(bytes[p+8]&2);width=1+bytes[p+12]+(bytes[p+13]<<8)+(bytes[p+14]<<16);height=1+bytes[p+15]+(bytes[p+16]<<8)+(bytes[p+17]<<16);}
   else {const dims=raster(kind,p+8,n,width,height);if(dims&&!width){width=dims.w;height=dims.h;}}
   if(kind==='ANMF'){need(p+8,16);const frameW=1+bytes[p+14]+(bytes[p+15]<<8)+(bytes[p+16]<<16),frameH=1+bytes[p+17]+(bytes[p+18]<<8)+(bytes[p+19]<<16),x=2*(bytes[p+8]+(bytes[p+9]<<8)+(bytes[p+10]<<16)),y=2*(bytes[p+11]+(bytes[p+12]<<8)+(bytes[p+13]<<16));if(x+frameW>width||y+frameH>height)throw Error('WebP 动画帧尺寸超出画布');for(let ip=p+24;ip+8<=p+8+n;){const size=v.getUint32(ip+4,true);if(ip+8+size>p+8+n)throw Error('WebP 动画帧数据无效');raster(str(ip,4),ip+8,size,frameW,frameH);ip+=8+size+(size&1);}count++;}p+=8+n+(n&1);
  }frames=Math.max(1,count);
 }else{
  need(0,2);if(v.getUint16(0)!==0xffd8)throw Error('JPEG 图片头无效');let p=2;
  while(p<bytes.length){if(bytes[p++]!==0xff)throw Error('JPEG 标记无效');while(bytes[p]===0xff)p++;need(p,1);const marker=bytes[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;need(p,2);const n=v.getUint16(p);if(n<2)throw Error('JPEG 段无效');need(p,n);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){need(p,7);height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=n;}
 }
 if(!width||!height||width>WALL_LIMITS.edge||height>WALL_LIMITS.edge||width*height>WALL_LIMITS.decodePixels)throw Error('图片尺寸或像素超过安全解码上限（8192 边长 / 16 MP）；原图未修改');
 if(animated&&(!frames||width*height>WALL_LIMITS.animatedPixels||frames>WALL_LIMITS.frames||width*height*frames>WALL_LIMITS.framePixels))throw Error('动画图片像素或帧数超过显示预算；请先缩小动画，原图未修改');
 return {width,height,frames,animated};
}
let displayCancel=null;
function cancelDisplayPrepare(){if(displayCancel){displayCancel();displayCancel=null;}}
async function prepareWallpaper(record,step){
 const info=await wallpaperInfo(record.blob);if(step!==seq)throw new DOMException('过时的背景读取','AbortError');
 if(info.animated)return {...record,displayBlob:record.blob,dimensions:info};
 const displayBlob=await new Promise((resolve,reject)=>{const image=new Image(),source=URL.createObjectURL(record.blob);let settled=false;
  const cleanup=()=>{image.onload=image.onerror=null;image.src='';URL.revokeObjectURL(source);if(displayCancel===cancel)displayCancel=null;};
  const fail=e=>{if(settled)return;settled=true;cleanup();reject(e);};const cancel=()=>fail(new DOMException('过时的背景解码','AbortError'));displayCancel=cancel;
  image.onerror=()=>fail(Error('图片无法解码，原图未修改'));image.onload=()=>{try{
   if(step!==seq)return cancel();const w=image.naturalWidth,h=image.naturalHeight;if(!w||!h||w>WALL_LIMITS.edge||h>WALL_LIMITS.edge||w*h>WALL_LIMITS.decodePixels)throw Error('图片实际解码尺寸超出像素预算');
   const ratio=Math.min(1,WALL_LIMITS.displayEdge/w,WALL_LIMITS.displayEdge/h,Math.sqrt(WALL_LIMITS.displayPixels/(w*h))),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));const context=canvas.getContext('2d');if(!context)throw Error('浏览器无法创建背景缩略图');context.drawImage(image,0,0,canvas.width,canvas.height);
   canvas.toBlob(blob=>{if(settled)return;canvas.width=canvas.height=1;if(step!==seq)return cancel();if(!blob)return fail(Error('背景缩略图生成失败'));settled=true;cleanup();resolve(blob);},'image/png');
  }catch(error){fail(error);}};image.src=source;
 });
 if(step!==seq)throw new DOMException('过时的背景处理','AbortError');return {...record,displayBlob,dimensions:info};
}
function draw(){const box=document.getElementById('story-chat-box');if(!box)return;
 if(!current?.displayBlob){box.removeAttribute('data-mima-chat-wallpaper');for(const k of ['--mima-wallpaper-image','--mima-wallpaper-size','--mima-wallpaper-position','--mima-wallpaper-mask','--mima-wallpaper-blur','--mima-wallpaper-filter'])box.style.removeProperty(k);return;}
 if(!url)url=URL.createObjectURL(current.displayBlob);const o=safeOpts(current.opts);
 box.setAttribute('data-mima-chat-wallpaper','1');
 const changed=(k,v)=>{if(box.style.getPropertyValue(k)!==v)box.style.setProperty(k,v);};
 changed('--mima-wallpaper-image',`url("${url}")`);changed('--mima-wallpaper-size',o.fit);
 changed('--mima-wallpaper-position',`${o.focusX}% ${o.focusY}%`);changed('--mima-wallpaper-mask',String(o.mask/100));
 changed('--mima-wallpaper-blur',o.blur+'px');changed('--mima-wallpaper-filter',o.blur>0?`blur(${o.blur}px)`:'none');
}
function replace(record){eraseURL();current=record;if(!record){const picker=document.getElementById('mima-wallpaper-file');if(picker)picker.value='';}draw();}
async function onSession(id){if(sessionId===id&&current)return;sessionId=id||null;const step=++seq;cancelDisplayPrepare();replace(null);if(!id)return;
 try{const found=await read('session:'+id)||await read('global');if(step!==seq||id!==sessionId)return;if(found?.blob instanceof Blob){const prepared=await prepareWallpaper({blob:found.blob,opts:safeOpts(found.opts),scope:found.scope},step);if(step===seq)replace(prepared);}}
 catch(e){if(e.name==='AbortError')return;console.error('[ChatWallpaper] read unavailable, canonical wallpaper unchanged',e);msg('已保存背景暂不能显示；原有数据保留：'+e.message);}}
async function pick(file){if(!file)return;const step=++seq;cancelDisplayPrepare();
 try{const prepared=await prepareWallpaper({blob:file,opts:defaults(),scope:'temporary'},step);if(step!==seq)return;replace(prepared);msg('临时聊天背景已显示；显示图已限制像素，原件保留且未保存到数据库。');}
 catch(e){if(e.name!=='AbortError')msg('背景未更改：'+e.message);}}
function adjust(key,value){if(!current){msg('请先选择背景图');return;}if(!['fit','focusX','focusY','mask','blur'].includes(key))return;current.opts=safeOpts({...current.opts,[key]:value});draw();}
async function save(scope){if(!current?.blob){msg('请先选择或载入一张背景图');return;}if(!['session','global'].includes(scope)){msg('默认临时背景无需保存，切换剧情会释放图片。');return;}if(scope==='session'&&!sessionId){msg('当前没有剧情，不能保存会话背景');return;}
 const key=scope==='global'?'global':'session:'+sessionId,saving=current,step=seq;
 try{await write(key,{blob:saving.blob,opts:safeOpts(saving.opts),scope,updatedAt:Date.now()});
   if(current===saving&&seq===step){current.scope=scope;msg(scope==='global'?'全局聊天背景已保存。':'当前剧情背景已保存。');}
   else msg('之前选择的背景已保存到原目标；当前新背景没有被标记为已保存。');}
 catch(e){console.error('[ChatWallpaper] failed to save',e);msg('保存失败：'+e.message+'（临时背景仍在，旧记录未更改）');}}
function clear(){++seq;cancelDisplayPrepare();replace(null);msg('已退出当前背景显示；已保存的图片没有被删除。');}
async function deleteSaved(scope){if(!['session','global'].includes(scope))return;if(scope==='session'&&!sessionId)return msg('当前没有剧情');if(!confirm('确定只删除此范围保存的聊天背景？不会删除主题、聊天记录或其他背景。'))return;
 const key=scope==='global'?'global':'session:'+sessionId;
 try{await remove(key);await onSessionReload();msg('指定范围的已保存背景已删除，其他素材未动。');}catch(e){console.error('[ChatWallpaper] delete failed',e);msg('删除失败；没有覆盖原数据：'+e.message);}}
async function onSessionReload(){const s=sessionId;sessionId=null;await onSession(s);}
const wallpaperB64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=0x4000)result+=String.fromCharCode(...bytes.subarray(i,i+0x4000));return btoa(result);};
const fromWallpaperB64=text=>{if(typeof text!=='string'||text.length>15*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw Error('壁纸备份二进制编码无效');const bin=atob(text),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;};
const wallHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function wallpaperKeys(){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).getAllKeys();let keys;q.onsuccess=()=>{keys=q.result;};q.onerror=()=>reject(q.error);tx.oncomplete=()=>resolve(keys||[]);tx.onabort=()=>reject(tx.error||Error('壁纸键读取中止'));});}
async function exportRecords(){const keys=await wallpaperKeys(),records=[];for(const key of keys){if(key!=='global'&&!/^session:[^:]+$/.test(key))throw Error('壁纸备份包含未知键：'+key);const value=await read(key);if(!(value?.blob instanceof Blob))throw Error('已保存壁纸缺少原始 Blob：'+key);const bytes=new Uint8Array(await value.blob.arrayBuffer());records.push({key,mime:value.blob.type,bytes:wallpaperB64(bytes),sha256:await wallHash(bytes),size:bytes.length,opts:safeOpts(value.opts),scope:value.scope,updatedAt:value.updatedAt||0});}return{format:'mima-chat-wallpaper-records',version:1,records};}
const wallpaperSignature=async value=>!(value?.blob instanceof Blob)?null:JSON.stringify({scope:value.scope,opts:safeOpts(value.opts),mime:value.blob.type,size:value.blob.size,updatedAt:value.updatedAt||0,hash:await wallHash(new Uint8Array(await value.blob.arrayBuffer()))});
async function prepareImport(data){if(!data||data.format!=='mima-chat-wallpaper-records'||data.version!==1||!Array.isArray(data.records))throw Error('聊天背景备份格式无效');const seen=new Set(),incoming=[];let added=0,present=0;
 for(const row of data.records){if(!row||typeof row.key!=='string'||(row.key!=='global'&&!/^session:[^:]+$/.test(row.key))||seen.has(row.key)||!['session','global'].includes(row.scope))throw Error('壁纸备份记录键或范围无效');seen.add(row.key);if((row.key==='global')!==(row.scope==='global'))throw Error('壁纸键与作用域不符');if(!/^image\/(png|jpeg|webp|gif)$/.test(row.mime))throw Error('壁纸备份图片类型无效');const bytes=fromWallpaperB64(row.bytes);if(bytes.length!==row.size||bytes.length>WALL_LIMITS.bytes||await wallHash(bytes)!==row.sha256)throw Error('壁纸原件哈希不符：'+row.key);
  const prior=await read(row.key),signature=await wallpaperSignature(prior);
  if(prior){if(!signature||prior.scope!==row.scope||JSON.stringify(safeOpts(prior.opts))!==JSON.stringify(safeOpts(row.opts))||prior.blob.type!==row.mime||prior.blob.size!==row.size||await wallHash(new Uint8Array(await prior.blob.arrayBuffer()))!==row.sha256)throw Error('壁纸与本机已有不同内容，拒绝覆盖：'+row.key);present++;}else added++;
  // Retain only the already-existing portable row, not a second decoded Blob library.
  incoming.push({row,signature});
 }
 return{incoming,added,present};
}
async function previewRecordImport(data){const plan=await prepareImport(data);return{toImport:plan.added,alreadyPresent:plan.present};}
async function importRecords(data){const plan=await prepareImport(data),db=await database();return new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let failure=null,added=0,index=0;
 const fail=error=>{failure=error;tx.abort();};
 // IDB transactions cannot await a digest without an outstanding request. A
 // lightweight count keeps this atomic transaction alive until the one-record
 // hash settles; the next write runs inside that request's success callback.
 const duringTransaction=(promise,done)=>{let settled=false,value,error;Promise.resolve(promise).then(v=>{settled=true;value=v;},e=>{settled=true;error=e;});
  const pump=()=>{const q=store.count();q.onerror=()=>fail(q.error);q.onsuccess=()=>{if(!settled)return pump();if(error)return fail(error);try{done(value);}catch(e){fail(e);}};};pump();};
 const next=()=>{if(index>=plan.incoming.length)return;const entry=plan.incoming[index++],row=entry.row,q=store.get(row.key);
  q.onerror=()=>fail(q.error);q.onsuccess=()=>{const prior=q.result;duringTransaction(wallpaperSignature(prior),signature=>{
   if((prior?signature:null)!==entry.signature)return fail(Error('壁纸导入期间数据已发生变化：'+row.key));
   if(!prior){const bytes=fromWallpaperB64(row.bytes);store.put({blob:new Blob([bytes],{type:row.mime}),opts:safeOpts(row.opts),scope:row.scope,updatedAt:row.updatedAt||0},row.key);added++;}next();
  });};};
 next();tx.oncomplete=()=>resolve({imported:added,alreadyPresent:plan.incoming.length-added});tx.onabort=()=>reject(failure||tx.error||Error('壁纸导入被取消，未覆盖旧图'));tx.onerror=()=>{failure=tx.error||failure;};
 });}
function markup(){const o=safeOpts(current?.opts);return `<section class="settings-section"><h3>🖼️ 自定义聊天背景</h3><p class="helper">只作用于当前剧情聊天区域，不改变角色卡 HTML、原始对话或工坊主题。导入后默认临时显示，<strong>不会自动保存</strong>；切换剧情或关闭页面会释放临时图片。显示期间仍需要占用图片内存。</p><input id="mima-wallpaper-file" class="field" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="MimaChatWallpaper.pick(this.files[0])"><div class="form-grid"><div><label class="form-label">填充方式</label><select class="field" onchange="MimaChatWallpaper.adjust('fit',this.value)"><option ${o.fit==='cover'?'selected':''} value="cover">铺满裁剪</option><option ${o.fit==='contain'?'selected':''} value="contain">完整显示</option></select></div><div><label class="form-label">遮罩浓度：${o.mask}%</label><input class="field" type="range" min="0" max="95" value="${o.mask}" oninput="MimaChatWallpaper.adjust('mask',this.value)"></div><div><label class="form-label">图片焦点 X</label><input class="field" type="range" min="0" max="100" value="${o.focusX}" oninput="MimaChatWallpaper.adjust('focusX',this.value)"></div><div><label class="form-label">图片焦点 Y</label><input class="field" type="range" min="0" max="100" value="${o.focusY}" oninput="MimaChatWallpaper.adjust('focusY',this.value)"></div><div><label class="form-label">背景模糊</label><input class="field" type="range" min="0" max="30" value="${o.blur}" oninput="MimaChatWallpaper.adjust('blur',this.value)"></div></div><div class="toolbar"><button class="ghost-btn" onclick="MimaChatWallpaper.clear()">退出背景显示</button><button class="primary-btn" onclick="MimaChatWallpaper.save('session')">明确保存到当前剧情</button><button class="ghost-btn" onclick="MimaChatWallpaper.save('global')">明确保存到全局</button></div><div class="toolbar"><button class="ghost-btn" onclick="MimaChatWallpaper.deleteSaved('session')">删除当前剧情已保存背景</button><button class="ghost-btn" onclick="MimaChatWallpaper.deleteSaved('global')">删除全局已保存背景</button></div><p id="mima-wallpaper-message" class="helper" role="status">当前显示：${current?.scope==='temporary'?'临时（未保存）':current?.scope==='session'?'当前剧情已保存':current?.scope==='global'?'全局已保存':'无背景'}</p></section>`;}
// BFCache suspends, not destroys, this document. Preserve the exact source Blob URL.
window.addEventListener('pageshow',event=>{if(event.persisted&&current?.blob)draw();});
window.MimaChatWallpaper={onSession,pick,adjust,save,clear,deleteSaved,markup,exportRecords,previewRecordImport,importRecords};
})();
