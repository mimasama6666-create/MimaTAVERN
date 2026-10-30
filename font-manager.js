/** 🍷 咪嘛馆本地字体库：TTF/OTF/WOFF/WOFF2 -> IndexedDB -> FontFace */
window.MimaFontManager = (() => {
    const DB_NAME = 'mimamao_tavern_assets_v1';
    const STORE = 'fonts';
    const UI_KEY = 'mimamao_tavern_ui_font';
    const STORY_KEY = 'mimamao_tavern_story_font';
    // UI, story, visible readers and one explicit preview own loaded faces.
    // Only selected/visible sources are decoded; stored records remain untouched.
    const loaded = new Map();
    const usages = new Map();
    // The font picker only needs metadata. Keep the initial verified font list's
    // metadata in memory instead of cloning every multi-MB ArrayBuffer on each visit.
    let metadataCache = null;
    let metadataRead = null, registryRead = null, fontRevision = 0, initialized = false;
    let previewFamily='', previewApplied='', previewEpoch=0;
    const applied={ui:'',story:''}, selectionEpoch={ui:0,story:0}, selectionWrites={ui:0,story:0}, pendingFonts=new Map();
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
        if(event.data!=='changed')return;
        metadataCache=null;fontRevision++;
        // Other tabs can replace the binary under an existing ID. Reconcile
        // only after a verified read, keeping the last working view on error.
        if(initialized)init(true).catch(e=>console.warn('字体库同步失败，原字体保留',e));
    };
    const notifyFontChange = () => { metadataCache=null;fontRevision++;try{fontChanges?.postMessage('changed');}catch(_){} };
    const metadataOf = ({id,name,family,format,size,createdAt,sourceUrlFontId,sourceUrl}) => ({
        id,name,family,format,size,createdAt,
        ...(sourceUrlFontId?{sourceUrlFontId,sourceUrl}:{} )
    });
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
        window.MimaPerfDiagnostics?.detail('font_idb_metadata');
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
    async function put(record, {addOnly=false}={}) {
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
                tx.objectStore(STORE)[addOnly?'add':'put'](record);
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
    function releaseFont(id) {const entry=loaded.get(id);if(entry){loaded.delete(id);disposeFont(entry);}}
    function makeFont(record) {
        if (!record?.buffer || !window.FontFace) return false;
        // The pre-CSS-optimization iOS path: register a CSS URL-backed face and
        // let the browser start loading when the selected family is rendered.
        // Creating a native ArrayBuffer face and awaiting load() before keeping
        // it registered was introduced with the crash optimization and breaks
        // the previous registration guarantee when decoding rejects or stalls.
        const url=URL.createObjectURL(new Blob([record.buffer]));
        try { return {face:new FontFace(record.family,`url("${url}")`,{display:'swap'}),url,revision:fontRevision}; }
        catch(error){URL.revokeObjectURL(url);throw error;}
    }
    function reportRegisteredFace(entry,state,error='') {
        // An older async callback cannot change the status of a replacement.
        if(loaded.get(entry.id)!==entry)return;
        for(const kind of ['ui','story']) {
            if(getSelected(kind)===entry.face.family && applied[kind]===entry.face.family)
                reportLoad(kind,entry.face.family,state,error);
        }
    }
    function attachFont(id,entry) {
        // Commit the new registered face before retiring a previous copy.
        // Keep the Blob URL alive while WebKit may still need to fetch it.
        document.fonts.add(entry.face);
        releaseFont(id);
        for(const [otherId,other] of loaded)
            if(other.face.family===entry.face.family)releaseFont(otherId);
        entry.id=id;
        loaded.set(id,entry);
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
            entry.state='loaded';mark?.detail('font_face_load_success');
            reportRegisteredFace(entry,'loaded');
        },error=>{
            entry.state='error';mark?.detail('font_face_load_error');
            reportRegisteredFace(entry,'error',error);
        }).finally(()=>{
            entry.loadPending=false;
            if(entry.retired)disposeFont(entry);
            else trimFonts();
        });
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
        disposeFont(entry); // No permanent face for unselected imports.
        // Replacing/importing a name already selected must restore its visible face
        // after the database revision invalidated the previous registration.
        if(getSelected('ui')===record.family||getSelected('story')===record.family)
            await applySelected().catch(error=>console.warn('字体已保存，但选中字体重新挂载失败',error));
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
        const keep=new Set([getSelected('ui'),getSelected('story'),applied.ui,applied.story,
            previewFamily,previewApplied,extra,
            ...Array.from(usages.values(),x=>x.requested),
            ...Array.from(usages.values(),x=>x.applied)].filter(Boolean));
        for(const [id,entry] of loaded)if(!keep.has(entry.face.family)) {
            // A detached visible preview still has an in-flight native load.
            // Keep it reusable so reopening settings cannot decode that same
            // large file again while the first decoder is still running.
            if(entry.loadPending)entry.retireWhenIdle=true;
            else releaseFont(id);
        }
    }
    function wantedFamily(family) {
        return [previewFamily,previewApplied,getSelected('ui'),getSelected('story'),applied.ui,applied.story,
            ...Array.from(usages.values(),x=>x.requested),...Array.from(usages.values(),x=>x.applied)].includes(family);
    }
    function acquireFamily(family) {
        if(!family)return Promise.resolve(null);
        const key=fontRevision+':'+family;
        if(pendingFonts.has(key))return pendingFonts.get(key);
        const task=(async()=>{
            if(!wantedFamily(family))return null;
            const metadata=newestFamilyRecord(await listMetadata(),family);
            if(!metadata)return null; // A URL/CSS/system family has no local binary.
            const current=loaded.get(metadata.id);
            if(current?.revision===fontRevision && current.state!=='error'){current.retireWhenIdle=false;return current.face;}
            const revision=fontRevision,record=await readFontById(metadata.id);
            if(!record?.buffer)throw new Error('所选字体的本地文件不存在');
            const entry=makeFont(record);if(!entry)throw new Error('当前浏览器无法加载本地字体');
            try {
                if(revision!==fontRevision || !wantedFamily(family)){
                    disposeFont(entry);return null;
                }
                // Preserve the proven pre-optimization behavior: the selected
                // FontFace stays in document.fonts immediately, *without*
                // gating registration on load()/decode. Safari can resolve it
                // using normal CSS matching as soon as the browser renders.
                attachFont(record.id,entry);
                trimFonts(family);
                return entry.face;
            }catch(error){disposeFont(entry);throw error;}
        })();
        pendingFonts.set(key,task);
        task.finally(()=>{if(pendingFonts.get(key)===task)pendingFonts.delete(key);}).catch(()=>{});
        return task;
    }
    // One explicit picker preview, plus the two currently applied choices.
    async function ensureFamily(family) {
        const requested=previewFamily=String(family||''),epoch=++previewEpoch;
        const face=await acquireFamily(requested);
        if(face)await face.load();
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
    function setSelected(kind, family) {
        kind=kind==='ui'?'ui':'story';const key=kind==='ui'?UI_KEY:STORY_KEY;
        const requested=String(family||''),write=++selectionWrites[kind];
        localStorage.setItem(key,requested);
        const task=applySelected(kind).catch(error=>{
            // Another pending request is not a verified fallback. Roll back to
            // the family whose decoded face/CSS was actually committed.
            if(selectionWrites[kind]===write&&getSelected(kind)===requested){
                localStorage.setItem(key,applied[kind]);
                // Remove a failed network face and restore the last effective CSS.
                urlFontStyle();setFontCss(kind,applied[kind]);
            }
            throw error;
        });
        // Legacy callers need not await; explicit callers can observe failure.
        // The legacy single-URL fallback is owned by app.js. Notify it after
        // success/rollback so an unused old CSS @import can be detached.
        task.finally(()=>{try{window.dispatchEvent(new Event('mima-font-selection-change'));}catch(_){}}).catch(()=>{});
        task.catch(error=>console.warn('字体切换失败，保留上次有效字体',error));return task;
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
        const fonts=urlFonts();if(fonts.length>=100)throw Error('链接字体库最多保存 100 个');
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
        const records=urlFonts(),index=records.findIndex(f=>f.id===id&&f.css===true);
        if(index<0)return false;
        const value=enabled===true;
        if(records[index].compatAlwaysLoad===value)return true;
        records[index]={...records[index],compatAlwaysLoad:value};
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify(records));
        urlFontStyle();return true;
    }
    function deleteUrlFont(id){
        const records=urlFonts(),found=records.find(x=>x.id===id);
        if(!found)return false;
        localStorage.setItem(URL_LIBRARY_KEY,JSON.stringify(records.filter(x=>x.id!==id)));
        if(getSelected('ui')===found.family)setSelected('ui','');
        if(getSelected('story')===found.family)setSelected('story','');
        urlFontStyle();applySelected();return true;
    }
    function setFontCss(kind,family) {
        const root=document.documentElement;
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
            const epoch=++selectionEpoch[kind],family=getSelected(kind),previous=applied[kind];
            // This CSS assignment must NOT wait for the IndexedDB read or
            // FontFace.load(). Previously an unresolved/rejected load left the
            // entire page on its default font, even when selection was saved.
            setFontCss(kind,family);
            reportLoad(kind,family,family?'loading':'default');
            try {
                const face=await acquireFamily(family);
                const external=family && !face && urlFonts().some(f=>f.family===family);
                if(external)await loadExternalFamily(family);
                if(epoch!==selectionEpoch[kind]||family!==getSelected(kind)){trimFonts();return;}
                applied[kind]=family;
                // The local registry cannot validate URL fonts. Report loaded
                // only after the browser's FontFaceSet actually loaded them.
                reportLoad(kind,family,external?'loaded':face?(face.status==='loaded'?'loaded':(face.status==='error'?'error':'registered')):(family?'external':'default'));
                if(face?.status==='error')reportLoad(kind,family,'error','浏览器未能解码此字体，原记录仍保留');
                trimFonts();
            } catch(error) {
                // Only the request that still owns the selection may roll back
                // its CSS. An older failure must not overwrite a newer choice.
                if(epoch===selectionEpoch[kind]&&family===getSelected(kind)){
                    setFontCss(kind,previous);
                    reportLoad(kind,family,'error',error);
                }
                throw error;
            }
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
                        records.push({id:r.id,name:r.name,family:r.family,format:r.format,size:r.size,createdAt:r.createdAt,sourceUrlFontId:r.sourceUrlFontId,sourceUrl:r.sourceUrl,bufferBase64:bufferToBase64(r.buffer)});
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
                ...(raw.sourceUrlFontId?{sourceUrlFontId:String(raw.sourceUrlFontId),sourceUrl:String(raw.sourceUrl||'')}:{}),
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
        window.MimaPerfDiagnostics?.detail('font_idb_binary');
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
            const record = {id,name:String(raw.name||'imported.'+format),family:String(raw.family||safeFamily(raw.name)),format,size:buffer.byteLength,createdAt:raw.createdAt||new Date().toISOString(),
                ...(raw.sourceUrlFontId?{sourceUrlFontId:String(raw.sourceUrlFontId),sourceUrl:String(raw.sourceUrl||'')}:{}),buffer};
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
    function runtimeMetrics(){
        const entries=Array.from(loaded.values());
        return {registered:entries.length,nativeLoadPending:entries.filter(x=>x.loadPending).length,
            unusedPending:entries.filter(x=>x.loadPending&&x.retireWhenIdle).length,
            binaryReadPending:pendingFonts.size,activePreviewOwners:usages.size,
            activeCssLinks:activeCssLinks.size};
    }
    return { runtimeMetrics, init, all, listMetadata, getByFamily, ensureFamily, useFamily, releaseUsage, importFile, cacheUrlFont, deleteFont, getSelected, getLoadStatus, setSelected, applySelected, urlFonts, refreshUrlFontUsage:urlFontStyle, fontReferencedByAppearance, setUrlFontCompatibility, addUrlFont, addUrlFontsBatch, deleteUrlFont, exportPortable, importPortable, planPortableImport, commitPortablePlan, rollbackPortablePlan };
})();
