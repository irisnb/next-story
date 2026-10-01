# 设计：统一多格式导出（PDF ＋ Markdown ＋ Word 重做）

## Context

- **既有链路**（exp-2）：`index.html:112` → `export-word.ts:22`（未保存提示/防重）→ `project-api.ts:72-86`（save 对话框＋invoke）→ `lib.rs:639`（spawn_blocking＋作品锁）→ `export.rs:288-316`（`ExportProject` 投影 :26-82，树序递归）→ `docx_export.rs` → 原子写。12 个真实解包测试（`src-tauri/tests/export_test.rs`）。
- **打印路线证据**（lib-2 第二轮）：PrintToPdf 在 `ICoreWebView2_7`（SDK 1.0.1020.30+），设置单位英寸、边距可 0、`ShouldPrintBackgrounds` 须显式 TRUE、同一 webview 同时仅一个打印任务、应用早退则不落盘；原生页眉页脚格式固定不可控（日期/URI/页码），自定义页码须 Paged.js 预分页；QuickOutline（生产、活跃）提供可抄骨架：常驻打印窗口、`with_webview`→cast→`#[implement]` 回调＋mpsc＋超时、内容经本地 URL 加载（`NavigateToString` 有资源坑）；其已知短板须重做：固定 1500ms sleep 换事件驱动、打印设置逐项显式设置。字体：Chromium 打印自动嵌入所用字体子集；系统字体依赖机器配置有漂移与许可灰区，**捆绑思源黑体统一编辑器与导出是最稳解**（OFL 已核允许捆绑/嵌入/子集化）。
- **编辑器字体现状**：`styles.css:94` 系统字体栈（"Microsoft YaHei", "PingFang SC"…）；正文 16px（12pt 同值）。
- **已否决路线**：嵌入 typst（独立排版引擎，能力一流但观感与编辑器无关，与用户拍板的所见即所得冲突；调研结论存对话记录，将来若要"独立精排"再启）。

## Goals / Non-Goals

**Goals:**

- 统一导出模型：格式（PDF/Word/MD）× 范围（当前文档/文件夹/整个作品），单一入口。
- PDF 所见即所得：同一 WebView2 内核、同一捆绑字体、对齐的 CSS，观感与软件内一致；A4、统一边距、底部页码、链接可点、离线。
- Word 样式保真：字体/字号/颜色与编辑器呈现对齐（可编辑格式允许合理近似）。
- Markdown 保内容：结构与行内格式映射、转义、降级不丢字符。
- 既有只读/安全边界全部沿用。

**Non-Goals:**

- 不做导入（批次③④⑤）。
- 不做"所见即所得＝像素级相同"——纸张分页与屏幕滚动必然不同；一致的对象是字体、字号、颜色、强调、对齐与背景。
- 不做打印份数/打印机/页面范围等打印 UI（只出 PDF 文件）。
- 不做导出模板/主题选择（排版参数为内置常量，验收可调）。

## Decisions

1. **范围模型在投影层实现，三种格式共用。**
   `ExportProject` 增加范围参数：`Document(id)`（单文档）/ `Folder(id)`（子树，含嵌套）/ `Work`（全树，现状）；树序与回收站排除规则不变。层级标题映射以范围根为基准：作品→H1（文件夹 H2/文档 H3）；文件夹→H1（文档 H2）；文档→文档名 H1；文档内部标题始终按自身层级（1–6）输出。默认文件名按范围根名称。

2. **统一导出对话框（前端），替代「导出 Word」按钮。**
   一个「导出」入口 → 对话框：格式三选一（**默认 Word**，与既有习惯衔接）、范围三选一（默认当前文档，树选择器）、文件名（自动建议可改）→ 原生保存对话框（过滤器随格式）→ 调用导出。防重、取消静默语义逐条沿用 `export-word.ts` 既有实现；未保存提示收窄为**仅当导出范围包含当前文档且该文档有未保存修改时**提示"导出使用后端已保存版本"（范围不含当前文档时，当前编辑器的未保存状态与导出无关，提示纯属噪音）。

