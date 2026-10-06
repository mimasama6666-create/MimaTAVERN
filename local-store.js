/**
 * 🍷 咪嘛馆 Standalone 本地数据库
 * 所有剧情/角色卡/世界书/预设/小说项目仅保存在当前浏览器 IndexedDB。
 */
(() => {
  const DB_NAME = 'mimamao_tavern_standalone';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const STATE_KEY = 'state';
  const SETTINGS_SNAPSHOT_KEY = 'settings_snapshot_v1';
  const EMPTY_THEME = { theme: 'default', updatedAt: '' };

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function get(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function set(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function loadState() {
    const existing = await get(STATE_KEY);
    if (existing && typeof existing === 'object') return existing;
    const blank = {schemaVersion:4,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{...EMPTY_THEME}};
    await set(STATE_KEY, blank);
    return blank;
  }
  async function saveState(state) {
    return set(STATE_KEY, {
      ...state,
      schemaVersion:4,
      cssPresets:Array.isArray(state.cssPresets)?state.cssPresets:[],
      regexPacks:Array.isArray(state.regexPacks)?state.regexPacks:[],
      novelProjects:Array.isArray(state.novelProjects)?state.novelProjects:[],
      themeSettings:state.themeSettings&&typeof state.themeSettings==='object'?state.themeSettings:{...EMPTY_THEME},
      savedAt:new Date().toISOString()
    });
  }
  async function exportAll(){ return loadState(); }
  async function importAll(raw){
    const src=raw?.data||raw||{};
    const next={
      schemaVersion:4,
      sessions:Array.isArray(src.sessions)?src.sessions:[],
      masks:Array.isArray(src.masks)?src.masks:[],
      presets:Array.isArray(src.presets)?src.presets:[],
      worldbooks:Array.isArray(src.worldbooks)?src.worldbooks:[],
      cssPresets:Array.isArray(src.cssPresets)?src.cssPresets:[],
      regexPacks:Array.isArray(src.regexPacks)?src.regexPacks:[],
      novelProjects:Array.isArray(src.novelProjects)?src.novelProjects:[],
      themeSettings:src.themeSettings&&typeof src.themeSettings==='object'?src.themeSettings:{...EMPTY_THEME}
    };
    await saveState(next); return next;
  }
  async function saveSettingsSnapshot(snapshot){ return set(SETTINGS_SNAPSHOT_KEY,{...(snapshot||{}),savedAt:new Date().toISOString()}); }
  async function loadSettingsSnapshot(){ const existing=await get(SETTINGS_SNAPSHOT_KEY); return existing&&typeof existing==='object'?existing:null; }
  async function clearSettingsSnapshot(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(SETTINGS_SNAPSHOT_KEY);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();reject(tx.error)}});
  }
  window.MimaLocalStore={loadState,saveState,exportAll,importAll,saveSettingsSnapshot,loadSettingsSnapshot,clearSettingsSnapshot};
})();
