# 咪嘛馆 R16.2 — 坏回复误拦、诊断证据丢失与错误面板越界

母体为上轮 `R16.1 空回复解析精准补丁` 的实际源码副本。此次改动为 5 个生产文件（standalone-core.js、compat-runtime.js、app.js、style.css、index.html 缓存版本串）和两项离线专项回归；保留其它原有文件、功能、Store、History、Persona 和世界书。

## 已复现的第一非法状态与因果链

1. `standalone-core.js:2197–2251` 的 `classifyStoryReply` 把一段模型文本的*开头关键词*当作发送者身份。“我不能继续参与这场角色扮演。她说完，把头套丢到了地上。”以及“很抱歉，我无法继续生成这部电影的对白。她转身，望向雨中的屏幕。”在旧版都会误报 `provider_plaintext_refusal`，尽管它们是连贯的剧情。`processStoryTurn:2359–2367` 将这一推断当成硬性准入，完整正文不能提交，错误以 `E_API_REFUSAL_CONTENT` 传播。修复：协议明确拒绝（如 `content_filter` 或 refusal 字段）继续绝对阻断；对文本启发式采用更严格的提供方技术归属证据，保留明显的场内叙事、普通角色拒绝和引用。并非所有语言及复杂边界已穷尽。
2. `standalone-core.js:395–403` 和 `compat-runtime.js:275,695` 原来会把*已经提交*的合法 assistant 历史根据同一个无上下文关键词过滤器从未来 Prompt 中直接剔除。即使浏览器存档仍有这条，模型也看不到，造成静默负优化。修复：不得以纯文本推断删除历史；只有独立验证的提供方拒绝终止标记写在该消息 metadata 中时才排除，玩家明确恢复过的回复继续保留。旧历史如果没有上述证据，不自动升级为“拒绝”，也不自动删改。
3. `standalone-core.js:2357–2367` 原来在 output regex 返回后将 `diagnosticCandidate` 改成处理后正文。若正则把完整提供方正文处理为空/坏文本，失败时没有原文供日志和手动恢复。修复：日志候选始终保留提供方原始正文，正则仍按既有输出规则工作，失败仍不写入剧情；用户可经原有确认恢复流程操作。保留后台记录截断上限和旧 attempt/Store 修订检查。
4. `index.html:77–99` 报错面板在 footer 中；`style.css:40,62,165,170` 使用 `grid-template-rows: ... max-content` 配合无高度限制的 `.generation-detail`。`app.js:1514` 原来将完整 details 直接展开，于是长文本使 footer 整体长过 viewport，关闭/重试/输入区可被挤出屏幕。修复：错误诊断全文可折叠查看，报错面板与 footer 均受 viewport 高度约束，详情单独滚动，关闭与操作区不跟着详情滚走。主题颜色不锁定。

## 竞争假设与证据

- 假设 A：“模型真正被上游拒绝”。成立条件是明确的 `finishReason=content_filter`、refusal 字段或 HTTP 的内容拦截正文；真实日志有这类例子，因此没有删除上述协议屏障。但普通角色台词的可复现误拦与该假设矛盾。
- 假设 B：“完整回复被咪嘛馆错误判定”。由上述具体正文在旧 classifier 中误拦和 route 的假 fetch 返回经修复后提交成功支持。记录是否属于 A/B，需要逐条看 finish 标记及未经处理的原始正文。
- 假设 C：“报错是单纯手机浏览器的问题”。CSS 源码与 DOM 实际层级已经构成自有布局越界路径；不应单纯建议用户缩放或重启。尚未用真实 Safari 验收具体皮肤尺寸。

## 离线回归与安全边界

- PASS：`tests/smoke-r16-2-refusal-history.js`：6 种完整剧情不误拦；明确服务商拒绝仍阻断；真 `/sessions/:id/chat` 假 HTTP 提交正常；历史投射保留无证据的旧台词，已证实 blocked metadata 跳过；没有付费请求。
- PASS：`tests/smoke-r16-2-regex-evidence.js`：mock Provider 返回完整长剧情，正则清空后失败时完整 raw 保留在诊断候选、History 无空 assistant、玩家消息保留。
- PASS：旧 `smoke-r11-1-refusal-admission`、`smoke-r16-content-parts-compat`、`smoke-third-api-diagnostics`、`smoke-compat-rework-turn` 等专项。JS 语法检查通过。
- 未实测：用户真实 iOS Safari 皮肤和键盘弹起后的可点击性、真实 API、实际角色卡所有拒绝表达语料；无法保证零误判。
- 仍需审计：启用 `outputContract.completeHtml` 时的过严 HTML 格式判断；其它错误如 `E_CANONICAL_CONFLICT`、上下文构造/中转 `HTTP200` 空正文；这些与此轮已复现根因不能混为一谈。手动恢复仍需真实诊断存在、原任务未替换、原始全文未裁剪，不会跳过一致性检查。

## 部署与回滚

先备份已有部署和用户浏览器数据。网页同级覆盖本包生产文件，IndexedDB 与本地配置未迁移、未清理。仅当线上实际网页引用本轮缓存版本才能认领运行的是新代码。失败可使用单独回滚包恢复 5 个文件，用户记录不应因此被清空。
