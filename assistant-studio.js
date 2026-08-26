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
  let generationMode='send';
  let regeneratingIndex=-1;
  let editingIndex=-1;
  let assistantFollowTail=true;

  function clone(v){return JSON.parse(JSON.stringify(v));}
  function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));}
  function clampTemp(v,fallback=.5){const n=Number(v);return Number.isFinite(n)?Math.max(.1,Math.min(2,n)):fallback;}
  function loadState(){
    let raw={};try{raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch(_){}
    const profiles={},threads={};
    for(const type of TYPES){profiles[type]={...DEFAULTS[type],...(raw.profiles?.[type]||{})};profiles[type].temperature=clampTemp(profiles[type].temperature,DEFAULTS[type].temperature);profiles[type].maxTokens=Math.max(0,Math.min(131072,Math.floor(Number(profiles[type].maxTokens)||0)));profiles[type].stream=profiles[type].stream!==false;profiles[type].sendTemperature=profiles[type].sendTemperature!==false;threads[type]=Array.isArray(raw.threads?.[type])?raw.threads[type]:[];}
    return {profiles,threads,ui:{configOpen:!!raw.ui?.configOpen}};
  }
  function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  function profile(){return state.profiles[activeType];}
  function thread(){return state.threads[activeType];}
  function notify(msg){if(typeof window.toast==='function')window.toast(msg);else console.log(msg);}
  function formatTime(v){try{return new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}catch(_){return''}}

  function extractArtifactCandidate(raw){
    const text=String(raw||'');
    const marker=text.match(/<MIMA_ARTIFACT>\s*([\s\S]*?)\s*<\/MIMA_ARTIFACT>/i);
    if(marker)return {found:true,source:'marker',candidate:marker[1],full:marker[0]};
    const fenced=text.match(/```json\s*([\s\S]*?)```/i);
    if(fenced)return {found:true,source:'fence',candidate:fenced[1],full:fenced[0]};
    return {found:false,source:'',candidate:'',full:''};
  }
  function escapeRawJsonControls(text){
    let out='',inString=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inString){
        if(escaped){out+=ch;escaped=false;continue}
        if(ch==='\\'){out+=ch;escaped=true;continue}
        if(ch==='"'){out+=ch;inString=false;continue}
        if(ch==='\n'){out+='\\n';continue}
        if(ch==='\r'){out+='\\r';continue}
        if(ch==='\t'){out+='\\t';continue}
        out+=ch;continue;
      }
      out+=ch;if(ch==='"')inString=true;
    }
    return out;
  }
  function removeTrailingJsonCommas(text){
    let out='',inString=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inString){out+=ch;if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch==='"')inString=false;continue}
      if(ch==='"'){inString=true;out+=ch;continue}
      if(ch===','){let j=i+1;while(j<text.length&&/\s/.test(text[j]))j++;if(text[j]==='}'||text[j]===']')continue}
      out+=ch;
    }
    return out;
  }
  // v1.1.4 Artifact Self-Healing: safe syntax repair only. Never eval model output.
  function stripLooseJsonComments(text){
    let out='',quote='',escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i],next=text[i+1];
      if(quote){out+=ch;if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch===quote)quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;out+=ch;continue}
      if(ch==='/'&&next==='/'){i+=2;while(i<text.length&&text[i]!=='\n'&&text[i]!=='\r')i++;if(i<text.length)out+=text[i];continue}
      if(ch==='/'&&next==='*'){i+=2;while(i<text.length-1&&!(text[i]==='*'&&text[i+1]==='/'))i++;i++;continue}
      out+=ch;
    }
    return out;
  }
  function quoteBareJsonKeys(text){
    let out='',quote='',escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quote){out+=ch;if(escaped){escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch===quote)quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;out+=ch;continue}
      out+=ch;
      if(ch!=='{'&&ch!==',')continue;
      let j=i+1,ws='';while(j<text.length&&/\s/.test(text[j])){ws+=text[j];j++}
      const m=text.slice(j).match(/^([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/);
      if(!m)continue;
      const key=m[1],colonIndex=j+m[0].lastIndexOf(':');
      out+=ws+JSON.stringify(key)+text.slice(j+key.length,colonIndex+1);
      i=colonIndex;
    }
    return out;
  }
  function decodeLooseSingleQuotedBody(body){
    let out='';
    for(let i=0;i<body.length;i++){
      const ch=body[i];if(ch!=='\\'){out+=ch;continue}
      const next=body[++i];if(next===undefined){out+='\\';break}
      const map={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
      if(Object.prototype.hasOwnProperty.call(map,next)){out+=map[next];continue}
      if(next==='\\'||next==="'"||next==='"'||next==='/'){out+=next;continue}
      if(next==='u'&&/^[0-9a-fA-F]{4}$/.test(body.slice(i+1,i+5))){out+=String.fromCharCode(parseInt(body.slice(i+1,i+5),16));i+=4;continue}
      // Unknown escapes are important in regex (e.g. \s). Preserve the slash.
      out+='\\'+next;
    }
    return out;
  }
  function convertSingleQuotedJsonStrings(text){
    let out='',inDouble=false,doubleEscaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inDouble){out+=ch;if(doubleEscaped){doubleEscaped=false;continue}if(ch==='\\'){doubleEscaped=true;continue}if(ch==='"')inDouble=false;continue}
      if(ch==='"'){inDouble=true;out+=ch;continue}
      if(ch!=="'"){out+=ch;continue}
      let body='',escaped=false,closed=false;
      for(i=i+1;i<text.length;i++){
        const c=text[i];
        if(escaped){body+='\\'+c;escaped=false;continue}
        if(c==='\\'){escaped=true;continue}
        if(c==="'"){closed=true;break}
        body+=c;
      }
      if(!closed){out+="'"+body;break}
      out+=JSON.stringify(decodeLooseSingleQuotedBody(body));
    }
    return out;
  }
  function escapeInvalidJsonBackslashes(text){
    let out='',inString=false,escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(!inString){out+=ch;if(ch==='"')inString=true;continue}
      if(escaped){out+=ch;escaped=false;continue}
      if(ch==='"'){out+=ch;inString=false;continue}
      if(ch!=='\\'){out+=ch;continue}
      const next=text[i+1];
      if(next&&'"\\/bfnrt'.includes(next)){out+=ch;escaped=true;continue}
      if(next==='u'&&/^[0-9a-fA-F]{4}$/.test(text.slice(i+2,i+6))){out+=ch;escaped=true;continue}
      out+='\\\\';
    }
    return out;
  }
  function normalizeArtifactJson(raw){
    let text=String(raw||'').replace(/^\uFEFF/,'').replace(/\u00a0/g,' ').trim();
    text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)text=text.slice(first,last+1);
    text=escapeRawJsonControls(text);
    text=removeTrailingJsonCommas(text);
    return text.trim();
  }
  function repairLooseArtifactJson(raw){
    let text=String(raw||'').replace(/^\uFEFF/,'').replace(/\u00a0/g,' ').trim();
    text=text.replace(/^```(?:json|json5|javascript|js)?\s*/i,'').replace(/\s*```$/,'').trim();
    const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)text=text.slice(first,last+1);
    text=stripLooseJsonComments(text);
    text=quoteBareJsonKeys(text);
    text=convertSingleQuotedJsonStrings(text);
    text=escapeRawJsonControls(text);
    text=escapeInvalidJsonBackslashes(text);
    text=removeTrailingJsonCommas(text);
    return text.trim();
  }
  function parseArtifactDetailed(raw){
    const extracted=extractArtifactCandidate(raw);if(!extracted.found)return {found:false,artifact:null,error:'',source:'',repaired:false,repairLevel:''};
    const candidates=[
      {text:String(extracted.candidate||'').trim(),repaired:false,repairLevel:'strict'},
      {text:normalizeArtifactJson(extracted.candidate),repaired:true,repairLevel:'safe'},
      {text:repairLooseArtifactJson(extracted.candidate),repaired:true,repairLevel:'self_heal'}
    ];
    const seen=new Set();let lastError='';
    for(const attempt of candidates){
      if(!attempt.text||seen.has(attempt.text))continue;seen.add(attempt.text);
      try{const obj=JSON.parse(attempt.text);if(obj&&typeof obj==='object'&&!Array.isArray(obj)&&obj.kind)return {found:true,artifact:obj,error:'',source:extracted.source,repaired:attempt.repaired,repairLevel:attempt.repairLevel};lastError='JSON 已解析，但缺少 kind 字段。'}catch(e){lastError=e?.message||String(e)}
    }
    return {found:true,artifact:null,error:lastError||'无法解析工件 JSON。',source:extracted.source,repaired:false,repairLevel:''};
  }
  function parseArtifact(raw){return parseArtifactDetailed(raw).artifact;}
  function visibleAssistantText(raw){return String(raw||'').replace(/<MIMA_ARTIFACT>[\s\S]*?<\/MIMA_ARTIFACT>/ig,'').trim();}
  function artifactJsonProtocol(){return `【MIMA_ARTIFACT 严格 JSON 协议】\n当输出 <MIMA_ARTIFACT> 时，内部必须是严格 RFC 8259 JSON。\n1. 所有对象属性名与字符串都必须使用英文双引号；禁止单引号属性、裸属性名。\n2. 禁止 JavaScript Object Literal、JSON5、JSONC、尾逗号、// 注释、/* */ 注释、RegExp literal。\n3. 正则 pattern/ replacement 必须作为 JSON 字符串；反斜杠必须符合 JSON 转义，例如正则 \\s 在 JSON 源文本中写成 \\\\s。\n4. HTML 字符串内部的双引号必须进行 JSON 转义。\n5. <MIMA_ARTIFACT> 内只能有一个完整 JSON object，不套 Markdown code fence。\n6. 输出前自行确认 JSON.parse(工件内容) 可以成功。若不确定，请先修正语法，不得输出半成品。`;}


  function baseSystem(type){
    if(type==='regex')return `你是“咪嘛馆 Regex 正则助手”。你帮助用户设计正则包，并把冗长 HTML 输出规范转换成“模型输出短协议 + 前端 display 正则展开完整 HTML”的省 Token 方案。\n\n硬规则：\n1. 不删除用户原有输出字段，只压缩重复 HTML 壳。\n2. 优先使用 phase=display，让 compact 原文保留在剧情 Prompt 中，完整 HTML 只在前端显示时展开。只有用户明确需要时才使用 input/prompt/output。\n3. 正则必须是浏览器 JavaScript RegExp 可用语法；flags 通常为 g 或 gi；replacement 可以使用 $1/$2。\n4. Replacement 只能是文本/HTML，不得包含 script、事件处理器或可执行代码。\n5. 如果用户提供 HTML 状态栏：先抽取真正动态字段，再设计短标签协议。协议应明显短于 HTML，例如 <ST>...字段...</ST> 或固定分隔符。\n6. “配套预设”必须明确告诉剧情模型只输出短协议，而不是完整 HTML。\n7. 需要交付可保存成果时，在解释后输出且只输出一个结构化工件块：\n<MIMA_ARTIFACT>\n{"kind":"regex_bundle","preset":{"name":"...","type":"format","description":"...","priority":50,"content":"...转换后的短协议输出规范..."},"regexPack":{"name":"...","description":"...","priority":50,"enabled":true,"rules":[{"name":"...","pattern":"...","replacement":"...","flags":"g","phase":"display","priority":50,"enabled":true,"description":"..."}]}}\n</MIMA_ARTIFACT>\n工件块必须是严格 JSON，不要放进 Markdown code fence。`;
    if(type==='preset')return `你是“咪嘛馆 Preset 预设助手”。你负责写作/改写 AIRP 预设、文风规则、角色行为约束、输出格式协议与模型控制提示。\n\n硬规则：\n1. 用户已有规则一律保留，除非用户明确要求删除。\n2. 把审美要求转换成可执行、可判断、低歧义的提示词；避免空泛“写得更好”。\n3. 可以设计 style / format / behavior / model 类型预设。\n4. 需要交付可保存预设时，在解释后输出：\n<MIMA_ARTIFACT>\n{"kind":"preset","preset":{"name":"...","type":"style","description":"...","priority":50,"content":"...完整预设内容..."}}\n</MIMA_ARTIFACT>\n工件块必须是严格 JSON。`;
    return `你是“咪嘛馆 CSS 美化助手”。你负责为咪嘛馆 UI、剧情区域与 Safe HTML 状态栏设计纯 CSS。\n\n硬规则：\n1. 只生成 CSS，不使用 JavaScript，不要求修改旧 HTML 结构，除非用户明确说可以。\n2. 默认移动端/iOS Safari 优先，保持按钮可点、文字可读、输入框可用。\n3. 若用户给现有 CSS，优先增量覆盖，不顺手重构或删掉正常规则。\n4. scope 可选 story（自定义 HTML/剧情内容）、global（剧情聊天区域）、app（全局 UI + HTML）。\n5. 需要交付可保存 CSS 时，在解释后输出：\n<MIMA_ARTIFACT>\n{"kind":"css_preset","cssPreset":{"name":"...","scope":"story","css":"...完整 CSS..."}}\n</MIMA_ARTIFACT>\n工件块必须是严格 JSON。`;
  }
  function systemPrompt(type){const p=state.profiles[type];return `${baseSystem(type)}\n\n${artifactJsonProtocol()}\n\n【助手 Persona】\n${p.persona||'(无额外 persona)'}\n\n【设计风格】\n${p.style||'(无额外风格)'}`;}
  function quickInstruction(type){
    if(type==='regex')return '【快捷任务：HTML 状态栏 → 正则省 Token】请把我下面提供的输出规范中重复、冗长的 HTML 壳转换为短协议，并生成配套 format 预设 + display 正则包。动态字段必须完整保留。务必输出 regex_bundle 工件。';
    if(type==='preset')return '【快捷任务：生成可保存预设】请把我的需求写成一个可以直接挂载到咪嘛馆的预设，并输出 preset 工件。';
    return '【快捷任务：生成可保存 CSS】请按我的要求设计一份可直接保存的咪嘛馆 CSS Preset，并输出 css_preset 工件。';
  }

  function open(type='regex'){
    if(TYPES.includes(type))activeType=type;
    const modal=document.getElementById('assistant-modal');if(!modal)return;
    modal.classList.remove('hidden');nextQuickMode='';assistantFollowTail=true;render();
  }
  function close(){if(controller)controller.abort();controller=null;generating=false;draftAssistantText='';generationMode='send';regeneratingIndex=-1;editingIndex=-1;document.getElementById('assistant-modal')?.classList.add('hidden');}
  function switchType(type){if(!TYPES.includes(type)||generating)return;activeType=type;nextQuickMode='';draftAssistantText='';editingIndex=-1;assistantFollowTail=true;render();}
  function setQuickMode(){nextQuickMode=activeType;render();setTimeout(()=>document.getElementById('assistant-input')?.focus(),20);}

  function profileFormHtml(){const p=profile(),storyCfg=window.MimaStandalone?.getApiConfig?.()||{};const model=p.model||storyCfg.model||'未选择';return `<details class="assistant-config-card" ${state.ui.configOpen?'open':''} ontoggle="MimaAssistantStudio.setConfigOpen(this.open)"><summary class="assistant-config-summary"><span><strong>⚙ 助手模型设置</strong><span class="assistant-config-summary-model">${esc(model)} · T ${Number(p.temperature).toFixed(2)}</span></span></summary><div class="assistant-config-body"><div class="assistant-config-head"><strong>独立助手模型</strong><span class="tag">正文模型不受影响</span></div><label class="form-label">Model（模型）</label><div class="inline-field-row"><select id="assistant-model-select" class="field" onchange="MimaAssistantStudio.selectModel(this.value)"><option value="">${p.model?esc(p.model):`沿用当前名称：${esc(storyCfg.model||'未选择')}`}</option>${cachedModels.map(m=>`<option value="${esc(m)}" ${m===p.model?'selected':''}>${esc(m)}</option>`).join('')}</select><button class="ghost-btn" onclick="MimaAssistantStudio.loadModels()">拉取模型</button></div><input id="assistant-model-manual" class="field" placeholder="也可以手动填写，例如 gpt-5.6-sol" value="${esc(p.model||'')}" onchange="MimaAssistantStudio.setProfileField('model',this.value)"><label class="form-label">Temperature（温度） <span id="assistant-temp-value" class="value-pill">${Number(p.temperature).toFixed(2)}</span></label><input class="temp-range" type="range" min="0.1" max="2" step="0.05" value="${Number(p.temperature)}" oninput="MimaAssistantStudio.setProfileField('temperature',this.value);document.getElementById('assistant-temp-value').textContent=Number(this.value).toFixed(2)"><label class="form-label">Assistant Max Tokens（助手独立最大输出，0=不发送限制）</label><input class="field" type="number" min="0" max="131072" step="256" value="${Number(p.maxTokens||0)}" onchange="MimaAssistantStudio.setProfileField('maxTokens',this.value)"><div class="row-sub">不会再继承正文的 Max Tokens。建议先保持 0；若中转站要求显式限制，可填 4096–8192。</div><label class="check-row"><input type="checkbox" ${p.stream?'checked':''} onchange="MimaAssistantStudio.setProfileField('stream',this.checked)"> 助手 Streaming（流式）</label><label class="check-row"><input type="checkbox" ${p.sendTemperature!==false?'checked':''} onchange="MimaAssistantStudio.setProfileField('sendTemperature',this.checked)"> 向助手模型发送 Temperature</label><details class="assistant-persona-details"><summary>Persona / 设计风格</summary><label class="form-label">助手 Persona</label><textarea class="field textarea" onchange="MimaAssistantStudio.setProfileField('persona',this.value)">${esc(p.persona||'')}</textarea><label class="form-label">设计风格</label><textarea class="field textarea" onchange="MimaAssistantStudio.setProfileField('style',this.value)">${esc(p.style||'')}</textarea></details><div class="row-sub">助手继承正文 API 的 Base URL / Key / Headers，但 <strong>Model、Temperature 与 Max Tokens 分开保存</strong>。正文的巨大输出上限不会再被助手请求继承。</div></div></details>`;}

  function artifactButtons(detail,index){
    const artifact=detail?.artifact||null;
    if(!artifact){
      if(!detail?.found)return'';
      return `<div class="assistant-artifact-card assistant-artifact-error"><strong>⚠️ 检测到 MIMA 工件，但 JSON 没有成功解析</strong><div class="row-sub">工件原文仍完整保留在这条本地助手历史里，没有丢失。咪嘛馆不会再把“识别失败”静默伪装成“什么都没有”。</div><div class="assistant-artifact-error-detail">${esc(detail.error||'未知解析错误')}</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.repairArtifact(${index})">🩹 修复此工件</button><button class="ghost-btn" onclick="MimaAssistantStudio.regenerate(${index})">↻ 让助手重做</button><button class="ghost-btn" onclick="MimaAssistantStudio.startEdit(${index})">编辑原文</button></div></div>`;
    }
    const repaired=detail?.repaired?`<span class="tag">${detail.repairLevel==='self_heal'?'已自愈 JSON':'已自动修复 JSON 格式'}</span>`:'';
    if(artifact.kind==='regex_bundle')return `<div class="assistant-artifact-card"><div class="assistant-artifact-title"><strong>🧬 已识别 Regex Bundle</strong>${repaired}</div><div class="row-sub">包含配套预设 + 正则包，可一键保存并挂载到当前剧情。</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'all')">一键保存 + 挂载</button><button class="ghost-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'regex')">只存正则</button><button class="ghost-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'preset')">只存预设</button></div><details><summary>查看工件 JSON</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    if(artifact.kind==='preset')return `<div class="assistant-artifact-card"><div class="assistant-artifact-title"><strong>🧩 已识别 Preset</strong>${repaired}</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'preset')">保存并挂载预设</button></div><details><summary>查看工件 JSON</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    if(artifact.kind==='css_preset')return `<div class="assistant-artifact-card"><div class="assistant-artifact-title"><strong>🎨 已识别 CSS Preset</strong>${repaired}</div><div class="toolbar"><button class="primary-btn" onclick="MimaAssistantStudio.saveArtifact(${index},'css')">保存并应用 CSS</button></div><details><summary>查看工件 JSON</summary><pre class="prompt-pre">${esc(JSON.stringify(artifact,null,2))}</pre></details></div>`;
    return `<div class="assistant-artifact-card assistant-artifact-error"><strong>⚠️ 未支持的工件类型</strong><div class="row-sub">kind = ${esc(artifact.kind||'(empty)')}。原文未删除。</div></div>`;
  }

  function messagesHtml(){
    const items=thread();
    let html=items.map((m,i)=>{const artifactDetail=m.role==='assistant'?parseArtifactDetailed(m.content):{found:false,artifact:null,error:'',repaired:false};const shown=m.role==='assistant'?visibleAssistantText(m.content):m.content;const editing=editingIndex===i;const actions=generating?'':`<span class="assistant-msg-actions">${m.role==='assistant'?`<button onclick="MimaAssistantStudio.regenerate(${i})">↻ 重说</button>`:''}<button onclick="MimaAssistantStudio.startEdit(${i})">编辑</button><button class="danger" onclick="MimaAssistantStudio.deleteMessage(${i})">删除</button></span>`;const body=editing?`<div class="assistant-history-editor"><textarea id="assistant-edit-${i}" class="field textarea">${esc(m.content)}</textarea><div class="assistant-history-edit-actions"><button class="ghost-btn" onclick="MimaAssistantStudio.cancelEdit()">取消</button><button class="primary-btn" onclick="MimaAssistantStudio.saveEdit(${i})">保存编辑</button></div><div class="row-sub">只修改本地助手历史，不会自动调用模型，也不会删除已经保存的预设 / 正则 / CSS。</div></div>`:`<div class="assistant-chat-text">${esc(shown).replace(/\n/g,'<br>')}</div>${artifactButtons(artifactDetail,i)}`;let card=`<article class="assistant-chat-msg ${m.role==='user'?'assistant-chat-user':'assistant-chat-ai'}"><div class="assistant-chat-meta"><span>${m.role==='user'?'你':META[activeType].title} · ${formatTime(m.time)}${m.editedAt?' · 已编辑':''}</span>${actions}</div>${body}</article>`;if(generating&&(generationMode==='regenerate'||generationMode==='repair')&&regeneratingIndex===i)card+=`<article class="assistant-chat-msg assistant-chat-ai assistant-chat-streaming"><div class="assistant-chat-meta"><span>${META[activeType].title} · ${generationMode==='repair'?'正在修复工件':'正在重说'}</span></div><div class="assistant-chat-text">${esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>')}</div></article>`;return card}).join('');
    if(generating&&generationMode==='send'){html+=`<article class="assistant-chat-msg assistant-chat-ai assistant-chat-streaming"><div class="assistant-chat-meta"><span>${META[activeType].title} · 正在生成</span></div><div class="assistant-chat-text">${esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>')}</div></article>`;}
    if(!html)html='<div class="assistant-empty"><div class="empty-icon">'+META[activeType].icon+'</div><strong>'+META[activeType].title+'已就位</strong><p>它有独立模型、温度、Persona 与聊天记录。你可以把素材直接贴进下面的大输入框。</p></div>';
    return html;
  }

  function isAssistantNearBottom(sc,threshold=88){return !sc||((sc.scrollHeight-sc.scrollTop-sc.clientHeight)<=threshold);}
  function updateAssistantFollowButton(){const b=document.getElementById('assistant-follow-stream');if(!b)return;b.classList.toggle('hidden',!generating||assistantFollowTail);}
  function bindAssistantScroll(){const sc=document.getElementById('assistant-chat-scroll');if(!sc)return;sc.addEventListener('scroll',()=>{if(!generating)return;assistantFollowTail=isAssistantNearBottom(sc);updateAssistantFollowButton();},{passive:true});}
  function followLatest(){assistantFollowTail=true;const sc=document.getElementById('assistant-chat-scroll');if(sc)sc.scrollTop=sc.scrollHeight;updateAssistantFollowButton();}
  function render(){
    const root=document.getElementById('assistant-studio-root');if(!root)return;
    const oldSc=document.getElementById('assistant-chat-scroll'),oldScrollTop=oldSc?.scrollTop||0;
    const preserveReading=!!oldSc&&!assistantFollowTail;
    const meta=META[activeType];document.getElementById('assistant-studio-title').textContent=meta.title;
    const lastAi=lastAssistantIndex();
    root.classList.toggle('assistant-config-open',!!state.ui.configOpen);
    root.innerHTML=`<aside class="assistant-sidebar"><div class="assistant-type-tabs">${TYPES.map(t=>`<button class="assistant-type-btn ${t===activeType?'active':''}" onclick="MimaAssistantStudio.switchType('${t}')">${META[t].icon} ${META[t].title}</button>`).join('')}</div>${profileFormHtml()}<button class="assistant-clear-btn" onclick="MimaAssistantStudio.clearThread()" ${generating?'disabled':''}>清空聊天</button></aside><section class="assistant-main"><div class="assistant-chat-scroll" id="assistant-chat-scroll">${messagesHtml()}</div><button id="assistant-follow-stream" class="assistant-follow-stream hidden" onclick="MimaAssistantStudio.followLatest()">↓ 跟随输出</button><div class="assistant-composer"><div class="assistant-quick-row"><button class="chip-btn ${nextQuickMode===activeType?'active':''}" onclick="MimaAssistantStudio.setQuickMode()" ${generating?'disabled':''}>⚡ ${meta.quick}</button><button class="chip-btn" onclick="MimaAssistantStudio.regenerate(${lastAi})" ${generating||lastAi<0?'disabled':''}>↻ 重说上一条</button>${generating?'<button class="chip-btn danger" onclick="MimaAssistantStudio.stop()">■ 停止</button>':''}</div>${nextQuickMode===activeType?'<div class="assistant-mode-banner">下一条会以快捷任务模式发送；原文不会被改写后再存。</div>':''}<div class="assistant-input-row"><textarea id="assistant-input" rows="3" placeholder="${esc(meta.placeholder)}" ${generating?'disabled':''}></textarea><button class="send-btn assistant-send-btn" onclick="MimaAssistantStudio.send()" ${generating?'disabled':''}>➤</button></div><div class="row-sub assistant-enter-hint">Enter 只换行；点击发送才调用助手模型。</div></div></section>`;
    requestAnimationFrame(()=>{const sc=document.getElementById('assistant-chat-scroll');if(sc){if(preserveReading)sc.scrollTop=oldScrollTop;else if(assistantFollowTail)sc.scrollTop=sc.scrollHeight;}bindAssistantScroll();updateAssistantFollowButton();});
  }
  function setConfigOpen(open){state.ui.configOpen=!!open;saveState();const root=document.getElementById('assistant-studio-root');root?.classList.toggle('assistant-config-open',!!open);}

  function setProfileField(key,value,rerender=false){const p=profile();if(key==='temperature')p.temperature=clampTemp(value,p.temperature);else if(key==='maxTokens')p.maxTokens=Math.max(0,Math.min(131072,Math.floor(Number(value)||0)));else if(key==='stream'||key==='sendTemperature')p[key]=!!value;else p[key]=String(value??'');saveState();if(rerender)render();}
  function selectModel(value){if(value)setProfileField('model',value,true);}
  async function loadModels(){
    try{cachedModels=await window.MimaStandalone.listModels();const p=profile();if(!p.model&&cachedModels.length){p.model=cachedModels[0];saveState()}render();notify(`助手可选模型已拉取：${cachedModels.length} 个`);}catch(e){notify(`拉取助手模型失败：${e.message||e}`)}
  }
  function clearThread(){if(!confirm(`清空${META[activeType].title}的本地聊天记录？不会删除已保存的预设/正则/CSS。`))return;state.threads[activeType]=[];editingIndex=-1;saveState();render();}
  function lastAssistantIndex(){for(let i=thread().length-1;i>=0;i--)if(thread()[i]?.role==='assistant')return i;return-1;}
  function startEdit(index){if(generating||!thread()[index])return;editingIndex=index;render();requestAnimationFrame(()=>{const el=document.getElementById(`assistant-edit-${index}`);if(el){el.focus();el.setSelectionRange?.(el.value.length,el.value.length);el.scrollIntoView?.({block:'center'})}});}
  function cancelEdit(){editingIndex=-1;render();}
  function saveEdit(index){if(generating)return;const msg=thread()[index],el=document.getElementById(`assistant-edit-${index}`);if(!msg||!el)return;const content=String(el.value??'');if(!content.trim())return notify('历史消息不能保存为空；如果不要这条，请直接点“删除”。');msg.content=content;if(msg.role==='user')msg.requestContent=msg.quickMode?`${quickInstruction(activeType)}\n\n【用户素材】\n${content}`:content;msg.editedAt=new Date().toISOString();saveState();editingIndex=-1;render();notify('历史消息已编辑');}
  function deleteMessage(index){if(generating||!thread()[index])return;if(!confirm('删除这一条助手历史消息？只删除本地聊天记录，不会删除已经保存的预设 / 正则 / CSS。'))return;thread().splice(index,1);editingIndex=-1;saveState();render();notify('这条历史消息已删除');}
  function stop(){if(controller)controller.abort();controller=null;generating=false;draftAssistantText='';generationMode='send';regeneratingIndex=-1;render();}

  async function send(){
    if(generating)return;
    const input=document.getElementById('assistant-input');const raw=input?.value||'';if(!raw.trim())return;
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model){notify('先去 🔌 API 设置配置连接，并给助手选择一个模型猫。');return;}
    const quickMode=nextQuickMode===activeType;const userContent=(quickMode?`${quickInstruction(activeType)}\n\n【用户素材】\n${raw}`:raw);
    thread().push({role:'user',content:raw,requestContent:userContent,quickMode,time:new Date().toISOString()});saveState();nextQuickMode='';generating=true;generationMode='send';regeneratingIndex=-1;editingIndex=-1;draftAssistantText='';assistantFollowTail=true;render();
    const history=thread().slice(-30).map(m=>({role:m.role,content:m.role==='user'?(m.requestContent||m.content):m.content}));
    const messages=[{role:'system',content:systemPrompt(activeType)},...history];
    const cfg={...storyCfg,model,temperature:p.temperature,stream:p.stream,sendTemperature:p.sendTemperature!==false,maxTokens:Number(p.maxTokens)||0};controller=new AbortController();
    try{
      const reply=await window.MimaStandalone.callModelWithConfig(messages,cfg,p.temperature,controller.signal,{streamOverride:p.stream,onProgress:payload=>{if(payload?.streamText!==undefined){draftAssistantText=String(payload.streamText||'');const textEl=document.querySelector('.assistant-chat-streaming .assistant-chat-text');if(textEl)textEl.innerHTML=esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>');const sc=document.getElementById('assistant-chat-scroll');if(sc&&assistantFollowTail)sc.scrollTop=sc.scrollHeight;updateAssistantFollowButton();}}});
      thread().push({role:'assistant',content:reply,time:new Date().toISOString()});saveState();generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;render();
    }catch(e){generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('助手生成已停止');render();return}const status=Number(e?.status)||0;const billing=/余额|insufficient|balance|quota|credit|billing/i.test(String(e?.message||''));const extra=billing?'；这是上游/中转站计费拒绝，不代表本地数据丢失。已确保助手不再继承正文 Max Tokens，可保持助手 Max Tokens=0 后重试。':(e?.hint?`；${e.hint}`:'');notify(`助手调用失败${status?` · HTTP ${status}`:''}：${e.message||e}${extra}`);render();}
  }

  async function regenerate(index){
    if(generating)return;
    const items=thread();index=Number(index);if(!Number.isInteger(index)||index<0)index=lastAssistantIndex();const target=items[index];if(!target||target.role!=='assistant')return notify('还没有可以重说的助手回复。');
    const before=items.slice(0,index);if(!before.some(m=>m.role==='user'))return notify('这条回复前没有用户消息，无法安全重说。');
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model){notify('先去 🔌 API 设置配置连接，并给助手选择一个模型猫。');return;}
    const history=before.slice(-30).map(m=>({role:m.role,content:m.role==='user'?(m.requestContent||m.content):m.content}));
    const messages=[{role:'system',content:systemPrompt(activeType)},...history];
    generating=true;generationMode='regenerate';regeneratingIndex=index;editingIndex=-1;draftAssistantText='';assistantFollowTail=true;render();
    const cfg={...storyCfg,model,temperature:p.temperature,stream:p.stream,sendTemperature:p.sendTemperature!==false,maxTokens:Number(p.maxTokens)||0};controller=new AbortController();
    try{
      const reply=await window.MimaStandalone.callModelWithConfig(messages,cfg,p.temperature,controller.signal,{streamOverride:p.stream,onProgress:payload=>{if(payload?.streamText!==undefined){draftAssistantText=String(payload.streamText||'');const streamCards=document.querySelectorAll?.('.assistant-chat-streaming .assistant-chat-text');const textEl=streamCards?.[streamCards.length-1];if(textEl)textEl.innerHTML=esc(visibleAssistantText(draftAssistantText)||'…').replace(/\n/g,'<br>');const sc=document.getElementById('assistant-chat-scroll');if(sc&&assistantFollowTail)sc.scrollTop=sc.scrollHeight;updateAssistantFollowButton();}}});
      const current=thread()[index];if(!current||current.role!=='assistant')throw new Error('历史位置已经变化，为避免覆盖错误消息，本次重说未写入。');current.content=reply;current.time=new Date().toISOString();current.regeneratedAt=current.time;saveState();generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;render();notify('助手已经重说这一条 ✨');
    }catch(e){generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('助手重说已停止，原回复保留');render();return}const status=Number(e?.status)||0;const billing=/余额|insufficient|balance|quota|credit|billing/i.test(String(e?.message||''));const extra=billing?'；这是上游/中转站计费拒绝，原回复仍然保留。':(e?.hint?`；${e.hint}`:'');notify(`助手重说失败${status?` · HTTP ${status}`:''}：${e.message||e}${extra}`);render();}
  }

  async function repairArtifact(index){
    if(generating)return;
    const items=thread();index=Number(index);const target=items[index];if(!target||target.role!=='assistant')return notify('没有找到要修复的助手工件。');
    const extracted=extractArtifactCandidate(target.content);if(!extracted.found)return notify('这条回复没有 MIMA 工件标记。');
    const p=profile(),storyCfg=window.MimaStandalone.getApiConfig();const model=(p.model||storyCfg.model||'').trim();if(!storyCfg.apiBase||!model)return notify('先配置 API，并给助手选择模型猫。');
    const repairSystem=`你是 MIMA_ARTIFACT JSON 语法修复器。你只能修复 JSON 语法，绝对不得重写、删减、总结、优化或改变任何业务字段、pattern、replacement、HTML、CSS、提示词语义与数组顺序。禁止 eval/Function。输出且只输出一个 <MIMA_ARTIFACT>...</MIMA_ARTIFACT>，内部必须能被标准 JSON.parse 解析。\n\n${artifactJsonProtocol()}`;
    const repairUser=`下面是原始工件。保持所有内容与顺序，只修 JSON 语法：\n\n<MIMA_ARTIFACT>\n${extracted.candidate}\n</MIMA_ARTIFACT>`;
    generating=true;generationMode='repair';regeneratingIndex=index;editingIndex=-1;draftAssistantText='';assistantFollowTail=true;render();controller=new AbortController();
    const cfg={...storyCfg,model,temperature:p.temperature,stream:false,sendTemperature:p.sendTemperature!==false,maxTokens:Number(p.maxTokens)||0};
    try{
      const reply=await window.MimaStandalone.callModelWithConfig([{role:'system',content:repairSystem},{role:'user',content:repairUser}],cfg,p.temperature,controller.signal,{streamOverride:false});
      const detail=parseArtifactDetailed(reply);if(!detail.artifact)throw new Error(`修复模型返回的工件仍无法解析：${detail.error||'未知错误'}`);
      const canonical=`<MIMA_ARTIFACT>\n${JSON.stringify(detail.artifact)}\n</MIMA_ARTIFACT>`;
      const current=thread()[index];if(!current||current.role!=='assistant')throw new Error('历史位置已经变化，为避免覆盖错误消息，本次修复未写入。');
      current.versions=Array.isArray(current.versions)?current.versions:[];current.versions.push({content:current.content,time:new Date().toISOString(),reason:'artifact_json_repair'});
      current.content=String(current.content||'').replace(extracted.full,canonical);current.editedAt=new Date().toISOString();current.artifactRepairedAt=current.editedAt;
      saveState();generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;render();notify('工件 JSON 已修复并重新校验 ✨');
    }catch(e){generating=false;generationMode='send';regeneratingIndex=-1;draftAssistantText='';controller=null;if(e?.name==='AbortError'){notify('工件修复已停止，原工件完整保留');render();return}notify(`修复工件失败：${e.message||e}；原工件完整保留。`);render();}
  }

  async function saveArtifact(index,mode){
    const msg=thread()[index];const detail=parseArtifactDetailed(msg?.content);const artifact=detail.artifact;if(!artifact)return notify(detail.found?`检测到工件标记，但 JSON 解析失败：${detail.error}`:'这条消息里没有可保存的结构化工件。');
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

  window.MimaAssistantStudio={open,close,switchType,setQuickMode,setConfigOpen,setProfileField,selectModel,loadModels,clearThread,startEdit,cancelEdit,saveEdit,deleteMessage,stop,send,regenerate,repairArtifact,followLatest,saveArtifact,inspectArtifact:raw=>clone(parseArtifactDetailed(raw)),getState:()=>clone(state)};
})();
