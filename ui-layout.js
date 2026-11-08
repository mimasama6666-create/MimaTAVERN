/* Shared keyboard-safe viewport for production dialogs; never scales the fixed layer. */
(function(){'use strict';
const doc=document,stack=[],previous=new WeakMap();let raf=0,composing=false,restingViewportHeight=0,restingViewportWidth=0,lastViewport={};
// The full-screen theme backing is deliberately outside the zoomed app shell.
// It is only painted while the story composer owns the software keyboard.
// The wallpaper is a visual session, not a visualViewport geometry signal.
// Keeping these independent is essential: WebKit can report a stale viewport
// while a focused composer already owns the software keyboard.
let keyboardBacking=null,keyboardBackingOverlay=null,keyboardBackingObserver=null,keyboardThemeFrame=0;
// One visible backing session may outlive a focused composer while the keyboard
// closes. Viewport geometry is observed separately from the backing lifetime.
let keyboardThemeActive=false,keyboardGeometryActive=false,keyboardSession=0;
let keyboardPhase='idle'; // idle | focused-unconfirmed | keyboard-obscured | closing
let keyboardDismissPending=false,keyboardViewportWasObscured=false;
let keyboardViewportPreviouslyObscured=false,keyboardViewportRecovered=false;
let keyboardExitIntentSession=0;
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
 if(!keyboardThemeActive)return;
 const backing=getKeyboardBacking();if(!backing)return;
 const root=doc.documentElement;
 // Contract themes paint directly from their original CSS variables: never
 // stringify a data: wallpaper into an inline style on focus or resize.
 const hasCssContract=getComputedStyle(root).getPropertyValue('--mima-keyboard-root-contract').trim()==='1';
 const bodyStyle=hasCssContract?null:getComputedStyle(doc.body);
 const hasBodyImage=!!bodyStyle && bodyStyle.backgroundImage!=='none';
 // Only proxy when the source needs it. A root-only legacy theme must keep its
 // own native html background; removing a body theme must not retain its image.
 root.classList.toggle('mima-keyboard-theme-canvas',hasCssContract||hasBodyImage);
 if(hasCssContract || !hasBodyImage){
  for(const name of keyboardBackgroundVars){
   if(root.style.getPropertyValue(name))root.style.removeProperty(name);
  }
 }else{
  // Backward compatibility for old unmodified themes. Snapshot only on an
  // actual theme/style mutation, never on keyboard geometry events; no length
  // limit and no silent replacement of arbitrary data:, Blob or remote URLs.
  const htmlStyle=getComputedStyle(root);
  const image=bodyStyle.backgroundImage;
  const chosen=bodyStyle;
  const color=bodyStyle.backgroundColor!=='rgba(0, 0, 0, 0)'&&bodyStyle.backgroundColor!=='transparent'
   ?bodyStyle.backgroundColor:htmlStyle.backgroundColor;
  const props={
   '--mima-kb-canvas-image':image,
   '--mima-kb-canvas-color':color||'var(--bg-deep)',
   '--mima-kb-canvas-size':chosen.backgroundSize,
   '--mima-kb-canvas-position':chosen.backgroundPosition,
   '--mima-kb-canvas-repeat':chosen.backgroundRepeat
  };
  for(const [key,value] of Object.entries(props)){
   if(root.style.getPropertyValue(key)!==value)root.style.setProperty(key,value);
  }
 }
 // Preserve full-screen pseudo-wallpapers from older user styles as well.
 // The target image is copied only when its source style changes, never at
 // each viewport animation frame. Do not enlarge small decorative badges.
 const pseudo=getComputedStyle(doc.body,'::before');
 const fullBleed=(pseudo.position==='fixed'||pseudo.position==='absolute')&&
  pseudo.top==='0px'&&pseudo.left==='0px'&&
  (pseudo.bottom==='0px'||pseudo.right==='0px');
 const canMirror=fullBleed&&pseudo.content!=='none'&&pseudo.backgroundImage!=='none';
 const overlay=keyboardBackingOverlay;
 const image=canMirror?pseudo.backgroundImage:'none';
 if(overlay.style.backgroundImage!==image)overlay.style.backgroundImage=image;
 if(canMirror){
  overlay.style.backgroundPosition=pseudo.backgroundPosition;
  overlay.style.backgroundSize=pseudo.backgroundSize;
  overlay.style.backgroundRepeat=pseudo.backgroundRepeat;
  overlay.style.opacity=pseudo.opacity;
  overlay.style.filter=pseudo.filter;
  overlay.style.mixBlendMode=pseudo.mixBlendMode;
 }else{
  overlay.style.opacity='1';overlay.style.filter='none';
  overlay.style.mixBlendMode='normal';
 }
}
function scheduleKeyboardTheme(){
 if(keyboardThemeFrame||!keyboardThemeActive)return;
 keyboardThemeFrame=requestAnimationFrame(()=>{keyboardThemeFrame=0;keyboardThemeBackground();});
}
function toggleKeyboardTheme(visible){
 if(visible===keyboardThemeActive)return;
 keyboardThemeActive=visible;
 doc.documentElement.classList.toggle('mima-keyboard-theme-active',visible);
 if(visible){
  getKeyboardBacking();keyboardThemeBackground();
  // Observe only genuine theme mutations, not our own root class/variables.
  keyboardBackingObserver=new MutationObserver(scheduleKeyboardTheme);
  keyboardBackingObserver.observe(doc.head,{subtree:true,childList:true,characterData:true});
  keyboardBackingObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['data-mima-theme','class']});
  keyboardBackingObserver.observe(doc.body,{attributes:true,attributeFilter:['class','style']});
 }else{
  keyboardBackingObserver?.disconnect();keyboardBackingObserver=null;
  if(keyboardThemeFrame){cancelAnimationFrame(keyboardThemeFrame);keyboardThemeFrame=0;}
  for(const name of keyboardBackgroundVars)doc.documentElement.style.removeProperty(name);
  doc.documentElement.classList.remove('mima-keyboard-theme-canvas');
  if(keyboardBackingOverlay)keyboardBackingOverlay.style.backgroundImage='none';
 }
}
function isComposerControl(element){
 return (!!element?.matches?.('#story-input,#director-note') &&
  !!element.closest?.('.app-shell > .composer-shell')) ||
  (!!element?.matches?.('#mima-compose-expanded-input') &&
  !!element.closest?.('#mima-compose-expanded:not([hidden])'));
}
function beginKeyboardSession(){
 keyboardSession++;
 keyboardPhase='focused-unconfirmed';
 keyboardDismissPending=false;
 keyboardViewportWasObscured=false;
 keyboardViewportPreviouslyObscured=false;
 keyboardViewportRecovered=false;
 keyboardExitIntentSession=0;
 // The new focus owns a new session. Do not let an older scheduled close
 // clear this background, even if WebKit still reports the previous viewport.
 toggleKeyboardTheme(true);
}
function endKeyboardSession(){
 if(keyboardPhase==='idle')return;
 keyboardPhase='closing';
 keyboardDismissPending=true;
 // Focusout is not proof that the keyboard vanished. The next viewport or
 // deliberate departure from editable controls determines completion.
}
function finishKeyboardSession(session){
 if(session!==keyboardSession||isComposerControl(doc.activeElement))return;
 keyboardPhase='idle';keyboardDismissPending=false;
 keyboardViewportWasObscured=false;keyboardViewportPreviouslyObscured=false;
 keyboardViewportRecovered=false;keyboardExitIntentSession=0;
 if(keyboardGeometryActive){
  keyboardGeometryActive=false;
  doc.documentElement.classList.remove('mima-composer-keyboard');
 }
 toggleKeyboardTheme(false);
}
function isEditableControl(element){
 return !!element?.matches?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
}

