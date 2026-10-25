/* Import/export isolated phone archive. Restore only into verified empty phone DB. */
(()=>{'use strict';
 const store=()=>MimaPhoneStore;
 const toBase64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
 function fromBase64(source,type){const bin=atob(source),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type});}
 const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 async function build(){const names=store().stores;
   const frozen=await store().transaction(names,'readonly',async tx=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await tx.all(name)]))));
   const tables={};for(const name of names){const rows=frozen[name];tables[name]=[];for(const row of rows){if(name==='media'&&row.blob){tables[name].push({...row,blobBase64:await toBase64(row.blob),blob:undefined});}else tables[name].push(row);}}
   const data={schema:'mima_phone_archive_v1',createdAt:new Date().toISOString(),tables},canonical=JSON.stringify(data);return {format:'MIMA_PHONE_FULL_BACKUP',sha256:await sha(canonical),data};}
 async function exportToFile(){const archive=await build();const raw=JSON.stringify(archive),url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='MimaPhone_full_'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function validateRecords(tables){const messages=new Set((tables.messages||[]).map(m=>m.id));const threads=new Set((tables.conversations||[]).map(m=>m.id));const moments=new Map((tables.moments||[]).map(x=>[x.id,x]));const assets=new Set((tables.media||[]).map(x=>x.id));
   for(const m of tables.messages||[]){if(!threads.has(m.threadId))throw Error('归档聊天消息缺少会话：'+m.id);for(const a of m.assetIds||[])if(!assets.has(a))throw Error('归档消息缺少原图：'+a);}
   for(const c of tables.comments||[])if(!moments.has(c.momentId))throw Error('归档评论缺少动态：'+c.id);
   const amounts=new Map(),balances=new Map();for(const entry of tables.ledgerEntries||[]){if(!Number.isSafeInteger(entry.deltaMinor))throw Error('账本金额不是安全整数');amounts.set(entry.txId,(amounts.get(entry.txId)||0)+entry.deltaMinor);balances.set(entry.walletId,(balances.get(entry.walletId)||0)+entry.deltaMinor);}
   for(const [tx,total] of amounts)if(total!==0)throw Error('归档账本不守恒：'+tx);
   for(const wallet of tables.wallets||[]){const expected=balances.get(wallet.id)||0;if(!Number.isSafeInteger(wallet.balanceMinor)||wallet.balanceMinor!==expected||expected<0)throw Error('虚拟钱包与双分录账本不一致：'+wallet.id);}
   for(const [actor,amount] of balances)if(actor!=='virtual_issuer'&&amount!==0&&!(tables.wallets||[]).some(w=>w.id===actor))throw Error('归档账本缺失钱包：'+actor);
   const inventory=new Map((tables.inventories||[]).map(i=>[i.id,i]));for(const order of tables.orders||[]){const item=inventory.get(order.itemId);if(!item)throw Error('礼物订单缺少唯一物件：'+order.id);if(order.status==='SENT_PENDING'&&!(item.status==='pending'&&item.orderId===order.id))throw Error('未结算礼物状态与库存不符：'+order.id);}
   
   for(const [id,row] of Object.entries(tables)){if(!Array.isArray(row))throw Error('备份表格式无效：'+id);const keys=new Set();for(const item of row){const key=id==='prefs'||id==='meta'?item.key:item.id;if(!key||keys.has(key))throw Error('备份记录重复或缺主键：'+id);keys.add(key);}}
   if([...messages].length!==(tables.messages||[]).length)throw Error('备份包含重复消息');
   const maxSeq=new Map(),usedSeq=new Map();for(const m of tables.messages||[]){
     if(!Number.isSafeInteger(m.seq)||m.seq<1)throw Error('归档消息序号无效：'+m.id);
     const used=usedSeq.get(m.threadId)||new Set();if(used.has(m.seq))throw Error('同一会话包含重复消息序号：'+m.threadId);used.add(m.seq);usedSeq.set(m.threadId,used);
     maxSeq.set(m.threadId,Math.max(maxSeq.get(m.threadId)||0,m.seq));
   }
   for(const c of tables.conversations||[]){
     if(!Number.isSafeInteger(c.lastSeq)||c.lastSeq<(maxSeq.get(c.id)||0))throw Error('会话序号与消息不一致：'+c.id+'；未导入');
   }
   for(const g of tables.generations||[])for(const resultId of g.resultIds||[])if(!messages.has(resultId))throw Error('生成任务引用了不存在的消息：'+g.id);

 }
 async function importFile(file){if(!(file instanceof File))throw Error('请先选择完整备份文件');const raw=JSON.parse(await file.text());if(raw?.format!=='MIMA_PHONE_FULL_BACKUP'||raw?.data?.schema!=='mima_phone_archive_v1')throw Error('不是本版本完整小手机归档');const digest=await sha(JSON.stringify(raw.data));if(digest!==raw.sha256)throw Error('备份完整性校验失败，未修改数据库');
   const tables=raw.data.tables;for(const name of store().stores)if(!Array.isArray(tables?.[name]))throw Error('归档缺少数据表：'+name);validateRecords(tables);
   const media=[];for(const a of tables.media){if(typeof a.blobBase64!=='string')throw Error('媒体缺少原始二进制：'+a.id);const blob=fromBase64(a.blobBase64,a.mime);if(blob.size!==a.size)throw Error('媒体大小与归档不符：'+a.id);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==a.hash)throw Error('媒体原件哈希与归档不符：'+a.id);const {blobBase64,...rest}=a;media.push({...rest,blob});}
   const hydrated={...tables,media};
   // Atomic isolation: no replacement of an existing canonical database.
   await store().transaction(store().stores,'readwrite',async t=>{for(const name of store().stores){const existing=await t.all(name);if(existing.length)throw Error('本机手机已有真实数据。为防覆盖已拒绝导入：请在空白浏览器/新站点恢复');}
     for(const name of store().stores)for(const row of hydrated[name])await t.add(name,row);
   });return {restored:true,counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))};
 }
 window.MimaPhoneBackup=Object.freeze({build,exportToFile,importFile});
})();
