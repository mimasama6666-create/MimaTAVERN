/* Fixed offline library selection. The parent verifies bytes but never evals them. */
(function(root){'use strict';
 const data=root.MimaAuthorLibraryData;delete root.MimaAuthorLibraryData;
 const registry=new Map((data||[]).map(item=>[item.id,item]));
 const fail=message=>Object.assign(new Error(message),{code:'E_AUTHOR_DEPENDENCY'});
 const meta=item=>({id:item.id,version:item.version,format:item.format,provenance:item.provenance});
 function list(){return [...registry.values()].map(meta);}
 function select(ids=[]){
  if(!Array.isArray(data)||registry.size!==4)throw fail('固定离线库文件没有完整加载，请重新覆盖完整程序包');
  if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>!registry.has(id)))throw fail('离线依赖选择无效；不加载任意 CDN 或未知版本');
  return ids.map(id=>{const item=registry.get(id),sources=item.format==='classic'?[item]:item.modules;
   for(const source of sources)if(root.MimaAuthorContract.hash(source.source)!==source.sha256)throw fail(id+' 离线代码 SHA256 不一致，未执行');
   return JSON.parse(JSON.stringify(item));
  });
 }
 root.MimaAuthorLibraries=Object.freeze({list,select});
})(typeof window!=='undefined'?window:globalThis);
