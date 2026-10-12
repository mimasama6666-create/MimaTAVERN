# 咪嘛馆 R10｜增量续修与独立验收报告

日期：2026-10-12。性质：隔离源码施工、模拟 Provider/IndexedDB 回放与离线静态验收。状态：**NO-GO**，不建议覆盖唯一生产环境。

## 一、唯一母体与蓝图

- 已完整读取最新《咪嘛馆_R10_记忆根因审计及R1-R5续修施工蓝图_20261012.md》和 R10 交接包的 9 项材料、R9 根因报告、R9 只读验收报告。
- 唯一母体：《咪嘛馆_R1-R5_第九轮精准续修_唯一完整源码包_20261012.zip》，SHA256：`4afb40c9096a277104a0d9a9dc065c7b4523b10049e2d44f0c516557e321fe9b`。字节检验一致。只在隔离目录施工，未访问或覆盖用户真实 IndexedDB。
- 变更文件仅 `standalone-core.js`、`app.js`、`compat-ui.js`、`index.html`、`WINDOWS-README.md` 五个旧文件；新增 R10 4 项 Smoke，保留其余 R9 源码、原始 History/Persona/世界书、原生小说、兼容引擎、手机路由及旧接口。

## 二、首个非法状态与实际修复

R9 的 `sourceEventLedger` 用整个摘要的 n-gram 重叠和全局行为/情态标志，把甲方事件与乙方事件识别为都已覆盖。缺失事件由 `validateMemoryCandidate -> validateRollingCoverage` 错误放行，最终在真实原始来源仍存在的情况下推进 `lastSummarizedIndex`。`commitMemoryJob` 的 CAS 本身没有错误，不能靠修改事务做伪修复。

R10 改为逐条原始 message/event offset 的 **局部候选主张验证**：独立句子和短关键台词成为独立来源单元；相似不同事件提取区分片段（地点/对象），不能靠同一处共有词替代；局部核查行为、否定、传闻、条件/梦境；同句多轮发生必须显式表达真实次数，序号连续且数目明确时保留忠实的时间跨度压缩；额外编造受害者不能靠原主客体词重合过关。每个单元附 `messageId`、`eventId`、`offset`、source fingerprint 和 missing/covered，最终结算与 R9 source-prefix fencing、单一持久化权威完全沿用。

对中文代词指代、同义词、反讽及多层复合叙事，规则仍是**保守边界检验**，不是完整中文语义等价证明。可疑记忆进入 durable `needs_review`，不能声称对所有新剧情完全无误。

R10 P0 正反配对：42 条 History，24 条交替甲乙，Provider 仅输出甲方：现已 `E_MEMORY_NEEDS_REVIEW`、游标 0、原文 42 条保留、missingCount>0；正常 24 天信件压缩 35 字仍 **committed**，游标 24，原文保留。补测同地点差异、单句第二事件遗漏、重复行为次数、短同意、编造新增受害者均正确拒绝；明确次数的重复事件可压缩通过。

## 三、P1、界面与兼容更新

- 后台 `queueRollingSummary`、启动恢复尊重已有 `summaryTriggerMessages`（12–200，默认 28）：新旧来源未覆盖条数达到阈值才自动调度；手动滚动摘要保持旧合同，Direct Reply 不等待后台记忆。新增 2 轮对照复现：未满 28 不触发、达到 28 恰好发起 1 次后台请求；即使待审也不清空原 History。
- `generateFactMemories` 首轮事实的 source scope 纳入角色 opening。此前 opening 在模型材料中，却不在 canonical 验收消息范围；现独立测试先红后绿通过。超长单轮 >28k 字每片精确来源范围仍属未闭环风险，未冒称修完。
- 注入旧 core/facts 时保留所有原文，标识 `human_confirmed` / `extractive_verified` / `source_bounded` / `legacy_unverified` 的可信程度，旧无 fingerprint 记忆不能再以标题冒充“已经验证的事实”；原手动确认内容保留。无凭据的事实仍不得自动升为核心。
- `app.js` 新增“累计多少条旧剧情后自动整理”设置；读取持久化任务后在剧情顶部显示“待核对”并可直达记忆页面。状态读取失败会提醒，不把失败当无债务。异步读取不阻塞聊天。
- `compat-ui.js` + `index.html` 初次发送前可明确选择“基础聊天 / 严格检查高级规则”：发送前调用只读 preview，列出已知语义差异；严格模式遇差异拦截，基础模式需确认才调用 Provider，并在差异变化时重新确认。未授权脚本仍不自动执行；**尚未完成真实浏览器点击、iframe 演出与官方 ST golden 对照**。
- `WINDOWS-README.md` 更正 fullCommitSha=null 的过期说明；实际 `upstream-lock.json` 已包含完整 40 位 SHA。仅完成文档/源码对齐，Windows 安装未实测，未从远端核实 SHA 指向。

