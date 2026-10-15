/* Session-scoped Regex UI. Source JSON stays immutable; Runtime owns all writes. */
(function(root){'use strict';
function create(panel,bridge){
 const runtime=()=>root.MimaCompatRuntime,store=()=>root.MimaCompatStore;
 const node=(tag,props={},parent)=>{const n=document.createElement(tag);for(const [key,value]of Object.entries(props)){if(key==='text')n.textContent=value;else if(key==='className')n.className=value;else if(key==='click')n.addEventListener('click',value);else n.setAttribute(key,value);}parent?.append(n);return n;};
 let generation=0,ownerId='',rules=[],editing=null,editorOwner=null;
 const owner=()=>bridge.owner(),same=ticket=>{const now=owner();return now.id===ticket.id&&now.generation===ticket.generation;};
 node('span',{className:'compat-eyebrow',text:'REGEX · 文字与界面'},panel);
 node('h3',{text:'正则规则'},panel);
 node('p',{className:'compat-help',text:'卡内规则和手动导入的规则一起列在这里。开关、修改与排序只保存到当前故事，原卡完整保留。'},panel);
 const importBar=node('div',{className:'compat-tool-actions'},panel),label=node('label',{className:'compat-button-label',for:'compat-resource-file',text:'＋ 导入正则 / 世界书 / 预设'},importBar);
 const file=node('input',{id:'compat-resource-file',type:'file',accept:'.json',className:'compat-file-input'},importBar);
 const createButton=node('button',{type:'button',text:'新建规则'},importBar);
 const status=node('p',{id:'compat-regex-status',role:'status',className:'compat-help'},panel);
 const list=node('div',{id:'compat-regex-list'},panel);
 const editor=node('section',{id:'compat-regex-editor',className:'compat-regex-editor',hidden:'hidden'},panel);
 node('h3',{text:'编辑与测试'},editor);
 const source=node('p',{className:'compat-help'},editor),form=node('div',{className:'compat-regex-form'},editor);
 const field=(title,id,tag='input',attributes={})=>{const label=node('label',{for:id,text:title},form),input=node(tag,{id,...attributes},label);return input;};
 const fields={name:field('规则名称','compat-regex-name'),find:field('查找表达式','compat-regex-find','textarea',{rows:2}),replace:field('替换为','compat-regex-replace','textarea',{rows:5}),trim:field('移除匹配内容中的文本（每行一项）','compat-regex-trim','textarea',{rows:2})};
 const places=node('fieldset',{},form);node('legend',{text:'作用于'},places);const placement={};
 for(const [phase,text]of[[1,'玩家消息'],[2,'角色回复'],[5,'世界书'],[3,'斜杠命令（需对应入口）'],[6,'思考（需对应入口）']]){const label=node('label',{},places);placement[phase]=node('input',{type:'checkbox',value:phase},label);label.append(document.createTextNode(text));}
 const flags=node('fieldset',{},form);node('legend',{text:'作用阶段'},flags);
 for(const [key,text]of[['markdownOnly','仅显示'],['promptOnly','仅发送给模型'],['runOnEdit','编辑时运行']]){const label=node('label',{},flags);fields[key]=node('input',{type:'checkbox'},label);label.append(document.createTextNode(text));}
 node('p',{className:'compat-help',text:'“仅显示”和“仅发送”可以同时启用。都不勾选时，先处理源文本的派生副本；咪嘛馆始终保留原始正文。编辑时运行仅适用于实际调用编辑阶段的入口。'},form);
 fields.substitute=field('查找表达式中的宏','compat-regex-substitute','select');
 for(const [value,text]of[[0,'保持原样'],[1,'替换为实际值'],[2,'转义特殊字符后替换']])node('option',{value,text},fields.substitute);
 fields.min=field('最小深度（留空不限）','compat-regex-min','input',{type:'number',min:'-1'});
 fields.max=field('最大深度（留空或 -1 不限）','compat-regex-max','input',{type:'number',min:'-1'});
 const saveBar=node('div',{className:'compat-tool-actions'},editor),save=node('button',{type:'button',className:'compat-accent-button',text:'保存到当前故事'},saveBar),cancel=node('button',{type:'button',text:'收起编辑器'},saveBar);
 const tester=node('details',{className:'compat-regex-tester',open:'open'},editor);node('summary',{text:'本地测试 · 不调用模型'},tester);
 const testInput=node('textarea',{id:'compat-regex-test-input',rows:3,placeholder:'输入一段文字，查看这条规则的实际处理结果', 'aria-label':'正则测试输入'},tester);
 const testPhase=node('select',{id:'compat-regex-test-phase','aria-label':'正则测试阶段'},tester);
 for(const [value,text]of[['display','显示结果'],['prompt','发送给模型的结果']])node('option',{value,text},testPhase);
 const testButton=node('button',{id:'compat-regex-test-run',type:'button',text:'运行测试'},tester);
 const output=node('pre',{id:'compat-regex-test-output',role:'status',text:'测试结果会显示在这里。'},tester);
 function notify(text,error=false,ticket=owner()){if(!same(ticket))return;status.textContent=text;status.dataset.kind=error?'error':'info';bridge.notify?.(text,error,ticket);}
 const action=fn=>event=>{Promise.resolve().then(()=>fn(event)).catch(e=>notify((e.code||'E_REGEX_UI')+': '+e.message,true));};
 function readDraft(){
  return{scriptName:fields.name.value.trim()||'未命名规则',findRegex:fields.find.value,replaceString:fields.replace.value,trimStrings:fields.trim.value.split('\n').filter(x=>x!==''),placement:Object.entries(placement).filter(([,input])=>input.checked).map(([phase])=>Number(phase)),markdownOnly:fields.markdownOnly.checked,promptOnly:fields.promptOnly.checked,runOnEdit:fields.runOnEdit.checked,substituteRegex:Number(fields.substitute.value),minDepth:fields.min.value===''?null:Number(fields.min.value),maxDepth:fields.max.value===''?null:Number(fields.max.value),...(editing?.flags?{flags:editing.flags}:{})};
 }
 function edit(rule){
  if(editing&&!editor.hidden&&JSON.stringify(readDraft())!==JSON.stringify(editing.__draft)&&!root.confirm('打开另一条规则会替换当前未保存的编辑内容。继续吗？'))return;
  editing=rule;editorOwner=owner();editor.hidden=false;
  fields.name.value=rule.scriptName||'';fields.find.value=rule.findRegex||'';fields.replace.value=rule.replaceString||'';fields.trim.value=(rule.trimStrings||[]).join('\n');
  for(const [phase,input]of Object.entries(placement))input.checked=(rule.placement||[]).includes(Number(phase));
  for(const key of['markdownOnly','promptOnly','runOnEdit'])fields[key].checked=!!rule[key];
  fields.substitute.value=String(rule.substituteRegex??0);fields.min.value=rule.minDepth??'';fields.max.value=rule.maxDepth??'';
  editing={...rule,__draft:readDraft()};source.textContent=rule.__mimaRegexRef?'来源：'+rule.__mimaRegexRef.path+' · 保存为本故事覆盖，原卡不变。':'新规则会保存为独立 JSON 来源并挂载到本故事。';
  output.textContent='测试结果会显示在这里。';fields.name.focus({preventScroll:true});editor.scrollIntoView({block:'start',behavior:'smooth'});
 }
 async function changed(ticket){await bridge.onChange(ticket);if(same(ticket))await refresh();}
 file.addEventListener('change',action(async()=>{const selected=file.files[0],ticket=owner();if(!selected||!ticket.id)return;file.disabled=true;try{await bridge.importResource(selected,ticket);if(same(ticket))await refresh();}finally{file.disabled=false;file.value='';}}));
 createButton.addEventListener('click',()=>edit({scriptName:'新规则',findRegex:'',replaceString:'',trimStrings:[],placement:[2],markdownOnly:true,promptOnly:false,substituteRegex:0}));
 cancel.addEventListener('click',()=>{editor.hidden=true;});
 save.addEventListener('click',action(async()=>{const ticket=editorOwner;if(!ticket||!same(ticket))throw new Error('编辑时已切换故事，请重新选择规则');const draft=readDraft();save.disabled=true;
  try{if(editing.__mimaRegexRef)await runtime().saveRegexSettings(ticket.id,{key:editing.__mimaRegexRef.key,rule:draft});
   else{const receipt=await bridge.importResource(new File([JSON.stringify(draft,null,2)],draft.scriptName+'.json',{type:'application/json'}),ticket);
    if(!same(ticket))return;
    const session=await runtime().getSession(ticket.id),resources=await runtime().resourcesFor(session);if(!same(ticket))return;
    const imported=runtime().regexRules(resources,session).find(rule=>receipt.resourceIds.includes(rule.__mimaRegexRef.resourceId));
    if(!imported)throw new Error('规则来源已保存，但没有取得当前故事的挂载引用；请从规则列表重新打开');editing=imported;
   }
   editing={...editing,...draft,__draft:draft};await changed(ticket);notify('规则已保存到当前故事，原始卡片和正文保留。',false,ticket);
  }finally{save.disabled=false;}
 }));
 testButton.addEventListener('click',action(async()=>{const ticket=editorOwner;if(!ticket||!same(ticket))throw new Error('测试所属的故事已经变化');testButton.disabled=true;
  try{const session=await runtime().getSession(ticket.id),resources=await runtime().resourcesFor(session),macroContext=await runtime().regexMacroContext(session,resources);if(!same(ticket))return;
   const draft={...readDraft(),disabled:false,__mimaRegexRef:editing.__mimaRegexRef},phase=draft.placement.includes(2)?2:draft.placement[0]??2;
   const packet=(await runtime().regexProjection([{input:testInput.value,phase,options:{depth:0,macroContext}}],[draft],{isMarkdown:testPhase.value==='display',isPrompt:testPhase.value==='prompt'}))[0];if(!same(ticket))return;
   output.textContent=packet.result.output+(packet.ok?'':'\n\n运行未完成：'+packet.result.errors.map(e=>e.code+' · '+e.ruleName+' · '+e.message).join('\n'));output.dataset.kind=packet.ok?'info':'error';
  }finally{testButton.disabled=false;}
 }));
 async function refresh(){
  const ticket=owner(),epoch=++generation;if(!ticket.id)return;
  const session=await runtime().getSession(ticket.id),resources=await runtime().resourcesFor(session);if(!same(ticket)||epoch!==generation)return;
  if(ownerId!==ticket.id){ownerId=ticket.id;editing=null;editorOwner=null;editor.hidden=true;status.textContent='';}
  else if(editing&&editorOwner?.id===ticket.id)editorOwner=ticket;
  rules=runtime().regexRules(resources,session);list.replaceChildren();
  if(!rules.length)node('div',{className:'compat-soft-empty',text:'还没有正则规则。可以导入酒馆导出的单条 JSON，也可以新建。'},list);
  for(const [index,rule]of rules.entries()){
   const ref=rule.__mimaRegexRef,row=node('article',{className:'compat-regex-row','data-regex-key':ref.key},list),top=node('div',{className:'compat-regex-row-head'},row),toggleLabel=node('label',{className:'compat-rule-switch'},top),toggle=node('input',{type:'checkbox','aria-label':'启用 '+(rule.scriptName||'规则')},toggleLabel);toggle.checked=!rule.disabled;
   node('strong',{text:rule.scriptName||'未命名规则'},toggleLabel);node('span',{className:'compat-rule-scope',text:ref.scope==='card'?'卡内':'外置'},top);
   node('p',{className:'compat-help',text:(rule.markdownOnly&&rule.promptOnly?'显示 + 发送':rule.markdownOnly?'仅显示':rule.promptOnly?'仅发送':'显示与发送的源副本')+' · '+(ref.overridden?'本故事覆盖':'沿用原规则')},row);
   const provenance=node('details',{},row);node('summary',{text:'查看来源与表达式'},provenance);node('small',{text:ref.path},provenance);node('pre',{text:rule.findRegex||'（无表达式）'},provenance);
   const controls=node('div',{className:'compat-tool-actions'},row);
   node('button',{type:'button',text:'编辑',click:()=>edit(rule)},controls);
   for(const [delta,text]of[[-1,'上移'],[1,'下移']]){const button=node('button',{type:'button',text,click:action(async()=>{const snapshot=owner(),order=rules.map(r=>r.__mimaRegexRef.key),other=index+delta;[order[index],order[other]]=[order[other],order[index]];await runtime().saveRegexSettings(snapshot.id,{order});await changed(snapshot);})},controls);button.disabled=index+delta<0||index+delta>=rules.length;}
   node('button',{type:'button',text:'导出 JSON',click:()=>{const value={...rule};delete value.__mimaRegexRef;const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=node('a',{href:url,download:(rule.scriptName||'regex').replace(/[\\/:*?"<>|]/g,'_')+'.json'},document.body);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}},controls);
   if(ref.overridden)node('button',{type:'button',text:'恢复原规则',click:action(async()=>{const snapshot=owner();await runtime().saveRegexSettings(snapshot.id,{key:ref.key,reset:true});await changed(snapshot);})},controls);
   toggle.addEventListener('change',action(async()=>{const snapshot=owner();toggle.disabled=true;try{await runtime().saveRegexSettings(snapshot.id,{key:ref.key,enabled:toggle.checked});await changed(snapshot);}finally{toggle.disabled=false;}}));
  }
 }
 return Object.freeze({refresh});
}
root.MimaCompatRegexUI=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
