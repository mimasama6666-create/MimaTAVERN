/** MIMAMAO Tavern v1.1.9 Safe HTML dynamic status-variable hotfix smoke. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');

const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

// Root regression: v1.1.8 sanitizer removed every style attribute, including
// style="--value:85%;" used by the existing BOND meter HTML.
assert(app.includes("if(n==='style')"),'Safe HTML sanitizer still has no controlled style bridge');
assert(app.includes("if(name==='--value')"),'legacy BOND --value variable is not explicitly preserved');
assert(app.includes("value.match(/^(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))%$/)"),'--value must remain percentage-only');
assert(app.includes('Math.max(0,Math.min(100,Number(match[1])))'),'--value must be clamped to the canonical 0..100 BOND range');
assert(app.includes("if(safeStyle)el.setAttribute('style',safeStyle);else el.removeAttribute(a.name)"),'sanitized style is not written back');

// Security boundary: arbitrary inline style must remain disallowed. Only the
// narrow dynamic custom property bridge above is admitted.
assert(!app.includes("allowedAttrs=new Set(['class','title','role','open','colspan','rowspan','scope','style'])"),'arbitrary style attribute was accidentally allowlisted');
assert(app.includes("return kept.join(';')"),'controlled inline-style sanitizer missing');

// Force cache refresh on mobile/iOS so the old app.js sanitizer is not reused.
assert(html.includes('release=1.1.9'),'v1.1.9 cache-bust marker missing');
assert(html.includes('./app.js?v=1.1.2&release=1.1.9'),'app.js cache bust was not advanced');

console.log('PASS v1.1.9: Safe HTML preserves only bounded --value percentages for legacy BOND meters');
