# Next Story 审查 Bug 台账

更新时间：2026-08-23（归档与复核后）

来源：OpenCode 会话 `ses_0663080adffesohY4wrb6vSdwj` 中用户消息 `msg_f99cfc9c90015jM6PzId5juRqh`，标题为 `irisnb/next-story 审查结果与 Issue 草稿`。

审查基线：`main@d03fdd1eec78cfa5080be4a7f1d828105700887a`

GitHub 状态：当时连接对仓库只有读取权限，创建 issue 返回 `403 Resource not accessible by integration`，所以这些 issue 草稿没有真正写入 GitHub。

## 使用方式

这份文档是后续修 bug 的持久台账，目的是避免上下文压缩或会话切换后遗忘原始审查表单。

项目规则仍然优先：一次只开一个 OpenSpec change。不能因为这里列了 14 条，就并行开启多个 change。每次开始修复前，先从这里选一个明确范围，走 `propose -> 用户确认 -> apply -> archive`。

## 当前处理状态总览

| Issue | 原始标题 | 当前状态 | 已有关联 change / 建议 change |
| --- | --- | --- | --- |
| 1 | 作品结构校验跟随符号链接，可读取或写入项目目录外的文件 | 已修并归档 | `harden-project-file-boundaries` |
| 2 | 并发创建同名作品时，失败的一方会删除另一方刚创建的目录 | 已修并归档 | `harden-project-file-boundaries` |
| 3 | 手动保存跨三个文件非事务，失败或崩溃会留下半保存作品 | 已修并归档 | `harden-save-consistency` |
| 4 | 打开作品未限制文本与 metadata 大小，可导致内存耗尽或界面冻结 | 已修并归档 | `harden-project-file-boundaries` |
| 5 | 切换作品后旧 AI 请求仍占用 single-flight 锁，新作品最多 60 秒无法召唤 AI | 已修并归档 | `reset-ai-request-on-project-change` |
| 6 | 思维扩展的初始方向在后续追问中丢失，发送给模型的对话历史被改写 | 已修并归档 | `preserve-thinking-direction-follow-up` |
| 7 | LLM 配置页的未保存修改没有离开保护，返回或关闭窗口会静默丢失 | 已修并归档 | `guard-llm-config-unsaved` |
| 8 | 反向选择文字时 AI 入口锚定到错误端，`selectionEnd` 并不总是焦点端 | 已修并归档 | `fix-selection-entry-geometry-and-performance` |
| 9 | 切换本子、失焦、调整窗口或开合 AI 面板后，选区入口会保留旧状态和旧坐标 | 已修并归档 | `fix-selection-entry-geometry-and-performance` |
| 10 | 选区入口布局没有选区矩形和菜单尺寸，边界处会遮挡文字或让菜单溢出 | 已修并归档 | `fix-selection-entry-geometry-and-performance` |
| 11 | 长文本中每次选区事件会两次镜像整篇文档并强制布局 | 已修并归档 | `fix-selection-entry-geometry-and-performance` |
| 12 | OpenAI-compatible content 数组只返回第一段文本，后续内容被静默截断 | 已修并归档 | `normalize-llm-multipart-response` |
| 13 | 配置页只提示 API Key 会发送，未告知选区、方向和完整临时对话会发送给该服务 | 已修并归档 | `sync-ai-privacy-and-docs` |
| 14 | README 与 AGENTS 把已经实现的“思维扩展”仍描述为未来功能 | 已修并归档 | `sync-ai-privacy-and-docs` |
| 15 | 删除当前文档后编辑器内部内容树未同步，写作空间仍可能保留已删除节点 | 已修并归档 | `sync-editor-tree-after-current-document-deletion` |

