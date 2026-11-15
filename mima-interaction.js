/* MimaTAVERN interactive surfaces R19: cosmetic only; never intercept user actions. */
(() => {
 'use strict';
 const FALLBACK={enabled:true,animation:'jelly',duration:340,particles:'sparkles',particleCount:5,transitions:true,soundEnabled:true,volume:24,sounds:{normal:'',send:'',menu:''}};
 const NOTES={normal:[587.33,783.99],send:[659.25,987.77],menu:[523.25,659.25]};
 // Original tones remain bit-for-bit equivalent by default. Added timbres are
 // original tiny synthesized UI cues (not prerecorded music or sound packs).
 const BUILTIN_SOUND_STYLES=['classic','glass','soft','wood','bubble','chime','pixel'];
 const PREF_KEY='mima-r19-ui-feedback-prefs-v1';
 const AUDIO_DB='mima-personal-click-sounds-v1',AUDIO_STORE='sounds',KINDS=['normal','send','menu'];
 const MIME={mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac'};
 const MAX_AUDIO=4*1024*1024;
 const audioRecords={};let personalAudioRevision=0;
 function checkRecord(record){
  if(!record||!KINDS.includes(record.kind)||typeof record.data!=='string'||typeof record.name!=='string')throw Error('个人音效记录格式无效');
  const m=/^data:(audio\/(?:mpeg|wav|mp4|aac));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(record.data);
  if(!m||record.data.length>MAX_AUDIO*4/3+200||!record.data.endsWith('=' )&&record.data.length<25)throw Error('个人音效必须是受支持的音频文件（最大 4MB）');
  const bytes=Math.floor(m[2].length*3/4)-(m[2].endsWith('==')?2:m[2].endsWith('=')?1:0);
  if(bytes<=0||bytes>MAX_AUDIO||String(record.name).length>160)throw Error('个人音效大小或文件名无效');
  return {kind:record.kind,name:record.name.replace(/[<>\u0000-\u001f]/g,'').slice(0,120),data:record.data,bytes};
 }
 function openAudioDb(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(AUDIO_DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(AUDIO_STORE))request.result.createObjectStore(AUDIO_STORE,{keyPath:'kind'});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error('音效数据库打开失败'));
  request.onblocked=()=>reject(Error('音效数据库被其他标签页占用，请关闭旧页面后重试'));
 });}
 async function getAllAudio(){const db=await openAudioDb();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(AUDIO_STORE,'readonly'),req=tx.objectStore(AUDIO_STORE).getAll();let rows,issue;
  req.onsuccess=()=>{rows=req.result};req.onerror=()=>{issue=req.error;tx.abort()};tx.oncomplete=()=>resolve(rows);tx.onabort=()=>reject(issue||tx.error||Error('音效读取中断'));
 });}finally{db.close();}}
 async function saveAudioRecords(records,replace=false){
  const validated=records.map(checkRecord);
  if(new Set(validated.map(x=>x.kind)).size!==validated.length)throw Error('备份包含重复的音效分类');
  const db=await openAudioDb();try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(AUDIO_STORE,'readwrite'),os=tx.objectStore(AUDIO_STORE);
   if(replace)os.clear();
   for(const record of validated)os.put(record);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('音效写入失败'));tx.onabort=()=>reject(tx.error||Error('音效写入中断'));
  });}finally{db.close();}
  if(replace)for(const k of KINDS)delete audioRecords[k];
  for(const record of validated)audioRecords[record.kind]=record;
  personalAudioRevision++;refreshEffective();return true;
 }
 async function setSound(kind,file){
  if(!KINDS.includes(kind))throw Error('未知音效分类');
  const ext=String(file?.name||'').split('.').pop().toLowerCase(),mime=MIME[ext];
  if(!mime||!file?.size||file.size>MAX_AUDIO)throw Error('请选择不超过 4 MB 的 MP3/WAV/M4A/AAC 音频');
  if(!new Audio().canPlayType(mime))throw Error('浏览器不支持该音频格式，请改用 MP3 或 WAV');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error||Error('音频读取失败'));reader.readAsDataURL(file);});
  const parsed=/^data:[^;,]+;base64,([\s\S]+)$/i.exec(data);
  if(!parsed)throw Error('音频文件无法读取');
  return saveAudioRecords([{kind,name:file.name.slice(0,120),data:`data:${mime};base64,${parsed[1]}`}]);
 }
 async function clearSound(kind){
  if(!KINDS.includes(kind))throw Error('未知音效分类');
  const db=await openAudioDb();try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(AUDIO_STORE,'readwrite');tx.objectStore(AUDIO_STORE).delete(kind);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('音效删除失败'));tx.onabort=()=>reject(tx.error||Error('音效删除中断'));
  });}finally{db.close();}
  delete audioRecords[kind];personalAudioRevision++;refreshEffective();return true;
 }
 function getSoundInfo(){return Object.fromEntries(KINDS.map(k=>[k,audioRecords[k]?{name:audioRecords[k].name,bytes:audioRecords[k].bytes,custom:true}:{name:'',bytes:0,custom:false}]));}
 async function exportSounds(){return (await getAllAudio()).map(checkRecord);}
 function validateSounds(raw){if(!Array.isArray(raw)||raw.length>KINDS.length)throw Error('个人音效备份结构无效');const records=raw.map(checkRecord);if(new Set(records.map(x=>x.kind)).size!==records.length)throw Error('个人音效备份分类重复');return records;}
 async function importSounds(raw){return saveAudioRecords(validateSounds(raw),true);}
 // Whole-tavern restore is add-only. Recheck under the write lock; the
 // original importSounds() replacement behavior stays available to old backups.
 function soundMergePlan(current,incoming){
  const before=validateSounds(current),next=validateSounds(incoming),known=new Map(before.map(x=>[x.kind,x])),added=[];
  for(const row of next){const old=known.get(row.kind);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('个人音效分类已有不同原件，拒绝覆盖：'+row.kind);if(!old)added.push(row);}
  return added;
 }
 async function previewSoundMerge(raw){const added=soundMergePlan(await getAllAudio(),raw);return {toAdd:added.map(x=>x.kind)};}
 async function mergeSounds(raw){
  const incoming=validateSounds(raw),db=await openAudioDb();let result;
  try{result=await new Promise((resolve,reject)=>{const tx=db.transaction(AUDIO_STORE,'readwrite'),os=tx.objectStore(AUDIO_STORE),q=os.getAll();let issue,added=[];
   q.onsuccess=()=>{try{added=soundMergePlan(q.result,incoming);for(const row of added)os.add(row)}catch(e){issue=e;tx.abort()}};
   q.onerror=()=>{issue=q.error;tx.abort()};tx.oncomplete=()=>resolve({added:added.map(x=>x.kind)});tx.onabort=()=>reject(issue||tx.error||Error('个人音效安全合并已中止'));
  });}finally{db.close();}
  try{await reloadSounds()}catch(e){result.warnings=['音效原件已提交，播放缓存重载失败：'+e.message]};return result;
 }
 async function reloadSounds(){const revision=personalAudioRevision,records=(await getAllAudio()).map(checkRecord);if(revision!==personalAudioRevision)return getSoundInfo();
  for(const kind of KINDS)delete audioRecords[kind];for(const record of records)audioRecords[record.kind]=record;
  personalAudioRevision++;refreshEffective();return getSoundInfo();}

 const PREF_DEFAULTS=Object.freeze({motionEnabled:true,soundEnabled:true,particleEnabled:true,transitionsEnabled:true,screenTouchEnabled:true,animation:'theme',volume:100,soundStyle:'classic'});
 const PREF_FIELDS=Object.keys(PREF_DEFAULTS);
 function normalizePreferences(raw){
  const p=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {motionEnabled:p.motionEnabled!==false,soundEnabled:p.soundEnabled!==false,
    particleEnabled:p.particleEnabled!==false,transitionsEnabled:p.transitionsEnabled!==false,screenTouchEnabled:p.screenTouchEnabled!==false,
    animation:['theme','jelly','press','glow','ripple','float','orbit','twinkle','heartbeat','none'].includes(p.animation)?p.animation:'theme',
    volume:Math.max(0,Math.min(100,Number.isFinite(Number(p.volume))?Math.round(Number(p.volume)):100)),
    soundStyle:BUILTIN_SOUND_STYLES.includes(p.soundStyle)?p.soundStyle:'classic'};
 }
 function readPreferences(){try{return normalizePreferences(JSON.parse(localStorage.getItem(PREF_KEY)||'null'));}
  catch(error){console.warn('[Interaction] personal preference read failed; previous data left unchanged',error);return normalizePreferences();}}
 let preferences=readPreferences(),themeSettings=null;
 let settings={...FALLBACK,sounds:{...FALLBACK.sounds}},signature='',soundSignature='',ctx=null,sourceUrls=new Map();
 const live=new Set();let lastFeedback=0;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):a));
 function normalize(v){const c=window.MimaAtelierCore;return c?.normalizeInteractions?c.normalizeInteractions(v):{...FALLBACK,sounds:{...FALLBACK.sounds}};}
 function disposeSounds(){for(const url of sourceUrls.values())URL.revokeObjectURL(url);sourceUrls.clear();}
 function refreshEffective(){
  const base=themeSettings||normalize();
  // Personal accessibility switches are an overlay, never a theme/CSS publication.
  // Theme's original enabled=false still disables its own sounds and effects.
  const next={...base,sounds:{...base.sounds,...Object.fromEntries(Object.entries(audioRecords).map(([k,v])=>[k,v.data]))},
    enabled:base.enabled&&preferences.motionEnabled,
    soundEnabled:base.enabled&&base.soundEnabled&&preferences.soundEnabled,
    volume:Math.round(base.volume*preferences.volume/100),
    animation:preferences.animation==='theme'?base.animation:preferences.animation,
    particles:preferences.particleEnabled?base.particles:'none',
    transitions:base.transitions&&preferences.transitionsEnabled,screenTouchEnabled:preferences.screenTouchEnabled};
  const nextSig=JSON.stringify(next);if(nextSig===signature)return {...settings,sounds:{...settings.sounds}};
  if(settings.soundEnabled&&!next.soundEnabled){
   for(const playing of live){try{playing.pause();playing.currentTime=0;}catch(error){console.warn('[Interaction] stop audio failed',error);}}
   live.clear();
   try{ctx?.suspend?.()?.catch?.(()=>{});}catch(error){console.warn('[Interaction] mute audio context failed',error);}
  }
  const newSoundSignature=JSON.stringify(next.sounds);
  if(newSoundSignature!==soundSignature){disposeSounds();soundSignature=newSoundSignature;}
  signature=nextSig;settings=next;
  if(!next.enabled||next.animation==='none'||!next.screenTouchEnabled)cancelPointers();
  if(!next.enabled||next.animation==='none'){
   for(const animation of activeButtonMotions)animation.cancel();
   activeButtonMotions.clear();
   for(const node of transientScenes)node.remove();transientScenes.clear();
   for(const node of transientParticleFields)node.remove();transientParticleFields.clear();
  }
  document.documentElement.dataset.mimaFeedback=next.enabled?'on':'off';
  document.documentElement.dataset.mimaMenuMotion=next.enabled&&next.transitions?'on':'off';
  return {...next,sounds:{...next.sounds}};
 }
 function apply(raw){
  try{themeSettings=normalize(raw)}catch(error){console.error('[Interaction] invalid published theme; built-in feedback retained',error);themeSettings=normalize();}
  return refreshEffective();
 }
 function setPreference(key,value){
  if(!PREF_FIELDS.includes(key))throw Error('未知的外观交互选项');
  const next=normalizePreferences({...preferences,[key]:value});
  // Commit to storage before claiming success in the running UI.
  localStorage.setItem(PREF_KEY,JSON.stringify(next));
  preferences=next;
  refreshEffective();
  return {...preferences};
 }
 function reloadPreferences(){preferences=readPreferences();refreshEffective();return {...preferences};}
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
 function synth(kind,volume,style='classic'){
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  try{
   if(!ctx)ctx=new AC();
   // Must originate from the user's click/tap for iOS AudioContext unlock.
   if(ctx.state==='suspended')ctx.resume().catch(()=>{});
   const now=ctx.currentTime,base=NOTES[kind]||NOTES.normal;
   // Each voice gets its own gain envelope; no continuous processing or samples.
   const plans={
    classic:{type:'sine',notes:base.map((f,i)=>[f,i*.055,.115,.095]),rise:.016},
    glass:{type:'sine',notes:[[base[0]*1.5,0,.26,.065],[base[1]*2,.035,.34,.048]],rise:.008},
    soft:{type:'sine',notes:[[base[0]*.75,0,.17,.050],[base[0],.05,.22,.040]],rise:.022},
    wood:{type:'triangle',notes:[[base[0]*.64,0,.075,.105],[base[0]*.97,.07,.10,.055]],rise:.004},
    bubble:{type:'sine',notes:[[base[0]*.8,0,.13,.070],[base[0]*1.28,.075,.15,.066],[base[1]*1.35,.16,.12,.042]],rise:.007},
    chime:{type:'sine',notes:[[base[0],0,.30,.046],[base[1]*1.25,.035,.38,.052],[base[0]*2,.075,.32,.022]],rise:.012},
    pixel:{type:'square',notes:[[base[0]*.7,0,.058,.028],[base[1]*.9,.07,.058,.025],[base[1]*1.12,.14,.075,.024]],rise:.003}
   };
   const plan=plans[style]||plans.classic;
   for(const [freq,delay,length,level] of plan.notes){
    const osc=ctx.createOscillator(),gain=ctx.createGain(),t=now+delay;
    osc.type=plan.type;osc.frequency.setValueAtTime(freq,t);
    gain.gain.setValueAtTime(0,t);
    gain.gain.linearRampToValueAtTime(volume*level,t+plan.rise);
    gain.gain.exponentialRampToValueAtTime(.0001,t+length);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
    osc.start(t);osc.stop(t+length+.015);
   }
  }catch(error){console.warn('[Interaction] built-in sound unavailable',error);}
 }
 function previewBuiltInSound(style,kind='normal'){
  if(!settings.soundEnabled||!settings.volume)return false;
  if(!BUILTIN_SOUND_STYLES.includes(style))return false;
  synth(KINDS.includes(kind)?kind:'normal',clamp(settings.volume,0,100)/100,style);
  return true;
 }
 function sound(conf,kind){if(!conf.soundEnabled||!conf.volume)return;
  const volume=clamp(conf.volume,0,100)/100;
  const asset=conf.sounds?.[kind];
  if(asset){try{playFile(asset,volume)}catch(error){console.warn('[Interaction] imported audio is unreadable',error);}return;}
  synth(kind,volume,preferences.soundStyle);
 }
 // Keep button feedback on independent scale/opacity compositor properties.
 // Animating filter on the glassy theme buttons causes avoidable re-rasterization.
 const buttonMotion=new WeakMap(),activeButtonMotions=new Set();
 const transientScenes=new Set(),transientParticleFields=new Set();
 function trackTransient(node,group){
  if(group.size>=12){const oldest=group.values().next().value;group.delete(oldest);oldest.remove();}
  group.add(node);
  return ()=>{group.delete(node);node.remove();};
 }
 const individualScale=!!window.CSS?.supports?.('scale','1');
 const TACTILE={
  // Two-axis spring is part of the original jelly feedback. Preserve it
  // without animating filters or forcing main-thread layout.
  jelly:[['1 1',0],['1.085 .88',.18],['.955 1.075',.42],['1.035 .97',.72],['1 1',1]],
  press:[['.955',0],['1.018',.44],['.994',.75],['1',1]],
  glow:[['.975',0],['1.022',.4],['1',1]],
  ripple:[['.97',0],['1.014',.38],['1',1]],
  float:[['1',0],['1.035',.28],['.992',.67],['1',1]],
  orbit:[['.96',0],['1.032',.32],['.987',.73],['1',1]],
  twinkle:[['.985',0],['1.055',.23],['.98',.55],['1',1]],
  heartbeat:[['1',0],['1.065',.20],['.975',.39],['1.042',.63],['1',1]]
 };
 function animateScale(button,steps,options){
  if(!button?.animate)return null;
  const property=individualScale?'scale':'transform';
  const frames=steps.map(([scale,offset])=>({[property]:individualScale?scale:`scale(${scale.replace(/\s+/g,',')})`,offset}));
  try{
   const previous=buttonMotion.get(button);
   if(previous)previous.cancel();
   const animation=button.animate(frames,options);
   buttonMotion.set(button,animation);activeButtonMotions.add(animation);
   const release=()=>{activeButtonMotions.delete(animation);if(buttonMotion.get(button)===animation)buttonMotion.delete(button);};
   animation.addEventListener('finish',release,{once:true});
   animation.addEventListener('cancel',release,{once:true});
   return animation;
  }catch(error){console.warn('[Interaction] button feedback unsupported',error);return null;}
 }
 function bounce(button,conf){
  if(reduced()||!conf.enabled||conf.animation==='none')return;
  const duration=clamp(conf.duration,200,850);
  animateScale(button,TACTILE[conf.animation]||TACTILE.press,{
   duration,easing:'cubic-bezier(.2,.75,.24,1)',fill:'none'
  });
 }
 const symbols={sparkles:['✦','✧','⋆'],hearts:['♡','♥'],petals:['✿','❀','✾'],paw:['','✧']};
 // A single fixed particle field per click: one DOM insertion and one expiry,
 // instead of N individually appended paint surfaces and N expiry timers.
 // The original full-radius clamp could move a glow over 70 screen pixels
 // away from a tapped edge button. Keep the visual center close to the touch,
 // and compress only the temporary decoration when its full reach will not fit.
 // CSS zoom changes the *painted* reach; all comparisons below are in viewport
 // coordinates, then fixed-position coordinates are converted back for placement.
 const SCENE_REACH={jelly:64,press:60,glow:98,ripple:66,float:58,orbit:87,
   twinkle:74,heartbeat:76,screen:48,hold:57};
 // CSS border-box dimensions; keeps a scaled scene's *painted* center on the
 // intended point. Particle fields have zero dimensions and need no correction.
 const SCENE_BOX={jelly:[56,56],press:[58,34],glow:[68,68],ripple:[56,56],
   float:[52,62],orbit:[72,72],twinkle:[70,70],heartbeat:[70,70],screen:[46,46],hold:[66,66]};
 function positionTransient(node,x,y,reachX=0,reachY=0,boxW=0,boxH=0){
  const zoom=parseFloat(getComputedStyle(document.documentElement).zoom)||1;
  const viewport=window.visualViewport;
  const w=viewport?.width||window.innerWidth,h=viewport?.height||window.innerHeight;
  const ox=viewport?.offsetLeft||0,oy=viewport?.offsetTop||0;
  const rx=Math.max(0,reachX)*zoom,ry=Math.max(0,reachY)*zoom;
  const pad=2,maxShift=32*zoom;
  const clampTo=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const tx=clampTo(x,ox+pad,ox+w-pad),ty=clampTo(y,oy+pad,oy+h-pad);
  // On current Safari the independent CSS scale property composes with the
  // original transform keyframes, preserving each animation's distinctive shape.
  // Older browsers retain the full-radius edge-safe positioning instead.
  if(individualScale){
   let cx=tx,cy=ty;
   if(tx<ox+rx+pad)cx+=Math.min(maxShift,ox+rx+pad-tx);
   else if(tx>ox+w-rx-pad)cx-=Math.min(maxShift,tx-(ox+w-rx-pad));
   if(ty<oy+ry+pad)cy+=Math.min(maxShift,oy+ry+pad-ty);
   else if(ty>oy+h-ry-pad)cy-=Math.min(maxShift,ty-(oy+h-ry-pad));
   cx=clampTo(cx,ox+pad,ox+w-pad);
   cy=clampTo(cy,oy+pad,oy+h-pad);
   const factor=Math.min(1,rx>0?(cx-ox-pad)/rx:1,rx>0?(ox+w-cx-pad)/rx:1,
     ry>0?(cy-oy-pad)/ry:1,ry>0?(oy+h-cy-pad)/ry:1);
   if(factor<.999)node.style.scale=Math.max(0,factor).toFixed(3);
   // A centered CSS scale composes *before* the scene's translate(-50%, -50%)
   // transform. Compensate its (1-scale)*half-box drift without changing
   // transform-origin, which must remain centered for rotations and jelly.
   node.style.left=(cx/zoom-boxW*(1-factor)/2)+'px';
   node.style.top=(cy/zoom-boxH*(1-factor)/2)+'px';
   return;
  }
  const mx=Math.min(Math.max(0,w/2-1),rx+pad),my=Math.min(Math.max(0,h/2-1),ry+pad);
  node.style.left=clampTo(tx,ox+mx,ox+w-mx)/zoom+'px';
  node.style.top=clampTo(ty,oy+my,oy+h-my)/zoom+'px';
 }
 function particles(conf,x,y){
  if(!conf.enabled||reduced()||conf.particles==='none'||conf.particleCount===0)return;
  const choices=symbols[conf.particles]||symbols.sparkles;
  const total=clamp(conf.particleCount,0,12),duration=clamp(conf.duration+200,350,1100);
  if(!total)return;
  const field=document.createElement('span');field.className='mima-tap-particle-field';
  positionTransient(field,x,y,65,65);field.style.setProperty('--tap-life',duration+'ms');
  const fragment=document.createDocumentFragment();
  for(let i=0;i<total;i++){
   const node=document.createElement('span');node.className='mima-tap-particle';node.textContent=choices[i%choices.length];if(conf.particles==='paw'&&i%2===0)node.classList.add('mima-particle-paw');
   const a=Math.PI*2*((i+.1)/total),distance=26+(i%3)*10;
   node.style.setProperty('--dx',Math.round(Math.cos(a)*distance)+'px');
   node.style.setProperty('--dy',Math.round(Math.sin(a)*distance-12)+'px');
   node.style.setProperty('--turn',((i%2)?-1:1)*(16+i%3*12)+'deg');
   node.style.setProperty('--delay',Math.min(i%4*17,51)+'ms');
   fragment.appendChild(node);
  }
  field.appendChild(fragment);
  // Cap concurrent transient surfaces without changing the requested particle count.
  const dispose=trackTransient(field,transientParticleFields);
  document.body.appendChild(field);
  setTimeout(dispose,duration+160);
 }
 function scene(conf,kind,x,y,{screen=false}={}){
  if(!conf.enabled||reduced()||conf.animation==='none'||!Number.isFinite(x)||!Number.isFinite(y))return null;
  const style=screen?'screen':kind;
  if(!['jelly','press','glow','ripple','float','orbit','twinkle','heartbeat','screen','hold'].includes(style))return null;
  const node=document.createElement('span');
  node.className=`mima-tap-scene mima-tap-scene--${style}`;
  if(['float','orbit','twinkle','heartbeat','glow'].includes(style)){
   const ornament=document.createElement('span'),accent=document.createElement('span');
   ornament.className='mima-scene-glyph';accent.className='mima-scene-gleam';
   node.append(ornament,accent);
  }
  const [boxW,boxH]=SCENE_BOX[style]||[62,62];
  positionTransient(node,x,y,SCENE_REACH[style]||65,style==='float'?108:SCENE_REACH[style]||65,boxW,boxH);
  const dispose=trackTransient(node,transientScenes);
  document.body.appendChild(node);
  const life=style==='hold'?1800:style==='screen'?460:style==='orbit'?900:style==='float'?900:style==='heartbeat'?900:style==='glow'?860:style==='ripple'?750:style==='twinkle'?790:640;
  if(style!=='hold'){
   node.addEventListener('animationend',e=>{if(e.target===node)dispose()},{once:true});
   setTimeout(dispose,life+170);
  }else node.addEventListener('animationend',e=>{if(e.target===node&&node.classList.contains('is-releasing'))dispose();});
  return node;
 }
 function feedback(button,conf,kind,x,y,withSound=true){
  if(!button?.getBoundingClientRect)return;
  const r=button.getBoundingClientRect();
  const demo=button.classList?.contains('mima-motion-demo');
  x=demo||!Number.isFinite(x)||x<=0?r.left+r.width/2:x;
  y=demo||!Number.isFinite(y)||y<=0?r.top+r.height/2:y;
  bounce(button,conf);
  scene(conf,conf.animation,x,y);
  particles(conf,x,y);if(withSound)sound(conf,kind);
 }
  // Checking selected text by toString() in selectionchange costs O(selected text)
  // on every drag update. iOS can dispatch many such updates for long stories.
  function hasDocumentSelection(){
    const selection=window.getSelection?.();
    return !!selection&&selection.rangeCount>0&&!selection.isCollapsed;
  }
  function selectableStoryText(target){
    return !!target?.closest?.('#story-chat-box .msg-content');
  }
 const activePointers=new Map();
 const feedbackByButton=new WeakMap();
 function ambientTargetAllowed(event){
  const target=event.target;
  if(!(target instanceof Element))return false;
  if(target.closest('button,[role="button"],summary,a,input,textarea,select,label,[contenteditable],iframe,[data-mima-no-interaction],.mima-no-interaction,.safe-html-content,[role="textbox"],.mima-tap-scene,.mima-tap-particle-field,.mima-tap-particle'))return false;
  // Never animate over text the user is attempting to select or copy.
  if(hasDocumentSelection())return false;
  return true;
 }
 function stopPointer(pointer,{cancel=false}={}){
  if(!pointer)return;
  if(pointer.holdTimer!==null)clearTimeout(pointer.holdTimer);
  if(pointer.pressed){try{pointer.pressed.cancel()}catch{}}
  if(pointer.halo){
   pointer.halo.classList.add('is-releasing');
   const halo=pointer.halo;
   setTimeout(()=>{transientScenes.delete(halo);halo.remove();},300);
  }
  activePointers.delete(pointer.id);
  if(cancel)pointer.moved=true;
 }
 function onPointerDown(event){
  if(event.isTrusted!==true||event.isPrimary===false||event.button!==0||!settings.enabled||reduced())return;
  if(activePointers.has(event.pointerId))stopPointer(activePointers.get(event.pointerId),{cancel:true});
  const button=closestButton(event);
  if(!button&&(!preferences.screenTouchEnabled||!ambientTargetAllowed(event)))return;
  const pointer={id:event.pointerId,x:event.clientX,y:event.clientY,button,
    moved:false,holdTimer:null,halo:null,pressed:null,
    selectableText:!button&&selectableStoryText(event.target),startedAt:performance.now()};
  activePointers.set(event.pointerId,pointer);
  if(button&&settings.animation!=='none'){
   pointer.pressed=animateScale(button,[['1',0],['.965',1]],
     {duration:105,easing:'cubic-bezier(.18,.78,.22,1)',fill:'forwards'});
  }
  if(preferences.screenTouchEnabled){
    pointer.holdTimer=setTimeout(()=>{
      if(pointer.moved||pointer.selectableText||activePointers.get(pointer.id)!==pointer||hasDocumentSelection())return;
      pointer.halo=scene(settings,'hold',pointer.x,pointer.y);
    },460);
  }
 }
 function onPointerMove(event){
  const pointer=activePointers.get(event.pointerId);if(!pointer)return;
  if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12){
    stopPointer(pointer,{cancel:true});
  }
 }
 function onPointerUp(event){
  const pointer=activePointers.get(event.pointerId);if(!pointer)return;
  if(!pointer.button&&!pointer.moved&&settings.enabled&&preferences.screenTouchEnabled&&!reduced()&&!pointer.halo&&
      !(pointer.selectableText&&(hasDocumentSelection()||performance.now()-pointer.startedAt>400))){
    scene(settings,'screen',event.clientX,event.clientY,{screen:true});
  }
  if(pointer.halo&&!pointer.moved&&settings.particles!=='none'){
    const tiny={...settings,particleCount:Math.min(3,settings.particleCount)};
    particles(tiny,event.clientX,event.clientY);
  }
  stopPointer(pointer);
 }
 function cancelPointers(){for(const pointer of [...activePointers.values()])stopPointer(pointer,{cancel:true});}
 // iOS may freeze/suspend a page before firing pointerup/pointercancel. A
 // fill-forwards press must not stay stuck after a copy/app switch. Expire only
 // temporary visual effects; persisted sound/motion preferences are untouched.
 function releaseTransientFeedback(){
  cancelPointers();
  for(const animation of [...activeButtonMotions])animation.cancel();
  activeButtonMotions.clear();
  for(const node of transientScenes)node.remove();
  transientScenes.clear();
  for(const node of transientParticleFields)node.remove();
  transientParticleFields.clear();
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseTransientFeedback();},{passive:true});
 window.addEventListener('pagehide',releaseTransientFeedback,{passive:true});
 function onClick(event){
  const button=closestButton(event);if(!button||!event.isTrusted)return;
  // Debounce the *same* control only; fast taps on different controls must all
  // give feedback. Pointer events only show the press stage, not a second click.
  const now=performance.now(),prior=feedbackByButton.get(button)||-Infinity;
  if(now-prior<65)return;
  feedbackByButton.set(button,now);
  feedback(button,settings,kindFor(button),event.clientX,event.clientY);
 }
 function demoCurrent(kind,button){if(button)feedback(button,settings,KINDS.includes(kind)?kind:'normal');}
 function demo(raw,kind,button){const conf=normalize(raw);if(!button)return;
  feedback(button,{...conf,soundEnabled:conf.enabled&&conf.soundEnabled},KINDS.includes(kind)?kind:'normal');}
 document.addEventListener('pointerdown',onPointerDown,{capture:true,passive:true});
 document.addEventListener('pointermove',onPointerMove,{capture:true,passive:true});
 document.addEventListener('pointerup',onPointerUp,{capture:true,passive:true});
 document.addEventListener('pointercancel',event=>stopPointer(activePointers.get(event.pointerId),{cancel:true}),{capture:true,passive:true});
 document.addEventListener('contextmenu',cancelPointers,true);
 document.addEventListener('selectionchange',()=>{if(activePointers.size&&hasDocumentSelection())cancelPointers()});
 document.addEventListener('scroll',cancelPointers,{capture:true,passive:true});
 document.addEventListener('focusin',event=>{
  if(event.target?.matches?.('input,textarea,[contenteditable],[role="textbox"]'))cancelPointers();
 },true);
 document.addEventListener('click',onClick,true);
 apply(null); // default theme needs no stored project to feel interactive.
 const ready=reloadSounds().catch(error=>{console.warn('[Interaction] personal audio assets unavailable; records preserved',error);throw error;});
 ready.catch(()=>{}); // Deliberately keep the failure accessible to Settings; no unhandled rejection.
 window.addEventListener('storage',event=>{if(event.key===PREF_KEY)reloadPreferences();});
 window.MimaInteraction={apply,demo,demoCurrent,setSound,clearSound,getSoundInfo,exportSounds,validateSounds,importSounds,previewSoundMerge,mergeSounds,reloadSounds,ready,get:()=>({...settings,sounds:{...settings.sounds}}),getPreferences:()=>({...preferences}),setPreference,reloadPreferences,previewBuiltInSound,getBuiltInSoundStyles:()=>[...BUILTIN_SOUND_STYLES],_normalize:normalize,preferenceKey:PREF_KEY};
})();
