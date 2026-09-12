import type { AppDom } from "./dom.ts";
import { startSummon } from "./ai-feature-first-round.ts";
import {
  editAndResendFollowUpAcceptedRequest,
  followUpAcceptedRequest,
  retryFollowUpAcceptedRequest,
} from "./ai-feature-follow-up.ts";
import { startDirectQuestion } from "./ai-feature-direct-question.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import {
  buildDiscussionRecord,
  conversationFromRecord,
  isConversationRestrictedForRecovery,
  type ReadonlyTemporaryConversation,
} from "./ai-panel-conversation.ts";
import { AiRequestCoordinator, type RequestIdentity } from "./ai-request.ts";
import { AiRequestScheduler, DEFAULT_MAX_CONCURRENT } from "./ai-request-scheduler.ts";
import { waitTiming } from "./ai-timing.ts";
import { setupAiDock, type AiDockActions } from "./ai-dock.ts";
import {
  captureSelection,
  authorizeSelection,
  checkSelectionVisibility,
  isMeaningfulSelection,
} from "./selection-adapter.ts";
import { setupSelectionEntry, type SelectionEntryEditor } from "./selection-entry.ts";
import {
  aiSessionTransport,
  type AiReplayOrigin,
  type AiReplayTurn,
  type AiSessionTransport,
} from "./ai-session-transport.ts";
import { loadLlmConfig } from "./project-api.ts";
import {
  conversationDelete,
  conversationList,
  conversationRestore,
  conversationSave,
  generateConversationId,
  type ConversationRecord,
  type ConversationSummary,
} from "./conversation-archive.ts";
import type {
  ContentTree,
  GenerateAiError,
  GenerateAiRequest,
  SelectionSnapshot,
} from "./types.ts";

export function applyGenerateError(
  state: AiPanelState,
  snapshot: SelectionSnapshot,
  error: GenerateAiError,
  conversationId?: string,
): void {
  if (error.code === "configuration_required") {
    state.requireConfiguration(snapshot, conversationId);
    return;
  }
  state.fail(snapshot, error, conversationId);
}

export function retryAcceptedRequest(
  state: AiPanelState,
  request: (
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "summon" }> | Extract<GenerateAiRequest, { kind: "direct_question" }>,
  ) => Promise<void> | null,
): boolean {
  const snapshot = state.retrySnapshot();
  if (!snapshot || request(snapshot, state.retryFirstRequest() ?? undefined) === null) {
    return false;
  }
  return state.acceptFirstRetry();
}

export function openAiConfiguration(
  openConfigPage: () => void,
): void {
  openConfigPage();
}

/** 把讨论的显示历史投影为会话重放轮次（崩溃恢复用）。 */
export function historyTurnsOf(
  conversation: ReadonlyTemporaryConversation,
): AiReplayTurn[] {
  const material = conversation.initialUserMaterial;
  let firstUserText: string;
  if (material.kind === "direct_question") {
    firstUserText = `用户问题：\n${material.question}`;
    if (material.selected_text) {
      firstUserText += `\n\n重点参考材料（可选）：\n${material.selected_text}`;
    }
  } else {
    firstUserText = `重点参考材料（可选）：\n${material.selected_text}`;
  }
  const turns: AiReplayTurn[] = [
    { role: "user", text: firstUserText },
    { role: "assistant", text: conversation.firstResponse },
  ];
  for (const turn of conversation.turns) {
    turns.push({ role: "user", text: turn.question });
    turns.push({ role: "assistant", text: turn.response });
  }
  return turns;
}

/** 讨论的发起方式：重放时按来源组装入口层提示词。 */
export function originOf(conversation: ReadonlyTemporaryConversation): AiReplayOrigin {
  return conversation.initialUserMaterial.kind === "direct_question" ? "direct_question" : "summon";
}

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
  };
}

