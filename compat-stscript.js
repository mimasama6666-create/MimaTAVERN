/* Manual-only, bounded STscript subset. No eval, provider calls, or implicit hooks.
 * A script either commits its complete variables snapshot with CAS or changes nothing.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatSTscript=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';
const err=(code,text)=>Object.assign(new Error(text),{code});
const supported=Object.freeze(['pass','echo','return','abort','getvar','setvar','addvar','incvar','decvar','flushvar','len']);
const modifying=new Set(['setvar','addvar','incvar','decvar','flushvar']);
const active=new Set();
const keyOk=k=>typeof k==='string'&&/^[\p{L}\p{N}_-]{1,64}$/u.test(k)&&!['__proto__','constructor','prototype'].includes(k);
const encode=v=>typeof v==='string'?v:v==null?'':JSON.stringify(v);
const safeClone=v=>JSON.parse(JSON.stringify(v));
function split(source){
 const src=String(source??'');if(!src.trim()||src.length>16384)throw err('E_STSCRIPT_BUDGET','脚本必须为 1～16384 字符');
 let chunks=[],part='',quote='',esc=false;
 for(let i=0;i<src.length;i++){
  const c=src[i];if(esc){part+=c;esc=false;continue;}
  if(c==='\\'){if(i+1<src.length&&['|','\\','"',"'"].includes(src[i+1])){esc=true;continue;}part+='\\';continue;}
  if(quote){part+=c;if(c===quote)quote='';continue;}
  if(c==='"'||c==="'"){quote=c;part+=c;continue;}
  if(c==='|'){if(!part.trim())throw err('E_STSCRIPT_SYNTAX','管道中包含空命令');chunks.push(part.trim());part='';continue;}
  part+=c;
 }
 if(quote||esc)throw err('E_STSCRIPT_SYNTAX','引号或转义未结束');if(part.trim())chunks.push(part.trim());
 if(chunks.length>64)throw err('E_STSCRIPT_BUDGET','最多执行 64 个管道命令');
 if(!chunks.length)throw err('E_STSCRIPT_SYNTAX','没有有效命令');
 return chunks;
}
function compile(src){return split(src).map((chunk,i)=>{
 const match=/^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(chunk);
 if(!match)throw err('E_STSCRIPT_UNSUPPORTED','第 '+(i+1)+' 段不是支持的 /命令：'+chunk.slice(0,80));
 const cmd=match[1].toLowerCase();if(!supported.includes(cmd))throw err('E_STSCRIPT_UNSUPPORTED','不支持 /'+cmd+'；不会调用模型或跳过该命令');
 let rest=(match[2]||'').trim(),key='';
 if(['getvar','setvar','addvar','incvar','decvar','flushvar'].includes(cmd)){
  const named=/^key=(?:"([^"]+)"|'([^']+)'|([^\s]+))(?:\s+|$)/.exec(rest);
  if(named){key=named[1]??named[2]??named[3];rest=rest.slice(named[0].length).trim();}
  else if(['getvar','incvar','decvar','flushvar'].includes(cmd)){
   const token=/^([^\s]+)(?:\s+|$)/.exec(rest);if(token){key=token[1];rest=rest.slice(token[0].length).trim();}
  }
  if(!keyOk(key))throw err('E_STSCRIPT_SYNTAX','第 '+(i+1)+' 段变量名无效；写入命令必须明确提供 key=名称');
  if(['getvar','incvar','decvar','flushvar'].includes(cmd)&&rest)throw err('E_STSCRIPT_UNSUPPORTED','/'+cmd+' 有未支持的附加参数');
 }
 if(['abort','len'].includes(cmd)&&rest)throw err('E_STSCRIPT_UNSUPPORTED','/'+cmd+' 暂不支持附加参数');
 if(/^(?:index|at|scope|rule|else)=/i.test(rest))throw err('E_STSCRIPT_UNSUPPORTED','复杂命令参数需要原版酒馆解析器');
 return{cmd,key,rest,index:i+1};
 });}
function expand(raw,ctx){const source=String(raw);let unresolved=null;const result=source.replace(/\{\{\s*([^{}]*?)\s*\}\}/g,(token,id)=>{
  const macro=id.trim();if(/^pipe$/i.test(macro))return encode(ctx.pipe);
  if(/^char$/i.test(macro))return ctx.char;
  if(/^user$/i.test(macro))return ctx.user;
  const m=/^getvar::([\p{L}\p{N}_-]+)$/iu.exec(macro);
  if(m&&keyOk(m[1]))return encode(Object.hasOwn(ctx.vars,m[1])?ctx.vars[m[1]]:'');
  unresolved=macro;return token;
 });
 if(unresolved||result.includes('{{')||result.includes('}}'))throw err('E_STSCRIPT_UNSUPPORTED','无法可靠展开的宏：'+(unresolved||'不完整宏'));
 if(result.length>8192)throw err('E_STSCRIPT_BUDGET','单个命令展开后超过 8192 字符');
 return result;
}
function unquote(src){if(src.length>=2&&(src[0]==='"'&&src.at(-1)==='"'||src[0]==="'"&&src.at(-1)==="'"))return src.slice(1,-1);return src;}
function valueFor(src,pipe){if(!src)return pipe;const quoted=src.length>=2&&(src[0]==='"'&&src.at(-1)==='"'||src[0]==="'"&&src.at(-1)==="'");const raw=unquote(src);if(quoted)return raw;if(/^(?:\{|\[|"|-?\d|true$|false$|null$)/.test(raw)){
  try{return JSON.parse(raw);}catch(_){} }
 return raw;}
function bounds(vars){if(Object.getPrototypeOf(vars)!==Object.prototype||Object.keys(vars).length>256)throw err('E_STSCRIPT_BUDGET','变量结构异常或数量超过 256');
 for(const [k,v]of Object.entries(vars)){
  if(!keyOk(k))throw err('E_STSCRIPT_BUDGET','存储中包含非法变量名');
  if(v!==null&&typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean'&&!Array.isArray(v)&&!(v&&Object.getPrototypeOf(v)===Object.prototype))throw err('E_STSCRIPT_BUDGET','变量类型不支持');
  if(typeof v==='number'&&!Number.isFinite(v))throw err('E_STSCRIPT_BUDGET','非有限变量值');
 }
 const checkNested=(v,depth)=>{if(depth>12)throw err('E_STSCRIPT_BUDGET','变量嵌套超过 12 层');if(Array.isArray(v)){if(v.length>1000)throw err('E_STSCRIPT_BUDGET','数组太长');for(const x of v)checkNested(x,depth+1);}else if(v&&typeof v==='object'){if(Object.getPrototypeOf(v)!==Object.prototype)throw err('E_STSCRIPT_BUDGET','不接受非纯 JSON 对象');for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw err('E_STSCRIPT_BUDGET','嵌套变量含危险属性');checkNested(x,depth+1);}}else if(v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))throw err('E_STSCRIPT_BUDGET','变量包含不支持的值');};
 for(const v of Object.values(vars))checkNested(v,0);
 const raw=JSON.stringify(vars);if(raw.length>65536)throw err('E_STSCRIPT_BUDGET','剧情脚本变量超过 64KiB');
 const found=JSON.parse(raw,(k,v)=>{if(k&&['__proto__','constructor','prototype'].includes(k))throw err('E_STSCRIPT_BUDGET','嵌套变量含危险属性');return v;});
 return found;
}
function evaluate(program,starting={},context={}){
 let vars=bounds(safeClone(starting)),pipe='',logs=[],changed=false,aborted=false;
 const ctx={vars,pipe,char:String(context.char||'角色'),user:String(context.user||'玩家')};
 if(ctx.char.length>128||ctx.user.length>128)throw err('E_STSCRIPT_BUDGET','角色名称过长');
 for(const step of program){ctx.pipe=pipe;const expanded=expand(step.rest,ctx);
  let val=valueFor(expanded,pipe);
  switch(step.cmd){
   case'pass':case'return':pipe=val;break;
   case'echo':logs.push(encode(expanded?unquote(expanded):pipe));if(logs.reduce((n,x)=>n+x.length,0)>32768)throw err('E_STSCRIPT_BUDGET','输出超过 32KiB');break;
   case'getvar':pipe=Object.hasOwn(vars,step.key)?vars[step.key]:'';break;
   case'setvar':vars[step.key]=val;changed=true;pipe=val;break;
   case'flushvar':delete vars[step.key];changed=true;pipe='';break;
   case'incvar':case'decvar':case'addvar':{
    const delta=step.cmd==='incvar'?1:step.cmd==='decvar'?-1:val;
    const current=Object.hasOwn(vars,step.key)?vars[step.key]:0;
    const n=Number(current),d=Number(delta);
    const result=Number.isFinite(n)&&Number.isFinite(d)&&encode(current).trim()!==''&&encode(delta).trim()!==''?n+d:encode(current)+encode(delta);
    if(typeof result==='number'&&!Number.isFinite(result))throw err('E_STSCRIPT_BUDGET','数值运算溢出');
    vars[step.key]=result;changed=true;pipe=result;break;
   }
   case'len':{const value=expanded?val:pipe;pipe=typeof value==='string'||Array.isArray(value)?value.length:value&&typeof value==='object'?Object.keys(value).length:encode(value).length;break;}
   case'abort':aborted=true;break;
   default:throw err('E_STSCRIPT_UNSUPPORTED','命令未实现：'+step.cmd);
  }
  if(changed)vars=bounds(vars);ctx.vars=vars;
  if(aborted)break;
 }
 return Object.freeze({pipe,logs,variables:vars,changed,aborted,steps:program.length});
}
async function persist(session,old,record,live){
 const db=await root.MimaCompatStore.open();return new Promise((resolve,reject)=>{
  const tx=db.transaction(['compat_sessions','variables'],'readwrite'),ss=tx.objectStore('compat_sessions'),vs=tx.objectStore('variables');let current,previous,remaining=2,result,issue;
  const bad=e=>{issue=e;try{tx.abort();}catch(_){}};
  const ready=()=>{if(--remaining)return;try{
   if(!live()||!current||current.revision!==session.revision||current.pendingTurnId||(previous?.revision??null)!==(old?.revision??null))throw err('E_CANONICAL_CONFLICT','脚本执行时故事、变量或页面已变化，整批未保存');
   result={...record,revision:(old?.revision||0)+1};vs.put(result);ss.put({...current,revision:current.revision+1});
  }catch(e){bad(e);}};
  const a=ss.get(session.id),b=vs.get(record.id);a.onsuccess=()=>{current=a.result;ready();};b.onsuccess=()=>{previous=b.result;ready();};a.onerror=()=>bad(a.error);b.onerror=()=>bad(b.error);
  tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error);};
 });
}
async function execute(sessionId,source,context={},options={}){
 if(typeof sessionId!=='string'||!sessionId.trim())throw err('E_STSCRIPT_NO_SESSION','需要选择兼容剧情');
 const program=compile(source),store=root.MimaCompatStore;
 if(!store?.get||!store?.putCAS)throw err('E_STORE_UNVERIFIED','兼容库不可用');
 if(active.has(sessionId))throw err('E_STSCRIPT_BUSY','同一剧情正在执行脚本');active.add(sessionId);
 try{
  const session=await store.get('compat_sessions',sessionId);
  if(!session||session.id!==sessionId)throw err('E_STORE_UNVERIFIED','兼容剧情未经过验证');
  const live=options.live||(()=>true);if(typeof live!=='function'||!live()||session.pendingTurnId)throw err('E_STSCRIPT_BUSY','故事正在生成或脚本页面已失效');
  const id=sessionId+':__stscript_local_v1',old=await store.get('variables',id);
  if(old&&(old.sessionId!==sessionId||old.namespace!=='stscript'||old.id!==id||!Number.isInteger(old.revision)))throw err('E_STORE_UNVERIFIED','脚本变量来源与剧情不一致');
  const result=evaluate(program,old?.value||{},context);
  if(!result.changed)return {...result,committed:false,revision:old?.revision||0};
  const record={id,sessionId,namespace:'stscript',value:result.variables,updatedAt:new Date().toISOString()};
  // Store version is checked by IndexedDB in the SAME write transaction.
  // Any other tab's conflicting edit rejects the entire batch.
  const saved=await persist(session,old,record,live);
  return {...result,committed:true,revision:saved.revision};
 }finally{active.delete(sessionId);}
}
return Object.freeze({supported,compile,evaluate,execute});
});
