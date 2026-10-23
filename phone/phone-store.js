/* Mima Phone — separate canonical IndexedDB. Never touches tavern state. */
(()=>{'use strict';
 const DB='mima_phone_v1', VERSION=1;
 const definitions={meta:'key',contacts:'id',conversations:'id',memberships:'id',messages:'id',events:'id',generations:'id',moments:'id',comments:'id',reactions:'id',notices:'id',wallets:'id',ledgerEntries:'id',gifts:'id',inventories:'id',orders:'id',media:'id',memories:'id',memoryGrants:'id',drafts:'id',prefs:'key'};
 const indices={contacts:[['maskId','maskId',{unique:true}]],messages:[['threadSeq',['threadId','seq'],{unique:true}],['threadId','threadId']],events:[['commandId','commandId',{unique:true}]],comments:[['momentId','momentId']],ledgerEntries:[['txId','txId']],moments:[['createdAt','createdAt']],orders:[['itemId','itemId']],generations:[['threadId','threadId']],media:[['hash','hash']]};
 let dbPromise=null,dbError=null;
 function id(prefix='p'){return prefix+'_'+(crypto?.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));}
 function req(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error('IDB request failed'));});}
 function open(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{
   if(!indexedDB){reject(Error('浏览器未提供 IndexedDB，手机数据不可用'));return;}
   let blocked=false;let request;try{request=indexedDB.open(DB,VERSION);}catch(e){reject(e);return;}
   request.onupgradeneeded=()=>{const database=request.result;for(const [name,keyPath] of Object.entries(definitions)){
     const store=database.objectStoreNames.contains(name)?request.transaction.objectStore(name):database.createObjectStore(name,{keyPath});
     for(const [index,path,options] of indices[name]||[])if(!store.indexNames.contains(index))store.createIndex(index,path,options);
   }};
   request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();dbPromise=null;dbError=Error('手机存储版本已变化，请重新打开页面核对');};dbError=null;resolve(db);};
   request.onerror=()=>{dbError=request.error||Error('无法读取手机数据库');dbPromise=null;reject(dbError);};
   request.onblocked=()=>{blocked=true;dbError=Error('其他标签持有旧版本数据库，无法安全升级');dbPromise=null;reject(dbError);};
 });return dbPromise;}
 async function transaction(names,mode,fn){const db=await open();if(dbError)throw dbError;
   const tx=db.transaction([...new Set(names)],mode), completion=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('手机存储事务已中止'));tx.onerror=()=>{};});
   const api={get:(name,key)=>req(tx.objectStore(name).get(key)),all:(name)=>req(tx.objectStore(name).getAll()),byIndex:(name,index,value)=>req(tx.objectStore(name).index(index).getAll(value)),put:(name,value)=>req(tx.objectStore(name).put(value)),add:(name,value)=>req(tx.objectStore(name).add(value)),delete:(name,key)=>req(tx.objectStore(name).delete(key))};
   let result;try{result=await fn(api);}catch(e){try{tx.abort();}catch(_){}await completion.catch(()=>{});throw e;}
   await completion;return result;
 }
 async function read(name,key){return transaction([name],'readonly',t=>t.get(name,key));}
 async function all(name){return transaction([name],'readonly',t=>t.all(name));}
 async function query(name,index,key){return transaction([name],'readonly',t=>t.byIndex(name,index,key));}
 async function write(name,row){return transaction([name],'readwrite',t=>t.put(name,row));}
 // Command uniqueness is the source of truth, never the page-local button state.
 async function command(commandId,stores,operation,fn){if(!commandId)throw Error('缺少稳定的 commandId');return transaction([...stores,'events'],'readwrite',async t=>{
    const existing=await t.byIndex('events','commandId',commandId);if(existing.length)return existing[0].result;
    const result=await fn(t);if(result===undefined)throw Error('命令没有可追溯的结算结果');
    await t.add('events',{id:id('ev'),commandId,operation,createdAt:new Date().toISOString(),result});return result;
 });}
 function error(){return dbError;}
 window.MimaPhoneStore=Object.freeze({id,open,transaction,read,all,query,write,command,error,stores:Object.keys(definitions),name:DB});
})();
