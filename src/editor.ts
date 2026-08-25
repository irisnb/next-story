import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { createEditorFind, type EditorFind } from "./editor-find.ts";
import { createEditorDocumentView } from "./editor-document-view.ts";
import { createEditorDocumentSession } from "./editor-document-session.ts";
import type { EditorDocumentSession } from "./editor-document-session.ts";
import { createEditorPersistence } from "./editor-persistence.ts";
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
import { saveDocument, readDocument, openUrl } from "./project-api.ts";
import type { AiFeatureController } from "./ai-feature.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { ContentTree, ProjectTreeState } from "./types.ts";
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
  /** 打开作品或切换文档时递增，丢弃迟到的异步正文读取结果。 */
  let aiFeature: AiFeatureController | null = null;
  let find: EditorFind | null = null;
  let toolbar: EditorToolbar | null = null;
  let linkPopover: LinkPopover | null = null;
  let contextMenu: EditorContextMenu | null = null;
  let disposeKeyboard: (() => void) | null = null;
  let session: EditorDocumentSession | null = null;

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
    persistence.clear();
    session?.invalidate();
    aiFeature?.endProject();
  }

  const leave = new LeaveCoordinator({
    isDirty: () => persistence.hasUnsavedChanges(),
    choose: leaveDialog.choose,
    save,
  });

  function syncCurrent(): void {
    const current = currentEditor();
    if (!current) return;
    persistence.setCurrent(current.getDocument());
    toolbar?.render();
    find?.refreshFindAfterEdit();
  }

  /** 打开作品、切换文档或树刷新后统一刷新编辑器视图（不触碰 AI 生命周期）。 */
  function refreshEditorView(project: ProjectTreeState): void {
    dom.currentProjectName.textContent = project.projectName;
    linkPopover?.hide();
    contextMenu?.close();
    documentView.render();
    toolbar?.render();
    documentView.closeList();
    showPage(pages, "editor-page");
  }

  async function save(): Promise<boolean> {
    return persistence.save();
  }

  const persistence = createEditorPersistence({
    saveStatus: dom.saveStatus,
    saveButton: dom.btnSave,
    getEditor: currentEditor,
    getProject: () => currentState && currentDocumentId !== null
      ? { projectPath: currentState.projectPath, documentId: currentDocumentId }
      : null,
    write: dependencies.saveDocument,
  });

  const documentView = createEditorDocumentView({
    dom,
    getTree: () => currentState?.tree ?? null,
    getCurrentDocumentId: () => currentDocumentId,
    onSwitchDocument: (documentId) => { void switchDocument(documentId); },
    emptyStateText: EMPTY_STATE_TEXT,
  });

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

  session = createEditorDocumentSession({
    dom,
    readDocument: dependencies.readDocument,
    createEditor: dependencies.createEditor,
    getProject: () => currentState,
    getDocumentId: () => currentDocumentId,
    setProject: (project) => { currentState = project; },
    setDocumentId: (documentId) => { currentDocumentId = documentId; },
    setEditor: (next) => { editor = next as EditorAdapter | null; },
    disposeEditor,
    setBaseline: (document) => persistence.setBaseline(document),
    clearBaseline: () => persistence.clear(),
    onEdit: (next) => {
      unsubscribeEdit?.();
      unsubscribeEdit = next.onEdit(() => {
        if (editor === next) syncCurrent();
      });
      return unsubscribeEdit;
    },
    onSelectionChange: (next) => {
      unsubscribeSelection?.();
      unsubscribeSelection = next.onSelectionChange(() => {
        if (editor === next) onEditorSelectionChange();
      });
      return unsubscribeSelection;
    },
    onLoaded: (project, documentId) => {
      if (memoryStorage && documentId !== null) writeLastDocumentId(memoryStorage, project.projectPath, documentId);
      aiFeature?.resetSelectionEntry();
      aiFeature?.beginProject();
      refreshEditorView(project);
    },
    onTreeRefreshed: (project, documentId) => {
      // 树刷新（作品与文档身份未变化）：只更新视图，不重置 AI 面板或在途请求。
      if (memoryStorage && documentId !== null) writeLastDocumentId(memoryStorage, project.projectPath, documentId);
      refreshEditorView(project);
    },
    beforeLoadProject: (_project) => {
      setupFindModule();
      setupToolbarModule();
      setupLinkPopover();
    },
    resolveDocumentId: (project) => {
      const resolved = resolveCurrentDocument(
        project.tree,
        memoryStorage ? readLastDocumentId(memoryStorage, project.projectPath) : null,
      );
      if (memoryStorage && resolved.invalidMemory) clearLastDocumentId(memoryStorage, project.projectPath);
      return resolved.documentId;
    },
    isDocumentInTree,
    firstDocument,
    hasUnsavedChanges: () => persistence.hasUnsavedChanges(),
    confirmDiscard: confirmDiscardingCurrentDocument,
    clearRememberedDocument: (projectPath) => {
      if (memoryStorage) clearLastDocumentId(memoryStorage, projectPath);
    },
  });

  async function loadDocument(documentId: string): Promise<void> {
    await session!.loadDocument(documentId);
  }

  /** 切换当前文档：先静默保存当前文档，保存失败阻止切换并提示。 */
  async function switchDocument(documentId: string): Promise<void> {
    if (documentId === currentDocumentId) {
      documentView.closeList();
      return;
    }
    if (!await save()) {
      alert("保存失败，无法切换文档。请重试保存后再切换。");
      return;
    }
    documentView.closeList();
    await loadDocument(documentId);
  }

  async function guardCurrentLeave(): Promise<boolean> {
    const dirty = persistence.hasUnsavedChanges();
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
    await session!.showProject(projectState);
  }

  function applyTree(tree: ContentTree): void {
    session!.applyTree(tree);
  }

  // ---- 事件绑定 ----

  dom.btnSave.addEventListener("click", () => { void save(); });
  dom.currentDocToggle.addEventListener("click", documentView.toggleList);

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
      hasUnsavedChanges: () => persistence.hasUnsavedChanges(),
      format: (command) => { toolbar?.runFormatCommand(command); },
      linkActions: createLinkActions({
        runFormatCommand: (command) => toolbar?.runFormatCommand(command) ?? false,
        openUrl,
      }),
    });
  }

  document.addEventListener("mousedown", (event) => {
    if (!dom.linkPopover.classList.contains("hidden") && !dom.linkPopover.contains(event.target as Node)) linkPopover?.hide();
    if (!dom.documentList.classList.contains("hidden") && !dom.documentList.contains(event.target as Node) && !dom.currentDocToggle.contains(event.target as Node)) documentView.closeList();
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
    hasUnsavedChanges: () => persistence.hasUnsavedChanges(),
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
