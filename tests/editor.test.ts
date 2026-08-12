import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import type { AiFeatureController } from "../src/ai-feature.ts";
import type { AppDom } from "../src/dom.ts";
import { setupEditor } from "../src/editor.ts";
import type { LeaveDialogController } from "../src/leave-dialog.ts";
import type {
  PlainTextEditorCoordinates,
  PlainTextEditorSelection,
} from "../src/plain-text-editor.ts";
import { openProject } from "../src/project-api.ts";
import { openProjectAfterAuthorization } from "../src/project-leave-flow.ts";
import type { ProjectOpenResult } from "../src/types.ts";

type Listener = () => void;

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

class FakePlainTextEditor {
  private readonly listeners = new Set<(text: string) => void>();
  private text: string;
  readonly element: HTMLElement;
  readonly capturedListeners: Array<(text: string) => void> = [];
  destroyed = false;

  constructor(element: HTMLElement, initialText: string) {
    this.element = element;
    this.text = initialText;
  }

  getText(): string {
    return this.text;
  }

  onEdit(listener: (text: string) => void): () => void {
    this.listeners.add(listener);
    this.capturedListeners.push(listener);
    return () => { this.listeners.delete(listener); };
  }

  focus(): void {}

  getSelection(): PlainTextEditorSelection {
    return { from: 1, to: 1, head: 1 };
  }

  coordinatesAt(_position: number): PlainTextEditorCoordinates {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  edit(text: string): void {
    this.text = text;
    for (const listener of this.listeners) listener(text);
  }
}

function project(
  projectPath: string,
  draftContent: string,
  mainContent: string,
) {
  return {
    projectPath,
    projectName: projectPath,
    draftContent,
    mainContent,
  };
}

function editorFixture() {
  const ui = fakeDom();
  const editors: FakePlainTextEditor[] = [];
  const leaveDialog: LeaveDialogController = { choose: async () => "cancel" };
  const editor = setupEditor(ui.dom, leaveDialog, {
    createEditor: (element: HTMLElement, initialText: string) => {
      const created = new FakePlainTextEditor(element, initialText);
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
    editor.showProject({
      projectPath: "project-path",
      projectName: "作品",
      draftContent: "草稿",
      mainContent: "正文",
    });
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
    // Given
    fixture.editor.showProject(project("作品一", "草稿初稿", "正文初稿"));

    // Then
    assert.equal(fixture.editors.length, 2);
    assert.notEqual(fixture.editors[0], fixture.editors[1]);
    assert.equal(fixture.editors[0]?.element, fixture.dom.draftTextarea);
    assert.equal(fixture.editors[1]?.element, fixture.dom.mainTextarea);
    assert.equal(fixture.editors[0]?.getText(), "草稿初稿");
    assert.equal(fixture.editors[1]?.getText(), "正文初稿");
    assert.equal(fixture.editor.hasUnsavedChanges(), false);

    // When
    fixture.editors[0]?.edit("未保存草稿");
    fixture.dom.tabMain.click();
    fixture.editors[1]?.edit("未保存正文");
    fixture.dom.tabDraft.click();

    // Then
    assert.equal(fixture.editors.length, 2);
    assert.equal(fixture.editors[0]?.getText(), "未保存草稿");
    assert.equal(fixture.editors[1]?.getText(), "未保存正文");
    assert.equal(fixture.editor.hasUnsavedChanges(), true);
  } finally {
    fixture.restore();
  }
});

test("replacing a project destroys both old editors and ignores their late edits", () => {
  const fixture = editorFixture();
  try {
    // Given
    fixture.editor.showProject(project("作品一", "旧草稿", "旧正文"));
    const oldDraft = fixture.editors[0];
    const oldMain = fixture.editors[1];
    const lateDraftEdit = oldDraft?.capturedListeners[0];

    // When
    fixture.editor.showProject(project("作品二", "新草稿", "新正文"));

    // Then
    assert.equal(oldDraft?.destroyed, true);
    assert.equal(oldMain?.destroyed, true);
    assert.equal(fixture.editors.length, 4);
    assert.equal(fixture.editors[2]?.getText(), "新草稿");
    assert.equal(fixture.editors[3]?.getText(), "新正文");
    assert.equal(fixture.editor.hasUnsavedChanges(), false);

    // When
    lateDraftEdit?.("迟到的旧草稿");

    // Then
    assert.equal(fixture.editors[2]?.getText(), "新草稿");
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.restore();
  }
});

test("unloading destroys both editors and ignores their late edits", () => {
  const fixture = editorFixture();
  try {
    // Given
    fixture.editor.showProject(project("作品一", "草稿", "正文"));
    const draft = fixture.editors[0];
    const main = fixture.editors[1];
    const lateMainEdit = main?.capturedListeners[0];

    // When
    fixture.editor.unload();

    // Then
    assert.equal(draft?.destroyed, true);
    assert.equal(main?.destroyed, true);
    assert.equal(fixture.editor.hasProject(), false);
    assert.equal(fixture.editor.hasUnsavedChanges(), false);

    // When
    lateMainEdit?.("迟到的旧正文");

    // Then
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.restore();
  }
});

test("destroying the controller destroys both editors", () => {
  const fixture = editorFixture();
  try {
    // Given
    fixture.editor.showProject(project("作品一", "草稿", "正文"));
    const draft = fixture.editors[0];
    const main = fixture.editors[1];

    // When
    fixture.editor.destroy();

    // Then
    assert.equal(draft?.destroyed, true);
    assert.equal(main?.destroyed, true);
    assert.equal(fixture.editor.hasProject(), false);
  } finally {
    fixture.restore();
  }
});

test("opens existing text notebooks, saves exact edits, unloads, and reopens the saved snapshot", async () => {
  const fixture = editorFixture();
  const projectPath = "D:\\作品\\保留纯文本";
  let storedDraft = "\n旧草稿第一行\n\n旧草稿末行\n";
  let storedMain = "旧正文🙂\n第二行\n\n";
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });

  mockIPC((command, payload) => {
    if (command === "open_project") {
      const result: ProjectOpenResult = {
        metadata: { name: "保留纯文本" },
        draft_content: storedDraft,
        main_content: storedMain,
      };
      return result;
    }
    if (command === "save_project") {
      assert.equal(payload?.projectPath, projectPath);
      assert.equal(typeof payload?.draftContent, "string");
      assert.equal(typeof payload?.mainContent, "string");
      storedDraft = payload.draftContent;
      storedMain = payload.mainContent;
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
    assert.equal(fixture.editors[0]?.getText(), storedDraft);
    assert.equal(fixture.editors[1]?.getText(), storedMain);

    const savedDraft = "\n新草稿：甲🙂\n\n乙在后面\n\n";
    const savedMain = "新正文第一行\n第二行，标点不变。\n\n\n结尾\n";
    fixture.editors[0]?.edit(savedDraft);
    fixture.editors[1]?.edit(savedMain);

    assert.equal(await fixture.editor.save(), true);
    assert.equal(storedDraft, savedDraft);
    assert.equal(storedMain, savedMain);

    fixture.editor.unload();
    await openIntoEditor();

    assert.equal(fixture.editors[2]?.getText(), savedDraft);
    assert.equal(fixture.editors[3]?.getText(), savedMain);
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.editor.destroy();
    clearMocks();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    fixture.restore();
  }
});
