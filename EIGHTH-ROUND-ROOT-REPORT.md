# 咪嘛馆 R1–R5 第八轮根因返工与独立验收报告

日期：2026-10-12。母体：第七轮完整源码 ZIP，SHA256：`7c8f57d44a0d06361509c30fbc1de83466a04a56fa21f03732bf9dfd98efdc55`。
发布状态：**PARTIAL / NO-GO**。不是完整 R1–R5 兼容版，不建议覆盖唯一生产环境。

## 真实因果链

### P0 滚动最终合并遗漏事实却推进游标
`refreshSummary()` 的原逻辑只检查分片已收到、最终引文属于原始剧情，未检查最终 summary 是否保留全体待归档事件，却直接赋值 `lastSummarizedIndex=unsummarizedEnd` 并原子提交。独立复现中 60 条独立剧情、2 个分片、3 次 Provider mock 调用最终只保留第 0 条，错误推进 42 条。根因在“最终摘要的覆盖证明缺失”，不是 Provider 网络/超时。

修复：以 canonical 原始消息为证明对象，计算最终来源覆盖（messageId、index、来源指纹、匹配原文、遗漏列表），分片最终合并之后、事务提交之前再核验。少于等于 12 项遗漏时允许一次受限原文补录，必须经过原有记忆输出校验；其余转 `needs_review` 并保存精确遗漏 messageId、原文索引和待审候选；绝不移动游标，原 History、Persona、世界书均保留。审核页明确显示遗漏数及可展开的来源索引。人工明确确认整段结果后可以原子提交，局部接受不推进游标。

注意：完整来源逐字覆盖是一种**保守的充分条件**，不是证明模型已经理解全部事件的充分语义检验。该机制避免已知的错误全覆盖提交，但对忠实的自然意译仍可能过度进入审核，未声明解决全部语义覆盖。

### P1 已人工确认事实无法进入核心记忆
`memoryModel()` 给事实记录加入 `memory_source`，而 `validateMemoryCandidate()` 无条件拒绝该 role 的直接整句来源；即使人工已核对仍变为 `claim_not_whole_source_utterance`。修复后仅允许未过期、来源仍有效的 `human_confirmed` 和有原消息引用核验的 `extractive_verified` 作为核心记忆输入；`legacy_unverified`、stale、失配引用仍不可自动升级。保存的核心记忆由 `sourceFactsHash` 和完整快照事务冲突校验维持与事实基线的绑定。没有修改旧的原始剧情。

## 实测记录与真实限制

- 指定 `repro_missing_merge_coverage.js`：先前 FAIL → **PASS**，42 条目标中遗漏 41 条时任务 `needs_review`、游标仍为 0、60 条 History 未丢、无虚构提交。
- 指定 `repro_core_from_facts.js`：先前 FAIL → **PASS**；可信 fact 与原文完全一致的 core 成功 committed；不强制 legacy 可信。
- 新增独立 R8 测试：可信/陈旧/未核验/伪造引用事实，人工最终审核，2/4/19 分片遗漏、单次补录和重复原文共通过；独立源包两个反例原文件未被改动。
- 原来 42 项历史 Smoke 全部重新执行，加 2 项 R8，合计 **37/44 PASS、7 FAIL、0 SKIP**；已保留所有 FAIL stdout/stderr，未改任何旧断言。
- 75/75 个 JS 文件经 `node --check` 通过。
- `smoke-compat-rework-real-png.js` 读取了真实王爱英 PNG 样本，两套 PNG 角色数据离线测试 PASS；私有 PNG **不打包**，不构成官方 SillyTavern 黄金语义对照。
- 浏览器：Playwright 启动 Chromium，但打开完整 `index.html` 报 `net::ERR_BLOCKED_BY_ADMINISTRATOR`，**真实 IndexedDB/完整移动端点击流 UNTESTED**。
- Windows：当前是 Linux，不支持真实 PowerShell、Windows Node/Git 路径与 Sidecar 登录端到端，**UNTESTED**。
- Provider：测试是本地 stub，不存在真实供应商成功率或长期记忆召回实测，**UNTESTED**。

## 旧断言失败明细（未篡改）

