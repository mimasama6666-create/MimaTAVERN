/* Shared keyboard-safe viewport for production dialogs; never scales the fixed layer. */
(function(){'use strict';
const doc=document,stack=[],previous=new WeakMap();let raf=0,composing=false,restingViewportHeight=0,restingViewportWidth=0,lastViewport={};
// The full-screen theme backing is deliberately outside the zoomed app shell.
// It is only painted while the story composer owns the software keyboard.
let keyboardBacking=null,keyboardBackingOverlay=null,keyboardBackingObserver=null,keyboardThemeFrame=0,keyboardWasVisible=false;
const keyboardBackgroundVars=['--mima-kb-canvas-image','--mima-kb-canvas-color','--mima-kb-canvas-size','--mima-kb-canvas-position','--mima-kb-canvas-repeat'];
function getKeyboardBacking(){
 if(keyboardBacking?.isConnected)return keyboardBacking;
 if(!doc.body)return null;
 keyboardBacking=doc.createElement('div');keyboardBacking.id='mima-keyboard-theme-underlay';
 keyboardBacking.setAttribute('aria-hidden','true');
 keyboardBackingOverlay=doc.createElement('div');keyboardBackingOverlay.className='mima-keyboard-theme-overlay';
 keyboardBacking.appendChild(keyboardBackingOverlay);doc.body.appendChild(keyboardBacking);
 return keyboardBacking;
}
function keyboardThemeBackground(){
 if(!doc.documentElement.classList.contains('mima-composer-keyboard'))return;
 const backing=getKeyboardBacking();if(!backing)return;
 const bodyStyle=getComputedStyle(doc.body),htmlStyle=getComputedStyle(doc.documentElement);
 // A global CSS theme normally paints body. Inherit its *live* CSS background
 // on the backing element, so Blob URLs and night/day @media changes stay shared.
 // The root canvas also needs the same paint when WebKit exposes a layout gap.
 const image=bodyStyle.backgroundImage!=='none'?bodyStyle.backgroundImage:htmlStyle.backgroundImage;
 const chosen=bodyStyle.backgroundImage!=='none'?bodyStyle:htmlStyle;
 const color=bodyStyle.backgroundColor!=='rgba(0, 0, 0, 0)'&&bodyStyle.backgroundColor!=='transparent'
   ?bodyStyle.backgroundColor:htmlStyle.backgroundColor;
 const props={
  '--mima-kb-canvas-image':image.length<=16384?image:'none',
  '--mima-kb-canvas-color':color||'var(--bg-deep)',
  '--mima-kb-canvas-size':chosen.backgroundSize,
  '--mima-kb-canvas-position':chosen.backgroundPosition,
  '--mima-kb-canvas-repeat':chosen.backgroundRepeat
 };
 for(const [key,value] of Object.entries(props)){
  if(doc.documentElement.style.getPropertyValue(key)!==value)doc.documentElement.style.setProperty(key,value);
 }
 // Some global themes place their full-viewport illustration on body::before,
 // rather than on body. Mirror ONLY viewport-covering backgrounds; never enlarge
 // a small badge/ribbon pseudo-element into a full-screen decoration.
 const pseudo=getComputedStyle(doc.body,'::before');
 const fullBleed=(pseudo.position==='fixed'||pseudo.position==='absolute')&&
  pseudo.top==='0px'&&pseudo.left==='0px'&&
  (pseudo.bottom==='0px'||pseudo.right==='0px');
 const canMirror=fullBleed&&pseudo.content!=='none'&&pseudo.backgroundImage!=='none'&&pseudo.backgroundImage.length<=16384;
 keyboardBackingOverlay.style.backgroundImage=canMirror?pseudo.backgroundImage:'none';
 if(canMirror){
  keyboardBackingOverlay.style.backgroundPosition=pseudo.backgroundPosition;
  keyboardBackingOverlay.style.backgroundSize=pseudo.backgroundSize;
  keyboardBackingOverlay.style.backgroundRepeat=pseudo.backgroundRepeat;
  keyboardBackingOverlay.style.opacity=pseudo.opacity;
  keyboardBackingOverlay.style.filter=pseudo.filter;
  keyboardBackingOverlay.style.mixBlendMode=pseudo.mixBlendMode;
 }else{
  keyboardBackingOverlay.style.opacity='1';keyboardBackingOverlay.style.filter='none';
  keyboardBackingOverlay.style.mixBlendMode='normal';
 }
}
function scheduleKeyboardTheme(){
 if(keyboardThemeFrame||!doc.documentElement.classList.contains('mima-composer-keyboard'))return;
 keyboardThemeFrame=requestAnimationFrame(()=>{keyboardThemeFrame=0;keyboardThemeBackground();});
}
function toggleKeyboardTheme(visible){
 if(visible===keyboardWasVisible)return;
 keyboardWasVisible=visible;
 if(visible){
  getKeyboardBacking();keyboardThemeBackground();
  // Custom CSS is mounted dynamically, and can switch day/night while focused.
  // Observe only while the composer is focused; coalesce changes into one frame.
  keyboardBackingObserver=new MutationObserver(scheduleKeyboardTheme);
  keyboardBackingObserver.observe(doc.head,{subtree:true,childList:true,characterData:true});
  keyboardBackingObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['data-mima-theme']});
  keyboardBackingObserver.observe(doc.body,{attributes:true,attributeFilter:['class','style']});
 }else{
  keyboardBackingObserver?.disconnect();keyboardBackingObserver=null;
  if(keyboardThemeFrame){cancelAnimationFrame(keyboardThemeFrame);keyboardThemeFrame=0;}
  // Release copied CSS URL strings when the keyboard closes. All source CSS
  // and original wallpaper Blob URLs remain owned by the existing theme engine.
  for(const name of keyboardBackgroundVars)doc.documentElement.style.removeProperty(name);
  if(keyboardBackingOverlay)keyboardBackingOverlay.style.backgroundImage='none';
 }
}

