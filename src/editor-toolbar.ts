// 工具栏与格式抽屉：格式命令按钮、段落样式、格式抽屉开关/折叠/自动隐藏、
// 留白与写作宽度预设档位与持久化。只依赖工具栏/抽屉 DOM 节点与编辑器窄能力
// （getSelection/getDocument/runCommand/canUndo/canRedo），不依赖完整编辑器控制器。

import type { JSONContent } from "@tiptap/core";
import { linkHrefAt } from "./editor-link-actions.ts";

import type { AppDom } from "./dom.ts";
import {
  analyzeSelection,
  orderedListStyleState,
  type FormatCommand,
  type TriState,
} from "./format-commands.ts";
import { canonicalDoc, type OrderedListStyle } from "./structured-notebook.ts";
import {
  DEFAULT_MARGIN_PRESET,
  nextMarginPreset,
  readMarginPreset,
  writeMarginPreset,
  type MarginPreset,
} from "./editor-margin.ts";
import {
  DEFAULT_COLUMN_WIDTH_PRESET,
  nextColumnWidthPreset,
  readColumnWidthPreset,
  writeColumnWidthPreset,
  type ColumnWidthPreset,
} from "./editor-column-width.ts";
import type { StorageLike } from "./shared-storage-and-selection-identity.ts";

const MARGIN_LABELS: Record<MarginPreset, string> = {
  compact: "紧凑",
  standard: "标准",
  loose: "宽松",
};

const COLUMN_WIDTH_LABELS: Record<ColumnWidthPreset, string> = {
  narrow: "窄 · 640",
  standard: "标准 · 720",
  wide: "宽 · 860",
};

/** 编号样式子菜单的五值（与有序列表按钮旁 flyout 的 data-style 一一对应）。 */
const ORDERED_LIST_STYLE_VALUES: readonly OrderedListStyle[] = ["1", "A", "a", "I", "i"];

/** 编号样式的中文名（子菜单状态行与触发器提示共用）。 */
const ORDERED_LIST_STYLE_LABELS: Record<OrderedListStyle, string> = {
  "1": "数字",
  "A": "大写字母",
  "a": "小写字母",
  "I": "大写罗马",
  "i": "小写罗马",
};

const DRAWER_CLOSE_DELAY_MS = 350;

