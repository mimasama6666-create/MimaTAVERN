'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const base=path.join(__dirname,'..');
const elements=new Map(),styles={};
function node(id){if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',disabled:false,style:{},dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},appendChild(){},addEventListener(){},querySelector(){return null},querySelectorAll(){return []}});return elements.get(id)}
const memory={};let handler=async()=>({success:false,msg:'not mocked'});
const ctx={console,Promise,setTimeout,clearTimeout,Number,String,Date,Math,JSON,Array,URLSearchParams,location:{search:''},
 localStorage:{getItem:k=>memory[k]??null,setItem:(k,v)=>memory[k]=String(v),removeItem:k=>delete memory[k]},
 document:{getElementById:node,querySelectorAll:()=>[],createElement:tag=>({...node(`temp_${tag}`),tagName:tag,isConnected:false}),documentElement:{style:{setProperty:(name,val)=>styles[name]=val}},head:{appendChild(){}}},
 MimaStandalone:{handle:(...args)=>handler(...args),getApiConfig:()=>({apiBase:'mock',temperature:0.85}),saveApiConfig(){},getState:()=>({themeSettings:{}})},
 MimaFontManager:{applySelected(){},getSelected:()=>''},MimaLocalStore:{getMemoryJob:async()=>null},
 MimaThemeEngine:{},MimaRegexEngine:{},MimaAssistantStudio:{},MimaCompatUI:{open(){}},window:null};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.AbortController=AbortController;
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(base,'app.js'),'utf8'),ctx,{filename:'app.js'});
const run=src=>vm.runInContext(src,ctx);
const noop="refreshHeader=()=>{};refreshChatBox=()=>{};renderSessions=()=>{};applyCustomCss=()=>{};renderSettings=()=>{};closeDrawer=()=>{};closeSettings=()=>{};";
run(noop);
let seq=0;const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
(async()=>{
 // 1. Read error must not erase the existing projection.
 run("sessions=[{id:'KEEP'}]; masks=[{id:'MASK'}];currentSessionId='KEEP';currentSessionData={id:'KEEP'}");
 handler=async(endpoint)=>endpoint==='/worldbooks'?{success:false,msg:'IDB aborted'}:{success:true,data:[]};
 await assert.rejects(ctx.loadAll(),/E_LIBRARY_READ_UNVERIFIED/);
 assert.strictEqual(run('sessions[0].id'),'KEEP');assert.strictEqual(run('masks[0].id'),'MASK');assert.strictEqual(run('currentSessionData.id'),'KEEP');
 // 2. Slow session A cannot override fast session B.
 const a=deferred(),b=deferred();handler=async(endpoint)=>endpoint==='/sessions/A'?a.promise:endpoint==='/sessions/B'?b.promise:{success:true,data:[]};
 const old=ctx.openSession('A',false),recent=ctx.openSession('B',false);
 b.resolve({success:true,data:{id:'B',messages:[]}});await recent;
 a.resolve({success:true,data:{id:'A',messages:[]}});await old;
 assert.strictEqual(run('currentSessionId'),'B');
 // 3. A patch started for B must not replace C when the player switches.
 const pending=deferred();handler=async(endpoint,method)=>endpoint==='/sessions/B'&&method==='PATCH'?pending.promise:{success:true,data:[]};
 const patch=ctx.patchCurrent({title:'Saved in B'},true);
 run("currentSessionId='C';currentSessionData={id:'C',messages:[]}");
 pending.resolve({success:true,data:{id:'B',title:'Saved in B'}});await patch;
 assert.strictEqual(run('currentSessionData.id'),'C');
 // 4. Session deletion failure cannot clear the local UI state.
 ctx.confirm=()=>true;handler=async()=>({success:false,msg:'write aborted'});run("currentSessionId='C';currentSessionData={id:'C'}");
 await ctx.deleteCurrentSession();assert.strictEqual(run('currentSessionId'),'C');
 // 5. A generation started in C must not paint its late response into D.
 run("currentSessionId='C';currentSessionData={id:'C',messages:[]}");
 ctx.refreshSessionSummaryList=async()=>{};
 run("refreshSessionSummaryList=async()=>{}");
 const generation=deferred();handler=async(endpoint)=>endpoint==='/sessions/C/chat'?generation.promise:{success:true,data:[]};
 node('story-input').value='do not clear this D draft';
 const turn=ctx.triggerChat('','continue');
 assert.strictEqual(run('isGenerating'),true);
 run("currentSessionId='D';currentSessionData={id:'D',messages:[]}");
 ctx.stopGeneration();
 assert.strictEqual(run('isGenerating'),true,'abort request is not settlement');
 generation.resolve({success:true,data:{id:'C',messages:[{id:'message-C',role:'assistant',content:'old text'}]}});
 await turn;assert.strictEqual(run('currentSessionData.id'),'D');assert.strictEqual(node('story-input').value,'do not clear this D draft');
 assert.strictEqual(run('isGenerating'),false);
 // 6. Legacy URL font must not defeat a selected separate story font.
 vm.runInContext(fs.readFileSync(path.join(base,'font-manager.js'),'utf8'),ctx,{filename:'font-manager.js'});
 memory['storyFontUrl']='https://fonts.example/a.woff2';memory['storyFontFamily']='LegacyStory';memory['mimamao_tavern_ui_font']='UILocal';memory['mimamao_tavern_story_font']='StoryLocal';
 ctx.MimaFontManager.applySelected();assert(styles['--font-ui'].includes('UILocal'));assert(styles['--font-story'].includes('StoryLocal'));assert(!styles['--font-story'].includes('LegacyStory'));
 delete memory['mimamao_tavern_story_font'];ctx.MimaFontManager.applySelected();assert(styles['--font-story'].includes('LegacyStory'));assert(styles['--font-ui'].includes('UILocal'));
 ctx.restoreLegacyFont();assert(!node('legacy-url-font-style').textContent.includes('!important'));
 console.log('PASS native causal lifecycle: read fail closed, latest navigation, stale patch, delete failure, stale generation, settlement boundary, split font priority');
})().catch(e=>{console.error(e);process.exitCode=1});
