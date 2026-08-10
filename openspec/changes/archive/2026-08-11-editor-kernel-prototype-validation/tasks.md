## 1. 前置约定（已与用户确认 2026-08-10）

- [x] 1.1 真机验证环境：由用户在当前这台 Windows 机器上、配合微软拼音输入法执行（中文输入法项无法在无 IME 环境替代）
- [x] 1.2 "真实剧本长度" = 20 万汉字；输入延迟阈值 p95 ≤ 50ms；原型进程增量内存 ≤ 300MB
- [x] 1.3 原型目录 = `prototype/editor-kernel/`，纳入 Git 版本控制；在隔离 git worktree 中实施

## 2. 原型骨架与隔离

- [x] 2.1 创建隔离原型目录 `prototype/editor-kernel/`，含独立 `index.html` 入口，不接入欢迎页/现有编辑器
- [x] 2.2 Tiptap/ProseMirror 与 Lexical 依赖装在原型独立 `package.json`，未加进根 `package.json` 生产依赖
- [x] 2.3 `src/` typecheck 通过、前端 185 项测试全绿、生产构建成功；原型为独立包，不影响 `src/`（生产编辑器不受影响）
- [x] 2.4 原型未被 `src/`/`vite.config.ts`/`tsconfig.json`/根 `package.json` 引用；删除 `prototype/` 后前端仍构建成功（原型可整体丢弃）

## 3. 共享适配层

- [x] 3.1 `src/projection.ts` 纯文本投影（段落/空行/连续空行/换行/列表符号/有序编号）— TDD 9/9 绿（`tests/projection.test.ts`）
- [x] 3.2 `src/frozen-selection.ts` 冻结选区快照（本子类型/可见原文/UTF-16 偏移，Object.freeze 不可变），对齐 `selection-adapter.ts` 契约 — TDD 7/7 绿
- [x] 3.3 `src/tiptap-adapter.ts` 用 ProseMirror schema 序列化为候选无关投影 — TDD 7/7 绿
- [x] 3.4 `src/lexical-adapter.ts` headless 接同一契约，投影块不含 NodeKey（`NodeKey` 未当持久标识）— TDD 7/7 绿
- [x] 3.5 `tests/isomorphism.test.ts` 断言两候选同种子产出 `deepEqual` 投影块与冻结快照 — 4/4 绿

## 4. 验收测试执行（先 Tiptap，后 Lexical，同一套用例）

- [x] 4.1 保存重开逐字节比对（含空行/连续空行/段落边界）两候选各一套 — 红→绿测试通过（`tests/acceptance.test.ts`）；真机复核入口见 `MANUAL-QA.md`
- [x] 4.2 冻结后编辑不污染快照，两候选各一套 — 红→绿测试通过
- [x] 4.3 选区恢复（未改动确定性恢复 / 已改动明确报告，不静默错位）两候选各一套 — 红→绿测试通过（`tests/selection-restore.test.ts` + acceptance）
- [x] 4.4 中文输入法组合输入真机验证 — 用户在 Windows + 微软拼音实敲，**两候选拼音组合/选字/转换/删除/撤销重做/切焦点全部通过，无丢字重复乱序**（Tiptap 撤销按整批、Lexical 逐字，非缺陷，可配置）；见 `MANUAL-QA.md` 4.4
- [x] 4.5 真实剧本长度压力（20 万字）真机实测 — **两候选均达标**：Tiptap p95=13.2ms / Lexical p95=19.7ms（预算 50ms），堆增量约 14.6MB（预算 300MB），无卡顿、无文本损坏、无选区漂移；见 `MANUAL-QA.md` 4.5
- [x] 4.6 AI 不写回边界（召唤+追问后编辑器投影与保存文件均未变）两候选各一套 — 红→绿测试通过

## 5. 依赖与许可审查

- [x] 5.1 原型前端生产构建与 Tauri 分发包真机构建均成功；MSI、NSIS、独立可执行文件已生成，WebView2 桌面窗口成功运行，见 `MANUAL-QA.md` 5.1
- [x] 5.2 依赖许可审查完成：两候选核心均 MIT，全树仅宽松许可无 copyleft，Tiptap Pro/托管/DOCX 边界明确未引入 — 见 `LICENSE-REVIEW.md`

## 6. 结论与决策

- [x] 6.1 `COMPARISON-REPORT.md` 汇总每项验收状态与双证据路径（自动化 + 预检 + 真机待填位）
- [x] 6.2 已按回滚决策规则完成判定：两候选全部关键项通过；后续迁移 change 建议优先 Tiptap/ProseMirror，Lexical 作为备选
- [x] 6.3 `COMPARISON-REPORT.md`「不落地声明」明确：结论仅作后续迁移 change 输入，本 change 不替换现有编辑器
- [x] 6.4 报告与真机手册已完成；结论将保留为独立测试结果文档，原型 worktree 可删除，后续迁移必须另开 change
