import type { AiPanelState } from "./ai-panel-state.ts";
import { frozenSnapshot } from "./ai-panel-conversation.ts";
import type {
  GenerateAiError,
  GenerateAiRequest,
  LlmConfigSummary,
  SelectionSnapshot,
} from "./types.ts";

/**
 * 首轮流程（及时召唤 / 直接提问）共享的模块：与「发起方式」无关的共享预检核心，
 * 以及召唤发起方式（change: restore-selection-summon-entry）。
 *
 * 首轮预检按讨论进行：进入首轮状态后捕获归属讨论，预检期间只随该讨论或作品失效，
 * 不因其他讨论的新建/切换而作废（见 design D4）。
 */

/** 预检失败转成面板可显示的安全错误说明。 */
export function preflightErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "AI 请求开始前发生异常。";
}

/**
 * 首轮流程中与「发起方式」无关的共享核心：配置预检、作品身份冻结校验、
 * 讨论级过期隔离与请求分发。直接提问与召唤各自提供状态迁移与请求载荷
 * 构造接入这条流程，不复制整条流程。
 */
export interface FirstRoundPreflightOptions<TRequest extends GenerateAiRequest> {
  state: AiPanelState;
  /** 本次首轮请求归属的讨论（`beginRequest` / `beginDirectQuestion` 之后聚焦的讨论）。 */
  conversationId: string;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  /** 经调度器发送首轮请求；被拒绝时返回 null。 */
  request: (request: TRequest) => Promise<void> | null;
  /** 预检开始时冻结的作品令牌；每次 `await` 后重新校验，不符则丢弃本次预检结果。 */
  getProjectToken: () => number;
  frozenToken: number;
  /** 构造本次首轮请求载荷（直接提问 / 召唤各自提供）。 */
  buildRequest: () => TRequest;
  /** 配置缺失时的状态迁移（显示配置提示与「前往配置」入口）。 */
  requireConfiguration: () => void;
  /** 请求被调度器 / 单请求协调器拒绝时的状态迁移。 */
  onBlocked: () => void;
  /** 预检或发送失败时的状态迁移。 */
  onError: (error: GenerateAiError) => void;
}

/**
 * 执行首轮的共享预检与发送流程。调用方先进入各自的首轮状态（冻结材料），
 * 再以讨论身份把捕获值交给本函数；所有过期路径静默丢弃，不污染当前面板。
 */
export function runFirstRoundPreflight<TRequest extends GenerateAiRequest>(
  options: FirstRoundPreflightOptions<TRequest>,
): void {
  const { state, conversationId, frozenToken } = options;
  void (async () => {
    try {
      const config = await options.loadConfig();
      // 预检期间作品被切换：丢弃本次预检结果，不发送旧作品的材料。
      if (options.getProjectToken() !== frozenToken) return;
      // 预检期间该讨论被删除或已不再处于首轮进行中：作废。
      if (!state.isFirstRoundLoading(conversationId)) return;
      if (!config) {
        options.requireConfiguration();
        return;
      }
      // 真正提交请求前再次校验作品身份与讨论状态（纵深防御）。
      if (options.getProjectToken() !== frozenToken) return;
      if (!state.isFirstRoundLoading(conversationId)) return;
      const accepted = options.request(options.buildRequest());
      if (accepted === null) {
        options.onBlocked();
        return;
      }
    } catch (error) {
      // 预检失败但作品已切换或讨论已作废：同样丢弃，避免污染当前面板。
      if (options.getProjectToken() !== frozenToken) return;
      if (!state.isFirstRoundLoading(conversationId)) return;
      options.onError({
        code: "network",
        message: preflightErrorMessage(error),
      });
    }
  })();
}

export interface StartSummonOptions {
  state: AiPanelState;
  /** 点击浮动入口时冻结的选区快照；召唤的前提是有意义的选区。 */
  snapshot: SelectionSnapshot;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  /** 经调度器发送召唤首轮；被拒绝时返回 null。 */
  request: (request: Extract<GenerateAiRequest, { kind: "summon" }>) => Promise<void> | null;
  getProjectToken: () => number;
  /** 发起时关注文档身份（默认取快照的 documentId）。 */
  focusDocumentId?: string | null;
  focusDocumentTitle?: string | null;
}

/**
 * 发起一次及时召唤：冻结选区快照进入召唤 loading（面板展开、显示冻结
 * 选区与思考占位），随后走与直接提问共享的预检并发送流式首轮。
 * 召唤没有用户输入的问题文本，前端不伪造默认问题。
 *
 * 预检期间切换作品会丢弃本次预检结果，不把旧作品的选区作为请求发出。
 * 请求被调度器 / 协调器拒绝时进入错误状态。
 */
export function startSummon(options: StartSummonOptions): boolean {
  // 防御校验：浮动入口只在有意义的选区旁出现，空选区不发起召唤。
  if (!options.snapshot.selectedText.trim()) return false;
  // 冻结选区快照：后续编辑器选区变化不影响本次已发起的召唤。
  const frozen = frozenSnapshot(options.snapshot);
  const frozenToken = options.getProjectToken();
  options.state.beginRequest(
    frozen,
    { kind: "summon", selected_text: frozen.selectedText },
    options.focusDocumentId ?? frozen.documentId,
    options.focusDocumentTitle ?? null,
  );
  const conversationId = options.state.activeConversationId;
  if (conversationId === null) return true;
  runFirstRoundPreflight({
    state: options.state,
    conversationId,
    loadConfig: options.loadConfig,
    request: options.request,
    getProjectToken: options.getProjectToken,
    frozenToken,
    buildRequest: () => ({ kind: "summon", selected_text: frozen.selectedText }),
    requireConfiguration: () => options.state.requireConfiguration(frozen, conversationId),
    onBlocked: () =>
      options.state.fail(frozen, {
        code: "network",
        message: "已有 AI 请求正在进行，本次请求没有发出。",
      }, conversationId),
    onError: (error: GenerateAiError) => options.state.fail(frozen, error, conversationId),
  });
  return true;
}
