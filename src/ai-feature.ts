import type { AppDom } from "./dom.ts";
import {
  buildThinkingExpansionRequest,
  createPreflightGate,
  startFirstRequest,
  type FirstRequestPreflightState,
} from "./ai-feature-first-request.ts";
import {
  editAndResendFollowUpAcceptedRequest,
  followUpAcceptedRequest,
  retryFollowUpAcceptedRequest,
} from "./ai-feature-follow-up.ts";
import { startDirectQuestion } from "./ai-feature-direct-question.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import { AiRequestCoordinator, type RequestIdentity } from "./ai-request.ts";
import { setupAiPanel, type AiPanelActions } from "./ai-panel.ts";
import {
  setupSelectionEntry,
  type SelectionEntryController,
  type SelectionEntryEditor,
} from "./selection-entry.ts";
import { captureSelection, isMeaningfulSelection } from "./selection-adapter.ts";
import { generateAiThinking, loadLlmConfig } from "./project-api.ts";
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
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
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

export interface AiFeatureHooks {
  getCurrentDocumentId: () => string | null;
  getCurrentEditor: () => SelectionEntryEditor | null;
  openConfigPage: () => void;
}

export interface AiFeatureController {
  /** 新作品进入编辑器：分配新作品令牌并清空面板状态。 */
  beginProject(): void;
  /** 作品卸载（返回欢迎页）：使在途请求失效并清空面板。 */
  endProject(): void;
  /** 编辑器本子切换：只清空当前浮动选区入口，不影响 AI 面板对话。 */
  resetSelectionEntry(): void;
  submitFollowUp(question: string): Promise<boolean>;
  retryFollowUp(): Promise<boolean>;
  editFollowUp(question: string): Promise<boolean>;
}

export interface AiFeatureDependencies {
  generate?: typeof generateAiThinking;
  loadConfig?: typeof loadLlmConfig;
  setupEntry?: typeof setupSelectionEntry;
}

type FirstRequestStarter = (
  snapshot: SelectionSnapshot,
  firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
) => boolean;

type StructuredRequestSender = (
  request: GenerateAiRequest,
  identity: RequestIdentity,
) => Promise<void> | null;

interface AiPanelWiring {
  readonly state: AiPanelState;
  readonly openConfigPage: AiFeatureHooks["openConfigPage"];
  readonly requestFirst: FirstRequestStarter;
  readonly requestStructured: StructuredRequestSender;
  readonly submitDirectQuestion: (question: string) => boolean;
  readonly syncPendingSelection: () => void;
}

interface SelectionEntryWiring {
  readonly dom: AppDom;
  readonly getCurrentDocumentId: AiFeatureHooks["getCurrentDocumentId"];
  readonly getCurrentEditor: AiFeatureHooks["getCurrentEditor"];
  readonly coordinator: AiRequestCoordinator;
  readonly state: AiPanelState;
  readonly requestFirst: FirstRequestStarter;
  readonly setupEntry: typeof setupSelectionEntry;
}

interface ProjectLifecycleWiring {
  readonly state: AiPanelState;
  readonly coordinator: AiRequestCoordinator;
  readonly selectionEntry: SelectionEntryController;
  readonly nextProjectToken: () => void;
  readonly requestStructured: StructuredRequestSender;
}

function buildAiPanelActions(wiring: AiPanelWiring): AiPanelActions {
  const { state, openConfigPage, requestFirst, requestStructured, submitDirectQuestion, syncPendingSelection } = wiring;

  return {
    onRetry: () => {
      retryAcceptedRequest(state, (snapshot, firstRequest) =>
        requestFirst(snapshot, firstRequest) ? Promise.resolve() : null);
    },
    onGoToConfig: () => openAiConfiguration(openConfigPage),
    onStartThinkingExpansion: (direction) => {
      const current = state.view.request;
      if (current.kind !== "thinking_expansion" || current.snapshot === null) return false;
      return requestFirst(
        current.snapshot,
        buildThinkingExpansionRequest(current.snapshot, direction),
      );
    },
    onSubmitFollowUp: async (question) => followUpAcceptedRequest(state, question, requestStructured),
    onRetryFollowUp: async () => retryFollowUpAcceptedRequest(state, requestStructured),
    onEditFollowUp: async (question) =>
      editAndResendFollowUpAcceptedRequest(state, question, requestStructured),
    onSubmitDirectQuestion: async (question) => submitDirectQuestion(question),
    onRemoveDirectQuestionSelection: () => state.removePendingSelection(),
    onDirectQuestionFocus: () => syncPendingSelection(),
    onOpenPanel: () => syncPendingSelection(),
  };
}

