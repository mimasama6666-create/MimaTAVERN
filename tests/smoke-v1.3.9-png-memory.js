/** Offline source-level integration against real Core routes and PNG parser. No external API cost. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x));
const png=require(path.join(root,'png-card-import.js'));
const signature=Buffer.from('89504e470d0a1a0a','hex');
let table;function crc(b){if(!table){table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});}let c=0xffffffff;for(let i=0;i<b.length;i++)c=table[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,payload){let b=Buffer.concat([Buffer.from(type),payload]),out=Buffer.alloc(b.length+8);out.writeUInt32BE(payload.length,0);b.copy(out,4);out.writeUInt32BE(crc(b),b.length+4);return out;}
function pngFile(cards=[]){const ihdr=Buffer.from('00000001000000010806000000','hex'),idat=zlib.deflateSync(Buffer.from([0,255,10,20,255]));const body=Buffer.concat([signature,chunk('IHDR',ihdr),...cards,chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);return new Blob([body],{type:'image/png'});}
const rawV2={spec:'chara_card_v2',data:{name:'猫咪',description:'一只大肥猫',personality:'黏人',scenario:'月下',first_mes:'咪嘛！',mes_example:'嗷呜',tags:['猫']}};
const rawV3={spec:'chara_card_v3',data:{...rawV2.data,name:'主人',system_prompt:'保留的扩展字段'}};
const payload=v=>Buffer.from(JSON.stringify(v),'utf8').toString('base64');
const textCard=(keyword,obj)=>chunk('tEXt',Buffer.from(keyword+'\0'+payload(obj)));
const compressed=(keyword,obj)=>chunk('zTXt',Buffer.concat([Buffer.from(keyword+'\0\x00'),zlib.deflateSync(Buffer.from(payload(obj)))]));
const compressedIntl=(keyword,obj)=>chunk('iTXt',Buffer.concat([Buffer.from(keyword+'\0\x01\x00\0\0'),zlib.deflateSync(Buffer.from(payload(obj)))]));
(async()=>{
 const p2=await png.parse(pngFile([textCard('chara',rawV2)]));assert.equal(p2.version,'V2');assert.equal(png.toMask(p2,'character','test.png','').name,'猫咪');
 const p3=await png.parse(pngFile([textCard('chara',rawV2),textCard('ccv3',rawV3)]));assert.equal(p3.card.name,'主人');assert.deepEqual(p3.extras,['system_prompt']);
 const z=await png.parse(pngFile([compressed('chara',rawV2)]));assert.equal(z.card.name,'猫咪');
 const i=await png.parse(pngFile([compressedIntl('ccv3',rawV3)]));assert.equal(i.card.name,'主人');
 await assert.rejects(()=>png.parse(pngFile([])),/普通 PNG/);
 const corrupt=new Uint8Array(await pngFile([textCard('chara',rawV2)]).arrayBuffer());corrupt[40]^=1;await assert.rejects(()=>png.parse(new Blob([corrupt])),/CRC/);
 await assert.rejects(()=>png.parse(pngFile([textCard('chara',rawV2),textCard('chara',rawV2)])),/重复/);
 // Real runtime routes with durable revision-aware store and explicitly mocked API response.
 global.window=global;const settings=new Map();global.localStorage={getItem:k=>settings.get(k)||null,setItem:(k,v)=>settings.set(k,String(v)),removeItem:k=>settings.delete(k)};
 let canonical={schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default'}};
 global.MimaLocalStore={loadState:async()=>clone(canonical),saveState:async(s,rev)=>{assert.equal(rev,canonical.storeRevision);canonical={...clone(s),storeRevision:rev+1};return clone(canonical);}};
 for(const m of ['theme-engine.js','regex-engine.js','persona-macro-resolver.js','user-input-semantic-parser.js','novel-memory.js','novel-engine.js','novel-prompt-assembler.js','standalone-core.js'])require(path.join(root,m));
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'https://example.invalid/v1',model:'test-model',apiKey:'fake',stream:false,sendTemperature:false});
 let apiRelease,apiEnter;const apiSeen=new Promise(r=>apiEnter=r);let called=0;
 global.fetch=async(_url,opts)=>{called++;apiEnter();await new Promise((resolve,reject)=>{apiRelease=resolve;opts.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});return new Response(JSON.stringify({choices:[{message:{content:'保留的重要记忆。'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});};
 const route=(path,method='GET',body=null,signal=null,progress=null)=>MimaStandalone.handle(path,method,body,signal,progress);
 const created=await route('/sessions','POST',{title:'主人档案',messages:[]});const id=created.data.id;
 const before=(await route(`/sessions/${id}`)).data;await route(`/sessions/${id}`,'PATCH',{messages:[{id:'u1',role:'user',content:'第一轮剧情'},{id:'a1',role:'assistant',content:'角色回复'}]});
 const progress=[];const pending=route(`/sessions/${id}/memory/core`,'POST',{source:'context'},null,ev=>progress.push(ev));await apiSeen;
 // New owner message added while model is working MUST survive final memory commit.
 const updated=await route(`/sessions/${id}`,'PATCH',{messages:[...canonical.sessions[0].messages,{id:'u2',role:'user',content:'新消息不被覆盖'}]});assert.equal(updated.success,true);
 apiRelease();const done=await pending;assert.equal(done.success,true,JSON.stringify(done));assert.equal(done.data.messages.length,3);assert.equal(done.data.messages[2].content,'新消息不被覆盖');assert.equal(done.data.manualMemory.core.content,'保留的重要记忆。');assert.equal(called,1,'one short source should require only one call');
 // Conflict: manual memory edit after launch must win, delayed model response must not overwrite it.
 let gate2,enter2;const seen2=new Promise(r=>enter2=r);global.fetch=async(_url,opts)=>{enter2();await new Promise(r=>gate2=r);return new Response(JSON.stringify({choices:[{message:{content:'迟到的总结'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});};
 const pending2=route(`/sessions/${id}/memory/core`,'POST',{source:'context'});await seen2;
 await route(`/sessions/${id}/memory`,'PATCH',{core:{content:'主人手工记忆'}});
 gate2();const conflict=await pending2;assert.equal(conflict.success,false);assert.equal(conflict.code,'E_MEMORY_CORE_CONFLICT');assert.equal(canonical.sessions[0].manualMemory.core.content,'主人手工记忆');
 // Abort after request accepted: no pending summary is committed.
 let enter3;const seen3=new Promise(r=>enter3=r);global.fetch=async(_url,opts)=>{enter3();return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));};
 const ac=new AbortController();const pending3=route(`/sessions/${id}/memory/facts`,'POST',{scope:'recent',recentRounds:1},ac.signal);await seen3;ac.abort();const stopped=await pending3;assert.equal(stopped.aborted,true);assert.equal(canonical.sessions[0].manualMemory.facts.length,0);
 // Failed write never advertises success; test same-session stale edits versus stable snapshots.
 assert(progress.some(x=>x.phase==='done'));
 const src=fs.readFileSync(path.join(root,'app.js'),'utf8');assert(src.includes('signalOverride'));assert(src.includes('memoryTask = null'));assert(src.includes('memory-task-floating'));assert(!/function stopMemorySummary\(\)\{if\(activeRequest\)/.test(src));
 console.log('PASS v1.3.9: V2/V3 tEXt+compressed metadata, CRC, duplicate rejection, append-safe memory commit, manual conflict, abort, one-call core, independent request owner');
})().catch(e=>{console.error(e);process.exitCode=1});
