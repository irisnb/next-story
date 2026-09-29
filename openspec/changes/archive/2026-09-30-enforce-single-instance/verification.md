# 验证记录：应用单实例

日期：2026-09-30 ／ 环境：Windows，2560×1440@100%，调试版 `src-tauri/target/debug/next-story.exe`（`tauri-plugin-single-instance v2.4.5` 按锁版解析）。

## 编译级

`cargo build`（6m06s，新依赖编译）✓；`cargo fmt --check` 无输出 ✓；`cargo clippy --all-targets -- -D warnings` ✓（输出中的 "Blocking waiting for file lock" 为构建目录锁等待噪音，非告警）。

## 运行时（Win32 探针，两轮）

### 第一轮（探针 v1）

| 断言 | 结果 |
|---|---|
| 2.2 冷启动创建主窗口 | ✓（窗口句柄获得） |
| 2.1 第二进程立即退出 | ✓（exitCode=0，无窗口创建） |
| 2.1 存活进程＝1、主窗口＝1 | ✓ |
| 2.3 最小化 → 再次启动 → 恢复 | ✓（IsIconic True→False，`unminimize` 生效） |
| 2.3/2.4 前台＝应用窗口 | ✗（后判定为探针伪影，见下） |

### 伪影归因与第二轮（探针 v2）

第一轮探针以 PowerShell 控制台运行，`GetConsoleWindow()` 返回空（无控制台窗口），「遮挡」setup 未发生；且前台权（SetForegroundWindow 的调用者资格限制）在无前台窗口的探针上下文中不成立。第二轮改用真实前台场景：最小化应用 → 启动记事本自然占据前台（实测前台为另一进程窗口 pid 28284）→ 再次启动应用：

- 再次启动后前台＝**应用主窗口**（focused）✓
- IsIconic＝False（恢复）✓
- 第二进程退出 ✓

结论：2.3（最小化恢复＋置前）与 2.4（他人前台 → 应用置前获焦）经真实前台场景验证通过；第一轮的 False 断言为探针环境伪影，非产品缺陷。

## 已知边界（如实记录）

- **前台锁定（Windows foreground lock）**：若用户在第二次启动执行期间又切换到其他应用，Windows 会收回前台权，届时窗口恢复但只闪任务栏图标。插件已在第二实例退出前调用 `AllowSetForegroundWindow(第一实例 PID)` 缓解，常规双击场景实测生效。
- **dev 与正式版共用 identifier**（`com.nextstory.desktop`）：`tauri dev` 与已安装正式版互相排斥，后启动者交给先启动者——视为期望行为（都是「Next Story」）。
- 前端与作品数据零改动；未跑全量 `npm run check`（无 TS/JS 变更，无相关性）。
