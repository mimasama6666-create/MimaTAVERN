'use strict';
// Deterministic node simulation of Persona mount -> prompt -> real send path.
// Provider is mocked. No real browser, remote provider, or personal records.
const assert=require('node:assert/strict');
const records=new Map(),copy=v=>v===undefined?undefined:structuredClone(v);
function db(){return {close(){},transaction(){const staged=new Map([...records].map(([k,v])=>[k,copy(v)]));let pending=0,ended=false,aborted=false;const tx={oncomplete:null,onabort:null,error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.());}};const done=()=>{if(pending||ended||aborted)return;ended=true;setImmediate(()=>{records.clear();for(const [k,v] of staged)records.set(k,copy(v));tx.oncomplete?.();});};tx.objectStore=()=>({get(k){pending++;const q={result:undefined,onsuccess:null,onerror:null};setImmediate(()=>{q.result=copy(staged.get(k));q.onsuccess?.();pending--;setImmediate(done)});return q;},put(v,k){staged.set(k,copy(v));return{};},delete(k){staged.delete(k);return{};}});return tx;}};}
global.window=global;global.MimaThemeEngine={apply(){},normalizeSettings:x=>x};const prefs=new Map();global.localStorage={getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)};
global.indexedDB={open(){const r={result:db(),onsuccess:null};setImmediate(()=>r.onsuccess?.());return r;}};
require('../local-store.js');require('../standalone-core.js');
let sent=0;global.fetch=async(_url,opts)=>{const body=JSON.parse(opts.body);sent++;assert(body.messages.some(m=>m.content.includes('PERSONA_END')),'Persona must be sent intact');return {ok:true,status:200,headers:{get:()=> 'application/json'},clone(){return this},json:async()=>({choices:[{message:{content:'角色成功答复。'},finish_reason:'stop'}]}),text:async()=>JSON.stringify({choices:[{message:{content:'角色成功答复。'},finish_reason:'stop'}]})};};
(async()=>{
 await MimaStandalone.init();MimaStandalone.saveApiConfig({apiBase:'https://mock.invalid/v1',model:'million-context-model',contextWindowTokens:0,stream:false});
 const created=await MimaStandalone.handle('/sessions','POST',{title:'R10.1 Persona 挂载回放'});assert(created.success);const s=created.data;
 const payload='角色设定持续有效。'.repeat(20500)+'PERSONA_END';
 const mask=await MimaStandalone.handle('/masks','POST',{name:'刚更新的 Persona',type:'user',content:payload});assert(mask.success);
 const history=Array.from({length:12},(_,i)=>({id:'turn-'+i,role:i%2?'assistant':'user',content:'才气学院的剧情'+String(i)+'：上一次发生的内容需要继续。',rawContent:'才气学院的剧情'+i}));
 assert((await MimaStandalone.handle(`/sessions/${s.id}`,'PATCH',{loadedUserMaskId:mask.data.id,messages:history,promptSettings:{recentMessageLimit:34}})).success);
 const preview=await MimaStandalone.handle(`/sessions/${s.id}/prompt-preview`,'POST',{draft:'外面怎么样？'});
 assert(preview.success,JSON.stringify(preview));assert(preview.data.estimatedInputTokens>70000,'must exercise screenshot-sized prompt');
 assert.equal(preview.data.contextTrace.budgetVerified,false);assert.equal(preview.data.contextTrace.sourceWindow,null);assert.equal(preview.data.contextTrace.budgetPolicy,'unverified_provider_authoritative');
 assert(preview.data.sections.some(x=>x.name==='user_persona'&&x.chars>150000));
 const before=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data.messages.length;
 const good=await MimaStandalone.handle(`/sessions/${s.id}/chat`,'POST',{text:'外面怎么样？',action:'send'});
 assert(good.success,JSON.stringify(good));assert.equal(sent,1,'exactly one provider request');
 const after=(await MimaStandalone.handle(`/sessions/${s.id}`,'GET')).data;
 assert.equal(after.messages.length,before+2,'canonical History keeps all original turns and adds one exchange');
 assert(after.messages.some(m=>m.role==='assistant'&&m.content==='角色成功答复。'));
 console.log('PASS unconfigured context: 70k+ Persona prompt reaches provider and replies, full History preserved');
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:32768});
 const explicitTooSmall=await MimaStandalone.handle(`/sessions/${s.id}/prompt-preview`,'POST',{});
 assert.equal(explicitTooSmall.code,'E_CONTEXT_BUDGET_BASE');assert.equal(sent,1,'declared undersized config fails before sending');
 console.log('PASS configured 32768 stays fail-closed, no Persona/History trimming');
 MimaStandalone.saveApiConfig({...MimaStandalone.getApiConfig(),contextWindowTokens:1000000});
 const explicitLarge=await MimaStandalone.handle(`/sessions/${s.id}/prompt-preview`,'POST',{});
 assert(explicitLarge.success,JSON.stringify(explicitLarge));assert.equal(explicitLarge.data.contextTrace.budgetVerified,true);assert.equal(explicitLarge.data.contextTrace.sourceWindow,1000000);
 console.log('PASS configured 1000000 allows intact Persona and recent History');
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const appSource=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 const begin=appSource.indexOf('function handleGenerationProgress(payload)');
 const finish=appSource.indexOf('\nfunction clearLiveStream()',begin);
 assert(begin>=0&&finish>begin,'real UI callback must exist');
 const composer={value:'这是已经写入 History 的玩家消息'};
 const ui={currentGenerationAction:'send',deferredGenerationProgress:null,
   qs:id=>id==='story-input'?composer:null,autoResizeInput(){},isSettingsOpen:()=>false,setGenerationProgress(){}};
 vm.createContext(ui);vm.runInContext(appSource.slice(begin,finish),ui);
 ui.handleGenerationProgress({phase:'preparing'});assert(composer.value);
 ui.handleGenerationProgress({phase:'saved_user'});assert.equal(composer.value,'','saved user must not be left ready for duplicate Send');
 composer.value='下一段未发送文字';ui.currentGenerationAction='regenerate';ui.handleGenerationProgress({phase:'saved_user'});assert.equal(composer.value,'下一段未发送文字');
 console.log('PASS confirmed saved_user UI clears only already-committed send input');
})().catch(e=>{console.error(e);process.exitCode=1;});
