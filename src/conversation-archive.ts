import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import type { RoundProvenanceEntry } from "./types.ts";

/**
 * 讨论档案层（change: add-conversation-persistence-and-isolation）。
 *
 * 本模块只做三件事，不接触面板状态与 DOM：
 * 1. 生成全局唯一的 `conversation_id`（时间戳 + 随机段）；
 * 2. 声明与 Rust 车道共享的命令契约类型（讨论档案的保存 / 列表 / 删除）；
 * 3. 封装对 `conversation_list` / `conversation_save` / `conversation_delete` 的 Tauri 调用。
 *
 * 讨论档案是 AI 输出临时材料的记录，与作品正文分开存放，不是作品事实源。
 * 前端唯一落盘路径是这些受控命令；它们绝不注册为 AI 可调用工具（零写回）。
 */

/** 与 Tauri `invoke` 同形的窄类型，便于在测试中注入假实现。 */
export type ConversationInvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** 一条讨论轮次的生成终态。 */
export type ConversationTurnStatus = "pending" | "done" | "failed" | "cancelled";

/** 讨论档案中的一轮对话。 */
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  status: ConversationTurnStatus;
}

/**
 * 首轮材料来源的持久化形态。`direct_question` 的首轮问题与 `summon` 的冻结选区
 * 都归一化为 `question`（召唤为空串）+ `selection_text`（无选区为 null）。
 */
export type FirstRoundMaterial =
  | { kind: "direct_question"; question: string; selection_text: string | null }
  | { kind: "summon"; question: string; selection_text: string | null };

/**
 * 最小材料出处元数据（controlled-story-read-visibility 任务 5.1）：记录一轮讨论实际
 * 使用过的作品文档 / 选区材料来源，用于权限变化后判定受影响讨论。不保存正文副本。
 */
export interface MaterialProvenance {
  /** 来源文档身份。 */
  document_id: string;
  /**
   * 材料类型：`selection`（冻结选区）/ `snapshot`（未保存快照）/ `document`（已保存正文），
   * `revoked`（该文档的 AI 可见性在讨论使用它之后被关闭，讨论永久受限的锁存标记），
   * 以及阶段五 A 的 `focus_document`（关注文档现场）与 `search_snippet`（跨文档检索命中）。
   */
  material_type:
    | "selection"
    | "snapshot"
    | "document"
    | "revoked"
    | "focus_document"
    | "search_snippet";
  /** 材料版本身份；当前快照未携带版本时为 null。 */
  document_version: string | null;
  /** 所属轮次（首轮为 0）。 */
  turn_index: number;
  /**
   * 是否进入模型上下文：仅表示「材料已组装进被提交的请求」（想发送 / prepared / accepted），
   * 不是「已实际发送给 provider」（sent）。DSH 进程接收不等于 provider 已发送。
   */
  entered_model_context: boolean;
  /**
   * provider 发送回执（`message_sent`）：本轮观测到 provider 侧回应证据时为 true；
   * 缺省表示未确认（不是「未发送」）。只有收到回执才标记，绝不伪造。
   */
  sent_confirmed?: boolean;
  /** 仅 `search_snippet` 有值：命中的候选词。 */
  matched_term?: string;
  /** 关注文档现场材料是否来自未保存快照（仅 `focus_document` 有意义）。 */
  from_unsaved_snapshot?: boolean;
  /** 本轮跨文档检索结果状态（挂在 `focus_document` 条目上）。 */
  search_status?: string;
  /** 本轮检索是否达到输出硬上限（本次检索受限，非全量检索）。 */
  search_limited?: boolean;
}

/**
 * 把后端返回的一轮自动取材出处转换为档案形态：补充所属轮次与「已进入模型上下文」
 * 标记（后端只负责产出文档身份 / 类型 / 版本 / 匹配词，轮次与发送状态由前端补全）。
 * `sentConfirmed` 仅在收到 `message_sent` 回执时为 true；缺省（false）表示未确认，
 * 不写入 `sent_confirmed` 字段（未确认轮次不携带回执标记）。
 */
