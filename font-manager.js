/** 🍷 咪嘛馆本地字体库：TTF/OTF/WOFF/WOFF2 -> IndexedDB -> FontFace */
window.MimaFontManager = (() => {
    const DB_NAME = 'mimamao_tavern_assets_v1';
    const STORE = 'fonts';
    const UI_KEY = 'mimamao_tavern_ui_font';
    const STORY_KEY = 'mimamao_tavern_story_font';
    // UI, story, visible readers and one explicit preview own loaded faces. Binary sources
    // are created on demand and revoked as soon as decoding settles.
    const loaded = new Map();
    const usages = new Map();
    // The font picker only needs metadata. Keep the initial verified font list's
    // metadata in memory instead of cloning every multi-MB ArrayBuffer on each visit.
    let metadataCache = null;
    let metadataRead = null, registryRead = null, fontRevision = 0, initialized = false;
    let previewFamily='', previewApplied='', previewEpoch=0, loadQueue=Promise.resolve();
    const applied={ui:'',story:''}, selectionEpoch={ui:0,story:0}, selectionWrites={ui:0,story:0}, pendingFonts=new Map();
    // Invalidate the cached picker listing when another open tab commits fonts.
    const fontChanges = typeof BroadcastChannel==='function' ? new BroadcastChannel('mima-tavern-font-metadata-v1') : null;
    if(fontChanges)fontChanges.onmessage = event => {
        if(event.data!=='changed')return;
        metadataCache=null;fontRevision++;
        // Other tabs can replace the binary under an existing ID. Reconcile
        // only after a verified read, keeping the last working view on error.
        if(initialized)init(true).catch(e=>console.warn('字体库同步失败，原字体保留',e));
    };
    const notifyFontChange = () => { metadataCache=null;fontRevision++;try{fontChanges?.postMessage('changed');}catch(_){} };
    const metadataOf = ({id,name,family,format,size,createdAt}) => ({id,name,family,format,size,createdAt});
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
    // IDB has no field projection: cursor values still clone one binary at a
    // time, but we drop each value before advancing instead of getAll() keeping
    // every multi-MB buffer alive together. Startup creates no font sources.
    async function readMetadata() {
        const db=await openDb();
        return new Promise((resolve,reject)=>{
            const records=[];let ended=false,issue,settled=false,tx;
            const finish=error=>{if(settled)return;settled=true;db.close();error?reject(error):resolve(records);};
            try{
                tx=db.transaction(STORE,'readonly');const request=tx.objectStore(STORE).openCursor();
                request.onsuccess=()=>{
                    const cursor=request.result;
                    if(!cursor){ended=true;return;}
                    const record=cursor.value;records.push(metadataOf(record));
                    cursor.continue();
                };
                request.onerror=()=>{issue=request.error;};
                tx.oncomplete=()=>finish(ended?null:new Error('E_FONT_READ_UNVERIFIED'));
                tx.onabort=()=>finish(issue||tx.error||new Error('E_FONT_READ_ABORTED'));
                tx.onerror=()=>finish(issue||tx.error||new Error('E_FONT_READ_FAILED'));
            }catch(e){try{tx?.abort();}catch(_){}finish(e);}
        });
    }
    // A successful IDB request does not guarantee the containing transaction
    // committed. Wait for oncomplete, and never report a failed read as "no fonts".
    async function all() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            let records;
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                db.close();
                if (error) reject(error);
                else resolve(value);
            };
            try {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).getAll();
                req.onsuccess = () => { records = req.result; };
                // The request's success is only provisional until tx.oncomplete.
                tx.oncomplete = () => Array.isArray(records) ? finish(null, records) : finish(new Error('E_FONT_READ_UNVERIFIED'));
                tx.onabort = () => finish(tx.error || new Error('E_FONT_READ_ABORTED'));
                tx.onerror = () => finish(tx.error || req.error || new Error('E_FONT_READ_FAILED'));
            } catch (e) { finish(e); }
        });
    }
    async function put(record) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                db.close();
                if (error) reject(error);
                else { releaseFont(record.id);notifyFontChange(); resolve(); }
            };
            try {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(record);
                tx.oncomplete = () => finish(null);
                tx.onabort = () => finish(tx.error || new Error('E_FONT_WRITE_ABORTED'));
                tx.onerror = () => finish(tx.error || new Error('E_FONT_WRITE_FAILED'));
            } catch (e) { finish(e); }
        });
    }
    async function remove(id) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                db.close();
                if (error) reject(error);
                else { releaseFont(id);notifyFontChange(); resolve(); }
            };
            try {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(id);
                tx.oncomplete = () => finish(null);
                tx.onabort = () => finish(tx.error || new Error('E_FONT_DELETE_ABORTED'));
                tx.onerror = () => finish(tx.error || new Error('E_FONT_DELETE_FAILED'));
            } catch (e) { finish(e); }
        });
    }
    function extension(name='') { return String(name).split('.').pop().toLowerCase(); }
    function safeFamily(name='') {
        return String(name || 'MimaFont').replace(/\.[^.]+$/, '').replace(/[^\w\u3400-\u9fff\- ]+/g, ' ').trim().slice(0,80) || 'MimaFont';
    }
    function disposeFont(entry) {
        if(!entry)return;
        try{document.fonts.delete(entry.face);}catch(_){}
        if(entry.url){URL.revokeObjectURL(entry.url);entry.url='';}
    }
    function releaseFont(id) {const entry=loaded.get(id);if(entry){loaded.delete(id);disposeFont(entry);}}
    function makeFont(record) {
        if (!record?.buffer || !window.FontFace) return false;
        const url=URL.createObjectURL(new Blob([record.buffer]));
        try{return {face:new FontFace(record.family,`url("${url}")`,{display:'swap'}),url};}
        catch(e){URL.revokeObjectURL(url);throw e;}
    }
    function attachFont(id,entry) {
        // Commit only a verified replacement; a failed add leaves the last face usable.
        document.fonts.add(entry.face);releaseFont(id);
        for(const [otherId,other] of loaded)if(other.face.family===entry.face.family)releaseFont(otherId);
        loaded.set(id,entry);
        // A decoded face owns its font data. Its Blob URL can be released once
        // loading settles; stale completions never touch a replacement entry.
        const releaseSource=()=>{if(entry.url){URL.revokeObjectURL(entry.url);entry.url='';}};
        entry.face.loaded.then(releaseSource,releaseSource);
    }
    async function importFile(file) {
        if (!file) throw new Error('没有选择字体文件');
        const ext = extension(file.name);
        if (!['ttf','otf','woff','woff2'].includes(ext)) throw new Error('只支持 TTF / OTF / WOFF / WOFF2');
        const buffer = await file.arrayBuffer();
        const id = `font_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const record = { id, name:file.name, family:safeFamily(file.name), format:ext, size:file.size, buffer, createdAt:new Date().toISOString() };
        // An explicit single-file import must prove it is a decodable font
        // before saving or reporting success. Reuse that verified face; only
        // the library's startup registration remains lazy.
        const entry=makeFont(record);
        if(!entry)throw new Error('当前浏览器无法校验本地字体，请使用支持 FontFace 的浏览器');
        try{
            await entry.face.load();
            await put(record);
        }catch(e){
            disposeFont(entry);
            if(entry?.face.status==='error')throw new Error('字体文件无法解析，请选择有效的 TTF / OTF / WOFF / WOFF2 文件');
            throw e;
        }
        disposeFont(entry); // Imported metadata appears immediately; decode again only on actual use.
        return metadataOf(record);
    }
    async function getByFamily(family) {
        const record=(await listMetadata()).find(item=>item.family===family);
        return record ? readFontById(record.id) : null;
    }
    function trimFonts(extra='') {
        const keep=new Set([applied.ui,applied.story,previewApplied,extra,...Array.from(usages.values(),x=>x.applied)].filter(Boolean));
        for(const [id,entry] of loaded)if(!keep.has(entry.face.family))releaseFont(id);
    }
    function wantedFamily(family) {
        return [previewFamily,previewApplied,getSelected('ui'),getSelected('story'),applied.ui,applied.story,
            ...Array.from(usages.values(),x=>x.requested),...Array.from(usages.values(),x=>x.applied)].includes(family);
    }
    function acquireFamily(family) {
        if(!family)return Promise.resolve(null);
        const key=fontRevision+':'+family;
        if(pendingFonts.has(key))return pendingFonts.get(key);
        const task=loadQueue.catch(()=>{}).then(async()=>{
            // Queued requests that have lost all owners need no source at all.
            if(!wantedFamily(family))return null;
            const metadata=(await listMetadata()).find(item=>item.family===family);
            if(!metadata)return null; // A URL/CSS/system family has no local binary.
            const current=loaded.get(metadata.id);
            if(current?.revision===fontRevision)return current.face;
            const revision=fontRevision,record=await readFontById(metadata.id);
            if(!record?.buffer)throw new Error('所选字体的本地文件不存在');
            const entry=makeFont(record);if(!entry)throw new Error('当前浏览器无法加载本地字体');
            try {
                await entry.face.load();
                if(revision!==fontRevision){disposeFont(entry);throw new Error('字体库已变化，请重新选择字体');}
                if(!wantedFamily(family)){disposeFont(entry);return null;}
                entry.revision=revision;attachFont(record.id,entry);trimFonts(family);
                return entry.face;
            }catch(error){disposeFont(entry);throw error;}
        });
        loadQueue=task.catch(()=>{});
        pendingFonts.set(key,task);task.finally(()=>{if(pendingFonts.get(key)===task)pendingFonts.delete(key);}).catch(()=>{});
        return task;
    }
    // One explicit picker preview, plus the two currently applied choices.
    async function ensureFamily(family) {
        const requested=previewFamily=String(family||''),epoch=++previewEpoch;
        const face=await acquireFamily(requested);
        if(epoch===previewEpoch)previewApplied=requested;
        trimFonts();return face;
    }
    // A visible reader owns its font independently of the picker preview and
    // the global preferences. Replacing/closing the reader retires that owner.
    function useFamily(owner,family) {
        family=String(family||'');
        const previous=usages.get(owner);
        if(previous?.requested===family&&previous.revision===fontRevision)return previous.task;
        const usage={requested:family,applied:previous?.applied||'',revision:fontRevision,task:null};
        usages.set(owner,usage);
        const task=acquireFamily(family).then(face=>{if(usages.get(owner)===usage)usage.applied=family;return face;})
            .finally(()=>trimFonts());
        usage.task=task;task.catch(()=>{});return task;
    }
    function releaseUsage(owner) { usages.delete(owner);trimFonts(); }
    async function init(refresh=false) {
        if(refresh){metadataCache=null;fontRevision++;}
        if(!registryRead)registryRead=(async()=>{
            let records,revision;
            do{
                revision=fontRevision;records=await listMetadata();initialized=true;
                await applySelected().catch(error=>console.warn('字体库可用，但所选字体加载失败',error));
            }while(revision!==fontRevision);
            return records;
        })().finally(()=>{registryRead=null;});
        return registryRead;
    }
    function getSelected(kind) { return localStorage.getItem(kind === 'ui' ? UI_KEY : STORY_KEY) || ''; }
    function setSelected(kind, family) {
        kind=kind==='ui'?'ui':'story';const key=kind==='ui'?UI_KEY:STORY_KEY;
        const requested=String(family||''),write=++selectionWrites[kind];
        localStorage.setItem(key,requested);
        const task=applySelected(kind).catch(error=>{
            // Another pending request is not a verified fallback. Roll back to
            // the family whose decoded face/CSS was actually committed.
            if(selectionWrites[kind]===write&&getSelected(kind)===requested)localStorage.setItem(key,applied[kind]);
            throw error;
        });
        // Legacy callers need not await; explicit callers can observe failure.
        task.catch(error=>console.warn('字体切换失败，保留上次有效字体',error));return task;
    }
    // URL fonts share the same UI/story selectors as local fonts, but keep an
    // independent small metadata library. Never upload, fetch or overwrite local binaries.
    function urlFonts() {
        let value;
        try { value=JSON.parse(localStorage.getItem(URL_LIBRARY_KEY)||'[]'); } catch(_) { return []; }
        return Array.isArray(value)?value.filter(x=>x && /^[a-zA-Z0-9_-]{1,90}$/.test(x.id) && /^https:\/\//i.test(x.url) && typeof x.family==='string').slice(0,100):[];
    }
    function urlFontStyle() {
        let tag=document.getElementById('mima-url-font-library-style');
        if(!tag){tag=document.createElement('style');tag.id='mima-url-font-library-style';document.head.appendChild(tag);}
        const imports=[],faces=[];
        for(const f of urlFonts()) {
            const url=f.url.replace(/[\"'\\()\s]/g,'');
            const fam=f.family.replace(/[\"'\\;{}\n\r]/g,'');
            if(!url||!fam)continue;
            if(f.css===true){imports.push(`@import url("${url}");`);continue;}
            faces.push(`@font-face{font-family:"${fam}";src:url("${url}");font-display:swap;}`);
        }
        const css=imports.join('\n')+faces.join('\n');
        if(tag.textContent!==css)tag.textContent=css;
    }
    function addUrlFont(name,url,family){
        name=String(name||family||'链接字体').trim().slice(0,75);
        url=String(url||'').trim();family=String(family||name).trim().slice(0,75);
        let parsed;try{parsed=new URL(url)}catch(_){throw Error('请输入有效的 HTTPS 字体地址')}
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||/[\s"'()\\]/.test(url)||url.length>2048)throw Error('请使用不含账号密码的 HTTPS 字体文件或 CSS 链接');
        if(!family||/["'\\;{}\n\r]/.test(family))throw Error('字体名称不能包含特殊 CSS 符号');
        const css=/fonts\.googleapis\.com$/i.test(parsed.hostname)||/\.css(?:$|[?#])/i.test(parsed.pathname);
        const fonts=urlFonts();if(fonts.length>=100)throw Error('链接字体库最多保存 100 个');
        const id='urlfont_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);
        // File links use a unique internal family; imported CSS must retain
        // the author-defined family name declared inside its stylesheet.
        const record={id,name,url,css,family:css?family:'MimaUrl_'+id};
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify([...fonts,record]));
        urlFontStyle();return record;
    }
    function deleteUrlFont(id){
        const records=urlFonts(),found=records.find(x=>x.id===id);
        if(!found)return false;
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify(records.filter(x=>x.id!==id)));
        if(getSelected('ui')===found.family)setSelected('ui','');
        if(getSelected('story')===found.family)setSelected('story','');
        urlFontStyle();applySelected();return true;
    }
    async function applySelected(kind=null) {
        urlFontStyle();
        const applyKind=async kind=>{
            const epoch=++selectionEpoch[kind],family=getSelected(kind);
            await acquireFamily(family);
            if(epoch!==selectionEpoch[kind]||family!==getSelected(kind)){trimFonts();return;}
            applied[kind]=family;
            const root=document.documentElement;
            if(kind==='ui')root.style.setProperty('--font-ui',family ? `'${String(family).replace(/'/g,'')}', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
            else {
                const legacy=localStorage.getItem('storyFontUrl') ? localStorage.getItem('storyFontFamily')||'MimaUrlFont' : '';
                const story=family||legacy;
                root.style.setProperty('--font-story',story ? `'${String(story).replace(/'/g,'')}', var(--font-ui)` : 'var(--font-ui)');
            }
            trimFonts();
        };
        const task=Promise.all((kind?[kind]:['ui','story']).map(applyKind)).then(async result=>{
            await Promise.all(Array.from(usages,([owner,usage])=>useFamily(owner,usage.requested).catch(error=>console.warn('阅读字体加载失败，原选择保留',error))));
            return result;
        });
        task.catch(error=>console.warn('字体切换失败，保留上次有效字体',error));return task;
    }
    function bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
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
    async function exportPortable() {
        // Export all original binaries, but cursor through one at a time rather
        // than getAll() cloning every large ArrayBuffer into memory at once.
        const db=await openDb();
        return new Promise((resolve,reject)=>{
            const records=[];let issue=null,tx;
            try{
                tx=db.transaction(STORE,'readonly');
                const req=tx.objectStore(STORE).openCursor();
                req.onsuccess=()=>{
                    const cursor=req.result;if(!cursor)return;
                    try{
                        const r=cursor.value;
                        records.push({id:r.id,name:r.name,family:r.family,format:r.format,size:r.size,createdAt:r.createdAt,bufferBase64:bufferToBase64(r.buffer)});
                        cursor.continue();
                    }catch(e){issue=e;try{tx.abort();}catch(_){} }
                };
                req.onerror=()=>{issue=req.error;try{tx.abort();}catch(_){} };
                tx.oncomplete=()=>{db.close();resolve(records);};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_EXPORT_ABORTED'));};
                tx.onerror=()=>{issue=issue||tx.error;};
            }catch(e){try{tx?.abort();}catch(_){}db.close();reject(e);}
        });
    }
    async function importPortable(records, { replace=false } = {}) {
        if(!Array.isArray(records))throw new Error('E_FONT_BACKUP_FORMAT');
        // Decode the complete backup before touching durable data. In particular,
        // a malformed replacement must not erase the user's existing library.
        const incoming=[];
        for (const raw of records) {
            if (!raw?.bufferBase64) {if(replace)throw new Error('E_FONT_BACKUP_INVALID');continue;}
            const record = {
                id: raw.id || `font_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
                name: raw.name || `${raw.family || 'MimaFont'}.${raw.format || 'woff2'}`,
                family: raw.family || safeFamily(raw.name),
                format: raw.format || extension(raw.name) || 'woff2',
                size: Number(raw.size || 0),
                createdAt: raw.createdAt || new Date().toISOString(),
                buffer: base64ToBuffer(raw.bufferBase64)
            };
            if(!record.buffer.byteLength)throw new Error('E_FONT_BACKUP_SIZE');
            incoming.push(record);
        }
        const db=await openDb();
        await new Promise((resolve,reject)=>{
            let tx;
            try{
                tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);
                if(replace)store.clear();
                for(const record of incoming)store.put(record);
                tx.oncomplete=()=>{db.close();resolve();};
                tx.onabort=()=>{db.close();reject(tx.error||new Error('E_FONT_WRITE_ABORTED'));};
            }catch(e){try{tx?.abort();}catch(_){}db.close();reject(e);}
        });
        if(replace)for(const id of loaded.keys())releaseFont(id);
        else for(const record of incoming)releaseFont(record.id);
        notifyFontChange();
        await applySelected().catch(error=>console.warn('字体已保存，但显示切换失败',error));
        return incoming.length;
    }
    // Two-phase add-only import for full-settings restores. Never overwrite a
    // pre-existing ID; the rollback owns only records it inserted. All newly
    // added fonts are written in one IDB transaction, not a per-font loop.
    async function readFontById(id) {
        const db=await openDb();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(id);
            let value=null,issue=null;
            req.onsuccess=()=>{value=req.result;};
            req.onerror=()=>{issue=req.error;try{tx.abort();}catch(_){} };
            tx.oncomplete=()=>{db.close();resolve(value);};
            tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_COMPARE_ABORTED'));};
        });
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
            const record = {id,name:String(raw.name||'imported.'+format),family:String(raw.family||safeFamily(raw.name)),format,size:buffer.byteLength,createdAt:raw.createdAt||new Date().toISOString(),buffer};
            const previous=await readFontById(id);
            if(previous){
                const a=new Uint8Array(previous.buffer||new ArrayBuffer(0)),b=new Uint8Array(buffer);
                if(a.length!==b.length || a.some((v,i)=>v!==b[i]) || previous.family!==record.family) throw new Error('E_FONT_BACKUP_ID_CONFLICT');
                continue; // Existing identical ID stays owned by its original user.
            }
            incoming.push(record);
        }
        return {version:1,records:incoming};
    }
    async function commitPortablePlan(plan) {
        if(plan?.version!==1||!Array.isArray(plan.records))throw new Error('E_FONT_BACKUP_PLAN_UNVERIFIED');
        const receiptId='font_restore_'+(window.crypto?.randomUUID?.()||Date.now()+'_'+Math.random().toString(36).slice(2));
        const db=await openDb();
        const added=await new Promise((resolve,reject)=>{
            let tx,err;const records=[];
            try {tx=db.transaction(STORE,'readwrite');const os=tx.objectStore(STORE);
                for(const record of plan.records){const request=os.add({...record,restoreReceipt:receiptId});
                    request.onsuccess=()=>records.push(record.id);request.onerror=()=>{err=request.error;};}
                tx.oncomplete=()=>{db.close();resolve(records);};
                tx.onabort=()=>{db.close();reject(err||tx.error||new Error('E_FONT_RESTORE_ABORTED'));};
            }catch(e){try{tx?.abort();}catch(_){}db.close();reject(e);}
        });
        // On a load error the durable binary still exists and can be restored
        // at next initialization; this is not a canonical data failure.
        if(added.length)notifyFontChange();
        await applySelected().catch(error=>console.warn('字体已保存，但显示切换失败',error));
        return {receiptId,added};
    }
    async function rollbackPortablePlan(receipt) {
        if(!receipt?.receiptId||!Array.isArray(receipt.added))throw new Error('E_FONT_ROLLBACK_RECEIPT');
        const db=await openDb();
        return new Promise((resolve,reject)=>{let tx,issue;
            try{tx=db.transaction(STORE,'readwrite');const os=tx.objectStore(STORE);
                for(const id of receipt.added){const r=os.get(id);r.onsuccess=()=>{
                   if(r.result?.restoreReceipt===receipt.receiptId)os.delete(id);
                   else {issue=new Error('E_FONT_ROLLBACK_CONFLICT');tx.abort();}
                };r.onerror=()=>{issue=r.error;tx.abort();};}
                tx.oncomplete=()=>{db.close();for(const id of receipt.added)releaseFont(id);notifyFontChange();resolve(true);};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_ROLLBACK_ABORTED'));};
            }catch(e){try{tx?.abort();}catch(_){}db.close();reject(e);}
        });
    }
    async function deleteFont(id) {
        const records = await listMetadata();
        const record = records.find(x => x.id === id);
        await remove(id);
        if (record && getSelected('ui') === record.family) setSelected('ui','');
        if (record && getSelected('story') === record.family) setSelected('story','');
    }
    return { init, all, listMetadata, getByFamily, ensureFamily, useFamily, releaseUsage, importFile, deleteFont, getSelected, setSelected, applySelected, urlFonts, addUrlFont, deleteUrlFont, exportPortable, importPortable, planPortableImport, commitPortablePlan, rollbackPortablePlan };
})();
