/* MIMA Theme Atelier R1 — independent authoring/runtime. No mutation of legacy stores. */
(() => {
'use strict';
const root=window, DB='mima-theme-atelier-v1', STORE='records', VERSION=1;
const TARGETS={
  shell:{label:'整体背景',real:'body',preview:'.atl-scene'},
  topbar:{label:'顶部导航',real:'.topbar',preview:'.atl-demo-top'},
  composer:{label:'底部输入区',real:'.composer-shell',preview:'.atl-demo-composer'},
  button:{label:'主要按钮',real:'.primary-btn,.send-btn',preview:'.atl-demo-primary,.atl-demo-send'},
  secondary:{label:'次要按钮',real:'.ghost-btn,.chip-btn,.nav-label',preview:'.atl-demo-secondary'},
  field:{label:'输入框',real:'.field,.composer-row textarea',preview:'.atl-demo-field'},
  message:{label:'剧情正文',real:'.msg-content',preview:'.atl-demo-message'},
  panel:{label:'弹窗/卡片',real:'.modal-panel,.library-card,.settings-section',preview:'.atl-demo-card'},
  status:{label:'状态栏/折叠面板',real:'.tavern-story-content details,.tavern-story-content system',preview:'.atl-demo-status'}
};
const DEFAULT={material:'glass',image:'',fontFamily:'inherit',imageOpacity:100,maskColor:'#000000',maskOpacity:0,paddingX:-1,paddingY:-1,borderTop:-1,borderRight:-1,borderBottom:-1,borderLeft:-1,fill:'#f4e9ed',ink:'#403745',accent:'#a67b94',alpha:88,radius:18,border:1,borderColor:'#ffffff',borderAlpha:65,blur:12,shadow:10,shadowY:5,ornament:'none',animationDuration:3,gradient:'none',gradientTo:'#ffffff',angle:145,shape:'round',fontSize:15,stroke:0,strokeColor:'#ffffff',textShadow:0,animation:'none'};
const STYLES=[
  ['minimal-clear','极简透明','minimal','#eff1f3','#8992a0'],['liquid-frost','液态磨砂','glass','#e9dfee','#9e83ac'],['liquid-light','流光玻璃','glass','#d8e7f0','#7da5b9'],['flat-modern','现代扁平','flat','#f2f1f9','#8274ab'],
  ['retro-skeuo','复古拟物','skeuo','#dfc5b3','#8b654b'],['neumorphism','新拟物','neo','#e5e3ed','#8f88a9'],['claymorphism','软陶拟物','clay','#f1d8d7','#d78d9a'],['aqua-gloss','Aqua 水晶','aqua','#d5e7f4','#65a5ce'],
  ['material-expressive','Material Expressive','flat','#e4e6f7','#686daf'],['fluent-mica','Fluent 云母','glass','#e1edf3','#6799b0'],['swiss','瑞士极简','minimal','#f5f4f1','#373638'],['bento','Bento 模块','flat','#e9e7e5','#8f8276'],
  ['neobrutal','新粗野主义','brutal','#ffe9a7','#e27962'],['brutal','原始粗野','brutal','#e5e2d8','#494541'],['frutiger','Frutiger Aero','aqua','#bde6e4','#55a7be'],['y2k','Y2K 千禧未来','aqua','#e0d5f1','#9e70c4'],
  ['windows-retro','Windows 经典复古','skeuo','#d9d9d9','#5c70a9'],['cyberpunk','赛博朋克','brutal','#1d2435','#00b9c5'],['vaporwave','Vaporwave','glass','#e7b8e7','#a268d2'],['dark-academia','Dark Academia','skeuo','#554741','#b6a081'],
  ['galgame','日系 Galgame','glass','#e7dcf1','#a78abb'],['kawaii','Kawaii 可爱贴纸','clay','#ffe4ef','#ef92b1'],['aurora','Aurora 极光','glass','#d1dee9','#a08ccd'],['scrapbook','Paper Scrapbook','skeuo','#eddfc9','#a68a72']
];
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
function patternLayers(pats,part){const a=(pats||[]).filter(p=>p.enabled!==false&&p.type!=='none'&&patternCSS(p));return a.flatMap(p=>{const x=patternCSS(p);return x[part]?[x[part]]:part==='size'?['auto']:[]});}
function styleRules(s0,pattern=[],key=''){const s={...DEFAULT,...s0},bg=rgba(s.fill,s.alpha),bd=rgba(s.borderColor,s.borderAlpha);
  let images=patternLayers(pattern,'image'),sizes=patternLayers(pattern,'size');
  let gradientImage='';if(s.gradient!=='none'){const to=rgba(s.gradientTo,s.alpha);const gradient=s.gradient==='radial'?`radial-gradient(circle at 28% 20%,${to},${bg})`:s.gradient==='conic'?`conic-gradient(from ${clamp(s.angle,0,360)}deg,${bg},${to},${bg})`:`linear-gradient(${clamp(s.angle,0,360)}deg,${to},${bg})`;gradientImage=gradient;}
  if(s.image){
    if(s.imageOpacity<100){images.push(`linear-gradient(${rgba(s.fill,100-clamp(s.imageOpacity,0,100))},${rgba(s.fill,100-clamp(s.imageOpacity,0,100))})`);sizes.push('cover');}
    if(s.maskOpacity>0){images.push(`linear-gradient(${rgba(s.maskColor,s.maskOpacity)},${rgba(s.maskColor,s.maskOpacity)})`);sizes.push('cover');}
    images.push(`url("${String(s.image).replace(/["\\]/g,'')}")`);sizes.push('cover');
  }
  if(gradientImage){images.push(gradientImage);sizes.push('auto');}
  const dark=rgba('#000000',Math.min(50,clamp(s.shadow,0,50)*1.6));const light=rgba('#ffffff',clamp(s.shadow,0,50)*1.8);
  let shadow=s.shadow?`0 ${clamp(s.shadowY,0,30)}px ${clamp(s.shadow,0,50)*1.5}px ${dark}`:'none';
  if(s.material==='neo')shadow=`${clamp(s.shadowY,0,30)}px ${clamp(s.shadow,0,50)}px ${clamp(s.shadow,0,50)*1.6}px ${dark},-${clamp(s.shadowY,0,30)}px -${clamp(s.shadow,0,50)}px ${clamp(s.shadow,0,50)*1.6}px ${light}`;
  if((s.material==='skeuo'||s.material==='aqua')&&shadow==='none')shadow='inset 0 1px 1px rgba(255,255,255,.01)';
  if(s.material==='skeuo'||s.material==='aqua')shadow+=`,inset 0 2px 3px rgba(255,255,255,.65),inset 0 -3px 5px rgba(0,0,0,.13)`;
  if(s.material==='brutal')shadow=`${clamp(s.shadow,0,50)/2}px ${clamp(s.shadow,0,50)/2}px 0 ${rgba('#111111',80)}`;
  const rules=[`background-color:${bg}`,images.length?`background-image:${images.join(',')}`:'background-image:none',images.length?`background-size:${sizes.join(',')}`:'',`border:${clamp(s.border,0,20)}px solid ${bd}`,`border-width:${['borderTop','borderRight','borderBottom','borderLeft'].map(k=>clamp(s[k]<0?s.border:s[k],0,20)+'px').join(' ')}`,s.paddingX>=0&&key!=='shell'?`padding-left:${clamp(s.paddingX,0,80)}px;padding-right:${clamp(s.paddingX,0,80)}px`:'',s.paddingY>=0&&key!=='shell'?`padding-top:${clamp(s.paddingY,0,80)}px;padding-bottom:${clamp(s.paddingY,0,80)}px`:'',`border-radius:${clamp(s.radius,0,100)}px`,`box-shadow:${shadow}`,s.blur>0?`backdrop-filter:blur(${clamp(s.blur,0,60)}px)`:'backdrop-filter:none',s.blur>0?`-webkit-backdrop-filter:blur(${clamp(s.blur,0,60)}px)`:'-webkit-backdrop-filter:none',`color:${hex(s.ink)}`,`font-size:${clamp(s.fontSize,8,38)}px`,s.fontFamily&&s.fontFamily!=='inherit'?`font-family:${/^MimaAtelierFont_[A-Za-z0-9]+$/.test(s.fontFamily)?'"'+s.fontFamily+'"':(['system-ui','serif','monospace'].includes(s.fontFamily)?s.fontFamily:'inherit')}`:'',s.stroke>0?`-webkit-text-stroke:${clamp(s.stroke,0,4)}px ${hex(s.strokeColor)}`:'',s.textShadow?`text-shadow:0 1px ${clamp(s.textShadow,0,20)}px ${rgba(s.strokeColor,75)}`:'text-shadow:none'];
  if(s.shape==='pill')rules.push('border-radius:999px');
  if(s.shape==='hexagon')rules.push('clip-path:polygon(17% 0,83% 0,100% 50%,83% 100%,17% 100%,0 50%)');
  if(s.shape==='ticket')rules.push('clip-path:polygon(0 0,100% 0,100% 36%,94% 50%,100% 64%,100% 100%,0 100%,0 64%,6% 50%,0 36%)');
  if(s.shape==='cloud')rules.push('border-radius:48% 40% 45% 35% / 45% 50% 40% 48%');
  if(s.shape==='cookie')rules.push('border-radius:37% 43% 38% 44% / 40% 34% 46% 40%');
  if(s.animation==='float')rules.push(`animation:mima-atl-float ${clamp(s.animationDuration,.2,30)}s ease-in-out infinite`);
  if(s.animation==='glow')rules.push(`animation:mima-atl-glow ${clamp(s.animationDuration,.2,30)}s ease-in-out infinite alternate`);
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
 elements.message={...base,fill:'#ffffff',alpha:24,border:0,blur:0,shadow:0};
 return {id:uid(),name:`${name} · 自定义`,format:'mima-atl-project',schema:1,template:id,elements,patterns:[],stickers:[],fonts:[],favorites:[],variants:{},extraCss:'',createdAt:Date.now(),updatedAt:Date.now()};
}
function normalized(raw){if(!raw||raw.format!=='mima-atl-project'||raw.schema!==1||!raw.elements||typeof raw.elements!=='object')throw new Error('不支持或损坏的主题工程格式');const obj=baseTheme(raw.template||'minimal-clear');obj.id=String(raw.id||uid());obj.name=safeName(raw.name);obj.createdAt=Number(raw.createdAt)||Date.now();obj.updatedAt=Number(raw.updatedAt)||Date.now();for(const k of Object.keys(TARGETS)){if(raw.elements[k]&&typeof raw.elements[k]==='object'){
 const e={...obj.elements[k]};for(const field of Object.keys(DEFAULT))if(Object.prototype.hasOwnProperty.call(raw.elements[k],field)){
 const v=raw.elements[k][field];e[field]=typeof DEFAULT[field]==='number'?clamp(v,-10000,10000):typeof v==='string'?v.slice(0,250):DEFAULT[field];
 } e.fill=hex(e.fill);e.ink=hex(e.ink);e.borderColor=hex(e.borderColor);e.strokeColor=hex(e.strokeColor);e.gradientTo=hex(e.gradientTo);e.maskColor=hex(e.maskColor);e.image=validImage(raw.elements[k].image)?raw.elements[k].image:'';obj.elements[k]=e;}}
 obj.fonts=Array.isArray(raw.fonts)?raw.fonts.slice(0,20).filter(x=>/^data:(font\/(woff2?|ttf|otf)|application\/(font-woff|x-font-ttf|x-font-opentype|octet-stream));base64,[A-Za-z0-9+/=]+$/.test(x?.src||'')&&x.src.length<12*1024*1024&&/^MimaAtelierFont_[A-Za-z0-9]+$/.test(x.family||'')).map(x=>({family:x.family,name:safeName(x.name),format:String(x.format||'woff2').replace(/[^a-z0-9]/gi,'').slice(0,6),src:x.src})):[];
 for(const key of Object.keys(TARGETS))if(!['inherit','system-ui','serif','monospace'].includes(obj.elements[key].fontFamily)&&!obj.fonts.some(x=>x.family===obj.elements[key].fontFamily))obj.elements[key].fontFamily='inherit';
 obj.patterns=Array.isArray(raw.patterns)?raw.patterns.slice(0,60).filter(x=>TARGETS[x.target]&&PATTERNS.includes(x.type)).map(x=>({id:String(x.id||uid()),target:x.target,type:x.type,color:hex(x.color),opacity:clamp(x.opacity,0,100),size:clamp(x.size,5,160),weight:clamp(x.weight,.5,25),angle:clamp(x.angle,0,360),enabled:x.enabled!==false})):[];
 obj.stickers=Array.isArray(raw.stickers)?raw.stickers.slice(0,40).filter(x=>validImage(x.src)&&TARGETS[x.anchor||'shell']).map(x=>({id:String(x.id||uid()),name:safeName(x.name),src:x.src,anchor:x.anchor||'shell',x:clamp(x.x,-150,250),y:clamp(x.y,-150,250),width:clamp(x.width,4,200),rotate:clamp(x.rotate,-360,360),opacity:clamp(x.opacity,0,100),hidden:!!x.hidden})):[];
 obj.extraCss=String(raw.extraCss||'').slice(0,100000);
 obj.favorites=Array.isArray(raw.favorites)?raw.favorites.slice(0,40).filter(x=>x&&typeof x.name==='string'&&x.style&&typeof x.style==='object').map(x=>({id:String(x.id||uid()),name:safeName(x.name),style:{...obj.elements.button,...Object.fromEntries(Object.keys(DEFAULT).filter(k=>Object.hasOwn(x.style,k)).map(k=>[k,x.style[k]]))}})):[];
 obj.variants={};if(raw.variants&&typeof raw.variants==='object'&&raw.variants.night?.elements){const v=normalized({...raw,elements:raw.variants.night.elements,patterns:raw.variants.night.patterns||[],stickers:[],favorites:[],variants:null,extraCss:''});obj.variants.night={elements:v.elements,patterns:v.patterns};}
 return obj;}
function compile(project,mode='live'){
 const scope=mode==='preview'?'[data-atl-preview]':'html[data-mima-atelier-active]';let result=`/* MIMA Theme Atelier | ${safeName(project.name)} | self contained CSS */\n`;
 for(const font of project.fonts||[])if(/^MimaAtelierFont_[A-Za-z0-9]+$/.test(font.family))result+=`@font-face{font-family:"${font.family}";src:url("${font.src}") format("${font.format}");font-display:swap;}\n`;
 for(const [key,target] of Object.entries(TARGETS)){
 const rules=styleRules(project.elements[key],project.patterns.filter(p=>p.target===key),key);
 const selectors=(mode==='preview'?target.preview:target.real).split(',').map(x=>mode==='preview'?`${scope} ${x.trim()}`:key==='shell'?`${scope} body`:`${scope} ${x.trim()}`).join(',');
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
 if(mode==='live'&&project.variants?.night){const alt={...project,elements:project.variants.night.elements,patterns:project.variants.night.patterns,extraCss:'',variants:{}};result+=`\n@media (prefers-color-scheme:dark){\n${compile(alt,'live')}\n}\n`;}
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
function activate(project){if(bypass()){ensureStyle().textContent='';document.documentElement.removeAttribute('data-mima-atelier-active');removeDecor();applied=null;return;}
 const css=compile(project);if(typeof CSSStyleSheet!=='undefined'&&CSSStyleSheet.prototype.replaceSync){const sheet=new CSSStyleSheet();sheet.replaceSync(css);}
 ensureStyle().textContent=css;document.head.appendChild(style);document.documentElement.setAttribute('data-mima-atelier-active','1');applied=clone(project);drawDecor(applied);
}
function deactivate(){ensureStyle().textContent='';document.documentElement.removeAttribute('data-mima-atelier-active');applied=null;removeDecor();}
function disabled(){sessionStorage.setItem('mima-atl-safe-disabled','1');deactivate();}
function reaffirm(){if(style?.isConnected)document.head.appendChild(style);}
async function initialize(){if(initialized)return;initialized=true;try{active=await get('active')||{id:null,version:0};if(active.id&&!bypass()){const p=await get(active.releaseKey||('release:'+active.id+':'+active.version));if(!p)throw Error('激活版本的固定快照不存在；保留原始界面且不覆盖任何资料');activate(normalized(p));} if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel(DB);channel.onmessage=async e=>{if(e.data?.kind==='activated'){try{const a=await get('active');if(!a||a.version<=(active?.version||0))return;const p=a.id?await get(a.releaseKey||('release:'+a.id+':'+a.version)):null;if(a.id&&!p)throw new Error('跨窗口主题内容丢失');if(p&&!bypass())activate(normalized(p));else deactivate();active=a;}catch(err){console.error('[Theme Atelier] cross-tab sync',err)}}};}}
 catch(e){console.error('[Theme Atelier] startup failed; legacy theme unchanged',e);deactivate();throw e;}}
ready=initialize();ready.catch(()=>{});
window.addEventListener('resize',positionDecor);document.addEventListener('scroll',positionDecor,true);window.visualViewport?.addEventListener('resize',positionDecor);
// App renders portions of the UI asynchronously; keep attachments in sync without touching source containers.
let lastPosition=0;const observer=new MutationObserver(()=>{if(decor){const now=Date.now();if(now-lastPosition>100){lastPosition=now;requestAnimationFrame(positionDecor)}}});
window.addEventListener('DOMContentLoaded',()=>{observer.observe(document.body,{childList:true,subtree:true});});
async function saveHistory(key,project){await putMany([[key,normalized(project)]]);}
async function latestHistory(id){const found=(await keys()).filter(k=>String(k).startsWith('history:'+id+':')).sort();return found.length?await get(found[found.length-1]):null;}
async function saveDraft(project){const p=normalized(project);p.updatedAt=Date.now();await putMany([['project:'+p.id,p]]);return p;}
async function listProjects(){return (await keys()).filter(k=>String(k).startsWith('project:')).map(k=>String(k).slice(8));}
async function apply(project){await ready;const p=normalized(project);const css=compile(p);if(!bypass()&&typeof CSSStyleSheet!=='undefined'&&CSSStyleSheet.prototype.replaceSync){const x=new CSSStyleSheet();x.replaceSync(css);}const was=applied?clone(applied):null;const previous=active||{id:null,version:0};const next={id:p.id,version:(previous.version||0)+1,releaseKey:'release:'+p.id+':'+((previous.version||0)+1),updatedAt:Date.now()};
 // Save theme and active pointer in one canonical transaction. Never report success before actual visual activation.
 await putMany([['project:'+p.id,p],[next.releaseKey,p],['active',next]],previous.version||0);
 try{if(!bypass())activate(p);else deactivate();active=next;channel?.postMessage({kind:'activated'});return next;}
 catch(e){console.error('[Theme Atelier] activation after durable commit failed',e);try{if(was&&!bypass())activate(was);else deactivate();await putMany([['active',{...previous,version:next.version+1}]],next.version);active={...previous,version:next.version+1};channel?.postMessage({kind:'activated'});}catch(recoveryError){console.error('[Theme Atelier] rollback failed',recoveryError)}throw e;}
}
async function unapply(){await ready;const previous=active||{id:null,version:0},next={id:null,version:previous.version+1,updatedAt:Date.now()};await putMany([['active',next]],previous.version);deactivate();active=next;channel?.postMessage({kind:'activated'});}
window.MimaAtelierCore={TARGETS,DEFAULT,STYLES,PATTERNS,baseTheme,normalized,clone,clamp,hex,esc,rgba,uid,patternCSS,compile,get,saveDraft,apply,unapply,disabled,reaffirm,bypass,ready,_historySave:saveHistory,_historyLatest:latestHistory,listProjects,getActive:()=>clone(active||{id:null,version:0}),getApplied:()=>applied&&clone(applied),positionDecor};
})();
