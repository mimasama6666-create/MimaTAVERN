/* Local SHA-256 worker: transferred UTF-8 input, digest-only output. */
'use strict';
importScripts('./sha256-browser.js?v=r11-20261012-2');
self.onmessage=event=>{
 const {id,buffer}=event.data;
 try{
  const sha256=self.MimaSHA256.create().update(new Uint8Array(buffer)).hex();
  self.postMessage({id,sha256});
 }catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
