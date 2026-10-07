# tasks：add-making-module-core

> 依赖顺序：1→2→3/4（并行）→5→6→7→8。协议（组 2）先行锁定契约，装配（组 3）与档案（组 4）随后，制作助手（组 5）与试问（组 6）依赖 1/2，前端（组 7）依赖后端命令面齐备，验证（组 8）收口。

## 1. 链路库存储与数据模型（Rust）

- [x] 1.1 新建链路库存储模块：数据模型（ChainLibrary／Chain／ChainVersion／RequirementCard／ActiveRef）与 `app_local_data_dir/making-module/` 目录布局（chains.json＋conversations/＋trials/）；对齐 recent_works 原子写惯例；chains.json 读取上限 1 MiB、超限明确报错
- [x] 1.2 链路库管理命令层（Tauri 命令）：建链路、读库、切换当前链路、停用、版本列表、回退；启用＝显式设置 active 指针；回退不删版本；删除链路为独立动作＋确认；版本保存经用户显式确认（制作助手无库写权限）
- [x] 1.3 卡结构校验：触发描述（含负例）＋正文两段；上限（触发描述 ≤400 字／单卡正文 ≤2000 字／版本合计 ≤6000 字）；超限与格式无效明确报错，不静默截断
- [x] 1.4 Rust 单元测试：版本不可变、回退保留新版本、停用保留档案、多链路并存、上限校验、写入失败如实提示

## 2. 驱动协议扩展（sidecar＋Rust 契约）

- [x] 2.1 `sidecar/driver/protocol.json`：`send_message` 增可选 `chain_cards: string | null`（缺省 null）、`start_session` 增可选 `session_kind: "story" | "making"`（缺省 "story"）；字段描述同步为两端契约
- [x] 2.2 `sidecar/driver/driver.mjs`：`send_message` 处理 `chain_cards`（与当前注册文本比较，不同则 dispose 旧 disposer＋重注册 `nextstory:chain-cards`，相同不动；disposer 存入 session 对象）；`createAgentFor` setup 按 `session_kind==="making"` 跳过 `registerStoryTools`；`system-prompt-sections.mjs` 的 `splitSystemPrompt` 两段拆段协议零改动，`registerSystemPromptSections` 改为返回各段 disposer
- [x] 2.3 `src-tauri/src/dsh_driver.rs`：`DriverCommand::SendMessage` 增 `chain_cards`、`StartSession` 增 `session_kind`；两端契约测试双向同步（协议↔枚举一一对应）
- [x] 2.4 驱动级装置测试（对齐① P1 模式）：mock 记录 system 段全文与次序（harness→身份→红线→卡）；幂等断言（相邻同卡不重注册）；追问轮 user 文本仍为纯增量；`making` 会话工具面无 story 四件套；disposer 释放重注册行为断言（旧段注销、新段生效）

## 3. 装配接线（Rust 编排层）

- [x] 3.1 卡文本组装函数：统一包装头（可替换声明，系统生成）＋各卡「适用／不适用＋正文」渲染；输入为冻结的版本快照（与展示层共用同一渲染，防两处漂移）
- [x] 3.2 `ai_orchestration.rs` 轮次发起挂点：读 active 指针→冻结 `{chain_id, version_id, 卡文本}`→`chain_cards` 随 SendMessage 下发；在途轮不受打扰（冻结后不再读指针）
- [x] 3.3 三入口全覆盖：常规首轮、召唤首轮、追问轮均携带当轮冻结值（冻结点在 kind 分流之前）；`text` 语义不变（追问仍纯增量）；legacy 一次性命令通道不接装配（提案排除）
- [x] 3.4 崩溃重放恢复：重放路径不产生模型调用、挂载位保持空；恢复后首轮按当前 active 指针重新冻结携带（与正常轮次一致；档案记录仅用于显示）
- [x] 3.5 Rust 编排回归测试：切换下一轮生效、停用下一轮生效、无卡轮次空段、冻结与档案同源

## 4. 逐轮记录与档案

- [x] 4.1 `conversation_store.rs`：`ConversationRecord` 增记录级可选字段 `chain_rounds: Vec<ChainRoundRef>`（`turn_index`＋链路标识＋名称快照＋版本序号；`#[serde(default)]`，不升 CONVERSATION_VERSION）；后端轮次发起时经窄更新写入（同构 `on_demand_reading_provenance`：后端读改写、与前端保存互斥）
- [x] 4.2 `save_conversation` 合并保护：普通整档保存 MUST NOT 改变 `chain_rounds`（合并清单加入该字段），前端保存链不携带该字段
- [x] 4.3 删除链路不清理讨论档案引用：历史轮次凭名称快照可读
- [x] 4.4 档案兼容与保全测试：旧档案缺失字段不损坏、显示降级；后端写入的链路记录经前端多次整档保存后幸存

