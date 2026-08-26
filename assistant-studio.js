/**
 * ✦ MIMAMAO Tavern Assistant Studio
 * Regex Assistant / Preset Assistant / CSS Beauty Assistant
 * Uses the story API connection, but keeps an independent model / temperature / persona per assistant.
 */
(() => {
  'use strict';

  const STORAGE_KEY='MIMAMAO_TAVERN_ASSISTANT_STUDIO_V1';
  const TYPES=['regex','preset','css'];
  const META={
    regex:{title:'正则助手',icon:'🧬',quick:'HTML 状态栏 → 正则省 Token',placeholder:'把输出规范 / HTML 状态栏 / 正则需求贴给我……'},
    preset:{title:'预设助手',icon:'🧩',quick:'生成可直接保存的预设',placeholder:'告诉我你想要的文风、行为规则、输出格式……'},
    css:{title:'CSS 美化助手',icon:'🎨',quick:'设计可直接保存的 CSS',placeholder:'告诉我你想把咪嘛馆 / 状态栏美化成什么样……'}
  };
  const DEFAULTS={
    regex:{model:'',temperature:.3,stream:true,maxTokens:0,persona:'你是谨慎、精确、特别擅长 JavaScript RegExp 与提示词压缩的前端工具设计师。',style:'优先给可直接使用的结果；命名清楚；避免脆弱的超长正则；对动态字段使用捕获组。'},
    preset:{model:'',temperature:.65,stream:true,maxTokens:0,persona:'你是高级 AIRP 提示词 / 预设设计师，擅长把模糊审美要求写成可执行的模型约束。',style:'高信息密度、少废话、规则结构清晰；不擅自删减用户已有要求。'},
    css:{model:'',temperature:.7,stream:true,maxTokens:0,persona:'你是移动端视觉设计师与 CSS 专家，擅长轻盈玻璃、二次元与小说阅读界面的精细美化。',style:'优先兼容 iOS Safari；只写 CSS；避免破坏布局、按钮可点击性和 Safe HTML。'}
  };
  let state=loadState();
  let activeType='regex';
  let controller=null;
  let generating=false;
  let draftAssistantText='';
  let cachedModels=[];
  let nextQuickMode='';

  function clone(v){return JSON.parse(JSON.stringify(v));}
  function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));}
  function clampTemp(v,fallback=.5){const n=Number(v);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):fallback;}
  function loadState(){
    let raw={};try{raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch(_){}
    const profiles={},threads={};
    for(const type of TYPES){profiles[type]={...DEFAULTS[type],...(raw.profiles?.[type]||{})};profiles[type].temperature=clampTemp(profiles[type].temperature,DEFAULTS[type].temperature);profiles[type].maxTokens=Math.max(0,Math.min(131072,Math.floor(Number(profiles[type].maxTokens)||0)));profiles[type].stream=profiles[type].stream!==false;profiles[type].sendTemperature=profiles[type].sendTemperature!==false;threads[type]=Array.isArray(raw.threads?.[type])?raw.threads[type]:[];}
    return {profiles,threads};
  }
  function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  function profile(){return state.profiles[activeType];}
  function thread(){return state.threads[activeType];}
  function notify(msg){if(typeof window.toast==='function')window.toast(msg);else console.log(msg);}
  function formatTime(v){try{return new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}catch(_){return''}}

  function parseArtifact(raw){
    const text=String(raw||'');
    const marker=text.match(/<MIMA_ARTIFACT>\s*([\s\S]*?)\s*<\/MIMA_ARTIFACT>/i);
    if(marker){try{return JSON.parse(marker[1])}catch(_){return null}}
    const fenced=text.match(/```json\s*([\s\S]*?)```/i);
    if(fenced){try{const obj=JSON.parse(fenced[1]);if(obj?.kind)return obj}catch(_){}}
    return null;
  }
  function visibleAssistantText(raw){return String(raw||'').replace(/<MIMA_ARTIFACT>[\s\S]*?<\/MIMA_ARTIFACT>/ig,'').trim();}

  function baseSystem(type){
    if(type==='regex')return `你是“咪嘛馆 Regex 正则助手”。你帮助用户设计正则包，并把冗长 HTML 输出规范转换成“模型输出短协议 + 前端 display 正则展开完整 HTML”的省 Token 方案。\n\n硬规则：\n1. 不删除用户原有输出字段，只压缩重复 HTML 壳。\n2. 优先使用 phase=display，让 compact 原文保留在剧情 Prompt 中，完整 HTML 只在前端显示时展开。只有用户明确需要时才使用 input/prompt/output。\n3. 正则必须是浏览器 JavaScript RegExp 可用语法；flags 通常为 g 或 gi；replacement 可以使用 $1/$2。\n4. Replacement 只能是文本/HTML，不得包含 script、事件处理器或可执行代码。\n5. 如果用户提供 HTML 状态栏：先抽取真正动态字段，再设计短标签协议。协议应明显短于 HTML，例如 <ST>...字段...</ST> 或固定分隔符。\n6. “配套预设”必须明确告诉剧情模型只输出短协议，而不是完整 HTML。\n7. 需要交付可保存成果时，在解释后输出且只输出一个结构化工件块：\n<MIMA_ARTIFACT>\n{"kind":"regex_bundle","preset":{"name":"...","type":"format","description":"...","priority":50,"content":"...转换后的短协议输出规范..."},"regexPack":{"name":"...","description":"...","priority":50,"enabled":true,"rules":[{"name":"...","pattern":"...","replacement":"...","flags":"g","phase":"display","priority":50,"enabled":true,"description":"..."}]}}\n</MIMA_ARTIFACT>\n工件块必须是严格 JSON，不要放进 Markdown code fence。`;
    if(type==='preset')return `你是“咪嘛馆 Preset 预设助手”。你负责写作/改写 AIRP 预设、文风规则、角色行为约束、输出格式协议与模型控制提示。\n\n硬规则：\n1. 用户已有规则一律保留，除非用户明确要求删除。\n2. 把审美要求转换成可执行、可判断、低歧义的提示词；避免空泛“写得更好”。\n3. 可以设计 style / format / behavior / model 类型预设。\n4. 需要交付可保存预设时，在解释后输出：\n<MIMA_ARTIFACT>\n{"kind":"preset","preset":{"name":"...","type":"style","description":"...","priority":50,"content":"...完整预设内容..."}}\n</MIMA_ARTIFACT>\n工件块必须是严格 JSON。`;
    return `你是“咪嘛馆 CSS 美化助手”。你负责为咪嘛馆 UI、剧情区域与 Safe HTML 状态栏设计纯 CSS。\n\n硬规则：\n1. 只生成 CSS，不使用 JavaScript，不要求修改旧 HTML 结构，除非用户明确说可以。\n2. 默认移动端/iOS Safari 优先，保持按钮可点、文字可读、输入框可用。\n3. 若用户给现有 CSS，优先增量覆盖，不顺手重构或删掉正常规则。\n4. scope 可选 story（自定义 HTML/剧情内容）、global（剧情聊天区域）、app（全局 UI + HTML）。\n5. 需要交付可保存 CSS 时，在解释后输出：\n<MIMA_ARTIFACT>\n{"kind":"css_preset","cssPreset":{"name":"...","scope":"story","css":"...完整 CSS..."}}\n</MIMA_ARTIFACT>\n工件块必须是严格 JSON。`;
  }
  function systemPrompt(type){const p=state.profiles[type];return `${baseSystem(type)}\n\n【助手 Persona】\n${p.persona||'(无额外 persona)'}\n\n【设计风格】\n${p.style||'(无额外风格)'}`;}
  function quickInstruction(type){
    if(type==='regex')return '【快捷任务：HTML 状态栏 → 正则省 Token】请把我下面提供的输出规范中重复、冗长的 HTML 壳转换为短协议，并生成配套 format 预设 + display 正则包。动态字段必须完整保留。务必输出 regex_bundle 工件。';
    if(type==='preset')return '【快捷任务：生成可保存预设】请把我的需求写成一个可以直接挂载到咪嘛馆的预设，并输出 preset 工件。';
    return '【快捷任务：生成可保存 CSS】请按我的要求设计一份可直接保存的咪嘛馆 CSS Preset，并输出 css_preset 工件。';
  }

  function open(type='regex'){
    if(TYPES.includes(type))activeType=type;
    const modal=document.getElementById('assistant-modal');if(!modal)return;
    modal.classList.remove('hidden');nextQuickMode='';render();
  }
  function close(){if(controller)controller.abort();controller=null;generating=false;draftAssistantText='';document.getElementById('assistant-modal')?.classList.add('hidden');}
  function switchType(type){if(!TYPES.includes(type)||generating)return;activeType=type;nextQuickMode='';draftAssistantText='';render();}
  function setQuickMode(){nextQuickMode=activeType;render();setTimeout(()=>document.getElementById('assistant-input')?.focus(),20);}

  function profileFormHtml(){const p=profile(),storyCfg=window.MimaStandalone?.getApiConfig?.()||{};return `<div class="assistant-config-card"><div class="assistant-config-head"><strong>独立助手模型</strong><span class="tag">正文模型不受影响</span></div><label class="form-label">Model（模型）</label><div class="inline-field-row"><select id="assistant-model-select" class="field" onchange="MimaAssistantStudio.selectModel(this.value)"><option value="">${p.model?esc(p.model):`沿用当前名称：${esc(storyCfg.model||'未选择')}`}</option>${cachedModels.map(m=>`<option value="${esc(m)}" ${m===p.model?'selected':''}>${esc(m)}</option>`).join('')}</select><button class="ghost-btn" onclick="MimaAssistantStudio.loadModels()">拉取模型</button></div><input id="assistant-model-manual" class="field" placeholder="也可以手动填写，例如 gpt-5.6-sol" value="${esc(p.model||'')}" onchange="MimaAssistantStudio.setProfileField('model',this.value)"><label class="form-label">Temperature（温度） <span id="assistant-temp-value" class="value-pill">${Number(p.temperature).toFixed(2)}</span></label><input class="temp-range" type="range" min="0.1" max="2" step="0.05" value="${Number(p.temperature)}" oninput="MimaAssistantStudio.setProfileField('temperature',this.value);document.getElementById('assistant-temp-value').textContent=Number(this.value).toFixed(2)"><label class="form-label">Assistant Max Tokens（助手独立最大输出，0=不发送限制）</label><input class="field" type="number" min="0" max="131072" step="256" value="${Number(p.maxTokens||0)}" onchange="MimaAssistantStudio.setProfileField('maxTokens',this.value)"><div class="row-sub">不会再继承正文的 Max Tokens。建议先保持 0；若中转站要求显式限制，可填 4096–8192。</div><label class="check-row"><input type="checkbox" ${p.stream?'checked':''} onchange="MimaAssistantStudio.setProfileField('stream',this.checked)"> 助手 Streaming（流式）</label><label class="check-row"><input type="checkbox" ${p.sendTemperature!==false?'checked':''} onchange="MimaAssistantStudio.setProfileField('sendTemperature',this.checked)"> 向助手模型发送 Temperature</label><details class="assistant-persona-details"><summary>Persona / 设计风格</summary><label class="form-label">助手 Persona</label><textarea class="field textarea" onchange="MimaAssistantStudio.setProfileField('persona',this.value)">${esc(p.persona||'')}</textarea><label class="form-label">设计风格</label><textarea class="field textarea" onchange="MimaAssistantStudio.setProfileField('style',this.value)">${esc(p.style||'')}</textarea></details><div class="row-sub">助手继承正文 API 的 Base URL / Key / Headers，但 <strong>Model、Temperature 与 Max Tokens 分开保存</strong>。正文的巨大输出上限不会再被助手请求继承。</div></div>`;}

  function artifactButtons(artifact,index){
    if(!artifact)return'';
    if(artifact.kind==='regex_bundle')return `<div class="assistant-artifact-card"><strong>🧬 已识别 Regex Bundle</strong><div class="row-sub">包含配套预设 + 正则包，可一键保存并挂载到当前剧情。</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'all')">一键保存 + 挂载</button><button class="ghost-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'regex')">只存正则</button><button class="ghost-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'preset')">只存预设</button></div><details><summary>查看工件 JSON</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    if(artifact.kind==='preset')return `<div class="assistant-artifact-card"><strong>🧩 已识别 Preset</strong><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'preset')">保存并挂载预设</button></div><details><summary>查看工件 JSON</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    if(artifact.kind==='css_preset')return `<div class="assistant-artifact-card"><strong>🎨 已识别 CSS Preset</strong><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'css')">保存并应用 CSS</button></div><details><summary>查看工件 JSON</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    return'';
  }

  function messagesHtml(){
    const items=thread();
    let html=items.map((m,i)=>{const artifact=m.role==='assistant'?parseArtifact(m.content):null;const shown=m.role==='assistant'?visibleAssistantText(m.content):m.content;return `<article class="assistant-chat-msg ${m.role==='user'?'assistant-chat-user':'assistant-chat-ai'}"><div class="assistant-chat-meta">${m.role==='user'?'你':META[activeType].title} · ${formatTime(m.time)}</div><div class="assistant-chat-text">${esc(shown).replace(/\n/g,'<br>')}</div>${artifactButtons(artifact,i)}</article>`}).join('');
    if(generating){html+=`<article class="assistant-chat-msg assistant-chat-ai assistant-chat-streaming"><div class="assistant-chat-meta">${META[activeType].title} · 正在生成</div><div class="assistant-chat-text">${esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>')}</div></article>`;}
    if(!html)html='<div class="assistant-empty"><div class="empty-icon">'+META[activeType].icon+'</div><strong>'+META[activeType].title+'已就位</strong><p>它有独立模型、温度、Persona 与聊天记录。你可以把素材直接贴进下面的大输入框。</p></div>';
    return html;
  }

  function render(){
    const root=document.getElementById('assistant-studio-root');if(!root)return;
    const meta=META[activeType];document.getElementById('assistant-studio-title').textContent=meta.title;
    root.innerHTML=`<aside class="assistant-sidebar"><div class="assistant-type-tabs">${TYPES.map(t=>`<button class="assistant-type-btn ${t===activeType?'active':''}" onclick="MimaAssistantStudio.switchType('${t}')">${META[t].icon} ${META[t].title}</button>`).join('')}</div>${profileFormHtml()}<button class="danger-btn wide" onclick="MimaAssistantStudio.clearThread()" ${generating?'disabled':''}>清空当前助手聊天</button></aside><section class="assistant-main"><div class="assistant-chat-scroll" id="assistant-chat-scroll">${messagesHtml()}</div><div class="assistant-composer"><div class="assistant-quick-row"><button class="chip-btn ${nextQuickMode===activeType?'active':''}" onclick="MimaAssistantStudio.setQuickMode()">⚡ ${meta.quick}</button>${generating?'<button class="chip-btn danger" onclick="MimaAssistantStudio.stop()">■ 停止</button>':''}</div>${nextQuickMode===activeType?'<div class="assistant-mode-banner">下一条会以快捷任务模式发送；原文不会被改写后再存。</div>':''}<div class="assistant-input-row"><textarea id="assistant-input" rows="4" placeholder="${esc(meta.placeholder)}" ${generating?'disabled':''}></textarea><button class="send-btn assistant-send-btn" onclick="MimaAssistantStudio.send()" ${generating?'disabled':''}>➤</button></div><div class="row-sub">Enter 只换行；只有点击发送键才会调用助手模型。</div></div></section>`;
    requestAnimationFrame(()=>{const sc=document.getElementById('assistant-chat-scroll');if(sc)sc.scrollTop=sc.scrollHeight;});
  }

  function setProfileField(key,value,rerender=false){const p=profile();if(key==='temperature')p.temperature=clampTemp(value,p.temperature);else if(key==='maxTokens')p.maxTokens=Math.max(0,Math.min(131072,Math.floor(Number(value)||0)));else if(key==='stream'||key==='sendTemperature')p[key]=!!value;else p[key]=String(value??'');saveState();if(rerender)render();}
  function selectModel(value){if(value)setProfileField('model',value,true);}
  async function loadModels(){
    try{cachedModels=await window.MimaStandalone.listModels();const p=profile();if(!p.model&&cachedModels.length){p.model=cachedModels[0];saveState()}render();notify(`助手可选模型已拉取：${cachedModels.length} 个`);}catch(e){notify(`拉取助手模型失败：${e.message||e}`)}
  }
  function clearThread(){if(!confirm(`清空${META[activeType].title}的本地聊天记录？不会删除已保存的预设/正则/CSS。`))return;state.threads[activeType]=[];saveState();render();}
  function stop(){if(controller)controller.abort();controller=null;generating=false;draftAssistantText='';render();}

  async function send(){
    if(generating)return;
    const input=document.getElementById('assistant-input');const raw=input?.value||'';if(!raw.trim())return;
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model){notify('先去 🔌 API 设置配置连接，并给助手选择一个模型猫。');return;}
    const userContent=(nextQuickMode===activeType?`${quickInstruction(activeType)}\n\n【用户素材】\n${raw}`:raw);
    thread().push({role:'user',content:raw,time:new Date().toISOString()});saveState();nextQuickMode='';generating=true;draftAssistantText='';render();
    const history=thread().slice(-30).map(m=>({role:m.role,content:m.role==='assistant'?m.content:(m===thread()[thread().length-1]?userContent:m.content)}));
    const messages=[{role:'system',content:systemPrompt(activeType)},...history];
    const cfg={...storyCfg,model,temperature:p.temperature,stream:p.stream,sendTemperature:p.sendTemperature!==false,maxTokens:Number(p.maxTokens)||0};controller=new AbortController();
    try{
      const reply=await window.MimaStandalone.callModelWithConfig(messages,cfg,p.temperature,controller.signal,{streamOverride:p.stream,onProgress:payload=>{if(payload?.streamText!==undefined){draftAssistantText=String(payload.streamText||'');const textEl=document.querySelector('.assistant-chat-streaming .assistant-chat-text');if(textEl)textEl.innerHTML=esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>');const sc=document.getElementById('assistant-chat-scroll');if(sc)sc.scrollTop=sc.scrollHeight;}}});
      thread().push({role:'assistant',content:reply,time:new Date().toISOString()});saveState();generating=false;draftAssistantText='';controller=null;render();
    }catch(e){generating=false;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('助手生成已停止');render();return}const status=Number(e?.status)||0;const billing=/余额|insufficient|balance|quota|credit|billing/i.test(String(e?.message||''));const extra=billing?'；这是上游/中转站计费拒绝，不代表本地数据丢失。已确保助手不再继承正文 Max Tokens，可保持助手 Max Tokens=0 后重试。':(e?.hint?`；${e.hint}`:'');notify(`助手调用失败${status?` · HTTP ${status}`:''}：${e.message||e}${extra}`);render();}
  }

  async function saveArtifact(index,mode){
    const msg=thread()[index];const artifact=parseArtifact(msg?.content);if(!artifact)return notify('这条消息里没有可保存的结构化工件。');
    const bridge=window.MimaTavernBridge,session=bridge?.getSession?.();
    try{
      if(artifact.kind==='regex_bundle'&&mode==='all'&&!artifact.preset?.content)throw new Error('工件缺少 preset.content，未写入任何新工件。');
      if(artifact.kind==='css_preset'&&mode==='css'&&!artifact.cssPreset?.css)throw new Error('工件缺少 CSS 内容，未写入任何新工件。');
      let savedRegex=null,savedPreset=null,savedCss=null;
      if(artifact.kind==='regex_bundle'&&(mode==='all'||mode==='regex')){
        const checked=window.MimaRegexEngine.validatePack({...artifact.regexPack,id:undefined,createdAt:undefined,updatedAt:undefined});if(!checked.ok)throw new Error(`正则无效：${checked.invalid.map(x=>`${x.name}: ${x.error}`).join('；')}`);
        const res=await window.MimaStandalone.handle('/regex-packs','POST',checked.pack);if(!res.success)throw new Error(res.msg||'正则包保存失败');savedRegex=res.data;
      }
      if((artifact.kind==='regex_bundle'&&(mode==='all'||mode==='preset'))||(artifact.kind==='preset'&&mode==='preset')){
        const preset=artifact.kind==='preset'?artifact.preset:artifact.preset;if(!preset?.content)throw new Error('工件缺少 preset.content');const res=await window.MimaStandalone.handle('/presets','POST',{...preset,id:undefined,createdAt:undefined,updatedAt:undefined});if(!res.success)throw new Error(res.msg||'预设保存失败');savedPreset=res.data;
      }
      if(artifact.kind==='css_preset'&&mode==='css'){
        const css=artifact.cssPreset;if(!css?.css)throw new Error('工件缺少 CSS 内容');const res=await window.MimaStandalone.handle('/css-presets','POST',{...css,id:undefined,createdAt:undefined,updatedAt:undefined});if(!res.success)throw new Error(res.msg||'CSS 保存失败');savedCss=res.data;
      }
      if(session&&bridge){
        const patch={};if(savedRegex)patch.regexPackIds=[...new Set([...(session.regexPackIds||[]),savedRegex.id])];if(savedPreset)patch.presetIds=[...new Set([...(session.presetIds||[]),savedPreset.id])];if(savedCss){patch.customCssId=savedCss.id;patch.customCssEnabled=true;}if(Object.keys(patch).length){const patched=await bridge.patchCurrent(patch);if(!patched)throw new Error('工件已经保存，但挂载当前剧情失败；未覆盖任何旧数据。');}
        await bridge.reload();
      }
      const mounted=!!session;if(savedCss)notify(mounted?`CSS「${savedCss.name}」已保存并应用`:`CSS「${savedCss.name}」已保存；创建/打开剧情后即可应用`);else if(savedRegex&&savedPreset)notify(mounted?'正则包 + 配套预设已保存并挂载 ✨':'正则包 + 配套预设已保存；打开剧情后即可挂载 ✨');else if(savedRegex)notify(mounted?`正则包「${savedRegex.name}」已保存并挂载`:`正则包「${savedRegex.name}」已保存`);else if(savedPreset)notify(mounted?`预设「${savedPreset.name}」已保存并挂载`:`预设「${savedPreset.name}」已保存`);
    }catch(e){notify(`保存工件失败：${e.message||e}`)}
  }

  window.MimaAssistantStudio={open,close,switchType,setQuickMode,setProfileField,selectModel,loadModels,clearThread,stop,send,saveArtifact,getState:()=>clone(state)};
})();
