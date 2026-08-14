## Context

审查报告确认了一个跨模块矛盾：读取/恢复用 `MAX_NOTEBOOK_BYTES = 10 MiB` 限制本子大小，但 `save_project`/`stage_transaction` 在落盘前不校验输入字节数。超限内容可进入事务目录、把清单切到 `Committing`，随后 `replace_from_staged` 和 `recover_interrupted_save` 都因按 10 MiB 读取失败，作品永久卡死。

其余本 change 处理的问题（`sync_all`、配置读取上限、opener 权限、订阅退订、CI）均为边界一致性与工程基线补全，不改变产品行为。

## Goals / Non-Goals

**Goals:**

- 让保存端的字节上限与读取端一致，任何超过 10 MiB 的本子都无法进入事务，返回专用中文错误。
- 让已存在的超限事务能被安全恢复或明确拒绝，不再永久卡死。
- 让关键保存文件在落盘时调用 `sync_all`，缩小进程中断与断电之间的持久性差距。
- 给 LLM 配置文件读取加上有界上限。
- 移除未使用权限，新增 CI 与 rustfmt/clippy 门禁并让当前代码通过。

**Non-Goals:**

- 不建立项目版本迁移框架（开发期旧项目无发布兼容责任，已有意决定不迁移）。
- 不把 API Key 迁移到系统凭据存储。
- 不收紧 CSP（需运行时验证）。
- 不改变依赖版本策略、不重构 AI 状态机、不细化错误分类。
- 不引入 ESLint。

## Decisions

### 1. 保存侧统一使用 `MAX_NOTEBOOK_BYTES` 校验

在 `run_save_transaction` 开始时（创建任何事务文件之前），对 `draft_content` 与 `main_content` 调用 `as_bytes().len()` 与 `MAX_NOTEBOOK_BYTES` 比较。超限返回新的 `ProjectError::ContentTooLarge`（含哪个本子、当前字节数、上限），不触碰任何可见文件与事务目录。保存端与读取端共享同一个常量，杜绝再次漂移。

前端可提前提示，但后端校验是最终事实源；前端 `EditorSaveState` 已把后端错误信息作为「保存失败：…」展示，无需新增文案管道。

### 2. 恢复侧对超限事务的处置

- `Staged` 阶段：可见文件尚未被触碰，恢复只需丢弃事务目录，因此不再在丢弃前读取/校验暂存本子，改为直接清理。这既修复了超限 `Staged` 卡死，也省去一次无意义读取。
- `Committing` 阶段：必须读取暂存内容前滚提交。若暂存内容超限，返回专用 `ContentTooLarge` 错误并说明人工恢复路径（提示用户暂存事务目录位置），而不是混入 `ReadError`。

由于决策 1 使超限内容无法再进入事务，决策 2 只是针对旧缺陷残留或人工篡改的防御。

### 3. 持久写入使用 `sync_all`

`write_file_atomically` 在 `flush()` 后对临时文件调用 `sync_all()`，在 `persist` 成功后按目标平台同步父目录（Windows 打开目录句柄调用 `FlushFileBuffers`，Unix `File::open(dir)` 后 `sync_all()`）。目录同步失败不影响已完成的保存语义，仅记录，不制造新的恢复路径。

### 4. LLM 配置有界读取

`load_llm_config` 改为先检查元数据长度、超过 64 KiB 直接返回 `ReadError`，再读取解析，与项目文件的有界读取风格一致。

### 5. 移除未使用 opener，dialog 保留

`src/` 无任何 opener 调用；移除 `tauri_plugin_opener` 的 Rust 依赖、插件初始化、`opener:default` 权限与 `@tauri-apps/plugin-opener` npm 依赖。`dialog:default` 保留，因为目录选择（新建作品保存位置）仍在用。

### 6. 订阅可退订

`AiPanelState.subscribe` 返回 `() => void`，从监听数组移除对应 listener。唯一调用点 `ai-panel.ts` 仍只订阅不主动退订（应用生命周期单例），但接口为未来窗口重建/多实例释放预留。

### 7. CI 与静态检查门禁

新增 `.github/workflows/ci.yml`：Linux 跑 `npm ci`、typecheck、前端测试、build、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`；Windows 跑 `cargo test` 与 `cargo check`。本 change 先运行 `cargo fmt` 统一格式并修复全部 clippy 警告，使门禁立刻通过。

## Risks / Trade-offs

- [sync_all 带来小幅保存延迟] → 只在事务暂存文件与清单等关键文件上调用，正常创作规模下可忽略。
- [恢复侧 Staged 直接丢弃不再校验] → 校验目的本是为了丢弃前确认暂存世代，既然要丢弃，校验无意义；行为从「读校验后丢弃」变为「直接丢弃」，更安全。
- [clippy -D warnings 未来可能因新 lint 变脆弱] → 接受，作为质量门禁的一部分，未来 lint 升级在小批次中处理。

## Migration Plan

无数据格式变化，无迁移。CI 与 fmt/clippy 修复不影响运行时行为。

## Open Questions

无。延后项（迁移框架、密钥存储、CSP、依赖策略、状态机、错误分类、ESLint）已明确不属本 change。