> 2026-08-23 状态补充：原始审查中的 14 个 issue 均已有对应的已归档 OpenSpec change。第二批 2.1–2.5 已全部完成：新增并归档 `harden-project-reliability-boundaries`、`extract-shared-document-models`、`unify-storage-and-snapshot-equality`、`unify-ai-panel-dom-contract`，并同步相应主规格。`unify-ai-panel-dom-contract` 的最终前端测试为 431/431，类型检查、lint、build、OpenSpec 全规格严格验证 36/36 通过；该 change 已归档为 `2026-08-22-unify-ai-panel-dom-contract`。
> 2026-08-23 状态补充：原始审查中的 14 个 issue 均已有对应的已归档 OpenSpec change。第二批 2.1–2.5 已全部完成：新增并归档 `harden-project-reliability-boundaries`、`extract-shared-document-models`、`unify-storage-and-snapshot-equality`、`unify-ai-panel-dom-contract`，并同步相应主规格。`unify-ai-panel-dom-contract` 的最终前端测试为 431/431，类型检查、lint、build、OpenSpec 全规格严格验证 36/36 通过；该 change 已归档为 `2026-08-22-unify-ai-panel-dom-contract`。本轮新增的 Issue 15 已完成并归档为 `2026-08-23-sync-editor-tree-after-current-document-deletion`，同步主规格 `editor-tree-synchronization`；相关前端测试 28/28、类型检查和 lint 均通过。

## 建议后续顺序

1. `preserve-thinking-direction-follow-up`
   - 覆盖 issue 6。
   - 状态：已完成并归档。
   - 原因：这是当前 AI 核心闭环里的实际语义 bug。用户第一次选择“思维扩展”的方向后，追问必须延续这个方向，否则 AI 看到的是被改写过的对话历史。

2. `normalize-llm-multipart-response`
   - 覆盖 issue 12。
   - 状态：已完成并归档。
   - 原因：修复点较集中，在 Rust LLM HTTP 响应解析层，容易形成清晰测试。

3. `guard-llm-config-unsaved`
    - 覆盖 issue 7。
    - 状态：已完成并归档。
    - 原因：这是配置页数据丢失问题，范围不应和正文/草稿本保存混在一起。

4. `fix-selection-entry-geometry-and-performance`
    - 覆盖 issue 8、9、10、11。
    - 状态：已完成并归档。
    - 原因：这些都属于选区入口的焦点端、生命周期、几何布局和性能。如果拆得太碎，容易一个修复推翻另一个修复。

5. `sync-ai-privacy-and-docs`
   - 覆盖 issue 13、14。
   - 状态：已完成并归档。
   - 原因：它们都和“真实 AI 数据流必须被用户和贡献者看见”有关。可以拆开，但一起处理更不容易漏。

## 详细表单

### Issue 1: [Security] 作品结构校验跟随符号链接，可读取或写入项目目录外的文件

状态：已修并归档。关联 change：`harden-project-file-boundaries`。

原始问题：作品打开和保存流程把用户选择的目录当作可信边界，但结构校验使用会跟随符号链接的 `Path::is_dir()` / `Path::is_file()`。随后读取和保存直接按这些路径操作。如果 `作品文本/草稿本.txt`、`作品文本/正文本.txt`、`作品文本` 目录或相关系统目录被做成符号链接、junction 或重解析点，应用可能读取或写入作品根目录之外的文件。

风险：不可信来源的作品文件夹可能读取用户本机任意可读 UTF-8 文本。保存时如果父目录逃逸，可能把草稿本或正文本写到项目目录外。打开后到保存前如果链接目标变化，还存在检查与使用之间的竞态风险。

原始建议：用 `symlink_metadata()` 检查根目录以下每一层，拒绝符号链接和 Windows reparse point；对根目录和目标 canonicalize 后验证 containment；保存时避免按字符串路径重复打开造成 TOCTOU；增加文件 symlink、目录 symlink、Windows junction、打开后替换链接和正常项目测试。

当前记录：已作为项目文件边界修复的一部分处理。后续如果再碰项目文件读写，必须继续保持“作品根目录不能被符号链接/重解析点逃逸”的边界。

### Issue 2: [Data Loss] 并发创建同名作品时，失败的一方会删除另一方刚创建的目录

状态：已修并归档。关联 change：`harden-project-file-boundaries`。

