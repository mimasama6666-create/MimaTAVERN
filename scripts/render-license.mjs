// Maintainer-only generation of the exact static local viewer from the canonical LICENSE.
// This never updates license-policy.json or the authorized changelog/hash.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {licenseViewer} from './license-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p=JSON.parse(fs.readFileSync(path.join(root,'license-policy.json'),'utf8'));
const lic=fs.readFileSync(path.join(root,'LICENSE'),'utf8');
fs.writeFileSync(path.join(root,'license-view.html'),licenseViewer(lic,p),'utf8');
console.log('Viewer regenerated; now run verify-license.mjs (must match pinned LICENSE hash).');
