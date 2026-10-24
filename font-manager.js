/** 🍷 咪嘛馆本地字体库：TTF/OTF/WOFF/WOFF2 -> IndexedDB -> FontFace */
window.MimaFontManager = (() => {
    const DB_NAME = 'mimamao_tavern_assets_v1';
    const STORE = 'fonts';
    const UI_KEY = 'mimamao_tavern_ui_font';
    const STORY_KEY = 'mimamao_tavern_story_font';
    const loaded = new Map();
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
                else resolve();
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
                else resolve();
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
    async function loadRecord(record) {
        if (!record?.buffer || !window.FontFace) return false;
        if (loaded.has(record.id)) return true;
        const face = new FontFace(record.family, record.buffer);
        await face.load();
        document.fonts.add(face);
        loaded.set(record.id, face);
        return true;
    }
    async function importFile(file) {
        if (!file) throw new Error('没有选择字体文件');
        const ext = extension(file.name);
        if (!['ttf','otf','woff','woff2'].includes(ext)) throw new Error('只支持 TTF / OTF / WOFF / WOFF2');
        const buffer = await file.arrayBuffer();
        const id = `font_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const record = { id, name:file.name, family:safeFamily(file.name), format:ext, size:file.size, buffer, createdAt:new Date().toISOString() };
        await put(record);
        await loadRecord(record);
        return record;
    }
    async function init() {
        const records = await all();
        for (const record of records) {
            try { await loadRecord(record); } catch (e) { console.warn('字体加载失败', record.name, e); }
        }
        applySelected();
        return records;
    }
    function getSelected(kind) { return localStorage.getItem(kind === 'ui' ? UI_KEY : STORY_KEY) || ''; }
    function setSelected(kind, family) {
        localStorage.setItem(kind === 'ui' ? UI_KEY : STORY_KEY, family || '');
        applySelected();
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
    function applySelected() {
        urlFontStyle();
        const root = document.documentElement;
        const ui = getSelected('ui');
        const story = getSelected('story');
        // The legacy URL font is a fallback for STORY only, never a global
        // UI font and never an !important override of a selected local font.
        const legacyStory = localStorage.getItem('storyFontUrl') ? localStorage.getItem('storyFontFamily') || 'MimaUrlFont' : '';
        const storyFamily = story || legacyStory;
        root.style.setProperty('--font-ui', ui ? `'${String(ui).replace(/'/g,'')}', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
        root.style.setProperty('--font-story', storyFamily ? `'${String(storyFamily).replace(/'/g,'')}', var(--font-ui)` : 'var(--font-ui)');
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
        const records = await all();
        return records.map(r => ({
            id:r.id, name:r.name, family:r.family, format:r.format, size:r.size, createdAt:r.createdAt,
            bufferBase64: bufferToBase64(r.buffer)
        }));
    }
    async function importPortable(records, { replace=false } = {}) {
        const incoming = Array.isArray(records) ? records : [];
        if (replace) {
            const old = await all();
            for (const r of old) await remove(r.id);
            loaded.clear();
        }
        let imported = 0;
        for (const raw of incoming) {
            if (!raw?.bufferBase64) continue;
            const record = {
                id: raw.id || `font_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
                name: raw.name || `${raw.family || 'MimaFont'}.${raw.format || 'woff2'}`,
                family: raw.family || safeFamily(raw.name),
                format: raw.format || extension(raw.name) || 'woff2',
                size: Number(raw.size || 0),
                createdAt: raw.createdAt || new Date().toISOString(),
                buffer: base64ToBuffer(raw.bufferBase64)
            };
            await put(record);
            try { await loadRecord(record); } catch (e) { console.warn('导入字体后加载失败', record.name, e); }
            imported++;
        }
        applySelected();
        return imported;
    }
    // Two-phase add-only import for full-settings restores. Never overwrite a
    // pre-existing ID; the rollback owns only records it inserted. All newly
    // added fonts are written in one IDB transaction, not a per-font loop.
    async function planPortableImport(records) {
        if (!Array.isArray(records)) throw new Error('E_FONT_BACKUP_FORMAT');
        const current = await all(), existing = new Map(current.map(f => [f.id,f]));
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
            const previous=existing.get(id);
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
            }catch(e){db.close();reject(e);}
        });
        // On a load error the durable binary still exists and can be restored
        // at next initialization; this is not a canonical data failure.
        for(const record of plan.records)try{await loadRecord(record);}catch(e){console.warn('字体已保存，但暂无法加载',record.id,e);}
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
                tx.oncomplete=()=>{db.close();for(const id of receipt.added){const face=loaded.get(id);if(face){document.fonts.delete(face);loaded.delete(id);}}resolve(true);};
                tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('E_FONT_ROLLBACK_ABORTED'));};
            }catch(e){db.close();reject(e);}
        });
    }
    async function deleteFont(id) {
        const records = await all();
        const record = records.find(x => x.id === id);
        await remove(id);
        const face = loaded.get(id);
        if (face) { try { document.fonts.delete(face); } catch (_) {} loaded.delete(id); }
        if (record && getSelected('ui') === record.family) setSelected('ui','');
        if (record && getSelected('story') === record.family) setSelected('story','');
    }
    return { init, all, importFile, deleteFont, getSelected, setSelected, applySelected, urlFonts, addUrlFont, deleteUrlFont, exportPortable, importPortable, planPortableImport, commitPortablePlan, rollbackPortablePlan };
})();
