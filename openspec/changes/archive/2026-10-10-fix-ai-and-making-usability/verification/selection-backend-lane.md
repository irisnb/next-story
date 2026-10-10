# 选区后端修复 lane 验证记录（tasks 组 1：1.1–1.6）

> change: `fix-ai-and-making-usability` design D4。lane：后端选区修复（fixer-rust）。
> 不负责真机组 2；组 2 的桌面 CDP 端到端由主助手/验证 owner 执行。
> 本文件仅为证据，不改 tasks.md。

## 1.1 实现前可行性验证（派生方案）

**结论：方案可行；确需最小扩展请求契约以携带结构化选区范围。**

- 现状缺陷（代码可证）：`authorize_selection_sync` 在 `material.content`（canonical
  notebook **JSON 字符串**）上对纯文本选区做 `contains`；`authorized_selection_from_material`
  做 `find`。对单段落纯文本恰好命中 JSON 转义前的原文字面而“碰巧通过”，但对跨段落、
  行内 marks、引号 / 反斜杠（JSON 转义 `\"` / `\\`）、列表前缀 / 缩进、部分列表项、
  跨首尾块裁切必然失败。全文纯文本投影后 `contains` 亦不足（见 design D4：部分列表项
  投影不含前缀、跨块边界的 LF / 前缀差异）。
- 采用的派生语义：**由受控结构化材料按前端同源语义派生目标选区并验证**。后端在授权
  材料（canonical notebook JSON）上复刻前端 `collectSharedBlocks` +
  `serializeSelectionToPlainText` 的位置模型（ProseMirror：doc token 不计位、首块从 0、
  文本按 **UTF-16 码元**计长），据请求携带的结构化选区范围派生原文，返回值取自派生结果。
- 为何必须扩展契约：仅凭 `selected_text` + 材料无法唯一还原“部分列表项 / 跨首尾块裁切”
  的边界（纯文本已丢失前缀 / 边界信息）。因此最小扩展：请求携带**结构化选区范围**
  `selection_from` / `selection_to`（ProseMirror 文档位置，左闭右开），**不是** canonical
  JSON 字符串偏移。前端 `SelectionSnapshot.from` / `to` 本即该坐标。
- 夹具可行性（含部分列表项 / 嵌套列表 / 跨首尾块裁切）：`selection_projection.rs`
  18 条单测逐字对齐前端 `serializeSelectionToPlainText` 既有用例（含
  `raw_json_contains_is_insufficient_where_projection_succeeds` 回归钉：对旧
  `contains` 机制先失败、对新派生通过）；跨语言共享夹具
  `tests/fixtures/selection-projection-samples.json`（16 例）由前后端各自断言一致。

## 实现与安全边界（1.2 / 1.3）

- 新增 `src-tauri/src/project/selection_projection.rs`：纯函数派生，UTF-16 位置模型，
  含字母 / 罗马编号、嵌套缩进、空行、无首尾 LF；越界、非法 JSON、切在代理对中间均返回
  `None`（失败关闭）。
- `ai_orchestration.rs` 选区授权路径改为：
  - 有选区**必须**携带结构化范围，缺范围即 `invalid_selection_error`（不再以 JSON 子串
    包含放行）；
  - 派生结果必须非空且等于请求声明的选区（允许请求侧整段首尾空白差异，保持既有 trim
    语义）；否则失败关闭；
  - 返回值来自派生结果，绝不直接回传原始 `selected_text`。
- 既有校验全部保留：`authorize_selection_sync` 仍经 `read_material` 校验作品 / 文档 /
  可见性 / 版本 / 快照身份；快照版本必须由内容派生（防伪造）；有选区无材料失败关闭；
  未删除任何列表符号 / 前缀、未放宽匹配。（授权边界只收紧或等价。）
- 未复用 `project/story_search.rs::extract_plain_text`（其无分隔拼接不用于选区判定）。

## 契约扩展点（最小）

- Rust `llm_config::GenerateAiRequest` 三变体新增可选 `selection_from` / `selection_to`。
- `ai_send_message` 命令新增 `selection_from` / `selection_to` 入参。
- 前端 `GenerateAiRequest` 三变体、`ai-session-transport` 身份映射、`project-api`
  `aiSendMessage` 入参新增同名可选字段；首轮冻结位置（summon / 直接提问 / 重试材料）
  在**有来源身份时**携带范围（无身份时后端本就拒绝裸材料）。

## 命令与真实结果

| 命令 | 结果 |
|------|------|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib project::selection_projection` | ok，18 passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib ai_orchestration` | ok，20 passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ok，530 passed / 0 failed / 1 ignored |
| `cargo test --manifest-path src-tauri/Cargo.toml`（全量，含集成测试） | 全绿（各 target 0 failed） |
| `node --test tests/selection-serialization.test.ts` | ok，30 passed（含 16 条共享夹具样例） |
| `node --test tests/ai-feature-selection-authorization.test.ts` | ok，5 passed |
| `npm run test:frontend` | ok，1371 passed / 0 failed |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `cargo clippy --all-targets -- -D warnings` | 通过 |
| `cargo fmt --check`（修复后） | 通过（仅本 lane 触及的 Rust 文件被格式化） |

未运行：`npm run check` 总门禁、真机 CDP 端到端（组 2）——按 lane 约定留给集成后的主助手。

## 正例（应通过，1.4）

`structured_derivation_accepts_complex_legal_selections` 覆盖：跨段落、跨行内 marks、
含引号 / 反斜杠、部分列表项、跨首尾块裁切、嵌套列表完整前缀与缩进。逐例断言
`authorize_selection_sync` 通过且派生原文等于请求声明。

## 安全负例（应拒绝，1.4）

`selection_authorization_fails_closed_on_missing_range_bounds_version_and_hidden` 覆盖：
有选区缺结构化范围、范围越界、版本身份不符、隐藏文档（关闭 AI 可见性）。
另：`valid_snapshot_is_authorized_and_wrong_snapshot_is_rejected`（伪造 / 非法快照、
声明选区不在材料内）、`authorized_selection_text_extracts_material_and_fails_closed`
（伪造选区、缺范围、有选区无材料）、既有 `selection_identity_error`（缺身份）。

## 跨语言一致性（1.5）

`tests/fixtures/selection-projection-samples.json` 为前后端共享选区夹具：
- Rust：`selection_projection_matches_shared_frontend_samples`（`derive_selection_text`）；
- 前端：`tests/selection-serialization.test.ts` 遍历同一夹具（`serializeSelectionToPlainText`）。
任一实现漂移即在对端暴露。

## 残余未知 / 风险（如实）

- 用户现场“召唤被误拒”的**唯一根因未确证**：`invalid_selection_error`（“AI 请求内容无效，
  请重试”）覆盖 ≥10 个分支（缺身份、取锁 / 初始化失败、`read_material` 各类拒绝、
  派生不符、有选区无材料等）。本 lane 修复了代码可证的**子串匹配**不一致分支，并在真机
  端到端前不能断言现场唯一原因已被消除。真机验证由组 2 执行。
- 契约扩展（新增可选字段）属最小范围；旧请求缺字段仍可解析，但有选区而缺范围现在
  失败关闭——前端冻结位置（summon / 直接提问 / 重试材料）在有来源身份时均已携带，
  无身份本就拒绝裸材料。已实现的单测与前端全量测试覆盖该契约。
- UTF-16 位置模型：与前端 JS `String.length` 对齐；代理对中间切分失败关闭（不会切出
  半个字符）。
