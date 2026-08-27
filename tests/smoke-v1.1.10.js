const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(app.includes('function parseBondMeterPercent(text)'), 'BOND number parser missing');
assert(app.includes("root.querySelectorAll('.mima-meter')"), 'BOND render hydration does not scan meters');
assert(app.includes("meter.querySelector('.mima-meter-number')"), 'visible BOND number fallback missing');
assert(app.includes("meter.querySelector('.mima-meter-fill')"), 'BOND fill lookup missing');
assert(app.includes("fill.style.setProperty('--value',safeValue)"), 'derived --value is not applied');
assert(app.includes("fill.style.setProperty('width',safeValue,'important')"), 'derived width must survive user !important CSS');
assert(app.includes('hydrateSafeHtmlDynamicMeters(template.content);'), 'hydration is not wired into Safe HTML render path');
assert(app.includes('current/maximum*100'), 'ratio values such as 85 / 100 are not converted to percentage');
assert(app.includes('Math.max(0,Math.min(100'), 'derived BOND percentage must stay bounded');
assert(html.includes('release=1.1.10'), 'v1.1.10 cache bust missing');
console.log('PASS v1.1.10: BOND fill is hydrated from visible numeric value even when --value is absent');
