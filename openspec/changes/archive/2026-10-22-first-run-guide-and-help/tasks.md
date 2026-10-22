# 任务清单：first-run-guide-and-help

## 1. 数据与文案基础

- [x] 1.1 创建 `src/first-run-guide-steps.ts`：四卡文案纯数据文件（标题+正文，逐字取自 design.md 附录 A）
- [x] 1.2 创建 `src/help-faq-items.ts`：FAQ 十条纯数据文件（逐字取自 design.md 附录 B）

## 2. 首启向导

- [x] 2.1 `index.html` 新增四卡向导 dialog DOM：原生 `<dialog>`、卡片区、进度点、「跳过」/「上一张」/「下一张」/末卡「开始使用」（样式复用既有 dialog 先例与 Basecoat；视觉实现请设计师把关）
- [x] 2.2 创建 `src/first-run-guide.ts` 控制器：步进渲染、跳过、Esc 视同跳过、完成后写 localStorage 键 `next-story.onboarding-completed`（经 `resolveLocalStorage()` 容错路径读写）
- [x] 2.3 `src/main.ts` 装配：欢迎页装配完成后、无标记时自动弹出，仅此一次
- [x] 2.4 前端单测 `tests/first-run-guide.test.ts`：首次自动弹出；跳过/Esc 写标记；有标记不再弹出；存储被清后重弹；重看不改标记；四卡顺序与前进后退

## 3. 设置页帮助分区

- [x] 3.1 `index.html` 设置页新增「帮助」分区：「重看新手引导」按钮＋十条 FAQ 的 `<details>/<summary>` 可折叠列表（视觉实现请设计师把关）
- [x] 3.2 创建 `src/help-section.ts`：FAQ 渲染与折叠交互；「重看新手引导」调用与首启同一向导组件（不写标记）
- [x] 3.3 `src/main.ts` 装配帮助分区
- [x] 3.4 前端单测 `tests/help-section.test.ts`：分区构成；展开/收起互不影响；重放引导不改标记；FAQ 十条与附录 B 一致

## 4. 术语统一「新建对话」→「新建讨论」

- [x] 4.1 `index.html` 三处「新建对话」按钮文字与相关 `aria-label`/`title` 改为「新建讨论」（实施中按 grep 扩至运行时报错文案、源码注释与 AGENTS.md 现行描述，见下方 4.2）
- [x] 4.2 全仓 grep「新建对话」：更新测试断言与 `README.md` 中对应表述（不改行为逻辑；实施含 `src/ai-panel-conversation.ts`、`src/ai-panel-reducer.ts`、`src-tauri/src/conversation_store.rs`、`src-tauri/src/dsh_driver.rs` 的用户可见报错文案与规格 delta 同步）
- [x] 4.3 跑绿依赖按钮文案的既有前端测试

## 5. 验证与归档准备

- [x] 5.1 `npm run check` 全绿（typecheck → lint → 前端/可靠性/驱动/校验测试 → build → fmt/clippy/test:rust；Rust 单测 531 过，仅既有真实链路测试按设计 ignored）
- [x] 5.2 五条文案-行为一致性抽查：A 文档讨论内问 B 文档仍以 A 为重点（automatic-story-context 规格：显式切换、下一轮生效）；非打开文档仅已保存正文可读（同规格＋agent-on-demand-reading）；链路库初始为空无预置（index.html:646 空态「还没有链路。」）；制作对话不读作品材料（making-conversation 规格）；导图为提示词组装结构图（making-module-page 规格＋导图 DOM）；四卡与 FAQ 文案经码点级比对与 design.md 附录一致
- [x] 5.3 产品负责人真机视觉验收：四卡向导、帮助分区、改名后的「新建讨论」按钮（2026-10-22 经七轮反馈迭代后真机验收通过：向导四卡、帮助抽屉＋11 条 FAQ＋官网链接、设置页三分区抽屉重设计、垂直居中、「新建讨论」改名）
- [x] 5.4 归档时人工修正 3 份归档规格 `## Purpose` 段残留的「新建对话」（delta 格式不覆盖 Purpose：`ai-panel-dom-contract`、`clear-current-ai-conversation`、`conversation-management`），确认合并后再修正（2026-10-22 合并完成后已修正，`openspec/specs/` 全目录「新建对话」零残留）

