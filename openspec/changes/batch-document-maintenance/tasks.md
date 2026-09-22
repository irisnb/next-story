# 任务：文档维护批量（队列 8d）

> 依赖顺序：Purpose 直改 ∥ delta 扩展 → 失效路径标注 → Rust 杂项 → apply 期验收 → 归档同步与终验收。
> 最终 delta **16 份**（13 术语＋editor-margin-preference＋desktop-project-lifecycle＋structured-notebook-storage；5 组 REMOVED/ADDED 标题对）；apply 期主规格 requirement 正文不动，归档时经 delta 同步。
> 全程离线，零 API 费用；除注释与错误文案字符串外零行为变化。实施裁决记录见 `verification/implementation-notes.md`。

## 1. Purpose 批量补齐与术语清扫（design D1）

- [x] 1.1 补齐 39 份 TBD Purpose：每份中文一至两句「能力是什么＋管什么边界」，事实取自产生该规格的归档 change 的 proposal.md（`openspec/changes/archive/` 内），不新造承诺；逐份勾账（清单见 proposal 与侦察报告）
  - 完成（apply 泳道）：39 份逐份原文见其汇报；事实源＝当前 Requirements 优先＋归档 proposal 框架
- [x] 1.2 三份附加修正：`clear-current-ai-conversation` 矛盾 Purpose 按正文重写；`ai-panel-state-structure` 模板句中文化；`ai-feature-orchestration` 去「草稿本/正文本」旧概念
- [x] 1.3 Purpose 行术语清扫：全部 55 份 Purpose 行 grep「临时对话／当前对话／对话」及退役概念词（草稿本／正文本／思维扩展／双本子），概念性使用清理、迁移性／守护性合法引用保留（已知 resident-ai-session:4、clear-current-ai-conversation:4、ai-panel-rendering-boundaries:4）
  - 概念性残留 0；合法引用 6 处在册（清单见 verification/implementation-notes.md）
- [x] 1.4 delta 扩展（design D2 新节）：守护句现代化约 12 处（ai-thinking-panel ×6、ai-panel-rendering-boundaries:64、llm-configuration ×4、selection-ai-summon:53、editor-margin-preference ×2 新增第 14 份 delta）；英文「temporary conversation」×2（ai-panel-state-structure:7、ai-feature-orchestration:6）→ discussion；自查 diff 仅含 D2 映射与守护句泛化
  - 三轮扩展后共 16 份 delta：中文守护 15 处、英文守护 3 处＋场景标题 2 处＋枚举对齐 1 处＋残词 1 处（主控直接改）、英文术语 ×2；另增第 15 份 desktop-project-lifecycle（「作品结构版本」统一 14 行＋标题 REMOVED/ADDED）与第 16 份 structured-notebook-storage（1 处）

## 2. 失效路径标注（design D4，4＋1 处）

- [x] 2.1 `docs/dsh-migration-spike.md:381` → 补「已归档至 `archive/2026-08-17-spike-dsh-headless-generation/`」指向
- [x] 2.2 `docs/superpowers/plans/2026-09-13-snapshot-version-validation.md:54` → 补 `archive/2026-09-13-controlled-story-read-visibility/` 指向（行号未漂移，指向 tasks.md:45）
- [x] 2.3 `方向/全量地基审计-2026-09-14.md:206` 与 `:162`（短式）→ 补 `archive/2026-09-22-app-real-chain-validation/` 指向
- [x] 2.4 `方向/第一版方向共识-2026-07-01.md:57` → 补 `archive/2026-08-21-establish-content-tree-storage/` 指向
- [x] 2.5 标注后全量复核：docs/ 与 方向/ 内 `openspec/changes/` 引用不再有指向非 archive 路径的残留（AGENTS/README 的目录泛指说明除外）

## 3. Rust 杂项（design D5）

- [x] 3.1 `lib.rs:696-701` 三处 WebView2 unsafe 补 `// SAFETY:` 注释（controller 附加完成后非空、同步 COM getter 调用期对象存活、Settings3 仅 WebView2 环境触达），零行为变化
- [x] 3.2 「项目」字样全量统一（30 处/4 文件）：`project/mod.rs`、`operations.rs`、`migration.rs`、`docx_export.rs` 内中文概念指称容器的注释与用户可见字符串→「作品」（含「项目结构无效」「项目元信息无法解析」）；文件名／字段名／代码标识（`project.json`、`project_path`、`ProjectError`、`ProjectLocks`）保留；「项目结构版本」类既定技术术语存疑处列出交主控复核；每处先 grep 字面断言（侦察已确认「项目结构无效」零断言，其余同法，有断言随改并记录）
  - 实际改动 33 处（常规 20＋「项目结构版本」族统一 9＋project_test.rs 断言随改 4，裁决 7/9 见 verification）；保留：代码标识、「项目符号」（Word bullet 假阳性）；裁决「项目结构版本」→「作品结构版本」（mod.rs:56 先例），规格侧连带第 15/16 份 delta
- [x] 3.3 验证：`npm run test:rust` 全绿（342 通过 0 失败）、`cargo check --all-targets` 零新增警告（docx future-incompat 为 8e 范围既有项）

## 4. apply 期验收（design D6，主规格 requirement 正文未同步前的可验部分）

- [x] 4.1 `openspec validate --specs`：55 份全过（Purpose 补齐后仍满足严格校验）
- [x] 4.2 Purpose 层术语清零：55 份 Purpose 行 grep「临时对话／当前对话」0 命中、裸「对话」及退役概念词（草稿本／正文本／思维扩展／双本子）仅存合法引用（迁移性／守护性／历史性）
- [x] 4.3 16 份 delta 复核：与主规格逐块 diff 仍仅含 D2 映射词形＋D3 获准改写＋D2 守护句泛化（防 apply 期主规格漂移造成归档失配）

## 5. 归档同步与终验收（design D3/D6）

- [ ] 5.1 delta 同步主规格：全部 delta（16 份，含守护句现代化与英文残留）落位；同步后 `openspec validate --specs` 55 份全过
- [ ] 5.2 全库术语终验收：`openspec/specs/` grep「临时对话」「当前对话」0 命中；裸「对话」命中全部落在保留清单（新建对话／对话框／恢复对话中／DSH 会话）；守护句处的「草稿本／正文本」已被「用户文档」泛化取代
- [ ] 5.3 审计文档收尾：第八节 8d 行翻牌＋补记（含 D7 结构性失真登记为待办）；本 change 提交与归档（git-master 规范）
