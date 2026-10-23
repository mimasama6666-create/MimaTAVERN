/* Mima R4.10 G5 — user-approved HTML structure recovery.
 * Static shell remains inert; all dynamic values require explicit owner input.
 * This module never accesses an API or commits a canonical message.
 */
(function(){'use strict';
 const selectors=v=>String(v||'').split(/\s*[,\n]\s*/).map(x=>x.trim()).filter(Boolean);
 const elTree=content=>new DOMParser().parseFromString('<!doctype html><html><body>'+String(content||'')+'</body></html>','text/html').body;
 const commentAuthorizations=c=>new Set(String(c?.staticCommentTexts||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean));
 const cssAuthorizations=c=>selectors(c?.staticCssSelectors);
 const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 const markup=s=>/<\/?[A-Za-z][\w:.-]*(?:\s|>|\/)/.test(String(s||''));
 // Read HTML in tokenizer context, not with a global tag regex: a JS string,
 // textarea value, comment or DOCTYPE must never become an element.
 const rawTextTags=new Set(['script','style','xmp','iframe','noembed','noframes','plaintext']);
 const rcdataTags=new Set(['textarea','title']);
 const optionalEnd={li:['li'],dt:['dt','dd'],dd:['dd','dt'],p:['p','div','section','article','header','footer','main','nav','aside','h1','h2','h3','h4','h5','h6','ul','ol','table','pre','blockquote'],
   option:['option','optgroup'],optgroup:['optgroup'],tr:['tr'],td:['td','th'],th:['td','th'],thead:['tbody','tfoot'],tbody:['tbody','tfoot'],tfoot:['tbody']};
 function tokenize(source){
   const src=String(source||''),stack=[];let i=0,seen=false;
   const error=(reason)=>({ok:false,reason,stack:[...stack],seen});
   const popOptional=(tag)=>{while(stack.length&&optionalEnd[stack.at(-1)]?.includes(tag))stack.pop();};
   while(i<src.length){
     const active=stack.at(-1);
     if(active==='plaintext'){i=src.length;break;}
     if(rawTextTags.has(active)||rcdataTags.has(active)){
       const close=new RegExp('</'+active+'\\s*>','ig');close.lastIndex=i;
       const hit=close.exec(src);
       if(!hit){return error('unclosed_'+active);}
       stack.pop();i=close.lastIndex;continue;
     }
     const start=src.indexOf('<',i);if(start<0)break;i=start;
     if(src.startsWith('<!--',i)){const end=src.indexOf('-->',i+4);if(end<0)return error('unfinished_comment');i=end+3;continue;}
     if(/^<!doctype\b/i.test(src.slice(i))){
       // The public identifier may contain > in a quote; parse until unquoted >.
       let j=i+2,quote='';for(;j<src.length;j++){const ch=src[j];if(quote){if(ch===quote)quote='';}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;}
       if(j>=src.length)return error('unfinished_doctype');i=j+1;continue;
     }
     if(src.startsWith('<![CDATA[',i)){const end=src.indexOf(']]>',i+9);if(end<0)return error('unfinished_cdata');i=end+3;continue;}
     if(src.startsWith('<?',i)){const end=src.indexOf('?>',i+2);if(end<0)return error('unfinished_processing_instruction');i=end+2;continue;}
     const match=/^<(\/)?([A-Za-z][\w:.-]*)\b/.exec(src.slice(i));
     if(!match){
       // Literal less-than text, e.g. "3 < 5", is not markup.
       if(/^<!|^<\/?[A-Za-z]/.test(src.slice(i)))return error('malformed_tag');
       i++;continue;
     }
     const tag=match[2].toLowerCase();let j=i+match[0].length,quote='';
     for(;j<src.length;j++){const ch=src[j];if(quote){if(ch===quote)quote='';}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;}
     if(j>=src.length)return error('unfinished_tag');
     const whole=src.slice(i,j+1),isClosing=!!match[1],selfClosing=/\/\s*>$/.test(whole);seen=true;
     // In text/html, '/>' does NOT close ordinary HTML elements. Only SVG/MathML
     // foreign content has self-closing semantics (except HTML integration points).
     const foreignStart=Math.max(stack.lastIndexOf('svg'),stack.lastIndexOf('math'));
     const insideForeign=foreignStart>=0&&!stack.slice(foreignStart+1).includes('foreignobject');
     if(isClosing){
       // Optional end tags are not missing markup in HTML documents.
       while(stack.length&&stack.at(-1)!==tag&&optionalEnd[stack.at(-1)])stack.pop();
       if(stack.at(-1)!==tag)return error('mismatched_closing_'+tag);
       stack.pop();
     }else if(!voids.has(tag)){
       popOptional(tag);
       if(!(selfClosing&&(insideForeign||tag==='svg'||tag==='math')))stack.push(tag);
     }
     i=j+1;
   }
   while(stack.length&&optionalEnd[stack.at(-1)])stack.pop();
   return stack.length?error('unclosed_'+stack.at(-1)):{ok:true,stack:[],seen};
 }
 function rawBalance(source){const result=tokenize(source);return {ok:result.ok,...(!result.ok?{reason:result.reason}:{})};}
 // This repair changes only a demonstrably absent suffix: never rewrite any
 // original byte, never close unsafe RAWTEXT or guess malformed markup.
 function closeUnclosedTags(source){
   const original=String(source??''),result=tokenize(original);
   if(!result.seen)throw Error(result.reason&&result.reason!=='unclosed_'?'E_HTML_TAG_CLOSURE_AMBIGUOUS_MARKUP: '+result.reason:'E_HTML_TAG_CLOSURE_NO_MARKUP');
   if(result.ok)throw Error('E_HTML_TAG_CLOSURE_NOT_NEEDED');
   if(!result.reason.startsWith('unclosed_'))throw Error('E_HTML_TAG_CLOSURE_AMBIGUOUS_MARKUP: '+result.reason);
   const forbidden=new Set(['script','style','textarea','title','iframe','object','embed','svg','math','template','xmp','noembed','noframes','plaintext']);
   if(result.stack.some(tag=>forbidden.has(tag)))throw Error('E_HTML_TAG_CLOSURE_UNSAFE_ELEMENT');
   const appended=[...result.stack].reverse().map(tag=>'</'+tag+'>').join('');
   if(!appended)throw Error('E_HTML_TAG_CLOSURE_NOT_NEEDED');
   const proposedContent=original+appended;
   if(!tokenize(proposedContent).ok)throw Error('E_HTML_TAG_CLOSURE_VERIFICATION_FAILED');
   return {proposedContent,oldContent:original,appended,repairActions:['append_missing_closing_tags'],confidence:'lexical_append_only',missingFields:[]};
 }
 function onlyUnique(body,sel){let list;try{list=body.querySelectorAll(sel);}catch{throw Error('E_HTML_CONTRACT_SELECTOR_INVALID: '+sel);}return list;}
 function path(node){let r=[],el=node;while(el&&el.parentElement&&el!==el.ownerDocument.body){const siblings=[...el.parentElement.children].filter(n=>n.tagName===el.tagName);r.push(el.tagName+':'+siblings.indexOf(el));el=el.parentElement;}return r.reverse().join('/');}
 // Opt-in structure contract: mixed HTML prefix + unwrapped narrative prose + status tail.
 // Legacy selector-only contracts retain their historical semantics.
 const statusOrder=['mima-gaze','mima-bond','mima-abyss','mima-pulse','mima-cocoon','mima-echo','mima-pets','mima-nexus'];
 function threePart(content,{strictValues=false}={}){
   const source=String(content||''),body=elTree(source),missing=[],warnings=[];
   const balanced=rawBalance(source);
   if(!balanced.ok)missing.push('(HTML未闭合:'+balanced.reason+')');
   const get=cls=>[...body.getElementsByClassName(cls)];
   const current=get('mima-current'),tails=statusOrder.map(cls=>get(cls));
   if(current.length!==1)missing.push('.mima-current (必须唯一，实际 '+current.length+')');
   tails.forEach((list,i)=>{if(list.length!==1)missing.push('.'+statusOrder[i]+' (必须唯一，实际 '+list.length+')');});
   if(current.length===1&&tails.every(x=>x.length===1)){
     const nodes=[current[0],...tails.map(x=>x[0])];
     for(let i=1;i<nodes.length;i++){
       if(!(nodes[i-1].compareDocumentPosition(nodes[i])&Node.DOCUMENT_POSITION_FOLLOWING)){
         missing.push('(三段顺序或嵌套错误:'+ (i===1?'mima-current':statusOrder[i-2]) +' → '+statusOrder[i-1]+')');break;
       }
       if(nodes[i-1].contains(nodes[i])){missing.push('(状态栏不能互相嵌套)');break;}
     }
     // Boundary Range works for both bare prose and paragraphs wrapped in HTML,
     // including a <system> wrapper around the head or the whole document.
     try{
       const range=body.ownerDocument.createRange();range.setStartAfter(current[0]);range.setEndBefore(tails[0][0]);
       const clone=range.cloneContents();
       const narrative=(clone.textContent||'').replace(/\s+/g,'').trim();
       if(!narrative)missing.push('(开头状态栏与末尾状态栏之间没有剧情正文)');
     }catch{missing.push('(正文区间无法确认，状态结构可能交叉)');}
     if(strictValues){
       for(const meter of body.querySelectorAll('progress[value],meter[value]')){
         const raw=meter.getAttribute('value')||'';
         if(!/^\d+(?:\.\d+)?$/.test(raw)||Number(raw)<0||Number(raw)>Number(meter.getAttribute('max')||100)){
           missing.push('(数值未填写或超范围:'+meter.localName+')');
         }
       }
     }else if([...body.querySelectorAll('progress[value],meter[value]')].some(x=>!/^(?:\d+(?:\.\d+)?)$/.test(x.getAttribute('value')||''))){warnings.push('存在未填写的进度值；可选严格数值检查');}
   }
   return {ok:missing.length===0,missing,warnings,status:missing.length?'three_part_incomplete':'three_part_complete',structureKind:'three_part_html_status'};
 }
 function continuationKind(previous,next,contract={}){
   const a=String(previous||''),b=String(next||'');
   if(!a.trim()||!b.trim())return 'suffix';
   // Never infer a full status from one arbitrary tag or a label in prose.
   const am=elTree(a),bm=elTree(b);
   const overlap=['mima-current',...statusOrder].filter(cls=>am.getElementsByClassName(cls).length===1&&bm.getElementsByClassName(cls).length===1);
   if(overlap.length>=2&&overlap.includes('mima-current'))return 'full_reply';
   if(overlap.length)return 'ambiguous_status_overlap';
   const sels=selectors(contract.requiredSelectors);
   if(contract.requireHtml&&sels.length>=2&&sels.every(sel=>{try{return am.querySelectorAll(sel).length===1&&bm.querySelectorAll(sel).length===1;}catch{return false;}}))return 'full_reply';
   return 'suffix';
 }
 function inspect(content,contract={}){
   if(!contract.requireHtml)return {ok:true,missing:[],status:'disabled'};
   if(contract.structureMode==='three_part_html_status')return threePart(content,{strictValues:contract.strictValues===true});
   const source=String(content||''),body=elTree(source),missing=[];
   if(!markup(source))missing.push('(HTML)');
   const balanced=rawBalance(source);if(!balanced.ok)missing.push('(HTML未闭合:'+balanced.reason+')');
   const ref=typeof contract.templateHtml==='string'&&contract.templateHtml?elTree(contract.templateHtml):null;
   const required=new Set([...selectors(contract.requiredSelectors),contract.bodySelector,contract.statusSelector].filter(Boolean));
   for(const sel of required){const matched=onlyUnique(body,sel),expected=ref?onlyUnique(ref,sel):null;
     if(matched.length!==1)missing.push(sel+` (必须唯一，实际 ${matched.length})`);
     else if(ref&&(expected.length!==1||path(matched[0])!==path(expected[0])))missing.push(sel+' (DOM层级与模板不一致)');
   }
   return {ok:markup(source)&&balanced.ok&&!missing.length,missing,status:markup(source)?'structure':'plain_text'};
 }
 function safeAttributes(body,contract={}){
   const blocked=/^(script|iframe|object|embed|meta|link|base|form|svg|math|video|audio|picture|source|input|button|textarea|select|template)$/i;
   const resource=/^(src|href|xlink:href|action|formaction|srcset|srcdoc|target|ping)$/i;
   for(const el of [...body.querySelectorAll('*')]){
     if(blocked.test(el.tagName))throw Error('E_HTML_REPAIR_UNSAFE_TEMPLATE: '+el.tagName);
     for(const a of [...el.attributes]){
       if(/^on/i.test(a.name)||resource.test(a.name))throw Error('E_HTML_REPAIR_UNSAFE_ATTRIBUTE: '+a.name);
       if(a.name==='style'&&/(?:url\s*\(|@import|expression\s*\(|behavior\s*:|image-set\s*\()/i.test(a.value))throw Error('E_HTML_REPAIR_UNSAFE_STYLE');
     }
     if(el.tagName==='STYLE'){
       const original=el.textContent||'';
       // CSS comments are source text too. Only exact, explicitly authorized
       // fixed comments may survive into a candidate; retain their bytes.
       const comments=original.match(/\/\*[\s\S]*?\*\//g)||[];
       const authorized=commentAuthorizations(contract);
       for(const comment of comments)if(!authorized.has(comment.slice(2,-2).trim()))throw Error('E_HTML_REPAIR_CSS_COMMENT_UNVERIFIED');
       const withoutComments=original.replace(/\/\*[\s\S]*?\*\//g,'');
       const css=window.MimaCompatSafeHtml?.safeCssText;
       if(typeof css!=='function')throw Error('E_HTML_REPAIR_CSS_SANITIZER_MISSING');
       const cleaned=css(withoutComments);
       if(/(?:@import|url\s*\(|image-set\s*\(|expression\s*\()/i.test(withoutComments))throw Error('E_HTML_REPAIR_CSS_UNSAFE');
       if(withoutComments.trim()&&!cleaned.trim())throw Error('E_HTML_REPAIR_CSS_UNSAFE');
       if(/(?:@import|url\s*\(|image-set\s*\(|expression\s*\()/i.test(cleaned))throw Error('E_HTML_REPAIR_CSS_UNSAFE');
       el.textContent=(comments.length?comments.join('\n')+'\n':'')+cleaned;
     }
   }
 }
 // Attribution contract: outside the one prose slot, no template text is
 // considered current fact. Owners can explicitly allow immutable labels with
 // staticSelectors; all other nonempty text/attributes must be reconfirmed.
 const staticAttributeNames=new Set(['id','class','role','dir','lang','hidden','tabindex']);
 // Only properties with an unambiguous layout/typography purpose are
 // inherited without owner confirmation. Colors, custom properties, content,
 // counters, dimensions, visibility and unknown extensions can encode state.
 const uncertainCssValue=value=>/[\u3400-\u9fff\u3040-\u30ff]|attr\s*\(|(?:^|\W)(?:dead|alive|sad|happy|angry|mood|hp|energy|health|killed|death)(?:\W|$)/i.test(String(value));
 const fixedLayoutCss=new Set(['box-sizing','font-family','font-size','font-style','font-weight','font-variant','line-height','letter-spacing','text-align','text-indent','text-transform','white-space','word-break','overflow-wrap','flex-direction','flex-wrap','justify-content','align-items','align-content','align-self','grid-template-columns','grid-template-rows','grid-auto-flow','gap','row-gap','column-gap','border-style','border-width','border-radius','outline-style','outline-width','list-style-type','vertical-align','clear','float']);
 const dangerousStyleValue=/(?:url\s*\(|@import|expression\s*\(|behavior\s*:|image-set\s*\(|javascript\s*:)/i;
 const statefulValue=/[<>]/;
 function validCssValue(value){
   if(!String(value).trim()||/[;{}<>\u0000]/.test(value)||dangerousStyleValue.test(value))throw Error('E_HTML_REPAIR_DYNAMIC_CSS_INVALID');
   return String(value).trim();
 }
 function cssStaticElement(el,contract){return cssAuthorizations(contract).some(sel=>{try{return el.matches(sel);}catch{throw Error('E_HTML_CONTRACT_SELECTOR_INVALID: '+sel);}});}
 function cssRuleAuthorized(rule,contract){const selector=String(rule.selectorText||'').trim();return !!selector&&cssAuthorizations(contract).includes(selector);}
 function cssStatusValue(prop){return !fixedLayoutCss.has(String(prop).toLowerCase());}
 function cssRuleValue(prop,value,key){return prop==='content'?JSON.stringify(value===null?`【待确认:${key}】`:validCssValue(value)):(value===null?`var(--mima-pending-${key})`:validCssValue(value));}
 function skeleton(source,template,contract,values=null){
   if(!contract?.requireHtml)throw Error('E_HTML_REPAIR_NOT_ENABLED');
   const model=elTree(template);safeAttributes(model,contract);
   const bodySel=String(contract.bodySelector||'').trim();
   if(!bodySel||onlyUnique(model,bodySel).length!==1)throw Error('E_HTML_REPAIR_BODY_SLOT_NOT_UNIQUE');
   const body=onlyUnique(model,bodySel)[0];
   // Never copy any child, attribute-carried state, or old prose from this slot.
   for(const a of [...body.attributes]){
     if(/^(?:data-(?!mima-)|title$|aria-|value$)/i.test(a.name))body.removeAttribute(a.name);
   }
   body.textContent=source;
   const statusSel=String(contract.statusSelector||'').trim();
   let statuses=[];
   if(statusSel)statuses=[...onlyUnique(model,statusSel)];
   else statuses=[...model.querySelectorAll('[class*="status" i],[id*="status" i],[class*="meter" i],[id*="meter" i],meter,progress')];
   if(statusSel&&statuses.length!==1)throw Error('E_HTML_REPAIR_STATUS_SLOT_NOT_UNIQUE');
   const roots=statuses.filter(el=>el!==body&&!body.contains(el)&&!statuses.some(other=>other!==el&&other.contains(el)));
   if(roots.some(el=>el.contains(body)))throw Error('E_HTML_REPAIR_OVERLAPPING_SLOTS');
   const authorized=[];
   for(const sel of selectors(contract.staticSelectors)){
     for(const el of onlyUnique(model,sel)){
       if(el===body||el.contains(body)||roots.some(root=>root===el||root.contains(el)||el.contains(root)))
         throw Error('E_HTML_REPAIR_STATIC_SELECTOR_OVERLAP: '+sel);
       authorized.push(el);
     }
   }
   const staticText=node=>authorized.some(el=>el.contains(node));
   const inStatus=node=>roots.some(el=>el===node||el.contains(node));
   const fields=[];let n=0;
   const fill=(kind,label,old,assign)=>{
     const key='html_field_'+n++;
     fields.push({key,label,kind,previousExample:String(old||'')});
     const value=values?.[key];
     if(values&&(!Object.hasOwn(values,key)||!String(value).trim()))throw Error('E_HTML_REPAIR_DYNAMIC_FIELD_MISSING: '+key);
     assign(values?String(value):null,key);
   };
   // CSSOM traversal retains nested @media/@supports/@keyframes. Unknown
   // rule kinds fail closed, rather than discarding owner CSS or its source.
   const stableRuleSelector=selector=>{
     const raw=String(selector||'').trim(),parts=[bodySel,statusSel,...selectors(contract.staticSelectors),...cssAuthorizations(contract)].filter(Boolean);
     // Only explicit provenance-bearing slots/selectors can establish a rule's
     // immutable target. Selector conditions containing old state are never
     // inherited from an unannotated CSS rule.
     return parts.some(sel=>raw===sel||raw===sel+'::before'||raw===sel+'::after');
   };
   const rewriteStyleSheet=(el)=>{
     const original=String(el.textContent||'');
     const comments=original.match(/\/\*[\s\S]*?\*\//g)||[];
     const sheet=new CSSStyleSheet();
     try{sheet.replaceSync(original.replace(/\/\*[\s\S]*?\*\//g,''));}
     catch{throw Error('E_HTML_REPAIR_CSS_PARSER_FAILED');}
     const rewrite=rules=>[...rules].map(rule=>{
       if(rule.style){
         const declaration=rule.style, explicit=cssRuleAuthorized(rule,contract);
         if(rule.selectorText&&!stableRuleSelector(rule.selectorText)){
           const oldSelector=rule.selectorText;
           fill('css_selector','未归属的 CSS 规则选择器（可能绑定旧状态）',oldSelector,(value,key)=>{
             const next=value===null?'.mima-pending-selector-'+key:String(value).trim();
             if(!/^[^{};<>\u0000]{1,300}$/.test(next))throw Error('E_HTML_REPAIR_CSS_SELECTOR_INVALID');
             try{document.querySelector(next);rule.selectorText=next;}
             catch{throw Error('E_HTML_REPAIR_CSS_SELECTOR_INVALID');}
             if(rule.selectorText!==next)throw Error('E_HTML_REPAIR_CSS_SELECTOR_INVALID');
           });
         }
         for(const prop of [...declaration]){
           const old=declaration.getPropertyValue(prop).trim();
           if(dangerousStyleValue.test(old))throw Error('E_HTML_REPAIR_UNSAFE_STYLE');
           if(explicit||(!cssStatusValue(prop)&&!uncertainCssValue(old)))continue;
           const priority=declaration.getPropertyPriority(prop);
           fill('css',`样式表 ${String(rule.selectorText||rule.keyText||'CSS规则')} / ${prop}`,old,(value,key)=>{
             const next=cssRuleValue(prop,value,key);
             declaration.setProperty(prop,next,priority);
             if(declaration.getPropertyValue(prop).trim()!==next)throw Error('E_HTML_REPAIR_CSS_VALUE_UNSUPPORTED: '+prop);
           });
         }
         return rule.cssText;
       }
       if(rule.cssRules){
         // Animation names are selectors/references too: `@keyframes dead`
         // may be bound to an old emotional state. Require provenance unless
         // explicitly named as an immutable static CSS token by the owner.
         if(rule.type===CSSRule.KEYFRAMES_RULE&&rule.name&&!new Set(String(contract.staticClassTokens||'').split(/[\s,]+/)).has(rule.name)){
           const oldName=rule.name;
           fill('css_identifier','关键帧动画名称（可能编码旧状态）',oldName,(value,key)=>{
             const name=value===null?'mima_pending_animation_'+key:String(value).trim();
             if(!/^[a-zA-Z_][\w-]*$/.test(name))throw Error('E_HTML_REPAIR_DYNAMIC_ANIMATION_INVALID');
             rule.name=name;
           });
         }
         const text=rule.cssText,opening=text.indexOf('{');
         if(opening<0)throw Error('E_HTML_REPAIR_CSS_RULE_UNSUPPORTED');
         return text.slice(0,opening+1)+'\n'+rewrite(rule.cssRules).join('\n')+'\n}';
       }
       throw Error('E_HTML_REPAIR_CSS_RULE_UNSUPPORTED');
     });
     el.textContent=(comments.length?comments.join('\n')+'\n':'')+rewrite(sheet.cssRules).join('\n');
   };
   const walk=node=>{
     if(node===body)return;
     if(node.nodeType===8){
       const old=node.nodeValue||'';
       if(commentAuthorizations(contract).has(old.trim()))return;
       fill('comment','未归属 HTML 注释（原模板可能包含旧剧情）',old,(value,key)=>{
         if(value!==null&&(/--|<!--|\u0000/.test(value)||!value.trim()))throw Error('E_HTML_REPAIR_COMMENT_INVALID');
         node.nodeValue=value??`【待确认:${key}】`;
       });
       return;
     }
     if(node.nodeType===3){
       if(!node.nodeValue.trim()||staticText(node)||node.parentElement?.tagName==='STYLE')return;
       const old=node.nodeValue;
       fill('text',inStatus(node.parentElement)?'状态文字':'未归属模板文字（禁止自动继承）',old,(value,key)=>{node.nodeValue=value??`【待确认:${key}】`});
       return;
     }
     if(node.nodeType!==1)return;
     if(node.tagName==='STYLE'){rewriteStyleSheet(node);return;}
     const status=inStatus(node);
     if(!staticText(node)){
       for(const a of [...node.attributes]){
         const name=a.name,old=a.value;
         if(name.startsWith('data-mima-'))throw Error('E_HTML_REPAIR_RESERVED_ATTRIBUTE');
         if(name==='style'){
           const scratch=document.createElement('span');scratch.setAttribute('style',old);
           if(old.trim()&&!scratch.style.length)throw Error('E_HTML_REPAIR_STYLE_COMPLEX');
           const replaced=[];
           const explicitlyStatic=cssStaticElement(node,contract);
           for(const prop of [...scratch.style]){
             const raw=scratch.style.getPropertyValue(prop).trim(),priority=scratch.style.getPropertyPriority(prop);
             if(dangerousStyleValue.test(raw))throw Error('E_HTML_REPAIR_UNSAFE_STYLE');
             if(!explicitlyStatic&&(cssStatusValue(prop)||uncertainCssValue(raw))){
               fill('css',`内联样式 ${prop}`,raw,(value,key)=>{
                 replaced.push(prop+':'+cssRuleValue(prop,value,key)+(priority?' !important':''));
               });
             }else replaced.push(prop+':'+raw+(priority?' !important':''));
           }
           node.setAttribute('style',replaced.join(';'));continue;
         }
         if(name==='class'){
           // Layout classes are not current state. Status/meter are structural;
           // unrecognized semantic classes require human verification.
           const authorizedTokens=new Set(String(contract.staticClassTokens||'').split(/[\s,]+/).filter(Boolean));
           const staticClasses=old.split(/\s+/).filter(Boolean).filter(x=>
             /^(?:story-body|static-title|status|status-panel|meter|progress|bar|track|fill|label|value|row|col|grid|panel|box|card|content|text|left|right|small|large)$/i.test(x)||authorizedTokens.has(x));
           const dynamicClasses=old.split(/\s+/).filter(Boolean).filter(x=>!staticClasses.includes(x));
           if(dynamicClasses.length)fill('class','状态 class（仅填本轮确认的类别）',dynamicClasses.join(' '),(value,key)=>{
             if(value!==null&&!/^[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)*$/.test(value))throw Error('E_HTML_REPAIR_DYNAMIC_CLASS_INVALID');
             node.setAttribute('class',[...staticClasses,...(value?value.split(/\s+/):[])].join(' '));
             if(!value)node.setAttribute('data-mima-pending-class',key);
           });
           continue;
         }
         if(name==='role'||name==='dir'||name==='lang'||name==='tabindex')continue;
         if(name==='id'&&/^[a-z_][a-z0-9_-]*$/i.test(old)&&!/(?:\d{2,}|happy|sad|angry|dead|alive|mood|emotion|hp\d|value\d)/i.test(old))continue;
         if(name==='hidden'){fill('boolean','隐藏状态 hidden',old||'hidden',(value,key)=>{
           if(value===null){node.removeAttribute('hidden');node.setAttribute('data-mima-pending-hidden',key);}
           else if(/^(?:true|yes|hidden|1)$/i.test(value))node.setAttribute('hidden','');
           else if(/^(?:false|no|0)$/i.test(value))node.removeAttribute('hidden');
           else throw Error('E_HTML_REPAIR_DYNAMIC_BOOLEAN_INVALID');
         });continue;}
         // Every data-*, aria-*, title, input value and unclassified attribute
         // is dynamic. There is no safe default from last turn.
         const numeric=/^(?:value|max|min|aria-valuenow|aria-valuemax|aria-valuemin)$/i.test(name);
         fill(numeric?'number':'attribute',status?`状态属性 ${name}`:`未归属属性 ${name}`,old,(value,key)=>{
           if(value===null){node.removeAttribute(name);node.setAttribute('data-mima-pending-attribute-'+n,key);}
           else {
             if(numeric&&!/^-?\d+(?:\.\d+)?$/.test(value))throw Error('E_HTML_REPAIR_DYNAMIC_NUMBER_INVALID: '+key);
             node.setAttribute(name,value);
           }
         });
       }
     }
     for(const child of [...node.childNodes])walk(child);
   };
   for(const node of [...model.childNodes])walk(node);
   safeAttributes(model,contract);
   const html=model.innerHTML;
   if(!rawBalance(html).ok)throw Error('E_HTML_REPAIR_TEMPLATE_INCOMPLETE');
   return {html,fields};
 }
 function exactSource(source){
   const original=String(source||'');if(!markup(original))return original;
   // Mixed/partial HTML is not safely code-mappable without an explicit
   // body extraction decision. AI is optional, but the same exact text check
   // is mandatory on its returned HTML. Text from other nodes is never guessed.
   throw Error('E_HTML_REPAIR_AMBIGUOUS: 源内容包含混合 HTML，可选择单次 AI 排版或自行编辑');
 }
 function propose(current,template,contract={}){
   const source=exactSource(current),result=skeleton(source,template,contract);
   const checked=inspect(result.html,{...contract,templateHtml:result.html});
   if(!checked.ok)throw Error('E_HTML_REPAIR_TEMPLATE_INCOMPLETE: '+checked.missing.join(','));
   return {proposedContent:result.html,repairActions:['restore_static_shell','insert_original_story','flag_dynamic_values'],
     confidence:'structural_only',missingFields:result.fields};
 }
 function finalizeProposal(current,template,contract,candidate,values){
   if(!values||typeof values!=='object')throw Error('E_HTML_REPAIR_DYNAMIC_VALUES_REQUIRED');
   const pending=propose(current,template,contract);
   if(pending.proposedContent!==candidate)throw Error('E_HTML_REPAIR_CHANGED');
   for(const field of pending.missingFields){if(!Object.hasOwn(values,field.key)||!String(values[field.key]).trim())throw Error('E_HTML_REPAIR_DYNAMIC_FIELD_MISSING: '+field.key);}
   const result=skeleton(exactSource(current),template,contract,values).html;
   if(!inspect(result,{...contract,templateHtml:result}).ok)throw Error('E_HTML_REPAIR_FINAL_CONTRACT_FAILED');
   return result;
 }
 // Paid AI can attempt a mixed fragment that the deterministic path refuses.
 // It must emit a precise *source-preserving* structure; untrusted values never
 // acquire the status of current facts simply because a model returned them.
 function aiAdmission(source,template,contract){
   if(!contract?.requireHtml)throw Error('E_HTML_AI_CONTRACT_DISABLED');
   const model=elTree(template);safeAttributes(model);
   if(onlyUnique(model,String(contract.bodySelector||'')).length!==1)throw Error('E_HTML_AI_BODY_SLOT_NOT_UNIQUE');
   // Inspect HTML safely without granting it authority. No API is called here.
   // Partially closed markup is the primary opt-in rescue case; the inert
   // parser may identify a unique prose slot, but cannot authorize new facts.
   let expected=String(source||'');
   if(markup(source)){
     const parsed=elTree(source);safeAttributes(parsed);
     const body=onlyUnique(parsed,String(contract.bodySelector||''));
     if(body.length!==1)throw Error('E_HTML_AI_SOURCE_PROSE_UNVERIFIABLE');
     // Do not silently discard plot prose outside the approved body slot.
     // Old status labels are quarantined as pending human fields, while any
     // other out-of-slot narrative makes paid rescue unsafe before charging.
     const outside=parsed.cloneNode(true);
     for(const el of [...onlyUnique(outside,String(contract.bodySelector||''))])el.remove();
     const statusSelector=String(contract.statusSelector||'').trim();
     const oldStatuses=statusSelector?[...onlyUnique(outside,statusSelector)]:[...outside.querySelectorAll('[class*="status" i],[id*="status" i],[class*="meter" i],[id*="meter" i],meter,progress')];
     for(const el of oldStatuses)el.remove();
     for(const el of [...outside.querySelectorAll('style')])el.remove();
     if(outside.textContent.trim())throw Error('E_HTML_AI_SOURCE_OUTSIDE_BODY_UNVERIFIED');
     expected=body[0].textContent||'';
     if(!expected.trim())throw Error('E_HTML_AI_SOURCE_PROSE_EMPTY');
   }
   return {expectedProse:expected,deterministicAvailable:!markup(source)};
 }
  function finalizeWithProse(prose,template,contract,candidate,values){
    const pending=skeleton(prose,template,contract);
    if(pending.html!==candidate)throw Error('E_HTML_AI_LAYOUT_OR_DYNAMIC_UNVERIFIED');
    for(const field of pending.fields)if(!Object.hasOwn(values||{},field.key)||!String(values[field.key]).trim())throw Error('E_HTML_REPAIR_DYNAMIC_FIELD_MISSING: '+field.key);
    const final=skeleton(prose,template,contract,values).html;
    if(!inspect(final,{...contract,templateHtml:final}).ok)throw Error('E_HTML_REPAIR_FINAL_CONTRACT_FAILED');
    return final;
  }
 function verifyReformat(source,output,template,contract){
   const admit=aiAdmission(source,template,contract),model=elTree(output);safeAttributes(model);
   if(!inspect(output,contract).ok)throw Error('E_HTML_AI_MISSING_OR_UNCLOSED_NODE');
   const b=onlyUnique(model,String(contract.bodySelector||''));
   if(b.length!==1||b[0].textContent!==admit.expectedProse)throw Error('E_HTML_AI_FACT_ADDED_OR_PROSE_CHANGED');
   // AI may repair original mixed markup, but must not change a single static
   // template node nor manufacture a dynamic status value.
   const expected=skeleton(admit.expectedProse,template,contract);
   if(!model.isEqualNode(elTree(expected.html)))throw Error('E_HTML_AI_LAYOUT_OR_DYNAMIC_UNVERIFIED');
   return {ok:true,missingFields:expected.fields};
 }
 window.MimaHtmlStructure=Object.freeze({inspect,threePart,continuationKind,propose,finalizeProposal,finalizeWithProse,aiAdmission,verifyReformat,rawBalance,closeUnclosedTags});
})();
