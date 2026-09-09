import type { GenerateAiError, GenerateAiRequest, GenerateAiResult, SelectionSnapshot } from "./types";

export interface AiRequestCallbacks {
  onSuccess?(snapshot: SelectionSnapshot, content: string, conversationId: string): void;
  onError?(snapshot: SelectionSnapshot, error: GenerateAiError, conversationId: string): void;
  onStructuredSuccess?(content: string, identity: RequestIdentity): void;
  onStructuredError?(error: GenerateAiError, identity: RequestIdentity): void;
  onDirectQuestionSuccess?(content: string, conversationId: string): void;
  onDirectQuestionError?(error: GenerateAiError, conversationId: string): void;
}

export interface RequestIdentity {
  conversationId: string;
  turnId?: number;
}

/** 无讨论身份时的兜底锁键（旧式单飞测试 / 退化路径共享一个锁）。 */
const LEGACY_CONVERSATION_ID = "";

/**
 * 按讨论隔离的单请求协调器（change: add-conversation-persistence-and-isolation）。
 *
 * 每个讨论同一时刻至多一轮请求：`inFlight` 按 `conversationId` 记录在途请求，同一讨论
 * 内的新请求被拒绝，不同讨论的请求互不阻塞、可并行生成。结果按作品令牌与释放代次
 * （`releaseEpoch`，作品切换时推进）隔离；讨论级迟到结果的丢弃由状态层按
 * `conversationId` 路由（讨论已删除则无匹配讨论，自然丢弃）。
 */
export class AiRequestCoordinator {
  private readonly inFlight: Map<string, Promise<void>> = new Map();
  private readonly inFlightProjectToken: Map<string, number> = new Map();
  private releaseEpoch = 0;
  private readonly generate: (selectedText: string) => Promise<GenerateAiResult>;
  private readonly callbacks: AiRequestCallbacks;
  private readonly getProjectToken: () => number;
  private readonly structuredGenerate: ((conversationId: string, request: GenerateAiRequest) => Promise<GenerateAiResult>) | null;
  private readonly getRequestIdentity: (() => RequestIdentity | null) | null;

  constructor(
    generate: (selectedText: string) => Promise<GenerateAiResult>,
    callbacks: AiRequestCallbacks,
    getProjectToken: () => number,
    structuredGenerate: ((conversationId: string, request: GenerateAiRequest) => Promise<GenerateAiResult>) | null = null,
    getRequestIdentity: (() => RequestIdentity | null) | null = null,
  ) {
    this.generate = generate;
    this.callbacks = callbacks;
    this.getProjectToken = getProjectToken;
    this.structuredGenerate = structuredGenerate;
    this.getRequestIdentity = getRequestIdentity;
  }

  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  isConversationBusy(conversationId: string): boolean {
    return this.inFlight.has(conversationId);
  }

  /** 作品切换后释放全部在途请求的所有权，使迟到结果作废、新作品可立即发起请求。 */
  releaseStaleRequestOwnership(): void {
    this.inFlight.clear();
    this.inFlightProjectToken.clear();
    this.releaseEpoch += 1;
  }

