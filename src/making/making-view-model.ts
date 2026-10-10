import type {
  CardSlotType,
  Chain,
  ChainLibrary,
  ChainVersion,
  RequirementCard,
} from "../project-api.ts";

/**
 * 制作模块的纯显示决策边界（add-chain-mindmap-v0 导图重构）。
 *
 * 只把链路库数据映射成结构化的显示决策（状态条文字、库列表行、导图三区、
 三态标题、启用/回退的具体承接文字、统一详情 DetailModel、本版变化说明）。
 * 不接触 DOM、命令与网络；语义红线在此集中落地：
 * - 状态条＝下一轮用什么；
 * - 导图标题＝正在看什么（未启用版本必须明示「尚未启用」，禁用
 *   「生效／成功／正在执行」类视觉与措辞）；
 * - 制作对话标题＝正在制作什么（由控制器单独承载）；
 * - 箭头只表达「分区→组装」「组装→输出」，卡片之间永不生成连线；
 * - 用户可见来源名称为「自定义提示词」「公用基础提示词」「本次问题与材料」。
 */

/** 导图免责说明句（不暗示 AI 内部思考过程；呈现于阅读说明条）。 */
export const MAKING_DISCLAIMER =
  "展示链路的组装结构与适用条件，不代表 AI 内部思考过程。";

/** 状态条的生效时机说明（启用与停用共用同一句）。 */
export const MAKING_STATUS_TIMING_NOTE =
  "从下一轮开始使用；正在生成的回复沿用发起时的版本";

/** 未启用链路时的状态条文案。 */
export const MAKING_STATUS_IDLE_TEXT = "当前未启用链路，使用日常陪想";

/** 未启用版本的状态标注（明示，不用启用色视觉）。 */
export const MAKING_STATE_NOT_ACTIVE = "尚未启用";

/** 当前查看版本即启用版本时的状态标注。 */
export const MAKING_STATE_ACTIVE = "当前启用版本";

/**
 * 阅读说明条三句（图区容器之外贴底固定呈现；不参与图区垂直居中计算）。
 * 免责句不暗示 AI 内部思考过程；箭头句与启用句防止「排列＝执行顺序」「卡片级启用」
 * 两类误读。
 */
export const MAKING_READING_NOTES: readonly string[] = [
  "箭头只表示流向组装，不表示卡片执行顺序",
  "启用对象是整个链路版本",
  "展示链路的组装结构与适用条件，不代表 AI 内部思考过程。",
];

/**
 * 固定底座四项只读说明（所有链路共用、不可修改；措辞朴实自拟，各一句）。
 * 只读呈现，无修改或开关控件。
 */
export const MAKING_BASE_ITEMS: readonly {
  readonly key: string;
  readonly title: string;
  readonly description: string;
}[] = [
  { key: "redline", title: "红线", description: "AI 不改写你的文档；回复只是临时材料，判断权始终在你手里。" },
  { key: "stance", title: "基本立场", description: "AI 只提观察、问题与可能性，不替你判断创意高低，不把假设当成事实。" },
  { key: "tools", title: "工具", description: "阅读、检索等公共能力对所有链路一样可用，不按链路分档。" },
  { key: "materials", title: "材料规则", description: "AI 只按你授权的范围读取作品材料；链路不改变任何读取授权。" },
];

/**
 * 每轮动态的只读说明项（自动加入；不是可配置的链路要求）。
 * 只读呈现，无任何配置控件。
 */
export const MAKING_DYNAMIC_ITEMS: readonly {
  readonly key: string;
  readonly title: string;
  readonly description: string;
}[] = [
  { key: "question", title: "你的问题", description: "来自本轮提问。" },
  { key: "materials", title: "参考材料", description: "按既有取材、可见性与授权规则准备，自动加入不等于任意读取作品。" },
  { key: "entry", title: "提问方式", description: "说明本轮从直接提问还是选区召唤发起。" },
];

/** 每轮动态详情的尾注（明示「自动」语义，不给配置暗示）。 */
export const MAKING_DYNAMIC_NOTE = "这些随每轮现场变化，由系统自动加入，不是可配置的链路要求。";

