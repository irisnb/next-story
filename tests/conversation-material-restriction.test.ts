import assert from "node:assert/strict";
import test from "node:test";

import {
  beginConversationFollowUp,
  buildConversationRecord,
  buildDiscussionRecord,
  conversationConsumedDocumentIds,
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
  recordConsumedDocumentIds,
  retryFollowUpQuestionOf,
  summaryConsumedDocumentIds,
  summaryOf,
  type TemporaryConversation,
} from "../src/ai-panel-conversation.ts";
import type {
  ConversationRecord,
  ConversationSummary,
} from "../src/conversation-archive.ts";
import { displayFocusDocumentTitle } from "../src/ai-panel-conversation-list.ts";
import { deriveConversationSummary } from "../src/conversation-archive.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import { initialAiPanelCoreState, reduceAiPanelState } from "../src/ai-panel-reducer.ts";
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

/** IPC 实际返回 version，但它不能用于区别摘要与完整档案。 */
function backendSummary(overrides: Partial<ConversationSummary> = {}): ConversationSummary & { version: number } {
  return {
    version: 1, conversation_id: "c-1", title: "讨论", created_at: "t0", updated_at: "t0",
    last_status: "done", focus_document_id: "doc-1", focus_document_title: "手记篇",
    provenance: ["doc-1"], provenance_has_revoked: false,
    on_demand_document_ids: [], references_incomplete: false, ...overrides,
  };
}

test("IPC 摘要含 version：重启后空 hidden 集仍识别已锁存出处", () => {
  const summary = backendSummary({ provenance_has_revoked: true });
  assert.equal(isConversationMaterialRestricted(summary, new Set()), true);
});

test("IPC 摘要含 version：普通出处命中 hidden 时受限", () => {
  assert.equal(isConversationMaterialRestricted(backendSummary(), new Set(["doc-1"])), true);
});

for (const provenance of [null, undefined]) {
  test(`IPC 摘要含 version：provenance 为 ${provenance} 时保守受限`, () => {
    const summary = backendSummary({ provenance });
    assert.equal(isConversationMaterialRestricted(summary, new Set()), true);
    assert.equal(restrictionReasonOf(summary, new Set()), "missing_provenance");
  });
}

test("IPC 摘要含 version：仅补读出处命中也受限", () => {
  const summary = backendSummary({ on_demand_document_ids: ["doc-other"] });
  assert.equal(isConversationMaterialRestricted(summary, new Set(["doc-other"])), true);
  assert.equal(restrictionReasonOf(summary, new Set(["doc-other"])), "hidden_material");
  assert.equal(isConversationMaterialRestricted(summary, new Set(["unrelated"])), false);
});

test("IPC 摘要含 version：列表对受限关注文档标题脱敏", () => {
  const summary = backendSummary({ provenance_has_revoked: true });
  const restricted = isConversationMaterialRestricted(summary, new Set());
  assert.equal(displayFocusDocumentTitle({ ...summary, restricted }), "（已隐藏的文档）");
  assert.equal(summary.focus_document_title, "手记篇", "只脱敏显示，不修改真实标题");
});

test("load_discussions：首次加载真实 IPC 摘要即锁存并脱敏，无需交互", () => {
  const summary = backendSummary({ provenance_has_revoked: true });
  const state = reduceAiPanelState(initialAiPanelCoreState(), {
    type: "load_discussions", summaries: [summary], skipped: [], hiddenDocumentIds: new Set(),
  });
  const loaded = state.summaries.get("c-1")!;
  assert.equal(loaded.restricted, true);
  assert.equal(displayFocusDocumentTitle(loaded), "（已隐藏的文档）");
  assert.equal(state.discussions.size, 0, "列表脱敏不依赖读入全文");
});

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
  const summary: ConversationRecord = {
    version: 1,
    conversation_id: "c-1",
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
  };
  const reopened = conversationFromRecord(summary, { hiddenDocumentIds: new Set(["doc-1"]) });
  assert.equal(reopened.restricted, true);
  assert.equal(reopened.restrictionReason, "hidden_material");
  assert.equal(followUpAvailableOf(reopened), false, "受限讨论不可继续追问");
  assert.equal(beginConversationFollowUp(reopened, "继续问", 1).turnId, null);
});

