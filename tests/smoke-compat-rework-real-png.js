'use strict';
/* Requires an OWNER-SUPPLIED file path. No copyrighted/private card bundled into release. */
const fs=require('node:fs'),assert=require('node:assert/strict');global.window=global;
global.MimaPngCardImport=require('../png-card-import.js');const parser=require('../compat-import.js'),runtime=require('../compat-runtime.js');
(async()=>{const filename=process.env.MIMA_PRIVATE_PNG;if(!filename){console.log('SKIP private PNG golden input not provided');return;}
const card=await parser.inspectBytes(fs.readFileSync(filename),'private.png');assert(card.versions.includes('chara')&&card.versions.includes('ccv3'));
for(const r of card.resources.filter(x=>x.kind==='character')){
 const prefix=r.path.replace(/\.data$/,'');const resources=card.resources.filter(x=>x===r||x.kind==='world_info'&&x.path.startsWith(prefix));
 const run=text=>runtime.createEnvelope({userName:'测试玩家',worldInfoBudget:100000},resources,[],text,{skipRegex:true});
 const normal=run('你好'),trigger=run('我要偷看手机');
 assert.equal(normal.worldInfo.inserted.filter(x=>x.position===1).length,4);
 assert.equal(normal.worldInfo.inserted.filter(x=>x.position===4).length,0);
 assert.equal(trigger.worldInfo.inserted.length,5);
 assert.equal(trigger.worldInfo.inserted.filter(x=>x.position===4).length,1);
 assert.equal(trigger.messages.filter(x=>x.worldInfoEntryId).length,1);
 assert.equal(trigger.worldInfo.skipped.length,8);
 assert(!trigger.messages.some(x=>x.content.includes('E_RESOURCE_SEMANTIC_GAP')));
 console.log('PASS private PNG '+prefix+': constant=4, trigger=1, disabled/unmatched=8; ST golden oracle NOT RUN');
}
})().catch(e=>{console.error(e);process.exitCode=1;});
