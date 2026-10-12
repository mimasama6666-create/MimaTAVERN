# Windows 独立原版 SillyTavern Sidecar（可选；未实测）

`WINDOWS-SIDECAR/upstream-lock.json` 记录官方仓库 `SillyTavern/SillyTavern`、tag `1.19.0`、GitHub release 短 SHA 前缀 `7e8663c`、许可证 AGPL-3.0。锁定文件当前已填写完整 40 位 `fullCommitSha=7e8663cd9c184a550b37238218bdd32c6efc68e9`，安装器应在 Windows 主机上验证检出的 HEAD 与该 SHA 一致。**此处仅核对源码配置与校验设计**；本轮未联网独立验证官方 tag 的真实指向，也未在 Windows 执行安装/启动，不能声称已经完成供应链或设备验收。

1. 安装 Git for Windows 和官方说明支持的 Node.js LTS，确认 `git`, `node`, `npm` 命令可用。由用户亲自选择执行，不自动联网下载。
2. 双击 `WINDOWS-SIDECAR/Install.cmd` 安装到 `%USERPROFILE%\SillyTavern-Compat-1.19.0`（可在 PowerShell 传入 `-Destination` 指定新路径）。只会在**不存在的**目录中 staged clone，再 `npm ci`；失败保留 stage 排查，不覆盖已存在的 ST 或配置。
3. 双击 `Launch.cmd`，默认服务限制于 `127.0.0.1:8000`，非默认端口目前拒绝而非假称配置成功。浏览器访问 `http://127.0.0.1:8000`；这属于原版 SillyTavern 自己的数据目录与插件环境，和咪嘛馆新/旧数据库都不同。
4. `Status.cmd` / `Verify.cmd` 只读检查，`Stop.cmd` 仅关闭经本工具校验 PID、命令行、启动时间的受管理进程。非本工具进程或身份不明一律不动。
5. `Rollback.cmd` 仅在进程停止后把受管理安装目录改名为 `.mima-disabled-时间戳`，**不删除用户配置/聊天数据/插件**；需要恢复可改回名称。此工具不会清理用户电脑上其他 SillyTavern。

Windows 真实运行、端口/中文路径、断网/中断、当前官方 release 的 Node 依赖要求、完整 SHA 和第三方插件端到端演出均**未实测**。执行任何官方插件需用户单独审阅权限；官方宿主中的扩展不受咪嘛馆沙箱约束。
