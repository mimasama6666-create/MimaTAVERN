# 咪嘛馆 R11.27 → 集中集成候选：实际闭环边界

**判定：研发候选；不可声称记忆、PNG 和高级兼容全部 GO。**

## 1. 母体与修改

唯一母体 R11.27（`MimaTAVERN_R11.27_存档完整写入契约续修_完整无数据源码_NO_GO.zip`），未读写用户私有存档。生产代码仅修改 `standalone-core.js` 中 `memoryModel()` 的记忆输出协议，将实际验收器的 JSON `memory`/`evidence.quote`、不同记忆覆盖义务与模型指令对齐；不放宽来源验证、不改变 History、交易或记忆结算权。将一次尝试修改单片滚动合并的实验完整撤销：原 R11.17 既有正例出现退化后立即恢复原始逻辑，不纳入本包。

新增无 API 成本回归 `tests/smoke-integrated-memory-contract.js`，验证事实/核心/滚动三类模型请求、校验与持久化，幻觉阻断及来源 History 保留。新增独立同源浏览器测试页面 `qa-local-browser.html` 和 `qa-local-browser.js`：不会打开正式 canonical DB，不调用 Provider，检查资源、临时 IndexedDB 事务、双字体和双格式 PNG 中的 V3 优先。

## 2. 全回归

- 旧 R11.27：106 项，93 PASS / 11 FAIL / 2 SKIP。
- 本候选：107 项，94 PASS / 11 FAIL / 2 SKIP / 0 TIMEOUT。
- 145 个 JS 文件的 `node --check` 均通过。
- 11 项原有失败没有新增与消失，**不得把这些旧失败写成已经通过**。
- 合成 PNG 正常导卡/模型出站/429 后续算/重载等既有正例全部仍通过。

旧失败逐项分组：
1. `smoke-compat-r1-r5.js`：旧断言要求世界书在第一个 system 消息，当前刻意将其作为 user 来源资料；角色层级与合同不同。
2. `smoke-fourth-memory-p0-lease.js`、`smoke-v1.1.4.js`：要求按固定窗口强行裁剪 History，与完整原文优先冲突。
3. `smoke-fifth-memory-root-closure.js`、`smoke-sixth-r6-memory.js`：要求来源不够的候选标 failed 而不是 needs_review，需按当前生命周期合同核对。
4. `smoke-r10-opening-fact-source.js`、`smoke-v1.3.9-memory-facts.js`、`smoke-third-memory-journal.js`：模拟模型只输出局部或无来源断言，却旧测期待直接入库；当前按事实完整来源合同拒收。
5. `smoke-r11-15-memory-lifecycle.js`：旧断言拒绝长剧情的选择性核心记忆，与最新核心选择合同相反。
6. `smoke-seventh-memory-coverage.js`：旧续算测试使用不完整的模型分片，却期待最终游标推进，必须在累计来源保真要求下重写验收样本，不可改生产安全路径。
7. `smoke-v1.3.9-png-memory.js`：旧模拟模型未给出足够的来源依据而期待核心记忆提交。

以上是失败触发位置与当前合同差异，不构成 11 项都被正式判定为“无 Bug”的证明。需用新合同相容的完整能力测试取代旧前提，而不是修改旧测试凑绿。

## 3. 不能诚实宣称完成的 GO 门槛

- 无真实 Provider 凭证和用户具体模型，请求仍无法测事实、核心和滚动自然语言在真实长篇剧情的多样本成功率。新增的回放是离线模拟。
- 当前 Chromium 的 HTTP/file/data 导航均被 `ERR_BLOCKED_BY_ADMINISTRATOR` 阻断：无法在这里验收真实 IndexedDB 迁移与恢复。新的 `qa-local-browser.html` 是让用户以后在原站点零 API 测试的独立工具，不等于已通过。
- 真实未脱敏 SillyTavern PNG 不在本次文件中，原有 `smoke-compat-rework-real-png`、`smoke-sixth-compat-end-to-end-fake-idb` 均明确 SKIP。
- 高级世界书 MVU/脚本插件、原版 ST 对照、可选 Windows Sidecar 尚未全部建立黄金测试，不应标为等价。

**交付原则：不能为了赶进度，删完整 History、削弱来源校验、取消插件或绕过上述 GO 门槛。**

## 4. 用户版本保护

当前用户正在玩的 R11.15 + UI 热修不变。禁止用这个集成研发候选直接覆盖在用目录。字体与导航的修复已有测试，但用户真实主题组合仍需其原安装环境核验。该包不包含任何用户的真实 IndexedDB、私人数据或 API 密钥。
