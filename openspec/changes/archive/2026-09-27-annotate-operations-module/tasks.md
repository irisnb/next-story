# 任务：annotate-operations-module

## 1. 模块地图与不变式核实

- [x] 1.1 通读 operations.rs 生产区（约 1419 行），逐条核实候选安全不变式并记录核对锚点（函数名 / 测试名）：唯一写入路径、完成标记、恢复先于读取、失败关闭、有界读取、路径安全、锁归属、恢复与迁移幂等；无法核对的条目不写
- [x] 1.2 写入模块头（`//!`）：职责、核实后的不变式清单（含锚点）、分区地图、保持单文件理由（引用三次评估结论）

## 2. 分区横幅与增量注释

- [x] 2.1 按现有函数聚类插入分区横幅注释；不重排、不移动、不删除任何代码
- [x] 2.2 补齐关键条目的缺失文档注释（只增量；不改既有注释语义）
- [x] 2.3 diff 审计：`git diff` 仅含注释与空行变更，零代码行改动；如有例外回退

## 3. 验证与收尾

- [x] 3.1 `npm run fmt:rust` 通过（`cargo fmt --check`）
- [x] 3.2 `npm run clippy:rust` 通过（`--all-targets -- -D warnings`）
- [x] 3.3 `npm run test:rust` 全绿；附 `cargo check --all-targets` 核对编译警告
- [x] 3.4 对照 `operations-module-map` 规格逐条自查，留证据（不变式锚点清单）
- [x] 3.5 `npm run check` 全量门禁最终确认
- [x] 3.6 最终 diff 审计与工作区状态报告

## 4. 归档

- [x] 4.1 归档 change：确认 `openspec/specs/operations-module-map/spec.md` 进入主规格树，其它规格无意外变更
