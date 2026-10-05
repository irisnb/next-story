# tasks：提示底座两段过时限制的小范围修正

> 依赖顺序执行；全部未开始、全部未勾。改动收敛在 `generate.rs` 一处字符串常量＋doc 注释＋其测试模块；无真实模型调用、无可见性变化、无新文件。

- [x] 1. 提示词修订（`src-tauri/src/llm_config/generate.rs`）
  - [x] 1.1 `constitution_prompt()` 内执行两次精确逐字替换（design「精确改动文本」：旧段一→新段一、旧段二→新段二），其余字符零改动；替换前核对旧段逐字命中
  - [x] 1.2 同步该函数 doc 注释：如实描述新结构（身份与永久边界逐字照抄；材料与追问语义按诚实材料边界声明，2026-10-06 修订）
- [x] 2. 定向测试改写（`generate.rs` 测试模块，design 测试计划逐条执行）
  - [x] 2.1 `compose_system_prompt_keeps_all_constitution_clauses_for_both_entries`：保留永久边界句断言（身份句、不修改文档、不代写、不润色、不提供替换文本、三个不判断、纯文本条款），移除八连与旧锚定句断言，新增新段一/新段二关键句断言，新增负断言（不含「不能声称读取或使用」、不含「追问仍锚定首次冻结选区」）
  - [x] 2.2 `direct_question_compose_declares_grounding_and_output_boundaries`：grounding 断言改为新段一关键句，删除八连循环，永久边界句断言保留
  - [x] 2.3 `summon_compose_declares_summon_stance_and_output_boundaries`：移除旧锚定句与八连，新增新段二关键句，召唤立场句与永久边界断言保留
  - [x] 2.4 `replay_prompt_prefix_follows_replay_origin`（崩溃恢复路径）：现断言保留，新增两个 origin 前缀均含新段一/新段二关键句（钉住恢复链与首轮同源一致）
  - [x] 2.5 确认不动项保持绿：`build_task_string_*` 系列、`first_and_follow_up_still_require_non_empty_question`、`compose_message_text_injects_context_only_for_regular_entries`（补 FollowUp 无提示前缀断言）、`tool_reading_prompt_is_composed_for_both_entries`、`summon_first_message_*`
- [x] 3. 门禁与核对
  - [x] 3.1 `npm run check` 全绿（typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust；EXIT=0，日志见 verification/npm-run-check-full-log.txt）
  - [x] 3.2 生产改动清点：git diff 仅 `generate.rs` 一处字符串常量＋doc 注释＋其测试模块改动；无可见性/签名/依赖/前端/sidecar 变化
- [x] 4. 归档
  - [x] 4.1 用户确认验收后 `openspec archive validate-prompt-foundation`（主 spec 两 requirement 更新随归档合入：`dsh-headless-generation`、`selection-ai-summon`；实际以手工 delta 同步＋目录移动等效执行，归档至 `archive/2026-10-06-validate-prompt-foundation`）