function visible(n){return !n.hidden&&!n.classList.contains('hidden');}
function viewport(){
 const v=window.visualViewport,root=doc.documentElement,r=root.style;
 const height=Math.max(1,v?.height||innerHeight),width=Math.max(1,v?.width||innerWidth);
 const top=v?.offsetTop||0,left=v?.offsetLeft||0;
 // Only a numerical viewport transition can demonstrate a keyboard geometry
 // transition. A duplicate/stale resize/scroll event is never close evidence.
 const viewportMoved=lastViewport.height!==undefined &&
  (Math.abs(lastViewport.height-height)>1||Math.abs(lastViewport.top-top)>1);
 for(const [name,value] of [['height',height],['width',width],['top',top],['left',left]]){
  if(lastViewport[name]!==value){lastViewport[name]=value;r.setProperty('--mima-viewport-'+name,value+'px');}
 }
 const focused=isComposerControl(doc.activeElement);
 const editableFocused=isEditableControl(doc.activeElement);
 // Store a baseline only while the viewport is known to be unobscured.
 if(!restingViewportHeight || Math.abs(width-restingViewportWidth)>40){
  restingViewportHeight=Math.max(height,window.innerHeight||0,root.clientHeight||0);
  restingViewportWidth=width;
 }else if(!editableFocused && !keyboardThemeActive){
  restingViewportHeight=Math.max(restingViewportHeight,height);
 }
 const referenceHeight=Math.max(restingViewportHeight,window.innerHeight||0,root.clientHeight||0);
 const obscured=!!(v && (referenceHeight-height>100 || Math.abs(top)>30));
 if(keyboardThemeActive){
  if(obscured){
   keyboardViewportWasObscured=true;
   if(keyboardPhase==='focused-unconfirmed')keyboardPhase='keyboard-obscured';
  }else if(keyboardViewportWasObscured&&keyboardViewportPreviouslyObscured&&viewportMoved){
   // A real obscured -> baseline transition is the close signal for this
   // session; an unchanged/late resize before obscuration never qualifies.
   keyboardViewportRecovered=true;
  }
  keyboardViewportPreviouslyObscured=obscured;
 }
 const geometry=!!(keyboardThemeActive && obscured && (focused||keyboardDismissPending));
 if(geometry!==keyboardGeometryActive){
  keyboardGeometryActive=geometry;
  root.classList.toggle('mima-composer-keyboard',geometry);
 }
 if(keyboardThemeActive && !focused && keyboardDismissPending){
  const viewportClosed=referenceHeight-height<=55 && Math.abs(top)<=20;
  // Once we have observed an obscured viewport, the matching recovery is
  // required. Before any obscuration was observed, allow the ordinary no-IME
  // exit only after focus has actually departed editable controls. Focus
  // moving to a *different* input cannot be mistaken for dismissing the IME.
  const explicitlyExited=!editableFocused &&
   (keyboardExitIntentSession===keyboardSession ||
    doc.activeElement===doc.body || doc.activeElement===root);
  const noImeExit=!keyboardViewportWasObscured && explicitlyExited;
  if(viewportClosed && (keyboardViewportRecovered || noImeExit)){
   finishKeyboardSession(keyboardSession);
  }
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
function viewportChanged(){scheduled();}
window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change',scheduleKeyboardTheme);
viewport();window.addEventListener('resize',viewportChanged,{passive:true});
window.visualViewport?.addEventListener('resize',viewportChanged,{passive:true});
window.visualViewport?.addEventListener('scroll',viewportChanged,{passive:true});
doc.addEventListener('pointerdown',event=>{
 if(keyboardThemeActive && isComposerControl(doc.activeElement) &&
  !isEditableControl(event.target))keyboardExitIntentSession=keyboardSession;
},true);
doc.addEventListener('focusin',event=>{
 if(isComposerControl(event.target))beginKeyboardSession();
 else if(keyboardThemeActive && !isEditableControl(event.target)){
  keyboardExitIntentSession=keyboardSession;
 }
 scheduled();
},true);
doc.addEventListener('focusout',event=>{
 if(isComposerControl(event.target))endKeyboardSession();
 // A non-composer input may have kept the same software keyboard open.
 // When it subsequently exits, reconsider an unconfirmed background session.
 scheduled();
},true);
window.addEventListener('pagehide',()=>{
 keyboardSession++;keyboardPhase='idle';keyboardDismissPending=false;
 keyboardViewportWasObscured=false;keyboardViewportPreviouslyObscured=false;
 keyboardViewportRecovered=false;keyboardExitIntentSession=0;
 keyboardGeometryActive=false;
 doc.documentElement.classList.remove('mima-composer-keyboard');
 toggleKeyboardTheme(false);
});
// A BFCache restore can preserve the focused textarea without firing a new
// focusin event. pagehide intentionally tears down the wallpaper; pageshow
// must re-establish ownership for that same live composer before measuring
// viewport geometry, otherwise the returned page can expose a white band.
window.addEventListener('pageshow',()=>{
 if(keyboardPhase==='idle' && isComposerControl(doc.activeElement))beginKeyboardSession();
 scheduled();
},{passive:true});
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
