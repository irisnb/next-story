# 讨论存储重构·真机验证记录（CDP 模拟真实用户操作）

> 2026-09-25。用户委托"模拟真实用户操作、在前端操作"；本记录整理该轮执行的场景、证据与结论。
> 构建为工作区未提交状态（含 change 全部代码与两处验证修复）；未提交、未推送、未归档。

## 一、方法与环境

- **方法（项目既有惯例）**：release 测试版 + WebView2 调试通道（`--remote-debugging-port=9222`）+ CDP 真实鼠标/键盘事件驱动（仪器 `driver.mjs`，复制自 2026-09-22 `app-real-chain-validation` 版本，本目录内增补 `hoverClick` / `clickAt` / `ctrlA` 三个命令）。全部 UI 操作为真实输入事件；DOM 查询只读；未注入应用状态、未直接调用 IPC。
- **控制台采集**：页面内收集器（`window.__nsErrors`，挂 console.error / window error / unhandledrejection），会话结束时读取。
- **构建**：`npm run tauri -- build --no-bundle`，产物 `src-tauri/target/release/next-story.exe`，写于 2026-09-25 00:55:51，SHA256 `5A09DD000A80E350D784D983B07E21C6DAD13997BBF1B8423C22144E82A10184`。WebView2 运行时 UA `Edg/153.0.0.0`（Chrome 153）。
- **测试作品**：`C:\Users\Administrator\Desktop\test\存储验收-合成-20260925`（"8b 验证作品"副本；**仅操作副本**；副本内部作品名仍显示"8b 验证作品"，系复制未改名所致）。副本为改造前格式：8 条讨论、无 `.meta.json`——用于验证小票惰性迁移。
- **最近作品**：`%LOCALAPPDATA%\com.nextstory.desktop\recent-works.json` 已备份为 `.backup-20260925`。
- **打开方式**：欢迎页最近作品点击（无原生对话框路径）。

## 二、场景与结果（六组全过）

| # | 场景（模拟用户操作） | 结果 | 关键证据 |
|---|---|---|---|
| S1 | 打开作品：欢迎页 → 点最近作品 → 会话列表加载 | PASS | 打开前 `.meta.json` = 0；列表加载后 = 8（惰性迁移）；小票内容与契约逐字段一致（`body_bytes` / 两类引用索引 / 降级标记）；`shots/s01-workspace.png`、`s02-list.png` |
| S2 | 打开讨论（按需读档路径） | PASS | 点击条目即捕获"正在打开"提示（`true`）；窗口渲染标题与关注文档与已保存轮次；`shots/s03-open.png` |
| S3 | 重命名未打开讨论（窄更新） | PASS | 列表显示新标题；磁盘：正文 `title` 与小票 `custom_title` 同步更新；**小票 `body_bytes=2718` 与正文实际字节数完全一致**；`shots/s05/s06/s07` |
| S4 | 删除 + 撤销（软删除/回收区） | PASS（提示缺口见 A/B 节） | 删除：正文+小票成对移入 `.trash/`、列表移除、迟到保存墓碑语义保持；撤销：文件对移回、讨论恢复并重开；`shots/s08–s11` |
| S5 | 关闭"手记篇"AI 可见性 → 锁存 | PASS | 恰好 5 个"普通出处引用该文档"的讨论正文被置 `revoked`（磁盘逐一核对）；**唯一只含补读出处的讨论未被锁存**（F03 范围边界成立）；列表受限行脱敏；`shots/s14/s15`。关闭前影响确认弹窗未出现——归因见 C 节 |
| S6 | 重启应用 → 打开作品 | PASS（脱敏缺陷见 A 节） | 打开作品时回收区清空（两对已删文件被清除）；重命名标题持久；受限行脱敏（修复后）；列表从小票加载；`shots/s16/s17/s18` |

## 三、本轮发现与处理

### A（P0，本次改造引入；已修复并重验）：重启加载路径受限判定失效、列表脱敏丢失

