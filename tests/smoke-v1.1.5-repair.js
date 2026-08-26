/** MIMAMAO Tavern v1.1.5 paid AI rescue should convert broken V1 to V2 once, archive attempt, preserve original version. */
const assert=require('assert');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

global.window=global;
const local=new Map();
const key='MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1';
local.set(key,JSON.stringify({
  profiles:{regex:{model:'gpt-test',temperature:.2,stream:true,maxTokens:0}},
  threads:{regex:[{role:'assistant',time:new Date().toISOString(),content:'说明\n<MIMA_ARTIFACT>{kind:"regex_bundle",preset:{name:"P",content:"abc"},regexPack:{name:"R",rules:[{name:"r",pattern:"<X>([\\s\\S]*?)</X>",replacement:"<div class="oops">$1</div>",flags:"g",phase:"display"}]}}</MIMA_ARTIFACT>'}]},
  ui:{configOpen:false}
}));
global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
global.requestAnimationFrame=fn=>fn();
global.confirm=()=>true;
global.toast=()=>{};
let calls=0;
const repaired=String.raw`<MIMA_ARTIFACT_V2 kind="regex_bundle">
<PRESET><NAME>P</NAME><TYPE>format</TYPE><DESCRIPTION></DESCRIPTION><PRIORITY>50</PRIORITY><CONTENT><![CDATA[
abc
]]></CONTENT></PRESET>
<REGEX_PACK><NAME>R</NAME><DESCRIPTION></DESCRIPTION><PRIORITY>50</PRIORITY><ENABLED>true</ENABLED>
<RULE><NAME>r</NAME><PATTERN><![CDATA[
<X>([\s\S]*?)</X>
]]></PATTERN><REPLACEMENT><![CDATA[
<div class="oops">$1</div>
]]></REPLACEMENT><FLAGS>g</FLAGS><PHASE>display</PHASE><PRIORITY>50</PRIORITY><ENABLED>true</ENABLED><DESCRIPTION></DESCRIPTION></RULE>
</REGEX_PACK></MIMA_ARTIFACT_V2>`;
global.MimaStandalone={
  getApiConfig:()=>({apiBase:'https://example.invalid/v1',apiKey:'x',model:'story'}),
  callModelWithConfig:async()=>{calls++;return repaired;}
};
require(path.join(ROOT,'assistant-studio.js'));

(async()=>{
  await MimaAssistantStudio.repairArtifact(0);
  assert.strictEqual(calls,1,'AI rescue must make exactly one model call');
  const st=MimaAssistantStudio.getState();
  const msg=st.threads.regex[0];
  assert(msg.content.includes('<MIMA_ARTIFACT_V2 kind="regex_bundle">'),'successful rescue did not replace broken V1 with V2');
  assert(!msg.content.includes('<MIMA_ARTIFACT>{kind:'),'broken V1 block remained after successful rescue');
  assert(Array.isArray(msg.versions)&&msg.versions.length===1,'original artifact version was not archived');
  assert(Array.isArray(msg.repairAttempts)&&msg.repairAttempts.length===1,'repair attempt was not archived');
  assert.strictEqual(msg.repairAttempts[0].success,true,'successful V2 rescue recorded as failure');
  assert.strictEqual(msg.artifactProtocol,'v2','message not marked as V2 after rescue');
  const parsed=MimaAssistantStudio.inspectArtifact(msg.content);
  assert(parsed.artifact&&parsed.protocol==='v2','repaired message does not parse as V2');
  console.log('PASS v1.1.5 repair: one paid call only; broken V1 -> V2; original and repair attempt archived');
})().catch(err=>{console.error(err);process.exit(1)});
