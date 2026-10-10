# update-frontend-ui-v5 实施记录

## 2026-10-09 用户批准开始实现

用户原话记录：

> 2026-10-09 用户开始实现！批准完整方案包括 doc 保 draft clear unsent selection。

即：用户批准唯一完整规范 `方向/前端UI全量更新-设计与实施方案-2026-10-09.md` 与 change `update-frontend-ui-v5` 的整体实施范围，并随整体范围批准了本提案需确认的行为收口——

- 切换编辑器文档时**保留按讨论草稿**；
- 切换文档时**清除未发送的实时选区与待附带重点提示**。

该项替换 `persistent-ai-panel-entry` 旧的「切文档清输入」合同，自批准起作为本 change 的待实现行为；关注文档绑定、在途请求、已发送冻结材料与召唤快照继续保留。

## 状态

- 本 change **实施进行中，尚未归档**；归档前行为真相仍以已归档的 `openspec/specs/` 为准。
- 完整方案三项均不重新选型：整套 v5 视觉、黑色实心底＋个人 PNG 发送彩蛋、独立应用图标 v3 04「开口」。
- 取消应用内浮动讨论窗口/多窗口并排，改为单 AI 面板多讨论（当前讨论投影）；显式停止独立于隐藏/切换。
- 命名：用户可见界面「作品」改「项目」（含「文档管理」「制作」导航），代码 `project`、存储格式与既有档案不改名。

## 资源与文档 lane 实施记录（本次）

- 接入本地 Basecoat 1.0.2（MIT）到 `public/vendor/basecoat-css/`（正式离线路径，无 CDN/运行时外网）；文件与暂存真源逐字节一致（SHA256 核对）。
- 更新 `scripts/check-package-resources.mjs`：新增 Basecoat 组件资源与 MIT 许可检查，并核对锁定版本 1.0.2 与 MIT。
- 生成 Windows 应用图标：由 `04-aperture.svg`（32/48/64/128/256）与 `04-aperture-small.svg`（16/24）生成 `32x32.png`、`128x128.png`、`128x128@2x.png` 与多尺寸 `icon.ico`；`icon.icns`（macOS 专用）不改。
- 同步命名与当前实现摘要：`AGENTS.md`、`README.md`、`方向/核心方向宪章.md`、`方向/第一版方向共识-2026-07-01.md`。历史引用与旧项目教训词不改写；代码/存储名不改。同步时按当前已归档规格（`openspec/specs/`）校正制作模块状态：制作模块核心（第四页面、链路库/版本、装配注入、制作对话与导图）已实现并归档，剩余为多套相互独立的组装方式；不扩大描述。

详见 change `tasks.md` 的未完成项；本记录不表示任何验收已通过。

## 2026-10-10 原型一致性补齐

本轮补齐结果：最近项目只展示前三项（历史数据不删）；返回首页与最近项目使用批准的返回/文件夹图标；AI 最大化按钮补齐批准图标及「恢复边栏」文案；文档管理主次操作按钮层级与 AI 可见性轨道滑块已接入。制作链路库补充常驻样式，标准宽度 220px、1199px 以下 158px，实际制作页几何仍待真机核对。

验证：37 项定向测试通过；按需补读 18 项通过；最终 `npm run test:frontend` 1346/1346 通过，0 失败、0 跳过；`npm run typecheck` 与 `npm run lint` 通过。轨道滑块引出的测试失败已修复模拟 DOM 的文字查找方式，保留原授权、取消、回滚与迟到结果断言。

新增只读 `verification/v5-parity-inspect.mjs`，确认真实 Next Story 调试页面可连接，当前首页为 1024×670、DPR 1，加载本地 Basecoat、styles.css、ui-v5.css。此次只读检查未打开项目、未截图，不能作为制作页、文档管理或全尺寸原型一致性通过证据。工具栏就近菜单、AI 完整头部、文档树列及图标、响应导图、空库口述入口与同尺寸截图仍未完成；全门禁和最终视觉验收仍由主代理与 observer 执行。未勾选完成任务、未归档。

本次沿用已经批准的整体实施授权，在唯一 change 内继续补齐正式界面；允许使用独立空测试项目。未新增 change，未提交或归档。

源组件与正式入口核对清单：

| 原型来源 | 正式入口 | 已确认偏差与实施路径 |
| --- | --- | --- |
| `app.js` 的 `icons.back` / `icons.folder` | 顶栏返回、首页最近项目 | 返回仍为字符，最近项目使用文档图标；使用原型路径，首页仅显示前三项，不删除历史。 |
| `v4.js` 的矩形/双矩形及明标签 | `ai-dock.ts` 最大化按钮 | 缺图标且恢复文案简写；保留同一按钮和108px宽度，补齐批准图标与「恢复边栏」。 |
| 文档管理主操作、类型图标和可见性开关 | `index.html` / `file-management.ts` | 顶部缺操作层级、树缺类型图标、开关为圆点；沿现有真实动作修改展示，保留授权与保存失败保护。 |
| 工具栏就近菜单及最终覆盖链 | `editor-toolbar.ts` / `ui-v5.ts` | 原生段落选择器和总抽屉仍在；需要完整迁移，不能只改图标声称完成。 |
| 制作页常驻库、响应导图及空库口述 | `src/making` / 制作布局 | 1180px以下仍隐藏库，导图固定840×440；空库入口仍需核实真实控制器边界。 |

