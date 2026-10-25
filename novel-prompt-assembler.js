/** MimaTAVERN v1.3.0 Novel-only prompt assembler. */
(() => {
  'use strict';
  const root=typeof window!=='undefined'?window:globalThis;
  const arr=v=>Array.isArray(v)?v:[];
  const clean=v=>String(v??'').trim();
  const clip=(s,n)=>{const t=clean(s);return n>0&&t.length>n?t.slice(-n):t};
  const estimateTokens=t=>Math.ceil(String(t||'').length/2.5);
  function keywordMatch(hay,keyword,entry={}){const k=clean(keyword);if(!k)return false;if(entry.useRegex)throw Error('E_WORLDBOOK_ASYNC_REQUIRED: 请使用隔离世界书匹配');const a=entry.caseSensitive?String(hay):String(hay).toLocaleLowerCase(),b=entry.caseSensitive?k:k.toLocaleLowerCase();return a.includes(b);}
  async function selectWorldbook(project,worldbooks,directorNote='',signal=null){
    const engine=root.MimaNovelEngine,chapters=engine.orderedChapters(project),activeIndex=Math.max(0,chapters.findIndex(c=>c.id===project.activeChapterId)),past=chapters.slice(0,activeIndex+1);
    // Scan depth counts chronology of CHAPTERS, not fragments. The director
    // instruction belongs to the current chapter's active turn and cannot
    // displace its prose at scanDepth=1. A chapter's fresh overview and
    // original prose share one depth slot; older chapters never leap the limit.
    // This only affects activation matching, not stored history or the Prompt.
    const selection=JSON.parse(JSON.stringify(arr(worldbooks).filter(w=>project.worldbookIds.includes(w.id)&&w.enabled!==false)));
    const rows=selection.flatMap(book=>arr(book.entries).map(entry=>({book,entry})));
    // Match the actual activation scanDepth contract (1..200). Never throw
    // away older chapters before the isolated matcher receives them.
    const requiredDepth=rows.filter(x=>x.entry.enabled!==false&&!!String(x.entry.content??'').trim()&&!x.entry.alwaysActive)
      .reduce((max,x)=>Math.max(max,Math.max(1,Math.min(200,Number(x.entry.scanDepth)||12))),1);
    const scanMessages=[];
    for(const chapter of past.slice(-requiredDepth)){
      const parts=[];
      if(chapter.summaryStatus==='fresh'&&!root.MimaNovelMemory?.isSummaryStale?.(chapter)){
        const overview=String(chapter.summary?.overview??'');
        if(overview.trim())parts.push(overview);
      }
      const body=String(engine.getChapterText(chapter)??'');
      if(body.trim())parts.push(body);
      if(chapter.id===past[past.length-1]?.id&&String(directorNote??'').trim())parts.push(String(directorNote));
      // Keep even empty chapters as depth positions. Otherwise an old chapter
      // could silently move inside a shallow scan when a newer one is blank.
      scanMessages.push(parts.join('\n\n'));
    }
    if(!scanMessages.length&&String(directorNote??'').trim())scanMessages.push(String(directorNote));
    // Full-size packet checks and regex timeout are enforced by
    // MimaWorldbookMatcher. An oversized scan must fail loudly; never silently
    // shorten History or the worldbook's requested depth.
    const signature=JSON.stringify(selection),projectSignature=JSON.stringify(project);
    if(!root.MimaWorldbookMatcher?.evaluate)throw Error('E_WORLDBOOK_ISOLATION_UNAVAILABLE: 小说世界书匹配模块未加载');
    const results=await root.MimaWorldbookMatcher.evaluate(rows.map(x=>x.entry),scanMessages,{signal});
    if(JSON.stringify(arr(worldbooks).filter(w=>project.worldbookIds.includes(w.id)&&w.enabled!==false))!==signature||JSON.stringify(project)!==projectSignature)throw Error('E_NOVEL_WORLDBOOK_CHANGED: 小说匹配来源在执行中被修改，拒绝使用旧结果');
    const selected=[],skipped=[];
    rows.forEach((item,i)=>{const match=results[i],row={...item,reason:match.reason,hits:match.hits||[]};(match.active?selected:skipped).push(row);});
    selected.sort((a,b)=>Number(a.entry.priority??50)-Number(b.entry.priority??50));return{selected,skipped};
  }
  function formatSummary(c){const s=c.summary||{};const bits=[`【${c.title}】`,s.overview,s.events?.length?`事件：${s.events.join('；')}`:'',s.revealedFacts?.length?`已揭示：${s.revealedFacts.join('；')}`:'',s.openThreads?.length?`未完成：${s.openThreads.join('；')}`:'',s.endingState?`结尾状态：${s.endingState}`:''].filter(Boolean);return bits.join('\n');}
  function formatNarrativeState(state={}){const rows=[];if(state.storyOverview)rows.push(`故事概括：${state.storyOverview}`);if(state.currentSituation)rows.push(`当前剧情：${state.currentSituation}`);for(const [label,key] of [['人物状态','characterStates'],['人物关系','relationships'],['时间线','timeline'],['进行中剧情线','openThreads'],['伏笔','foreshadowing'],['已揭示事实','revealedFacts'],['地点','locations']]){const value=state[key];if(Array.isArray(value)&&value.length)rows.push(`${label}：\n${value.map(x=>`- ${typeof x==='string'?x:JSON.stringify(x)}`).join('\n')}`);}return rows.join('\n\n');}
  async function assemble({project:projectInput,presets=[],worldbooks=[],directorNote='',mode='continue',draftText='',minimumChars=null,masks=[],signal=null}){
    const engine=root.MimaNovelEngine,memory=root.MimaNovelMemory,project=engine.normalizeProject(projectInput),chapters=engine.orderedChapters(project),active=engine.getChapter(project,project.activeChapterId)||chapters[chapters.length-1];if(!active)throw new Error('小说没有可续写章节');
    const sections=[],messages=[],maskList=arr(masks);
    const macroNames={userName:maskList.find(x=>x.id===project.macroUserMaskId)?.name||'',charName:maskList.find(x=>x.id===project.macroCharMaskId)?.name||''};
    const resolveText=source=>{const input=String(source??'');
      if(/{{\s*user\s*}}/i.test(input)&&!macroNames.userName)throw new Error('小说 Prompt 含 {{user}}，请在小说设置中选择本项目的 User 面具；未发送请求');
      if(/{{\s*char\s*}}/i.test(input)&&!macroNames.charName)throw new Error('小说 Prompt 含 {{char}}，请在小说设置中选择本项目的 Char 面具；未发送请求');
      return root.MimaPersonaMacroResolver?.resolve?root.MimaPersonaMacroResolver.resolve(input,macroNames):input.replace(/{{\s*user\s*}}/gi,macroNames.userName).replace(/{{\s*char\s*}}/gi,macroNames.charName);
    };
    const add=(name,role,content)=>{const text=clean(resolveText(content));if(!text)return;sections.push({name,chars:text.length});messages.push({role,content:text});};
    const mountedPresets=arr(presets).filter(p=>project.presetIds.includes(p.id)&&p.enabled!==false).sort((a,b)=>Number(a.priority??50)-Number(b.priority??50));if(mountedPresets.length)add('presets','system',`【文风 / Preset】\n${mountedPresets.map(p=>`【${p.name}】\n${p.content}`).join('\n\n')}`);
    const wb=await selectWorldbook(project,worldbooks,directorNote,signal);if(wb.selected.length)add('worldbook','system',`【相关 Worldbook】\n${wb.selected.map(x=>`【${x.book.name} / ${x.entry.name}】\n${x.entry.content}`).join('\n\n')}`);
    const memoryStatus=project.memoryStatus?.status||'missing',legacyStatus=memory?.legacyCheckpointStatus?.(project,active.id)||'none',timelineState=memory?.deriveFromChapters?.(project,active.id)||project.narrativeState,stateText=formatNarrativeState(timelineState);if(stateText)add('narrative_state','system',`${legacyStatus==='needs_review'?'【旧版剧情档案 · 待核查：历史全局状态缺少逐章来源，缺少原始来源】\n':legacyStatus==='verified_legacy'?'【旧版剧情档案 · 已匹配章节来源快照】\n':''}${memoryStatus==='degraded'?'【Canonical 剧情档案 · DEGRADED：可能缺少最近变化】':memoryStatus==='missing'?'【Canonical 剧情档案 · PARTIAL：尚未覆盖全部章节】':'【Canonical 剧情档案】'}\n${stateText}`);
    const activeIndex=Math.max(0,chapters.findIndex(c=>c.id===active.id));const freshSummaries=chapters.slice(0,activeIndex).filter(c=>c.summary&&c.summaryStatus==='fresh'&&!(memory?.isSummaryStale?.(c)));if(freshSummaries.length)add('chapter_summaries','system',`【历史章节概括】\n${freshSummaries.map(formatSummary).join('\n\n')}`);
    const budget=Math.max(4000,Number(project.generationSettings?.contextBudgetChars)||48000);
    const noteText=directorNote?clean(resolveText(`【本轮续写要求 / Director Note】\n${directorNote}`)):'';
    const tailText=mode==='append'&&draftText?clean(resolveText(draftText)):'';
    const reserved=messages.reduce((n,m)=>n+m.content.length,0)+noteText.length+tailText.length;
    if(reserved>budget)throw new Error(`小说总上下文上限为 ${budget} 字，但完整预设/世界书/剧情档案及本轮要求已占 ${reserved} 字。未裁剪这些资料，请增大小说项目的总上下文预算或手动调整挂载。`);
    let remaining=budget-reserved-('【已发生正文】\n'.length),raw=[];
    for(let i=activeIndex;i>=0&&remaining>0;i--){const c=chapters[i],body=engine.getChapterText(c);if(!body)continue;
      const head=`【${c.title}${i===activeIndex?' · 当前章节':''}】\n`,separator=raw.length?2:0,available=remaining-head.length-separator;
      if(available<=0)break;
      const take=body.slice(-available);raw.unshift(head+take);remaining-=head.length+take.length+separator;
      if(take.length<body.length)break;
    }
    if(!raw.length&&chapters.slice(0,activeIndex+1).some(c=>engine.getChapterText(c)))throw new Error('小说总上下文预算已被挂载内容占满，无法容纳最新正文；请增大总预算。本轮没有发送请求。');
    if(raw.length)add('recent_prose','user',`【已发生正文】\n${raw.join('\n\n')}`);
    if(noteText)add('director_note','system',noteText);
    if(tailText)add('draft_tail','assistant',tailText);
    const totalChars=messages.reduce((n,m)=>n+m.content.length,0);
    if(totalChars>budget)throw new Error(`小说请求超出总字符预算：实际 ${totalChars} / ${budget}；未发送请求`);
    return{messages,inspector:{sections,totalSentChars:totalChars,originalProseChars:chapters.slice(0,activeIndex+1).reduce((n,c)=>n+engine.getChapterText(c).length,0),selectedWorldbookEntries:wb.selected.map(x=>({bookId:x.book.id,bookName:x.book.name,entryId:x.entry.id,entryName:x.entry.name,reason:x.reason})),skippedWorldbookEntries:wb.skipped.map(x=>({bookId:x.book.id,entryId:x.entry.id,reason:x.reason})),estimatedInputTokens:estimateTokens(messages.map(m=>m.content).join('\n')),contextBudgetChars:budget,activeChapterId:active.id,activeChapterTitle:active.title,summarySources:freshSummaries.map(c=>({id:c.id,title:c.title,revision:c.revision})),memoryStatus,legacyCheckpointStatus:legacyStatus,memoryExcludedAsStale:legacyStatus==='invalidated',messagePreview:messages.map((m,index)=>({index,role:m.role,content:m.content}))}};
  }
  root.MimaNovelPromptAssembler={assemble,selectWorldbook,formatNarrativeState};
})();
