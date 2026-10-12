'use strict';
// Production MVU YAML schema -> import -> atomic commit -> refresh -> fork;
// lightweight fake-IDB/Provider only, never claims real-browser verification.
const assert=require('node:assert/strict');
global.window=global;
const tables=new Map(),names=new Set(),clone=x=>x===undefined?undefined:structuredClone(x);
const db={close(){},objectStoreNames:{contains:k=>names.has(k)},createObjectStore(k){names.add(k);tables.set(k,new Map())},transaction(stores){
 const ns=Array.isArray(stores)?stores:[stores],stage=new Map(ns.map(k=>[k,new Map([...tables.get(k)].map(([id,v])=>[id,clone(v)]))]));let pending=0,done=false,aborted=false;
 const tx={oncomplete:null,onabort:null,error:null,abort(){if(!aborted){aborted=true;setImmediate(()=>tx.onabort?.())}}};
 const finish=()=>{if(!pending&&!done&&!aborted){done=true;setImmediate(()=>{if(aborted)return;for(const [name,data]of stage)tables.set(name,data);tx.oncomplete?.()})}};
 const submit=fn=>{pending++;const req={result:undefined,error:null,transaction:tx,onsuccess:null,onerror:null};setImmediate(()=>{if(aborted)return;try{req.result=clone(fn());req.onsuccess?.()}catch(e){req.error=e;req.onerror?.();tx.error=e;tx.abort()}pending--;setImmediate(finish)});return req};
 tx.objectStore=name=>({get:id=>submit(()=>stage.get(name).get(id)),getAll:()=>submit(()=>[...stage.get(name).values()]),getAllKeys:()=>submit(()=>[...stage.get(name).keys()]),add:v=>submit(()=>{if(stage.get(name).has(v.id))throw Error('duplicate key');stage.get(name).set(v.id,clone(v));return v.id}),put:v=>submit(()=>{stage.get(name).set(v.id,clone(v));return v.id})});return tx;}};
