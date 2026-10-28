/* R19 History navigator: read-only view of canonical session messages; no API and no Store mutations. */
(()=>{'use strict';
let host=null,box=null,session=null,messages=[],origin=null,raf=0,searchHits=[],searchPage=0,searchTerm="",searchMode="visible",messageNodes=new Map(),expanded=false;
function $(selector){return host?.querySelector(selector)}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function setup(){if(host||!(box=document.getElementById('story-chat-box')))return;
 host=el('aside','mima-history-nav');host.setAttribute('aria-label','剧情历史导航');
 host.innerHTML=`<button type="button" class="mima-history-handle" aria-label="展开历史导航" aria-expanded="false"><span class="mima-history-track"><i></i></span></button><section class="mima-history-panel" hidden><div class="mima-history-heading"><strong>📖 历史导航</strong><button type="button" data-go="close" aria-label="收起历史导航">×</button></div><p class="mima-history-info">当前没有消息</p><div class="mima-history-actions"><label>消息序号<input type="number" min="1" inputmode="numeric" data-index="message" placeholder="第几条"><button type="button" data-go="message">定位</button></label><label>完整对话轮数<input type="number" min="1" inputmode="numeric" data-index="turn" placeholder="第几轮"><button type="button" data-go="turn">定位</button></label></div><div class="mima-history-search"><label>离线关键词 / 短语<input type="search" data-search placeholder="搜中文、日文、English…"></label><button type="button" data-go="search">查找</button></div><label class="mima-history-raw"><input type="checkbox" data-raw-search> 同时搜索原始 HTML / 隐藏状态（需手动开启）</label><div class="mima-history-results" role="status"></div><div class="mima-history-pages" hidden><button type="button" data-go="prev-page">上一页</button><span data-page-info></span><button type="button" data-go="next-page">下一页</button></div><div class="mima-history-buttons"><button type="button" data-go="return">返回跳转前</button><button type="button" data-go="latest">最新消息 ↓</button></div><p class="mima-history-note">消息序号包含全部角色；对话轮数按玩家发言计数，不会改写剧情。</p></section>`;
 box.parentNode.insertBefore(host,box.nextSibling);
 host.querySelector('.mima-history-handle').addEventListener('click',()=>toggle(!expanded));
 host.addEventListener('click',event=>{const t=event.target.closest('[data-go],[data-hit]');if(!t)return;
  if(t.dataset.hit!==undefined){const hit=searchHits.find(h=>h.msg.id===t.dataset.hit);if(!hit)return report('搜索结果已失效，请重新搜索。');jumpId(t.dataset.hit);if(searchMode==='visible')focusMatch(t.dataset.hit,searchTerm);return;}
  if(t.dataset.go==='close')return toggle(false);
  if(t.dataset.go==='return')return returnToOrigin();
  if(t.dataset.go==='latest')return jumpLast();
  if(t.dataset.go==='search')return search();
  if(t.dataset.go==='prev-page')return showSearchPage(searchPage-1);
  if(t.dataset.go==='next-page')return showSearchPage(searchPage+1);
  if(t.dataset.go==='message'||t.dataset.go==='turn')return jumpNumber(t.dataset.go,Number($(`[data-index="${t.dataset.go}"]`).value));
 });
 host.addEventListener('keydown',event=>{const type=event.target.dataset.index;if(type&&event.key==='Enter'){event.preventDefault();jumpNumber(type,Number(event.target.value));}if(event.target.dataset.search!==undefined&&event.key==='Enter'){event.preventDefault();search();}});
 box.addEventListener('scroll',()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;refreshProgress()})},{passive:true});
}
function toggle(state){setup();expanded=state;host.classList.toggle('expanded',state);$('.mima-history-panel').hidden=!state;const btn=$('.mima-history-handle');btn.setAttribute('aria-expanded',String(state));btn.setAttribute('aria-label',state?'收起历史导航':'展开历史导航');refreshProgress();}
// Snapshot only fields affecting canonical search and its DOM projection.
// Comparing values, not array identity, handles same-session rehydration.
let messageRevision=[],searchEpoch=0;
// Search projects only the currently visible text. Archived versions are read
// by their own action, so their full bodies do not belong in this revision.
function revisionOf(m){return [m?.id||'',m?.role||'',m?.content||'',!!m?.isEdited];}
function unchangedRevision(next){return next.length===messageRevision.length&&next.every((r,i)=>
 r.every((part,k)=>part===messageRevision[i][k]));}
