import type { CardInput, CardSlotType, Chain } from "../project-api.ts";
import { slotTypeOf } from "./making-view-model.ts";

/**
 * 制作对话的纯显示决策与解析边界（add-making-module-core 任务 7.5/7.6）。
 *
 * 只做三件事，不接触 DOM、命令与网络：
 * 1. 解析助手消息中的卡草稿标记块（后端信封要求助手按固定标记输出）；
 * 2. 把草稿映射为保存版本所需的 `CardInput`（触发描述＝适用/不适用两行）；
 * 3. 制作会话标题派生、轮次终态与列表行的中文显示决策。
 *
 * 措辞红线（spec `making-conversation`）：卡草稿是临时材料，保存前不产生任何
 * 链路效果；保存必须经用户确认；保存失败不得显示已保存。
 */

/** 卡草稿标记块的开始标记（后端信封要求助手逐字使用）。 */
export const CARD_DRAFT_BEGIN_MARKER = "【卡草稿开始】";

/** 卡草稿标记块的结束标记。 */
export const CARD_DRAFT_END_MARKER = "【卡草稿结束】";

/** 标记块类型行的姿态卡取值（与 Rust 模板侧钉死同步）。 */
const DRAFT_TYPE_POSTURE = "姿态卡";

/** 无标题可派生时的兜底标题。 */
export const MAKING_CONVERSATION_FALLBACK_TITLE = "制作会话";

/** 制作会话标题截断上限（对齐日常讨论列表的简洁口径）。 */
const MAKING_TITLE_LIMIT = 20;

/** 正文预览截断上限（确认对话框与草稿面板共用，避免长正文淹没界面）。 */
const BODY_PREVIEW_LIMIT = 60;

/** 一份从助手消息解析出的卡草稿（临时材料，未经用户保存不产生任何链路效果）。 */
export interface MakingCardDraft {
  /** 卡类型（标记块「类型」字段行解析；无类型行＝要求卡，兼容旧会话）。 */
  readonly slotType: CardSlotType;
  /** 卡名。 */
  readonly title: string;
  /** 何时用（触发描述正例）。 */
  readonly whenToUse: string;
  /** 何时不用（触发描述负例）。 */
  readonly whenNotToUse: string;
  /** 正文（怎么做的完整要求）。 */
  readonly body: string;
}

/** 卡类型的中文标注（草稿面板徽标与确认预览共用）。 */
export function draftSlotTypeLabel(slotType: CardSlotType): string {
  return slotType === "posture" ? DRAFT_TYPE_POSTURE : "要求卡";
}

/** 草稿面板的显示决策（一组草稿＝一次消息产出的候选版本）。 */
export interface CardDraftPanelView {
  readonly drafts: readonly MakingCardDraft[];
  /** 保存确认对话框的预览文字（含「不自动启用」承诺）。 */
  readonly saveConfirm: string;
  /** 面板边界说明（临时材料，保存前不生效）。 */
  readonly boundaryNote: string;
}

/**
 * 解析助手消息中的卡草稿标记块（一行一字段，容忍全/半角冒号；多块并存；
 * 字段行后的未识别行并入当前字段，容忍多行正文）。类型行是块内首字段行
 * （`类型：要求卡`｜`类型：姿态卡`）；无类型行＝要求卡（兼容旧会话标记块），
 * 无法识别的取值同样防御性视为要求卡，不因类型行残缺丢弃整张草稿。
 * 解析失败（缺字段/无块）返回空数组——草稿面板不显示，绝不把残缺块冒充完整草稿。
 */
