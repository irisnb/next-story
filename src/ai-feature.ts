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
import type { ReadonlyTemporaryConversation } from "./ai-panel-conversation.ts";
import { AiRequestCoordinator, type RequestIdentity } from "./ai-request.ts";
import { setupAiPanel, type AiPanelActions } from "./ai-panel.ts";
import { captureSelection, isMeaningfulSelection } from "./selection-adapter.ts";
import { setupSelectionEntry, type SelectionEntryController, type SelectionEntryEditor } from "./selection-entry.ts";
import {
  aiSessionTransport,
  type AiReplayTurn,
  type AiSessionTransport,
} from "./ai-session-transport.ts";
import { loadLlmConfig } from "./project-api.ts";
import type {
  GenerateAiError,
  GenerateAiRequest,
  SelectionSnapshot,
} from "./types.ts";

export function applyGenerateError(
  state: AiPanelState,
  snapshot: SelectionSnapshot,
  error: GenerateAiError,
): void {
  if (error.code === "configuration_required") {
    state.requireConfiguration(snapshot);
    return;
  }
  state.fail(snapshot, error);
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
 * 把当前对话的显示历史投影为会话重放轮次（崩溃恢复用）。
 *
 * 首轮 user 文本 = "用户问题：\n{question}"，附带选区时追加
 * "\n\n重点参考材料（可选）：\n{selection}"；宿主会在其前面拼系统提示词。
 * 之后依次为 assistant 首轮回应与各成功追问轮次的 user/assistant 交替。
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
    // 召唤首轮只携带冻结的选区材料。
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

export interface AiFeatureHooks {
  getCurrentDocumentId: () => string | null;
  getCurrentEditor: () => SelectionEntryEditor | null;
  openConfigPage: () => void;
}

export interface AiFeatureController {
  /** 新作品进入编辑器：分配新作品令牌、结束常驻会话并清空面板状态。 */
  beginProject(): void;
  /** 作品卸载（返回欢迎页）：使在途请求失效、结束常驻会话并清空面板。 */
  endProject(): void;
  submitFollowUp(question: string): Promise<boolean>;
  retryFollowUp(): Promise<boolean>;
  editFollowUp(question: string): Promise<boolean>;
}

export interface AiFeatureDependencies {
  loadConfig?: typeof loadLlmConfig;
  /** 常驻会话传输层；默认用应用内共享单例，测试可注入假实现。 */
  transport?: AiSessionTransport;
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
  readonly endSession: () => void;
}

interface ProjectLifecycleWiring {
  readonly state: AiPanelState;
  readonly coordinator: AiRequestCoordinator;
  readonly nextProjectToken: () => void;
  readonly requestStructured: StructuredRequestSender;
  readonly endSession: () => void;
  readonly selectionEntry: SelectionEntryController;
}

function buildAiPanelActions(wiring: AiPanelWiring): AiPanelActions {
  const { state, openConfigPage, requestStructured, submitDirectQuestion, syncPendingSelection, endSession } = wiring;

  return {
    // 常驻会话首轮失败后不通过旧的一次性请求协调器重试。
    onRetry: () => {
      retryAcceptedRequest(state, () => null);
    },
    onGoToConfig: () => openAiConfiguration(openConfigPage),
    onSubmitFollowUp: async (question) => followUpAcceptedRequest(state, question, requestStructured),
    onRetryFollowUp: async () => retryFollowUpAcceptedRequest(state, requestStructured),
    onEditFollowUp: async (question) =>
      editAndResendFollowUpAcceptedRequest(state, question, requestStructured),
    onSubmitDirectQuestion: async (question) => submitDirectQuestion(question),
    // 新建对话：结束当前唯一的临时对话，同时结束常驻 AI 会话（会话记忆随之释放）。
    onNewConversation: () => {
      if (state.newConversation()) endSession();
    },
    onRemoveDirectQuestionSelection: () => state.removePendingSelection(),
    onDirectQuestionFocus: () => syncPendingSelection(),
    onOpenPanel: () => syncPendingSelection(),
  };
}

function buildAiFeatureController(wiring: ProjectLifecycleWiring): AiFeatureController {
  const { state, coordinator, nextProjectToken, requestStructured, endSession, selectionEntry } = wiring;

  function resetProjectScopedAi(): void {
    nextProjectToken();
    coordinator.releaseStaleRequestOwnership();
    selectionEntry.reset();
    endSession();
    state.reset();
  }

  return {
    beginProject(): void {
      resetProjectScopedAi();
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
  };
}

/**
 * 把常驻会话传输层、单请求协调器、生成桥接与面板状态接入编辑器。
 *
 * 模块边界（零写回）：本模块不持有 `saveProject`、编辑器 DOM 写入函数或任何“应用到正文”
 * 回调。生成只提交问题与选区原文，结果只显示在独立面板里。
 *
 * 选区召唤通过 selection-entry 接入常驻会话；思维扩展和浮动入口不再提供。
 */
export function setupAiFeature(
  dom: AppDom,
  hooks: AiFeatureHooks,
  dependencies: AiFeatureDependencies = {},
): AiFeatureController {
  const state = new AiPanelState();
  let projectToken = 0;
  const loadConfig = dependencies.loadConfig ?? loadLlmConfig;
  const transport = dependencies.transport ?? aiSessionTransport;
  const firstRequestPreflight: FirstRequestPreflightState = createPreflightGate();

  const coordinator = new AiRequestCoordinator(
    // 保留协调器的选区请求回调，统一复用首轮预检与请求生命周期。
    (selectedText: string) =>
      transport.sendViaResidentSession({ kind: "summon", selected_text: selectedText }),
    {
      onSuccess: (snapshot: SelectionSnapshot, content: string) => {
        state.succeed(snapshot, content);
      },
      onError: (snapshot: SelectionSnapshot, error) => {
        applyGenerateError(state, snapshot, error);
      },
      onStructuredSuccess: (content, identity) => {
        state.succeedFollowUp(identity.turnId ?? -1, content);
      },
      onStructuredError: (error, identity) => {
        if (error.code === "configuration_required") {
          state.requireFollowUpConfiguration(identity.turnId ?? -1);
        } else {
          state.failFollowUp(identity.turnId ?? -1, error);
        }
      },
      onDirectQuestionSuccess: (content) => {
        state.succeedDirectQuestion(content);
      },
      onDirectQuestionError: (error) => {
        if (error.code === "configuration_required") {
          state.requireDirectQuestionConfiguration();
        } else {
          state.failDirectQuestion(error);
        }
      },
    },
    () => projectToken,
    // 结构化生成接缝：全部经常驻会话传输层（首轮增量发送，追问只发新增问题）。
    (request) => transport.sendViaResidentSession(request),
    () => state.conversationIdentity,
  );
  const requestStructured: StructuredRequestSender = (request, identity) =>
    coordinator.requestStructured(request, identity);
  const requestDirectQuestion = (request: GenerateAiRequest) =>
    coordinator.requestDirectQuestion(request);

  const selectionEntry = setupSelectionEntry({
    dom,
    getCurrentDocumentId: hooks.getCurrentDocumentId,
    getCurrentEditor: hooks.getCurrentEditor as () => SelectionEntryEditor | null,
    isRequestInFlight: () => coordinator.busy,
    onSummon: (snapshot) => {
      startSummon({
        state,
        snapshot,
        loadConfig,
        request: (request) => coordinator.request(snapshot, request),
        getProjectToken: () => projectToken,
        preflight: firstRequestPreflight,
      });
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
      // 无对话：会话记忆本就为空，只重置传输层状态，不进恢复。
      transport.endActiveSession();
      return;
    }
    if (!state.beginRecovery()) return;
    transport.replayActiveSession(historyTurnsOf(conversation))
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
    endSession: () => transport.endActiveSession(),
  }));

  return buildAiFeatureController({
    state,
    coordinator,
    nextProjectToken: () => {
      projectToken += 1;
    },
    requestStructured,
    endSession: () => transport.endActiveSession(),
    selectionEntry,
  });
}