export function roundProvenanceToMaterialProvenance(
  entries: RoundProvenanceEntry[] | undefined,
  turnIndex: number,
  sentConfirmed = false,
): MaterialProvenance[] {
  if (!entries) return [];
  return entries.map((entry) => ({
    document_id: entry.document_id,
    material_type: entry.material_type as MaterialProvenance["material_type"],
    document_version: entry.version,
    turn_index: turnIndex,
    entered_model_context: true,
    ...(sentConfirmed ? { sent_confirmed: true } : {}),
    ...(entry.matched_term !== undefined ? { matched_term: entry.matched_term } : {}),
    ...(entry.from_unsaved_snapshot ? { from_unsaved_snapshot: true } : {}),
    ...(entry.search_status !== undefined ? { search_status: entry.search_status } : {}),
    ...(entry.search_limited !== undefined ? { search_limited: entry.search_limited } : {}),
  }));
}

/** 讨论档案的保存契约（version 1）。 */
export interface ConversationRecord {
  version: 1;
  conversation_id: string;
  created_at: string;
  updated_at: string;
  focus_document_id: string | null;
  focus_document_title: string | null;
  first_round_material: FirstRoundMaterial;
  turns: ConversationTurn[];
  /** 可选自定义标题；缺失/空白表示未重命名。 */
  title?: string;
  /** 置顶标记；缺失表示未置顶。 */
  pinned?: boolean;
  /**
   * 材料出处元数据。缺失（旧档案）按保守策略处理：可查看但不可自动重放；
   * 空数组表示新档案且本轮未使用任何作品材料。
   */
  provenance?: MaterialProvenance[] | null;
  /** 后端永久锁存，只供读取；普通保存不得改写。 */
  restriction?: { reason: "hidden_material"; at: string } | null;
  /**
   * 按需补读授权状态（add-agent-on-demand-reading）：`null` / 缺失表示未授权。
   * 仅供读取与展示；授权只经后端窄更新写入，前端普通保存不携带。
   */
  on_demand_reading_grant?: OnDemandReadingGrant | null;
  /**
   * 按需补读读取出处（最小元数据）。由后端工具通道按轮写入，前端保存不携带
   * （后端保存时保全档案已有出处）；此处仅供读取档案 / 摘要时携带。
   */
  on_demand_reading_provenance?: OnDemandReadingProvenance[] | null;
}

/**
 * 按需补读授权状态（change: add-agent-on-demand-reading）：授权属于讨论、跨重启
 * 保留；`null` / 缺失表示未授权。只存已授权时间，不含任何材料内容。
 */
export interface OnDemandReadingGrant {
  granted_at: string;
}

/** 按需补读的阅读程度（三档；由后端按轮累计判定）。 */
export type ReadingDepth = "search_snippet" | "partial" | "full";

/** 按需补读读取出处的一条最小元数据（不保存正文副本）。 */
export interface OnDemandReadingProvenance {
  document_id: string;
  version: string;
  depth: ReadingDepth;
  /** 所属轮次（首轮为 0）。 */
  turn_index: number;
  entered_model_context: boolean;
}

/** 列表仅携带轻量元信息；全文通过 conversationRead 按需读取。 */
export interface ConversationSummary {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_status: ConversationTurnStatus;
  focus_document_id: string | null;
  focus_document_title: string | null;
  /** 用户自定义标题原值；null 表示未重命名。 */
  custom_title?: string | null;
  /** 置顶标记；false 表示未置顶。 */
  pinned?: boolean;
  /** 材料出处元数据；缺失（旧档案）按保守策略处理。 */
  provenance?: string[] | null;
  provenance_has_revoked: boolean;
  on_demand_document_ids: string[];
  references_incomplete: boolean;
  /**
   * 后端由统一锁存或旧 revoked 标记派生，与前端当前权限判定 OR。
   * 为 true 时列表等显示层必须对关注文档标题脱敏。
   */
  restricted?: boolean;
}

/** `conversation_list` 的稳定返回：当前作品的讨论列表 + 被跳过（损坏/超限）的档案。 */
export interface ConversationListResult {
  conversations: ConversationSummary[];
  skipped: string[];
}

