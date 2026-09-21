import type { AppDom } from "./dom.ts";
import { startSummon } from "./ai-feature-first-round.ts";
import {
  editAndResendFollowUpAcceptedRequest,
  followUpAcceptedRequest,
  retryFollowUpAcceptedRequest,
} from "./ai-feature-follow-up.ts";
import { startDirectQuestion } from "./ai-feature-direct-question.ts";
import { setupOnDemandReadingInteractions } from "./ai-feature-on-demand-reading.ts";
import { setupDeleteUndo } from "./ai-feature-delete-undo.ts";
import type { AiFeatureContext } from "./ai-feature-context.ts";
import {
  setupAiRequestGateway,
  type StructuredRequestSender,
} from "./ai-feature-request-gateway.ts";
import { setupAiRequestLifecycle } from "./ai-feature-request-lifecycle.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import {
  buildDiscussionRecord,
  conversationFromRecord,
  isConversationRestrictedForRecovery,
  type ReadonlyTemporaryConversation,
} from "./ai-panel-conversation.ts";
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
  ResidentAiSessionTransport,
  type AiReplayOrigin,
  type AiReplayTurn,
  type AiSessionTransport,
} from "./ai-session-transport.ts";
import { loadLlmConfig, aiResolveReadingRequest, exportWaitTimingJson, waitTimingFileName } from "./project-api.ts";
import type { WaitTimingExportOutcome } from "./ai-dock.ts";
import { flattenDocuments } from "./content-tree.ts";
import { isDocumentAiVisible } from "./types.ts";
import {
  conversationDelete,
  conversationList,
  conversationOnDemandReading,
  conversationRestore,
  conversationSave,
  conversationSetOnDemandReading,
  generateConversationId,
  type ConversationSummary,
} from "./conversation-archive.ts";
import type {
  ContentTree,
} from "./types.ts";

