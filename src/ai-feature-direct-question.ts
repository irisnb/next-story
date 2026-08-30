import type { AiPanelState } from "./ai-panel-state.ts";
import {
  acquirePreflight,
  releasePreflight,
  runFirstRoundPreflight,
  type FirstRequestPreflightState,
} from "./ai-feature-first-round.ts";
import type { GenerateAiRequest, LlmConfigSummary, SelectionSnapshot } from "./types.ts";

export interface StartDirectQuestionOptions {
  state: AiPanelState;
  question: string;
  selection: SelectionSnapshot | null;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  request: (request: GenerateAiRequest) => Promise<void> | null;
  /** 预检开始时冻结的作品令牌；每次 `await` 后重新校验，不符则丢弃本次预检结果。 */
  getProjectToken: () => number;
  /** 与首轮召唤共享的 operation 门禁；预检开始占用、所有路径释放。 */
  preflight?: FirstRequestPreflightState;
}

/**
 * 提交一次直接提问：冻结问题与可选选区，进入 loading 后做配置预检并发送。
 *
 * 空问题被拒绝（不进入 loading）。预检期间切换作品会丢弃本次预检结果，
 * 不把旧作品的选区/问题作为请求发出。请求被单飞协调器拒绝时进入错误状态。
 */
export function startDirectQuestion(options: StartDirectQuestionOptions): boolean {
  const question = options.question.trim();
  if (!question) return false;
  const preflight = options.preflight;

  // 冻结问题与选区快照：后续编辑器选区变化不影响本次已发送请求。
  const frozenSelection = options.selection ? { ...options.selection } : null;
  const frozenToken = options.getProjectToken();
  if (preflight && !acquirePreflight(preflight, frozenToken)) return false;
  if (!options.state.beginDirectQuestion(question, frozenSelection)) {
    if (preflight) releasePreflight(preflight, frozenToken);
    return false;
  }
  // 捕获预检开始时的对话身份代次：newConversation / 首轮请求分配会推进它。
  // 预检期间用户新建对话后，代次变化即表示本次预检已作废，不得再发送请求。
  const generation = options.state.conversationGeneration;

  runFirstRoundPreflight({
    state: options.state,
    loadConfig: options.loadConfig,
    request: options.request,
    getProjectToken: options.getProjectToken,
    preflight,
    frozenToken,
    generation,
    buildRequest: () => ({
      kind: "direct_question",
      question,
      ...(frozenSelection ? { selected_text: frozenSelection.selectedText } : {}),
    }),
    requireConfiguration: () => options.state.requireDirectQuestionConfiguration(),
    onBlocked: () => options.state.failDirectQuestion({ code: "network", message: "已有 AI 请求正在进行，本次请求没有发出。" }),
    onError: (error) => options.state.failDirectQuestion(error),
  });
  return true;
}
