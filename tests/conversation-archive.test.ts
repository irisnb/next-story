import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationDelete,
  conversationList,
  conversationRestore,
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

/** 排空微任务队列：串行链的后一环在微任务中接力，断言前先让链走完当前环。 */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

test("overlapping saves serialize in issue order: the later save waits for the earlier one", async () => {
  const invokes: string[] = [];
  let resolveFirst: (() => void) | null = null;
  let first = true;
  const call = ((cmd: string) => {
    invokes.push(cmd);
    if (cmd === "conversation_save" && first) {
      first = false;
      return new Promise<void>((resolve) => { resolveFirst = resolve; });
    }
    return Promise.resolve();
  }) as unknown as ConversationInvokeFn;

  const firstSave = conversationSave("作品路径", makeRecord("c-order"), call);
  const secondSave = conversationSave("作品路径", makeRecord("c-order"), call);

  assert.deepEqual(invokes, ["conversation_save"], "重叠保存串行：第二笔在第一笔落盘前不发起 invoke");

  resolveFirst!();
  await firstSave;
  await secondSave;

  assert.deepEqual(
    invokes,
    ["conversation_save", "conversation_save"],
    "两笔保存按发起顺序落盘：慢的第一笔不会在第二笔之后再覆盖（丢更新）",
  );
});

test("delete drains every queued save and lands last, with no spurious failure", async () => {
  const invokes: string[] = [];
  const pendingSaves: Array<() => void> = [];
  const call = ((cmd: string) => {
    invokes.push(cmd);
    if (cmd === "conversation_save") {
      return new Promise<void>((resolve) => { pendingSaves.push(resolve); });
    }
    return Promise.resolve();
  }) as unknown as ConversationInvokeFn;

  const saveA = conversationSave("作品路径", makeRecord("c-drain"), call);
  const saveB = conversationSave("作品路径", makeRecord("c-drain"), call);
  const del = conversationDelete("作品路径", "c-drain", call);

  assert.deepEqual(invokes, ["conversation_save"], "删除与第二笔保存都排在第一笔之后");

  pendingSaves[0]!();
  await saveA;
  await tick();
  assert.deepEqual(invokes, ["conversation_save", "conversation_save"], "第一笔完成后第二笔才发起");

  pendingSaves[1]!();
  await saveB;
  await del;

  assert.deepEqual(
    invokes,
    ["conversation_save", "conversation_save", "conversation_delete"],
    "删除排干全部在途保存后最后落地，全程无 rejection（上游不会误报保存失败）",
  );
});

test("a late save rejected by the backend tombstone is an expected outcome, not a failure", async () => {
  let invoked = false;
  const call = (() => {
    invoked = true;
    return Promise.reject("讨论已删除，无法保存: c-tombstone");
  }) as unknown as ConversationInvokeFn;

  await conversationSave("作品路径", makeRecord("c-tombstone"), call);

  assert.equal(invoked, true, "保存已发起、被墓碑拒绝，且被视为预期终局（不向调用方 reject）");
});

test("after undo (restore), the conversation can be saved again", async () => {
  const calls: string[] = [];
  const call = (async (cmd: string) => { calls.push(cmd); }) as unknown as ConversationInvokeFn;

  await conversationDelete("作品路径", "c-undo", call);
  await conversationRestore("作品路径", "c-undo", call);
  await conversationSave("作品路径", makeRecord("c-undo"), call);

  assert.deepEqual(
    calls,
    ["conversation_delete", "conversation_restore", "conversation_save"],
    "撤销删除后新保存正常发起并落盘（删后守卫被正确清除，不被前端自拦）",
  );
});

test("a failed save does not block the next save on the same conversation chain", async () => {
  const calls: string[] = [];
  let first = true;
  const call = ((cmd: string) => {
    calls.push(cmd);
    if (first) {
      first = false;
      return Promise.reject(new Error("disk unavailable"));
    }
    return Promise.resolve();
  }) as unknown as ConversationInvokeFn;

  const failed = conversationSave("作品路径", makeRecord("c-fail"), call);
  await assert.rejects(failed, /disk unavailable/);
  await conversationSave("作品路径", makeRecord("c-fail"), call);

  assert.deepEqual(calls, ["conversation_save", "conversation_save"], "链上前一环失败不阻断后续保存");
});
