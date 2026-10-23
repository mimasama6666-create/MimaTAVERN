/* Shared keyboard-safe viewport for production dialogs; never scales the fixed layer. */
(function(){'use strict';
const doc=document,stack=[],previous=new WeakMap();let raf=0,composing=false;
function visible(n){return !n.hidden&&!n.classList.contains('hidden');}
function viewport(){
 const v=window.visualViewport,r=doc.documentElement.style;
 r.setProperty('--mima-viewport-height',Math.max(1,v?.height||innerHeight)+'px');
 r.setProperty('--mima-viewport-width',Math.max(1,v?.width||innerWidth)+'px');
 r.setProperty('--mima-viewport-top',(v?.offsetTop||0)+'px');
 r.setProperty('--mima-viewport-left',(v?.offsetLeft||0)+'px');
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
