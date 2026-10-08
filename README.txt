咪嘛馆 Standalone · 分享版
===========================

这是从 MIMAMAO V0.9.0 Tavern V2 抽离出的纯前端独立酒馆。

它不包含：Telegram Bot、MIMAMAO 宅邸、Train、Touch、NPC、宠物、Activity、后台 Scheduler、HF 私有存储、任何内置 Persona 或作者 API Key。

它包含：
- Character Card / User Persona
- Worldbook（Depth 0 = System 前/中/后；Depth > 0 = 历史深度注入）
- Preset
- Regex 正则包（display / prompt / input / output 四阶段）
- 正则助手 / 预设助手 / CSS 美化助手（独立模型、温度、Persona 与聊天记录）
- Prompt Inspector
- Rolling Summary / Pinned Facts
- 剧情编辑、分支、重说、续写、自动推进
- Session 导入导出 / 本地资料备份
- TTF / OTF / WOFF / WOFF2 本地字体库
- OpenAI-compatible API 设置、模型拉取、测试连接
- 真流式前端显示：Streaming 开启后边接收边显示正文

使用方法：
1. 最推荐：把整个文件夹作为静态站点上传到 Netlify / GitHub Pages / Cloudflare Pages 等，然后把链接分享给朋友。
2. 桌面浏览器也可以尝试直接打开 index.html；但 file:// 模式下不同浏览器对 IndexedDB 和跨域 API 的限制不同，所以静态网站方式更稳定。
3. 打开后新建剧情，在“🔌 API”里填写：
   - API Base URL，例如 https://example.com/v1
   - API Key
   - Model
   可点“拉取模型”自动获取，也可以直接手填模型名。
4. 导入角色卡 / User Persona / 世界书后即可开始 AIRP。

API 安全：
- API Key 只保存在当前浏览器 localStorage。
- API Key 不会进入剧情、角色卡、世界书或完整剧情资料导出文件。
- 不要把带有自己 API Key 的浏览器资料目录分享给别人。

CORS：
Standalone 是纯浏览器前端，因此 API 服务必须允许网页跨域请求（CORS）。
如果配置正确但浏览器提示 Failed to fetch / CORS，通常是 API 站点禁止浏览器直连。此限制无法由纯静态前端绕过；请使用支持 CORS 的 OpenAI-compatible API。

API 配置 JSON（可选导入）示例：
{
  "apiBase": "https://example.com/v1",
  "apiKey": "sk-xxxx",
  "model": "model-name"
}

数据位置：
- 剧情 / Persona / 世界书 / Preset / Regex 正则包：IndexedDB（mimamao_tavern_standalone）
- 字体：IndexedDB（咪嘛馆字体库）
- API 配置：localStorage
- 助手模型偏好 / Persona / 独立聊天记录：localStorage（不额外保存 API Key）

版本：MIMAMAO Tavern Standalone 1.1.0


=== V1.0.2 补丁说明 ===
- 修复模型“空回”被当作成功并写入空白 assistant 消息的问题：空正文现在会被拦截并返回 E_API_EMPTY_REPLY。
- 加强 OpenAI-compatible 响应解析；加入结构化错误码、HTTP 状态和常见原因提示。
- API 模型改为可真正展开的原生下拉选择器，同时保留手动模型名输入。
- 新增 Temperature（温度）选择与 Streaming（流式传输）开关。
- 新增剧情生成动画、阶段状态与进度条；流式模式会显示已接收字符进度。
- 顶部控制栏压缩并贴近屏幕顶部，为剧情正文让出更多空间。
- 默认 UI 调整为灰色 iOS 27 风格液态玻璃/磨砂；角色面具图标替换为 🤍。
- 可见英文 UI 标签补充中文括注；原剧情/角色卡/世界书/预设/字体/CSS/导入导出等旧功能保留。

V1.0.3 数据安全补丁：
- CSS / JS 加入 ?v=1.0.3 资源版本号，缓解 GitHub Pages / Safari 混合缓存旧资源问题。
- 新增 💾 Data（数据）页：保存本机设置快照、恢复快照、导出完整设置、导入完整设置。
- 完整设置备份包含：剧情、角色卡、世界书、预设、CSS Preset、API 参数、温度、Streaming、字体选择；可选包含本地字体二进制和 API Key。
- 注意：强制刷新不会删除 IndexedDB/localStorage；“清除网站数据”会删除，请先导出 JSON 备份。


