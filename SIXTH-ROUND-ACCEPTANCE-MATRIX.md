# 第六轮功能验收矩阵（不是功能全绿表）

| 场景 | 方法和证据 | 结论 |
|---|---|---|
| M1 传闻不升级事实 | smoke-sixth-r6-memory：谣言候选不自动写 Store | 离线 PASS |
| M2 准确记忆人工确认 | 候选+来源→审核→CAS→Prompt，含核心/事实/滚动 | 离线 PASS，真人可用性未测 |
| M2 自动跨多消息自然摘要 | 完整含事实判断的意译多数仍待人工审阅 | PARTIAL |
| M3 原生记忆无 system 提权 | smoke-sixth-r6-memory 实际 message roles | 离线 PASS，Provider 行为未测 |
| M4 重复 core/手动修改竞争 | 第五轮与第六轮记忆 smoke | 离线 PASS |
| M4 断电刷新/多标签 IDB | 当前浏览器页面无法导航 | UNTESTED |
| M5 50/200/500 轮预算和旧剧情召回 | 第五轮反例/旧 smoke | 离线 PASS，真实召回质量未测 |
| R1 多版本真实 PNG | 真实用户 PNG 识别 chara + ccv3、保留字节 | 离线 PASS |
| R1 单步保存/创建/三轮剧情 | 真实 parser+store+runtime，fake IDB / mock Provider | 离线 PASS；UI 点击与真实 Provider UNTESTED |
| R1 原生 PNG 检查→兼容模式同文件 | 真实生产 DOM 回调源码检查；未跑整站 UI | 静态 VERIFIED / E2E UNTESTED |
| R1 外部世界书挂载撤销 | 真 store/runtime fake IDB | 离线 PASS |
| R2 王爱英固定场景世界书 | 普通 4、关键词追加 1，本引擎规则 | 离线 PASS；官方黄金 UNTESTED |
| R2 官方 ST 复杂递归、概率、顺序 | 没有官方 trace | UNTESTED |
| R3 Regex Worker 与 display 分区 | 原有 worker smoke | 离线 PASS；浏览器 CSP UNTESTED |
| R3 动态状态栏、MVU 全能力 | 无相应全链路 | PARTIAL / NO-GO |
| R4 SDK 权限、第三方 Tavern Helper | 原 Worker 子集回归，完整插件未测 | PARTIAL |
| R5 手机自足+Windows 可选 | 源码不直接依赖 Windows Sidecar | STATIC PASS / mobile real UNTESTED |
| UX 顶栏菜单可用 | 孤立导航脚本 + Chromium set_content | isolated browser PASS |
| UX 320-1024px 无横向溢出 | Chromium set_content 7 widths | isolated browser PASS |
| UX 卡片导入开局三轮/刷新点击流 | 页面真实 goto 被管理员阻止 | UNTESTED |
| 原生保全/回滚 | 第五轮全文件 SHA 核验、0 删除 | 文件级 PASS；生产真实功能 NO-GO |
| 原 40 smoke | 36/40，4 个安全语义冲突的旧断言 | NOT ALL PASS |
| API/Windows/iOS Safari/Android Chrome | 环境与访问受限 | UNTESTED |

结论：**PARTIAL / NO-GO**，不允许把按钮存在、fake IndexedDB 或静态截图替代真实玩家流程。
