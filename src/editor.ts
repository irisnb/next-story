import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { EditorSaveState } from "./editor-save-state.ts";
import { createEditorFind, type EditorFind } from "./editor-find.ts";
import { createEditorToolbar, type EditorToolbar } from "./editor-toolbar.ts";
import { createLinkPopover, type LinkPopover } from "./editor-link-popover.ts";
import { createEditorContextMenu, type EditorContextMenu } from "./editor-context-menu.ts";
import { createEditorKeyboard } from "./editor-keyboard.ts";
import {
  createLinkActions,
} from "./editor-link-actions.ts";
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
import {
  canonicalNotebookJson,
  serializeNotebookDocument,
  parseNotebookDocumentJson,
  validateNotebookDocument,
  emptyNotebookDocument,
} from "./structured-notebook.ts";
import { showPage } from "./views.ts";
import {
  clearLastDocumentId,
  readLastDocumentId,
  writeLastDocumentId,
} from "./document-memory.ts";
import {
  resolveLocalStorage,
  type StorageLike,
} from "./shared-storage-and-selection-identity.ts";
import {
  firstDocument,
  flattenDocuments,
  isDocumentInTree,
  resolveCurrentDocument,
} from "./content-tree.ts";

const EMPTY_STATE_TEXT = "这里还没有文档，去文件管理新建一篇吧";

function confirmDiscardingCurrentDocument(): boolean {
  if (typeof globalThis.confirm !== "function") return true;
  return globalThis.confirm("当前文档有未保存修改。删除后这些修改将丢失，确定继续吗？");
}

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
  memoryStorage?: StorageLike | null;
  /** 留白偏好存储；未注入时由 setupEditor 调用共享解析入口。 */
  marginStorage?: StorageLike | null;
}

const defaultDependencies: EditorDependencies = {
  createEditor: createRichTextEditor,
  readDocument,
  saveDocument,
};

