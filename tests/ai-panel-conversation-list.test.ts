import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConversationGroups,
  describeConversationStatus,
  describeWindowStatus,
  effectiveTitle,
  formatRelativeTime,
  conversationGroupKey,
} from "../src/ai-panel-conversation-list.ts";
import type { ConversationSummary } from "../src/conversation-archive.ts";

/**
 * 会话列表纯显示逻辑测试（第 9 组）：分组、相对时间、统一状态词、排序、当前标记。
 */

function summary(partial: Partial<ConversationSummary> & { conversation_id: string }): ConversationSummary {
  return {
    title: partial.conversation_id,
    created_at: "2026-09-01T10:00:00+00:00",
    updated_at: "2026-09-01T10:00:00+00:00",
    last_status: "done",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
    turns: [{ role: "assistant", text: "回答", status: "done" }],
    custom_title: null,
    pinned: false,
    ...partial,
  };
}

const NOW = new Date("2026-09-10T15:00:00+08:00");

test("formatRelativeTime shows relative labels", () => {
  const minutesAgo = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  assert.equal(formatRelativeTime(minutesAgo, NOW), "5 分钟前");

  const justNow = new Date(NOW.getTime() - 30_000).toISOString();
  assert.equal(formatRelativeTime(justNow, NOW), "刚刚");
});

test("formatRelativeTime is empty for invalid or missing time", () => {
  assert.equal(formatRelativeTime(""), "");
  assert.equal(formatRelativeTime(null), "");
  assert.equal(formatRelativeTime(undefined), "");
  assert.equal(formatRelativeTime("not-a-date"), "");
});

test("describeConversationStatus maps terminal states to unified words", () => {
  assert.deepEqual(describeConversationStatus("done"), { label: "已完成", tone: "success" });
  assert.deepEqual(describeConversationStatus("failed"), { label: "失败", tone: "danger" });
  assert.deepEqual(describeConversationStatus("cancelled"), { label: "已停止", tone: "muted" });
  assert.deepEqual(describeConversationStatus("pending"), { label: "生成中", tone: "primary" });
  assert.deepEqual(describeConversationStatus(null), { label: "已完成", tone: "muted" });
});

test("describeWindowStatus maps window states to unified words", () => {
  assert.deepEqual(describeWindowStatus("generating"), { label: "生成中", tone: "primary" });
  assert.deepEqual(describeWindowStatus("queued"), { label: "排队中", tone: "warning" });
  assert.deepEqual(describeWindowStatus("stopped"), { label: "已停止", tone: "muted" });
  assert.deepEqual(describeWindowStatus("failed"), { label: "失败", tone: "danger" });
  assert.deepEqual(describeWindowStatus("recovering"), { label: "恢复中", tone: "primary" });
  assert.deepEqual(describeWindowStatus("done"), { label: "已完成", tone: "success" });
});

test("conversationGroupKey places timestamps into the correct bucket", () => {
  const today = new Date(NOW).toISOString();
  assert.equal(conversationGroupKey(today, NOW), "today");

  const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString();
  assert.equal(conversationGroupKey(yesterday, NOW), "yesterday");

  const lastMonth = new Date(2026, 7, 1).toISOString();
  assert.equal(conversationGroupKey(lastMonth, NOW), "last_month");

  const earlier = new Date(2025, 0, 1).toISOString();
  assert.equal(conversationGroupKey(earlier, NOW), "earlier");
});

test("effectiveTitle prefers the custom title over the derived title", () => {
  assert.equal(effectiveTitle(summary({ conversation_id: "a", title: "派生标题", custom_title: "我的标题" })), "我的标题");
  assert.equal(effectiveTitle(summary({ conversation_id: "b", title: "派生标题", custom_title: null })), "派生标题");
  assert.equal(effectiveTitle(summary({ conversation_id: "c", title: "派生标题", custom_title: "   " })), "派生标题");
});

test("buildConversationGroups sorts pinned first and groups by time", () => {
  const groups = buildConversationGroups(
    [
      summary({ conversation_id: "old", updated_at: "2025-01-01T00:00:00+08:00" }),
      summary({ conversation_id: "today", updated_at: new Date(NOW).toISOString() }),
      summary({ conversation_id: "pinned", pinned: true, updated_at: "2025-01-01T00:00:00+08:00" }),
    ],
    "today",
    NOW,
  );

  const keys = groups.map((g) => g.key);
  assert.deepEqual(keys, ["pinned", "today", "earlier"]);
  assert.deepEqual(groups[0].items.map((i) => i.conversationId), ["pinned"]);
  assert.deepEqual(groups[1].items.map((i) => i.conversationId), ["today"]);
  assert.deepEqual(groups[2].items.map((i) => i.conversationId), ["old"]);
});

test("buildConversationGroups marks the active discussion and returns month sections for earlier", () => {
  const groups = buildConversationGroups(
    [
      summary({ conversation_id: "a", updated_at: new Date(NOW).toISOString() }),
      summary({ conversation_id: "old1", updated_at: "2025-06-01T00:00:00+08:00" }),
      summary({ conversation_id: "old2", updated_at: "2025-05-01T00:00:00+08:00" }),
    ],
    "a",
    NOW,
  );

  assert.equal(groups[0].items[0].isActive, true);

  const earlier = groups.find((g) => g.key === "earlier")!;
  assert.equal(earlier.monthSections.length, 2);
  assert.equal(earlier.monthSections[0].label, "2025 年 6 月");
  assert.equal(earlier.monthSections[1].label, "2025 年 5 月");
});

test("buildConversationGroups omits empty groups", () => {
  const groups = buildConversationGroups(
    [summary({ conversation_id: "a", updated_at: new Date(NOW).toISOString() })],
    null,
    NOW,
  );
  assert.deepEqual(groups.map((g) => g.key), ["today"]);
});
