import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { confirmDialog, showMessage } from "./app-dialog.ts";
import { createEditorFind, type EditorFind } from "./editor-find.ts";
import { createEditorDocumentView } from "./editor-document-view.ts";
import { createEditorDocumentSession } from "./editor-document-session.ts";
import type { EditorDocumentSession, SessionResult } from "./editor-document-session.ts";
import { canonicalNotebookJson } from "./structured-notebook.ts";
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
  type EditingPauseHandle,
} from "./rich-text-editor.ts";
import { saveDocument, readDocument, openUrl } from "./project-api.ts";
import type { AiFeatureController } from "./ai-feature.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { ContentTree, ProjectLoadIdentity, ProjectTreeState, TreeRefreshAcceptance } from "./types.ts";
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

async function confirmDiscardingCurrentDocument(): Promise<boolean> {
  return await confirmDialog("当前文档有未保存修改。删除后这些修改将丢失，确定继续吗？");
}

export interface EditorController {
  beginWorkspaceTransition(target: string): WorkspaceTransition | null;
  onTransitionChanged(listener: (busy: boolean) => void): () => void;
  showProject(projectState: ProjectTreeState): Promise<void>;
  hasProject(): boolean;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  isTransitioning(): boolean;
  guardLeave(): Promise<boolean>;
  unload(): void;
  destroy(): void;
  getCurrentDocumentId(): string | null;
  getCurrentEditor(): SelectionEntryEditor | null;
  attachAi(ai: AiFeatureController): void;
  /** 文件管理页读取当前作品路径与树（只读）。 */
  getProjectPath(): string | null;
  getProjectIdentity(): ProjectLoadIdentity | null;
  getTree(): ContentTree | null;
  /** 文件管理操作后刷新树；当前文档被删除时回退到第一篇或空态。 */
  applyTree(tree: ContentTree, acceptance?: TreeRefreshAcceptance): Promise<SessionResult>;
}

