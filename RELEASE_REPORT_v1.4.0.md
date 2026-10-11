# 咪嘛馆 v1.4.0：主题美化与 PNG 完整资源检查

基线：2026-10-11 已交付 `MimaTAVERN-main-v1.3.9-PNG-CARDS-MEMORY-LIFECYCLE-FULL-NO-DATA.zip`。本包保留 v1.3.9 记忆修复及 v1.3.7 主题覆盖与原始所有功能。

## 功能

- 保留原始 PNG 角色卡导入入口；额外新增「设置 → 📦 PNG 资源」。新入口只读解析所有 PNG tEXt/zTXt/iTXt 元数据，显示每个文本块与角色卡完整解码 JSON。
- 对已验证 V2/V3 `character_book` 与合规字段，转换到现有世界书资源库；`system_prompt` / `post_history_instructions` 转为独立预设；兼容字段名的 CSS 保存为聊天范围 CSS 预设；状态栏文本提示词可转换为格式预设。
- 勾选后保存到资源库，可选「同时挂载当前剧情」，默认关闭；不会覆盖旧项目。CSS 不会全局生效，非当前剧情脚本也不执行。
- 单独导出每项原始 JSON / 完整解码报告。未知字段、外部正则脚本、不可等价转换的世界书字段仅检查导出；避免错误行为或空导入。
- Sakura Milk 与 Lilac Cloud 新调色；新增 Aqua Sky 水色、Material Snow 谷歌系统感、Fluent Blue 微软系统感。后两者是独立创作的视觉风格，不附带商标或第三方素材。

## 安全边界

- PNG 文件上限 20MiB，解压文本上限 4MiB，文本块最多 256，区块 CRC / 完整 PNG 结束校验。损坏 V3 不回退 V2；无合法角色数据不创建假角色。
- 文本显示使用 `textContent`，不会在检查界面执行 PNG 中 HTML、脚本或 CSS；输入图片不发送远端。
- 转换世界书不能默默改变高级激活语义：独立预算、递归扫描、特殊注入槽、概率和未知专有扩展均阻止自动转换，并保留原始文本。
- 导入属于多次独立 Store 事务，非全部原子提交。单项保存失败立即停止，已成功保存项目不会回滚，界面明确说明部分成功情况；挂载集中在读取最新剧情之后进行一次 PATCH，且在切换剧情时阻止挂载。
- 不写入或修改 History、Memory、Novel Project、已有 Persona。没有更新 schemaVersion，不清理旧版数据。

## 验收状态

- 28/28 JavaScript 离线测试 PASS（含 v1.4.0 PNG 完整元数据、世界书语义筛查、正则隔离、实际 Standalone 资源保存路由与剧情挂载）。
- 17/17 页面 JS/CSS 静态资源路径存在；两份 CSS 使用 tinycss2 检查，顶层解析错误 0；核心脚本 `node --check` 通过。
- 真实 Chromium 导航受到运行环境管理员策略拦截，**未完成 Windows 实机和浏览器鼠标点击验收**。
- 没有用户实际酒馆 PNG 样本，复杂第三方扩展的兼容覆盖范围未经真实卡片验证；真实世界书可能因专有扩展被标为「仅查看」。

## 安装/回滚

1. 在 v1.3.9 内先使用 Data 备份导出所有重要存档，并单独留存 v1.3.9 原版文件。
2. 覆盖原程序静态文件；新增 `png-resource-inspector.js` 必须与 `index.html`、`png-card-import.js`、`app.js`、`style.css`、`theme-skin.css`、`theme-engine.js` 同目录，避免单独覆盖一个 JS 造成 404。
3. 不要清浏览器站点数据/IndexedDB；保持原站点 origin（协议/域名/端口）。刷新页面查看 `设置 → PNG 资源`。
4. 如果布局/脚本异常，用备份的 v1.3.9 静态文件覆盖回退，不替换 IndexedDB，不导入或删除历史存档。
