import { AiRequestCoordinator, type RequestIdentity } from "./ai-request.ts";
import { AiRequestScheduler, DEFAULT_MAX_CONCURRENT } from "./ai-request-scheduler.ts";
import { waitTiming } from "./ai-timing.ts";
import type { AiFeatureContext } from "./ai-feature-context.ts";
import {
  withFocusDocumentIdentity,
  type RequestMaterialsDependencies,
} from "./ai-feature-request-materials.ts";
import { roundProvenanceToMaterialProvenance } from "./conversation-archive.ts";
import type {
  GenerateAiError,
  GenerateAiRequest,
  SelectionSnapshot,
} from "./types.ts";
import type { AiPanelState } from "./ai-panel-state.ts";

/**
 * 请求网关（change: extract-ai-request-orchestration 组 4，design D3）。
 *
 * 全部 AI 请求派发（召唤首轮 / 追问 / 直接提问）经本模块完成「调度准入 → 协调器
 * 调用」的组合；网关之外的生产代码不得自行组合 scheduler 准入与 coordinator
 * 请求调用（ai-module-boundaries：请求派发经统一网关）。
 *
 * 内部结构：
 * - 三个同构 sender 收敛为一条派发管道（`scheduleTracked` + busy/queued 回写），
 *   差异只在三根轴：材料注入开关（enrich）、kind 标签来源、coordinator 方法；
 * - `materialDispatchGuard`（派发前材料权限复核）只服务排队派发，属管道私有；
 * - coordinator 与其六个终态回调在本模块构造：回调尾部的固定四连
 *   （`waitTiming.complete → state 迁移 → persist → refreshOnDemand`）是编排规则，
 *   逐条保持原实现；
 * - 不引 DOM；一切状态与副作用经 `AiFeatureContext` 访问器（禁快照，每次现取）。
 */

/** 结构化请求的派发签名（追问 / 重试 / 编辑重发）。 */
export type StructuredRequestSender = (
  request: GenerateAiRequest,
  identity: RequestIdentity,
) => Promise<void> | null;

/** 召唤首请求载荷（冻结选区 + 可选结构化首材料）。 */
export type SummonFirstRequest =
  | Extract<GenerateAiRequest, { kind: "summon" }>
  | Extract<GenerateAiRequest, { kind: "direct_question" }>;

/** 错误终态按错误码分流：缺配置进入配置引导，其余进入普通失败态。 */
export function applyGenerateError(
  state: AiPanelState,
  snapshot: SelectionSnapshot,
  error: GenerateAiError,
  conversationId?: string,
): void {
  if (error.code === "configuration_required") {
    state.requireConfiguration(snapshot, conversationId);
    return;
  }
  state.fail(snapshot, error, conversationId);
}

export interface AiRequestGateway {
  /** 全局调度器（组合根销毁路径经 context 访问，勿在网关外派发）。 */
  readonly scheduler: AiRequestScheduler;
  /** 按讨论隔离的单请求协调器（同上，仅经 context 访问）。 */
  readonly coordinator: AiRequestCoordinator;
  readonly requestStructured: StructuredRequestSender;
  readonly requestSummon: (
    conversationId: string,
    snapshot: SelectionSnapshot,
    firstRequest?: SummonFirstRequest,
  ) => Promise<void> | null;
  readonly requestDirectQuestion: (
    conversationId: string,
    request: GenerateAiRequest,
  ) => Promise<void> | null;
}

export interface AiRequestGatewayOptions {
  readonly context: AiFeatureContext;
  /** 全局同时生成上限（缺省用调度器默认值）。 */
  readonly maxConcurrent?: number;
  /** 讨论档案保存入口（终态编排四连的第三步；由组合根注入）。 */
  readonly persistDiscussion: (conversationId: string) => void;
  /** 轮次终态后的按需补读状态刷新入口（四连的第四步；由组合根注入）。 */
  readonly refreshOnDemandState: (conversationId: string) => void;
}

