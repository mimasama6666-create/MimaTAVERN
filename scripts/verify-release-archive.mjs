// Strict verification of the *finished* ZIP, not just its source directory.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {verifyRelease} from './license-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function inspectArchive(buf) {
  const eocd=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(eocd<0||eocd+22>buf.length)throw new Error('ZIP missing end record');
  const count=buf.readUInt16LE(eocd+10),total=buf.readUInt32LE(eocd+12),offset=buf.readUInt32LE(eocd+16);
  if(offset+total>eocd)throw new Error('ZIP central directory damaged');
  let cur=offset;const records=new Map();
  for(let i=0;i<count;i++){
    if(buf.readUInt32LE(cur)!==0x02014b50)throw new Error('ZIP central entry damaged');
    const flag=buf.readUInt16LE(cur+8),method=buf.readUInt16LE(cur+10),crc=buf.readUInt32LE(cur+16),size=buf.readUInt32LE(cur+20),rawSize=buf.readUInt32LE(cur+24),nlen=buf.readUInt16LE(cur+28),elen=buf.readUInt16LE(cur+30),clen=buf.readUInt16LE(cur+32),local=buf.readUInt32LE(cur+42);
    const name=buf.subarray(cur+46,cur+46+nlen).toString('utf8');
    if(!(flag&0x0800)||name.includes('..')||name.startsWith('/')||records.has(name))throw new Error('ZIP illegal path/flag/duplicate: '+name);
    if(![0,8].includes(method)||buf.readUInt32LE(local)!==0x04034b50)throw new Error('ZIP bad compression/header');
    const localNameLen=buf.readUInt16LE(local+26), localExtraLen=buf.readUInt16LE(local+28);
    const localName=buf.subarray(local+30,local+30+localNameLen).toString('utf8');
    if(localName!==name)throw new Error('ZIP local/central mismatch: '+name);
    const start=local+30+localNameLen+localExtraLen,compressed=buf.subarray(start,start+size);
    const data=method===8?zlib.inflateRawSync(compressed):compressed;
    if(data.length!==rawSize||crc32(data)!==crc)throw new Error('ZIP CRC mismatch: '+name);
    records.set(name,data);cur+=46+nlen+elen+clen;
  }
  if(cur!==offset+total)throw new Error('ZIP unexpected central tail');
  return records;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const archive=path.resolve(process.argv[2]||path.join(root,'MimaTAVERN-release.zip'));
  const records=inspectArchive(fs.readFileSync(archive));
  const inv=JSON.parse(fs.readFileSync(path.join(root,'scripts/release-files.json'),'utf8'));
  if(records.size!==inv.length||inv.some(name=>!records.has(name)))throw new Error('ZIP does not match approved full production inventory');
  const info=verifyRelease(root,p=>{if(!records.has(p))throw new Error('ZIP missing '+p);return records.get(p);});
  console.log('ZIP VERIFIED',records.size,'files',info.sha256);
 }catch(e){console.error('RELEASE ZIP REJECTED',e.stack||e);process.exitCode=1;}
}
