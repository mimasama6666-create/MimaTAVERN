/** MIMAMAO Tavern v1.1.6 Persona Macro Resolver / prompt + display boundary smoke. */
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
require(path.join(ROOT,'regex-engine.js'));
require(path.join(ROOT,'standalone-core.js'));

(async()=>{
  await MimaStandalone.init();
  const user=(await MimaStandalone.handle('/masks','POST',{type:'user',name:'天束みま',content:'{{user}}是玩家；{{char}}是当前角色。'})).data;
  const char=(await MimaStandalone.handle('/masks','POST',{type:'character',name:'闻千屿',content:'{{char}}认识{{user}}。'})).data;
  const preset=(await MimaStandalone.handle('/presets','POST',{name:'宏测试',type:'format',priority:50,content:'状态栏必须显示：{{user}} / {{char}}。'})).data;
  const wb=(await MimaStandalone.handle('/worldbooks','POST',{name:'宏世界书',entries:[
    {name:'front',content:'世界书前置：{{user}}与{{char}}。',alwaysActive:true,position:'front',depth:0},
    {name:'depth',content:'深度世界书：{{char}}正在看{{user}}。',alwaysActive:true,position:'middle',depth:1}
  ]})).data;
  const pack=(await MimaStandalone.handle('/regex-packs','POST',{name:'display macro',rules:[{name:'expand',pattern:'<WHO>',replacement:'<div>{{user}} / {{char}}</div>',flags:'g',phase:'display',priority:50,enabled:true}]})).data;
  const session=(await MimaStandalone.handle('/sessions','POST',{
    title:'macro test',loadedUserMaskId:user.id,loadedCharMaskId:char.id,presetIds:[preset.id],worldbookIds:[wb.id],regexPackIds:[pack.id],renderMode:'safe_html',
    userNotes:'备注：{{user}}不要被写成内部占位符。',
    pinnedFacts:['{{char}}答应过{{user}}一件事。'],
    manualMemory:{core:{content:'核心记忆：{{user}}相信{{char}}。'},facts:[{startRound:1,endRound:1,content:'事实：{{char}}见过{{user}}。'}],settings:{injectCore:true,injectFacts:true,factInjectionLimit:12}}
  })).data;

  session.messages=[
    {role:'user',content:'{{user}}抬头看{{char}}。'},
    {role:'assistant',content:'{{char}}回应{{user}}。'}
  ];
  await MimaStandalone.handle(`/sessions/${session.id}`,'PATCH',session);
  const fresh=(await MimaStandalone.handle(`/sessions/${session.id}`,'GET')).data;
  const built=MimaStandalone.assemble(fresh);
  const promptText=built.messages.map(m=>m.content).join('\n');

  assert(promptText.includes('天束みま'),'user macro did not resolve in prompt');
  assert(promptText.includes('闻千屿'),'char macro did not resolve in prompt');
  assert(!/\{\{\s*(?:user|char)\s*\}\}/i.test(promptText),'unresolved persona macro leaked into final prompt');
  assert(!promptText.includes('当前 User Persona'),'legacy User Persona label leaked into system prompt');
  assert(!promptText.includes('当前 Character Persona'),'legacy Character Persona label leaked into system prompt');
  assert(promptText.includes('世界书前置：天束みま与闻千屿。'),'front worldbook macro not resolved');
  assert(promptText.includes('深度世界书：闻千屿正在看天束みま。'),'depth worldbook macro not resolved');
  assert(promptText.includes('核心记忆：天束みま相信闻千屿。'),'core memory macro not resolved');
  assert(promptText.includes('状态栏必须显示：天束みま / 闻千屿。'),'preset macro not resolved');

  // API machine role must stay canonical; only natural-language content is resolved.
  assert(built.messages.some(m=>m.role==='user'),'canonical API role user was rewritten');
  assert(built.messages.some(m=>m.role==='assistant'),'canonical API role assistant was rewritten');

  const display=MimaStandalone.applyRegexForSession(fresh,'<WHO>','display');
  assert.strictEqual(display,'<div>天束みま / 闻千屿</div>','display regex replacement macros were not resolved after expansion');
  assert.strictEqual(MimaStandalone.resolveMacrosForSession(fresh,'{{USER}} + {{ char }}'),'天束みま + 闻千屿','case/space tolerant macro resolution failed');

  // Source truth remains macros; resolution is a read/render concern, not a destructive migration.
  const library=await MimaStandalone.exportLibrary();
  assert(library.presets.find(x=>x.id===preset.id).content.includes('{{user}}'),'preset source was destructively rewritten');
  assert(library.worldbooks.find(x=>x.id===wb.id).entries[0].content.includes('{{user}}'),'worldbook source was destructively rewritten');
  assert(library.regexPacks.find(x=>x.id===pack.id).rules[0].replacement.includes('{{user}}'),'regex source was destructively rewritten');

  // No mounted personas: fail soft, never leak raw macros.
  const fallback=(await MimaStandalone.handle('/sessions','POST',{title:'fallback'})).data;
  assert.strictEqual(MimaStandalone.resolveMacrosForSession(fallback,'{{user}} / {{char}}'),'你 / 角色','macro fallback must be human-readable');

  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
  assert(html.includes('persona-macro-resolver.js?v=1.1.6'),'macro sidecar is not loaded before core');
  assert(html.includes('release=1.1.6'),'v1.1.6 cache-bust marker missing');
  assert(!app.includes("'你 / User（用户）'"),'UI fallback still teaches the player name as User');

  console.log('PASS v1.1.6: persona macros resolve in Persona/Preset/Worldbook/Memory/history/display without mutating source or machine roles');
})().catch(err=>{console.error(err);process.exit(1)});
