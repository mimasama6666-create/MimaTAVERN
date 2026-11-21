/* TTC/OTC -> standalone SFNT faces. Read-only extraction; does not alter source files.
   A collection's table offsets are absolute; each face is reconstructed with new
   aligned offsets and recalculated checksums before existing FontFace validation. */
window.MimaFontCollection = (() => {
    const dec = typeof TextDecoder === 'function' ? new TextDecoder('utf-16be') : null;
    const tag = (bytes, offset) => String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);
    const check = (length, offset, size, label='字体数据') => {
        if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset>length||size>length-offset)
            throw Error(label+'位置超出文件范围');
    };
    const align4 = n => (n+3)&~3;
    const sum32 = (bytes, offset, length) => {
        let n=0;
        for(let i=0;i<length;i+=4)
            n=(n+(((bytes[offset+i]||0)*0x1000000 + ((bytes[offset+i+1]||0)<<16) + ((bytes[offset+i+2]||0)<<8) + (bytes[offset+i+3]||0))>>>0))>>>0;
        return n;
    };
    function overview(buffer) {
        if(!(buffer instanceof ArrayBuffer))throw Error('字体集合必须是原始二进制文件');
        const bytes=new Uint8Array(buffer),view=new DataView(buffer);
        check(buffer.byteLength,0,12,'TTC 文件头');
        if(tag(bytes,0)!=='ttcf')throw Error('文件不是 TTC / OTC 字体集合');
        const version=view.getUint32(4),count=view.getUint32(8);
        if(version!==0x00010000&&version!==0x00020000)throw Error('不支持此版本的 TTC / OTC 集合');
        if(!count||count>512)throw Error('字体集合的字体数量无效');
        check(buffer.byteLength,12,count*4,'TTC 字体索引');
        const offsets=[];
        for(let i=0;i<count;i++){
            const off=view.getUint32(12+i*4);check(buffer.byteLength,off,12,'TTC 第'+(i+1)+'款字体');offsets.push(off);
        }
        return offsets;
    }
    function faceTables(buffer,index){
        const bytes=new Uint8Array(buffer),view=new DataView(buffer),offsets=overview(buffer);
        if(!Number.isInteger(index)||index<0||index>=offsets.length)throw Error('字体集合索引无效');
        const base=offsets[index],version=view.getUint32(base),count=view.getUint16(base+4);
        if(version!==0x00010000&&version!==0x4f54544f&&version!==0x74727565)
            throw Error('TTC 中的第 '+(index+1)+' 款字体不是可用的 OpenType / TrueType');
        if(!count||count>4096)throw Error('字体表目录数量无效');
        check(buffer.byteLength,base+12,count*16,'字体表目录');
        const tables=[],seen=new Set();
        for(let i=0;i<count;i++){
            const p=base+12+i*16, name=tag(bytes,p), offset=view.getUint32(p+8),length=view.getUint32(p+12);
            if(seen.has(name))throw Error('重复的 OpenType 表：'+name);
            seen.add(name);check(buffer.byteLength,offset,length,'字体表 '+name);
            tables.push({name,offset,length});
        }
        return {version,tables,count:offsets.length};
    }
    // Identify each collection member by full name / style, rather than only
    // typographic family. A TTC often contains several faces with identical
    // family names but distinct weights and styles.
    function faceInfo(buffer,index){
        const {tables}=faceTables(buffer,index),view=new DataView(buffer),t=tables.find(x=>x.name==='name');
        const os2=tables.find(x=>x.name==='OS/2');
        const weight=os2&&os2.length>=8?view.getUint16(os2.offset+4):null;
        if(!t||t.length<6)return {name:'字形 '+(index+1),weight};
        const count=view.getUint16(t.offset+2),base=view.getUint16(t.offset+4);
        check(t.length,6,count*12);
        const candidates=new Map();
        for(let i=0;i<count;i++){
            const p=t.offset+6+i*12,platform=view.getUint16(p),language=view.getUint16(p+4),id=view.getUint16(p+6);
            if(![1,2,4,16,17].includes(id))continue;
            const length=view.getUint16(p+8),start=base+view.getUint16(p+10);
            if(start+length>t.length||!length||length>2048)continue;
            let value='';const data=new Uint8Array(buffer,t.offset+start,length);
            if(platform===0||platform===3){
                if(length%2)continue;
                value=dec?dec.decode(data):Array.from({length:length/2},(_,j)=>String.fromCharCode((data[j*2]<<8)|data[j*2+1])).join('');
            }else if(platform===1)value=Array.from(data,b=>String.fromCharCode(b)).join('');
            value=value.replace(/[\u0000-\u001f\u007f]/g,'').trim();if(!value)continue;
            const score=(platform===3?6:platform===0?5:0)+
                (language===0x804?3:language===0x409?2:language===0x411?1:0);
            const prior=candidates.get(id);if(!prior||score>prior.score)candidates.set(id,{value,score});
        }
        const pick=id=>candidates.get(id)?.value||'';
        const family=pick(16)||pick(1),subfamily=pick(17)||pick(2),full=pick(4);
        let name=full||family||'字形 '+(index+1);
        if(subfamily&&!/^(regular|normal|book|roman|常规|标准)$/i.test(subfamily)&&
            !name.toLocaleLowerCase().endsWith(subfamily.toLocaleLowerCase()))name+=' '+subfamily;
        return {name:name.slice(0,120),family,style:subfamily,weight};
    }
    function faceName(buffer,index){try{return faceInfo(buffer,index).name}catch(_){return '字形 '+(index+1)}}
    function estimateSize(buffer,index){
        const {tables}=faceTables(buffer,index);
        return 12+tables.length*16+tables.reduce((sum,table)=>sum+align4(table.length),0);
    }
    function extract(buffer,index){
        const {version,tables}=faceTables(buffer,index),count=tables.length;
        let size=12+count*16;
        for(const t of tables){size+=align4(t.length);if(size>0x7fffffff)throw Error('字体集合单款字形超过当前浏览器可处理的缓冲范围');}
        const out=new Uint8Array(size),view=new DataView(out.buffer),src=new Uint8Array(buffer);
        view.setUint32(0,version);view.setUint16(4,count);
        const power=2**Math.floor(Math.log2(count));
        view.setUint16(6,power*16);view.setUint16(8,Math.log2(power));view.setUint16(10,count*16-power*16);
        let cursor=12+count*16,headOffset=-1;
        for(let i=0;i<count;i++){
            const t=tables[i],p=12+i*16;
            for(let k=0;k<4;k++)out[p+k]=t.name.charCodeAt(k);
            view.setUint32(p+8,cursor);view.setUint32(p+12,t.length);
            out.set(src.subarray(t.offset,t.offset+t.length),cursor);
            if(t.name==='head'){
                if(t.length<12)throw Error('head 表不完整');
                headOffset=cursor;view.setUint32(cursor+8,0);
            }
            view.setUint32(p+4,sum32(out,cursor,align4(t.length)));
            cursor+=align4(t.length);
        }
        if(headOffset>=0)view.setUint32(headOffset+8,(0xB1B0AFBA-sum32(out,0,out.length))>>>0);
        return {buffer:out.buffer,format:version===0x4f54544f?'otf':'ttf',name:faceName(buffer,index),index,total:overview(buffer).length};
    }
    return {overview,extract,faceName,faceInfo,estimateSize};
})();
