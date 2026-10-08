/**
 * MimaTAVERN v1.2.0 canonical merge smoke.
 * Verifies the two formerly-divergent branches coexist without regressing
 * v1.1.10 BOND hydration or duplicating a saved player turn on manual retry.
 */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');

// Static merge invariants: preserve v1.1.10 and add Browser Transport branch.
assert(app.includes('function hydrateSafeHtmlDynamicMeters(root)'), 'v1.1.10 BOND hydrator missing');
assert(app.includes("fill.style.setProperty('--value',safeValue)"), 'BOND --value hydration missing');
assert(app.includes("fill.style.setProperty('width',safeValue,'important')"), 'BOND visible width hydration missing');
assert(app.includes("if(n==='style'){"), 'controlled Safe HTML inline-style bridge was lost');
assert(app.includes("if(name==='--value')"), 'controlled --value sanitizer was lost');
assert(app.includes("'PROGRESS','METER'"), 'native progress/meter Safe HTML tags missing');
assert(app.includes("'value','max','min','low','high','optimum'"), 'native progress/meter numeric attributes missing');
assert(app.includes('function retryFailedGeneration()'), 'manual retry bridge missing');
assert(html.includes('id="generation-retry"'), 'manual retry UI missing');
assert(html.includes('release=1.2.0'), 'v1.2.0 cache bust missing');
assert(css.includes('safe-html-content progress') && css.includes('generation-retry'), 'v1.2.0 additive CSS missing');

// Core harness.
global.window=global;
const local=new Map();
global.localStorage={
  getItem:k=>local.has(k)?local.get(k):null,
  setItem:(k,v)=>local.set(k,String(v)),
  removeItem:k=>local.delete(k)
};
let storedState=null;
global.MimaLocalStore={
  async loadState(){return storedState||{schemaVersion:3,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[]}},
  async saveState(v){storedState=JSON.parse(JSON.stringify(v));return storedState}
};
require(path.join(ROOT,'regex-engine.js'));
require(path.join(ROOT,'standalone-core.js'));

(async()=>{
  await MimaStandalone.init();
  let created=await MimaStandalone.handle('/sessions','POST',{title:'v1.2 merge'});
  assert(created.success,'session create failed');
  const id=created.data.id;
  MimaStandalone.saveApiConfig({apiBase:'https://example.invalid/v1',apiKey:'test',model:'mock',stream:true,sendTemperature:true});

  const enc=new TextEncoder();
  let capturedFetchOptions=null;
  global.fetch=async (_url,options)=>{
    capturedFetchOptions=options;
    let reads=0;
    return {
      ok:true,
      status:200,
      headers:{get:name=>String(name).toLowerCase()==='content-type'?'text/event-stream':''},
      body:{getReader(){return{async read(){
        reads++;
        if(reads===1)return{done:false,value:enc.encode('data: {"choices":[{"delta":{"content":"半"}}]}\n\n')};
        throw new Error('socket reset');
      }}}}
    };
  };

  const failed=await MimaStandalone.handle(`/sessions/${id}/chat`,'POST',{text:'只保存我一次',action:'send',temperature:.3},null,()=>{});
  assert.strictEqual(failed.success,false,'interrupted stream should fail');
  assert.strictEqual(failed.code,'E_STREAM_INTERRUPTED','partial stream was not classified separately');
  assert.strictEqual(capturedFetchOptions.mode,'cors','fetch mode=cors missing');
  assert.strictEqual(capturedFetchOptions.credentials,'omit','fetch credentials=omit missing');
  assert.strictEqual(capturedFetchOptions.cache,'no-store','fetch cache=no-store missing');

  let state=await MimaStandalone.handle(`/sessions/${id}`,'GET');
  assert(state.success,'failed to reload session after interruption');
  assert.strictEqual(state.data.messages.length,1,'partial assistant output or duplicate data was committed');
  assert.strictEqual(state.data.messages[0].role,'user','saved player turn missing after interruption');
  assert.strictEqual(state.data.messages[0].rawContent,'只保存我一次','saved player turn changed');

  global.fetch=async (_url,options)=>{
    capturedFetchOptions=options;
    return new Response(new ReadableStream({
      start(controller){
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"完整回复"}}]}\n\n'));
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      }
    }),{status:200,headers:{'content-type':'text/event-stream'}});
  };

  // This is exactly what the v1.2 UI retry bridge does for a failed initial send:
  // regenerate/respond the already-saved final player turn instead of sending it again.
  const retried=await MimaStandalone.handle(`/sessions/${id}/chat`,'POST',{text:'',action:'regenerate',temperature:.3},null,()=>{});
  assert(retried.success,'manual retry route failed');
  assert.deepStrictEqual(retried.data.messages.map(m=>m.role),['user','assistant'],'manual retry duplicated the player message');
  assert.strictEqual(retried.data.messages[0].rawContent,'只保存我一次','retry mutated the saved player turn');
  assert.strictEqual(retried.data.messages[1].content,'完整回复','retry did not commit the successful assistant reply');

  console.log('PASS v1.2.0: canonical BOND hydration + native meters + conservative browser transport + non-duplicating manual retry coexist');
})().catch(e=>{console.error(e);process.exit(1)});
