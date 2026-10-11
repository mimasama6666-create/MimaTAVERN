/** Theme-only code regression, no calls to Store, Provider, or network. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
require('../theme-engine.js');
const engine=globalThis.MimaThemeEngine;
const ids=['default','midnight','eink','paper','seoul-mist','sakura-milk','lilac-cloud','aqua-sky','material-snow','fluent-blue'];
assert.deepEqual(engine.getBuiltins().map(x=>x.id),ids);
for (const id of ids) assert.equal(engine.normalizeSettings({theme:id}).theme,id);
assert.equal(engine.normalizeSettings({theme:'invalid-from-old-backup'}).theme,'default');
assert.equal(engine.normalizeSettings({theme:'sakura-milk',globalCssPresetId:'my-id',globalCssEnabled:false}).globalCssPresetId,'my-id');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const skin=fs.readFileSync(path.join(root,'theme-skin.css'),'utf8');
const base=fs.readFileSync(path.join(root,'style.css'),'utf8');
assert(html.includes('theme-skin.css?v=1.4.0'));
assert(html.indexOf('style.css?v=')<html.indexOf('theme-skin.css?v='));
assert(html.indexOf('theme-skin.css?v=')<html.indexOf('theme-engine.js?v='));
assert(skin.includes('@layer mima-builtins')&&base.includes('@layer mima-builtins'));
for (const id of ids.slice(1)) assert(skin.includes(`[data-mima-theme="${id}"]`),id+' skin missing');
for (const sel of ['.user-msg .msg-content','.assistant-chat-user .assistant-chat-text','.assistant-input-row textarea','.novel-reader','.memory-card','.generation-panel','.data-backup-card']) assert(skin.includes(sel),sel+' skin missing');
assert(!base.includes('border-color:rgba(255,255,255,.96)!important'));
assert(!base.includes('inset 0 1px 0 rgba(255,255,255,.86)!important'));
const meta={content:''};let current='';
globalThis.document={documentElement:{style:{colorScheme:''},setAttribute(_name,v){current=v},removeAttribute(){current=''}},querySelector(){return {setAttribute(_name,v){meta.content=v}}}};
for(const id of ids){
  const normalized=engine.apply({theme:id});
  assert.equal(normalized.theme,id);
  assert.equal(current,id==='default'?'':id);
  assert.equal(globalThis.document.documentElement.style.colorScheme,id==='midnight'?'dark':'light');
  assert.match(meta.content,/^#[a-f0-9]{6}$/);
}
console.log('PASS v1.3.7: legacy + new themes, HTML references, CSS layer, user CSS parity, meta and color scheme');
