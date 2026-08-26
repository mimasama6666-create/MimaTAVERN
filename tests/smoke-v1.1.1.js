/** MIMAMAO Tavern v1.1.1 Assistant billing hotfix smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'assistant-studio.js'),'utf8');
assert(src.includes("maxTokens:Number(p.maxTokens)||0"),'assistant must explicitly override story maxTokens');
assert(src.includes("maxTokens:0"),'assistant profiles must default to independent maxTokens=0');
assert(src.includes("key==='maxTokens'"),'assistant maxTokens profile field missing');
assert(src.includes('不会再继承正文的 Max Tokens'),'assistant UI must explain the independent limit');
assert(!src.includes("const cfg={...storyCfg,model,temperature:p.temperature,stream:p.stream,sendTemperature:p.sendTemperature!==false};"),'old story maxTokens inheritance path still exists');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
assert(html.includes('assistant-studio.js?v=1.1.1'),'assistant hotfix cache version not bumped');
console.log('PASS v1.1.1: assistant model keeps story API connection but no longer inherits story Max Tokens');
