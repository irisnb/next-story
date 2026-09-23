# 设计：旧世界规格对账

> 执行依据＝本文件的逐条处置表（源自 2026-09-23 只读调查，全文见 `verification/reconciliation-report.md`）。零行为变化。

## Context

2026-08 起作品结构从「双本子世界」（随笔本＋剧本本两个固定文档）迁移到「内容树」（文件夹＋任意文档，作品结构版本现为 4）。五份旧规格仍在不同程度上描述旧世界；调查另坐实一处同类失真（desktop-project-lifecycle 迁移条款停留在版本 3）与一条无家现行行为（切换文档先静默保存）。前端 `draft`/`main` 本子代码标识已全量消失；5 份规格名在其余活规格中零引用，删除／大改不断链。

## Goals / Non-Goals

**Goals：** 10 份规格文本与内容树现实对账；死对象删除且不制造行为真空；无家行为规格化；同型措辞与用户／模型可见字符串清扫；全程零行为变化、零 API 费用。

**Non-Goals：** 不改任何产品行为与代码逻辑（字符串／注释清扫除外）；不重写历史文档（方向/ 快照、archive/ 原文保留）；不动 README 与 AGENTS.md（前者不引用这些规格名，后者仅引用 summon 名）。

## Decisions

### D1　分层修法（四刀）

- **REMOVED（对象已死）**：writing-notebooks R1（双标签页 UI）、R2（本子代码标识）、R6（切换保留未保存输入）；production-editor-kernel R2（本子编辑状态隔离）；selection-ai-invocation R2（本子标识条款 :79-107）。
- **删并（职责已在别处，防双真相源）**：writing-notebooks R3→`structured-notebook-storage`（结构化事实源）、R4→`desktop-project-lifecycle:117-149`（手动保存）、R5→`content-tree-commands:20-36`＋`workspace-navigation:44-65`（重开加载）；production-editor-kernel R6→`structured-notebook-storage`（往返语义，整删）。
- **MODIFIED（措辞对账）**：见逐条处置表。
- **ADDED（无家行为规格化）**：workspace-navigation 新增「切换文档先静默保存且失败阻止切换」。

### D2　writing-notebooks 保命底线

R7–R11（离开保护、关闭保护、保存失败不丢输入、保存状态沟通、AI 永不写入）是这些行为的**唯一真相源**——行为断言逐字保留，只做宾语替换（「任一本子／草稿本／正文本」→「当前文档」；R11 宾语现代化为「用户文档」）。不可整份 REMOVED。

### D3　格式范围单一真相源

production-editor-kernel R5 的「格式版本 1、仅两级标题、MUST NOT 开放链接／下划线／三级标题／颜色」整段废除，改为引用式表述：「编辑器支持的内容与格式范围以 `structured-notebook-storage` 的现行格式 grammar（当前为版本 2）为准」；R6 整删（往返语义由该规格完整承接）。消除本规格内部 R5/R6（版本 1）与 R9（已写版本 2）的自相矛盾。

### D4　切换静默保存新家（ADDED 草文，照抄入 delta）

```
### Requirement: 切换文档先静默保存且失败阻止切换

系统 SHALL 在切换当前文档前先静默保存当前文档；静默保存失败时 SHALL 阻止切换，保持当前文档、其未保存状态与失败原因可见，MUST NOT 静默丢弃未保存修改。

#### Scenario: 切换前静默保存
- **WHEN** 用户从文档 A 切换到文档 B 且 A 有未保存修改
- **THEN** 系统先保存 A 再完成切换
- **AND** 切换完成后 A 不再带有未保存标记

#### Scenario: 静默保存失败阻止切换
- **WHEN** 切换前的静默保存失败
- **THEN** 系统保持 A 为当前文档、不执行切换
- **AND** 未保存状态与保存失败原因保持可见
```

依据：`src/editor.ts:299-306`（现行行为，全规格库此前零承接）。

### D5　selection-ai-invocation：名留条删

