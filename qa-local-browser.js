/* Independent, safe browser capability probe. Never opens the canonical app DB. */
(function(){'use strict';
const run=document.getElementById('run'),out=document.getElementById('output');
async function checkIDB(){
 const name='MimaTAVERN-QA-TEMP-'+Date.now();
 let db;try{
  db=await new Promise((ok,no)=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>q.result.createObjectStore('probe');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error||Error('open failed'));});
  await new Promise((ok,no)=>{const tx=db.transaction('probe','readwrite');const q=tx.objectStore('probe').put({value:'qa'},'check');q.onerror=()=>no(q.error);tx.oncomplete=ok;tx.onabort=()=>no(tx.error||Error('write aborted'));});
  const value=await new Promise((ok,no)=>{const tx=db.transaction('probe','readonly');let found;tx.objectStore('probe').get('check').onsuccess=e=>{found=e.target.result;};tx.oncomplete=()=>ok(found);tx.onabort=()=>no(tx.error||Error('read aborted'));});
  if(value?.value!=='qa')throw Error('已提交读写与回读不一致');
  db.close();db=null;
  await new Promise((ok,no)=>{const q=indexedDB.deleteDatabase(name);q.onsuccess=ok;q.onerror=()=>no(q.error||Error('cleanup failed'));q.onblocked=()=>no(Error('cleanup blocked'));});
  return '单独命名的 IndexedDB：写入 → 事务完成 → 读取 → 删除均成功';
 }finally{if(db)db.close();}
}
async function checkFiles(){
 const files=['./index.html','./standalone-core.js','./app.js','./local-store.js','./style.css','./compat-import.js','./compat-runtime.js','./compat-ui.js','./png-card-import.js'];
 for(const file of files){const r=await fetch(file,{cache:'no-store'});if(!r.ok)throw Error(file+' HTTP '+r.status);const t=await r.text();if(!t.trim())throw Error(file+' 为空');}
 return files.length+' 个启动与关键功能资源可以从当前站点读取';
}
function checkFont(){
 const parent=document.createElement('div');parent.style.setProperty('--font-story','"MIMA-QA-STORY",serif');parent.style.setProperty('--font-ui','"MIMA-QA-UI",sans-serif');
 const story=document.createElement('article');story.className='story-prose msg-content';story.textContent='剧情正文测试';
 const ui=document.createElement('div');ui.className='settings-section';ui.textContent='界面字体测试';
 parent.append(story,ui);document.body.append(parent);
 try{
  const s=getComputedStyle(story).fontFamily,u=getComputedStyle(ui).fontFamily;
  if(!s.includes('MIMA-QA-STORY'))throw Error('剧情字体未使用独立变量；computed='+s);
  if(s===u)throw Error('剧情与界面字体计算结果相同；需人工检查自定义规则');
  return '剧情正文与界面字体拥有独立计算路径';
 }finally{parent.remove();}
}
async function checkPng(){
 const r=await fetch('./tests/fixtures/r11-synthetic-dual.png',{cache:'no-store'});if(!r.ok)throw Error('PNG 样例丢失 '+r.status);
 const b=await r.blob(),f=new File([b],'r11-synthetic-dual.png',{type:'image/png'});
 const parsed=await window.MimaPngCardImport.parse(f);if(parsed.version!=='V3'||!parsed.card?.name)throw Error('PNG V3 没有被选中或没有解析出角色');
 return '本地 V3 PNG（双版本元数据）解析成功，优先选用 V3';
}
async function all(){run.disabled=true;let pass=0,fail=0;out.textContent='';
 const steps=[['资源引用',checkFiles],['IndexedDB 独立事务',checkIDB],['双字体样式',checkFont],['PNG V3 解析',checkPng]];
 for(const [name,fn]of steps){try{out.textContent+='✓ '+name+'：'+await fn()+'\n';pass++;}catch(e){out.textContent+='✗ '+name+'：'+(e?.message||String(e))+'\n';fail++;}}
 out.textContent+='\n'+pass+' PASS / '+fail+' FAIL。注意：该页面不测试真实 Provider、原存档迁移或高级酒馆插件，不可单独作为整体验收 GO 依据。';run.disabled=false;
}
run.addEventListener('click',all);
})();