export function setupEditor(
  dom: AppDom,
  leaveDialog: LeaveDialogController,
  dependencies: EditorDependencies = defaultDependencies,
): EditorController {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];
  const memoryStorage: StorageLike | null =
    dependencies.memoryStorage !== undefined
      ? dependencies.memoryStorage
      : resolveLocalStorage();
  const marginStorage: StorageLike | null =
    dependencies.marginStorage !== undefined
      ? dependencies.marginStorage
      : resolveLocalStorage();
  let currentState: ProjectTreeState | null = null;
  let currentDocumentId: string | null = null;
  let editor: EditorAdapter | null = null;
  let unsubscribeEdit: (() => void) | null = null;
  let unsubscribeSelection: (() => void) | null = null;
  let saveState: EditorSaveState | null = null;
  /** 打开作品或切换文档时递增，丢弃迟到的异步正文读取结果。 */
  let loadGeneration = 0;
  let aiFeature: AiFeatureController | null = null;
  let find: EditorFind | null = null;
  let toolbar: EditorToolbar | null = null;
  let linkPopover: LinkPopover | null = null;
  let contextMenu: EditorContextMenu | null = null;
  let disposeKeyboard: (() => void) | null = null;

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
    linkPopover?.dispose();
    linkPopover = null;
    contextMenu?.dispose();
    contextMenu = null;
    disposeKeyboard?.();
    disposeKeyboard = null;
    find?.dispose();
    find = null;
    toolbar?.dispose();
    toolbar = null;
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
    toolbar?.render();
    find?.refreshFindAfterEdit();
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

  // ---- 工具栏与格式抽屉（独立模块：工具栏/抽屉 DOM + 编辑器窄能力） ----

  function currentEditorAdapter(): EditorAdapter | null {
    return currentEditor();
  }

  function setupToolbarModule(): void {
    toolbar?.dispose();
    toolbar = createEditorToolbar({
      dom,
      getEditor: currentEditorAdapter,
      marginStorage,
    });
  }

  function onEditorSelectionChange(): void {
    toolbar?.render();
    linkPopover?.update();
  }

  // ---- 文档加载与切换 ----

  async function loadDocument(documentId: string): Promise<void> {
    if (!currentState) return;
    const generation = ++loadGeneration;
    let content: string;
    try {
      content = await dependencies.readDocument(currentState.projectPath, documentId);
    } catch (error) {
      if (generation !== loadGeneration || !currentState) return;
      alert(`读取文档失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (generation !== loadGeneration || !currentState) return;
    let document: JSONContent;
    try {
      document = parseNotebookDocumentJson(content).document;
    } catch (error) {
      if (generation !== loadGeneration || !currentState) return;
      alert(`解析文档失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
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
    linkPopover?.hide();
    contextMenu?.close();
    renderCurrentDocument();
    renderSaveState();
    toolbar?.render();
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
    // 重新接线交互模块：unload 已销毁旧模块，这里重建以恢复查找栏、工具栏等监听。
    setupFindModule();
    setupToolbarModule();
    setupLinkPopover();
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
      let content: string;
      try {
        content = await dependencies.readDocument(projectState.projectPath, documentId);
      } catch (error) {
        if (generation === loadGeneration) {
          alert(`读取文档失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      if (generation !== loadGeneration) return;
      try {
        document = parseNotebookDocumentJson(content).document;
      } catch (error) {
        if (generation === loadGeneration) {
          alert(`解析文档失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
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
    toolbar?.render();
    closeDocumentList();
    showPage(pages, "editor-page");
  }

  function applyTree(tree: ContentTree): void {
    if (!currentState) return;
    if (currentDocumentId !== null && !isDocumentInTree(tree, currentDocumentId)) {
      if (saveState?.hasUnsavedChanges && !confirmDiscardingCurrentDocument()) return;
      currentState.tree = tree;
      // 当前文档被删除：在用户确认后丢弃其未保存内容，回退到第一篇或空态。
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
        toolbar?.render();
      }
      return;
    }
    currentState.tree = tree;
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

  dom.btnFind.addEventListener("click", () => find?.openFindBar("find"));

  // ---- 查找替换（独立模块：查找栏 DOM + 编辑器窄能力） ----

  function setupFindModule(): void {
    find?.dispose();
    find = createEditorFind({
      dom,
      getEditor: currentEditorAdapter,
    });
  }

  // ---- 链接动作（右键菜单与链接弹层共用） ----

  // ---- 链接弹层（独立模块：弹层 DOM + 编辑器窄能力 + 链接动作） ----

  function setupLinkPopover(): void {
    linkPopover?.dispose();
    linkPopover = createLinkPopover({
      dom,
      getEditor: currentEditorAdapter,
      linkActions: createLinkActions({
        runFormatCommand: (command) => toolbar?.runFormatCommand(command) ?? false,
        openUrl,
      }),
    });
  }

  function setupInteractionModules(): void {
    contextMenu?.dispose();
    contextMenu = createEditorContextMenu({
      dom,
      getEditor: currentEditorAdapter,
      linkActions: createLinkActions({
        runFormatCommand: (command) => toolbar?.runFormatCommand(command) ?? false,
        openUrl,
      }),
    });
    disposeKeyboard?.();
    disposeKeyboard = createEditorKeyboard({
      editorRoot: dom.editorTextarea,
      getEditor: currentEditorAdapter,
      closeOverlays: () => { contextMenu?.close(); linkPopover?.hide(); },
      closeFind: () => find?.closeFindBar(),
      openFind: (mode) => find?.openFindBar(mode),
      save: () => { void save(); },
      hasUnsavedChanges: () => saveState?.hasUnsavedChanges ?? false,
      format: (command) => { toolbar?.runFormatCommand(command); },
      linkActions: createLinkActions({
        runFormatCommand: (command) => toolbar?.runFormatCommand(command) ?? false,
        openUrl,
      }),
    });
  }

  document.addEventListener("mousedown", (event) => {
    if (!dom.linkPopover.classList.contains("hidden") && !dom.linkPopover.contains(event.target as Node)) linkPopover?.hide();
    if (!dom.documentList.classList.contains("hidden") && !dom.documentList.contains(event.target as Node) && !dom.currentDocToggle.contains(event.target as Node)) closeDocumentList();
  });
  document.addEventListener("scroll", () => { contextMenu?.close(); linkPopover?.hide(); }, true);

  // 初始接线：首个作品打开前查找栏、工具栏等交互模块即可用（与旧行为一致）。
  setupFindModule();
  setupToolbarModule();
  setupLinkPopover();
  setupInteractionModules();

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
