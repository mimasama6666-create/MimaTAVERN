/* Killable regex/worldbook matcher for phone prompts; never a main-thread RegExp. */
'use strict';
self.onmessage=event=>{
 try {
  const {entries=[],messages=[]}=event.data||{};
  if(entries.length>1200||messages.length>6000)throw Error('手机世界书输入数量超出本轮安全预算');
  const matched=entries.map(entry=>{
   if(!entry||entry.enabled===false||!String(entry.content||'').trim())return false;
   if(entry.alwaysActive)return true;
   const depth=Math.max(1,Math.trunc(Number(entry.scanDepth)||12));
   const hay=messages.slice(-depth).join('\n');
   if(hay.length>1024*1024)throw Error('手机世界书正则扫描文本超过 1MiB，原文未被裁剪，请手动减少扫描范围');
   const match=keyword=>{
    const k=String(keyword??'').trim();if(!k)return false;
    if(entry.useRegex){if(k.length>4096)throw Error('手机世界书正则过长');return new RegExp(k,entry.caseSensitive?'u':'iu').test(hay);}
    return entry.caseSensitive?hay.includes(k):hay.toLocaleLowerCase().includes(k.toLocaleLowerCase());
   };
   const keywords=Array.isArray(entry.keywords)?entry.keywords.filter(Boolean):[];
   if(!keywords.length)return false;
   const primary=entry.matchMode==='all'?keywords.every(match):keywords.some(match);
   if(!primary)return false;
   const secondary=Array.isArray(entry.secondaryKeywords)?entry.secondaryKeywords.filter(Boolean):[];
   return secondary.length?secondary.some(match):true;
  });
  self.postMessage({ok:true,matched});
 }catch(e){self.postMessage({ok:false,error:String(e?.message||e)});}
};
