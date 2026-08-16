import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { EditorSaveState } from "./editor-save-state.ts";
import { LeaveCoordinator } from "./leave-guard.ts";
import type { LeaveDialogController } from "./leave-dialog.ts";
import {
  createRichTextEditor,
  type RichTextEditorAdapter,
} from "./rich-text-editor.ts";
import { saveProject, notebookSizeError, openUrl } from "./project-api.ts";
import type { AiFeatureController } from "./ai-feature.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { NotebookTab, ProjectState } from "./types.ts";
import { analyzeSelection, type FormatCommand, type TriState } from "./format-commands.ts";
import {
  canonicalDoc,
  canonicalNotebookJson,
  serializeNotebookDocument,
  parseNotebookDocumentJson,
  validateNotebookDocument,
} from "./structured-notebook.ts";
import { showPage } from "./views.ts";

export interface EditorController {
  showProject(projectState: ProjectState): void;
  hasProject(): boolean;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  guardLeave(): Promise<boolean>;
  unload(): void;
  destroy(): void;
  getCurrentTab(): NotebookTab;
  getCurrentEditor(): SelectionEntryEditor | null;
  attachAi(ai: AiFeatureController): void;
}

type EditorAdapter = Pick<
  RichTextEditorAdapter,
  | "getDocument"
  | "onEdit"
  | "onSelectionChange"
  | "focus"
  | "getSelection"
  | "coordinatesAt"
  | "runCommand"
  | "canUndo"
  | "canRedo"
  | "setFind"
  | "activateMatch"
  | "replaceCurrent"
  | "replaceAll"
  | "pastePlainText"
  | "copySelection"
  | "cutSelection"
  | "destroy"
>;

interface EditorDependencies {
  createEditor(element: HTMLElement, initialDocument: JSONContent): EditorAdapter;
}

interface ProjectEditors {
  draft: EditorAdapter;
  main: EditorAdapter;
  unsubscribeDraft: () => void;
  unsubscribeMain: () => void;
}

const defaultDependencies: EditorDependencies = {
  createEditor: createRichTextEditor,
};

/** 与 ProseMirror 一致的节点位置大小（和 format-commands 内部 nodeSize 同一位置模型）。 */
function positionSize(node: JSONContent): number {
  if (node.type === "text") return (node.text ?? "").length;
  let size = 2;
  for (const child of node.content ?? []) size += positionSize(child);
  return size;
}

/**
 * 选区（或光标）触及的第一个链接 mark 的 href；没有链接返回 null。
 * 光标情形要求严格落在文本节点内部（边界位置不算在链接上）。
 */
function linkHrefAt(doc: JSONContent, from: number, to: number): string | null {
  let found: string | null = null;

  function walk(node: JSONContent, nodeStart: number): void {
    if (found !== null) return;
    const size = positionSize(node);
    const nodeEnd = nodeStart + size;
    const touched =
      from === to
        ? nodeStart < from && nodeEnd > from
        : nodeStart < to && nodeEnd > from;
    if (!touched) return;
    if (node.type === "text") {
      const link = node.marks?.find((mark) => mark.type === "link");
      const href = link?.attrs?.href;
      if (typeof href === "string" && href.length > 0) found = href;
      return;
    }
    let childPos = nodeStart + 1;
    for (const child of node.content ?? []) {
      walk(child, childPos);
      childPos += positionSize(child);
    }
  }

  let pos = 0;
  for (const block of doc.content ?? []) {
    walk(block, pos);
    pos += positionSize(block);
  }
  return found;
}