=== v1.0.4 Safe HTML + CSS Studio 补丁 ===
- 修复 Safe HTML 开启后换行和连续空格被浏览器折叠的问题。
- Safe HTML 新增 system / details / summary / section / article / pre / code / table 等安全结构支持。
- 不支持标签不再把整棵子节点拍平成纯文本；危险 script/style/iframe/form 等仍会被移除。
- CSS Preset 新增三档 Scope：自定义 HTML 内容 / 剧情聊天区域 / 咪嘛馆全局 UI + HTML。
- 纯 CSS 可直接粘贴或导入，不需要 <style> 包裹。
- 新增“一键复制默认 CSS”“导出默认 CSS”“默认 CSS 二改”按钮。
- 全局 CSS 可覆盖咪嘛馆顶栏、设置中心、输入框、剧情内容等；旧 CSS Preset 与旧功能保持兼容。


=== v1.0.5 “重说”目标锁定修复 ===
- 修复第二轮点击“重说”时可能覆盖上一轮 Assistant 回复、而当前回复仍留在底部的问题。
- “重说”现在在点击瞬间锁定当前最后一轮 Assistant 消息 ID，并只原位替换这一条；旧内容进入该消息 versions。
- 若当前最后一轮只有 User 消息、尚无 Assistant 回复，则“重说”会生成这一轮的新回复，不再误伤上一轮。
- 增加 stale/missing target 防护：目标异常时直接报错并拒绝覆盖其他剧情。
- 静态资源缓存版本更新为 ?v=1.0.5。


=== v1.0.6 阅读排版与玻璃微调补丁 ===
- 整体灰色背景轻微提亮，玻璃面板透明度略增，保持现有 iOS 27 磨砂结构不重做。
- 新增 Novel Typography（小说正文排版）：字号、行间距、段间距、字间距均可实时调整并保存在浏览器。
- 正文排版只作用于 assistant 普通剧情文字；Safe HTML 状态栏和自定义 HTML 不继承这些数值，避免破坏用户状态栏 CSS。
- 本地“剧情正文字体”与旧 URL 剧情字体也收窄到普通剧情文字，不再强行覆盖自定义 HTML 状态栏。
- Safe HTML 渲染会把顶层普通文本识别为 story-prose，同时保留显式 HTML 元素原结构。
- 正文排版设置加入完整设置快照/导出/导入。
- 静态资源缓存版本更新为 ?v=1.0.6。


=== v1.0.7 手动记忆总结补丁 ===
- 新增 🗃️ 记忆页，保留原自动 Rolling Summary，不破坏旧剧情与旧存档。
- 新增“核心记忆”：可从第一轮开始读取完整剧情原文，也可根据已有事实记忆二次提炼；目标字数可自定义，并提供 500 / 1000 / 2000 快捷值。
- 核心记忆要求模型按长期重要性整理，重点保留关系转变、承诺/约定、关键选择及后果、持续状态变化和未解决事项，禁止机械流水账。
- 新增“事实记忆”：可自定义每 X 轮生成一段、每段目标字数；可只总结最近 X 轮，也可从头到尾重建。
- “从头到尾”支持生成成功后整体替换旧事实记忆；采用事务式保存，生成中途失败/停止不会先删掉旧事实记忆。
- 手动总结拥有独立 Summary Temperature（总结温度）；沿用当前 OpenAI-compatible API 与模型。
- 超长剧情会自动分块总结并再次合并，降低一次塞入巨大上下文导致请求失败的概率。
- 核心记忆与事实记忆可独立控制是否注入后续 Prompt；事实记忆可限制只注入最近 N 段，避免长篇剧情无限撑大上下文。
- 核心记忆支持生成后手工修订；事实记忆支持逐段删除或全部清空。
- 静态资源缓存版本更新为 ?v=1.0.7。


=== v1.0.8 首行缩进补丁 ===
- Novel Typography（小说正文排版）新增“首行缩进”，范围 0–4em，步进 0.25em。
- 默认保持 0em，确保升级后旧用户的现有排版不会突然变化；中文小说常用推荐值为 2em（约两个汉字宽）。
- 提供 0 / 1em / 2em / 3em 快捷按钮，并支持滑杆、数字输入与实时预览。
- 首行缩进只作用于 Assistant 普通剧情段落 `.story-paragraph`；User 消息、Safe HTML 状态栏、表格、标题、列表等显式 HTML 结构不会被强制缩进。
- 设置沿用现有正文排版本地存储，并自动进入完整设置快照 / 导出 / 导入；“恢复默认排版”会同时恢复为 0em。
- 静态资源缓存版本更新为 ?v=1.0.8。


