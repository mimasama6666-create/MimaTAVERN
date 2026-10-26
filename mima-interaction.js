/* MimaTAVERN interactive surfaces R19: cosmetic only; never intercept user actions. */
(() => {
 'use strict';
 const FALLBACK={enabled:true,animation:'jelly',duration:340,particles:'sparkles',particleCount:5,transitions:true,soundEnabled:true,volume:24,sounds:{normal:'',send:'',menu:''}};
 const NOTES={normal:[587.33,783.99],send:[659.25,987.77],menu:[523.25,659.25]};
 let settings={...FALLBACK,sounds:{...FALLBACK.sounds}},signature='',ctx=null,sourceUrls=new Map();
 const live=new Set();let lastFeedback=0;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):a));
 function normalize(v){const c=window.MimaAtelierCore;return c?.normalizeInteractions?c.normalizeInteractions(v):{...FALLBACK,sounds:{...FALLBACK.sounds}};}
 function disposeSounds(){for(const url of sourceUrls.values())URL.revokeObjectURL(url);sourceUrls.clear();}
 function apply(raw){
  let next;try{next=normalize(raw)}catch(error){console.error('[Interaction] invalid published theme; built-in feedback retained',error);next=normalize();}
  // Keep the decoded asset URL lease when CSS is repainted without changing interaction settings.
  const nextSig=JSON.stringify(next);if(nextSig===signature)return settings;
  signature=nextSig;settings=next;disposeSounds();
  document.documentElement.dataset.mimaFeedback=next.enabled?'on':'off';
  document.documentElement.dataset.mimaMenuMotion=next.enabled&&next.transitions?'on':'off';
  return {...next};
 }
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 function closestButton(event){
  const path=event.composedPath?.()||[event.target];
  if(path.some(node=>node?.id==='mima-atelier-host'))return null;
  for(const node of path){
   if(!(node instanceof Element))continue;
   const button=node.closest?.('button,[role="button"],summary,.session-item');
   if(!button)continue;
   if(button.closest('#story-chat-box .safe-html-content,[data-mima-no-interaction],.mima-no-interaction'))return null;
   if(button.disabled||button.getAttribute('aria-disabled')==='true'||button.matches('[hidden],.hidden'))return null;
   if(!button.isConnected)return null;
   return button;
  }
  return null;
 }
 function kindFor(button){
  if(button.matches('.send-btn,#story-send,[data-action="send"],[data-action="continue"],#story-continue,#story-playtoolbox-toggle'))return 'send';
  const label=(button.getAttribute('aria-label')||'')+' '+(button.textContent||'').slice(0,18);
  if(/发送|续写|继续|推进|生成/.test(label))return 'send';
  if(button.closest('.topbar,.session-drawer,.mima-feature-menu,.settings-tabs')||/菜单|设置|剧情|主题|功能|关闭|返回/.test(label))return 'menu';
  return 'normal';
 }
 function playFile(source,volume){
  let url=sourceUrls.get(source);
  if(!url){
   const at=source.indexOf(',');const mime=source.slice(5,source.indexOf(';'));
   const bytes=atob(source.slice(at+1)),out=new Uint8Array(bytes.length);
   for(let i=0;i<bytes.length;i++)out[i]=bytes.charCodeAt(i);
   url=URL.createObjectURL(new Blob([out],{type:mime}));sourceUrls.set(source,url);
  }
  if(live.size>=4){const oldest=live.values().next().value;try{oldest.pause()}catch{}live.delete(oldest);}
  const audio=new Audio();audio.preload='auto';audio.src=url;audio.volume=volume;
  live.add(audio);
  const release=()=>{live.delete(audio);audio.removeEventListener('ended',release);audio.removeEventListener('error',release);};
  audio.addEventListener('ended',release,{once:true});audio.addEventListener('error',release,{once:true});
  try{const start=audio.play();if(start?.catch)start.catch(err=>{release();if(err?.name!=='NotAllowedError')console.warn('[Interaction] sound playback failed',err);});}
  catch(error){release();console.warn('[Interaction] sound playback failed',error);}
 }
 function synth(kind,volume){
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  try{
   if(!ctx)ctx=new AC();
   // AudioContext must be resumed directly in a real click event on iOS Safari.
   if(ctx.state==='suspended')ctx.resume().catch(()=>{});
   const now=ctx.currentTime;
   for(const [i,freq] of (NOTES[kind]||NOTES.normal).entries()){
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(freq,now+i*.055);
    gain.gain.setValueAtTime(0,now+i*.055);gain.gain.linearRampToValueAtTime(volume*.095,now+i*.055+.016);
    gain.gain.exponentialRampToValueAtTime(.0001,now+i*.055+.115);
    oscillator.connect(gain);gain.connect(ctx.destination);oscillator.start(now+i*.055);oscillator.stop(now+i*.055+.13);
   }
  }catch(error){console.warn('[Interaction] built-in sound unavailable',error);}
 }
 function sound(conf,kind){if(!conf.enabled||!conf.soundEnabled||!conf.volume)return;
  const volume=clamp(conf.volume,0,100)/100;
  const asset=conf.sounds?.[kind];
  if(asset){try{playFile(asset,volume)}catch(error){console.warn('[Interaction] imported audio is unreadable',error);}return;}
  synth(kind,volume);
 }
 function bounce(button,conf){if(reduced()||!conf.enabled||conf.animation==='none'||!button.animate)return;
  const duration=clamp(conf.duration,140,850);
  const map={
    jelly:[{transform:'scale(1,1)'},{transform:'scale(1.065,.91)',offset:.21},{transform:'scale(.975,1.045)',offset:.49},{transform:'scale(1.015,.985)',offset:.74},{transform:'scale(1,1)'}],
    press:[{transform:'translateY(0) scale(1)'},{transform:'translateY(2px) scale(.965)',offset:.38},{transform:'translateY(0) scale(1)'}],
    glow:[{filter:'brightness(1)',boxShadow:'0 0 0 0 rgba(236,188,223,0)'},{filter:'brightness(1.12)',boxShadow:'0 0 0 8px rgba(236,188,223,.40)',offset:.45},{filter:'brightness(1)',boxShadow:'0 0 0 0 rgba(236,188,223,0)'}],
    ripple:[{filter:'brightness(1)'},{filter:'brightness(1.16)',offset:.34},{filter:'brightness(1)'}]
  };
  try{button.animate(map[conf.animation]||map.press,{duration,easing:'cubic-bezier(.22,.8,.24,1)',composite:'replace'});}catch(error){console.warn('[Interaction] animation unsupported',error);}
 }
 const symbols={sparkles:['✦','✧','⋆'],hearts:['♡','♥'],petals:['🌸','✿'],paw:['🐾','✧']};
 function particles(conf,x,y){if(!conf.enabled||reduced()||conf.particles==='none'||conf.particleCount===0)return;
  const choices=symbols[conf.particles]||symbols.sparkles;
  const total=clamp(conf.particleCount,0,12),duration=clamp(conf.duration+170,300,1000);
  for(let i=0;i<total;i++){
   const node=document.createElement('span');node.className='mima-tap-particle';node.textContent=choices[i%choices.length];
   const a=Math.PI*2*(i/total),distance=26+(i%3)*11;
   node.style.left=x+'px';node.style.top=y+'px';node.style.setProperty('--dx',Math.round(Math.cos(a)*distance)+'px');
   node.style.setProperty('--dy',Math.round(Math.sin(a)*distance-13)+'px');node.style.setProperty('--tap-life',duration+'ms');
   document.body.appendChild(node);node.addEventListener('animationend',()=>node.remove(),{once:true});setTimeout(()=>node.remove(),duration+120);
  }
 }
 function ripple(conf,x,y){if(!conf.enabled||reduced()||conf.animation!=='ripple')return;
  const el=document.createElement('span');el.className='mima-tap-ring';el.style.left=x+'px';el.style.top=y+'px';document.body.appendChild(el);
  el.addEventListener('animationend',()=>el.remove(),{once:true});setTimeout(()=>el.remove(),750);
 }
 function feedback(button,conf,kind,x,y,withSound=true){
  if(!conf.enabled)return;
  if(!button?.getBoundingClientRect)return;
  const r=button.getBoundingClientRect();x=Number.isFinite(x)&&x>0?x:r.left+r.width/2;y=Number.isFinite(y)&&y>0?y:r.top+r.height/2;
  bounce(button,conf);particles(conf,x,y);ripple(conf,x,y);if(withSound)sound(conf,kind);
 }
 function onClick(event){const button=closestButton(event);if(!button||!settings.enabled)return;
  // A burst only follows a real activation; do not play on pointerdown or synthetic startup events.
  if(!event.isTrusted)return;
  const now=performance.now();if(now-lastFeedback<55)return;lastFeedback=now;
  feedback(button,settings,kindFor(button),event.clientX,event.clientY);
 }
 function demo(raw,kind,button){const conf=normalize(raw);if(!button)return;feedback(button,conf,['normal','send','menu'].includes(kind)?kind:'normal');}
 document.addEventListener('click',onClick,true);
 apply(null); // default theme needs no stored project to feel interactive.
 window.MimaInteraction={apply,demo,get:()=>({...settings,sounds:{...settings.sounds}}),_normalize:normalize};
})();
