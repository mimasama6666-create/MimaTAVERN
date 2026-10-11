/* Worker-owned untrusted SDK script. No DOM, no parent, no local storage or app secrets. */
'use strict';
let nextId=0;const calls=new Map(),events=new Map();
function call(method,args){return new Promise((resolve,reject)=>{const requestId=++nextId;calls.set(requestId,{resolve,reject});postMessage({type:'rpc',requestId,method,args});});}
const sdk=Object.freeze({
 getChatMessages:()=>call('getChatMessages'),
 getVariables:()=>call('getVariables'),
 setVariables:(value,expectedRevision)=>call('setVariables',{value,expectedRevision}),
 uiButton:(label,id)=>call('uiButton',{label,id}),
 on:(name,fn)=>{
  if(typeof fn!=='function')throw new Error('E_PLUGIN_API_UNSUPPORTED: invalid event callback');
  const allowed=['session.mounted','turn.committed','turn.failed','button'];
  if(!allowed.includes(name))throw new Error('E_PLUGIN_API_UNSUPPORTED: '+name);
  const list=events.get(name)||new Set();const wasEmpty=list.size===0;list.add(fn);events.set(name,list);
  if(wasEmpty&&name!=='button')call('subscribe',{name}).catch(e=>postMessage({type:'script-error',message:e.message,code:e.code}));
  return()=>{list.delete(fn);if(!list.size&&name!=='button')call('unsubscribe',{name}).catch(e=>postMessage({type:'script-error',message:e.message,code:e.code}));};
 }
});
self.onmessage=async e=>{
 const p=e.data;if(!p)return;
 if(p.type==='rpc-result'){
  const job=calls.get(p.requestId);if(!job)return;calls.delete(p.requestId);
  if(p.error)job.reject(Object.assign(new Error(p.error.message),{code:p.error.code}));else job.resolve(p.result);
 }else if(p.type==='event'){
  try{for(const fn of events.get(p.name)||[])await fn(Object.freeze({name:p.name,eventId:p.eventId,detail:p.detail,buttonId:p.buttonId}));postMessage({type:'event-ack',eventId:p.eventId});}
  catch(err){postMessage({type:'script-error',code:'E_PLUGIN_SCRIPT',message:String(err.message||err)});postMessage({type:'event-ack',eventId:p.eventId});}
 }else if(p.type==='start'){
  try{if(typeof self.__runScript!=='function')throw new Error('E_PLUGIN_API_UNSUPPORTED: missing Worker script');await self.__runScript(sdk);postMessage({type:'ready'});}
  catch(err){postMessage({type:'script-error',code:'E_PLUGIN_SCRIPT',message:String(err.message||err)});}
 }
};
