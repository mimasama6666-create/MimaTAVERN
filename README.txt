咪嘛馆 Standalone · 分享版
===========================

这是从 MIMAMAO V0.9.0 Tavern V2 抽离出的纯前端独立酒馆。

它不包含：Telegram Bot、MIMAMAO 宅邸、Train、Touch、NPC、宠物、Activity、后台 Scheduler、HF 私有存储、任何内置 Persona 或作者 API Key。

它包含：
- Character Card / User Persona
- Worldbook（Depth 0 = System 前/中/后；Depth > 0 = 历史深度注入）
- Preset
- Prompt Inspector
- Rolling Summary / Pinned Facts
- 剧情编辑、分支、重说、续写、自动推进
- Session 导入导出 / 本地资料备份
- TTF / OTF / WOFF / WOFF2 本地字体库
- OpenAI-compatible API 设置、模型拉取、测试连接

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
- 剧情 / Persona / 世界书 / Preset：IndexedDB（mimamao_tavern_standalone）
- 字体：IndexedDB（咪嘛馆字体库）
- API 配置：localStorage

版本：MIMAMAO Tavern Standalone 1.0.2


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
