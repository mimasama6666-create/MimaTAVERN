/** MIMAMAO Tavern v1.1.4 Assistant Self-Healing / scroll / cache-observability smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const assistant=fs.readFileSync(path.join(ROOT,'assistant-studio.js'),'utf8');
const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const core=fs.readFileSync(path.join(ROOT,'standalone-core.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

assert(assistant.includes('repairLooseArtifactJson'),'safe loose artifact repair path missing');
assert(assistant.includes('quoteBareJsonKeys'),'bare JSON property self-heal missing');
assert(assistant.includes('convertSingleQuotedJsonStrings'),'single-quoted JSON self-heal missing');
assert(assistant.includes('🩹 修复此工件'),'artifact repair action missing');
assert(assistant.includes('repairArtifact(index)'),'syntax-only repair workflow missing');
assert(!/\beval\s*\(/.test(assistant),'artifact repair must never eval model output');
assert(!/new\s+Function\s*\(/.test(assistant),'artifact repair must never execute Function(model output)');
assert(assistant.includes('assistantFollowTail'),'assistant streaming read-pause state missing');
assert(assistant.includes('↓ 跟随输出'),'assistant resume-follow control missing');
assert(css.includes('v1.1.4 · ASSISTANT STUDIO COMPACT'),'assistant compact override missing');
assert(css.includes('.assistant-studio-root.assistant-config-open .assistant-sidebar'),'expanded mobile model panel scroll override missing');
assert(css.includes('-webkit-overflow-scrolling:touch'),'iOS momentum scrolling support missing');
assert(app.includes('liveStreamState.followTail'),'story streaming follow-tail guard missing');
assert(app.includes('resumeStoryStreamFollow'),'story resume-follow action missing');
assert(app.includes('preserveReading'),'story final render must preserve reading position after stream');
assert(html.includes('id="story-follow-stream"'),'story follow button missing');
assert(core.includes('extractUsageMetrics'),'upstream usage parser missing');
assert(core.includes('getLastUsage'),'cache observability getter missing');
assert(core.includes('estimatedInputTokens'),'prompt inspector input estimate missing');
assert(html.includes('release=1.1.4'),'v1.1.4 cache-bust marker missing');

// Assistant parser self-healing tests.
global.window=global;
const local=new Map();
global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
global.requestAnimationFrame=fn=>fn();
global.confirm=()=>true;
global.toast=()=>{};
require(path.join(ROOT,'assistant-studio.js'));

let parsed=MimaAssistantStudio.inspectArtifact(`<MIMA_ARTIFACT>{kind:"preset",preset:{name:"P",content:"x"}}</MIMA_ARTIFACT>`);
assert(parsed.artifact&&parsed.artifact.kind==='preset','bare object keys should self-heal safely');
assert.strictEqual(parsed.repairLevel,'self_heal','bare-key repair should report self_heal');
parsed=MimaAssistantStudio.inspectArtifact(`<MIMA_ARTIFACT>{kind:'regex_bundle',preset:{name:'P',content:'short'},regexPack:{name:'R',rules:[{name:'r',pattern:'\\s+',replacement:'<div class="x">$1</div>',flags:'g',phase:'display'}]},}</MIMA_ARTIFACT>`);
assert(parsed.artifact&&parsed.artifact.regexPack.rules[0].pattern==='\\s+','single quotes / regex slash repair changed semantic content');

// Re-load core in isolated state for prompt pruning + usage telemetry.
delete require.cache[require.resolve(path.join(ROOT,'standalone-core.js'))];
let stored={schemaVersion:3,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[]};
global.MimaLocalStore={async loadState(){return JSON.parse(JSON.stringify(stored))},async saveState(v){stored=JSON.parse(JSON.stringify(v));return stored}};
global.MimaRegexEngine={apply:(text)=>String(text),normalizePack:p=>p,validatePack:p=>({ok:true,pack:p,invalid:[]})};
require(path.join(ROOT,'standalone-core.js'));

(async()=>{
  await MimaStandalone.init();
  const created=await MimaStandalone.handle('/sessions','POST',{title:'v114 cache test',promptSettings:{recentMessageLimit:6,worldbookBudgetChars:2000}});
  assert(created.success,'session create failed');
  const id=created.data.id;
  // Build enough history to verify only recent window is sent, not whole archive.
  let session=created.data;
  session.messages=Array.from({length:20},(_,i)=>({id:`m${i}`,role:i%2?'assistant':'user',content:`turn-${i}`,time:new Date().toISOString()}));
  await MimaStandalone.handle(`/sessions/${id}`,'PATCH',session);
  const got=await MimaStandalone.handle(`/sessions/${id}`,'GET');
  const inspector=MimaStandalone.assemble(got.data).inspector;
  assert.strictEqual(inspector.recentMessageCount,6,'assembler must preserve recent-message pruning');
  assert(inspector.estimatedInputTokens>0,'input token estimate should be exposed');
  assert(inspector.finalMessageCount<=7,'whole message archive leaked into request');

  localStorage.setItem('MIMAMAO_TAVERN_STANDALONE_API_V1',JSON.stringify({apiBase:'https://example.invalid/v1',apiKey:'x',model:'gemini-3.1-pro-preview'}));
  global.fetch=async()=>new Response(JSON.stringify({
    choices:[{message:{content:'ok'}}],
    usage:{prompt_tokens:12000,completion_tokens:80,total_tokens:12080,prompt_tokens_details:{cached_tokens:9000}}
  }),{status:200,headers:{'content-type':'application/json'}});
  const reply=await MimaStandalone.callModelWithConfig([{role:'user',content:'hello'}],MimaStandalone.getApiConfig(),0.3,null,{streamOverride:false});
  assert.strictEqual(reply,'ok','model reply parse failed');
  const usage=MimaStandalone.getLastUsage();
  assert.strictEqual(usage.cachedTokens,9000,'OpenAI-compatible cached token usage not observed');
  assert.strictEqual(usage.inputTokens,12000,'input usage not observed');

  global.fetch=async()=>new Response(JSON.stringify({
    choices:[{message:{content:'native-ish'}}],
    usageMetadata:{promptTokenCount:7000,candidatesTokenCount:50,totalTokenCount:7050,cachedContentTokenCount:4096}
  }),{status:200,headers:{'content-type':'application/json'}});
  await MimaStandalone.callModelWithConfig([{role:'user',content:'hello2'}],MimaStandalone.getApiConfig(),0.3,null,{streamOverride:false});
  const nativeUsage=MimaStandalone.getLastUsage();
  assert.strictEqual(nativeUsage.cachedTokens,4096,'Gemini cachedContentTokenCount not observed');
  console.log('PASS v1.1.4: artifact self-healing + compact iOS assistant + reader-controlled streaming + cache observability/context pruning');
})().catch(err=>{console.error(err);process.exit(1)});
