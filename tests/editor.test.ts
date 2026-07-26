import assert from "node:assert/strict";
import test from "node:test";

import type { AiFeatureController } from "../src/ai-feature.ts";
import type { AppDom } from "../src/dom.ts";
import { setupEditor } from "../src/editor.ts";
import type { LeaveDialogController } from "../src/leave-dialog.ts";

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
  const ui = fakeDom();
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
    const leaveDialog: LeaveDialogController = { choose: async () => "cancel" };
    const editor = setupEditor(ui.dom, leaveDialog);

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

    ui.dom.tabMain.click();

    assert.equal(editor.getCurrentTab(), "main");
    assert.equal(entryResets, 1);
    assert.equal(projectBegins, 0);
    assert.equal(projectEnds, 0);
  } finally {
    ui.restore();
  }
});
