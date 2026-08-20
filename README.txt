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

版本：MIMAMAO Tavern Standalone 1.0
