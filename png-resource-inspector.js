/* Read-only resource catalog for PNG character cards. No CSS/HTML execution or writes.
 * Unknown and lossy formats stay inspect-only, preserving full source data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaPngResourceInspector=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
  const val=x=>typeof x==='string'?x:'';
  const list=x=>Array.isArray(x)?x:(obj(x)?Object.values(x):[]);
  const text=x=>typeof x==='string'?x.trim():'';
  const entriesAreValid=x=>Array.isArray(x)||obj(x);
  function make(kind,name,path,source,payload=null,warnings=[]){return{id:'r'+itemsNext++,kind,name,path,source,payload,warnings,canImport:!!payload&&warnings.length===0,selected:false};}
  let itemsNext=0;
  function bookPayload(book,name){
    const src=book||{},warnings=[];
    if(!obj(src)||!entriesAreValid(src.entries))return{payload:null,warnings:['世界书缺少可识别的 entries。']};
    if(obj(src.extensions)&&Object.keys(src.extensions).length)warnings.push('世界书包含宿主专用 extensions，无法保证运行语义相同');
    if(src.recursive_scanning===true)warnings.push('世界书递归扫描逻辑暂无等价实现');
    if(src.token_budget!==undefined&&Number(src.token_budget)>0)warnings.push('独立世界书 Token 预算无法等价挂载');
    const entries=[];
    for(const [i,e] of list(src.entries).entries()){
      if(!obj(e)||typeof e.content!=='string'){warnings.push(`条目 ${i+1} 的正文格式不兼容`);continue;}
      if(e.position!==undefined&&!['front','middle','back'].includes(e.position))warnings.push(`条目 ${i+1} 的注入位置不兼容`);
      if(e.probability!==undefined&&Number(e.probability)!==100)warnings.push(`条目 ${i+1} 的概率激活无法等价转换`);
      if(e.extensions&&obj(e.extensions)&&Object.keys(e.extensions).some(k=>!['depth','position'].includes(k)))warnings.push(`条目 ${i+1} 包含额外激活语义`);
      if(e.extensions?.position!==undefined)warnings.push(`条目 ${i+1} 的专用注入槽位无法等价转换`);
      if(e.selectiveLogic!==undefined&&Number(e.selectiveLogic)!==0)warnings.push(`条目 ${i+1} 的次关键词高级匹配逻辑不兼容`);
      if(e.selective&&!(e.secondary_keys?.length||e.secondaryKeywords?.length))warnings.push(`条目 ${i+1} 的 selective 规则缺少可映射次关键词`);
      const keys=e.keywords??e.keys??e.key??[];
      const secondary=e.secondaryKeywords??e.secondary_keys??e.keysecondary??[];
      const array=x=>Array.isArray(x)?x.filter(y=>typeof y==='string'):typeof x==='string'?[x]:[];
      entries.push({name:val(e.name)||val(e.comment)||`条目 ${i+1}`,content:e.content,keywords:array(keys),secondaryKeywords:(e.selective===false||e.use_regex)?[]:array(secondary),enabled:e.enabled!==false&&e.disable!==true,alwaysActive:!!(e.alwaysActive||e.constant),matchMode:e.matchMode==='all'?'all':'any',caseSensitive:!!(e.caseSensitive||e.case_sensitive),useRegex:!!(e.useRegex||e.use_regex),priority:Number.isFinite(Number(e.priority??e.insertion_order??e.order??50))?Number(e.priority??e.insertion_order??e.order??50):50,scanDepth:Number(e.scanDepth??src.scan_depth??12)||12,depth:Number(e.depth??e.extensions?.depth??0)||0,position:['front','middle','back'].includes(e.position)?e.position:'middle',maxChars:Number(e.maxChars??0)||0});
    }
    if(!entries.length)warnings.push('没有可导入的世界书条目');
    return{payload:{name:val(src.name)||name,description:val(src.description),tags:[],entries},warnings:[...new Set(warnings)]};
  }
  function discover(inspection){
    itemsNext=0;
    const resources=[],meta=inspection.metadata||[],card=inspection.card;
    if(card){
      resources.push(make('character',card.card.name||'角色卡','card.data',card.card,{version:card.version,source:card}));
      const data=card.card;
      for(const [field,title,type] of [['system_prompt','系统提示词','behavior'],['post_history_instructions','历史后指令','format']]){
        if(text(data[field]))resources.push(make('preset',`${data.name} · ${title}`,`card.data.${field}`,data[field],{name:`${data.name} · ${title}`,content:data[field],type,priority:50,description:`来自 PNG 的 ${field}；导入后默认不挂载`}));
      }
      const seen=new Set();
      function scan(value,path,depth){
        if(depth>5||!obj(value)||seen.has(value))return;seen.add(value);
        for(const [k,v] of Object.entries(value)){
          const here=`${path}.${k}`;
          if(['character_book','world_book','lorebook','world_info'].includes(k)&&obj(v)){
            const mapped=bookPayload(v,`${data.name} · 世界书`);
            resources.push(make('worldbook',mapped.payload?.name||'世界书',here,v,mapped.payload,mapped.warnings));
          }else if(['status_bar_prompt','status_prompt','output_format_prompt','prompt_template','statusbar_prompt'].includes(k)&&text(v)){
            resources.push(make('preset',`${data.name} · 状态/格式模板`,here,v,{name:`${data.name} · ${k}`,content:v,type:'format',priority:50,description:`PNG 附带的文本输出规范（${here}）；默认不挂载`}));
          }else if(['statusbar_html','status_bar_html','html_template','status_template'].includes(k)&&text(v)){
            resources.push(make('unknown',`${k} · HTML 模板`,here,v,null,['包含 HTML 或模板语法；目前仅查看/导出，不自动执行']));
          }else if(['css','custom_css','stylesheet'].includes(k)&&text(v)){
            resources.push(make('css',`${data.name} · CSS`,here,v,{name:`${data.name} · CSS`,css:v,scope:'story',surface:'chat'}));
          }else if(['regex_scripts','regexScripts','regex','scripts'].includes(k)&&v!==undefined){
            // SillyTavern scripting phases/flags are NOT the same runtime contract.
            resources.push(make('unknown',`${k} · 原始脚本`,here,v,null,['外部脚本格式不兼容，禁止静默执行']));
          }else if(obj(v)&&k!=='character_book'&&k!=='world_book')scan(v,here,depth+1);
        }
      }
      scan(data,'card.data',0);
      if(obj(card.raw))scan(card.raw,'card',0);
      // All unclassified data is still in raw card JSON, no field discarded.
    }
    if(!card&&obj(inspection.rawCard)){
      const rawData=obj(inspection.rawCard.data)?inspection.rawCard.data:inspection.rawCard;
      const surrogate={card:rawData,raw:inspection.rawCard,version:'未确认'};
      // Even an incomplete character may contain usable, independently
      // validated assets; no character is ever imported from this surrogate.
      const companions=discover({card:surrogate,metadata:[]});
      resources.push(...companions.filter(r=>r.kind!=='character'));
    }
    if(inspection.cardError)resources.push(make('unknown','角色卡解析异常','card',inspection.cardError,null,[inspection.cardError]));
    meta.forEach((entry,i)=>{if(!['ccv3','chara'].includes(entry.keyword))resources.push(make('metadata',`${entry.keyword} (${entry.type})`,`metadata[${i}]`,entry.text,null,['未识别的 PNG 文本块，支持查看和导出']));});
    resources.forEach((r,i)=>{r.id='r'+i});
    return resources;
  }
  return Object.freeze({discover,bookPayload});
});