export interface AiFeatureHooks {
  getCurrentDocumentId: () => string | null;
  getCurrentEditor: () => SelectionEntryEditor | null;
  openConfigPage: () => void;
  getCurrentProjectPath?: () => string | null;
  getCurrentDocumentTitle?: () => string | null;
  getCurrentTree?: () => ContentTree | null;
  getCurrentDocumentVersion?: () => string | null;
}

export interface AiFeatureController {
  beginProject(): void;
  endProject(): void;
  submitFollowUp(question: string): Promise<boolean>;
  retryFollowUp(): Promise<boolean>;
  editFollowUp(question: string): Promise<boolean>;
  readonly state: AiPanelState;
  getConversations(): ConversationSummary[];
  openDiscussion(summary: ConversationSummary): void;
  deleteDiscussion(conversationId: string): Promise<void>;
  /** 权限变更后重算已打开讨论的材料限制并锁存（任务 5.2/5.4）。 */
  recomputeRestrictions(): void;
}

export interface AiFeatureDependencies {
  loadConfig?: typeof loadLlmConfig;
  transport?: AiSessionTransport;
  conversationList?: typeof conversationList;
  conversationSave?: typeof conversationSave;
  conversationDelete?: typeof conversationDelete;
  conversationRestore?: typeof conversationRestore;
  newConversationId?: () => string;
  maxConcurrent?: number;
  /**
   * 集成点（controlled-story-read-visibility）：返回当前作品下「不允许 AI 查看」的
   * 文档 ID 集合。后端可见性 API 就绪后由其实名实现注入；未接入时缺省返回空集，
   * 不引入任何受限行为（旧档案缺出处的保守受限仍生效）。
   */
  getHiddenDocumentIds?: () => ReadonlySet<string>;
}

type StructuredRequestSender = (
  request: GenerateAiRequest,
  identity: RequestIdentity,
) => Promise<void> | null;

interface AiFeatureWiring {
  readonly state: AiPanelState;
  readonly openConfigPage: AiFeatureHooks["openConfigPage"];
  readonly requestStructured: StructuredRequestSender;
  readonly submitDirectQuestion: (question: string) => boolean;
  readonly syncPendingSelection: () => void;
  readonly persistCurrentDiscussion: () => void;
  readonly openDiscussion: (summary: ConversationSummary) => void;
  readonly deleteDiscussion: (conversationId: string) => Promise<void>;
  readonly stopGeneration: (conversationId: string) => void;
  readonly closeWindow: (conversationId: string) => void;
  readonly retryFirstRound: () => void;
  readonly renameDiscussion: (conversationId: string, title: string) => Promise<boolean>;
  readonly togglePin: (conversationId: string) => Promise<boolean>;
  readonly undoDelete: () => void;
  readonly getUndoNotice: () => { title: string } | null;
}

function buildAiDockActions(wiring: AiFeatureWiring): AiDockActions {
  const {
    state,
    openConfigPage,
    requestStructured,
    submitDirectQuestion,
    syncPendingSelection,
    persistCurrentDiscussion,
    openDiscussion,
    deleteDiscussion,
    stopGeneration,
    closeWindow,
    retryFirstRound,
    renameDiscussion,
    togglePin,
    undoDelete,
    getUndoNotice,
  } = wiring;

  return {
    openConfigPage,
    onSubmitFollowUp: async (question) => {
      const accepted = followUpAcceptedRequest(state, question, requestStructured);
      if (accepted) persistCurrentDiscussion();
      return accepted;
    },
    onRetryFollowUp: async () => {
      const accepted = retryFollowUpAcceptedRequest(state, requestStructured);
      if (accepted) persistCurrentDiscussion();
      return accepted;
    },
    onEditFollowUp: async (question) => {
      const accepted = editAndResendFollowUpAcceptedRequest(state, question, requestStructured);
      if (accepted) persistCurrentDiscussion();
      return accepted;
    },
    onRetryStoppedFollowUp: async () => {
      const identity = state.conversationIdentity;
      const payload = state.followUpRequest();
      if (!identity || identity.turnId === undefined || !payload) return false;
      const accepted = requestStructured(payload, {
        conversationId: identity.conversationId,
        turnId: identity.turnId,
      });
      if (accepted === null) return false;
      const ok = state.retryStoppedFollowUp();
      if (ok) persistCurrentDiscussion();
      return ok;
    },
    onRetry: retryFirstRound,
    onSubmitDirectQuestion: async (question) => {
      const accepted = submitDirectQuestion(question);
      if (accepted) persistCurrentDiscussion();
      return accepted;
    },
    onRemoveDirectQuestionSelection: () => state.removePendingSelection(),
    onDirectQuestionFocus: () => syncPendingSelection(),
    onStop: stopGeneration,
    onClose: closeWindow,
    onDelete: deleteDiscussion,
    onOpenDiscussion: openDiscussion,
    onNewConversation: () => {
      state.newConversation();
    },
    onRename: renameDiscussion,
    onTogglePin: togglePin,
    onUndoDelete: undoDelete,
    getUndoNotice,
  };
}

