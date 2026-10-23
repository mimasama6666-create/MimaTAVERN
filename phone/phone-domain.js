/* Canonical phone commands. All mutable facts live in mima_phone_v1. */
(()=>{'use strict';
 const S=()=>MimaPhoneStore, id=p=>S().id(p),now=()=>new Date().toISOString();
 const owner='owner';
 function must(ok,msg){if(!ok)throw Error(msg);}
 const uniq=x=>[...new Set(x)];
 async function settings(){return (await S().read('prefs','main'))||{key:'main',userMaskId:'',presetIds:[],worldbookIds:[],ownerName:'主人'};}
 async function setSettings(patch){return S().transaction(['prefs','conversations'],'readwrite',async t=>{
   const old=await t.get('prefs','main')||{key:'main'};const next={...old,...patch,key:'main'};
   if(next.userMaskId)MimaPhoneResources.getUserMask(next.userMaskId);
   const resources=MimaPhoneResources.state();for(const p of next.presetIds||[])must(resources.presets.some(x=>x.id===p&&x.enabled!==false),'全局预设引用无效：'+p);
   for(const w of next.worldbookIds||[])must(resources.worldbooks.some(x=>x.id===w&&x.enabled!==false),'全局世界书引用无效：'+w);
   await t.put('prefs',next);
   if(['userMaskId','presetIds','worldbookIds'].some(key=>JSON.stringify(old[key]??(key==='userMaskId'?'':[]))!==JSON.stringify(next[key]??(key==='userMaskId'?'':[])))){
     for(const c of await t.all('conversations')){
       // Global mounts and User mask can change what an in-flight actor sees.
       await t.put('conversations',{...c,recordRevision:c.recordRevision+1,updatedAt:now()});
     }
   }
   return next;
 });}
 // Per-character resource mounts are phone-only; no writes to story masks.
 async function actorResources(actorId){MimaPhoneResources.getCharMask(actorId);const row=await S().read('prefs','actor:'+actorId);
   return row||{key:'actor:'+actorId,actorId,mode:'inherit',presetIds:[],worldbookIds:[]};}
 async function setActorResources(actorId,{mode,presetIds,worldbookIds}){
   MimaPhoneResources.getCharMask(actorId);must(['inherit','override'].includes(mode),'挂载模式不合法');
   const source=MimaPhoneResources.state();
   for(const p of presetIds||[])must(source.presets.some(x=>x.id===p&&x.enabled!==false),'独立预设引用缺失：'+p);
   for(const w of worldbookIds||[])must(source.worldbooks.some(x=>x.id===w&&x.enabled!==false),'独立世界书引用缺失：'+w);
   return S().transaction(['prefs','conversations'],'readwrite',async t=>{
     const next={key:'actor:'+actorId,actorId,mode,presetIds:[...new Set(presetIds||[])],worldbookIds:[...new Set(worldbookIds||[])],updatedAt:now()};
     await t.put('prefs',next);
     // Changing source material fences in-flight generations for that actor.
     for(const c of await t.all('conversations'))if(c.memberIds.includes(actorId))await t.put('conversations',{...c,recordRevision:c.recordRevision+1,updatedAt:now()});
     return next;
   });}
 async function effectiveResources(actorId,global){const per=await actorResources(actorId);
   return per.mode==='override'?{presetIds:per.presetIds,worldbookIds:per.worldbookIds}:{presetIds:global.presetIds||[],worldbookIds:global.worldbookIds||[]};}
 // Prompt-source fingerprint covers only the mounted User/Char/presets/lore.
 // Unrelated story history or CSS changes must not cancel a phone reply.
 async function promptDigest(actorId){const prefs=await settings(),mounts=await effectiveResources(actorId,prefs),r=MimaPhoneResources.state();
   const pick=(collection,id,label)=>{const found=collection.find(x=>x.id===id&&x.enabled!==false);must(found,label+'引用失效：'+id);return found;};
   const raw=JSON.stringify({char:MimaPhoneResources.getCharMask(actorId),user:prefs.userMaskId?MimaPhoneResources.getUserMask(prefs.userMaskId):null,
     presets:mounts.presetIds.map(i=>pick(r.presets,i,'预设')),worldbooks:mounts.worldbookIds.map(i=>pick(r.worldbooks,i,'世界书'))});
   const bytes=new TextEncoder().encode(raw),digest=await crypto.subtle.digest('SHA-256',bytes);
   return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');}
 async function addContact(maskId){const mask=MimaPhoneResources.getCharMask(maskId),commandId='contact:'+mask.id;
  return S().command(commandId,['contacts'],'add_contact',async t=>{const row={id:mask.id,maskId:mask.id,displayNick:mask.name,remark:'',signature:'',avatarRef:'',createdAt:now()};await t.add('contacts',row);return row;});}
 async function contacts(){return S().all('contacts');}
 async function updateContact(maskId,patch){must((await S().read('contacts',maskId)), '联系人不存在');return S().transaction(['contacts','conversations'],'readwrite',async t=>{
   const row=await t.get('contacts',maskId);must(row,'联系人已删除');const next={...row,displayNick:String(patch.displayNick??row.displayNick).slice(0,80),remark:String(patch.remark??row.remark).slice(0,200),signature:String(patch.signature??row.signature).slice(0,300)};
   await t.put('contacts',next);
   if(JSON.stringify(row)!==JSON.stringify(next))for(const c of await t.all('conversations'))if(c.memberIds.includes(maskId))
     await t.put('conversations',{...c,recordRevision:c.recordRevision+1,updatedAt:now()});
   return next;});}
 async function createConversation(memberIds,{kind='private',title=''}={}){
   const ids=uniq(memberIds);must(ids.length>0&&ids.every(Boolean),'请选择至少一位联系人');if(kind==='private')must(ids.length===1,'私聊只能绑定一位角色');
   for(const c of ids){must(await S().read('contacts',c),'成员尚未添加到通讯录');}
   const commandId=kind==='private'?'private:'+ids[0]:id('create_group');
   return S().command(commandId,['conversations','memberships'],'create_thread',async t=>{
      const row={id:id('thread'),kind,memberIds:ids,recordRevision:1,memberRevision:1,lastSeq:0,title:title|| (kind==='private'?'私聊':'新群聊'),createdAt:now(),updatedAt:now(),settings:{autoReply:true,maxSpeakerTurns:Math.min(ids.length,3)},archived:false};
      await t.add('conversations',row);for(const mid of ids)await t.add('memberships',{id:row.id+':'+mid,threadId:row.id,charId:mid,joinedAtSeq:0,active:true});return row;
   });}
 async function threads(){return (await S().all('conversations')).filter(x=>!x.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async function thread(threadId){const row=await S().read('conversations',threadId);must(row,'聊天不存在');return row;}
 async function updateThread(threadId,patch){return S().transaction(['conversations','memberships','contacts'],'readwrite',async t=>{const row=await t.get('conversations',threadId);must(row,'群聊不存在');
   const next={...row,title:String(patch.title??row.title).slice(0,100),settings:{...row.settings,...(patch.settings||{})},recordRevision:row.recordRevision+1,updatedAt:now()};
   if(patch.memberIds){must(row.kind==='group','私聊不能修改成员');const selected=uniq(patch.memberIds);must(selected.length>0,'不能清空所有群成员');for(const m of selected){must(MimaPhoneResources.getCharMask(m),'角色引用无效');must(await t.get('contacts',m),'群成员必须在通讯录内');}
     for(const old of row.memberIds){if(!selected.includes(old)){const membership=await t.get('memberships',row.id+':'+old);if(membership)await t.put('memberships',{...membership,active:false,leftAtSeq:row.lastSeq});}}
     for(const added of selected){if(!row.memberIds.includes(added))await t.put('memberships',{id:row.id+':'+added,threadId:row.id,charId:added,joinedAtSeq:row.lastSeq+1,active:true});}
     next.memberIds=selected;next.memberRevision=row.memberRevision+1;
   }
   const muted=next.settings.mutedIds||[];must(Array.isArray(muted)&&muted.every(x=>next.memberIds.includes(x)),'禁言成员不属于当前群聊');
   next.settings.mutedIds=[...new Set(muted)];
   await t.put('conversations',next);return next;});}
 async function history(threadId){const rows=await S().query('messages','threadId',threadId);return rows.filter(x=>x.deliveryState!=='deleted').sort((a,b)=>a.seq-b.seq);}
 // Lossless source-linked transcript candidates, not fabricated summaries.
 // Unverified candidates never enter the model prompt until Owner approval.
 async function stageTranscriptCandidate(t,message,charId){
   if(!['text','voice_text'].includes(message.type)||!message.content.trim())return;
   const membership=await t.get('memberships',message.threadId+':'+charId);
   if(!membership||message.seq<membership.joinedAtSeq||(membership.leftAtSeq!=null&&message.seq>membership.leftAtSeq))return;
   await t.add('memories',{id:id('memory'),charId,content:message.content,sourceEventIds:[message.id],sourceRevisions:{[message.id]:message.version},scopeId:message.threadId,
     createdAt:now(),verified:false,status:'needs_review',provenance:'auto_exact_transcript_pending_review'});
 }
 async function post(threadId,{actorId=owner,type='text',content='',assetIds=[],replyToId=null,commandId=id('send'),turnId=null}={}){
   must(['text','voice_text','voice_audio','image','system','transfer_card','gift_card'].includes(type),'消息类型不支持');
   must(typeof content==='string'&&(content.trim()||assetIds.length),'不能发送空白消息');
   return S().command(commandId,['conversations','messages','media','prefs','memberships','memories'],'post_message',async t=>{
     const thread=await t.get('conversations',threadId);must(thread&&!thread.archived,'会话不存在');must(actorId===owner||thread.memberIds.includes(actorId),'角色不在当前聊天中');for(const asset of assetIds)must(await t.get('media',asset),'附件不存在，拒绝提交悬空消息');
     const row={id:id('msg'),threadId,seq:thread.lastSeq+1,actorId,type,content,assetIds,replyToId,turnId,version:1,versions:[],deliveryState:'committed',createdAt:now(),eventId:commandId};
     await t.add('messages',row);await t.put('conversations',{...thread,lastSeq:row.seq,recordRevision:thread.recordRevision+1,updatedAt:row.createdAt});
     if((await t.get('prefs','main'))?.autoMemoryCandidates===true)for(const memberId of thread.memberIds)await stageTranscriptCandidate(t,row,memberId);return row;
   });}
 // Deterministic group routing. Explicit @target is resolved against true
 // identity + phone nickname; ambiguous aliases never silently misaddress.
 async function selectSpeakers(threadId,content='',requested=null){const c=await thread(threadId);
   const allowed=c.memberIds.filter(x=>!(c.settings?.mutedIds||[]).includes(x));
   if(requested){must(requested.every(x=>allowed.includes(x)),'指定发言角色已离群或被禁言');return [...new Set(requested)];}
   if(c.kind==='private')return allowed;
   if(c.settings?.autoReply===false)return [];
   const contacts=await S().all('contacts'),matches=[];
   for(const m of content.matchAll(/@([^\s@，。！？：;；,!?]+)/g)){
     const token=m[1];const ids=allowed.filter(x=>{
       const nick=contacts.find(v=>v.id===x)?.displayNick||'';
       return token===nick||token===MimaPhoneResources.getCharMask(x).name||token===x;
     });
     const mutedAlias=c.memberIds.filter(x=>!allowed.includes(x)).some(x=>token===(contacts.find(v=>v.id===x)?.displayNick||'')||token===MimaPhoneResources.getCharMask(x).name||token===x);
     must(!mutedAlias,'被 @ 的角色已经禁言：'+token);
     must(ids.length<=1,'@称呼有歧义，请改用通讯录中的唯一角色名：'+token);
     must(ids.length===1,'指定的 @联系人不存在：'+token);
     matches.push(ids[0]);
   }
   if(matches.length)return [...new Set(matches)];
   must(!/@([^\s@，。！？：;；,!?]+)/.test(content),'指定的 @联系人不存在，请检查唯一网名或角色 ID');
   const limit=Math.max(1,Math.min(allowed.length,Number(c.settings?.maxSpeakerTurns)||1));
   const previous=(await history(threadId)).filter(m=>m.actorId!==owner).at(-1)?.actorId;
   const offset=Math.max(0,allowed.indexOf(previous)+1);
   return [...allowed.slice(offset),...allowed.slice(0,offset)].slice(0,limit);
 }
 async function allMessages(threadId){const rows=await S().query('messages','threadId',threadId);return rows.sort((a,b)=>a.seq-b.seq);}
 // Edits, recall and restore change the canonical prompt projection. Bump the
 // conversation revision atomically with the message and provenance state.
 async function mutateOwnerMessage(messageId,kind,content=''){
   const before=await S().read('messages',messageId);must(before&&before.actorId===owner,'只能修改自己的手机消息');
   return S().transaction(['messages','conversations','memories'],'readwrite',async t=>{
     const m=await t.get('messages',messageId);must(m&&m.version===before.version,'消息已被其他标签修改，请刷新');
     must(kind==='restore'?m.deliveryState==='deleted':m.deliveryState==='committed','消息当前状态不允许此操作');
     if(kind==='edit')must(typeof content==='string'&&content.trim(),'消息文本不能为空');
     const c=await t.get('conversations',m.threadId);must(c&&!c.archived,'消息所属会话不可用');
     const stamp=now(),next={...m,versions:[...(m.versions||[]),{content:m.content,version:m.version,state:m.deliveryState,at:stamp}],version:m.version+1,
       content:kind==='edit'?String(content):m.content,deliveryState:kind==='recall'?'deleted':'committed',updatedAt:stamp};
     await t.put('messages',next);
     await t.put('conversations',{...c,recordRevision:c.recordRevision+1,updatedAt:stamp});
     for(const memory of await t.all('memories'))if(memory.status==='valid'&&(memory.sourceEventIds||[]).includes(messageId))
       await t.put('memories',{...memory,status:'needs_review',verified:false,provenance:'source_changed',invalidatedAt:stamp});
     return next;
   });
 }
 async function restoreMessage(messageId){return mutateOwnerMessage(messageId,'restore');}
 async function editMessage(messageId,content,deleteOnly=false){return mutateOwnerMessage(messageId,deleteOnly?'recall':'edit',content);}
 async function prepareGeneration(threadId,actorId,sourceId,{task='reply',sourceDigest=''}={}){
   const generation={id:id('gen'),threadId,actorId,sourceId,task,sourceDigest,status:'prepared',attempt:1,startedAt:now(),raw:'',error:'',resultIds:[]};
   return S().transaction(['generations','conversations','messages'],'readwrite',async t=>{const c=await t.get('conversations',threadId);must(c&&c.memberIds.includes(actorId)&&!(c.settings?.mutedIds||[]).includes(actorId),'目标角色不在当前会话或已被禁言');
     if(sourceId){const source=await t.get('messages',sourceId);must(source&&source.threadId===threadId&&source.deliveryState==='committed','触发消息已删除或不属于此会话');const existing=(await t.all('generations')).find(g=>g.threadId===threadId&&g.actorId===actorId&&g.sourceId===sourceId&&['prepared','committed'].includes(g.status));must(!existing,'这个触发消息已经发起过该角色生成，禁止重复请求或重复结算');}
     generation.memberRevision=c.memberRevision;generation.sourceRevision=c.recordRevision;await t.add('generations',generation);return generation;});}
 // A generation ID is stable across attempts. Each Provider dispatch captures its
 // numeric attempt; stale callbacks have no authority to mutate canonical state.
 function assertAttempt(g,attempt){must(Number.isSafeInteger(attempt)&&attempt>=1,'生成回调缺少 attempt');
   if(g.attempt!==attempt)throw Object.assign(Error('E_PHONE_STALE_ATTEMPT: 旧请求不能结算新一轮'),{code:'E_PHONE_STALE_ATTEMPT'});}
 async function restartGeneration(genId,sourceDigest=''){return S().transaction(['generations','conversations'],'readwrite',async t=>{
   const g=await t.get('generations',genId);must(g&&['prepared','failed','unknown'].includes(g.status),'没有可明确重发的生成任务');
   const c=await t.get('conversations',g.threadId);
   if(g.sourceDigest)must(sourceDigest===g.sourceDigest,'角色或预设在原尝试后变动，请重新发起新的任务');
   must(c&&c.memberIds.includes(g.actorId)&&c.memberRevision===g.memberRevision&&c.recordRevision===g.sourceRevision,'会话在原任务后已变化，禁止旧回复重放到新历史');
   const previous={attempt:g.attempt,status:g.status,error:g.error||'',raw:g.raw||'',at:now()};
   const next={...g,status:'prepared',attempt:g.attempt+1,error:'',raw:'',attemptHistory:[...(g.attemptHistory||[]),previous],restartedAt:now(),restartExplicit:true};
   await t.put('generations',next);return next;
 });}
 async function finishGeneration(generationId,bubbles,raw,attempt,sourceDigest=''){return S().transaction(['generations','conversations','messages','prefs','memories','memberships'],'readwrite',async t=>{
   const gen=await t.get('generations',generationId);must(gen,'生成任务不存在');assertAttempt(gen,attempt);
   if(gen.sourceDigest)must(gen.sourceDigest===sourceDigest,'角色人设或世界书在生成期间变化，拒绝旧回复写入');
   if(gen.status==='committed')return gen;
   must(gen.status==='prepared','生成已经处于终结状态');const c=await t.get('conversations',gen.threadId);
   must(c?.memberIds.includes(gen.actorId)&&!(c.settings?.mutedIds||[]).includes(gen.actorId)&&c.memberRevision===gen.memberRevision,'群成员身份或禁言状态已改变，旧任务不再发出');
   must(c.recordRevision===gen.sourceRevision,'会话在生成期间发生变化；旧回复不能覆盖新的手机历史');
   must(Array.isArray(bubbles)&&bubbles.length>=1&&bubbles.length<=256,'不可提交空白或过量气泡');
   const rows=[];for(const b of bubbles){must(['text','voice_text'].includes(b.kind)&&typeof b.content==='string'&&b.content.trim(),'气泡内容不合法');
     const row={id:id('msg'),threadId:c.id,seq:c.lastSeq+rows.length+1,actorId:gen.actorId,type:b.kind,content:b.content,assetIds:[],replyToId:gen.sourceId,turnId:gen.id,version:1,versions:[],deliveryState:'committed',createdAt:now(),eventId:gen.id};await t.add('messages',row);rows.push(row);}
   await t.put('conversations',{...c,lastSeq:c.lastSeq+rows.length,recordRevision:c.recordRevision+1,updatedAt:now()});
   if((await t.get('prefs','main'))?.autoMemoryCandidates===true)for(const row of rows)await stageTranscriptCandidate(t,row,gen.actorId);
   const done={...gen,status:'committed',raw,finishedAt:now(),resultIds:rows.map(x=>x.id)};await t.put('generations',done);return done;
 });}
 async function failGeneration(genId,error,raw='',attempt){return S().transaction(['generations'],'readwrite',async t=>{
   const row=await t.get('generations',genId);must(row,'生成任务不存在');assertAttempt(row,attempt);
   if(row.status==='committed')return row;
   must(row.status==='prepared','生成任务已结算，旧失败不能覆盖');
   const next={...row,status:'failed',error:String(error),raw,finishedAt:now()};await t.put('generations',next);return next;
 });}
 // Parsed recovery is the default. Exact raw JSON is evidence, not a text bubble.
 // Owner can deliberately accept a manually entered plain-text version, labelled
 // as an override, without pretending a truncated JSON reply was parsed.
 async function recoverGeneration(genId,{mode='parsed',text='',attempt,sourceDigest=''}={}){
   const gen=await S().read('generations',genId);must(gen&&gen.status==='failed'&&typeof gen.raw==='string'&&gen.raw.trim(),'没有可人工恢复的候选');
   assertAttempt(gen,attempt);if(gen.sourceDigest)must(sourceDigest===gen.sourceDigest,'恢复候选引用的角色资源已变化，不会误写入新人物设定');
   let bubbles;
   if(mode==='parsed')bubbles=MimaPhoneModel.bubbles(gen.raw);
   else if(mode==='owner_text'){must(typeof text==='string'&&text.trim(),'需要主人明确填写恢复正文');bubbles=[{kind:'text',content:text}];}
   else throw Error('不支持的人工恢复模式');
   return finishRecovered(genId,bubbles,{attempt,mode});
 }
 async function finishRecovered(genId,bubbles,{attempt,mode}){return S().transaction(['generations','conversations','messages','prefs','memories','memberships'],'readwrite',async t=>{
   const g=await t.get('generations',genId);must(g,'任务不存在');assertAttempt(g,attempt);
   if(g.status==='committed')return g;
   must(g.status==='failed'&&!!g.raw,'没有完整可恢复的原文');const c=await t.get('conversations',g.threadId);
   must(c&&c.memberIds.includes(g.actorId)&&!(c.settings?.mutedIds||[]).includes(g.actorId)&&c.memberRevision===g.memberRevision&&c.recordRevision===g.sourceRevision,'目标群/成员或消息已变化，禁止旧候选错误写回');
   const rows=[];for(const b of bubbles){must(['text','voice_text'].includes(b.kind)&&typeof b.content==='string'&&b.content.trim(),'恢复气泡不合法');
     const row={id:id('msg'),threadId:c.id,seq:c.lastSeq+rows.length+1,actorId:g.actorId,type:b.kind,content:b.content,assetIds:[],replyToId:g.sourceId,turnId:g.id,version:1,versions:[],deliveryState:'committed',createdAt:now(),eventId:g.id};await t.add('messages',row);rows.push(row);}
   await t.put('conversations',{...c,lastSeq:c.lastSeq+rows.length,recordRevision:c.recordRevision+1,updatedAt:now()});
   if((await t.get('prefs','main'))?.autoMemoryCandidates===true)for(const row of rows)await stageTranscriptCandidate(t,row,g.actorId);
   const done={...g,status:'committed',ownerOverride:true,recoveryMode:mode,rawEvidencePreserved:true,resultIds:rows.map(x=>x.id),finishedAt:now()};await t.put('generations',done);return done;});}
 async function generations(){return S().all('generations');}
 function acl(moment,actorId){return moment&& !moment.deleted&&(moment.audience==='public'||moment.authorId===actorId||actorId===owner|| (moment.audience==='friends'&&(moment.audienceIds||[]).includes(actorId)));}
 async function moments(actorId=owner){return (await S().all('moments')).filter(m=>acl(m,actorId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async function createMoment({actorId=owner,body='',assetIds=[],audience='public',audienceIds=[],commandId=id('moment')}={}){
   must(body.trim()||assetIds.length,'动态不能空白');must(['public','friends','private'].includes(audience),'动态可见性无效');
   return S().command(commandId,['moments','media'],'create_moment',async t=>{for(const asset of assetIds)must(await t.get('media',asset),'动态图片未持久化');const row={id:id('moment'),actorId,authorId:actorId,body,assetIds,audience,audienceIds,createdAt:now(),version:1,contextRevision:1,deleted:false};await t.add('moments',row);return row;});}
 async function editMoment(momentId,actorId,body,deleteOnly=false){return S().transaction(['moments','memories'],'readwrite',async t=>{const m=await t.get('moments',momentId);must(m&&!m.deleted&&m.authorId===actorId,'仅动态作者可以编辑或删除');must(deleteOnly||String(body).trim(),'内容不能为空');const next={...m,body:deleteOnly?m.body:String(body),deleted:!!deleteOnly,version:m.version+1,contextRevision:(m.contextRevision||1)+1,versions:[...(m.versions||[]),{body:m.body,version:m.version,at:now()}],updatedAt:now()};await t.put('moments',next);
   for(const memory of await t.all('memories'))if(memory.status==='valid'&&
       ((memory.sourceEventIds||[]).includes(momentId)||memory.sourceMomentId===momentId))
     await t.put('memories',{...memory,status:'needs_review',verified:false,provenance:'social_source_changed',invalidatedAt:now()});
   return next;});}
 async function saveDraft(threadId,text){must(await S().read('conversations',threadId),'会话不存在');return S().write('drafts',{id:threadId,threadId,content:String(text).slice(0,250000),updatedAt:now()});}
 async function readDraft(threadId){return await S().read('drafts',threadId);}
 async function comments(momentId){return (await S().query('comments','momentId',momentId)).filter(x=>!x.deleted).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
 async function comment(momentId,actorId,body,parentCommentId=null,commandId=id('comment')){return S().command(commandId,['moments','comments','notices'],'comment',async t=>{
   const moment=await t.get('moments',momentId);must(acl(moment,actorId),'无法阅读或评论这条动态');must(body.trim(),'评论不能为空');if(parentCommentId){const parent=await t.get('comments',parentCommentId);must(parent?.momentId===momentId&&!parent.deleted,'回复的评论不存在');}
   const row={id:id('comment'),momentId,actorId,parentCommentId,body,createdAt:now(),deleted:false,version:1,versions:[]};await t.add('comments',row);await t.put('moments',{...moment,contextRevision:(moment.contextRevision||1)+1,updatedAt:now()});await t.add('notices',{id:id('notice'),recipientId:moment.authorId,sourceId:row.id,type:'comment',read:false,createdAt:now()});return row;});}
 // One authoritative revision for a comment and its descendants, notification
 // projection, and source-linked phone memories. No story data is touched.
 async function mutateComment(commentId,actorId,{body='',deleteOnly=false}={}){
   return S().transaction(['comments','moments','memories','notices'],'readwrite',async t=>{
     const original=await t.get('comments',commentId);
     must(original&&!original.deleted&&original.actorId===actorId,'只有评论作者才能编辑或删除评论');
     must(deleteOnly||(typeof body==='string'&&body.trim()&&body.length<=120000),'评论内容不能为空或过长');
     const root=await t.get('moments',original.momentId);must(acl(root,actorId),'这条动态已失效或无权限');
     const rows=await t.all('comments');const affected=new Set([commentId]);
     if(deleteOnly){let changed=true;while(changed){changed=false;for(const c of rows){if(!affected.has(c.id)&&affected.has(c.parentCommentId)){affected.add(c.id);changed=true;}}}}
     const stamp=now();const changedIds=[];
     for(const c of rows){if(!affected.has(c.id)||c.deleted)continue;
       const next={...c,version:(c.version||1)+1,versions:[...(c.versions||[]),{body:c.body,deleted:!!c.deleted,version:c.version||1,at:stamp}],
         body:c.id===commentId&&!deleteOnly?body:c.body,deleted:deleteOnly||!!c.deleted,updatedAt:stamp};
       await t.put('comments',next);changedIds.push(c.id);
     }
     await t.put('moments',{...root,contextRevision:(root.contextRevision||1)+1,updatedAt:stamp});
     for(const memory of await t.all('memories'))if(memory.status==='valid'&&
       (memory.sourceEventIds||[]).some(x=>changedIds.includes(x))){
       await t.put('memories',{...memory,status:'needs_review',verified:false,provenance:'comment_source_changed',invalidatedAt:stamp});
     }
     for(const notice of await t.all('notices'))if(changedIds.includes(notice.sourceId)){
       await t.put('notices',{...notice,sourceChanged:true,sourceDeleted:deleteOnly||!!notice.sourceDeleted,
         read:deleteOnly?true:notice.read,updatedAt:stamp});
     }
     return {id:commentId,affectedIds:changedIds,deleted:deleteOnly,version:(original.version||1)+1};
   });
 }
 async function editComment(commentId,actorId,body){return mutateComment(commentId,actorId,{body});}
 async function deleteComment(commentId,actorId){return mutateComment(commentId,actorId,{deleteOnly:true});}
 // Phone social events use the same durable generation/attempt authority as chat.
 // No model output enters a moment/comment before the owner accepts it.
 async function prepareSocialGeneration({kind,actorId,momentId=null,parentCommentId=null,sourceDigest=''}){
   must(['moment','browse','moment_comment'].includes(kind),'未知社交生成类型');MimaPhoneResources.getCharMask(actorId);
   return S().transaction(['generations','moments','comments','contacts','memories','memoryGrants','messages','memberships'],'readwrite',async t=>{
     must(await t.get('contacts',actorId),'请先把该角色加入通讯录');
     let moment=null,parent=null;
     if(kind==='moment_comment'){
       moment=await t.get('moments',momentId);must(acl(moment,actorId),'角色无权阅读或评论此动态');
       if(parentCommentId){parent=await t.get('comments',parentCommentId);must(parent&&!parent.deleted&&parent.momentId===momentId,'父评论已改变');}
     }
     // Read the exact visible feed AND every referenced comment within the
     // same IndexedDB transaction that creates the authoritative generation.
     // No later UI query is allowed to silently replace these prompt facts.
     const visibleFeed=(kind==='moment'||kind==='browse')?(await t.all('moments'))
       .filter(item=>acl(item,actorId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,24):[];
     const allComments=visibleFeed.length?await t.all('comments'):[];
     const feedSnapshot=visibleFeed.map(item=>({id:item.id,authorId:item.authorId,body:item.body,version:item.version||1,
       contextRevision:item.contextRevision||1,audience:item.audience,audienceIds:[...(item.audienceIds||[])],
       assetIds:[...(item.assetIds||[])],comments:allComments.filter(c=>c.momentId===item.id&&!c.deleted)
         .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(c=>({id:c.id,actorId:c.actorId,
           momentId:c.momentId,parentCommentId:c.parentCommentId||null,body:c.body,version:c.version||1}))}));
     const memorySnapshot=await memoryProjectionTx(t,actorId);
     const existing=(await t.all('generations')).find(g=>g.socialKind===kind&&g.actorId===actorId&&g.momentId===momentId&&['prepared','awaiting_owner'].includes(g.status));
     must(!existing,'已有此角色的待完成社交生成，请先处理或取消');
     const gen={id:id('social'),socialKind:kind,task:kind,actorId,momentId,parentCommentId,attempt:1,status:'prepared',sourceDigest,
       momentVersion:moment?.version||null,contextRevision:moment?.contextRevision||null,feedSnapshot,memorySnapshot,
       frozenAudience:moment?.audience||null,frozenAudienceIds:[...(moment?.audienceIds||[])],parentVersion:parent?.version||1,
       raw:'',resultIds:[],createdAt:now()};
     gen.socialTurnId=gen.id;gen.planId=gen.id;gen.attemptId=gen.id+':'+gen.attempt;
     await t.add('generations',gen);return gen;
   });
 }
 // A single owner click starts one bounded manual social turn. A model may
 // propose several actions, but it never gains the authority to invoke other
 // actors, schedule a future run, or directly write canonical social events.
 function inspectSocialPlan(g,actions){
   must(Array.isArray(actions)&&actions.length<=24,'社交提案不是可执行的动作数组');
   const kindSet=new Set(['post_moment','like_moment','comment_moment','reply_comment','no_action']);
   let postCount=0;const seen=new Set();
   return actions.map((act,i)=>{
     must(act&&typeof act==='object'&&kindSet.has(act.type),'存在未知社交动作：'+i);
     const type=act.type,body=String(act.body||'').trim(),momentId=String(act.momentId||''),parentCommentId=String(act.parentCommentId||'');
     must(!act.actorId||act.actorId===g.actorId,'提案不允许冒用其他角色');
     const output={actionId:g.id+':'+i,type};
     if(type==='post_moment'){
       postCount++;must(postCount===1,'一次回合最多发一条主动态');must(body&&body.length<=120000,'动态文字为空或过长');
       const audience=act.audience||'public';must(['public','private','friends'].includes(audience),'动态公开范围不合法');
       output.body=body;output.audience=audience;must(act.audienceIds===undefined||Array.isArray(act.audienceIds),'可见好友必须是明确的 ID 列表');
       output.audienceIds=audience==='friends'?[...new Set(act.audienceIds||[])]:[];
       must(output.audienceIds.every(x=>typeof x==='string'&&x.trim()),'可见好友 ID 不合法');
       must(output.audienceIds.length<=100,'指定好友范围过大');
       must(audience!=='friends'||output.audienceIds.length>0,'好友可见需要指定联系人');
     }else if(type==='no_action'){must(actions.length===1,'不行动不能与其他动作混用');}
     else {
       must(momentId&&g.feedSnapshot?.some(m=>m.id===momentId),'动作目标不在本次角色的合法阅读快照中');
       output.momentId=momentId;
       if(type==='comment_moment'||type==='reply_comment'){
         must(body&&body.length<=120000,'评论正文无效');output.body=body;
         if(type==='reply_comment'){
           must(parentCommentId&&g.feedSnapshot.find(m=>m.id===momentId).comments.some(c=>c.id===parentCommentId),
             '回复对象不是本次读到的评论');output.parentCommentId=parentCommentId;
         }
       }
       const key=type+':'+momentId+':'+(parentCommentId||'');
       must(!seen.has(key)||type==='comment_moment'||type==='reply_comment','同一提案包含重复点赞');seen.add(key);
     }
     return output;
   });
 }
 async function stageSocialPlan(genId,{attempt,raw,actions,sourceDigest=''}){
   return S().transaction(['generations'],'readwrite',async t=>{
     const g=await t.get('generations',genId);must(g&&['moment','browse'].includes(g.socialKind),'社交任务类型不支持多动作');
     assertAttempt(g,attempt);must(g.status==='prepared','已准备的候选不能重复结算');
     must(!g.sourceDigest||sourceDigest===g.sourceDigest,'资源快照已经变化');
     const proposal=inspectSocialPlan(g,actions);
     if(g.socialKind==='moment')must(proposal.some(a=>a.type==='post_moment'),'发朋友圈提案必须包含一条动态，拒绝只有口头宣称的假发表');
     if(g.socialKind==='browse')must(!proposal.some(a=>a.type==='post_moment'),'逛朋友圈不会偷偷发新动态');
     const next={...g,planId:g.id,turnId:g.id,status:'awaiting_owner',candidateActions:proposal,raw:String(raw||''),stagedAt:now()};
     await t.put('generations',next);return next;
   });
 }
 async function reviseSocialPlan(genId,{attempt,sourceDigest='',raw,actions}={}){
   return S().transaction(['generations'],'readwrite',async t=>{
     const g=await t.get('generations',genId);must(g&&['moment','browse'].includes(g.socialKind),'仅多动作社交计划支持修订');
     assertAttempt(g,attempt);must(['failed','awaiting_owner'].includes(g.status),'只有失败或待审核的计划能编辑');
     must(!g.sourceDigest||g.sourceDigest===sourceDigest,'原人物面具或世界书已经变化，不能用旧提案');
     const proposed=inspectSocialPlan(g,actions);
     if(g.socialKind==='moment')must(proposed.some(a=>a.type==='post_moment'),'发朋友圈计划缺少实际发表动作');
     if(g.socialKind==='browse')must(!proposed.some(x=>x.type==='post_moment'),'逛朋友圈不能发布动态');
     const next={...g,status:'awaiting_owner',candidateActions:proposed,
       originalRaw:g.originalRaw??g.raw,manualPlanRaw:String(raw||''),ownerEditedPlan:true,stagedAt:now()};
     await t.put('generations',next);return next;
   });
 }
 function verifyFeedSnapshot(g,moments,comments){
   for(const snapshot of g.feedSnapshot||[]){
     const m=moments.find(x=>x.id===snapshot.id);
     must(acl(m,g.actorId),'E_PHONE_SOCIAL_SOURCE_STALE: 动态已删除或角色失去权限');
     must((m.version||1)===snapshot.version&&(m.contextRevision||1)===snapshot.contextRevision,
       'E_PHONE_SOCIAL_SOURCE_STALE: 已阅读的动态或评论发生变化');
     must(m.audience===snapshot.audience&&JSON.stringify(m.audienceIds||[])===JSON.stringify(snapshot.audienceIds),
       'E_PHONE_SOCIAL_AUDIENCE_STALE: 可见好友范围变化');
     const live=comments.filter(c=>c.momentId===m.id&&!c.deleted).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
     must(live.length===snapshot.comments.length,'E_PHONE_SOCIAL_SOURCE_STALE: 评论数量已变化');
     for(let i=0;i<live.length;i++){const a=live[i],b=snapshot.comments[i];
       must(a.id===b.id&&(a.version||1)===b.version&&a.body===b.body&&a.actorId===b.actorId&&(a.parentCommentId||null)===b.parentCommentId,
         'E_PHONE_SOCIAL_SOURCE_STALE: 已阅读的楼中楼评论变化');
     }
   }
 }
 async function stageSocialMemoryCandidate(t,event,charId,sourceMomentId=null){
   if(!['moment','comment'].includes(event.type))return;
   const content=event.type==='moment'?'自己发布朋友圈：'+event.body:'自己评论朋友圈：'+event.body;
   await t.add('memories',{id:id('memory'),charId,content,sourceEventIds:[event.id],sourceRevisions:{[event.id]:event.version||1},
     sourceType:event.type,sourceMomentId:sourceMomentId||event.id,scopeId:'phone_moments',verified:false,status:'needs_review',
     provenance:'phone_social_event_pending_owner_review',createdAt:now()});
 }
 async function verifySocialMemories(t,g){
   if(!Array.isArray(g.memorySnapshot))return; // Legacy pending plans made before fifth round have no injected memory.
   const live=await memoryProjectionTx(t,g.actorId);
   must(JSON.stringify(live)===JSON.stringify(g.memorySnapshot),
     'E_PHONE_MEMORY_STALE: 手机记忆、来源版本或分享授权已变化，请重新发起本回合');
 }
 async function finishSocialPlan(genId,{attempt,sourceDigest=''}={}){
   return S().transaction(['generations','moments','comments','reactions','notices','contacts','memories','memoryGrants','messages','memberships','prefs'],'readwrite',async t=>{
     const g=await t.get('generations',genId);must(g&&['moment','browse'].includes(g.socialKind),'社交计划不存在');
     assertAttempt(g,attempt);if(g.status==='committed')return g;
     must(g.status==='awaiting_owner'&&Array.isArray(g.candidateActions),'未经过主人确认的社交计划不能发布');
     must(!g.sourceDigest||g.sourceDigest===sourceDigest,'当前角色资源与提案准备时不一致');
     must(await t.get('contacts',g.actorId),'角色身份已失效');
     await verifySocialMemories(t,g);
     const proposal=inspectSocialPlan(g,g.candidateActions);
     const currentMoments=await t.all('moments'),currentComments=await t.all('comments');
     verifyFeedSnapshot(g,currentMoments,currentComments);
     // Validate every action before the first write. An invalid plan commits
     // NOTHING; each committed plan has one IDB transaction/settlement authority.
     for(const action of proposal){
       if(action.type==='post_moment'&&action.audience==='friends')for(const mid of action.audienceIds)
         must(await t.get('contacts',mid),'提案的指定好友已离开通讯录');
       if(action.momentId)must(g.feedSnapshot.some(m=>m.id===action.momentId),'目标不在本轮快照');
     }
     const resultIds=[],outcomes=[];
     for(const action of proposal){let output=null;
       if(action.type==='post_moment'){
         output={id:id('moment'),authorId:g.actorId,actorId:g.actorId,body:action.body,assetIds:[],audience:action.audience,
           audienceIds:action.audienceIds,createdAt:now(),version:1,contextRevision:1,deleted:false,sourceGenerationId:g.id,actionId:action.actionId};
         await t.add('moments',output);
       }else if(action.type==='like_moment'){
         const key=action.momentId+':'+g.actorId,exists=await t.get('reactions',key);
         if(!exists){output={id:key,momentId:action.momentId,actorId:g.actorId,createdAt:now(),sourceGenerationId:g.id,actionId:action.actionId};
           await t.add('reactions',output);
           const m=await t.get('moments',action.momentId);
           if(m.authorId!==g.actorId)await t.add('notices',{id:id('notice'),recipientId:m.authorId,sourceId:key,type:'like',read:false,createdAt:now()});
         }
       }else if(action.type==='comment_moment'||action.type==='reply_comment'){
         const m=await t.get('moments',action.momentId);
         output={id:id('comment'),momentId:m.id,actorId:g.actorId,parentCommentId:action.parentCommentId||null,
           body:action.body,createdAt:now(),deleted:false,version:1,sourceGenerationId:g.id,actionId:action.actionId};
         await t.add('comments',output);await t.put('moments',{...m,contextRevision:(m.contextRevision||1)+1,updatedAt:now()});
         const target=action.parentCommentId?currentComments.find(c=>c.id===action.parentCommentId)?.actorId:m.authorId;
         if(target&&target!==g.actorId)await t.add('notices',{id:id('notice'),recipientId:target,sourceId:output.id,type:'comment',read:false,createdAt:now()});
       }
       if(output){resultIds.push(output.id);
         if((await t.get('prefs','main'))?.autoMemoryCandidates===true&&['post_moment','comment_moment','reply_comment'].includes(action.type))
           await stageSocialMemoryCandidate(t,{...output,type:action.type==='post_moment'?'moment':'comment'},g.actorId,output.momentId||output.id);
       }
       outcomes.push({actionId:action.actionId,type:action.type,status:output?'committed':(action.type==='no_action'?'no_action':'already_liked'),resultId:output?.id||null});
     }
     const done={...g,status:'committed',finishedAt:now(),resultIds,outcomes};await t.put('generations',done);return done;
   });
 }
 async function stageSocialCandidate(genId,{attempt,raw,bubbles,sourceDigest=''}){return S().transaction(['generations'],'readwrite',async t=>{
   const g=await t.get('generations',genId);must(g&&g.socialKind,'社交生成不存在');assertAttempt(g,attempt);
   must(g.status==='prepared','不能重复保存已结算或取消的候选');must(!g.sourceDigest||g.sourceDigest===sourceDigest,'角色资源已变化');
   must(Array.isArray(bubbles)&&bubbles.length>0&&bubbles.every(b=>['text','voice_text'].includes(b.kind)&&typeof b.content==='string'&&b.content.trim()),'无有效气泡');
   const next={...g,status:'awaiting_owner',raw:String(raw||''),candidate:bubbles,stagedAt:now()};await t.put('generations',next);return next;
 });}
 function socialSourceMust(g,m,parent){
   if(g.socialKind==='moment_comment'){
     must(m&&acl(m,g.actorId),'动态已删除或角色已失去可见权限');
     must(m.version===g.momentVersion&&(m.contextRevision||1)===g.contextRevision,'E_PHONE_SOCIAL_SOURCE_STALE: 动态或评论上下文已变化');
     must(m.audience===g.frozenAudience&&JSON.stringify(m.audienceIds||[])===JSON.stringify(g.frozenAudienceIds),'E_PHONE_SOCIAL_AUDIENCE_STALE');
     if(g.parentCommentId)must(parent&&!parent.deleted&&parent.momentId===g.momentId&&(parent.version||1)===g.parentVersion,'回复目标已经变化');
   }
 }
 async function finishSocialGeneration(genId,{attempt,sourceDigest='',mode='parsed',ownerText='',audience='public',audienceIds=[]}={}){
   return S().transaction(['generations','moments','comments','notices','contacts'],'readwrite',async t=>{
     const g=await t.get('generations',genId);must(g&&g.socialKind,'社交任务不存在');assertAttempt(g,attempt);
     if(g.status==='committed')return g;
     must(g.status==='awaiting_owner'||(g.status==='failed'&&mode==='owner_text'),'社交候选尚未准备好或已终结');
     must(!g.sourceDigest||g.sourceDigest===sourceDigest,'角色设定/挂载发生变化，拒绝旧候选');
     must(await t.get('contacts',g.actorId),'角色已不在通讯录');
     const m=g.momentId?await t.get('moments',g.momentId):null,parent=g.parentCommentId?await t.get('comments',g.parentCommentId):null;
     socialSourceMust(g,m,parent);
     if(g.socialKind==='moment'&&g.feedSnapshot?.length){
       verifyFeedSnapshot(g,await t.all('moments'),await t.all('comments'));
     }
     const bubbles=mode==='owner_text'?[{kind:'text',content:String(ownerText||'')}]:g.candidate;
     must(Array.isArray(bubbles)&&bubbles.length&&bubbles.length<=256&&bubbles.every(b=>typeof b.content==='string'&&b.content.trim()),'社交候选正文为空');
     const body=bubbles.map(b=>b.content).join('\n');let output;
     if(g.socialKind==='moment'){
       must(['public','private','friends'].includes(audience),'动态可见范围无效');
       output={id:id('moment'),authorId:g.actorId,actorId:g.actorId,body,assetIds:[],audience,audienceIds,version:1,contextRevision:1,deleted:false,createdAt:now(),sourceGenerationId:g.id};
       await t.add('moments',output);
     }else{
       output={id:id('comment'),momentId:g.momentId,actorId:g.actorId,parentCommentId:g.parentCommentId,body,createdAt:now(),deleted:false,version:1,sourceGenerationId:g.id};
       await t.add('comments',output);await t.put('moments',{...m,contextRevision:(m.contextRevision||1)+1,updatedAt:now()});
       await t.add('notices',{id:id('notice'),recipientId:m.authorId,sourceId:output.id,type:'comment',read:false,createdAt:now()});
     }
     const done={...g,status:'committed',recoveryMode:mode,ownerOverride:mode==='owner_text',resultIds:[output.id],finishedAt:now()};await t.put('generations',done);return done;
   });
 }
 async function failSocialGeneration(genId,{attempt,error,raw=''}){return S().transaction(['generations'],'readwrite',async t=>{
   const g=await t.get('generations',genId);must(g&&g.socialKind,'社交任务不存在');assertAttempt(g,attempt);
   if(g.status==='committed')return g;must(['prepared','awaiting_owner'].includes(g.status),'社交任务已结束');
   const next={...g,status:'failed',error:String(error),raw:String(raw||g.raw||''),finishedAt:now()};await t.put('generations',next);return next;
 });}
 async function cancelSocialGeneration(genId,attempt){return S().transaction(['generations'],'readwrite',async t=>{
   const g=await t.get('generations',genId);must(g&&g.socialKind,'社交任务不存在');assertAttempt(g,attempt);
   if(g.status==='cancelled')return g;must(['prepared','awaiting_owner','failed'].includes(g.status),'已结算不可撤销');
   const next={...g,status:'cancelled',cancelledAt:now()};await t.put('generations',next);return next;
 });}
 async function pendingSocialGenerations(){return (await generations()).filter(g=>g.socialKind&&['prepared','awaiting_owner','failed'].includes(g.status));}
 async function react(momentId,actorId){return S().transaction(['moments','reactions'],'readwrite',async t=>{const m=await t.get('moments',momentId);must(acl(m,actorId),'无权限访问动态');const key=momentId+':'+actorId,old=await t.get('reactions',key);if(old){await t.delete('reactions',key);return false;}await t.add('reactions',{id:key,momentId,actorId,createdAt:now()});return true;});}
 async function reactions(momentId){return (await S().all('reactions')).filter(r=>r.momentId===momentId);}
 async function notices(recipientId=owner){return (await S().all('notices')).filter(n=>n.recipientId===recipientId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async function readNotice(id,recipientId=owner){return S().transaction(['notices'],'readwrite',async t=>{const notice=await t.get('notices',id);must(notice&&notice.recipientId===recipientId,'没有权限阅读这条通知');const next={...notice,read:true,readAt:now()};await t.put('notices',next);return next;});}

 // Durable UI intent prevents a lost render or double click from creating a
 // second transaction. A new purchase requires an explicit fresh-intent action.
 async function walletIntent(slot,payload){must(typeof slot==='string'&&slot.length>0&&slot.length<160,'交易入口无效');
   const signature=JSON.stringify(payload);must(signature&&signature.length<3000,'交易内容无效');
   return S().transaction(['drafts'],'readwrite',async t=>{
     const key='wallet_intent:'+slot,existing=await t.get('drafts',key);
     if(existing){must(existing.signature===signature,'已有未重置的交易意图，请先明确开始新操作');return existing;}
     const row={id:key,commandId:id('cmd_wallet'),signature,slot,status:'pending',createdAt:now()};await t.put('drafts',row);return row;
   });
 }
 async function finishWalletIntent(slot,commandId,receipt){return S().transaction(['drafts'],'readwrite',async t=>{
   const key='wallet_intent:'+slot,row=await t.get('drafts',key);must(row&&row.commandId===commandId,'交易意图已经更新');
   const next={...row,status:'committed',receipt,finishedAt:now()};await t.put('drafts',next);return next;
 });}
 async function resetWalletIntent(slot){return S().transaction(['drafts'],'readwrite',async t=>{await t.delete('drafts','wallet_intent:'+slot);return true;});}
 async function readWalletIntent(slot){return S().read('drafts','wallet_intent:'+slot);}
 async function balance(actorId){return (await S().read('wallets',actorId))?.balanceMinor||0;}
 async function issue(actorId,amountMinor,commandId=id('mint')){must(Number.isSafeInteger(amountMinor)&&amountMinor>0&&amountMinor<=100000000,'发行数量不合法');
   return S().command(commandId,['wallets','ledgerEntries'],'issue_virtual',async t=>{
    const wallet=await t.get('wallets',actorId)||{id:actorId,balanceMinor:0};must(Number.isSafeInteger(wallet.balanceMinor+amountMinor),'虚拟账户余额超出安全整数范围');await t.put('wallets',{...wallet,balanceMinor:wallet.balanceMinor+amountMinor});
    const txId=id('tx');await t.add('ledgerEntries',{id:txId+':0',txId,walletId:'virtual_issuer',deltaMinor:-amountMinor,type:'issue',createdAt:now()});await t.add('ledgerEntries',{id:txId+':1',txId,walletId:actorId,deltaMinor:amountMinor,type:'issue',createdAt:now()});return {txId,actorId,amountMinor};});}
 async function transfer(from,to,amountMinor,commandId=id('transfer')){must(from!==to,'不能向自己转账');must(Number.isSafeInteger(amountMinor)&&amountMinor>0,'金额必须是正整数');
   return S().command(commandId,['wallets','ledgerEntries','notices'],'transfer',async t=>{
      const a=await t.get('wallets',from)||{id:from,balanceMinor:0},b=await t.get('wallets',to)||{id:to,balanceMinor:0};must(a.balanceMinor>=amountMinor,'虚拟余额不足');must(Number.isSafeInteger(b.balanceMinor+amountMinor),'余额超出安全范围');
      await t.put('wallets',{...a,balanceMinor:a.balanceMinor-amountMinor});await t.put('wallets',{...b,balanceMinor:b.balanceMinor+amountMinor});
      const txId=id('tx');await t.add('ledgerEntries',{id:txId+':0',txId,walletId:from,deltaMinor:-amountMinor,type:'transfer',createdAt:now()});await t.add('ledgerEntries',{id:txId+':1',txId,walletId:to,deltaMinor:amountMinor,type:'transfer',createdAt:now()});
      await t.add('notices',{id:id('notice'),recipientId:to,type:'transfer',sourceId:txId,read:false,createdAt:now()});return {txId,from,to,amountMinor,status:'committed'};});}
 // Transfer/gift chat cards are one canonical transaction with the ledger or
 // Inventory; there is no intermediate 'money sent but card missing' state.
 async function transferInThread(threadId,from,to,amountMinor,commandId){
   must(commandId,'交易必须有稳定的客户端指令 ID');must(from!==to&&Number.isSafeInteger(amountMinor)&&amountMinor>0,'转账金额或对象不合法');
   return S().command(commandId,['conversations','messages','wallets','ledgerEntries','notices'],'transfer_chat_card',async t=>{
     const c=await t.get('conversations',threadId);must(c&&!c.archived&&c.memberIds.includes(to)&&(from===owner||c.memberIds.includes(from)),'收款方或发送方不属于此聊天');
     const a=await t.get('wallets',from)||{id:from,balanceMinor:0},b=await t.get('wallets',to)||{id:to,balanceMinor:0};
     must(a.balanceMinor>=amountMinor,'虚拟余额不足');must(Number.isSafeInteger(b.balanceMinor+amountMinor),'余额超过安全整数');
     await t.put('wallets',{...a,balanceMinor:a.balanceMinor-amountMinor});await t.put('wallets',{...b,balanceMinor:b.balanceMinor+amountMinor});
     const txId=id('tx');for(const [suffix,walletId,deltaMinor] of [['0',from,-amountMinor],['1',to,amountMinor]])
       await t.add('ledgerEntries',{id:txId+':'+suffix,txId,walletId,deltaMinor,type:'transfer',createdAt:now()});
     const row={id:id('msg'),threadId,seq:c.lastSeq+1,actorId:from,type:'transfer_card',content:`虚拟转账 ${amountMinor} MIMA 币 → ${to}`,transferId:txId,recipientId:to,amountMinor,
       assetIds:[],replyToId:null,turnId:null,version:1,versions:[],deliveryState:'committed',createdAt:now(),eventId:commandId};
     await t.add('messages',row);await t.put('conversations',{...c,lastSeq:row.seq,recordRevision:c.recordRevision+1,updatedAt:now()});
     await t.add('notices',{id:id('notice'),recipientId:to,type:'transfer',sourceId:txId,read:false,createdAt:now()});
     return {txId,messageId:row.id,from,to,amountMinor,status:'committed'};
   });
 }
 async function giftInThread(threadId,itemId,from,to,commandId){
   must(commandId,'赠礼必须有稳定指令 ID');must(from!==to,'不能给自己赠礼');
   return S().command(commandId,['inventories','orders','notices','conversations','messages'],'gift_chat_card',async t=>{
     const c=await t.get('conversations',threadId);must(c&&!c.archived&&c.memberIds.includes(to)&&(from===owner||c.memberIds.includes(from)),'赠礼双方必须在本聊天');
     const item=await t.get('inventories',itemId);must(item?.ownerId===from&&item.status==='owned','礼物不属于你或已转出');
     const order={id:id('order'),itemId,senderId:from,recipientId:to,status:'SENT_PENDING',createdAt:now()};
     await t.put('inventories',{...item,status:'pending',orderId:order.id});await t.add('orders',order);
     const row={id:id('msg'),threadId,seq:c.lastSeq+1,actorId:from,type:'gift_card',content:`🎁 待领取礼物 ${item.catalogId} → ${to}`,orderId:order.id,recipientId:to,assetIds:[],version:1,versions:[],deliveryState:'committed',createdAt:now(),eventId:commandId};
     await t.add('messages',row);await t.put('conversations',{...c,lastSeq:row.seq,recordRevision:c.recordRevision+1,updatedAt:now()});
     await t.add('notices',{id:id('notice'),recipientId:to,type:'gift',sourceId:order.id,read:false,createdAt:now()});
     return {orderId:order.id,messageId:row.id,status:'SENT_PENDING'};
   });
 }
 const catalog=[{id:'rose',name:'玫瑰花束',price:15,emoji:'🌹'},{id:'coffee',name:'咖啡',price:8,emoji:'☕'},{id:'cat',name:'毛绒小猫',price:50,emoji:'🐈'},{id:'ring',name:'银色戒指',price:120,emoji:'💍'}];
 async function buyGift(buyer,catalogId,commandId=id('buy')){const item=catalog.find(x=>x.id===catalogId);must(item,'商品不存在');return S().command(commandId,['wallets','ledgerEntries','inventories'],'buy_gift',async t=>{
    const wallet=await t.get('wallets',buyer)||{id:buyer,balanceMinor:0};must(wallet.balanceMinor>=item.price,'虚拟余额不足');await t.put('wallets',{...wallet,balanceMinor:wallet.balanceMinor-item.price});
    const store=await t.get('wallets','virtual_shop')||{id:'virtual_shop',balanceMinor:0};await t.put('wallets',{...store,balanceMinor:store.balanceMinor+item.price});
    const txId=id('tx');await t.add('ledgerEntries',{id:txId+':0',txId,walletId:buyer,deltaMinor:-item.price,type:'buy_gift',createdAt:now()});await t.add('ledgerEntries',{id:txId+':1',txId,walletId:'virtual_shop',deltaMinor:item.price,type:'buy_gift',createdAt:now()});
    const owned={id:id('item'),catalogId,ownerId:buyer,createdAt:now(),status:'owned'};await t.add('inventories',owned);return owned;});}
 async function giftItem(itemId,senderId,recipientId,commandId=id('gift')){must(senderId!==recipientId,'不能赠送给自己');return S().command(commandId,['inventories','orders','notices'],'send_gift',async t=>{
   const item=await t.get('inventories',itemId);must(item?.ownerId===senderId&&item.status==='owned','礼物不属于你或正在投递');const order={id:id('order'),itemId,senderId,recipientId,status:'SENT_PENDING',createdAt:now()};
   await t.put('inventories',{...item,status:'pending',orderId:order.id});await t.add('orders',order);await t.add('notices',{id:id('notice'),recipientId,type:'gift',sourceId:order.id,read:false,createdAt:now()});return order;});}
 async function settleGift(orderId,recipientId,accept=true){return S().transaction(['orders','inventories'],'readwrite',async t=>{
   const o=await t.get('orders',orderId);must(o&&o.recipientId===recipientId,'没有权限领取礼物');if(o.status!=='SENT_PENDING')return o;
   const item=await t.get('inventories',o.itemId);must(item?.status==='pending'&&item.orderId===o.id,'礼物状态冲突');
   await t.put('inventories',{...item,status:'owned',orderId:null,ownerId:accept?recipientId:o.senderId});const done={...o,status:accept?'ACCEPTED':'REJECTED',settledAt:now()};await t.put('orders',done);return done;});}
 async function inventory(actorId){return (await S().all('inventories')).filter(x=>x.ownerId===actorId);}
 async function orders(){return S().all('orders');}
 async function ledger(){return S().all('ledgerEntries');}
 async function addMemory(charId,text,sourceEventIds=[],scopeId='',commandId=id('memory')){MimaPhoneResources.getCharMask(charId);must(text.trim(),'记忆不能为空');return S().command(commandId,['memories','messages','memberships'],'memory',async t=>{
    for(const sourceId of sourceEventIds){const source=await t.get('messages',sourceId);must(source&&!source.deliveryState?.includes('deleted'),'记忆来源消息不存在或已删除');const membership=await t.get('memberships',source.threadId+':'+charId);must(membership&&source.seq>=membership.joinedAtSeq&&(membership.leftAtSeq==null||source.seq<=membership.leftAtSeq),'角色未参与这条消息所属时间范围');}
    const row={id:id('memory'),charId,content:text,sourceEventIds,scopeId,createdAt:now(),verified:false,status:'needs_review',provenance:sourceEventIds.length?'source_pending_review':'owner_assertion'};await t.add('memories',row);return row;});}
 async function approveMemory(memoryId){return S().transaction(['memories','messages','memberships','moments','comments'],'readwrite',async t=>{const m=await t.get('memories',memoryId);must(m&&m.status==='needs_review','这条记忆不处于待核验状态');for(const sourceId of m.sourceEventIds){
   if(m.sourceType==='moment'||m.sourceType==='comment'){
     const source=await t.get(m.sourceType==='moment'?'moments':'comments',sourceId);
     const root=await t.get('moments',m.sourceMomentId||sourceId);
     must(source&&!source.deleted&&source.actorId===m.charId&&root&&!root.deleted&&
       (source.version||1)===(m.sourceRevisions?.[sourceId]||1)&&acl(root,m.charId),
       '社交记忆来源已失效、被改写或不可见，拒绝审核通过');continue;
   }
   const msg=await t.get('messages',sourceId),member=msg?await t.get('memberships',msg.threadId+':'+m.charId):null;must(msg&&msg.deliveryState==='committed'&&member&&msg.seq>=member.joinedAtSeq&&(member.leftAtSeq==null||msg.seq<=member.leftAtSeq)&&(!m.sourceRevisions||m.sourceRevisions[sourceId]===msg.version),'记忆原文版本不可核实，拒绝确认');}const next={...m,status:'valid',verified:m.sourceEventIds.length>0,provenance:m.sourceEventIds.length?'source_checked':'owner_explicit_assertion',approvedAt:now()};await t.put('memories',next);return next;});}
 // Canonical actor-scoped projection. Only Owner-approved and currently valid
 // sources may be shown to the model. No ungranted private fact can escape.
 async function memoryProjectionTx(t,actorId){
   const all=await t.all('memories'),grants=await t.all('memoryGrants'),selected=[];
   for(const m of all){
     if(m.status!=='valid'||!m.approvedAt||typeof m.content!=='string')continue;
     const own=m.charId===actorId;
     const grant=own?null:grants.find(g=>g.id===m.id+':'+actorId&&g.enabled&&g.fromId===m.charId&&g.toId===actorId);
     if(!own&&!grant)continue;
     let okay=true;
     for(const sourceId of m.sourceEventIds||[]){
       if(m.sourceType==='moment'||m.sourceType==='comment'){
         const source=await t.get(m.sourceType==='moment'?'moments':'comments',sourceId);
         const root=await t.get('moments',m.sourceMomentId||sourceId);
         if(!source||source.deleted||!root||root.deleted||!acl(root,m.charId)||
            (source.version||1)!==(m.sourceRevisions?.[sourceId]||1)||
            (m.sourceType==='moment'?source.authorId!==m.charId:source.actorId!==m.charId))okay=false;
       }else{
         const msg=await t.get('messages',sourceId),membership=msg?await t.get('memberships',msg.threadId+':'+m.charId):null;
         if(!msg||msg.deliveryState!=='committed'||!membership||msg.seq<membership.joinedAtSeq||
            (membership.leftAtSeq!=null&&msg.seq>membership.leftAtSeq)||
            (m.sourceRevisions&&m.sourceRevisions[sourceId]!==msg.version))okay=false;
       }
       if(!okay)break;
     }
     if(okay)selected.push({id:m.id,charId:m.charId,content:m.content,approvedAt:m.approvedAt,
       sourceEventIds:[...(m.sourceEventIds||[])],sourceRevisions:{...(m.sourceRevisions||{})},
       grantId:grant?.id||null,grantVersion:grant?.version||null});
   }
   return selected.sort((a,b)=>a.id.localeCompare(b.id));
 }
 async function allMemories(actorId){return (await S().all('memories')).filter(m=>m.charId===actorId);}

 const memoryStores=['memories','memoryGrants','messages','memberships','moments','comments'];
 async function memories(actorId){MimaPhoneResources.getCharMask(actorId);return S().transaction(memoryStores,'readonly',t=>memoryProjectionTx(t,actorId));}
 async function grantMemory(memoryId,toId){MimaPhoneResources.getCharMask(toId);return S().transaction(['memories','memoryGrants'],'readwrite',async t=>{
   const memory=await t.get('memories',memoryId);must(memory&&memory.status==='valid'&&memory.approvedAt,'仅可分享已批准的有效记忆');must(memory.charId!==toId,'不能给自己重复授权');
   const key=memoryId+':'+toId,old=await t.get('memoryGrants',key);
   const next={id:key,memoryId,fromId:memory.charId,toId,enabled:true,version:(old?.version||0)+1,createdAt:old?.createdAt||now(),updatedAt:now()};
   await t.put('memoryGrants',next);return next;
 });}
 async function revokeMemory(memoryId,toId){return S().transaction(['memoryGrants'],'readwrite',async t=>{
   const key=memoryId+':'+toId,g=await t.get('memoryGrants',key);must(g,'授权不存在');
   const next={...g,enabled:false,version:(g.version||1)+1,revokedAt:now()};await t.put('memoryGrants',next);return next;
 });}
 window.MimaPhoneDomain=Object.freeze({owner,walletIntent,finishWalletIntent,resetWalletIntent,readWalletIntent,prepareSocialGeneration,stageSocialCandidate,stageSocialPlan,reviseSocialPlan,finishSocialPlan,finishSocialGeneration,failSocialGeneration,cancelSocialGeneration,pendingSocialGenerations,settings,setSettings,promptDigest,transferInThread,giftInThread,actorResources,setActorResources,effectiveResources,selectSpeakers,readNotice,addContact,contacts,updateContact,createConversation,threads,thread,updateThread,history,allMessages,post,editMessage,restoreMessage,prepareGeneration,restartGeneration,finishGeneration,failGeneration,recoverGeneration,generations,moments,createMoment,editMoment,comments,comment,editComment,deleteComment,react,reactions,notices,acl,balance,issue,transfer,catalog,buyGift,giftItem,settleGift,inventory,orders,ledger,addMemory,approveMemory,allMemories,memories,grantMemory,revokeMemory,saveDraft,readDraft});
})();
