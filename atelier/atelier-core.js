/* MIMA Theme Atelier R1 — independent authoring/runtime. No mutation of legacy stores. */
(() => {
'use strict';
const root=window, DB='mima-theme-atelier-v1', STORE='records', META_STORE='project-metadata', VERSION=2;
const TARGETS={
  shell:{label:'整体背景',real:'body',preview:'.atl-scene'},
  drawer:{label:'剧情列表侧栏背景',real:'.session-drawer',preview:'.atl-demo-session-list'},
  topbar:{label:'顶部导航',real:'.app-shell > header.topbar',preview:'.atl-demo-top'},
  composer:{label:'底部输入区',real:'.app-shell > footer.composer-shell',preview:'.atl-demo-composer'},
  button:{label:'主要按钮',real:'.app-shell .primary-btn,.app-shell .send-btn',preview:'.atl-demo-primary,.atl-demo-send'},
  secondary:{label:'次要按钮',real:'.app-shell .ghost-btn,.app-shell .chip-btn,.app-shell .nav-label',preview:'.atl-demo-secondary'},
  field:{label:'输入框',real:'.app-shell .field,.app-shell .composer-row textarea',preview:'.atl-demo-field'},
  message:{label:'普通剧情消息材质（不含 HTML 状态栏）',real:'.app-shell #story-chat-box article.message.assistant-msg > .msg-content:not(.safe-html-content),.app-shell #story-chat-box article.message.user-msg > .msg-content:not(.safe-html-content)',preview:'.atl-demo-message:not(.atl-demo-safe-host)'},
  safeHtmlHost:{label:'HTML 正文外框材质（只改外层，不改内部 CSS）',real:'.app-shell #story-chat-box article.message.assistant-msg > .msg-content.tavern-story-content.safe-html-content,.app-shell #story-chat-box article.message.user-msg > .msg-content.tavern-story-content.safe-html-content',preview:'.atl-demo-safe-host'},
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
// Presentation authority is separate from canonical CSS mounting. No legacy preset is deleted.
const PRESENTATION=['atelier-only','legacy-only','mix-legacy','mix-atelier'];
// The same plan drives live style mounting, generated preview and diagnostics.
function resolvePresentationPlan(project,legacyAvailable=true,previewLayer='combined'){
 const mode=PRESENTATION.includes(project?.cssPriority)?project.cssPriority:'atelier-only';
 const both=previewLayer!=='atelier';
 return {mode,themeEnabled:mode!=='legacy-only',legacyEnabled:both&&mode!=='atelier-only'&&!!legacyAvailable,
   order:mode==='mix-legacy'?'atelier-then-legacy':'legacy-then-atelier',
   stickersEnabled:mode!=='legacy-only',regions:{...project?.regions}};
}
// Single presentation ordering contract for live and the isolated structural preview.
// Caller supplies mounted legacy layer records; the function never reads user data or writes Store.
function presentationLayers(project,legacyLayers=[],previewLayer='combined'){
 const existing=legacyLayers.filter(x=>x&&typeof x.css==='string'&&x.css.length&&x.enabled!==false);
 const plan=resolvePresentationPlan(project,existing.length>0,previewLayer);
 const legacy=plan.legacyEnabled?existing.map(x=>({id:x.id,css:x.css,media:x.media||'all',kind:'legacy'})):[];
 const atelier=plan.themeEnabled?[{id:'mima-atelier-runtime-style',kind:'atelier'}]:[];
 return {plan,layers:plan.order==='atelier-then-legacy'?[...atelier,...legacy]:[...legacy,...atelier]};
}
function normalizeTextPolicy(raw,legacyTypography=false){
 const pol=raw&&typeof raw==='object'?raw:{};
 const story=pol.storyProse||{},surface=pol.messageSurface||{},status=pol.statusHtml||{};
 const mode=x=>x==='explicit'?'explicit':'inherit';
 return {messageSurface:{inkMode:mode(surface.inkMode||'explicit')},
   storyProse:{inkMode:mode(story.inkMode||(legacyTypography?'explicit':'inherit')),
     typographyMode:mode(story.typographyMode||(legacyTypography?'explicit':'inherit'))},
   statusHtml:{inkMode:mode(status.inkMode)}};
}
const defaultRegions=()=>Object.fromEntries(REGION_KEYS.map(k=>[k,k!=='status'&&k!=='safeHtmlHost']));
// Theme-scoped interaction assets belong to the immutable Atelier project snapshot.
// Never discard an invalid saved audio asset silently: reject the whole import instead.
const SOUND_KINDS=['normal','send','menu'];
const DEFAULT_INTERACTIONS=Object.freeze({enabled:true,animation:'jelly',duration:340,particles:'sparkles',particleCount:5,transitions:true,soundEnabled:true,volume:24,
 sounds:{normal:'',send:'',menu:''},soundNames:{normal:'',send:'',menu:''}});
const AUDIO_DATA=/^data:audio\/(?:mpeg|mp3|wav|x-wav|mp4|aac|x-m4a);base64,[A-Za-z0-9+/=]+$/;
function normalizeInteractions(raw){
 const x=raw&&typeof raw==='object'?raw:{},sources=x.sounds&&typeof x.sounds==='object'?x.sounds:{};
 const sounds={},soundNames={};for(const kind of SOUND_KINDS){const value=sources[kind]??'';
  if(typeof value!=='string'||value.length>5.4*1024*1024||(value&&!AUDIO_DATA.test(value)))throw Error('交互音效 '+kind+' 文件格式无效或超过 4 MB，原主题不会被覆盖');
  sounds[kind]=value;soundNames[kind]=String(x.soundNames?.[kind]||'').replace(/[<>\u0000-\u001f]/g,'').slice(0,80);
 }
 return {enabled:x.enabled!==false,animation:['jelly','press','glow','ripple','none'].includes(x.animation)?x.animation:DEFAULT_INTERACTIONS.animation,
  duration:clamp(x.duration??340,140,850),particles:['sparkles','hearts','petals','paw','none'].includes(x.particles)?x.particles:'sparkles',
  particleCount:clamp(x.particleCount??5,0,12),transitions:x.transitions!==false,soundEnabled:x.soundEnabled!==false,
  volume:clamp(x.volume??24,0,100),sounds,soundNames};
}
function normalizedReadingBoard(value){const r=value&&typeof value==='object'?value:{};return {
 enabled:r.enabled===true,html:r.html!==false,regular:r.regular!==false,statusFrame:r.statusFrame===true,
 tone:r.tone==='dark'?'dark':'light',opacity:clamp(r.opacity??86,40,100),blur:clamp(r.blur??12,0,30),
 padding:clamp(r.padding??16,0,40),radius:clamp(r.radius??18,0,48)
};}
const PATTERNS=['dots','grid','stripes','diagonal','checker','waves','rings','radial','diamond','cross','halftone','none'];
// Theme records are plain JSON trees. Copy containers, but keep immutable
// strings (especially multi-MB base64 images/fonts/audio) shared by reference.
// Editing the result cannot mutate the source; callers still own independent
// arrays, elements, sound options and nested structures.
const clone=x=>Array.isArray(x)?x.map(clone):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v)])):x;
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
function countCssLayers(source){let level=0,quote='',escaped=false,count=String(source||'').trim()?1:0;for(const ch of String(source||'')){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(quote){if(ch===quote)quote='';continue;}if(ch==='\"'||ch==="'"){quote=ch;continue;}if(ch==='(')level++;else if(ch===')')level=Math.max(0,level-1);else if(ch===','&&level===0)count++;}return count;}
function patternLayers(pats,part){const a=(pats||[]).filter(p=>p.enabled!==false&&p.type!=='none'&&patternCSS(p));return a.flatMap(p=>{const x=patternCSS(p);if(part==='position')return Array.from({length:countCssLayers(x.image)},()=>`${clamp(p.offsetX??0,-500,500)}px ${clamp(p.offsetY??0,-500,500)}px`);
    return x[part]?[x[part]]:part==='size'?['auto']:[]});}
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
function styleRules(s0,pattern=[],key='',options={}){const s={...DEFAULT,...s0},bg=rgba(s.fill,s.alpha),bd=rgba(s.borderColor,s.borderAlpha);
  const structural=['topbar','composer','drawer','panel','status','safeHtmlHost'].includes(key),prose=key==='message',shapeSafe=['button','secondary'].includes(key);
  let images=patternLayers(pattern,'image'),sizes=patternLayers(pattern,'size'),positions=patternLayers(pattern,'position');const effect=atlasEffect(s);if(effect){const layerCount=countCssLayers(effect.image);images.push(effect.image);sizes.push(effect.size);positions.push(Array.from({length:layerCount},()=> '0 0').join(','));}
  let gradientImage='';if(s.gradient!=='none'){const to=rgba(s.gradientTo,s.alpha);const gradient=s.gradient==='radial'?`radial-gradient(circle at 28% 20%,${to},${bg})`:s.gradient==='conic'?`conic-gradient(from ${clamp(s.angle,0,360)}deg,${bg},${to},${bg})`:`linear-gradient(${clamp(s.angle,0,360)}deg,${to},${bg})`;gradientImage=gradient;}
  if(s.image){
    if(s.imageOpacity<100){images.push(`linear-gradient(${rgba(s.fill,100-clamp(s.imageOpacity,0,100))},${rgba(s.fill,100-clamp(s.imageOpacity,0,100))})`);sizes.push('cover');positions.push('0 0');}
    if(s.maskOpacity>0){images.push(`linear-gradient(${rgba(s.maskColor,s.maskOpacity)},${rgba(s.maskColor,s.maskOpacity)})`);sizes.push('cover');positions.push('0 0');}
    const imageUrl=options.assetUrl?options.assetUrl(s.image,'image'):s.image; if(imageUrl)images.push(`url("${String(imageUrl).replace(/["\\]/g,'')}")`);sizes.push('cover');positions.push(`${clamp(s.imagePosX,0,100)}% ${clamp(s.imagePosY,0,100)}%`);
  }
  if(gradientImage){images.push(gradientImage);sizes.push('auto');positions.push('0 0');}
  if(options.onlyImages)return ['background-color:transparent',images.length?'background-image:'+images.join(','):'background-image:none',images.length?'background-size:'+sizes.join(','):'',images.length?'background-position:'+positions.join(','):'','background-repeat:repeat'].filter(Boolean).join(';');
  const dark=rgba('#000000',Math.min(50,clamp(s.shadow,0,50)*1.6));const light=rgba('#ffffff',clamp(s.shadow,0,50)*1.8);
  let shadow=s.shadow?`0 ${clamp(s.shadowY,0,30)}px ${clamp(s.shadow,0,50)*1.5}px ${dark}`:'none';
  if(s.material==='neo')shadow=`${clamp(s.shadowY,0,30)}px ${clamp(s.shadow,0,50)}px ${clamp(s.shadow,0,50)*1.6}px ${dark},-${clamp(s.shadowY,0,30)}px -${clamp(s.shadow,0,50)}px ${clamp(s.shadow,0,50)*1.6}px ${light}`;
  if((s.material==='skeuo'||s.material==='aqua')&&shadow==='none')shadow='inset 0 1px 1px rgba(255,255,255,.01)';
  if(s.material==='skeuo'||s.material==='aqua')shadow+=`,inset 0 2px 3px rgba(255,255,255,.65),inset 0 -3px 5px rgba(0,0,0,.13)`;
  if(s.material==='brutal')shadow=`${clamp(s.shadow,0,50)/2}px ${clamp(s.shadow,0,50)/2}px 0 ${rgba('#111111',80)}`;
  const rules=[`background-color:${bg}`,images.length?`background-image:${images.join(',')}`:'background-image:none',images.length?`background-size:${sizes.join(',')}`:'',images.length?`background-position:${positions.join(',')}`:'',`border:${clamp(s.border,0,20)}px solid ${bd}`,`border-width:${['borderTop','borderRight','borderBottom','borderLeft'].map(k=>clamp(s[k]<0?s.border:s[k],0,20)+'px').join(' ')}`,s.paddingX>=0&&key!=='shell'?`padding-left:${clamp(s.paddingX,0,80)}px;padding-right:${clamp(s.paddingX,0,80)}px`:'',s.paddingY>=0&&key!=='shell'?`padding-top:${clamp(s.paddingY,0,80)}px;padding-bottom:${clamp(s.paddingY,0,80)}px`:'',`border-radius:${clamp(s.radius,0,100)}px`,`box-shadow:${shadow}`,s.blur>0?`backdrop-filter:blur(${clamp(s.blur,0,60)}px) saturate(${s.material==='aqua'?'1.35':'1.18'})`:'backdrop-filter:none',s.blur>0?`-webkit-backdrop-filter:blur(${clamp(s.blur,0,60)}px) saturate(${s.material==='aqua'?'1.35':'1.18'})`:'-webkit-backdrop-filter:none',(key!=='status'&&key!=='safeHtmlHost'&&(!prose||options.surfaceInk)?`color:${hex(s.ink)}`:''),(!structural&&(!prose||options.proseTypography)?`font-size:${clamp(s.fontSize,8,38)}px`:''),key!=='status'&&key!=='safeHtmlHost'&&s.fontFamily&&s.fontFamily!=='inherit'?`font-family:${/^MimaAtelierFont_[A-Za-z0-9]+$/.test(s.fontFamily)?'"'+s.fontFamily+'"':(['system-ui','serif','monospace'].includes(s.fontFamily)?s.fontFamily:'inherit')}`:'',!structural&&!prose&&s.stroke>0?`-webkit-text-stroke:${clamp(s.stroke,0,4)}px ${hex(s.strokeColor)}`:'',!structural&&!prose&&s.textShadow?`text-shadow:0 1px ${clamp(s.textShadow,0,20)}px ${rgba(s.strokeColor,75)}`:''];
  if(s.material==='glass' || s.material==='aqua'){rules.push(`background-clip:padding-box`); if(s.blur>0)rules.push(`box-shadow:${shadow==='none'?'0 3px 15px rgba(10,15,25,.10)':shadow},inset 0 1px 0 rgba(255,255,255,.28)`);}
  if(prose){
    // Material ink and independent prose typography are separate controls.
    // Never discard an edited color merely because font ownership is external.
    for(let i=rules.length-1;i>=0;i--){
      if(/^(?:font-size:|font-family:)/.test(rules[i]))rules.splice(i,1);
      else if(options.surfaceInk===false&&rules[i].startsWith('color:'))rules.splice(i,1);
    }
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
 elements.drawer={...base,alpha:72,blur:12,border:0,radius:0,shadow:0,gradient:'none'};
 elements.button={...base,fill:accent,ink:'#ffffff',alpha:100,gradient:kind==='flat'||kind==='minimal'?'none':'linear',gradientTo:bg};
 elements.secondary={...base,fill:'#ffffff',alpha:55};
 elements.field={...base,fill:'#ffffff',alpha:78,blur:3};
 elements.message={...base,fill:'#ffffff',alpha:kind==='glass'?58:kind==='aqua'?62:24,border:kind==='glass'||kind==='aqua'?1:0,blur:kind==='glass'?14:kind==='aqua'?10:0,shadow:0};
 elements.safeHtmlHost={...elements.message}; // Data survives when a historical project's HTML surface is not enabled.
 return {id:uid(),name:`${name} · 自定义`,format:'mima-atl-project',schema:1,template:id,originPreset:'',layoutRecipe:'story',cssPriority:'atelier-only',regions:{...defaultRegions(),safeHtmlHost:true},htmlSurfaceFollowsMessage:true,readingBoard:normalizedReadingBoard(),interactions:normalizeInteractions(),proseTypography:false,textPolicy:normalizeTextPolicy({storyProse:{inkMode:'explicit'}},false),nightMode:'app',elements,patterns:[],stickers:[],fonts:[],favorites:[],variants:{},extraCss:'',draftVersion:0,createdAt:Date.now(),updatedAt:Date.now()};
}
function assertProjectAssets(raw){
 if(!raw||typeof raw!=='object')throw Error('主题工程数据无效');
 const rules={
  fonts:x=>/^data:(font\/(woff2?|ttf|otf)|application\/(font-woff|x-font-ttf|x-font-opentype|octet-stream));base64,[A-Za-z0-9+/=]+$/.test(x?.src||'')&&x.src.length<12*1024*1024&&/^MimaAtelierFont_[A-Za-z0-9]+$/.test(x.family||''),
  patterns:x=>!!TARGETS[x?.target]&&PATTERNS.includes(x?.type),
  stickers:x=>validImage(x?.src)&&!!TARGETS[x?.anchor||'shell'],
  favorites:x=>!!x&&typeof x.name==='string'&&!!x.style&&typeof x.style==='object'
 };
 for(const [kind,valid] of Object.entries(rules)){
  if(raw[kind]!==undefined&&!Array.isArray(raw[kind]))throw Error('主题工程的 '+kind+' 不是有效列表，拒绝覆盖原存档');
  if(Array.isArray(raw[kind])){
   const invalid=raw[kind].findIndex(x=>!valid(x));
   if(invalid>=0)throw Error('主题工程的 '+kind+' 第 '+(invalid+1)+' 项无效，拒绝静默删除该素材');
  }
 }
}
function normalized(raw){if(!raw||raw.format!=='mima-atl-project'||raw.schema!==1||!raw.elements||typeof raw.elements!=='object')throw new Error('不支持或损坏的主题工程格式');assertProjectAssets(raw);const obj=baseTheme(raw.template||'minimal-clear');obj.id=String(raw.id||uid());obj.name=safeName(raw.name);obj.originPreset=/^[a-z][a-z0-9-]{0,100}$/.test(String(raw.originPreset||''))?String(raw.originPreset):'';obj.layoutRecipe=/^[a-z][a-z0-9-]{0,80}$/.test(String(raw.layoutRecipe||''))?String(raw.layoutRecipe):'story';obj.cssPriority=PRESENTATION.includes(raw.cssPriority)?raw.cssPriority:raw.cssPriority==='regions-first'?'mix-atelier':raw.cssPriority==='legacy-first'?'mix-legacy':'atelier-only';obj.proseTypography=raw.proseTypography===true;obj.textPolicy=normalizeTextPolicy(raw.textPolicy,obj.proseTypography);obj.nightMode=['app','system','light','dark'].includes(raw.nightMode)?raw.nightMode:'app';obj.regions=defaultRegions();obj.htmlSurfaceFollowsMessage=raw.htmlSurfaceFollowsMessage===true;obj.readingBoard=normalizedReadingBoard(raw.readingBoard);obj.interactions=normalizeInteractions(raw.interactions);if(raw.regions&&typeof raw.regions==='object')for(const k of REGION_KEYS)if(Object.prototype.hasOwnProperty.call(raw.regions,k))obj.regions[k]=raw.regions[k]===true;if(obj.htmlSurfaceFollowsMessage)obj.regions.safeHtmlHost=true;obj.createdAt=Number(raw.createdAt)||Date.now();obj.updatedAt=Number(raw.updatedAt)||Date.now();obj.draftVersion=Math.max(0,Number(raw.draftVersion)||0);obj.linkedCssId=/^css[-_a-zA-Z0-9]+$/.test(String(raw.linkedCssId||''))?String(raw.linkedCssId):'';for(const k of Object.keys(TARGETS))if(raw.elements[k]?.image && !validImage(raw.elements[k].image))throw Error('区域 '+TARGETS[k].label+' 的背景素材无效或超出 8MB 单图限制，未删除其存档');
 for(const k of Object.keys(TARGETS)){if(raw.elements[k]&&typeof raw.elements[k]==='object'){
 const e={...obj.elements[k]};for(const field of Object.keys(DEFAULT))if(Object.prototype.hasOwnProperty.call(raw.elements[k],field)){
 const v=raw.elements[k][field];e[field]=typeof DEFAULT[field]==='number'?clamp(v,-10000,10000):typeof v==='string'?v.slice(0,250):DEFAULT[field];
 } e.fill=hex(e.fill);e.ink=hex(e.ink);e.borderColor=hex(e.borderColor);e.strokeColor=hex(e.strokeColor);e.gradientTo=hex(e.gradientTo);e.maskColor=hex(e.maskColor);e.image=validImage(raw.elements[k].image)?raw.elements[k].image:'';obj.elements[k]=e;}}
 obj.fonts=Array.isArray(raw.fonts)?raw.fonts.filter(x=>/^data:(font\/(woff2?|ttf|otf)|application\/(font-woff|x-font-ttf|x-font-opentype|octet-stream));base64,[A-Za-z0-9+/=]+$/.test(x?.src||'')&&x.src.length<12*1024*1024&&/^MimaAtelierFont_[A-Za-z0-9]+$/.test(x.family||'')).map(x=>({family:x.family,name:safeName(x.name),format:String(x.format||'woff2').replace(/[^a-z0-9]/gi,'').slice(0,6),src:x.src})):[];
 for(const key of Object.keys(TARGETS))if(!['inherit','system-ui','serif','monospace'].includes(obj.elements[key].fontFamily)&&!obj.fonts.some(x=>x.family===obj.elements[key].fontFamily))obj.elements[key].fontFamily='inherit';
 obj.patterns=Array.isArray(raw.patterns)?raw.patterns.filter(x=>TARGETS[x.target]&&PATTERNS.includes(x.type)).map(x=>({id:String(x.id||uid()),target:x.target,type:x.type,color:hex(x.color),opacity:clamp(x.opacity,0,100),size:clamp(x.size,5,160),weight:clamp(x.weight,.5,25),angle:clamp(x.angle,0,360),offsetX:clamp(x.offsetX??0,-500,500),offsetY:clamp(x.offsetY??0,-500,500),enabled:x.enabled!==false})):[];
 obj.stickers=Array.isArray(raw.stickers)?raw.stickers.filter(x=>validImage(x.src)&&TARGETS[x.anchor||'shell']).map(x=>({id:String(x.id||uid()),name:safeName(x.name),src:x.src,anchor:x.anchor||'shell',x:clamp(x.x,-150,250),y:clamp(x.y,-150,250),width:clamp(x.width,4,200),rotate:clamp(x.rotate,-360,360),opacity:clamp(x.opacity,0,100),hidden:!!x.hidden,plane:x.plane==='behind'?'behind':'front',targetMessageId:(x.anchor==='message'||x.anchor==='status')&&typeof x.targetMessageId==='string'?x.targetMessageId.slice(0,160):''})):[];
 obj.extraCss=String(raw.extraCss||'');
 obj.favorites=Array.isArray(raw.favorites)?raw.favorites.filter(x=>x&&typeof x.name==='string'&&x.style&&typeof x.style==='object').map(x=>({id:String(x.id||uid()),name:safeName(x.name),style:{...obj.elements.button,...Object.fromEntries(Object.keys(DEFAULT).filter(k=>Object.hasOwn(x.style,k)).map(k=>[k,x.style[k]]))}})):[];
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
  // The wrapper can contain tool buttons, status HTML and retry controls: it must remain full-width.
  // Apply the bubble only to authored prose. Never shrink the entire message article.
  const aProse=preview?a:`${a} > .msg-content:not(.safe-html-content)`;
  const uProse=preview?u:`${u} > .msg-content:not(.safe-html-content)`;
  css+=`${aProse}{box-sizing:border-box;max-width:92%;width:fit-content;min-width:0;margin-left:0;margin-right:auto;border-radius:${rad}px ${rad}px ${rad}px 7px;overflow-wrap:anywhere;}\n${uProse}{box-sizing:border-box;max-width:92%;width:fit-content;min-width:0;margin-left:auto;margin-right:0;border-radius:${rad}px ${rad}px 7px ${rad}px;overflow-wrap:anywhere;}\n`;
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
function compile(project,mode='live',options={}){
 const standalone=mode==='standalone'||mode==='portable';const scope=mode==='preview'?'[data-atl-preview]':standalone?'html':'html[data-mima-atelier-active]';
 const assetUrl=options.assetUrl||((src)=>options.assetMode==='omit'?'':src);
 let result=`/* MIMA Theme Atelier | ${safeName(project.name)} | generated stylesheet */\n`;
 if(!options.skipFonts)for(const font of project.fonts||[])if(/^MimaAtelierFont_[A-Za-z0-9]+$/.test(font.family)){const src=assetUrl(font.src,'font',font);if(src)result+=`@font-face{font-family:"${font.family}";src:url("${src}") format("${({ttf:'truetype',otf:'opentype',truetype:'truetype',opentype:'opentype',woff:'woff',woff2:'woff2'})[String(font.format||'').toLowerCase()]||'truetype'}");font-display:swap;}\n`;}
 for(const [key,target] of Object.entries(TARGETS)){
 if(project.regions?.[key]===false)continue;
 const pol=normalizeTextPolicy(project.textPolicy,project.proseTypography===true);
 const linkedSurface=key==='safeHtmlHost'&&project.htmlSurfaceFollowsMessage;const sourceStyle=linkedSurface?project.elements.message:project.elements[key];const sourcePatterns=project.patterns.filter(p=>p.target===(linkedSurface?'message':key));const rules=styleRules(sourceStyle,sourcePatterns,key,{assetUrl,surfaceInk:pol.messageSurface.inkMode==='explicit'});
 const selectors=(mode==='preview'?target.preview:target.real).split(',').map(x=>mode==='preview'?`${scope} ${x.trim()}`:key==='shell'?`${scope} body`:`${scope} ${x.trim()}`).join(',');
 const imageLayer=mode==='preview'?`${scope} ${target.preview}::before`:`${scope} body::before`;
 if(key==='shell'&&project.elements.shell?.image&&Number(project.elements.shell.blur)>0){
  const blur=clamp(project.elements.shell.blur,0,60);
  // Blur the page image, not its descendant controls or prose. Wallpaper stays owned by the chat layer.
  const imageRules=styleRules(project.elements.shell,project.patterns.filter(p=>p.target==='shell'),'shell',{assetUrl,onlyImages:true});
  result+=`${selectors}{${rules};background-image:none;backdrop-filter:none;-webkit-backdrop-filter:none;isolation:isolate}\n`;
  result+=`${imageLayer}{content:"";position:${mode==='preview'?'absolute':'fixed'};inset:-${blur*2}px;pointer-events:none;z-index:-1;${imageRules};filter:blur(${blur}px)}\n`;
  if(mode==='preview')result+=`${selectors}{position:relative;overflow:hidden}\n`;
 }else result+=`${selectors}{${rules}}\n`;
 if(key==='message'){
  // Ordinary prose, status HTML and the message surface have independent ownership.
  // Both render modes create direct .story-prose children for plain narration.
  // Never style arbitrary nested role HTML (status bars, tables, custom card CSS).
  const phrase=mode==='preview'?`${scope} .atl-demo-message`:
   `${scope} .app-shell #story-chat-box article.message > .msg-content.tavern-story-content > .story-prose`;
  const proseRules=[];
  if(pol.storyProse.inkMode==='explicit')proseRules.push(`color:${hex(project.elements.message.ink)}`);
  if(pol.storyProse.typographyMode==='explicit'){
   proseRules.push(`font-size:${clamp(project.elements.message.fontSize,8,38)}px`);
   const fam=project.elements.message.fontFamily;
   if(fam&&fam!=='inherit')proseRules.push(`font-family:${/^MimaAtelierFont_[A-Za-z0-9]+$/.test(fam)?'"'+fam+'"':(['system-ui','serif','monospace'].includes(fam)?fam:'inherit')}`);
  }
  if(proseRules.length)result+=`${phrase}{${proseRules.join(';')}}\n`;
 }
 if(key==='safeHtmlHost' && pol.messageSurface.inkMode==='explicit'){
  // Safe HTML was excluded from ordinary message ink and also excluded by
  // styleRules(key==='safeHtmlHost'): nothing supplied the selected text color.
  // Only set inherited host properties; authored status HTML with explicit
  // color/background rules remains authoritative on its descendants.
  const color=hex(sourceStyle.ink);
  result+=`${selectors}{color:${color};--text:${color};--mima-html-ink:${color};--mima-html-glass-blur:${clamp(sourceStyle.blur,0,60)}px;--mima-html-surface:${rgba(sourceStyle.fill,sourceStyle.alpha)};}\n`;
 }
 if(key==='status'&&pol.statusHtml.inkMode==='explicit')result+=`${selectors}{color:${hex(project.elements.status.ink)}}\n`;
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
 // Explicitly opt-in readability surface on the outer authored message host only.
 const board=normalizedReadingBoard(project.readingBoard);
 if(board.enabled){
  const light=board.tone==='light',bg=rgba(light?'#fbfaf8':'#202127',board.opacity);
  const edge=light?'rgba(64,65,73,.15)':'rgba(255,255,255,.2)';
  const content=[];
  if(mode==='preview'){
   if(board.html)content.push(`${scope} .atl-demo-message.atl-demo-safe-host`);
   if(board.regular)content.push(`${scope} .atl-demo-message:not(.atl-demo-safe-host)`);
  }else{
   if(board.html)content.push(`${scope} .app-shell #story-chat-box article.message > .msg-content.tavern-story-content.safe-html-content`);
   if(board.regular)content.push(`${scope} .app-shell #story-chat-box article.message > .msg-content:not(.safe-html-content)`);
  }
  if(content.length)result+=`${content.join(',')}{box-sizing:border-box;max-width:100%;min-width:0;overflow-wrap:anywhere;background-color:${bg};border:1px solid ${edge};border-radius:${board.radius}px;padding:${board.padding}px;backdrop-filter:blur(${board.blur}px);-webkit-backdrop-filter:blur(${board.blur}px);box-shadow:0 6px 22px rgba(0,0,0,.10)}\n`;
  if(board.statusFrame&&board.html&&mode!=='preview')result+=`${scope} .app-shell #story-chat-box .tavern-story-content.safe-html-content > :is(details,system){border-radius:${Math.max(6,board.radius-4)}px;outline:1px solid ${edge};outline-offset:3px;}\n`;
 }
 result+=`@keyframes mima-atl-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}\n@keyframes mima-atl-glow{from{filter:brightness(.95)}to{filter:brightness(1.15)}}\n@media(prefers-reduced-motion:reduce){${scope} *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}\n`;
 // Extra CSS is an explicit advanced user-authored layer; it does not need to be parseable back into visual parameters.
 if((mode==='live'||standalone)&&project.variants?.night&&project.nightMode!=='light'){const alt={...project,elements:project.variants.night.elements,patterns:project.variants.night.patterns,extraCss:'',variants:{},nightMode:'light'};let night=compile(alt,mode,{...options,skipFonts:true});
  if(project.nightMode==='system')result+=`\n@media (prefers-color-scheme:dark){\n${night}\n}\n`;
  else if(project.nightMode==='dark')result+=`\n${night}\n`;
  else {const nightScope=standalone?'html[data-mima-theme="midnight"]':'html[data-mima-atelier-active][data-mima-theme="midnight"]';night=night.replaceAll(scope,nightScope);result+=`\n${night}\n`;}
 }
 result+=atlasLayout(project,scope,mode);
 if((mode==='live'||standalone)&&project.extraCss)result+=`\n/* Advanced authored CSS, untouched */\n${project.extraCss}\n`;
 return result;
}
function dbOpen(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,VERSION);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE);if(!q.result.objectStoreNames.contains(META_STORE))q.result.createObjectStore(META_STORE)};q.onsuccess=()=>{q.result.onversionchange=()=>{q.result.close();dbPromise=null;};resolve(q.result);};q.onerror=()=>reject(q.error||new Error('数据库打开失败'));q.onblocked=()=>reject(new Error('主题数据库被其他页面阻塞'));});}
let dbPromise=null;function getDB(){return dbPromise||(dbPromise=dbOpen().catch(e=>{dbPromise=null;throw e;}));}
async function get(key){const db=await getDB();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.onerror=()=>reject(t.error);});}
async function putMany(entries,expected=null){const db=await getDB();return new Promise((resolve,reject)=>{const t=db.transaction([STORE,META_STORE],'readwrite'),s=t.objectStore(STORE);const saveEntries=()=>entries.forEach(([k,v])=>{s.put(v,k);if(/^(project:|manual:)/.test(k))t.objectStore(META_STORE).put(projectListMetadata(k,v),k);});let failure=null; if(expected!==null){const q=s.get('active');q.onsuccess=()=>{const old=q.result||null;if((old?.version||0)!==expected){failure=new Error('其他窗口已更新当前主题，请重新打开后再应用。');t.abort();return;}saveEntries();};q.onerror=()=>{failure=q.error;t.abort();};}else saveEntries();t.oncomplete=()=>resolve();t.onabort=()=>reject(failure||t.error||new Error('事务取消'));t.onerror=()=>{failure=t.error};});}
async function keys(){const db=await getDB();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly'),q=t.objectStore(STORE).getAllKeys();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);t.onerror=()=>reject(t.error)});}
// Compact runtime resource URLs. Canonical project data remains untouched for old-version compatibility.
const assetPool=new Map(),assetOwners=new Map();
function makeAssetURL(src){const comma=src.indexOf(',');if(comma<0||!/^data:(?:image\/|font\/|application\/)/.test(src))throw Error('主题素材格式无效');
 const raw=atob(src.slice(comma+1)),chunks=[];for(let i=0;i<raw.length;i+=65536){const slice=raw.slice(i,i+65536),bytes=new Uint8Array(slice.length);for(let j=0;j<slice.length;j++)bytes[j]=slice.charCodeAt(j);chunks.push(bytes)}
 return URL.createObjectURL(new Blob(chunks,{type:(/^data:([^;,]+)/.exec(src)||[])[1]||'application/octet-stream'}));}
function prepareAssets(project,owner){const used=new Set();return {used,url(src){if(!src||!/^data:/.test(src))return src;let entry=assetPool.get(src);if(!entry){entry=makeAssetURL(src);assetPool.set(src,entry);}used.add(src);return entry;},owner};}
function commitAssetOwner(owner,used){assetOwners.set(owner,used);for(const [src,url] of assetPool){if(![...assetOwners.values()].some(set=>set.has(src))){URL.revokeObjectURL(url);assetPool.delete(src);}}}
function releaseAssets(owner){commitAssetOwner(owner,new Set());}
// A separate preview lease covers <img> stickers, which aren't part of CSS.
// Keeping their Blob URLs out of DOM markup avoids repeated base64 attribute
// allocations during edits; replacing the lease reclaims obsolete originals.
function setPreviewImageAssets(sources=[]){
 const entry=prepareAssets(null,'preview-images');
 try{
  for(const src of sources)entry.url(src);
  commitAssetOwner('preview-images',entry.used);
 }catch(e){
  // A damaged saved image must not leak a half-prepared URL or discard the
  // previous verified preview. Its original stored bytes remain untouched.
  commitAssetOwner('preview-images',assetOwners.get('preview-images')||new Set());
  throw e;
 }
}
function previewImageUrl(src){return assetPool.get(src)||src;}
function compiledWithAssets(p,mode,owner){const t=prepareAssets(p,owner);const css=compile(p,mode,{assetUrl:t.url});return {css,used:t.used};}
function previewCss(project){
 // The lightweight material sketch intentionally has no legacy CSS or arbitrary authored extraCss.
 // Its state must never be confused with the authoritative real-page try-on.
 const plan=resolvePresentationPlan(project);
 const data=compiledWithAssets(project,'preview','preview');commitAssetOwner('preview',data.used);
 return plan.themeEnabled?data.css:'';
}
function appearanceWarnings(project){
 const issues=[],plan=resolvePresentationPlan(project);
 if(!plan.themeEnabled)issues.push('当前是「仅使用旧 CSS」：工坊材质草图不会作用到正式页面。请切换到结构估计或真实页面试穿。');
 if(project.extraCss?.trim())issues.push('高级 CSS 只在真实页面试穿与正式应用中完整生效；材质草图不模拟任意用户 CSS。');
 for(const [key,style] of Object.entries(project.elements||{})){
  if(project.regions?.[key]===false)continue;
  if(key==='shell'&&Number(style.blur)>0&&!style.image)issues.push('整体背景图模糊当前无对象：请先导入页面背景图；模糊值已经保留。');
  if(key!=='shell'&&Number(style.blur)>0&&Number(style.alpha)>=92)issues.push((TARGETS[key]?.label||key)+' 的表面较不透明，真实磨砂可能不易看到；可降低「背景不透明度」，不会自动替您改值。');
 }
 if(project.regions?.safeHtmlHost===false)issues.push('当前项目未开启「HTML 正文外框」区域，因此工坊普通消息的磨砂不会作用于角色 HTML。请在设计页开启外框同步或手动勾选区域；不会自动改动旧工程。');
 return issues;
}
let active=null,applied=null,style=null,decor=null,decorFront=null,channel=null,initialized=false,ready=null,lastApplyReceipt=null;
const regionDecor=new Map();
function bypass(){return new URLSearchParams(location.search).get('noCss')==='1'||sessionStorage.getItem('mima-atl-safe-disabled')==='1';}
function ensureStyle(){if(!style){style=document.getElementById('mima-atelier-runtime-style');if(!style){style=document.createElement('style');style.id='mima-atelier-runtime-style';document.head.appendChild(style);}}return style;}
function removeDecor(){
 if(decor){decor.remove();decor=null;}if(decorFront){decorFront.remove();decorFront=null;}
 for(const {roots,target,previousPosition,changedPosition,previousIsolation,changedIsolation} of regionDecor.values()){
  for(const root of roots.values())root.remove();
  if(changedPosition&&target.isConnected&&target.style.position==='relative')target.style.position=previousPosition;
  if(changedIsolation&&target.isConnected&&target.style.isolation==='isolate')target.style.isolation=previousIsolation;
 }
 regionDecor.clear();
}
function computeStickerRect(rect,sticker){
 return {left:rect.left+rect.width*sticker.x/100,top:rect.top+rect.height*sticker.y/100,width:rect.width*sticker.width/100};
}
function stickerRegionKey(sticker){return sticker.anchor+'::'+((sticker.anchor==='message'||sticker.anchor==='status')?(sticker.targetMessageId||''):'');}
function getStickerTarget(key,messageId=''){
 // Sticker anchor targeting is independent of material-CSS authorization: preserve legacy
 // attachments on Safe HTML message hosts without giving their surfaces new borders.
 const selectors=key==='message'?'.app-shell .assistant-msg > .msg-content,.app-shell .user-msg > .msg-content':TARGETS[key]?.real;
 if(!selectors)return null;
 if(messageId&&(key==='message'||key==='status')){
  return [...document.querySelectorAll(selectors)].find(el=>el.closest('article.message')?.dataset.msgId===messageId)||null;
 }
 return document.querySelector(selectors.split(',')[0]); // Original first-match behavior for legacy stickers.
}
function regionStickerRoot(sticker){
 const key=stickerRegionKey(sticker),plane=sticker.plane;
 const target=getStickerTarget(sticker.anchor,sticker.targetMessageId);
 if(!target||!target.isConnected)return null;
 let record=regionDecor.get(key);
 if(record&&record.target!==target){for(const root of record.roots.values())root.remove();
  if(record.changedPosition&&record.target.isConnected&&record.target.style.position==='relative')record.target.style.position=record.previousPosition;
  if(record.changedIsolation&&record.target.isConnected&&record.target.style.isolation==='isolate')record.target.style.isolation=record.previousIsolation;
  regionDecor.delete(key);record=null;}
 if(!record){const previousPosition=target.style.position;const changedPosition=getComputedStyle(target).position==='static';
  if(changedPosition)target.style.position='relative';
  record={target,roots:new Map(),changedPosition,previousPosition,previousIsolation:target.style.isolation,changedIsolation:false};regionDecor.set(key,record);}
 if(plane==='behind'&&getComputedStyle(target).isolation!=='isolate'){target.style.isolation='isolate';record.changedIsolation=true;}
 if(!record.roots.has(plane)){
  const root=document.createElement('div');root.className='mima-atl-region-decor';
  root.dataset.atlRegion=key;root.dataset.atlPlane=plane;
  root.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;';
  // Own the layer inside the region. Behind is below its content, front is clipped
  // to its authorization boundary. Neither belongs to a global body overlay.
  root.style.zIndex=plane==='front'?'2':'-1';root.style.overflow=plane==='front'?'hidden':'visible';
  target.appendChild(root);record.roots.set(plane,root);
 }
 return record.roots.get(plane);
}
function viewportStickerRoot(plane){
 const existing=plane==='front'?decorFront:decor;if(existing)return existing;
 const el=document.createElement('div');el.id=plane==='front'?'mima-atelier-decor-front':'mima-atelier-decor-root';
 el.style.cssText=`position:fixed;inset:0;z-index:${plane==='front'?16:5};pointer-events:none;overflow:visible`;
 document.body.appendChild(el);if(plane==='front')decorFront=el;else decor=el;return el;
}
function drawDecor(project){
 removeDecor();if(!project?.stickers?.length||bypass()){syncDecorObserver();return;}
 for(const sticker of project.stickers.filter(s=>!s.hidden)){
  const root=sticker.anchor==='shell'?viewportStickerRoot(sticker.plane):regionStickerRoot(sticker);
  if(!root)continue; // A late-mounted region is retried by positionDecor's observer.
  const el=document.createElement('img');el.src=sticker.src;el.alt='';el.dataset.atlSticker=sticker.id;
  el.style.cssText=`position:${sticker.anchor==='shell'?'fixed':'absolute'};max-width:none;pointer-events:none;user-select:none;opacity:${clamp(sticker.opacity,0,100)/100};transform:translate(-50%,-50%) rotate(${sticker.rotate}deg);`;
  root.appendChild(el);
 }
 syncDecorObserver();positionDecor();
}
function positionDecor(){
 if(!applied||bypass())return;
 const shell={left:0,top:0,width:innerWidth,height:innerHeight};let detached=false;const writes=[];const measured=new Map(),imagesByRoot=new Map();
 const findSticker=(root,id)=>{if(!root)return null;
  let map=imagesByRoot.get(root);
  if(!map){map=new Map(Array.from(root.querySelectorAll('img[data-atl-sticker]'),node=>[node.dataset.atlSticker,node]));imagesByRoot.set(root,map);}
  return map.get(id)||null;
 };
 for(const sticker of applied.stickers||[]){
  if(sticker.hidden)continue;
  const regionKey=stickerRegionKey(sticker),record=regionDecor.get(regionKey);
  const root=sticker.anchor==='shell'?(sticker.plane==='front'?decorFront:decor):record?.roots.get(sticker.plane);
  if(sticker.anchor!=='shell'&&(!root?.isConnected||!record?.target?.isConnected)){
   if(getStickerTarget(sticker.anchor,sticker.targetMessageId))detached=true;continue;
  }
  const el=findSticker(root,sticker.id);
  if(!el){if(root)detached=true;continue;}
  let r;if(sticker.anchor==='shell')r=shell;else{if(!measured.has(record.target))measured.set(record.target,record.target.getBoundingClientRect());r=measured.get(record.target)}
  if(r.width<=0||r.height<=0){writes.push([el,null]);continue;}
  const pixel=computeStickerRect(sticker.anchor==='shell'?r:{left:0,top:0,width:r.width,height:r.height},sticker);writes.push([el,pixel]);
 }
 // Batched DOM writes after all bounding boxes have been read.
 for(const [el,pixel] of writes){if(!pixel){if(el.style.display!=='none')el.style.display='none';continue;}if(el.style.display)el.style.display='';const x=pixel.left+'px',y=pixel.top+'px',w=pixel.width+'px';if(el.style.left!==x)el.style.left=x;if(el.style.top!==y)el.style.top=y;if(el.style.width!==w)el.style.width=w;}
 if(detached&&!positionDecor.resyncing){positionDecor.resyncing=true;try{drawDecor(applied);}finally{positionDecor.resyncing=false;}}
}
const pausedStyles=new Map();
function liveLegacyLayers(){
 return ['mima-custom-css-style','mima-global-css-style'].map(id=>document.getElementById(id)).filter(Boolean).map(el=>{
  const media=pausedStyles.has(el)?pausedStyles.get(el):(el.getAttribute('media')||'all');
  let enabled=true;
  try{enabled=!media||media==='all'||(typeof window.matchMedia==='function'&&window.matchMedia(media).matches);}catch(e){console.warn('[Atelier] invalid CSS media condition',id,media,e);enabled=false;}
  if(media==='not all')enabled=false;
  return {id:el.id,css:el.textContent||'',media:media||'all',enabled};
 });
}

let canonicalAppearanceId='', canonicalEpoch=0;
function releaseLegacyPresentation(){
 // Reaffirm is also called after a successfully applied unchanged CSS preset.
 // Keep its recovery/priority contract, but do not invalidate the live DOM on
 // every reaffirm when the canonical theme already owns presentation.
 const oldStyle=ensureStyle();
 if(oldStyle.textContent)oldStyle.textContent='';
 if(oldStyle.media!=='not all')oldStyle.media='not all';
 if(document.documentElement.hasAttribute('data-mima-atelier-active'))document.documentElement.removeAttribute('data-mima-atelier-active');
 if(assetOwners.get('atelier')?.size)releaseAssets('atelier');
 for(const [el,prior] of pausedStyles){
  if(prior===null){if(el.hasAttribute('media'))el.removeAttribute('media');}
  else if(el.getAttribute('media')!==prior)el.setAttribute('media',prior);
 }
 pausedStyles.clear();
}
async function syncGlobalAppearance(preset,{allowLegacy=false,preparedProject=undefined}={}){
 const revision=++canonicalEpoch;
 if(livePreviewOrigin)return false;
 // Compatibility read only happens for a trusted legacy record on a database
 // without canonical Atelier releases. Explicitly disabled CSS never revives it.
 if(!preset){
  canonicalAppearanceId='';
  if(!allowLegacy){releaseLegacyPresentation();applied=null;removeDecor();syncDecorObserver();}
  return true;
 }
 // Prepare FIRST. A missing/corrupt snapshot leaves the previous CSS, image
 // objects and stickers visibly mounted; never clear them before this await.
 let next=null;
 if(preset.atelierReleaseKey){
  const stored=preparedProject===undefined?await get(preset.atelierReleaseKey):preparedProject;
  if(revision!==canonicalEpoch||livePreviewOrigin)return false;
  if(!stored)throw Error('选中的全局主题缺少工坊素材快照；旧画面仍在，主库选择未修改，请恢复素材备份');
  next=normalized(stored);
 }
 if(revision!==canonicalEpoch||livePreviewOrigin)return false;
 if(canonicalAppearanceId===preset.id&&((!next&&!applied)||(next&&applied&&next.id===applied.id&&next.updatedAt===applied.updatedAt&&next.draftVersion===applied.draftVersion)))return true;
 canonicalAppearanceId=preset.id;
 releaseLegacyPresentation();
 applied=next;
 if(next)drawDecor(next);else removeDecor();
 syncDecorObserver();if(next)positionDecor();
 return true;
}
function syncPriority(){if(canonicalAppearanceId&&!livePreviewOrigin){releaseLegacyPresentation();return;}if(!style?.isConnected)return;
 const legacy=['mima-custom-css-style','mima-global-css-style'].map(id=>document.getElementById(id)).filter(Boolean);
 const {plan}=presentationLayers(applied,liveLegacyLayers()); 
 const pause=!!applied&&!plan.legacyEnabled;
 for(const el of legacy){const pauseThis=pause&&(!livePreviewOrigin||el.id==='mima-global-css-style');if(pauseThis){if(!pausedStyles.has(el))pausedStyles.set(el,el.getAttribute('media'));el.setAttribute('media','not all');}else if(pausedStyles.has(el)){const prior=pausedStyles.get(el);if(prior===null)el.removeAttribute('media');else el.setAttribute('media',prior);pausedStyles.delete(el);}}
 for(const [el,prior] of pausedStyles){if(!legacy.includes(el)){if(prior===null)el.removeAttribute('media');else el.setAttribute('media',prior);pausedStyles.delete(el);}}
 const after=plan.order==='legacy-then-atelier';
 // Moving an already correctly ordered STYLE node can invalidate computed
 // style and reset author animation lifetimes. Reorder only when necessary.
 if(after){const last=[...legacy].reverse().find(el=>el.parentNode===document.head);
  if(style.parentNode!==document.head||(last&&!(last.compareDocumentPosition(style)&Node.DOCUMENT_POSITION_FOLLOWING)))document.head.appendChild(style);
 }else{const first=legacy.find(el=>el.parentNode===document.head);
  if(first){if(style.parentNode!==document.head||!(style.compareDocumentPosition(first)&Node.DOCUMENT_POSITION_FOLLOWING))document.head.insertBefore(style,first);}
  else if(style.parentNode!==document.head)document.head.appendChild(style);
 }
 const nextMedia=plan.themeEnabled?'':'not all';if(style.media!==nextMedia)style.media=nextMedia;
}
function activate(project){if(!livePreviewOrigin)canonicalAppearanceId='';if(bypass()){deactivate();return;}
 const result=compiledWithAssets(project,'live','atelier');
 try{const style=ensureStyle();if(style.textContent!==result.css)style.textContent=result.css;document.documentElement.setAttribute('data-mima-atelier-active','1');applied=clone(project);commitAssetOwner('atelier',result.used);syncPriority();if(applied.cssPriority==='legacy-only')removeDecor();else drawDecor(applied);window.dispatchEvent(new Event('mima-atelier-presentation-change'));}
 catch(e){for(const [src,url] of assetPool)if(![...assetOwners.values()].some(set=>set.has(src))){URL.revokeObjectURL(url);assetPool.delete(src)}throw e;}
}
function renderAudit(){
 const plan=resolvePresentationPlan(applied),runtime=document.getElementById('mima-atelier-runtime-style');
 const installed=Array.from(document.querySelectorAll('style')).filter(x=>/^(?:mima-custom-css-style|mima-global-css-style|mima-atelier-runtime-style)$/.test(x.id));
 const styles=installed.map((el,index)=>({id:el.id,media:el.getAttribute('media')||'all',order:index}));
 const regions={};
 for(const [key,t] of Object.entries(TARGETS)){
  const el=document.querySelector(t.real.split(',')[0]);
  if(!el){regions[key]={present:false};continue;}
  const cs=getComputedStyle(el),rect=el.getBoundingClientRect();
  regions[key]={present:true,enabled:applied?.regions?.[key]!==false,color:cs.color,backgroundColor:cs.backgroundColor,backgroundImage:cs.backgroundImage==='none'?'none':(cs.backgroundImage?.includes('url(')?'image-url-present':'pattern-or-gradient'),backdropFilter:cs.backdropFilter||cs.webkitBackdropFilter||'none',fontSize:cs.fontSize,fontFamily:cs.fontFamily,position:cs.position,zIndex:cs.zIndex,overflow:cs.overflow,transform:cs.transform,clipPath:cs.clipPath,rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}};
 }
 return {kind:'read_only_atelier_render',projectId:applied?.id||null,version:active?.version||0,cssPriority:plan.mode,themeEnabled:plan.themeEnabled,legacyEnabled:plan.legacyEnabled,styleMounted:!!runtime?.isConnected&&runtime.media!=='not all'&&!!runtime.textContent,viewport:{width:innerWidth,height:innerHeight},styles,regions,stickerPlanes:applied?.stickers?.map(x=>({anchor:x.anchor,targetMessageId:x.targetMessageId||'',plane:x.plane||'front'}))||[]};
}
// On-demand trace only: diagnostic CSSOM walk is never attached to scrolling or chat rendering.
// No author CSS contents, image bytes, History or credentials are returned.
function traceAppearanceRules(){
 const targets={page:'body',pageOverlay:'body',pageAfter:'body',wallpaper:'#story-chat-box',chatOverlay:'#story-chat-box',chatAfter:'#story-chat-box',safeHtmlAfter:'.app-shell .msg-content.safe-html-content',topbar:'.app-shell > header.topbar',composer:'.app-shell > footer.composer-shell',safeHtmlHost:'.app-shell .msg-content.safe-html-content'};
 const pseudo={pageOverlay:'::before',pageAfter:'::after',chatOverlay:'::before',chatAfter:'::after',safeHtmlAfter:'::after'};
 const watched=['background','background-color','background-image','opacity','filter','backdrop-filter','-webkit-backdrop-filter','box-shadow','border','border-radius','mask-image','-webkit-mask-image','mix-blend-mode'];
 const result={};const elements={};
 for(const [key,selector] of Object.entries(targets)){
  const el=document.querySelector(selector);elements[key]=el;
  if(!el){result[key]={mounted:false};continue;}
  const c=getComputedStyle(el,pseudo[key]||null);
  result[key]={mounted:true,pseudo:pseudo[key]||null,effective:{backgroundColor:c.backgroundColor,backgroundImage:c.backgroundImage==='none'?'none':'image-present',opacity:c.opacity,filter:c.filter,backdropFilter:c.backdropFilter||c.webkitBackdropFilter||'none',mask:c.maskImage||c.webkitMaskImage||'none',display:c.display},rules:[]};
 }
 const omitted=[];let checked=0;
 const matches=(el,selector,pseudoName)=>{
  if(!el)return false;
  if(pseudoName&&!selector.includes(pseudoName))return false;
  if(!pseudoName&&/::(?:before|after)\b/.test(selector))return false;
  try{return el.matches(selector.replace(/::(?:before|after)\b/g,''));}catch(e){return false;}
 };
 const walk=(rules,source,mediaActive,depth=0)=>{
  if(depth>8||!rules)return;
  for(const rule of rules){
   if(++checked>30000){if(!omitted.includes('rule_limit'))omitted.push('rule_limit');return;}
   if(rule.type===1){const decl=rule.style;
    const props=watched.filter(prop=>decl.getPropertyValue(prop)).map(prop=>prop+(decl.getPropertyPriority(prop)?' !important':''));
    if(!props.length)continue;
    for(const [key,record] of Object.entries(result)){
     if(!record.mounted||record.rules.length>=60||!matches(elements[key],rule.selectorText,pseudo[key]))continue;
     record.rules.push({source,selector:rule.selectorText.slice(0,180),properties:props,mediaActive});
    }
   }else if(rule.cssRules){
    let active=mediaActive;
    if(rule.type===4){try{active=active&&matchMedia(rule.conditionText).matches;}catch(e){active=false;}}
    if(rule.type===12){try{active=active&&CSS.supports(rule.conditionText);}catch(e){active=false;}}
    walk(rule.cssRules,source,active,depth+1);
   }
  }
 };
 for(const sheet of document.styleSheets){
  const owner=sheet.ownerNode,source=owner?.id||sheet.href?.split('?')[0]||'inline-style';
  let active=!sheet.disabled;
  try{const media=owner?.getAttribute?.('media')||sheet.media?.mediaText||'all';active=active&&(media==='all'||!media||matchMedia(media).matches);}catch(e){active=false;}
  try{walk(sheet.cssRules,source,active);}catch(e){omitted.push(source+': inaccessible CSSOM');}
 }
 return {checkedRuleCount:checked,omitted,targets:result};
}
async function appearanceDiagnostics(){
 const installed=[...document.querySelectorAll('link[rel="stylesheet"],style')].map((el,i)=>({
  id:el.id||null,kind:el.tagName.toLowerCase(),order:i,enabled:el.media!=='not all',
  href:el.tagName==='LINK'?(el.getAttribute('href')||'').split('?')[0]:null,
  bytes:el.tagName==='STYLE'?(el.textContent||'').length:null
 }));
 // SHA only: diagnostic export never contains authored CSS, conversation content, images or secrets.
 for(const layer of installed){
  if(layer.kind!=='style')continue;
  const element=layer.id?document.getElementById(layer.id):null;
  const css=element?.textContent||'';
  if(!element){layer.sha256=null;layer.shaNote='anonymous inline style skipped';continue;}
  try{if(!crypto?.subtle)throw Error('Web Crypto unavailable');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(css));
   layer.sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch(e){layer.sha256=null;layer.shaNote='SHA unavailable on this origin';}
 }
 const selectors={safeHtmlHost:'.app-shell .msg-content.safe-html-content',prose:'.app-shell .msg-content:not(.safe-html-content)',topbar:'.app-shell > header.topbar',composer:'.app-shell > footer.composer-shell',wallpaper:'#story-chat-box'};
 const computed={};for(const [key,selector] of Object.entries(selectors)){
  const el=document.querySelector(selector);if(!el){computed[key]={mounted:false};continue;}
  const c=getComputedStyle(el),r=el.getBoundingClientRect();
  computed[key]={mounted:true,border:c.border,backgroundColor:c.backgroundColor,backdropFilter:c.backdropFilter||c.webkitBackdropFilter||'none',filter:c.filter,opacity:c.opacity,animation:c.animationName,shadow:c.boxShadow,rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};
 }
 const wall=document.getElementById('story-chat-box');const wallMask=wall?.style.getPropertyValue('--mima-wallpaper-mask')||null;
 const visibleAnimated=[...document.querySelectorAll('.app-shell *')].filter(el=>{const c=getComputedStyle(el);return c.animationName!=='none'&&el.getBoundingClientRect().width>0}).length;
 return {cssSourceTrace:traceAppearanceRules(),kind:'MIMA_APPEARANCE_DIAGNOSTICS_READ_ONLY',collectedAt:new Date().toISOString(),projectId:applied?.id||null,activeVersion:active?.version||0,theme:document.documentElement.dataset.mimaTheme||null,presentation:resolvePresentationPlan(applied),layers:installed,computed,wallpaper:{enabled:wall?.hasAttribute('data-mima-chat-wallpaper')||false,maskOpacity:wallMask},visibleAnimationCount:visibleAnimated,messageDomCount:wall?.querySelectorAll('article.message').length||0,stickerCount:applied?.stickers?.filter(s=>!s.hidden).length||0,visualPixelVerified:false,iosThermalVerified:false,livePreviewTemporary:!!livePreviewOrigin};
}
// A single observable authority owns try-on and recovery. The UI never infers
// canonical trust from whether its own awaited call resolved.
let publishInFlight=false,livePreviewOrigin=null, previewEpoch=0, previewPhase='IDLE',previewError=null,
    pendingExternalRevision=0,previewSettlement=null;