export function setupAiRequestGateway(options: AiRequestGatewayOptions): AiRequestGateway {
  const { context, persistDiscussion, refreshOnDemandState } = options;

  const materials: RequestMaterialsDependencies = {
    state: context.state,
    getCurrentProjectPath: context.getCurrentProjectPath,
    getCurrentDocumentId: context.getCurrentDocumentId,
    getCurrentEditor: context.getCurrentEditor,
    getCurrentDocumentVersion: context.getCurrentDocumentVersion,
  };

  const coordinator = new AiRequestCoordinator(
    (selectedText: string) =>
      context.getTransport().sendViaResidentSession(context.state.activeConversationId ?? "", {
        kind: "summon",
        selected_text: selectedText,
      }),
    {
      onSuccess: (snapshot: SelectionSnapshot, content: string, conversationId: string) => {
        waitTiming.complete(conversationId);
        context.state.succeed(snapshot, content, conversationId);
        persistDiscussion(conversationId);
        refreshOnDemandState(conversationId);
      },
      onError: (snapshot: SelectionSnapshot, error, conversationId: string) => {
        waitTiming.complete(conversationId);
        applyGenerateError(context.state, snapshot, error, conversationId);
        persistDiscussion(conversationId);
        refreshOnDemandState(conversationId);
      },
      onStructuredSuccess: (content, provenance, sentConfirmed, identity) => {
        waitTiming.complete(identity.conversationId);
        context.state.succeedFollowUp(identity.turnId ?? -1, content, identity.conversationId);
        context.state.recordRoundProvenance(
          identity.conversationId,
          roundProvenanceToMaterialProvenance(provenance, identity.turnId ?? 0, sentConfirmed),
        );
        persistDiscussion(identity.conversationId);
        refreshOnDemandState(identity.conversationId);
      },
      onStructuredError: (error, identity) => {
        waitTiming.complete(identity.conversationId);
        if (error.code === "configuration_required") {
          context.state.requireFollowUpConfiguration(identity.turnId ?? -1, identity.conversationId);
        } else {
          context.state.failFollowUp(identity.turnId ?? -1, error, identity.conversationId);
        }
        persistDiscussion(identity.conversationId);
        refreshOnDemandState(identity.conversationId);
      },
      onDirectQuestionSuccess: (content, provenance, sentConfirmed, conversationId) => {
        waitTiming.complete(conversationId);
        context.state.succeedDirectQuestion(content, conversationId);
        context.state.recordRoundProvenance(
          conversationId,
          roundProvenanceToMaterialProvenance(provenance, 0, sentConfirmed),
        );
        persistDiscussion(conversationId);
        refreshOnDemandState(conversationId);
      },
      onDirectQuestionError: (error, conversationId) => {
        waitTiming.complete(conversationId);
        if (error.code === "configuration_required") {
          context.state.requireDirectQuestionConfiguration(conversationId);
        } else {
          context.state.failDirectQuestion(error, conversationId);
        }
        persistDiscussion(conversationId);
        refreshOnDemandState(conversationId);
      },
    },
    context.getProjectToken,
    (conversationId, request) => context.getTransport().sendViaResidentSession(conversationId, request),
    () => context.state.requestIdentity,
  );

  // 全局调度器：名额释放时把排队请求恢复为生成中；派发前复核失败的排队请求转为失败终态。
  const scheduler = new AiRequestScheduler(
    options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    (conversationId) => {
      context.state.startQueuedRequest(conversationId);
      waitTiming.started(conversationId);
    },
    (conversationId) => {
      waitTiming.complete(conversationId);
      context.state.rejectQueuedRequest(conversationId, {
        code: "document_not_visible",
        message: "材料文档的可见性已变化，本次请求未发送。请重新发起。",
      });
    },
  );

  /**
   * 派发前材料权限复核（任务 6.1）：排队请求实际派发前，重新检查其材料来源文档
   * 是否仍允许 AI 查看。无材料来源（无选区 / 无关注文档）时不需复核，直接放行。
   */
  function materialDispatchGuard(conversationId: string): () => boolean {
    return () => {
      const discussion = context.state.getDiscussion(conversationId);
      if (!discussion) return false;
      const sourceDocumentId = discussion.anchor?.documentId ?? discussion.focusDocumentId;
      if (sourceDocumentId === null) return true;
      return !context.hiddenDocumentIds().has(sourceDocumentId);
    };
  }

  /** 记录提交/排队/开始时间，并返回调度结果。 */
  function scheduleTracked(
    conversationId: string,
    kind: string,
    run: () => Promise<void> | null,
  ): "started" | "queued" | "busy" {
    waitTiming.submit(conversationId, kind);
    const result = scheduler.submit({
      conversationId,
      run,
      beforeDispatch: materialDispatchGuard(conversationId),
    });
    if (result === "started") waitTiming.started(conversationId);
    else if (result === "queued") waitTiming.queued(conversationId);
    return result;
  }

  /** 三个 sender 共用的派发管道：调度准入 → busy/queued 回写。 */
  function dispatchTracked(
    conversationId: string,
    kind: string,
    run: () => Promise<void> | null,
  ): Promise<void> | null {
    const result = scheduleTracked(conversationId, kind, run);
    if (result === "busy") return null;
    if (result === "queued") context.state.queueRequest(conversationId);
    return Promise.resolve();
  }

  // 三个 sender 的三轴差异：enrich（材料注入开关）/ kind 来源 / coordinator 方法。

  /** 经调度器发送结构化请求（追问 / 重试 / 编辑重发）。 */
  const requestStructured: StructuredRequestSender = (request, identity) => {
    const focused = withFocusDocumentIdentity(request, identity.conversationId, materials);
    return dispatchTracked(identity.conversationId, focused.kind, () =>
      coordinator.requestStructured(focused, identity),
    );
  };

  /** 经调度器发送召唤首轮（首轮始终归属聚焦讨论；快车道不注入常规材料）。 */
  const requestSummon = (
    conversationId: string,
    snapshot: SelectionSnapshot,
    firstRequest?: SummonFirstRequest,
  ): Promise<void> | null =>
    dispatchTracked(conversationId, "summon", () =>
      coordinator.requestFor(conversationId, snapshot, firstRequest),
    );

  /** 经调度器发送直接提问（首轮 / 重试）。 */
  const requestDirectQuestion = (
    conversationId: string,
    request: GenerateAiRequest,
  ): Promise<void> | null => {
    const focused = withFocusDocumentIdentity(request, conversationId, materials);
    return dispatchTracked(conversationId, focused.kind, () =>
      coordinator.requestDirectQuestionFor(conversationId, focused),
    );
  };

  return {
    scheduler,
    coordinator,
    requestStructured,
    requestSummon,
    requestDirectQuestion,
  };
}
