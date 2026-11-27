/* RFC 4122 version 4 IDs from browser cryptographic randomness, including HTTP
 * origins where getRandomValues exists but randomUUID is not exposed. */
(function(root){'use strict';
 function uuid(){
  const crypto=root.crypto;
  if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
  if(typeof crypto?.getRandomValues!=='function')throw Object.assign(Error('当前浏览器无法生成安全随机标识；未创建或覆盖资料，请使用支持安全随机数的浏览器。'),{code:'E_SECURE_RANDOM_UNAVAILABLE'});
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 }
 root.MimaRandomId=Object.freeze({uuid});
})(window);
