/** Independent article and plain API chat. No story/assistant prompt assembly. */
(() => {
  'use strict';
  const W=window, $=id=>document.getElementById(id), clone=v=>structuredClone(v);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
  const notify=v=>W.toast?W.toast(v):console.info(v);
  const labels={novel:'小说续写',article:'文章优化',chat:'模型聊天'};
  const owner=uid(),runs=new Map(),edits=new Map(),editTails=new Map(),sourceEpochs=new Map(),sourceOperations=new Map(),fileTargets=new WeakMap();
  let partitionReady=null,drawerEpoch=0,sourceDirectorySequence=0,editSequence=0;
  let articleTab='source',editorOwner=null,viewBusy=null,viewLoadError=null;
  const editFailures=new Map();
  let dbPromise, mode='novel',selected={article:null,chat:null},data=null,page='',viewVersion=0,uiStatus='',operation=false,modelLists=new Map();
  const fresh=()=>({format:'mima-writing-workspace',version:1,revision:0,articles:[],chats:[],sourceCandidates:[]});
  const defaults=()=>({model:'',temperature:null,streaming:null,sendTemperature:null,sendTopP:null,topP:null,outputLimitMode:'inherit',maxTokens:0,capacityProfiles:{}});
  function validateRecords(raw){
    if(!raw||raw.format!=='mima-writing-workspace'||raw.version!==1||!Number.isSafeInteger(raw.revision)||!Array.isArray(raw.articles)||!Array.isArray(raw.chats))throw Error('文章与聊天数据结构不完整，未覆盖原记录');
    const ids=new Set();
    for(const [kind,rows] of [['article',raw.articles],['chat',raw.chats]])for(const row of rows){
      if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.title!=='string'||!row.settings||typeof row.settings!=='object'||Array.isArray(row.settings))throw Error('工作区会话记录损坏');
      ids.add(row.id);
      if(kind==='article'&&(typeof row.source!=='string'||typeof row.requirement!=='string'||!Array.isArray(row.presets)||row.presets.some(p=>!p||typeof p.content!=='string')||!Array.isArray(row.versions)||row.versions.some(v=>!v||typeof v.id!=='string'||typeof v.content!=='string'||!v.snapshot||typeof v.snapshot.source!=='string')))throw Error('文章原文或版本记录不完整');
      if(kind==='chat'&&(!Array.isArray(row.messages)||row.messages.some(m=>!m||typeof m.id!=='string'||!['user','assistant'].includes(m.role)||typeof m.content!=='string')||typeof row.system!=='string'||typeof row.composer!=='string'))throw Error('模型聊天消息不完整');
    }
    if(raw.sourceCandidates!==undefined&&(!Array.isArray(raw.sourceCandidates)||raw.sourceCandidates.some(x=>!validCandidate(x))))throw Error('原文候选数据损坏');
    return raw;
  }
  function validCandidate(x){return !!x&&typeof x.id==='string'&&typeof x.content==='string'&&(!x.editConflict||(x.sourceCandidate===true&&x.mode==='article'&&typeof x.sessionId==='string'&&x.snapshot&&typeof x.snapshot.baseSource==='string'&&Number.isSafeInteger(x.snapshot.baseSourceRevision)&&typeof x.snapshot.committedSource==='string'&&Number.isSafeInteger(x.snapshot.committedSourceRevision)));}
  function openDB(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open('mimamao-writing-workspace-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('workspace');
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();dbPromise=null;};resolve(db);};
      req.onerror=()=>{dbPromise=null;reject(req.error||Error('工作区读取失败'));};
      req.onblocked=()=>{dbPromise=null;reject(Error('工作区数据库被其他窗口占用'));};
    });return dbPromise;
  }
  const headKey='workspace-head-v2',recordKey=(kind,id)=>'workspace-record-v2:'+JSON.stringify([kind,id]),candidateKey=id=>'workspace-source-candidate-v2:'+id;
  const metadata=r=>({id:r.id,title:r.title,archived:!!r.archived,createdAt:r.createdAt,updatedAt:r.updatedAt,recordRevision:r.recordRevision||0});
  function checkHead(h){if(!h||h.format!=='mima-writing-index'||h.version!==2||!Number.isSafeInteger(h.revision)||!Array.isArray(h.index?.article)||!Array.isArray(h.index?.chat)||!Array.isArray(h.candidateIds)||['article','chat'].some(k=>h.index[k].some(x=>typeof x?.id!=='string')||new Set(h.index[k].map(x=>x.id)).size!==h.index[k].length))throw Error('工作区索引损坏，未初始化或覆盖原记录');return h;}
  function rowChecked(kind,row){if(!row)throw Error('会话已删除，旧操作不会恢复它');validateRecords({...fresh(),[kind==='article'?'articles':'chats']:[row]});return row;}
  function initialHead(d){return {format:'mima-writing-index',version:2,revision:d.revision,index:{article:d.articles.map(metadata),chat:d.chats.map(metadata)},candidateIds:(d.sourceCandidates||[]).map(x=>x.id)};}
  async function ensurePartition(){
    if(partitionReady)return partitionReady;
    partitionReady=(async()=>{const db=await openDB();return new Promise((resolve,reject)=>{
      const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace'),read=store.get(headKey);let problem;
      read.onsuccess=()=>{try{if(read.result!==undefined){checkHead(read.result);return;}const old=store.get('records');old.onsuccess=()=>{try{const raw=old.result===undefined?fresh():validateRecords(old.result),h=initialHead(raw);for(const [kind,list]of [['article',raw.articles],['chat',raw.chats]])for(const row of list){const value={...row,recordRevision:row.recordRevision||0,...(kind==='article'?{sourceRevision:row.sourceRevision||0}:{})};store.put(value,recordKey(kind,row.id));}for(const row of raw.sourceCandidates||[])store.put(row,candidateKey(row.id));if(old.result!==undefined)store.put(old.result,'records-before-v2');store.put(h,headKey);store.put({format:'mima-writing-partitioned',version:2,backupKey:'records-before-v2'},'records');}catch(e){problem=e;tx.abort();}};}catch(e){problem=e;tx.abort();}};
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(problem||tx.error||Error('工作区迁移未提交，旧记录保留'));
    });})().catch(e=>{partitionReady=null;throw e;});return partitionReady;
  }
  function publishCatalog(head){
    if(data&&data.revision>head.revision)return;
    const prior=data||fresh();data={...prior,revision:head.revision};
    for(const kind of ['article','chat']){const key=kind==='article'?'articles':'chats';data[key]=head.index[kind].map(meta=>({...prior[key].find(x=>x.id===meta.id),...meta}));}
    data.sourceCandidates=(prior.sourceCandidates||[]).filter(x=>head.candidateIds.includes(x.id));
  }
  function publishRow(kind,row,id){
    const key=kind==='article'?'articles':'chats';if(!row){data[key]=data[key].filter(x=>x.id!==id);return;}
    const value=clone(row),pending=edits.get(editKey(kind,id));if(pending)Object.assign(value,pending.fields);const i=data[key].findIndex(x=>x.id===id);if(i<0)data[key].push(value);else data[key][i]=value;
  }
  async function transaction(mutator=null,scope=null){
    if(mutator&&!scope)throw Error('工作区写入缺少明确目标');await ensurePartition();const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('workspace',mutator?'readwrite':'readonly'),store=tx.objectStore('workspace'),head=store.get(headKey);scope?.onTransaction?.(tx);let h,value,result,problem;
      head.onsuccess=()=>{try{h=clone(checkHead(head.result));const records=[],candidates=[];
        if(scope?.kind){const {kind,id}=scope;records.push({kind,id,read:store.get(recordKey(kind,id))});}
        else if(!scope?.catalog){for(const kind of ['article','chat'])for(const meta of h.index[kind])records.push({kind,id:meta.id,read:store.get(recordKey(kind,meta.id))});}
        if(!scope?.kind)for(const id of h.candidateIds)candidates.push({id,read:store.get(candidateKey(id))});
        let remaining=records.length+candidates.length;
        const complete=()=>{try{
          value={...fresh(),revision:h.revision};for(const row of records){if(row.read.result===undefined){if(!(scope?.create&&row.id===scope.id))throw Error('工作区分区记录缺失，未用空历史覆盖');}else collection(value,row.kind).push(rowChecked(row.kind,row.read.result));}
          value.sourceCandidates=candidates.map(x=>{if(!validCandidate(x.read.result))throw Error('原文候选分区缺失或损坏');return x.read.result;});
          if(mutator){result=mutator(value);validateRecords(value);h.revision++;
            if(scope.kind){const {kind,id}=scope,row=collection(value,kind).find(x=>x.id===id),old=records[0].read.result;
              if(row){row.recordRevision=(Number(old?.recordRevision)||0)+1;if(kind==='article'&&row.sourceRevision===undefined)row.sourceRevision=0;store.put(row,recordKey(kind,id));const meta=metadata(row),i=h.index[kind].findIndex(x=>x.id===id);if(i<0)h.index[kind].push(meta);else h.index[kind][i]=meta;}
              else{store.delete(recordKey(kind,id));h.index[kind]=h.index[kind].filter(x=>x.id!==id);}
            }else{for(const kind of ['article','chat']){const rows=collection(value,kind);for(const old of h.index[kind])if(!rows.some(x=>x.id===old.id))store.delete(recordKey(kind,old.id));for(const row of rows){row.recordRevision=(Number(row.recordRevision)||0)+1;if(kind==='article'&&row.sourceRevision===undefined)row.sourceRevision=0;store.put(row,recordKey(kind,row.id));}h.index[kind]=rows.map(metadata);}for(const id of h.candidateIds)if(!value.sourceCandidates.some(x=>x.id===id))store.delete(candidateKey(id));for(const row of value.sourceCandidates)store.put(row,candidateKey(row.id));h.candidateIds=value.sourceCandidates.map(x=>x.id);}
            if(scope.candidateRemoval){h.candidateIds=h.candidateIds.filter(id=>id!==scope.candidateRemoval);store.delete(candidateKey(scope.candidateRemoval));}value.revision=h.revision;store.put(h,headKey);
          }
        }catch(e){problem=e;tx.abort();}};
        if(!remaining)complete();else for(const row of [...records,...candidates])row.read.onsuccess=()=>{if(!--remaining)complete();};
      }catch(e){problem=e;tx.abort();}};
      tx.oncomplete=()=>{publishCatalog(h);if(scope?.kind){const row=collection(value,scope.kind).find(x=>x.id===scope.id);publishRow(scope.kind,row,scope.id);}else if(!scope?.catalog){data=clone(value);}else data.sourceCandidates=clone(value.sourceCandidates);resolve(mutator?result:clone(value));};
      tx.onabort=()=>reject(problem||tx.error||Error('工作区未保存，当前文本仍保留在本页'));
    });
  }
  const readRecord=async(kind,id)=>{const d=await transaction(null,{kind,id});return locate(d,kind,id);};
  async function sourceCandidateWrite(candidate,remove=false){
    await ensurePartition();const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace'),req=store.get(headKey);let head,problem;
      req.onsuccess=()=>{try{head=clone(checkHead(req.result));head.revision++;if(remove){head.candidateIds=head.candidateIds.filter(id=>id!==candidate.id);store.delete(candidateKey(candidate.id));}else{if(!head.candidateIds.includes(candidate.id))head.candidateIds.push(candidate.id);store.put(candidate,candidateKey(candidate.id));}store.put(head,headKey);}catch(e){problem=e;tx.abort();}};
      tx.oncomplete=()=>{publishCatalog(head);if(!remove){data.sourceCandidates=data.sourceCandidates||[];const i=data.sourceCandidates.findIndex(x=>x.id===candidate.id);if(i<0)data.sourceCandidates.push(clone(candidate));else data.sourceCandidates[i]=clone(candidate);}resolve();};tx.onabort=()=>reject(problem||tx.error||Error('导入候选尚未持久保存'));
    });
  }
  const collection=(d,kind)=>kind==='article'?d.articles:d.chats;
  function locate(d,kind,id){const r=collection(d,kind).find(x=>x.id===id);if(!r)throw Error('会话已删除，旧操作不会恢复它');return r;}
  const current=()=>data&&mode!=='novel'?collection(data,mode).find(x=>x.id===selected[mode]):null;
  const editKey=(kind,id)=>kind+':'+id;
  function fullRecord(kind,r){return !!r&&(kind==='article'?typeof r.source==='string'&&Array.isArray(r.presets)&&Array.isArray(r.versions):typeof r.composer==='string'&&Array.isArray(r.messages));}
  function visibleOwner(o){return !!o&&!viewBusy&&!viewLoadError&&mode===o.kind&&selected[o.kind]===o.id&&editorOwner?.token===o.token&&fullRecord(o.kind,current());}
  function writableOwner(node=null){
    const o=editorOwner;if(!visibleOwner(o))return null;
    if(node&&(!$('writing-workspace-root')?.contains(node)||node.dataset.writingOwner!==o.token||node.dataset.writingKind!==o.kind||node.dataset.writingId!==o.id))return null;
    return o;
  }
  function stampControls(host){
    if(!host)return;const o=editorOwner;
    for(const node of host.querySelectorAll('button,input,textarea,select')){
      node.dataset.writingOwner=o?.token||'';node.dataset.writingKind=mode;node.dataset.writingId=o?.id||'';
      const nav=['sessions','close-page','select','create','retry-record'].includes(node.dataset.wAction)||node.id==='writing-search';
      if(viewBusy&&!nav){if(node.dataset.wasDisabled===undefined)node.dataset.wasDisabled=String(node.disabled);node.disabled=true;}
      else if(node.dataset.wasDisabled!==undefined){node.disabled=node.dataset.wasDisabled==='true';delete node.dataset.wasDisabled;}
    }
  }
  function beginView(kind,id,{deleted=false}={}){
    const ticket={kind,id,epoch:++viewVersion,deleted};viewBusy=ticket;viewLoadError=null;stampControls($('writing-workspace-root'));return ticket;
  }
  function viewIsCurrent(ticket){return viewBusy===ticket&&viewVersion===ticket.epoch&&mode===ticket.kind;}
  function failView(ticket,error){if(!viewIsCurrent(ticket))return;viewBusy=null;viewLoadError={...ticket,error:error.message};editorOwner=null;page='';render();}
  async function loadSelection(ticket){
    if(ticket.id){await readRecord(ticket.kind,ticket.id);if(!viewIsCurrent(ticket))return;restoreUiDraft(ticket.kind,ticket.id);}
    if(!viewIsCurrent(ticket))return;selected[ticket.kind]=ticket.id;viewBusy=null;viewLoadError=null;page='';render();
  }
  async function settleOwner(o){if(!o)return;try{await flushEdit(editKey(o.kind,o.id));}catch(e){notify('原会话尚未保存，草稿仍保留：'+e.message);}}
  async function exportRecords(){
    if(rescues().length)throw Error('有未提交的生成内容，请先从数据救援复制或导出');if(runs.size)throw Error('请先停止或完成文章与聊天生成，再导出完整备份');capture();await flushEdits();let result=await transaction();for(const kind of ['article','chat'])for(const row of collection(result,kind))restoreUiDraft(kind,row.id);if(edits.size){await flushEdits();result=await transaction();}return result;
  }
  async function importRecords(raw){
    validateRecords(raw);if(runs.size)throw Error('请先停止生成，再恢复文章与聊天备份');await flushEdits();const copy=clone(raw);
    await transaction(d=>{if([...d.articles,...d.chats].some(r=>r.run))throw Error('存在未结算生成，请先停止或确认中断记录');d.articles=copy.articles;d.chats=copy.chats;if(copy.sourceCandidates!==undefined)d.sourceCandidates=copy.sourceCandidates;},{all:true});selected={article:null,chat:null};if(mode!=='novel')await showMode(mode);return {status:'SAVED'};
  }
  function config(settings={}){
    const base=W.MimaStandalone.getApiConfig(),s={...defaults(),...settings};
    let cfg={...base,model:s.model||base.model,temperature:s.temperature??base.temperature,stream:s.streaming??base.stream,sendTemperature:s.sendTemperature??base.sendTemperature,sendTopP:s.sendTopP??base.sendTopP,topP:s.topP??base.topP};
    if(s.outputLimitMode!=='inherit'){cfg.outputLimitMode='global';cfg.maxTokens=s.outputLimitMode==='none'?0:Number(s.maxTokens)||0;}
    const identity=W.MimaStandalone.apiCapacityIdentity(cfg),capacity=Number(s.capacityProfiles?.[identity]);
    if(capacity>=4096){cfg.contextWindowIdentity=identity;cfg.contextWindowTokens=capacity;cfg.modelCapacityProfiles={...cfg.modelCapacityProfiles,[identity]:capacity};}
    return W.MimaStandalone.effectiveRequestConfig(cfg);
  }
  function planArticle(row){
    if(!row.source.trim())throw Error('请先填写原文');
    const messages=row.presets.map(p=>({role:'system',content:p.content}));
    if(row.requirement.trim())messages.push({role:'system',content:row.requirement});
    messages.push({role:'user',content:row.source});return makePlan(messages,row.settings,'article');
  }
  function planChat(row,input,{regenerateId=null}={}){
    let history=row.messages;
    if(regenerateId){const at=history.findIndex(x=>x.id===regenerateId);if(at<0||history[at].role!=='assistant')throw Error('未找到要重说的回复');history=history.slice(0,at);if(history.at(-1)?.role!=='user')throw Error('这条回复前没有有效用户输入');}
    const messages=history.filter(x=>x.role==='user'||x.content.length>0).map(x=>({role:x.role,content:x.content}));
    if(!regenerateId){if(!String(input??'').trim())throw Error('请先输入消息');messages.push({role:'user',content:String(input)});}
    if(row.system.trim())messages.unshift({role:'system',content:row.system});
    return makePlan(messages,row.settings,'chat');
  }
  function makePlan(messages,settings,source){const cfg=config(settings);return {messages,cfg,source,body:W.MimaStandalone.makeApiBody(messages,cfg,cfg.temperature,{continuation:false,storyThinking:false})};}
  function showRequest(body,title='实际请求',sources=[]){
    let dialog=$('workspace-request-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='workspace-request-dialog';dialog.className='workspace-dialog';dialog.innerHTML='<div class="workspace-dialog-head"><strong></strong><button class="ghost-btn" type="button">关闭</button></div><pre></pre>';dialog.querySelector('button').onclick=()=>dialog.close();document.body.append(dialog);}
    dialog.querySelectorAll('.workspace-request-source').forEach(n=>n.remove());for(const [i,message] of (body.messages||[]).entries()){const d=document.createElement('details');d.className='workspace-request-source';const label=document.createElement('summary'),pre=document.createElement('pre');label.textContent=message.role+' · '+(sources[i]||'本会话消息')+' · '+String(message.content).length+' 字符';pre.textContent=message.content;d.append(label,pre);dialog.append(d);}dialog.querySelector('strong').textContent=title;dialog.querySelector('pre').textContent=JSON.stringify(body,null,2);if(!dialog.open)dialog.showModal();return body;
  }
  function rescues(){return (W.MimaUiDrafts.get('writing-rescue-index')?.ids||[]).map(id=>W.MimaUiDrafts.get('writing-rescue:'+id)).filter(Boolean);}
  function retainRescue(run,error){const value={id:run.id,mode:run.kind,sessionId:run.target,content:run.text,snapshot:run.snapshot,error:error.message};W.MimaUiDrafts.put('writing-rescue:'+run.id,value,{immediate:true});const ids=new Set(W.MimaUiDrafts.get('writing-rescue-index')?.ids||[]);ids.add(run.id);W.MimaUiDrafts.put('writing-rescue-index',{ids:[...ids]},{immediate:true});}
  function rescueHtml(){
    const candidates=[...rescues(),...(data?.sourceCandidates||[])].map(r=>`<section class="workspace-rescue" role="alert"><strong>${r.editConflict?'原文有两个版本，冲突稿已保存':r.sourceCandidate?'导入候选未覆盖原文':'生成内容未提交'}</strong><p>${esc(r.error)}</p>${r.editConflict?`<details><summary>本页草稿</summary><pre>${esc(r.content)}</pre></details><details><summary>发生冲突时已保存的原文 · 版本 ${esc(r.snapshot.committedSourceRevision)}</summary><pre>${esc(r.snapshot.committedSource)}</pre></details><button class="ghost-btn" data-w-action="conflict-local" data-id="${esc(r.id)}">本页草稿另存原文版本</button><button class="ghost-btn" data-w-action="conflict-canonical" data-id="${esc(r.id)}">采用已保存原文</button>`:`<pre>${esc(r.content)}</pre>`}<button class="ghost-btn" data-w-action="rescue-export" data-id="${esc(r.id)}">导出${r.editConflict?'冲突记录':'救援原文与请求'}</button><button class="ghost-btn" data-w-action="rescue-copy" data-id="${esc(r.id)}">复制${r.editConflict?'本页草稿':'原文'}</button>${r.editConflict?'':`<button class="tool-mini" data-w-action="rescue-dismiss" data-id="${esc(r.id)}">已另存，关闭救援</button>`}</section>`).join('');
    const failures=[...editFailures].map(([key,r])=>`<section class="workspace-rescue" role="alert"><strong>编辑尚未保存</strong><p>${esc(r.error)}</p><pre>${esc(JSON.stringify(edits.get(key)?.fields||r.fields,null,2))}</pre><button class="ghost-btn" data-w-action="edit-retry" data-id="${esc(key)}">重试保存</button><button class="ghost-btn" data-w-action="edit-export" data-id="${esc(key)}">导出未保存草稿</button><button class="ghost-btn" data-w-action="edit-copy" data-id="${esc(key)}">复制未保存草稿</button></section>`).join('');
    return candidates+failures;
  }
  async function resolveConflict(id,keepLocal){
    capture();const candidate=data?.sourceCandidates?.find(x=>x.id===id&&x.editConflict);if(!candidate)return;const target=candidate.sessionId;
    if(keepLocal)await transaction(d=>{const r=locate(d,'article',target);r.sourceVersions=r.sourceVersions||[];if(!r.sourceVersions.some(x=>x.conflictId===id))r.sourceVersions.push({id:uid(),conflictId:id,source:candidate.content,requirement:candidate.snapshot.localRequirement||'',presets:clone(candidate.snapshot.localPresets||[]),origin:clone(candidate.snapshot.localOrigin??null),time:now(),reason:'source_edit_conflict',baseSourceRevision:candidate.snapshot.baseSourceRevision});},{kind:'article',id:target,candidateRemoval:id});
    else await sourceCandidateWrite(candidate,true);
    if(mode==='article'&&selected.article===target){await readRecord('article',target);render();}
    else if(mode!=='novel')render();
    updateStatus(keepLocal?'本页草稿已存入原文历史，当前原文保留已保存版本':'冲突已处理，采用已保存原文');
  }
  function updateStatus(text){uiStatus=text;const node=$('writing-status');if(node)node.textContent=text;}
  async function create(kind=mode){
    if(operation||!['article','chat'].includes(kind))return;capture();const old=editorOwner;operation=true;const ticket=beginView(kind,null);
    try{
      await settleOwner(old);const id=uid(),stamp=now();
      const row=kind==='article'?{id,title:'未命名文章',source:'',requirement:'',presets:[],versions:[],sourceVersions:[],settings:defaults(),archived:false,createdAt:stamp,updatedAt:stamp,origin:null}:{id,title:'新对话',system:'',composer:'',messages:[],settings:defaults(),archived:false,createdAt:stamp,updatedAt:stamp};
      await transaction(d=>collection(d,kind).push(row),{kind,id,create:true});if(viewIsCurrent(ticket)){ticket.id=id;await loadSelection(ticket);}return id;
    }catch(e){failView(ticket,e);notify(e.message);}finally{operation=false;}
  }
  async function showMode(next){
    if(!Object.hasOwn(labels,next))return;
    capture();const old=editorOwner;mode=next;page='';const ticket=beginView(next,null);
    const shell=$('novel-modal');if(!shell)return;shell.dataset.writingMode=mode;
    $('novel-studio-root').hidden=mode!=='novel';$('writing-workspace-root').hidden=mode==='novel';
    for(const btn of document.querySelectorAll('button[data-writing-mode]'))btn.setAttribute('aria-pressed',String(btn.dataset.writingMode===mode));
    if(mode==='novel'){viewBusy=null;editorOwner=null;return;}
    editorOwner=null;$('writing-workspace-root').textContent='正在读取记录…';
    try{await settleOwner(old);await transaction(null,{catalog:true});if(!viewIsCurrent(ticket))return;
      const rows=collection(data,next);ticket.id=rows.some(x=>x.id===selected[next])?selected[next]:(rows.find(x=>!x.archived)||rows[0])?.id||null;
      if(!ticket.id){viewBusy=null;await create(next);}else await loadSelection(ticket);
    }catch(e){failView(ticket,e);}
  }
  function capture(){
    const o=writableOwner();if(!o)return;
    const fields=o.kind==='article'?{source:$('article-source'),requirement:$('article-requirement')}:{composer:$('plain-chat-input')};
    for(const [key,node]of Object.entries(fields))if(node&&writableOwner(node))queueEdit(o.kind,o.id,key,node.value,{baseSourceRevision:Number(node.dataset.sourceRevision)||0,baseSource:o.baseSource,baseOrigin:o.baseOrigin});
  }
  function queueEdit(kind,id,key,value,options={}){
    const r=data&&collection(data,kind).find(x=>x.id===id);if(!r)return;
    const ownerKey=editKey(kind,id),existing=edits.get(ownerKey);if(r[key]===value&&!options.restore&&!existing?.fields?.[key])return;
    const pending=existing||{kind,id,fields:{},timer:null,token:++editSequence,baseSourceRevision:options.baseSourceRevision??r.sourceRevision??0,baseSource:options.baseSource??r.source,baseOrigin:clone(options.baseOrigin===undefined?r.origin??null:options.baseOrigin)};
    if(key==='source'&&pending.fields.source!==value){sourceEpochs.set(id,(sourceEpochs.get(id)||0)+1);const operation=sourceOperations.get(id);if(operation?.sourceTx)try{operation.sourceTx.abort();}catch(_){} }
    pending.fields[key]=value;clearTimeout(pending.timer);r[key]=value;
    const draft={...W.MimaUiDrafts.get('writing:'+ownerKey),...pending.fields,baseSourceRevision:pending.baseSourceRevision,baseSource:pending.baseSource,baseOrigin:pending.baseOrigin};W.MimaUiDrafts.put('writing:'+ownerKey,draft,{immediate:true});
    pending.timer=setTimeout(()=>flushEdit(ownerKey).catch(e=>updateStatus('尚未保存：'+e.message)),240);edits.set(ownerKey,pending);
  }
  function restoreUiDraft(kind,id){
    const draft=W.MimaUiDrafts.get('writing:'+editKey(kind,id));if(!draft)return;
    const keys=kind==='article'?['source','requirement']:['composer'];for(const key of keys)if(typeof draft[key]==='string')queueEdit(kind,id,key,draft[key],{restore:true,baseSourceRevision:draft.baseSourceRevision,baseSource:draft.baseSource,baseOrigin:draft.baseOrigin});
  }
  function clearEditDraft(key,pending,sourceCommitRevision){
    const newer=edits.get(key),draft=W.MimaUiDrafts.get('writing:'+key)||{},remaining={...draft};for(const [field,value]of Object.entries(pending.fields))if(!newer?.fields||!Object.hasOwn(newer.fields,field)){if(remaining[field]===value)delete remaining[field];}
    if(newer&&sourceCommitRevision){newer.baseSourceRevision=Math.max(newer.baseSourceRevision,sourceCommitRevision);if(typeof pending.fields.source==='string'){newer.baseSource=pending.fields.source;newer.baseOrigin=null;remaining.baseSource=pending.fields.source;remaining.baseOrigin=null;}}
    const contentKeys=Object.keys(remaining).filter(k=>!['baseSourceRevision','baseSource','baseOrigin'].includes(k));if(contentKeys.length)W.MimaUiDrafts.put('writing:'+key,{...remaining,baseSourceRevision:sourceCommitRevision||remaining.baseSourceRevision},{immediate:true});else W.MimaUiDrafts.remove('writing:'+key);
  }
  function flushEdit(key){
    const pending=edits.get(key),previous=editTails.get(key)||Promise.resolve();if(!pending)return previous;
    clearTimeout(pending.timer);edits.delete(key);
    const task=previous.catch(e=>{if(e.pendingEdit){pending.fields={...e.pendingEdit.fields,...pending.fields};pending.conflictId=pending.conflictId||e.pendingEdit.conflictId;}return {};}).then(async preceding=>{
      let sourceCommitRevision=preceding?.sourceCommitRevision||0,conflict=null;
      try{await transaction(d=>{
        const r=locate(d,pending.kind,pending.id);
        if(Object.hasOwn(pending.fields,'source')){const expected=Math.max(pending.baseSourceRevision,sourceCommitRevision);if(Number(r.sourceRevision||0)!==expected){const e=Error('原文已在另一操作中更新，本页草稿已单独保留，未覆盖已保存原文');e.sourceConflict={source:r.source,sourceRevision:Number(r.sourceRevision)||0,origin:clone(r.origin),title:r.title};throw e;}r.sourceRevision=expected+1;r.source=pending.fields.source;r.origin=null;sourceCommitRevision=r.sourceRevision;}
        for(const [field,value]of Object.entries(pending.fields))if(field!=='source')r[field]=value;r.updatedAt=now();
      },{kind:pending.kind,id:pending.id});}
      catch(e){
        if(!e.sourceConflict)throw e;
        const committed=e.sourceConflict,r=collection(data,'article').find(x=>x.id===pending.id);pending.conflictId=pending.conflictId||uid();
        conflict={id:pending.conflictId,editConflict:true,sourceCandidate:true,mode:'article',sessionId:pending.id,content:pending.fields.source,snapshot:{targetArticleId:pending.id,baseSourceRevision:pending.baseSourceRevision,baseSource:pending.baseSource,localOrigin:pending.baseOrigin,localRequirement:pending.fields.requirement??r?.requirement??'',localPresets:clone(r?.presets||[]),committedSource:committed.source,committedSourceRevision:committed.sourceRevision,committedOrigin:committed.origin,title:committed.title},error:e.message,createdAt:now()};
        // Do not release the edit job until its local source has a durable owner.
        await sourceCandidateWrite(conflict);
        const sourceFields={source:pending.fields.source};clearEditDraft(key,{fields:sourceFields},0);delete pending.fields.source;
        if(Object.keys(pending.fields).length)await transaction(d=>{const row=locate(d,pending.kind,pending.id);Object.assign(row,pending.fields);row.updatedAt=now();},{kind:pending.kind,id:pending.id});
        await readRecord('article',pending.id);notify('原文版本冲突，两个版本均已保留，可在冲突记录中处理');
      }
      clearEditDraft(key,pending,sourceCommitRevision);editFailures.delete(key);
      if(!conflict&&pending.kind==='article'&&writableOwner()?.id===pending.id&&$('article-source')?.value===pending.fields.source){$('article-source').dataset.sourceRevision=String(sourceCommitRevision);editorOwner.baseSource=pending.fields.source;editorOwner.baseOrigin=null;}
      if(conflict&&mode!=='novel')render();return {sourceCommitRevision,conflictId:conflict?.id};
    }).catch(e=>{e.pendingEdit=pending;if(editTails.get(key)===task){const newer=edits.get(key);if(newer?.timer)clearTimeout(newer.timer);edits.set(key,{...pending,fields:{...pending.fields,...newer?.fields},timer:null});editFailures.set(key,{kind:pending.kind,id:pending.id,fields:clone(pending.fields),error:e.message});if(mode!=='novel')render();}throw e;});
    editTails.set(key,task);task.finally(()=>{if(editTails.get(key)===task)editTails.delete(key);}).catch(()=>{});return task;
  }
  async function flushEdits(){const keys=new Set([...edits.keys(),...editTails.keys()]);for(const key of keys)await flushEdit(key);}
  async function select(id){
    const kind=mode;capture();const old=editorOwner,ticket=beginView(kind,id);
    try{await settleOwner(old);if(!viewIsCurrent(ticket))return;await loadSelection(ticket);}catch(e){failView(ticket,e);}
  }
  async function sessionAction(action,id=selected[mode]){
    const kind=mode;if(operation||!['article','chat'].includes(kind))return;const target=collection(data,kind).find(x=>x.id===id);if(!target)return;
    if(action==='delete'&&!confirm('删除「'+target.title+'」及其历史版本？'))return;
    let title;if(action==='rename'){title=prompt('名称',target.title);if(title===null)return;}
    capture();const old=editorOwner,wasSelected=selected[kind]===id;operation=true;let ticket=wasSelected?beginView(kind,id):null,deleted=false;
    try{
      const run=runs.get(editKey(kind,id));if(run&&action==='delete'){run.controller.abort();await run.done;}
      if(action==='recover'){if(run)return notify('本页请求仍在运行，请点击停止');if(!confirm('确认原页面的生成已经停止？只将遗留记录标为中断，不会重新请求模型。'))return;}
      if(action==='delete'&&kind==='article'){const sourceOp=sourceOperations.get(id);if(sourceOp?.sourceTx)try{sourceOp.sourceTx.abort();}catch(_){}sourceOperations.delete(id);}
      await flushEdit(editKey(kind,id));await transaction(d=>{
        const list=collection(d,kind),row=locate(d,kind,id);
        if(action==='delete')list.splice(list.findIndex(x=>x.id===id),1);
        else if(action==='rename')row.title=String(title).trim()||row.title;
        else if(action==='archive')row.archived=!row.archived;
        else if(action==='recover'){row.run=null;for(const x of (kind==='article'?row.versions:row.messages))if(x.status==='generating')x.status='interrupted';}
      },{kind,id});
      if(action==='delete'){deleted=true;edits.delete(editKey(kind,id));editTails.delete(editKey(kind,id));editFailures.delete(editKey(kind,id));W.MimaUiDrafts.remove('writing:'+editKey(kind,id));if(selected[kind]===id)selected[kind]=null;}
      if(ticket&&viewIsCurrent(ticket)){
        ticket.deleted=deleted;
        if(deleted){const rows=collection(data,kind);ticket.id=(rows.find(x=>!x.archived)||rows[0])?.id||null;}
        await loadSelection(ticket);
      }else if(mode===kind&&!viewBusy)render();
    }catch(e){if(ticket){ticket.deleted=deleted;failView(ticket,e);}notify((deleted?'记录已删除，但下一条读取失败：':'操作未完成：')+e.message);}
    finally{operation=false;if(ticket&&viewIsCurrent(ticket)){viewBusy=null;render();}}
  }
  async function setSetting(key,value){
    const o=writableOwner();if(!o)return;const {kind,id}=o;
    if(['temperature','topP'].includes(key))value=value===''?null:Number(value);
    if(['maxTokens','contextWindowTokens'].includes(key)){value=Number(value);if(!Number.isSafeInteger(value)||value<0||(key==='contextWindowTokens'&&value!==0&&value<4096))return notify('请填写有效整数，容量至少 4096 或 0');}
    if(key==='temperature'&&value!==null&&(!Number.isFinite(value)||value<.1||value>2))return notify('温度范围为 0.1–2');
    if(key==='topP'&&value!==null&&(!Number.isFinite(value)||value<0||value>1))return notify('Top P 范围为 0–1');
    try{await transaction(d=>{const r=locate(d,kind,id);if(key==='system')r.system=String(value);else if(key==='contextWindowTokens'){const identity=W.MimaStandalone.apiCapacityIdentity(config(r.settings));r.settings.capacityProfiles={...r.settings.capacityProfiles};if(value)r.settings.capacityProfiles[identity]=value;else delete r.settings.capacityProfiles[identity];}else r.settings[key]=value;},{kind,id});updateStatus('设置已保存');updateModelSummary();}catch(e){updateStatus('设置未保存：'+e.message);}
  }
  function modelFingerprint(cfg){return JSON.stringify([cfg.apiBase,cfg.modelsEndpoint,cfg.apiKey,cfg.extraHeaders]);}
  async function loadModels(){
    const o=writableOwner();if(!o)return;const {kind,id}=o,row=current();
    const cfg=config(row.settings),fingerprint=modelFingerprint(cfg),node=$('writing-model-list');
    try{const models=await W.MimaStandalone.listModelsWithConfig(cfg);modelLists.set(fingerprint,models);
      if(kind!==mode||id!==selected[kind]||node!==$('writing-model-list')||modelFingerprint(config(current().settings))!==fingerprint)return;
      fillModels(node,models,row.settings.model);updateStatus('模型列表已刷新，当前选择保持');
    }catch(e){notify('刷新模型失败：'+e.message);}
  }
  function fillModels(node,models,choice){if(!node)return;node.replaceChildren();const add=(v,label)=>{const o=new Option(label,v);o.selected=v===choice;node.add(o);};add('','继承主 API 模型');for(const name of new Set([...(choice?[choice]:[]),...models]))add(name,name);}
  function updateModelSummary(){const node=$('writing-model-summary'),r=current();if(node&&r)node.textContent=config(r.settings).model||'未配置模型';}
  async function novelModels(){
    const p=W.MimaNovelStudio.getCurrentProject(),node=$('novel-model-list');if(!p||!node)return;const cfg=config(p.modelSettings),fp=modelFingerprint(cfg);
    try{const models=await W.MimaStandalone.listModelsWithConfig(cfg);if(W.MimaNovelStudio.getCurrentProject()?.id!==p.id||node!==$('novel-model-list')||modelFingerprint(config(W.MimaNovelStudio.getCurrentProject().modelSettings))!==fp)return;fillModels(node,models,p.modelSettings.model);}catch(e){notify(e.message);}
  }
  async function preview(regenerateId=null){
    const o=writableOwner();if(!o)return;capture();await flushEdit(editKey(o.kind,o.id));const row=await readRecord(o.kind,o.id);
    if(!visibleOwner(o))return;try{const plan=o.kind==='article'?planArticle(row):planChat(row,row.composer,{regenerateId});showRequest(plan.body,labels[o.kind]+' · 1 次请求',o.kind==='article'?[...row.presets.map(p=>'文风：'+p.name),...(row.requirement.trim()?['本轮手写要求']:[]),'原文']:plan.messages.map(m=>m.role==='system'?'自填系统指令':'本会话历史 / 本轮输入'));return plan;}catch(e){notify(e.message);}
  }
  function assertRun(row,run){if(row.run?.id!==run.id||row.run.owner!==owner)throw Error('生成归属已改变，迟到内容未写入');}
  async function generate(regenerateId=null){
    const o=writableOwner();if(!o)return;const {kind,id}=o,key=editKey(kind,id);if(runs.has(key))return;
    let finish;const run={id:uid(),kind,target:id,controller:new AbortController(),text:'',done:new Promise(resolve=>finish=resolve),checkpoint:Promise.resolve(),error:null,versionId:uid(),lastSaved:''};runs.set(key,run);
    try{
      capture();const savedEdit=await flushEdit(key);if(kind==='article'&&savedEdit?.conflictId)throw Error('原文存在版本冲突，请先处理已保存的冲突稿');const row=await readRecord(kind,id);
      if(row.run)throw Error('该会话有未结算的生成，请先停止原页面请求或确认恢复中断记录');
      const plan=kind==='article'?planArticle(row):planChat(row,row.composer,{regenerateId});
      if(!plan.cfg.apiBase||!plan.cfg.model)throw Error('请先在主 API 设置配置连接，并选择模型');
      run.plan=plan;run.snapshot=kind==='article'?{source:row.source,requirement:row.requirement,presets:clone(row.presets),origin:clone(row.origin),settings:clone(row.settings),requestBody:clone(plan.body)}:{requestBody:clone(plan.body)};
      await transaction(d=>{
        const target=locate(d,kind,id);if(target.run)throw Error('此会话已有生成');target.run={id:run.id,owner,startedAt:now()};
        if(kind==='article')target.versions.push({id:run.versionId,content:'',status:'generating',createdAt:now(),snapshot:run.snapshot,error:''});
        else{
          if(!regenerateId){target.messages.push({id:uid(),role:'user',content:row.composer,time:now()});if(target.composer===row.composer)target.composer='';}
          else{const at=target.messages.findIndex(m=>m.id===regenerateId);if(at<0)throw Error('重说目标已删除');target.branches=target.branches||[];target.branches.push({id:uid(),time:now(),reason:'regenerate',messages:clone(target.messages.slice(at))});target.messages=target.messages.slice(0,at);}
          target.messages.push({id:run.versionId,role:'assistant',content:'',status:'generating',time:now(),requestBody:clone(plan.body)});
        }target.updatedAt=now();
      },{kind,id});
      if(kind==='article')articleTab='result';if(mode===kind&&selected[kind]===id)render();
      if(run.controller.signal.aborted)throw new DOMException('已停止','AbortError');
      const output=await W.MimaStandalone.callModelWithConfig(plan.messages,plan.cfg,plan.cfg.temperature,run.controller.signal,{continuation:false,storyThinking:false,preserveText:true,requestSource:kind,streamOverride:plan.cfg.stream,onReceivedText:value=>{run.text=String(value);paintRun(run);},onProgress:ev=>{
        if(ev?.streamText===undefined)return;run.text=String(ev.streamText);paintRun(run);
        scheduleCheckpoint(run);
      }});
      run.text=String(output);clearTimeout(run.checkpointTimer);run.settling=true;await run.checkpoint;if(run.error)throw run.error;if(!run.text.trim())throw Error('模型返回空内容');
      await checkpoint(run,'complete');updateStatus('已保存');
    }catch(e){
      run.error=run.error||e;
      try{clearTimeout(run.checkpointTimer);run.settling=true;await run.checkpoint;if(run.plan)await checkpoint(run,e.name==='AbortError'?'interrupted':'failed');}catch(saveError){run.error=saveError;retainRescue(run,saveError);}
      updateStatus((e.name==='AbortError'?'生成已停止':'生成未完成：'+run.error.message)+(run.text?'；收到的内容已保留':''));
      if(e.name!=='AbortError')notify(uiStatus);
    }finally{runs.delete(key);finish();if(mode===kind&&selected[kind]===id)render();}
  }
  function scheduleCheckpoint(run){
    if(run.terminal||run.settling||run.checkpointTimer||run.text===run.lastSaved)return;
    run.checkpointTimer=setTimeout(()=>{run.checkpointTimer=null;if(run.settling||run.terminal)return;run.lastCheckpointAt=Date.now();checkpoint(run).then(()=>scheduleCheckpoint(run),e=>{run.error=e;run.controller.abort();});},Math.max(0,300-(Date.now()-(run.lastCheckpointAt||0))));
  }
  function checkpoint(run,status='generating'){
    if(run.terminal)return run.checkpoint;
    const text=run.text;if(status==='generating'&&text===run.lastSaved)return run.checkpoint;run.lastSaved=text;if(status!=='generating')run.terminal=true;
    const task=run.checkpoint.then(()=>transaction(d=>{
      const row=locate(d,run.kind,run.target);assertRun(row,run);const target=(run.kind==='article'?row.versions:row.messages).find(x=>x.id===run.versionId);if(!target)throw Error('生成目标已删除');
      target.content=text;target.status=status;target.error=status==='failed'||status==='interrupted'?(run.error?.message||'已停止'):'';target.updatedAt=now();row.updatedAt=now();if(status!=='generating')row.run=null;
    },{kind:run.kind,id:run.target}));run.checkpoint=task;return task;
  }
  function paintRun(run){
    if(mode!==run.kind||selected[mode]!==run.target)return;
    const node=$('writing-stream-'+run.versionId);if(node)node.textContent=run.text;
    const scroll=$('plain-chat-scroll');if(scroll&&scroll.dataset.follow!=='false')scroll.scrollTop=scroll.scrollHeight;
  }
  function stop(){const o=writableOwner();if(o)runs.get(editKey(o.kind,o.id))?.controller.abort();}
  function stopAll(){for(const r of runs.values())r.controller.abort();capture();void flushEdits().catch(e=>notify(e.message));}
  async function selectPreset(id){
    const o=writableOwner();if(!id||o?.kind!=='article')return;const kind=o.kind,target=o.id;
    try{const res=await W.MimaStandalone.handle('/presets','GET');if(!res.success)throw Error(res.msg);const p=res.data.find(x=>x.id===id);if(!p)throw Error('文风预设已不存在');
      await transaction(d=>{const r=locate(d,'article',target);r.presets.push({id:p.id,name:p.name,content:String(p.content??''),selectedAt:now(),contentHash:W.MimaNovelEngine.hashText(p.content??'')});},{kind:'article',id:target});if(mode===kind&&selected.article===target)render();
    }catch(e){notify(e.message);}
  }
  async function removePreset(index){const o=writableOwner();if(o?.kind!=='article')return;const id=o.id;await transaction(d=>locate(d,'article',id).presets.splice(index,1),{kind:'article',id});render();}
  async function movePreset(index,delta){const o=writableOwner();if(o?.kind!=='article')return;const id=o.id;await transaction(d=>{const a=locate(d,'article',id).presets,to=index+delta;if(to>=0&&to<a.length)[a[index],a[to]]=[a[to],a[index]];},{kind:'article',id});render();}
  function beginSourceOperation(articleId=selected.article){
    if(!writableOwner()||mode!=='article'||!articleId)throw Error('请先选择并读取文章');if(selected.article===articleId)capture();const row=locate(data,'article',articleId),op={id:uid(),articleId,mode:'article',epoch:sourceEpochs.get(articleId)||0,initialRevision:Number(row.sourceRevision)||0,baseText:row.source};const previous=sourceOperations.get(articleId);if(previous?.sourceTx)try{previous.sourceTx.abort();}catch(_){}sourceOperations.set(articleId,op);return op;
  }
  async function prepareSource(op){
    const receipt=await flushEdit(editKey('article',op.articleId)),row=await readRecord('article',op.articleId);op.sourceRevision=Math.max(op.initialRevision,receipt?.sourceCommitRevision||0);
    if(row.sourceRevision!==op.sourceRevision||row.source!==op.baseText)throw Error('原文已改变，未覆盖新内容');return row;
  }
  async function keepSourceCandidate(op,candidate,error){
    const row={id:op.id,sourceCandidate:true,mode:'article',sessionId:op.articleId,content:candidate.source,snapshot:{targetArticleId:op.articleId,baseSource:op.baseText,sourceRevision:op.sourceRevision??op.initialRevision,origin:candidate.origin,title:candidate.title||''},error:error.message,createdAt:now()};
    try{await sourceCandidateWrite(row);}catch(saveError){retainRescue({id:op.id,kind:'article',target:op.articleId,text:candidate.source,snapshot:row.snapshot},saveError);}
    notify('取用未覆盖原文，导入候选已保留：'+error.message);if(mode!=='novel')render();
  }
  async function commitSource(op,candidate){
    if(sourceOperations.get(op.articleId)!==op||(sourceEpochs.get(op.articleId)||0)!==op.epoch)throw Error('已有更新的导入或原文编辑，保留此导入候选');
    try{await transaction(d=>{if(sourceOperations.get(op.articleId)!==op||(sourceEpochs.get(op.articleId)||0)!==op.epoch)throw Error('原文编辑已变化，未覆盖');const r=locate(d,'article',op.articleId);if(Number(r.sourceRevision||0)!==op.sourceRevision)throw Error('原文版本冲突，未覆盖');r.source=candidate.source;r.origin=candidate.origin;if(candidate.title)r.title=candidate.title;r.sourceRevision=op.sourceRevision+1;r.updatedAt=now();},{kind:'article',id:op.articleId,onTransaction:tx=>op.sourceTx=tx});}finally{op.sourceTx=null;}
    const key=editKey('article',op.articleId),draft=W.MimaUiDrafts.get('writing:'+key);if(draft){delete draft.source;draft.baseSourceRevision=op.sourceRevision+1;if(Object.keys(draft).some(k=>k!=='baseSourceRevision'))W.MimaUiDrafts.put('writing:'+key,draft,{immediate:true});else W.MimaUiDrafts.remove('writing:'+key);}
    sourceEpochs.set(op.articleId,op.epoch+1);if(mode==='article'&&selected.article===op.articleId)render();updateStatus('原文与来源已保存');
  }
  async function importSource(file,providedOp=null){
    if(!file)return;const op=providedOp||beginSourceOperation();let candidate;
    try{const decoded=await W.MimaNovelStudio.decodeTxtFile(file);candidate={source:decoded.text,origin:null,title:file.name.replace(/\.[^.]+$/,'')};await prepareSource(op);await commitSource(op,candidate);}catch(e){if(candidate)await keepSourceCandidate(op,candidate,e);else notify('原文导入失败：'+e.message);}
  }
  async function takeChapter(projectId=null,chapterId=null,articleId=selected.article){
    const op=beginSourceOperation(articleId);let candidate;
    try{await prepareSource(op);let p;if(projectId){const res=await W.MimaStandalone.handle('/novels/'+encodeURIComponent(projectId),'GET');if(!res.success)throw Error(res.msg);p=res.data;}else p=W.MimaNovelStudio.getCurrentProject();if(!p)throw Error('先选择来源小说与章节');const c=W.MimaNovelEngine.getChapter(p,chapterId||p.activeChapterId);if(!c)throw Error('来源章节不存在');candidate={source:W.MimaNovelEngine.getChapterText(c),origin:{projectId:p.id,projectTitle:p.title,chapterId:c.id,chapterTitle:c.title,projectRevision:p.recordRevision,chapterRevision:c.revision,chapterHash:W.MimaNovelEngine.chapterHash(c)}};await commitSource(op,candidate);}catch(e){if(candidate)await keepSourceCandidate(op,candidate,e);else notify('取用未提交：'+e.message);}
  }
  async function replaceChapter(versionId){
    const o=writableOwner();if(o?.kind!=='article')return;const row=current(),v=row?.versions.find(x=>x.id===versionId),origin=v?.snapshot?.origin;if(!origin||!v.content)return notify('此版本没有明确来源章节');
    if(!confirm('将这个版本替换「'+origin.projectTitle+' / '+origin.chapterTitle+'」？会核验来源版本。'))return;
    const res=await W.MimaStandalone.handle('/novel-article-replace','POST',{...origin,content:v.content});
    notify(res.success?'章节已替换；剧情档案待手动更新':res.msg||'替换未提交，结果保留');
  }
  async function messageAction(action,id){
    const o=writableOwner(),row=current();if(!o||o.kind!=='chat'||runs.has(editKey(o.kind,o.id)))return;
    const m=row.messages.find(x=>x.id===id);if(!m)return;
    if(action==='copy')return copy(m.content);
    if(action==='regenerate')return generate(id);
    if(action==='edit'){
      const text=prompt('编辑消息（原文保留为版本）',m.content);if(text===null)return;
      await transaction(d=>{const target=locate(d,'chat',row.id).messages.find(x=>x.id===id);if(!target)throw Error('消息已删除');target.versions=target.versions||[];target.versions.push({content:target.content,time:now()});target.content=text;},{kind:'chat',id:row.id});render();
    }
  }
  async function copy(text){try{await navigator.clipboard.writeText(text);notify('已复制');}catch(e){showRequest({text},'复制内容');}}
  function download(name,text){const u=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  function versionAction(action,id){const o=writableOwner();if(o?.kind!=='article')return;const r=current(),v=r?.versions.find(x=>x.id===id);if(!v)return;
    if(action==='copy')return copy(v.content);if(action==='export')return download(r.title+'_'+id.slice(0,8)+'.txt',v.content);
    if(action==='request')return showRequest(v.snapshot.requestBody,'该版本实际请求');
    if(action==='replace')return replaceChapter(id);
    if(action==='source'){showRequest(v.snapshot,'该版本原文与要求快照');return;}
    if(action==='delete'&&confirm('删除这个结果版本？'))return transaction(d=>{const row=locate(d,'article',r.id);if(row.run)throw Error('生成中不能删除版本');row.versions=row.versions.filter(x=>x.id!==id);},{kind:'article',id:r.id}).then(render).catch(e=>notify(e.message));
  }
  async function exportCurrent(){const o=writableOwner();if(!o)return;const {kind,id}=o;capture();await flushEdit(editKey(kind,id));const r=await readRecord(kind,id);if(!r)return;download(r.title+'.json',JSON.stringify(r,null,2));}
  async function saveSourceVersion(){const o=writableOwner();if(o?.kind!=='article')return;const id=o.id;capture();await flushEdit(editKey('article',id));await transaction(d=>{const r=locate(d,'article',id);r.sourceVersions=r.sourceVersions||[];r.sourceVersions.push({id:uid(),source:r.source,requirement:r.requirement,presets:clone(r.presets),origin:clone(r.origin),time:now()});},{kind:'article',id});updateStatus('原文已保存为新版本');render();}
  function showPage(next){capture();page=page===next?'':next;renderDrawer();}
  function tri(label,key,value){return `<label>${label}<select class="field" data-setting="${key}"><option value="inherit" ${value==null?'selected':''}>继承主 API</option><option value="yes" ${value===true?'selected':''}>开启</option><option value="no" ${value===false?'selected':''}>关闭</option></select></label>`;}
  function settingsHtml(r){const s={...defaults(),...r.settings},cfg=config(s),identity=W.MimaStandalone.apiCapacityIdentity(cfg);return `<h3>连接与模型</h3><p class="row-sub">继承主 API 连接。此处仅保存本${mode==='article'?'文章':'会话'}的独立参数。</p><label>模型<select class="field" id="writing-model-list" data-setting="model"></select></label><button class="ghost-btn" data-w-action="models">刷新模型列表</button><label>手动模型名称（留空继承）<input class="field" data-setting="model" value="${esc(s.model)}"></label><h3>生成参数</h3><label>温度（留空继承）<input class="field" type="number" step=".05" min=".1" max="2" data-setting="temperature" value="${s.temperature??''}"></label>${tri('发送温度','sendTemperature',s.sendTemperature)}${tri('流式输出','streaming',s.streaming)}${tri('发送 Top P','sendTopP',s.sendTopP)}<label>Top P（留空继承）<input class="field" type="number" min="0" max="1" step=".05" data-setting="topP" value="${s.topP??''}"></label><label>输出上限<select class="field" data-setting="outputLimitMode">${[['inherit','继承主 API'],['none','不发送限制'],['custom','自定义']].map(([v,t])=>`<option value="${v}" ${v===s.outputLimitMode?'selected':''}>${t}</option>`).join('')}</select></label><label>自定义输出 Tokens<input class="field" type="number" min="0" data-setting="maxTokens" value="${s.maxTokens}"></label><label>当前连接与模型容量（0 = 继承）<input class="field" type="number" min="0" step="1024" data-setting="contextWindowTokens" value="${Number(s.capacityProfiles[identity])||0}"></label><p class="row-sub">有效窗口：${cfg.contextWindowTokens||'未声明'} Tokens。完整原文与历史不会自动截断。</p>${mode==='chat'?`<h3>可选系统指令</h3><textarea class="field textarea" data-setting="system" placeholder="默认留空">${esc(r.system)}</textarea>`:''}<button class="ghost-btn" data-w-action="preview">预览本轮实际请求</button>`;}
  function sessionsHtml(){const rows=collection(data,mode);return `<div class="toolbar"><button class="primary-btn" data-w-action="create">新建${mode==='article'?'文章':'对话'}</button><button class="ghost-btn" data-w-action="export">导出当前记录</button></div><input class="field" id="writing-search" type="search" placeholder="搜索名称"><div>${rows.map(r=>`<section class="workspace-session" data-search-title="${esc(r.title.toLocaleLowerCase())}"><button class="ghost-btn" data-w-action="select" data-id="${esc(r.id)}">${esc(r.title)}${r.archived?' · 已归档':''}${r.id===selected[mode]?' · 当前':''}</button><div class="toolbar">${[['rename','改名'],['archive',r.archived?'恢复':'归档'],['delete','删除']].map(([a,t])=>`<button class="tool-mini" data-w-action="${a}" data-id="${esc(r.id)}">${t}</button>`).join('')}</div></section>`).join('')}</div>`;}
  async function renderDrawer(){const drawerId=++drawerEpoch;const host=$('writing-drawer');if(!host)return;host.hidden=!page;if(!page)return;const row=current(),r=fullRecord(mode,row)&&!viewLoadError?row:null;host.innerHTML=`<div class="workspace-drawer-head"><strong>${page==='settings'?'设置':page==='sources'?'来源章节':'会话与历史'}</strong><button class="ghost-btn" data-w-action="close-page">返回</button></div><div class="workspace-drawer-body">${page==='settings'&&r?settingsHtml(r):page==='sessions'?sessionsHtml():page==='sources'?'<div id="article-chapter-picker">正在读取小说目录…</div>':''}</div>`;
    stampControls(host);if(page==='settings'&&r)fillModels($('writing-model-list'),modelLists.get(modelFingerprint(config(r.settings)))||[],r.settings.model);
    if(page==='sources'){
      const v=viewVersion,host=$('article-chapter-picker'),res=await W.MimaStandalone.handle('/novels','GET');if(!res.success||v!==viewVersion||drawerId!==drawerEpoch||host!==$('article-chapter-picker'))return;
      host.innerHTML=res.data.length?res.data.map(p=>`<button class="ghost-btn" data-w-action="source-project" data-id="${esc(p.id)}">${esc(p.title)}</button>`).join(''):'暂无小说项目。可以直接粘贴或导入 TXT。';stampControls(host);
    }
  }
  async function sourceProject(id){
    const articleId=selected.article,epoch=drawerEpoch,requestId=++sourceDirectorySequence,host=$('article-chapter-picker'),version=viewVersion;
    const res=await W.MimaStandalone.handle('/novels/'+encodeURIComponent(id),'GET');if(!res.success)throw Error(res.msg);
    if(requestId!==sourceDirectorySequence||mode!=='article'||selected.article!==articleId||epoch!==drawerEpoch||version!==viewVersion||page!=='sources'||host!==$('article-chapter-picker'))return;
    host.innerHTML=res.data.chapterOrder.map(cid=>{const c=res.data.chapters.find(x=>x.id===cid);return `<button class="ghost-btn" data-w-action="take-chapter" data-article="${esc(articleId)}" data-project="${esc(id)}" data-id="${esc(cid)}">${esc(c.title)}</button>`;}).join('');stampControls(host);
  }
  function render(){
    const host=$('writing-workspace-root');if(!host||mode==='novel')return;const focus=host.contains(document.activeElement)?document.activeElement:null,focusState=focus?.id?{id:focus.id,start:focus.selectionStart,end:focus.selectionEnd,scroll:focus.scrollTop}:null;const oldScroll=$('plain-chat-scroll'),reading=oldScroll?{top:oldScroll.scrollTop,follow:oldScroll.dataset.follow}:null;const r=current();
    if(viewBusy){stampControls(host);return;}
    if(viewLoadError){editorOwner=null;host.innerHTML=`<section class="workspace-rescue" role="alert"><strong>${viewLoadError.deleted?'记录已删除，下一条读取失败':'记录读取失败'}</strong><p>${esc(viewLoadError.error)}</p><button class="ghost-btn" data-w-action="retry-record" data-id="${esc(viewLoadError.id||'')}">重新读取</button><button class="ghost-btn" data-w-action="sessions">会话与历史</button></section><aside id="writing-drawer" class="workspace-drawer" hidden></aside>`;stampControls(host);renderDrawer();return;}
    if(!r){editorOwner=null;host.innerHTML=rescueHtml()+'<button class="primary-btn" data-w-action="create">新建</button><button class="ghost-btn" data-w-action="sessions">会话与历史</button><aside id="writing-drawer" class="workspace-drawer" hidden></aside>';stampControls(host);renderDrawer();return;}
    if(!fullRecord(mode,r)){editorOwner=null;const ticket=beginView(mode,r.id);host.textContent='正在读取记录…';void loadSelection(ticket).catch(e=>failView(ticket,e));return;}
    editorOwner={kind:mode,id:r.id,token:uid(),...(mode==='article'?{baseSource:r.source,baseOrigin:clone(r.origin??null)}:{})};
    const active=runs.has(editKey(mode,r.id)),stale=r.run&&!active;
    host.innerHTML=`<div class="workspace-toolbar"><strong class="workspace-current-title">${esc(r.title)}</strong><span id="writing-model-summary" title="${esc(config(r.settings).model)}">${esc(config(r.settings).model||'未配置模型')}</span><button class="ghost-btn" data-w-action="sessions">${mode==='article'?'历史':'会话'}</button><button class="ghost-btn" data-w-action="settings">设置</button></div><div class="workspace-body">${rescueHtml()}${mode==='article'?articleHtml(r,active):chatHtml(r,active)}</div><div id="writing-status" class="workspace-status" role="status">${esc(uiStatus)}${stale?'<button class="ghost-btn" data-w-action="recover">确认恢复中断记录</button>':''}</div><aside id="writing-drawer" class="workspace-drawer" hidden></aside>`;
    if(mode==='article')hydratePresets(r);const scroll=$('plain-chat-scroll');if(scroll){scroll.dataset.follow=reading?.follow||'true';scroll.scrollTop=reading?.follow==='false'?reading.top:scroll.scrollHeight;scroll.addEventListener('scroll',()=>scroll.dataset.follow=String(scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80),{passive:true});}
    stampControls(host);renderDrawer();if(focusState){const el=$(focusState.id);if(el){el.focus({preventScroll:true});try{el.setSelectionRange(focusState.start,focusState.end);}catch(_){}el.scrollTop=focusState.scroll;}}
  }
  function articleHtml(r,active){return `<section class="article-controls"><div class="toolbar"><button class="ghost-btn" data-w-action="import-source">导入 TXT</button><button class="ghost-btn" data-w-action="sources">从小说取用</button><select id="article-preset-choice" class="field"><option value="">选择文风预设（默认不挂载）</option></select></div><div class="article-presets">${r.presets.map((p,i)=>`<div class="workspace-preset"><span>${i+1}. ${esc(p.name)} · 已选版本</span><button class="tool-mini" data-w-action="preset-up" data-index="${i}">↑</button><button class="tool-mini" data-w-action="preset-down" data-index="${i}">↓</button><button class="tool-mini" data-w-action="remove-preset" data-index="${i}">移除</button></div>`).join('')}</div><label>本轮要求 / 文风（可选，原样作为系统指令）<textarea id="article-requirement" class="field" rows="2" placeholder="留空则不添加要求">${esc(r.requirement)}</textarea></label><div class="toolbar"><button class="ghost-btn" data-w-action="preview">预览请求</button><button class="${active?'danger-btn':'primary-btn'}" data-w-action="${active?'stop':'generate'}">${active?'停止':'生成新版本'}</button>${!r.presets.length&&!r.requirement.trim()?'<span class="row-sub">未设置文风与要求，将只发送原文。</span>':''}</div></section><nav class="article-mobile-tabs"><button data-w-action="article-source" aria-pressed="${articleTab==='source'}">原文</button><button data-w-action="article-result" aria-pressed="${articleTab==='result'}">结果 · ${r.versions.length}</button></nav><div class="article-columns" data-article-tab="${articleTab}"><section class="article-source-panel"><div class="workspace-section-label">原文${r.origin?' · '+esc(r.origin.chapterTitle):''}</div><textarea id="article-source" data-source-revision="${Number(r.sourceRevision)||0}" class="field" placeholder="粘贴原文，不会自动替换宏或裁剪空白">${esc(r.source)}</textarea><button class="ghost-btn" data-w-action="save-source">保存原文新版本</button><details class="article-source-versions"><summary>原文历史 · ${r.sourceVersions?.length||0}</summary>${(r.sourceVersions||[]).map(v=>`<details><summary>${esc(v.time)}</summary><pre>${esc(v.source)}</pre></details>`).join('')}</details></section><section class="article-results-panel"><div class="workspace-section-label">结果版本 · ${r.versions.length}</div>${[...r.versions].reverse().map(v=>`<article class="article-version"><div class="row-sub">${esc(v.createdAt)} · ${statusLabel(v.status)}</div><pre id="writing-stream-${esc(v.id)}">${esc(v.content)}</pre>${v.error?`<div role="alert">${esc(v.error)}</div>`:''}<div class="toolbar">${[['copy','复制'],['export','导出 TXT'],['request','实际请求'],['source','原文快照'],...(v.snapshot.origin?[['replace','替换来源章节']]:[]),['delete','删除版本']].map(([a,t])=>`<button class="tool-mini" data-version-action="${a}" data-id="${esc(v.id)}">${t}</button>`).join('')}</div></article>`).join('')||'<p class="row-sub">生成的结果会保留在这里，原文独立保存。</p>'}</section></div><input id="article-file" type="file" accept=".txt,text/plain" hidden>`;}
  function statusLabel(s){return ({generating:'生成中',complete:'已完成',failed:'失败',interrupted:'已中断'})[s]||s;}
  function chatHtml(r,active){return `<div id="plain-chat-scroll" class="plain-chat-scroll">${r.messages.map(m=>`<article class="plain-chat-message ${m.role}"><div class="assistant-chat-meta"><span>${m.role==='user'?'你':'模型'}${m.status?' · '+statusLabel(m.status):''}</span><span>${[['copy','复制'],['edit','编辑'],...(m.role==='assistant'?[['regenerate','重说']]:[])].map(([a,t])=>`<button class="tool-mini" data-message-action="${a}" data-id="${esc(m.id)}" ${active?'disabled':''}>${t}</button>`).join('')}</span></div><pre id="writing-stream-${esc(m.id)}">${esc(m.content)}</pre>${m.error?`<p role="alert">${esc(m.error)}</p>`:''}${m.versions?.length?`<details><summary>消息旧版本 · ${m.versions.length}</summary>${m.versions.map(v=>`<pre>${esc(v.content)}</pre>`).join('')}</details>`:''}</article>`).join('')||'<div class="assistant-empty">输入消息即可开始对话。</div>'}${r.branches?.length?`<details class="workspace-history-versions"><summary>保留的对话分支 · ${r.branches.length}</summary>${r.branches.map(b=>`<details><summary>${esc(b.time)}</summary><pre>${esc(b.messages.map(m=>m.role+'：'+m.content).join('\n\n'))}</pre></details>`).join('')}</details>`:''}</div><div class="plain-chat-composer"><button class="ghost-btn" data-w-action="preview">预览</button><textarea id="plain-chat-input" class="field" rows="2" placeholder="输入消息，Enter 换行">${esc(r.composer)}</textarea><button class="${active?'danger-btn':'primary-btn'}" data-w-action="${active?'stop':'generate'}">${active?'停止':'发送'}</button></div>`;}
  async function hydratePresets(row){const node=$('article-preset-choice');const res=await W.MimaStandalone.handle('/presets','GET');if(node!==$('article-preset-choice')||selected.article!==row.id||!res.success)return;for(const p of res.data.filter(p=>p.type==='style'))node.add(new Option(p.name,p.id));}
  document.addEventListener('input',e=>{
    const o=writableOwner(e.target);
    if(e.target.id==='writing-search'){const query=e.target.value.toLocaleLowerCase();$('writing-drawer').querySelectorAll('[data-search-title]').forEach(n=>n.hidden=!n.dataset.searchTitle.includes(query));return;}
    if(!o)return;
    if(e.target.id==='article-source'&&o.kind==='article')queueEdit(o.kind,o.id,'source',e.target.value,{baseSourceRevision:Number(e.target.dataset.sourceRevision)||0,baseSource:o.baseSource,baseOrigin:o.baseOrigin});
    else if(e.target.id==='article-requirement'&&o.kind==='article')queueEdit(o.kind,o.id,'requirement',e.target.value);
    else if(e.target.id==='plain-chat-input'&&o.kind==='chat')queueEdit(o.kind,o.id,'composer',e.target.value);
  });
  document.addEventListener('change',e=>{
    const el=e.target;
    if(el.id==='article-file'&&fileTargets.has(el)){void importSource(el.files?.[0],fileTargets.get(el));return;}
    if(!writableOwner(el))return;
    if(el.dataset.setting){let v=el.value;if(['streaming','sendTemperature','sendTopP'].includes(el.dataset.setting))v=v==='inherit'?null:v==='yes';void setSetting(el.dataset.setting,v);}
    if(el.id==='article-preset-choice')void selectPreset(el.value);
  });
  document.addEventListener('click',e=>{
    const tab=e.target.closest('button[data-writing-mode]');if(tab){void showMode(tab.dataset.writingMode);return;}
    const b=e.target.closest('[data-w-action],[data-version-action],[data-message-action]');if(!b||!b.closest('#writing-workspace-root')||b.disabled)return;
    let task;const a=b.dataset.wAction,id=b.dataset.id;
    const navigation=['sessions','close-page','select','create','retry-record'].includes(a);
    const rescue=/^(rescue-|conflict-|edit-)/.test(a||'');
    if(!navigation&&!rescue&&!writableOwner(b))return;
    if(b.dataset.writingKind!==mode)return;
    try{
      if(b.dataset.versionAction)task=versionAction(b.dataset.versionAction,id);
      else if(b.dataset.messageAction)task=messageAction(b.dataset.messageAction,id);
      else if(a==='settings'||a==='sessions'||a==='sources')task=showPage(a);
      else if(a==='close-page')task=showPage('');
      else if(a==='retry-record')task=id?select(id):showMode(mode);
      else if(a==='conflict-local'||a==='conflict-canonical')task=resolveConflict(id,a==='conflict-local');
      else if(a==='edit-retry')task=flushEdit(id);
      else if(a==='edit-export'||a==='edit-copy'){const record={...editFailures.get(id),fields:clone(edits.get(id)?.fields||editFailures.get(id)?.fields||{})};task=a==='edit-copy'?copy(record.fields.source??record.fields.composer??JSON.stringify(record.fields)):download('未保存草稿.json',JSON.stringify(record,null,2));}
      else if(a==='article-source'||a==='article-result'){articleTab=a==='article-source'?'source':'result';const columns=document.querySelector('.article-columns');if(columns)columns.dataset.articleTab=articleTab;document.querySelectorAll('.article-mobile-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.wAction==='article-'+articleTab)));}
      else if(a==='rescue-dismiss'){if(confirm('确认已另外保存这份未提交内容？关闭后只保留正式会话中已经成功保存的记录。')){if(data?.sourceCandidates?.some(x=>x.id===id)){task=sourceCandidateWrite({id},true).then(render);}else{W.MimaUiDrafts.remove('writing-rescue:'+id);W.MimaUiDrafts.put('writing-rescue-index',{ids:(W.MimaUiDrafts.get('writing-rescue-index')?.ids||[]).filter(x=>x!==id)},{immediate:true});render();}}}
      else if(a==='rescue-export'||a==='rescue-copy'){const record=[...rescues(),...(data?.sourceCandidates||[])].find(x=>x.id===id);if(record)task=a==='rescue-copy'?copy(record.content):download('数据救援_'+id+'.json',JSON.stringify(record,null,2));}
      else if(a==='create')task=create();else if(a==='select')task=select(id);
      else if(['delete','rename','archive','recover'].includes(a))task=sessionAction(a,id);
      else if(a==='generate')task=generate();else if(a==='stop')task=stop();else if(a==='preview')task=preview();else if(a==='models')task=loadModels();
      else if(a==='remove-preset')task=removePreset(Number(b.dataset.index));else if(a==='preset-up'||a==='preset-down')task=movePreset(Number(b.dataset.index),a==='preset-up'?-1:1);
      else if(a==='import-source'){const file=$('article-file');fileTargets.set(file,beginSourceOperation());file.value='';file.click();}else if(a==='save-source')task=saveSourceVersion();
      else if(a==='source-project')task=sourceProject(id);else if(a==='take-chapter'){page='';task=takeChapter(b.dataset.project,id,b.dataset.article);}else if(a==='export')task=exportCurrent();
      Promise.resolve(task).catch(err=>notify(err.message));
    }catch(err){notify(err.message);}
  });
  W.addEventListener('pagehide',()=>{capture();void flushEdits().catch(()=>{});for(const r of runs.values())r.controller.abort();});
  W.MimaWritingWorkspace={showMode,stopAll,showRequest,config,planArticle,planChat,exportRecords,validateRecords,importRecords,updateStatus,novelModels,getMode:()=>mode};
})();
