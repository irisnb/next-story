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
import {
  FakeElement,
  installAiFeatureEnvironment,
} from "./ai-panel-dom-fixture.ts";

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
  /** 触发驱动进程丢失（重放恢复入口）。 */
  fireDriverLost(): void;
  /** 崩溃恢复实际调用的 replaySession 目标（按调用顺序记录 conversationId）。 */
  replayCalls: string[];
}

function persistenceHarness(overrides: {
  readonly results?: readonly GenerateAiResult[];
  readonly failSave?: boolean;
  readonly list?: { conversations: ConversationSummary[]; skipped: string[] };
  readonly getHiddenDocumentIds?: () => ReadonlySet<string>;
} = {}): PersistenceHarness {
  const env = installAiFeatureEnvironment();
  const elements = env.elements;

  const results = [...(overrides.results ?? [{ ok: true, content: "回答" }])];
  const saves: ConversationRecord[] = [];
  const deletes: string[] = [];
  let endSessionCalls = 0;
  const requests: GenerateAiRequest[] = [];
  const driverLostHandlers: Array<() => void> = [];
  const replayCalls: string[] = [];

  const transport: AiSessionTransport = {
    sendViaResidentSession: (_conversationId, request) => {
      requests.push(request);
      const result = results.shift();
      if (!result) return Promise.resolve({ ok: true, content: "回答" });
      return Promise.resolve(result);
    },
    cancelMessage: () => {},
    endSession: () => { endSessionCalls += 1; },
    endAllSessions: () => { endSessionCalls += 1; },
    replaySession: (conversationId) => {
      replayCalls.push(conversationId);
      return Promise.resolve();
    },
    onStreamText: () => () => {},
    onDriverLost: (listener) => {
      driverLostHandlers.push(listener);
      return () => {};
    },
    installSessionEventRouting: () => {},
  };

  const listResult = overrides.list ?? { conversations: [], skipped: [] };
  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
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
    ...(overrides.getHiddenDocumentIds
      ? { getHiddenDocumentIds: overrides.getHiddenDocumentIds }
      : {}),
  });

  return {
    controller,
    elements,
    saves,
    deletes,
    endSessionCalls: () => endSessionCalls,
    listResult,
    saveError: () => controller.state.saveError,
    fireDriverLost(): void {
      for (const handler of driverLostHandlers) handler();
    },
    replayCalls,
    submitDirectQuestion(question: string): void {
      // 新建对话 → 空窗口 → 在窗口内直接提问。
      elements.get("ai-new-conversation")!.dispatch("click");
      const win = env.windowRoots[env.windowRoots.length - 1];
      const input = win.queryResults.get('[data-role="direct-question-input"]')!;
      input.value = question;
      input.dispatch("input");
      win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
    },
    restore: () => { env.restore(); },
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
    provenance: [],
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
    provenance: [],
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

// ========== 材料权限变化隔离（controlled-story-read-visibility 任务 5） ==========

test("5.1 reopening a discussion whose provenance references a hidden document is restricted and not continuable", () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-1"]) });
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-5",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "首答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    });

    assert.equal(ui.controller.state.conversation?.restricted, true);
    assert.equal(ui.controller.state.followUpAvailable, false, "受限讨论不可沿原上下文追问");
    const notice = ui.controller.state.restrictionNotice;
    assert.ok(notice, "受限讨论必须有可见提示");
    assert.ok(!notice!.includes("doc-1"), "提示不得泄露隐藏文档身份");
  } finally {
    ui.restore();
  }
});

test("5.2 reopening an archive missing provenance is conservatively restricted", () => {
  const ui = persistenceHarness();
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-6",
      title: "旧讨论",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: null,
      focus_document_title: null,
      first_round_material: { kind: "direct_question", question: "旧问题", selection_text: null },
      turns: [{ role: "assistant", text: "旧回答", status: "done" }],
    });

    assert.equal(ui.controller.state.conversation?.restricted, true, "缺出处的旧档案按保守策略受限");
    assert.equal(ui.controller.state.followUpAvailable, false);
    assert.ok(ui.controller.state.restrictionNotice);
  } finally {
    ui.restore();
  }
});

