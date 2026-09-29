# 应用单实例（enforce-single-instance）

## Why

用户实测发现应用可以同时打开两个实例（双开）。两个实例各自持有编辑器、保存链路、AI 常驻会话，同时操作同一个作品文件夹时，保存与版本化可能互相覆盖——这是**数据完整性风险**，不只是体验问题：后端的一切进程内一致性防护（含作品锁）只在单进程内有效，双开完全绕开它们。需要应用级单实例约束。

## What Changes

- 集成 Tauri 官方 `tauri-plugin-single-instance` 插件：同一时刻最多允许一个 Next Story 实例运行。
- 第二次启动的行为：**不创建主窗口、立即退出**，并把已有实例的主窗口呈现给用户（被遮挡则置前，被最小化则恢复）。
- 无 UI 变更、无前端代码变更、不动作品锁机制。

## Capabilities

### New Capabilities

- `app-single-instance`：应用单实例规则——第二实例立即退出且不创建窗口，重复启动时聚焦已有主窗口。

### Modified Capabilities

（无——现有 specs 均不涉及应用实例数量。）

## Impact

- 代码：`src-tauri/Cargo.toml`（新增插件依赖，按项目惯例 `~` 锁版）、`src-tauri/src/lib.rs` 的 `run()`（在 Builder 链**首位**注册插件，回调聚焦主窗口）。
- 不涉及：前端、作品数据结构、AI 会话链路、作品锁。
- 依赖：新增一个 Tauri 官方插件 crate，无其他传递影响。
- 验证：双开探测（进程数＝1、窗口数＝1、已有窗口被聚焦/恢复）＋首启回归。
