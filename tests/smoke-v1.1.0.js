/**
 * MIMAMAO Tavern v1.1.0 additive smoke test.
 * Run from anywhere: node tests/smoke-v1.1.0.js
 * No external dependencies.
 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

global.window = global;
const local = new Map();
global.localStorage = {
  getItem: key => local.has(key) ? local.get(key) : null,
  setItem: (key, value) => local.set(key, String(value)),
  removeItem: key => local.delete(key)
};
let storedState = null;
global.MimaLocalStore = {
  async loadState() {
    // Deliberately start from the pre-v1.1 schema to verify additive migration.
    return storedState || { schemaVersion:2, sessions:[], masks:[], presets:[], worldbooks:[], cssPresets:[] };
  },
  async saveState(value) {
    storedState = JSON.parse(JSON.stringify(value));
    return storedState;
  }
};

require(path.join(ROOT, 'regex-engine.js'));
require(path.join(ROOT, 'standalone-core.js'));

(async () => {
  await MimaStandalone.init();

  let result = await MimaStandalone.handle('/sessions', 'POST', { title:'v1.1 smoke' });
  assert(result.success, 'session create failed');
  const sessionId = result.data.id;

  result = await MimaStandalone.handle('/regex-packs', 'POST', {
    name:'Compact status demo',
    priority:10,
    rules:[{
      name:'Expand compact status',
      phase:'display',
      pattern:'<ST>(.*?)\\|(.*?)<\\/ST>',
      flags:'gs',
      replacement:'<system><div>$1</div><span>$2</span></system>'
    }]
  });
  assert(result.success, 'regex pack save failed');
  const regexId = result.data.id;

  result = await MimaStandalone.handle(`/sessions/${sessionId}`, 'PATCH', {
    regexPackIds:[regexId],
    renderMode:'safe_html'
  });
  assert(result.success, 'regex mount failed');

  assert.strictEqual(
    MimaStandalone.applyRegexForSession(sessionId, 'X<ST>A|B</ST>Y', 'display'),
    'X<system><div>A</div><span>B</span></system>Y',
    'display regex did not expand compact protocol'
  );

  result = await MimaStandalone.handle(`/sessions/${sessionId}/opening`, 'POST', {content:'<ST>A|B</ST>'});
  assert(result.success, 'compact assistant message save failed');
  const prompt = MimaStandalone.assemble(result.data).messages;
  assert(prompt.some(m=>m.role==='assistant' && m.content==='<ST>A|B</ST>'), 'display regex leaked expanded HTML back into prompt');
  assert(!prompt.some(m=>String(m.content).includes('<system><div>A</div>')), 'expanded display HTML should not consume prompt tokens');

  const invalid = await MimaStandalone.handle('/regex-packs', 'POST', {name:'bad',rules:[{pattern:'(',replacement:'x',phase:'display'}]});
  assert.strictEqual(invalid.success, false, 'invalid regex should fail closed at save time');

  const library = await MimaStandalone.exportLibrary();
  assert.strictEqual(library.schemaVersion, 3, 'schema did not migrate additively to v3');
  assert.strictEqual(library.regexPacks.length, 1, 'regex pack not persisted');
  assert.strictEqual(library.sessions[0].regexPackIds[0], regexId, 'session mount not persisted');

  const encoder = new TextEncoder();
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  }), { status:200, headers:{'content-type':'text/event-stream'} });

  const progress = [];
  const reply = await MimaStandalone.callModelWithConfig(
    [{role:'user',content:'ping'}],
    {apiBase:'https://example.invalid/v1',apiKey:'test',model:'mock',stream:true,sendTemperature:true},
    0.3,
    null,
    {streamOverride:true,onProgress:p=>progress.push(p)}
  );
  assert.strictEqual(reply, '你好', 'stream reply assembly failed');
  assert(progress.some(p=>p.streamText==='你'), 'first visible stream chunk missing');
  assert(progress.some(p=>p.streamText==='你好'), 'accumulated visible stream text missing');

  // Exercise the real story route rather than only the low-level API helper.
  MimaStandalone.saveApiConfig({apiBase:'https://example.invalid/v1',apiKey:'test',model:'mock',stream:true,sendTemperature:true});
  const storyProgress=[];
  const storyResult=await MimaStandalone.handle(`/sessions/${sessionId}/chat`,'POST',{text:'第一行\n第二行',action:'send',temperature:0.3},null,p=>storyProgress.push(p));
  assert(storyResult.success, 'real story streaming route failed');
  const lastTwo=storyResult.data.messages.slice(-2);
  assert.strictEqual(lastTwo[0].role,'user');
  assert.strictEqual(lastTwo[0].rawContent,'第一行\n第二行','multiline user input was not preserved');
  assert.strictEqual(lastTwo[1].role,'assistant');
  assert.strictEqual(lastTwo[1].content,'你好');
  assert(storyProgress.some(p=>p.streamText==='你') && storyProgress.some(p=>p.streamText==='你好'),'story route did not forward live stream text');

  console.log('PASS v1.1.0: migration + regex fail-closed/token-saving + multiline story input + real SSE story streaming');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
