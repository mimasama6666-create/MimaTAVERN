const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const png=require('../png-card-import.js');
const inspector=require('../png-resource-inspector.js');
const sig=Buffer.from('89504e470d0a1a0a','hex');
let table=null;
function crc(b){table??=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function chunk(k,body){const data=Buffer.concat([Buffer.from(k),body]),hdr=Buffer.alloc(4),tail=Buffer.alloc(4);hdr.writeUInt32BE(body.length);tail.writeUInt32BE(crc(data));return Buffer.concat([hdr,data,tail])}
function file(...metadata){const ihdr=Buffer.from('00000001000000010806000000','hex');const idat=zlib.deflateSync(Buffer.from([0,255,255,255,255]));const contents=Buffer.concat([sig,chunk('IHDR',ihdr),...metadata,chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);const f=new Blob([contents],{type:'image/png'});f.name='role.png';return f}
const b64=v=>Buffer.from(JSON.stringify(v),'utf8').toString('base64');
const text=(k,v)=>chunk('tEXt',Buffer.from(k+'\0'+v,'utf8'));
const zip=(k,v)=>chunk('zTXt',Buffer.concat([Buffer.from(k+'\0\0'),zlib.deflateSync(Buffer.from(v))]));
const book={name:'记忆世界',entries:[{comment:'设定',keys:['咖啡厅'],content:'猫喜欢冰淇淋',enabled:true,insertion_order:15,constant:false},{comment:'常驻',keys:[],content:'每天都吃芒果',constant:true}]};
const card={spec:'chara_card_v3',data:{name:'猫咪',description:'兽人',personality:'粘人',first_mes:'咪嘛',system_prompt:'你的角色是猫咪',post_history_instructions:'维持格式',character_book:book,extensions:{css:'<style>.status{color:red}</style>',regex_scripts:[{findRegex:'(\\w+)',replaceString:'$1'}],unlisted:{status_bar:'<div>猫咪状态</div>'}}}};
(async()=>{
 const base=file(text('ccv3',b64(card)),zip('Author','Hello!'),text('XMP','<evil onerror=alert(1)>'));
 const before=new Uint8Array(await base.arrayBuffer());
 const report=await png.inspect(base);const after=new Uint8Array(await base.arrayBuffer());assert.deepEqual(after,before,'inspection does not mutate source');
 assert.equal(report.card.version,'V3');assert.equal(report.metadata.length,3);
 const got=inspector.discover(report);const types=got.map(x=>x.kind);assert(types.includes('worldbook'));assert(types.includes('character'));assert(types.includes('preset'));assert(types.includes('css'));assert(types.includes('unknown'));assert.equal(types.filter(x=>x==='metadata').length,2);
 assert(got.every(x=>!x.selected));
 const wb=got.find(x=>x.kind==='worldbook');assert.equal(wb.canImport,true);assert.deepEqual(wb.payload.entries[0].keywords,['咖啡厅']);assert.equal(wb.payload.entries[0].priority,15);assert.equal(wb.payload.entries[1].alwaysActive,true);
 const script=got.find(x=>x.kind==='unknown');assert.equal(script.canImport,false);assert.equal(got.find(x=>x.kind==='css').payload.css,card.data.extensions.css);
 assert.deepEqual(got.find(x=>x.kind==='character').source,card.data);
 const loss={name:'危险',entries:[{content:'文本',keys:['x'],position:6,extensions:{position:4},probability:5}]};
 const bad=inspector.bookPayload(loss,'fallback');assert(bad.warnings.length>=2);assert.equal(inspector.discover({card:{card:{name:'N',description:'q',character_book:loss},raw:{},version:'V3'},metadata:[]}).find(x=>x.kind==='worldbook').canImport,false);
 const ordinary=await png.inspect(file(text('Comment','hello')));assert.equal(ordinary.card,null);assert.equal(inspector.discover(ordinary)[0].kind,'metadata');
 const broken=new Uint8Array(await base.arrayBuffer());broken[40]^=1;await assert.rejects(()=>png.inspect(new Blob([broken])),/CRC/);
 const corruptCard=await png.inspect(file(text('ccv3','abcd'),text('chara',b64({spec:'chara_card_v2',data:{name:'Old',personality:'old'}}))));assert.match(corruptCard.cardError,/解析失败/);assert.equal(corruptCard.card,null,'broken V3 must never silently fall back to V2');
 // Validate real resource routes and attach semantics against canonical revision Store.
 global.window=global;const clone=x=>JSON.parse(JSON.stringify(x));let original={schemaVersion:4,storeRevision:0,sessions:[],masks:[],presets:[],worldbooks:[],cssPresets:[],regexPacks:[],novelProjects:[],themeSettings:{theme:'default'}};
 global.MimaLocalStore={loadState:async()=>clone(original),saveState:async(s,rev)=>{assert.equal(rev,original.storeRevision,'canonical CAS');original={...clone(s),storeRevision:rev+1};return clone(original)}};
 const memories=['theme-engine.js','regex-engine.js','persona-macro-resolver.js','user-input-semantic-parser.js','novel-memory.js','novel-engine.js','novel-prompt-assembler.js','standalone-core.js'];for(const m of memories)require('../'+m);
 await MimaStandalone.init();const route=(path,method='GET',body=null)=>MimaStandalone.handle(path,method,body);
 const session=(await route('/sessions','POST',{title:'测试存档',manualMemory:{core:{content:'不可丢失'}}})).data;
 const existing=(await route('/presets','POST',{name:'既有预设',content:'别删掉'})).data;
 const mask=png.toMask(report.card,'character','role.png','');const savedMask=await route('/masks','POST',mask);assert(savedMask.success);
 const savedBook=await route('/worldbooks','POST',wb.payload);assert(savedBook.success);
 const savedPrompt=await route('/presets','POST',got.find(x=>x.kind==='preset').payload);assert(savedPrompt.success);
 const savedCss=await route('/css-presets','POST',got.find(x=>x.kind==='css').payload);assert(savedCss.success);
 const patch=await route(`/sessions/${session.id}`,'PATCH',{loadedCharMaskId:savedMask.data.id,worldbookIds:[savedBook.data.id],presetIds:[existing.id,savedPrompt.data.id],customCssId:savedCss.data.id,customCssEnabled:true});
 assert(patch.success,JSON.stringify(patch));assert.equal(patch.data.loadedCharMaskId,savedMask.data.id);assert.deepEqual(patch.data.worldbookIds,[savedBook.data.id]);
 assert.deepEqual(patch.data.presetIds,[existing.id,savedPrompt.data.id]);assert.equal(patch.data.customCssId,savedCss.data.id);
 assert.equal(original.presets.find(p=>p.id===existing.id).content,'别删掉');
 assert.equal(original.masks.length,1);assert.equal(original.worldbooks[0].entries.length,2);
 assert.equal(original.themeSettings.theme,'default','PNG assets must not change global theme');
 console.log('PASS v1.4.0 PNG read-only full metadata, V3 precedence, CSS/preset/worldbook extraction, incompatible script isolation, loss guard, tamper refusal');
})().catch(e=>{console.error(e);process.exitCode=1});
