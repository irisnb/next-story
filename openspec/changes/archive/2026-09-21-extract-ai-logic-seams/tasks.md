# 任务：extract-ai-logic-seams

## 1. 安全网先行（reducer 直测欠账）

- [x] 1.1 新建 `tests/ai-panel-reducer.test.ts`：45 个 case 各至少一个直测断言，只描述迁移前后状态，不引用实现内部
- [x] 1.2 锁定「未知/非法迁移返回同一引用」契约：对各族拒绝路径做引用相等断言（`toBe` 同一实例）
- [x] 1.3 跑前端全量测试，确认新增直测与既有套件全部通过

## 2. 类型层拆分（ai-panel-events.ts）

- [x] 2.1 新建 `src/ai-panel-events.ts`：收纳 `AiPanelEvent` 联合、`PendingReadingRequest`、`ReadingProgress`；`ai-panel-reducer.ts` 改为导入并 re-export；`ai-panel-state.ts` 零改动；全仓库不出现第二份联合定义
- [x] 2.2 前端全量套件 + typecheck + ESLint 验证（仅允许 import 路径差异）

## 3. 第一刀：按需补读授权交互提取

- [x] 3.1 新建 `src/ai-feature-on-demand-reading.ts`：原 `setupAiFeature` 内补读交互块（refresh/resolve/toggle，约 L410–471）闭包变量显式化为显式依赖参数（state 访问器 + 注入的后端调用），不引 DOM
- [x] 3.2 `setupAiFeature` 改为装配并调用新模块；`AiFeatureWiring` 与 `AiDockActions` 契约签名不动，只改实现来源
- [x] 3.3 专项复核：`hiddenDocumentIds()` 等访问器保持「每次调用时求值」，确认新模块无任何快照化（可见性红线）
- [x] 3.4 `agent-on-demand-reading.test.ts` 与前端全量套件通过（零语义修改）

## 4. 第二刀：删除＋撤销机制提取

- [x] 4.1 新建 `src/ai-feature-delete-undo.ts`：`pendingUndo` 计时器家族（约 L473–532）＋纯函数 `summaryToRecord`（L119–140）搬迁，显式依赖参数化
- [x] 4.2 `destroy()` 对计时器的清理顺序逐条对照原实现，不重排任何清理步骤
- [x] 4.3 前端全量套件通过（零语义修改）

## 5. P2-12：ProjectLocks 改 Weak 回收（用户已确认 parking_lot 方案，2026-09-21）

- [x] 5.1 `src-tauri/Cargo.toml` 将 `parking_lot` 提为直接依赖，版本对齐 Cargo.lock 在册版本（不引入新外部代码）
- [x] 5.2 `project/mod.rs`：`inner` 改为 `HashMap<PathBuf, Weak<parking_lot::Mutex<()>>>`；`acquire` 用 `lock_arc()` 返回自持 Arc 的 guard，条目无持有人时失效、下次重建；`acquire` 公开签名不变，~30 个调用点零改动
- [x] 5.3 既有并发测试（同作品串行化 / 跨作品并行）通过；新增「条目失效重建后同路径仍互斥」测试
- [x] 5.4 `cargo test` + `cargo check --all-targets` 通过且零编译警告

## 6. 边界测试与收尾验证

- [x] 6.1 按 `ai-module-boundaries` 规格补静态边界测试：生产代码对 `ai-panel-reducer` 的导入仅 `ai-panel-state.ts`；`ai-dock.ts` 不导入 `ai-feature.ts`
- [x] 6.2 全量终验：前端全量 / Rust 单元＋集成 / 驱动 / 离线验证 / 可靠性 / typecheck / ESLint / 生产构建全部通过
- [x] 6.3 记录拆分前后行数与模块结构快照（`ai-feature.ts` 预期约减 145 行、`ai-panel-reducer.ts` 约 230 行），供归档时回记审计文档 8a 行
