import type { ConversationSummary } from "./conversation-archive.ts";

/**
 * 会话列表的纯显示逻辑（OpenSpec change: add-multi-window-and-fast-lane，第 9 组）。
 *
 * 该模块只把讨论摘要（`ConversationSummary`）投影成列表显示数据：按最后活动时间
 * 分组（置顶 / 今天 / 昨天 / 本周 / 上周 / 本月 / 上月 / 更早）、相对时间、统一状态词
 * 与当前讨论标记。不接触 DOM、CSS 或网络。
 */

/** 终态着色分组（沿用设计令牌语义色）。 */
export type ConversationStatusTone = "muted" | "primary" | "success" | "danger" | "warning";

export interface ConversationStatusView {
  readonly label: string;
  readonly tone: ConversationStatusTone;
}

/** 列表分组键（固定顺序，每个讨论只落入第一个命中的分组）。 */
export type ConversationGroupKey =
  | "pinned"
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "earlier";

/** 列表条目的显示数据。 */
export interface ConversationListItem {
  readonly conversationId: string;
  readonly title: string;
  readonly customTitle: string | null;
  readonly pinned: boolean;
  readonly timeLabel: string;
  readonly status: ConversationStatusView;
  readonly isActive: boolean;
  readonly focusDocumentTitle: string | null;
  readonly updatedAt: string;
}

/** 「更早」分组内按自然月分节。 */
export interface MonthSection {
  readonly label: string;
  readonly items: readonly ConversationListItem[];
}

export interface ConversationGroup {
  readonly key: ConversationGroupKey;
  readonly label: string;
  readonly items: readonly ConversationListItem[];
  readonly monthSections: readonly MonthSection[];
}

/** 统一状态词映射（与窗口一致；不再出现「状态未知」）。 */
export function describeConversationStatus(
  status: string | null | undefined,
): ConversationStatusView {
  switch (status) {
    case "done":
    case "success":
      return { label: "已完成", tone: "success" };
    case "failed":
      return { label: "失败", tone: "danger" };
    case "cancelled":
    case "interrupted":
      return { label: "已停止", tone: "muted" };
    case "pending":
      return { label: "生成中", tone: "primary" };
    default:
      return { label: "已完成", tone: "muted" };
  }
}

/** 把窗口状态（`ai-window.ts` 的 `WindowStatus`）映射为列表状态词。 */
export function describeWindowStatus(status: string | null | undefined): ConversationStatusView {
  switch (status) {
    case "generating":
      return { label: "生成中", tone: "primary" };
    case "queued":
      return { label: "排队中", tone: "warning" };
    case "stopped":
      return { label: "已停止", tone: "muted" };
    case "failed":
      return { label: "失败", tone: "danger" };
    case "recovering":
      return { label: "恢复中", tone: "primary" };
    case "done":
      return { label: "已完成", tone: "success" };
    default:
      return { label: "已完成", tone: "muted" };
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 星期几中文标签（周一…周日）。 */
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 相对时间：刚刚 / N 分钟前 / 今天 HH:MM / 昨天 HH:MM / 周X / 上周X / M月D日 / YYYY年M月D日。 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    // 未来时间（时钟偏差容错）：按今天处理。
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (diffMs < 60_000) return "刚刚";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;

  const todayStart = startOfDay(now);
  const dateStart = startOfDay(date);
  const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / 86_400_000);
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return `昨天 ${hm}`;
  if (dayDiff < 7) return WEEKDAY_LABELS[date.getDay()];
  if (dayDiff < 14) return `上周${WEEKDAY_LABELS[date.getDay()]}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 讨论按最后活动时间落入的分组（置顶除外）。 */
export function conversationGroupKey(iso: string | null | undefined, now: Date = new Date()): ConversationGroupKey {
  if (!iso) return "earlier";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "earlier";

  const todayStart = startOfDay(now);
  const dateStart = startOfDay(date);
  const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / 86_400_000);
  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return "this_week";
  if (dayDiff < 14) return "last_week";

  // 本月：本月 1 日至今（不含以上）。
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (date >= thisMonthStart) return "this_month";
  // 上月：上一个自然月。
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (date >= lastMonthStart) return "last_month";
  return "earlier";
}

const GROUP_LABELS: Record<ConversationGroupKey, string> = {
  pinned: "置顶",
  today: "今天",
  yesterday: "昨天",
  this_week: "本周",
  last_week: "上周",
  this_month: "本月",
  last_month: "上月",
  earlier: "更早",
};

const GROUP_ORDER: readonly ConversationGroupKey[] = [
  "pinned",
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "earlier",
];

function monthLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "更早";
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

/** 讨论标题：自定义标题优先（空白视为未重命名），否则回退到列表派生标题。 */
export function effectiveTitle(summary: ConversationSummary): string {
  const custom = summary.custom_title;
  if (custom && custom.trim()) return custom;
  return summary.title;
}
/**
 * 把当前作品的讨论摘要投影为分组后的列表数据：
 * 置顶独立区在最前（默认展开），其余按最后活动时间落入固定顺序分组，
 * 空分组不显示；「更早」内按自然月分节。`statusOf` 允许调用方按讨论的运行时
 * 请求状态覆盖状态词（打开窗口的讨论用窗口状态）。
 */
export function buildConversationGroups(
  summaries: readonly ConversationSummary[],
  activeConversationId: string | null,
  now: Date = new Date(),
  statusOf: (summary: ConversationSummary) => ConversationStatusView = (summary) =>
    describeConversationStatus(summary.last_status),
): ConversationGroup[] {
  const items: ConversationListItem[] = summaries.map((summary) => ({
    conversationId: summary.conversation_id,
    title: effectiveTitle(summary),
    customTitle: summary.custom_title ?? null,
    pinned: summary.pinned ?? false,
    timeLabel: formatRelativeTime(summary.updated_at, now),
    status: statusOf(summary),
    isActive: summary.conversation_id === activeConversationId,
    focusDocumentTitle: summary.focus_document_title ?? null,
    updatedAt: summary.updated_at,
  }));

  // 排序：置顶在前（按更新倒序），其余按更新倒序。
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const groups: ConversationGroup[] = [];
  for (const key of GROUP_ORDER) {
    const groupItems = items.filter((item) => {
      if (key === "pinned") return item.pinned;
      if (item.pinned) return false;
      return conversationGroupKey(item.updatedAt, now) === key;
    });
    if (groupItems.length === 0) continue;

    const monthSections: MonthSection[] = [];
    if (key === "earlier") {
      const byMonth = new Map<string, ConversationListItem[]>();
      for (const item of groupItems) {
        const label = monthLabel(item.updatedAt);
        const list = byMonth.get(label) ?? [];
        list.push(item);
        byMonth.set(label, list);
      }
      for (const [label, monthItems] of byMonth) {
        monthSections.push({ label, items: monthItems });
      }
    }

    groups.push({
      key,
      label: GROUP_LABELS[key],
      items: groupItems,
      monthSections,
    });
  }
  return groups;
}