验证职责：本 lane 的定向测试验证原节点动作、显示限制和状态文案，执行 typecheck、lint 与前端全套；各域真实桌面截图与原型同尺寸比对另列证据。父代理负责最终全门禁，observer 负责最终视觉验收。旧首页 smoke 不作为本次全页通过证据。未完成的迁移及真机验证保持未完成状态，不勾任务。

## 工具栏与 AI 头部本轮实施、验证

工具栏改为单列图标、分组线与就近选项菜单；字体、字号、段落、缩进、行距、段前后间距、颜色与高亮使用原有控件节点及监听，按可用高度收入更多菜单并回流。选择器值进入按钮提示。保留真实编号入口及五种编号。链接入口新增独立 URL 输入与创建/编辑、移除按钮，经现有格式命令执行；原右键菜单和链接弹层节点保持原位置，避免误用其私有缓存地址。销毁展示层时恢复迁移节点、原按钮子节点和展示属性。

AI 头部讨论入口包含真实讨论数量（存档与在途 ID 去重），最大化/恢复按钮为 108×32，收起按钮为 32×32。按原型样式补齐数量徽标、头部右侧动作排列及窄屏留白。

本轮 `node --test tests/ui-v5.test.ts tests/ai-single-projection.test.ts tests/editor-toolbar.test.ts` 为 30/30 通过，0 失败、0 跳过；`npm run typecheck` 与 `npm run lint` 通过。新增测试实际进入菜单迁移分支，验证原字段监听、数值、禁用态、收纳回流、五种编号、右键链接入口保留及销毁恢复。前文 1346 项全套是上轮结果；本轮未重跑全套，最终门禁仍交主代理。

真实桌面应用通过 CDP 9223 驱动，使用普通新建项目流程在临时目录创建独立空项目；文件夹选择器仅由表单位置输入替代。创建时验证脚本的反斜杠转义导致路径无效，改用正斜杠后成功；空项目初始无讨论，须先从讨论列表选择「新建对话」，才能验证未发送草稿。未发模型请求、未读写用户已有文档正文。应用调试端口曾关闭，重新启动现有 debug 可执行文件后恢复。窗口调整采用核对可执行路径、且只允许唯一窗口的 Win32 脚本，没有改 Tauri 权限。

最新证据为 `verification/v5-parity-screens/evidence.json` 及同目录 12 张截图。三档真实窗口客户区为 1024×670、1280×720、1440×900，原生 DPI 96、DPR 1；各档均采集边栏、最大化、恢复、收起写作状态。最大化按钮均为 108×32；恢复前后边栏几何一致；当前讨论投影数为 1；收起重开草稿保留；所检查的工具栏及 AI 头部按钮无窗口越界。900px 高度下工具栏较 670px 多回流查找与对齐按钮，保留收纳菜单。

本轮模型无法读取截图图像，以上为 DOM 几何及真实交互证据，**不表示原型视觉差异≤1px已验收**。尚需 observer 同尺寸图像比对、其他 DPI、用户真实点击；工具栏选项在真实非空选区上的格式与链接操作尚未真机验收。制作与文档管理余项保持下一轮。未勾任务、未提交、未归档。

| 原型来源 | 本轮实现对应 | 差异与证据限制 |
| --- | --- | --- |
| `app.js` 工具 defs 与选项菜单 | `ui-v5.ts` 单列工具、就近菜单、真实字段迁移 | 实际字段及五种编号沿用业务控件；菜单迁移定向测试通过，非空选区真机操作待验收。 |
| `styles.css` AI 头部、数量徽标 + `v4.css` 动作尺寸/窄屏 + `v5.css` 最大化留白 | `index.html`、`ai-dock.ts`、`ui-v5.css` | 三尺寸真实几何及布局状态已采集；完整覆盖链与原型截图比对仍待最终视觉复核。 |
| 原型链接工具入口 | `toolbar-link-*` + `editor-toolbar.ts` | 用独立输入调用现有 setLink/unsetLink，原右键和链接弹层保留；无额外 AI 工作流。 |

## 制作响应布局、文档类型与四页截图补充

制作图区改为响应网格，连线依据实际节点边界计算并随 ResizeObserver 更新；自定义来源保留区内滚动，固定底座和每轮动态汇入组装，再输出提示词。定向制作测试提供两档节点边界，验证 viewBox 和路径端点随宽度刷新。文档树补齐原型文件夹／文档类型图标、18px 层级步进和折叠按钮读屏名称，行操作采用 Basecoat ghost 按钮样式，保留原服务动作及失败回退。

