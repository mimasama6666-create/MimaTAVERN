/* Tab-local editing drafts. Canonical settings and story data stay independent. */
(()=>{'use strict';const prefix='MIMATAVERN_EDIT_DRAFT_V1:',memory=new Map(),timers=new Map(),failed=new Set();
 function get(key){if(memory.has(key))return memory.get(key);try{const raw=sessionStorage.getItem(prefix+key),value=raw?JSON.parse(raw):null;memory.set(key,value);return value;}catch(e){return null;}}
 function flush(key){clearTimeout(timers.get(key));timers.delete(key);const value=memory.get(key);try{if(value===null||value===undefined)sessionStorage.removeItem(prefix+key);else sessionStorage.setItem(prefix+key,JSON.stringify(value));failed.delete(key);return true;}catch(e){if(!failed.has(key)){failed.add(key);window.toast?.('草稿本页已保留，但未能写入浏览器；刷新前请保存。'+e.message);}document.dispatchEvent(new CustomEvent('mima-draft-status',{detail:{key,persisted:false,message:e.message}}));return false;}}
 function put(key,value,{immediate=false}={}){memory.set(key,value);clearTimeout(timers.get(key));if(immediate)flush(key);else timers.set(key,setTimeout(()=>flush(key),250));}
 function remove(key){clearTimeout(timers.get(key));timers.delete(key);memory.delete(key);try{sessionStorage.removeItem(prefix+key);}catch(_){}}
 function removeOwner(owner){const needle='settings:'+owner+':';for(const key of [...memory.keys()])if(key.startsWith(needle))remove(key);try{for(const raw of Object.keys(sessionStorage))if(raw.startsWith(prefix+needle))sessionStorage.removeItem(raw);}catch(_){}}
 window.addEventListener('pagehide',()=>{for(const key of timers.keys())flush(key);});
 window.MimaUiDrafts={get,put,flush,remove,removeOwner};
})();
