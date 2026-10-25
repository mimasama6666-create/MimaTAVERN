/* Read-only source references; Phone never writes Mask, story History or Memory. */
(()=>{'use strict';
 const core=()=>{if(!window.MimaStandalone?.getPhoneResources)throw Error('剧情资源接口尚未初始化');return MimaStandalone;};
 function state(){const value=core().getPhoneResources();if(!value||!Array.isArray(value.masks))throw Error('剧情资源读取未验证，手机不能把失败当空角色库');return value;}
 function getMask(id){const x=state().masks.find(m=>m.id===id);if(!x||x.enabled===false)throw Error('该角色面具已禁用或缺失，不能用空人设代替');return x;}
 function listCharacterMasks(){return state().masks.filter(m=>m.type==='character'&&m.enabled!==false);}
 function listUserMasks(){return state().masks.filter(m=>m.type==='user'&&m.enabled!==false);}
 function getUserMask(id){const x=getMask(id);if(x.type!=='user')throw Error('选中资源不是 User 面具');return x;}
 function getCharMask(id){const x=getMask(id);if(x.type!=='character')throw Error('选中资源不是 Char 面具');return x;}
 function resolveApiConfig(phonePrefs){
   if(phonePrefs?.phoneApiMode==='custom'){
     // NEVER fill missing independent values from the story API. Independent means isolated.
     const custom=phonePrefs.phoneApi||{};
     if(!String(custom.apiBase||'').trim()||!String(custom.model||'').trim())throw Error('小手机独立 API 未设置地址或模型。请在「我的手机 → API 设置」填写，绝不自动切回剧情 API');
     const cfg={apiBase:String(custom.apiBase).trim(),apiKey:String(custom.apiKey||''),model:String(custom.model).trim(),
       chatEndpoint:String(custom.chatEndpoint||''),modelsEndpoint:String(custom.modelsEndpoint||''),extraHeaders:String(custom.extraHeaders||''),
       sendTemperature:custom.sendTemperature!==false,temperature:Number.isFinite(Number(custom.temperature))?Number(custom.temperature):0.85,
       stream:!!custom.stream,maxTokens:Number(custom.maxTokens)||0,contextWindowTokens:Math.max(0,Number(custom.contextWindowTokens)||0),
       continuationMode:custom.continuationMode||'assistant_tail',prefixReturnsSuffix:!!custom.prefixReturnsSuffix,thinkingMode:custom.thinkingMode||'normal',showThinking:custom.showThinking!==false,reasoningEffort:custom.reasoningEffort||'inherit',requestGeminiThoughts:!!custom.requestGeminiThoughts};
     // A custom phone's explicitly declared capacity belongs to its own endpoint/model.
     cfg.contextWindowIdentity=core().apiCapacityIdentity(cfg);
     cfg.modelCapacityProfiles=cfg.contextWindowTokens>=4096?{[cfg.contextWindowIdentity]:cfg.contextWindowTokens}:{};
     // Missing keys are valid only for users' local servers. Validation occurs in original provider transport.
     return cfg;
   }
   const cfg=core().getApiConfig();if(!cfg?.model||!cfg?.apiBase)throw Error('主剧情 API 未配置有效的地址与模型，请设置 API 或启用手机独立配置');
   // Optional PHONE-only transport override; never writes or mutates story API.
   const mode=phonePrefs?.phoneStreamOverride||'inherit';
   if(mode==='on'||mode==='off')return {...cfg,stream:mode==='on'};
   return cfg;
 }
 async function activateWorldbook(entries,messages){
   if(!entries.some(x=>x.useRegex)){
     return entries.map(entry=>{
       if(!entry||entry.enabled===false||!String(entry.content||'').trim())return false;
       if(entry.alwaysActive)return true;
       const hay=messages.slice(-Math.max(1,Math.trunc(Number(entry.scanDepth)||12))).join('\n');
       const matches=k=>{const key=String(k||'').trim();if(!key)return false;
         return entry.caseSensitive?hay.includes(key):hay.toLocaleLowerCase().includes(key.toLocaleLowerCase());};
       const primary=(entry.keywords||[]).filter(Boolean);if(!primary.length)return false;
       const ok=entry.matchMode==='all'?primary.every(matches):primary.some(matches);if(!ok)return false;
       const secondary=(entry.secondaryKeywords||[]).filter(Boolean);return secondary.length?secondary.some(matches):true;
     });
   }
   if(typeof Worker!=='function'||window.location?.protocol==='file:')throw Error('手机世界书正则必须使用独立 Worker。请从 HTTPS 页面打开；此回合没有发送未匹配的世界书。');
   const worker=new Worker(new URL('./phone/phone-worldbook-worker.js?v=20261025b',document.baseURI),{name:'mima-phone-worldbook'});
   return new Promise((resolve,reject)=>{
     let settled=false;
     const done=(err,data)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();err?reject(err):resolve(data);};
     const timer=setTimeout(()=>{const error=Error('手机世界书正则执行超出时间预算，Worker 已终止；原始世界书保持不变');error.code='E_REGEX_BUDGET';done(error);},900);
     worker.onmessage=e=>{if(!e.data?.ok)return done(Error('手机世界书匹配失败：'+(e.data?.error||'未知错误')));done(null,e.data.matched);};
     worker.onerror=e=>done(Error('手机世界书匹配 Worker 失败：'+(e.message||'未知错误')));
     worker.postMessage({entries,messages});
   });
 }
 async function snapshotSelection({userMaskId,charMaskIds=[],presetIds=[],worldbookIds=[],visibleText='',visibleMessages=null,worldbookBudgetChars=null}={}){
  const s=state();const users=userMaskId?getUserMask(userMaskId):null;
  const chars=charMaskIds.map(getCharMask);
  const presets=presetIds.map(id=>{const p=s.presets.find(x=>x.id===id&&x.enabled!==false);if(!p)throw Error('预设引用失效：'+id);return p;}).sort((a,b)=>(a.priority??50)-(b.priority??50));
  const worldbooks=worldbookIds.map(id=>{const w=s.worldbooks.find(x=>x.id===id&&x.enabled!==false);if(!w)throw Error('世界书引用失效：'+id);return w;});
  const entries=worldbooks.flatMap(book=>(book.entries||[]).map(entry=>({...entry,bookId:book.id})));
  const messages=Array.isArray(visibleMessages)?visibleMessages.map(x=>String(x||'')):[String(visibleText||'')];
  const matched=await activateWorldbook(entries,messages);
  const lore=entries.filter((_,i)=>matched[i]).sort((a,b)=>Number(a.depth||0)-Number(b.depth||0)||Number(a.priority??50)-Number(b.priority??50));
  // Never silently truncate originally selected entries or original phone history.
  if(Number.isFinite(Number(worldbookBudgetChars))&&Number(worldbookBudgetChars)>0){
    const total=lore.reduce((sum,e)=>sum+String(e.content||'').length,0);
    if(total>Number(worldbookBudgetChars))throw Error(`手机世界书激活正文 ${total} 字符，超过显式预算 ${worldbookBudgetChars}，请调整预算；原文完整保留。`);
  }
  return {user:users,chars,presets,worldbooks,lore,sourceRevision:s.storeRevision,resourceUpdatedAt:new Date().toISOString()};
 }
 function resolveTheme(){return state().themeSettings||{};}
 window.MimaPhoneResources=Object.freeze({state,getMask,getCharMask,getUserMask,listCharacterMasks,listUserMasks,resolveApiConfig,snapshotSelection,resolveTheme});
})();
