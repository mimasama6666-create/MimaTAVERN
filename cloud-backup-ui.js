/* Cloud settings card: attaches only when the Data Backup tab is opened. */
window.MimaCloudBackupUI=(()=>{'use strict';
 const api=window.MimaCloudBackup;let busy=false,lastStatus='尚未连接云端。只有主动点击按钮才会访问网络。',visibleSnapshots=[],visiblePending=[],visibleInvalid=[];
 const get=id=>document.getElementById('mima-cloud-'+id),value=id=>get(id)?.value?.trim()||'';
 const show=message=>{lastStatus=message;const n=get('status');if(n)n.textContent=message};
 function markup(){return `<section class="data-backup-card mima-cloud-backup" id="mima-cloud-card" aria-labelledby="mima-cloud-title">
 <div class="mima-cloud-head"><div><div class="row-title" id="mima-cloud-title">☁ 云端备份中心</div><p class="row-sub">你自己的云存储 · 端侧加密 · 完全手动 · 不影响本地备份</p></div><span class="mima-cloud-chip">独立功能</span></div>
 <div class="mima-cloud-fields"><label>云存储类型<select class="field" id="mima-cloud-type"><option value="hf">Hugging Face 私有 Dataset</option><option value="github">GitHub 私有备份仓库</option><option value="gateway">自建 HTTPS 网关 / R2</option></select></label>
 <label class="mima-cloud-wide">仓库或服务地址<input class="field" id="mima-cloud-address" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://huggingface.co/datasets/用户名/备份仓库"></label>
 <label class="mima-cloud-wide">云平台访问凭证<input class="field" id="mima-cloud-token" type="password" autocomplete="off" spellcheck="false" placeholder="仅在本页内存使用；不会写入存档"></label>
 <label class="mima-cloud-wide">备份加密口令<input class="field" id="mima-cloud-password" type="password" autocomplete="new-password" placeholder="换手机恢复时仍需此口令（至少 8 字符）"></label>
 <details class="mima-cloud-wide"><summary>首次建库确认口令与高级选项</summary><div class="mima-cloud-extra"><label>确认加密口令<input class="field" id="mima-cloud-confirm-password" type="password" autocomplete="new-password" placeholder="首次创建备份时务必填写"></label>
 <label class="check-row"><input id="mima-cloud-secrets" type="checkbox">连 API 密钥和自定义请求头也加入加密归档（默认不包含）</label><p class="helper">目前直接支持私有 HF Dataset、私有 GitHub 仓库和标准 HTTPS 网关。HF Bucket、R2、WebDAV、Supabase 可通过你部署的兼容网关使用；普通 Space / GitHub Pages / Netlify 静态链接不能作为存储仓库。云端账户凭证和加密口令是两样东西。</p></div></details></div>
 <div class="toolbar mima-cloud-actions"><button type="button" class="ghost-btn" id="mima-cloud-test">测试连接</button><button type="button" class="primary-btn" id="mima-cloud-start">立即加密备份整馆</button><button type="button" class="ghost-btn" id="mima-cloud-resume" hidden>继续未完成备份</button><button type="button" class="ghost-btn" id="mima-cloud-list">查看云端备份</button><button type="button" class="ghost-btn" id="mima-cloud-lock">检查删除独占锁</button><button type="button" class="ghost-btn" id="mima-cloud-stop" hidden>暂停（当前请求完成后）</button></div>
 <div class="mima-cloud-status" id="mima-cloud-status" role="status" aria-live="polite">尚未连接云端。</div><div id="mima-cloud-snapshots" class="mima-cloud-snapshots"></div>
 <p class="helper">完整整馆备份采用 V3 九项数据。云端只保存加密密文；备份中请暂停编辑剧情和导入字体。换设备时重新输入地址、云平台凭证和加密口令即可查看历史快照。忘记加密口令无法恢复。上传失败不会覆盖已完成备份。</p>
 </section>`}
 function setPlaceholder(){const n=get('address');if(!n)return;n.placeholder=value('type')==='github'?'https://github.com/用户名/mimatavern-backups':value('type')==='gateway'?'https://你的网关域名/mima-cloud/v1':'https://huggingface.co/datasets/用户名/私有仓库'}
 function input(){const config=window.MimaCloudTargets.parse(value('type'),value('address')),token=value('token'),password=get('password')?.value||'';if(!token)throw Error('请填写云平台访问凭证');if(!password)throw Error('请填写云端加密口令');return {config,token,password}}
 async function run(work,{skipToken=false}={}){
  if(busy)return;busy=true;for(const b of document.querySelectorAll('#mima-cloud-card button'))b.disabled=true;
  const stop=get('stop');if(stop){stop.hidden=false;stop.disabled=false}
  try{await work()}catch(e){show('未完成：'+(e?.message||'未知错误'))}finally{
   busy=false;const card=get('card');if(card)for(const b of card.querySelectorAll('button'))b.disabled=false;
   if(get('stop'))get('stop').hidden=true;
   await refreshResume().catch(()=>{});
  }
 }
 async function persist(config){await api.configure(config)}
 async function refreshResume(){const node=get('resume');if(!node)return;
  try{const raw=value('address');if(!raw){node.hidden=true;return}const config=window.MimaCloudTargets.parse(value('type'),raw),job=await api.unfinished(config);node.hidden=!job;
   if(job)node.textContent='继续未完成备份（'+(job.confirmed?.length||0)+' 卷已验证）';
  }catch(_){node.hidden=true}
 }
 async function test(){let cfg;try{cfg=input()}catch(e){show(e.message);return}
  await run(async()=>{await persist(cfg.config);show('正在测试云端连接…');await api.testConnection({...cfg,onProgress:show});show('连接测试通过：可写、可读回并已清理测试文件。')})}
 async function start(resume=false,resumeSnapshotId=null){let cfg;try{cfg=input()}catch(e){show(e.message);return}
  const oldJobs=await api.unfinishedJobs(cfg.config),job=resume?(resumeSnapshotId?oldJobs.find(j=>j.snapshotId===resumeSnapshotId):oldJobs[0]):null;
  if(resume&&!job){show('没有对应的本地续传记录；可以在列表里清理远端残卷');return}
  let preservePrevious=false;
  if(!resume&&oldJobs.length){
   const choice=window.prompt('已有 '+oldJobs.length+' 个未完成云备份。输入 1 继续最近的任务、2 保留旧任务并创建新备份、3 查看云端残卷清理、0 取消：','1');
   if(choice==='1'){return start(true,oldJobs[0].snapshotId)}
   if(choice==='3'){show('请点击「查看云端备份」，在未完成对象下选择精确清理；旧进度不会自动丢失');return}
   if(choice!=='2')return;preservePrevious=true;
  }
  const includeApiKey=resume?job.includeApiKey:!!get('secrets')?.checked;
  if(includeApiKey&&!window.confirm('本次加密归档会包含剧情、小手机接口密钥和请求头，确认仍然包含？'))return;
  if(!resume&&!window.confirm('这将手动加密并上传完整 V3 九项数据，旧快照不变。备份期间请暂停编辑。继续？'))return;
  await run(async()=>{
   await persist(cfg.config);
   if(!resume&&await api.needsPasswordConfirmation(cfg)){
    if((get('confirm-password')?.value||'')!==cfg.password)throw Error('首次建立云端加密仓库需要展开高级选项，输入相同的确认口令');
   }
   show('正在建立安全连接并核对 V3 快照…');const result=await api.backup({...cfg,resume,resumeSnapshotId:job?.snapshotId||null,preservePrevious,includeApiKey,onProgress:show});
   show('✅ 云端整馆备份成功：'+result.volumes.length+' 卷已上传并读回；快照 '+result.snapshotId.slice(0,8));
  });
 }
 function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n}
 async function fetchSnapshots(){let cfg;try{cfg=input()}catch(e){show(e.message);return}
  await run(async()=>{await persist(cfg.config);show('正在读取云端已发布快照，验证加密完成标志…');const result=await api.list({...cfg,onProgress:show});const jobs=await api.unfinishedJobs(cfg.config);
   const local=jobs.filter(j=>!result.pending.some(p=>p.snapshotId===j.snapshotId)&&!result.snapshots.some(p=>p.snapshotId===j.snapshotId)).map(j=>({snapshotId:j.snapshotId,state:'local-only',objects:0}));
   visibleSnapshots=result.snapshots;visiblePending=[...result.pending,...local];visibleInvalid=result.invalid||[];paintSnapshots(result.snapshots,result.issues,visiblePending,visibleInvalid)})
 }
 function paintSnapshots(snapshots,issues=[],pending=[],invalid=[]){const area=get('snapshots');if(!area)return;area.replaceChildren();
  if(!snapshots.length&&!pending.length&&!invalid.length)area.append(el('p','该仓库还没有已发布的备份或可管理的残卷。','helper'));
  if(snapshots.length)area.append(el('div','云端完整快照（恢复前仍会逐卷校验）','row-title'));
  for(const item of snapshots){const card=el('div',undefined,'mima-cloud-snapshot');
   card.append(el('strong',new Date(item.createdAt).toLocaleString('zh-CN')));
   card.append(el('span','V3 整馆 · '+item.volumes.length+' 卷 · '+(item.credentialsIncluded?'含接口凭证':'不含接口凭证')+' · '+item.snapshotId.slice(0,8),'row-sub'));
   const buttons=el('div',undefined,'toolbar');
   const restore=el('button','预检并恢复','primary-btn'),copy=el('button','复制恢复说明','ghost-btn'),remove=el('button','删除此云端快照','ghost-btn');
   for(const b of [restore,copy,remove]){b.type='button';buttons.append(b)}
   restore.onclick=()=>restoreSnapshot(item);copy.onclick=()=>copyInstructions(item);remove.onclick=()=>deleteSnapshot(item);
   card.append(buttons);area.append(card);
  }
  if(pending.length)area.append(el('div','未完成或删除中（可跨设备发现、继续清理）','row-title'));
  for(const item of pending){const card=el('div',undefined,'mima-cloud-snapshot');
   card.append(el('strong',item.state==='deleting'?'删除尚未完成':item.state==='local-only'?'本机保留的未完成任务':'未发布的备份残卷'));
   card.append(el('span','快照 '+item.snapshotId.slice(0,8)+' · 当前 '+item.objects+' 个远端对象','row-sub'));
   const buttons=el('div',undefined,'toolbar'),remove=el('button',item.state==='deleting'?'继续清理残卷':item.state==='local-only'?'放弃本机任务（确认远端为空）':'清理未完成残卷','ghost-btn');
   remove.type='button';remove.onclick=()=>deleteSnapshot(item);buttons.append(remove);
   if(item.state==='unfinished'||item.state==='local-only'){
    const continueButton=el('button','从本机记录继续（若有）','ghost-btn');continueButton.type='button';
    continueButton.onclick=()=>void start(true,item.snapshotId);buttons.append(continueButton);
   }
   card.append(buttons);area.append(card);
  }
  if(invalid.length)area.append(el('div','异常完成标志（不是可恢复的备份）','row-title'));
  for(const item of invalid){const card=el('div',undefined,'mima-cloud-snapshot');
   card.append(el('strong','损坏或不可认证的快照 · '+item.snapshotId.slice(0,8)));
   card.append(el('span','快照 ID '+item.snapshotId+' · '+item.reason,'row-sub'));
   const btn=el('button','确认后清理这一项异常对象','ghost-btn');btn.type='button';btn.onclick=()=>void deleteSnapshot(item);card.append(btn);area.append(card);
  }
  if(issues.length>invalid.length)area.append(el('p','另有 '+(issues.length-invalid.length)+' 项删除标志异常，请先核对，系统不会自动删除。','helper'));
 }
 async function restoreSnapshot(item){let cfg;try{cfg=input()}catch(e){show(e.message);return}
  if(!window.confirm('准备从云端下载并预检 '+item.volumes.length+' 卷。此阶段只暂存，不会覆盖正式数据。继续？'))return;
  await run(async()=>{show('正在安全下载和逐卷解密…');const {receipt}=await api.prepareRestore({...cfg,id:item.snapshotId,onProgress:show});
   if(receipt.previousCompletedAt)show('已核对当前云端归档与本地数据，旧完成记录已保全，当前为独立的新补充恢复轮次');
   const summary='九项资料已完整预检，恢复只合并本机缺失资料，遇冲突会停止，不强制覆盖。\n归档时间：'+new Date(item.createdAt).toLocaleString('zh-CN')+'\n恢复序号：'+receipt.id+'\n是否正式开始恢复？';
   if(!window.confirm(summary)){show('全卷预检通过，尚未写入业务数据库。可稍后重新连接后恢复。');return}
   show('正式恢复中：按旧版 V3 事务逐库补充…');const result=await api.restore(receipt.id);
   show(result.status==='complete'?'✅ 九项资料已完成恢复，请刷新页面加载新资料。':'恢复已中断，保留真实阶段收据，可重新连接并继续。');
  })
 }
 async function deleteSnapshot(item){let cfg;try{cfg=input()}catch(e){show(e.message);return}
  if(!window.confirm((item.state==='invalid'?'这项云端完成标志不能认证，可能已经损坏。只清理指定快照文件，不把它当可恢复备份。':'删除云端快照不会删除 Git 仓库历史。')+' 确认申请删除 '+item.snapshotId.slice(0,8)+'？'))return;
  if(window.prompt('输入快照 ID 的最后 6 位确认删除该快照残卷或本机任务：')!==item.snapshotId.slice(-6))return;
  await run(async()=>{await api.removeSnapshot({...cfg,id:item.snapshotId,allowInvalid:item.state==='invalid',onProgress:show,confirmDelete:({kind,verifiedAlternatives})=>{
    const detail=kind==='complete'?'已逐卷读回验证其它 '+verifiedAlternatives+' 份完整可恢复备份。':kind==='invalid'?'目标属于异常完成标志，不视为可恢复备份。':kind==='deleting'?'此快照已有删除墓碑，继续先前的精确清理。':'目标尚未发布完成标志。';
    return window.confirm(detail+'\n持有云端删除独占权，现在才会真正清理这一份。继续吗？');
   }});const updated=await api.list({...cfg,onProgress:show});visibleSnapshots=updated.snapshots;visiblePending=updated.pending;visibleInvalid=updated.invalid||[];paintSnapshots(updated.snapshots,updated.issues,updated.pending,visibleInvalid);show('目标快照已删除并读回确认；其他旧备份未更改。')})
 }
 async function handleDeleteLock(){let cfg;try{cfg=input()}catch(e){show(e.message);return}
  await run(async()=>{show('正在读取云端仓库级删除独占权…');const owner=await api.deleteLockStatus(cfg);
   if(!owner){show('当前没有删除独占锁；其它设备可以正常申请删除。');return}
   const description='删除事务：'+owner.ownerId+'\n目标快照：'+owner.snapshotId+'\n创建时间：'+owner.createdAt;
   show('发现云端删除独占锁。\n'+description+'\n这是跨设备保护，不会自动过期。');
   if(!window.confirm('仅限上次删除已异常中断、并且所有其它设备和标签都已关闭时人工恢复。\n解除活动任务的锁会破坏并发删除保护！\n'+description+'\n确定进入人工解除步骤吗？'))return;
   if(window.prompt('请完整输入删除事务 ID，确认其它设备不再执行删除：')!==owner.ownerId){show('事务 ID 未匹配，锁已保留');return}
   if(!window.confirm('最后确认：已经停止所有设备的云端删除，解除这把旧锁？'))return;
   await api.clearAbandonedDeleteLock({...cfg,ownerId:owner.ownerId});show('旧删除独占锁已核对并由用户明确解除。请重新查看快照列表和待清理残卷。');
  });
 }
 async function copyInstructions(item){const config={type:value('type'),address:value('address')};const text=['咪嘛馆云端备份恢复说明 V1','服务类型：'+config.type,'仓库地址：'+config.address,'快照编号：'+item.snapshotId,'归档时间：'+item.createdAt,'格式：加密 Cloud V1 + 明文 V3（仅解密后）','恢复：打开咪嘛馆 → 设置 → 数据备份 → 云端备份中心 → 输入地址、云账号凭证和加密口令 → 查看云端备份 → 预检并恢复。','注意：本说明不包含云账号访问凭证或加密口令；请自行妥善保管。'].join('\n');
  try{await navigator.clipboard.writeText(text);show('恢复说明已复制；不包含口令与访问凭证。')}catch(_){show('浏览器阻止复制。请使用允许剪贴板访问的 HTTPS 页面。')}
 }
 async function mount(){const card=get('card');if(!card)return;show(lastStatus);get('type').addEventListener('change',()=>{setPlaceholder();void refreshResume()});
  get('address').addEventListener('change',()=>void refreshResume());get('test').onclick=()=>void test();get('start').onclick=()=>void start();get('resume').onclick=()=>void start(true);
  get('list').onclick=()=>void fetchSnapshots();get('lock').onclick=()=>void handleDeleteLock();get('stop').onclick=()=>{if(api.cancel())show('已请求暂停；当前云端读写结束后停止，不能把尚未完成当成成功')};
  const config=await api.savedConfig();if(!get('card')||!card.isConnected)return;
  if(config){get('type').value=config.type;get('address').value=config.address;await refreshResume()}setPlaceholder();
 }
 return Object.freeze({markup,mount});
})();
