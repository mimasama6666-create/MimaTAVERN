# 咪嘛馆 R16 · 酒馆与高级插件适配 · 仅静态检查

此包接续 R14.2 / R15，包含坏回复手动恢复、正则保存修正、作者变量与 Prompt 通道，并增加下列高级插件基础能力。只修改咪嘛馆，不修改 MIMAMAO、QQBOT。

**本轮没有运行测试、浏览器、示例或模型。语法、依赖引用与源码静态检查不能证明手机交互、并发或任意原卡已验收；本包不宣称完整 SillyTavern / Tavern Helper 等价。**

## 安装与入口

ZIP 根目录就是完整咪嘛馆程序。覆盖原部署目录并重新加载，不需要安装依赖、运行构建或清空浏览器数据。

- 进入故事 → 正则与外观 →「导入 JSON 资源」：可导入正则、世界书、预设、Quick Reply v2 和独立作者脚本导出。导入脚本不会执行。
- 同一工具页的「快捷回复」：按当前故事开启按钮组；按钮显示在输入框上方，发送、填入和脚本运行有不同标签。
- 「作者交互与高级依赖」：选择本故事权限、固定离线库和普通脚本 / ES module，明确授权后启动。旧 Worker / 可视化权限不自动升级。

## 已写入的适配

| 范围 | 这版代码提供的行为 |
| --- | --- |
| 离线库 | 真实 jQuery 3.7.1、lodash 4.17.21、Vue 3.5.13、Zod 4.4.3；不使用同名简化实现 |
| 模块脚本 | 浏览器原生 import map + Blob 模块；名称为 `jquery`、`lodash`、`vue`、`zod`、`zod/v4`；支持顶层 await |
| 三类变量 | 保留 chat / message / script 快照、原子提交与回执；新增 `insertOrAssignVariables`、`insertVariables`、`deleteVariable`，辅助函数使用真实 lodash，数组按固定上游规则替换 |
| 事件监听 | `eventOn` / `eventOnce` / first / last / stop / remove / clear；同一监听函数去重，关闭作者页面卸载 |
| 消息事件 | 由已提交消息的稳定 ID 与正文差异产生 MESSAGE_SENT / RECEIVED / UPDATED / GENERATION_ENDED；发送、重试和续写结算后通知，预检和失败不伪造收到回复 |
| 自定义事件 | 明确授予 events.emit/listen 后，在当前浏览器标签页、同一故事的作者页面之间广播；Promise 等待监听器及变量回执，不跨故事、不伪造宿主事件 |
| Zod 管理器 | `registerVariableSchema(schema,{type:'chat'或'message'})` 创建可编辑 JSON 管理器；按真实 schema 校验、显示错误、收到回执才标记保存 |
| Quick Reply | 原生 v2 组/按钮 JSON、嵌入卡片与外置挂载；保留 disableSend / injectInput / placeBeforeInput；仅手动触发 |
| 命令按钮 | 斜杠按钮先通过现有 11 条 STscript 编译器；不支持的命令整条拒绝，不作为台词发给模型；脚本变量与故事状态同事务复核 |
| 草稿与生命周期 | 旧面板失效后不能继续填入；双击受会话忙状态保护；支持恢复填入前草稿；生成期间新输入不被成功回调清空 |

Zod 注册与上游一样用于变量管理器，**不自动拦截全部程序写入**；需要校验的脚本仍应显式调用 schema。脚本变量、STscript 变量与已有 MVU 事实没有偷换为同一个通道。R15 的变量宏只改变 Provider 请求副本，原卡、Persona、世界书和完整原始历史保留。

本版按固定上游源码补齐省略变量参数时的默认 `{type:'chat'}`，仍需本故事的 chat 权限；不会转为全局变量或自动授予任何权限。

明确勾选离线库后，`https://esm.sh/库名`、`https://esm.sh/库名@本地精确版本`、`https://cdn.jsdelivr.net/npm/库名/+esm` 及相应精确版本地址被映射到所选离线库；Zod 另有 v4 入口。授权弹窗会说明这项版本选择。不同版本、查询参数、其它域名或包不会被擅自替换或联网下载。

## 明确的兼容边界

- 仅上述模块名、固定版本和浏览器内 API；任意 CDN、Pinia、VueUse、任意 npm 包、外部素材依赖及酒馆后台/Node 扩展尚未装成通用运行环境。Zod 不包含 v3 / mini 入口。
- 全局/预设/角色/扩展变量、消息正文创建/改写/删除、swipes、完整 STscript 与 slash command 注册、自动 Quick Reply 钩子、上下文子菜单及原版完整 MVU 写入协议尚未适配。不提供同名空壳。
- 消息通知时机是咪嘛馆原子回合提交之后；不等同于酒馆每个生成/流式/DOM 渲染阶段。跨标签页实时作者事件尚未实现，重新启动或下一次预检会重新读取已提交快照。
- 跨作者广播期间不支持回调内再次广播，明确报 `E_AUTHOR_EVENT_REENTRANT`。多个作者争写同一变量表会明确冲突，不能把整场跨作者广播称为一个跨脚本原子事务；已收到回执的写入保留。
- 初次运行必须选择实际所需权限。旧的有效授权与新选择不同时，先撤销再授权，不静默扩大权限。
- 作者 DOM 仍是无 same-origin 的 opaque iframe，无宿主 DOM/存储/密钥/网络或模型权限。任意作者 JS 仍可能死循环；iframe 超时不能硬中止同线程卡顿。

初始化握手上限 12 秒，保存/事件握手 4 秒；这些只影响作者页面，不会重试或取消模型请求。作者失败和剧情提交分别报告，避免把已经保存的回复当成一次模型发送失败。

## 数据、来源与回退

作者写入保留 R15 的来源 SHA、授权修订、全部已读表修订、稳定消息 ID 和操作回执校验。fork / 备份保留已提交表，执行授权不自动继承；恢复导入的作者授权需重新授予。没有升级数据库版本。

依赖代码作为静态数据随包附带，Host 校验 SHA256 后才传给作者页面，主页面不执行依赖代码。Zod 82 个原始模块只做 TypeScript 静态去型和相对模块名重写，由浏览器处理真实模块循环与导出；构建过程没有运行库或产品代码。许可在 vendor/author-LICENSE-*.txt；版本与逐模块来源在 `R16_VENDOR_MANIFEST.json`。

固定对照：

- [Tavern Helper 4.11.3 API / 源码](https://github.com/N0VI028/JS-Slash-Runner/tree/a0f3a180344cff38a4b3e75041d5a94380b877d6)
- [SillyTavern Quick Reply 源码](https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/quick-reply)
- [Zod 4.4.3 源码](https://github.com/colinhacks/zod/tree/v4.4.3/packages/zod/src/v4)

`_R16_rollback/` 保存 R14.2 的被改程序文件。回退时覆盖回同级目录并重新加载；新增程序文件可以保留但旧 index 不引用它们。不要删除浏览器数据。需要重新使用新变量时再升级到本版。

examples/ 中的 R16 JSON 是可选中性示例，本轮没有执行；不需要导入它们才能升级。
