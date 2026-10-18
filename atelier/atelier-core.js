/* MIMA Theme Atelier R1 — independent authoring/runtime. No mutation of legacy stores. */
(() => {
'use strict';
const root=window, DB='mima-theme-atelier-v1', STORE='records', VERSION=1;
const TARGETS={
  shell:{label:'整体背景',real:'body',preview:'.atl-scene'},
  topbar:{label:'顶部导航',real:'.app-shell > header.topbar',preview:'.atl-demo-top'},
  composer:{label:'底部输入区',real:'.app-shell > footer.composer-shell',preview:'.atl-demo-composer'},
  button:{label:'主要按钮',real:'.app-shell .primary-btn,.app-shell .send-btn',preview:'.atl-demo-primary,.atl-demo-send'},
  secondary:{label:'次要按钮',real:'.app-shell .ghost-btn,.app-shell .chip-btn,.app-shell .nav-label',preview:'.atl-demo-secondary'},
  field:{label:'输入框',real:'.app-shell .field,.app-shell .composer-row textarea',preview:'.atl-demo-field'},
  message:{label:'剧情消息外观（不改正文字体）',real:'.app-shell .assistant-msg > .msg-content,.app-shell .user-msg > .msg-content',preview:'.atl-demo-message'},
  panel:{label:'弹窗/卡片（不改设置分组）',real:'.modal-panel,.session-drawer .session-item,.library-card',preview:'.atl-demo-card'},
  status:{label:'HTML 状态栏（默认不接管）',real:'.app-shell .tavern-story-content.safe-html-content > details,.app-shell .tavern-story-content.safe-html-content > system',preview:'.atl-demo-status'}
};
const DEFAULT={material:'glass',image:'',fontFamily:'inherit',imageOpacity:100,maskColor:'#000000',maskOpacity:0,paddingX:-1,paddingY:-1,borderTop:-1,borderRight:-1,borderBottom:-1,borderLeft:-1,fill:'#f4e9ed',ink:'#403745',accent:'#a67b94',alpha:88,radius:18,border:1,borderColor:'#ffffff',borderAlpha:65,blur:12,shadow:10,shadowY:5,ornament:'none',visualEffect:'none',decorColor:'#a67b94',decorOpacity:18,decorSize:26,imagePosX:50,imagePosY:50,animationDuration:3,gradient:'none',gradientTo:'#ffffff',angle:145,shape:'round',fontSize:15,stroke:0,strokeColor:'#ffffff',textShadow:0,animation:'none'};
const STYLES=[
  ['minimal-clear','极简透明','minimal','#eff1f3','#8992a0'],['liquid-frost','液态磨砂','glass','#e9dfee','#9e83ac'],['liquid-light','流光玻璃','glass','#d8e7f0','#7da5b9'],['flat-modern','现代扁平','flat','#f2f1f9','#8274ab'],
  ['retro-skeuo','复古拟物','skeuo','#dfc5b3','#8b654b'],['neumorphism','新拟物','neo','#e5e3ed','#8f88a9'],['claymorphism','软陶拟物','clay','#f1d8d7','#d78d9a'],['aqua-gloss','Aqua 水晶','aqua','#d5e7f4','#65a5ce'],
  ['material-expressive','Material Expressive','flat','#e4e6f7','#686daf'],['fluent-mica','Fluent 云母','glass','#e1edf3','#6799b0'],['swiss','瑞士极简','minimal','#f5f4f1','#373638'],['bento','Bento 模块','flat','#e9e7e5','#8f8276'],
  ['neobrutal','新粗野主义','brutal','#ffe9a7','#e27962'],['brutal','原始粗野','brutal','#e5e2d8','#494541'],['frutiger','Frutiger Aero','aqua','#bde6e4','#55a7be'],['y2k','Y2K 千禧未来','aqua','#e0d5f1','#9e70c4'],
  ['windows-retro','Windows 经典复古','skeuo','#d9d9d9','#5c70a9'],['cyberpunk','赛博朋克','brutal','#1d2435','#00b9c5'],['vaporwave','Vaporwave','glass','#e7b8e7','#a268d2'],['dark-academia','Dark Academia','skeuo','#554741','#b6a081'],
  ['galgame','日系 Galgame','glass','#e7dcf1','#a78abb'],['kawaii','Kawaii 可爱贴纸','clay','#ffe4ef','#ef92b1'],['aurora','Aurora 极光','glass','#d1dee9','#a08ccd'],['scrapbook','Paper Scrapbook','skeuo','#eddfc9','#a68a72']
];
const REGION_KEYS=Object.keys(TARGETS);
const defaultRegions=()=>Object.fromEntries(REGION_KEYS.map(k=>[k,k!=='status']));
const PATTERNS=['dots','grid','stripes','diagonal','checker','waves','rings','radial','diamond','cross','halftone','none'];
const clone=x=>JSON.parse(JSON.stringify(x));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(+n)?+n:a));
const hex=s=>/^#[0-9a-fA-F]{6}$/.test(String(s||''))?String(s):'#ffffff';
const safeName=s=>String(s||'主题').replace(/[<>\u0000-\u001f]/g,'').slice(0,80);
const validImage=s=>typeof s==='string'&&s.length<8*1024*1024&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);
const uid=()=>globalThis.crypto?.randomUUID?.()||`atelier-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rgba=(color,alpha=100)=>{let c=hex(color);return `rgba(${parseInt(c.slice(1,3),16)},${parseInt(c.slice(3,5),16)},${parseInt(c.slice(5,7),16)},${clamp(alpha,0,100)/100})`;};
function patternCSS(p){
  const c=rgba(p.color||'#a88a9d',p.opacity??35),s=clamp(p.size||16,5,160),w=clamp(p.weight||2,.5,25),d=clamp(p.angle??45,0,360);
  switch(p.type){
  case'dots':return {image:`radial-gradient(circle, ${c} ${w}px, transparent ${w+.4}px)`,size:`${s}px ${s}px`};
  case'grid':return {image:`linear-gradient(${c} ${w}px,transparent ${w}px),linear-gradient(90deg,${c} ${w}px,transparent ${w}px)`,size:`${s}px ${s}px,${s}px ${s}px`};
  case'stripes':return {image:`repeating-linear-gradient(${d}deg,${c} 0 ${w}px,transparent ${w}px ${s}px)`};
  case'diagonal':return {image:`repeating-linear-gradient(${d}deg,transparent 0 ${s-w}px,${c} ${s-w}px ${s}px)`};
  case'checker':return {image:`conic-gradient(${c} 25%,transparent 0 50%,${c} 0 75%,transparent 0)`,size:`${s*2}px ${s*2}px`};
  case'waves':return {image:`repeating-radial-gradient(ellipse at 25% 100%,transparent 0 ${s-w}px,${c} ${s-w}px ${s}px,transparent ${s}px ${s*2}px)`};
  case'rings':return {image:`repeating-radial-gradient(circle,transparent 0 ${s-w}px,${c} ${s-w}px ${s}px,transparent ${s}px ${s*2}px)`};
  case'radial':return {image:`repeating-conic-gradient(from ${d}deg,${c} 0deg 2deg,transparent 2deg ${Math.max(5,s)}deg)`};
  case'diamond':return {image:`linear-gradient(45deg,transparent 47%,${c} 48% 52%,transparent 53%),linear-gradient(-45deg,transparent 47%,${c} 48% 52%,transparent 53%)`,size:`${s}px ${s}px,${s}px ${s}px`};
  case'cross':return {image:`linear-gradient(90deg,transparent 45%,${c} 45% 55%,transparent 55%),linear-gradient(transparent 45%,${c} 45% 55%,transparent 55%)`,size:`${s}px ${s}px,${s}px ${s}px`};
  case'halftone':return {image:`radial-gradient(circle,${c} ${w*1.3}px,transparent ${w*1.3+.5}px)`,size:`${s}px ${s}px`};
  default:return null;
  }
}
function patternLayers(pats,part){const a=(pats||[]).filter(p=>p.enabled!==false&&p.type!=='none'&&patternCSS(p));return a.flatMap(p=>{const x=patternCSS(p);if(part==='position')return [`${clamp(p.offsetX??0,-500,500)}px ${clamp(p.offsetY??0,-500,500)}px`];return x[part]?[x[part]]:part==='size'?['auto']:[]});}
function atlasEffect(s){
 const color=rgba(s.decorColor,s.decorOpacity),soft=rgba(s.decorColor,Math.min(60,s.decorOpacity+12));
 const size=clamp(s.decorSize,6,100);
 switch(s.visualEffect){
 case 'stars':return {image:`radial-gradient(2px 2px at 25% 33%,${soft} 85%,transparent),radial-gradient(1px 1px at 78% 66%,${color} 90%,transparent)`,size:`${size*3}px ${size*3}px,${size*2}px ${size*2}px`};
 case 'lace':return {image:`radial-gradient(circle at 50% 0,transparent ${size/4}px,${color} ${size/4+.5}px,transparent ${size/3}px),radial-gradient(circle at 50% 100%,${color} 1px,transparent ${size/3}px)`,size:`${size}px ${size}px,${size*2}px ${size*2}px`};
 case 'bubbles':return {image:`radial-gradient(circle at 23% 36%,${color} 1px,transparent ${size/2}px),radial-gradient(circle at 77% 76%,transparent ${size/4}px,${soft} ${size/4+.5}px,transparent ${size/3}px)`,size:`${size*2}px ${size*2}px,${size*3}px ${size*3}px`};
 case 'grain':return {image:`repeating-linear-gradient(87deg,transparent 0 3px,${color} 4px 4.5px,transparent 5px 9px)`,size:`${size*2}px ${size*2}px`};
 case 'paper':return {image:`repeating-linear-gradient(0deg,${color} 0 .3px,transparent .3px ${size}px)`,size:`${size}px ${size}px`};
 case 'scanlines':return {image:`repeating-linear-gradient(0deg,${color} 0 1px,transparent 1px ${Math.max(4,size/5)}px)`,size:`auto`};
 case 'pixels':return {image:`conic-gradient(${color} 25%,transparent 0 50%,${color} 0 75%,transparent 0)`,size:`${size}px ${size}px`};
 case 'grid':case 'blueprint':return {image:`linear-gradient(${color} 1px,transparent 1px),linear-gradient(90deg,${color} 1px,transparent 1px)`,size:`${size}px ${size}px,${size}px ${size}px`};
 case 'gloss':return {image:`linear-gradient(150deg,rgba(255,255,255,.24),transparent 45%,${color})`,size:'cover'};
 case 'holo':return {image:`linear-gradient(120deg,${color},transparent 38%,${soft} 75%,transparent)`,size:'cover'};
 case 'ornate':return {image:`repeating-radial-gradient(circle at 0 0,transparent 0 ${size-1}px,${color} ${size-1}px ${size}px)`,size:`${size*2}px ${size*2}px`};
 case 'watercolor':return {image:`radial-gradient(ellipse at 20% 25%,${color},transparent 62%),radial-gradient(ellipse at 80% 70%,${soft},transparent 70%)`,size:'cover,cover'};
 case 'waves':return {image:`repeating-radial-gradient(ellipse at 0 100%,transparent 0 ${size-1}px,${color} ${size-1}px ${size}px,transparent ${size}px ${size*2}px)`,size:`${size*2}px ${size*2}px`};
 case 'dots':return {image:`radial-gradient(circle,${color} 1.4px,transparent 1.8px)`,size:`${size}px ${size}px`};
 case 'geometric':return {image:`linear-gradient(45deg,transparent 45%,${color} 46% 52%,transparent 53%),linear-gradient(-45deg,transparent 45%,${color} 46% 52%,transparent 53%)`,size:`${size*2}px ${size*2}px,${size*2}px ${size*2}px`};
 case 'stripes':return {image:`repeating-linear-gradient(135deg,${color} 0 1px,transparent 1px ${size}px)`,size:'auto'};
 case 'marble':return {image:`radial-gradient(ellipse at 15% 65%,${color},transparent 70%),repeating-linear-gradient(124deg,transparent 0 ${size*2}px,${soft} ${size*2}px ${size*2+1}px,transparent ${size*2+1}px ${size*4}px)`,size:'cover,auto'};
 default:return null;
 }
}
function styleRules(s0,pattern=[],key=''){const s={...DEFAULT,...s0},bg=rgba(s.fill,s.alpha),bd=rgba(s.borderColor,s.borderAlpha);
  const structural=['topbar','composer','panel','status'].includes(key),prose=key==='message',shapeSafe=['button','secondary'].includes(key);
  let images=patternLayers(pattern,'image'),sizes=patternLayers(pattern,'size'),positions=patternLayers(pattern,'position');const effect=atlasEffect(s);if(effect){const layerCount=effect.image.split(/,(?=\s*(?:radial-gradient|linear-gradient|repeating-|conic-gradient))/).length;images.push(effect.image);sizes.push(effect.size);positions.push('0 0');}
  let gradientImage='';if(s.gradient!=='none'){const to=rgba(s.gradientTo,s.alpha);const gradient=s.gradient==='radial'?`radial-gradient(circle at 28% 20%,${to},${bg})`:s.gradient==='conic'?`conic-gradient(from ${clamp(s.angle,0,360)}deg,${bg},${to},${bg})`:`linear-gradient(${clamp(s.angle,0,360)}deg,${to},${bg})`;gradientImage=gradient;}
  if(s.image){
    if(s.imageOpacity<100){images.push(`linear-gradient(${rgba(s.fill,100-clamp(s.imageOpacity,0,100))},${rgba(s.fill,100-clamp(s.imageOpacity,0,100))})`);sizes.push('cover');positions.push('0 0');}
    if(s.maskOpacity>0){images.push(`linear-gradient(${rgba(s.maskColor,s.maskOpacity)},${rgba(s.maskColor,s.maskOpacity)})`);sizes.push('cover');positions.push('0 0');}
    images.push(`url("${String(s.image).replace(/["\\]/g,'')}")`);sizes.push('cover');positions.push(`${clamp(s.imagePosX,0,100)}% ${clamp(s.imagePosY,0,100)}%`);
  }
  if(gradientImage){images.push(gradientImage);sizes.push('auto');positions.push('0 0');}
  const dark=rgba('#000000',Math.min(50,clamp(s.shadow,0,50)*1.6));const light=rgba('#ffffff',clamp(s.shadow,0,50)*1.8);
  let shadow=s.shadow?`0 ${clamp(s.shadowY,0,30)}px ${clamp(s.shadow,0,50)*1.5}px ${dark}`:'none';
  if(s.material==='neo')shadow=`${clamp(s.shadowY,0,30)}px ${clamp(s.shadow,0,50)}px ${clamp(s.shadow,0,50)*1.6}px ${dark},-${clamp(s.shadowY,0,30)}px -${clamp(s.shadow,0,50)}px ${clamp(s.shadow,0,50)*1.6}px ${light}`;
  if((s.material==='skeuo'||s.material==='aqua')&&shadow==='none')shadow='inset 0 1px 1px rgba(255,255,255,.01)';
  if(s.material==='skeuo'||s.material==='aqua')shadow+=`,inset 0 2px 3px rgba(255,255,255,.65),inset 0 -3px 5px rgba(0,0,0,.13)`;
  if(s.material==='brutal')shadow=`${clamp(s.shadow,0,50)/2}px ${clamp(s.shadow,0,50)/2}px 0 ${rgba('#111111',80)}`;
  const rules=[`background-color:${bg}`,images.length?`background-image:${images.join(',')}`:'background-image:none',images.length?`background-size:${sizes.join(',')}`:'',images.length?`background-position:${positions.join(',')}`:'',`border:${clamp(s.border,0,20)}px solid ${bd}`,`border-width:${['borderTop','borderRight','borderBottom','borderLeft'].map(k=>clamp(s[k]<0?s.border:s[k],0,20)+'px').join(' ')}`,s.paddingX>=0&&key!=='shell'?`padding-left:${clamp(s.paddingX,0,80)}px;padding-right:${clamp(s.paddingX,0,80)}px`:'',s.paddingY>=0&&key!=='shell'?`padding-top:${clamp(s.paddingY,0,80)}px;padding-bottom:${clamp(s.paddingY,0,80)}px`:'',`border-radius:${clamp(s.radius,0,100)}px`,`box-shadow:${shadow}`,s.blur>0?`backdrop-filter:blur(${clamp(s.blur,0,60)}px) saturate(${s.material==='aqua'?'1.35':'1.18'})`:'backdrop-filter:none',s.blur>0?`-webkit-backdrop-filter:blur(${clamp(s.blur,0,60)}px) saturate(${s.material==='aqua'?'1.35':'1.18'})`:'-webkit-backdrop-filter:none',(!prose?`color:${hex(s.ink)}`:''),(!structural&&!prose?`font-size:${clamp(s.fontSize,8,38)}px`:''),s.fontFamily&&s.fontFamily!=='inherit'?`font-family:${/^MimaAtelierFont_[A-Za-z0-9]+$/.test(s.fontFamily)?'"'+s.fontFamily+'"':(['system-ui','serif','monospace'].includes(s.fontFamily)?s.fontFamily:'inherit')}`:'',!structural&&!prose&&s.stroke>0?`-webkit-text-stroke:${clamp(s.stroke,0,4)}px ${hex(s.strokeColor)}`:'',!structural&&!prose&&s.textShadow?`text-shadow:0 1px ${clamp(s.textShadow,0,20)}px ${rgba(s.strokeColor,75)}`:''];
  if(s.material==='glass' || s.material==='aqua'){rules.push(`background-clip:padding-box`); if(s.blur>0)rules.push(`box-shadow:${shadow==='none'?'0 3px 15px rgba(10,15,25,.10)':shadow},inset 0 1px 0 rgba(255,255,255,.28)`);}
  if(prose){ // The font, margins, line-height and safe-HTML status descendants remain authored by the story renderer.
    const omit=/^(?:font-|color:|text-shadow|animation:|-webkit-text-stroke)/;for(let i=rules.length-1;i>=0;i--)if(omit.test(rules[i]))rules.splice(i,1);
  }
  if(s.shape==='pill')rules.push('border-radius:999px');
  if(shapeSafe&&s.shape==='hexagon')rules.push('clip-path:polygon(17% 0,83% 0,100% 50%,83% 100%,17% 100%,0 50%)');
  if(shapeSafe&&s.shape==='ticket')rules.push('clip-path:polygon(0 0,100% 0,100% 36%,94% 50%,100% 64%,100% 100%,0 100%,0 64%,6% 50%,0 36%)');
  if(s.shape==='cloud')rules.push('border-radius:48% 40% 45% 35% / 45% 50% 40% 48%');
  if(s.shape==='cookie')rules.push('border-radius:37% 43% 38% 44% / 40% 34% 46% 40%');
  if(shapeSafe&&s.animation==='float')rules.push(`animation:mima-atl-float ${clamp(s.animationDuration,.2,30)}s ease-in-out infinite`);
  if(shapeSafe&&s.animation==='glow')rules.push(`animation:mima-atl-glow ${clamp(s.animationDuration,.2,30)}s ease-in-out infinite alternate`);
  return (key==='shell'?rules.filter(x=>x.startsWith('background-')||x.startsWith('color:')):rules.filter(Boolean)).join(';')+';';
}
function baseTheme(id='liquid-frost'){
 const item=STYLES.find(x=>x[0]===id)||STYLES[1]; const [,name,kind,bg,accent]=item;let base={...DEFAULT,fill:bg,accent,ink:kind==='brutal'?'#29262c':'#443845',material:kind};
 if(kind==='minimal')Object.assign(base,{blur:0,shadow:0,border:1,alpha:58,radius:8});
 if(kind==='flat')Object.assign(base,{blur:0,shadow:0,border:0,alpha:100,radius:14});
 if(kind==='neo')Object.assign(base,{blur:0,shadow:14,border:0,alpha:100,radius:19});
 if(kind==='clay')Object.assign(base,{blur:0,shadow:19,border:1,alpha:100,radius:27});
 if(kind==='skeuo')Object.assign(base,{blur:0,shadow:15,border:2,alpha:97,radius:11,gradient:'linear'});
 if(kind==='aqua')Object.assign(base,{blur:8,shadow:18,border:2,alpha:86,radius:21,gradient:'linear'});
 if(kind==='brutal')Object.assign(base,{blur:0,shadow:9,border:3,alpha:100,radius:2});
 const elements={};Object.keys(TARGETS).forEach(k=>{elements[k]={...base}});
 elements.shell={...base,alpha:100,blur:0,border:0,radius:0,shadow:0,gradient:'linear',gradientTo:'#ffffff'};
 elements.button={...base,fill:accent,ink:'#ffffff',alpha:100,gradient:kind==='flat'||kind==='minimal'?'none':'linear',gradientTo:bg};
 elements.secondary={...base,fill:'#ffffff',alpha:55};
 elements.field={...base,fill:'#ffffff',alpha:78,blur:3};
 elements.message={...base,fill:'#ffffff',alpha:kind==='glass'?58:kind==='aqua'?62:24,border:kind==='glass'||kind==='aqua'?1:0,blur:kind==='glass'?14:kind==='aqua'?10:0,shadow:0};
 return {id:uid(),name:`${name} · 自定义`,format:'mima-atl-project',schema:1,template:id,originPreset:'',layoutRecipe:'story',cssPriority:'legacy-first',regions:defaultRegions(),nightMode:'app',elements,patterns:[],stickers:[],fonts:[],favorites:[],variants:{},extraCss:'',draftVersion:0,createdAt:Date.now(),updatedAt:Date.now()};
}
function normalized(raw){if(!raw||raw.format!=='mima-atl-project'||raw.schema!==1||!raw.elements||typeof raw.elements!=='object')throw new Error('不支持或损坏的主题工程格式');const obj=baseTheme(raw.template||'minimal-clear');obj.id=String(raw.id||uid());obj.name=safeName(raw.name);obj.originPreset=/^[a-z][a-z0-9-]{0,100}$/.test(String(raw.originPreset||''))?String(raw.originPreset):'';obj.layoutRecipe=/^[a-z][a-z0-9-]{0,80}$/.test(String(raw.layoutRecipe||''))?String(raw.layoutRecipe):'story';obj.cssPriority=['legacy-first','regions-first'].includes(raw.cssPriority)?raw.cssPriority:'legacy-first';obj.nightMode=['app','system','light','dark'].includes(raw.nightMode)?raw.nightMode:'app';obj.regions=defaultRegions();if(raw.regions&&typeof raw.regions==='object')for(const k of REGION_KEYS)if(Object.prototype.hasOwnProperty.call(raw.regions,k))obj.regions[k]=raw.regions[k]===true;obj.createdAt=Number(raw.createdAt)||Date.now();obj.updatedAt=Number(raw.updatedAt)||Date.now();obj.draftVersion=Math.max(0,Number(raw.draftVersion)||0);obj.linkedCssId=/^css[-_a-zA-Z0-9]+$/.test(String(raw.linkedCssId||''))?String(raw.linkedCssId):'';for(const k of Object.keys(TARGETS)){if(raw.elements[k]&&typeof raw.elements[k]==='object'){
 const e={...obj.elements[k]};for(const field of Object.keys(DEFAULT))if(Object.prototype.hasOwnProperty.call(raw.elements[k],field)){
 const v=raw.elements[k][field];e[field]=typeof DEFAULT[field]==='number'?clamp(v,-10000,10000):typeof v==='string'?v.slice(0,250):DEFAULT[field];
 } e.fill=hex(e.fill);e.ink=hex(e.ink);e.borderColor=hex(e.borderColor);e.strokeColor=hex(e.strokeColor);e.gradientTo=hex(e.gradientTo);e.maskColor=hex(e.maskColor);e.image=validImage(raw.elements[k].image)?raw.elements[k].image:'';obj.elements[k]=e;}}
 obj.fonts=Array.isArray(raw.fonts)?raw.fonts.slice(0,20).filter(x=>/^data:(font\/(woff2?|ttf|otf)|application\/(font-woff|x-font-ttf|x-font-opentype|octet-stream));base64,[A-Za-z0-9+/=]+$/.test(x?.src||'')&&x.src.length<12*1024*1024&&/^MimaAtelierFont_[A-Za-z0-9]+$/.test(x.family||'')).map(x=>({family:x.family,name:safeName(x.name),format:String(x.format||'woff2').replace(/[^a-z0-9]/gi,'').slice(0,6),src:x.src})):[];
 for(const key of Object.keys(TARGETS))if(!['inherit','system-ui','serif','monospace'].includes(obj.elements[key].fontFamily)&&!obj.fonts.some(x=>x.family===obj.elements[key].fontFamily))obj.elements[key].fontFamily='inherit';
 obj.patterns=Array.isArray(raw.patterns)?raw.patterns.slice(0,60).filter(x=>TARGETS[x.target]&&PATTERNS.includes(x.type)).map(x=>({id:String(x.id||uid()),target:x.target,type:x.type,color:hex(x.color),opacity:clamp(x.opacity,0,100),size:clamp(x.size,5,160),weight:clamp(x.weight,.5,25),angle:clamp(x.angle,0,360),offsetX:clamp(x.offsetX??0,-500,500),offsetY:clamp(x.offsetY??0,-500,500),enabled:x.enabled!==false})):[];
 obj.stickers=Array.isArray(raw.stickers)?raw.stickers.slice(0,40).filter(x=>validImage(x.src)&&TARGETS[x.anchor||'shell']).map(x=>({id:String(x.id||uid()),name:safeName(x.name),src:x.src,anchor:x.anchor||'shell',x:clamp(x.x,-150,250),y:clamp(x.y,-150,250),width:clamp(x.width,4,200),rotate:clamp(x.rotate,-360,360),opacity:clamp(x.opacity,0,100),hidden:!!x.hidden})):[];
 obj.extraCss=String(raw.extraCss||'').slice(0,100000);
 obj.favorites=Array.isArray(raw.favorites)?raw.favorites.slice(0,40).filter(x=>x&&typeof x.name==='string'&&x.style&&typeof x.style==='object').map(x=>({id:String(x.id||uid()),name:safeName(x.name),style:{...obj.elements.button,...Object.fromEntries(Object.keys(DEFAULT).filter(k=>Object.hasOwn(x.style,k)).map(k=>[k,x.style[k]]))}})):[];
 obj.variants={};if(raw.variants&&typeof raw.variants==='object'&&raw.variants.night?.elements){const v=normalized({...raw,elements:raw.variants.night.elements,patterns:raw.variants.night.patterns||[],stickers:[],favorites:[],variants:null,extraCss:''});obj.variants.night={elements:v.elements,patterns:v.patterns};}
 return obj;}
