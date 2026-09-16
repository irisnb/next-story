# 任务：Tiptap 2→3 安全迁移

> 执行顺序即依赖顺序：阶段一 → 冻结点 → 阶段二 → 收尾。冻结点（第 2 组）必须在切换 v3 之前完成——冻结预期代表迁移前行为，先冻结后升级。

## 1. 阶段一：安全垫底（2.27.2 → 2.27.3）

- [x] 1.1 package.json：19 个 `@tiptap/*` 包 2.27.2 → 2.27.3（精确锁版），并新增显式依赖 `@tiptap/pm@2.27.3`，消灭幻影依赖
- [x] 1.2 安装依赖，审阅 package-lock.json 差异，确认除 @tiptap 区块外无无关依赖被顺手抬升
- [x] 1.3 全量验证：`npm run check` 全绿（typecheck / lint / 前端测试 / 可靠性 / 驱动 / 构建 / Rust）
- [x] 1.4 写告警豁免记录（两洞编号、2.27.3 已含代码级修复的源码比对证据、告警库未收录说明），并提示用户在 GitHub 按记录处置两条 Dependabot 警报
- [x] 1.5 按 git-master 规范提交阶段一

## 2. 冻结点：金样本基础设施（仍在 2.27.3 上）

- [x] 2.1 devDependencies 增加 happy-dom（仅测试用，不进生产依赖）
- [x] 2.2 建 A 层语料：覆盖格式版本 2 grammar 全部结构与边界的合成文档集——全部块类型、六级标题、全部 marks（含 textStyle 三属性组合）、段落属性全集、嵌套列表、有序列表非 1 起始、空文档、首尾与连续空段落、链接在文本边界、相邻异格式文本、中文与 emoji 内容；全部为合成内容
- [x] 2.3 建 A 层测试：headless Editor（`element: null`）装载 → `getJSON` → `canonicalDoc`，与冻结预期逐字节相等且通过 grammar 校验；冻结预期文件由当前 v2 管线生成
- [x] 2.4 建 B 层粘贴样本：成对 (html, text/plain) 样本覆盖代表性路径（格式映射、嵌套列表重建、表格降级、br 拆分、整次拒绝路径），`parseHtmlToBlocks` 注入 happy-dom 的真实 DOMParser
- [x] 2.5 建 B 层测试：`decidePasteAction` → `insertContent` 注入代表性位置（空文档、同格式段落中部、异格式边界、列表项内）→ `canonicalDoc` 与冻结预期相等；冻结预期由当前 v2 管线生成
- [x] 2.6 建 URL/autolink 用例：事务插入 URL 文本后断言链接 mark 范围，冻结 v2 预期
- [x] 2.7 全量验证全绿，按 git-master 规范提交冻结点（语料 + 测试 + 冻结预期文件）

## 3. 阶段二：全量迁移（2.27.3 → 3.31.3）

- [ ] 3.1 包集重组：保留包全部升至 3.31.3；移除三个列表包与 `extension-history`，新增 `@tiptap/extension-list@3.31.3` 与 `@tiptap/extensions@3.31.3`；`@tiptap/pm@3.31.3` 与 core 同版
- [ ] 3.2 import 改写：`rich-text-editor.ts`（列表三包改 `@tiptap/extension-list` 命名导出、History 改 UndoRedo、Link 显式 `autolink: true`）；`list-numbering.ts` 裸 `prosemirror-*` 类型 import 改 `@tiptap/pm/*`；核对 `find-replace.ts`、`editor-extensions.ts`（不引入 TextStyleKit，保留自研 FontSize）
- [ ] 3.3 修补 v3 更严类型带来的 tsc 新错（机械修补，不改行为）
- [ ] 3.4 依赖树核验（对应规格验收）：`@tiptap/pm` 解析的 prosemirror-view ≥ 1.42.3 且全树单一版本；package.json 无裸 `prosemirror-*` 声明
- [ ] 3.5 金样本回归：A 层 + B 层 + URL 用例全部对冻结预期通过；出现差异按设计 R1/R2 处置——仅内核内部结构差异可记录理由后放行，规范形态差异或 linkifyjs 边界差异立即阻塞并上报用户决策
- [ ] 3.6 全量验证：`npm run check` 全绿
- [ ] 3.7 真机手工清单（`tauri:dev`，与用户一起过）：中文输入法组合输入、从网页与 Word 粘贴、粘贴为纯文本（Ctrl+Shift+V）、拖入文字与图片、查找替换全流程（高亮/上下导航/替换单个/全部/可撤销）、链接弹层三动作与 http/https 限制、有序列表拆分保号、撤销重做、导出 Word、约 20 万字大文档烟测（输入延迟与内存体感）
- [ ] 3.8 按 git-master 规范提交阶段二

## 4. 收尾

- [ ] 4.1 确认 GitHub Dependabot 两条 `@tiptap/core` 警报已消除；豁免记录转为历史备注
- [ ] 4.2 同步更新 `方向/全量地基审计-2026-09-14.md` 第八节 5b 行状态与处理进度摘要
- [ ] 4.3 `openspec` 严格校验通过，具备归档条件
