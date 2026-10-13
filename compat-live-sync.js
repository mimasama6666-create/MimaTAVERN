/* Compatibility workspace: cross-tab settlement hints. NOT a Store, message
 * channel or source of truth. Receivers must validate canonical IDB ledger. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.MimaCompatLiveSync=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';
const channelName='mimatavern-compat-settlement-v1';
const handlers=new Set();let channel=null;
function identifier(value){return typeof value==='string'&&value.length>0&&value.length<=180&&/^[A-Za-z0-9:_-]+$/.test(value);}
function validate(packet){
 if(!packet||typeof packet!=='object'||packet.version!==1||!identifier(packet.sessionId)||!identifier(packet.jobId)||!identifier(packet.attemptId)||!['turn','continuation'].includes(packet.kind)||!['committed','failed','aborted'].includes(packet.settlement))return null;
 // Explicit allowlist. Never forward prompt, player data, variables or API keys.
 return{version:1,sessionId:packet.sessionId,jobId:packet.jobId,attemptId:packet.attemptId,kind:packet.kind,settlement:packet.settlement};
}
function ensure(){if(channel||typeof root.BroadcastChannel!=='function')return channel;
 try{channel=new root.BroadcastChannel(channelName);channel.onmessage=event=>{const verified=validate(event?.data);if(!verified)return;for(const handler of [...handlers])Promise.resolve().then(()=>handler(verified)).catch(e=>{root.console?.warn?.('Mima compat refresh hint handler failed',e?.message||e);});};}
 catch(e){root.console?.warn?.('Mima compat cross-tab notification unavailable',e?.message||e);channel=null;}
 return channel;
}
function announce(packet){const verified=validate({...packet,version:1});if(!verified)return false;const active=ensure();if(!active)return false;try{active.postMessage(verified);return true;}catch(e){root.console?.warn?.('Mima compat cross-tab notify failed',e?.message||e);return false;}}
function subscribe(handler){if(typeof handler!=='function')throw new TypeError('callback required');handlers.add(handler);ensure();return()=>{handlers.delete(handler);if(!handlers.size&&channel){channel.close();channel=null;}};}
return Object.freeze({announce,subscribe,validate});
});
