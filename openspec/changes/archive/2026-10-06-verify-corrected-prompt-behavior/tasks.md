# tasks：修正后提示底座的真机行为核验（最小路径）

> 依赖顺序执行；全部未开始、全部未勾。真实模型调用只发生在任务 4（≤18 次上游尝试推导上界，无外层重试）。附档（材料与题面／判定表）已随提案定稿。

- [x] 1. 附档定稿与指纹
  - [x] 1.1 对 `attachments/材料与题面.md` 与 `attachments/判定表.md` 计 SHA-256 指纹记入执行档案（执行中不改题；发现附档缺陷须停下修订并重新指纹，不静默改）——指纹见 verification/验证记录.md；指纹前移除材料附档一处 markdown 残留反引号（排版工件，非题面内容），已如实记录
- [x] 2. 测试实现（`src-tauri/src/llm_config/generate.rs` `mod tests` 内新增；**仅真机批入口 `#[ignore]`**，离线检查默认运行参与 check）
  - [x] 2.1 夹具：合成作品构建（生产项目 API，四文档按附档全文）＋隔离 DSH_HOME（TempDir）＋`load_llm_config`（env `NS_VERIFY_APP_DATA` 缺省 `%LOCALAPPDATA%\com.nextstory.desktop`）＋`DriverParams{ max_tokens: Some(2048) }`（密钥零打印）
  - [x] 2.2 组装与卫兵断言：每轮直接调用私有 `compose_message_text`（design D3 参数表）＋`assemble_round_context`；断言输出含修正后新条款关键句、不含旧句（「不能声称读取或使用」「追问仍锚定首次冻结选区」）后才发送
  - [x] 2.3 执行器：`start_session → send_message_and_wait(180s) → end_session` 严格串行；挂 `set_tool_call_sink`（任一 tool_call 立即 `cancel_message`、记「未完成（工具请求）」，拒读申请同规则）；外层零重试（`Err` 不重发）；总墙钟 15 分钟触顶停发、未发起轮记「未执行」注明原因
  - [x] 2.4 证据落盘：每轮记录 git commit、场景/轮次、实际送出字符串全文、卫兵断言结果、模型名与端点 host（无 key）、参数（2048／temperature 未设置）、终态（`Ok` 全文＋`sent_confirmed`／`Err` 稳定错误码）、工具调用事件、起止时间；落本 change `verification/`
- [x] 3. 启动前提交复核（任一不成立→不运行，启用 D4 最小计数兜底并在记录中明示）
  - [x] 3.1 逐项源码复核：`llm-deepseek` patch 不含 retryPolicy 且 `DEFAULT_MAX_RETRIES=2`；`session-title*`/`telemetry` 禁用；压缩阈值 0.8×窗口对本对话规模不可达；工具取消后无续跑；无 replay/授权挂起路径——五项全部成立（证据见 verification/验证记录.md），未启用计数兜底
- [x] 4. 执行六轮（4 讨论／6 预定回答，严格串行，15 分钟窗口，统一 2048）
  - [x] 4.1 按 S1→S2→S3→S4 顺序执行；每轮终态入档；异常（超时/失败/未完成（工具请求）/疑似截断）如实记录——六轮终态全部 ok、回执齐全、零工具调用、零失败，批次 55.15 秒（首启目录缺失 panic 发生于任何请求之前、预算零消耗，建目录后执行）；**终态成功 ≠ 行为符合**，行为结论见纠正后评审报告
- [x] 5. agent 评审
  - [x] 5.1 依 `attachments/判定表.md` 六行逐项判定（初版误判全符合，经主代理＋oracle 复核纠正）——纠正后结论：**S1 明显违背；S2 符合＋材料范围偏离明确记录；S3 首轮部分偏离；S3 追问符合；S4 首轮/追问核心符合（附披露）**；每项标注「agent 评审」身份并引用原文依据；含 n=1 与截断偏离声明；不冒称人工盲测、无统计与「提升」表述——见 verification/评审报告.md（v2）；原始 round/batch 证据未改动，判定表保持原始标准
