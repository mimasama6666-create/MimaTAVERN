"""Optional real Chromium/IndexedDB validation; isolated temporary browser profile and localhost origin.
Requires Python playwright and Chromium. Does not use real API or user data.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import threading
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
server = ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/index.html'
try:
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context()
        a=context.new_page()
        a.goto(url,wait_until='domcontentloaded')
        a.wait_for_function('typeof window.MimaStandalone === "object" && typeof window.MimaLocalStore === "object"')
        result=a.evaluate('''async()=>{
          await MimaStandalone.init();
          const r=await MimaStandalone.handle('/presets','POST',{name:'备份安全',content:'不可丢失的永久资料'});
          if(!r.success)throw Error('create failed: '+r.msg);
          const original=await MimaLocalStore.loadState();
          const source=await MimaStandalone.exportLibrary();
          const saved=JSON.stringify(original);
          for (const damage of ['missing','wrong']) {
            const invalid=JSON.parse(JSON.stringify(source));
            if(damage==='missing')delete invalid.presets[0].content;
            else invalid.presets[0].content={bad:true};
            let rejected=false;
            try{await MimaLocalStore.importAll(invalid)}catch(e){rejected=e.message.includes('presets[0].content')}
            if(!rejected)throw Error('raw store importAll accepted '+damage);
            if(JSON.stringify(await MimaLocalStore.loadState())!==saved)throw Error('IDB changed on '+damage);
          }
          const roundtrip=await MimaLocalStore.importAll(source);
          if(roundtrip.presets[0].content!=='不可丢失的永久资料')throw Error('valid importAll lost preset');
          await MimaStandalone.init();
          return {rejected:2,restored:true,revision:roundtrip.storeRevision};
        }''')
        b=context.new_page()
        b.goto(url,wait_until='domcontentloaded')
        b.wait_for_function('typeof window.MimaStandalone === "object"')
        b.evaluate('MimaStandalone.init()')
        a.evaluate('MimaStandalone.init()')
        res1=a.evaluate('''async()=>{
          const preset=(await MimaStandalone.handle('/presets','GET')).data[0];
          return MimaStandalone.handle('/presets/'+preset.id,'PATCH',{content:'新标签更新'});
        }''')
        assert res1['success'],res1
        res2=b.evaluate('''async()=>{
          const preset=(await MimaStandalone.handle('/presets','GET')).data[0];
          return MimaStandalone.handle('/presets/'+preset.id,'PATCH',{content:'过期窗口覆盖'});
        }''')
        assert not res2['success'] and 'CONFLICT' in str(res2),res2
        after=a.evaluate('''async()=> (await MimaLocalStore.loadState()).presets[0].content''')
        assert after=='新标签更新',after
        context.close();browser.close()
        print('PASS Chromium real IndexedDB: importAll rejects missing/wrong v4 content atomically, valid v4 restore, two-tab stale CAS does not overwrite')
finally:
    server.shutdown()