原始问题：创建流程先检查目标不存在，再进入实际创建。`operations::create_project()` 遇到任意错误后会无条件 `remove_dir_all(&project_root)`。如果两个应用实例同时创建同名作品，失败的一方可能删除成功一方刚创建的目录。

风险：两个 Next Story 实例或外部程序同时操作同名目录时，可能出现不可恢复的数据删除。关键点不是“创建失败”，而是“本次调用从未拥有该目录，却执行了删除”。

原始建议：记录 `project_root` 是否由本次 `create_dir` 成功创建；只有成功取得所有权后才允许回滚删除；不要依赖先行 `exists()` 作为所有权判断；增加并发创建同名项目和外部进程插入目录的测试。

当前记录：已处理最危险的误删行为。未来如果加入跨进程锁或单实例约束，可以另开 change，但不能作为当前 issue 的未完成部分混淆。

### Issue 3: [Data Integrity] 手动保存跨三个文件非事务，失败或崩溃会留下半保存作品

状态：已修并归档。关联 change：`harden-save-consistency`。

原始问题：一次保存按顺序独立替换 `草稿本.txt`、`正文本.txt`、`project.json`。每个文件只能保证自己的局部写入边界，三者之间没有提交标记、版本号、日志或回滚。任意一步失败或进程崩溃，都可能留下不同代的草稿本、正文本和 metadata。

风险：草稿本可能是新版本，正文本仍是旧版本；两个本子已经更新但 metadata 写失败，前端显示保存失败；用户选择放弃修改离开时，可能误以为磁盘仍保持旧版本，但实际已有部分内容写入。

原始建议：先写入 staging 目录，逐个 `sync_all()`；使用 generation/manifest 或 journal，让完成标记决定哪一代有效；同步最终文件和父目录；通过可注入文件系统错误测试“草稿后、正文后、metadata 前后”的失败点。

当前记录：已单独处理并归档。这个 issue 曾经比 issue 1、2、4 更复杂，所以当时没有塞入同一个文件边界 change。

### Issue 4: [Bug/DoS] 打开作品未限制文本与 metadata 大小，可导致内存耗尽或界面冻结

状态：已修并归档。关联 change：`harden-project-file-boundaries`。

原始问题：打开作品时对 `project.json`、`草稿本.txt`、`正文本.txt` 直接 `read_to_string()`，没有读取前大小上限，也没有有限 reader。内容还会经过 Rust String、Tauri IPC JSON、JavaScript string 和 textarea value 多次复制。

风险：一个超大文本文件就能让应用长时间无响应、被系统终止，或拖慢整个桌面会话。不可信共享作品可用于本地拒绝服务。

原始建议：为 metadata 和两个本子分别定义合理上限；读取前检查 `metadata().len()`；防止 size check 后文件增长；在 Tauri IPC 前再次验证总载荷；返回明确“文件过大”错误；增加边界值、稀疏大文件、读取中增长、超大 metadata 和正常长剧本测试。

当前记录：已处理。后续如果调整容量上限，要同步规格和测试，不能只改常量。

### Issue 5: [Bug] 切换作品后旧 AI 请求仍占用 single-flight 锁，新作品最多 60 秒无法召唤 AI

状态：已修并归档。关联 change：`reset-ai-request-on-project-change`。

原始问题：`AiRequestCoordinator` 用 `inFlight !== null` 阻止第二个请求。作品切换或卸载时，`beginProject()` / `endProject()` 只递增 `projectToken` 和重置面板，没有释放请求锁或取消旧请求。旧结果会因 token 变化被丢弃，但 `coordinator.busy` 仍为 true，新作品无法立即发起 AI 请求。

风险：用户从作品 A 发起慢请求后切到作品 B，B 的选区入口可能隐藏，直到 A 的请求结束或超时。用户会误以为新作品、选区入口或模型配置损坏。

原始建议：给 coordinator 增加 project/session invalidation；使用 AbortController 或 Tauri/Rust 可取消请求；如果只逻辑释放锁，必须用每请求独立句柄，避免旧 Promise 的 finally 清掉新请求；增加“旧请求不返回时新作品立即可请求”和“旧请求晚到不清新锁”测试。

