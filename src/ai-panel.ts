import type { AppDom } from "./dom.ts";
import { AiPanelScrollResetController } from "./ai-panel-scroll.ts";
import { AiPanelState } from "./ai-panel-state.ts";

export interface AiPanelActions {
  onRetry: () => void;
  onGoToConfig: () => void;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required AI panel element: #${id}`);
  }
  return el as T;
}

/**
 * 把面板状态渲染到右侧 AI 面板的 DOM。
 *
 * 所有回复、错误与选区文字都通过 `textContent` / `<pre>` 纯文本绑定，绝不解析 HTML 或
 * Markdown；面板不持有任何写入草稿本或正文本的回调。状态变化时由 `AiPanelState` 订阅触发重绘。
 */
export function setupAiPanel(
  dom: AppDom,
  state: AiPanelState,
  actions: AiPanelActions,
): void {
  const panel = dom.aiPanel;
  const panelBodyElement = panel.querySelector<HTMLElement>(".ai-panel-body");
  if (!panelBodyElement) {
    throw new Error("Missing required AI panel element: .ai-panel-body");
  }
  const panelBody: HTMLElement = panelBodyElement;
  const snapshotBlock = requireEl("ai-snapshot-block");
  const snapshotText = requireEl<HTMLPreElement>("ai-snapshot-text");
  const loading = requireEl("ai-loading");
  const response = dom.aiResponse;
  const errorBlock = requireEl("ai-error-block");
  const errorMessage = requireEl("ai-error-message");
  const retryBtn = requireEl<HTMLButtonElement>("ai-retry");
  const configBlock = requireEl("ai-config-block");
  const goConfigBtn = requireEl<HTMLButtonElement>("ai-go-config");
  const collapseBtn = requireEl<HTMLButtonElement>("ai-panel-collapse");
  const toggleBtn = dom.btnToggleAi;
  const scrollReset = new AiPanelScrollResetController();

  retryBtn.addEventListener("click", actions.onRetry);
  goConfigBtn.addEventListener("click", () => actions.onGoToConfig());
  collapseBtn.addEventListener("click", () => state.close());
  toggleBtn.addEventListener("click", () => {
    if (state.isOpen) {
      state.close();
    } else {
      state.open();
    }
  });

  function render(): void {
    panel.classList.toggle("hidden", !state.isOpen);
    const request = state.view.request;
    if (scrollReset.shouldReset(request)) {
      panelBody.scrollTop = 0;
      snapshotText.scrollTop = 0;
      response.scrollTop = 0;
    }

    const hasSnapshot =
      request.kind === "loading" ||
      request.kind === "success" ||
      request.kind === "error" ||
      request.kind === "configuration_required";

    snapshotBlock.classList.toggle("hidden", !hasSnapshot);
    if (hasSnapshot) {
      // 纯文本绑定：保留换行、可选择复制，不解析 HTML/Markdown
      snapshotText.textContent = request.snapshot.selectedText;
    }

    loading.classList.toggle("hidden", request.kind !== "loading");

    response.classList.toggle("hidden", request.kind !== "success");
    if (request.kind === "success") {
      response.textContent = request.response;
    }

    errorBlock.classList.toggle("hidden", request.kind !== "error");
    if (request.kind === "error") {
      errorMessage.textContent = request.error.message;
    }

    configBlock.classList.toggle("hidden", request.kind !== "configuration_required");

    // 面板展开时，header 的“收起”可用；可在任意状态下收起
    toggleBtn.textContent = state.isOpen ? "收起 AI" : "AI 面板";
  }

  state.subscribe(render);
  render();
}
