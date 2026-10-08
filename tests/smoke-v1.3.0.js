/** MimaTAVERN v1.3.0 Novel Studio integrated smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');
const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const studio=fs.readFileSync(path.join(ROOT,'novel-studio.js'),'utf8');

assert(html.includes('release=1.3.1'),'v1.3.1 release marker missing');
for(const f of ['theme-engine.js','novel-memory.js','novel-engine.js','novel-prompt-assembler.js','novel-studio.js'])assert(html.includes(`./${f}?v=1.3.1`),`${f} cache marker missing`);
for(const old of ['./standalone-core.js?v=1.1.0&release=1.3.1','./app.js?v=1.1.2&release=1.3.1','./assistant-studio.js?v=1.1.2&hotfix=1.1.3&release=1.3.1'])assert(html.includes(old),`legacy component version contract changed: ${old}`);
const scripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(x=>x[1]);
const pos=n=>scripts.findIndex(x=>x.includes(n));
assert(pos('theme-engine.js')<pos('standalone-core.js'),'theme must load before core');
assert(pos('novel-memory.js')<pos('standalone-core.js')&&pos('novel-engine.js')<pos('standalone-core.js')&&pos('novel-prompt-assembler.js')<pos('standalone-core.js'),'Novel helpers must load before core');
assert(pos('standalone-core.js')<pos('novel-studio.js'),'Novel UI must load after core');
assert(html.includes('aria-label="小说续写"')&&html.includes('id="novel-studio-root"'),'Novel UI entry/surface missing');
assert(css.includes('[data-mima-theme="midnight"]')&&css.includes('[data-mima-theme="eink"]')&&css.includes('[data-mima-theme="paper"]'),'built-in themes missing');
assert(css.includes('.novel-studio-root')&&css.includes('.novel-reader')&&css.includes('.novel-memory-card'),'stable Novel CSS selectors missing');
assert(css.includes('grid-template-columns:auto minmax(0,1fr) auto'),'chapter navigation alignment regression');
assert(studio.includes("mobileTab='memory';render()"),'Prompt preview must reveal inspector');
assert(studio.includes('function formatMemoryObject(value)'),'structured memory readability helper missing');
assert(studio.includes('novel-inspector-tabs'),'desktop Novel inspector/settings navigation missing');
assert(studio.includes('function continueDraft(')&&studio.includes('/drafts/${d.id}/continue'),'manual Draft resume UI missing');
assert(studio.includes('Max Output Tokens')&&studio.includes('Temperature 参数策略')&&studio.includes('项目标题'),'Novel settings controls incomplete');
assert(studio.includes("compileCustomCss?.(css,'novel')"),'Novel project CSS is not constrained through the Novel scope compiler');
assert(app.includes("appearancePreviewSurface = 'chat'")&&app.includes("appearancePreviewSurface==='novel'")&&app.includes('第二段 Safe HTML 正文'),'multi-surface preview or legacy Safe HTML preview missing');

// Browser-global harness.
global.window=global;
const local=new Map();
global.localStorage={getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
let storedState={schemaVersion:3,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[]};
global.MimaLocalStore={async loadState(){return JSON.parse(JSON.stringify(storedState))},async saveState(v){storedState=JSON.parse(JSON.stringify(v));return storedState}};
require(path.join(ROOT,'theme-engine.js'));
require(path.join(ROOT,'regex-engine.js'));
require(path.join(ROOT,'novel-memory.js'));
require(path.join(ROOT,'novel-engine.js'));
require(path.join(ROOT,'novel-prompt-assembler.js'));
require(path.join(ROOT,'standalone-core.js'));

(async()=>{
  await MimaStandalone.init();
  let state=MimaStandalone.getState();
  assert.strictEqual(state.schemaVersion,4,'v3 -> v4 migration failed');
  assert.deepStrictEqual(state.novelProjects,[],'migration must not invent projects');
  assert.strictEqual(state.themeSettings.theme,'default','migration default theme wrong');

  // Pure parser + source snapshot.
  const parsed=MimaNovelEngine.parseChapters('第一章 雨夜\n甲。\n\n第二章 钟声\n乙。');
  assert.strictEqual(parsed.length,2,'Chinese chapter heading detection failed');
  assert.strictEqual(MimaNovelEngine.parseChapters('第一章雨夜\n甲。\n第二章钟声\n乙。').length,2,'Chinese heading without whitespace failed');
  assert.strictEqual(MimaNovelEngine.parseChapters('Chapter 1 Arrival\nA\nChapter 2 Night\nB').length,2,'English headings failed');
  assert.strictEqual(MimaNovelEngine.parseChapters('没有章节标题\n正文')[0].title,'正文','no-heading fallback failed');

  let imported=await MimaStandalone.handle('/novels/import','POST',{title:'测试小说',sourceName:'test.txt',sourceEncoding:'utf-8',text:'第一章 雨夜\n她收到一封红色信件。\n\n第二章 钟声\n午夜十二点，旧城钟楼响起钟声。'});
  assert(imported.success,'TXT import route failed');
  const id=imported.data.id;
  assert.strictEqual(imported.data.chapterOrder.length,2,'import chapter count wrong');
  assert(imported.data.sourceText.includes('红色信件'),'immutable source snapshot missing');
  assert.strictEqual(imported.data.activeChapterId,imported.data.chapterOrder[1],'import should open final chapter');
  assert.strictEqual(imported.data.generationSettings.maxAppendAttempts,3,'default append attempt bound must be finite');

  const first=imported.data.chapterOrder[0],sourceBefore=imported.data.sourceText;

  // Add reusable assets and mount them.
  let preset=await MimaStandalone.handle('/presets','POST',{name:'严肃文学',content:'克制、具体、避免俗套。'});
  let wb=await MimaStandalone.handle('/worldbooks','POST',{name:'钟楼设定',entries:[{name:'旧城钟楼',content:'钟楼内部为石砌结构。',keywords:['钟楼'],enabled:true}]});
  assert(preset.success&&wb.success,'asset creation failed');
  let patched=await MimaStandalone.handle(`/novels/${id}`,'PATCH',{presetIds:[preset.data.id],worldbookIds:[wb.data.id],generationSettings:{...imported.data.generationSettings,minimumChars:30,maxAppendAttempts:2},modelSettings:{...imported.data.modelSettings,streaming:false}});
  assert(patched.success,'mount patch failed');
  const preview=await MimaStandalone.handle(`/novels/${id}/prompt-preview`,'POST',{directorNote:'下一段让她拆开信，但不要揭露寄信者。'});
  assert(preview.success,'prompt preview failed');
  const names=preview.data.sections.map(x=>x.name);
  assert(names.indexOf('novel_contract')<names.indexOf('presets')&&names.indexOf('presets')<names.indexOf('worldbook'),'prompt order contract -> preset -> worldbook broken');
  assert(names.indexOf('director_note')<names.indexOf('output_requirement'),'director note order wrong');
  assert.strictEqual(preview.data.selectedWorldbookEntries.length,1,'relevant worldbook entry not activated');

  // Configure provider; model calls are mocked through fetch but actual core call chain is used.
  MimaStandalone.saveApiConfig({apiBase:'https://example.invalid/v1',apiKey:'x',model:'mock',stream:false,sendTemperature:true});
  let continuationCalls=0,memoryCalls=0;
  global.fetch=async (_url,opts)=>{
    const req=JSON.parse(opts.body||'{}'),joined=(req.messages||[]).map(x=>x.content||'').join('\n');
    if(joined.includes('小说剧情档案整理器')){
      memoryCalls++;
      const payload={summary:{overview:'红色信件与午夜钟声推动神秘来客线。',events:['她准备拆开信件'],characterChanges:[{name:'她',state:'警觉'}],revealedFacts:['信件与童年秘密有关'],openThreads:['寄信者身份'],foreshadowing:['钟楼'],endingState:'她仍在房间'},delta:{storyOverview:'雨夜的红色信封引出了知道主角童年秘密的神秘来客。',currentSituation:'她正在房间处理信件。',characterStates:[{name:'她',state:'警觉'}],relationships:[],timeline:['午夜十二点钟楼响起'],openThreads:['寄信者身份'],foreshadowing:['钟楼'],revealedFacts:['信件与童年秘密有关'],locations:['旧城钟楼']}};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)}}]}),{status:200,headers:{'content-type':'application/json'}});
    }
    continuationCalls++;
    const content=continuationCalls===1?'她终于拆开信。':'纸页里夹着一张旧照片，她认出照片背面那行熟悉的字迹，却没有立刻说出那个名字。窗外钟声刚好停下。';
    return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}});
  };

  const beforeGen=await MimaStandalone.handle(`/novels/${id}`,'GET');
  const canonicalBefore=MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(beforeGen.data,beforeGen.data.activeChapterId));
  let gen=await MimaStandalone.handle(`/novels/${id}/continue`,'POST',{directorNote:'让她拆开信',minimumChars:30});
  assert(gen.success,'Novel continue failed');
  assert.strictEqual(continuationCalls,2,'under-length continuation did not append under same action');
  assert.strictEqual(gen.data.draft.status,'ready','satisfied draft not ready');
  assert(gen.data.draft.content.includes('她终于拆开信')&&gen.data.draft.content.includes('旧照片'),'append did not preserve first response');
  assert(gen.data.generation.attempts.length===2,'append attempts not owned by same generation');
  let beforeAccept=await MimaStandalone.handle(`/novels/${id}`,'GET');
  assert.strictEqual(MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(beforeAccept.data,beforeAccept.data.activeChapterId)),canonicalBefore,'Draft leaked into canonical prose before accept');
  let txt=await MimaStandalone.handle(`/novels/${id}/export/txt`,'GET');
  assert(!txt.data.text.includes('旧照片'),'TXT export included unaccepted Draft');

  const draftId=gen.data.draft.id;
  let accepted=await MimaStandalone.handle(`/novels/${id}/drafts/${draftId}/accept`,'POST',{});
  assert(accepted.success,'accept failed');
  assert(MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(accepted.data,accepted.data.activeChapterId)).includes('旧照片'),'accepted prose missing from canonical chapter');
  assert.strictEqual(memoryCalls,1,'accept should attempt one current-chapter memory update');
  assert.strictEqual(accepted.data.memoryStatus.status,'missing','unanalyzed other chapter should make memory PARTIAL/missing, not stale');
  assert(accepted.data.narrativeState.storyOverview.includes('红色信封'),'narrative state merge missing');

  // An incomplete Draft manually resumes inside the SAME Generation instead of spawning a duplicate lifecycle.
  let resumedProject=await MimaStandalone.handle('/novels/import','POST',{title:'补写生命周期',sourceName:'resume.txt',sourceEncoding:'utf-8',text:'第一章雨夜\n他停在门前。'});
  const resumeId=resumedProject.data.id;
  resumedProject=await MimaStandalone.handle(`/novels/${resumeId}`,'PATCH',{generationSettings:{...resumedProject.data.generationSettings,minimumChars:50,maxAppendAttempts:0},modelSettings:{...resumedProject.data.modelSettings,streaming:false}});
  let resumeCall=0;
  global.fetch=async()=>{
    resumeCall++;
    const content=resumeCall===1?'短句。':'他终于推开门，屋内的灯一盏接一盏亮起，旧日留下的纸张仍整齐摆在桌上。';
    return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const incomplete=await MimaStandalone.handle(`/novels/${resumeId}/continue`,'POST',{minimumChars:50});
  assert(incomplete.success&&incomplete.data.draft.status==='incomplete','bounded first run should leave an incomplete Draft');
  const originalGenerationId=incomplete.data.generation.id,originalDraftId=incomplete.data.draft.id;
  const generationCountBefore=incomplete.data.project.generations.length;
  const resumed=await MimaStandalone.handle(`/novels/${resumeId}/drafts/${originalDraftId}/continue`,'POST',{minimumChars:20});
  assert(resumed.success,'manual Draft resume route failed');
  assert.strictEqual(resumed.data.generation.id,originalGenerationId,'manual resume spawned a second Generation');
  assert.strictEqual(resumed.data.draft.id,originalDraftId,'manual resume replaced the existing Draft');
  assert.strictEqual(resumed.data.project.generations.length,generationCountBefore,'manual resume duplicated generation lifecycle');
  assert.strictEqual(resumed.data.generation.attempts.length,2,'manual resume did not append an attempt to the original Generation');
  assert(resumed.data.generation.attempts[1].manualResume===true,'manual resume attempt provenance missing');
  const resumeCanonical=MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(resumed.data.project,resumed.data.project.activeChapterId));
  assert(!resumeCanonical.includes('推开门'),'resumed Draft leaked into canonical prose before accept');
  const resumeChapterId=resumed.data.project.activeChapterId;
  const changedBase=await MimaStandalone.handle(`/novels/${resumeId}/chapters/${resumeChapterId}`,'PATCH',{action:'replace_text',content:'他退回走廊，并把门重新锁好。'});
  assert(changedBase.success,'stale Draft fixture chapter edit failed');
  const staleResume=await MimaStandalone.handle(`/novels/${resumeId}/drafts/${originalDraftId}/continue`,'POST',{minimumChars:20});
  assert.strictEqual(staleResume.success,false,'Draft based on an edited chapter must not resume');
  const staleAccept=await MimaStandalone.handle(`/novels/${resumeId}/drafts/${originalDraftId}/accept`,'POST',{});
  assert.strictEqual(staleAccept.success,false,'Draft based on an edited chapter must not be accepted');
  const afterStaleReject=await MimaStandalone.handle(`/novels/${resumeId}`,'GET');
  assert(!MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(afterStaleReject.data,resumeChapterId)).includes('推开门'),'stale Draft mutated the edited canonical chapter');
  const deletedResume=await MimaStandalone.handle(`/novels/${resumeId}`,'DELETE');
  assert(deletedResume.success&&deletedResume.data.deleted,'resume fixture cleanup failed');

  // Editing an older canonical chapter preserves source snapshot and invalidates downstream memory.
  let edited=await MimaStandalone.handle(`/novels/${id}/chapters/${first}`,'PATCH',{action:'replace_text',content:'她收到一封红色信件，并看见陌生署名。'});
  assert(edited.success,'chapter edit failed');
  assert.strictEqual(edited.data.sourceText,sourceBefore,'editing canonical chapter rewrote source snapshot');
  assert.strictEqual(edited.data.memoryStatus.status,'stale','old chapter edit must stale narrative memory');

  txt=await MimaStandalone.handle(`/novels/${id}/export/txt`,'GET');
  assert(txt.data.text.includes('旧照片'),'TXT export omitted accepted prose');

  // Malformed memory is explicit degraded, never overwrites prose.
  const latestBeforeBad=(await MimaStandalone.handle(`/novels/${id}`,'GET')).data;const active=latestBeforeBad.activeChapterId,acceptedText=MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(latestBeforeBad,active));
  global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'not-json'}}]}),{status:200,headers:{'content-type':'application/json'}});
  let bad=await MimaStandalone.handle(`/novels/${id}/memory/chapter/${active}`,'POST',{});
  assert.strictEqual(bad.success,false,'malformed memory output should fail closed');
  let afterBad=await MimaStandalone.handle(`/novels/${id}`,'GET');
  assert.strictEqual(afterBad.data.memoryStatus.status,'degraded','memory parse failure not surfaced as degraded');
  assert.strictEqual(MimaNovelEngine.getChapterText(MimaNovelEngine.getChapter(afterBad.data,active)),acceptedText,'memory failure mutated accepted prose');

  // Theme semantics: default is a no-override state; normalization is stable.
  assert.deepStrictEqual(MimaThemeEngine.getBuiltins().map(x=>x.id),['default','midnight','eink','paper']);
  let theme=await MimaStandalone.handle('/theme','PATCH',{theme:'eink'});assert(theme.success&&theme.data.theme==='eink','theme route failed');
  theme=await MimaStandalone.handle('/theme','PATCH',{theme:'default'});assert(theme.success&&theme.data.theme==='default','default theme restore failed');

  // Legacy RP route still operates and library arrays survive migration.
  let session=await MimaStandalone.handle('/sessions','POST',{title:'RP 回归'});assert(session.success,'legacy Session create regressed');
  const finalState=MimaStandalone.getState();
  assert(finalState.sessions.some(x=>x.id===session.data.id)&&finalState.novelProjects.some(x=>x.id===id),'RP and Novel domains do not coexist');
  const exported=await MimaStandalone.exportLibrary();assert.strictEqual(exported.schemaVersion,4);assert(exported.novelProjects.length===1&&exported.themeSettings,'v4 backup missing Novel/theme domains');

  console.log('PASS v1.3.0: migration + TXT + chapters + prompt + same-generation append + Draft/accept + partial memory + fail-closed memory + themes + RP coexistence');
})().catch(e=>{console.error(e);process.exit(1)});
