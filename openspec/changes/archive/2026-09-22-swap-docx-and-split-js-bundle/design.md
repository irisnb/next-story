# Design: swap-docx-and-split-js-bundle

## Context

- 审计修复队列 8e（最后一项）。上一状态：队列 1–8d 已归档 16 项，P0/P1 全清，P2 仅剩 P2-14；GitHub 在册 Dependabot 警报仅剩 time #13；0 个活跃 change。
- 现状事实（2026-09-22 摸底）：
  - `docx` 1.1.2（PoiScript）2020-04 后停更。future-incompat 警告真凶是它自身的 `option_read!` 宏（5 处，`cargo report future-incompat` 实证），非 zip/time；死库永无人修，未来 Rust 升硬错误。
  - 依赖链 `docx → zip 0.5.13 → time 0.1.45`（警报 #13）；`docx → strong-xml 0.5.0 → jetscii 0.4.4`（编译不过，靠 `src-tauri/vendor/jetscii-0.4.4-compat/` 垫片，垫片内容实为 jetscii 0.5.3 改标版本）。
  - 导出面：`src-tauri/src/project/docx_export.rs` 全部 163 行，只用公共 API（Docx/Paragraph/Run/Styles/CharacterProperty），无自定义 XML 类型。测试 `export_test.rs` 经 `zip::ZipArchive::new / by_name / read_to_string` 解包断言 `<w:t>` 文本序列（2 处，API 在 zip 8.6 签名相同）。
  - 前端：`vite.config.ts` 无任何分片配置；生产单包 601.6 kB（gzip 181.2）。esbuild metafile 分析（115 模块、未压缩输入 1773.9 kB）：编辑器栈（@tiptap/* + prosemirror-* + linkifyjs）约 58%、应用代码约 35%、@tauri-apps 约 6%。按压缩比例折算三包约 350/210/35 kB。
- 调研结论（@librarian，crates.io + 官方仓库源码核实）：不存在升级路，两条换库路（fork `docx-rust` vs 主力 `docx-rs`），用户拍板路线 B：`docx-rs` 0.4.22（bokuwen）。其链：quick-xml 0.41 + zip 8.6，无 time/strong-xml/jetscii；MSRV 经 zip 8.6 要求 Rust ≥1.88（本机 1.96.1、CI stable 满足）。

## Goals / Non-Goals

**Goals:**

- Word 导出依赖链换为活跃维护、链干净的 `docx-rs` 0.4.22，导出**行为逐项保持**（既有 `project-word-export` 六条要求不动）。
- 根除 future-incompat、移除 time 0.1.45（警报 #13 关闭）、删除 vendor 垫片与 `[patch.crates-io]`。
- 前端生产构建按域分三静态包，各包低于 500 kB 警戒线，警告消失。
- 全程离线可验（Rust 测试、前端测试、构建），加一次真机 Word 导出复核。

**Non-Goals:**

- 不改导出行为：不趁机上真 Word numbering（列表继续可见前缀降级——原 design 决策的降级策略是行为基线，动它另开 change）、不改标题字号映射、不改导出的只读与失败语义。
- 不做惰性加载/动态 import：写作区是主屏幕、AI 面板常驻，无次要路径，切惰性是假优化。
- 不动 sidecar 依赖（3c 已闭环）、不动 Tiptap（5b 已完成 3.31.3）、不动 glib（已按 not_used 关闭）。
- 不调 `chunkSizeWarningLimit`（掩盖而非解决）。

## Decisions

- **D1 换库选 `docx-rs` 0.4.22（路线 B），精确锁版 `=0.4.22`。**
  理由：路线 A（`docx-rust` fork）只是把死库换成半活跃库，hard-xml 链里 jetscii 仍在；路线 B 生态主力（近 90 天 84 万下载、2026-07 仍发版）、依赖链彻底干净。代价是重写 163 行，但单文件、只用公共 API、有解包断言测试兜底，面可控。锁精确版本：0.x 语义下 minor 也可能破坏（其 CHANGELOG 里 0.4.0/0.4.2/0.4.7 均标 [Breaking]），升级一律经 Dependabot 递单人工审，不裸奔 `^`。
- **D2 `docx-rs` 配置 `default-features = false`。**
  默认 feature `image` 拉 image 0.25 + 四种图片解码器；本导出不嵌图。源码门控核实（crates.io feature 表 + `#[cfg(feature = "image")]` 全量三处）：XML 渲染＋zip 打包核心路径（`Docx::new/add_paragraph/add_run/style/build/pack`）不依赖 image。`wasm` feature 是浏览器端用的，不开。
- **D3 重写映射表（行为保持的核心约定）：**

  | 旧（docx 1.1.2） | 新（docx-rs 0.4.22） |
  |---|---|
  | `Docx::default()` + `docx.document.push(p)` | `Docx::new().add_paragraph(p)` 链式 |
  | `Paragraph::default().property(PP::default().style_id("Heading1"))` | `Paragraph::new().style("Heading1")`（以官方 examples 的精确拼写为准） |
  | `Run::default().property(CP).push_text((s, TextSpace::Preserve))` | `Run::new().add_text(s)` + 格式方法链（bold/italics/underline/strike/color）；空白保留由库内部处理，不再手工 TextSpace |
  | `Styles::new` + Heading1–6 `Style::new(Paragraph, …)` + `docx.styles = styles` | `docx.add_style(Style::new("HeadingN", StyleType::Paragraph)…)`；字号不变量：Heading1–6 产出的 `w:sz` 半点值依次为 64/56/48/40/36/32（点值 32/28/24/20/18/16），与旧实现 `.size(size * 2)` 一致；docx-rs 的 `size()` 直收半点值，调用处不再乘 2 |
  | `docx.write(Cursor::new(Vec::new()))` → 字节 | `…build().pack(&mut cursor)` → 字节；错误映射维持 `ProjectError::WriteError("DOCX 生成失败: …")` 前缀 |

  列表（`render_list_item` 的 `• ` / `1. ` 可见前缀与嵌套缩进）、颜色去 `#` 前缀、空作品仍产出有效文档——逐项照搬。**验收以既有导出测试的内容断言为准，新库 XML 字节必然不同，不断言字节。**
- **D4 dev-dependency `zip` 0.5 → `{ version = "8.6", default-features = false, features = ["deflate"] }`。**
  与 docx-rs 内部 zip 同线；关默认 features（zip 8 默认拉 aes/bzip2/lzma/time/zstd 等一串，读 docx 只需 deflate——顺带把 time 从 dev 树里也拔掉）。测试所用三个方法在 8.6 签名相同（docs.rs 核实），预计零改动；`ZipError` 已 `#[non_exhaustive]`，测试用 `.expect()` 不 match 枚举，不受影响。
- **D5 vendor 垫片整体删除。**
  `[patch.crates-io]` 段与 `src-tauri/vendor/jetscii-0.4.4-compat/` 目录一起删。新链中 jetscii/strong-xml 不存在，垫片失去服务对象；保留只会成为下一个失真源。
- **D6 前端分片：`manualChunks` 函数式三包，静态导入。**

  ```ts
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined; // 应用代码走默认包
          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("linkifyjs"))
            return "editor-vendor";
          if (id.includes("@tauri-apps")) return "tauri-vendor";
          return undefined; // 其余零散 npm 归默认包
        },
      },
    },
  },
  ```

  边界依据是 esbuild 分析的天然聚类（编辑器栈独占 58%，与其余代码界限清晰）。验收：构建产出各 JS 包均 <500 kB、无警告、`tauri dev` 启动正常。
- **D7 验证与清账断言写进验收，不只跑测试：**
  ① Rust 全量测试（342 项，含导出内容断言）＋前端 959 项；② `cargo check --all-targets` 零新增警告；③ `cargo report future-incompat` 对 docx 的 5 处警告清零；④ `Cargo.lock` 断言：无 `time 0.1.45`、无 `jetscii`、无 `strong-xml`、无 `docx 1.1.2`；⑤ 真机导出含中文/标题/列表/粗斜体/颜色的作品，用 Word 打开人工复核格式与可编辑性；⑥ 前端构建三包实测体积；⑦ 提示用户下次 Dependabot 扫描后确认警报 #13 自动关闭（若未自动关，手动按已被修复版本关闭并记录）。

## Risks / Trade-offs

- [本机 crates.io 网络曾在 2026-09-22 不通（审计补充十七），拉不到新依赖则无法实施] → 实施第一步先 `cargo fetch` 验证网络；不通即暂停报告用户，未经用户同意不改镜像配置。
- [docx-rs API 实际拼写与调研摘要有出入（如 `Paragraph::style` 方法名、Style 构造参数）] → 以 crate 官方 examples 与 docs.rs 为准做小范围适配；导出测试的内容断言＋真机 Word 打开兜底，行为不因 API 拼写漂移。
- [新库生成 XML 结构差异（属性顺序、rsid、命名空间细节）导致下游 Word/WPS 兼容性问题] → 既有测试只断言 `<w:t>` 内容与样式存在；真机 Word 打开复核是必要验收；如遇兼容问题，回退路线见 Migration。
- [zip 8 默认 features 误开会拖回 time 与一串编解码器] → D4 显式 `default-features = false`＋验收断言 ④（Cargo.lock 检查）双保险。
- [docx-rs 处于 0.x，未来 minor 可能破坏编译] → D1 精确锁版 `=0.4.22`；Dependabot 周度递单由人工审（与 `ci-pipeline` 规格的 Dependabot 策略一致：机器人不合，人决定）。
- [分片后某包仍超线（应用代码未来增长）] → 本 change 只保证当前三包达标并把约束写进 `frontend-bundle-structure` 规格；未来超线属于新 change 的分片调整，规格要求此时显式处理而非静默忽略警告。
- [Tauri 加载三包的顺序/路径问题] → 全静态导入，rollup 自动处理 import 顺序，`index.html` 引用由 vite 生成；`tauri dev` 与生产构建双冒烟覆盖。

## Migration Plan

1. 前置：`cargo fetch` 验证 crates.io 网络。
2. Rust 半：Cargo.toml 依赖替换（docx→docx-rs、zip dev 升级、删 patch 段）→ 删 vendor 目录 → 重写 `docx_export.rs` → 跑导出测试与全量 Rust 测试 → 清账断言 ②③④。
3. 前端半：vite.config.ts 加 manualChunks → 构建实测三包体积 → `tauri dev` 冒烟。
4. 真机验收：导出复核（⑤）＋构建体积复核（⑥）。
5. 归档后：确认 Dependabot 警报 #13 关闭（⑦），更新审计文档第五/八节与补充记录（P2-14 闭环、P2 全清、队列 8 完工）。

**回滚**：本 change 无数据迁移、无存储格式变化，纯代码与构建配置；git 上单 change 整体 revert 即回到 docx 1.1.2＋单包现状（vendor 目录与 `[patch]` 均在 git 历史内）。导出的 .docx 文件由用户自行保管，不受回滚影响。
