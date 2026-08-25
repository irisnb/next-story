import type { AiPanelState } from "./ai-panel-state.ts";
import {
  acquirePreflight,
  releasePreflight,
  type FirstRequestPreflightState,
} from "./ai-feature-first-request.ts";
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

  void (async () => {
    try {
      const config = await options.loadConfig();
      // 预检期间作品被切换：丢弃本次预检结果，不发送旧作品的直接提问。
      if (options.getProjectToken() !== frozenToken) return;
      if (!config) {
        options.state.requireDirectQuestionConfiguration();
        return;
      }
      // 真正提交请求前再次校验作品身份（纵深防御；请求内部也会以当前令牌校验）。
      if (options.getProjectToken() !== frozenToken) return;
      const payload: GenerateAiRequest = {
        kind: "direct_question",
        question,
        ...(frozenSelection ? { selected_text: frozenSelection.selectedText } : {}),
      };
      const accepted = options.request(payload);
      if (accepted === null) {
        options.state.failDirectQuestion({
          code: "network",
          message: "已有 AI 请求正在进行，本次请求没有发出。",
        });
        return;
      }
    } catch (error) {
      // 预检失败但作品已切换：同样丢弃，避免旧作品错误污染新作品的 AI 面板。
      if (options.getProjectToken() !== frozenToken) return;
      options.state.failDirectQuestion({
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