export function parseCardDrafts(text: string): MakingCardDraft[] {
  const drafts: MakingCardDraft[] = [];
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  let current: {
    slotType: CardSlotType;
    title: string;
    whenToUse: string;
    whenNotToUse: string;
    body: string;
    last: "title" | "whenToUse" | "whenNotToUse" | "body" | null;
  } | null = null;

  const appendToLast = (line: string): void => {
    if (current === null || current.last === null) return;
    current[current.last] = current[current.last].length === 0 ? line : `${current[current.last]}\n${line}`;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === CARD_DRAFT_BEGIN_MARKER) {
      current = { slotType: "requirement", title: "", whenToUse: "", whenNotToUse: "", body: "", last: null };
      inBlock = true;
      continue;
    }
    if (!inBlock || current === null) continue;
    if (line === CARD_DRAFT_END_MARKER) {
      if (current.title.trim().length > 0 && current.body.trim().length > 0) {
        drafts.push({
          slotType: current.slotType,
          title: current.title.trim(),
          whenToUse: current.whenToUse.trim(),
          whenNotToUse: current.whenNotToUse.trim(),
          body: current.body.trim(),
        });
      }
      current = null;
      inBlock = false;
      continue;
    }
    const match = /^(类型|卡名|何时用|何时不用|正文)[：:](.*)$/.exec(line);
    if (match === null) {
      appendToLast(line);
      continue;
    }
    const value = match[2].trim();
    switch (match[1]) {
      // 类型是单值字段：直接落位，不接管后续未识别行的续写归属。
      case "类型":
        current.slotType = value === DRAFT_TYPE_POSTURE ? "posture" : "requirement";
        break;
      case "卡名":
        current.title = value;
        current.last = "title";
        break;
      case "何时用":
        current.whenToUse = value;
        current.last = "whenToUse";
        break;
      case "何时不用":
        current.whenNotToUse = value;
        current.last = "whenNotToUse";
        break;
      default:
        current.body = value;
        current.last = "body";
        break;
    }
  }
  // 未闭合的块（助手中途被停）：不冒充完整草稿，整块丢弃。
  return drafts;
}

/** 触发描述＝「适用/不适用」两行（无负例时只保留适用行，不虚构负例）。 */
export function draftTriggerDesc(draft: MakingCardDraft): string {
  const lines = draft.whenToUse.length > 0 ? [`适用：${draft.whenToUse}`] : [];
  if (draft.whenNotToUse.length > 0) lines.push(`不适用：${draft.whenNotToUse}`);
  return lines.join("\n");
}

/** 把草稿映射为保存版本入参（`chain_save_version` 的卡形状；类型缺省＝要求卡）。 */
export function draftToCardInput(draft: MakingCardDraft): CardInput {
  return { title: draft.title, trigger_desc: draftTriggerDesc(draft), body: draft.body, slot_type: draft.slotType };
}

/** 正文预览（截断加省略号，保留换行结构由调用方渲染）。 */
export function bodyPreview(body: string, maxLength = BODY_PREVIEW_LIMIT): string {
  if (body.length <= maxLength) return body;
  return `${body.slice(0, maxLength)}…`;
}

/** 草稿面板的显示决策；无完整草稿时返回 null（面板不显示）。 */
export function buildCardDraftPanelView(drafts: readonly MakingCardDraft[], chainName: string): CardDraftPanelView | null {
  if (drafts.length === 0) return null;
  const cardLines = drafts.map((draft) => {
    const lines = [`· 卡名「${draft.title}」（${draftSlotTypeLabel(draft.slotType)}）`];
    if (draft.whenToUse.length > 0) lines.push(`  何时用：${draft.whenToUse}`);
    if (draft.whenNotToUse.length > 0) lines.push(`  何时不用：${draft.whenNotToUse}`);
    lines.push(`  正文：${bodyPreview(draft.body)}`);
    return lines.join("\n");
  });
  return {
    drafts,
    saveConfirm:
      `把下面${drafts.length > 1 ? ` ${drafts.length} 张` : ""}卡草稿保存为「${chainName}」的新版本？\n\n` +
      `${cardLines.join("\n\n")}\n\n` +
      "保存后会作为新版本进入链路库，不会自动启用；启用需要在结构检视里显式操作。",
    boundaryNote: "卡草稿是临时材料：不保存就不进链路库，保存了也不会自动启用。",
  };
}

