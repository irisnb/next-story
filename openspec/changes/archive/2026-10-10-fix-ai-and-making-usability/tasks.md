# Tasks: fix-ai-and-making-usability

> 实现按 lane 组织：`fixer-rust`（选区安全逻辑与测试）、`designer-ui`（布局与交互）、共享文件（`making-module.ts`、`making-view-model.ts`、`making-session-controller.ts`、`styles.css`、`ui-v5.css`）必须串行。真实用户数据不得为测试改动；测试使用隔离 fixture。`npm run check` 为总门禁，mock 全绿不能替代真机视觉验收。

## 1. 选区及时召唤误拒绝修复（fixer-rust lane）

- [x] 1.1 实现前可行性验证：用「部分列表项 / 嵌套列表」等夹具证明「由受控结构化材料按前端同源语义派生目标选区并验证」在前后端语义一致下可行（含跨首尾块裁切），并据此确定是否需要最小扩展请求以携带结构化选区范围；不预先承诺不改契约，验证记录留档
- [x] 1.2 以 `structured-notebook.ts` 的 `serializeSelectionToPlainText` 为唯一真相源，在 `src-tauri/src/ai_orchestration.rs` 选区授权路径实现该派生与验证（替换 `authorize_selection_sync` 的 `material.content.contains(selection)` 与 `authorized_selection_from_material` 的 `find`），返回值取自派生结果；若需扩展契约则携带结构化选区范围（块+块内偏移），MUST NOT 用 canonical JSON 字符串偏移定位；确认 `project/story_search.rs` 的 `extract_plain_text` 未被直接复用（无分隔拼接不得用于选区判定）
- [x] 1.3 保留全部既有校验与防伪：作品/文档/版本/范围/快照身份、`read_material` 可见性与版本校验、快照版本必须由内容派生、有选区无材料失败关闭、绝不回传原始 `selected_text`；MUST NOT 以删除列表符号/放宽匹配绕过授权
- [x] 1.4 增加正例与安全负例测试——正例（应通过）：跨段落、跨行内 marks、含引号、含反斜杠、含列表前缀/缩进、部分列表项、跨首尾块裁切；安全负例（应拒绝）：缺身份、版本不符、隐藏文档、伪造快照、选区不在材料内、越权或越界的范围
- [x] 1.5 用既有共享结构化文档测试夹具增加前后端派生一致性断言，防止跨语言漂移；不新增诊断产品，后台失败分支内部诊断不记录正文或密钥
- [x] 1.6 在 `tests/selection-serialization.test.ts` / 相关前端测试补纯计算用例，覆盖设计 D4 列出的全部选区形态

## 2. 选区召唤真实链路验收（fixer-rust + 真机）

- [x] 2.1 真实桌面 CDP 端到端：在写作区选中跨段落/行内标记/含引号/反斜杠的文字，点击选区旁「AI」，确认召唤到达真实链路并返回回应（不只断言单测）
- [x] 2.2 记录验收证据（命令、样本、结果），如实区分「已通过」与「未捕获」，不把未验证根因写成已证实；共享报错覆盖 ≥10 分支，记录残余未知原因

## 3. AI 面板头与讨论列表缺陷（designer-ui lane）

- [x] 3.1 列表顶边定位改为与当前 AI 面板头几何对齐（`src/ui-v5.css` `.ai-conversation-list` 顶边，替换写死 `52px`），边栏与最大化一致、不压边（spec: conversation-list「列表覆盖停靠区且编辑区保持可见」）
- [x] 3.2 讨论删除确认一致化：行内确认显示时行尾悬停操作让位不重叠；面板「更多」菜单删除改为走同一确认（`src/ai-dock.ts`）
- [x] 3.3 删除撤销提示在列表打开时呈现在列表之上、可见且「撤销」可点（`#ai-dock-notice` 层级/归属）
- [x] 3.4 讨论窗口头部行动作组稳定：`materials-toggle`/stop/更多/×收进不拆散动作组，窄窗/长标题/最大化切换下不换行错排，标题截断让位（`index.html`、`src/styles.css`、`src/ui-v5.css`）
- [x] 3.5 补针对 `.ai-window-head` 及其动作组的几何断言（不复用只测 `.ai-dock-header` 的旧断言）；更新受影响的既有测试

## 4. 补读等待授权卡可见性与状态（designer-ui lane）

