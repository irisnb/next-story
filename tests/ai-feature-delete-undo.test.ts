import assert from "node:assert/strict";
import test from "node:test";
import { setupDeleteUndo } from "../src/ai-feature-delete-undo.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import { deriveConversationSummary, type ConversationRecord } from "../src/conversation-archive.ts";
import { displayFocusDocumentTitle } from "../src/ai-panel-conversation-list.ts";

function record(): ConversationRecord {
  return {
    version: 1, conversation_id: "archived", title: "档案", created_at: "t0", updated_at: "t1",
    focus_document_id: null, focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
    turns: [{ role: "assistant", text: "磁盘原文", status: "done" }], provenance: [],
  };
}

function harness(archive = record(), hidden: ReadonlySet<string> = new Set()) {
  const state = new AiPanelState();
  state.loadDiscussions([deriveConversationSummary(archive)], [], hidden);
  let token = 1;
  let restoreError = false;
  let readError = false;
  let readHook = () => {};
  const calls: string[] = [];
  const undo = setupDeleteUndo({
    state, getCurrentProjectPath: () => "作品", getProjectToken: () => token,
    hiddenDocumentIds: () => hidden, isDestroyed: () => false,
    cancelMessage: () => {}, endSession: () => {}, cancelQueued: () => {},
    deleteConversation: async () => { calls.push("delete"); },
    restoreConversation: async () => {
      calls.push("restore");
      assert.equal(state.isDeleted("archived"), true, "恢复提交前删除守卫保持");
      if (restoreError) throw new Error("恢复失败");
    },
    readConversation: async () => {
      calls.push("read");
      readHook();
      if (readError) throw new Error("读取失败");
      return archive;
    },
  });
  return { state, undo, calls,
    failRestore: (value: boolean) => { restoreError = value; },
    failRead: (value: boolean) => { readError = value; },
    onRead: (hook: () => void) => { readHook = hook; },
    switchProject: () => { token += 1; state.reset(); },
  };
}

test("2.8 未打开讨论软删除后，撤销先恢复再读取，不依赖内存全文", async () => {
  const ui = harness();
  try {
    assert.equal(ui.state.getDiscussion("archived"), null);
    await ui.undo.deleteDiscussion("archived");
    assert.deepEqual(ui.calls, ["delete"]);
    assert.equal(ui.state.conversations.length, 0);
    await ui.undo.undoDelete();
    assert.deepEqual(ui.calls, ["delete", "restore", "read"]);
    assert.equal(ui.state.isDeleted("archived"), false);
    assert.equal(ui.state.conversation?.firstResponse, "磁盘原文");
    assert.equal(ui.state.conversations.length, 1);
    assert.equal("turns" in ui.state.conversations[0], false);
    assert.equal(ui.undo.getUndoNotice(), null);
  } finally { ui.undo.clearUndo(); }
});

for (const latched of [false, true]) {
  test(`撤销删除恢复补读-only 受限讨论：${latched ? "统一锁存、已重新可见" : "当前隐藏"}`, async () => {
    const archive: ConversationRecord = {
      ...record(), focus_document_id: "focus", focus_document_title: "关注文档名",
      on_demand_reading_provenance: [{ document_id: "supplement", version: "v1",
        depth: "full", turn_index: 0, entered_model_context: true }],
      ...(latched ? { restriction: { reason: "hidden_material" as const, at: "t1" } } : {}),
    };
    const ui = harness(archive, new Set(latched ? [] : ["supplement"]));
    try {
      await ui.undo.deleteDiscussion("archived");
      await ui.undo.undoDelete();
      assert.deepEqual(ui.calls, ["delete", "restore", "read"]);
      assert.equal(ui.state.conversation?.restricted, true);
      assert.equal(ui.state.conversation?.restrictionReason, "hidden_material");
      assert.equal(ui.state.followUpAvailable, false);
      assert.equal(ui.state.conversations[0].restricted, true);
      assert.equal(displayFocusDocumentTitle(ui.state.conversations[0]), "（已隐藏的文档）");
      assert.equal(ui.state.conversations[0].provenance_has_revoked, false);
    } finally { ui.undo.clearUndo(); }
  });
}

