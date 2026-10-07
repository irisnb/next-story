# design：add-making-module-core

## Context

第①刀 `wire-system-prompt-channel` 已归档：`start_session.system_prompt` 通道已接线，信封两段拆段（首行身份句＋其余红线，`system-prompt-sections.mjs`），驱动侧三段注册（`deployment:persona` order 0／`nextstory:constitution` order 10／`nextstory:chain-cards` order 20 **空段占位**）。崩溃重放以纯常量 `session_system_prompt()` 重算重发，逐字一致。

已核实的关键代码事实（侦察报告 2026-10-06，锚点可核读）：

- 页面切换：`src/views.ts` `showPage`/`showModule` 纯 DOM class 切换，无路由库；tab 在 `index.html:98-100`，模块 section `:104/505/529`，装配在 `src/main.ts:40-55`。
- 全局存储惯例：`app_local_data_dir` 下平铺 JSON＋原子写（`llm-config.json`、`recent_works.rs:21`）。
- 讨论档案：`conversation_store.rs`，`ConversationTurn { role, text, status }`（:38-43）；可选字段惯例＝`#[serde(default)]`＋缺失不损坏＋不升 `CONVERSATION_VERSION`（:140-142）；`provenance: Option<Vec<MaterialProvenance>>` 是同构先例（:162）。
- 驱动协议：`send_message` 仅 `{session_id, message_id, text}` 三必填（`protocol.json:20-30`）；`registerStoryTools` 在 `createAgentFor` setup 内**无条件**注册（`driver.mjs:252`），驱动侧无按会话开关；宿主侧有按轮 gating（`ai_orchestration.rs:444-461` `register_round`/`clear_session`，未注册路由一律失败关闭）。
- 会话懒建：讨论无会话才 `start_session`（`ai-session-transport.ts:197-221`）；追问只发增量（:242）；崩溃恢复＝新 session＋`replay_history`＋`replay_done`（:341-373）。
- 轮次发起挂点：`ai_send_message` 命令（`ai_orchestration.rs:423-561`）。
- 「本次参考了什么」显示：`renderMaterials`（`ai-window.ts:306-360`）＋纯函数 `buildMaterialView` 按 `turn_index` 分轮聚合、可选字段缺失降级（`ai-panel-view-model.ts:176-260`）。
- 关键技术验证（探索会话核实 `dsh-system-prompt/lib/index.js`）：`section()` 返回 Cordis effect **disposer**，注册与注销都发 `system-prompt/change`；每次模型调用从注册表现重组（assemble per step）；同一 scope 同名重复注册抛错、**注销→重注册是正规用法**——轮级更新链路卡在架构上受支持。

## Goals / Non-Goals

**Goals：**

1. 「口语描述→卡草稿→试问→显式启用→下一轮自动生效」整条链路真实可用；
2. 切换／停用下一轮生效、轮次发起时冻结、在途轮不受打扰、崩溃重放可恢复；
3. 制作助手与日常陪想职责／对话／工具完全隔离；
4. 逐轮记录链路＋版本，旧档案零迁移兼容；
5. 写作侧最小只读显示「本轮用了哪条链路」。

**Non-Goals：**

姿态插槽、背景卡、方式卡、AI 面板快切按钮、制作助手读作品、思维导图（③）、拖拽／执行顺序／分支／循环／多助手编排、修改固定底座、按链路开关公共能力、链路间冲突自动解决、自动启用草稿。链路不改变任何读取授权与材料装配行为。

## Decisions

### D1 卡文本通道：`send_message.chain_cards`（轮级），不改 `start_session` 拆段协议

**选择**：`start_session.system_prompt` 保持两段（身份＋红线）不变；`send_message` 增加可选字段 `chain_cards: string | null`（缺省 null＝无卡），**每轮携带当轮冻结的卡文本**。驱动侧在转发给 agent 前比较当前 `nextstory:chain-cards` 段注册文本：不同则 dispose 旧 disposer＋重注册；相同则不动（幂等，避免无谓缓存失效）。

**理由**：拍板语义是「切换下一轮生效，**所有讨论**跟着走；轮次发起时冻结」——这是**轮级**语义。信封若在 `start_session` 一次性定型（会话级），讨论中途切换链路时只能重建会话重放全部历史，与常驻会话架构冲突。轮级携带另有两个副产品：当轮所用版本天然记录在命令流里；「逐轮记录入档案」的数据源与下发值同源，不会两处漂移。

