# 兼容等级矩阵（源码能力 ≠ 官方等价）

| 对象 | 当前等级 | 状态与必须明确的限制 |
|---|---|---|
| PNG CCV1/CCV2/CCV3/chara/ccv3 双块 | L1–L2 | 扫描、无损保存、角色版本选择；真实王爱英两版识别 |
| JSON 角色卡/外置世界书/Regex/Preset | L1–L2，有限 L3 | 可选择挂载、有来源指纹；preset 官方 prompt manager 语义未运行 |
| CHARX 原始 ZIP/素材 | L1–L2，有限媒体手动预览 | CRC/SHA、手动 Blob 音频/图片；不是任意 embeded:// HTML 自动改写 |
| ST World Info before/after/at-depth | 有限 L3 | 常驻/关键词和基本插入受支持；未跑固定官方 ST 黄金对照，递归/分组/概率/sticky 不支持即报 gap |
| ST Regex input/output/display | 有限 L3 | Worker 隔离、安全失败保留 raw；代入宏/substituteRegex/trimStrings 等尚未 parity |
| CSS/HTML 状态栏 | L1–L2 | Shadow CSS + sandbox 静态 HTML，动态 MVU 状态栏未达 L3 |
| MimaCompatSDK 限定脚本 | 有限受控 API | 明确授权的 chat.read、vars.read/write、ui.mount、events.subscribe；Worker 生命周期、无 DOM；非 Tavern Helper |
| Tavern Helper/STscript/MVU 原脚本 | L1，不是 L4 | 未证明其真实 UI 演出；需原版 SillyTavern 宿主 |
| Windows SillyTavern 1.19.0 独立 Sidecar | 源码构件，非 L5 | Node/Git 真机/登录/扩展/路径/端口未测，full SHA 尚待核对 |
