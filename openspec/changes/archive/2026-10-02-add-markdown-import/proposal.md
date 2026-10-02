# add-markdown-import Proposal

## Why

地基批次④（③ Word 导入已于 2026-10-02 交付归档）。Markdown 是导入三格中实现成本最低、收益直接的一格：一方面承接用纯文本／Obsidian 类工具写作的创作者的迁移通道；另一方面它是**本产品自己的导出格式**——「md 导出 → md 导入」往返可近乎无损，使其成为作品的轻量备份与交换通道。解析器选型已查证（pulldown-cmark 0.13.4，活跃维护、1.6 亿下载、仅 3 个轻依赖、GFM 表格/删除线/任务列表支持，详见 design.md）。

## What Changes

- **入口泛化**：「导入 Word 文档」入口改为「导入文档」，同一入口接受 `.docx` 与 `.md`（一条路径、不加按钮——简化率原则）；无打开作品时禁用与提示不变。
- **后端命令泛化**：`import_docx_preview` / `import_docx_commit` 改名为 `import_document_preview` / `import_document_commit`，按扩展名自动识别格式分发（`.docx` 走既有管线，`.md` 走新解析）；哈希校验、事务落盘、失败无残留等语义全部沿用。泛化一次到位，为 ⑤ Final Draft 复用同一管线。
- **Markdown 映射**：标题 1-6、段落、无序/有序列表（含嵌套与起始编号）、粗体/斜体/删除线、链接、`<u>` 下划线（自家导出方言）全部保留；行内代码与代码块、引用块、表格、图片、脚注、任务列表、frontmatter、其他 HTML 按既有降级哲学处理并在预检中如实告知。
- **拆分建议**：识别重复标题序列（同层级、短序列文本如「第一章」「第X集」、重复 ≥3）→ 同款「机器建议、默认不拆、用户拍板」。
- **编码**：仅 UTF-8（读入时剥离 BOM）；其他编码以中文报错建议转存，不猜测编码。
- **范围外**：Final Draft 导入（批次 ⑤）；非 UTF-8 文件的编码转换；frontmatter 元数据导入（剥离并告知）；Markdown 导出（已交付）。

## Capabilities

### New Capabilities

- `project-markdown-import`: 从外部 `.md` 文件导入内容为作品文档：UTF-8 识别与 BOM 剥离、pulldown-cmark 解析与结构映射（含 `<u>` 配对）、超出语法承载元素的降级与如实告知、重复标题序列的拆分建议（用户拍板）、导入落盘与失败处理、md 往返近无损的验收基准。

### Modified Capabilities

- `file-management-ui`: 「文件管理区提供 Word 导入入口」需求修改为「提供文档导入入口」——同一入口接受 `.docx` 与 `.md`，位置、禁用态与边界（只创建新文档、不写既有正文）不变。
- `project-word-import`: 「选择并识别 .docx 文件」需求中的入口名称随共享入口更新为「导入文档」；`.docx` 的识别、映射、预检、落盘等专属行为全部不变。

## Impact

- **Rust 后端**：新增 md 解析模块（映射进 docx_import 已建的预检/提交管线骨架）；命令改名并加格式分发；新增依赖 `pulldown-cmark` 0.13.4（传递依赖仅 bitflags/memchr/unicase）。
- **前端**：入口与对话框文案改「导入文档」；`project-api.ts` 封装随命令改名；预检对话框损耗标签表扩充 md 新增 kind 的中文标签；文件选择过滤器加 `.md`。
- **规格**：`file-management-ui` 与 `project-word-import` 各一处 MODIFIED requirement。
- **测试**：映射规则单测（含 `<u>` 配对、软换行 CJK 接合、frontmatter 剥离）；**md 导出→导入往返测试**（核心验收）；真机冒烟（账本第 21 条：命令改名触及 ACL 注册面）。
