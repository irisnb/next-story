import type { AiPanelState } from "./ai-panel-state.ts";
import { frozenSnapshot } from "./ai-panel-conversation.ts";
import type {
  GenerateAiError,
  GenerateAiRequest,
  LlmConfigSummary,
  SelectionSnapshot,
} from "./types.ts";

/**
 * 首轮流程（及时召唤 / 直接提问）共享的模块：预检门禁、与「发起方式」
 * 无关的共享预检核心，以及召唤发起方式（change: restore-selection-summon-entry）。
 */

/**
 * 首轮流程共享的 operation 门禁。
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

/**
 * 首轮流程中与「发起方式」无关的共享核心：配置预检、作品身份冻结校验、
 * 对话代次过期隔离与请求分发。直接提问与召唤各自提供状态迁移与请求
 * 载荷构造接入这条流程，不复制整条流程。
 */
export interface FirstRoundPreflightOptions<TRequest extends GenerateAiRequest> {
  state: AiPanelState;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  /** 经单飞协调器发送首轮请求；被拒绝时返回 null。 */
  request: (request: TRequest) => Promise<void> | null;
  /** 预检开始时冻结的作品令牌；每次 `await` 后重新校验，不符则丢弃本次预检结果。 */
  getProjectToken: () => number;
  /** 与另一发起方式共享的 operation 门禁；预检开始占用、所有路径释放。 */
  preflight?: FirstRequestPreflightState;
  /** 进入首轮状态后捕获的作品令牌。 */
  frozenToken: number;
  /** 进入首轮状态后捕获的对话身份代次（newConversation / 首轮分配会推进它）。 */
  generation: number;
  /** 构造本次首轮请求载荷（直接提问 / 召唤各自提供）。 */
  buildRequest: () => TRequest;
  /** 配置缺失时的状态迁移（显示配置提示与「前往配置」入口）。 */
  requireConfiguration: () => void;
  /** 请求被单飞协调器拒绝时的状态迁移。 */
  onBlocked: () => void;
  /** 预检或发送失败时的状态迁移。 */
  onError: (error: GenerateAiError) => void;
}

/** 预检失败转成面板可显示的安全错误说明。 */
export function preflightErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "AI 请求开始前发生异常。";
}

/**
 * 执行首轮的共享预检与发送流程。调用方先进入各自的首轮状态（冻结材料、
 * 占用门禁、捕获代次），再把捕获值交给本函数；所有过期路径静默丢弃，
 * 不污染当前面板。
 */
export function runFirstRoundPreflight<TRequest extends GenerateAiRequest>(
  options: FirstRoundPreflightOptions<TRequest>,
): void {
  const { state, preflight, frozenToken, generation } = options;
  void (async () => {
    try {
      const config = await options.loadConfig();
      // 预检期间作品被切换：丢弃本次预检结果，不发送旧作品的材料。
      if (options.getProjectToken() !== frozenToken) return;
      // 预检期间用户新建对话：对话身份代次已推进，本次预检作废，保持空白状态。
      if (state.conversationGeneration !== generation) return;
      if (!config) {
        options.requireConfiguration();
        return;
      }
      // 真正提交请求前再次校验作品身份与对话代次（纵深防御；请求内部也会以当前令牌校验）。
      if (options.getProjectToken() !== frozenToken) return;
      if (state.conversationGeneration !== generation) return;
      const accepted = options.request(options.buildRequest());
      if (accepted === null) {
        options.onBlocked();
        return;
      }
    } catch (error) {
      // 预检失败但作品已切换或对话已作废：同样丢弃，避免污染当前 AI 面板。
      if (options.getProjectToken() !== frozenToken) return;
      if (state.conversationGeneration !== generation) return;
      options.onError({
        code: "network",
        message: preflightErrorMessage(error),
      });
    } finally {
      if (preflight) releasePreflight(preflight, frozenToken);
    }
  })();
}

export interface StartSummonOptions {
  state: AiPanelState;
  /** 点击浮动入口时冻结的选区快照；召唤的前提是有意义的选区。 */
  snapshot: SelectionSnapshot;
  loadConfig: () => Promise<LlmConfigSummary | null>;
  /** 经单飞协调器发送召唤首轮；被拒绝时返回 null。 */
  request: (request: Extract<GenerateAiRequest, { kind: "summon" }>) => Promise<void> | null;
  getProjectToken: () => number;
  preflight?: FirstRequestPreflightState;
}

/**
 * 发起一次及时召唤：冻结选区快照进入召唤 loading（面板展开、显示冻结
 * 选区与思考占位），随后走与直接提问共享的预检门禁并发送流式首轮。
 * 召唤没有用户输入的问题文本，前端不伪造默认问题。
 *
 * 预检期间切换作品会丢弃本次预检结果，不把旧作品的选区作为请求发出。
 * 请求被单飞协调器拒绝时进入错误状态。
 */
export function startSummon(options: StartSummonOptions): boolean {
  // 防御校验：浮动入口只在有意义的选区旁出现，空选区不发起召唤。
  if (!options.snapshot.selectedText.trim()) return false;
  const preflight = options.preflight;
  // 冻结选区快照：后续编辑器选区变化不影响本次已发起的召唤。
  const frozen = frozenSnapshot(options.snapshot);
  const frozenToken = options.getProjectToken();
  if (preflight && !acquirePreflight(preflight, frozenToken)) return false;
  options.state.beginRequest(frozen, { kind: "summon", selected_text: frozen.selectedText });
  runFirstRoundPreflight({
    state: options.state,
    loadConfig: options.loadConfig,
    request: options.request,
    getProjectToken: options.getProjectToken,
    preflight,
    frozenToken,
    generation: options.state.conversationGeneration,
    buildRequest: () => ({ kind: "summon", selected_text: frozen.selectedText }),
    requireConfiguration: () => options.state.requireConfiguration(frozen),
    onBlocked: () =>
      options.state.fail(frozen, {
        code: "network",
        message: "已有 AI 请求正在进行，本次请求没有发出。",
      }),
    onError: (error: GenerateAiError) => options.state.fail(frozen, error),
  });
  return true;
}
