/* Native regex: isolated execution only; no main-thread regex for user patterns. */
'use strict';
const FLAG_ORDER=['d','g','i','m','s','u','v','y'];
const str=value=>String(value??'');
const sorted=rows=>[...(Array.isArray(rows)?rows:[])].sort((a,b)=>Number(a?.priority??50)-Number(b?.priority??50));
const flags=value=>FLAG_ORDER.filter(ch=>new Set(String(value||'g').toLowerCase().split('')).has(ch)).join('')||'g';
self.onmessage=event=>{
 try{
  const {entries=[],packs=[]}=event.data||{};const output=[];
  for(const item of entries){
   const phase=item.phase||'display';let current=str(item.input),diagnostics=[];
   for(const pack of sorted(packs).filter(p=>p&&p.enabled!==false)){
    for(const rule of sorted(pack.rules).filter(r=>r&&r.enabled!==false&&(r.phase||'display')===phase)){
     if(!str(rule.pattern)){diagnostics.push({packId:pack.id,packName:pack.name,ruleId:rule.id,ruleName:rule.name,error:'pattern 为空'});continue;}
     try{current=current.replace(new RegExp(str(rule.pattern),flags(rule.flags)),str(rule.replacement));}
     catch(e){diagnostics.push({packId:pack.id,packName:pack.name,ruleId:rule.id,ruleName:rule.name,error:String(e?.message||e)});}
    }
   }
   output.push({output:current,diagnostics});
  }
  self.postMessage({ok:true,results:output});
 }catch(e){self.postMessage({ok:false,error:String(e?.message||e)});}
};
