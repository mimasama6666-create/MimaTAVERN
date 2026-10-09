# MimaTAVERN v1.3.3 | v1.3.2 独立验收返工两项收口

日期：2026-10-09
施工母体：`MimaTAVERN-main-v1.3.2-AUDIT-ROOT-CLOSURE-FULL.zip`（直接延续，不回退 v1.3.1）
依据：`MimaTAVERN_v1.3.2_独立验收与返工指令_20261009.md`
范围：只修 P0-1 与 P1-1；冻结 v1.3.2 已有 CAS、Session 生命周期、章节草稿迁移、世界书剧透过滤、finish_reason、字数契约、CSS 主题及旧入口。

## P0-1 备份内部字段损坏后清空资料 — 修根因

- 第一错误点：`local-store.js::validateLibrary()` 缺少深层正文校验。旧逻辑将坏的 `sessions[].messages` 和 `chapters[].segments` 当作合法备份，后续 normalizer 将其变为 `[]`；CAS 只能保证并发版本，不会识别错误输入。
- 修复：严格区分 v2/v3 老 schema 与 v4 完整 schema；v4 的七大集合与主题必须齐全。递归检查 RP 消息、删除消息、章节、正文片段、summary、narrativeState、Draft/Generation、目录及 ID/引用，校验失败报准确字段路径；禁止损坏结构变空后覆盖 canonical。
- 合法旧版：明确的 schema 2/3 可以缺失后来才引入的小说集合，按既有 normalize/import 路径迁移；未知 schema 不伪装为旧备份。
- `standalone-core.importLibrary()` 与 `MimaLocalStore.importAll()` 均共享同一 validator；唯一写入权威仍是原有 CAS。写入中断与版本冲突时保持原已落盘数据。

## P1-1 v1.3.1 剧情档案丢人物关系/线索 — 修根因

- 第一错误点：`novel-memory.js::deriveFromChapters()` 在无 `memoryDelta` 的旧有效摘要上，只重建 summary 里的事实/事件，遗漏旧 `narrativeState` 保存的人物、关系、未完线索。于是续写 Prompt 不再认识角色关系。
- 修复：在项目 normalize 时为符合来源快照的旧章节构建一次性 `legacyNarrativeCheckpoint`，记录逐章 ID、revision、正文 hash、总结生成时点和原有全局档案。它作为已验证旧章前缀的基线，后续新章节 delta 仍按时序结算。
- 无逐章来源图但章节快照一致时标记 `needs_review`，Prompt 和 UI 明示待核查；已知包含基线之外章节来源时隔离，防止跨章剧透。
- 任何被覆盖的源章节有正文变化、版本变化、摘要重生成、顺序变化或删除，旧基线即不可用于续写。老数据在 Store 中仍保存，但不会 union 回新事实；重建全部章节时显式清退旧基线，并重新按各章 `memoryDelta` 归并。
- Novel 剧情档案 UI 改为显示与 Prompt 相同的按时间线派生视图，避免 UI 继续展示已撤销的旧事实。

## 影响面与兼容性

保留旧 URL/按钮/导入导出、小说原始 sourceText、chapter segments、Draft/Generation、RP History、字体预设与 CSS；保留 v1.3.2 其它源码。未改 Store schema/DB_VERSION 或删除数据。项目旧剧情 checkpoint 是可选新增属性，不依赖升级清库；页面变更脚本附加 `rework=1.3.3` 缓存键。

## 验证

- 施工前专用反例：原 v1.3.2 在 `sessions[0].messages='string'` 用例产生期望的 **RED/失败**（旧 validator 错误放行）。
- 施工后新增：`tests/smoke-v1.3.3-backup-integrity.js` 覆盖损坏消息/正文/摘要/人物状态、缺失 v4 集合/主题、章节与片段 ID 冲突、Draft/Generation 无效引用、v3 合法迁移、真实 core 导入不变性、持久化失败和 CAS 冲突。
- 施工后新增：`tests/smoke-v1.3.3-legacy-memory.js` 覆盖旧档案继续进入 Prompt、来源边界、后续新 delta、编辑与重新总结撤回、无来源提示、跨章节不得前向泄漏。
- 原 v1.3.2 的 `smoke-v1.3.2-root-closure.js` 仅修复损坏的 **测试样本**：增加 `segments:[]` / `drafts:[]` / `generations:[]` 使其先满足新结构契约，继续验证预定的坏章节引用；未降低生产检查。
- 结果：**20/20 离线 smoke PASS**（18 个历史 + 2 个返工专项），33/33 个 JS 文件 `node --check` PASS。ZIP 与文件清单另外执行完整性检查。

## 未实测边界与部署提示

没有接入真实 API/中转站、用户浏览器生产 IndexedDB、跨 Tab Chromium/Firefox/Safari 压力测试；不能凭上述 mock 宣称这些环境已彻底验收。没有操作用户实际库。部分在之前版本已经被改写/丢失的旧全局档案无法凭空恢复，建议先用历史备份验证升级前人物状态。正式覆盖文件前先导出完整资料备份，**不要清理站点数据或 IndexedDB**。只有遇到真实数据的兼容错误，应保留数据并以错误路径排查，禁止重置空库。
