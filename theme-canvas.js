/* The effective appearance owns the root canvas. Keyboard geometry has no lease. */
(() => {'use strict';
 const root=document.documentElement,body=document.body;
 const themeIds=new Set(['mima-global-css-style','mima-atelier-runtime-style']);
 const fields=['image','color','size','position','repeat','attachment','origin','clip','blend-mode'];
 const stats={syncs:0,styleReads:0,catalogBuilds:0,animationBuilds:0,geometryUpdates:0};let dirty=true,stylesDirty=true,frame=0,geometryFrame=0,backing=null,surface=null,grouped=false,lastPaint='';
 const dependencies={root:new Set(),body:new Set()},attributeDependencies=new Set(),variableDependencies=new Set();let broadClassDependency=false,paintSelectors=[],lastMatches='',colorDependency=false,probeHost=null,probeSelectors=[];
 const probeObserver=new ResizeObserver(()=>{if(matchesKey()!==lastMatches){dirty=true;schedule();}});
 const geometryOf=new WeakMap(),sheetCache=new WeakMap(),invalidSheets=new WeakSet();let cachedCss='';
 const proxies=new Map();
 const ignoredClass=/^mima-(?:keyboard-|composer-keyboard$|settings-paint-guard$|editor-open$|atl-editing$)/;
 const styleOf=(el,pseudo)=>{stats.styleReads++;return getComputedStyle(el,pseudo);};
 function layers(value,delimiter=','){const out=[];let at=0,depth=0,quote='';for(let i=0;i<value.length;i++){const c=value[i];if(c==='\\'){i++;continue;}if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if('([{'.includes(c))depth++;else if(')]}'.includes(c))depth--;else if(c===delimiter&&!depth){out.push(value.slice(at,i).trim());at=i+1;}}out.push(value.slice(at).trim());return out;}
 function authoredBackground(target){
  if([...target.style].some(n=>/^background(?:-|$)/.test(n)))return true;
  function walk(rules){for(const rule of rules){if(rule.type===4&&!matchMedia(rule.conditionText).matches)continue;if(rule.type===12&&!CSS.supports(rule.conditionText))continue;if(rule.style&&[...rule.style].some(n=>/^background(?:-|$)/.test(n)))try{if(target.matches(rule.selectorText))return true;}catch(_){}if(rule.cssRules&&walk(rule.cssRules))return true;}return false;}
  for(const id of themeIds){const tag=document.getElementById(id);if(!tag?.sheet||tag.sheet.disabled||tag.media&&!matchMedia(tag.media).matches)continue;try{if(walk(tag.sheet.cssRules))return true;}catch(_){} }return false;
 }
 // CSSOM serialization can erase a var() shorthand when another longhand
 // overrides part of it. Recover only these incomplete rules from mounted text,
 // then overlay nonempty live CSSOM edits (including explicit removals).
 const rawCache=new WeakMap();
 const normalHeader=value=>value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,' ').replace(/\s*([:,>+~=])\s*/g,'$1').trim();
 function rawCatalog(node){const text=node.textContent,cached=rawCache.get(node);if(cached?.text===text)return cached.map;const map=new Map();
  function scan(src,parents=[]){let start=0,quote='',comment=false,round=0,square=0;for(let i=0;i<src.length;i++){const c=src[i],n=src[i+1];if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}if(c==='/'&&n==='*'){comment=true;i++;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='(')round++;else if(c===')')round--;else if(c==='[')square++;else if(c===']')square--;if(round||square)continue;if(c===';'){start=i+1;continue;}if(c!=='{')continue;
    const end=findMatchingBrace(src,i);if(end<0)break;const header=normalHeader(src.slice(start,i)),body=src.slice(i+1,end),path=[...parents,header];map.set(path.join('\n'),body);if(!/^--/.test(header))scan(body,path);i=end;start=end+1;
  }}scan(text);rawCache.set(node,{text,map});return map;
 }
 function restoredStyle(rule){const style=rule.style,current=style?.cssText||'';if(!/(?:^|;)\s*[\w-]+\s*:\s*(?:!important\s*)?(?:;|$)/.test(current))return current;
  const node=rule.parentStyleSheet?.ownerNode;if(!node||node.tagName!=='STYLE')return current;const path=[];for(let row=rule;row;row=row.parentRule){const header=row.selectorText||row.keyText||row.cssText.slice(0,row.cssText.indexOf('{'));path.unshift(normalHeader(header));}
  const raw=rawCatalog(node).get(path.join('\n'));if(raw===undefined)return current;
  const probe=document.createElement('div').style;probe.cssText=raw;const keys=new Set([...style]),removed=[...probe].filter(n=>!keys.has(n)).map(n=>n+':initial;').join('');
  const live=layers(current,';').filter(part=>{const values=layers(part,':');return values.length>1&&values.slice(1).join(':').trim()!=='';}).join(';');return raw+';'+live+';'+removed;
 }
 function serializeRule(rule){if(rule.style){const text=restoredStyle(rule);if(rule.selectorText&&rule.cssRules?.length)return rule.selectorText+'{'+text+';'+[...rule.cssRules].map(serializeRule).join('\n')+'}';if(text!==rule.style.cssText){const header=rule.selectorText||rule.keyText||rule.cssText.slice(0,rule.cssText.indexOf('{'));return header+'{'+text+'}';}return rule.cssText;}if(rule.cssRules)return rule.cssText.slice(0,rule.cssText.indexOf('{'))+'{'+[...rule.cssRules].map(serializeRule).join('\n')+'}';return rule.cssText;}
 const sourceTag=document.createElement('style');sourceTag.id='mima-theme-canvas-source';document.head.append(sourceTag);
 const mediaQueries=new Map();let backgroundAnimations=[];
 let inlineBackground='',probeCss='',catalogSelectors=[],catalogVariables=new Set(),catalogColor=false,dependenciesDirty=false;
 const refs=value=>[...String(value).matchAll(/var\(\s*(--[\w-]+)/g)].map(m=>m[1]);
 function sourceRules(){
  if(!stylesDirty){if(dependenciesDirty)refreshDependencies();updateInline();return;}stylesDirty=false;stats.catalogBuilds++;
  dependencies.root.clear();dependencies.body.clear();attributeDependencies.clear();variableDependencies.clear();broadClassDependency=false;colorDependency=false;
  const usedMedia=new Set();let entry;
  const declarations=(style,pseudo=false,rule=null)=>{const selected=layers(rule?restoredStyle(rule):style.cssText,';').filter(part=>{const n=layers(part,':')[0].trim().toLowerCase();return /^background(?:-|$)/.test(n)||pseudo&&n.startsWith('--')||pseudo&&/^(?:color$|font(?:-|$)|animation(?:-|$)|transition(?:-|$)|opacity$|filter$|transform(?:-|$)|translate$|rotate$|scale$|perspective(?:-|$)|offset(?:-|$)|mix-blend-mode$|isolation$|contain$|zoom$|z-index$|will-change$|position$|inset(?:-|$)|top$|bottom$|left$|right$|width$|height$|min-|max-|margin(?:-|$)|padding(?:-|$)|box-sizing$)/.test(n);});return selected.length?selected.join(';')+';':'';};
  function capture(selector,text,pseudoText,pseudo,style){
   const names=[...style],context=names.some(name=>/^(?:animation(?:-|$)|opacity|isolation|filter|backdrop-filter|transform|translate|rotate|scale|perspective|contain|position|z-index|zoom|will-change)$/.test(name));
   const values=layers(style.cssText,';').map(part=>{const colon=part.indexOf(':');return [part.slice(0,colon).trim(),part.slice(colon+1)];}).filter(([name])=>name==='color'||name.startsWith('--'));
   entry.selectors.push({selector,background:!!text,pseudo:!!pseudo,context,contract:names.some(name=>name.startsWith('--mima-keyboard-root-')),values,color:names.includes('color')});
   if(/\bcurrentColor\b/i.test(text+(pseudo?pseudoText:'')))entry.currentColor=true;
   const bodyAt=selector.lastIndexOf('body'),rootAt=Math.max(selector.lastIndexOf('html'),selector.lastIndexOf(':root'));
   const add=(target,text)=>{for(const m of text.matchAll(/\.([\w-]+)/g))entry[target].add(m[1]);};
   if(bodyAt>=0){add('root',selector.slice(0,bodyAt));add('body',selector.slice(bodyAt));}
   else if(rootAt>=0)add('root',selector);else{add('root',selector);add('body',selector);}
   for(const m of selector.matchAll(/\[([\w-]+)/g))entry.attributes.add(m[1]);
   if(/\[class(?:[~|^$*]?=|\])|:has\(/.test(selector))entry.broad=true;
  }
  function possible(selector){
   let last='',depth=0,square=0,quote='',compounds=0;
   for(let i=0;i<selector.length;i++){const c=selector[i];if(quote){last+=c;if(c==='\\')last+=selector[++i]||'';else if(c===quote)quote='';continue;}if(c==='"'||c==="'")quote=c;if(c==='(')depth++;else if(c===')')depth--;else if(c==='[')square++;else if(c===']')square--;
    if(!depth&&!square&&/[>+~\s]/.test(c)){if(last.trim()){compounds++;last='';}}else last+=c;
   }
   return /^(?:body|html)(?=[.#[:]|$)|^:root|^:(?:is|where)\([^)]*(?:body|html|:root)/.test(last)||!compounds&&!/^[a-z][\w-]*/i.test(last);
  }


  function potential(selector){let out='';for(let i=0;i<selector.length;i++){if(selector[i]!==':'){out+=selector[i];continue;}const m=/^:([\w-]+)/.exec(selector.slice(i));if(!m){out+=selector[i];continue;}if(['root','scope'].includes(m[1])){out+=m[0];i+=m[0].length-1;continue;}i+=m[0].length-1;if(selector[i+1]==='('){let depth=1,quote='';i+=2;for(;i<selector.length&&depth;i++){const c=selector[i];if(c==='\\'){i++;continue;}if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='(')depth++;else if(c===')')depth--;}i--;}}return out.trim()||'*';}
  function walk(rules,parent=''){let out='';for(const rule of rules){
   if(rule.type===3&&rule.styleSheet){try{let inner=walk(rule.styleSheet.cssRules,parent);if(rule.media?.mediaText)inner='@media '+rule.media.mediaText+'{'+inner+'}';if(rule.layerName!==undefined&&rule.layerName!==null)inner='@layer '+rule.layerName+'{'+inner+'}';out+=inner;}catch(_){}continue;}
   if(rule.cssRules&&!rule.style){if(rule.name==='mima-theme-canvas')continue;const inner=walk(rule.cssRules,parent);if(inner){const prefix=rule.cssText.slice(0,rule.cssText.indexOf('{'));out+=prefix+'{'+inner+'}';if(rule.type===4){usedMedia.add(rule.conditionText);entry.media.add(rule.conditionText);if(!mediaQueries.has(rule.conditionText)){const q=matchMedia(rule.conditionText),fn=()=>{dirty=true;schedule();};q.addEventListener?.('change',fn);mediaQueries.set(rule.conditionText,{q,fn});}}}continue;}
   if(!rule.style||!rule.selectorText)continue;const selectors=layers(rule.selectorText).map(x=>parent?x.includes('&')?x.replaceAll('&',':is('+parent+')'):':is('+parent+') '+x:x),text=declarations(rule.style,false,rule),pseudoText=declarations(rule.style,true,rule);
   if(text||pseudoText||/::?(?:before|after)/.test(rule.selectorText)&&[...rule.style].some(name=>['display','visibility','content'].includes(name)))for(const selector of selectors){const pseudo=/::?(before|after)\s*$/.exec(selector),base=pseudo?selector.slice(0,pseudo.index):selector;try{if(!possible(base)&&!body.matches(base)&&!body.matches(potential(base)))continue;}catch(_){continue;}
    capture(base,text,pseudoText,pseudo,rule.style);for(const m of (text+(pseudo||[...rule.style].some(name=>/^(?:animation(?:-|$)|opacity|isolation|filter|transform|translate|rotate|scale|perspective|contain|position|zoom)$/.test(name))?pseudoText:'')).matchAll(/var\(\s*(--[\w-]+)/g))entry.variables.add(m[1]);
    const suffix=pseudo?'>:where(#mima-keyboard-theme-underlay)>:where(.mima-theme-canvas-pseudo-plane)>div:where([data-mima-canvas-pseudo="'+pseudo[1]+'"])':'>:where(#mima-keyboard-theme-underlay) > :where(.mima-theme-canvas-surface)';
    if(pseudo?pseudoText:text)out+=':is('+base+')'+suffix+'{'+(pseudo?pseudoText:text)+'}';
   }
   if(rule.cssRules?.length)out+=walk(rule.cssRules,selectors.join(','));
  }return out;}
  const selected=[];let css='';for(const sheet of document.styleSheets){if(sheet.disabled||sheet.ownerNode===sourceTag||sheet.ownerNode?.matches?.('[data-mima-display-sheet],[data-mima-display-guard],[data-mima-display-boundary-layer]')||themeIds.has(sheet.ownerNode?.id)&&sheet.media?.mediaText&&!matchMedia(sheet.media.mediaText).matches)continue;
   entry=sheetCache.get(sheet);
   if(!entry||invalidSheets.has(sheet)){entry={root:new Set(),body:new Set(),attributes:new Set(),variables:new Set(),media:new Set(),broad:false,currentColor:false,text:'',selectors:[]};try{entry.text=walk(sheet.cssRules);}catch(error){if(error.name!=='SecurityError')throw error;}sheetCache.set(sheet,entry);invalidSheets.delete(sheet);}
   selected.push(...entry.selectors);for(const name of entry.root)dependencies.root.add(name);for(const name of entry.body)dependencies.body.add(name);for(const name of entry.attributes)attributeDependencies.add(name);for(const name of entry.variables)variableDependencies.add(name);broadClassDependency ||= entry.broad;colorDependency ||= entry.currentColor;
   for(const condition of entry.media){usedMedia.add(condition);if(!mediaQueries.has(condition)){const q=matchMedia(condition),fn=()=>{dirty=true;schedule();};q.addEventListener?.('change',fn);mediaQueries.set(condition,{q,fn});}}
   css+=sheet.media?.mediaText?'@media '+sheet.media.mediaText+'{'+entry.text+'}':entry.text;
  }
  // Follow only the references reachable from actual paint declarations. CSS
  // still resolves values, fallbacks, importance and inheritance itself.
  catalogSelectors=selected;catalogVariables=new Set(variableDependencies);catalogColor=colorDependency;
  refreshDependencies();
  cachedCss=css;updateInline();
  for(const [key,{q,fn}]of mediaQueries)if(!usedMedia.has(key)){q.removeEventListener?.('change',fn);mediaQueries.delete(key);}
 }
 function refreshDependencies(){
  dependenciesDirty=false;
  variableDependencies.clear();for(const name of catalogVariables)variableDependencies.add(name);colorDependency=catalogColor;
  const inline=[root,body].flatMap(el=>[...el.style].map(name=>[name,el.style.getPropertyValue(name)]));
  const values=[...catalogSelectors.flatMap(row=>row.values),...inline.filter(([name])=>name==='color'||name.startsWith('--'))];
  function add(value){for(const name of refs(value))variableDependencies.add(name);if(/\bcurrentColor\b/i.test(value))colorDependency=true;}
  for(const [name,value]of inline)if(/^background(?:-|$)|^--mima-keyboard-root-/.test(name))add(value);
  for(const row of catalogSelectors)for(const [name,value]of row.values)if(name.startsWith('--mima-keyboard-root-'))add(value);
  let previous;do{previous=variableDependencies.size+Number(colorDependency);for(const [name,value]of values)if(variableDependencies.has(name)||colorDependency&&name==='color')add(value);}while(previous!==variableDependencies.size+Number(colorDependency));
  paintSelectors=catalogSelectors.filter(row=>row.background||row.pseudo||row.contract||row.context||colorDependency&&row.color||row.values.some(([name])=>variableDependencies.has(name)));
  lastMatches=matchesKey();
  updateProbes();
 }
 // Native selector invalidation, including descendant changes, drives tiny
 // layout probes. No observer or scan of the story subtree is installed.
 function updateProbes(){
  const selectors=[...new Set(paintSelectors.map(row=>row.selector).filter(selector=>/:has\(/i.test(selector)))];
  if(selectors.length===probeSelectors.length&&selectors.every((v,i)=>v===probeSelectors[i]))return;
  probeSelectors=selectors;probeObserver.disconnect();probeHost?.remove();probeHost=null;probeCss='';
  if(!selectors.length)return;
  probeHost=document.createElement('mima-canvas-dependency-probes');probeHost.setAttribute('aria-hidden','true');
  probeHost.style.cssText='all:initial!important;display:block!important;position:fixed!important;inset:0 auto auto 0!important;width:0!important;height:0!important;contain:strict!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important';
  selectors.forEach((selector,i)=>{
   const probe=document.createElement('mima-canvas-dependency-probe');probe.dataset.mimaCanvasProbe=String(i);
   probe.style.cssText='all:initial!important;display:block!important;position:absolute!important;box-sizing:content-box!important;width:var(--mima-canvas-probe-w,1px)!important;height:var(--mima-canvas-probe-h,1px)!important';
   probeHost.append(probe);
   const tail='>:where(mima-canvas-dependency-probes)>:where([data-mima-canvas-probe="'+i+'"])';
   probeCss+=':is('+selector+')'+tail+'{--mima-canvas-probe-w:2px!important}'+':is('+selector+')>body'+tail+'{--mima-canvas-probe-h:2px!important}';
   probeObserver.observe(probe);
  });
  body.append(probeHost);
 }
 function updateInline(){
  inlineBackground=layers(body.style.cssText,';').filter(part=>/^background(?:-|\s*:)/i.test(layers(part,':')[0].trim()+':')).join(';');
  const css=cachedCss+probeCss+(inlineBackground?'body > :where(#mima-keyboard-theme-underlay) > .mima-theme-canvas-surface{'+inlineBackground+';}':'');
  if(sourceTag.textContent!==css){rawCache.delete(sourceTag);sourceTag.textContent=css;}
 }
 function syncBackgroundAnimations(){
  const next=[];
  if(surface)for(const original of body.getAnimations()){if(original.effect?.target!==body||original.effect?.pseudoElement)continue;const frames=original.effect.getKeyframes();if(!frames.some(f=>Object.keys(f).some(k=>/^background/.test(k))))continue;
   const selected=frames.map(f=>Object.fromEntries(Object.entries(f).filter(([key])=>/^background/.test(key)||['offset','easing','composite'].includes(key))));
   const key=JSON.stringify([selected,original.effect.getTiming()]);let row=backgroundAnimations.find(item=>item.original===original&&item.key===key&&item.target===surface);
   if(!row){const animation=surface.animate(selected,original.effect.getTiming());animation.playbackRate=original.playbackRate;animation.currentTime=original.currentTime;if(original.playState==='paused')animation.pause();row={original,animation,key,target:surface};stats.animationBuilds++;}next.push(row);
  }
  for(const row of backgroundAnimations)if(!next.includes(row))row.animation.cancel();backgroundAnimations=next;
 }
 function reconcileBackground(target,native){
  const actual=styleOf(target);for(const name of fields){const property='background-'+name,expected=native.getPropertyValue(property);if(actual.getPropertyValue(property)!==expected)target.style.setProperty(property,expected);}
 }
 function syncMotion(){body.getAnimations();for(const {original,animation}of backgroundAnimations){if(original.playState==='paused'&&animation.playState!=='paused')animation.pause();else if(original.playState==='running'&&animation.playState==='paused')animation.play();if(original.currentTime!==null)animation.currentTime=original.currentTime;}}
 function ensureBacking(){if(backing?.isConnected)return backing;backing=document.createElement('div');backing.id='mima-keyboard-theme-underlay';backing.setAttribute('aria-hidden','true');body.prepend(backing);return backing;}
 const transparent=color=>/^(?:transparent|rgba\([^)]*,\s*0(?:\.0*)?\))$/.test(color);
 function decorationKind(css,side){
  if(css.display==='none'||css.visibility!=='visible'||Number(css.opacity)===0||!['""',"''"].includes(css.content)||css.backgroundImage==='none'&&transparent(css.backgroundColor)||!['fixed','absolute'].includes(css.position))return null;
  const z=css.zIndex==='auto'?0:Number(css.zIndex);
  // Positive foregrounds and ::after overlays retain their authored stacking.
  if(z>0||side==='after'&&z===0||css.mixBlendMode!=='normal'||css.backdropFilter&&css.backdropFilter!=='none'||css.webkitBackdropFilter&&css.webkitBackdropFilter!=='none'||css.boxShadow!=='none'||[css.borderTopWidth,css.borderBottomWidth,css.borderLeftWidth,css.borderRightWidth].some(v=>parseFloat(v)!==0))return null;
  const w=parseFloat(css.width),h=parseFloat(css.height);
  return css.top==='0px'&&css.left==='0px'&&w>=root.clientWidth-1&&h>=Math.max(root.clientHeight,innerHeight)-1?'wallpaper':'decoration';
 }
 function syncPseudos(project=true){
  const native=[];
  for(const side of ['before','after']){
   const css=styleOf(body,'::'+side),eligible=project&&styleOf(body).transform==='none'?decorationKind(css,side):null;
   if(!eligible){proxies.get(side)?.parentElement?.remove();proxies.delete(side);root.removeAttribute('data-mima-canvas-'+side);continue;}
   // Leave composited/blended foreground decorations in their authored place.
   // Only the wallpaper paint moves; borders/content and local ornaments stay.
   let proxy=proxies.get(side);if(!proxy){proxy=document.createElement('div');proxy.className='mima-keyboard-theme-overlay';proxy.dataset.mimaCanvasPseudo=side;const plane=document.createElement('div');plane.className='mima-theme-canvas-pseudo-plane';plane.append(proxy);ensureBacking().append(plane);proxies.set(side,proxy);}
   for(const n of [...proxy.style])if(/^background(?:-|$)/.test(n))proxy.style.removeProperty(n);
   native.push({side,proxy,css,animations:body.getAnimations().filter(a=>a.effect?.pseudoElement==='::'+side||a.effect?.target?.type==='::'+side)});
   geometryOf.set(proxy,{css:plainStyle(css),position:css.position});proxy.style.setProperty('position','absolute','important');
   proxy.dataset.mimaCanvasKind=eligible;proxy.dataset.mimaCanvasZ=css.zIndex==='auto'?'0':css.zIndex;root.setAttribute('data-mima-canvas-'+side,'');
  }
  if(!proxies.size&&!grouped){backing?.remove();backing=null;surface=null;root.removeAttribute('data-mima-canvas-overlay');}else root.setAttribute('data-mima-canvas-overlay','');
  // Align existing CSS animation timelines once at an appearance commit.
  for(const row of native){for(const a of row.proxy.getAnimations()){const old=row.animations.find(x=>x.animationName===a.animationName);if(old&&old.currentTime!==null)a.currentTime=old.currentTime;}reconcileBackground(row.proxy,row.css);}
 }
 const ignoredSheet=node=>node===sourceTag||node?.matches?.('[data-mima-display-sheet],[data-mima-display-guard],[data-mima-display-boundary-layer]');
 const styleNode=node=>node?.nodeType===1&&node.matches?.('style,link[rel="stylesheet"]')&&!ignoredSheet(node);
 function changedClasses(oldValue,node){const old=new Set(String(oldValue||'').split(/\s+/)),now=new Set(node.classList);return [...new Set([...old,...now])].filter(name=>name&&old.has(name)!==now.has(name)&&(!ignoredClass.test(name)||broadClassDependency||dependencies[node===root?'root':'body'].has(name)));}
 function styleChanged(record){const before=document.createElement('span').style;before.cssText=record.oldValue||'';const now=record.target.style;return [...new Set([...before,...now])].some(name=>(/^background(?:-|$)|^--mima-keyboard-root-/.test(name)||record.target===body&&/^(?:opacity|isolation|filter|backdrop-filter|transform|perspective|contain|position|z-index|zoom)$/.test(name)||variableDependencies.has(name)||colorDependency&&name==='color')&&(before.getPropertyValue(name)!==now.getPropertyValue(name)||before.getPropertyPriority(name)!==now.getPropertyPriority(name)));}
 function matchesKey(){return paintSelectors.map(row=>{try{return (root.matches(row.selector)?'r':'')+(body.matches(row.selector)?'b':'');}catch(_){return '';}}).join('|');}
 function relevant(record){
  if(record.type==='attributes'){
   if(record.target===root||record.target===body){if(record.attributeName==='class'){const names=changedClasses(record.oldValue,record.target);return names.length&&(broadClassDependency||names.some(name=>dependencies[record.target===root?'root':'body'].has(name)))&&matchesKey()!==lastMatches;}if(record.attributeName==='style')return styleChanged(record);return record.oldValue!==record.target.getAttribute(record.attributeName);}
   return styleNode(record.target);
  }
  const tag=record.target.nodeType===1?record.target:record.target.parentElement;
  return styleNode(tag)||[...record.addedNodes,...record.removedNodes].some(styleNode);
 }
 function consume(records){
  let appearance=false;
  for(const r of records){const node=r.target.nodeType===1?r.target:r.target.parentElement;
   if((r.target===root||r.target===body)&&r.type==='attributes'){
    if(r.attributeName==='class'&&r.target===root&&String(r.oldValue||'').split(/\s+/).includes('mima-settings-paint-guard')!==root.classList.contains('mima-settings-paint-guard'))syncMotion();
    if(relevant(r)){appearance=true;if(r.attributeName==='style')dependenciesDirty=true;}else if(r.attributeName==='style'){const old=document.createElement('span').style;old.cssText=r.oldValue||'';if(['zoom','transform','translate','rotate','scale','position','width','height','padding','border-width'].some(name=>old.getPropertyValue(name)!==r.target.style.getPropertyValue(name)))scheduleGeometry();}
   }else if(relevant(r)){if(node?.tagName==='STYLE')rawCache.delete(node);if(node?.sheet)invalidSheets.add(node.sheet);for(const added of r.addedNodes||[])if(styleNode(added)){if(added.sheet)invalidSheets.add(added.sheet);if(added.tagName==='LINK')added.addEventListener('load',()=>{if(added.sheet)invalidSheets.add(added.sheet);stylesDirty=true;dirty=true;schedule();},{once:true});}stylesDirty=true;appearance=true;}
  }
  if(appearance)dirty=true;
 }
 const observer=new MutationObserver(records=>{consume(records);if(dirty)schedule();});
 observer.observe(document.head,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['media','disabled']});
 function observeAppearance(){observer.observe(root,{attributes:true,attributeOldValue:true,attributeFilter:[...new Set(['data-mima-theme','data-mima-selected-theme','data-mima-effective-mode','class','style',...attributeDependencies])]});observer.observe(body,{attributes:true,attributeOldValue:true,attributeFilter:[...new Set(['class','style',...attributeDependencies])]});}
 observeAppearance();
 function plainStyle(css){const values={};for(const name of ['position','transform','transformOrigin','translate','rotate','scale','perspective','filter','contain','willChange','boxSizing','width','height','zoom',...['Top','Right','Bottom','Left'].flatMap(side=>['padding'+side,'border'+side+'Width'])])values[name]=css[name];return values;}
 function boxSize(css,node){const number=name=>parseFloat(css[name])||0;let width=parseFloat(css.width),height=parseFloat(css.height);if(css.boxSizing!=='border-box'){width+=number('paddingLeft')+number('paddingRight')+number('borderLeftWidth')+number('borderRightWidth');height+=number('paddingTop')+number('paddingBottom')+number('borderTopWidth')+number('borderBottomWidth');}return {width:Number.isFinite(width)?width:node.offsetWidth,height:Number.isFinite(height)?height:node.offsetHeight};}
 function zoomOf(node){if(Number(node.currentCSSZoom)>0)return Number(node.currentCSSZoom);let zoom=1;for(let p=node;p;p=p.parentElement)zoom*=parseFloat(getComputedStyle(p).zoom)||1;return zoom;}
 function frameFor(rect,size,linear){const corners=[[0,0],[size.width,0],[size.width,size.height],[0,size.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(linear)),left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));return new DOMMatrix([linear.a,linear.b,linear.c,linear.d,rect.left-left,rect.top-top]);}
 function updateGeometry(){
  geometryFrame=0;if(!backing)return;stats.geometryUpdates++;
  const bs=getComputedStyle(body),size=boxSize(bs,body),z=zoomOf(body);let linear=new DOMMatrix(bs.transform==='none'?undefined:bs.transform);
  if(!linear.is2D)return;linear=new DOMMatrix().scale(z).multiply(linear);
  const bodyFrame=frameFor(body.getBoundingClientRect(),size,linear),fixedBlock=bs.transform!=='none'||bs.filter!=='none'||bs.perspective!=='none'||/layout|paint|strict|content/.test(bs.contain)||/(?:transform|filter|perspective)/.test(bs.willChange);
  backing.style.transform='none';backing.style.width=innerWidth+'px';
  const br=backing.getBoundingClientRect(),backSize=boxSize(getComputedStyle(backing),backing),basis=fixedBlock?linear:new DOMMatrix().scale(z),backFrame=frameFor(br,backSize,basis),inverse=backFrame.inverse();
  backing.style.transformOrigin='0 0';backing.style.transform=[inverse.a,inverse.b,inverse.c,inverse.d,inverse.e,inverse.f].every(Number.isFinite)&&!inverse.isIdentity?inverse.toString():'none';
  const plane=(node,frame,width,height)=>{node.style.left='0px';node.style.top='0px';node.style.right='auto';node.style.bottom='auto';node.style.width=Math.max(0,width)+'px';node.style.height=Math.max(0,height)+'px';node.style.transformOrigin='0 0';if(frame.a===1&&frame.b===0&&frame.c===0&&frame.d===1){node.style.left=frame.e+'px';node.style.top=frame.f+'px';node.style.transform='none';}else node.style.transform=frame.toString();};
  if(surface){
   const contract=surface.hasAttribute('data-mima-canvas-contract');surface.style.fontSize=contract?'1rem':'inherit';if(contract){surface.style.padding='0';surface.style.borderWidth='0';}plane(surface,contract?new DOMMatrix():bodyFrame,contract?innerWidth:size.width,contract?backSize.height:(size.height||backSize.height/z));
   if(!contract){surface.style.boxSizing='border-box';for(const side of ['Top','Right','Bottom','Left']){surface.style['padding'+side]=bs['padding'+side];surface.style['border'+side+'Width']=bs['border'+side+'Width'];surface.style['border'+side+'Style']='solid';surface.style['border'+side+'Color']='transparent';}}
  }
  for(const proxy of proxies.values()){
   const info=geometryOf.get(proxy);if(!info)continue;
   const local=info.position!=='fixed'&&(bs.position!=='static'||fixedBlock),frame=local?bodyFrame.translate(body.clientLeft,body.clientTop):new DOMMatrix().translate(info.position==='fixed'?0:-scrollX,info.position==='fixed'?0:-scrollY).scale(z);
   plane(proxy.parentElement,frame,local?body.clientWidth:innerWidth/z,local?body.clientHeight:backSize.height/z);
   proxy.style.zIndex='auto';
  }
 }
 function scheduleGeometry(){if(backing&&!geometryFrame)geometryFrame=requestAnimationFrame(updateGeometry);}
 const sizeObserver=new ResizeObserver(scheduleGeometry);sizeObserver.observe(body);window.addEventListener('resize',scheduleGeometry,{passive:true});window.addEventListener('scroll',scheduleGeometry,{passive:true});
 function sync(){
  consume(observer.takeRecords());if(!dirty)return;dirty=false;if(frame){cancelAnimationFrame(frame);frame=0;}
  sourceRules();observeAppearance();
  root.removeAttribute('data-mima-canvas-ready');root.removeAttribute('data-mima-canvas-before');root.removeAttribute('data-mima-canvas-after');
  // Sample authored sources with our own paint substitution inactive. This is
  // one synchronous appearance transaction, never a viewport/animation read.
  const html=styleOf(root),contract=html.getPropertyValue('--mima-keyboard-root-contract').trim()==='1';
  const bs=styleOf(body);
  const paint=JSON.stringify([stylesDirty,sourceTag.textContent,root.getAttribute('data-mima-effective-mode'),...fields.map(name=>html.getPropertyValue('background-'+name)),...['contract',...fields].map(name=>html.getPropertyValue('--mima-keyboard-root-'+name)),...fields.map(name=>bs.getPropertyValue('background-'+name)),...['isolation','opacity','transform','perspective','filter','position','zIndex','contain','zoom'].map(name=>bs[name]),...['before','after'].map(side=>{const css=styleOf(body,'::'+side);return ['display','visibility','content','backgroundImage','backgroundColor','opacity','position','zIndex','width','height','top','right','bottom','left','transform','animationName','boxShadow','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','mixBlendMode','backdropFilter','webkitBackdropFilter'].map(name=>css[name]);})]);
  lastMatches=matchesKey();
  if(paint===lastPaint){root.setAttribute('data-mima-canvas-ready','');if(proxies.has('before'))root.setAttribute('data-mima-canvas-before','');if(proxies.has('after'))root.setAttribute('data-mima-canvas-after','');scheduleGeometry();return;}lastPaint=paint;stats.syncs++;
  const bodyPainted=bs.backgroundImage!=='none'||!transparent(bs.backgroundColor);
  let source=contract?'contract':authoredBackground(root)&&(!authoredBackground(body)||!bodyPainted)?'root':'body';
  const bodyContext=bs.isolation==='isolate'||Number(bs.opacity)<1||bs.transform!=='none'||bs.filter!=='none'||bs.position!=='static'&&bs.zIndex!=='auto'||/layout|paint|strict|content/.test(bs.contain);
  // Complex native decorations can share the body's own paint order (including
  // blending/backdrop/text). Keep that native paint rather than flattening it
  // into a new stacking context or covering it with a copied background.
  const nativePaint=['before','after'].some(side=>{const css=styleOf(body,'::'+side),z=css.zIndex==='auto'?0:Number(css.zIndex);if(css.display==='none'||css.visibility!=='visible'||Number(css.opacity)===0||['none','normal'].includes(css.content))return false;const painted=css.backgroundImage!=='none'||!transparent(css.backgroundColor)||css.boxShadow!=='none'||!['""',"''"].includes(css.content)||[css.borderTopWidth,css.borderRightWidth,css.borderBottomWidth,css.borderLeftWidth].some(n=>parseFloat(n)>0);return painted&&(bodyContext&&z<0||!bodyContext&&side==='before'&&z===0)&&(bs.transform!=='none'||!decorationKind(css,side));});
  if(nativePaint&&source==='body')source='body-native';
  syncPseudos(!nativePaint);
  // A negative pseudo outside a body stacking context paints BEFORE the body's
  // background. Keep that compositing order instead of moving it above the art.
  for(const [rank,proxy]of [...proxies.values()].sort((a,b)=>Number(a.dataset.mimaCanvasZ)-Number(b.dataset.mimaCanvasZ)).entries()){proxy.parentElement.style.zIndex=String(!bodyContext&&Number(proxy.dataset.mimaCanvasZ)<0?-10+rank:2+rank);proxy.style.zIndex='auto';}
  grouped=!nativePaint&&(source==='body'||source==='contract'&&(proxies.size>0&&!bodyContext||bodyContext));
  if(grouped){
   if(!surface){surface=document.createElement('div');surface.className='mima-theme-canvas-surface';ensureBacking().append(surface);}
   surface.style.font='inherit';
   for(const n of [...surface.style])if(/^background(?:-|$)/.test(n))surface.style.removeProperty(n);
   if(!contract&&inlineBackground)surface.style.cssText+=inlineBackground;
   ensureBacking().style.zIndex=bodyContext?'-2':'0';
   surface.style.zIndex=bodyContext?'-1':'1';
   surface.toggleAttribute('data-mima-canvas-contract',contract);
   source+='-layered';root.setAttribute('data-mima-canvas-overlay','');
  }else{surface?.remove();surface=null;if(!proxies.size){backing?.remove();backing=null;root.removeAttribute('data-mima-canvas-overlay');}}
  for(const name of fields)root.style.removeProperty('--mima-kb-canvas-'+name);
  updateGeometry();syncBackgroundAnimations();if(surface&&!contract)reconcileBackground(surface,bs);root.setAttribute('data-mima-canvas-source',source);root.setAttribute('data-mima-canvas-ready','');
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;sync();});}
 window.MimaThemeCanvas={sync,serializeRule,invalidate(){for(const sheet of document.styleSheets)invalidSheets.add(sheet);stylesDirty=true;dirty=true;sync();},getStats:()=>({...stats,source:root.getAttribute('data-mima-canvas-source'),backings:backing?.isConnected?1:0,overlays:proxies.size})};
 window.addEventListener('pageshow',()=>{dirty=true;sync();scheduleGeometry();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){consume(observer.takeRecords());if(dirty)sync();}});
 window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change',()=>{dirty=true;schedule();});
 sync();
})();
