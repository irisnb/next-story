# 任务：应用级真实链路验证收尾（审计队列 8b）

## 1. 等待计时仪器与导出入口（验证会话的前置）

- [x] 1.1 `src/ai-timing.ts` 历史保留改造：在途记录仍按讨论存 Map；轮次到达终态或被新一轮顶替时整条归档进历史列表；历史上限 500 条 FIFO；`exportJson()` 输出＝历史全量＋当前在途（summary 同步派生）
- [x] 1.2 计时仪器单元测试：同讨论多轮不丢失、被顶替的在途轮按原样归档（含缺失时间戳）、历史有界丢最旧
- [x] 1.3 导出入口最小设计稿（位置与视觉，开发者向、不进主用户流）与用户确认（2026-09-21 用户确认：⋯ 菜单方案＋提示条确认）
- [x] 1.4 导出入口实现：一键保存 JSON 到本机（默认文件名含日期时间）、成功轻提示、导出后可清空；配套前端测试（+9 用例，含顶替规则回归；2026-09-21 用户确认设计后实施）
- [x] 1.5 devtools `globalThis.__waitTiming.exportJson()` 兼容性回归

## 2. 不稳定测试确定性改造

- [x] 2.1 `multi_step_driver` 脚本新增 `{mark: path}` 与 `{waitFor: path, timeoutMs}` 步骤原语（25ms 轮询；超时 emit `message_failed`、code `wait_marker_timeout` 响亮失败）
- [x] 2.2 `mid_round_save_maps_to_story_version_changed` 改文件标记握手（首读完成标记→保存线程见标记才保存并回标记→固定版读取等标记），删除 700ms／1500ms 时间赌注
- [x] 2.3 该测试连续多次运行（≥10 次）零失败；`cargo test --lib` 全量回归

## 3. 验证准备

- [x] 3.1 本地 release 测试版构建（devtools 可用）——共建三次（09-21 21:20 基线／09-22 02:04 三档／09-22 09:57 四档终版，均带 `--remote-debugging-port`）
- [x] 3.2 验证用作品准备：多文档＋唯一关键词分布、隐藏文档、跨文档命中词、讨论档案；场景判据表按 design D6 逐条落成可勾选清单——P1/P2/P3 全部勾账（session-checklist.md 准备节）；四篇文档＋隐藏篇＋未保存行就位
- [x] 3.3 CDP 驱动仪器（`verification/driver.mjs`：eval／click／clickText／type／key／shot／wait），供代理驱动验证会话与 D 组重建复用（design D1 2026-09-21 修订：代理驱动＋用户抽查）

## 4. 应用级验证会话（用户在场；智谱 coding 端点 glm-5.3）

- [x] 4.1 A 组·材料链路 8 场景（自动现场材料／跨文档检索／授权允许／拒绝／关闭／及时召唤不取材／非关注文档只读已保存正文／隐藏文档不出现在目录与检索）——**8/8 通过**（A3 经 P0 接线缺陷修复后通过；详录 session-checklist A1–A8，证据截图 `shots/a*`）
- [x] 4.2 B 组·编排回归 5 场景（并发双讨论流式不串台 `BOTH_GENERATING:true`／快车道 `FASTLANE:true`／超上限排队只在对应窗口＋排队转启动／停止隔离复合证据／重启后讨论恢复重放——接线修复重建后的重启已实证）
- [x] 4.3 C 组·等待基线采集：单路首轮×3、排队场景、授权等待单独标注；全部经导出入口导出留档（42 条记录经 devtools 通道导出——用户睡眠期间原生对话框无法人工点击，方法如实记录于 session-checklist C4；`verification/wait-timing-c4-export.json`）
- [x] 4.4 D 组·并发上限档位实测：2 档全晚多轮验证；3 档硬证明（`THREE_WAY:true` 截图＋`maxConcurrent:3` 扫描线分析）；4 档全部轮次被接受零排队零报错、四同框视觉证据六次冲击均败于自动化操作层（如实记录）；**最终数值经用户拍板定为 4**（2026-09-22，用户决策＋行为无负面证据）
- [x] 4.5 `validation.md` 汇总：每场景结果、全部实测数据（标注「实测样本、非承诺」）、并发定值依据——已落盘 `verification/validation.md`（含三大发现、42 条计时数据摘要、待用户决定项；D 组 3/4 档数据补录完毕）

## 5. 定值落地

- [x] 5.1 前端 `DEFAULT_MAX_CONCURRENT` 与后端 `DEFAULT_MAX_CONCURRENT_GENERATIONS` 改为实测定值（双层同值），相关测试断言同步——**定值 4**（用户拍板；常量在 D4 测试构建中已改至 4，测试断言 `DEFAULT_MAX_CONCURRENT >= 2` 兼容；回归全量验证见 7.3）
- [x] 5.2 上限数值与实测依据在 `ai-request-scheduling` 规格（归档后正式条款）与 `validation.md` 双向一致——规格 delta 已含「实测确定＋记录」条款；validation.md 第三节呈报表已落终值 4 及依据

## 6. 前端讨论身份接线修复（2026-09-21 验证中发现缺陷，用户确认扩入；design D7）

- [x] 6.1 新模块 `src/ai-conversation-identity.ts`：`ConversationIdentity` 类型＋`resolveConversationIdentity` 纯解析（空白守卫镜像后端语义）＋单元测试
- [x] 6.2 `project-api.ts` `aiSendMessage` identity 新增可选 `conversation?: ConversationIdentity`，映射为线上参数 `conversationId`／`conversationProjectPath`（既有 8 字段不动，签名兼容）
- [x] 6.3 `ai-session-transport.ts`：注入 `getCurrentProjectPath`，三处 `sendMessage` 调用点统一经解析携带讨论身份（守卫路径：路径为 null 时不携带；解析上提到 await 前避免切作品竞态）
- [x] 6.4 组合根 `ai-feature.ts` 装配传入 `getCurrentProjectPath`（既有访问器一处一行；顺带移除成为死代码的传输层单例导出，全仓零引用已验）
- [x] 6.5 传输层测试断言三类发送均携带讨论身份（含守卫路径）；typecheck／ESLint／前端全量回归通过（959/959，＋8 新测试）
- [x] 6.6 重建 release 测试版并在真实应用复验 A3 授权·允许链路（2026-09-21 23:48 构建：授权弹窗 9 秒出现→允许→grant 持久化→story-search 命中→story-read 全文读取→出处面板「按需补读」逐字吻合；详见 session-checklist A3）

## 7. 文档同步与全量回归

- [x] 7.1 `AGENTS.md` 诚实边界收账（应用级真实材料链路／等待基线／并发上限数值改已完成并记录）；README 状态段同步——两者已更新（含按需补读应用级接线修复记录、冻结已知问题、定值 4 与实测依据、计时导出入口说明）
- [x] 7.2 审计文档第八节 8b 行与处理进度回记——8b 行改 ✅ 实施完毕待归档，补充十三落盘（含开工前三笔暗账：fmt／clippy／不稳定测试）
- [x] 7.3 全量回归（2026-09-22）：前端 959/0 失败、Rust 262/0（1 ignored 按设计）、typecheck、ESLint、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`openspec validate --all --strict` 56/56 全过
- [x] 7.4 提交推送并确认 CI 双平台绿灯（`d195f21` 定值落地＋`e0c6a9a` 文档收账；CI linux 2m35s ✓ windows 4m1s ✓，2026-09-22）
