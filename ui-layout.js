/* Shared keyboard-safe viewport for production dialogs; never scales the fixed layer. */
(function(){'use strict';
const doc=document,stack=[],previous=new WeakMap();let raf=0,composing=false,restingViewportHeight=0,restingViewportWidth=0,lastViewport={};
let keyboardGeometryActive=false,keyboardSession=0;
let keyboardPhase='idle'; // idle | focused-unconfirmed | keyboard-obscured | closing
let keyboardDismissPending=false,keyboardViewportWasObscured=false;
let keyboardViewportPreviouslyObscured=false,keyboardViewportRecovered=false;
let keyboardExitIntentSession=0;
const keyboardSessionActive=()=>keyboardPhase!=='idle';
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
 // Focus starts only a geometry session; the effective theme owns its paint.

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
 }else if(!editableFocused && !keyboardSessionActive()){
  restingViewportHeight=Math.max(restingViewportHeight,height);
 }
 const referenceHeight=Math.max(restingViewportHeight,window.innerHeight||0,root.clientHeight||0);
 const obscured=!!(v && (referenceHeight-height>100 || Math.abs(top)>30));
 if(keyboardSessionActive()){
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
 const geometry=!!(keyboardSessionActive() && obscured && (focused||keyboardDismissPending));
 if(geometry!==keyboardGeometryActive){
  keyboardGeometryActive=geometry;
  root.classList.toggle('mima-composer-keyboard',geometry);
 }
 if(keyboardSessionActive() && !focused && keyboardDismissPending){
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
 // WebKit can keep a large textarea focused while its copy-selection is active
 // and the page is backgrounded. Never perform scroll corrections off-screen.
 if(doc.hidden||composing)return;
 const active=doc.activeElement;if(!active?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
 const modal=stack.filter(visible).at(-1);
 if(!modal?.contains(active))return;
 const scrollArea=active.closest('.editor-body,.settings-content,.modal-panel');if(!scrollArea)return;
 const a=active.getBoundingClientRect(),c=scrollArea.getBoundingClientRect();
 const top=c.top+14,bottom=c.bottom-14,available=bottom-top;
 if(available<=0)return;
 // A multiline editor taller than its scrollport CANNOT be made fully visible.
 // The old top/bottom checks alternated opposing scrolls on consecutive iOS
 // visualViewport changes (keyboard close, app switch, text selection). Leave
 // partial visibility and native caret scrolling alone; only bring an entirely
 // off-screen control back into view.
 if(a.height>available){
  const exposed=Math.min(48,available/2);
  if(a.bottom<=top)scrollArea.scrollTop-=Math.min(4000,top-a.bottom+exposed);
  else if(a.top>=bottom)scrollArea.scrollTop+=Math.min(4000,a.top-bottom+exposed);
  return;
 }
 // Only scroll the inner editor; do not scroll the document or rebuild focused DOM.
 if(a.top<top)scrollArea.scrollTop-=Math.min(4000,top-a.top);
 else if(a.bottom>bottom)scrollArea.scrollTop+=Math.min(4000,a.bottom-bottom);
}
function scheduled(){
 if(doc.hidden||raf)return;
 raf=requestAnimationFrame(()=>{raf=0;if(doc.hidden)return;viewport();focusedControlVisible();});
}
function viewportChanged(){scheduled();}
doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)scheduled();},{passive:true});
viewport();window.addEventListener('resize',viewportChanged,{passive:true});
window.visualViewport?.addEventListener('resize',viewportChanged,{passive:true});
window.visualViewport?.addEventListener('scroll',viewportChanged,{passive:true});
doc.addEventListener('pointerdown',event=>{
 if(keyboardSessionActive() && isComposerControl(doc.activeElement) &&
  !isEditableControl(event.target))keyboardExitIntentSession=keyboardSession;
},true);
doc.addEventListener('focusin',event=>{
 if(isComposerControl(event.target))beginKeyboardSession();
 else if(keyboardSessionActive() && !isEditableControl(event.target)){
  keyboardExitIntentSession=keyboardSession;
 }
 scheduled();
},true);
doc.addEventListener('focusout',event=>{
 if(isComposerControl(event.target))endKeyboardSession();
 // A non-composer input may have kept the same software keyboard open.
 // When it subsequently exits, reconsider an unconfirmed keyboard session.
 scheduled();
},true);
window.addEventListener('pagehide',()=>{
 keyboardSession++;keyboardPhase='idle';keyboardDismissPending=false;
 keyboardViewportWasObscured=false;keyboardViewportPreviouslyObscured=false;
 keyboardViewportRecovered=false;keyboardExitIntentSession=0;
 keyboardGeometryActive=false;
 doc.documentElement.classList.remove('mima-composer-keyboard');

});
// Restore geometry independently; theme-canvas owns unconditional appearance recovery.
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
