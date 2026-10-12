'use strict';
const assert=require('node:assert/strict');
const runtime=require('../compat-runtime.js');
const base='sha256:'+'a'.repeat(64),outside='sha256:'+'b'.repeat(64);
const character={id:'card',kind:'character',sourceId:base,raw:{name:'Aster',description:'A quiet wizard',first_mes:'Hello'}};
const external={id:'preset',kind:'prompt_presets',sourceId:outside,path:'root.preset',raw:{
 prompts:[{identifier:'lead',role:'system',content:'BEFORE_HISTORY_MARKER'},{identifier:'tail',role:'user',content:'AFTER_HISTORY_MARKER'}],
 prompt_order:[{character_id:100000,order:[{identifier:'lead',enabled:true},{identifier:'chatHistory',enabled:true},{identifier:'tail',enabled:true}]}]
}};
const history=[{role:'user',canonicalContent:'past question',status:'committed'},{role:'assistant',canonicalContent:'past answer',status:'committed'}];
const session={id:'s',sourceId:base,mountGraph:[{enabled:true,resourceId:'preset',sourceId:outside,kind:'prompt_presets',trustedCreativeRole:true}]};
const before=runtime.createEnvelope(session,[character,external],history,'latest question');
assert(before.gaps.some(g=>g.reason==='chat_history_order_requires_opt_in'));
assert(before.messages.findIndex(m=>m.content.includes('AFTER_HISTORY_MARKER'))<before.messages.findIndex(m=>m.content==='past question'),'default preserves old prompt structure');
const enabled=runtime.createEnvelope({...session,experimentalChatHistorySlot:true},[character,external],history,'latest question');
const find=s=>enabled.messages.findIndex(m=>m.content.includes(s));
assert(find('BEFORE_HISTORY_MARKER')<find('past question'));
assert(find('past question')<find('past answer'));
assert(find('past answer')<find('latest question'));
assert(find('latest question')<find('AFTER_HISTORY_MARKER'));
assert(enabled.messages.some(m=>m.role==='system'&&m.content.includes('BEFORE_HISTORY_MARKER')));
assert(enabled.messages.some(m=>m.role==='user'&&m.content.includes('AFTER_HISTORY_MARKER')));
assert(enabled.gaps.some(g=>g.reason==='LOCAL_CHAT_HISTORY_SLOT_NOT_ST_GOLDEN_EQUIVALENT'));
assert.equal(enabled.historyMessageIndices.length,history.length);
assert.deepEqual(enabled.historyMessageIndices.map(i=>enabled.messages[i].content),['past question','past answer']);
assert.equal(history[0].canonicalContent,'past question');
const onlyMarker={...external,raw:{prompts:[],prompt_order:[{character_id:100000,order:[{identifier:'chatHistory',enabled:true}]}]}};
const a=runtime.createEnvelope({...session,experimentalChatHistorySlot:true},[character,onlyMarker],history,'latest question');
assert(a.messages.some(m=>m.content==='latest question'));
console.log('PASS opt-in external ChatHistory marker ordering, no provenance mutation, default preserved');
