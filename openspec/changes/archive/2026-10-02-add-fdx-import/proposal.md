# add-fdx-import Proposal

## Why

地基批次⑤（③ Word、④ Markdown 已于 2026-10-02 交付归档）。Final Draft 是好莱坞剧本软件的事实标准，`.fdx` 是其存档格式并已成行业交换枢纽（其他剧本软件几乎都读写它）——真实用户点名（2026-10-02 探索讨论）。格式查证已完成（librarian）：**明文 UTF-8 XML、事实开放**（无官方现行规范，靠真实样本逆向；Python/TS/ObjC/Ruby 有开源参考实现）；`.fdx` 自带剧本段落语义（场景头/人物/对白是文件明说的，不用猜）——三种导入格式里"最懂剧本"的一格。导入管线已泛化（`import_document_*`），fdx 作为第三格式接入。

## What Changes

- 「导入文档」入口接受 `.fdx`（第三格式）；`.fdr`（FD 1–7 私有二进制老格式）拒绝并以中文提示在 Final Draft 内另存为 `.fdx`。
- **段落类型语义映射**：Scene Heading→标题、New Act→一级标题、Outline N→N 级标题、Character/Dialogue/Parenthetical→缩进段落（视觉近似）、Transition→右对齐段落、Action→普通段落；场景编号（Number 属性）并入场景头文字；Text 的 Style 属性映射粗体/斜体/下划线。
- **结构性降级＋如实告知**：双栏对白（DualDialogue）拆为先后两组段落；标题页（TitlePage）文字并入文档开头保文字；场景元数据（SceneProperties/Story Map 场景数据）、剧注（ScriptNote）丢弃计数；修订标记（Revisions 体系）忽略、文字无损；其余机器家具（TagData/Watermarking 等）无感丢弃。
- 拆分建议：场景头成为标题后复用既有标题序列规则（如「第X集」式场景头）——默认不拆、用户拍板。
- XML 解析自研：roxmltree 一次性 DOM（轻依赖）；两个公开真实 FD 生成样本（wonderunit/storyboarder fixture、vilcans/screenplain 双栏对白测试）入库作测试金样本，真实样本驱动开发。
- 顺带落地 des-1 遗留建议：**word→document 命名清理**（DOM id、`word-import.ts` 模块与测试文件名，纯机械重命名零行为变化）。
- 范围外：`.fdr` 二进制解析；Final Draft 导出；Beat Board（FD11+）数据导入（公开样本未见的部分，覆盖度未确证）；修订色还原。

## Capabilities

### New Capabilities

- `project-fdx-import`: 从外部 `.fdx` 文件导入内容为作品文档：文件识别（含 `.fdr` 拒绝）、XML 解析与段落类型语义映射、结构性降级与如实告知（双栏对白/标题页/场景元数据/剧注/修订标记）、拆分建议（用户拍板）、导入落盘与失败处理、内容逐字来自用户文件。

### Modified Capabilities

- `file-management-ui`: 「文件管理区提供文档导入入口」需求的格式枚举扩展为 `.docx`、`.md` 与 `.fdx` 三种。
- `project-word-import`: 「选择并识别 .docx 文件」需求中的入口交叉引用改为泛化措辞（同一入口接受多种格式、由对应规格规定），不再逐格式枚举。

## Impact

- **Rust 后端**：新增 `fdx_import.rs`（roxmltree 解析＋段落映射）；`import_document_*` 加 `.fdx` 分发；新增依赖 roxmltree；word→document 模块与符号命名清理。
- **前端**：文件选择过滤器加 `.fdx`；损耗标签表扩 5 项（双栏对白降级/标题页并入/场景元数据丢弃/剧注丢弃/修订标记忽略）；命名清理同步（DOM id、模块文件名）。
- **规格**：`file-management-ui` 与 `project-word-import` 各一处 MODIFIED。
- **测试**：真实 FD 生成 fixture 入库作金样本；映射规则单测；真机冒烟三格式回归（docx/md 既有零破坏）。
