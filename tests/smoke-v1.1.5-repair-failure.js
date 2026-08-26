/** MIMAMAO Tavern v1.1.5 failed paid AI rescue must preserve original and expose the paid response without retrying. */
const assert=require('assert');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

global.window=global;
const local=new Map();
const key='MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1';
const original='说明\n<MIMA_ARTIFACT>{"kind":"regex_bundle","preset":</MIMA_ARTIFACT>';
local.set(key,JSON.stringify({profiles:{regex:{model:'gpt-test',temperature:.2,maxTokens:0}},threads:{regex:[{role:'assistant',time:new Date().toISOString(),content:original}]},ui:{}}));
global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
global.requestAnimationFrame=fn=>fn();
global.confirm=()=>true;
const notices=[];global.toast=m=>notices.push(String(m));
let calls=0;
global.MimaStandalone={getApiConfig:()=>({apiBase:'x',apiKey:'x',model:'story'}),callModelWithConfig:async()=>{calls++;return '<MIMA_ARTIFACT_V2 kind="regex_bundle"><PRESET></PRESET></MIMA_ARTIFACT_V2>';}};
require(path.join(ROOT,'assistant-studio.js'));

(async()=>{
  await MimaAssistantStudio.repairArtifact(0);
  assert.strictEqual(calls,1,'failed rescue must not auto-retry and charge twice');
  const msg=MimaAssistantStudio.getState().threads.regex[0];
  assert.strictEqual(msg.content,original,'failed rescue overwrote original artifact');
  assert(Array.isArray(msg.repairAttempts)&&msg.repairAttempts.length===1,'failed paid response was not archived');
  assert.strictEqual(msg.repairAttempts[0].success,false,'failed paid response incorrectly marked success');
  assert(msg.repairAttempts[0].content.includes('MIMA_ARTIFACT_V2'),'raw paid repair response not preserved');
  assert(notices.some(x=>x.includes('完成计费')&&x.includes('修复结果已保存')),'failure notice does not explain charged-but-rejected state');
  console.log('PASS v1.1.5 repair failure: one paid call only; original preserved; failed model response archived and surfaced');
})().catch(err=>{console.error(err);process.exit(1)});
