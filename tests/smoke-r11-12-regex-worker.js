'use strict';
const assert=require('node:assert/strict');const iso=require('../compat-regex-isolation.js');
(async()=>{
 const common={placement:[2],findRegex:'/(A)(B)/g',replaceString:'{{match}} + $1 + $2',trimStrings:['A']};
 let out=await iso.apply('AB AB',[common],2);
 assert.equal(out.output,'B +  + B B +  + B');
 const names={placement:[1],findRegex:'/Hello {{char}}/g',replaceString:'欢迎',substituteRegex:2};
 out=await iso.apply('Hello A+B and Hello A+B',[names],1,{macroContext:{char:'A+B',user:'Player'}});
 assert.equal(out.output,'欢迎 and 欢迎','escaped char regex macro');
 await assert.rejects(()=>iso.apply('x',[{...names,findRegex:'{{unknown}}'}],1,{macroContext:{char:'A',user:'B'}}),/不支持的正则宏/);
 out=await iso.apply('hello',[{placement:[2],findRegex:'/hello/',replaceString:'{{match}}',trimStrings:[]}],2);
 assert.equal(out.output,'hello');
 out=await iso.apply('abc',[{placement:[2],findRegex:'/abc/',replaceString:'<$0>'}],2);
 assert.equal(out.output,'<abc>');
 out=await iso.apply('a-b',[{placement:[2],findRegex:'/(?<first>a)-(?<last>b)/',replaceString:'$<last>/$<first>'}],2);
 assert.equal(out.output,'b/a');
 console.log('PASS R11.12 regex worker: trim, capture, substitute raw/escaped, unsupported macro fail-close');
})().catch(e=>{console.error(e);process.exitCode=1});
