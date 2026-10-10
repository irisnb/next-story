# 图标模糊技术诊断（只读，2026-10-10）

范围：独立只读技术诊断，不改图标/源码/缓存，不杀应用。用户提供的模糊证据为任务栏截图 `方向\bda1eb0e6e1105ae929774428c948b1c.png`（mtime 2026-10-10 00:23）；视觉复核由 observer 并行完成，本记录只给技术证据与排除项。诊断脚本：`verification\icon-diagnosis.mjs`、`verification\icon-diagnosis-window.ps1`（均只读）。

## 一、结论（根因）

**不是图标接入/打包错误，也不是低分辨率位图被拉伸。** 真正原因是 **04「开口」这套细线设计在任务栏小尺寸（约 16–24px）下的可读性**：外框描边色过浅（标准稿 `#c7c7c7`、小稿 `#bbb`）在浅色任务栏上几乎不可见，深色主线在 24px 只有约 1.1px，细节塌成灰边，观感发虚。

## 二、证据

### 1. exe 内嵌的就是本次生成的图标（逐字节）

`icon-diagnosis.mjs` 解析 PE 资源目录（RT_GROUP_ICON id=32512，RT_ICON）：

| 帧 | bytesInRes | 与 `src-tauri/icons/icon.ico` 对应帧逐字节一致 |
| --- | --- | --- |
| 16×16 | 1128 | 是 |
| 24×24 | 2440 | 是 |
| 32×32 | 4264 | 是 |
| 48×48 | 9640 | 是 |
| 64×64 | 16936 | 是 |
| 128×128 | 67624 | 是 |
| 256×256 | 3723 (PNG) | 是 |

`debug` 与 `release` 两个 exe **完全相同**：均内嵌本仓库 7 帧，全部 `matchesIcoFrame=true`。debug exe mtime 23:30:54，当前运行实例 PID 25172 启动 23:30:56（即本次新构建）。

### 2. 任务栏图标来源 = exe 内嵌图标

`icon-diagnosis-window.ps1` 对运行窗口（PID 25172，`MainWindowTitle=com.nextstory.desktop-siw`）查询：

- `WM_GETICON ICON_SMALL=0`、`ICON_BIG=0`、`ICON_SMALL2=0`（未设置）
- `GetClassLongPtr GCLP_HICON=0`、`GCLP_HICONSM=0`（未设置）

窗口/窗口类都没有显式图标，因此任务栏/标题栏回退到 **exe 内嵌图标**，即上表的新 04 图标（非旧图标、非缓存旧像，按资源证据判定）。

### 3. 渲染管线：按目标尺寸矢量直出，不是低分辨率拉伸

对比 tauri 各尺寸输出与「256 帧降采样」（meanAbsDiff，越小越像）：

| 目标 | nearest | bilinear | bicubic | lanczos | box |
| --- | --- | --- | --- | --- | --- |
| 32 | 85.7 | 33.2 | 14.9 | 23.0 | 12.2 |
| 48 | 31.2 | 47.2 | 9.5 | 20.4 | 8.0 |
| 64 | 45.6 | 14.6 | 11.0 | 23.3 | 8.4 |
| 128 | 18.7 | 7.0 | 4.8 | 21.7 | 1.3 |

没有任何单一降采样滤波器能在所有尺寸逼近 tauri 输出 → 各尺寸帧是与 256 帧不同的独立渲染（`@tauri-apps/cli` 内含 resvg 19 处），**不是把低分辨率位图放大**。256 帧中间 alpha 像素占比仅 0.3%（很锐利），佐证矢量直出。

### 4. 小尺寸对比度/墨量（帧静态统计）

| 帧 | 深色墨像素(<110) | 中间 AA 像素 | 白/浅像素 | 深色占比 |
| --- | --- | --- | --- | --- |
| 16 | 23 | 60 | 173 | 9.0% |
| 24 | 54 | 140 | 382 | 9.4% |
| 32 | 75 | 166 | 783 | 7.3% |
| 48 | 192 | 117 | 1751 | 8.3% |
| 256 | — | 212 | 56856 | 0.3%（AA） |

即小尺寸下约 1/4 的像素是半透明过渡（发灰），高对比墨只占约 9%。

### 5. 真源几何（用户要求核对）