test("2.8 恢复失败保留删除守卫及撤销提示，再次撤销可成功", async () => {
  const ui = harness();
  try {
    await ui.undo.deleteDiscussion("archived");
    ui.failRestore(true);
    await ui.undo.undoDelete();
    assert.deepEqual(ui.calls, ["delete", "restore"]);
    assert.equal(ui.state.isDeleted("archived"), true);
    assert.ok(ui.undo.getUndoNotice());
    assert.match(ui.state.saveError!, /恢复失败/);
    ui.failRestore(false);
    await ui.undo.undoDelete();
    assert.deepEqual(ui.calls, ["delete", "restore", "restore", "read"]);
    assert.equal(ui.state.conversation?.firstResponse, "磁盘原文");
  } finally { ui.undo.clearUndo(); }
});

test("2.8 恢复已提交而读取失败，只重试读取；不重新恢复或保存", async () => {
  const ui = harness();
  try {
    await ui.undo.deleteDiscussion("archived");
    ui.failRead(true);
    await ui.undo.undoDelete();
    assert.deepEqual(ui.calls, ["delete", "restore", "read"]);
    assert.ok(ui.undo.getUndoNotice());
    assert.equal(ui.state.conversations.length, 0);
    ui.failRead(false);
    await ui.undo.undoDelete();
    assert.deepEqual(ui.calls, ["delete", "restore", "read", "read"]);
    assert.equal(ui.state.conversation?.firstResponse, "磁盘原文");
  } finally { ui.undo.clearUndo(); }
});

test("2.8 撤销读档期间切换作品，迟到内容不进入新作品", async () => {
  const ui = harness();
  try {
    await ui.undo.deleteDiscussion("archived");
    ui.onRead(ui.switchProject);
    await ui.undo.undoDelete();
    assert.equal(ui.state.windows.size, 0);
    assert.equal(ui.state.conversations.length, 0);
  } finally { ui.undo.clearUndo(); }
});

test("撤销提示生命周期：删除后立即通知订阅者，撤销成功后清空并通知", async () => {
  const ui = harness();
  const notices: ({ title: string } | null)[] = [];
  const unsubscribe = ui.state.subscribe(() => notices.push(ui.undo.getUndoNotice()));
  try {
    await ui.undo.deleteDiscussion("archived");
    assert.deepEqual(notices, [null, { title: "档案" }], "删除状态通知后，新增一次提示可用通知");
    notices.length = 0;
    await ui.undo.undoDelete();
    assert.deepEqual(notices, [{ title: "档案" }, { title: "档案" }, null],
      "摘要和开窗通知后，新增一次提示清空通知");
    assert.equal(ui.undo.getUndoNotice(), null);
  } finally { unsubscribe(); ui.undo.clearUndo(); }
});

test("撤销提示生命周期：六秒超时清空提示并立即通知订阅者", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = harness();
  const notices: ({ title: string } | null)[] = [];
  const unsubscribe = ui.state.subscribe(() => notices.push(ui.undo.getUndoNotice()));
  try {
    await ui.undo.deleteDiscussion("archived");
    notices.length = 0;
    t.mock.timers.tick(5999);
    assert.deepEqual(ui.undo.getUndoNotice(), { title: "档案" });
    assert.equal(notices.length, 0);
    t.mock.timers.tick(1);
    assert.equal(ui.undo.getUndoNotice(), null);
    assert.deepEqual(notices, [null]);
    t.mock.timers.tick(6000);
    assert.deepEqual(notices, [null], "超时只通知一次");
  } finally { unsubscribe(); ui.undo.clearUndo(); }
});

test("撤销提示生命周期：clearUndo 只在实际清除提示时通知", async () => {
  const ui = harness();
  const notices: ({ title: string } | null)[] = [];
  const unsubscribe = ui.state.subscribe(() => notices.push(ui.undo.getUndoNotice()));
  try {
    ui.undo.clearUndo();
    assert.equal(notices.length, 0);
    await ui.undo.deleteDiscussion("archived");
    notices.length = 0;
    ui.undo.clearUndo();
    assert.deepEqual(notices, [null]);
    ui.undo.clearUndo();
    assert.deepEqual(notices, [null]);
  } finally { unsubscribe(); ui.undo.clearUndo(); }
});
