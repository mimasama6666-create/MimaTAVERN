const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
global.window=global;
require(path.join(root,'novel-memory.js'));
require(path.join(root,'novel-engine.js'));
require(path.join(root,'novel-prompt-assembler.js'));
const chapter=MimaNovelEngine.normalizeChapter({id:'old-c1',segments:[{id:'old-seg',kind:'source',content:'第一章主角受伤' }],revision:1,summaryStatus:'fresh'});
chapter.summary={overview:'主角受伤',events:['主角摔伤']};chapter.summarySourceRevision=chapter.revision;chapter.summarySourceHash=MimaNovelEngine.chapterHash(chapter);chapter.summary.generatedAt='2026-09-01T01:00:00Z';
const legacyMemory={storyOverview:'逃离旧城',currentSituation:'主角躲在旅店',characterStates:[{name:'主角',status:'受伤'}],relationships:[{from:'主角',to:'配角',status:'不信任'}],openThreads:['寻找钥匙'],revealedFacts:['门是蓝色的'],sourceChapterRevisions:{'old-c1':1}};
const oldProject=MimaNovelEngine.normalizeProject({id:'old',chapters:[chapter],chapterOrder:['old-c1'],activeChapterId:'old-c1',narrativeState:legacyMemory,memoryStatus:{status:'fresh'}});
assert(oldProject.legacyNarrativeCheckpoint,'legacy state not captured on normalization');
const past=MimaNovelMemory.deriveFromChapters(oldProject,'old-c1');
assert.deepEqual(past.characterStates,[{name:'主角',status:'受伤'}]);
assert.deepEqual(past.relationships,[{from:'主角',to:'配角',status:'不信任'}]);
assert.deepEqual(past.openThreads,['寻找钥匙']);
const prompt=MimaNovelPromptAssembler.assemble({project:oldProject});
assert(JSON.stringify(prompt.messages).includes('不信任'));
assert.equal(prompt.inspector.legacyCheckpointStatus,'verified_legacy');
// The checkpoint is not a permanent union; a later genuinely analyzed
// chapter must apply its own delta after the old baseline.
const later=MimaNovelEngine.normalizeChapter({id:'later',revision:1,segments:[{id:'later-s',kind:'source',content:'第二章找到出口'}],summaryStatus:'fresh',memoryDelta:{currentSituation:'走出旧城',closedThreads:['寻找钥匙'],openThreads:['调查遗迹']}});
later.summarySourceRevision=1;later.summarySourceHash=MimaNovelEngine.chapterHash(later);
const continuation=MimaNovelEngine.normalizeProject({...oldProject,chapters:[chapter,later],chapterOrder:['old-c1','later'],activeChapterId:'later'});
const continued=MimaNovelMemory.deriveFromChapters(continuation,'later');
assert.equal(continued.currentSituation,'走出旧城');
assert.deepEqual(continued.openThreads,['调查遗迹']);
const newer=MimaNovelEngine.editChapter(oldProject,'old-c1','replace_text',{content:'第一章主角康复，门是红色的'});
const after=MimaNovelMemory.deriveFromChapters(newer,'old-c1');
assert(!after.characterStates.some(x=>x.status==='受伤'));
assert(!after.revealedFacts.includes('门是蓝色的'));
assert.equal(MimaNovelMemory.legacyCheckpointStatus(newer,'old-c1'),'invalidated');
// A regenerated summary also retires the old checkpoint even if source text
// and revision remain unchanged (its contribution may contradict old facts).
const regenerated=MimaNovelEngine.normalizeProject({...oldProject,chapters:[{...chapter,summary:{...chapter.summary,generatedAt:'2026-10-09T01:00:00Z'},memoryDelta:{currentSituation:'已经康复'}}]});
assert.equal(MimaNovelMemory.legacyCheckpointStatus(regenerated,'old-c1'),'invalidated');
assert(!MimaNovelMemory.deriveFromChapters(regenerated,'old-c1').characterStates.some(x=>x.status==='受伤'));
const noSource=MimaNovelEngine.normalizeProject({...oldProject,legacyNarrativeCheckpoint:undefined,narrativeState:{...legacyMemory,sourceChapterRevisions:{}}});
// An explicit undefined checkpoint means preserve the original migration
// state; removing the property represents a genuinely old JSON archive.
delete noSource.legacyNarrativeCheckpoint;
const needsReview=MimaNovelEngine.normalizeProject(noSource);
assert.equal(MimaNovelMemory.legacyCheckpointStatus(needsReview,'old-c1'),'needs_review');
assert(JSON.stringify(MimaNovelPromptAssembler.assemble({project:needsReview}).messages).includes('待核查'));
// Old notes must not leak backwards through the chapter timeline.
const future=MimaNovelEngine.normalizeChapter({id:'future',segments:[{id:'fseg',kind:'source',content:'第二章'}],revision:1,summaryStatus:'fresh'});
future.summarySourceRevision=1;future.summarySourceHash=MimaNovelEngine.chapterHash(future);
const two=MimaNovelEngine.normalizeProject({id:'tw',chapters:[chapter,future],chapterOrder:['old-c1','future'],activeChapterId:'old-c1',narrativeState:legacyMemory});
assert(!JSON.stringify(MimaNovelMemory.deriveFromChapters(two,'old-c1')).includes('不信任'));
console.log('PASS v1.3.3 legacy memory: v1.3.1 fixture, prompt retention, source-bound rollback, newer deltas, review marker and spoiler isolation');
