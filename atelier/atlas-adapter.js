/* MIMA Atlas R1 — local parameterized adaptations. No remote code, no mutation of existing user projects. */
(()=>{'use strict';
const C=window.MimaAtelierCore, Catalog=window.MimaAtelierCatalog;
if(!C||!Catalog){console.error('[MIMA Atlas] required catalog/core missing');return;}
const DEFAULT_BG=['#f8f7f5','#f2f5f8','#fff7fa','#eee7d6','#1b1b2e','#12151d','#dceef1','#f4ebe6'];
const DEFAULT_FG=['#27242b','#283746','#46384b','#4a392f','#e9e7f1','#f0f4fa','#235b61','#62443e'];
const ACCENTS=['#a378a0','#5c90b1','#e68aa8','#bf8b4f','#a78bfa','#04aeba','#da745d','#89a174','#e2a73b','#5c66b8','#da5064','#53aca5'];
const groupSets={
 'lace':/lolita|shoujo|kawaii|pastel|paper-craft|cottagecore|victorian|botanical|romantic|manga/i,
 'stars':/magic|witch|cosmic|celestial|surreal|fantasy|dream|aurora/i,
 'neon':/cyber|synth|vapor|neon|out ?run|acid|glitch|holo|arcade|vhs|anime/i,
 'metal':/y2k|frutiger|liquid|aqua|macos|fluent|glass|holographic/i,
 'pixels':/pixel|terminal|retro-game|jrpg|mecha/i,
 'print':/editorial|magazine|print|riso|latex|paper|ink|swiss|poster|typography|brutalist-web/i,
 'ornate':/art-deco|art-nouveau|gothic|medieval|islamic|geometric|indian|african|victorian|luxury|marble/i,
 'organic':/organic|natural|zen|wabi|terracotta|watercolor|garden|tropical|solar|cottage|japanese/i,
 'technical':/hud|blueprint|dashboard|data|developer|constructivism|bauhaus/i,
 'minimal':/minimal|monochrome|apple|corporate|notion|linear|github|shopify|clean|soft-utility/i,
 'retro':/vintage|steampunk|mid-century|skeuo|retro|film|noir|comic|pop-art|memphis/i
};
const inferGroup=(slug)=>Object.keys(groupSets).find(k=>groupSets[k].test(slug))||'expressive';
const GROUPS={
 lace:{material:'clay',effect:'lace',radius:29,border:1,shadow:12},
 stars:{material:'glass',effect:'stars',radius:22,border:1,shadow:15},
 neon:{material:'glass',effect:'scanlines',radius:9,border:1,shadow:18},
 metal:{material:'aqua',effect:'gloss',radius:24,border:2,shadow:19},
 pixels:{material:'brutal',effect:'pixels',radius:1,border:3,shadow:8},
 print:{material:'minimal',effect:'paper',radius:3,border:1,shadow:2},
 ornate:{material:'skeuo',effect:'ornate',radius:11,border:2,shadow:12},
 organic:{material:'skeuo',effect:'grain',radius:23,border:1,shadow:11},
 technical:{material:'flat',effect:'grid',radius:8,border:1,shadow:7},
 minimal:{material:'minimal',effect:'none',radius:18,border:1,shadow:5},
 retro:{material:'skeuo',effect:'stripes',radius:13,border:2,shadow:14},
 expressive:{material:'flat',effect:'geometric',radius:15,border:2,shadow:12}
};
const UNIQUE={
 'neo-brutalist':['brutal','geometric',1], 'neo-brutalist-soft':['brutal','dots',16], 'neo-brutalist-playful':['brutal','geometric',8],
 'glassmorphism':['glass','gloss',26], 'neumorphism':['neo','none',26], 'soft-ui':['neo','none',28], 'claymorphism':['clay','dots',32],
 'liquid-glass':['glass','gloss',34], 'frutiger-aero':['aqua','bubbles',28], 'macos-vibrancy':['glass','grain',26], 'material-design':['flat','none',16],
 'fluent-design':['glass','gloss',12], 'neon-tokyo':['glass','scanlines',11], 'cyberpunk-neon':['brutal','scanlines',1],
 'pixel-art':['brutal','pixels',1], 'pixel-anime':['brutal','pixels',3], 'arcade-crt':['brutal','scanlines',5], 'vaporwave':['glass','grid',10],
 'y2k':['aqua','gloss',30], 'synthwave':['glass','grid',16], 'paper-craft':['skeuo','paper',17], 'gothic-lolita':['skeuo','lace',17],
 'witchcore':['glass','stars',12], 'korean-minimal':['minimal','none',23], 'japanese-fresh':['minimal','dots',22], 'pastel-ui':['clay','dots',28],
 'visual-novel':['glass','gloss',20], 'editorial':['minimal','paper',1], 'mid-century-modern':['skeuo','geometric',10],
 'art-deco':['skeuo','ornate',4], 'wabi-sabi':['minimal','grain',14], 'blueprint':['flat','grid',4], 'sci-fi-hud':['glass','grid',4],
 'gothic':['skeuo','ornate',8], 'pastel-goth':['clay','lace',18], 'frutiger-aero':['aqua','bubbles',22],
 'op-art':['brutal','waves',0], 'risograph':['flat','grain',3], 'film-noir':['minimal','grain',1],
 'gothic-lolita':['skeuo','lace',20], 'watercolor-style':['minimal','watercolor',28], 'watercolor-art':['minimal','watercolor',24],
 'natural-organic':['skeuo','grain',25], 'holographic':['glass','holo',28], 'shader-gradient':['glass','holo',28],
 'paper-craft':['skeuo','paper',20], 'kawaii-minimal':['clay','dots',28], 'marble-luxury':['glass','marble',18],
 'scandinavian':['minimal','none',15], 'neon-gradient':['glass','holo',18], 'monochrome':['flat','grain',10],
 'developer-terminal':['brutal','grid',3], 'bauhaus':['flat','geometric',2], 'memphis':['flat','geometric',10],
 'ink-wash':['minimal','watercolor',14], 'constructivism':['brutal','geometric',1], 'mecha':['brutal','grid',6],
};
const Korean={
 'mima-inspo-k01':{material:'glass',effect:'stars',radius:29,blur:20,opacity:62,shadow:14,night:true,layout:'soft-dock'},
 'mima-inspo-k02':{material:'minimal',effect:'none',radius:28,blur:0,opacity:96,shadow:5,night:false,layout:'role-bubble'},
 'mima-inspo-k03':{material:'minimal',effect:'paper',radius:6,blur:0,opacity:100,shadow:1,night:false,layout:'editorial'},
 'mima-inspo-k04':{material:'clay',effect:'lace',radius:26,blur:3,opacity:96,shadow:8,night:false,layout:'role-bubble'},
 'mima-inspo-k05':{material:'glass',effect:'grain',radius:32,blur:26,opacity:42,shadow:12,night:true,layout:'photo-journal'}
};
function brightness(c){const m=String(c).match(/^#([0-9a-f]{6})$/i);if(!m)return 180;const v=[1,3,5].map(i=>parseInt(m[1].slice(i-1,i+1),16));return .2126*v[0]+.7152*v[1]+.0722*v[2]}
function chooseInk(bg){return brightness(bg)>151?'#28262c':'#f2f1f4'}
function computedPalette(entry){if(entry.palette)return entry.palette;
 const slug=entry.id,idx=Catalog.items.findIndex(e=>e.id===slug),g=inferGroup(slug);
 const bi={neon:5,metal:6,print:0,ornate:4,organic:3,technical:1,minimal:0,pixels:4,retro:3,lace:2,stars:4,expressive:2}[g];
 return [DEFAULT_FG[bi],DEFAULT_BG[bi],ACCENTS[(idx*5+Math.floor(idx/8))%ACCENTS.length]];
}
function decorateElements(theme,opts){for(const [key,e] of Object.entries(theme.elements)){
 const isShell=key==='shell',isButton=key==='button',isMessage=key==='message';
 Object.assign(e,{material:opts.material,fill:opts.bg,ink:chooseInk(opts.bg),accent:opts.accent,alpha:opts.opacity??(isShell?100:isMessage?57:90),blur:opts.blur??(isShell?0:isMessage?1:opts.material==='glass'?16:opts.material==='aqua'?10:0),radius:opts.radius,shadow:opts.shadow,border:opts.border??1,borderColor:brightness(opts.bg)>130?'#ffffff':opts.accent,borderAlpha:opts.borderAlpha??48,gradient:opts.gradient||'none',gradientTo:opts.gradientTo||opts.bg,visualEffect:isShell?opts.effect:key==='topbar'||key==='panel'||key==='composer'?opts.effect:'none',decorColor:opts.accent,decorOpacity:isShell?opts.effectOpacity??25:opts.effectOpacity??18,decorSize:opts.decorSize||26});
 if(isShell)Object.assign(e,{alpha:100,blur:0,shadow:0,radius:0,border:0,gradient:opts.shellGradient||opts.gradient||'linear',gradientTo:opts.gradientTo||opts.bg});
 if(isButton)Object.assign(e,{fill:opts.accent,ink:chooseInk(opts.accent),alpha:100,radius:Math.min(65,opts.radius+4),border:Math.max(1,opts.border||0),shadow:Math.max(3,opts.shadow-3),gradient:opts.material==='aqua'?'linear':'none',gradientTo:opts.bg,ornament:opts.effect==='lace'?'cream':opts.effect==='ornate'?'double':'none'});
 if(key==='secondary'||key==='field')Object.assign(e,{fill:opts.bg,alpha:Math.max(65,opts.opacity??86),shadow:Math.max(0,opts.shadow-8),visualEffect:'none'});
 if(isMessage)Object.assign(e,{alpha:opts.messageAlpha??(opts.material==='glass'?58:opts.material==='minimal'?30:75),shadow:0,blur:0,border:0,radius:Math.max(2,opts.radius-2),visualEffect:'none'});
 if(key==='status')Object.assign(e,{alpha:opts.opacity??90,shadow:Math.max(0,opts.shadow-8),visualEffect:'none'});
 }}
function make(id){const entry=Catalog.find(id);if(!entry||entry.type==='layout')throw Error('不是可创建的视觉模板：'+id);
 const korean=Korean[id],group=inferGroup(id),conf=GROUPS[group],unique=UNIQUE[id],palette=computedPalette(entry),[primary,background,accent]=palette;
 const dark=brightness(background)<110,genre=unique||[conf.material,conf.effect,conf.radius];
 let opts={material:genre[0],effect:genre[1],radius:genre[2],shadow:conf.shadow,border:conf.border,
  bg:background,accent,ink:primary,opacity:genre[0]==='glass'?73:92};
 if(korean)opts={...opts,...korean,accent:palette[2],bg:palette[1]};
 if(id==='mima-inspo-k01'){opts.bg='#d5d5d8';opts.gradientTo='#f1f1f3';opts.shellGradient='linear';}
 if(id==='mima-inspo-k02'){opts.bg='#f8f8fa';opts.gradientTo='#ffffff';opts.shellGradient='linear';}
 if(id==='mima-inspo-k03'){opts.bg='#ffffff';opts.gradientTo='#fafafa';opts.shellGradient='none';}
 if(id==='mima-inspo-k04'){opts.bg='#fff7fb';opts.gradientTo='#ffe8f1';opts.shellGradient='linear';}
 if(id==='mima-inspo-k05'){opts.bg='#d9d6d2';opts.gradientTo='#8f8b89';opts.shellGradient='linear';}
 if(['liquid-glass','holographic','shader-gradient','modern-gradient','neon-gradient','vaporwave'].includes(id))Object.assign(opts,{gradient:'radial',gradientTo:primary});
 if(['neo-brutalist','neo-brutalist-playful','bauhaus','constructivism','brutalist-web'].includes(id))Object.assign(opts,{border:3,shadow:9});
 if(['soft-ui','neumorphism'].includes(id))Object.assign(opts,{border:0,shadow:19});
 const t=C.baseTheme('liquid-frost');t.name=`${entry.name} · 自定义`;t.template='atlas:'+id;
 t.originPreset=id;t.layoutRecipe=korean?.layout||'story';decorateElements(t,opts);
 if(['lace','dots','waves','geometric','grid','pixels'].includes(opts.effect)){
  const pat={lace:'dots',dots:'dots',waves:'waves',geometric:'diamond',grid:'grid',pixels:'checker'}[opts.effect];
  t.patterns=[{id:C.uid(),target:'shell',type:pat,color:accent,opacity:id==='mima-inspo-k04'?12:9,size:opts.effect==='lace'?21:opts.effect==='grid'?28:36,weight:opts.effect==='lace'?1.6:1.1,angle:45,offsetX:0,offsetY:0,enabled:true}];
 }
 if(opts.night){const night=C.clone(t.elements);const tint=(id==='mima-inspo-k01')?'#333439':'#242326';
 for(const [k,e] of Object.entries(night)){e.fill=tint;e.ink='#f5f2f6';e.borderColor='#88868c';e.decorColor=id==='mima-inspo-k01'?'#eeeef4':'#c5c0bf';if(k==='button'){e.fill='#55545c';e.ink='#ffffff'}if(k==='shell'){e.fill=id==='mima-inspo-k01'?'#313237':'#252429';e.gradientTo=id==='mima-inspo-k01'?'#4e4f54':'#454142'} }
 t.variants.night={elements:night,patterns:C.clone(t.patterns)};
 }
 return C.normalized(t);
}
function borrow(project,id,target){const proposal=make(id);if(!C.TARGETS[target])throw Error('找不到可借用的区域');const p=C.normalized(project),isNight=!!(p.variants&&p.variants.night);
 p.elements[target]={...C.clone(proposal.elements[target]),image:p.elements[target].image,fontFamily:p.elements[target].fontFamily,imageOpacity:p.elements[target].imageOpacity,imagePosX:p.elements[target].imagePosX,imagePosY:p.elements[target].imagePosY,maskOpacity:p.elements[target].maskOpacity,maskColor:p.elements[target].maskColor};p.patterns=p.patterns.filter(x=>x.target!==target).concat(proposal.patterns.filter(x=>x.target===target).map(x=>({...x,id:C.uid()})));
 if(isNight){p.variants.night.elements[target]={...C.clone((proposal.variants.night?.elements||proposal.elements)[target]),image:p.variants.night.elements[target].image,fontFamily:p.variants.night.elements[target].fontFamily,imageOpacity:p.variants.night.elements[target].imageOpacity,imagePosX:p.variants.night.elements[target].imagePosX,imagePosY:p.variants.night.elements[target].imagePosY,maskOpacity:p.variants.night.elements[target].maskOpacity,maskColor:p.variants.night.elements[target].maskColor};p.variants.night.patterns=p.variants.night.patterns.filter(x=>x.target!==target).concat((proposal.variants.night?.patterns||proposal.patterns).filter(x=>x.target===target).map(x=>({...x,id:C.uid()})))}
 return C.normalized(p);
}
const AVAILABLE_LAYOUTS=new Set(['bento-grid','masonry-flow','split-screen','timeline-vertical','card-stack','sidebar-fixed','magazine-grid','dashboard-layout','f-pattern-layout','z-pattern-layout','holy-grail-layout','asymmetric-grid','horizontal-gallery','parallax-editorial']);
window.MimaAtelierAtlas=Object.freeze({make,borrow,hasLayout(id){return AVAILABLE_LAYOUTS.has(id)},getPalette:computedPalette,group:inferGroup});
})();