test("5.3 reopening a discussion whose materials are still visible stays continuable", () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-other"]) });
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-7",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "首答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    });

    assert.equal(ui.controller.state.conversation?.restricted, false);
    assert.equal(ui.controller.state.followUpAvailable, true);
    assert.equal(ui.controller.state.restrictionNotice, null);
  } finally {
    ui.restore();
  }
});

// ========== 崩溃恢复按当前 provenance 重算材料限制（任务 5.5） ==========

test("5.6 driverLost recovery re-checks current visibility before replay (hidden source is not replayed)", () => {
  // 打开讨论时 doc-1 可见（restricted=false），之后隐藏 doc-1，再触发驱动丢失：
  // 恢复过滤必须在重放前按当前 hiddenDocumentIds 重算，不能重放已隐藏材料。
  const hidden = new Set<string>();
  const ui = persistenceHarness({ getHiddenDocumentIds: () => hidden });
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-8",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "首答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    });
    // 打开时材料可见：不受限。
    assert.equal(ui.controller.state.conversation?.restricted, false);

    // 打开后来源文档被隐藏。
    hidden.add("doc-1");
    ui.fireDriverLost();

    // 不得把已隐藏材料通过历史重放再次发送给 DSH。
    assert.deepEqual(ui.replayCalls, [], "隐藏来源文档后不得重放历史");
    // 面板显示历史仍保留（讨论仍可查看）。
    assert.equal(ui.controller.state.conversation?.firstResponse, "首答");
  } finally {
    ui.restore();
  }
});

test("5.7 driverLost recovery still replays a discussion whose material remains visible", () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-other"]) });
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-9",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "首答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    });

    ui.fireDriverLost();

    assert.deepEqual(ui.replayCalls, ["c-9"], "仍可见材料应可恢复重放");
  } finally {
    ui.restore();
  }
});

test("5.8 driverLost recovery replays a no-material direct question", () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-1"]) });
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-10",
      title: "问题",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: null,
      focus_document_title: null,
      first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
      turns: [{ role: "assistant", text: "回答", status: "done" }],
      provenance: [],
    });

    ui.fireDriverLost();

    assert.deepEqual(ui.replayCalls, ["c-10"], "无材料直接提问应可恢复重放");
  } finally {
    ui.restore();
  }
});

// ========== 任务 5.2/5.4：权限变更后锁存 + 重新开启可见性不解除 ==========

test("5.9 recomputeRestrictions latches an open discussion and persists it so re-enable + reopen stays restricted", async () => {
  const hidden = new Set<string>();
  const ui = persistenceHarness({ getHiddenDocumentIds: () => hidden });
  try {
    ui.controller.openDiscussion({
      conversation_id: "c-11",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "首答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    });
    // 打开时可见：不受限。
    assert.equal(ui.controller.state.conversation?.restricted, false);

    // 权限变更：doc-1 被隐藏 → 立即重算并锁存。
    hidden.add("doc-1");
    ui.controller.recomputeRestrictions();
    assert.equal(ui.controller.state.conversation?.restricted, true);
    assert.equal(ui.controller.state.followUpAvailable, false);
    // 锁存被持久化（revoked 出处，不泄露身份，只记录来源文档 ID）。
    const persisted = ui.saves[ui.saves.length - 1];
    assert.equal(persisted.provenance?.[0]?.material_type, "revoked");

    // 受限讨论不能追问。
    assert.equal(await ui.controller.submitFollowUp("追问"), false);

    // 重新开启可见性，重新从列表打开该讨论：仍受限（不解除，任务 5.4）。
    hidden.clear();
    const summary = ui.controller.getConversations()[0];
    ui.controller.openDiscussion(summary);
    assert.equal(ui.controller.state.conversation?.restricted, true);
    assert.equal(ui.controller.state.followUpAvailable, false);
    const notice = ui.controller.state.restrictionNotice;
    assert.ok(notice, "受限讨论保留可见提示");
    assert.ok(!notice!.includes("doc-1"), "提示不得泄露隐藏文档身份");
  } finally {
    ui.restore();
  }
});
