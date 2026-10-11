# 咪嘛馆 MimaTAVERN v1.3.9｜PNG 角色卡 + 记忆总结生命周期修复

**交付日期：**2026-10-11。**唯一构建母体：**本轮当前会话已经交付且已验证存在的 `MimaTAVERN-main-v1.3.7-THEME-COVERAGE-FULL-NO-DATA.zip`。在其之上接入本轮已经施工的 v1.3.8 PNG 导入增量，再完成 v1.3.9 记忆修复。此包不含任何用户 IndexedDB、本地 API Key、真实记忆或私人剧情。MIMAMAO 和 QQBOT 未修改。

## 1. 根因与调用链

### A. PNG 角色卡不能导入

旧链路：角色卡页面 `choosePersonaImport` → `<input type=file>` 仅接 TXT/JSON → `importPersonaFile` 用 `file.text()`/`JSON.parse()` 解码 → `POST /masks`。它从未识别 PNG 二进制块及其中的 `chara` / `ccv3` 元数据。第一非法状态是文件导入格式被误限为文本；与 PNG 文件的显示或浏览器图片解码无关。

修复：新增纯浏览器 `png-card-import.js`，检查 PNG signature、IHDR、IEND、各块长度、CRC、块数量和体积上限；从 `tEXt`、`zTXt`、`iTXt` 读取 `chara`（V1/V2）和 `ccv3`（V3），优先 V3，V3 损坏不能偷偷退回 V2。Base64 解码与 UTF-8 JSON 数据校验后，转入现有 `/masks` 路由；可选生成缩略头像，避免将原始超大角色卡再写进数据库。普通 PNG 没有角色卡数据则清晰报错，绝不创建假角色。

**兼容边界：**TXT/JSON 导入不变；`name/description/personality/scenario/first_mes/mes_example/creator_notes/tags` 等已映射。酒馆 V3 `system_prompt`、`post_history_instructions`、`alternate_greetings`、`character_book` 等扩展数据**目前不自动写入**既有 Persona 数据结构；导入界面会明确列出未映射的扩展字段，提醒保留原 PNG。此轮不把未知系统指令静默提升成运行时权威，不改 Prompt 注入和世界书契约。PNG 超过 20 MB 或无有效卡数据将被拒绝。压缩元数据解码需要支持 `DecompressionStream` 的现代浏览器。

### B. 关闭/切换记忆总结界面后“卡住”

旧调用：`generateCoreMemory/generateFactMemories` → `fetchStory(...,useAbort=true,handleMemoryProgress)` → `standalone-core.js::generate...Memory` → 多次 `callModel` → 旧 `saveSession(session)` → `renderMemoryTab(qs('settings-content'))`。问题有三个叠加：

1. 总结与正常聊天共用全局 `activeRequest`，新可中止请求可能取消正在工作的总结；“停止记忆”又会误取消其他任务。
2. `handleMemoryProgress` 每次用 `getElementById` 查询当前记忆面板。设置页切换导致原节点销毁后，状态未被任务对象保留，进度展示失联；成功后总是强制将“记忆”内容写进**当下可能已经切换到其他 Tab 的** `settings-content`，并在中止时重新打开界面。
3. Core 在 LLM 工作前读取整个会话快照，完成后直接 `saveSession(session)`。已有 `recordRevision` CAS 可拦截较新的会话编辑，但令添加消息/更改标题等无关更动也可能令总结失败，且不能实现安全的记忆字段合并。必须区分真实写入成功与进度展示结束。

**新修复：**

- `memoryTask` 是浏览器页面内唯一的记忆总结任务权威，独立 `AbortController`；不再占用聊天生成 `activeRequest`。进度状态保存于任务对象，不与 DOM 生命周期绑定。
- 弹窗关闭、切换 Settings Tab 后，总结继续在当前标签页执行；新增固定位置小面板显示会话名、阶段与“查看进度 / 停止”。重新打开记忆页会从任务状态恢复进度；用户未主动打开时成功结果不会强行打开弹窗。
- 异步操作开始时绑定固定的 `sessionId`。完成时只更新其对应会话：如果用户已经切到另一剧情，不劫持当前选中会话。
- 新的 `commitMemoryIntoLatest` 提交前重新读取最新 canonical 会话，验证总结依据的**原消息前缀**完全未变；如果仅在末尾新增消息，允许把记忆结果合入最新状态而不丢失新消息；如已有消息被编辑、删除、改分支，安全拒绝陈旧摘要；若核心/事实记忆被另一入口更改，不允许迟到结果覆盖手动调整。提交继续走原 `saveSession` 修订号与持久化 CAS。
- 停止信号在 LLM 各分段及提交前检查；成功保存和中止是不同结果。多段事实记忆全部成功之前**不覆盖**已有记忆；遇到 API 失败或取消，旧档案保持。
- 短篇核心总结（单段输入）将原来的“初稿一次 + 再合并一次”优化成一次直接生成最终核心记忆：输入原文完整，保留关系/约定/事实/因果提炼要求，减少一次冗余 API 调用；长文仍保留分块和合并流程，不限制上下文量以假装提速。
- 记忆页面补充非破坏性风险提示：事实分段范围重叠、核心记忆落后于当前轮次、事实记忆未覆盖最新轮次。不会自动删除/吞掉记忆。