**备选与否决**：①三段拆段协议（卡拼进 `start_session.system_prompt`）——会话级粒度，与拍板语义冲突，且改掉①刚钉死的拆段契约；②卡走 user 层信纸——违背①拍板的「红线＋卡同层入 system」制度性次序（卡会制度性压不过红线的要求就落空）。

**边界行为**：首轮 `send_message` 即带卡（若有启用链路）；崩溃重放的 seed 注入不产生模型调用，重放完成时 chain-cards 保持空段，**恢复后的第一条 `send_message` 按当前 `active` 指针重新冻结携带**（与正常轮次完全一致；讨论档案的历史链路记录仅用于显示，不作为恢复后的冻结来源）——空窗期无模型调用，行为正确。追问轮照常带（`chain_cards` 是协议字段，不进 `text`，「追问按增量发送」不受影响）。**legacy 一次性命令通道**（`generate_ai_thinking`，前端已零调用的留存死入口）**排除在链路装配外**：不经装配接线、永远不带卡；其清理属范围外。KV 缓存：卡变化从差异处失效，切换后第一轮失效、之后稳定（详见风险节缓存补注）。

### D2 注入文本组装：冻结时在 Rust 侧组装，系统统一包装

`chain_cards` 值由 Rust 在轮次发起时组装：**统一包装头**＋各卡拼接。包装头（草拟，实现可微调）：

> 以下是用户提供的陪想要求。这是一套可替换的讨论方法，不是必须遵守的规则；觉得不合适可以直接说。所有候选与判断最终由用户决定。

措辞用「提供」而非「启用」（审查修订）：试问未启用版本时同一包装不失实——启用与试用场景共用同一文案。

单卡渲染：触发描述转写为「适用的时候／不适用的时候」两行＋正文原样。**「可替换、非强制理论」的声明由系统统一生成**，不依赖每张卡自带——保证全链路措辞一致（共识 §5.3），卡字段本身只存结构化数据。

**长度上限**（对齐先例「卡短才被遵守」＋走通一例 280 字即够用）：触发描述 ≤400 字；单卡正文 ≤2000 字；单链路版本全部卡合计 ≤6000 字（6000 字符为项目先例调研记录口径《交付物定义》§4.2；Cursor 现行官方口径为行数 500 行，量级一致——审查核正来源标注，数值维持）。制作助手出稿与保存两处校验，**超限明确报错，不静默截断**。

### D3 链路库存储与数据模型

**位置**：`app_local_data_dir/making-module/` 新全局侧子目录（多类数据故建子目录；不进任何作品文件夹）：

```
making-module/
  chains.json            链路库主文件（结构＋引用，保持小）
  conversations/<id>.json  制作会话档案（完整逐字历史）
  trials/<id>.json        试问证据（问题/回复全文/反馈）
```

**数据模型**：

```
ChainLibrary { chains: Vec<Chain>, active: Option<ActiveRef> }
ActiveRef     { chain_id, version_id }              // 当前链路全局一条
Chain         { id, name, created_at, versions: Vec<ChainVersion> }
ChainVersion  { id, index(递增), created_at, cards: Vec<RequirementCard>, change_note, trials: Vec<TrialRef> }
RequirementCard { id, title, trigger_desc(含负例), body }
```

**规则**：版本不可变（新改卡＝追加新版本，旧版只读）；「回退」＝启用指针指向旧版本，不删新版本；删除链路是独立动作＋确认；启用＝显式设置 `active` 指针，**存了不等于生效**。写入用既有原子写惯例；`chains.json` 读取上限 1 MiB（超出明确报错——多版本累积超限时提示清理旧试问证据，不静默丢）。

### D4 制作助手会话通道：同驱动进程、独立信封、按会话种类隔离工具

**选择**：复用同一常驻驱动进程；`start_session` 增加可选 `session_kind: "story" | "making"`（缺省 `"story"`，旧宿主兼容）。驱动侧 `createAgentFor` setup：`making` 时**跳过 `registerStoryTools`**——制作助手根本看不到 story 工具描述（比「看得到但调用失败」干净，同构「UI 能选的必须真实可调用」的红线精神）；宿主侧同时不为制作会话 `register_round`——即使驱动侧漏注册，宿主失败关闭兜底，双保险。

