# 04 开口小尺寸光学适配交接

用户授权范围：修复应用图标小尺寸可读性；维持已批准 v3 04 白底黑线，不改个人 PNG、产品 UI 或历史设计稿。此记录为资源生成证据，不表示任务栏已修复。

## 差异与来源

正式源迁入 `src-tauri/icon-sources/`。标准 SVG 从 approved 04 原样复制；16/20/24 从 approved small 的折角、开口、回折几何建立独立目标像素稿。

| 物理尺寸 | before 主线 | after 主线 | 外框 |
| --- | --- | --- | --- |
| 16 | .75px | 1px | .3px #bbb → 1px #777 |
| 20 | .9375px | 1px | .375px #bbb → 1px #777 |
| 24 | 1.125px | 1.5px | .45px #bbb → 1px #777 |
| 32 以上 | 标准稿 | 不变 | 不变 |

16/20 的主要横竖线中心落在半像素；24 的主要段落采用四分之一像素中心配 1.5px 线宽。保持折角三角区域、下方开口与内部回折，没有删去识别结构。尚未得到视觉证据证明应继续删减内部细节，因此本次仅加粗、对齐、调整留白。20 为 16px 在 125% DPI 的精确物理帧；没有增加缺乏明确收益的 40/96 帧。

ICO 由 7 帧变为 8 帧：16/20/24/32/48/64/128 为 32 位 DIB，256 为 PNG。三份配置引用 PNG 同时从正式标准源直出。`icon.png`、StoreLogo、Square 系列无当前源码/配置引用，未改；icns 不在 Windows 适配范围。

## 对比板

绝对目录：`D:\Next Story\openspec\changes\update-frontend-ui-v5\verification\icon-optical-previews\`

- `light-1x.png`：浅任务栏底 #f3f3f3，256×128；每个图标为原始物理尺寸。
- `dark-1x.png`：深任务栏底 #202020，256×128；每个图标为原始物理尺寸。
- `light-8x.png`、`dark-8x.png`：上述板逐像素放大 8 倍，无平滑插值。
- `before-16.png`、`before-20.png`、`before-24.png`、`before-32.png` 与同名 after：透明背景原始帧。

每张板上排 before、下排 after；从左至右 16/20/24/32。每格 64×64，图标在格内整数像素居中。20px before 是 approved small 直出，用于比较，不是旧 ICO 中存在的帧。参考背景只是渲染对比环境，不是实际 Explorer 截图。

统计见 `metrics.json`：深色像素计数规则为 alpha >127 且红通道 <110（源为中性灰）。16：23→32（9.0%→12.5%），20：42→48（10.5%→12.0%），24：54→72（9.4%→12.5%），32：75→75（7.3% 不变）。统计只能证明墨量增加，不能代替视觉判断。

## 验证结果与责任

- `node scripts/generate-icons.mjs`：exit 0。Tauri 按各 SVG 目标尺寸直出成功。
- 同次内置资源检查：exit 0；8 帧数量、尺寸条目、32 位深度和每帧数据与本次渲染对应；标准 32 before/after PNG 逐字节一致。
- `node --check scripts/generate-icons.mjs`：exit 0。
- `npm run lint`：exit 0。
- Tauri 警告系统 `mstmc.ttf` 的一个字体无法加载；SVG 无文字，不依赖该字体，渲染成功。

当前 lane 无法读取工具返回的图像，不声称完成目视验收。请父 observer 在 1x 浅深底判断边框是否过重、折角与开口是否仍清楚、24→32 的粗细跳变是否可接受，并用 8x 板定位像素问题。

未执行完整 Tauri build、未修改缓存、未杀或重启应用。后续 fix2 在 UI lane 稳定后构建 debug/release，并运行技术诊断核实新 8 帧与 PE 资源逐字节一致；随后 observer/用户在实际任务栏、标题栏、快捷方式以及可用 DPI 档验收。当前运行 exe 仍可能承载旧 7 帧，不能据本次生成宣称任务栏问题已解决。
