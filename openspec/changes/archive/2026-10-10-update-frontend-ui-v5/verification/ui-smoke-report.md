# Windows WebView2 局部冒烟记录

2026-10-09，复用已运行 debug app PID 25172、Vite 1420、WebView2 CDP 9223。未重新构建、重启或结束进程，未打开项目、输入正文、修改链路或发送模型请求。

运行：`node openspec/changes/update-frontend-ui-v5/verification/ui-smoke.mjs`。

真实目标 C2E0309C119C1E821BF8B9ED6A4408B4，URL http://localhost:1420/，当前为首页。完成首次状态采集及截图，然后三次原生窗口调整、三次指标采集和截图。最终一轮用时约 2.6 秒，CDP 单次调用上限 8 秒。

| 客户区实测像素 | Win32 窗口外尺寸 | Windows DPI | WebView DPR | 控件超出视口数 |
| --- | --- | --- | --- | --- |
| 1024×670 | 1040×709 | 96 | 1 | 3 |
| 1280×720 | 1296×759 | 96 | 1 | 3 |
| 1440×900 | 1456×939 | 96 | 1 | 1 |

原生尺寸采用 GetClientRect/GetWindowRect；WebView 的 outerWidth/outerHeight 与客户区相同，不能代替 Win32 外尺寸。没有模拟 viewport。Tauri setSize 被权限拒绝，原文：`window.set_size not allowed. Permissions associated with this command: core:window:allow-set-size`。随后使用验证 PID 和可执行路径的 Win32 SetWindowPos 调整同一个窗口；未修改产品权限。

证据在本目录 `ui-screens/ui-evidence.json`，截图为 `ui-initial.png`、`ui-1024x670.png`、`ui-1280x720.png`、`ui-1440x900.png`。三尺寸均无横向超出视口控件；垂直检测发现最近项目按钮落在视口底部之外。该检测未排除可滚动祖先，不能据此判定内容被不可恢复地裁切，需 observer 结合截图与滚动行为判断。

最终采集期间 console error 与 Runtime exception 均为 0；没有重新加载，因此不覆盖启动前的控制台错误。真实 DOM 两处 aria-label 已是「自定义要求与姿态」及「自定义要求与姿态内容，可滚动」。源文件更正后的指定测试 57/57 通过，typecheck 通过。

明确阻塞：停在首页；最近项目名称不足以确认其为可安全操作的隔离测试项目，未猜测打开。写作 AI 边栏打开／最大化／恢复／收起／重开、divider、草稿保留、工具收纳、制作页面本轮未验证。用户亲自点击、模型调用、其它 DPI 尚未验证。当前模型无法读取截图图像内容，视觉判断交 observer；本记录只声明几何及 CDP 证据，不声明全量 UI 验收通过。
