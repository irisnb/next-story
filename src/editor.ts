import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { EditorSaveState } from "./editor-save-state.ts";
import { LeaveCoordinator } from "./leave-guard.ts";
import type { LeaveDialogController } from "./leave-dialog.ts";
import {
  createRichTextEditor,
  type RichTextEditorAdapter,
} from "./rich-text-editor.ts";
import { saveProject } from "./project-api.ts";
import type { AiFeatureController } from "./ai-feature.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { NotebookTab, ProjectState } from "./types.ts";
import { analyzeSelection, type FormatCommand, type TriState } from "./format-commands.ts";
import {
  canonicalDoc,
  canonicalNotebookJson,
  parseNotebookDocumentJson,
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
    renderToolbar();
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
  }

  // ---- 工具栏 ----

  function runFormatCommand(command: FormatCommand): boolean {
    const editors = projectEditors;
    if (!editors) return false;
    const result = editors[currentTab].runCommand(command);
    renderToolbar();
    return result;
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
  }

  function toggleMoreMenu(): void {
    dom.moreMenu.classList.toggle("hidden");
  }

  function runSelectionCommand(command: FormatCommand): void {
    if (currentHasSelection()) runFormatCommand(command);
  }

  async function save(): Promise<boolean> {
    if (!currentState || !saveState) return true;
    const state = saveState;
    const path = currentState.projectPath;
    const result = state.save((snapshot) => saveProject(path, snapshot.draft, snapshot.main));
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
    disposeProjectEditors();
    currentState = projectState;
    const draftDocument = parseNotebookDocumentJson(projectState.draftContent).document;
    const mainDocument = parseNotebookDocumentJson(projectState.mainContent).document;
    saveState = new EditorSaveState(
      canonicalNotebookJson(draftDocument),
      canonicalNotebookJson(mainDocument),
    );
    const draft = dependencies.createEditor(dom.draftTextarea, draftDocument);
    const main = dependencies.createEditor(dom.mainTextarea, mainDocument);
    const editors: ProjectEditors = {
      draft,
      main,
      unsubscribeDraft: () => {},
      unsubscribeMain: () => {},
    };
    projectEditors = editors;
    editors.unsubscribeDraft = draft.onEdit(() => {
      if (projectEditors === editors) syncCurrent();
    });
    editors.unsubscribeMain = main.onEdit(() => {
      if (projectEditors === editors) syncCurrent();
    });
    // 用 Tiptap 自己的选区事件驱动工具栏状态，比 DOM 事件可靠、稳定。
    draft.onSelectionChange(() => {
      if (projectEditors === editors) renderToolbar();
    });
    main.onSelectionChange(() => {
      if (projectEditors === editors) renderToolbar();
    });
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
    if (value === "heading1") runFormatCommand({ kind: "heading", level: 1 });
    else if (value === "heading2") runFormatCommand({ kind: "heading", level: 2 });
    else runFormatCommand({ kind: "paragraph" });
  });

  // 选区变化已由编辑器 adapter 的 selectionUpdate 事件驱动（见 showProject），
  // 这里不再监听 DOM 事件，避免 mouseup 等时机不可靠导致工具栏状态乱跳。

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") {
      event.preventDefault();
      if (saveState?.hasUnsavedChanges) void save();
      return;
    }
    if (mod && key === "b") {
      event.preventDefault();
      runSelectionCommand({ kind: "bold" });
      return;
    }
    if (mod && key === "i") {
      event.preventDefault();
      runSelectionCommand({ kind: "italic" });
      return;
    }
    if (mod && key === "z") {
      event.preventDefault();
      runFormatCommand(event.shiftKey ? { kind: "redo" } : { kind: "undo" });
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      runFormatCommand({ kind: "redo" });
      return;
    }
  });

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
