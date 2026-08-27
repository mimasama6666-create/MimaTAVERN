/**
 * 🎭 MIMAMAO Tavern User Input Semantic Parser
 * v1.1.7 additive sidecar.
 *
 * Goal: preserve the player's raw message in Store/UI while compiling a model-facing
 * semantic view that distinguishes speech, observable action/stage direction, and
 * private thought. Different AIRP writing habits can coexist through per-Session modes.
 */
(() => {
  'use strict';

  const MODES = new Set(['auto','dialogue_first','quote_dialogue','raw']);
  const PAIRS = new Map([
    ['（','）'], ['(',')'],
    ['“','”'], ['「','」'], ['『','』'], ['"','"']
  ]);
  const QUOTE_OPEN = new Set(['“','「','『','"']);
  const PAREN_OPEN = new Set(['（','(']);
  const THOUGHT_CUE = /(?:^|[，,。；;、\s])(?:心想|心里想|心里想着|心中想|内心想|暗想|暗自想|默想|默念|想着|想道|os|OS)\s*[：:]?\s*/;
  const ACTION_START = /^(?:我|本人)?\s*(?:走|走到|走向|跑|跑到|坐|坐下|站|站起|起身|躺|躺下|蹲|蹲下|趴|靠|靠近|凑|凑近|抬头|低头|回头|转身|转过|伸手|抬手|抬起|拿|拿起|放|放下|递|塞|藏|打开|关上|推|拉|抱|搂|亲|吻|摸|碰|握|抓|拍|踢|踩|穿|脱|吃|喝|咬|舔|笑|哭|点头|摇头|皱眉|眨眼|闭眼|睁眼|看向|望向|盯着|移开|缩|退|后退|上前|靠过去|贴近|钻进|钻到|扑|扯|掀|盖|捂|揉|蹭|挠|敲|按|坐到|躺到)/;

  function normalizeMode(value) {
    const mode = String(value || '').trim();
    return MODES.has(mode) ? mode : 'auto';
  }

  function trimSegment(value) {
    return String(value ?? '').replace(/^\s+|\s+$/g, '');
  }

  function isOnlySeparator(value) {
    return /^[\s，,。；;：:、—…·]+$/.test(String(value || ''));
  }

  function findClosing(input, start, opener) {
    const close = PAIRS.get(opener);
    if (!close) return -1;
    if (opener === '"') {
      for (let i = start + 1; i < input.length; i++) {
        if (input[i] === '"' && input[i - 1] !== '\\') return i;
      }
      return -1;
    }
    if (QUOTE_OPEN.has(opener)) return input.indexOf(close, start + 1);
    let depth = 1;
    for (let i = start + 1; i < input.length; i++) {
      if (input[i] === opener) depth += 1;
      else if (input[i] === close) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function tokenize(input) {
    const source = String(input ?? '');
    const out = [];
    let plainStart = 0;
    const pushPlain = end => {
      if (end <= plainStart) return;
      const value = source.slice(plainStart, end);
      if (value) out.push({ type: 'plain', value });
    };
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (!PAIRS.has(ch)) continue;
      const end = findClosing(source, i, ch);
      if (end < 0) continue;
      pushPlain(i);
      out.push({ type: QUOTE_OPEN.has(ch) ? 'quote' : 'paren', value: source.slice(i + 1, end), opener: ch, closer: PAIRS.get(ch) });
      i = end;
      plainStart = end + 1;
    }
    pushPlain(source.length);
    return out;
  }

  function push(out, kind, value, source = '') {
    const cleaned = trimSegment(value);
    if (!cleaned || isOnlySeparator(cleaned)) return;
    out.push({ kind, text: cleaned, source });
  }

  function splitParenthetical(value, out) {
    const cleaned = trimSegment(value);
    if (!cleaned) return;
    const match = THOUGHT_CUE.exec(cleaned);
    if (!match) {
      push(out, 'stage', cleaned, 'parenthetical');
      return;
    }
    const before = trimSegment(cleaned.slice(0, match.index)).replace(/[，,。；;、\s]+$/g, '');
    const thought = trimSegment(cleaned.slice(match.index + match[0].length));
    if (before) push(out, 'stage', before, 'parenthetical');
    if (thought) push(out, 'private_thought', thought, 'thought_cue');
    if (!before && !thought) push(out, 'stage', cleaned, 'parenthetical');
  }

  function classifyPlainAuto(value, hasExplicitQuote) {
    const cleaned = trimSegment(value).replace(/^[，,。；;：:、\s]+|[，,。；;：:、\s]+$/g, '');
    if (!cleaned) return 'speech';
    if (hasExplicitQuote) return 'action';
    if (ACTION_START.test(cleaned)) return 'action';
    return 'speech';
  }

  function parse(input, options = {}) {
    const source = String(input ?? '');
    const mode = normalizeMode(options.mode);
    if (mode === 'raw') return { mode, source, segments: [{ kind: 'raw', text: source, source: 'raw' }], hasExplicitQuote: false };

    const tokens = tokenize(source);
    const hasExplicitQuote = tokens.some(t => t.type === 'quote');
    const segments = [];

    for (const token of tokens) {
      if (token.type === 'quote') {
        push(segments, 'speech', token.value, 'explicit_quote');
        continue;
      }
      if (token.type === 'paren') {
        splitParenthetical(token.value, segments);
        continue;
      }
      let kind = 'speech';
      if (mode === 'quote_dialogue') kind = 'action';
      else if (mode === 'dialogue_first') kind = 'speech';
      else kind = classifyPlainAuto(token.value, hasExplicitQuote);
      push(segments, kind, token.value, 'plain');
    }

    if (!segments.length && source.trim()) push(segments, mode === 'quote_dialogue' ? 'action' : 'speech', source, 'fallback');
    return { mode, source, segments, hasExplicitQuote };
  }

  function modeLabel(mode) {
    const m = normalizeMode(mode);
    if (m === 'dialogue_first') return 'DIALOGUE_FIRST';
    if (m === 'quote_dialogue') return 'QUOTED_DIALOGUE';
    if (m === 'raw') return 'RAW_LEGACY';
    return 'SMART_AUTO';
  }

  function render(parsed) {
    if (!parsed || parsed.mode === 'raw') return String(parsed?.source ?? '');
    const lines = [`<PLAYER_TURN mode="${modeLabel(parsed.mode)}">`];
    for (const seg of parsed.segments || []) {
      if (seg.kind === 'speech') lines.push(`<PLAYER_SPEECH>${seg.text}</PLAYER_SPEECH>`);
      else if (seg.kind === 'action') lines.push(`<PLAYER_ACTION>${seg.text}</PLAYER_ACTION>`);
      else if (seg.kind === 'private_thought') lines.push(`<PLAYER_PRIVATE_THOUGHT>${seg.text}</PLAYER_PRIVATE_THOUGHT>`);
      else lines.push(`<PLAYER_STAGE>${seg.text}</PLAYER_STAGE>`);
    }
    lines.push('</PLAYER_TURN>');
    return lines.join('\n');
  }

  function compile(input, options = {}) {
    const parsed = parse(input, options);
    return { ...parsed, prompt: render(parsed) };
  }

  window.MimaUserInputSemanticParser = { parse, render, compile, normalizeMode, modeLabel };
})();
