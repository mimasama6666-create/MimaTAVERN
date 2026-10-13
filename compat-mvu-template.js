/* Optional, deliberately limited MVU HTML status preview. No script execution,
 * data writes or SillyTavern template equivalence is implied. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatMvuTemplate=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const error=(code,message)=>Object.assign(new Error(message),{code});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsonValue=value=>value===null?'未设置':typeof value==='object'?JSON.stringify(value):String(value);
function pointer(source,path){
 if(!source||typeof source!=='object'||Array.isArray(source))throw error('E_MVU_TEMPLATE_STATE','没有已验证的 MVU 状态');
 if(typeof path!=='string'||!/^\/(?:[^\s{}]*)$/.test(path)||path.length>512)throw error('E_MVU_TEMPLATE_PATH','变量引用不是 JSON Pointer');
 const parts=path.slice(1).split('/').map(part=>{if(/~(?![01])/.test(part))throw error('E_MVU_TEMPLATE_PATH','路径转义无效');return part.replace(/~1/g,'/').replace(/~0/g,'~');});
 if(parts.length>12||parts.some(k=>!k||['__proto__','prototype','constructor'].includes(k)||k.startsWith('_')))throw error('E_MVU_TEMPLATE_PATH','变量引用包含不安全字段');
 let value=source;
 for(const segment of parts){if(value===null||typeof value!=='object'||!Object.hasOwn(value,segment))throw error('E_MVU_TEMPLATE_NOT_FOUND','状态中不存在变量：'+path);value=value[segment];}
 if(Array.isArray(value)&&value.length===2&&typeof value[1]==='string')value=value[0];
 return value;
}
function render(html,state){
 if(typeof html!=='string'||!html.trim()||html.length>100000)throw error('E_MVU_TEMPLATE_INVALID','模板必须是 1～100000 字符的 HTML');
 if(!state||typeof state!=='object'||Array.isArray(state))throw error('E_MVU_TEMPLATE_STATE','此剧情尚无可信 MVU 状态');
 const placeholders=[...html.matchAll(/\{\{\s*mvu:(\/[^{}\s]*)\s*\}\}/gi)];
 if(placeholders.length>150)throw error('E_MVU_TEMPLATE_BUDGET','模板变量插槽超过 150 个');
 // Unknown SillyTavern and JavaScript macros are never evaluated as if they
 // were trusted MVU values. They remain inert and are reported to the user.
 const unsupported=[...new Set([...html.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(x=>x[1].trim()).filter(x=>!/^mvu:\/[^{}\s]*$/i.test(x)))];
 let mapped=0;
 const body=html.replace(/\{\{\s*mvu:(\/[^{}\s]*)\s*\}\}/gi,(_,path)=>{const value=pointer(state,path);mapped++;return esc(jsonValue(value));});
 return{html:body,bindings:mapped,unsupported:unsupported.slice(0,12),unsupportedCount:unsupported.length};
}
function documentFor(result){
 if(!result||typeof result.html!=='string')throw error('E_MVU_TEMPLATE_INVALID','没有可预览的模板');
 // Opaque sandboxed iframe, no script, external requests, forms or navigation.
 // This is a viewing surface, not an extension host.
 return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; img-src data:; font-src \'none\'; media-src \'none\'; frame-src \'none\'; style-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;overflow-wrap:anywhere;font-family:system-ui,sans-serif;line-height:1.5;color:#292525;background:#faf9f6}*{max-width:100%;box-sizing:border-box}</style></head><body>'+result.html+'</body></html>';
}
return Object.freeze({render,documentFor,pointer});
});
