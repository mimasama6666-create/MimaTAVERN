# 咪嘛馆 R1–R5 第七轮精准续修 · 根因、回归与验收报告

验收日期：2026-10-12；唯一施工母体：`咪嘛馆_R1-R5_第六轮统一续修_完整源码安装包_20261012.zip`；母体 SHA256：`cd0a5111ff7e4b8f86802c71823be1af9ed127f39c0e0ad5c034a9be4986d6bd`。本轮未重新设计工程、未修改 MIMAMAO/QQBOT，未删除任何原始源码或用户数据。本轮 **PARTIAL / NO-GO**。

## 1. P0 滚动记忆游标越界 — 首个错误状态与修复

原始独立反例：60 条消息、最近窗口 12，`rolling_part_0` 被转待审核，其它分片和最终合并未执行；第六轮 `reviewMemoryCandidate()` 却执行 `lastSummarizedIndex=sourceCount-safeWindow` 并把 42 条标为已总结。History 尚在 Store，但提示词覆盖语义损坏。

改动：滚动构建阶段按源消息划分可追溯分片，记录 `sourceStartIndex/sourceEndExclusive/messageIds/sourceCoverageHash/sourceParts` 和最终 `rolling_source_plan`；事务审核验证来源前缀、精确分片覆盖指纹、目标记忆版本和 journal 状态。局部人工批准只产生 durable stage、置为 `interrupted`，不写 canonical 摘要/游标；同一未变更来源的恢复通过 human-approved stage checkpoint fencing 复用此片，后续片及最终合并正常执行。只有全量最终 `rolling_summary` 或已验证先前全部分片的 `rolling_merge` 可在相同事务中推进完整范围游标。源消息编辑、任务旧 attempt、不同事务版本无法静默覆盖。

第七轮复现输出：批准 `rolling_part_0` 后 `lastSummarizedIndex=0, rollingSourceCount=0, rollingSummary=''`；使用相同 60 条原文复跑余下分片、合并后 `lastSummarizedIndex=42`，60 条 History 全保留。离线交易模拟 PASS。真实 Chromium IndexedDB 多标签竞争未验收。

## 2. P0 记忆自动化及事实契约

原来的自然意译一律需要手审，并把 `E_MEMORY_NEEDS_REVIEW` 错误结算为 `failed`，与 HTTP/Provider 故障混同。现在单独结算为持久化 `needs_review`，页面展示「待核对」而非「API 失败」，前台剧情不等待记忆；正常后台自动请求、续跑仍保留。

补入**来源摘录式安全自动结算**：模型提供 JSON `memory + evidence[].quote`，引用必须逐字属于当前真实源消息并能映射完整消息，声明和来源需通过行为/极性/传闻/否认/假设保守门控。通过时 canonical **保存带说话人来源的真实原文摘录**，而非把可能不实的自由意译当作事实；自由改写保存在候选记录继续待审核。测试中的「月下不背叛契约/银色戒指」自然归纳自动通过，但入库的是可核对的原句。带真实引文的「玛丽背叛并谋杀」未通过，不覆盖原 core。

这不能宣称自由抽象摘要都已自动、安全完成：无引文纯文本、难以证明的跨消息推断仍进入待审核；需更多真实 Provider 多类型样本测误拒率、事实召回准确性与多阶段重试。当前没有真实 API 成功率证据，不应把合成样本的成功率推广为生产成功率。

`10/50/200/500` 条消息的合成 JSON 引文 Provider + Node 模拟 IndexedDB 测试均能在 1 次请求后成功写核心记忆、保留全部源消息：耗时分别约 `19/10/26/59 ms`（仅本次机器上的离线模拟，不能代表模型延迟或真实成功率）。

## 3. P1 事实记忆与召回

以前部分事实候选被人工批准后使用 `startRound:0,endRound:0`，且 `fact_part_0` 在多个范围复用相同 stage 名称。现将阶段改为 `fact_range_A_B_part_N / ..._merge`，每个待审候选记录实际 `startRound/endRound` 和源消息索引。第一轮来源 1–1 分片批准不立即宣布整个事实任务完成，原记忆仍保持原样；恢复后提交 1–1 与 2–2 两条事实记忆，没有 `0–0` 虚假记录，原文 4 条全保留。

