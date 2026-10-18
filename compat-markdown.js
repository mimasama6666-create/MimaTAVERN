/* Display-only Markdown. HTML authors still use the separate opaque sandbox. */
(function(root){'use strict';
const allowed=new Set(['P','BR','HR','STRONG','B','EM','I','DEL','S','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TH','TD','A']);
function html(value){if(!root.marked?.parse)throw Object.assign(new Error('Markdown 显示组件未加载'),{code:'E_MARKDOWN_UNAVAILABLE'});return root.marked.parse(String(value??''),{async:false,gfm:true,breaks:true});}
function render(target,value){
 const template=document.createElement('template');template.innerHTML=html(value);const fragment=document.createDocumentFragment();
 function append(source,parent){
  if(source.nodeType===3){parent.append(document.createTextNode(source.nodeValue));return;}
  if(source.nodeType!==1)return;
  if(source.tagName==='IMG'){parent.append(document.createTextNode('[图片'+(source.getAttribute('alt')?'：'+source.getAttribute('alt'):'')+']'));return;}
  if(source.tagName==='INPUT'&&source.type==='checkbox'){parent.append(document.createTextNode(source.checked?'☑ ':'☐ '));return;}
  if(!allowed.has(source.tagName)){parent.append(document.createTextNode(source.outerHTML));return;}
  const element=document.createElement(source.tagName.toLowerCase());
  if(source.tagName==='A'){const href=source.getAttribute('href')||'';if(/^(?:https?:\/\/|mailto:|#)/i.test(href)&&!/[\u0000-\u001f]/.test(href)){element.setAttribute('href',href);element.setAttribute('target','_blank');element.setAttribute('rel','noopener noreferrer');}}
  if(source.tagName==='CODE'&&/^language-[a-z0-9_-]+$/i.test(source.className))element.className=source.className;
  for(const child of source.childNodes)append(child,element);parent.append(element);
 }
 for(const child of template.content.childNodes)append(child,fragment);target.replaceChildren(fragment);target.classList.add('compat-markdown');
}
// Native story prose: only interpret asterisk emphasis, preserving other literal
// Markdown/HTML syntax. Never put model output into innerHTML on this path.
function renderStoryInline(target,value){
 const source=String(value??'');
 if(!source.includes('*')){target.textContent=source;return;}
 if(!root.marked?.Lexer?.lexInline)throw Object.assign(new Error('Markdown 行内解析组件未加载'),{code:'E_MARKDOWN_UNAVAILABLE'});
 const tokens=root.marked.Lexer.lexInline(source),fragment=document.createDocumentFragment();
 function appendTokens(items,parent){
  for(const token of items){
   if((token.type==='em'||token.type==='strong')&&token.raw?.startsWith('*')){
    const node=document.createElement(token.type==='em'?'em':'strong');
    appendTokens(token.tokens||[],node);parent.appendChild(node);
   }else if(token.type==='escape'){
    parent.appendChild(document.createTextNode(token.text||''));
   }else{
    // HTML, links, images, code and underscores retain their original text.
    parent.appendChild(document.createTextNode(token.raw??token.text??''));
   }
  }
 }
 appendTokens(tokens,fragment);target.replaceChildren(fragment);
}
root.MimaCompatMarkdown=Object.freeze({html,render,renderStoryInline,version:'marked-17.0.5'});
})(typeof window!=='undefined'?window:globalThis);
