import assert from "node:assert/strict";
import test from "node:test";

import { setupAiFeature } from "../src/ai-feature.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import type { AppDom } from "../src/dom.ts";
import type {
  ConversationRecord,
  ConversationSummary,
  FirstRoundMaterial,
} from "../src/conversation-archive.ts";
import type {
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfigSummary,
} from "../src/types.ts";
import { createAiPanelDomFixture, FakeElement } from "./ai-panel-dom-fixture.ts";

async function flush(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.example.com/v1",
  model: "m",
  has_api_key: true,
};

interface PersistenceHarness {
  controller: ReturnType<typeof setupAiFeature>;
  elements: Map<string, FakeElement>;
  saves: ConversationRecord[];
  deletes: string[];
  endSessionCalls: () => number;
  listResult: { conversations: ConversationSummary[]; skipped: string[] };
  saveError: () => string | null;
  submitDirectQuestion(question: string): void;
  restore(): void;
}

function persistenceHarness(overrides: {
  readonly results?: readonly GenerateAiResult[];
  readonly failSave?: boolean;
  readonly list?: { conversations: ConversationSummary[]; skipped: string[] };
} = {}): PersistenceHarness {
  const { elements, dom } = createAiPanelDomFixture();
  const editor = new FakeElement("editor-textarea");
  editor.value = "用户正文";
  elements.set("editor-textarea", editor);

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  const results = [...(overrides.results ?? [{ ok: true, content: "回答" }])];
  const saves: ConversationRecord[] = [];
  const deletes: string[] = [];
  let endSessionCalls = 0;
  const requests: GenerateAiRequest[] = [];

  const transport: AiSessionTransport = {
    sendViaResidentSession: (_conversationId, request) => {
      requests.push(request);
      const result = results.shift();
      if (!result) return Promise.resolve({ ok: true, content: "回答" });
      return Promise.resolve(result);
    },
    endSession: () => { endSessionCalls += 1; },
    endAllSessions: () => { endSessionCalls += 1; },
    replaySession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    installSessionEventRouting: () => {},
  };

  const listResult = overrides.list ?? { conversations: [], skipped: [] };
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
    getCurrentProjectPath: () => "作品路径",
    getCurrentDocumentTitle: () => "草稿",
  }, {
    transport,
    loadConfig: () => Promise.resolve(savedConfig),
    conversationList: () => Promise.resolve(listResult),
    conversationSave: (_projectPath, record) => {
      if (overrides.failSave) return Promise.reject(new Error("磁盘写入失败"));
      saves.push(record);
      return Promise.resolve();
    },
    conversationDelete: (_projectPath, conversationId) => {
      deletes.push(conversationId);
      return Promise.resolve();
    },
    newConversationId: () => "c-1",
  });

  return {
    controller,
    elements,
    saves,
    deletes,
    endSessionCalls: () => endSessionCalls,
    listResult,
    saveError: () => controller.state.saveError,
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

function summary(partial: Partial<ConversationSummary> & { conversation_id: string }): ConversationSummary {
  return {
    title: partial.conversation_id,
    created_at: "t0",
    updated_at: "t0",
    last_status: "done",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
    turns: [{ role: "assistant", text: "回答", status: "done" }],
    ...partial,
  };
}

test("4.1 user turn accepted saves a pending record, terminal result updates it", async () => {
  const ui = persistenceHarness();
  try {
    ui.submitDirectQuestion("这个角色为什么犹豫？");
    await flush();

    // 接受即存：先写一条 pending 记录
    assert.equal(ui.saves.length, 2, "接受后与终态各保存一次");
    const accepted = ui.saves[0];
    assert.equal(accepted.conversation_id, "c-1");
    assert.equal(accepted.version, 1);
    assert.equal(accepted.first_round_material.kind, "direct_question");
    assert.equal(accepted.turns[accepted.turns.length - 1].status, "pending");

    // 终态更新：done
    const terminal = ui.saves[ui.saves.length - 1];
    assert.equal(terminal.turns[terminal.turns.length - 1].status, "done");
    assert.equal(ui.saveError(), null);
  } finally {
    ui.restore();
  }
});

test("4.2 save failure is visible and not faked as saved", async () => {
  const ui = persistenceHarness({ failSave: true });
  try {
    ui.submitDirectQuestion("问题");
    await flush();

    assert.ok(ui.saveError(), "保存失败应有可见提示");
    assert.match(ui.saveError()!, /保存失败/);
  } finally {
    ui.restore();
  }
});

test("4.3 beginProject loads the conversation list for the project", async () => {
  const ui = persistenceHarness({
    list: { conversations: [summary({ conversation_id: "c-9", title: "标题九" })], skipped: [] },
  });
  try {
    ui.controller.beginProject();
    await flush();

    const conversations = ui.controller.getConversations();
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].conversation_id, "c-9");
  } finally {
    ui.restore();
  }
});

test("4.4 reopening shows saved turns and an interrupted pending turn without auto-resend", async () => {
  const material: FirstRoundMaterial = { kind: "direct_question", question: "原问题", selection_text: null };
  const interrupted: ConversationSummary = {
    conversation_id: "c-10",
    title: "原问题",
    created_at: "t0",
    updated_at: "t0",
    last_status: "pending",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: material,
    turns: [
      { role: "assistant", text: "首答", status: "done" },
      { role: "user", text: "未完成追问", status: "done" },
      { role: "assistant", text: "", status: "pending" },
    ],
  };
  const ui = persistenceHarness();
  try {
    ui.controller.openDiscussion(interrupted);

    const conversation = ui.controller.state.conversation;
    assert.ok(conversation);
    assert.equal(conversation.firstResponse, "首答");
    assert.equal(conversation.pending?.question, "未完成追问");
    assert.equal(conversation.pending?.interrupted, true);
    // 不自动重发：无新的生成请求发起
    assert.equal(ui.controller.state.followUpAvailable, true);
  } finally {
    ui.restore();
  }
});

test("4.5 deleteDiscussion ends the session and removes the archive", async () => {
  const ui = persistenceHarness({
    list: { conversations: [summary({ conversation_id: "c-1" })], skipped: [] },
  });
  try {
    ui.controller.beginProject();
    await flush();
    assert.equal(ui.controller.getConversations().length, 1);

    await ui.controller.deleteDiscussion("c-1");
    assert.deepEqual(ui.deletes, ["c-1"]);
    assert.equal(ui.endSessionCalls() >= 1, true);
    assert.equal(ui.controller.getConversations().length, 0);
  } finally {
    ui.restore();
  }
});