function atlasLayout(project,scope,mode){
 const layout=project.layoutRecipe||'story',c=rgba(project.elements?.panel?.fill||'#eeeeee',80),ink=hex(project.elements?.message?.ink||'#323232'),accent=hex(project.elements?.button?.fill||'#888888');
 const preview=mode==='preview',base=preview?`${scope} .atl-demo-chat`:`${scope} #story-chat-box`,session=preview?`${scope} .atl-demo-session-list`:`${scope} .session-drawer .session-list`;
 const item=preview?`${scope} .atl-demo-session-item`:`${scope} .session-drawer .session-item`;
 let css='';
 if(project.regions?.message!==false&&['role-bubble','soft-dock','photo-journal'].includes(layout)){
  const a=preview?`${scope} .atl-demo-message[data-demo-role="assistant"]`:`${base} > article.message.assistant-msg`;
  const u=preview?`${scope} .atl-demo-message[data-demo-role="user"]`:`${base} > article.message.user-msg`;
  const rad=layout==='photo-journal'?32:20;
  css+=`${a}{box-sizing:border-box;max-width:92%;width:fit-content;margin-left:0;margin-right:auto;border-radius:${rad}px ${rad}px ${rad}px 7px;align-self:flex-start;}\n${u}{box-sizing:border-box;max-width:92%;width:fit-content;margin-left:auto;margin-right:0;border-radius:${rad}px ${rad}px 7px ${rad}px;align-self:flex-end;}\n`;
  // Only the host message wrapper is repositioned: never touch nested safe HTML status components.
  css+=`${u} .msg-content{overflow-wrap:anywhere;}\n`;
 }
 if(project.regions?.composer!==false&&['role-bubble','soft-dock','photo-journal'].includes(layout)){
  const dock=preview?`${scope} .atl-demo-composer`:`${scope} .app-shell > footer.composer-shell`;
  css+=`${dock}{width:calc(100% - 20px);margin-left:10px;margin-right:10px;margin-bottom:6px;border-radius:30px;box-sizing:border-box;}\n`;
 }
 if(project.originPreset==='mima-inspo-k04'){
  const top=preview?`${scope} .atl-demo-top`:`${scope} .app-shell > header.topbar`;
  css+=`${top}{position:relative;}\n${top}::after{content:"୨୧";pointer-events:none;position:absolute;top:1px;left:50%;transform:translateX(-50%);font-size:12px;color:${accent};opacity:.72;}\n`;
 }
 if(layout==='editorial')css+=`${item}{border-radius:2px;box-shadow:none;border-width:0 0 1px 0;background:transparent;}\n`;
 if(layout==='soft-dock'||layout==='photo-journal')css+=`${session}{gap:12px;}\n${item}{border-radius:26px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}\n`;
 const columns={
  'bento-grid':'repeat(2,minmax(0,1fr))','masonry-flow':'repeat(2,minmax(0,1fr))','split-screen':'repeat(2,minmax(0,1fr))',
  'card-stack':'1fr','magazine-grid':'repeat(2,minmax(0,1fr))','dashboard-layout':'repeat(2,minmax(0,1fr))',
  'asymmetric-grid':'repeat(2,minmax(0,1fr))','horizontal-gallery':'repeat(5,minmax(175px,1fr))',
  'sidebar-fixed':'1fr','timeline-vertical':'1fr','f-pattern-layout':'1fr','z-pattern-layout':'1fr','holy-grail-layout':'1fr','parallax-editorial':'1fr'
 };
 if(columns[layout]){
  css+=`${preview?'':`${scope} .session-drawer{container-name:mima-atlas-sessions;container-type:inline-size;}\n`}${session}{display:grid;grid-template-columns:${columns[layout]};gap:10px;min-width:0;}\n${item}{min-width:0;max-width:100%;overflow-wrap:anywhere;}\n`;
  if(['bento-grid','magazine-grid','dashboard-layout','asymmetric-grid'].includes(layout))css+=`${item}:first-child{grid-column:span 2;}\n`;
  if(layout==='masonry-flow')css+=`${item}:nth-child(even){transform:translateY(8px)}\n`;
  if(layout==='card-stack')css+=`${item}{margin-bottom:-6px;box-shadow:0 7px 18px ${rgba(accent,20)};border-color:${rgba(accent,32)};}\n`;
  if(layout==='timeline-vertical')css+=`${session}{border-left:2px solid ${rgba(accent,50)};padding-left:12px;}\n${item}{border-radius:5px 20px 20px 5px;}\n`;
  if(layout==='horizontal-gallery')css+=`${session}{overflow-x:auto;grid-auto-flow:column;grid-auto-columns:minmax(175px,70%);grid-template-columns:none;scroll-snap-type:x mandatory;}\n${item}{scroll-snap-align:start;}\n`;
  if(layout==='f-pattern-layout')css+=`${item}:first-child{border-left:4px solid ${accent};}\n${item}:nth-child(n+2){margin-left:16px;}\n`;
  if(layout==='z-pattern-layout')css+=`${item}:nth-child(even){margin-left:15px;}\n${item}:nth-child(odd){margin-right:15px;}\n`;
  if(layout==='parallax-editorial')css+=`${item}{background:linear-gradient(135deg,${c},transparent);border-radius:2px 24px;}\n`;
  // A session drawer is normally ~320px even on wide screens. Use its own width, not window width.
  if(layout==='horizontal-gallery')css+=`${session}{container-type:normal;}\n`;
  else css+=`@container mima-atlas-sessions (max-width:286px){${session}{grid-template-columns:1fr;} ${item}:first-child{grid-column:auto;}}\n`;
 }
 return css;
}
function compile(project,mode='live'){
 const scope=mode==='preview'?'[data-atl-preview]':project.cssPriority==='legacy-first'?':where(html[data-mima-atelier-active])':'html[data-mima-atelier-active]';let result=`/* MIMA Theme Atelier | ${safeName(project.name)} | self contained CSS */\n`;
 for(const font of project.fonts||[])if(/^MimaAtelierFont_[A-Za-z0-9]+$/.test(font.family))result+=`@font-face{font-family:"${font.family}";src:url("${font.src}") format("${font.format}");font-display:swap;}\n`;
 for(const [key,target] of Object.entries(TARGETS)){
 if(project.regions?.[key]===false)continue;
 const rules=styleRules(project.elements[key],project.patterns.filter(p=>p.target===key),key);
 const selectors=(mode==='preview'?target.preview:target.real).split(',').map(x=>mode==='preview'?`${scope} ${x.trim()}`:project.cssPriority==='legacy-first'?`${scope} :where(${x.trim()})`:key==='shell'?`${scope} body`:`${scope} ${x.trim()}`).join(',');
 result+=`${selectors}{${rules}}\n`;
 const orn=project.elements[key]?.ornament;
 if((key==='button'||key==='secondary')&&['double','dotted','cream','inset'].includes(orn)){
  const borderColor=orn==='cream'?'rgba(255,255,255,.82)':rgba(project.elements[key].borderColor,80);
  const thickness=orn==='double'?3:orn==='dotted'?2:orn==='cream'?4:2;
  const variant=orn==='double'?'double':orn==='dotted'?'dotted':'solid';
  const inset=orn==='inset'?5:orn==='cream'?2:0;
  const pseudo=selectors.split(',').map(x=>x+'::before').join(',');
  result+=`${selectors}{position:relative;isolation:isolate;}\n${pseudo}{content:"";position:absolute;inset:${inset}px;pointer-events:none;border:${thickness}px ${variant} ${borderColor};border-radius:inherit;box-shadow:${orn==='cream'?'inset 0 2px 5px rgba(255,255,255,.50)':'none'};}\n`;
 }

 }
 result+=`@keyframes mima-atl-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}\n@keyframes mima-atl-glow{from{filter:brightness(.95)}to{filter:brightness(1.15)}}\n@media(prefers-reduced-motion:reduce){${scope} *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}\n`;
 // Extra CSS is an explicit advanced user-authored layer; it does not need to be parseable back into visual parameters.
 if(mode==='live'&&project.variants?.night&&project.nightMode!=='light'){const alt={...project,elements:project.variants.night.elements,patterns:project.variants.night.patterns,extraCss:'',variants:{},nightMode:'light'};let night=compile(alt,'live');
  if(project.nightMode==='system')result+=`\n@media (prefers-color-scheme:dark){\n${night}\n}\n`;
  else if(project.nightMode==='dark')result+=`\n${night}\n`;
  else {const nightScope=project.cssPriority==='legacy-first'?':where(html[data-mima-atelier-active][data-mima-theme="midnight"])':'html[data-mima-atelier-active][data-mima-theme="midnight"]';night=night.replaceAll(scope,nightScope);result+=`\n${night}\n`;}
 }
 result+=atlasLayout(project,scope,mode);
 if(mode==='live'&&project.extraCss)result+=`\n/* Advanced authored CSS, untouched */\n${project.extraCss}\n`;
 return result;
}
function dbOpen(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,VERSION);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||new Error('数据库打开失败'));q.onblocked=()=>reject(new Error('主题数据库被其他页面阻塞'));});}
let dbPromise=null;function getDB(){return dbPromise||(dbPromise=dbOpen().catch(e=>{dbPromise=null;throw e;}));}
async function get(key){const db=await getDB();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.onerror=()=>reject(t.error);});}
async function putMany(entries,expected=null){const db=await getDB();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);let failure=null; if(expected!==null){const q=s.get('active');q.onsuccess=()=>{const old=q.result||null;if((old?.version||0)!==expected){failure=new Error('其他窗口已更新当前主题，请重新打开后再应用。');t.abort();return;}entries.forEach(([k,v])=>s.put(v,k));};q.onerror=()=>{failure=q.error;t.abort();};}else entries.forEach(([k,v])=>s.put(v,k));t.oncomplete=()=>resolve();t.onabort=()=>reject(failure||t.error||new Error('事务取消'));t.onerror=()=>{failure=t.error};});}
async function keys(){const db=await getDB();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly'),q=t.objectStore(STORE).getAllKeys();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);t.onerror=()=>reject(t.error)});}
let active=null,applied=null,style=null,decor=null,channel=null,initialized=false,ready=null;
function bypass(){return new URLSearchParams(location.search).get('noCss')==='1'||sessionStorage.getItem('mima-atl-safe-disabled')==='1';}
function ensureStyle(){if(!style){style=document.getElementById('mima-atelier-runtime-style');if(!style){style=document.createElement('style');style.id='mima-atelier-runtime-style';document.head.appendChild(style);}}return style;}
function removeDecor(){if(decor){decor.remove();decor=null}}
function drawDecor(project){removeDecor();if(!project?.stickers?.length||bypass())return;decor=document.createElement('div');decor.id='mima-atelier-decor-root';decor.style.cssText='position:fixed;inset:0;z-index:25;pointer-events:none;overflow:visible';document.body.appendChild(decor);project.stickers.filter(s=>!s.hidden).forEach(s=>{const el=document.createElement('img');el.src=s.src;el.alt='';el.dataset.atlSticker=s.id;el.style.cssText=`position:fixed;max-width:none;pointer-events:none;user-select:none;opacity:${clamp(s.opacity,0,100)/100};transform:translate(-50%,-50%) rotate(${s.rotate}deg);`;decor.appendChild(el)});positionDecor();}
function positionDecor(){if(!decor||!applied)return;const rectAll={left:0,top:0,width:innerWidth,height:innerHeight};for(const sticker of applied.stickers){const el=Array.from(decor.children).find(x=>x.dataset.atlSticker===sticker.id);if(!el)continue;const t=TARGETS[sticker.anchor];const target=(t?.real||'').split(',')[0];const r=sticker.anchor==='shell'?rectAll:(document.querySelector(target)?.getBoundingClientRect()||null);if(!r){el.style.display='none';continue;}el.style.display='';el.style.left=(r.left+r.width*sticker.x/100)+'px';el.style.top=(r.top+r.height*sticker.y/100)+'px';el.style.width=(r.width*sticker.width/100)+'px';}}
function syncPriority(){if(!style?.isConnected)return;const first=applied?.cssPriority==='legacy-first';const legacy=['mima-custom-css-style','mima-global-css-style'].map(id=>document.getElementById(id)).filter(el=>el?.parentNode===document.head).sort((a,b)=>(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)?-1:1)[0];if(first&&legacy)document.head.insertBefore(style,legacy);else document.head.appendChild(style);}
function activate(project){if(bypass()){ensureStyle().textContent='';document.documentElement.removeAttribute('data-mima-atelier-active');removeDecor();applied=null;return;}
 const css=compile(project);if(typeof CSSStyleSheet!=='undefined'&&CSSStyleSheet.prototype.replaceSync){const sheet=new CSSStyleSheet();sheet.replaceSync(css);}
 ensureStyle().textContent=css;document.documentElement.setAttribute('data-mima-atelier-active','1');applied=clone(project);syncPriority();drawDecor(applied);
}
function deactivate(){ensureStyle().textContent='';document.documentElement.removeAttribute('data-mima-atelier-active');applied=null;removeDecor();}
function disabled(){sessionStorage.setItem('mima-atl-safe-disabled','1');deactivate();}
function reaffirm(){syncPriority();}
async function initialize(){if(initialized)return;initialized=true;try{active=await get('active')||{id:null,version:0};if(active.id&&!bypass()){const p=await get(active.releaseKey||('release:'+active.id+':'+active.version));if(!p)throw Error('激活版本的固定快照不存在；保留原始界面且不覆盖任何资料');activate(normalized(p));} if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel(DB);channel.onmessage=async e=>{if(e.data?.kind==='activated'){try{const a=await get('active');if(!a||a.version<=(active?.version||0))return;const p=a.id?await get(a.releaseKey||('release:'+a.id+':'+a.version)):null;if(a.id&&!p)throw new Error('跨窗口主题内容丢失');if(p&&!bypass())activate(normalized(p));else deactivate();active=a;}catch(err){console.error('[Theme Atelier] cross-tab sync',err)}}};}}
 catch(e){console.error('[Theme Atelier] startup failed; legacy theme unchanged',e);deactivate();throw e;}}
