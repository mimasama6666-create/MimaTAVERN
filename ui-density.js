/* Component coordinates and legacy appearance surfaces share one density service.
   Author root typography remains entirely in the normal CSS cascade. */
(() => {
 'use strict';
 let density=100,lastApplied=null;
 function dimensions(value){return value.replace(/url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(-?(?:\d*\.)?\d+)(px|rem)\b/gi,(whole,n,unit)=>n===undefined||Number(n)===0?whole:'calc('+n+unit+' * var(--mima-component-unit))');}
 function install(){} // Program declarations are prepared in the shipped CSS, never rewritten in CSSOM.
 const active=id=>{const tag=document.getElementById(id);return !!tag?.textContent.trim()&&!tag.disabled&&!tag.sheet?.disabled&&(!tag.media||matchMedia(tag.media).matches);};
 function apply(){
  install();const root=document.documentElement,global=active('mima-global-css-style');
  const surfaces={story:!global&&active('mima-custom-css-style'),assistant:!global&&active('assistant-custom-css'),novel:!global&&active('novel-project-custom-css')};
  root.dataset.mimaDensityCoordinates=global?'user-theme':'components';for(const [name,enabled]of Object.entries(surfaces))root.dataset['mimaDensity'+name[0].toUpperCase()+name.slice(1)]=enabled?'legacy':'components';
  root.style.setProperty('--mima-component-unit',global?'1':'.8');root.style.setProperty('--mima-ui-scale',String(density/100*(global?.8:1)));root.style.setProperty('--mima-legacy-coordinate-scale',String(density/125));
  const key=JSON.stringify([density,global,surfaces]);if(lastApplied!==key){lastApplied=key;requestAnimationFrame(()=>window.autoResizeInput?.());document.dispatchEvent(new CustomEvent('mima-density-change'));}
 }
 const inlineFonts=new WeakMap();
 function inlineFont(el){if(el.nodeType!==1||el.closest('.tavern-story-content,[data-mima-display-boundary],.novel-reading-body,.novel-prose-view,.novel-draft-prose'))return;const value=el.style.fontSize;if(!value||inlineFonts.get(el)===value)return;const next=dimensions(value).replaceAll('var(--mima-ui-scale','var(--mima-legacy-coordinate-scale');if(next!==value)el.style.setProperty('font-size',next,el.style.getPropertyPriority('font-size'));inlineFonts.set(el,el.style.fontSize);}
 // Inline UI labels have a bounded lifecycle in their own panels. Generated
 // story DOM, keyboard styles and the whole document body are never observed.
 function adapt(root){if(!root)return;inlineFont(root);for(const el of root.querySelectorAll('[style*="font-size"]'))inlineFont(el);}
 const panels=['settings-content','assistant-studio-root','novel-studio-root','compat-lab'];
 for(const id of panels){const panel=document.getElementById(id);if(!panel)continue;adapt(panel);new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')inlineFont(r.target);else for(const node of r.addedNodes)if(node.nodeType===1&&!node.matches('.tavern-story-content,[data-mima-display-boundary]')&&!node.closest('.tavern-story-content,[data-mima-display-boundary]'))adapt(node);}}).observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});}
 function rebaseUrls(css,base){return css.replace(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi,(whole,a,b,c)=>{const raw=(a??b??c??'').trim();if(/^(?:data:|blob:|#)/i.test(raw))return whole;try{const plain=raw.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi,(_,hex,literal)=>hex?String.fromCodePoint(parseInt(hex,16)):literal);return 'url("'+new URL(plain,base).href.replace(/"/g,'%22')+'")';}catch(_){return whole;}});}
 function sheetText(sheet,base){return [...sheet.cssRules].map(rule=>{if(rule.type===3&&rule.styleSheet){let css=sheetText(rule.styleSheet,rule.href);if(rule.media?.mediaText)css='@media '+rule.media.mediaText+'{'+css+'}';if(rule.supportsText)css='@supports ('+rule.supportsText+'){'+css+'}';if(rule.layerName!==undefined&&rule.layerName!==null)css='@layer '+rule.layerName+'{'+css+'}';return css;}return rebaseUrls(window.MimaThemeCanvas?.serializeRule?.(rule)||rule.cssText,base);}).join('\n');}
 function snapshotHead(head){
  for(const node of document.head.querySelectorAll('link[rel="stylesheet"],style:not([data-mima-display-sheet]):not([data-mima-display-guard])')){
   if(node.disabled||node.sheet?.disabled)continue;
   if(node.sheet)try{const tag=head.ownerDocument.createElement('style');tag.dataset.mimaStyleSnapshot=node.getAttribute('href')||node.id||'inline';if(node.media)tag.media=node.media;tag.textContent=sheetText(node.sheet,node.sheet.href||document.baseURI);head.append(tag);continue;}catch(error){if(error.name!=='SecurityError')throw error;}
   head.append(head.ownerDocument.importNode(node,true));
  }
 }
 function effectiveZoom(el){if(Number(el?.currentCSSZoom)>0)return Number(el.currentCSSZoom);let zoom=1;for(let node=el;node;node=node.parentElement)zoom*=parseFloat(getComputedStyle(node).zoom)||1;return zoom;}
 window.MimaUiDensity={adapt,set(value){density=value;apply();},install,dimensions,snapshotHead,effectiveZoom};
 const themeTags='#mima-global-css-style,#mima-custom-css-style,#assistant-custom-css,#novel-project-custom-css';
 if(document.head)new MutationObserver(records=>{let changed=false;for(const r of records){const target=r.target.nodeType===1?r.target:r.target.parentElement;if(target?.matches(themeTags))changed=true;for(const node of [...r.addedNodes||[],...r.removedNodes||[]])if(node.nodeType===1){if(node.matches(themeTags))changed=true;else if(node.matches('link[rel=stylesheet]'))node.addEventListener('load',apply,{once:true});}}if(changed)apply();}).observe(document.head,{childList:true,characterData:true,attributes:true,attributeFilter:['disabled','media'],subtree:true});
 apply();
})();
