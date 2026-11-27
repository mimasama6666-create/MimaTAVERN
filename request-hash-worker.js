/* One owned computation at a time. The scheduler terminates this Worker when
 * its active owner cancels; queued inputs never enter the Worker. */
'use strict';
importScripts('./sha256-browser.js?v=r11-20261012-2');
self.onmessage=event=>{
 const {id,buffer}=event.data;
 try{self.postMessage({id,sha256:self.MimaSHA256.create().update(new Uint8Array(buffer)).hex()});}
 catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
self.postMessage({type:'ready'});
