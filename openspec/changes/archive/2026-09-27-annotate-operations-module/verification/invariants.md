# operations 模块不变式核对表

核对日期：2026-09-27。范围：`operations.rs` 生产区及相关内联测试；锁归属另核对 `lib.rs`，迁移重跑另核对 `migration.rs`。本表是模块地图的核对证据，不增加行为要求。

| 不变式 | 判定（采用/改措辞/剔除） | 锚点（函数/测试名） | 核实方法一句话 |
|---|---|---|---|
| 1. 唯一内容写入路径 | 改措辞：限定本模块生产路径的文件内容写入，不包括测试夹具及目录创建/删除 | `write_file_atomically`、`transactional_write_mapped`、`replace_from_staged`；`successful_save_commits_new_generation_and_removes_transaction_dir` | 通读生产区并检索 `fs::write`、`File::create`、`OpenOptions`、`write_all`、`fs::copy`、`fs::rename`：直接 `fs::write` 仅见于测试，唯一内容 `write_all` 在原子写实现，`OpenOptions` 仅以只读目录句柄同步父目录，事务内容写入最终也调用原子写。 |
| 2. 元信息末项与恢复决策 | 改措辞：映射清单顺序提交，旧清单固定顺序；恢复按阶段丢弃暂存或前滚，不按可见 `project.json` 选择前滚/回滚 | `METADATA_TARGET`、`read_transaction_manifest`、`commit_staged_generation`、`recover_interrupted_save`、`transactional_restore`；`fault_after_main_replace_shows_new_notebooks_but_old_metadata`、`open_after_main_replace_fault_rolls_forward_metadata` | 核对清单读取强制元信息最后、旧三文件提交顺序，以及 `Staged` 清理 / `Committing` 校验后前滚分支；故障测试验证元信息最后补齐，迁移回滚是把备份作为目标世代前滚。 |
| 3. 恢复先于用户读取 | 改措辞：仅用户打开、内容树读取和文档读取入口；底层助手与 AI 严格读取不自行恢复 | `open_project`、`recover_then_read_content_tree`、`read_document`、`strict_read_content_tree`；`recover_then_read_content_tree_recovers_pending_transaction` | 对照三个用户入口先恢复后读取的调用次序及测试的事务目录清理、正文前滚断言，另确认严格读取只探测待恢复状态。 |
| 4. 严格读取失败关闭与内容校验拒绝 | 改措辞：限定事务现场探测和内容树/正文校验，不承诺所有底层 I/O 错误原文均为中文 | `ensure_no_pending_recovery`、`strict_read_content_tree`、`read_content_tree`、`read_and_validate_notebook`；`strict_read_content_tree_fails_closed_on_committing_transaction`、`strict_read_content_tree_fails_closed_without_manifest`、`strict_read_content_tree_fails_closed_on_corrupt_manifest`、`strict_read_content_tree_fails_closed_when_transaction_path_is_plain_file`、`strict_read_content_tree_fails_closed_on_staged_transaction` | 核对事务路径存在即 `RecoveryRequired`、五个测试的前后目录逐字节快照相等，以及内容校验失败直接返回 `ProjectError` 而不写入空白替代的分支。 |
| 5. 有界文件内容读取 | 改措辞：各类内容按相应常量读取，通用暂存复制使用正文上限，不承诺所有阶段均用最窄类型上限 | `MAX_METADATA_BYTES`、`MAX_CONTENT_TREE_BYTES`、`MAX_NOTEBOOK_BYTES`、`read_bounded_string`、`replace_from_staged`；`bounded_read_rejects_file_that_grew_past_limit_after_size_check` | 通读所有生产文件内容读取调用，确认最终以单句柄 `take(max + 1)` 限量并检查实际字节数，增长测试验证旧长度检查之后增大的文件仍被拒绝。 |
| 6. 路径安全校验 | 改措辞：限定各校验入口实际覆盖的路径，不宣称全路径祖先检查或无竞态保证 | `validate_project_structure`、`validate_required_dir`、`validate_required_file`、`validate_no_reparse_point`、`validate_path_stays_under_root`、`read_and_validate_notebook`、`validate_migration_source_files`、`read_transaction_manifest`、`resolve_manifest_target` | 核对结构校验的链接属性与规范路径前缀检查、正文/迁移源对指定路径自身的链接检查，以及清单相对路径和允许目标检查；这些检查不能等同于每次 I/O 都检查所有祖先路径。 |
| 7. 作品锁归属调用层 | 采用：已有作品操作由命令层持锁，本模块生产函数不取锁 | `lib.rs::open_project`、`lib.rs::open_content_tree`、`lib.rs::read_document`、`lib.rs::save_document`；`concurrent_saves_of_same_project_serialize_without_mixing_generations`、`concurrent_saves_of_different_projects_run_in_parallel` | 核对命令层 `locks.acquire` 覆盖操作全程，通读生产区确认无取锁调用，并对照内联测试的同作品串行与不同作品可并行断言；不把新建作品入口描述为已有作品持锁操作。 |
| 8. 恢复重放与迁移可重跑 | 改措辞：完整有效暂存可重放，迁移步骤遵循模块头的幂等要求；损坏现场仍可能拒绝恢复 | `replace_from_staged`、`delete_manifest_target`、`recover_interrupted_save`；`open_discards_transaction_without_manifest_and_keeps_visible_generation`、`open_discards_staged_structure_change_and_loads_old_generation`、`open_rolls_forward_committing_structure_change_to_complete_generation`；`migration.rs` 模块头及 `reopen_after_crash_during_migration_commit_rolls_forward_from_manifest`、`reopen_after_crash_before_metadata_during_migration_commit_completes` | 核对替换复制而不消耗暂存、重复删除 `NotFound` 视为成功、无清单/暂存阶段清理与提交阶段前滚，并抽查迁移已删除旧文件后再次打开仍恢复完整世代的测试。 |

## 未采用的绝对化表述

没有整条候选被剔除；上表保留八项可核对内容，但剔除了以下原候选中的过宽推断：所有读取都会恢复、恢复据可见元信息选择前滚或回滚、每次读取都使用对应类型的最窄上限、所有路径均完成祖先链接检查、任意损坏现场都可安全重跑。理由分别见第 2、3、5、6、8 行。底层 I/O 错误可能保留系统原文，故第 4 条不宣称每种错误文字都是中文。

## 规格逐条自查

- 写入核心模块携带可核对的模块地图：模块头含职责、八项核实后不变式、与八个新增横幅同名同序的地图、三次保持单文件的评估记录；生产区的测试辅助保持原位。
- 安全不变式逐条可核对：上表按编号关联实现与测试锚点，明确候选措辞收窄的范围；路径检查的证据是实现，不冒称有专门链接攻击测试。
- 结构决策延续：模块头注明后续拆分必须重估共享清单/前滚机制，前提未变时不得仅因行数或导航拆分，并指向 `operations-module-map`。

## 增量文档注释清单

- 常量：`MAX_METADATA_BYTES`、`MAX_NOTEBOOK_BYTES`。
- 枚举项：`ManifestPurpose::{Save, MigrationRollback, Migration}`、`StagedAction::{Replace, Delete}`。
- 字段：`StagedFile::{staged, target, action}`。
- 方法/函数：`TransactionLayout::new`、`read_transaction_manifest`、`write_file_atomically`、`validate_no_reparse_point`。

共 14 个此前没有文档注释的条目；其余既有文档注释与所有代码行保持原样。
