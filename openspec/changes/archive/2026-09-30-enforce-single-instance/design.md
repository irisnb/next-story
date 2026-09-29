# 设计：应用单实例

## Context

- 现状：`src-tauri/src/lib.rs` 的 `run()`（约 L774）以 `tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(...)` 组装应用；`tauri.conf.json` 主窗口未显式设 label，Tauri 2 默认 label 为 `main`。
- 双开实测可复现：两个进程各持编辑器、保存链路与 AI 常驻会话，同时操作同一作品文件夹时进程内一致性防护（含作品锁）全部失效。
- 依赖事实（librarian 逐版核实，2026-09-30）：插件最新 stable 2.5.0 要求 `tauri ^2.12`，与本仓库 `tauri = "~2.11.5"` 冲突；**兼容线最新为 2.4.5**（tauri 要求 `^2.10`，Rust 最低 1.77.2，与现仓库 edition 2021 相符）。
- Windows 底层机制（插件源码核实）：`CreateMutexW("{identifier}-sim")` 检测已有实例；第二实例经隐藏工具窗 `WM_COPYDATA` 把 argv/cwd 交给第一实例，调用 `AllowSetForegroundWindow(第一实例 PID)` 后 `exit(0)`。

## Goals / Non-Goals

**Goals:**

- 同一时刻最多一个应用实例；第二次启动不创建窗口、立即退出。
- 重复启动时把已有主窗口呈现给用户（遮挡→置前，最小化→恢复再置前）。

**Non-Goals:**

- 不做 argv 处理（未来「双击作品文件打开」的文件关联另立 change）。
- 不动作品锁机制、不做跨实例数据协商（单实例后无此需求）。
- 不做托盘、后台驻留等窗口形态。

## Decisions

1. **用官方 `tauri-plugin-single-instance`，锁版 `~2.4.5`。**
   - 不自研命名互斥体：官方插件维护 Windows/macOS/Linux 三平台检测与参数回传，自研只重造 Windows 半套。
   - 锁 2.4.5 而非最新 2.5.0：2.5.0 依赖 `tauri ^2.12`，与仓库 `~2.11.5` 冲突；将来 tauri 升 2.12 时随 Dependabot 递单同步升插件。
2. **注册在 Builder 链首位。**
   - 官方文档与源码一致要求：插件按注册顺序运行，第二实例必须在其余 setup 之前被拦截。当前首位是 `tauri_plugin_dialog`，本插件插到它前面。
3. **回调只做「聚焦已有主窗口」三步轻操作。**
   - `get_webview_window("main")` → `show()`（处理隐藏）→ `unminimize()`（处理最小化）→ `set_focus()`。
   - 回调在第一实例主线程的 WndProc（`WM_COPYDATA`）里同步执行（源码机制推导），必须保持轻量；三步均为窗口 API 轻调用，合规。官方示例只演示 `set_focus`，`show/unminimize` 组合是 Tauri 通用窗口 API 的合理拼装——此差异已如实标注。
4. **前台锁定（foreground lock）交给插件既有缓解。**
   - 插件在第二实例退出前已调用 `AllowSetForegroundWindow(第一实例 PID)`，`set_focus()` 通常成功；若用户在两次启动间隙切换了应用，Windows 收回前台权，届时只闪任务栏图标——系统级限制，接受并记录。

## Risks / Trade-offs

- [dev 与正式版共用 identifier，互相排斥] → 期望行为：`tauri dev` 与已安装正式版同为「Next Story」，后启动者交给先启动者；对开发者是已知特性，对用户无感。
- [第二实例退出码非零或闪黑框] → 插件在 `run` 之前 `exit(0)`，无窗口创建，无可见闪烁（源码核实 `cleanup_before_exit` + `exit(0)`）。
- [回调线程阻塞风险] → 见决策 3，保持三步轻操作；将来若需重活改投异步任务。

## Migration Plan

`Cargo.toml` 加一行依赖、`lib.rs` 首位插一个 `.plugin(...)`，无数据迁移；回滚＝删这两处。
