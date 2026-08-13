import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { JSONContent } from "@tiptap/core";

import type { AiFeatureController } from "../src/ai-feature.ts";
import type { AppDom } from "../src/dom.ts";
import { setupEditor } from "../src/editor.ts";
import type { LeaveDialogController } from "../src/leave-dialog.ts";
import type {
  RichTextEditorCoordinates,
  RichTextEditorSelection,
} from "../src/rich-text-editor.ts";
import { openProject } from "../src/project-api.ts";
import { openProjectAfterAuthorization } from "../src/project-leave-flow.ts";
import type { ProjectOpenResult } from "../src/types.ts";

type Listener = () => void;

function paragraphDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function notebookJson(text: string): string {
  return JSON.stringify({
    format: "next-story-tiptap",
    version: 1,
    document: paragraphDoc(text),
  });
}

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, Listener[]>();
  textContent = "";
  className = "";
  value = "";
  disabled = false;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

class FakeRichTextEditor {
  private readonly listeners = new Set<(document: JSONContent) => void>();
  private document: JSONContent;
  readonly element: HTMLElement;
  readonly capturedListeners: Array<(document: JSONContent) => void> = [];
  destroyed = false;

  constructor(element: HTMLElement, initialDocument: JSONContent) {
    this.element = element;
    this.document = initialDocument;
  }

  getDocument(): JSONContent {
    return this.document;
  }

  onEdit(listener: (document: JSONContent) => void): () => void {
    this.listeners.add(listener);
    this.capturedListeners.push(listener);
    return () => { this.listeners.delete(listener); };
  }

  focus(): void {}

  getSelection(): RichTextEditorSelection {
    return { from: 1, to: 1, head: 1 };
  }