- [x] 4.1 当讨论存在待决授权请求时，在**呈现层**衍生「等待授权」状态（状态点/徽标/文案）；`src/ai-panel-view-model.ts` 的呈现不再显示「正在思考…」。MUST NOT 改变底层业务 `loading`、轮次挂起/取消语义、并发名额占用与「等待授权 180 秒豁免」
- [x] 4.2 授权卡固定在面板内可见（置于滚动区之外或粘性区），长对话贴底/上翻都可见可操作（`index.html`、`src/ai-window.ts`、`src/styles.css`）
- [x] 4.3 讨论隔离：授权卡只显示于所属讨论，切换/后台讨论不串卡（沿用既有按讨论身份路由）
- [x] 4.4 测试：长对话授权贴底/上翻/切换讨论时卡可见、状态与输入状态准确；补 `tests/agent-on-demand-reading.test.ts`、`ai-panel-view-model.test.ts`、`ai-panel-scroll.test.ts` 相关用例
  - 2026-10-10 补充：真实授权链路通过后发现长 reason 裁掉决策按钮，旧截图不足以证明可操作。已修为仅理由/边界说明滚动；300px、670/540px 高真实 WebView 呈现 fixture 的命中与用户式点击回归通过，见 `verification/ui-acceptance/reading-card-layout.md`；最终视觉复核与门禁由主助手完成。

## 5. 制作卡直接删除（fixer-rust + designer-ui，共享文件串行）

- [x] 5.1 `making-view-model.ts`：卡片详情底部「删除」由「请制作助手删除」跳转改为直接删除动作；「修改」「添加」仍转制作对话（`MAKING_DETAIL_ACTION_LABELS` 与 `cardActions`）
- [x] 5.2 `making-module.ts`：删除确认后基于当前查看版本移除目标卡，经既有 `chainSaveVersion` 追加新版本；不调用 `chainSetActive`/`chainRollback`；成功后查看对象跟进新版本
- [x] 5.3 最后一张卡（任一类型）删除入口禁用并给出明确说明；后端 `validate_cards`「至少一张」约束照常兜底
- [x] 5.4 并发/身份一致：以打开确认时锁定的 `chainId+versionId+cardId` 为**不可变基线**，确认基于该基线版本生成新版本；基线失效（链路/版本被删，或该版本内卡与基线不符）则**取消删除并提示重新确认**，MUST NOT 默默切换到最新版本或改删别的卡；仅「同链路其他版本被追加」不让基线失效；确认文案写明产生新版本、历史不变、不自动启用、下一轮不变
- [x] 5.5 测试：取消、失败、最后一张卡、active 与历史保护（旧版本卡仍可见）覆盖；更新 `making-module` 相关测试
  - 2026-10-10 补真机（隔离实例，无模型请求）：真实 UI 点「删除卡片」→取消，版本/active 不变、目标卡保留；确认挂起期间以**明确标注的隔离 fixture 注入**使锁定基线 changed/missing→产品经真实 `chain_library_load` 取消并要求重新确认、不误删；以**明确标注的受控只读 I/O 故障注入**令真实 Rust 原子写真失败，状态条如实报「删除卡片失败：链路库写入失败: 拒绝访问。(os error 5)」、不误删。见 `verification/ui-acceptance/card-delete-cancel-failure.md`、`evidence-making/evidence-card-delete-cancel-failure.json`（26/26）。

## 6. 完整卡原文不摘要与保存后查看跟进（designer-ui lane）

- [x] 6.1 追踪草稿（`parseCardDrafts`/草稿面板）→ 存储（`save_version_in_dir`）→ 查看版本（`buildCardPanelView`）→ 全页 DOM：确证各段原文完整；`howTo`/`whenToUse` 全文原样、正文与触发描述全文不省略（含真实长内容首/中/尾对照，不只凭 `body` 透传判定报告不成立）
  - 2026-10-10 真实保存全文往返（真机 CDP，无模型请求）：复用既有 399 字真实草稿，真实 UI 点保存→确认对话框展开全文逐字核对→用户式确认保存→隔离存储/查看版本/全页 DOM 逐字对照，48/48 断言通过，见 `verification/ui-acceptance/making-draft-roundtrip.md`
- [x] 6.2 保存确认默认摘要并明示「已截断」，提供可展开的完整原文供核对（不强制等保存后才能看全文）；快捷小窗明确为摘要并直达完整详情（「打开完整详情」入口），不使小窗摘要替代原文
- [x] 6.3 保存成功后 `viewVersionId` 跟进新版本：会话控制器回传新版本 id，`making-module.ts` refresh 后 `viewChain(chainId, newVersionId)`，不再显示旧内容
- [x] 6.4 测试：完整卡原文首/中/尾与保存前草稿对照；保存后查看对象指向新版本；范围仅卡片原文，不涉及整套系统提示词

## 7. 启用/回退/停用集中固定操作区（designer-ui lane）

