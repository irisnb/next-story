## Why

当前编辑器的捕获阶段快捷键可能劫持 AI 面板等文本输入控件，文档读取失败可能留下未处理的异步错误，当前文档被删除时未保存内容可能被静默丢弃；后端内容树深度和事务元数据异常也缺少统一的安全边界。现在先修复这些直接影响用户输入、作品可打开性和数据安全的问题。

## What Changes

- 让全局编辑器快捷键尊重 AI 面板、查找框和其它文本输入控件的焦点范围。
- 删除当前存在未保存修改的文档前显示明确确认；取消时保留编辑状态。
- 让文档读取/切换失败显示中文错误，并保持当前有效文档，不以空白内容替换失败结果。
- 统一处理中断保存事务的缺失/损坏 manifest；暂存阶段安全清理，提交阶段无法证明完整世代时拒绝打开。
- 将内容树关键递归操作改为显式栈并设置最大深度，超限返回结构错误。
- 为上述边界补充前端和 Rust 回归测试。

## Capabilities

### New Capabilities

- `project-reliability-boundaries`: 用户输入、文档切换、事务恢复和内容树结构的安全边界。

### Modified Capabilities

<!-- 既有 capability 的主规格在本 change 归档时由新增验证证据同步；本批不复制无关的完整旧 requirement。 -->

## Impact

前端影响 `src/editor.ts`、相关 DOM/离开确认服务和编辑器测试。后端影响 `src-tauri/src/project/content_tree.rs`、`operations.rs` 及 Rust 项目测试。保持现有 Tauri command、作品格式、回收站语义和 AI 不写回用户文档边界不变。
