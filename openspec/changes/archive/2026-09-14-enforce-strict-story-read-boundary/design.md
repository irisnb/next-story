# 设计：AI 严格只读边界

## Context

- 根因（ora-2 审计 + 人工复核坐实）：`story_material.rs:109 read_material()` → `operations.rs:203 open_content_tree()` → `operations.rs:205 recover_interrupted_save()`（实现见 `:824`）。恢复可前滚正文/内容树/元信息并删除 `save-transaction` 目录。同样问题覆盖目录投影（`story_material.rs:293`）、检索（`story_search.rs:351`）、自动取材（`story_search.rs:507`，且 `:534` 二次打开内容树）、选区授权链（`lib.rs:1049/1162/1437`）、`ai_directory_projection`（`lib.rs:845`）与 `read_material` 命令（`lib.rs:885`）。
- 用户路径清单（保留先恢复再读取）：打开作品（`mod.rs:211 open_existing_project` → 迁移 → `open_project`）、前端内容树与文档读取（`lib.rs:628/646`）、保存正文（`operations.rs:405`）、结构操作（`operations.rs:254 run_structure_change` 统一入口）、迁移与回滚（`migration.rs:223`）、Word 导出（`export.rs:286`）。
- 事务目录唯一：保存、结构变更、迁移与回滚都复用 `next-story-system/save-transaction` 与 `ManifestPurpose`（`operations.rs:522`）；`migrations/backup-*` 是历史备份，不代表待恢复事务（`migration.rs:375`）。
- 内存函数（`read_material_from_tree`、`search_documents`、`validate_snapshot`）不触磁盘事务，无需改动（`story_material.rs:330`）。
- 错误码契约无规格枚举（grep 零命中）；`GenerateAiErrorCode` 位于 `llm_config/mod.rs:118`，前端联合类型在 `types.ts:128`。

## Goals / Non-Goals

**Goals:**
- AI 读取路径零写盘成为结构性保证：任何待恢复现场 → 结构化拒绝，全目录逐字节不变。
- 用户路径行为完全不变（含导出）。
- 「需要恢复」作为独立错误保留到生成结果层，前端能给出可执行的自救提示。
- 测试用真实事务夹具锁死该缺陷类别，防回潮。

**Non-Goals:**
- 不做 `StrictStoryReader` 接口对象（阶段 6 建工具执行器时再建）。
- 不做 AI 面板一键恢复或新的恢复命令（混淆用户操作与 AI 权限边界）。
- 不改 Tauri 命令名与前端 API 契约。
- 不处理审计队列第 3 项的锁失败吞并（`lib.rs:1473`）与后端并发上限——独立 change。

## Decisions

1. **函数级 strict/recover 分流，而非对象层**。只有一棵内容树和若干自由函数，新增 reader 对象不增加实质保护；改名 `recover_then_read_content_tree()` 让语义在调用点自我声明，防止再次误用。Tauri 命令名保留 `open_content_tree`，前端零改动。
2. **探测只看存在性，不读清单**。`ensure_no_pending_recovery()` 用 `fs::symlink_metadata(save-transaction)`：`NotFound` 放行；任何存在形态（目录/文件/链接/清单缺失或损坏/Staged/Committing）一律 `RecoveryRequired`；其他 IO 错误返回普通读取错误。不调用 `read_transaction_manifest()` / `cleanup_transaction()` / `recover_interrupted_save()`——探测本身必须零副作用。
3. **三层独立错误 + 固定文案**。`ProjectError::RecoveryRequired`（operations 层）、`MaterialDenialReason::RecoveryRequired`（材料拒绝层）、`GenerateAiErrorCode::StoryRecoveryRequired`（生成结果层，snake_case 序列化）。固定文案：「作品有未完成的保存，请重新打开作品完成恢复后再试。本次 AI 请求未发送。」前端按错误码分流（扩展 `types.ts` 联合类型），**不得**解析中文 message 判断状态；`story_material.rs:119` / `story_search.rs:518` 现有的「树错误压成 DocumentMissing」路径必须放行该原因。
4. **`assemble_round_context()` 只 strict 读一次树**，随后直接调用 `read_material_from_tree()`（消除 `story_search.rs:534` 二次打开）；该函数收窄为 `pub(crate)`。
5. **导出保留先恢复**：用户主动操作且必须导出一致世代；行为不变，本 change 顺带在提案层澄清（审计 P2-13 的文档面）。
6. **失败关闭的用户自救 = 既有「重新打开作品」**。正常进程内保存与 AI 读取共用作品锁，AI 通常看不到进行中的健康事务；真实触发场景是「保存/结构变更/迁移提交期间崩溃 → 应用恢复后 AI 先于用户重新打开作品」。拒绝不自动重试、不由 AI 命令触发恢复。

## Risks / Trade-offs

- [严格拒绝在某些边角（如事务目录残留垃圾文件）显得激进] → 与保存流程的语义一致（保存同样要求先处理旧事务）；用户重新打开作品即恢复或丢弃，自救路径明确且已有 UI。
- [改名 `open_content_tree` 引发内部调用点遗漏] → 编译器保证；逐一更新调用点并在 tasks 中验证 `cargo test`。
- [前端新错误码未处理时落入兜底错误显示] → 固定文案由后端提供，兜底显示仍是可读中文；tasks 含失败态呈现检查。
- [夹具构造复杂（半提交世代）] → 复用 operations 既有故障注入思路（`operations.rs:1405` 附近的全目录快照与暂存测试 helper）。

## 测试计划

夹具：版本 4 作品；`Committing` 映射清单；已替换一篇正文但内容树/`project.json` 未提交（可辨认的混合世代）；快照 helper 递归记录作品内全部相对路径、类型与字节（含事务目录）。

1. **operations 单元测试**：`strict_read_content_tree` 对无清单/损坏清单/`Staged`/`Committing`/事务路径为普通文件，均返回 `RecoveryRequired` 且调用前后全目录快照相同。
2. **AI 领域测试**：`read_material`、目录投影、`search_project`、`assemble_round_context` 全部拒绝为 `RecoveryRequired`、零材料返回、全目录快照不变；干净作品上四入口行为与现状等价（回归）。
3. **正向与命令映射**：同一夹具经 `open_existing_project` 完成恢复并删除事务目录；AI 生成链返回 `story_recovery_required` 且**模型请求未发送**；固定文案断言扩展现有 `lib.rs:239` 模式。

现有 `llm_config_test.rs:883` 的「AI 后文件不变」测试只覆盖无事务场景，保留作回归，不替代上述新测试。

## Migration Plan

纯代码行为收紧，无数据迁移；回滚 = git 还原。用户可见差异仅限「待恢复事务 + AI 先行读取」这一边角场景，从「静默恢复并继续」变为「明确拒绝 + 指引」。

## Open Questions

无阻塞项。固定文案的最终字句在 apply 实现时随代码一并给出（与提案文案一致的基调）。
