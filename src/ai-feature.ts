import type { AppDom } from "./dom.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import { AiRequestCoordinator } from "./ai-request.ts";
import { setupAiPanel } from "./ai-panel.ts";
import { setupSelectionEntry } from "./selection-entry.ts";
import { generateAiThinking } from "./project-api.ts";
import type { GenerateAiError, NotebookTab, SelectionSnapshot } from "./types.ts";

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
  state.beginRequest(snapshot);
  return true;
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
}

/**
 * 把选区入口、单请求协调器、生成桥接与面板状态接入编辑器。
 *
 * 模块边界（零写回）：本模块不持有 `saveProject`、编辑器 DOM 写入函数或任何“应用到正文”
 * 回调。生成只提交选区原文，结果只显示在独立面板里。
 */
export function setupAiFeature(dom: AppDom, hooks: AiFeatureHooks): AiFeatureController {
  const state = new AiPanelState();
  let projectToken = 0;

  const coordinator = new AiRequestCoordinator(
    (selectedText: string) => generateAiThinking(selectedText),
    {
      onSuccess: (snapshot: SelectionSnapshot, content: string) => {
        state.succeed(snapshot, content);
      },
      onError: (snapshot: SelectionSnapshot, error) => {
        applyGenerateError(state, snapshot, error);
      },
    },
    () => projectToken,
  );

  setupAiPanel(dom, state, {
    onRetry: () => {
      retryAcceptedRequest(state, (snapshot) => coordinator.request(snapshot));
    },
    onGoToConfig: () => hooks.openConfigPage("editor-page"),
  });

  setupSelectionEntry({
    dom,
    getCurrentNotebook: hooks.getCurrentNotebook,
    isRequestInFlight: () => coordinator.busy,
    onSummon: (snapshot: SelectionSnapshot) => {
      state.beginRequest(snapshot);
      coordinator.request(snapshot);
    },
  });

  return {
    beginProject(): void {
      projectToken += 1;
      state.reset();
    },
    endProject(): void {
      projectToken += 1;
      state.reset();
    },
  };
}
