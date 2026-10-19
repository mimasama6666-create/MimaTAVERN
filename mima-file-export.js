/**
 * Browser-only file export. Mobile Apple Safari may ignore <a download> and
 * preview JSON as a document. On supported Apple devices prefer native file
 * share (Save to Files), never a JSON preview. The browser alone cannot force
 * a guaranteed system Downloads transaction on every iOS version.
 */
(function(root){
  'use strict';
  let pending=null;
  function safeName(s){const n=String(s||'mimamao-export').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');if(n.length<=180)return n;const extension=/\.[a-z0-9]{1,12}$/i.exec(n)?.[0]||'';return n.slice(0,180-extension.length)+extension;}
  function isAppleTouch(){const n=root.navigator||{};return /iPhone|iPad|iPod/.test(n.userAgent||'')||(n.platform==='MacIntel'&&n.maxTouchPoints>1);}
  function announce(text){const el=root.document?.getElementById('mima-export-task-status');if(el)el.textContent=text;}
  function taskUI(){
    let node=root.document.getElementById('mima-export-task');if(node)return node;
    node=root.document.createElement('aside');node.id='mima-export-task';
    node.setAttribute('role','status');node.style.cssText='position:fixed;inset:auto 12px 18px;z-index:2147483640;padding:12px 14px;border-radius:14px;background:#26282e;color:#fff;box-shadow:0 5px 30px #0006;max-width:440px;margin:auto;font:14px/1.5 system-ui,sans-serif';
    const title=root.document.createElement('div');title.textContent='📁 导出文件已准备';title.style.fontWeight='650';node.appendChild(title);
    const status=root.document.createElement('div');status.id='mima-export-task-status';status.style.cssText='overflow-wrap:anywhere;margin:5px 0 9px';node.appendChild(status);
    const share=root.document.createElement('button');share.type='button';share.textContent='保存到“文件” / 系统分享';share.style.cssText='padding:8px 12px;margin:0 8px 0 0;border-radius:9px;background:#e6e6ee;color:#222';share.onclick=()=>{if(pending)void nativeShare(pending);};node.appendChild(share);
    const download=root.document.createElement('button');download.type='button';download.textContent='浏览器下载';download.style.cssText='padding:8px 12px;margin:0 8px 0 0;border-radius:9px;background:#e6e6ee;color:#222';download.onclick=()=>{if(pending)anchorDownload(pending);};node.appendChild(download);
    const close=root.document.createElement('button');close.type='button';close.textContent='关闭';close.style.cssText='padding:8px;border:0;background:transparent;color:white';close.onclick=()=>{pending=null;node.remove();};node.appendChild(close);
    root.document.body.appendChild(node);return node;
  }
  function showTask(job,message){pending=job;taskUI();announce(message||`${job.name}（可重新选择保存方式）`);}
  function canNative(job){const n=root.navigator||{};if(!n.share||!n.canShare||typeof root.File!=='function')return false;try{return !!n.canShare({files:[new root.File([job.blob],job.name,{type:job.blob.type})]});}catch{return false;}}
  function anchorDownload(job){
    const url=root.URL.createObjectURL(job.blob);
    const link=root.document.createElement('a');link.href=url;link.download=job.name;link.style.display='none';root.document.body.appendChild(link);
    try{link.click();if(isAppleTouch())showTask(job,`${job.name}：已提交浏览器下载；若系统仍预览，请尝试系统分享/存储到文件。`);}finally{link.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),300000);}
  }
  function nativeShare(job){
    if(!canNative(job)){showTask(job,'当前浏览器不支持系统文件分享，请使用浏览器下载。');return Promise.resolve('unsupported');}
    let promise;
    try{promise=root.navigator.share({files:[new root.File([job.blob],job.name,{type:job.blob.type})],title:job.name});}
    catch(e){showTask(job,'系统文件分享未启动，请点击“保存到文件”重试，或使用浏览器下载。');return Promise.resolve('blocked');}
    // A resolved share request is NOT proof the user selected Save to Files.
    return Promise.resolve(promise).then(()=>{const el=root.document.getElementById('mima-export-task');if(el)el.remove();pending=null;return 'shared';},e=>{
      showTask(job,e?.name==='AbortError'?'文件仍在本页准备区，未保存；可再次选择。':'分享未完成，可点“保存到文件”重试或选择浏览器下载。');return 'not_saved';
    });
  }
  function save(name,content,type='application/octet-stream'){
    if(!root.document?.body)throw new Error('E_EXPORT_PAGE_UNAVAILABLE');
    const filename=safeName(name);const mime=String(type||'application/octet-stream');
    const blob=content instanceof Blob?content:new Blob([content],{type:mime});
    if(!blob.size)throw new Error('E_EXPORT_EMPTY_FILE: 文件内容为空，未生成假下载');
    const job={name:filename,blob};
    // Must invoke navigator.share directly in the original click stack when possible.
    if(isAppleTouch()&&canNative(job)){showTask(job,`${filename}：正在打开系统文件保存入口…`);return nativeShare(job);}
    anchorDownload(job);return Promise.resolve('download_requested');
  }
  root.MimaFileExport=Object.freeze({save,version:'1.0.0'});
})(typeof window!=='undefined'?window:globalThis);
