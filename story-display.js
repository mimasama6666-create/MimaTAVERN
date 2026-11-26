/* Message presentation: verified resources, a shared scoped cascade and detached HTML. */
(function createStoryDisplay(window) {
 'use strict';
 const document=window.document,{CSSStyleSheet,DOMParser,MutationObserver,ResizeObserver,DOMMatrix,DOMPoint,Element,URL}=window;
 const getComputedStyle=window.getComputedStyle.bind(window),requestAnimationFrame=window.requestAnimationFrame.bind(window);
 const instances=new WeakMap();
 if(!window.MimaSHA256&&window.parent!==window){window.MimaSHA256=window.parent.MimaSHA256;window.compileColorModeCss=window.parent.compileColorModeCss;}
 const sourceCache=new Map(), cascadeCache=new Map(), verified=new Map(), packInspections=new WeakMap();
 const images=new Map(), ownedUrls=new Set(), mountedHosts=new Map(), inlineSources=new WeakMap();
 const inlineLayout=new WeakSet(),layoutClips=new WeakMap(),layoutGuards=new Map();let layoutFrame=0,layoutSerial=0;
 // Important declarations in this reserved first layer beat generated layers,
 // including a generated !important clip/transition on a pseudo-element.
 if(document.head){const layer=document.createElement('style');layer.dataset.mimaDisplayBoundaryLayer='';layer.textContent='@layer mima_display_boundaries;';document.head.append(layer);}
 const shellProperty=/^(?:all$|position$|inset(?:-|$)|top$|right$|bottom$|left$|z-index$|transform(?:-|$)|translate$|rotate$|scale$|perspective(?:-|$)|contain$|isolation$|float$|(?:min-|max-)?(?:width|height|inline-size|block-size)$|margin(?:-|$)|animation(?:-|$))/;
 const localFlow={position:'relative',inset:'auto',margin:'0',transform:'none',translate:'none',rotate:'none',scale:'none',perspective:'none',width:'100%',minWidth:'0',maxWidth:'100%',height:'auto',minHeight:'0',maxHeight:'none',boxSizing:'border-box'};
 const flowProperties=Object.entries(localFlow).map(([name,value])=>[name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value]);
 const hasLayout=style=>[...style].some(name=>{
  const value=style.getPropertyValue(name).trim();
  if(name==='position')return /^(absolute|fixed|sticky)$/.test(value);
  if(/^(transform|translate|rotate|scale|perspective|animation(?:-name)?|z-index)$/.test(name))return !/^(none|auto|0)$/.test(value);
  if(/^(?:inset(?:-|$)|top$|right$|bottom$|left$|margin(?:-|$))/.test(name))return !/^(?:auto|0(?:px)?)(?:\s+0(?:px)?)*$/.test(value);
  return /^(?:min-|max-)?(?:width|height|inline-size|block-size)$/.test(name)&&!(/^(?:auto|none|(?:\d+(?:\.\d+)?)%)$/.test(value)&&(!value.endsWith('%')||parseFloat(value)<=100));
 });
 let registry=new Map(), issues=new Map(), gcFrame=0, observer;
 const hash=text=>window.MimaSHA256.create().update(new TextEncoder().encode(String(text))).hex();
 const fail=(code,message)=>Object.assign(new Error(message),{code});
 const escAttr=s=>String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\n\r\f]/g,' ');
 const scopeId=(scope,id)=>scope+'_'+hash(id).slice(0,20);
 const markerPattern=()=>/<mima-style\b[^>]*\bdata-ref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;

 function verifiedStyle(row) {
  if(!row||typeof row.css!=='string'||typeof row.id!=='string')throw fail('E_DISPLAY_STYLE_ID','固定样式记录不完整');
  if(registry.get(row.id)?.css===row.css||verified.get(row.id)===row.css)return row;
  if(row.id!=='style_'+hash(row.css))throw fail('E_DISPLAY_STYLE_ID','固定样式的内容标识不一致：'+row.id);
  verified.set(row.id,row.css);
  while(verified.size>192)verified.delete(verified.keys().next().value);
  return row;
 }
 function inspectPack(pack,{known=null}={}) {
  if(!known&&packInspections.has(pack))return packInspections.get(pack);
  const resources=new Map(), problems=[];
  for(const row of pack.displayStyles||[]){
   try{
    if(resources.has(row?.id))throw fail('E_DISPLAY_STYLE_ID','固定样式标识重复：'+row.id);
    verifiedStyle(row);resources.set(row.id,row);
   }catch(error){problems.push({code:error.code,id:row?.id,message:error.message});}
  }
  for(const rule of pack.rules||[]){
   const source=String(rule.replacement??'');
   if(!source.includes('<')||!/<mima-style\b/i.test(source))continue;
   const count=[...source.matchAll(/<mima-style\b/gi)].length;
   const refs=[...source.matchAll(markerPattern())].map(m=>m[1]||m[2]||m[3]);
   if(count!==refs.length)problems.push({code:'E_DISPLAY_STYLE_REFERENCE',ruleId:rule.id,message:'规则 '+rule.name+' 的固定样式引用缺少标识'});
   for(const ref of refs)if(!resources.has(ref)&&!known?.has(ref))problems.push({code:'E_DISPLAY_STYLE_MISSING',id:ref,ruleId:rule.id,message:'规则 '+rule.name+' 引用了不可用的固定样式 '+ref});
  }
  const result={resources,problems};
  if(!known)packInspections.set(pack,result);
  return result;
 }
 function registerResources(packs) {
  const next=new Map(), failures=new Map();
  for(const pack of packs||[]){
   const result=inspectPack(pack);
   if(result.problems.length)failures.set(pack.id,result.problems);
   for(const [id,row] of result.resources)next.set(id,row);
  }
  registry=next;issues=failures;
  for(const id of verified.keys())if(!registry.has(id))verified.delete(id);
  return failures;
 }
 function preparePack(pack,{repair=false}={}) {
  const rows=pack.displayStyles||[], aliases=new Map(),styles=new Map();
  for(const row of rows){
   if(typeof row?.css!=='string')throw fail('E_DISPLAY_STYLE_ID','固定样式正文缺失，无法从现有资料恢复');
   const id=repair?'style_'+hash(row.css):verifiedStyle(row).id;
   if(aliases.has(row.id)&&aliases.get(row.id)!==id)throw fail('E_DISPLAY_STYLE_ID','相同旧标识内存在两份正文，请核对原文件');
   aliases.set(row.id,id);styles.set(id,{id,css:row.css});
  }
  if(!repair&&styles.size!==rows.length)throw fail('E_DISPLAY_STYLE_ID','固定样式标识重复');
  const rules=(pack.rules||[]).map(rule=>{
   let replacement=String(rule.replacement??'');
   if(repair&&replacement.includes('<'))replacement=replacement.replace(markerPattern(),(whole,a,b,c)=>{
    const ref=a||b||c,id=aliases.get(ref);
    return id?whole.replace(/(data-ref\s*=\s*)(?:"[^"]+"|'[^']+'|[^\s>]+)/i,(_,start)=>start+'"'+id+'"'):whole;
   });
   if((rule.phase||'display')==='display'&&replacement.includes('<'))replacement=replacement.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,(whole,attrs,css)=>{
    // The content of a capture or macro is resolved at display time.
    if(/\bmedia\s*=/i.test(attrs)||/\$(?:[0-9&`'$<])|\{\{/.test(css))return whole;
    const id=parseSource(css).id.replace(/^s_/,'style_');
    if(!styles.has(id))styles.set(id,{id,css});
    return '<mima-style data-ref="'+id+'"></mima-style>';
   });
   return replacement===rule.replacement?rule:{...rule,replacement};
  });
  const next={...pack,rules,displayStyles:[...styles.values()]};
  const check=inspectPack(next);
  if(check.problems.length)throw fail(check.problems[0].code,check.problems.map(x=>x.message).join('；'));
  return next;
 }
 function safeImage(value,diagnostics,materialize,font=false){
  try{return imageValue(value,diagnostics,materialize,font);}
  catch(error){diagnostics.push({kind:font?'font':'image',reason:'内嵌资源无法解码'});return '';}
 }
 function imageValue(raw,diagnostics,materialize,font=false){
  const value=String(raw||'').trim();
  if(value.startsWith('blob:')&&ownedUrls.has(value))return value;
  if(value.startsWith('#'))return value;
  if(!(/^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml)(?:;[^,]*)?,/i.test(value)||font&&/^data:(?:font\/(?:ttf|otf|woff2?|sfnt)|application\/(?:font-woff|x-font-ttf|x-font-opentype|octet-stream))(?:;[^,]*)?,/i.test(value))){
   diagnostics.push({kind:'image',reason:'图片须为内嵌素材或已加载的本地图片',value:value.slice(0,120)});return '';
  }
  let safe=value;
  if(/^data:image\/svg\+xml/i.test(value)){
   try{
    const comma=value.indexOf(','),body=/;base64/i.test(value.slice(0,comma))?new TextDecoder().decode(Uint8Array.from(atob(value.slice(comma+1)),c=>c.charCodeAt(0))):decodeURIComponent(value.slice(comma+1));
    const doc=new DOMParser().parseFromString(body,'image/svg+xml');if(doc.querySelector('parsererror'))throw Error('SVG 解析失败');
    for(const el of [...doc.querySelectorAll('*')]){
     if(/^(script|foreignObject|iframe|object|embed|style)$/i.test(el.localName)){el.remove();continue;}
     for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||(/(?:href|src)$/i.test(attr.name)&&!attr.value.startsWith('#'))||/url\s*\(\s*["']?(?!#)/i.test(attr.value))el.removeAttribute(attr.name);
    }
    safe='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(doc));
   }catch(e){diagnostics.push({kind:'image',reason:e.message});return '';}
  }
  if(!materialize)return safe;
  let item=images.get(safe);if(!item){
   const comma=safe.indexOf(','),header=safe.slice(5,comma),data=safe.slice(comma+1),bytes=/;base64/i.test(header)?Uint8Array.from(atob(data),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(data));
   item={url:URL.createObjectURL(new Blob([bytes],{type:header.split(';')[0]}))};images.set(safe,item);ownedUrls.add(item.url);
  }
  return item.url;
 }
 function declarations(style,diagnostics,materialize,names=new Map(),font=false){
  let result;
  if(font){const sheet=new CSSStyleSheet();sheet.replaceSync('@font-face{}');result=sheet.cssRules[0].style;}
  else result=document.createElement('span').style;
  for(const name of [...style]){
   let value=style.getPropertyValue(name);
   if(/expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:/i.test(name+':'+value)){diagnostics.push({kind:'declaration',name,reason:'含可执行声明'});continue;}
   let rejected=false;
   value=value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(all,a,b,c)=>{const safe=safeImage(a??b??c,diagnostics,materialize,font);if(!safe){rejected=true;return 'none';}return `url("${safe.replace(/"/g,'%22')}")`;});
   if(/image-set\s*\(/i.test(value)&&/["'][^"']+["']\s+(?:\d|type\()/i.test(value)){diagnostics.push({kind:'declaration',name,reason:'图片集合须通过本地图片资源'});continue;}
   if(rejected)continue;
   if(name==='font'||name==='font-family')for(const [old,next]of names.fonts||[])value=value.replace(new RegExp('(^|[\\s,\"\'])'+old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[\\s,\"\'])','g'),(_,prefix)=>prefix+next);
   if(name==='animation'||name==='animation-name')for(const [old,next]of names)value=value.replace(new RegExp('(^|[\\s,\\"\\\'])'+old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[\\s,\\"\\\'])','g'),(_,prefix)=>prefix+next);
   value=value.replace(/url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(-?(?:\d*\.)?\d+)rem\b/gi,(whole,n)=>n===undefined?whole:'calc('+n+'rem / var(--mima-display-rem-unit,1))');
   result.setProperty(name,value,style.getPropertyPriority(name));
   if(value.trim()&&!result.getPropertyValue(name))diagnostics.push({kind:'declaration',name,reason:'浏览器未保留处理后的声明',declaration:(name+':'+value).slice(0,240)});
  }
  return result.cssText;
 }
 function selectors(raw){
  const values=[];let part='',quote='',depth=0,bracket=0,escape=false;
  for(const c of raw){if(escape){part+=c;escape=false;continue;}if(c==='\\'){part+=c;escape=true;continue;}if(quote){part+=c;if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;part+=c;continue;}if(c==='(')depth++;if(c===')')depth--;if(c==='[')bracket++;if(c===']')bracket--;if(c===','&&!depth&&!bracket){values.push(part.trim());part='';}else part+=c;}
  if(part.trim())values.push(part.trim());return values;
 }
 function rewriteIds(selector){
  // CSSOM supplies normalized selectors. Keep hashes inside quoted values intact.
  let out='',quote='',escape=false;
  for(let i=0;i<selector.length;i++){const c=selector[i];if(escape){out+=c;escape=false;continue;}if(quote){out+=c;if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;out+=c;continue;}if(c==='['){const attr=selector.slice(i).match(/^\[\s*id(?=\s*(?:[~|^$*]?=|\]))/i);if(attr){out+='[data-mima-display-id';i+=attr[0].length-1;continue;}}if(c!=='#'){out+=c;continue;}
   let id='';for(i++;i<selector.length;i++){const n=selector[i];if(/[\w\u0080-\uffff-]/.test(n)){id+=n;continue;}if(n==='\\'){
    const m=selector.slice(i+1).match(/^[0-9a-fA-F]{1,6}\s?/);if(m){id+=String.fromCodePoint(parseInt(m[0].trim(),16)||0xfffd);i+=m[0].length;continue;}if(i+1<selector.length){id+=selector[++i];continue;}}
    break;
   }i--;out+=`:is(#mima-display-specificity,[data-mima-display-id="${escAttr(id)}"])`;
  }return out;
 }
 const allowed=new Set('SYSTEM DIV SPAN P BR STRONG B EM I SMALL MARK S U SUB SUP KBD SECTION ARTICLE HEADER FOOTER MAIN ASIDE NAV DETAILS SUMMARY BLOCKQUOTE PRE CODE H1 H2 H3 H4 H5 H6 UL OL LI DL DT DD TABLE CAPTION COLGROUP COL THEAD TBODY TFOOT TR TD TH HR PROGRESS METER STYLE IMG FIGURE FIGCAPTION A TIME CITE Q ABBR ADDRESS WBR'.split(' '));
 const blocked=new Set('SCRIPT IFRAME OBJECT EMBED FORM INPUT BUTTON SELECT TEXTAREA OPTION META LINK BASE SVG MATH VIDEO AUDIO SOURCE TRACK CANVAS NOSCRIPT TEMPLATE'.split(' '));

 // CSSOM silently drops invalid selectors and declarations. Tokenize rule
 // boundaries before parsing so a surviving rule cannot hide a dropped peer.
 function cssUnits(source,inStyle=false) {
  const units=[];let start=0,braces=0,round=0,square=0,quote='',open=-1,declarationBlock=false;
  const add=end=>{
   const raw=source.slice(start,end).replace(/^(?:\s|\/\*[\s\S]*?\*\/)*/,'').trim();
   if(raw&&raw!==';')units.push({raw,block:open>=0&&!declarationBlock});
   start=end;open=-1;declarationBlock=false;
  };
  for(let i=0;i<source.length;i++){
   const ch=source[i];
   if(ch==='\\'){i++;continue;}
   if(quote){if(ch===quote)quote='';continue;}
   if(ch==='"'||ch==="'"){quote=ch;continue;}
   if(ch==='/'&&source[i+1]==='*'){const end=source.indexOf('*/',i+2);if(end<0)break;i=end+1;continue;}
   if(ch==='(')round++;else if(ch===')')round--;
   else if(ch==='[')square++;else if(ch===']')square--;
   if(round||square)continue;
   if(ch==='{'){if(!braces&&open<0){open=i;declarationBlock=inStyle&&/^(?:\s|\/\*[\s\S]*?\*\/)*--[^:;{}]+:/.test(source.slice(start,i));}braces++;}
   else if(ch==='}'&&braces&&!--braces&&!declarationBlock)add(i+1);
   else if(ch===';'&&!braces)add(i+1);
  }
  add(source.length);return units;
 }
 function auditSource(raw,rules,diagnostics,inStyle=false,fontFace=false,compareRules=true) {
  const units=cssUnits(raw,inStyle);
  if(inStyle)for(const unit of units){
   if(unit.block||unit.raw.startsWith('@'))continue;
   const declaration=unit.raw.replace(/;\s*$/,'').trim();
   if(!declaration)continue;
   const colon=declaration.indexOf(':');
   let probe;
   if(fontFace){const sheet=new CSSStyleSheet();sheet.replaceSync('@font-face{'+declaration+'}');probe=sheet.cssRules[0]?.style;}
   else{probe=document.createElement('span').style;probe.cssText=declaration;}
   if(colon<1||!probe?.length)diagnostics.push({kind:'declaration',name:colon>0?declaration.slice(0,colon).trim():'',
    reason:'浏览器未保留此声明',declaration:declaration.slice(0,240)});
  }
  const candidates=units.filter(unit=>!inStyle||unit.block||unit.raw.startsWith('@'));
  const parsed=[...rules].filter(rule=>rule.selectorText!==undefined||!rule.style||rule.type===5||rule.keyText!==undefined);
  if(compareRules&&candidates.length>parsed.length)diagnostics.push({kind:'rule',reason:`浏览器未保留 ${candidates.length-parsed.length} 条样式规则`,rule:candidates.map(v=>v.raw.slice(0,100)).join('；')});
  for(const [index,unit]of candidates.entries()){
   if(!unit.block)continue;
   const rule=compareRules&&candidates.length===parsed.length?parsed[index]:null;
   const a=unit.raw.indexOf('{'),b=unit.raw.lastIndexOf('}');
   const header=unit.raw.slice(0,a).trim(),font=rule?.type===5||/^@font-face\b/i.test(header);
   const group=/^@(media|supports|container|layer|starting-style)\b/i.test(header);
   // A discarded peer rule must not hide declaration losses in surviving
   // rules. Source nesting still supplies the correct declaration grammar.
   const declarationsContext=rule?!!rule.style:font||!header.startsWith('@')||group&&inStyle;
   if(a>=0&&b>a)auditSource(unit.raw.slice(a+1,b),rule?.cssRules||[],diagnostics,declarationsContext,font,!!rule);
  }
 }
 function parseSource(raw,id,trusted=false) {
  const key=(trusted?'trusted:':'generated:')+raw;let result=sourceCache.get(key);
  if(result){sourceCache.delete(key);sourceCache.set(key,result);return result;}
  const sheet=new CSSStyleSheet(),diagnostics=[];
  sheet.replaceSync(raw);
  auditSource(raw,sheet.cssRules,diagnostics);
  result={id:id||'s_'+hash(raw),rules:sheet.cssRules,diagnostics,trusted};
  sourceCache.set(key,result);
  while(sourceCache.size>96)sourceCache.delete(sourceCache.keys().next().value);
  return result;
 }
 function pseudoIndex(selector){
  let level=0,quote='';
  for(let i=0;i<selector.length;i++){
   const ch=selector[i];
   if(ch==='\\'){i++;continue;}
   if(quote){if(ch===quote)quote='';continue;}
   if(ch==='"'||ch==="'"){quote=ch;continue;}
   if(ch==='('||ch==='[')level++;
   if(ch===')'||ch===']')level--;
   if(level===0&&ch===':'&&/^:(?::|before\b|after\b|first-line\b|first-letter\b)/i.test(selector.slice(i)))return i;
  }
  return selector.length;
 }
 function scopedSelector(source,host){
  const s=rewriteIds(source);
  // Keep the pseudo-element on the selected subject, outside :is/:where.
  // The right-hand fence also prevents a root-relative sibling from leaving
  // the message, while retaining combinators and selector specificity.
  const root=/^(?:(?:html|body|:root)(?=$|[\s>.:#\[])(?:\s*>?\s*(?=html\b|body\b|:root))?)+/i.exec(s);
  if(root){
   const target=host+s.slice(root[0].length),i=pseudoIndex(target);
   return target.slice(0,i)+`:where(${host},${host} *)`+target.slice(i);
  }
  return host+' '+s;
 }
 function targetsShell(selector){
  if(pseudoIndex(selector)<selector.length)return false;
  const root=/^(?:(?:html|body|:root)(?=$|[\s>.:#\[])(?:\s*>?\s*(?=html\b|body\b|:root))?)+/i.exec(selector);
  if(!root)return false;
  let depth=0,quote='';for(const c of selector.slice(root[0].length)){if(quote){if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(!depth&&/[\s>+~]/.test(c))return false;}return true;
 }
 function nestedSelectors(source,parents){
  const parent=parents.length===1?parents[0]:`:is(${parents.join(', ')})`;
  return selectors(source).map(s=>{
   let quote='',brackets=0,value='',found=false;
   for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='\\'){value+=c+(s[++i]||'');continue;}
    if(quote){value+=c;if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;value+=c;continue;}
    if(c==='[')brackets++;else if(c===']')brackets--;
    if(c==='&'&&!brackets){found=true;value+=parent;}else value+=c;
   }
   return found?value:parent+' '+value;
  });
 }
 const gather=(rules,names,family)=>{
  for(const rule of rules){
   if(rule.type===7)names.set(rule.name,family+'_k_'+hash(rule.name).slice(0,16));
   else if(rule.type===5){
    const font=rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g,'');
    names.fonts.set(font,family+'_f_'+hash(font).slice(0,16));
   }else if(rule.cssRules)gather(rule.cssRules,names,family);
  }
 };
 function renderRules(rules,host,diagnostics,names,parents=null,family='mima',layout=[]) {
  const block=(selectors,style)=>selectors.map(s=>{
   const target=scopedSelector(s,host);let body=declarations(style,diagnostics,false,names);
   if(layout&&targetsShell(s)){const safe=document.createElement('span').style;safe.cssText=body;for(const name of [...safe])if(shellProperty.test(name)){safe.removeProperty(name);diagnostics.push({kind:'boundary',name,reason:'生成的根样式不能移动消息外壳；内部定位与可信主题不受此限制'});}body=safe.cssText;}
   else if(layout&&hasLayout(style))layout.push(target);
   return target+'{'+body+'}';
  }).join('\n');
  return [...rules].map(rule=>{
   if(rule.type===1){
    const flat=parents?nestedSelectors(rule.selectorText,parents):selectors(rule.selectorText);
    return (rule.style.length?block(flat,rule.style):'')+
      (rule.cssRules?.length?renderRules(rule.cssRules,host,diagnostics,names,flat,family,layout):'');
   }
   if(rule.type===5)return '@font-face{'+declarations(rule.style,diagnostics,false,names,true)+'}';
   if(rule.type===7)return '@keyframes '+names.get(rule.name)+'{'+[...rule.cssRules].map(f=>f.keyText+'{'+declarations(f.style,diagnostics,false,names)+'}').join('')+'}';
   if(parents&&rule.style&&rule.selectorText===undefined&&!rule.cssRules)return block(parents,rule.style);
   const header=rule.cssText.split('{',1)[0];
   if(rule.cssRules&&/^@(media|supports|container|layer|starting-style)\b/i.test(header)){
    // A named layer cannot re-order the application's named layers.
    const localHeader=/^@layer\s+/.test(header)?header.replace(/(@layer\s+)(\S+)/,(_,before,name)=>before+family+'_'+name):header;
    return localHeader+'{'+renderRules(rule.cssRules,host,diagnostics,names,parents,family,layout)+'}';
   }
   if(/^@layer\s[^{}]+;\s*$/i.test(rule.cssText))return rule.cssText.replace(/(@layer\s+)([^;]+);/,(_,start,list)=>start+list.split(',').map(n=>family+'_'+n.trim()).join(',')+';');
   diagnostics.push({kind:'rule',reason:'规则无法限定在消息范围内',rule:rule.cssText.slice(0,120)});
   return '';
  }).join('\n');
 }
 function cascade(styles) {
  const key=styles.map(item=>item.id+(item.trusted?':trusted':':generated')).join(' ');
  let plan=cascadeCache.get(key);
  if(plan)return plan;
  const id='mima_c_'+hash(key).slice(0,32),host=`[data-mima-display-style="${id}"]`;
  const names=new Map(),diagnostics=styles.flatMap(style=>style.diagnostics),layout=[];
  names.fonts=new Map();
  for(const s of styles)gather(s.rules,names,id);
  const scoped=styles.map(s=>renderRules(s.rules,host,diagnostics,names,null,id,s.trusted?null:layout)).join('\n');
  let css=scoped;
  if(scoped&&typeof window.compileColorModeCss==='function')css=window.compileColorModeCss(scoped);
  plan={id,css,names,diagnostics,layout:[...new Set(layout)],styleCount:styles.length,tag:null,urls:[]};
  cascadeCache.set(key,plan);
  for(const [cacheKey,item] of cascadeCache){if(cascadeCache.size<=96)break;if(!item.tag?.isConnected)cascadeCache.delete(cacheKey);}
  return plan;
 }
 function scopeHost(host,context,{shared=true}={}){
  const {plan}=context;
  if(!context.hosts)context.hosts=new Set();context.hosts.add(host);
  host.setAttribute('data-mima-display-boundary','');
  if(plan.styleCount)host.setAttribute('data-mima-display-style',plan.id);
  else host.removeAttribute('data-mima-display-style');
  guardLayout(host,plan,context.hasInlineLayout);
  if(!shared)return;
  if(mountedHosts.has(host)&&mountedHosts.get(host)!==plan)scheduleGc();
  if(!plan.styleCount){mountedHosts.delete(host);return;}
  mountedHosts.set(host,plan);
  if(!plan.tag?.isConnected){
   const tag=document.createElement('style');
   tag.dataset.mimaDisplaySheet=plan.id;
   plan.urls=[];
   tag.textContent=plan.css.replace(/url\("(data:[^"]+)"\)/gi,(whole,original)=>{
    const url=safeImage(original,[],true,/^(?:data:font\/|data:application\/)/i.test(original));
    if(!url)return whole;
    plan.urls.push(url);return `url("${url}")`;
   });
   document.head.append(tag);plan.tag=tag;
  }
  startGc();
 }
 // Bound only boxes whose geometry came from generated CSS. Theme selectors
 // are never collected here. A normal message and its decorations stay unclipped.
 function restoreLayoutClip(el){const old=layoutClips.get(el);if(!old)return;for(const [name,value,priority]of old)if(value)el.style.setProperty(name,value,priority);else el.style.removeProperty(name);layoutClips.delete(el);}
 function rememberLayout(el){if(!layoutClips.has(el))layoutClips.set(el,['clip-path','transition-property',...flowProperties.map(([name])=>name)].map(name=>[name,el.style.getPropertyValue(name),el.style.getPropertyPriority(name)]));return layoutClips.get(el);}
 function localFrame(el,box,size=null){
  let matrix=new DOMMatrix();for(let node=el;node instanceof Element;node=node.parentElement){const css=getComputedStyle(node);let step=new DOMMatrix(css.transform==='none'?undefined:css.transform);if(css.scale&&css.scale!=='none'){const [x,y=x]=css.scale.split(/\s+/).map(Number);step=new DOMMatrix().scale(x,y).multiply(step);}if(css.rotate&&css.rotate!=='none'&&/^-?[\d.]+deg$/.test(css.rotate))step=new DOMMatrix().rotate(parseFloat(css.rotate)).multiply(step);matrix=step.multiply(matrix);}
  if(Math.abs(matrix.m14)>1e-10||Math.abs(matrix.m24)>1e-10)return null;
  matrix=new DOMMatrix([matrix.a,matrix.b,matrix.c,matrix.d,0,0]);
  // BoundingClientRect already contains all translations (including origins).
  // Keep only the linear part before reconstructing the world-space offset.
  matrix.e=0;matrix.f=0;
  const width=size?.width||el.offsetWidth||box.width,height=size?.height||el.offsetHeight||box.height,corners=[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
  const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y)),maxX=Math.max(...corners.map(p=>p.x)),maxY=Math.max(...corners.map(p=>p.y));
  const sx=(maxX-minX)?box.width/(maxX-minX):1,sy=(maxY-minY)?box.height/(maxY-minY):1;
  return new DOMMatrix([matrix.a*sx,matrix.b*sy,matrix.c*sx,matrix.d*sy,box.left-minX*sx,box.top-minY*sy]);
 }
 function polygonForFrame(world,bounds){
  if(!world)return null;
  if(!world.is2D){if(Math.abs(world.m14)>1e-10||Math.abs(world.m24)>1e-10||!world.m44)return null;world=new DOMMatrix([world.a/world.m44,world.b/world.m44,world.c/world.m44,world.d/world.m44,world.e/world.m44,world.f/world.m44]);}
  const inverse=world.inverse();
  const points=[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.right,bounds.bottom],[bounds.left,bounds.bottom]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(inverse));
  return points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))?'polygon('+points.map(p=>p.x+'px '+p.y+'px').join(',')+')':null;
 }
 function localPolygon(el,box,bounds){return polygonForFrame(localFrame(el,box),bounds);}
 const dirtyGuards=new Set();
 function disposeGuard(host){const guard=layoutGuards.get(host);if(!guard)return;guard.observer?.disconnect();guard.mutations?.disconnect();for(const event of guard.events||[])host.removeEventListener(event,guard.onEvent,true);guard.pseudoTag?.remove();for(const el of guard.targets.keys())restoreLayoutClip(el);guard.targets.clear();guard.animated.clear();guard.animations.clear();guard.viewportTargets.clear();guard.changedRoots.clear();guard.pseudoLocalized.clear();guard.pseudoOwners.clear();dirtyGuards.delete(host);layoutGuards.delete(host);}
 function scheduleLayout(host,retarget=false,frameOnly=false,subset=null){
  if(host?.nodeType===1){const guard=layoutGuards.get(host);if(guard){guard.retarget ||= retarget;if(retarget)guard.fullRetarget=true;if(!frameOnly){guard.frameOnly=false;guard.pendingSubset=subset&&!dirtyGuards.has(host)?subset:null;}dirtyGuards.add(host);}}
  if(!dirtyGuards.size||layoutFrame)return;layoutFrame=requestAnimationFrame(checkLayouts);
 }
 function invalidateLayouts(){for(const [host,guard]of layoutGuards){guard.retryLocalized=true;scheduleLayout(host);}}
 function guardLayout(host,plan,inline){
  if(!plan.layout.length&&!inline&&!layoutGuards.has(host))return;
  let guard=layoutGuards.get(host);
  if(!guard){
   guard={plan,targets:new Map(),animated:new Map(),animations:new Map(),viewportTargets:new Map(),changedRoots:new Set(),pseudoTag:null,pseudoLocalized:new Set(),pseudoOwners:new Map(),retarget:true,fullRetarget:true,retryLocalized:false};layoutGuards.set(host,guard);
   guard.observer=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{if(entries.some(e=>e.target===host))guard.retryLocalized=true;scheduleLayout(host);}):null;guard.observer?.observe(host);
   guard.mutations=new MutationObserver(records=>{
    let changed=false;
    for(const r of records){
     if(r.type==='childList'){changed=true;for(const node of r.addedNodes)if(node.nodeType===1)guard.changedRoots.add(node);}
     else if(r.attributeName!=='style'||r.target.getAttribute('style')!==guard.writes?.get(r.target)){changed=true;guard.changedRoots.add(r.target);}
    }
    if(changed){guard.retarget=true;scheduleLayout(host);}
   });guard.mutations.observe(host,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','open']});
   guard.events=['animationstart','animationend','animationcancel','transitionrun','transitionend','toggle'];guard.onEvent=()=>scheduleLayout(host);for(const event of guard.events)host.addEventListener(event,guard.onEvent,true);
  }else if(guard.plan!==plan){guard.plan=plan;guard.retarget=true;guard.fullRetarget=true;guard.retryLocalized=true;}
  // Compilation can introduce inline targets before the host is attached.
  scheduleLayout(host);startGc();
 }
 // Intervals bound every interpolated 2D transform, not just sampled frames.
 // Unknown composition, overshooting timing or projective transforms remain
 // unproven and keep the existing target-local geometry protection.
 const inertAnimation=new Set(['offset','computedOffset','easing','composite','opacity','color','backgroundColor','boxShadow','textShadow','filter','backdropFilter']);
 const interval=(a,b=a)=>[Math.min(a,b),Math.max(a,b)],plus=(a,b)=>[a[0]+b[0],a[1]+b[1]],times=(a,b)=>{const v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...v),Math.max(...v)];};
 const identityInterval=()=>[interval(1),interval(0),interval(0),interval(1),interval(0),interval(0)];
 function multiplyInterval(a,b){return [plus(times(a[0],b[0]),times(a[2],b[1])),plus(times(a[1],b[0]),times(a[3],b[1])),plus(times(a[0],b[2]),times(a[2],b[3])),plus(times(a[1],b[2]),times(a[3],b[3])),plus(plus(times(a[0],b[4]),times(a[2],b[5])),a[4]),plus(plus(times(a[1],b[4]),times(a[3],b[5])),a[5])];}
 const matrixInterval=m=>[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>interval(v));
 function intervalRect(rect,m){const x=interval(rect.left,rect.right),y=interval(rect.top,rect.bottom),xx=plus(plus(times(m[0],x),times(m[2],y)),m[4]),yy=plus(plus(times(m[1],x),times(m[3],y)),m[5]);return {left:xx[0],right:xx[1],top:yy[0],bottom:yy[1]};}
 function scalar(value,unit='number',reference=0){const m=/^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(px|%|deg|rad|turn|grad)?$/i.exec(String(value).trim());if(!m)return null;const n=Number(m[1]),u=m[2]||'';if(!Number.isFinite(n))return null;if(unit==='length')return u==='%'?n*reference/100:u==='px'||!u&&n===0?n:null;if(unit==='angle')return u==='rad'?n:u==='turn'?n*Math.PI*2:u==='grad'?n*Math.PI/200:u==='deg'||!u&&n===0?n*Math.PI/180:null;return !u?n:u==='%'?n/100:null;}
 function trigRange(range,cos=false){let [a,b]=range;if(b-a>=Math.PI*2)return [-1,1];const values=[cos?Math.cos(a):Math.sin(a),cos?Math.cos(b):Math.sin(b)],step=Math.PI/2;for(let k=Math.ceil(a/step);k*step<=b;k++)values.push(cos?Math.cos(k*step):Math.sin(k*step));return [Math.min(...values),Math.max(...values)];}
 function transformFunctions(value,size){
  if(!value||value==='none')return [];
  const out=[];let end=0;const re=/([a-z][a-z0-9]*)\(([^()]*)\)/gi;let m;
  while(m=re.exec(value)){if(value.slice(end,m.index).trim())return null;end=re.lastIndex;const name=m[1].toLowerCase(),v=m[2].trim().split(/\s*,\s*|\s+/).filter(Boolean);let kind,args;
   if(['translate','translatex','translatey','translate3d'].includes(name)){kind='translate';if(name==='translate3d'&&scalar(v[2],'length',0)!==0)return null;args=[scalar(name==='translatey'?'0':v[0],'length',size.width),scalar(name==='translatex'?'0':name==='translatey'?v[0]:v[1]||'0','length',size.height)];}
   else if(['scale','scalex','scaley','scale3d'].includes(name)){kind='scale';if(name==='scale3d'&&scalar(v[2])!==1)return null;args=[scalar(name==='scaley'?'1':v[0]),scalar(name==='scalex'?'1':name==='scaley'?v[0]:v[1]||v[0])];}
   else if(name==='rotate'||name==='rotatez'){kind='rotate';args=[scalar(v[0],'angle')];}
   else if(name==='matrix'){kind='matrix';args=v.map(x=>scalar(x));if(args.length!==6)return null;}
   else return null;
   if(args.some(x=>x===null))return null;out.push({kind,args,name});
  }return end&&value.slice(end).trim()===''?out:null;
 }
 function transformBound(values,size){
  const lists=values.map(v=>transformFunctions(v,size));if(lists.some(v=>!v))return null;const shape=lists.find(v=>v.length)||[];if(lists.some(v=>v.length&&(v.length!==shape.length||v.some((f,i)=>f.kind!==shape[i].kind||f.name!==shape[i].name))))return null;
  let result=identityInterval();
  for(let i=0;i<shape.length;i++){const kind=shape[i].kind,defaults=kind==='scale'?[1,1]:kind==='matrix'?[1,0,0,1,0,0]:kind==='rotate'?[0]:[0,0],parameters=shape[i].args.map((_,j)=>{const v=lists.map(list=>list.length?list[i].args[j]:defaults[j]);return interval(Math.min(...v),Math.max(...v));});let m=identityInterval();
   if(kind==='translate'){m[4]=parameters[0];m[5]=parameters[1];}
   else if(kind==='scale'){m[0]=parameters[0];m[3]=parameters[1];}
   else if(kind==='rotate'){const sin=trigRange(parameters[0]),cos=trigRange(parameters[0],true);m=[cos,sin,[-sin[1],-sin[0]],cos,interval(0),interval(0)];}
   else {if(lists.length>1&&lists.some(list=>list.length&&(list[i].args[1]!==0||list[i].args[2]!==0||list[i].args[0]<=0||list[i].args[3]<=0)))return null;m=parameters;}
   result=multiplyInterval(result,m);
  }return result;
 }
 function boundedEasing(value){if(!value||/^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(value)||/^steps\(/.test(value))return true;const m=/^cubic-bezier\(([^)]+)\)$/.exec(value);if(!m)return false;const n=m[1].split(',').map(Number);return n.length===4&&n.every(Number.isFinite)&&n[1]>=0&&n[1]<=1&&n[3]>=0&&n[3]<=1;}
 function borderSize(el,css){const number=name=>parseFloat(css[name])||0;let width=parseFloat(css.width),height=parseFloat(css.height);if(css.boxSizing!=='border-box'){width+=number('paddingLeft')+number('paddingRight')+number('borderLeftWidth')+number('borderRightWidth');height+=number('paddingTop')+number('paddingBottom')+number('borderTopWidth')+number('borderBottomWidth');}return {width:Number.isFinite(width)?width:el.offsetWidth,height:Number.isFinite(height)?height:el.offsetHeight};}
 function ownTransform(css,size){if(css.transformBox&&!['view-box','border-box'].includes(css.transformBox)||css.offsetPath&&css.offsetPath!=='none'||css.perspective&&css.perspective!=='none')return null;try{const raw=new DOMMatrix(css.transform==='none'?undefined:css.transform);if(!raw.is2D)return null;const translate=css.translate==='none'?'translate(0px,0px)':'translate('+css.translate.split(/\s+/).join(',')+')',rotate=css.rotate==='none'?'rotate(0deg)':'rotate('+css.rotate.replace(/^z\s+/,'')+')',scale=css.scale==='none'?'scale(1)':'scale('+css.scale.split(/\s+/).join(',')+')',a=transformBound([translate,],size),b=transformBound([rotate],size),c=transformBound([scale],size);if(!a||!b||!c)return null;const asMatrix=m=>new DOMMatrix(m.map(v=>v[0])),[ox=0,oy=0]=css.transformOrigin.split(/\s+/).map(parseFloat);return asMatrix(a).translate(ox,oy).multiply(asMatrix(b)).multiply(asMatrix(c)).multiply(raw).translate(-ox,-oy);}catch(_){return null;}}
 function animatedTransform(css,size,animations){
  const values=new Map();for(const animation of animations){const effect=animation.effect,frames=effect.getKeyframes();if(effect.composite&&effect.composite!=='replace'||effect.iterationComposite==='accumulate'||!boundedEasing(effect.getTiming().easing)||frames.some(f=>!boundedEasing(f.easing)||!['auto','replace',undefined].includes(f.composite)))return null;
   for(const name of new Set(frames.flatMap(f=>Object.keys(f)).filter(k=>!inertAnimation.has(k)))){if(!['transform','translate','scale','rotate'].includes(name)||values.has(name))return null;const rows=frames.filter(f=>f[name]!==undefined);if(rows[0]?.computedOffset!==0||rows.at(-1)?.computedOffset!==1)return null;values.set(name,rows.map(f=>f[name]));}
  }
  const bound=(name,wrap,fallback)=>transformBound((values.get(name)||[fallback]).map(wrap),size);
  const t=bound('translate',v=>v==='none'?'none':'translate('+v.split(/\s+/).join(',')+')',css.translate),r=bound('rotate',v=>v==='none'?'none':'rotate('+v.replace(/^z\s+/,'')+')',css.rotate),sc=bound('scale',v=>v==='none'?'none':'scale('+v.split(/\s+/).join(',')+')',css.scale),tr=bound('transform',v=>v,css.transform);
  if(!t||!r||!sc||!tr)return null;const [ox=0,oy=0]=css.transformOrigin.split(/\s+/).map(parseFloat),origin=x=>matrixInterval(new DOMMatrix().translate(x*ox,x*oy));return multiplyInterval(multiplyInterval(multiplyInterval(multiplyInterval(multiplyInterval(t,origin(1)),r),sc),tr),origin(-1));
 }
 const animationElement=animation=>{const target=animation.effect?.target;return target instanceof Element?target:target?.element;};
 const animationPseudo=animation=>animation.effect?.pseudoElement||animation.effect?.target?.type||'';
 function geometryAnimation(animation){return animation.effect.getKeyframes().some(f=>Object.keys(f).some(k=>!inertAnimation.has(k)));}
 function pseudoGeometry(el,pseudo,host){
  const css=getComputedStyle(el,pseudo);if(css.content==='none'||css.content==='normal'||!['absolute','fixed'].includes(css.position))return null;
  const fixed=css.position==='fixed';let cb=el;
  while(cb){const c=getComputedStyle(cb),fixedBlock=c.transform!=='none'||c.perspective!=='none'||c.filter!=='none'||c.backdropFilter&&c.backdropFilter!=='none'||c.webkitBackdropFilter&&c.webkitBackdropFilter!=='none'||/(?:layout|paint|strict|content)/.test(c.contain)||/(?:transform|perspective|filter)/.test(c.willChange);if(fixedBlock||!fixed&&c.position!=='static'||!fixed&&cb===host)break;cb=cb.parentElement;}
  const zoomOf=node=>{if(!node)return 1;if(Number(node.currentCSSZoom)>0)return Number(node.currentCSSZoom);let z=1;for(let p=node;p;p=p.parentElement)z*=parseFloat(getComputedStyle(p).zoom)||1;return z;};
  if(!Number.isFinite(parseFloat(css.width))||!Number.isFinite(parseFloat(css.height)))return null;
  const relativeZoom=zoomOf(el)/zoomOf(cb),size=borderSize(el,css),frame=cb?localFrame(cb,cb.getBoundingClientRect()):new DOMMatrix(),own=ownTransform(css,size);
  const left=parseFloat(css.left),top=parseFloat(css.top);
  if(!frame||!Number.isFinite(left)||!Number.isFinite(top)||!Number.isFinite(size.width)||!Number.isFinite(size.height))return null;
  const layout=new DOMMatrix().translate((cb?.clientLeft||0)+(left+(parseFloat(css.marginLeft)||0))*relativeZoom,(cb?.clientTop||0)+(top+(parseFloat(css.marginTop)||0))*relativeZoom).scale(relativeZoom);
  const [ox=0,oy=0]=css.transformOrigin.split(/\s+/).map(parseFloat),current=own||new DOMMatrix().translate(ox,oy).multiply(new DOMMatrix(css.transform==='none'?undefined:css.transform)).translate(-ox,-oy);
  return {css,cb,size,layout,own,world:frame.multiply(layout).multiply(current)};
 }
 function envelopeFits(el,host,motions,cache,kinds){
  function data(node){if(cache.has(node))return cache.get(node);const css=getComputedStyle(node),size=borderSize(node,css),box=node.getBoundingClientRect(),frame=localFrame(node,box,size),own=ownTransform(css,size),value={css,size,frame,own};cache.set(node,value);return value;}
  function fits(start,region){
   for(let node=start;node&&node!==host;node=node.parentElement){const d=data(node),parent=node.parentElement;if(!parent||!d.frame||!d.own)return false;const p=data(parent);if(!p.frame)return false;
    const active=(motions.get(node)||[]).filter(a=>!animationPseudo(a)),motion=active.length?animatedTransform(d.css,d.size,active):matrixInterval(d.own);if(!motion)return false;
    region=intervalRect(region,motion);const layout=p.frame.inverse().multiply(d.frame).multiply(d.own.inverse());if(![layout.a,layout.b,layout.c,layout.d,layout.e,layout.f].every(Number.isFinite))return false;region=intervalRect(region,matrixInterval(layout));
   }
   const size=data(host).size;return region.left>=.5&&region.top>=.5&&region.right<=size.width-.5&&region.bottom<=size.height-.5;
  }
  if(el.namespaceURI!=='http://www.w3.org/1999/xhtml')return false;for(let node=host;node;node=node.parentElement)if(!data(node).own)return false;
  for(const kind of kinds){
   if(!kind){const d=data(el);if(!fits(el,{left:0,top:0,right:d.size.width,bottom:d.size.height}))return false;continue;}
   const css=getComputedStyle(el,kind);if(css.content==='none'||css.content==='normal')continue;
   const g=pseudoGeometry(el,kind,host);if(!g||!g.own||!g.cb||g.cb!==host&&!host.contains(g.cb))return false;
   const animations=(motions.get(el)||[]).filter(a=>animationPseudo(a)===kind),motion=animations.length?animatedTransform(g.css,g.size,animations):matrixInterval(g.own);if(!motion)return false;
   const region=intervalRect(intervalRect({left:0,top:0,right:g.size.width,bottom:g.size.height},motion),matrixInterval(g.layout));
   if(!fits(g.cb,region))return false;
  }return true;
 }
 function checkLayouts(){
  layoutFrame=0;const jobs=[...dirtyGuards];dirtyGuards.clear();
  for(const host of jobs){
   const guard=layoutGuards.get(host);if(!guard)continue;
   if(!host.isConnected){disposeGuard(host);continue;}
   if(guard.retarget){
    const relational=guard.plan.layout.some(selector=>/:has\(|:nth-|:(?:first|last|only|empty)|[+~]/.test(selector));
    const roots=guard.fullRetarget||relational?[host]:[...guard.changedRoots].filter(el=>host.contains(el));
    const targets=guard.fullRetarget||relational?new Map():new Map(guard.targets);
    for(const el of targets.keys())if(!host.contains(el)||roots.some(root=>root===el||root.contains(el)))targets.delete(el);
    for(const root of roots){
     for(const selector of guard.plan.layout||[]){const match=selector.match(/(::?(?:before|after))$/i),base=match?selector.slice(0,-match[0].length):selector;try{for(const el of [...(root.matches(base)?[root]:[]),...root.querySelectorAll(base)]){if(!targets.has(el))targets.set(el,new Set());targets.get(el).add(match?'::'+match[1].replace(/^:+/,''):'');}}catch(_){} }
     for(const el of [...(root.hasAttribute('style')?[root]:[]),...root.querySelectorAll('[style]')])if(inlineLayout.has(el)){if(!targets.has(el))targets.set(el,new Set());targets.get(el).add('');}
    }
    for(const el of guard.targets.keys())if(!targets.has(el)){restoreLayoutClip(el);guard.observer?.unobserve(el);}
    for(const el of targets.keys())if(!guard.targets.has(el))guard.observer?.observe(el);
    guard.targets=targets;guard.retarget=false;guard.fullRetarget=false;guard.changedRoots.clear();guard.frameOnly=false;guard.pendingSubset=null;
    guard.viewportTargets=new Map();const positions=new Map();for(const [el,kinds]of targets){let tracks=[...kinds].some(kind=>/^(fixed|sticky)$/.test(getComputedStyle(el,kind||null).position));for(let parent=el.parentElement;!tracks&&parent&&parent!==host;parent=parent.parentElement){if(!positions.has(parent))positions.set(parent,getComputedStyle(parent).position);tracks=/^(fixed|sticky)$/.test(positions.get(parent));}if(tracks)guard.viewportTargets.set(el,kinds);}
   }
   if(guard.retryLocalized){
    for(const el of guard.targets.keys())if(layoutClips.get(el)?.localized)restoreLayoutClip(el);
    if(guard.pseudoLocalized.size&&guard.pseudoTag){for(const key of guard.pseudoLocalized)guard.pseudoRules?.delete(key);guard.pseudoLocalized.clear();guard.pseudoTag.textContent='@layer mima_display_boundaries{'+[...guard.pseudoRules.values()].join('\n')+'}';}
    guard.retryLocalized=false;
   }
   const bounds=host.getBoundingClientRect();if(!bounds.width||!bounds.height)continue;
   const targets=guard.frameOnly?guard.animated:guard.pendingSubset||guard.targets,reads=[],pseudoRules=new Map(guard.pseudoRules);
   // Read geometry before changing any clipping styles. clip-path does not
   // change the measured boxes, so no per-frame sheet toggle is necessary.
   for(const [el,kinds]of targets)if(el.isConnected){const box=el.getBoundingClientRect();reads.push({el,kinds,box});}
   const writes=[];
   for(const {el,kinds,box}of reads){
    if(kinds.has('')){
     const outside=box.left<bounds.left-.5||box.top<bounds.top-.5||box.right>bounds.right+.5||box.bottom>bounds.bottom+.5;
     const polygon=outside?localPolygon(el,box,bounds):null;
     writes.push(()=>{if(outside){const record=rememberLayout(el);if(polygon&&record.polygon!==polygon){el.style.setProperty('transition-property','none','important');el.style.setProperty('clip-path',polygon,'important');record.polygon=polygon;}else if(!polygon){for(const [name,value]of flowProperties)el.style.setProperty(name,value,'important');el.style.setProperty('clip-path','inset(0)','important');record.localized=true;}}else if(!layoutClips.get(el)?.localized)restoreLayoutClip(el);});
    }
    for(const pseudo of kinds)if(pseudo){
     const key=(el.dataset.mimaLayoutGuard||'')+pseudo;if(guard.pseudoLocalized.has(key)&&pseudoRules.has(key))continue;pseudoRules.delete(key);
     const g=pseudoGeometry(el,pseudo,host);if(!g)continue;
     const {world,size}=g,polygon=polygonForFrame(world,bounds);
     const corners=[[0,0],[size.width,0],[size.width,size.height],[0,size.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(world)).map(p=>({x:p.x/p.w,y:p.y/p.w}));if(corners.every(p=>p.x>=bounds.left&&p.y>=bounds.top&&p.x<=bounds.right&&p.y<=bounds.bottom))continue;
     if(!el.dataset.mimaLayoutGuard)el.dataset.mimaLayoutGuard=String(++layoutSerial);
     const own='[data-mima-layout-guard="'+el.dataset.mimaLayoutGuard+'"]'+pseudo;
     const ownedKey=el.dataset.mimaLayoutGuard+pseudo;guard.pseudoOwners.set(ownedKey,el);if(!polygon)guard.pseudoLocalized.add(ownedKey);
     pseudoRules.set(ownedKey,own+'{'+(polygon?'clip-path:'+polygon+'!important;transition-property:none!important':flowProperties.map(([name,value])=>name+':'+value+'!important').join(';')+';clip-path:inset(0)!important;transition-property:none!important')+'}');
    }
   }
   if(!guard.frameOnly){
    guard.animated=new Map();guard.animations=new Map();const motions=new Map(),cache=new Map();
    for(const animation of host.getAnimations?.({subtree:true})||[]){const el=animationElement(animation);if(el&&animation.playState==='running'&&geometryAnimation(animation)){if(!motions.has(el))motions.set(el,[]);motions.get(el).push(animation);}}
    // Include generated descendants of animated ancestors. A safe ancestor box
    // alone is not a proof for an absolutely positioned child outside that box.
    for(const read of reads){const related=[];for(let node=read.el;node&&node!==host;node=node.parentElement)related.push(...(motions.get(node)||[]));if(!related.length)continue;
     if(!envelopeFits(read.el,host,motions,cache,read.kinds)){guard.animated.set(read.el,read.kinds);guard.animations.set(read.el,related);}
    }
   }
   guard.pendingSubset=null;guard.writes=new WeakMap();for(const write of writes)write();for(const {el}of reads)guard.writes.set(el,el.getAttribute('style'));
   for(const key of pseudoRules.keys())if(!host.contains(guard.pseudoOwners.get(key))||!guard.targets.has(guard.pseudoOwners.get(key))){pseudoRules.delete(key);guard.pseudoLocalized.delete(key);guard.pseudoOwners.delete(key);}
   const pseudoCss=pseudoRules.size?'@layer mima_display_boundaries{'+[...pseudoRules.values()].join('\n')+'}':'';guard.pseudoRules=pseudoRules;
   if(pseudoRules.size&&!guard.pseudoTag){guard.pseudoTag=document.createElement('style');guard.pseudoTag.dataset.mimaDisplayGuard='';document.head.append(guard.pseudoTag);}if(guard.pseudoTag&&guard.pseudoTag.textContent!==pseudoCss)guard.pseudoTag.textContent=pseudoCss;
   for(const el of guard.animated.keys())if(!guard.animations.get(el)?.some(a=>a.playState==='running')){guard.animated.delete(el);guard.animations.delete(el);}
   if(guard.animated.size){guard.frameOnly=true;scheduleLayout(host,false,true);}else guard.frameOnly=false;
  }
 }
 // Invalidate proven envelopes on appearance/rule changes without polling.
 // Compiler sheets and the guard's own pseudo writes already have explicit
 // plan lifecycles and must not schedule a feedback loop.
 const ownSheet=node=>node?.nodeType===1&&node.matches?.('[data-mima-display-sheet],[data-mima-display-guard],[data-mima-display-boundary-layer],#mima-theme-canvas-source');
 const styleNode=node=>node?.nodeType===1&&node.matches?.('style,link[rel="stylesheet"]');
 if(document.head)new MutationObserver(records=>{if(records.some(r=>{const tag=r.target.nodeType===1?r.target:r.target.parentElement;if(ownSheet(tag))return false;return r.type==='childList'&&tag===document.head?[...r.addedNodes,...r.removedNodes].some(node=>styleNode(node)&&!ownSheet(node)):styleNode(tag);}))invalidateLayouts();}).observe(document.head,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','media']});
 function appearanceStyle(value){const probe=document.createElement('span').style;probe.cssText=value||'';return [...probe].filter(name=>!/^--mima-(?:viewport|composer|keyboard|input|editor)-/.test(name)).map(name=>name+':'+probe.getPropertyValue(name)+'!'+probe.getPropertyPriority(name)).join(';');}
 const appearanceChanges=new MutationObserver(records=>{if(records.some(r=>r.attributeName!=='style'||appearanceStyle(r.oldValue)!==appearanceStyle(r.target.getAttribute('style'))))invalidateLayouts();});for(const node of [document.documentElement,document.body])if(node)appearanceChanges.observe(node,{attributes:true,attributeOldValue:true,attributeFilter:['style','class','data-theme','data-color-mode','data-mima-theme']});
 window.addEventListener('resize',invalidateLayouts);document.addEventListener('mima-density-change',invalidateLayouts);document.fonts?.addEventListener('loadingdone',invalidateLayouts);document.addEventListener?.('scroll',event=>{for(const [host,guard]of layoutGuards){if(event.target?.nodeType===1&&host.contains(event.target))scheduleLayout(host);else if(guard.viewportTargets.size)scheduleLayout(host,false,false,guard.viewportTargets);}},true);
 function scheduleGc(){
  if(gcFrame)return;
  gcFrame=requestAnimationFrame(()=>{
   gcFrame=0;const inUse=new Set();
   for(const host of layoutGuards.keys())if(!host.isConnected)disposeGuard(host);
   for(const [host,plan] of mountedHosts){if(!host.isConnected||host.dataset.mimaDisplayStyle!==plan.id)mountedHosts.delete(host);else inUse.add(plan);}
   const liveUrls=new Set();
   for(const plan of cascadeCache.values())if(plan.tag?.isConnected){
    if(!inUse.has(plan)){plan.tag.remove();plan.tag=null;plan.urls=[];}
    else for(const url of plan.urls)liveUrls.add(url);
   }
   for(const el of document.querySelectorAll('[data-mima-display-boundary] img[src^="blob:"]'))liveUrls.add(el.src);
   for(const el of document.querySelectorAll('[data-mima-display-boundary] [style*="blob:"]'))for(const m of el.style.cssText.matchAll(/blob:[^"\s)]+/g))liveUrls.add(m[0]);
   for(const [key,item] of images)if(!liveUrls.has(item.url)){URL.revokeObjectURL(item.url);ownedUrls.delete(item.url);images.delete(key);}
  });
 }
 function startGc(){
  if(observer||!document.body)return;
  observer=new MutationObserver(records=>{if(records.some(r=>r.removedNodes.length))scheduleGc();});
  observer.observe(document.body,{childList:true,subtree:true});
 }
 function parseFragment(html,options={}) {
  const template=document.createElement('template');template.innerHTML=String(html??'');
  const styles=[],diagnostics=[],local=options.resources;
  for(const el of template.content.querySelectorAll('style,mima-style')){
   if(el.localName==='style'){
    const media=el.getAttribute('media');
    const safeMedia=media?window.matchMedia(media).media:'';
    styles.push(parseSource(safeMedia?'@media '+safeMedia+'{'+el.textContent+'}':el.textContent));
   }
   else {
    const id=el.getAttribute('data-ref');
    const row=local instanceof Map?local.get(id):local?local.find(r=>r.id===id):registry.get(id);
    if(row)styles.push(parseSource(row.css,'s_'+id.slice(6)));
    else diagnostics.push({kind:'resource',code:'E_DISPLAY_STYLE_MISSING',reason:'固定样式不可用：'+(id||'缺少标识')});
   }
   el.remove();
  }
  return {fragment:template.content,styles,diagnostics};
 }
 function createContext(parts,previous=[]){
  const ordered=[...previous,...parts.flatMap(part=>part.styles)];
  // Repeated stylesheets use the same cascade, in the order of their last use.
  const unique=new Map();for(const item of ordered){const key=item.id+':'+!!item.trusted;unique.delete(key);unique.set(key,item);}
  const styles=[...unique.values()],plan=cascade(styles);
  return {styles,plan,diagnostics:[...parts.flatMap(part=>part.diagnostics),...plan.diagnostics]};
 }
 function cleanFragment(part,scope,context,{shared=false,sourceIds=false}={}){
  if(!/^[\w-]{1,80}$/.test(scope))throw fail('E_HTML_SCOPE_INVALID','消息样式作用域无效');
  const {fragment}=part,diagnostics=context.diagnostics,names=context.plan.names;
  for(const el of fragment.querySelectorAll('*')){
   if(!fragment.contains(el))continue;
   if(blocked.has(el.tagName)){diagnostics.push({kind:'element',name:el.tagName,reason:'含执行或表单元素'});el.remove();continue;}
   if(!allowed.has(el.tagName)){diagnostics.push({kind:'element',name:el.tagName,reason:'未知展示元素，保留文字'});el.replaceWith(...el.childNodes);continue;}
   for(const attr of [...el.attributes]){
    const n=attr.name.toLowerCase(),v=attr.value;
    if(n==='id'){el.dataset.mimaDisplayId=v;el.id=sourceIds?v:scopeId(scope,v);continue;}
    if(n==='style'){auditSource(v,[],diagnostics,true,false,false);if(hasLayout(el.style)){inlineLayout.add(el);context.hasInlineLayout=true;}if(/(?:^|;)\s*(?:animation|font)(?:-|\s*:)/i.test(v))inlineSources.set(el,v);const clean=declarations(el.style,diagnostics,shared,names);clean?el.setAttribute('style',clean):el.removeAttribute('style');continue;}
    if(n==='src'&&el.tagName==='IMG'){const safe=safeImage(v,diagnostics,shared);safe?el.setAttribute('src',safe):el.removeAttribute('src');continue;}
    if(n==='href'&&el.tagName==='A'&&v.startsWith('#')){if(!sourceIds)el.setAttribute('href','#'+scopeId(scope,v.slice(1)));continue;}
    if(n==='aria-labelledby'||n==='aria-describedby'){if(!sourceIds)el.setAttribute(n,v.split(/\s+/).map(id=>scopeId(scope,id)).join(' '));continue;}
    if(/^on/i.test(n)||/^data-(?:mima-|novel-action|r19-|compat-action)/i.test(n)||
      !(/^(?:class|title|role|open|colspan|rowspan|scope|value|max|min|low|high|optimum|alt|width|height|loading|decoding)$/.test(n)||n.startsWith('data-')||n.startsWith('aria-'))){
     el.removeAttribute(n);
    }
   }
   if(el.tagName==='IMG'){el.loading='lazy';el.decoding='async';}
  }
  if(shared)startGc();
  if(context.hasInlineLayout)for(const host of context.hosts||[])guardLayout(host,context.plan,true);
  Object.defineProperty(fragment,'mimaDiagnostics',{value:diagnostics});
  return fragment;
 }
 function compile(html,scope,options={}){
  const part=parseFragment(html,options),context=createContext([part]);
  const frag=cleanFragment(part,scope,context,options);
  if(options.host)scopeHost(options.host,context,options);
  return frag;
 }
 function inspectionHtml(html,scope='mima_inspection',options={}){
  const fragment=compile(html,scope,{...options,shared:false,sourceIds:true});
  const t=document.createElement('template');t.content.append(fragment);
  return {html:t.innerHTML,diagnostics:fragment.mimaDiagnostics};
 }
 function css(raw,scope){
  const source=parseSource(raw),plan=cascade([source]);
  return plan.css.replaceAll(`[data-mima-display-style="${plan.id}"]`,`[data-mima-html-scope="${scope}"]`);
 }
 window.addEventListener('pagehide',event=>{
  if(event.persisted)return;
  for(const image of images.values())URL.revokeObjectURL(image.url);
  images.clear();ownedUrls.clear();
 });
 window.MimaStoryDisplay={compile,inspectionHtml,compileCss:css,parseFragment,createContext,cleanFragment,scopeHost,
  forWindow(target){if(target===window)return window.MimaStoryDisplay;if(!instances.has(target)){createStoryDisplay(target);instances.set(target,target.MimaStoryDisplay);}return instances.get(target);},
  layoutStats:()=>({hosts:layoutGuards.size,targets:[...layoutGuards.values()].reduce((n,g)=>n+g.targets.size,0),animated:[...layoutGuards.values()].reduce((n,g)=>n+g.animated.size,0)}),
  refreshInlineNames(host,context){
   for(const el of host.querySelectorAll('[style]')){
    const original=inlineSources.get(el);if(!original)continue;
    const source=document.createElement('span');source.style.cssText=original;
    el.style.cssText=declarations(source.style,context.diagnostics,true,context.plan.names);
   }
  },
  transferInlineSource(old,next,deep=false){
   if(inlineLayout.has(next))inlineLayout.add(old);else inlineLayout.delete(old);layoutClips.delete(old);
   const original=inlineSources.get(next);
   if(original!==undefined)inlineSources.set(old,original);
   else inlineSources.delete(old);
   if(deep&&next.childElementCount){
    const a=old.querySelectorAll('[style]'),b=next.querySelectorAll('[style]');
    for(let i=0;i<b.length;i++)this.transferInlineSource(a[i],b[i]);
   }
  },
  clearHost(host){disposeGuard(host);host.removeAttribute('data-mima-display-style');host.removeAttribute('data-mima-display-boundary');mountedHosts.delete(host);scheduleGc();},
  registerResources,resourceIssues:()=>issues,inspectPack,preparePack,hash};
})(window);