- [x] 7.1 将启用/回退/停用收拢到同一固定「版本操作区」（导图检视头稳定位置）；停用从顶部状态条移入该区，状态条改为纯全局只读展示
- [x] 7.2 操作区同时标注「正在查看：名称·第N版」与「正在使用：名称·第M版」（未启用明示）；启用/回退仅在查看版本非启用版本时可用，停用仅在存在启用链路时可用
- [x] 7.3 不经确认不改指针；确认后调用既有命令；保持全局一条、下一轮生效、在途不变、保存不等于启用
  - 2026-10-10 真实在途证明：取消确认不改指针（`active` 仍 null）；经确认启用 v1 后发起真实讨论首轮，**在途**（对话流「正在思考…」）时经真实 UI 启用 v2，首轮完成仍按发起时冻结值落档 `chain_rounds[0].version_index=1`（在途不变），`active` 已切 v2（全局一条）；停用经确认恢复 `active=null`。见 `verification/ui-acceptance/chain-round-binding.md`、`evidence-binding/`。
- [x] 7.4 测试：启停同区、次轮生效、在途轮不变；更新 `making-module-page` 相关测试
  - 2026-10-10：启停按钮同处「版本操作区」（`#making-inspector-content .making-version-operations`）；同讨论追问（下一轮）按新指针落档 `chain_rounds[1].version_index=2`，首轮记录保持 1；实时「本轮链路」行同步显示第1版/第2版。见同上记录与证据。产品断言更新由门禁测试覆盖（`tests/making-module.test.ts` 等，随 change 门禁）。

## 8. 总门禁与真机验收（验收 owner：用户／主助手）

- [x] 8.1 `npm run check` 全绿（typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust）。最终证据为**一次连续** `npm run check` 退出码 0（2026-10-10 终验：先停止本 change launch-dev 启的隔离验收实例树，再跑完整门禁）：test:frontend 1385/1385/0、test:reliability 121/121/0、test:driver 33/33/0、test:validation 78/78/0、build 135 modules、fmt/clippy 通过、test:rust 663 passed / 0 failed / 4 ignored；另 `npx openspec validate fix-ai-and-making-usability --strict` 退出码 0。详见 `verification/final-check.md`。
- [x] 8.2 真实 Windows 桌面验收：边栏最窄/默认/最大化长标题下三按钮位置稳定；讨论删除 hover＋键盘确认、撤销可见；长对话授权贴底/上翻/切换且状态与输入准确（底层挂起/取消/并发不变）；选区纯计算＋Rust 正例与安全负例＋真实桌面召唤到达真实链路；卡删除取消/失败/最后卡/active 与历史保护、基线失效取消重确认；完整卡原文首中尾与保存/查看版本对照；启停同区与次轮/在途
  - 2026-10-10 用户验收：用户确认「真机验收通过，归档，git push」（用户原话）。8.2 以**用户整体真机验收＋现有分层证据**关闭；验收记录见 `verification/user-acceptance.md`，证据矩阵见 `verification/completion-evidence.md` §1。真机已证子项：头部动作组（batch1/batch2）、删除确认与撤销（batch1/undo-notice-300）、授权允许路径与贴底/上翻/切换（reading-auth/layout）、完整卡原文保存往返（making-draft-roundtrip 48/48）、启停同区与在途/次轮（chain-round-binding 20/20）、卡删除取消/失败/基线失效取消重确认（card-delete-cancel-failure 26/26）。**残余未单独捕获项如实保留（不虚构实测）**：① 授权「底层挂起/取消/并发不变」与「拒绝/跨重启」路径仅单测或未测；② materials/stop 真实显示态逐矩形几何仅呈现 fixture（真实 pending 仅证「停止」可见同排）。此两项作为如实残留记录，不改变 8.2 由用户整体验收关闭的结论。
- [x] 8.3 留存证据：命令、截图/视觉比对、样本与结果，区分自动断言与人工视觉；mock 全绿不作为归档依据
  - 2026-10-10：命令/样本/截图留存齐（见 `completion-evidence.md` §3）；AI/observer 只读视觉比对已完成（`verification/visual-review.md`）；用户整体真机验收通过（见 `verification/user-acceptance.md`）。8.3 指证据留存与视觉比对完成。
- [x] 8.4 仅当本 change 改变了对用户可见行为或规格的既有描述时做必要的最小同步（如制作页停用入口位置、卡删除方式、等待授权呈现）；不做与本 change 无关的泛化改写
  - 2026-10-10：由官方 `openspec archive fix-ai-and-making-usability --yes` 将 8 个 delta 同步入主 spec（conversation-list、frontend-ui-v5、agent-on-demand-reading、controlled-story-read-visibility、selection-ai-summon、making-module-page、chain-library、making-conversation）；归档位置与校验结果见 `verification/user-acceptance.md` 与 `completion-evidence.md` §4。
