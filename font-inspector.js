/* On-demand, read-only SFNT/cmap/weight inspection. Never modifies or normalizes source font bytes. */
window.MimaFontInspector = (() => {
  const samples = [
    ['中文简体','咪嘛馆 中文简体 你好 天束影'],
    ['日本語','日本語 あいうえお カタカナ 漢字'],
    ['Latin','Aa 0123']
  ];
  const check=(v,n,o,len)=>{if(o<0||len<0||o+len>n)throw new Error('字体表边界无效');return o;};
  const tag=(v,o)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+o,4));
  const normalize=r=>{
    r.sort((a,b)=>a[0]-b[0]);const out=[];
    for(const [a,b] of r){if(a>b||a>0x10ffff)continue;const end=Math.min(b,0x10ffff),prev=out[out.length-1];
      if(prev&&a<=prev[1]+1)prev[1]=Math.max(prev[1],end);else out.push([a,end]);}
    return out;
  };
  const contains=(ranges,cp)=>{let a=0,b=ranges.length-1;while(a<=b){const m=(a+b)>>1,x=ranges[m];if(cp<x[0])b=m-1;else if(cp>x[1])a=m+1;else return true;}return false;};
  function minus(ranges,used){const result=[];let j=0;for(const [a,b] of ranges){let s=a;while(j<used.length&&used[j][1]<s)j++;for(let k=j;k<used.length&&used[k][0]<=b;k++){if(used[k][0]>s)result.push([s,Math.min(b,used[k][0]-1)]);s=Math.max(s,used[k][1]+1);if(s>b)break;}if(s<=b)result.push([s,b]);}return result;}
  const cssRange=ranges=>ranges.map(([a,b])=>'U+'+a.toString(16).toUpperCase()+(a===b?'':'-'+b.toString(16).toUpperCase())).join(',');
  async function read(buffer,format='',custom='',weightOnly=false){
    if(buffer instanceof Blob)buffer=await buffer.arrayBuffer();
    if(!(buffer instanceof ArrayBuffer))throw Error('无效字体二进制');
    const view=new DataView(buffer);let base=0,collection=false;
    if(buffer.byteLength<12)throw Error('文件过短');
    const signature=tag(view,0);let woff=signature==='wOFF';
    if(signature==='wOF2')return {kind:'WOFF2',supported:false,warning:'WOFF2 压缩字形映射无法在当前轻量解析器中可靠读取；浏览器仍可直接加载和预览',samples:samples.map(([name,text])=>({name,text,status:'unknown'})),ranges:[],weight:null,axis:null};
    if(signature==='ttcf'){
      collection=true;check(view,buffer.byteLength,12,4);const count=view.getUint32(8);if(!count||count>256)throw Error('字体集合目录不合法');base=view.getUint32(12);check(view,buffer.byteLength,base,12);
    }
    const tables=new Map();
    if(woff){
      const count=view.getUint16(12),dir=44;check(view,buffer.byteLength,dir,count*20);
      for(let i=0;i<count;i++){const p=dir+i*20,name=tag(view,p),offset=view.getUint32(p+4),compressed=view.getUint32(p+8),size=view.getUint32(p+12);check(view,buffer.byteLength,offset,compressed);tables.set(name,{offset,compressed,size});}
    }else{
      check(view,buffer.byteLength,base,12);const count=view.getUint16(base+4),dir=base+12;check(view,buffer.byteLength,dir,count*16);
      for(let i=0;i<count;i++){const p=dir+i*16,name=tag(view,p),offset=view.getUint32(p+8),size=view.getUint32(p+12);check(view,buffer.byteLength,offset,size);tables.set(name,{offset,size,compressed:size});}
    }
    async function table(name){const t=tables.get(name);if(!t)return null;
      if(!woff||t.size===t.compressed)return new DataView(buffer,t.offset,t.size);
      if(typeof DecompressionStream!=='function')throw Error('浏览器不支持 WOFF deflate 表解压');
      const slice=new Blob([new Uint8Array(buffer,t.offset,t.compressed)]);
      const bytes=await new Response(slice.stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
      if(bytes.byteLength!==t.size)throw Error('WOFF 解压表大小不符');return new DataView(bytes);
    }
    // Preview/apply only need OS/2 + fvar. A full cmap scan of every
    // visible large CJK font was a V5.47 CPU/memory regression.
    async function readWeights(){
      let weight=null,axis=null;
      const os2=await table('OS/2');if(os2&&os2.byteLength>=8)weight=os2.getUint16(4);
      const fvar=await table('fvar');if(fvar&&fvar.byteLength>=16){
        const offset=fvar.getUint16(4),count=fvar.getUint16(8),size=fvar.getUint16(10);
        if(size>=20&&count<=128&&offset+count*size<=fvar.byteLength){
          for(let i=0;i<count;i++){const p=offset+i*size;
            if(tag(fvar,p)==='wght')axis={min:fvar.getInt32(p+4)/65536,default:fvar.getInt32(p+8)/65536,max:fvar.getInt32(p+12)/65536};
          }
        }
      }
      return {weight,axis};
    }
    const weights=await readWeights();
    if(weightOnly)return {...weights,supported:false,kind:collection?'TTC':woff?'WOFF':'SFNT',ranges:[]};
    const cmap=await table('cmap');if(!cmap)throw Error('字体没有 cmap 字符映射表');
    const n=cmap.byteLength;check(cmap,n,0,4);const num=cmap.getUint16(2);check(cmap,n,4,num*8);
    let picked=null,rank=-1;
    for(let i=0;i<num;i++){const p=4+i*8,platform=cmap.getUint16(p),encoding=cmap.getUint16(p+2),off=cmap.getUint32(p+4);
      if(off+2>n)continue;const type=cmap.getUint16(off);if(type!==4&&type!==12)continue;
      const score=type===12?((platform===3&&encoding===10)?5:4):((platform===3&&encoding===1)?3:2);
      if(score>rank){rank=score;picked={off,type};}
    }
    if(!picked)throw Error('没有可支持的 Unicode cmap format 4/12');
    const ranges=[];const o=picked.off;
    if(picked.type===12){check(cmap,n,o,16);const groups=cmap.getUint32(o+12);check(cmap,n,o+16,groups*12);
      for(let i=0;i<groups;i++){const p=o+16+i*12,start=cmap.getUint32(p),end=cmap.getUint32(p+4),startGlyph=cmap.getUint32(p+8);
        if(startGlyph===0){if(start<end)ranges.push([start+1,end]);}else ranges.push([start,end]);}
    }else{
      check(cmap,n,o,14);const seg=cmap.getUint16(o+6)/2;const endOff=o+14,startOff=endOff+seg*2+2,deltaOff=startOff+seg*2,rangeOff=deltaOff+seg*2;
      check(cmap,n,rangeOff,seg*2);
      for(let i=0;i<seg;i++){const start=cmap.getUint16(startOff+i*2),end=cmap.getUint16(endOff+i*2),delta=cmap.getInt16(deltaOff+i*2),range=cmap.getUint16(rangeOff+i*2);
        if(start>end)continue;let run=-1;
        for(let cp=start;cp<=end&&cp!==0xffff;cp++){
          let glyph=range===0?(cp+delta)&0xffff:0;
          if(range!==0){const addr=rangeOff+i*2+range+(cp-start)*2;if(addr+2<=n){glyph=cmap.getUint16(addr);if(glyph)glyph=(glyph+delta)&0xffff;}}
          if(glyph){if(run===-1)run=cp;}else if(run!==-1){ranges.push([run,cp-1]);run=-1;}
        }if(run!==-1)ranges.push([run,Math.min(end,0xfffe)]);
      }
    }
    const coverage=normalize(ranges);
    const {weight,axis}=weights;
    const result={kind:collection?'TTC 第一字体':woff?'WOFF':'SFNT',supported:true,weight,axis,ranges:coverage,warning:collection?'字体集合仅检查第一字体，其余字形可能不同':''};
    result.samples=samples.map(([name,text])=>summary(result,name,text));
    if(custom)result.custom=summary(result,'自定义测试句',String(custom).slice(0,160));
    return result;
  }
  function summary(result,name,text){if(!result.supported)return {name,text,status:'unknown'};
    const unique=[...new Set([...text].filter(c=>!/^\s$/.test(c)).map(c=>c.codePointAt(0)))];
    const missing=unique.filter(cp=>!contains(result.ranges,cp));
    return {name,text,status:missing.length?'partial':'covered',matched:unique.length-missing.length,total:unique.length,missing:missing.map(cp=>String.fromCodePoint(cp)).join('')};
  }
  const readWeight=(buffer,format='')=>read(buffer,format,'',true);
  return {read,readWeight,summary,contains,minus,normalize,cssRange,samples};
})();
