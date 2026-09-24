import type { AiPanelState } from "./ai-panel-state.ts";
import { conversationFromRecord } from "./ai-panel-conversation.ts";
import { deriveConversationSummary } from "./conversation-archive.ts";
import type {
  conversationDelete,
  conversationRead,
  conversationRestore,
} from "./conversation-archive.ts";

/** 软删除撤销只记身份和提示，不保留全文、不重新写档。 */
export interface DeleteUndoDependencies {
  readonly state: AiPanelState;
  readonly getCurrentProjectPath: () => string | null;
  readonly getProjectToken: () => number;
  readonly hiddenDocumentIds: () => ReadonlySet<string>;
  readonly isDestroyed: () => boolean;
  readonly cancelMessage: (conversationId: string) => void;
  readonly endSession: (conversationId: string) => void;
  readonly cancelQueued: (conversationId: string) => void;
  readonly restoreConversation: typeof conversationRestore;
  readonly readConversation: typeof conversationRead;
  readonly deleteConversation: typeof conversationDelete;
}

export interface DeleteUndoController {
  clearUndo(): void;
  getUndoNotice(): { title: string } | null;
  undoDelete(): Promise<void>;
  deleteDiscussion(conversationId: string): Promise<void>;
}

const UNDO_TIMEOUT_MS = 6000;

export function setupDeleteUndo(deps: DeleteUndoDependencies): DeleteUndoController {
  let pendingUndo: {
    conversationId: string;
    title: string;
    projectPath: string;
    token: number;
    restored: boolean;
    restoring: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  let deleteSequence = 0;

  function clearUndo(): void {
    deleteSequence += 1;
    if (!pendingUndo) return;
    if (pendingUndo?.timer) clearTimeout(pendingUndo.timer);
    pendingUndo = null;
    deps.state.notifyUndoNoticeChanged();
  }

  function current(projectPath: string, token: number): boolean {
    return !deps.isDestroyed() && deps.getProjectToken() === token && deps.getCurrentProjectPath() === projectPath;
  }

  async function undoDelete(): Promise<void> {
    const undo = pendingUndo;
    if (!undo || undo.restoring || !current(undo.projectPath, undo.token)) return;
    if (undo.timer) clearTimeout(undo.timer);
    undo.timer = null;
    undo.restoring = true;
    try {
      if (!undo.restored) {
        await deps.restoreConversation(undo.projectPath, undo.conversationId);
        undo.restored = true;
      }
      if (pendingUndo !== undo || !current(undo.projectPath, undo.token)) return;
      const record = await deps.readConversation(undo.projectPath, undo.conversationId);
      if (pendingUndo !== undo || !current(undo.projectPath, undo.token)) return;
      const hidden = deps.hiddenDocumentIds();
      deps.state.upsertSummary(deriveConversationSummary(record), hidden, true);
      deps.state.openDiscussion(conversationFromRecord(record, { hiddenDocumentIds: hidden }),
        record.focus_document_id, record.focus_document_title);
      clearUndo();
    } catch (error) {
      if (pendingUndo !== undo || !current(undo.projectPath, undo.token)) return;
      deps.state.setSaveError(`撤销删除失败：${error instanceof Error ? error.message : String(error)}`);
      // 失败时保留提示，可重试；恢复已提交但读取失败时只重试读取。
    } finally {
      undo.restoring = false;
    }
  }

  async function deleteDiscussion(conversationId: string): Promise<void> {
    const summary = deps.state.conversations.find((c) => c.conversation_id === conversationId);
    deps.cancelMessage(conversationId);
    deps.endSession(conversationId);
    deps.cancelQueued(conversationId);
    deps.state.deleteDiscussion(conversationId);
    const projectPath = deps.getCurrentProjectPath();
    if (projectPath === null) return;
    const token = deps.getProjectToken();
    clearUndo();
    const sequence = deleteSequence;
    try {
      await deps.deleteConversation(projectPath, conversationId);
    } catch (error) {
      if (!current(projectPath, token)) return;
      // 删除失败不吞掉条目，让用户可重开确认或再次删除。
      if (summary) deps.state.upsertSummary(summary, deps.hiddenDocumentIds(), true);
      deps.state.setSaveError(`删除讨论失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!current(projectPath, token) || sequence !== deleteSequence) return;
    const timer = setTimeout(clearUndo, UNDO_TIMEOUT_MS);
    timer.unref?.();
    pendingUndo = { conversationId, title: summary?.title ?? "讨论", projectPath, token,
      restored: false, restoring: false, timer };
    deps.state.notifyUndoNoticeChanged();
  }

  return { clearUndo, getUndoNotice: () => pendingUndo ? { title: pendingUndo.title } : null,
    undoDelete, deleteDiscussion };
}