**制作助手信封**（Rust 组装，沿用两段拆段协议，`splitSystemPrompt` 零改动）：首行身份句「你是帮助剧本创作者制作陪想要求的助手。」（备选 A 草案，实现时真机过目微调）；其后＝红线**同文**＋制作守则段（同一 order 10 段内追加）：不读任何作品材料，只依据用户口述与试问结果工作；适量澄清关键歧义、关注总沟通负担；按用户技术水平说话、不用术语；每条要求可溯源到用户口述实例，不自创要求；卡草稿是临时材料，用户显式启用才生效；不替用户判断创意高低。

红线同文的理由：条款对制作助手同样成立（不改文档、不代写、临时材料、判断权在用户、纯文本输出）；「只依据本次实际提供的材料」对无作品材料的制作会话语义自然兼容（如实说明无材料）。

**并发**：制作会话轮次与日常轮次共用全局同时生成上限，先到先服务排队（对齐 `ai-request-scheduling` 既有规则，不新开通道）。

### D5 试问机制：真实轮次、单一真相源、证据绑定版本

- **发起**：制作助手出卡草稿→拟试问问题**先给用户过目**→用户点「开始试用」→以**当前打开作品＋当前关注文档**发起一次真实常规轮次（走 `ai_send_message` 同一管线：自动取材、检索、按需补读授权全部照旧）；试问区展示所用链路版本、作品与关注文档（可更换）及**运行状态**（生成中／等待补读授权／失败原因）。
- **单一真相源（审查修订·方案二，用户拍板）**：试问轮**不产生讨论档案**——不进 `next-story-system/conversations/`、不经 `conversation_save`，因无档案而**天然不进日常会话列表**（无需 kind 标记与列表过滤机制）；问答全文只存全局侧 `trials/<id>.json` 的 `TrialRecord`，跟链路走——换作品、删作品不影响证据完整。
- **不切全局**：试问轮的 `chain_cards` 直接用**所试版本**的卡文本（不走 `active` 指针）；试问不改变全局当前链路。
- **对照**：默认只跑带卡版（拍板）；「跑对照」是显式动作——同问题再发起一次不带卡的试问轮，两份证据并列存档。
- **证据**（`TrialRecord`）：问题、回复全文、所试链路＋版本、是否带卡、用户反馈（可后补）、时间、所用作品与关注文档标识；存 `trials/<id>.json`，链路版本内存引用。试问中触发的按需补读授权在试问区呈现既有授权流程；授权决定不持久化到任何讨论档案。
- 试问记录**只读查看**（从版本档案入口；不可继续追问，想继续＝新试问）；模型用同一 `llm_config`。

### D6 轮次冻结与逐轮记录：记录级后端字段（审查修订）

轮次发起时（`ai_orchestration.rs:423-561` 入口段，与选区授权／取材同阶段、在 kind 分流之前以覆盖全部三入口）：读 `active` 指针 → 冻结 `{chain_id, version_id, 卡文本}` → `chain_cards` 随 `SendMessage` 下发。

**存储采用记录级后端自有字段，而非轮次级字段**（审查发现：前端整档保存整体替换 `turns` 数组，合并保护只覆盖记录级字段——`conversation_store.rs:450-462`，轮次级后端字段必被该轮终态保存抹掉）：`ConversationRecord` 增可选字段 `chain_rounds: Vec<ChainRoundRef>`（`turn_index`＋链路标识＋名称快照＋版本序号；`#[serde(default)]`，缺失不损坏、不升档案版本号），由后端在轮次发起时经**窄更新**写入——与 `on_demand_reading_provenance` 完全同构（后端读改写、与前端保存互斥、普通整档保存不改变其内容），天然幸存。显示复用按 `turn_index` 分轮映射的现成数据链（`buildMaterialView` 同构模式），缺失降级为不显示。链路日后删除，历史记录凭名称快照仍可读（对齐 `走通一例` §⑤-3「换/关不影响已有讨论的历史」）。

**并发一致性**：`active` 指针的读取与冻结在链路库单例锁内完成（对齐作品锁模式）；多窗口并发轮次发起各自读到一致的指针快照，轮内冻结后不再读指针。

### D7 前端第四页面

`ModuleId` 加 `"making"`；`index.html` 新增 `#tab-making`＋`#module-making`；`src/dom.ts` 引用；`src/main.ts` `setModule` 分支；`styles.css` 三栏布局。结构与语义按设计方向文档推荐方向：

