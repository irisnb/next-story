import type { AiFeatureContext } from "./ai-feature-context.ts";
import type { StructuredRequestSender, SummonFirstRequest } from "./ai-feature-request-gateway.ts";
import { waitTiming } from "./ai-timing.ts";
import type { AiPanelState } from "./ai-panel-state.ts";
import type { GenerateAiRequest, SelectionSnapshot } from "./types.ts";

/**
 * 请求生命周期（change: extract-ai-request-orchestration 组 5，design D4）。
 *
 * 停止 / 关闭 / 重试的编排规则住在本模块（ai-module-boundaries：组合根装配边界）：
 * - `stopGeneration` 与 `closeWindow` 共享同构前缀（取消排队 → 取消传输 → 释放
 *   协调器锁），尾部各自保留原实现步骤，逐条对照、不重排不增删
 *   （stop：waitTiming.complete → stopRequest → persist；close：stopRequest → closeWindow）；
 * - `retryFirstRound` 双分支（直接提问 / 召唤）保持原实现；
 * - `retryStoppedFollowUp` 吸收自 `buildAiDockActions` 的内联实现（停止后的追问重试）。
 *
 * 不引 DOM；一切状态与副作用经 `AiFeatureContext` 访问器（禁快照，每次现取）。
 */

/**
 * 以既存的失败终态快照与首轮材料重新发起召唤请求；协调器拒收（讨论内已有
 * 在途请求）时不迁移状态。
 */
export function retryAcceptedRequest(
  state: AiPanelState,
  request: (
    snapshot: SelectionSnapshot,
    firstRequest?: SummonFirstRequest,
  ) => Promise<void> | null,
): boolean {
  const snapshot = state.retrySnapshot();
  if (!snapshot || request(snapshot, state.retryFirstRequest() ?? undefined) === null) {
    return false;
  }
  return state.acceptFirstRetry();
}

export interface AiRequestLifecycle {
  /** 停止指定讨论的当前生成：进入「已停止」终态并持久化。 */
  stopGeneration(conversationId: string): void;
  /** 关闭指定讨论的窗口：只结束显示与在途请求，不删除讨论。 */
  closeWindow(conversationId: string): void;
  /** 首轮失败 / 缺配置 / 已停止后的重试（直接提问与召唤双分支）。 */
  retryFirstRound(): void;
  /** 停止后的追问重试：以同一问题重新发送（原内联于停靠区动作装配）。 */
  retryStoppedFollowUp(): Promise<boolean>;
}

export interface AiRequestLifecycleOptions {
  readonly context: AiFeatureContext;
  /** 讨论档案保存入口（停止终态的既有尾步；由组合根注入）。 */
  readonly persistDiscussion: (conversationId: string) => void;
  /** 当前聚焦讨论的保存入口（重试被接受后的既有持久化；由组合根注入）。 */
  readonly persistCurrentDiscussion: () => void;
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

export function setupAiRequestLifecycle(options: AiRequestLifecycleOptions): AiRequestLifecycle {
  const {
    context,
    persistDiscussion,
    persistCurrentDiscussion,
    requestStructured,
    requestSummon,
    requestDirectQuestion,
  } = options;

  /** 停止与关闭的同构前缀：取消排队 → 取消传输 → 释放协调器单请求锁。 */
  function detachRequest(conversationId: string): void {
    context.getScheduler().cancelQueued(conversationId);
    context.getTransport().cancelMessage(conversationId);
    context.getCoordinator().cancel(conversationId);
  }

  function stopGeneration(conversationId: string): void {
    detachRequest(conversationId);
    waitTiming.complete(conversationId);
    context.state.stopRequest(conversationId);
    persistDiscussion(conversationId);
  }

  function closeWindow(conversationId: string): void {
    detachRequest(conversationId);
    context.state.stopRequest(conversationId);
    context.state.closeWindow(conversationId);
  }

  function retryFirstRound(): void {
    const conversationId = context.state.activeConversationId;
    if (conversationId === null) return;
    const request = context.state.view.request;
    if (request.kind === "direct_question") {
      if (!context.state.retryDirectQuestion(conversationId)) return;
      const payload: GenerateAiRequest = {
        kind: "direct_question",
        question: request.question,
        ...(request.selection ? {
          selected_text: request.selection.selectedText,
          document_id: request.selection.documentId,
          ...(request.selection.projectPath !== undefined ? { project_path: request.selection.projectPath } : {}),
          ...(request.selection.documentVersion !== undefined ? { document_version: request.selection.documentVersion } : {}),
          ...(request.selection.bodySnapshot !== undefined ? { snapshot: request.selection.bodySnapshot } : {}),
        } : {}),
      };
      const accepted = requestDirectQuestion(conversationId, payload);
      if (accepted === null) {
        context.state.failDirectQuestion({ code: "network", message: "已有 AI 请求正在进行，本次请求没有发出。" }, conversationId);
      }
      return;
    }
    retryAcceptedRequest(context.state, (snapshot, firstRequest) =>
      requestSummon(conversationId, snapshot, firstRequest),
    );
  }

  async function retryStoppedFollowUp(): Promise<boolean> {
    const identity = context.state.conversationIdentity;
    const payload = context.state.followUpRequest();
    if (!identity || identity.turnId === undefined || !payload) return false;
    const accepted = requestStructured(payload, {
      conversationId: identity.conversationId,
      turnId: identity.turnId,
    });
    if (accepted === null) return false;
    const ok = context.state.retryStoppedFollowUp();
    if (ok) persistCurrentDiscussion();
    return ok;
  }

  return {
    stopGeneration,
    closeWindow,
    retryFirstRound,
    retryStoppedFollowUp,
  };
}
