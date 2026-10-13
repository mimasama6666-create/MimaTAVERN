'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
global.window=global;
const vars=new Map();global.localStorage={getItem:k=>vars.get(k)||null,setItem:(k,v)=>vars.set(k,String(v)),removeItem:k=>vars.delete(k)};
const copy=x=>structuredClone(x);
let canonical={schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default'}};
global.MimaLocalStore={loadState:async()=>copy(canonical),saveState:async(s,n)=>{assert.equal(n,canonical.storeRevision);canonical=copy({...s,storeRevision:n+1});return copy(canonical);}};
for(const module of ['theme-engine','regex-engine','persona-macro-resolver','user-input-semantic-parser','novel-memory','novel-engine','novel-prompt-assembler','standalone-core'])require('../'+module+'.js');
const get=async(path,method='GET',body)=>{const r=await MimaStandalone.handle(path,method,body);assert.equal(r.success,true,`${path}: ${JSON.stringify(r).slice(0,600)}`);return r.data;};
const occurrences=(messages,value)=>messages.reduce((n,m)=>n+m.content.split(value).length-1,0);
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({contextWindowTokens:1000000,maxTokens:1500});
 const disabled=await get('/masks','POST',{name:'DISABLED_MASK',enabled:false,description:'MASK_DISABLED_MARKER',aliases:['ALIAS_DISABLED']});
 const char=await get('/masks','POST',{name:'角色一号',enabled:true,description:'ONE_DESC_MARKER'});
 const user=await get('/masks','POST',{name:'玩家一号',enabled:true,content:'USER_MASK_MARKER'});
 const on=await get('/presets','POST',{name:'生效预设',content:'PRESET_PRESENT_MARKER',enabled:true});
 const off=await get('/presets','POST',{name:'关闭预设',content:'PRESET_DISABLED_MARKER',enabled:false});
 const large= 'OVERSIZE_FIRST_MARKER'+'字'.repeat(1314);
 const wb=await get('/worldbooks','POST',{name:'预算世界书',entries:[
  {name:'大条目',content:large,priority:0,alwaysActive:true,depth:0},
  {name:'小条目',content:'VALID_WORLDBOOK_MARKER',priority:5,alwaysActive:true,depth:0},
  {name:'没关键词命中',content:'MISSED_KEYWORD_MARKER',keywords:['UNSEEN_KEYWORD_123'],depth:0},
  {name:'深度注入',content:'DEPTH_WORLDBOOK_MARKER',priority:10,alwaysActive:true,depth:3},
  {name:'关闭条目',content:'DISABLED_ENTRY_MARKER',enabled:false,alwaysActive:true}]});
 const wbOff=await get('/worldbooks','POST',{name:'禁用整本',enabled:false,entries:[{alwaysActive:true,content:'DISABLED_BOOK_MARKER'}]});
 const history=Array.from({length:100},(_,i)=>({role:i%2?'assistant':'user',content:`第 ${i+1} 条普通剧情，没有配置文本。` }));
 let s=await get('/sessions','POST',{title:'Prompt chain R11.24'});
 s=await get(`/sessions/${s.id}`,'PATCH',{loadedCharMaskId:disabled.id,loadedUserMaskId:user.id,presetIds:[on.id,off.id],worldbookIds:[wb.id,wbOff.id],promptSettings:{worldbookBudgetChars:1000,recentMessageLimit:100},messages:history});
 let preview=await get(`/sessions/${s.id}/prompt-preview`,'POST');
 assert.equal(preview.messagePreview.length,103,'100 history + system + reference envelope + depth');
 assert.equal(occurrences(preview.messagePreview,'MASK_DISABLED_MARKER'),0,'disabled mask leaked');
 assert.equal(occurrences(preview.messagePreview,'DISABLED_BOOK_MARKER'),0);
 assert.equal(occurrences(preview.messagePreview,'PRESET_DISABLED_MARKER'),0);
 assert.equal(occurrences(preview.messagePreview,'OVERSIZE_FIRST_MARKER'),0,'first oversized entry must not slip through');
 assert.equal(occurrences(preview.messagePreview,'VALID_WORLDBOOK_MARKER'),1);
 assert.equal(occurrences(preview.messagePreview,'DEPTH_WORLDBOOK_MARKER'),1);
 assert.equal(occurrences(preview.messagePreview,'MISSED_KEYWORD_MARKER'),0);
 assert.equal(occurrences(preview.messagePreview,'PRESET_PRESENT_MARKER'),1);
 assert.equal(occurrences(preview.messagePreview,'USER_MASK_MARKER'),1);
 assert(preview.messagePreview.some(x=>x.role==='system'&&x.content.includes('PRESET_PRESENT_MARKER')));
 assert(!preview.actualSystemPreview.includes('VALID_WORLDBOOK_MARKER'),'user data must not masquerade as system');
 assert(preview.userMaterialPreview.includes('VALID_WORLDBOOK_MARKER'));
 assert.equal(preview.maskTrace.find(x=>x.kind==='character').reason,'disabled');
 assert.equal(preview.worldbookMountTrace.find(x=>x.bookId===wbOff.id).reason,'disabled_book');
 assert.equal(preview.skippedWorldbookEntries.find(x=>x.entryName==='大条目').reason,'budget');
 assert(preview.worldbookUsedChars<=1000,'hard worldbook budget');
 assert.equal(preview.presetTrace.find(x=>x.id===on.id).role,'system');
 const original=canonical.sessions.find(x=>x.id===s.id).messages.length;assert.equal(original,100);
 // Enable a mask with only description: still one copy of the description.
 await get(`/sessions/${s.id}`,'PATCH',{loadedCharMaskId:char.id});
 preview=await get(`/sessions/${s.id}/prompt-preview`,'POST');
 assert.equal(occurrences(preview.messagePreview,'ONE_DESC_MARKER'),1,'legacy content=description duplication');
 assert.equal(preview.maskTrace.find(x=>x.kind==='character').reason,'included');
 // Persist and reload. Test the outgoing HTTP body, not only a GUI preview.
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'https://offline.invalid/v1',model:'offline-model',contextWindowTokens:1000000,maxTokens:1500,stream:false,sendTemperature:false});
 let sent=null,calls=0;global.fetch=async(url,opts)=>{calls++;sent=JSON.parse(opts.body).messages;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'角色回应了剧情。'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}})};
 const reply=await get(`/sessions/${s.id}/chat`,'POST',{text:'我继续说话。',action:'send'});
 assert.equal(calls,1);assert.equal(occurrences(sent,'PRESET_PRESENT_MARKER'),1);assert.equal(occurrences(sent,'ONE_DESC_MARKER'),1);assert.equal(occurrences(sent,'VALID_WORLDBOOK_MARKER'),1);assert.equal(occurrences(sent,'MASK_DISABLED_MARKER'),0);assert.equal(occurrences(sent,'OVERSIZE_FIRST_MARKER'),0);
 assert.equal(reply.messages.length,102,'reply must add only user + assistant');
 assert.equal(canonical.sessions.find(x=>x.id===s.id).messages.length,102);
 assert(!canonical.sessions.find(x=>x.id===s.id).messages.some(m=>/PRESET_PRESENT_MARKER|ONE_DESC_MARKER|VALID_WORLDBOOK_MARKER/.test(m.content)),'no canonical History pollution');
 const app=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');assert(app.includes('d.actualSystemPreview'),'inspector must show real system');assert(app.includes('d.userMaterialPreview'),'inspector must show real user data');
 console.log('PASS R11.24: 100 history, enabled states, mask duplication, strict worldbook budget, inspector role transparency, canonical integrity and mocked outgoing HTTP route');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
