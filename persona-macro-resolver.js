/**
 * 🪄 MIMAMAO Tavern Persona Macro Resolver
 * v1.1.6 additive sidecar.
 *
 * Natural-language macros only. This file never rewrites API roles, IDs, Store keys,
 * callback values, schema fields, transport metadata, or any other machine identifier.
 */
(() => {
  'use strict';

  const USER_MACRO = /\{\{\s*user\s*\}\}/gi;
  const CHAR_MACRO = /\{\{\s*char\s*\}\}/gi;

  function cleanName(value, fallback) {
    const name = String(value ?? '').replace(/\uFFFD+/g, '').trim();
    return name || fallback;
  }

  function normalizeContext(input = {}) {
    return {
      userName: cleanName(input.userName, '你'),
      charName: cleanName(input.charName, '角色')
    };
  }

  function resolve(input, context = {}) {
    const ctx = normalizeContext(context);
    return String(input ?? '')
      .replace(USER_MACRO, () => ctx.userName)
      .replace(CHAR_MACRO, () => ctx.charName);
  }

  function hasUnresolved(input) {
    const value = String(input ?? '');
    USER_MACRO.lastIndex = 0;
    CHAR_MACRO.lastIndex = 0;
    return USER_MACRO.test(value) || CHAR_MACRO.test(value);
  }

  window.MimaPersonaMacroResolver = {
    resolve,
    normalizeContext,
    hasUnresolved
  };
})();
