# 任务：应用单实例

## 1. 实现

- [x] 1.1 `src-tauri/Cargo.toml` 新增 `tauri-plugin-single-instance = "~2.4.5"`（2.5.0 需 `tauri ^2.12` 与当前 `~2.11.5` 冲突，锁兼容线；附一行锁版理由注释，风格同现有依赖）
- [x] 1.2 `src-tauri/src/lib.rs` 的 `run()` 在 Builder 链**首位**注册插件，回调执行：`get_webview_window("main")` → `show()` → `unminimize()` → `set_focus()`
- [x] 1.3 `cargo build`、`cargo fmt --check`、`cargo clippy -D warnings` 通过

## 2. Windows 实机验证

- [x] 2.1 双开探测：启动一次后再启动一次 → 第二进程立即退出，系统中应用进程数＝1、主窗口数＝1
- [x] 2.2 首启回归：冷启动正常创建主窗口、进入工作区
- [x] 2.3 已有主窗口最小化时再次启动 → 窗口恢复显示并置前
- [x] 2.4 已有主窗口被遮挡时再次启动 → 置前获焦（如遇前台锁定只闪任务栏，如实记录）