const previewSnapshot=()=>({phase:previewPhase,opId:livePreviewOrigin?.opId||null,
  canonicalVerified:!livePreviewOrigin&&!!active,activeVersion:active?.version||0,
  pendingExternalRevision,reason:previewError?.code||previewError?.message||null});
function reportPreview(phase,error=null){previewPhase=phase;previewError=error;
 window.dispatchEvent(new Event('mima-atelier-preview-state-change'));
}
function recoveryError(err){return Object.assign(new Error('正式主题核验未完成，请使用「重试核对正式主题」；原有存档未修改。'),
 {code:'E_ATL_RESTORE_UNVERIFIED',cause:err,previewState:previewSnapshot()});}
async function beginLivePreview(project){
 await ready;
 if(publishInFlight)throw Object.assign(new Error('正式主题正在提交，暂时不能启动试穿'),{code:'E_ATL_RELEASE_BUSY'});
 if(livePreviewOrigin){await endLivePreview();}
 // A publication can start while an earlier preview is settling.
 if(publishInFlight)throw Object.assign(new Error('正式主题正在提交，不能同时启动试穿'),{code:'E_ATL_RELEASE_BUSY'});
 if(bypass())throw Object.assign(new Error('安全禁用 CSS 模式不能试穿'),{code:'E_ATL_SAFE_MODE'});
 const origin={opId:'preview-'+(++previewEpoch),active:clone(active||{id:null,version:0}),
   verifiedVisual:applied?clone(applied):null};
 livePreviewOrigin=origin;pendingExternalRevision=0;reportPreview('STARTING');
 try{
   // An external broadcast is advisory; the canonical read on exit is mandatory.
   activate(normalized({...project,cssPriority:'atelier-only'}));reportPreview('TEMPORARY');
   return {status:'TEMPORARY_LIVE_PREVIEW',storageCommitted:false,activeVersion:origin.active.version,opId:origin.opId};
 }catch(err){
   // Share one recovery authority with the normal exit path. A failed mount
   // cannot strand a different, invisible recovery state in the editor.
   try{await endLivePreview();}
   catch(recovery){console.error('[Atelier] preview start and canonical recovery failed',origin.opId,err,recovery);}
   err.previewState=previewSnapshot();throw err;
 }
}
// In-place revision of a verified try-on. This never creates a second preview,
// changes the canonical active pointer, or settles a publication.
function updateLivePreview(project,expectedOpId){
 const current=livePreviewOrigin;
 if(!current||previewPhase!=='TEMPORARY'||previewSettlement||publishInFlight||
    !expectedOpId||current.opId!==expectedOpId){
  throw Object.assign(new Error('试穿状态已改变；拒绝覆盖新的正式主题或其他试穿'),{code:'E_ATL_PREVIEW_REVISION_STALE'});
 }
 try{
  activate(normalized({...project,cssPriority:'atelier-only'}));
  return {status:'TEMPORARY_UPDATED',storageCommitted:false,opId:current.opId};
 }catch(error){
  restoreKnownVisualDuringStorageFailure(current.verifiedVisual);
  reportPreview('RECOVERY_REQUIRED',error);
  error.previewState=previewSnapshot();
  throw error;
 }
}
function restoreKnownVisualDuringStorageFailure(snapshot){
 // A visual snapshot is never an authoritative active pointer.
 try{if(snapshot)activate(normalized(snapshot));else deactivate();}
 catch(e){console.error('[Atelier] last-known visual could not be restored',e);}
}
async function endLivePreview(){
 if(previewSettlement)return previewSettlement;
 if(!livePreviewOrigin)return {status:'NOT_PREVIEWING',canonicalVerified:true};
 const origin=livePreviewOrigin;
 reportPreview('RESTORING');
 previewSettlement=(async()=>{
  try{
   let latest;
   // A broadcast may arrive after the first read: never settle onto a known
   // stale revision. Bound the handshake; persistent contention needs a visible retry.
   for(let check=0;check<3;check++){
     latest=await restoreLatestCommittedTheme();
     if(latest.version>=pendingExternalRevision)break;
     if(check===2)throw Object.assign(new Error('其他标签持续发布，正式版本仍待确认'),{code:'E_ATL_EXTERNAL_REVISION_PENDING'});
   }
   // Notices arriving after settlement are handled by the channel handler.
   if(livePreviewOrigin===origin){
     livePreviewOrigin=null;pendingExternalRevision=0;
     // Drop ONLY temporary preview ownership. The main CSS app will restore
     // its last successful global stylesheet via the following event.
     deactivate();
     const snapshot=window.MimaStandalone?.getCssAppearance?.();
     const global=snapshot?.cssPresets?.find(x=>x.id===snapshot?.themeSettings?.globalCssPresetId&&snapshot.themeSettings?.globalCssEnabled!==false&&x.scope==='app');
     if(global)await syncGlobalAppearance(global,{allowLegacy:false});
     reportPreview('RESTORED_VERIFIED');
     window.dispatchEvent(new Event('mima-atelier-presentation-change'));
   }
   return {status:'RESTORED_VERIFIED',version:latest.version,opId:origin.opId};
  }catch(cause){
   restoreKnownVisualDuringStorageFailure(origin.verifiedVisual);
   reportPreview('RECOVERY_REQUIRED',cause);
   console.error('[Atelier] canonical read failed on preview exit',origin.opId,cause);
   throw recoveryError(cause);
  }finally{previewSettlement=null;}
 })();
 return previewSettlement;
}
function deactivate(){observer.disconnect();stickerResizeObserver?.disconnect();ensureStyle().textContent='';ensureStyle().media='';document.documentElement.removeAttribute('data-mima-atelier-active');applied=null;removeDecor();releaseAssets('atelier');syncPriority();window.dispatchEvent(new Event('mima-atelier-presentation-change'));}
function disabled(){sessionStorage.setItem('mima-atl-safe-disabled','1');deactivate();}
function reaffirm(){syncPriority();}
async function initialize(){if(initialized)return;initialized=true;try{active=await get('active')||{id:null,version:0};
 // Legacy active is migration-only. Canonical global CSS selection is resolved
 // by the main app after its Store finishes opening; never mount it on boot.
 if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel(DB);channel.onmessage=async e=>{if(e.data?.kind==='activated'){
  try{const a=await get('active');if(!a||a.version<=(active?.version||0))return;
   // Both checks are needed: a try-on can begin while the DB reads are pending.
   if(livePreviewOrigin||publishInFlight){pendingExternalRevision=Math.max(pendingExternalRevision,a.version);if(livePreviewOrigin)reportPreview(previewPhase,previewError);return;}
   const p=a.id?await get(a.releaseKey||('release:'+a.id+':'+a.version)):null;
   if(a.id&&!p)throw new Error('跨窗口主题内容丢失');
   if(livePreviewOrigin||publishInFlight){pendingExternalRevision=Math.max(pendingExternalRevision,a.version);if(livePreviewOrigin)reportPreview(previewPhase,previewError);return;}
   if(a.version<=(active?.version||0))return;
   active=a;
   // Broadcast refers to historical records, not the canonical CSS choice.
   // Ignore it for presentation; the main Store drives all visible changes.
   const snapshot=window.MimaStandalone?.getCssAppearance?.();const global=snapshot?.cssPresets?.find(x=>x.id===snapshot?.themeSettings?.globalCssPresetId&&snapshot.themeSettings?.globalCssEnabled!==false&&x.scope==='app');
   if(global)await syncGlobalAppearance(global);
  }catch(err){console.error('[Theme Atelier] cross-tab sync',err);}
 }};}}
 catch(e){console.error('[Theme Atelier] startup failed; legacy theme unchanged',e);deactivate();throw e;}}