/** 工具栏模块所需的编辑器窄能力。 */
export interface ToolbarEditorCapabilities {
  getSelection(): { from: number; to: number };
  getDocument(): JSONContent;
  runCommand(command: FormatCommand): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface EditorToolbarDeps {
  dom: Pick<
    AppDom,
    | "paragraphStyle"
    | "btnBold"
    | "btnItalic"
    | "btnToolbarUnderline"
    | "btnToolbarStrike"
    | "btnBulletList"
    | "btnOrderedList"
    | "btnOrderedListStyle"
    | "orderedListStyleMenu"
    | "orderedListStyleCurrent"
    | "orderedListStyleItems"
    | "btnUndo"
    | "btnRedo"
    | "btnMargin"
    | "btnColumnWidth"
    | "editorPage"
    | "btnFormatDrawer"
    | "formatDrawer"
    | "btnFormatDrawerClose"
    | "btnToggleCharacterSection"
    | "btnToggleParagraphSection"
    | "btnUnderline"
    | "btnStrike"
    | "selectFontFamily"
    | "selectFontSize"
    | "inputTextColor"
    | "btnClearTextColor"
    | "inputHighlight"
    | "btnClearHighlight"
    | "btnClearCharacterFormat"
    | "btnAlignLeft"
    | "btnAlignCenter"
    | "btnAlignRight"
    | "btnAlignJustify"
    | "selectLineHeight"
    | "selectSpacingBefore"
    | "selectSpacingAfter"
    | "selectTextIndent"
    | "selectIndentLeft"
    | "selectIndentRight"
    | "btnClearParagraphFormat"
  >;
  /** 返回当前编辑器窄能力；无编辑器时为 null。 */
  getEditor(): ToolbarEditorCapabilities | null;
  /** 留白偏好存储；null 时回退默认档位且不持久化。 */
  marginStorage: StorageLike | null;
  /** 写作宽度偏好存储；null 时回退默认档位且不持久化。 */
  columnWidthStorage: StorageLike | null;
}

export interface EditorToolbar {
  /** 根据当前选区与文档刷新全部工具栏/抽屉控件状态。 */
  render(): void;
  /** 执行格式命令并刷新工具栏；无编辑器时返回 false。 */
  runFormatCommand(command: FormatCommand): boolean;
  /** 仅当存在文字选区时执行格式命令；anchor 为触发控件（不可用时供原因提示定位）。 */
  runSelectionCommand(command: FormatCommand, anchor?: HTMLElement): void;
  /** 移除全部监听并清理抽屉自动隐藏定时器。 */
  dispose(): void;
}

export function createEditorToolbar(deps: EditorToolbarDeps): EditorToolbar {
  const { dom } = deps;
  let marginPreset: MarginPreset = DEFAULT_MARGIN_PRESET;
  let columnWidthPreset: ColumnWidthPreset = DEFAULT_COLUMN_WIDTH_PRESET;
  let drawerCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup: Array<() => void> = [];

  function bind(element: HTMLElement, type: string, listener: () => void): void {
    element.addEventListener(type, listener);
    cleanup.push(() => element.removeEventListener(type, listener));
  }

  /** 带事件参数的绑定（Escape 等键盘交互）；与 bind 同一清理通道。 */
  function bindEvent<E extends Event>(
    element: HTMLElement,
    type: string,
    listener: (event: E) => void,
  ): void {
    const handler = listener as (event: Event) => void;
    element.addEventListener(type, handler);
    cleanup.push(() => element.removeEventListener(type, handler));
  }

  function pressedValue(state: TriState): string {
    return state === "on" ? "true" : state === "off" ? "false" : "mixed";
  }

  /**
   * 工具不可用态（fix-tooltip-rule-ownership D3，2026-10-30 用户拍板 C「亮着＋点击
   * 给提示」修订）：按钮不置原生 disabled（会掐断事件、剥离提示——功能不可发现），
   * 改置 `aria-disabled="true"`；外观与启用态完全一致（图标亮着、悬停反应正常，
   * 不变灰/半透明——首版复刻 :disabled 灰视觉已被用户验收否决）；点击/键盘由
   * 处理器入口守卫拒绝并给原因提示（notifyUnavailableHint）。清除时摘除标记。
   */
  function setToolUnavailable(element: HTMLButtonElement, unavailable: boolean): void {
    element.disabled = false;
    if (unavailable) element.setAttribute("aria-disabled", "true");
    else element.removeAttribute("aria-disabled");
  }

  /** 选区依赖工具统一的原因提示文案（D3 C 案，用户拍板统一口径）。 */
  const NEED_SELECTION_HINT = "先选中文字再用";

  /**
   * 不可用工具点击/键盘触发的简短原因提示（D3 C 案）：经 window 自定义事件
   * `ns-toolbar-hint`（detail＝`{ text: 原因, anchor: 触发按钮 }`）送共享提示层短暂
   * 呈现——事件解耦，避免工具栏模块反向依赖展示层（ui-v5.ts 监听并驱动
   * #ui-tooltip）。anchor 供提示层按按钮矩形定位（3.9：编辑器工具按钮 mousedown
   * 阻止抢焦点保选区，点击后 activeElement=BODY，故显式传锚，不猜聚焦元素）。
   * 禁止静默无响应；无 window 环境（node 单测桩）静默跳过。
   */
  function notifyUnavailableHint(reason: string, anchor?: HTMLElement): void {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("ns-toolbar-hint", { detail: { text: reason, anchor } }));
  }

