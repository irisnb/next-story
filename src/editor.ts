import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { EditorSaveState } from "./editor-save-state.ts";
import { LeaveCoordinator } from "./leave-guard.ts";
import type { LeaveDialogController } from "./leave-dialog.ts";
import {
  createRichTextEditor,
  type RichTextEditorAdapter,
} from "./rich-text-editor.ts";
import { saveDocument, readDocument, notebookSizeError, openUrl } from "./project-api.ts";
import type { AiFeatureController } from "./ai-feature.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { ContentTree, ProjectTreeState } from "./types.ts";
import { analyzeSelection, type FormatCommand, type TriState } from "./format-commands.ts";
import {
  canonicalDoc,
  canonicalNotebookJson,
  serializeNotebookDocument,
  parseNotebookDocumentJson,
  validateNotebookDocument,
  emptyNotebookDocument,
} from "./structured-notebook.ts";
import { showPage } from "./views.ts";
import {
  DEFAULT_MARGIN_PRESET,
  nextMarginPreset,
  readMarginPreset,
  writeMarginPreset,
  type MarginPreset,
  type StorageLike,
} from "./editor-margin.ts";
import {
  clearLastDocumentId,
  readLastDocumentId,
  writeLastDocumentId,
  type MemoryStorage,
} from "./document-memory.ts";
import {
  firstDocument,
  flattenDocuments,
  isDocumentInTree,
  resolveCurrentDocument,
} from "./content-tree.ts";

const MARGIN_LABELS: Record<MarginPreset, string> = {
  compact: "紧凑",
  standard: "标准",
  loose: "宽松",
};

const EMPTY_STATE_TEXT = "这里还没有文档，去文件管理新建一篇吧";

export interface EditorController {
  showProject(projectState: ProjectTreeState): Promise<void>;
  hasProject(): boolean;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  guardLeave(): Promise<boolean>;
  unload(): void;
  destroy(): void;
  getCurrentDocumentId(): string | null;
  getCurrentEditor(): SelectionEntryEditor | null;
  attachAi(ai: AiFeatureController): void;
  /** 文件管理页读取当前作品路径与树（只读）。 */
  getProjectPath(): string | null;
  getTree(): ContentTree | null;
  /** 文件管理操作后刷新树；当前文档被删除时回退到第一篇或空态。 */
  applyTree(tree: ContentTree): void;
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
  readDocument(projectPath: string, documentId: string): Promise<string>;
  saveDocument(projectPath: string, documentId: string, content: string): Promise<void>;
  memoryStorage?: MemoryStorage | null;
}

