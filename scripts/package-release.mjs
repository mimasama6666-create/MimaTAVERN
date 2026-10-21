// Zero-dependency official production ZIP packager. Fails closed before producing an archive.
// Usage: node scripts/package-release.mjs [../MimaTAVERN-release.zip]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {verifyRelease} from './license-contract.mjs';
import {inspectArchive} from './verify-release-archive.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(root,'MimaTAVERN-release.zip'));
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function buildZip(files) {
  const locals=[], centrals=[];let cursor=0;
  for(const name of files){
    const data=fs.readFileSync(path.join(root,name));const encoded=Buffer.from(name,'utf8');
    const compressed=zlib.deflateRawSync(data,{level:9});const method=8;const crc=crc32(data);
    const hdr=Buffer.alloc(30);hdr.writeUInt32LE(0x04034b50,0);hdr.writeUInt16LE(20,4);hdr.writeUInt16LE(0x0800,6);hdr.writeUInt16LE(method,8);hdr.writeUInt32LE(crc,14);hdr.writeUInt32LE(compressed.length,18);hdr.writeUInt32LE(data.length,22);hdr.writeUInt16LE(encoded.length,26);
    locals.push(hdr,encoded,compressed);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(encoded.length,28);central.writeUInt32LE(cursor,42);
    centrals.push(central,encoded);cursor+=hdr.length+encoded.length+compressed.length;
  }
  const size=centrals.reduce((a,b)=>a+b.length,0);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(cursor,16);
  return Buffer.concat([...locals,...centrals,end]);
}
try {
  if (out===root) throw new Error('invalid output');
  const result=verifyRelease(root);
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'scripts/release-files.json'),'utf8'));
  // Only files in the pinned normal production inventory are packaged; audit/test/rollback files are excluded.
  const blob=buildZip(inventory);
  const written=inspectArchive(blob);
  if(written.size!==inventory.length||inventory.some(p=>!written.has(p)))throw new Error('ZIP incomplete');
  verifyRelease(root,p=>{if(!written.has(p))throw new Error('ZIP missing '+p);return written.get(p);});
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const temp=out+'.tmp-'+process.pid;
  try {fs.writeFileSync(temp,blob);fs.renameSync(temp,out);} catch(e){try{fs.rmSync(temp,{force:true});}catch{}throw e;}
  console.log('OFFICIAL PRODUCTION ZIP',out,'files',inventory.length,'licenseSHA256',result.sha256);
} catch(e) {console.error('RELEASE BLOCKED:',e.stack||e);process.exitCode=1;}
