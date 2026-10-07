import type { Chain, ChainVersion } from "../project-api.ts";
import { draftToCardInput, type MakingCardDraft } from "./making-conversation.ts";

/**
 * 试问机制的纯显示与匹配决策（add-making-module-core 任务 6，车道 F2b）。
 *
 * 不接触 DOM、命令与网络，只做四件事：
 * 1. 试问编号生成（`trial-` 前缀是后端工具路由的身份判据，必须携带）；
 * 2. 草稿组与已保存版本的逐字匹配（试问只能绑定已保存的链路版本）；
 * 3. 运行状态、带卡/对照标注、记录行摘要的中文显示决策；
 * 4. 试问失败的错误码中文提示（对齐既有 `makingSendErrorNotice` 模式）。
 *
 * 措辞红线（spec `making-conversation` 试问机制）：试问不切全局链路、默认只跑
 * 带卡一版（对照是显式动作）、试问记录只读不可追问。
 */

/** 试问编号的固定前缀（后端以此识别试问身份；前端生成的 id 必须携带）。 */
export const TRIAL_ID_PREFIX = "trial-";

/** 试问记录的只读说明（详情内明示「想继续＝新试问」，不出现追问输入）。 */
export const TRIAL_RECORD_READONLY_NOTE = "试问记录只读，不能在这里继续追问；想继续问，就发起新的试问。";

/** 生成试问编号（`trial-` 前缀＋时间戳＋随机段；后端校验拒绝无前缀 id）。 */
export function generateTrialId(randomSegment: () => string = defaultRandomSegment): string {
  return `${TRIAL_ID_PREFIX}${Date.now().toString(36)}-${randomSegment()}`;
}

function defaultRandomSegment(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** 校验试问编号形状（带 `trial-` 前缀即由后端继续校验安全字符；此处只做前端自检）。 */
export function isTrialId(value: string): boolean {
  return value.startsWith(TRIAL_ID_PREFIX) && value.length > TRIAL_ID_PREFIX.length;
}

/**
 * 草稿组与链路版本的逐字匹配：保存时前端提交的正是 `draftToCardInput` 的映射，
 * 因此内容一致即证明「这版草稿已保存为该版本」（顺序敏感，逐卡比对三字段）。
 */
export function draftsMatchVersion(drafts: readonly MakingCardDraft[], version: ChainVersion): boolean {
  const inputs = drafts.map(draftToCardInput);
  if (version.cards.length !== inputs.length) return false;
  return version.cards.every((card, index) => {
    const input = inputs[index];
    return card.title === input.title && card.trigger_desc === input.trigger_desc && card.body === input.body;
  });
}

/** 找到与草稿组内容一致的最新已保存版本（从最新往回找；没有＝草稿未保存，不能试问）。 */
export function findSavedVersionForDrafts(
  chain: Chain,
  drafts: readonly MakingCardDraft[],
): ChainVersion | null {
  for (let index = chain.versions.length - 1; index >= 0; index -= 1) {
    const version = chain.versions[index];
    if (version !== undefined && draftsMatchVersion(drafts, version)) return version;
  }
  return null;
}

/** 试问运行状态（生成中／等待补读授权／已完成／失败／已停止；等待授权无时限豁免）。 */
export type TrialRunStatus = "pending" | "waiting" | "success" | "failed" | "cancelled";

/** 运行区状态行的中文标注（状态以文字为主、颜色为辅，颜色由 CSS 类承担）。 */
export function trialRunStatusLabel(status: TrialRunStatus): string {
  switch (status) {
    case "pending":
      return "生成中…";
    case "waiting":
      return "等待补读授权";
    case "success":
      return "已完成";
    case "failed":
      return "生成失败";
    case "cancelled":
      return "已停止";
  }
}

/** 运行区块的带卡/对照标注（两份证据并列展示时以此区分）。 */
export function trialRunKindLabel(withCard: boolean): string {
  return withCard ? "带卡试问" : "对照试问（不带卡）";
}

/** 记录行的带卡/对照短标注。 */
export function trialRecordTag(withCard: boolean): string {
  return withCard ? "带卡" : "对照";
}

/** 试问问题摘要（记录行显示；截断加省略号）。 */
export function trialQuestionPreview(question: string, maxLength = 24): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "（空问题）";
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}…`;
}

/** 记录行的时间标注（`YYYY-MM-DD HH:mm`；解析失败原样返回）。 */
export function trialTimeLabel(createdAt: string): string {
  if (createdAt.length >= 16 && createdAt.charAt(10) === "T") {
    return `${createdAt.slice(0, 10)} ${createdAt.slice(11, 16)}`;
  }
  return createdAt;
}

/** 记录行的反馈摘要（未填写如实显示；有内容截断）。 */
export function trialFeedbackSummary(feedback: string | null | undefined, maxLength = 16): string {
  const trimmed = (feedback ?? "").trim();
  if (trimmed.length === 0) return "未记录反馈";
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}…`;
}

/** 非成功终态记录的回复全文口径（后端对失败/取消轮不存全文，如实呈现）。 */
export function trialReplyTextOf(record: { status: string; reply_text: string }): string {
  if (record.reply_text.trim().length > 0) return record.reply_text;
  switch (record.status) {
    case "pending":
      return "（未收束：本轮尚未完成）";
    case "cancelled":
      return "（本轮已停止，未保存回复全文）";
    case "failed":
      return "（本轮失败，未保存回复全文）";
    default:
      return "（无回复全文）";
  }
}

/** 试问失败的错误码中文提示（语义对齐日常/制作，文案按试问语境改写）。 */
export function trialSendErrorNotice(code: string, message: string): string {
  if (code === "conversation_busy") return "这个试问还在进行中，请等它完成或先停止。";
  if (code === "capacity_exceeded") return "正在生成的回复已到同时上限，稍等片刻再发起。";
  if (code === "configuration_required") return "缺少 LLM 配置，请先到设置中填写并保存。";
  return message.length > 0 ? message : "本次试问未能完成，请重试。";
}
