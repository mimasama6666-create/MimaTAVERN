/* MimaTAVERN Cloud V1: password-based local encryption, not a change to V3. */
window.MimaCloudCrypto=(()=>{'use strict';
 const ENC=new TextEncoder(), DEC=new TextDecoder('utf-8',{fatal:true}),BLOCK=256*1024,ITERATIONS=310000;
 const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const unhex=value=>{if(typeof value!=='string'||!/^(?:[0-9a-f]{2})+$/.test(value))throw Error('云端加密参数损坏');return Uint8Array.from(value.match(/../g),s=>parseInt(s,16));};
 function requireCrypto(){if(!globalThis.isSecureContext||!crypto?.subtle||!crypto?.getRandomValues)throw Error('云端加密需要 HTTPS 安全网页和浏览器 Web Crypto');}
 function createVault(){requireCrypto();return {format:'MIMA_CLOUD_VAULT',version:1,vaultId:hex(crypto.getRandomValues(new Uint8Array(16))),kdf:{name:'PBKDF2-HMAC-SHA256',iterations:ITERATIONS,salt:hex(crypto.getRandomValues(new Uint8Array(16)))}};}
 function checkVault(v){if(v?.format!=='MIMA_CLOUD_VAULT'||v.version!==1||!/^([0-9a-f]{32})$/.test(v.vaultId)||v.kdf?.name!=='PBKDF2-HMAC-SHA256'||!Number.isSafeInteger(v.kdf.iterations)||v.kdf.iterations<310000||v.kdf.iterations>2000000||!/^([0-9a-f]{32})$/.test(v.kdf.salt)||!/^([0-9a-f]{64,256})$/.test(v.proof||''))throw Error('云端仓库加密版本或参数无效');return v;}
 async function deriveMaster(vault,password){requireCrypto();if(typeof password!=='string'||password.length<8)throw Error('加密口令需要至少 8 个字符');
  const passwordBytes=ENC.encode(password),source=await crypto.subtle.importKey('raw',passwordBytes,'PBKDF2',false,['deriveBits']);passwordBytes.fill(0);
  const raw=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(vault.kdf.salt),iterations:vault.kdf.iterations,hash:'SHA-256'},source,256));
  try{return await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);}finally{raw.fill(0)}
 }
 async function proofKey(master,vaultId){return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:ENC.encode('MimaTAVERN-CLOUD-V1-OBJECT'),info:ENC.encode('mima-cloud-v1|'+vaultId+'|password-verifier')},master,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
 async function protectVault(vault,password){
  const master=await deriveMaster(vault,password),key=await proofKey(master,vault.vaultId),plaintext=ENC.encode('MIMA-CLOUD-VAULT-CHECK-V1|'+vault.vaultId);
  const proof=await crypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(12),additionalData:ENC.encode(vault.vaultId),tagLength:128},key,plaintext);
  vault.proof=hex(new Uint8Array(proof));return checkVault(vault);
 }
 async function unlock(vault,password){checkVault(vault);const master=await deriveMaster(vault,password),key=await proofKey(master,vault.vaultId);
  try{const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(12),additionalData:ENC.encode(vault.vaultId),tagLength:128},key,unhex(vault.proof));
   if(DEC.decode(data)!=='MIMA-CLOUD-VAULT-CHECK-V1|'+vault.vaultId)throw Error('加密口令验证失败');}
  catch(_){throw Error('加密口令错误；已拒绝把新快照混入该云端仓库')}
  return master;
 }
 function identity(vaultId,snapshotId,kind,index){if(!/^[0-9a-f]{32}$/.test(snapshotId)||!['volume','manifest','complete','deleting'].includes(kind)||!Number.isInteger(index)||index<0||index>1000)throw Error('云端对象身份无效');return `mima-cloud-v1|${vaultId}|${snapshotId}|${kind}|${index}`;}
 async function keyFor(master,vaultId,snapshotId,kind,index){return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:ENC.encode('MimaTAVERN-CLOUD-V1-OBJECT'),info:ENC.encode(identity(vaultId,snapshotId,kind,index))},master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
 function iv(i){const nonce=new Uint8Array(12);new DataView(nonce.buffer).setUint32(8,i,false);return nonce;}
 function aad(id,i,plainSize){return ENC.encode(id+'|'+i+'|'+plainSize)}
 async function hashBlob(blob){if(!(blob instanceof Blob))throw Error('SHA 输入必须是 Blob');const hash=MimaSHA256.create();for(let pos=0;pos<blob.size;pos+=BLOCK)hash.update(new Uint8Array(await blob.slice(pos,pos+BLOCK).arrayBuffer()));return hash.hex();}
 async function encrypt({vault,master,snapshotId,kind,index=0,blob}){
  checkVault(vault);if(!(blob instanceof Blob)||blob.size>16*1048576+1048576)throw Error('云端明文对象尺寸超过本协议单对象上限');
  const id=identity(vault.vaultId,snapshotId,kind,index),key=await keyFor(master,vault.vaultId,snapshotId,kind,index);
  const count=Math.max(1,Math.ceil(blob.size/BLOCK)),header={format:'MIMA_CLOUD_ENCRYPTED',version:1,vaultId:vault.vaultId,snapshotId,kind,index,plainSize:blob.size,chunkSize:BLOCK,chunkCount:count};
  const parts=[ENC.encode(JSON.stringify(header)+'\n')];
  for(let i=0;i<count;i++){
   const start=i*BLOCK,part=new Uint8Array(await blob.slice(start,start+BLOCK).arrayBuffer());
   const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv(i),additionalData:aad(id,i,part.length),tagLength:128},key,part));
   const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,ct.length,false);parts.push(length,ct);
  }
  const cipher=new Blob(parts,{type:'application/octet-stream'});return {cipher,sha256:await hashBlob(cipher),size:cipher.size};
 }
 async function decrypt({vault,master,snapshotId,kind,index=0,cipher}){
  checkVault(vault);if(!(cipher instanceof Blob)||cipher.size<90||cipher.size>18*1048576)throw Error('云端密文对象为空或超过上限');
  const headBytes=new Uint8Array(await cipher.slice(0,2048).arrayBuffer()),line=headBytes.indexOf(10);
  if(line<10||line>1500)throw Error('云端密文头损坏');
  let header;try{header=JSON.parse(DEC.decode(headBytes.subarray(0,line)));}catch(_){throw Error('云端密文头格式无效')}
  const expectedCount=Math.max(1,Math.ceil(header.plainSize/BLOCK));
  if(header.format!=='MIMA_CLOUD_ENCRYPTED'||header.version!==1||header.vaultId!==vault.vaultId||header.snapshotId!==snapshotId||header.kind!==kind||header.index!==index||header.chunkSize!==BLOCK||!Number.isSafeInteger(header.plainSize)||header.plainSize<0||header.plainSize>16*1048576+1048576||header.chunkCount!==expectedCount)
   throw Error('云端密文与当前仓库／快照不匹配');
  const id=identity(vault.vaultId,snapshotId,kind,index),key=await keyFor(master,vault.vaultId,snapshotId,kind,index);
  let offset=line+1;const pieces=[];
  for(let i=0;i<header.chunkCount;i++){
   if(offset+4>cipher.size)throw Error('云端密文块头截断');
   const n=new DataView(await cipher.slice(offset,offset+4).arrayBuffer()).getUint32(0,false);offset+=4;
   const plainLength=Math.min(BLOCK,Math.max(0,header.plainSize-i*BLOCK));
   if(n!==plainLength+16||offset+n>cipher.size)throw Error('云端密文长度损坏');
   const ct=await cipher.slice(offset,offset+n).arrayBuffer();offset+=n;
   try{pieces.push(await crypto.subtle.decrypt({name:'AES-GCM',iv:iv(i),additionalData:aad(id,i,plainLength),tagLength:128},key,ct));}
   catch(_){throw Error('解密认证失败：口令错误，或远程备份已被篡改')}
  }
  if(offset!==cipher.size)throw Error('云端密文含异常附加数据');
  return new Blob(pieces,{type:'application/octet-stream'});
 }
 return Object.freeze({createVault,protectVault,checkVault,unlock,encrypt,decrypt,hashBlob});
})();