**不会做到的事：**这不是服务器后台作业。关闭整个浏览器标签、刷新页面、电脑休眠等会中断依赖该页面执行的请求；本轮保证的是同一页面内的弹窗关闭/切换。跨刷新继续、永久任务日志和断点续做需要独立持久任务队列及明确事务模型，不能冒充本轮已实现。

### C. Novel Studio 剧情档案相关反查

小说章总结、整本重建入口与上述聊天记忆不是一条链。复核并做了局部补丁：独立 `novelMemoryTask` 记录小说 ID、任务类型与进度；在「剧情档案」Tab 显示进行中状态；重建时显示当前分析的章序；跨项目切换后，旧任务结果只影响其原项目，不再突然将旧项目 UI 结果覆盖当前项目。原小说 `recordRevision` + `sourceRevision` / `sourceHash` 保留，旧遗留资料隔离与人工覆盖权保留。**没有更改小说正文、草稿采纳、模型路由、历史数据迁移或角色身份映射。**

## 2. 已核实的其他记忆风险（本轮不冒险迁移）

- **P1，长期事实 provenance 尚未完善：**当前手工事实记忆条目有 `startRound/endRound/sourceMessageCount`，但没有每条的源消息内容哈希。已经生成的旧事实摘要在历史正文被编辑后，可能仍在 prompt 里被注入；需要未来带持久来源指纹与旧条目保守迁移、可见隔离/人工核查的专项修复。**本轮未声称已修。**不允许用“缺指纹就删除旧记忆”的办法治理。
- **P2，最近 X 轮重跑会产生范围重叠：**已添加 UI 提醒，当前保留旧片段且不强制去重，以免删除主人修订/存档；未来应设计稳定分段 ID 与来源修订，才能安全去重。
- **P2，超长剧情核心总结可能需要多次上游调用。**分段次数取决于原文长度与模型返回速度，非流式请求不能准确给出预测完成时长。本轮只减少有明确同等语义的单分块冗余调用，不做超时/换模型/删历史等负优化。
- **浏览器本地全量 Store 写入：**现有项目采用大状态快照提交，长篇存档仍有复制成本。没有性能基准和数据模型迁移方案前，禁止以删记忆或摘要取代原文来掩盖该问题。

## 3. 验收事实

- **27/27 JavaScript smoke scripts PASS**，含之前版本的历史备份/数据完整性/主题回归，与本轮 PNG、异步记忆新增专项用例。
- **41/41 JS 文件 `node --check` PASS**，HTML 中 **16/16 CSS/JS 静态引用存在**。
- 新增 PNG 专项：V2 tEXt、V3 优先、zTXt、iTXt、CRC 校验、重复块拒绝、普通图片拒绝及角色字段映射。
- 新增 Memory 专项：在 LLM 未完成时向同一会话追加消息，完工后消息保留；并发手工核心记忆修改被保留且迟到生成拒绝；用户中止不落盘；单段核心仅调用一次模型；多段事实成功保存；替换全部时第二段 API 429 后旧事实档案不丢；并发注入设置修改不被摘要覆盖。
- 模型调用仅是**本地模拟 Response**，没有调用真实付费 API 或改写用户实际数据库。
- **未实测**：Chromium 完整 UI 自动化尝试在当前执行环境被管理员策略拒绝访问 `http://127.0.0.1` 和 `file://` 页面，返回 `net::ERR_BLOCKED_BY_ADMINISTRATOR`。因此**不将关闭弹窗、手机浏览器完整 UI、Windows 实机、真实线上模型吞吐、用户 IndexedDB 长跑计入 PASS**。这部分必须以用户部署后实际体验复核。

## 4. Windows 部署与回滚

1. 在原版咪嘛馆内先导出完整剧情资料备份（特别是手工记忆与小说原文），另存安全位置。
2. 解压 `MimaTAVERN-main-v1.3.9-PNG-CARDS-MEMORY-LIFECYCLE-FULL-NO-DATA.zip`，**整套覆盖之前 v1.3.7 的静态项目源码**，新增 `png-card-import.js` 与既有 `theme-skin.css` 必须同时保留。此包无 `node_modules`、不增加 Windows 服务和 Python 运行依赖；依旧使用原来的启动方式。
3. 保持与旧版**同一个站点 URL、端口、浏览器配置文件**；不要清除浏览器站点数据/IndexedDB，不要把个人存档覆盖成空包。浏览器强制刷新以清 CSS/JS 缓存。
4. 上机验收建议：导入带 `chara`/`ccv3` 的 PNG、导入普通截图应明确拒绝；启动 2–3 段事实记忆 → 关闭设置 → 打开其他 Tab → 回到记忆查看进度 → 完成后刷新确认保存；另测停止、API 故障保护、长文本总结及 Novel 档案跨 Tab。
5. 如遇问题，将**静态代码**回滚至之前 v1.3.7 完整包，保留浏览器资料库。本轮不修改 Store schemaVersion，不主动迁移/初始化旧记忆。

**验收口径：**离线源码与模拟 Provider 路由闭环 PASS；真实浏览器/Windows/真实上游尚未实测；PNG V3 扩展字段尚不完整映射；事实记忆旧来源版本治理为后续 P1。不得宣称完全无 Bug。