  /** 抽屉下拉的显示值：多种→"mixed" 占位项（禁用、仅程序选中），无→""（默认/无），统一值→原值。 */
  function drawerSelectValue(state: string | null | "mixed"): string {
    return state === "mixed" ? "mixed" : state ?? "";
  }

  /** 编号样式 flyout 的开合与触发器 aria-expanded 同步。 */
  function setOrderedListStyleMenuOpen(open: boolean): void {
    dom.orderedListStyleMenu.classList.toggle("hidden", !open);
    dom.btnOrderedListStyle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // 抽屉内格式控件：无文字选区时整体禁用（面板内 selects/inputs 与面板内按钮，
  // 不可直达——面板由触发按钮守卫把关；3.8 补漏后 rail 上的六枚工具按钮已移出
  // 本清单，单独走 aria-disabled「亮着」模式）。
  const drawerControls: Array<HTMLButtonElement | HTMLSelectElement | HTMLInputElement> = [
    dom.btnUnderline,
    dom.btnStrike,
    dom.selectFontFamily,
    dom.selectFontSize,
    dom.inputTextColor,
    dom.btnClearTextColor,
    dom.inputHighlight,
    dom.btnClearHighlight,
    dom.selectLineHeight,
    dom.selectSpacingBefore,
    dom.selectSpacingAfter,
    dom.selectTextIndent,
    dom.selectIndentLeft,
    dom.selectIndentRight,
  ];

  // 3.8 补漏（2026-10-30 复验发现）：对齐四枚与清除格式两枚虽源于格式抽屉，但 v5
  // 把它们摆上了左侧工具栏（ui-v5 装配重建为 rail 按钮）——首版盘点误将其归入
  // 抽屉控件走原生 disabled＋灰视觉（CDP 实测 op=0.4 dis=true）。并入
  // setToolUnavailable「亮着＋守卫＋原因提示」模式。
  const sheetRailToolButtons: HTMLButtonElement[] = [
    dom.btnClearCharacterFormat,
    dom.btnAlignLeft,
    dom.btnAlignCenter,
    dom.btnAlignRight,
    dom.btnAlignJustify,
    dom.btnClearParagraphFormat,
  ];

  function disableToolbarControls(): void {
    dom.paragraphStyle.disabled = true;
    dom.btnBold.disabled = true;
    dom.btnItalic.disabled = true;
    dom.btnToolbarUnderline.disabled = true;
    dom.btnToolbarStrike.disabled = true;
    dom.btnBulletList.disabled = true;
    dom.btnOrderedList.disabled = true;
    dom.btnOrderedListStyle.disabled = true;
    // 3.8 补漏的六枚 rail 工具按钮同走原生 disabled（过渡态口径不变）。
    for (const button of sheetRailToolButtons) button.disabled = true;
    // 无编辑器（非「无选区」，文档切换过渡态）走原生 disabled 全关；摘除
    // aria-disabled 保持单一标记，避免切换时两套禁用标记并存。
    for (const button of [dom.btnBold, dom.btnItalic, dom.btnToolbarUnderline, dom.btnToolbarStrike, dom.btnBulletList, dom.btnOrderedList, dom.btnOrderedListStyle, dom.btnUndo, dom.btnRedo, ...sheetRailToolButtons]) {
      button.removeAttribute("aria-disabled");
    }
    setOrderedListStyleMenuOpen(false);
    dom.btnUndo.disabled = true;
    dom.btnRedo.disabled = true;
    for (const control of drawerControls) control.disabled = true;
    if (typeof document !== "undefined") {
      for (const id of ["toolbar-link-url", "toolbar-link-save", "toolbar-link-remove"]) {
        const control = document.getElementById(id) as HTMLInputElement | HTMLButtonElement | null;
        if (control) control.disabled = true;
      }
    }
    notifyFormatRendered();
  }

  function notifyFormatRendered(): void {
    if (typeof document === "undefined" || typeof document.dispatchEvent !== "function" ||
      typeof document.createEvent !== "function") return;
    const event = document.createEvent("Event");
    event.initEvent("writing-format-rendered", false, false);
    document.dispatchEvent(event);
  }

  function render(): void {
    const current = deps.getEditor();
    if (!current) {
      disableToolbarControls();
      return;
    }
    const selection = current.getSelection();
    const hasSelection = selection.from < selection.to;
    const canonical = canonicalDoc(current.getDocument());
    const format = analyzeSelection(canonical, selection.from, selection.to);
    const canUndo = current.canUndo();
    const canRedo = current.canRedo();

    dom.paragraphStyle.value =
      format.paragraphStyle === "mixed" ? "" : format.paragraphStyle;
    dom.btnBold.setAttribute("aria-pressed", pressedValue(format.bold));
    dom.btnItalic.setAttribute("aria-pressed", pressedValue(format.italic));
    dom.btnToolbarUnderline.setAttribute("aria-pressed", pressedValue(format.underline));
    dom.btnToolbarStrike.setAttribute("aria-pressed", pressedValue(format.strike));
    dom.btnBulletList.setAttribute("aria-pressed", format.list === "bullet" ? "true" : "false");
    dom.btnOrderedList.setAttribute("aria-pressed", format.list === "ordered" ? "true" : "false");

    // 有序列表编号样式（flyout 子菜单）：沿用工具栏既有口径——非空文字选区
    // 且选区触及有序列表项（样式状态非 null）才可用；禁用时随 render 收起菜单。
    const olStyle = orderedListStyleState(canonical, selection.from, selection.to);
    const olStyleUsable = hasSelection && olStyle !== null;
    setToolUnavailable(dom.btnOrderedListStyle, !olStyleUsable);
    if (!olStyleUsable) setOrderedListStyleMenuOpen(false);
    dom.btnOrderedListStyle.title =
      olStyle === "mixed"
        ? "编号样式：多种格式"
        : olStyle !== null
          ? `编号样式：${ORDERED_LIST_STYLE_LABELS[olStyle]}`
          : "编号样式";
    dom.orderedListStyleCurrent.textContent =
      olStyle === "mixed" ? "多种格式" : olStyle !== null ? ORDERED_LIST_STYLE_LABELS[olStyle] : "";
    for (const item of dom.orderedListStyleItems) {
      const checked =
        olStyle !== null && olStyle !== "mixed" && item.getAttribute("data-style") === olStyle;
      item.setAttribute("aria-checked", checked ? "true" : "false");
      item.classList.toggle("active", checked);
    }

    // 格式抽屉：字符格式
    dom.btnUnderline.setAttribute("aria-pressed", pressedValue(format.underline));
    dom.btnStrike.setAttribute("aria-pressed", pressedValue(format.strike));
    dom.selectFontFamily.value = drawerSelectValue(format.fontFamily);
    dom.selectFontSize.value = drawerSelectValue(format.fontSize);
    dom.inputTextColor.value =
      format.textColor !== null && format.textColor !== "mixed" ? format.textColor : "#000000";
    dom.inputHighlight.value =
      format.highlight !== null && format.highlight !== "mixed" ? format.highlight : "#ffffff";

    // 格式抽屉：段落格式（对齐无属性时按左对齐，与 analyzeSelection 一致）
    dom.btnAlignLeft.setAttribute("aria-pressed", format.textAlign === "left" ? "true" : "false");
    dom.btnAlignCenter.setAttribute("aria-pressed", format.textAlign === "center" ? "true" : "false");
    dom.btnAlignRight.setAttribute("aria-pressed", format.textAlign === "right" ? "true" : "false");
    dom.btnAlignJustify.setAttribute("aria-pressed", format.textAlign === "justify" ? "true" : "false");
    dom.selectLineHeight.value = drawerSelectValue(format.lineHeight);
    dom.selectSpacingBefore.value = drawerSelectValue(format.spacingBefore);
    dom.selectSpacingAfter.value = drawerSelectValue(format.spacingAfter);
    dom.selectTextIndent.value = drawerSelectValue(format.textIndent);
    dom.selectIndentLeft.value = drawerSelectValue(format.indentLeft);
    dom.selectIndentRight.value = drawerSelectValue(format.indentRight);

    // 工具不可用态走 aria-disabled（D3 C 案「亮着＋点击给提示」）：选区依赖的基础
    // 格式按钮与历史依赖的撤销/重做都亮着（外观＝启用态），悬停/聚焦可见功能名，
    // 点击由守卫拒绝并给原因提示；paragraphStyle 是工具选项面板内的下拉（change
    // 处理器已有守卫＋原因提示），保持原生禁用口径。
    setToolUnavailable(dom.btnBold, !hasSelection);
    setToolUnavailable(dom.btnItalic, !hasSelection);
    setToolUnavailable(dom.btnToolbarUnderline, !hasSelection);
    setToolUnavailable(dom.btnToolbarStrike, !hasSelection);
    setToolUnavailable(dom.btnBulletList, !hasSelection);
    setToolUnavailable(dom.btnOrderedList, !hasSelection);
    // 撤销/重做并入同一模式（3.5）：历史空时不再原生 disabled（用户所见「有的有、
    // 有的没有」提示不一致的来源），亮着＋守卫＋专属原因提示。
    setToolUnavailable(dom.btnUndo, !canUndo);
    setToolUnavailable(dom.btnRedo, !canRedo);
    // 3.8 补漏：六枚 rail 工具按钮（对齐四枚＋清除格式两枚）无选区时同样亮着，
    // 不再随抽屉控件走原生 disabled＋灰视觉。
    for (const button of sheetRailToolButtons) setToolUnavailable(button, !hasSelection);
    for (const control of drawerControls) control.disabled = !hasSelection;
    if (typeof document !== "undefined") {
      const url = document.getElementById("toolbar-link-url") as HTMLInputElement | null;
      const save = document.getElementById("toolbar-link-save") as HTMLButtonElement | null;
      const remove = document.getElementById("toolbar-link-remove") as HTMLButtonElement | null;
      const href = linkHrefAt(current.getDocument(), selection.from, selection.to);
      if (url) { url.disabled = !hasSelection; if (document.activeElement !== url) url.value = href ?? ""; }
      if (save) save.disabled = !hasSelection;
      if (remove) remove.disabled = !hasSelection || href === null;
    }
    notifyFormatRendered();
  }

  function runFormatCommand(command: FormatCommand): boolean {
    const current = deps.getEditor();
    if (!current) return false;
    const result = current.runCommand(command);
    render();
    return result;
  }

  function hasSelection(): boolean {
    const current = deps.getEditor();
    if (!current) return false;
    const selection = current.getSelection();
    return selection.from < selection.to;
  }

  function runSelectionCommand(command: FormatCommand, anchor?: HTMLElement): void {
    // 选区依赖守卫（D3 C 案）：不可用时给出统一原因提示（锚＝触发按钮），禁止静默无响应。
    if (hasSelection()) runFormatCommand(command);
    else notifyUnavailableHint(NEED_SELECTION_HINT, anchor);
  }

  function setFormatDrawerOpen(open: boolean): void {
    dom.formatDrawer.classList.toggle("open", open);
    dom.formatDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    dom.btnFormatDrawer.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---- 工具栏命令（anchor＝触发按钮，供不可用原因提示定位 3.9） ----

  bind(dom.btnBold, "click", () => runSelectionCommand({ kind: "bold" }, dom.btnBold));
  bind(dom.btnItalic, "click", () => runSelectionCommand({ kind: "italic" }, dom.btnItalic));
  bind(dom.btnToolbarUnderline, "click", () => runSelectionCommand({ kind: "underline" }, dom.btnToolbarUnderline));
  bind(dom.btnToolbarStrike, "click", () => runSelectionCommand({ kind: "strike" }, dom.btnToolbarStrike));
  bind(dom.btnBulletList, "click", () => runSelectionCommand({ kind: "bulletList" }, dom.btnBulletList));
  bind(dom.btnOrderedList, "click", () => runSelectionCommand({ kind: "orderedList" }, dom.btnOrderedList));

  // ---- 有序列表编号样式 flyout（PS 风格紧邻子菜单） ----

  bind(dom.btnOrderedListStyle, "click", () => {
    // 不可用态守卫（D3 C 案）：事件照常流动但入口拒绝——不展开 flyout，给原因提示。
    if (dom.btnOrderedListStyle.getAttribute("aria-disabled") === "true") {
      notifyUnavailableHint(NEED_SELECTION_HINT, dom.btnOrderedListStyle);
      return;
    }
    setOrderedListStyleMenuOpen(dom.orderedListStyleMenu.classList.contains("hidden"));
  });
  for (const item of dom.orderedListStyleItems) {
    bind(item, "click", () => {
      const style = ORDERED_LIST_STYLE_VALUES.find(
        (value) => value === item.getAttribute("data-style"),
      );
      if (!style) return;
      // 经既有命令对当前选区生效（可撤销由命令保证）；点击后收起菜单。
      runSelectionCommand({ kind: "orderedListStyle", style }, item);
      setOrderedListStyleMenuOpen(false);
    });
  }
  // 外点与 Escape 关闭（浏览器环境接线；node 单测无 document 时跳过）。
  if (typeof document !== "undefined") {
    const insideStyleFlyout = (target: EventTarget | null): boolean => {
      if (typeof target !== "object" || target === null) return false;
      try {
        return (
          dom.orderedListStyleMenu.contains(target as globalThis.Node) ||
          dom.btnOrderedListStyle.contains(target as globalThis.Node)
        );
      } catch {
        // target 不是真实 DOM 节点（测试桩）时按“在 flyout 之外”处理。
        return false;
      }
    };
    const onDocMouseDown = (event: MouseEvent): void => {
      if (
        !dom.orderedListStyleMenu.classList.contains("hidden") &&
        !insideStyleFlyout(event.target)
      ) {
        setOrderedListStyleMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    cleanup.push(() => document.removeEventListener("mousedown", onDocMouseDown));
  }
  // Escape 关闭：焦点通常在触发器或编辑器内（都在编辑页容器里），冒泡即可达；
  // 不挂全局 keydown，避免叠加应用级快捷键监听。
  bindEvent<KeyboardEvent>(dom.editorPage, "keydown", (event) => {
    if (event.key === "Escape") setOrderedListStyleMenuOpen(false);
  });

  // 撤销/重做（D3 C 案 3.5）：历史空时亮着但不可用——守卫拒绝并给专属原因提示
  // （原生 disabled 时期这两枚悬停无提示，即用户所见「有的有、有的没有」）。
  bind(dom.btnUndo, "click", () => {
    if (dom.btnUndo.getAttribute("aria-disabled") === "true") {
      notifyUnavailableHint("没有可撤销的内容", dom.btnUndo);
      return;
    }
    runFormatCommand({ kind: "undo" });
  });
  bind(dom.btnRedo, "click", () => {
    if (dom.btnRedo.getAttribute("aria-disabled") === "true") {
      notifyUnavailableHint("没有可重做的内容", dom.btnRedo);
      return;
    }
    runFormatCommand({ kind: "redo" });
  });
  if (typeof document !== "undefined") {
    const url = document.getElementById("toolbar-link-url") as HTMLInputElement | null;
    const save = document.getElementById("toolbar-link-save");
    const remove = document.getElementById("toolbar-link-remove");
    if (save && url) bind(save, "click", () => {
      const href = url.value.trim();
      if (href) runSelectionCommand({ kind: "setLink", href }, save);
    });
    if (remove) bind(remove, "click", () => runSelectionCommand({ kind: "unsetLink" }, remove));
  }
  bind(dom.paragraphStyle, "change", () => {
    if (!hasSelection()) { notifyUnavailableHint(NEED_SELECTION_HINT, dom.paragraphStyle); return; }
    const value = dom.paragraphStyle.value;
    if (value.startsWith("heading")) {
      const level = Number(value.slice("heading".length));
      if (level >= 1 && level <= 6) {
        runFormatCommand({ kind: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6 });
      }
    } else {
      runFormatCommand({ kind: "paragraph" });
    }
  });

  // ---- 格式抽屉 ----

  bind(dom.btnFormatDrawer, "click", () => {
    setFormatDrawerOpen(!dom.formatDrawer.classList.contains("open"));
  });
  bind(dom.btnFormatDrawerClose, "click", () => setFormatDrawerOpen(false));

  // 抽屉折叠（disclosure）
  function setupDrawerToggle(button: HTMLButtonElement): void {
    bind(button, "click", () => {
      const group = button.closest(".drawer-group");
      if (!group) return;
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }
  setupDrawerToggle(dom.btnToggleCharacterSection);
  setupDrawerToggle(dom.btnToggleParagraphSection);

  // 抽屉自动隐藏
  bind(dom.formatDrawer, "mouseleave", () => {
    if (typeof window === "undefined") return;
    if (drawerCloseTimer !== null) clearTimeout(drawerCloseTimer);
    drawerCloseTimer = setTimeout(() => {
      drawerCloseTimer = null;
      setFormatDrawerOpen(false);
    }, DRAWER_CLOSE_DELAY_MS);
  });
  bind(dom.formatDrawer, "mouseenter", () => {
    if (drawerCloseTimer !== null) {
      clearTimeout(drawerCloseTimer);
      drawerCloseTimer = null;
    }
  });

  // ---- 留白（显示偏好，持久化到共享存储适配，缺失回退默认档） ----

  function applyMarginPreset(preset: MarginPreset): void {
    marginPreset = preset;
    dom.editorPage.setAttribute("data-margin", preset);
    dom.btnMargin.textContent = MARGIN_LABELS[preset];
  }

  applyMarginPreset(deps.marginStorage ? readMarginPreset(deps.marginStorage) : DEFAULT_MARGIN_PRESET);

  bind(dom.btnMargin, "click", () => {
    const next = nextMarginPreset(marginPreset);
    applyMarginPreset(next);
    if (deps.marginStorage) writeMarginPreset(deps.marginStorage, next);
  });

  // ---- 写作宽度（显示偏好，持久化到共享存储适配，缺失回退默认档） ----

  function applyColumnWidthPreset(preset: ColumnWidthPreset): void {
    columnWidthPreset = preset;
    dom.editorPage.setAttribute("data-column-width", preset);
    dom.btnColumnWidth.textContent = COLUMN_WIDTH_LABELS[preset];
  }

  applyColumnWidthPreset(
    deps.columnWidthStorage ? readColumnWidthPreset(deps.columnWidthStorage) : DEFAULT_COLUMN_WIDTH_PRESET,
  );

  bind(dom.btnColumnWidth, "click", () => {
    const next = nextColumnWidthPreset(columnWidthPreset);
    applyColumnWidthPreset(next);
    if (deps.columnWidthStorage) writeColumnWidthPreset(deps.columnWidthStorage, next);
  });

  // ---- 抽屉：字符格式（anchor＝触发控件，供不可用原因提示定位 3.9） ----

  bind(dom.btnUnderline, "click", () => runSelectionCommand({ kind: "underline" }, dom.btnUnderline));
  bind(dom.btnStrike, "click", () => runSelectionCommand({ kind: "strike" }, dom.btnStrike));
  bind(dom.selectFontFamily, "change", () => {
    runSelectionCommand({ kind: "fontFamily", font: dom.selectFontFamily.value || null }, dom.selectFontFamily);
  });
  bind(dom.selectFontSize, "change", () => {
    runSelectionCommand({ kind: "fontSize", size: dom.selectFontSize.value || null }, dom.selectFontSize);
  });
  bind(dom.inputTextColor, "change", () => {
    runSelectionCommand({ kind: "textColor", color: dom.inputTextColor.value }, dom.inputTextColor);
  });
  bind(dom.btnClearTextColor, "click", () => {
    runSelectionCommand({ kind: "textColor", color: null }, dom.btnClearTextColor);
  });
  bind(dom.inputHighlight, "change", () => {
    runSelectionCommand({ kind: "highlight", color: dom.inputHighlight.value }, dom.inputHighlight);
  });
  bind(dom.btnClearHighlight, "click", () => {
    runSelectionCommand({ kind: "highlight", color: null }, dom.btnClearHighlight);
  });
  bind(dom.btnClearCharacterFormat, "click", () => {
    // 3.8 补漏：处理器经 runSelectionCommand 已有选区守卫＋统一原因提示，此处只需传锚。
    runSelectionCommand({ kind: "clearCharacterFormat" }, dom.btnClearCharacterFormat);
  });

  // ---- 抽屉：段落格式 ----

  bind(dom.btnAlignLeft, "click", () => runSelectionCommand({ kind: "textAlign", align: "left" }, dom.btnAlignLeft));
  bind(dom.btnAlignCenter, "click", () => runSelectionCommand({ kind: "textAlign", align: "center" }, dom.btnAlignCenter));
  bind(dom.btnAlignRight, "click", () => runSelectionCommand({ kind: "textAlign", align: "right" }, dom.btnAlignRight));
  bind(dom.btnAlignJustify, "click", () => runSelectionCommand({ kind: "textAlign", align: "justify" }, dom.btnAlignJustify));
  bind(dom.selectLineHeight, "change", () => {
    runSelectionCommand({ kind: "lineHeight", value: dom.selectLineHeight.value || null }, dom.selectLineHeight);
  });
  bind(dom.selectSpacingBefore, "change", () => {
    runSelectionCommand({ kind: "spacingBefore", value: dom.selectSpacingBefore.value || null }, dom.selectSpacingBefore);
  });
  bind(dom.selectSpacingAfter, "change", () => {
    runSelectionCommand({ kind: "spacingAfter", value: dom.selectSpacingAfter.value || null }, dom.selectSpacingAfter);
  });
  bind(dom.selectTextIndent, "change", () => {
    runSelectionCommand({ kind: "textIndent", value: dom.selectTextIndent.value || null }, dom.selectTextIndent);
  });
  bind(dom.selectIndentLeft, "change", () => {
    runSelectionCommand({ kind: "indentLeft", value: dom.selectIndentLeft.value || null }, dom.selectIndentLeft);
  });
  bind(dom.selectIndentRight, "change", () => {
    runSelectionCommand({ kind: "indentRight", value: dom.selectIndentRight.value || null }, dom.selectIndentRight);
  });
  bind(dom.btnClearParagraphFormat, "click", () => {
    // 3.8 补漏：同清除字符格式——守卫＋原因提示经 runSelectionCommand 覆盖。
    runSelectionCommand({ kind: "clearParagraphFormat" }, dom.btnClearParagraphFormat);
  });

  return {
    render,
    runFormatCommand,
    runSelectionCommand,
    dispose: () => {
      for (const remove of cleanup) remove();
      if (drawerCloseTimer !== null) {
        clearTimeout(drawerCloseTimer);
        drawerCloseTimer = null;
      }
    },
  };
}
