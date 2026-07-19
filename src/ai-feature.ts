import type { AppDom } from "./dom.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import { AiRequestCoordinator } from "./ai-request.ts";
import { setupAiPanel } from "./ai-panel.ts";
import { setupSelectionEntry } from "./selection-entry.ts";
import { generateAiThinking } from "./project-api.ts";
import type {
  GenerateAiError,
  GenerateAiRequest,
  NotebookTab,
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
  request: (snapshot: SelectionSnapshot) => Promise<void> | null,
): boolean {
  const snapshot = state.retrySnapshot();
  if (!snapshot || request(snapshot) === null) {
    return false;
  }
  return state.acceptFirstRetry();
}

export function followUpAcceptedRequest(
  state: AiPanelState,
  question: string,
  request: (
    payload: GenerateAiRequest,
    identity: { conversationId: number; turnId: number },
  ) => Promise<void> | null,
): boolean {
  const turnId = state.beginFollowUp(question);
  const identity = state.conversationIdentity;
  const payload = state.followUpRequest();
  if (turnId === null || !identity || identity.turnId === undefined || !payload) return false;
  const accepted = request(payload, {
    conversationId: identity.conversationId,
    turnId: identity.turnId,
  });
  if (accepted === null) {
    state.cancelFollowUp(turnId);
    return false;
  }
  return true;
}

export function retryFollowUpAcceptedRequest(
  state: AiPanelState,
  request: (
    payload: GenerateAiRequest,
    identity: { conversationId: number; turnId: number },
  ) => Promise<void> | null,
): boolean {
  const payload = state.retryFollowUpRequest();
  const identity = state.conversationIdentity;
  if (!payload || !identity || identity.turnId === undefined) return false;
  const accepted = request(payload, {
    conversationId: identity.conversationId,
    turnId: identity.turnId,
  });
  if (accepted === null) return false;
  return state.acceptFollowUpRetry();
}

export function editAndResendFollowUpAcceptedRequest(
  state: AiPanelState,
  question: string,
  request: (
    payload: GenerateAiRequest,
    identity: { conversationId: number; turnId: number },
  ) => Promise<void> | null,
): boolean {
  const payload = state.followUpRequestForQuestion(question);
  const identity = state.conversationIdentity;
  if (!payload || !identity || identity.turnId === undefined) return false;
  const accepted = request(payload, {
    conversationId: identity.conversationId,
    turnId: identity.turnId,
  });
  if (accepted === null) {
    return false;
  }
  return state.acceptEditedFollowUp(question);
}

export function openAiConfiguration(
  openConfigPage: (returnPage: "editor-page") => void,
): void {
  openConfigPage("editor-page");
}

export interface AiFeatureHooks {
  getCurrentNotebook: () => NotebookTab;
  openConfigPage: (returnPage: "editor-page") => void;
}

export interface AiFeatureController {
  /** 新作品进入编辑器：分配新作品令牌并清空面板状态。 */
  beginProject(): void;
  /** 作品卸载（返回欢迎页）：使在途请求失效并清空面板。 */
  endProject(): void;
  submitFollowUp(question: string): boolean;
  retryFollowUp(): boolean;
  editFollowUp(question: string): boolean;
}

export interface AiFeatureDependencies {
  generate?: typeof generateAiThinking;
  setupEntry?: typeof setupSelectionEntry;
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
  const setupEntry = dependencies.setupEntry ?? setupSelectionEntry;

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
    },
    () => projectToken,
    (request) => generate(request),
    () => state.conversationIdentity,
  );

  setupAiPanel(dom, state, {
    onRetry: () => {
      retryAcceptedRequest(state, (snapshot) => coordinator.request(snapshot));
    },
    onGoToConfig: () => openAiConfiguration(hooks.openConfigPage),
    onSubmitFollowUp: (question) => followUpAcceptedRequest(
      state,
      question,
      (request, identity) => coordinator.requestStructured(request, identity),
    ),
    onRetryFollowUp: () => retryFollowUpAcceptedRequest(
      state,
      (request, identity) => coordinator.requestStructured(request, identity),
    ),
    onEditFollowUp: (question) => editAndResendFollowUpAcceptedRequest(
      state,
      question,
      (request, identity) => coordinator.requestStructured(request, identity),
    ),
  });

  const selectionEntry = setupEntry({
    dom,
    getCurrentNotebook: hooks.getCurrentNotebook,
    isRequestInFlight: () => coordinator.busy,
    onSummon: (snapshot: SelectionSnapshot) => {
      const accepted = coordinator.request(snapshot);
      if (accepted !== null) {
        state.beginRequest(snapshot);
      }
    },
  });

  return {
    beginProject(): void {
      projectToken += 1;
      selectionEntry.reset();
      state.reset();
    },
    endProject(): void {
      projectToken += 1;
      selectionEntry.reset();
      state.reset();
    },
    submitFollowUp(question: string): boolean {
      return followUpAcceptedRequest(state, question, (request, identity) =>
        coordinator.requestStructured(request, identity),
      );
    },
    retryFollowUp(): boolean {
      return retryFollowUpAcceptedRequest(state, (request, identity) =>
        coordinator.requestStructured(request, identity),
      );
    },
    editFollowUp(question: string): boolean {
      return editAndResendFollowUpAcceptedRequest(state, question, (request, identity) =>
        coordinator.requestStructured(request, identity),
      );
    },
  };
}