当前记录：已处理。正式规格已补充：失效的旧 AI 请求不得继续占用新项目的单请求锁。

### Issue 6: [Bug] 思维扩展的初始方向在后续追问中丢失，发送给模型的对话历史被改写

状态：已修并归档。关联 change：`preserve-thinking-direction-follow-up`。

原始问题：思维扩展首次请求可以带 `thinking_direction`，后端会把它加入首次 user message，例如“选区原文 + 用户希望探索的角度”。但首次成功后，前端 `TemporaryConversation` 只保存选区、首答和后续轮次，没有保存首次方向或首次 user message。构造追问时只发送 `kind: "follow_up"`、`selected_text` 和已有 messages。后端处理 follow-up 时把首次 user message 重建为纯选区，方向变成 `None`。

风险：第二次请求中的 transcript 变成“模型曾对纯选区给出首答”，而不是模型实际收到的“选区 + 用户方向”。这会让追问偏离用户明确指定的探索范围，也会让 assistant 首答与前置 user message 不匹配。

最小复现：选择文本“他没有回头”；选择思维扩展；输入方向“只讨论母子关系，不讨论爱情”；首次请求抓包确认 user message 含方向；首答成功后追问“为什么？”；第二次请求抓包会看到首次 user message 只剩选区，方向消失。

原始建议：在 `TemporaryConversation` 中保存规范化后的首次 `GenerateAiRequest` 或精确 first-user message；扩展 follow-up 请求契约，携带首次方向或首次 user content，而不是让后端按纯选区重建；增加抓取两次 HTTP body 的端到端测试，断言第二次请求的最初 system/user/assistant 三条与第一次真实 transcript 一致。

当前记录：已处理。正式规格已补充：首次思维扩展方向必须在后续追问链路中保留，不得被重建成纯选区。

### Issue 7: [Bug] LLM 配置页的未保存修改没有离开保护，返回或关闭窗口会静默丢失

状态：已修并归档。关联 change：`guard-llm-config-unsaved`。

原始问题：`LlmConfigUiState` 已维护 dirty，但它只用于防止异步加载覆盖输入。配置页“返回”按钮直接切页，窗口关闭保护只检查编辑器 `hasUnsavedChanges()`，完全不包含配置页 dirty 状态。

风险：用户输入长 API 地址、API Key 或模型名后，如果没有点击保存就返回或关闭应用，输入会静默丢失。从 AI 面板被引导到配置页时尤其容易发生。

原始建议：为配置页建立保存 baseline，并把 dirty 接入返回按钮与窗口关闭协调器；提供“保存并返回 / 不保存 / 取消”三选项；对 Key 只描述字段已修改，不在对话框回显内容；保存成功后更新 baseline/清除 dirty；测试返回欢迎页、返回编辑器、关闭窗口、加载中返回和保存失败后的行为。

当前记录：已处理。正式规格已补充：LLM 配置页存在未保存修改时，返回和原生窗口关闭都必须进入离开确认；保存失败或取消时保留当前输入并继续停留；确认文案不得泄露 API Key，且配置关闭保护不得修改草稿本、正文本或作品元数据。

### Issue 8: [Bug] 反向选择文字时 AI 入口锚定到错误端，`selectionEnd` 并不总是焦点端

状态：已修并归档。关联 change：`fix-selection-entry-geometry-and-performance`。

原始问题：`captureSelection()` 归一化了 `selectionStart` / `selectionEnd`，但没有读取 `HTMLTextAreaElement.selectionDirection`。入口逻辑始终把 `snapshot.end` 当作焦点端定位。对于从右向左拖选，或使用 Shift+Left / Shift+Up 形成的 backward selection，真正焦点是较小的 selectionStart，而不是 selectionEnd。

风险：右向左鼠标选择和键盘反向选择时，入口会出现在相反位置。长选区中，入口可能远离用户最后操作位置。可见性判断也可能基于错误端点，导致入口无故消失。

