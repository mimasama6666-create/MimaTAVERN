/* Display-only Markdown. HTML authors still use the separate opaque sandbox. */
(function(root){'use strict';
const allowed=new Set(['P','BR','HR','STRONG','B','EM','I','DEL','S','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TH','TD','A']);
const voidStoryTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
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
// Native story prose: interpret Markdown asterisk emphasis and punctuation
// escapes without running model output through innerHTML. All other Markdown
// syntax (including code spans/HTML/links) remains literal on this path.
function renderStoryInline(target,value){
 const source=String(value??'');
 // Plain text without either relevant syntax is intentionally cheap to paint.
 if(!source.includes('*')&&!source.includes('\\')){target.textContent=source;return;}
 if(!root.marked?.Lexer?.lexInline)throw Object.assign(new Error('Markdown 行内解析组件未加载'),{code:'E_MARKDOWN_UNAVAILABLE'});
 const fragment=document.createDocumentFragment();
 // Recover explicit quoted emphasis before Marked gets a chance to pair
 // the end of one Chinese quote with the beginning of the next. Work only
 // in prose: code spans, Markdown links and literal HTML stay opaque.
 function quotedEmphasisAt(at){
  if(source[at]!=='*'||source[at-1]==='*')return null;
  const marks=source.startsWith('**',at)?'**':'*',after=at+marks.length;
  if(source[after]==='*')return null;
  const spaces=/^[ \t]*/.exec(source.slice(after))[0];
  const opener=source[after+spaces.length],closer=({'“':'”','「':'」','『':'』','《':'》','〈':'〉'})[opener];
  if(!closer)return null;
  const start=after+spaces.length,close=source.indexOf(closer,start+1);
  if(close<0||source.slice(start,close).includes('\n')||close===start+1)return null;
  const tail=/^[ \t]*/.exec(source.slice(close+1))[0],end=close+1+tail.length;
  if(!source.startsWith(marks,end)||source[end+marks.length]==='*')return null;
  // Do not turn incomplete or nested emphasis into a matched quote.
  if(source.slice(start+1,close).includes('*'))return null;
  return {end:end+marks.length,marks,body:source.slice(after,end)};
 }
 function markdownLinkEnd(at){
  const open=source[at]==='!'?at+1:at;
  if(source[open]!=='[')return -1;
  let depth=1,i=open+1;
  for(;i<source.length;i++){
   if(source[i]==='\\'){i++;continue;}
   if(source[i]==='[')depth++;
   else if(source[i]===']'&&!--depth)break;
  }
  if(depth||i+1>=source.length)return -1;
  const next=source[i+1];
  if(next==='('){
   depth=1;for(let j=i+2;j<source.length;j++){
    if(source[j]==='\\'){j++;continue;}
    if(source[j]==='(')depth++;
    else if(source[j]===')'&&!--depth)return j+1;
   }
  }else if(next==='['){
   const end=source.indexOf(']',i+2);if(end!==-1)return end+1;
  }
  return -1;
 }
 function literalCodeEnd(at){
  const ticks=/^`+/.exec(source.slice(at))[0];
  let end=source.indexOf(ticks,at+ticks.length);
  while(end!==-1){
   if(source[end-1]!=='`'&&source[end+ticks.length]!=='`')return end+ticks.length;
   end=source.indexOf(ticks,end+ticks.length);
  }
  return source.length; // unmatched opener: do not reinterpret its tail as quoted emphasis
 }
 function splitProse(){
  const pieces=[];let from=0,i=0;const tags=[];
  while(i<source.length){
   if(source[i]==='<'){
    if(source.startsWith('<!--',i)){
     const end=source.indexOf('-->',i+4);i=end<0?source.length:end+3;continue;
    }
    const tag=/^<\s*(\/)?([a-z][\w:-]*)\b[^>]*>/i.exec(source.slice(i));
    if(tag){
     const name=tag[2].toLowerCase();
     if(tag[1]){const at=tags.lastIndexOf(name);if(at!==-1)tags.splice(at);}
     else if(!/\/\s*>$/.test(tag[0])&&!voidStoryTags.has(name))tags.push(name);
     i+=tag[0].length;continue;
    }
   }
   if(tags.length){i++;continue;}
   if(source[i]==='\\'){i+=2;continue;}
   if(source[i]==='`'){i=literalCodeEnd(i);continue;}
   if(source[i]==='['||(source[i]==='!'&&source[i+1]==='[')){
    const end=markdownLinkEnd(i);if(end!==-1){i=end;continue;}
   }
   if(source[i]==='*'){
    const quote=quotedEmphasisAt(i);
    if(quote){
     if(i>from)pieces.push({text:source.slice(from,i)});
     pieces.push({quote});i=quote.end;from=i;continue;
    }
   }
   i++;
  }
  if(from<source.length)pieces.push({text:source.slice(from)});
  return pieces;
 }
 function isPathEscape(before){
  // The parser has already consumed the preceding part of this *same* prose
  // slice. Recognize a path anchor anywhere inside the current word, including
  // after Chinese text with no separating space. Bare \_ remains Markdown.
  const tail=before.slice(-512).split(/[\s<>'"“”‘’「」(){}\[\]]/).pop()||'';
  return /[a-z]:[\\/]/i.test(tail)||/\\\\[^\\/]+[\\/]/.test(tail)||
   /(?:^|[\\/])\.{1,2}[\\/]/.test(tail)||/(?:^|[\\/])[a-z0-9_.-]+[\\/]/i.test(tail)||/[\\/][a-z0-9][a-z0-9_.-]*$/i.test(tail);
 }
 const htmlStack=[];
 function trackLiteralHtml(raw){
  const tag=/^<\s*(\/)?([a-z][\w:-]*)\b[^>]*>$/i.exec(raw);
  if(!tag)return;
  const closing=!!tag[1],name=tag[2].toLowerCase();
  if(closing){const i=htmlStack.lastIndexOf(name);if(i!==-1)htmlStack.splice(i);}
  else if(!/\/\s*>$/.test(raw)&&!voidStoryTags.has(name))htmlStack.push(name);
 }
 function appendTokens(items,parent,scope=''){
  let preceding='';
  for(const token of items){
   const raw=token.raw??token.text??'';
   if(token.type==='html'){
    parent.appendChild(document.createTextNode(raw));trackLiteralHtml(raw);
   }else if(htmlStack.length){
    parent.appendChild(document.createTextNode(raw));
   }else if((token.type==='em'||token.type==='strong')&&raw.startsWith('*')){
    const node=document.createElement(token.type==='em'?'em':'strong');
    appendTokens(token.tokens||[],node);parent.appendChild(node);
   }else if(token.type==='escape'){
    // A filesystem path segment named \_foo is not a Markdown escape.
    const uncRoot=raw==='\\\\'&&/^[^\\/\s]+\\[^\\/\s]+/.test(scope.slice(preceding.length+raw.length));
    parent.appendChild(document.createTextNode(isPathEscape(preceding)||uncRoot?raw:(token.text||'')));
   }else if(token.type==='text'){
    parent.appendChild(document.createTextNode(raw));
   }else{
    // Links, images, code and underscore emphasis stay literal.
    parent.appendChild(document.createTextNode(raw));
   }
   preceding+=raw;
  }
 }

 for(const piece of splitProse()){
  if(piece.quote){
   const node=document.createElement(piece.quote.marks==='**'?'strong':'em');
   node.textContent=piece.quote.body;fragment.appendChild(node);
  }else appendTokens(root.marked.Lexer.lexInline(piece.text),fragment,piece.text);
 }
 target.replaceChildren(fragment);
}
root.MimaCompatMarkdown=Object.freeze({html,render,renderStoryInline,version:'marked-17.0.5'});
})(typeof window!=='undefined'?window:globalThis);
