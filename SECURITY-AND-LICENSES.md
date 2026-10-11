# R1–R5 安全和第三方许可说明

- 第三方正则和脚本均不再在兼容主页同步执行，运行于可以被 terminate 的 Worker。正则使用独立文件；插件隔离 Worker 由 sandbox iframe 生成，iframe 仅 `allow-scripts` 不含 `allow-same-origin`，referrer policy 为 no-referrer，CSP 默认不加载网络资源，受控 RPC 与 grant revision 用于权限判断。
- 未授权时不执行未知 JS；unknown API 返回 `E_PLUGIN_API_UNSUPPORTED`，不伪造成功。Worker 执行器只暴露自定义 SDK 与有限事件，不代表插件拥有完整 Tavern Helper API。内置标准 Media 手动播放器与插件 media.control 分离。
- 浏览器真实 iframe/CSP/nav、URL 绕过、网络/私有 IP 请求动态防御 **未实测**；不给未知脚本直接父文档 DOM 权限，不默认授权外链。复杂原插件引导至独立原版 ST。
- 仅分发用户自己项目的咪嘛馆源码和独立实现的少量兼容代码；未把 SillyTavern AGPL-3.0 官方源码或任何第三方 Tavern Helper 插件源码复制入本包。原 ST 官方单独下载使用时必须遵守其许可和扩展授权。
- 官方发行信息：https://github.com/SillyTavern/SillyTavern/releases/tag/1.19.0；许可证和运行版本必须在能访问官方服务器的 Windows 测试机重新确认。
