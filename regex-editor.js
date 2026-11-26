/* Automatically build every rule in order, yielding between small DOM batches. */
(()=>{'use strict';
 const views=new WeakMap();let active=null;
 const jobs=[],channel=new MessageChannel();channel.port1.onmessage=()=>jobs.shift()?.();
 const yieldToUi=()=>new Promise(resolve=>{jobs.push(resolve);channel.port2.postMessage(0);});
 const arr=v=>Array.isArray(v)?v:[];
 const copyPack=p=>({...p,rules:arr(p.rules).map(r=>({...r})),displayStyles:arr(p.displayStyles).map(r=>({...r}))});
 const flatEqual=(a,b)=>{const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every(k=>a[k]===b[k]);};
 const text=(tag,value,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
 const live=v=>active===v&&views.get(v.owner)===v&&!v.cancelled;
 function button(label,fn,cls='ghost-btn'){const b=text('button',label,cls);b.type='button';b.onclick=fn;return b;}
 function sourceField(label,name,value){const block=text('div',undefined,'form-full');const title=text('label',label,'form-label'),area=document.createElement('textarea');area.className='field textarea mono regex-source-editor';area.spellcheck=false;area.wrap='off';area.setAttribute('autocorrect','off');area.setAttribute('autocapitalize','off');area.value=String(value??'');
  if(name)area.dataset.rf=name;title.append(area);block.append(title);return {block,area};}

 function bindField(parent,label,name,value,{area=false,type='text',options=null}={}){
  if(type==='checkbox'){const row=text('label',undefined,'check-row form-full'),el=document.createElement('input');el.type='checkbox';el.dataset.rf=name;el.checked=value!==false;row.append(el,document.createTextNode(label));parent.append(row);return el;}
  if(area){const f=sourceField(label,name,value);parent.append(f.block);return f.area;}
  const block=text('div',undefined,name==='description'?'form-full':'');const title=text('label',label,'form-label'),el=document.createElement(options?'select':'input');el.className='field';el.dataset.rf=name;
  if(options)for(const [key,label]of options){const o=text('option',label);o.value=key;el.append(o);}else el.type=type;
  if(type==='checkbox')el.checked=value!==false;else el.value=String(value??'');title.append(el);block.append(title);parent.append(block);return el;
 }
 const packFields={'regex-name':'name','regex-desc':'description','regex-priority':'priority','regex-pack-enabled':'enabled'};
 function fieldValue(el,key){
  if(key==='enabled')return el.checked;
  if(key==='priority')return Number(el.value===''?50:el.value);
  return key==='flags'?el.value||'g':el.value;
 }
 function trackInput(v,el){
  const key=packFields[el.id];
  if(key){v.owner.draft[key]=fieldValue(el,key);return;}
  if(el.dataset.regexStyle!==undefined){
   const i=Number(el.dataset.regexStyle),old=v.owner.draft.displayStyles[i];
   if(old?.css===el.value)v.changedStyles.delete(i);else v.changedStyles.set(i,el);
   return;
  }
  const field=el.dataset.rf,card=v.fields.get(el);
  if(!field||!card)return;
  const rule=v.owner.draft.rules[card.index];
  rule[field]=fieldValue(el,field);
  if(field==='name'||field==='phase'||field==='priority'||field==='enabled')updateHeading(v,card);
  if(card.baseline&&flatEqual(rule,card.baseline))v.changedRules.delete(card);
  else v.changedRules.add(card);
 }
 function snapshot(owner){
  const v=views.get(owner),pack=owner.draft;
  if(!v?.changedStyles.size)return pack;
  const styles=pack.displayStyles.slice(),aliases=new Map();
  for(const [i,el] of v.changedStyles){
   const css=el.value,id='style_'+MimaStoryDisplay.hash(css);
   aliases.set(styles[i].id,id);styles[i]={id,css};
  }
  const rules=pack.rules.map(rule=>{
   if(!rule.replacement.includes('<mima-style'))return rule;
   const replacement=rule.replacement.replace(/(<mima-style\b[^>]*?\bdata-ref\s*=\s*)(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,
    (match,start,a,b,c)=>aliases.has(a||b||c)?start+'"'+aliases.get(a||b||c)+'"':match);
   return replacement===rule.replacement?rule:{...rule,replacement};
  });
  return {...pack,rules,displayStyles:[...new Map(styles.map(row=>[row.id,row])).values()]};
 }
 function matches(v,rule,index){const q=v.search.value.trim().toLocaleLowerCase();return !q||((index+1)+' '+rule.name+' '+rule.description+' '+rule.phase).toLocaleLowerCase().includes(q);}
 function updateHeading(v,card){const r=v.owner.draft.rules[card.index];card.node.dataset.regexIndex=String(card.index);card.title.textContent=(card.index+1)+'. '+(r.name||'未命名规则');card.meta.textContent=(r.phase||'display')+' · 优先级 '+Number(r.priority??50)+(r.enabled===false?' · 已停用':'');card.node.hidden=!matches(v,r,card.index);}
 function updateProgress(v){const total=v.owner.draft.rules.length;v.progress.textContent=v.loading?`正在自动载入全部规则 · ${v.cards.size} / ${total}`:`全部 ${total} 条规则已载入`;v.jump.max=String(Math.max(1,total));v.root.dataset.regexReady=String(!v.loading);}
 function makeRule(v,index){const rule=v.owner.draft.rules[index],d=text('details',undefined,'entry-card regex-rule-card mima-regex-auto-card');d.open=v.owner.draft.rules.length<=3;
  const summary=text('summary'),title=text('strong'),meta=text('span',undefined,'entry-meta');summary.append(title,meta);d.append(summary);const grid=text('div',undefined,'form-grid');d.append(grid);
  const fields={};fields.name=bindField(grid,'规则名称','name',rule.name);fields.phase=bindField(grid,'执行阶段','phase',rule.phase||'display',{options:[['display','显示渲染'],['prompt','提示词注入前'],['input','用户发送前'],['output','角色回复保存前']]});
  fields.flags=bindField(grid,'匹配标志','flags',rule.flags||'g');fields.priority=bindField(grid,'优先级','priority',rule.priority??50,{type:'number'});fields.pattern=bindField(grid,'匹配式','pattern',rule.pattern,{area:true});fields.replacement=bindField(grid,'替换内容（支持 $1 / $2）','replacement',rule.replacement,{area:true});fields.description=bindField(grid,'说明','description',rule.description);fields.enabled=bindField(grid,'启用此规则','enabled',rule.enabled,{type:'checkbox'});
  if(v.wrap)for(const area of [fields.pattern,fields.replacement]){area.wrap='soft';area.classList.add('regex-source-wrap');}
  const card={index,node:d,title,meta,fields,baseline:v.loading?v.baseline.rules[index]:null};for(const el of Object.values(fields))v.fields.set(el,card);const remove=button('删除此规则',()=>window.removeRegexRule(card.index),'danger-btn');remove.disabled=v.loading;d.append(remove);card.remove=remove;v.cards.set(index,card);updateHeading(v,card);return d;
 }
 function select(owner,index){const v=views.get(owner),card=v?.cards.get(index);if(!card)return;v.search.value='';for(const c of v.cards.values())c.node.hidden=false;card.node.open=true;card.node.scrollIntoView({block:'start'});}
 function mount(owner,root){
  if(views.has(owner))return;if(active)destroy(active.owner);
  const p=owner.draft;root.innerHTML='<div class="form-grid"><div><label class="form-label">名称<input id="regex-name" class="field"></label></div><div><label class="form-label">优先级<input id="regex-priority" class="field" type="number"></label></div><div class="form-full"><label class="form-label">说明<input id="regex-desc" class="field"></label></div></div><label class="check-row"><input id="regex-pack-enabled" type="checkbox">启用正则包（整包挂载）</label><div class="toolbar"><button type="button" class="ghost-btn" id="regex-add-rule">＋ 新增规则</button><button type="button" class="ghost-btn" id="regex-open-assistant">✦ 打开正则助手</button></div><label class="check-row"><input type="checkbox" id="regex-wrap-code">代码自动换行</label><section class="mima-regex-library"><p id="regex-rule-count" class="row-sub" role="status"></p><label class="form-label">查找规则<input id="regex-rule-search" class="field" type="search" placeholder="搜索编号、名称、说明或阶段"></label><div class="inline-field-row"><label class="form-label">规则编号<input id="regex-rule-jump" class="field" type="number" min="1" value="1"></label><button type="button" class="ghost-btn" id="regex-rule-go">定位规则</button></div><div id="regex-rule-list" class="entry-list"></div></section><div id="regex-style-list"></div><section class="regex-tester"><h4>转换与正式页面预览</h4><label class="form-label">测试文本<textarea id="regex-test-input" class="field textarea" placeholder="粘贴待转换的文本"></textarea></label><label class="form-label">执行阶段<select id="regex-test-phase" class="field"><option value="display">显示渲染</option><option value="output">角色回复保存前</option><option value="input">用户发送前</option><option value="prompt">提示词注入前</option></select></label><label class="form-label">执行范围<select id="regex-test-mode" class="field"><option value="session">当前剧情完整转换链（含宏与已挂载规则）</option><option value="pack">仅此正则包</option></select></label><div class="toolbar"><button type="button" class="ghost-btn" id="regex-run-draft">运行并预览</button></div><pre id="regex-test-output" class="prompt-pre">测试结果会显示在这里。</pre><p id="regex-test-warnings" class="row-sub" role="status"></p><iframe id="regex-test-preview" title="正式页面状态栏预览" sandbox="allow-same-origin" hidden></iframe></section>';
  const $=id=>root.querySelector('#'+id);$('regex-name').value=p.name||'';$('regex-priority').value=String(p.priority??50);$('regex-desc').value=p.description||'';$('regex-pack-enabled').checked=p.enabled!==false;
  let resolve;const ready=new Promise(r=>resolve=r);const v={owner,root,baseline:copyPack(p),loading:true,cancelled:false,ready,resolve,cards:new Map(),fields:new WeakMap(),changedStyles:new Map(),changedRules:new Set(),styleFields:new Map(),search:$('regex-rule-search'),list:$('regex-rule-list'),progress:$('regex-rule-count'),jump:$('regex-rule-jump'),add:$('regex-add-rule'),go:$('regex-rule-go'),run:$('regex-run-draft')};views.set(owner,v);active=v;v.events=new AbortController();const input=event=>trackInput(v,event.target);root.addEventListener('input',input,{signal:v.events.signal});root.addEventListener('change',input,{signal:v.events.signal});
  $('regex-wrap-code').onchange=()=>{v.wrap=$('regex-wrap-code').checked;for(const area of root.querySelectorAll('.regex-source-editor')){area.wrap=v.wrap?'soft':'off';area.classList.toggle('regex-source-wrap',v.wrap);}};
  v.search.oninput=()=>{for(const c of v.cards.values())c.node.hidden=!matches(v,owner.draft.rules[c.index],c.index);};v.go.onclick=()=>select(owner,Number(v.jump.value)-1);v.add.onclick=()=>window.addRegexRule();$('regex-open-assistant').onclick=()=>window.MimaAssistantStudio.open('regex');v.run.onclick=()=>window.testRegexDraft();v.add.disabled=v.go.disabled=v.run.disabled=true;updateProgress(v);
  void (async()=>{
   let styleHost=null;for(let at=0;live(v)&&(at<p.rules.length||v.styleFields.size<p.displayStyles.length);){
    await yieldToUi();if(!live(v))break;const frag=document.createDocumentFragment(),start=performance.now();let batch=0;
    while(at<p.rules.length&&batch<8&&performance.now()-start<6){frag.append(makeRule(v,at++));batch++;}v.list.append(frag);
    if(at===p.rules.length&&v.styleFields.size<p.displayStyles.length){if(!styleHost){styleHost=text('details',undefined,'regex-static-styles');styleHost.append(text('summary',`状态栏固定样式 · ${p.displayStyles.length} 份`));$('regex-style-list').append(styleHost);}const i=v.styleFields.size,f=sourceField(`完整固定样式 ${i+1}`,null,p.displayStyles[i].css);f.area.dataset.regexStyle=String(i);v.styleFields.set(i,f.area);styleHost.append(f.block);}
    updateProgress(v);
   }
   if(!live(v)){resolve({status:'CANCELLED'});return;}v.loading=false;v.add.disabled=v.go.disabled=v.run.disabled=false;for(const c of v.cards.values())c.remove.disabled=false;updateProgress(v);resolve({status:'READY',rules:v.cards.size});
  })().catch(error=>{if(live(v)){v.progress.textContent='规则载入未完成：'+error.message+'；原包仍完整保留。';v.root.dataset.regexLoadError=error.message;}resolve({status:'FAILED',error:error.message});});
 }
 function added(owner){const v=views.get(owner);if(!v||v.loading)return;const i=owner.draft.rules.length-1;v.list.append(makeRule(v,i));v.cards.get(i).node.open=true;updateProgress(v);}
 function removed(owner,index){const v=views.get(owner);if(!v||v.loading)return;const removed=v.cards.get(index);removed?.node.remove();v.changedRules.delete(removed);v.cards.delete(index);const next=new Map();for(const [i,c]of v.cards){if(i>index)c.index--;next.set(c.index,c);}v.cards=next;for(const c of v.cards.values())updateHeading(v,c);updateProgress(v);}
 function hasChanges(owner){
  const v=views.get(owner);if(!v)return false;
  const before=v.baseline,after=owner.draft;
  return v.changedStyles.size>0||v.changedRules.size>0||after.rules.length!==before.rules.length||
    Object.values(packFields).some(key=>before[key]!==after[key])||
    [...v.cards.values()].some(card=>card.baseline!==before.rules[card.index]);
 }
 function destroy(owner){const v=views.get(owner);if(v){v.events.abort();v.cancelled=true;v.resolve({status:'CANCELLED'});}views.delete(owner);if(active===v)active=null;}
 window.MimaRegexEditor={copyPack,mount,snapshot,select,added,removed,hasChanges,ready:owner=>views.get(owner)?.ready||Promise.resolve({status:'CANCELLED'}),isLoading:owner=>!!views.get(owner)?.loading,readyForCurrent:()=>active?.ready||Promise.resolve({status:'CANCELLED'}),destroy};
})();
