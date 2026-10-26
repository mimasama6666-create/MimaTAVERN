/* Shared user-controlled theater and command library. No changes to canonical chat text. */
(()=>{'use strict';
 const root=window,providers=new Map(),shelves=new Map(),running=new Set();
 const mountTails=new Map();
 let frameTemplatePromise=null;
 function frameTemplate(){if(!frameTemplatePromise)frameTemplatePromise=fetch('./story-theater-frame.html?playtools=20261027-2',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('小剧场运行页读取失败：'+r.status);return r.text();}).catch(e=>{frameTemplatePromise=null;throw e;});return frameTemplatePromise;}
 let navigationTail=Promise.resolve(),unlinkTail=Promise.resolve();
 const drafts=new Map();let draftsLoaded=false,draftWrite=Promise.resolve(),draftTimer=null,draftRevision=0,persistedDraftRevision=0,pendingDraft=null;
 const uniqueId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
 let draftId;try{draftId=sessionStorage.getItem('mima-play-draft-id')||uniqueId();sessionStorage.setItem('mima-play-draft-id',draftId);}catch{draftId=String(Date.now());}
 let library={theaterCards:[],quickCommands:[]},dialog=null,scope='native',tab='commands',editing=null,query='',statusNode=null,bodyNode=null,view=0;
 const $=id=>document.getElementById(id),arr=v=>Array.isArray(v)?v:[];
 const notify=text=>root.toast?.(text);
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('mima-play-tools-v1'):null;
 const node=(tag,props={},parent)=>{const el=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='text')el.textContent=v;else if(k==='className')el.className=v;else if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else el.setAttribute(k,v);}parent?.append(el);return el;};
 const button=(label,fn,parent,cls='ghost-btn')=>node('button',{type:'button',className:cls,text:label,onclick:()=>Promise.resolve().then(fn).catch(showError)},parent);
 const table=()=>tab==='theater'?'theaterCards':'quickCommands';
 const endpoint=t=>t==='theaterCards'?'theater-cards':'quick-commands';
 const editFields=['name','category','content','enabled','kind','mode','runScripts','readMessages','origins'];
 function editSnapshot(d){return {name:d.name||'',category:d.category||'',content:d.content||'',enabled:d.enabled!==false,kind:d.kind,mode:d.mode,runScripts:d.access?.runScripts===true,readMessages:d.access?.readMessages===true,origins:arr(d.access?.origins).join('\n')};}
 function prepareDraft(item){
  if(!item.baseFields){let base=item.data;if(typeof item.base==='string')base=JSON.parse(item.base);item.baseFields=editSnapshot(base);}
  delete item.base;delete item.saving;item.changed={};const now=editSnapshot(item.data);for(const key of editFields)if(now[key]!==item.baseFields[key])item.changed[key]=true;
  item.editRevision=0;item.draftEditRevision=0;return item;
 }
 const dirty=item=>!!item&&Object.keys(item.changed||{}).length>0;
 function dropDraft(key){if(drafts.delete(key))draftRevision++;}
 function syncDraft(){if(!editing)return;if(!dirty(editing)){dropDraft(editing.table);return;}if(drafts.get(editing.table)!==editing||editing.draftEditRevision!==editing.editRevision){drafts.set(editing.table,editing);editing.draftEditRevision=editing.editRevision;draftRevision++;}}
 async function loadDrafts(){if(draftsLoaded)return;const saved=await root.MimaLocalStore.getPlayToolLocal('draft:'+draftId);for(const key of ['theaterCards','quickCommands'])if(saved?.[key]?.data)drafts.set(key,prepareDraft(saved[key]));draftsLoaded=true;}
 function persistDrafts(){
  clearTimeout(draftTimer);draftTimer=null;const revision=draftRevision;
  if(revision===persistedDraftRevision)return Promise.resolve();
  if(pendingDraft?.revision===revision)return pendingDraft.task;
  // Only snapshot at a real write boundary; input events never serialize source.
  const value=structuredClone(Object.fromEntries([...drafts].map(([key,item])=>[key,{table:item.table,id:item.id,data:item.data,baseFields:item.baseFields}])));
  const write=draftWrite.then(()=>root.MimaLocalStore.putPlayToolLocal('draft:'+draftId,value));draftWrite=write.catch(()=>{});
  const task=write.then(()=>{persistedDraftRevision=Math.max(persistedDraftRevision,revision);});pendingDraft={revision,task};
  void task.then(()=>{if(pendingDraft?.task===task)pendingDraft=null;},()=>{if(pendingDraft?.task===task)pendingDraft=null;});return task;
 }
 async function retainEdit(){if(editing?.saving)throw Error('素材正在保存，请稍候再切页或关闭。');captureEdit();syncDraft();await persistDrafts();}
 function scheduleDraft(event){captureEdit(event?.target);if(!editing)return;syncDraft();clearTimeout(draftTimer);draftTimer=setTimeout(()=>{void persistDrafts().then(()=>{if(editing&&dialog?.open)statusNode.textContent=dirty(editing)?'未保存；草稿已保留在此浏览器，可切页或关闭后继续。':'';}).catch(showError);},300);}
 async function closeTools(){await retainEdit();dialog.close();}
 function switchTab(next){const task=navigationTail.then(async()=>{if(next===tab)return;await retainEdit();tab=next;editing=drafts.get(table())||null;query='';paint();});navigationTail=task.catch(()=>{});return task;}
 async function unlinkJobs(){const jobs=await root.MimaLocalStore.listPlayToolLocal('unlink-job:');if(jobs.some(job=>!job||typeof job.operationId!=='string'||typeof job.id!=='string'||!Array.isArray(job.affected)))throw Error('挂载清理记录格式异常，原记录保留；没有清空资料库。');return jobs;}
 async function recoverUnlinks(discover=false){
  if(!discover&&!(await unlinkJobs()).some(job=>job.phase!=='complete'))return true;
  await load();
  if(discover&&root.MimaCompatStore){
   const existing=new Set((await unlinkJobs()).filter(j=>j.phase!=='complete').map(j=>j.id));
   const available=new Set(library.theaterCards.map(x=>x.id));
   for(const session of await root.MimaCompatStore.all('compat_sessions'))for(const id of arr(session.theaterCardIds))if(!available.has(id)&&!existing.has(id)){
    const operationId=uniqueId();await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+operationId,{operationId,id,phase:'delete-requested',source:'orphan-recovery',affected:[],createdAt:new Date().toISOString(),error:''});existing.add(id);
   }
  }
  return reconcileUnlinks();
 }
 function reconcileUnlinks(){const task=unlinkTail.then(async()=>{if(!root.MimaCompatStore)return;const jobs=await unlinkJobs();let failure='';
  for(const job of jobs){if(job.phase==='complete')continue;
   library=await route('/play-tools');
   if(library.theaterCards.some(x=>x.id===job.id)){if(job.phase!=='paused-source-present'){job.phase='paused-source-present';job.error='素材已恢复，旧删除清理暂停，保留恢复后的挂载。';await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+job.operationId,job);}continue;}
   try{job.phase='compat-cleanup';job.error='';await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+job.operationId,job);
    for(const session of await root.MimaCompatStore.all('compat_sessions'))if(arr(session.theaterCardIds).includes(job.id)){
     let step=job.affected.find(x=>x.sessionId===session.id&&x.expectedRevision===session.revision);if(!step){step={sessionId:session.id,expectedRevision:session.revision,originalIds:[...session.theaterCardIds],phase:'prepared'};job.affected.push(step);await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+job.operationId,job);}
     const saved=await root.MimaCompatStore.putCAS('compat_sessions',{...session,theaterCardIds:session.theaterCardIds.filter(x=>x!==job.id)},session.revision);step.phase='committed';step.revision=saved.revision;await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+job.operationId,job);
    }
    // A crash can occur after the CAS but before writing its receipt. Verify
    // the actual reference rather than repeating a completed mutation.
    for(const step of job.affected)if(step.phase==='prepared'){
     const current=await root.MimaCompatStore.get('compat_sessions',step.sessionId);
     if(current&&arr(current.theaterCardIds).includes(job.id))throw Error('兼容挂载仍存在，原操作尚未完成');
     step.phase=current?'reconciled':'session-absent';if(current)step.revision=current.revision;
    }
    job.phase='complete';job.completedAt=new Date().toISOString();await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+job.operationId,job);
   }catch(e){job.error=e.message;failure='素材删除已提交；兼容挂载清理未完成，可点“重试清理挂载”。'+e.message;await root.MimaLocalStore.putPlayToolLocal('unlink-job:'+job.operationId,job);}
  }
  if(failure){if(statusNode)statusNode.textContent=failure;return false;}return true;
 });unlinkTail=task.catch(()=>{});return task;}
 window.addEventListener('beforeunload',e=>{captureEdit();syncDraft();if(draftRevision!==persistedDraftRevision){void persistDrafts().catch(()=>{});e.preventDefault();e.returnValue='编辑草稿仍未保存';}});
 function provider(name=scope){return providers.get(name);}
 function capture(name=scope){const p=provider(name),owner=p?.capture();return owner?{...owner,scope:name}:null;}
 function live(ticket){const now=capture(ticket?.scope);return !!ticket&&!!now&&now.id===ticket.id&&now.epoch===ticket.epoch;}
 function showError(e){const text=(e?.code?e.code+'：':'')+(e?.message||String(e));if(statusNode&&dialog?.open)statusNode.textContent=text;else notify(text);console.error('[Play tools]',e);}
 async function route(path,method='GET',body=null){const res=await root.MimaStandalone.handle(path,method,body);if(!res?.success)throw Object.assign(new Error(res?.msg||'保存未确认'),{code:res?.code||'E_PLAY_TOOLS'});return res.data;}
 async function load(){library=await route('/play-tools');return library;}
 function readCurrent(){if(root.MimaStandalone?.getPlayTools)library=root.MimaStandalone.getPlayTools();return library;}
 async function changed(){await load();try{channel?.postMessage('changed');}catch(e){console.warn(e);}for(const name of providers.keys())refreshShelf(name);}
 if(channel)channel.onmessage=()=>void changedFromOtherTab();
 async function changedFromOtherTab(){try{await load();for(const name of providers.keys())refreshShelf(name);if(dialog?.open&&!editing)paint();}catch(e){showError(e);}}
 function dispose(record){for(const item of record?.cards?.values()||[]){item.guardController?.abort();item.port?.close();item.frame?.remove();}record?.cards?.clear();}
 function pause(name){const record=shelves.get(name);dispose(record);record?.header?.remove();shelves.delete(name);}
 async function assertReadAccess(asset){const fresh=(await route('/play-tools')).theaterCards.find(x=>x.id===asset.id);if(!fresh?.enabled||!fresh.access?.runScripts||!fresh.access?.readMessages||fresh.content!==asset.content||fresh.kind!==asset.kind||JSON.stringify(fresh.access)!==JSON.stringify(asset.access))throw Error('此素材尚未获准读取剧情原文，或权限已撤销；请在素材编辑页明确授权。');}
 function ensure(name,box){
  const p=provider(name),owner=capture(name);if(!box||!p||!owner||!arr(p.theaterIds()).length){pause(name);return null;}
  let record=shelves.get(name);const key=owner.id+':'+owner.epoch;
  if(!record||record.key!==key||record.header.parentElement!==box){pause(name);const header=node('section',{className:'mima-theater-shelf','data-theater-scope':name});
   const heading=node('div',{className:'mima-theater-heading'},header);node('span',{text:'🎭 小剧场'},heading);button('管理小剧场',()=>open(name,'theater'),heading,'tool-mini');
   const list=node('div',{className:'mima-theater-list'},header);box.prepend(header);record={header,list,key,owner,cards:new Map()};shelves.set(name,record);
  }
  readCurrent();paintShelf(name,record,p);return record.header;
 }
 function refreshShelf(name){const p=provider(name),box=p?.host();if(box)ensure(name,box);}
 function paintShelf(name,record,p){
  const ids=arr(p.theaterIds()),mounted=new Set(ids);for(const[id,item]of record.cards)if(!mounted.has(id)){item.guardController?.abort();item.port?.close();item.frame?.remove();item.card.remove();record.cards.delete(id);}
  record.list.querySelector('.mima-theater-empty')?.remove();
  if(!ids.length)node('p',{className:'mima-play-note mima-theater-empty',text:'在开场白之前放一张 HTML 卡片，或运行你的 JS 小剧场。'},record.list);
  for(const [index,id] of ids.entries()){const asset=library.theaterCards.find(x=>x.id===id),prior=record.cards.get(id);
   const context=p.context?.()||{},signature=asset?[asset.updatedAt,asset.kind,asset.enabled,asset.content,JSON.stringify(asset.access||{}),context.user||'',context.char||'']:null;
   if(prior&&signature&&prior.signature.every((v,i)=>v===signature[i])){prior.card.style.order=String(index);continue;}
   if(prior){prior.guardController?.abort();prior.port?.close();prior.frame?.remove();prior.card.remove();record.cards.delete(id);}
   const card=node('details',{className:'mima-theater-card',open:''},record.list);node('summary',{text:asset?.name||'此小剧场已从素材库删除'},card);
   card.style.order=String(index);const item={card,signature:signature||[],port:null,frame:null};record.cards.set(id,item);
   if(!asset){node('p',{className:'mima-theater-error',text:'找不到原素材。可以在管理页取消此剧情的挂载；没有改动剧情原文。'},card);continue;}
   if(!asset.enabled){node('p',{className:'mima-play-note',text:'此小剧场已停用，可在管理页重新启用。'},card);continue;}
   const errorNode=node('div',{className:'mima-theater-error',role:'status',hidden:''},card);
   node('p',{className:'mima-play-note',text:'脚本及任意联网：'+(asset.access?.runScripts?'已信任':'未授权')+' · 原文读取：'+(asset.access?.readMessages?'已授权':'未授权')+' · 静态远程素材来源：'+(asset.access?.origins?.join('、')||'无')},card);
   const frame=node('iframe',{sandbox:'allow-scripts',referrerpolicy:'no-referrer',title:asset.name},card);item.frame=frame;
   item.guardController=new AbortController();root.addEventListener('message',ev=>{if(ev.source===frame.contentWindow&&ev.data?.type==='mima-theater-guard-error'&&live(record.owner)&&frame.isConnected){errorNode.hidden=false;errorNode.textContent=String(ev.data.message);}}, {signal:item.guardController.signal});
   frame.addEventListener('load',()=>{if(!frame.srcdoc||!live(record.owner)||!frame.isConnected)return;item.port?.close();const pair=new MessageChannel();item.port=pair.port1;
    pair.port1.onmessage=async ev=>{const packet=ev.data;if(!live(record.owner)||!frame.isConnected||shelves.get(name)!==record)return;
     if(packet?.type==='height'){const h=Number(packet.height);if(Number.isFinite(h)&&h>=0)frame.style.height=Math.ceil(h)+'px';return;}
     if(packet?.type==='error'){errorNode.hidden=false;errorNode.textContent='小剧场运行提示：'+String(packet.message||'未知错误');return;}
     if(packet?.type!=='rpc')return;let value,error;
     try{if(packet.method==='messages'){await assertReadAccess(asset);value=await p.messages(record.owner);await assertReadAccess(asset);}else if(packet.method==='fill'){if(p.isBusy())throw Error('当前剧情正在生成');p.fill(String(packet.args?.text??''));value=true;}
      else if(packet.method==='send'){if(!String(packet.args?.text??'').trim())throw Error('发送内容不能为空');const key=name+':'+record.owner.id;if(p.isBusy()||running.has(key))throw Error('当前剧情正在生成');running.add(key);try{value=await p.send(String(packet.args?.text??''),record.owner);if(value?.accepted!==true)throw Error(value?.reason||'发送未接受');}finally{running.delete(key);}}else throw Error('未支持的小剧场接口：'+packet.method);
     }catch(e){error=e.message;}if(live(record.owner)&&frame.isConnected)pair.port1.postMessage({type:'result',id:packet.id,value,error});
    };
    frame.contentWindow.postMessage({type:'mima-theater-init',kind:asset.kind,content:asset.content,access:asset.access||{},context:asset.access?.readMessages?(p.context?.()||{}):{user:'你',char:'角色'},theme:{color:getComputedStyle(p.host()).color}},'*',[pair.port2]);
   });
   void frameTemplate().then(markup=>{if(live(record.owner)&&frame.isConnected)frame.srcdoc=markup;}).catch(e=>{if(frame.isConnected){errorNode.hidden=false;errorNode.textContent=e.message;}});
  }
 }
 function mountIds(ids,ticket){if(!live(ticket))throw Error('已切换剧情，素材已保存但未挂载到其他剧情');return provider(ticket.scope).mount(ids,ticket);}
 function updateMount(ticket,edit){
  if(!ticket)return Promise.reject(new Error('请先选择一个剧情'));const key=ticket.scope+':'+ticket.id+':'+ticket.epoch;
  const run=async()=>{if(!live(ticket))throw Error('剧情已变化，素材已保存但没有挂载到其他剧情');const p=provider(ticket.scope),ids=new Set(p.theaterIds());edit(ids);await mountIds([...ids],ticket);refreshShelf(ticket.scope);};
  const task=(mountTails.get(key)||Promise.resolve()).then(run,run);mountTails.set(key,task);
  void task.then(()=>{if(mountTails.get(key)===task)mountTails.delete(key);},()=>{if(mountTails.get(key)===task)mountTails.delete(key);});return task;
 }
 async function toggleMount(id,on,ticket){await updateMount(ticket,ids=>on?ids.add(id):ids.delete(id));paint();}
 function setup(){if(dialog)return;dialog=node('dialog',{id:'mima-play-tools',className:'mima-play-dialog','aria-labelledby':'mima-play-title'},document.body);
  const head=node('div',{className:'mima-play-head'},dialog);node('h2',{id:'mima-play-title',text:'🧰 百宝箱'},head);button('关闭',closeTools,head,'icon-btn');
  const tabs=node('nav',{className:'mima-play-tabs','aria-label':'游玩工具'},dialog);for(const[t,label]of[['commands','🧰 百宝箱'],['theater','🎭 小剧场']])button(label,()=>switchTab(t),tabs).dataset.playTab=t;
  bodyNode=node('div',{className:'mima-play-body'},dialog);statusNode=node('div',{className:'mima-play-status',role:'status'},dialog);
  dialog.addEventListener('input',scheduleDraft);dialog.addEventListener('change',scheduleDraft);
  dialog.addEventListener('cancel',e=>{e.preventDefault();void closeTools().catch(showError);});dialog.addEventListener('close',()=>{void retainEdit().catch(showError);++view;});
 }
 async function open(name='native',pane='commands'){
  setup();try{await loadDrafts();if(editing)await retainEdit();scope=name;tab=pane;editing=drafts.get(table())||null;query='';statusNode.textContent='';if(!dialog.open)dialog.showModal();const epoch=++view;
   await load();await reconcileUnlinks();if(epoch===view&&dialog.open)paint();}catch(e){showError(e);}
 }
 function paint(){if(!dialog)return;$('mima-play-title').textContent=tab==='theater'?'🎭 小剧场':'🧰 百宝箱';for(const b of dialog.querySelectorAll('[data-play-tab]'))b.setAttribute('aria-selected',String(b.dataset.playTab===tab));
  bodyNode.replaceChildren();if(editing){paintEditor();return;}
  if(drafts.has(table())){const note=node('div',{className:'mima-play-note',text:'有未保存的编辑草稿。'},bodyNode);button('继续草稿',()=>{editing=drafts.get(table());paint();},note);button('放弃草稿',discardDraft,note);}
  node('p',{className:'mima-play-note',text:tab==='theater'?'素材保存在共用库，勾选后只挂载到当前剧情的开场白之前。支持普通 HTML 与 JS；酒馆专用接口尚不保证等价。':'点指令即可发送，也可只填入输入框。支持自建指令、JSON 指令集和酒馆 Quick Reply v2 的手动文本按钮。'},bodyNode);
  const tools=node('div',{className:'mima-play-toolbar'},bodyNode);button(tab==='theater'?'＋ 新建小剧场':'＋ 新建指令',()=>edit(null),tools,'primary-btn');
  if(tab==='theater')button('重试清理挂载',async()=>{const ok=await recoverUnlinks(true);for(const p of providers.values())await p.reload?.();if(ok)statusNode.textContent='清理已完成；已核对失效引用，原始挂载记录保留在本机。已恢复素材的旧清理任务保持暂停。';},tools);
  button('导入',chooseImport,tools);button('导出全部',exportResources,tools);
  if(tab==='theater'&&!library.theaterCards.length)button('添加示例小剧场',()=>importFiles([new File(['<style>body{padding:18px;background:linear-gradient(120deg,#f3e8dc,#e6d9cb);color:#544232;border-radius:16px}h3{margin:0 0 8px}button{border:1px solid #b49d83;border-radius:12px;background:#fff8;padding:8px 14px;color:inherit}</style><h3>☕ 开场之前，喝杯咖啡</h3><p>这里可以放欢迎卡、角色面板，或你自己的互动小剧场。</p><button id="stage-next">开始下一幕</button><script>document.getElementById("stage-next").onclick=()=>MimaTheater.send("请自然推进下一幕剧情。").catch(e=>document.querySelector("p").textContent=e.message)</script>'],'咖啡小剧场.html',{type:'text/html'})]),tools);
  if(tab==='commands'&&!library.quickCommands.length)button('添加“推进剧情”',async()=>{await route('/quick-commands','POST',{name:'推进剧情',mode:'send',content:'请根据前文、当前场景和人物的行动，自然推进接下来的剧情。'});await changed();paint();},tools);
  const search=node('input',{className:'field mima-play-search',placeholder:'搜索名称或分类','aria-label':'搜索工具'},tools);search.value=query;search.oninput=()=>{query=search.value;paintRows(list);};
  const list=node('div',{id:'mima-play-list'},bodyNode);paintRows(list);
 }
 function paintRows(list){list.replaceChildren();const records=library[table()],ticket=capture(),ids=new Set(provider()?.theaterIds()||[]),filtered=records.filter(r=>(r.name+' '+r.category).toLowerCase().includes(query.toLowerCase()));
  if(!filtered.length)node('p',{className:'mima-play-note',text:records.length?'没有匹配的工具。':'这里还没有内容，点“新建”或“导入”添加。'},list);
  for(const resource of filtered){const row=node('section',{className:'mima-play-row','data-play-id':resource.id},list);node('h3',{text:resource.name+(resource.enabled===false?' · 已停用':'')},row);node('p',{text:tab==='theater'?(resource.kind==='js'?'JS 小剧场':'HTML 卡片'):(resource.category?resource.category+' · ':'')+(resource.mode==='fill'?'仅填入':'点击发送')},row);
   if(tab==='commands'&&resource.sourceData){try{const meta=JSON.parse(resource.sourceData);if(meta.quickReply&&(meta.reply.automatic?.length||meta.reply.hasContext))node('p',{text:'原按钮的自动触发和右键子菜单只保留资料；此处由你手动点击执行。'},row);}catch{}}
   if(tab==='commands')node('p',{text:resource.content.length>180?resource.content.slice(0,180)+'…':resource.content},row);
   const actions=node('div',{className:'mima-play-actions'},row);
   if(tab==='commands'){const send=button(resource.mode==='fill'?'填入':'发送',()=>execute(resource.id,false),actions,'primary-btn');send.disabled=!ticket||resource.enabled===false;if(resource.mode!=='fill'){const fill=button('仅填入',()=>execute(resource.id,true),actions);fill.disabled=!ticket||resource.enabled===false;}}
   else{const label=node('label',{className:'check-row'},actions),check=node('input',{type:'checkbox','aria-label':'挂载 '+resource.name},label);check.checked=ids.has(resource.id);check.disabled=!ticket;label.append(' 当前剧情');check.onchange=async()=>{check.disabled=true;try{await toggleMount(resource.id,check.checked,ticket);}catch(e){check.checked=ids.has(resource.id);showError(e);}finally{check.disabled=!live(ticket);}};}
   button('编辑',()=>edit(resource),actions);button('导出',()=>download(resource.name+'.json',{format:'mima-play-tools',version:1,[table()]:[resource]}),actions);button('删除',()=>remove(resource),actions,'danger-btn');
  }
  if(tab==='theater')for(const id of ids)if(!records.some(r=>r.id===id)){const row=node('div',{className:'mima-play-row'},list);node('p',{text:'挂载的小剧场素材已不存在：'+id},row);button('取消失效挂载',()=>toggleMount(id,false,ticket),row);}
 }
 async function edit(resource){const existing=drafts.get(table());if(existing&&existing.id===(resource?.id||null)){editing=existing;paint();return;}if(existing&&existing.id!==(resource?.id||null)&&!confirm('此页已有未保存草稿。放弃旧草稿并编辑另一项？')){editing=existing;paint();return;}const data=resource?structuredClone(resource):{name:'',category:'',content:'',enabled:true,...(tab==='theater'?{kind:'html',access:{readMessages:false,origins:[]}}:{mode:'send'})};editing={table:table(),id:resource?.id||null,data,baseFields:editSnapshot(data),changed:{},editRevision:0};dropDraft(table());await persistDrafts();paint();}
 async function discardDraft(){if(editing?.saving)throw Error('素材正在保存，请稍候再操作。');if(!confirm('明确放弃此页未保存的内容？'))return;
  const key=table(),previous=editing,previousDraft=drafts.get(key),revision=draftRevision,controls=[...bodyNode.querySelectorAll('input,textarea,select,button')];for(const el of controls)el.disabled=true;
  dropDraft(key);editing=null;try{await persistDrafts();paint();statusNode.textContent='已放弃草稿，已保存素材未删除。';}
  catch(e){if(previousDraft)drafts.set(key,previousDraft);draftRevision=revision;editing=previous;throw e;}
  finally{for(const el of controls)if(el.isConnected)el.disabled=false;}
 }
 function field(label,id,value,kind='input',parent=bodyNode){const l=node('label',{text:label},parent),f=node(kind,{id,className:'field'},l);f.value=value??'';return f;}
 function paintEditor(){const form=node('div',{className:'mima-play-editor'},bodyNode),d=editing.data;field('名称','mima-play-name',d.name,'input',form);field('分类（可留空）','mima-play-category',d.category,'input',form);
  const select=field(tab==='theater'?'类型':'点击后的操作','mima-play-mode','','select',form);for(const[value,label]of tab==='theater'?[['html','HTML 卡片'],['js','JS 插件']]:[['send','直接发送'],['fill','仅填入输入框']])node('option',{value,text:label},select);select.value=tab==='theater'?d.kind:d.mode;
  const checkLabel=node('label',{className:'mima-play-check'},form),check=node('input',{id:'mima-play-enabled',type:'checkbox'},checkLabel);check.checked=d.enabled!==false;checkLabel.append(' 启用');
  const content=field(tab==='theater'?'完整 HTML / JS 内容':'发送的指令正文','mima-play-content',d.content,'textarea',form);content.spellcheck=false;
  if(tab==='theater'){
   node('p',{className:'mima-play-note',text:'JS 在独立页面运行。MimaTheater.send(text) 由按钮发送；fill(text) 填入；getMessages() 仅在你逐素材授权后读取本剧情。导入默认无权限，修改源码会清除下面的授权选项。外链 JS/高级酒馆接口尚未支持。'},form);
   const trustLabel=node('label',{className:'mima-play-check'},form),trust=node('input',{id:'mima-play-scripts',type:'checkbox'},trustLabel);trust.checked=d.access?.runScripts===true;trustLabel.append(' 信任并运行此源码的脚本（允许任意联网，含 WebRTC 等协议）');
   const label=node('label',{className:'mima-play-check'},form),read=node('input',{id:'mima-play-read',type:'checkbox'},label);read.checked=d.access?.readMessages===true;label.append(' 另行允许读取当前剧情原文（包括历史私密内容）');
   const origins=field('允许联网的 HTTPS 来源（每行一个，例如 https://example.com；留空只使用本地素材）','mima-play-origins',(d.access?.origins||[]).join('\n'),'textarea',form);origins.rows=2;
   node('p',{className:'mima-play-note',text:'未信任脚本时，仅显示静态 HTML，远程图片/字体/媒体/样式只允许上述来源。浏览器无法可靠隔离所有脚本网络协议；信任脚本后它可以访问任意网络，上述列表不再限制它。读取原文需同时信任脚本，这会允许素材把原文传出。只授权你信任的源码。修改源码或重新导入后需重新授权。'},form);
  }
  node('p',{className:'mima-play-note',text:'未保存编辑会自动保留为此浏览器草稿；切页、关闭后可继续。刷新前若草稿仍在写入，会提醒。'},form);
  const actions=node('div',{className:'mima-play-actions'},form);button('保存',saveEdit,actions,'primary-btn');button('返回列表',async()=>{await retainEdit();editing=null;paint();statusNode.textContent='编辑未提交，草稿已保留。';},actions);button('放弃草稿',discardDraft,actions);
 }
 function captureEdit(target=null){if(!editing||!$('mima-play-name'))return;const d=editing.data,isTheater=editing.table==='theaterCards',full=!target,id=target?.id;let changed=false;
  const update=(key,value)=>{if(d[key]!==value){d[key]=value;changed=true;}if(value!==editing.baseFields[key])editing.changed[key]=true;else delete editing.changed[key];};
  const contentChanged=(full||id==='mima-play-content')&&d.content!==$('mima-play-content').value;
  const kindChanged=(full||id==='mima-play-mode')&&d[isTheater?'kind':'mode']!==$('mima-play-mode').value;
  if(isTheater&&(contentChanged||kindChanged)){$('mima-play-scripts').checked=false;$('mima-play-read').checked=false;$('mima-play-origins').value='';}
  for(const [key,field]of [['name','mima-play-name'],['category','mima-play-category'],['content','mima-play-content'],[isTheater?'kind':'mode','mima-play-mode']])if(full||id===field)update(key,$(field).value);
  if(full||id==='mima-play-enabled')update('enabled',$('mima-play-enabled').checked);
  if(isTheater&&(full||contentChanged||kindChanged||['mima-play-scripts','mima-play-read','mima-play-origins'].includes(id))){
   const access={runScripts:$('mima-play-scripts').checked,readMessages:$('mima-play-read').checked,origins:$('mima-play-origins').value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean)};
   for(const key of ['runScripts','readMessages','origins']){const value=key==='origins'?access.origins.join('\n'):access[key],previous=key==='origins'?arr(d.access?.origins).join('\n'):d.access?.[key]===true;if(value!==previous)changed=true;if(value!==editing.baseFields[key])editing.changed[key]=true;else delete editing.changed[key];}d.access=access;
  }
  if(changed)editing.editRevision++;
 }

 async function saveEdit(){captureEdit();const item=editing;if(!item||item.saving)return;item.saving=true;const controls=[...bodyNode.querySelectorAll('input,textarea,select,button')];for(const el of controls)el.disabled=true;statusNode.textContent='正在保存，编辑区暂时锁定。';let saved;
  try{saved=await route('/'+endpoint(item.table)+(item.id?'/'+item.id:''),item.id?'PATCH':'POST',{...item.data,...(item.table==='theaterCards'?{accessGrant:item.data.access||{}}:{})});
   item.id=saved.id;item.data=structuredClone(saved);item.baseFields=editSnapshot(item.data);item.changed={};dropDraft(item.table);await persistDrafts();await changed();if(editing===item){editing=null;paint();statusNode.textContent='已保存'+(item.table==='theaterCards'?'；请勾选挂载到当前剧情。':'，点击即可使用。');}return saved;
  }catch(e){if(saved)e.message='素材已保存，但草稿清理或界面刷新未完成；请勿重复新建。'+e.message;throw e;}finally{delete item.saving;for(const el of controls)if(el.isConnected)el.disabled=false;}
 }
 async function remove(resource){if(!confirm('删除“'+resource.name+'”？已发送的剧情原文不受影响。'))return;const t=table();await route('/'+endpoint(t)+'/'+resource.id,'DELETE');await changed();const clean=t==='theaterCards'?await reconcileUnlinks():true;for(const p of providers.values())await p.reload?.();paint();if(clean)statusNode.textContent='已删除，剧情原文保留。';}
 async function execute(id,fillOnly){const ticket=capture(),p=provider(),commandView=view;if(!ticket)throw Error('请先进入一个剧情');const key=ticket.scope+':'+ticket.id;if(running.has(key)||p.isBusy())throw Error('当前剧情正在生成，请等待或停止后再发送');running.add(key);
  try{await load();if(!live(ticket))throw Error('已切换剧情，未发送到其他剧情');const command=library.quickCommands.find(x=>x.id===id);if(!command||command.enabled===false)throw Error('指令已删除或停用');
   let source=command.content,meta=null;try{meta=JSON.parse(command.sourceData||'null');}catch{}
   if(meta?.quickReply&&meta.group.injectInput&&p.draft())source=meta.group.placeBeforeInput?source+' '+p.draft():p.draft()+' '+source;
   const script=meta?.quickReply&&source.startsWith('/')&&!fillOnly&&command.mode!=='fill';
   if(script){if(!p.runScript)throw Error('此按钮是酒馆斜杠脚本，请在兼容故事使用；未当作普通台词发送');if(!live(ticket))throw Error('剧情已变化');await retainEdit();const receipt=await p.runScript(source,ticket);if(receipt?.accepted===true){if(live(ticket))dialog.close();}else throw Error(receipt?.reason||'脚本未执行，请检查确认或错误提示');return;}
   const content=await p.expand(source);if(!live(ticket)||p.isBusy())throw Error('当前剧情状态已变化，未重复发送');
   if(fillOnly||command.mode==='fill'){p.fill(content);statusNode.textContent='已填入，可修改后发送。';dialog.close();return;}
   await retainEdit();let accepted=false;const acknowledge=receipt=>{if(receipt?.accepted===true){accepted=true;if(live(ticket)&&scope===ticket.scope&&view===commandView&&tab==='commands'&&!editing&&dialog.open)dialog.close();}};
   statusNode.textContent='正在提交；确认消息已保存后关闭。';const receipt=await p.send(content,ticket,{onAccepted:acknowledge});acknowledge(receipt);
   if(!accepted)throw Error(receipt?.reason||'发送请求未获接受；指令仍保留，请检查剧情状态后再操作。');
   if(receipt?.status==='failed')notify('用户消息已保存，但回复生成失败；请查看原剧情的失败面板，勿重复发送。');
  }finally{running.delete(key);}
 }
 function download(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a',{href:url,download:name.replace(/[\\/:*?"<>|]/g,'_')},document.body);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function exportResources(){download(tab==='theater'?'小剧场合集.json':'百宝箱指令合集.json',{format:'mima-play-tools',version:1,[table()]:library[table()]});}
 function parseJson(raw,name){if(raw?.format==='mima-play-tools'&&raw.version!==1)throw Error('不支持的游玩工具文件版本');for(const key of ['theaterCards','quickCommands'])if(raw?.[key]!==undefined&&!Array.isArray(raw[key]))throw Error(key+' 必须为数组，未导入任何内容');const result={theaterCards:[],quickCommands:[]};if(raw?.format==='mima-play-tools'||Array.isArray(raw?.theaterCards)||Array.isArray(raw?.quickCommands)){result.theaterCards=arr(raw.theaterCards);result.quickCommands=arr(raw.quickCommands);return result;}
  if(raw?.qrList||Array.isArray(raw)&&raw.some(x=>x?.qrList||typeof x?.message==='string')){const parsed=root.MimaCompatQuickReply?.parse({name,path:name,raw});if(!parsed||parsed.issues.length)throw Error('快捷回复格式不能完整识别：'+(parsed?.issues.map(x=>x.message).join('；')||'适配器未加载'));
   const originals=Array.isArray(raw)?raw.every(x=>x&&typeof x.message==='string')?[{version:2,qrList:raw}]:raw:[raw];
   for(const [gi,group]of parsed.groups.entries()){const originalGroup={...originals[gi]};delete originalGroup.qrList;for(const [ri,reply]of group.replies.entries())result.quickCommands.push({name:reply.label,category:group.name,content:reply.message,mode:group.disableSend?'fill':'send',enabled:!reply.isHidden,sourceData:JSON.stringify({quickReply:true,group:{...originalGroup,name:group.name,disableSend:group.disableSend,placeBeforeInput:group.placeBeforeInput,injectInput:group.injectInput},reply:{...(Array.isArray(raw)&&raw.every(x=>x&&typeof x.message==='string')?raw[ri]:originals[gi].qrList[ri]),...reply}})});}return result;}
  const rows=Array.isArray(raw)?raw:Array.isArray(raw?.commands)?raw.commands:[raw];for(const item of rows){if(!item||typeof(item.content??item.text)!=='string')throw Error('JSON 需要 name/content 指令或 theaterCards/quickCommands 数组');result.quickCommands.push({...item,name:item.name||item.label||name,content:item.content??item.text,sourceData:JSON.stringify(item)});}return result;
 }
 function chooseImport(){const input=node('input',{type:'file',accept:'.html,.htm,.js,.json',multiple:'',hidden:''},document.body);input.onchange=()=>{const files=[...input.files];input.remove();void importFiles(files).catch(showError);};input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();}
 async function importFiles(files){const ticket=capture(),batch={theaterCards:[],quickCommands:[]};for(const file of files){const content=await file.text(),name=file.name.replace(/\.[^.]+$/,'');if(/\.(?:html?|js)$/i.test(file.name))batch.theaterCards.push({name,kind:/\.js$/i.test(file.name)?'js':'html',content,enabled:true});else{const parsed=parseJson(JSON.parse(content),name);batch.theaterCards.push(...parsed.theaterCards);batch.quickCommands.push(...parsed.quickCommands);}}
  await retainEdit();const result=await route('/play-tools/import','POST',batch);let warning='';try{await changed();}catch(e){readCurrent();warning='素材已保存，但列表刷新未完成：'+e.message;}
  if(result.theaterCards.length&&live(ticket))try{await updateMount(ticket,ids=>{for(const card of result.theaterCards)ids.add(card.id);});}catch(e){warning='素材已保存，挂载未完成；请在列表重新勾选，勿重复导入。'+e.message;}
  editing=null;if(result.theaterCards.length)tab='theater';paint();statusNode.textContent='已保存导入的 '+result.theaterCards.length+' 个小剧场、'+result.quickCommands.length+' 条指令。'+(warning||result.theaterCards.length&&!live(ticket)?warning||'剧情已变化，素材已保存；请在目标剧情手动挂载。':'');return {...result,mountWarning:warning};
 }
 root.MimaPlayTools=Object.freeze({register:(name,p)=>providers.set(name,p),ensure,open,pause,importFiles,recoverUnlinks,invalidate:()=>{readCurrent();for(const name of providers.keys())refreshShelf(name);}});
})();
