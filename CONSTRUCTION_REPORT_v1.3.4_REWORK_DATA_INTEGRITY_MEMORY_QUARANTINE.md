# 咪嘛馆 MimaTAVERN v1.3.4｜2026-10-09 最小根因返工与验收

## 母体与边界
母体：文件库 `MimaTAVERN-main-v1.3.3-REWORK-ROOT-CLOSURE-FULL.zip`，SHA-256 `e18acee1b975384e10ce143813ad9c256844914034e51b17d564965b0b014440`。只处理 `MimaTAVERN_v1.3.3_独立验收与最小返工单_20261009.md` 中 1×P0 与 1×P1；保留 v1.3.3 的 CAS、Session 防复活、Draft 保留、世界书时序、输出 finish reason、CSS、全部旧入口。无生产资料输入、无真实模型调用。本交包为完整源码，不是增量补丁。

## P0-1 完整备份内容消失：根因闭环
第一非法状态发生于 `local-store.js::validateLibrary` 对 v4 正文数据的“可选字符串”校验，缺字段也判合格。`MimaStandalone.importLibrary` 及 `MimaLocalStore.importAll` 使用同一校验器，过去后续 normalizer 会把缺失字段变成 `''` 再 CAS 成功落盘。修复在原始备份 JSON 被归一化**之前**校验 v4 必需持久正文：Preset 内容/说明、Persona 内容/描述/场景/开场/示例/创作备注、Worldbook 条目内容、小说原 TXT sourceText、CSS 正文、Regex pattern/replacement、RP 多类摘要/笔记/导演文本及 message raw/rendered 和版本记录、档案 facts/core 内容、小说章节 summary、Generation 导演文本/错误等。对完整 v4 要求字段“存在且为字符串”，**允许空字符串**，与仅声明 schemaVersion 2/3 的合法旧备份分开处理；不修改 normalizer 正常功能。错误包含可定位字段路径，拒绝进入 persist。原版备份固定的 16 组反例在旧母体上为 RED，新母体 GREEN。重新导出的合法 v4 能还原 Persona、文风、世界书、小说 sourceText、草稿/Generation、RP 消息、CSS、Regex。原内存与持久化模拟在错误导入/写入中断后不变。

## P1-1 未核查旧记忆剧透：根因闭环
`novel-memory.js::deriveFromChapters()` 曾把 `needs_review` 与 `verified_legacy` 同等当作全局 checkpoint 来初始化，连来源不明的未来剧透一起当作已发生事实进入 Prompt；给文字加“待核查”并没有隔离数据。本轮仅允许 `verified_legacy` checkpoint 作为推导基准；`needs_review`、`quarantined`、`invalidated` 的**未证实全局正文**不再注入。旧资料仍原样保存在 `legacyNarrativeCheckpoint.state`，Novel 剧情档案页面新增折叠核查区。用户可明确确认单条历史记录已在某章发生，经 `/novels/:id/memory/legacy-review` 保存该条的章节 revision/hash 与总结 generation 证据。经核查的记录在对应章的已验证摘要后应用，然后由后续章节正常更新；改章、重排及重新总结会使旧证据失效。不同章节的未核查秘密不会自动获授权，已验证的老版本人物状态/关系则继续进入合法 Prompt。

## 源码影响范围
修改的原有文件：index.html, local-store.js, novel-memory.js, novel-studio.js, standalone-core.js, tests/smoke-v1.3.2-root-closure.js, tests/smoke-v1.3.3-backup-integrity.js。
新增：tests/browser-v1.3.4-idb.py, tests/smoke-v1.3.4-rework.js, tests/smoke-v1.3.4-legacy-quarantine.js。对两个原有 smoke 的修改是**补全此前测试里缺少 v4 必需字段的简化样本**；保持其原本断言和业务意图，不改生产逻辑迁就旧样本。其余 51 个原有文件哈希未变，无原有文件缺失。

## 测试与边界
- v1.3.3 旧源码执行新增检测：`smoke-v1.3.4-rework.js` RED（缺失 preset.content 放行），`smoke-v1.3.4-legacy-quarantine.js` RED（未核查未来剧透进入 Prompt）。
- 本地 Node：22/22 个 smoke 脚本 PASS（包括新增两项）；全部 JS 语法检查通过。
- 独立模拟：完整 v4 导出 / 导入、16 个损坏/错型字段、拒绝时内存/模拟持久化均无变化、写入中断、v2/v3 合法格式、verified legacy 保留、待核查记忆隔离、单条用户核查、章节改动/重排/重分析后的撤销与后来章节覆盖。
- `MimaLocalStore.importAll` 原生入口的错误备份拒绝也在 Node 检测中直接调用，使用的是同一 validator；正常写入路径通过 Core + 内存 CAS 模拟核对。
- **未实测：** 真正浏览器 IndexedDB 写入与双 Tab 压力，真实 API/HTTP/SSE，以及第三方 CSS 全视觉兼容。在此容器的 Chromium `page.goto` 被 `net::ERR_BLOCKED_BY_ADMINISTRATOR` 禁止（HTTP localhost 与 file URL 均如此）；随包保留可在允许浏览器访问本地测试页面的环境运行的 `tests/browser-v1.3.4-idb.py`，**未标记 PASS**。

## 安装
先在当前咪嘛馆导出完整 JSON 备份并另外保存；保持原站点 origin/浏览器数据，不清除 IndexedDB、localStorage 或字体数据。完整替换静态站点文件，更新后浏览器脚本 URL 已对修改文件追加 `reworkfix=1.3.4` 防缓存旧代码。不要把独立咪嘛馆和 MIMAMAO/QQBot 混用。