- [x] 6. 门禁
  - [x] 6.1 `npm run check` 全绿（typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust；新增测试参与编译与 lint、默认执行跳过）——首跑 fmt 拆行修正后 EXIT=0（完整日志曾落 verification/，2026-10-06 清理收尾时按用户决定删除；通过事实以本记录为准）
- [x] 7. 记录归档与验收
  - [x] 7.1 验证记录（含实际命令、终态汇总、评审报告、指纹、密钥零外泄复查）落 `verification/`；措辞检查（只称「隔离真实驱动链路上的行为核验」，不称应用 E2E）
- [x] 9. 复核纠正与离线可靠性修正（主代理＋oracle 复核后；**无模型重跑**，仅当前 change 文档与测试模块）
  - [x] 9.1 评审纠正：S1 改明显违背（材料外添加「跳入冰水救人」且称正文情节）；S2 材料范围偏离明确记录（sent_text 含完整正文 vs 回答称选区/未读全文，不淡化）；S3 首轮改部分偏离（「独自」「停驶」引申入「直接可见」）；S4 两轮核心符合并披露标签/覆盖率限制（检索实际覆盖《渡口》全部四段、「没读全文」措辞不作正面边界证据）；生产取材无测试独有失真；保留判定表原始标准——见 verification/评审报告.md（v2）
  - [x] 9.2 执行器可靠性修复＋离线验证：已有批次证据拒绝重跑；证据 create_new 原子写入不覆盖、写失败即中止不发后续请求；首轮失败/工具取消则对应追问记未执行原因；总 15 分钟以剩余时间限制单轮 deadline 并发送前检查；会话失败先关停驱动再中止；超时断言真实错误码 `timeout`（取消/超时正确分类）——新增离线测试 4 项＋强化 1 项，`cargo test --lib verify_corrected` 7 passed / 0 failed / 1 ignored
  - [x] 9.3 入口与元数据：真机批加 `NS_VERIFY_REAL_RUN=1` 显式人工门槛（不声称自动计数防护——预算依据仍是人工五前提源码复核）；未来批次 meta 自动携带 git commit＋附档 SHA-256＋卫兵指纹，原始批次 meta 不回填不伪造；tasks/模块注释「全部 #[ignore]」措辞纠正为仅真机入口
  - [x] 9.4 修正后门禁：`npm run check` EXIT=0 全绿；`openspec validate verify-corrected-prompt-behavior --strict` 通过；验证记录区分原始实跑版本与离线可靠性修正（无模型重跑）
- [x] 10. 清理收尾（2026-10-06，用户明确授权；一次性验证器撤除、仅留证据）
  - [x] 10.1 精准移除 `generate.rs` 测试模块内 `verify_corrected` 子模块（929 行 `#[cfg(test)]` 代码，非整文件恢复）；核对与 HEAD 零 diff——原有 15 个组装测试与已提交两段提示修复原样保留
  - [x] 10.2 删除冗余文件：`verification/npm-run-check-full-log.txt`（重复长日志）、`verification/batch-finished.txt`（完成标记）、`方向/提示底座验证-实验提案草案-2026-10-05.md`（过时未提交草案）；保留最小审计记录（六轮原始 round JSON、batch meta、纠正后评审/验证记录、材料题面判定表、openspec artifacts）；S1/S2/S3 偏差记录原样保留不掩盖；保留文档中的失效链接已同步更新
  - [x] 10.3 收尾验证：`git diff --check` 干净、`cargo fmt --check` 通过、目标 15 个组装测试通过（generate.rs 零 diff → 复用 HEAD 基线全门禁结论，不重复 npm check）；`openspec validate --strict` 归档前通过、`openspec list` 归档后为空
  - [x] 10.4 归档处置：`openspec archive verify-corrected-prompt-behavior --skip-specs -y`——一次性验证器能力不合入主 spec、不新建主 spec；历史 delta 保留并标注非现行承诺（见 specs/ 头注）；不删除既有主 spec
- [x] 8. 归档
  - [x] 8.1 用户明确授权后执行（与任务 10.4 一并完成）：`openspec archive verify-corrected-prompt-behavior --skip-specs -y` → `openspec/changes/archive/2026-10-06-verify-corrected-prompt-behavior/`