ready=initialize();ready.catch(()=>{});
window.addEventListener('resize',positionDecor);document.addEventListener('scroll',positionDecor,true);window.visualViewport?.addEventListener('resize',positionDecor);
// App renders portions of the UI asynchronously; keep attachments in sync without touching source containers.
let lastPosition=0;const observer=new MutationObserver(()=>{if(decor){const now=Date.now();if(now-lastPosition>100){lastPosition=now;requestAnimationFrame(positionDecor)}}});
window.addEventListener('DOMContentLoaded',()=>{observer.observe(document.body,{childList:true,subtree:true});});
async function saveHistory(key,project){await putMany([[key,normalized(project)]]);}
async function latestHistory(id){const found=(await keys()).filter(k=>String(k).startsWith('history:'+id+':')).sort();return found.length?await get(found[found.length-1]):null;}
async function saveDraft(project){
 const p=normalized(project),expected=p.draftVersion||0,db=await getDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get('project:'+p.id);let failure=null;
  request.onsuccess=()=>{
   const old=request.result;
   if((old?.draftVersion||0)!==expected){failure=Object.assign(new Error('草稿版本冲突：本页版本 '+expected+'，存储版本 '+(old?.draftVersion||0)+'。原记录未被覆盖。'),{code:'E_ATL_DRAFT_CONFLICT',draftId:p.id,expected,actual:old?.draftVersion||0});tx.abort();return;}
   p.draftVersion=expected+1;p.updatedAt=Math.max(Date.now(),(old?.updatedAt||0)+1);
   store.put(p,'project:'+p.id);store.put({id:p.id,updatedAt:p.updatedAt},'lastEdited');
  };
  request.onerror=()=>{failure=request.error;tx.abort()};
  tx.oncomplete=()=>resolve(p);tx.onabort=()=>reject(failure||tx.error||Error('草稿保存已取消'));
  tx.onerror=()=>{failure=tx.error};
 });
}
async function listProjects(){return (await keys()).filter(k=>String(k).startsWith('project:')).map(k=>String(k).slice(8));}
async function saveManual(project){const p=normalized(project);const key='manual:'+uid();await putMany([[key,{...p,manualSavedAt:Date.now()}]]);return key;}
async function listManual(){const ks=(await keys()).filter(k=>String(k).startsWith('manual:'));return Promise.all(ks.map(async k=>({key:k,project:await get(k)})));}
async function forkDraft(raw){const p=normalized({...raw,id:uid(),draftVersion:0,linkedCssId:'',updatedAt:Date.now()});return saveDraft(p);}
function exportPresetCss(project){const p=normalized(project);p.cssPriority='regions-first';const css=compile(p);const stickers=p.stickers?.length?`/* NOTE: ${p.stickers.length} dynamic stickers require the Atelier decoration DOM and are not reproducible in plain CSS. */\n`:'';return `/* MIMA ATELIER standalone CSS preset: user-enabled only; local style scopes; no automatic mounting. */\n`+stickers+css.replaceAll('html[data-mima-atelier-active]','html');}