/**
 * 把常驻会话传输层、按讨论隔离的单请求协调器、全局调度器、生成桥接、讨论档案与
 * 窗口管理器接入编辑器。
 *
 * 模块边界（零写回）：本模块不持有 `saveProject`、编辑器 DOM 写入函数或任何“应用到正文”
 * 回调。生成只提交问题与选区原文，结果只显示在独立窗口里；讨论档案由受控命令写入作品文件夹。
 */
export function setupAiFeature(
  dom: AppDom,
  hooks: AiFeatureHooks,
  dependencies: AiFeatureDependencies = {},
): AiFeatureController {
  const getCurrentProjectPath = hooks.getCurrentProjectPath ?? (() => null);
  const getCurrentDocumentTitle = hooks.getCurrentDocumentTitle ?? (() => null);
  const getCurrentTree = hooks.getCurrentTree ?? (() => null);
  const getCurrentDocumentVersion = hooks.getCurrentDocumentVersion ?? (() => null);
  const newConversationId = dependencies.newConversationId ?? generateConversationId;
  const state = new AiPanelState(() => {}, newConversationId);
  let projectToken = 0;
  const loadConfig = dependencies.loadConfig ?? loadLlmConfig;
  const transport = dependencies.transport ?? aiSessionTransport;
  const listConversations = dependencies.conversationList ?? conversationList;
  const saveConversation = dependencies.conversationSave ?? conversationSave;
  const deleteConversation = dependencies.conversationDelete ?? conversationDelete;
  const restoreConversation = dependencies.conversationRestore ?? conversationRestore;
  // 集成点：后端可见性 API 未接入时返回空集（无受限）；就绪后注入真实实现。
  const getHiddenDocumentIds = dependencies.getHiddenDocumentIds ?? (() => new Set<string>());
  const hiddenDocumentIds = (): ReadonlySet<string> => getHiddenDocumentIds();

  /** 保存指定讨论：接受即存（pending），终态原子更新；失败对用户可见。 */
  function persistDiscussion(conversationId: string | null): void {
    if (conversationId === null) return;
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    const discussion = state.getDiscussion(conversationId);
    if (discussion === null) return;
    if (discussion.conversation === null && discussion.pendingFirstRequest === null) return;
    const record = buildDiscussionRecord(discussion);
    const token = projectToken;
    void saveConversation(projectPath, record)
      .then(() => {
        if (projectToken === token) state.clearSaveError();
      })
      .catch(() => {
        if (projectToken === token) state.setSaveError("讨论保存失败，本次内容可能未落盘");
      });
  }

  function persistCurrentDiscussion(): void {
    persistDiscussion(state.activeConversationId);
  }

  /**
   * 权限变更后：按当前作品可见性重算各打开讨论的材料限制并锁存（任务 5.2/5.4）。
   * 新被标记受限的讨论立即持久化，使锁存状态在重新开启可见性后重开也不被解除。
   */
  function recomputeRestrictions(): void {
    const newlyRestricted = state.recomputeRestrictions(hiddenDocumentIds());
    for (const conversationId of newlyRestricted) {
      persistDiscussion(conversationId);
    }
  }

  function openDiscussion(summary: ConversationSummary): void {
    const conversation = conversationFromRecord(summary, {
      hiddenDocumentIds: hiddenDocumentIds(),
    });
    state.openDiscussion(conversation, summary.focus_document_id, summary.focus_document_title);
  }

  // 删除撤销：删除立即生效，前端保留内存副本，提示期内可撤销（约 6 秒）。
  const UNDO_TIMEOUT_MS = 6000;
  let pendingUndo: { conversationId: string; summary: ConversationSummary; timer: ReturnType<typeof setTimeout> } | null = null;

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
      state.setSaveError("撤销删除失败");
      return;
    }
    loadDiscussions();
  }

  async function deleteDiscussion(conversationId: string): Promise<void> {
    const summary = state.conversations.find((c) => c.conversation_id === conversationId);
    transport.cancelMessage(conversationId);
    transport.endSession(conversationId);
    scheduler.cancelQueued(conversationId);
    state.deleteDiscussion(conversationId);
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    try {
      await deleteConversation(projectPath, conversationId);
    } catch {
      state.setSaveError("删除讨论失败");
      return;
    }
    if (summary) {
      clearUndo();
      const timer = setTimeout(() => { pendingUndo = null; }, UNDO_TIMEOUT_MS);
      timer.unref?.();
      pendingUndo = {
        conversationId,
        summary,
        timer,
      };
    }
  }

  /** 重命名讨论：更新内存标题并持久化到档案。 */
  async function renameDiscussion(conversationId: string, title: string): Promise<boolean> {
    if (!state.renameDiscussion(conversationId, title)) return false;
    persistDiscussion(conversationId);
    return true;
  }

  /** 置顶 / 取消置顶讨论：更新内存标记并持久化。 */
  async function togglePin(conversationId: string): Promise<boolean> {
    const discussion = state.getDiscussion(conversationId);
    if (!discussion?.conversation) return false;
    if (!state.setDiscussionPinned(conversationId, !(discussion.conversation.pinned ?? false))) {
      return false;
    }
    persistDiscussion(conversationId);
    return true;
  }

  function loadDiscussions(): void {
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    const token = projectToken;
    void listConversations(projectPath)
      .then((result) => {
        if (projectToken !== token) return;
        state.loadDiscussions(result.conversations, result.skipped, hiddenDocumentIds());
        if (result.skipped.length > 0) {
          state.setSaveError(`有 ${result.skipped.length} 个讨论档案无法读取，已跳过`);
        }
      })
      .catch(() => {
        if (projectToken !== token) return;
        state.setSaveError("读取讨论列表失败");
      });
  }

  const coordinator = new AiRequestCoordinator(
    (selectedText: string) =>
      transport.sendViaResidentSession(state.activeConversationId ?? "", {
        kind: "summon",
        selected_text: selectedText,
      }),
    {
      onSuccess: (snapshot: SelectionSnapshot, content: string, conversationId: string) => {
        waitTiming.complete(conversationId);
        state.succeed(snapshot, content, conversationId);
        persistDiscussion(conversationId);
      },
      onError: (snapshot: SelectionSnapshot, error, conversationId: string) => {
        waitTiming.complete(conversationId);
        applyGenerateError(state, snapshot, error, conversationId);
        persistDiscussion(conversationId);
      },
      onStructuredSuccess: (content, identity) => {
        waitTiming.complete(identity.conversationId);
        state.succeedFollowUp(identity.turnId ?? -1, content, identity.conversationId);
        persistDiscussion(identity.conversationId);
      },
      onStructuredError: (error, identity) => {
        waitTiming.complete(identity.conversationId);
        if (error.code === "configuration_required") {
          state.requireFollowUpConfiguration(identity.turnId ?? -1, identity.conversationId);
        } else {
          state.failFollowUp(identity.turnId ?? -1, error, identity.conversationId);
        }
        persistDiscussion(identity.conversationId);
      },
      onDirectQuestionSuccess: (content, conversationId) => {
        waitTiming.complete(conversationId);
        state.succeedDirectQuestion(content, conversationId);
        persistDiscussion(conversationId);
      },
      onDirectQuestionError: (error, conversationId) => {
        waitTiming.complete(conversationId);
        if (error.code === "configuration_required") {
          state.requireDirectQuestionConfiguration(conversationId);
        } else {
          state.failDirectQuestion(error, conversationId);
        }
        persistDiscussion(conversationId);
      },
    },
    () => projectToken,
    (conversationId, request) => transport.sendViaResidentSession(conversationId, request),
    () => state.requestIdentity,
  );

  // 全局调度器：名额释放时把排队请求恢复为生成中；派发前复核失败的排队请求转为失败终态。
  const scheduler = new AiRequestScheduler(
    dependencies.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    (conversationId) => {
      state.startQueuedRequest(conversationId);
      waitTiming.started(conversationId);
    },
    (conversationId) => {
      waitTiming.complete(conversationId);
      state.rejectQueuedRequest(conversationId, {
        code: "document_not_visible",
        message: "材料文档的可见性已变化，本次请求未发送。请重新发起。",
      });
    },
  );

  /**
   * 派发前材料权限复核（任务 6.1）：排队请求实际派发前，重新检查其材料来源文档
   * 是否仍允许 AI 查看。无材料来源（无选区 / 无关注文档）时不需复核，直接放行。
   */
  function materialDispatchGuard(conversationId: string): () => boolean {
    return () => {
      const discussion = state.getDiscussion(conversationId);
      if (!discussion) return false;
      const sourceDocumentId = discussion.anchor?.documentId ?? discussion.focusDocumentId;
      if (sourceDocumentId === null) return true;
      return !hiddenDocumentIds().has(sourceDocumentId);
    };
  }

  /** 记录提交/排队/开始时间，并返回调度结果。 */
  function scheduleTracked(
    conversationId: string,
    kind: string,
    run: () => Promise<void> | null,
  ): "started" | "queued" | "busy" {
    waitTiming.submit(conversationId, kind);
    const result = scheduler.submit({
      conversationId,
      run,
      beforeDispatch: materialDispatchGuard(conversationId),
    });
    if (result === "started") waitTiming.started(conversationId);
    else if (result === "queued") waitTiming.queued(conversationId);
    return result;
  }

  /** 经调度器发送结构化请求（追问 / 重试 / 编辑重发）。 */
  const requestStructured: StructuredRequestSender = (request, identity) => {
    const result = scheduleTracked(identity.conversationId, request.kind, () =>
      coordinator.requestStructured(request, identity),
    );
    if (result === "busy") return null;
    if (result === "queued") state.queueRequest(identity.conversationId);
    return Promise.resolve();
  };

  /** 经调度器发送召唤首轮（首轮始终归属聚焦讨论）。 */
  const requestSummon = (
    conversationId: string,
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "summon" }> | Extract<GenerateAiRequest, { kind: "direct_question" }>,
  ): Promise<void> | null => {
    const result = scheduleTracked(conversationId, "summon", () =>
      coordinator.requestFor(conversationId, snapshot, firstRequest),
    );
    if (result === "busy") return null;
    if (result === "queued") state.queueRequest(conversationId);
    return Promise.resolve();
  };

  /** 经调度器发送直接提问（首轮 / 重试）。 */
  const requestDirectQuestion = (conversationId: string, request: GenerateAiRequest): Promise<void> | null => {
    const result = scheduleTracked(conversationId, request.kind, () =>
      coordinator.requestDirectQuestionFor(conversationId, request),
    );
    if (result === "busy") return null;
    if (result === "queued") state.queueRequest(conversationId);
    return Promise.resolve();
  };

  const selectionEntry = setupSelectionEntry({
    dom,
    getCurrentDocumentId: hooks.getCurrentDocumentId,
    getCurrentEditor: hooks.getCurrentEditor as () => SelectionEntryEditor | null,
    isRequestInFlight: () => false,
    isCurrentDocumentAiVisible: () => {
      const documentId = hooks.getCurrentDocumentId();
      return documentId !== null && checkSelectionVisibility(getCurrentTree(), {
        documentId,
        selectedText: "selection",
        from: 0,
        to: 0,
      }).allowed;
    },
    getSelectionIdentity: () => ({
      projectPath: getCurrentProjectPath() ?? undefined,
      documentVersion: getCurrentDocumentVersion() ?? undefined,
    }),
    onSummon: (snapshot) => {
      const accepted = startSummon({
        state,
        snapshot,
        loadConfig,
        request: (request) => {
          const conversationId = state.activeConversationId;
          if (conversationId === null) return Promise.resolve();
          return requestSummon(conversationId, snapshot, request);
        },
        getProjectToken: () => projectToken,
        focusDocumentId: snapshot.documentId,
        focusDocumentTitle: getCurrentDocumentTitle(),
        checkSelectionAllowed: (selection) => authorizeSelection(selection, {
          projectPath: getCurrentProjectPath(),
          documentVersion: getCurrentDocumentVersion(),
          hiddenDocumentIds: hiddenDocumentIds(),
        }, getCurrentTree()),
      });
      if (accepted) persistCurrentDiscussion();
    },
  });

  function syncPendingSelection(): void {
    const editor = hooks.getCurrentEditor();
    const documentId = hooks.getCurrentDocumentId();
    if (!editor || documentId === null) return;
    const snapshot = captureSelection(documentId, editor, {
      projectPath: getCurrentProjectPath() ?? undefined,
      documentVersion: getCurrentDocumentVersion() ?? undefined,
    });
    state.setPendingSelection(isMeaningfulSelection(snapshot) ? snapshot : null);
  }

  function submitDirectQuestion(question: string): boolean {
    return startDirectQuestion({
      state,
      question,
      selection: state.view.pendingSelection,
      loadConfig,
      request: (request) => {
        const conversationId = state.activeConversationId;
        if (conversationId === null) return Promise.resolve();
        return requestDirectQuestion(conversationId, request);
      },
      getProjectToken: () => projectToken,
      focusDocumentId: hooks.getCurrentDocumentId(),
      focusDocumentTitle: getCurrentDocumentTitle(),
      checkSelectionAllowed: (selection) => authorizeSelection(selection, {
        projectPath: getCurrentProjectPath(),
        documentVersion: getCurrentDocumentVersion(),
        hiddenDocumentIds: hiddenDocumentIds(),
      }, getCurrentTree()),
    });
  }

  function stopGeneration(conversationId: string): void {
    scheduler.cancelQueued(conversationId);
    transport.cancelMessage(conversationId);
    coordinator.cancel(conversationId);
    waitTiming.complete(conversationId);
    state.stopRequest(conversationId);
    persistDiscussion(conversationId);
  }

  function closeWindow(conversationId: string): void {
    scheduler.cancelQueued(conversationId);
    transport.cancelMessage(conversationId);
    coordinator.cancel(conversationId);
    state.stopRequest(conversationId);
    state.closeWindow(conversationId);
  }

  function retryFirstRound(): void {
    const conversationId = state.activeConversationId;
    if (conversationId === null) return;
    const request = state.view.request;
    if (request.kind === "direct_question") {
      if (!state.retryDirectQuestion(conversationId)) return;
      const payload: GenerateAiRequest = {
        kind: "direct_question",
        question: request.question,
        ...(request.selection ? {
          selected_text: request.selection.selectedText,
          document_id: request.selection.documentId,
          ...(request.selection.projectPath !== undefined ? { project_path: request.selection.projectPath } : {}),
          ...(request.selection.documentVersion !== undefined ? { document_version: request.selection.documentVersion } : {}),
          ...(request.selection.bodySnapshot !== undefined ? { snapshot: request.selection.bodySnapshot } : {}),
        } : {}),
      };
      const accepted = requestDirectQuestion(conversationId, payload);
      if (accepted === null) {
        state.failDirectQuestion({ code: "network", message: "已有 AI 请求正在进行，本次请求没有发出。" }, conversationId);
      }
      return;
    }
    retryAcceptedRequest(state, (snapshot, firstRequest) =>
      requestSummon(conversationId, snapshot, firstRequest),
    );
  }

  // 面板打开期间，编辑器选区变化会同步为待附带的重点材料（替换旧选区或清除）。
  const editorEventTypes = ["mouseup", "keyup", "select", "click", "input", "scroll"] as const;
  for (const eventType of editorEventTypes) {
    dom.editorTextarea.addEventListener(eventType, () => {
      if (state.isOpen) syncPendingSelection();
    });
  }

  // 常驻会话事件路由：流式增量按讨论身份推进对应讨论状态；驱动丢失进入恢复流程。
  transport.installSessionEventRouting();
  transport.onStreamText(({ conversationId, text }) => {
    waitTiming.firstResponse(conversationId);
    state.appendStreamText(conversationId, text);
  });
  transport.onDriverLost(() => {
    // 驱动进程丢失：所有会话失效，在途请求作废；对每个打开窗口的讨论执行重放恢复。
    coordinator.releaseStaleRequestOwnership();
    const recoverable = [...state.windows.keys()].filter((id) => {
      const discussion = state.getDiscussion(id);
      return (
        discussion !== null &&
        discussion.conversation !== null &&
        // 材料权限受限的讨论不得把显示历史重放给 DSH（保留面板历史，不重建可继续上下文）。
        // 按当前 hiddenDocumentIds 重算：打开后新隐藏的来源文档也会被拦下，不重放。
        !isConversationRestrictedForRecovery(discussion.conversation, hiddenDocumentIds())
      );
    });
    if (recoverable.length === 0) {
      transport.endAllSessions();
      return;
    }
    for (const conversationId of recoverable) {
      const discussion = state.getDiscussion(conversationId)!;
      if (!state.beginRecovery(conversationId)) continue;
      transport.replaySession(
        conversationId,
        historyTurnsOf(discussion.conversation!),
        originOf(discussion.conversation!),
      )
        .then(() => {
          state.completeRecovery(conversationId);
        })
        .catch(() => {
          state.failRecovery(conversationId);
        });
    }
  });

  // 编辑器头「AI 面板」按钮：切换停靠区展开/收起。
  dom.btnToggleAi.addEventListener("click", () => {
    if (state.isOpen) state.close();
    else state.open();
  });

  setupAiDock(dom.aiDock, state, buildAiDockActions({
    state,
    openConfigPage: hooks.openConfigPage,
    requestStructured,
    submitDirectQuestion,
    syncPendingSelection,
    persistCurrentDiscussion,
    openDiscussion,
    deleteDiscussion,
    stopGeneration,
    closeWindow,
    retryFirstRound,
    renameDiscussion,
    togglePin,
    undoDelete,
    getUndoNotice,
  }));

  function resetProjectScopedAi(): void {
    projectToken += 1;
    clearUndo();
    coordinator.releaseStaleRequestOwnership();
    selectionEntry.reset();
    transport.endAllSessions();
    state.reset();
  }

  return {
    state,
    beginProject(): void {
      resetProjectScopedAi();
      loadDiscussions();
    },
    endProject(): void {
      resetProjectScopedAi();
    },
    submitFollowUp(question: string): Promise<boolean> {
      return Promise.resolve(followUpAcceptedRequest(state, question, requestStructured));
    },
    retryFollowUp(): Promise<boolean> {
      return Promise.resolve(retryFollowUpAcceptedRequest(state, requestStructured));
    },
    editFollowUp(question: string): Promise<boolean> {
      return Promise.resolve(editAndResendFollowUpAcceptedRequest(state, question, requestStructured));
    },
    getConversations(): ConversationSummary[] {
      return state.conversations;
    },
    openDiscussion,
    deleteDiscussion,
    recomputeRestrictions,
  };
}
