# 咪嘛馆 R1–R5 第六轮统一施工 — 根因、影响面与验收

**母体**：`咪嘛馆_R1-R5_第五轮根因续修_完整源码包_20261012.zip`，SHA256 `10bcc3b99e8899ddc04fc6171e7328ad7b0a19ed74e4892bf74a93767029ceee`。仅对该母体施工，未重做。未修改 MIMAMAO/QQBOT。

**发布状态：PARTIAL / NO-GO**。当前能证明离线部分链路运转，尚无法证明普通手机用户端到端全通。

## 源码与根因

- P0 记忆：第五轮对纯文本及抽象重述采取源证据限制，但候选无实际人工落点。现在 `standalone-core.js` 将候选输出保留成可阅读的总结文本，`local-store.js` 持久化任务保存来源指纹及目标基线，`reviewMemoryCandidate` 在 IDB 同一事务内复核来源和目标 CAS。`app.js` 显示可编辑候选、原始消息与角色来源、确认/驳回。正常抽取式摘要可自动入库，其他可人工确认；防止传闻被当成既成事实、历史版本被新候选覆盖。不提供无证据自动提取虚构事实的后门。
- Prompt 权限：以前不可信卡片/世界书被直接拼接进 `system`，现 `standalone-core.js` / `compat-runtime.js` 将低信任内容作为带来源标签的 `user` 数据块与真正系统规则分离，保存完整数据用于模型，但不赋予最高指令权限。安全规则只能降低提示注入风险，不能保证任意模型不跟随卡文本指令。
- 原生 PNG 检查与兼容运行之间曾完全分离。`app.js` 增加同文件对象导入；`compat-ui.js` 的“开始聊天”可在本次点击原子保存 SHA 来源，选择真实资源 ID 和开场白、创建独立剧情，不要求先按技术性的“保存原始卡片”。保留原始卡字节和多个版本，默认推荐 `ccv3`；原生导入仍保留。回复和 turn journal 由既有 `compat-runtime` 提交。
- 手机顶栏以前四个纯图标难懂，两处设置重叠。`index.html`、`ux-r6.js`、`ux-r6.css` 改为有中文字的剧情/功能/设置，以及可读功能列表；旧角色设置、小说、助手、世界书等函数仍保留。高级资源详情折叠到“查看…”；开局前不强制用户勾选没有解释的兼容复选框，只在本轮明确提示实际触发与未适配项目。未获授权的 JS 不自动运行。

## 历史能力与变更面

第五轮母体文件 `162` 项全部保留；不变 `156`、修改 `6`、新增施工与测试文件 `4`、删除 **0**。原生 History/Persona/Memory/Worldbook 未删除；没有关闭后台任务或隐藏原失败状态。详细路径 SHA 与 diff 见随包两个对照文件。由于未实测所有真实 UI，不能宣称无任何行为回归。

## 实际执行证据

- `MIMA_PRIVATE_PNG=<用户拥有的真实文件路径> node tests/smoke-sixth-compat-end-to-end-fake-idb.js`：真实王爱英 PNG `chara`/`ccv3` 解析、SHA 导入去重、选 CCV3、模型 payload 中世界书触发，**3 轮** mock Provider、committed journal、模块重载后重读消息、外置世界书挂载/撤销、快照来源关系验证：PASS。测试使用独立 IndexedDB 替身，非浏览器真 IndexedDB。
- `node tests/smoke-sixth-r6-memory.js`：传闻拒绝自动入库、可编辑人工审核、核心/事实/滚动提交、CAS 人工修改竞态拒绝、滚动覆盖边界、下轮 Prompt 低信任注入：PASS。
- 全部 40 项 smoke：**36 PASS / 4 FAIL / 0 SKIP / 0 TIMEOUT**。失败：`smoke-compat-r1-r5.js`（旧世界书 system 提权断言）；`smoke-third-memory-journal.js`、`smoke-v1.3.9-memory-facts.js`、`smoke-v1.3.9-png-memory.js`（未证实纯文本候选自动入库断言）。没有修改旧测试、没有吞失败。原始日志已提供。
- **70/70 个 JS 文件**经 `node --check` 无语法错误。这不证明浏览器 JS 的真实交互可用。
- Chromium `page.set_content` 的**隔离 UI**：320/360/375/390/428/768/1024px，无页面级水平溢出；功能菜单点击打开、Escape 关闭；开局按钮 44px 高，返回按钮宽 >=44px。截图只代表静态页面及独立菜单，不代表完整程序。
- Playwright 对 `http://127.0.0.1:8899/index.html` 尝试真实导航：`ERR_BLOCKED_BY_ADMINISTRATOR`，没有进入实际应用。**真实 IndexedDB/刷新/跨标签/真实 Provider/移动 Safari/Android Chrome/Windows 均未实测**。

## 仍未完成

参见 `SIXTH-ROUND-OPEN-GAPS.md`。R2 官方世界书黄金结果、复杂嵌套递归、R3 动态状态栏/MVU、R4 第三方完整 Tavern Helper、R5 官方宿主与跨端、双数据库原子迁移继续维持 `UNTESTED` 或 `PARTIAL`。手机玩家基本聊天不依赖 Windows；不能宣称任意酒馆插件可在手机浏览器原样运行。

## 回滚安全

交付另附**字节等同第五轮原始 ZIP**，恢复静态源码前先复制当前目录和浏览器资料，不在回滚时清空任何 IndexedDB；不覆盖真实用户记录。安装包不包含真实 PNG 文件、API Key 或用户 History。
