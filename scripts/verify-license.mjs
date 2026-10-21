import path from 'node:path';
import {verifyRelease} from './license-contract.mjs';
try {
  const root=path.resolve(process.argv[2]||'.');
  const result=verifyRelease(root);
  console.log('LICENSE GUARD PASS',JSON.stringify(result));
} catch (error) {
  console.error(String(error.stack||error));
  process.exitCode=1;
}
