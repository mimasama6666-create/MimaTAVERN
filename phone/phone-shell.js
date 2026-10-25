/* Phone OS. Every UI action invokes a real phone-domain command. */
(()=>{'use strict';
 const D=()=>MimaPhoneDomain,R=()=>MimaPhoneResources,S=()=>MimaPhoneStore;
 const state={intentKeys:new Map(),open:false,screen:'messages',threadId:null,memoryActorId:null,momentId:null,loading:false,activeThreadRounds:new Set(),postingThreads:new Set(),pendingWalletActions:new Set(),recording:null,urls:[],notice:'',replyToId:null,chatSearch:'',noticeTimer:null,profileBack:'contacts',contactId:null,maskCache:new Map(),typingActor:null,typingThreadId:null,typingByThread:new Map(),previousScrollY:0,animatedMessageIds:new Set(),draftWrites:new Map(),localDrafts:new Map(),scrollRestore:null,visibleMessageCounts:new Map(),olderScrollRestore:null,activeChoice:null,activeGenerationControllers:new Map()};
 const root=()=>document.getElementById('mima-phone-root');
 let renderVersion=0;
 const dom=(name,cls='',text='')=>{const node=document.createElement(name);if(cls)node.className=cls;if(text!==undefined&&text!=='')node.textContent=String(text);return node;};
 const button=(label,handler,cls='')=>{const b=dom('button','phone-btn '+cls,label);b.type='button';b.onclick=()=>safe(handler);return b;};
 const input=(placeholder,value='',tag='input')=>{const x=dom(tag,'phone-input');x.placeholder=placeholder;if(tag==='input')x.type='text';x.value=value;return x;};
 const line=(p,...nodes)=>{const r=dom('div','phone-line');nodes.forEach(n=>r.append(n));p.append(r);return r;};
 const box=(p,title)=>{const c=dom('section','phone-card');if(title)c.append(dom('h3','',title));p.append(c);return c;};
 function clearURLs(){for(const url of state.urls)URL.revokeObjectURL(url);state.urls=[];}
 function photoURL(asset){const u=URL.createObjectURL(asset.blob);state.urls.push(u);return u;}
 function say(message){
   state.notice=String(message);if(state.noticeTimer)clearTimeout(state.noticeTimer);
   const area=document.getElementById('phone-status');if(area){area.textContent=state.notice;area.classList.add('visible');}
   if(!state.notice.startsWith('正在生成'))state.noticeTimer=setTimeout(()=>{
     state.notice='';state.noticeTimer=null;const current=document.getElementById('phone-status');
     if(current){current.classList.remove('visible');current.textContent='';}
   },state.notice.includes('失败')||state.notice.includes('错误')?7500:4000);
 }
 async function safe(fn){try{const result=await fn();return result;}catch(e){console.error('[Mima Phone] 未完成操作（canonical 状态未伪装成功）',e);say(e?.message||String(e));}}
 // Serialize autosaves by thread. An older keystroke must never overwrite the
 // explicit empty draft written after a successfully committed send.
 function persistDraft(threadId,value){
   const text=String(value);state.localDrafts.set(threadId,text);
   const prior=state.draftWrites.get(threadId)||Promise.resolve();
   const pending=prior.catch(()=>{}).then(()=>D().saveDraft(threadId,text));
   state.draftWrites.set(threadId,pending);
   void pending.then(()=>{if(state.draftWrites.get(threadId)===pending)state.draftWrites.delete(threadId);},()=>{
     if(state.draftWrites.get(threadId)===pending)state.draftWrites.delete(threadId);
   });
   return pending;
 }
 function cancelChoice(){if(state.activeChoice)state.activeChoice([]);}
 async function hideGeneration(genId,hidden){await S().write('drafts',{id:'phone_hidden_generation:'+genId,hidden,updatedAt:new Date().toISOString()});}
 async function hiddenGeneration(genId){return !!(await S().read('drafts','phone_hidden_generation:'+genId))?.hidden;}

 function syncViewport(){
   if(!state.open)return;
   const r=root(),vv=window.visualViewport;
   if(vv&&vv.height>0){
     // On iOS Safari the keyboard shrinks/moves the *visual* viewport, not the layout viewport.
     // A fixed page anchored only by vv.height jumps above the visible screen on focus.
     r.style.setProperty('--phone-vv-top',Math.max(0,vv.offsetTop||0)+'px');
     r.style.setProperty('--phone-vv-left',Math.max(0,vv.offsetLeft||0)+'px');
     r.style.setProperty('--phone-vv-width',Math.floor(vv.width)+'px');
     r.style.setProperty('--phone-visible-height',Math.floor(vv.height)+'px');
     const keyboard=vv.height<window.innerHeight-110;
     r.classList.toggle('phone-keyboard-open',keyboard);
   }else{
     r.style.setProperty('--phone-vv-top','0px');r.style.setProperty('--phone-vv-left','0px');
     r.style.setProperty('--phone-visible-height',window.innerHeight+'px');
   }
 }
 function viewportFocus(){requestAnimationFrame(syncViewport);}
 async function open(){if(state.open)return;await S().open();R().state();state.open=true;
   // Keep the full-screen viewport host outside the fixed body. On iOS, focusing a
   // textarea moves visualViewport and sometimes the layout scroll position;
   // a fixed overlay nested in the frozen body follows both and jumps upward.
   const host=root();if(host.parentNode!==document.documentElement)document.documentElement.appendChild(host);
   state.previousScrollY=window.scrollY;document.body.style.setProperty('--mima-phone-lock-top',(-state.previousScrollY)+'px');
   host.hidden=false;document.body.classList.add('mima-phone-active');
   syncViewport();window.visualViewport?.addEventListener('resize',syncViewport);
   window.visualViewport?.addEventListener('scroll',syncViewport);
   window.addEventListener('resize',syncViewport);
   root().addEventListener('focusin',viewportFocus);root().addEventListener('focusout',viewportFocus);
   await render();}
 function close(){if(state.recording){say('录音进行中，请先停止录音');return;}renderVersion++;
   cancelChoice();if(state.noticeTimer){clearTimeout(state.noticeTimer);state.noticeTimer=null;}state.notice='';state.open=false;
   window.visualViewport?.removeEventListener('resize',syncViewport);
   window.visualViewport?.removeEventListener('scroll',syncViewport);
   window.removeEventListener('resize',syncViewport);
   root().removeEventListener('focusin',viewportFocus);root().removeEventListener('focusout',viewportFocus);
   for(const key of ['--phone-visible-height','--phone-vv-top','--phone-vv-left','--phone-vv-width'])root().style.removeProperty(key);
   root().classList.remove('phone-keyboard-open');clearURLs();root().hidden=true;
   document.body.classList.remove('mima-phone-active');document.body.style.removeProperty('--mima-phone-lock-top');
   window.scrollTo(0,state.previousScrollY);
 }
 function navigate(screen,detail=null){
   cancelChoice();
   if(screen==='chat'&&state.threadId!==detail){state.replyToId=null;state.chatSearch='';}
   if(screen==='profile'){if(state.screen!=='memory')state.profileBack=state.screen;state.contactId=detail;}
   state.screen=screen;if(screen==='chat')state.threadId=detail;
   if(screen==='moment')state.momentId=detail;return render();
 }
 const clock=x=>{try{return new Date(x).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}catch(_){return '';}};
 const stamp=x=>{try{const d=new Date(x),today=new Date();return d.toDateString()===today.toDateString()?clock(x):d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});}catch(_){return '';}};
 function face(actorId,contact=null,large=false){
   const node=dom('span','phone-avatar'+(large?' phone-avatar-lg':''));
   if(actorId==='group'){node.textContent='👥';return node;}
   const mask=state.maskCache.get(actorId)||null;
   const url=contact?.avatarRef||mask?.avatar||'';
   if(contact?.avatarAssetId){MimaPhoneMedia.load(contact.avatarAssetId).then(asset=>{
       if(!node.isConnected||!asset?.mime?.startsWith('image/'))return;
       const pic=dom('img');pic.alt='头像';pic.src=photoURL(asset);node.replaceChildren(pic);
     }).catch(err=>console.warn('本地头像读取失败，显示原始头像',err));}
   if(url){const pic=dom('img');pic.alt='';pic.loading='lazy';pic.referrerPolicy='no-referrer';pic.src=url;
     pic.onerror=()=>{pic.remove();node.textContent=(contact?.displayNick||mask?.name||'?').slice(0,1);};node.append(pic);
   }else node.textContent=(contact?.displayNick||mask?.name||'?').slice(0,1);
   return node;
 }
 function contactName(id,contacts){return id===D().owner?'我':contacts.find(x=>x.id===id)?.displayNick||id;}
 function menu(summary='•••'){const details=dom('details','phone-overflow');details.append(dom('summary','',summary));return details;}
 function decorateMenus(scope){for(const details of scope.querySelectorAll('.phone-overflow')){
   if(details.querySelector(':scope > .phone-pop-actions'))continue;
   const actions=dom('div','phone-pop-actions');
   for(const child of [...details.children])if(child.tagName!=='SUMMARY')actions.append(child);
   details.append(actions);
 }}
 function tones(panel,prefs){const wrap=dom('div','phone-tones');for(const [name,value] of [['绿色','green'],['蓝色','blue'],['黑灰','graphite']]){
   const b=button(name,async()=>{await D().setSettings({chatBubbleTone:value});await render();},'phone-tone-choice phone-tone-'+value+( (prefs.chatBubbleTone||'green')===value?' selected':''));
   b.setAttribute('aria-pressed',String((prefs.chatBubbleTone||'green')===value));wrap.append(b);
 }panel.append(wrap);}
 async function header(container,title){
   const h=dom('header','phone-header');const detail=['chat','moment','group-edit','memory','profile','wallet','tasks'].includes(state.screen);
   const back=()=>{if(state.screen==='profile')return navigate(state.profileBack==='contacts'?'contacts':'chat',state.threadId);
     if(state.screen==='group-edit')return navigate('chat',state.threadId);
     if(state.screen==='memory')return navigate('profile',state.memoryActorId);
     if(state.screen==='moment')return navigate('moments');
     if(state.screen==='wallet'||state.screen==='tasks')return navigate('settings');
     if(state.screen==='chat')return navigate('messages');return close();};
   if(!detail){h.classList.add('phone-home-header');h.append(button('‹ 返回剧情',close,'phone-root-back'));h.append(dom('span','phone-header-brand','MY PHONE'));container.append(h);return;}
   h.append(button('‹',back,'phone-back'));
   if(state.screen==='chat'){
     const row=await D().thread(state.threadId),people=await D().contacts();
     const person=row.kind==='private'?people.find(x=>x.id===row.memberIds[0]):null;
     const avatar=face(row.kind==='private'?row.memberIds[0]:'group',person);if(person){avatar.classList.add('phone-tappable-avatar');avatar.role='button';avatar.tabIndex=0;avatar.onclick=()=>safe(()=>navigate('profile',person.id));avatar.onkeydown=e=>{if(e.key==='Enter')avatar.click();};}h.append(avatar);
     const who=dom('div','phone-header-contact');who.append(dom('strong','phone-header-title',row.kind==='group'?row.title:person?.displayNick||row.memberIds[0]));
     who.append(dom('small','',row.kind==='group'?row.memberIds.length+' 位群成员':'聊天 · 手机独立记录'));if(person){who.classList.add('phone-contact-link');who.role='button';who.tabIndex=0;who.setAttribute('aria-label','查看 '+(person.displayNick||'联系人')+' 的资料');who.onclick=()=>safe(()=>navigate('profile',person.id));who.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();who.click();}};}h.append(who);
     h.append(button('⌕',()=>{const finder=root().querySelector('.phone-chat-search');if(!finder)return;finder.open=!finder.open;if(finder.open)finder.querySelector('input')?.focus({preventScroll:true});},'phone-head-search'));
     h.append(button('•••',()=>navigate(row.kind==='group'?'group-edit':'profile',row.memberIds[0]),'phone-head-action'));
   }else{h.append(dom('strong','phone-header-title',title));
     if(detail)h.append(dom('span','phone-head-spacer'));
     else h.append(button('退出',close,'phone-exit'));
   }
   container.append(h);
 }
 async function render(){if(!state.open)return;
   // A popup removed by re-render must settle its awaiting action, not leave a
   // Promise suspended forever while the owner continues using the phone.
   clearURLs();const r=root();const currentVersion=++renderVersion,currentScreen=state.screen,currentThread=state.threadId;const oldView=r.querySelector('.phone-chat-history[data-thread-id]');
   state.scrollRestore=oldView?{threadId:oldView.dataset.threadId,top:oldView.scrollTop,
     fromBottom:Math.max(0,oldView.scrollHeight-oldView.clientHeight-oldView.scrollTop)}:null;
   // Build a complete offscreen DOM before replacing the live UI. A stale
   // read must never overwrite a newer navigation, or detach a live keyboard.
   const shell=dom('div','phone-shell'+(['chat','moment','group-edit','memory','profile','wallet','tasks'].includes(state.screen)?' phone-detail':'')+(state.screen==='chat'?' phone-is-chat':''));
   const statusBar=dom('div','phone-system-status');statusBar.append(dom('span','phone-system-time',clock(new Date())),dom('span','phone-system-name','MIMA PHONE'),dom('span','phone-system-indicators','●●●  ▰'));shell.append(statusBar);
   const titles={tasks:'任务记录',messages:'消息',contacts:'通讯录',moments:'朋友圈',wallet:'钱包',settings:'我的',chat:'聊天',moment:'动态详情','group-edit':'群聊设置',memory:'手机记忆',profile:'联系人资料'};
   try{state.maskCache=new Map(R().state().masks.filter(m=>m.enabled!==false).map(m=>[m.id,m]));const prefs=await D().settings();const theme=['green','blue','graphite'].includes(prefs.chatBubbleTone)?prefs.chatBubbleTone:'green';r.dataset.bubbleTone=theme;await header(shell,titles[state.screen]||'小手机');
     const main=dom('main','phone-main'+(state.screen==='chat'?' phone-chat-screen':''));shell.append(main);
     try{switch(state.screen){case 'messages':await screenMessages(main);break;case 'contacts':await screenContacts(main);break;case 'chat':await screenChat(main);break;case 'profile':await screenProfile(main);break;case 'group-edit':await screenGroupEdit(main);break;case 'moments':await screenMoments(main);break;case 'moment':await screenMoment(main);break;case 'wallet':await screenWallet(main);break;case 'tasks':await screenTasks(main);break;case 'memory':await screenMemory(main);break;default:await screenSettings(main);}}
     catch(e){main.append(dom('div','phone-error','读取失败：'+e.message+'。没有以空数据覆盖存档。'));}
   }catch(e){const error=dom('div','phone-error','小手机界面加载失败：'+(e.message||String(e)));shell.append(error);shell.prepend(button('‹ 返回咪嘛馆',close));}
   decorateMenus(shell);const status=dom('div','phone-status',state.notice);status.id='phone-status';status.setAttribute('role','status');if(state.notice)status.classList.add('visible');shell.append(status);
   const tabs=dom('nav','phone-tabbar');tabs.setAttribute('aria-label','小手机导航');for(const [symbol,label,key] of [['▤','消息','messages'],['♧','通讯录','contacts'],['❀','动态','moments'],['◉','我的','settings']]){
     const b=button('',()=>navigate(key),state.screen===key?'active':'');b.append(dom('span','phone-tab-icon',symbol),dom('span','phone-tab-label',label));if(state.screen===key)b.setAttribute('aria-current','page');tabs.append(b);
   }shell.append(tabs);
   if(!state.open||currentVersion!==renderVersion||state.screen!==currentScreen||state.threadId!==currentThread)return;
   const oldHistory=r.querySelector('.phone-chat-history[data-thread-id]');
   const newHistory=shell.querySelector('.phone-chat-history[data-thread-id]');
   const active=document.activeElement,composer=r.querySelector('.phone-composer');
   if(currentScreen==='chat'&&oldHistory&&newHistory&&composer?.contains(active)
      &&oldHistory.dataset.threadId===newHistory.dataset.threadId){
     // Receiving a background message must not destroy an in-use textarea,
     // its selection/caret, or the iOS soft keyboard. Patch only live content.
     oldHistory.replaceWith(newHistory);
     const oldHint=r.querySelector('.phone-new-message-hint');
     const newHint=shell.querySelector('.phone-new-message-hint');
     if(oldHint&&newHint)oldHint.replaceWith(newHint);
     return;
   }
   cancelChoice();r.replaceChildren(shell);
 }
 async function screenMessages(main){
   const settings=await D().settings(),people=await D().contacts(),items=await D().threads();
   const top=dom('div','phone-screen-heading');top.append(dom('h1','','消息'));
   const actions=dom('div','phone-heading-actions');actions.append(button('＋',createGroup,'phone-round-action'));top.append(actions);main.append(top);
   if(!settings.userMaskId){const guidance=box(main,'开始使用小手机');guidance.append(dom('p','','先选择 User 面具，再从通讯录加入角色。'));guidance.append(button('设置身份',()=>navigate('settings'),'phone-primary'));}
   const search=input('搜索聊天、联系人或群聊');search.classList.add('phone-list-search');main.append(search);
   const bar=dom('div','phone-quick-links');bar.append(button('新建群聊',createGroup),button('添加联系人',()=>navigate('contacts')));main.append(bar);
   const list=dom('section','phone-inbox-list');main.append(list);
   if(!items.length)list.append(dom('div','phone-empty','这里还没有聊天。去通讯录添加角色，开始第一场对话吧。'));
   for(const row of items){const one=row.kind==='private'?people.find(c=>c.id===row.memberIds[0]):null,title=row.kind==='private'?(one?.displayNick||row.memberIds[0]):row.title;
     const history=await D().history(row.id),last=history.at(-1);
     const item=dom('button','phone-inbox-item');item.type='button';item.onclick=()=>safe(()=>navigate('chat',row.id));
     item.append(face(row.kind==='private'?row.memberIds[0]:'group',one));
     const body=dom('span','phone-inbox-body');body.append(dom('strong','',title),dom('span','phone-inbox-preview',last?.content||'开始聊天'));item.append(body);
     const when=dom('time','phone-inbox-date',stamp(last?.createdAt||row.updatedAt));item.append(when);list.append(item);
   }
   search.oninput=()=>{const needle=search.value.trim().toLowerCase();for(const item of list.querySelectorAll('.phone-inbox-item'))item.hidden=!item.textContent.toLowerCase().includes(needle);};
 }
 async function createGroup(){const list=await D().contacts();if(list.length<2)throw Error('请先添加至少两个联系人');const selected=await chooseMultiple('选择群成员',list.map(c=>({id:c.id,label:c.displayNick})));if(!selected.length)return;if(selected.length<2)throw Error('群聊至少两个成员');const title=prompt('群名称','我的小群聊')||'我的小群聊';const row=await D().createConversation(selected,{kind:'group',title});navigate('chat',row.id);}
 async function chooseMultiple(title,options){if(state.activeChoice)throw Error('请先完成当前选择');return new Promise(resolve=>{
     const backdrop=dom('div','phone-modal-backdrop'),dialog=dom('div','phone-modal'),checks=[];
     const finish=values=>{if(state.activeChoice!==finish)return;state.activeChoice=null;backdrop.remove();resolve(values);};
     state.activeChoice=finish;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
     dialog.append(dom('h3','',title));for(const item of options){const label=dom('label','phone-check'),ck=document.createElement('input');ck.type='checkbox';ck.value=item.id;label.append(ck,document.createTextNode(item.label));dialog.append(label);checks.push(ck);}
     line(dialog,button('取消',()=>finish([])),button('确定',()=>finish(checks.filter(c=>c.checked).map(c=>c.value)),'phone-primary'));
     backdrop.append(dialog);backdrop.onclick=e=>{if(e.target===backdrop)finish([]);};
     backdrop.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish([]);}});
     root().append(backdrop);
   });}
 async function screenContacts(main){
   const existing=await D().contacts(),masks=R().listCharacterMasks(),settings=await D().settings();
   main.append(dom('h1','phone-page-heading','通讯录'));
   const search=input('搜索联系人');search.classList.add('phone-list-search');main.append(search);
   const list=dom('div','phone-contacts-list');main.append(list);
   for(const mask of masks){const present=existing.find(x=>x.maskId===mask.id);const card=dom('div','phone-contact-row');card.append(face(mask.id,present));
     const info=dom('div','phone-contact-info');info.append(dom('strong','',present?.displayNick||mask.name));info.append(dom('small','',present?(present.signature||'已添加 · 点击查看资料'):'未添加到小手机'));card.append(info);
     if(present){
       // The two everyday actions must be available in the contact list itself.
       // The canonical private-thread command reuses an existing conversation.
       const actions=dom('div','phone-contact-actions');
       actions.append(button('聊天',async()=>{const chat=await D().createConversation([present.id]);await navigate('chat',chat.id);},'phone-contact-chat phone-primary'));
       actions.append(button('资料',()=>navigate('profile',present.id),'phone-contact-detail'));
       info.classList.add('phone-contact-info-open');info.tabIndex=0;info.role='button';
       info.setAttribute('aria-label','查看 '+(present.displayNick||mask.name)+' 的联系人资料');
       info.onclick=()=>safe(()=>navigate('profile',present.id));
       info.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();info.click();}};
       card.append(actions);
     }else card.append(button('添加',async()=>{const added=await D().addContact(mask.id);await navigate('profile',added.id);},'phone-contact-add'));
     list.append(card);
   }
   if(!masks.length)main.append(dom('p','phone-empty','尚没有可用的 Char 面具，请先在咪嘛馆创建角色。'));
   if(!settings.userMaskId)main.append(button('选择 User 面具',()=>navigate('settings'),'phone-primary'));
   search.oninput=()=>{const key=search.value.trim().toLowerCase();for(const row of list.querySelectorAll('.phone-contact-row'))row.hidden=!row.textContent.toLowerCase().includes(key);};
 }
 async function editContact(person,mask){
   const overlay=dom('div','phone-modal-backdrop');const pane=dom('form','phone-modal phone-contact-editor');
   pane.append(dom('h3','','编辑联系人资料'));
   const hint=dom('p','phone-helper','这里的网名、头像和签名仅属于小手机，不会改变咪嘛馆角色卡。');pane.append(hint);
   const field=(title,val,tag='input')=>{const label=dom('label','phone-edit-field');label.append(dom('span','',title));const control=input(title,val,tag);label.append(control);pane.append(label);return control;};
   const nick=field('手机网名',person.displayNick),remark=field('备注',person.remark||''),signature=field('个性签名',person.signature||'','textarea');signature.rows=2;
   const avatarLabel=dom('label','phone-edit-field');avatarLabel.append(dom('span','','更换小手机头像'));
   const picker=dom('input','phone-avatar-picker');picker.type='file';picker.accept='image/png,image/jpeg,image/webp,image/gif';avatarLabel.append(picker);pane.append(avatarLabel);
   const feedback=dom('p','phone-helper','支持 JPG、PNG、WebP、GIF，图片保存在手机本地媒体库。');pane.append(feedback);
   const controls=dom('div','phone-edit-controls');
   controls.append(button('取消',()=>overlay.remove()));
   const reset=button('恢复角色原头像',()=>{picker.value='';picker.dataset.clearAvatar='yes';feedback.textContent='保存后使用角色卡原头像';});controls.append(reset);
   const save=dom('button','phone-btn phone-primary','保存资料');save.type='submit';controls.append(save);pane.append(controls);
   pane.onsubmit=e=>{e.preventDefault();safe(async()=>{const name=nick.value.trim();if(!name)throw Error('手机网名不能为空');save.disabled=true;
     try{let avatarAssetId=person.avatarAssetId||'';if(picker.dataset.clearAvatar==='yes')avatarAssetId='';
       else if(picker.files?.[0]){const file=picker.files[0];if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('请选择支持的图片格式');if(file.size>8*1024*1024)throw Error('头像不能超过 8MB');const saved=await MimaPhoneMedia.save(file);avatarAssetId=saved.id;}
       await D().updateContact(person.id,{displayNick:name,remark:remark.value,signature:signature.value,avatarAssetId});overlay.remove();await render();say('联系人资料已保存在小手机');
     }finally{save.disabled=false;}});};
   overlay.append(pane);overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});root().append(overlay);nick.focus({preventScroll:true});
 }
 async function screenProfile(main){
   const person=(await D().contacts()).find(x=>x.id===state.contactId);if(!person)throw Error('联系人不存在');
   const mask=R().getMask(person.maskId),prefs=await D().settings();main.classList.add('phone-profile-screen');
   const hero=dom('section','phone-profile-hero');hero.append(face(person.id,person,true),dom('h1','',person.displayNick));
   hero.append(dom('small','','角色名称：'+mask.name));hero.append(dom('p','',person.signature||'还没有个性签名'));main.append(hero);
   const actions=dom('div','phone-profile-actions');actions.append(button('发消息',async()=>{const chat=await D().createConversation([person.id]);await navigate('chat',chat.id);},'phone-primary'));
   actions.append(button('编辑头像和网名',()=>editContact(person,mask),'phone-profile-edit'));
   main.append(actions);
   const details=box(main,'手机联系人资料');
   const display=(title,value)=>{const row=dom('div','phone-info-row');row.append(dom('span','',title),dom('strong','',value||'未设置'));details.append(row);};
   display('手机网名',person.displayNick);display('备注',person.remark);display('个性签名',person.signature);
   details.append(button('修改联系人资料',()=>editContact(person,mask),'phone-profile-edit'));
   const biography=box(main,'角色资料（只读）');biography.append(dom('p','phone-setting-text','读取角色原有面具，仅展示，不改变人物设定或小手机记录。'));
   for(const [title,value] of [['角色简介',mask.description||mask.content],['背景设定',mask.scenario],['角色第一条消息',mask.firstMessage],['创作者备注',mask.creatorNotes]]){
     if(!value)continue;const block=dom('details','phone-bio-item');block.append(dom('summary','',title),dom('div','phone-bio-text',value));biography.append(block);
   }
   if(!biography.querySelector('.phone-bio-item'))biography.append(dom('p','phone-helper','当前角色面具没有填写公开资料。'));
   const other=box(main,'手机功能');line(other,button('角色手机记忆',()=>{state.memoryActorId=person.id;return navigate('memory');}));
   const palette=box(main,'我发送的消息气泡颜色');palette.append(dom('p','phone-setting-text','对方始终是浅灰气泡，手机和剧情的颜色设置互不影响。'));tones(palette,prefs);
 }
 // Every explicit confirmation is a new transaction, while a pending result
 // retains its durable command ID. UI guards also reject rapid double taps.
 async function runWalletIntent(slot,payload,perform){
   if(state.pendingWalletActions.has(slot))return;
   state.pendingWalletActions.add(slot);
   let record=null;
   try{
     const amount=payload?.amount;
     if(amount!==undefined&&(!Number.isSafeInteger(amount)||amount<=0||(slot==='mint'&&amount>100000000)))throw Error('金额必须是合法的正整数，发放上限为一亿虚拟币');
     if(payload?.from&&payload?.to&&payload.from===payload.to)throw Error('不能向自己转账');
     record=await D().walletIntent(slot,payload);
     try{
       const result=await perform(record.commandId);
       await D().finishWalletIntent(slot,record.commandId,result);
       return result;
     }catch(error){
       // Verify IDB's unique command receipt before releasing an intent.
       // If the local DB cannot be consulted, preserve pending for replay.
       const resolved=await D().resolveWalletIntentFailure(slot,record.commandId,error.message);
       if(resolved.status==='committed')return resolved.result;
       throw error;
     }
   }finally{state.pendingWalletActions.delete(slot);}
 }
 async function issueIntent(kind,signature,perform){
   const slot=kind+':'+signature.split(':')[0];
   const result=await runWalletIntent(slot,{signature},perform);
   if(result!==undefined)say('虚拟交易已经保存，可以正常进行下一笔。');
   return result;
 }
 async function walletAction(slot,payload,perform){
   const result=await runWalletIntent(slot,payload,perform);
   if(result!==undefined){say('交易已记入本机账本');await render();}
   return result;
 }
 // Both chat transactions use one native confirmation sheet. No blocking
 // window.prompt / confirm; the actual canonical wallet command runs once.
 async function sendChatTransfer(thread){
   if(state.activeChoice)throw Error('请先完成或关闭当前手机弹层');
   const contacts=await D().contacts(),actors=thread.memberIds.map(id=>({id,name:contacts.find(x=>x.id===id)?.displayNick||id}));
   if(!actors.length)throw Error('当前会话没有可收款的角色');
   return new Promise(resolve=>{
     const backdrop=dom('div','phone-modal-backdrop phone-sheet-backdrop'),pane=dom('form','phone-modal phone-transaction-sheet');
     pane.setAttribute('role','dialog');pane.setAttribute('aria-modal','true');pane.append(dom('div','phone-sheet-handle'));
     pane.append(dom('h3','','虚拟转账'),dom('p','phone-helper','仅使用小手机内的虚拟 MIMA 币，不涉及真实支付。'));
     const recipient=dom('select','phone-input');for(const actor of actors){const option=dom('option','',actor.name);option.value=actor.id;recipient.append(option);}
     const amount=input('输入虚拟币金额','10');amount.type='number';amount.min='1';amount.step='1';amount.inputMode='numeric';
     const label=(name,field)=>{const row=dom('label','phone-edit-field');row.append(dom('span','',name),field);pane.append(row);};
     label('转账给',recipient);label('虚拟币金额',amount);
     const balance=dom('small','phone-helper','正在读取我的余额…');pane.append(balance);
     D().balance(D().owner).then(n=>{if(balance.isConnected)balance.textContent='我的可用余额：'+n+' MIMA';}).catch(err=>{if(balance.isConnected)balance.textContent='余额读取失败：'+err.message;});
     const error=dom('p','phone-error');error.hidden=true;pane.append(error);
     const finish=()=>{if(state.activeChoice!==finish)return;state.activeChoice=null;backdrop.remove();resolve();};state.activeChoice=finish;
     const save=dom('button','phone-btn phone-primary','确认转账');save.type='submit';line(pane,button('取消',finish),save);
     pane.onsubmit=e=>{e.preventDefault();void safe(async()=>{
       const to=recipient.value,coins=Number(amount.value);
       if(!Number.isSafeInteger(coins)||coins<=0){error.hidden=false;error.textContent='请输入有效的正整数金额';return;}
       if(state.activeThreadRounds.has(thread.id)||state.postingThreads.has(thread.id)){error.hidden=false;error.textContent='这段聊天正在生成/发送，转账尚未提交；其它聊天不受影响';return;}
       state.postingThreads.add(thread.id);save.disabled=true;try{await issueIntent('transfer-card',thread.id+':'+to+':'+coins,key=>D().transferInThread(thread.id,D().owner,to,coins,key));finish();await render();}
       catch(err){error.hidden=false;error.textContent=err.message||String(err);}
       finally{save.disabled=false;state.postingThreads.delete(thread.id);}
     });};
     backdrop.append(pane);backdrop.onclick=e=>{if(e.target===backdrop)finish();};
     backdrop.addEventListener('keydown',e=>{if(e.key==='Escape')finish();});root().append(backdrop);
   });
 }
 async function sendChatGift(thread){
   if(state.activeChoice)throw Error('请先完成或关闭当前手机弹层');
   const owned=(await D().inventory(D().owner)).filter(x=>x.status==='owned');
   if(!owned.length)throw Error('还没有可赠送的礼物，请先到钱包礼物商店购买');
   const contacts=await D().contacts(),actors=thread.memberIds.map(id=>({id,name:contacts.find(c=>c.id===id)?.displayNick||id}));
   return new Promise(resolve=>{
     const backdrop=dom('div','phone-modal-backdrop phone-sheet-backdrop'),pane=dom('form','phone-modal phone-transaction-sheet');
     pane.setAttribute('role','dialog');pane.setAttribute('aria-modal','true');pane.append(dom('div','phone-sheet-handle'),dom('h3','','送出礼物'));
     pane.append(dom('p','phone-helper','从我的背包选择一件已拥有的虚拟礼物。'));
     const recipient=dom('select','phone-input'),itemSelect=dom('select','phone-input');
     for(const actor of actors){const option=dom('option','',actor.name);option.value=actor.id;recipient.append(option);}
     for(const item of owned){const catalog=D().catalog.find(c=>c.id===item.catalogId);const option=dom('option','',(catalog?.emoji||'🎁')+' '+(catalog?.name||item.catalogId));option.value=item.id;itemSelect.append(option);}
     const label=(name,field)=>{const row=dom('label','phone-edit-field');row.append(dom('span','',name),field);pane.append(row);};
     label('赠送给',recipient);label('我的礼物',itemSelect);
     const error=dom('p','phone-error');error.hidden=true;pane.append(error);
     const finish=()=>{if(state.activeChoice!==finish)return;state.activeChoice=null;backdrop.remove();resolve();};state.activeChoice=finish;
     const save=dom('button','phone-btn phone-primary','确认送礼');save.type='submit';line(pane,button('取消',finish),save);
     pane.onsubmit=e=>{e.preventDefault();void safe(async()=>{
       const to=recipient.value,itemId=itemSelect.value;
       if(state.activeThreadRounds.has(thread.id)||state.postingThreads.has(thread.id)){error.hidden=false;error.textContent='这段聊天正在生成/发送，礼物尚未提交';return;}
       state.postingThreads.add(thread.id);save.disabled=true;
       try{await issueIntent('gift-card',thread.id+':'+itemId+':'+to,key=>D().giftInThread(thread.id,itemId,D().owner,to,key));finish();await render();}
       catch(err){error.hidden=false;error.textContent=err.message||String(err);}
       finally{save.disabled=false;state.postingThreads.delete(thread.id);}
     });};
     backdrop.append(pane);backdrop.onclick=e=>{if(e.target===backdrop)finish();};
     backdrop.addEventListener('keydown',e=>{if(e.key==='Escape')finish();});root().append(backdrop);
   });
 }
 // Native chat receipt sheet. The IDB ledger/order remains the authority.
 async function showPaymentDetail(msg,thread,contacts){
   const overlay=dom('div','phone-modal-backdrop'),panel=dom('section','phone-modal phone-receipt');
   const target=contactName(msg.recipientId,contacts);
   panel.append(dom('div','phone-receipt-icon',msg.type==='transfer_card'?'↗':'🎁'));
   panel.append(dom('h3','',msg.type==='transfer_card'?'虚拟转账详情':'礼物详情'));
   if(msg.type==='transfer_card'){
     const rows=(await D().ledger()).filter(x=>x.txId===msg.transferId);
     if(!rows.length)panel.append(dom('p','phone-error','交易在本机账本中尚未核实，请勿重复转账'));
     else panel.append(dom('strong','phone-receipt-amount',msg.amountMinor+' MIMA'),dom('p','','收款人：'+target),dom('small','',`已记账 · 交易凭据 ${msg.transferId}`));
   }else{
     const order=await S().read('orders',msg.orderId);const gift=order?await S().read('inventories',order.itemId):null;
     const item=D().catalog.find(c=>c.id===gift?.catalogId);
     panel.append(dom('strong','phone-receipt-amount',(item?.emoji||'🎁')+' '+(item?.name||'虚拟礼物')),dom('p','','收礼人：'+target));
     panel.append(dom('small','',({SENT_PENDING:'待收下',ACCEPTED:'已收下',REJECTED:'已退回'})[order?.status]||'交易记录未找到'));
     if(order?.status==='SENT_PENDING'){
       panel.append(dom('p','phone-helper','这是模拟手机；由主人明确选择角色是否收礼，不会自动替角色作决定。'));
       line(panel,button('模拟收下',async()=>{await D().settleGift(order.id,order.recipientId,true);overlay.remove();await render();},'phone-primary'),button('退回礼物',async()=>{await D().settleGift(order.id,order.recipientId,false);overlay.remove();await render();}));
     }
   }
   panel.append(button('关闭',()=>overlay.remove(),'phone-receipt-close'));
   overlay.append(panel);overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
   overlay.addEventListener('keydown',e=>{if(e.key==='Escape')overlay.remove();});root().append(overlay);
 }
 // Only follow a live incoming typing indicator when the reader is near the end.
 // A reply that arrives while the owner reads history must never steal the scroll position.
 function appendTyping(view,actorId,contacts){
   if(!view)return;
   const follow=view.scrollHeight-view.clientHeight-view.scrollTop<=56;
   view.querySelectorAll('.phone-typing-row').forEach(x=>x.remove());
   const contact=contacts.find(c=>c.id===actorId),row=dom('div','phone-typing-row');row.setAttribute('role','status');row.setAttribute('aria-label',(contact?.displayNick||'角色')+' 正在生成回复');
   row.append(face(actorId,contact));const bubble=dom('span','phone-typing-bubble');for(let i=0;i<3;i++)bubble.append(dom('i','phone-typing-dot'));row.append(bubble);view.append(row);
   if(follow)view.scrollTop=view.scrollHeight;
   else{const hint=view.parentNode?.querySelector('.phone-new-message-hint');if(hint)hint.hidden=false;}
 }
 async function clearTyping(){state.typingActor=null;state.typingThreadId=null;root().querySelectorAll('.phone-typing-row').forEach(x=>x.remove());}
 async function screenChat(main){
   const thread=await D().thread(state.threadId),settings=await D().settings(),contacts=await D().contacts();
   const displayName=id=>contactName(id,contacts);
   if(thread.kind==='group'){
     const tools=dom('details','phone-thread-tools');tools.append(dom('summary','','群聊操作'));
     line(tools,button('群设置',()=>navigate('group-edit')),button('让指定角色发言',async()=>{
       const selected=await chooseMultiple('选择发言角色',thread.memberIds.map(id=>({id,label:displayName(id)})));
       if(selected.length)await produceThreadReplies(thread.id,null,selected);
     },'phone-primary'));main.append(tools);
   }
   const finder=dom('details','phone-chat-search');finder.append(dom('summary','','⌕ 搜索聊天记录'));
   const search=input('搜索当前聊天原文…',state.chatSearch);
   finder.append(search);main.append(finder);
   // UI windowing never edits or truncates canonical phone history, nor model context.
   // Older messages remain one tap away; only mounted DOM nodes are bounded.
   const allMessages=await D().allMessages(thread.id);
   const visibleCount=state.visibleMessageCounts.get(thread.id)||100;
   const hiddenCount=Math.max(0,allMessages.length-visibleCount);
   const messages=hiddenCount?allMessages.slice(-visibleCount):allMessages;
   const view=dom('div','phone-chat-history');view.dataset.threadId=thread.id;main.append(view);
   if(hiddenCount){const more=button('↑ 查看更早的消息（还有 '+hiddenCount+' 条）',async()=>{
     state.olderScrollRestore={threadId:thread.id,height:view.scrollHeight,top:view.scrollTop};
     state.visibleMessageCounts.set(thread.id,visibleCount+100);await render();
   },'phone-load-older');view.append(more);}

   let prevDay='';
   for(let i=0;i<messages.length;i++){const msg=messages[i];
     const date=new Date(msg.createdAt).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
     if(date!==prevDay){view.append(dom('div','phone-day-divider',date));prevDay=date;}
     const isMine=msg.actorId===D().owner;
     const prev=messages[i-1],next=messages[i+1];const within=(a,b)=>a&&b&&a.actorId===b.actorId&&Math.abs(new Date(a.createdAt)-new Date(b.createdAt))<120000;
     const fromSame=within(prev,msg)&&new Date(prev.createdAt).toDateString()===new Date(msg.createdAt).toDateString();
     const toSame=within(msg,next)&&new Date(next.createdAt).toDateString()===new Date(msg.createdAt).toDateString();
     const wrap=dom('div','phone-message '+(isMine?'mine':'theirs')+(fromSame?' phone-continued':'')+(!toSame?' phone-group-end':' phone-in-group')+(state.animatedMessageIds.has(msg.id)?' phone-new':''));
     wrap.dataset.searchText=msg.content||'';
     if(!isMine){if(toSame)wrap.append(dom('span','phone-avatar-placeholder'));else wrap.append(face(msg.actorId,contacts.find(x=>x.id===msg.actorId)));}
     const content=dom('div','phone-message-content');
     if(thread.kind==='group'&&!isMine)content.append(dom('span','phone-message-sender',displayName(msg.actorId)));
     const bubble=dom('article','phone-bubble '+(isMine?'mine':'theirs'));
     if(msg.deliveryState==='deleted')bubble.classList.add('phone-deleted');
     if(msg.type==='voice_text')bubble.append(dom('small','phone-voice-label','◖)) 文字模拟语音'));
     if(msg.type==='transfer_card'&&msg.transferId){
       bubble.classList.add('phone-payment-bubble');const card=dom('div','phone-payment-card');card.append(dom('div','phone-payment-icon','↗'),dom('small','',`向 ${displayName(msg.recipientId)} 转账`),dom('strong','',`${msg.amountMinor} MIMA`),dom('span','','转账成功 · 仅虚拟货币'));bubble.append(card);
       card.onclick=e=>{e.stopPropagation();void safe(()=>showPaymentDetail(msg,thread,contacts));};
     }else if(msg.type==='gift_card'&&msg.orderId){
       bubble.classList.add('phone-payment-bubble');const order=await S().read('orders',msg.orderId);const gift=order?await S().read('inventories',order.itemId):null;const catalog=D().catalog.find(c=>c.id===gift?.catalogId);
       const card=dom('div','phone-payment-card');card.append(dom('div','phone-payment-icon',catalog?.emoji||'🎁'),dom('small','','送给 '+displayName(msg.recipientId)),dom('strong','',catalog?.name||'虚拟礼物'),dom('span','',({SENT_PENDING:'待收下',ACCEPTED:'已收下',REJECTED:'已退回'})[order?.status]||'状态待核对'));bubble.append(card);
       card.onclick=e=>{e.stopPropagation();void safe(()=>showPaymentDetail(msg,thread,contacts));};
     }else if(msg.content)bubble.append(dom('div','phone-bubble-text',msg.content));
     for(const assetId of msg.assetIds||[]){
       try{const asset=await MimaPhoneMedia.load(assetId);
         if(asset.mime.startsWith('image/')){const im=dom('img','phone-bubble-media');im.src=photoURL(asset);im.alt=asset.name;
           im.onclick=()=>window.open(im.src,'_blank');bubble.append(im);
         }else if(asset.mime.startsWith('audio/')){const audio=dom('audio','phone-bubble-audio');audio.src=photoURL(asset);audio.controls=true;bubble.append(audio);}
       }catch(e){bubble.append(dom('small','phone-error','附件读取失败：'+e.message));}
     }
     
     content.append(bubble);
     const meta=dom('div','phone-message-meta');meta.append(dom('time','phone-bubble-time',clock(msg.createdAt)));
     const tools=menu('···');
     tools.append(button('复制',()=>{if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(msg.content||'').catch(()=>prompt('复制消息文本',msg.content||''));prompt('复制消息文本',msg.content||'');},'phone-tiny'));
     if(isMine){
       // Quoting is not part of received-message chrome; preserve own-message reply feature in overflow only.
       tools.append(button('引用这条',async()=>{state.replyToId=msg.id;await render();},'phone-tiny'));
       if(msg.deliveryState==='deleted')tools.append(button('恢复消息',async()=>{await D().restoreMessage(msg.id);await render();},'phone-tiny'));
       else{
         tools.append(button('编辑',async()=>{const txt=prompt('编辑你的消息',msg.content);if(txt!==null){await D().editMessage(msg.id,txt);await render();}},'phone-tiny'));
         tools.append(button('撤回',async()=>{if(confirm('撤回这条手机消息？历史版本仍会保留。')){await D().editMessage(msg.id,msg.content,true);await render();}},'phone-tiny'));
       }
     }
     if(msg.versions?.length){const history=dom('details','phone-versions');history.append(dom('summary','','历史版本'));
       for(const v of msg.versions)history.append(dom('pre','phone-raw',v.content));tools.append(history);}
     meta.append(tools);content.append(meta);wrap.append(content);view.append(wrap);
     bubble.tabIndex=0;bubble.role='button';bubble.setAttribute('aria-label','显示消息操作');
     const toggle=()=>{for(const other of view.querySelectorAll('.phone-message.is-active'))if(other!==wrap){other.classList.remove('is-active');other.querySelector('.phone-overflow')?.removeAttribute('open');}
       const on=!wrap.classList.contains('is-active');wrap.classList.toggle('is-active',on);tools.open=on;};
     bubble.onclick=toggle;bubble.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}};bubble.oncontextmenu=e=>{e.preventDefault();toggle();};
   }
   search.oninput=()=>{state.chatSearch=search.value;const q=state.chatSearch.toLowerCase();for(const el of view.querySelectorAll('.phone-message'))el.hidden=!!q&&!el.dataset.searchText.toLowerCase().includes(q);};
   if(state.chatSearch)search.oninput();
   if(state.typingByThread.has(thread.id))appendTyping(view,state.typingByThread.get(thread.id),contacts);
   if(!settings.userMaskId)view.append(dom('p','phone-error','请先选择 User 面具，才能向角色请求回复。'));
   const threadGenerations=(await D().generations()).filter(g=>g.threadId===thread.id);
   const incomplete=threadGenerations.filter(g=>['prepared','failed','unknown','cancelled'].includes(g.status));for(const f of incomplete){
     if(await hiddenGeneration(f.id))continue;
     const active=state.activeGenerationControllers.has(f.id);
     const evidence=f.raw||f.rawDraft||'';
     const panel=box(view,({failed:'失败的手机生成 · 原文保留',cancelled:'已取消的手机生成 · 草稿保留',unknown:'手机请求结果未核实',prepared:active?'正在生成手机回复':'上次请求未取得结算凭据'})[f.status]);panel.dataset.generationId=f.id;
     const explanation=f.status==='failed'?f.error:f.status==='cancelled'?(f.error||'任务已停止，本机证据保留'):active?'模型请求进行中，草稿仅为已收到的部分，不是正式角色消息。':'页面离开或刷新后，无法核实服务端最终状态及是否计费。不会自动重试。';
     panel.append(dom('p','phone-error',explanation));
     panel.classList.add('phone-generation-card');
     panel.append(button('× 关闭提示',async()=>{await hideGeneration(f.id,true);panel.remove();say('已收进「我的 → 任务记录」，原文和恢复入口都还在。');},'phone-dismiss'));
     if(evidence||active){const details=dom('details');details.open=active;
       const summary=dom('summary','',evidence?`查看${f.rawIncomplete||f.status!=='failed'?'已收到的部分草稿（非完整回复）':'模型返回的原文'} · ${evidence.length} 字符`:'等待上游发送正文…');
       const preview=dom('pre','phone-raw',evidence);details.append(summary,preview);panel.append(details);
       panel.append(button('复制本机已收到的文字',async()=>{const live=preview.textContent||evidence;if(!live)return;say('复制的是本机已接收文字，不代表完整回复');if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(live);prompt('复制收到的文字',live);}));}
     panel.append(button('免费核对本机提交状态',async()=>{const latest=await S().read('generations',f.id);say(latest?.status==='committed'?'本任务已提交，无需重新请求':'本机状态：'+(latest?.status||'缺失')+'。不能由此判断服务端是否计费。');await render();}));
     if(f.status==='prepared'||f.status==='unknown')panel.append(button(active?'■ 停止当前生成':'取消／归档此任务',async()=>{if(!confirm(active?'停止正在进行的手机回复？已收到的草稿会保留，不会作为正式消息发送。':'将这条未完成任务标记为已取消？已有文字保留，之后仍可手动发起新请求。'))return;
        const controller=state.activeGenerationControllers.get(f.id);
        const liveDraft=panel.querySelector('.phone-raw')?.textContent||'';
        controller?.abort();const settled=await D().cancelGeneration(f.id,f.attempt,liveDraft);
        say(settled.status==='committed'?'请求已经提交成功，本机记录不会被撤销':'本次生成已取消，本机已收到的文字已保留');await render();}));
     if(!state.activeThreadRounds.has(thread.id)&&!active)panel.append(button('手动重新请求（可能再次计费）',async()=>{if(!confirm('旧任务的服务端计费状态未必可确认。将按当前有效授权重新请求，可能再次计费；不会重复发送主人消息。确定继续？'))return;await produceThreadReplies(thread.id,f.sourceId,[f.actorId],f.id);},'phone-primary'));
     if(f.raw&&f.status==='failed'&&!f.rawIncomplete){panel.append(button('解析并恢复多条气泡（零 API）',async()=>{
       const parsed=MimaPhoneModel.bubbles(f.raw);if(!confirm('已经正确解析出 '+parsed.length+' 条气泡。确认将其加入当前聊天？'))return;
       await D().recoverGeneration(f.id,{mode:'parsed',attempt:f.attempt,sourceDigest:await D().promptDigest(f.actorId)});await render();},'phone-primary'));
     }
     if(evidence&&(f.status==='failed'||f.status==='cancelled')){panel.append(button(f.rawIncomplete||f.status==='cancelled'?'手动编辑已收到文字并恢复（零 API）':'主人自行编辑正文恢复',async()=>{
         const example=(()=>{try{return f.rawIncomplete||f.status==='cancelled'?evidence:MimaPhoneModel.bubbles(f.raw).map(b=>b.content).join('\n');}catch(_){return evidence;}})();
         const revised=prompt('以下是本机保存的候选文字，可能不完整或包含 JSON 格式。请亲自删改成希望发布的消息。此操作不调用模型，不代表模型已正常完成：',example);
         if(revised===null||!revised.trim())return;
         if(!confirm('确认以主人编辑的文字作为一条手机气泡？这不是模型原始完整输出，不调用 API。'))return;
         await D().recoverGeneration(f.id,{mode:'owner_text',text:revised,attempt:f.attempt,sourceDigest:await D().promptDigest(f.actorId)});await render();}));}}
   // A committed owner message with no generated task needs a recovery action.
   // This also covers a failed dispatch before prepareGeneration (the post stays canonical).
   const orphan=allMessages.filter(m=>m.actorId===D().owner&&m.deliveryState==='committed'&&!threadGenerations.some(g=>g.sourceId===m.id));
   if(orphan.length&&settings.userMaskId&&(thread.kind==='private'||thread.settings?.autoReply!==false)){const bar=dom('div','phone-reply-recovery');bar.append(dom('small','',`有 ${orphan.length} 条消息尚未发起角色回复`));
     bar.append(button('为最近一条请求回复',()=>produceThreadReplies(thread.id,orphan.at(-1).id),'phone-primary'));view.append(bar);}
   const composer=dom('form','phone-composer');
   if(state.replyToId){const quoted=dom('div','phone-reply-preview','正在引用自己的消息');
     quoted.append(button('×',()=>{state.replyToId=null;return render();},'phone-tiny'));composer.append(quoted);}
   const draft=await D().readDraft(thread.id),entry=dom('div','phone-composer-entry');
   const add=dom('details','phone-add-menu');add.append(dom('summary','','＋'));
   const attachments=dom('div','phone-add-actions');
   attachments.append(button('发送图片',()=>attachImage(thread.id)));
   attachments.append(button(state.recording?'停止录音':'录音',()=>recordAudio(thread.id)));
   attachments.append(button('文字语音',async()=>{const txt=prompt('输入要以模拟语音发送的话');if(txt?.trim()){
     if(state.activeThreadRounds.has(thread.id)||state.postingThreads.has(thread.id))throw Error('当前聊天正在发送/生成，文字语音没有提交');
     state.postingThreads.add(thread.id);try{const sent=await D().post(thread.id,{content:txt,type:'voice_text'});await render();if(settings.userMaskId&&(thread.kind!=='group'||thread.settings?.autoReply!==false))await produceThreadReplies(thread.id,sent.id);}finally{state.postingThreads.delete(thread.id);}
   }}));
   attachments.append(button('虚拟转账',()=>sendChatTransfer(thread)));
   attachments.append(button('送礼物',()=>sendChatGift(thread)));
   add.append(attachments);entry.append(add);
   const textBox=input('发送消息…',state.localDrafts.has(thread.id)?state.localDrafts.get(thread.id):draft?.content||'','textarea');textBox.rows=1;
   textBox.oninput=()=>{void persistDraft(thread.id,textBox.value).catch(e=>{console.error('[Mima Phone] 草稿保存失败',e);if(textBox.isConnected)say('草稿未能保存：'+e.message);});};
   textBox.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing&&e.keyCode!==229){e.preventDefault();composer.requestSubmit();}});
   entry.append(textBox);
   const send=button('↑',()=>composer.requestSubmit(),'phone-send phone-primary');send.setAttribute('aria-label','发送');entry.append(send);
   composer.append(entry);
   composer.onsubmit=e=>{e.preventDefault();safe(async()=>{if(state.postingThreads.has(thread.id)){say('这段聊天已有发送任务，草稿已保留；可以切到其它聊天继续使用。');return;}const txt=textBox.value.trim();if(!txt)return;
     if(state.activeThreadRounds.has(thread.id)){say('这段聊天正在生成回复，未发送第二条消息；草稿仍保留。其它聊天可以继续使用。');return;}
     state.postingThreads.add(thread.id);send.disabled=true;textBox.disabled=true;let sent;try{sent=await D().post(thread.id,{content:txt,replyToId:state.replyToId});
       state.replyToId=null;
       // Earlier oninput saves finish first. Do not silently claim that a
       // committed message failed just because the later draft cleanup failed.
       try{await persistDraft(thread.id,'');state.localDrafts.delete(thread.id);}
       catch(draftError){console.error('手机消息已发送但草稿清理失败',draftError);say('消息已发送；草稿清理失败，请检查旧草稿');}
       textBox.value='';state.animatedMessageIds=new Set([sent.id]);await render();state.animatedMessageIds.clear();
       // Hold this thread's post lock through the generation lifecycle, but
       // other threads remain independently usable.
       if(settings.userMaskId)await produceThreadReplies(thread.id,sent.id);
     }finally{state.postingThreads.delete(thread.id);send.disabled=false;textBox.disabled=false;}});};
   // A visible, actionable cue instead of scrolling the reader out of old messages.
   const unreadHint=button('↓ 新消息',()=>{view.scrollTop=view.scrollHeight;unreadHint.hidden=true;},'phone-new-message-hint');
   unreadHint.hidden=true;main.append(unreadHint);
   view.addEventListener('scroll',()=>{
     if(view.scrollHeight-view.clientHeight-view.scrollTop<=56)unreadHint.hidden=true;
   },{passive:true});
   main.append(composer);
   
   // Snapshot the incoming IDs before the send lifecycle clears animatedMessageIds.
   // Sending one's own text follows it; an incoming reply respects deliberate reading.
   const previous=state.scrollRestore,hasNewMessages=state.animatedMessageIds.size>0;
   const ownNew=messages.some(m=>m.actorId===D().owner&&state.animatedMessageIds.has(m.id));
   const showingTyping=state.typingByThread.has(thread.id);
   requestAnimationFrame(()=>{if(!view.isConnected)return;
     const loadingOlder=state.olderScrollRestore;
     if(loadingOlder?.threadId===thread.id){
       view.scrollTop=Math.max(0,view.scrollHeight-loadingOlder.height+loadingOlder.top);
       state.olderScrollRestore=null;
     }else if(previous?.threadId===thread.id&&previous.fromBottom>56&&!ownNew){
       view.scrollTop=Math.min(previous.top,Math.max(0,view.scrollHeight-view.clientHeight));
       if(hasNewMessages||showingTyping)unreadHint.hidden=false;
     }else view.scrollTop=view.scrollHeight;
   });
 }
 async function produceThreadReplies(threadId,sourceId,selected=null,retryGenId=null){
   if(state.activeThreadRounds.has(threadId))throw Error('当前聊天已有生成任务，不能重复发起；其它聊天不受影响');
   state.activeThreadRounds.add(threadId);try{const thread=await D().thread(threadId),prefs=await D().settings(),trigger=sourceId?(await S().read('messages',sourceId))?.content||'':'',speakers=await D().selectSpeakers(threadId,trigger,selected);
   mustUser(prefs);for(const actor of speakers){const current=await D().thread(threadId);if(!current.memberIds.includes(actor))break;
     const sourceDigest=await D().promptDigest(actor);
     const generated=retryGenId?await D().restartGeneration(retryGenId,sourceDigest):await D().prepareGeneration(threadId,actor,sourceId||'',{task:'chat',sourceDigest});
     const controller=new AbortController();state.activeGenerationControllers.set(generated.id,controller);
     let savedDraft='',lastDraft='',lastCheckpointAt=0,checkpointChain=Promise.resolve();
     const flushDraft=()=>{if(!lastDraft||lastDraft===savedDraft)return checkpointChain;const snapshot=lastDraft;savedDraft=snapshot;checkpointChain=checkpointChain.catch(()=>{}).then(()=>D().checkpointGenerationDraft(generated.id,generated.attempt,snapshot));return checkpointChain;};
     const onProgress=ev=>{if(typeof ev?.streamText!=='string'||!ev.streamText)return;lastDraft=ev.streamText;
       const currentPanel=Array.from(root().querySelectorAll('[data-generation-id]')).find(x=>x.dataset.generationId===generated.id);
       if(currentPanel){const preview=currentPanel.querySelector('.phone-raw'),summary=currentPanel.querySelector('details summary');
         if(preview)preview.textContent=lastDraft;if(summary)summary.textContent='已收到的未提交草稿 · '+lastDraft.length+' 字符';}
       const at=Date.now();if(at-lastCheckpointAt>=350||lastDraft.length-savedDraft.length>=350){lastCheckpointAt=at;void flushDraft().catch(e=>console.warn('手机流式草稿检查点写入失败',e));}};
     const peopleNow=await D().contacts(),nick=peopleNow.find(x=>x.id===actor)?.displayNick||actor;state.typingActor=actor;state.typingThreadId=threadId;state.typingByThread.set(threadId,actor);
     // Make Stop and live evidence accessible as soon as this generation exists.
     if(state.open&&state.screen==='chat'&&state.threadId===threadId)try{await render();}catch(e){console.warn('手机生成控制面板未绘制，生成事务仍被保留',e);}
     let returned=null,canonicalDone=false;
     try{const all=await D().history(threadId),membership=await S().read('memberships',threadId+':'+actor),start=membership?.joinedAtSeq||0;
       const visible=all.filter(m=>m.seq>=start&&m.deliveryState==='committed');
       const people=await D().contacts(),speakerNames=Object.fromEntries(people.map(c=>[c.id,c.displayNick]));
       // The outbound request uses the *prepared generation's* frozen
       // permissions, never an independently refreshed read of live memory.
       const extraMemories=generated.memorySnapshot;
       if(!Array.isArray(extraMemories))throw Error('旧手机生成缺少冻结的记忆授权快照，请重新发起生成');
       const extra=extraMemories.map(m=>'已授权的手机记忆（'+m.id+'）：'+m.content).join('\n');
       const mounts=await D().effectiveResources(actor,prefs);
       const source=sourceId?visible.find(m=>m.id===sourceId):visible.at(-1);
       if(sourceId&&!source)throw Error('回复引用的主人消息不在当前角色可见范围，拒绝发送附件或对话');
       const allowedImages=[];
       for(const assetId of source?.assetIds||[]){const asset=await MimaPhoneMedia.load(assetId);
         if(['image/jpeg','image/png','image/webp','image/gif'].includes(asset.mime))allowedImages.push(assetId);
         // Audio is kept intact in phone storage; reliable transcript already
         // travels as source message text, never misrouted to image vision.
       }
       const parts=allowedImages.length?await MimaPhoneMedia.visionParts(allowedImages):[];
       returned=await MimaPhoneModel.generate({actorId:actor,userMaskId:prefs.userMaskId,history:visible,presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,scope:thread.kind,extra,visionParts:parts,speakerNames,apiSettings:prefs,signal:controller.signal,onProgress});
       await flushDraft().catch(e=>console.warn('手机最后草稿检查点写入失败',e));
       const committed=await D().finishGeneration(generated.id,returned.bubbles,returned.raw,generated.attempt,await D().promptDigest(actor));state.animatedMessageIds=new Set(committed.resultIds||[]);canonicalDone=true;say(nick+' 的回复已保存');
       try{if(state.open&&((state.screen==='chat'&&state.threadId===threadId)||state.screen==='messages'))await render();state.animatedMessageIds.clear();}catch(paintError){console.error('手机回复已保存，但界面重绘失败；无需重复付费生成',{generationId:generated.id,error:paintError});say('手机回复已保存。界面显示未更新，请重新打开聊天。');}
       if(retryGenId)break;
     }catch(e){if(canonicalDone){console.error('手机回复已结算，后续非关键任务失败',{generationId:generated.id,error:e});say('回复已经保存，后续界面任务失败；不要重发');break;}
       await flushDraft().catch(err=>console.warn('手机失败草稿检查点写入失败',err));
       const observed=typeof e.raw==='string'?e.raw:typeof e.partialDraft==='string'?e.partialDraft:returned?.raw||'';
       const raw=lastDraft.length>observed.length?lastDraft:observed;
       try{await D().failGeneration(generated.id,e.message,raw,generated.attempt,{partial:!!e.partialDraft||(!e.raw&&!!lastDraft)});}catch(settleError){
         console.warn('旧 attempt 或已结算任务的失败回调被拒绝，保留当前状态',{generationId:generated.id,attempt:generated.attempt,error:settleError});}
       say('角色回复未提交：'+e.message);if(state.open&&state.screen==='chat'&&state.threadId===threadId)await render();break;}
     finally{state.activeGenerationControllers.delete(generated.id);}
   }
   }finally{state.activeThreadRounds.delete(threadId);state.typingByThread.delete(threadId);if(state.typingThreadId===threadId)await clearTyping();
     // The prior failure paint happened while groupSending was still true; the
     // retry button was omitted forever until the user manually navigated.
     if(state.open&&state.screen==='chat'&&state.threadId===threadId)try{await render();}catch(e){console.warn('结束手机生成后的刷新失败；记录仍在本地',e);}
   }}
 function mustUser(prefs){if(!prefs.userMaskId)throw Error('先在「我的手机」选择 User 面具');}
 async function attachImage(threadId){if(state.activeThreadRounds.has(threadId)||state.postingThreads.has(threadId)){say('这段聊天正在生成回复，不能继续发送附件；其它聊天不受影响');return;}const picker=dom('input');picker.type='file';picker.accept='image/*';picker.onchange=()=>safe(async()=>{const file=picker.files?.[0];if(!file)return;if(state.activeThreadRounds.has(threadId)||state.postingThreads.has(threadId))throw Error('当前聊天有生成/发送任务，图片没有提交');state.postingThreads.add(threadId);try{const asset=await MimaPhoneMedia.save(file);const sent=await D().post(threadId,{type:'image',content:'[发送了一张图片]',assetIds:[asset.id]});await render();const prefs=await D().settings();if(prefs.userMaskId){const thread=await D().thread(threadId);if(thread.kind!=='group'||thread.settings?.autoReply!==false)await produceThreadReplies(threadId,sent.id);}}finally{state.postingThreads.delete(threadId);}});picker.click();}
 async function recordAudio(threadId){
   if(state.recording){const recorder=state.recording,originalId=recorder.threadId;
     if(originalId!==threadId){say('这段录音属于另一个聊天，请返回原聊天停止录音，绝不转发到这里');return;}
     if(state.activeThreadRounds.has(originalId)||state.postingThreads.has(originalId)){say('原聊天正在生成/发送，先结束原聊天任务再发送录音');return;}
     state.recording=null;state.postingThreads.add(originalId);
     try{const result=await recorder.stop(),saved=await MimaPhoneMedia.save(result.blob);
       const sent=await D().post(originalId,{type:'voice_audio',content:result.transcript?'[录音转写] '+result.transcript:'[语音录音，未取得可靠转写]',assetIds:[saved.id]});await render();
       const prefs=await D().settings();if(prefs.userMaskId&&result.transcript){const thread=await D().thread(originalId);if(thread.kind!=='group'||thread.settings?.autoReply!==false)await produceThreadReplies(originalId,sent.id);}
     }finally{state.postingThreads.delete(originalId);}return;
   }
   if(state.activeThreadRounds.has(threadId)||state.postingThreads.has(threadId))throw Error('这段聊天正在生成/发送，不开始新录音');
   if(!confirm('麦克风录音会保存在本机小手机数据库。若浏览器支持语音识别，浏览器服务可能将语音传送至识别提供方。确认开启吗？'))return;
   const recorder=await MimaPhoneMedia.recordAndTranscribe({onTranscript:x=>say('转写：'+x),onStatus:say});state.recording={...recorder,threadId};say('正在录音，点击「录音」按钮结束并保存');}
 async function screenGroupEdit(main){const row=await D().thread(state.threadId);const title=input('群聊名称',row.title);line(box(main,'群名称'),title,button('保存群名',async()=>{await D().updateThread(row.id,{title:title.value});await navigate('chat',row.id);}));
   const max=input('一轮最多发言角色数',String(row.settings?.maxSpeakerTurns||3));max.type='number';max.min=1;max.max=row.memberIds.length;line(box(main,'群聊调度'),max,button('保存',async()=>{await D().updateThread(row.id,{settings:{maxSpeakerTurns:Math.max(1,Math.min(row.memberIds.length,Number(max.value)||1))}});await render();}));
   const muted=(row.settings?.mutedIds||[]).map(id=>row.memberIds.indexOf(id));
   const people=await D().contacts();
   line(box(main,'禁言与自动回复'),button(row.settings?.autoReply===false?'自动回复已关闭 · 点击开启':'自动回复已开启 · 点击关闭',async()=>{await D().updateThread(row.id,{settings:{autoReply:row.settings?.autoReply===false}});await render();}),button('设置禁言成员',async()=>{const options=row.memberIds.map(id=>({id,label:people.find(x=>x.id===id)?.displayNick||id}));const choice=await chooseMultiple('选择需要禁言的角色（未选中即全部解禁）',options);await D().updateThread(row.id,{settings:{mutedIds:choice}});await render();}));
   line(box(main,'成员'),button('增删群成员',async()=>{const selection=await chooseMultiple('选择更新后的群成员',people.map(x=>({id:x.id,label:x.displayNick})));if(!selection.length)return;await D().updateThread(row.id,{memberIds:selection});await render();}));main.append(dom('p','phone-helper','新加入成员默认不能访问加入前的群聊消息；离群角色不会继续发布新消息。'));
 }
 function previewSocialPlan(actions){
   if(!actions?.length)return '角色本次只浏览，没有选择发表任何互动。';
   return actions.map((a,i)=>`${i+1}. `+({post_moment:'发布动态',like_moment:'点赞',comment_moment:'评论动态',reply_comment:'回复楼中楼',no_action:'不互动'}[a.type]||a.type)+
     (a.momentId?' [动态 '+a.momentId+']':'')+(a.parentCommentId?' [回复 '+a.parentCommentId+']':'')+
     (a.body?'：'+a.body:'' )).join('\n');
 }
 async function manualSocialTurn(kind,actorId){
   const prefs=await D().settings();mustUser(prefs);
   const digest=await D().promptDigest(actorId);
   // Preparation freezes the exact ACL-filtered timeline in the same IDB
   // transaction as its generation ID. Never rebuild the prompt from live feed.
   const gen=await D().prepareSocialGeneration({kind,actorId,sourceDigest:digest});
   let reply=null;
   try{
     const mounts=await D().effectiveResources(actorId,prefs);
     reply=await MimaPhoneModel.generateSocialPlan({actorId,userMaskId:prefs.userMaskId,
       feed:gen.feedSnapshot,memories:gen.memorySnapshot||[],presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,mode:kind,apiSettings:prefs});
     await D().stageSocialPlan(gen.id,{attempt:gen.attempt,raw:reply.raw,actions:reply.actions,
       sourceDigest:await D().promptDigest(actorId)});
     // One confirmation authorizes the entire proposed action set, not a button
     // per comment/like. Dismissal leaves the persisted preview recoverable.
     if(confirm('主人确认本次角色社交行动（仅模拟手机）？\n\n'+previewSocialPlan(reply.actions))){
       const done=await D().finishSocialPlan(gen.id,{attempt:gen.attempt,sourceDigest:await D().promptDigest(actorId)});
       say('社交回合已真实结算 '+done.outcomes?.filter(x=>x.status==='committed').length+' 项，不会自动启动其他角色。');
     }else say('社交提案已保存为待审核，稍后可确认或取消；不会后台发帖。');
   }catch(e){
     try{await D().failSocialGeneration(gen.id,{attempt:gen.attempt,error:e.message,raw:e.raw||reply?.raw||''});}
     catch(settleError){console.warn('社交失败无法覆写既有结算结果',settleError);}
     throw e;
   }finally{await render();}
 }
 async function socialGenerate(kind,actorId,momentId=null,parentCommentId=null){
   if(kind==='moment'||kind==='browse')return manualSocialTurn(kind,actorId);
   const prefs=await D().settings();mustUser(prefs);
   const digest=await D().promptDigest(actorId);
   const gen=await D().prepareSocialGeneration({kind,actorId,momentId,parentCommentId,sourceDigest:digest});
   let reply=null,staged=false;
   try{
     const m=momentId?await S().read('moments',momentId):null;
     const history=m?[{actorId:D().owner,content:'有权限可见的动态：'+m.body},...(await D().comments(momentId)).map(c=>({actorId:c.actorId,content:(c.id===parentCommentId?'请回复这条评论：':'评论：')+c.body}))]: (await D().moments(actorId)).map(item=>({actorId:item.authorId,content:'角色有权看到的朋友圈动态：'+item.body}));
     const mounts=await D().effectiveResources(actorId,prefs);
     const extra=(kind==='moment'?'请以角色本人名义写一条朋友圈动态，不引用任何未授权私聊。':'请根据可见动态及评论自然回应，不要捏造未见资料。')+'\n【本轮已授权手机记忆】\n'+JSON.stringify((gen.memorySnapshot||[]).map(m=>({id:m.id,kind:m.kind,content:m.content})));
     reply=await MimaPhoneModel.generate({actorId,userMaskId:prefs.userMaskId,history,presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,task:kind,scope:m?.audience||'public',extra,apiSettings:prefs});
     await D().stageSocialCandidate(gen.id,{attempt:gen.attempt,raw:reply.raw,bubbles:reply.bubbles,sourceDigest:await D().promptDigest(actorId)});staged=true;
     if(confirm('发布以下角色内容？\n\n'+reply.bubbles.map(b=>b.content).join('\n'))){
       await D().finishSocialGeneration(gen.id,{attempt:gen.attempt,sourceDigest:await D().promptDigest(actorId)});
     }else await D().cancelSocialGeneration(gen.id,gen.attempt);
   }catch(e){
     try{await D().failSocialGeneration(gen.id,{attempt:gen.attempt,error:e.message,raw:e.raw||reply?.raw||''});}
     catch(settleError){console.warn('社交任务失败结算未取得权限，保留已有状态',gen.id,settleError);}
     throw e;
   }finally{await render();}
 }
 async function socialPendingUI(main){const pending=await D().pendingSocialGenerations();if(!pending.length)return;
   const panel=box(main,'待处理的朋友圈生成 · 不再扣费');
   for(const g of pending){const item=box(panel,(g.socialKind==='moment'?'角色动态':g.socialKind==='browse'?'角色逛朋友圈':'角色评论')+' · '+g.actorId+' · '+g.status);
     if(g.raw){item.append(dom('small','phone-helper','原始生成文本已保留；未写入正式动态。'));
       const details=dom('details');details.append(dom('summary','','查看原始模型输出'),dom('pre','phone-raw',g.raw));item.append(details);}
     if(g.status==='awaiting_owner'&&Array.isArray(g.candidateActions)){
       const summary=dom('pre','phone-raw',previewSocialPlan(g.candidateActions));item.append(summary);
       item.append(button('确认整轮社交提案（不再次调用模型）',async()=>{
         if(!confirm('确认执行以下 '+g.candidateActions.length+' 项候选行动？\n'+previewSocialPlan(g.candidateActions)))return;
         const done=await D().finishSocialPlan(g.id,{attempt:g.attempt,sourceDigest:await D().promptDigest(g.actorId)});
         say('社交回合结算 '+done.outcomes?.length+' 项。');await render();},'phone-primary'));
     }
     if(g.status==='awaiting_owner'&&!g.candidateActions&&g.candidate)item.append(button('确认发布已保存的候选',async()=>{
       const text=g.candidate.map(b=>b.content).join('\n');if(!confirm('确认发布？\n'+text))return;
       await D().finishSocialGeneration(g.id,{attempt:g.attempt,sourceDigest:await D().promptDigest(g.actorId)});await render();},'phone-primary'));
     if(['failed','awaiting_owner'].includes(g.status)&&['moment','browse'].includes(g.socialKind)){
       const edited=input('编辑合法 JSON 社交动作提案…',g.manualPlanRaw||g.raw||JSON.stringify({schema:'phone_social_plan_v1',actions:[]},null,2),'textarea');
       edited.rows=5;item.append(edited);
       item.append(button('核对编辑后的社交计划（零 API）',async()=>{
         const actions=MimaPhoneModel.socialPlan(edited.value);
         await D().reviseSocialPlan(g.id,{attempt:g.attempt,sourceDigest:await D().promptDigest(g.actorId),raw:edited.value,actions});
         await render();}));
     }
     if(g.status==='failed'&&g.raw&&g.socialKind==='moment_comment')item.append(button('主人明确改写候选并恢复',async()=>{
       const text=prompt('请输入自己确认的正文（不会把坏 JSON 当台词）','');if(!text?.trim())return;
       await D().finishSocialGeneration(g.id,{attempt:g.attempt,sourceDigest:await D().promptDigest(g.actorId),mode:'owner_text',ownerText:text});await render();}));
     item.append(button('取消这次任务',async()=>{await D().cancelSocialGeneration(g.id,g.attempt);await render();}));
   }
 }
 async function screenMoments(main){
   const list=await D().contacts(),prefs=await D().settings();main.append(dom('h1','phone-page-heading','朋友圈'));
   const compose=dom('details','phone-social-compose');compose.append(dom('summary','','＋ 分享一条动态'));
   const form=dom('div','phone-moment-compose-body'),field=input('分享今天发生的事…','','textarea');field.rows=3;
   const momentAssets=[],mediaLine=dom('div','phone-line'),mediaSummary=dom('span','phone-muted','暂未选择图片');
   mediaLine.append(button('添加图片',async()=>{const picker=dom('input');picker.type='file';picker.accept='image/*';picker.multiple=true;
     picker.onchange=()=>safe(async()=>{for(const file of picker.files||[]){const saved=await MimaPhoneMedia.save(file);momentAssets.push(saved.id);}mediaSummary.textContent='已选择 '+momentAssets.length+' 张';});picker.click();}),mediaSummary);
   const visibility=dom('select','phone-input');for(const [label,val] of [['所有联系人可见','public'],['指定好友可见','friends'],['仅自己可见','private']]){
     const opt=dom('option','',label);opt.value=val;visibility.append(opt);
   }
   form.append(field,mediaLine);
   line(form,visibility,button('发布动态',async()=>{let audienceIds=[];
     if(visibility.value==='friends'){audienceIds=await chooseMultiple('允许哪些联系人查看？',list.map(x=>({id:x.id,label:x.displayNick})));
       if(!audienceIds.length)throw Error('指定好友可见必须选择联系人');}
     await D().createMoment({body:field.value,audience:visibility.value,audienceIds,assetIds:momentAssets});await render();
   },'phone-primary'));compose.append(form);main.append(compose);
   const actions=dom('details','phone-social-ai');actions.append(dom('summary','','角色互动 · 手动触发'));
   actions.append(dom('p','phone-helper','选择角色后，本次回合可以浏览已有动态并自主决定发帖、点赞、评论或回复。不会后台自动运行。'));
   line(actions,button('让角色发朋友圈',async()=>{const choices=await chooseMultiple('选择本次发朋友圈的角色',list.map(x=>({id:x.id,label:x.displayNick})));
     for(const actorId of choices)await socialGenerate('moment',actorId);await render();},'phone-primary'),
   button('让角色浏览朋友圈',async()=>{const choices=await chooseMultiple('选择本次逛朋友圈的角色',list.map(x=>({id:x.id,label:x.displayNick})));
     for(const actorId of choices)await socialGenerate('browse',actorId);await render();}));main.append(actions);
   await socialPendingUI(main);
   const feed=await D().moments();if(!feed.length)main.append(dom('div','phone-empty','还没有朋友圈动态。分享第一条，或者让角色在手动触发的社交回合里发布。'));
   const feedList=dom('div','phone-feed');main.append(feedList);
   for(const m of feed){const author=m.authorId===D().owner?'我':contactName(m.authorId,list),info=list.find(x=>x.id===m.authorId);
     const card=dom('article','phone-moment-card'),top=dom('div','phone-post-header');
     top.append(face(m.authorId===D().owner?prefs.userMaskId||'owner':m.authorId,info));
     const who=dom('div','phone-post-author');who.append(dom('strong','',author),dom('time','',stamp(m.createdAt)));top.append(who);
     if(m.authorId===D().owner){const overflow=menu('···');overflow.append(button('编辑动态',async()=>{
       const next=prompt('编辑动态',m.body);if(next!==null){await D().editMoment(m.id,D().owner,next);await render();}}));
       overflow.append(button('删除动态',async()=>{if(confirm('删除这条动态及其可见评论？')){await D().editMoment(m.id,D().owner,'',true);await render();}}));top.append(overflow);
     }
     card.append(top);
     if(m.body)card.append(dom('p','phone-post',m.body));
     if(m.assetIds?.length){const images=dom('div','phone-post-images');images.classList.add('phone-images-'+Math.min(4,m.assetIds.length));
       for(const assetId of m.assetIds){try{const asset=await MimaPhoneMedia.load(assetId),im=dom('img','phone-post-image');im.src=photoURL(asset);im.alt=asset.name;im.loading='lazy';im.onclick=()=>window.open(im.src,'_blank');images.append(im);
         }catch(e){images.append(dom('small','phone-error','图片读取失败：'+e.message));}}card.append(images);
     }
     const reactions=await D().reactions(m.id),comments=await D().comments(m.id),stats=dom('div','phone-post-actions');
     stats.append(button('♡ '+reactions.length,async()=>{await D().react(m.id,D().owner);await render();},'phone-social-action'));
     stats.append(button('♧ '+comments.length,()=>navigate('moment',m.id),'phone-social-action'));card.append(stats);
     if(comments.length){const preview=dom('div','phone-comment-preview');for(const c of comments.slice(0,3)){
       const line=dom('div','phone-comment-line');line.append(dom('b','',contactName(c.actorId,list)+(c.parentCommentId?' 回复':'')+'：'),document.createTextNode(c.body));preview.append(line);
       }if(comments.length>3)preview.append(button('查看全部 '+comments.length+' 条评论',()=>navigate('moment',m.id),'phone-view-comments'));
       card.append(preview);
     }
     feedList.append(card);
   }
 }
 async function screenMoment(main){
   const m=await S().read('moments',state.momentId),prefs=await D().settings();if(!m||m.deleted)throw Error('动态已不存在');
   const contacts=await D().contacts();main.append(dom('h2','phone-detail-heading',contactName(m.authorId,contacts)+' 的动态'));
   const post=dom('section','phone-moment-card');post.append(dom('p','phone-post',m.body),dom('small','phone-muted',new Date(m.createdAt).toLocaleString('zh-CN')));
   if(m.assetIds?.length){const images=dom('div','phone-post-images');for(const assetId of m.assetIds){try{const asset=await MimaPhoneMedia.load(assetId),pic=dom('img','phone-post-image');pic.src=photoURL(asset);pic.alt=asset.name;pic.onclick=()=>window.open(pic.src,'_blank');images.append(pic);}catch(e){images.append(dom('small','phone-error','图片读取失败：'+e.message));}}post.append(images);}
   main.append(post);
   const comments=await D().comments(m.id),thread=dom('section','phone-comments-detail');thread.append(dom('h3','','评论 · '+comments.length));main.append(thread);
   for(const entry of comments){const c=dom('article','phone-detail-comment');c.append(face(entry.actorId,contacts.find(x=>x.id===entry.actorId)));
     const content=dom('div','phone-comment-body');content.append(dom('strong','',contactName(entry.actorId,contacts)));
     if(entry.parentCommentId){const parent=comments.find(x=>x.id===entry.parentCommentId);if(parent)content.append(dom('small','phone-muted','回复 '+contactName(parent.actorId,contacts)));}
     content.append(dom('p','',entry.body));
     const meta=dom('div','phone-comment-controls');meta.append(dom('time','phone-muted',stamp(entry.createdAt)));
     meta.append(button('回复',async()=>{const text=prompt('回复评论');if(!text?.trim())return;await D().comment(m.id,D().owner,text,entry.id);await render();},'phone-text-button'));
     if(entry.actorId===D().owner){const tools=menu('···');tools.append(button('编辑我的评论',async()=>{
       const text=prompt('修改评论',entry.body);if(text===null||text===entry.body)return;await D().editComment(entry.id,D().owner,text);await render();}));
       tools.append(button('删除评论',async()=>{if(!confirm('删除评论及其下属回复？关联手机记忆将重新待审。'))return;await D().deleteComment(entry.id,D().owner);await render();}));meta.append(tools);}
     content.append(meta);
     const invite=dom('details','phone-comment-invite');invite.append(dom('summary','','邀请角色回复'));
     invite.append(button('选择角色',async()=>{const selected=await chooseMultiple('选择回复该评论的角色',contacts.filter(x=>D().acl(m,x.id)).map(x=>({id:x.id,label:x.displayNick})));
       for(const actorId of selected)await socialGenerate('moment_comment',actorId,m.id,entry.id);await render();}));content.append(invite);
     c.append(content);thread.append(c);
   }
   const form=dom('form','phone-comment-composer'),field=input('写评论…');
   form.append(field,button('发送',()=>form.requestSubmit(),'phone-primary'));
   form.onsubmit=e=>{e.preventDefault();safe(async()=>{await D().comment(m.id,D().owner,field.value);await render();});};main.append(form);
   const extras=dom('details','phone-social-ai');extras.append(dom('summary','','更多角色互动'));
   extras.append(button('让可见角色点赞／取消赞',async()=>{const actors=contacts.filter(c=>D().acl(m,c.id));const selected=await chooseMultiple('选择角色',actors.map(c=>({id:c.id,label:c.displayNick})));
     for(const actorId of selected)await D().react(m.id,actorId);await render();}));
   extras.append(button('邀请角色评论这条动态',async()=>{mustUser(prefs);const chosen=await chooseMultiple('邀请评论的角色',contacts.filter(c=>D().acl(m,c.id)).map(c=>({id:c.id,label:c.displayNick})));
     for(const actorId of chosen)await socialGenerate('moment_comment',actorId,m.id);await render();}));main.append(extras);
   await socialPendingUI(main);
 }
 async function screenWallet(main){main.append(dom('h1','phone-page-heading','钱包'));main.append(dom('p','phone-helper','本页面只有虚拟 MIMA 币和虚拟礼物，不涉及任何真实支付。所有交易均在手机数据库内记账。'));
   const people=[{id:D().owner,displayNick:'主人'},...(await D().contacts())];
   const overview=dom('section','phone-wallet-hero');overview.append(dom('small','','我的虚拟余额'),dom('strong','',String(await D().balance(D().owner))+' MIMA'),dom('span','','仅供模拟互动 · 不涉及真实支付'));main.append(overview);
   const manage=dom('details','phone-wallet-manage');manage.append(dom('summary','','模拟经济管理（发币与所有角色账户）'));main.append(manage);
   const wallet=box(manage,'管理角色余额');for(const p of people)wallet.append(dom('div','phone-wallet-row',`${p.displayNick}：${await D().balance(p.id)} MIMA`));
   const mintOwner=dom('select','phone-input');for(const p of people){const opt=dom('option','',p.displayNick);opt.value=p.id;mintOwner.append(opt);}const amount=input('发行金额','100');amount.type='number';amount.min=1;line(wallet,mintOwner,amount,button('发放虚拟币',async()=>{if(!confirm('向此模拟角色发行虚拟 MIMA 币？'))return;const actorId=mintOwner.value,coins=Number(amount.value);await walletAction('mint',{actorId,amount:coins},key=>D().issue(actorId,coins,key));}));
   const transfer=box(manage,'高级：模拟角色之间转账');const from=dom('select','phone-input'),to=dom('select','phone-input');for(const person of people)for(const sel of [from,to]){const opt=dom('option','',person.displayNick);opt.value=person.id;sel.append(opt);}if(people.length>1)to.selectedIndex=1;const sum=input('金额','10');sum.type='number';sum.min=1;line(transfer,from,to,sum,button('确认转账',async()=>{if(!confirm('确认仅转账虚拟 MIMA 余额？'))return;const sender=from.value,recipient=to.value,coins=Number(sum.value);await walletAction('transfer',{from:sender,to:recipient,amount:coins},key=>D().transfer(sender,recipient,coins,key));},'phone-primary'));
   const ownTransfer=box(main,'从我的钱包转账');
   ownTransfer.append(dom('p','phone-helper','日常转账只能由主人账户发给手机联系人；角色之间的模拟经济操作在上方管理设置中。'));
   const payTo=dom('select','phone-input'),payAmount=input('金额','10');payAmount.type='number';payAmount.min=1;payAmount.step=1;
   for(const person of people.filter(p=>p.id!==D().owner)){const option=dom('option','',person.displayNick);option.value=person.id;payTo.append(option);}
   if(!payTo.options.length)ownTransfer.append(dom('p','phone-helper','先添加至少一位联系人才能转账。'));
   else line(ownTransfer,payTo,payAmount,button('确认转账',async()=>{const recipient=payTo.value,coins=Number(payAmount.value);
     if(!Number.isSafeInteger(coins)||coins<=0)throw Error('请输入有效的虚拟币整数金额');
     if(!confirm('将从我的手机钱包向 '+(people.find(p=>p.id===recipient)?.displayNick||recipient)+' 转账 '+coins+' MIMA 币；不会真实付款。确定？'))return;
     await walletAction('transfer:owner',{from:D().owner,to:recipient,amount:coins},key=>D().transfer(D().owner,recipient,coins,key));},'phone-primary'));
   const gifts=box(main,'礼物商店');for(const item of D().catalog){line(gifts,dom('span','',`${item.emoji} ${item.name} · ${item.price} 币`),button('购买',async()=>{await walletAction('buy:'+item.id,{actorId:D().owner,catalogId:item.id},key=>D().buyGift(D().owner,item.id,key));}));}
   const belongings=box(main,'我的礼物');for(const item of await D().inventory(D().owner)){const label=D().catalog.find(c=>c.id===item.catalogId);line(belongings,dom('span','',`${label?.emoji||'🎁'} ${label?.name||item.catalogId} · ${item.status}`),button('赠送角色',async()=>{const choices=await chooseMultiple('选择收礼角色',people.filter(x=>x.id!==D().owner).map(p=>({id:p.id,label:p.displayNick})));if(choices.length!==1)throw Error('一件礼物只能赠给一位角色');await walletAction('gift:'+item.id,{itemId:item.id,from:D().owner,to:choices[0]},key=>D().giftItem(item.id,D().owner,choices[0],key));}));}
   const pending=(await D().orders()).filter(x=>x.status==='SENT_PENDING');const orders=box(main,'待领取礼物');for(const o of pending){line(orders,dom('span','',`${o.senderId} → ${o.recipientId}`),button('收下',async()=>{await D().settleGift(o.id,o.recipientId,true);await render();}),button('拒绝退回',async()=>{await D().settleGift(o.id,o.recipientId,false);await render();}));}
   const journal=box(main,'最近交易');for(const entry of (await D().ledger()).slice(-24).reverse())journal.append(dom('small','phone-ledger-row',`${entry.type} · ${entry.walletId}: ${entry.deltaMinor>=0?'+':''}${entry.deltaMinor}`));
 }
 async function apiConfigUI(main,prefs){
   const card=box(main,'小手机专属 API 设置');
   card.append(dom('p','phone-setting-text','默认跟随剧情 API。切换到独立配置后，私聊、群聊和朋友圈生成都使用手机模型；不会修改剧情配置，缺少地址或模型时明确报错，绝不偷偷回退。'));
   const chooser=dom('select','phone-input');for(const [title,value] of [['跟随主剧情的 API','inherit'],['手机独立 API','custom']]){
     const opt=dom('option','',title);opt.value=value;opt.selected=(prefs.phoneApiMode||'inherit')===value;chooser.append(opt);}
   line(card,chooser);
   chooser.onchange=()=>safe(async()=>{await D().setSettings({phoneApiMode:chooser.value});await render();});
   if(chooser.value!=='custom'){
     const inherited=MimaStandalone.getApiConfig();
     const switchRow=dom('label','phone-edit-field');switchRow.append(dom('span','','本手机的流式响应方式（不改主剧情 API）'));
     const streamSelect=dom('select','phone-input');for(const [name,value] of [['跟随剧情设置（当前'+(inherited.stream?'流式':'非流式')+'）','inherit'],['流式','on'],['非流式','off']]){const opt=dom('option','',name);opt.value=value;opt.selected=(prefs.phoneStreamOverride||'inherit')===value;streamSelect.append(opt);}switchRow.append(streamSelect);card.append(switchRow);
     card.append(dom('p','phone-helper','此项仅控制小手机的下一次请求。进行中的生成沿用发起时的参数；不会修改剧情 API 或已有记录。'));
     streamSelect.onchange=()=>safe(async()=>{await D().setSettings({phoneStreamOverride:streamSelect.value});say('已保存手机流式设置：'+(streamSelect.value==='inherit'?'跟随剧情':streamSelect.value==='on'?'流式':'非流式'));});
     return;
   }
   const inherited=MimaStandalone.getApiConfig(),custom=prefs.phoneApi||{};
   const fields={};
   function field(label,key,{secret=false,kind='input'}={}){
     const wrap=dom('label','phone-edit-field');wrap.append(dom('span','',label));
     const el=input(label,String(custom[key]??''),kind);if(secret)el.type='password';
     el.autocomplete='off';fields[key]=el;wrap.append(el);card.append(wrap);return el;
   }
   field('API Base URL（渠道地址）','apiBase');field('API Key','apiKey',{secret:true});field('模型名称 / ID','model');
   const opts=dom('details','phone-api-extra');opts.append(dom('summary','','高级设置（端点、采样、流式）'));card.append(opts);
   function optional(label,key){const wrap=dom('label','phone-edit-field');wrap.append(dom('span','',label));const el=input(label,String(custom[key]??''));fields[key]=el;wrap.append(el);opts.append(wrap);}
   optional('聊天端点（可选）','chatEndpoint');optional('模型列表端点（可选）','modelsEndpoint');optional('额外请求头 JSON（可选）','extraHeaders');
   optional('温度 0～2','temperature');fields.temperature.value=String(custom.temperature??0.85);
   optional('最大输出 tokens（0 = 渠道默认）','maxTokens');fields.maxTokens.value=String(custom.maxTokens??0);
   optional('模型上下文窗口 tokens（0 = 未知，不作长度保证）','contextWindowTokens');fields.contextWindowTokens.value=String(custom.contextWindowTokens??0);
   const stream=dom('label','phone-check'),ck=dom('input');ck.type='checkbox';ck.checked=!!custom.stream;stream.append(ck,document.createTextNode('使用流式响应'));
   card.append(stream);card.append(dom('small','phone-helper','关闭为非流式；更改后点击「保存手机 API」才对下一轮生效。'));
   const response=dom('p','phone-helper phone-api-feedback','手机独立配置只保存在小手机本地数据库。备份文件可能包含 API Key，请妥善保管。');card.append(response);
   // Model discovery must work *before* a model ID has been selected.
   // Only saving a working generation profile requires an actual model ID.
   const readDraft=()=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]));
   const validateDiscovery=()=>{
     const cfg=readDraft();
     if(!cfg.apiBase)throw Error('请先填写 API Base URL，再查询模型列表');
     if(cfg.extraHeaders){
       let headers;try{headers=JSON.parse(cfg.extraHeaders);}catch(_){throw Error('额外请求头不是有效 JSON');}
       if(!headers||Array.isArray(headers)||typeof headers!=='object')throw Error('额外请求头必须为 JSON 对象');
     }
     // Use the same endpoint resolver as real generation (including custom /models).
     const endpoints=MimaStandalone.buildEndpoints(cfg);
     if(!['http:','https:'].includes(new URL(endpoints.models).protocol))throw Error('模型列表端点需要 HTTP 或 HTTPS 地址');
     return cfg;
   };
   const validateSave=()=>{
     const cfg=validateDiscovery();
     if(!cfg.model)throw Error('保存手机 API 前，请填写或选择模型 ID');
     cfg.temperature=Number(fields.temperature.value.trim());
     cfg.maxTokens=Number(fields.maxTokens.value.trim());cfg.contextWindowTokens=Number(fields.contextWindowTokens.value.trim());cfg.stream=ck.checked;
     if(!Number.isFinite(cfg.temperature)||cfg.temperature<0||cfg.temperature>2)throw Error('温度应在 0～2');
     if(!Number.isSafeInteger(cfg.maxTokens)||cfg.maxTokens<0)throw Error('最大输出 tokens 必须为非负整数');
     if(!Number.isSafeInteger(cfg.contextWindowTokens)||cfg.contextWindowTokens<0)throw Error('上下文窗口必须为非负整数');
     return cfg;
   };
   const buttons=dom('div','phone-line');
   buttons.append(button('保存手机 API',async()=>{const cfg=validateSave();await D().setSettings({phoneApiMode:'custom',phoneApi:cfg});response.textContent='已保存：'+cfg.model+'（仅手机）';say('手机 API 已保存，不影响剧情模型');},'phone-primary'));
   buttons.append(button('从剧情复制配置',async()=>{if(!confirm('将当前主剧情 API 参数复制到手机独立配置？仅复制这一次，此后两者不再同步。'))return;
     const copy={...inherited};delete copy.modelCapacityProfiles;delete copy.contextWindowIdentity;await D().setSettings({phoneApiMode:'custom',phoneApi:copy});await render();}));
   const queryButton=button('查询可用模型',async()=>{
     if(queryButton.disabled)return;
     let cfg;try{cfg=validateDiscovery();}catch(err){response.textContent=err?.message||String(err);return;}
     const queryIdentity=JSON.stringify([cfg.apiBase,cfg.apiKey,cfg.modelsEndpoint,cfg.extraHeaders]);
     queryButton.disabled=true;queryButton.textContent='正在查询…';
     response.textContent='正在查询此渠道的模型列表…';
     try{
       const found=await MimaStandalone.listModelsWithConfig(cfg);
       if(!response.isConnected)return; // Page navigated; never touch a different screen.
       const now=readDraft();
       if(JSON.stringify([now.apiBase,now.apiKey,now.modelsEndpoint,now.extraHeaders])!==queryIdentity){
         response.textContent='查询期间连接配置发生变化，请按新配置重新查询。';return;
       }
       if(!found.length){response.textContent='这个渠道没有返回可用模型，请检查模型列表端点与权限。';return;}
       response.replaceChildren(dom('span','',`找到 ${found.length} 个模型。选择后仍需点击「保存手机 API」：`));
       const select=dom('select','phone-input');
       const placeholder=dom('option','','选择模型（不会自动保存）');placeholder.value='';select.append(placeholder);
       for(const id of found){const opt=dom('option','',id);opt.value=id;select.append(opt);}
       select.value=found.includes(fields.model.value.trim())?fields.model.value.trim():'';
       const unsaved=dom('small','',fields.model.value.trim()&&!found.includes(fields.model.value.trim())?'当前手填模型不在此列表，已保留原值。':'');
       select.onchange=()=>{if(!select.value)return;fields.model.value=select.value;unsaved.textContent='已选择 '+select.value+' · 尚未保存';};
       response.append(select,unsaved);
     }catch(err){
       if(!response.isConnected)return;
       // No credentials or custom header values in inline error feedback.
       let message=String(err?.message||'查询失败');
       for(const secret of [cfg.apiKey,...(function(){try{return Object.values(JSON.parse(cfg.extraHeaders||'{}')).filter(v=>typeof v==='string');}catch(_){return [];}})()]){
         if(secret&&secret.length>=4)message=message.split(secret).join('[已隐藏]');
       }
       const status=err?.status||err?.details?.status||err?.httpStatus;
       response.textContent=`模型列表查询失败${err?.code?' ['+err.code+']':''}${status?' (HTTP '+status+')':''}：${message}。可检查 API 地址、权限或高级设置中的模型列表端点。`;
     }finally{
       queryButton.disabled=false;queryButton.textContent='查询可用模型';
     }
   });
   buttons.append(queryButton);card.append(buttons);
 }
 async function screenSettings(main){main.append(dom('h1','phone-page-heading','我的'));
   const prefs=await D().settings(),users=R().listUserMasks(),all=R().state();
   // User identity is a normal phone setting, not an advanced engineering option.
   const identity=box(main,'当前 User 面具');identity.classList.add('phone-user-identity');
   const current=users.find(u=>u.id===prefs.userMaskId);
   identity.append(dom('p','phone-setting-text',current?'当前身份：'+current.name:'尚未选择手机身份'));
   const userSelect=dom('select','phone-input');userSelect.setAttribute('aria-label','切换小手机 User 面具');
   for(const u of users){const opt=dom('option','',u.name);opt.value=u.id;opt.selected=prefs.userMaskId===u.id;userSelect.append(opt);}
   const useMask=button('切换身份',async()=>{if(!userSelect.value)throw Error('没有可使用的 User 面具');await D().setSettings({userMaskId:userSelect.value});await render();say('小手机身份已切换，剧情身份不会改变');},'phone-primary');
   useMask.disabled=!users.length;line(identity,userSelect,useMask);
   if(!users.length)identity.append(dom('p','phone-helper','先在咪嘛馆建立 User 面具，再回到这里选择。'));
   const quick=dom('section','phone-my-shortcuts');quick.append(button('◈  我的钱包',()=>navigate('wallet'),'phone-shortcut'),button('▤  任务记录',()=>navigate('tasks'),'phone-shortcut'));main.append(quick);
   const palette=box(main,'聊天外观');palette.append(dom('p','phone-setting-text','蓝白简约或绿白社交风格，只影响小手机。'));tones(palette,prefs);
   const advanced=dom('details','phone-advanced');advanced.append(dom('summary','','设置与高级管理'));main.append(advanced);const settingsHost=dom('section');advanced.append(settingsHost);main=settingsHost;
   await apiConfigUI(main,prefs);
   const presets=box(main,'全局预设（只读挂载）');for(const p of all.presets.filter(x=>x.enabled!==false)){const l=dom('label','phone-check'),ck=document.createElement('input');ck.type='checkbox';ck.checked=(prefs.presetIds||[]).includes(p.id);ck.onchange=()=>safe(async()=>{const ps=new Set((await D().settings()).presetIds||[]);ck.checked?ps.add(p.id):ps.delete(p.id);await D().setSettings({presetIds:[...ps]});});l.append(ck,document.createTextNode(p.name));presets.append(l);}
   const worlds=box(main,'世界书（只读挂载）');for(const w of all.worldbooks.filter(x=>x.enabled!==false)){const l=dom('label','phone-check'),ck=document.createElement('input');ck.type='checkbox';ck.checked=(prefs.worldbookIds||[]).includes(w.id);ck.onchange=()=>safe(async()=>{const ids=new Set((await D().settings()).worldbookIds||[]);ck.checked?ids.add(w.id):ids.delete(w.id);await D().setSettings({worldbookIds:[...ids]});});l.append(ck,document.createTextNode(w.name));worlds.append(l);}
   const overrides=box(main,'每个角色独立挂载（仅手机生效）');const characters=await D().contacts();
   for(const character of characters){const charId=character.id,chosen=await D().actorResources(charId);
     const card=box(overrides,character.displayNick+' · '+(chosen.mode==='override'?'独立':'继承全局'));
     card.append(button(chosen.mode==='override'?'改为继承全局':'启用独立预设与世界书',async()=>{
       await D().setActorResources(charId,{mode:chosen.mode==='override'?'inherit':'override',presetIds:chosen.presetIds,worldbookIds:chosen.worldbookIds});await render();}));
     if(chosen.mode==='override'){
       for(const [kind,items,title] of [['presetIds',all.presets,'预设'],['worldbookIds',all.worldbooks,'世界书']]){
         card.append(dom('small','',title));for(const item of items.filter(x=>x.enabled!==false)){
           const label=dom('label','phone-check'),ck=dom('input');ck.type='checkbox';ck.checked=(chosen[kind]||[]).includes(item.id);
           ck.onchange=()=>safe(async()=>{const fresh=await D().actorResources(charId),ids=new Set(fresh[kind]);ck.checked?ids.add(item.id):ids.delete(item.id);
             await D().setActorResources(charId,{...fresh,[kind]:[...ids]});});label.append(ck,document.createTextNode(item.name));card.append(label);}}
     }
   }
   const memoryBox=box(main,'来源核验的手机记忆候选');memoryBox.append(dom('p','phone-helper','开启后，聊天原文会作为待审核候选记录在独立手机库，不自动把任何台词当事实注入模型，不调用额外 AI。'));memoryBox.append(button(prefs.autoMemoryCandidates?'自动候选已开启 · 点击关闭':'自动候选已关闭 · 点击开启',async()=>{await D().setSettings({autoMemoryCandidates:!prefs.autoMemoryCandidates});await render();}));
   const noticeBox=box(main,'手机通知 · 只显示主人收到的');
   for(const n of (await D().notices()).slice(0,30)){
     line(noticeBox,dom('small','',`${n.read?'已读':'未读'} · ${n.type}${n.sourceDeleted?' · 原评论已删除':n.sourceChanged?' · 原评论已修改':''} · ${new Date(n.createdAt).toLocaleString()}`),
       button('标记已读',async()=>{await D().readNotice(n.id);await render();}));
   }
   const backup=box(main,'手机本地数据备份');backup.append(button('导出完整手机归档',()=>MimaPhoneBackup.exportToFile(),'phone-primary'));backup.append(button('在空白手机库导入完整备份',async()=>{const picker=dom('input');picker.type='file';picker.accept='.json,application/json';picker.onchange=()=>safe(async()=>{if(!picker.files?.[0])return;const result=await MimaPhoneBackup.importFile(picker.files[0]);say('已核实恢复 '+JSON.stringify(result.counts));await render();});picker.click();}));backup.append(dom('p','phone-helper','手机数据单独保存在本浏览器，不与剧情共享。换设备或域名需要主动备份。'));
   main.append(dom('p','phone-helper','线下模式（从手机切换到剧情）暂不启用：不会擅自把手机聊天写进原剧情。'));
 }
 async function screenTasks(main){
   main.append(dom('h1','phone-page-heading','生成任务记录'));main.append(dom('p','phone-helper','关闭聊天中的错误提示不会清除原文。点击「回到聊天」可以检查、零 API 恢复或明确付费重试。'));
   const threads=await D().threads(),rows=(await D().generations()).filter(g=>['failed','unknown','cancelled','prepared'].includes(g.status)).sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||'')));
   if(!rows.length)main.append(dom('p','phone-empty','暂时没有待处理任务。'));
   for(const g of rows){const item=box(main,`${threads.find(t=>t.id===g.threadId)?.title||'聊天'} · ${g.status}`);item.append(dom('small','phone-helper',g.error||'生成未确认结束'));
     if(g.raw||g.rawDraft){const details=dom('details');details.append(dom('summary','','查看本机保存原文'),dom('pre','phone-raw',g.raw||g.rawDraft));item.append(details);}
     line(item,button('回到聊天',async()=>{await hideGeneration(g.id,false);await navigate('chat',g.threadId);},'phone-primary'),button('隐藏任务卡',async()=>{await hideGeneration(g.id,true);say('聊天提示已隐藏，记录仍保留。');}));
   }
 }
 async function screenMemory(main){const charId=state.memoryActorId;main.append(dom('h3','',R().getCharMask(charId).name+' · 独立手机记忆'));
   const planner=box(main,'按原文整理手机长期记忆');planner.append(dom('p','phone-helper','主人主动发起一次真实模型请求，覆盖所选会话内本角色有权查看的完整原文。结果先进入待审核，不会直接污染长期记忆或主剧情。')); 
   const tasks=(await S().all('drafts')).filter(x=>x.task==='phone_memory_summary'&&x.charId===charId).sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||'')));
   for(const job of tasks.slice(0,8)){
     const receipt=dom('details','phone-memory-receipt');receipt.append(dom('summary','',({prepared:'待核实（不自动重试）',cancelled:'已归档（原文保留）',failed:'生成失败',committed:'已整理为待审核候选'})[job.status]||job.status+' · '+job.startedAt));
     receipt.append(dom('small','phone-helper','任务 '+job.id+' · 来源 '+(job.sourceEventIds?.length||0)+' 条；'+(job.candidateIds?.length||0)+' 条候选 '+(job.error||'')));
     if(job.raw)receipt.append(dom('pre','phone-raw',job.raw));
     if(job.status==='prepared')receipt.append(button(state.activeGenerationControllers.has(job.id)?'停止本次整理（保留任务）':'归档未结算任务',async()=>{
       if(!confirm('停止或归档只更改本机状态；无法据此判断服务器是否已经计费。不会自动重试。确定？'))return;
       state.activeGenerationControllers.get(job.id)?.abort();await D().cancelMemorySummary(job.id);await render();
     }));
     planner.append(receipt);
   }
   planner.append(button('选择聊天并生成记忆摘要',async()=>{
     const choices=(await D().threads()).filter(t=>t.memberIds.includes(charId));
     const selected=await chooseMultiple('选择一段手机聊天',choices.map(t=>({id:t.id,label:t.title||t.id})));
     if(!selected.length)return;if(selected.length!==1)throw Error('一次只能总结一段会话');
     if(state.activeThreadRounds.has(selected[0]))throw Error('这段聊天正在生成，请完成后再整理');
     const settings=await D().settings();mustUser(settings);
     if(!confirm('将向手机模型发送角色可见的完整聊天原文进行记忆整理。这可能产生 API 费用，绝不自动重复请求。确认开始？'))return;
     const {job,rows}=await D().beginMemorySummary(selected[0],charId);
     const abort=new AbortController();state.activeGenerationControllers.set(job.id,abort);
     say('手机记忆请求已记录，正在整理 '+rows.length+' 条原文…');
     try{
       const mounts=await D().effectiveResources(charId,settings);
       const result=await MimaPhoneModel.summarizePhoneHistory({actorId:charId,userMaskId:settings.userMaskId,history:rows,presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,apiSettings:settings,signal:abort.signal});
       const done=await D().finishMemorySummary(job.id,result.entries,result.raw,result.model);
       say('已产生 '+done.candidateIds.length+' 条待审核记忆；审核后才会生效。');
     }catch(e){await D().failMemorySummary(job.id,e.message,e.raw||'');say('手机记忆请求未提交：'+e.message);}
     finally{state.activeGenerationControllers.delete(job.id);if(state.open&&state.screen==='memory'&&state.memoryActorId===charId)await render();}
   },'phone-primary'));

   const list=await D().allMemories(charId);for(const m of list){const panel=box(main,({'core':'长期核心','fact':'记住的事','rolling':'旧聊天提要','pinned':'手动固定'})[m.kind]||'记住的事');panel.classList.add('phone-memory-card');panel.append(dom('p','',m.content));panel.append(dom('small','',`来源：${m.sourceEventIds.join(', ')||'手动添加（需核验）'}`));if(m.status==='needs_review')panel.append(button('主人审核并启用此记忆',async()=>{await D().approveMemory(m.id);await render();},'phone-primary'));panel.append(button('授权给其他角色',async()=>{const list=(await D().contacts()).filter(c=>c.id!==charId);const ids=await chooseMultiple('选择记忆授权对象',list.map(x=>({id:x.id,label:x.displayNick})));for(const toId of ids)await D().grantMemory(m.id,toId);await render();}));
     const grants=(await S().all('memoryGrants')).filter(g=>g.memoryId===m.id&&g.enabled);
     for(const g of grants){panel.append(button('撤销给 '+((await D().contacts()).find(c=>c.id===g.toId)?.displayNick||g.toId)+' 的授权',async()=>{
       await D().revokeMemory(m.id,g.toId);await render();}));}
   }
   const area=input('记录需要记住的内容…','','textarea');const category=dom('select','phone-input');
   for(const [label,value] of [['记住的事','fact'],['长期核心','core'],['旧聊天提要','rolling'],['手动固定','pinned']]){const o=dom('option','',label);o.value=value;category.append(o);}
   line(main,category,area,button('送审并保存',async()=>{await D().addMemory(charId,area.value,[],'',undefined,category.value);await render();}));
 }
 window.MimaPhoneShell=Object.freeze({open,close,navigate,render});
})();
