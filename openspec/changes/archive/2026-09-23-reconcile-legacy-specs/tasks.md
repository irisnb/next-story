# 任务：旧世界规格对账

> 零行为变化、零 API 费用。提案期已完成调查与 delta 撰写（组 0）；apply 期做主规格同步、代码字符串清扫、验证与归档。

## 0. 提案期已完成（留档）

- [x] 0.1 逐条对账调查（`verification/reconciliation-report.md`）：5＋1 份失真逐条判定＋交叉引用核实＋附带发现（desktop-project-lifecycle 版本条款、切换静默保存无家）
- [x] 0.2 10 份规格增量撰写（两轮：初稿＋标题/场景残留补刀）；`openspec validate --strict` 通过；活条款旧词 grep 零残留

## 1. 主规格同步（apply 核心）

- [x] 1.1 按 delta 逐份同步 10 份主规格：REMOVED 条目删除（含 Reason/Migration 留档于归档 delta）、MODIFIED 块替换、ADDED 新增（workspace-navigation 切换静默保存）、4 处 REMOVED+ADDED 标题重构对落位——**apply 期扩围后实为 15 份**（新增 ai-thinking-panel、character-formatting、llm-configuration、project-mission-governance、project-readme 的 delta 与主规格同步；desktop-project-lifecycle 追加版本对齐补全 2 块）
- [x] 1.2 Purpose 同步：writing-notebooks 重写（266→167 行）、production-editor-kernel 清理描述性引用、basic-rich-text-editing／find-replace／controlled-rich-text-paste 按归档备忘修正；editor-context-menu／selection-ai-invocation／selection-ai-summon 核对无失真未改
- [x] 1.3 同步后逐块 diff 复核：主规格改动 ⊆ delta 授权范围（fix-4/fix-5 脚本 diff＋主控抽查 writing-notebooks／workspace-navigation／desktop-project-lifecycle）

## 2. 代码字符串清扫（design D7＋扩围）

- [x] 2.1 用户/模型可见字符串：rich-text-editor.ts×3 处、generate.rs :29/:30 提示词两处（断言 :821/:862/:896 随改）、structured-notebook.ts :506-512/:751 错误串、notebook.rs 后端校验错误串 4 处（主控直改，Rust 全量复跑 280＋80 过）
- [x] 2.2 注释类：structured-notebook.ts :1/:3、find-replace.ts :1、ai-session-transport.ts :28、editor-margin.ts :2、generate.rs :5、migration.rs :17-19（与代码两步骤对齐）、project-api.ts :20/:30、selection-entry.ts :235
- [x] 2.3 测试断言核实：全库 grep 无外部测试锁定上述生产串（generate.rs 内联断言已随改；ai_orchestration.rs :909 与 story_material.rs :811 同串夹具联动）

## 3. 验证

- [x] 3.1 `openspec validate --all --strict`：57/57 通过（56 份活规格＋本 change）
- [x] 3.2 活规格旧词 grep 复核：23 处命中全部为合法自述（迁移历史数据对象名、双本子迁移描述、旧 .txt 路径守卫），分类清单在 `verification/implementation-notes.md`；行为真空复核：静默保存（workspace-navigation 新条）、离开/关闭保护（writing-notebooks 保留条）在活规格有家
- [x] 3.3 `npm run check` 全链 EXIT=0（前端 972／可靠性 120／驱动 13／构建／Rust 全过）＋`cargo check --all-targets` 零警告（notebook.rs 直改后复跑确认）

## 4. 归档与审计关账

- [x] 4.1 审计文档：收尾路线 C 行结账＋勘误（第 5 份规格名 selection-ai-summon→selection-ai-invocation）＋补充二十三＋审计 100% 关账声明（修复队列 20 项、改进候选、登记待办全清，此后立项全部为产品开发）
- [x] 4.2 openspec archive（`2026-09-23-reconcile-legacy-specs`），归档后全量校验复跑
- [x] 4.3 git 提交与推送（git-master 规范：对账同步笔＋归档关账笔）
