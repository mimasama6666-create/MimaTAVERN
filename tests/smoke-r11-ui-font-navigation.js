'use strict';
// UI regression: the real DOM/cascade is additionally replayed with Chromium by browser-r11-ui-font-navigation.py.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const classes=new Set(['hidden']);
const box={innerHTML:''};
const modal={classList:{contains:x=>classes.has(x),remove:x=>classes.delete(x),add:x=>classes.add(x)},querySelector:()=>({classList:{add(){},remove(){}},insertBefore(){}})};
const elements={'settings-modal':modal,'settings-content':box};
const tabs=['appearance','memory','api','data'].map(tab=>({dataset:{tab},classList:{toggle(){}}}));
const doc={getElementById:id=>elements[id]||null,querySelectorAll:selector=>selector==='.settings-tabs button'?tabs:[],addEventListener(){},createElement:tag=>({tagName:tag,innerHTML:'',className:'',classList:{add(){},remove(){}}}),documentElement:{style:{setProperty(){}}}};
const ctx={window:{addEventListener(){}},document:doc,console,URLSearchParams,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  MimaStandalone:{getApiConfig:()=>({apiBase:''}),getState:()=>({themeSettings:{}})},
  MimaFontManager:{all:async()=>[],getSelected:()=>''},MimaThemeEngine:{getBuiltins:()=>[]},
  MimaLocalStore:{loadSettingsSnapshot:async()=>null}};
ctx.window.window=ctx.window;ctx.window.document=doc;
vm.createContext(ctx);vm.runInContext(app,ctx,{filename:'app.js'});
const inApp=expression=>vm.runInContext(expression,ctx);
const scope='.tavern-story-content';
const selectors={
  '.msg-content':scope,
  '.msg-content.safe-html-content':scope+'.safe-html-content',
  '.msg-content .story-prose':scope+' .story-prose',
  '.story-prose':scope+' .story-prose',
  ':root':scope,
  'body .story-prose':scope+' .story-prose'
};
for(const [input,want] of Object.entries(selectors)) assert.equal(inApp(`cssScopeSelector(${JSON.stringify(input)},${JSON.stringify(scope)})`),want,input);
const scoped=inApp(`compileCustomCss({css:'.msg-content{font-family:TestFont}.story-prose{color:red}',scope:'story'})`);
assert(scoped.includes(`${scope}{font-family:TestFont}`),scoped);
assert(scoped.includes(`${scope} .story-prose{color:red}`),scoped);
assert(css.includes('.msg-content{font-family:var(--font-story)}'));
assert(css.includes('.assistant-msg .story-prose,\n.user-msg .story-prose{\n  font-family:inherit;'));
assert(html.includes('uihotfix=20261013-1'));
inApp('currentSessionData={id:"test",renderMode:"text"};openSettings("api")');
assert(box.innerHTML.includes('API（接口）设置'));
assert.equal(inApp('maybeOpenInitialApiSettings()'),false,'first-run prompt must not steal a tab previously selected by the user');
assert(box.innerHTML.includes('API（接口）设置'));
console.log('PASS UI settings auto-open guard / font cascade / user CSS scoped root selectors');
