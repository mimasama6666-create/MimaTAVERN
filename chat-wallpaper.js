/* MIMA Chat Wallpaper R4: opt-in Blob persistence. No theme/History writes. */
(()=>{'use strict';
const DB='mima-chat-wallpaper-v1',STORE='wallpapers';
let sessionId=null,current=null,url=null,seq=0,dbTask=null;
const defaults=()=>({fit:'cover',focusX:50,focusY:50,mask:24,blur:0});
const safeOpts=v=>({fit:v?.fit==='contain'?'contain':'cover',focusX:limit(v?.focusX,0,100,50),focusY:limit(v?.focusY,0,100,50),mask:limit(v?.mask,0,95,24),blur:limit(v?.blur,0,30,0)});
function limit(x,a,b,f){x=Number(x);return Number.isFinite(x)?Math.min(b,Math.max(a,x)):f;}
function database(){return dbTask||(dbTask=new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||Error('背景图数据库打开失败'));q.onblocked=()=>reject(Error('背景数据库被其他页面占用'));}).catch(e=>{dbTask=null;throw e}));}
async function read(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);tx.onerror=()=>reject(tx.error);});}
async function write(key,record){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('背景保存被取消'));tx.onerror=()=>reject(tx.error);});}
async function remove(key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('背景删除被取消'));tx.onerror=()=>reject(tx.error);});}
function msg(s){const e=document.getElementById('mima-wallpaper-message');if(e)e.textContent=s;else console.info('[ChatWallpaper]',s);}
function eraseURL(){if(url){URL.revokeObjectURL(url);url=null;}}
function draw(){const box=document.getElementById('story-chat-box');if(!box)return;
 if(!current?.blob){box.removeAttribute('data-mima-chat-wallpaper');for(const k of ['--mima-wallpaper-image','--mima-wallpaper-size','--mima-wallpaper-position','--mima-wallpaper-mask','--mima-wallpaper-blur'])box.style.removeProperty(k);return;}
 if(!url)url=URL.createObjectURL(current.blob);const o=safeOpts(current.opts);box.setAttribute('data-mima-chat-wallpaper','1');box.style.setProperty('--mima-wallpaper-image',`url("${url}")`);box.style.setProperty('--mima-wallpaper-size',o.fit);box.style.setProperty('--mima-wallpaper-position',`${o.focusX}% ${o.focusY}%`);box.style.setProperty('--mima-wallpaper-mask',String(o.mask/100));box.style.setProperty('--mima-wallpaper-blur',o.blur+'px');
}
function replace(record){eraseURL();current=record;if(!record){const picker=document.getElementById('mima-wallpaper-file');if(picker)picker.value='';}draw();}
async function onSession(id){if(sessionId===id&&current)return;sessionId=id||null;const step=++seq;replace(null);if(!id)return;
 try{const found=await read('session:'+id)||await read('global');if(step!==seq||id!==sessionId)return;if(found?.blob instanceof Blob)replace({blob:found.blob,opts:safeOpts(found.opts),scope:found.scope});}
 catch(e){console.error('[ChatWallpaper] read unavailable, canonical wallpaper unchanged',e);msg('已保存背景读取失败；没有覆盖原有数据：'+e.message);}}
async function pick(file){if(!file)return;if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){msg('仅支持 PNG、JPEG、WebP、GIF');return;}if(file.size>10*1024*1024){msg('图片超过 10 MB，请先压缩；未保存任何数据');return;}
 // Default is always temporary even if the previous wallpaper was saved.
 replace({blob:file,opts:defaults(),scope:'temporary'});msg('临时聊天背景已显示；没有保存到浏览器数据库。');}
