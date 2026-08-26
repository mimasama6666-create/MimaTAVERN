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

  function apply(input,packs=[],phase='display',diagnostics=null) {
    let out = text(input);
    const sortedPacks = arr(packs).filter(p=>p&&p.enabled!==false).slice().sort((a,b)=>Number(a.priority||50)-Number(b.priority||50));
    for (const rawPack of sortedPacks) {
      const pack = normalizePack(rawPack);
      const rules = pack.rules.filter(r=>r.enabled!==false && r.phase===phase).slice().sort((a,b)=>Number(a.priority||50)-Number(b.priority||50));
      for (const rule of rules) {
        const compiled = compileRule(rule);
        if (!compiled.ok) {
          if (Array.isArray(diagnostics)) diagnostics.push({ packId:pack.id, packName:pack.name, ruleId:rule.id, ruleName:rule.name, error:compiled.error });
          continue;
        }
        try { out = out.replace(compiled.regex, rule.replacement); }
        catch (e) {
          if (Array.isArray(diagnostics)) diagnostics.push({ packId:pack.id, packName:pack.name, ruleId:rule.id, ruleName:rule.name, error:e?.message||String(e) });
        }
      }
    }
    return out;
  }

  window.MimaRegexEngine = { PHASES:[...PHASES], normalizeFlags, normalizeRule, normalizePack, compileRule, validatePack, apply };
})();
