# R7 逐项验收矩阵（2026-10-12）

| 验收项目 | 结果 | 依据 / 限制 |
|---|---|---|
| P0 局部 rolling_part 确认不推进全局游标 | PASS（离线） | 60 消息，人工批准后 0/0；无摘要变化 |
| P0 续跑剩余滚动分片、最终合并才结算 | PASS（离线） | stable source + 已审核分片 reuse，最终 42 |
| P0 源消息 ID/索引/范围 hash | PASS（静态及离线） | checkpoint + 同一 IndexedDB 写事务验证 |
| P0 旧 attempt fencing / 实际双标签刷新 | PARTIAL | 原有 fencing 代码保留；无真实双标签测试 |
| P0 正常有来源引文的中文概括自动完成 | PASS（合成） | 入库的是原文摘录，不是未经证明的意译 |
| P0 不实主体、背叛、谋杀凭真引文绕过 | PASS（合成） | 仍为 needs_review，不覆写 core |
| P0 普通自由文本全面自动摘要 | PARTIAL | 没有来源约束时仍需人工审核 |
| P0 待审与 API 失败不同状态 | PASS（离线 + UI 源码） | needs_review 与 failed 分离 |
| P1 事实来源轮次范围 | PASS（离线） | 1–1 / 2–2；无 0–0 |
| P1 50/200/500 轮历史召回 | PASS（既有离线回归） | 完整 History 原样保留 |
| R1 PNG 检查→兼容聊天 | PASS（离线）/UNTESTED（实机） | 真实 PNG 双版本、mock 三轮、fake IDB |
| R2 世界书黄金 SillyTavern 对照 | UNTESTED | 仅本引擎固定样本 |
| R3 MVU/动态状态栏 | PARTIAL | 本轮未声称修复 |
| R4 Tavern Helper 官方完整兼容 | PARTIAL | SDK 工作仍不等于完整 TH |
| R5 Windows Sidecar | UNTESTED | 源码原样保留，未 Windows 执行 |
| 320/360/390/428px 44px 触控 | PASS（隔离 Chromium） | 静态 DOM + 实 CSS，不是整站 |
| 手机真实完整点击/刷新 | UNTESTED | Chromium 页面访问被管理员阻断 |
| Sidecar 地址错误/公网 HTTP 拒绝 | PASS（隔离 Chromium） | 127.0.0.1 提示，私网确认，公网 HTTP 拒绝 |
| 旧版 40 smoke | 34 PASS / 6 FAIL（本轮旧测试） | 详见原始日志，旧断言未改 |
| 新增两项 smoke | 2 PASS | 覆盖恢复和 10/50/200/500 合成摘要 |
| 73 JS 语法检查 | 73 PASS / 0 FAIL | Node --check |
| ZIP 文件一致与前驱回滚 | PASS | SHA256 清单，母体原字节备份 |