function sync(id,list){
 setup();if(!host)return;
 const next=Array.isArray(list)?list:[],sameSession=id===session;
 const revisions=next.map(revisionOf),unchanged=sameSession&&unchangedRevision(revisions);if(!unchanged)searchEpoch++;
 if(!sameSession){origin=null;searchHits=[];searchPage=0;searchTerm='';
  $('[data-search]').value='';$('.mima-history-results').replaceChildren();$('.mima-history-pages').hidden=true;
  window.CSS?.highlights?.delete('mima-history-match');}
 session=id;messages=next;messageRevision=revisions;
 const n=messages.length,turns=messages.filter(m=>m.role==='user').length;
 $('.mima-history-info').textContent=`共 ${n} 条消息 · ${turns} 轮玩家对话`;
 $('.mima-history-handle').disabled=n===0;
 // The caller has finished refreshing DOM; invalidate detached node references.
 messageNodes.clear();
 if(sameSession&&!unchanged&&searchTerm){
  const previousPage=searchPage;
  void rebuildSearch(previousPage).catch(error=>report('搜索未完成：'+error.message));
  if(origin?.anchor?.id&&!messages.some(m=>m.id===origin.anchor.id))origin.anchor.id=null;
  report('剧情内容已更新，搜索结果重新核对（'+searchHits.length+' 条）。');
 }
 refreshProgress();
}
function refreshProgress(){if(!host||!box)return;const range=Math.max(0,box.scrollHeight-box.clientHeight);const frac=range?Math.max(0,Math.min(1,box.scrollTop/range)):1;
 const bar=$('.mima-history-track i');if(bar)bar.style.top=`${(frac*94).toFixed(2)}%`;
 $('.mima-history-handle').title=`阅读进度 ${Math.round(frac*100)}% · ${messages.length} 条消息`;}