function visible(n){return !n.hidden&&!n.classList.contains('hidden');}
function viewport(){
 const v=window.visualViewport,root=doc.documentElement,r=root.style;
 const height=Math.max(1,v?.height||innerHeight),width=Math.max(1,v?.width||innerWidth);
 const top=v?.offsetTop||0,left=v?.offsetLeft||0;
 for(const [name,value] of [['height',height],['width',width],['top',top],['left',left]]){
  // Native keyboard scroll events can arrive every frame. Do not invalidate
  // the zoomed, glass-backed editor's full style tree when geometry is unchanged.
  if(lastViewport[name]!==value){lastViewport[name]=value;r.setProperty('--mima-viewport-'+name,value+'px');}
 }
 // iOS Safari may move the visual viewport *and* the layout scroll position
 // while focusing the composer. Height compensation alone leaves the entire
 // zoomed app in the layout viewport, exposing a large blank strip above the OS keyboard.
 const active=doc.activeElement;
 const editableFocused=!!active?.matches?.('input,textarea,select,[contenteditable="true"]');
 const composerFocused=!!(editableFocused && active.closest('.app-shell > .composer-shell'));
 // Focusout happens before the iOS keyboard has finished dismissing. Never
 // mistake that intermediate, shortened viewport for the unoccluded height.
 // Also cover edits inside settings: those controls open the same OS keyboard.
 if(!restingViewportHeight || Math.abs(width-restingViewportWidth)>40){
   restingViewportHeight=Math.max(height,window.innerHeight||0,root.clientHeight||0);
   restingViewportWidth=width;
 }else if(!editableFocused){
   restingViewportHeight=Math.max(restingViewportHeight,height);
 }
 const referenceHeight=Math.max(restingViewportHeight,window.innerHeight||0,root.clientHeight||0);
 const keyboardVisible=!!(composerFocused && v &&
   (referenceHeight-height>100 || Math.abs(top)>30));
 root.classList.toggle('mima-composer-keyboard',keyboardVisible);
 toggleKeyboardTheme(keyboardVisible);
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
window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change',scheduleKeyboardTheme);
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
