import type { AiPanelState } from "./ai-panel-state.ts";
import type {
  ConversationRecord,
  ConversationSummary,
  conversationDelete,
  conversationRestore,
  conversationSave,
} from "./conversation-archive.ts";

/** 把会话列表摘要还原为档案保存契约（删除撤销用内存副本重新写回）。 */
export function summaryToRecord(summary: ConversationSummary): ConversationRecord {
  return {
    version: 1,
    conversation_id: summary.conversation_id,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
    focus_document_id: summary.focus_document_id,
    focus_document_title: summary.focus_document_title,
    first_round_material: summary.first_round_material,
    turns: summary.turns,
    ...(summary.custom_title?.trim() ? { title: summary.custom_title } : {}),
    ...(summary.pinned ? { pinned: true } : {}),
    ...(summary.provenance !== undefined ? { provenance: summary.provenance } : {}),
    on_demand_reading_grant: summary.on_demand_reading_grant ?? null,
    // 补读出处随摘要携带：删除撤销重写以摘要快照为准（后端保存保全覆盖不到显式
    // 携带的记录，这里不做读改写合并）。
    ...(summary.on_demand_reading_provenance !== null && summary.on_demand_reading_provenance !== undefined
      ? { on_demand_reading_provenance: summary.on_demand_reading_provenance }
      : {}),
  };
}

/**
 * 删除＋撤销机制（`pendingUndo` 计时器家族；change: extract-ai-logic-seams 第二刀）。
 *
 * 从 `setupAiFeature` 闭包宇宙中提取，遵循 editor-module-boundaries 惯例：
 * - 不引 DOM：不访问 `document` / `window`，只收显式依赖（状态外观 + 访问器 + 后端调用）；
 * - 访问器逐次求值：`getCurrentProjectPath` / `isDestroyed` 都在每次使用时现取，
 *   不做任何快照化（可见性红线，design D6）；
 * - 清理顺序是隐式契约：`clearUndo` 由编排层的 `resetProjectScopedAi` / `destroy`
 *   在原位置调用，步骤不重排。
 */
export interface DeleteUndoDependencies {
  /** 面板状态外观（讨论集合、删除迁移、保存错误提示）。 */
  readonly state: AiPanelState;
  /** 当前作品路径访问器；null 表示无作品（跳过档案操作）。 */
  readonly getCurrentProjectPath: () => string | null;
  /** 编排层销毁标记访问器：迟到回调到达时现读。 */
  readonly isDestroyed: () => boolean;
  /** 停止该讨论的在途传输（删除即终止其生成会话）。 */
  readonly cancelMessage: (conversationId: string) => void;
  /** 结束该讨论的常驻会话。 */
  readonly endSession: (conversationId: string) => void;
  /** 取消该讨论的排队请求。 */
  readonly cancelQueued: (conversationId: string) => void;
  /** 从档案恢复已删除讨论（撤销第一步）。 */
  readonly restoreConversation: typeof conversationRestore;
  /** 把内存副本重新写回档案（撤销第二步）。 */
  readonly saveConversation: typeof conversationSave;
  /** 删除讨论档案。 */
  readonly deleteConversation: typeof conversationDelete;
  /** 撤销完成后的列表重载入口（由编排层注入）。 */
  readonly reloadDiscussions: () => void;
}

/** 删除撤销的交互入口（由 `setupAiFeature` 装配后接线）。 */
export interface DeleteUndoController {
  /** 清除待撤销副本并停掉其计时器（作品重置 / 销毁路径按原位置调用）。 */
  clearUndo(): void;
  /** 撤销提示数据；无可撤销删除时为 null。 */
  getUndoNotice(): { title: string } | null;
  undoDelete(): Promise<void>;
  deleteDiscussion(conversationId: string): Promise<void>;
}

// 删除撤销：删除立即生效，前端保留内存副本，提示期内可撤销（约 6 秒）。
const UNDO_TIMEOUT_MS = 6000;

export function setupDeleteUndo(deps: DeleteUndoDependencies): DeleteUndoController {
  const {
    state,
    getCurrentProjectPath,
    isDestroyed,
    cancelMessage,
    endSession,
    cancelQueued,
    restoreConversation,
    saveConversation,
    deleteConversation,
    reloadDiscussions,
  } = deps;

  let pendingUndo: {
    conversationId: string;
    summary: ConversationSummary;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function clearUndo(): void {
    if (pendingUndo) {
      clearTimeout(pendingUndo.timer);
      pendingUndo = null;
    }
  }

  function getUndoNotice(): { title: string } | null {
    return pendingUndo ? { title: pendingUndo.summary.title } : null;
  }

  async function undoDelete(): Promise<void> {
    if (!pendingUndo) return;
    const { conversationId, summary } = pendingUndo;
    clearUndo();
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    try {
      await restoreConversation(projectPath, conversationId);
      await saveConversation(projectPath, summaryToRecord(summary));
    } catch {
      if (isDestroyed()) return;
      state.setSaveError("撤销删除失败");
      return;
    }
    if (isDestroyed()) return;
    reloadDiscussions();
  }

  async function deleteDiscussion(conversationId: string): Promise<void> {
    const summary = state.conversations.find((c) => c.conversation_id === conversationId);
    cancelMessage(conversationId);
    endSession(conversationId);
    cancelQueued(conversationId);
    state.deleteDiscussion(conversationId);
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    try {
      await deleteConversation(projectPath, conversationId);
    } catch {
      if (isDestroyed()) return;
      state.setSaveError("删除讨论失败");
      return;
    }
    if (isDestroyed()) return;
    if (summary) {
      clearUndo();
      const timer = setTimeout(() => {
        pendingUndo = null;
      }, UNDO_TIMEOUT_MS);
      timer.unref?.();
      pendingUndo = {
        conversationId,
        summary,
        timer,
      };
    }
  }

  return {
    clearUndo,
    getUndoNotice,
    undoDelete,
    deleteDiscussion,
  };
}
