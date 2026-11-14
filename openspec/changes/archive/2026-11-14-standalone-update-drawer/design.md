# Design：检查更新独立为设置页第四分区「软件更新」

## Context

`add-auto-updater`（2026-11-13 归档）把更新入口（「检查更新」按钮、状态行、版本号、「有新版」标记）放进设置页「帮助」抽屉内部。用户预想的是与「API 连接」「写作显示」「帮助」平级的**第四个独立抽屉**。本变更纯挪位：更新行为本身（启动静默检查、对话框、双重确认、下载转后台、安装前守卫）一概不动。

现状锚点：

- `index.html:591-608`：帮助抽屉（summary 含 `#help-update-badge` 与描述文案「重看软件引导，翻常见问题，查看版本、检查更新。」；body 内 `div.help-update` 含 `#btn-check-update`、`#help-update-status`、`#help-version`）。
- `src/dom.ts:240-254`：`HelpSectionDom` 契约混入四个更新字段（`checkUpdateBtn` / `updateStatus` / `versionText` / `updateBadge`），装配点 `dom.ts:770-776`。
- `src/help-section.ts:53-86`：`HelpUpdateEntry`＋`setupHelpUpdateEntry`。
- `src/main.ts:197-238`：`helpUpdateEntry` 接线（`onEntryState`、`renderVersion`、`startupCheck`）。
- `src/ui-v5.css:373-374`：`.help-update`（`margin-top:20px` 是帮助内与 FAQ 分隔用的）与 `.help-update-badge`。
- `tests/help-update-entry.test.ts`：断言入口在帮助分区内（含 id、summary 位置、摘要文案）。
- 设置页居中规则 `ui-v5.css:208` 泛化于任意 `.settings-drawer`，新增抽屉自动适配，无需改。

用户已拍板（2026-11-14）：① 分区名「软件更新」（与更新对话框标题同名，一个概念一个名字）；② 位序＝「帮助」之后第四个；③ 版本号随入口一并迁移。

## Goals / Non-Goals

**Goals:**

- 设置页第四个抽屉「软件更新」：版本号＋「检查更新」＋状态行，默认收起、样式与其余三抽屉一致。
- 「有新版」标记挪至新抽屉 summary（收起态可见、不弹窗、不抢焦点——呈现语义不变）。
- 「帮助」回退为重看引导＋FAQ；两处摘要文案、标记悬停提示同步修订。
- 修订两份规格真相源的入口位置措辞。

**Non-Goals:**

- 不改任何更新行为（检查、下载、安装、守卫、验签、发版流程）。
- 不改「帮助」其余内容（引导重放、FAQ 十一条）。
- 不新增能力概念、不动 Rust 后端。

## Decisions

### D1 分区构成与位序（文案定稿）

新抽屉插在「帮助」`</section>` 之后，结构复用 `settings-drawer` 模式：

```
<section class="setting-section" aria-label="软件更新">
  <details class="settings-update settings-drawer">
    <summary class="setting-intro">
      <h3>软件更新</h3>
      <span class="settings-description">查看当前版本，检查并安装新版本。</span>
      <span id="update-badge" class="update-badge hidden"
            data-hint="有新版本可用，展开软件更新分区查看详情">有新版</span>
    </summary>
    <div class="settings-drawer-body">
      <div class="update-section">
        <p class="form-help">检查是否有新版本；网络不便时也可以打开下载页手动下载。</p>
        <button id="btn-check-update" class="btn-secondary" type="button">检查更新</button>
        <p id="update-status" class="form-help hidden" role="status"></p>
        <p id="update-version" class="form-help"></p>
      </div>
    </div>
  </details>
</section>
```

- 「帮助」summary 描述回退为「重看软件引导，翻常见问题。」，删除 badge span 与 `div.help-update` 块。
- 抽屉内说明行文字不变（仍然准确）；标记悬停提示由「展开帮助分区查看详情」改为「展开软件更新分区查看详情」。
- 备选「把版本号留在帮助」被否：用户拍板随迁，且 `auto-update` 规格本就要求同分区显示。

### D2 DOM 契约拆分与 id 改名

`HelpSectionDom` 瘦身回 `first-run-guide-and-help` 形态（`replayBtn`＋`faqList`）；新增 `UpdateSectionDom`（`checkUpdateBtn` / `updateStatus` / `versionText` / `updateBadge`）；`AppDom` 显式新增 `updateSection: UpdateSectionDom` 并在装配对象中返回（现仅声明 `helpSection`，见 `dom.ts:417`）。元素已不属帮助，id 去掉 `help-` 前缀：