// 错误终态分流规则已随请求网关迁移（coordinator 回调使用）；首轮重试规则已随
// 请求生命周期迁移。此处重导出保持既有消费方（测试与外部调用）的导入路径稳定。
export { applyGenerateError } from "./ai-feature-request-gateway.ts";
export { retryAcceptedRequest } from "./ai-feature-request-lifecycle.ts";

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
  destroy(): void;
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
   * 用户对按需补读授权请求的决定回填（任务 7.1）：允许 → 后端写授权并继续原问题；
   * 拒绝 → 有限回答。
   */
  resolveReadingRequest?: typeof aiResolveReadingRequest;
  /** 讨论内授权开关（任务 7.2）：开启 / 关闭按需补读授权。 */
  setOnDemandReading?: typeof conversationSetOnDemandReading;
  /** 读取指定讨论的按需补读状态（任务 7.4 显示刷新）。 */
  fetchOnDemandReading?: typeof conversationOnDemandReading;
  /**
   * 集成点（controlled-story-read-visibility）：返回当前作品下「不允许 AI 查看」的
   * 文档 ID 集合。后端可见性 API 就绪后由其实名实现注入；未接入时缺省返回空集，
   * 不引入任何受限行为（旧档案缺出处的保守受限仍生效）。
   */
  getHiddenDocumentIds?: () => ReadonlySet<string>;
  /** 等待计时导出（app-real-chain-validation 任务 1.4）：保存对话框 + 落盘。 */
  exportWaitTimingJson?: typeof exportWaitTimingJson;
}

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
  /** 停止后的追问重试（extract-ai-request-orchestration 组 5：实现在生命周期模块）。 */
  readonly retryStoppedFollowUp: () => Promise<boolean>;
  readonly renameDiscussion: (conversationId: string, title: string) => Promise<boolean>;
  readonly togglePin: (conversationId: string) => Promise<boolean>;
  readonly undoDelete: () => void;
  readonly getUndoNotice: () => { title: string } | null;
  readonly switchFocusDocument: (conversationId: string, documentId: string, documentTitle: string) => void;
  readonly getVisibleDocuments: () => ReadonlyArray<{ id: string; name: string }>;
  readonly resolveDocumentTitle: (documentId: string) => string | null;
  readonly isDocumentHidden: (documentId: string) => boolean;
  readonly resolveReadingRequest: (conversationId: string, granted: boolean) => void;
  readonly toggleOnDemandReading: (conversationId: string, granted: boolean) => void;
  /** 是否有任何等待计时记录（历史全量 + 当前在途）。 */
  readonly hasWaitTimingData: () => boolean;
  /** 导出等待计时数据（保存对话框 + 落盘），结果折算成停靠区提示。 */
  readonly exportWaitTiming: () => Promise<WaitTimingExportOutcome>;
  /** 清空等待计时数据（内存记录）。 */
  readonly clearWaitTiming: () => void;
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
    retryStoppedFollowUp,
    renameDiscussion,
    togglePin,
    undoDelete,
    getUndoNotice,
    switchFocusDocument,
    getVisibleDocuments,
    resolveDocumentTitle,
    isDocumentHidden,
    resolveReadingRequest,
    toggleOnDemandReading,
    hasWaitTimingData,
    exportWaitTiming,
    clearWaitTiming,
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
    // 停止后的追问重试：实现已迁至 ai-feature-request-lifecycle.ts（组 5）。
    onRetryStoppedFollowUp: retryStoppedFollowUp,
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
    onSwitchFocusDocument: switchFocusDocument,
    getVisibleDocuments,
    resolveDocumentTitle,
    isDocumentHidden,
    onResolveReadingRequest: resolveReadingRequest,
    onToggleOnDemandReading: toggleOnDemandReading,
    hasWaitTimingData,
    exportWaitTiming,
    clearWaitTiming,
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
  // 传输层默认实例（design D7）：注入作品路径访问器，发送时携带讨论身份供后端
  // 注册按需补读工具路由（访问器逐次现取，context 装配后才会被调用）。
  const transport =
    dependencies.transport ??
    new ResidentAiSessionTransport({ getCurrentProjectPath: () => context.getCurrentProjectPath() });
  const listConversations = dependencies.conversationList ?? conversationList;
  const saveConversation = dependencies.conversationSave ?? conversationSave;
  const deleteConversation = dependencies.conversationDelete ?? conversationDelete;
  const restoreConversation = dependencies.conversationRestore ?? conversationRestore;
  const resolveReadingRequestCall = dependencies.resolveReadingRequest ?? aiResolveReadingRequest;
  const setOnDemandReadingCall =
    dependencies.setOnDemandReading ?? conversationSetOnDemandReading;
  const fetchOnDemandReadingCall =
    dependencies.fetchOnDemandReading ?? conversationOnDemandReading;
  // 集成点：后端可见性 API 未接入时返回空集（无受限）；就绪后注入真实实现。
  const getHiddenDocumentIds = dependencies.getHiddenDocumentIds ?? (() => new Set<string>());
  const hiddenDocumentIds = (): ReadonlySet<string> => getHiddenDocumentIds();
  // 等待计时导出（任务 1.4）：默认走真实保存对话框 + 后端命令；测试注入假实现。
  const exportWaitTimingCall = dependencies.exportWaitTimingJson ?? exportWaitTimingJson;
  let destroyed = false;

  // ===== AiFeatureContext：访问器式上下文（extract-ai-request-orchestration 组 3） =====
  // 8 个核心绑定＋只读依赖收拢为显式传参的上下文（design D2）：字段一律访问器
  // 函数（禁快照），每次使用时现取闭包当前值。getScheduler / getCoordinator 经
  // 网关惰性读取（网关在本上下文之后装配，其内部构造不触发这两个访问器）；
  // getSelectionEntry / getAiDock 同理引用稍后才初始化的绑定——调用只发生在
  // 装配完成后，与既有闭包语义一致。

  const context: AiFeatureContext = {
    state,
    getProjectToken: () => projectToken,
    advanceProjectToken: () => {
      projectToken += 1;
    },
    isDestroyed: () => destroyed,
    markDestroyed: () => {
      destroyed = true;
    },
    getTransport: () => transport,
    getScheduler: () => gateway.scheduler,
    getCoordinator: () => gateway.coordinator,
    getSelectionEntry: () => selectionEntry,
    getAiDock: () => aiDock,
    loadConfig,
    getCurrentProjectPath,
    getCurrentDocumentTitle,
    getCurrentTree,
    getCurrentDocumentVersion,
    getCurrentDocumentId: hooks.getCurrentDocumentId,
    getCurrentEditor: hooks.getCurrentEditor,
    hiddenDocumentIds,
  };

  /** 保存指定讨论：接受即存（pending），终态原子更新；失败对用户可见。 */
  function persistDiscussion(conversationId: string | null): void {
    if (conversationId === null) return;
    const projectPath = context.getCurrentProjectPath();
    if (projectPath === null) return;
    const discussion = context.state.getDiscussion(conversationId);
    if (discussion === null) return;
    if (discussion.conversation === null && discussion.pendingFirstRequest === null) return;
    const record = buildDiscussionRecord(discussion);
    const token = context.getProjectToken();
    void saveConversation(projectPath, record)
      .then(() => {
        if (!context.isDestroyed() && context.getProjectToken() === token) context.state.clearSaveError();
      })
      .catch(() => {
        if (!context.isDestroyed() && context.getProjectToken() === token) {
          context.state.setSaveError("讨论保存失败，本次内容可能未落盘");
        }
      });
  }

  function persistCurrentDiscussion(): void {
    persistDiscussion(context.state.activeConversationId);
  }

  /**
   * 权限变更后：按当前作品可见性重算各打开讨论的材料限制并锁存（任务 5.2/5.4）。
   * 新被标记受限的讨论立即持久化，使锁存状态在重新开启可见性后重开也不被解除。
   */
  function recomputeRestrictions(): void {
    const newlyRestricted = context.state.recomputeRestrictions(context.hiddenDocumentIds());
    for (const conversationId of newlyRestricted) {
      persistDiscussion(conversationId);
    }
  }

  function openDiscussion(summary: ConversationSummary): void {
    const conversation = conversationFromRecord(summary, {
      hiddenDocumentIds: context.hiddenDocumentIds(),
    });
    context.state.openDiscussion(conversation, summary.focus_document_id, summary.focus_document_title);
  }

  /** 当前作品允许 AI 查看的文档（供「切换关注文档」选择器；隐藏与回收站文档不出现）。 */
  function visibleDocuments(): Array<{ id: string; name: string }> {
    const tree = context.getCurrentTree();
    if (!tree) return [];
    return flattenDocuments(tree)
      .filter((node) => isDocumentAiVisible(node))
      .map((node) => ({ id: node.id, name: node.name }));
  }

  /** 按文档 ID 解析当前作品中的文档标题；未知返回 null（显示层回退为「文档已不可用」）。 */
  function resolveDocumentTitle(documentId: string): string | null {
    const node = context.getCurrentTree()?.nodes[documentId];
    return node && node.kind === "Document" ? node.name : null;
  }

  /**
   * 显式切换某讨论的关注文档（任务 3.3）：查看其他文档不会自动改绑，只有本动作改绑；
   * 从下一轮起生效，并立即持久化关注对象。受限讨论由状态层拒绝改绑。
   */
  function switchFocusDocument(
    conversationId: string,
    documentId: string,
    documentTitle: string,
  ): void {
    if (context.state.setFocusDocument(conversationId, documentId, documentTitle)) {
      persistDiscussion(conversationId);
    }
  }

  // ===== 按需补读授权交互（add-agent-on-demand-reading 任务 7.1/7.2/7.4） =====
  // 提取至 ai-feature-on-demand-reading.ts（extract-ai-logic-seams 第一刀）：
  // 显式依赖参数注入，访问器逐次求值（无快照化，design D6）。

  const {
    refreshOnDemandState,
    resolveReadingRequest,
    toggleOnDemandReading,
  } = setupOnDemandReadingInteractions({
    state: context.state,
    getCurrentProjectPath: context.getCurrentProjectPath,
    getProjectToken: context.getProjectToken,
    isDestroyed: context.isDestroyed,
    fetchOnDemandReading: fetchOnDemandReadingCall,
    resolveReadingRequest: resolveReadingRequestCall,
    setOnDemandReading: setOnDemandReadingCall,
  });

  // ===== 删除＋撤销机制 =====
  // 提取至 ai-feature-delete-undo.ts（extract-ai-logic-seams 第二刀）：显式依赖
  // 参数注入，访问器逐次求值（无快照化，design D6）。clearUndo 在
  // resetProjectScopedAi / destroy 的原位置调用，清理步骤不重排。

  const {
    clearUndo,
    getUndoNotice,
    undoDelete,
    deleteDiscussion,
  } = setupDeleteUndo({
    state: context.state,
    getCurrentProjectPath: context.getCurrentProjectPath,
    isDestroyed: context.isDestroyed,
    cancelMessage: (conversationId) => context.getTransport().cancelMessage(conversationId),
    endSession: (conversationId) => context.getTransport().endSession(conversationId),
    cancelQueued: (conversationId) => context.getScheduler().cancelQueued(conversationId),
    restoreConversation,
    saveConversation,
    deleteConversation,
    reloadDiscussions: loadDiscussions,
  });

  /** 重命名讨论：更新内存标题并持久化到档案。 */
  async function renameDiscussion(conversationId: string, title: string): Promise<boolean> {
    if (!context.state.renameDiscussion(conversationId, title)) return false;
    persistDiscussion(conversationId);
    return true;
  }

  /** 置顶 / 取消置顶讨论：更新内存标记并持久化。 */
  async function togglePin(conversationId: string): Promise<boolean> {
    const discussion = context.state.getDiscussion(conversationId);
    if (!discussion?.conversation) return false;
    if (!context.state.setDiscussionPinned(conversationId, !(discussion.conversation.pinned ?? false))) {
      return false;
    }
    persistDiscussion(conversationId);
    return true;
  }

  function loadDiscussions(): void {
    const projectPath = context.getCurrentProjectPath();
    if (projectPath === null) return;
    const token = context.getProjectToken();
    void listConversations(projectPath)
      .then((result) => {
        if (context.isDestroyed() || context.getProjectToken() !== token) return;
        context.state.loadDiscussions(result.conversations, result.skipped, context.hiddenDocumentIds());
        if (result.skipped.length > 0) {
          context.state.setSaveError(`有 ${result.skipped.length} 个讨论档案无法读取，已跳过`);
        }
      })
      .catch(() => {
        if (context.isDestroyed() || context.getProjectToken() !== token) return;
        context.state.setSaveError("读取讨论列表失败");
      });
  }

  // ===== 请求网关（extract-ai-request-orchestration 组 4） =====
  // 全部请求派发（召唤 / 追问 / 直接提问）、调度器与协调器构造、六个终态回调
  // （尾部四连：waitTiming.complete → state 迁移 → persist → refreshOnDemand）
  // 已提取至 ai-feature-request-gateway.ts。组合根只负责装配与注入回调入口。

  const gateway = setupAiRequestGateway({
    context,
    ...(dependencies.maxConcurrent !== undefined
      ? { maxConcurrent: dependencies.maxConcurrent }
      : {}),
    persistDiscussion,
    refreshOnDemandState,
  });

  const {
    requestStructured,
    requestSummon,
    requestDirectQuestion,
  } = gateway;

  const selectionEntry = setupSelectionEntry({
    dom,
    getCurrentDocumentId: context.getCurrentDocumentId,
    getCurrentEditor: context.getCurrentEditor,
    isRequestInFlight: () => false,
    isCurrentDocumentAiVisible: () => {
      const documentId = context.getCurrentDocumentId();
      return documentId !== null && checkSelectionVisibility(context.getCurrentTree(), {
        documentId,
        selectedText: "selection",
        from: 0,
        to: 0,
      }).allowed;
    },
    getSelectionIdentity: () => ({
      projectPath: context.getCurrentProjectPath() ?? undefined,
      documentVersion: context.getCurrentDocumentVersion() ?? undefined,
    }),
    onSummon: (snapshot) => {
      const accepted = startSummon({
        state: context.state,
        snapshot,
        loadConfig: context.loadConfig,
        request: (request) => {
          const conversationId = context.state.activeConversationId;
          if (conversationId === null) return Promise.resolve();
          return requestSummon(conversationId, snapshot, request);
        },
        getProjectToken: context.getProjectToken,
        focusDocumentId: snapshot.documentId,
        focusDocumentTitle: context.getCurrentDocumentTitle(),
        checkSelectionAllowed: (selection) => authorizeSelection(selection, {
          projectPath: context.getCurrentProjectPath(),
          documentVersion: context.getCurrentDocumentVersion(),
          hiddenDocumentIds: context.hiddenDocumentIds(),
        }, context.getCurrentTree()),
      });
      if (accepted) persistCurrentDiscussion();
    },
  });

  function syncPendingSelection(): void {
    const editor = context.getCurrentEditor();
    const documentId = context.getCurrentDocumentId();
    if (!editor || documentId === null) return;
    const snapshot = captureSelection(documentId, editor, {
      projectPath: context.getCurrentProjectPath() ?? undefined,
      documentVersion: context.getCurrentDocumentVersion() ?? undefined,
    });
    context.state.setPendingSelection(isMeaningfulSelection(snapshot) ? snapshot : null);
  }

  function submitDirectQuestion(question: string): boolean {
    return startDirectQuestion({
      state: context.state,
      question,
      selection: context.state.view.pendingSelection,
      loadConfig: context.loadConfig,
      request: (request) => {
        const conversationId = context.state.activeConversationId;
        if (conversationId === null) return Promise.resolve();
        return requestDirectQuestion(conversationId, request);
      },
      getProjectToken: context.getProjectToken,
      focusDocumentId: context.getCurrentDocumentId(),
      focusDocumentTitle: context.getCurrentDocumentTitle(),
      checkSelectionAllowed: (selection) => authorizeSelection(selection, {
        projectPath: context.getCurrentProjectPath(),
        documentVersion: context.getCurrentDocumentVersion(),
        hiddenDocumentIds: context.hiddenDocumentIds(),
      }, context.getCurrentTree()),
    });
  }

  // ===== 请求生命周期（extract-ai-request-orchestration 组 5） =====
  // 停止 / 关闭 / 首轮重试 / 停止后追问重试的编排规则已提取至
  // ai-feature-request-lifecycle.ts（停止与关闭共享同构前缀，尾部步骤逐条对照）。

  const {
    stopGeneration,
    closeWindow,
    retryFirstRound,
    retryStoppedFollowUp,
  } = setupAiRequestLifecycle({
    context,
    persistDiscussion,
    persistCurrentDiscussion,
    requestStructured,
    requestSummon,
    requestDirectQuestion,
  });

  // 面板打开期间，编辑器选区变化会同步为待附带的重点材料（替换旧选区或清除）。
  const editorEventTypes = ["mouseup", "keyup", "select", "click", "input", "scroll"] as const;
  const handleEditorSelectionEvent = (): void => {
    if (!context.isDestroyed() && context.state.isOpen) syncPendingSelection();
  };
  for (const eventType of editorEventTypes) {
    dom.editorTextarea.addEventListener(eventType, handleEditorSelectionEvent);
  }

  // 常驻会话事件路由：流式增量按讨论身份推进对应讨论状态；驱动丢失进入恢复流程。
  transport.installSessionEventRouting();
  const unsubscribeStreamText = transport.onStreamText(({ conversationId, text }) => {
    if (context.isDestroyed()) return;
    waitTiming.firstResponse(conversationId);
    context.state.appendStreamText(conversationId, text);
  });
  // 按需补读授权请求（任务 7.1）：显示授权卡，该轮挂起等待用户决定。
  const unsubscribeReadingRequest = transport.onReadingRequest(({ conversationId, sessionId, messageId, callId, reason }) => {
    if (context.isDestroyed()) return;
    context.state.receiveReadingRequest(conversationId, { sessionId, messageId, callId, reason });
  });
  // 工具调用轻量过程（任务 7.3）：驱动「正在搜索 / 正在阅读」状态行；不展示模型
  // 内部推理，也不携带任何作品数据。
  const unsubscribeToolCall = transport.onToolCall(({ conversationId, tool, args }) => {
    if (context.isDestroyed()) return;
    const documentId =
      typeof args.document_id === "string" && args.document_id !== "" ? args.document_id : undefined;
    context.state.noteToolCall(conversationId, tool, documentId);
  });
  const unsubscribeDriverLost = transport.onDriverLost(() => {
    if (context.isDestroyed()) return;
    // 驱动进程丢失：所有会话失效，在途请求作废；对每个打开窗口的讨论执行重放恢复。
    context.getCoordinator().releaseStaleRequestOwnership();
    const recoverable = [...context.state.windows.keys()].filter((id) => {
      const discussion = context.state.getDiscussion(id);
      return (
        discussion !== null &&
        discussion.conversation !== null &&
        // 材料权限受限的讨论不得把显示历史重放给 DSH（保留面板历史，不重建可继续上下文）。
        // 按当前 hiddenDocumentIds 重算：打开后新隐藏的来源文档也会被拦下，不重放。
        !isConversationRestrictedForRecovery(discussion.conversation, context.hiddenDocumentIds())
      );
    });
    if (recoverable.length === 0) {
      context.getTransport().endAllSessions();
      return;
    }
    for (const conversationId of recoverable) {
      const discussion = context.state.getDiscussion(conversationId)!;
      if (!context.state.beginRecovery(conversationId)) continue;
      context.getTransport().replaySession(
        conversationId,
        historyTurnsOf(discussion.conversation!),
        originOf(discussion.conversation!),
      )
        .then(() => {
          if (context.isDestroyed()) return;
          context.state.completeRecovery(conversationId);
        })
        .catch(() => {
          if (context.isDestroyed()) return;
          context.state.failRecovery(conversationId);
        });
    }
  });

  // 编辑器头「AI 面板」按钮：切换停靠区展开/收起。
  const handleToggleAi = (): void => {
    if (context.isDestroyed()) return;
    if (context.state.isOpen) context.state.close();
    else context.state.open();
  };
  dom.btnToggleAi.addEventListener("click", handleToggleAi);

  // ===== 等待计时导出（app-real-chain-validation 任务 1.4 / design D2） =====
  // 数据只来自内存计时记录；写盘只发生在用户经系统对话框选择的位置，
  // 不读取也不触碰任何作品目录。清空只清内存，不影响已导出文件。
  function hasWaitTimingData(): boolean {
    return waitTiming.getRecords().length > 0;
  }

  async function exportWaitTiming(): Promise<WaitTimingExportOutcome> {
    const count = waitTiming.getRecords().length;
    const result = await exportWaitTimingCall(waitTiming.exportJson(), waitTimingFileName());
    return {
      ok: result.ok,
      cancelled: result.cancelled ?? false,
      count,
      ...(result.message !== null ? { message: result.message } : {}),
    };
  }

  function clearWaitTiming(): void {
    waitTiming.clear();
  }

  const aiDock = setupAiDock(dom.aiDock, context.state, buildAiDockActions({
    state: context.state,
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
    retryStoppedFollowUp,
    renameDiscussion,
    togglePin,
    undoDelete,
    getUndoNotice,
    switchFocusDocument,
    getVisibleDocuments: visibleDocuments,
    resolveDocumentTitle,
    isDocumentHidden: (documentId) => context.hiddenDocumentIds().has(documentId),
    resolveReadingRequest,
    toggleOnDemandReading,
    hasWaitTimingData,
    exportWaitTiming,
    clearWaitTiming,
  }));

  function resetProjectScopedAi(): void {
    context.advanceProjectToken();
    clearUndo();
    context.getCoordinator().releaseStaleRequestOwnership();
    context.getSelectionEntry().reset();
    context.getTransport().endAllSessions();
    context.state.reset();
  }

  function destroy(): void {
    if (context.isDestroyed()) return;
    context.markDestroyed();
    context.advanceProjectToken();
    clearUndo();
    context.getScheduler().cancelAllQueued();
    context.getCoordinator().releaseStaleRequestOwnership();
    context.getTransport().endAllSessions();
    context.getSelectionEntry().destroy();
    context.getAiDock().destroy();
    for (const eventType of editorEventTypes) {
      dom.editorTextarea.removeEventListener(eventType, handleEditorSelectionEvent);
    }
    dom.btnToggleAi.removeEventListener("click", handleToggleAi);
    unsubscribeStreamText();
    unsubscribeDriverLost();
    unsubscribeReadingRequest();
    unsubscribeToolCall();
    context.getTransport().destroySessionEventRouting();
    context.state.reset();
  }

  return {
    state: context.state,
    beginProject(): void {
      if (context.isDestroyed()) return;
      resetProjectScopedAi();
      loadDiscussions();
    },
    endProject(): void {
      if (context.isDestroyed()) return;
      resetProjectScopedAi();
    },
    submitFollowUp(question: string): Promise<boolean> {
      return Promise.resolve(followUpAcceptedRequest(context.state, question, requestStructured));
    },
    retryFollowUp(): Promise<boolean> {
      return Promise.resolve(retryFollowUpAcceptedRequest(context.state, requestStructured));
    },
    editFollowUp(question: string): Promise<boolean> {
      return Promise.resolve(editAndResendFollowUpAcceptedRequest(context.state, question, requestStructured));
    },
    getConversations(): ConversationSummary[] {
      return context.state.conversations;
    },
    openDiscussion,
    deleteDiscussion,
    recomputeRestrictions,
    destroy,
  };
}
