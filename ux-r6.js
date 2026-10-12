/* Sixth-round additive navigation. Old named handlers remain unchanged. */
(function(root){'use strict';if(typeof document==='undefined')return;
const id=x=>document.getElementById(x);function close(){const menu=id('mima-feature-menu');menu?.classList.add('hidden');id('mima-feature-toggle')?.setAttribute('aria-expanded','false');}
function toggle(){const menu=id('mima-feature-menu');if(!menu)return;const visible=menu.classList.toggle('hidden')===false;id('mima-feature-toggle').setAttribute('aria-expanded',String(visible));}
function init(){id('mima-feature-toggle')?.addEventListener('click',toggle);document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});document.addEventListener('pointerdown',e=>{if(!id('mima-feature-menu')?.contains(e.target)&&!id('mima-feature-toggle')?.contains(e.target))close();});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();root.MimaR6Nav={close,toggle};
})(typeof window!=='undefined'?window:globalThis);