const defaultDependencies: EditorDependencies = {
  createEditor: createRichTextEditor,
  readDocument,
  saveDocument,
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

/** 与 localStorage 兼容、带 removeItem 的记忆存储；window 不可用时返回 null。 */
function resolveMemoryStorage(): MemoryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    if (!storage) return null;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

export function setupEditor(
  dom: AppDom,
  leaveDialog: LeaveDialogController,
  dependencies: EditorDependencies = defaultDependencies,
): EditorController {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];
  const memoryStorage: MemoryStorage | null =
    dependencies.memoryStorage !== undefined
      ? dependencies.memoryStorage
      : resolveMemoryStorage();
  let currentState: ProjectTreeState | null = null;
  let currentDocumentId: string | null = null;
  let editor: EditorAdapter | null = null;
  let unsubscribeEdit: (() => void) | null = null;
  let unsubscribeSelection: (() => void) | null = null;
  let saveState: EditorSaveState | null = null;
  /** 打开作品或切换文档时递增，丢弃迟到的异步正文读取结果。 */
  let loadGeneration = 0;
  let aiFeature: AiFeatureController | null = null;
  let findBarOpen = false;
  let findCount = 0;
  let findIndex = -1;
  let popoverHref: string | null = null;
  let contextMenuHref: string | null = null;
  let marginPreset: MarginPreset = DEFAULT_MARGIN_PRESET;

  const DRAWER_CLOSE_DELAY_MS = 350;
  let drawerCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function currentEditor(): EditorAdapter | null {
    return editor;
  }

  function disposeEditor(): void {
    const current = editor;
    editor = null;
    unsubscribeEdit?.();
    unsubscribeSelection?.();
    unsubscribeEdit = null;
    unsubscribeSelection = null;
    current?.destroy();
  }

  function unload(): void {
    disposeEditor();
    hideLinkPopover();
    closeContextMenu();
    if (drawerCloseTimer !== null) {
      clearTimeout(drawerCloseTimer);
      drawerCloseTimer = null;
    }
    currentState = null;
    currentDocumentId = null;
    saveState = null;
    loadGeneration += 1;
    aiFeature?.endProject();
  }

  const leave = new LeaveCoordinator({
    isDirty: () => saveState?.hasUnsavedChanges ?? false,
    choose: leaveDialog.choose,
    save,
  });

  // ---- 当前文档显示 + 扁平切换列表 ----

  function renderDocumentList(): void {
    if (!currentState) return;
    dom.documentList.replaceChildren();
    for (const doc of flattenDocuments(currentState.tree)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "document-list-item";
      if (doc.id === currentDocumentId) item.classList.add("active");
      item.textContent = doc.name;
      item.addEventListener("click", () => {
        void switchDocument(doc.id);
      });
      dom.documentList.appendChild(item);
    }
  }

  function renderCurrentDocument(): void {
    if (!currentState) return;
    const current =
      currentDocumentId !== null ? currentState.tree.nodes[currentDocumentId] : null;
    dom.currentDocumentName.textContent = current?.name ?? "";
    dom.editorTextarea.classList.toggle("hidden", currentDocumentId === null);
    dom.writingEmptyState.classList.toggle("hidden", currentDocumentId !== null);
    if (currentDocumentId === null) {
      dom.writingEmptyState.textContent = EMPTY_STATE_TEXT;
    }
    renderDocumentList();
  }

  function closeDocumentList(): void {
    dom.documentList.classList.add("hidden");
    dom.currentDocToggle.setAttribute("aria-expanded", "false");
  }

  function toggleDocumentList(): void {
    const open = dom.documentList.classList.contains("hidden");
    dom.documentList.classList.toggle("hidden", !open);
    dom.currentDocToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderDocumentList();
  }

  // ---- 保存状态 ----

  function renderSaveState(): void {
    if (!saveState) {
      dom.saveStatus.textContent = "已保存";
      dom.saveStatus.className = "save-status";
      dom.btnSave.disabled = true;
      return;
    }
    dom.saveStatus.textContent = saveState.statusText;
    dom.saveStatus.className = "save-status";
    if (saveState.isSaving) dom.saveStatus.classList.add("saving");
    else if (saveState.statusText.startsWith("保存失败")) dom.saveStatus.classList.add("error");
    else if (saveState.hasUnsavedChanges) dom.saveStatus.classList.add("unsaved");
    dom.btnSave.disabled = saveState.isSaving || !saveState.hasUnsavedChanges;
  }

  function syncCurrent(): void {
    const current = currentEditor();
    if (!current) return;
    saveState?.setCurrent(canonicalNotebookJson(current.getDocument()));
    renderSaveState();
    renderToolbar();
    refreshFindAfterEdit();
  }

  async function save(): Promise<boolean> {
    if (!currentState || !saveState) return true;
    if (currentDocumentId === null) return true;
    const current = currentEditor();
    if (!current) return true;
    const path = currentState.projectPath;
    const id = currentDocumentId;

    // 先规范化为版本 2 规范形态，再严格校验与字节上限检查。
    const document = serializeNotebookDocument(current.getDocument());
    const validation = validateNotebookDocument(document);
    if (!validation.ok) {
      return rejectSave(`文档无法保存：${validation.error}`);
    }
    const sizeError = notebookSizeError(JSON.stringify(document));
    if (sizeError) return rejectSave(`文档内容过大：${sizeError}`);

    const state = saveState;
    const result = state.save((content) => dependencies.saveDocument(path, id, content));
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

  // ---- 工具栏 ----

  function runFormatCommand(command: FormatCommand): boolean {
    const current = currentEditor();
    if (!current) return false;
    const result = current.runCommand(command);
    renderToolbar();
    return result;
  }

  function currentEditorAdapter(): EditorAdapter | null {
    return currentEditor();
  }

  function currentHasSelection(): boolean {
    const current = currentEditor();
    if (!current) return false;
    const selection = current.getSelection();
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

  function disableToolbarControls(): void {
    dom.paragraphStyle.disabled = true;
    dom.btnBold.disabled = true;
    dom.btnItalic.disabled = true;
    dom.btnToolbarUnderline.disabled = true;
    dom.btnToolbarStrike.disabled = true;
    dom.btnBulletList.disabled = true;
    dom.btnOrderedList.disabled = true;
    dom.btnUndo.disabled = true;
    dom.btnRedo.disabled = true;
    for (const control of drawerControls) control.disabled = true;
  }

  function renderToolbar(): void {
    const current = currentEditor();
    if (!current) {
      disableToolbarControls();
      return;
    }
    const selection = current.getSelection();
    const hasSelection = selection.from < selection.to;
    const format = analyzeSelection(
      canonicalDoc(current.getDocument()),
      selection.from,
      selection.to,
    );
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

    dom.paragraphStyle.disabled = !hasSelection;
    dom.btnBold.disabled = !hasSelection;
    dom.btnItalic.disabled = !hasSelection;
    dom.btnToolbarUnderline.disabled = !hasSelection;
    dom.btnToolbarStrike.disabled = !hasSelection;
    dom.btnBulletList.disabled = !hasSelection;
    dom.btnOrderedList.disabled = !hasSelection;
    dom.btnUndo.disabled = !canUndo;
    dom.btnRedo.disabled = !canRedo;
    for (const control of drawerControls) control.disabled = !hasSelection;
  }

  function runSelectionCommand(command: FormatCommand): void {
    if (currentHasSelection()) runFormatCommand(command);
  }

  function onEditorSelectionChange(): void {
    renderToolbar();
    updateLinkPopover();
  }

  // ---- 文档加载与切换 ----

  async function loadDocument(documentId: string): Promise<void> {
    if (!currentState) return;
    const generation = ++loadGeneration;
    const content = await dependencies.readDocument(currentState.projectPath, documentId);
    if (generation !== loadGeneration || !currentState) return;
    const document = parseNotebookDocumentJson(content).document;
    const next = dependencies.createEditor(dom.editorTextarea, document);
    disposeEditor();
    editor = next;
    currentDocumentId = documentId;
    saveState = new EditorSaveState(canonicalNotebookJson(document));
    unsubscribeEdit = next.onEdit(() => {
      if (editor === next) syncCurrent();
    });
    unsubscribeSelection = next.onSelectionChange(() => {
      if (editor === next) onEditorSelectionChange();
    });
    if (memoryStorage) writeLastDocumentId(memoryStorage, currentState.projectPath, documentId);
    aiFeature?.resetSelectionEntry();
    hideLinkPopover();
    closeContextMenu();
    renderCurrentDocument();
    renderSaveState();
    renderToolbar();
  }

  /** 切换当前文档：先静默保存当前文档，保存失败阻止切换并提示。 */
  async function switchDocument(documentId: string): Promise<void> {
    if (documentId === currentDocumentId) {
      closeDocumentList();
      return;
    }
    if (!await save()) {
      alert("保存失败，无法切换文档。请重试保存后再切换。");
      return;
    }
    closeDocumentList();
    await loadDocument(documentId);
  }

  async function guardCurrentLeave(): Promise<boolean> {
    const dirty = saveState?.hasUnsavedChanges ?? false;
    if (dirty) {
      dom.editorTextarea.inert = true;
    }
    try {
      return await leave.run();
    } finally {
      dom.editorTextarea.inert = false;
    }
  }

  async function showProject(projectState: ProjectTreeState): Promise<void> {
    const generation = ++loadGeneration;
    const resolved = memoryStorage
      ? resolveCurrentDocument(
          projectState.tree,
          readLastDocumentId(memoryStorage, projectState.projectPath),
        )
      : resolveCurrentDocument(projectState.tree, null);
    if (memoryStorage && resolved.invalidMemory) {
      clearLastDocumentId(memoryStorage, projectState.projectPath);
    }

    const documentId = resolved.documentId;
    let document: JSONContent;
    if (documentId !== null) {
      const content = await dependencies.readDocument(projectState.projectPath, documentId);
      if (generation !== loadGeneration) return;
      document = parseNotebookDocumentJson(content).document;
    } else {
      document = emptyNotebookDocument().document;
    }

    // 事务式替换：先读正文 + 构造新编辑器，成功后一次性交换再销毁旧组合。
    const next = documentId !== null ? dependencies.createEditor(dom.editorTextarea, document) : null;
    const nextSaveState = documentId !== null
      ? new EditorSaveState(canonicalNotebookJson(document))
      : null;

    disposeEditor();
    currentState = projectState;
    currentDocumentId = documentId;
    editor = next;
    saveState = nextSaveState;
    if (next) {
      unsubscribeEdit = next.onEdit(() => {
        if (editor === next) syncCurrent();
      });
      unsubscribeSelection = next.onSelectionChange(() => {
        if (editor === next) onEditorSelectionChange();
      });
    }
    aiFeature?.beginProject();
    dom.currentProjectName.textContent = projectState.projectName;
    renderCurrentDocument();
    renderSaveState();
    renderToolbar();
    closeDocumentList();
    showPage(pages, "editor-page");
  }

  function applyTree(tree: ContentTree): void {
    if (!currentState) return;
    currentState.tree = tree;
    if (currentDocumentId !== null && !isDocumentInTree(tree, currentDocumentId)) {
      // 当前文档被删除：丢弃其未保存内容，回退到第一篇或空态。
      if (memoryStorage) clearLastDocumentId(memoryStorage, currentState.projectPath);
      const first = firstDocument(tree);
      if (first) {
        void loadDocument(first.id);
      } else {
        disposeEditor();
        currentDocumentId = null;
        saveState = null;
        aiFeature?.resetSelectionEntry();
        renderCurrentDocument();
        renderSaveState();
        renderToolbar();
      }
      return;
    }
    renderCurrentDocument();
  }

  // ---- 事件绑定 ----

  dom.btnSave.addEventListener("click", () => { void save(); });
  dom.currentDocToggle.addEventListener("click", toggleDocumentList);

  // 工具栏按钮：mousedown 时阻止抢焦点，否则点击按钮会让编辑器失焦、选区丢失。
  const toolbarButtons = [
    dom.btnBold,
    dom.btnItalic,
    dom.btnToolbarUnderline,
    dom.btnToolbarStrike,
    dom.btnBulletList,
    dom.btnOrderedList,
    dom.btnUndo,
    dom.btnRedo,
    dom.btnFind,
    dom.btnMargin,
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
    dom.btnCtxLinkCreate,
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
  dom.editorTextarea.addEventListener("dragover", (event) => event.preventDefault());

  // 工具栏命令
  dom.btnBold.addEventListener("click", () => runSelectionCommand({ kind: "bold" }));
  dom.btnItalic.addEventListener("click", () => runSelectionCommand({ kind: "italic" }));
  dom.btnToolbarUnderline.addEventListener("click", () => runSelectionCommand({ kind: "underline" }));
  dom.btnToolbarStrike.addEventListener("click", () => runSelectionCommand({ kind: "strike" }));
  dom.btnBulletList.addEventListener("click", () => runSelectionCommand({ kind: "bulletList" }));
  dom.btnOrderedList.addEventListener("click", () => runSelectionCommand({ kind: "orderedList" }));
  dom.btnUndo.addEventListener("click", () => runFormatCommand({ kind: "undo" }));
  dom.btnRedo.addEventListener("click", () => runFormatCommand({ kind: "redo" }));
  dom.btnFind.addEventListener("click", () => openFindBar("find"));
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

  // ---- 抽屉折叠（disclosure） ----
  function setupDrawerToggle(button: HTMLButtonElement): void {
    button.addEventListener("click", () => {
      const group = button.closest(".drawer-group");
      if (!group) return;
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }
  setupDrawerToggle(dom.btnToggleCharacterSection);
  setupDrawerToggle(dom.btnToggleParagraphSection);

  // ---- 抽屉自动隐藏 ----
  dom.formatDrawer.addEventListener("mouseleave", () => {
    if (typeof window === "undefined") return;
    if (drawerCloseTimer !== null) clearTimeout(drawerCloseTimer);
    drawerCloseTimer = setTimeout(() => {
      drawerCloseTimer = null;
      setFormatDrawerOpen(false);
    }, DRAWER_CLOSE_DELAY_MS);
  });
  dom.formatDrawer.addEventListener("mouseenter", () => {
    if (drawerCloseTimer !== null) {
      clearTimeout(drawerCloseTimer);
      drawerCloseTimer = null;
    }
  });

  // ---- 留白（显示偏好，持久化到 localStorage，缺失回退默认档） ----
  function getLocalStorage(): StorageLike | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage ?? null;
    } catch {
      return null;
    }
  }

  function applyMarginPreset(preset: MarginPreset): void {
    marginPreset = preset;
    dom.editorPage.setAttribute("data-margin", preset);
    dom.btnMargin.textContent = MARGIN_LABELS[preset];
  }

  const savedStorage = getLocalStorage();
  applyMarginPreset(savedStorage ? readMarginPreset(savedStorage) : DEFAULT_MARGIN_PRESET);

  dom.btnMargin.addEventListener("click", () => {
    const next = nextMarginPreset(marginPreset);
    applyMarginPreset(next);
    const storage = getLocalStorage();
    if (storage) writeMarginPreset(storage, next);
  });

  // 抽屉：字符格式
  dom.btnUnderline.addEventListener("click", () => runSelectionCommand({ kind: "underline" }));
  dom.btnStrike.addEventListener("click", () => runSelectionCommand({ kind: "strike" }));
  dom.selectFontFamily.addEventListener("change", () => {
    runSelectionCommand({ kind: "fontFamily", font: dom.selectFontFamily.value || null });
  });
  dom.selectFontSize.addEventListener("change", () => {
    runSelectionCommand({ kind: "fontSize", size: dom.selectFontSize.value || null });
  });
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

  function runFind(): void {
    const current = currentEditorAdapter();
    if (!current) return;
    findCount = current.setFind(dom.findInput.value, dom.findCaseSensitive.checked);
    findIndex = findCount > 0 ? 0 : -1;
    renderFindCount();
  }

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
    const current = currentEditorAdapter();
    if (current && dom.findInput.value !== "") current.setFind("", dom.findCaseSensitive.checked);
    findCount = 0;
    findIndex = -1;
    renderFindCount();
    current?.focus();
  }

  function stepFind(delta: 1 | -1): void {
    const current = currentEditorAdapter();
    if (!current || findCount === 0) return;
    findIndex = (findIndex + delta + findCount) % findCount;
    current.activateMatch(findIndex);
    renderFindCount();
  }

  dom.findInput.addEventListener("input", runFind);
  dom.findCaseSensitive.addEventListener("change", runFind);
  dom.btnFindPrev.addEventListener("click", () => stepFind(-1));
  dom.btnFindNext.addEventListener("click", () => stepFind(1));
  dom.btnReplace.addEventListener("click", () => {
    const current = currentEditorAdapter();
    if (!current || findCount === 0) return;
    current.replaceCurrent(dom.replaceInput.value);
  });
  dom.btnReplaceAll.addEventListener("click", () => {
    const current = currentEditorAdapter();
    if (!current || findCount === 0) return;
    current.replaceAll(dom.replaceInput.value);
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

  function updateLinkPopover(): void {
    const current = currentEditorAdapter();
    if (!current) {
      hideLinkPopover();
      return;
    }
    const { from, to, head } = current.getSelection();
    const href = linkHrefAt(current.getDocument(), from, to);
    if (href === null) {
      hideLinkPopover();
      return;
    }
    popoverHref = href;
    const coords = current.coordinatesAt(head);
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
    const current = currentEditorAdapter();
    if (!current) return;
    hideLinkPopover();
    const { from, to } = current.getSelection();
    const hasSelection = from < to;
    contextMenuHref = linkHrefAt(current.getDocument(), from, to);

    dom.btnCtxCut.disabled = !hasSelection;
    dom.btnCtxCopy.disabled = !hasSelection;
    dom.btnCtxLinkCreate.classList.toggle("hidden", !hasSelection || contextMenuHref !== null);
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

  dom.editorTextarea.addEventListener("contextmenu", (event) => openContextMenu(event as MouseEvent));

  dom.btnCtxCut.addEventListener("click", () => {
    closeContextMenu();
    const current = currentEditorAdapter();
    if (!current) return;
    current.focus();
    void current.cutSelection();
  });
  dom.btnCtxCopy.addEventListener("click", () => {
    closeContextMenu();
    const current = currentEditorAdapter();
    if (!current) return;
    current.focus();
    void current.copySelection().then((ok) => {
      if (!ok) alert("复制失败，请使用 Ctrl+C。");
    });
  });
  dom.btnCtxPaste.addEventListener("click", () => {
    closeContextMenu();
    const current = currentEditorAdapter();
    if (!current) return;
    current.focus();
    const ok = document.execCommand("paste");
    if (!ok) alert("无法直接读取剪贴板内容，请使用 Ctrl+V 粘贴。");
  });
  dom.btnCtxPastePlain.addEventListener("click", () => {
    closeContextMenu();
    const current = currentEditorAdapter();
    if (!current) return;
    current.focus();
    void current.pastePlainText();
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
    if (!dom.documentList.classList.contains("hidden") && !dom.documentList.contains(event.target as Node) &&
        !dom.currentDocToggle.contains(event.target as Node)) {
      closeDocumentList();
    }
  });
  document.addEventListener("scroll", () => {
    closeContextMenu();
    hideLinkPopover();
  }, true);

  // 用捕获阶段监听，先于 ProseMirror 自带的快捷键处理；对冲突键 stopPropagation 避免被重复触发两次。
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      closeContextMenu();
      hideLinkPopover();
      closeFindBar();
      closeDocumentList();
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
      const current = currentEditorAdapter();
      if (current) {
        current.focus();
        void current.pastePlainText();
      }
      return;
    }
    if (mod && key === "k") {
      const current = currentEditorAdapter();
      if (current) {
        const { from, to } = current.getSelection();
        const href = linkHrefAt(current.getDocument(), from, to);
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
    getCurrentDocumentId: () => currentDocumentId,
    getCurrentEditor: () => {
      const current = currentEditor();
      if (current === null) return null;
      return {
        element: dom.editorTextarea,
        getDocument: () => current.getDocument(),
        getSelection: () => current.getSelection(),
        coordinatesAt: (position) => current.coordinatesAt(position),
      };
    },
    attachAi: (ai: AiFeatureController) => {
      aiFeature = ai;
    },
    getProjectPath: () => currentState?.projectPath ?? null,
    getTree: () => currentState?.tree ?? null,
    applyTree,
  };
}
