import assert from "node:assert/strict";
import test from "node:test";

import {
  beginConversationFollowUp,
  buildConversationRecord,
  conversationFromRecord,
  conversationProvenanceForArchive,
  conversationRestrictionNotice,
  createConversationFromFirstSuccess,
  followUpAvailableOf,
  followUpRequestOf,
  HIDDEN_MATERIAL_RESTRICTION_NOTICE,
  isConversationMaterialRestricted,
  isConversationRestrictedForRecovery,
  isRevokedMaterial,
  latchConversationRestriction,
  materialProvenanceFromAnchor,
  MISSING_PROVENANCE_RESTRICTION_NOTICE,
  restrictionReasonOf,
  retryFollowUpQuestionOf,
  type TemporaryConversation,
} from "../src/ai-panel-conversation.ts";
import type {
  ConversationRecord,
  ConversationSummary,
} from "../src/conversation-archive.ts";
import type { SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string, documentId = "doc-1"): SelectionSnapshot {
  return { documentId, selectedText: text, from: 0, to: text.length };
}

function conversation(material: { kind: "summon"; selected_text: string }, anchor: SelectionSnapshot): TemporaryConversation {
  return createConversationFromFirstSuccess("c-1", "t0", anchor, material, "首答");
}

function recordWithProvenance(provenance: ConversationRecord["provenance"]): ConversationRecord {
  return {
    version: 1,
    conversation_id: "c-1",
    created_at: "t0",
    updated_at: "t0",
    focus_document_id: "doc-1",
    focus_document_title: null,
    first_round_material: { kind: "summon", question: "", selection_text: "选区" },
    turns: [{ role: "assistant", text: "首答", status: "done" }],
    ...(provenance !== undefined ? { provenance } : {}),
  };
}

test("materialProvenanceFromAnchor records minimal provenance without body copy", () => {
  const anchor = snapshot("林站在天台边。", "doc-9");
  const provenance = materialProvenanceFromAnchor(anchor);
  assert.deepEqual(provenance, [
    {
      document_id: "doc-9",
      material_type: "selection",
      document_version: null,
      turn_index: 0,
      entered_model_context: true,
    },
  ]);
  // 不出处正文：对象不含 selectedText / body / text 字段。
  assert.equal("selectedText" in provenance[0], false);
  assert.equal("body" in provenance[0], false);
});

test("materialProvenanceFromAnchor records the document version when the snapshot carries it", () => {
  const anchor: SelectionSnapshot = {
    documentId: "doc-9",
    selectedText: "选区",
    from: 0,
    to: 2,
    documentVersion: "v7",
  };
  assert.equal(materialProvenanceFromAnchor(anchor)[0].document_version, "v7");
});

test("materialProvenanceFromAnchor returns empty for a null or blank anchor", () => {
  assert.deepEqual(materialProvenanceFromAnchor(null), []);
  assert.deepEqual(materialProvenanceFromAnchor(snapshot("   ")), []);
});

test("buildConversationRecord emits provenance from the frozen anchor", () => {
  const anchor = snapshot("原选区", "doc-7");
  const value = conversation({ kind: "summon", selected_text: "原选区" }, anchor);
  const record = buildConversationRecord(value, "doc-7", "草稿");
  assert.deepEqual(record.provenance, [
    {
      document_id: "doc-7",
      material_type: "selection",
      document_version: null,
      turn_index: 0,
      entered_model_context: true,
    },
  ]);
});

test("a missing provenance field is conservative-restricted (old archive)", () => {
  const record = recordWithProvenance(undefined);
  assert.equal(isConversationMaterialRestricted(record, new Set()), true);
  assert.equal(restrictionReasonOf(record, new Set()), "missing_provenance");
});

test("an empty provenance array is not restricted (new archive with no materials)", () => {
  const record = recordWithProvenance([]);
  assert.equal(isConversationMaterialRestricted(record, new Set(["doc-1"])), false);
  assert.equal(restrictionReasonOf(record, new Set(["doc-1"])), undefined);
});

