# 设计：Tiptap 2→3 安全迁移

## Context

- 编辑器内核现状：package.json 精确锁 19 个 `@tiptap/*` 包于 2.27.2；`src/rich-text-editor.ts` 唯一实例化点（原生 TS，无 React 绑定）；扩展集 = 18 个官方扩展 + 3 个自研（FontSize/ParagraphStyle 走 `addGlobalAttributes`，FindReplace 走 `addProseMirrorPlugins` 注入 raw ProseMirror 插件）；无 NodeView；Decoration 仅 FindReplace 一处。
- 粘贴管线完全自研：`handlePaste` 无条件返回 true，外部 HTML 经 `controlled-paste.ts` 自研 DOM 解析→白名单→`insertContent` 注入自建 JSON，ProseMirror 默认粘贴管线不运行（这是两个漏洞实际可利用性低的根因）。`parseHtmlToBlocks` 支持注入自定义 parser，现有测试用假 DOM。
- 序列化：`editor.getJSON()` 纯 JSON 存盘，格式版本 2 grammar（见 `structured-notebook-storage`）；存盘层 `structured-notebook.ts` 自带"相邻同 marks 文本合并"规范化（:584）与 grammar 校验（:317），能吸收内核产生的相邻同格式拆分。
- 测试现状：751 项前端测试全部不创建真实 Editor 实例（`getSchema` + Fake 引擎）；"金样本"尚不存在。
- 依赖卫生：`@tiptap/pm` 被三处 import 但从未在 package.json 声明（幻影依赖）；`list-numbering.ts` 裸 import `prosemirror-model`/`prosemirror-state`（仅类型）。
- 安全情报（librarian 源码级调研，2026-09-16）：2.27.3 已含两洞代码级修复；v3 线修复自 **3.31.2** 起进入依赖锁（`@tiptap/pm@3.31.2` 起锁 prosemirror-view ^1.42.3；3.30.4/3.31.0/3.31.1 均带洞）。
- v3 关键事实（官方文档 + npm 元数据实测）：列表三包并入 `@tiptap/extension-list`（旧包名仅存再导出桩包）；History 并入 `@tiptap/extensions`（UndoRedo，`undo`/`redo` 命令名不变）；`@tiptap/pm` 成为 ProseMirror 唯一入口（core 以 peer 精确锁 `@tiptap/pm` 同版本）；`@tiptap/pm/*` 子路径与现有 import 兼容；`Extension.create`/`addGlobalAttributes` 机制不变；`handlePaste` EditorProps 签名不变；`extendMarkRange` v3 源码与 v2 逐行等价；**唯一确认行为变化：`insertContent` 不再拆分开头文本节点**；Link autolink 引擎换为 linkifyjs（默认值不变，识别边界可能微差）；v3 支持 `element: null` 无 DOM 实例化（core 内置 happy-dom 分发）；双格式（ESM+CJS）输出，对 vite + node --test 无影响；类型更严。

## Goals / Non-Goals

**Goals:**

1. 两洞从发行物中消除：阶段一（2.27.3）立即消除实际风险，阶段二（3.31.3）让告警体系正式认账。
2. 零用户可见行为变化：粘贴白名单映射、autolink 现状、序列化格式版本 2、撤销重做命令全部保持。
3. 建立金样本回归（A 层序列化 + B 层粘贴行为），作为本次迁移的验证手段，并沉淀为内核相关改动的长期门禁。
4. 现有 751 项前端测试全绿；类型检查与 lint 干净。

**Non-Goals:**

- 不改任何编辑行为与格式能力（autolink 保持开启；若未来要关，另开小 change）。
- 不修 `production-editor-kernel` 中格式版本 1 时代的旧范围表述（存量规格失真，留队列 8）。
- 不引入 E2E / 浏览器自动化框架；真机验证走手工清单。
- 不处理拖放非图片内容不过白名单的既有 v2 行为（仅列入手工清单观察项）。
- 不升级 docx 等其它依赖（队列 8 / P2-14）。

## Decisions

