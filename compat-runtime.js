/* Standalone compatibility session and limited, explicitly non-equivalent World Info engine. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatRuntime=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';const store=()=>root.MimaCompatStore;
const error=(code,message)=>Object.assign(new Error(message),{code});const mvu=()=>root.MimaCompatMVU||(typeof module==='object'&&module.exports&&typeof require==='function'?require('./compat-mvu.js'):null);const words=s=>Array.isArray(s)?s:typeof s==='string'?s.split(',').map(x=>x.trim()).filter(Boolean):[];
const hashKey=e=>String(e.uid??e.id??e.comment??e.name??'entry');
const approvedReply=m=>root.MimaStandalone?.isManuallyRecoveredReply?.(m)===true;
function recoveryMetadata(message,receipt){
 const metadata=message.metadata||{},approval=receipt||metadata.manualRecovery;
 return {...metadata,manualRecoveryIds:[...new Set([...(metadata.manualRecoveryIds||[]),approval.diagnosticId])],
   manualRecovery:{...approval,contentFingerprint:root.MimaStandalone.manualReplyFingerprint(message)}};
}
const flags=['excludeRecursion','preventRecursion','delayUntilRecursion','sticky','cooldown','delay','group','groupOverride','groupWeight','useProbability','scanDepth'];
function wiPosition(e){const ext=e.extensions||{};if(Number.isInteger(ext.position))return ext.position;if(Number.isInteger(e.position))return e.position;return e.position==='before_char'?0:e.position==='after_char'?1:null;}
function unsupportedWI(e,settings={}){const ext=e.extensions||{},gaps=[];
  const position=wiPosition(e);
  if(![0,1,2,3,4,5,6].includes(position))gaps.push('position '+String(e.position)+' requires official ST comparison');
  const n=k=>ext[k]??e[k];
  for(const key of ['sticky','cooldown','outlet_name','vectorized'])if(n(key)!==undefined&&n(key)!==null&&n(key)!==false&&n(key)!==0&&n(key)!=='')gaps.push(key+' requires golden parity');
  if((n('group')||n('group_weight'))&&!settings.localAdvancedRules)gaps.push('group/weight requires explicit local-compatible mode');
  if(settings.localAdvancedRules&&String(n('group')||'').includes(','))gaps.push('multiple inclusion groups require golden parity');
  if(ext.group_override===true||ext.use_group_scoring===true||e.groupOverride===true)gaps.push('group scoring requires golden parity');
  if(ext.useProbability===true||e.useProbability===true){const chance=Number(ext.probability??e.probability??100);if(!Number.isFinite(chance)||chance<0||chance>100)gaps.push('invalid probability');else if(chance>0&&chance<100&&!settings.localAdvancedRules)gaps.push('probability 1-99 requires explicit local-compatible mode');}
  if(Number(ext.scan_depth??e.scanDepth??0)<0)gaps.push('invalid per-entry scanDepth');
  if(position===4&&![0,1,2].includes(Number(ext.role??e.role??0)))gaps.push('unknown in-chat role');
  return gaps;
}
function validRegex(pattern){if(/(?:\w[*+?]){3,}/.test(pattern))throw error('E_REGEX_BUDGET','同步兼容 API 拒绝未证明安全的重复量词，交由隔离 Worker');if(pattern.length>512||/(\([^)]*[+*][^)]*\)[+*{])/.test(pattern)||/\([^)]*\)[+*{]/.test(pattern)||/\\[1-9]/.test(pattern)||/\(\?/.test(pattern))throw error('E_REGEX_BUDGET','复杂/潜在灾难性回溯正则未获沙箱预算校验');let m=pattern.match(/^\/(.*)\/([dgimsuvy]*)$/);const body=m?m[1]:pattern;if(/[.*+?^${}()|[\]\\]/.test(body))throw error('E_REGEX_ISOLATION_REQUIRED','同步兼容 API 仅支持安全字面量模式；复杂正则交给隔离 Worker');return m?new RegExp(m[1],m[2]):null;}
function hasKey(text,key,settings){if(typeof key==='string'&&key.startsWith('/'))throw error('E_REGEX_ISOLATION_REQUIRED','World Info 正则关键词需要隔离 Worker，不能在主线程求值');let src=String(text),k=String(key);if(!settings.caseSensitive){src=src.toLocaleLowerCase();k=k.toLocaleLowerCase();}if(!k)return false;let index=src.indexOf(k);if(index<0)return false;if(settings.matchWholeWords&&/^[\p{Script=Latin}\d_]+$/u.test(k)){const re=new RegExp('(^|[^\\p{L}\\d_])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\d_])','u');return re.test(src);}return true;}
// A reproducible LOCAL selection algorithm. It is intentionally not labelled
// SillyTavern RNG parity: the pinned upstream seed/PRNG still needs golden
// traces. A stable seed avoids a different lorebook on retry of the same turn.
function localUnit(seed,slot){
 let h=2166136261;
 const input=String(seed)+'\u001f'+String(slot);
 for(let i=0;i<input.length;i++){h=Math.imul(h^input.charCodeAt(i),16777619);}
 return (h>>>0)/4294967296;
}
function worldInfo(entries,history,settings={}){
 const inserted=[],skipped=[],matched=[];
 let used=0;const budget=Number.isFinite(settings.budgetChars)?settings.budgetChars:16000;
 const scanDepth=settings.scanDepth??100;
 const sorted=[...entries].map((e,idx)=>({e,idx})).sort((a,b)=>Number(b.e?.constant||false)-Number(a.e?.constant||false)||Number(b.e?.insertion_order??b.e?.order??100)-Number(a.e?.insertion_order??a.e?.order??100)||a.idx-b.idx);
 const activated=new Set(),excluded=new Set();
 const maxRecursion=Number.isSafeInteger(settings.maxRecursionSteps)&&settings.maxRecursionSteps>0?Math.min(settings.maxRecursionSteps,12):6;
 let newTexts=[];
 const scanBuffer=(messages,depth)=>{
   if(depth===0)return '';
   return messages.slice(-depth).map(m=>settings.includeNames===false?String(m.content):
    String(m.role==='user'?(settings.userName||'user'):m.role==='assistant'?(settings.charName||'assistant'):m.role)+': '+m.content).join('\n');
 };
 function entryFlags(e){const ext=e.extensions||{};return{
   excludeRecursion:ext.exclude_recursion===true||e.excludeRecursion===true,
   preventRecursion:ext.prevent_recursion===true||e.preventRecursion===true,
   delayUntilRecursion:ext.delay_until_recursion===true||e.delayUntilRecursion===true};}
 function matches(e,text){
   const primary=words(e.key??e.keys),secondary=words(e.keysecondary??e.secondary_keys);
   const opt={caseSensitive:e.extensions?.case_sensitive??e.caseSensitive??settings.caseSensitive??false,matchWholeWords:e.extensions?.match_whole_words??e.matchWholeWords??settings.matchWholeWords??false};
   const regexKey=e.use_regex===true||e.useRegex===true;
   const hitKey=k=>{
     if(regexKey){
       // Never evaluate imported patterns on the browser main thread.
       if(settings.isolatedRegexWorldInfo!==true)throw error('E_REGEX_ISOLATION_REQUIRED','世界书正则关键词必须在可终止的 Worker 中匹配');
       const raw=String(k);if(raw.length>1024)throw error('E_REGEX_BUDGET','世界书正则关键词超过 1024 字符');
       const literal=/^\/(.*)\/([dgimsuvy]*)$/s.exec(raw);
       let expression;try{expression=literal?new RegExp(literal[1],literal[2]):new RegExp(raw,opt.caseSensitive?'u':'iu');}
       catch(e){throw error('E_REGEX_PHASE_UNSUPPORTED','世界书关键词正则无效：'+e.message);}
       expression.lastIndex=0;return expression.test(text);
     }
     if(String(k).startsWith('/'))throw error('E_REGEX_ISOLATION_REQUIRED','斜杠正则关键词需要明确的 use_regex 标志与 Worker');
     return hasKey(text,k,opt);
   };
   // Native worldbook settings use ALL primary keywords only when explicitly
   // configured; secondary keywords require ANY match. Tavern's selective
   // logic is different, so preserve both without changing card rules.
   let hit=e.nativeAllKeywords===true?primary.length>0&&primary.every(hitKey):primary.some(hitKey);
   if(hit&&e.nativeSecondaryAny===true&&secondary.length)hit=secondary.some(hitKey);
   if(hit&&!regexKey&&e.selective===true&&secondary.length){
     // CCv3: use_regex keys ignore secondary_keys.
     const found=secondary.filter(hitKey).length,logic=Number(e.extensions?.selectiveLogic??e.selectiveLogic??0);
     if(![0,1,2,3].includes(logic))throw error('E_RESOURCE_SEMANTIC_GAP','未知世界书筛选逻辑 '+logic);
     hit=logic===0?found>0:logic===1?found!==secondary.length:logic===2?found===0:found===secondary.length;}
   return hit;
 }
 // Each sweep can add at most one copy of any entry. A bounded fixed point
 // prevents recursive lorebooks from looping or exhausting a browser tab.
 for(let level=0;level<=(settings.recursiveScan===false?0:maxRecursion);level++){
   const fresh=[],candidates=[];
   for(const {e,idx} of sorted){
     if(!e||typeof e!=='object'){if(level===0)skipped.push({entryId:String(idx),reason:'invalid object'});continue;}
     const id=hashKey(e);if(activated.has(idx)||excluded.has(idx))continue;
     if(e.disable===true||e.enabled===false){if(level===0){excluded.add(idx);skipped.push({entryId:id,reason:'disabled'});}continue;}
     const gaps=unsupportedWI(e,settings);if(gaps.length){if(level===0){excluded.add(idx);skipped.push({entryId:id,reason:'E_RESOURCE_SEMANTIC_GAP',gaps});}continue;}
     const flags=entryFlags(e);if(level===0&&flags.delayUntilRecursion)continue;
     if(level>0&&flags.excludeRecursion)continue;
     const wait=Number(e.extensions?.delay??e.delay??0);
     if(!Number.isSafeInteger(wait)||wait<0){if(level===0){excluded.add(idx);skipped.push({entryId:id,reason:'E_RESOURCE_SEMANTIC_GAP',gaps:['invalid activation delay']});}continue;}
     if(history.length<wait){if(level===0){excluded.add(idx);skipped.push({entryId:id,reason:'delay',messagesRequired:wait});}continue;}
     const perDepth=Number(e.extensions?.scan_depth??e.scan_depth??e.scanDepth??scanDepth);
     if(!Number.isSafeInteger(perDepth)||perDepth<0){if(level===0){excluded.add(idx);skipped.push({entryId:id,reason:'E_RESOURCE_SEMANTIC_GAP',gaps:['invalid World Info scan depth']});}continue;}
     const text=level===0?scanBuffer(history,perDepth):newTexts.join('\n');
     let hit=false;try{hit=level===0&&e.constant===true||matches(e,text);}catch(ex){excluded.add(idx);skipped.push({entryId:id,reason:ex.code||'E_WORLDINFO_EVAL',gaps:[ex.message]});continue;}
     if(!hit)continue;
     const chance=Number(e.extensions?.probability??e.probability??100);
     if(e.extensions?.useProbability===true||e.useProbability===true){
       const probabilityRoll=settings.localAdvancedRules?localUnit(settings.seed??'',id+':'+idx):0;
       if(chance===0||settings.localAdvancedRules&&probabilityRoll*100>=chance){
         excluded.add(idx);skipped.push({entryId:id,reason:chance===0?'probability_zero':'probability_miss',chance,roll:settings.localAdvancedRules?probabilityRoll:null});continue;
       }
     }
     candidates.push({e,idx,id,level,perDepth,flags});
   }
   // Group decisions are made after the complete scan, never based on the
   // first entry encountered in the source. Winners are per scan level.
   const groupChoices=new Map();
   if(settings.localAdvancedRules){
     const pools=new Map();
     for(const c of candidates){
       const group=String(c.e.extensions?.group??c.e.group??'').trim();if(!group)continue;
       const weight=Number(c.e.extensions?.group_weight??c.e.group_weight??c.e.groupWeight??100);
       if(!Number.isFinite(weight)||weight<0||weight>100000){excluded.add(c.idx);skipped.push({entryId:c.id,reason:'invalid_group_weight'});continue;}
       if(!pools.has(group))pools.set(group,[]);
       pools.get(group).push({c,weight});
     }
     for(const [group,pool] of pools){
       const total=pool.reduce((n,row)=>n+row.weight,0);
       // Zero sum has no eligible winner and is not guessed as a success.
       if(total<=0){for(const row of pool){excluded.add(row.c.idx);skipped.push({entryId:row.c.id,reason:'local_group_weight_zero',group});}continue;}
       let draw=localUnit(settings.seed??'',group+':draw')*total;
       for(const row of pool){draw-=row.weight;if(draw<0){groupChoices.set(group,row.c.idx);break;}}
     }
   }
   for(const {e,idx,id,level:recursionLevel,perDepth,flags} of candidates){
     if(excluded.has(idx))continue;
     const group=String(e.extensions?.group??e.group??'').trim();
     if(group&&settings.localAdvancedRules&&groupChoices.get(group)!==idx){
       excluded.add(idx);skipped.push({entryId:id,reason:'local_group_not_selected',group});continue;
     }
     const content=String(e.content||'');
     matched.push({entryId:id,reason:recursionLevel>0?'recursive':e.constant?'constant':'keyword',scanDepth:perDepth,recursionLevel});
     activated.add(idx);
     if(used+content.length>budget){skipped.push({entryId:id,reason:'budget',chars:content.length});continue;}
     const position=wiPosition(e),depth=position===4?Number(e.extensions?.depth??e.depth??0):0;
     if(!Number.isInteger(depth)||depth<0||depth>100){skipped.push({entryId:id,reason:'E_RESOURCE_SEMANTIC_GAP',gaps:['invalid in-chat depth']});continue;}
    used+=content.length;inserted.push({entryId:id,content,position,depth,order:Number(e.order??e.insertion_order??100),role:position===4?['system','user','assistant'][Number(e.extensions?.role??e.role??0)]:'system',sourcePath:e.__mimaSourcePath||'world_info.entries['+idx+']',sourceId:e.__mimaSourceId,resourceId:e.__mimaResourceId});
     if(!flags.preventRecursion)fresh.push(content);
   }
   if(!fresh.length||level===maxRecursion)break;
   newTexts=fresh;
 }
 for(const {e,idx} of sorted){if(e&&typeof e==='object'&&!activated.has(idx)&&!excluded.has(idx))skipped.push({entryId:hashKey(e),reason:'no matching key'});}
 inserted.sort((a,b)=>a.order-b.order||Number(a.sourcePath.match(/\d+/)?.[0]??0)-Number(b.sourcePath.match(/\d+/)?.[0]??0));
 return{matched,inserted,skipped,budgetChars:budget,usedChars:used,semanticGaps:[...skipped.filter(x=>x.gaps),...(settings.localAdvancedRules&&entries.some(e=>e&&(e.group||e.extensions?.group||e.useProbability||e.extensions?.useProbability))?[{reason:'LOCAL_ADVANCED_RULES_NOT_ST_GOLDEN_EQUIVALENT'}]:[])],parityVerified:false,recursionLimit:maxRecursion,selectionAlgorithm:settings.localAdvancedRules?'deterministic_local_v1':'disabled'};
}
function applyRegex(input,rules,phase,{isMarkdown=false,depth=0}={}){let out=String(input),trace=[];for(const [i,r]of rules.entries()){if(!r||r.disabled===true)continue;const placement=r.placement;if(!Array.isArray(placement)||!placement.includes(phase))continue;
if(r.markdownOnly===true&&!isMarkdown||r.promptOnly===true&&isMarkdown||Number.isInteger(r.minDepth)&&depth<r.minDepth||Number.isInteger(r.maxDepth)&&depth>r.maxDepth)continue;
if(r.substituteRegex!==undefined&&r.substituteRegex!==0)throw error('E_REGEX_PHASE_UNSUPPORTED','ST substituteRegex 宏替换尚未对照；规则 '+i+' 已阻断');if((r.trimStrings||[]).length)throw error('E_REGEX_PHASE_UNSUPPORTED','ST trimStrings 尚未对照；规则 '+i+' 已阻断');let re;try{re=validRegex(r.findRegex||'');if(!re)re=new RegExp(r.findRegex||'',r.flags||'g');}catch(e){throw error(e.code||'E_REGEX_PHASE_UNSUPPORTED','正则规则 '+i+' 无法安全执行：'+e.message);}out=out.replace(re,String(r.replaceString??''));trace.push({index:i,phase,beforeLength:String(input).length,afterLength:out.length});}return{output:out,trace};}
function macro(str,ctx){let unsupported=[];const value=String(str??'')
 .replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(original,k)=>{const id=k.trim().toLowerCase();if(id==='char')return ctx.char||'角色';if(id==='user')return ctx.user||'玩家';unsupported.push(id);return original;})
 .replace(/<(char|bot|user|player)>/gi,(_,tag)=>/^(char|bot)$/i.test(tag)?ctx.char||'角色':ctx.user||'玩家');
 return{value,unsupported};}
function entriesFromResources(resources){const entries=[];for(const r of resources)if(r.kind==='world_info'){const data=r.raw?.entries,items=Array.isArray(data)?data.map((e,i)=>[i,e]):data&&typeof data==='object'?Object.entries(data):[];for(const [key,e] of items)entries.push(e&&typeof e==='object'?{...e,__mimaSourcePath:r.path+'.entries['+String(key)+']',__mimaSourceId:r.sourceId,__mimaResourceId:r.id}:e);}return entries;}
function readRegex(resources,session={}){
 const all=[],settings=session.regexSettings||{},overrides=settings.overrides||{};
 const ordered=resources.filter(r=>r.kind==='regex').map((resource,index)=>({resource,index})).sort((a,b)=>Number(a.resource.sourceId===session.sourceId)-Number(b.resource.sourceId===session.sourceId)||a.index-b.index);
 for(const {resource}of ordered){const values=Array.isArray(resource.raw)?resource.raw:[resource.raw];
  for(const [index,value]of values.entries()){if(!value||typeof value!=='object')continue;const key=String(resource.id||resource.path)+':'+index,override=overrides[key]||{};
   all.push({...value,...(override.rule||{}),...(typeof override.enabled==='boolean'?{disabled:!override.enabled}:{}),__mimaRegexRef:{key,resourceId:resource.id||null,index,sourceId:resource.sourceId||null,path:resource.path+(Array.isArray(resource.raw)?'['+index+']':''),scope:resource.sourceId===session.sourceId?'card':'mounted',overridden:!!overrides[key]}});
  }
 }
 if(Array.isArray(settings.order)){const rank=new Map(settings.order.map((key,index)=>[key,index]));all.sort((a,b)=>(rank.get(a.__mimaRegexRef.key)??settings.order.length)-(rank.get(b.__mimaRegexRef.key)??settings.order.length));}
 return all;
}
async function regexMacroContext(session,resources){
 const card=resources.find(r=>r.kind==='character')?.raw||{},context={char:card.nickname||card.name||'角色',user:session.userName||'玩家',description:String(card.description||''),personality:String(card.personality||''),scenario:String(card.scenario||''),persona:String(session.personaDescription||''),mesexamples:String(card.mes_example||'')};
 const id=session.id+':__stscript_local_v1';
 if(root.MimaCompatStore?.get){const row=await store().get('variables',id);if(row&&(row.id!==id||row.sessionId!==session.id||row.namespace!=='stscript'||!Number.isInteger(row.revision)||!row.value||typeof row.value!=='object'||Array.isArray(row.value)))throw error('E_STORE_UNVERIFIED','正则变量不是经过验证的本剧情 STscript 来源');context.variables=row?.value||{};}
 return context;
}
async function regexProjection(items,rules,options={}){
 const isolate=root.MimaCompatRegexIsolation;if(!isolate?.applyBatch)throw error('E_REGEX_ISOLATION_UNAVAILABLE','正则隔离执行器未加载');
 if(!items.length)return[];
 // ST applies unflagged scripts before ephemeral display/prompt scripts. Both
 // passes operate on disposable copies; the original message stays canonical.
 const source=await isolate.applyBatch(items.map(item=>({...item,options:{...item.options,isMarkdown:false,isPrompt:false}})),rules,options);
 const projected=await isolate.applyBatch(items.map((item,index)=>({...item,input:source[index]?.result?.output??String(item.input),options:{...item.options,isMarkdown:options.isMarkdown===true,isPrompt:options.isPrompt===true}})),rules,options);
 return projected.map((packet,index)=>{const first=source[index],errors=[...(first?.result?.errors||(first?.ok?[]:[first.error])),...(packet?.result?.errors||(packet?.ok?[]:[packet.error]))].filter(Boolean);
  const result={output:packet?.result?.output??first?.result?.output??String(items[index].input),trace:[...(first?.result?.trace||[]),...(packet?.result?.trace||[])],errors};
  return{ok:errors.length===0,result,...(errors.length?{error:errors[0]}:{})};
 });
}
async function saveRegexSettings(sessionId,change){
 const session=await getSession(sessionId),resources=await resourcesFor(session),rules=readRegex(resources,session),keys=new Set(rules.map(r=>r.__mimaRegexRef.key));
 if(session.pendingTurnId)throw error('E_CANONICAL_CONFLICT','请等待当前回合结算后再保存正则设置');
 const current=session.regexSettings||{},settings={...current,overrides:{...(current.overrides||{})}};
 if(change?.order){if(!Array.isArray(change.order)||change.order.length!==keys.size||new Set(change.order).size!==keys.size||change.order.some(key=>!keys.has(key)))throw error('E_REGEX_SETTINGS','规则排序与当前挂载不一致，请重新打开列表');settings.order=change.order.slice();}
 if(change?.key){if(!keys.has(change.key))throw error('E_REGEX_SETTINGS','正则来源已变化，未保存旧规则');
  if(change.reset)delete settings.overrides[change.key];
  else{const value={...(settings.overrides[change.key]||{})};if(typeof change.enabled==='boolean')value.enabled=change.enabled;
   if(change.rule){const allowed=['scriptName','findRegex','replaceString','trimStrings','placement','markdownOnly','promptOnly','runOnEdit','substituteRegex','minDepth','maxDepth','flags'];
    if(Object.keys(change.rule).some(key=>!allowed.includes(key)))throw error('E_REGEX_SETTINGS','规则包含不可修改的来源字段');
    const rule=change.rule;if(typeof rule.findRegex!=='string'||rule.findRegex.length>2048||typeof rule.replaceString!=='string'||rule.replaceString.length>262144||!Array.isArray(rule.placement)||rule.placement.some(n=>![0,1,2,3,5,6].includes(n))||!Array.isArray(rule.trimStrings)||rule.trimStrings.length>32||rule.trimStrings.some(t=>typeof t!=='string'||t.length>256)||![0,1,2].includes(Number(rule.substituteRegex??0)))throw error('E_REGEX_SETTINGS','规则格式或隔离运行预算无效；未裁剪内容或覆盖原卡');
    value.rule=structuredClone(rule);
   }settings.overrides[change.key]=value;
  }
 }
 if(JSON.stringify(settings).length>512000)throw error('E_REGEX_SETTINGS','本剧情正则覆盖超过保存预算，未裁剪或保存');
 return store().putCAS('compat_sessions',{...session,regexSettings:settings},session.revision);
}
// External ST presets must participate in the outgoing provider request.
// Only an explicitly mounted resource from another capsule is user-authorized;
// native card system_prompt/post_history_instructions are already included once.
// Keep the resource's immutable origin and unsupported prompt-manager semantics visible.
function mountedPresetInstructions(session,resources){
 const instructions=[],gaps=[];
 const placement=(item,resource)=>{
  const position=Number(item.injection_position??0),depth=Number(item.injection_depth??0),order=Number(item.injection_order??100);
  if(![0,1].includes(position))gaps.push({slot:'preset',resourceId:resource.id,reason:'unsupported_injection_position_preserved_in_order',value:item.injection_position});
  if(position===1&&(!Number.isSafeInteger(depth)||depth<0||depth>100))throw error('E_RESOURCE_SEMANTIC_GAP','外置预设的聊天深度无效：'+resource.path);
  for(const key of ['injection_trigger','forbid_overrides'])if(item[key]!==undefined&&item[key]!==false&&(!Array.isArray(item[key])||item[key].length))gaps.push({slot:'preset',resourceId:resource.id,reason:'unsupported_preset_field',field:key});
  return {injectionPosition:position===1?1:0,injectionDepth:position===1?depth:0,injectionOrder:Number.isFinite(order)?order:100};
 };
 const external=resources.filter(r=>['preset','prompt_presets'].includes(r.kind)&&r.sourceId!==session.sourceId);
 for(const resource of external){
  const raw=resource.raw;
  if(typeof raw==='string'){
   if(!raw.trim())throw error('E_RESOURCE_SEMANTIC_GAP','挂载预设为空：'+resource.path);
   instructions.push({content:raw,resourceId:resource.id,path:resource.path,role:'system'});continue;
  }
  if(!raw||typeof raw!=='object')throw error('E_RESOURCE_SEMANTIC_GAP','挂载预设不是可执行的文字格式：'+resource.path);
  if(Array.isArray(raw.prompts)){
   const available=new Map(raw.prompts.filter(x=>x&&typeof x==='object'&&typeof x.identifier==='string').map(x=>[x.identifier,x]));
   const orders=Array.isArray(raw.prompt_order)?raw.prompt_order:[];
   // 100000 is the default/global SillyTavern prompt-order entry.
   const defaultOrder=orders.find(x=>Number(x?.character_id)===100000)||(orders.length===1?orders[0]:null);
   if(orders.length>1&&!orders.some(x=>Number(x?.character_id)===100000))
    throw error('E_RESOURCE_SEMANTIC_GAP','预设有多份专属角色排序，但缺少可识别的全局排序：'+resource.path);
   const ordered=Array.isArray(defaultOrder?.order)?defaultOrder.order.map(ref=>{
     if(ref?.enabled===false)return null;
     if(!available.has(ref?.identifier)){
       if(['chatHistory','charDescription','charPersonality','scenario','worldInfoBefore','worldInfoAfter','dialogueExamples','personaDescription'].includes(ref?.identifier))return {identifier:ref.identifier,content:'',role:'user',marker:true};
       gaps.push({slot:'preset',resourceId:resource.id,reason:'unknown_prompt_identifier',identifier:ref?.identifier});return null;
     }
     return available.get(ref.identifier);
   }).filter(Boolean):raw.prompts.filter(p=>p?.enabled!==false);
   if(orders.length>1)gaps.push({slot:'preset',resourceId:resource.id,reason:'character_specific_order_not_equivalent'});
   let inserted=0,dynamic=0;
   for(const item of ordered){
    const body=String(item?.content??'');
    if(!body.trim()){
      if(['chatHistory','charDescription','charPersonality','scenario','worldInfoBefore','worldInfoAfter','dialogueExamples','personaDescription'].includes(item?.identifier)){
        instructions.push({dynamic:item.identifier,resourceId:resource.id,path:resource.path,identifier:item.identifier});dynamic++;
      }else if(item?.identifier){
        gaps.push({slot:'preset',resourceId:resource.id,reason:'unsupported_dynamic_slot',identifier:item.identifier});
      }
      continue;
    }
    const role=item.role??'system';
    if(!['system','user','assistant'].includes(role))throw error('E_RESOURCE_SEMANTIC_GAP','外置预设的消息角色无法验证：'+resource.path+' / '+String(item.identifier));
    instructions.push({content:body,resourceId:resource.id,path:resource.path,identifier:item.identifier||'',role,...placement(item,resource)});inserted++;
   }
   if(!inserted&&!dynamic)throw error('E_RESOURCE_SEMANTIC_GAP','挂载预设没有可执行文本，也没有支持的聊天历史插槽：'+resource.path);
   if(dynamic&&!session.experimentalChatHistorySlot)gaps.push({slot:'preset',resourceId:resource.id,reason:'chat_history_order_requires_opt_in'});
   gaps.push({slot:'preset',resourceId:resource.id,reason:'ST_dynamic_slots_and_order_golden_parity_unverified'});
   continue;
  }
  const body=raw.content??raw.prompt??raw.system_prompt;
  if(typeof body!=='string'||!body.trim())throw error('E_RESOURCE_SEMANTIC_GAP','挂载预设不含可执行文字：'+resource.path);
  const role=raw.role??'system';
  if(!['system','user','assistant'].includes(role))throw error('E_RESOURCE_SEMANTIC_GAP','外置预设的消息角色无效：'+resource.path);
  instructions.push({content:body,resourceId:resource.id,path:resource.path,role,...placement(raw,resource)});
 }
 return {instructions,gaps};
}
function worldInfoSettings(session,name,u,userText){return {budgetChars:session.worldInfoBudget??16000,scanDepth:session.worldInfoScanDepth??100,recursiveScan:session.worldInfoRecursiveScan!==false,maxRecursionSteps:session.worldInfoMaxRecursionSteps??6,localAdvancedRules:session.worldInfoLocalAdvancedRules===true,seed:session.id+'|'+((session.turnIndex??0)-(session.pendingTurnId?1:0))+'|'+userText,includeNames:session.worldInfoIncludeNames!==false,userName:u,charName:name};}
function createEnvelope(session,resources,messages,userText,{skipRegex=false,worldInfoOverride=null,assistantContinuation=false}={}){
 const selected=resources.find(r=>r.kind==='character'),card=selected?.raw;
 if(!card)throw error('E_RESOURCE_SEMANTIC_GAP','本来源没有已选定角色');
 const name=card.nickname||card.name||'角色',u=session.userName||'玩家',ctx={char:name,user:u};
 const committed=messages.filter(m=>m.status==='committed'&&!(m.role==='assistant'&&!approvedReply(m)&&(m.metadata?.providerRefused===true||m.metadata?.providerFinishKind==='blocked'||['content_filter','safety','blocked','refusal'].includes(m.metadata?.providerFinishReason))));
 const history=committed.map(m=>({role:m.role,content:m.canonicalContent}));
 const greeting=String((session.greetingIndex??0)===0?card.first_mes||'':(card.alternate_greetings||[])[(session.greetingIndex??0)-1]||'');
 const needsMvu=/<(?:initvar|UpdateVariable)\b/i.test(greeting)||resources.some(r=>r.kind==='variable_schema'||r.kind==='world_info'&&Object.values(r.raw?.entries||{}).some(e=>/\[?initvar\]?/i.test(String(e?.comment||e?.name||''))));
 if(needsMvu&&!mvu())throw error('E_MVU_UNAVAILABLE','卡片需要 MVU，但安全解析组件未加载');
 const mvuInit=needsMvu?mvu().initial(resources,{greetingIndex:session.greetingIndex??0}):{state:null,gaps:[]};
 if(/<initvar\b/i.test(greeting)&&mvuInit?.state===null)throw error('E_MVU_INIT_UNVERIFIED','当前开场白的 InitVar 无法验证；为防止错误状态进入剧情，本回合不调用模型');
 if(mvuInit?.state===null&&messages.some(x=>x.status==='committed'&&x.mvuStateAfter!==undefined))throw error('E_MVU_HISTORY_CONFLICT','旧剧情已有 MVU 状态，但当前初始变量来源缺失；不得用空状态继续');
 const mvuState=mvuInit?.state!==null?mvu()?.replay(mvuInit?.state??null,messages):{active:false,state:null};
 const wi=worldInfoOverride??worldInfo(entriesFromResources(resources),[...history,...(assistantContinuation?[]:[{role:'user',content:userText}])],worldInfoSettings(session,name,u,userText));
 const regex=readRegex(resources,session),regexTrace=[],segments=[],mountedPreset=mountedPresetInstructions(session,resources);
 const gaps=[...wi.semanticGaps,...mountedPreset.gaps,...(mvuInit?.gaps||[])];
 for(const resource of resources.filter(r=>['script_source','quick_reply','html_template','plugin_bundle','raw_unknown'].includes(r.kind)))gaps.push({resourceId:resource.id,path:resource.path,slot:resource.kind,reason:'retained_not_automatically_executed'});
 const metadataExtensions=new Set(['depth_prompt','talkativeness','fav','world','chara_id','character_id','create_date','date_added','date_last_chat']);
 for(const key of Object.keys(card.extensions||{}))if(!metadataExtensions.has(key)&&!resources.some(r=>r!==selected&&String(r.path).startsWith(selected.path+'.extensions.'+key)))gaps.push({resourceId:selected.id,path:selected.path+'.extensions.'+key,slot:'extension',reason:'extension_retained_unconsumed'});

 const cardSource={kind:'character_field',sourceId:selected.sourceId,resourceId:selected.id,path:selected.path,name};
 const loreSource=e=>({kind:'world_info',sourceId:e.sourceId||session.sourceId,resourceId:e.resourceId,path:e.sourcePath,entryId:e.entryId,position:e.position,depth:e.depth,declaredRole:e.role});
 function expand(value,source){const resolved=macro(value,ctx);if(resolved.unsupported.length)gaps.push({slot:source.slot||source.kind,resourceId:source.resourceId,reason:'unsupported_macros_preserved',macros:resolved.unsupported});return resolved.value;}
 function add(slot,value,source=cardSource){if(!value)return;const origin={...source,slot};const content=expand(value,origin);segments.push({id:'segment_'+segments.length,slot,role:'system',content,tokenEstimate:Math.ceil(content.length/3),source:name,origin});}
 for(const e of wi.inserted.filter(e=>e.position===0))add('world_info_before',e.content,loreSource(e));
 add('character_name',card.name);if(card.nickname&&card.nickname!==card.name)add('character_nickname',card.nickname);
 add('character_description',card.description);add('personality',card.personality);add('scenario',card.scenario);add('system_prompt',card.system_prompt);
 for(const e of wi.inserted.filter(e=>e.position===1))add('world_info_after',e.content,loreSource(e));
 for(const e of wi.inserted.filter(e=>e.position===5))add('world_info_before_examples',e.content,loreSource(e));
 add('mes_example',card.mes_example);
 if(card.mes_example)gaps.push({slot:'mes_example',reason:'dialogue_examples_preserved_as_system_material_not_ST_message_parity'});
 for(const e of wi.inserted.filter(e=>e.position===6))add('world_info_after_examples',e.content,loreSource(e));
 if(session.personaDescription)add('player_persona',session.personaDescription,{kind:'persona',sourceId:session.id,path:'session.personaDescription',name:u});
 const resolvedPresets=mountedPreset.instructions.map(item=>{
  if(item.dynamic)return {...item,content:'',effectiveRole:'slot'};
  const resource=resources.find(r=>r.id===item.resourceId);
  const mount=(session.mountGraph||[]).find(m=>m.enabled&&m.resourceId===item.resourceId&&m.sourceId===resource?.sourceId);
  // Old trustedCreativeRole=false meant absent consent, not a user role choice.
  // A new explicit override can still send this mounted resource as user data.
  const effectiveRole=mount?.creativeRoleOverride==='user'?'user':item.role;
  return {...item,sourceId:resource?.sourceId,content:expand(item.content,{kind:'preset',resourceId:item.resourceId}),effectiveRole};
 });
 const payload=[],sourceByMessage=new WeakMap();
 const tagged=(message,source)=>{sourceByMessage.set(message,source);return message;};
 const emit=(role,content,source)=>{const message=tagged({role,content:String(content??'')},source);payload.push(message);return message;};
 const assistantHistory=history.map((m,index)=>tagged({role:m.role,content:m.role==='assistant'&&!skipRegex?applyRegex(m.content,regex,2,{isMarkdown:false}).output:m.content},
  {kind:'canonical_history',sourceId:session.id,messageId:committed[index].id,sequence:committed[index].sequence,declaredRole:m.role}));
 const historyRefs=new WeakSet(assistantHistory);
 const projectSegments=(list,marker='fallback')=>{for(const segment of list)emit('system',segment.content,{...segment.origin,segmentId:segment.id,presetDynamicMarker:marker});};
 const addState=()=>{if(mvuState?.active)emit('system',JSON.stringify(mvuState.state),{kind:'mvu_state',sourceId:session.id,path:'committed_history.mvu_state'});};
 const addChat=()=>{payload.push(...assistantHistory);if(!assistantContinuation){const projected=skipRegex?{output:String(userText),trace:[]}:applyRegex(userText,regex,1,{isMarkdown:false});regexTrace.push(...projected.trace);emit('user',projected.output,{kind:'player_input',sourceId:session.id,declaredRole:'user'});}};
 const emitPreset=item=>emit(item.effectiveRole,item.content,{kind:'preset',sourceId:item.sourceId,resourceId:item.resourceId,path:item.path,identifier:item.identifier||'',declaredRole:item.role,injectionPosition:item.injectionPosition??0,depth:item.injectionDepth??0});
 const inChatPresets=resolvedPresets.filter(item=>!item.dynamic&&item.injectionPosition===1);
 const orderedPresets=resolvedPresets.filter(item=>item.dynamic||item.injectionPosition!==1);
 const useDynamicSlots=session.experimentalChatHistorySlot===true&&orderedPresets.some(item=>item.dynamic);
 if(!useDynamicSlots){
  orderedPresets.filter(item=>!item.dynamic).forEach(emitPreset);projectSegments(segments);addState();addChat();
 }else{
  const slotMap={worldInfoBefore:['world_info_before'],charDescription:['character_description'],charPersonality:['personality'],scenario:['scenario'],worldInfoAfter:['world_info_after'],dialogueExamples:['world_info_before_examples','mes_example','world_info_after_examples'],personaDescription:['player_persona']};
  const touched=new Set();for(const item of orderedPresets)if(item.dynamic&&slotMap[item.dynamic])for(const slot of slotMap[item.dynamic])touched.add(slot);
  projectSegments(segments.filter(x=>!touched.has(x.slot)),'unreferenced');addState();
  const emitted=new Set();let chatEmitted=false;
  for(const item of orderedPresets){
   if(!item.dynamic){emitPreset(item);continue;}
   if(item.dynamic==='chatHistory'){if(chatEmitted){gaps.push({slot:'preset',reason:'duplicate_chat_history_marker_skipped',resourceId:item.resourceId});continue;}addChat();chatEmitted=true;continue;}
   if(item.dynamic==='personaDescription'&&!session.personaDescription){gaps.push({slot:'preset',reason:'persona_description_source_unavailable',resourceId:item.resourceId});continue;}
   const names=slotMap[item.dynamic];if(!names){gaps.push({slot:'preset',reason:'unsupported_dynamic_slot',identifier:item.dynamic});continue;}
   if(emitted.has(item.dynamic)){gaps.push({slot:'preset',reason:'duplicate_dynamic_marker_skipped',identifier:item.dynamic});continue;}
   emitted.add(item.dynamic);projectSegments(segments.filter(x=>names.includes(x.slot)),item.dynamic);
  }
  if(!chatEmitted){addChat();gaps.push({slot:'preset',reason:'chat_history_marker_missing_appended_to_preserve_history'});}
  else gaps.push({slot:'preset',reason:'LOCAL_CHAT_HISTORY_SLOT_NOT_ST_GOLDEN_EQUIVALENT'});
  gaps.push({slot:'preset',reason:'LOCAL_PRESET_DYNAMIC_SLOTS_NOT_ST_GOLDEN_EQUIVALENT'});
 }
 // Depth counts actual conversation messages, never resource headers.
 const depthAnchor=depth=>{const indices=payload.flatMap((m,index)=>['canonical_history','player_input'].includes(sourceByMessage.get(m)?.kind)?[index]:[]);return depth===0?payload.length:indices[Math.max(0,indices.length-depth)]??payload.length;};
 for(const item of [...inChatPresets].sort((a,b)=>b.injectionDepth-a.injectionDepth||a.injectionOrder-b.injectionOrder)){
  const at=depthAnchor(item.injectionDepth),message=tagged({role:item.effectiveRole,content:item.content},{kind:'preset',sourceId:item.sourceId,resourceId:item.resourceId,path:item.path,identifier:item.identifier||'',declaredRole:item.role,injectionPosition:1,depth:item.injectionDepth});payload.splice(at,0,message);
 }
 for(const e of wi.inserted.filter(e=>e.position===4).sort((a,b)=>b.depth-a.depth||a.order-b.order)){
  const origin=loreSource(e),message=tagged({role:e.role,content:expand(e.content,origin)},origin);payload.splice(depthAnchor(e.depth),0,message);
 }
 // A.N. is a separate explicit source; never route A.N. entries to examples.
 const note=session.authorNote,anRows=wi.inserted.filter(e=>e.position===2||e.position===3);
 if(note&&typeof note.content==='string'&&note.content.trim()){
  const depth=Number(note.depth??0),role=note.role||'system';
  if(!Number.isInteger(depth)||depth<0||depth>100||!['system','user','assistant'].includes(role))throw error('E_RESOURCE_SEMANTIC_GAP','作者注记的位置或角色无效');
  const body=[...anRows.filter(e=>e.position===2).map(e=>expand(e.content,loreSource(e))),expand(note.content,{kind:'author_note',path:'session.authorNote'}),...anRows.filter(e=>e.position===3).map(e=>expand(e.content,loreSource(e)))].join('\n');
  payload.splice(depthAnchor(depth),0,tagged({role,content:body},{kind:'author_note',sourceId:session.id,path:'session.authorNote',depth,declaredRole:role,entries:anRows.map(loreSource)}));
 }else for(const e of anRows)gaps.push({...loreSource(e),slot:'author_note',reason:'author_note_context_unavailable'});
 const depthPrompt=card.extensions?.depth_prompt;
 if(depthPrompt&&typeof depthPrompt==='object'&&String(depthPrompt.prompt||'').trim()){
  const depth=Number(depthPrompt.depth??4),role=depthPrompt.role||'system',origin={...cardSource,kind:'character_depth_prompt',path:selected.path+'.extensions.depth_prompt',depth,declaredRole:role};
  if(!Number.isInteger(depth)||depth<0||depth>100||!['system','user','assistant'].includes(role))throw error('E_RESOURCE_SEMANTIC_GAP','角色 depth_prompt 的深度或消息角色无效');
  payload.splice(depthAnchor(depth),0,tagged({role,content:expand(depthPrompt.prompt,origin)},origin));
 }else if(depthPrompt&&String(depthPrompt.prompt||'').trim())gaps.push({...cardSource,slot:'depth_prompt',reason:'unsupported_depth_prompt_shape'});
 if(card.post_history_instructions)emit('system',expand(card.post_history_instructions,{...cardSource,slot:'post_history_instructions'}),{...cardSource,slot:'post_history_instructions',declaredRole:'system',position:'post_history'});
 // Resource messages with role=user are user-authored configurations, not new
 // player speech. Keep the last real player utterance last among user messages.
 const player=payload.findLast(m=>m.role==='user'&&['player_input','canonical_history'].includes(sourceByMessage.get(m)?.kind));
 if(player){const after=payload.slice(payload.indexOf(player)+1).filter(m=>m.role==='user'&&!['player_input','canonical_history'].includes(sourceByMessage.get(m)?.kind));for(const message of after){payload.splice(payload.indexOf(message),1);payload.splice(payload.indexOf(player),0,message);sourceByMessage.get(message).positionAdaptation='before_latest_player_input';gaps.push({slot:sourceByMessage.get(message).kind,reason:'user_resource_position_adapted_before_latest_player',resourceId:sourceByMessage.get(message).resourceId});}}
 if(assistantContinuation){
  const target=payload.findLast(m=>m.role==='assistant'&&sourceByMessage.get(m)?.kind==='canonical_history');
  if(target){const at=payload.indexOf(target),tail=payload.splice(at+1);payload.splice(at,0,...tail);for(const message of tail){sourceByMessage.get(message).positionAdaptation='before_continuation_target';gaps.push({slot:sourceByMessage.get(message).kind,reason:'resource_position_adapted_before_continuation_target'});}}
 }
 const messageSources=payload.map(message=>sourceByMessage.get(message));
 return {mvu:{required:needsMvu,active:!!mvuState?.active,state:mvuState?.state??null,initial:mvuInit?.state??null},segments,presetTrace:resolvedPresets.map(x=>({resourceId:x.resourceId,path:x.path,identifier:x.identifier||'',chars:x.content.length,role:x.effectiveRole,declaredRole:x.role,injectionPosition:x.injectionPosition??0,depth:x.injectionDepth??0})),worldInfo:wi,regexTrace,messages:payload,messageSources,assistantContinuation,historyMessageIndices:payload.flatMap((m,index)=>historyRefs.has(m)?[index]:[]),gaps,provider:'OpenAI-compatible',estimatedTokens:payload.reduce((n,m)=>n+Math.ceil(m.content.length/3),0)};
}
async function getSession(id){const s=await store().get('compat_sessions',id);if(!s)throw error('E_STORE_UNVERIFIED','未找到兼容剧情');return s;}
// A source capsule may outlive a parser upgrade. Array indices are merely
// per-import presentation positions, not persistent character identities.
// Match the immutable, version-qualified path AND original JSON before use.
function resolveCharacterSelection(sourceId,scanned,persisted){
  if(!/^sha256:[0-9a-f]{64}$/.test(String(sourceId||''))||!scanned||scanned.kind!=='character'||typeof scanned.path!=='string'||!Array.isArray(persisted))
    throw error('E_RESOURCE_VERSION_CONFLICT','角色卡版本选择无效，未建立剧情');
  const candidates=persisted.filter(item=>item?.sourceId===sourceId&&item.kind==='character'&&item.path===scanned.path);
  if(candidates.length!==1)throw error('E_RESOURCE_VERSION_CONFLICT','已保存的同源角色卡使用不同资源版本；为防止错选角色，本次未建立剧情。请导出兼容数据备份并检查原卡版本');
  // Same source SHA does not imply that old and new resource projections
  // are identical. In particular, legacy dual-V2/V3 scans had different
  // resource indices; never fall back to a positional match or another card.
  const candidate=candidates[0];
  if(JSON.stringify(candidate.raw)!==JSON.stringify(scanned.raw))
    throw error('E_RESOURCE_VERSION_CONFLICT','角色资源内容与当前原始卡解析不一致，已阻止错误版本进入剧情；现有剧情不受影响');
  return candidate;
}
// The native and compatibility engines do not share a runtime. A template is
// a set of *claims* about requested capabilities, not evidence they all ran.
// Require an explicit acknowledgement of every non-equivalent field before
// persisting a compatibility session. Never import another story's memories.
function templateCapabilityContract(config={}){
 const ps=config.promptSettings||{},c=ps.outputContract||null,translated=[],notEquivalent=[];
 const ok=(field,note)=>translated.push({field,note});
 const gap=(field,note)=>notEquivalent.push({field,note});
 ok('presetIds','mounted source-bound system messages');
 if((config.worldbookIds||[]).length)gap('worldbookIds','已挂载来源快照并按兼容世界书规则触发，但部分原生语义与酒馆兼容规则不完全等价');
 if((config.regexPackIds||[]).length)gap('regexPackIds','已挂载兼容正则执行器；原生输入/输出/显示阶段与兼容投影仍可能存在语义差异');
 ok('loadedUserMaskId','projected as player persona');
 ok('customCssId','filtered into compatibility display sandbox');
 if((config.theaterCardIds||[]).length)ok('theaterCardIds','mounted before the opening through the shared theater renderer');
 if(c&&(c.requireHtml===true||c.completeHtml===true)){
   if(c.templateMessageId)gap('outputContract.templateMessageId','原生剧情消息 ID 不能作为新兼容剧情的模板来源');
   else ok('outputContract','完整 HTML 结构合同写入准入校验和独立格式提示');
 }
 if(ps.historyHtmlMode==='semantic')ok('historyHtmlMode','only projected request History; canonical messages remain untouched');
 if(ps.historyHtmlMode==='raw')ok('historyHtmlMode','raw canonical History is used');
 if(Object.prototype.hasOwnProperty.call(ps,'recentMessageLimit'))gap('recentMessageLimit','兼容引擎默认完整 History 优先，只在真实模型窗口不足时裁剪；不能保证按原生最近条数限制');
 if(ps.inputSemanticMode&&ps.inputSemanticMode!=='raw')gap('inputSemanticMode','兼容玩家消息不使用原生 AIRP 改写');
 if(ps.injectSavedRolling===true)gap('injectSavedRolling','不能将其他角色的已保存剧情摘要移植到本角色');
 if(ps.pinnedFactsEnabled===true)gap('pinnedFactsEnabled','模板不含固定事实记录，不能假装已经注入');
 if(config.memoryInject)gap('memoryInject','只携带注入偏好，不复制其他会话的核心/事实记忆');
 if(config.renderMode)gap('renderMode','兼容渲染有独立隔离 HTML 管线，不能与原生 Safe HTML 完全等价');
 if(ps.summaryTriggerMessages!==undefined)gap('summaryTriggerMessages','兼容引擎不会在该阈值自动调用模型整理，且不会继承付费授权');
 if(ps.temperature!==undefined)gap('temperature','兼容请求使用当前全局 Provider 温度，未应用角色模板私有温度');
 if(ps.autoRollingEnabled===true)gap('autoRollingEnabled','兼容引擎禁止继承后台付费授权');
 if(ps.worldbookBudgetChars!==undefined)ok('worldbookBudgetChars','兼容世界书在单轮预算范围内筛选');
 ok('autoRollingEnabled/summaryEnabled','新会话后台付费整理强制关闭，无法继承旧授权');
 const covered=new Set([...translated,...notEquivalent].flatMap(row=>row.field.split('/')));
 covered.add('outputContract');covered.add('historyHtmlMode');
 for(const key of Object.keys(ps)){
   if(covered.has(key))continue;
   gap('promptSettings.'+key,'已保留来源快照，但兼容运行没有可证明的同名消费者；新会话不声称此项已经生效');
 }
 return {version:1,translated,notEquivalent};
}
function compatOutputContract(settings){
 const src=settings?.outputContract;if(!src||(src.requireHtml!==true&&src.completeHtml!==true))return null;
 if(src.templateMessageId)throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','旧剧情 HTML 模板消息不能直接绑定到新卡；须在新会话中手动指定参考');
 return {completeHtml:src.completeHtml===true,requireHtml:src.requireHtml===true,
   requiredSelectors:String(src.requiredSelectors||''),bodySelector:String(src.bodySelector||''),
   statusSelector:String(src.statusSelector||''),staticSelectors:String(src.staticSelectors||''),
   staticCssSelectors:String(src.staticCssSelectors||''),staticCommentTexts:String(src.staticCommentTexts||''),
   staticClassTokens:String(src.staticClassTokens||''),structureMode:String(src.structureMode||''),strictValues:src.strictValues===true,templateMessageId:''};
}
function injectFormatContract(out,session){
 const c=session.outputContract;if(!c?.requireHtml&&!c?.completeHtml)return out;
 const parts=['HTML 状态栏格式：要按照格式输出。旧状态不等于本轮状态。'];
 if(c.completeHtml)parts.push('HTML 标签必须完整闭合。');
 if(c.requireHtml)parts.push('必须输出真实 HTML 结构，不得只输出纯文本。');
 if(c.requiredSelectors)parts.push('必需的 CSS 选择器结构：'+c.requiredSelectors);
 if(c.bodySelector)parts.push('正文容器：'+c.bodySelector);
 if(c.statusSelector)parts.push('状态栏容器：'+c.statusSelector+'；状态值须来自当前剧情，不可编造旧值。');
 const text=parts.join('\n');out.messages.unshift({role:'system',content:text});
 out.messageSources.unshift({kind:'native_template_output_contract',sourceId:session.id,path:'session.outputContract'});
 out.historyMessageIndices=out.historyMessageIndices.map(x=>x+1);
 out.estimatedTokens+=(Math.ceil(text.length/3));return out;
}
function projectTemplateHistory(out,session){
 if(session.nativeTemplateBinding?.promptSettings?.historyHtmlMode!=='semantic')return out;
 const projection=root.MimaHistoryHtmlProjection?.project;
 if(typeof projection!=='function')throw error('E_HISTORY_HTML_PROJECTION_MISSING','模板要求历史 HTML 语义投影，但组件不可用；已阻止请求');
 const historical=out.historyMessageIndices||[];
 const latestAssistant=historical.filter(i=>out.messages[i]?.role==='assistant').at(-1);
 for(const index of historical){if(index===latestAssistant)continue;const original=out.messages[index];if(!original)continue;
  const projected=projection(original.content,{enabled:true});
  if(projected.reason==='parser_unavailable'||projected.reason==='parser_failed'||projected.reason==='unverified_empty_projection')throw error('E_HISTORY_HTML_PROJECTION_UNVERIFIED','HTML 历史投影无法安全验证，已停止请求');
  original.content=projected.text;
 }
 return out;
}
async function prepareNativeTemplateBinding(templateId){
 if(!templateId)return null;
 if(!root.MimaLocalStore?.loadState)throw error('E_SETTINGS_TEMPLATE_STORE_UNAVAILABLE','原生设置库不可读取，未创建半挂载剧情');
 const canonical=await root.MimaLocalStore.loadState();
 if(!Array.isArray(canonical.settingTemplates))throw error('E_SETTINGS_TEMPLATE_STORE_UNVERIFIED','设置模板资料不完整');
 const template=templateId==='default'?canonical.settingTemplates.find(x=>x.isDefault):canonical.settingTemplates.find(x=>x.id===templateId);
 if(!template)throw error('E_SETTINGS_TEMPLATE_MISSING','设置模板不存在，未创建剧情');
 const c=template.config||{},resources=[];
 const find=(table,id,label)=>{const record=canonical[table]?.find(x=>x.id===id);
   if(!record)throw error('E_SETTINGS_TEMPLATE_MISSING_RESOURCES',label+' 已删除：'+id);
   return record;};
 const theaterCardIds=Array.isArray(c.theaterCardIds)?c.theaterCardIds.slice():[];
 const theaterSources=[];for(const id of theaterCardIds){const card=find('theaterCards',id,'小剧场');theaterSources.push({id,updatedAt:card.updatedAt||'',sha256:await root.MimaCompatImport.digest(new TextEncoder().encode(card.content||''))});}
 const sourceId='native-settings:'+template.id;
 const push=(kind,id,name,raw)=>resources.push({id:'native-template:'+kind+':'+id,kind,
   sourceId,path:'native.settingTemplates.'+template.id+'.'+kind+'.'+id,name,raw});
 for(const id of c.presetIds||[]){const p=find('presets',id,'预设');if(p.enabled===false)continue;
   if(typeof p.content!=='string'||!p.content.trim())throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','预设正文为空，未创建半成品剧情：'+p.name);
   push('preset',id,p.name,{content:p.content,role:'system'});
 }
 for(const id of c.worldbookIds||[]){const wb=find('worldbooks',id,'世界书');if(wb.enabled===false)continue;
   if((wb.entries||[]).some(e=>e.enabled!==false&&e.useRegex===true))
     throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','包含正则关键词的世界书需要独立 Worker 验证：'+wb.name+'；未建立半挂载剧情');
   const entries=(wb.entries||[]).filter(e=>e.enabled!==false).map(e=>({
     uid:e.id,comment:e.name,content:e.content,key:e.keywords||[],keysecondary:e.secondaryKeywords||[],
     constant:e.alwaysActive===true,disable:false,nativeAllKeywords:e.matchMode==='all',
     nativeSecondaryAny:(e.secondaryKeywords||[]).length>0,caseSensitive:e.caseSensitive===true,
     use_regex:false,order:100000-Number(e.priority??50),position:e.position==='back'?1:0,
     scan_depth:Number(e.scanDepth||12),extensions:{depth:e.depth||0}}));
   push('world_info',id,wb.name,{entries});
 }
 for(const id of c.regexPackIds||[]){const pack=find('regexPacks',id,'正则');if(pack.enabled===false)continue;
   const rules=(pack.rules||[]).filter(x=>x.enabled!==false).map(rule=>{
     if(!rule.pattern||!['display','prompt','input','output'].includes(rule.phase)||!root.MimaRegexEngine?.compileRule?.(rule)?.ok)
       throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','正则无法安全投影到酒馆兼容模式：'+rule.name);
     return {scriptName:rule.name,findRegex:rule.pattern,replaceString:rule.replacement,
       flags:rule.flags||'g',placement:rule.phase==='input'?[1]:rule.phase==='output'?[2]:rule.phase==='prompt'?[1,2]:[2],
       promptOnly:rule.phase==='prompt',markdownOnly:rule.phase==='display',disabled:false};
   });
   push('regex',id,pack.name,rules);
 }
 let personaDescription='';
 if(c.loadedUserMaskId){const mask=find('masks',c.loadedUserMaskId,'玩家面具');
   if(mask.type!=='user')throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','模板引用的不是玩家面具');
   personaDescription=String(mask.content||'');
 }
 let styleResourceId=null;
 if(c.customCssEnabled!==false&&c.customCssId){const css=find('cssPresets',c.customCssId,'CSS 皮肤');
   if(typeof css.css!=='string'||!css.css.trim()||!root.MimaCompatSafeHtml?.safeCssText)
     throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','CSS 皮肤无法在兼容沙箱内安全验证');
   const safe=root.MimaCompatSafeHtml.safeCssText(css.css);
   if(!safe.trim())throw error('E_SETTINGS_TEMPLATE_INCOMPATIBLE','CSS 在安全沙箱内没有可使用的规则');
   push('css',css.id,css.name,safe);styleResourceId=resources[resources.length-1].id;
 }
 // Snapshot resources, not history, memory contents, keys, debts or old conversation IDs.
 const promptSettings={...(c.promptSettings||{}),autoRollingEnabled:false,summaryEnabled:false};
 const capabilityContract=templateCapabilityContract(c);
 const outputContract=compatOutputContract(promptSettings);
 return {version:1,templateId:template.id,templateRevision:template.revision,templateName:template.name,
   theaterCardIds,theaterSources,resources,personaDescription,styleResourceId,promptSettings,outputContract,capabilityContract,renderMode:c.renderMode||'text',
   memoryInject:c.memoryInject||null,createdAt:new Date().toISOString()};
}
async function createSession(sourceId,options={}){const source=await store().get('source_capsules',sourceId);if(!source)throw error('E_STORE_UNVERIFIED','来源包不存在');const resources=await store().byIndex('resource_ir','sourceId',sourceId);const charCandidates=resources.filter(x=>x.kind==='character');const selection=options.characterResourceId?charCandidates.find(x=>x.id===options.characterResourceId):charCandidates.length===1?charCandidates[0]:null;if(!selection)throw error('E_RESOURCE_SEMANTIC_GAP','发现多个角色版本或没有角色；请先明确选择');
const nativeTemplate=await prepareNativeTemplateBinding(String(options.settingTemplateId||''));
if(nativeTemplate?.capabilityContract?.notEquivalent?.length &&
   options.acceptedCapabilityDigest!==JSON.stringify(nativeTemplate.capabilityContract))
 throw error('E_SETTINGS_TEMPLATE_CAPABILITY_UNCONFIRMED','未完整确认兼容引擎和原生模板的能力差异，未创建剧情');
if(nativeTemplate&&options.expectedTemplateSnapshot){
 const expected=options.expectedTemplateSnapshot;
 if(expected.templateId!==nativeTemplate.templateId||expected.templateRevision!==nativeTemplate.templateRevision||
    JSON.stringify(expected.resources)!==JSON.stringify(nativeTemplate.resources)||JSON.stringify(expected.theaterSources||[])!==JSON.stringify(nativeTemplate.theaterSources||[])||
    JSON.stringify(expected.promptSettings)!==JSON.stringify(nativeTemplate.promptSettings)||
    expected.personaDescription!==nativeTemplate.personaDescription||
    JSON.stringify(expected.outputContract)!==JSON.stringify(nativeTemplate.outputContract)||
    JSON.stringify(expected.capabilityContract)!==JSON.stringify(nativeTemplate.capabilityContract)||
    expected.renderMode!==nativeTemplate.renderMode||JSON.stringify(expected.memoryInject)!==JSON.stringify(nativeTemplate.memoryInject))
   throw error('E_SETTINGS_TEMPLATE_SOURCE_STALE','模板预检之后内容或引用资源已改变，未创建剧情，请重新确认');
}
const idx=Number(options.greetingIndex??0),card=selection.raw||{},alternates=Array.isArray(card.alternate_greetings)?card.alternate_greetings:[];if(!Number.isInteger(idx)||idx<0||idx>alternates.length)throw error('E_RESOURCE_SEMANTIC_GAP','开场白索引无效');const greeting=String(idx===0?card.first_mes||'':alternates[idx-1]||'');const id=store().uid('compat'),now=new Date().toISOString(),session={id,mode:'native_compat',sourceId,characterResourceId:selection.id,title:options.title||selection.name||'兼容剧情',userName:options.userName||'玩家',activeBranchId:'main',greetingIndex:idx,revision:1,turnIndex:0,pendingTurnId:null,worldInfoBudget:Number(nativeTemplate?.promptSettings?.worldbookBudgetChars)||16000,
 theaterCardIds:nativeTemplate?.theaterCardIds?.slice()||[],nativeTemplateBinding:nativeTemplate,personaDescription:nativeTemplate?.personaDescription||'',
 styleResourceId:nativeTemplate?.styleResourceId||null,
 outputContract:nativeTemplate?.outputContract||null,templateCapabilities:nativeTemplate?.capabilityContract||null,
 // Paid background rolling authorization does not migrate to a different engine.
 autoRollingEnabled:false,createdAt:now,mountGraph:[],readiness:'limited_runtime'};
const prepared=await resourcesFor(session),spoken=macro(greeting,{char:card.nickname||card.name||'角色',user:session.userName});
const opening=greeting?[{id:'opening_'+id,role:'assistant',canonicalContent:spoken.value,status:'committed',sequence:-1,opening:true}]:[];
const readiness=await createEnvelopeAsync(session,prepared,opening,'',{newSessionPreflight:true});
session.launchCapabilities={greetingIndex:idx,gaps:readiness.gaps,mvuActive:readiness.mvu.active,checkedAt:now};
const db=await store().open();await new Promise((resolve,reject)=>{const tx=db.transaction(['compat_sessions','messages'],'readwrite');tx.objectStore('compat_sessions').add(session);if(greeting){const spoken=macro(greeting,{char:card.nickname||card.name||'角色',user:session.userName});tx.objectStore('messages').add({id:'opening_'+id,sessionId:id,turnId:null,role:'assistant',rawContent:greeting,canonicalContent:spoken.value,status:'committed',sequence:-1,opening:true,greetingIndex:idx,unknownMacros:spoken.unsupported,revision:1,createdAt:now});}tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||error('E_STORE_UNVERIFIED','建立剧情事务失败'));};});return getSession(id);}
// Messages and settlement ledger must be read from the SAME readonly IDB
// transaction. Two independent all() calls can straddle beginTurn/finishTurn
// and falsely report a missing journal despite each write being atomic.
async function readAtomicStores(names,sessionId=null){
 const db=await store().open();return new Promise((resolve,reject)=>{
  let tx,issue;const records={};
  try{
   tx=db.transaction(names,'readonly');
   for(const name of names){const object=tx.objectStore(name);
    let q,filter=false;
    if(sessionId!==null && name==='compat_sessions')q=object.get(sessionId);
    else if(sessionId!==null&&['messages','events_jobs'].includes(name)){
     if(typeof object.index==='function'&&object.indexNames?.contains('sessionId'))q=object.index('sessionId').getAll(sessionId);
     else if(typeof db.version!=='number'){q=object.getAll();filter=true;}
     else throw error('E_STORE_UNVERIFIED','兼容会话索引缺失：'+name);
    }else q=object.getAll();
    q.onsuccess=()=>{records[name]=name==='compat_sessions'&&sessionId!==null?(q.result?[q.result]:[]):filter?q.result.filter(x=>x.sessionId===sessionId):q.result;};
    q.onerror=()=>{issue=q.error||error('E_STORE_UNVERIFIED','一致性读取失败：'+name);};
   }
  }catch(e){db.close();try{tx?.abort();}catch(_){}reject(e);return;}
  tx.oncomplete=()=>{db.close();if(issue||names.some(name=>!Array.isArray(records[name])))reject(issue||error('E_STORE_UNVERIFIED','事务未完整读取：'+names.join(',')));else resolve(records);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','兼容记录快照事务中止'));};
 });
}
async function sessionMessages(sessionId){
 const snapshot=await readAtomicStores(['messages','events_jobs'],sessionId);
 const raw=snapshot.messages,jobs=snapshot.events_jobs;
 const settlement=new Map(jobs.filter(j=>j.sessionId===sessionId).map(j=>[j.id,j.settlement]));
 for(const m of raw){if(m.sessionId===sessionId&&m.turnId&&!settlement.has(m.turnId))throw error('E_STORE_UNVERIFIED','消息缺少可验证 turn journal，禁止投影为正常历史：'+m.id);}
 return raw.filter(m=>m.sessionId===sessionId).sort((a,b)=>a.sequence-b.sequence).map(m=>{
  const effective=m.turnId?settlement.get(m.turnId):null;
  if(effective&&effective!=='committed'&&m.status==='committed')return{...m,status:effective,storedStatus:m.status,legacyProjectionQuarantined:true};
  return m;
 });
}

// Non-destructive story fork: create an independent, internally consistent
// canonical session. Never rewrite the parent's messages, journal or MVU state.
// The caller may supply a stable requestId to make retries idempotent.
async function forkSessionUnfenced(sessionId,cutoffTurnId,{requestId}={}){
 const token=requestId===undefined?store().uid('fork'):String(requestId);
 if(!/^[-_a-zA-Z0-9]{6,128}$/.test(token))throw error('E_CANONICAL_CONFLICT','分支请求 ID 无效');
 const newId='branch_'+token;
 const parent=await getSession(sessionId),resources=await resourcesFor(parent);
 const init=mvu()?.initial(resources,{greetingIndex:parent.greetingIndex??0})??{state:null,gaps:[]};
 const openingCard=resources.find(r=>r.kind==='character')?.raw||{};const openingText=(parent.greetingIndex??0)===0?openingCard.first_mes||'':(openingCard.alternate_greetings||[])[(parent.greetingIndex??0)-1]||'';
 if(/<initvar\b/i.test(String(openingText))&&init.state===null)throw error('E_MVU_INIT_UNVERIFIED','分支源开场白初始变量无法验证，不能创建错误状态分支');
 if(init.gaps?.some(g=>g.reason==='MVU_MULTIPLE_INITIAL_SOURCES_CONFLICT'))throw error('E_MVU_HISTORY_CONFLICT','角色初始变量来源冲突，不能创建分支');
 const db=await store().open();return new Promise((resolve,reject)=>{
  const tx=db.transaction(['compat_sessions','messages','events_jobs','sidecar_links','variables','grants','resource_ir'],'readwrite');
  const sessions=tx.objectStore('compat_sessions'),msgs=tx.objectStore('messages'),jobs=tx.objectStore('events_jobs'),side=tx.objectStore('sidecar_links');
  let outcome,issue;
  const bad=(code,why)=>{issue=error(code,why);try{tx.abort();}catch(_){}};
  const existed=sessions.get(newId);
  existed.onsuccess=()=>{
   const old=existed.result;
   if(old){
    if(old.parentSessionId===sessionId&&old.forkedAtTurnId===(cutoffTurnId??null)&&old.branchRequestId===token){outcome={sessionId:newId,reused:true,parentSessionId:sessionId};return;}
    bad('E_CANONICAL_CONFLICT','分支请求 ID 已被其他剧情使用');return;
   }
   const getParent=sessions.get(sessionId);
   getParent.onsuccess=()=>{
    const current=getParent.result;
    if(!current||current.revision!==parent.revision||current.sourceId!==parent.sourceId||current.characterResourceId!==parent.characterResourceId){bad('E_CANONICAL_CONFLICT','建立分支前原剧情已改变，请重新检查');return;}
    if(current.pendingTurnId){bad('E_CANONICAL_CONFLICT','有未结算回合，不能从不稳定的剧情创建分支');return;}
    if(typeof db.version==='number'&&(!msgs.indexNames?.contains('sessionId')||!jobs.indexNames?.contains('sessionId'))){bad('E_STORE_UNVERIFIED','分支创建时会话索引缺失，禁止复制不完整历史');return;}
    const mReq=typeof msgs.index==='function'&&msgs.indexNames?.contains('sessionId')?msgs.index('sessionId').getAll(sessionId):msgs.getAll();
    const jReq=typeof jobs.index==='function'&&jobs.indexNames?.contains('sessionId')?jobs.index('sessionId').getAll(sessionId):jobs.getAll();let rows=null,ledger=null,authorRecords=null;
    const author={},authorNames=['variables','grants','resource_ir','sidecar_links'];let authorRemaining=authorNames.length;
    for(const name of authorNames){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{author[name]=name==='resource_ir'?request.result:request.result.filter(x=>x.sessionId===sessionId);if(!--authorRemaining){authorRecords=author;assemble();}};request.onerror=()=>bad('E_STORE_UNVERIFIED','分支作者数据读取失败：'+name);}
    const assemble=()=>{
     if(!rows||!ledger||!authorRecords)return;
     try{
      const sourceMessages=rows.filter(m=>m.sessionId===sessionId).sort((a,b)=>a.sequence-b.sequence);
      const sourceJobs=ledger.filter(j=>j.sessionId===sessionId);
      if(sourceJobs.some(j=>j.settlement==='pending'))throw error('E_STORE_UNVERIFIED','原剧情存在未结算 journal，不允许复制不稳定历史');
      const byTurn=new Map(sourceJobs.map(j=>[j.id,j]));
      const userByTurn=new Map(sourceMessages.filter(m=>m.turnId&&m.role==='user').map(m=>[m.turnId,m]));
      const assistantByTurn=new Map(sourceMessages.filter(m=>m.turnId&&m.role==='assistant').map(m=>[m.turnId,m]));
      const selected=cutoffTurnId===null||cutoffTurnId===undefined?null:sourceMessages.find(m=>m.turnId===cutoffTurnId&&m.role==='assistant'&&m.status==='committed');
      if(cutoffTurnId!==null&&cutoffTurnId!==undefined&&(!selected||byTurn.get(cutoffTurnId)?.settlement!=='committed'))throw error('E_CANONICAL_CONFLICT','只能从已结算的角色回复创建分支');
      const cutoff=selected?selected.sequence:-1;
      const opening=sourceMessages.filter(m=>m.opening&&m.turnId===null&&m.status==='committed'&&m.sequence<=cutoff);
      if(opening.length>1)throw error('E_STORE_UNVERIFIED','原剧情有重复的开场消息');
      const copied=[];const committedJobs=sourceJobs.filter(j=>j.kind!=='assistant_continuation'&&j.settlement==='committed'&&j.sequence<cutoff).sort((a,b)=>a.sequence-b.sequence);
      if(selected){const target=byTurn.get(cutoffTurnId);if(!committedJobs.includes(target))committedJobs.push(target);}
      const set=new Set();
      for(const j of committedJobs){
       if(set.has(j.id))throw error('E_STORE_UNVERIFIED','历史 journal 存在重复回合');set.add(j.id);
       const user=userByTurn.get(j.id);
       const assistant=assistantByTurn.get(j.id);
       if(!user||!assistant||user.status!=='committed'||assistant.status!=='committed'||user.sequence!==j.sequence||assistant.sequence!==j.sequence+1||j.sessionId!==sessionId)
         throw error('E_STORE_UNVERIFIED','历史回合内容与结算记录不一致，拒绝复制分支');
       copied.push({j,user,assistant});
      }
      // A committed assistant without its journal must not disappear silently.
      for(const msg of sourceMessages){if(msg.sequence<=cutoff&&msg.role==='assistant'&&!msg.opening&&msg.status==='committed'&&!set.has(msg.turnId))throw error('E_STORE_UNVERIFIED','已提交角色回复没有对应的 journal');}
      const replayInput=[...opening,...copied.flatMap(x=>[x.user,x.assistant])];
      if(init.state!==null){if(!mvu())throw error('E_MVU_UNAVAILABLE','MVU 验证组件不可用');mvu().replay(init.state,replayInput);}
      else if(replayInput.some(m=>m.mvuStateAfter!==undefined))throw error('E_MVU_HISTORY_CONFLICT','无法校验原始 MVU 状态，拒绝复制');
      const newSession={...current,id:newId,title:(current.title||'剧情')+' · 分支',activeBranchId:newId,
        parentSessionId:sessionId,forkedAtTurnId:cutoffTurnId??null,forkedAtSequence:cutoff,branchRequestId:token,
        pendingTurnId:null,lastSettledTurnId:null,turnIndex:cutoff<0?0:(cutoff+1)/2,revision:1,authorVariableRevision:0,createdAt:new Date().toISOString()};
      sessions.add(newSession);
      for(const old of opening)msgs.add({...old,id:'opening_'+newId,sessionId:newId,originMessageId:old.id,revision:1});
      for(const {j,user,assistant} of copied){
       const newTurnId='branchcopy_'+token+'_'+j.sequence;
       const u='u_'+newTurnId,a='a_'+newTurnId;
       jobs.add({...j,id:newTurnId,sessionId:newId,msgId:u,attemptId:'historical_'+newTurnId,
        branchCopyOf:j.id,historicalCopy:true,stage:'BRANCH_HISTORY_COMMITTED',settlement:'committed',revision:1});
       msgs.add({...user,id:u,sessionId:newId,turnId:newTurnId,originMessageId:user.id,originTurnId:j.id,revision:1});
       // Copy committed MVU continuation provenance into this branch. A fork
       // cannot retain foreign session IDs inside the new assistant's segment
       // ledger: that would break sealed backup recovery and independent replay.
       const clonedSegments=(assistant.mvuContinuationSegments||[]).map(seg=>{
        const oldJob=sourceJobs.find(record=>record.id===seg.continuationId);
        if(!oldJob||oldJob.kind!=='assistant_continuation'||oldJob.settlement!=='committed'||
           oldJob.assistantId!==assistant.id||oldJob.sessionId!==sessionId)
          throw error('E_MVU_HISTORY_CONFLICT','原分支的 MVU 续写没有已验证的事务来源');
        const newContinuationId='cont_branchcopy_'+token+'_'+seg.continuationId.slice(5);
        jobs.add({...oldJob,id:newContinuationId,sessionId:newId,msgId:u,assistantId:a,parentTurnId:newTurnId,
          attemptId:'historical_'+newContinuationId,branchCopyOf:seg.continuationId,historicalCopy:true,revision:1});
        const linkRequest=side.get('continuation_backup_'+seg.continuationId);
        linkRequest.onsuccess=()=>{
         const link=linkRequest.result;
         if(!link||link.sessionId!==sessionId||link.assistantId!==assistant.id||link.parentTurnId!==j.id){
          bad('E_MVU_HISTORY_CONFLICT','续写版本来源丢失，拒绝创建不完整分支');return;
         }
         side.add({...link,id:'continuation_backup_'+newContinuationId,sessionId:newId,assistantId:a,
           parentTurnId:newTurnId,originLinkId:link.id,revision:1});
        };
        linkRequest.onerror=()=>bad('E_STORE_UNVERIFIED','分支 MVU 续写版本读取失败');
        return{...seg,continuationId:newContinuationId};
       });
       msgs.add({...assistant,id:a,sessionId:newId,turnId:newTurnId,originMessageId:assistant.id,originTurnId:j.id,revision:1,
         ...(clonedSegments.length?{mvuContinuationSegments:clonedSegments}:{})});
       const historicalSnap=authorRecords.variables.find(x=>x.namespace==='stscript_turn_snapshot_v1'&&x.sourceTurnId===j.id);
       if(historicalSnap&&historicalSnap.sequence===assistant.sequence&&historicalSnap.sessionId===sessionId){
        tx.objectStore('variables').add({...historicalSnap,id:newId+':__stscript_turn_snapshot_v1:'+newTurnId,
          sessionId:newId,sourceTurnId:newTurnId,revision:1,originSnapshotId:historicalSnap.id});
       }
       newSession.lastSettledTurnId=newTurnId;
      }
      // The latest branch inherits the current authoritative variables. A
      // historical branch inherits ONLY a per-turn, committed immutable record.
      // An old release's unsnapshotted history cannot be reconstructed safely.
      const scriptRows=authorRecords.variables.filter(x=>x.namespace==='stscript'&&x.id===sessionId+':__stscript_local_v1');
      if(scriptRows.length>1)throw error('E_STSCRIPT_FORK_SOURCE_CONFLICT','发现重复的 STscript 变量来源');
      const latest=cutoffTurnId!=null&&cutoffTurnId===current.lastSettledTurnId;
      const isHistorical=cutoffTurnId!=null&&!latest;
      const cutoffSnapshots=authorRecords.variables.filter(x=>x.namespace==='stscript_turn_snapshot_v1'&&x.sourceTurnId===cutoffTurnId&&x.sessionId===sessionId);
      if(isHistorical&&cutoffSnapshots.length!==1)throw error('E_STSCRIPT_FORK_HISTORICAL_UNVERIFIED','旧回合缺少已提交的 STscript 变量历史快照，无法证明当时状态，父分支未修改');
      const original=isHistorical?cutoffSnapshots[0]:(cutoffTurnId==null?null:scriptRows[0]);
      if(isHistorical&&(!selected||original.sequence!==selected.sequence||!Number.isInteger(original.sourceRevision)))
       throw error('E_STSCRIPT_FORK_SOURCE_INVALID','历史变量快照与本回合结算序号不一致');
      if(original){
       if(!original.value||typeof original.value!=='object'||Array.isArray(original.value)||!Number.isInteger(original.revision))
        throw error('E_STSCRIPT_FORK_SOURCE_INVALID','无法验证父分支变量');
       if(Object.keys(original.value).length){
        tx.objectStore('variables').add({id:newId+':__stscript_local_v1',sessionId:newId,namespace:'stscript',
         value:structuredClone(original.value),revision:1,forkedFrom:original.id,
         forkedRevision:isHistorical?original.sourceRevision:original.revision,updatedAt:new Date().toISOString()});
       }
      }
      const helperTables=authorRecords.variables.filter(x=>x.kind==='helper_table_v1');
      if(helperTables.length){
       if(!root.MimaAuthorStore)throw error('E_AUTHOR_UNAVAILABLE','分支需要作者变量组件，未创建丢失变量的分支');
       const ids=new Map(opening.map(x=>[x.id,'opening_'+newId]));for(const item of copied){const turn='branchcopy_'+token+'_'+item.j.sequence;ids.set(item.user.id,'u_'+turn);ids.set(item.assistant.id,'a_'+turn);}
       root.MimaAuthorStore.forkRows(tx,{...authorRecords,compat_sessions:[current],messages:sourceMessages,events_jobs:sourceJobs},newId,ids,cutoff);
      }
      if(newSession.lastSettledTurnId)sessions.put(newSession);
      outcome={sessionId:newId,reused:false,parentSessionId:sessionId,historyTurns:copied.length};
     }catch(e){issue=e;tx.abort();}
    };
    mReq.onsuccess=()=>{rows=mReq.result;assemble();};jReq.onsuccess=()=>{ledger=jReq.result;assemble();};
    mReq.onerror=()=>bad('E_STORE_UNVERIFIED','分支历史读取失败');
    jReq.onerror=()=>bad('E_STORE_UNVERIFIED','分支结算记录读取失败');
   };
   getParent.onerror=()=>bad('E_STORE_UNVERIFIED','分支原剧情读取失败');
  };
  existed.onerror=()=>bad('E_STORE_UNVERIFIED','分支幂等记录读取失败');
  tx.oncomplete=()=>{db.close();resolve(outcome);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_STORE_UNVERIFIED','分支创建事务中止'));};
 }).then(async receipt=>{
  // A committed write is not yet a verified user-visible branch. Check the
  // cloned journal and MVU history before reporting success, including reuse.
  const created=await getSession(newId);
  if(created.parentSessionId!==sessionId||created.forkedAtTurnId!==(cutoffTurnId??null))throw error('E_STORE_UNVERIFIED','分支回读来源与请求节点不一致');
  await sessionMessages(newId);
  await currentMvuState(newId);
  return receipt;
 });
}
async function mountResource(sessionId,resourceId){
  const [session,resource]=await Promise.all([getSession(sessionId),store().get('resource_ir',resourceId)]);
  const source=resource?await store().get('source_capsules',resource.sourceId):null;
  if(!resource||!source||source.sha256!==resource.sourceId.slice(7))throw error('E_STORE_UNVERIFIED','挂载资源的不可变来源指纹缺失');
  if(resource.kind==='character')throw error('E_RESOURCE_SEMANTIC_GAP','禁止把外置角色直接改写当前剧情身份');
  if(!['world_info','regex','preset','prompt_presets','css','html_template','media','script_source','quick_reply'].includes(resource.kind))throw error('E_RESOURCE_SEMANTIC_GAP','该资源只能原样查看，暂不能挂载');
  if(resource.sourceId===session.sourceId)throw error('E_CANONICAL_CONFLICT','本卡包绑定资源已随角色可见，无需重复挂载');
  const graph=Array.isArray(session.mountGraph)?session.mountGraph:[];
  if(graph.some(m=>m.resourceId===resourceId))throw error('E_CANONICAL_CONFLICT','该资源已经挂载');
  const mount={resourceId,sourceId:source.id,sha256:source.sha256,kind:resource.kind,path:resource.path,order:graph.length,enabled:true,...(['preset','prompt_presets'].includes(resource.kind)?{creativeRoleOverride:null}:{}),unmetDependencies:['preset','prompt_presets'].includes(resource.kind)?['ST prompt-manager preset parity unverified']:resource.kind==='script_source'?['Requires explicit per-script grant and supported API']:[],mountedAt:new Date().toISOString()};
  await store().putCAS('compat_sessions',{...session,mountGraph:[...graph,mount]},session.revision);
  return mount;
}
async function setPresetCreativeRole(sessionId,resourceId,allow){
  if(typeof allow!=='boolean')throw error('E_RESOURCE_SEMANTIC_GAP','预设角色授权必须是明确的布尔值');
  const session=await getSession(sessionId),graph=Array.isArray(session.mountGraph)?session.mountGraph:[];
  const mount=graph.find(m=>m.enabled&&m.resourceId===resourceId&&['preset','prompt_presets'].includes(m.kind));
  if(!mount)throw error('E_PLUGIN_PERMISSION_DENIED','请先明确挂载外置预设，角色权限不随卡片自动提升');
  const resource=await store().get('resource_ir',resourceId);
  if(!resource||resource.sourceId!==mount.sourceId||resource.path!==mount.path||mount.sha256!==resource.sourceId.slice(7))
    throw error('E_SOURCE_CORRUPT','预设来源与授权记录不一致，未更改权限');
  const next=graph.map(m=>m.resourceId===resourceId?{...m,trustedCreativeRole:allow,creativeRoleOverride:allow?null:'user'}:m);
  await store().putCAS('compat_sessions',{...session,mountGraph:next},session.revision);
  return {resourceId,trustedCreativeRole:allow,creativeRoleOverride:allow?null:'user'};
}
async function unmountResource(sessionId,resourceId){
  const session=await getSession(sessionId),graph=Array.isArray(session.mountGraph)?session.mountGraph:[];
  if(!graph.some(m=>m.resourceId===resourceId))throw error('E_CANONICAL_CONFLICT','资源没有挂载');
  await store().putCAS('compat_sessions',{...session,mountGraph:graph.filter(m=>m.resourceId!==resourceId)},session.revision);
  return{unmounted:resourceId};
}
async function resolveMedia(sessionId,resourceId){
  const session=await getSession(sessionId),resources=await resourcesFor(session),media=resources.find(r=>r.id===resourceId&&r.kind==='media');
  if(!media)throw error('E_PLUGIN_PERMISSION_DENIED','媒体不是当前剧情已挂载的资源');
  const source=await store().get('source_capsules',media.sourceId);
  if(!source||!(source.bytes instanceof Uint8Array)||!source.sha256||await root.MimaCompatImport.digest(source.bytes)!==source.sha256)throw error('E_SOURCE_CORRUPT','媒体来源包 SHA256 校验失败');
  if(!['charx','zip'].includes(source.format))throw error('E_RESOURCE_SEMANTIC_GAP','此媒体不来自 ZIP/CHARX 可寻址资产');
  const path=media.raw?.embeddedPath||String(media.raw?.uri||'').replace(/^embeded:\/\//,'');
  if(typeof path!=='string'||!path||path.includes('..')||path.startsWith('/')||path.includes('\\'))throw error('E_ZIP_PATH_TRAVERSAL','媒体资产路径不安全');
  const entries=await root.MimaCompatImport.readZip(source.bytes),item=entries.find(x=>x.name===path);
  if(!item)throw error('E_SOURCE_CORRUPT','来源卡包缺少素材：'+path);
  const sha=await root.MimaCompatImport.digest(item.bytes);
  if(media.raw?.sha256&&sha!==media.raw.sha256)throw error('E_SOURCE_CORRUPT','素材哈希与无损索引不一致');
  const mime=media.raw?.mime||(/\.(png)$/i.test(path)?'image/png':/\.(jpe?g)$/i.test(path)?'image/jpeg':/\.(webp)$/i.test(path)?'image/webp':/\.(mp3)$/i.test(path)?'audio/mpeg':/\.(ogg)$/i.test(path)?'audio/ogg':/\.(wav)$/i.test(path)?'audio/wav':'');
  if(!/^image\/(?:png|jpeg|webp)$|^audio\/(?:mpeg|ogg|wav)$/.test(mime))throw error('E_RESOURCE_SEMANTIC_GAP','未知或不安全的媒体类型');
  return{blob:new Blob([item.bytes],{type:mime}),mime,sha256:sha,path};
}
async function resourcesFor(s){
  const fromSource=await store().byIndex('resource_ir','sourceId',s.sourceId);
  const selected=fromSource.find(r=>r.id===s.characterResourceId&&r.kind==='character');
  if(!selected)throw error('E_STORE_UNVERIFIED','角色资源版本不存在，禁止混用其它版本资源');
  const prefix=selected.path.replace(/\.data$/,'');
  const base=fromSource.filter(item=>{if(item.kind==='character')return item.id===s.characterResourceId;const owner=/^(png\.(?:chara|ccv3)\[\d+\])(?:\.|$)/.exec(item.path);if(owner)return owner[1]===prefix;return true;});
  const graph=Array.isArray(s.mountGraph)?s.mountGraph:[],external=[];
  for(const mount of graph.filter(x=>x.enabled).sort((a,b)=>a.order-b.order)){
    const item=await store().get('resource_ir',mount.resourceId);
    if(item&&item.sourceId!==mount.sourceId)throw error('E_SOURCE_CORRUPT','挂载资源的来源被改变：'+mount.resourceId);
    if(!item)throw error('E_STORE_UNVERIFIED','挂载图引用不存在的资源 '+mount.resourceId);
    if(item.sourceId!=='sha256:'+mount.sha256||item.path!==mount.path||item.kind!==mount.kind)throw error('E_SOURCE_CORRUPT','挂载资源来源指纹或路径被改变');
    if(!base.some(r=>r.id===item.id)&&!external.some(r=>r.id===item.id))external.push(item);
  }
  const binding=s.nativeTemplateBinding;
  if(binding){
    if(binding.version!==1||!Array.isArray(binding.resources)||binding.resources.some(item=>!item?.id||!item?.kind||item.sourceId!=='native-settings:'+binding.templateId))
      throw error('E_SETTINGS_TEMPLATE_BINDING_UNVERIFIED','本剧情模板快照异常，已停止生成，原始卡片和 History 保留');
    // Native template resources are explicit session-bound snapshots. Never
    // fetch their latest mutable content from another story or a stale cache.
    return [...base,...external,...binding.resources];
  }
  return [...base,...external];
}
// R11 compat projection: this changes provider request copies only. Source
// capsules, committed messages, worldbook, and session state are immutable.
// Unknown provider capacity is not a fabricated 8K/32K hard limit.
function projectCompatHistory(out,userText){
 const cfg=root.MimaStandalone?.getApiConfig?.(),windowTokens=Number(cfg?.contextWindowTokens);
 const verified=Number.isFinite(windowTokens)&&windowTokens>=4096;
 const original=out.messages,historyIndices=out.historyMessageIndices||[];
 const cost=m=>Math.ceil(String(m?.content||'').length/2.5)+8;
 const totalCost=xs=>xs.reduce((sum,m)=>sum+cost(m),0);
 const rawEstimate=totalCost(original),trace={fullHistoryPreferred:true,canonicalHistoryCount:historyIndices.length,
   allHistoryIncluded:true,temporarilyOmittedCount:0,retrievedHistoryCount:0,
   windowTokens:verified?Math.floor(windowTokens):null,windowVerified:verified,
   budgetPolicy:verified?'configured_hard_limit':'unverified_provider_authoritative'};
 if(!verified){out.contextTrace=trace;out.estimatedTokens=rawEstimate;return out;}
 const reserve=Math.max(1024,Number(cfg.maxTokens)>0?Math.floor(Number(cfg.maxTokens)):Math.min(4096,Math.floor(windowTokens*.5)));
 const usable=Math.floor(windowTokens*.85)-reserve-96;
 if(usable<=0)throw error('E_CONTEXT_BUDGET_CONFIG','兼容剧情保留输出已占满声明的模型窗口，原始存档未更动');
 if(rawEstimate<=usable){out.contextTrace=trace;out.estimatedTokens=rawEstimate;return out;}
 const historical=new Set(historyIndices),pinned=original.map((m,i)=>historical.has(i)?null:m).filter(Boolean);
 const pinnedCost=totalCost(pinned);
 if(pinnedCost>usable)throw error('E_CONTEXT_BUDGET_BASE','兼容角色卡、世界书和当前消息超过声明的模型窗口；不删除原始资料');
 // Oldest player+reply are indivisible. A lone opening greeting is its own atom.
 const atoms=[];
 for(let j=0;j<historyIndices.length;){const first=historyIndices[j],next=historyIndices[j+1];
   const pair=original[first]?.role==='user'&&next!==undefined&&original[next]?.role==='assistant';
   const indices=historyIndices.slice(j,j+(pair?2:1));atoms.push({indices,messages:indices.map(i=>original[i]),weight:indices.reduce((n,i)=>n+cost(original[i]),0)});j+=indices.length;
 }
 const kept=new Set(historyIndices),omitted=[];let sum=rawEstimate;
 const drop=atom=>{for(const ix of atom.indices)kept.delete(ix);omitted.push(atom);sum-=atom.weight;};
 let cursor=0;
 while(sum>usable&&cursor<atoms.length-(out.assistantContinuation?1:0))drop(atoms[cursor++]);
 if(sum>usable)throw error('E_CONTEXT_BUDGET_BASE','兼容剧情当前必需资料超出窗口；未删除完整 History');
 // Leave limited headroom for on-demand lexical recall when History was cut.
 const headroom=Math.min(1200,Math.floor(usable*.12));
 while(cursor<atoms.length-1&&sum>usable-headroom)drop(atoms[cursor++]);
 const terms=[...new Set((String(userText||'').toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9_]{3,}/gu)||[]).flatMap(x=>/[\p{Script=Han}]/u.test(x)?Array.from({length:Math.max(0,x.length-1)},(_,i)=>x.slice(i,i+2)):x))].slice(0,48);
 let retrieved=0;
 // Rank only already-omitted complete turns; the search index is a
 // disposable projection of verified canonical messages, never a Store owner.
 const searchItems=omitted.map((a,i)=>({id:i,text:a.messages.map(m=>String(m.content||'')).join('\n')}));
 const rankings=root.MimaHistorySearch?.rank?.(userText,searchItems)||[];
 const weights=new Map(rankings.map(x=>[x.id,x.score]));
 const ranked=omitted.map((a,i)=>({...a,ordinal:i,score:(weights.get(i)??terms.reduce((v,t)=>v+(a.messages.some(m=>String(m.content||'').toLowerCase().includes(t))?t.length:0),0))}))
   .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.ordinal-a.ordinal);
 for(const atom of ranked){if(sum+atom.weight>usable)continue;for(const ix of atom.indices)kept.add(ix);sum+=atom.weight;retrieved+=atom.indices.length;}
 const selectedIndices=original.flatMap((_,index)=>!historical.has(index)||kept.has(index)?[index]:[]);
 out.messages=selectedIndices.map(index=>original[index]);
 out.messageSources=selectedIndices.map(index=>out.messageSources[index]);
 out.historyMessageIndices=selectedIndices.flatMap((originalIndex,index)=>historical.has(originalIndex)?[index]:[]);
 trace.allHistoryIncluded=omitted.length===0;trace.temporarilyOmittedCount=omitted.reduce((n,x)=>n+x.indices.length,0);
 trace.retrievedHistoryCount=retrieved;trace.remainingOmittedCount=historyIndices.length-[...kept].length;
 trace.estimatedInputTokens=totalCost(out.messages);
 out.contextTrace=trace;out.estimatedTokens=trace.estimatedInputTokens;
 if(out.estimatedTokens>usable)throw error('E_CONTEXT_BUDGET','兼容投影超预算，未向 Provider 发送');
 return out;
}
async function createEnvelopeAsync(session,resources,messages,userText,options={}){
  const entries=entriesFromResources(resources),hasRegexWorldInfo=entries.some(e=>e&&(e.use_regex===true||e.useRegex===true));
  let worldInfoOverride=null;
  if(hasRegexWorldInfo){
    const card=resources.find(r=>r.kind==='character')?.raw;
    const name=card?.nickname||card?.name||'角色',user=session.userName||'玩家';
    const history=messages.filter(m=>m.status==='committed'&&!(m.role==='assistant'&&!approvedReply(m)&&(m.metadata?.providerRefused===true||m.metadata?.providerFinishKind==='blocked'||['content_filter','safety','blocked','refusal'].includes(m.metadata?.providerFinishReason)))).map(m=>({role:m.role,content:m.canonicalContent}));
    if(!root.MimaCompatWorldInfoIsolation?.evaluate)throw error('E_REGEX_ISOLATION_UNAVAILABLE','世界书包含正则关键词，但隔离组件未加载；不会跳过世界书继续生成');
    worldInfoOverride=await root.MimaCompatWorldInfoIsolation.evaluate(entries,[...history,...(options.assistantContinuation?[]:[{role:'user',content:userText}])],worldInfoSettings(session,name,user,userText),{signal:options.signal});
  }
  const out=injectFormatContract(createEnvelope(session,resources,messages,userText,{skipRegex:true,worldInfoOverride,assistantContinuation:options.assistantContinuation===true}),session),regex=readRegex(resources,session);
  out.authorHost={version:'mima-author-host/1',active:root.MimaAuthorHost?.state(session.id)||[],capabilityScope:'chat/message/script variables and committed-message snapshot; other Helper APIs are unsupported'};
  if(root.MimaAuthorPrompt?.needs(out)&&options.newSessionPreflight===true)out.gaps.push({slot:'author_variables',reason:'requires_explicit_author_initialization_before_generation'});
  else if(root.MimaAuthorPrompt?.needs(out)){
    if(!root.MimaAuthorStore)throw error('E_AUTHOR_UNAVAILABLE','作者变量读取组件未加载，未发送无法解析的变量宏');
    const snapshot=await root.MimaAuthorStore.snapshot(session.id);
    if(snapshot.sessionRevision!==session.revision)throw error('E_AUTHOR_CONFLICT','提示词准备期间故事状态变化，请重新预览或发送');
    root.MimaAuthorPrompt.project(out,snapshot);
  }
  const isolate=root.MimaCompatRegexIsolation;
  const warn=(stage,e)=>{out.gaps.push({reason:e.code||'E_REGEX_WORKER_FAILED',stage,details:e.message,ruleName:e.ruleName||null,ruleKey:e.ruleKey||null,resourceId:e.resourceId||null,path:e.path||null,rawRetained:true});};
  if(!isolate){if(regex.length)warn('worker',error('E_REGEX_ISOLATION_UNAVAILABLE','无法初始化隔离正则执行器'));return projectCompatHistory(projectTemplateHistory(out,session),userText);}
  const macroContext=await regexMacroContext(session,resources);
  // Regex transforms request copies selected by provenance, never by a fixed
  // message index or by the message role of user-owned configuration text.
  const loreQueue=out.messages.map((msg,index)=>({msg,index,source:out.messageSources[index]})).filter(row=>row.source.kind==='world_info');
  if(loreQueue.length&&regex.some(rule=>Array.isArray(rule?.placement)&&rule.placement.includes(5)&&rule.disabled!==true)){
    try{
      const applied=await regexProjection(loreQueue.map(row=>({input:row.msg.content,phase:5,options:{macroContext}})),regex,{signal:options.signal,isPrompt:true});
      applied.forEach((item,i)=>{const target=loreQueue[i];if(!item.ok)for(const issue of item.result.errors)warn('worldinfo regex #'+i,issue);
        target.msg.content=item.result.output;
        const segment=out.segments.find(row=>row.id===target.source.segmentId);if(segment)segment.content=item.result.output;
        out.regexTrace.push(...item.result.trace.map(trace=>({...trace,messageIndex:target.index,sourceResourceId:target.source.resourceId,worldInfoEntryId:target.source.entryId})));
      });
    }catch(e){warn('worldinfo regex batch',e);}
  }
  const queue=out.messages.map((msg,idx)=>({msg,idx,source:out.messageSources[idx],phase:msg.role==='assistant'?2:msg.role==='user'?1:null})).filter(row=>row.phase!==null&&['canonical_history','player_input'].includes(row.source.kind));
  try{
    const transformed=await regexProjection(queue.map((row,index)=>({input:row.msg.content,phase:row.phase,options:{depth:options.assistantContinuation&&index===queue.length-1?-1:queue.length-1-index,macroContext}})),regex,{signal:options.signal,isPrompt:true});
    transformed.forEach((item,i)=>{const {msg,idx}=queue[i];msg.content=item.result.output;out.regexTrace.push(...item.result.trace.map(trace=>({...trace,messageIndex:idx})));if(!item.ok)for(const issue of item.result.errors)warn('prompt '+msg.role+' #'+idx,issue);});
  }catch(e){warn('prompt batch',e);}
  out.estimatedTokens=out.messages.reduce((n,m)=>n+Math.ceil(m.content.length/3),0);
  return projectCompatHistory(projectTemplateHistory(out,session),userText);
}
async function previewUnfenced(sessionId,input,options={}){const s=await getSession(sessionId),msgs=await sessionMessages(sessionId),resources=await resourcesFor(s);return createEnvelopeAsync(s,resources,msgs,input,options);}
async function transition(sessionId,work){const db=await store().open();return new Promise((resolve,reject)=>{const tx=db.transaction(['compat_sessions','messages','events_jobs','variables'],'readwrite'),s=tx.objectStore('compat_sessions'),m=tx.objectStore('messages'),j=tx.objectStore('events_jobs'),v=tx.objectStore('variables');let result,issue;const q=s.get(sessionId);q.onsuccess=()=>{try{const current=q.result;if(!current)throw error('E_STORE_UNVERIFIED','剧情已不存在');result=work(current,{s,m,j,v,tx});}catch(e){issue=e;tx.abort();}};q.onerror=()=>{issue=q.error;tx.abort();};tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_CANONICAL_CONFLICT','剧情事务中止'));};});}
async function beginTurn(sessionId,text){
  if(!String(text).trim())throw error('E_STORY_RUNTIME','请输入消息');
  return transition(sessionId,(s,{s:sessionStore,m,j})=>{
    if(s.pendingTurnId)throw error('E_CANONICAL_CONFLICT','存在未结算回合，须先恢复、终止或确认原状态');
    const turnId=store().uid('turn'),attemptId=store().uid('attempt'),msgId='u_'+turnId,sequence=s.turnIndex*2,now=new Date().toISOString();
    m.add({id:msgId,sessionId,turnId,role:'user',rawContent:text,canonicalContent:text,status:'pending',sequence,revision:1,createdAt:now});
    j.add({id:turnId,sessionId,msgId,attemptId,attempt:1,sequence,stage:'INPUT_RECORDED',settlement:'pending',revision:1,createdAt:now});
    sessionStore.put({...s,turnIndex:s.turnIndex+1,pendingTurnId:turnId,revision:s.revision+1});
    return{turnId,attemptId,sessionRevision:s.revision+1,msgId,sequence,text};
  });
}
async function finishTurn(sessionId,t,reply,code='',mvuResult=null,recovery=null){
  return transition(sessionId,(s,{s:sessionStore,m,j,v,tx})=>{
    const receipt={turnId:t.turnId,attemptId:t.attemptId,settlement:null};
    const jobRequest=j.get(t.turnId);
    jobRequest.onsuccess=()=>{
      const job=jobRequest.result;
      const admitted=job&&(recovery?
        ['failed','aborted'].includes(job.settlement)&&!s.pendingTurnId&&s.revision===recovery.sessionRevision&&job.revision===recovery.jobRevision&&s.turnIndex===job.sequence/2+1:
        job.settlement==='pending'&&s.pendingTurnId===t.turnId);
      if(!job||job.sessionId!==sessionId||job.attemptId!==t.attemptId||!admitted){
        /* Do not abort the transaction solely because a fenced old response arrived: no writes occur. */
        return;
      }
      const ok=typeof reply==='string'&&reply.trim().length>0;
      const status=ok?'committed':code==='E_TURN_ABORTED'?'aborted':'failed';
      const msgRequest=m.get(job.msgId);
      msgRequest.onsuccess=()=>{
        const user=msgRequest.result;
        if(!user||user.sessionId!==sessionId||user.turnId!==t.turnId||!(recovery?['failed','aborted']:['pending','failed']).includes(user.status)){try{msgRequest.transaction.abort();}catch(_){}return;}
        receipt.settlement=status;
        m.put({...user,status,revision:(user.revision||0)+1,settledAt:new Date().toISOString()});
        if(ok){const assistant={id:'a_'+t.turnId,sessionId,turnId:t.turnId,role:'assistant',rawContent:reply,canonicalContent:reply,status:'committed',sequence:job.sequence+1,revision:1,createdAt:new Date().toISOString(),...(mvuResult?.active?{mvuStateAfter:mvuResult.state,mvuOperationCount:mvuResult.operations?.length||0}: {})};if(recovery)assistant.metadata=recoveryMetadata(assistant,recovery.receipt);m.add(assistant);}
        if(ok){
          // One IndexedDB transaction covers the turn journal and its STscript
          // snapshot. Legacy turns without a snapshot remain explicitly unknown.
          const varReq=v.get(sessionId+':__stscript_local_v1');
          varReq.onsuccess=()=>{
            const row=varReq.result;
            if(row&&(row.namespace!=='stscript'||row.sessionId!==sessionId||!Number.isInteger(row.revision)||!row.value||typeof row.value!=='object'||Array.isArray(row.value))){try{tx.abort();}catch(_){}return;}
            v.put({id:sessionId+':__stscript_turn_snapshot_v1:'+t.turnId,sessionId,
              namespace:'stscript_turn_snapshot_v1',sourceTurnId:t.turnId,sequence:job.sequence+1,
              sourceRevision:row?.revision||0,value:row?structuredClone(row.value):{},revision:1,createdAt:new Date().toISOString()});
          };
          varReq.onerror=()=>{try{tx.abort();}catch(_){}};
        }

        j.put({...job,stage:ok?'CANONICAL_COMMITTED':status==='aborted'?'ABORTED':'FAILED_REQUEST',settlement:status,code,revision:job.revision+1,settledAt:new Date().toISOString(),...(recovery?{manualRecovery:recovery.receipt,previousFailureCode:job.code}: {})});
        sessionStore.put({...s,pendingTurnId:null,revision:s.revision+1,lastSettledTurnId:t.turnId});
      };
    };
    return receipt;
  });
}
async function turnJournal(sessionId){
  const records=await readAtomicStores(['compat_sessions','events_jobs'],sessionId);
  const session=records.compat_sessions.find(item=>item.id===sessionId);
  if(!session)throw error('E_STORE_UNVERIFIED','未找到兼容剧情');
  const jobs=records.events_jobs;
  const mine=jobs.filter(j=>j.sessionId===sessionId).sort((a,b)=>(a.sequence??0)-(b.sequence??0)||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id)));
  if(session.pendingTurnId&&!mine.some(j=>j.id===session.pendingTurnId))throw error('E_STORE_UNVERIFIED','未结算回合缺少 journal，禁止自动重置 pending 标志');
  return mine;
}
async function recoverTurn(sessionId,turnId,action,expectedAttemptId){
  if(!['retry','abort'].includes(action))throw error('E_CANONICAL_CONFLICT','未知恢复操作');
  return transition(sessionId,(s,{s:sessionStore,m,j})=>{
    const receipt={turnId,action};
    const req=j.get(turnId);
    req.onsuccess=()=>{
      const job=req.result;
      if(!job||job.sessionId!==sessionId||(expectedAttemptId!==undefined&&job.attemptId!==expectedAttemptId)||!['pending','failed'].includes(job.settlement)||
         s.pendingTurnId&&s.pendingTurnId!==turnId){try{req.transaction.abort();}catch(_){}return;}
      // A past failed turn cannot be replayed into an already committed newer timeline.
      const tx=req.transaction,jobSeq=job.sequence;
      const msgStore=tx.objectStore('messages');
      if(typeof req.transaction.db?.version==='number'&&!msgStore.indexNames?.contains('sessionId')){tx.abort();return;}
      const all=typeof msgStore.index==='function'&&msgStore.indexNames?.contains('sessionId')?msgStore.index('sessionId').getAll(sessionId):msgStore.getAll();
      all.onsuccess=()=>{
        if(all.result.some(v=>v.sessionId===sessionId&&v.sequence>jobSeq&&v.status==='committed'&&!v.opening)){tx.abort();return;}
        const request=m.get(job.msgId||'u_'+turnId);
        request.onsuccess=()=>{
          const user=request.result;if(!user||user.sessionId!==sessionId||user.turnId!==turnId){tx.abort();return;}
          const nextRev=s.revision+1;receipt.sessionRevision=nextRev;
          if(action==='abort'){
            m.put({...user,status:'aborted',revision:(user.revision||0)+1});
            j.put({...job,msgId:job.msgId||'u_'+turnId,sequence:jobSeq,attemptId:job.attemptId||'legacy_unknown',stage:'ABORTED_BY_USER',settlement:'aborted',code:'E_TURN_ABORTED',revision:job.revision+1});
            sessionStore.put({...s,pendingTurnId:null,revision:nextRev,lastSettledTurnId:turnId});
          }else{
            const newAttemptId=store().uid('attempt');receipt.attemptId=newAttemptId;
            m.put({...user,status:'pending',revision:(user.revision||0)+1});
            j.put({...job,msgId:job.msgId||'u_'+turnId,sequence:jobSeq,attempt:(job.attempt||1)+1,attemptId:newAttemptId,stage:'RETRY_ADMITTED',settlement:'pending',code:'',revision:job.revision+1});
            sessionStore.put({...s,pendingTurnId:turnId,revision:nextRev});
          }
        };
      };
    };
    return receipt;
  });
}
// A BroadcastChannel message is a refresh hint only. The receiving tab must
// verify this job and settlement in canonical IndexedDB before using it.
function announceSettlement(sessionId,job,kind){
 if(!job?.id||!job?.attemptId||!['committed','failed','aborted'].includes(job.settlement))return;
 root.MimaCompatLiveSync?.announce?.({sessionId,jobId:job.id,attemptId:job.attemptId,kind,settlement:job.settlement});
}
function notifyPlugins(sessionId,name,payload,eventId){
 const plugins=root.MimaCompatPlugins;if(!plugins?.publish)return;
 Promise.resolve().then(()=>plugins.publish(sessionId,name,payload,eventId)).catch(e=>{
  if(root.console?.warn)root.console.warn('Mima compat plugin delivery failed', {sessionId,turnId:payload.turnId,stage:name,error:e.message});
 });
}
function compatDiagnostic(sessionId,turnId,action,options={},attemptId=''){
 const journal=root.MimaDiagnosticJournal,id=journal?.begin?.({sessionId,turnId,action,attemptId});
 const resultMeta={};let envelope=null,candidate='';
 const emit=data=>{
  if(id&&journal?.event)try{Promise.resolve(journal.event(id,data)).catch(e=>root.console?.warn?.('兼容诊断日志保存失败',e?.message));}catch(e){root.console?.warn?.('兼容诊断日志保存失败',e?.message);}
  try{options.onDiagnostic?.(data);}catch(e){root.console?.warn?.('兼容诊断显示回调失败',e?.message);}
 };
 const onDiagnostic=event=>{
  const data=event.type==='request'?{...event,messageSources:envelope?.messageSources||[]}:event;
  if(event.type==='request'&&envelope){envelope.actualRequest=JSON.parse(JSON.stringify(event.request));envelope.actualMessageSources=envelope.messageSources;}
  emit(data);
 };
 return {resultMeta,bind:value=>{envelope=value;},candidate:value=>{candidate=String(value||'');},
  modelOptions:continuation=>({resultMeta,onDiagnostic,messageSources:envelope?.messageSources||[],...(continuation?{continuation:true}:{})}),
  committed:()=>emit({type:'settlement',status:'committed',finishKind:resultMeta.finishKind,finishReason:resultMeta.finishReason}),
  rejected:e=>emit({type:'settlement',status:e?.name==='AbortError'||e?.code==='E_TURN_ABORTED'?'aborted':e?.code==='E_CANONICAL_CONFLICT'?'conflict':'rejected',code:e?.code||'E_STORY_RUNTIME',message:e?.message||String(e),details:e?.details||'',httpStatus:e?.status||0,rawRejectedReply:e?.partialDraft||candidate,rawLimited:typeof e?.partialDraft==='string'&&e.partialDraft.length>=24000,finishKind:resultMeta.finishKind,finishReason:resultMeta.finishReason})};
}
async function dispatch(sessionId,t,options={}){
  const diagnostic=compatDiagnostic(sessionId,t.turnId,'compat_send',options,t.attemptId);
  try{
    const session=await getSession(sessionId),msgs=await sessionMessages(sessionId),resources=await resourcesFor(session);
    const history=msgs.filter(m=>m.turnId!==t.turnId&&m.sequence<t.sequence),envelope=await createEnvelopeAsync(session,resources,history,t.text,options);
    diagnostic.bind(envelope);
    if(envelope.gaps.length&&options.strictCompat===true&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','本回合含未确认的语义差异，保留消息待重试');
    await root.MimaAuthorPrompt?.assertCurrent(envelope);
    const cfg=root.MimaStandalone?.getApiConfig?.();if(!cfg)throw error('E_API_CONFIG','未配置原生 API');
    const reply=await root.MimaStandalone.callModelWithConfig(envelope.messages,cfg,cfg.temperature??0.85,options.signal,diagnostic.modelOptions(false));
    diagnostic.candidate(reply);
    if(!String(reply||'').trim())throw error('E_API_EMPTY_REPLY','模型没有返回正文');
    if(typeof root.MimaStandalone?.validateStoryReply!=='function')throw error('E_STORY_RUNTIME','角色回复校验器未加载，拒绝跳过校验');
    root.MimaStandalone.validateStoryReply(reply,{...diagnostic.resultMeta,outputContract:session.outputContract,stage:'compat_dispatch'});
    if(envelope?.mvu?.required&&!mvu())throw error('E_MVU_UNAVAILABLE','MVU 校验模块未加载，拒绝在缺失验证时提交回复');
    const mvuResult=envelope?.mvu?.required?mvu().forReply(envelope.mvu.initial,history,reply):null;
    const result=await finishTurn(sessionId,t,String(reply),'',mvuResult);
    const settled=await store().get('events_jobs',t.turnId);
    if(result.settlement!=='committed'||!settled||settled.attemptId!==t.attemptId||settled.settlement!=='committed')throw error('E_CANONICAL_CONFLICT','回合已由更新的 attempt 处理，旧回复拒绝投递');
    notifyPlugins(sessionId,'turn.committed',{turnId:t.turnId,attemptId:t.attemptId},'turn.committed:'+t.turnId);
    announceSettlement(sessionId,settled,'turn');
    // Notify only after the same atomic canonical settlement accepted both
    // assistant text and MVU state. Failed/aborted turns never emit changes.
    if(mvuResult?.active&&(mvuResult.operations?.length||0)>0)
      notifyPlugins(sessionId,'mvu.changed',{turnId:t.turnId,operationCount:mvuResult.operations.length},'mvu.changed:'+t.turnId);
    diagnostic.committed();
    return{reply:String(reply),turnId:t.turnId,envelope,result};
  }catch(e){
    diagnostic.rejected(e);
    try{const transitionReceipt=await finishTurn(sessionId,t,null,e.code||'E_STORY_RUNTIME');const final=await store().get('events_jobs',t.turnId);if(transitionReceipt.settlement==='failed'&&final?.attemptId===t.attemptId&&final.settlement==='failed'){notifyPlugins(sessionId,'turn.failed',{turnId:t.turnId,attemptId:t.attemptId,code:final.code},'turn.failed:'+t.turnId+':'+t.attemptId);announceSettlement(sessionId,final,'turn');}}catch(settle){e.settlementError=settle.message;}
    throw e;
  }
}
async function sendUnfenced(sessionId,text,options={}){
  // send() already owns the author freeze. Re-entering public preview() here
  // would reject our own in-progress operation before reaching the Provider.
  const check=await previewUnfenced(sessionId,text,{signal:options.signal});
  if(check.gaps.length&&options.strictCompat===true&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','资源存在未验证语义，请确认后再发送');
  const t=await beginTurn(sessionId,text);
  try{options.onAccepted?.({accepted:true,status:'accepted',sessionId,turnId:t.turnId});}catch(e){root.console?.warn?.('游玩工具发送回执显示失败',e);}
  return dispatch(sessionId,t,options);
}
async function retryTurnUnfenced(sessionId,turnId,options={}){
  const before=await store().get('events_jobs',turnId),message=before?await store().get('messages',before.msgId||'u_'+turnId):null;
  if(!before||!message||before.sessionId!==sessionId)throw error('E_STORE_UNVERIFIED','原回合数据无法验证');
  const s=await getSession(sessionId),resources=await resourcesFor(s),msgs=await sessionMessages(sessionId);
  const check=await createEnvelopeAsync(s,resources,msgs.filter(m=>m.sequence<(before.sequence??Math.max(0,(s.turnIndex-1)*2))),message.rawContent,options);
  if(check.gaps.length&&options.strictCompat===true&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','重试前需要确认资源语义差异');
  const receipt=await recoverTurn(sessionId,turnId,'retry',before.attemptId);
  if(!receipt.attemptId||!receipt.sessionRevision)throw error('E_CANONICAL_CONFLICT','恢复事务未能取得本次 attempt 权威');
  return dispatch(sessionId,{turnId,attemptId:receipt.attemptId,sessionRevision:receipt.sessionRevision,msgId:before.msgId||'u_'+turnId,sequence:before.sequence??Math.max(0,(s.turnIndex-1)*2),text:message.rawContent},options);
}
// Assistant-only continuation: the provider prompt ends in the latest assistant
// message; card post-history guidance is retained immediately before it. No fake user turn
// is persisted. The original reply is snapshotted before append. A distinct
// ledger owns the continuation, and late attempts cannot mutate a newer turn.
async function beginContinuation(sessionId,expected){
 return transition(sessionId,(session,{s:ses,m,j})=>{
  // Bind the validated prompt to the exact canonical version that produced it.
  if(!expected||session.revision!==expected.sessionRevision)
   throw error('E_CANONICAL_CONFLICT','续写预检后剧情已变化，拒绝旧提示词');
  if(session.pendingTurnId)throw error('E_CANONICAL_CONFLICT','当前剧情有未结算回合，禁止续写覆盖');
  if(!Number.isSafeInteger(session.turnIndex)||session.turnIndex<1)throw error('E_CANONICAL_CONFLICT','请先完成一轮角色回复再续写');
  const sequence=session.turnIndex*2-1,turnId=session.lastSettledTurnId;
  if(!turnId)throw error('E_CANONICAL_CONFLICT','最近回合缺少权威 turnId');
  const receipt={sessionId,kind:'assistant_continuation',parentTurnId:turnId,sequence};
  const job=j.get(turnId);job.onsuccess=()=>{
   const original=job.result;
   if(!original||original.sessionId!==sessionId||original.settlement!=='committed'||original.sequence!==sequence-1){try{job.transaction.abort();}catch(_){}return;}
   const q=m.get('a_'+turnId);q.onsuccess=()=>{
    const assistant=q.result;
    if(!assistant||assistant.sessionId!==sessionId||assistant.status!=='committed'||assistant.sequence!==sequence||!String(assistant.canonicalContent||'').trim()||assistant.revision!==expected.assistantRevision||assistant.canonicalContent!==expected.assistantContent){try{q.transaction.abort();}catch(_){}return;}
    const id=store().uid('cont'),attemptId=store().uid('attempt');
    const currentTime=new Date().toISOString();
    j.add({id,kind:'assistant_continuation',sessionId,attemptId,attempt:1,msgId:original.msgId,parentTurnId:turnId,assistantId:assistant.id,baseRevision:assistant.revision,sequence,settlement:'pending',stage:'CONTINUATION_ADMITTED',revision:1,createdAt:currentTime});
    ses.put({...session,pendingTurnId:id,revision:session.revision+1});
    Object.assign(receipt,{id,attemptId,assistantId:assistant.id,baseRevision:assistant.revision,baseContent:assistant.canonicalContent});
   };
  };
  return receipt;
 });
}
function continuationMode(reply,options={}){
 if(options.continuationOutputMode==='complete-html')return 'complete-html';
 if(options.continuationOutputMode==='suffix')return 'suffix';
 return /^\s*(?:<!doctype\b|<html\b)/i.test(String(reply||''))?'complete-html':'suffix';
}
function combinedContinuation(previous,addition,mode){return mode==='complete-html'?String(addition):String(previous)+'\n'+String(addition);}
async function settleContinuation(sessionId,t,addition,reason='',mvuResult=null,recovery=null,outputMode='suffix'){
 const db=await store().open();return new Promise((resolve,reject)=>{
  const tx=db.transaction(['compat_sessions','messages','events_jobs','sidecar_links'],'readwrite');
  const ses=tx.objectStore('compat_sessions'),m=tx.objectStore('messages'),jobs=tx.objectStore('events_jobs'),side=tx.objectStore('sidecar_links');
  let result={settlement:'stale'},issue;
  const failure=e=>{issue=e;try{tx.abort();}catch(_){} };
  const sq=ses.get(sessionId);sq.onsuccess=()=>{
   const session=sq.result;if(!session){failure(error('E_STORE_UNVERIFIED','续写会话已消失'));return;}
   const jq=jobs.get(t.id);jq.onsuccess=()=>{
    const job=jq.result;
    const admitted=job&&(recovery?
      ['failed','aborted'].includes(job.settlement)&&!session.pendingTurnId&&session.revision===recovery.sessionRevision&&job.revision===recovery.jobRevision&&session.turnIndex*2-1===job.sequence&&session.lastSettledTurnId===job.parentTurnId:
      job.settlement==='pending'&&session.pendingTurnId===t.id);
    if(!job||job.kind!=='assistant_continuation'||job.sessionId!==sessionId||job.attemptId!==t.attemptId||!admitted)return;
    const success=typeof addition==='string'&&addition.trim().length>0;
    const finish=()=>{
     const state=success?'committed':reason==='E_TURN_ABORTED'?'aborted':'failed';
     jobs.put({...job,settlement:state,stage:success?'CONTINUATION_COMMITTED':'CONTINUATION_FAILED',code:success?'':reason||'E_API_EMPTY_REPLY',revision:job.revision+1,settledAt:new Date().toISOString(),...(recovery?{manualRecovery:recovery.receipt,previousFailureCode:job.code}: {})});
     ses.put({...session,pendingTurnId:null,revision:session.revision+1,lastSettledTurnId:job.parentTurnId});
     result={settlement:state,id:job.id,parentTurnId:job.parentTurnId};
    };
    if(!success){finish();return;}
    const aq=m.get(job.assistantId);aq.onsuccess=()=>{
     const old=aq.result;
     if(!old||old.sessionId!==sessionId||old.turnId!==job.parentTurnId||old.status!=='committed'||old.revision!==job.baseRevision||old.canonicalContent!==t.baseContent){failure(error('E_CANONICAL_CONFLICT','续写时原角色回复已改变，不允许覆盖'));return;}
     const mode=outputMode==='complete-html'?'complete-html':'suffix';
     const append='\n'+addition;
     const finalContent=combinedContinuation(old.canonicalContent,addition,mode);
     // The final canonical HTML, not the fragment, is the authority.
     try{root.MimaStandalone.validateStoryReply(finalContent,{outputContract:session.outputContract,manualRecovery:!!recovery,stage:'compat_continuation_combined'});}catch(e){failure(e);return;}
     side.add({id:'continuation_backup_'+job.id,sessionId,assistantId:old.id,parentTurnId:job.parentTurnId,originalContent:old.canonicalContent,originalRawContent:old.rawContent??old.canonicalContent,originalRevision:old.revision,addedText:addition,outputMode:mode,revision:1,createdAt:new Date().toISOString(),...(mvuResult?.active?{mvuStateAfter:mvuResult.state}: {})});
     const mvuPatch=mvuResult?.active?{
       mvuStateAfter:mvuResult.state,
       mvuOperationCount:(old.mvuOperationCount||0)+(mvuResult.operations?.length||0),
       mvuContinuationSegments:[...(mode==='complete-html'?[]:old.mvuContinuationSegments||[]),{offset:mode==='complete-html'?0:old.canonicalContent.length+1,continuationId:job.id}]
     }:{};
     const updated={...old,rawContent:combinedContinuation(old.rawContent??old.canonicalContent,addition,mode),canonicalContent:finalContent,revision:old.revision+1,...mvuPatch};
     if(recovery||approvedReply(old))updated.metadata=recoveryMetadata(updated,recovery?.receipt);
     m.put(updated);
     finish();
    };
    aq.onerror=()=>failure(aq.error||error('E_STORE_UNVERIFIED','续写目标读取失败'));
   };
   jq.onerror=()=>failure(jq.error||error('E_STORE_UNVERIFIED','续写 ledger 读取失败'));
  };
  sq.onerror=()=>failure(sq.error||error('E_STORE_UNVERIFIED','续写会话读取失败'));
  tx.oncomplete=()=>{db.close();resolve(result);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||error('E_CANONICAL_CONFLICT','续写提交中止，原角色回复仍保留'));};
 });
}
async function continueAssistantUnfenced(sessionId,options={}){
 // Do preflight before recording a journal, so unsupported MVU does not
 // produce a synthetic pending turn or consume provider calls.
 const session=await getSession(sessionId),history=await sessionMessages(sessionId),resources=await resourcesFor(session);
 if(session.pendingTurnId)throw error('E_CANONICAL_CONFLICT','有未结算回合，请先处理');
 const latest=history.filter(m=>!m.opening).at(-1);
 if(!latest||latest.role!=='assistant'||latest.status!=='committed')throw error('E_CANONICAL_CONFLICT','只能在已完成角色回复之后续写');
 const envelope=await createEnvelopeAsync(session,resources,history,'',{...options,assistantContinuation:true});
 if(envelope.gaps.length&&options.strictCompat===true&&!options.acceptGaps)throw error('E_RESOURCE_SEMANTIC_GAP','复杂规则需要先确认');
 const ticket=await beginContinuation(sessionId,{sessionRevision:session.revision,assistantRevision:latest.revision,assistantContent:latest.canonicalContent});
 if(!ticket.id||!ticket.attemptId)throw error('E_CANONICAL_CONFLICT','续写未获得完整权威票据');
 const diagnostic=compatDiagnostic(sessionId,ticket.id,'compat_continue',options,ticket.attemptId);diagnostic.bind(envelope);
 try{
  await root.MimaAuthorPrompt?.assertCurrent(envelope);
  const cfg=root.MimaStandalone?.getApiConfig?.();if(!cfg)throw error('E_API_CONFIG','未配置原生 API');
  const reply=await root.MimaStandalone.callModelWithConfig(envelope.messages,cfg,cfg.temperature??0.85,options.signal,diagnostic.modelOptions(true));
  diagnostic.candidate(reply);
  if(!String(reply||'').trim())throw error('E_API_EMPTY_REPLY','续写模型没有返回正文');
  const mode=continuationMode(reply,options);
  const combined=combinedContinuation(latest.canonicalContent,reply,mode);
  root.MimaStandalone.validateStoryReply(reply,{...diagnostic.resultMeta,outputContract:{...(diagnostic.resultMeta?.outputContract||{}),completeHtml:false,requireHtml:false},stage:'compat_continue_fragment'});
  root.MimaStandalone.validateStoryReply(combined,{...diagnostic.resultMeta,outputContract:session.outputContract,stage:'compat_continue_combined'});
  if(envelope.mvu?.required&&!mvu())throw error('E_MVU_UNAVAILABLE','MVU 组件不可用，续写不得丢弃变量状态');
  // Each continuation's UpdateVariable is validated against the previous
  // committed state, NOT against the first assistant message's old values.
  const mvuResult=envelope.mvu?.required?mvu().forReply(envelope.mvu.initial,history,String(reply)):null;
  const settled=await settleContinuation(sessionId,ticket,String(reply),'',mvuResult,null,mode);
  if(settled.settlement!=='committed')throw error('E_CANONICAL_CONFLICT','旧续写尝试已失去提交权限');
  notifyPlugins(sessionId,'assistant.continued',{turnId:ticket.parentTurnId,continuationId:ticket.id},'assistant.continued:'+ticket.id);
  const continuationJob=await store().get('events_jobs',ticket.id);
  if(continuationJob?.attemptId===ticket.attemptId&&continuationJob.settlement==='committed')announceSettlement(sessionId,continuationJob,'continuation');
  if(mvuResult?.active&&(mvuResult.operations?.length||0)>0)
    notifyPlugins(sessionId,'mvu.changed',{turnId:ticket.parentTurnId,continuationId:ticket.id,operationCount:mvuResult.operations.length},'mvu.changed:'+ticket.id);
  diagnostic.committed();
  return{reply:String(reply),turnId:ticket.parentTurnId,continuationId:ticket.id,envelope,result:settled};
 }catch(e){diagnostic.rejected(e);try{
   const receipt=await settleContinuation(sessionId,ticket,null,e.code||'E_STORY_RUNTIME');
   if(receipt.settlement==='failed'){
     const job=await store().get('events_jobs',ticket.id);
     if(job?.attemptId===ticket.attemptId&&job.settlement==='failed')announceSettlement(sessionId,job,'continuation');
   }
  }catch(settle){e.settlementError=settle.message;}throw e;}
}
async function restoreRejectedReply(diagnosticId,{confirmed=false}={}){
 if(confirmed!==true)throw error('E_REPLY_RECOVERY_CONFIRM','请先确认手动恢复正文。');
 const record=await root.MimaDiagnosticJournal.recoveryCandidate(diagnosticId),sessionId=record.sessionId;
 if(!['compat_send','compat_continue'].includes(record.action))throw error('E_REPLY_RECOVERY_OWNER','本诊断不属于酒馆兼容回合。');
 root.MimaAuthorHost?.stopSession(sessionId,'手动恢复原回复，作者页面已停止；已提交变量保留');
 const records=await readAtomicStores(['compat_sessions','messages','events_jobs'],sessionId),session=records.compat_sessions[0],job=records.events_jobs.find(x=>x.id===record.turnId);
 if(!session||!job)throw error('E_REPLY_RECOVERY_STALE','原剧情或失败回合已不存在。');
 if(job.settlement==='committed'&&job.manualRecovery?.diagnosticId===record.id)return {sessionId,messageId:job.assistantId||'a_'+job.id,alreadyRestored:true,action:record.action};
 if(session.pendingTurnId||!['failed','aborted'].includes(job.settlement))throw error('E_REPLY_RECOVERY_STALE','这个回合已被重试、恢复或有新请求正在运行。');
 if(record.attemptId?record.attemptId!==job.attemptId:
   (job.attempt!==1||!Number.isFinite(Date.parse(job.settledAt))||record.createdAtMs<Date.parse(job.createdAt)||record.createdAtMs>Date.parse(job.settledAt)))
   throw error('E_REPLY_RECOVERY_STALE','日志无法对应原尝试，未把旧回复写入新时间线。');
 const continuation=job.kind==='assistant_continuation';
 if(continuation!==(record.action==='compat_continue'))throw error('E_REPLY_RECOVERY_OWNER','诊断与原操作类型不一致。');
 if(records.events_jobs.some(x=>x.id!==job.id&&x.sequence>=job.sequence&&String(x.createdAt||'')>=String(job.createdAt||'')))
   throw error('E_REPLY_RECOVERY_STALE','原失败回合之后已有其他回合或续写操作，未覆盖当前剧情。');
 const history=records.messages.filter(x=>x.sessionId===sessionId&&x.status==='committed'&&(continuation||x.sequence<job.sequence)).sort((a,b)=>a.sequence-b.sequence);
 const resources=await resourcesFor(session),card=resources.find(x=>x.kind==='character')?.raw;
 if(!card)throw error('E_RESOURCE_SEMANTIC_GAP','原角色资源已不存在，未恢复到其他角色。');
 const greeting=String((session.greetingIndex??0)===0?card.first_mes||'':(card.alternate_greetings||[])[(session.greetingIndex??0)-1]||'');
 const needsMvu=/<(?:initvar|UpdateVariable)\b/i.test(greeting)||resources.some(r=>r.kind==='variable_schema'||r.kind==='world_info'&&Object.values(r.raw?.entries||{}).some(e=>/\[?initvar\]?/i.test(String(e?.comment||e?.name||''))));
 if(needsMvu&&!mvu())throw error('E_MVU_UNAVAILABLE','恢复仍需验证卡片变量，MVU 组件未加载。');
 const initial=needsMvu?mvu().initial(resources,{greetingIndex:session.greetingIndex??0}):{state:null,gaps:[]};
 if(initial.gaps?.some(x=>x.reason==='MVU_MULTIPLE_INITIAL_SOURCES_CONFLICT')||initial.state===null&&(/<initvar\b/i.test(greeting)||history.some(x=>x.mvuStateAfter!==undefined)))
   throw error('E_MVU_HISTORY_CONFLICT','原变量状态无法验证，未丢弃变量强行恢复。');
 const raw=String(record.rawRejectedReply);
 root.MimaStandalone.validateStoryReply(raw,{manualRecovery:true,outputContract:{...(session.outputContract||{}),completeHtml:false,requireHtml:false}});
 const mvuResult=needsMvu?mvu().forReply(initial.state,history,raw):null;
 const recovery={sessionRevision:session.revision,jobRevision:job.revision,receipt:{diagnosticId:record.id,attemptId:job.attemptId,action:record.action,restoredAt:new Date().toISOString(),providerFinishReason:record.finishReason||''}};
 const old=continuation?records.messages.find(x=>x.id===job.assistantId):null;
 const ticket=continuation?{id:job.id,attemptId:job.attemptId,baseContent:old?.canonicalContent}:{turnId:job.id,attemptId:job.attemptId};
 const result=continuation?await settleContinuation(sessionId,ticket,raw,'',mvuResult,recovery,continuationMode(raw)):await finishTurn(sessionId,ticket,raw,'',mvuResult,recovery);
 if(result.settlement!=='committed')throw error('E_CANONICAL_CONFLICT','恢复期间原剧情已变化，未重复插入或覆盖正文。');
 announceSettlement(sessionId,{...job,settlement:'committed'},continuation?'continuation':'turn');
 return {sessionId,messageId:job.assistantId||'a_'+job.id,alreadyRestored:false,action:record.action};
}
async function abortContinuation(sessionId,id,attemptId){
 const job=await store().get('events_jobs',id);
 if(!job||job.kind!=='assistant_continuation'||job.sessionId!==sessionId||job.attemptId!==attemptId||job.settlement!=='pending')throw error('E_CANONICAL_CONFLICT','续写已经变化或完成');
 const ticket={id,attemptId};const receipt=await settleContinuation(sessionId,ticket,null,'E_TURN_ABORTED');
 if(receipt.settlement==='aborted'){
  const final=await store().get('events_jobs',id);
  if(final?.attemptId===attemptId&&final.settlement==='aborted')announceSettlement(sessionId,final,'continuation');
 }
 return receipt;
}
async function displayMessages(sessionId){
  const s=await getSession(sessionId),resources=await resourcesFor(s),regex=readRegex(resources,s),items=await sessionMessages(sessionId);
  const committed=items.filter(m=>['assistant','user'].includes(m.role)&&m.status==='committed'),useMvuDisplay=mvu()?.initial(resources,{greetingIndex:s.greetingIndex??0}).state!==null;
  const inputFor=m=>useMvuDisplay?mvu().display(m.canonicalContent):m.canonicalContent;
  let results=[];try{const macroContext=await regexMacroContext(s,resources);results=await regexProjection(committed.map((m,index)=>({input:inputFor(m),phase:m.role==='assistant'?2:1,options:{depth:committed.length-1-index,macroContext}})),regex,{isMarkdown:true,budgetMs:Math.min(5000,300+committed.length*8)});}
  catch(e){results=committed.map(()=>({ok:false,error:{code:e.code||'E_REGEX_WORKER_FAILED',message:e.message}}));}
  const byId=new Map(committed.map((m,i)=>[m.id,results[i]]));
  return items.map(m=>{const packet=byId.get(m.id);if(!packet)return{...m,displayView:inputFor(m)};return{...m,displayView:packet.result?.output??inputFor(m),displayTrace:packet.result?.trace||[],...(!packet.ok?{displayError:{...packet.error,rawRetained:true},displayErrors:packet.result?.errors||[packet.error]}:{})};});
}
async function currentMvuState(sessionId){const session=await getSession(sessionId),resources=await resourcesFor(session),items=await sessionMessages(sessionId);if(!mvu())throw error('E_MVU_UNAVAILABLE','MVU 状态组件未加载');const init=mvu().initial(resources,{greetingIndex:session.greetingIndex??0});return {...mvu().replay(init.state,items),gaps:init.gaps};}
const authorOperation=(id,work,kind)=>root.MimaAuthorHost?root.MimaAuthorHost.withTurn(id,work,kind):work();
function send(id,text,options){return authorOperation(id,()=>sendUnfenced(id,text,options),'send');}
function retryTurn(id,turnId,options){return authorOperation(id,()=>retryTurnUnfenced(id,turnId,options),'retry');}
function continueAssistant(id,options){return authorOperation(id,()=>continueAssistantUnfenced(id,options),'continue');}
function forkSession(id,cutoff,options){return authorOperation(id,()=>forkSessionUnfenced(id,cutoff,options));}
function preview(id,input,options){return authorOperation(id,()=>previewUnfenced(id,input,options));}
return Object.freeze({forkSession,currentMvuState,worldInfo,unsupportedWI,applyRegex,regexRules:readRegex,regexMacroContext,regexProjection,saveRegexSettings,macro,createEnvelope,createEnvelopeAsync,createSession,prepareNativeTemplateBinding,templateCapabilityContract,resolveCharacterSelection,getSession,sessionMessages,resourcesFor,mountResource,unmountResource,setPresetCreativeRole,resolveMedia,preview,send,continueAssistant,restoreRejectedReply,abortContinuation,retryTurn,recoverTurn,turnJournal,displayMessages,beginTurn,finishTurn});
});
