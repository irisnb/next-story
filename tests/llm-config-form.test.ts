import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AppDom } from "../src/dom.ts";
import { setupLlmConfigForm } from "../src/llm-config-form.ts";
import type { LeaveChoice } from "../src/leave-guard.ts";
import type { LlmConfig } from "../src/types.ts";

type Listener = () => void;

class FakeClassList {
  private readonly values = new Set<string>();

  constructor(initial: readonly string[] = []) {
    for (const value of initial) this.values.add(value);
  }

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  readonly classList: FakeClassList;
  readonly listeners = new Map<string, Listener[]>();
  textContent = "";
  className = "";
  value = "";
  disabled = false;
  readonly id: string;

  constructor(id: string, classes: readonly string[] = []) {
    this.id = id;
    this.classList = new FakeClassList(classes);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const savedConfig: LlmConfig = {
  api_base_url: "https://api.example.com",
  api_key: "saved-key",
  model: "saved-model",
};

test("LLM config page distinguishes connection test data from AI generation data", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /测试连接[^。]*固定测试语句/);
  assert.match(html, /不会发送用户剧本文字或临时对话/);
  assert.match(html, /AI 生成[^。]*冻结选区原文/);
  assert.match(html, /思维扩展方向/);
  assert.match(html, /当前临时对话/);
  assert.match(html, /回复只显示在 AI 面板/);
  assert.match(html, /不会自动进入正文本或草稿本/);
  assert.match(html, /第三方服务如何处理数据/);
});

function cloneConfig(config: LlmConfig): LlmConfig {
  return { ...config };
}

function makeHarness(options: {
  readonly choices?: readonly LeaveChoice[];
  readonly saveFails?: boolean;
} = {}): {
  readonly dom: AppDom;
  readonly elements: ReadonlyMap<string, FakeElement>;
  readonly saved: LlmConfig[];
  readonly controller: ReturnType<typeof setupLlmConfigForm>;
  flush(): Promise<void>;
  restore(): void;
} {
  const ids = [
    "welcome-page", "new-project-page", "editor-page", "llm-config-page",
    "api-base-url", "api-base-url-error", "api-key", "api-key-error",
    "model-name", "model-name-error", "llm-save-status", "btn-save-config",
    "btn-test-config", "btn-back-config",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id, ["hidden"])]));
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Document;

  const pages = [
    elements.get("welcome-page"),
    elements.get("new-project-page"),
    elements.get("editor-page"),
    elements.get("llm-config-page"),
  ];
  const choices = [...(options.choices ?? [])];
  const saved: LlmConfig[] = [];
  const dom = {
    welcomePage: elements.get("welcome-page"),
    newProjectPage: elements.get("new-project-page"),
    editorPage: elements.get("editor-page"),
    llmConfigPage: elements.get("llm-config-page"),
    apiBaseUrlInput: elements.get("api-base-url"),
    apiBaseUrlError: elements.get("api-base-url-error"),
    apiKeyInput: elements.get("api-key"),
    apiKeyError: elements.get("api-key-error"),
    modelNameInput: elements.get("model-name"),
    modelNameError: elements.get("model-name-error"),
    llmSaveStatus: elements.get("llm-save-status"),
    btnSaveConfig: elements.get("btn-save-config"),
    btnTestConfig: elements.get("btn-test-config"),
    btnBackConfig: elements.get("btn-back-config"),
  } as unknown as AppDom;

  const controller = setupLlmConfigForm(dom, pages as unknown as HTMLElement[], {
    chooseLeave: async () => choices.shift() ?? "cancel",
    loadConfig: async () => ({
      api_base_url: savedConfig.api_base_url,
      model: savedConfig.model,
      has_api_key: true,
    }),
    saveConfig: async (config) => {
      if (options.saveFails) throw new Error("save failed");
      saved.push(cloneConfig(config));
    },
    testConnection: async () => {},
  });

  return {
    dom,
    elements,
    saved,
    controller,
    flush: async () => {
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }
    },
    restore: () => { globalThis.document = previousDocument; },
  };
}

test("LLM config back cancel keeps dirty input on the configuration page", async () => {
  const ui = makeHarness({ choices: ["cancel"] });
  try {
    ui.controller.open("editor-page");
    await ui.flush();
    ui.dom.apiKeyInput.value = "edited-key";
    ui.elements.get("api-key")!.dispatch("input");

    ui.elements.get("btn-back-config")!.dispatch("click");
    await ui.flush();

    assert.equal(ui.dom.apiKeyInput.value, "edited-key");
    assert.equal(ui.dom.llmConfigPage.classList.contains("hidden"), false);
    assert.equal(ui.dom.editorPage.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("LLM config back save failure keeps dirty input on the configuration page", async () => {
  const ui = makeHarness({ choices: ["save-and-leave"], saveFails: true });
  try {
    ui.controller.open("editor-page");
    await ui.flush();
    ui.dom.apiKeyInput.value = "edited-key";
    ui.elements.get("api-key")!.dispatch("input");

    ui.elements.get("btn-back-config")!.dispatch("click");
    await ui.flush();

    assert.equal(ui.dom.apiKeyInput.value, "edited-key");
    assert.equal(ui.controller.hasUnsavedChanges(), true);
    assert.equal(ui.dom.llmConfigPage.classList.contains("hidden"), false);
    assert.equal(ui.dom.editorPage.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("LLM config back save success leaves and records the new clean baseline", async () => {
  const ui = makeHarness({ choices: ["save-and-leave"] });
  try {
    ui.controller.open("editor-page");
    await ui.flush();
    ui.dom.apiKeyInput.value = "edited-key";
    ui.elements.get("api-key")!.dispatch("input");

    ui.elements.get("btn-back-config")!.dispatch("click");
    await ui.flush();

    assert.deepEqual(ui.saved, [{ ...savedConfig, api_key: "edited-key" }]);
    assert.equal(ui.controller.hasUnsavedChanges(), false);
    assert.equal(ui.dom.llmConfigPage.classList.contains("hidden"), true);
    assert.equal(ui.dom.editorPage.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});

test("LLM config back discard leaves without saving current input", async () => {
  const ui = makeHarness({ choices: ["discard-and-leave"] });
  try {
    ui.controller.open("editor-page");
    await ui.flush();
    ui.dom.apiKeyInput.value = "edited-key";
    ui.elements.get("api-key")!.dispatch("input");

    ui.elements.get("btn-back-config")!.dispatch("click");
    await ui.flush();

    assert.deepEqual(ui.saved, []);
    assert.equal(ui.controller.hasUnsavedChanges(), false);
    assert.equal(ui.dom.llmConfigPage.classList.contains("hidden"), true);
    assert.equal(ui.dom.editorPage.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});
