/* Viewport/focus management only; no provider, prompt or store access. */
(function(){'use strict';
const doc=document,stack=[],previous=new WeakMap();let pausedEditor=null;
function viewport(){const v=window.visualViewport;doc.documentElement.style.setProperty('--mima-viewport-height',(v?.height||innerHeight)+'px');doc.documentElement.style.setProperty('--mima-viewport-top',(v?.offsetTop||0)+'px');}
viewport();window.addEventListener('resize',viewport,{passive:true});window.visualViewport?.addEventListener('resize',viewport,{passive:true});window.visualViewport?.addEventListener('scroll',viewport,{passive:true});
function visible(n){return !n.classList.contains('hidden')&&!n.hidden;}
for(const modal of doc.querySelectorAll('.modal')){
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 const heading=modal.querySelector('h2');if(heading){if(!heading.id)heading.id=modal.id+'-title';modal.setAttribute('aria-labelledby',heading.id);}
 new MutationObserver(()=>{
  const index=stack.indexOf(modal),shown=visible(modal);
  if(shown&&index<0){previous.set(modal,doc.activeElement);stack.push(modal);modal.querySelector('.modal-head button,button,input,textarea')?.focus({preventScroll:true});if(modal.id==='editor-modal'){pausedEditor?.remove();pausedEditor=null;}}
  if(!shown&&index>=0){stack.splice(index,1);const target=previous.get(modal);if(target?.isConnected)target.focus({preventScroll:true});}
 }).observe(modal,{attributes:true,attributeFilter:['class','hidden']});
}
doc.addEventListener('keydown',event=>{
 const modal=stack.filter(visible).at(-1);if(!modal)return;
 if(event.key==='Escape'){
  event.preventDefault();event.stopPropagation();
  if(modal.id==='editor-modal'){
   // Pause keeps the live form DOM and editorState. Explicit Cancel/Save keep
   // their existing ownership; Escape never silently discards an edit.
   modal.classList.add('hidden');
   pausedEditor=doc.createElement('button');pausedEditor.id='resume-editor';pausedEditor.textContent='继续未保存的编辑';pausedEditor.onclick=()=>modal.classList.remove('hidden');doc.body.append(pausedEditor);
  }else if(modal.id==='settings-modal')window.closeSettings();
  else if(modal.id==='new-session-modal')window.closeNewSessionModal();
  else modal.querySelector('.modal-head button')?.click();
 }
 if(event.key==='Tab'){
  const nodes=[...modal.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
  if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
 }
},true);
})();
