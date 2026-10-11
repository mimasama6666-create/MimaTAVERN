# 数据完整性边界

- 原生库 `mimamao_tavern_standalone` 原 `local-store.js` 保持字节不变，新功能不在其中加字段。独立新库 `mimamao_tavern_compat_v1` 的 CRUD、CAS、入包与恢复仍沿原已交包的数据库配置。
- 恢复之前须验证完整 source SHA256 和 FK 图：资源/资产/投影→来源、会话→来源/角色、会话挂载→资源指纹、消息→session/turn、journal→user message 与 pending owner、变量/授权→session、import journal→source。
- 新兼容备份采用 JSON 外层 SHA256 manifest 验证，v1 旧备份只能标为无签名；默认不允许对旧未签名备份直接写入，除非明确 opt-in（产品 UI 当前仅 dry run）。
- 空库 restoreVerified 在前置快照后，真正提交时于同一 IDB readwrite transaction 对所有 11 store 执行 getAllKeys 检查，防止检查与插入之间跨标签并发混入另一个事务。
- 跨两库没有分布式原子事务；本版只导出双库独立快照与 revision/hash，不声称全自动恢复原子一致。此项仍开放；请分别备份并保留已存在数据。
- 关键缺口：真实浏览器 IDB crash/abort/quota/多标签与读库异常、双库分阶段恢复失败注入尚未实测，不得当作全通过。
