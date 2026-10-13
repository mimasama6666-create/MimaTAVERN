'use strict';
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const ui={ 'ctx-title':{value:'测试剧本'},'ctx-canon':{value:'alternate'},'ctx-temp':{value:'0.75'},
 'ctx-pinned':{value:''},'ctx-usernotes':{value:''},'ctx-ainotes':{value:''},
 'ctx-recent':{value:'100',focus(){}},'ctx-summary-trigger':{value:'28'},'ctx-wbbudget':{value:'16000'},
 'ctx-airp-mode':{value:'auto'},'ctx-summary':{checked:true},'ctx-pinned-on':{checked:true} };
 const prefs=new Map(),toasts=[],sent=[];let mockFailure=false;let apiCfg={temperature:0.85};
 const context={console, setTimeout, clearTimeout, AbortController,addEventListener(){},
  window:{addEventListener(){},MimaLocalStore:{}},
  document:{getElementById:id=>ui[id]||null, querySelectorAll:()=>[]},
  localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v),removeItem:k=>prefs.delete(k)},
  MimaStandalone:{handle:async(endpoint,method,body)=>{
    sent.push({endpoint,method,body});if(mockFailure)return {success:false,msg:'写入事务失败'};
    return {success:true,data:{id:'story-1',title:body.title,promptSettings:body.promptSettings}};
  },getApiConfig:()=>apiCfg,saveApiConfig:c=>{apiCfg=c}},
  MimaLocalStore:{},MimaFontManager:{},MimaThemeEngine:{} };
 context.window=context;
 vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});
 vm.runInContext(`currentSessionId='story-1';currentSessionData={title:'原名',promptSettings:{recentMessageLimit:34}};
 refreshSessionSummaryList=async()=>{};refreshHeader=()=>{};applyCustomCss=()=>{};renderSettings=()=>{};
 toast=t=>globalThis.TEST_TOASTS.push(t);`,context);
 context.TEST_TOASTS=toasts;
 const box={innerHTML:''};context.TEST_BOX=box;
 vm.runInContext('renderContextTab(TEST_BOX)',context);
 assert.match(box.innerHTML,/onclick="saveContextSettings\(\)"/,'context page must offer an actual save action');
 assert.match(box.innerHTML,/id="ctx-recent"[^>]+value="34"/,'prior value visible');
 const saved=await vm.runInContext('saveContextSettings()',context);
 assert.equal(saved.promptSettings.recentMessageLimit,100,'UI must send and persist 100');
 assert.equal(sent.at(-1).body.promptSettings.recentMessageLimit,100);
 assert.equal(apiCfg.temperature,0.75,'temperature only after session commit');
 vm.runInContext('renderContextTab(TEST_BOX)',context);
 assert.match(box.innerHTML,/id="ctx-recent"[^>]+value="100"/,'re-entering context displays committed 100');
 assert(toasts.some(t=>t.includes('100')),'success should reflect committed value');
 const n=sent.length;ui['ctx-recent'].value='201';const invalid=await vm.runInContext('saveContextSettings()',context);
 assert.equal(invalid,null);assert.equal(sent.length,n,'out of range must not PATCH');
 ui['ctx-recent'].value='90';mockFailure=true;toasts.length=0;apiCfg={temperature:0.5};
 const failed=await vm.runInContext('saveContextSettings()',context);
 assert.equal(failed,null);assert.equal(apiCfg.temperature,0.5,'failed session write cannot partially update api temperature');
 assert(!toasts.some(t=>t.includes('已保存')),'failure must not report success');
 console.log('PASS context UI real save handler: 100 persisted and rerendered; invalid input / failed transaction safe');
})().catch(e=>{console.error(e);process.exitCode=1});
