/**
 * 🎭 MIMAMAO Tavern User Input Semantic Parser
 * v1.1.8; V5 original classification + V8 linear matching and markup escaping.
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
    return MODES.has(mode) ? mode : 'raw';
  }

  function trimSegment(value) {
    return String(value ?? '').replace(/^\s+|\s+$/g, '');
  }

  function isOnlySeparator(value) {
    return /^[\s，,。；;：:、—…·]+$/.test(String(value || ''));
  }

  // Precompute paired delimiters once. Re-scanning the remaining source for
  // every unmatched opener was quadratic on long HTML/code inputs.
  function closingIndices(source) {
    const matches=new Int32Array(source.length);
    matches.fill(-1);
    for(const [open,close] of PAIRS) {
      if(open==='"') {
        let next=-1;
        for(let i=source.length-1;i>=0;i--)if(source[i]==='"'){
          matches[i]=next;
          if(i===0||source[i-1]!=='\\')next=i;
        }
      } else if(PAREN_OPEN.has(open)) {
        const stack=[];
        for(let i=source.length-1;i>=0;i--) {
          if(source[i]===close)stack.push(i);
          else if(source[i]===open&&stack.length)matches[i]=stack.pop();
        }
      } else {
        let next=-1;
        for(let i=source.length-1;i>=0;i--) {
          if(source[i]===close)next=i;
          else if(source[i]===open)matches[i]=next;
        }
      }
    }
    return matches;
  }

  function tokenize(input) {
    const source = String(input ?? '');
    const out = [];
    const matchAt = closingIndices(source);
    let plainStart = 0;
    const pushPlain = end => {
      if (end <= plainStart) return;
      const value = source.slice(plainStart, end);
      if (value) out.push({ type: 'plain', value });
    };
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (!PAIRS.has(ch)) continue;
      const end = matchAt[i];
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

  function escapeMarkup(value) {return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function render(parsed) {
    if (!parsed || parsed.mode === 'raw') return String(parsed?.source ?? '');
    const lines = [`<PLAYER_TURN mode="${modeLabel(parsed.mode)}">`];
    for (const seg of parsed.segments || []) {
      if (seg.kind === 'speech') lines.push(`<PLAYER_SPEECH>${escapeMarkup(seg.text)}</PLAYER_SPEECH>`);
      else if (seg.kind === 'action') lines.push(`<PLAYER_ACTION>${escapeMarkup(seg.text)}</PLAYER_ACTION>`);
      else if (seg.kind === 'private_thought') lines.push(`<PLAYER_PRIVATE_THOUGHT>${escapeMarkup(seg.text)}</PLAYER_PRIVATE_THOUGHT>`);
      else lines.push(`<PLAYER_STAGE>${escapeMarkup(seg.text)}</PLAYER_STAGE>`);
    }
    lines.push('</PLAYER_TURN>');
    return lines.join('\n');
  }

  function compile(input, options = {}) {
    const parsed = parse(input, options);
    return { ...parsed, prompt: render(parsed) };
  }

  const PARSER_VERSION = '1.1.8-v5-classification-escaped';
  window.MimaUserInputSemanticParser = { parse, render, compile, normalizeMode, modeLabel, version: PARSER_VERSION };
})();
