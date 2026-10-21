import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256(x) { return crypto.createHash('sha256').update(x).digest('hex'); }
export function licenseViewer(license, policy) {
  const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const name = esc(policy.name);
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>版权与许可 · MimaTAVERN v${esc(policy.version)}</title><style>html{background:#f6f2eb;color:#2c2520;font:16px/1.7 system-ui,sans-serif}body{max-width:940px;margin:auto;padding:1rem 1.2rem 3rem}h1{font-size:1.4rem}p{line-height:1.7}.license-text{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace;font-size:.84rem;line-height:1.65;padding:1.1rem;background:#fff;border:1px solid #decfbc;border-radius:12px}a{color:#784a35}small{color:#685d54}</style></head><body><h1>咪嘛馆 · 版权与许可</h1><p>仅限 18 岁及以上成年人。项目属于限制性源码可见软件，并非 OSI 开源；第三方材料遵循其原有许可。运行结果由用户输入和所选模型提供，制作者在法律允许范围内不对用户/模型内容承担自动生成所当然引起的责任。</p><p><a href="./LICENSE">查看官方原文 LICENSE</a> · <a href="./SECURITY-AND-LICENSES.md">安全与第三方授权</a> · <a href="./README.md">使用及扩展说明</a></p><p><small>本页面由根目录 LICENSE 自动生成并在发行前逐字验真。许可证版本 ${esc(policy.version)}；SHA256 ${esc(policy.sha256)}。若本页与 LICENSE 不同，LICENSE 优先。</small></p><h2>${name} v${esc(policy.version)}</h2><pre id="mima-license-full-text" class="license-text">${esc(license)}</pre></body></html>\n`;
}
function assert(ok, message) { if (!ok) throw new Error('LICENSE_GUARD: '+message); }
export function verifyRelease(root, get=null) {
  const read = p => get ? get(p) : fs.readFileSync(path.join(root,p));
  const has = p => { try {return read(p);} catch {throw new Error('LICENSE_GUARD: missing '+p);} };
  const license = has('LICENSE');
  const policy = JSON.parse(has('license-policy.json').toString('utf8'));
  const str = license.toString('utf8');
  assert(policy.version === '1.0' && policy.licensor === 'mimasama6666-create' && policy.canonical_file==='LICENSE','wrong pinned policy version/owner');
  assert(str.startsWith('MimaTAVERN Personal Use and Independent Extensions License v1.0\n'),'unexpected canonical heading');
  assert(str.includes('Copyright © 2026 mimasama6666-create') && str.includes('All Rights Reserved, except as expressly licensed.'),'missing ownership notice');
  assert(sha256(license)===policy.sha256,'LICENSE changed without explicit version/changelog/hash authorization');
  assert(!str.includes('\r'),'canonical LICENSE line endings changed');
  const changelog=has(policy.changelog_file).toString('utf8');
  assert(changelog.includes('v'+policy.version+' — '+policy.effective_date) && changelog.includes(policy.sha256) && changelog.includes('mimasama6666-create'),'missing license provenance record');
  const readme=has('README.md').toString('utf8');
  const s='<!-- MIMA-LICENSE-SUMMARY-BEGIN -->\n', e='\n<!-- MIMA-LICENSE-SUMMARY-END -->';
  assert(readme.includes(s+policy.summary_zh+e),'README summary contradicts/omits canonical approved policy summary');
  assert(readme.includes('[LICENSE](./LICENSE)') && readme.includes('独立') && readme.includes('18 岁'),'README notice incomplete');
  assert(has('license-view.html').toString('utf8')===licenseViewer(str,policy),'online/offline viewer differs from canonical LICENSE');
  const html=has('index.html').toString('utf8');
  assert(html.includes('id="mima-license-dialog"') && html.includes('src="./license-view.html"') && html.includes('id="mima-license-open"') && html.includes('openMimaLicenseDialog()'),'in-app license entry missing');
  assert(has('SECURITY-AND-LICENSES.md').length>100,'security/third-party explanation missing');
  for(const [p, expected] of Object.entries(policy.third_party_sha256 || {})) assert(sha256(has(p))===expected,'third-party notice changed or removed: '+p);
  assert(Object.keys(policy.third_party_sha256||{}).length===7,'third-party notices not fully pinned');
  const entryList=JSON.parse(has('scripts/release-files.json').toString('utf8'));
  assert(Array.isArray(entryList) && new Set(entryList).size===entryList.length && entryList.includes('LICENSE') && entryList.includes('license-view.html') && entryList.includes('README.md'),'invalid release inventory');
  for(const p of entryList) { assert(!path.isAbsolute(p)&&!p.startsWith('.')||p.startsWith('.github/'),'unsafe inventory path'); assert(!p.includes('..') && !p.includes('\\') && !p.startsWith('/'),'unsafe path '+p); has(p); }
  assert(entryList.includes('.github/workflows/license-integrity.yml') && entryList.includes('scripts/package-release.mjs') && entryList.includes('scripts/verify-license.mjs') && entryList.includes('scripts/verify-release-archive.mjs'),'release guard not retained');
  if (!get) {
    const walk=(dir='')=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>{
      const n=dir?dir+'/'+e.name:e.name;
      if(e.isDirectory() && ['.git','node_modules'].includes(e.name))return [];
      if(e.isSymbolicLink())throw new Error('LICENSE_GUARD: symlink not allowed: '+n);
      return e.isDirectory()?walk(n):[n];
    });
    const unexpected=walk().filter(p=>!entryList.includes(p)&&!p.endsWith('.zip')&&!p.startsWith('MimaTAVERN-'));
    assert(!unexpected.length,'unlisted release files: '+unexpected.join(', '));
  }
  const workflow=has('.github/workflows/license-integrity.yml').toString('utf8');
  assert(workflow.includes('node scripts/verify-license.mjs') && workflow.includes('node scripts/package-release.mjs'),'CI guard disabled');
  return {ok:true,version:policy.version,sha256:policy.sha256,file_count:entryList.length};
}
