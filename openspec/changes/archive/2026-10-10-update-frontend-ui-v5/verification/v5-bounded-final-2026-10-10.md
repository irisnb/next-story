# bounded UI 收尾与原生／制作证据

本 lane 只改前端显示文案、制作快捷详情定位和定向测试、`verification/v5-*`。未改制作协议、Rust、icons，未提交或归档。observer 已确认主体对齐（调度方交接信息）；新增详情定位仍交 observer 复验。

## 原生缩放：旧验收脚本选错窗口

先读取 `ui-launch.mjs` 和 temp 中 `ui-v5-app-owned.json`：旧文件记录 PID 25172，不能拿它证明当前进程身份。当前 debug exe PID 32224、父 PID 33240、创建时间本地 2026-10-10 02:14:23，与此前本 lane 启动验收 exe 的交接一致。补 `v5-launch-owner.json`，明确是回溯记录而非原始 spawn 输出。未停止进程；后续如 fullcheck 要停止，先重新核验 PID、路径和创建时间。

旧脚本取 `Get-Process.MainWindowHandle`，得到 HWND 2102734、class `com.nextstory.desktop-sic`、无子 WebView。实际 UI 为同 PID 的 HWND 3348336、class `Tauri Window`；初次枚举时处于最小化状态，客户区 0×0，WRY 子窗口仍为 1024×670。此前 resize 只改变单实例通信窗口，所以页面一直 1024；无需产品窗口架构修复。脚本现枚举同 PID 的 Tauri 顶层 root，检查非子窗口，拒绝多候选，再 `ShowWindow` 正常恢复／最大化与 `SetWindowPos` 调整。

每轮先 `Emulation.clearDeviceMetricsOverride`，读取 Win32 客户区、WRY/Chrome 子窗口边界、页面 innerWidth/innerHeight、visualViewport、DPR、实际 resize 事件并截图。最新运行未进入 CDP override fallback；退出也清除 override。

| 操作 | 主客户区 | WRY／渲染承载 HWND | 页面 viewport |
| --- | --- | --- | --- |
| 三档一 | 1024×670 | 1024×670 | 1024×670 |
| 三档二 | 1280×720 | 1280×720 | 1280×720 |
| 最大化 | 2560×1369 | 2560×1369 | 2560×1369 |
| 恢复 | 1280×720 | 1280×720 | 1280×720 |
| 三档三 | 1440×900 | 1440×900 | 1440×900 |

DPI 96，DPR 1。这是 OS 正常窗口操作形成的尺寸链证据，未手工发送 WM_SIZE、未直接读取 COM CoreWebView2Controller.Bounds；对应宿主和渲染 HWND 边界及页面 resize 事件已记录。`Intermediate D3D Window` 是缓存绘制表面，尺寸可更大，不将其当 viewport。其他 DPI 与用户手动拖动／点击验收未做。

## 有内容制作：授权只读现有库

只读检查显示当前 app store 取 `app_local_data_dir`；测试的临时目录支持在 Rust store 单测构造层，未找到应用启动层目录覆盖。本 lane 未新增永久配置或账户，也未把 production 链路移入测试库。

按用户授权，只读选择 existing「装配验证链·第2版」，打开卡片快捷／完整详情。不启用、不停用、不改卡片、不设置制作对象、不启动对话或模型请求、不读取密钥与用户正文。

三档原生截图：`v5-native-graph-screens/graph-1024x670.png`、`graph-1280x720.png`、`graph-1440x900.png`。左栏为 158／220／220px，module 横向溢出 false；连接路径随实际布局变化（1024 与较宽档端点不同）。1024／1440另有 `detail-*`、`full-detail-*`。快捷详情原1024档底部718px超出670px，现只改前端 CSS 使其按可见窗口定位并保持正文滚动；复测分别为 x558/y170、x974/y285，450×330，均在 viewport 内。

真实三态：正在查看现有链路；正在制作“未选择”；当前未启用链路、使用日常陪想。全部 existing 行均未启用。本次证据不能声称拍到了正向“正在制作／已启用”，不为截图修改真实状态。三态分离已有前轮定向测试，正向生产状态截图仍缺安全隔离数据支持。

## 文案、首页及定向检查

正文宽度文案为「窄 · 640／标准 · 720／宽 · 860」，只改 label，档位、循环与存储不变。1440原生设置页截图 `settings-native-1440x900.png` 与 metric 验证当前「标准 · 720」。files 当前说明留在 sr-only，权限仍是文档级可读开关／回收站不可读，未改真实授权规则。

首页 `entries.slice(0, 3)`、8项 backend history 不变；返回首页实际使用原型 `i-back` 路径 `M19 12H5m5-5-5 5 5 5`。定向测试验证三项展示及回调、返回图标；本轮四文件 `editor-toolbar/ui-v5/recent-works/dom-contract` **49/49通过，零失败／跳过**。`npm run typecheck`、`npm run lint` 通过。recent读取失败用例的预期错误输出不代表失败。未重复全 frontend（父调度方已有1358结果），最终 fullcheck/build 交父 lane。

## 交接

完整 metric、窗口句柄／子窗口、resize events、路径与状态见 `v5-native-graph-screens/evidence.json`；脚本 `v5-native-graph.mjs`，窗口脚本 `v5-parity-resize.ps1`。截图已刷新，本轮 errors 空。

仍缺：新增截图 observer 比对、其他 DPI、用户真实点击／拖窗、正向制作对象／启用状态安全证据，以及父 lane 的最终全门禁与构建。应用仍运行，保持无 override。未自动补勾任何任务。
