const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
global.window=global;
require(path.join(root,'local-store.js'));
for(const f of ['novel-memory.js','novel-engine.js','novel-prompt-assembler.js'])require(path.join(root,f));
const clone=x=>JSON.parse(JSON.stringify(x));
const validate=MimaLocalStore.validateLibrary;
// Canonical v4 fixtures have every normalized durable text field; do not
// weaken production validation just to make a sparse test stub importable.
const session=()=>({id:'s1',messages:[{id:'m1',role:'user',content:'绝不可丢失的聊天记录',rawContent:'绝不可丢失的聊天记录',renderedContent:'',versions:[]}],deletedMessages:[],archivedBranches:[],worldbookIds:[],presetIds:[],regexPackIds:[],tags:[],pinnedFacts:[],unresolvedHooks:[],manualMemory:{core:{content:''},facts:[],settings:{}},storyState:{},promptSettings:{},summary:'',rollingSummary:'',longSummary:'',sceneSummary:'',characterPsychSummary:'',relationshipSummary:'',lastScene:'',userNotes:'',aiNotes:'',directorNote:''});
const base=()=>({schemaVersion:4,storeRevision:7,sessions:[session()],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[MimaNovelEngine.normalizeProject({id:'n1',chapters:[{id:'c1',revision:1,segments:[{id:'sg1',content:'绝不可丢失的小说正文',kind:'source'}]}],chapterOrder:['c1'],activeChapterId:'c1'})],themeSettings:{theme:'default'}});
const bad=(mutator,pattern)=>{const data=base();mutator(data);assert.throws(()=>validate(data),pattern);};
bad(x=>x.sessions[0].messages='destroy me',/sessions\[0\]\.messages/);
bad(x=>x.novelProjects[0].chapters[0].segments='destroy me',/novelProjects\[0\]\.chapters\[0\]\.segments/);
bad(x=>delete x.novelProjects,/novelProjects/);
bad(x=>x.novelProjects[0].chapters.push({...x.novelProjects[0].chapters[0]}),/chapters\[1\]\.id/);
bad(x=>x.novelProjects[0].drafts.push({id:'d1',chapterId:'missing',generationId:'g1',content:'草稿'}),/drafts\[0\]\.chapterId/);
bad(x=>x.novelProjects[0].generations.push({id:'g1',chapterId:'missing',draftId:'',attempts:[]}),/generations\[0\]\.chapterId/);
bad(x=>x.sessions[0].messages[0].content={hello:'no'},/content/);
bad(x=>x.novelProjects[0].chapters[0].segments[0].content=null,/content/);
bad(x=>x.novelProjects[0].chapters[0].segments.push({...x.novelProjects[0].chapters[0].segments[0]}),/segments\[1\]\.id/);
bad(x=>x.novelProjects[0].narrativeState.characterStates='damaged',/narrativeState\.characterStates/);
bad(x=>x.novelProjects[0].chapters[0].summary.events='damaged',/summary\.events/);
bad(x=>delete x.themeSettings,/themeSettings/);
assert.equal(validate(base()).sessions[0].messages[0].content,'绝不可丢失的聊天记录');
const legacy=base();legacy.schemaVersion=3;delete legacy.novelProjects;delete legacy.themeSettings;
assert.equal(validate(legacy).schemaVersion,3);
const oldPayload={format:'mimamao-tavern-standalone',version:1,data:legacy};
assert.equal(validate(oldPayload).schemaVersion,3);

// Real import entry: failed validation must leave both runtime and persisted
// snapshots unchanged, not merely throw from validateLibrary.
const originalValidate=MimaLocalStore.validateLibrary;
let persisted=base(),writeFailure=false;
global.MimaLocalStore={validateLibrary:originalValidate,loadState:async()=>clone(persisted),saveState:async(next,revision)=>{
  if(writeFailure)throw new Error('E_IDB_INTERRUPTED');
  if(revision!==persisted.storeRevision)throw new Error('E_CANONICAL_CONFLICT');
  persisted={...clone(next),storeRevision:revision+1};return clone(persisted);
}};
for(const f of ['theme-engine.js','regex-engine.js','standalone-core.js'])require(path.join(root,f));
(async()=>{
  await MimaStandalone.init();
  const unchanged=MimaStandalone.getState(),saved=clone(persisted);
  for(const damage of [
    d=>{d.sessions[0].messages='wrong';},
    d=>{d.novelProjects[0].chapters[0].segments='wrong';},
    d=>{delete d.novelProjects;},
    d=>{d.novelProjects[0].drafts=[{id:'d1',chapterId:'missing',content:'bad'}];}
  ]){
    const invalid=base();damage(invalid);
    await assert.rejects(()=>MimaStandalone.importLibrary(invalid));
    assert.deepEqual(persisted,saved,'bad backup changed persisted data');
    assert.deepEqual(MimaStandalone.getState(),unchanged,'bad backup changed runtime data');
  }
  writeFailure=true;
  await assert.rejects(()=>MimaStandalone.importLibrary(base()),/E_IDB_INTERRUPTED/);
  assert.deepEqual(persisted,saved,'interrupted write mutated canonical');
  writeFailure=false;
  persisted={...persisted,storeRevision:persisted.storeRevision+1};
  const latest=clone(persisted);
  await assert.rejects(()=>MimaStandalone.importLibrary(base()),/E_CANONICAL_CONFLICT/);
  assert.deepEqual(persisted,latest,'CAS conflict overwrote newer revision');
  // A verified v3 backup is allowed to omit the Novel Studio collection.
  const old=base();old.schemaVersion=3;delete old.novelProjects;delete old.themeSettings;
  await MimaStandalone.importLibrary(old);
  assert.equal(persisted.novelProjects.length,0,'verified legacy migration failed');
  console.log('PASS v1.3.3 backup integrity: nested validation, unchanged state, legacy import, interrupted write, CAS');
})().catch(e=>{console.error(e);process.exitCode=1});
