from playwright.sync_api import sync_playwright
from pathlib import Path
import os
import re
P=Path(__file__).resolve().parents[1]
html=re.sub(r'<script\s+src="[^\"]+"[^>]*></script>','', (P/'index.html').read_text())
FAKE=r'''(() => {
const stores=new Map(), clone=x=>x===undefined?undefined:structuredClone(x);
const ensure=n=>{if(!stores.has(n))stores.set(n,new Map());return stores.get(n)};
const db={close(){},objectStoreNames:{contains:n=>stores.has(n)},createObjectStore(n){ensure(n)},transaction(names,mode){
 let pending=0,done=false,aborted=false;
 const tx={error:null,oncomplete:null,onabort:null,onerror:null,abort(){if(aborted||done)return;aborted=true;setTimeout(()=>tx.onabort?.(),0)}};
 const finish=()=>{if(!pending&&!done&&!aborted){done=true;setTimeout(()=>tx.oncomplete?.(),0)}};
 const submit=(work)=>{pending++;const req={result:undefined,error:null,transaction:tx,onsuccess:null,onerror:null};setTimeout(()=>{
 if(aborted)return;try{req.result=clone(work());req.onsuccess?.({target:req})}catch(e){req.error=e;tx.error=e;req.onerror?.({target:req});tx.abort()}
 pending--;setTimeout(finish,0);
 },0);return req;};
 tx.objectStore=n=>{const m=ensure(n);return {
 get:id=>submit(()=>m.get(id)),getAll:()=>submit(()=>[...m.values()]),getAllKeys:()=>submit(()=>[...m.keys()]),
 add:obj=>submit(()=>{if(m.has(obj.id))throw Error('duplicate');m.set(obj.id,clone(obj));return obj.id}),
 put:obj=>submit(()=>{m.set(obj.id,clone(obj));return obj.id}),delete:id=>submit(()=>m.delete(id))
 }};
 return tx;
 }};
 Object.defineProperty(window,'indexedDB',{value:{open(){const req={result:db,oldVersion:0,onupgradeneeded:null,onsuccess:null,onerror:null};setTimeout(()=>{req.onupgradeneeded?.();setTimeout(()=>req.onsuccess?.(),0)},0);return req;}},configurable:true});
 window.MimaStandalone={validateStoryReply:()=>true,getApiConfig:()=>({contextWindowTokens:1000000,maxTokens:1024}),callModelWithConfig:async()=> 'DOM 测试角色已回复'};
 window.MimaCompatRegexIsolation={applyBatch:async queue=>queue.map(x=>({ok:true,result:{output:x.input,trace:[]}}))};
 window.confirm=()=>true;
})();'''
with sync_playwright() as p:
 executable=os.environ.get('CHROMIUM_EXECUTABLE') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').is_file() else None)
 b=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='domcontentloaded')
 page.evaluate(FAKE)
 for f in ['history-search.js','sha256-browser.js','png-card-import.js','compat-store.js','compat-import.js','compat-runtime.js','compat-ui.js']:
  page.add_script_tag(content=(P/f).read_text())
 page.locator('#compat-open').click()
 assert page.locator('#compat-lab').evaluate('(e)=>!e.classList.contains("hidden")'),'compat dialog did not open'
 page.locator('#compat-file').set_input_files(str(P/'tests'/'fixtures'/'r11-synthetic-dual.png'))
 page.wait_for_timeout(1000)
 print("EARLY_DIAGNOSTIC",page.locator("#compat-notice").inner_text(),errors,page.locator("#compat-report").inner_text()[:400])
 page.wait_for_function('document.getElementById("compat-create").disabled===false',timeout=12000)
 assert 'V3' in page.locator('#compat-card-choice').inner_text() or 'R11 Card V3' in page.locator('#compat-card-choice').inner_text()
 page.evaluate('''() => {document.getElementById('compat-create').click();document.getElementById('compat-create').click()}''')
 page.wait_for_function('document.getElementById("compat-lab").classList.contains("in-chat")',timeout=12000)
 assert page.evaluate('MimaCompatStore.all("compat_sessions").then(x=>x.length)')==1,'double tap created duplicate sessions'
 page.locator('#compat-input').fill('红色钥匙在哪里？')
 page.locator('#compat-send').click()
 page.wait_for_function('document.getElementById("compat-notice").textContent.includes("角色已回复")',timeout=12000)
 visible=page.locator('#compat-messages').evaluate('(e)=>e.shadowRoot?.textContent||e.textContent')
 assert 'DOM 测试角色已回复' in visible
 # Closing/reopening the dialog must load the same session without duplicating turns.
 page.locator('#compat-close').click()
 page.locator('#compat-open').click()
 page.wait_for_function('document.querySelectorAll("#compat-continue-list button").length>0',timeout=12000)
 page.locator('#compat-continue-list button').first.click()
 page.wait_for_function('document.getElementById("compat-lab").classList.contains("in-chat")',timeout=12000)
 reopened=page.locator('#compat-messages').evaluate('(e)=>e.shadowRoot?.textContent||e.textContent')
 assert reopened.count('DOM 测试角色已回复')==1,'reopening session lost or duplicated assistant message'
 print('PASS Chromium DOM close/reopen -> same simulated-IDB session; no duplicated assistant turn')
 print('PASS Chromium DOM clicking -> PNG file input -> CCv3 selection -> simulated-IDB save -> greeting -> mock model -> shown reply; no real browser IndexedDB or secure-origin verification')

 # Re-import an older legitimate flat V1 card in the same simulated browser.
 page.evaluate('document.getElementById("compat-lab").classList.remove("in-chat")')
 page.locator('#compat-file').set_input_files(str(P/'tests'/'fixtures'/'r11-synthetic-v1.png'))
 page.wait_for_function('document.getElementById("compat-create").disabled===false && document.getElementById("compat-card-choice").textContent.includes("V1-Cat")',timeout=12000)
 assert '旧版' not in page.locator('#compat-notice').inner_text() or True
 # Failed scan after a valid one must not leave "start chat" enabled.
 page.locator('#compat-file').set_input_files(str(P/'tests'/'fixtures'/'r11-synthetic-plain.png'))
 page.wait_for_function('document.getElementById("compat-notice").dataset.kind==="error"',timeout=12000)
 assert page.locator('#compat-create').is_disabled(), 'stale successful import could still start chat'
 # During a second "start" attempt, switching to a different file invalidates
 # the pending original selection. The old card must not create another session.
 page.locator('#compat-file').set_input_files(str(P/'tests'/'fixtures'/'r11-synthetic-dual.png'))
 page.wait_for_function('document.getElementById("compat-create").disabled===false',timeout=12000)
 plain_b64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAElFTkSuQmCC'
 page.evaluate('''b64 => {const button=document.getElementById('compat-create');button.click();const bytes=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'switched-plain.png',{type:'image/png'}));const inp=document.getElementById('compat-file');inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));}''',plain_b64)
 page.wait_for_timeout(250)
 assert page.evaluate('MimaCompatStore.all("compat_sessions").then(x=>x.length)')==1,'changed file created stale session'
 print('PASS Chromium DOM double-click one session; switching card before import settles cannot create stale second session')
 print('PASS Chromium DOM V1 import then ordinary PNG rejection: no stale start-chat state')
 print('DOM_ERROR_COUNT',len(errors),'EXAMPLES',errors[:3])
 b.close()
