const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
global.window=global;
const local=new Map();global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
require(path.join(root,'local-store.js'));
const validator=MimaLocalStore.validateLibrary;
const directStoreImport=MimaLocalStore.importAll;
const copy=v=>JSON.parse(JSON.stringify(v));
let persisted={schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default',globalCssPresetId:null,globalCssEnabled:true,updatedAt:''}};
let shouldInterrupt=false;
global.MimaLocalStore={validateLibrary:validator,loadState:async()=>copy(persisted),saveState:async(v,rev)=>{
  if(shouldInterrupt)throw new Error('E_SIMULATED_IDB_WRITE_INTERRUPTED');
  if(rev!==persisted.storeRevision)throw new Error('E_CANONICAL_CONFLICT');
  persisted={...copy(v),storeRevision:rev+1};return copy(persisted);
}};
for(const name of ['theme-engine.js','regex-engine.js','novel-memory.js','novel-engine.js','novel-prompt-assembler.js','standalone-core.js'])require(path.join(root,name));
const route=(p,m='GET',body)=>MimaStandalone.handle(p,m,body);
(async()=>{
  await MimaStandalone.init();
  const rp=(await route('/sessions','POST',{title:'极重要会话'}));assert(rp.success);
  const sid=rp.data.id;
  assert((await route(`/sessions/${sid}`,'PATCH',{summary:'重要剧情摘要',messages:[{id:'m1',role:'user',content:'珍贵聊天原文'}]})).success);
  assert((await route('/presets','POST',{name:'重要文风预设',content:'必须使用文学叙述'})).success);
  assert((await route('/masks','POST',{name:'重要 Persona',content:'人物心灵与秘密'})).success);
  assert((await route('/worldbooks','POST',{name:'重要世界书',entries:[{id:'entry01',name:'机密',content:'不能泄露的世界设定',keywords:['世界设定']}]})).success);
  assert((await route('/css-presets','POST',{name:'黑色哥特 CSS',css:'body { color: #333; }'})).success);
  assert((await route('/regex-packs','POST',{name:'特殊文字替换',rules:[{id:'rule01',name:'替换',pattern:'猫',replacement:'大肥猫'}]})).success);
  const novel=(await route('/novels/import','POST',{title:'重要小说',sourceName:'全文.txt',text:'第一章\n完整TXT珍贵内容'}));assert(novel.success);
  const baseline=await MimaStandalone.exportLibrary();
  assert.equal(validator(baseline),baseline);
  const chapter=baseline.novelProjects[0].chapters[0];
  baseline.novelProjects[0].drafts=[MimaNovelEngine.normalizeDraft({id:'draft-keep',projectId:novel.data.id,chapterId:chapter.id,generationId:'gen-keep',content:'未采纳但重要的续写'})];
  baseline.novelProjects[0].generations=[MimaNovelEngine.normalizeGeneration({id:'gen-keep',projectId:novel.data.id,chapterId:chapter.id,draftId:'draft-keep',directorNote:'生成命令也要保留'})];
  // The v4 export actually contains these durable collections, not a sparse fake fixture.
  const originalMessage=copy(baseline.sessions[0].messages[0]);
  baseline.sessions[0].archivedBranches=[{id:'archive-keep',fromMessageId:'m1',reason:'edit_truncate_after',archivedAt:new Date().toISOString(),messages:[originalMessage]}];
  baseline.sessions[0].deletedMessages=[originalMessage];
  baseline.sessions[0].messages[0].versions=[{content:'保留原始修改版本',time:new Date().toISOString(),reason:'manual_edit'}];
  baseline.sessions[0].manualMemory.facts=[{id:'fact-keep',startRound:1,endRound:1,content:'绝不可丢的手动记忆',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),source:'manual',targetChars:360,temperature:0.35,sourceMessageCount:1}];
  baseline.novelProjects[0].chapters[0].summary.events=['珍贵章节事件'];
  baseline.novelProjects[0].chapters[0].summary.characterChanges=[{name:'主角',status:'被重要事件影响'}];
  baseline.novelProjects[0].chapters[0].summary.revealedFacts=['重要揭露'];
  baseline.novelProjects[0].chapters[0].summary.openThreads=['未完线索'];
  baseline.novelProjects[0].chapters[0].summary.foreshadowing=['未实现伏笔'];
  baseline.novelProjects[0].presetIds=['some-preset-id'];
  baseline.novelProjects[0].worldbookIds=['some-worldbook-id'];
  // Use the real canonical import and export path for a fully populated v4 fixture.
  await MimaStandalone.importLibrary(baseline);
  const valid=await MimaStandalone.exportLibrary();
  assert.deepEqual(MimaLocalStore.validateLibrary(valid),valid);
  const before=copy(persisted),runtime=MimaStandalone.getState();
  assert.equal(valid.sessions[0].archivedBranches[0].messages[0].content,'珍贵聊天原文');
  assert.equal(valid.sessions[0].manualMemory.facts[0].content,'绝不可丢的手动记忆');
  const cases=[
    ['sessions[0].archivedBranches',x=>delete x.sessions[0].archivedBranches],
    ['sessions[0].archivedBranches',x=>x.sessions[0].archivedBranches='garbled'],
    ['sessions[0].archivedBranches[1].id',x=>x.sessions[0].archivedBranches.push(copy(x.sessions[0].archivedBranches[0]))],
    ['sessions[0].archivedBranches[0].messages',x=>delete x.sessions[0].archivedBranches[0].messages],
    ['sessions[0].deletedMessages',x=>delete x.sessions[0].deletedMessages],
    ['sessions[0].messages[0].versions',x=>delete x.sessions[0].messages[0].versions],
    ['sessions[0].manualMemory',x=>delete x.sessions[0].manualMemory],
    ['sessions[0].manualMemory.facts',x=>delete x.sessions[0].manualMemory.facts],
    ['sessions[0].manualMemory.facts',x=>x.sessions[0].manualMemory.facts='garbled'],
    ['sessions[0].manualMemory.facts[0].id',x=>delete x.sessions[0].manualMemory.facts[0].id],
    ['sessions[0].manualMemory.core',x=>delete x.sessions[0].manualMemory.core],
    ['sessions[0].manualMemory.settings',x=>delete x.sessions[0].manualMemory.settings],
    ['sessions[0].tags',x=>delete x.sessions[0].tags],
    ['sessions[0].storyState',x=>delete x.sessions[0].storyState],
    ['sessions[0].promptSettings',x=>delete x.sessions[0].promptSettings],
    ['masks[0].aliases',x=>delete x.masks[0].aliases],
    ['worldbooks[0].entries[0].keywords',x=>delete x.worldbooks[0].entries[0].keywords],
    ['regexPacks[0].rules',x=>delete x.regexPacks[0].rules],
    ['novelProjects[0].presetIds',x=>delete x.novelProjects[0].presetIds],
    ['novelProjects[0].chapters[0].memoryDelta',x=>delete x.novelProjects[0].chapters[0].memoryDelta],
    ['novelProjects[0].legacyNarrativeCheckpoint',x=>delete x.novelProjects[0].legacyNarrativeCheckpoint],
    ['novelProjects[0].modelSettings',x=>delete x.novelProjects[0].modelSettings],
    ['novelProjects[0].generationSettings',x=>delete x.novelProjects[0].generationSettings],
    ['novelProjects[0].appearance',x=>delete x.novelProjects[0].appearance],
    ['novelProjects[0].memoryStatus',x=>delete x.novelProjects[0].memoryStatus],
    ['novelProjects[0].drafts[0].metadata',x=>delete x.novelProjects[0].drafts[0].metadata],
    ['novelProjects[0].generations[0].inputSnapshot',x=>delete x.novelProjects[0].generations[0].inputSnapshot],
    ['novelProjects[0].worldbookIds',x=>x.novelProjects[0].worldbookIds=null],
    ['novelProjects[0].chapters[0].memoryDelta.closedThreads',x=>x.novelProjects[0].chapters[0].memoryDelta={closedThreads:'corrupted'}],
    ['novelProjects[0].chapters[0].summary.events',x=>delete x.novelProjects[0].chapters[0].summary.events],
    ['novelProjects[0].chapters[0].summary.events',x=>x.novelProjects[0].chapters[0].summary.events='garbled'],
    ['novelProjects[0].chapters[0].summary.characterChanges',x=>delete x.novelProjects[0].chapters[0].summary.characterChanges],
    ['novelProjects[0].chapters[0].summary.revealedFacts',x=>delete x.novelProjects[0].chapters[0].summary.revealedFacts],
    ['novelProjects[0].chapters[0].summary.openThreads',x=>delete x.novelProjects[0].chapters[0].summary.openThreads],
    ['novelProjects[0].chapters[0].summary.foreshadowing',x=>delete x.novelProjects[0].chapters[0].summary.foreshadowing],
    ['novelProjects[0].generations[0].attempts',x=>delete x.novelProjects[0].generations[0].attempts],
    ['presets[0].content',x=>delete x.presets[0].content],
    ['presets[0].content',x=>x.presets[0].content={wrong:true}],
    ['masks[0].content',x=>delete x.masks[0].content],
    ['masks[0].content',x=>x.masks[0].content=123],
    ['worldbooks[0].entries[0].content',x=>delete x.worldbooks[0].entries[0].content],
    ['worldbooks[0].entries[0].content',x=>x.worldbooks[0].entries[0].content=[]],
    ['novelProjects[0].sourceText',x=>delete x.novelProjects[0].sourceText],
    ['novelProjects[0].sourceText',x=>x.novelProjects[0].sourceText=null],
    ['cssPresets[0].css',x=>delete x.cssPresets[0].css],
    ['regexPacks[0].rules[0].replacement',x=>delete x.regexPacks[0].rules[0].replacement],
    ['regexPacks[0].rules[0].pattern',x=>x.regexPacks[0].rules[0].pattern=42],
    ['sessions[0].summary',x=>delete x.sessions[0].summary],
    ['sessions[0].summary',x=>x.sessions[0].summary=null],
    ['sessions[0].messages[0].rawContent',x=>delete x.sessions[0].messages[0].rawContent],
    ['novelProjects[0].chapters[0].summary.overview',x=>delete x.novelProjects[0].chapters[0].summary.overview],
    ['novelProjects[0].generations[0].directorNote',x=>delete x.novelProjects[0].generations[0].directorNote]
  ];
  for(const [where,mutate] of cases){
    const broken=copy(valid);mutate(broken);
    assert.throws(()=>validator(broken),e=>e.message.includes(where),`validator let ${where} disappear`);
    await assert.rejects(()=>directStoreImport(broken),e=>e.message.includes(where),`MimaLocalStore.importAll accepted ${where}`);
    await assert.rejects(()=>MimaStandalone.importLibrary(broken),e=>e.message.includes(where),`Core imported ${where}`);
    assert.deepEqual(persisted,before,`canonical changed on bad ${where}`);
    assert.deepEqual(MimaStandalone.getState(),runtime,`runtime changed on bad ${where}`);
  }
  // Empty but present text is legitimate, do not reject empty content.
  const empty=copy(valid);empty.masks[0].content='';empty.sessions[0].archivedBranches=[];empty.sessions[0].manualMemory.facts=[];empty.novelProjects[0].chapters[0].summary.events=[];assert.equal(validator(empty),empty);
  shouldInterrupt=true;
  await assert.rejects(()=>MimaStandalone.importLibrary(valid),/INTERRUPTED/);
  assert.deepEqual(persisted,before);
  shouldInterrupt=false;
  const fresh=copy(valid);await MimaStandalone.importLibrary(fresh);
  const roundtrip=MimaStandalone.getState();
  assert.equal(roundtrip.presets[0].content,'必须使用文学叙述');
  assert.equal(roundtrip.masks[0].content,'人物心灵与秘密');
  assert.equal(roundtrip.worldbooks[0].entries[0].content,'不能泄露的世界设定');
  assert.equal(roundtrip.novelProjects[0].sourceText,'第一章\n完整TXT珍贵内容');
  assert.equal(roundtrip.novelProjects[0].drafts[0].content,'未采纳但重要的续写');
  assert.equal(roundtrip.novelProjects[0].generations[0].directorNote,'生成命令也要保留');
  assert.equal(roundtrip.cssPresets[0].css,'body { color: #333; }');
  assert.equal(roundtrip.regexPacks[0].rules[0].replacement,'大肥猫');
  assert.equal(roundtrip.sessions[0].messages[0].content,'珍贵聊天原文');
  assert.equal(roundtrip.sessions[0].archivedBranches[0].messages[0].content,'珍贵聊天原文');
  assert.equal(roundtrip.sessions[0].manualMemory.facts[0].content,'绝不可丢的手动记忆');
  assert.equal(roundtrip.novelProjects[0].chapters[0].summary.events[0],'珍贵章节事件');
  const older=copy(valid);older.schemaVersion=3;delete older.backupContractRevision;delete older.novelProjects;delete older.cssPresets;delete older.regexPacks;delete older.themeSettings;
  delete older.masks[0].content;delete older.presets[0].content;delete older.worldbooks[0].entries[0].content;
  assert.equal(validator(older),older);
  await MimaStandalone.importLibrary(older);assert.equal(MimaStandalone.getState().schemaVersion,4);
  const v2=copy(older);v2.schemaVersion=2;assert.equal(validator(v2),v2);
  console.log('PASS v1.3.5 complete v4 durable arrays and legacy, corrupted field guards and unchanged canonical, valid empty fields, failed-write rollback, v2/v3 migration');
})().catch(e=>{console.error(e);process.exitCode=1});
