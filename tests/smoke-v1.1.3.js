/** MIMAMAO Tavern v1.1.3 artifact detection / repair smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const src=fs.readFileSync(path.join(ROOT,'assistant-studio.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
assert(src.includes('parseArtifactDetailed'),'detailed artifact parser missing');
assert(src.includes('normalizeArtifactJson'),'artifact JSON repair path missing');
assert(src.includes('检测到 MIMA 工件，但 JSON 没有成功解析'),'invalid artifact diagnostic card missing');
assert(src.includes('已自动修复 JSON 格式'),'repaired artifact UI indicator missing');
assert(css.includes('.assistant-artifact-error'),'artifact parse-error styling missing');
assert(html.includes('hotfix=1.1.3'),'artifact parser hotfix cache bust missing');

global.window=global;
global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
global.requestAnimationFrame=fn=>fn();
global.confirm=()=>true;
global.toast=()=>{};
require(path.join(ROOT,'assistant-studio.js'));

const strict=`prefix\n<MIMA_ARTIFACT>\n{"kind":"regex_bundle","preset":{"name":"P","content":"short"},"regexPack":{"name":"R","rules":[]}}\n</MIMA_ARTIFACT>`;
let r=MimaAssistantStudio.inspectArtifact(strict);
assert.strictEqual(r.found,true,'strict marker not detected');
assert.strictEqual(r.artifact.kind,'regex_bundle','strict artifact not parsed');
assert.strictEqual(r.repaired,false,'strict artifact should not require repair');

const repairable=`<MIMA_ARTIFACT>\n{\n  "kind":"preset",\n  "preset": {\n    "name":"P",\n    "content":"line one\nline two",\n  },\n}\n</MIMA_ARTIFACT>`;
r=MimaAssistantStudio.inspectArtifact(repairable);
assert.strictEqual(r.found,true,'repairable marker not detected');
assert(r.artifact&&r.artifact.kind==='preset','repairable JSON was not recovered');
assert.strictEqual(r.repaired,true,'repairable JSON should report repaired=true');
assert.strictEqual(r.artifact.preset.content,'line one\nline two','raw newline repair changed content');

const malformed=`<MIMA_ARTIFACT>{"kind":"regex_bundle","preset":</MIMA_ARTIFACT>`;
r=MimaAssistantStudio.inspectArtifact(malformed);
assert.strictEqual(r.found,true,'malformed marker should still be detected');
assert.strictEqual(r.artifact,null,'malformed artifact must fail closed');
assert(r.error,'malformed artifact should surface a parse error');

console.log('PASS v1.1.3: strict artifacts parse; common model JSON glitches auto-repair; irreparable artifacts surface diagnostics');
