import assert from "node:assert/strict";
import test from "node:test";

import { setupAiFeature, type AiFeatureDependencies } from "../src/ai-feature.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import type { AppDom } from "../src/dom.ts";
import type {
  ConversationRecord,
  ConversationSummary,
  FirstRoundMaterial,
} from "../src/conversation-archive.ts";
import { deriveConversationSummary } from "../src/conversation-archive.ts";
import { recordConsumedDocumentIds } from "../src/ai-panel-conversation.ts";
import { displayFocusDocumentTitle } from "../src/ai-panel-conversation-list.ts";
import type {
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfigSummary,
} from "../src/types.ts";
import {
  FakeElement,
  collectText,
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
  windowRoots: FakeElement[];
  reads: string[];
  listCalls: () => number;
  openRecord(record: ConversationRecord): Promise<void>;
  archives: Map<string, ConversationRecord>;
  latchCalls: string[];
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
  readonly replayError?: Error;
  readonly list?: { conversations: ConversationSummary[]; skipped: string[] };
  readonly getHiddenDocumentIds?: () => ReadonlySet<string>;
  readonly dependencies?: Partial<AiFeatureDependencies>;
} = {}): PersistenceHarness {
  const env = installAiFeatureEnvironment();
  const elements = env.elements;

  const results = [...(overrides.results ?? [{ ok: true, content: "回答" }])];
  const saves: ConversationRecord[] = [];
  const deletes: string[] = [];
  const archives = new Map<string, ConversationRecord>();
  const latchCalls: string[] = [];
  const reads: string[] = [];
  let listCalls = 0;
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
      if (overrides.replayError) return Promise.reject(overrides.replayError);
      return Promise.resolve();
    },
    onStreamText: () => () => {},
    onDriverLost: (listener) => {
      driverLostHandlers.push(listener);
      return () => {};
    },
    onToolCall: () => () => {},
    onReadingRequest: () => () => {},
    installSessionEventRouting: () => {},
    destroySessionEventRouting: () => {},
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
    conversationList: () => { listCalls += 1; return Promise.resolve(listResult); },
    conversationRead: async (_path, id) => {
      reads.push(id);
      if (overrides.dependencies?.conversationRead) return overrides.dependencies.conversationRead(_path, id);
      const record = archives.get(id);
      assert.ok(record, `missing archive ${id}`);
      return record;
    },
    latchConversationRestrictions: async (_path, documentId) => {
      latchCalls.push(documentId);
      const affected: string[] = [];
      for (const [id, record] of archives) {
        const consumed = recordConsumedDocumentIds(record);
        if (consumed !== null && !consumed.has(documentId)) continue;
        archives.set(id, { ...record,
          restriction: record.restriction ?? { reason: "hidden_material", at: "t1" } });
        affected.push(id);
      }
      return affected;
    },
    conversationSave: (_projectPath, record) => {
      if (overrides.failSave) return Promise.reject(new Error("磁盘写入失败"));
      saves.push(record);
      const existing = archives.get(record.conversation_id);
      archives.set(record.conversation_id, { ...record,
        on_demand_reading_grant: existing?.on_demand_reading_grant ?? null,
        on_demand_reading_provenance: existing?.on_demand_reading_provenance ?? null,
        restriction: existing?.restriction ?? null,
      });
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
    ...Object.fromEntries(Object.entries(overrides.dependencies ?? {}).filter(([key]) => key !== "conversationRead")),
  });

  return {
    windowRoots: env.windowRoots,
    reads,
    listCalls: () => listCalls,
    archives,
    latchCalls,
    async openRecord(record) {
      archives.set(record.conversation_id, record);
      const item = deriveConversationSummary(record);
      controller.state.upsertSummary(item, overrides.getHiddenDocumentIds?.() ?? new Set());
      controller.openDiscussion(item);
      await flush();
    },
    controller,
    elements,
    saves,
    deletes,
    endSessionCalls: () => endSessionCalls,
    listResult,
    saveError: () => controller.state.view.saveError,
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
    restore: () => { controller.destroy(); env.restore(); },
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
    provenance_has_revoked: false,
    on_demand_document_ids: [],
    references_incomplete: false,
    provenance: [],
    ...partial,
  };
}

function savedRecord(id = "archive"): ConversationRecord {
  return {
    version: 1, conversation_id: id, title: "", created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z", focus_document_id: null, focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "原问题", selection_text: null },
    turns: [{ role: "assistant", text: "已保存回答", status: "done" }], provenance: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(descendants)];
}

