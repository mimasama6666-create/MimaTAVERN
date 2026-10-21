# 咪嘛馆 · MimaTAVERN

纯前端酒馆式剧情应用，可在浏览器中游玩及本地部署。请在使用前阅读授权条款。此仓库/交付包的内容不应被误认为全都由项目作者持有版权。

<!-- MIMA-LICENSE-SUMMARY-BEGIN -->
**版权与许可（2026-10-21 起适用的受许可版本）**：Copyright © 2026 mimasama6666-create。咪嘛馆核心代码为源码可见的限制性软件，并非 OSI 开源。允许成年人免费游玩、下载、本地安装及私人非商业修改；欢迎独立创作、非商业分享插件、主题、CSS、预设、角色卡及教程，独立作品版权仍属其作者。未经书面授权禁止转售/商业经营核心程序，或复制、改名、打包、重新发布咪嘛馆整体或实质性核心衍生版本；不得冒充作者或抹除授权声明。独立扩展本身的商业权利不等同于获得核心程序的商业授权。第三方素材/依赖仍遵循原有许可证，历史有效授权不追溯撤销。完整英文协议以根目录 [LICENSE](./LICENSE) 为准；[网页版/离线版查看](./license-view.html)。咪嘛馆仅供 18 岁及以上成年人使用，是前端而非模型，内容由用户与选定模型/提供商产生；制作者在法律允许范围内不对这些内容提供担保或承担由其生成所当然引起的责任。
<!-- MIMA-LICENSE-SUMMARY-END -->

## 安装与使用

本项目的静态入口为 `index.html`。本地推荐使用可信的静态 HTTP 服务（例如在目录执行 `python -m http.server 8000`）并访问 `http://localhost:8000/`；无需后端服务。直接打开本地 HTML 的功能可受浏览器 file:// 安全策略限制。用户选择的模型 API/Provider 按各自配置和协议提供服务，软件不会自动提供模型额度。

## 软件授权与扩展

- 核心程序受根目录 [LICENSE](./LICENSE) 约束。正式名称：MimaTAVERN Personal Use and Independent Extensions License v1.0（限制性 Source-Available，不是 OSI 开源）。
- 独立原创插件、主题、皮肤、CSS、预设、角色卡与教程受各自创作者权利保护；独立扩展可非商业分享，不得夹带或变相分发核心程序。独立扩展本身的商业权利与核心商业授权分开判断。
- 第三方代码和素材许可见 [SECURITY-AND-LICENSES.md](./SECURITY-AND-LICENSES.md)、`licenses/`、`vendor/`。上述第三方原授权不受自定义 LICENSE 替代或覆盖。
- 完整协议还可通过应用内「版权与许可」及 [license-view.html](./license-view.html) 查看，离线使用同样可查看。
- 仅限 18 岁及以上成年人，具体见 LICENSE 第 6 节。生成内容取决于用户和所选语言模型；使用者须遵守法律及模型服务条款。

## 正式发布约束（必须保留）

**单一真源：`LICENSE`。** 使用 `node scripts/verify-license.mjs .` 校验版权哈希、README 摘要、网页镜像和第三方许可，再用 `node scripts/package-release.mjs [目标.zip]` 生成完整生产发行包，最后执行 `node scripts/verify-release-archive.mjs [目标.zip]` 验证产物本身；打包器强制执行全部验证。

任何对 LICENSE 的正式变更必须由版权所有者明确批准、提升版本号、记录到 `LICENSE-CHANGELOG.md` 并更新 `license-policy.json` 与 `license-view.html`；单纯更新游戏版本不得替换许可。`.github/workflows/license-integrity.yml` 提供仓库中的同类检查。GitHub Pages 若仍使用直接发布分支，则 CI 失败**不一定能阻止网页部署**；必须在 GitHub 仓库保护规则或受控 Pages 工作流中设置该检查为发布门槛，才具备远端强制阻断。

GitHub 参考仓库：https://github.com/mimasama6666-create/MimaTAVERN 。请不要拿仓库旧版覆盖本地较新的完整生产母体。
