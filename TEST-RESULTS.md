# R1–R5 返工测试结果

| 测试层 | 结果 | 证据 |
|---|---|---|
| 源码字节基线 | PASS | v1.4.0 的 79 个原文件齐全，仅 index.html 不同 |
| Node 语法 | PASS | 58 个 .js 文件均通过 node --check |
| 原有 29 组 smoke | PASS | 29/29 |
| 新增 4 组回归 | PASS | 4/4，包含 mock turn、恶意正则/插件 Worker、哈希/FK、私有双版 PNG |
| 实际 PNG | PARTIAL | chara+ccv3 读取；输入“你好”4 条常驻，输入“偷看手机”5 条；非官方 ST golden |
| 模拟 Provider 两轮 | PASS (mock) | first failed，不进入 second payload；原 turn retry/abort/stale fencing |
| 真实 Browser/IndexedDB/CSP | UNTESTED | Playwright ERR_BLOCKED_BY_ADMINISTRATOR 阻断本地所有页面 |
| Windows Sidecar | UNTESTED | 当前运行环境没有 Windows/PowerShell；full commit 未固定 |
| 真实模型完整生成 | UNTESTED | 未使用用户 API/密钥，不消耗模型 Token |
| 官方 ST 1.19.0 golden parity | UNTESTED | 没有官方宿主可比对 |

运行全部测试：从解压后源码目录执行 `node tests/smoke-*.js`（Unix shell 展开为逐个运行）。单独的真实 PNG 检查须手动指定 `MIMA_PRIVATE_PNG=<本地原卡绝对路径>` 后运行 `node tests/smoke-compat-rework-real-png.js`。主安装包不会包含此私有样本。

完整逐文件结果、Node 版本、哈希及未测场景见 `REWORK-TEST-LOG.txt`。