test("2.4 列表不读全文；打开中有提示，成功显示回答，再次点击只聚焦", async () => {
  const read = deferred<ConversationRecord>();
  const record = savedRecord();
  const item = deriveConversationSummary(record);
  const ui = persistenceHarness({ list: { conversations: [item], skipped: [] },
    dependencies: { conversationRead: () => read.promise } });
  try {
    ui.controller.beginProject();
    await flush();
    assert.deepEqual(ui.reads, []);
    assert.equal(ui.controller.state.getDiscussion(record.conversation_id), null);
    ui.controller.openDiscussion(item);
    const root = ui.windowRoots[0];
    assert.equal(ui.controller.state.view.archiveOpening, true);
    assert.match(root.queryResults.get('[data-role="loading"]')!.textContent, /正在打开/);
    assert.equal(root.queryResults.get('[data-role="loading"]')!.classList.contains("hidden"), false);
    read.resolve(record);
    await flush();
    assert.equal(ui.controller.state.view.archiveOpening, false);
    assert.equal(ui.controller.state.conversation?.firstResponse, "已保存回答");
    assert.match(collectText(root), /已保存回答/);
    const before = ui.controller.state.getDiscussion(record.conversation_id);
    ui.controller.openDiscussion(item);
    assert.equal(ui.controller.state.getDiscussion(record.conversation_id), before);
    assert.equal(ui.windowRoots.length, 1);
    assert.deepEqual(ui.reads, [record.conversation_id]);
  } finally { ui.restore(); }
});

test("2.4 读档失败结束加载并保留具体错误，关闭后可重新打开", async () => {
  const read = deferred<ConversationRecord>();
  const ui = persistenceHarness({ dependencies: { conversationRead: () => read.promise } });
  try {
    const item = deriveConversationSummary(savedRecord());
    ui.controller.openDiscussion(item);
    read.reject(new Error("档案格式损坏"));
    await flush();
    assert.equal(ui.controller.state.view.archiveOpening, false);
    assert.match(ui.controller.state.view.archiveOpenError!, /档案格式损坏/);
    assert.match(collectText(ui.windowRoots[0]), /档案格式损坏/);
    ui.windowRoots[0].queryResults.get('[data-role="close"]')!.dispatch("click");
    ui.controller.openDiscussion(item);
    assert.equal(ui.reads.length, 2);
    await flush();
  } finally { ui.restore(); }
});

for (const action of ["switch", "delete", "close", "destroy"] as const) {
  test(`2.4 ${action} 后丢弃迟到读档，不复活窗口`, async () => {
    const read = deferred<ConversationRecord>();
    const record = savedRecord();
    const ui = persistenceHarness({ dependencies: { conversationRead: () => read.promise } });
    try {
      ui.controller.openDiscussion(deriveConversationSummary(record));
      if (action === "switch") ui.controller.beginProject();
      if (action === "delete") await ui.controller.deleteDiscussion(record.conversation_id);
      if (action === "close") ui.windowRoots[0].queryResults.get('[data-role="close"]')!.dispatch("click");
      if (action === "destroy") ui.controller.destroy();
      read.resolve(record);
      await flush();
      assert.equal(ui.controller.state.conversationOf(record.conversation_id), null);
      assert.equal(ui.controller.state.windows.has(record.conversation_id), false);
    } finally { ui.restore(); }
  });
}

test("2.4 关闭并重开同一讨论，第一次读取不得覆盖第二次", async () => {
  const first = deferred<ConversationRecord>();
  const second = deferred<ConversationRecord>();
  let count = 0;
  const ui = persistenceHarness({ dependencies: { conversationRead: () => ++count === 1 ? first.promise : second.promise } });
  try {
    const record = savedRecord();
    const item = deriveConversationSummary(record);
    ui.controller.openDiscussion(item);
    ui.windowRoots[0].queryResults.get('[data-role="close"]')!.dispatch("click");
    ui.controller.openDiscussion(item);
    second.resolve({ ...record, turns: [{ role: "assistant", text: "新档案", status: "done" }] });
    await flush();
    first.resolve(record);
    await flush();
    assert.equal(ui.controller.state.conversation?.firstResponse, "新档案");
    assert.equal(ui.reads.length, 2);
  } finally { ui.restore(); }
});

