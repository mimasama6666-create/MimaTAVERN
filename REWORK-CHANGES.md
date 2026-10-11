# 返工差异登记

## 冻结和改动
- 唯一母体：20261011 R1–R5 完整交包，保留原已有能力与新增模块，不另立替代项目。
- 原生 v1.4.0 的 79 个文件字节对照仅首页 `index.html` 入口有差异；原生 `app.js`、`standalone-core.js`、`local-store.js`、角色、小说、主题均未修改。
- 改动：`index.html` 仅添加 Worker loader/cache bust；`compat-runtime.js` turn journal/regex isolation/World Info/mount/media；`compat-store.js` FK/signed snapshot/restore check；`compat-ui.js`恢复按钮、挂载、媒体与 race fencing；`compat-plugins.js` 宿主订阅事件；`plugin-frame.html` 从 iframe 同步执行改为 Worker 控制；`plugin-frame.js` 对齐 iframe 控制实现；`OPEN-GAPS.md` 更新真实状态。
- 新增：`compat-regex-isolation.js`、`compat-regex-worker.js`、`plugin-worker.js`、`plugin-frame-controller.js`、四组 rework smoke、交付报告；其他原模块保留。

## 禁止误用
- 不允许把有限 World Info 触发视为 ST 官方 1.19.0 黄金对照完成。
- 不允许把自定义 MimaCompatSDK 的运行当作 Tavern Helper 运行。
- 不允许把 Node 假 DB / Worker 结果当作 Chromium IDB/CSP 与 Windows 结果。
- 不允许把客户端两库快照视作原子分布式事务。
