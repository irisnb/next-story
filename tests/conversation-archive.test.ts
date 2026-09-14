import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationDelete,
  conversationList,
  conversationSave,
  deriveConversationTitle,
  generateConversationId,
  roundProvenanceToMaterialProvenance,
  type ConversationInvokeFn,
  type ConversationRecord,
} from "../src/conversation-archive.ts";

test("roundProvenanceToMaterialProvenance maps backend entries to archive shape", () => {
  const entries = roundProvenanceToMaterialProvenance(
    [
      { document_id: "focus-1", material_type: "focus_document", version: "v1" },
      { document_id: "doc-9", material_type: "search_snippet", version: "v2", matched_term: "林晓" },
    ],
    2,
  );

  assert.deepEqual(entries, [
    {
      document_id: "focus-1",
      material_type: "focus_document",
      document_version: "v1",
      turn_index: 2,
      entered_model_context: true,
    },
    {
      document_id: "doc-9",
      material_type: "search_snippet",
      document_version: "v2",
      turn_index: 2,
      entered_model_context: true,
      matched_term: "林晓",
    },
  ]);

  // 无后端出处时返回空数组（不伪造 sent / 不产生空条目）。
  assert.deepEqual(roundProvenanceToMaterialProvenance(undefined, 0), []);
});

test("entered_model_context represents intent-to-send, never provider-sent", () => {
  const entries = roundProvenanceToMaterialProvenance(
    [{ document_id: "doc-9", material_type: "search_snippet", version: "v2", matched_term: "林晓" }],
    0,
  );

  assert.equal(entries[0].entered_model_context, true, "已组装材料标记为想发送");
  // 不存在任何表示「已发送给 provider」的字段：回执未落地，不伪造 sent。
  assert.ok(!("sent" in entries[0]), "出处不得携带 sent 状态");
  assert.ok(!("delivered" in entries[0]), "出处不得携带 delivered 状态");
  assert.ok(!("send_status" in entries[0]), "出处不得携带 send_status 状态");
});

test("sent_confirmed is only marked when the message_sent receipt was observed", () => {
  const withReceipt = roundProvenanceToMaterialProvenance(
    [{ document_id: "doc-9", material_type: "focus_document", version: "v1" }],
    0,
    true,
  );
  assert.equal(withReceipt[0].sent_confirmed, true, "收到 message_sent 回执才标记已确认发送");

  const withoutReceipt = roundProvenanceToMaterialProvenance(
    [{ document_id: "doc-9", material_type: "focus_document", version: "v1" }],
    0,
  );
  assert.equal(
    withoutReceipt[0].sent_confirmed,
    undefined,
    "未观测到回执时不携带回执标记（未确认，不伪造）",
  );
  assert.ok(!("sent_confirmed" in withoutReceipt[0]), "未确认轮次不得写入 sent_confirmed 字段");
});

test("roundProvenanceToMaterialProvenance preserves unsaved state and retrieval status (5.1)", () => {
  const entries = roundProvenanceToMaterialProvenance(
    [
      {
        document_id: "focus-1",
        material_type: "focus_document",
        version: "v1",
        from_unsaved_snapshot: true,
        search_status: "not_found",
        search_limited: false,
      },
      { document_id: "doc-9", material_type: "search_snippet", version: "v2", matched_term: "林晓" },
    ],
    0,
  );

  assert.equal(entries[0].from_unsaved_snapshot, true);
  assert.equal(entries[0].search_status, "not_found");
  assert.equal(entries[0].search_limited, false);
  assert.equal(entries[1].from_unsaved_snapshot, undefined);
  assert.equal(entries[1].search_status, undefined);
  assert.equal(entries[1].matched_term, "林晓");
});

test("generateConversationId produces distinct unique ids across calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    ids.add(generateConversationId());
  }
  assert.equal(ids.size, 100, "连续生成的 conversation_id 互不相同");
});

test("generateConversationId combines a timestamp prefix with the random segment", () => {
  const id = generateConversationId(() => "abc123");
  assert.match(id, /^[0-9a-z]+-abc123$/, "id 以时间戳为前缀并以随机段结尾");
  assert.ok(id.length > 0);
});