原始建议：快照或定位状态中保留 `selectionDirection` / `focusOffset`；使用 `selectionDirection === "backward" ? selectionStart : selectionEnd` 作为焦点位置；start/end 仍保留归一化范围；修正规格里“selectionEnd 对应焦点端”的错误假设；增加 backward mouse/keyboard 测试。

当前记录：已处理。正式规格已补充：入口必须按 textarea 的选择方向确定浏览器焦点端，反向选择使用较小偏移，不能再把 `selectionEnd` 永久等同于焦点端。

### Issue 9: [Bug] 切换本子、失焦、调整窗口或开合 AI 面板后，选区入口会保留旧状态和旧坐标

状态：已修并归档。关联 change：`fix-selection-entry-geometry-and-performance`。

原始问题：选区入口只监听 textarea 的 mouseup、keyup、select、focus、click、scroll、input，以及全局 selectionchange。它没有监听 textarea blur、草稿本/正文本标签切换、窗口 resize、textarea/editor 尺寸变化、AI 面板展开或收起、点击编辑器外控件等。`editor.switchTab()` 也只切换 class，没有通知 selection entry reset/update。

风险：入口可能代表已经不是当前本子的旧选区；菜单动作可能在新 textarea 上重新读取选区，造成无动作或与视觉锚点不一致；窗口或面板布局变化后入口会漂浮在错误位置。

原始建议：由 editor 在 tab switch、project unload 和页面切换时显式通知 selection entry；监听 blur/外部 pointerdown，并验证 `document.activeElement` 是否仍是当前 textarea；用 `ResizeObserver` 观察 textarea/editor 几何变化；菜单关闭时重新定位，菜单打开时按规格锁定锚点但在上下文失效时隐藏；增加真实 DOM/浏览器测试。

当前记录：已处理。正式规格已补充：入口只代表当前可提交的活选区；当前本子、textarea、页面、作品或布局上下文失效时必须隐藏入口和菜单。

### Issue 10: [Bug] 选区入口布局没有选区矩形和菜单尺寸，边界处会遮挡文字或让菜单溢出

状态：已修并归档。关联 change：`fix-selection-entry-geometry-and-performance`。

原始问题：`decideTriggerPlacement()` 的输入只有焦点 caret、编辑器边界和触发器尺寸，没有选区矩形，也没有菜单尺寸。当下方空间不足时，代码会先尝试放在选区下一行，再把 top clamp 回编辑器内，可能把按钮推回选中文字所在行。菜单 CSS 永远从 trigger 右侧展开，但 trigger 定位只为自身留空间，没有为菜单宽度留空间。

风险：按钮可能覆盖选中文字；菜单在右边界附近可能越出编辑器甚至窗口；窄窗口、底部、右侧、四角区域都可能出现错位。

原始建议：计算选区最后一行/焦点端实际矩形，而不是只算 caret 点；打开菜单前测量 trigger + menu 组合尺寸，按右/左/下/上选择方向；如果任何方向都放不下，优先放到编辑器内不与选区相交的最近区域；增加底部、右侧、四角、窄窗口、超长菜单文案和 AI panel overlay 几何测试。

当前记录：已处理。正式规格已补充：入口和菜单必须保持在编辑器或窗口可见边界内；默认位置空间不足或会遮挡选区时，系统要选择可见且尽量不遮挡选区的替代位置。

### Issue 11: [Performance] 长文本中每次选区事件会两次镜像整篇文档并强制布局

状态：已修并归档。关联 change：`fix-selection-entry-geometry-and-performance`。

原始问题：`getCaretCoordinates()` 每次调用都会创建 mirror div、复制 textarea 样式、把 `0..position` 全部写入 div、把 `position..全文结尾` 全部写入 span、append 到 document.body 后读取 offset 强制布局，再删除节点。入口一次 update 又会先在可见性判断算一次，再在定位算一次。高频事件没有 requestAnimationFrame 合并或 debounce。

风险：文本越长，入口定位成本越高。几十万到百万字符下，输入和键盘选区可能卡顿，直接伤害写作体验。全局 selectionchange 还会在选择 AI 回复或其他页面文字时触发计算。

