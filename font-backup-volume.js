/** Local fonts: bounded binary volumes and a verified manifest.
 * No library-sized Base64 copy; a single font is retained only while its volumes
 * are produced. The native share sheet cannot attest that Save to Files occurred.
 */
window.MimaFontBackup = (() => {
    'use strict';
    const CHUNK=16*1024*1024, MAGIC='MIMAFONT2\n', KEY='mima_font_volume_progress_v2';
    const enc=new TextEncoder(), dec=new TextDecoder();
    let session=null, busy=false, importBusy=false, lifecycleEpoch=0;
    let launchTask=null, folderLaunchTask=null, confirmationTask=null, ownershipTask=null, releasePending=null, ownership=null;
    // Only reveal orphan recovery after an actual failed acquisition. This is
    // not a permanent takeover button on an otherwise empty settings page.
    let orphanLeaseBlocked=false;
    const OWNER_DB='mima_font_backup_ownership_v1', OWNER_KEY='font-volume-progress', OWNER_SHADOW='mima_font_volume_owner_token_v1';
    const tabId=(crypto.randomUUID?.()||String(Date.now())+'-'+Math.random()).replace(/[^\w-]/g,'');
    function ownerError(){const e=new Error('另一标签页正在操作这份字体备份。请先结束原标签的操作；不会在后台重复保存分卷。');e.code='FONT_BACKUP_OWNED';return e;}
    function openOwnerDB(){return new Promise((resolve,reject)=>{
        const request=indexedDB.open(OWNER_DB,1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('leases'))request.result.createObjectStore('leases',{keyPath:'key'});};
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('备份协调数据库打开失败'));
        request.onblocked=()=>reject(new Error('备份协调数据库升级被其他标签阻塞'));
    });}
    async function ownerTransaction(update){
        const db=await openOwnerDB();
        try{return await new Promise((resolve,reject)=>{
            const tx=db.transaction('leases','readwrite'), store=tx.objectStore('leases');
            const get=store.get(OWNER_KEY);let value,failed;
            get.onsuccess=()=>{try{const result=update(get.result||null);value=result?.value;
                if(result?.record)store.put(result.record);
            }catch(e){failed=e;tx.abort();}};
            get.onerror=()=>{failed=get.error;tx.abort();};
            tx.oncomplete=()=>resolve(value);
            tx.onabort=()=>reject(failed||tx.error||new Error('备份会话事务中止'));
            tx.onerror=()=>{};
        });}finally{db.close();}
    }
    async function acquireOwner(recovery=null){
        if(releasePending)await releasePending;
        if(ownership)return ownership;
        if(ownershipTask)return ownershipTask;
        const task=(async()=>{
            if(navigator.locks?.request){
                let wake,accepted=false;
                const hold=new Promise(resolve=>{wake=resolve;});
                let grant,deny;const ready=new Promise((resolve,reject)=>{grant=resolve;deny=reject;});
                const lifetime=navigator.locks.request('mima-font-volume-session-v2',{mode:'exclusive',ifAvailable:true},async lock=>{
                    if(!lock){deny(ownerError());return;}
                    accepted=true;grant({kind:'web',release:async()=>{wake();await lifetime;},token:tabId});
                    await hold;
                });
                lifetime.catch(e=>deny(e));
                try{return await ready;}catch(e){if(accepted)wake();throw e;}
            }
            // Older browser: an IndexedDB read/put in one transaction gives
            // atomic acquisition. No timer/TTL can steal a suspended Safari task.
            const token=tabId+'-'+(crypto.randomUUID?.()||String(Date.now()));
            await ownerTransaction(row=>{
                if(recovery){
                    // Compare the exact old lease inside the same atomic write.
                    // Two recovery tabs may NOT successively steal each other.
                    if(!row||row.released||row.token!==recovery.token||
                        row.sessionId!==recovery.sessionId||row.writing!==recovery.writing)
                        throw new Error('原备份标签状态已变化，请重新检查后再接管；没有覆盖任何进度');
                    if(row.writing&&!recovery.interruptedConfirmed)
                        throw new Error('旧写入未获人工核对，不允许接管');
                }else if(row&&!row.released)throw ownerError();
                return {record:{key:OWNER_KEY,token,sessionId:row?.sessionId||null,released:false,writing:false},value:true};
            });
            try{localStorage.setItem(OWNER_SHADOW,token);}
            catch(shadowError){
                // The IDB lease was committed already. A failed localStorage write
                // MUST NOT leave a lease with no usable owner token. Undo only
                // our exact token; a competing tab's lease must never be altered.
                try{
                    const undone=await ownerTransaction(row=>row?.token===token&&!row.released?
                        {record:{...row,released:true,writing:false},value:true}:{value:false});
                    if(!undone)throw new Error('锁记录已被其他标签更改');
                }catch(rollbackError){
                    // If the rollback itself fails, retain the exact token for
                    // explicit release retry (and for start()'s exit cleanup).
                    // Never claim that the lease was released successfully.
                    ownership={kind:'idb',token};
                    throw new Error('字体备份身份保存失败，且租约回滚失败；仍保留本页释放令牌，请退出外观重试释放：'+
                        String(shadowError?.message||shadowError)+'；'+String(rollbackError?.message||rollbackError));
                }
                throw new Error('字体备份身份无法持久保存；本次已取得的租约已安全撤销，未启动备份：'+String(shadowError?.message||shadowError));
            }
            return {kind:'idb',token};
        })();
        ownershipTask=task;
        try{const acquired=await task;ownership=acquired;return acquired;}
        finally{if(ownershipTask===task)ownershipTask=null;}
    }
    async function checkOwner(writing){
        if(!ownership)throw ownerError();
        if(ownership.kind==='web')return;
        const token=ownership.token;
        await ownerTransaction(row=>{
            if(!row||row.released||row.token!==token)throw ownerError();
            if(writing===undefined)return {value:true};
            return {record:{...row,writing:!!writing,sessionId:session?.id||row.sessionId},value:true};
        });
    }
    async function afterWrite(){
        if(ownership?.kind!=='idb')return;
        const token=ownership.token;
        await ownerTransaction(row=>row?.token===token?{record:{...row,writing:false},value:true}:{value:false});
    }
    function releaseOwner(){
        if(releasePending)return releasePending;
        if(!ownership)return Promise.resolve();
        const held=ownership;
        const task=(async()=>{
            if(held.kind==='web')await held.release();
            else {
                const released=await ownerTransaction(row=>row?.token===held.token?{record:{...row,released:true,writing:false},value:true}:{value:false});
                if(!released)throw ownerError();
            }
            // Release must finish successfully before allowing a new session.
            // If the owner database errors, retain the token for explicit retry.
            if(ownership===held)ownership=null;
            if(held.kind==='idb')try{if(localStorage.getItem(OWNER_SHADOW)===held.token)localStorage.removeItem(OWNER_SHADOW);}catch(_){}
        })();
        releasePending=task;
        return task.finally(()=>{if(releasePending===task)releasePending=null;});
    }
    function synchronizeProgress(){
        // Once sole ownership is acquired, always use the newest durable state;
        // a stale tab must not write its previous snapshot over the owner state.
        session=null;restoreProgress();
    }
    async function beginOwned(recovery=null){
        if(releasePending)await releasePending;
        if(!ownership){await acquireOwner(recovery);synchronizeProgress();}
        await checkOwner();
    }
    async function takeOverInactive(){
        if(navigator.locks?.request)throw ownerError();
        if(ownership){refresh();return;}
        const row=await ownerTransaction(old=>({value:old}));
        if(!row||row.released){
            await beginOwned();orphanLeaseBlocked=false;
            if(!session)await start();else refresh();
            return;
        }
        // A terminated native save can leave writing:true forever. This is a
        // MANUAL disaster-recovery route, never an automatic expired lease.
        // Do not issue an ownership token without matching durable progress and
        // a human verification of the pending disk file / closed old tab.
        let pending=null;
        if(row.writing){
            let saved;
            try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch(_){}
            const p=saved?.pending;
            if(!saved||saved.id!==row.sessionId||!Array.isArray(saved.records)||
                !Number.isSafeInteger(saved.index)||saved.index<0||saved.index>saved.records.length||
                !Number.isSafeInteger(saved.part)||saved.part<0||
                !p||typeof p.filename!=='string'||!(p.kind==='volume'?p.filename.startsWith('MimaFonts_'+saved.id+'_'):p.filename.includes('_'+saved.id))||
                (p.kind!=='volume'&&p.kind!=='manifest')||
                (p.kind==='volume'&&(!/^[a-f0-9]{64}$/.test(p.sha256||'')||p.part!==saved.part))||
                (p.kind==='manifest'&&saved.index!==saved.records.length))
                throw new Error('旧备份写入中断，但无法核对原会话及待保存文件身份。为保护分卷，请勿强行接管；原始字体与进度未更改。');
            pending=p;
        }
        // The lease can outlive its progress: acquisition commits before
        // listMetadata() and the first storeProgress(). In that case the old
        // session CANNOT be resumed. Make the loss of progress explicit, and
        // never imply that previously saved files were confirmed or deleted.
        const restart=!session;
        const detail=pending?`上次写入中断：\n${pending.filename}\n\n请先检查文件 App / 保存目录，确认这份文件是已落盘还是需要重存；接管后仍必须按原文件身份逐卷确认，绝不会直接算作已保存。\n\n`:
            restart?'旧备份进度不存在或无法读取，不能续接原会话。此前已经保存的文件不会被删除或视为已确认；接管后将使用新的备份编号，从第一款字体重新创建备份。请妥善保留旧文件，不要将不同编号的分卷混合。\n\n':'';
        if(!confirm(detail+'仅在确认【原备份标签已完全关闭、没有仍在进行的文件写入】后才能接管。若原标签仍打开或被系统挂起，请先关闭它。现在确认安全接管？'))return;
        await beginOwned({token:row.token,sessionId:row.sessionId,writing:row.writing,interruptedConfirmed:!!pending});
        orphanLeaseBlocked=false;
        if(!session){
            // A takeover with no durable progress is a NEW backup, not an
            // invented continuation of the previous session/confirmed parts.
            await start();return;
        }
        refresh();
        window.toast?.(pending?'中断会话已安全接管。请核对上次分卷，选择确认保存或重新保存同名文件。':'已接管已关闭标签的备份，请继续核对待确认分卷。');
    }
    const fileBase=()=>new Date().toISOString().slice(0,10);
    const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
    const ui=()=>document.getElementById('font-volume-export-status');
    const explain=e=>String(e?.message||e||'未知错误');
    function storeProgress(){
        // Every durable transition must fail visibly BEFORE the next native
        // save / next volume. A warning-only write causes false resumability.
        if(!ownership)throw ownerError();
        try{
            if(ownership.kind==='idb'&&localStorage.getItem(OWNER_SHADOW)!==ownership.token)
                throw ownerError();
            if(!session||session.finalized){localStorage.removeItem(KEY);return true;}
            // Persist hashes/metadata only, never font bytes or Blob URLs.
            const {records,index,part,partsSaved,entries,failed,id,current,awaiting}=session;
            const state={records,index,part,partsSaved,entries,failed,id,
                current:current?{meta:current.meta,digest:current.digest,parts:current.parts}:null,
                pending:awaiting?{filename:awaiting.filename,sha256:awaiting.sha256,part:awaiting.part,kind:awaiting.kind}:null};
            localStorage.setItem(KEY,JSON.stringify(state));
            return true;
        }catch(e){
            const error=new Error('字体备份进度未能保存，已停止继续生成或确认分卷；请检查浏览器存储空间后重试：'+explain(e));
            error.code='FONT_BACKUP_PROGRESS_NOT_SAVED';error.cause=e;
            throw error;
        }
    }
    function commitProgress(change){
        // Stage changes in a separate snapshot; only publish the new session
        // after its durable counterpart is committed. Preserve native Blob,
        // directory handle and source in RAM without copying large font bytes.
        const prior=session;
        const draft=prior?{...prior,entries:[...prior.entries],failed:[...prior.failed],
            current:prior.current?{...prior.current,parts:[...prior.current.parts]}:null}:null;
        const next=change(draft);
        session=next===undefined?draft:next;
        try{storeProgress();return session;}
        catch(e){session=prior;throw e;}
    }
    function restoreProgress(){
        if(session)return;
        try{
            const saved=JSON.parse(localStorage.getItem(KEY)||'null');
            if(!saved||!Array.isArray(saved.records)||!Array.isArray(saved.entries)||!Array.isArray(saved.failed)||
                !Number.isSafeInteger(saved.index)||saved.index<0||saved.index>saved.records.length||
                !Number.isSafeInteger(saved.part)||saved.part<0||typeof saved.id!=='string')return;
            session={...saved,current:saved.current?{...saved.current,source:null}:null,
                awaiting:null,pendingInterrupted:saved.pending||null,mode:'manual',folder:null,finalized:false};
        }catch(e){console.warn('字体备份进度读取失败，原有字体数据不受影响',e);}
    }
    function refresh(){
        restoreProgress();const root=ui();if(!root)return;
        root.replaceChildren();
        if(!session){
            if(orphanLeaseBlocked&&!navigator.locks?.request&&!ownership){
                const tip=document.createElement('div');
                tip.textContent='检测到旧标签留下的字体备份占用记录，但本机没有可续接的备份进度。请先彻底关闭原标签、确认没有正在保存的文件，再手动检查是否可以接管。';
                root.append(tip);
                const claim=document.createElement('button');claim.className='ghost-btn';claim.type='button';
                claim.textContent='检查旧备份占用并手动恢复';
                claim.onclick=()=>void takeOverInactive().catch(showError);root.append(claim);
            }
            return;
        }
        const line=document.createElement('div');
        line.textContent=session.finalized?
            `备份结束：${session.entries.length} 款已归档、${session.failed.length} 款缺失。请核对保存位置的所有分卷和清单。`:
            `字体备份：已处理 ${session.index}/${session.records.length} 款，已确认 ${session.partsSaved} 卷，缺失 ${session.failed.length} 款。${session.mode==='directory'?'正在写入选定文件夹；':'每卷最多 16 MiB；清单必须最后保存。'}`;
        root.append(line);
        if(session.finalized)return;
        if(!navigator.locks?.request&&!ownership){
            const claim=document.createElement('button');claim.className='ghost-btn';claim.type='button';
            claim.textContent='接管已关闭标签的备份';claim.onclick=()=>void takeOverInactive().catch(showError);root.append(claim);
        }
        if(session.pendingInterrupted){
            const tip=document.createElement('div');tip.textContent=`上次「${session.pendingInterrupted.filename}」的保存尚未确认。请先核对文件 App：可确认已保存，或明确选择重新保存同名文件；不会自动跳过。`;root.append(tip);
        }
        const button=document.createElement('button');button.className='ghost-btn';button.type='button';button.disabled=busy;
        button.textContent=busy?'正在处理字体备份…':session.awaiting?'我已在文件 App 中确认保存':session.index===session.records.length?'生成 / 保存最终清单':'生成 / 保存下一卷';
        button.onclick=()=>session.awaiting?void confirmSaved().catch(showError):void next().catch(showError);root.append(button);
        if(session.awaiting){
            const retry=document.createElement('button');retry.className='ghost-btn';retry.type='button';retry.disabled=busy;
            retry.textContent='再次保存当前文件';retry.onclick=()=>void retryCurrent().catch(showError);root.append(retry);
        }
        if(session.pendingInterrupted&&!session.awaiting){
            const confirmOld=document.createElement('button');confirmOld.type='button';confirmOld.className='ghost-btn';
            confirmOld.textContent='我已确认上次待保存文件';confirmOld.onclick=()=>void confirmInterrupted().catch(showError);root.append(confirmOld);
        }
        if(typeof window.showDirectoryPicker==='function'&&!session.awaiting){
            const folder=document.createElement('button');folder.className='ghost-btn';folder.type='button';folder.disabled=busy;
            folder.textContent='一键保存余下分卷到文件夹';folder.onclick=()=>void startToDirectory().catch(showError);root.append(folder);
        }
        const cancel=document.createElement('button');cancel.className='ghost-btn';cancel.type='button';
        cancel.textContent=busy?'结束当前步骤后暂停':'退出备份（保留已确认进度）';
        cancel.onclick=()=>{if(busy){requestPause();return;}
            try{storeProgress();}catch(e){showError(e);return;}
            if(session.current)session.current.source=null;session=null;root.replaceChildren();releaseWithFeedback();};root.append(cancel);
        const reset=document.createElement('button');reset.className='ghost-btn';reset.type='button';reset.disabled=busy;
        reset.textContent='放弃未完成进度，重新开始';
        reset.onclick=()=>{if(!confirm('将清除本机本轮的备份进度（不会删除已经保存的卷或任何字体），确定重新开始？'))return;
            void (async()=>{await beginOwned();
                // Failed removal must not discard the only durable resume state.
                localStorage.removeItem(KEY);session=null;root.replaceChildren();await start();})().catch(showError);};root.append(reset);
    }
    function showError(e){busy=false;refresh();window.toast?.('字体备份未完成：'+explain(e));}
    function releaseWithFeedback(){void maybeReleaseInactive().catch(e=>window.toast?.('备份所有权释放失败，请重试暂停或关闭原标签：'+explain(e)));}
    function requestPause(){
        if(!session||session.finalized)return;
        session.stopRequested=true;
        // Keep this distinct from stopRequested: the active writer clears that
        // execution flag after its current native save has finished.
        session.pauseReleaseRequested=true;
    }
    function finishPause(){
        if(!session?.stopRequested)return;
        session.stopRequested=false;session.mode='manual';session.folder=null;
        if(session.current)session.current.source=null;
        try{storeProgress();}
        catch(e){window.toast?.('暂停后的备份进度无法重新确认持久保存，请检查存储空间：'+explain(e));}
    }
    function clearAfterFinish(){
        commitProgress(s=>({...s,finalized:true,current:null,awaiting:null,folder:null}));
        refresh();releaseWithFeedback();
    }
    function addConfirmed(pending){
        if(pending.kind==='manifest'){clearAfterFinish();return;}
        if(!session.current||session.current.digest!==pending.digest)throw new Error('备份卷状态不一致，未确认进度');
        const oldCurrent=session.current;
        commitProgress(s=>{
            const c=s.current;
            c.parts.push({filename:pending.filename,sha256:pending.sha256,size:pending.bytes,index:pending.part});
            s.partsSaved++;
            if(pending.part+1===pending.count){
                s.entries.push({...c.meta,sha256:c.digest,parts:c.parts});
                s.current=null;s.index++;s.part=0;
            }else s.part++;
            s.awaiting=null;s.pendingInterrupted=null;
            return s;
        });
        if(session.current===null)oldCurrent.source=null;
        refresh();
    }
    function confirmSaved(){
        if(confirmationTask)return confirmationTask;
        const task=(async()=>{
            await beginOwned();
            if(busy||!session?.awaiting)return;
            const p=session.awaiting;
            if(!confirm(`已亲自在“文件”App 或下载文件夹确认「${p.filename}」保存成功？\n系统分享弹出或返回成功不等于文件已落盘。`))return;
            await checkOwner();
            if(session?.awaiting!==p)return; // Duplicate click must not settle twice.
            addConfirmed(p);
        })();
        confirmationTask=task;return task.finally(()=>{if(confirmationTask===task)confirmationTask=null;});
    }
    async function retryCurrent(){
        await beginOwned();if(!session?.awaiting||busy)return;
        const p=session.awaiting;
        if(!p.blob)throw new Error('当前文件内容未保留，请重新生成本卷');
        busy=true;refresh();
        try{await checkOwner(true);p.outcome=await MimaFileExport.save(p.filename,p.blob,p.type);}
        finally{
            try{await afterWrite();}
            finally{
                busy=false;finishPause();
                try{await maybeReleaseInactive();}finally{refresh();}
            }
        }
    }
    function start(){
        if(launchTask)return launchTask;
        // Set the gate in the same JS turn, BEFORE listMetadata or lock awaits.
        const task=(async()=>{
            const openedAt=lifecycleEpoch;
            if(importBusy)throw new Error('字体恢复正在进行，无法同时开始备份');
            try{await beginOwned();}
            catch(e){
                if(e?.code==='FONT_BACKUP_OWNED'&&!session&&!navigator.locks?.request){
                    orphanLeaseBlocked=true;refresh();
                }
                throw e;
            }
            orphanLeaseBlocked=false;startEpochForOwner=openedAt;
            if(openedAt!==lifecycleEpoch)throw new Error('已经离开外观设置，本次字体备份未启动');
            restoreProgress();
            if(session&&!session.finalized){refresh();window.toast?.('已有未完成备份，请继续保存；不会重新覆盖进度。');return;}
            const records=await MimaFontManager.listMetadata();
            if(openedAt!==lifecycleEpoch)throw new Error('已经离开外观设置，本次字体备份未启动');
            await checkOwner();
            if(!records.length)throw new Error('字体库为空');
            commitProgress(()=>({id:(crypto.randomUUID?.()||String(Date.now())).replace(/[^\w-]/g,''),records,index:0,part:0,
                partsSaved:0,entries:[],failed:[],current:null,awaiting:null,pendingInterrupted:null,finalized:false,mode:'manual',folder:null}));
            refresh();window.toast?.('已建立分卷备份，进度会保存以便刷新后继续。最后必须保存清单。');
        })();
        launchTask=task;
        return task.finally(()=>{if(launchTask===task)launchTask=null;
            if(!session||session.finalized||lifecycleEpoch!==startEpochForOwner)releaseWithFeedback();});
    }
    let startEpochForOwner=lifecycleEpoch;
    async function maybeReleaseInactive(){
        if(busy||importBusy||!ownership)return;
        if(!session||session.stopRequested||session.pauseReleaseRequested||session.finalized||startEpochForOwner!==lifecycleEpoch){
            await releaseOwner();
            if(session)session.pauseReleaseRequested=false;
        }
    }
    function startToDirectory(){
        if(folderLaunchTask)return folderLaunchTask;
        const task=(async()=>{
        const openedAt=lifecycleEpoch;
        if(importBusy||busy)throw new Error('字体操作尚未完成，请完成当前步骤');
        if(typeof window.showDirectoryPicker!=='function')throw new Error('当前浏览器不支持文件夹批量保存，请使用逐卷保存。');
        // Picker must run synchronously from a user gesture.
        const folder=await window.showDirectoryPicker({mode:'readwrite'});
        if(openedAt!==lifecycleEpoch)throw new Error('已经离开外观设置，已取消本次文件夹备份启动');
        await start();
        if(openedAt!==lifecycleEpoch)throw new Error('已经离开外观设置，已取消本次文件夹备份启动');
        await beginOwned();
        if(busy)throw new Error('当前备份正在写入，请先完成本轮');
        if(!session||session.finalized)throw new Error('没有可继续的备份');
        if(session.awaiting||session.pendingInterrupted)throw new Error('请先确认上次文件是否已保存，再切换文件夹模式');
        session.folder=folder;session.mode='directory';storeProgress();
        await next();
        })();folderLaunchTask=task;return task.finally(()=>{if(folderLaunchTask===task)folderLaunchTask=null;});
    }
    async function saveFile(filename,blob,type){
        await checkOwner(true);
        try{
        if(session.mode==='directory'&&session.folder){
            const handle=await session.folder.getFileHandle(filename,{create:true});
            const writer=await handle.createWritable();
            try{await writer.write(blob);await writer.close();}
            catch(e){try{await writer.abort();}catch(_){}throw e;}
            return 'written'; // close() fulfilled; stronger than share-sheet completion.
        }
        return await MimaFileExport.save(filename,blob,type);
        }finally{await afterWrite();}
    }
    async function getCurrent(meta){
        if(session.current?.source)return session.current;
        const file=await MimaFontManager.backupBinaryById(meta.id);
        if(!file?.buffer)throw new Error('原始字体字节缺失');
        const buffer=file.buffer instanceof Blob?await file.buffer.arrayBuffer():file.buffer;
        if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength)throw new Error('原始字体字节为空或格式错误');
        const digest=await hash(buffer);
        const old=session.current;
        if(old&&(old.digest!==digest||old.meta.size!==buffer.byteLength)){
            const e=new Error('分卷期间原字体发生变化，已暂停本轮备份；不能混合两个版本。请重新开始备份（此前已保存的卷不会被删除）。');
            e.code='E_FONT_SOURCE_CHANGED';throw e;
        }
        const recorded=Number(meta.size),actual=buffer.byteLength;
        const validRecorded=Number.isSafeInteger(recorded)&&recorded>=0;
        const outMeta=old?.meta||{...meta,size:actual,...(!validRecorded||recorded!==actual?{
            indexedSize:validRecorded?recorded:null,
            diagnostic:[meta.diagnostic,`旧索引${validRecorded?'记录 '+recorded+' 字节':'容量无效'}，实际备份 ${actual} 字节`].filter(Boolean).join('；')}: {})};
        session.current={meta:outMeta,digest,parts:old?.parts||[],source:buffer};
        return session.current;
    }
    function volumeBlob(meta,source,part,count,sha256,bytes){
        const h={format:'mimatavern-font-volume',version:2,session:session.id,id:meta.id,part,count,size:bytes.byteLength,sha256};
        const json=enc.encode(JSON.stringify(h));if(json.length>8192)throw new Error('卷头信息超限');
        const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,json.length,true);
        return new Blob([MAGIC,length,json,bytes],{type:'application/octet-stream'});
    }
    async function next(){
        await beginOwned();restoreProgress();if(importBusy)throw new Error('字体恢复正在进行，请完成恢复后继续备份');
        if(busy||!session||session.awaiting||session.finalized)return;
        if(session.pendingInterrupted&&!session.awaiting){
            if(!confirm(`上次「${session.pendingInterrupted.filename}」未确认保存。继续会重新保存同名文件，请先检查文件 App 或使用“我已确认上次待保存文件”。仍要重新保存？`))return;
        }
        busy=true;refresh();
        try{
            while(session.index<session.records.length&&!session.stopRequested){
                const meta=session.records[session.index],part=session.part;
                let current;
                try{current=await getCurrent(meta);}
                catch(e){
                    // Closing Appearance while a read is in flight is a pause,
                    // not evidence that the source disappeared.
                    if(session.stopRequested)break;
                    await checkOwner();
                    // A changed source is NOT a missing/corrupt original. Do not
                    // advance, build a partial manifest or mislabel readable bytes.
                    if(e?.code==='E_FONT_SOURCE_CHANGED')throw e;
                    const discarded=session.current;
                    commitProgress(s=>{s.failed.push({id:meta.id,name:meta.name,reason:explain(e)});
                        s.current=null;s.index++;s.part=0;s.pendingInterrupted=null;return s;});
                    if(discarded)discarded.source=null;
                    continue;
                }
                // The user may have left Appearance while IndexedDB or the
                // full-font digest was pending. Do not begin a NEW disk write.
                if(session.stopRequested)break;
                const buffer=current.source,count=Math.ceil(buffer.byteLength/CHUNK);
                if(part>=count)throw new Error('卷号超出范围，请检查旧备份进度');
                // A view avoids a second 16 MiB ArrayBuffer allocation before
                // WebCrypto/Blob copy the bytes into the export part.
                const start=part*CHUNK,end=Math.min(buffer.byteLength,(part+1)*CHUNK);
                const slice=new Uint8Array(buffer,start,end-start);
                const sha256=await hash(slice);
                if(session.stopRequested)break;
                await checkOwner();
                if(session.stopRequested)break;
                const filename=`MimaFonts_${session.id}_${String(session.index+1).padStart(4,'0')}_${part+1}of${count}.mfontpart`;
                const blob=volumeBlob(current.meta,buffer,part,count,sha256,slice);
                const pending={kind:'volume',filename,part,count,sha256,bytes:slice.byteLength,digest:current.digest,blob,type:'application/octet-stream'};
                if(session.pendingInterrupted?.filename===filename&&session.pendingInterrupted.sha256!==sha256)throw new Error('刷新后发现当前卷字节已改变，不可确认旧卷');
                commitProgress(s=>{s.pendingInterrupted=null;s.awaiting=pending;return s;});
                refresh();
                try{pending.outcome=await saveFile(filename,blob,pending.type);}catch(e){
                    // Retain exact same Blob/identity on share rejection or save error.
                    if(session.mode==='directory'){session.mode='manual';session.folder=null;storeProgress();throw e;}
                    window.toast?.('本卷仍待保存，可点击“再次保存当前文件”：'+explain(e));
                }
                if(session.mode==='directory'&&pending.outcome==='written'){
                    await checkOwner();addConfirmed(pending); // Browser file handle close() succeeded.
                    continue;
                }
                finishPause();
                refresh();return;
            }
            if(session.stopRequested){finishPause();return;}
            if(!session.entries.length)throw new Error('全部字体原件均不可读取；未生成空备份');
            if(session.failed.length&&!session.failureApproved){
                if(!confirm(`有 ${session.failed.length} 款字体原字节不可读取。清单将标明“不完整”，仍生成？`))return;
                session.failureApproved=true;
            }
            await checkOwner();
            const manifest={format:'mimatavern-local-fonts',version:2,session:session.id,
                exportedAt:new Date().toISOString(),partial:session.failed.length>0,total:session.records.length,
                entries:session.entries,failed:session.failed};
            const filename=`咪嘛馆_本地字体_${fileBase()}_${session.id}${session.failed.length?'_不完整':''}.mfontmanifest.json`;
            const blob=new Blob([JSON.stringify(manifest)],{type:'application/json;charset=utf-8'});
            const pending={kind:'manifest',filename,blob,type:'application/json;charset=utf-8'};
            commitProgress(s=>{s.awaiting=pending;return s;});
            try{pending.outcome=await saveFile(filename,blob,pending.type);}catch(e){
                if(session.mode==='directory'){session.mode='manual';session.folder=null;storeProgress();throw e;}
                window.toast?.('清单尚待确认保存：'+explain(e));
            }
            if(session.mode==='directory'&&pending.outcome==='written'){await checkOwner();addConfirmed(pending);}
        }finally{
            busy=false;
            // Release only after the native write/close has settled and its
            // confirmed or pending outcome was persisted. Never erase the pause
            // release intent before this common exit path.
            try{await maybeReleaseInactive();}finally{refresh();}
        }
    }
    async function confirmInterrupted(){
        await beginOwned();if(!session?.pendingInterrupted||busy||session.awaiting)return;
        const p=session.pendingInterrupted;
        if(!confirm(`请在文件 App 中实际检查「${p.filename}」是否完整保存。只有确认文件存在且完整，才可跳过重存这份文件。确定已经保存？`))return;
        if(p.kind==='manifest'){
            if(session.index!==session.records.length)throw new Error('清单状态异常，不能确认');
            await checkOwner();clearAfterFinish();return;
        }
        if(p.kind!=='volume')throw new Error('未知的上次备份文件类型');
        busy=true;
        try{
            const meta=session.records[session.index],part=session.part;
            if(!meta||part!==p.part)throw new Error('上次分卷位置已发生变化，不能确认');
            const current=await getCurrent(meta),count=Math.ceil(current.source.byteLength/CHUNK);
            const bytes=new Uint8Array(current.source,part*CHUNK,Math.min(CHUNK,current.source.byteLength-part*CHUNK));
            const sha256=await hash(bytes);
            const filename=`MimaFonts_${session.id}_${String(session.index+1).padStart(4,'0')}_${part+1}of${count}.mfontpart`;
            if(filename!==p.filename||sha256!==p.sha256)throw new Error('上次分卷内容或文件名已变化，拒绝跳过');
            await checkOwner();
            addConfirmed({kind:'volume',filename,part,count,sha256,bytes:bytes.byteLength,digest:current.digest});
        }finally{
            busy=false;if(session?.current)session.current.source=null;
            finishPause();
            try{await maybeReleaseInactive();}finally{refresh();}
        }
    }
    async function readPartHeader(file){
        const prefix=MAGIC.length+4;
        if(!file||!Number.isSafeInteger(file.size)||file.size<prefix+5||file.size>prefix+8192+CHUNK)throw new Error('分卷真实体积不合法：'+(file?.name||''));
        const head=new Uint8Array(await file.slice(0,prefix).arrayBuffer());
        if(head.length!==prefix||dec.decode(head.subarray(0,MAGIC.length))!==MAGIC)throw new Error('字体分卷文件头不正确：'+file.name);
        const n=new DataView(head.buffer).getUint32(MAGIC.length,true);
        if(n<5||n>8192||file.size<prefix+n)throw new Error('字体分卷头长度不合法：'+file.name);
        const header=JSON.parse(await file.slice(prefix,prefix+n).text());
        if(header.format!=='mimatavern-font-volume'||header.version!==2)throw new Error('字体分卷版本错误：'+file.name);
        return {header,offset:prefix+n};
    }
    function validateManifest(manifest,parts){
        if(!manifest||manifest.format!=='mimatavern-local-fonts'||manifest.version!==2||!Array.isArray(manifest.entries)||!Array.isArray(manifest.failed)||typeof manifest.session!=='string')throw new Error('字体分卷清单格式不正确');
        if(manifest.partial!==(manifest.failed.length>0)||manifest.total!==manifest.entries.length+manifest.failed.length)throw new Error('备份清单完整性标记或数量不一致');
        const seen=new Set(),names=new Set();
        for(const entry of manifest.entries){
            if(typeof entry.id!=='string'||!entry.id||entry.id.length>200||seen.has(entry.id)||!Array.isArray(entry.parts)||!entry.parts.length||!Number.isSafeInteger(entry.size)||entry.size<=0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('清单存在重复、错误或缺失字体记录');
            seen.add(entry.id);let size=0;
            for(let i=0;i<entry.parts.length;i++){
                const p=entry.parts[i],file=parts.get(p?.filename);
                if(!p||typeof p.filename!=='string'||names.has(p.filename)||!file||p.index!==i||!Number.isSafeInteger(p.size)||p.size<=0||p.size>CHUNK||!/^[a-f0-9]{64}$/.test(p.sha256)||
                    !Number.isSafeInteger(file.size)||file.size<p.size+MAGIC.length+4+5||file.size>p.size+MAGIC.length+4+8192)throw new Error('缺少分卷或真实文件体积不符：'+(p?.filename||''));
                names.add(p.filename);size+=p.size;
            }
            if(!Number.isSafeInteger(size)||size!==entry.size)throw new Error('分卷字节总数与清单不一致：'+entry.name);
        }
        if([...parts.keys()].some(name=>!names.has(name)))throw new Error('选入了不属于该清单的额外分卷');
    }
    async function preflightHeaders(manifest,parts){
        // Validate all real File sizes, headers and identity before allocating
        // even a single claimed font-sized Uint8Array or writing to IndexedDB.
        const offsets=new Map();
        for(const entry of manifest.entries)for(let i=0;i<entry.parts.length;i++){
            const p=entry.parts[i],file=parts.get(p.filename),{header,offset}=await readPartHeader(file);
            if(header.session!==manifest.session||header.id!==entry.id||header.part!==i||header.count!==entry.parts.length||header.size!==p.size||header.sha256!==p.sha256||file.size-offset!==p.size)
                throw new Error('分卷头、所属字体或实际体积不符：'+p.filename);
            offsets.set(p.filename,offset);
        }
        return offsets;
    }
    async function materializeFont(entry,parts,offsets){
        const buffer=new Uint8Array(entry.size);let offset=0;
        for(const p of entry.parts){
            const bytes=await parts.get(p.filename).slice(offsets.get(p.filename)).arrayBuffer();
            if(bytes.byteLength!==p.size||await hash(bytes)!==p.sha256)throw new Error('分卷 SHA-256 校验失败：'+p.filename);
            buffer.set(new Uint8Array(bytes),offset);offset+=bytes.byteLength;
        }
        if(await hash(buffer.buffer)!==entry.sha256)throw new Error('字体整体 SHA-256 校验失败：'+entry.name);
        return {id:entry.id,name:entry.name,family:entry.family,format:entry.format,size:buffer.byteLength,createdAt:entry.createdAt,
            sourceUrlFontId:entry.sourceUrlFontId,sourceUrl:entry.sourceUrl,health:entry.health,diagnostic:entry.diagnostic,buffer:buffer.buffer};
    }
    async function importFiles(files){
        if(busy||importBusy||launchTask||folderLaunchTask)throw new Error('当前有字体备份或恢复任务，请先完成');
        const hadOwnership=!!ownership, enteredAt=lifecycleEpoch;
        let result,importError=null,releaseError=null;
        importBusy=true; // Lock this page before the first await.
        try{
            await beginOwned();
            result=await importFilesLocked(files);
        }catch(e){importError=e;}
        finally{
            // Preserve the actual IndexedDB commit/rollback result. A failure
            // to release a lease is a separate post-transaction failure, NOT an
            // import failure and must never overwrite the real import error.
            importBusy=false;
            try{
                if(lifecycleEpoch!==enteredAt){
                    if(session){
                        session.folder=null;session.mode='manual';
                        if(session.current)session.current.source=null;
                        // Progress storage failure must not skip the independent
                        // lock-release settlement after an import finishes.
                        if(ownership)try{storeProgress();}catch(e){releaseError=e;}
                    }
                    try{await maybeReleaseInactive();}
                    catch(e){releaseError=releaseError?
                        new Error(explain(releaseError)+'；所有权释放失败：'+explain(e)):e;}
                }else if(!hadOwnership&&ownership)await releaseOwner();
            }catch(e){releaseError=e;}
        }
        if(importError){
            if(releaseError)window.toast?.('字体导入失败，且备份进度同步或所有权释放也出现异常：'+explain(releaseError));
            throw importError;
        }
        if(releaseError){
            const warning='字体恢复流程已结束，但备份进度同步或所有权释放出现异常，请检查提示并重新退出外观：'+explain(releaseError);
            if(result?.cancelled)window.toast?.(warning);
            return {...result,ownershipReleaseError:warning};
        }
        return result;
    }
    async function importFilesLocked(files){
        if(!Array.isArray(files))throw new Error('文件列表无效');
        const manifestFile=files.find(f=>f.name.endsWith('.mfontmanifest.json'));
        if(!manifestFile)throw new Error('请选择同轮 .mfontmanifest.json 清单和全部 .mfontpart 分卷');
        // An untrusted manifest must never be read into memory without a
        // real-file size bound (the per-volume headers are independently capped).
        if(!Number.isSafeInteger(manifestFile.size)||manifestFile.size>32*1024*1024)throw new Error('字体备份清单体积异常，请检查文件');
        const manifest=JSON.parse(await manifestFile.text());const parts=new Map();
        for(const f of files){if(f===manifestFile)continue;if(parts.has(f.name))throw new Error('分卷文件名重复：'+f.name);parts.set(f.name,f);}
        validateManifest(manifest,parts);
        const offsets=await preflightHeaders(manifest,parts);
        if(manifest.partial&&!confirm(`归档中有 ${manifest.failed.length} 款字体原件缺失。仅恢复剩余 ${manifest.entries.length} 款，继续？`))return {cancelled:true};
        // File sizes, every header and volume ownership were preflighted above.
        // Materialize, SHA-verify and check each font exactly ONCE, then commit
        // it; if ANY subsequent file fails, receipt-verified rollback removes
        // only this import's records. Never hold the whole collection in RAM.
        let duplicates=0;
        const receipts=[];
        try{
            for(const entry of manifest.entries){
                const data=await materializeFont(entry,parts,offsets);
                const plan=await MimaFontManager.planBinaryFontRestore(data);
                if(!plan.records.length){duplicates++;continue;}
                receipts.push(await MimaFontManager.commitPortablePlan(plan,{deferRefresh:true}));
            }
        }catch(e){
            const rollback=[];
            for(const receipt of receipts.reverse())try{await MimaFontManager.rollbackPortablePlan(receipt);}catch(err){rollback.push(explain(err));}
            if(rollback.length)throw new Error('导入失败，部分写入回滚未完成，请勿重复导入：'+rollback.join('；')+'；原错误：'+explain(e));
            throw new Error('导入失败，已回滚本次新增记录：'+explain(e));
        }
        await MimaFontManager.refreshAfterBinaryRestore();
        return {added:receipts.reduce((n,r)=>n+r.added.length,0),duplicates,failed:manifest.failed.length};
    }
    function releaseInactive(){
        // Also invalidate work awaiting the folder permission picker or its
        // initial metadata read, before a session object exists.
        lifecycleEpoch++;
        if(importBusy)return; // Keep the restore transaction owned until commit/rollback settles.
        if(!session||session.finalized){releaseWithFeedback();return;}
        // Leaving Appearance/Settings must stop folder batch work. An already
        // awaited native write cannot be cancelled safely, but after it settles
        // no subsequent volume (or manifest) may start in the background.
        if(busy)requestPause();
        else{session.stopRequested=false;session.folder=null;session.mode='manual';}
        if(session.current)session.current.source=null;
        // A pending iOS save retains ONLY its current Blob to support retry.
        if(ownership)try{storeProgress();}
        catch(e){window.toast?.('离开外观时无法保存备份进度，请检查浏览器存储；先前已保存的文件不会被删除：'+explain(e));}
        // When no lock is owned, this call only drops volatile UI references;
        // do not falsely warn that an already-persisted resume state was lost.
        if(!busy)releaseWithFeedback();
    }
    restoreProgress();
    return {start,startToDirectory,next,refresh,importFiles,releaseInactive,takeOverInactive};
})();