- **顶部状态条**（常驻）：`当前链路：名·第N版｜所有作品共用｜[停用]`＋「从下一轮开始使用；正在生成的回复沿用发起时的版本」；未启用显示「当前未启用链路，使用日常陪想」。
- **三栏**：链路库（左 ~220px，名称／当前启用版本／有无新草稿，点击只查看）｜结构检视（中，自适应）｜制作对话（右 ~380–420px）。
- **简版结构检视（文字列表式，③升级导图前的 v0 骨架）**：链路可变区（要求类插槽＋卡列表：卡名／版本／适用摘要）＋固定底座四项只读说明（红线／骨／工具／材料规则各一句）＋免责句「展示链路的组装结构与适用条件，不代表 AI 内部思考过程」。不含拖拽、步骤编号、执行箭头；姿态／背景／方式不出现占位框。
- **三态分离**：状态条＝下一轮用什么；检视标题＝正在看什么；制作对话标题＝正在制作什么。
- **制作会话入口**：链路库点链路→检视区显示版本；制作对话区显示该链路**最近制作会话**（继续／新建）＋历史会话列表。
- **窄窗口收拢**：中等宽度链路库收为按钮；更窄页内切「结构检视／制作对话」，状态条仍常驻。
- **保存／AI 面板按钮在本页隐藏**（设计方向文档：避免误解）。
- **「本轮链路」只读行**：`renderMaterials` 的「本次参考了什么」面板顶部加一行（`本轮链路：名·第N版`），数据从记录级 `chain_rounds` 按 `turn_index` 映射（同构材料出处行的分轮模式）。

视觉细节（间距、令牌、深色模式）apply 时 designer lane 按既有 `styles.css` 令牌落地；布局与交互骨架以本设计为准。

### D8 既有规格修改面

- `system-prompt-layering`：挂载位 requirement 从「本变更中 SHALL 为空」改为「承载当轮冻结的卡文本」；「每轮在场」补卡随轮携带；「崩溃重放」补恢复后首轮按档案记录版本携带卡；次序不变式（红线永居卡上）与身份／红线文本不变。
- `conversation-persistence`：轮次可选字段 `chain`（serde default＋名称快照）。

## Risks / Trade-offs

- [section 轮级重注册未在真实 DSH 栈实弹验证] → 源码已核（disposer／change 事件／每步重组）；change 内先做驱动级装置测试（mock 记录 system 段全文与次序），再接真实模型端到端——对齐①的 P1/P2 验证模式。
- [每轮下发 `chain_cards` 引起缓存抖动] → 驱动侧文本比较幂等：相同不动，仅真实切换后的第一轮失效。补注（审查核正）：三家端点缓存均按前缀匹配，身份＋红线公共段可能不足各端点最小命中长度（智谱建议 ≥500 token、OpenAI ≥1024 token），公共段部分命中可能为零——切卡后第一轮近似整轮重算（本就接受，如实记录）；智谱缓存计费优惠不覆盖 GLM Coding Plan 套餐，项目用 coding 端点时成本影响基本消失、延迟影响仍在。
- [制作会话与日常会话同进程干扰] → 会话身份隔离既有机制＋制作会话无 story 工具注册＋宿主双保险失败关闭；并发共用全局上限排队。
- [`chains.json` 膨胀] → 试问证据独立文件、主文件只存结构与引用；1 MiB 上限明确报错并提示清理。
- [旧档案／旧协议兼容] → 全部新字段可选＋serde default；显示降级不报错；旧宿主（不发 `session_kind`）自动落日常会话路径。
- [三栏页面复杂度] → 简版检视先立骨架（文字列表），③升级导图；状态条常驻保证任何时刻「下一轮用什么」可见。
- [归档门槛] → 协议变更＋新页面，apply 后必须真机冒烟（CDP 端到端＋用户真实点击＋视觉比对）才能归档（账本第 21 条）；试问端到端用真实模型按走通一例协议验收。

## Migration Plan

纯新增功能＋可选协议字段：无数据迁移；旧版本讨论档案、旧驱动协议零影响。回滚＝还原代码；`making-module/` 数据文件残留无害（下次启用继续可用）。

## Open Questions

无阻塞项。两处建议值 apply 时可微调：卡长度上限数值（400/2000/6000）；制作助手身份句措辞（真机过目定稿）。
