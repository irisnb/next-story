import type { AppDom } from "./dom.ts";
import {
  createPreflightGate,
  startSummon,
  type FirstRequestPreflightState,
} from "./ai-feature-first-round.ts";
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
  type ReadonlyTemporaryConversation,
} from "./ai-panel-conversation.ts";
import { AiRequestCoordinator, type RequestIdentity } from "./ai-request.ts";
import { setupAiPanel, type AiPanelActions } from "./ai-panel.ts";
import { captureSelection, isMeaningfulSelection } from "./selection-adapter.ts";
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
  conversationSave,
  generateConversationId,
  type ConversationSummary,
} from "./conversation-archive.ts";
import type {
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

/**
 * 把当前讨论的显示历史投影为会话重放轮次（崩溃恢复用）。
 */
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

export interface AiFeatureHooks {
  getCurrentDocumentId: () => string | null;
  getCurrentEditor: () => SelectionEntryEditor | null;
  openConfigPage: () => void;
  /** 当前作品路径（讨论档案归属）；省略时讨论不落盘。 */
  getCurrentProjectPath?: () => string | null;
  getCurrentDocumentTitle?: () => string | null;
}

export interface AiFeatureController {
  /** 新作品进入编辑器：结束全部会话、清空面板并加载新作品讨论列表。 */
  beginProject(): void;
  /** 作品卸载（返回欢迎页）：使在途请求失效、结束会话并清空面板。 */
  endProject(): void;
  submitFollowUp(question: string): Promise<boolean>;
  retryFollowUp(): Promise<boolean>;
  editFollowUp(question: string): Promise<boolean>;
  /** 面板状态（供会话列表 UI 订阅与读取）。 */
  readonly state: AiPanelState;
  /** 当前作品的讨论列表。 */
  getConversations(): ConversationSummary[];
  /** 从列表重开讨论。 */
  openDiscussion(summary: ConversationSummary): void;
  /** 删除讨论（独立动作，结束对应会话并移除档案）。 */
  deleteDiscussion(conversationId: string): Promise<void>;
}

export interface AiFeatureDependencies {
  loadConfig?: typeof loadLlmConfig;
  /** 常驻会话传输层；默认用应用内共享单例，测试可注入假实现。 */
  transport?: AiSessionTransport;
  /** 讨论档案命令；默认用真实 Tauri 命令，测试可注入假实现。 */
  conversationList?: typeof conversationList;
  conversationSave?: typeof conversationSave;
  conversationDelete?: typeof conversationDelete;
  /** 全局唯一 conversation_id 生成器；默认时间戳 + 随机段。 */
  newConversationId?: () => string;
}

type StructuredRequestSender = (
  request: GenerateAiRequest,
  identity: RequestIdentity,
) => Promise<void> | null;

interface AiPanelWiring {
  readonly state: AiPanelState;
  readonly openConfigPage: AiFeatureHooks["openConfigPage"];
  readonly requestStructured: StructuredRequestSender;
  readonly submitDirectQuestion: (question: string) => boolean;
  readonly syncPendingSelection: () => void;
  readonly persistCurrentDiscussion: () => void;
  readonly openDiscussion: (summary: ConversationSummary) => void;
  readonly deleteDiscussion: (conversationId: string) => Promise<void>;
}

function buildAiPanelActions(wiring: AiPanelWiring): AiPanelActions {
  const {
    state,
    openConfigPage,
    requestStructured,
    submitDirectQuestion,
    syncPendingSelection,
    persistCurrentDiscussion,
    openDiscussion,
    deleteDiscussion,
  } = wiring;

  return {
    // 常驻会话首轮失败后不通过旧的一次性请求协调器重试。
    onRetry: () => {
      retryAcceptedRequest(state, () => null);
    },
    onGoToConfig: () => openAiConfiguration(openConfigPage),
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
    onSubmitDirectQuestion: async (question) => {
      const accepted = submitDirectQuestion(question);
      if (accepted) persistCurrentDiscussion();
      return accepted;
    },
    // 新建对话：开启新讨论并保留旧讨论；旧讨论会话不被结束。
    onNewConversation: () => {
      state.newConversation();
    },
    onOpenDiscussion: openDiscussion,
    onDeleteDiscussion: deleteDiscussion,
    onRemoveDirectQuestionSelection: () => state.removePendingSelection(),
    onDirectQuestionFocus: () => syncPendingSelection(),
    onOpenPanel: () => syncPendingSelection(),
  };
}

/**
 * 把常驻会话传输层、按讨论隔离的单请求协调器、生成桥接、讨论档案与面板状态接入编辑器。
 *
 * 模块边界（零写回）：本模块不持有 `saveProject`、编辑器 DOM 写入函数或任何“应用到正文”
 * 回调。生成只提交问题与选区原文，结果只显示在独立面板里；讨论档案由受控命令写入作品文件夹。
 */
export function setupAiFeature(
  dom: AppDom,
  hooks: AiFeatureHooks,
  dependencies: AiFeatureDependencies = {},
): AiFeatureController {
  const getCurrentProjectPath = hooks.getCurrentProjectPath ?? (() => null);
  const getCurrentDocumentTitle = hooks.getCurrentDocumentTitle ?? (() => null);
  const newConversationId = dependencies.newConversationId ?? generateConversationId;
  const state = new AiPanelState(() => {}, newConversationId);
  let projectToken = 0;
  const loadConfig = dependencies.loadConfig ?? loadLlmConfig;
  const transport = dependencies.transport ?? aiSessionTransport;
  const listConversations = dependencies.conversationList ?? conversationList;
  const saveConversation = dependencies.conversationSave ?? conversationSave;
  const deleteConversation = dependencies.conversationDelete ?? conversationDelete;
  const firstRequestPreflight: FirstRequestPreflightState = createPreflightGate();

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

  /** 从会话列表重开讨论：以已保存轮次重建显示数据并设为当前讨论。 */
  function openDiscussion(summary: ConversationSummary): void {
    const conversation = conversationFromRecord(summary);
    state.openDiscussion(conversation, summary.focus_document_id, summary.focus_document_title);
  }

  /** 删除讨论（独立动作）：结束其会话、移除内存记录与档案，失败对用户可见。 */
  async function deleteDiscussion(conversationId: string): Promise<void> {
    transport.endSession(conversationId);
    state.deleteDiscussion(conversationId);
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    try {
      await deleteConversation(projectPath, conversationId);
    } catch {
      state.setSaveError("删除讨论失败");
    }
  }

  /** 切换作品后加载新作品的讨论列表。 */
  function loadDiscussions(): void {
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    const token = projectToken;
    void listConversations(projectPath)
      .then((result) => {
        if (projectToken !== token) return;
        state.loadDiscussions(result.conversations, result.skipped);
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
        state.succeed(snapshot, content, conversationId);
        persistDiscussion(conversationId);
      },
      onError: (snapshot: SelectionSnapshot, error, conversationId: string) => {
        applyGenerateError(state, snapshot, error, conversationId);
        persistDiscussion(conversationId);
      },
      onStructuredSuccess: (content, identity) => {
        state.succeedFollowUp(identity.turnId ?? -1, content, identity.conversationId);
        persistDiscussion(identity.conversationId);
      },
      onStructuredError: (error, identity) => {
        if (error.code === "configuration_required") {
          state.requireFollowUpConfiguration(identity.turnId ?? -1, identity.conversationId);
        } else {
          state.failFollowUp(identity.turnId ?? -1, error, identity.conversationId);
        }
        persistDiscussion(identity.conversationId);
      },
      onDirectQuestionSuccess: (content, conversationId) => {
        state.succeedDirectQuestion(content, conversationId);
        persistDiscussion(conversationId);
      },
      onDirectQuestionError: (error, conversationId) => {
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
  const requestStructured: StructuredRequestSender = (request, identity) =>
    coordinator.requestStructured(request, identity);
  const requestDirectQuestion = (request: GenerateAiRequest) =>
    coordinator.requestDirectQuestion(request);

  const selectionEntry = setupSelectionEntry({
    dom,
    getCurrentDocumentId: hooks.getCurrentDocumentId,
    getCurrentEditor: hooks.getCurrentEditor as () => SelectionEntryEditor | null,
    isRequestInFlight: () => false,
    onSummon: (snapshot) => {
      const accepted = startSummon({
        state,
        snapshot,
        loadConfig,
        request: (request) => coordinator.request(snapshot, request),
        getProjectToken: () => projectToken,
        preflight: firstRequestPreflight,
        focusDocumentId: snapshot.documentId,
        focusDocumentTitle: getCurrentDocumentTitle(),
      });
      if (accepted) persistCurrentDiscussion();
    },
  });

  function syncPendingSelection(): void {
    const editor = hooks.getCurrentEditor();
    const documentId = hooks.getCurrentDocumentId();
    if (!editor || documentId === null) return;
    const snapshot = captureSelection(documentId, editor);
    state.setPendingSelection(isMeaningfulSelection(snapshot) ? snapshot : null);
  }

  function submitDirectQuestion(question: string): boolean {
    return startDirectQuestion({
      state,
      question,
      selection: state.view.pendingSelection,
      loadConfig,
      request: requestDirectQuestion,
      getProjectToken: () => projectToken,
      preflight: firstRequestPreflight,
      focusDocumentId: hooks.getCurrentDocumentId(),
      focusDocumentTitle: getCurrentDocumentTitle(),
    });
  }

  // 面板打开期间，编辑器选区变化会同步为待附带的重点材料（替换旧选区或清除）。
  const editorEventTypes = ["mouseup", "keyup", "select", "click", "input", "scroll"] as const;
  for (const eventType of editorEventTypes) {
    dom.editorTextarea.addEventListener(eventType, () => {
      if (state.isOpen) syncPendingSelection();
    });
  }

  // 常驻会话事件路由：流式增量推进面板状态；驱动丢失进入恢复流程。
  transport.installSessionEventRouting();
  transport.onStreamText((text) => {
    state.appendStreamText(text);
  });
  transport.onDriverLost(() => {
    const conversation = state.conversation;
    if (conversation === null) {
      transport.endAllSessions();
      return;
    }
    if (!state.beginRecovery()) return;
    transport.replaySession(conversation.id, historyTurnsOf(conversation), originOf(conversation))
      .then(() => {
        state.completeRecovery();
      })
      .catch(() => {
        state.failRecovery();
      });
  });

  setupAiPanel(dom.aiPanelDom, state, buildAiPanelActions({
    state,
    openConfigPage: hooks.openConfigPage,
    requestStructured,
    submitDirectQuestion,
    syncPendingSelection,
    persistCurrentDiscussion,
    openDiscussion,
    deleteDiscussion,
  }));

  function resetProjectScopedAi(): void {
    projectToken += 1;
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
  };
}
