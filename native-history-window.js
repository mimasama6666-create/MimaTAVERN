/* Native History is canonical data. Only disposable rendered descendants are
 * windowed: every original article/anchor stays in the transcript. */
(() => {
 'use strict';
 const recordsByNode=new WeakMap();
 let active=null;
 const motionAttribute='data-mima-motion-paused';
 function motionStyles(){
  if(document.getElementById('mima-history-motion-lifecycle'))return;
  const style=document.createElement('style');style.id='mima-history-motion-lifecycle';
  const root='#story-chat-box#story-chat-box ['+motionAttribute+']';
  style.textContent=[root,root+'::before',root+'::after'].join(',')+'{animation-play-state:paused!important}';
  document.head.appendChild(style);
 }
 function restoreMotion(motion){
  if(!motion.saved)return;
  // Respect a deliberate inline play-state edit made while the node was away.
  if(motion.el.style.getPropertyValue('animation-play-state')==='paused'&&motion.el.style.getPropertyPriority('animation-play-state')==='important'){
   const {value,priority}=motion.saved;
   if(value)motion.el.style.setProperty('animation-play-state',value,priority);else motion.el.style.removeProperty('animation-play-state');
  }
  motion.saved=null;motion.el.removeAttribute(motionAttribute);
 }
 function syncMotion(motion,focused=document.activeElement){
  const paused=document.hidden||!motion.visible&&!motion.el.contains(focused)&&!motion.fixedPseudo;
  if(paused){
   if(!motion.saved)motion.saved={value:motion.el.style.getPropertyValue('animation-play-state'),priority:motion.el.style.getPropertyPriority('animation-play-state')};
   if(motion.el.style.getPropertyValue('animation-play-state')!=='paused'||motion.el.style.getPropertyPriority('animation-play-state')!=='important')motion.el.style.setProperty('animation-play-state','paused','important');
   if(!motion.el.hasAttribute(motionAttribute))motion.el.setAttribute(motionAttribute,'');
  }else restoreMotion(motion);
 }
 function discoverMotion(state,record){
  if(!state.motionIntersection||!record.el.isConnected)return;
  // Observe animated elements themselves: a fixed/overflow status can remain
  // visible even when the article containing it is far outside the viewport.
  for(const animation of record.el.getAnimations?.({subtree:true})||[]){
   if(typeof animation.animationName!=='string')continue;
   const el=animation.effect?.target;if(!el?.style)continue;
   let motion=state.motions.get(el);
   if(!motion){motion={el,visible:false,saved:null,fixedPseudo:false};state.motions.set(el,motion);state.motionIntersection.observe(el);}
   const pseudo=animation.effect?.pseudoElement;
   if(pseudo&&getComputedStyle(el,pseudo).position==='fixed')motion.fixedPseudo=true;
   syncMotion(motion);
  }
 }
 function cleanMotions(state){for(const [el,motion]of state.motions)if(!el.isConnected||!state.box.contains(el)){state.motionIntersection?.unobserve(el);restoreMotion(motion);state.motions.delete(el);}}
 const controlSelector='details,input,textarea,select,[contenteditable]:not([contenteditable="false"])';
 function captureControls(el){return [...el.querySelectorAll(controlSelector)].map(node=>{
  const value={tag:node.localName,top:node.scrollTop,left:node.scrollLeft};
  if(node.localName==='details')value.open=node.open;
  else if(node.localName==='select')value.selected=[...node.options].map(option=>option.selected);
  else if(node.isContentEditable)value.html=node.innerHTML;
  else{value.value=node.value;value.checked=node.checked;try{value.start=node.selectionStart;value.end=node.selectionEnd;value.direction=node.selectionDirection;}catch(_){}}
  return value;
 });}
 function restoreControls(el,values){const nodes=el.querySelectorAll(controlSelector);for(let i=0;i<values.length;i++){
  const node=nodes[i],value=values[i];if(!node||node.localName!==value.tag)continue;
  if('open'in value)node.open=value.open;
  if(value.selected)[...node.options].forEach((option,index)=>{option.selected=!!value.selected[index];});
  if('html'in value)node.innerHTML=value.html;
  if('value'in value&&node.type!=='file')node.value=value.value;
  if('checked'in value)node.checked=value.checked;
  if(value.start!==null&&value.start!==undefined)try{node.setSelectionRange(value.start,value.end,value.direction);}catch(_){}
  node.scrollTop=value.top;node.scrollLeft=value.left;
 }}
 function saveStyles(el){return ['height','minHeight','overflow','boxSizing'].map(key=>[key,el.style[key]]);}
 function unlock(record){for(const [key,value]of record.styles||[])record.el.style[key]=value;record.styles=null;}
 function placeholder(record,height){
  const el=record.el;record.styles=record.styles||saveStyles(el);
  el.style.boxSizing='border-box';el.style.height=Math.max(40,height)+'px';el.style.minHeight='0';el.style.overflow='hidden';
  const button=document.createElement('button');button.type='button';button.className='mima-native-history-placeholder';
  button.textContent='展开此条历史消息';button.setAttribute('aria-label','加载并展开此条历史消息');
  button.style.cssText='font:inherit;color:inherit;background:transparent;border:0;padding:8px;cursor:pointer;max-width:100%';
  button.addEventListener('click',()=>{if(ensure(el.dataset.msgId)){const target=el.querySelector('.msg-content');if(target){target.tabIndex=-1;target.focus({preventScroll:true});}}});
  el.replaceChildren(button);el.dataset.mimaNativeWindow='suspended';record.live=false;
 }
 function createShell(msg){const el=document.createElement('article');el.className='message '+(msg?.role||'system')+'-msg';el.dataset.msgId=msg?.id||'';
  const record={el,msg,live:false,controls:[],text:null,height:180,pins:0};recordsByNode.set(el,record);placeholder(record,180);return el;
 }
 function reset(){if(!active)return;active.controller.abort();active.intersection?.disconnect();active.motionIntersection?.disconnect();active.motionMutation?.disconnect();active.motionStylesMutation?.disconnect();for(const m of active.motions.values())restoreMotion(m);active.resize?.disconnect();if(active.raf)cancelAnimationFrame(active.raf);active=null;}
 function schedule(){const state=active;if(!state||state.raf)return;state.raf=requestAnimationFrame(()=>{state.raf=0;if(active===state)update(state);});}
 function textOf(record){const content=record.el.querySelector(':scope > .msg-content');if(!content||record.el.dataset.mimaDisplayRegex==='pending')return null;return content.innerText;}
 function hydrate(record,state){
  if(record.live||!record.el.isConnected||active!==state)return record.live;
  unlock(record);
  try{state.hydrate(record.el,record.msg,()=>{if(active===state&&record.live&&record.el.isConnected)restoreControls(record.el,record.controls);});}catch(error){placeholder(record,record.height);console.warn('[Native History] Could not render message',error);return false;}
  record.live=true;record.el.dataset.mimaNativeWindow='live';
  restoreControls(record.el,record.controls);state.live.add(record);window.MimaPerfDiagnostics?.mark('history_hydrate');return true;
 }
 function suspend(record,state){
  if(!record.live||record.pins||record.el.contains(document.activeElement))return;
  if(record.el.dataset.mimaDisplayRegex!=='pending')record.controls=captureControls(record.el);const text=textOf(record);if(text!==null)record.text=text;
  // offsetHeight is unscaled layout geometry. getBoundingClientRect is reserved
  // for viewport comparisons, so CSS zoom never doubles the retained height.
  record.height=Math.max(40,record.el.offsetHeight);placeholder(record,record.height);state.live.delete(record);window.MimaPerfDiagnostics?.mark('history_suspend');
 }
 function update(state){
  if(active!==state||!state.box.isConnected||!state.enabled)return;
  const perfStart=window.MimaPerfDiagnostics?.isRunning()?performance.now():0;
  const view=state.box.getBoundingClientRect();
  const enterMargin=Math.max(600,view.height*1.5);
  // Keep already-rendered messages a little longer than newly-entering ones.
  // This avoids suspending/re-rendering a message at every scroll boundary.
  const exitMargin=enterMargin+Math.max(400,view.height);
  const entries=state.entries,now=performance.now(),geometry=new Map();
  const locate=record=>{
   let info=geometry.get(record);
   if(!info){
    const rect=record.el.getBoundingClientRect();
    info={rect,distance:rect.bottom<view.top?view.top-rect.bottom:rect.top>view.bottom?rect.top-view.bottom:0};
    geometry.set(record,info);
   }
   return info;
  };
  // The original article shells keep document order, even when their content
  // is unloaded. Find the beginning of the extended viewport logarithmically.
  let low=0,high=entries.length;
  while(low<high){const mid=(low+high)>>>1;if(locate(entries[mid]).rect.bottom<view.top-exitMargin)low=mid+1;else high=mid;}
  const candidates=new Set();
  for(let i=low;i<entries.length;i++){
   const record=entries[i],info=locate(record);
   if(info.rect.top>view.bottom+exitMargin)break;
   if(info.distance<=enterMargin||(record.live&&info.distance<=exitMargin))candidates.add(record);
  }
  for(const record of state.live){
   if(record.pins||record.el.contains(document.activeElement)||record.forceUntil>now)candidates.add(record);
  }
  for(const record of state.intersecting){
   if(record.el.isConnected&&locate(record).distance<=enterMargin)candidates.add(record);
  }
  // Compute all geometry and priority once, rather than reading layout on
  // every Array.sort comparator invocation (previously O(n log n) reads).
  const ranked=[...candidates].map(record=>({record,
   priority:record.pins||record.el.contains(document.activeElement)?0:record.forceUntil>now?1:2,
   distance:locate(record).distance
  })).sort((a,b)=>a.priority-b.priority||a.distance-b.distance);
  const keep=new Set(ranked.slice(0,state.maxLive).map(item=>item.record));
  // Never unmount a control being edited or a message pinned for search.
  for(const record of state.live)if(record.pins||record.el.contains(document.activeElement))keep.add(record);
  for(const record of [...state.live])if(!keep.has(record))suspend(record,state);
  for(const record of keep)hydrate(record,state);
  if(perfStart)window.MimaPerfDiagnostics?.mark('history_update',performance.now()-perfStart);
 }
 function sync(box,messages,options={}){
  const list=Array.isArray(messages)?messages:[];
  if(!box||!list.length){reset();return;}
  const sessionChanged=active&&options.sessionId!==undefined&&active.sessionId!==options.sessionId;
  if(active&&(active.box!==box||sessionChanged))reset();
  if(!active){const controller=new AbortController();active={box,controller,sessionId:options.sessionId,entries:[],byId:new Map(),live:new Set(),intersecting:new Set(),observed:new Set(),raf:0,maxLive:80};
   const state=active;box.addEventListener('scroll',schedule,{passive:true,signal:controller.signal});
   box.addEventListener('focusout',schedule,{signal:controller.signal});window.addEventListener('resize',schedule,{passive:true,signal:controller.signal});
   motionStyles();state.motions=new Map();
   if(typeof IntersectionObserver!=='undefined')state.motionIntersection=new IntersectionObserver(items=>{
    if(active!==state)return;
    for(const item of items){const motion=state.motions.get(item.target);if(!motion)continue;motion.visible=item.isIntersecting;syncMotion(motion);}
   },{root:null,rootMargin:'100px 0px'});
   if(state.motionIntersection&&typeof MutationObserver!=='undefined'){
    state.motionMutation=new MutationObserver(changes=>{
     if(active!==state)return;
     const records=new Set();
     for(const change of changes){
      const owned=state.motions.get(change.target);
      if(change.type==='attributes'&&change.attributeName==='style'&&owned?.saved&&change.target.style.getPropertyValue('animation-play-state')==='paused'&&change.target.style.getPropertyPriority('animation-play-state')==='important')continue;
      if(owned?.saved&&change.type==='attributes'&&change.attributeName==='style'){owned.saved={value:owned.el.style.getPropertyValue('animation-play-state'),priority:owned.el.style.getPropertyPriority('animation-play-state')};}
      const el=change.target.closest?.('article.message'),record=el&&recordsByNode.get(el);if(record)records.add(record);
     }
     cleanMotions(state);for(const record of records)discoverMotion(state,record);
    });state.motionMutation.observe(box,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','open']});
    state.motionStylesMutation=new MutationObserver(()=>{if(active===state)for(const record of state.entries)discoverMotion(state,record);});
    state.motionStylesMutation.observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['href','media','disabled']});
   }
   document.addEventListener('visibilitychange',()=>{if(active===state)for(const motion of state.motions.values())syncMotion(motion);},{signal:controller.signal});
   for(const event of ['focusin','focusout'])box.addEventListener(event,e=>{for(const motion of state.motions.values())if(motion.el.contains(e.target))syncMotion(motion,event==='focusout'?e.relatedTarget:document.activeElement);},{signal:controller.signal});
   if(typeof IntersectionObserver!=='undefined')state.intersection=new IntersectionObserver(items=>{if(active!==state)return;for(const item of items){const record=recordsByNode.get(item.target);if(!record)continue;if(item.isIntersecting)state.intersecting.add(record);else state.intersecting.delete(record);}schedule();},{root:box,rootMargin:'1200px 0px'});
   if(typeof ResizeObserver!=='undefined'){state.resize=new ResizeObserver(schedule);state.resize.observe(box);}
  }
  const state=active;state.hydrate=options.hydrate||state.hydrate;if(typeof state.hydrate!=='function'){reset();return;}
  state.maxLive=Math.max(8,Math.floor(Number(options.maxLive)||80));state.sessionId=options.sessionId;state.enabled=list.length>120;
  const messagesById=new Map(list.map(msg=>[String(msg.id||''),msg])),entries=[];
  for(const el of box.children){const msg=messagesById.get(el.dataset.msgId);if(!msg||!el.matches('article.message'))continue;
   let record=recordsByNode.get(el);if(!record){record={el,msg,live:true,controls:[],text:null,height:180,pins:0};recordsByNode.set(el,record);}record.msg=msg;entries.push(record);
  }
  state.entries=entries;state.byId=new Map(entries.map(record=>[record.el.dataset.msgId,record]));state.live=new Set(entries.filter(record=>record.live));
  // Appending a turn must not disconnect/reobserve the entire history.
  // Only attach new articles and detach articles no longer in this transcript.
  const observedNow=new Set(entries.map(record=>record.el));
  for(const node of state.observed)if(!observedNow.has(node)){
   state.intersection?.unobserve(node);
   const previous=recordsByNode.get(node);if(previous)state.intersecting.delete(previous);
  }
  for(const node of observedNow)if(!state.observed.has(node)){
   state.intersection?.observe(node);discoverMotion(state,recordsByNode.get(node));
  }
  state.observed=observedNow;cleanMotions(state);
  if(list.length<=120){for(const record of entries)hydrate(record,state);}else update(state);
  schedule();
 }
 function ensure(id){const state=active,record=state?.byId.get(String(id));if(!record)return false;record.forceUntil=performance.now()+250;const ok=hydrate(record,state);schedule();setTimeout(()=>{if(active===state)schedule();},260);return ok;}
 function visibleText(id){const record=active?.byId.get(String(id));if(!record)return null;return record.live?textOf(record):record.text;}
 async function readVisibleText(id,{settle}={}){
  const state=active,record=state?.byId.get(String(id));if(!record)return '';
  // One offscreen search projection at a time. No source/HTML approximation is
  // substituted for the display renderer, including asynchronous display regex.
  record.pins++;try{
   if(!hydrate(record,state))return '';
   update(state);if(settle)await settle();
   if(active!==state||state.byId.get(String(id))!==record)return '';
   const text=textOf(record);if(text!==null)record.text=text;return text||'';
  }finally{record.pins--;if(active===state){record.forceUntil=0;update(state);}}
 }
 window.MimaNativeHistoryWindow=Object.freeze({createShell,sync,ensure,visibleText,readVisibleText,reset});
})();