工具栏通知事件修正为由当前 document 创建事件，兼容真实页面和测试 DOM；不支持事件派发的最小模拟对象跳过通知。修正前全量前端测试存在编辑器／项目切换连带失败，修正后 `npm run test:frontend` **1347/1347 通过、0 失败、0 跳过**；`npm run typecheck`、`npm run lint` 通过。该结果先于新截图脚本添加，脚本另经真实运行验证。

新增 `verification/v5-parity-pages.mjs`，通过真实桌面调试端口、普通表单新建临时空项目，再实际点击写作／文档管理／制作／设置。最终证据为 `verification/v5-parity-pages-screens/evidence.json` 及 12 张截图，尺寸 1024×670、1280×720、1440×900；DPI 96、DPR 1，脚本运行无捕获异常。制作左栏三档宽度为 158／220／220px，保持显示；返回按钮三档为 32×32。文档管理、制作、设置未测到模块水平溢出；三档四页均未测到可见按钮横向越界。修正了检测器将 visibility:hidden 抽屉误算可见的情况，写作模块原始 scrollWidth 仍大于 clientWidth，尚未查清，不能据此宣布无横向溢出。

截图使用独立空项目，不读取或修改已有用户正文、不发模型请求、不创建／删除／启用全局链路。当前库无可浏览链路，因此截图未覆盖有内容导图；连线路径只有单元测试证据。本模型无法读取截图图像，视觉验收仍需 observer。未完成独立端口原型截图、文件行菜单／右键真机操作、真实三格式进出线及非空选区格式操作，不宣称已验收。

空库制作对话仍有实际协议阻塞：`making-session-controller.ts` 在制作对象为空时隐藏活动输入并拒绝新建会话；`MakingConversationRecord.chain_id` 为必填字符串。直接口述入口需要会话协议支持，与纯展示层纠偏存在边界，交主代理处理；不通过隐式创建全局链路绕过。未勾完成任务、未提交、未归档。

## 最终 v5 参考、最大化布局与溢出纠偏

顶栏调整为「已保存／保存／AI陪想」；文档按钮补文档图标，移除「当前文档」灰字及按钮边框。移除工具按钮常驻的值标签，当前值仍可从提示及真实选项控件查看。最大化隐藏左侧写作工具栏，让 AI 面板从 x=0 开始；内容、讨论头部及输入容器按最终原型的 760px 居中。收起 AI 后隐藏旧窄轨，保留顶栏重新打开入口及讨论状态。未修改制作业务、模型配置、全局链路或应用图标资源。

原型通过 `verification/v5-reference-capture.mjs` 在独立 Edge 中实际加载 Basecoat、基础样式与脚本、feedback、v2、v3、v4、v5 的完整覆盖链。浏览器解析后的最终规则确认正文／讨论元信息／输入最大化宽度为 760px（替代早先约770px的估计）。输出 `verification/v5-reference-screens/` 内 21 张图及 `evidence.json`：三尺寸的写作／文档管理／制作／设置，另含边栏／最大化／恢复。原型文件只读，运行无捕获异常。

纠正前文第64段的证据表述：旧脚本虽得到三种原生客户区尺寸，WebView 实际始终为1440×900，旧三尺寸截图不能支持三尺寸响应验收。现有脚本显式设置 CDP 视口，并校验 `innerWidth/innerHeight` 与标注尺寸一致；原生窗口结果与页面视口分别记录。**以下证明指定视口下的实际应用布局，不证明原生窗口缩放能自动驱动 WebView 视口更新**。该桌面缩放问题仍须父代理核查，不能以模拟视口替代真机缩放验收。

> **更正（2026-10-10，依据 `verification/v5-bounded-final-2026-10-10.md`）**：上文「原生窗口缩放不能自动驱动 WebView」结论**已修**。根因是旧验收脚本取错 HWND——它命中的是单实例通信窗口 `com.nextstory.desktop-sic`（HWND 2102734），而非真实 `Tauri Window`（HWND 3348336，同 PID）；调整前者不会改 WebView。脚本改为枚举真实 Tauri 顶层 root 后，三档原生客户区 1024×670／1280×720／1440×900 与 WRY/渲染/页面视口一致，最大化/恢复通过（VBF 表）。剩余仅其它 DPI 与用户手动拖拽。原时态保留为历史。

实际写作水平溢出的根因已定位：Basecoat 的不可见提示伪元素为工具按钮增加滚动宽度；收起 AI 后旧窄轨的提示又将模块撑宽12px。工具按钮仍由统一提示显示文字，移除重复伪元素；最终收起布局不显示旧轨。没有只过滤隐藏节点来宣称解决。最新 `v5-parity-pages-screens/evidence.json` 中四页×三尺寸全部 `moduleHorizontalOverflow:false`，且可见按钮均无横向越界。

