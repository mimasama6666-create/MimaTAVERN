/* Phone OS. Every UI action invokes a real phone-domain command. */
(()=>{'use strict';
 const D=()=>MimaPhoneDomain,R=()=>MimaPhoneResources,S=()=>MimaPhoneStore;
 const state={intentKeys:new Map(),open:false,screen:'messages',threadId:null,momentId:null,loading:false,groupSending:false,sending:false,recording:null,urls:[],notice:'',replyToId:null,chatSearch:'',noticeTimer:null,profileBack:'contacts',contactId:null,maskCache:new Map()};
 const root=()=>document.getElementById('mima-phone-root');
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
 function syncViewport(){if(!state.open)return;const vv=window.visualViewport;
   if(vv&&vv.height>0)root().style.setProperty('--phone-visible-height',Math.floor(vv.height)+'px');
 }
 async function open(){if(state.open)return;await S().open();R().state();state.open=true;root().hidden=false;document.body.classList.add('mima-phone-active');
   syncViewport();window.visualViewport?.addEventListener('resize',syncViewport);window.addEventListener('resize',syncViewport);await render();}

 function close(){if(state.noticeTimer){clearTimeout(state.noticeTimer);state.noticeTimer=null;}state.notice='';if(state.recording){say('录音进行中，请先停止录音');return;}state.open=false;window.visualViewport?.removeEventListener('resize',syncViewport);window.removeEventListener('resize',syncViewport);root().style.removeProperty('--phone-visible-height');clearURLs();root().hidden=true;document.body.classList.remove('mima-phone-active');}
 function navigate(screen,detail=null){
   if(screen==='chat'&&state.threadId!==detail){state.replyToId=null;state.chatSearch='';}
   if(screen==='profile'){state.profileBack=state.screen;state.contactId=detail;}
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
   const h=dom('header','phone-header');const detail=['chat','moment','group-edit','memory','profile'].includes(state.screen);
   const back=()=>{if(state.screen==='profile')return navigate(state.profileBack==='contacts'?'contacts':'chat',state.threadId);
     if(state.screen==='group-edit')return navigate('chat',state.threadId);
     if(state.screen==='memory')return navigate('contacts');
     if(state.screen==='moment')return navigate('moments');
     if(state.screen==='chat')return navigate('messages');return close();};
   if(!detail){h.classList.add('phone-home-header');h.append(button('‹ 咪嘛馆',close,'phone-root-back'));container.append(h);return;}
   h.append(button('‹',back,'phone-back'));
   if(state.screen==='chat'){
     const row=await D().thread(state.threadId),people=await D().contacts();
     const person=row.kind==='private'?people.find(x=>x.id===row.memberIds[0]):null;
     h.append(face(row.kind==='private'?row.memberIds[0]:'group',person));
     const who=dom('div','phone-header-contact');who.append(dom('strong','phone-header-title',row.kind==='group'?row.title:person?.displayNick||row.memberIds[0]));
     who.append(dom('small','',row.kind==='group'?row.memberIds.length+' 位群成员':'手机聊天 · 独立会话'));h.append(who);
     h.append(button('•••',()=>navigate(row.kind==='group'?'group-edit':'profile',row.memberIds[0]),'phone-head-action'));
   }else{h.append(dom('strong','phone-header-title',title));
     if(detail)h.append(dom('span','phone-head-spacer'));
     else h.append(button('退出',close,'phone-exit'));
   }
   container.append(h);
 }
 async function render(){if(!state.open)return;clearURLs();const r=root();r.replaceChildren();
   const shell=dom('div','phone-shell'+(['chat','moment','group-edit','memory','profile'].includes(state.screen)?' phone-detail':'')+(state.screen==='chat'?' phone-is-chat':''));r.append(shell);
   const titles={messages:'消息',contacts:'通讯录',moments:'朋友圈',wallet:'钱包',settings:'我的',chat:'聊天',moment:'动态详情','group-edit':'群聊设置',memory:'手机记忆',profile:'联系人资料'};
   try{state.maskCache=new Map(R().state().masks.filter(m=>m.enabled!==false).map(m=>[m.id,m]));const prefs=await D().settings();const theme=['green','blue','graphite'].includes(prefs.chatBubbleTone)?prefs.chatBubbleTone:'green';r.dataset.bubbleTone=theme;await header(shell,titles[state.screen]||'小手机');
     const main=dom('main','phone-main'+(state.screen==='chat'?' phone-chat-screen':''));shell.append(main);
     try{switch(state.screen){case 'messages':await screenMessages(main);break;case 'contacts':await screenContacts(main);break;case 'chat':await screenChat(main);break;case 'profile':await screenProfile(main);break;case 'group-edit':await screenGroupEdit(main);break;case 'moments':await screenMoments(main);break;case 'moment':await screenMoment(main);break;case 'wallet':await screenWallet(main);break;case 'memory':await screenMemory(main);break;default:await screenSettings(main);}}
     catch(e){main.append(dom('div','phone-error','读取失败：'+e.message+'。没有以空数据覆盖存档。'));}
   }catch(e){const error=dom('div','phone-error','小手机界面加载失败：'+(e.message||String(e)));shell.append(error);shell.prepend(button('‹ 返回咪嘛馆',close));}
   decorateMenus(shell);const status=dom('div','phone-status',state.notice);status.id='phone-status';status.setAttribute('role','status');if(state.notice)status.classList.add('visible');shell.append(status);
   const tabs=dom('nav','phone-tabbar');tabs.setAttribute('aria-label','小手机导航');for(const [symbol,label,key] of [['◉','消息','messages'],['♧','通讯录','contacts'],['❀','朋友圈','moments'],['♡','钱包','wallet'],['⚙','我的','settings']]){
     const b=button('',()=>navigate(key),state.screen===key?'active':'');b.append(dom('span','phone-tab-icon',symbol),dom('span','phone-tab-label',label));if(state.screen===key)b.setAttribute('aria-current','page');tabs.append(b);
   }shell.append(tabs);
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
 async function createGroup(){const list=await D().contacts();if(list.length<2)throw Error('请先添加至少两个联系人');const selected=await chooseMultiple('选择群成员',list.map(c=>({id:c.id,label:c.displayNick})));if(selected.length<2)throw Error('群聊至少两个成员');const title=prompt('群名称','我的小群聊')||'我的小群聊';const row=await D().createConversation(selected,{kind:'group',title});navigate('chat',row.id);}
 async function chooseMultiple(title,options){return new Promise(resolve=>{const backdrop=dom('div','phone-modal-backdrop'),dialog=dom('div','phone-modal'),checks=[];dialog.append(dom('h3','',title));for(const item of options){const label=dom('label','phone-check'),ck=document.createElement('input');ck.type='checkbox';ck.value=item.id;label.append(ck,document.createTextNode(item.label));dialog.append(label);checks.push(ck);}
     line(dialog,button('取消',()=>{backdrop.remove();resolve([]);}),button('确定',()=>{const values=checks.filter(c=>c.checked).map(c=>c.value);backdrop.remove();resolve(values);},'phone-primary'));backdrop.append(dialog);root().append(backdrop);});}
 async function screenContacts(main){
   const existing=await D().contacts(),masks=R().listCharacterMasks(),settings=await D().settings();
   main.append(dom('h1','phone-page-heading','通讯录'));
   const search=input('搜索联系人');search.classList.add('phone-list-search');main.append(search);
   const list=dom('div','phone-contacts-list');main.append(list);
   for(const mask of masks){const present=existing.find(x=>x.maskId===mask.id);const card=dom('div','phone-contact-row');card.append(face(mask.id,present));
     const info=dom('div','phone-contact-info');info.append(dom('strong','',present?.displayNick||mask.name));info.append(dom('small','',present?(present.signature||'已添加 · 点击查看资料'):'未添加到小手机'));card.append(info);
     if(present){card.append(button('›',()=>navigate('profile',mask.id),'phone-chevron'));}
     else card.append(button('添加',async()=>{await D().addContact(mask.id);await render();},'phone-contact-add'));
     list.append(card);
   }
   if(!masks.length)main.append(dom('p','phone-empty','尚没有可用的 Char 面具，请先在咪嘛馆创建角色。'));
   if(!settings.userMaskId)main.append(button('选择 User 面具',()=>navigate('settings'),'phone-primary'));
   search.oninput=()=>{const key=search.value.trim().toLowerCase();for(const row of list.querySelectorAll('.phone-contact-row'))row.hidden=!row.textContent.toLowerCase().includes(key);};
 }
 async function screenProfile(main){
   const person=(await D().contacts()).find(x=>x.id===state.contactId);if(!person)throw Error('联系人不存在');
   const mask=R().getMask(person.maskId),prefs=await D().settings();main.classList.add('phone-profile-screen');
   const hero=dom('section','phone-profile-hero');hero.append(face(person.id,person,true),dom('h1','',person.displayNick));
   if(person.displayNick!==mask.name)hero.append(dom('small','','角色真名：'+mask.name));
   hero.append(dom('p','',person.signature||'还没有个性签名'));main.append(hero);
   const actions=dom('div','phone-profile-actions');actions.append(button('发消息',async()=>{const chat=await D().createConversation([person.id]);await navigate('chat',chat.id);},'phone-primary'));
   actions.append(button('手机记忆',()=>{state.threadId=person.id;return navigate('memory');}));main.append(actions);
   const details=box(main,'联系资料');details.append(dom('div','phone-setting-text','手机网名只影响小手机，不修改角色面具。'));
   line(details,button('修改网名',async()=>{const name=prompt('手机网名',person.displayNick);if(name===null)return;await D().updateContact(person.id,{displayNick:name||mask.name});await render();}),button('编辑备注与签名',async()=>{
     const remark=prompt('备注',person.remark||'');if(remark===null)return;const signature=prompt('个性签名',person.signature||'');if(signature===null)return;
     await D().updateContact(person.id,{remark,signature});await render();}));
   const palette=box(main,'我发送的消息气泡颜色');palette.append(dom('p','phone-setting-text','对方的气泡始终为浅灰色，此设置只改变自己的消息外观。'));tones(palette,prefs);
 }
 // All wallet and chat-card intents share an on-disk idempotency authority.
 async function issueIntent(kind,signature,perform){
   const slot=kind+':'+signature.split(':')[0],record=await D().walletIntent(slot,{signature});
   const result=await perform(record.commandId);
   await D().finishWalletIntent(slot,record.commandId,result);
   return result;
 }
 async function intentNewAction(slot){if(!confirm('开始一笔全新的独立操作？此前已提交的操作不会撤销。'))return;
   await D().resetWalletIntent(slot);await render();}
 async function walletAction(slot,payload,perform){
   const record=await D().walletIntent(slot,payload);
   const result=await perform(record.commandId);
   await D().finishWalletIntent(slot,record.commandId,result);
   say('交易已记录；重复点击不会重复扣款。若要再操作一次，请先点「开始新操作」。');await render();return result;
 }
 async function walletIntentControls(panel,slot){const current=await D().readWalletIntent(slot);
   if(current){panel.append(dom('small','phone-helper',current.status==='committed'?'此操作已结算，重复提交只会返回旧回执。':'存在待核验的操作，可用相同条件重试（不会重复结算）。'));
     panel.append(button('开始新操作',()=>intentNewAction(slot)));}
 }
 async function sendChatTransfer(thread){const contacts=await D().contacts(),actors=thread.memberIds.map(id=>({id,label:contacts.find(x=>x.id===id)?.displayNick||id}));
   const to=(await chooseMultiple('向哪位角色转虚拟 MIMA 币？',actors)).at(0);if(!to)return;
   const amountMinor=Number(prompt('虚拟转账金额（整数）','10'));
   if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw Error('请输入正整数虚拟币金额');
   if(!confirm('确认转给 '+to+' '+amountMinor+' 虚拟 MIMA 币？不会发生真实支付。'))return;
   await issueIntent('transfer-card',thread.id+':'+to+':'+amountMinor,key=>D().transferInThread(thread.id,D().owner,to,amountMinor,key));await render();}
 async function sendChatGift(thread){const owned=(await D().inventory(D().owner)).filter(x=>x.status==='owned');
   if(!owned.length)throw Error('还没有可赠送的礼物，请先到钱包礼物商店购买');
   const choice=await chooseMultiple('选择一件礼物',owned.map(x=>({id:x.id,label:D().catalog.find(i=>i.id===x.catalogId)?.name||x.catalogId})));
   if(choice.length!==1)throw Error('请只选择一件礼物');
   const to=(await chooseMultiple('选择收礼角色',thread.memberIds.map(id=>({id,label:id})))).at(0);if(!to)return;
   if(!confirm('确认向 '+to+' 赠送一件虚拟礼物？'))return;
   await issueIntent('gift-card',thread.id+':'+choice[0]+':'+to,key=>D().giftInThread(thread.id,choice[0],D().owner,to,key));await render();}
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
   const messages=await D().allMessages(thread.id),view=dom('div','phone-chat-history');main.append(view);
   let prevDay='';
   for(const msg of messages){
     const date=new Date(msg.createdAt).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
     if(date!==prevDay){view.append(dom('div','phone-day-divider',date));prevDay=date;}
     const isMine=msg.actorId===D().owner;
     const wrap=dom('div','phone-message '+(isMine?'mine':'theirs'));
     wrap.dataset.searchText=msg.content||'';
     if(!isMine)wrap.append(face(msg.actorId,contacts.find(x=>x.id===msg.actorId)));
     const content=dom('div','phone-message-content');
     if(thread.kind==='group'&&!isMine)content.append(dom('span','phone-message-sender',displayName(msg.actorId)));
     const bubble=dom('article','phone-bubble '+(isMine?'mine':'theirs'));
     if(msg.deliveryState==='deleted')bubble.classList.add('phone-deleted');
     if(msg.type==='voice_text')bubble.append(dom('small','phone-voice-label','◖)) 文字模拟语音'));
     if(msg.content)bubble.append(dom('div','phone-bubble-text',msg.content));
     for(const assetId of msg.assetIds||[]){
       try{const asset=await MimaPhoneMedia.load(assetId);
         if(asset.mime.startsWith('image/')){const im=dom('img','phone-bubble-media');im.src=photoURL(asset);im.alt=asset.name;
           im.onclick=()=>window.open(im.src,'_blank');bubble.append(im);
         }else if(asset.mime.startsWith('audio/')){const audio=dom('audio','phone-bubble-audio');audio.src=photoURL(asset);audio.controls=true;bubble.append(audio);}
       }catch(e){bubble.append(dom('small','phone-error','附件读取失败：'+e.message));}
     }
     if(msg.type==='gift_card'&&msg.orderId){const order=await S().read('orders',msg.orderId);bubble.append(dom('small','phone-voice-label','礼物状态：'+(order?.status||'无法核验')));}
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
   }
   search.oninput=()=>{state.chatSearch=search.value;const q=state.chatSearch.toLowerCase();for(const el of view.querySelectorAll('.phone-message'))el.hidden=!!q&&!el.dataset.searchText.toLowerCase().includes(q);};
   if(state.chatSearch)search.oninput();
   if(!settings.userMaskId)view.append(dom('p','phone-error','请先选择 User 面具，才能向角色请求回复。'));
   const incomplete=(await D().generations()).filter(g=>g.threadId===thread.id&&['prepared','failed','unknown'].includes(g.status));for(const f of incomplete){const panel=box(view,f.status==='failed'?'失败的手机生成 · 原文保留':'手机请求结果未核实');panel.append(dom('p','phone-error',f.status==='failed'?f.error:'网页刷新或离开前，请求没有留下可确认的最终回复；无法判断服务端是否已计费。不会自动重试。'));panel.append(button('免费核对本机提交状态',async()=>{const latest=await S().read('generations',f.id);say(latest?.status==='committed'?'本任务已提交，无需重新请求':'本机只有 '+(latest?.status||'缺失')+' 状态，没有服务端结果');await render();}));
     if(!state.groupSending&&f.status==='prepared')panel.append(button('确认重新请求（可能再次计费）',async()=>{if(!confirm('原任务最终结果未知。再次请求可能重复计费，但不会重复写入原用户消息。确定重新请求吗？'))return;await produceThreadReplies(thread.id,f.sourceId,[f.actorId],f.id);},'phone-primary'));
     if(f.raw&&f.status==='failed'){const details=dom('details');details.append(dom('summary','','查看模型原文'),dom('pre','phone-raw',f.raw));panel.append(details);panel.append(button('解析并恢复多条气泡（零 API）',async()=>{
       const parsed=MimaPhoneModel.bubbles(f.raw);if(!confirm('已经正确解析出 '+parsed.length+' 条气泡。确认将其加入当前聊天？'))return;
       await D().recoverGeneration(f.id,{mode:'parsed',attempt:f.attempt,sourceDigest:await D().promptDigest(f.actorId)});await render();},'phone-primary'));
       panel.append(button('主人自行编辑正文恢复',async()=>{
         const example=(()=>{try{return MimaPhoneModel.bubbles(f.raw).map(b=>b.content).join('\n');}catch(_){return '';}})();
         const revised=prompt('请手动输入要发布的正文（不填充坏 JSON）。模型原文仍单独保存供审计。',example);
         if(revised===null||!revised.trim())return;
         if(!confirm('确认以主人编辑的文字作为一条手机气泡？这不是模型原始完整输出，不调用 API。'))return;
         await D().recoverGeneration(f.id,{mode:'owner_text',text:revised,attempt:f.attempt,sourceDigest:await D().promptDigest(f.actorId)});await render();}));}}
   const composer=dom('form','phone-composer');
   if(state.replyToId){const quoted=dom('div','phone-reply-preview','正在引用自己的消息');
     quoted.append(button('×',()=>{state.replyToId=null;return render();},'phone-tiny'));composer.append(quoted);}
   const draft=await D().readDraft(thread.id),entry=dom('div','phone-composer-entry');
   const add=dom('details','phone-add-menu');add.append(dom('summary','','＋'));
   const attachments=dom('div','phone-add-actions');
   attachments.append(button('发送图片',()=>attachImage(thread.id)));
   attachments.append(button(state.recording?'停止录音':'录音',()=>recordAudio(thread.id)));
   attachments.append(button('文字语音',async()=>{const txt=prompt('输入要以模拟语音发送的话');if(txt?.trim()){
     const sent=await D().post(thread.id,{content:txt,type:'voice_text'});await render();if(settings.userMaskId)await produceThreadReplies(thread.id,sent.id);
   }}));
   attachments.append(button('虚拟转账',()=>sendChatTransfer(thread)));
   attachments.append(button('送礼物',()=>sendChatGift(thread)));
   add.append(attachments);entry.append(add);
   const textBox=input('发送消息…',draft?.content||'','textarea');textBox.rows=1;
   textBox.oninput=()=>safe(()=>D().saveDraft(thread.id,textBox.value));
   textBox.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();composer.requestSubmit();}});
   entry.append(textBox);
   const send=button('↑',()=>composer.requestSubmit(),'phone-send phone-primary');send.setAttribute('aria-label','发送');entry.append(send);
   composer.append(entry);
   composer.onsubmit=e=>{e.preventDefault();safe(async()=>{if(state.sending)return;const txt=textBox.value.trim();if(!txt)return;
     state.sending=true;send.disabled=true;try{const sent=await D().post(thread.id,{content:txt,replyToId:state.replyToId});
       state.replyToId=null;await D().saveDraft(thread.id,'');textBox.value='';await render();
       if(settings.userMaskId)await produceThreadReplies(thread.id,sent.id);
     }finally{state.sending=false;send.disabled=false;}});};
   main.append(composer);
   await walletIntentControls(view,'transfer-card:'+thread.id);await walletIntentControls(view,'gift-card:'+thread.id);
   // The scroll region is separate from the fixed composer. New replies appear above the keyboard.
   requestAnimationFrame(()=>{if(view.isConnected)view.scrollTop=view.scrollHeight;});
 }
 async function produceThreadReplies(threadId,sourceId,selected=null,retryGenId=null){if(state.groupSending)throw Error('当前小手机已有一轮群聊任务，请先等该轮完成');state.groupSending=true;try{const thread=await D().thread(threadId),prefs=await D().settings(),trigger=sourceId?(await S().read('messages',sourceId))?.content||'':'',speakers=await D().selectSpeakers(threadId,trigger,selected);
   mustUser(prefs);for(const actor of speakers){const current=await D().thread(threadId);if(!current.memberIds.includes(actor))break;
     const sourceDigest=await D().promptDigest(actor);
     const generated=retryGenId?await D().restartGeneration(retryGenId,sourceDigest):await D().prepareGeneration(threadId,actor,sourceId||'',{task:'chat',sourceDigest});const nick=(await D().contacts()).find(x=>x.id===actor)?.displayNick||actor;say('正在生成 '+nick+' 的手机回复…');let returned=null,canonicalDone=false;
     try{const all=await D().history(threadId),membership=await S().read('memberships',threadId+':'+actor),start=membership?.joinedAtSeq||0;
       const visible=all.filter(m=>m.seq>=start&&m.deliveryState==='committed');
       const people=await D().contacts(),speakerNames=Object.fromEntries(people.map(c=>[c.id,c.displayNick]));
       const extraMemories=await D().memories(actor);const extra=extraMemories.map(m=>'已授权的手机记忆（'+m.id+'）：'+m.content).join('\n');
       const mounts=await D().effectiveResources(actor,prefs);
       const source=all.find(m=>m.id===sourceId)||all.at(-1),parts=source?.assetIds?.length?await MimaPhoneMedia.visionParts(source.assetIds.filter(Boolean)):[];
       returned=await MimaPhoneModel.generate({actorId:actor,userMaskId:prefs.userMaskId,history:visible,presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,scope:thread.kind,extra,visionParts:parts,speakerNames});
       await D().finishGeneration(generated.id,returned.bubbles,returned.raw,generated.attempt,await D().promptDigest(actor));canonicalDone=true;say(nick+' 的回复已保存');
       try{await render();}catch(paintError){console.error('手机回复已保存，但界面重绘失败；无需重复付费生成',{generationId:generated.id,error:paintError});say('手机回复已保存。界面显示未更新，请重新打开聊天。');}
       if(retryGenId)break;
     }catch(e){if(canonicalDone){console.error('手机回复已结算，后续非关键任务失败',{generationId:generated.id,error:e});say('回复已经保存，后续界面任务失败；不要重发');break;}
       const raw=typeof e.raw==='string'?e.raw:returned?.raw||'';try{await D().failGeneration(generated.id,e.message,raw,generated.attempt);}catch(settleError){
         console.warn('旧 attempt 或已结算任务的失败回调被拒绝，保留当前状态',{generationId:generated.id,attempt:generated.attempt,error:settleError});}
       say('角色回复未提交：'+e.message);await render();break;}
   }
   }finally{state.groupSending=false;}}
 function mustUser(prefs){if(!prefs.userMaskId)throw Error('先在「我的手机」选择 User 面具');}
 async function attachImage(threadId){const picker=dom('input');picker.type='file';picker.accept='image/*';picker.onchange=()=>safe(async()=>{const file=picker.files?.[0];if(!file)return;const asset=await MimaPhoneMedia.save(file);const sent=await D().post(threadId,{type:'image',content:'[发送了一张图片]',assetIds:[asset.id]});await render();const prefs=await D().settings();if(prefs.userMaskId)await produceThreadReplies(threadId,sent.id);});picker.click();}
 async function recordAudio(threadId){if(state.recording){const recorder=state.recording;state.recording=null;const result=await recorder.stop(),saved=await MimaPhoneMedia.save(result.blob);const sent=await D().post(threadId,{type:'voice_audio',content:result.transcript?'[录音转写] '+result.transcript:'[语音录音，未取得可靠转写]',assetIds:[saved.id]});await render();const prefs=await D().settings();if(prefs.userMaskId&&result.transcript)await produceThreadReplies(threadId,sent.id);return;}
   if(!confirm('麦克风录音会保存在本机小手机数据库。若浏览器支持语音识别，浏览器服务可能将语音传送至识别提供方。确认开启吗？'))return;state.recording=await MimaPhoneMedia.recordAndTranscribe({onTranscript:x=>say('转写：'+x),onStatus:say});say('正在录音，点击「录音」按钮结束并保存');}
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
       feed:gen.feedSnapshot,memories:gen.memorySnapshot||[],presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,mode:kind});
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
     const extra=kind==='moment'?'请以角色本人名义写一条朋友圈动态，不引用任何未授权私聊。':'请根据可见动态及评论自然回应，不要捏造未见资料。';
     reply=await MimaPhoneModel.generate({actorId,userMaskId:prefs.userMaskId,history,presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,task:kind,scope:m?.audience||'public',extra});
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
   const people=[{id:D().owner,displayNick:'主人'},...(await D().contacts())],wallet=box(main,'虚拟钱包');for(const p of people)wallet.append(dom('div','phone-wallet-row',`${p.displayNick}：${await D().balance(p.id)} MIMA`));
   const mintOwner=dom('select','phone-input');for(const p of people){const opt=dom('option','',p.displayNick);opt.value=p.id;mintOwner.append(opt);}const amount=input('发行金额','100');amount.type='number';amount.min=1;line(wallet,mintOwner,amount,button('发放虚拟币',async()=>{if(!confirm('向此模拟角色发行虚拟 MIMA 币？'))return;await walletAction('mint',{actorId:mintOwner.value,amount:Number(amount.value)},key=>D().issue(mintOwner.value,Number(amount.value),key));}));
   await walletIntentControls(wallet,'mint');const transfer=box(main,'虚拟转账');const from=dom('select','phone-input'),to=dom('select','phone-input');for(const person of people)for(const sel of [from,to]){const opt=dom('option','',person.displayNick);opt.value=person.id;sel.append(opt);}if(people.length>1)to.selectedIndex=1;const sum=input('金额','10');sum.type='number';sum.min=1;line(transfer,from,to,sum,button('确认转账',async()=>{if(!confirm('确认仅转账虚拟 MIMA 余额？'))return;await walletAction('transfer',{from:from.value,to:to.value,amount:Number(sum.value)},key=>D().transfer(from.value,to.value,Number(sum.value),key));},'phone-primary'));
   await walletIntentControls(transfer,'transfer');const gifts=box(main,'礼物商店');for(const item of D().catalog){line(gifts,dom('span','',`${item.emoji} ${item.name} · ${item.price} 币`),button('购买',async()=>{await walletAction('buy:'+item.id,{actorId:D().owner,catalogId:item.id},key=>D().buyGift(D().owner,item.id,key));}));}
   for(const item of D().catalog)await walletIntentControls(gifts,'buy:'+item.id);const belongings=box(main,'我的礼物');for(const item of await D().inventory(D().owner)){const label=D().catalog.find(c=>c.id===item.catalogId);line(belongings,dom('span','',`${label?.emoji||'🎁'} ${label?.name||item.catalogId} · ${item.status}`),button('赠送角色',async()=>{const choices=await chooseMultiple('选择收礼角色',people.filter(x=>x.id!==D().owner).map(p=>({id:p.id,label:p.displayNick})));if(choices.length!==1)throw Error('一件礼物只能赠给一位角色');await walletAction('gift:'+item.id,{itemId:item.id,from:D().owner,to:choices[0]},key=>D().giftItem(item.id,D().owner,choices[0],key));}));}
   for(const item of await D().inventory(D().owner))await walletIntentControls(belongings,'gift:'+item.id);const pending=(await D().orders()).filter(x=>x.status==='SENT_PENDING');const orders=box(main,'待领取礼物');for(const o of pending){line(orders,dom('span','',`${o.senderId} → ${o.recipientId}`),button('收下',async()=>{await D().settleGift(o.id,o.recipientId,true);await render();}),button('拒绝退回',async()=>{await D().settleGift(o.id,o.recipientId,false);await render();}));}
   const journal=box(main,'交易账本');for(const entry of (await D().ledger()).slice(-24).reverse())journal.append(dom('small','phone-ledger-row',`${entry.type} · ${entry.walletId}: ${entry.deltaMinor>=0?'+':''}${entry.deltaMinor}`));
 }
 async function screenSettings(main){main.append(dom('h1','phone-page-heading','我的手机'));const prefs=await D().settings(),users=R().listUserMasks(),all=R().state();const settings=box(main,'身份与资料');const select=dom('select','phone-input');for(const u of users){const opt=dom('option','',u.name);opt.value=u.id;opt.selected=prefs.userMaskId===u.id;select.append(opt);}line(settings,select,button('使用这个 User 面具',async()=>{await D().setSettings({userMaskId:select.value});await render();},'phone-primary'));
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
 async function screenMemory(main){const charId=state.threadId;main.append(dom('h3','',R().getCharMask(charId).name+' · 独立手机记忆'));
   const list=await D().allMemories(charId);for(const m of list){const panel=box(main,m.verified?'来源已关联':'待核验');panel.append(dom('p','',m.content));panel.append(dom('small','',`来源：${m.sourceEventIds.join(', ')||'手动添加（需核验）'}`));if(m.status==='needs_review')panel.append(button('主人审核并启用此记忆',async()=>{await D().approveMemory(m.id);await render();},'phone-primary'));panel.append(button('授权给其他角色',async()=>{const list=(await D().contacts()).filter(c=>c.id!==charId);const ids=await chooseMultiple('选择记忆授权对象',list.map(x=>({id:x.id,label:x.displayNick})));for(const toId of ids)await D().grantMemory(m.id,toId);await render();}));
     const grants=(await S().all('memoryGrants')).filter(g=>g.memoryId===m.id&&g.enabled);
     for(const g of grants){panel.append(button('撤销给 '+((await D().contacts()).find(c=>c.id===g.toId)?.displayNick||g.toId)+' 的授权',async()=>{
       await D().revokeMemory(m.id,g.toId);await render();}));}
   }
   const area=input('手动输入角色记忆…','','textarea');line(main,area,button('存入待核验记忆',async()=>{await D().addMemory(charId,area.value);await render();}));
 }
 window.MimaPhoneShell=Object.freeze({open,close,navigate,render});
})();
