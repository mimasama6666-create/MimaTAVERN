# 咪嘛馆 v1.3.5｜v1.3.4 独立验收 P0 最小返工

日期：2026-10-09
母体：`MimaTAVERN-main-v1.3.4-REWORK-DATA-INTEGRITY-MEMORY-QUARANTINE-FULL.zip`，SHA256 `d7cc6ac6f2437341658cbd0b9dbb68235c2d9b6aabb74c211f64a0a49a21b48d`。
依据：`MimaTAVERN_v1.3.4_独立验收与最小返工单_20261009.md`。
范围：**只修 1×P0 完整备份中缺失持久数组／对象被当空值落盘**。原 P1 legacy 剧透隔离已通过，冻结不改；不涉及 MIMAMAO / QQBOT。

## 一、第一非法状态与传播链

`local-store.js::mustArray(value,path,required=false)` 允许缺失值变成空数组；v4 `validateLibrary` 未对 `archivedBranches`、`manualMemory.facts`、`chapter.summary.events/characterChanges/...` 使用 `required=true`。因此完整备份中的字段删除被误判为合法；`MimaStandalone.importLibrary` 经 `normalizeSession`、`normalizeManualMemory`、`normalizeChapter` 归零后调用 CAS 持久化，历史内容无声丢失。CAS 只处理并发版本问题，不能替代输入合法性。

## 二、源码改动

只修改生产 `local-store.js` 与 `index.html`：

- v4 对 RP `deletedMessages`、`archivedBranches`、归档 `messages`、消息 `versions`、Session 挂载与内容列表、`manualMemory` 对象及 `facts/core/settings` 要求字段存在、结构正确；归档分支 ID 与手动事实 ID 依 v4 结构唯一性检查。允许合法空数组。
- v4 对 Persona 别名/标签、世界书关键词/次关键词/标签、小说世界书/预设挂载列表、章节摘要 `events/characterChanges/revealedFacts/openThreads/foreshadowing`、小说 `modelSettings/generationSettings/appearance/memoryStatus`、Draft metadata、Generation inputSnapshot/attempts 及章节 `memoryDelta` / legacy checkpoint 的持久字段做同源校验；`memoryDelta` 和 checkpoint 允许**显式 null**，不允许字段消失。
- 对 `memoryDelta.closedThreads/resolvedForeshadowing` 仅在字段存在时检查数组元素；不把合法的**部分** delta 与 narrativeState 当成已完成全结构，避免误拒真正生成的数据。
- 保留 v2/v3 合法旧备份的可选字段迁移语义。非法 v4 在 normalize 和 commit 前报出带路径错误，`MimaLocalStore.importAll` 与 `MimaStandalone.importLibrary` 共用同一 validator。
- 仅调整 `index.html` 的 local-store.js 查询参数 `arrayguard=1.3.5`，防止用户浏览器继续命中旧校验器的静态缓存；未改 CSS / UI 行为。

## 三、专项 RED → GREEN 与边界

新建 `tests/smoke-v1.3.5-persisted-arrays.js`，沿用真实 Standalone Core / v4 导出快照和隔离的持久化 CAS mock；包含归档消息、手动事实、章节摘要、Draft/Generation。先在原 v1.3.4 验证首个反例为 `Missing expected exception: validator let sessions[0].archivedBranches disappear`；修改后全部新增坏字段与类型反例拒绝、报完整字段路径，两个导入入口都不会修改 canonical 或 runtime。增加合法空值、v4 全量往返、合法 v2/v3、模拟中断与 CAS 冲突断言。

因新增 v4 合法结构校验，`tests/smoke-v1.3.3-backup-integrity.js` 的历史 *手工精简 fixture* 补全了 `versions`、Session 的持久数组与对象；原测试目的和全部负例未删减、生产逻辑未放宽。

随包测试共 23 条 Smoke；不调用付费 API，不触碰真实用户 IndexedDB 数据。

## 四、冻结与未实测

没有改动 Legacy Quarantine、Novel Memory 继承与核查、世界书时序、小说正文/草稿/Generation 主流程、RP 消息生命周期、CSS/字体/主题、API/SSE、Provider、CAS 逻辑。

**尚未实测**：真实浏览器 IndexedDB 多标签并发、真实用户备份恢复、生产 API/HTTP/SSE、长文本长时间运行。离线 mock PASS 不代表它们已通过。建议部署前先导出有效备份，切勿清除浏览器站点数据；重要资料的正式上线仍建议做独立浏览器验收。