最新 `v5-parity-screens/evidence.json` 及12张图验证三尺寸 AI 边栏、最大化、恢复、收起；新增硬断言：最大化工具栏不可见、dock x=0、讨论头部／正文／输入容器均为居中760px、收起写作模块的 scrollWidth 不超过 clientWidth。所有断言通过，草稿保留，运行无捕获异常。矩形／双矩形 mask 状态随按钮切换，最终图标视觉仍交 observer 查看。

`verification/v5-menu-capture.mjs` 在隔离空项目真实点击文档行更多按钮及右键，三尺寸共6张菜单截图输出到 `v5-menu-screens/`；菜单190px宽且完整位于窗口内，无捕获异常。8个就近工具入口×三尺寸共24次检查因空项目无可用编辑选区而跳过，未强制启用、未插入正文；不能将其算作菜单或非空选区格式／链接真机验收通过。

本轮定向 `node --test tests/ui-v5.test.ts tests/ai-single-projection.test.ts tests/editor-toolbar.test.ts tests/file-management.test.ts` **50/50通过，0失败、0跳过**；typecheck、lint通过。上述检查后仅作收起窄轨样式和几何脚本断言修正，再运行实际三尺寸布局与菜单检查。前文1347项是此前全量结果，未作为本轮最终全量门禁。剩余验收：observer 同尺寸图像比对、原生缩放、非空选区格式与链接动作、三格式真实进出线、有内容制作导图，以及父代理最终全门禁。未勾任务、未提交、未归档。

最新改动后的收尾复查：重新运行上述四个文件的定向测试，终端完整结果为50项、50通过、0失败、0跳过；`npm run typecheck` 和 `npm run lint` 再次通过。逐项核对持久化证据：四页12个状态的 `moduleHorizontalOverflow` 均为 false、`visibleButtonsOutside` 均为空；AI三档 `draftPreserved` 均为 true；应用、原型、菜单证据的 `errors` 均为空。菜单24次跳过仅确认空项目中工具控件禁用，未进一步证明禁用原因是缺少编辑器还是缺少选区，不能用该结果证明有文档时的菜单可达性。此复查未扩大为全量门禁或视觉验收。

## 2026-10-10 空库直接口述（未绑定制作会话，有界限定操作）

承接第 84 段：空库「直接口述」需要会话协议支持。本轮完成最小协议扩展与接线，仅限制作泳道（`src/making/making-session-controller.ts`、`src/making/making-module.ts` 的入口/状态接线、`src/project-api.ts`、`src-tauri/src/{making_session,chain_library,lib}.rs` 与对应测试）；不改界面 CSS/index/图标等其它泳道。

- **可选 chainId**：`MakingConversationRecord.chain_id` / `MakingConversationSummary.chain_id` 改为 `Option<String>`（Rust）/`string | null`（TS）。未绑定以 `null` 表示，**不以空字符串伪造**（Rust `validate_record` 拒绝空字符串）；旧档案的字符串 `chain_id` 反序列化为 `Some`，向后兼容。
- **会话不依赖链路**：真实 AI 身份为 `session_id + SessionKind::Making`，`making_start_session/send/cancel/end` 均按会话 id，无需 sidecar 驱动协议改动。未绑定会话可发送 / 停止 / 保存 / 重开；`making_conversation_list(chainId: Option<String>)` 在 `null` 时列出未绑定会话。
- **入口**：制作页「开始新制作」在链路库为空（无任何链路）时不再报错，改为开启未绑定会话；未绑定不发「链路现状」附言（无链路可述，不虚构），立即落一版空档案以便重启后重开；有链路时行为不变。
- **浏览/刷新/切标签不丢**：`setChain` 仅在制作对象真实变化且与当前会话绑定不一致时复位，未绑定会话在 `makingChainId` 保持 `null`（刷新 / 浏览）时保留，不自动绑定。
- **保存草稿才建链路**：未绑定会话点「保存这版草稿」且经确认后，调用新增有界限定命令 `making_chain_ensure_for_conversation`：以会话 id 派生确定性链路 id（`chain-<conversationId>`），在同一链路库锁内一次读改写完成「建链路＋首版本」，**绝不触碰 `active`**（保存不等于启用）；幂等——同会话重复调用不重复建链路/首版本，仅有链路无版本时补写首版本，写入失败可安全重试。成功后绑定该链路、持久化会话并切换制作对象。取消保存则不建链路。
- **试问**：未绑定草稿的「开始试问」禁用（无具体版本可绑定），保存绑定后才可试问；不产生讨论档案、不切全局链路。
- **隔离**：制作助手仍不读作品、不注册 story 工具；本轮未调用生产模型、未读写用户正文/密钥；Rust 测试仅在临时目录验证。

验证见 `verification/making-unbound-2026-10-10.md`。未勾选完成项、未提交、未归档；完整门禁与视觉验收仍由父代理 / observer 执行。

