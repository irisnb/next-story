# 实施裁决记录（reconcile-legacy-specs）

日期：2026-09-23。记录 apply 期间各泳道上报、由主控裁决的判断，及最终状态账目。全程零行为变化、零 API 费用。

## 一、泳道与裁决

| # | 事项 | 裁决 | 依据 |
|---|---|---|---|
| 1 | fix-2 偏差①：production-editor-kernel R4 尾句删除会留 WHEN-only 无效块 | 改为同型宾语泛化 | 归档严格校验要求场景有 THEN；断言语义与门槛数字原样 |
| 2 | fix-2 偏差②：R5 场景含死对象（草稿本.json 初始化、「不开放链接」与版本 2 grammar 矛盾） | 最小同步（引用式＋宾语现代化） | D3 消矛盾的必要延伸 |
| 3 | fix-2 偏差③：selection-ai-invocation :98-102 场景物理在 R2 块内 | 现代化后并入 R1 的 MODIFIED | R2 整删会连带消失 |
| 4 | fix-2 偏差④⑤：标题与场景级「本子」残留 | 打回补刀（fix-3） | 对账 change 留残等于改一半 |
| 5 | 标题改动方式 | REMOVED＋ADDED 承载（不用 RENAMED） | 8d 裁决 #1 先例；交叉引用已核实为零 |
| 6 | fix-3 边界：desktop-project-lifecycle 迁移条款历史数据名（草稿本.json 等）不泛化 | 接受 | 泛化会篡改迁移断言本身 |
| 7 | fix-4 补遗：basic-rich-text-editing／controlled-rich-text-paste 各 +2 MODIFIED | 接受（delta 文件头登记） | crtp :74 断言与 D7 代码改动直接耦合；质量门要求活条款零残留 |
| 8 | apply 期捞出的范围外残留（5 份规格＋代码串） | **用户拍板并入清完**（2026-09-23） | 审计关账要求登记待办全清；mission-governance :68 已属被违反状态 |
| 9 | desktop-project-lifecycle 5 处「版本为整数 3」兄弟条款 | 范围内补全（无需另行确认） | 与已对齐「当前版本 4」同文件矛盾，属既定「对齐版本 4」范围 |
| 10 | fix-5 待决：README 不改 | 接受 | 核对 README :66 已是现代表述，规格侧单侧对齐即两边一致；连带消化 8d 登记遗留 #2（project-readme:171） |
| 11 | fix-5 待决：notebook.rs 后端错误串 4 处 | 并入（主控直改＋Rust 全量复跑） | 与已改前端串同族同可见性，防前后端措辞分叉 |
| 12 | fix-5 待决：格式契约注释族（「本子 JSON」类） | 保留，确立术语界线（design D10） | 开发者可见注释与代码标识允许「本子」；模块名即 notebook |
| 13 | fix-5 待决：llm-configuration:252 语义张力 | 登记观察，不动作 | 不同流程（配置页 vs 讨论材料）；泛化使旧词张力显形，留待后续如需再裁 |

## 二、最终状态账目

- **主规格同步 15 份**（原 10＋扩围 5）：writing-notebooks 删 6 换 5（266→167 行，Purpose 重写）；production-editor-kernel 删 2 换 5（R5 格式范围改引用式单一真相源）；basic-rich-text-editing 2 对 REMOVED+ADDED＋补遗 2；editor-context-menu 换 1；selection-ai-invocation 换 1 删 1；selection-ai-summon 换 1；find-replace／controlled-rich-text-paste 各 1 对；workspace-navigation 加 1（切换静默保存）；desktop-project-lifecycle 换 1＋版本补全 6 处；ai-thinking-panel 标题与场景泛化；character-formatting 换 2 处；llm-configuration 框架措辞泛化（路径守卫保留）；project-mission-governance AGENTS 引用更新；project-readme 镜像对齐。
- **代码清扫 10 文件**：rich-text-editor.ts（3 处）、generate.rs（提示词 2 处＋注释＋断言 3 处）、structured-notebook.ts（错误串 5 处＋注释）、notebook.rs（错误串 4 处，主控直改）、ai_orchestration.rs＋story_material.rs（同串夹具）、migration.rs（注释对齐代码）、project-api.ts、selection-entry.ts、ai-session-transport.ts、editor-margin.ts、find-replace.ts（注释）。
- **验证**：`openspec validate --all --strict` 57/57；`npm run check` EXIT=0（前端 972／可靠性 120／驱动 13／构建／Rust 280＋80）；`cargo check --all-targets` 零警告；notebook.rs 直改后 Rust 全量复跑确认。
- **活规格旧词 grep 终态（23 处，全合法自述）**：content-tree-storage（双本子迁移描述）、desktop-project-lifecycle（迁移历史数据对象名与双本子迁移场景、:16 对账自述）、llm-configuration（旧 .txt 路径守卫，8d 裁决保留）、project-readme :64（README 迁移说明镜像）、structured-notebook-storage（.txt 不读取条款）。
- **代码侧保留（D10 界线）**：migration.rs／operations.rs 迁移实现与测试夹具（历史数据对象名）；notebook.rs／structured-notebook.ts／story_search.rs／mod.rs 格式契约注释与代码标识（模块名 notebook 族）。

## 三、遗留（登记，不阻塞）

1. llm-configuration:252「不添加…文档全文」与 automatic-story-context 阶段五 A 的表观张力——观察项（design D10）。
2. 测试内部断言消息措辞（如 llm_config_test.rs:987「本子内容不能为空」为 assert 消息非生产串锁定）——开发者可见，按 D10 界线保留。
