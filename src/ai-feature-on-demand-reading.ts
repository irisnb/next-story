import type { AiPanelState } from "./ai-panel-state.ts";
import type {
  aiResolveReadingRequest,
} from "./project-api.ts";
import type {
  conversationOnDemandReading,
  conversationSetOnDemandReading,
} from "./conversation-archive.ts";

/**
 * 按需补读授权交互（add-agent-on-demand-reading 任务 7.1/7.2/7.4 的编排聚焦模块，
 * change: extract-ai-logic-seams 第一刀）。
 *
 * 从 `setupAiFeature` 闭包宇宙中提取，遵循 editor-module-boundaries 惯例：
 * - 不引 DOM：不访问 `document` / `window`，只收显式依赖（状态外观 + 访问器 + 后端调用）；
 * - 访问器逐次求值：`getCurrentProjectPath` / `getProjectToken` / `isDestroyed`
 *   都在每次使用时现取，本模块不做任何快照化（可见性红线，design D6）。
 */
export interface OnDemandReadingDependencies {
  /** 面板状态外观（updateOnDemandState / 授权卡 / 授权开关 / 保存错误提示）。 */
  readonly state: AiPanelState;
  /** 当前作品路径访问器；null 表示无作品（跳过）。 */
  readonly getCurrentProjectPath: () => string | null;
  /** 作品代次访问器：回调到达时重读并与发起时捕获值比对（ABA 安全）。 */
  readonly getProjectToken: () => number;
  /** 编排层销毁标记访问器：迟到回调到达时现读。 */
  readonly isDestroyed: () => boolean;
  /** 读取指定讨论的按需补读状态（任务 7.4 显示刷新）。 */
  readonly fetchOnDemandReading: typeof conversationOnDemandReading;
  /**
   * 用户对按需补读授权请求的决定回填（任务 7.1）：允许 → 后端写授权并继续原问题；
   * 拒绝 → 有限回答。
   */
  readonly resolveReadingRequest: typeof aiResolveReadingRequest;
  /** 讨论内授权开关（任务 7.2）：开启 / 关闭按需补读授权。 */
  readonly setOnDemandReading: typeof conversationSetOnDemandReading;
}

/** 按需补读的三个交互入口（由 `setupAiFeature` 装配后接线）。 */
export interface OnDemandReadingInteractions {
  refreshOnDemandState(conversationId: string): void;
  resolveReadingRequest(conversationId: string, granted: boolean): void;
  toggleOnDemandReading(conversationId: string, granted: boolean): void;
}

export function setupOnDemandReadingInteractions(
  deps: OnDemandReadingDependencies,
): OnDemandReadingInteractions {
  const {
    state,
    getCurrentProjectPath,
    getProjectToken,
    isDestroyed,
    fetchOnDemandReading,
    resolveReadingRequest: resolveReadingRequestBackend,
    setOnDemandReading: setOnDemandReadingBackend,
  } = deps;

  /**
   * 轮次终态后从档案刷新按需补读状态（任务 7.4）：后端工具通道按轮把补读出处
   * 写入档案，前端内存副本不知道；这里拉取最新授权 + 出处供「本次参考了什么」
   * 展示。失败静默（显示保持旧值，不伪造）。
   */
  function refreshOnDemandState(conversationId: string): void {
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    const token = getProjectToken();
    void fetchOnDemandReading(projectPath, conversationId)
      .then((result) => {
        if (isDestroyed() || getProjectToken() !== token) return;
        state.updateOnDemandState(
          conversationId,
          result.grant ?? null,
          result.provenance ?? null,
        );
      })
      .catch(() => {
        // 静默：显示层保持旧值。
      });
  }

  /**
   * 用户对授权请求的决定（任务 7.1）：调 `ai_resolve_reading_request` 回填；
   * 成功后清除授权卡，允许时写入讨论授权（授权属于讨论、跨重启保留）。
   * 迟到 / 身份不符的失败也清除授权卡（该轮已收束），但不伪造授权。
   */
  function resolveReadingRequest(conversationId: string, granted: boolean): void {
    const pending = state.pendingReadingRequestOf(conversationId);
    if (pending === null) return;
    void resolveReadingRequestBackend(pending.sessionId, pending.callId, granted)
      .then((result) => {
        if (isDestroyed()) return;
        state.resolveReadingRequest(conversationId, granted && result.ok);
      })
      .catch(() => {
        if (isDestroyed()) return;
        state.resolveReadingRequest(conversationId, false);
      });
  }

  /**
   * 讨论内授权开关（任务 7.2）：调后端读改写命令（开启写授权及时间 / 关闭置回
   * 未授权）；成功后更新本地状态。关闭立即阻止后续读取、不清除已读内容（后端
   * 语义），失败时本地状态不动并提示。
   */
  function toggleOnDemandReading(conversationId: string, granted: boolean): void {
    const projectPath = getCurrentProjectPath();
    if (projectPath === null) return;
    void setOnDemandReadingBackend(projectPath, conversationId, granted)
      .then(() => {
        if (isDestroyed()) return;
        state.setOnDemandReading(conversationId, granted);
      })
      .catch(() => {
        if (isDestroyed()) return;
        state.setSaveError("按需补读设置未能保存，授权状态未改变");
      });
  }

  return {
    refreshOnDemandState,
    resolveReadingRequest,
    toggleOnDemandReading,
  };
}