规格名保留（`方向/第一版方向共识:81` 引用＋`selection-ai-summon` 复用其冻结规则）。R2 整条删除时 Reason 注明：守护边界（:104-107 句式）已由 AGENTS.md 宪法与 AI 边界相关规格的现代化表述承接，不随删丢失；R1 冻结字段描述从「本子类型」改为「来源文档身份（documentId＋版本身份）」。

### D6　REMOVED 条目格式

每条 REMOVED 必须带 **Reason**（对象消失／职责归属）与 **Migration**（指向承接规格；R6 的 Migration 指向 workspace-navigation 新条并注明「旧行为已被相反行为取代」）。

### D7　顺带清扫边界（8d「项目→作品」先例）

- 相邻规格：`find-replace:4`「当前本子」、`controlled-rich-text-paste:95`「本子内复制」→ 泛化。
- 用户／模型可见字符串：`rich-text-editor.ts:382`「无法将图片加入本子」→「…加入文档」；`generate.rs` 系统提示词守护句「不直接改草稿本或正文本」→「不直接修改用户文档」（保持原意与语气）。
- 注释类：`structured-notebook.ts:1-3`、`find-replace.ts:1`、`ai-session-transport.ts:28`、`editor-margin.ts:2` 同步泛化。
- 测试断言若锁定这些字符串，断言随改。

### D8　审计勘误

归档时把审计收尾路线 C 行的「selection-ai-summon（本子标识条款）」更正为「selection-ai-invocation（本子标识条款）」（补充十六与 8d 归档均为后者，调查实证同）。

## 逐条处置表（执行依据）

### writing-notebooks（11 条）

| 条 | 处置 | 要点 |
|---|---|---|
| R1 双标签页 UI | REMOVED | 对象不存在；Migration→workspace-navigation／content-tree-commands |
| R2 本子代码标识 | REMOVED | `draft`/`main` 代码标识零命中；「一个概念一个名字」由宪法承接 |
| R3 编辑两本 | 删并 | →structured-notebook-storage；「内部更新不产生用户内容」场景精神已含 |
| R4 手动保存两本 | 删并 | →desktop-project-lifecycle 手动保存条 |
| R5 重开加载 | 删并 | →content-tree-commands＋workspace-navigation |
| R6 切换保留未保存 | REMOVED | 行为已被相反行为取代；Migration→workspace-navigation 新 ADDED |
| R7 离开保护 | MODIFIED | 「任一本子」→「当前文档」，三选一与格式计入断言原样 |
| R8 关闭保护 | MODIFIED | 同上 |
| R9 保存失败不丢输入 | MODIFIED | 同上 |
| R10 保存状态沟通 | MODIFIED | 四态文案断言原样，对象单文档化 |
| R11 AI 永不写入 | MODIFIED | 宾语→「用户文档」 |

### production-editor-kernel（9 条）

| 条 | 处置 | 要点 |
|---|---|---|
| R1 中文输入与常用操作 | MODIFIED | 删「一个本子的撤销重做不改变另一个本子」句，其余原样 |
| R2 本子状态隔离 | REMOVED | 对象不存在 |
| R3 实例随生命周期释放 | MODIFIED | 「两个 Tiptap 实例」→「编辑器实例（当前文档）」；删草稿本/正文本读取措辞 |
| R4 长文本性能基线 | MODIFIED | 删「两个本子…一致」尾句，门槛数字原样 |
| R5 Tiptap 内核与格式范围 | MODIFIED | 格式白名单段→D3 引用式表述 |
| R6 结构化文档往返 | REMOVED | →structured-notebook-storage |
| R7 受控粘贴 | MODIFIED | 「本子」→「文档」（引用 controlled-rich-text-paste 不动） |
| R8 依赖单一入口锁版 | 不动 | 现行 |
| R9 金样本锁定 | 不动 | 现行 |

### 其余（窄改清单）

