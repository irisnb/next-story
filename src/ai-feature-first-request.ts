import type { AiPanelState } from "./ai-panel-state.ts";
import type { GenerateAiRequest, LlmConfigSummary, SelectionSnapshot } from "./types.ts";

/**
 * 首轮流程（选区召唤 / 思维扩展 / 直接提问）共享的 operation 门禁。
 *
 * 以「持有者作品令牌」为 owner：同作品互斥，新作品可取代旧 owner，
 * 且只有 owner 能在 finally 释放。这样作品 A 的迟到 finally 不会误释放
 * 作品 B 当前持有的预检门禁。
 */
export interface FirstRequestPreflightState {
  /** 当前持有门禁的作品令牌；null 表示空闲。 */
  owner: number | null;
}

export function createPreflightGate(): FirstRequestPreflightState {
  return { owner: null };
}

/** 尝试占用门禁：同作品已持有则拒绝；空闲或不同作品（新作品取代旧 owner）则占用。 */
export function acquirePreflight(gate: FirstRequestPreflightState, token: number): boolean {
  if (gate.owner === token) return false;
  gate.owner = token;
  return true;
}

/** 释放门禁：只有当前 owner 能释放；非 owner（如被取代的旧作品）释放无效。 */
export function releasePreflight(gate: FirstRequestPreflightState, token: number): void {
  if (gate.owner === token) gate.owner = null;
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
  // 预检开始时冻结作品身份：预检期间的任何异步窗口之后都要重新校验。
  const frozenToken = options.getProjectToken();
  if (preflight && !acquirePreflight(preflight, frozenToken)) return false;
  options.state.previewFirstRequest(options.snapshot, options.firstRequest);
  // 捕获预检开始时的对话身份代次：newConversation / 首轮请求分配会推进它。
  // 预检期间用户新建对话（或重置）后，代次变化即表示本次预检已作废，不得再发送请求。
  const generation = options.state.conversationGeneration;
  void (async () => {
    try {
      const config = await options.loadConfig();
      // 预检期间作品被切换：丢弃本次预检结果，不发送旧作品的选区快照。
      if (options.getProjectToken() !== frozenToken) return;
      // 预检期间用户新建对话：对话身份代次已推进，本次预检作废，保持空白状态。
      if (options.state.conversationGeneration !== generation) return;
      if (!config) {
        options.state.beginRequest(options.snapshot, options.firstRequest);
        options.state.requireConfiguration(options.snapshot);
        return;
      }
      // 真正提交请求前再次校验作品身份与对话代次（纵深防御；请求内部也会以当前令牌校验）。
      if (options.getProjectToken() !== frozenToken) return;
      if (options.state.conversationGeneration !== generation) return;
      const accepted = options.request(options.snapshot, options.firstRequest);
      if (accepted === null) {
        options.state.blockFirstRequest(options.snapshot);
        return;
      }
      options.state.beginRequest(options.snapshot, options.firstRequest);
    } catch (error) {
      // 预检失败但作品已切换或对话已作废：同样丢弃，避免污染当前 AI 面板。
      if (options.getProjectToken() !== frozenToken) return;
      if (options.state.conversationGeneration !== generation) return;
      options.state.fail(options.snapshot, {
        code: "network",
        message: preflightErrorMessage(error),
      });
    } finally {
      if (preflight) releasePreflight(preflight, frozenToken);
    }
  })();
  return true;
}

function preflightErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "AI 请求开始前发生异常。";
}
