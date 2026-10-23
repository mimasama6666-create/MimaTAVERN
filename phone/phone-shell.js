/* Phone OS. Every UI action invokes a real phone-domain command. */
(()=>{'use strict';
 const D=()=>MimaPhoneDomain,R=()=>MimaPhoneResources,S=()=>MimaPhoneStore;
 const state={intentKeys:new Map(),open:false,screen:'messages',threadId:null,momentId:null,loading:false,groupSending:false,sending:false,recording:null,urls:[],notice:'',replyToId:null,chatSearch:''};
 const root=()=>document.getElementById('mima-phone-root');
 const dom=(name,cls='',text='')=>{const node=document.createElement(name);if(cls)node.className=cls;if(text!==undefined&&text!=='')node.textContent=String(text);return node;};
 const button=(label,handler,cls='')=>{const b=dom('button','phone-btn '+cls,label);b.type='button';b.onclick=()=>safe(handler);return b;};
 const input=(placeholder,value='',tag='input')=>{const x=dom(tag,'phone-input');x.placeholder=placeholder;if(tag==='input')x.type='text';x.value=value;return x;};
 const line=(p,...nodes)=>{const r=dom('div','phone-line');nodes.forEach(n=>r.append(n));p.append(r);return r;};
 const box=(p,title)=>{const c=dom('section','phone-card');if(title)c.append(dom('h3','',title));p.append(c);return c;};
 function clearURLs(){for(const url of state.urls)URL.revokeObjectURL(url);state.urls=[];}
 function photoURL(asset){const u=URL.createObjectURL(asset.blob);state.urls.push(u);return u;}
 function say(message){state.notice=String(message);const area=document.getElementById('phone-status');if(area){area.textContent=state.notice;area.classList.add('visible');}}
 async function safe(fn){try{const result=await fn();return result;}catch(e){console.error('[Mima Phone] 未完成操作（canonical 状态未伪装成功）',e);say(e?.message||String(e));}}
 async function open(){if(state.open)return;await S().open();R().state();state.open=true;root().hidden=false;document.body.classList.add('mima-phone-active');await render();}
 function close(){if(state.recording){say('录音进行中，请先停止录音');return;}state.open=false;clearURLs();root().hidden=true;document.body.classList.remove('mima-phone-active');}
 function navigate(screen,detail=null){if(screen==='chat'&&state.threadId!==detail){state.replyToId=null;state.chatSearch='';}state.screen=screen;if(screen==='chat')state.threadId=detail;if(screen==='moment')state.momentId=detail;return render();}
 function header(container,title){const h=dom('header','phone-header');h.append(button('‹',()=>state.screen==='chat'||state.screen==='group-edit'||state.screen==='moment'?navigate('messages'):close(),'phone-back'),dom('strong','phone-header-title',title),button('返回咪嘛馆',close,'phone-exit'));container.append(h);}
 async function render(){if(!state.open)return;clearURLs();const r=root();r.replaceChildren();const shell=dom('div','phone-shell');r.append(shell);
   const titles={messages:'消息',contacts:'通讯录',moments:'朋友圈',wallet:'钱包与礼物',settings:'我的手机',chat:'聊天',moment:'动态详情','group-edit':'群聊设置',memory:'手机记忆'};
   header(shell,titles[state.screen]||'小手机');const main=dom('main','phone-main');shell.append(main);
   try{switch(state.screen){case 'messages':await screenMessages(main);break;case 'contacts':await screenContacts(main);break;case 'chat':await screenChat(main);break;case 'group-edit':await screenGroupEdit(main);break;case 'moments':await screenMoments(main);break;case 'moment':await screenMoment(main);break;case 'wallet':await screenWallet(main);break;case 'memory':await screenMemory(main);break;default:await screenSettings(main);}}
   catch(e){main.append(dom('div','phone-error','读取失败：'+e.message+'。没有以空数据覆盖存档。'));}
   const status=dom('div','phone-status',state.notice);status.id='phone-status';if(state.notice)status.classList.add('visible');shell.append(status);
   const tabs=dom('nav','phone-tabbar');for(const [label,k] of [['💬 消息','messages'],['👥 通讯录','contacts'],['🌸 朋友圈','moments'],['💝 钱包','wallet'],['⚙️ 我的','settings']]){const b=button(label,()=>navigate(k),state.screen===k?'active':'');tabs.append(b);}shell.append(tabs);
 }
 async function screenMessages(main){const settings=await D().settings();if(!settings.userMaskId){box(main,'第一次打开小手机').append(dom('p','','请先去「我的手机」选择 User 面具，然后从通讯录导入角色。'));main.append(button('选择 User 面具',()=>navigate('settings'),'phone-primary'));}
   line(main,button('＋ 新建群聊',createGroup,'phone-primary'),button('导入联系人',()=>navigate('contacts')));
   const items=await D().threads();if(!items.length)main.append(dom('div','phone-empty','还没有手机聊天，去通讯录添加角色开始私聊。'));
   for(const row of items){const contacts=await D().contacts();const title=row.kind==='private'?(contacts.find(c=>c.id===row.memberIds[0])?.displayNick||row.memberIds[0]):row.title;
     const last=(await D().history(row.id)).at(-1);const card=box(main,'');card.classList.add('phone-list-card');card.append(dom('b','',`${row.kind==='group'?'👥':'💬'} ${title}`));card.append(dom('small','',last?last.content.slice(0,90):'点击开始聊天'));card.onclick=()=>safe(()=>navigate('chat',row.id));}
 }
 async function createGroup(){const list=await D().contacts();if(list.length<2)throw Error('请先添加至少两个联系人');const selected=await chooseMultiple('选择群成员',list.map(c=>({id:c.id,label:c.displayNick})));if(selected.length<2)throw Error('群聊至少两个成员');const title=prompt('群名称','我的小群聊')||'我的小群聊';const row=await D().createConversation(selected,{kind:'group',title});navigate('chat',row.id);}
 async function chooseMultiple(title,options){return new Promise(resolve=>{const backdrop=dom('div','phone-modal-backdrop'),dialog=dom('div','phone-modal'),checks=[];dialog.append(dom('h3','',title));for(const item of options){const label=dom('label','phone-check'),ck=document.createElement('input');ck.type='checkbox';ck.value=item.id;label.append(ck,document.createTextNode(item.label));dialog.append(label);checks.push(ck);}
     line(dialog,button('取消',()=>{backdrop.remove();resolve([]);}),button('确定',()=>{const values=checks.filter(c=>c.checked).map(c=>c.value);backdrop.remove();resolve(values);},'phone-primary'));backdrop.append(dialog);root().append(backdrop);});}
 async function screenContacts(main){const existing=await D().contacts(),masks=R().listCharacterMasks();const settings=await D().settings();main.append(dom('p','phone-helper',`已添加 ${existing.length} 位联系人。网名只修改手机显示，不会修改角色真名或面具。`));
   for(const mask of masks){const present=existing.find(x=>x.maskId===mask.id),card=box(main,'');card.classList.add('phone-person');const info=dom('div','phone-person-name');info.append(dom('b','',present?.displayNick||mask.name),dom('small','',`角色真名：${mask.name}`));card.append(info);
     if(present){line(card,button('私聊',async()=>{const row=await D().createConversation([mask.id]);await navigate('chat',row.id);},'phone-primary'),button('改网名',async()=>{const value=prompt('手机网名',present.displayNick);if(value===null)return;await D().updateContact(mask.id,{displayNick:value||mask.name});await render();}),button('手机记忆',()=>{state.threadId=mask.id;navigate('memory');}),button('资料',async()=>{const remark=prompt('备注（不会改变角色真名）',present.remark||'');if(remark===null)return;const signature=prompt('签名',present.signature||'');if(signature===null)return;await D().updateContact(mask.id,{remark,signature});await render();}));}
     else card.append(button('＋ 添加联系人',async()=>{await D().addContact(mask.id);await render();}));
   }
   if(!masks.length)main.append(dom('p','phone-empty','当前咪嘛馆没有可用 Char 面具。请先到咪嘛馆角色管理中创建。'));
   if(!settings.userMaskId)main.append(button('还没有选 User 面具，去设置',()=>navigate('settings')));
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
 async function screenChat(main){const thread=await D().thread(state.threadId),settings=await D().settings();const contacts=await D().contacts();const displayName=id=>id===D().owner?'主人':contacts.find(c=>c.id===id)?.displayNick||id;
   main.append(dom('div','phone-thread-title',thread.kind==='group'?thread.title:displayName(thread.memberIds[0])));
   if(thread.kind==='group')line(main,button('群设置',()=>navigate('group-edit')),button('让指定角色发言',async()=>{const names=thread.memberIds.map(id=>({id,label:displayName(id)}));const selected=await chooseMultiple('选择发言角色',names);if(selected.length)await produceThreadReplies(thread.id,null,selected);},'phone-primary'));
   const search=input('搜索当前会话已保存的原文…',state.chatSearch);search.oninput=()=>{state.chatSearch=search.value;for(const entry of main.querySelectorAll('.phone-bubble'))entry.hidden=!entry.textContent.includes(state.chatSearch);};main.append(search);
   const messages=await D().allMessages(thread.id),view=dom('div','phone-chat-history');main.append(view);
   for(const msg of messages){const bubble=dom('article','phone-bubble '+(msg.actorId===D().owner?'mine':'theirs'));bubble.hidden=!bubble.textContent.includes(state.chatSearch)&&!!state.chatSearch; if(msg.deliveryState==='deleted')bubble.classList.add('phone-deleted');bubble.append(dom('span','phone-bubble-name',displayName(msg.actorId)));if(msg.type==='voice_text')bubble.append(dom('small','phone-helper','🔊 文字模拟语音（没有真实音频）'));if(msg.content)bubble.append(dom('div','phone-bubble-text',msg.content));
      for(const assetId of msg.assetIds||[]){try{const asset=await MimaPhoneMedia.load(assetId);if(asset.mime.startsWith('image/')){const im=dom('img','phone-bubble-media');im.src=photoURL(asset);im.alt=asset.name;im.onclick=()=>window.open(im.src,'_blank');bubble.append(im);}else if(asset.mime.startsWith('audio/')){const audio=dom('audio','phone-bubble-audio');audio.src=photoURL(asset);audio.controls=true;bubble.append(audio);}}
      catch(e){bubble.append(dom('small','phone-error','附件无法读取：'+e.message));}}
      if(msg.type==='gift_card'&&msg.orderId){const order=await S().read('orders',msg.orderId);bubble.append(dom('small','phone-helper','礼物状态：'+(order?.status||'无法核验')));}
      bubble.append(dom('time','phone-bubble-time',new Date(msg.createdAt).toLocaleTimeString()));
      line(bubble,button('复制',()=>navigator.clipboard?.writeText(msg.content).catch(()=>prompt('复制消息文本',msg.content)),'phone-tiny'),button('引用',async()=>{state.replyToId=msg.id;await render();},'phone-tiny'));
      if(msg.actorId===D().owner){if(msg.deliveryState==='deleted')bubble.append(button('撤销删除',async()=>{await D().restoreMessage(msg.id);await render();},'phone-tiny'));else line(bubble,button('编辑',async()=>{const txt=prompt('编辑你的消息',msg.content);if(txt!==null){await D().editMessage(msg.id,txt);await render();}},'phone-tiny'),button('撤回',async()=>{if(confirm('撤回这条手机消息？原文进入版本历史。')){await D().editMessage(msg.id,msg.content,true);await render();}},'phone-tiny'));}
      if(msg.versions?.length){const versions=dom('details','phone-versions');versions.append(dom('summary','','查看历史版本'));for(const v of msg.versions)versions.append(dom('pre','phone-raw',v.content));bubble.append(versions);}
      bubble.hidden=!!state.chatSearch&&!bubble.textContent.includes(state.chatSearch);view.append(bubble);}
   if(!settings.userMaskId)main.append(dom('p','phone-error','请先选择 User 面具，才能向角色请求回复。'));
   const incomplete=(await D().generations()).filter(g=>g.threadId===thread.id&&['prepared','failed','unknown'].includes(g.status));for(const f of incomplete){const panel=box(main,f.status==='failed'?'失败的手机生成 · 原文保留':'手机请求结果未核实');panel.append(dom('p','phone-error',f.status==='failed'?f.error:'网页刷新或离开前，请求没有留下可确认的最终回复；无法判断服务端是否已计费。不会自动重试。'));panel.append(button('免费核对本机提交状态',async()=>{const latest=await S().read('generations',f.id);say(latest?.status==='committed'?'本任务已提交，无需重新请求':'本机只有 '+(latest?.status||'缺失')+' 状态，没有服务端结果');await render();}));
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
   const composer=dom('form','phone-composer');if(state.replyToId)composer.append(dom('small','','引用消息 ID：'+state.replyToId));composer.onsubmit=e=>{e.preventDefault();safe(async()=>{if(state.sending)return;const txt=textBox.value.trim();if(!txt)return;state.sending=true;try{const sent=await D().post(thread.id,{content:txt,replyToId:state.replyToId});state.replyToId=null;await D().saveDraft(thread.id,'');textBox.value='';await render();if(settings.userMaskId)await produceThreadReplies(thread.id,sent.id);}finally{state.sending=false;}});};const draft=await D().readDraft(thread.id);const textBox=input('发送消息给角色…',draft?.content||'','textarea');textBox.rows=2;textBox.oninput=()=>safe(()=>D().saveDraft(thread.id,textBox.value));
   line(composer,textBox,button('发送',()=>composer.requestSubmit(),'phone-primary'));
   line(composer,button('💸 转账',()=>sendChatTransfer(thread)),button('🎁 送礼',()=>sendChatGift(thread)));
   line(composer,button('📷 图片',()=>attachImage(thread.id)),button('🎙 录音',()=>recordAudio(thread.id)),button('🔊 文字语音',async()=>{const txt=prompt('输入要以模拟语音发送的话');if(txt?.trim()){const sent=await D().post(thread.id,{content:txt,type:'voice_text'});await render();if(settings.userMaskId)await produceThreadReplies(thread.id,sent.id);}}));main.append(composer);await walletIntentControls(main,'transfer-card:'+thread.id);await walletIntentControls(main,'gift-card:'+thread.id);
 }
 async function produceThreadReplies(threadId,sourceId,selected=null,retryGenId=null){if(state.groupSending)throw Error('当前小手机已有一轮群聊任务，请先等该轮完成');state.groupSending=true;try{const thread=await D().thread(threadId),prefs=await D().settings(),trigger=sourceId?(await S().read('messages',sourceId))?.content||'':'',speakers=await D().selectSpeakers(threadId,trigger,selected);
   mustUser(prefs);for(const actor of speakers){const current=await D().thread(threadId);if(!current.memberIds.includes(actor))break;
     const sourceDigest=await D().promptDigest(actor);
     const generated=retryGenId?await D().restartGeneration(retryGenId,sourceDigest):await D().prepareGeneration(threadId,actor,sourceId||'',{task:'chat',sourceDigest});say('正在生成 '+actor+' 的手机回复…');let returned=null,canonicalDone=false;
     try{const all=await D().history(threadId),membership=await S().read('memberships',threadId+':'+actor),start=membership?.joinedAtSeq||0;
       const visible=all.filter(m=>m.seq>=start&&m.deliveryState==='committed');
       const people=await D().contacts(),speakerNames=Object.fromEntries(people.map(c=>[c.id,c.displayNick]));
       const extraMemories=await D().memories(actor);const extra=extraMemories.map(m=>'已授权的手机记忆（'+m.id+'）：'+m.content).join('\n');
       const mounts=await D().effectiveResources(actor,prefs);
       const source=all.find(m=>m.id===sourceId)||all.at(-1),parts=source?.assetIds?.length?await MimaPhoneMedia.visionParts(source.assetIds.filter(Boolean)):[];
       returned=await MimaPhoneModel.generate({actorId:actor,userMaskId:prefs.userMaskId,history:visible,presetIds:mounts.presetIds,worldbookIds:mounts.worldbookIds,scope:thread.kind,extra,visionParts:parts,speakerNames});
       await D().finishGeneration(generated.id,returned.bubbles,returned.raw,generated.attempt,await D().promptDigest(actor));canonicalDone=true;
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
 async function screenMoments(main){const prefs=await D().settings();const c=box(main,'发朋友圈');const field=input('分享今天发生的事…','','textarea');field.rows=3;const momentAssets=[];const mediaLine=dom('div','phone-line');const mediaSummary=dom('small','','尚未附图');mediaLine.append(button('选择多张原图',async()=>{const filePicker=dom('input');filePicker.type='file';filePicker.accept='image/*';filePicker.multiple=true;filePicker.onchange=()=>safe(async()=>{for(const file of filePicker.files||[]){const saved=await MimaPhoneMedia.save(file);momentAssets.push(saved.id);}mediaSummary.textContent='已保存原图：'+momentAssets.length+' 张';});filePicker.click();}),mediaSummary);c.append(mediaLine);const visibility=dom('select','phone-input');for(const [label,val] of [['公开给联系人','public'],['指定好友可见','friends'],['仅自己可见','private']]){const o=dom('option','',label);o.value=val;visibility.append(o);}c.append(field);line(c,visibility,button('发布',async()=>{let audienceIds=[];if(visibility.value==='friends'){const people=await D().contacts();audienceIds=await chooseMultiple('允许哪些联系人看到这条动态？',people.map(x=>({id:x.id,label:x.displayNick})));if(!audienceIds.length)throw Error('好友可见动态必须选至少一名联系人');}await D().createMoment({body:field.value,audience:visibility.value,audienceIds,assetIds:momentAssets});await render();},'phone-primary'));
   const list=await D().contacts();line(main,
     button('让角色发朋友圈（可以同时互动）',async()=>{const choices=await chooseMultiple('选择本次手动发朋友圈的角色',list.map(x=>({id:x.id,label:x.displayNick})));
       for(const actorId of choices)await socialGenerate('moment',actorId);await render();},'phone-primary'),
     button('让角色逛朋友圈（不发动态）',async()=>{const choices=await chooseMultiple('选择本次浏览朋友圈的角色',list.map(x=>({id:x.id,label:x.displayNick})));
       for(const actorId of choices)await socialGenerate('browse',actorId);await render();}));
   main.append(dom('p','phone-helper','只有主人点击才启动这次角色社交；角色在本回合可选择点赞、评论和回复，确认后一次落库。绝不后台自动找其它角色聊天。'));
   await socialPendingUI(main);const feed=await D().moments();for(const m of feed){const card=box(main,m.authorId===D().owner?'主人':list.find(c=>c.id===m.authorId)?.displayNick||m.authorId);card.append(dom('p','phone-post',m.body),dom('small','',new Date(m.createdAt).toLocaleString()));
     for(const assetId of m.assetIds||[]){try{const asset=await MimaPhoneMedia.load(assetId);const im=dom('img','phone-bubble-media');im.alt=asset.name;im.src=photoURL(asset);card.append(im);}catch(e){card.append(dom('small','phone-error','动态图片读取失败：'+e.message));}}
     if(m.authorId===D().owner)line(card,button('编辑动态',async()=>{const next=prompt('编辑动态',m.body);if(next!==null){await D().editMoment(m.id,D().owner,next);await render();}}),button('删除动态',async()=>{if(confirm('删除这条动态？其他人的评论将随动态不可见。')){await D().editMoment(m.id,D().owner,'',true);await render();}}));
     const count=(await D().reactions(m.id)).length;line(card,button('♡ '+count,async()=>{await D().react(m.id,D().owner);await render();}),button('查看评论',()=>navigate('moment',m.id),'phone-primary'));}}
 async function screenMoment(main){await socialPendingUI(main);const m=await S().read('moments',state.momentId),prefs=await D().settings();if(!m)throw Error('动态已不存在');box(main,'动态正文').append(dom('p','phone-post',m.body));
   const comments=await D().comments(m.id),contacts=await D().contacts();for(const entry of comments){const c=box(main,(entry.actorId===D().owner?'主人':contacts.find(x=>x.id===entry.actorId)?.displayNick||entry.actorId)+'：');c.append(dom('p','',entry.body));c.append(button('回复',async()=>{const text=prompt('回复评论');if(!text?.trim())return;await D().comment(m.id,D().owner,text,entry.id);await render();}));
     if(entry.actorId===D().owner){
       c.append(button('编辑我的评论',async()=>{const edited=prompt('修改评论',entry.body);if(edited===null||edited===entry.body)return;
         await D().editComment(entry.id,D().owner,edited);await render();}));
       c.append(button('删除我的评论',async()=>{if(!confirm('删除评论及其下属回复？关联的手机记忆将重新待审。'))return;
         await D().deleteComment(entry.id,D().owner);await render();}));
     }
     c.append(button('让角色回复此评论',async()=>{const selected=await chooseMultiple('选择回复这条评论的角色',contacts.filter(x=>D().acl(m,x.id)).map(x=>({id:x.id,label:x.displayNick})));for(const actorId of selected)await socialGenerate('moment_comment',actorId,m.id,entry.id);await render();}));}
   const field=input('写评论…','','textarea');line(main,field,button('发布评论',async()=>{await D().comment(m.id,D().owner,field.value);await render();},'phone-primary'));
   main.append(button('让有权查看的角色点赞/取消赞',async()=>{const actors=contacts.filter(c=>D().acl(m,c.id));const selected=await chooseMultiple('选择执行点赞或取消赞的角色',actors.map(x=>({id:x.id,label:x.displayNick})));for(const actorId of selected)await D().react(m.id,actorId);await render();}));
   main.append(button('邀请角色参与评论',async()=>{mustUser(prefs);const people=contacts.filter(c=>D().acl(m,c.id));const chosen=await chooseMultiple('邀请评论的角色',people.map(c=>({id:c.id,label:c.displayNick})));
     for(const actorId of chosen){const history=[{actorId:D().owner,content:'可见动态：'+m.body},...(await D().comments(m.id)).map(x=>({actorId:x.actorId,content:'评论：'+x.body}))];
       await socialGenerate('moment_comment',actorId,m.id);
     }await render();},'phone-primary'));
 }
 async function screenWallet(main){main.append(dom('p','phone-helper','本页面只有虚拟 MIMA 币和虚拟礼物，不涉及任何真实支付。所有交易均在手机数据库内记账。'));
   const people=[{id:D().owner,displayNick:'主人'},...(await D().contacts())],wallet=box(main,'虚拟钱包');for(const p of people)wallet.append(dom('div','phone-wallet-row',`${p.displayNick}：${await D().balance(p.id)} MIMA`));
   const mintOwner=dom('select','phone-input');for(const p of people){const opt=dom('option','',p.displayNick);opt.value=p.id;mintOwner.append(opt);}const amount=input('发行金额','100');amount.type='number';amount.min=1;line(wallet,mintOwner,amount,button('发放虚拟币',async()=>{if(!confirm('向此模拟角色发行虚拟 MIMA 币？'))return;await walletAction('mint',{actorId:mintOwner.value,amount:Number(amount.value)},key=>D().issue(mintOwner.value,Number(amount.value),key));}));
   await walletIntentControls(wallet,'mint');const transfer=box(main,'虚拟转账');const from=dom('select','phone-input'),to=dom('select','phone-input');for(const person of people)for(const sel of [from,to]){const opt=dom('option','',person.displayNick);opt.value=person.id;sel.append(opt);}if(people.length>1)to.selectedIndex=1;const sum=input('金额','10');sum.type='number';sum.min=1;line(transfer,from,to,sum,button('确认转账',async()=>{if(!confirm('确认仅转账虚拟 MIMA 余额？'))return;await walletAction('transfer',{from:from.value,to:to.value,amount:Number(sum.value)},key=>D().transfer(from.value,to.value,Number(sum.value),key));},'phone-primary'));
   await walletIntentControls(transfer,'transfer');const gifts=box(main,'礼物商店');for(const item of D().catalog){line(gifts,dom('span','',`${item.emoji} ${item.name} · ${item.price} 币`),button('购买',async()=>{await walletAction('buy:'+item.id,{actorId:D().owner,catalogId:item.id},key=>D().buyGift(D().owner,item.id,key));}));}
   for(const item of D().catalog)await walletIntentControls(gifts,'buy:'+item.id);const belongings=box(main,'我的礼物');for(const item of await D().inventory(D().owner)){const label=D().catalog.find(c=>c.id===item.catalogId);line(belongings,dom('span','',`${label?.emoji||'🎁'} ${label?.name||item.catalogId} · ${item.status}`),button('赠送角色',async()=>{const choices=await chooseMultiple('选择收礼角色',people.filter(x=>x.id!==D().owner).map(p=>({id:p.id,label:p.displayNick})));if(choices.length!==1)throw Error('一件礼物只能赠给一位角色');await walletAction('gift:'+item.id,{itemId:item.id,from:D().owner,to:choices[0]},key=>D().giftItem(item.id,D().owner,choices[0],key));}));}
   for(const item of await D().inventory(D().owner))await walletIntentControls(belongings,'gift:'+item.id);const pending=(await D().orders()).filter(x=>x.status==='SENT_PENDING');const orders=box(main,'待领取礼物');for(const o of pending){line(orders,dom('span','',`${o.senderId} → ${o.recipientId}`),button('收下',async()=>{await D().settleGift(o.id,o.recipientId,true);await render();}),button('拒绝退回',async()=>{await D().settleGift(o.id,o.recipientId,false);await render();}));}
   const journal=box(main,'交易账本');for(const entry of (await D().ledger()).slice(-24).reverse())journal.append(dom('small','phone-ledger-row',`${entry.type} · ${entry.walletId}: ${entry.deltaMinor>=0?'+':''}${entry.deltaMinor}`));
 }
 async function screenSettings(main){const prefs=await D().settings(),users=R().listUserMasks(),all=R().state();const settings=box(main,'身份与资料');const select=dom('select','phone-input');for(const u of users){const opt=dom('option','',u.name);opt.value=u.id;opt.selected=prefs.userMaskId===u.id;select.append(opt);}line(settings,select,button('使用这个 User 面具',async()=>{await D().setSettings({userMaskId:select.value});await render();},'phone-primary'));
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
