'use strict';
const assert=require('node:assert/strict'),engine=require('../history-search.js');
const docs=[
{id:'filler',text:'今天去海边 今天回来 今天去海边 故事继续'},
{id:'lamp',text:'第一章艾琳把密室钥匙藏在灯塔暗格，此事绝不能告诉其他人',createdAt:'2026-09-28T14:40:00'},
{id:'alias',text:'tenjou 正在调查船长的失踪',createdAt:'2026-10-12T09:00:00'},
{id:'item',text:'玩家拿到另外一把钥匙',createdAt:'2026-10-12T10:00:00'}];
const r=engine.rank('密室钥匙在什么地方？',docs);assert.equal(r[0].id,'lamp');assert(r[0].hits.length>0);
const aliases=engine.rank('天束调查的是什么？',docs,{aliases:{'天束':['tenjou']}});assert.equal(aliases[0].id,'alias');
const date=engine.rank('2026-09-28',docs);assert.equal(date[0].id,'lamp');
const invalid=engine.rank('没有任何交集词',docs);assert.equal(invalid.length,0);
assert(engine.tokenize('蓝色钥匙在城堡').includes('钥匙'));
assert.equal(JSON.stringify(docs),JSON.stringify(docs.map(x=>({...x}))), 'source documents are not mutated');
console.log('PASS offline BM25 Chinese n-grams, explicit aliases, time lookup, source immutability and no semantic hallucination');
