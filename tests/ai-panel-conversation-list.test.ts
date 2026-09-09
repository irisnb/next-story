import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConversationListItems,
  describeConversationStatus,
  formatConversationTime,
} from "../src/ai-panel-conversation-list.ts";
import type { ConversationSummary } from "../src/conversation-archive.ts";

/**
 * 会话列表纯显示逻辑的直接测试（change: add-conversation-persistence-and-isolation，
 * 任务 5.1）。这些测试在 `src/ai-panel-conversation-list.ts` 实现前编写，预期因
 * 缺少该模块而失败。
 *
 * 它们只断言条目格式化 / 状态映射 / 列表投影这些纯函数，不断言 DOM 或 CSS。
 */

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

test("formatConversationTime shows only hours:minutes for an entry created today", () => {
  const now = new Date();
  const label = formatConversationTime(now.toISOString());
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  assert.equal(label, `${hours}:${minutes}`);
});

test("formatConversationTime shows month-day plus time for an earlier date", () => {
  assert.equal(formatConversationTime(new Date(2000, 0, 2, 8, 5).toISOString()), "01-02 08:05");
});

test("formatConversationTime is empty for invalid or missing time", () => {
  assert.equal(formatConversationTime(""), "");
  assert.equal(formatConversationTime(null), "");
  assert.equal(formatConversationTime(undefined), "");
  assert.equal(formatConversationTime("not-a-date"), "");
});

test("describeConversationStatus maps each terminal state to a Chinese label and tone", () => {
  assert.deepEqual(describeConversationStatus("done"), { label: "完成", tone: "success" });
  assert.deepEqual(describeConversationStatus("failed"), { label: "失败", tone: "danger" });
  assert.deepEqual(describeConversationStatus("cancelled"), { label: "中断", tone: "warning" });
  assert.deepEqual(describeConversationStatus("pending"), { label: "进行中", tone: "primary" });
  assert.deepEqual(describeConversationStatus("interrupted"), { label: "中断", tone: "warning" });
});

test("describeConversationStatus tolerates a null runtime last_status", () => {
  assert.deepEqual(describeConversationStatus(null), { label: "状态未知", tone: "muted" });
  assert.deepEqual(describeConversationStatus(undefined), { label: "状态未知", tone: "muted" });
});

test("buildConversationListItems projects summaries into list items and flags the active one", () => {
  const items = buildConversationListItems(
    [
      summary({ conversation_id: "a", title: "标题A", focus_document_title: "草稿" }),
      summary({
        conversation_id: "b",
        title: "标题B",
        last_status: "pending",
        turns: [
          { role: "assistant", text: "首答", status: "done" },
          { role: "user", text: "未完成追问", status: "done" },
          { role: "assistant", text: "", status: "cancelled" },
        ],
      }),
    ],
    "b",
  );

  assert.equal(items.length, 2);
  assert.equal(items[0].conversationId, "a");
  assert.equal(items[0].title, "标题A");
  assert.equal(items[0].status.label, "完成");
  assert.equal(items[0].status.tone, "success");
  assert.equal(items[0].isActive, false);
  assert.equal(items[0].focusDocumentTitle, "草稿");

  assert.equal(items[1].conversationId, "b");
  assert.equal(items[1].status.label, "中断");
  assert.equal(items[1].status.tone, "warning");
  assert.equal(items[1].isActive, true);
  assert.equal(items[1].focusDocumentTitle, null);
});
