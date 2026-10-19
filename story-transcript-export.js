/**
 * Read-only, SHAREABLE transcript projection. This is deliberately NOT a
 * restorable session backup: never walk/session-serialize metadata, snapshots,
 * mounts, or model prompt messages. It reads the canonical active timeline.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaStoryTranscriptExport=api;})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  function build(session){
    if(!session||!Array.isArray(session.messages))throw new Error('E_TRANSCRIPT_SOURCE_UNVERIFIED: 剧情消息列表无法核实，未生成不完整的导出');
    if(!root.MimaHistoryHtmlProjection?.project)throw new Error('E_TRANSCRIPT_PROJECTOR_UNAVAILABLE: 剧情 HTML 净化器尚未就绪');
    const messages=[];
    for(const m of session.messages){
      if(!m||!['assistant','user'].includes(m.role))continue;
      const original=m.role==='user'&&typeof m.rawContent==='string'?m.rawContent:m.content;
      if(typeof original!=='string')throw new Error('E_TRANSCRIPT_CONTENT_UNVERIFIED: 剧情正文不是字符串，已停止导出');
      let content=original;
      if(m.role==='assistant'){
        const projected=root.MimaHistoryHtmlProjection.project(original,{enabled:true});
        if(typeof projected?.text!=='string'||['parser_unavailable','parser_failed','unverified_empty_projection'].includes(projected.reason))
          throw new Error('E_TRANSCRIPT_PROJECTION_UNVERIFIED: 历史 HTML 转换无法核实，未生成可能泄漏代码的导出');
        content=projected.text;
      }
      // Purely decorative HTML has no dialogue. Do not introduce invented text.
      if(!content.trim())continue;
      messages.push({role:m.role,content});
    }
    return {format:'mimamao-story-transcript',version:1,title:String(session.title||'咪嘛馆剧情'),messages};
  }
  function toText(transcript){
    if(transcript?.format!=='mimamao-story-transcript'||!Array.isArray(transcript.messages))throw new Error('无效剧情转录');
    return [transcript.title,'',...transcript.messages.map(m=>`${m.role==='user'?'【玩家】':'【角色】'}\n${m.content}\n`)].join('\n').replace(/\n{4,}/g,'\n\n\n');
  }
  return Object.freeze({build,toText,version:'1.0.0'});
});