/**
 * 每讨论的档案写操作串行链与删除终局守卫（change: serialize-discussion-saves，P0-4）。
 *
 * 同一（作品, 讨论）的全部写操作（保存、删除）严格按发起顺序串行执行：
 * 后发起的保存必须等前一个完成落盘后才发起——消灭重叠保存乱序导致的丢更新；
 * 删除先标记「已删除」（排队期间与之后的新保存一律跳过），再排入同一条链，
 * 排干全部在途保存后执行——删除是链上最后一个操作，具终局性。
 *
 * 键为 `projectPath + '\u0000' + conversationId`（修正旧实现仅按裸 id 的全局键）。
 * 链上每环吞掉前一环的错误（真失败已向上抛给该环自己的调用方），不阻断后续环节。
 */
const conversationKey = (projectPath: string, conversationId: string): string =>
  `${projectPath} ${conversationId}`;

const deletedConversations = new Set<string>();
const archiveChains = new Map<string, Promise<unknown>>();

/**
 * 后端墓碑拒绝迟到保存的错误文案前缀。
 * Rust `ConversationStoreError::AlreadyDeleted` 的 Display 形态经 Tauri 命令
 * （`Result<(), String>`）传到前端就是该前缀开头的字符串。
 */
const ALREADY_DELETED_PREFIX = "讨论已删除，无法保存";

/** 迟到保存命中删除墓碑：预期终局，不算失败（判别不出的一律当真失败处理）。 */
function isAlreadyDeletedRejection(error: unknown): boolean {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : null;
  return message !== null && message.startsWith(ALREADY_DELETED_PREFIX);
}

/** 生成全局唯一 `conversation_id`（时间戳 + 随机段）。测试可注入随机段以保持确定。 */
export function generateConversationId(randomSegment: () => string = defaultRandomSegment): string {
  const timestamp = Date.now().toString(36);
  return `${timestamp}-${randomSegment()}`;
}