- basic-rich-text-editing：Purpose:4；R :6-7＋场景 :9-12（删「不改变另一本子」断言）；:19-22 切换跟随；R :114-124＋:118-120。
- editor-context-menu：:7 两处（「草稿本与正文本的编辑区」→「写作区编辑器（当前文档）」；「当前本子」→「当前文档」）。
- selection-ai-invocation：R1 的 :7/:9-23/:98-102（本子类型→来源文档身份；删 draft/main 记录句）；R2 整条 REMOVED；R3 不动。
- selection-ai-summon：:7/:10「草稿本或正本」→「写作区文档」。
- desktop-project-lifecycle：:190 迁移注册条款→「注册 2→3（双本子转根文档）与 3→4（物化 ai_visible）两个迁移步骤；当前作品结构版本为 4」。
- workspace-navigation：ADDED（D4 草文）。
- find-replace：:4 措辞。controlled-rich-text-paste：:95 措辞。

## Risks / Trade-offs

- **[大改误删仍真条款]** → 以逐条处置表为唯一依据；delta 完成后与主规格逐块 diff 核对仅含表内改动。
- **[REMOVED 制造行为真空]** → D6 迁移映射＋关键词 grep 复核（「静默保存」「保存失败」「离开」等在活规格中有家）。
- **[措辞牵动测试断言]** → 断言随改＋`npm run check` 全链复跑。
- **[10 份 delta 体量]** → 窄改 6 份机械执行；大改 2 份按表；`openspec validate` 逐份把关。

## Open Questions

（执行期唯一自由度：production-editor-kernel R6 整删 vs 留单句引用——定案整删，R5 的引用句已覆盖语义。）

## apply 期裁决补记（2026-09-23）

### D9　扩围裁决（用户确认）

apply 期质量门 grep 捞出范围外同类残留，经用户拍板「并入本 change 清完」：

- **5 份范围外规格**：ai-thinking-panel（「绝不直接写入两个本子」标题与场景）、character-formatting（「当前本子」）、llm-configuration（框架措辞；旧 `.txt` 路径守卫按 8d 裁决保留）、project-mission-governance（AGENTS.md 铁律引用失配——已属「要求一个不存在的东西」的被违反状态，必须修）、project-readme（:171 镜像措辞，连带消化 8d 登记遗留 #2）。
- **desktop-project-lifecycle 版本对齐补全**：5 处兄弟条款「版本为整数 3」（:24/:53/:58/:93/:98）与已对齐的「当前版本 4」同文件矛盾——属已确认范围「对齐版本 4 现实」的直接补全。
- **代码侧**：generate.rs :5 注释＋:30 模型可见提示词（断言随改）、structured-notebook.ts 用户可见错误串、notebook.rs 后端校验错误串 4 处（主控直改，与前端串同族同可见性，防前后端措辞分叉）、migration.rs :17 注释与代码不符、project-api.ts／selection-entry.ts 注释。
- 裁决依据：审计关账要求「登记待办全清」；同类缺陷、零行为变化。

### D10　术语界线（本 change 确立）

- **用户／模型可见文本**（UI 提示、错误串、系统提示词、规格活条款）→ 统一「文档」族；
- **开发者可见注释与代码标识**（模块名 notebook、`NOTEBOOK_FORMAT`、`MAX_NOTEBOOK_BYTES`、「本子 JSON」格式契约注释）→ 允许「本子」；
- **合法自述**（迁移历史数据对象名「草稿本.json」、双本子迁移描述、旧 `.txt` 路径守卫）→ 保留。
- **登记观察项**：llm-configuration:252「不添加…文档全文」与阶段五 A 自动附材料的表观张力——泛化使旧词张力显形，两者属不同流程（配置页 vs 讨论材料），不属本 change，留待后续如需再裁。

### D11　执行偏差裁决（接受清单）

- fix-2 五条偏差全接受（删断言留无效块的规避、死对象与引用式矛盾的必要同步、R2 块内场景并入 R1 等）；
- fix-3 标题残留补刀按 8d 裁决 #1 先例（REMOVED＋ADDED 承载）；desktop-project-lifecycle 迁移条款历史数据名不泛化——正确；
- fix-4 两处 delta 补遗接受（crtp :74 断言与 D7 代码改动直接耦合，不同改则断言失效）；
- fix-5 四项待裁决：README 核对后已是现代表述、单侧对齐即两边一致（接受）；notebook.rs 后端串并入（执行）；格式契约注释族按 D10 保留；llm-configuration 张力按 D10 登记。
