/* R11 offline lexical search. Derived evidence index, never a canonical store.
 * No vector model, network, background authority, or persistence side effects.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaHistorySearch=api;})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
 const excluded=new Set(['主人','角色','剧情','故事','继续','回复','然后','之后','可以','这个','那个']);
 function tokenize(value){const v=String(value||'').normalize('NFKC').toLocaleLowerCase(),blocks=v.match(/[\p{Script=Han}]+|[a-z0-9_]+(?:[-.][a-z0-9_]+)*/gu)||[],terms=[];
  for(const block of blocks){if(/[\p{Script=Han}]/u.test(block)){for(let i=0;i<block.length-1;i++){const gram=block.slice(i,i+2);if(!excluded.has(gram))terms.push(gram);}}else if(block.length>=2)terms.push(block);}
  // Date-like phrases are independent of regular lexical terms.
  for(const date of (v.match(/(?<!\d)\d{4}[-\/]\d{1,2}(?:[-\/]\d{1,2})?(?![\d\/\-])/g)||[]))terms.push('date:'+date.replaceAll('/','-'));
  return terms;
 }
 function mapCounts(value){const map=new Map();for(const term of tokenize(value))map.set(term,(map.get(term)||0)+1);return map;}
 function rank(query,items,{aliases={},limit=0}={}){
  if(!Array.isArray(items))throw new TypeError('search items must be an array');
  const q=new Set(tokenize(query));
  // Expand only user-provided, explicit aliases. Never infer knowledge or
  // promote external data into a fact about a character.
  if(aliases&&typeof aliases==='object')for(const [canonical,alt] of Object.entries(aliases)){
   const names=[canonical,...(Array.isArray(alt)?alt:typeof alt==='string'?[alt]:[])].filter(Boolean);
   if(names.some(n=>String(query).toLocaleLowerCase().includes(String(n).toLocaleLowerCase())))
    for(const n of names)for(const t of tokenize(n))q.add(t);
  }
  if(!q.size)return [];
  const docs=[],df=new Map();let totalLength=0;
  for(const [ordinal,item] of items.entries()){
   const counts=mapCounts(item.text),length=[...counts.values()].reduce((a,b)=>a+b,0),date=String(item.createdAt||'');
   if(date){for(const t of tokenize(date).filter(t=>t.startsWith('date:'))){if(!counts.has(t))counts.set(t,1);}}
   totalLength+=length;for(const t of q)if(counts.has(t))df.set(t,(df.get(t)||0)+1);
   docs.push({item,ordinal,counts,length});
  }
  const N=items.length,avg=N?Math.max(1,totalLength/N):1,k1=1.5,b=0.75;
  const output=[];for(const doc of docs){let score=0,hits=[];for(const t of q){const tf=doc.counts.get(t)||0;if(!tf)continue;
    const idf=Math.log(1+(N-(df.get(t)||0)+0.5)/((df.get(t)||0)+0.5));
    const normal=tf*(k1+1)/(tf+k1*(1-b+b*doc.length/avg));score+=idf*normal;hits.push(t);
   }
   if(score>0)output.push({id:doc.item.id??doc.ordinal,score,ordinal:doc.ordinal,hits,item:doc.item});
  }
  output.sort((a,b)=>b.score-a.score||b.ordinal-a.ordinal);
  return limit>0?output.slice(0,limit):output;
 }
 return Object.freeze({tokenize,rank});
});
