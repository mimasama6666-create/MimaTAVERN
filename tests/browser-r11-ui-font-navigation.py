from pathlib import Path
import os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html='''<html><head><meta charset="utf-8"></head><body>
<div id="settings-modal" class="modal hidden"><div class="modal-panel settings-panel"><nav class="settings-tabs">
<button data-tab="appearance" onclick="switchSettingsTab('appearance')">🎨 外观</button>
<button data-tab="api" onclick="switchSettingsTab('api')">🔌 API</button>
<button data-tab="memory" onclick="switchSettingsTab('memory')">🗃️ 记忆</button>
<button data-tab="data" onclick="switchSettingsTab('data')">💾 数据</button>
</nav><div id="settings-content" class="settings-content"></div></div></div>
<div id="story-chat-box" class="tavern-story-scope"><article class="message assistant-msg"><div id="font-root" class="msg-content tavern-story-content"><p id="font-child" class="story-prose story-paragraph">咪嘛馆字体测试</p></div></article></div>
</body></html>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path': os.getenv('CHROMIUM_EXECUTABLE', '/usr/bin/chromium')} if Path(os.getenv('CHROMIUM_EXECUTABLE', '/usr/bin/chromium')).exists() else {}),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page()
 page.set_content(html)
 page.add_style_tag(content=(root/'style.css').read_text())
 page.add_script_tag(content='''
 Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
 window.MimaStandalone={getApiConfig:()=>({apiBase:''}),getState:()=>({themeSettings:{theme:'default'}})};
 window.MimaFontManager={all:()=>Promise.resolve([]),getSelected:()=>''};
 window.MimaThemeEngine={getBuiltins:()=>[]};
 window.MimaLocalStore={loadSettingsSnapshot:()=>new Promise(r=>setTimeout(()=>r(null),30))};
 ''')
 page.add_script_tag(content=(root/'app.js').read_text())
 page.evaluate('currentSessionData={renderMode:"text",memory:{},messages:[],id:"test"}; currentSessionId="test";')
 # Real click and delayed API auto open (the old behavior was an unguarded openSettings)
 page.evaluate('openSettings("appearance")')
 page.wait_for_timeout(60)
 assert '本地字体库' in page.locator('#settings-content').inner_text()
 assert page.locator('.settings-tabs button[data-tab=appearance]').get_attribute('class')=='active'
 page.evaluate('maybeOpenInitialApiSettings()')
 assert '本地字体库' in page.locator('#settings-content').inner_text()
 print('PASS: appearance stays open when initial API prompt fires')
 # Async appearance read gets overtaken by API tab click
 page.evaluate('MimaFontManager.all=()=>new Promise(r=>setTimeout(()=>r([]),50));')
 page.evaluate('switchSettingsTab("appearance")')
 page.locator('.settings-tabs button[data-tab=api]').click()
 page.wait_for_timeout(90)
 assert 'API（接口）设置' in page.locator('#settings-content').inner_text(),page.locator('#settings-content').inner_text()[:200]
 print('PASS: stale appearance response cannot overwrite API')
 # Slow data read cannot override user chosen appearance
 page.locator('.settings-tabs button[data-tab=data]').click()
 page.locator('.settings-tabs button[data-tab=appearance]').click()
 page.wait_for_timeout(110)
 assert '本地字体库' in page.locator('#settings-content').inner_text()
 print('PASS: stale data response cannot overwrite appearance')
 # Root selector and regular descendant selector, with browser CSSOM enabled
 css=page.evaluate('compileCustomCss({scope:"story",css: ".msg-content { font-family: Courier, monospace } .story-prose { color: rgb(3, 4, 5); }"})')
 assert '.tavern-story-content{' in css.replace(' ',''),css
 assert '.tavern-story-content .story-prose' in css,css
 page.add_style_tag(content=css)
 family=page.locator('#font-child').evaluate('(el)=>getComputedStyle(el).fontFamily')
 assert family.startswith('Courier'),family
 assert page.locator('#font-child').evaluate('(el)=>getComputedStyle(el).color')=='rgb(3, 4, 5)'
 print('PASS: scoped custom CSS font inherits into prose and descendant rules apply')
 selector_cases=[('.msg-content.safe-html-content','.tavern-story-content.safe-html-content'),('.msg-content .story-prose','.tavern-story-content .story-prose'),(':root','.tavern-story-content'),('body .story-prose','.tavern-story-content .story-prose')]
 for orig,expect in selector_cases:
  res=page.evaluate('([s])=>cssScopeSelector(s,".tavern-story-content")',[orig])
  assert res==expect,(orig,res,expect)
 print('PASS: selector root and descendant mapping')
 # Broken font database should not falsely show an empty database or mutate selected keys
 page.evaluate('MimaFontManager.all=()=>Promise.reject(new Error("read-aborted")); switchSettingsTab("appearance")')
 page.wait_for_timeout(20)
 assert '字体库读取失败' in page.locator('#settings-content').inner_text()
 print('PASS: font DB read errors remain explicit; CSS section remains accessible')
 b.close()