### D1：一个 change、两个阶段，阶段间设"冻结点"

阶段一（2.27.3 垫底）与阶段二（3.31.3 全迁）在同一 change 内串行，各自独立提交与验证。理由：两阶段服务同一目标；阶段一单独归档没有独立价值（红灯仍亮、豁免记录很快作废）；用户一份提案看全貌。

**冻结点纪律（关键）**：金样本的冻结预期必须在**仍在 2.27.3 上**时生成——先用当前（v2）管线跑出语料的规范化输出并冻结为预期文件，再切 v3，用冻结值断言相等。先冻结后升级，金样本才代表"迁移前的真实行为"而不是"迁移后自圆其说"。

### D2：阶段二目标 3.31.3，硬下限 3.31.2

prosemirror-view ^1.42.3 自 `@tiptap/pm@3.31.2` 才进入依赖锁；3.30.4 / 3.31.0 / 3.31.1 全部带洞。定当前最新 3.31.3。保持项目精确锁版惯例（无 `^` 范围），`@tiptap/pm` 与 core 同为 3.31.3（v3 peer 精确锁要求）。

### D3：干净 import，不用过渡桩包

旧列表三包与 History 在 v3 只是以桩包形式再导出。本项目触点集中在一个文件，一次性改干净 import（`@tiptap/extension-list` 的命名导出、`@tiptap/extensions` 的 UndoRedo），不留过渡期混淆。

### D4：ProseMirror 单一入口

`@tiptap/pm` 显式声明为直接依赖；`list-numbering.ts` 的裸 `prosemirror-model`/`prosemirror-state` 类型 import 改为 `@tiptap/pm/model`、`@tiptap/pm/state`。消灭幻影依赖，且 v3 的"全部 prosemirror-* 只经 @tiptap/pm 流入"架构下这是唯一被认可路径，杜绝双实例风险。

### D5：金样本分两层，断言到"规范化存盘形态"

- **A 层·序列化**：合成语料覆盖格式版本 2 grammar 全部结构——每种块（正文/六级标题/两种列表/嵌套列表）、每种 mark（bold/italic/underline/strike/textStyle 三属性/highlight/link）、段落属性全集、边界情形（空文档、空标题、首尾与连续空段落、链接在文本边界、相邻异格式文本、有序列表非 1 起始、中文与 emoji 内容）。断言：文档 JSON → headless Editor（`element: null`）装载 → `getJSON` → `canonicalDoc`，结果与冻结预期**逐字节相等**，且通过 grammar 校验。
- **B 层·粘贴行为**：成对的 (html, text/plain) 粘贴样本（覆盖规格 `controlled-rich-text-paste` 的代表性路径：格式映射、嵌套列表重建、表格降级、br 拆分、拒绝路径），经 `parseHtmlToBlocks`（注入真实 DOM 实现）→ `decidePasteAction` → `insertContent` 注入 headless Editor 的代表性位置（空文档、同格式段落中部、异格式边界、列表项内）→ `getJSON` → `canonicalDoc`，与冻结预期相等。正对 v3 唯一确认行为变化（`insertContent` 拆分行为）。
- **断言层级取舍**：两层都断言到 `canonicalDoc`（即真正落盘的形态），**不冻结编辑器原始 JSON 内部结构**——相邻同 marks 节点边界属内核内部实现自由，冻结它会过度约束、在未来小版本制造误报；用户可见且受 grammar 约束的规范形态才是契约。
- 事件层（`handlePaste`/`handleDrop` 的 event 接线与 alert）不在金样本内，由现有单元测试与手工清单覆盖。

### D6：测试用 DOM 实现选 happy-dom（仅 devDependency）

B 层需要真实 DOMParser 跑 `parseHtmlToBlocks`。node --test 无 DOM；v3 core 内置的 happy-dom 分发不公开导出。方案：测试 devDependencies 增加 `happy-dom`（轻量，且是 Tiptap 官方自身选型），仅测试使用，不进生产依赖。与 WebView2 真实 DOM 的残余差异由手工清单兜底（真机粘贴验证）。

