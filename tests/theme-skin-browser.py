"""Offline Chromium regression: no API, IndexedDB writes or imported user data."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
BASE=Path(__file__).resolve().parent.parent
html='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="theme-color" content="#dfe1e4"><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="../theme-skin.css"></head><body>
<div class="app-shell"><div class="topbar glass-bar"><button class="icon-btn">☰</button><div class="top-avatar">♡</div><div class="top-title-wrap"><div class="top-character">咪嘛馆 · 主题体检</div><div class="top-title">Chat / Settings / Novel / Assistant</div></div><button class="icon-btn">⚙</button></div><div class="context-ribbon">剧情上下文 · 对照检查</div>
<section class="chat-box" style="min-height:260px;overflow:auto"><div class="message assistant-msg"><div class="msg-header">角色 · 19:20</div><div class="msg-content">这是角色的回复。测试字色、行距和背景对比度。</div></div><div class="message user-msg"><div class="msg-header">玩家 · 19:21</div><div class="msg-content">我是玩家的气泡！玩家气泡必须跟随主题着色。</div></div><div class="message"><button class="tool-mini">编辑</button> <button class="generation-retry">重试</button></div></section>
<div class="composer-shell glass-bar"><div class="quick-actions"><button class="chip-btn">快捷操作</button><button class="chip-btn danger">危险按钮</button></div><div class="composer-row"><textarea class="has-content">有输入的状态</textarea><button class="send-btn">➤</button></div></div></div>
<div class="visual-samples" style="position:fixed;right:12px;top:12px;width:min(530px, 95vw);max-height:85vh;overflow:auto;padding:12px;border-radius:20px;z-index:10;background:var(--skin-panel,var(--panel-solid));border:1px solid var(--line)">
 <div class="modal-panel" style="padding:12px;display:grid;gap:8px"><b>设置中心</b><input class="field" placeholder="输入角色名" value="角色名称"><div><button class="primary-btn">确认</button> <button class="ghost-btn">取消</button> <button class="danger-btn">删除</button></div><div class="library-card">人物卡与预设</div><div class="memory-card">剧情记忆卡片</div></div>
 <div class="assistant-studio-root" style="display:block;border:1px solid var(--line);margin-top:8px"><div class="assistant-sidebar"><button class="assistant-type-btn active">助手 · 对话</button></div><div class="assistant-main" style="padding:8px"><div class="assistant-chat-user"><div class="assistant-chat-text">助手工作区玩家气泡</div></div><div class="assistant-artifact-card">生成结果卡片</div><div class="assistant-composer"><div class="assistant-input-row"><textarea>助手输入区</textarea></div></div></div></div>
 <div class="novel-studio-root" style="display:block;padding:8px;margin-top:8px"><div class="novel-reader" style="padding:12px"><div class="novel-prose-view">小说阅读器段落。</div><div class="novel-settings-card">小说设置面板</div></div></div>
 </div><script src="../theme-engine.js"></script></body></html>'''
fixture=BASE/'tests'/'theme-skin-fixture.html'
fixture.write_text(html,encoding='utf-8')

def hexcolor(value):
    v=value.removeprefix('rgb(').removeprefix('rgba(').removesuffix(')').split(',')
    return [float(x.strip()) for x in v[:3]]

def contrast(c1,c2):
    def lum(c):
        s=[x/255 for x in c]
        return sum((x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4)*k for x,k in zip(s,[.2126,.7152,.0722]))
    a,b=sorted([lum(c1),lum(c2)],reverse=True)
    return (a+.05)/(b+.05)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=b.new_page(viewport={'width':1440,'height':920},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.add_style_tag(content=(BASE/'style.css').read_text())
    page.add_style_tag(content=(BASE/'theme-skin.css').read_text())
    page.add_script_tag(content=(BASE/'theme-engine.js').read_text())
    assert page.evaluate('typeof MimaThemeEngine')=='object'
    ids=page.evaluate('MimaThemeEngine.getBuiltins().map(t=>t.id)')
    expected=['default','midnight','eink','paper','seoul-mist','sakura-milk','lilac-cloud']
    assert ids==expected, ids
    result={}
    for theme in ids:
        page.evaluate('theme => MimaThemeEngine.apply({theme})',theme)
        styles=page.evaluate('''() => {
          const css=s=>getComputedStyle(document.querySelector(s));
          return {
            theme:document.documentElement.getAttribute('data-mima-theme'),
            bubble:css('.user-msg .msg-content').backgroundColor,
            bubbleInk:css('.user-msg .msg-content').color,
            assistantBubble:css('.assistant-chat-user .assistant-chat-text').backgroundColor,
            assistantInk:css('.assistant-chat-user .assistant-chat-text').color,
            panel:css('.modal-panel').backgroundColor,
            memory:css('.memory-card').backgroundColor,
            novel:css('.novel-reader').backgroundColor,
            input:css('.composer-row textarea.has-content').backgroundColor,
            inputBorder:css('.composer-row textarea.has-content').borderTopColor,
            button:css('.primary-btn').backgroundColor,
            buttonInk:css('.primary-btn').color,
            meta:document.querySelector('meta[name="theme-color"]').content,
            colorScheme:getComputedStyle(document.documentElement).colorScheme,
            hasContentShadow:css('.composer-row textarea.has-content').boxShadow
          }
        }''')
        result[theme]=styles
        if theme!='default':
            assert styles['bubble']!=result['default']['bubble'],(theme,'default white bubble retained')
            assert styles['assistantBubble']==styles['bubble'],(theme,'assistant bubble inconsistency')
            assert contrast(hexcolor(styles['bubble']),hexcolor(styles['bubbleInk']))>=4.5,(theme,'bubble color contrast',styles)
            assert contrast(hexcolor(styles['button']),hexcolor(styles['buttonInk']))>=4.5,(theme,'button contrast',styles)
        if theme=='midnight':
            assert styles['colorScheme']=='dark' and min(hexcolor(styles['panel']))<80
        if theme=='eink': assert styles['hasContentShadow']=='none'
        if theme in ['midnight','sakura-milk','seoul-mist']:
            page.screenshot(path=str(BASE/'tests'/f'theme-preview-{theme}.png'))
    # Directly injected unlayered user CSS must win over the built-in skin.
    page.evaluate("MimaThemeEngine.apply({theme:'midnight'})")
    page.add_style_tag(content='html[data-mima-theme="midnight"] .user-msg .msg-content { background: rgb(12, 34, 56); } .composer-row textarea.has-content { border-color: rgb(10, 220, 80); } .assistant-type-btn.active {border-color:rgb(10, 220, 80);}')
    assert page.locator('.user-msg .msg-content').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(12, 34, 56)'
    assert page.locator('.composer-row textarea.has-content').evaluate('(e)=>getComputedStyle(e).borderTopColor')=='rgb(10, 220, 80)'
    assert page.locator('.assistant-type-btn.active').evaluate('(e)=>getComputedStyle(e).borderTopColor')=='rgb(10, 220, 80)'
    # mobile theme updates the same components; focus/text remain visible
    mobile=b.new_page(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=1)
    mobile.set_content(html)
    mobile.add_style_tag(content=(BASE/'style.css').read_text())
    mobile.add_style_tag(content=(BASE/'theme-skin.css').read_text())
    mobile.add_script_tag(content=(BASE/'theme-engine.js').read_text())
    mobile.evaluate("MimaThemeEngine.apply({theme:'sakura-milk'})")
    assert mobile.locator('.user-msg .msg-content').evaluate('(e)=>getComputedStyle(e).backgroundColor')==result['sakura-milk']['bubble']
    assert not errors,errors
    (BASE/'tests'/'theme-skin-computed.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print('PASS: 7 theme IDs; real Chromium computed colors, bubble/CTA contrast, user CSS priority, mobile 390px and dark color-scheme')
    b.close()
