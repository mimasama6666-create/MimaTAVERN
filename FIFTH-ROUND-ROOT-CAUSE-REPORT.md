# 咪嘛馆 R1–R5 第五轮根因续修 / 独立验收报告

日期：2026-10-12。交付状态：**PARTIAL / NO-GO**。这是第四轮最新源码的续修，不是重做，也没有触碰 MIMAMAO / QQBOT。

## 母体和安全

- 精确前驱：`咪嘛馆_R1-R5_第四轮增量返工_完整源码安装包_20261012.zip`，SHA256 `eefcc9b278fad19530d5875b8d14a974302fb86e3ceec2aa2017d929fd975b2d`。
- 前驱文件 155 个，**未删除 155 个中的任何文件**；修改 4 个（app.js, index.html, local-store.js, standalone-core.js）；新增 2 个（tests/fifth-counterexample-original.js, tests/smoke-fifth-memory-root-closure.js）。
- 交付包不包含用户的 Store、秘钥、私人 PNG 或已连接 Provider 数据；回滚包与原第四轮 ZIP 字节相同。
- 未运行真实收费模型，没有将 Provider mock 成功视为真实线上成功。

## 缺陷到根因的闭环

### P0-01：重复核心记忆 `E_MEMORY_CORE_CONFLICT`

- 症状：第一轮 core 写入 raw 时缺少规范化产生的 `stale:false` 等默认字段；下次 `normalizeSession` 的 snapshot 包含默认字段，`commitMemoryJob` 在事务中以 raw JSON 与 normalized JSON 比较而误报冲突。
- 修复：建立唯一共享 `MimaMemoryContracts.normalizeManualMemory` 契约，事务在同一 IDB 读写事务内把 canonical 和 snapshot 双方统一规范化，再执行原有核心/事实 CAS。保存候选也预先规范化。没有删除冲突校验。
- 验收：同一 Session 连续三次合法核心生成成功；真实人工改核心记忆时，仍报 `E_MEMORY_CORE_CONFLICT`，人工编辑未被旧 attempt 覆盖。离线模拟 PASS，跨标签 Chromium 未实测。

### P0-02：有合法 quote 的伪造事实污染记忆

- 症状：旧校验只需 quote 存在、summary/quote 任意双字交集即可自动通过，新增恶魔、主体反转、否定和未发生誓言可静默进 canonical。
- 修复：分离 schema/refusal/source/claim 证明。自动可信条件为摘要实质文本可从引文按顺序直接核验，并把引文精确绑定到 canonical message ID + 区间；未通过的抽象改写（含纯文本 Provider 输出）转为 `E_MEMORY_NEEDS_REVIEW`，候选写入可恢复 memory journal 的 `_needs_review` checkpoint，**不会写入 core/facts/rolling，也不会注入下一轮 Prompt**。UI 的记忆任务记录中可查看候选，核心候选可载入手工编辑框（仅用户点击保存才确认）。已明确向模型要求引用原文片段，不依赖第二个 LLM 当事务权威。
- 验收：伪造人物、主体反转、否定反转、虚构承诺、无来源纯文本均拒绝自动入库，合法 JSON 摘录成功，并在核心记录中保存 `verification.status=extractive_verified` 与来源 ID/offset。人工编辑保留。合成回放 PASS。
- **兼容限制**：合理但无法逐字核验的自由改写仍需人工核对；事实记忆与滚动记忆的待审核文本虽有持久 journal，但没有完整的一键人工结算 UI。不得称全功能恢复。已有未标注证明的历史记忆仍会按旧设定使用，这一历史迁移验证缺口尚未封闭。

### P1-03：输入窗口和 max_tokens 不相容