## 6. 验收反馈修订（2026-10-22 真机验收第二轮）

- [x] 6.1 卡 3／卡 4 文案：「连一次」易歧义，改为「完成 API 配置」
- [x] 6.2 新增 FAQ「API 是什么？怎么获取？」＋国内 AI 服务商官网直达链接八家（librarian 逐家核验 2026-10-22；锚点新窗口打开）
- [x] 6.3 帮助分区抽屉化：默认收起，点开见重看入口与 FAQ（index.html＋ui-v5.css）
- [x] 6.4 「新手引导」全面改称「软件引导」（界面／数据／规格／测试同步）

## 7. 验收反馈修订（2026-10-22 第三轮）

- [x] 7.1 设置页三分区统一抽屉：API 连接／写作显示／帮助同构、默认收起、左侧三角指示同款（index.html＋ui-v5.css；注：des-2 会话一次"上游失败"的重试实际已落盘全部改动，经 des-3 与 orchestrator 双重读文件核证：13 个表单 id 原样、settings-help 类保留、三抽屉均无 open 属性）
- [x] 7.2 「AI 连接」更名「API 连接」：界面标题＋说明文字；卡 4 与 FAQ 第 4 条指路同步（src 两份数据文件＋design.md 附录＋first-run-guide 规格措辞）；归档规格与历史原型文件经 grep 确认无波及、不改
- [x] 7.3 相关测试 44 项全绿（help-section／first-run-guide／dom-contract／llm-config-form／llm-config-state）；typecheck 退出码 0

## 8. 验收反馈修订（2026-10-22 第四轮）

- [x] 8.1 消除开抽屉时整页位移：根因为展开出现滚动条导致可用宽度突变（`scrollbar-gutter: stable` 预留宽度＋`overflow-anchor: none`，作用域限 #module-settings，不波及新建项目页；真机确认位移消除归入验收）
- [x] 8.2 设置页全部折叠三角移除（三分区抽屉／高级参数／发送哪些材料／FAQ 条目），可点性改悬停变色＋手形光标
- [x] 8.3 设置页页头（「连接与显示」眉标＋「设置」大标题）移除，页面身份由顶栏「设置」标签承载

## 9. 验收反馈修订（2026-10-22 第五轮）

- [x] 9.1 设置页整体视觉重设计：三分区从裸标题行升级为细边框设置项卡片（标题＋副说明入入口行、整行悬停反馈、展开内容统一边距与分组、次级折叠收框、帮助区整理），无箭头/三角、防抖与既有 token 保留（index.html＋ui-v5.css；观感由产品负责人真机裁决）

## 10. 验收反馈修订（2026-10-22 第六轮："太空"）

- [x] 10.1 设置页填空加密（仅 ui-v5.css）：版心 880→760px 居中；微灰页面底衬白色卡片、边框加强、标题 19px、卡片高度收至 96px；展开态统一"左标签右控件"行式表单（细线分隔）；帮助区行高与边距收紧；窄窗口单列回退；防抖与折叠标记隐藏规则保留，HTML 与文案逐字节未变

## 11. 验收反馈修订（2026-10-22 第七轮：垂直居中）

- [x] 11.1 三张设置卡片在设置模块内容区（页头以下，不含四页面标签栏）垂直居中：全部抽屉收起时居中（`:has()` 判定三个主抽屉均未展开＋flex 自动边距），任一展开即回顶部对齐自然下流（仅首次展开有一次位置切换）；水平 760px 版心、防抖规则、窄窗回退均保留（仅 ui-v5.css）