- `04-aperture.svg`（标准，viewBox 256）：`rect x=8 y=8 w=240 h=240 rx=42 fill #fff stroke #c7c7c7 stroke-width 2`；`path stroke #252525 stroke-width 9 round`。
- `04-aperture-small.svg`（小稿，viewBox 32）：`rect x=1 y=1 w=30 h=30 rx=5 fill #fff stroke #bbb stroke-width .6`；`path stroke #252525 stroke-width 1.5 round`。

小稿相对标准略粗（1.5/32=4.7% vs 9/256=3.5%），16/24 用的是小稿；但换算到 24px：主线约 1.125px、外框约 0.45px、留白约 0.75px——仍偏细偏浅。

## 三、排除项

- **排除「图标没换/旧图标」**：debug 与 release 均逐字节内嵌新 7 帧（第 1 节）。
- **排除「debug 与实际/bundle 不一致」**：debug、release、`icon.ico`、`target\release\resources\icon.ico` 同一份（bundle 图标 SHA-256 一致，见 `package-artifacts-2026-10-09.md`）。
- **排除「低分辨率拉伸」**：第 3 节。
- **排除「缺帧/尺寸不齐」**：16/24/32/48/64/128/256 全在。
- **排除「打包/CSP 导致外观」**：与图标外观无关。
- **不把「图标缓存」当作解释**：exe 资源已证为新图标；缓存是否有影响无法仅凭截图判定，故不作为根因（用户亦要求不要用缓存猜测自动解释）。

## 四、未定/待确认（不臆断）

- 任务栏实际取用帧的大小：本机 DPI=96（100%），Win11 任务栏图标逻辑尺寸约 24px，ICO 有精确 24 帧（小稿），但 explorer 的实际选帧与其内部缩放未在本次直接观测（需 observer 对比或真机逐像素）。
- 125%/150%/200% DPI 适配：ICO 覆盖 32/48/64/128，按「就近取帧并向下缩放」逻辑不会放大模糊；但本机为 100%，高 DPI 未实测。
- 截图是否来自固定快捷方式的缓存像，无法从技术侧单独证实；运行进程的图标源已证为新。

## 五、最小修复建议（供父决策，本次未改动）

优先级从低风险到高风险：

1. **给 16/24 专用帧加对比**：在 `04-aperture-small.svg` 基础上把外框描边调深/加粗（如 `#8a8a8a` 或更粗），主线略加粗；不影响 32px 以上观感。
2. **小尺寸弱化细节**：16px 进一步简化内部开口细节，保留轮廓识别。
3. **补 DPI 中间帧**：如需 125%/150% 更稳，可评估加入 20/40/96 帧（当前 32/48/64 已覆盖主要档位，非必需）。
4. **不改大尺寸矢量美学**；发送彩蛋 PNG、icns 与本议题无关。

任何改动都应重跑 `generate-icons.mjs` → 重建 debug/release → 重跑本诊断脚本确证帧一致。

## 六、验证路径

1. `node verification/icon-diagnosis.mjs`：确认新 exe 内嵌帧与 `icon.ico` 逐字节一致。
2. observer 看图：`C:\Users\Administrator\AppData\Local\Temp\opencode\package-v5\icon-excerpt\`
   - `excerpt_ico16_light_x8.png`、`excerpt_ico24_light_x8.png`、`excerpt_ico32_light_x8.png`、`excerpt_ico48_light_x8.png`（浅底 8×）
   - 同名 `_dark_x8.png`（深底 8×）
   - `excerpt_ico_actual_1x_reference.png`（16/24/32/48 原始尺度并排放大 4×）
   - `excerpt_ico_16_24_32_48_light_x8.png`
   - `excerpt_exedebug32_light_x8.png`、`excerpt_exedebug48_light_x8.png`（从 debug exe 提取）
3. 真机：在 100%/125%/150% 桌面分别截任务栏/开始菜单/标题栏，与上面 excerpt 比对。

## 七、本次未做（边界）

- 未改任何图标/源码/配置；未删缓存；未杀应用；未重装；未运行安装包；未 commit/archive；未跑完整 `npm run check`/`npm run tauri:build`（本轮）。
- 仅运行了定向 `npm run lint`（exit 0）与 `node --check`，确保新增诊断脚本可用。
- 未读取任何 secret 或用户正文。
