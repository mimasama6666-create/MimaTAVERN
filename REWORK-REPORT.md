# 咪嘛馆 R1–R5 独立监工返工交付与验收报告

2026-10-11。**结论：离线补丁交付 / P0 源码级收口，但 R1–R5 FULL PASS 未达成，不建议覆盖唯一生产目录。**

## 1. 母体、范围和负优化

唯一当前母体 `咪嘛馆_R1-R5_酒馆兼容实验室_完整源码安装包_20261011.zip`，SHA256 `b6b69f28cc2fe8149c3a4a2f3016c45b44ccf1d8c8e1d8fe8fee31977dec2103`。原生 v1.4.0 79 文件逐字节对照：79/79 保留，78/79 内容完全一致，`index.html` 仅增加 compat 入口/loader；原生 `app.js`, `standalone-core.js`, `local-store.js`, PNG 导卡、CSS 主题、小说和助手未改。独立兼容库 `mimamao_tavern_compat_v1` 名称和 DB_VERSION=1 未改，不触碰 `mimamao_tavern_standalone`。

没有修改 MIMAMAO/QQBOT；无用户 API key、无实际卡包原始字节进入安装包。自带 private-PNG 测试脚本使用环境变量读取用户样本，不复制该样本到总包。所有源文件修改详见 `REWORK-CHANGES.md` 与 `REWORK-BASELINE-HASH.json`。

## 2. 根因与修改

### P0-A 正则运行
第一非法状态：`applyRegex` 将第三方 `findRegex` 直接放进 UI 主线程 RegExp.replace，`validRegex` 只能挡部分模式。新 `compat-regex-isolation.js` 将生产 prompt/display 的每次第三方替换送入独立 Worker，硬限输入 256 KiB、输出 512 KiB、最多 200 规则并限制执行预算；病理规则会 terminate Worker，主消息原文不变，并将 `E_REGEX_BUDGET` 暴露给检查器/消息显示。原同步调试兼容 API 仅允许明确受约束的字面量正则，避免被其他代码误用。World Info 正则关键字现在不在主线程求值：未能安全处理的表达式明确作为语义缺口，而不是隐式漏匹配。

### P0-B 重启后的 pending 回合
第一非法状态：原 `beginTurn` 在 DB 写 pending，完成权威却留在单次 JS 函数 try/catch；刷新令同一 turn 永久挂起。新状态机将 `turnId/attemptId/msgId/sessionRevision` 与 session.pendingTurnId 在同库事务关联；加载剧情时列出 pending/failed journal 和显式重试/终止，持久化输入保持原文。重复旧 attempt 返回受 fence 限制，不可写 assistant 结果。旧 job 缺 attemptId 时可用旧 turnId 显式恢复，写入新 attempt；不会清空 flag 冒充成功。重试可能导致上游重复生成和费用，UI 给出警告。

### P0-C Provider 失败污染上下文
第一非法状态：原 beginTurn 在模型成功前就将用户消息记为 `committed`。现在在同一事务先记 `pending`；成功时用户/助手/journal 一起 `committed`；失败时 user+job 转 `failed` 且保留原文，取消转 `aborted`。Prompt 只纳入已确认 committed 且有 journal 的记录。旧包中“失败 user 仍 committed”通过 journal 投影隔离，不能偷偷成为下一轮有效对话。

### R1 数据安全与跨来源挂载
新增 session mountGraph，外置世界书/regex/preset/CSS/媒体等按 resourceId/source SHA256/path/order CAS 挂载，撤销仅修改会话不删除原 capsule。Store 备份增加 v2 外层 SHA256 及完整 session/messages/journal/grants/variables/assets/projections FK；空库真实恢复入库前再在同一 readwrite tx 校验目标库仍为空。旧未签名备份只读预检，真实写入需明确旧格式风险。双库备份记录原生和兼容 SHA256，但不是原子提交，也未实现可证明安全的双库自动恢复。

### R2 World Info
解析 CCV3 的 `position:'after_char'` 与 extensions.position=1，支持常驻、关键词、禁用、顺序、有限预算，以及 position=4 的 in-chat depth/role 注入。真实王爱英 PNG 的 `chara` 和 `ccv3` 两版：普通聊天 4 条常驻；命中“偷看手机”额外 1 条 depth。原 13 条世界书并非全部激活：禁用 5、未命中 4，分别保留原因。不足之处：此处尚无官方 ST 1.19.0 黄金 trace，复杂递归/概率/组/粘滞/预算仍部分拒绝，其他提示词插槽和正则与官方语义有差距，**仅标 L2/L3 部分行为，不标黄金等价**。

### R3 展示和媒体
Display Regex 在隔离 Worker 执行，失败显示 raw 和告警，不把显示文本写回历史；prompt Regex 输出进入真实 Provider payload。CHARX 已索引媒体可手动从不可变 ZIP 中解压、CRC+SHA 校验后加载本地图片/音频 Blob URL，切换/关闭时释放。动态状态栏、MVU 完整变量和版本回退、正则的 ST 所有 replacement 语义未完成。

### R4 插件
原 iframe 主线程执行第三方 `new Function` 会与原生 UI 共享 renderer CPU。现在脚本代码只能作为 disposable Blob Worker 运行，由 opaque-origin sandbox iframe 与宿主通过 MessageChannel RPC 通信；worker 初始化/事件循环预算超限则 terminate；不授予 top/parent DOM。有限 SDK 实现 `getChatMessages/getVariables/setVariables/uiButton` 和明确名称的事件订阅/退订，事件在主 journal 已结算之后投递。不具备真实 `media.control` 的能力从授权选项移除，避免假成功。所有未适配第三方 Tavern Helper/STscript/MVU API 须选 R5 原版宿主，并非本 R4 已完成。多来源扩展用户界面及 CSP 动态实测受阻。

