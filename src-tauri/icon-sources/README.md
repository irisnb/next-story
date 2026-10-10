# 04「开口」正式图标源

来源：用户已批准的 `方向/前端UI暂存-2026-10-09/Next-Story图标方案-v3/04-aperture.svg` 与 `04-aperture-small.svg`。历史源不修改；本目录是 Windows 发布资产的可维护源。2026-10-10 小尺寸光学适配在已授权 change `update-frontend-ui-v5` 内进行。

- `04-aperture.svg`：标准稿复制，几何、颜色、线宽完全保留，供 48/64/128/256。
- `04-aperture-16.svg`：16px 专用，主线 1px；水平/垂直主段对齐半像素中心，灰色外框 1px。保留开口与折角，不增加内部细节。
- `04-aperture-20.svg`：20px 专用，主线 1px；重新对齐折角、回折和外侧直线的半像素中心，内侧竖线与横线兼顾间距。用于 16px 的 125% 物理尺寸。
- `04-aperture-24.svg`：24px 专用，主线 1.5px；外侧主段对齐四分之一像素中心，使一侧落在像素边界，内侧回折保留空间。

2026-10-10 observer 复验指出第一轮外框过重、16 内部拥挤，不能称已可读。第二轮三份小稿外框统一改为 `#aaa`、.5px，白底保持 `#fff`、主线保持 `#252525`。16 删除折角三角的内接缝（斜角外轮廓保留），内部回折向上收短，与底横线净距 1px。20 下回折上移，净距 1px；24 底横线下移、回折上移，净距 1px，内端缩短。主线仍为 1/1/1.5px。

- `04-aperture-32.svg`：仅外框 .5px、#aaa，标准主线与几何保持不变，作为 24→32 的轻外框过渡。48 以上仍原稿。
- `review-r1/`：冻结第一轮 16/20/24 稿，仅生成 before 对照，不用于生产。

无品牌色、滤镜、文字、位图。是否改善可读性需 observer 复验，不以笔画或墨量统计替代目视判断。

运行 `node scripts/generate-icons.mjs`，通过项目已有 Tauri CLI 的 resvg 按目标尺寸直出。无需新增依赖。第二轮对照板和像素统计同时重建在 change 的 `verification/icon-optical-r2-previews/`。旧 `icon-optical-previews/` 保留第一轮记录。

Windows 配置引用：`32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.ico`；这些是唯一覆盖的发布文件。`icon.icns` 虽列在 bundle.icon，但是 macOS 专用，不修改。`icon.png`、`StoreLogo.png`、`Square*Logo.png` 未在当前配置/源码中发现引用，不覆盖。
