/* Cloud object adapters. No network requests are performed by loading this file. */
window.MimaCloudTargets=(()=>{'use strict';
 const ROOT='mimatavern-cloud/v1/',SAFE=/^[a-zA-Z0-9._\/-]{1,320}$/;
 function validKey(key){if(typeof key!=='string'||!key.startsWith(ROOT)||!SAFE.test(key)||key.includes('..')||key.includes('//'))throw Error('云端路径非法');return key}
 function parse(type,address){
  if(!['github','hf','gateway'].includes(type))throw Error('请选择已完成适配的云存储类型');
  let u;try{u=new URL(String(address||'').trim())}catch(_){throw Error('请输入完整 HTTPS 云存储地址')}
  if(u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('链接只能使用 HTTPS，且不能包含密码、查询参数或片段');
  if(type==='github'){
   const m=u.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
   if(u.hostname!=='github.com'||!m)throw Error('GitHub 地址需为 https://github.com/用户名/私有仓库');
   return {type,address:`https://github.com/${m[1]}/${m[2]}`,owner:m[1],repo:m[2]};
  }
  if(type==='hf'){
   const m=u.pathname.match(/^\/datasets\/([\w.-]+)\/([\w.-]+)\/?$/);
   if(u.hostname!=='huggingface.co'||!m)throw Error('请选择 Hugging Face 私有 Dataset（不是 Space）');
   return {type,address:`https://huggingface.co/datasets/${m[1]}/${m[2]}`,owner:m[1],repo:m[2]};
  }
  if(!/^\/([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(u.pathname)&&u.pathname!=='/')throw Error('网关 URL 路径格式不正确');
  return {type,address:u.origin+u.pathname.replace(/\/$/,'')};
 }
 const explain=error=>{if(error?.name==='AbortError')return Error('操作已暂停，没有完成云端备份');if(error instanceof TypeError)return Error('云端连接失败：请核对网络、HTTPS 与服务端 CORS（跨域许可）');return error};
 async function response(url,init={}){
  let res;try{res=await fetch(url,{...init,redirect:'error',cache:'no-store',credentials:'omit'})}catch(error){throw explain(error)}
  if(res.status===404)return null;
  if(!res.ok){const name={401:'访问凭证失效或未授权',403:'权限不足／私有仓库不可访问',409:'文件已存在或远端写入冲突',412:'目标已有文件，拒绝覆盖',413:'对象超出大小限制',422:'请求被服务拒绝，请检查仓库与文件大小',429:'平台限流，请稍后手动重试',507:'云端空间不足'}[res.status]||'远端操作被拒绝';throw Error(name+'（HTTP '+res.status+'）')}
  return res;
 }
 function github(config,token){
  const base=`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const url=key=>base+'/contents/'+validKey(key).split('/').map(encodeURIComponent).join('/');
  async function metadata(key){const r=await response(url(key),{headers});return r?await r.json():null}
  async function listDir(key){const r=await response(base+'/contents/'+key.split('/').map(encodeURIComponent).join('/'),{headers});if(!r)return [];
   const v=await r.json();if(!Array.isArray(v))throw Error('GitHub 目录返回格式无效');if(v.length>=1000)throw Error('GitHub 目录达到 1000 项上限，请分仓保存');return v;
  }
  return {
   async check(){const r=await response(base,{headers});if(!r)throw Error('GitHub 仓库不存在，或凭证无权读取');const data=await r.json();if(!data.private)throw Error('请选择私有 GitHub 仓库，云端备份不应公开');return {name:data.full_name,private:true}},
   async get(key){const r=await response(url(key),{headers:{...headers,Accept:'application/vnd.github.raw+json'}});return r?await r.blob():null},
   async put(key,blob){validKey(key);if(blob.size>30*1048576)throw Error('GitHub 单次云端加密对象过大');
    // The GitHub Contents API requires base64, unlike the HF/Gateway adapters.
    let chunks=[],tail=new Uint8Array(0);for(let p=0;p<blob.size;p+=192*1024){const a=new Uint8Array(await blob.slice(p,p+192*1024).arrayBuffer()),b=new Uint8Array(tail.length+a.length);b.set(tail);b.set(a,tail.length);const count=b.length-b.length%3;
     for(let k=0;k<count;k+=32760){const limit=Math.min(count,k+32760);chunks.push(btoa(String.fromCharCode(...b.subarray(k,limit))))}
     tail=b.subarray(count).slice();}
    if(tail.length)chunks.push(btoa(String.fromCharCode(...tail)));
    const body=JSON.stringify({message:'MimaTAVERN encrypted manual backup',content:chunks.join('')});chunks=null;
    const r=await response(url(key),{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body});if(!r)throw Error('GitHub 未接受上传');return r.json();
   },
   async createExclusive(key,blob){validKey(key);if(await metadata(key))throw Error('云端删除独占锁已经存在');return this.put(key,blob)},
   async listAll(prefix){validKey(prefix+'placeholder');const all=await listDir(ROOT+'snapshots');const keys=[];
    for(const item of all){if(item.type!=='dir'||!/^([0-9a-f]{32})$/.test(item.name))continue;
     const children=await listDir(ROOT+'snapshots/'+item.name);
     for(const c of children)if(c.type==='file'){const key=ROOT+'snapshots/'+item.name+'/'+c.name;if(key.startsWith(prefix))keys.push(key)}
     if(keys.length>3000)throw Error('GitHub 云端对象超过列表上限，请分仓保存');
    }return keys;
   },
   async list(prefix){return (await this.listAll(prefix)).filter(key=>key.endsWith('/complete.mimaenc'))},
   async releaseExclusive(key,{ownerId}){
    validKey(key);if(!/^[a-f0-9]{32}$/.test(ownerId||''))throw Error('云端删除锁所有权无效');
    const info=await metadata(key);
    if(!info||!/^([a-f0-9]{40})$/.test(info.sha||''))throw Error('云端删除锁已经改变或不可读取，请刷新状态');
    // SHA and owner must come from ONE GitHub Contents response. Separate
    // metadata/get reads can straddle a delete + new owner and delete the
    // replacement lock even though its owner was never authenticated.
    let lock;try{
     if(info.type!=='file'||info.encoding!=='base64'||typeof info.content!=='string')throw Error('missing lock bytes');
     lock=JSON.parse(atob(info.content.replace(/\s/g,'')));
    }catch(_){throw Error('无法从同一 GitHub 文件版本确认删除锁内容及 SHA，不允许释放')}
    if(lock.ownerId!==ownerId)throw Error('删除锁已有新所有者，不允许释放');
    // GitHub Contents DELETE checks this exact blob SHA in the server's commit,
    // not the latest SHA fetched at deletion time.
    const r=await response(url(key),{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'MimaTAVERN delete-owner conditional release',sha:info.sha})});
    if(!r)throw Error('删除锁已经改变；不允许将释放当作成功');
    if(await metadata(key))throw Error('仓库仍有删除锁（可能已由新事务持有），请刷新核对');
    return true;
   },
   async delete(key){const info=await metadata(key);if(!info)return;const r=await response(url(key),{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'MimaTAVERN probe cleanup',sha:info.sha})});if(!r)throw Error('云端探针清理失败');}
  };
 }
 // SDK intentionally loads only after an explicit user action. Pinned official
 // Hub client is required for LFS/Xet multi-step file commits; hand-built PUTs
 // against a Dataset URL do not work for large binary backups.
 let hfLibPromise=null;
 async function hfLibrary(){if(!hfLibPromise)hfLibPromise=import('https://cdn.jsdelivr.net/npm/@huggingface/hub@2.17.10/+esm').catch(error=>{hfLibPromise=null;throw Error('无法加载官方 Hugging Face 上传组件：请检查 CDN 连接和浏览器限制')});return hfLibPromise}
 function huggingface(config,token){
  const repo={type:'dataset',name:config.owner+'/'+config.repo};
  return {
   async check(){const info=await this.revision();return {name:repo.name,private:true,revision:info}},
   async revision(){const r=await response(`https://huggingface.co/api/datasets/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,{headers:{Authorization:'Bearer '+token}});if(!r)throw Error('HF 私有 Dataset 不存在，或凭证无权读取');const data=await r.json();if(!data.private)throw Error('请选择私有 Dataset，不能上传到公开仓库');if(!/^[0-9a-f]{40,64}$/i.test(data.sha||''))throw Error('无法确认 HF 仓库修订版本，拒绝初始化加密仓库');return data.sha},
   async get(key){validKey(key);const api=await hfLibrary();try{return await api.downloadFile({repo,accessToken:token,path:key})}catch(e){
    // Missing lock is a legitimate pre-create state; auth/network errors are not.
    const status=e?.statusCode??e?.status??e?.response?.status??e?.cause?.status;
    if(status===404)return null;
    throw Error('HF 下载失败，请检查凭证和存储权限：'+String(e?.message||'').slice(0,120));
   }},
   async put(key,blob,{ifAbsent=false,parentCommit}={}){validKey(key);const api=await hfLibrary();
    if(ifAbsent&&!/^[0-9a-f]{40,64}$/i.test(parentCommit||''))throw Error('HF 建库需要有效的父提交版本，禁止非原子覆盖');
    try{return await api.uploadFile({repo,accessToken:token,file:{path:key,content:blob},commitTitle:'MimaTAVERN encrypted manual backup',...(ifAbsent?{parentCommit}:{})})}
    catch(e){const msg=String(e?.message||'');throw Error('HF 写入失败'+(ifAbsent?'（可能是并发初始化冲突）':'')+'：'+msg.slice(0,160))};},
   async createExclusive(key,blob){validKey(key);const revision=await this.revision();if(await this.get(key))throw Error('HF 云端删除独占锁已经存在');return this.put(key,blob,{ifAbsent:true,parentCommit:revision})},
   async listAll(prefix){validKey(prefix+'placeholder');const api=await hfLibrary(),keys=[];
    try{for await(const f of api.listFiles({repo,accessToken:token,path:ROOT,recursive:true})){if(f.type==='file'&&typeof f.path==='string'&&f.path.startsWith(prefix))keys.push(f.path);if(keys.length>3000)throw Error('远端对象超过当前列表上限')}}catch(e){throw Error('无法列出 HF 云端对象：'+(e.message||'网络或权限异常'))}return keys;
   },
   async list(prefix){return (await this.listAll(prefix)).filter(key=>key.endsWith('/complete.mimaenc'))},
   async releaseExclusive(key,{ownerId}){
    validKey(key);if(!/^[a-f0-9]{32}$/.test(ownerId||''))throw Error('云端删除锁所有权无效');
    const revision=await this.revision();
    const data=await this.get(key);if(!data)throw Error('删除锁已消失或改变，请重新确认');
    let lock;try{lock=JSON.parse(await data.text())}catch(_){throw Error('远端删除锁损坏，禁止释放')}
    if(lock.ownerId!==ownerId)throw Error('删除锁已有新所有者，禁止解除');
    // Hub commit parentCommit acts as server-enforced repository CAS.
    const api=await hfLibrary();try{await api.deleteFiles({repo,accessToken:token,paths:[key],parentCommit:revision,commitTitle:'MimaTAVERN conditional delete-owner release'})}
    catch(e){throw Error('HF 仓库修订冲突或解除失败；保留真实锁状态，请刷新后人工核对：'+String(e?.message||'').slice(0,160))}
    if(await this.get(key))throw Error('解除后远端仍有删除锁（可能是另一事务），请刷新检查');return true;
   },
   async delete(key){validKey(key);const api=await hfLibrary();try{return await api.deleteFile({repo,accessToken:token,path:key})}catch(e){throw Error('HF 探针文件清理失败，请检查写入权限')};}
  };
 }
 function gateway(config,token){
  const base=config.address,headers={Authorization:'Bearer '+token};
  const fileUrl=key=>base+'/objects/'+validKey(key).split('/').map(encodeURIComponent).join('/');
  return {
   async check(){const r=await response(base+'/health',{headers});if(!r)throw Error('网关未实现 /health');const info=await r.json();if(info.protocol!=='mima-cloud-v1')throw Error('网关未实现咪嘛馆云备份 V1 协议');return info},
   async get(key){const r=await response(fileUrl(key),{headers});return r?await r.blob():null},
   async put(key,blob){const r=await response(fileUrl(key),{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','If-None-Match':'*'},body:blob});if(!r)throw Error('网关没有确认写入')},
   // Gateway V1 R2 has no atomic conditional DELETE. Upload/restore remain available; deletion is disabled until a serialized coordinator is deployed.
   async listAll(prefix){validKey(prefix+'placeholder');const r=await response(base+'/objects?prefix='+encodeURIComponent(prefix),{headers});if(!r)throw Error('网关没有列表接口');const json=await r.json();if(!Array.isArray(json.keys)||json.keys.length>3000||json.keys.some(k=>typeof k!=='string'||!k.startsWith(prefix)))throw Error('网关对象列表不可信');return json.keys},
   async list(prefix){return (await this.listAll(prefix)).filter(key=>key.endsWith('/complete.mimaenc'))},
   async delete(key){const r=await response(fileUrl(key),{method:'DELETE',headers});if(!r)throw Error('网关探针删除失败')}
  };
 }
 function connect(config,token){if(!token||typeof token!=='string')throw Error('请填写云平台访问凭证（仅保留在当前网页内存）');return config.type==='github'?github(config,token):config.type==='hf'?huggingface(config,token):gateway(config,token)}
 return Object.freeze({parse,connect,ROOT,validKey});
})();
