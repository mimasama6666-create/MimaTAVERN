/**
 * Model-facing HISTORY projection only. Never mutate canonical History, display
 * markup, prompt presets, user input, or persisted memory.
 * Do not use this as a sanitizer for inserting arbitrary HTML into the DOM.
 */
(() => {
  'use strict';
  const tagEvidence = /<(?:!--|!doctype\s+html|\/?(?:html|body|div|span|p|br|hr|section|article|header|footer|main|aside|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|blockquote|details|summary|style|script|img|picture|svg|strong|em|small|b|i|a|label|input|progress|meter|button|textarea|pre|code|figure|figcaption|select|option|dl|dt|dd)\b)[^>]*>/i;
  const discard = new Set(['style','script','link','meta','head','template','iframe','object','embed','canvas']);
  const block = new Set(['address','article','aside','blockquote','body','dd','details','div','dl','dt','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','header','main','nav','ol','p','pre','section','summary','table','tbody','tfoot','thead','tr','ul']);
  const fenced = /((?:^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*(?:```|~~~)[ \t]*(?=\n|$))/g;
  function projectPart(source) {
    if (!tagEvidence.test(source)) return {text:source,changed:false};
    if (typeof document==='undefined' || !document.createElement) return {text:source,changed:false,reason:'parser_unavailable'};
    try {
      // template.content is detached/inert; no script is executed or mounted.
      const template=document.createElement('template');
      template.innerHTML=source;
      let output='';
      const put=v=>{output+=v;};
      const line=()=>{if(output&&!output.endsWith('\n'))put('\n');};
      const visit=node=>{
        if(node.nodeType===3){put(node.nodeValue||'');return;}
        if(node.nodeType!==1&&node.nodeType!==11)return;
        if(node.nodeType===11){for(const n of node.childNodes)visit(n);return;}
        const tag=node.localName?.toLowerCase()||'';
        if(discard.has(tag))return;
        if(tag==='br'){line();return;}
        if(tag==='hr'){line();return;}
        if(tag==='img' || tag==='area'){
          const alt=(node.getAttribute('alt')||node.getAttribute('aria-label')||node.getAttribute('title')||'').trim();
          put(alt?`[图片：${alt}]`:'[图片]');return;
        }
        if(tag==='input'){
          if((node.getAttribute('type')||'').toLowerCase()==='hidden')return;
          const label=(node.getAttribute('aria-label')||node.getAttribute('title')||'').trim();
          const value=node.getAttribute('value');
          if(label||value!==null)put([label,value].filter(v=>v!==null&&v!=='').join('：'));
          return;
        }
        if(tag==='progress'||tag==='meter'){
          const label=(node.getAttribute('aria-label')||node.getAttribute('title')||'').trim();
          const v=node.getAttribute('value'),max=node.getAttribute('max');
          if(label||v!==null)put([label,v===null?'':max?`${v}/${max}`:v].filter(Boolean).join('：'));
        }
        if(tag==='svg'){
          // Graphic paths are layout, but SVG <text> can contain actual data.
          for(const e of node.querySelectorAll('text,tspan')){
            if(e.closest('text')!==e && e.localName==='tspan')continue;
            const t=e.textContent?.trim();if(t){line();put(t);}
          }
          return;
        }
        const isBlock=block.has(tag);
        if(isBlock)line();
        if(tag==='li'){
          line();put('- ');
        }
        // A textless status glyph may expose its only information through an
        // accessibility label or title. Never emit CSS classes/IDs/JS attrs.
        if(!node.textContent?.trim()){
          const name=(node.getAttribute('aria-label')||node.getAttribute('title')||'').trim();
          if(name)put(name);
        }
        for(const child of node.childNodes)visit(child);
        if(tag==='td'||tag==='th'){
          const next=node.nextElementSibling;
          if(next&&(next.localName==='td'||next.localName==='th'))put(' | ');
        }
        if(isBlock)line();
      };
      visit(template.content);
      const result=output.replace(/\r\n?/g,'\n').replace(/[\t ]+\n/g,'\n').replace(/\n[\t ]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
      // HTML parsing must never silently turn nonempty narrative into nothing.
      // Empty decorative markup can legitimately vanish; recognizable textual
      // content that failed parsing is safer to keep than to guess away.
      const hasBodyText=/>\s*[^<\s][^<]*</.test(source);
      const onlyDecorative=[...template.content.childNodes].every(n=>
        (n.nodeType===3 && !(n.nodeValue||'').trim()) || n.nodeType===8 ||
        (n.nodeType===1 && discard.has(n.localName?.toLowerCase())));
      if(!result && hasBodyText && !onlyDecorative)return {text:source,changed:false,reason:'unverified_empty_projection'};
      return {text:result,changed:result!==source};
    } catch (error) {
      return {text:source,changed:false,reason:'parser_failed'};
    }
  }
  function project(input,{enabled=true}={}) {
    const raw=String(input??'');
    if(!enabled||!raw)return {text:raw,changed:false,beforeChars:raw.length,afterChars:raw.length,reason:enabled?'no_content':'disabled'};
    // Code fences are deliberate literal code, not necessarily an HTML UI.
    // Preserve them verbatim to avoid corrupting a quoted programming scene.
    const parts=raw.split(fenced);
    let changed=false,reason='';
    const result=parts.map(part=>{
      if(/^[\n \t]*(?:```|~~~)/.test(part))return part;
      const p=projectPart(part);changed=changed||p.changed;if(p.reason)reason=p.reason;
      return p.text;
    }).join('');
    return {text:result,changed,beforeChars:raw.length,afterChars:result.length,reason};
  }
  window.MimaHistoryHtmlProjection=Object.freeze({project,version:'1.0.0'});
})();