  coordinatesAt(_position: number): RichTextEditorCoordinates {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  edit(document: JSONContent): void {
    this.document = document;
    for (const listener of this.listeners) listener(document);
  }
}

function project(projectPath: string, draftText: string, mainText: string) {
  return {
    projectPath,
    projectName: projectPath,
    draftContent: notebookJson(draftText),
    mainContent: notebookJson(mainText),
  };
}

function editorFixture() {
  const ui = fakeDom();
  const editors: FakeRichTextEditor[] = [];
  const leaveDialog: LeaveDialogController = { choose: async () => "cancel" };
  const editor = setupEditor(ui.dom, leaveDialog, {
    createEditor: (element: HTMLElement, initialDocument: JSONContent) => {
      const created = new FakeRichTextEditor(element, initialDocument);
      editors.push(created);
      return created;
    },
  });
  return { ...ui, editor, editors };
}

function fakeDom(): { readonly dom: AppDom; restore(): void } {
  const elements = new Map<string, FakeElement>();
  const element = <T extends HTMLElement>(id: string): T => {
    const existing = elements.get(id);
    if (existing) return existing as unknown as T;
    const created = new FakeElement();
    elements.set(id, created);
    return created as unknown as T;
  };

  const previousDocument = globalThis.document;
  globalThis.document = {
    addEventListener: () => {},
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Document;

  return {
    dom: {
      welcomePage: element("welcome-page"),
      newProjectPage: element("new-project-page"),
      editorPage: element("editor-page"),
      btnNewProject: element("btn-new-project"),
      btnOpenProject: element("btn-open-project"),
      projectNameInput: element("project-name"),
      saveLocationInput: element("save-location"),
      btnBrowse: element("btn-browse"),
      btnCancelNew: element("btn-cancel-new"),
      btnCreateProject: element("btn-create-project"),
      nameError: element("name-error"),
      locationError: element("location-error"),
      currentProjectName: element("current-project-name"),
      saveStatus: element("save-status"),
      btnSave: element("btn-save"),
      btnBackWelcome: element("btn-back-welcome"),
      tabDraft: element("tab-draft"),
      tabMain: element("tab-main"),
      draftTextarea: element("draft-textarea"),
      mainTextarea: element("main-textarea"),
      llmConfigPage: element("llm-config-page"),
      btnLlmConfig: element("btn-llm-config"),
      btnSettings: element("btn-settings"),
      apiBaseUrlInput: element("api-base-url"),
      apiBaseUrlError: element("api-base-url-error"),
      apiKeyInput: element("api-key"),
      apiKeyError: element("api-key-error"),
      modelNameInput: element("model-name"),
      modelNameError: element("model-name-error"),
      llmSaveStatus: element("llm-save-status"),
      btnSaveConfig: element("btn-save-config"),
      btnTestConfig: element("btn-test-config"),
      btnBackConfig: element("btn-back-config"),
      btnToggleAi: element("btn-toggle-ai"),
      aiPanel: element("ai-panel"),
      aiResponse: element("ai-response"),
      aiConversation: element("ai-conversation"),
      aiFollowUpForm: element("ai-follow-up-form"),
      aiFollowUpInput: element("ai-follow-up-input"),
      aiFollowUpSend: element("ai-follow-up-send"),
      leaveDialog: element("leave-dialog"),
      btnSaveAndLeave: element("btn-save-and-leave"),
      btnDiscardAndLeave: element("btn-discard-and-leave"),
      btnCancelLeave: element("btn-cancel-leave"),
    },
    restore: () => { globalThis.document = previousDocument; },
  };
}

test("resets only the AI selection entry when switching notebook tabs", () => {
  const fixture = editorFixture();
  try {
    let entryResets = 0;
    let projectBegins = 0;
    let projectEnds = 0;
    const ai: AiFeatureController = {
      beginProject: () => { projectBegins += 1; },
      endProject: () => { projectEnds += 1; },
      resetSelectionEntry: () => { entryResets += 1; },
      submitFollowUp: () => false,
      retryFollowUp: () => false,
      editFollowUp: () => false,
    };
    const editor = fixture.editor;

    editor.attachAi(ai);
    editor.showProject(project("project-path", "草稿", "正文"));
    entryResets = 0;
    projectBegins = 0;
    projectEnds = 0;

    fixture.dom.tabMain.click();

    assert.equal(editor.getCurrentTab(), "main");
    assert.equal(entryResets, 1);
    assert.equal(projectBegins, 0);
    assert.equal(projectEnds, 0);
  } finally {
    fixture.restore();
  }
});

test("creates two persistent independent editors without dirtying initialization", () => {
  const fixture = editorFixture();
  try {
    fixture.editor.showProject(project("作品一", "草稿初稿", "正文初稿"));

    assert.equal(fixture.editors.length, 2);
    assert.notEqual(fixture.editors[0], fixture.editors[1]);
    assert.equal(fixture.editors[0]?.element, fixture.dom.draftTextarea);
    assert.equal(fixture.editors[1]?.element, fixture.dom.mainTextarea);
    assert.deepEqual(fixture.editors[0]?.getDocument(), paragraphDoc("草稿初稿"));
    assert.deepEqual(fixture.editors[1]?.getDocument(), paragraphDoc("正文初稿"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);

    fixture.editors[0]?.edit(paragraphDoc("未保存草稿"));
    fixture.dom.tabMain.click();
    fixture.editors[1]?.edit(paragraphDoc("未保存正文"));
    fixture.dom.tabDraft.click();

    assert.equal(fixture.editors.length, 2);
    assert.deepEqual(fixture.editors[0]?.getDocument(), paragraphDoc("未保存草稿"));
    assert.deepEqual(fixture.editors[1]?.getDocument(), paragraphDoc("未保存正文"));
    assert.equal(fixture.editor.hasUnsavedChanges(), true);
  } finally {
    fixture.restore();
  }
});

test("replacing a project destroys both old editors and ignores their late edits", () => {
  const fixture = editorFixture();
  try {
    fixture.editor.showProject(project("作品一", "旧草稿", "旧正文"));
    const oldDraft = fixture.editors[0];
    const oldMain = fixture.editors[1];
    const lateDraftEdit = oldDraft?.capturedListeners[0];

    fixture.editor.showProject(project("作品二", "新草稿", "新正文"));

    assert.equal(oldDraft?.destroyed, true);
    assert.equal(oldMain?.destroyed, true);
    assert.equal(fixture.editors.length, 4);
    assert.deepEqual(fixture.editors[2]?.getDocument(), paragraphDoc("新草稿"));
    assert.deepEqual(fixture.editors[3]?.getDocument(), paragraphDoc("新正文"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);

    lateDraftEdit?.(paragraphDoc("迟到的旧草稿"));

    assert.deepEqual(fixture.editors[2]?.getDocument(), paragraphDoc("新草稿"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.restore();
  }
});

test("unloading destroys both editors and ignores their late edits", () => {
  const fixture = editorFixture();
  try {
    fixture.editor.showProject(project("作品一", "草稿", "正文"));
    const draft = fixture.editors[0];
    const main = fixture.editors[1];
    const lateMainEdit = main?.capturedListeners[0];

    fixture.editor.unload();

    assert.equal(draft?.destroyed, true);
    assert.equal(main?.destroyed, true);
    assert.equal(fixture.editor.hasProject(), false);
    assert.equal(fixture.editor.hasUnsavedChanges(), false);

    lateMainEdit?.(paragraphDoc("迟到的旧正文"));

    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.restore();
  }
});

test("destroying the controller destroys both editors", () => {
  const fixture = editorFixture();
  try {
    fixture.editor.showProject(project("作品一", "草稿", "正文"));
    const draft = fixture.editors[0];
    const main = fixture.editors[1];

    fixture.editor.destroy();

    assert.equal(draft?.destroyed, true);
    assert.equal(main?.destroyed, true);
    assert.equal(fixture.editor.hasProject(), false);
  } finally {
    fixture.restore();
  }
});

test("detects a format-only change as unsaved", () => {
  const fixture = editorFixture();
  try {
    fixture.editor.showProject(project("作品", "正文", "正文"));

    // 只加粗，可见文字不变
    const boldDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }] },
      ],
    };
    fixture.editors[0]?.edit(boldDoc);

    assert.equal(fixture.editor.hasUnsavedChanges(), true);
  } finally {
    fixture.restore();
  }
});

test("reverting format to the saved baseline clears unsaved", () => {
  const fixture = editorFixture();
  try {
    fixture.editor.showProject(project("作品", "正文", "正文"));

    const boldDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }] },
      ],
    };
    fixture.editors[0]?.edit(boldDoc);
    assert.equal(fixture.editor.hasUnsavedChanges(), true);

    fixture.editors[0]?.edit(paragraphDoc("正文"));

    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.restore();
  }
});

