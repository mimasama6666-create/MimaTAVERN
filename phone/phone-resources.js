/* Read-only source references; Phone never writes Mask, story History or Memory. */
(()=>{'use strict';
 const core=()=>{if(!window.MimaStandalone?.getPhoneResources)throw Error('剧情资源接口尚未初始化');return MimaStandalone;};
 function state(){const value=core().getPhoneResources();if(!value||!Array.isArray(value.masks))throw Error('剧情资源读取未验证，手机不能把失败当空角色库');return value;}
 function getMask(id){const x=state().masks.find(m=>m.id===id);if(!x||x.enabled===false)throw Error('该角色面具已禁用或缺失，不能用空人设代替');return x;}
 function listCharacterMasks(){return state().masks.filter(m=>m.type==='character'&&m.enabled!==false);}
 function listUserMasks(){return state().masks.filter(m=>m.type==='user'&&m.enabled!==false);}
 function getUserMask(id){const x=getMask(id);if(x.type!=='user')throw Error('选中资源不是 User 面具');return x;}
 function getCharMask(id){const x=getMask(id);if(x.type!=='character')throw Error('选中资源不是 Char 面具');return x;}
 function resolveApiConfig(){const cfg=core().getApiConfig();if(!cfg?.model||!cfg?.apiBase)throw Error('先在咪嘛馆设置有效的 API 地址与模型');return cfg;}
 function snapshotSelection({userMaskId,charMaskIds=[],presetIds=[],worldbookIds=[],visibleText=''}={}){
  const s=state();const users=userMaskId?getUserMask(userMaskId):null;
  const chars=charMaskIds.map(getCharMask);
  const presets=presetIds.map(id=>{const p=s.presets.find(x=>x.id===id&&x.enabled!==false);if(!p)throw Error('预设引用失效：'+id);return p;}).sort((a,b)=>(a.priority??50)-(b.priority??50));
  const worldbooks=worldbookIds.map(id=>{const w=s.worldbooks.find(x=>x.id===id&&x.enabled!==false);if(!w)throw Error('世界书引用失效：'+id);return w;});
  const lore=[];const lower=visibleText.toLowerCase();for(const book of worldbooks)for(const entry of book.entries||[]){if(entry.enabled===false)continue;
    const words=(entry.keywords||[]).map(String).filter(Boolean),matched=entry.alwaysActive||(words.length&&(entry.matchMode==='all'?words.every(k=>lower.includes(k.toLowerCase())):words.some(k=>lower.includes(k.toLowerCase()))));
    if(matched)lore.push({...entry,bookId:book.id});
  }
  lore.sort((a,b)=>(a.priority??50)-(b.priority??50));
  return {user:users,chars,presets,worldbooks,lore,sourceRevision:s.storeRevision,resourceUpdatedAt:new Date().toISOString()};
 }
 function resolveTheme(){return state().themeSettings||{};}
 window.MimaPhoneResources=Object.freeze({state,getMask,getCharMask,getUserMask,listCharacterMasks,listUserMasks,resolveApiConfig,snapshotSelection,resolveTheme});
})();
