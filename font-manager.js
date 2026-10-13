/** 🍷 咪嘛馆本地字体库：TTF/OTF/WOFF/WOFF2 -> IndexedDB -> FontFace */
window.MimaFontManager = (() => {
    const DB_NAME = 'mimamao_tavern_assets_v1';
    const STORE = 'fonts';
    const UI_KEY = 'mimamao_tavern_ui_font';
    const STORY_KEY = 'mimamao_tavern_story_font';
    const loaded = new Map();

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
    function applySelected() {
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
    async function deleteFont(id) {
        const records = await all();
        const record = records.find(x => x.id === id);
        await remove(id);
        const face = loaded.get(id);
        if (face) { try { document.fonts.delete(face); } catch (_) {} loaded.delete(id); }
        if (record && getSelected('ui') === record.family) setSelected('ui','');
        if (record && getSelected('story') === record.family) setSelected('story','');
    }
    return { init, all, importFile, deleteFont, getSelected, setSelected, applySelected, exportPortable, importPortable };
})();
