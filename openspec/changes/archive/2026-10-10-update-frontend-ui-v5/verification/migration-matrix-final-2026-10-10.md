# 迁移清单矩阵（final，2026-10-10）

范围：change `update-frontend-ui-v5`。用途：为 tasks **1.3（迁移清单＋三尺寸基线）** 与 **6.3（清理＋入口可达真实）** 提供逐项证据；每项标注「自动已验证」与「真实/用户未验」。仅文档，未改源码/规格。

依据：最新 src handler（本 lane 只读核对）＋ `tests/` ＋ `verification/`（`final-cleanup-check-2026-10-10.md`=FC、`v5-parity-pages-screens/`、`v5-menu-screens/`、`ui-cleanup-final-2026-10-10.md`、`restart-isolation-2026-10-10.md`、`ai-panel-state-single-panel-2026-10-10.md`）。

## 迁移矩阵

| # | 入口 | 正式 handler（src） | 测试 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 首页最近项目（仅前三） | `src/dom.ts`（recent 渲染/截断）；打开走 `src/project-api.ts openProject` | `recent-works.test.ts`、`workspace-project-flow.test.ts`、`new-project-form-release.test.ts` | 自动已验证；真实文件框/路径缺失流程→**7.5/7.6 未验** |
| 2 | 顶栏四页切换＋保存 | `index.html` tabs；`src/dom.ts`（tab-writing…module-writing）；保存 `src/editor.ts`+`src/project-api.ts saveDocument` | `dom-contract.test.ts`、`views.test.ts`、`editor-save-state.test.ts`、`workspace-project-flow.test.ts` | 自动已验证；用户真实点击/视觉→**7.3 未验** |
| 3 | 编辑器格式/编号/链接/宽度/留白（无图片） | `src/rich-text-editor.ts`、`src/editor-toolbar.ts`、`src/editor-column-width.ts`、`src/editor-margin.ts`、`src/editor-link-popover.ts` | `format-commands.test.ts`、`format-command-behavior.test.ts`、`editor-link-popover.test.ts`、`editor-margin.test.ts`、`editor-layout-style.test.ts`、`controlled-paste.test.ts`、`rich-text-editor.test.ts` | 自动已验证；**图片插入入口 0 命中**（不新增）；非空选区真机格式/链接动作→**4.1/7.5 未验** |
| 4 | 工具栏省略收纳/回流＋就近菜单 | `src/ui-v5.ts`、`src/editor-toolbar.ts` | `ui-v5.test.ts`、`editor-toolbar.test.ts`；`v5-menu-screens/` | 自动+CDP 打开已验；实际格式变更动作→**7.5 未验** |
| 5 | 发送彩蛋 PNG | `src/assets/user-mark.png`、`src/ui-v5.css` | `ui-send-mark.test.ts`；`ui-cleanup-final`（SHA/alpha/尺寸/状态/native） | 自动+真机已验（禁用/启用/focus 72×32、图案28×22.3594） |
| 6 | AI 单投影＋divider＋runtime | `src/ai-panel-state.ts`（`openDiscussionIds`/`selectDiscussion`）、`src/ai-dock.ts`（divider）、`src/ai-window.ts` | `ai-single-projection.test.ts`、`ai-panel-dom-contract.test.ts`、`ai-runtime-independence.test.ts` | 自动已验证；真实模型链路→**7.4 未验** |
| 7 | 文档管理可见性/回收站 | `src/file-management.ts`（`setDocumentAiVisibility`、`restoreNode`、`fmRecycleBin`/`fmRecycleList`） | `file-management.test.ts` | 自动已验证（含失败回原）；影响确认/旧讨论只读/脱敏真机→**7.5 未验** |
| 8 | 3 导入 / 3 导出 | `src/document-import.ts`、`src/export.ts`、`src/project-api.ts` | `document-import.test.ts`、`project-api-document-import.test.ts`、`export.test.ts`、`project-api-export.test.ts` + Rust `src-tauri` 三格式用例 | 自动接线已验证；真实文件产生/读取（Word/PDF/MD、DOCX/MD/FDX）→**7.5 未验** |
| 9 | 设置高级参数与密钥掩码 | `src/llm-config-form.ts`（`KEY_MASK`、`MAX_TOKENS_LIMIT`）、`src/llm-config-state.ts` | `llm-config-form.test.ts`、`llm-config-state.test.ts` | 自动已验证；真实连接测试→**7.4/7.5 未验** |
| 10 | 制作卡/试问/空库口述 | `src/making/making-module.ts`、`making-conversation.ts`、`making-trial.ts`、`making-session-controller.ts` | `making-module.test.ts`、`making-conversation.test.ts`、`making-trial.test.ts`；空库 `making-unbound`＋`restart-isolation` | 自动已验证；正向 enabled/有内容导图安全证据→**5.4/5.5 未验** |
| 11 | 应用图标 8 帧 | `scripts/generate-icons.mjs`、`src-tauri/icons/icon.ico` | `icon-diagnosis.mjs`；FC | 自动+包产物已验（EXE/NSIS/MSI 8 帧逐帧匹配） |

## 三尺寸真实基线（1.3）

- `verification/v5-bounded-final-2026-10-10.md`：真实 `Tauri Window` 原生三档 1024×670 / 1280×720 / 1440×900，client==WRY==页面视口，max/restore 通过（旧「未驱动」结论系脚本取错 HWND，已更正）。
- `verification/v5-parity-pages-screens/`、`v5-parity-screens/`、`v5-menu-screens/`、`v5-native-graph-screens/`、`ui-cleanup-screens/` 提供四页/边栏/菜单/导图/发送态截图与 `evidence.json`。

## 清理确认（6.3）

- **演示/mock**：`src/**` 与 `index.html` 无演示数据标记（0 命中）。
- **旧窗口/旧几何**：`WindowPlacement`/`set_window_placement`/`reset_layout`/`focus_window`/`close_window` 在 `src/` 零命中；`index.html` 旧 sprite `i-float/i-grip/i-dock/i-sbs` 精确 id 0 命中；`ai-window-docked`→`ai-discussion-projection`。
- **重复事件/陈旧入口**：旧几何事件 case 与测试已删/改写（`ai-panel-state-single-panel`）。
- **保留非死代码（不得再迁移）**：`src/styles.css` 的 `ai-window` 结构与当前分隔条（divider）仍为 live 消费（单面板最大化/调宽），非死代码；不当作旧视觉继续清理。

## 结论

- 每个入口均有**真实 handler 接线**（非演示），并有对应测试；1.3 所需「迁移清单＋三尺寸真实基线」与 6.3 所需「清理＋入口真实可达」的**自动部分**成立。
- 各入口的**真实/用户/模型/安装**验证分别归 7.2–7.6 与 4.1/5.3/5.4/5.5，仍未完成。
