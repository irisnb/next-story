# add-word-import Tasks

## 1. 金样本与解析库 spike（决定路线 A/B）

- [x] 1.1 归档真实样本解剖报告到 `.omo/word-import-anatomy-2026-10-02/`（README＋三份报告已核对齐全）；真实 WPS 样本文件本地保留作测试金样本，不入仓库（隐私考量，用户默认此处理）
- [x] 1.2 Spike：**路线 A 确认**——docx-rs `read_docx` 完整解析真实 WPS 金样本，关键不变量与解剖基准全部精确一致（字符 55331 逐字一致、墓碑 730、真编号 [1,1]、集标记 61 全加粗）；四点验证全过，详见 design.md Spike 补记（含 API 速查与 command 契约）
- [x] 1.3 不适用——spike 判定路线 A，无需 zip＋quick-xml 骨架；解压上限改由 zip 预扫描实现（见 design.md Spike 补记）

## 2. Rust 解析与映射

- [x] 2.1 文件识别与读取（扩展名大小写不敏感＋ZIP 结构＋`[Content_Types].xml`；输入上限 64MB 有界读；中文报错）——`docx_import.rs` 1039–1155
- [x] 2.2 解压防护（zip 预扫描按真实读出量执行单条目 64MB／总量 200MB 上限，防声明值造假；压缩炸弹与超大文件均有测试）——`prescan_zip`
- [x] 2.3 块映射全项落地（Heading 样式 ID 与样式名含中文「标题 N」；有效可见编号→列表、墓碑与不可见定义普通段落；表格嵌套递归拍平；空段落保留；缺 Fallback 块计数告知；私货忽略；SDT 走通；w:br 同属性拆段）
- [x] 2.4 run 级格式与段落属性映射（bold/italic/underline/strike/color/sz/rFonts/highlight/link；对齐缩进行距段距 twips 与 *Chars 双路径；修订最终态留 ins·moveTo 去 del·moveFrom）
- [x] 2.5 canonical Tiptap JSON v2 转换并通过 notebook.rs 严格校验（金样本落盘 1.25MB 实证）
- [x] 2.6 序列标记识别（独立成段＋短序列文本第X集/章/回/部/卷＋Chapter N＋同族≥3＋全加粗；多族同时达标保守不建议）——935–1022

## 3. 导入 command 与落盘

- [x] 3.1 `import_docx_preview`（只读零写入，走 strict_read_content_tree；返回字数/结构/损耗/拆分建议/sha256/生成器印记）——lib.rs 726–772 注册
- [x] 3.2 `import_docx_commit`（重解析＋哈希比对 `hash_mismatch:` 前缀＋单次映射式事务落盘，失败回滚无残留；名称净化与同级唯一化；AI 可见性随既有默认）
- [x] 3.3 全部失败路径中文可读、稳定（`ImportRejected` 完整中文说明；cargo 测试覆盖哈希不一致零残留等）

## 4. 前端 UI

- [x] 4.1 文件管理区「导入 Word 文档」入口（新建入口旁；未打开作品/暂停禁用＋提示；file-management.ts 457–505 三处状态同步）
- [x] 4.2 文件选择（plugin-dialog `open()`，.docx 过滤、不依赖 MIME；取消返回 null 零副作用）——project-api.ts 59–79
- [x] 4.3 预检对话框（一句话结论＋损耗明细折叠完整呈现＋拆分二选一默认不拆＋目标位置选择器根级默认；复用 `.export-dialog` 骨架与既有控件语言）——word-import.ts 303 行＋index.html 610–636
- [x] 4.4 确认导入与完成反馈（哈希不一致留场提示＋自动重预检；成功刷新树＋展开新文件夹＋「导入完成：新建 N 个文档」）

## 5. 测试与验收

- [x] 5.1 Rust 单元测试 30 个：墓碑不编号、真编号转列表、lvlText 空不转、bullet 转 bulletList、表格拍平、格式标记保序、段落属性双路径、标题样式中英文、空段落保留＋同 marks 合并、修订最终态、缺 Fallback 计数、标记识别正反例、超大/压缩炸弹拒绝、预览计数/哈希、单文档提交、哈希不一致零残留、拆分提交文字零丢失、重名唯一化等（437 passed 0 failed，既有零回归）
- [x] 5.2 金样本实弹验证（一次性工具，样本不入库）：字符 55331 逐字一致、段落 2718、空段落 191、61 个集标记全数识别、0 凭空编号（730 墓碑全普通段落）、2 处真多级编号按规则降级告知、生成器印记提取成功、preview/commit 各约 0.9s
- [x] 5.3 补充样本测试：合成 fixture 断言 image_dropped／footnote_dropped／comment_dropped 计数如实、混合文档各计数互不干扰且正文逐字保留（`src-tauri/tests/word_import_test.rs`，443 passed 0 failed）；过程中发现并修复真缺陷——docx-rs 读侧不解析 `w:footnoteReference`，脚注计数改走 document.xml 本地名扫描通道（与缺 Fallback 计数同通道）；微软 Word 生成文件并入 5.5 真机冒烟
- [x] 5.4 往返测试（`export_import_roundtrip_diffs_are_enumerable`）：可见文字逐字逐序保留；差异恰为已知清单——范围根多出一级标题、列表→"• "／"N. "文字前缀、链接纯文字化、字号/字体/高亮丢失（导出侧既有降级）；**导入侧零新增损耗**（往返产物损耗清单为空）；加粗/斜体/下划线/删除线/颜色/标题层级/对齐/空段落全部保留；往返产物通过严格语法校验
- [x] 5.5 真机冒烟（账本第 21 条）：CDP 驱动真机端到端（tauri dev＋WebView2 `--remote-debugging-port`，导出验收同款方法论：直接 invoke 绕过原生对话框）——预检数字与解剖基准逐项一致（55,331 字／2,718 段／2 处编号降级如实告知／61 集标记／WPS 版本印记）；整文件导入 1 文档、拆分导入文件夹＋61 文档全部落盘；磁盘核验 66 节点、原有文档完好、第一集 v2 格式前言保留；入口三态正确（欢迎页禁用／作品开启用／文件管理区可见）；文件管理树显示并展开 61 集；写作页文档下拉含全部导入文档、整文件文档编辑器完整渲染 61,060 字；observer 判读截图存 `%TEMP%\opencode\smoke-import\`；**零产品缺陷**。诚实边界：原生文件选择对话框与预检对话框 UI 无法被合成点击驱动（导出验收同类先例），由 22 项 jsdom 测试＋契约测试覆盖，留用户最终走查。验证记录见本 change `验收记录.md`
