# 提案：Tiptap 2→3 安全迁移（审计队列 5b）

## Why

编辑器内核 Tiptap 当前锁在 2.27.2，包含两个已公开安全漏洞：GHSA-cp6q-959q-f8rh（`mergeAttributes` 原型污染，medium）与 GHSA-c8x8-7fp4-3x9w（prosemirror-view 粘贴 XSS，high，修复于 prosemirror-view 1.42.3）。本项目自研粘贴管线全量拦截外部粘贴，两洞实际可利用性低，但带洞代码随软件分发，且 GitHub 告警库不认 2.27.3 为修复版，红灯将长期亮到升级 3.x，掩盖未来真实警报。这是全量地基审计（`方向/全量地基审计-2026-09-14.md` 第八节队列 5b，补充六情报更新）确定的下一开工项：P0 已 5/5 清零，本 change 是阶段 6（Agent 按需补读）开工前最后一个安全整备项。

## What Changes

一个 change、两个阶段串行执行，全部完成后一次归档：

**阶段一：安全垫底（2.27.2 → 2.27.3）**
- 19 个 `@tiptap/*` 包从 2.27.2 升至 2.27.3（该版已含两洞的代码级修复：core 的 `__proto__` 防护、`@tiptap/pm` 顺带升至 prosemirror-view ^1.42.3）。
- 在 package.json 显式声明 `@tiptap/pm`（当前三处 import 它但从未声明，属幻影依赖）。
- 记录告警豁免：在仓库内书面记录"两洞已由 2.27.3 代码级修复、告警库未收录"的评估与理由；GitHub Dependabot 警报按此处置。豁免在阶段二完成后自然失效。

**阶段二：全量迁移（2.27.3 → 3.31.3）**
- 包集重组：列表三包（bullet-list / ordered-list / list-item）合并为 `@tiptap/extension-list`；`extension-history` 由 `@tiptap/extensions`（UndoRedo）取代；`@tiptap/pm` 升 3.31.3 并保持显式声明。**目标必须 ≥ 3.31.2**（prosemirror-view 1.42.3 修复自 3.31.2 才进入依赖锁，3.30.4 / 3.31.0 / 3.31.1 均带洞），定 3.31.3。不使用过渡桩包，直接改干净 import。
- 建立金样本回归（本项目此前没有任何真实编辑器实例的自动化测试）：
  - **A 层·序列化金样本**：覆盖全部格式版本 2 结构的合成文档语料，在 v3 编辑器装载→读出→规范化序列化后与冻结预期逐字节相等，证明存量用户文档不受迁移影响。
  - **B 层·行为金样本**：粘贴 HTML 样本→自研白名单→`insertContent` 注入→读出文档 JSON 与冻结预期相等。v3 唯一确认的行为变化（`insertContent` 不再拆分开头文本节点）正落在此路径，必须锁定。
- 三个脆点专项回归：自研 FindReplace 插件（`@tiptap/pm` 的 Decoration / PluginKey / TextSelection 用法）、受控粘贴白名单、链接位置计算（`linkHrefAt` 手写遍历 + `extendMarkRange` 命令）。
- `list-numbering.ts` 的裸 `prosemirror-model` / `prosemirror-state` 类型 import 改走 `@tiptap/pm/*` 单一入口。
- 不改变任何用户可见行为：`autolink` 显式保持开启（维持 v2 以来现状）、粘贴白名单映射不变、序列化格式版本 2 不变、撤销重做命令名不变。
- 真机手工检查清单（无 E2E 框架的既有缺口内）：中文输入法组合输入、从网页/Word 粘贴、拖放、查找替换、链接弹层、有序列表拆分编号、撤销重做、导出 Word。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `production-editor-kernel`: 新增两条需求——①内核依赖治理（ProseMirror 只经 `@tiptap/pm` 单一入口引入、全部 `@tiptap/*` 精确锁版、迁移完成后版本下限 ≥ 3.31.2）；②内核升级以金样本锁定兼容性（存量文档 A 层逐字节往返 + 粘贴行为 B 层冻结比对，作为内核相关改动的前置回归门禁）。

## Impact

- **依赖**：package.json 的 `@tiptap/*` 区块整体重写（19 包 → 17 包左右，含合并与新增 `@tiptap/extensions`），package-lock.json 大改；前端依赖树内 prosemirror-* 全部版本抬升。
- **代码**：`src/rich-text-editor.ts`（import 与扩展注册）、`src/find-replace.ts`（import 路径核对）、`src/editor-extensions.ts`（addGlobalAttributes 兼容核对）、`src/list-numbering.ts`（裸 import 改道）；`src/controlled-paste.ts` 逻辑不变、仅测试注入面扩展。
- **测试**：新增金样本测试文件与冻结语料；现有 751 项前端测试全部必须继续通过；类型更严可能产生机械修补。
- **不受影响**：Rust 后端、AI 链路（sidecar / driver / 会话）、作品存储格式、导出链路（docx）；本 change 不触碰 `structured-notebook-storage` 的格式版本 2 grammar。
- **范围外记录**：`production-editor-kernel` 中"生产写作区使用 Tiptap 基础富文本内核"需求仍含格式版本 1 时代的范围表述（禁链接/下划线/三级以上标题等），与 `structured-notebook-storage` 版本 2 grammar 及 `text-links` 矛盾——存量规格失真，留队列 8 批量治理，本 change 不顺手改写。
