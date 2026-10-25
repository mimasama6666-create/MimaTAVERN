/**
 * 🧬 MIMAMAO Tavern Regex Engine
 * Additive sidecar: safe JavaScript RegExp replacement only. No eval / no executable code.
 */
(() => {
  'use strict';

  const PHASES = new Set(['display','prompt','input','output']);
  const FLAG_ORDER = ['d','g','i','m','s','u','v','y'];
  const nowIso = () => new Date().toISOString();
  const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  const arr = v => Array.isArray(v) ? v : [];
  const text = v => String(v ?? '');

  function normalizeFlags(value='g') {
    const raw = String(value || 'g').toLowerCase();
    const unique = [...new Set(raw.split('').filter(ch => FLAG_ORDER.includes(ch)))];
    return FLAG_ORDER.filter(ch => unique.includes(ch)).join('') || 'g';
  }

  function normalizeRule(rule={}) {
    return {
      id: rule.id || makeId('regexrule'),
      name: String(rule.name || '未命名规则').trim() || '未命名规则',
      pattern: text(rule.pattern),
      replacement: text(rule.replacement),
      flags: normalizeFlags(rule.flags),
      phase: PHASES.has(rule.phase) ? rule.phase : 'display',
      priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 50,
      enabled: rule.enabled !== false,
      description: String(rule.description || '').trim()
    };
  }

  function normalizePack(pack={}) {
    const createdAt = pack.createdAt || nowIso();
    return {
      id: pack.id || makeId('regexp'),
      name: String(pack.name || '未命名正则包').trim() || '未命名正则包',
      description: String(pack.description || '').trim(),
      priority: Number.isFinite(Number(pack.priority)) ? Number(pack.priority) : 50,
      enabled: pack.enabled !== false,
      rules: arr(pack.rules).map(normalizeRule),
      createdAt,
      updatedAt: pack.updatedAt || createdAt
    };
  }

  function compileRule(rule) {
    const r = normalizeRule(rule);
    if (!r.pattern) return { ok:false, rule:r, error:'pattern 为空' };
    try { return { ok:true, rule:r, regex:new RegExp(r.pattern,r.flags) }; }
    catch (e) { return { ok:false, rule:r, error:e?.message || String(e) }; }
  }

  function validatePack(pack) {
    const normalized = normalizePack(pack);
    const invalid = [];
    normalized.rules.forEach((rule,index) => {
      const result = compileRule(rule);
      if (!result.ok) invalid.push({ index, id:rule.id, name:rule.name, error:result.error });
    });
    return { ok:invalid.length===0, pack:normalized, invalid };
  }

  function applicable(packs,phase){return arr(packs).some(p=>p&&p.enabled!==false&&arr(p.rules).some(r=>r&&r.enabled!==false&&r.phase===phase));}
  // Synchronous evaluation is forbidden for user-supplied expressions: a
  // RegExp has no built-in deadline and can freeze the UI before a timer fires.
  function apply(input,packs=[],phase='display',diagnostics=null) {
    if(applicable(packs,phase)){
      const e=new Error('原生正则需要隔离执行；请使用 applyAsync（原文未修改）');e.code='E_REGEX_ASYNC_REQUIRED';throw e;
    }
    return text(input);
  }
  function applyBatchAsync(entries,packs=[],options={}){
    const list=arr(entries).map(e=>({input:text(e.input),phase:e.phase||'display'}));
    if(!list.length)return Promise.resolve([]);
    if(!list.some(e=>applicable(packs,e.phase)))return Promise.resolve(list.map(e=>({output:e.input,diagnostics:[]})));
    if(typeof Worker!=='function')return Promise.reject(Object.assign(new Error('此环境没有可终止的正则 Worker，原文保留'),{code:'E_REGEX_ISOLATION_UNAVAILABLE'}));
    if(window.location?.protocol==='file:')return Promise.reject(Object.assign(new Error('file:// 不允许加载隔离 Worker，请使用 HTTPS 打开咪嘛馆；原文保留'),{code:'E_REGEX_WORKER_ORIGIN'}));
    const budgetMs=Math.max(100,Math.min(8000,Number(options.budgetMs)||Math.min(5000,900+list.length*12)));
    return new Promise((resolve,reject)=>{
      let worker,timer,finished=false;
      const failure=(code,message)=>Object.assign(new Error(message),{code});
      const cleanup=()=>{if(finished)return false;finished=true;clearTimeout(timer);options.signal?.removeEventListener?.('abort',abort);worker?.terminate();return true;};
      const abort=()=>{if(cleanup())reject(failure('E_REGEX_ABORTED','正则操作已取消；原文保留'));};
      try{worker=new Worker(new URL('./regex-native-worker.js?native=20261025-r3',document.baseURI),{name:'mima-native-regex'});}
      catch(e){reject(failure('E_REGEX_ISOLATION_UNAVAILABLE','正则隔离启动失败：'+(e?.message||e)));return;}
      worker.onmessage=event=>{if(!cleanup())return;const packet=event.data;if(packet?.ok)resolve(packet.results);else reject(failure('E_REGEX_WORKER_FAILED',packet?.error||'正则线程执行失败'));};
      worker.onerror=event=>{if(cleanup())reject(failure('E_REGEX_WORKER_FAILED','正则隔离线程异常：'+(event?.message||'未知错误')));};
      timer=setTimeout(()=>{if(cleanup())reject(failure('E_REGEX_BUDGET',`正则执行超过 ${budgetMs} 毫秒；已终止线程，原文完整保留`));},budgetMs);
      if(options.signal?.aborted){abort();return;}
      options.signal?.addEventListener?.('abort',abort,{once:true});
      try{worker.postMessage({entries:list,packs});}catch(e){if(cleanup())reject(failure('E_REGEX_WORKER_FAILED','正则线程无法接收规则：'+e.message));}
    });
  }
  async function applyAsync(input,packs=[],phase='display',diagnostics=null,options={}){
    const [result]=await applyBatchAsync([{input,phase}],packs,options);
    if(Array.isArray(diagnostics))diagnostics.push(...result.diagnostics);
    return result.output;
  }
  window.MimaRegexEngine = { PHASES:[...PHASES], normalizeFlags, normalizeRule, normalizePack, compileRule, validatePack, apply, applyAsync, applyBatchAsync };
})();