function defaultRandomSegment(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** 列表标题：优先首轮问题 / 召唤选区文本截断，空则回退到创建时间。 */
export function deriveConversationTitle(
  material: FirstRoundMaterial,
  createdAt: string,
): string {
  const source = material.kind === "direct_question" ? material.question : material.selection_text ?? "";
  const trimmed = source.trim();
  if (trimmed) {
    const TITLE_LIMIT = 40;
    return trimmed.length > TITLE_LIMIT ? `${trimmed.slice(0, TITLE_LIMIT)}…` : trimmed;
  }
  return createdAt;
}

export async function conversationList(
  projectPath: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<ConversationListResult> {
  return call<ConversationListResult>("conversation_list", { projectPath });
}

/** 与后端 meta 同构的列表投影；保存与撤销共用，不保留轮次全文。 */
export function deriveConversationSummary(record: ConversationRecord): ConversationSummary {
  const provenanceHasRevoked = record.provenance?.some((p) => p.material_type === "revoked") ?? false;
  return {
    conversation_id: record.conversation_id,
    title: record.title?.trim() || deriveConversationTitle(record.first_round_material, record.created_at),
    custom_title: record.title?.trim() || null,
    pinned: record.pinned ?? false,
    created_at: record.created_at,
    updated_at: record.updated_at,
    last_status: record.turns[record.turns.length - 1]?.status ?? "pending",
    focus_document_id: record.focus_document_id,
    focus_document_title: record.focus_document_title,
    provenance: record.provenance == null ? null : [...new Set(record.provenance.map((p) => p.document_id))],
    provenance_has_revoked: provenanceHasRevoked,
    restricted: record.restriction != null || provenanceHasRevoked,
    on_demand_document_ids: [...new Set(record.on_demand_reading_provenance?.map((p) => p.document_id) ?? [])],
    references_incomplete: false,
  };
}

export function conversationRead(
  projectPath: string,
  conversationId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<ConversationRecord> {
  return call<ConversationRecord>("conversation_read", { projectPath, conversationId });
}

export function conversationUpdateMeta(
  projectPath: string,
  conversationId: string,
  update: { title?: string; pinned?: boolean },
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  const key = conversationKey(projectPath, conversationId);
  if (deletedConversations.has(key)) return Promise.resolve();
  return enqueueArchiveOperation(key, () => call<void>("conversation_update_meta", { projectPath, conversationId, ...update }));
}

export function latchConversationRestrictions(
  projectPath: string,
  documentId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<string[]> {
  return call<string[]>("latch_conversation_restrictions", { projectPath, documentId });
}

/**
 * 把一次档案写操作排入该讨论的串行链：链空闲时立即发起（与旧行为一致，首笔
 * 保存的 invoke 同步发出）；链忙时等前一环完成后按序发起。前一环的失败不阻断
 * 后续环节（其错误已由该环自己的调用方处理）。
 */
function enqueueArchiveOperation(key: string, operate: () => Promise<void>): Promise<void> {
  const previous = archiveChains.get(key);
  const run = previous === undefined
    ? operate().finally(() => {
        if (archiveChains.get(key) === run) archiveChains.delete(key);
      })
    : previous
        .catch(() => {})
        .then(operate)
        .finally(() => {
          if (archiveChains.get(key) === run) archiveChains.delete(key);
        });
  archiveChains.set(key, run);
  return run;
}

export function conversationSave(
  projectPath: string,
  record: ConversationRecord,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  const conversationId = record.conversation_id;
  const key = conversationKey(projectPath, conversationId);
  // 已删除讨论的保存：发起时即跳过，不发起 invoke。删除标记在 conversationDelete
  // 内同步生效，因此「发起于标记之前的保存」必然已在链上排队、按序落盘后删除最后
  // 落地——同链不交错；「发起于标记之后的保存」在这里被直接拦截。
  if (deletedConversations.has(key)) return Promise.resolve();
  return enqueueArchiveOperation(key, () =>
    call<void>("conversation_save", { projectPath, record }).catch((error: unknown) => {
      // 迟到保存命中后端删除墓碑：预期终局，不算失败、不触发用户可见的保存错误。
      if (isAlreadyDeletedRejection(error)) return;
      throw error;
    }));
}

export function conversationDelete(
  projectPath: string,
  conversationId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  const key = conversationKey(projectPath, conversationId);
  // 先标记已删除：排队期间与删除之后的新保存一律在发起时被拦截。
  deletedConversations.add(key);
  return enqueueArchiveOperation(key, () => call<void>("conversation_delete", { projectPath, conversationId }));
}

/**
 * 撤销软删除：从回收区恢复成功后才清除前端守卫。无需内存全文或重新保存。
 */
export async function conversationRestore(
  projectPath: string,
  conversationId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  const key = conversationKey(projectPath, conversationId);
  // 等待该讨论链上排队的操作（如删除）落地后，再清除前端守卫与后端墓碑。
  const tail = archiveChains.get(key);
  if (tail !== undefined) {
    await tail.catch(() => {
      // 链上失败不阻断恢复。
    });
  }
  await call("conversation_restore", { projectPath, conversationId });
  deletedConversations.delete(key);
}

// ========== 按需补读授权（add-agent-on-demand-reading 任务 7；最小命令面） ==========

/**
 * 开启 / 关闭指定讨论的按需补读授权（讨论内授权开关）。
 * 后端读改写档案：关闭立即阻止后续补读工具调用；关闭不清除已读内容（出处保留）。
 */
export async function conversationSetOnDemandReading(
  projectPath: string,
  conversationId: string,
  granted: boolean,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  await call("conversation_set_on_demand_reading", { projectPath, conversationId, granted });
}

/** 使用过指定文档的讨论（关闭该文档 AI 可见性前的影响提示数据）。 */
export interface ConversationUsage {
  conversation_id: string;
  title: string;
}

/**
 * 查询使用过指定文档的讨论（任务 7.5）：覆盖常规材料出处与按需补读出处。
 * 只读。
 */
export async function conversationsUsingDocument(
  projectPath: string,
  documentId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<ConversationUsage[]> {
  return call<ConversationUsage[]>("conversations_using_document", { projectPath, documentId });
}

/** 指定讨论的按需补读状态（授权 + 补读出处；字段名与后端序列化一致）。 */
export interface OnDemandReadingState {
  grant: OnDemandReadingGrant | null;
  provenance: OnDemandReadingProvenance[] | null;
}

/**
 * 读取指定讨论的按需补读状态（授权 + 补读出处；任务 7.4「本次参考了什么」
 * 在轮次完成后刷新显示用）。只读。
 */
export async function conversationOnDemandReading(
  projectPath: string,
  conversationId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<OnDemandReadingState> {
  return call<OnDemandReadingState>("conversation_on_demand_reading", {
    projectPath,
    conversationId,
  });
}