### D7：autolink 显式保持 true；TextStyle 生态避撞

- Link 配置显式写 `autolink: true`（v2 以来默认即开，迁移不改行为）。linkifyjs 新引擎的识别边界若与冻结预期不符，视为真实行为变化，**上报用户决策**（接受差异或关 autolink），不在 change 内静默取舍。
- 只引入 `@tiptap/extension-text-style` 的 TextStyle mark 本体，**不引入** v3 TextStyleKit 及其官方 fontSize/backgroundColor/lineHeight 扩展，避免与自研 FontSize 的 `fontSize` 全局属性撞名。自研 FontSize/ParagraphStyle 的 `addGlobalAttributes` 写法 v3 兼容，不改。

### D8：告警豁免的形态

阶段一在仓库内固定位置（本 change 目录 + 归档后随审计文档补充栏）书面记录：两洞编号、2.27.3 已含代码级修复的证据（源码比对结论）、告警库未收录的说明。GitHub Dependabot 两条警报由用户按记录处置（-dismiss，理由"已修复但告警库未收录"）。CI 不跑 npm audit（已核实），豁免不涉及门禁改动。阶段二完成后警报自然消除，豁免记录转为历史。

## Risks / Trade-offs

- **[R1] `insertContent` 拆分行为变化改变粘贴产物** → B 层金样本直击；存盘层的相邻同 marks 合并规范化（`structured-notebook.ts:584`）作为第二道吸收层；若 B 层出现差异，先判明是"规范形态不变仅内部结构变"（可接受，更新冻结预期需记录理由）还是"规范形态变了"（阻塞，回退决策）。
- **[R2] linkifyjs 识别边界与 v2 不同** → 金样本含 URL 输入用例（headless 下以事务插入文本后断言 mark 范围）；不符则上报用户，默认立场是保 v2 行为。
- **[R3] happy-dom 与 WebView2 真实 DOM 解析差异** → 测试保真度有限；手工清单必含"真机从网页/Word 粘贴"项。
- **[R4] v3 类型更严带来 tsc 新错** → 机械修补，无运行时影响。
- **[R5] 未记载的 v3 破坏性变化** → 全量 751 项测试 + 金样本 + 手工清单三层兜底；阶段一垫底在归档前始终是回退位。
- **[R6] 锁文件连带抬升其它传递依赖** → 任务中显式要求审阅 package-lock 差异，禁止顺手升级无关依赖。
- **[R7] 20 万字长文档性能回退无法自动捕获**（无性能自动化）→ 手工清单含大文档烟测；`production-editor-kernel` 既有性能要求仍作为验收标准，实测不达标即阻塞。

## Migration Plan

1. **阶段一**：改 package.json（19 包 → 2.27.3，补声明 `@tiptap/pm@2.27.3`）→ 安装 → 全量验证（`npm run check`）→ 提交 → 写豁免记录 → 用户处置 Dependabot 警报。
2. **冻结点**：仍在 2.27.3 上，建金样本语料与测试（A 层 + B 层 + happy-dom devDependency），跑通并冻结预期文件 → 提交。此时金样本测试应全绿（对照自身生成）。
3. **阶段二**：包集重组（→ 3.31.3，列表三包并一、History 换 UndoRedo、`@tiptap/pm` 同版）→ import 改写（`rich-text-editor.ts`、`list-numbering.ts` 等）→ 类型修补 → 金样本必须对冻结预期全绿 → 全量验证 → 真机手工清单 → 提交。
4. **回退策略**：任一阶段验证不通过且当回合无法修复，git revert 该阶段提交；阶段一成果（2.27.3 垫底 + 金样本基础设施）可独立存续，阻塞点上报用户再决策，不就地扩权修无关问题。

## Open Questions

- OQ1（实现中核验）：`@tiptap/extension-text-style@3` 的默认导出形态是否与 v2 相同（预期不变，若变则属机械 import 修补，非设计分叉）。
- OQ2（默认已定，留观察）：linkifyjs 边界等价性——若金样本 URL 用例不符，升级为用户决策点。
