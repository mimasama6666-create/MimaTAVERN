/** MIMAMAO Tavern v1.1.7 User Input Semantic Parser / epistemic-boundary smoke. */
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

  // 1) User-preferred style: plain speech + parenthetical action/private thought.
  const a=MimaUserInputSemanticParser.compile('你今天怎么啦？（伸手抱住他，心想：这只狗怎么这么可爱）',{mode:'auto'}).prompt;
  assert(a.includes('<PLAYER_SPEECH>你今天怎么啦？</PLAYER_SPEECH>'),'plain dialogue was not recognized as speech');
  assert(a.includes('<PLAYER_STAGE>伸手抱住他</PLAYER_STAGE>'),'parenthetical action was not separated');
  assert(a.includes('<PLAYER_PRIVATE_THOUGHT>这只狗怎么这么可爱</PLAYER_PRIVATE_THOUGHT>'),'explicit private thought was not separated');
  assert(!a.includes('<PLAYER_SPEECH>伸手抱住他'),'parenthetical action leaked into speech');

  // 2) Common AIRP style: action, “quoted speech” (private thought).
  const b=MimaUserInputSemanticParser.compile('我走到门边，“别过来。”（心想：钥匙在抽屉里）',{mode:'auto'}).prompt;
  assert(b.includes('<PLAYER_ACTION>我走到门边，</PLAYER_ACTION>'),'plain action around explicit quote was not recognized');
  assert(b.includes('<PLAYER_SPEECH>别过来。</PLAYER_SPEECH>'),'quoted dialogue was not recognized');
  assert(b.includes('<PLAYER_PRIVATE_THOUGHT>钥匙在抽屉里</PLAYER_PRIVATE_THOUGHT>'),'private thought after quoted dialogue was not private');

  // 3) Cautious action heuristic when no quotes are present.
  const c=MimaUserInputSemanticParser.compile('我走过去',{mode:'auto'}).prompt;
  assert(c.includes('<PLAYER_ACTION>我走过去</PLAYER_ACTION>'),'obvious unquoted action heuristic failed');

  // 4) Per-user override modes remain explicit and predictable.
  const d=MimaUserInputSemanticParser.compile('我走过去',{mode:'dialogue_first'}).prompt;
  assert(d.includes('<PLAYER_SPEECH>我走过去</PLAYER_SPEECH>'),'dialogue_first override failed');
  const e=MimaUserInputSemanticParser.compile('你好',{mode:'quote_dialogue'}).prompt;
  assert(e.includes('<PLAYER_ACTION>你好</PLAYER_ACTION>'),'quote_dialogue override failed');
  assert.strictEqual(MimaUserInputSemanticParser.compile('（动作）你好',{mode:'raw'}).prompt,'（动作）你好','raw legacy mode altered input');

  const user=(await MimaStandalone.handle('/masks','POST',{type:'user',name:'天束みま'})).data;
  const char=(await MimaStandalone.handle('/masks','POST',{type:'character',name:'闻千屿'})).data;
  const session=(await MimaStandalone.handle('/sessions','POST',{title:'semantic test',loadedUserMaskId:user.id,loadedCharMaskId:char.id,promptSettings:{inputSemanticMode:'auto',recentMessageLimit:34}})).data;
  const raw='别闹啦。（趁他没看见，把钥匙塞进抽屉，心想：绝对不能让他发现）';
  await MimaStandalone.handle(`/sessions/${session.id}`,'PATCH',{messages:[{role:'user',content:raw,rawContent:raw,metadata:{source:'manual_send',inputSemanticMode:'auto',inputSemanticParserVersion:'1.1.7'}}]});
  const fresh=(await MimaStandalone.handle(`/sessions/${session.id}`,'GET')).data;
  const built=MimaStandalone.assemble(fresh);
  const system=built.messages[0].content;
  const userMsg=built.messages.find(m=>m.role==='user');

  assert(system.includes('文本对模型可见 ≠ 文本对角色可知'),'epistemic hard boundary missing from system prompt');
  assert(system.includes('PLAYER_PRIVATE_THOUGHT'),'semantic legend missing from system prompt');
  assert(userMsg.content.includes('<PLAYER_SPEECH>别闹啦。</PLAYER_SPEECH>'),'stored player dialogue not compiled into semantic prompt');
  assert(userMsg.content.includes('<PLAYER_STAGE>趁他没看见，把钥匙塞进抽屉</PLAYER_STAGE>'),'hidden action not compiled as stage');
  assert(userMsg.content.includes('<PLAYER_PRIVATE_THOUGHT>绝对不能让他发现</PLAYER_PRIVATE_THOUGHT>'),'private thought not protected');
  assert.strictEqual(fresh.messages[0].content,raw,'canonical stored user content was destructively rewritten');
  assert.strictEqual(fresh.messages[0].rawContent,raw,'raw player message was destructively rewritten');
  assert.strictEqual(userMsg.role,'user','canonical API user role was rewritten');

  // Message-local mode is stable even if the Session default later changes.
  await MimaStandalone.handle(`/sessions/${session.id}`,'PATCH',{promptSettings:{...fresh.promptSettings,inputSemanticMode:'raw'}});
  const changed=(await MimaStandalone.handle(`/sessions/${session.id}`,'GET')).data;
  const rebuilt=MimaStandalone.assemble(changed);
  assert(rebuilt.messages.find(m=>m.role==='user').content.includes('<PLAYER_PRIVATE_THOUGHT>'),'old message semantic mode was reinterpreted after Session setting changed');

  // Direct helper uses the requested mode for previews/new turns.
  const direct=MimaStandalone.compileUserInputForPrompt(changed,'你好（挥手）','dialogue_first');
  assert(direct.includes('<PLAYER_SPEECH>你好</PLAYER_SPEECH>')&&direct.includes('<PLAYER_STAGE>挥手</PLAYER_STAGE>'),'core semantic compiler helper failed');

  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
  assert(html.includes('user-input-semantic-parser.js?v=1.1.7'),'semantic parser sidecar is not loaded before core');
  assert(html.includes('release=1.1.7'),'v1.1.7 cache-bust marker missing');
  assert(app.includes('AIRP 输入语义'),'per-Session AIRP mode control missing');
  assert(app.includes('ctx-airp-mode'),'AIRP mode is not persisted from Context settings');

  console.log('PASS v1.1.7: AIRP speech/action/private-thought semantics are compiled at prompt time with epistemic boundaries while raw Store/UI data stays intact');
})().catch(err=>{console.error(err);process.exit(1)});
