/* R11.6 limited declarative MVU adapter. No evaluation of card or model JS. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatMVU=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const err=(code,msg)=>Object.assign(new Error(msg),{code});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const clone=v=>JSON.parse(JSON.stringify(v));
function checked(v){if(!plain(v)||JSON.stringify(v).length>64000)throw err('E_MVU_INIT_INVALID','MVU 初始变量应为不超过 64KB 的 JSON 对象');const visit=(x,d)=>{if(d>12)throw err('E_MVU_INIT_INVALID','MVU 变量嵌套过深');if(Array.isArray(x)){if(x.length>1000)throw err('E_MVU_INIT_INVALID','变量数组过长');x.forEach(v=>visit(v,d+1));}else if(plain(x)){for(const [k,v]of Object.entries(x)){if(forbidden(k))throw err('E_MVU_INIT_INVALID','变量名含有不安全或只读字段');visit(v,d+1);}}else if(x!==null&&!['string','number','boolean'].includes(typeof x)||typeof x==='number'&&!Number.isFinite(x))throw err('E_MVU_INIT_INVALID','变量包含不支持的类型或无穷数');};visit(v,0);return clone(v);}
function forbidden(k){return !k||k==='__proto__'||k==='constructor'||k==='prototype'||k.startsWith('_')||k.length>128;}
// A deliberately bounded, non-executable InitVar YAML subset. The reader
// recognizes indentation-based mappings/sequences and JSON-compatible flow
// values only. Unsupported YAML features are errors, never guessed values.
function initYaml(input){
 const text=String(input||'').replace(/^\uFEFF/,'').trim();
 if(text.length>64000)throw err('MVU_INITVAR_YAML_INVALID','InitVar YAML 超过 64KB');
 const lines=[];
 function withoutComment(src){let quote='',escape=false;
  for(let i=0;i<src.length;i++){
   const c=src[i];if(quote){if(escape)escape=false;else if(c==='\\'&&quote==='"')escape=true;else if(c===quote){if(quote==="'"&&src[i+1]==="'")i++;else quote='';}continue;}
   if(c==='"'||c==="'"){quote=c;continue;}
   if(c==='#'&&(i===0||/\s/.test(src[i-1])))return src.slice(0,i).trimEnd();
  }
  if(quote)throw err('MVU_INITVAR_YAML_INVALID','YAML 引号未闭合');return src.trimEnd();
 }
 for(const raw of text.split(/\r?\n/)){
  if(!raw.trim()||/^\s*#/.test(raw))continue;
  if(/^\s*---\s*$/.test(raw)&&lines.length===0)continue;
  if(/^\s*(?:---|\.\.\.)\s*$/.test(raw)||raw.includes('\t'))throw err('MVU_INITVAR_YAML_UNSUPPORTED','不支持多文档或 Tab 缩进 YAML');
  const indent=raw.match(/^ */)[0].length,body=withoutComment(raw.slice(indent));
  if(body)lines.push({indent,body});
 }
 if(!lines.length||lines[0].indent!==0)throw err('MVU_INITVAR_YAML_INVALID','InitVar YAML 应从顶层开始');
 if(lines.length>2000)throw err('MVU_INITVAR_YAML_INVALID','InitVar YAML 行数超限');
 function scalar(src){const v=src.trim();
  if(!v||v==='|'||v==='>'||v==='|-'||v==='>-')throw err('MVU_INITVAR_YAML_UNSUPPORTED','不支持 YAML 空值块或多行标量');
  if(/^(?:!|&|\*|<<\s*:|%|\{\{)/.test(v))throw err('MVU_INITVAR_YAML_UNSUPPORTED','不支持 YAML 标签、引用或脚本表达式');
  if(v==='{}')return {};if(v==='[]')return [];
  if(v[0]==='"'){try{const q=JSON.parse(v);if(typeof q!=='string')throw Error('not string');return q;}catch(e){throw err('MVU_INITVAR_YAML_INVALID','YAML 双引号需要合法 JSON 转义');}}
  if(v[0]==="'"){if(!/^'(?:[^']|'')*'$/.test(v))throw err('MVU_INITVAR_YAML_INVALID','YAML 单引号不完整');return v.slice(1,-1).replace(/''/g,"'");}
  if(v[0]==='['||v[0]==='{'){
   try{return JSON.parse(v);}catch(e){
    if(v[0]!=='['||!v.endsWith(']'))throw err('MVU_INITVAR_YAML_UNSUPPORTED','内联对象必须使用 JSON；复杂 YAML 流语法暂不支持');
    const content=v.slice(1,-1);if(!content.trim())return [];
    const parts=[];let quote='',escape=false,depth=0,start=0;
    for(let i=0;i<content.length;i++){const c=content[i];if(quote){if(escape)escape=false;else if(c==='\\'&&quote==='"')escape=true;else if(c===quote){if(quote==="'"&&content[i+1]==="'")i++;else quote='';}continue;}
     if(c==='"'||c==="'"){quote=c;continue;}
     if(c==='['||c==='{')depth++;if(c===']'||c==='}')depth--;
     if(depth<0)throw err('MVU_INITVAR_YAML_INVALID','YAML 数组括号不匹配');
     if(c===','&&depth===0){parts.push(content.slice(start,i));start=i+1;}
    }
    if(quote||depth!==0)throw err('MVU_INITVAR_YAML_INVALID','YAML 数组语法不完整');parts.push(content.slice(start));
    return parts.map(part=>scalar(part));
   }
  }
  if(/^(?:null|~)$/i.test(v))return null;
  if(/^(?:true|false)$/i.test(v))return v.toLowerCase()==='true';
  if(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)){const n=Number(v);if(!Number.isFinite(n))throw err('MVU_INITVAR_YAML_INVALID','非法数字');return n;}
  if(/^(?:\.|\+|\?|\-\s|>|\||!!|\[|\{|@|`)/.test(v))throw err('MVU_INITVAR_YAML_UNSUPPORTED','无法可靠解释的 YAML 标量');
  return v;
 }
 function keyValue(src){let quote='',escape=false;
  for(let i=0;i<src.length;i++){const c=src[i];if(quote){if(escape)escape=false;else if(c==='\\'&&quote==='"')escape=true;else if(c===quote){if(quote==="'"&&src[i+1]==="'")i++;else quote='';}continue;}
   if(c==='"'||c==="'"){quote=c;continue;}
   if(c===':'&&(i===src.length-1||/\s/.test(src[i+1]))){const raw=src.slice(0,i).trim();if(!raw)break;return{key:scalar(raw),value:src.slice(i+1).trim()};}
  }
  throw err('MVU_INITVAR_YAML_INVALID','YAML 对象行缺少冒号分隔');
 }
 let index=0;
 function block(indent,level){
  if(level>12)throw err('MVU_INITVAR_YAML_INVALID','YAML 嵌套层数超限');
  if(index>=lines.length||lines[index].indent!==indent)throw err('MVU_INITVAR_YAML_INVALID','YAML 缩进不一致');
  const seq=lines[index].body==='-'||lines[index].body.startsWith('- '),out=seq?[]:{};
  while(index<lines.length){const item=lines[index];if(item.indent<indent)break;
   if(item.indent!==indent)throw err('MVU_INITVAR_YAML_INVALID','YAML 同层缩进不一致');
   const itemIsSeq=item.body==='-'||item.body.startsWith('- ');
   if(itemIsSeq!==seq)throw err('MVU_INITVAR_YAML_INVALID','YAML 同一层不能混用数组与映射');
   let val,key;
   if(seq)val=item.body.slice(1).trim();
   else{const kv=keyValue(item.body);key=kv.key;val=kv.value;
    if(typeof key!=='string'||forbidden(key)||Object.hasOwn(out,key))throw err('MVU_INITVAR_YAML_INVALID','YAML 变量名重复或不安全');}
   index++;
   const nested=index<lines.length&&lines[index].indent>indent;
   if(val){if(nested)throw err('MVU_INITVAR_YAML_INVALID','YAML 标量下面不能继续缩进');const parsed=scalar(val);if(seq)out.push(parsed);else out[key]=parsed;}
   else{const parsed=nested?block(lines[index].indent,level+1):null;if(seq)out.push(parsed);else out[key]=parsed;}
  }
  return out;
 }
 const result=block(0,0);if(index!==lines.length)throw err('MVU_INITVAR_YAML_INVALID','YAML 仍有未解析内容');return checked(result);
}
function initial(resources,{greetingIndex=0}={}){let source=null,conflict=false,gaps=[],sources=[];
 function accept(value,resourceId,provenance={}){try{const v=checked(value);if(source!==null&&JSON.stringify(source)!==JSON.stringify(v)){
    conflict=true;gaps.push({reason:'MVU_MULTIPLE_INITIAL_SOURCES_CONFLICT',resourceId});return;
   }if(source===null)source=v;sources.push({resourceId,...provenance});
  }catch(e){gaps.push({reason:e.code||'E_MVU_INIT_INVALID',resourceId});}}
 for(const r of resources||[]){if(r.kind!=='variable_schema')continue;const value=r.raw;let candidate;
  if(plain(value))candidate=value.stat_data??value.initial_variables??value.initial??value.variables??(r.name.toLowerCase()==='variables'?value:null);
  else if(typeof value==='string'&&value.trim().startsWith('{')){try{candidate=JSON.parse(value);}catch(e){gaps.push({reason:'MVU_INIT_JSON_INVALID',resourceId:r.id});continue;}}
  if(candidate===undefined||candidate===null){gaps.push({reason:'MVU_INIT_FORMAT_UNSUPPORTED',resourceId:r.id});continue;}
  accept(candidate,r.id,{path:r.path||'variable_schema',reason:'declared_initial_variables'});
 }
 // Non-executable InitVar JSON and bounded mapping/sequence YAML only.
 // Full YAML, Zod schemas and arbitrary JavaScript are intentionally unsupported.
 for(const r of resources||[])if(r.kind==='world_info'){
  const entries=r.raw?.entries,items=Array.isArray(entries)?entries:entries&&typeof entries==='object'?Object.values(entries):[];
  for(const [entryIndex,entry] of items.entries()){if(!/\[?initvar\]?/i.test(String(entry.comment||entry.name||'')))continue;
   const content=String(entry.content||'').replace(/^\s*<initvar>\s*/i,'').replace(/\s*<\/initvar>\s*$/i,'').replace(/^\s*```(?:json|yaml|yml)?\s*\r?\n/i,'').replace(/\s*```\s*$/,'').trim();
   try{const parsed=content.startsWith('{')?JSON.parse(content):initYaml(content);accept(parsed.stat_data??parsed,r.id,{entryId:entry.uid??entry.id??Object.keys(entries)[entryIndex],path:(r.path||'world_info')+'.entries['+(entry.uid??entry.id??Object.keys(entries)[entryIndex])+']',reason:'InitVar_data_even_when_lore_disabled'});}catch(e){gaps.push({reason:e.code||'MVU_INITVAR_JSON_INVALID',resourceId:r.id});}
  }
 }
 // For cards that explicitly declare a complete opening-specific InitVar,
 // the selected greeting is an intentional alternate start, not a conflicting
 // worldbook source. Incomplete/malformed overrides fail closed.
 const card=(resources||[]).find(r=>r.kind==='character')?.raw;
 const index=Number(greetingIndex);
 if(card&&Number.isSafeInteger(index)&&index>=0){
  const variants=Array.isArray(card.alternate_greetings)?card.alternate_greetings:[];
  const opening=String(index===0?card.first_mes||'':variants[index-1]||'');
  const blocks=[...opening.matchAll(/<initvar>([\s\S]*?)<\/initvar>/gi)];
  if(/<initvar\b/i.test(opening)&&blocks.length!==1){conflict=true;gaps.push({reason:'MVU_GREETING_INIT_INVALID',resourceId:'character.greeting['+index+']'});}
  else if(blocks.length===1){
   try{
    const body=blocks[0][1].trim().replace(/^```(?:json|yaml|yml)?\s*\r?\n/i,'').replace(/\s*```\s*$/,'').trim();
    const parsed=body.startsWith('{')?JSON.parse(body):initYaml(body);
    const next=checked(parsed.stat_data??parsed);
    if(!conflict){source=next;sources=[{resourceId:(resources||[]).find(r=>r.kind==='character')?.id,path:'character.greeting['+index+']',reason:'selected_greeting_override'}];}
   }catch(e){conflict=true;gaps.push({reason:e.code||'MVU_GREETING_INIT_INVALID',resourceId:'character.greeting['+index+']'});}
  }
 }
 // A conflicting initializer cannot be silently resolved by source order.
 return{state:conflict?null:source,gaps,sources};
}
function extract(reply){const str=String(reply||'');const matches=[...str.matchAll(/<UpdateVariable(?:\s[^>]*)?>([\s\S]*?)<\/UpdateVariable>/gi)];
 if(!matches.length){if(/<UpdateVariable\b/i.test(str))throw err('E_MVU_PATCH_INVALID','MVU 变量更新块缺少结束标签');return null;}
 if(matches.length!==1||matches[0][0].length>64000)throw err('E_MVU_PATCH_INVALID','本回合只允许一个 64KB 以内的 MVU 更新块');
 const body=matches[0][1],json=[...body.matchAll(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi)];
 if(json.length===0)return parseLiteralSets(body);
 if(json.length!==1)throw err('E_MVU_FORMAT_UNSUPPORTED','MVU JSONPatch 必须只有一个');
 const leftover=body.replace(json[0][0],'').replace(/<Analysis>[\s\S]*?<\/Analysis>/gi,'').trim();
 if(leftover)throw err('E_MVU_FORMAT_UNSUPPORTED','MVU 更新块含未验证指令，拒绝执行');
 let ops;try{ops=JSON.parse(json[0][1]);}catch(e){throw err('E_MVU_PATCH_INVALID','MVU JSONPatch 不是合法 JSON');}
 if(!Array.isArray(ops)||ops.length>100)throw err('E_MVU_PATCH_INVALID','MVU 更新操作数无效或超过 100 条');
 return ops;
}
// Narrow MVU-Innovation legacy syntax: parse literal _.set('path', old, new)
// without eval/Function or access to the surrounding JavaScript runtime.
function literal(s){s=s.trim();if(s.startsWith("'")){if(!/^'(?:\\.|[^'\\])*'$/.test(s))throw err('E_MVU_FORMAT_UNSUPPORTED','不支持的单引号变量值');return s.slice(1,-1).replace(/\\(['\\])/g,'$1').replace(/\\n/g,'\n');}
 try{const x=JSON.parse(s);if(x===undefined)return undefined;return x;}catch(e){throw err('E_MVU_FORMAT_UNSUPPORTED','MVU 旧式更新只能使用静态 JSON 字面值');}}
function splitArgs(src){const out=[];let quote='',escape=false,depth=0,start=0;
 for(let i=0;i<src.length;i++){const c=src[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='['||c==='{'){depth++;continue;}if(c===']'||c==='}'){depth--;if(depth<0)throw err('E_MVU_FORMAT_UNSUPPORTED','MVU 字面量括号不匹配');continue;}
  if(c===','&&depth===0){out.push(src.slice(start,i));start=i+1;}
 }
 if(quote||depth!==0)throw err('E_MVU_FORMAT_UNSUPPORTED','MVU 变量更新括号不匹配');out.push(src.slice(start));return out;
}
function parseLiteralSets(body){const clean=body.replace(/<Analysis>[\s\S]*?<\/Analysis>/gi,'').trim();if(!clean)throw err('E_MVU_PATCH_INVALID','MVU 更新块没有有效操作');const ops=[];
 for(const line of clean.split(/\r?\n/).filter(x=>x.trim())){
  const match=/^\s*_\.set\s*\((.*)\)\s*;?\s*(?:\/\/[^\r\n]*)?$/.exec(line);
  if(!match)throw err('E_MVU_FORMAT_UNSUPPORTED','MVU 旧式块含非 _.set 静态指令，拒绝执行');
  const args=splitArgs(match[1]);if(args.length!==3)throw err('E_MVU_FORMAT_UNSUPPORTED','_.set 需要路径、旧值、新值三个参数');
  const path=literal(args[0]);if(typeof path!=='string'||!path||path.includes('/')||path.length>512)throw err('E_MVU_PATCH_INVALID','_.set 路径无效');
  const segments=path.split('.');if(segments.some(forbidden))throw err('E_MVU_PATCH_INVALID','_.set 路径包含只读或不安全字段');
  ops.push({op:'compare_replace',path:'/'+segments.map(x=>x.replace(/~/g,'~0').replace(/\//g,'~1')).join('/'),old:literal(args[1]),value:literal(args[2])});
 }
 if(ops.length>100)throw err('E_MVU_PATCH_INVALID','MVU 操作条数超限');return ops;
}
function tokens(path){if(typeof path!=='string'||!path.startsWith('/')||path.length>512)throw err('E_MVU_PATCH_INVALID','变量路径必须为 JSON Pointer');const raw=path.slice(1).split('/');if(raw.some(x=>/~(?![01])/.test(x)))throw err('E_MVU_PATCH_INVALID','JSON Pointer 转义无效');const xs=raw.map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));if(xs.length>12||xs.some(forbidden))throw err('E_MVU_PATCH_INVALID','变量路径包含不安全字段');return xs;}
function locate(state,path){const xs=tokens(path),last=xs.pop();let parent=state;
 for(const k of xs){if(!plain(parent)&&!Array.isArray(parent))throw err('E_MVU_PATCH_INVALID','变量路径的父节点不是对象');if(!(k in parent))throw err('E_MVU_PATCH_INVALID','变量路径不存在');parent=parent[k];}
 if(!plain(parent)&&!Array.isArray(parent))throw err('E_MVU_PATCH_INVALID','变量路径父节点无效');
 const key=Array.isArray(parent)?(last==='-'?'-':/^(0|[1-9]\d*)$/.test(last)?Number(last):NaN):last;
 if(Array.isArray(parent)&&key!=='-'&&(!Number.isInteger(key)||key>parent.length))throw err('E_MVU_PATCH_INVALID','数组下标无效');
 return{parent,key,exists:Object.hasOwn(parent,key)};
}
function patch(current,ops){const state=checked(current);if(!Array.isArray(ops))return state;
 for(const op of ops){if(!plain(op)||!['replace','delta','insert','remove','compare_replace'].includes(op.op))throw err('E_MVU_FORMAT_UNSUPPORTED','不支持的 MVU JSONPatch 操作');
  const {parent,key,exists}=locate(state,op.path);
  if(op.op==='compare_replace'){const nextValue=checked({value:op.value}).value;checked({value:op.old});if(!exists)throw err('E_MVU_PATCH_INVALID','_.set 的目标变量不存在');const current=parent[key],old=Array.isArray(current)&&current.length===2?current[0]:current;
   if(JSON.stringify(old)!==JSON.stringify(op.old))throw err('E_MVU_PATCH_INVALID','_.set 的旧值与已提交剧情状态不一致');
   if(old!==null&&op.value!==null&&typeof old!==typeof nextValue)throw err('E_MVU_PATCH_INVALID','_.set 不允许改变变量类型');
   if(Array.isArray(current)&&current.length===2)parent[key]=[nextValue,current[1]];else parent[key]=nextValue;checked(state);continue;}
  if(op.op==='remove'){if(!exists)throw err('E_MVU_PATCH_INVALID','不能删除不存在的变量');if(Array.isArray(parent))parent.splice(key,1);else delete parent[key];continue;}
  if(op.op==='delta'){if(!exists||typeof parent[key]!=='number'||!Number.isFinite(op.value))throw err('E_MVU_PATCH_INVALID','delta 只能修改存在的数字变量');const next=parent[key]+op.value;if(!Number.isFinite(next))throw err('E_MVU_PATCH_INVALID','变量数值溢出');parent[key]=next;continue;}
  if(!Object.hasOwn(op,'value')||op.value===undefined)throw err('E_MVU_PATCH_INVALID','缺少变量新值');
  const nextValue=checked({value:op.value}).value;
  // Recheck structural limits after each operation; never leak a partial state.
  if(op.op==='replace'){if(!exists)throw err('E_MVU_PATCH_INVALID','不能替换不存在的变量');if(parent[key]!==null&&op.value!==null&&(typeof parent[key]!==typeof nextValue||Array.isArray(parent[key])!==Array.isArray(nextValue)))throw err('E_MVU_PATCH_INVALID','变量类型变更需原生 MVU 插件确认');parent[key]=nextValue;}
  else if(op.op==='insert'){if(Array.isArray(parent)){if(key==='-')parent.push(nextValue);else parent.splice(key,0,nextValue);}else{if(exists)throw err('E_MVU_PATCH_INVALID','不能插入已存在的变量');parent[key]=nextValue;}}
  checked(state);
 }
 return checked(state);
}
// An assistant continuation is a separate, settled generation that happens to
// share the last assistant message's displayed content. Only a canonical
// transaction may add these exact, ordered offsets. Ordinary replies still
// permit ONE UpdateVariable block, never an arbitrary collection of blocks.
function replayParts(message){
 const content=String(message.canonicalContent??'');
 const segments=message.mvuContinuationSegments;
 if(segments===undefined)return[content];
 if(message.opening||!Array.isArray(segments)||segments.length<1||segments.length>100)
  throw err('E_MVU_HISTORY_CONFLICT','MVU 续写边界损坏，拒绝读取不可信状态');
 const parts=[];let cursor=0;const seen=new Set();
 for(const seg of segments){
  const offset=seg?.offset,id=seg?.continuationId;
  if(!Number.isSafeInteger(offset)||offset<2||offset>=content.length||offset<=cursor+1||
      content[offset-1]!=='\n'||typeof id!=='string'||!/^cont_[a-zA-Z0-9_-]+$/.test(id)||seen.has(id))
   throw err('E_MVU_HISTORY_CONFLICT','MVU 续写位置、分隔符或事务标识不合法');
  const part=content.slice(cursor,offset-1);
  if(!part.trim())throw err('E_MVU_HISTORY_CONFLICT','MVU 续写原段缺失');
  parts.push(part);seen.add(id);cursor=offset;
 }
 const tail=content.slice(cursor);
 if(!tail.trim())throw err('E_MVU_HISTORY_CONFLICT','MVU 续写尾段缺失');
 parts.push(tail);
 return parts;
}
function replay(initialState,messages){if(initialState===null)return{active:false,state:null};let state=checked(initialState);
 for(const m of [...messages].filter(x=>x.role==='assistant'&&x.status==='committed').sort((a,b)=>a.sequence-b.sequence)){
  for(const part of replayParts(m)){
   let ops=extract(part);
   // Only a genuine opening greeting may use a placeholder old-value.
   if(ops&&m.opening)ops=ops.map(op=>{
    if(op.op!=='compare_replace')return op;
    const {parent,key,exists}=locate(state,op.path);
    if(!exists)throw err('E_MVU_PATCH_INVALID','开场白引用不存在的初始变量');
    const value=parent[key];return{...op,old:Array.isArray(value)&&value.length===2?value[0]:value};
   });
   if(ops)state=patch(state,ops);
  }
  if(m.mvuStateAfter!==undefined&&JSON.stringify(state)!==JSON.stringify(m.mvuStateAfter))throw err('E_MVU_HISTORY_CONFLICT','已存 MVU 状态与原始剧情重放不一致，禁止继续生成');
 }
 return{active:true,state};
}
function forReply(initialState,messages,reply){const before=replay(initialState,messages);const ops=extract(reply);
 if(ops&& !before.active)throw err('E_MVU_INIT_MISSING','卡片没有可验证的 MVU 初始变量，拒绝执行模型更新');
 return{active:before.active,operations:ops,state:before.active?patch(before.state,ops):null};
}
// Read-only status rows from verified committed MVU state. Pure projection:
// no dynamic HTML, templates, JavaScript, network or separate persistence.
function statusRows(state,{limit=40}={}){
 if(state===null)return[];const safe=checked(state),rows=[];const cap=Math.max(1,Math.min(100,Number(limit)||40));
 function walk(value,path,depth){if(rows.length>=cap)return;
  if(Array.isArray(value)&&value.length===2&&typeof value[1]==='string')value=value[0]; // common MVU [value, note]
  if(plain(value)&&depth<8){for(const [k,v] of Object.entries(value)){if(rows.length>=cap)break;walk(v,path?[...path,k]:[k],depth+1);}return;}
  let v;if(Array.isArray(value))v='数组（'+value.length+' 项）';else if(plain(value))v='对象（'+Object.keys(value).length+' 项）';else v=value===null?'未设置':String(value);
  rows.push({path:path.join(' · '),value:v.length>200?v.slice(0,200)+'…':v});
 }
 walk(safe,[],0);return rows;
}
function display(content){return String(content||'').replace(/<UpdateVariable(?:\s[^>]*)?>[\s\S]*?<\/UpdateVariable>/gi,'').trimEnd();}
return Object.freeze({initial,initYaml,extract,patch,replay,forReply,display,statusRows});
});
