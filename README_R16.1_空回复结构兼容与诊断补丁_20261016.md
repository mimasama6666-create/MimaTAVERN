# 咪嘛馆 R16.1 · 空回复解析缺陷精准补丁（2026-10-16）

本包以文件库中 `咪嘛馆_R16.1_模拟交互修复_完整覆盖包.zip` 为唯一母体。**这是一个已复现解析缺陷的修复和空响应诊断增强包，不代表使用者当前中转的所有空回复已经修好。** 不包含用户存档、密钥和配置。完整覆盖网页同级文件，不清空 IndexedDB / localStorage；另附精准回滚包。

## 三张现场截图已经确认的事实

- 一条普通发送为 `finishKind=blocked / finishReason=content_filter / receivedChars=0`，属于收到上游内容拦截终止信号；不能归为咪嘛馆本地请求前阻断。
- 两次续写均为 HTTP 200、`finishReason=stop`、`messageShape=[role,content]`、可见字数 0；请求体约 359858 bytes、23 条消息。**仅有字段名，无法知道 `content` 是 null、空字符串、含 parts 的对象，还是其它类型。** 不能由 `stop` 证明有正文，也不能由 HTTP 200 证明业务成功。
- 当前 `assistant_tail` 续写会让消息以真实 assistant 收尾。当前 Prompt 组装器会发多条 system 消息、允许世界书在历史中途 system 插入。对于 Gemini 的 OpenAI 中转格式，属于需要对端点实际验证的兼容风险；不可据此认领三次现场的唯一根因。

## 已证缺陷与精准修改

1. `standalone-core.js/contentPiece` 在旧版遇到 `choices[0].message.content={parts:[{text:'有效正文'}]}` 会丢失正文、报 `E_API_EMPTY_REPLY`；本补丁支持可识别的嵌套 `parts[].text` / `content`，但不将标注 `thought:true` 或 `type:reasoning/thinking` 的思考片段当剧情。
2. 同一错误的诊断增加**仅结构元数据**：`responseContentKind / responseContentKeys / responsePartCount / responsePartTypes / completionTokens / thinkingTokens`，不保存私有思考或完整响应正文。不变更原始请求、API 路由、模型、参数、发言 role、Store、History、Memory、世界书与正规正文准入。
3. `index.html` 仅为该脚本的 URL 添加缓存版本标记，避免浏览器重用旧 JS。增加隔离模拟用例。

## 检验边界

- `node --check standalone-core.js` PASS。
- `tests/smoke-r16-content-parts-compat.js` PASS：普通字符、OpenAI 文本块、Gemini 嵌套文本、thought 隔离、空返回、拒绝。
- `tests/smoke-third-api-diagnostics.js` PASS：状态/拒绝/空回复、明确截断、网络失败。
- `tests/smoke-r11-1-refusal-admission.js` PASS：原生请求拒绝、恢复及版本保护。
- `tests/smoke-compat-rework-turn.js` PASS：兼容生命周期、幂等与重试。
- 全部用假 HTTP 响应；**真实中转与 iOS 未实测，不能宣布成功率恢复。**

## 下一步要定位的具体证据

下一次已发生的空回复，重点看新增 `responseContentKind / responsePartCount / thinkingTokens`。`contentKind=null/string` 且实际长度 0 → 中转交付已空；`object`/`array` 但仍空 → 检查部件类型/未覆盖协议字段。再将同轮的最终消息 role 顺序、总长度、末尾角色、完整 URL（本地私查，不分享密钥）与当前 Gemini 中转协议文档对照，判断是否需要独立请求格式适配。现有日志仅保留 `messageShape`，无法倒推出 `content` 的具体值。不要通过删 Persona、History、世界书、自动换模型、自动重试来掩盖该问题。