- `smoke-compat-r1-r5.js` — FAIL；AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: /  /   assert(envelope.messages[0].content.includes('花园是红的')) /  /     at /mnt/data/eighth_round/work/MimaTAVERN-R1-R5-REWORK-20261011/tests/smoke-compat-r1-r5.js:25:210 { /   generatedMessage: true,
- `smoke-fifth-memory-root-closure.js` — FAIL；AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: / + actual - expected /  / + 'needs_review' / - 'failed' / 
- `smoke-seventh-memory-coverage.js` — FAIL；AssertionError [ERR_ASSERTION]: {"success":false,"code":"E_MEMORY_NEEDS_REVIEW","message":"最终合并遗漏了有来源的剧情事件，原文和摘要游标未修改，已保存待核对候选。"} /  / false !== true /  /     at /mnt/data/eighth_round/work/MimaTAVERN-R1-R5-REWORK-20261011/tests/smoke-seventh-memory-coverage.js:32:9 { /   generatedMessage: false,
- `smoke-sixth-r6-memory.js` — FAIL；AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: / + actual - expected /  / + 'needs_review' / - 'failed' / 
- `smoke-third-memory-journal.js` — FAIL；AssertionError [ERR_ASSERTION]: {"success":false,"msg":"摘要包含无法由原文逐字验证的叙述，已作为候选保留，未写入长期记忆。","code":"E_MEMORY_NEEDS_REVIEW","status":0,"hint":"请在记忆任务记录中查看待核查候选；核对原始剧情后可通过手工编辑记忆明确采纳。","details":"{\"stage\":\"fact_range_1_6_part_0\",\"reason\":\"plain_text_requires_review\",\"chars\":13,\"finishReason\":\"stop\",\"formatValidated\":true,\"sourceVerifie
- `smoke-v1.3.9-memory-facts.js` — FAIL；AssertionError [ERR_ASSERTION]: {"success":false,"msg":"摘要包含无法由原文逐字验证的叙述，已作为候选保留，未写入长期记忆。","code":"E_MEMORY_NEEDS_REVIEW","status":0,"hint":"请在记忆任务记录中查看待核查候选；核对原始剧情后可通过手工编辑记忆明确采纳。","details":"{\"stage\":\"fact_range_1_1_part_0\",\"reason\":\"plain_text_requires_review\",\"chars\":6,\"finishReason\":\"stop\",\"formatValidated\":true,\"sourceVerified
- `smoke-v1.3.9-png-memory.js` — FAIL；AssertionError [ERR_ASSERTION]: {"success":false,"msg":"摘要包含无法由原文逐字验证的叙述，已作为候选保留，未写入长期记忆。","code":"E_MEMORY_NEEDS_REVIEW","status":0,"hint":"请在记忆任务记录中查看待核查候选；核对原始剧情后可通过手工编辑记忆明确采纳。","details":"{\"stage\":\"core_final_single\",\"reason\":\"plain_text_requires_review\",\"chars\":8,\"finishReason\":\"stop\",\"formatValidated\":true,\"sourceVerified\":f

其中旧 `smoke-seventh-memory-coverage.js` 本轮新增 FAIL：其历史断言允许模型仅保留极少数原句就把 42 条独立剧情视为完整覆盖。该结果与本轮 P0 的新边界冲突，属于**预期的安全收紧，但尚未兼容旧测试**。另外旧自动摘要断言的三项失败说明自然文本正常自动结算仍存在兼容负优化，不能统称为“旧测试过时”。

## 功能影响面 / 负优化

仅修改 `standalone-core.js`、`app.js`，保留旧文件和入口；新增第八轮两份测试及报告。未改变 IndexedDB Schema、Store 初始化与原生会话数据写入契约。记忆输出、journal 和事务写入三阶段分离；未经证明的最终合并不会写 `rollingSummary`/`lastSummarizedIndex`。全部源角色卡和用户数据由原有 Store 保管，未对生产数据执行修改。

已知负面取舍：新核验可能把合理抽象而非逐字来源的摘要转入人工审核，尤其长剧情多分片。虽有一次受限补录，**自动摘要成功率与 Token 压缩效率仍未通过真实 Provider 质量门槛**，需要持续施工，不得宣传全面恢复。

## 其余 R1–R5 遗留

R1：浏览器真实 IndexedDB 跨标签竞争及无损迁移端到端待实测。R2：官方锁版本世界书触发/预算/递归/组/概率黄金对照缺失。R3：动态 MVU/状态栏多扩展及 CHARX 完整运行仍不完整。R4：真实 Tavern Helper 第三方脚本权限/API/沙箱实测不足。R5：Windows 官方宿主、局域网手机连接、真实原版 ST 登录/插件及安全回滚未验收。旧 mobile UX 与剧情模拟测试 PASS 不能替代 iOS Safari / Android Chrome 设备实测。

## 回滚与部署

回滚 ZIP 为**第七轮母体的字节级副本**，不含私人 PNG 或存档。施工文件为完整源码包，不覆盖用户 IndexedDB；建议先在独立目录测试，备份浏览器数据及原程序。不要从未经校验的读取失败推断数据库为空，更不要清空用户库。真正替换与回滚都要保留两版本入口与原有存档；Windows 与真实 Provider 未实测。
