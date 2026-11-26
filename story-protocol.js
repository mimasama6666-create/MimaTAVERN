/* Versioned semantic story protocols. No model calls, executable templates or
   DOM error-recovery are used to decide the meaning of the original source. */
(() => {
 'use strict';
 const verified=new WeakMap(),schemaKeys=new WeakMap(),sessions=new Map(),templates=new Map(),templateChecks=new Map();
 const tagName=/^[\p{L}_][\p{L}\p{N}_-]*$/u;
 const fault=message=>Object.assign(Error(message),{code:'E_SEMANTIC_PROTOCOL'});
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,m=>{
  const key=m.slice(1,-1).toLowerCase(),named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  if(key[0]!=='#')return named[key];
  const n=key[1]==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
  return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'�';
 });
 const integerValue=value=>String(value).trim().replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0));
 const percentValue=value=>integerValue(value).replace(/％/g,'%').replace(/%$/,'').trim();
 const aliasKey=tag=>/^[\x00-\x7f]+$/.test(tag)?tag.toLowerCase():tag;
 function canonicalTag(def,tag){if(!def?.aliases)return tag;const key=aliasKey(tag);for(const [alias,target] of Object.entries(def.aliases))if(aliasKey(alias)===key)return target;return tag;}
 function verify(schema){
  if(verified.has(schema))return schema;
  if(schema?.kind!=='semantic'||schema.version!==1||!schema.id||!Array.isArray(schema.rootOrder)||schema.rootOrder.length<2||
    !schema.definitions||schema.terminal!=='</'+schema.rootOrder.at(-1)+'>')throw fault('语义标签定义或结束标记不完整');
  const defs=schema.definitions;
  for(const [path,d]of Object.entries(defs)){
   if(!tagName.test(d.tag)||path!==d.path||!path.endsWith('/'+d.tag)||!['container','record','prose'].includes(d.kind))throw fault('语义标签定义无效：'+path);
   if(d.kind==='container'&&(!Array.isArray(d.children)||d.children.some(c=>!defs[c.path]||c.path.slice(0,c.path.lastIndexOf('/'))!==path||!Number.isInteger(c.min)||c.min<0||c.max!=null&&(!Number.isInteger(c.max)||c.max<c.min))))throw fault('栏目子项或数量无效：'+path);
   if(d.kind==='record'&&(!Array.isArray(d.fields)||d.fields.some(f=>!tagName.test(f))||new Set(d.fields).size!==d.fields.length||!Array.isArray(d.templates)||!d.templates.length||d.templates.some(t=>typeof t.html!=='string'||!Array.isArray(t.fields)||t.fields.some(f=>!d.fields.includes(f)))))throw fault('记录字段或呈现结构无效：'+path);
   if(d.kind==='record')for(const template of d.templates){const slots=[...template.html.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]));const maximum=d.fields.length?template.fields.length:1;if(slots.some(slot=>slot<1||slot>maximum)||template.fields.some((field,i)=>!slots.includes(i+1)))throw fault('呈现结构的字段引用不完整：'+path);}
   if(d.aliases&&Object.entries(d.aliases).some(([alias,target])=>!tagName.test(alias)||!(d.kind==='record'?d.fields:[...(d.children||[]).map(child=>defs[child.path].tag),d.replyCountField].filter(Boolean)).includes(target)))throw fault('别名未指向已声明的字段或记录：'+path);
   if(d.aliases){const names=d.kind==='record'?d.fields:[...(d.children||[]).map(c=>defs[c.path].tag),d.replyCountField].filter(Boolean),seen=new Set();for(const [alias,target] of Object.entries(d.aliases)){const key=aliasKey(alias);if(seen.has(key)||names.some(name=>aliasKey(name)===key))throw fault('别名与现有标签冲突：'+path+'/'+alias);seen.add(key);}}
   const pieces=d.kind==='record'?d.templates.map(t=>t.html):[d.openHtml||'',d.closeHtml||''];
   for(const html of pieces){
    if(typeof html!=='string'||/<\/?(?:script|iframe|object|embed|form|input|button|select|textarea|link|meta|base)\b|\bon\w+\s*=|javascript\s*:/i.test(html))throw fault('呈现结构含不可执行之外的内容：'+path);
    for(const tag of html.matchAll(/<[^>]+>/g))if(/\$\d+/.test(tag[0])&&!/^<div\s+class="c-favor-fill"\s+style="width:\$1%;--value:\$1%;">$/.test(tag[0]))throw fault('动态字段只能填入文字或声明的数值条：'+path);
   }
  }
  if(new Set(schema.rootOrder).size!==schema.rootOrder.length||schema.rootOrder.some(tag=>!defs['/'+tag]))throw fault('缺少根栏目定义');
  verified.set(schema,true);schemaKeys.set(schema,JSON.stringify(schema));return schema;
 }
 function templateContexts(schema){
  const rows=[];
  for(const def of Object.values(schema.definitions)){
   if(def.kind==='prose')continue;
   const parts=def.path.split('/').filter(Boolean),ancestors=[];
   for(let i=1;i<parts.length;i++){const parent=schema.definitions['/'+parts.slice(0,i).join('/')];if(parent?.kind==='container')ancestors.push(parent);}
   const before=ancestors.map(d=>d.openHtml||'').join(''),after=ancestors.slice().reverse().map(d=>d.closeHtml||'').join('');
   if(def.kind==='container')rows.push({path:def.path,html:before+(def.openHtml||'')+(def.closeHtml||'')+after});
   else for(const [index,template]of def.templates.entries())rows.push({path:def.path+' / 呈现 '+(index+1),html:before+textTemplate(template.html,Array(Math.max(1,template.fields.length)).fill('格式样例'),50)+after});
  }
  return rows;
 }
 function verifyTemplates(schema){
  verify(schema);
  if(!window.MimaHtmlStructure?.rawBalance)throw fault('HTML结构检查模块未加载，请完整更新生产包');
  const key=schemaKeys.get(schema);if(templateChecks.has(key))return templateChecks.get(key);
  const rows=templateContexts(schema);
  for(const row of rows){const check=MimaHtmlStructure.rawBalance(row.html);if(!check.ok)throw fault(row.path+' 的呈现结构未闭合：'+check.reason);}
  templateChecks.set(key,rows);while(templateChecks.size>24)templateChecks.delete(templateChecks.keys().next().value);return rows;
 }
 function createState(schema){
  verify(schema);
  const root={tag:'',path:'',kind:'root',children:[],rawStart:0,innerStart:0,complete:false};
  return {schema,raw:'',cursor:0,root,stack:[root],diagnostics:[],scannedChars:0,version:0};
 }
 function definition(st,node){return st.schema.definitions[node.path];}
 function childDefinition(st,parent,tag){
  if(parent.kind==='root')return st.schema.rootOrder.includes(tag)?st.schema.definitions['/'+tag]:null;
  const def=definition(st,parent);tag=canonicalTag(def,tag);
  if(def?.kind==='container')return def.children.some(c=>c.path===parent.path+'/'+tag)?st.schema.definitions[parent.path+'/'+tag]:
    def.replyCountField===tag?{tag,path:parent.path+'/@'+tag,kind:'field'}:null;
  if(def?.kind==='record'&&def.fields.includes(tag))return {tag,path:parent.path+'/@'+tag,kind:'field'};
  return null;
 }
 function matchesClose(st,index,tag){const node=st.stack[index];if(!node||index===0)return false;if(node.kind==='unknown')return node.sourceTag===tag;return childDefinition(st,st.stack[index-1],tag)?.path===node.path;}
 const separators=/^[\s\u200B\u2060:：|¦｜,，;；、*_`]*$/u;
 function structuralText(st,node,start,end){const raw=st.raw.slice(start,end),def=definition(st,node);if(!raw.trim())return true;if(def?.structuralSeparators!==true)return false;if(separators.test(raw))return true;const next=node.children.find(child=>child.rawStart===end&&child.kind==='field');if(!next)return false;const match=raw.match(/^([\s\S]*?)([\p{L}\p{N}_-]+)[\s\u200B\u2060]*[:：][\s\u200B\u2060]*$/u);return !!match&&separators.test(match[1])&&canonicalTag(def,match[2])===next.tag;}
 function addText(st,start,end){
  if(end<=start)return;
  const parent=st.stack.at(-1),last=parent.children.at(-1);
  if(last?.kind==='text'&&last.rawEnd===start)last.rawEnd=end;
  else parent.children.push({kind:'text',rawStart:start,rawEnd:end});
 }
 function append(st,delta){
  st.raw+=String(delta??'');st.version++;
  const raw=st.raw,issue=(code,description,node)=>st.diagnostics.push({code,description,start:node.rawStart,record:node.stableId});
  let pos=st.cursor;
  while(pos<raw.length){
   const start=raw.indexOf('<',pos);
   if(start<0){addText(st,pos,raw.length);pos=raw.length;break;}
   addText(st,pos,start);
   const rest=raw.slice(start),m=/^<(\/)?([\p{L}_][\p{L}\p{N}_-]*)\s*>/u.exec(rest);
   if(!m){
    // Only a still-valid partial tag can wait for another chunk. A literal
    // '<' must never consume the next real '</field>' while looking for '>'.
    if(/^<\/?(?:[\p{L}_][\p{L}\p{N}_-]*\s*)?$/u.test(rest)){pos=start;break;}
    addText(st,start,start+1);pos=start+1;continue;
   }
   const end=start+m[0].length-1;
   const closing=!!m[1],tag=m[2],top=st.stack.at(-1);
   // A terminal mentioned inside prose or a field is content, not a root close.
   if((top.kind==='prose'||top.kind==='field'||top.kind==='record'&&!definition(st,top)?.fields.length)&&!matchesClose(st,st.stack.length-1,tag)&&closing){addText(st,start,end+1);pos=end+1;continue;}
   if(top.kind==='prose'&&!(closing&&matchesClose(st,st.stack.length-1,tag))){addText(st,start,end+1);pos=end+1;continue;}
   if(closing){
    let index=st.stack.length-1;while(index>0&&!matchesClose(st,index,tag))index--;
    if(!index){addText(st,start,end+1);issue('unexpected_close','未配对的结束标签 '+tag,{rawStart:start});}
    else{
     while(st.stack.length-1>index){const node=st.stack.pop();node.rawEnd=start;node.innerEnd=start;issue('missing_close','缺少 </'+node.tag+'>',node);}
     const node=st.stack.pop();node.complete=true;node.innerEnd=start;node.rawEnd=end+1;
    }
   }else{
    let index=st.stack.length-1,def=childDefinition(st,st.stack[index],tag);
    while(!def&&index>0){index--;def=childDefinition(st,st.stack[index],tag);}
    if(!def&&(top.kind==='field'||top.kind==='record'&&!definition(st,top)?.fields.length)){addText(st,start,end+1);pos=end+1;continue;}
    if(def){
     while(st.stack.length-1>index){const node=st.stack.pop();node.rawEnd=start;node.innerEnd=start;issue('missing_close','缺少 </'+node.tag+'>',node);}
    }
    const parent=st.stack.at(-1),node={tag:def?.tag||tag,sourceTag:tag,path:def?.path||parent.path+'/?'+tag,kind:def?.kind||'unknown',rawStart:start,innerStart:end+1,children:[],complete:false,stableId:st.schema.id+':'+start};
    parent.children.push(node);st.stack.push(node);
    if(!def)issue('unknown_tag','未识别或位置不符的标签 '+tag,node);
   }
   pos=end+1;
  }
  st.scannedChars+=pos-st.cursor;st.cursor=pos;
  for(const node of st.stack){node.innerEnd=pos;node.rawEnd=pos;}
  return st;
 }
 function stateFor(raw,schema,owner='read',prefixView=false){
  verify(schema);const key=schemaKeys.get(schema);let owners=sessions.get(key);if(!owners){owners=new Map();sessions.set(key,owners);while(sessions.size>24)sessions.delete(sessions.keys().next().value);}
  let st=owners.get(owner);
  // The UI can paint an older typewriter prefix of the already-parsed SSE
  // state. A read-only prefix view never rewinds the live parser.
  if(prefixView&&st&&st.raw.startsWith(raw))return raw===st.raw?st:{...st,raw};
  if(!st||!raw.startsWith(st.raw)){st=createState(schema);owners.set(owner,st);}
  if(raw!==st.raw)append(st,raw.slice(st.raw.length));
  while(owners.size>16)owners.delete(owners.keys().next().value);
  return st;
 }
 const nodeValue=(st,node)=>decode(st.raw.slice(node.innerStart,node.innerEnd??st.raw.length));
 function report(st,{prefix=false,partial=false}={}){
  const allRoots=st.root.children.filter(n=>n.kind!=='text');
  const firstEnd=allRoots.find(n=>n.tag===st.schema.rootOrder.at(-1)&&n.complete)?.rawEnd??-1;
  const issues=st.diagnostics.filter(x=>firstEnd<0||x.start<firstEnd).map(x=>({...x})),roots=allRoots.filter(n=>firstEnd<0||n.rawStart<firstEnd),records=[],pages=[],containerFields=[],containers=[];
  const add=(code,description,node,extra={})=>issues.push({code,description,start:node?.rawStart||0,record:node?.stableId,...extra});
  const rootTags=roots.map(n=>n.tag);
  if(rootTags.join('|')!==st.schema.rootOrder.join('|'))add('root_order','根栏目需按 '+st.schema.rootOrder.join(' → ')+' 各出现一次',roots[0]);
  function walk(node,pageTag=''){
   if(node.kind==='text')return;
   const def=definition(st,node);
   if(!def){return;}
   const page=(st.schema.pageTags||st.schema.rootOrder).includes(node.tag)?node.tag:pageTag;
   if(!node.complete&&!partial)add('missing_close','缺少 </'+node.tag+'>',node,{page});
   if(def.kind==='prose'&&!nodeValue(st,node).trim())add('missing_prose','剧情正文为空',node,{page});
   if(def.kind==='container'){
    containers.push({id:node.stableId,tag:node.tag,path:node.path,start:node.rawStart,end:node.rawEnd,innerEnd:node.innerEnd,complete:node.complete});
    for(const spec of def.children){
     const count=node.children.filter(c=>c.path===spec.path).length;
     if(count<spec.min)add('missing_record',spec.path.split('/').at(-1)+' 需要至少 '+spec.min+' 条，已收到 '+count,node,{page,path:spec.path});
     if(spec.max!=null&&count>spec.max)add('duplicate_record',spec.path.split('/').at(-1)+' 重复',node,{page,path:spec.path});
    }
    if(def.orderedChildren){const positions=node.children.filter(c=>c.kind!=='text').map(c=>def.children.findIndex(spec=>spec.path===c.path)).filter(n=>n>=0);if(positions.some((n,i)=>i&&n<positions[i-1]))add('page_order','栏目顺序与配套格式不一致',node,{page});}
    if(def.chatMinimum&&node.children.filter(c=>['发言','本人发言','系统'].includes(c.tag)).length<def.chatMinimum)add('missing_record','聊天记录不足 '+def.chatMinimum+' 条',node,{page});
    if(def.replyGroupMinimum&&!node.children.some(c=>['展开回复','折叠回复'].includes(c.tag)))add('missing_record','缺少楼内回复栏目',node,{page});
    if(def.replyCountField){
     const fields=node.children.filter(c=>c.tag===def.replyCountField),count=node.children.filter(c=>c.tag==='回帖').length;
     for(const field of fields.length?fields:[null])containerFields.push({page,path:node.path,tag:node.tag,sourceTag:node.sourceTag,id:node.stableId,start:node.rawStart,end:node.rawEnd,innerEnd:node.innerEnd,complete:node.complete,labels:[def.replyCountField],fields:[{name:def.replyCountField,text:field?nodeValue(st,field):'',start:field?.innerStart,end:field?.innerEnd}],actualCount:count});
     if(fields.length!==1||!/^\d+$/.test(integerValue(nodeValue(st,fields[0]||node)))||Number(integerValue(nodeValue(st,fields[0]||node)))!==count)
      add('reply_count','回复数与实际 '+count+' 条回帖不一致',node,{page,fieldName:def.replyCountField});
    }
   }
   if(def.kind==='record'){
    const row={id:node.stableId,tag:node.tag,sourceTag:node.sourceTag,path:node.path,start:node.rawStart,end:node.rawEnd,innerEnd:node.innerEnd,complete:node.complete,labels:def.fields.length?def.fields:[node.tag],fields:[]};
    if(def.fields.length){
     for(let i=0;i<def.fields.length;i++){
      const name=def.fields[i],fields=node.children.filter(n=>n.kind==='field'&&n.tag===name),field=fields[0],rule=def.fieldRules?.[name]||{};
      row.fields.push({text:field?nodeValue(st,field):'',start:field?.innerStart,end:field?.innerEnd,name});
      if(fields.length>1)add('duplicate_field','字段 '+name+' 重复',node,{page,field:i,fieldName:name});
      if(rule.required&&(!field||!nodeValue(st,field).trim()||/^〈[\s\S]*〉$/.test(nodeValue(st,field).trim())))add('missing_field','缺少 '+name,node,{page,field:i,fieldName:name});
      if(field&&rule.type==='integer'&&!/^\d+$/.test(integerValue(nodeValue(st,field))))add('invalid_field',name+' 需要非负整数',node,{page,field:i,fieldName:name});
      if(field&&rule.type==='percent'&&(!/^\d{1,3}$/.test(percentValue(nodeValue(st,field)))||Number(percentValue(nodeValue(st,field)))>100))add('invalid_field',name+' 需要 0–100 整数',node,{page,field:i,fieldName:name});
     }
    }else{
     const value=nodeValue(st,node);row.fields.push({text:value,start:node.innerStart,end:node.innerEnd,name:node.tag});
     if(!value.trim()||/^〈[\s\S]*〉$/.test(value.trim()))add('missing_field',node.tag+' 未填写',node,{page,field:0,fieldName:node.tag});
    }
    records.push(row);let p=pages.find(p=>p.tag===page);if(!p){p={tag:page,records:[]};pages.push(p);}p.records.push(row);
   }
   for(const child of node.children){if(child.kind==='text'&&(def.kind==='container'||def.kind==='record'&&def.fields.length)&&!structuralText(st,node,child.rawStart,child.rawEnd))add('unassigned_text','命名栏目或字段之外有未归属内容',child,{page,path:node.path});else if(child.kind!=='field')walk(child,page);}
  }
  for(const root of roots)walk(root);
  for(const row of containerFields){const page=pages.find(page=>page.tag===row.page);if(page){if(!page.extraFields)page.extraFields=[];page.extraFields.push(...row.fields.map(field=>({...field,path:row.path,actualCount:row.actualCount})));}}
  const finalRoot=roots.find(n=>n.tag===st.schema.rootOrder.at(-1)),end=finalRoot?.complete?finalRoot.rawEnd:-1;
  const tail=end<0?'':st.raw.slice(end);
  // Non-whitespace between protocol roots has no semantic owner.
  for(const n of st.root.children)if(n.kind==='text'&&st.raw.slice(n.rawStart,n.rawEnd).trim()&&(end<0||n.rawStart<end))add('unassigned_text','栏目之外有未归属内容',n);
  if(end<0&&!partial)add('incomplete','缺少外层结束标签 '+st.schema.terminal,finalRoot);
  if(tail.trim()&&!prefix)add('trailing_text','档案结束之后还有内容',finalRoot);
  const narrativeNode=roots.find(n=>n.kind==='prose'),narrative=narrativeNode?nodeValue(st,narrativeNode).trim():'';
  for(const issue of issues)issue.line=st.raw.slice(0,issue.start||0).split('\n').length;
  const result={ok:end>=0&&issues.length===0,complete:end>=0,end,tail,issues,narrative,pages,records:records.length,recordRows:records,editableRows:[...records,...containerFields],containers,scannedChars:st.scannedChars};
  Object.defineProperty(result,'ast',{value:st});return result;
 }
 function inspect(raw,schema,options={}){return report(stateFor(String(raw??''),schema,options.owner),options);}
 // Serialize text nodes from the immutable static template. Dynamic text is
 // escaped exactly once; the only attribute binding is the validated percent.
 // The result still enters the existing StoryDisplay sanitizer and CSS scope.
 function textTemplate(html,values,percent){
  let pieces=templates.get(html);
  if(!pieces){pieces=html.match(/<[^>]*>|[^<]+|</g)||[];templates.set(html,pieces);while(templates.size>192)templates.delete(templates.keys().next().value);}
  return pieces.map(piece=>{
   if(piece.startsWith('<'))return /\$\d+/.test(piece)?piece.replace(/\sstyle="width:\$1%;--value:\$1%;"/,percent===null?'':' style="width:'+percent+'%;--value:'+percent+'%;"'):piece;
   return piece.replace(/\$(\d+)/g,(_,index)=>esc(values[Number(index)-1]??''));
  }).join('');
 }
 function receivedChildren(st,node){return node.children.filter(child=>child.rawStart<st.raw.length&&(child.innerStart===undefined||child.innerStart<=st.raw.length));}
 function renderNode(st,node){
  if(node.rawStart>=st.raw.length||node.innerStart>st.raw.length)return '';
  const complete=node.complete&&node.rawEnd<=st.raw.length;
  if(node.kind==='text')return st.raw.slice(node.rawStart,node.rawEnd).trim()?esc(st.raw.slice(node.rawStart,node.rawEnd)):'';
  if(node.rendered!==undefined&&complete)return node.rendered;
  const def=definition(st,node),children=receivedChildren(st,node);let html='';
  if(!def)html=esc(st.raw.slice(node.rawStart,node.rawEnd));
  else if(def.kind==='prose')html=st.raw.slice(node.innerStart,node.innerEnd??st.raw.length);
  else if(def.kind==='container'){
   let open=def.openHtml||'';
   if(def.replyCountField)open=open.replace('展开楼内回复','展开楼内回复 · '+children.filter(c=>c.tag==='回帖').length+'条');
   html=open+children.filter(c=>c.kind!=='field'&&(c.kind!=='text'||!structuralText(st,node,c.rawStart,c.rawEnd))).map(c=>renderNode(st,c)).join('')+(def.closeHtml||'');
  }else{
   const seen=children.filter(c=>c.kind==='field'),names=new Set(seen.map(c=>c.tag));
   const variant=def.templates.slice().sort((a,b)=>b.fields.length-a.fields.length).find(t=>t.fields.every(f=>names.has(f)))||def.templates[0];
   const merged=new Set();
   const values=def.fields.length?variant.fields.map(name=>{const first=seen.find(c=>c.tag===name);if(!first)return complete&&def.structuralSeparators&&def.fieldRules?.[name]?.required?'〔缺少：'+name+'〕':'';const fields=[first];merged.add(first);if(def.mergeAdjacentFields?.includes(name)){for(let i=children.indexOf(first)+1;i<children.length;i++){const next=children[i];if(next.kind==='text'&&structuralText(st,node,next.rawStart,next.rawEnd))continue;if(next.kind!=='field'||next.tag!==name)break;fields.push(next);merged.add(next);}}return fields.map(field=>nodeValue(st,field)).join(' / ');}):[nodeValue(st,node)];
   const percentIndex=variant.fields.indexOf('数值');
   const amount=def.fieldRules?.数值?.type==='percent'?percentValue(values[percentIndex]):null;
   if(amount!==null&&/^\d{1,3}$/.test(amount)&&Number(amount)<=100)values[percentIndex]=amount;
   html=textTemplate(variant.html,values,amount!==null&&/^\d{1,3}$/.test(amount)&&Number(amount)<=100?Number(amount):null);
   // Preserve duplicate/unknown input alongside its own record, never put it in a different field.
   if(complete&&def.structuralSeparators)for(const name of def.fields)if(def.fieldRules?.[name]?.required&&!names.has(name)&&!variant.fields.includes(name))html+='<div>〔缺少：'+esc(name)+'〕</div>';
   for(const child of seen)if(!merged.has(child))html+='<div>'+esc(child.tag)+'：'+esc(nodeValue(st,child))+'</div>';
   for(const child of children)if(child.kind==='unknown'||def.fields.length&&child.kind==='text'&&!structuralText(st,node,child.rawStart,child.rawEnd))html+=renderNode(st,child);
  }
  if(complete)node.rendered=html;return html;
 }
 function render(raw,schema,options={}){const st=stateFor(String(raw??''),schema,options.owner,true);return st.root.children.map(n=>renderNode(st,n)).join('');}
 // Stable units carry record identity through to the DOM. Only mutable units
 // serialize again; container closures never invalidate completed records.
 function project(raw,schema,options={}){
  const st=stateFor(String(raw??''),schema,options.owner,true),units=[];
  function visit(node,parent=null){
   if(node.rawStart>=st.raw.length||node.innerStart>st.raw.length||node.kind==='field')return;
   const def=definition(st,node),id=node.stableId||schema.id+':text:'+node.rawStart;
   if(def?.kind==='container'){
    const count=def.replyCountField?receivedChildren(st,node).filter(c=>c.tag==='回帖').length:null;
    let unit=node.projected;
    if(!unit){unit={id,parent,container:true,html:(def.openHtml||'')+'<!--mima-protocol-slot-->'+(def.closeHtml||'')};node.projected=unit;}
    units.push({...unit,count});for(const child of receivedChildren(st,node))if(child.kind!=='text'||!structuralText(st,node,child.rawStart,child.rawEnd))visit(child,id);
   }else{
    let unit=node.projected;
    if(!unit||!unit.complete||node.rawEnd>st.raw.length){const html=renderNode(st,node);unit={id,parent,html,complete:!!node.complete&&node.rawEnd<=st.raw.length};if(unit.complete)node.projected=unit;}
    if(unit.html)units.push(unit);
   }
  }
  for(const node of st.root.children)visit(node);
  return {key:schemaKeys.get(schema),units,scannedChars:st.scannedChars};
 }
 function category(path){
  if(/假设/.test(path))return '假设';if(/弹幕/.test(path))return '场外评论';if(/待完成|目标|购物车/.test(path))return '计划或待实施';
  if(/心事|瞬时心声|采访/.test(path))return '角色主观';if(/社交|搜索/.test(path))return '档案记录或转述';return '当时的记录';
 }
 function readable(raw,schema,options={}){
  const result=inspect(raw,schema,options);
  if(options.narrativeOnly){const body=stateFor(String(raw),schema,options.owner).root.children.find(n=>n.kind==='prose');return {...result,text:body?.complete?result.narrative:'',...(!body?.complete||!result.ok?{narrativeWarning:body?.complete?'格式不完整，仅导出已确认正文':'正文边界无法确认，本条已跳过'}:{})};}
  const text=['【正文】\n'+result.narrative];
  for(const page of result.pages)text.push('【'+page.tag+'】\n'+page.records.map(row=>'['+category(row.path)+'] '+row.tag+'：'+row.fields.map((f,i)=>'['+category(row.path+'/'+(f.name||row.labels[i]||''))+'] '+(row.labels[i]||f.name)+'：'+f.text).join(' ｜ ')).join('\n'));
  for(const page of result.pages)for(const field of page.extraFields||[])text.push('['+category(field.path)+'] '+field.path+' / '+field.name+'：'+field.text+'（实际 '+field.actualCount+' 条回帖）');
  if(!result.ok)text.push('【保留原文 · 格式待核实】\n'+String(raw));
  return {...result,text:text.join('\n\n')};
 }
 function replaceField(raw,schema,{nodeStart,fieldName,value}){
  const result=inspect(raw,schema),row=result.editableRows.find(r=>r.start===Number(nodeStart));
  if(!row)throw fault('无法定位这条语义记录');
  const field=row.fields.find(f=>f.name===fieldName),replacement=String(value??'');
  if(!field)throw fault('无法定位命名字段');
  if(Number.isInteger(field.start))return raw.slice(0,field.start)+esc(replacement)+raw.slice(field.end);
  const end=row.innerEnd;
  if(!row.complete||!Number.isInteger(end))throw fault('请先用原文编辑补齐该记录的结束标签');
  return raw.slice(0,end)+'<'+fieldName+'>'+esc(replacement)+'</'+fieldName+'>'+raw.slice(end);
 }
 function addRecord(raw,schema,{parentStart,recordPath,values={}}){
  const result=inspect(raw,schema),parent=result.containers.find(row=>row.start===Number(parentStart)),def=schema.definitions[recordPath];
  if(!parent?.complete||!def||def.kind!=='record'||!schema.definitions[parent.path].children.some(spec=>spec.path===recordPath))throw fault('请选择已完整闭合的栏目与记录类型');
  const fields=def.fields.length?def.fields:[def.tag];
  for(const field of fields)if((!def.fields.length||def.fieldRules?.[field]?.required)&&!String(values[field]??'').trim())throw fault('请填写 '+field+' 的实际内容');
  const body=def.fields.length?def.fields.filter(field=>String(values[field]??'').length).map(field=>'<'+field+'>'+esc(values[field])+'</'+field+'>').join(''):esc(values[def.tag]);
  const fragment='<'+def.tag+'>'+body+'</'+def.tag+'>',end=parent.innerEnd;
  return raw.slice(0,end)+fragment+'\n'+raw.slice(end);
 }
 function createBundle({name,id,presetId,proseTag,terminalTag,sample,extraInstructions=''}){
  name=String(name||'').trim();sample=String(sample||'').trim();proseTag=String(proseTag||'').trim();terminalTag=String(terminalTag||'').trim();
  if(!name||!tagName.test(proseTag)||!tagName.test(terminalTag)||!sample)throw fault('请填写名称、正文标签、结尾标签和完整格式样例');
  if(/<!DOCTYPE|<!ENTITY|<\?/i.test(sample))throw fault('格式样例只支持普通命名标签，不支持 XML 声明或实体定义');
  const parsed=new DOMParser().parseFromString('<mima-root>'+sample+'</mima-root>','application/xml');
  if(parsed.querySelector('parsererror'))throw fault('样例的开闭标签必须配对；字段里的 &、<、> 请转义');
  const nodes=[...parsed.documentElement.children],rootOrder=nodes.map(el=>el.tagName),defs=Object.create(null);
  if(rootOrder.length<2||new Set(rootOrder).size!==rootOrder.length||!rootOrder.includes(proseTag)||rootOrder.at(-1)!==terminalTag||terminalTag===proseTag)throw fault('正文标签须独立出现一次；最后一个根标签必须与结尾标签相同');
  const tagLabel=tag=>esc(tag);
  function build(group,parent='',isRoot=false){
   const tag=group[0].tagName,path=parent+'/'+tag;
   if(!tagName.test(tag)||group.some(el=>el.attributes.length))throw fault('标签只能使用文字、数字、下划线或连字符，不支持属性：'+tag);
   if(isRoot&&tag===proseTag){defs[path]={path,tag,kind:'prose'};return;}
   const children=group.flatMap(el=>[...el.children]);
   const nested=children.some(el=>el.children.length);
   const repeated=group.some(el=>new Set([...el.children].map(c=>c.tagName)).size!==el.children.length);
   if(group.some(el=>[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&el.children.length))throw fault('有子标签的栏目不能混入无标签文字：'+tag);
   if(nested||repeated){
    const byTag=new Map();for(const child of children){if(!byTag.has(child.tagName))byTag.set(child.tagName,[]);byTag.get(child.tagName).push(child);}
    const spec=[...byTag].map(([key,items])=>{const counts=group.map(el=>[...el.children].filter(c=>c.tagName===key).length);build(items,path);return {path:path+'/'+key,min:Math.min(...counts),max:null};});
    defs[path]={path,tag,kind:'container',children:spec,openHtml:'<div class="mima-custom-protocol"><details open><summary>'+tagLabel(tag)+'</summary><div>',closeHtml:'</div></details></div>'};
   }else{
    const fields=[...new Set(children.map(el=>el.tagName))];
    if(children.some(el=>!tagName.test(el.tagName)||el.attributes.length))throw fault('字段标签无效：'+tag);
    const fieldRules=Object.fromEntries(fields.map(field=>[field,{required:group.every(el=>[...el.children].some(c=>c.tagName===field))}]));
    const body=fields.length?fields.map((field,i)=>'<div><strong>'+tagLabel(field)+'：</strong>$'+(i+1)+'</div>').join(''):'<div>$1</div>';
    defs[path]={path,tag,kind:'record',fields,fieldRules,templates:[{fields,html:'<div class="mima-custom-protocol-record"><strong>'+tagLabel(tag)+'</strong>'+body+'</div>'}]};
   }
  }
  for(const el of nodes)build([el],'',true);
  const schema={kind:'semantic',version:1,id,rootOrder,terminal:'</'+terminalTag+'>',definitions:defs,pageTags:rootOrder.filter(tag=>tag!==proseTag)};
  const protocolResource={format:'mima-semantic-protocol',schemaVersion:1,schema,sample,presetId};
  verify(schema);const report=inspect(sample,schema);if(!report.ok)throw fault('格式样例：'+report.issues[0]?.description);
  const content='按以下命名标签格式输出。标签名称和开闭顺序保持一致，所有示例值替换为当轮真实内容。正文写在 <'+proseTag+'> 与 </'+proseTag+'> 之间。最后以 '+schema.terminal+' 结束，之后不添加内容。字段内字面的 &、<、> 使用实体转义。\n'+(extraInstructions?extraInstructions+'\n':'')+sample;
  return {format:'mimamao-semantic-protocol-bundle',version:1,data:{regexPack:{id,name,description:'自定义语义标签',priority:50,enabled:true,rules:[],displayStyles:[],protocolResource},preset:{id:presetId,name:name+' · 输出格式',type:'format',priority:50,enabled:true,content}}};
 }
 async function preflight(resource){
  if(resource?.format!=='mima-semantic-protocol'||resource.schemaVersion!==1)throw fault('不支持的语义协议资源版本');
  const schema=verify(resource.schema),contexts=verifyTemplates(schema),sample=inspect(resource.sample,schema);
  if(!sample.ok)throw fault('语义协议样例未通过：'+sample.issues[0]?.description);
  const html=render(resource.sample,schema),resources=[];
  for(const row of [...contexts,{path:'完整样例',html}]){const safe=MimaStoryDisplay.inspectionHtml(row.html,'semantic_preflight',{resources});const fatal=safe.diagnostics.filter(d=>['element','resource'].includes(d.kind));if(fatal.length)throw fault(row.path+' 呈现结构未通过：'+fatal[0].reason);}
  return resource;
 }
 window.MimaStoryProtocol={createBundle,verify,verifyTemplates,templateContexts,createState,append,accumulate:(raw,schema,owner)=>stateFor(String(raw??''),schema,owner),parse:(raw,schema,options={})=>inspect(raw,schema,options),inspect,render,project,readable,replaceField,addRecord,preflight,decode};
})();
