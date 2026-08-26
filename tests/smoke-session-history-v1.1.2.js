/** MIMAMAO Tavern v1.1.2 story-history edit/delete smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
assert(app.includes('openSessionHistoryEditor'),'history rename entry missing');
assert(app.includes('deleteSessionFromHistory'),'history delete entry missing');
assert(app.includes('session-item-actions'),'history card controls missing');
assert(html.includes('app.js?v=1.1.2'),'app cache version not bumped');

global.window=global;
const local=new Map();
global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
let storedState={schemaVersion:3,sessions:[],masks:[{id:'mask_keep',type:'character',name:'Keep'}],presets:[{id:'preset_keep',name:'Keep',content:'x'}],worldbooks:[{id:'wb_keep',name:'Keep',entries:[]}],cssPresets:[{id:'css_keep',name:'Keep',css:'body{}'}],regexPacks:[]};
global.MimaLocalStore={
  async loadState(){return JSON.parse(JSON.stringify(storedState));},
  async saveState(v){storedState=JSON.parse(JSON.stringify(v));return storedState;}
};
require(path.join(ROOT,'regex-engine.js'));
require(path.join(ROOT,'standalone-core.js'));

(async()=>{
  await MimaStandalone.init();
  let a=await MimaStandalone.handle('/sessions','POST',{title:'历史 A'});
  let b=await MimaStandalone.handle('/sessions','POST',{title:'历史 B'});
  assert(a.success&&b.success,'session creation failed');
  const aId=a.data.id,bId=b.data.id;
  let opened=await MimaStandalone.handle(`/sessions/${aId}/opening`,'POST',{content:'保留的剧情消息'});
  assert(opened.success&&opened.data.messages.length===1,'opening setup failed');

  let renamed=await MimaStandalone.handle(`/sessions/${aId}`,'PATCH',{title:'历史 A · 已改名'});
  assert(renamed.success,'session rename patch failed');
  assert.strictEqual(renamed.data.title,'历史 A · 已改名','session title not renamed');
  assert.strictEqual(renamed.data.messages[0].content,'保留的剧情消息','rename must not touch story messages');

  let deleted=await MimaStandalone.handle(`/sessions/${aId}`,'DELETE');
  assert(deleted.success&&deleted.data.deleted,'session delete failed');
  let list=await MimaStandalone.handle('/sessions','GET');
  assert.strictEqual(list.data.length,1,'delete removed wrong number of sessions');
  assert.strictEqual(list.data[0].id,bId,'delete removed the wrong session');

  const lib=await MimaStandalone.exportLibrary();
  assert.strictEqual(lib.masks[0].id,'mask_keep','deleting story history must not delete character library');
  assert.strictEqual(lib.presets[0].id,'preset_keep','deleting story history must not delete preset library');
  assert.strictEqual(lib.worldbooks[0].id,'wb_keep','deleting story history must not delete worldbook library');
  assert.strictEqual(lib.cssPresets[0].id,'css_keep','deleting story history must not delete CSS library');

  console.log('PASS v1.1.2 session history: rename preserves story data; delete removes only target session');
})().catch(err=>{console.error(err);process.exit(1)});