export function setupEditor(
  dom: AppDom,
  leaveDialog: LeaveDialogController,
  dependencies: EditorDependencies = defaultDependencies,
): EditorController {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage, dom.llmConfigPage];
  let currentState: ProjectState | null = null;
  let saveState: EditorSaveState | null = null;
  let projectEditors: ProjectEditors | null = null;
  let currentTab: NotebookTab = "draft";
  let aiFeature: AiFeatureController | null = null;
  let findBarOpen = false;
  let findCount = 0;
  let findIndex = -1;
  let popoverHref: string | null = null;
  let contextMenuHref: string | null = null;

  function disposeProjectEditors(): void {
    const editors = projectEditors;
    projectEditors = null;
    if (!editors) return;
    editors.unsubscribeDraft();
    editors.unsubscribeMain();
    editors.draft.destroy();
    editors.main.destroy();
  }

  function unload(): void {
    disposeProjectEditors();
    hideLinkPopover();
    closeContextMenu();
    currentState = null;
    saveState = null;
    aiFeature?.endProject();
  }

  const leave = new LeaveCoordinator({
    isDirty: () => saveState?.hasUnsavedChanges ?? false,
    choose: leaveDialog.choose,
    save,
  });

  function switchTab(tab: NotebookTab): void {
    const changedTab = currentTab !== tab;
    currentTab = tab;
    dom.tabDraft.classList.toggle("active", tab === "draft");
    dom.tabMain.classList.toggle("active", tab === "main");
    dom.draftTextarea.classList.toggle("hidden", tab !== "draft");
    dom.mainTextarea.classList.toggle("hidden", tab !== "main");
    if (changedTab) aiFeature?.resetSelectionEntry();
    hideLinkPopover();
    closeContextMenu();
    renderToolbar();
    if (findBarOpen) runFind();
  }

  function renderSaveState(): void {
    if (!saveState) return;
    dom.saveStatus.textContent = saveState.statusText;
    dom.saveStatus.className = "save-status";
    if (saveState.isSaving) dom.saveStatus.classList.add("saving");
    else if (saveState.statusText.startsWith("保存失败")) dom.saveStatus.classList.add("error");
    else if (saveState.hasUnsavedChanges) dom.saveStatus.classList.add("unsaved");
    dom.btnSave.disabled = saveState.isSaving || !saveState.hasUnsavedChanges;
  }

  function syncCurrent(): void {
    const editors = projectEditors;
    if (!editors) return;
    saveState?.setCurrent(
      canonicalNotebookJson(editors.draft.getDocument()),
      canonicalNotebookJson(editors.main.getDocument()),
    );
    renderSaveState();
    renderToolbar();
    refreshFindAfterEdit();
  }

  // ---- 工具栏 ----

  function runFormatCommand(command: FormatCommand): boolean {
    const editors = projectEditors;
    if (!editors) return false;
    const result = editors[currentTab].runCommand(command);
    renderToolbar();
    return result;
  }

  function currentEditorAdapter(): EditorAdapter | null {
    return projectEditors?.[currentTab] ?? null;
  }

  function currentHasSelection(): boolean {
    const editors = projectEditors;
    if (!editors) return false;
    const selection = editors[currentTab].getSelection();
    return selection.from < selection.to;
  }

  function pressedValue(state: TriState): string {
    return state === "on" ? "true" : state === "off" ? "false" : "mixed";
  }

  /** 抽屉下拉的显示值：多种→"mixed" 占位项（禁用、仅程序选中），无→""（默认/无），统一值→原值。 */
  function drawerSelectValue(state: string | null | "mixed"): string {
    return state === "mixed" ? "mixed" : state ?? "";
  }

  // 抽屉内所有格式控件：无文字选区时整体禁用。
  // 开关按钮不在其中——抽屉随时可打开，只是内容不可用。
  const drawerControls: Array<HTMLButtonElement | HTMLSelectElement | HTMLInputElement> = [
    dom.btnUnderline,
    dom.btnStrike,
    dom.selectFontFamily,
    dom.selectFontSize,
    dom.inputTextColor,
    dom.btnClearTextColor,
    dom.inputHighlight,
    dom.btnClearHighlight,
    dom.btnClearCharacterFormat,
    dom.btnAlignLeft,
    dom.btnAlignCenter,
    dom.btnAlignRight,
    dom.btnAlignJustify,
    dom.selectLineHeight,
    dom.selectSpacingBefore,
    dom.selectSpacingAfter,
    dom.selectTextIndent,
    dom.selectIndentLeft,
    dom.selectIndentRight,
    dom.btnClearParagraphFormat,
  ];

  function renderToolbar(): void {
    const editors = projectEditors;
    if (!editors) return;
    const editor = editors[currentTab];
    const selection = editor.getSelection();
    const hasSelection = selection.from < selection.to;
    const format = analyzeSelection(
      canonicalDoc(editor.getDocument()),
      selection.from,
      selection.to,
    );
    const canUndo = editor.canUndo();
    const canRedo = editor.canRedo();

    dom.paragraphStyle.value =
      format.paragraphStyle === "mixed" ? "" : format.paragraphStyle;
    dom.btnBold.setAttribute("aria-pressed", pressedValue(format.bold));
    dom.btnItalic.setAttribute("aria-pressed", pressedValue(format.italic));
    dom.btnBulletList.setAttribute("aria-pressed", format.list === "bullet" ? "true" : "false");
    dom.btnOrderedList.setAttribute("aria-pressed", format.list === "ordered" ? "true" : "false");

    // 格式抽屉：字符格式
    dom.btnUnderline.setAttribute("aria-pressed", pressedValue(format.underline));
    dom.btnStrike.setAttribute("aria-pressed", pressedValue(format.strike));
    dom.selectFontFamily.value = drawerSelectValue(format.fontFamily);
    dom.selectFontSize.value = drawerSelectValue(format.fontSize);
    // 取色控件只是取色入口：统一值时回显当前颜色；无或多种时回退默认色（不会因此下发命令）。
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

    dom.paragraphStyle.disabled = !hasSelection;
    dom.btnBold.disabled = !hasSelection;
    dom.btnItalic.disabled = !hasSelection;
    dom.btnBulletList.disabled = !hasSelection;
    dom.btnOrderedList.disabled = !hasSelection;
    dom.btnClearFormat.disabled = !hasSelection;
    dom.btnMoreClearFormat.disabled = !hasSelection;
    dom.btnUndo.disabled = !canUndo;
    dom.btnRedo.disabled = !canRedo;
    dom.btnMoreUndo.disabled = !canUndo;
    dom.btnMoreRedo.disabled = !canRedo;
    for (const control of drawerControls) control.disabled = !hasSelection;
  }

  function toggleMoreMenu(): void {
    dom.moreMenu.classList.toggle("hidden");
  }

  function runSelectionCommand(command: FormatCommand): void {
    if (currentHasSelection()) runFormatCommand(command);
  }

  function onEditorSelectionChange(): void {
    renderToolbar();
    updateLinkPopover();
  }

  async function save(): Promise<boolean> {
    if (!currentState || !saveState) return true;
    const editors = projectEditors;
    if (!editors) return true;
    const state = saveState;
    const path = currentState.projectPath;

    // 先把两份文档规范化为版本 2 规范形态（合并相邻文本、丢弃 null/默认属性、仅保留正式节点与标记），再严格校验。
    const draftDocument = serializeNotebookDocument(editors.draft.getDocument());
    const mainDocument = serializeNotebookDocument(editors.main.getDocument());
    const draftValidation = validateNotebookDocument(draftDocument);
    if (!draftValidation.ok) {
      return rejectSave(`草稿本无法保存：${draftValidation.error}`);
    }
    const mainValidation = validateNotebookDocument(mainDocument);
    if (!mainValidation.ok) {
      return rejectSave(`正文本无法保存：${mainValidation.error}`);
    }

    // 与后端一致的字节上限检查：超限不调用写盘。
    const draftSizeError = notebookSizeError(JSON.stringify(draftDocument));
    if (draftSizeError) return rejectSave(`草稿本内容过大：${draftSizeError}`);
    const mainSizeError = notebookSizeError(JSON.stringify(mainDocument));
    if (mainSizeError) return rejectSave(`正文本内容过大：${mainSizeError}`);

    const result = state.save((snapshot) => saveProject(path, snapshot.draft, snapshot.main));
    renderSaveState();
    const succeeded = await result;
    renderSaveState();
    return succeeded;
  }

  /** 校验/上限未通过：以保存失败路径记录错误，基线不变，内容保持未保存，不调用写盘。 */
  async function rejectSave(message: string): Promise<boolean> {
    const state = saveState;
    if (!state) return true;
    const result = state.save(async () => {
      throw new Error(message);
    });
    renderSaveState();
    const succeeded = await result;
    renderSaveState();
    return succeeded;
  }

  async function guardCurrentLeave(): Promise<boolean> {
    const dirty = saveState?.hasUnsavedChanges ?? false;
    if (dirty) {
      dom.draftTextarea.inert = true;
      dom.mainTextarea.inert = true;
    }
    try {
      return await leave.run();
    } finally {
      dom.draftTextarea.inert = false;
      dom.mainTextarea.inert = false;
    }
  }

  function showProject(projectState: ProjectState): void {
    // 事务式替换：先解析两份文档并构造完整新编辑器组合，全部成功后一次性交换再销毁旧组合。
    // 任一步失败（如本子内容非法）都不会破坏当前正在编辑的作品。
    const draftDocument = parseNotebookDocumentJson(projectState.draftContent).document;
    const mainDocument = parseNotebookDocumentJson(projectState.mainContent).document;
    const nextSaveState = new EditorSaveState(
      canonicalNotebookJson(draftDocument),
      canonicalNotebookJson(mainDocument),
    );
    const draft = dependencies.createEditor(dom.draftTextarea, draftDocument);
    let main: EditorAdapter;
    try {
      main = dependencies.createEditor(dom.mainTextarea, mainDocument);
    } catch (error) {
      // 构造新组合中途失败：销毁已创建的一半，保持旧组合完整可用。
      draft.destroy();
      throw error;
    }
    const editors: ProjectEditors = {
      draft,
      main,
      unsubscribeDraft: () => {},
      unsubscribeMain: () => {},
    };
    editors.unsubscribeDraft = draft.onEdit(() => {
      if (projectEditors === editors) syncCurrent();
    });
    editors.unsubscribeMain = main.onEdit(() => {
      if (projectEditors === editors) syncCurrent();
    });
    // 用 Tiptap 自己的选区事件驱动工具栏状态，比 DOM 事件可靠、稳定。
    draft.onSelectionChange(() => {
      if (projectEditors === editors) onEditorSelectionChange();
    });
    main.onSelectionChange(() => {
      if (projectEditors === editors) onEditorSelectionChange();
    });
    // 全部成功后一次性交换：旧组合销毁，新组合接管。
    disposeProjectEditors();
    currentState = projectState;
    saveState = nextSaveState;
    projectEditors = editors;
    aiFeature?.beginProject();
    dom.currentProjectName.textContent = projectState.projectName;
    renderSaveState();
    switchTab("draft");
    showPage(pages, "editor-page");
  }

  dom.tabDraft.addEventListener("click", () => switchTab("draft"));
  dom.tabMain.addEventListener("click", () => switchTab("main"));
  dom.btnSave.addEventListener("click", () => { void save(); });

  // 工具栏按钮：mousedown 时阻止抢焦点，否则点击按钮会让编辑器失焦、选区丢失，
  // 加粗/斜体等命令就会作用在空选区上（手感稀碎）。
  // 抽屉里的按钮同理；下拉框与取色输入不在此列——它们必须拿到焦点才能展开，
  // 且 ProseMirror 选区在失焦后仍保留（与现有 paragraphStyle 下拉同一处理方式）。
  const toolbarButtons = [
    dom.btnBold,
    dom.btnItalic,
    dom.btnBulletList,
    dom.btnOrderedList,
    dom.btnClearFormat,
    dom.btnUndo,
    dom.btnRedo,
    dom.btnMore,
    dom.btnMoreClearFormat,
    dom.btnMoreUndo,
    dom.btnMoreRedo,
    dom.btnFormatDrawer,
    dom.btnFormatDrawerClose,
    dom.btnUnderline,
    dom.btnStrike,
    dom.btnClearTextColor,
    dom.btnClearHighlight,
    dom.btnClearCharacterFormat,
    dom.btnAlignLeft,
    dom.btnAlignCenter,
    dom.btnAlignRight,
    dom.btnAlignJustify,
    dom.btnClearParagraphFormat,
    dom.btnFindPrev,
    dom.btnFindNext,
    dom.btnReplace,
    dom.btnReplaceAll,
    dom.btnFindClose,
    dom.btnCtxCut,
    dom.btnCtxCopy,
    dom.btnCtxPaste,
    dom.btnCtxPastePlain,
    dom.btnCtxUnderline,
    dom.btnCtxStrike,
    dom.btnCtxClearCharacter,
    dom.btnCtxClearParagraph,
    dom.btnCtxLinkOpen,
    dom.btnCtxLinkEdit,
    dom.btnCtxLinkRemove,
    dom.btnLinkOpen,
    dom.btnLinkEdit,
    dom.btnLinkRemove,
  ];
  for (const button of toolbarButtons) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
  }

  // 编辑器区域 dragover 阻止默认，否则从文件管理器拖文件进来时 drop 事件不会触发。
  for (const element of [dom.draftTextarea, dom.mainTextarea]) {
    element.addEventListener("dragover", (event) => event.preventDefault());
  }

  // 工具栏命令
  dom.btnBold.addEventListener("click", () => runSelectionCommand({ kind: "bold" }));
  dom.btnItalic.addEventListener("click", () => runSelectionCommand({ kind: "italic" }));
  dom.btnBulletList.addEventListener("click", () => runSelectionCommand({ kind: "bulletList" }));
  dom.btnOrderedList.addEventListener("click", () => runSelectionCommand({ kind: "orderedList" }));
  dom.btnClearFormat.addEventListener("click", () => runSelectionCommand({ kind: "clearFormatting" }));
  dom.btnMoreClearFormat.addEventListener("click", () => runSelectionCommand({ kind: "clearFormatting" }));
  dom.btnUndo.addEventListener("click", () => runFormatCommand({ kind: "undo" }));
  dom.btnRedo.addEventListener("click", () => runFormatCommand({ kind: "redo" }));
  dom.btnMoreUndo.addEventListener("click", () => runFormatCommand({ kind: "undo" }));
  dom.btnMoreRedo.addEventListener("click", () => runFormatCommand({ kind: "redo" }));
  dom.btnMore.addEventListener("click", toggleMoreMenu);
  dom.paragraphStyle.addEventListener("change", () => {
    if (!currentHasSelection()) return;
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

  function setFormatDrawerOpen(open: boolean): void {
    dom.formatDrawer.classList.toggle("open", open);
    dom.formatDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    dom.btnFormatDrawer.setAttribute("aria-expanded", open ? "true" : "false");
  }

  dom.btnFormatDrawer.addEventListener("click", () => {
    setFormatDrawerOpen(!dom.formatDrawer.classList.contains("open"));
  });
  dom.btnFormatDrawerClose.addEventListener("click", () => setFormatDrawerOpen(false));

  // 抽屉：字符格式。命令只作用于当前选区，无选区时控件已被禁用，这里再经 runSelectionCommand 兜底。
  dom.btnUnderline.addEventListener("click", () => runSelectionCommand({ kind: "underline" }));
  dom.btnStrike.addEventListener("click", () => runSelectionCommand({ kind: "strike" }));
  dom.selectFontFamily.addEventListener("change", () => {
    runSelectionCommand({ kind: "fontFamily", font: dom.selectFontFamily.value || null });
  });
  dom.selectFontSize.addEventListener("change", () => {
    runSelectionCommand({ kind: "fontSize", size: dom.selectFontSize.value || null });
  });
  // input[type=color] 的值按 HTML 规范恒为小写 #rrggbb，可直接写入文档。
  dom.inputTextColor.addEventListener("change", () => {
    runSelectionCommand({ kind: "textColor", color: dom.inputTextColor.value });
  });
  dom.btnClearTextColor.addEventListener("click", () => {
    runSelectionCommand({ kind: "textColor", color: null });
  });
  dom.inputHighlight.addEventListener("change", () => {
    runSelectionCommand({ kind: "highlight", color: dom.inputHighlight.value });
  });
  dom.btnClearHighlight.addEventListener("click", () => {
    runSelectionCommand({ kind: "highlight", color: null });
  });
  dom.btnClearCharacterFormat.addEventListener("click", () => {
    runSelectionCommand({ kind: "clearCharacterFormat" });
  });

  // 抽屉：段落格式
  dom.btnAlignLeft.addEventListener("click", () => runSelectionCommand({ kind: "textAlign", align: "left" }));
  dom.btnAlignCenter.addEventListener("click", () => runSelectionCommand({ kind: "textAlign", align: "center" }));
  dom.btnAlignRight.addEventListener("click", () => runSelectionCommand({ kind: "textAlign", align: "right" }));
  dom.btnAlignJustify.addEventListener("click", () => runSelectionCommand({ kind: "textAlign", align: "justify" }));
  dom.selectLineHeight.addEventListener("change", () => {
    runSelectionCommand({ kind: "lineHeight", value: dom.selectLineHeight.value || null });
  });
  dom.selectSpacingBefore.addEventListener("change", () => {
    runSelectionCommand({ kind: "spacingBefore", value: dom.selectSpacingBefore.value || null });
  });
  dom.selectSpacingAfter.addEventListener("change", () => {
    runSelectionCommand({ kind: "spacingAfter", value: dom.selectSpacingAfter.value || null });
  });
  dom.selectTextIndent.addEventListener("change", () => {
    runSelectionCommand({ kind: "textIndent", value: dom.selectTextIndent.value || null });
  });
  dom.selectIndentLeft.addEventListener("change", () => {
    runSelectionCommand({ kind: "indentLeft", value: dom.selectIndentLeft.value || null });
  });
  dom.selectIndentRight.addEventListener("change", () => {
    runSelectionCommand({ kind: "indentRight", value: dom.selectIndentRight.value || null });
  });
  dom.btnClearParagraphFormat.addEventListener("click", () => {
    runSelectionCommand({ kind: "clearParagraphFormat" });
  });

  // ---- 查找替换 ----

  function renderFindCount(): void {
    const hasQuery = dom.findInput.value !== "";
    dom.findCount.textContent = hasQuery ? `${findCount === 0 ? 0 : findIndex + 1} / ${findCount}` : "";
    dom.btnFindPrev.disabled = findCount === 0;
    dom.btnFindNext.disabled = findCount === 0;
    dom.btnReplace.disabled = findCount === 0;
    dom.btnReplaceAll.disabled = findCount === 0;
  }

  /** 在当前编辑器上重跑查找。命中数与下标以 setFind 结果为准，插件侧 activeIndex 同时重置为 0。 */
  function runFind(): void {
    const editor = currentEditorAdapter();
    if (!editor) return;
    findCount = editor.setFind(dom.findInput.value, dom.findCaseSensitive.checked);
    findIndex = findCount > 0 ? 0 : -1;
    renderFindCount();
  }

  /** 文档被编辑后刷新查找：计数可能变化，重新查找回到第一个命中（setFind 不移动可见选区）。 */
  function refreshFindAfterEdit(): void {
    if (!findBarOpen || dom.findInput.value === "") return;
    runFind();
  }

  function openFindBar(focusTarget: "find" | "replace"): void {
    findBarOpen = true;
    dom.findBar.classList.remove("hidden");
    if (focusTarget === "find") {
      dom.findInput.focus();
      dom.findInput.select();
    } else {
      dom.replaceInput.focus();
    }
    runFind();
  }

  function closeFindBar(): void {
    if (!findBarOpen) return;
    findBarOpen = false;
    dom.findBar.classList.add("hidden");
    // 关闭时清空高亮
    const editor = currentEditorAdapter();
    if (editor && dom.findInput.value !== "") editor.setFind("", dom.findCaseSensitive.checked);
    findCount = 0;
    findIndex = -1;
    renderFindCount();
    // 焦点可能停在已隐藏的输入框里，还给编辑器，避免后续打字落空。
    editor?.focus();
  }

  function stepFind(delta: 1 | -1): void {
    const editor = currentEditorAdapter();
    if (!editor || findCount === 0) return;
    findIndex = (findIndex + delta + findCount) % findCount;
    editor.activateMatch(findIndex);
    renderFindCount();
  }

  dom.findInput.addEventListener("input", runFind);
  dom.findCaseSensitive.addEventListener("change", runFind);
  dom.btnFindPrev.addEventListener("click", () => stepFind(-1));
  dom.btnFindNext.addEventListener("click", () => stepFind(1));
  dom.btnReplace.addEventListener("click", () => {
    const editor = currentEditorAdapter();
    if (!editor || findCount === 0) return;
    // 替换会触发 onEdit → syncCurrent → refreshFindAfterEdit 重跑查找并刷新计数，这里不本地记账。
    editor.replaceCurrent(dom.replaceInput.value);
  });
  dom.btnReplaceAll.addEventListener("click", () => {
    const editor = currentEditorAdapter();
    if (!editor || findCount === 0) return;
    editor.replaceAll(dom.replaceInput.value);
  });
  dom.btnFindClose.addEventListener("click", closeFindBar);

  // ---- 链接动作（右键菜单与链接弹层共用） ----

  function openLinkHref(href: string): void {
    const lower = href.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      void openUrl(href).catch(() => alert("无法打开链接，请检查系统默认浏览器设置。"));
    } else {
      alert("此链接不是 http/https 地址，无法打开。");
    }
  }

  function editLinkHref(currentHref: string): void {
    const input = window.prompt("链接地址", currentHref);
    if (input === null) return;
    const href = input.trim();
    if (href === "") return;
    runFormatCommand({ kind: "setLink", href });
  }

  function createLinkHref(): void {
    const input = window.prompt("链接地址");
    if (input === null) return;
    const href = input.trim();
    if (href === "") return;
    runFormatCommand({ kind: "setLink", href });
  }

  function removeLinkHref(): void {
    runFormatCommand({ kind: "unsetLink" });
  }

  // ---- 链接弹层 ----

  function hideLinkPopover(): void {
    popoverHref = null;
    dom.linkPopover.classList.add("hidden");
  }

  /** 光标/选区落在链接上时，在链接附近浮出弹层；否则收起。 */
  function updateLinkPopover(): void {
    const editor = currentEditorAdapter();
    if (!editor) {
      hideLinkPopover();
      return;
    }
    const { from, to, head } = editor.getSelection();
    const href = linkHrefAt(editor.getDocument(), from, to);
    if (href === null) {
      hideLinkPopover();
      return;
    }
    popoverHref = href;
    const coords = editor.coordinatesAt(head);
    dom.linkPopover.classList.remove("hidden");
    const popoverWidth = dom.linkPopover.offsetWidth || 200;
    const viewWidth = window.innerWidth || 1024;
    const left = Math.max(8, Math.min(coords.left, viewWidth - popoverWidth - 8));
    dom.linkPopover.style.left = `${left}px`;
    dom.linkPopover.style.top = `${coords.bottom + 6}px`;
  }

  dom.btnLinkOpen.addEventListener("click", () => {
    const href = popoverHref;
    hideLinkPopover();
    if (href !== null) openLinkHref(href);
  });
  dom.btnLinkEdit.addEventListener("click", () => {
    const href = popoverHref;
    hideLinkPopover();
    if (href !== null) editLinkHref(href);
  });
  dom.btnLinkRemove.addEventListener("click", () => {
    hideLinkPopover();
    removeLinkHref();
  });

  // ---- 右键菜单 ----

  function closeContextMenu(): void {
    contextMenuHref = null;
    dom.contextMenu.classList.add("hidden");
  }

  function openContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const editor = currentEditorAdapter();
    if (!editor) return;
    hideLinkPopover();
    const { from, to } = editor.getSelection();
    const hasSelection = from < to;
    contextMenuHref = linkHrefAt(editor.getDocument(), from, to);

    dom.btnCtxCut.disabled = !hasSelection;
    dom.btnCtxCopy.disabled = !hasSelection;
    dom.ctxSelectionGroup.classList.toggle("hidden", !hasSelection);
    dom.btnCtxLinkCreate.classList.toggle("hidden", contextMenuHref !== null);
    dom.ctxLinkGroup.classList.toggle("hidden", contextMenuHref === null);

    dom.contextMenu.classList.remove("hidden");
    const menuWidth = dom.contextMenu.offsetWidth || 180;
    const menuHeight = dom.contextMenu.offsetHeight || 240;
    const viewWidth = window.innerWidth || 1024;
    const viewHeight = window.innerHeight || 768;
    const left = Math.max(4, Math.min(event.clientX, viewWidth - menuWidth - 4));
    const top = Math.max(4, Math.min(event.clientY, viewHeight - menuHeight - 4));
    dom.contextMenu.style.left = `${left}px`;
    dom.contextMenu.style.top = `${top}px`;
  }

  for (const element of [dom.draftTextarea, dom.mainTextarea]) {
    element.addEventListener("contextmenu", (event) => openContextMenu(event as MouseEvent));
  }

  dom.btnCtxCut.addEventListener("click", () => {
    closeContextMenu();
    const editor = currentEditorAdapter();
    if (!editor) return;
    editor.focus();
    void editor.cutSelection();
  });
  dom.btnCtxCopy.addEventListener("click", () => {
    closeContextMenu();
    const editor = currentEditorAdapter();
    if (!editor) return;
    editor.focus();
    void editor.copySelection().then((ok) => {
      if (!ok) alert("复制失败，请使用 Ctrl+C。");
    });
  });
  dom.btnCtxPaste.addEventListener("click", () => {
    closeContextMenu();
    const editor = currentEditorAdapter();
    if (!editor) return;
    editor.focus();
    const ok = document.execCommand("paste");
    if (!ok) alert("无法直接读取剪贴板内容，请使用 Ctrl+V 粘贴。");
  });
  dom.btnCtxPastePlain.addEventListener("click", () => {
    closeContextMenu();
    const editor = currentEditorAdapter();
    if (!editor) return;
    editor.focus();
    void editor.pastePlainText();
  });
  dom.btnCtxUnderline.addEventListener("click", () => {
    closeContextMenu();
    runSelectionCommand({ kind: "underline" });
  });
  dom.btnCtxStrike.addEventListener("click", () => {
    closeContextMenu();
    runSelectionCommand({ kind: "strike" });
  });
  dom.btnCtxClearCharacter.addEventListener("click", () => {
    closeContextMenu();
    runSelectionCommand({ kind: "clearCharacterFormat" });
  });
  dom.btnCtxClearParagraph.addEventListener("click", () => {
    closeContextMenu();
    runSelectionCommand({ kind: "clearParagraphFormat" });
  });
  dom.btnCtxLinkCreate.addEventListener("click", () => {
    closeContextMenu();
    createLinkHref();
  });
  dom.btnCtxLinkOpen.addEventListener("click", () => {
    const href = contextMenuHref;
    closeContextMenu();
    if (href !== null) openLinkHref(href);
  });
  dom.btnCtxLinkEdit.addEventListener("click", () => {
    const href = contextMenuHref;
    closeContextMenu();
    if (href !== null) editLinkHref(href);
  });
  dom.btnCtxLinkRemove.addEventListener("click", () => {
    closeContextMenu();
    removeLinkHref();
  });

  // 点击别处或滚动时收起浮层（capture 阶段才能接住编辑器内部滚动）。
  document.addEventListener("mousedown", (event) => {
    if (!dom.contextMenu.classList.contains("hidden") && !dom.contextMenu.contains(event.target as Node)) {
      closeContextMenu();
    }
    if (!dom.linkPopover.classList.contains("hidden") && !dom.linkPopover.contains(event.target as Node)) {
      hideLinkPopover();
    }
  });
  document.addEventListener("scroll", () => {
    closeContextMenu();
    hideLinkPopover();
  }, true);

  // 选区变化已由编辑器 adapter 的 selectionUpdate 事件驱动（见 showProject），
  // 这里不再监听 DOM 事件，避免 mouseup 等时机不可靠导致工具栏状态乱跳。

  // 用捕获阶段监听，先于 ProseMirror 自带的快捷键（Bold/Italic/Underline/History 的
  // Mod-b/Mod-i/Mod-u/Mod-z/Mod-y）处理；对冲突键 stopPropagation 避免被重复触发两次。
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      closeContextMenu();
      hideLinkPopover();
      closeFindBar();
      return;
    }
    if (mod && key === "f") {
      event.preventDefault();
      openFindBar("find");
      return;
    }
    if (mod && key === "h") {
      event.preventDefault();
      openFindBar("replace");
      return;
    }
    if (mod && event.shiftKey && key === "v") {
      event.preventDefault();
      const editor = currentEditorAdapter();
      if (editor) {
        editor.focus();
        void editor.pastePlainText();
      }
      return;
    }
    if (mod && key === "k") {
      const editor = currentEditorAdapter();
      if (editor) {
        const { from, to } = editor.getSelection();
        const href = linkHrefAt(editor.getDocument(), from, to);
        event.preventDefault();
        if (href !== null) {
          editLinkHref(href);
        } else if (from < to) {
          createLinkHref();
        }
      }
      return;
    }
    if (mod && key === "s") {
      event.preventDefault();
      if (saveState?.hasUnsavedChanges) void save();
      return;
    }
    if (mod && key === "b") {
      event.preventDefault();
      event.stopPropagation();
      runSelectionCommand({ kind: "bold" });
      return;
    }
    if (mod && key === "i") {
      event.preventDefault();
      event.stopPropagation();
      runSelectionCommand({ kind: "italic" });
      return;
    }
    if (mod && key === "u") {
      event.preventDefault();
      event.stopPropagation();
      runSelectionCommand({ kind: "underline" });
      return;
    }
    if (mod && key === "z") {
      event.preventDefault();
      event.stopPropagation();
      runFormatCommand(event.shiftKey ? { kind: "redo" } : { kind: "undo" });
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      event.stopPropagation();
      runFormatCommand({ kind: "redo" });
      return;
    }
  }, { capture: true });

  return {
    showProject,
    hasProject: () => currentState !== null,
    hasUnsavedChanges: () => saveState?.hasUnsavedChanges ?? false,
    save,
    guardLeave: guardCurrentLeave,
    unload,
    destroy: unload,
    getCurrentTab: () => currentTab,
    getCurrentEditor: () => {
      const editors = projectEditors;
      if (editors === null) return null;
      const editor = editors[currentTab];
      const element = currentTab === "draft" ? dom.draftTextarea : dom.mainTextarea;
      return {
        element,
        getDocument: () => editor.getDocument(),
        getSelection: () => editor.getSelection(),
        coordinatesAt: (position) => editor.coordinatesAt(position),
      };
    },
    attachAi: (ai: AiFeatureController) => {
      aiFeature = ai;
    },
  };
}
