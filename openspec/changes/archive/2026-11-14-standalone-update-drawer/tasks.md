## 1. 前端结构挪位（index.html）

- [x] 1.1 「帮助」抽屉：summary 描述回退为「重看软件引导，翻常见问题。」、删除 `#help-update-badge` span；body 删除 `div.help-update` 整块
- [x] 1.2 新增第四分区「软件更新」（`section[aria-label="软件更新"]` > `details.settings-update.settings-drawer`，位于帮助之后）：summary 含 h3、描述「查看当前版本，检查并安装新版本。」、`#update-badge`（data-hint「有新版本可用，展开软件更新分区查看详情」）；body 含说明行、`#btn-check-update`、`#update-status`（role="status"）、`#update-version`（结构见 design D1）

## 2. 契约与模块拆分（dom.ts / update-section.ts / main.ts）

- [x] 2.1 `src/dom.ts`：`HelpSectionDom` 瘦身为 `replayBtn`＋`faqList`；新增 `UpdateSectionDom`（`checkUpdateBtn` / `updateStatus` / `versionText` / `updateBadge`）；`AppDom` 显式新增 `updateSection: UpdateSectionDom` 并在装配对象中返回；装配点按新 id 改（`update-status` / `update-version` / `update-badge`）
- [x] 2.2 新建 `src/update-section.ts`：迁入 `HelpUpdateEntry`→`UpdateEntry` 与 `setupHelpUpdateEntry`→`setupUpdateEntry`，行为逐行不变；`src/help-section.ts` 删除更新入口相关导出与注释
- [x] 2.3 `src/main.ts`：接线改 `setupUpdateEntry(dom.updateSection, …)`；`main.ts:197/236` 注释「帮助入口」措辞改「软件更新分区入口」
- [x] 2.4 全仓 grep `help-update|help-version|helpUpdateEntry|setupHelpUpdateEntry|HelpUpdateEntry` 清点并替换残留引用（含注释）；中文旧归属措辞一并清理：`src/update-dialog.ts` 注释（:5/:62/:108）、`tests/update-dialog.test.ts` 注释与断言说明（:373/:767）、`src/ui-v5.css:206` 居中注释「三个主抽屉」、`scripts/release.mjs:688` 发版说明示例「帮助」改「软件更新」（仅示例文案，不动发版逻辑）

## 3. 样式迁移（ui-v5.css）

- [x] 3.1 `.help-update` → `.update-section`（去 `margin-top:20px`，flex/gap 保留）；`.help-update-badge` → `.update-badge`（样式逐字不变）；注释同步改指「软件更新」分区

## 4. 测试修订

- [x] 4.1 `tests/help-update-entry.test.ts` 重命名为 `tests/update-section-entry.test.ts`：结构断言改为「第四抽屉位于帮助之后、badge 在新分区 summary 内」；负向断言覆盖整个帮助分区（非仅 summary）——无检查更新按钮、无版本号、无状态行、无 badge；并断言更新四元素（按钮／状态行／版本号／badge）在全设置页各出现一次（证明是搬出而非复制）；id 断言随新名；行为断言换导入与函数名、逻辑不动
- [x] 4.2 跑 `node --test tests/update-dialog.test.ts` 与 `tests/help-section` 相关既有测试，确认无连带破坏

## 5. 门禁与真机目检

- [x] 5.1 `npm run check` 总门禁全绿（typecheck→lint→前端/可靠性/驱动/校验测试→build→fmt→clippy→Rust 全量测试）
- [x] 5.2 `npm run tauri:dev` 真机轻量目检并记录：设置页四抽屉位序与默认收起、垂直居中不因第四抽屉破坏；「软件更新」展开见版本号＋检查更新，状态行有状态时显示、无状态时隐藏不占位；点击「检查更新」打开对话框；「帮助」展开只剩引导＋FAQ、summary 无 badge；验浏览器计算结果（badge 实际渲染于新 summary，非仅样式表文本）

## 6. 归档

- [x] 6.1 用户确认目检结果后走归档流程：两份规格（`auto-update`、`settings-help-section`）按 delta 修订入真相源，验证记录归档
