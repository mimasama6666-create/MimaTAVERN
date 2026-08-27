/** MIMAMAO Tavern v1.1.8 story-history / typography / modal-stream hotfix smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

global.window=global;
const local=new Map();
global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
let stored={schemaVersion:3,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[]};
global.MimaLocalStore={async loadState(){return JSON.parse(JSON.stringify(stored))},async saveState(v){stored=JSON.parse(JSON.stringify(v));return stored}};
require(path.join(ROOT,'persona-macro-resolver.js'));
require(path.join(ROOT,'user-input-semantic-parser.js'));
require(path.join(ROOT,'regex-engine.js'));
require(path.join(ROOT,'standalone-core.js'));

(async()=>{
  await MimaStandalone.init();

  // Per-message delete is a first-class route and removes only the requested turn.
  const session=(await MimaStandalone.handle('/sessions','POST',{title:'delete message test'})).data;
  const patched=(await MimaStandalone.handle(`/sessions/${session.id}`,'PATCH',{messages:[
    {id:'u1',role:'user',content:'保留玩家消息'},
    {id:'a1',role:'assistant',content:'角色错误输出'},
    {id:'a2',role:'assistant',content:'保留正确输出'}
  ]})).data;
  assert.strictEqual(patched.messages.length,3,'fixture messages were not stored');
  const deleted=await MimaStandalone.handle(`/sessions/${session.id}/messages/a1`,'DELETE');
  assert(deleted.success,'message DELETE route failed');
  assert.deepStrictEqual(deleted.data.messages.map(m=>m.id),['u1','a2'],'DELETE removed the wrong active message');
  assert.strictEqual(deleted.data.deletedMessages.length,1,'deleted message recovery record missing');
  assert.strictEqual(deleted.data.deletedMessages[0].content,'角色错误输出','deleted recovery copy content changed');
  assert.strictEqual(deleted.data.deletedMessages[0].metadata.deleteReason,'manual_delete','deleted recovery metadata missing');
  const fresh=(await MimaStandalone.handle(`/sessions/${session.id}`,'GET')).data;
  assert.strictEqual(fresh.messages.length,2,'deleted message reappeared after normalization/persist');
  assert.strictEqual(fresh.deletedMessages.length,1,'deletedMessages was dropped by normalizeSession');

  const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
  const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

  // Player bubbles must use the same reader typography variables as story prose.
  assert(css.includes('.assistant-msg .story-prose,\n.user-msg .story-prose'),'player bubble does not share story typography selector');
  assert(css.includes('.user-msg .story-paragraph{margin:0 0 var(--story-paragraph-gap);text-indent:var(--story-first-line-indent)}'),'player paragraph gap/indent not wired');
  assert(app.includes("const allowHtml=role==='assistant'&&currentSessionData?.renderMode==='safe_html'"),'Safe HTML should not reinterpret raw player text as HTML');

  // Safe HTML preview must expose every typography dimension, not only inherited font size.
  assert(app.includes('story-prose story-paragraph typography-preview-html-prose'),'Safe HTML preview prose lacks story paragraph typography classes');
  assert(app.includes('第二段 Safe HTML 正文'),'Safe HTML preview needs multiple paragraphs to reveal paragraph-gap changes');
  assert(app.includes('typography-preview-user'),'appearance preview does not show player bubble typography');
  assert(css.includes('.typography-preview-html-prose{margin:0 0 var(--story-paragraph-gap);padding:0}'),'preview hard-coded margin still masks paragraphGap');

  // While Settings is open, expensive full-stream regex/HTML repaints are paused, but network text is still buffered.
  assert(app.includes('if(isSettingsOpen()||liveStreamState.visualPaused)return'),'stream painter is not paused behind Settings modal');
  assert(app.includes('deferredGenerationProgress=payload'),'generation progress is not deferred while Settings is open');
  assert(app.includes('st.targetText=String(payload.streamText||\'\')'),'stream text is not buffered while visual rendering is paused');
  assert(app.includes('if(deferredGenerationProgress){setGenerationProgress(deferredGenerationProgress);deferredGenerationProgress=null}'),'closing Settings does not restore deferred progress state');

  // Story message UI now exposes deletion both inline and from editor.
  assert(app.includes("makeToolButton('删除',()=>deleteStoryMessage(msg),true)"),'inline story-message delete control missing');
  assert(app.includes("setupEditorButtons(truncateAfter?null:()=>deleteStoryMessage(msg),saveMessageEditor)"),'editor delete control missing');
  assert(html.includes('release=1.1.8'),'v1.1.8 cache-bust marker missing');

  console.log('PASS v1.1.8: player typography + Safe HTML live preview + responsive Settings during streaming + recoverable per-message deletion');
})().catch(err=>{console.error(err);process.exit(1)});
