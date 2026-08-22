## 1. 前端输入与文档状态

- [x] 1.1 为快捷键处理增加文本输入焦点判断，并覆盖 AI 面板、查找框和 contenteditable 场景
- [x] 1.2 增加当前文档存在未保存修改时的删除后果确认与取消保护
- [x] 1.3 为文档读取失败增加 generation 安全的错误处理，保持旧编辑器状态
- [x] 1.4 补充快捷键、删除确认和加载失败的前端回归测试

## 2. Rust 内容树与事务恢复

- [x] 2.1 为内容树校验和子树收集增加统一最大深度及显式栈遍历
- [x] 2.2 增加超深内容树的结构错误测试并确认原文件不变
- [x] 2.3 补充 manifest 缺失/损坏在暂存和提交阶段的恢复测试
- [x] 2.4 实现保守事务恢复：不确定的提交阶段保留现场并拒绝打开

## 3. 验证与收口

- [x] 3.1 运行前端定向测试、typecheck 和 lint
- [x] 3.2 运行 Rust project/content-tree 测试、fmt 检查和 clippy（可用时）
- [x] 3.3 运行项目总检查并修复本 change 范围内的回归
- [x] 3.4 对照 `.omo/systematic-project-hardening-roadmap/` 更新批次完成证据并确认下一批次

## 验证备注

- `npm run check`：通过；前端 411 项测试通过，Rust 78 项通过、1 项因需要外部 DSH 环境而忽略。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：仍报告本 change 之前已有的格式差异（`src-tauri/src/lib.rs`、`migration.rs`、`operations.rs`、`tests/project_test.rs`）；本 change 未执行全仓格式化，避免扩大范围。
- `openspec validate` 需使用当前 CLI 的实际参数格式重新执行；不影响代码验证结果。
