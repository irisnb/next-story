# 任务：统一多格式导出（PDF ＋ Markdown ＋ Word 重做）

## 1. 范围模型与字体地基

- [x] 1.1 `ExportProject` 投影增加范围参数（文档／文件夹子树／整个作品），树序与回收站规则不变；默认文件名按范围根生成；新增共享导出结果结构（Word 原结构不动直至其命令改造完成）
- [x] 1.2 思源黑体 CN 子集（常规＋粗体）下载入 `src-tauri/resources/fonts/`＋OFL `LICENSE.txt`；`tauri.conf.json` resources 登记；`scripts/check-package-resources.mjs` 增校验；记录实际字节数
  - 实施偏离（已在返回报告说明）：字体实际落位 `public/fonts/`（Regular 8,429,224 B＋Bold 8,569,308 B＋LICENSE 4,463 B），未登记 tauri.conf resources——前端 `@font-face` 需要 vite 可服务的同源资产；`public/` 内容随 `frontendDist` 嵌入应用内打包分发，离线与确定性不受影响，且避免 resources 双份 +17MB。
- [x] 1.3 前端 `@font-face` 注册捆绑字体，编辑器正文字体令牌从系统字体栈（`styles.css:94`）切换为捆绑思源黑体；打印窗口共用同一注册

## 2. 统一导出入口（前端）

- [x] 2.1 「导出」对话框：格式三选一（默认 Word）、范围三选一（默认当前文档，含树选择器）、文件名自动建议可改；随后原生保存对话框（过滤器随格式）
- [x] 2.2 `export-word.ts` 重构并入统一入口：「导出 Word」按钮替换为「导出」；未保存提示、导出中防重、取消静默、成功失败提示语义逐条沿用

## 3. Word 重做（Rust）

- [x] 3.1 `docx_export.rs` 样式保真：正文字体/字号（16px↔12pt 对齐）、标题层级字号按编辑器 CSS 值对齐、文字颜色沿用；块/行内解析与降级原则不动
- [x] 3.2 `export_project_to_word` 命令带范围参数；既有 12 个导出测试改造为范围模型（「整个作品」范围与旧行为语义等价覆盖）

## 4. Markdown（Rust）

- [x] 4.1 新建 `markdown_export.rs`：范围根→一级标题映射、列表嵌套与有序 start、行内格式（`**`/`*`/`~~`/链接/`<u>`）、color/fontFamily/fontSize/highlight 降级纯文字
- [x] 4.2 转义函数：覆盖 CommonMark 特殊字符，穷举单测（含中文全角字符不误伤）
- [x] 4.3 新命令 `export_project_to_markdown`（范围参数＋作品锁＋原子写＋错误折进结果结构）

## 5. PDF 打印管线

- [x] 5.1 常驻隐藏打印 `WebviewWindow`（首次导出创建、复用、应用退出销毁）；打印内容优先经应用内打印路由＋Tauri 事件传入（同源、无 CSP 改动；本地静态服务仅作回退）
- [x] 5.2 打印页面：从后端已保存数据渲染，共享编辑器块渲染 CSS（`@media print` 对齐）＋Paged.js 离线捆绑（A4 页盒、统一边距、底部居中页码）
- [x] 5.3 就绪等待三重信号（`NavigationCompleted` ＋ `document.fonts.ready` ＋ Paged.js 完成）替换先例的固定延时
  - 实施说明：`NavigationCompleted` 以页面 `print-page-boot`（脚本与载荷监听已注册）代位——它严格晚于导航完成，且窗口常驻复用时不重复导航、原生事件不会再次触发；全程事件驱动、无固定 sleep。
- [x] 5.4 Rust 打印模块：`with_webview`→`ICoreWebView2_7::PrintToPdf`（页尺寸 8.27×11.69 英寸、边距全 0、`ShouldPrintBackgrounds=TRUE`、无页眉页脚）；`#[implement]` 回调＋channel＋超时；全局串行打印队列；原子落盘；SDK 能力不足时中文降级报错
- [ ] 5.5 实机校准 Paged.js 页盒与打印页尺寸对齐；若失败启用兜底（`@page` 原生分页、放弃页内自定义页码）并在验收记录如实标注

## 6. 测试与验收

- [x] 6.1 Word 范围模型测试：三种范围的标题映射、树序、回收站排除（沿用既有测试改造）；「导出后作品数据字节不变」与「失败不留残file」沿用
- [x] 6.2 Markdown 集成测试：全类型内容断言（范围层级/嵌套列表/行内格式/转义/中文与 emoji）
- [ ] 6.3 PDF 自动化：打印回调成功＋`%PDF` 魔数＋页数非零；导出后作品数据字节不变
- [x] 6.4 前端对话框测试：取消静默、防重、范围与格式默认值、文件名建议
- [x] 6.5 `npm run check` 全量门禁通过；干净构建下打包资源检查通过（字体齐备）；前端构建产物含 Paged.js（离线可用）
- [ ] 6.6 更新安装包并真机验收：PDF 与软件内并排比对观感（字体/字号/颜色/强调/背景）；分页与页码；链接可点；Markdown 在 Typora/编辑器渲染正确；编辑器切换思源黑体后的日常观感由用户确认；安装包体积记录
- [ ] 6.7 验收后如需微调（排版常量/字体令牌），仅调常量并复验 6.6