test("conversationFromRecord keeps a visible discussion continuable", () => {
  const summary: ConversationRecord = {
    version: 1,
    conversation_id: "c-1",
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

test("re-saving a hidden-material restricted archive preserves provenance without fabricating revoked markers", () => {
  const provenance = [
    { document_id: "doc-1", material_type: "selection" as const, document_version: null, turn_index: 0, entered_model_context: true },
  ];
  const hidden = conversationFromRecord(
    recordWithProvenance(provenance),
    { hiddenDocumentIds: new Set(["doc-1"]) },
  );
  const record = buildConversationRecord(hidden, null, null);
  assert.deepEqual(record.provenance, provenance, "出处保持原样；永久锁存只由后端窄更新写入");
  assert.equal("restriction" in record, false, "普通保存不写后端锁存字段");
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

test("conversationProvenanceForArchive preserves both ordinary provenance and legacy revoked entries", () => {
  const selectionProvenance = [
    { document_id: "doc-1", material_type: "selection" as const, document_version: null, turn_index: 0, entered_model_context: true },
  ];
  const visible = createConversationFromFirstSuccess("c-1", "t0", snapshot("原选区", "doc-1"), { kind: "summon", selected_text: "原选区" }, "首答");
  const visibleWithProvenance = { ...visible, provenance: selectionProvenance };
  // 未受限：保持原出处。
  assert.deepEqual(conversationProvenanceForArchive(visibleWithProvenance), selectionProvenance);

  // 受限（hidden_material）：不再把正常出处改成 revoked。
  const restricted = { ...visibleWithProvenance, restricted: true, restrictionReason: "hidden_material" as const };
  assert.deepEqual(conversationProvenanceForArchive(restricted), selectionProvenance);
  const legacy = recordWithProvenance([
    { document_id: "doc-1", material_type: "revoked", document_version: null, turn_index: 0, entered_model_context: true },
  ]);
  assert.deepEqual(conversationProvenanceForArchive(conversationFromRecord(legacy)), legacy.provenance);
});

function onDemandOnlyRecord(): ConversationRecord {
  return {
    ...recordWithProvenance([]),
    on_demand_reading_provenance: [{
      document_id: "supplement", version: "v1", depth: "full", turn_index: 0,
      entered_model_context: true,
    }],
  };
}

test("三种消费文档推导合并并去重两类出处，运行期仅在缺出处时回退锚点", () => {
  const record = onDemandOnlyRecord();
  record.provenance = materialProvenanceFromAnchor(snapshot("选区", "ordinary"));
  record.on_demand_reading_provenance!.push({
    ...record.on_demand_reading_provenance![0], document_id: "ordinary",
  });
  const expected = new Set(["ordinary", "supplement"]);
  assert.deepEqual(recordConsumedDocumentIds(record), expected);
  assert.deepEqual(summaryConsumedDocumentIds(deriveConversationSummary(record)), expected);
  const live = conversationFromRecord(record);
  assert.deepEqual(conversationConsumedDocumentIds(live), expected);
  live.anchor = snapshot("选区", "anchor");
  assert.deepEqual(conversationConsumedDocumentIds(live), expected, "已有出处优先于锚点");
  live.provenance = undefined;
  assert.deepEqual(conversationConsumedDocumentIds(live), new Set(["anchor", "supplement", "ordinary"]));
  live.provenance = [];
  assert.deepEqual(conversationConsumedDocumentIds(live), new Set(["supplement", "ordinary"]), "空出处不回退锚点");
});

for (const provenance of [null, undefined]) {
  test(`补读出处存在但普通出处为 ${provenance} 仍保持 missing_provenance`, () => {
    const record = { ...onDemandOnlyRecord(), provenance };
    assert.equal(recordConsumedDocumentIds(record), null);
    assert.equal(summaryConsumedDocumentIds(deriveConversationSummary(record)), null);
    assert.equal(isConversationMaterialRestricted(record, new Set()), true);
    assert.equal(restrictionReasonOf(record, new Set()), "missing_provenance");
    const live = conversationFromRecord(record);
    assert.equal(live.restrictionReason, "missing_provenance");
    assert.equal(isConversationRestrictedForRecovery(live, new Set()), true);
    assert.equal(conversationProvenanceForArchive(live), undefined);
  });
}

test("补读-only 隐藏来源：重开、摘要、恢复和实时锁存统一受限", () => {
  const record = onDemandOnlyRecord();
  const hidden = new Set(["supplement"]);
  const visible = conversationFromRecord(record);
  assert.equal(visible.restricted, false);
  assert.equal(isConversationRestrictedForRecovery(visible, new Set()), false);
  assert.equal(latchConversationRestriction(visible, new Set(["unrelated"])), visible);
  assert.equal(isConversationMaterialRestricted(record, hidden), true);
  assert.equal(restrictionReasonOf(record, hidden), "hidden_material");
  const opened = conversationFromRecord(record, { hiddenDocumentIds: hidden });
  assert.equal(opened.restricted, true);
  assert.equal(opened.restrictionReason, "hidden_material");
  assert.equal(followUpAvailableOf(opened), false);
  assert.equal(beginConversationFollowUp(opened, "不能继续", 1).turnId, null);
  assert.equal(isConversationMaterialRestricted(deriveConversationSummary(record), hidden), true);
  assert.equal(isConversationRestrictedForRecovery(visible, hidden), true);
  const latched = latchConversationRestriction(visible, hidden);
  assert.equal(latched.restricted, true);
  assert.equal(latched.restrictionReason, "hidden_material");
  assert.equal(latchConversationRestriction(latched, new Set()), latched);
  assert.equal(isConversationRestrictedForRecovery(latched, new Set()), true);
  assert.equal(summaryOf(latched, "doc-1", "关注文档").restricted, true);
});

for (const provenance of [[], null, undefined] as const) {
  test(`统一锁存优先于缺出处（${provenance}），可见性重新开启也不解除`, () => {
    const record: ConversationRecord = {
      ...onDemandOnlyRecord(), provenance: provenance == null ? provenance : [],
      restriction: { reason: "hidden_material", at: "2026-09-26T00:00:00Z" },
    };
    assert.equal(isConversationMaterialRestricted(record, new Set()), true);
    assert.equal(restrictionReasonOf(record, new Set()), "hidden_material");
    const opened = conversationFromRecord(record);
    assert.equal(opened.restricted, true);
    assert.equal(opened.restrictionReason, "hidden_material");
    assert.equal(isConversationRestrictedForRecovery(opened, new Set()), true);
    const summary = deriveConversationSummary(record);
    assert.equal(summary.restricted, true);
    assert.equal(summary.provenance_has_revoked, false, "统一锁存不伪造旧标记");
    assert.equal(isConversationMaterialRestricted(summary, new Set()), true);
    assert.equal(restrictionReasonOf(summary, new Set()), "hidden_material");
  });
}

test("旧 revoked 标记在摘要派生与恢复中保留，不能被运行期 false 覆盖", () => {
  const record = recordWithProvenance([{ ...materialProvenanceFromAnchor(snapshot("选区"))[0], material_type: "revoked" }]);
  assert.equal(record.restriction, undefined);
  const derived = deriveConversationSummary(record);
  assert.equal(derived.restricted, true);
  assert.equal(derived.provenance_has_revoked, true);
  assert.equal(isConversationMaterialRestricted({ ...derived, restricted: false }, new Set()), true);
  const live = { ...conversationFromRecord(record), restricted: false };
  assert.equal(isConversationRestrictedForRecovery(live, new Set()), true);
  assert.equal(summaryOf(live, "doc-1", "关注文档").restricted, true);
});

test("recomputeRestrictions 对补读-only 打开窗口和仅列表摘要统一锁存、脱敏", () => {
  const record = { ...onDemandOnlyRecord(), focus_document_title: "关注文档名" };
  const state = new AiPanelState();
  state.loadDiscussions([
    deriveConversationSummary(record),
    { ...deriveConversationSummary(record), conversation_id: "closed" },
  ], []);
  state.openDiscussion(conversationFromRecord(record), record.focus_document_id, record.focus_document_title);
  assert.deepEqual(state.recomputeRestrictions(new Set(["supplement"])), ["c-1"]);
  assert.equal(state.conversation?.restricted, true);
  assert.equal(state.followUpAvailable, false);
  for (const summary of state.conversations) {
    assert.equal(summary.restricted, true);
    assert.equal(displayFocusDocumentTitle(summary), "（已隐藏的文档）");
    assert.equal(summary.provenance_has_revoked, false);
  }
  assert.equal(state.getDiscussion("closed"), null, "仅列表讨论不读正文");
  assert.deepEqual(state.recomputeRestrictions(new Set()), []);
  state.loadDiscussions([deriveConversationSummary(record)], [], new Set());
  assert.equal(state.conversations[0].restricted, true, "旧列表回填不得解除运行期锁存");
});

for (const overrides of [
  { on_demand_document_ids: ["supplement"] },
  { restricted: true },
  { provenance_has_revoked: true, restricted: false },
]) {
  test(`列表首载与摘要更新识别受限来源 ${JSON.stringify(overrides)}`, () => {
    const summary = backendSummary({ provenance: [], ...overrides });
    const state = new AiPanelState();
    state.loadDiscussions([summary], [], new Set(["supplement"]));
    assert.equal(displayFocusDocumentTitle(state.conversations[0]), "（已隐藏的文档）");
    const updated = new AiPanelState();
    updated.upsertSummary(summary, new Set(["supplement"]));
    assert.equal(updated.conversations[0].restricted, true);
    assert.equal(displayFocusDocumentTitle(updated.conversations[0]), "（已隐藏的文档）");
  });
}

test("后端锁存回执只设置统一受限，不伪造 provenance_has_revoked", () => {
  const state = new AiPanelState();
  state.loadDiscussions([backendSummary()], []);
  state.latchRestrictions(["c-1"]);
  assert.equal(state.conversations[0].restricted, true);
  assert.equal(state.conversations[0].provenance_has_revoked, false);
  assert.equal(displayFocusDocumentTitle(state.conversations[0]), "（已隐藏的文档）");
});

for (const grant of [undefined, null, { granted_at: "t1" }]) {
  test(`普通保存不携带授权字段（运行期授权 ${JSON.stringify(grant)}）`, () => {
    const record = { ...onDemandOnlyRecord(), on_demand_reading_grant: grant };
    const conversation = conversationFromRecord(record);
    assert.deepEqual(conversation.onDemandReadingGrant, grant ?? null, "读取授权仍保留");
    const state = new AiPanelState();
    state.openDiscussion(conversation, "doc-1", "关注文档");
    const discussion = state.getDiscussion("c-1")!;
    const records = [
      buildConversationRecord(conversation, "doc-1", "关注文档"),
      buildDiscussionRecord(discussion),
      buildDiscussionRecord({ ...discussion, conversation: null,
        pendingFirstRequest: { kind: "direct_question", question: "问题" }, onDemandReadingGrant: grant }),
    ];
    for (const payload of records) {
      assert.equal("on_demand_reading_grant" in payload, false);
      assert.equal("on_demand_reading_grant" in JSON.parse(JSON.stringify(payload)), false);
      assert.equal("on_demand_reading_provenance" in payload, false);
      assert.equal("restriction" in payload, false);
    }
  });
}
