# docs/diagrams

这里存放对仓库结构有长期参考价值的架构图。

## project-structure

- `project-structure.drawio` 是可编辑源文件。
- `project-structure.html` 是便于浏览的 HTML 导出。
- `project-structure.png` 是便于预览和文档引用的图片导出。

如果后续项目结构变化，先更新 `.drawio` 源文件，再重新导出 `.html` 和 `.png`，让三份文件保持同一版本。

## project-structure-v2

- `project-structure-v2.html` 与 `project-structure-v2.png` 是 2026-08 绘制的第二版结构图快照；此版没有 `.drawio` 源文件，HTML 为可读的权威版本，PNG 为其导出快照。
- **状态（2026-09-14 加注）**：v2 图已被实现进度超越（例如图中「仍为草稿本 / 正文本双本子」「内容树无代码」等标注均已过时），仅作历史快照保留；现行结构以 `openspec/specs/` 为准。若未来重绘，建议恢复「先改 `.drawio` 源、再导出」的做法。

## project-structure-v3

- `project-structure-v3.html` 与 `project-structure-v3.png` 是 2026-09-27 绘制的第三版结构图快照（运行层总览 + 三条关键链路 + 红线），内容对齐当日仓库现状。
- 此版同样没有 `.drawio` 源文件：**HTML 为可读、可维护的权威版本**；PNG 为 2 倍清晰度导出快照（3840 × 4944）。
- **PNG 重导方式**（本机未安装 draw.io 桌面端，`.drawio` 无法本地导出，历史 PNG 即用此管线生成）：改完 HTML 后用无头浏览器截屏：
  ```powershell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1920,2472 --screenshot="docs\diagrams\project-structure-v3.png" "file:///D:/Next%20Story/docs/diagrams/project-structure-v3.html"
  ```
  （窗口宽高 = HTML 画布精确尺寸；改版式时同步改窗口尺寸。）
- 内容事实以 `openspec/specs/` 为准；本图为快照，不代表实时状态。