test("provenance referencing a hidden document is restricted", () => {
  const record = recordWithProvenance([
    { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
  ]);
  assert.equal(isConversationMaterialRestricted(record, new Set(["doc-1"])), true);
  assert.equal(restrictionReasonOf(record, new Set(["doc-1"])), "hidden_material");
});

test("provenance referencing only visible documents is not restricted", () => {
  const record = recordWithProvenance([
    { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
  ]);
  assert.equal(isConversationMaterialRestricted(record, new Set(["doc-other"])), false);
});

test("conversationFromRecord marks a hidden-document discussion restricted and blocks follow-up", () => {
  const summary: ConversationSummary = {
    conversation_id: "c-1",
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
  };
  const reopened = conversationFromRecord(summary, { hiddenDocumentIds: new Set(["doc-1"]) });
  assert.equal(reopened.restricted, true);
  assert.equal(reopened.restrictionReason, "hidden_material");
  assert.equal(followUpAvailableOf(reopened), false, "受限讨论不可继续追问");
  assert.equal(beginConversationFollowUp(reopened, "继续问", 1).turnId, null);
});

test("conversationFromRecord keeps a visible discussion continuable", () => {
  const summary: ConversationSummary = {
    conversation_id: "c-1",
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
  };
  const reopened = conversationFromRecord(summary, { hiddenDocumentIds: new Set() });
  assert.equal(reopened.restricted, false);
  assert.equal(followUpAvailableOf(reopened), true);
});

test("conversationRestrictionNotice returns the right message without leaking hidden names", () => {
  const hidden = conversationFromRecord(recordWithProvenance([
    { document_id: "secret-doc", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
  ]), { hiddenDocumentIds: new Set(["secret-doc"]) });
  const notice = conversationRestrictionNotice(hidden);
  assert.ok(notice);
  assert.ok(!notice.includes("secret-doc"), "提示不得泄露隐藏文档名称/ID");
  assert.equal(notice, HIDDEN_MATERIAL_RESTRICTION_NOTICE);

  const old = conversationFromRecord(recordWithProvenance(undefined));
  assert.equal(conversationRestrictionNotice(old), MISSING_PROVENANCE_RESTRICTION_NOTICE);

  const ok = conversationFromRecord(recordWithProvenance([]));
  assert.equal(conversationRestrictionNotice(ok), null);
});

test("re-saving a missing-provenance archive preserves the conservative restriction", () => {
  // 旧档案（无出处）重开后重命名再保存：不得悄悄升级为「新档案无材料」。
  const old = conversationFromRecord(recordWithProvenance(undefined));
  const record = buildConversationRecord(old, null, null);
  assert.equal(record.provenance, undefined, "旧档案重存不得写出处，保持保守受限");
});

test("re-saving a hidden-material restricted archive latches the restriction (revoked) and preserves the source document", () => {
  const provenance = [
    { document_id: "doc-1", material_type: "selection" as const, document_version: null, turn_index: 0, entered_model_context: true },
  ];
  const hidden = conversationFromRecord(
    recordWithProvenance(provenance),
    { hiddenDocumentIds: new Set(["doc-1"]) },
  );
  const record = buildConversationRecord(hidden, null, null);
  // 锁存：重存时出处标记为 revoked，来源文档身份保留（权限变化关系不丢失）。
  assert.deepEqual(
    record.provenance,
    [
      { document_id: "doc-1", material_type: "revoked", document_version: null, turn_index: 0, entered_model_context: true },
    ],
    "受限讨论重存必须锁存出处（revoked）并保留来源文档身份",
  );
  // 锁存后的档案在重新开启可见性（隐藏集为空）时仍受限，不被当前可见性重算解除。
  const reopened = conversationFromRecord(record, { hiddenDocumentIds: new Set() });
  assert.equal(reopened.restricted, true);
  assert.equal(reopened.restrictionReason, "hidden_material");
  assert.equal(followUpAvailableOf(reopened), false);
});

test("isConversationRestrictedForRecovery re-checks current visibility before replay", () => {
  // 出处引用当前隐藏文档 → 受限（不重放）。
  const withHiddenSource = conversationFromRecord(
    recordWithProvenance([
      { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
    ]),
    { hiddenDocumentIds: new Set() },
  );
  assert.equal(isConversationRestrictedForRecovery(withHiddenSource, new Set(["doc-1"])), true);
  // 出处文档仍可见 → 不受限（可重放）。
  assert.equal(isConversationRestrictedForRecovery(withHiddenSource, new Set(["doc-other"])), false);
  // 旧档案缺出处 → 保守受限。
  const missing = conversationFromRecord(recordWithProvenance(undefined));
  assert.equal(isConversationRestrictedForRecovery(missing, new Set()), true);
  // 无材料（空出处）→ 不受限。
  const noMaterial = conversationFromRecord(recordWithProvenance([]));
  assert.equal(isConversationRestrictedForRecovery(noMaterial, new Set(["doc-1"])), false);
});

test("isConversationRestrictedForRecovery derives provenance from a live anchor", () => {
  // 新建讨论（尚未写档案）没有 provenance 字段，但由冻结锚点派生出处。
  const anchor = snapshot("原选区", "doc-1");
  const live = createConversationFromFirstSuccess("c-1", "t0", anchor, { kind: "summon", selected_text: "原选区" }, "首答");
  assert.equal(live.provenance, undefined);
  assert.equal(isConversationRestrictedForRecovery(live, new Set(["doc-1"])), true);
  assert.equal(isConversationRestrictedForRecovery(live, new Set()), false);
});

// ========== 任务 5.4：锁存（revoked）与重新开启可见性不解除限制 ==========

test("isRevokedMaterial recognizes only revoked provenance entries", () => {
  assert.equal(isRevokedMaterial({ document_id: "d", material_type: "revoked", document_version: null, turn_index: 0, entered_model_context: true }), true);
  assert.equal(isRevokedMaterial({ document_id: "d", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true }), false);
});

test("a revoked provenance entry keeps the discussion restricted even when the document is re-enabled", () => {
  const record = recordWithProvenance([
    { document_id: "doc-1", material_type: "revoked", document_version: null, turn_index: 0, entered_model_context: true },
  ]);
  // 重新开启可见性（隐藏集为空）也不解除锁存的受限。
  assert.equal(isConversationMaterialRestricted(record, new Set()), true);
  assert.equal(restrictionReasonOf(record, new Set()), "hidden_material");
  const reopened = conversationFromRecord(record, { hiddenDocumentIds: new Set() });
  assert.equal(reopened.restricted, true);
  assert.equal(followUpAvailableOf(reopened), false);
});

test("latchConversationRestriction marks a newly-hidden source restricted and stays monotonic", () => {
  const anchor = snapshot("原选区", "doc-1");
  const live = createConversationFromFirstSuccess("c-1", "t0", anchor, { kind: "summon", selected_text: "原选区" }, "首答");
  assert.equal(live.restricted, undefined);

  // 隐藏 doc-1 后：被锁存为受限。
  const latched = latchConversationRestriction(live, new Set(["doc-1"]));
  assert.notEqual(latched, live);
  assert.equal(latched.restricted, true);
  assert.equal(latched.restrictionReason, "hidden_material");

  // 重新开启可见性（隐藏集为空）不解除：仍是同一受限对象。
  assert.equal(latchConversationRestriction(latched, new Set()), latched);
  assert.equal(latched.restricted, true);
});

test("restricted discussions cannot build follow-up or retry payloads", () => {
  const restricted: TemporaryConversation = {
    ...createConversationFromFirstSuccess("c-1", "t0", snapshot("原选区", "doc-1"), { kind: "summon", selected_text: "原选区" }, "首答"),
    restricted: true,
    restrictionReason: "hidden_material",
    pending: { id: 1, question: "追问", streamedText: "", error: { code: "network", message: "失败" } },
  };
  assert.equal(followUpRequestOf(restricted), null);
  assert.equal(retryFollowUpQuestionOf(restricted), null);
  assert.equal(followUpAvailableOf(restricted), false);
});

test("isConversationRestrictedForRecovery blocks a latched (revoked) discussion", () => {
  const restricted = conversationFromRecord(
    recordWithProvenance([
      { document_id: "doc-1", material_type: "revoked", document_version: null, turn_index: 0, entered_model_context: true },
    ]),
    { hiddenDocumentIds: new Set() },
  );
  assert.equal(restricted.restricted, true);
  assert.equal(isConversationRestrictedForRecovery(restricted, new Set()), true);
});

test("conversationProvenanceForArchive writes the revoked marker only for hidden-material restriction", () => {
  const selectionProvenance = [
    { document_id: "doc-1", material_type: "selection" as const, document_version: null, turn_index: 0, entered_model_context: true },
  ];
  const visible = createConversationFromFirstSuccess("c-1", "t0", snapshot("原选区", "doc-1"), { kind: "summon", selected_text: "原选区" }, "首答");
  const visibleWithProvenance = { ...visible, provenance: selectionProvenance };
  // 未受限：保持原出处。
  assert.deepEqual(conversationProvenanceForArchive(visibleWithProvenance), selectionProvenance);

  // 受限（hidden_material）：锁存为 revoked。
  const restricted = { ...visibleWithProvenance, restricted: true, restrictionReason: "hidden_material" as const };
  assert.deepEqual(conversationProvenanceForArchive(restricted), [
    { document_id: "doc-1", material_type: "revoked", document_version: null, turn_index: 0, entered_model_context: true },
  ]);
});
