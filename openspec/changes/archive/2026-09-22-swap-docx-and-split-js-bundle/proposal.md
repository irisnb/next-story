# Proposal: swap-docx-and-split-js-bundle

> 审计修复队列第 8e 项（依赖批，收尾批最后一项）。承接 `方向/全量地基审计-2026-09-14.md` 第八节队列 8e 行、P2-14、3d 的 time 部分与补充四/九/十四的既定判定。

## Why

Word 导出依赖的 `docx` 1.1.2 是死库（PoiScript，2020-04 后再无发布），三笔账压在它身上：①库自身宏内含 5 处 future-incompat 警告（宏表达式位置尾分号，rust-lang/rust#79813），未来 Rust 版本将升为硬错误且永远无人修复；②其依赖链 `docx → zip 0.5.13 → time 0.1.45` 是 GitHub 在册最后一条 Dependabot crate 警报（#13，随 Windows 发行物分发）；③`docx → strong-xml → jetscii 0.4.4` 编译不过，靠仓库内 vendor 垫片吊命，是持续的维护负担。同时前端生产构建单包已达 601.6 kB（gzip 181.2 kB），持续超 500 kB 警戒线（2026-09-14 为 513.9 kB，队列 4–8d 修复持续加码），无任何分片配置。本 change 完成后队列 8 全清、P2 全部 15 项闭环，按补充九规则解锁产品开发立项。

## What Changes

- **docx 换库（路线 B，经用户拍板）**：`docx` 1.1.2 → `docx-rs` 0.4.22（bokuwen，活跃维护）。不存在「升级」路径——原库已死，此为换库。
  - 重写 `src-tauri/src/project/docx_export.rs`（163 行）为 builder 链式 API；导出行为保持不变（Heading1–6 样式映射、粗体/斜体/下划线/删除线/颜色标记、列表可见前缀降级、内容树顺序、空作品可导出）。
  - 删除 `Cargo.toml` 的 `[patch.crates-io]` jetscii 垫片段与 `src-tauri/vendor/jetscii-0.4.4-compat/` 整个目录。
  - `docx-rs` 关闭默认 `image` feature（导出不嵌图；XML 渲染＋zip 打包核心路径经源码门控核实不依赖 image）。
  - dev-dependencies `zip` 0.5 → 8.6（`default-features = false, features = ["deflate"]`）；测试所用 `ZipArchive::new / by_name / read_to_string` 两版签名相同，预计零改动。
- **前端构建分片（P2-14）**：`vite.config.ts` 增加 `build.rollupOptions.output.manualChunks`，按域切三个静态包：编辑器栈（@tiptap/*、prosemirror-*、linkifyjs，占输入体积约 58%）、Tauri API（@tauri-apps/*，约 6%）、应用代码（约 35%）；分片后各包预计均低于 500 kB 警戒线。不做惰性加载——写作区是主屏幕、AI 面板常驻，无「可延迟加载」的次要路径。
- **清账效果**：time 0.1.45 移出依赖树（警报 #13 关闭，在册 Dependabot 警报归零）、future-incompat 根除、vendor 垫片删除、P2-14 闭环（P2 全清）。
- 无用户可见行为变化；作品数据路径与 AI 路径零接触。

## Capabilities

### New Capabilities

- `frontend-bundle-structure`: 前端生产构建的分包结构与单包体积约束——按域静态分包、单包不超警戒线、不回退单包，防止未来功能加码时静默退回膨胀单包。

### Modified Capabilities

- `project-word-export`: 新增一条要求——Word 导出实现的依赖链卫生（不依赖无维护死库、不产生 future-incompat 警报、不依赖仓库内 vendored 兼容垫片、不经传递依赖引入在册安全警报的组件）。既有六条导出行为要求全部不变。

## Impact

- **代码**：`src-tauri/src/project/docx_export.rs`（重写 163 行）、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/vendor/`（删除）、`vite.config.ts`（新增 manualChunks 配置）。
- **测试**：`src-tauri/tests/export_test.rs` 预计零改动；安全网为 342 项 Rust 测试（含解包 .docx 断言内容的导出测试）与 959 项前端测试。
- **依赖**：新增 `docx-rs` 0.4.22（经 zip 8.6 要求 Rust ≥1.88；本机 1.96.1、CI stable 均满足）；移除 `docx`、`strong-xml`、vendored `jetscii`、`zip` 0.5、`time` 0.1.45。
- **构建产物**：`dist/` 从单 JS 包变三包，`index.html` 引用随之变化；应用启动仍全静态导入，加载行为不变。
- **CI**：门禁步骤不变（生产构建照跑）；分片后 500 kB 警告消失。
- **风险**：本机 crates.io 网络曾于 2026-09-22 不通（审计补充十七），拉取 `docx-rs`/`zip` 8.6 需网络可用；导出 XML 由新库生成，字节级输出必然不同，以内容断言（既有导出测试）＋真机 Word 打开复核兜底。
