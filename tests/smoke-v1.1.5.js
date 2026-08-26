/** MIMAMAO Tavern v1.1.5 Artifact Protocol V2 / Zero-Escape / repair transparency smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const assistant=fs.readFileSync(path.join(ROOT,'assistant-studio.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'style.css'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

assert(assistant.includes('MIMA_ARTIFACT_V2'),'V2 artifact protocol missing');
assert(assistant.includes('Zero-Escape'),'zero-escape protocol marker missing');
assert(assistant.includes('extractArtifactV2'),'V2 envelope parser missing');
assert(assistant.includes('parseV2RegexPack'),'V2 regex parser missing');
assert(assistant.includes('repairAttempts'),'AI repair attempt archive missing');
assert(assistant.includes('AI 救援修复（会计费）'),'paid AI repair label missing');
assert(assistant.includes('不会自动重试'),'repair must explicitly avoid automatic paid retries');
assert(assistant.includes('artifactProtocol=\'v2\''),'successful repair must mark V2 transport');
assert(!/\beval\s*\(/.test(assistant),'V2 artifact path must never eval model output');
assert(!/new\s+Function\s*\(/.test(assistant),'V2 artifact path must never Function(model output)');
assert(css.includes('v1.1.5 · ARTIFACT PROTOCOL V2'),'V2 artifact UI styles missing');
assert(html.includes('release=1.1.5'),'v1.1.5 cache bust marker missing');

// Minimal browser-ish globals.
global.window=global;
const local=new Map();
global.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
global.requestAnimationFrame=fn=>fn();
global.confirm=()=>true;
global.toast=()=>{};
require(path.join(ROOT,'assistant-studio.js'));

const v2=String.raw`解释文字
<MIMA_ARTIFACT_V2 kind="regex_bundle">
<PRESET>
<NAME>咪嘛猫·V2</NAME>
<TYPE>format</TYPE>
<DESCRIPTION>短协议</DESCRIPTION>
<PRIORITY>50</PRIORITY>
<CONTENT><![CDATA[
每次输出 <ST>时间¦地点</ST>\n<正文>剧情</正文>
HTML 示例允许 class="x"，反斜杠 \s 原样存在。
]]></CONTENT>
</PRESET>
<REGEX_PACK>
<NAME>咪嘛猫·Zero Escape</NAME>
<DESCRIPTION>无需 JSON 转义</DESCRIPTION>
<PRIORITY>50</PRIORITY>
<ENABLED>true</ENABLED>
<RULE>
<NAME>状态栏</NAME>
<PATTERN><![CDATA[
<ST>([^¦]*)¦([\s\S]*?)</ST>
]]></PATTERN>
<REPLACEMENT><![CDATA[
<div class="mima-panel"><span data-x="a:b">$1</span><b>$2</b></div>
]]></REPLACEMENT>
<FLAGS>g</FLAGS>
<PHASE>display</PHASE>
<PRIORITY>50</PRIORITY>
<ENABLED>true</ENABLED>
<DESCRIPTION>展开 HTML</DESCRIPTION>
</RULE>
</REGEX_PACK>
</MIMA_ARTIFACT_V2>`;

let parsed=MimaAssistantStudio.inspectArtifact(v2);
assert.strictEqual(parsed.found,true,'V2 marker not found');
assert.strictEqual(parsed.protocol,'v2','V2 protocol not reported');
assert(parsed.artifact&&parsed.artifact.kind==='regex_bundle','V2 bundle not parsed');
assert.strictEqual(parsed.artifact.preset.content,'每次输出 <ST>时间¦地点</ST>\\n<正文>剧情</正文>\nHTML 示例允许 class="x"，反斜杠 \\s 原样存在。','V2 preset content changed');
assert.strictEqual(parsed.artifact.regexPack.rules[0].pattern,String.raw`<ST>([^¦]*)¦([\s\S]*?)</ST>`,'regex backslashes changed');
assert.strictEqual(parsed.artifact.regexPack.rules[0].replacement,'<div class="mima-panel"><span data-x="a:b">$1</span><b>$2</b></div>','HTML quotes changed');

// V2 must fail closed when a required block is missing.
parsed=MimaAssistantStudio.inspectArtifact(`<MIMA_ARTIFACT_V2 kind="regex_bundle"><PRESET><NAME>x</NAME><CONTENT><![CDATA[y]]></CONTENT></PRESET></MIMA_ARTIFACT_V2>`);
assert.strictEqual(parsed.found,true,'broken V2 should still be detected');
assert.strictEqual(parsed.artifact,null,'broken V2 must fail closed');
assert(/REGEX_PACK/.test(parsed.error),'broken V2 should explain missing structural block');

// Legacy V1 remains readable.
parsed=MimaAssistantStudio.inspectArtifact(`<MIMA_ARTIFACT>{"kind":"preset","preset":{"name":"old","content":"legacy"}}</MIMA_ARTIFACT>`);
assert(parsed.artifact&&parsed.artifact.kind==='preset','legacy V1 compatibility regressed');
assert.strictEqual(parsed.protocol,'v1','legacy protocol marker missing');

// CSS V2 should preserve normal CSS quotes/backslashes without JSON escaping.
const cssV2=String.raw`<MIMA_ARTIFACT_V2 kind="css_preset"><CSS_PRESET><NAME>glass</NAME><SCOPE>story</SCOPE><CSS><![CDATA[
.mima::before{content:"a\\b";background:url("data:image/svg+xml,<svg></svg>")}
]]></CSS></CSS_PRESET></MIMA_ARTIFACT_V2>`;
parsed=MimaAssistantStudio.inspectArtifact(cssV2);
assert(parsed.artifact&&parsed.artifact.kind==='css_preset','CSS V2 not parsed');
assert(parsed.artifact.cssPreset.css.includes('content:"a\\\\b"'),'CSS backslashes changed');

console.log('PASS v1.1.5: V2 Zero-Escape artifacts preserve regex/HTML/CSS, legacy V1 remains compatible, invalid V2 fails closed, paid repair is explicit and archived');