| 现id | 新id |
|------|------|
| `help-update-status` | `update-status` |
| `help-version` | `update-version` |
| `help-update-badge` | `update-badge` |
| `btn-check-update` | 不变（本就不带 help） |

改名理由：一个概念一个名字——元素迁出帮助后保留 `help-` 前缀会制造假归属；改动是纯机械替换，靠全仓 grep＋typecheck 兜底。

### D3 模块拆分

`help-section.ts` 回退为「引导＋FAQ」职责；更新入口装配整体迁出到新文件 `src/update-section.ts`：`UpdateEntry`（原 `HelpUpdateEntry`，接口不变）＋`setupUpdateEntry(dom: UpdateSectionDom, handlers)`（原 `setupHelpUpdateEntry`，行为逐行不变）。`main.ts` 接线改调新函数、注释里「帮助入口」措辞同步（`main.ts:197/236`）。

### D4 样式迁移

- `.help-update` → `.update-section`，去掉 `margin-top:20px`（分隔 FAQ 用的间距，独立抽屉内不再需要），flex/gap 布局保留。
- `.help-update-badge` → `.update-badge`，样式逐字不变（summary 层、收起态可见）。
- 抽屉外壳、summary、居中规则全部复用既有 `.settings-drawer` 体系，零新增视觉语言。

### D5 规格修订映射（归档时生效）

- `auto-update` MODIFIED 四条：
  1. 启动静默检查更新——「仅在设置页『帮助』入口呈现轻量更新标记」→「软件更新」分区入口；场景「帮助入口出现更新标记」同步。
  2. 手动检查更新入口——重写为：设置页 SHALL 设独立「软件更新」分区（第四个抽屉、位于「帮助」之后、默认收起），提供「检查更新」入口、当前版本号与可查看更新状态；承接原 `settings-help-section` 的「当前版本号如实显示」场景。
  3. 更新提示与双重确认——「点击帮助入口」→「点击软件更新分区入口」；场景同步。
  4. 下载与安装时序——「帮助分区 SHALL 提供可再次进入安装确认的入口」→「软件更新分区」；场景「经帮助分区入口」同步。
- `settings-help-section` MODIFIED 一条：设置页帮助分区的构成——删除「检查更新」入口、版本号显示、更新标记承担；「打开帮助抽屉」场景只留引导＋FAQ；其余三条更新相关场景移除（职责移交 `auto-update`）。
- FAQ 与首启引导无更新指路文案（已核 `help-faq-items.ts`、`first-run-guide-steps.ts`），不涉及。

### D6 测试修订

`tests/help-update-entry.test.ts` 重命名为 `tests/update-section-entry.test.ts`，断言改为：新分区是设置页第四个抽屉、位于帮助之后；`#update-badge` 在新分区 summary 内；负向断言覆盖**整个帮助分区**（非仅 summary）——无检查更新按钮、无版本号、无状态行、无 badge；并断言更新四元素在全设置页各出现一次（证明是搬出而非复制）；id 断言随 D2 改名。行为断言（点击回调、版本渲染、`setUpdateView` 三态）只换导入与函数名，逻辑不动。`tests/update-dialog.test.ts` 用自建 invoker，预计不受影响，跑全量确认。

## Risks / Trade-offs

- [id/class 改名漏改引用] → 全仓 grep `help-update|help-version|helpUpdateEntry|setupHelpUpdateEntry|HelpUpdateEntry` 清点后统一替换；`npm run check` 总门禁兜底。
- [抽屉数量变化影响设置页布局] → 居中与抽屉样式泛化于 `.settings-drawer`，新抽屉自动适配；真机目检确认四抽屉垂直居中与展开行为。
- [无声级联回归（2026-10-30 教训）] → badge 断言验 DOM 位置（summary 内）而非仅样式表文本；真机目检验浏览器计算结果（badge 实际渲染于新 summary、帮助 summary 无残留）。
- [挪位期间入口行为回退] → 装配函数逐行迁移不改逻辑；`update-dialog.test.ts` 全量跑绿佐证。

## Migration Plan

纯前端 UI 挪位，无数据、无存储格式变化，无回滚复杂度（还原文件即回滚）。一次 change 内完成，归档后两份规格同步修订。

## 验证口径

本变更不涉新窗口、插件权限、CSP、外部进程、文件对话框，不属于归档前强制 CDP 冒烟门类；验证＝`npm run check` 全绿＋`npm run tauri:dev` 真机轻量目检（四抽屉位序与收起态、badge 落位、检查更新点击打开对话框、帮助回退后内容完整）。
