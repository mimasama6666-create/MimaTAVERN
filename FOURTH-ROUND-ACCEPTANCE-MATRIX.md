# 第四轮独立验收矩阵｜2026-10-12

状态分级：**OFFLINE PASS**=真实代码+本地 fake IDB/Provider 测试；**STATIC PASS**=源码/语法已检查；**UNTESTED**=没有真实端到端证据；**GAP**=功能未实现/未等价；**RELEASE BLOCKED**=禁止宣布完全修复。

| 闸门 | 状态 | 证据 / 缺口 |
|---|---|---|
| P0-A 50/200/500 轮 backlog 预算 | OFFLINE PASS | Fourth smoke；源 ID、漏检和 prompt 上界 |
| P0-A 保留历史、保留 Persona/Memory | OFFLINE PASS | 原始消息长度断言，基线超预算明确报错 |
| P0-A 真实窗口准确性/召回评估 | UNTESTED | 本地估算不是 Provider tokenizer；语义评估缺失 |
| P0-B 核心记忆拒绝污染 | OFFLINE PASS | core 的拒绝/合法引文/无来源引文，原文保留 |
| P0-B 事实记忆拒绝污染 | OFFLINE PASS | facts 拒绝候选不提交 |
| P0-B rolling 拒绝污染 | OFFLINE PASS | rolling 候选不提交、旧存档不删 |
| P0-B 历史 checkpoint 污染重复利用 | OFFLINE PASS | old _received 拒绝内容再次校验 |
| P1-C live lease & expired takeover | OFFLINE PASS | stable ID / new attempt / fencing |
| P1-C 真实刷新/关闭标签/多标签事务 | UNTESTED | 尚无成功 Chromium 真实 IDB 页面证据 |
| 第二/三轮 36 组旧 smoke | OFFLINE PASS | 原版 36/36；新增1组成 37/37 |
| 62 个 JS 语法 | STATIC PASS | node --check 62/62 |
| R1 原生/兼容双库备份恢复 | GAP/UNTESTED | 两库原子提交及浏览器验证未闭环 |
| R2 官方世界书黄金 trace | GAP/UNTESTED | 真实 PNG 本引擎基础回归不等于官方匹配 |
| R3 MVU/动态状态栏 | GAP | 非完整功能 |
| R4 第三方 Tavern Helper | GAP/UNTESTED | 受限 SDK 不冒充完整 API |
| R5 Windows 官方宿主 | UNTESTED | 真正 Windows Node/Git/登录/网络未跑 |

**综合：PARTIAL / RELEASE BLOCKED。**