## 四、验收数字与残余冲突

- 本轮 51 个 `tests/smoke-*.js`：**42 PASS / 9 FAIL / 0 SKIP**。与 R9 独立 47 项原始 `38 PASS / 7 FAIL / 2 SKIP` 的统计不同，本轮注入真实私有 PNG 路径，两个过去 SKIP 的测试可实际运行并通过；私人 PNG 字节**没有进入源码/证据 ZIP**。其余新增 4 项 R10 Smoke（含配对测试）均 PASS。
- 全库 JS 85/85 `node --check` PASS；index.html 27 个静态资源引用均存在，重复 ID 为 0；Git diff --check PASS；从原始 R9 母体执行 patch dry-run PASS。尚未实测浏览器 JS 路由与原生 UI 点击流。
- 既有 7 项失败保留原断言，分别为 `smoke-compat-r1-r5` 世界书信任边界/消息位置，以及 6 项旧记忆语义与人工审核状态期待冲突，详见原始逐项日志。
- **新增的 2 项失败**：`smoke-eighth-root-closure` 与 `smoke-eighth-multi-part` 旧合同允许同一段情节原句重复多轮，却由只出现一次的文本直接覆盖所有轮；R10 安全要求必须明确重复次数/跨度，所以不再允许无数字同句自动结算。并非语法失败，也不能修改旧断言粉饰。因此历史成功数有两项真实退化/合同冲突，Gate 5 尚未闭环。
- **未完成**：needs_review 造成后台长期债务的独立安全续跑；超长事实 (>28k) 精确分片来源 scope；50/200/500 轮真实 Prompt 黄金剧情与复杂语义；官方 SillyTavern 1.19.0 黄金对照、R3 动态 MVU/状态栏、多种插件 API L4；真正 Provider/Windows/iOS/Android 实机；浏览器双标签与实际 IndexedDB 压力；真实第三方脚本执行、网络异常的完整用户可见效果。

## 五、回归风险与负优化反查

没有减少 History、Persona、世界书预算，也没有禁用后台服务。代码变更未触及 `local-store.js`、`novel-memory.js`、兼容底层 Store/沙箱、主题 CSS 和原生历史版本结构。对第五轮及以往记忆旧语义造成的 2 项冲突不得宣称无负优化；不把模拟通过等同用户实机体验。对失败/未知来源坚持 fail-closed：不更新游标、不注入假事实、不覆盖 IndexedDB。

## 六、交付与回滚

- 唯一 R10 完整**无私人数据**源码包，包含所有 R9 原始源码和本轮测试/报告。
- R9→R10 精确 patch；一并提供完整逐项日志、R10 蓝图原件与红灯复现记录、SHA256 校验单。
- 原 R9 ZIP 原字节回滚路径单独提供。源码回滚不自动恢复浏览器用户数据；安装前先独立导出原生与兼容库和手工备份，不能用测试空库覆盖真实 Store。

**总判定：NO-GO。** 本轮仅已证实 P0 特定反例、正常压缩、自动触发、开场来源及特定兼容 UI 前置源码改动；大规模实机和官方语义等价未完成，禁止宣称全部 R1–R5 与记忆已“彻底修好”。