test("opens existing notebooks, saves exact edits, unloads, and reopens the saved snapshot", async () => {
  const fixture = editorFixture();
  const projectPath = "D:\\作品\\保留结构化";
  let storedDraft = notebookJson("旧草稿");
  let storedMain = notebookJson("旧正文");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });

  mockIPC((command, payload) => {
    if (command === "open_project") {
      const result: ProjectOpenResult = {
        metadata: { name: "保留结构化" },
        draft_content: storedDraft,
        main_content: storedMain,
      };
      return result;
    }
    if (command === "save_project") {
      const args = payload as { projectPath: string; draftContent: string; mainContent: string };
      assert.equal(args.projectPath, projectPath);
      assert.equal(typeof args.draftContent, "string");
      assert.equal(typeof args.mainContent, "string");
      storedDraft = args.draftContent;
      storedMain = args.mainContent;
      return null;
    }
    throw new Error(`Unexpected IPC command: ${command}`);
  });

  const openIntoEditor = async (): Promise<void> => {
    await openProjectAfterAuthorization({
      authorize: async () => true,
      selectDirectory: async () => projectPath,
      openProject,
      replaceProject: fixture.editor.showProject,
    });
  };

  try {
    await openIntoEditor();
    assert.deepEqual(fixture.editors[0]?.getDocument(), paragraphDoc("旧草稿"));
    assert.deepEqual(fixture.editors[1]?.getDocument(), paragraphDoc("旧正文"));

    fixture.editors[0]?.edit(paragraphDoc("新草稿"));
    fixture.editors[1]?.edit(paragraphDoc("新正文"));

    assert.equal(await fixture.editor.save(), true);
    assert.equal(storedDraft, notebookJson("新草稿"));
    assert.equal(storedMain, notebookJson("新正文"));

    fixture.editor.unload();
    await openIntoEditor();

    assert.deepEqual(fixture.editors[2]?.getDocument(), paragraphDoc("新草稿"));
    assert.deepEqual(fixture.editors[3]?.getDocument(), paragraphDoc("新正文"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.editor.destroy();
    clearMocks();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    fixture.restore();
  }
});