## 5. 制作助手会话通道

- [x] 5.1 制作助手信封组装（Rust）：首行身份句（「你是帮助剧本创作者制作陪想要求的助手。」草案）＋红线同文＋制作守则段；沿用两段拆段协议（`splitSystemPrompt` 零改动）
- [x] 5.2 制作会话命令层：`start_session` 以 `session_kind="making"` 建会话（复用常驻驱动进程）；宿主不为制作会话 `register_round`（失败关闭双保险）；制作轮次共用全局并发上限排队
- [x] 5.3 制作对话持久化：`making-module/conversations/<id>.json` 完整逐字历史；按链路组织（最近会话＋历史列表）；重启后重开可继续
- [x] 5.4 制作助手系统提示词：适量澄清（总沟通负担）、按用户技术水平说话、要求溯源口述不自创、卡草稿是临时材料、显式启用语义（「这版不错」≠启用）；日常聊天修改链路的要求一律转介
- [x] 5.5 真实模型行为验证：澄清→草稿→改卡→转介各场景实弹抽测（对齐走通一例记录方法）

## 6. 试问机制

- [x] 6.1 试问轮发起：以当前打开作品＋当前关注文档为环境（可更换），走 `ai_send_message` 同一管线（取材／检索／授权照旧）；卡文本用所试版本（不走 active 指针，不切全局链路）
- [x] 6.2 试问轮不落讨论档案（方案二单一真相源）：不经 `conversation_save`、不进作品讨论目录，天然不进日常会话列表（无 kind 字段链与过滤机制）；试问记录从版本档案只读查看，不可继续追问
- [x] 6.3 对照为显式动作：同问题追加一次不带卡试问，两份证据并列存档；默认只跑带卡一版
- [x] 6.4 试问证据存档：TrialRecord（问题／回复全文／所试链路＋版本／是否带卡／用户反馈可后补／时间／所用作品与关注文档标识）存 `trials/<id>.json`，链路版本内存引用
- [x] 6.5 补读授权随试问呈现：试问区展示所用链路版本、作品、关注文档与运行状态（生成中／等待授权／失败）；授权决定不持久化到任何讨论档案

## 7. 前端第四页面

- [x] 7.1 页面接线：`views.ts` ModuleId 增 `"making"`、`index.html` 新 tab＋新 section、`dom.ts` 引用、`main.ts` setModule 分支、`styles.css` 三栏布局骨架；焦点守卫清单加新 tab（`editor.ts` navigation）；共享 header 保存／AI 面板按钮按模块显隐（`setModule` 新增分支）；DOM 契约测试同步（`dom-contract.test.ts`／`editor.test.ts` 的 id 清单）
- [x] 7.2 顶部状态条：启用显示（当前链路·版本｜所有作品共用｜停用＋生效时机说明）、未启用显示日常陪想提示；不随浏览变化
- [x] 7.3 链路库区：列表（名称／当前启用版本／新草稿提示）、新建、点击只查看
- [x] 7.4 简版结构检视（文字列表式）：可变区卡列表（卡名／版本／适用摘要）＋固定底座四项只读说明＋免责句；无拖拽／步骤编号／执行箭头／占位插槽
- [x] 7.5 制作对话区：最近制作会话继续／新建／历史列表；标题标注正在制作对象；浏览其他链路不换制作对象
- [x] 7.6 三态分离显示与窄窗口收拢（中等宽度链路库收按钮；更窄页内切换检视／对话；状态条常驻）
- [x] 7.7 「本次参考了什么」面板增「本轮链路：名称·第N版」行：`buildMaterialView` 按轮映射记录级 `chain_rounds`（同构材料出处分轮模式），缺失降级不显示；无任何切换按钮
- [x] 7.8 designer lane 视觉细化：按设计方向文档与既有 styles.css 令牌落地间距／层级／状态色（布局与交互骨架以 design.md 为准）

## 8. 全量验证与归档准备

- [x] 8.1 `npm run check` 全绿（typecheck→lint→前端测→可靠性→驱动→validation→build→fmt→clippy→Rust 测）
- [x] 8.2 真实模型端到端：启用→轮次带卡生效→切换下一轮生效→停用恢复日常；制作对话全流程（澄清→草稿→试问→改卡→启用）；试问带卡＋对照
- [x] 8.3 真机冒烟（协议变更按账本第 21 条）：CDP 端到端驱动＋用户真实点击＋视觉比对（第四页面、状态条、试问、「本轮链路」行）
- [x] 8.4 验证记录与证据落盘 change `verification/`
- [x] 8.5 同步《第一刀实施计划-2026-10-06》状态记录（②实施完成，车道腾给③）
