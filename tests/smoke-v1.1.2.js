/** MIMAMAO Tavern v1.1.2 Assistant history/UI hotfix smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const src=fs.readFileSync(path.join(ROOT,'assistant-studio.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

assert(src.includes('↻ 重说上一条'),'assistant quick regenerate button missing');
assert(src.includes('MimaAssistantStudio.startEdit'),'assistant per-message edit control missing');
assert(src.includes('MimaAssistantStudio.deleteMessage'),'assistant per-message delete control missing');
assert(src.includes('assistant-config-card') && src.includes('<details class="assistant-config-card"'),'model settings must be collapsible details');
assert(src.includes("ui:{configOpen:!!raw.ui?.configOpen}"),'collapsed config state must migrate additively');
assert(src.includes("requestContent:userContent"),'future assistant turns must retain effective quick-mode request for replay');
assert(css.includes('.assistant-history-editor'),'history editor styling missing');
assert(css.includes('.assistant-config-summary'),'collapsed model settings styling missing');
assert(html.includes('style.css?v=1.1.2'),'style cache version not bumped');
assert(html.includes('assistant-studio.js?v=1.1.2'),'assistant cache version not bumped');

const local=new Map();
local.set('MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1',JSON.stringify({
  profiles:{regex:{model:'helper-model',temperature:.3,stream:true,maxTokens:0}},
  threads:{regex:[
    {role:'user',content:'原问题',requestContent:'旧快捷请求',quickMode:true,time:'2026-08-26T10:00:00.000Z'},
    {role:'assistant',content:'旧回答',time:'2026-08-26T10:00:01.000Z'}
  ],preset:[],css:[]}
  // Deliberately omit ui to verify old local data defaults to collapsed safely.
}));

global.window=global;
global.localStorage={
  getItem:key=>local.has(key)?local.get(key):null,
  setItem:(key,value)=>local.set(key,String(value)),
  removeItem:key=>local.delete(key)
};
const elements=new Map();
global.document={
  getElementById:id=>elements.get(id)||null,
  querySelector:()=>null,
  querySelectorAll:()=>[]
};
global.requestAnimationFrame=fn=>fn();
global.confirm=()=>true;
global.toast=()=>{};
let capturedMessages=null;
global.MimaStandalone={
  getApiConfig:()=>({apiBase:'https://example.invalid/v1',apiKey:'x',model:'story-model',stream:true,sendTemperature:true,maxTokens:64000}),
  callModelWithConfig:async(messages,cfg)=>{
    capturedMessages=messages;
    assert.strictEqual(cfg.model,'helper-model','regenerate must keep assistant model isolated');
    assert.strictEqual(cfg.maxTokens,0,'regenerate must keep assistant maxTokens isolated');
    return '新回答';
  }
};

require(path.join(ROOT,'assistant-studio.js'));

(async()=>{
  let state=MimaAssistantStudio.getState();
  assert.strictEqual(state.ui.configOpen,false,'legacy assistant state should start collapsed');

  MimaAssistantStudio.setConfigOpen(true);
  state=MimaAssistantStudio.getState();
  assert.strictEqual(state.ui.configOpen,true,'config fold state not persisted');

  elements.set('assistant-edit-0',{value:'修改后的问题'});
  MimaAssistantStudio.saveEdit(0);
  state=MimaAssistantStudio.getState();
  assert.strictEqual(state.threads.regex[0].content,'修改后的问题','history edit did not persist visible text');
  assert(state.threads.regex[0].requestContent.includes('修改后的问题'),'edited quick-mode message did not rebuild effective request');
  assert(state.threads.regex[0].requestContent.includes('快捷任务'),'edited quick-mode message lost quick instruction');

  await MimaAssistantStudio.regenerate(1);
  state=MimaAssistantStudio.getState();
  assert.strictEqual(state.threads.regex.length,2,'regenerate must replace, not append, assistant history');
  assert.strictEqual(state.threads.regex[1].content,'新回答','regenerate did not replace target assistant reply');
  assert(capturedMessages.some(m=>m.role==='user'&&m.content.includes('修改后的问题')),'regenerate did not use edited user history');

  MimaAssistantStudio.deleteMessage(1);
  state=MimaAssistantStudio.getState();
  assert.strictEqual(state.threads.regex.length,1,'per-message delete failed');
  assert.strictEqual(state.threads.regex[0].content,'修改后的问题','delete removed the wrong history message');

  console.log('PASS v1.1.2: collapsed assistant model panel + edit/delete history + safe in-place regenerate');
})().catch(err=>{console.error(err);process.exit(1)});
