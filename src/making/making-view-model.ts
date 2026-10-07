import type {
  Chain,
  ChainLibrary,
  ChainVersion,
  RequirementCard,
} from "../project-api.ts";

/**
 * 制作模块的纯显示决策边界（add-making-module-core 任务组 7）。
 *
 * 只把链路库数据映射成结构化的显示决策（状态条文字、库列表行、检视标题、
 * 启用/回退的具体承接文字、卡片检视五项、本版变化说明）。不接触 DOM、
 * 命令与网络；「三态分离」的措辞红线在此集中落地：
 * - 状态条＝下一轮用什么；
 * - 检视标题＝正在看什么（未启用版本必须明示「尚未启用」，禁用
 *   「生效／成功／正在执行」类视觉与措辞）；
 * - 制作对话标题＝正在制作什么（由控制器单独承载）。
 */

/** 结构检视的免责说明句（design D7；不暗示 AI 内部思考过程）。 */
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
 * 固定底座四项只读说明（所有链路共用、不可修改；措辞朴实自拟，各一句）。
 * 只读呈现，无修改或开关控件。
 */
export const MAKING_BASE_ITEMS: readonly {
  readonly key: string;
  readonly title: string;
  readonly description: string;
}[] = [
  { key: "redline", title: "红线", description: "AI 不改写你的文档；回复只是临时材料，判断权始终在你手里。" },
  { key: "stance", title: "骨（底线立场）", description: "AI 只提观察、问题与可能性，不替你判断创意高低，不把假设当成事实。" },
  { key: "tools", title: "工具", description: "阅读、检索等公共能力对所有链路一样可用，不按链路分档。" },
  { key: "materials", title: "材料规则", description: "AI 只按你授权的范围读取作品材料；链路不改变任何读取授权。" },
];

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

/** 结构检视单张卡的列表行（卡名／版本／适用摘要；版本即所属链路版本）。 */
export interface MakingCardItemView {
  readonly cardId: string;
  readonly title: string;
  readonly summary: string;
}

/** 结构检视（正在看什么）的显示决策。 */
export interface MakingInspectorView {
  readonly chainId: string;
  readonly chainName: string;
  readonly versionId: string;
  readonly versionIndex: number;
  /** 检视标题：正在查看「名·第N版」。 */
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
  readonly cards: readonly MakingCardItemView[];
  readonly changeNote: string;
  readonly disclaimer: string;
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
 * 结构检视的显示决策。措辞红线：查看未启用版本时明示「尚未启用」，
 * 启用文字落在链路版本层级（卡片上无启用开关），并写明作用对象与生效范围。
 */
export function buildMakingInspectorView(
  library: ChainLibrary,
  chainId: string,
  versionId: string,
): MakingInspectorView | null {
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
  // 三态分离（状态条／标题／制作对话标题）各在各位。
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
    cards: version.cards.map((card) => ({
      cardId: card.id,
      title: card.title,
      summary: cardSummary(card.trigger_desc),
    })),
    changeNote: version.change_note,
    disclaimer: MAKING_DISCLAIMER,
  };
}

/** 本版变化说明：相对上一版的卡片增删标题＋变更说明（首版明示）。 */
export function describeVersionChange(
  version: ChainVersion,
  previousVersion: ChainVersion | null,
): string {
  const note = version.change_note.trim();
  const noteSuffix = note.length > 0 ? `；变更说明：${note}` : "";
  if (previousVersion === null) {
    return note.length > 0 ? `本版是第 1 个版本；变更说明：${note}。` : "本版是第 1 个版本。";
  }
  const currentTitles = new Set(version.cards.map((card) => card.title));
  const previousTitles = new Set(previousVersion.cards.map((card) => card.title));
  const added = [...currentTitles].filter((title) => !previousTitles.has(title));
  const removed = [...previousTitles].filter((title) => !currentTitles.has(title));
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

/** 构建卡片检视面板；插槽在 v0 只有要求类一种。 */
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
  return {
    cardId: card.id,
    identity: `卡名「${card.title}」 · 插槽：要求类 · 所属：${chain.name}·第${version.index}版`,
    whenToUse: card.trigger_desc,
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