function visibleMessageAt(view,viewport){
 // Non-monotone CSS (flex order, reverse, grid) cannot use binary geometry search.
 // Hit-test a bounded number of viewport points; this does not scan all History.
 const l=Math.max(viewport.left+4,0),r=Math.min(viewport.right-4,innerWidth-1);
 const ys=[viewport.top+12,viewport.top+34,viewport.top+Math.min(72,viewport.height*.35),viewport.top+viewport.height*.5];
 for(const y of ys){if(y>=viewport.bottom||y<0||y>=innerHeight)continue;
  for(const x of [l+(r-l)*.25,l+(r-l)*.5,l+(r-l)*.75]){
   if(x<0||x>=innerWidth)continue;
   const layers=document.elementsFromPoint?.(x,y)||[];
   for(const layer of layers){const node=layer.closest?.('article.message');
    if(node?.parentElement===view){const bounds=node.getBoundingClientRect();if(bounds.bottom>viewport.top&&bounds.top<viewport.bottom)return node;}}
  }
 }
 return null;
}
function currentAnchor(view=box){
 if(!view)return null;
 const children=view.children,viewport=view.getBoundingClientRect();let candidate=null;
 const mode=getComputedStyle(view),dis=mode.display||'';
 const reordered=dis.includes('flex')||dis.includes('grid');
 if(reordered)candidate=visibleMessageAt(view,viewport);
 else{
  let lo=0,hi=children.length;
  while(lo<hi){const mid=(lo+hi)>>>1;
   if(children[mid].getBoundingClientRect().bottom>viewport.top)hi=mid;else lo=mid+1;
  }
  for(let i=lo;i<children.length&&i<lo+8;i++){
   const node=children[i],rect=node.getBoundingClientRect();
   if(node.classList.contains('message')&&rect.bottom>viewport.top&&rect.top<viewport.bottom){candidate=node;break;}
  }
  if(!candidate)candidate=visibleMessageAt(view,viewport);
 }
 return candidate?{id:candidate.dataset.msgId,offset:candidate.getBoundingClientRect().top-viewport.top,scrollTop:view.scrollTop}:{id:null,offset:0,scrollTop:view.scrollTop};
}
// Geometry is in visual pixels; scrollTop is in unscaled layout pixels.
// Respect the existing UI density and custom scale without changing viewport.
function scrollByVisual(view,delta){
 if(!view||!Number.isFinite(delta))return;
 const rect=view.getBoundingClientRect(),css=getComputedStyle(view);
 let logical=parseFloat(css.height);
 if(css.boxSizing!=='border-box')for(const key of ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'])logical+=parseFloat(css[key])||0;
 if(!(logical>0))logical=view.offsetHeight;
 const scale=logical>0&&rect.height>0?rect.height/logical:1;
 view.scrollTop+=delta/scale;
}
function jumpId(id){const idx=messages.findIndex(m=>m.id===id);if(idx<0)return report('这条消息已被修改或删除，未调整原有历史。');
 if(!origin)origin={session,anchor:currentAnchor()};
 window.MimaNativeHistoryWindow?.ensure(id);const node=findMessageNode(id);
 if(!node)return report('目标尚未显示；不会误跳到其他剧情。');
 scrollByVisual(box,node.getBoundingClientRect().top-box.getBoundingClientRect().top-14);
 node.classList.remove('mima-history-highlight');void node.offsetWidth;node.classList.add('mima-history-highlight');
 const role=messages[idx].role==='user'?'玩家':messages[idx].role==='assistant'?'角色':'系统';report(`已定位第 ${idx+1} 条 · ${role}`);refreshProgress();}
function jumpNumber(kind,n){if(!Number.isSafeInteger(n)||n<1)return report('请输入正整数。');if(kind==='message'){const msg=messages[n-1];if(!msg)return report('消息序号超出当前历史范围。');return jumpId(msg.id);}
 let count=0;const msg=messages.find(m=>{if(m.role==='user')count++;return m.role==='user'&&count===n;});if(!msg)return report('当前剧情没有这一轮玩家发言。');jumpId(msg.id);}
function returnToOrigin(){if(!origin)return report('尚无需要返回的位置。');if(origin.session!==session){origin=null;return report('会话已经切换，已取消旧定位。');}
 const ref=origin.anchor;window.MimaNativeHistoryWindow?.ensure(ref?.id);origin=null;window.CSS?.highlights?.delete('mima-history-match');const node=findMessageNode(ref?.id);
 if(node)scrollByVisual(box,node.getBoundingClientRect().top-box.getBoundingClientRect().top-ref.offset);else box.scrollTop=ref?.scrollTop||0;
 report('已返回跳转前的阅读位置。');refreshProgress();}
function jumpLast(){if(!messages.length)return;const last=messages[messages.length-1];if(!last.id)return;return jumpId(last.id);}
function plain(value){return String(value||'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g,' ');}
function makeMessageIndex(){
 // Rebuilt once per explicit operation; this is a DOM projection, not a History replacement.
 messageNodes=new Map();
 for(const el of box.querySelectorAll(':scope > article.message[data-msg-id]'))if(el.dataset.msgId)messageNodes.set(el.dataset.msgId,el);
 return messageNodes;
}
function findMessageNode(id){if(!id)return null;const node=messageNodes.get(id);
 if(node?.isConnected&&node.parentElement===box)return node;
 return makeMessageIndex().get(id)||null;
}
function visibleText(msg,nodes){
 const content=nodes.get(msg.id)?.querySelector(':scope > .msg-content');
 // innerText excludes display:none, inert templates, style and scripts, matching visible text.
 return content?.innerText||'';
}
function rawText(msg){return String(msg.content||'');}
function focusMatch(id,term){
 if(!term)return;
 window.MimaNativeHistoryWindow?.ensure(id);const content=findMessageNode(id)?.querySelector(':scope > .msg-content');if(!content)return;
 const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);const spans=[];let joined='',part;
 while((part=walker.nextNode())){
  if(!part.nodeValue)continue;
  let parent=part.parentElement,visible=true;
  while(parent&&parent!==content){const css=getComputedStyle(parent);if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'){visible=false;break;}parent=parent.parentElement;}
  if(!visible)continue;
  spans.push({node:part,start:joined.length,end:joined.length+part.nodeValue.length});joined+=part.nodeValue;
 }
 const pos=joined.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());if(pos<0)return;
 const start=spans.find(item=>item.end>pos),end=spans.find(item=>item.end>=pos+term.length);if(!start||!end)return;
 const range=document.createRange();range.setStart(start.node,pos-start.start);range.setEnd(end.node,pos+term.length-end.start);
 const r=range.getBoundingClientRect();if(!r.height)return;
 const boxRect=box.getBoundingClientRect();scrollByVisual(box,r.top-boxRect.top-Math.min(120,boxRect.height*.3));
 if(typeof Highlight!=='undefined'&&window.CSS?.highlights)CSS.highlights.set('mima-history-match',new Highlight(range));
}
function search(){
 const term=$('[data-search]').value.trim();if(!term){searchTerm='';searchHits=[];++searchEpoch;$('.mima-history-results').replaceChildren();$('.mima-history-pages').hidden=true;return report('输入需要查找的文字或短语。');}
 searchTerm=term;searchMode=$('[data-raw-search]').checked?'raw':'visible';return rebuildSearch(0).catch(error=>report('搜索未完成：'+error.message));
}
async function rebuildSearch(page){
 if(!searchTerm)return;const epoch=++searchEpoch,list=messages.slice(),term=searchTerm,raw=searchMode==='raw',needle=term.toLocaleLowerCase(),hits=[];
 const nodes=raw?null:makeMessageIndex();report('正在核对完整历史中的可见文字…');
 for(let i=0;i<list.length;i++){
  if(epoch!==searchEpoch)return;const msg=list[i];if(!msg?.id)continue;
  const source=raw?rawText(msg):window.MimaNativeHistoryWindow?await MimaNativeHistoryWindow.readVisibleText(msg.id,{settle:()=>window.MimaHistoryDisplaySettled?.()}):visibleText(msg,nodes);
  if(epoch!==searchEpoch)return;const pos=source.toLocaleLowerCase().indexOf(needle);
  if(pos>=0)hits.push({msg,i,snippet:source.slice(Math.max(0,pos-22),Math.min(source.length,pos+term.length+36))});
  if(i%24===23)await new Promise(r=>setTimeout(r,0));
 }
 if(epoch!==searchEpoch)return;searchHits=hits;showSearchPage(Math.min(page,Math.max(0,Math.ceil(searchHits.length/100)-1)));report('找到 '+hits.length+' 条消息。');
}

function showSearchPage(page){
 const size=100,pages=Math.ceil(searchHits.length/size);if(!Number.isInteger(page)||page<0||page>=Math.max(1,pages))return;
 searchPage=page;const results=$('.mima-history-results');results.replaceChildren();
 results.appendChild(el('p','',`找到 ${searchHits.length} 条消息 · ${searchMode==='raw'?'原始内容（含隐藏 HTML）':'可见剧情文字'} · 无网络请求`));
 for(const hit of searchHits.slice(page*size,(page+1)*size)){
  const button=el('button','mima-history-hit',`#${hit.i+1} · ${hit.msg.role==='user'?'玩家':'角色'}：${hit.snippet}`);
  button.type='button';button.dataset.hit=hit.msg.id;results.appendChild(button);
 }
 const pager=$('.mima-history-pages');pager.hidden=pages<=1;
 $('[data-page-info]').textContent=`${page+1} / ${Math.max(1,pages)} 页`;
 $('[data-go="prev-page"]').disabled=page===0;$('[data-go="next-page"]').disabled=page>=pages-1;
 results.scrollTop=0;
}
function report(message){if(host)$('.mima-history-info').textContent=message;}
window.MimaHistoryNavigator={sync,refreshProgress,jumpId,jumpNumber,search,returnToOrigin,captureAnchor:currentAnchor,scrollByVisual};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
