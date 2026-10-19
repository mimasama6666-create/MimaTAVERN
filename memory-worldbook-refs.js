/* MIMA memory references — authoritative composite worldbook identity resolver. */
(()=>{'use strict';
  if(window.MimaWorldbookRefs?.resolveSelectedWorldbookRefs)return;
  function resolveSelectedWorldbookRefs({bookIds=[],books=[],scopedRefs=[],legacyIds=[]}={}){
    const eligibleIds=new Set(bookIds.filter(x=>typeof x==='string'&&x));
    const index=new Map((Array.isArray(books)?books:[]).filter(b=>b&&eligibleIds.has(b.id)).map(b=>[b.id,b]));
    const resolved=new Set(),scopedIds=new Set();
    for(const ref of Array.isArray(scopedRefs)?scopedRefs:[]){
      const bookId=Array.isArray(ref)?ref[0]:ref?.bookId,entryId=Array.isArray(ref)?ref[1]:ref?.entryId;
      if(typeof bookId!=='string'||typeof entryId!=='string'||!bookId||!entryId)throw Error('E_MEMORY_REFERENCE_INVALID_SCOPED');
      if(!index.has(bookId)||!index.get(bookId)?.entries?.some(e=>e?.id===entryId))throw Error('E_MEMORY_REFERENCE_MISSING:'+bookId+'/'+entryId);
      resolved.add(JSON.stringify([bookId,entryId]));scopedIds.add(entryId);
    }
    for(const entryId of new Set(Array.isArray(legacyIds)?legacyIds:[])){
      if(typeof entryId!=='string'||!entryId)continue;
      // A composite selection overrides the redundant legacy unscoped alias.
      if(scopedIds.has(entryId))continue;
      const hits=[];
      for(const book of index.values())for(const entry of book.entries||[])if(entry?.id===entryId)hits.push([book.id,entryId]);
      if(hits.length!==1)throw Error(hits.length?'E_MEMORY_REFERENCE_AMBIGUOUS:'+entryId:'E_MEMORY_REFERENCE_MISSING:'+entryId);
      resolved.add(JSON.stringify(hits[0]));
    }
    // Canonical order is independent from settings insertion order and duplicate aliases.
    return [...resolved].map(v=>JSON.parse(v)).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  }
  // Memory generation and durable store MUST share this one activation rule.
  // No additional matched state is persisted: the canonical session History is
  // re-evaluated at settlement. Unmatched edits do not perturb the contract,
  // while an activation change or a matched resource edit does.
  function keywordMatches(hay,keyword,entry){
    const k=String(keyword||'').trim();if(!k)return false;
    if(entry.useRegex){try{return new RegExp(k,entry.caseSensitive?'u':'iu').test(String(hay||''));}catch(_){return false;}}
    const a=entry.caseSensitive?String(hay||''):String(hay||'').toLocaleLowerCase();
    const b=entry.caseSensitive?k:k.toLocaleLowerCase();return a.includes(b);
  }
  function isActive(entry,messages){
    if(!entry||entry.enabled===false||!String(entry.content||'').trim())return false;
    if(entry.alwaysActive)return true;
    const depth=Math.max(1,Number(entry.scanDepth||12));
    const hay=(Array.isArray(messages)?messages:[]).filter(m=>m?.content&&m.role!=='system'&&m.role!=='director')
      .slice(-depth).map(m=>m.content).join('\n');
    const primary=(Array.isArray(entry.keywords)?entry.keywords:[]).filter(Boolean);
    const secondary=(Array.isArray(entry.secondaryKeywords)?entry.secondaryKeywords:[]).filter(Boolean);
    if(!primary.length)return false;
    const hits=primary.filter(k=>keywordMatches(hay,k,entry));
    if(!(entry.matchMode==='all'?hits.length===primary.length:hits.length>0))return false;
    return !secondary.length||secondary.some(k=>keywordMatches(hay,k,entry));
  }
  function resolveMatchedWorldbookRefs({bookIds=[],books=[],messages=[]}={}){
    const booksById=new Map((Array.isArray(books)?books:[]).filter(b=>b&&typeof b.id==='string').map(b=>[b.id,b]));
    const result=[];
    for(const id of bookIds){
      const book=booksById.get(id);
      if(!book||book.enabled===false)throw Error('E_MEMORY_REFERENCE_MISSING:worldbook:'+id);
      for(const entry of Array.isArray(book.entries)?book.entries:[]){
        if(isActive(entry,messages))result.push([id,entry.id]);
      }
    }
    return result;
  }
  Object.defineProperty(window,'MimaWorldbookRefs',{value:Object.freeze({resolveSelectedWorldbookRefs,resolveMatchedWorldbookRefs}),writable:false,configurable:false});
})();
