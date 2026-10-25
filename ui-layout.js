/* Shared keyboard-safe viewport for production dialogs; never scales the fixed layer. */
(function(){'use strict';
const doc=document,stack=[],previous=new WeakMap();
let raf=0,composing=false,restingViewportHeight=0,restingViewportWidth=0;
let storyHeight=0,keyboardOpen=false,lastViewportScale=1;
const viewportTrace=[];
let traceEnabled=false;
// Opt-in, in-memory diagnostics. No story text, field values or personal data.
window.MimaViewportDiagnostics={
 enable(){traceEnabled=true;viewportTrace.length=0;},
 disable(){traceEnabled=false;},
 read(){return viewportTrace.map(frame=>({...frame}));},
 clear(){viewportTrace.length=0;}
};
function visible(n){return !n.hidden&&!n.classList.contains('hidden');}
function putViewportVar(style,name,value){
 // A visualViewport.scroll event by itself must not invalidate the app grid.
 if(style.getPropertyValue(name)!==value)style.setProperty(name,value);
}
function viewport(){
 const v=window.visualViewport,root=doc.documentElement,r=root.style;
 const active=doc.activeElement;
 const editableFocused=!!active?.matches?.('input,textarea,select,[contenteditable="true"]');
 const composerFocused=!!(editableFocused && active.closest('.app-shell > .composer-shell'));
 const layoutHeight=Math.max(1,window.innerHeight||root.clientHeight||1);
 const layoutWidth=Math.max(1,window.innerWidth||root.clientWidth||1);
 const scale=Math.max(1,Number(v?.scale)||1);
 // visualViewport.height is measured in visual CSS pixels. On pinch/focus
 // zoom it gets smaller even when the keyboard has not changed. Convert it
 // back to unzoomed screen pixels BEFORE measuring keyboard occlusion.
 // A zoom transition must never substitute innerHeight for an open keyboard.
 const visualHeight=Math.max(1,Number(v?.height)||layoutHeight);
 const visibleHeight=Math.min(layoutHeight,Math.max(1,visualHeight*scale));
 const scaleChanged=Math.abs(scale-lastViewportScale)>0.015;
 lastViewportScale=scale;
 // Use the LAYOUT viewport width for orientation changes: vv.width itself
 // decreases under pinch zoom, which must not reset our keyboard baseline.
 if(!restingViewportHeight || Math.abs(layoutWidth-restingViewportWidth)>40){
  restingViewportHeight=layoutHeight;
  restingViewportWidth=layoutWidth;
  storyHeight=visibleHeight;
  keyboardOpen=false;
 }else if(!editableFocused){
  // A real resize while no keyboard is being edited resets the baseline.
  // Never learn a shortened keyboard viewport as the new resting height.
  if(visibleHeight>=layoutHeight-80){restingViewportHeight=layoutHeight;}
 }
 const referenceHeight=Math.max(restingViewportHeight,layoutHeight);
 const occlusion=referenceHeight-visibleHeight;
 const wasKeyboardOpen=keyboardOpen;
 if(!composerFocused){
  keyboardOpen=false;
 }else if(wasKeyboardOpen && scaleChanged){
  // Safari may report intermediate vv dimensions while zooming. A scale
  // transition alone is not proof that the keyboard has been dismissed.
  keyboardOpen=true;
 }else if(wasKeyboardOpen){
  keyboardOpen=occlusion>70;
 }else{
  keyboardOpen=occlusion>115;
 }
 // During a confirmed keyboard session, ignore small vv-height jitter and
 // hold the previous height across a simultaneous scale transition. Genuine
 // keyboard resizes with a stable scale still update the available space.
 let nextStoryHeight=keyboardOpen?visibleHeight:(composerFocused?layoutHeight:visibleHeight);
 if(composerFocused && wasKeyboardOpen && keyboardOpen){
  if(scaleChanged || Math.abs(nextStoryHeight-storyHeight)<24){
   nextStoryHeight=storyHeight;
  }
 }
 storyHeight=Math.max(1,nextStoryHeight);
 putViewportVar(r,'--mima-story-height',storyHeight+'px');
 // Story layout and overlays are separate consumers. In the composer state,
 // keep the overlay height on the same stable screen basis, but do not move
 // the document to vv.offsetTop/Left as Safari pans the focused input.
 const overlayHeight=composerFocused?storyHeight:visibleHeight;
 const overlayWidth=(scale>1.01||composerFocused)?layoutWidth:Math.max(1,Number(v?.width)||layoutWidth);
 const top=(scale>1.01||composerFocused)?0:(Number(v?.offsetTop)||0);
 const left=(scale>1.01||composerFocused)?0:(Number(v?.offsetLeft)||0);
 putViewportVar(r,'--mima-viewport-height',overlayHeight+'px');
 putViewportVar(r,'--mima-viewport-width',overlayWidth+'px');
 putViewportVar(r,'--mima-viewport-top',top+'px');
 putViewportVar(r,'--mima-viewport-left',left+'px');
 if(root.classList.contains('mima-composer-keyboard')!==keyboardOpen){
  root.classList.toggle('mima-composer-keyboard',keyboardOpen);
 }
 if(traceEnabled){
  const b=doc.querySelector('.app-shell')?.getBoundingClientRect();
  viewportTrace.push({time:Math.round(performance.now()),innerHeight:layoutHeight,
   visualHeight,visualWidth:Number(v?.width)||layoutWidth,scale,
   offsetTop:Number(v?.offsetTop)||0,offsetLeft:Number(v?.offsetLeft)||0,
   focus:composerFocused?'composer':editableFocused?'other-input':'none',
   keyboardOpen,storyHeight,appTop:b?.top??null,appHeight:b?.height??null});
  if(viewportTrace.length>30)viewportTrace.shift();
 }
}
function focusedControlVisible(){
 if(composing)return;
 const active=doc.activeElement;if(!active?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
 const modal=stack.filter(visible).at(-1);
 if(!modal?.contains(active))return;
 const body=active.closest('.editor-body,.settings-content,.modal-panel');if(!body)return;
 const scrollArea=body.matches('.editor-body,.settings-content')?body:body;
 const a=active.getBoundingClientRect(),c=scrollArea.getBoundingClientRect();
 const top=c.top+14,bottom=c.bottom-14;
 // Only scroll the inner editor; do not scroll the document or rebuild focused DOM.
 if(a.top<top)scrollArea.scrollTop-=Math.min(4000,top-a.top);
 else if(a.bottom>bottom)scrollArea.scrollTop+=Math.min(4000,a.bottom-bottom);
}
function scheduled(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;viewport();focusedControlVisible();});}
viewport();window.addEventListener('resize',scheduled,{passive:true});
window.visualViewport?.addEventListener('resize',scheduled,{passive:true});
window.visualViewport?.addEventListener('scroll',scheduled,{passive:true});
doc.addEventListener('focusin',()=>scheduled(),true);
doc.addEventListener('focusout',()=>scheduled(),true);
doc.addEventListener('compositionstart',()=>{composing=true;},true);
doc.addEventListener('compositionend',()=>{composing=false;scheduled();},true);
for(const modal of doc.querySelectorAll('.modal')){
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 const heading=modal.querySelector('h2');if(heading){if(!heading.id)heading.id=modal.id+'-title';modal.setAttribute('aria-labelledby',heading.id);}
 new MutationObserver(()=>{
  const index=stack.indexOf(modal),shown=visible(modal);
  if(shown&&index<0){previous.set(modal,doc.activeElement);stack.push(modal);modal.querySelector('.modal-head button,button,input,textarea')?.focus({preventScroll:true});scheduled();}
  if(!shown&&index>=0){stack.splice(index,1);const target=previous.get(modal);if(target?.isConnected&&target.getClientRects().length)target.focus({preventScroll:true});}
 }).observe(modal,{attributes:true,attributeFilter:['class','hidden']});
}
doc.addEventListener('keydown',event=>{
 const modal=stack.filter(visible).at(-1);if(!modal)return;
 if(event.key==='Escape'){
  event.preventDefault();event.stopPropagation();
  if(modal.id==='editor-modal')window.requestCloseEditor?.('escape');
  else if(modal.id==='settings-modal')window.closeSettings?.();
  else if(modal.id==='new-session-modal')window.closeNewSessionModal?.();
  else modal.querySelector('.modal-head button')?.click();
 }
 if(event.key==='Tab'){
  const nodes=[...modal.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length&&!n.closest('[hidden]'));
  if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
 }
},true);
})();
