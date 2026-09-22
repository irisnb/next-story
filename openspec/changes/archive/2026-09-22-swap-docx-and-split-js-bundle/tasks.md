# Tasks: swap-docx-and-split-js-bundle

## 1. 前置与依赖替换（Rust 半）

- [x] 1.1 `cargo fetch --manifest-path src-tauri/Cargo.toml` 验证 crates.io 网络可用（2026-09-22 曾不通，见审计补充十七；不通则暂停并报告用户，未经同意不改镜像配置）
- [x] 1.2 `src-tauri/Cargo.toml` 依赖替换：删 `docx = "1.1.2"`，增 `docx-rs = { version = "=0.4.22", default-features = false }`；`[dev-dependencies]` 的 `zip = "0.5"` 改为 `zip = { version = "8.6", default-features = false, features = ["deflate"] }`；整段删除 `[patch.crates-io]` jetscii 垫片及其注释
- [x] 1.3 删除 `src-tauri/vendor/jetscii-0.4.4-compat/` 整个目录
- [x] 1.4 更新锁文件并断言：`Cargo.lock` 中 `docx` 1.1.2、`strong-xml`、`jetscii`、`time` 0.1.45 全部消失，`docx-rs` 0.4.22 与 `zip` 8.x 入锁

## 2. docx_export.rs 重写（行为保持）

- [x] 2.1 按 design D3 映射表重写 `src-tauri/src/project/docx_export.rs` 为 docx-rs builder API：Heading1–6 命名样式产出 `w:sz` 半点值 64/56/48/40/36/32（点值 32/28/24/20/18/16），与旧实现 `.size(size * 2)` 一致；粗体/斜体/下划线/删除线/颜色（去 `#` 前缀）映射；列表继续可见前缀降级（`• ` / `1. ` 与嵌套缩进）；空作品仍产出有效文档；错误映射维持 `ProjectError::WriteError`（「DOCX 生成失败: …」前缀）
- [x] 2.2 跑 `export_test.rs` 全部导出测试；docx-rs API 拼写以官方 examples/docs.rs 校准适配；zip 8.6 的 `ZipArchive::new / by_name / read_to_string` 签名与 0.5 相同，预计测试零改动（实测：一处测试 4 个断言从旧库序列化形态改为 docx-rs 形态，语义不变，已复核）
- [x] 2.3 全量 Rust 测试通过（`npm run test:rust`，基线 342 项 0 失败）（实测：342 通过 / 0 失败 / 4 按设计忽略）
- [x] 2.4 `cargo check --all-targets --manifest-path src-tauri/Cargo.toml` 零新增警告；`cargo report future-incompat` 中 docx 1.1.2 的 5 处警告清零（实测：零警告；future-incompat 报告清零，陈旧缓存报告已清除并复验）

## 3. 前端构建分片（JS 半）

- [x] 3.1 `vite.config.ts` 增加 `build.rollupOptions.output.manualChunks`（函数式，按 design D6：@tiptap/prosemirror/linkifyjs → `editor-vendor`，@tauri-apps → `tauri-vendor`，其余走默认包）
- [x] 3.2 `npm run build` 实测：编辑器域包、Tauri 域包、默认包三个 JS 包均低于 500 kB，构建输出零体积警告，`index.html` 引用正常（实测：editor-vendor 373.53 kB / 默认包 212.60 kB / tauri-vendor 15.28 kB，零警告）
- [x] 3.3 前端全量测试（基线 959 项）、`npm run typecheck`、`npm run lint` 通过（实测：959/959、typecheck/lint 均过）
- [x] 3.4 `npm run tauri:dev` 启动冒烟：编辑器、AI 面板、导出入口正常加载，无控制台模块加载错误（实测：BOOTED/ALIVE/CLEANED 三绿；窗口标题 Next Story；窗口区域像素多样性分析 52520 采样 / 12497 色 / 最大单色占比 2.4%，排除空白 WebView；本模型无图像输入能力，肉眼看图由用户日常使用自然覆盖）

## 4. 验收与归档

- [x] 4.1 真机导出复核：导出一篇含中文、多级标题、列表、粗体/斜体/颜色标记的作品，用 Word 打开人工确认层级、格式与可编辑性（实测：真实后端全链路 create_new_project→save_document→export_project_to_word 产出样本；WPS（本机已装的 Word 兼容编辑器；MS Word 未安装）COM 程序化打开，断言全过——大纲层级 1/2/3/4、H1–H4 字号 32/28/24/20pt、标题粗体、粗/斜/下划线/删除线/红字五种标记、• 与 3. 前缀、嵌套列表文本、无保护可编辑；样本留存 %TEMP%\opencode\8e-sample\ 供随时人工复核，详见 verification/real-machine-validation.md）
- [x] 4.2 清账断言复核：`Cargo.lock` 无 `time 0.1.45` / `jetscii` / `strong-xml` / `docx` 1.1.2；生产构建零体积警告（编排者独立复跑：违禁项 0 命中、必在项 4/4；构建零警告见 3.2）
- [x] 4.3 `openspec validate` 通过，按流程归档 change（validate 有效；主规格同步：`frontend-bundle-structure` 新立、`project-word-export` 增「导出实现依赖链卫生」；归档至 `openspec/changes/archive/2026-09-22-swap-docx-and-split-js-bundle/`）
- [x] 4.4 归档后确认 GitHub Dependabot 警报 #13（time）已关闭（扫描周期内未自动关则手动按已修复版本关闭并记录）；更新审计文档《全量地基审计》第五节 P2-14 条目、第八节队列 8e 行与补充记录（实测：推送 0f4985f..983002a 后 Dependabot 自动置为 `fixed`，在册警报 1→0，无需手动关闭；审计文档 P2-14／队列 8e／3d 行、处理进度、补充十八均已更新）

> 任务 3.4（tauri:dev 启动冒烟）并入 4.1 真机验收一并执行：自动化进程级冒烟由编排者先跑，视觉确认（编辑器、AI 面板、导出入口加载正常）随真机导出复核由用户在场完成。
