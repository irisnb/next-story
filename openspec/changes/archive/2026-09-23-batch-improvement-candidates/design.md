# Design: batch-improvement-candidates

## Context

- 侦察结论（exp-1，2026-09-22，实读代码与规格核对）：
  - **④⑤**：欢迎页 `index.html:37-49` 只有新建/打开两入口；应用级落盘先例为 `llm-config.json`（`lib.rs:647-664`，`app_local_data_dir`），无 Tauri store 插件；`selectDirectory`（`project-api.ts:37-45`）未传 `defaultPath`。归属规格 `desktop-project-lifecycle`（欢迎页入口 Requirement 不含最近列表；打开校验 Requirement 不涉初始位置——均为规格空白，走 ADDED）。
  - **①**：`story_search.rs:138-171` 候选词按「汉字连续段／拉丁字母数字连续段」整段抽取，切分仅发生在字符类边界；`automatic-story-context` spec.md:61 原文明确「不做中文分词」——行为变更须 MODIFIED 该 Requirement；检索硬上限常量在 `:28-36`。
  - **②**：拒绝回填点在 `story_tool_channel.rs`（无路由上下文 `:468-479`、召唤首轮硬门禁 `:480-492`、保险丝 `:541-552`、授权解析失败 `:580-591`、前置决策拒绝 `:594-610`、用户拒绝 `:786-822`）；载荷结构 `dsh_driver.rs:80-85` `ToolResultErrorPayload` 仅 `reason` 单字段；驱动桥接 `driver.mjs:436-444`。归属 `agent-on-demand-reading`「允许后自动继续且拒绝后有限回答」（恢复路径在规格里存在但未进载荷）。
  - **③**：切换入口与提示在 `ai-dock.ts:650-653,678-699`（「已切换关注文档：《…》。从下一轮开始使用。」）；召唤类讨论识别 `ai-feature-request-materials.ts:36-39`（首轮 `request.kind === "summon"`、追问 `initialUserMaterial.kind === "summon"`，均不注入材料）；召唤讨论确实可切换且改绑持久化，但材料永不自动附带——提示承诺不成立。
  - **⑤ 机理（librarian 源码级实证，2026-09-22）**：`open({directory:true})` 无 `defaultPath` 时初始位置由 Windows ComDlg32 `LastVisitedPidlMRU`（按可执行文件持久化）决定；传 `defaultPath=存在的目录` 时对话框定位在该目录内部，且无高亮项时「选择文件夹」按钮返回当前文件夹——一步选中。
- 协议约束：`ToolResultErrorPayload` 属阶段 6 建立的 `protocol.json` 单一真相源体系，增字段须走「改 protocol.json → 双端生成/适配 → 契约测试」流程。

## Goals / Non-Goals

**Goals:**

- ④⑤：重开常见作品零导航（欢迎页一点即开；文件夹框一步可选中最近作品）。
- ①：自然中文问句能命中跨文档检索（确定性 bigram，不调模型，上限不变）。
- ②：模型被拒后收到可执行的自救提示，不再指向不存在的开关。
- ③：召唤类讨论不再出现「从下一轮开始使用」的误导入口。
- 全部离线可验；归档后审计候选①–⑤销账。

**Non-Goals:**

- 不做词典/统计分词、实体识别、拼音容错（bigram 足够提升命中率，保持确定性简单）。
- 不改检索输出硬上限（8 词/5 文档/10 片段/120 字符）、不改按需补读授权语义、不改召唤首轮禁补读。
- 不给「新建作品」的浏览框传 defaultPath（保持现状，避免扩大面）。
- 不做最近作品的置顶/编辑管理（只读列表 + 失效自愈），不做评分器三条与旧世界规格对账（明确排除，另批处理）。

## Decisions

- **D1 最近作品存储：后端 `app_local_data_dir` + `recent-works.json`（Rust 管理）。**
  沿用 `llm-config.json` 模式（`lib.rs` 的 load/save 命令形态）：条目 `{name, path, lastOpenedAt}`，按 `path` 去重（重开移顶），上限 8 条（超限裁尾）。写入时机：作品成功打开或新建完成后。文件缺失/损坏 → 失败开放返回空列表，不报错不阻塞启动。**不进 localStorage**（WebView 数据清理会丢，且后端管理便于⑤读取同一份数据）。
- **D2 欢迎页最近作品区：列表渲染 + 失效自愈 + 复用既有打开流程。**
  位置在两按钮之下；每条显示作品名（副文本路径）。读取命令在返回前列做有效性检查（路径存在且含 `next-story-system`）——失效条目直接从返回与落盘中移除（自愈），不渲染置灰态（简单诚实）。点击条目 → 走 `openProjectAfterAuthorization`（含 `guardLeave` 离开确认），与「打开作品」同链，不另辟快捷路径。