原始建议：每个 textarea 复用一个 mirror；只放入定位所需前缀和 marker，不复制整个后缀；一次 update 只计算一次 caret geometry，并复用于可见性和位置；用 `requestAnimationFrame` 合并同一帧事件；缓存 computed styles，只在 resize/font/style 变化时刷新；添加 100KB、1MB、5MB 文本下输入和选区性能基准。

当前记录：已处理。正式规格已补充：同一渲染帧内合并重复入口更新；单次更新复用焦点几何测量；非当前 textarea 的 selectionchange 不触发当前长文本的昂贵几何计算；测量时不得复制整个 textarea 正文作为后缀内容。

### Issue 12: [Bug] OpenAI-compatible content 数组只返回第一段文本，后续内容被静默截断

状态：已修并归档。关联 change：`normalize-llm-multipart-response`。

原始问题：后端接受 assistant `message.content` 为数组。连接测试只要数组中任意 part 有非空 text 就认为响应有效；但实际提取时遇到第一段非空文本就立即返回，不拼接后续 part。

风险：支持 structured/multipart content 的兼容服务会被静默截断。用户看不到模型回复后半部分，也没有任何错误提示。连接测试和生成结果对同一种响应结构使用了不同语义。

最小复现：兼容服务返回 `content: [{"text":"第一段"}, {"text":"第二段"}, {"text":"第三段"}]`。连接测试成功，但生成结果只有“第一段”。

原始建议：按原顺序收集所有合法 text parts 并拼接，明确段间分隔规则；未知 part 类型跳过或返回可诊断错误；让连接测试和生成复用同一个规范化函数；添加多 text part、空 part、混合未知类型、单字符串和超长拼接测试。

当前记录：已处理。正式规格已补充：连接测试和生成必须复用同一套 assistant 文本规范化语义；multipart content 按原顺序拼接所有合法 text part，忽略空文本和未知 part。

### Issue 13: [Privacy] 配置页只提示 API Key 会发送，未告知选区、方向和完整临时对话会发送给该服务

状态：已修并归档。关联 change：`sync-ai-privacy-and-docs`。

原始问题：LLM 配置页用户可见警告只说明 API Key 会作为 Bearer 凭据发送到填写的 API 地址，并以本地明文保存。但真实生成请求还会发送用户选中的剧本文字、思维扩展方向、首次模型回复、当前临时对话中的全部追问和回复。

风险：剧本内容可能是未公开创作、商业项目或受保密协议保护的材料。用户只看到“API Key 会发送”，无法理解自己的选区和临时对话也会离开本机并交给第三方服务。

原始建议：配置页明确写出“选中文字、方向与当前临时对话会发送给该 API 服务”；首次使用新 origin 时展示一次确认，显示规范化 host，不显示 API Key；区分“测试连接只发送固定测试语句”和“AI 生成发送创作内容”；提供隐私说明，明确第三方服务的数据处理由用户与该服务的协议决定；增加 UI 文案快照/可访问性测试。

当前记录：已处理。LLM 配置页已区分测试连接与 AI 生成会发送的数据；AI 生成在首次向某 API 来源发送创作内容前要求确认，并且确认只显示规范化来源，不显示 API Key、Authorization、选区原文、方向、临时对话或请求正文。产品边界不变：AI 输出仍是临时材料，AI 不能写回草稿本或正文本。

### Issue 14: [Docs] README 与 AGENTS 把已经实现的“思维扩展”仍描述为未来功能

状态：已修并归档。关联 change：`sync-ai-privacy-and-docs`。

原始问题：当前代码和正式规格已经实现选区入口中的“思维扩展”动作、方向输入框、带 `thinking_direction` 的首次请求、成功后进入临时对话并开放追问。但 README 当前状态仍写“召唤时没有文字输入”、“AI 链路只使用选区原文”、“思维扩展属于未来方向未实现”。AGENTS 当前实现段落也继续写没有召唤时初始输入、只把选区原文交给固定任务。