3. **PDF 打印管线（抄 QuickOutline 骨架，重做其短板）：**
   - 常驻隐藏 `WebviewWindow`（打印专用，首次导出时创建，之后复用；应用退出时销毁）。
   - 内容：前端从**后端已保存数据**取范围内容，用与编辑器共享的块渲染 CSS（`@media print` 对齐）＋Paged.js 生成 `.pagedjs_page` 页盒（A4 尺寸、统一边距、底部居中页码）。
   - 加载方式：优先**应用内打印路由**——隐藏窗口加载应用自身前端的打印页（同源、字体与 Paged.js 走捆绑资产、内容经 Tauri 事件传入），不新增网络面与 CSP 改动；若隐藏窗口下事件/路由遇到 Tauri 实际限制，回退到本地静态服务（仅 127.0.0.1 回环、仅打印内容），此时须在 CSP／Tauri 安全配置显式放行且不放宽其他来源。
   - 就绪等待（事件驱动，替换先例的 sleep）：`NavigationCompleted` ＋ `document.fonts.ready` ＋ Paged.js 完成 三重信号齐 → 通知 Rust。
   - Rust：`window.with_webview` → `ICoreWebView2_7::PrintToPdf`，设置显式：`PageWidth/Height=8.27×11.69` 英寸、`Margin` 全 0、`ShouldPrintBackgrounds=TRUE`、无页眉页脚；回调经 `#[implement]`＋channel＋超时（30s 量级）→ 原子落盘（临时文件＋重命名）。同一时间仅一个打印任务（队列串行）。
   - 页码：Paged.js `@page` margin box ＋ `counter(page)`（Chromium 原生不支持 margin boxes，由 Paged.js 在 DOM 层实现）。**兜底**：若预分页与打印双分页对齐在实机校准失败，退化为 @page 原生分页＋放弃页内自定义页码（在验收记录如实标注）。

4. **字体：捆绑思源黑体 CN 子集（常规＋粗体），编辑器与导出共用。**
   `src-tauri/resources/fonts/`＋OFL LICENSE.txt＋tauri.conf resources＋package:check 校验；前端 `@font-face` 注册后把编辑器正文字体令牌从系统栈切到捆绑字体；打印窗口用同一 `@font-face`。观感变化（微软雅黑→思源黑体）在真机验收时由用户确认，不满意可只调字体令牌。Word 导出的正文字体/字号同步设为同族（docx 字体名"Source Han Sans CN"或注册名），未装该字体的机器打开 docx 会回退系统字体（可编辑格式的合理近似，如实告知）。

5. **Word 重做范围：只动范围模型与样式保真，不动已验证的内容保真骨架。**
   `docx_export.rs` 保留块/行内解析与既有降级原则，新增：正文字体/字号（16px↔12pt）、标题层级字号按编辑器 CSS 值对齐、文字颜色沿用、段落对齐（消费已有 textAlign attrs）；行距/段距本轮不消费（维持现状，留待编辑器排版专项）。命令带范围参数，旧"整作品"行为由 `Work` 范围完整覆盖（既有 12 个测试改造后语义延续）。

6. **Markdown 纯函数序列化器（与前期设计一致，加范围根映射）。**
   映射表：范围根→`#`、子层级递进；bold/italic/strike/link/`<u>`；color/fontFamily/fontSize/highlight 降级；CommonMark 特殊字符转义（穷举单测，含全角字符不误伤）。

## Risks / Trade-offs

- [unsafe COM 与 WebView2/wry 内部耦合] → 集中在单一打印模块；先例骨架（QuickOutline 生产验证）＋显式设置＋超时；SDK 版本运行时检查给出中文降级错误。
- [Paged.js 预分页 ≠ 打印分页（先例踩坑笔记）] → 页盒尺寸与 PrintToPdf 页尺寸/零边距严格对齐；实机校准列为 apply 阶段首个垂直切片；兜底路线已在决策 3。
- [同一 webview 单打印任务] → 导出队列全局串行；对话框防重沿用。
- [常驻隐藏窗口的内存与生命周期] → 单窗口复用（先例同款）；退出时销毁；不因导出增加常规写作内存。
- [编辑器字体切换改变日常观感] → 验收时用户确认；仅字体令牌一处可回退。
- [安装包 +17MB] → 已知代价，验收记录如实记。
- [Word 机器无思源黑体] → docx 回退系统字体显示（内容与颜色不受影响），如实告知不算缺陷。

## Migration Plan

纯新增＋Word 模块内改造，无数据迁移。回滚＝还原导出相关文件与字体资源；Word 旧测试随范围模型一并改造，保持语义等价覆盖。