**2026-10-10 oracle 复审修正（四处缺口，先复现后修）**：①首次 ensure 已建首版但绑定整档保存失败时内存已置 Some、再次保存误走 `chain_save_version` 追加第 2 版——新增 `pendingBindChainId` 待绑定阶段，`saveSession` 返回成功/失败，重试只补保存绑定；②`ensure` 既有确定链路不比对 cards，A 部分成功后重启草稿 B 会谎称已保存——改为返回 `EnsureChainResult{created|repaired|idempotent|conflict}` 按卡内容判重，冲突不追加、不谎报，恢复绑定后普通保存追加；③整档覆盖允许 Some→None/改绑——`save_making_conversation` 同锁内绑定单调保护（拒绝撤销/改绑），前端同会话保存串行队列＋快照；④未绑定会话打开时浏览对象覆盖列表作用域、历史被隐藏——新增 `listScopeChainId()` 以会话自身绑定为准，历史入口在有会话/制作对象时可用；另加 ensure 边界校验（会话存在/未删除/绑定不冲突，会话锁与链路库锁不重叠）。定向：`making-conversation` 35/35、`test:frontend` 1358/1358、typecheck/lint/build 通过、`cargo test --lib` 508 通过/1 ignored、fmt/clippy 通过；`test:rust` 因非本 lane 启动的 `next-story.exe` 占用构建产物而阻塞，需父代理协同。详见 `verification/making-unbound-2026-10-10.md`。

**2026-10-10 oracle 追加两项真实竞态修正**：①旧会话绑定保存完成后无条件 `switchMakingObject` 抢当前投影——新增 `isStillCurrentSession` 守卫，异步完成后仅在 `currentId` 仍为该会话且未被替换/删除时才切换，保存本身不变；②ensure 校验与链路写入分两把锁、之间可被 delete 插入产生孤链——改为 `with_conversation_store_lock` 在会话存储锁内贯穿「校验＋链路写入」，统一 session→chain 锁序（已核对无相反锁序，无死锁）。定向：`making-conversation` 37/37、`making-*` 99/99、`cargo test --lib` 510 通过/1 ignored、typecheck/lint/build/fmt/clippy 通过；`test:frontend` 1361/1362，唯一失败 `tests/editor.test.ts:1338` 属其它 lane（列宽按钮文案「宽 · 860」），不在本 lane 范围。

## 2026-10-10 四组展示修复与最新定向证据

AI 面板最大化／恢复改为每次状态更新时渲染原型路径的真实 SVG `.panelicon` 与文字，取代 CSS mask 伪元素。文档管理增加项目面包屑、名称／AI 可读／最近修改表头、文件夹与文档统计、可读／不可读开关和双击进入写作；双击沿用编辑器已有保存与切换保护，并在切换前后校验项目装载身份。正文操作按钮不触发双击打开，暂停、旧装载和卸载行不能打开文档。统计不包含回收站，卸载时清空面包屑与统计。内容树没有节点修改时间字段，最近修改显示 `—` 并提示暂无修改时间，未编造日期。

设置页采用连接与显示面包屑、API 地址标签、普通密钥说明和写作显示分栏，移除三个灰说明框，保留可展开的发送材料说明与真实授权边界。制作库入口显示新建制作，链路行分别投影正在查看、正在制作、已启用版本／未启用和更新草稿；制作对象变化时刷新显示，未更改另一泳道的未绑定会话业务。

最新定向验证：八个文件（ui-v5、ai-single-projection、editor-toolbar、file-management、making-module、dom-contract、llm-config-form、agent-on-demand-reading）共 **135/135 通过，0 失败、0 跳过**。此后只补制作行“正在制作”与刷新显示及三态断言，单独复测 making-module **46/46 通过**。typecheck 与 lint 在该最后展示补丁后再次检查，结果以本轮终端为准。未将这些结果算作完整门禁。

重新启动真实 debug 应用后，`v5-parity-pages.mjs` 刷新四页×三尺寸共12张截图与几何记录，均无模块横向溢出和横向越界按钮，`errors:[]`。`v5-parity-toolbar-ai.mjs` 刷新边栏／最大化／恢复／收起共12张截图，硬断言真实 SVG 16×16、两状态路径与文字、最大化内容760px居中、工具栏隐藏、收起无横向溢出、草稿保留；三档全部通过，`errors:[]`。首次图标断言错误地要求“恢复”，实际页面文字是“恢复边栏”，已修正断言后通过，未为测试更改产品文案。

`v5-menu-capture.mjs` 只允许已知 UI-v5 隔离项目，通过界面新建独立文档、双击进入写作、机械输入明确的非用户作品测试文字并保存，再真实选择文字打开八个工具菜单。三尺寸共 **24 次工具菜单＋6 次文件更多／右键菜单**，全部在视口内，`errors:[]`、`skips:[]`，输出30张截图。替代此前24次跳过的菜单可达性证据；此轮只验证菜单打开与控件可用，未执行格式变更或链接保存／移除，不算这些动作验收通过。未读取生产正文或密钥，未请求模型，未修改全局链路。

清除 CDP metrics 后再次记录原生缩放：Windows 客户区分别达到1024×670、1280×720、1440×900（96 DPI），WebView页面却依次为1024×670、1024×670、1024×670。页面未随原生后两档同步，问题仍未解决。后续菜单／页面截图使用明确记录的 CDP 指定视口，不能据此声称原生缩放通过。