ready=initialize();ready.catch(()=>{});
let positionQueued=false;function schedulePositionDecor(){if(positionQueued||!applied?.stickers?.some(s=>!s.hidden))return;positionQueued=true;requestAnimationFrame(()=>{positionQueued=false;positionDecor()});}
 window.addEventListener('resize',schedulePositionDecor);window.visualViewport?.addEventListener('resize',schedulePositionDecor); // Anchored stickers move with their DOM owner during scroll; no read/write measurement on every scroll.
// App renders portions of the UI asynchronously; keep attachments in sync without touching source containers.
// Preserve original anchor semantics for arbitrary author CSS and evolving HTML.
const stickerMutationSelectors='.message,.msg-content,.topbar,.composer-shell,.modal-panel,.session-drawer,.session-item,.library-card,details,system,#story-chat-box';
function isRelevantStickerMutation(node){
 if(node.nodeType!==1)return false;
 // New narrative paragraphs do not move message-bound sticker anchors. Re-check
 // when entire message hosts, status details or other stickerable regions change.
 return node.matches?.(stickerMutationSelectors)||!!node.querySelector?.(stickerMutationSelectors);
}
const observer=new MutationObserver(records=>{
 for(const record of records){
  if([...record.addedNodes,...record.removedNodes].some(isRelevantStickerMutation)){
   schedulePositionDecor();break;
  }
 }
});
const stickerResizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>schedulePositionDecor()):null;
function syncDecorObserver(){
 observer.disconnect();stickerResizeObserver?.disconnect();
 if(!applied?.stickers?.some(s=>!s.hidden)||!document.body)return;
 observer.observe(document.body,{childList:true,subtree:true});
 // Text and image loads often change the box without inserting a new anchor.
 // Measure only the exact live sticker anchors, not every streamed DOM element.
 const targets=new Set();
 for(const sticker of applied.stickers||[]){if(sticker.hidden||sticker.anchor==='shell')continue;
  const target=getStickerTarget(sticker.anchor,sticker.targetMessageId);
  if(target?.isConnected)targets.add(target);
 }
 for(const target of targets)stickerResizeObserver?.observe(target);
}
 window.addEventListener('DOMContentLoaded',syncDecorObserver);
