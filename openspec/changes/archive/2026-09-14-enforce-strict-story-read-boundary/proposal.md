# AI 严格只读边界（enforce-strict-story-read-boundary）

## Why

2026-09-14 全量地基审计 P0-1（红线级，已逐行复核坐实）：AI 的「受控只读」入口经 `story_material.rs:119` 调用 `operations.rs:203 open_content_tree()`，后者先执行 `recover_interrupted_save()`——**一次 AI 读取可能前滚正文、内容树、元信息并删除事务目录**，打穿「AI 运行路径无作品写入能力」的结构性保证。写入的虽是用户自己保存过的数据（非 AI 生成文本），且需「恰好存在半截保存事务」才触发；但阶段 6（B：Agent 按需补读）将把这条路径变成 AI 主动调用的工具，必须在盖楼前闭合红线。现有测试（`reads_never_modify_project_files` 等）只对比正文文件且测试作品干净，构造不出触发条件，因此从未抓到。

## What Changes

- **拆两族入口**（`operations.rs`）：
  - 新增 `strict_read_content_tree()`：AI 专用，读取前仅探测是否存在待恢复事务现场，发现即失败关闭，绝不解析、清理、提交或丢弃事务；
  - 现有 `open_content_tree()` 改名 `recover_then_read_content_tree()`：用户路径专用（消除语义含糊导致的再次误用）；**Tauri 命令名 `open_content_tree` 保持不变，前端 API 零变化**。
- **探测语义**：新增 `ensure_no_pending_recovery()`，仅对 `next-story-system/save-transaction` 做 `symlink_metadata` 存在性探测——目录、普通文件、链接、清单缺失/损坏、`Staged`/`Committing` 一律视为「需要恢复」；不调用 `read_transaction_manifest()`、`cleanup_transaction()` 或 `recover_interrupted_save()`。
- **切换 7 个 AI 路径入口到 strict**：`read_material()`、`read_directory_projection()`、`search_project()`、`assemble_round_context()`（并复用同一棵 strict 树，消除 `story_search.rs:534` 的二次打开）、选区授权链（`generate_ai_thinking` / `ai_send_message`）、`ai_directory_projection()` 命令、`read_material` Tauri 命令。
- **结构化错误契约**：`ProjectError::RecoveryRequired`、`MaterialDenialReason::RecoveryRequired`、`GenerateAiErrorCode::StoryRecoveryRequired`（`llm_config/mod.rs:118` 枚举扩展）+ 前端 `types.ts` 错误码联合类型扩展；固定用户文案「作品有未完成的保存，请重新打开作品完成恢复后再试。本次 AI 请求未发送。」；该原因**不得**被压成 `DocumentMissing`（当前 `story_material.rs:119`、`story_search.rs:518` 会吞并树读取错误）。
- **前端最小配套**：本轮显示为未发送的失败 + 固定恢复提示；不自动重试；**不提供** AI 面板一键恢复（用户自救 = 重新打开作品，既有流程完成恢复——保持用户操作与 AI 权限的边界）。
- **测试**：真实待恢复事务夹具（版本 4 作品 + `Committing` 清单 + 半提交混合世代）+ 全目录字节快照 helper；三类测试见 tasks。

## Capabilities

### New Capabilities

（无——本 change 不新增产品能力，只收紧既有只读边界。）

### Modified Capabilities

- `controlled-story-read-visibility`：新增「AI 受控读取路径使用严格只读作品读取」要求——发现待恢复事务现场时拒绝 AI 读取、不返回材料、不触碰事务与任何作品文件（拒绝前后全目录逐字节不变）；用户主动路径保留既有先恢复再读取行为。
- `automatic-story-context`：新增「常规讨论取材前验证无待恢复事务」要求——验证失败本轮标记为 rejected，不组装部分材料、不回退可见混合世代、不发送模型请求、不产生材料出处与 `sent_confirmed`；合法未保存快照不能绕过（可见性与文档身份依赖一致内容树）。

## Impact

- **Rust**：`operations.rs`（探测 + strict 函数 + 改名）、`story_material.rs`（2 入口）、`story_search.rs`（2 入口 + 复用树）、`lib.rs`（错误映射与命令接线）、`llm_config/mod.rs`（错误码枚举）。
- **前端**：`types.ts` 错误码联合类型扩展；失败态呈现沿用既有错误显示路径，不改交互结构。
- **规格**：两份 delta（如上）。
- **明确不改**：用户路径行为（打开作品、保存、结构操作、Word 导出仍先恢复——导出是用户主动操作且必须导出一致世代，审计 P2-13 的文档澄清随本 change 规格化）；Tauri 命令名与前端 API；不做 `StrictStoryReader` 接口对象（阶段 6 前再建，当前只有一棵树和自由函数，对象层不增加实质保护）；不做 AI 面板恢复入口。
- 归档时同步 `方向/全量地基审计-2026-09-14.md` 队列第 2 项状态。
