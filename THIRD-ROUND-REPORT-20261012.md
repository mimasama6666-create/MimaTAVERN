# 咪嘛馆 R1–R5 第三轮：原生记忆 P0 + 第二轮兼容遗留返工验收

> 2026-10-12；验收结论：**PARTIAL / NOT FULL PASS**。基于指定母体 `咪嘛馆_R1-R5_独立监工返工_完整源码安装包_20261011.zip` 同一工作树的增量施工；没有另起项目。所有源码验收均限定于当前离线环境。

## 1. 施工来源和数据边界

已阅读第三轮 `01` 返工令、`02` 独立根因证据、`03` MEM-01～24 验收矩阵，以及第二轮 `05` 精准返工和 `06` 独立验收、原 R1–R5 蓝图、旧 `OPEN-GAPS.md` 和 `REWORK-REPORT.md`。母体以实际 ZIP 的 SHA256 定义。保留原生 v1.4.0 所有 79 个历史文件与接口；其中修改的旧文件仅为：`app.js`, `index.html`, `local-store.js`, `standalone-core.js`。没有触碰 MIMAMAO/QQBOT。ZIP 不包含用户浏览器 IndexedDB、密钥、历史私人剧情、王爱英 PNG 源文件或真实机器环境。

## 2. 首个非法状态→传播→修复→可见结果

**MEM-P0-A：剧情与记忆相互阻塞。** 旧 UI 把 memoryTask 作为剧情发送前置条件；旧 Core 在调用角色模型之前 `await refreshSummary()`。因此模型总结延迟与 200 空回复会直接阻塞/失败主剧情。现在取消发送的 memoryTask gate，Rolling Summary 改为独立的持久化后台 job；新的记忆子请求只在正在运行 Speech Turn 时等待空闲，而不是阻塞正文。后台未归档旧历史在真正需要总结时暂时进入 Prompt 的未覆盖 gap，成功提交后才由摘要覆盖；原有限制窗口在无需自动摘要时保持不变。**离线**长剧情回放：滚动模型请求悬挂时连续两个 Direct Reply 成功并入库，随后摘要独立完成、两条新消息均保留。

**MEM-P0-B：摘要写回使用过期 Session。** 错误来自独立任务发起时的旧快照：若聊天追加或其它设置更新，旧的整 Session 保存会覆盖新消息/进度。现在在原 IndexedDB KV 库同一个 readwrite 事务内校验 snapshot 原始消息前缀、目标记忆旧版本、stable jobId/attemptId，**只**在现存 canonical Session 中合并记忆字段；旧请求 fenced；非追加修改报 `E_MEMORY_SOURCE_STALE`，事实/核心冲突分别显式失败。用户正文使用当前持久化 Session 做有界 CAS rebase，不因记忆并发而覆盖它。离线假 IDB 证明 append-only 并发与 source-edit 拒绝；**尚非浏览器真实多标签事务验收**。

**MEM-P0-C：记忆失败误判 API 和伪完成。** 每次记忆模型调用记录阶段、jobId、attemptId、模型、请求字段、耗时、状态码、finish_reason、可见字符数及 usage（若上游提供）；不记录 Key、Authorization 或完整 Prompt。HTTP 200 只有 `reasoning_content` 被判 `E_API_EMPTY_REPLY`；拒绝字段判 `E_API_REFUSAL`；截断候选判 `E_API_TRUNCATED`；400/429 与 transport 分开诊断。API 成功不等于持久化成功；只有同一 DB 事务写入后 journal 为 `committed`。错误保留旧记忆，不生成空覆盖。已用 mock 故障注入验证；**不能由此认定真实中转站错误是 Provider 自身造成**。

**MEM-P0-D：刷新后的任务状态不明。** `memory_job:<sessionId>:<kind>` 持久化记录包含 stage、checkpoints、status、attemptId、来源指纹与配置签名；刷新后显示未结算任务，须由玩家明确确认旧尝试失效才能重试。原 stable 身份保留，旧候选只在严格来源与配置一致时可复用；旧 attempt 不能提交。取消/中断保留 canonical 与原始剧情。该逻辑有源码和模拟验收，浏览器 crash/restart 未实测。