  /**
   * 发起一次首次生成请求（召唤）。若该讨论已有请求进行中，返回 `null` 且不执行第二次调用。
   * 结果按讨论身份路由（经 `onSuccess`/`onError` 携带 conversationId）。
   */
  request(
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "summon" }> | Extract<GenerateAiRequest, { kind: "direct_question" }>,
  ): Promise<void> | null {
    const conversationId = this.getRequestIdentity?.()?.conversationId ?? LEGACY_CONVERSATION_ID;
    if (this.inFlight.has(conversationId)) return null;
    const token = this.getProjectToken();
    const epoch = this.releaseEpoch;
    const structured = this.structuredGenerate;
    this.inFlightProjectToken.set(conversationId, token);
    const promise = this.run(snapshot, conversationId, token, epoch, null, () => {
      if (firstRequest && structured) {
        return structured(conversationId, firstRequest);
      }
      return this.generate(snapshot.selectedText);
    });
    this.inFlight.set(conversationId, promise);
    return promise;
  }

  requestStructured(
    request: GenerateAiRequest,
    identity: { conversationId: string; turnId?: number },
  ): Promise<void> | null {
    const generate = this.structuredGenerate;
    if (this.inFlight.has(identity.conversationId) || !generate) return null;
    const token = this.getProjectToken();
    const epoch = this.releaseEpoch;
    this.inFlightProjectToken.set(identity.conversationId, token);
    const promise = this.run(null, identity.conversationId, token, epoch, identity, () =>
      generate(identity.conversationId, request),
    );
    this.inFlight.set(identity.conversationId, promise);
    return promise;
  }

  /**
   * 发起一次直接提问生成请求。结果按讨论身份路由到
   * `onDirectQuestionSuccess` / `onDirectQuestionError`。
   */
  requestDirectQuestion(request: GenerateAiRequest): Promise<void> | null {
    const generate = this.structuredGenerate;
    const conversationId = this.getRequestIdentity?.()?.conversationId ?? LEGACY_CONVERSATION_ID;
    if (this.inFlight.has(conversationId) || !generate) return null;
    const token = this.getProjectToken();
    const epoch = this.releaseEpoch;
    this.inFlightProjectToken.set(conversationId, token);
    const promise = this.runDirectQuestion(conversationId, token, epoch, () =>
      generate(conversationId, request),
    );
    this.inFlight.set(conversationId, promise);
    return promise;
  }

  private async runDirectQuestion(
    conversationId: string,
    token: number,
    epoch: number,
    generate: () => Promise<GenerateAiResult>,
  ): Promise<void> {
    let result: GenerateAiResult;
    try {
      result = await generate();
    } catch {
      this.clearRequestOwnership(conversationId, epoch);
      if (this.isStale(token, epoch)) return;
      this.callbacks.onDirectQuestionError?.({
        code: "network",
        message: "AI 请求未能完成，请检查连接后重试",
      }, conversationId);
      return;
    }

    this.clearRequestOwnership(conversationId, epoch);
    if (this.isStale(token, epoch)) return;
    if (result.ok) {
      this.callbacks.onDirectQuestionSuccess?.(result.content, conversationId);
    } else {
      this.callbacks.onDirectQuestionError?.(result.error, conversationId);
    }
  }

  private async run(
    snapshot: SelectionSnapshot | null,
    conversationId: string,
    token: number,
    epoch: number,
    identity: RequestIdentity | null,
    generate: () => Promise<GenerateAiResult>,
  ): Promise<void> {
    let result: GenerateAiResult;
    try {
      result = await generate();
    } catch {
      this.clearRequestOwnership(conversationId, epoch);
      if (this.isStale(token, epoch)) return;
      const error: GenerateAiError = {
        code: "network",
        message: "AI 请求未能完成，请检查连接后重试",
      };
      if (identity && this.callbacks.onStructuredError) {
        this.callbacks.onStructuredError(error, identity);
      } else if (snapshot) {
        this.callbacks.onError?.(snapshot, error, conversationId);
      }
      return;
    }

    this.clearRequestOwnership(conversationId, epoch);
    if (this.isStale(token, epoch)) return;
    if (result.ok) {
      if (identity && this.callbacks.onStructuredSuccess) {
        this.callbacks.onStructuredSuccess(result.content, identity);
      } else if (snapshot) {
        this.callbacks.onSuccess?.(snapshot, result.content, conversationId);
      }
    } else if (identity && this.callbacks.onStructuredError) {
      this.callbacks.onStructuredError(result.error, identity);
    } else if (snapshot) {
      this.callbacks.onError?.(snapshot, result.error, conversationId);
    }
  }

  private isStale(token: number, epoch: number): boolean {
    if (epoch !== this.releaseEpoch) return true;
    return token !== this.getProjectToken();
  }

  private clearRequestOwnership(conversationId: string, epoch: number): void {
    if (epoch !== this.releaseEpoch) return;
    this.inFlight.delete(conversationId);
    this.inFlightProjectToken.delete(conversationId);
  }
}
