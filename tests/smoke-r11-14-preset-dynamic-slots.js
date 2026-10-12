'use strict';
const assert=require('node:assert/strict');
const rt=require('../compat-runtime.js');
const base='sha256:'+'a'.repeat(64),external='sha256:'+'b'.repeat(64);
const card={id:'card',kind:'character',sourceId:base,raw:{
 name:'Aster',description:'DESCRIPTION_MARKER',personality:'PERSONALITY_MARKER',scenario:'SCENARIO_MARKER',
 mes_example:'EXAMPLES_MARKER',system_prompt:'SYSTEM_MARKER',first_mes:'Hi'}};
const wb={id:'wb',kind:'world_info',sourceId:base,raw:{entries:[
 {uid:1,constant:true,position:0,insertion_order:100,content:'LORE_BEFORE_MARKER'},
 {uid:2,constant:true,position:1,insertion_order:100,content:'LORE_AFTER_MARKER'}]}};
const identifiers=['main','worldInfoBefore','charDescription','charPersonality','scenario','worldInfoAfter','dialogueExamples','personaDescription','chatHistory','jailbreak'];
const preset={id:'p',kind:'prompt_presets',sourceId:external,path:'external-st-preset',raw:{
 prompts:[{identifier:'main',content:'MAIN_MARKER',role:'system'},{identifier:'jailbreak',content:'TAIL_MARKER',role:'user'}],
 prompt_order:[{character_id:100000,order:identifiers.map(identifier=>({identifier,enabled:true}))}]}};
const session={id:'story1',sourceId:base,userName:'Traveler',worldInfoScanDepth:2,
 personaDescription:'PLAYER_PERSONA_MARKER',mountGraph:[{enabled:true,resourceId:'p',sourceId:external,kind:'prompt_presets',trustedCreativeRole:true}]};
const history=[{role:'user',canonicalContent:'QUESTION_MARKER',status:'committed'},
 {role:'assistant',canonicalContent:'ANSWER_MARKER',status:'committed'}];
const resources=[card,wb,preset];const input='LATEST_MARKER';
const old=rt.createEnvelope(session,resources,history,input);
assert(old.gaps.some(x=>x.reason==='chat_history_order_requires_opt_in'));
assert(old.messages.some(m=>m.cardResourceProjection&&m.content.includes('DESCRIPTION_MARKER')));
const out=rt.createEnvelope({...session,experimentalChatHistorySlot:true},resources,history,input);
const seq=out.messages.map(m=>m.content).join('\n');
for(const marker of ['MAIN_MARKER','LORE_BEFORE_MARKER','DESCRIPTION_MARKER','PERSONALITY_MARKER',
 'SCENARIO_MARKER','LORE_AFTER_MARKER','EXAMPLES_MARKER','PLAYER_PERSONA_MARKER','QUESTION_MARKER','ANSWER_MARKER','LATEST_MARKER','TAIL_MARKER','SYSTEM_MARKER']){
 assert.equal(seq.split(marker).length-1,1,marker+' not exactly once');
}
const at=s=>out.messages.findIndex(m=>m.content.includes(s));
for(const [a,b] of [['MAIN_MARKER','LORE_BEFORE_MARKER'],['LORE_BEFORE_MARKER','DESCRIPTION_MARKER'],
 ['DESCRIPTION_MARKER','PERSONALITY_MARKER'],['PERSONALITY_MARKER','SCENARIO_MARKER'],
 ['SCENARIO_MARKER','LORE_AFTER_MARKER'],['LORE_AFTER_MARKER','EXAMPLES_MARKER'],
 ['EXAMPLES_MARKER','PLAYER_PERSONA_MARKER'],['PLAYER_PERSONA_MARKER','QUESTION_MARKER'],
 ['QUESTION_MARKER','ANSWER_MARKER'],['ANSWER_MARKER','LATEST_MARKER'],['LATEST_MARKER','TAIL_MARKER']])
 assert(at(a)<at(b),a+' before '+b);
assert(out.messages.filter(m=>m.cardResourceProjection).every(m=>m.role==='user'));
assert.equal(out.messages[at('MAIN_MARKER')].role,'system');
assert.equal(out.messages[at('TAIL_MARKER')].role,'user');
assert.deepEqual(out.historyMessageIndices.map(i=>out.messages[i].content),['QUESTION_MARKER','ANSWER_MARKER']);
assert(out.gaps.some(x=>x.reason==='LOCAL_PRESET_DYNAMIC_SLOTS_NOT_ST_GOLDEN_EQUIVALENT'));
assert(out.messages[at('SYSTEM_MARKER')].presetDynamicMarker==='unreferenced');
assert.equal(history[0].canonicalContent,'QUESTION_MARKER');
assert.equal(card.raw.description,'DESCRIPTION_MARKER');
const untrusted=rt.createEnvelope({...session,experimentalChatHistorySlot:true,mountGraph:session.mountGraph.map(x=>({...x,trustedCreativeRole:false}))},resources,history,input);
assert(untrusted.messages[untrusted.messages.findIndex(m=>m.content.includes('MAIN_MARKER'))].role==='user','untrusted static prompt must remain user');
const noPersona=rt.createEnvelope({...session,personaDescription:'',experimentalChatHistorySlot:true},resources,history,input);
assert(noPersona.gaps.some(x=>x.reason==='persona_description_source_unavailable'));
assert(!noPersona.messages.some(m=>m.content.includes('PLAYER_PERSONA_MARKER')));
const disabled={...preset,raw:{...preset.raw,prompt_order:[{character_id:100000,order:identifiers.map(identifier=>({identifier,enabled:identifier!=='charDescription'}))}]}};
const without=rt.createEnvelope({...session,experimentalChatHistorySlot:true},[card,wb,disabled],history,input);
assert.equal(without.messages.map(m=>m.content).join('').split('DESCRIPTION_MARKER').length-1,1,'disabled marker must not delete canonical card description');
const withoutHistory={...preset,raw:{...preset.raw,prompt_order:[{character_id:100000,order:identifiers.filter(x=>x!=='chatHistory').map(identifier=>({identifier,enabled:true}))}]}};
const noChatSlot=rt.createEnvelope({...session,experimentalChatHistorySlot:true},[card,wb,withoutHistory],history,input);
assert(noChatSlot.messages.some(m=>m.content==='QUESTION_MARKER'));
assert(noChatSlot.gaps.some(x=>x.reason==='chat_history_marker_missing_appended_to_preserve_history'));
console.log('PASS R11.14 ST prompt dynamic slots: ordered activation, no duplicated/lost card/History, untrusted roles fenced, per-session persona, disabled markers and fallback');