async function apply(project){await ready;const p=normalized(project);const css=compile(p);if(!bypass()&&typeof CSSStyleSheet!=='undefined'&&CSSStyleSheet.prototype.replaceSync){const x=new CSSStyleSheet();x.replaceSync(css);}const was=applied?clone(applied):null;const previous=active||{id:null,version:0};const next={id:p.id,version:(previous.version||0)+1,releaseKey:'release:'+p.id+':'+((previous.version||0)+1),updatedAt:Date.now()};
 // Save theme and active pointer in one canonical transaction. Never report success before actual visual activation.
 await putMany([['project:'+p.id,p],[next.releaseKey,p],['active',next]],previous.version||0);
 try{if(!bypass())activate(p);else deactivate();active=next;channel?.postMessage({kind:'activated'});return next;}
 catch(e){console.error('[Theme Atelier] activation after durable commit failed',e);try{if(was&&!bypass())activate(was);else deactivate();await putMany([['active',{...previous,version:next.version+1}]],next.version);active={...previous,version:next.version+1};channel?.postMessage({kind:'activated'});}catch(recoveryError){console.error('[Theme Atelier] rollback failed',recoveryError)}throw e;}
}
async function unapply(){await ready;const previous=active||{id:null,version:0},next={id:null,version:previous.version+1,updatedAt:Date.now()};await putMany([['active',next]],previous.version);deactivate();active=next;channel?.postMessage({kind:'activated'});}
window.MimaAtelierCore={TARGETS,DEFAULT,STYLES,PATTERNS,baseTheme,normalized,clone,clamp,hex,esc,rgba,uid,patternCSS,compile,get,saveDraft,apply,unapply,disabled,reaffirm,bypass,ready,_historySave:saveHistory,_historyLatest:latestHistory,listProjects,saveManual,listManual,forkDraft,exportPresetCss,getActive:()=>clone(active||{id:null,version:0}),getApplied:()=>applied&&clone(applied),positionDecor};
})();
