# 第三轮最新状态（2026-10-12）

最新权威验收记录在 `THIRD-ROUND-REPORT-20261012.md`。本文件下方为**前一轮历史快照**，部分条目（如 full SHA 未取得）已在本轮解决，不应覆盖新报告。正式 FULL PASS 仍 **NOT MET**：真实浏览器/Windows/官方世界书 golden parity/复杂插件/API 的验收仍未完成。

---

# 独立返工后 OPEN-GAPS（2026-10-11）

## 已源码修复并有离线证据（不是 Windows/浏览器 FULL PASS）
- P0-A：生产 prompt/display 正则由 `compat-regex-isolation.js` 分配独立 Worker，在配额到达时 terminate，不会在 UI 主线程同步执行外来替换。危险规则超时保留 raw、显式标记 E_REGEX_BUDGET。原公开同步 applyRegex API 仅允许受约束的字面量兼容子集。Node Worker 单测 PASS；真实浏览器 CSP/移动端未实测。
- P0-B：原 turnId + attemptId + journal 事务、刷新后未结算提示、原 turn 重试/用户终止/旧结果 fencing。老版本无 attemptId 的 pending journal 可以显式恢复；恢复前不自动清空标志。Node 假 IDB 回放 PASS；真实 IDB 崩溃恢复/Provider 迟到未实测。
- P0-C：失败和终止用户消息保留，但不作为 committed prompt history；旧版已误提交的用户消息由 journal 覆写投影、不会删除原文。两轮 mock Provider PASS。
- R1：可撤销 session mount graph，外部资源 SHA256 和 sourcePath 关联，跨标签 CAS 交由现有 IDB 事务；完整关系校验、封装 SHA256 备份、写前重复空库检查；外部世界书/regex 进入 resourcesFor。多库没有原子提交，双库恢复并未实现。
- R2：识别 CC 书的 after_char 与 extensions.position=1，以及 in_chat depth/role（position=4）；两版王爱英真实 PNG 分别复核“普通输入 4 条常驻，关键词 4+1”。这只是本引擎样本回归，**不是** ST 官方 golden parity；不支持的递归、概率、分组等仍明确显示 gap。
- R3：媒体从已保存的 CHARX 原始 ZIP 校验 SHA256/CRC 后生成用户手势下的音频/图片 Blob URL；静态 CSS/HTML 仍受限。变量 checkpoint/MVU 完整支持未实现。
- R4：隔离的第三方 SDK 脚本移入 disposable Worker，长时间循环可真正 terminate；支持 getChatMessages, getVariables, setVariables, uiButton 和受限 `events.subscribe`（session.mounted/turn.committed/turn.failed/button）及 unsubscribe。media.control 不再作为“可授权但实际会报错”的能力展示。**这不是 Tavern Helper API 兼容**；真实浏览器 iframe CSP 和多来源第三方插件未实测。

## 尚未通过发布闸门
- P0：Chromium/Playwright 被当前执行环境的 `ERR_BLOCKED_BY_ADMINISTRATOR` 阻止对任何 URL（含 file/data/loopback）的导航；**没有**原生 IndexedDB、跨标签、多源 iframe/CSP 的真实 E2E。离线假 IDB 不可替代。
- P1 R2：官方 ST 1.19.0 golden activation trace、复杂 recursion/group/sticky/random/budget 精确匹配、模型真实 payload parity 未实测；不可勾选接受差异冒充。
- P1 R3：动态状态栏、ST regex 全标志、MVU 完整引擎、编辑/分支/变量 checkpoint 不全；音频 autoplay 的手机行为未实测。
- P1 R4：实际第三方 Tavern Helper/MVU/STscript 插件完整 API 行为未达到 L4；第三方原脚本碰 DOM/window 无法直接运行，需原版宿主。
- P1 R1：跨库原子恢复不可能；已提供数据校验但未提供可自动完成的双库 rollback/restore wizard；应坚持分段人工恢复。
- P1/R5：固定官方 full SHA 未取得（上游锁的 fullCommitSha 仍为 null，安装脚本只验 tag+可见 commit 前缀）；Windows Node/Git/中文空格路径、断网、端口、登录、第三方原版插件和真实模型未实测。

**建议**：代码交包可在完全独立测试目录测试；不要覆盖唯一生产目录，不要用此版进行长期唯一存档或宣称 R1–R5 完整官方兼容。


## 第四轮施工后的权威状态（2026-10-12）
P0-A/ P0-B 已离线修复回归，P1-C lease/fencing/自动 orphan rolling 恢复仅离线通过。后续发布闸门仍为 **PARTIAL / RELEASE BLOCKED**，见 `FOURTH-ROUND-REPORT-20261012.md` 和 `FOURTH-ROUND-ACCEPTANCE-MATRIX.md`。
