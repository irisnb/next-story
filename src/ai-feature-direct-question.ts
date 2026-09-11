import type { AiPanelState } from "./ai-panel-state.ts";
import { runFirstRoundPreflight } from "./ai-feature-first-round.ts";
import type { GenerateAiRequest, LlmConfigSummary, SelectionSnapshot } from "./types.ts";

export interface StartDirectQuestionOptions {
  state: AiPanelState;
  question: string;
  selection: SelectionSnapshot | null;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  request: (request: GenerateAiRequest) => Promise<void> | null;
  /** 预检开始时冻结的作品令牌；每次 `await` 后重新校验，不符则丢弃本次预检结果。 */
  getProjectToken: () => number;
  /** 发起时关注文档身份（默认取选区 documentId）。 */
  focusDocumentId?: string | null;
  focusDocumentTitle?: string | null;
}

/**
 * 提交一次直接提问：冻结问题与可选选区，进入 loading 后做配置预检并发送。
 *
 * 空问题被拒绝（不进入 loading）。预检期间切换作品会丢弃本次预检结果，
 * 不把旧作品的选区/问题作为请求发出。请求被调度器 / 协调器拒绝时进入错误状态。
 */
export function startDirectQuestion(options: StartDirectQuestionOptions): boolean {
  const question = options.question.trim();
  if (!question) return false;

  // 冻结问题与选区快照：后续编辑器选区变化不影响本次已发送请求。
  const frozenSelection = options.selection ? { ...options.selection } : null;
  const frozenToken = options.getProjectToken();
  if (!options.state.beginDirectQuestion(
    question,
    frozenSelection,
    options.focusDocumentId ?? frozenSelection?.documentId ?? null,
    options.focusDocumentTitle ?? null,
  )) {
    return false;
  }
  // 进入首轮状态后捕获归属讨论：预检只随该讨论失效，不因其他讨论新建/切换作废。
  const conversationId = options.state.activeConversationId;
  if (conversationId === null) return true;

  runFirstRoundPreflight({
    state: options.state,
    conversationId,
    loadConfig: options.loadConfig,
    request: options.request,
    getProjectToken: options.getProjectToken,
    frozenToken,
    buildRequest: () => ({
      kind: "direct_question",
      question,
      ...(frozenSelection ? { selected_text: frozenSelection.selectedText } : {}),
    }),
    requireConfiguration: () => options.state.requireDirectQuestionConfiguration(conversationId),
    onBlocked: () => options.state.failDirectQuestion({ code: "network", message: "已有 AI 请求正在进行，本次请求没有发出。" }, conversationId),
    onError: (error) => options.state.failDirectQuestion(error, conversationId),
  });
  return true;
}