=== v1.0.9 外观实时预览 + Safe HTML 排版兼容补丁 ===
- 进入「🎨 外观」页时自动切换到 Live Preview（实时预览）布局；预览使用固定示范文本，不写入剧情、不调用 LLM。
- 字号、行间距、段间距、字间距、首行缩进与剧情正文字体继续共用真实 CSS 变量，拖动/切换时即时反映到预览。
- 预览区加入多段中文小说示范，方便同时观察首行缩进、换行密度、段落呼吸感和字距。
- Safe HTML 开启时加入兼容性示范：显式 <p>/<div> 等 HTML 正文可继承剧情字体、字号、行高、字间距。
- 修复旧版 Safe HTML 半兼容：模型把正文包进允许的 HTML 标签后，外观设置不再看起来“失效”。
- 首行缩进与段间距仍只作用于普通 story-paragraph，不强制套到 system/details/表格/状态栏结构；状态栏自身 CSS 可继续覆盖继承的字体与尺寸。
- 旧 URL 剧情字体同步支持 Safe HTML 基础继承。
- 静态资源缓存版本更新为 ?v=1.0.9。


=== v1.1.0 Regex + Assistant Studio + Live Streaming 补丁 ===
- 修复主输入框有文字时仍显示酒红色焦点边框：有内容时改为银白色发光边框；空输入框仍保留旧外观。
- 主输入框取消 Enter 发送监听：Enter / 换行键只负责换行，只有点击发送按钮才会真正请求模型。
- 修复 Streaming 只显示接收进度、不显示正文的问题：SSE 每次收到的新片段都会同步到剧情区临时 Assistant 气泡，并以逐字/小步追赶动画显示；完成后仍由原 Session 保存链路接管最终消息。
- 新增独立 Regex Engine Sidecar，不替换原 Preset / Worldbook / Safe HTML。Regex Pack 可挂载到当前 Session，并支持 display / prompt / input / output 四个阶段、优先级、启停、导入导出和即时测试。
- display 阶段专门支持“模型短协议 → 前端长 HTML”：模型历史中可以保留紧凑标签，渲染时再展开完整状态栏，从而减少重复 div 带来的上下文 Token 占用。
- 新增「正则助手」：可把 HTML 状态栏输出规范转换为配套短协议 Preset + display Regex Bundle，并一键保存、挂载；生成成果保存前会先校验 JavaScript RegExp。
- 新增「预设助手」：用于设计/改写文风、行为约束、输出格式等 Preset，可一键保存并挂载。
- 新增「CSS 美化助手」：用于生成纯 CSS Preset，可一键保存并应用；继续遵循现有 CSS Scope 与 Safe HTML 安全边界。
- 三个助手均提供大型聊天工作区，分别保存独立 Model、Temperature、Streaming、Persona、设计风格和聊天记录；它们只继承正文 API 的连接信息（Base URL / Key / Headers），不会改动正文模型选择。
- 助手聊天同样是 Enter 只换行、点击发送才调用模型。
- Regex 与助手资料已接入完整备份；数据 schema 以增量方式升级到 v3，原剧情、角色卡、世界书、Preset、CSS 与旧入口保留。
- 静态资源缓存版本更新为 ?v=1.1.0。

Streaming 说明：前端现在会即时消费并显示服务端实际送达的 SSE chunk；若某个中转站/模型上游本身把内容缓存到最后才一次性返回，浏览器无法提前显示尚未收到的文字。


=== v1.1.9 Safe HTML 动态状态变量补丁 ===
- 修复 BOND 数字正常但所有进度条始终为空的问题：根因是 Safe HTML sanitizer 会删除 `style="--value:85%;"`，导致 CSS 的 `var(--value, 0%)` 永远回退到 0%。
- 不开放任意 inline style；只增量保留旧状态栏已经使用的 `--value:<0..100>%` 动态变量，并做百分比格式校验与 0–100 夹紧。
- 原 HTML / Regex / CSS 状态栏输出协议无需修改，旧 BOND 结构继续兼容。
- Safe HTML 原有 script/style/event/javascript 等安全边界保持不变。
- 静态资源 release 更新为 1.1.9，避免手机端继续命中旧 app.js 缓存。


=== v1.2.0 Canonical 合流版 ===
- 唯一母体：v1.1.10 BOND-HYDRATION。保留 v1.1.9 Safe HTML `--value` bridge 与 v1.1.10 历史/可见数字 BOND hydration。
- 增量合并平行 v1.1.9 Browser Transport 分支：更清楚的 CORS/网络诊断、流式中断 E_STREAM_INTERRUPTED、手动“仅重试本轮”且不重复玩家消息。
- 浏览器请求显式使用 mode=cors / credentials=omit / cache=no-store，并在 Fetch 尚未拿到响应时记录 endpoint origin 与 navigator.onLine 诊断。
- Safe HTML 新增原生 <progress>/<meter> 标签及其数值属性；script/style/event/javascript 安全边界继续保持。
- 不改 Store/schema/Session ID/Regex ID/Prompt contract；不删除既有入口。

