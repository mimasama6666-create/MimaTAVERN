# 咪嘛馆 R1–R5 第四轮增量返工｜根因与验收报告

日期：2026-10-12。**结论：PARTIAL / NO-GO（不得覆盖唯一生产版）**。

唯一母体：第三轮完整源码 ZIP，SHA256 `6ebd3310de0edfc295bfcd7039fcff41a1607f1edf6e649498e2664ac2568bf2`，原始 144 文件逐个保留，改动旧文件仅 app.js, local-store.js, standalone-core.js；新增第四轮测试与交接材料。未接触 MIMAMAO/QQBOT，未拷贝或覆盖用户 IndexedDB 和 API Key。回滚 ZIP 为本轮母体原件，未作改写。

## 第四轮根因及修复

1. **P0-A 长剧情未摘要原文冲垮主上下文。** 根因在 `standalone-core.js:assemble()` 的无限制 `needsRawGap` 投影，不是 Provider “随机不稳定”。原版最近 12 消息配置可在 500 轮膨胀为 1000 条，独立原测试估计约 197486 Tokens。现在最近窗口、Persona/Worldbook/记忆设置不被自动缩减；超出用户选择的模型输入预算时明确 `E_CONTEXT_BUDGET_BASE`，未向 Provider 发送超预算请求。待摘要旧原文仍完整保留在 IndexedDB，构建可追踪的按本轮输入检索的证据投影（源消息 ID、源前缀指纹、检索/遗漏数量、上下文估算预算来源）；漏检与非官方 token 估算明确显示，禁止把缺失的旧事实推断成不存在。`contextWindowTokens=0` 时采用标明“未核实”的 32768-token 保守估算，支持用户填写模型官方窗口；需要真实 Provider tokenizer 实测后才能宣布准确。`rolling_summary` 大材料拆成可恢复来源分片，不删除原文，也不以永久摘要替代原始资料。
2. **P0-B 拒绝模板进入长期记忆。** 根因 `memoryModel()` 非空即认定有意义。现在为 core/facts/rolling 的每个模型输出加入任务级 JSON + 原始来源引文契约，兼容老 API 纯文本时进行来源词片验证；检测拒绝式完整回复、占位、控制层文本、结构坏 JSON、截断与无证据内容，入库前 fail closed。引文必须真实存在于该任务提供的来源材料中，摘要与引文还需有词义线索上的词面交集。旧记忆不被清空。journal 记录生成请求、验证通过/拒绝、提交；Prompt Inspector 显示实际注入。已存第三轮旧候选在恢复时也必须重新验证，防止复用污染。**此验证是来源词面/格式安全门，不等于 LLM 事实准确性的语义证明。**
3. **P1-C 后台 orphan / attempt 竞争与旧阶段复用。** `local-store.js` 给 memory job 增加独占租约、10 秒心跳、过期 attempt 重新领取（保持同一 job ID、更新 attempt ID）、最多三次恢复及旧 attempt fencing。浏览器启动仅对租约过期的 rolling 债务尝试原任务恢复，不抢占有存活租约的其他页面。手动滚动恢复不再只是等待下一轮剧情。识别另一问题：上次 `committed` job 的 `_received` 候选不能用于新的“重新总结”；仅 interrupted/failed/orphan 可复用经重新验证的阶段。刷新/多标签真实行为仍需浏览器 IDB 验收。没有通过 sleep 增长或 Provider fallback 掩盖故障。

## 验收证据

- 37/37 旧+新增 Node smoke 测试通过，无 SKIP；62/62 JS 文件 `node --check` 通过。
- 第四轮新测试：50/200/500 轮 Prompt 界限与 12 条最近窗口不被改写、原始 100/400/1000 条 History 持久存在、源 ID 检索/漏检诊断、配置窗口过小时拒绝错误、429 记忆请求仍允许两次完整剧情回复。
- 真实 IndexedDB **未实测**：使用确定性的假 IDB 事务回调进行 CAS/job 回放；另对新版 lease 的 living pending、expired takeover、old attempt fencing、旧候选污染重复校验进行离线测试。`smoke-third-memory-journal.js` 重复 20 次 20/20 通过，但仅说明本环境的离线复现未再次出现 flaky，不可宣布真实多标签已解决。
- Core/Facts/Rolling 三路径：普通拒绝模板不能写入；结构化合法来源证据可写入核心记忆、下轮 Prompt 确认注入；无来源 quote 不覆盖旧记忆。第三轮第四轮独立污染复现现在 `success=false,E_MEMORY_OUTPUT_INVALID,injectsRefusal=false`。
- 正则 Worker、世界书真实 PNG、插件边界、CSS 并发、备份完整性、Novel 等 36 个既有 smoke 均回归通过，既有能力未删除。

## 明确未闭环、不可宣称 FULL PASS

- **Chromium 真实 IndexedDB / crash/restart / multi-tab / CSP** 未实测；此环境尝试 Chromium headless，但没有取得可观测的成功 DOM/IndexedDB 页面结果。模拟 IDB 不等于浏览器事务行为。
- **真实 Provider 50/200/500 轮与记忆召回定量准确率** 未实测；token 为本项目估算，不是供应商 tokenizer。其余输出真伪只能在实际模型+来源语义对照后验收。
- **R1** 原生/兼容双 Store 的安全一体化备份与恢复未达真实浏览器端到端；已有码保留，不作破坏性更改。
- **R2** 官方 SillyTavern 固定提交下 worldbook recursion/group/sticky/probability/depth/payload 黄金差异未封闭；王爱英 PNG 双版本本引擎回放仅为部分证据。
- **R3** MVU、动态状态栏、变量 checkpoint、ST 正则语义完整等价未完成。
- **R4** 受限 SDK 不是 Tavern Helper 完整 API；复杂 DOM 脚本只能转可信官方宿主，不提供 top/parent DOM 权限。
- **R5** Windows Node/Git/带空格/中文路径、断网/端口、真实登录与插件玩法未实测；Sidecar 原文件保留。

## 安装/回滚

独立目录解压新包；保留旧目录和浏览器存档，先做非破坏性验证；**不要覆盖唯一生产实例**。如需退回，请用字节原样保存的第三轮源码包作为回滚源，仅回滚源码文件，不清空浏览器 IndexedDB/localStorage，不声称数据结构降级可逆。所有修改的行级差异在同批交付 `.patch` 文件；第四轮新增文件、哈希在 `FOURTH-ROUND-SOURCE-MANIFEST-SHA256.json`。验收工具不联网、不调用真实 Provider。