test("deriveConversationTitle prefers the direct-question text and truncates", () => {
  const createdAt = "2026-09-09T00:00:00Z";
  assert.equal(
    deriveConversationTitle({ kind: "direct_question", question: "这个角色为什么犹豫？", selection_text: null }, createdAt),
    "这个角色为什么犹豫？",
  );
  const long = "很".repeat(80);
  const title = deriveConversationTitle({ kind: "direct_question", question: long, selection_text: null }, createdAt);
  assert.equal(title.length, 41, "超长标题截断为 40 字加省略号");
  assert.ok(title.endsWith("…"));
});

test("deriveConversationTitle prefers the summon selection text and falls back to time", () => {
  const createdAt = "2026-09-09T00:00:00Z";
  assert.equal(
    deriveConversationTitle({ kind: "summon", question: "", selection_text: "林站在天台边。" }, createdAt),
    "林站在天台边。",
  );
  assert.equal(
    deriveConversationTitle({ kind: "summon", question: "", selection_text: null }, createdAt),
    createdAt,
  );
});

test("conversationSave, conversationList, and conversationDelete invoke the shared commands", async () => {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const call = ((cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args: args ?? {} });
    if (cmd === "conversation_list") {
      return Promise.resolve({ conversations: [], skipped: [] });
    }
    return Promise.resolve(undefined);
  }) as unknown as ConversationInvokeFn;

  const record: ConversationRecord = {
    version: 1,
    conversation_id: "c-1",
    created_at: "t0",
    updated_at: "t0",
    focus_document_id: "doc-1",
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问", selection_text: null },
    turns: [],
  };

  await conversationSave("作品路径", record, call);
  await conversationList("作品路径", call);
  await conversationDelete("作品路径", "c-1", call);

  assert.deepEqual(calls, [
    { cmd: "conversation_save", args: { projectPath: "作品路径", record } },
    { cmd: "conversation_list", args: { projectPath: "作品路径" } },
    { cmd: "conversation_delete", args: { projectPath: "作品路径", conversationId: "c-1" } },
  ]);
});

function makeRecord(conversationId: string): ConversationRecord {
  return {
    version: 1,
    conversation_id: conversationId,
    created_at: "t0",
    updated_at: "t0",
    focus_document_id: "doc-1",
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问", selection_text: null },
    turns: [],
  };
}

test("after delete, saving the same conversation_id does not invoke conversation_save", async () => {
  const calls: string[] = [];
  const call = (async (cmd: string) => { calls.push(cmd); }) as unknown as ConversationInvokeFn;

  await conversationDelete("作品路径", "c-del-1", call);
  await conversationSave("作品路径", makeRecord("c-del-1"), call);

  assert.deepEqual(calls, ["conversation_delete"], "删除后同 id 的保存不产生 conversation_save 调用");
});

test("an in-flight save cannot resurrect a deleted archive; a late save is safely skipped", async () => {
  const invokes: string[] = [];
  let firstSave = true;
  let resolveSave: (() => void) | null = null;
  const call = ((cmd: string) => {
    invokes.push(cmd);
    if (cmd === "conversation_save" && firstSave) {
      firstSave = false;
      return new Promise<void>((resolve) => { resolveSave = resolve; });
    }
    return Promise.resolve();
  }) as unknown as ConversationInvokeFn;

  // 保存先发起但落盘晚于删除：删除必须等待在途保存先落盘，再删除，保证删除最后落地。
  const save = conversationSave("作品路径", makeRecord("c-race"), call);
  const del = conversationDelete("作品路径", "c-race", call);

  // 删除发起时在途保存尚未落盘，conversation_delete 尚不应被调用。
  assert.deepEqual(invokes, ["conversation_save"], "删除应等待在途保存落盘，不立即发起 conversation_delete");

  resolveSave!();
  await save;
  await del;

  assert.deepEqual(invokes, ["conversation_save", "conversation_delete"], "删除在保存落盘后落地，不会复活档案");

  // 删除后同 id 的迟到保存被安全跳过，不再发起 invoke。
  await conversationSave("作品路径", makeRecord("c-race"), call);
  assert.deepEqual(invokes, ["conversation_save", "conversation_delete"], "已删除 id 的迟到保存不再 invoke");
});

test("normal save is unaffected by the deleted guard", async () => {
  const calls: string[] = [];
  const call = (async (cmd: string) => { calls.push(cmd); }) as unknown as ConversationInvokeFn;

  await conversationSave("作品路径", makeRecord("c-ok"), call);

  assert.deepEqual(calls, ["conversation_save"], "正常保存照常发起 conversation_save");
});
