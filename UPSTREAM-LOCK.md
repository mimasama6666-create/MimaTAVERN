# 第三方依赖锁与对照限制

- SillyTavern：GitHub 官方仓库 `https://github.com/SillyTavern/SillyTavern.git`；release tag `1.19.0`；GitHub release 显示 commit 短 SHA `7e8663c`。**完整 SHA 已从 GitHub 官方提交核对为 `7e8663cd9c184a550b37238218bdd32c6efc68e9`；Windows 安装仍未运行。** `WINDOWS-SIDECAR/upstream-lock.json` 已固定完整 SHA。SHA 锁定的是来源版本，不代表官方代码已完成安全审计。
- Character Card V3/CHARX：按规范识别 `ccv3` 和 ZIP 内的 `card.json`；保留 ZIP 字节与路径，不把未加载的 `embeded://` 媒体谎报为挂载成功。
- Tavern Helper / STscript / MVU：未锁定具体第三方发布版本或实测 API，因此自研沙箱只实现显式列出的 `MimaCompatSDK`，不声称能直接运行原版 Tavern Helper。
- 许可：官方 SillyTavern AGPL-3.0，安装器不捆绑第三方代码；再分发、修改和网络部署须遵守上游及插件许可。
