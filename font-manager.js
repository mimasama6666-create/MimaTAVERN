/** 🍷 咪嘛馆本地字体库：TTF/OTF/WOFF/WOFF2 -> IndexedDB -> FontFace */
window.MimaFontManager = (() => {
    const DB_NAME = 'mimamao_tavern_assets_v1';
    const STORE = 'fonts'; // Immutable legacy binary store. Keep it for old releases and safe recovery.
    const INDEX_DB = 'mimamao_tavern_fonts_v2';
    const META_STORE = 'font_metadata', BINARY_STORE = 'font_binary', STATE_STORE = 'font_state', CLAIM_STORE='font_hash_claims';
    let migrationRead = null, legacySyncRequested=false, startupSyncStarted=false;

    const UI_KEY = 'mimamao_tavern_ui_font';
    const STORY_KEY = 'mimamao_tavern_story_font';
    // UI, story, visible readers and one explicit preview own loaded faces.
    // Only selected/visible sources are decoded; stored records remain untouched.
    const loaded = new Map();
    // Native decoder rejections are stable for identical stored bytes within
    // this page session. Re-observing a row must not re-read a multi-MB file.
    // Keys include the committed content version; explicit retry can opt out.
    const decodeFailures = new Map();
    const decodeKey = meta => String(meta.id)+'@'+versionOf(meta);
    function getDecodeFailure(meta){return meta ? (decodeFailures.get(decodeKey(meta))||'') : '';}
    const stageByVersion = new Map();
    const profiles = new Map(); // Small, bounded, derived read-only reports; never the source of truth.
    const profileKey = meta => decodeKey(meta);
    function stageOf(meta){return meta ? stageByVersion.get(decodeKey(meta))||{state:'stored',stage:'stored',message:''}:{state:'idle',stage:'none',message:''};}
    function stage(meta,state,at,message=''){
        if(meta)stageByVersion.set(decodeKey(meta),{state,stage:at,message:String(message?.message||message||'').slice(0,240)});
    }
    const BUNDLE_KEY='mimamao_tavern_font_subsets_v1';
    function allBundles(){
        const raw=localStorage.getItem(BUNDLE_KEY);if(!raw)return {version:1,ui:null,story:null};
        const v=JSON.parse(raw);if(v?.version!==1||!['ui','story'].every(k=>v[k]===null||
            (v[k]&&typeof v[k].family==='string'&&Array.isArray(v[k].ids)&&v[k].ids.length<=32&&v[k].ids.every(id=>typeof id==='string'&&id.length<150))))throw Error('字体组合设置损坏，原记录未改写');
        return v;
    }
    function bundleFor(kind){try{const b=allBundles()[kind];return b?.family===getSelected(kind)?b.ids:[];}catch(e){console.warn('字体组合设置不可读取，保留原始数据',e);return [];}}
    // The selected family preference stays unchanged. Scoped aliases prevent
    // UI and story faces from inheriting each other's supplemental subsets.
    function scopedFamily(kind,family=getSelected(kind)){
        if(!family||!bundleFor(kind).length)return family;
        const bytes=new TextEncoder().encode(String(family));
        return 'MimaBundle_'+kind+'_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    }
    async function setBundle(kind,ids){
        kind=kind==='ui'?'ui':'story';
        const initialPreference=localStorage.getItem(BUNDLE_KEY);
        const meta=await listMetadata(),family=getSelected(kind);
        if(!family||!meta.some(m=>m.family===family))throw Error('请先选择本地字体');
        if(!Array.isArray(ids)||ids.length>32||new Set(ids).size!==ids.length)throw Error('无效的字体组合');
        const primary=newestFamilyRecord(meta,family),clean=[];
        for(const id of ids){const item=meta.find(m=>m.id===id);if(!item||item.id===primary.id)throw Error('补字文件必须是不同的现存字体');
            const report=await inspectFont(id);if(!report.supported)throw Error('该补字文件无法确认 Unicode 覆盖，不能安全合并');clean.push(id);}
        if(clean.length){const main=await inspectFont(primary.id);
            if(!main.supported||!main.ranges?.length)throw Error('主字体无法可靠读取 cmap，不能创建补字组合');}
        if(getSelected(kind)!==family||localStorage.getItem(BUNDLE_KEY)!==initialPreference)
            throw Error('字体选择或补字组合已经在另一次操作中变化，请重新执行，本次未覆盖');
        const current=allBundles(),before=JSON.stringify(current),previousRender=scopedFamily(kind,family);
        current[kind]=clean.length?{family,ids:clean}:null;
        const after=JSON.stringify(current);if(after===before)return;
        localStorage.setItem(BUNDLE_KEY,after);
        try{
            // Only retire the old scope alias; a shared unbundled family
            // might still be the other scope's active face.
            if(previousRender!==family){
                for(const entry of [...loaded.values()])
                    if(entry.face.family===previousRender)releaseFontFamily(entry.id,previousRender);
            }else if(clean.length){
                const nextRender=scopedFamily(kind,family);
                for(const entry of [...loaded.values()])if(entry.face.family===nextRender)
                    releaseFontFamily(entry.id,nextRender);
            }
            await applySelected(kind);
        }catch(error){
            // A failed update cannot claim that the new composition was saved.
            // Restore the prior setting without touching any stored font bytes.
            if(localStorage.getItem(BUNDLE_KEY)===after)localStorage.setItem(BUNDLE_KEY,before);
            void applySelected(kind).catch(e=>console.warn('补字组合回滚后重新应用失败',e));
            throw error;
        }
    }
    const usages = new Map();
    // The font picker only needs metadata. Keep the initial verified font list's
    // metadata in memory instead of cloning every multi-MB ArrayBuffer on each visit.
    let metadataCache = null;
    let metadataRead = null, registryRead = null, fontRevision = 0, initialized = false;
    let previewFamily='', previewApplied='', previewId='', previewAppliedId='', previewEpoch=0;
    const applied={ui:'',story:''}, primaryByKind={ui:'',story:''}, selectionEpoch={ui:0,story:0}, selectionWrites={ui:0,story:0}, pendingFonts=new Map();
    // A persisted preference is not proof that a font has decoded/registered.
    // This read-only status is surfaced to the user instead of silently hiding errors.
    const loadStatus={ui:{family:'',state:'idle',message:''},story:{family:'',state:'idle',message:''}};
    function reportLoad(kind,family,state,error='') {
        loadStatus[kind]={family,state,message:String(error?.message||error||'').slice(0,240)};
        try{window.dispatchEvent(new CustomEvent('mima-font-load-state',{detail:{kind,...loadStatus[kind]}}));}catch(_){ }
    }
    function getLoadStatus(kind){return {...loadStatus[kind==='ui'?'ui':'story']};}

    // Invalidate the cached picker listing when another open tab commits fonts.
    const fontChanges = typeof BroadcastChannel==='function' ? new BroadcastChannel('mima-tavern-font-metadata-v1') : null;
    if(fontChanges)fontChanges.onmessage = event => {
        if(event.data!=='changed' && event.data?.type!=='v2-changed')return;
        if(event.data==='changed') {
            // Pre-v5.25 tabs only notify with this string. Inspect the v1 keys
            // and compare existing v1 records after their committed write.
            legacySyncRequested=true;
            void migrateLegacy(true).then(()=>init(true)).catch(e=>console.warn('旧字体库同步失败，原记录保留',e));
        }else if(initialized)void init(true).catch(e=>console.warn('字体库同步失败，原字体保留',e));
    };
    const notifyFontChange = () => { metadataCache=null;fontRevision++;try{fontChanges?.postMessage({type:'v2-changed'});}catch(_){} };
    const metadataOf = ({id,name,family,format,size,createdAt,sourceUrlFontId,sourceUrl,contentVersion,fingerprint,storage,restoreReceipt,health,diagnostic}) => ({
        id,name,family,format,size,createdAt,
        ...(sourceUrlFontId?{sourceUrlFontId,sourceUrl}:{}),
        ...(contentVersion?{contentVersion}:{}),
        ...(fingerprint?{fingerprint}:{}),
        ...(storage?{storage}:{}),
        ...(restoreReceipt?{restoreReceipt}:{}),
        ...(health?{health}:{}),...(diagnostic?{diagnostic}:{})
    });
    const versionOf = meta => String(meta.contentVersion || ('legacy:'+meta.id+':'+meta.size+':'+meta.createdAt))+':'+String(meta.family||'')+':'+String(meta.format||'');
    function newMetadata(record){return {...metadataOf(record),storage:'v2',contentVersion:record.contentVersion||record.fingerprint||('commit:'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)))}}

    const rememberMetadata = records => { metadataCache = records.map(metadataOf); };
    async function listMetadata() {
        while(metadataCache===null){
            if(!metadataRead){
                const revision=fontRevision;
                metadataRead=readMetadata().then(records=>{if(revision===fontRevision)rememberMetadata(records);})
                    .finally(()=>{metadataRead=null;});
            }
            await metadataRead;
        }
        return metadataCache.map(record => ({...record}));
    }
    const URL_LIBRARY_KEY = 'mimamao_tavern_url_fonts_v1';

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    // The old v1 database remains untouched during migration. It is *not*
    // upgraded in place: old deployed versions can still open it. New imports
    // are stored in a separate database, with metadata and binary in distinct
    // stores. Legacy binaries remain at their original IDs (no disk-space
    // doubling of an existing collection).
    function openFontDb(){
        return new Promise((resolve,reject)=>{
            const request=indexedDB.open(INDEX_DB,2);
            request.onupgradeneeded=()=>{
                const db=request.result;
                if(!db.objectStoreNames.contains(META_STORE)){
                    const store=db.createObjectStore(META_STORE,{keyPath:'id'});
                    store.createIndex('fingerprint','fingerprint',{unique:false});
                }
                if(!db.objectStoreNames.contains(BINARY_STORE))db.createObjectStore(BINARY_STORE);
                if(!db.objectStoreNames.contains(STATE_STORE))db.createObjectStore(STATE_STORE);
                // Standalone unique claims permit existing duplicate records to
                // remain unchanged. A new import claims the fingerprint atomically.
                if(!db.objectStoreNames.contains(CLAIM_STORE))db.createObjectStore(CLAIM_STORE);
            };
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error);
            request.onblocked=()=>reject(new Error('字体数据库正在被其他页面占用'));
        });
    }
    // An IndexedDB request result is only provisional until transaction complete.
    async function storeRead(dbName,storeName,key){
        const db=dbName==='legacy'?await openDb():await openFontDb();
        return new Promise((resolve,reject)=>{
            let value,issue,tx;
            const end=(err)=>{db.close();err?reject(err):resolve(value)};
            try{
                tx=db.transaction(storeName,'readonly');const req=tx.objectStore(storeName).get(key);
                req.onsuccess=()=>{value=req.result};req.onerror=()=>{issue=req.error};
                tx.oncomplete=()=>end(null);
                tx.onabort=()=>end(issue||tx.error||new Error('E_FONT_READ_ABORTED'));
            }catch(error){db.close();reject(error)}
        });
    }
    async function legacyKeys(){
        const db=await openDb();return new Promise((resolve,reject)=>{
            const keys=[];let tx,issue;
            try{
                tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).openKeyCursor();
                req.onsuccess=()=>{const cur=req.result;if(cur){keys.push(cur.primaryKey);cur.continue();}};
                req.onerror=()=>{issue=req.error};
                tx.oncomplete=()=>{db.close();resolve(keys)};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_LEGACY_KEYS'))};
            }catch(e){db.close();reject(e)}
        });
    }
    // A v1 record stores binary and metadata together. IndexedDB cannot read
    // selected object fields from that schema without cloning a single record;
    // consequently migration processes one record at a time, off the boot path.
    // It never copies old binaries into v2 or erases them.
    async function migrateLegacy(forceSync=false){
        if(migrationRead){
            if(forceSync)legacySyncRequested=true;
            await migrationRead;
            if(legacySyncRequested)return migrateLegacy(true);
            return;
        }
        migrationRead=(async()=>{
            const done=await storeRead('v2',STATE_STORE,'legacyMigrationComplete');
            if(done && !forceSync && !legacySyncRequested)return;
            const scanExisting=forceSync||legacySyncRequested;
            legacySyncRequested=false;
            const ids=await legacyKeys();
            let corrupt=0;
            for(const id of ids){
                const oldMeta=await storeRead('v2',META_STORE,id);
                const tombstone=await storeRead('v2',STATE_STORE,'deleted:'+id);
                // Newer v2 records and explicit deletions always win.
                if(tombstone||oldMeta?.storage==='v2')continue;
                if(oldMeta && !scanExisting)continue;
                let legacy,diag='';
                try{legacy=await storeRead('legacy',STORE,id);}catch(e){diag='旧数据库读取失败：'+(e?.message||e);}
                const length=Number(legacy?.buffer?.byteLength??legacy?.buffer?.size??0);
                if(!diag && (!legacy?.buffer || !Number.isFinite(length)||length<=0 ||
                    (Number(legacy.size)>0&&length!==Number(legacy.size))))diag='旧字体原始数据缺失或长度不符';
                let fingerprint='';
                if(!diag){
                    try{fingerprint=await fingerprintOf(legacy.buffer instanceof Blob ? await legacy.buffer.arrayBuffer() : legacy.buffer);}
                    catch(e){diag='旧字体指纹无法验证：'+(e?.message||e);}
                }
                if(diag)corrupt++;
                const src=legacy||oldMeta||{id,name:'无法读取的旧字体',family:String(id),format:'',size:0,createdAt:''};
                const next={...metadataOf(src),storage:'legacy',
                    contentVersion:fingerprint||oldMeta?.contentVersion||('unverified:'+id),
                    ...(fingerprint?{fingerprint}:{health:'corrupt',diagnostic:diag})};
                // The tombstone and metadata check occur IN the same v2 write
                // transaction as the insert. A racing deletion cannot resurrect.
                const db=await openFontDb();
                await new Promise((resolve,reject)=>{
                    let tx,issue;
                    try{
                        tx=db.transaction([META_STORE,STATE_STORE],'readwrite');
                        const ms=tx.objectStore(META_STORE),state=tx.objectStore(STATE_STORE);
                        const removed=state.get('deleted:'+id);
                        removed.onsuccess=()=>{
                            if(removed.result)return;
                            const get=ms.get(id);
                            get.onsuccess=()=>{
                                const previous=get.result;
                                if(previous?.storage==='v2')return;
                                if(previous && !scanExisting)return;
                                if(previous && fingerprint && previous.fingerprint===fingerprint &&
                                    previous.health!=='corrupt' && previous.name===next.name && previous.family===next.family)return;
                                ms.put(next);
                            };
                        };
                        tx.oncomplete=()=>{db.close();resolve()};
                        tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_MIGRATION_WRITE'))};
                    }catch(e){try{tx?.abort()}catch(_){}db.close();reject(e)}
                });
                // Yield after each legacy binary so large libraries never build
                // an array of copies or hold up the application's input binding.
                await new Promise(resolve=>setTimeout(resolve,0));
            }
            // CRITICAL DATA-SAFETY: never infer an intentional deletion from an
            // absent key in another database. A temporarily unavailable/empty
            // legacy store (including an origin/storage recovery) must NOT
            // delete its only remaining v2 metadata. Explicit deleteFont()
            // creates a tombstone in the same transaction as deleting metadata.
            // Legacy binaries are never removed by migration.
            const existing=await readMetadata(),v1Present=new Set(ids);
            const absent=existing.filter(r=>r.storage==='legacy'&&!v1Present.has(r.id));
            if(absent.length)console.warn('旧字体库有未能定位的原件，已保留索引与选择；请使用外观页只读数据检查',absent.length);
            // Completion means the key inventory was indexed, NOT that every
            // binary is healthy. Corrupt entries are preserved with diagnosis.
            const db=await openFontDb();await new Promise((resolve,reject)=>{
                const tx=db.transaction(STATE_STORE,'readwrite');
                tx.objectStore(STATE_STORE).put({indexed:true,corrupt,checkedAt:Date.now()},'legacyMigrationComplete');
                tx.oncomplete=()=>{db.close();resolve()};
                tx.onabort=()=>{db.close();reject(tx.error||new Error('E_FONT_MIGRATION_STATE'))};
            });
            metadataCache=null;fontRevision++;
            try{window.dispatchEvent(new Event('mima-font-library-change'));}catch(_){}
            if(initialized)void init(true).catch(e=>console.warn('字体刷新失败',e));
        })().finally(()=>{migrationRead=null;});
        return migrationRead;
    }
    // The first legacy scan is deferred until after the UI has bound. On later
    // boots it only enumerates v1 KEYS; existing binaries are not read unless
    // the v1 tab actually broadcasts a change.
    function startLegacySync(){
        if(startupSyncStarted)return;
        startupSyncStarted=true;
        // First boot needs an inventory, but steady-state boots should not
        // decode/read every existing legacy file.
        setTimeout(()=>{void (async()=>{
            try{const done=await storeRead('v2',STATE_STORE,'legacyMigrationComplete');
                if(done)await migrateLegacyInventory();else await migrateLegacy(true);
            }catch(e){console.warn('旧字体索引后台检查失败',e);}
        })();},0);
    }
    async function migrateLegacyInventory(){
        // Force only the key-list reconciliation; no per-font binary read for
        // known IDs. A new legacy ID is migrated individually.
        const db=await openFontDb();db.close();
        const current=await storeRead('v2',STATE_STORE,'legacyMigrationComplete');
        if(!current)return migrateLegacy(true);
        const oldRecords=await readMetadata();
        if(oldRecords.some(r=>r.storage==='legacy'&&!r.fingerprint&&r.health!=='corrupt')){
            // Upgrade V5.25's legacy:size:timestamp versions once in background.
            return migrateLegacy(true);
        }
        const ids=await legacyKeys(),present=new Set(oldRecords.map(r=>r.id)),v1Present=new Set(ids);
        // Missing legacy bytes do not authorize removing an index.
        // Only detect NEW legacy IDs that may safely be added.
        let missing=false;
        for(const id of ids){
            if(present.has(id))continue;
            if(!await storeRead('v2',STATE_STORE,'deleted:'+id)){missing=true;break;}
        }
        if(!missing)return;
        // Force a fresh inventory while leaving existing legacy records intact.
        const stateDb=await openFontDb();await new Promise((resolve,reject)=>{
            const tx=stateDb.transaction(STATE_STORE,'readwrite');tx.objectStore(STATE_STORE).delete('legacyMigrationComplete');
            tx.oncomplete=()=>{stateDb.close();resolve()};tx.onabort=()=>{stateDb.close();reject(tx.error)};
        });
        await migrateLegacy(false);
    }
    async function readMetadata(){
        window.MimaPerfDiagnostics?.detail('font_idb_metadata');
        // Only v2 metadata participates in the critical settings read path.
        const db=await openFontDb();return new Promise((resolve,reject)=>{
            let records,issue,tx;
            try{
                tx=db.transaction(META_STORE,'readonly');const req=tx.objectStore(META_STORE).getAll();
                req.onsuccess=()=>{records=req.result};req.onerror=()=>{issue=req.error};
                tx.oncomplete=()=>{db.close();Array.isArray(records)?resolve(records):reject(new Error('E_FONT_METADATA_UNVERIFIED'))};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_METADATA_ABORTED'))};
            }catch(e){db.close();reject(e)}
        });
    }
    // Read-only forensic inventory. Never call openDb/openFontDb here: those
    // helpers can CREATE an empty database and hide the distinction between
    // an absent DB and an existing empty DB. Only metadata/keys are read;
    // no font bytes are copied and no IndexedDB or localStorage write occurs.
    async function openExistingForAudit(name){
        return new Promise((resolve,reject)=>{
            let missing=false;const request=indexedDB.open(name);
            request.onupgradeneeded=()=>{missing=true;try{request.transaction.abort();}catch(_){}};
            request.onsuccess=()=>{if(missing){request.result.close();resolve(null);}else resolve(request.result);};
            request.onerror=()=>missing?resolve(null):reject(request.error||new Error('E_FONT_AUDIT_DB'));
            request.onblocked=()=>reject(new Error('字体数据库正在被其他页面占用'));
        });
    }
    async function auditKeyStores(db,stores){
        return new Promise((resolve,reject)=>{
            let tx,issue;const values={};
            try{
                for(const store of stores)if(!db.objectStoreNames.contains(store))throw new Error('E_FONT_AUDIT_STORE:'+store);
                tx=db.transaction(stores,'readonly');
                for(const name of stores){
                    const req=name===META_STORE?tx.objectStore(name).getAll():tx.objectStore(name).getAllKeys();
                    req.onsuccess=()=>{values[name]=req.result};
                    req.onerror=()=>{issue=req.error};
                }
                tx.oncomplete=()=>resolve(values);
                tx.onabort=()=>reject(issue||tx.error||new Error('E_FONT_AUDIT_ABORT'));
            }catch(e){try{tx?.abort()}catch(_){}reject(e)}
        });
    }
    async function auditStoredFonts(){
        const result={version:1,readonly:true,selected:{ui:getSelected('ui'),story:getSelected('story')},
            legacy:{exists:false,count:0,ids:[]},modern:{exists:false,metadataCount:0,binaryCount:0,binaryIds:[],metadata:[],orphanBinaryIds:[],missingBinaryIds:[],legacyIndexesWithoutSource:[],tombstoneIds:[]},warnings:[]};
        const v1=await openExistingForAudit(DB_NAME);
        if(v1){try{const rows=await auditKeyStores(v1,[STORE]);
            result.legacy={exists:true,count:rows[STORE].length,ids:rows[STORE].map(String)};
        }finally{v1.close()}}
        const v2=await openExistingForAudit(INDEX_DB);
        if(v2){try{
            const stores=await auditKeyStores(v2,[META_STORE,BINARY_STORE,STATE_STORE]);
            const meta=stores[META_STORE],ids=stores[BINARY_STORE].map(String);
            const refs=new Set(meta.filter(m=>m.storage!=='legacy').map(m=>String(m.id))),bytes=new Set(ids),old=new Set(result.legacy.ids);
            result.modern={exists:true,metadataCount:meta.length,binaryCount:ids.length,binaryIds:ids.slice(),
                metadata:meta.map(m=>({id:String(m.id),name:String(m.name||''),storage:String(m.storage||''),size:Number(m.size||0),health:String(m.health||'')})),
                orphanBinaryIds:ids.filter(id=>!refs.has(id)),
                missingBinaryIds:[...refs].filter(id=>!bytes.has(id)),
                legacyIndexesWithoutSource:meta.filter(m=>m.storage==='legacy'&&!old.has(String(m.id))).map(m=>String(m.id)),
                tombstoneIds:stores[STATE_STORE].map(String).filter(id=>id.startsWith('deleted:')).map(id=>id.slice(8))};
        }finally{v2.close()}}
        if(result.modern.legacyIndexesWithoutSource.length)result.warnings.push('旧库原件当前不可定位；索引已保留，不代表字体已被安全删除');
        if(result.modern.orphanBinaryIds.length)result.warnings.push('找到无索引的本地字体二进制；不要清除网站数据，可单独导出原件');
        if(!result.legacy.count&&!result.modern.binaryCount)result.warnings.push('当前站点来源下两个字体库存储均未发现原件；可检查是否更换域名或从既有备份恢复');
        return result;
    }
    async function recoverLegacyIndex(){
        const before=await auditStoredFonts();
        if(!before.legacy.count)throw new Error('旧字体库没有可重建的原件，未更改数据库');
        await migrateLegacy(true);
        await init(true);
        return auditStoredFonts();
    }
    // Export a surviving binary exactly as stored. No metadata creation,
    // modification, migration or automatic import. Only explicit user click.
    async function readOrphanBinary(id){
        id=String(id||'');if(!id||id.length>256)throw new Error('无效原件 ID');
        const db=await openExistingForAudit(INDEX_DB);if(!db)throw new Error('新字体数据库不存在');
        try{
            const data=await new Promise((resolve,reject)=>{
                let value,issue;const tx=db.transaction(BINARY_STORE,'readonly');const req=tx.objectStore(BINARY_STORE).get(id);
                req.onsuccess=()=>{value=req.result};req.onerror=()=>{issue=req.error};
                tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(issue||tx.error||new Error('E_FONT_RESCUE_READ'));
            });
            if(!data)throw new Error('此原件已不存在，未修改任何数据');
            return data;
        }finally{db.close()}
    }
    // Compatibility API for callers that explicitly request all raw records.
    // The settings list never uses this API. Backup/export reads per ID.
    // V5.49: inventory never clones originals; read-only handles hold at most
    // one v1 ArrayBuffer or one v2 Blob while caller emits bounded chunks.
    async function listBackupInventory(){
        const audit=await auditStoredFonts();
        const records=await readMetadata();
        const indexed=new Set(records.map(r=>String(r.id)));
        const tombstones=new Set(audit.modern.tombstoneIds);
        const orphanV1=audit.legacy.ids.filter(id=>!indexed.has(id)&&!tombstones.has(id));
        const defects={orphanV1,orphanV2:audit.modern.orphanBinaryIds.slice(),
            missingV1:audit.modern.legacyIndexesWithoutSource.slice(),missingV2:audit.modern.missingBinaryIds.slice(),
            tombstoneConflicts:records.filter(r=>tombstones.has(String(r.id))).map(r=>r.id)};
        return {records:records.map(metadataOf),audit,defects,
            identity:JSON.stringify({records:records.map(r=>[r.id,versionOf(r),r.storage,r.size,r.fingerprint||'',r.health||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
                v1:audit.legacy.ids.slice().sort(),v2:audit.modern.binaryIds.slice().sort(),tombstones:[...tombstones].sort()})};
    }
    async function assertBackupInventory(snapshot){
        if(!snapshot?.identity)throw Error('未提供有效字体库存快照');
        const now=await listBackupInventory();
        if(now.identity!==snapshot.identity)throw Error('导出期间字体库内容或索引发生变化，请重做备份；原件未修改');
        return true;
    }
    async function openBackupSource(id,{expectedVersion}={}){
        const meta=await storeRead('v2',META_STORE,id);
        if(!meta)throw Error('字体备份源不存在：'+id);
        if(expectedVersion && versionOf(meta)!==expectedVersion)throw Error('字体备份源版本发生变化：'+id);
        let original;
        if(meta.storage==='legacy'){
            const record=await storeRead('legacy',STORE,id);
            original=record?.buffer;
            if(!original)throw Error('旧字体原件无法读取：'+id);
        }else original=await storeRead('v2',BINARY_STORE,id);
        if(!(original instanceof Blob)&&!(original instanceof ArrayBuffer)&&!ArrayBuffer.isView(original))
            throw Error('字体原始字节不可读取：'+id);
        const size=original instanceof Blob?original.size:original.byteLength;
        if(!(size>0)||Number(meta.size)>0&&size!==Number(meta.size))
            throw Error('字体备份源字节长度不符：'+id);
        const current=await storeRead('v2',META_STORE,id);
        if(!current||versionOf(current)!==versionOf(meta))throw Error('字体备份读入时版本变化：'+id);
        let closed=false;
        return {id,metadata:metadataOf(meta),version:versionOf(meta),size,
            // A snapshot must own immutable bytes, not a pointer to the live
            // font DB. The caller writes this Blob to its versioned IDB store.
            snapshotBlob(){if(closed)throw Error('字体备份句柄已关闭');return original instanceof Blob?original:new Blob([original]);},
            async readRange(start,length){
                if(closed)throw Error('字体备份读取句柄已关闭');
                if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<0||start<0||start+length>size||length>1024*1024)
                    throw Error('字体备份只允许每次读取不超过 1MiB 的有效范围');
                if(original instanceof Blob)return new Uint8Array(await original.slice(start,start+length).arrayBuffer());
                const bytes=original instanceof ArrayBuffer?new Uint8Array(original):new Uint8Array(original.buffer,original.byteOffset,original.byteLength);
                return bytes.slice(start,start+length);
            },
            async confirm(){if(closed)throw Error('字体备份句柄已关闭');
                const fresh=await storeRead('v2',META_STORE,id);
                if(!fresh||versionOf(fresh)!==versionOf(meta))throw Error('字体在备份期间被其他标签修改：'+id);
                return true;},
            close(){closed=true;original=null;}
        };
    }
    async function all({allowPartial=false}={}){
        const records=[],failed=[];
        for(const meta of await listMetadata()){
            try{const data=await readFontById(meta.id,{forBackup:true});
                if(!data?.buffer)throw new Error('原始字体数据缺失');records.push(data);
            }catch(error){failed.push({id:meta.id,name:meta.name,reason:String(error?.message||error)});}
        }
        if(failed.length&&!allowPartial){const error=new Error('字体原件无法完整备份（'+failed.map(r=>r.name+' ['+r.id+']').join('、')+'），未生成完整归档；可在外观中选择单独导出可读取字体。');error.failed=failed;throw error;}
        return allowPartial?{records,failed}:records;
    }
    async function put(record,{addOnly=false,claimHash=false}={}){
        const metadata=newMetadata(record),db=await openFontDb();
        await new Promise((resolve,reject)=>{
            let tx,issue;
            try{
                tx=db.transaction([META_STORE,BINARY_STORE,STATE_STORE,CLAIM_STORE],'readwrite');
                const m=tx.objectStore(META_STORE),b=tx.objectStore(BINARY_STORE);
                if(claimHash && metadata.fingerprint){
                    const claim=tx.objectStore(CLAIM_STORE).add(record.id,metadata.fingerprint);
                    claim.onerror=()=>{issue=new Error('E_FONT_HASH_EXISTS')};
                }
                const write=m[addOnly?'add':'put'](metadata);write.onerror=()=>{issue=write.error};
                b[addOnly?'add':'put'](record.buffer,record.id);
                tx.objectStore(STATE_STORE).delete('deleted:'+record.id);
                tx.oncomplete=()=>{db.close();resolve()};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_WRITE_ABORTED'))};
            }catch(e){try{tx?.abort()}catch(_){}db.close();reject(e)}
        });
        releaseFont(record.id);notifyFontChange();
    }
    async function remove(id,{deferFaceRelease=false}={}){
        const meta=await storeRead('v2',META_STORE,id);
        if(!meta)throw new Error('字体记录已不存在');
        // Cross-database deletion can NEVER be atomic. A v2 tombstone and the
        // visible record removal commit together. Legacy binary remains in v1
        // indefinitely for old-version compatibility and recovery. A later
        // migration cannot revive the deleted ID, even after a power loss.
        const db=await openFontDb();await new Promise((resolve,reject)=>{
            let tx,issue;
            try{
                tx=db.transaction([META_STORE,BINARY_STORE,STATE_STORE,CLAIM_STORE],'readwrite');
                const m=tx.objectStore(META_STORE),b=tx.objectStore(BINARY_STORE),state=tx.objectStore(STATE_STORE),claims=tx.objectStore(CLAIM_STORE);
                const r=m.get(id);
                r.onsuccess=()=>{
                    const found=r.result;
                    if(!found){issue=new Error('字体记录已不存在');tx.abort();return;}
                    state.put({deletedAt:Date.now(),storage:found.storage},'deleted:'+id);
                    m.delete(id);
                    // Do not erase the v1 data on any code path.
                    if(found.storage!=='legacy')b.delete(id);
                    if(found.fingerprint){const q=claims.get(found.fingerprint);q.onsuccess=()=>{if(q.result===id)claims.delete(found.fingerprint);};}
                };
                tx.oncomplete=()=>{db.close();resolve()};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_DELETE_ABORTED'))};
            }catch(e){try{tx?.abort()}catch(_){}db.close();reject(e)}
        });
        if(!deferFaceRelease)releaseFont(id);notifyFontChange();
    }
    function extension(name='') { return String(name).split('.').pop().toLowerCase(); }
    function safeFamily(name='') {
        return String(name || 'MimaFont').replace(/\.[^.]+$/, '').replace(/[^\w\u3400-\u9fff\- ]+/g, ' ').trim().slice(0,80) || 'MimaFont';
    }
    function failDecode(meta,at,error){const message=String(error?.message||error||at).slice(0,240);decodeFailures.set(decodeKey(meta),at+': '+message);stage(meta,'failed',at,message);}
    async function inspectFont(id,custom=''){
        const meta=(await listMetadata()).find(m=>m.id===id);if(!meta)throw Error('字体记录已不存在');
        const key=profileKey(meta);let profile=profiles.get(key);
        if(!profile){
            const record=await readFontById(id);if(!record?.buffer)throw Error('原始字体不可读，记录没有更改');
            profile=await window.MimaFontInspector.read(record.buffer,record.format);
            profiles.set(key,profile);
            if(profiles.size>24)profiles.delete(profiles.keys().next().value);
        }
        return {...profile,samples:profile.samples,custom:custom?window.MimaFontInspector.summary(profile,'自定义测试句',String(custom).slice(0,160)):null};
    }
    async function descriptorFor(record){
        try{const report=await window.MimaFontInspector.readWeight(record.buffer,record.format);
            return {profile:report,weight:report.axis?`${report.axis.min} ${report.axis.max}`:String(report.weight||400)};}
        catch(e){return {profile:{supported:false,warning:'无法读取真实字重：'+(e?.message||e)},weight:'400'};}
    }
    function disposeFont(entry) {
        if(!entry)return;
        // WebKit cannot cancel a FontFace.load() already handed to its decoder.
        // Retire its ownership now but keep its Blob URL and registration alive
        // until the native promise settles; otherwise a new picker generation
        // can revoke the backing bytes under the previous generation.
        if(entry.loadPending){entry.retired=true;return;}
        if(entry.disposed)return;
        entry.disposed=true;
        try{document.fonts.delete(entry.face);}catch(_){}
        if(entry.url){URL.revokeObjectURL(entry.url);entry.url='';}
    }
    function entryKey(id,family){return String(id)+'@'+String(family);}
    function findLoaded(id,family){return family?loaded.get(entryKey(id,family)):Array.from(loaded.values()).find(e=>e.id===id);}
    function releaseFontFamily(id,family){const key=entryKey(id,family),entry=loaded.get(key);if(entry){loaded.delete(key);disposeFont(entry);}}
    function releaseFont(id){for(const [key,entry] of loaded)if(entry.id===id){loaded.delete(key);disposeFont(entry);}}
    function previewAlias(id){
        return 'MimaPreview_'+Array.from(new TextEncoder().encode(String(id)),b=>b.toString(16).padStart(2,'0')).join('');
    }
    function makeFont(record,renderFamily=record.family,descriptors={}) {
        if (!record?.buffer || !window.FontFace) return false;
        // The pre-CSS-optimization iOS path: register a CSS URL-backed face and
        // let the browser start loading when the selected family is rendered.
        // Creating a native ArrayBuffer face and awaiting load() before keeping
        // it registered was introduced with the crash optimization and breaks
        // the previous registration guarantee when decoding rejects or stalls.
        let url='';
        try {
            const blob=record.buffer instanceof Blob?record.buffer:new Blob([record.buffer]);
            url=URL.createObjectURL(blob);
            const face=new FontFace(renderFamily,`url("${url}")`,{display:'swap',...descriptors});
            return {face,url,contentVersion:versionOf(record),renderSignature:JSON.stringify(descriptors),state:'registered'};
        }catch(error){if(url)URL.revokeObjectURL(url);throw error;}
    }
    // One authoritative scope-specific list: redundant supplements never become
    // fake missing faces, and the other scope cannot settle this one's status.
    const effectiveParts={ui:null,story:null};
    function activeParts(kind,family=getSelected(kind)){
        const plan=effectiveParts[kind];
        if(!plan||plan.family!==family||plan.render!==scopedFamily(kind,family))return null;
        return plan;
    }
    function settleLocalScope(kind,family=getSelected(kind),detail=''){
        const plan=activeParts(kind,family);
        if(!plan)return null;
        const refs=[plan.primaryId,...plan.supplementIds];
        const faces=refs.map(id=>findLoaded(id,plan.render));
        const failures=refs.filter((id,i)=>faces[i]?.state==='error'||getDecodeFailure(plan.metadata[i]));
        if(failures.length){
            const message='字体原生解码失败：'+failures.join('、')+'；原件已保留';
            reportLoad(kind,family,'error',message);return {state:'error',message,faces,refs};
        }
        if(faces.every(e=>e?.face.status==='loaded')){
            applied[kind]=plan.render;
            reportLoad(kind,family,'loaded');return {state:'loaded',faces,refs};
        }
        const state=faces.some(e=>!e)?'partial':'registered';
        reportLoad(kind,family,state,detail);
        return {state,faces,refs};
    }
    async function waitScopeLoaded(kind,family){
        const plan=activeParts(kind,family);
        if(!plan)throw new Error('字体组合在加载期间发生变化，请重新验证');
        const status=settleLocalScope(kind,family);
        if(status.state==='error')throw new Error(status.message);
        if(status.faces.some(e=>!e))throw new Error('当前组合仍有未注册的字体原件');
        const tasks=status.faces.map(e=>e.loadTask||e.face.load());
        const results=await Promise.allSettled(tasks);
        if(family!==getSelected(kind)||activeParts(kind,family)!==plan)throw new Error('字体选择已改变，请确认新的选择');
        const failed=results.findIndex((r,i)=>r.status==='rejected'||status.faces[i].face.status!=='loaded');
        if(failed>=0){
            const id=status.refs[failed];
            const cause=results[failed].status==='rejected'?results[failed].reason?.message||results[failed].reason:'原生字体未就绪';
            const msg='字体或补字 '+id+' 未能加载：'+String(cause);
            reportLoad(kind,family,'error',msg);throw new Error(msg);
        }
        settleLocalScope(kind,family);
    }
    function reportRegisteredFace(entry,state,error=''){
        if(loaded.get(entry.registryKey)!==entry)return;
        for(const kind of ['ui','story']){
            const plan=activeParts(kind);
            if(plan?.render===entry.face.family&&[plan.primaryId,...plan.supplementIds].includes(entry.id))
                settleLocalScope(kind,plan.family,error);
        }
    }
    function attachFont(id,entry) {
        // Commit the new registered face before retiring a previous copy.
        // Keep the Blob URL alive while WebKit may still need to fetch it.
        document.fonts.add(entry.face);
        releaseFontFamily(id,entry.face.family);
        entry.id=id;
        entry.registryKey=entryKey(id,entry.face.family);
        loaded.set(entry.registryKey,entry);
        // Merely adding a FontFace does not guarantee WebKit starts a font
        // request: the CSS may have been laid out using fallback *before* this
        // late IndexedDB registration. Begin loading explicitly after adding,
        // but do not await it on the tavern startup / settings path.
        // Keep the Blob URL until this entry is actually released; a pending
        // WebKit font request must never see its source revoked underneath it.
        entry.loadPending=true;
        const mark=window.MimaPerfDiagnostics;
        mark?.detail('font_face_register');mark?.detail('font_face_load_start');
        const task=Promise.resolve().then(()=>entry.face.load());
        entry.loadTask=task;
        task.then(()=>{
            entry.state='loaded';stage(entry.metadata,'loaded','FontFace.load');mark?.detail('font_face_load_success');
            reportRegisteredFace(entry,'loaded');
        },error=>{
            entry.state='error';mark?.detail('font_face_load_error');
            // A decode error never warrants deleting the underlying IDB data.
            // Cache the failed *byte version* so virtualized preview rows cannot
            // launch the same native decoder repeatedly on every scroll/open.
            failDecode(entry.metadata||{id,contentVersion:entry.contentVersion},'FontFace.load',error);
            reportRegisteredFace(entry,'error',error);
        }).finally(()=>{
            entry.loadPending=false;
            if(entry.state==='error'){
                // Even selected fonts should not pin a rejected 15-MB Blob.
                if(loaded.get(entry.registryKey)===entry)loaded.delete(entry.registryKey);
                disposeFont(entry);
            }else if(entry.retired)disposeFont(entry);
            else trimFonts();
        });
    }
    async function fingerprintOf(buffer){
        if(!globalThis.crypto?.subtle?.digest)throw new Error('当前浏览器不支持安全内容指纹，未导入字体');
        const digest=await crypto.subtle.digest('SHA-256',buffer);
        return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    }
    async function identicalFile(fingerprint,buffer){
        // A cryptographic hash is an index, not a substitute for verifying the
        // bytes. Confirm matches without accumulating duplicate ArrayBuffers.
        const metas=await listMetadata();
        for(const item of metas){
            if(item.fingerprint!==fingerprint && (item.fingerprint || Number(item.size)!==buffer.byteLength))continue;
            let existing;
            try{existing=await readFontById(item.id);}catch(error){
                // A damaged sibling must not prevent importing another font.
                console.warn('跳过无法比较的旧字体记录，原字节保留',item.id,error);continue;
            }
            const oldBytes=existing?.buffer instanceof Blob ? await existing.buffer.arrayBuffer() : existing?.buffer;
            const a=new Uint8Array(oldBytes||new ArrayBuffer(0)),b=new Uint8Array(buffer);
            if(a.length===b.length && a.every((byte,i)=>byte===b[i]))return item;
        }
        return null;
    }
    async function importFile(file) {
        if (!file) throw new Error('没有选择字体文件');
        const ext = extension(file.name);
        if (!['ttf','otf','woff','woff2'].includes(ext)) throw new Error('只支持 TTF / OTF / WOFF / WOFF2');
        const buffer = await file.arrayBuffer();
        const fingerprint=await fingerprintOf(buffer);
        const duplicate=await identicalFile(fingerprint,buffer);
        if(duplicate)return {...duplicate,duplicate:true};
        const id = `font_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const record = { id, name:file.name, family:safeFamily(file.name), format:ext, size:buffer.byteLength, buffer, fingerprint,contentVersion:fingerprint,createdAt:new Date().toISOString() };
        // An explicit single-file import must prove it is a decodable font
        // before saving or reporting success. Reuse that verified face; only
        // the library's startup registration remains lazy.
        const descriptors=await descriptorFor(record);
        const entry=makeFont(record,record.family,{weight:descriptors.weight});
        if(!entry)throw new Error('当前浏览器无法校验本地字体，请使用支持 FontFace 的浏览器');
        try{
            await entry.face.load();
            await put(record,{addOnly:true,claimHash:true});
        }catch(e){
            if(e?.message==='E_FONT_HASH_EXISTS'){
                disposeFont(entry);
                metadataCache=null; // Other tab committed the claim before its notification arrived.
                const existing=await identicalFile(fingerprint,buffer);
                if(existing)return {...existing,duplicate:true};
                throw new Error('已存在相同指纹的字体，未写入新文件，请检查原字体');
            }
            disposeFont(entry);
            if(entry?.face.status==='error')throw new Error('字体文件无法解析，请选择有效的 TTF / OTF / WOFF / WOFF2 文件');
            throw e;
        }
        // If a user re-imports the currently selected family, reuse the face
        // that *actually passed decoding*.  Creating a new Blob/FontFace after
        // validation was an unnecessary second WebKit decode and could fail
        // despite import being reported as successful.
        const selected=getSelected('ui')===record.family||getSelected('story')===record.family;
        if(selected){
            entry.contentVersion=versionOf(record);
            attachFont(record.id,entry);
            await applySelected().catch(error=>console.warn('字体已保存，但重挂显示失败',error));
            if(entry.face.status!=='loaded')throw new Error('字体已保存但尚未通过应用验证，请点击「重新加载」检查');
        }else disposeFont(entry);
        return metadataOf(record);
    }
    // Different imports may have the same filename/family. The newest committed
    // record is the one the user most recently picked/imported; never silently
    // reload a stale same-family binary from an older IDB cursor entry.
    function newestFamilyRecord(records,family) {
        const matches=records.filter(record=>record.family===family);
        matches.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id)));
        return matches.at(-1)||null;
    }
    async function getByFamily(family) {
        const record=newestFamilyRecord(await listMetadata(),family);
        return record ? readFontById(record.id) : null;
    }
    function trimFonts(extra='') {
        // A requested font also owns its entry while the IDB read / decode is
        // in progress. Releasing a different preview must not evict it before
        // the selection or reader can mark it as applied.
        const keep=new Set([scopedFamily('ui'),scopedFamily('story'),applied.ui,applied.story,
            previewFamily,previewApplied,extra,
            ...Array.from(usages.values(),x=>x.requested),
            ...Array.from(usages.values(),x=>x.applied)].filter(Boolean));
        const keepIds=new Set([previewId,previewAppliedId,...bundleFor('ui'),...bundleFor('story'),...Array.from(usages.values(),x=>x.requestedId),
            ...Array.from(usages.values(),x=>x.appliedId)].filter(Boolean));
        for(const [id,entry] of loaded)if(!keep.has(entry.face.family)&&!keepIds.has(entry.id)) {
            // A detached visible preview still has an in-flight native load.
            // Keep it reusable so reopening settings cannot decode that same
            // large file again while the first decoder is still running.
            if(entry.loadPending)entry.retireWhenIdle=true;
            else {loaded.delete(id);disposeFont(entry);}
        }
    }
    function wantedFamily(family) {
        return [previewFamily,previewApplied,getSelected('ui'),getSelected('story'),applied.ui,applied.story,
            ...Array.from(usages.values(),x=>x.requested),...Array.from(usages.values(),x=>x.applied)].includes(family);
    }
    async function acquireRecord(metadata,renderFamily=metadata?.family,customRange='') {
        if(!metadata)return null;
        const failed=getDecodeFailure(metadata);
        if(failed)throw new Error('该版本字体解码失败，已暂停自动重试（原文件保留）。点击「重新验证」重试：'+failed);
        const current=findLoaded(metadata.id,renderFamily);
        const desiredSignature=customRange||'';
        if(current?.contentVersion===versionOf(metadata) && current.face.family===renderFamily && current.state!=='error' && (current.customRange||'')===desiredSignature){
            current.retireWhenIdle=false;return current.face;
        }
        if(metadata.health==='corrupt')throw new Error('该字体原始文件存在问题：'+(metadata.diagnostic||'无法读取'));
        // Deduplicate by the exact byte identity, not by the global library
        // revision. Unrelated imports cannot launch a second decoder.
        const key=metadata.id+'@'+versionOf(metadata)+'@'+renderFamily+'@'+customRange;
        if(pendingFonts.has(key))return pendingFonts.get(key);
        const task=(async()=>{
            stage(metadata,'reading','indexedDB');
            let record;
            try{record=await readFontById(metadata.id);}catch(e){stage(metadata,'read-error','indexedDB',e);throw e;}
            if(!record?.buffer)throw new Error('所选字体的本地文件不存在');
            const storedSize=Number(record.buffer.byteLength??record.buffer.size);
            if(storedSize===0||(Number(metadata.size)>0&&Number.isFinite(storedSize)&&storedSize!==Number(metadata.size)))
                throw new Error('本地保存的字体数据不完整，请保留原记录并从原文件重新导入');
            // A replaced backup can change after metadata was fetched. Never
            // register a face whose exact content version does not match.
            if(versionOf(record)!==versionOf(metadata))return null;
            stage(metadata,'constructing','Blob/FontFace');
            const descriptor=await descriptorFor(record);
            // cmap is inspected only for an explicitly requested composition.
            const attrs={weight:descriptor.weight,...(customRange?{unicodeRange:customRange}:{})};
            let entry;
            try{entry=makeFont(record,renderFamily,attrs);if(!entry)throw Error('FontFace 不可用');}
            catch(e){failDecode(metadata,'FontFace.constructor',e);throw e;}
            entry.metadata=metadata;entry.customRange=customRange;
            stage(metadata,'constructed','FontFace.constructor');
            try {
                const latest=(await listMetadata()).find(r=>r.id===metadata.id);
                const stillWanted=wantedFamily(metadata.family)||['ui','story'].some(k=>bundleFor(k).includes(metadata.id))||previewId===metadata.id||
                    Array.from(usages.values()).some(u=>u.requestedId===metadata.id);
                if(!latest || versionOf(latest)!==versionOf(metadata) || !stillWanted){
                    disposeFont(entry);return null;
                }
                try{attachFont(record.id,entry);}catch(e){failDecode(metadata,'FontFaceSet.add',e);throw e;}
                stage(metadata,'decoding','FontFace.load');
                trimFonts(renderFamily);
                return entry.face;
            }catch(error){disposeFont(entry);throw error;}
        })();
        pendingFonts.set(key,task);
        task.finally(()=>{if(pendingFonts.get(key)===task)pendingFonts.delete(key);}).catch(()=>{});
        return task;
    }
    async function acquireFamily(family,kind=null){
        if(!family||!wantedFamily(family))return null;
        const records=await listMetadata(),primary=newestFamilyRecord(records,family);
        if(!primary)return null;
        if(kind)primaryByKind[kind]=primary.id;
        const members=kind?bundleFor(kind):[];
        if(members.length){
            const render=scopedFamily(kind,family);
            // Build the exact scope-specific mapping. The default/other scope
            // is never given faces from this scope's supplements.
            const primaryProfile=await inspectFont(primary.id);
            if(!primaryProfile.supported)throw Error('主字体无法检查 cmap，组合未生效；原配置仍保留');
            let used=primaryProfile.ranges;
            const ready=[];
            for(const id of members){
                const sub=records.find(m=>m.id===id);
                if(!sub)throw Error('补字文件 '+id+' 已不可见；组合设置与原件保持不变');
                const report=await inspectFont(id);if(!report.supported)throw Error('补字文件无法检查 cmap');
                const exclusive=window.MimaFontInspector.minus(report.ranges,used);
                used=window.MimaFontInspector.normalize([...used,...exclusive]);
                if(exclusive.length)ready.push({sub,exclusive});
            }
            // Another tab may have changed the saved composition while the
            // alias name stayed the same: retire obsolete supplemental faces.
            const desiredIds=new Set([primary.id,...ready.map(item=>item.sub.id)]);
            for(const entry of [...loaded.values()])if(entry.face.family===render&&!desiredIds.has(entry.id))
                releaseFontFamily(entry.id,render);
            effectiveParts[kind]={family,render,primaryId:primary.id,
                supplementIds:ready.map(item=>item.sub.id),metadata:[primary,...ready.map(item=>item.sub)]};
            const face=await acquireRecord(primary,render,window.MimaFontInspector.cssRange(primaryProfile.ranges));
            await Promise.all(ready.map(({sub,exclusive})=>
                acquireRecord(sub,render,window.MimaFontInspector.cssRange(exclusive))));
            return face;
        }
        if(kind)effectiveParts[kind]={family,render:family,primaryId:primary.id,supplementIds:[],metadata:[primary]};
        return acquireRecord(primary,family);
    }
    async function acquireById(id){
        const records=await listMetadata(),metadata=records.find(r=>r.id===id);
        if(!metadata)return null;
        // The selected/newest family uses its original name, retaining old CSS
        // references. Older same-name imports get a unique preview-only face.
        const winner=newestFamilyRecord(records,metadata.family);
        return acquireRecord(metadata,winner?.id===metadata.id?metadata.family:previewAlias(metadata.id));
    }
    function cancelPreview(){
        // A preview is not a persisted selection or a visible reader. Retire
        // ONLY the explicit picker owner; native loads settle before disposal.
        ++previewEpoch;
        previewId=previewAppliedId=previewFamily=previewApplied='';
        trimFonts();
    }
    async function ensureFont(id){
        const requested=String(id||'');
        if(!requested){cancelPreview();return null;}
        previewFamily=previewApplied='';
        const epoch=++previewEpoch;
        previewId=requested;previewAppliedId='';
        try{
            // This entry is reached only from the explicit row preview button.
            const candidate=(await listMetadata()).find(record=>record.id===requested);
            if(candidate){decodeFailures.delete(decodeKey(candidate));stage(candidate,'stored','manual retry');}
            const face=await acquireById(requested);
            if(face)await face.load();
            if(epoch===previewEpoch)previewAppliedId=requested;
            return face;
        }finally{trimFonts();}
    }
    function useFont(owner,id){
        const previous=usages.get(owner);
        if(previous?.requestedId===id)return previous.task;
        const usage={requestedId:String(id),appliedId:previous?.appliedId||'',task:null};
        usages.set(owner,usage);
        const task=acquireById(id).then(async face=>{
            if(face){const registered=Array.from(loaded.values()).find(e=>e.face===face);
                if(registered?.loadTask)await registered.loadTask;else await face.load();}
            if(usages.get(owner)===usage&&face?.status==='loaded')usage.appliedId=id;
            return face;
        }).finally(()=>trimFonts());
        usage.task=task;task.catch(()=>{});return task;
    }
    // One explicit picker preview, plus the two currently applied choices.
    async function ensureFamily(family) {
        const requested=String(family||'');
        if(!requested){cancelPreview();return null;}
        previewId=previewAppliedId='';
        const epoch=++previewEpoch;
        previewFamily=requested;previewApplied='';
        try{
            const face=await acquireFamily(requested);
            if(face)await face.load();
            if(epoch===previewEpoch)previewApplied=requested;
            return face;
        }finally{trimFonts();}
    }
    // A visible reader owns its font independently of the picker preview and
    // the global preferences. Replacing/closing the reader retires that owner.
    function useFamily(owner,family) {
        family=String(family||'');
        const previous=usages.get(owner);
        if(previous?.requested===family&&previous.revision===fontRevision)return previous.task;
        const usage={requested:family,applied:previous?.applied||'',revision:fontRevision,task:null};
        usages.set(owner,usage);
        const task=acquireFamily(family).then(async face=>{
            if(face){
                const registered=Array.from(loaded.values()).find(entry=>entry.face===face);
                if(registered?.loadTask)await registered.loadTask;
                else await face.load();
            }
            if(usages.get(owner)===usage && face?.status==='loaded')usage.applied=family;
            return face;
        })
            .finally(()=>trimFonts());
        usage.task=task;task.catch(()=>{});return task;
    }
    function releaseUsage(owner) { usages.delete(owner);trimFonts(); }
    async function init(refresh=false) {
        startLegacySync();
        if(refresh){metadataCache=null;fontRevision++;}
        if(!registryRead)registryRead=(async()=>{
            let records,revision;
            do{
                revision=fontRevision;records=await listMetadata();initialized=true;
                // Do not gate the whole tavern startup on decoding a large font.
                // applySelected writes CSS synchronously, while decoded faces
                // are registered as their per-family reads complete.
                void applySelected().catch(error=>console.warn('字体库可用，但所选字体加载失败',error));
            }while(revision!==fontRevision);
            return records;
        })().finally(()=>{registryRead=null;});
        return registryRead;
    }
    function getSelected(kind) { return localStorage.getItem(kind === 'ui' ? UI_KEY : STORY_KEY) || ''; }
    // A click on a font selector is a confirmed application request, not just
    // an IndexedDB/FontFace registration request. Startup stays non-blocking.
    async function verifyAppliedLocalFamily(kind,family){
        const metadata=newestFamilyRecord(await listMetadata(),family);
        if(!metadata)return; // CSS URL and system fonts use their own path.
        await waitScopeLoaded(kind,family);
    }
    function setSelected(kind, family) {
        kind=kind==='ui'?'ui':'story';const key=kind==='ui'?UI_KEY:STORY_KEY;
        const requested=String(family||''),write=++selectionWrites[kind];
        // Only an explicit user selection changes this preference. A temporary
        // native font/IDB error must not erase it (especially on a cold start).
        localStorage.setItem(key,requested);
        const task=(async()=>{
            await applySelected(kind);
            if(requested)await verifyAppliedLocalFamily(kind,requested);
        })().catch(error=>{
            if(selectionWrites[kind]===write&&getSelected(kind)===requested){
                // Verification errors must remain visible; do not report the
                // previously applied face as a successful new selection.
                setFontCss(kind,requested);
                reportLoad(kind,requested,'error',error);
            }
            throw error;
        });
        task.finally(()=>{try{window.dispatchEvent(new Event('mima-font-selection-change'));}catch(_){}}).catch(()=>{});
        task.catch(error=>console.warn('字体切换失败，保留上次有效字体',error));return task;
    }
    // Explicit recovery for existing selections. Does not re-import, delete,
    // overwrite IndexedDB, or loop forever. The original binary stays intact.
    async function reloadSelected(kind){
        kind=kind==='ui'?'ui':'story';
        const family=getSelected(kind);
        let metadata=family?newestFamilyRecord(await listMetadata(),family):null;
        if(!metadata){
            const remote=urlFonts().find(item=>item.family===family);
            if(!remote)throw new Error('当前选择未在字体库中找到');
            // Explicit user retry: a failed CSS <link> retains a rejected
            // promise in activeCssLinks. Reusing that promise makes recovery
            // impossible even after the network becomes available again.
            // Do not restart every idle/failed link automatically on render.
            const old=activeCssLinks.get(remote.id);
            if(old){old.link.remove();activeCssLinks.delete(remote.id);}
            externalFontLoads.delete(remote.id+':'+remote.url);
            if(!remote.css){
                // Recreate the file-font @font-face only on this explicit
                // request, so a failed native CSS font load may retry.
                const rules=document.getElementById('mima-url-font-library-style');
                if(rules)rules.textContent='';
            }
            await applySelected(kind);
            if(getLoadStatus(kind).state!=='loaded')throw new Error('浏览器尚未确认网络字体加载完成');
            return true;
        }
        if(metadata.storage==='legacy' && metadata.health==='corrupt'){
            // The user may have repaired this file from an old-version tab.
            // Explicit retry is the only path that rechecks an isolated record.
            await migrateLegacy(true);
            metadata=newestFamilyRecord(await listMetadata(),family);
            if(!metadata || metadata.health==='corrupt')
                throw new Error('原文件仍无法读取：'+(metadata?.diagnostic||'原始记录不存在'));
        }
        reportLoad(kind,family,'loading');
        try{
            // User-initiated reload, unlike automatic row previews, is allowed
            // to retry an unchanged byte version without rewriting the library.
            for(const part of [metadata,...(await listMetadata()).filter(m=>bundleFor(kind).includes(m.id))]){
                decodeFailures.delete(decodeKey(part));stage(part,'stored','manual retry');
            }
            // Explicit retry must not reuse the previous rejected FontFace.
            const previous=findLoaded(metadata.id,scopedFamily(kind,family));
            if(previous?.state==='error')releaseFont(metadata.id);
            const face=await acquireFamily(family,kind);
            if(!face)throw new Error('未能注册本地字体');
            await waitScopeLoaded(kind,family);
            if(getSelected(kind)===family)setFontCss(kind,family);
            return true;
        }catch(error){if(getSelected(kind)===family)reportLoad(kind,family,'error',error);throw error;}
    }
    // URL fonts share the same UI/story selectors as local fonts, but keep an
    // independent small metadata library. Never upload, fetch or overwrite local binaries.
    function urlFonts() {
        let value;
        try { value=JSON.parse(localStorage.getItem(URL_LIBRARY_KEY)||'[]'); } catch(_) { return []; }
        return Array.isArray(value)?value.filter(x=>x && /^[a-zA-Z0-9_-]{1,90}$/.test(x.id) && /^https:\/\//i.test(x.url) && typeof x.family==='string').slice(0,100):[];
    }
    // Old CSS links remain available, but idle third-party stylesheets should
    // not be fetched solely because they were imported years ago. Referenced
    // families and explicit compatibility loading retain their prior behavior.
    const activeCssLinks = new Map();
    function activeFontDeclarations(style) {
        // Read the browser's *effective* rule tree rather than scanning raw
        // CSS text. Inner @media/@supports conditions can be false even when
        // the outer <style> itself is enabled. Merely finding a family name in
        // such an inactive branch must not start a third-party font download.
        const collected=[];
        const matchesMedia = query => {
            if(!query)return true;
            if(typeof matchMedia!=='function')return !/^(?:not\s+all|none)$/i.test(String(query).trim());
            try{return matchMedia(query).matches;}catch(_){return false;}
        };
        const matchesSupports = condition => {
            if(!condition)return true;
            // Old browsers lacking CSS.supports retain the previous
            // conservative inclusion rather than silently losing fonts.
            if(typeof CSS==='undefined'||typeof CSS.supports!=='function')return true;
            try{return CSS.supports(condition);}catch(_){return false;}
        };
        function walk(rules) {
            for(const rule of rules) {
                if(rule.type===1){ // CSSStyleRule, including nested selectors
                    if(rule.style?.cssText)collected.push(rule.style.cssText);
                    if(rule.cssRules)walk(rule.cssRules);
                } else if(rule.type===4){ // CSSMediaRule
                    if(matchesMedia(rule.conditionText||rule.media?.mediaText))walk(rule.cssRules||[]);
                } else if(rule.type===12){ // CSSSupportsRule
                    if(matchesSupports(rule.conditionText))walk(rule.cssRules||[]);
                } else if(rule.type===5||rule.type===7){
                    // @font-face declares a font; @keyframes describes an
                    // animation. Neither proves the page is using a family.
                    continue;
                } else if(rule.cssRules){
                    // @layer/@scope and future grouping rules: keep their
                    // nested declarations without fetching external sheets.
                    walk(rule.cssRules);
                }
            }
        }
        try {
            if(!style.sheet)return '';
            walk(style.sheet.cssRules);
            return collected.join(';');
        } catch(error) {
            // For inaccessible CSSOM (e.g. old @import behavior), preserve
            // the legacy compatibility scan instead of breaking old records.
            // The normal same-origin inline CSS path always uses rule guards.
            return style.textContent||'';
        }
    }
    function enabledFontStyles() {
        const sources=[];
        for(const style of document.querySelectorAll('style')) {
            if(style.id==='mima-url-font-library-style'||style.id==='legacy-url-font-style')continue;
            if(style.disabled || style.sheet?.disabled)continue;
            if(style.media && typeof matchMedia==='function') {
                try{if(!matchMedia(style.media).matches)continue;}catch(_){continue;}
            }else if(/^(?:not\s+all|none)$/i.test(String(style.media||'').trim()))continue;
            const declarations=activeFontDeclarations(style);
            if(declarations)sources.push(declarations);
        }
        return sources;
    }
    function fontReferenceContext() {
        // Inspect only mounted, active CSS, plus computed font families of
        // visible app surfaces. Do not match arbitrary comments or other font
        // names that happen to contain the requested name as a substring.
        const sources=enabledFontStyles().map(css=>({type:'css',value:css}));
        for(const selector of ['body','#story-chat-box','.msg-content','.c-status-panel','.app-shell']) {
            const element=document.querySelector(selector);if(!element)continue;
            try{sources.push({type:'family',value:getComputedStyle(element).fontFamily});}catch(_){}
        }
        return sources;
    }
    function unquoteFamily(text){return String(text||'').trim().replace(/^(['"])([\s\S]*)\1$/,'$2').trim().toLocaleLowerCase();}
    function fontListUses(value,family){
        return String(value||'').split(',').some(item=>unquoteFamily(item)===family);
    }
    function authoredFontUses(css,family){
        // A declaration in @font-face registers a font; it does not mean that
        // the page uses that font. Ignore it and CSS comments before matching.
        const source=String(css||'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@font-face\s*\{[^}]*\}/gi,'');
        const declarations=/(?:^|[;{])\s*(font-family|font|--[\w-]+)\s*:\s*([^;{}]+)/gi;
        let match;
        while((match=declarations.exec(source))){
            const prop=match[1].toLowerCase(),value=match[2].replace(/!important\s*$/i,'').trim();
            if(prop==='font-family'&&fontListUses(value,family))return true;
            if(prop==='font'||prop.startsWith('--')){
                // A font shorthand has a size/weight prefix; the family is
                // the trailing token, or a quoted member of a comma list.
                if(value.split(',').some(item=>{
                    const segment=unquoteFamily(item),quoted=segment.match(/["']([^"']+)["']/g)||[];
                    return segment===family || segment.endsWith(' '+family) ||
                        quoted.some(part=>unquoteFamily(part)===family);
                }))return true;
            }
        }
        return false;
    }
    function fontReferencedByAppearance(family,context) {
        const name=unquoteFamily(family);if(!name)return false;
        const sources=context===undefined?fontReferenceContext():context;
        if(typeof sources==='string')return authoredFontUses(sources,name)||fontListUses(sources,name);
        return Array.isArray(sources)&&sources.some(item=>item.type==='family'?
            fontListUses(item.value,name):authoredFontUses(item.value,name));
    }
    function urlFontStyle() {
        let tag=document.getElementById('mima-url-font-library-style');
        const active=new Set([getSelected('ui'),getSelected('story')].filter(Boolean));
        const selectedCss=new Map(),imports=[],faces=[];
        let referenceContext;
        for(const f of urlFonts()) {
            const fam=f.family.replace(/["'\\;{}\n\r]/g,'');
            if(!fam)continue;
            if(f.css===true){
                if(active.has(f.family))selectedCss.set(f.id,f);
                else if(f.compatAlwaysLoad===true||
                    (f.lazy===false&&f.compatAlwaysLoad!==false)||
                    fontReferencedByAppearance(f.family,referenceContext??(referenceContext=fontReferenceContext())))
                    imports.push(`@import url(${JSON.stringify(f.url)});`);
            }else if(active.has(f.family)) {
                faces.push(`@font-face{font-family:${JSON.stringify(fam)};src:url(${JSON.stringify(f.url)});font-display:swap;}`);
            }
        }
        const css=imports.join('\n')+faces.join('\n');
        if(!tag && css){tag=document.createElement('style');tag.id='mima-url-font-library-style';document.head.appendChild(tag);}
        if(tag && tag.textContent!==css)tag.textContent=css;
        // CSS URL sources are stylesheets, not font files. Wait for the actual
        // stylesheet load event before asking the FontFaceSet to resolve its
        // declared family. It also avoids guessing when @import has completed.
        for(const [id,entry] of activeCssLinks){
            if(selectedCss.get(id)?.url===entry.url)continue;
            entry.link.remove();activeCssLinks.delete(id);
        }
        for(const [id,f] of selectedCss){
            if(activeCssLinks.has(id))continue;
            const link=document.createElement('link');link.rel='stylesheet';link.href=f.url;
            const state={link,url:f.url,promise:null};
            state.promise=new Promise((resolve,reject)=>{
                link.onload=()=>resolve();
                link.onerror=()=>reject(new Error('网络字体 CSS 无法加载，请检查链接及网络权限'));
            });
            // If the user switches away while the stylesheet is loading, the
            // rejected promise still needs an observer to avoid console noise.
            state.promise.catch(()=>{});
            activeCssLinks.set(id,state);document.head.appendChild(link);
        }
    }
    const externalFontLoads=new Map();
    function loadExternalFamily(family) {
        const record=urlFonts().find(f=>f.family===family);
        if(!record)return Promise.resolve(null);
        const key=record.id+':'+record.url;
        if(externalFontLoads.has(key))return externalFontLoads.get(key);
        const task=(async()=>{
            if(!document.fonts?.load)throw new Error('当前浏览器不支持网络字体状态检查');
            if(record.css){
                const entry=activeCssLinks.get(record.id);
                if(!entry)throw new Error('网络字体 CSS 未激活');
                await entry.promise;
            }
            const declaration='normal 16px '+JSON.stringify(family);
            // Test both Latin and CJK coverage; a CSS font may use unicode-range.
            const faces=await document.fonts.load(declaration,'Aa咪嘛日本語');
            if(!faces?.length||!faces.some(face=>face.status==='loaded'))
                throw new Error('浏览器未加载到此字体：请检查链接是否为真实字体文件、HTTPS 跨域许可及 CSS 字体族名');
            return faces;
        })();
        externalFontLoads.set(key,task);
        task.finally(()=>{if(externalFontLoads.get(key)===task)externalFontLoads.delete(key);}).catch(()=>{});
        return task;
    }
    function addUrlFont(name,url,family){
        name=String(name||family||'链接字体').trim().slice(0,75);
        url=String(url||'').trim();family=String(family||name).trim().slice(0,75);
        let parsed;try{parsed=new URL(url)}catch(_){throw Error('请输入有效的 HTTPS 字体地址')}
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||/[\s"'()\\]/.test(url)||url.length>2048)throw Error('请使用不含账号密码的 HTTPS 字体文件或 CSS 链接');
        if(!family||/["'\\;{}\n\r]/.test(family))throw Error('字体名称不能包含特殊 CSS 符号');
        const css=/fonts\.googleapis\.com$/i.test(parsed.hostname)||/\.css(?:$|[?#])/i.test(parsed.pathname);
        const fonts=urlFontsForBatchWrite();if(fonts.length>=100)throw Error('链接字体库最多保存 100 个');
        const id='urlfont_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);
        // File links use a unique internal family; imported CSS must retain
        // the author-defined family name declared inside its stylesheet.
        const record={id,name,url,css,family:css?family:'MimaUrl_'+id};
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify([...fonts,record]));
        urlFontStyle();return record;
    }
    // Offline copies use the EXISTING local font database and backup format.
    // An explicit user click is the only trigger: no network downloads during
    // startup/settings render, and no HTTP Cache/Service Worker dependency.
    // The source URL remains available, but offline faces have a distinct family
    // so URL @font-face styles can never fight the selected offline copy.
    async function cacheUrlFont(id) {
        const source=urlFonts().find(item=>item.id===id);
        if(!source)throw new Error('字体链接不存在，未修改字体库');
        if(source.css)throw new Error('CSS 字体可能包含多套字形文件，请先取得完整 TTF／OTF／WOFF 文件再离线导入；原链接仍保留');
        const recordId='font_offline_'+source.id;
        const existing=await readFontById(recordId);
        if(existing){
            if(existing.sourceUrlFontId!==source.id||existing.sourceUrl!==source.url||!existing.buffer?.byteLength)
                throw new Error('离线字体 ID 与已有资料冲突，已保护原数据');
            return metadataOf(existing);
        }
        const maxBytes=64*1024*1024;
        let response;
        try { response=await fetch(source.url,{mode:'cors',credentials:'omit',cache:'no-store'}); }
        catch(error){ throw new Error('字体网站拒绝读取或网络不可用；原链接未更改：'+(error?.message||String(error))); }
        if(!response.ok)throw new Error('下载字体失败（HTTP '+response.status+'），原链接未更改');
        const sizeHint=Number(response.headers.get('content-length')||0);
        if(sizeHint>maxBytes){try{await response.body?.cancel();}catch(_){}throw new Error('字体文件超过 64 MB，未下载到本机');}
        // A real font must have a supported signature; do not persist an HTML
        // error page, CSS stylesheet, or an unrelated binary as a fake font.
        let bytes;
        if(response.body?.getReader){
            // Bound memory even when the server omits Content-Length or lies.
            const reader=response.body.getReader(),chunks=[];let total=0;
            try{
                while(true){
                    const {done,value}=await reader.read();if(done)break;
                    total+=value.byteLength;
                    if(total>maxBytes)throw new Error('字体下载超过 64 MB，已停止，原链接未更改');
                    chunks.push(value);
                }
                const merged=new Uint8Array(total);let offset=0;
                for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
                bytes=merged.buffer;
            }catch(error){try{await reader.cancel();}catch(_){}throw error;}
            finally{try{reader.releaseLock();}catch(_){} }
        }else bytes=await response.arrayBuffer();
        if(!bytes.byteLength||bytes.byteLength>maxBytes)throw new Error('字体文件为空或超过 64 MB，原链接未更改');
        const head=new Uint8Array(bytes,0,Math.min(4,bytes.byteLength));
        const signature=Array.from(head).map(n=>String.fromCharCode(n)).join('');
        const format=signature==='wOF2'?'woff2':signature==='wOFF'?'woff':signature==='OTTO'?'otf':
            (head[0]===0&&head[1]===1&&head[2]===0&&head[3]===0||signature==='true'||signature==='typ1')?'ttf':'';
        if(!format)throw new Error('下载的内容不是支持的字体文件（可能是 CSS 或网页），未保存');
        const record={id:recordId,name:'离线 · '+source.name+'.'+format,
            family:'MimaOffline_'+source.id,format,size:bytes.byteLength,buffer:bytes,
            createdAt:new Date().toISOString(),sourceUrlFontId:source.id,sourceUrl:source.url};
        const entry=makeFont(record);
        if(!entry)throw new Error('当前浏览器不支持校验离线字体');
        try {await entry.face.load();}
        catch(error){throw new Error('字体无法解码，未保存离线副本：'+(error?.message||String(error)));}
        finally{disposeFont(entry);}
        // Save only after verified decode and a successful complete IndexedDB
        // transaction. Existing local fonts and URL records are untouched.
        await put(record,{addOnly:true});
        return metadataOf(record);
    }
    // Import a pasted set of font links in one localStorage transaction. Existing
    // URL entries, saved binaries, and current UI/story choices are never changed.
    function batchFontCandidates(raw){
        const text=String(raw||'');
        if(text.length>65536)throw Error('一次粘贴的内容太长，请分批导入');
        const items=[];
        for(const line of text.split(/\r?\n/)){
            if(!line.trim())continue;
            // Accept plain links, space-separated links and pasted @import/link tags.
            const links=line.match(/https?:\/\/[^\s"'()<>，、]+/gi);
            if(links?.length){
                for(const found of links)items.push(found.replace(/[;,；]+$/,''));
            }else items.push(line.trim()); // Never silently ignore malformed lines.
        }
        if(items.length>200)throw Error('一次最多识别 200 条链接，请分批导入');
        return items;
    }
    function urlFontDetails(address){
        const url=String(address||'').trim().replace(/&amp;/gi,'&');
        let parsed;try{parsed=new URL(url);}catch(_){throw Error('不是有效的 URL');}
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||
            /[\s"'()\\]/.test(url)||url.length>2048)throw Error('需要不含账号密码的 HTTPS 字体链接');
        const css=parsed.hostname.toLowerCase()==='fonts.googleapis.com'||/\.css$/i.test(parsed.pathname);
        return {url,parsed,css};
    }
    async function detectCssFamily(details){
        const {url,parsed}=details;
        // Google Fonts encodes the family in its query string. No network
        // request or CORS permission is required for that supported URL format.
        if(parsed.hostname.toLowerCase()==='fonts.googleapis.com'){
            const family=parsed.searchParams.getAll('family').map(v=>v.split(':')[0].replace(/\+/g,' ').trim()).find(Boolean);
            if(family)return family;
            throw Error('Google Fonts 地址缺少 family 参数');
        }
        let response;
        try{response=await fetch(url,{credentials:'omit',mode:'cors'});}
        catch(_){throw Error('无法跨站读取 CSS 字体族名；请用上方单条导入填写字体族名');}
        if(!response.ok)throw Error('CSS 无法读取（HTTP '+response.status+'）');
        const length=Number(response.headers.get('content-length')||0);
        if(length>512*1024)throw Error('CSS 文件过大，无法自动识别字体族名');
        const css=(await response.text()).slice(0,512*1024+1);
        if(css.length>512*1024)throw Error('CSS 文件过大，无法自动识别字体族名');
        const faces=css.match(/@font-face\s*\{[^}]*\}/gi)||[];
        for(const face of faces){
            const match=face.match(/font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;\r\n}]+))/i);
            const family=(match?.[1]||match?.[2]||match?.[3]||'').trim();
            if(family)return family;
        }
        throw Error('CSS 未找到 @font-face 字体族名；请用上方单条导入');
    }
    function exportRawUrlFontLibrary(){
        const raw=localStorage.getItem(URL_LIBRARY_KEY);
        if(raw===null)throw Error('当前没有链接字体收藏原件');
        const blob=new Blob([raw],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;a.download='咪嘛馆_链接字体收藏原始数据.txt';
        document.body.append(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        return true;
    }
    function urlFontsForBatchWrite(){
        const saved=localStorage.getItem(URL_LIBRARY_KEY);
        if(saved===null)return [];
        let records;try{records=JSON.parse(saved);}catch(_){throw Error('原链接字体库读取异常，已保留原数据，没有覆盖');}
        const valid=urlFonts();
        if(!Array.isArray(records)||records.length!==valid.length)
            throw Error('原链接字体库存在无法识别的记录，已保留原数据，没有覆盖');
        return valid;
    }
    async function addUrlFontsBatch(raw){
        const candidates=batchFontCandidates(raw);
        if(!candidates.length)throw Error('请先粘贴字体链接，每行一条');
        const existing=urlFontsForBatchWrite(),seen=new Set(existing.map(f=>f.url));
        const rejected=[],pending=[];
        for(const candidate of candidates){
            try{
                const details=urlFontDetails(candidate);
                if(seen.has(details.url)){
                    rejected.push({url:candidate,reason:'重复链接，已跳过'});continue;
                }
                seen.add(details.url);
                pending.push(details);
            }catch(error){rejected.push({url:candidate,reason:error.message||String(error)});}
        }
        // Only unknown CSS sources require a remote metadata read. Bounded
        // concurrency avoids flooding an iPhone with stylesheet requests.
        const results=new Array(pending.length);let next=0;
        await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
            while(next<pending.length){
                const i=next++,details=pending[i];
                try{results[i]=details.css?await detectCssFamily(details):null;}
                catch(error){results[i]={error:error.message||String(error)};}
            }
        }));
        // CSS inspection may await remote requests. Another tab could have
        // edited the library meanwhile; re-read before committing so no newer
        // records disappear from a stale full-array write.
        const latest=urlFontsForBatchWrite();
        const taken=new Set(latest.map(f=>f.name));
        const committedUrls=new Set(latest.map(f=>f.url));
        const cssFamilies=new Set(latest.filter(f=>f.css).map(f=>f.family.toLowerCase()));
        let number=1;
        const added=[];
        for(let i=0;i<pending.length;i++){
            const details=pending[i],result=results[i];
            if(result?.error){rejected.push({url:details.url,reason:result.error});continue;}
            if(committedUrls.has(details.url)){
                rejected.push({url:details.url,reason:'其他页面已收藏此链接'});continue;
            }
            if(latest.length+added.length>=100){
                rejected.push({url:details.url,reason:'字体收藏库最多 100 个'});continue;
            }
            while(taken.has('自定义字体'+number))number++;
            const name='自定义字体'+number++;taken.add(name);
            const id='urlfont_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,11);
            const family=details.css?String(result||'').trim():'MimaUrl_'+id;
            if(!family||/["'\;{}\n\r]/.test(family)){
                rejected.push({url:details.url,reason:'字体族名含无效 CSS 字符'});continue;
            }
            if(details.css && cssFamilies.has(family.toLowerCase())){
                rejected.push({url:details.url,reason:'CSS 字体族名与已有字体重复，不能独立切换'});continue;
            }
            added.push({id,name,url:details.url,css:details.css,family,lazy:details.css});
            if(details.css)cssFamilies.add(family.toLowerCase());
            committedUrls.add(details.url);
        }
        // Atomic: if storage is full/unavailable, do not report partial success.
        if(added.length){
            localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify([...latest,...added]));
            urlFontStyle();
        }
        return {added,rejected};
    }
    function setUrlFontCompatibility(id,enabled) {
        const records=urlFontsForBatchWrite(),index=records.findIndex(f=>f.id===id&&f.css===true);
        if(index<0)return false;
        const value=enabled===true;
        if(records[index].compatAlwaysLoad===value)return true;
        records[index]={...records[index],compatAlwaysLoad:value};
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify(records));
        urlFontStyle();return true;
    }
    function deleteUrlFont(id){
        const records=urlFontsForBatchWrite(),found=records.find(x=>x.id===id);
        if(!found)return false;
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify(records.filter(x=>x.id!==id)));
        if(getSelected('ui')===found.family)setSelected('ui','');
        if(getSelected('story')===found.family)setSelected('story','');
        urlFontStyle();applySelected();return true;
    }
    function setFontCss(kind,family) {
        const root=document.documentElement;
        family=family?scopedFamily(kind,family):family;
        let property,value;
        if(kind==='ui'){
            property='--font-ui';
            value=family ? `'${String(family).replace(/'/g,'')}', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
                : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        } else {
            const legacy=localStorage.getItem('storyFontUrl') ? localStorage.getItem('storyFontFamily')||'MimaUrlFont' : '';
            const story=family||legacy;
            property='--font-story';
            value=story ? `'${String(story).replace(/'/g,'')}', var(--font-ui)` : 'var(--font-ui)';
        }
        // A redundant root custom-property write can invalidate styling for
        // every chat item, status widget and settings control on iOS WebKit.
        if(root.style.getPropertyValue(property)!==value)root.style.setProperty(property,value);
    }
    async function applySelected(kind=null) {
        urlFontStyle();
        const applyKind=async kind=>{
            const epoch=++selectionEpoch[kind],family=getSelected(kind);
            if(!family)effectiveParts[kind]=null;
            // This CSS assignment must NOT wait for the IndexedDB read or
            // FontFace.load(). Previously an unresolved/rejected load left the
            // entire page on its default font, even when selection was saved.
            setFontCss(kind,family);
            reportLoad(kind,family,family?'loading':'default');
            try {
                const face=await acquireFamily(family,kind);
                const external=family && !face && urlFonts().some(f=>f.family===family);
                if(external)await loadExternalFamily(family);
                if(epoch!==selectionEpoch[kind]||family!==getSelected(kind)){trimFonts();return;}
                // Registration is not decoding success. Keep last verified
                // family until the native promise actually resolves.
                if(!face || face.status==='loaded')applied[kind]=scopedFamily(kind,family);
                if(face)settleLocalScope(kind,family);
                else reportLoad(kind,family,external?'loaded':(family?'external':'default'));
                trimFonts();
            } catch(error) {
                // A failed IndexedDB read or native FontFace decode is a load
                // failure, not a user request to deselect the font. Keep the
                // persisted choice AND its CSS declaration, so retry/reload can
                // recover without asking the user to find and choose it again.
                // An obsolete request must never change the next choice's state.
                if(epoch===selectionEpoch[kind]&&family===getSelected(kind)){
                    setFontCss(kind,family);
                    reportLoad(kind,family,'error',error);
                }
                throw error;
            }
        };
        const task=Promise.all((kind?[kind]:['ui','story']).map(applyKind)).then(async result=>{
            await Promise.all(Array.from(usages,([owner,usage])=>usage.requested===undefined?Promise.resolve():useFamily(owner,usage.requested).catch(error=>console.warn('阅读字体加载失败，原选择保留',error))));
            return result;
        });
        task.catch(error=>console.warn('字体切换失败，保留上次有效字体',error));return task;
    }
    function bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
        if(typeof bytes.toBase64==='function')return bytes.toBase64();
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return btoa(binary);
    }
    function base64ToBuffer(base64='') {
        const binary = atob(String(base64 || ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
    async function exportPortable({allowPartial=false}={}){
        const data=await all({allowPartial});
        const source=allowPartial?data.records:data;
        const records=[];
        for(const r of source){
            const buffer=r.buffer instanceof Blob?await r.buffer.arrayBuffer():r.buffer;
            records.push({id:r.id,name:r.name,family:r.family,format:r.format,size:buffer.byteLength,createdAt:r.createdAt,
                sourceUrlFontId:r.sourceUrlFontId,sourceUrl:r.sourceUrl,health:r.health,diagnostic:r.diagnostic,
                bufferBase64:bufferToBase64(buffer)});
        }
        return allowPartial?{fonts:records,failed:data.failed,partial:data.failed.length>0}:records;
    }
    async function importPortable(records,{replace=false}={}){
        if(!Array.isArray(records))throw new Error('E_FONT_BACKUP_FORMAT');
        const incoming=[],seen=new Set();
        for(const raw of records){
            if(!raw?.bufferBase64){if(replace)throw new Error('E_FONT_BACKUP_INVALID');continue}
            const id=raw.id||`font_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
            if(seen.has(id))throw new Error('E_FONT_BACKUP_DUPLICATE_ID');seen.add(id);
            const buffer=base64ToBuffer(raw.bufferBase64);
            if(!buffer.byteLength||Number(raw.size)>0 && Number(raw.size)!==buffer.byteLength)throw new Error('E_FONT_BACKUP_SIZE');
            incoming.push({id,name:raw.name||`${raw.family||'MimaFont'}.${raw.format||'woff2'}`,
                family:raw.family||safeFamily(raw.name),format:raw.format||extension(raw.name)||'woff2',
                size:buffer.byteLength,createdAt:raw.createdAt||new Date().toISOString(),
                ...(raw.sourceUrlFontId?{sourceUrlFontId:String(raw.sourceUrlFontId),sourceUrl:String(raw.sourceUrl||'')}:{}),
                ...(raw.health==='corrupt'?{health:'corrupt',diagnostic:String(raw.diagnostic||'原始字体需检查')}:{}),buffer});
        }
        for(const r of incoming){r.fingerprint=await fingerprintOf(r.buffer);r.contentVersion=r.fingerprint;}
        // A complete replacement must first account for all legacy IDs. This
        // explicit user action may await the background migration; normal app
        // startup and settings never do.
        if(replace)await migrateLegacy(true);
        const db=await openFontDb();await new Promise((resolve,reject)=>{
            let tx;try{
                tx=db.transaction([META_STORE,BINARY_STORE,STATE_STORE,CLAIM_STORE],'readwrite');
                const meta=tx.objectStore(META_STORE),binary=tx.objectStore(BINARY_STORE);
                if(replace){
                    const incomingIds=new Set(incoming.map(r=>r.id));
                    // Tombstone old v1 references in this very same commit.
                    // v1 bytes are never deleted, including in partial failures.
                    const state=tx.objectStore(STATE_STORE),prior=meta.getAll();
                    prior.onsuccess=()=>{for(const old of prior.result||[]){
                        if(old.storage==='legacy'&&!incomingIds.has(old.id))state.put({deletedAt:Date.now(),storage:'legacy'},'deleted:'+old.id);
                    }};
                    meta.clear();binary.clear();tx.objectStore(CLAIM_STORE).clear();
                    state.put({indexed:true,replaced:true,checkedAt:Date.now()},'legacyMigrationComplete');
                }
                for(const r of incoming){meta.put(newMetadata(r));binary.put(r.buffer,r.id);
                    if(replace)tx.objectStore(STATE_STORE).delete('deleted:'+r.id)}
                tx.oncomplete=()=>{db.close();resolve()};
                tx.onabort=()=>{db.close();reject(tx.error||new Error('E_FONT_BACKUP_WRITE_ABORTED'))};
            }catch(e){try{tx?.abort()}catch(_){}db.close();reject(e)}
        });
        if(replace)for(const entry of [...loaded.values()])releaseFont(entry.id);
        else for(const r of incoming)releaseFont(r.id);
        notifyFontChange();await applySelected().catch(error=>console.warn('字体已保存，但显示切换失败',error));
        return incoming.length;
    }
    async function readFontById(id,{forBackup=false}={}){
        window.MimaPerfDiagnostics?.detail('font_idb_binary');
        const db=await openFontDb();
        const pair=await new Promise((resolve,reject)=>{
            let tx,meta,buffer,issue;
            try{
                tx=db.transaction([META_STORE,BINARY_STORE],'readonly');
                tx.objectStore(META_STORE).get(id).onsuccess=e=>{meta=e.target.result};
                tx.objectStore(BINARY_STORE).get(id).onsuccess=e=>{buffer=e.target.result};
                tx.oncomplete=()=>{db.close();resolve({meta,buffer})};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_PAIR_READ_ABORTED'))};
            }catch(e){db.close();reject(e)}
        });
        if(!pair.meta)return null;
        if(!forBackup&&pair.meta.health==='corrupt')throw new Error('旧字体已隔离：'+(pair.meta.diagnostic||'原文件不完整'));
        if(pair.meta.storage==='legacy'){
            const old=await storeRead('legacy',STORE,id);
            if(!old?.buffer)throw new Error('E_FONT_LEGACY_BINARY_MISSING:'+id);
            const length=Number(old.buffer.byteLength??old.buffer.size);
            if(!length)throw new Error('E_FONT_LEGACY_EMPTY:'+id);
            if(!forBackup && Number(pair.meta.size)>0&&length!==Number(pair.meta.size))throw new Error('E_FONT_LEGACY_SIZE_CHANGED:'+id);
            if(forBackup)return {...old,id,buffer:old.buffer instanceof Blob?await old.buffer.arrayBuffer():old.buffer,
                size:length,health:pair.meta.health,diagnostic:pair.meta.diagnostic,contentVersion:pair.meta.contentVersion,
                format:old.format||pair.meta.format,family:old.family||pair.meta.family};
            // A legacy tab can modify v1 independently. Never associate bytes
            // with an older v2 cache identity if a same-ID rewrite is detected.
            if(pair.meta.fingerprint && await fingerprintOf(old.buffer instanceof Blob ? await old.buffer.arrayBuffer() : old.buffer)!==pair.meta.fingerprint){
                legacySyncRequested=true;
                void migrateLegacy(true).catch(e=>console.warn('旧字体更新识别失败',e));
                throw new Error('旧版页面修改了字体，请重新加载字体后重试');
            }
            return {...old,contentVersion:pair.meta.contentVersion,fingerprint:pair.meta.fingerprint,family:pair.meta.family,format:pair.meta.format};
        }
        if(!pair.buffer)throw new Error('E_FONT_BINARY_MISSING:'+id);
        return {...pair.meta,buffer:forBackup&&pair.buffer instanceof Blob?await pair.buffer.arrayBuffer():pair.buffer,
            ...(forBackup?{size:Number(pair.buffer.byteLength??pair.buffer.size)||pair.meta.size}:{})};
    }
    async function planPortableImport(records) {
        if (!Array.isArray(records)) throw new Error('E_FONT_BACKUP_FORMAT');
        const incoming = [], seen = new Set();
        for (const raw of records) {
            if (!raw || typeof raw !== 'object' || !raw.bufferBase64) throw new Error('E_FONT_BACKUP_INVALID');
            // Old portable backups may omit IDs; they used to receive a new one.
            const id = String(raw.id||('font_import_'+(window.crypto?.randomUUID?.()||Date.now()+'_'+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g,'')));
            if (!id || id.length>200 || seen.has(id)) throw new Error('E_FONT_BACKUP_ID_INVALID');
            seen.add(id);
            const format = String(raw.format||extension(raw.name)).toLowerCase();
            if (!['ttf','otf','woff','woff2'].includes(format)) throw new Error('E_FONT_BACKUP_FORMAT');
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw.bufferBase64)) throw new Error('E_FONT_BACKUP_BASE64');
            const buffer = base64ToBuffer(raw.bufferBase64);
            if (!buffer.byteLength) throw new Error('E_FONT_BACKUP_SIZE');
            if (Number(raw.size)>0 && Number(raw.size)!==buffer.byteLength) throw new Error('E_FONT_BACKUP_SIZE_MISMATCH');
            const record = {id,name:String(raw.name||'imported.'+format),family:String(raw.family||safeFamily(raw.name)),format,size:buffer.byteLength,createdAt:raw.createdAt||new Date().toISOString(),
                ...(raw.sourceUrlFontId?{sourceUrlFontId:String(raw.sourceUrlFontId),sourceUrl:String(raw.sourceUrl||'')}:{}),
                ...(raw.health==='corrupt'?{health:'corrupt',diagnostic:String(raw.diagnostic||'原始字体需检查')}:{}),buffer};
            const previous=await readFontById(id,{forBackup:true});
            if(previous){
                const a=new Uint8Array(previous.buffer||new ArrayBuffer(0)),b=new Uint8Array(buffer);
                if(a.length!==b.length || a.some((v,i)=>v!==b[i]) || previous.family!==record.family) throw new Error('E_FONT_BACKUP_ID_CONFLICT');
                continue; // Existing identical ID stays owned by its original user.
            }
            incoming.push(record);
        }
        return {version:1,records:incoming};
    }
    // Binary-volumes path: validate each font without ever holding Base64
    // copies of the whole library. Existing IDs are never overwritten.
    async function backupBinaryById(id){return readFontById(id,{forBackup:true});}
    async function planBinaryFontRestore(raw){
        if(!raw||typeof raw.id!=='string'||!raw.id||raw.id.length>200||!raw.buffer)throw new Error('E_FONT_BINARY_BACKUP_ID');
        const format=String(raw.format||'').toLowerCase();
        if(!['ttf','otf','woff','woff2'].includes(format))throw new Error('E_FONT_BINARY_BACKUP_FORMAT');
        const buffer=raw.buffer instanceof Blob?await raw.buffer.arrayBuffer():raw.buffer;
        if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength||Number(raw.size)!==buffer.byteLength)throw new Error('E_FONT_BINARY_BACKUP_SIZE');
        const record={id:raw.id,name:String(raw.name||'font.'+format),family:String(raw.family||safeFamily(raw.name)),format,
            size:buffer.byteLength,createdAt:String(raw.createdAt||new Date().toISOString()),buffer,
            ...(raw.sourceUrlFontId?{sourceUrlFontId:String(raw.sourceUrlFontId),sourceUrl:String(raw.sourceUrl||'')}:{}),
            ...(raw.health==='corrupt'?{health:'corrupt',diagnostic:String(raw.diagnostic||'原字体需检查')}:{} )};
        const prior=await readFontById(record.id,{forBackup:true});
        if(prior){
            const original=prior.buffer instanceof Blob?await prior.buffer.arrayBuffer():prior.buffer;
            if(prior.family!==record.family||original.byteLength!==buffer.byteLength)throw new Error('E_FONT_BACKUP_ID_CONFLICT:'+record.id);
            const a=new Uint8Array(original),b=new Uint8Array(buffer);
            for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw new Error('E_FONT_BACKUP_ID_CONFLICT:'+record.id);
            return {version:1,records:[]};
        }
        return {version:1,records:[record]};
    }
    async function refreshAfterBinaryRestore(){notifyFontChange();await applySelected().catch(error=>console.warn('导入字体后显示刷新失败',error));}
    async function commitPortablePlan(plan,{deferRefresh=false}={}){
        if(plan?.version!==1||!Array.isArray(plan.records))throw new Error('E_FONT_BACKUP_PLAN_UNVERIFIED');
        for(const r of plan.records){r.fingerprint=await fingerprintOf(r.buffer);r.contentVersion=r.fingerprint;}
        const receiptId='font_restore_'+(window.crypto?.randomUUID?.()||Date.now()+'_'+Math.random().toString(36).slice(2));
        const db=await openFontDb();
        const added=await new Promise((resolve,reject)=>{
            let tx,issue;const ids=[];
            try{
                tx=db.transaction([META_STORE,BINARY_STORE],'readwrite');const os=tx.objectStore(META_STORE),bs=tx.objectStore(BINARY_STORE);
                for(const r of plan.records){
                    const request=os.add({...newMetadata(r),restoreReceipt:receiptId});
                    request.onsuccess=()=>ids.push(r.id);request.onerror=()=>{issue=request.error};
                    bs.add(r.buffer,r.id);
                }
                tx.oncomplete=()=>{db.close();resolve(ids)};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_RESTORE_ABORTED'))};
            }catch(e){try{tx?.abort()}catch(_){}db.close();reject(e)}
        });
        if(added.length&&!deferRefresh)notifyFontChange();
        if(!deferRefresh)await applySelected().catch(error=>console.warn('字体已保存，但显示切换失败',error));
        return {receiptId,added};
    }
    async function rollbackPortablePlan(receipt){
        if(!receipt?.receiptId||!Array.isArray(receipt.added))throw new Error('E_FONT_ROLLBACK_RECEIPT');
        const db=await openFontDb();
        await new Promise((resolve,reject)=>{let tx,issue;
            try{
                tx=db.transaction([META_STORE,BINARY_STORE],'readwrite');
                const os=tx.objectStore(META_STORE),bs=tx.objectStore(BINARY_STORE);
                for(const id of receipt.added){
                    const r=os.get(id);
                    r.onsuccess=()=>{
                        if(r.result?.restoreReceipt===receipt.receiptId){os.delete(id);bs.delete(id)}
                        else {issue=new Error('E_FONT_ROLLBACK_CONFLICT');tx.abort()}
                    };
                    r.onerror=()=>{issue=r.error;tx.abort()};
                }
                tx.oncomplete=()=>{db.close();resolve()};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_ROLLBACK_ABORTED'))};
            }catch(e){try{tx?.abort()}catch(_){}db.close();reject(e)}
        });
        for(const id of receipt.added)releaseFont(id);
        notifyFontChange();return true;
    }
    async function deleteFont(id) {
        const records=await listMetadata();
        const record=records.find(x=>x.id===id);
        if(!record)throw new Error('字体记录已不存在');
        const wasLatest=newestFamilyRecord(records,record.family)?.id===id;
        const selected=['ui','story'].filter(kind=>getSelected(kind)===record.family);
        const previouslyRemaining=records.some(r=>r.family===record.family&&r.id!==id)||urlFonts().some(f=>f.family===record.family);
        // When the selected newest version is deleted, keep its FontFace
        // registered until the replacement has been registered. A failed IDB
        // transaction never changes the selected family or face.
        const handoff=wasLatest&&selected.length>0&&previouslyRemaining;
        await remove(id,{deferFaceRelease:handoff});
        try{
            if(!wasLatest||!selected.length)return;
            const survivor=newestFamilyRecord(await listMetadata(),record.family);
            const external=urlFonts().some(font=>font.family===record.family);
            if(survivor||external){
                // The selection is a family preference, not a specific ID.
                // Its new owner will be resolved without resetting UI/story.
                await applySelected().catch(error=>console.warn('剩余同名字体接管失败；原选择保留，可手动重新加载',error));
            }else{
                await Promise.all(selected.map(kind=>setSelected(kind,'').catch(error=>console.warn('字体移除后无法更新选择',kind,error))));
            }
        }finally{if(handoff)releaseFont(id);}
    }
    function runtimeMetrics(){
        const entries=Array.from(loaded.values());
        return {registered:entries.length,nativeLoadPending:entries.filter(x=>x.loadPending).length,
            unusedPending:entries.filter(x=>x.loadPending&&x.retireWhenIdle).length,
            binaryReadPending:pendingFonts.size,activePreviewOwners:usages.size,
            activeCssLinks:activeCssLinks.size};
    }
    return { runtimeMetrics, scopedFamily, getDecodeFailure, stageOf, inspectFont, bundleFor, setBundle, init, all, listMetadata, listBackupInventory, assertBackupInventory, openBackupSource, auditStoredFonts, recoverLegacyIndex, readOrphanBinary, getByFamily, ensureFamily, ensureFont, cancelPreview, useFamily, useFont, releaseUsage, importFile, cacheUrlFont, deleteFont, getSelected, getLoadStatus, setSelected, applySelected, reloadSelected, urlFonts, refreshUrlFontUsage:urlFontStyle, fontReferencedByAppearance, exportRawUrlFontLibrary, setUrlFontCompatibility, addUrlFont, addUrlFontsBatch, deleteUrlFont, exportPortable, importPortable, planPortableImport, commitPortablePlan, rollbackPortablePlan, backupBinaryById, planBinaryFontRestore, refreshAfterBinaryRestore };
})();