风险：新贡献者可能依据项目宪法误删或阻止已经实现的功能。安全/隐私审查会错误判断发送给模型的数据范围。用户也无法从首页文档判断当前版本真实能力。

原始建议：把“及时召唤无文字输入”和“思维扩展可选方向输入”明确分开；将思维扩展从“未来未实现”移入当前里程碑和当前数据流；更新 AGENTS 当前实现段落，同时保留永久零写回边界；增加文档一致性检查，要求 UI 动作/请求字段变化时 README、AGENTS 和正式 specs 同步更新。

当前记录：已处理。README 和 AGENTS 已把选区 `AI 及时召唤`、选区 `思维扩展` 可选方向输入、首次回应后的单条线性临时追问写入当前已实现摘要，同时继续把多个临时对话、历史、持久化、附近上下文、完整作品认知、AI 内容库、思考收束和安全返回写作标为未实现或未来方向。

### Issue 15: [Bug] 删除当前文档后编辑器内部内容树未同步

状态：已修并归档。关联 change：`sync-editor-tree-after-current-document-deletion`。

原始问题：文件管理器删除当前文档后，编辑器 `applyTree()` 在切换到第一篇剩余文档或进入空态的分支中提前返回，没有把已接受的新内容树写回 `currentState.tree`。文件管理器显示的是新树，但写作空间的文档列表、`getTree()` 和后续树判断仍可能使用旧树。

风险：已删除文档可能继续出现在写作空间的内部状态中，导致文件管理视图与写作空间状态不一致；后续依赖内容树的操作也可能基于已经失效的节点。

最小复现：打开包含两篇文档的作品并选中第一篇；从文件管理器删除当前文档并确认丢弃未保存内容；等待编辑器切换到第二篇；此时旧实现的 `editor.getTree()` 仍包含已删除的第一篇文档。删除最后一篇文档时，旧实现仍返回包含已删除节点的树。

当前记录：已处理。编辑器在接受删除后的新树时先同步 `currentState.tree`，再切换剩余文档或进入空态；用户取消丢弃未保存修改时仍保留旧树和当前编辑内容。已增加两条回归断言，覆盖有剩余文档与空树路径。

## 历史分组记录

最早复核后曾建议这样拆分：

1. `harden-project-file-boundaries`
   - 覆盖 issue 1、2、4。
   - 已完成并归档。

2. `make-project-save-recoverable`
   - 覆盖 issue 3。
   - 后续实际以 `harden-save-consistency` 完成并归档。

3. `fix-ai-session-and-transcript-boundaries`
   - 原计划覆盖 issue 5、6、12、13。
   - 后来 issue 5 已被拆出为 `reset-ai-request-on-project-change` 并归档。
   - 剩余 issue 6、12、13 后续已分别由对应 change 处理并归档。

4. `fix-selection-entry-geometry-and-performance`
    - 覆盖 issue 8、9、10、11。
    - 已完成并归档。

5. `guard-llm-config-unsaved-and-sync-docs`
   - 覆盖 issue 7、14。
   - 后续实际拆分为 `guard-llm-config-unsaved` 与 `sync-ai-privacy-and-docs`，均已完成并归档。

## 不要忘的项目红线

- AI 永远不能直接改草稿本和正文本。
- AI 输出永远是临时材料。
- 判断权永远在用户手里。
- 一次只开一个 OpenSpec change。
- 一个概念只能有一个名字。
- UI 里能选的每个模型，后端必须真实可调用。
- 代码写出来之前，用户必须先确认“要做什么”。

## 当前状态与下一个建议动作

当前台账中的 15 个 issue 都已有对应处理记录，并且相关 OpenSpec change 均已归档。路线图第三批 3.1–3.6 已完成，`split-editor-controller-modules` 已实现、验证并归档。下一步不自动扩大范围；如发现新的问题，应先新增台账条目，再按项目规则一次只开一个 OpenSpec change。

### 2026-08-23 归档后复核

