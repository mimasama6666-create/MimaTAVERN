# 咪嘛馆 MimaTAVERN v1.3.6｜2026-10-09 最小返工施工与离线验收

## 范围与母体

- 唯一施工母体：`MimaTAVERN-main-v1.3.5-DURABLE-ARRAY-CONTRACT-FULL.zip`，SHA256 `51ef8b6a0178cf5979b66f4902f684b9a45f126cc17bb41f83c0f57283343992`。
- 依据：文件库《MimaTAVERN_v1.3.5_独立验收与最小返工单_20261009.md》。仅处理 P0（损坏的人工剧情记忆覆盖字段被导入抹除）及 P1（真实早期 v4 备份被误拒）。
- 生产文件只修改 `local-store.js`、`standalone-core.js`、`index.html`。无 MIMAMAO、QQBot 代码。未删除旧源码及文档，不调整 CSS/RP/续写/API/Provider/Prompt 语义。

## P0｜成熟叙事状态的 manualOverrides 缺失误判合法

第一个非法状态：`local-store.js::validateLibrary()` 的 `validateNarrative` 允许省略 `manualOverrides`，即使 `narrativeState` 已具备 `storyOverview`、`characterStates`、`sourceChapterRevisions` 等内存引擎成熟结构。随后 `normalizeState/seedForRebuild` 将缺失值视为 `{}`，人工修改事实不可逆地丢失。CAS 只确保版本次序，不能识别损坏来源。

修复：根据**叙事状态对象本身**是否存在成熟结构字段决定 `manualOverrides` 是否必需；新建项目合法的 `{}` 继续接受。一旦属于成熟叙事状态，缺字段/错误类型即拒绝；手动 patch 的字符串、字符串数组、人物/关系对象数组增加类型校验。允许合法空手动覆盖 `{}`，不会强制填入假事实。两种导入入口都使用同一个校验器。

已验证：v1.3.5 原母体对“先用真实路由生成手写剧情记忆→真实导出→仅删除 `manualOverrides`”的反例 RED（没有抛出异常）；修改后 GREEN。`MimaLocalStore.validateLibrary`、`MimaLocalStore.importAll`、`MimaStandalone.importLibrary` 都拒绝损坏的完整备份。模拟 canonical 与 Runtime 逐字段不变；模拟写入中断仍不覆盖已保存资料。去掉新备份标志也不能绕过成熟态校验。

## P1｜同为 schemaVersion=4，发布版本内部字段不同

实际在原版 v1.3.1、v1.3.2、v1.3.3 的 JS Runtime 里通过会话创建、TXT 导入、人工剧情记忆 PATCH 和 `MimaStandalone.exportLibrary()` 生成 JSON fixtures。不是凭空猜测版本结构：

| 发布版本 | `storeRevision` | Novel `recordRevision` | Chapter `memoryDelta` | Project `legacyNarrativeCheckpoint` |
| --- | --- | --- | --- | --- |
| v1.3.1 | 不存在 | 不存在 | 不存在 | 不存在 |
| v1.3.2 | 存在 | 存在 | 存在（可为 null） | 不存在 |
| v1.3.3 | 存在 | 存在 | 存在（可为 null） | 存在（可为 null） |

修复：为 **今后的完整 Core 导出** 增加与 `schemaVersion` 独立的 `backupContractRevision: 1`；现代有标志的快照仍要求完整字段，未知标志拒绝。对旧版未标志文件，仅识别上述真实的版本结构组合；不允许一个后来版本仅靠删除一处新字段就伪装成旧版。v1.3.1 真实缺失的 `memoryDelta` 在导入后按原 `normalizeChapter` 迁移为 null；v1.3.2 真实缺失的 checkpoint 按原 `normalizeProject` 生命周期迁移；v1.3.3 继续完整保留。校验未通过绝不自动尝试静默低版本 fallback。

`MimaLocalStore.importAll` 作为旧入口保留：在 Core 已加载时委托其正常化+CAS 导入，防止低层浅复制把旧记录永久写成半迁移 v4。Core 尚不可用且遇到旧版时明确拒绝、不触碰数据库。`exportAll` 先校验原始数据；只对真正满足新契约的快照打修订标志，已验证的旧形态原样导出，不伪造新契约。

## 离线验收和边界

- 24/24 个随包 `tests/smoke*.js` 逐项执行 PASS（原有 23/23 + 新增 v1.3.6 回归 1 项）。
- 37/37 个 JavaScript 文件通过 `node --check`；HTML 内 14/14 个静态引用存在。
- 新专项：真实路由写手动记忆、坏备份两个入口拒绝、CAS/写入失败恢复、合法空叙事、合法空覆盖、真实 v1.3.1/v1.3.2/v1.3.3 导出→迁移→再导出、会话消息/全文/章节/手写剧情事实不丢。
- 仅调整 3 项历史离线测试数据适配：人工构造的旧记忆成熟状态补合法 `manualOverrides:{}`；模拟 v2/v3 历史备份时去掉这些版本本来不可能出现的新导出标志。不为了测试修改正确业务判断。
- **未实测**：真实用户浏览器 IndexedDB、多标签并发、真实用户资料库备份恢复、真实 API/SSE/Provider、Windows 环境和长跑性能。离线 PASS 不等于全面实机验收。

建议：用户真实珍贵数据恢复操作之前，额外保存离线原版备份，并由独立监工验收新的完整包。不要清除浏览器站点数据。
