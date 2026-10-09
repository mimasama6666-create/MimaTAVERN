# 咪嘛馆 v1.3.2 审计根因闭环施工交付报告

施工日期：2026-10-08

## 母体与边界

- 唯一源代码母体：`MimaTAVERN-main-v1.3.1-NOVEL-STUDIO-ROOT-FIX-FULL.zip`
- 母体 SHA-256：`5e5881b32987e814e78f756d88e51592344df03047bd7a23d515c08df0d587ef`
- 对照审计：`MimaTAVERN_v1.3.1_全面源码审计_20261008.md`
- 仅修改独立的 MimaTAVERN；未修改 MIMAMAO、QQBot；未接触用户浏览器实际资料库/API Key。
- 完整源码交付，保留原有入口、存储结构读取方式、字体库、预设、世界书、Safe HTML 与小说导入/归档。

## 本轮施工

1. **Canonical 数据安全 / 并发提交**：在 IndexedDB 的同一读写事务中实现 `storeRevision` compare-and-swap；拒绝旧标签页/旧异步任务盲写整库。读失败不是空数据库，冲突触发可见错误且从经验证的现有库重新加载；已有记录增加 `recordRevision` 守卫。
2. **小说总结覆盖正文**：章节异步分析、全量剧情档案重建、生成和采纳等业务改用独立快照与版本校验；分析途中用户编辑、移动、删除后，迟到结果不能把旧小说整体写回。
3. **错误备份清库**：完整备份导入前先检查格式、必要集合、ID 唯一性、章节/草稿引用；不合法数据拒绝，保留原库；整体状态提交采用数据库 CAS。完整设置恢复在数据导入前校验备份，并对非数据库部分执行尽力回滚。
4. **RP 会话删除复活**：更新既有 session 默认禁止 create-on-save；旧请求不能在删除后重新创建。
5. **章节合并保全**：相邻章节合并时迁移原章 Draft/Generation 记录、记住原输入来源并标识 `requiresRebase`，未经重写禁止把失效草稿直接采纳；若当前选中被合并的下一章则指向合并章。
6. **事实来源与剧透边界**：每章保存分析 `memoryDelta`，全局剧情事实按有效章及其 `sourceRevision/sourceHash` 推导；不再无条件 union 已过时的事实；世界书关键词扫描与情节状态仅截至 active chapter，保留独立人工 override。
7. **模型终止语义**：传递 OpenAI-compatible / SSE 的 `finish_reason`，遇 `length`、`content_filter`、`tool_calls` 等不把草稿错误标成 Ready；每次最低字数目标统一传到 Prompt 组装、生成记录、补写判定和错误说明。
8. **CSS 主题与阅读 UX**：内置样式纳入 `mima-builtins` cascade layer，解除 E-Ink 的常规 `!important` 冲突，保留 `.hidden` / 遮罩等必要强制行为；自定义 scoped CSS 优先用浏览器 CSSOM 解析、正确拆分复杂选择器并阻止导入规则跨域注入；手机小说阅读页按“章节 / 正文 / 剧情档案 / 设置”分视图，增加章节搜索与快捷切换；折叠记录状态保留，避免非编辑操作误覆盖未保存的正文。

## 本轮测试

- 既有 17 个 Node smoke：PASS。
- 新增 `tests/smoke-v1.3.2-root-closure.js`：PASS，覆盖非法备份、分析与编辑逆序交付、过时事实撤销、未来章节世界书过滤、合并 Draft/Generation 保全、最低字数、`finish_reason:'length'`、RP 删除请求逆序和修订冲突。
- 所有根目录 JS 源文件语法检查：PASS。
- `style.css` 基础 CSS 解析：PASS（`tinycss2`）。
- 以上 **18/18** 是本地确定性回归；不是接通实际模型/浏览器多标签后的最终验收。

## 尚未实测、未宣称彻底修复的部分

- 真实中转站与真实 HTTP/SSE 网络链路的“传输已中断”：缺少真实响应日志，不可声称彻底解决。
- 真正的 Chromium/Firefox/Safari 多标签页并发 IndexedDB、断电/磁盘满额场景：代码有原子 CAS，但浏览器测试运行环境超时，尚未实测。**故不将不安全的浏览器写入测试交付**。
- CSS 实际视觉叠加、第三方极端 CSS、CSSOM 对 `@font-face/@keyframes` 全局命名空间的隔离：已有基础防护，但并非完整第三方 CSS 沙箱。
- 完整设置备份中字体等外部资产不与 IndexedDB 处于同一跨存储事务；导入字体可能留下已新增加的安全副本，但绝不会用坏 library 清空原库。需后续专项浏览器验收与原子化设计。
- 长篇数据库按原文/章节/草稿物理分层、长期性能采样、完整 CSS Inspector 等中长期设计不属于这轮根因修复；不能据此宣称全部性能/主题建议完成。

## 安装 / 测试

1. 先在原版咪嘛馆中导出完整资料备份（敏感 API Key 选项默认不要开启）。
2. 在与原版相同的站点来源上替换 **完整文件目录**，不要单独覆盖某一 JS/CSS（存在脚本缓存版本和依赖同步）。新目录无需覆盖浏览器 IndexedDB；不要清理网站数据。
3. 重新打开网页。遇到 `E_CANONICAL_CONFLICT`，先刷新页面取回最新资料，不要用旧标签页连续保存旧内容。
4. 本地 Node 环境可在源码根目录执行 `for f in tests/smoke*.js; do node "$f" || exit 1; done`（bash）；在 Windows 可逐条 `node tests/xxx.js` 或用 PowerShell 遍历执行。
5. 推荐实际回归顺序：非法备份拒绝 → 两标签页交错编辑 → 总结时改章 → 合并草稿归档 → 第一章世界书防剧透 → 真实中转站 SSE → CSS 四主题和自定义全局 CSS → 手机多章阅读。

验收约束：本次对 root-cause 的源码治理及 deterministic 回归结果作陈述；未在用户真实数据、实际 API 和完整浏览器场景中验收，不宣称“彻底修复所有问题”。