> **更正（2026-10-10）**：上文「页面未随原生后两档同步，问题仍未解决」的根因与上一条相同——此前 Win32 调整命中的是单实例通信窗口而非真实 `Tauri Window`。改为真实 Tauri 顶层 root 后，原生三档 client == viewport 已通过（见 `verification/v5-bounded-final-2026-10-10.md`）。历史原时态保留。

待交接验收：observer 以同尺寸最终原型截图进行视觉比对；父代理核查原生缩放并执行最终门禁；独立隔离后台数据下的制作空库／有内容导图、真实三格式进出线、格式与链接实际动作仍缺证据。当前全局链路库不可当作隔离测试数据，未通过修改生产链路补图。未勾任务、未提交、未归档。

## 2026-10-10 最终门禁、打包与 designer 终态整合（validation/package lane）

designer 全部 terminal、final 源码后执行最后门禁与打包，详见 `verification/final-cleanup-check-2026-10-10.md`（本轮命令/退出/产物）与 `verification/acceptance-status-2026-10-10.md`（逐条勾选审计与剩余）。

- **清场**：owned debug `next-story.exe`（PID 25588，父 34616，创建 2026-10-10 04:46:27，与 temp `ui-v5-app-owned.json`、`verification/v5-launch-owner.json` 一致）当场核验后优雅关闭；另停 owned vite pid 31884；未触碰其它进程。
- **门禁**：`npm run check` → `package:check` → `tauri:build` 依序 **exit 0**。前端 **1358/1358**（非旧 1362：旧多窗口几何用例已删、新增发送彩蛋用例）、可靠性 121、驱动 33、离线 78、Rust 510 通过/1 ignored；fmt/clippy 无告警。
- **产物（本轮唯一有效）**：`next-story.exe` 34759680 B `595AF632…`；MSI 121884768 B `C4A9515F…`；NSIS 70808552 B `661C2619…`；`resources/icon.ico` == `src-tauri/icons/icon.ico`（`5C53E2D4…`）。
- **图标**：EXE（debug+release）、NSIS、MSI 内嵌应用 exe 均 8 帧 `16/20/24/32/48/64/128/256` 且逐帧 `matchesIcoFrame=true`；`build.rs` 图标重编跟踪为永久修复，本轮**未** `cargo clean`。
- **离线/CSP**：`dist/vendor/basecoat-css/` 齐全、无运行时外链；CSP `default-src 'self'`。
- **designer 终态整合**：定向 169 项 + typecheck/lint exit 0；`windows` 存储移除、getter 改名派生 `openDiscussionIds`、`index.html` 删除旧几何 sprite、`src/` 旧几何 token 零命中；发送彩蛋原字节 SHA `b8296fa1…`、988×789、alpha 0–255、72×32、28×22.3594、988/789、禁用/启用/focus 合同见 `ui-cleanup-final`。
- 勾选更新见 `tasks.md`（新增 3.1/3.2/6.1，合计 **10/38**）。未归档、未提交。

## 2026-10-10 文档收尾整合（迁移矩阵 / 重启隔离 / 勾选）

- 新增 `verification/migration-matrix-final-2026-10-10.md`：11 入口逐项真实 handler+tests（首页 recent3、顶栏四页＋保存、编辑器全部格式/编号/链接/宽度/留白且无图片、工具栏收纳菜单、发送 PNG、AI 单投影 divider/runtime、文档管理可见性/回收站、3 导入/3 导出、设置高级参数掩码、制作卡/试问/空库、图标 8 帧），含三尺寸真实基线与清理确认（演示数据 0、旧几何 token 0、旧 sprite id 0；`ai-window`/当前 divider 为 live 消费，保留为**非死代码**，不再迁移）。
- 7.9 复验见 `verification/restart-isolation-2026-10-10.md`：新增 fixture **3/3** + 支撑 **110/110**；层级为**两个新鲜控制器共享真实 Node 磁盘存储 + fake 传输**，**不是 Windows 进程重启**，故 7.9 保持未勾（真实重启/真实模型另计）。
- 本轮勾选 **1.3、6.3**（连同 3.6/3.1/3.2/6.1 合计 **12/38**）。1.3 只需清单＋基线，未强加真实全功能操作；6.3 清理＋入口真实 handler 接线成立，未强加用户验收。
- **1.4 保持未勾**：命名合同「固定底座/每轮动态」（已批准 spec）与原型「固定规则/本轮动态」的差异需用户裁决，**不擅改 spec**；22 delta 无重复/矛盾已核，全规格查漏自动部分完成。
- 未改源码/规格/方向；未归档、未提交。

## 2026-10-10 单面板状态合同清理（ai-panel-state-structure）