### R5 Windows sidecar
沿用原包 Windows Sidecar；本轮未改变它的安装/停止/进程所有权语义，未把未经验证的 full SHA 写进锁。官方 1.19.0 的 release 短前缀 `7e8663c` 已核查，40 位 commit 仍未能在当前受限联网容器确认，`fullCommitSha:null`。缺真实 Windows Node/Git、含中文空格路径、断网、端口、认证、第三方原版插件测试；R5 本轮 **UNTESTED**，不能发布 L5 PASS。

## 3. 实际测试证据

- Node v22.16.0，58 个 JS 文件静态语法校验 PASS。
- `tests/smoke-*.js`：**33/33 PASS**，其中此前 29 个原生/兼容 smoke 原样运行，全量新 smoke 4 个；真实 PNG 测试在 `MIMA_PRIVATE_PNG` 显式传入时运行（样本不随包发布）。日志位于 `REWORK-TEST-LOG.txt`。
- 病理正则 `a*a*a*a*a*a*a*a*a*a*b` × 28 a，Node 隔离 Worker 在 125ms 配额附近被终止；正常 regex `cat→dog` 可处理；不在 UI 主线程同步执行。
- Provider mock 流程：第 1 回合失败时 user=failed 且不进入下一轮 payload；第 2 回合完成；之后 pending→retry 原 turnId、旧结果拒绝、abort 及竞争 begin 回合 PASS。该回放使用自制事件事务 stub，**不是浏览器 IndexedDB 的证明**。
- 备份：外层 SHA256 篡改拒绝；缺失 session/授权引用拒绝；旧 hashless 备份显式未验证 PASS；真实浏览器恢复未测。
- 插件：Node Worker SDK RPC 和永不结束循环硬终止 PASS；浏览器 iframe/opaque origin/CSP 恶意导航动态测试未测。
- Playwright 的 Chromium 在当前环境对 `http://127.0.0.1`、`file://` 与 `data:` 页面全报 `ERR_BLOCKED_BY_ADMINISTRATOR`，因此真实 IDB 多标签、Worker 浏览器 CSP、移动端、真实 Provider 等均 **UNTESTED**。
- Windows 端 PowerShell 工具链不可用；未使用假 PowerShell 结果冒充真机。

## 4. 逐场景门槛（不以离线绿灯冒充完整）

| 编号 | 结果 | 证据/未覆盖点 |
|---|---|---|
| T01–T02 | 部分 PASS | 合成 PNG/JSON 双版本扫描；真实 PNG 两版确认；更广公共样本未测 |
| T03–T04 | 部分 PASS | ZIP/CHARX 路径和体积拒绝、真实资源索引；依赖安装未测 |
| T05–T06 | PARTIAL | 真实卡常驻和 in-chat 生效；ST 官方完整激活黄金对照缺失 |
| T07–T08 | PARTIAL | stable turn 重试与基础 prompt；复杂编辑/分支/宏/槽位未完成 |
| T09–T10 | PARTIAL | prompt/display 隔离与恶意 Worker 测试；全 ST regex parity 未证明 |
| T11–T12 | PARTIAL | Shadow DOM 静态 CSS、媒体；动态状态栏/变量 checkpoint 缺失 |
| T13–T16 | PARTIAL/UNTESTED | SDK RPC 与事件代码、Worker 离线验证；真实扩展可见行为及 iframe CSP 未实测 |
| T17–T18 | UNTESTED | Windows 原版 ST/Node/Git/端口/路径/插件运行未测试 |
| T19 | PARTIAL | FK/hash/空库事务检查；浏览器恢复、多库非原子和断电未实测 |
| T20 | 源码/Node PASS，浏览器 UNTESTED | 冻结 79 文件、旧 smoke 全绿；原生实机未测 |
| T21 | PARTIAL | 真实双版王爱英 13 世界书解析与 4/5 激活；9 正则、3 原脚本未完整重演 |
| T22–T23 | PARTIAL/UNTESTED | 合成多格式卡可读取；1000+ 世界书真实负载和第三方插件不足 |
| T24 | MOCK PASS，真机 UNTESTED | 模拟失败/中止/retry, 插件回调错误边界；浏览器未测 |
| T25 | 部分 PASS | 来源 SHA 复用旧测试、新 mount 撤销；真实 IDB 引用计数缺失 |
| T26 | UNTESTED | 跨普通/高级模式切换、重启及主题真实页面未测 |

## 5. 不能宣称已经完成的能力

Tavern Helper 的原生 DOM 及其他 API、ST 1.19.0 完整真实世界书语义、MVU/状态栏完整演出、R5 官方 sidecar 真实运行、浏览器 IDB/多标签的最终结算数据安全验收，均未满足。本版只能称为“持续保留原版功能的独立兼容返工测试版”，不是官方酒馆的无缝替代。

## 6. 交包/回滚

- 新包包含本母体全部源码、原有 29 smoke、额外 4 组回归、全部 Windows Sidecar、报告和资源文件；**不含任何用户存档、角色原 PNG 与私密 API Key**。
- 单独回滚包是本轮返工前 R1–R5 原完整母体的字节备份。回滚先备份当前所有浏览器资料，移动而非覆盖旧目录，按 `REWORK-README.md` 执行；新兼容库不会被回滚脚本清除。旧版本读取新格式不一定兼容，应将旧版和新版分开测试。

**发布意见**：此包供隔离测试与下一次监工继续施工；上线唯一生产实例仍需补实机验收及 R2/R3/R4/R5 门槛。
