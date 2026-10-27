/* MimaTAVERN interactive surfaces R19: cosmetic only; never intercept user actions. */
(() => {
 'use strict';
 const FALLBACK={enabled:true,animation:'jelly',duration:340,particles:'sparkles',particleCount:5,transitions:true,soundEnabled:true,volume:24,sounds:{normal:'',send:'',menu:''}};
 const NOTES={normal:[587.33,783.99],send:[659.25,987.77],menu:[523.25,659.25]};
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

 const PREF_DEFAULTS=Object.freeze({motionEnabled:true,soundEnabled:true,particleEnabled:true,transitionsEnabled:true,animation:'theme',volume:100});
 const PREF_FIELDS=Object.keys(PREF_DEFAULTS);
 function normalizePreferences(raw){
  const p=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {motionEnabled:p.motionEnabled!==false,soundEnabled:p.soundEnabled!==false,
    particleEnabled:p.particleEnabled!==false,transitionsEnabled:p.transitionsEnabled!==false,
    animation:['theme','jelly','press','glow','ripple','none'].includes(p.animation)?p.animation:'theme',
    volume:Math.max(0,Math.min(100,Number.isFinite(Number(p.volume))?Math.round(Number(p.volume)):100))};
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
    transitions:base.transitions&&preferences.transitionsEnabled};
  const nextSig=JSON.stringify(next);if(nextSig===signature)return {...settings,sounds:{...settings.sounds}};
  if(settings.soundEnabled&&!next.soundEnabled){
   for(const playing of live){try{playing.pause();playing.currentTime=0;}catch(error){console.warn('[Interaction] stop audio failed',error);}}
   live.clear();
   try{ctx?.suspend?.()?.catch?.(()=>{});}catch(error){console.warn('[Interaction] mute audio context failed',error);}
  }
  const newSoundSignature=JSON.stringify(next.sounds);
  if(newSoundSignature!==soundSignature){disposeSounds();soundSignature=newSoundSignature;}
  signature=nextSig;settings=next;
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
 function sound(conf,kind){if(!conf.soundEnabled||!conf.volume)return;
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
  if(!button?.getBoundingClientRect)return;
  const r=button.getBoundingClientRect();x=Number.isFinite(x)&&x>0?x:r.left+r.width/2;y=Number.isFinite(y)&&y>0?y:r.top+r.height/2;
  bounce(button,conf);particles(conf,x,y);ripple(conf,x,y);if(withSound)sound(conf,kind);
 }
 function onClick(event){const button=closestButton(event);if(!button)return;
  // A burst only follows a real activation; do not play on pointerdown or synthetic startup events.
  if(!event.isTrusted)return;
  const now=performance.now();if(now-lastFeedback<55)return;lastFeedback=now;
  feedback(button,settings,kindFor(button),event.clientX,event.clientY);
 }
 function demoCurrent(kind,button){if(button)feedback(button,settings,KINDS.includes(kind)?kind:'normal');}
 function demo(raw,kind,button){const conf=normalize(raw);if(!button)return;feedback(button,{...conf,soundEnabled:conf.enabled&&conf.soundEnabled},['normal','send','menu'].includes(kind)?kind:'normal');}
 document.addEventListener('click',onClick,true);
 apply(null); // default theme needs no stored project to feel interactive.
 const ready=reloadSounds().catch(error=>{console.warn('[Interaction] personal audio assets unavailable; records preserved',error);throw error;});
 ready.catch(()=>{}); // Deliberately keep the failure accessible to Settings; no unhandled rejection.
 window.addEventListener('storage',event=>{if(event.key===PREF_KEY)reloadPreferences();});
 window.MimaInteraction={apply,demo,demoCurrent,setSound,clearSound,getSoundInfo,exportSounds,validateSounds,importSounds,previewSoundMerge,mergeSounds,reloadSounds,ready,get:()=>({...settings,sounds:{...settings.sounds}}),getPreferences:()=>({...preferences}),setPreference,reloadPreferences,_normalize:normalize,preferenceKey:PREF_KEY};
})();
