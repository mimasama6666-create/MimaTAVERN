const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');global.window=global;
const copy=v=>JSON.parse(JSON.stringify(v));
const ls=new Map();global.localStorage={getItem:k=>ls.get(k)||null,setItem:(k,v)=>ls.set(k,String(v))};
require(path.join(root,'local-store.js'));
const validator=MimaLocalStore.validateLibrary;
let persisted={schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default'}};
global.MimaLocalStore={validateLibrary:validator,loadState:async()=>copy(persisted),saveState:async(v,revision)=>{if(persisted.storeRevision!==revision)throw new Error('E_CANONICAL_CONFLICT');persisted={...copy(v),storeRevision:revision+1};return copy(persisted)}};
for(const n of ['theme-engine.js','regex-engine.js','novel-memory.js','novel-engine.js','novel-prompt-assembler.js','standalone-core.js'])require(path.join(root,n));
const engine=MimaNovelEngine,memory=MimaNovelMemory;
function prepared(status='needs_review'){
  const a=engine.normalizeChapter({id:'chapter-one',title:'第一章',revision:1,segments:[{id:'s1',kind:'source',content:'第一章：主角受伤，与同伴相处紧张。'}]});
  a.summaryStatus='fresh';a.summarySourceRevision=1;a.summarySourceHash=engine.chapterHash(a);a.summary.generatedAt='2026-09-01T00:00:00Z';a.summary.overview='主角受伤';a.summary.revealedFacts=['主角受伤'];
  const b=engine.normalizeChapter({id:'chapter-two',title:'第二章',revision:1,segments:[{id:'s2',kind:'source',content:'第二章后续的秘密尚未发生'}]});
  const revisions=status==='verified_legacy'?{'chapter-one':1}:{};
  // An actual engine-created mature narrative state includes manualOverrides,
  // including when there are no owner edits. Do not model a damaged backup.
  return engine.normalizeProject({id:'legacy-novel',title:'旧档案逆向剧透验证',chapters:[a,b],chapterOrder:[a.id,b.id],activeChapterId:a.id,narrativeState:{characterStates:[{name:'主角',status:'受伤'}],relationships:[{from:'主角',to:'同伴',status:'不信任'}],openThreads:['寻找钥匙'],revealedFacts:['未来剧透：凶手是 A'],sourceChapterRevisions:revisions,manualOverrides:{}},memoryStatus:{status:'fresh'}});
}
function preview(p){return MimaNovelPromptAssembler.assemble({project:p});}
const unsafe=prepared();
assert.equal(memory.legacyCheckpointStatus(unsafe,'chapter-one'),'needs_review');
assert.equal(preview(unsafe).inspector.legacyCheckpointStatus,'needs_review');
assert(!JSON.stringify(preview(unsafe).messages).includes('未来剧透：凶手是 A'),'needs_review spoiler reached model');
assert(!JSON.stringify(preview(unsafe).messages).includes('寻找钥匙'),'unverified old global thread reached model');
assert(JSON.stringify(unsafe.legacyNarrativeCheckpoint.state).includes('未来剧透：凶手是 A'),'archive accidentally deleted');
const verified=prepared('verified_legacy');
assert.equal(memory.legacyCheckpointStatus(verified,'chapter-one'),'verified_legacy');
assert(JSON.stringify(preview(verified).messages).includes('不信任'),'verified legacy relationship disappeared');
const edited=engine.editChapter(verified,'chapter-one','replace_text',{content:'主角已经康复'});
assert.equal(memory.legacyCheckpointStatus(edited,'chapter-one'),'invalidated');
assert(!JSON.stringify(preview(edited).messages).includes('不信任'),'stale legacy relationship leaked');
const reorder=engine.editChapter(verified,'chapter-one','move',{toIndex:1});
assert.equal(memory.legacyCheckpointStatus(reorder,'chapter-one'),'invalidated');
(async()=>{
  await MimaStandalone.init();
  const backup=await MimaStandalone.exportLibrary();backup.novelProjects=[unsafe];
  await MimaStandalone.importLibrary(backup);
  const id=unsafe.id;
  let p=(await MimaStandalone.handle(`/novels/${id}`,'GET')).data;
  const inspector=await MimaStandalone.handle(`/novels/${id}/prompt-preview`,'POST');assert(inspector.success);
  assert(!JSON.stringify(inspector.data.messagePreview).includes('未来剧透：凶手是 A'));
  const reviewed=await MimaStandalone.handle(`/novels/${id}/memory/legacy-review`,'POST',{field:'relationships',index:0,chapterId:'chapter-one'});
  assert(reviewed.success,JSON.stringify(reviewed));
  p=reviewed.data;
  assert(JSON.stringify(preview(p).messages).includes('不信任'),'reviewed fact never became usable');
  assert(!JSON.stringify(preview(p).messages).includes('未来剧透：凶手是 A'),'review mistakenly promoted full archive');
  assert.equal(p.legacyNarrativeCheckpoint.reviews.length,1);
  // A reviewed first-chapter note must not undo a later chapter's update.
  const later=copy(p);
  const ch2=later.chapters.find(c=>c.id==='chapter-two');
  ch2.summaryStatus='fresh';ch2.summarySourceRevision=1;ch2.summarySourceHash=engine.chapterHash(ch2);
  ch2.memoryDelta={relationships:[{from:'主角',to:'同伴',status:'信任'}]};
  assert(memory.deriveFromChapters(later,'chapter-two').relationships.some(x=>x.status==='信任'));
  assert(!memory.deriveFromChapters(later,'chapter-two').relationships.some(x=>x.status==='不信任'));

  const afterEdit=await MimaStandalone.handle(`/novels/${id}/chapters/chapter-one`,'PATCH',{action:'replace_text',content:'第一章康复，没有争吵'});
  assert(afterEdit.success,JSON.stringify(afterEdit));
  assert(!JSON.stringify(preview(afterEdit.data).messages).includes('不信任'),'review authorization survived edit');
  assert(afterEdit.data.legacyNarrativeCheckpoint.reviews.length===1,'invalidated review evidence should remain archived');
  // Re-analysis of the same text also invalidates the human review if it
  // changes the summary generation identity; it must not persist forever.
  const updated=copy(unsafe);updated.legacyNarrativeCheckpoint.reviews=[{field:'relationships',index:0,chapterId:'chapter-one',chapterRevision:1,chapterHash:engine.chapterHash(updated.chapters[0]),summaryGeneratedAt:updated.chapters[0].summary.generatedAt}];
  updated.chapters[0].summary.generatedAt='2026-10-09T01:00:00Z';
  assert(!JSON.stringify(preview(updated).messages).includes('不信任'),'review authorization survived new summary');
  console.log('PASS v1.3.4 legacy quarantine: future spoiler filtered, verified legacy retained, human review chapter-scoped, edits/reorder/re-analysis invalidate');
})().catch(e=>{console.error(e);process.exitCode=1});
