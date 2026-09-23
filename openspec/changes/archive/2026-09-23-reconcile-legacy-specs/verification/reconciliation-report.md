# 旧世界规格对账调查报告

> 2026-09-23 只读调查（收尾路线 Change C 前置，审计第 C 行「先调查现状再定改法」）。逐份逐条判定＋交叉引用核实；处置结论已转写为 design.md 逐条处置表。

## 世界模型基线

内容树（文件夹＋任意文档）为现行存储；前端单一编辑器绑定当前文档；选区快照携带 `documentId`＋作品/版本身份（`src/types.ts`、`ai-panel-conversation.ts:425`）；**前端 `draft`/`main` 本子代码标识已全量消失**（src/ 全库 grep `"draft"|"main"|notebookKind|notebookId` 零命中）；作品结构版本代码为 **4**（`project/mod.rs:60`，注册 2→3 双本子迁移与 3→4 物化 ai_visible）。

## 一、writing-notebooks（266 行，11 条 Requirement）

| # | Requirement（行号） | 判定 | 依据 |
|---|---|---|---|
| R1 | Editor provides draft and main text notebooks（:6-20） | 已死 | 双标签页 UI 不存在；现实为内容树＋当前文档（workspace-navigation:26-65） |
| R2 | 两个本子的代码标识唯一对应（:22-46） | 已死 | `draft`/`main` 标识零命中；现实是稳定文档 ID（content-tree-commands:20-39） |
| R3 | User can edit draft and main text（:48-64） | 失真（框架） | 编辑能力仍真但单编辑器承载；结构化事实源由 structured-notebook-storage 承接；:61-64「内部更新不产生用户内容」精神仍真 |
| R4 | Manual save writes both notebooks（:66-77） | 失真 | 手动保存仍真，按受影响文档保存（desktop-project-lifecycle:117-149 承接） |
| R5 | Saved notebook content is loaded when reopening（:79-87） | 失真 | 按内容树文档 ID 加载（content-tree-commands:20-36＋workspace-navigation:44-65） |
| R6 | Notebook switching preserves unsaved input（:89-104） | 已死且被相反行为取代 | 现实：切换文档**先静默保存**、失败阻止切换（`editor.ts:299-306`）；新行为无规格承接（全 specs grep「静默保存」零命中） |
| R7 | Leaving a project protects unsaved changes（:106-151） | 行为仍真、措辞失真 | 三选一离开保护存在（`leave-guard.ts`、`leave-dialog.ts`、`main.ts:131-143`）；判断对象是当前文档；格式变化计入未保存仍真（`editor-save-state.ts`） |
| R8 | Closing the application protects unsaved changes（:153-192） | 行为仍真、措辞失真 | `main.ts:150-167` CloseCoordinator＋onCloseRequested＋composeCloseGuards |
| R9 | Save failure never discards current input（:194-215） | 行为仍真、措辞失真 | leave-guard saveUntilClean；editor-save-state「保存失败：原因」态 |
| R10 | Editor communicates save state（:217-248） | 行为仍真、措辞失真 | editor-save-state.ts:28-33 四态文案逐字一致，对象为单个当前文档 |
| R11 | AI and background automation never write user notebooks（:250-265） | 边界仍真、宾语旧 | 由 AGENTS.md、controlled-story-read-visibility、content-tree-storage:199-205、content-tree-commands:132-138 多处承接 |

**职责承载对照**：双本子 UI/切换→workspace-navigation＋content-tree-commands；磁盘事实源→structured-notebook-storage＋content-tree-storage；保存事务→desktop-project-lifecycle；**R7-R11（离开/关闭保护、保存失败不丢输入、保存状态沟通）无任何其他规格承接，本规格是唯一真相源**。

## 二、production-editor-kernel（155 行，9 条）

| # | Requirement（行号） | 判定 | 依据 |
|---|---|---|---|
| R1 | 中文组合输入和常用编辑操作稳定（:6-22） | 仍真；:22 措辞失真 | 「一个本子的撤销重做不改变另一个本子」无对象 |
| R2 | 两个本子的编辑状态和历史互相隔离（:24-35） | 已死 | 标签切换不存在；现实是切换文档先静默保存＋实例切换 |
| R3 | 编辑器实例随作品生命周期释放（:37-49） | 精神仍真、措辞失真 | 「两个 Tiptap 实例」→单实例；:43 草稿本/正文本读取措辞失真；与 project-reliability-boundaries:63-99 互补不重叠 |
| R4 | 真实剧本长度下编辑保持可用（:51-62） | 仍真（性能基线） | 20 万字/p95 50ms/300MB 门槛有效；:62 尾句失真 |
| R5 | 生产写作区使用 Tiptap 基础富文本内核（:64-80） | **失真最重** | 「格式版本 1、仅两级标题、MUST NOT 开放链接/下划线/三级标题/颜色」与 structured-notebook-storage 版本 2 grammar（一到六级标题、链接、下划线、删除线、颜色、字体字号、段落属性）直接矛盾 |
| R6 | 结构化文档保持支持的内容和格式（:82-100） | 已死大半 | 「唯一格式版本 1 schema」已死；:97-100 两份完整结构化文档提交已死；往返语义已由 structured-notebook-storage 完整承接 |
| R7 | 外部粘贴只进入受控结构（:102-114） | 仍真 | 引用 controlled-rich-text-paste；措辞可泛化 |
| R8 | 编辑器内核依赖单一入口且安全锁版（:116-130） | 仍真（现行） | 2026-09-16 upgrade-tiptap-v3 新增 |
| R9 | 内核升级以金样本锁定（:132-154） | 仍真（现行） | 同上；已引用版本 2 grammar（与 R5/R6 自相矛盾） |