function setupSelectionEntryCallbacks(wiring: SelectionEntryWiring): SelectionEntryController {
  const { dom, getCurrentDocumentId, getCurrentEditor, coordinator, state, requestFirst, setupEntry } = wiring;

  return setupEntry({
    dom,
    getCurrentDocumentId,
    getCurrentEditor,
    isRequestInFlight: () => coordinator.busy,
    onSummon: (snapshot: SelectionSnapshot) => {
      requestFirst(snapshot);
    },
    onThinkingExpansion: (snapshot: SelectionSnapshot) => {
      if (coordinator.busy) return;
      state.beginThinkingExpansion(snapshot);
    },
  });
}

function buildAiFeatureController(wiring: ProjectLifecycleWiring): AiFeatureController {
  const { state, coordinator, selectionEntry, nextProjectToken, requestStructured } = wiring;

  function resetProjectScopedAi(): void {
    nextProjectToken();
    coordinator.releaseStaleRequestOwnership();
    selectionEntry.reset();
    state.reset();
  }

  return {
    beginProject(): void {
      resetProjectScopedAi();
    },
    endProject(): void {
      resetProjectScopedAi();
    },
    resetSelectionEntry(): void {
      selectionEntry.reset();
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
 * 把选区入口、单请求协调器、生成桥接与面板状态接入编辑器。
 *
 * 模块边界（零写回）：本模块不持有 `saveProject`、编辑器 DOM 写入函数或任何“应用到正文”
 * 回调。生成只提交选区原文，结果只显示在独立面板里。
 */
export function setupAiFeature(
  dom: AppDom,
  hooks: AiFeatureHooks,
  dependencies: AiFeatureDependencies = {},
): AiFeatureController {
  const state = new AiPanelState();
  let projectToken = 0;
  const generate = dependencies.generate ?? generateAiThinking;
  const loadConfig = dependencies.loadConfig ?? loadLlmConfig;
  const setupEntry = dependencies.setupEntry ?? setupSelectionEntry;
  const firstRequestPreflight: FirstRequestPreflightState = createPreflightGate();

  const coordinator = new AiRequestCoordinator(
    (selectedText: string) =>
      generate({ kind: "first", selected_text: selectedText }),
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
    (request) => generate(request),
    () => state.conversationIdentity,
  );
  const requestStructured: StructuredRequestSender = (request, identity) =>
    coordinator.requestStructured(request, identity);
  const requestDirectQuestion = (request: GenerateAiRequest) =>
    coordinator.requestDirectQuestion(request);

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

  function requestFirst(
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
  ): boolean {
    return startFirstRequest({
      state,
      snapshot,
      firstRequest,
      loadConfig,
      request: (requestSnapshot, requestPayload) =>
        coordinator.request(requestSnapshot, requestPayload),
      preflight: firstRequestPreflight,
      // 预检开始时冻结作品令牌；预检期间切换作品会丢弃本次预检。
      getProjectToken: () => projectToken,
    });
  }

  setupAiPanel(dom.aiPanelDom, state, buildAiPanelActions({
    state,
    openConfigPage: hooks.openConfigPage,
    requestFirst,
    requestStructured,
    submitDirectQuestion,
    syncPendingSelection,
  }));

  const selectionEntry = setupSelectionEntryCallbacks({
    dom,
    getCurrentDocumentId: hooks.getCurrentDocumentId,
    getCurrentEditor: hooks.getCurrentEditor,
    coordinator,
    state,
    requestFirst,
    setupEntry,
  });

  return buildAiFeatureController({
    state,
    coordinator,
    selectionEntry,
    nextProjectToken: () => {
      projectToken += 1;
    },
    requestStructured,
  });
}