审计发现未落实的 `ai-panel-state-structure` 迁移（MUST NOT 保存停靠/浮动、聚焦窗口或多窗口几何）：`windows` 是真实存储字段（`Map<string, WindowPlacement>`），并存在 `set_window_placement`/`reset_layout`/`focus_window`/`close_window` 事件与 `setWindowPlacement`/`resetLayout`/`focusWindow`/`closeWindow` API。真实消费者核查：`ai-dock.ts:766` 只用 `windows.keys()` 做计数、`ai-feature.ts:450` 用其重开讨论、其余为 tests；讨论业务状态与当前投影另存于 `discussions`/`focusedConversationId`，不因移除 windows 丢失。

本轮有界机械清理：删除 `WindowPlacement` 及全部停靠/浮动/聚焦/多窗口几何事件与 API；`windows` 由存储 Map 改为**派生只读 Set**（`discussions` id 集合）以兼容 `ai-dock` 计数且不承载几何；重开改走 `selectDiscussion`；`delete_discussion` 生效判据由 windows 改 opening（修一处读档中删除回归）。同步改写/删除陈旧几何测试，保留草稿/滚动/在途/排队/授权/迟到/会话恢复/FIFO/调宽断言。

定向：受影响 8 文件 271/271、`npm run test:frontend` 1356/1356、typecheck/lint/build exit 0、`cargo test --lib` 510 通过/1 ignored、fmt exit 0；源码全文检索已无 `WindowPlacement|set_window_placement|reset_layout|focus_window|close_window` 残留（生命周期 `closeWindow` 为面板隐藏动作，非几何状态）。详见 `verification/ai-panel-state-single-panel-2026-10-10.md`。未改 UI/CSS/index/制作/Rust/icons；未勾任务、未提交、未归档。

## 2026-10-10 用户批准整图区域命名「提示词组成」

用户最新明确批准「提示词组成」用于整张组成图区域。当前源码没有独立整体可见标题，故在链路名称／版本操作栏下方、图上方添加 `making-composition-title`，图 `making-graph` 以 `role="group"` 和 `aria-labelledby` 引用此标题。链路动态名称保持独立；「导图｜制作对话」导航不改。只补14px、零margin、允许自然换行的局部标题样式，不调整内部图布局或业务。

本次仅解决整体区域命名。内部「自定义要求与姿态」「固定底座」「每轮动态」与组装输出「提示词」全部保留；已批准内部名称与历史原型「固定规则／本轮动态」的差异仍待定，不因整区命名批准而声称已解决。只更新本 change 的 making-module-page delta，不改归档主规格、方向历史或原型。

本次源码变动晚于上文已打包产物，现有旧 release／MSI／NSIS 未包含新标题；本次前端 build 不等于桌面重打包。定向验证由 designer 执行，最终整合门禁／打包由父代理负责。

本次验证：`npm run typecheck`、`npm run lint`、`node --test --test-reporter=dot tests/making-module.test.ts tests/dom-contract.test.ts tests/ui-v5.test.ts`（60项）、`npm run build` 均退出0。没有新增镜像断言测试、运行全量package或重打桌面包。

1024档使用现有布局分析：左栏158px、内容左右padding各24px，组成图上方的标题独占内容流整行，可用宽度约818px；五字标题14px远小于该宽度，零margin、自然行高、允许换行，无固定宽高、ellipsis或标题自身overflow裁切。父容器保持纵向auto滚动，新增标题高度进入正常流，不覆盖图中节点。该项是CSS布局分析，没有新拍截图或宣称旧release已呈现新标题。

## 2026-10-10 用户批准制作图来源、两类与输出显示名称

本轮新决定取代上轮内部名称仍待定的状态：整体「提示词组成」；三来源「自定义提示词」「公用基础提示词」（必须用「公」，不是「共用基础提示词」）「本次问题与材料」；中间「组装」保持；输出「完整提示词」；两类「回应要求」「回应风格」，入口「添加回应要求」「添加回应风格」。保留副标「规定回应的方向与说话方式」及「导图｜制作对话」导航。

已同步 index 静态文本与可访问名称、making viewmodel 的分区/详情/身份/添加文案、制作草稿可见类型徽标及受影响显示断言。公用基础提示词仍为所有链路共用、只读；本次问题与材料仍自动加入、只读。底层 requirement/posture、schema、草稿解析值、保存确认协议相关卡名、真实提示词底线、读取授权、全局链路行为均沿用。内层保持原文：图中「红线／骨／工具／材料规则」「问题／材料／入口」；只读详情「红线／骨（底线立场）／工具／材料规则」「你的问题／当轮材料／入口」。未提前处理内层改名。

长来源标题保留15px，只增加标题行自然换行及状态标记不收缩。1024/1280/1440三档采用源码布局分析，详见 `verification/making-naming-2026-10-10.md`；原 owned PID25588 已退出，9223 调试连接不可用，本轮没有真实 native 截图或人工视觉验收。旧截图、旧 release／MSI／NSIS 不构成本轮新名称证据。