/** 制作会话标题：首条用户消息截断（20 字），空则兜底「制作会话」。 */
export function deriveMakingTitle(firstUserText: string): string {
  const trimmed = firstUserText.trim();
  if (trimmed.length === 0) return MAKING_CONVERSATION_FALLBACK_TITLE;
  return trimmed.length > MAKING_TITLE_LIMIT ? `${trimmed.slice(0, MAKING_TITLE_LIMIT)}…` : trimmed;
}

/** 新会话「链路现状」附言的开头标记（add-posture-slot 任务 7.6）。 */
export const CHAIN_STATUS_PREAMBLE_PREFIX = "【链路现状】";

/** 附言末尾的用途说明一句（草稿须完整重述全部卡——不知道内容时先如实说明）。 */
const CHAIN_STATUS_USAGE_NOTE = "用途说明：此清单供起草参考——并存或修改时草稿须完整重述全部卡。";

/**
 * 新制作会话的「链路现状」附言文本（add-posture-slot 任务 7.6，S9 首跑发现：
 * 新会话里制作助手不知道既有卡的全文，「并存」草稿无法完整重述）。
 *
 * - 取链路**最新版本**（versions 末位）的全部卡，逐卡列类型（缺省 slot_type＝
 *   要求卡）、卡名、触发描述与正文**全文**；空触发／空正文如实标注，不虚构；
 * - 链路无版本：如实注明「当前链路还没有版本」；
 * - 文本以「【链路现状】」开头，末尾附用途说明（供起草参考——并存或修改时
 *   草稿须完整重述全部卡）。
 */
export function buildChainStatusMessage(chain: Chain): string {
  const latest = chain.versions[chain.versions.length - 1];
  if (latest === undefined) {
    return `${CHAIN_STATUS_PREAMBLE_PREFIX}当前链路「${chain.name}」还没有版本。`;
  }
  const lines: string[] = [
    `${CHAIN_STATUS_PREAMBLE_PREFIX}链路「${chain.name}」的最新版本是第 ${latest.index} 版，共 ${latest.cards.length} 张卡。`,
  ];
  for (const card of latest.cards) {
    lines.push(
      "",
      `· ${draftSlotTypeLabel(slotTypeOf(card))}「${card.title}」`,
      `何时用：${card.trigger_desc.trim().length > 0 ? card.trigger_desc.trim() : "（未说明）"}`,
      `正文：${card.body.trim().length > 0 ? card.body.trim() : "（无正文）"}`,
    );
  }
  lines.push("", CHAIN_STATUS_USAGE_NOTE);
  return lines.join("\n");
}

/** 列表显示标题：空标题回退「制作会话」（旧档案或兜底路径）。 */
export function makingListTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : MAKING_CONVERSATION_FALLBACK_TITLE;
}

/** 制作轮次终态的中文标注（生成中/失败/已停止；成功态无标注行）。 */
export function makingTurnStatusLabel(status: "pending" | "success" | "failed" | "cancelled"): string | null {
  switch (status) {
    case "pending":
      return "生成中…";
    case "failed":
      return "生成失败";
    case "cancelled":
      return "已停止";
    default:
      return null;
  }
}

/** 生成失败错误码的中文提示（排队语义对齐日常：忙＝同会话单轮，超限＝全局上限）。 */
export function makingSendErrorNotice(code: string, message: string): string {
  if (code === "conversation_busy") return "这条制作会话正在生成，等它完成后再发送。";
  if (code === "capacity_exceeded") return "正在生成的回复已到同时上限，稍等片刻再发送。";
  if (code === "configuration_required") return "缺少 LLM 配置，请先到设置中填写并保存。";
  return message.length > 0 ? message : "本次生成未能完成，请重试。";
}

/** 列表行的更新时间标注（最近会话入口与历史列表共用）。 */
export function makingListUpdatedAtLabel(updatedAt: string): string {
  return updatedAt.length > 10 ? updatedAt.slice(0, 10) : updatedAt;
}