async function saveHistory(key,project){await putMany([[key,normalized(project)]]);}
async function latestHistory(id){const found=(await keys()).filter(k=>String(k).startsWith('history:'+id+':')).sort();return found.length?await get(found[found.length-1]):null;}
async function saveDraft(project){
 const p=normalized(project),expected=p.draftVersion||0,db=await getDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,META_STORE],'readwrite'),store=tx.objectStore(STORE),request=store.get('project:'+p.id);let failure=null;
  request.onsuccess=()=>{
   const old=request.result;
   if((old?.draftVersion||0)!==expected){failure=Object.assign(new Error('草稿版本冲突：本页版本 '+expected+'，存储版本 '+(old?.draftVersion||0)+'。原记录未被覆盖。'),{code:'E_ATL_DRAFT_CONFLICT',draftId:p.id,expected,actual:old?.draftVersion||0});tx.abort();return;}
   p.draftVersion=expected+1;p.updatedAt=Math.max(Date.now(),(old?.updatedAt||0)+1);
   store.put(p,'project:'+p.id);tx.objectStore(META_STORE).put(projectListMetadata('project:'+p.id,p),'project:'+p.id);store.put({id:p.id,updatedAt:p.updatedAt},'lastEdited');
  };
  request.onerror=()=>{failure=request.error;tx.abort()};
  tx.oncomplete=()=>resolve(p);tx.onabort=()=>reject(failure||tx.error||Error('草稿保存已取消'));
  tx.onerror=()=>{failure=tx.error};
 });
}
function projectListMetadata(key,p){return {key,id:String(p?.id||key.slice(key.indexOf(':')+1)),name:String(p?.name||'未命名主题'),updatedAt:Number(p?.updatedAt)||0,manualSavedAt:Number(p?.manualSavedAt)||0};}
function listAbort(signal){if(signal?.aborted)throw new DOMException('已取消过时的工坊读取','AbortError');}
let metadataBuildTask=null;
async function ensureProjectMetadata(signal){
 let task=metadataBuildTask;
 if(!task){task={waiters:new Set(),tx:null,cancelled:false};metadataBuildTask=task;
  task.promise=(async()=>{const db=await getDB();if(task.cancelled)throw new DOMException('列表读取已取消','AbortError');return new Promise((resolve,reject)=>{
   const tx=db.transaction([STORE,META_STORE],'readwrite'),meta=tx.objectStore(META_STORE),check=meta.get('@ready');task.tx=tx;let failure=null;
   check.onsuccess=()=>{if(check.result)return;const q=tx.objectStore(STORE).openCursor();
    q.onsuccess=()=>{const c=q.result;if(!c){meta.put({version:1},'@ready');return;}if(/^(project:|manual:)/.test(String(c.key)))meta.put(projectListMetadata(String(c.key),c.value),c.key);c.continue();};
    q.onerror=()=>{failure=q.error;tx.abort();};};
   check.onerror=()=>{failure=check.error;tx.abort();};tx.oncomplete=resolve;tx.onabort=()=>reject(task.cancelled?new DOMException('列表读取已取消','AbortError'):failure||tx.error||Error('工程列表索引建立失败，原工程未更改'));
  });})();task.promise.finally(()=>{task.tx=null;if(metadataBuildTask===task)metadataBuildTask=null;}).catch(()=>{});
 }
 const token={};task.waiters.add(token);const abort=()=>{task.waiters.delete(token);if(!task.waiters.size){task.cancelled=true;if(metadataBuildTask===task)metadataBuildTask=null;task.tx?.abort();}};
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try{await task.promise;listAbort(signal);}finally{signal?.removeEventListener('abort',abort);task.waiters.delete(token);}
}
async function listMetadata(prefix,{offset=0,limit=50,signal}={}){
 listAbort(signal);await ensureProjectMetadata(signal);listAbort(signal);const db=await getDB();listAbort(signal);
 const all=await new Promise((resolve,reject)=>{const tx=db.transaction(META_STORE,'readonly'),q=tx.objectStore(META_STORE).getAll();let rows;
  q.onsuccess=()=>{rows=q.result;};q.onerror=()=>reject(q.error);tx.oncomplete=()=>resolve(rows||[]);tx.onabort=()=>reject(tx.error||Error('列表读取中断'));});
 listAbort(signal);const rows=all.filter(p=>p.key?.startsWith(prefix)).sort((a,b)=>(b.manualSavedAt||b.updatedAt)-(a.manualSavedAt||a.updatedAt)||a.key.localeCompare(b.key));
 offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.max(1,Math.min(200,Math.floor(Number(limit)||50)));
 return {items:rows.slice(offset,offset+limit),total:rows.length,offset,hasMore:offset+limit<rows.length};
}
async function listProjectMetadata(options={}){return listMetadata('project:',options);}
async function listManualMetadata(options={}){return listMetadata('manual:',options);}
// Legacy API shapes remain available. The management UI uses the metadata APIs.
async function listProjects(){return (await keys()).filter(k=>String(k).startsWith('project:')).map(k=>String(k).slice(8));}
async function saveManual(project){const p=normalized(project);const key='manual:'+uid();await putMany([[key,{...p,manualSavedAt:Date.now()}]]);return key;}
async function listManual(){const ks=(await keys()).filter(k=>String(k).startsWith('manual:'));return Promise.all(ks.map(async k=>({key:k,project:await get(k)})));}
async function forkDraft(raw){const p=normalized({...raw,id:uid(),draftVersion:0,linkedCssId:'',updatedAt:Date.now()});return saveDraft(p);}
function exportPresetCss(project,embedded=false){const p=normalized(project);const css=compile(p,'standalone',embedded?{}:{assetMode:'omit'});const media=(p.fonts.length+Object.values(p.elements).filter(e=>e.image).length);const notice=embedded?'Embedded media: this export may be large.':media?`LIGHT CSS: ${media} embedded images/fonts are resolved from the linked Atelier project when mounted inside MIMA. For independent portable use, export the complete ZIP with assets.`:'No external assets.';return `/* MIMA ATELIER standalone CSS preset. ${notice} Dynamic stickers require Atelier. */\n`+css;}