global.indexedDB={open(){const request={result:db,oldVersion:names.size?1:0,onupgradeneeded:null,onsuccess:null,onerror:null};setImmediate(()=>{if(!names.size)request.onupgradeneeded?.();setImmediate(()=>request.onsuccess?.())});return request}};
global.MimaPngCardImport=require('../png-card-import.js');global.MimaCompatMVU=require('../compat-mvu.js');
const imp=require('../compat-import.js'),st=require('../compat-store.js');global.MimaCompatStore=st;
global.MimaCompatRegexIsolation=require('../compat-regex-isolation.js');require('../standalone-core.js');
const validate=global.MimaStandalone.validateStoryReply,replies=[],out=[];
global.MimaStandalone={validateStoryReply:validate,getApiConfig:()=>({model:'mock',contextWindowTokens:500000}),callModelWithConfig:async messages=>{out.push(clone(messages));return replies.shift()}};
const rt=require('../compat-runtime.js'),mvu=global.MimaCompatMVU;
const yaml=`# user-provided static InitVar\nstat_data:\n  角色:\n    好感度: [3, "不得自动越界"]\n    位置: '城堡'\n    背包:\n      - 剑\n      - "药水"\n  天气: sunny\n  金币: 20`;
function book(content,name='[InitVar]'){return{kind:'world_info',id:'local-book',raw:{entries:[{comment:name,content}]}};}
assert.deepEqual(mvu.initYaml('stat_data:\n  x: [0, "中文 # 保留"]\n  v: true\n  target: null\n'),{stat_data:{x:[0,'中文 # 保留'],v:true,target:null}});
for(const evil of ['stat_data:\n  constructor: true','stat_data:\n  __proto__: 8','stat_data:\n  x: &a 2','stat_data:\n  x: !!js/something 3','stat_data:\n  x: 3\n  x: 4','stat_data:\n  list:\n    - *entry','stat_data:\n  x: |\n    JS','stat_data:\n  x:\n    deeply:\n   invalid: 4']){
 assert.throws(()=>mvu.initYaml(evil),e=>String(e.code||'').startsWith('MVU_'),evil);
}
const malformedResources=[{kind:'character',id:'bad-card',raw:{name:'坏开场测试',description:'fixture',first_mes:'<initvar>\nstat_data:\n  x: &bad 1\n</initvar>'}}];
assert.throws(()=>rt.createEnvelope({greetingIndex:0,userName:'玩家'},malformedResources,[],'请继续'),e=>e.code==='E_MVU_INIT_UNVERIFIED','invalid opening InitVar must block model request');
const init=mvu.initial([book('```yaml\n'+yaml+'\n```')]);assert.equal(init.gaps.length,0);assert.equal(init.state.角色.位置,'城堡');assert.equal(init.state.角色.好感度[0],3);
assert.deepEqual(mvu.statusRows(init.state).find(x=>x.path==='角色 · 好感度'),{path:'角色 · 好感度',value:'3'});
assert.equal(mvu.initial([book(yaml),book('stat_data:\n  金币: 999')]).state,null,'conflicting InitVar must fail closed');
(async()=>{
 const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'YAML 起始卡',description:'R11.8 YAML 测试',first_mes:'开场\n<UpdateVariable>_.set(\'角色.好感度\', 999, 4);//开局特殊设定</UpdateVariable>',alternate_greetings:['独立开局\n<initvar>\nstat_data:\n  角色:\n    好感度: [30, "第二开局"]\n  金币: 50\n</initvar>'],character_book:{name:'初始变量',entries:[{comment:'[InitVar]',content:'```yaml\n'+yaml+'\n```'}]}}};
 const bytes=new TextEncoder().encode(JSON.stringify(card)),scan=await imp.inspectBytes(bytes,'card.json');
 assert(scan.resources.some(r=>r.kind==='world_info'));
 const capsule=await st.importSource({sha256:scan.sha256,filename:scan.filename,format:scan.format,bytes:scan.bytes,versions:scan.versions,warnings:scan.warnings},scan.resources);
 const ch=(await st.all('resource_ir')).find(r=>r.kind==='character'&&r.sourceId===capsule.id);
 const {id}=await rt.createSession(capsule.id,{characterResourceId:ch.id});
 assert.equal((await rt.currentMvuState(id)).state.金币,20);
 assert.equal((await rt.currentMvuState(id)).state.角色.好感度[0],4,'opening literal _.set ignores placeholder old value');
 const alternative=await rt.createSession(capsule.id,{characterResourceId:ch.id,greetingIndex:1});
 assert.equal((await rt.currentMvuState(alternative.id)).state.角色.好感度[0],30,'alternate greeting InitVar overrides worldbook');
 assert.equal((await rt.currentMvuState(alternative.id)).state.金币,50);
 assert((await rt.preview(alternative.id,'另一路线')).messages.some(x=>x.mvuStateProjection&&x.content.includes('30')));
 replies.push(`角色继续说话\n<UpdateVariable>_.set('角色.好感度', 4, 6);//好感增长</UpdateVariable>`);
 const r=await rt.send(id,'您好');assert.equal(r.envelope.mvu.active,true);
 assert(out[0].some(x=>x.mvuStateProjection&&x.content.includes('"金币":20')));
 assert.equal((await rt.currentMvuState(id)).state.角色.好感度[0],6);
 assert.equal(mvu.statusRows((await rt.currentMvuState(id)).state).find(x=>x.path==='角色 · 好感度').value,'6');
 const fork=await rt.forkSession(id,r.turnId,{requestId:'yaml_branch_stable_0001'});
 assert.equal((await rt.currentMvuState(fork.sessionId)).state.角色.好感度[0],6);
 const fresh=await rt.forkSession(id,null,{requestId:'yaml_opening_stable_02'});
 assert.equal((await rt.currentMvuState(fresh.sessionId)).state.角色.好感度[0],4);
 const altFork=await rt.forkSession(alternative.id,null,{requestId:'alternate_opening_stable_03'});
 assert.equal((await rt.currentMvuState(altFork.sessionId)).state.角色.好感度[0],30);
 assert.deepEqual((await st.get('source_capsules',capsule.id)).bytes,bytes);
 const snap=await st.snapshot();st.verifyRelationships(snap.records);await st.verifySources(snap.records);
 console.log('PASS R11.8 alternate greeting init overrides + opening literal updates + static InitVar YAML + malicious YAML rejection + source-preserving character import + atomic MVU turn + read-only status rows + branch refresh/replay');
 console.log('UNTESTED real browser IndexedDB, arbitrary YAML/Zod/HTML templates');
})().catch(e=>{console.error(e);process.exitCode=1});
