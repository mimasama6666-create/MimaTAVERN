'use strict';
// The same PNG -> source SHA -> session -> mocked model -> settlement pipeline
// on a browser-like runtime without SubtleCrypto. No hash bypass allowed.
const assert=require('node:assert/strict');const crypto=require('node:crypto');
const sha=require('../sha256-browser.js');global.MimaSHA256=sha;
for(const length of [0,1,3,55,56,63,64,65,127,128,1023,65536,1024*1024]){
 const input=crypto.randomBytes(length);assert.equal(sha.digest(new Uint8Array(input)),crypto.createHash('sha256').update(input).digest('hex'));
}
Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true,writable:true});
assert.equal(globalThis.crypto,undefined);
require('./smoke-r11-compat-png-transaction.js');
