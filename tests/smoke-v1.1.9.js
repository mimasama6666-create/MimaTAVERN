const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const core=fs.readFileSync(path.join(root,'standalone-core.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
function ok(cond,msg){if(!cond)throw new Error(msg)}
ok(app.includes("e?.message||e?.msg"),'failure object msg is not rendered');
ok(app.includes('function retryFailedGeneration()'),'manual retry action missing');
ok(html.includes('generation-retry'),'generation retry UI missing');
ok(core.includes("E_STREAM_INTERRUPTED"),'stream interruption classification missing');
ok(core.includes("mode:'cors',credentials:'omit',cache:'no-store'"),'browser fetch transport options missing');
ok(app.includes("'PROGRESS','METER'"),'safe HTML progress/meter tags missing');
ok(app.includes("'value','max','min','low','high','optimum'"),'safe HTML progress attributes missing');
ok(css.includes('safe-html-content progress'),'safe HTML progress baseline CSS missing');
console.log('v1.1.9 smoke PASS');