## 三、basic-rich-text-editing（153 行，部分失真）

失真仅 4 处框架措辞，行为条款全部仍真：
1. :4 Purpose「快捷键与撤销历史都只作用于当前本子」；
2. :6-7 Requirement「当前本子提供基础富文本工具栏」＋「只操作当前本子」；:9-12 Scenario「命令只作用于当前本子／不改变另一本子」；
3. :19-22 Scenario「切换本子后工具栏与抽屉跟随当前本子」（草稿本→正文本）；
4. :114-124 Requirement「基础富文本快捷键和历史只作用于当前本子」＋:118-120「在正文本应用粗体…草稿本不发生变化」。

仍真清单：段落样式（:36-51）、粗斜体三态（:53-64）、列表规则含拆分编号（:66-99）、清除格式（:101-112）、窄窗口（:126-132）、抽屉自动收起（:134-144）、工具栏独立列（:146-152）。:25/:27-34「当前本子」属措辞级可顺手泛化。

## 四、editor-context-menu（31 行）

- :6-7「在草稿本与正文本的编辑区提供右键菜单…菜单命令 MUST 只作用于当前本子」——措辞失真。代码现实（`src/editor-context-menu.ts`）：右键绑定单一 `dom.editorTextarea`（:52）；菜单项与禁用逻辑（:42-45）与规格一致；project-reliability-boundaries:70-73 已有现代表述。菜单项构成、无格式命令、链接命令遵守 text-links——全部仍真。
- :24-25 粘贴为纯文本入口——仍真（editor-context-menu.ts:56）。

## 五、selection-ai-invocation（119 行）与 selection-ai-summon（100 行）

**selection-ai-invocation**：
- 本子标识条款＝整条 Requirement「选区快照本子类型代码标识唯一」（:79-107），含 :104-107 Scenario「统一命名不改变 AI 边界」（:107 即 8d 跳过的守护句「系统仍不得提供把 AI 内容直接插入…到草稿本或正文本的入口」）。
- R1「召唤时冻结与编辑器实现解耦的选区快照」（:6-77）主体仍真（投影规则是两入口共用材料冻结真相源）；失真点：:7「冻结本次选区的本子类型」、:9-12「冻结草稿本结构化选区…标记为草稿本」、:15「在正本选中」、:21-23「切换本子」、:98-102「前端可以在运行期快照中记录 draft 或 main」。
- R3「AI 预检在异步前冻结作品身份」（:109-118）仍真（本规格为原始出处，summon:41 是引用式复述）。
- **两份互补，invocation 未被 summon 取代**（archive `2026-08-30-restore-selection-summon-entry` design.md:78「复用 selection-ai-invocation 的冻结机制」）。

**selection-ai-summon**：基本干净，仅 :7/:10「草稿本或正本」两处残留（8d 已把 :53 守护句现代化）。

## 六、交叉引用核实

- 5 份规格名在其余活规格中**零引用**；引用仅存在于 archive/（历史保留）、方向/审计文档（登记性）、docs/diagrams（已挂历史标注）。
- AGENTS.md 只引用 selection-ai-summon（:75/:91）；README 不引用这 5 份规格名；src/、src-tauri/ 无规格名引用。
- 结论：任何 REMOVED/大改不断链；唯一注意点＝保留 selection-ai-invocation 规格名。

## 七、附带发现（调查期新坐实）

1. **desktop-project-lifecycle:190 自身失真**——「注册了一个迁移步骤：2→3…版本 3 即当前版」与代码不符（CURRENT_VERSION=4；migration.rs 注册 2→3 与 3→4）。
2. 「切换文档先静默保存」（editor.ts:299-306）无规格承接。
3. 代码层旧词残留：structured-notebook.ts:1-3 注释、find-replace.ts:1、ai-session-transport.ts:28、editor-margin.ts:2、rich-text-editor.ts:382「无法将图片加入本子」（用户可见）、generate.rs:29 系统提示词「不直接改草稿本或正文本」（模型可见）。
4. 相邻规格措辞：find-replace:4「当前本子」、controlled-rich-text-paste:95「本子内复制」。
5. 审计收尾路线 C 行第 5 份写作 selection-ai-summon，实证应为 **selection-ai-invocation**（补充十六与 8d 归档一致）——审计表行笔误。
