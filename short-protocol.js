/* Read the original numbered format. This module neither renders HTML nor
   creates story content. The template is explicitly selected by its owner. */
(() => {
 'use strict';
 const marker=/^([【［\[])(\/?)([\p{L}\p{N}_-]+)([】］\]])$/u;
 const recordLine=/^\s*([0-9０-９]{2})\s*([¦|｜ǀ∣│┃])/;
 const separators=/[¦|｜ǀ∣│┃]/g;
 const narrow=value=>String(value).replace(/[０-９：]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0));
 const cleanLabel=value=>String(value).replace(/[〈〉]/g,'').trim();
 const err=(code,message)=>Object.assign(Error(message),{code});
 const cache=new Map(), parsedSchemas=new WeakMap();
 function lines(source){
  const out=[];let start=0;
  for(const match of source.matchAll(/\r?\n/g)){
   out.push({start,end:match.index,text:source.slice(start,match.index)});
   start=match.index+match[0].length;
  }
  out.push({start,end:source.length,text:source.slice(start)});
  return out;
 }
 function templateSchema(source,options={}){
  const key=String(source??'')+'\u0000'+String(options.terminal||'');
  if(cache.has(key))return cache.get(key);
  const steps=[],pages=Object.create(null),stack=[],sourceLines=lines(String(source??''));
  const closed=new Set(sourceLines.map(line=>marker.exec(line.text.trim())).filter(m=>m?.[2]).map(m=>m[3]));
  let started=false,prose=false,last='',terminal='';
  for(const line of sourceLines){
   const value=line.text.trim(),m=marker.exec(value);
   if(m&&((m[1]==='【'&&m[4]==='】')||(m[1]==='［'&&m[4]==='］')||(m[1]==='['&&m[4]===']'))){
    if(m[2]){
     if(!started)continue;
     const opener=stack.pop();
     if(!opener||opener.tag!==m[3])throw err('E_PROTOCOL_TEMPLATE','格式样例的结束行没有配对：'+value);
     steps.push({kind:'close',tag:opener.tag,text:value});last=value;
     if(!stack.length)terminal=value;
    }else if(closed.has(m[3])){
     started=true;
     if(pages[m[3]])throw err('E_PROTOCOL_TEMPLATE','格式样例有重复栏目：'+m[3]);
     const page={tag:m[3],start:value,label:m[3],records:[]};pages[page.tag]=page;
     steps.push({kind:'open',tag:page.tag,text:value});stack.push(page);
    }
    continue;
   }
   if(!started||!value)continue;
   if(!stack.length&&/^(?:〔角色正文|〔正文|〈角色正文|〈正文)/.test(value)){
    if(prose)throw err('E_PROTOCOL_TEMPLATE','样例只能有一个正文位置');
    steps.push({kind:'prose'});prose=true;continue;
   }
   const row=recordLine.exec(value);
   if(row&&stack.length){
    const fields=value.slice(row[0].length).split(separators).map(cleanLabel);
    const id=narrow(row[1]),page=stack.at(-1);
    if(page.records.some(item=>item.id===id))throw err('E_PROTOCOL_TEMPLATE','格式样例记录重复：'+page.tag+'/'+id);
    const optional=fields.at(-1)?.endsWith('（整条可选）')===true;
    if(optional)fields[fields.length-1]=fields.at(-1).replace(/（整条可选）$/,'');
    page.records.push({id,fields,optional});continue;
   }
  }
  if(!started||!prose||stack.length||!terminal||steps.at(-1)?.kind!=='close'||terminal!==last||
     !Object.values(pages).some(page=>page.records.length))throw err('E_PROTOCOL_TEMPLATE','样例需包含完整开闭行、编号记录及 〔角色正文：…〕');
  if(options.terminal&&options.terminal.trim()!==terminal)throw err('E_PROTOCOL_TEMPLATE','每轮结束标记必须等于样例最后一个外层结束行');
  // Names are part of the selected format, never inferred from reply content.
  for(const m of String(source).matchAll(/^([\p{L}\p{N}_-]+)：([^（\n]+)/gmu))if(pages[m[1]])pages[m[1]].label=m[2].trim();
  const campus=pages.MIMA0?.records.length===9&&pages.MIMA1?.records.length===14&&pages.MIMA2?.records.length===23&&
    pages.MIMA3?.records.length===53&&pages.MIMA4?.records.length===13&&pages.MIMA5?.records.length===8;
  const schema=verifySchema({version:1,terminal,steps,pages,...(campus?{variants:'campus-r5'}:{})});
  cache.set(key,schema);while(cache.size>16)cache.delete(cache.keys().next().value);
  return schema;
 }
 function verifySchema(value){
  if(value?.kind==='semantic')return MimaStoryProtocol.verify(value);
  if(value&&typeof value==='object'&&parsedSchemas.has(value))return parsedSchemas.get(value);
  if(value?.version!==1||typeof value.terminal!=='string'||!marker.test(value.terminal)||
     !Array.isArray(value.steps)||!value.pages||value.steps.at(-1)?.text!==value.terminal)
   throw err('E_PROTOCOL_TEMPLATE','编号协议结构或每轮结束标记无效');
  const stack=[],opened=new Set();let prose=0;
  for(const step of value.steps){
   if(step?.kind==='prose'&&!stack.length){prose++;continue;}
   const match=marker.exec(String(step?.text||''));
   if(!match||match[3]!==step.tag)throw err('E_PROTOCOL_TEMPLATE','样例的栏目标记与次序无效');
   if(step.kind==='open'&&!match[2]&&!opened.has(step.tag)){
    const page=Object.hasOwn(value.pages,step.tag)?value.pages[step.tag]:null;
    if(!page||typeof page.label!=='string'||!Array.isArray(page.records)||
      page.records.some(row=>!/^\d{2}$/.test(row?.id)||!Array.isArray(row.fields)||!row.fields.length||row.fields.some(s=>typeof s!=='string'))||
      new Set(page.records.map(row=>row.id)).size!==page.records.length)throw err('E_PROTOCOL_TEMPLATE','编号记录定义不完整');
    opened.add(step.tag);stack.push(step.tag);
   }else if(step.kind==='close'&&match[2]&&stack.pop()===step.tag)continue;
   else throw err('E_PROTOCOL_TEMPLATE','样例有重复栏目或闭合顺序错误');
  }
  if(stack.length||prose!==1)throw err('E_PROTOCOL_TEMPLATE','样例需保留一个正文区并关闭全部栏目');
  parsedSchemas.set(value,value);return value;
 }
 function fieldsAt(source,start,end){
  const fields=[];let left=start;
  const value=source.slice(start,end);
  for(const m of value.matchAll(separators)){
   const at=start+m.index;fields.push({text:source.slice(left,at),start:left,end:at});left=at+1;
  }
  fields.push({text:source.slice(left,end),start:left,end});return fields;
 }
 const chat=/^(?:left|right)|发言方向/;
 const authorRecords={MIMA1:/^(?:09|1[0-4])$/,MIMA2:/^(?:1[1-4]|1[6-8]|23)$/,
  MIMA3:/^(?:27|29|33|34|4[0-3]|4[5-8]|5[0-3])$/,MIMA5:/^0[1-8]$/};
 function variantFields(spec,row,page,schema){
  const fields=row.fields;
  const labels=spec.fields;
  const direction=String(fields[0]?.text||'').trim().toLowerCase();
  if(/^(?:system|系统)$/.test(direction)&&(chat.test(labels[0]||'')||labels[0]==='system'))
   return ['系统提示标记','系统提示'];
  if(schema.variants!=='campus-r5')return labels[0]==='system'?['系统提示标记',labels[1]]:labels;
  const split=(index,pattern)=>{
   const old=fields[index],m=old&&pattern.exec(old.text);
   if(!m||!m[1]?.trim()||!m[2]?.trim())return false;
   const first=m[0].indexOf(m[1]),second=m[0].indexOf(m[2],first+m[1].length);
   fields.splice(index,1,{text:m[1],start:old.start+first,end:old.start+first+m[1].length},
    {text:m[2],start:old.start+second,end:old.start+second+m[2].length});
   return true;
  };
  if(page==='MIMA3'&&(chat.test(labels[0])||labels[0]==='system')){
   if(fields.length===1)split(0,/^\s*([^丨\r\n]{1,100}?)\s*丨\s*([\s\S]+)$/);
   if(fields.length===2&&!/^(?:left|right|左|右|左侧|右侧|system|系统)$/.test(direction))
    return labels[0]==='system'?['发言人','正文']:labels.slice(1);
   if(fields.length===2&&chat.test(labels[0]))split(1,/^\s*([^丨\r\n]{1,100}?)\s*丨\s*([\s\S]+)$/);
  }
  if(fields.length===labels.length-1){
   const clock='[0-9０-９]{1,2}[:：][0-9０-９]{2}(?:[:：][0-9０-９]{2})?';
   if(page==='MIMA0'&&row.id==='01')split(1,new RegExp('^(.+?)\\s*[·・•]\\s*('+clock+')\\s*$'));
   if(page==='MIMA4'&&/^(?:0[7-9]|10)$/.test(row.id))split(0,new RegExp('^\\s*('+clock+')\\s*[·・•]\\s*(.+)$'));
   if(page==='MIMA3'&&/^(?:26|32)$/.test(row.id))split(0,/^(.+?)\s*等\s*([0-9０-９]+)\s*人(?:觉得很赞|点赞)\s*$/);
   if(page==='MIMA3'&&row.id==='28')split(0,/^(.+?)\s*回复\s*(.+)$/);
   if(authorRecords[page]?.test(row.id)&&!split(0,/^\s*[0-9０-９]+[LlＬｌ]\s*[（(]([^）)\r\n]+)[）)]\s*[:：]\s*([^\r\n]+)$/))
    split(0,/^\s*([^:：\r\n]{1,64}?)\s*[:：]\s*([^\r\n]+)$/);
  }
  return labels[0]==='system'?['系统提示标记',labels[1]]:labels;
 }
 function checkPage(page,schema,issues){
  const spec=schema.pages[page.tag];
  const required=spec.records.filter(row=>row.optional!==true),def=new Map(spec.records.map((row,i)=>[row.id,{row,i}]));
  const seen=new Set();let last=-1;
  for(const item of page.records){
   const entry=def.get(item.id);
   const issue=(code,description,field)=>issues.push({code,page:page.tag,record:item.id,field,line:item.line,description});
   if(!entry){issue('extra_record','多出的记录 '+item.id);continue;}
   if(seen.has(item.id))issue('duplicate_record','记录 '+item.id+' 重复');
   else if(entry.i<last)issue('record_order','记录 '+item.id+' 次序颠倒');
   last=Math.max(last,entry.i);seen.add(item.id);
   const labels=variantFields(entry.row,item,page.tag,schema);
   item.labels=labels;
   if(item.fields.length>labels.length)issue('extra_fields','记录 '+item.id+' 多出字段');
   for(let i=0;i<labels.length;i++){
    const field=item.fields[i],label=labels[i];
    if(!field?.text.trim()||/^〈.*〉$/.test(field.text.trim())){if(!/（可选）$/.test(label))issue('missing_field','缺少 '+label,i);continue;}
    const value=narrow(field.text.trim());
    if(/0\s*[-–—～~]\s*100.*整数/.test(label)&&(!/^\d{1,3}%?$/.test(value)||Number(value.replace('%',''))>100))
     issue('invalid_field',label+' 需要 0–100 的整数',i);
    if(i===0&&chat.test(label)&&!/^(?:left|right|左|右|左侧|右侧)$/i.test(value))
     issue('invalid_field','发言方向需为 left、right 或同义方向',i);
    if(i===0&&label==='系统提示标记'&&!/^(?:system|系统)$/i.test(value))
     issue('invalid_field','系统提示需要 system 标记',i);
   }
  }
  for(const row of required)if(!seen.has(row.id))issues.push({code:'missing_record',page:page.tag,record:row.id,line:page.line,description:'缺少记录 '+row.id});
 }
 function inspect(raw,shape,{prefix=false,...options}={}){
  if(shape?.kind==='semantic')return MimaStoryProtocol.inspect(raw,shape,{prefix,...options});
  const schema=verifySchema(shape),source=String(raw??''),issues=[],pages=[],stack=[];
  const tags=new Set(schema.steps.filter(s=>s.text).map(s=>s.text));
  let at=0,bodyStart=-1,bodyEnd=-1,terminalEnd=-1,lineNo=0,fence='';
  const problem=(code,description,line=lineNo)=>issues.push({code,line,description});
  for(const line of lines(source)){
   lineNo++;
   const value=line.text.trim();
   let step=schema.steps[at];
   if(step?.kind==='prose'){
    if(bodyStart<0)bodyStart=line.start;
    const quotedFence=/^(`{3,}|~{3,})/.exec(value);
    if(quotedFence){if(!fence)fence=quotedFence[1];else if(quotedFence[1].startsWith(fence))fence='';continue;}
    if(fence)continue;
    if(!tags.has(value))continue;
    if(value!==schema.steps[at+1]?.text&&value===schema.terminal)continue;
    bodyEnd=line.start;
    if(!source.slice(bodyStart,bodyEnd).trim())problem('missing_prose','缺少角色正文');
    at++;step=schema.steps[at];
   }
   if(value===step?.text){
    if(step.kind==='open'){
     const page={tag:step.tag,line:lineNo,start:line.start,records:[],closeStart:null};
     stack.push(page);pages.push(page);
    }else{
     const page=stack.pop();page.closeStart=line.start;
    }
    at++;
    if(at===schema.steps.length){terminalEnd=line.end;break;}
    continue;
   }
   if(!value)continue;
   if(tags.has(value)){
    const wanted=schema.steps[at]?.text||'结束';
    problem('page_order','当前位置需要 '+wanted+'，实际为 '+value);
    // Preserve the raw text and report all remaining required sections.
    break;
   }
   if(marker.test(value)){problem('unexpected_marker','出现未定义的栏目标记 '+value);continue;}
   const page=stack.at(-1),slot=recordLine.exec(line.text);
   if(!page){problem('unexpected_text','环境栏之外出现未归属内容');continue;}
   if(slot)page.records.push({id:narrow(slot[1]),line:lineNo,start:line.start,end:line.end,fieldStart:line.start+slot[0].length});
   else if(page.records.length)page.records.at(-1).end=line.end;
   else problem('unassigned_text','栏目开头有未编号内容');
  }
  // Extract field spans in the original UTF-16 string. Record groups remain
  // intact on errors so recovery can point at the exact original bytes.
  const tail=terminalEnd>=0?source.slice(terminalEnd):'';
  function populate(page){
   for(const row of page.records)if(!row.fields)row.fields=fieldsAt(source,row.fieldStart,row.end);
  }
  for(const page of pages)populate(page);
  for(const page of pages)checkPage(page,schema,issues);
  if(terminalEnd<0){
   const next=schema.steps[at];
   if(next)problem('incomplete','剩余结构未完成：'+(next.text||'角色正文'));
   if(!issues.some(item=>item.code==='incomplete'))problem('incomplete','缺少每轮结束标记 '+schema.terminal);
  }
  if(tail.trim()&&!prefix)problem('trailing_text','结束行之后还有内容');
  const narrative=bodyStart>=0?source.slice(bodyStart,bodyEnd>=0?bodyEnd:source.length).trim():'';
  return {ok:terminalEnd>=0&&issues.length===0,end:terminalEnd,tail,issues,narrative,narrativeComplete:bodyStart>=0&&bodyEnd>=0,pages,
   complete:terminalEnd>=0,records:pages.reduce((count,p)=>count+p.records.length,0)};
 }
 function sourceCategory(page,row,label=''){
  const value=page.label+' '+label;
  if(/IF|假设|平行分支|推演|如果刚才/i.test(value))return '假设';
  if(/弹幕|场外观众|第四面墙/.test(value))return '场外评论';
  if(/计划|待办|尚未|未来|目标|伏笔/.test(label))return '计划或待实施';
  if(/想法|念头|私密日记|内心|独白|心事/.test(label))return '角色主观';
  if(/群聊|班群|私聊|朋友圈|校园墙|树洞|采访|搜索|回复/.test(value))return '档案记录或转述';
  if(/环境|现场/.test(page.label))return '当时的现场记录';
  return '当时的档案';
 }
 const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[m]));
 function readable(raw,schema,{narrativeOnly=false}={}){
  if(schema?.kind==='semantic')return MimaStoryProtocol.readable(raw,schema,{narrativeOnly});
  const result=inspect(raw,schema);
  if(narrativeOnly)return {...result,text:result.narrativeComplete?result.narrative:'',...(!result.narrativeComplete||!result.ok?{narrativeWarning:result.narrativeComplete?'格式不完整，仅导出已确认正文':'正文边界无法确认，本条已跳过'}:{})};
  if(!result.ok)return {...result,text:String(raw)};
  const chunks=['【正文】\n'+result.narrative];
  for(const item of result.pages){
   const page=schema.pages[item.tag];if(!item.records.length)continue;
   const values=item.records.map(row=>row.fields.map((field,i)=>{
    const label=(row.labels[i]||'记录').replace(/\{\{user\}\}/g,'玩家').replace(/\{\{char\}\}/g,'角色');
    const group=row.labels.some(s=>/假设|如果刚才|平行分支|推演/.test(s))?'假设':sourceCategory(page,row,label);
    return '['+group+'] '+label+'：'+decode(field.text.trim());
   }).join(' ｜ '));
   chunks.push('【'+page.label+'】\n'+values.join('\n'));
  }
  return {...result,text:chunks.join('\n\n')};
 }
 function replaceField(source,schema,changes){
  if(schema?.kind==='semantic')return MimaStoryProtocol.replaceField(source,schema,changes);
  const {page,record,field,value}=changes;
  const view=inspect(source,schema),target=view.pages.find(row=>row.tag===page),item=target?.records.find(row=>row.id===record);
  const index=Number(field),slot=item?.fields[index],replacement=String(value??'').trim();
  if((!replacement&&!/（可选）$/.test(item?.labels?.[index]||''))||replacement.search(separators)>=0||lines(replacement).some(line=>marker.test(line.text.trim())||recordLine.test(line.text)))
   throw err('E_PROTOCOL_REPAIR_VALUE','请填入真实字段内容，字段内的分隔符请用 丨');
  if(!item||!Number.isInteger(index)||index<0)throw err('E_PROTOCOL_REPAIR_TARGET','无法定位这条记录');
  if(slot)return source.slice(0,slot.start)+replacement+source.slice(slot.end);
  if(index!==item.fields.length)throw err('E_PROTOCOL_REPAIR_TARGET','请先补齐前面的字段');
  return source.slice(0,item.end)+'¦'+replacement+source.slice(item.end);
 }
 function addRecord(source,schema,changes){
  if(schema?.kind==='semantic')return MimaStoryProtocol.addRecord(source,schema,changes);
  const {page,record,values}=changes;
  const view=inspect(source,schema),target=view.pages.find(row=>row.tag===page),definitions=schema.pages[page]?.records||[];
  const index=definitions.findIndex(row=>row.id===record),def=definitions[index];
  if(!target||target.closeStart===null||!def||target.records.some(row=>row.id===record)||
    !Array.isArray(values)||values.length!==def.fields.length)
   throw err('E_PROTOCOL_REPAIR_TARGET','无法在该栏目补入这条记录');
  const fields=values.map(value=>String(value??'').trim());
  if(fields.some((value,i)=>(!value&&!/（可选）$/.test(def.fields[i]))||value.search(separators)>=0||lines(value).some(line=>marker.test(line.text.trim())||recordLine.test(line.text))))
   throw err('E_PROTOCOL_REPAIR_VALUE','请填入全部实际字段，字段内的分隔符请用 丨');
  const next=target.records.find(row=>definitions.findIndex(definition=>definition.id===row.id)>index);
  const at=next?.start??target.closeStart,eol=source.includes('\r\n')?'\r\n':'\n';
  return source.slice(0,at)+record+'¦'+fields.join('¦')+eol+source.slice(at);
 }
 function isSource(source,schema){
  const raw=String(source??'');
  if(schema?.kind==='semantic')return schema.rootOrder.some(tag=>new RegExp('^<'+tag+'(?=\\s|>)').test(raw.trimStart()));
  return schema?.steps?.some(step=>step.kind==='open'&&raw.trimStart().startsWith(step.text))===true;
 }
 // Match the same actual format framing used by legacy migration, including
 // an incomplete opening marker. A heading plus numbered list is not evidence.
 function legacySourceMatches(raw,schema){
  if(!schema)return false;
  if(isSource(raw,schema))return true;
  const first=String(raw??'').trimStart().split(/\r?\n/,1)[0].trim();
  const starts=schema.kind==='semantic'?(schema.rootOrder||[]).map(tag=>'<'+tag+'>'):(schema.steps||[]).filter(step=>step.kind==='open').map(step=>step.text);
  return first.length>=4&&starts.some(start=>start.startsWith(first));
 }
 function reservedSource(raw){return /^\s*(?:[【［\[]\/?MIMA[\w-]*[】］\]]|<(?:环境|剧情正文|档案)(?=\s|>))/u.test(String(raw??''));}
 function legacyCandidates(session,resources={}){
  const packs=(session?.regexPackIds||[]).map(id=>(resources.regexPacks||[]).find(p=>p.id===id)).filter(p=>p&&(p.protocolResource||p.compactContract||window.MimaDisplayContract?.isLegacyConverter(p)));
  const presets=(session?.presetIds||[]).map(id=>(resources.presets||[]).find(p=>p.id===id)).filter(p=>p&&p.type==='format');
  const candidates=[];
  for(const pack of packs)for(const preset of presets)try{
   if(pack.protocolResource?.presetId&&pack.protocolResource.presetId!==preset.id)continue;
   let schema=pack.protocolResource?.schema,legacySemantic=null;
   if(!schema&&!pack.compactContract){
    // A legacy converter has no native grammar of its own. An explicitly
    // imported native resource can supply the grammar only when its content
    // signatures prove this converter and the paired preset describes it.
    for(const native of resources.regexPacks||[]){const r=native.protocolResource;if(!r||!r.schema.rootOrder.every(tag=>preset.content.includes('<'+tag+'>')))continue;
     if(MimaRegexEngine.protocolDisplayPacks([pack],r)[0]===pack)continue;
     schema=r.schema;legacySemantic={compatibilityPackIds:r.compatibilityPackIds||[],compatibilityDecoders:r.compatibilityDecoders||[]};break;
    }
   }
   schema ||= templateSchema(preset.content,{terminal:pack.compactContract?.terminal||''});
   if(schema.kind==='semantic'&&schema.rootOrder.some(tag=>!preset.content.includes('<'+tag+'>')))continue;
   candidates.push({pack,preset,schema,...(legacySemantic?{legacySemantic}:{})});
  }catch(_){}
  return candidates;
 }
 function legacyEvidence(session,message,candidates=[]){
  const metadata=message?.metadata,source=String(message?.content??'');
  if(metadata?.replyProtocolRef===null||metadata?.replyProtocolRef||metadata?.displayAppliedPackIds?.length)return {sources:[],frozenSource:false,missingSource:false};
  const saved=(metadata?.legacyProtocolCandidateRefs||[]).map(id=>(session?.displayProtocols||[]).find(row=>row.id===id)).filter(Boolean).map(row=>({...row.contract,snapshotId:row.id}));
  const sources=[...saved,...candidates.filter(c=>!saved.some(v=>v.pack.id===c.pack.id&&v.preset.id===c.preset.id))].filter(c=>legacySourceMatches(source,c.schema));
  return {sources,frozenSource:(session?.displayProtocols||[]).some(record=>legacySourceMatches(source,record.contract?.schema)),missingSource:reservedSource(source)};
 }
 function readMessage(session,message,options={}){
  const ref=message?.metadata?.replyProtocolRef,source=String(message?.content??'');
  const unknown=description=>({ok:false,text:options.narrativeOnly?'':source,issues:[{description}],...(options.narrativeOnly?{narrativeWarning:description+'，正文范围无法确认，本条已跳过'}:{})});
  if(!ref){
   if(!options.annotateUnknown)return null;
   const evidence=legacyEvidence(session,message,options.legacyCandidates);
   return evidence.sources.length||evidence.frozenSource||evidence.missingSource?unknown('此历史消息未记录配套格式'):null;
  }
  const version=session?.displayProtocols?.find(row=>row.id===ref);
  if(!version)return unknown('存档缺少原格式版本');
  const schema=version.contract?.schema;
  if(schema)return options.structureOnly?inspect(source,schema):readable(source,schema,options);
  // Older non-numbered HTML contracts can still use the HTML projector.
  const evidence=legacyEvidence(session,{...message,metadata:{...message.metadata,replyProtocolRef:undefined}},options.legacyCandidates);
  return options.annotateUnknown&&(evidence.sources.length||evidence.frozenSource||evidence.missingSource)?unknown('旧版配对未记录栏位定义'):null;
 }
 window.MimaShortProtocol={isSource,legacyCandidates,legacyEvidence,templateSchema,verifySchema,inspect,readable,readMessage,replaceField,addRecord};
})();