/** 应用层持有到共同提交/取消；与切文档共享同一把所有权锁。 */
export interface WorkspaceTransition {
  protect(): Promise<void>;
  authorize(): Promise<boolean>;
  prepare(project: ProjectTreeState): Promise<{ commit(installPeer: () => void): void; dispose(): void }>;
  unload(unloadPeer: () => void): void;
  isCurrent(): boolean;
  release(): void;
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
  | "pauseEditing"
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
  type TransitionRecord = {
    token: number;
    target: string;
    originalEditor: EditorAdapter | null;
    focusTarget: HTMLElement | null;
    pause: EditingPauseHandle | null;
    committed: boolean;
    focusTaken: boolean;
    stopTracking(): void;
  };
  let transition: TransitionRecord | null = null;
  let transitionSequence = 0;
  const transitionListeners = new Set<(busy: boolean) => void>();
  function notifyTransition(): void {
    for (const listener of transitionListeners) listener(transition !== null);
  }
  const transitionStatus = dom.editorPage.ownerDocument.createElement("div");
  transitionStatus.setAttribute("role", "status");
  transitionStatus.setAttribute("aria-live", "polite");
  dom.editorPage.appendChild(transitionStatus);

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
    session?.invalidate();
    transitionSequence += 1;
    if (transition) {
      const active = transition;
      transition = null;
      active.committed = true;
      try { active.pause?.resume(); }
      finally { clearTransitionRecovery(active); }
    }
    transitionStatus.textContent = "";
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
    notifyTransition();
    aiFeature?.endProject();
  }

  const leave = new LeaveCoordinator({
    isDirty: () => persistence.hasUnsavedChanges(),
    choose: () => leaveDialog.choose({ restoreFocusExternally: transition !== null }),
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
    isTransitioning: () => transition !== null,
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
    return transition ? null : currentEditor();
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
    onDocumentLoaded: (project, documentId) => {
      // 文档切换（含内容树回落换绑）：只更新视图与记忆，不触发作品级 AI 重置（P0-3 修复）。
      if (memoryStorage && documentId !== null) writeLastDocumentId(memoryStorage, project.projectPath, documentId);
      refreshEditorView(project);
    },
    onProjectLoaded: (project, documentId) => {
      // 两侧身份均安装后才发布记忆、视图与 AI 生命周期。
      // 作品边界（打开/重开作品）：更新视图与记忆，并执行 AI 面板作品级初始化。
      if (memoryStorage && documentId !== null) writeLastDocumentId(memoryStorage, project.projectPath, documentId);
      aiFeature?.beginProject();
      refreshEditorView(project);
    },
    onTreeRefreshed: (project, documentId) => {
      // 树刷新（作品与文档身份未变化）：只更新视图，不重置 AI 面板或在途请求。
      if (memoryStorage && documentId !== null) writeLastDocumentId(memoryStorage, project.projectPath, documentId);
      refreshEditorView(project);
    },
    beforeLoadProject: () => {},
    resolveDocumentId: (project) => {
      const resolved = resolveCurrentDocument(
        project.tree,
        memoryStorage ? readLastDocumentId(memoryStorage, project.projectPath) : null,
      );
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

  function setTransitionStatus(text: string): void {
    transitionStatus.textContent = text;
  }

  function ownsTransition(token: number): boolean {
    return transition?.token === token;
  }

  function clearTransitionRecovery(active: TransitionRecord): void {
    active.stopTracking();
    active.pause = null;
    active.focusTarget = null;
    active.originalEditor = null;
  }

  function registerTransition(token: number, target: string): void {
    const document = dom.editorPage.ownerDocument;
    const focused = document.activeElement as HTMLElement | null;
    const active: TransitionRecord = {
      token, target, originalEditor: currentEditor(),
      focusTarget: focused && typeof focused.focus === "function" ? focused : null,
      pause: null, committed: false, focusTaken: false,
      stopTracking: () => document.removeEventListener("focusin", onFocus, true),
    };
    // Compare actual nodes/containers, not UI classes or global focus prohibitions.
    const navigation = [dom.btnBackWelcome, dom.tabWriting, dom.tabFiles, dom.tabSettings,
      dom.currentDocToggle, dom.documentList];
    function onFocus(event: FocusEvent): void {
      const node = event.target as Node | null;
      if (!node || node === document.body || node === document.documentElement) return;
      if (node === active.focusTarget || dom.editorTextarea.contains(node) || dom.leaveDialog.contains(node)) return;
      if (navigation.some((control) => control?.contains(node))) return;
      active.focusTaken = true;
    }
    transition = active;
    document.addEventListener("focusin", onFocus, true);
    try { notifyTransition(); }
    catch (error) {
      if (ownsTransition(token)) transition = null;
      clearTransitionRecovery(active);
      throw error;
    }
  }

  function canRestoreFocus(target: HTMLElement): boolean {
    if (!target.isConnected || target.matches(":disabled")) return false;
    for (let node: HTMLElement | null = target; node; node = node.parentElement) {
      if (node.inert || node.hidden) return false;
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
    }
    return target !== target.ownerDocument.body && target !== target.ownerDocument.documentElement &&
      (target.tabIndex >= 0 || target.isContentEditable || target.hasAttribute("tabindex"));
  }

  async function protectCurrentEditor(token: number, target: string): Promise<EditorAdapter | null> {
    const current = currentEditor();
    if (!current) return null;
    setTransitionStatus(`正在切换到《${target}》，请先完成正在输入的文字。`);
    const pause = await current.pauseEditing();
    if (!ownsTransition(token) || current !== currentEditor()) { pause.resume(); return null; }
    transition!.pause = pause;
    syncCurrent();
    dom.btnReplace.disabled = true;
    dom.btnReplaceAll.disabled = true;
    toolbar?.render();
    const label = dom.currentDocumentName.textContent ?? "当前文档";
    setTransitionStatus(`正在保存《${label}》，随后切换到《${target}》。暂时不能编辑。`);
    return current;
  }

  function releaseTransition(token: number): void {
    if (!ownsTransition(token)) return;
    const active = transition!;
    transition = null;
    try {
      active.pause?.resume();
      transitionStatus.textContent = "";
      persistence.render();
      toolbar?.render();
      find?.refreshFindAfterEdit();
      if (currentState) documentView.render();
      notifyTransition();
      // Listeners may synchronously start (and even finish) another operation or unload.
      const stillValid = () => transition === null && transitionSequence === token &&
        !active.committed && active.originalEditor !== null && active.originalEditor === currentEditor();
      if (!stillValid() || !active.pause?.restoreSelection()) return;
      if (!stillValid() || active.focusTaken) return;
      const target = active.focusTarget;
      if (!target || !canRestoreFocus(target)) return;
      const inEditor = dom.editorTextarea.contains(target);
      const isButton = target.tagName === "BUTTON";
      // An original external input never warrants transiently focusing the editor.
      if (!inEditor && !isButton) return;
      if (!active.pause.restoreSelection({ syncDOM: true })) return;
      if (!inEditor && stillValid() && !active.focusTaken && canRestoreFocus(target)) target.focus();
    } finally { clearTransitionRecovery(active); }
  }

  async function switchDocument(documentId: string): Promise<void> {
    if (transition) {
      setTransitionStatus(`正在切换到《${transition.target}》，请完成后再操作。`);
      return;
    }
    if (documentId === currentDocumentId) {
      documentView.closeList();
      return;
    }
    const token = ++transitionSequence;
    const target = currentState?.tree.nodes[documentId]?.name ?? "目标文档";
    registerTransition(token, target);
    try {
      const current = await protectCurrentEditor(token, target);
      if (!current || !ownsTransition(token)) return;
      const snapshot = canonicalNotebookJson(current.getDocument());
      if (!await save()) {
        if (ownsTransition(token)) showMessage("保存失败，未切换。当前内容已保留。");
        return;
      }
      if (!ownsTransition(token) || current !== currentEditor()) return;
      syncCurrent();
      if (canonicalNotebookJson(current.getDocument()) !== snapshot) {
        throw new Error("切换期间检测到新增修改，已停止切换并保留输入");
      }
      if (persistence.hasUnsavedChanges()) {
        if (!await save()) {
          if (ownsTransition(token)) showMessage("保存失败，未切换。当前内容已保留。");
          return;
        }
      }
      if (!ownsTransition(token) || current !== currentEditor() || persistence.hasUnsavedChanges()) {
        return;
      }
      setTransitionStatus(`正在打开《${target}》，暂时不能编辑，请稍候。`);
      const candidate = await session!.prepareDocument(documentId);
      if (candidate.status !== "prepared") {
        if (candidate.status === "failed") throw candidate.error;
        return;
      }
      if (!ownsTransition(token) || current !== currentEditor()) {
        candidate.dispose();
        return;
      }
      syncCurrent();
      if (persistence.hasUnsavedChanges() || canonicalNotebookJson(current.getDocument()) !== snapshot) {
        candidate.dispose();
        throw new Error("切换期间检测到新增修改，已停止切换并保留输入");
      }
      documentView.closeList();
      const result = candidate.commit();
      if (result.status === "committed") {
        transition!.committed = true;
      } else if (result.status === "failed") throw result.error;
    } catch (error) {
      if (ownsTransition(token)) showMessage(`未能打开《${target}》：${error instanceof Error ? error.message : String(error)}。仍保留当前文档，可继续编辑。`);
    } finally {
      releaseTransition(token);
    }
  }

  async function guardCurrentLeave(): Promise<boolean> {
    if (transition) return false;
    const dirty = persistence.hasUnsavedChanges();
    if (dirty) dom.editorTextarea.inert = true;
    try {
      return await leave.run();
    } finally {
      dom.editorTextarea.inert = false;
    }
  }

  function beginWorkspaceTransition(target: string): WorkspaceTransition | null {
    if (transition) return null;
    const token = ++transitionSequence;
    registerTransition(token, target);
    let protectedEditor: EditorAdapter | null = null;
    let snapshot: string | null = null;
    let protection: Promise<void> | null = null;
    const check = () => {
      if (!ownsTransition(token) || protectedEditor !== currentEditor()) throw new Error("作品装载已失效");
      if (protectedEditor && canonicalNotebookJson(protectedEditor.getDocument()) !== snapshot) {
        syncCurrent();
        throw new Error("切换期间检测到新增修改，已停止切换并保留输入");
      }
    };
    const protect = () => protection ??= (async () => {
      protectedEditor = await protectCurrentEditor(token, target);
      if (!ownsTransition(token)) throw new Error("作品装载已失效");
      snapshot = protectedEditor ? canonicalNotebookJson(protectedEditor.getDocument()) : null;
    })();
    return {
      protect,
      async authorize() {
        await protect();
        check();
        const allowed = await leave.run();
        check();
        if (!allowed && dom.saveStatus.textContent?.startsWith("保存失败")) {
          throw new Error(`${dom.saveStatus.textContent}。当前内容已保留。`);
        }
        return allowed;
      },
      async prepare(project) {
        await protect();
        check();
        setTransitionStatus(`正在打开《${project.projectName}》，暂时不能编辑，请稍候。`);
        const candidate = await session!.prepareProject(project);
        if (candidate.status !== "prepared") throw candidate.status === "failed" ? candidate.error : new Error("作品装载已失效");
        try { check(); } catch (error) { candidate.dispose(); throw error; }
        return {
          dispose: candidate.dispose,
          commit(installPeer) {
            try {
              check();
              const result = candidate.commit(installPeer);
              if (result.status !== "committed") throw result.status === "failed" ? result.error : new Error("作品装载已失效");
              transition!.committed = true;
              setupEditorInteractionModules();
            } finally { candidate.dispose(); }
          },
        };
      },
      unload(unloadPeer) { check(); unloadPeer(); unload(); },
      isCurrent: () => ownsTransition(token),
      release: () => releaseTransition(token),
    };
  }

  async function showProject(projectState: ProjectTreeState): Promise<void> {
    if (transition) throw new Error("正在处理上一次切换，请完成后再操作。");
    const token = ++transitionSequence;
    const target = projectState.projectName;
    registerTransition(token, target);
    try {
      const current = await protectCurrentEditor(token, target);
      if (!ownsTransition(token)) throw new Error("作品装载已失效");
      const snapshot = current ? canonicalNotebookJson(current.getDocument()) : null;
      // The host owns leave authorization (including discard); do not implicitly save here.
      const candidate = await session!.prepareProject(projectState);
      if (candidate.status === "failed") throw candidate.error;
      if (candidate.status !== "prepared") throw new Error("作品装载已失效");
      if (!ownsTransition(token) || current !== currentEditor()) { candidate.dispose(); throw new Error("作品装载已失效"); }
      if (current && canonicalNotebookJson(current.getDocument()) !== snapshot) {
        candidate.dispose();
        syncCurrent();
        throw new Error("切换期间检测到新增修改，已停止切换并保留输入");
      }
      const result = candidate.commit();
      if (result.status !== "committed") throw result.status === "failed" ? result.error : new Error("作品装载已失效");
      if (result.status === "committed") {
        setupEditorInteractionModules();
        transition!.committed = true;
      }
    } finally {
      releaseTransition(token);
    }
  }

  async function applyTree(tree: ContentTree, acceptance?: TreeRefreshAcceptance): Promise<SessionResult> {
    if (transition) return { status: "busy" };
    const isCurrent = acceptance?.isCurrent ?? (() => true);
    if (!isCurrent()) return { status: "stale" };
    const installPeer = () => {
      acceptance?.installPeer();
      // 两侧树已安装；同步发布，不能再让一次 await 插入更新装载/刷新。
      acceptance?.onAccepted?.();
    };
    const current = currentState;
    const docId = currentDocumentId;
    const needsFallback = !!current && (docId === null || !isDocumentInTree(tree, docId));
    if (!needsFallback) {
      return session!.applyTree(tree, isCurrent, installPeer);
    }
    const nextId = firstDocument(tree)?.id ?? null;
    const token = ++transitionSequence;
    const target = nextId ? tree.nodes[nextId]?.name ?? "目标文档" : "空写作区";
    registerTransition(token, target);
      try {
        const protectedEditor = await protectCurrentEditor(token, target);
        if (protectedEditor !== currentEditor() || !ownsTransition(token) || !isCurrent()) return { status: "stale" };
        if (persistence.hasUnsavedChanges() && !(await confirmDiscardingCurrentDocument())) return { status: "cancelled" };
        if (!isCurrent()) return { status: "stale" };
        const snapshot = protectedEditor ? canonicalNotebookJson(protectedEditor.getDocument()) : null;
        setTransitionStatus(`正在打开《${target}》，暂时不能编辑，请稍候。`);
        const candidate = await session!.prepareDocument(nextId, tree);
        if (!ownsTransition(token) || !isCurrent()) {
          if (candidate.status === "prepared") candidate.dispose();
          return { status: "stale" };
        }
        if (candidate.status === "failed") throw candidate.error;
        if (candidate.status !== "prepared") return candidate;
        if (protectedEditor !== currentEditor()) { candidate.dispose(); return { status: "stale" }; }
        if (protectedEditor && canonicalNotebookJson(protectedEditor.getDocument()) !== snapshot) {
          candidate.dispose();
          syncCurrent();
          throw new Error("切换期间检测到新增修改，已停止切换并保留输入");
        }
        const result = candidate.commit(installPeer);
        if (result.status === "failed") throw result.error;
        if (result.status === "committed") {
          transition!.committed = true;
        }
        return result;
      } catch (error) {
        if (!ownsTransition(token) || !isCurrent()) return { status: "stale" };
        const failure = error instanceof Error ? error : new Error(String(error));
        if (!acceptance) showMessage(`未能打开《${target}》：${failure.message}。仍保留当前文档，可继续编辑。`);
        return { status: "failed", error: failure };
      } finally { releaseTransition(token); }
  }

  // ---- 事件绑定 ----

  dom.btnSave.addEventListener("click", () => { void save(); });
  dom.currentDocToggle.addEventListener("click", documentView.toggleList);
  dom.currentDocToggle.addEventListener("mousedown", (event) => event.preventDefault());

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

  function setupEditorInteractionModules(): void {
    setupFindModule();
    setupToolbarModule();
    setupLinkPopover();
    setupInteractionModules();
  }

  document.addEventListener("mousedown", (event) => {
    if (!dom.linkPopover.classList.contains("hidden") && !dom.linkPopover.contains(event.target as Node)) linkPopover?.hide();
    if (!dom.documentList.classList.contains("hidden") && !dom.documentList.contains(event.target as Node) && !dom.currentDocToggle.contains(event.target as Node)) documentView.closeList();
  });
  document.addEventListener("scroll", () => { contextMenu?.close(); linkPopover?.hide(); }, true);

  // 初始接线：首个作品打开前查找栏、工具栏等交互模块即可用（与旧行为一致）。
  setupEditorInteractionModules();

  return {
    beginWorkspaceTransition,
    onTransitionChanged(listener) { transitionListeners.add(listener); return () => { transitionListeners.delete(listener); }; },
    showProject,
    hasProject: () => currentState !== null,
    hasUnsavedChanges: () => persistence.hasUnsavedChanges(),
    save,
    isTransitioning: () => transition !== null,
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
    getProjectIdentity: () => currentState?.loadIdentity ?? null,
    getTree: () => currentState?.tree ?? null,
    applyTree,
  };
}