function verifyMountedTheme(project){
 const audit=renderAudit(),plan=resolvePresentationPlan(project),warnings=[],conflicts=[];
 const runtime=document.getElementById('mima-atelier-runtime-style');
 if(!runtime?.isConnected||!runtime.textContent)throw Object.assign(new Error('工坊样式未成功挂载；当前主题不会宣布应用成功'),{code:'E_ATL_STYLE_NOT_MOUNTED'});
 if(plan.themeEnabled&&runtime.media==='not all')throw Object.assign(new Error('工坊样式仍被停用'),{code:'E_ATL_STYLE_DISABLED'});
 if(!plan.themeEnabled&&runtime.media!=='not all')throw Object.assign(new Error('普通 CSS 独占模式仍在显示工坊 CSS'),{code:'E_ATL_LEGACY_ONLY_MOUNT'});
 if(plan.themeEnabled){
   for(const [key,t] of Object.entries(TARGETS)){
     if(project.regions?.[key]===false)continue;
     const target=document.querySelector(t.real.split(',')[0]);
     if(!target){warnings.push({region:key,reason:'target_not_mounted_yet'});continue;}
     const rect=target.getBoundingClientRect();
     if(rect.width<=0||rect.height<=0)warnings.push({region:key,reason:'target_not_visible_yet'});
   }
   if(project.elements?.shell?.image&&project.regions?.shell!==false&&Number(project.elements.shell.blur)>0){
      const pseudo=getComputedStyle(document.body,'::before');
      const effective=pseudo.filter||pseudo.webkitFilter||'none';
      if(!effective.includes('blur(')||pseudo.content==='none')conflicts.push({region:'shell',property:'imageBlur',reason:'layer_not_rendered',effective});
   }
   // These checks are observational. A user-authored !important rule may
   // intentionally override the visual field: report the conflict, but never
   // block canonical publication or edit the author's CSS to enforce parity.
   const inkRegions=['topbar','composer','button','secondary','field','panel'];
   for(const key of inkRegions){
      if(project.regions?.[key]===false)continue;
      const selectors=TARGETS[key]?.real||'';
      for(const selector of selectors.split(',').map(v=>v.trim()).filter(Boolean)){
       const el=document.querySelector(selector);if(!el)continue;
       const expected=hexToComputedColor(project.elements[key].ink);
       const actual=getComputedStyle(el).color;
       if(actual.replace(/\s+/g,'').toLowerCase()!==expected.replace(/\s+/g,'').toLowerCase())
         warnings.push({region:key,selector,property:'color',reason:'computed_override',expected,effective:actual});
       break;
      }
   }
   for(const key of ['topbar','composer','button','secondary','field','panel','message']){
     if(project.regions?.[key]===false)continue;
     const selector=TARGETS[key]?.real.split(',')[0];const el=selector&&document.querySelector(selector);
     if(!el)continue;
     const radius=project.elements[key]?.radius;
     const blur=Number(project.elements[key]?.blur||0);
     const cs=getComputedStyle(el);
     if(blur>0&&!/blur\(/i.test(cs.backdropFilter||cs.webkitBackdropFilter||''))
       warnings.push({region:key,property:'backdrop-filter',reason:'computed_override',expected:`blur(${blur}px)`,effective:cs.backdropFilter||cs.webkitBackdropFilter||'none'});
     if(project.elements[key]?.shape==='pill'&&!parseFloat(cs.borderTopLeftRadius))
       warnings.push({region:key,property:'border-radius',reason:'computed_override',expected:'pill',effective:cs.borderTopLeftRadius});
   }
   const pol=normalizeTextPolicy(project.textPolicy,project.proseTypography);
   if(pol.storyProse.inkMode==='explicit'&&project.regions?.message!==false){
      const prose=document.querySelector('.app-shell .message .msg-content.tavern-story-content:not(.safe-html-content) .story-paragraph');
      if(prose&&getComputedStyle(prose).color.toLowerCase()!==hexToComputedColor(project.elements.message.ink))warnings.push({region:'message',property:'color',reason:'author_css_override'});
   }
 }
 return {audit,warnings,conflicts,computedVerified:conflicts.length===0&&warnings.length===0,pixelVerified:null,visualStatus:'VISUAL_UNVERIFIED'};
}
function hexToComputedColor(color){const c=hex(color);return `rgb(${parseInt(c.slice(1,3),16)}, ${parseInt(c.slice(3,5),16)}, ${parseInt(c.slice(5,7),16)})`;}
async function restoreLatestCommittedTheme(){
 // 'active' is no longer a presentation authority: only read it to settle
 // legacy broadcast identity. Never repaint its obsolete CSS after preview.
 const latest=await get('active')||{id:null,version:0};
 active=latest;
 return latest;
}
async function drainPendingExternalRelease(){
 if(livePreviewOrigin||!pendingExternalRevision)return;
 const notice=pendingExternalRevision;
 if(notice<=(active?.version||0)){pendingExternalRevision=0;return;}
 try{const latest=await restoreLatestCommittedTheme();
  if(latest.version>=notice)pendingExternalRevision=0;
 }catch(err){console.error('[Theme Atelier] queued cross-tab revision needs recovery',notice,err);
  if(lastApplyReceipt)lastApplyReceipt.warnings.push({reason:'external_visual_sync_unverified',revision:notice,error:String(err.message||err)});
 }
}
async function apply(project,options={}){
 await ready;
 if(livePreviewOrigin)throw Object.assign(new Error('试穿后正式主题尚未完成版本核验，请先重试返回。'),{code:'E_ATL_PREVIEW_UNVERIFIED'});
 if(publishInFlight)throw Object.assign(new Error('已有正式主题事务正在执行'),{code:'E_ATL_RELEASE_BUSY'});
 publishInFlight=true;try{
 const p=normalized(project);
 if(bypass())throw Object.assign(new Error('当前处于 ?noCss=1 安全停用模式，请退出后应用主题；草稿仍可保存。'),{code:'E_ATL_SAFE_MODE'});
 const previousVisual=applied?clone(applied):null;
 const previous=await get('active')||{id:null,version:0};
 if(previous.version!==(active?.version||0))throw Object.assign(new Error('其他窗口已更改主题，请先刷新当前主题后再应用。'),{code:'E_ATL_ACTIVE_CONFLICT'});
 const next={id:p.id,version:previous.version+1,releaseKey:'release:'+p.id+':'+(previous.version+1)+':'+uid(),updatedAt:Date.now()};
 const receipt={projectId:p.id,releaseKey:next.releaseKey,version:next.version,previousActive:previous,storageCommitted:false,styleMounted:false,computedVerified:false,pixelVerified:null,conflicts:[],warnings:[],status:'PREPARING'};
 lastApplyReceipt=receipt;
 // The immutable release may exist even if activation later fails. Never
 // update the active pointer before mounting and inspecting the candidate.
 await putMany([[next.releaseKey,p]]);receipt.status='RELEASE_PREPARED';
 try{
   activate(p);receipt.status='MOUNTED_CANDIDATE';receipt.styleMounted=true;
   const check=verifyMountedTheme(p);receipt.computedVerified=check.computedVerified;
   receipt.pixelVerified=check.pixelVerified;receipt.warnings=check.warnings;receipt.conflicts=check.conflicts;
   if(check.conflicts.length)throw Object.assign(new Error('主题样式结构核验失败；未发布新主题'),{code:'E_ATL_COMPUTED_CONFLICT'});
   receipt.status='COMPUTED_CHECKED';
   try{await putMany(options.syncCssLibrary===true
     ?[['active',next],['css-sync:'+next.releaseKey,{releaseKey:next.releaseKey,projectId:p.id,phase:'LIBRARY_SYNC_PENDING',attempt:0,updatedAt:Date.now()}]]
     :[['active',next]],previous.version);}catch(err){err.code=err.code||'E_ATL_ACTIVE_CONFLICT';throw err;}
   active=next;livePreviewOrigin=null;receipt.storageCommitted=true;receipt.status=check.warnings.length?'APPLIED_WITH_WARNINGS':'APPLIED_VISUAL_UNVERIFIED';
   try{channel?.postMessage({kind:'activated'});}catch(err){receipt.warnings.push({reason:'broadcast_failed',details:String(err?.message||err)});}
   window.dispatchEvent(new Event('mima-atelier-presentation-change'));
   return {...next,receipt};
 }catch(e){
   receipt.status='FAILED_WITH_EVIDENCE';receipt.reason=e.code||e.message;
   try{const latest=await restoreLatestCommittedTheme();receipt.restoredVersion=latest.version;}
   catch(recoveryError){receipt.recoveryError=String(recoveryError.message||recoveryError);restoreKnownVisualDuringStorageFailure(previousVisual);receipt.visualStatus='LAST_KNOWN_ONLY_CANONICAL_UNVERIFIED';console.error('[Theme Atelier] failed to restore latest verified pointer',recoveryError);}
   throw e;
 }
 }finally{publishInFlight=false;await drainPendingExternalRelease();}
}
async function cssSyncStatus(releaseKey){
 await ready;
 if(typeof releaseKey!=='string'||!releaseKey.startsWith('release:'))throw Error('同步记录缺少正式主题 releaseKey');
 return await get('css-sync:'+releaseKey);
}
async function settleCssSync(releaseKey,phase,meta={}){
 await ready;
 if(typeof releaseKey!=='string'||!releaseKey.startsWith('release:'))throw Error('CSS 库同步缺少正式主题版本');
 if(!['LIBRARY_SYNC_COMMITTED','LIBRARY_SYNC_FAILED_REPAIRABLE','LIBRARY_SYNC_UNKNOWN'].includes(phase))throw Error('CSS 库同步结算状态无效');
 const db=await getDB();
 // One readwrite IDB transaction is the sole settlement authority for this record.
 // A concurrent failed attempt cannot overwrite an already committed successful receipt.
 return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),key='css-sync:'+releaseKey;
  let result=null,failure=null;
  const req=store.get(key);
  req.onsuccess=()=>{
   const original=req.result;
   if(!original){failure=new Error('缺少 CSS 库同步意图；禁止伪造成功');tx.abort();return;}
   if(original.phase==='LIBRARY_SYNC_COMMITTED'){result=original;return;}
   result={...original,phase,attempt:(original.attempt||0)+1,
    cssPresetId:String(meta.cssPresetId||'').slice(0,180),error:String(meta.error||'').slice(0,500),updatedAt:Date.now()};
   store.put(result,key);
  };
  req.onerror=()=>{failure=req.error||Error('同步状态读取失败');tx.abort();};
  tx.oncomplete=()=>resolve(result);
  tx.onabort=()=>reject(failure||tx.error||Error('CSS 同步结算已中止'));
  tx.onerror=()=>{failure=tx.error||failure;};
 });
}
async function unapply(){
 await ready;
 if(livePreviewOrigin)throw Object.assign(new Error('试穿恢复尚未通过版本核验，禁止改写正式主题。'),{code:'E_ATL_PREVIEW_UNVERIFIED'});
 if(publishInFlight)throw Object.assign(new Error('已有正式主题事务正在执行'),{code:'E_ATL_RELEASE_BUSY'});
 publishInFlight=true;
 try{
  const previous=await get('active')||{id:null,version:0};
  if(previous.version!==(active?.version||0))throw Object.assign(new Error('其他窗口已更改主题'),{code:'E_ATL_ACTIVE_CONFLICT'});
  const next={id:null,version:previous.version+1,updatedAt:Date.now()};
  await putMany([['active',next]],previous.version);
  active=next;
  try{deactivate();}
  catch(err){console.error('[Theme Atelier] unapply committed; visual cleanup failed',err);
   try{await restoreLatestCommittedTheme();}catch(recovery){console.error('[Theme Atelier] committed unapply recovery unverified',recovery);}
   throw Object.assign(new Error('正式停用指针已提交，但外观清理失败，需重新核对'),{code:'E_ATL_UNAPPLY_VISUAL_UNVERIFIED',cause:err});}
  try{channel?.postMessage({kind:'activated',version:next.version});}catch(err){console.error('[Theme Atelier] unapply broadcast failed',err);}
  return {status:'UNAPPLIED_COMMITTED',version:next.version};
 }finally{publishInFlight=false;await drainPendingExternalRelease();}
}
async function resolveLibraryCss(preset,owner='library-global',{signal}={}){
 const check=()=>{if(signal?.aborted)throw new DOMException('已取消过时的工坊资源准备','AbortError');};check();
 if(!preset?.atelierReleaseKey)return preset?.css||'';
 const p=await get(preset.atelierReleaseKey);check();if(!p)throw Error('工坊 CSS 引用的独立资源快照不存在，原 CSS 预设未被修改');
 const checked=normalized(p);check();const compiled=compiledWithAssets(checked,'standalone',owner);
 const lease='pending:'+uid();assetOwners.set(lease,compiled.used);let settled=false;
 const discard=()=>{if(settled)return;settled=true;signal?.removeEventListener('abort',discard);assetOwners.delete(lease);commitAssetOwner(owner,assetOwners.get(owner)||new Set());};
 signal?.addEventListener('abort',discard,{once:true});
 try{check();}catch(error){discard();throw error;}
 return {css:compiled.css,project:checked,accept:()=>{check();if(settled)return;settled=true;signal?.removeEventListener('abort',discard);assetOwners.set(owner,compiled.used);assetOwners.delete(lease);commitAssetOwner(owner,compiled.used);},discard};
}
async function exportRecords(){
 await ready;const db=await getDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).openCursor(),records=[];let problem=null;
  q.onsuccess=()=>{const cursor=q.result;if(!cursor)return;records.push([cursor.key,cursor.value]);cursor.continue();};
  q.onerror=()=>{problem=q.error;tx.abort();};tx.oncomplete=()=>resolve({format:'mima-atelier-records',version:1,records});tx.onabort=()=>reject(problem||tx.error||Error('工坊备份事务中断'));
 });
}
function validateRecordImport(payload){
 if(!payload||payload.format!=='mima-atelier-records'||payload.version!==1||!Array.isArray(payload.records))throw Error('工坊素材备份格式无效');
 const seen=new Set();
 for(const row of payload.records){if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!(/^(project:|manual:|history:|release:|css-release:|css-sync:)/.test(row[0])||['active','lastEdited'].includes(row[0]))||seen.has(row[0]))throw Error('工坊素材记录键重复或无效');seen.add(row[0]);
  if(/^(project:|manual:|history:|release:|css-release:)/.test(row[0]))normalized(row[1]);
 }
 return payload.records;
}
// Editable project drafts are versioned, not immutable releases. A restore must
// preserve BOTH revisions; publishing snapshots remain strict immutable assets.
function importRecordPlan(rows,existing){
 const planned=[],seen=new Set(),stats={total:rows.length,toImport:0,alreadyPresent:0,devicePointersPreserved:0,forkedDrafts:0};

 for(const [inputKey,inputValue] of rows){let key=inputKey,value=inputValue;
  const previous=existing.get(key);
  if(previous!==undefined&&JSON.stringify(previous)!==JSON.stringify(value)){
   if(key.startsWith('project:')){
    const forkId=String(inputValue.id)+'_restored_'+importFingerprint(inputValue);
    key='project:'+forkId;
    value=normalized({...inputValue,id:forkId,draftVersion:0,name:String(inputValue.name||'主题')+' · 备份版本'});
    stats.forkedDrafts++;
   }else if(key.startsWith('css-sync:')||key==='active'||key==='lastEdited'){
    // These are local progress pointers; do not replace newer local state.
    stats.devicePointersPreserved++;continue;
   }else throw Error('工坊不可变资源与现有记录冲突：'+key+'。原资产和备份都未被覆盖');
  }
  if(seen.has(key))throw Error('工坊备份映射存在重复主键：'+key);seen.add(key);
  const target=existing.get(key);
  if(target===undefined){stats.toImport++;planned.push([key,value]);}
  else if(JSON.stringify(target)===JSON.stringify(value))stats.alreadyPresent++;
  else throw Error('工坊导入副本键冲突：'+key+'。未覆盖原草稿');
 }
 return{records:planned,summary:stats};
}
function importFingerprint(value){const text=JSON.stringify(value);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return(h>>>0).toString(16).padStart(8,'0');}
function readImportTargets(store,rows,complete,fail){
 const names=new Set(rows.map(([key])=>key));for(const [key,value] of rows)if(key.startsWith('project:'))names.add('project:'+String(value.id)+'_restored_'+importFingerprint(value));
 const existing=new Map();let remaining=names.size;if(!remaining){complete(existing);return;}
 for(const key of names){const q=store.get(key);q.onerror=()=>fail(q.error);q.onsuccess=()=>{if(q.result!==undefined)existing.set(key,q.result);if(!--remaining)complete(existing);};}
}
async function previewRecordImport(payload){
 await ready;const rows=validateRecordImport(payload),db=await getDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE);let issue=null,result;
  readImportTargets(store,rows,existing=>{try{result=importRecordPlan(rows,existing).summary;}catch(error){issue=error;tx.abort();}},error=>{issue=error;tx.abort();});
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(issue||tx.error||Error('工坊预检中止'));
 });
}
async function importRecords(payload){
 await ready;const rows=validateRecordImport(payload),db=await getDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,META_STORE],'readwrite'),store=tx.objectStore(STORE);let issue=null,results;
  readImportTargets(store,rows,existing=>{try{results=importRecordPlan(rows,existing);for(const [key,value] of results.records){store.put(value,key);if(/^(project:|manual:)/.test(key))tx.objectStore(META_STORE).put(projectListMetadata(key,value),key);}}catch(error){issue=error;tx.abort();}},error=>{issue=error;tx.abort();});
  tx.oncomplete=()=>resolve({imported:results?.records.length||0,existing:results?.summary?.alreadyPresent||0,forkedDrafts:results?.summary?.forkedDrafts||0,devicePointersPreserved:results?.summary?.devicePointersPreserved||0});tx.onabort=()=>reject(issue||tx.error||Error('工坊素材导入事务已撤销'));
 });
}
let legacyMigrationPromise=null;
async function migrateLegacyTheme(){
 if(legacyMigrationPromise)return legacyMigrationPromise;
 legacyMigrationPromise=(async()=>{
  await ready;
  const state=window.MimaStandalone?.getCssAppearance?.();
  if(!state||!Array.isArray(state.cssPresets))throw Error('主资料库尚未就绪，不能核对旧工坊主题');
  const setting=state.themeSettings||{};
  if(bypass()||setting.globalCssEnabled===false||setting.globalCssPresetId||state.cssPresets.some(p=>p.atelierReleaseKey))return {status:'NOT_NEEDED'};
  const pointer=await get('active');if(!pointer?.id)return {status:'NO_LEGACY'};
  const key=pointer.releaseKey||('release:'+pointer.id+':'+pointer.version);
  const raw=await get(key);if(!raw)throw Error('旧工坊主题素材缺失，保留旧 active 指针且拒绝伪迁移');
  const project=normalized(raw);
  // The immutable snapshot is staged first. The canonical pointer is written
  // only by /atelier/publish, which handles idempotency and CAS.
  const payload=JSON.stringify(project),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const releaseKey='css-release:'+project.id+':'+digest,stableId='css-atl-'+digest;
  const existing=await get(releaseKey);
  if(existing&&JSON.stringify(existing)!==payload)throw Error('旧主题迁移遇到不可变快照冲突：'+releaseKey);
  if(!existing)await putMany([[releaseKey,project]]);
  const css=compile(project,'standalone',{assetMode:'omit'});
  const receipt=await window.MimaStandalone.handle('/atelier/publish','POST',{preset:{id:stableId,name:project.name+' · 旧工坊迁移',css,scope:'app',surface:'global',category:'主题工坊',atelierReleaseKey:releaseKey}});
  if(!receipt?.success||receipt.data?.preset?.id!==stableId||receipt.data.preset.atelierReleaseKey!==releaseKey||receipt.data.preset.css!==css)throw Error(receipt?.msg||'旧主题迁移提交未通过核验');
  return {status:'MIGRATED',id:stableId};
 })();
 try{return await legacyMigrationPromise;}finally{legacyMigrationPromise=null;}
}
function portableBundle(project){const files={},seen=new Map();let n=0;
 const css=compile(normalized(project),'portable',{assetUrl(src,kind,font){if(!src?.startsWith('data:'))return src;let p=seen.get(src);if(!p){const ext=kind==='font'?(font?.format||'woff2'):/^data:image\/([^;]+)/.exec(src)?.[1]||'png';p=`assets/asset_${++n}.${String(ext).replace(/[^a-z0-9]/gi,'')}`;const raw=atob(src.slice(src.indexOf(',')+1));const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);files[p]=bytes;seen.set(src,p);}return p;}});
 return {css,files,assetSources:[...seen.entries()]};}