- **现象**：锁存后会话内列表正确脱敏；**重启后重新加载，5 个已锁存讨论全部显示真实文档名**（小票 `provenance_has_revoked: true` 已持久化却未被采纳）。
- **根因**：`isConversationMaterialRestricted` 用 `!("version" in record)` 区分摘要/完整档案；但后端 IPC 摘要**实际带 `version`**（Rust `ConversationSummary`），而 TS 接口未声明该字段——类型检查与既有测试（测试摘要不含 version）均不报警。摘要遂走"完整档案"分支，把 `string[]` 引用当 `MaterialProvenance[]` 遍历，判定恒假。会话内的正确脱敏来自锁存事件直接置位，绕过了该函数。
- **修复**：改用摘要独有字段判别（`"provenance_has_revoked" in record`）；新增 11 项回归测试（含"后端真实形状摘要：version 在场 + 字符串引用 + 锁存标记 → 首次加载即受限并脱敏"）；前端测试 1063 → 1074。
- **重验**：重建后重启打开作品 → 5 个受限行全部"（已隐藏的文档）"、非受限行正常；`shots/s18-masked-after-restart-fixed.png`；控制台零错误。

### B（P1，显示缺口一半既有、一半本次改造；已修复并重验）：撤销提示不出现 / 不消失

- **现象**：删除后提示不出现，直到下一次无关状态变化才出现（实测：删除后点开另一条讨论才出现）；撤销成功后提示不消失；超时后不消失。
- **根因**：提示数据是 `ai-feature-delete-undo.ts` 模块局部变量，置入/清除均不经过状态层；停靠区只在 `state.subscribe(sync)` 渲染。旧实现已存在"显示缺口"；本次改造把 `clearUndo()` 移到成功路径末尾且无后续渲染触发，新增"残留 / 超时不消失"缺口。
- **修复**：状态层新增无业务数据的渲染失效事件 `undo_notice_changed`（reducer 返回新引用以触发订阅渲染）；提示创建、实际清除（撤销成功 / 删除前清理旧提示）与超时清除三处通知；停靠区与对外接口不变；补回归测试。
- **重验**：删除后 +600ms 提示即出现（无额外交互，文案"已删除「…」撤销"）；撤销后提示消失、讨论恢复（12 文件、回收区空）；超时 6 秒后提示自动消失（7 秒断言）；`shots/s19–s21`；控制台零错误。

### C（既有缺陷，**不在本 change 范围**，登记并建议单独立项）：原生确认/提示弹窗在应用内全部失效

- **现象**：关闭文档 AI 可见性前的影响确认、删除未保存文档的确认、各失败路径 `alert` 均**不显示**；`window.confirm` 处直接放行（受影响操作在无用户确认下执行）。
- **机理（源码级定位）**：`tauri-plugin-dialog 2.7.1` 向 WebView 注入 `init-iife.js`，把 `window.confirm` 覆写为**异步**实现（返回 Promise，调 `plugin:dialog|confirm`）、`window.alert` 覆写为调 `plugin:dialog|message`；而 `src-tauri/capabilities/default.json` 仅授权 `dialog:allow-open` / `dialog:allow-save`，**缺 `dialog:allow-confirm` / `dialog:allow-message`** → 命令被 ACL 拒绝（控制台未处理拒绝：`Command plugin:dialog|confirm not allowed by ACL` 实测捕获 2 条）；调用方（`file-management.ts:265`、`editor.ts:46-48`）按同步布尔使用 → `!Promise` 恒为假 → 守卫被跳过。引入时间不晚于 2026-08-25（Word 导出变更带入插件），与本次改造无关。
- **建议**：单独立项——补齐 ACL 授权并把调用点改为 `await` 语义（或改走插件导出的 `confirm` API），恢复各确认路径并纳入真机验证。

## 四、边界与未验事项

- 未发起任何真实模型生成（无 AI 请求、无网络/密钥依赖）；补读授权流、生成轮次保存等 AI 路径不在本轮范围。
- 未测试原生微软拼音/IME、导出、作品新建/切换等无关路径；多窗口矩阵（并排/浮动）未在本轮展开。
- C 项弹窗被 ACL 拦截，本轮只完成机制定位；人工点击原生对话框路径未验（其本身即当前缺陷）。
- 测试副本遗留状态（如实记录）：8 条讨论中 1 条（`mudl6fu7`）处于"删除待清理"（文件在 `.trash/`，下次打开作品时清除）；5 条被"手记篇"锁存为永久受限；1 条已重命名为"存储验收-重命名测试"。原"8b 验证作品"未修改。

## 五、控制台

- 最终会话：`window.__nsErrors = []`（零 console.error、零未处理拒绝）。
- 首会话（修复前）：仅在触发 C 项（关闭可见性确认 / 弹窗行为探测）时出现 2 条 ACL 未处理拒绝，已归因并记录于 C 节；正常流程（S1–S6）未产生其他错误。
