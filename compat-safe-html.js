/* Untrusted role-message display only. Never grants origin/script access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatSafeHtml=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const HTML_FRAGMENT=/<\s*(?:div|section|article|table|thead|tbody|tr|th|td|details|summary|style|header|footer|main|aside|p|span|h[1-6]|ul|ol|li|dl|dt|dd|progress|meter|system|status|statusbar|status-bar|br|hr|pre|blockquote)\b[^>]*>/i;
const maxBytes=150000;
function classify(content,role,status){const text=String(content??'');return{showHtml:role==='assistant'&&status==='committed'&&text.length<=maxBytes&&!/^\s*```/.test(text)&&HTML_FRAGMENT.test(text),oversize:text.length>maxBytes};}
// Strip fetch-capable CSS declarations, not entire legitimate stylesheets.
// Detached CSSOM parsing ensures escaped URLs and image-set() are normalized
// before rejection. This also applies to <style> emitted by the model.
function safeCssText(value){
 const raw=String(value??'');if(!raw.trim())return '';if(raw.length>100000||/<\s*\/\s*style\b/i.test(raw))throw new Error('E_DISPLAY_CSS_INVALID');
 if(typeof CSSStyleSheet!=='function')throw new Error('E_DISPLAY_CSS_PARSER_UNAVAILABLE');
 const sheet=new CSSStyleSheet();sheet.replaceSync(raw);
 const reject=/(?:url\s*\(|image-set\s*\(|-webkit-image-set\s*\(|expression\s*\(|behavior\s*:|@import)/i;
 const scrub=rules=>Array.from(rules).map(rule=>{
  if(rule.type===3||rule.type===10)return ''; // @import / @namespace
  if(rule.style){for(const name of Array.from(rule.style)){if(reject.test(rule.style.getPropertyValue(name)))rule.style.removeProperty(name);}
    return rule.cssText;
  }
  if(rule.cssRules){const outer=rule.cssText;const brace=outer.indexOf('{');if(brace<0)return '';
    return outer.slice(0,brace+1)+'\n'+scrub(rule.cssRules)+'\n}';
  }
  return reject.test(rule.cssText)?'':rule.cssText;
 }).filter(Boolean).join('\n');
 return scrub(sheet.cssRules);
}
function sanitise(untrusted){
 if(typeof document==='undefined')return untrusted; // Only used in browser display; CSP + opaque frame is the independent boundary.
 const template=document.createElement('template');template.innerHTML=untrusted;
 for(const element of [...template.content.querySelectorAll('*')]){
  if(/^(SCRIPT|IFRAME|OBJECT|EMBED|LINK|META|BASE|FORM|INPUT|BUTTON|SELECT|TEXTAREA|VIDEO|AUDIO|SOURCE|SVG|MATH|TEMPLATE)$/i.test(element.tagName)){
   if(element.tagName==='SCRIPT'||element.tagName==='IFRAME'||element.tagName==='OBJECT'||element.tagName==='EMBED'||element.tagName==='META'||element.tagName==='LINK'||element.tagName==='BASE')element.remove();
   else element.replaceWith(document.createTextNode(element.textContent||''));continue;
  }
  // Links are text-only in a diagnostic display; no navigation out of iframe.
  if(element.tagName==='A'){if(element.tagName==='SCRIPT'||element.tagName==='IFRAME'||element.tagName==='OBJECT'||element.tagName==='EMBED'||element.tagName==='META'||element.tagName==='LINK'||element.tagName==='BASE')element.remove();
   else element.replaceWith(document.createTextNode(element.textContent||''));continue;}
  for(const attr of [...element.attributes]){
   const key=attr.name.toLowerCase();
   if(key.startsWith('on')||['href','srcdoc','srcset','action','formaction','target','ping','xlink:href'].includes(key)||
      (key==='src'&&!(element.tagName==='IMG'&&/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(attr.value)))||
      (key==='style'&&/url\s*\(|@import|expression\s*\(/i.test(attr.value)))element.removeAttribute(attr.name);
  }
  if(element.tagName==='STYLE'){try{element.textContent=safeCssText(element.textContent)}catch(_){element.textContent='';}}
 }
 return template.innerHTML;
}
// Card HTML lives in an opaque iframe. Only the host-authored resize bridge runs;
// card-provided scripts/event handlers remain stripped and cannot obtain host origin.
function srcdoc(content, options={}){
 const raw=String(content??'');if(raw.length>maxBytes)throw new Error('HTML 展示内容超过安全上限；请查看原文');
 const html=sanitise(raw);
 const css=safeCssText(options.css||'');
 const token=String(options.token||'');const legacyNoResize=!token&&!options.nonce;
 if(!legacyNoResize&&!/^[0-9a-f]{32,64}$/.test(token))throw new Error('E_DISPLAY_TOKEN: 隔离显示令牌无效');
 const nonce=String(options.nonce||'');if(!legacyNoResize&&!/^[0-9a-f]{32,64}$/.test(nonce))throw new Error('E_DISPLAY_NONCE: 高度同步令牌无效');
 const color=String(options.color||'#292a30');const font=String(options.font||'system-ui,sans-serif');
 const fontSize=String(options.fontSize||'16px');
 const cleanColor=/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(color)?color:'#292a30';
 const cleanFont=/^[^<>{};\n\r]{1,160}$/.test(font)?font:'system-ui,sans-serif';
 const cleanFontSize=/^(?:\d+(?:\.\d+)?)(?:px|rem|em)$/.test(fontSize)?fontSize:'16px';
 const csp="default-src 'none'; script-src "+(legacyNoResize?"'none'":"'nonce-"+nonce+"'")+"; connect-src 'none'; img-src data:; media-src 'none'; font-src data:; style-src 'unsafe-inline'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
 const base='html,body{margin:0;padding:0;overflow-wrap:anywhere}body{background:transparent;color:'+cleanColor+';font-family:'+cleanFont+';font-size:'+cleanFontSize+';line-height:1.65;white-space:pre-wrap}*,*:before,*:after{box-sizing:border-box}table{max-width:100%;border-collapse:collapse}td,th{border:1px solid #9995;padding:5px}img,svg{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}';
 // The trusted bridge does no DOM mutation. It only reports its own measured
 // content height. Parent verifies token, source window, and session generation.
 const bridge='(function(){const key='+JSON.stringify(token)+';let previous=0;function report(){const d=document.documentElement,b=document.body;const h=Math.ceil(Math.max(d.scrollHeight,b.scrollHeight,d.offsetHeight,b.offsetHeight));if(h!==previous){previous=h;parent.postMessage({mimaSafeHeight:key,height:h},"*");}}new ResizeObserver(report).observe(document.body);new ResizeObserver(report).observe(document.documentElement);addEventListener("load",report);document.addEventListener("DOMContentLoaded",report);report();})();';
 return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+base+'\n'+css+'</style></head><body>'+html+(legacyNoResize?'':'<script nonce="'+nonce+'">'+bridge+'</script>')+'</body></html>';
}
return Object.freeze({classify,srcdoc,safeCssText,maxBytes});
});
