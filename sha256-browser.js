/* Local SHA-256: standards-equivalent fallback when WebCrypto SubtleCrypto is
 * unavailable on file:/legacy mobile browsing contexts. NO unverified hashes.
 * Exact FIPS 180-4 SHA-256, bounded by caller's existing file size budget.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MimaSHA256=api;})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
 const K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
 const initial=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const r=(x,n)=>(x>>>n)|(x<<(32-n));
 function digest(bytes){
  if(!(bytes instanceof Uint8Array))throw new TypeError('SHA-256 requires Uint8Array');
  // The callers cap original files at 32 MB, so length*8 is exactly
  // representable as a JS integer. Never build a second 32MB padded copy.
  if(bytes.byteLength>32*1024*1024)throw new RangeError('SHA-256 input exceeds approved source cap');
  const h=initial.slice(),w=new Uint32Array(64),block=new Uint8Array(64);
  const paddedSize=Math.ceil((bytes.length+9)/64)*64;
  for(let pos=0;pos<paddedSize;pos+=64){
   block.fill(0);const end=Math.min(bytes.length,pos+64);
   if(end>pos)block.set(bytes.subarray(pos,end));
   if(pos<=bytes.length&&bytes.length<pos+64)block[bytes.length-pos]=0x80;
   if(pos+64===paddedSize){const bits=bytes.length*8;const hi=Math.floor(bits/0x100000000),lo=bits>>>0;
    block[56]=(hi>>>24)&255;block[57]=(hi>>>16)&255;block[58]=(hi>>>8)&255;block[59]=hi&255;
    block[60]=(lo>>>24)&255;block[61]=(lo>>>16)&255;block[62]=(lo>>>8)&255;block[63]=lo&255;
   }
   for(let i=0;i<16;i++){const j=i*4;w[i]=((block[j]<<24)|(block[j+1]<<16)|(block[j+2]<<8)|block[j+3])>>>0;}
   for(let i=16;i<64;i++){
    const x=w[i-15],y=w[i-2];const s0=r(x,7)^r(x,18)^(x>>>3),s1=r(y,17)^r(y,19)^(y>>>10);
    w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
   }
   let [a,b,c,d,e,f,g,hh]=h;
   for(let i=0;i<64;i++){
    const s1=r(e,6)^r(e,11)^r(e,25),ch=(e&f)^(~e&g),t1=(hh+s1+ch+K[i]+w[i])>>>0;
    const s0=r(a,2)^r(a,13)^r(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;
    hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
   }
   for(const [i,v] of [a,b,c,d,e,f,g,hh].entries())h[i]=(h[i]+v)>>>0;
  }
  return h.map(n=>n.toString(16).padStart(8,'0')).join('');
 }
 return Object.freeze({digest});
});
