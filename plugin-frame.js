/* Only sandboxed opaque-origin iframe controller. Script is executed by a disposable blob Worker. */
(()=>{'use strict';let initialized=false,port=null,worker=null,job=0;
const status=document.getElementById('plugin-status'),inlineSource=document.getElementById('plugin-worker-source');
const awaiting=new Map();function trouble(code,message){status.textContent=code+': '+message;}
function stop(code,message){for(const timer of awaiting.values())clearTimeout(timer);awaiting.clear();worker?.terminate();worker=null;if(message)trouble(code,message);}
window.addEventListener('message',ev=>{
 if(initialized||ev.source!==window.parent||ev.data?.type!=='mima-init'||ev.ports.length!==1)return;
 initialized=true;port=ev.ports[0];
 const source=String(ev.data.source||'');const scriptBundle=inlineSource.textContent+'\nself.__runScript=async function(MimaCompatSDK){\n\"use strict\";\n'+source+'\n};';const blob=new Blob([scriptBundle],{type:'text/javascript'}),url=URL.createObjectURL(blob);
 try{worker=new Worker(url,{name:'mima-compat-plugin-worker'});}catch(e){URL.revokeObjectURL(url);trouble('E_PLUGIN_WORKER',e.message);return;}
 URL.revokeObjectURL(url);
 const initTimer=setTimeout(()=>stop('E_PLUGIN_BUDGET','脚本初始化未完成，已强制终止隔离 Worker'),1500);
 worker.onmessage=event=>{
  const packet=event.data;
  if(packet?.type==='ready'){clearTimeout(initTimer);status.textContent='受控插件 Worker 已完成初始化（非 Tavern Helper 完整运行）';}
  else if(packet?.type==='script-error'){clearTimeout(initTimer);trouble(packet.code||'E_PLUGIN_SCRIPT',packet.message);}
  else if(packet?.type==='rpc')port.postMessage(packet);
  else if(packet?.type==='event-ack'){const timer=awaiting.get(packet.eventId);if(timer){clearTimeout(timer);awaiting.delete(packet.eventId);}}
 };
 worker.onerror=e=>{clearTimeout(initTimer);stop('E_PLUGIN_WORKER',e.message||'script execution error');};
 port.onmessage=e=>{
  const packet=e.data;if(!worker||!packet)return;
  if(packet.type==='rpc-result')worker.postMessage(packet);
  else if(packet.type==='event'){
   const eventId=packet.eventId||'button-'+(++job);
   const timer=setTimeout(()=>stop('E_PLUGIN_BUDGET','插件事件处理未在预算内完成，已终止隔离 Worker'),1500);
   awaiting.set(eventId,timer);worker.postMessage({...packet,eventId});
  }
 };
 worker.postMessage({type:'start'});
});
})();
