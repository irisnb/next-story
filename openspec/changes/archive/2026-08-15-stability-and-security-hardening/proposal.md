## Why

一次全项目审查发现了一批稳定性与安全缺陷：同一作品的并发保存会互相破坏用户正文（数据正确性 P0）、LLM 配置保存时钥匙串与磁盘文件不在同一事务导致密钥可能发往错误服务（P0）、API Key 明文交还前端（P1），以及若干前端竞态和规格陈旧。这些问题当前大多靠前端自律或单线程假设掩盖，必须在交付前集中修复，把边界从「自觉」变成「强制」。

## What Changes

- **后端并发安全**：为同一作品串行化打开/保存/迁移操作（进程内互斥），保存事务使用唯一 ID 与世代校验，杜绝并发保存互相破坏。
- **LLM 配置事务化**：钥匙串与磁盘配置保存合并为原子流程，杜绝「新密钥 + 旧服务地址」分裂窗口。
- **密钥不回流前端**：`load_llm_config` 不再返回明文 `api_key`，改为返回 `has_api_key`；测试连接与生成由后端复用钥匙串内密钥。
- **协议收紧**：AI 生成请求拒绝未知字段（`deny_unknown_fields`），从协议层强化「生成命令只接受冻结选区与临时对话」。
- **迁移框架加固**：回滚原子化且失败显式上报；迁移步骤幂等并具备「中途崩溃后再次打开」的恢复语义。
- **大小限制加固**：从「先看 metadata 再读」改为句柄限量读取，避免竞态下无界分配。
- **前端竞态修复**：AI 预检冻结作品身份、离开授权顺序调整、打开作品串行化、`showProject` 改为「先准备后交换」。
- **能力最小化**：Tauri capabilities 收窄为实际使用的 `dialog:allow-open`，移除未使用的 `window:allow-destroy`。
- **规格对齐**：修正 `project-readme` 过时的 `.txt` 引用与失效文件索引、`structured-notebook-storage` 前端校验语义（实现改为校验拒绝而非静默规范化）、欢迎页入口措辞。
- **测试加固**：补齐真实端到端零写回测试、同一作品并发保存测试、后端 AI 请求白名单测试；并把 `tests/` 纳入 typecheck 修复失效类型引用。

## Capabilities

### New Capabilities

（无。所有修复都属于对既有 capability 的需求收紧或行为修正。）

### Modified Capabilities

- `desktop-project-lifecycle`: 新增「同一作品操作必须串行化」「读取大小限制使用有界读取」需求；加固迁移回滚原子性与幂等恢复；澄清欢迎页入口（新增 LLM 配置入口）。
- `llm-configuration`: 新增「配置保存是原子的」「加载不返回明文密钥」「生成请求拒绝未知字段」需求。
- `selection-ai-invocation`: 新增「AI 预检在异步前冻结作品身份」需求（修复切换作品后旧选区误发）。
- `project-readme`: 修正「README explains where each kind of data lives」场景中过时的 `.txt` 文件名引用为 `.json`。

## Impact

- **后端（Rust）**：`src-tauri/src/project/operations.rs`、`migration.rs`、`mod.rs`、`notebook.rs`、`validation.rs`、`llm_config/mod.rs`、`secret_store.rs`、`lib.rs`、`capabilities/default.json`、`tests/`。
- **前端（TS）**：`src/types.ts`、`editor.ts`、`structured-notebook.ts`、`ai-feature*.ts`、`new-project-form.ts`、`project-leave-flow.ts`、`leave-guard.ts`、`project-api.ts` 等。
- **规格/文档**：上述 4 个 capability 的 spec delta；`README.md`。
- **无新依赖**；不改变产品功能与铁律语义（AI 仍零写回）。