test("2.5 超限原文只显示于保存失败的讨论窗口", async () => {
  const message = "讨论内容过长（超过 8 MiB 上限），无法保存；请新建对话继续。";
  const ui = persistenceHarness({ dependencies: { conversationSave: () => Promise.reject(message) } });
  try {
    await ui.openRecord(savedRecord("other"));
    ui.submitDirectQuestion("问题");
    await flush();
    assert.equal(ui.controller.state.viewOf("c-1").saveError, message);
    assert.equal(ui.controller.state.viewOf("other").saveError, null);
    assert.ok(collectText(ui.windowRoots[1]).includes(message));
    assert.equal(collectText(ui.windowRoots[0]).includes(message), false);
  } finally { ui.restore(); }
});

test("2.6 保存后更新轻量列表，不重新 list 或重建其他窗口", async () => {
  const ui = persistenceHarness();
  try {
    ui.controller.beginProject();
    await flush();
    await ui.openRecord(savedRecord("other"));
    const before = ui.controller.state.getDiscussion("other");
    ui.submitDirectQuestion("新问题");
    await flush();
    assert.equal(ui.listCalls(), 1);
    assert.equal(ui.controller.state.getDiscussion("other"), before);
    assert.equal(ui.controller.state.windows.size, 2);
    const item = ui.controller.getConversations().find((s) => s.conversation_id === "c-1")!;
    assert.equal(item.title, "新问题");
    assert.equal(item.last_status, "done");
    assert.equal("turns" in item, false);
  } finally { ui.restore(); }
});