// Blob URLs are document-scoped. BFCache pagehide keeps this document and CSS alive.
// Never revoke its live resources on pagehide; normal owner changes still reclaim stale URLs,
// and the browser reclaims all object URLs when the document is actually destroyed.
window.MimaAtelierCore={syncGlobalAppearance,migrateLegacyTheme,exportRecords,validateRecordImport,previewRecordImport,importRecords,cssSyncStatus,settleCssSync,appearanceWarnings,resolvePresentationPlan,presentationLayers,liveLegacyLayers,beginLivePreview,updateLivePreview,endLivePreview,appearanceDiagnostics,normalizeTextPolicy,computeStickerRect,renderAudit,getLastApplyReceipt:()=>lastApplyReceipt&&clone(lastApplyReceipt),getPreviewState:()=>previewSnapshot(),getPublishState:()=>({busy:publishInFlight,receipt:lastApplyReceipt&&clone(lastApplyReceipt),activeVersion:active?.version||0}),TARGETS,DEFAULT,DEFAULT_INTERACTIONS,normalizeInteractions,STYLES,PATTERNS,baseTheme,normalized,clone,clamp,hex,esc,rgba,uid,patternCSS,compile,get,saveDraft,apply,unapply,disabled,reaffirm,bypass,ready,_historySave:saveHistory,_historyLatest:latestHistory,listProjects,listProjectMetadata,listManualMetadata,saveManual,listManual,forkDraft,exportPresetCss,resolveLibraryCss,releaseAssets,setPreviewImageAssets,previewImageUrl,portableBundle,previewCss,getActive:()=>clone(active||{id:null,version:0}),getApplied:()=>applied&&clone(applied),getPresentationMode:()=>applied?.cssPriority||'',positionDecor};
})();
