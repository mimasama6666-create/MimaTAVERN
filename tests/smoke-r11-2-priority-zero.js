'use strict';
// Priority=0 is a valid stable persisted value: input -> normalized store -> mounted prompt -> re-open.
// This test does not call the paid provider and does not mutate the user's saved history.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const clone=x=>structuredClone(x);let saved={schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[]};
global.window=global;global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
global.MimaLocalStore={loadState:async()=>clone(saved),saveState:async state=>(saved=clone(state),clone(saved))};
require(path.join(root,'regex-engine.js'));require(path.join(root,'standalone-core.js'));
(async()=>{
 await MimaStandalone.init();
 const get=async(path,method='GET',body)=>{const r=await MimaStandalone.handle(path,method,body);assert(r.success,JSON.stringify(r).slice(0,600));return r.data;};
 const zero=await get('/presets','POST',{name:'priority-zero',priority:0,content:'PRESET_ZERO'});
 const ten=await get('/presets','POST',{name:'priority-ten',priority:10,content:'PRESET_TEN'});
 assert.equal(zero.priority,0);
 let session=await get('/sessions','POST',{title:'Priority 0',messages:[{role:'user',content:'开始'}],presetIds:[ten.id,zero.id]});
 await get(`/sessions/${session.id}`,'PATCH',{presetIds:[ten.id,zero.id],messages:[{role:'user',content:'开始'}]});
 const wb=await get('/worldbooks','POST',{name:'测试世界书',entries:[
   {name:'wb-ten',priority:10,content:'WORLD_TEN',alwaysActive:true,depth:0,position:'middle'},
   {name:'wb-zero',priority:0,content:'WORLD_ZERO',alwaysActive:true,depth:0,position:'middle'},
   {name:'wb-negative',priority:-5,content:'WORLD_NEG',alwaysActive:true,depth:0,position:'middle'}
 ]});
 assert.deepEqual(wb.entries.map(x=>x.priority),[10,0,-5]);
 const pZero=await get(`/presets/${zero.id}`,'PATCH',{description:'edited without touching priority'});
 assert.equal(pZero.priority,0);
 session=await get(`/sessions/${session.id}`,'PATCH',{worldbookIds:[wb.id]});
 let preview=await get(`/sessions/${session.id}/prompt-preview`,'POST',{draft:'继续'});
 const prompt=preview.systemPreview;
 assert(prompt.indexOf('PRESET_ZERO')>=0&&prompt.indexOf('PRESET_TEN')>=0);
 assert(prompt.indexOf('PRESET_ZERO')<prompt.indexOf('PRESET_TEN'),'mounted preset zero was sorted as 50');
 const bookPriority=preview.matchedWorldbookEntries.filter(x=>x.bookId===wb.id);
 assert.deepEqual(bookPriority.map(x=>x.entryName),['wb-negative','wb-zero','wb-ten'],'worldbook zero lost its ordering');
 assert.equal(bookPriority[1].priority,0);
 // The values must survive a fresh load: a real serialized copy from the store is used.
 await MimaStandalone.init();
 const presets=await get('/presets');assert.equal(presets.find(x=>x.id===zero.id).priority,0);
 const worldbooks=await get('/worldbooks');assert.equal(worldbooks.find(x=>x.id===wb.id).entries[1].priority,0);
 preview=await get(`/sessions/${session.id}/prompt-preview`,'POST',{draft:'继续'});
 assert(preview.systemPreview.indexOf('PRESET_ZERO')<preview.systemPreview.indexOf('PRESET_TEN'));
 // Regex priority is independent, but had the identical falsy-zero bug.
 const rxZero=MimaRegexEngine.normalizePack({priority:0,rules:[{pattern:'X',replacement:'A',priority:0,phase:'output'}]});
 const rxTen=MimaRegexEngine.normalizePack({priority:10,rules:[{pattern:'A',replacement:'B',priority:10,phase:'output'}]});
 assert.equal(MimaRegexEngine.apply('X',[rxTen,rxZero],'output'),'B','regex priority zero must run before ten');
 const within=MimaRegexEngine.normalizePack({priority:0,rules:[{pattern:'A',replacement:'B',priority:10,phase:'output'},{pattern:'X',replacement:'A',priority:0,phase:'output'}]});
 assert.equal(MimaRegexEngine.apply('X',[within],'output'),'B','rule priority zero must run before ten');
 // AI-generated preset / regex artifacts: an absent value is default 50,
 // while a literal 0 must remain 0 (Number('') would incorrectly return 0).
 const vm=require('node:vm'),assistant=fs.readFileSync(path.join(root,'assistant-studio.js'),'utf8');
 const src=assistant.split('\n').find(x=>x.includes('function artifactNumber('));
 assert(src,'preset assistant priority helper missing');
 const artifactNumber=vm.runInNewContext('('+src.trim()+')');
 assert.equal(artifactNumber('0',50),0);
 assert.equal(artifactNumber('',50),50);
 assert.equal(artifactNumber(null,50),50);
 assert.equal(artifactNumber('invalid',50),50);
 // UI regression: input 0 must be displayed as zero when an object is reopened.
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 for(const required of ['Number(p.priority??50)','Number(e.priority??50)','Number(rule.priority??50)']) {
   assert(app.includes(required),'UI must render priority=0 rather than 50: '+required);
 }
 assert(!app.includes('priority||50'),'UI has a falsy-zero fallback');
 // Keep script version compatibility and verify the new cache busting tag is linked.
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const n of ['app.js','standalone-core.js','regex-engine.js','novel-prompt-assembler.js']){
   assert(new RegExp(`<script src="\\./${n.replace('.','\\.')}\\?[^" ]+priority0=r11\\.2"`).test(html),'missing cache bust '+n);
 }
 assert(html.includes('href="./ux-r6.css'),'mobile UX stylesheet disappeared');
 console.log('PASS priority=0: create, edit, normalize, persist/reload, prompt order, worldbook depth0 order, regex pack/rule order and UI/cache references');
})().catch(err=>{console.error(err);process.exitCode=1;});