======================================================================
MimaTAVERN v1.3.0 · Novel Studio DLC
======================================================================

【小说续写】
顶部 ✒ 入口打开 Novel Studio。可导入 TXT；咪嘛馆会保留原始 sourceText 快照，并自动识别常见中文/英文章节标题。没有章节标题时会作为“正文”单章导入。

Novel Project 与原 RP Session 完全分离。章节正文由 source / manual / ai_accepted segment 组成；AI 新生成内容先进入 Draft，只有点击“采纳续写”才会进入 canonical 正文。删除或重写 Draft 不会改变小说正文或剧情档案。

【最低字数】
最低字数不是只写在 Prompt 里的软要求。模型返回后由代码统计可见正文字符；不足时会沿同一个 NovelGeneration 继续追加，达到要求或触及项目设置的追加上限。触及上限会明确标记 incomplete，不会伪装完成，也不会重新生成前半段。

【剧情档案】
每章可生成结构化章节概括，并增量维护全局 NarrativeState：故事概括、当前剧情、人物状态、关系、时间线、进行中剧情线、伏笔、已揭示事实和地点。修改旧章节会把受影响摘要/全局记忆标记 stale；未分析完整本书时显示 missing/PARTIAL。stale 的全局剧情状态不会继续作为可信 canonical memory 注入续写 Prompt。

【续写要求 / Director Note】
续写要求可以留空。它只对本轮请求生效，不会直接进入 canonical 剧情记忆；只有最终被采纳正文真正写出的事实，才可能被后续剧情档案提取。

【Preset / Worldbook】
Novel Studio 直接挂载咪嘛馆现有 Preset 与 Worldbook ID，不创建重复副本。Worldbook 会根据当前/近期正文、章节概括和本轮导演要求做相关性激活。

【主题】
内置主题：Mima Default、Midnight、E-Ink、Paper。Default 不写入主题覆盖属性，因此保持 v1.2 原外观；E-Ink 使用灰纸/深灰文字并主动抑制 glow、blur、gradient 和 animation。主题和字体/排版设置相互独立。

【CSS】
CSS Preset 新增 Novel / Assistant surface。Novel 稳定 selector 包括：
.novel-studio-root / .novel-reader / .novel-sidebar / .novel-inspector / .novel-draft / .novel-memory-card / .novel-director-box
稳定 reader token：--reader-bg / --reader-text / --reader-muted / --reader-line。
现有 story/global/app scope 继续兼容。自定义 CSS 仍位于内置主题之上；网址参数 ?noCss=1 仍可作为紧急 CSS bypass。

【备份】
资料库 schemaVersion=4。完整 Library / Full Settings 备份会包含 novelProjects 与 themeSettings；导入 v3 会增量补齐为空 Novel 域与 Default Theme，不删除旧 Session / Persona / Preset / Worldbook / Regex / CSS 数据。

【导出】
Novel Studio 可导出 TXT 或项目 JSON。TXT 只包含 canonical source/manual/ai_accepted 正文，不包含尚未采纳的 Draft。


MimaTAVERN v1.3.1 · Novel Studio 修复补丁（完整包）
- TXT 导入自动识别序章、卷、中文/英文数字章节等标题；有依据时按章独立归类，左侧显示章节数。
- 导入原文使用折叠阅读，原始 source snapshot 保留；章节独立编辑，逐段 AI 续写独立折叠归档。
- 可选择「续写本章」或「新篇章续写」，均先产生 Draft，采纳后才进入正文和剧情记忆。
- 旧草稿不因“重写”自动销毁；断流返回 partial Draft 仍保留原 Generation。
- 修复输入框 onchange 重绘导致“点击续写未发出请求”及导演要求丢失。
- CSS 导入询问作用域，支持真正全局挂载、小说独立挂载、聊天正文挂载；全局挂载保存在主题设置中跨 Session。
- API 默认继承主 API 的 Streaming 和 Temperature 策略；旧项目可在模型设置点击「跟随主 API 配置」。
- 「测试小说模型连接」手动发送两次短小请求，分别验证章节总结非流式和续写当前传输方式。
- 传输失败显示错误码、HTTP 状态、提示与阶段；不会自动收费重试，也不会把空文视作生成成功。
- 没有真实中转账号/密钥，故无法在此验收用户自己中转线路的完整长篇请求。遇到失败请提供新诊断窗口的 code / HTTP / stage（勿提供 Key）。
- 更新不会覆盖本地 IndexedDB；完整包不含运行数据或 Git 仓库历史。部署前仍建议导出完整备份。