- active OpenSpec change：无；`openspec list --json` 返回空列表。
- 已知未修复 bug：无确定性问题。
- 本轮复核检查了未归档 change、代码中的 TODO/FIXME、台账状态、规格与实现的一致性，以及当前前端回归测试。
- 验证结果：`npm run test:frontend` 471/471 通过，`npm run typecheck` 通过，`npm run lint` 通过，`openspec validate --all` 38/38 通过，`git diff --check` 通过。
- 发现并修正一处台账过期描述和一处主规格格式问题；两者均不是产品运行时 bug。

## 下一项修复：统一 AI 面板与主界面的 DOM 查询契约（路线图 2.5）

### 当前发现

- `src/ai-panel.ts` 通过 `document.getElementById` 逐个查找面板内部控件，同时又通过 `dom.aiPanel` 查找 `.ai-panel-body`。
- `src/dom.ts` 已经负责构造 `AppDom`，但 AI 面板内部的必需节点没有进入同一个依赖边界。
- 生产代码因而同时依赖全局 ID 查询和局部根节点查询；测试需要搭建完整全局文档，DOM 结构小改时容易出现“入口对象已更新但内部查询仍指向旧节点”的契约分裂。
- 本项只处理 DOM 查询与依赖注入边界，不改变 AI 面板状态机、请求流程、显示文字、AI 输出临时材料边界或任何作品写回行为。

### 建议的 OpenSpec 范围

创建的唯一 active change：`unify-ai-panel-dom-contract`。

1. 为 AI 面板定义集中、可测试的 DOM 契约，由 `src/dom.ts` 负责组装，`setupAiPanel` 接收明确的面板 DOM 依赖，不再在模块内部散落全局 ID 查询。
2. 保留现有 HTML ID、class 和用户可见行为，先做依赖组织收敛，不顺便重构 UI 或改变布局。
3. 为必需节点缺失、面板根节点局部查询和事件绑定增加契约测试，覆盖初始化失败信息和现有交互行为。
4. 严格保持 AI 不写入作品文档的边界，并运行面板、选择入口、编辑器和完整前端验证。

### 完成证据

- `src/dom.ts` 新增 `AiPanelDom` 类型和集中解析/缺失校验。
- `src/ai-panel.ts` 改为只消费显式契约，不再执行全局 `getElementById` 或内部 `querySelector`。
- `src/ai-feature.ts` 已接入 `dom.aiPanelDom`。
- 新增共享 AI 面板 DOM fixture 与契约测试，保留 AI 输出不写回作品文档的断言。
- `npm run test:frontend`：431/431 通过；类型检查、lint、build 通过。
- 已完成 OpenSpec 严格验证并归档 `unify-ai-panel-dom-contract`。

### 已完成：拆分前端编辑器控制器（路线图 3.1–3.6）

`split-editor-controller-modules` 已完成并归档至 `openspec/changes/archive/2026-08-22-split-editor-controller-modules/`：查找替换、工具栏/格式抽屉、链接弹层、右键菜单和全局快捷键均已拆出为独立模块。

- 保留 `EditorController` 对外接口和 `EditorAdapter` 的窄能力边界。
- 先冻结现有编辑器行为测试，再按职责抽出快捷键、工具栏/格式抽屉、查找替换、链接弹层和右键菜单模块。
- 通过显式服务接口或窄依赖注入连接模块，禁止新模块反向依赖完整 `editor.ts`，禁止循环依赖。
- 生命周期、文档切换、保存和 AI 接线继续由控制器门面负责；不改变保存语义、快捷键行为、作品格式或 AI 零写回边界。
- 不触碰 Rust、DSH、AI 面板功能和已独立的编辑器模块。
- `editor-module-boundaries` delta spec 已同步至主规格 `openspec/specs/editor-module-boundaries/spec.md`。
- 验证结果：`npm run test:frontend` 471/471 通过；`npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 全部通过。
- OpenSpec 全规格严格验证：37/37 通过。

后续如果发现新问题，应先新增台账条目，再按项目规则一次只开一个 OpenSpec change：`propose -> 用户确认 -> apply -> archive`。