**第二轮同修。** 兼容实验室的结算不再把 CSS/资源修订当 Speech Turn 结算权威；正式结算由 turnId/attemptId/pendingTurnId + journal 决定。实际 aborted 不再被迟到 catch 错派发 `turn.failed`；合法 mounted CSS 经来源校验进入 Shadow DOM；正则 preview/display 采用批量可终止 Worker，保留 raw 和独立 prompt/display，不再逐条创建 Worker。100/500/1000 条离线 Worker 批处理测试通过；真实页面 CSS/CSP 行为未实测。

**R5 上游来源锁。** `UPSTREAM-LOCK.json` 与 `WINDOWS-SIDECAR/upstream-lock.json` 已固定 SillyTavern 1.19.0 完整 release commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`，官方提交： https://github.com/SillyTavern/SillyTavern/commit/7e8663cd9c184a550b37238218bdd32c6efc68e9 。Verify.ps1 按完整 SHA 校验本地 HEAD；Install.ps1 原有 full SHA 检查会开始生效。未执行 Windows clone/npm/启动/插件/登录。

## 3. 运行证据（明确边界）

- `node tests/smoke-*.js`：**36/36 shell 进程 exit=0**，但首次汇总中真实 PNG 用例因没有设置样本变量显示 SKIP；随后明确传入 `MIMA_PRIVATE_PNG` 用真实原版王爱英 PNG 重跑，`chara` 和 `ccv3` **两版均 PASS**。源文件未加入交付包，属于用户私有样本。
- JS `node --check`：**61/61** 通过，无语法错误。
- `tests/smoke-third-memory-journal.js`：模拟多轮发言/悬挂的 Rolling Summary、核心/事实记忆事务、追加并发、编辑旧正文 staleness、200 空回复保持旧事实、Prompt trace 确认事实被注入。
- `tests/smoke-third-compat-concurrency.js`：CSS 在 Provider 期间变更仍结算本回合；abort 迟到不发失败事件；100/500/1000 批量正则、病理模式超预算终止。
- `tests/smoke-third-api-diagnostics.js`：200 reasoning-only、拒绝、400、429、长度截断、fetch 网络失败、正常模型正文，结构化诊断无假 API Key。
- `tests/smoke-compat-rework-real-png.js`（真实 PNG 另跑）：两个上游编码版本各常驻 4 条，输入“偷看手机”时追加 1 条；**仅确认本引擎行为，不是上游 ST 的黄金语义一致性**。
- 检查基线 79 原生文件全部存在，未改动的文件 SHA256 与 `REWORK-BASELINE-HASH.json` 相等；历史兼容模块/sidecar 仍在。没有修改对外旧入口或合并/删除 Legacy 数据。

## 4. MEM-01～MEM-24 验收矩阵

`SOURCE_PASS`=源码完整性可追溯；`OFFLINE_PASS`=mock/Node 离线行为已执行；`PARTIAL`=仅部分场景；`UNTESTED`=未实测对应用户能力。**这些级别均不等于 BROWSER_PASS、API_PASS、WINDOWS_PASS。**

| 编号 | 结果 | 依据 / 限制 |
|---|---|---|
| MEM-01 | OFFLINE_PASS | 事实总结悬挂时主剧情仍生成、入库；浏览器点击未测 |
| MEM-02 | PARTIAL | 滚动任务悬挂可并行两轮；事实多分片连续三轮未真实浏览器回放 |
| MEM-03 | SOURCE_PASS | 记忆进度独立于设置 Tab DOM；Tab 交互未测 |
| MEM-04 | SOURCE_PASS | job 的 sessionId 不变且不写当前已切换 Session；真实 UI 切换未测 |
| MEM-05 | SOURCE_PASS | journal 持久化键、显式人工恢复入口；真浏览器 crash/restart 未测 |
| MEM-06 | SOURCE_PASS | 保存前检查旧 core 版本；手工晚到冲突路径未单独端到端测 |
| MEM-07 | OFFLINE_PASS | 新剧情 append-only 并存、未被旧记忆覆盖 |
| MEM-08 | OFFLINE_PASS | 编辑原消息使摘要判 stale，canonical 不被覆盖；分支重说浏览器未测 |
| MEM-09 | OFFLINE_PASS | 200 空正文、finish reason 诊断、旧事实保留 |
| MEM-10 | OFFLINE_PASS | 仅 reasoning 和 refusal 分别拒绝记忆写入 |
| MEM-11 | OFFLINE_PASS | Mock HTTP 400 返回字段与错误码；真实 Provider 不兼容参数未测 |
| MEM-12 | PARTIAL | Mock 429 与 transport、失败保留旧记忆；408/5xx/跨域各平台未逐一测 |
| MEM-13 | SOURCE_PASS | 只有 journal/canonical 原子提交才报保存；真实浏览器注入 DB 写失败未测 |
| MEM-14 | UNTESTED | 事实 50/200/500 轮全覆盖及耗时/API 消耗未完成 |
| MEM-15 | PARTIAL | 核心 context/facts 路径存在，来源版本校验；无大型真值覆盖 |
| MEM-16 | OFFLINE_PASS | 长剧情滚动请求悬挂仍发两个回复，结算后保留正文 |
| MEM-17 | OFFLINE_PASS | Inspector 显示 core/facts 来源有效性及事实实际注入；浏览器截图未测 |
| MEM-18 | UNTESTED | 无记忆/有记忆同问答真值召回率与误记率未量化 |
| MEM-19 | SOURCE_PASS | 原生 Store 和兼容 Store 独立；双引擎浏览器并行未测 |
| MEM-20 | OFFLINE_PASS | 既有旧版存档导出/导入/legacy schema 回归保持通过 |
| MEM-21 | PARTIAL | IndexedDB-like fake CAS 回放，真实跨 Tab 并发未测 |
| MEM-22 | OFFLINE_PASS | stable job/attempt、失败后重试/冲突 fencing；刷新恢复 UI 未测 |
| MEM-23 | SOURCE_PASS | 仅咪嘛馆工作树；不含 MIMAMAO/QQBOT |
| MEM-24 | OFFLINE_PASS + PARTIAL | CSS 期间结算、abort、正则批次 mock PASS；Shadow DOM 真实视觉未测 |

## 5. R1～R5 尚未通过的正式发布闸门

1. R1：跨库原子恢复/多标签真实 IndexedDB 和回滚流程未通过；失败读取不能被当空库。
2. R2：世界书概率/递归/组/sticky/budget 与 SillyTavern 1.19.0 的**上游真实 payload 黄金 trace**未达官方等价。
3. R3：完整变量历史 checkpoint、动态状态栏、MVU 和复杂 ST 正则全旗标未完成。
4. R4：MimaCompatSDK 是受限能力 SDK，不是 Tavern Helper 原生 API；第三方插件真实 iframe、CSP、同源与跨源安全审计未达到 L4；如需要原版插件须用可选官方宿主。
5. R5：虽然锁定 full SHA，**Windows PowerShell、Git/Node/npm、中文空格目录、断网/端口、登录与真实 Provider 未实测**。
6. MEM：真实浏览器 IndexedDB 多标签、记忆刷新/恢复、50/200/500 轮覆盖、三组有无记忆的定量结果仍未实测。因此整体仍为 **PARTIAL**。

## 6. 安装/数据保护/回滚

完整源码 ZIP 解压到**独立新文件夹**；不要覆盖唯一正式数据目录。普通原生咪嘛馆无需新增后端。不要将 `localStorage` API Key、IndexedDB 用户记忆、真实角色卡和 private PNG 放进源码 ZIP。回滚 ZIP 为本轮开始指定的母体文件**原字节拷贝**；回滚源码前先另行备份用户浏览器数据，旧数据由浏览器持有，本包不假装含有数据库快照。Sidecar 仍可选、独立安装，禁止覆盖已存在或未知所有权的 SillyTavern。

### 结论

本轮原生记忆主回合隔离、崩溃任务 journal、事务来源验证和 API 分类，以及第二轮 4 项源码问题，均有源码或离线证据。**未经过真实浏览器、真实 API、Windows 官方宿主和 ST 上游黄金对照，不能称为彻底修复或 R1～R5 FULL PASS。**
