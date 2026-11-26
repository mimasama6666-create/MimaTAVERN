/**
 * Read-only, SHAREABLE transcript projection. This is deliberately NOT a
 * restorable session backup: never walk/session-serialize metadata, snapshots,
 * mounts, or model prompt messages. It reads the canonical active timeline.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaStoryTranscriptExport=api;})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  function htmlNarrative(source,contract){
    const template=root.document.createElement('template');
    template.innerHTML=source;
    const tree=template.content,structure=root.MimaHtmlStructure;
    const unknown=()=>({text:'',warning:'HTML 正文范围无法确认，本条已跳过；完整原文可独立导出'});
    if(contract.bodySelector){
      try{
        const slots=tree.querySelectorAll(contract.bodySelector);
        if(slots.length===1&&structure?.rawBalance(source).ok&&slots[0].textContent.trim()&&
          (!contract.statusSelector||!slots[0].matches(contract.statusSelector)&&!slots[0].querySelector(contract.statusSelector))){
          return {text:slots[0].innerHTML};
        }
      }catch(_){return unknown();}
      return unknown();
    }
    if(tree.querySelector('.mima-current')&&structure?.threePart(source).ok){
      const range=root.document.createRange(),out=root.document.createElement('template');
      range.setStartAfter(tree.querySelector('.mima-current'));range.setEndBefore(tree.querySelector('.mima-gaze'));
      out.content.append(range.cloneContents());
      return {text:out.innerHTML};
    }
    return unknown();
  }
  function build(session,{narrativeOnly=false,resources}={}){
    if(!session||!Array.isArray(session.messages))throw new Error('E_TRANSCRIPT_SOURCE_UNVERIFIED: 剧情消息列表无法核实，未生成不完整的导出');
    if(!root.MimaHistoryHtmlProjection?.project)throw new Error('E_TRANSCRIPT_PROJECTOR_UNAVAILABLE: 剧情 HTML 净化器尚未就绪');
    const messages=[],warnings=[];
    const legacyCandidates=root.MimaShortProtocol?.legacyCandidates(session,resources)||[];
    for(const [sourceIndex,m] of session.messages.entries()){
      if(!m||!['assistant','user'].includes(m.role))continue;
      const original=m.role==='user'&&typeof m.rawContent==='string'?m.rawContent:m.content;
      if(typeof original!=='string')throw new Error('E_TRANSCRIPT_CONTENT_UNVERIFIED: 剧情正文不是字符串，已停止导出');
      let content=original,warning='';
      if(m.role==='assistant'){
        const short=root.MimaShortProtocol?.readMessage(session,m,{narrativeOnly,annotateUnknown:true,legacyCandidates});
        if(short){
          content=short.text;
          if(!short.ok||short.narrativeWarning)warning=short.narrativeWarning||(narrativeOnly?'格式不完整，仅导出可确认正文':short.issues[0]?.description||'栏位未完整识别，已保留原文');
        }else{
          const view=narrativeOnly&&root.document&&/<\/?[a-z][\w-]*(?=[\s/>])/i.test(original)?
            htmlNarrative(original,session.promptSettings?.outputContract||{}):{text:original};
          const projected=root.MimaHistoryHtmlProjection.project(view.text,{enabled:true});
          if(typeof projected?.text!=='string'||['parser_unavailable','parser_failed','unverified_empty_projection'].includes(projected.reason))
            throw new Error('E_TRANSCRIPT_PROJECTION_UNVERIFIED: 历史 HTML 转换无法核实，未生成可能泄漏代码的导出');
          content=projected.text;
          warning=view.warning||'';
        }
      }
      // Purely decorative HTML has no dialogue. Do not introduce invented text.
      if(warning)warnings.push({message:content.trim()?messages.length+1:null,sourceMessage:sourceIndex+1,description:warning,...(!content.trim()?{skipped:true}:{})});
      if(!content.trim())continue;
      messages.push({role:m.role,content});
    }
    return {format:'mimamao-story-transcript',version:1,title:String(session.title||'咪嘛馆剧情'),messages,
      ...(narrativeOnly?{scope:'narrative'}:{}),...(warnings.length?{warnings}:{})};
  }
  function toText(transcript){
    if(transcript?.format!=='mimamao-story-transcript'||!Array.isArray(transcript.messages))throw new Error('无效剧情转录');
    const warnings=new Map((transcript.warnings||[]).map(row=>[row.message,row.description]));
    return [transcript.title,...(transcript.warnings||[]).filter(row=>row.skipped).map(row=>'【导出说明】第 '+row.sourceMessage+' 条：'+row.description),'',...transcript.messages.map((m,i)=>`${m.role==='user'?'【玩家】':'【角色】'}\n${warnings.has(i+1)?'【保留说明】'+warnings.get(i+1)+'\n':''}${m.content}\n`)].join('\n');
  }
  return Object.freeze({build,toText,version:'1.0.0'});
});
