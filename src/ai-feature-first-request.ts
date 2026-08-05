import type { AiPanelState } from "./ai-panel-state.ts";
import type { GenerateAiRequest, LlmConfig, SelectionSnapshot } from "./types.ts";

export interface FirstRequestPreflightState {
  pending: boolean;
}

export interface StartFirstRequestOptions {
  state: AiPanelState;
  snapshot: SelectionSnapshot;
  firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>;
  loadConfig: () => Promise<LlmConfig | null>;
  request: (
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
  ) => Promise<void> | null;
  preflight?: FirstRequestPreflightState;
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
  options.state.previewFirstRequest(options.snapshot, options.firstRequest);
  if (preflight) preflight.pending = true;
  void (async () => {
    try {
      const config = await options.loadConfig();
      if (!config) {
        options.state.beginRequest(options.snapshot, options.firstRequest);
        options.state.requireConfiguration(options.snapshot);
        return;
      }

      const accepted = options.request(options.snapshot, options.firstRequest);
      if (accepted === null) {
        options.state.blockFirstRequest(options.snapshot);
        return;
      }
      options.state.beginRequest(options.snapshot, options.firstRequest);
    } catch (error) {
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
