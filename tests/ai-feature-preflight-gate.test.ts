import assert from "node:assert/strict";
import test from "node:test";

import {
  acquirePreflight,
  createPreflightGate,
  releasePreflight,
} from "../src/ai-feature-first-request.ts";
import { setupAiFeature } from "../src/ai-feature.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import type { AppDom } from "../src/dom.ts";
import type {
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfigSummary,
} from "../src/types.ts";
import {
  createAiPanelDomFixture,
  FakeElement,
} from "./ai-panel-dom-fixture.ts";

async function flushAiFeatureFlow(): Promise<void> {
  for (let i = 0; i < 64; i += 1) {
    await Promise.resolve();
  }
}

// ========== 低层 operation ownership 测试 ==========

test("acquire succeeds when the gate is free", () => {
  const gate = createPreflightGate();
  assert.equal(acquirePreflight(gate, 1), true);
  assert.equal(gate.owner, 1);
});

test("acquire is rejected for the same project already holding the gate", () => {
  const gate = createPreflightGate();
  acquirePreflight(gate, 1);
  assert.equal(acquirePreflight(gate, 1), false);
  assert.equal(gate.owner, 1);
});

test("a new project can replace the old owner", () => {
  const gate = createPreflightGate();
  acquirePreflight(gate, 1);
  assert.equal(acquirePreflight(gate, 2), true);
  assert.equal(gate.owner, 2);
});

test("only the owner can release the gate", () => {
  const gate = createPreflightGate();
  acquirePreflight(gate, 1);
  releasePreflight(gate, 2);
  assert.equal(gate.owner, 1, "非 owner 释放无效");
  releasePreflight(gate, 1);
  assert.equal(gate.owner, null, "owner 释放生效");
});

test("a late release from a replaced owner does not release the new owner", () => {
  const gate = createPreflightGate();
  acquirePreflight(gate, 1); // A
  acquirePreflight(gate, 2); // B 取代 A
  releasePreflight(gate, 1); // A 的迟到 finally
  assert.equal(gate.owner, 2, "A 的迟到释放不得释放 B");
});

// ========== ai-feature 层跨作品预检门禁测试 ==========

interface FeatureHarness {
  controller: ReturnType<typeof setupAiFeature>;
  elements: Map<string, FakeElement>;
  requests: GenerateAiRequest[];
  configCalls: () => number;
  resolveFirstConfig: (config: LlmConfigSummary | null) => void;
  resolveSecondConfig: (config: LlmConfigSummary | null) => void;
  submitDirectQuestion(question: string): void;
  restore(): void;
}

function fakeTransport(): { transport: AiSessionTransport; requests: GenerateAiRequest[] } {
  const requests: GenerateAiRequest[] = [];
  const transport: AiSessionTransport = {
    sendViaResidentSession: (request) => {
      requests.push(request);
      const result: GenerateAiResult = { ok: true, content: "回答" };
      return Promise.resolve(result);
    },
    endActiveSession: () => {},
    replayActiveSession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    installSessionEventRouting: () => {},
  };
  return { transport, requests };
}

function featureHarness(): FeatureHarness {
  const { elements, dom } = createAiPanelDomFixture();
  const editor = new FakeElement("editor-textarea");
  elements.set("editor-textarea", editor);

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  const { transport, requests } = fakeTransport();
  let configCalls = 0;
  let resolveFirst: ((config: LlmConfigSummary | null) => void) | null = null;
  let resolveSecond: ((config: LlmConfigSummary | null) => void) | null = null;

  const controller = setupAiFeature({
    aiPanelDom: dom,
    aiPanel: dom.panel,
    aiResponse: dom.response,
    btnToggleAi: dom.toggleBtn,
    editorTextarea: editor,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => "doc-1",
    getCurrentEditor: () => null,
    openConfigPage: () => {},
  }, {
    transport,
    loadConfig: () => {
      configCalls += 1;
      if (configCalls === 1) {
        return new Promise<LlmConfigSummary | null>((resolve) => { resolveFirst = resolve; });
      }
      return new Promise<LlmConfigSummary | null>((resolve) => { resolveSecond = resolve; });
    },
  });

  return {
    controller,
    elements,
    requests,
    configCalls: () => configCalls,
    resolveFirstConfig: (config) => resolveFirst?.(config),
    resolveSecondConfig: (config) => resolveSecond?.(config),
    submitDirectQuestion(question: string): void {
      const toggle = elements.get("btn-toggle-ai")!;
      toggle.dispatch("click");
      const input = elements.get("ai-direct-question-input")!;
      input.value = question;
      input.dispatch("input");
      elements.get("ai-direct-question-form")!.dispatch("submit");
    },
    restore: () => { globalThis.document = previousDocument; },
  };
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.example.com/v1",
  model: "m",
  has_api_key: true,
};

test("A direct preflight hanging does not block B direct question after beginProject", async () => {
  const ui = featureHarness();
  try {
    // A: 触发直接提问，预检悬挂
    ui.submitDirectQuestion("A 的问题");
    await flushAiFeatureFlow();
    assert.equal(ui.configCalls(), 1, "A 的预检已开始并悬挂");

    // 切换到 B
    ui.controller.beginProject();

    // B: 直接提问应可开始（不被 A 的门禁阻塞）
    ui.submitDirectQuestion("B 的问题");
    await flushAiFeatureFlow();
    assert.equal(ui.configCalls(), 2, "B 的预检应开始");

    // B 的配置返回后请求真正发出
    ui.resolveSecondConfig(savedConfig);
    await flushAiFeatureFlow();
    assert.deepEqual(ui.requests, [{ kind: "direct_question", question: "B 的问题" }]);
  } finally {
    ui.restore();
  }
});

test("A's late preflight finally does not release B's current preflight", async () => {
  const ui = featureHarness();
  try {
    // A: 直接提问，预检悬挂
    ui.submitDirectQuestion("A 的问题");
    await flushAiFeatureFlow();
    assert.equal(ui.configCalls(), 1);

    // 切换到 B
    ui.controller.beginProject();

    // B: 直接提问，预检悬挂
    ui.submitDirectQuestion("B 的问题");
    await flushAiFeatureFlow();
    assert.equal(ui.configCalls(), 2, "B 的预检应开始");

    // A 的迟到配置结果返回：A 丢弃并执行 finally（不得释放 B 的门禁）
    ui.resolveFirstConfig(savedConfig);
    await flushAiFeatureFlow();

    // B 的预检仍被持有：再次发起 B 的直接提问应被同作品门禁拒绝
    ui.submitDirectQuestion("B 另一问题");
    await flushAiFeatureFlow();
    assert.equal(ui.configCalls(), 2, "B 的预检仍持有，不应再发起配置读取");
    assert.deepEqual(ui.requests, [], "B 的请求尚未发出（预检仍悬挂）");
  } finally {
    ui.restore();
  }
});
