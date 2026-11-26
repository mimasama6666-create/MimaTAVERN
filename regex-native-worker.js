/* Compiled native RegExp plans are local to this killable worker. */
'use strict';
const plans=new Map();
const text=value=>String(value??'');
const limit=8;

function compile(packs){
 return packs.flatMap(pack=>pack.rules.map(rule=>{
  try{
   if(!rule.pattern)throw Error('匹配式为空');
   return {pack,rule,regex:new RegExp(rule.pattern,rule.flags||'g')};
  }catch(error){return {pack,rule,error:error.message};}
 }));
}
function putPlan(key,packs){
 plans.set(key,compile(packs));
 while(plans.size>limit)plans.delete(plans.keys().next().value);
}
function protocolMissing(source,checks){
 const missing=[];
 for(const check of checks||[]){
  const match=new RegExp(check.pattern,check.flags||'').exec(source);
  if(!match||(check.fields||[]).some(field=>!text(typeof field==='string'?match.groups?.[field]:match[field]).trim()))missing.push(check.name);
 }
 return missing;
}
self.onmessage=event=>{
 const packet=event.data||{},id=packet.id;
 try{
  if(packet.type==='configure'){
   putPlan(packet.key,packet.packs);
   self.postMessage({id,ok:true,keys:[...plans.keys()]});
   return;
  }
  const steps=plans.get(packet.key);
  if(!steps)throw Error('正则执行计划尚未准备');
  let output=text(packet.input),matchedPack=false;
  const diagnostics=[],missingFields=protocolMissing(output,packet.protocol);
  if(!missingFields.length)for(const {pack,rule,regex,error} of steps){
   try{
    if(error)throw Error(error);
    regex.lastIndex=0;
    const next=output.replace(regex,rule.replacement);
    if(pack.id===packet.tracePackId&&next!==output)matchedPack=true;
    output=next;
   }catch(error){diagnostics.push({packId:pack.id,packName:pack.name,ruleId:rule.id,ruleName:rule.name,error:error.message});}
  }
  self.postMessage({id,ok:true,output,diagnostics,matchedPack,missingFields});
 }catch(error){self.postMessage({id,ok:false,error:error.message||String(error)});}
};
