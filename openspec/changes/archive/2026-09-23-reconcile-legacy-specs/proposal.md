# 旧世界规格对账

> 审计收尾路线 Change C（最后一项，完成后审计 100% 关账）。逐条调查报告见 `verification/reconciliation-report.md`（2026-09-23）。

## Why

规格是「已经做成什么」的真相源。8d 终检发现 5 份旧规格整份或主体仍描述**已被内容树（2026-08）取代的双本子世界模型**（随笔本＋剧本本）；2026-09-23 逐条调查坐实失真精确范围（哪几条死、哪几条措辞失真、哪几条仍真），并**新发现一处同类失真**：desktop-project-lifecycle 的迁移注册条款停留在「版本 3 即当前版」，代码现实已是版本 4（注册 2→3 双本子迁移与 3→4 物化 ai_visible）。

产品开发触碰编辑器／本子区域（事项 5 稳定写作宽度、事项 10 编辑器体验专项）以规格为前置依据——失真不修，后续立项踩的是假地图。本 change 零行为变化、纯文本对账。

## What Changes

- **六份旧世界规格对账**：
  - `writing-notebooks`（大改）：删除对象已死条款（双标签页 UI、本子代码标识、切换保留未保存输入），删并由既有规格承接的条款（编辑、手动保存、重开加载），**保命条目改写保留**（离开／关闭保护、保存失败不丢输入、保存状态沟通——唯一真相源，行为断言逐字保留、宾语「任一本子」→「当前文档」）；
  - `production-editor-kernel`（大改）：删除本子隔离条款；格式范围条款**改为引用** `structured-notebook-storage` 版本 2 grammar（消除规格内部「版本 1 vs 版本 2」自相矛盾）；单实例化措辞；依赖锁版与金样本条款不动；
  - `basic-rich-text-editing`（窄改）：4 处「当前本子／另一本子／草稿本／正文本」框架措辞泛化为「当前文档」；
  - `editor-context-menu`（窄改）：2 处本子措辞泛化（菜单行为与代码逐项一致，不动）；
  - `selection-ai-invocation`（窄改＋一条整删）：本子标识条款整条删除（对象消失，守护边界已有现代化表述在别处）；冻结字段描述从「本子类型」改为「来源文档身份」；**规格名保留**（方向文档引用＋summon 概念依赖）；
  - `selection-ai-summon`（窄改）：2 处「草稿本或正本」泛化。
- **一处计划外失真修正**：`desktop-project-lifecycle` 迁移注册条款对齐「2→3＋3→4、当前版本 4」现实。
- **一条现行无家行为规格化**：「切换文档先静默保存、失败阻止切换」现仅存在于代码（`editor.ts:299-306`），全规格零承接——新立归属 `workspace-navigation`。
- **顺带清扫（8d「项目→作品」先例）**：相邻规格 2 处本子措辞（`find-replace`、`controlled-rich-text-paste`）＋代码层旧词（优先用户／模型可见字符串：编辑器提示语「无法将图片加入本子」、系统提示词守护句「不直接改草稿本或正文本」；注释类一并）。
- **审计勘误**：收尾路线 C 行第 5 份规格笔误更正（`selection-ai-summon` → `selection-ai-invocation`），随归档结账更新。
- **apply 期扩围（2026-09-23 用户确认）**：范围外 5 份规格同类旧词（`ai-thinking-panel`、`character-formatting`、`llm-configuration`、`project-mission-governance`、`project-readme`——后者连带消化 8d 登记遗留 #2）＋ desktop-project-lifecycle 版本条款 5 处兄弟条款补全＋代码侧残留（generate.rs 提示词另一句与文件头注释、structured-notebook.ts／notebook.rs 用户可见错误串、migration.rs 注释与代码不符、project-api.ts／selection-entry.ts 注释）一并清完；其中 mission-governance 的 AGENTS.md 引用失配已属被违反状态，必须修。

## Capabilities

### New Capabilities

（无——全部为既有能力的规格文本对账。）

### Modified Capabilities

- `writing-notebooks`：删除双本子专属与已承接条款，保留并改写保护类条款到「当前文档」框架
- `production-editor-kernel`：删除本子隔离条款，格式范围改为引用单一真相源，单实例化措辞
- `basic-rich-text-editing`：4 处框架措辞泛化
- `editor-context-menu`：2 处措辞泛化
- `selection-ai-invocation`：本子标识条款整删，冻结字段描述改为文档身份
- `selection-ai-summon`：2 处措辞泛化
- `desktop-project-lifecycle`：迁移注册条款对齐版本 4 现实
- `workspace-navigation`：新增「切换文档先静默保存且失败阻止切换」要求（现行代码行为规格化）
- `find-replace`：「当前本子」措辞泛化（顺带）
- `controlled-rich-text-paste`：「本子内复制」措辞泛化（顺带）
- `ai-thinking-panel`：「绝不直接写入两个本子」标题与场景泛化（apply 期扩围）
- `character-formatting`：「当前本子」措辞泛化（apply 期扩围）
- `llm-configuration`：「当前本子／本子全文」框架措辞泛化，旧 `.txt` 路径守卫按 8d 裁决保留（apply 期扩围）
- `project-mission-governance`：AGENTS.md 铁律引用更新为现行表述（apply 期扩围，修复被违反状态）
- `project-readme`：永久边界镜像措辞对齐 README 现行句（apply 期扩围）

## Impact

- `openspec/specs/`：10 份 delta，归档时同步主规格并全量严格校验。
- `src/`、`src-tauri/src/`：若干字符串与注释清扫；若有测试断言这些字符串，断言随改、全门禁复跑。
- 零行为变化、零数据迁移、零 API 费用。
- 不动：历史文档（`方向/` 快照、`openspec/changes/archive/` 按「不改历史原文」保留）、README（不引用这 5 份规格名）、AGENTS.md（仅引用 summon 规格名，不受影响）。
- 交叉引用已核实：5 份规格名在其余活规格中零引用，任何删除／大改不断链。
