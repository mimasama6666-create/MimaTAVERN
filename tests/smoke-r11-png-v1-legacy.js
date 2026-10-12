'use strict';
const assert=require('node:assert/strict'),zlib=require('node:zlib');
const png=require('../png-card-import.js');global.MimaPngCardImport=png;
const imp=require('../compat-import.js');
function crc(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(kind,bytes){const tag=Buffer.from(kind),data=Buffer.concat([tag,bytes]),len=Buffer.alloc(4),tail=Buffer.alloc(4);len.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(data));return Buffer.concat([len,data,tail]);}
function text(k,value){return chunk('tEXt',Buffer.from(k+'\0'+value,'utf8'));}
function cardPng(...extras){return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',Buffer.from('00000001000000010806000000','hex')),...extras,chunk('IDAT',zlib.deflateSync(Buffer.from([0,1,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);}
(async()=>{
 const simple=cardPng(text('name','Legacy Cat'),text('description','A working V1 character'),text('first_mes','V1 greeting'),text('Comment','not code'));
 const legacy=await png.inspect(new Blob([simple]));assert.equal(legacy.card.version,'V1');assert.equal(legacy.card.card.name,'Legacy Cat');
 const scanned=await imp.inspectBytes(new Uint8Array(simple),'old.png');assert.equal(scanned.resources.filter(x=>x.kind==='character').length,1);assert.equal(scanned.resources.find(x=>x.kind==='character').path,'png.v1flat.data');assert.equal(scanned.resources.find(x=>x.kind==='character').raw.first_mes,'V1 greeting');assert.equal(scanned.bytes.length,simple.length);
 const ordinary=cardPng(text('Title','Vacation'),text('Comment','hello'));const image=await png.inspect(new Blob([ordinary]));assert.equal(image.card,null);await assert.rejects(()=>imp.inspectBytes(new Uint8Array(ordinary)),e=>e.code==='E_PNG_NOT_CHARACTER_CARD');
 const rich={spec:'chara_card_v2',data:{name:'Compressed Cat',description:'compressed payload',first_mes:'hello'}};
 const zipped=cardPng(text('chara',zlib.deflateSync(Buffer.from(JSON.stringify(rich))).toString('base64')));
 const compressed=await png.inspect(new Blob([zipped]));assert.equal(compressed.card.card.name,'Compressed Cat');
 assert.equal((await imp.inspectBytes(new Uint8Array(zipped))).resources.filter(x=>x.kind==='character').length,1);
 const bad=zlib.deflateSync(Buffer.from('{not-json')).toString('base64');const broken=cardPng(text('chara',bad));
 assert.equal((await png.inspect(new Blob([broken]))).card,null);
 await assert.rejects(()=>imp.inspectBytes(new Uint8Array(broken)),e=>e.code==='E_PNG_CARD_INVALID');
 const v3Broken=cardPng(text('ccv3','not-base64'),text('chara',zlib.deflateSync(Buffer.from(JSON.stringify(rich))).toString('base64')));
 await assert.rejects(()=>imp.inspectBytes(new Uint8Array(v3Broken)),e=>e.code==='E_PNG_CARD_INVALID');
 console.log('PASS V1 flat fields, strict ordinary PNG exclusion, bounded base64-zlib legacy V2, malformed data reject, no V3->V2 fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