- 症状：旧 `Math.max(1024, remaining)` 把负余量伪装成有效预算；对 4096 窗口提交 8192 max_tokens。
- 修复：明确输出预留额和估算输入额。配置无法满足时预览和发送前报 `E_CONTEXT_BUDGET_CONFIG`，Direct Reply、Memory 和 Novel 模型调用均做已配置窗口的预算前检；max_tokens 不被偷偷调小；上下文原文仍完整保存在 Store。
- 验收：4096/8192 预览拒绝，直接聊天发送不会触发任何 Provider 请求。若模型上下文窗口未知，估算值**不是上游硬保证**。

### P1-04：只有「继续」的长剧情旧事件无法召回

- 症状：按词语双字召回，泛化短输入无关键词，导致 200 条历史的关键藏匿事实完全消失于当前 Prompt。
- 修复：保留现有词语召回；对纯续写增加有界的结构化事件词/置顶标记加权索引，按原始 message ID 和时序取出证据，限定额外预算；`contextTrace` 明确注明 continuation_event_index、未覆盖数量、召回 IDs。绝不删除/永久替换完整 History。
- 验收：50/200/500 轮的「继续」均能召回第 1 条蜂蜜藏匿事件，仍保留所有原文；该案例 PASS。真实大规模召回率、跨多主题语义关联、无显性事件词的暗线仍是 GAP，不能将启发式算法声称为完整向量检索。

## 测试事实

- Node smoke 实际执行 **38 项：PASS 35、FAIL 3、SKIP 0、TIMEOUT 0**。
- JS 语法校验 **66/66 PASS**。
- 王爱英原始 PNG 两版本执行：`MIMA_PRIVATE_PNG` 指定真实样本，smoke PASS；**未开展上游 SillyTavern 官方世界书黄金对照**。
- 本轮新增 `smoke-fifth-memory-root-closure.js` 通过；第四轮 `smoke-fourth-memory-p0-lease.js` 通过。
- 老 smoke 未通过：smoke-third-memory-journal.js, smoke-v1.3.9-memory-facts.js, smoke-v1.3.9-png-memory.js。
- 这 3 项**不是全部根因已修复的证据**。尤其旧三项记忆测试使用缺少原句证明的纯文本模型输出，却断言其必须自动写入长期记忆；新安全契约明确拒绝这类自动升级。测试未篡改、也没有放宽生产逻辑。发布保持 NO-GO。
- Chromium 144 本体可启动；真实 IndexedDB 页面导航测试先后尝试 `http://127.0.0.1` 和 `file://`，均遭宿主策略 `ERR_BLOCKED_BY_ADMINISTRATOR`，**浏览器端到端未实测**。

## 依赖/影响面反查

- `runRecordedMemory` → `memoryModel` → `validateMemoryCandidate` → `storeMemoryResult` → `local-store.commitMemoryJob`；`normalizeSession` 与 local-store 使用同一 core/facts 语义契约，保留唯一 journal owner、attempt fencing、source prefix 防旧响应覆盖。
- `assemble` → `promptBudget` → `retrieveRawGap` → `inspector/contextTrace`；`callModelWithConfig` 还会独立校验 Provider 请求的输入/输出配额。
- 原生 `index.html` 只在原脚本 query 尾部追加 `fifth=20261012` 缓存版本，不改变旧版本参数前缀。其它旧入口不删。
- 兼容实验室与原生聊天、小说、主题、记忆共同参与 smoke；仍无法替代真实浏览器/Windows 用户体验测试。

## 待办与发布判定

**NO-GO**：真实浏览器 IndexedDB 事务、刷新/跨标签、Windows sidecar、真实 Provider、长期记忆自动摘要可用性与事实召回准确率、普通纯文本候选人工结算、复杂世界书 recursion/sticky/group/probability/depth 黄金 trace、MVU/动态状态栏、完整 Tavern Helper 第三方脚本安全边界、双 Store 恢复/回滚均没有完整实机验收证据。

**正确安装建议**：先在独立测试目录解压新完整包，原版和数据库保持不动；若回滚，恢复本轮原始第四轮 ZIP，而不是清空浏览器 Store。