第五/第四轮已有的 50/200/500 轮「继续」旧剧情召回不删 History/Persona/Worldbook；本轮没有修改历史数据结构、检索 token 预算、角色卡资源、后台调度开关。注意：老 journal 阶段名仍保留但部分旧事实分片需重新生成，未曾删除旧 checkpoint。

## 4. 手机与 Sidecar P1

顶部「当前角色/剧情」不再与角色头像双重打开设置；头像作为「切换角色」，功能菜单保留可发现的「管理角色资料（高级）」，单独设置仍指向 API。超窄屏 37px 头像修复为真实 44px。隔离 Chromium DOM + 原 CSS 量测 `320/360/390/428px`，各可见顶栏按钮最小 `44×44px`，横向滚动宽度等于视口；「功能」菜单可打开并通过 Escape 关闭。这是**静态隔离 DOM 点击**，不是整站真实移动浏览器测试。

原版 SillyTavern 入口不再直接链接 `127.0.0.1:8000`；须用户输入并确认服务器地址，拒绝 `javascript:` 和公网 HTTP，区分 localhost / 私有局域网 HTTP / HTTPS，并提示认证、TLS、可信网络及数据不会自动同步。普通卡片聊天仍与 Sidecar 无依赖。

真实站点导航的 Chromium 报错为 `net::ERR_BLOCKED_BY_ADMINISTRATOR`（包括尝试通过临时受控 origin）；无法证明 IndexedDB 刷新、手机整条开局点击流、实际 Sidecar 登录。不要把静态页面通过当成整站通过。

## 5. 独立 Smoke 与真实 PNG

旧 40 组原测试无代码/断言变动；新增两组 `smoke-seventh-memory-coverage.js`、`smoke-seventh-memory-benchmark.js`。最终 Node **36/42 PASS，6 FAIL，0 SKIP，0 TIMEOUT**；JavaScript `node --check` **73/73 PASS**。

6 项旧断言失败分别是：`smoke-compat-r1-r5.js` 假定世界书应被放在 system（违反既有降权安全边界）；`smoke-fifth-memory-root-closure.js` 和 `smoke-sixth-r6-memory.js` 要求待审核记忆 journal status=`failed`（现明确改为 `needs_review`）；`smoke-third-memory-journal.js`、`smoke-v1.3.9-memory-facts.js`、`smoke-v1.3.9-png-memory.js` 要求未经证据核实的自由纯文本自动入库（不能为过测试直接放行）。这些差异继续视作功能兼容风险，不冒称全绿。

`MIMA_PRIVATE_PNG=<用户本地真实 PNG>` 独立执行两个真实 PNG 回归：原文件双版本解析/基础世界书、compat SHA 去重、三轮模拟游玩、来源挂载和撤销、journal/快照通过，均为 **mock Provider + fake IndexedDB**。未按官方 SillyTavern full commit 行为做同卡片黄金一致性验证；未附带用户真实 PNG 到交付包。

## 6. 影响面与 NO-GO

原源码 180 文件全部保留。只修改原生 `app.js`,`index.html`,`local-store.js`,`standalone-core.js`,`ux-r6.css` 五个文件，新增 `ux-r7.js` 和两份第七轮 smoke。旧 tests、Persona、History、兼容 Store/Runtime/Worker、主题、贴纸/语音材料、Sidecar/legacy 未删除；保留原生入口与目录引用。恢复/审核采用现有单状态事务，不创建双结算权威。

**仍未实测/未闭环**：真实 iOS Safari/Android Chrome、本机或局域网整站浏览器 IndexedDB、两标签并发/崩溃恢复、真实 Provider 10/50/200/500 轮延迟与错误率、普通未附引文摘要的广泛自动成功率、官方 SillyTavern 黄金世界书递归/分组/概率/sticky/depth、R3 动态状态栏与 MVU、R4 Tavern Helper 完整插件 API/CSP、R5 Windows Node/Git/认证/断网端口及跨设备访问。发布仍为 PARTIAL / NO-GO，使用独立测试副本，不覆盖唯一正式存档。