本轮验证：`node --test --test-reporter=spec tests/making-module.test.ts tests/making-conversation.test.ts tests/making-trial.test.ts tests/dom-contract.test.ts tests/ui-v5.test.ts` 113/113通过，`npm run typecheck`、`npm run lint`、`npm run build` 均退出0。首次10项旧显示断言失败已按批准名称修正；保留卡类型保存及只读行为检查。当前 change 的 making delta、design 与任务5.5措辞同步，复选框不动；未提交、未归档、未改归档规格或历史方向。最终整合门禁、真实桌面视觉复验及新安装包由父代理负责，前端 build 不代表桌面重打包。

## 2026-10-10 内层命名落实（naming-final 收尾）

承上节末段：上节记录内层「红线／骨／工具／材料规则」「你的问题／当轮材料／入口」保持原文。用户同日批准完整词后，内层改名即落实（此为新增决定，上节内层保持描述为当时态历史，保留不改写）：

- 公用基础提示词（原「固定底座」区）内层只读项：「红线」「基本立场」「工具」「材料规则」。
- 本次问题与材料（原「每轮动态」区）内层只读项：「你的问题」「参考材料」「提问方式」。

已改文件：`index.html`（图内两个 source-node 的 items 静态文本已为新名）、`src/making/making-view-model.ts`（`MAKING_BASE_ITEMS` 的 `stance` 由「骨（底线立场）」改「基本立场」；`MAKING_DYNAMIC_ITEMS` 的 `materials` 由「当轮材料」改「参考材料」、`entry` 由「入口」改「提问方式」）。显示断言 `tests/dom-contract.test.ts` 与 `tests/making-module.test.ts` 已按新名一致。change delta `specs/making-module-page/spec.md`（命名要求内层句与「命名统一」场景）、本 design 记录一并按内层批准词更新。旧命名「固定底座/每轮动态」对用户可见显示的合同至此 resolve（原「固定规则/本轮动态」只作历史原型记录）。未改持久化 schema、requirement/posture 卡类型、草稿解析协议、真实提示词底线、读取授权、CSS 设计与任何业务行为。

验证：`node --test tests/making-module.test.ts tests/making-conversation.test.ts tests/making-trial.test.ts tests/dom-contract.test.ts tests/ui-v5.test.ts` **113/113 通过、0 失败、0 跳过**；`npm run typecheck`、`npm run lint`、`npm run build` 均**退出0**；`openspec validate update-frontend-ui-v5 --strict` **valid**。详见 `verification/final-name-reconcile-2026-10-10.md`。

诚实边界：本次为文本命名核对，未运行 native 截图、未做真实桌面视觉复验、未重打安装包；源码/测试注释中仍保留部分旧内部区名（如「固定底座区／每轮动态」）作架构描述，不影响用户可见文案与行为，是否清理留待父代理。未勾任务、未提交、未归档。

## 2026-10-10 最终命名核对 + native + 全门禁/打包（validation lane）

- 复验 `verification/final-name-reconcile-2026-10-10.md`：113 项定向 + typecheck/lint/build + `validate --strict` 均 exit 0；命名合同（含内层）resolve，旧名仅作历史（原时态保留）。
- native：以 `verification/making-naming-native.mjs`（由 native graph capture 派生，输出独立目录）对 owned 隔离临时项目 `UI-v5-naming-…` 的真实 `Tauri Window` 三档 1024/1280/720/1440 出图，client==viewport、`errors:[]`，图区呈现新名；证据 `verification/making-naming-final-screens/`（`graph-1024x670.png`、`graph-1280x720.png`、`graph-1440x900.png`、`evidence.json`）。只读查看现有全局链路（3 行），未启用/改链路、未读正文。
- 清场：owned `next-story.exe`（PID 28820，父 32540，创建 13:33:01）与 owned vite（PID 29464）经 temp `ui-v5-app-owned.json`/`ui-v5-vite-owned.json` 与 CIM path/creation/parent 核对后优雅关闭；无 `next-story` 运行、debug/release exe 未锁定。
- 门禁/打包：`npm run check`（前端 **1358/1358**、可靠性 121、驱动 33、离线 78、Rust 510/1）→ `package:check` → `tauri:build` 依序 exit 0；EXE/NSIS/MSI 内嵌应用 exe 均 8 帧逐帧匹配；Basecoat 离线、CSP `default-src 'self'`。产物：`next-story.exe` 34759680 B `4869EE0D9BDBABB6CDBD7DBD88B51F31E653939B149EF9B0502C72327D9884CD`；MSI 121905248 B `601DAF574ED02D6A309AD6DB0EDA925580A335A36407781E8078AF01E3AC9DF4`；NSIS 70801551 B `FDE31A684CC266AE849EC4515F5DA790503B7BD531A6DF3F53D7EAC7AA9BACB0`。
- 勾选：**1.4**（合计 **13/38**，见 `tasks.md`/`acceptance-status-2026-10-10.md`）；7.2/7.3/7.4/7.5/7.6/7.8 门槛保持未勾。未归档、未提交、未安装器、未发模型、未写全局链路、未读正文/secret。
