/** MimaTAVERN v1.3.0 Novel narrative memory helpers. */
(() => {
  'use strict';
  const root=typeof window!=='undefined'?window:globalThis;
  const arr=v=>Array.isArray(v)?v:[];
  const clone=v=>JSON.parse(JSON.stringify(v));
  const clean=v=>String(v??'').trim();
  const nowIso=()=>new Date().toISOString();
  const stringList=v=>arr(v).map(clean).filter(Boolean);
  function normalizeObjectList(v){return arr(v).filter(x=>x&&typeof x==='object').map(x=>clone(x));}
  function normalizeSummary(s={}){return{overview:clean(s.overview),events:stringList(s.events),characterChanges:normalizeObjectList(s.characterChanges),revealedFacts:stringList(s.revealedFacts),openThreads:stringList(s.openThreads),foreshadowing:stringList(s.foreshadowing),endingState:clean(s.endingState),sourceRevision:Number(s.sourceRevision)||0,sourceHash:clean(s.sourceHash),generatedAt:s.generatedAt||''};}
  function normalizeState(s={}){return{storyOverview:clean(s.storyOverview),currentSituation:clean(s.currentSituation),characterStates:normalizeObjectList(s.characterStates),relationships:normalizeObjectList(s.relationships),timeline:stringList(s.timeline),openThreads:stringList(s.openThreads),foreshadowing:stringList(s.foreshadowing),revealedFacts:stringList(s.revealedFacts),locations:stringList(s.locations),lastUpdatedAt:s.lastUpdatedAt||'',sourceChapterRevisions:s.sourceChapterRevisions&&typeof s.sourceChapterRevisions==='object'?{...s.sourceChapterRevisions}:{},manualOverrides:s.manualOverrides&&typeof s.manualOverrides==='object'?clone(s.manualOverrides):{}};}
  function parsePayload(raw){if(raw&&typeof raw==='object')return raw;let s=String(raw||'').trim();s=s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');return JSON.parse(s);}
  function validateAnalysisPayload(raw){const p=parsePayload(raw);if(!p||typeof p!=='object')throw new Error('剧情分析不是 JSON 对象');const summary=normalizeSummary(p.summary||p.chapterSummary||{}),delta=p.delta&&typeof p.delta==='object'?p.delta:(p.narrativeDelta&&typeof p.narrativeDelta==='object'?p.narrativeDelta:{});if(!summary.overview&&!summary.events.length&&!summary.endingState)throw new Error('章节摘要缺少可用内容');return{summary,delta};}
  function uniqStrings(a,b){return[...new Set([...stringList(a),...stringList(b)])];}
  function objectKey(x,kind){if(kind==='relationship')return `${x.from||x.a||x.source||''}|${x.to||x.b||x.target||''}`;return String(x.name||x.character||x.characterName||x.id||JSON.stringify(x));}
  function mergeObjectList(oldList,newList,kind){const map=new Map;for(const x of [...normalizeObjectList(oldList),...normalizeObjectList(newList)]){const k=objectKey(x,kind);if(!k)continue;map.set(k,{...(map.get(k)||{}),...x});}return[...map.values()];}
  function mergeDelta(stateInput,delta={},chapter={}){const s=normalizeState(stateInput);if(delta.storyOverview)s.storyOverview=clean(delta.storyOverview);if(delta.currentSituation)s.currentSituation=clean(delta.currentSituation);s.characterStates=mergeObjectList(s.characterStates,delta.characterStates,'character');s.relationships=mergeObjectList(s.relationships,delta.relationships,'relationship');s.timeline=uniqStrings(s.timeline,delta.timeline);s.openThreads=uniqStrings(s.openThreads,delta.openThreads);s.foreshadowing=uniqStrings(s.foreshadowing,delta.foreshadowing);s.revealedFacts=uniqStrings(s.revealedFacts,delta.revealedFacts);s.locations=uniqStrings(s.locations,delta.locations);for(const closed of stringList(delta.closedThreads))s.openThreads=s.openThreads.filter(x=>x!==closed);for(const resolved of stringList(delta.resolvedForeshadowing))s.foreshadowing=s.foreshadowing.filter(x=>x!==resolved);if(chapter?.id)s.sourceChapterRevisions[chapter.id]=Number(chapter.revision)||0;s.lastUpdatedAt=nowIso();return applyManualPatch(s,s.manualOverrides);}
  // v1.3.1 stored some valid character/relationship/thread information only
  // in its global narrativeState. Capture it *once*, with the exact validated
  // source chapter/summary snapshots, before future edits mutate those records.
  // We cannot invent per-chapter deltas or blindly union this state after edits.
  function prepareLegacyCheckpoint(project){
    if(!project||Object.prototype.hasOwnProperty.call(project,'legacyNarrativeCheckpoint'))return project?.legacyNarrativeCheckpoint??null;
    const state=normalizeState(project.narrativeState);
    const useful=!!(state.storyOverview||state.currentSituation||['characterStates','relationships','timeline','openThreads','foreshadowing','revealedFacts','locations'].some(k=>state[k].length));
    if(!useful)return null;
    const chapters=[];
    for(const id of arr(project.chapterOrder)){
      const c=arr(project.chapters).find(x=>x.id===id);
      if(!c||c.summaryStatus!=='fresh'||isSummaryStale(c))break;
      // A new delta after this boundary must still run in sequence, rather
      // than being swallowed by an old aggregate snapshot.
      if(c.memoryDelta)break;
      chapters.push({id:c.id,revision:Number(c.revision),hash:String(c.summarySourceHash),summaryGeneratedAt:String(c.summary?.generatedAt||'')});
    }
    if(!chapters.length)return null;
    const revisions=state.sourceChapterRevisions;
    const outsideSources=Object.keys(revisions).some(id=>!chapters.some(x=>x.id===id));
    const anchored=!outsideSources&&chapters.every(x=>Number(revisions[x.id])===x.revision);
    // Explicit future chapter provenance is not just uncertainty: it would
    // leak spoiler state into the active timeline, so quarantine it entirely.
    return {kind:'legacy_narrative_checkpoint_v1',status:outsideSources?'quarantined':(anchored?'source_bound':'needs_review'),throughChapterId:chapters[chapters.length-1].id,sourceChapters:chapters,state:clone(state),capturedAt:nowIso()};
  }
  function legacyCheckpointStatus(project,activeChapterId){
    const checkpoint=project?.legacyNarrativeCheckpoint;
    if(!checkpoint||checkpoint.kind!=='legacy_narrative_checkpoint_v1'||!arr(checkpoint.sourceChapters).length)return 'none';
    const order=arr(project.chapterOrder),limit=activeChapterId?order.indexOf(activeChapterId):order.length-1;
    const end=order.indexOf(checkpoint.throughChapterId);
    if(limit<0||end<0||limit<end)return 'out_of_scope';
    for(const [index,source] of checkpoint.sourceChapters.entries()){
      const c=arr(project.chapters).find(x=>x.id===source.id);
      if(!c||c.summaryStatus!=='fresh'||isSummaryStale(c)
        ||Number(c.revision)!==source.revision
        ||String(c.summarySourceHash)!==source.hash
        ||String(c.summary?.generatedAt||'')!==source.summaryGeneratedAt
        ||order[index]!==source.id)return 'invalidated';
    }
    if(checkpoint.sourceChapters.length!==end+1)return 'invalidated';
    if(checkpoint.status==='quarantined')return 'invalidated';
    return checkpoint.status==='source_bound'?'verified_legacy':'needs_review';
  }
  // Reconstruct derived facts from chapter-scoped contributions, never union stale facts.
  // Manual overrides remain independent of chapter-derived facts.
  function deriveFromChapters(project,activeChapterId=null){
    const ids=arr(project.chapterOrder),limit=activeChapterId?ids.indexOf(activeChapterId):ids.length-1;
    let next=seedForRebuild(project.narrativeState);
    const legacyStatus=legacyCheckpointStatus(project,activeChapterId);
    // Unproven global legacy state may include material from future chapters.
    // It is an archive for human review, never a generation baseline.
    const legacyEnd=legacyStatus==='verified_legacy'?ids.indexOf(project.legacyNarrativeCheckpoint.throughChapterId):-1;
    if(legacyEnd>=0){
      next=normalizeState(project.legacyNarrativeCheckpoint.state);
      next.manualOverrides=normalizeState(project.narrativeState).manualOverrides;
      next=applyManualPatch(next,next.manualOverrides);
    }
    // Apply human-approved old notes at their verified chapter boundary,
    // BEFORE later chapter deltas. The next chapter can supersede an older
    // character state or close an earlier plot thread normally.
    const checkpoint=project.legacyNarrativeCheckpoint;
    const allowed=new Set(['storyOverview','currentSituation','characterStates','relationships','timeline','openThreads','foreshadowing','revealedFacts','locations']);
    for(const id of ids.slice(legacyEnd+1,Math.max(0,limit+1))){
      const chapter=arr(project.chapters).find(c=>c.id===id);
      if(!chapter||chapter.summaryStatus!=='fresh'||isSummaryStale(chapter))continue;
      // For pre-v1.3.2 valid summaries, preserve source-provenanced facts only.
      const delta=chapter.memoryDelta||{revealedFacts:chapter.summary?.revealedFacts||[],timeline:chapter.summary?.events||[]};
      next=mergeDelta(next,delta,chapter);
      if(legacyStatus!=='needs_review')continue;
      for(const review of arr(checkpoint?.reviews)){
        if(review?.chapterId!==id||!allowed.has(review?.field)
          ||Number(chapter.revision)!==Number(review.chapterRevision)
          ||root.MimaNovelEngine?.chapterHash?.(chapter)!==review.chapterHash
          ||String(chapter.summary?.generatedAt||'')!==String(review.summaryGeneratedAt||''))continue;
        const source=checkpoint.state?.[review.field];
        const value=Array.isArray(source)?source[review.index]:(review.index===0?source:undefined);
        if(value===undefined)continue;
        const reviewedDelta={};reviewedDelta[review.field]=Array.isArray(source)?[clone(value)]:clone(value);
        next=mergeDelta(next,reviewedDelta,chapter);
      }
    }
    return next;
  }
  function isSummaryStale(chapter){if(!chapter)return true;const text=root.MimaNovelEngine?.getChapterText?.(chapter)||'';const hash=root.MimaNovelEngine?.hashText?.(text)||'';return !chapter.summarySourceRevision||Number(chapter.summarySourceRevision)!==Number(chapter.revision)||String(chapter.summarySourceHash||'')!==String(hash);}
  function invalidateFromChapter(project,chapterId){const idx=project.chapterOrder.indexOf(chapterId);if(idx<0)return project;for(let i=idx;i<project.chapterOrder.length;i++){const c=project.chapters.find(x=>x.id===project.chapterOrder[i]);if(c&&root.MimaNovelEngine?.getChapterText?.(c)?.trim())c.summaryStatus='stale';}project.memoryStatus={status:'stale',error:'',updatedAt:nowIso()};return project;}
  function applyManualPatch(stateInput,patch={}){const s=normalizeState(stateInput),p=patch&&typeof patch==='object'?patch:{};s.manualOverrides=clone(p);for(const key of ['storyOverview','currentSituation'])if(Object.prototype.hasOwnProperty.call(p,key))s[key]=clean(p[key]);for(const key of ['timeline','openThreads','foreshadowing','revealedFacts','locations'])if(Object.prototype.hasOwnProperty.call(p,key))s[key]=stringList(p[key]);for(const key of ['characterStates','relationships'])if(Object.prototype.hasOwnProperty.call(p,key))s[key]=normalizeObjectList(p[key]);return s;}
  function seedForRebuild(input={}){const s=normalizeState(input);return applyManualPatch(normalizeState({manualOverrides:s.manualOverrides}),s.manualOverrides);}
  root.MimaNovelMemory={normalizeSummary,normalizeState,validateAnalysisPayload,mergeDelta,deriveFromChapters,isSummaryStale,invalidateFromChapter,applyManualPatch,seedForRebuild,prepareLegacyCheckpoint,legacyCheckpointStatus};
})();
