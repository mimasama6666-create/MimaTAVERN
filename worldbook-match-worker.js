/* Worldbook activation isolation: no user-defined RegExp executes on the UI thread. */
'use strict';
self.onmessage=event=>{
 try{
  const {entries=[],messages=[]}=event.data||{};
  if(!Array.isArray(entries)||!Array.isArray(messages)||entries.length>2000||messages.length>50000)throw Error('E_WORLDBOOK_INPUT_LIMIT: 世界书数量超出隔离预算');
  const out=[];
  for(const entry of entries){
   if(!entry||entry.enabled===false||!String(entry.content??'').trim()){out.push({active:false,reason:'disabled_or_empty'});continue;}
   if(entry.alwaysActive){out.push({active:true,reason:'always'});continue;}
   const depth=Math.max(1,Number(entry.scanDepth)||12);
   const hay=messages.slice(-depth).join('\n');
   if(hay.length>2*1024*1024)throw Error('E_WORLDBOOK_SCAN_LIMIT: 世界书扫描源过大，请调整扫描深度；没有裁剪剧情原文');
   const match=k=>{
    const keyword=String(k??'').trim();if(!keyword)return false;
    if(entry.useRegex){if(keyword.length>4096)throw Error('E_WORLDBOOK_PATTERN_LIMIT: 世界书正则表达式过长');return new RegExp(keyword,entry.caseSensitive?'u':'iu').test(hay);}
    return entry.caseSensitive?hay.includes(keyword):hay.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
   };
   const primary=Array.isArray(entry.keywords)?entry.keywords.filter(Boolean):[];
   const secondary=Array.isArray(entry.secondaryKeywords)?entry.secondaryKeywords.filter(Boolean):[];
   if(!primary.length){out.push({active:false,reason:'no_keyword'});continue;}
   const hits=primary.filter(match);
   if(!(entry.matchMode==='all'?hits.length===primary.length:hits.length>0)){out.push({active:false,reason:'primary_miss',hits});continue;}
   const secondaryHits=secondary.filter(match);
   if(secondary.length&&!secondaryHits.length){out.push({active:false,reason:'secondary_miss',hits,secondaryHits});continue;}
   out.push({active:true,reason:'keyword',hits,secondaryHits});
  }
  self.postMessage({ok:true,results:out});
 }catch(error){self.postMessage({ok:false,error:String(error?.message||error)});}
};
