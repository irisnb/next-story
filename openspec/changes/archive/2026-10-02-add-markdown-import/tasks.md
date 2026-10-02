# add-markdown-import Tasks

## 1. Spike 与依赖

- [x] 1.1 添加 `pulldown-cmark` 0.13 依赖（已入 Cargo.toml）；spike 四点全部实证——BOM 不剥离须自行剥、`<u>` 逐标签 InlineHtml、表格/脚注事件形态、Hard/SoftBreak 区分；金样本 104 事件确认 Link 带 dest_url、List(Some(3)) 起始编号、转义自动还原（详见 design.md Spike 补记）

## 2. Rust md 解析与映射

- [x] 2.1 `.md` 识别：剥 BOM→严格 UTF-8（中文报错）→CRLF/CR 统一 LF→16MB 上限（`md_import.rs` 读取层）
- [x] 2.2 事件流→语法映射全项：标题/段落/嵌套列表与 start/粗斜删/链接/`<u>` 平坦配对状态机（未闭合降级保文字）/转义还原/硬换行拆段/软换行 CJK 接合（表意/假名/谚文/CJK 标点/全角覆盖）
- [x] 2.3 降级与损耗计数全项：code_degraded（行内＋块合并、note 分列）/quote_degraded/table_flattened/image_dropped（替代文字随图丢弃）/footnote_dropped（引用字面保留、定义丢弃）/tasklist_degraded（`[x] `/`[ ] ` 字面）/hr_dropped/html_stripped/frontmatter_dropped
- [x] 2.4 YAML frontmatter 识别与整体剥离（无结束 `---` 时按普通内容处理，正反例单测）
- [x] 2.5 重复标题序列拆分建议：序列标记框架泛化（族键含层级前缀），同层级短序列标题重复 ≥3；docx 标记资格收紧为「顶层、非列表、全加粗」并新增单测钉死
- [x] 2.6 canonical Tiptap JSON v2 转换并通过既有严格语法校验（preview 自检＋commit 逐份＋往返断言）

## 3. 命令泛化

- [x] 3.1 `import_document_preview`/`import_document_commit` 改名落地：共享管线迁入 `document_import.rs`（687 行）、`md_import.rs` 新建（1203 行）、`docx_import.rs` 瘦身（1789 行）；lib.rs 注册与文档更新；按扩展名分发（.docx ZIP 校验不变）
- [x] 3.2 既有测试随改名迁移：**484 passed 0 failed**（基线 443 零回归）；WPS 金样本复验 55,331 字逐字一致、61 标记、0 凭空列表——重构零破坏
- [x] 3.3 失败路径中文可读、稳定（编码错误/超限/解析失败；无 panic、无半成品）

## 4. 前端

- [x] 4.1 入口文案「导入文档」＋对话框标题同步；过滤器泛化 docx＋md；dom-contract 断言更新
- [x] 4.2 `selectDocumentFile`/`importDocumentPreview`/`importDocumentCommit` 改名；`hash_mismatch:` 协议与契约字段逐字不变（契约测试逐字断言）
- [x] 4.3 损耗标签表扩至 13 项（六项任务给定措辞＋三项自拟，编排者已复核通过）
- [x] 4.4 md 说明行「换行按文字接合处理」（选中 .md 显示、.docx 隐藏清空；复用既有弱化样式，零新设计元素）

## 5. 测试与验收

- [x] 5.1 映射规则单测 35 项：`<u>` 配对正反例四组、软换行接合（纯 CJK/中西混排）、frontmatter 剥离正反例、转义还原、列表嵌套与 start、各降级 kind 计数正反例、同层级标题序列识别（正/层级不一致/稀疏/段落式反例）
- [x] 5.2 **md 往返测试（核心验收）通过**：列表结构无损（嵌套＋start=3 保留，优于 docx 往返）；标题/粗/斜/删/下划线/链接/全部文字逐项一致（字数逐字核对、源文档逐字节不变）；差异恰为已知项——文档名冠首 heading、四项导出降级；**实测发现并钉死**：同文字「下划线＋删除线」组合经导出侧包裹顺序（`~~<u>…</u>~~`）与 CommonMark 侧翼规则交互，往返后 strike 丢失、字面 `~~` 保留（文字零丢失、有专测钉死、修复路径注明：导出侧调换包裹层级，须另立导出 change）
- [x] 5.3 补充样本测试 6 项端到端：frontmatter/损耗清单/拆分提交/BOM/哈希不一致/超限；软换行、表格、代码块、CRLF、非 UTF-8 在单测与端到端中覆盖
- [x] 5.4 真机冒烟（账本第 21 条）：CDP 全链路零产品缺陷——入口「导入文档」三态正确；合成样本预检六类损耗逐项精确命中＋拆分建议第X章×3（「尾声」正确排除）；**自家金样本损耗清单为空（全部保留）**；docx 走改名后命令 55,331 字/2 编号降级/61 标记与 Word 验收逐项一致（泛化零破坏）；整文件＋拆分双提交落盘；树与编辑器验证全过（加粗/斜体/删除线/下划线/链接全渲染，**软换行接合真机实证**）；两次「树不可见」均为自动化陈旧态假设（刷新重开即现，与 Word 冒烟同教训）。截图存 `%TEMP%\opencode\smoke-import\`（md-01~07）。验证记录见本 change `验收记录.md`
