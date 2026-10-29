# repo-dev-docs Specification

## ADDED Requirements

### Requirement: 开发者手册完整性
主仓库 SHALL 提供 `docs/DEVELOPMENT.md` 作为开发者手册，完整承载自 README 外移的开发内容，依次包含：Windows 开发环境准备（C++ Build Tools、WebView2、Rust stable-msvc、Node ≥ 22.19 与内置 Node 24.15.0 的区分说明）、依赖安装（根目录与 sidecar 分别安装）、`npm run check` 全科目顺序说明与单科命令、持续运行的开发命令（`npm run dev`、`npm run tauri:dev`）、Windows 打包三步（sidecar 依赖、vendor-node、tauri:build）、简明文件索引、数据保存明细表与 API Key 安全说明。

#### Scenario: 手册章节完整
- **WHEN** 查看 `docs/DEVELOPMENT.md`
- **THEN** 上述章节齐备，且与主 README 外移前的对应内容信息等量（无丢失）

#### Scenario: README 与手册分工
- **WHEN** 核对 README 与 `docs/DEVELOPMENT.md`
- **THEN** README 仅含开发者速览，完整手册内容只在 `docs/DEVELOPMENT.md`

### Requirement: 发布说明编码规则
创建或编辑 GitHub Release 说明时 SHALL 经 `--notes-file` 传入 UTF-8 编码的说明文件；MUST NOT 在 Windows PowerShell 中以内联 `--notes` 参数直接传中文（PowerShell 5.1 对原生程序参数按系统 ANSI 代码页编码，与 GitHub 的 UTF-8 解释错位会产生乱码，2026-10-24 首发乱码即此根因）；发布或修改后 SHALL 以 `gh release view <tag>` 复查中文渲染无误。

#### Scenario: 按流程发布不产生乱码
- **WHEN** 按 `docs/DEVELOPMENT.md` 发布流程以 `--notes-file` 创建或编辑 Release 并用 `gh release view` 复查
- **THEN** Release 页中文说明渲染正常，无乱码

#### Scenario: 禁止内联中文参数
- **WHEN** 检查 `docs/DEVELOPMENT.md` 发布流程的表述
- **THEN** 明确写有禁止在 PowerShell 内联中文 `--notes` 参数的规则及原因
