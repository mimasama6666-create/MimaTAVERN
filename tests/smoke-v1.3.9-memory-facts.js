/** Mock model / real Core route: atomic multi-chunk fact-summary save, failure protection. */
const assert=require('node:assert/strict'),path=require('node:path'),root=path.resolve(__dirname,'..');
const cp=v=>JSON.parse(JSON.stringify(v));
global.window=global;const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,String(v)),removeItem:k=>prefs.delete(k)};
let canonical={storeRevision:0,schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default'}};
global.MimaLocalStore={loadState:async()=>cp(canonical),saveState:async(s,rev)=>{assert.equal(rev,canonical.storeRevision);canonical={...cp(s),storeRevision:rev+1};return cp(canonical)}};
for(const m of ['theme-engine.js','regex-engine.js','persona-macro-resolver.js','user-input-semantic-parser.js','novel-memory.js','novel-engine.js','novel-prompt-assembler.js','standalone-core.js'])require(path.join(root,m));
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'https://test.invalid/v1',apiKey:'fake',model:'mock',stream:false,sendTemperature:false});
 const route=(url,method='GET',body=null,signal=null,progress=null)=>MimaStandalone.handle(url,method,body,signal,progress);
 const session=await route('/sessions','POST',{title:'事实档案'}),id=session.data.id;
 const msgs=[{id:'u1',role:'user',content:'第一轮发生的事件'},{id:'a1',role:'assistant',content:'第一轮回应'},{id:'u2',role:'user',content:'第二轮另一件事'},{id:'a2',role:'assistant',content:'第二轮回应'}];
 await route(`/sessions/${id}`,'PATCH',{messages:msgs});
 let count=0;const createResponse=content=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
 global.fetch=async()=>createResponse(`核实事实 ${++count}`);
 const progress=[];const res=await route(`/sessions/${id}/memory/facts`,'POST',{scope:'all',chunkRounds:1,replaceExisting:false},null,v=>progress.push(v));
 assert.equal(res.success,true,JSON.stringify(res));assert.equal(res.data.manualMemory.facts.length,2);assert.equal(res.data.manualMemory.facts[0].content,'核实事实 1');assert.equal(res.data.manualMemory.facts[1].content,'核实事实 2');
 const before=cp(canonical.sessions[0].manualMemory.facts);
 // Second API call fails: replace-all is atomic and must NOT delete the earlier fact archive.
 let number=0;global.fetch=async()=>{number++;if(number===2)return new Response(JSON.stringify({error:{message:'429 限额'}}),{status:429,headers:{'content-type':'application/json'}});return createResponse('重建第一段');};
 const failed=await route(`/sessions/${id}/memory/facts`,'POST',{scope:'all',chunkRounds:1,replaceExisting:true});
 assert.equal(failed.success,false);assert.equal(failed.status,429);assert.deepEqual(canonical.sessions[0].manualMemory.facts,before,'partial multi-stage failure lost old facts');
 // Changing settings is a safe concurrent change and must remain intact at commit.
 let release,enter;const seen=new Promise(r=>enter=r);
 global.fetch=async()=>{enter();await new Promise(r=>release=r);return createResponse('设置冲突后仍能保存');};
 const pending=route(`/sessions/${id}/memory/facts`,'POST',{scope:'recent',recentRounds:1,chunkRounds:1});await seen;
 const settings=await route(`/sessions/${id}/memory`,'PATCH',{settings:{injectFacts:false,factInjectionLimit:7}});assert.equal(settings.success,true);
 release();const saved=await pending;assert.equal(saved.success,true,JSON.stringify(saved));assert.equal(saved.data.manualMemory.settings.injectFacts,false);assert.equal(saved.data.manualMemory.settings.factInjectionLimit,7);
 // Core V3 schema compatibility: full historical user data fields survive save.
 assert.equal(saved.data.messages.length,msgs.length);
 console.log('PASS v1.3.9: multi-range fact summary, atomic replace-all failure, concurrent settings preservation and source-message retention');
})().catch(e=>{console.error(e);process.exitCode=1});
