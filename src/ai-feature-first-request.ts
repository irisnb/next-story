import type { AiPanelState } from "./ai-panel-state.ts";
import type { GenerateAiRequest, LlmConfigSummary, SelectionSnapshot } from "./types.ts";

export interface FirstRequestPreflightState {
  pending: boolean;
}

export interface StartFirstRequestOptions {
  state: AiPanelState;
  snapshot: SelectionSnapshot;
  firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  request: (
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
  ) => Promise<void> | null;
  preflight?: FirstRequestPreflightState;
  /** 预检开始时冻结的作品令牌；每次 `await` 后重新校验，不符则丢弃本次预检结果。 */
  getProjectToken: () => number;
}

export function buildThinkingExpansionRequest(
  snapshot: SelectionSnapshot,
  direction: string,
): Extract<GenerateAiRequest, { kind: "first" }> {
  const trimmed = direction.trim();
  if (trimmed) {
    return {
      kind: "first",
      selected_text: snapshot.selectedText,
      thinking_direction: trimmed,
    };
  }
  return { kind: "first", selected_text: snapshot.selectedText };
}

export function startFirstRequest(options: StartFirstRequestOptions): boolean {
  const preflight = options.preflight;
  if (preflight?.pending) return false;
  // 预检开始时冻结作品身份：预检期间的任何异步窗口之后都要重新校验。
  const frozenToken = options.getProjectToken();
  options.state.previewFirstRequest(options.snapshot, options.firstRequest);
  if (preflight) preflight.pending = true;
  void (async () => {
    try {
      const config = await options.loadConfig();
      // 预检期间作品被切换：丢弃本次预检结果，不发送旧作品的选区快照。
      if (options.getProjectToken() !== frozenToken) return;
      if (!config) {
        options.state.beginRequest(options.snapshot, options.firstRequest);
        options.state.requireConfiguration(options.snapshot);
        return;
      }
      // 真正提交请求前再次校验作品身份（纵深防御；请求内部也会以当前令牌校验）。
      if (options.getProjectToken() !== frozenToken) return;
      const accepted = options.request(options.snapshot, options.firstRequest);
      if (accepted === null) {
        options.state.blockFirstRequest(options.snapshot);
        return;
      }
      options.state.beginRequest(options.snapshot, options.firstRequest);
    } catch (error) {
      // 预检失败但作品已切换：同样丢弃，避免旧作品错误污染新作品的 AI 面板。
      if (options.getProjectToken() !== frozenToken) return;
      options.state.fail(options.snapshot, {
        code: "network",
        message: preflightErrorMessage(error),
      });
    } finally {
      if (preflight) preflight.pending = false;
    }
  })();
  return true;
}

function preflightErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "AI 请求开始前发生异常。";
}