function adjust(key,value){if(!current){msg('请先选择背景图');return;}if(!['fit','focusX','focusY','mask','blur'].includes(key))return;current.opts=safeOpts({...current.opts,[key]:value});draw();}
async function save(scope){if(!current?.blob){msg('请先选择或载入一张背景图');return;}if(!['session','global'].includes(scope)){msg('默认临时背景无需保存，切换剧情会释放图片。');return;}if(scope==='session'&&!sessionId){msg('当前没有剧情，不能保存会话背景');return;}
 const key=scope==='global'?'global':'session:'+sessionId;
 try{await write(key,{blob:current.blob,opts:safeOpts(current.opts),scope,updatedAt:Date.now()});current.scope=scope;msg(scope==='global'?'全局聊天背景已保存。':'当前剧情背景已保存。');}
 catch(e){console.error('[ChatWallpaper] failed to save',e);msg('保存失败：'+e.message+'（临时背景仍在，旧记录未更改）');}}
function clear(){++seq;replace(null);msg('已退出当前背景显示；已保存的图片没有被删除。');}
async function deleteSaved(scope){if(!['session','global'].includes(scope))return;if(scope==='session'&&!sessionId)return msg('当前没有剧情');if(!confirm('确定只删除此范围保存的聊天背景？不会删除主题、聊天记录或其他背景。'))return;
 const key=scope==='global'?'global':'session:'+sessionId;
 try{await remove(key);await onSessionReload();msg('指定范围的已保存背景已删除，其他素材未动。');}catch(e){console.error('[ChatWallpaper] delete failed',e);msg('删除失败；没有覆盖原数据：'+e.message);}}
async function onSessionReload(){const s=sessionId;sessionId=null;await onSession(s);}
function markup(){const o=safeOpts(current?.opts);return `<section class="settings-section"><h3>🖼️ 自定义聊天背景</h3><p class="helper">只作用于当前剧情聊天区域，不改变角色卡 HTML、原始对话或工坊主题。导入后默认临时显示，<strong>不会自动保存</strong>；切换剧情或关闭页面会释放临时图片。显示期间仍需要占用图片内存。</p><input id="mima-wallpaper-file" class="field" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="MimaChatWallpaper.pick(this.files[0])"><div class="form-grid"><div><label class="form-label">填充方式</label><select class="field" onchange="MimaChatWallpaper.adjust('fit',this.value)"><option ${o.fit==='cover'?'selected':''} value="cover">铺满裁剪</option><option ${o.fit==='contain'?'selected':''} value="contain">完整显示</option></select></div><div><label class="form-label">遮罩浓度：${o.mask}%</label><input class="field" type="range" min="0" max="95" value="${o.mask}" oninput="MimaChatWallpaper.adjust('mask',this.value)"></div><div><label class="form-label">图片焦点 X</label><input class="field" type="range" min="0" max="100" value="${o.focusX}" oninput="MimaChatWallpaper.adjust('focusX',this.value)"></div><div><label class="form-label">图片焦点 Y</label><input class="field" type="range" min="0" max="100" value="${o.focusY}" oninput="MimaChatWallpaper.adjust('focusY',this.value)"></div><div><label class="form-label">背景模糊</label><input class="field" type="range" min="0" max="30" value="${o.blur}" oninput="MimaChatWallpaper.adjust('blur',this.value)"></div></div><div class="toolbar"><button class="ghost-btn" onclick="MimaChatWallpaper.clear()">退出背景显示</button><button class="primary-btn" onclick="MimaChatWallpaper.save('session')">明确保存到当前剧情</button><button class="ghost-btn" onclick="MimaChatWallpaper.save('global')">明确保存到全局</button></div><div class="toolbar"><button class="ghost-btn" onclick="MimaChatWallpaper.deleteSaved('session')">删除当前剧情已保存背景</button><button class="ghost-btn" onclick="MimaChatWallpaper.deleteSaved('global')">删除全局已保存背景</button></div><p id="mima-wallpaper-message" class="helper" role="status">当前显示：${current?.scope==='temporary'?'临时（未保存）':current?.scope==='session'?'当前剧情已保存':current?.scope==='global'?'全局已保存':'无背景'}</p></section>`;}
window.addEventListener('pagehide',()=>{eraseURL();current=null;});
window.MimaChatWallpaper={onSession,pick,adjust,save,clear,deleteSaved,markup};
})();