/** 卡片详情底部「修改／删除／添加」三操作的按钮文字（统一转制作对话执行）。 */
export const MAKING_DETAIL_ACTION_LABELS: readonly {
  readonly action: "modify" | "delete" | "add";
  readonly label: string;
}[] = [
  { action: "modify", label: "请制作助手修改" },
  { action: "delete", label: "删除卡片" },
  { action: "add", label: "请制作助手添加回应要求" },
];

/** 「添加」操作的目标类型必须明确（add-posture-slot 任务 4.2）：姿态类专用文案。 */
export const MAKING_ADD_POSTURE_CARD_LABEL = "请制作助手添加回应风格";

/**
 * 姿态卡「何时用」的固定说明（add-posture-slot D3）：触发描述仅供选择参考，
 * 不承担自动切换——如实写明，防「其他问题会自动关姿态」的误解。
 */
export const MAKING_POSTURE_WHEN_TO_USE_NOTE = "供你判断何时选择此姿态，不会据此自动切换";

/** 卡的显示类型（缺省＝要求卡；存量 v1 数据无类型字段，行为与本变更前一致）。 */
export function slotTypeOf(card: RequirementCard): CardSlotType {
  return card.slot_type === "posture" ? "posture" : "requirement";
}

/** 插槽显示名：回应要求／回应风格（仅显示映射，底层类型不改）。 */
export function slotTypeLabel(slotType: CardSlotType): string {
  return slotType === "posture" ? "回应风格" : "回应要求";
}

/** 顶部状态条的显示决策（数据源＝链路库 active 指针，非当前检视对象）。 */
export type MakingStatusView =
  | { readonly kind: "active"; readonly label: string; readonly timingNote: string }
  | { readonly kind: "idle"; readonly label: string }
  | { readonly kind: "error"; readonly label: string };

/** 解析链路库中 active 指针指向的链路与版本；悬空指针防御性视为未启用。 */
export function resolveActive(
  library: ChainLibrary,
): { readonly chain: Chain; readonly version: ChainVersion } | null {
  const active = library.active;
  if (!active) return null;
  const chain = library.chains.find((candidate) => candidate.id === active.chain_id);
  if (!chain) return null;
  const version = chain.versions.find((candidate) => candidate.id === active.version_id);
  if (!version) return null;
  return { chain, version };
}

/** 状态条文字：启用→「当前链路：名·第N版」；未启用→日常陪想提示；读库失败→错误。 */
export function buildMakingStatusView(
  library: ChainLibrary | null,
  loadError: string | null,
): MakingStatusView {
  if (loadError !== null) {
    return { kind: "error", label: `链路库读取失败：${loadError}` };
  }
  if (library === null) {
    return { kind: "idle", label: MAKING_STATUS_IDLE_TEXT };
  }
  const resolved = resolveActive(library);
  if (resolved === null) {
    return { kind: "idle", label: MAKING_STATUS_IDLE_TEXT };
  }
  return {
    kind: "active",
    label: `当前链路：${resolved.chain.name}·第${resolved.version.index}版`,
    timingNote: MAKING_STATUS_TIMING_NOTE,
  };
}

/** 链路库单行显示决策（名称／当前启用版本／有无新草稿）。 */
export interface ChainLibraryRowView {
  readonly chainId: string;
  readonly name: string;
  /** 该链路是否为全局当前启用链路。 */
  readonly isActiveChain: boolean;
  /** 当前启用版本序号（非启用链路为 null）。 */
  readonly activeVersionIndex: number | null;
  /** 最新版本序号（尚无版本时为 null）。 */
  readonly latestVersionIndex: number | null;
  /** 有新草稿：最新版本序号＞启用版本序号。 */
  readonly hasNewerDraft: boolean;
  /** 新草稿提示序号（无新草稿为 null）。 */
  readonly newerDraftIndex: number | null;
  /** 行状态一行字（如「当前启用 第3版」「未启用」）。 */
  readonly statusLabel: string;
}