- **D5→D3 顺序说明：对话框初始位置依赖 D1 的最近列表。**
  `selectDirectory(title, defaultPath?)` 增可选参；「打开作品」传最近一条的 `path`。对话框将定位在该作品文件夹内部——无高亮项时点「选择文件夹」即选中它（机理见 Context），一步重开。代价：要开**别的**作品需返回上级（最近列表已覆盖常见情形，可接受，写入规格表述）。列表为空时不传，行为同现状。
- **D4 中文 bigram：汉字连续段生成二元组，确定性、按位序、去重后受 8 词上限裁剪。**
  长度 L≥2 的汉字段产出全部连续二元组（L=2 即本身）；拉丁字母数字段行为不变；NFKC 规范化与 `find_hits` 子串匹配不变。溢出上限时按出现顺序保留前 8（确定性）。**不保留整段原词**（整段在正文中极少逐字出现，白占名额）。示例：「林晓的性格怎么样」→ 林晓/晓的/的性/性格/格怎/怎么/么样（7 词）→ 可命中只含「林晓」的片段。备选「词频排序」被否决：引入排序不稳定面，收益不明确。
- **D5 拒绝载荷恢复提示：`ToolResultErrorPayload` 增 `recovery: Option<String>`（稳定英文常量），走协议单一真相源流程。**
  提示面向模型，用稳定英文串（与 reason 同理不做成自由文本）：
  - `on_demand_reading_unauthorized`（含无路由/召唤首轮/前置拒绝）→ "Reading is not authorized. Call story-request-reading to request it; the user can grant it in the discussion panel, and a new question may re-request."
  - `reading_stopped`（保险丝）→ "Reading was stopped. Answer from materials already collected; the user may re-enable reading in the discussion panel."
  - 用户点「本次不允许」的裸 `{granted:false}` 回填 → 追加同一恢复串。
  实施：改 `protocol.json`（单一真相源）→ Rust `ToolResultErrorPayload` 序列化适配 → `driver.mjs` 桥接透传 → 双端契约测试扩展（离线协议验证）。系统提示词 `tool_reading_prompt` 不动（提示词与载荷双通道一致即可，不重复长文）。
- **D6 召唤讨论隐藏切换入口：菜单可用性判定增加「非召唤类讨论」。**
  `ai-dock.ts` 菜单可用条件由 `focusDocumentId !== null && !restricted` 增加非召唤判定（复用 `ai-feature-request-materials.ts:36-39` 同源判据：当前讨论 `initialUserMaterial.kind === "summon"`）。备选「改提示文案」被否决：材料隔离是设计行为，「下一轮使用」在该类讨论上永远无法兑现，改文案只是换一种误导。受限讨论既有拒绝改绑路径（reducer `:946-955`）不变。

## Risks / Trade-offs

- [协议三端改动（②：Rust/protocol.json/driver.mjs）破坏契约] → 单一真相源流程 + 双端契约测试先行；离线协议验证全量回归。
- [bigram 使候选词数量暴涨、8 上限下后位词被裁，行为与旧整段不同] → Rust 候选词单测锁定新行为（含裁剪顺序）；reliability 套件回归确认检索面无退化。
- [recent-works.json 与实际作品漂移（用户在应用外移动/删除文件夹）] → D2 读取时有效性检查自愈，失败开放空列表。
- [初始位置落「作品文件夹内部」对「开别的作品」增加一次返回上级] → 最近列表覆盖常见路径；规格如实写明该取舍。
- [欢迎页布局改动影响既有入口] → 仅在 welcome-page 区块内追加子区块，不动两按钮与 LLM 配置入口；前端全量回归＋真机冒烟。
- [真实链路回归盲区（8b 曾有接线缺陷）] → ②涉及模型侧行为，实施后补一轮智谱真实链路 smoke（拒绝→恢复提示可见）作为验收（用户在场时做，不阻塞离线验收）。

## Migration Plan

1. ①②（后端与协议）：bigram＋载荷字段＋契约测试 → Rust/离线协议全量。
2. ④⑤（存储与前端）：recent-works 命令 → 欢迎页 UI → selectDirectory 增参接线 → 前端全量。
3. ③（前端小改）：dock 入口隐藏 → 前端全量。
4. 全量验证：`npm run check`（typecheck/lint/前端测试/构建/Rust 测试）＋驱动/离线/可靠性三套件＋真机冒烟（最近列表出现、一点重开、拒绝载荷含恢复提示）。
5. 归档：审计文档候选①–⑤销账＋处理进度更新。

**回滚**：纯代码与新增数据文件，git 整体 revert 即回；`recent-works.json` 为可再生缓存（删除无损）。