test("2.7 未打开条目通过窄命令重命名和置顶，不读取或重存全文", async () => {
  const updates: unknown[] = [];
  const record = savedRecord();
  const ui = persistenceHarness({ list: { conversations: [deriveConversationSummary(record)], skipped: [] },
    dependencies: { conversationUpdateMeta: async (path, id, update) => { updates.push({ path, id, update }); } } });
  try {
    ui.controller.beginProject();
    await flush();
    ui.elements.get("ai-conversation-list-toggle")!.dispatch("click");
    const rows = () => descendants(ui.elements.get("ai-conversation-list-items")!).filter((el) => el.classList.contains("ai-cl-row"));
    const row = rows()[0];
    assert.ok(row);
    descendants(row).find((el) => el.classList.contains("ai-cl-actions"))!.children[0].dispatch("click");
    const edit = descendants(rows()[0]).find((el) => el.classList.contains("ai-cl-edit"))!.children[0];
    edit.value = "重命名";
    edit.dispatch("keydown", { key: "Enter" });
    await flush();
    descendants(rows()[0]).find((el) => el.classList.contains("ai-cl-actions"))!.children[1].dispatch("click");
    await flush();
    assert.deepEqual(updates, [
      { path: "作品路径", id: record.conversation_id, update: { title: "重命名" } },
      { path: "作品路径", id: record.conversation_id, update: { pinned: true } },
    ]);
    assert.equal(ui.controller.getConversations()[0].title, "重命名");
    assert.equal(ui.controller.getConversations()[0].pinned, true);
    assert.deepEqual(ui.reads, []);
    assert.deepEqual(ui.saves, []);
    assert.equal(ui.controller.state.getDiscussion(record.conversation_id), null);
  } finally { ui.restore(); }
});

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
    assert.equal(ui.saveError(), "磁盘写入失败");
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
  const interrupted: ConversationRecord = {
    version: 1,
    conversation_id: "c-10",
    title: "原问题",
    created_at: "t0",
    updated_at: "t0",
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
    await ui.openRecord(interrupted);

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

test("5.1 reopening a discussion whose provenance references a hidden document is restricted and not continuable", async () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-1"]) });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-5",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
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

test("5.2 reopening an archive missing provenance is conservatively restricted", async () => {
  const ui = persistenceHarness();
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-6",
      title: "旧讨论",
      created_at: "t0",
      updated_at: "t0",
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

test("5.3 reopening a discussion whose materials are still visible stays continuable", async () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-other"]) });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-7",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
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

test("5.6 driverLost recovery re-checks current visibility before replay (hidden source is not replayed)", async () => {
  // 打开讨论时 doc-1 可见（restricted=false），之后隐藏 doc-1，再触发驱动丢失：
  // 恢复过滤必须在重放前按当前 hiddenDocumentIds 重算，不能重放已隐藏材料。
  const hidden = new Set<string>();
  const ui = persistenceHarness({ getHiddenDocumentIds: () => hidden });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-8",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
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

test("5.7 driverLost recovery still replays a discussion whose material remains visible", async () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-other"]) });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-9",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
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

test("5.8 driverLost recovery replays a no-material direct question", async () => {
  const ui = persistenceHarness({ getHiddenDocumentIds: () => new Set(["doc-1"]) });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-10",
      title: "问题",
      created_at: "t0",
      updated_at: "t0",
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

test("5.8a replay transport failure enters recovery error instead of completing recovery", async () => {
  const ui = persistenceHarness({ replayError: new Error("历史重放失败") });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-11",
      title: "问题",
      created_at: "t0",
      updated_at: "t0",
      focus_document_id: null,
      focus_document_title: null,
      first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
      turns: [{ role: "assistant", text: "回答", status: "done" }],
      provenance: [],
    });

    ui.fireDriverLost();
    await flush();

    assert.deepEqual(ui.replayCalls, ["c-11"]);
    const request = ui.controller.state.getDiscussion("c-11")?.request;
    assert.equal(request?.kind, "error");
    if (request?.kind === "error") {
      assert.equal(request.error.message, "对话恢复失败，请点击新建对话开始新对话");
    }
  } finally {
    ui.restore();
  }
});

// ========== 任务 5.2/5.4：权限变更后锁存 + 重新开启可见性不解除 ==========

test("补读-only 来源隐藏：真实编排过滤恢复、锁存、列表脱敏，关闭窗口后重读仍受限", async () => {
  const hidden = new Set<string>();
  const ui = persistenceHarness({ getHiddenDocumentIds: () => hidden });
  try {
    await ui.openRecord({
      ...savedRecord("on-demand-only"), focus_document_id: "doc-1", focus_document_title: "关注文档名",
      on_demand_reading_provenance: [{ document_id: "supplement", version: "v1",
        depth: "full", turn_index: 0, entered_model_context: true }],
    });
    assert.equal(ui.controller.state.conversation?.restricted, false);
    hidden.add("supplement");
    ui.fireDriverLost();
    await flush();
    assert.deepEqual(ui.replayCalls, [], "当前隐藏的补读材料不得重放");
    ui.controller.recomputeRestrictions();
    assert.equal(ui.controller.state.conversation?.restricted, true);
    await flush();
    assert.deepEqual(ui.latchCalls, ["supplement"]);
    const archived = ui.archives.get("on-demand-only")!;
    assert.deepEqual(archived.restriction, { reason: "hidden_material", at: "t1" });
    assert.deepEqual(archived.provenance, [], "不可对空普通出处伪造 revoked");
    assert.equal(displayFocusDocumentTitle(ui.controller.getConversations()[0]), "（已隐藏的文档）");
    assert.equal(await ui.controller.submitFollowUp("追问"), false);
    hidden.clear();
    ui.controller.state.closeWindow("on-demand-only");
    ui.controller.openDiscussion(deriveConversationSummary(archived));
    await flush();
    assert.deepEqual(ui.reads, ["on-demand-only", "on-demand-only"], "重开确实重新读档");
    assert.equal(ui.controller.state.conversation?.restricted, true);
    assert.equal(ui.controller.state.conversation?.restrictionReason, "hidden_material");
    assert.equal(ui.controller.state.followUpAvailable, false);
    ui.fireDriverLost();
    await flush();
    assert.deepEqual(ui.replayCalls, [], "重新可见后也不得恢复已锁存讨论");
  } finally { ui.restore(); }
});

test("5.9 recomputeRestrictions latches an open discussion and persists it so re-enable + reopen stays restricted", async () => {
  const hidden = new Set<string>();
  const ui = persistenceHarness({ getHiddenDocumentIds: () => hidden });
  try {
    await ui.openRecord({
      version: 1,
      conversation_id: "c-11",
      title: "选区",
      created_at: "t0",
      updated_at: "t0",
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
    // 锁存由后端档案级字段持久化，不再改写普通出处。
    await flush();
    assert.deepEqual(ui.latchCalls, ["doc-1"]);
    assert.equal(ui.saves.length, 0, "锁存不再由前端重存全文");
    const persisted = ui.archives.get("c-11")!;
    assert.deepEqual(persisted.restriction, { reason: "hidden_material", at: "t1" });
    assert.equal(persisted.provenance?.[0]?.material_type, "selection");

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
