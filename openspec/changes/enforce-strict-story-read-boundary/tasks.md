# 任务：AI 严格只读边界

## 1. 错误契约

- [x] 1.1 Rust 三层新增错误：`ProjectError::RecoveryRequired`（operations 层）、`MaterialDenialReason::RecoveryRequired`（材料拒绝层）、`GenerateAiErrorCode::StoryRecoveryRequired`（`llm_config/mod.rs:118` 枚举，snake_case 序列化断言）
- [x] 1.2 固定用户文案与脱敏断言（沿用 `lib.rs:239` 固定文案测试模式）：「作品有未完成的保存，请重新打开作品完成恢复后再试。本次 AI 请求未发送。」
- [x] 1.3 前端 `types.ts` 错误码联合类型扩展 `story_recovery_required`；确认该码落位失败态、按未发送呈现、无自动重试

## 2. 严格只读接缝

- [x] 2.1 `operations.rs` 新增 `ensure_no_pending_recovery()`：`symlink_metadata` 探测 `next-story-system/save-transaction`，任何存在形态返回 `RecoveryRequired`，不读清单、不清理、零副作用
- [x] 2.2 `operations.rs` 新增 `strict_read_content_tree()`；现有 `open_content_tree()` 改名 `recover_then_read_content_tree()` 并更新全部内部调用点（Tauri 命令名 `open_content_tree` 保持不变）
- [x] 2.3 建立真实待恢复事务夹具：版本 4 作品 + `Committing` 清单 + 已替换一篇正文但内容树/元信息未提交的混合世代；附递归全目录字节快照 helper（含事务目录）

## 3. 入口切换

- [x] 3.1 `story_material.rs`：`read_material()` 与 `read_directory_projection()` 切换 strict 读取；`RecoveryRequired` 不被压成 `DocumentMissing`（修复 `:119` 吞并路径）
- [x] 3.2 `story_search.rs`：`search_project()` 与 `assemble_round_context()` 切换 strict；`assemble` 复用同一棵树（消除 `:534` 二次打开），函数收窄为 `pub(crate)`
- [x] 3.3 `lib.rs`：选区授权链、`ai_directory_projection`、`read_material` 命令与生成链把 `RecoveryRequired` 映射为 `story_recovery_required`；断言该错误下模型请求不发送

## 4. 测试

- [x] 4.1 operations 单元测试：strict 读取对无清单 / 损坏清单 / `Staged` / `Committing` / 事务路径为普通文件，均返回 `RecoveryRequired` 且调用前后全目录快照相同
- [x] 4.2 AI 领域测试：`read_material` / 目录投影 / `search_project` / `assemble_round_context` 在夹具上全部拒绝、零材料返回、全目录快照不变；干净作品上四入口行为与现状等价（回归）
- [x] 4.3 正向对照与命令映射：同一夹具经 `open_existing_project` 完成恢复并删除事务目录；AI 生成链返回 `story_recovery_required` 且无网络发送；固定文案断言

## 5. 验证与收尾

- [x] 5.1 `npm run check` 全量通过（含 Rust 全部测试）
- [x] 5.2 OpenSpec 严格校验通过（change 与规格）
- [x] 5.3 按项目规范提交（git-master：查状态、精确暂存、中文提交信息）；归档时同步 `方向/全量地基审计-2026-09-14.md` 队列第 2 项状态
