import type { ConversationSummary } from "./conversation-archive.ts";

/**
 * 会话列表的纯显示逻辑（OpenSpec change: add-conversation-persistence-and-isolation，
 * 任务 5.1 / 5.2 / 5.3）。
 *
 * 该模块只把讨论摘要/终态投影成轻量的列表显示数据，不接触 DOM、CSS 或网络。
 * 它从 `ConversationSummary`（来自 `conversation-archive.ts`）和当前活动讨论身份
 * 推导出每个会话条目的标题、时间、终态标签与选中态，供 DOM 控制器消费。
 */

/** 终态的轻量着色分组（沿用设计令牌语义色，不在模块里硬编码颜色值）。 */
export type ConversationStatusTone = "muted" | "primary" | "success" | "danger" | "warning";

export interface ConversationStatusView {
  readonly label: string;
  readonly tone: ConversationStatusTone;
}

/**
 * 把 ISO 时间格式化为列表可读的简短时间：
 * - 同一天只显示时分（`HH:MM`）；
 * - 跨天显示月-日 + 时分（`MM-DD HH:MM`）；
 * - 空值或非法时间返回空串（容错，不抛错）。
 */
export function formatConversationTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes}`;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return time;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day} ${time}`;
}

/**
 * 把一个讨论终态映射为轻量中文呈现实体。
 *
 * `last_status` 运行时可能为 `null`，因此对 `null` / `undefined` / 未知值一律
 * 回退为「状态未知」的中性呈现，绝不抛错。
 */
export function describeConversationStatus(
  status: string | null | undefined,
): ConversationStatusView {
  switch (status) {
    case "done":
      return { label: "完成", tone: "success" };
    case "failed":
      return { label: "失败", tone: "danger" };
    case "cancelled":
    case "interrupted":
      return { label: "中断", tone: "warning" };
    case "pending":
      return { label: "进行中", tone: "primary" };
    default:
      return { label: "状态未知", tone: "muted" };
  }
}

/** 会话列表条目的显示数据。 */
export interface ConversationListItem {
  readonly conversationId: string;
  readonly title: string;
  readonly timeLabel: string;
  readonly status: ConversationStatusView;
  readonly isActive: boolean;
  readonly focusDocumentTitle: string | null;
}

/** 以讨论最后一轮助手轮次的终态作为权威显示终态；无法读取时回退到列表 `last_status`。 */
function lastTurnStatusOf(summary: ConversationSummary): string | null {
  const last = summary.turns[summary.turns.length - 1];
  if (last) return last.status;
  return summary.last_status ?? null;
}

/** 把当前作品的讨论摘要投影为会话列表条目；`activeConversationId` 决定哪条高亮。 */
export function buildConversationListItems(
  summaries: readonly ConversationSummary[],
  activeConversationId: string | null,
): ConversationListItem[] {
  return summaries.map((summary) => ({
    conversationId: summary.conversation_id,
    title: summary.title,
    timeLabel: formatConversationTime(summary.created_at),
    status: describeConversationStatus(lastTurnStatusOf(summary)),
    isActive: summary.conversation_id === activeConversationId,
    focusDocumentTitle: summary.focus_document_title ?? null,
  }));
}