/** 链路库列表的显示决策：浏览行只描述状态，不含任何切换动作。 */
export function buildChainLibraryRows(library: ChainLibrary): ChainLibraryRowView[] {
  const resolvedActive = resolveActive(library);
  return library.chains.map((chain) => {
    const isActiveChain = resolvedActive?.chain.id === chain.id;
    const activeVersionIndex = isActiveChain ? resolvedActive!.version.index : null;
    const latestVersionIndex = chain.versions.length > 0
      ? chain.versions[chain.versions.length - 1].index
      : null;
    const hasNewerDraft =
      isActiveChain &&
      latestVersionIndex !== null &&
      activeVersionIndex !== null &&
      latestVersionIndex > activeVersionIndex;
    const statusLabel = isActiveChain && activeVersionIndex !== null
      ? `当前启用 第${activeVersionIndex}版`
      : "未启用";
    return {
      chainId: chain.id,
      name: chain.name,
      isActiveChain,
      activeVersionIndex,
      latestVersionIndex,
      hasNewerDraft,
      newerDraftIndex: hasNewerDraft ? latestVersionIndex : null,
      statusLabel,
    };
  });
}

/** 适用摘要：触发描述首行（截断到 40 字，截断加省略号；不拼接负例行）。 */
export function cardSummary(triggerDesc: string, maxLength = 40): string {
  const firstLine = triggerDesc.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength)}…`;
}

/** 导图卡片行（紧凑卡行：卡名＋「详情」提示；不出现摘要与版本号）。 */
export interface MakingMapCardRow {
  readonly cardId: string;
  readonly title: string;
}

/** 导图连线（仅「分区→组装」「组装→输出」两类流线；卡片之间永不生成连线）。 */
export interface MakingWireView {
  /** SVG 路径（viewBox 840×440，几何与三区/组装/输出的定位一一对应）。 */
  readonly d: string;
}

/**
 * 导图连线数据（v10 定稿几何）：三区右缘（x=370）汇入组装左缘（x=490，中心 y=220），
 * 组装右缘（x=588）指向输出左缘（x=673）。箭头语义由这份固定数据保证——
 * 只有这四条流线带 marker-end，任何卡片节点都不产出连线。
 */
const MAP_WIRE_PATHS: readonly string[] = [
  "M370 128 H376 Q382 128 382 142 V206 Q382 220 398 220 H490", // 自定义要求 → 组装
  "M370 298 C410 298 435 220 490 220", // 固定底座 → 组装
  "M370 388 C430 388 420 220 490 220", // 每轮动态 → 组装
  "M588 220 H673", // 组装 → 提示词（输出）
];

/** 导图视图（正在看什么）的显示决策：三区同构＋组装流＋输出象征块。 */
export interface MakingMapView {
  readonly chainId: string;
  readonly chainName: string;
  readonly versionId: string;
  readonly versionIndex: number;
  /** 导图标题：正在查看「名·第N版」（草稿／历史版本加后缀）。 */
  readonly title: string;
  /** 版本状态标注：「当前启用版本」或「尚未启用」。 */
  readonly stateLabel: string;
  /** 是否当前启用版本（控制启用入口显隐）。 */
  readonly isActiveVersion: boolean;
  /** 是否回退场景（同一链路内查看早于启用版本的版本）。 */
  readonly isRollback: boolean;
  /** 启用按钮文字（查看版本即启用版本时为 null，无入口）。 */
  readonly enableLabel: string | null;
  /** 启用确认文字（具体承接：写明替换对象与生效范围）。 */
  readonly enableConfirm: string | null;
  /** 回退确认文字（呈现目标版本与「较新版本及试问证据保留」）。 */
  readonly rollbackConfirm: string | null;
  /** 版本记录下拉项（全部版本，倒序＝最新在前）。 */
  readonly versionOptions: readonly { readonly versionId: string; readonly label: string }[];
  /** 自定义要求区（用户可改的零件分区；原内部名「链路可变区」退役）。 */
  readonly customZone: {
    readonly heading: "自定义提示词";
    readonly affordanceLabel: "可改 · 可加";
    /** 说明性副标（add-posture-slot D7）：不构成该分区的第二名称。 */
    readonly subtitle: "规定回应的方向与说话方式";
    /** 要求类插槽组（现行；可多张）。 */
    readonly requirementGroup: {
      readonly slotTitle: "回应要求";
      readonly cardCountLabel: string;
      readonly cards: readonly MakingMapCardRow[];
      readonly emptyNote: string;
    };
    /** 姿态类插槽组（add-posture-slot；2026-10-07 修订：每版本可多张，排在要求组下方）。 */
    readonly postureGroup: {
      readonly slotTitle: "回应风格";
      readonly cardCountLabel: string;
      /** 姿态卡卡行（多张并列呈现；无姿态卡时为空数组）。 */
      readonly cards: readonly MakingMapCardRow[];
    };
  };
  /** 固定底座区（所有链路共用·只读；任何链路、任何版本、任何状态完全一致）。 */
  readonly baseZone: {
    readonly heading: "公用基础提示词";
    readonly suffix: "共用 · 只读";
    readonly items: readonly string[];
  };
  /** 每轮动态区（自动；无 hover 可点态）。 */
  readonly dynamicZone: {
    readonly heading: "本次问题与材料";
    readonly suffix: "自动";
    readonly items: readonly string[];
  };
  readonly assemblyLabel: "组装";
  readonly outputLabel: "完整提示词";
  readonly outputSublabel: "发给 AI 的说明";
  /** 连线数据（固定四条流线；见 MAP_WIRE_PATHS）。 */
  readonly wires: readonly MakingWireView[];
}

/** 查看版本相对启用版本的差集（启用同一链路更早版本＝回退场景）。 */
function rollbackContext(
  library: ChainLibrary,
  chainId: string,
  versionIndex: number,
): { readonly activeIndex: number } | null {
  const resolved = resolveActive(library);
  if (resolved === null || resolved.chain.id !== chainId) return null;
  if (versionIndex >= resolved.version.index) return null;
  return { activeIndex: resolved.version.index };
}

/**
 * 导图视图的显示决策。措辞红线：查看未启用版本时明示「尚未启用」，
 * 启用文字落在链路版本层级（卡片上无启用开关），并写明作用对象与生效范围。
 */
export function buildMakingMapView(
  library: ChainLibrary,
  chainId: string,
  versionId: string,
): MakingMapView | null {
  const chain = library.chains.find((candidate) => candidate.id === chainId);
  if (!chain) return null;
  const version = chain.versions.find((candidate) => candidate.id === versionId);
  if (!version) return null;

  const resolvedActive = resolveActive(library);
  const isActiveVersion =
    resolvedActive !== null &&
    resolvedActive.chain.id === chainId &&
    resolvedActive.version.id === versionId;
  const rollback = rollbackContext(library, chainId, version.index);
  // 标题的版本标注：活跃链路内更新于启用版本的＝草稿、更早的＝历史版本；
  // 三态分离（状态条／导图标题／制作对话标题）各在各位。
  const titleSuffix =
    resolvedActive !== null && resolvedActive.chain.id === chainId && !isActiveVersion
      ? version.index > resolvedActive.version.index ? "（草稿）" : "（历史版本）"
      : "";

  let enableLabel: string | null = null;
  let enableConfirm: string | null = null;
  let rollbackConfirm: string | null = null;
  if (!isActiveVersion && rollback === null) {
    enableLabel = `启用「${chain.name}·第${version.index}版」`;
    enableConfirm = resolvedActive !== null
      ? `启用「${chain.name}·第${version.index}版」，替换当前「${resolvedActive.chain.name}·第${resolvedActive.version.index}版」；所有作品的下一轮提问开始使用。`
      : `启用「${chain.name}·第${version.index}版」；所有作品的下一轮提问开始使用。`;
  } else if (rollback !== null) {
    enableLabel = `回退到「${chain.name}·第${version.index}版」`;
    rollbackConfirm =
      `回退到「${chain.name}·第${version.index}版」，替换当前第${rollback.activeIndex}版；较新版本及试问证据保留，所有作品的下一轮提问开始使用回退后的版本。`;
  }

  const requirementCards = version.cards.filter((card) => slotTypeOf(card) === "requirement");
  const postureCards = version.cards.filter((card) => slotTypeOf(card) === "posture");
  return {
    chainId,
    chainName: chain.name,
    versionId,
    versionIndex: version.index,
    title: `正在查看：${chain.name}·第${version.index}版${titleSuffix}`,
    stateLabel: isActiveVersion ? MAKING_STATE_ACTIVE : MAKING_STATE_NOT_ACTIVE,
    isActiveVersion,
    isRollback: rollback !== null,
    enableLabel,
    enableConfirm,
    rollbackConfirm,
    versionOptions: [...chain.versions]
      .sort((a, b) => b.index - a.index)
      .map((candidate) => ({
        versionId: candidate.id,
        label: candidate.index === (chain.versions[chain.versions.length - 1]?.index ?? 0)
          ? `第${candidate.index}版（最新）`
          : `第${candidate.index}版`,
      })),
    customZone: {
      heading: "自定义提示词",
      affordanceLabel: "可改 · 可加",
      subtitle: "规定回应的方向与说话方式",
      requirementGroup: {
        slotTitle: "回应要求",
        cardCountLabel: `· ${requirementCards.length} 张卡`,
        cards: requirementCards.map((card) => ({ cardId: card.id, title: card.title })),
        // 空态说明限定要求类（纯姿态版本允许：姿态组有卡时这里的「还没有」只指要求卡）。
        emptyNote: "这个版本还没有回应要求。可以在制作对话里口述要求，让助手起草。",
      },
      postureGroup: {
        slotTitle: "回应风格",
        cardCountLabel: `· ${postureCards.length} 张卡`,
        cards: postureCards.map((card) => ({ cardId: card.id, title: card.title })),
      },
    },
    baseZone: {
      heading: "公用基础提示词",
      suffix: "共用 · 只读",
      items: MAKING_BASE_ITEMS.map((item) => item.title),
    },
    dynamicZone: {
      heading: "本次问题与材料",
      suffix: "自动",
      items: MAKING_DYNAMIC_ITEMS.map((item) => item.title),
    },
    assemblyLabel: "组装",
    outputLabel: "完整提示词",
    outputSublabel: "发给 AI 的说明",
    wires: MAP_WIRE_PATHS.map((d) => ({ d })),
  };
}

// ========== 统一详情（DetailModel：三类可点对象＋区级入口共用同一模型） ==========

/** 详情来源：卡片／自定义要求区／固定底座／每轮动态／添加说明（要求类／姿态类）。 */
export type MakingDetailSource =
  | { readonly kind: "card"; readonly cardId: string }
  | { readonly kind: "custom-zone" }
  | { readonly kind: "base" }
  | { readonly kind: "dynamic" }
  | { readonly kind: "add-card" }
  | { readonly kind: "add-posture-card" };

/** 详情底部的「修改／删除／添加」操作（统一转制作对话执行；导图不直接编辑）。 */
export interface MakingDetailActionView {
  readonly action: "modify" | "delete" | "add";
  readonly label: string;
  /** 操作目标卡名（「添加」落在插槽层，为 null）。 */
  readonly cardTitle: string | null;
}

/** 统一详情模型：快捷小窗与全页详情是同一模型的两种呈现，仅内容与可操作性不同。 */
export interface MakingDetailModel {
  readonly kind: MakingDetailSource["kind"];
  /** 快捷小窗标题（全页详情的 eyebrow 由 kindLabel＋对象名组成）。 */
  readonly title: string;
  /** 快捷小窗 meta 行（卡片：插槽·链路·版本·启用状态）。 */
  readonly quickMeta: string | null;
  /** 快捷小窗摘要段。 */
  readonly quickSummary: string | null;
  /** 快捷小窗辅助说明行（小号弱化）。 */
  readonly quickHelp: string | null;
  /** 快捷小窗尾段指引（自定义要求／添加说明用）。 */
  readonly quickNote: string | null;
  /** 是否有「打开完整详情」入口（输出块无详情；区级添加说明无全页形态）。 */
  readonly hasFullDetail: boolean;
  /** 全页详情 eyebrow（如「要求类 / 反差与反转」；无全页形态时为 null）。 */
  readonly eyebrow: string | null;
  /** 卡片五项（身份／何时用／怎么做完整正文／本版变化／试问记录）。 */
  readonly card: CardPanelView | null;
  /** 只读说明项（固定底座／每轮动态）。 */
  readonly readonlyItems: readonly { readonly title: string; readonly description: string }[] | null;
  /** 只读尾注（每轮动态：「自动」语义说明）。 */
  readonly readonlyNote: string | null;
  /** 底部操作（卡片＝修改／删除／添加；自定义要求与添加说明＝仅添加；只读来源为 null）。 */
  readonly actions: readonly MakingDetailActionView[] | null;
}

/** 卡片详情底部操作：要求卡＝修改／删除／添加要求卡；姿态卡＝修改／删除（「添加」明确目标类型，在组级详情与组尾入口提供）。 */
function cardActions(cardTitle: string, slotType: CardSlotType): readonly MakingDetailActionView[] {
  const labels = slotType === "posture"
    ? MAKING_DETAIL_ACTION_LABELS.filter(({ action }) => action !== "add")
    : MAKING_DETAIL_ACTION_LABELS;
  return labels.map(({ action, label }) => ({
    action,
    label,
    cardTitle: action === "add" ? null : cardTitle,
  }));
}

const ADD_CARD_ACTION: readonly MakingDetailActionView[] = [
  { action: "add", label: MAKING_DETAIL_ACTION_LABELS[2].label, cardTitle: null },
];

const ADD_POSTURE_CARD_ACTION: readonly MakingDetailActionView[] = [
  { action: "add", label: MAKING_ADD_POSTURE_CARD_LABEL, cardTitle: null },
];

/** 触发描述按行拆解：首行＝摘要，剩余行＝辅助说明（无则 null）。 */
function splitTriggerLines(triggerDesc: string): { summary: string; help: string | null } {
  const lines = triggerDesc.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  return {
    summary: lines[0] ?? "",
    help: lines.length > 1 ? lines.slice(1).join("；") : null,
  };
}

/**
 * 统一详情的显示决策。三类可点对象（卡／底座／每轮动态）与区级入口
 * （自定义要求、添加说明）产出同一模型；位置与尺寸统一由挂载结构保证，
 * 不随所点对象及其位置变化。固定底座与每轮动态只读、无任何操作控件。
 */
export function buildMakingDetail(
  library: ChainLibrary,
  chainId: string,
  versionId: string,
  source: MakingDetailSource,
): MakingDetailModel | null {
  const chain = library.chains.find((candidate) => candidate.id === chainId);
  if (!chain) return null;
  const version = chain.versions.find((candidate) => candidate.id === versionId);
  if (!version) return null;
  const resolvedActive = resolveActive(library);
  const isActiveVersion =
    resolvedActive !== null &&
    resolvedActive.chain.id === chainId &&
    resolvedActive.version.id === versionId;
  const versionMeta = isActiveVersion
    ? `${chain.name}·第${version.index}版`
    : `${chain.name}·第${version.index}版 · 尚未启用`;

  if (source.kind === "card") {
    const card = version.cards.find((candidate) => candidate.id === source.cardId);
    if (!card) return null;
    const panel = buildCardPanelView(library, chainId, versionId, card);
    if (panel === null) return null;
    const slotLabel = slotTypeLabel(slotTypeOf(card));
    const { summary, help } = splitTriggerLines(card.trigger_desc);
    return {
      kind: "card",
      title: card.title,
      quickMeta: `摘要 · ${slotLabel} · ${versionMeta}`,
      quickSummary: summary.length > 0 ? summary : null,
      quickHelp: help,
      // 姿态卡：快捷小窗同样如实附「仅供选择参考」的固定说明。
      quickNote: slotTypeOf(card) === "posture" ? MAKING_POSTURE_WHEN_TO_USE_NOTE : null,
      hasFullDetail: true,
      eyebrow: `${slotLabel} / ${card.title}`,
      card: panel,
      readonlyItems: null,
      readonlyNote: null,
      actions: cardActions(card.title, slotTypeOf(card)),
    };
  }

  if (source.kind === "custom-zone") {
    const requirementCards = version.cards.filter((card) => slotTypeOf(card) === "requirement");
    const postureCards = version.cards.filter((card) => slotTypeOf(card) === "posture");
    return {
      kind: "custom-zone",
      title: "自定义提示词 · 可改 · 可加",
      quickMeta: `回应要求 · ${requirementCards.length} 张卡；回应风格 · ${postureCards.length} 张卡`,
      quickSummary: version.cards.length > 0
        ? `${[...requirementCards, ...postureCards].map((card) => card.title).join("、")}。`
        : "这个版本还没有卡片。",
      quickHelp: null,
      quickNote: "通过制作对话调整卡片或添加回应要求／回应风格。选择具体卡片后查看它的完整详情。",
      hasFullDetail: false,
      eyebrow: null,
      card: null,
      readonlyItems: null,
      readonlyNote: null,
      // 「添加」明确目标类型且恒提供两类（2026-10-07 修订：姿态卡每版本可多张，有卡时可继续追加）。
      actions: [...ADD_CARD_ACTION, ...ADD_POSTURE_CARD_ACTION],
    };
  }

  if (source.kind === "base") {
    return {
      kind: "base",
      title: "公用基础提示词 · 共用 · 只读",
      quickMeta: null,
      quickSummary: null,
      quickHelp: null,
      quickNote: null,
      hasFullDetail: true,
      eyebrow: "共用 · 只读 / 公用基础提示词",
      card: null,
      readonlyItems: MAKING_BASE_ITEMS.map(({ title, description }) => ({ title, description })),
      readonlyNote: null,
      actions: null,
    };
  }

  if (source.kind === "dynamic") {
    return {
      kind: "dynamic",
      title: "本次问题与材料 · 自动",
      quickMeta: null,
      quickSummary: null,
      quickHelp: null,
      quickNote: null,
      hasFullDetail: true,
      eyebrow: "自动 / 本次问题与材料",
      card: null,
      readonlyItems: MAKING_DYNAMIC_ITEMS.map(({ title, description }) => ({ title, description })),
      readonlyNote: MAKING_DYNAMIC_NOTE,
      actions: null,
    };
  }

  if (source.kind === "add-posture-card") {
    return {
      kind: "add-posture-card",
      title: "回应风格 · 添加回应风格",
      quickMeta: null,
      quickSummary: "在回应风格中加入一张卡（每版本可多张）。",
      quickHelp: "通过制作对话描述你希望 AI 以什么姿态出场；导图不直接编辑。",
      quickNote: null,
      hasFullDetail: false,
      eyebrow: null,
      card: null,
      readonlyItems: null,
      readonlyNote: null,
      actions: ADD_POSTURE_CARD_ACTION,
    };
  }

  return {
    kind: "add-card",
    title: "回应要求 · 添加回应要求",
    quickMeta: null,
    quickSummary: "在回应要求中加入一张卡。",
    quickHelp: "通过制作对话说明你希望增加什么要求；导图不直接编辑。",
    quickNote: null,
    hasFullDetail: false,
    eyebrow: null,
    card: null,
    readonlyItems: null,
    readonlyNote: null,
    actions: ADD_CARD_ACTION,
  };
}

/** 详情操作转入制作对话时的输入预填文字（带入操作与目标，等待用户说明要求）。 */
export function makingTransferPrefill(action: MakingDetailActionView): string {
  if (action.cardTitle !== null) {
    return action.action === "modify"
      ? `请制作助手修改「${action.cardTitle}」：`
      : `请制作助手删除「${action.cardTitle}」：`;
  }
  return `${action.label}：`;
}

/** 本版变化说明：相对上一版的卡片增删标题＋变更说明（首版明示）。增删按「类型＋卡名」判定——同名卡换了类型（如姿态替换）也算增删，不误报「无增删」。 */
export function describeVersionChange(
  version: ChainVersion,
  previousVersion: ChainVersion | null,
): string {
  const note = version.change_note.trim();
  const noteSuffix = note.length > 0 ? `；变更说明：${note}` : "";
  if (previousVersion === null) {
    return note.length > 0 ? `本版是第 1 个版本；变更说明：${note}。` : "本版是第 1 个版本。";
  }
  const cardKey = (card: RequirementCard): string => `${slotTypeOf(card)}|${card.title}`;
  const currentTitles = new Map(version.cards.map((card) => [cardKey(card), card.title]));
  const previousTitles = new Map(previousVersion.cards.map((card) => [cardKey(card), card.title]));
  const added = [...currentTitles.entries()].filter(([key]) => !previousTitles.has(key)).map(([, title]) => title);
  const removed = [...previousTitles.entries()].filter(([key]) => !currentTitles.has(key)).map(([, title]) => title);
  const parts: string[] = [];
  if (added.length > 0) parts.push(`新增「${added.join("」「")}」`);
  if (removed.length > 0) parts.push(`移除「${removed.join("」「")}」`);
  if (parts.length === 0) parts.push("卡片组成无增删");
  return `相对上一版：${parts.join("；")}${noteSuffix}。`;
}

/** 试问记录栏文字：无试问明示「尚无试问记录」（详情展示属后续车道）。 */
export function describeVersionTrials(version: ChainVersion): string {
  if (version.trials.length === 0) return "尚无试问记录";
  const withCard = version.trials.filter((trial) => trial.with_card).length;
  const withoutCard = version.trials.length - withCard;
  return `本版共有 ${version.trials.length} 次试问记录（带卡 ${withCard} 次、对照 ${withoutCard} 次）。`;
}

/** 卡片检视面板（五项）的显示决策；正文全文透传，不做助手概括。 */
export interface CardPanelView {
  readonly cardId: string;
  /** 身份：卡名／插槽／版本／所属链路版本。 */
  readonly identity: string;
  /** 何时用：触发描述全文（含负例）。 */
  readonly whenToUse: string;
  /** 怎么做：完整正文（空正文如实显示「（无正文）」，不伪造概括）。 */
  readonly howTo: string;
  /** 本版变化：相对上一版。 */
  readonly changeLabel: string;
  /** 试问记录。 */
  readonly trialsLabel: string;
}

/** 构建卡片检视面板；插槽按卡类型显示（要求类／姿态类）。 */
export function buildCardPanelView(
  library: ChainLibrary,
  chainId: string,
  versionId: string,
  card: RequirementCard,
): CardPanelView | null {
  const chain = library.chains.find((candidate) => candidate.id === chainId);
  if (!chain) return null;
  const versionIndex = chain.versions.findIndex((candidate) => candidate.id === versionId);
  if (versionIndex < 0) return null;
  const version = chain.versions[versionIndex];
  const previousVersion = versionIndex > 0 ? chain.versions[versionIndex - 1] : null;
  const slotType = slotTypeOf(card);
  // 姿态卡的「何时用」＝所存描述＋固定说明（触发描述仅供选择参考，不自动切换）。
  const whenToUse = slotType === "posture" && card.trigger_desc.trim().length > 0
    ? `${card.trigger_desc}\n${MAKING_POSTURE_WHEN_TO_USE_NOTE}`
    : slotType === "posture"
      ? MAKING_POSTURE_WHEN_TO_USE_NOTE
      : card.trigger_desc;
  return {
    cardId: card.id,
    identity: `卡名「${card.title}」 · 插槽：${slotTypeLabel(slotType)} · 所属：${chain.name}·第${version.index}版`,
    whenToUse,
    howTo: card.body.trim().length > 0 ? card.body : "（无正文）",
    changeLabel: describeVersionChange(version, previousVersion),
    trialsLabel: describeVersionTrials(version),
  };
}

/** 删除链路的确认文字（独立动作；写明影响范围与不可恢复）。 */
export function describeChainDeletion(chain: Chain): string {
  const versionCount = chain.versions.length;
  return (
    `删除链路「${chain.name}」？其 ${versionCount} 个版本与全部试问证据将被删除，不可恢复；` +
    "作品正文与日常讨论不受影响。"
  );
}

/** 「正在制作」标题的制作对象文字（null＝未选择）。 */
export function makingObjectLabel(chain: Chain | null): string {
  return chain?.name ?? "未选择";
}
