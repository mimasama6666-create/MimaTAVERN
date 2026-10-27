/* Native regex: isolated execution only; no main-thread regex for user patterns. */
'use strict';
const FLAG_ORDER=['d','g','i','m','s','u','v','y'];
const str=value=>String(value??'');
const sorted=rows=>[...(Array.isArray(rows)?rows:[])].sort((a,b)=>Number(a?.priority??50)-Number(b?.priority??50));
const flags=value=>FLAG_ORDER.filter(ch=>new Set(String(value||'g').toLowerCase().split('')).has(ch)).join('')||'g';
self.onmessage=event=>{
 try{
  const {entries=[],packs=[]}=event.data||{};const output=[],compiled=new Map();
  // Compile and sort once per phase/job, then reset state for each message.
  // Invalid rules still report diagnostics for every affected entry.
  const rulesFor=phase=>{
   if(compiled.has(phase))return compiled.get(phase);
   const rules=[];
   for(const pack of sorted(packs).filter(p=>p&&p.enabled!==false)){
    for(const rule of sorted(pack.rules).filter(r=>r&&r.enabled!==false&&(r.phase||'display')===phase)){
     let regex,error;
     try{if(!str(rule.pattern))throw new Error('pattern 为空');regex=new RegExp(str(rule.pattern),flags(rule.flags));}
     catch(e){error=String(e?.message||e);}
     rules.push({pack,rule,regex,error});
    }
   }
   compiled.set(phase,rules);return rules;
  };
  for(const item of entries){
   const phase=item.phase||'display';let current=str(item.input),diagnostics=[];
   for(const {pack,rule,regex,error} of rulesFor(phase)){
     if(error){diagnostics.push({packId:pack.id,packName:pack.name,ruleId:rule.id,ruleName:rule.name,error});continue;}
     try{regex.lastIndex=0;current=current.replace(regex,str(rule.replacement));}
     catch(e){diagnostics.push({packId:pack.id,packName:pack.name,ruleId:rule.id,ruleName:rule.name,error:String(e?.message||e)});}
   }
   output.push({output:current,diagnostics});
  }
  self.postMessage({ok:true,results:output});
 }catch(e){self.postMessage({ok:false,error:String(e?.message||e)});}
};
