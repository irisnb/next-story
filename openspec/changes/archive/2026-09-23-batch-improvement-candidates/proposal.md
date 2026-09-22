# Proposal: batch-improvement-candidates

> 改进候选清账批（应用户决策 2026-09-22 深夜）：把审计登记在册的应用侧改进候选 ①②③④⑤ 合为一个 change 一并实施。不纳入：评分器三条（离线工具域，另起小批）、旧世界规格对账（登记时即要求先调查再单开 change）。队列 8 已全清、产品开发立项已解锁，先清日常体验欠账。

## Why

五个候选共同指向「日常使用摩擦」，单个都小、积压则永远排不上：

- **④ 无最近作品列表**（8b 存量）：每次重启都要经系统文件夹框重新导航到作品（8b 期间 SendKeys/UIAutomation 双失败的自动化根因，也是真实用户的重复劳动）。
- **⑤ 打开对话框初始位置落子级**（用户长期观察、2026-09-22 二次澄清）：`selectDirectory` 未传 `defaultPath`，初始位置由 Windows 按可执行文件持久化的「最近使用位置」决定——与「上次作品目录」不同源、会被导出保存等动作改写，每次都落到子级里，须返回上级再选。与④共用同一份「最近作品」存储。
- **① 跨文档检索无中文分词**（8b 实证）：候选词按字符类整段抽取，连续中文问句整句成词→零命中，自然提问基本不触发检索，全靠按需补读兜底。
- **② 授权拒绝载荷无恢复路径提示**（8b 多次观察）：模型工具调用被拒后只收到稳定枚举串（如 `on_demand_reading_unauthorized`），自救方向只能靠系统提示词静态推断，多次观察到模型指向不存在的「权限设置开关」。
- **③ 召唤讨论「已切换关注文档」提示误导**（8b 观察）：召唤类讨论的追问永不自动附现场材料（设计行为），但切换入口仍可用且提示「从下一轮开始使用」——该承诺在这类讨论上永远不成立。

## What Changes

- **④ 最近作品列表**：欢迎页新增最近作品区；后端以 `app_local_data_dir` + `recent-works.json` 记录最近打开（沿用 llm-config.json 模式），上限 8 条，含名称/路径/最后打开时间；作品成功打开或新建时记录；条目失效（文件夹不存在或已非作品）时从列表移除或置灰不可点。
- **⑤ 对话框初始位置**：`selectDirectory` 增加可选 `defaultPath`；「打开作品」传最近一条作品路径——对话框定位在该作品文件夹内，无高亮项时点「选择文件夹」即选中该文件夹（微软文档与实证确认），一步重开。
- **① 中文 bigram 分词**：候选词提取对连续汉字段生成二元组（bigram），保持确定性、不调模型；检索输出硬上限（8 候选词/5 文档/10 片段/120 字符）不变；拉丁字母数字段行为不变。
- **② 拒绝载荷恢复提示**：`ToolResultErrorPayload` 与按需补读拒绝回填增加稳定的恢复路径提示（说明可通过 `story-request-reading` 重新申请、用户可在讨论面板授权/新问题可再请求）；按阶段 6 建立的协议单一真相源流程同步 `protocol.json`、驱动侧桥接与双端契约测试。
- **③ 召唤讨论隐藏切换入口**：召唤类讨论（首轮与追问）不再提供「切换关注文档」菜单入口——在该类讨论上该操作无实际效果且提示构成误导；受限讨论的既有拒绝行为不变。
- 归档后同步销账：审计文档改进候选 ①②③④⑤ 标注已实施。

## Capabilities

### New Capabilities

（无——全部落入既有能力规格）

### Modified Capabilities

- `desktop-project-lifecycle`: 新增两条要求——欢迎页最近作品列表（记录、展示、失效处理、打开流程复用）与「打开作品」对话框初始位置定位在最近作品路径。
- `automatic-story-context`: 修改两条要求——「候选词从本轮新增问题确定性提取」由「不做中文分词」改为「连续汉字段确定性 bigram 切分」（上限不变）；「讨论间材料隔离且及时召唤例外」增加「召唤类讨论不提供关注文档切换入口」。
- `agent-on-demand-reading`: 修改一条要求——「允许后自动继续且拒绝后有限回答」增加拒绝载荷 MUST 携带恢复路径提示。

## Impact

- **代码**：`src-tauri/src/lib.rs`（recent-works 存取命令）、新增 recent-works 存储模块；`src/project-api.ts`（selectDirectory 增参、最近作品命令绑定）；`index.html`/`src/new-project-form.ts`/`src/main.ts`（欢迎页最近作品区与打开接线）；`src-tauri/src/project/story_search.rs`（候选词提取 bigram）；`src-tauri/src/dsh_driver.rs`（ToolResultErrorPayload 增 recovery 字段）、`src-tauri/src/story_tool_channel.rs`（各拒绝回填点）、`sidecar/driver/driver.mjs`（桥接）、`protocol.json`（单一真相源）；`src/ai-dock.ts`（召唤讨论隐藏切换入口，识别复用 ai-feature-request-materials 的 summon 判定）。
- **测试**：Rust（story_search 候选词用例更新、recent-works 存取、拒绝载荷契约）、离线协议验证（payload 新字段双端契约）、前端（欢迎页最近作品区、dock 入口隐藏）。
- **存储**：新增应用级 `recent-works.json`（`app_local_data_dir`，不含敏感信息）。
- **行为边界**：检索输出上限、按需补读授权语义、召唤首轮禁补读等既有规格约束全部不变；仅材料命中率和载荷信息量提升。
- **文档**：归档后更新审计文档改进候选销账与处理进度。
