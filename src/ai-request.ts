import type { GenerateAiError, GenerateAiRequest, GenerateAiResult, SelectionSnapshot } from "./types";

export interface AiRequestCallbacks {
  onSuccess(snapshot: SelectionSnapshot, content: string): void;
  onError(snapshot: SelectionSnapshot, error: GenerateAiError): void;
  onStructuredSuccess?(content: string, identity: RequestIdentity): void;
  onStructuredError?(error: GenerateAiError, identity: RequestIdentity): void;
}

export interface RequestIdentity {
  conversationId: number;
  turnId?: number;
}

/**
 * 单请求协调器（single-in-flight）。
 *
 * 同一时间只允许一个 AI 请求。生成期间编辑器继续可用（本协调器不碰编辑器 DOM），
 * 但浮动入口会禁用，无法发起第二个请求：当已有请求进行时，`request` 返回 null 且
 * 根本不执行第二个 client 调用，从根上避免结果乱序。
 *
 * 结果同时受作品、请求、临时对话和待回答轮次身份隔离。任一身份失效时，
 * 成功结果、结构化失败和 Promise rejection 都不会触发回调。
 */
export class AiRequestCoordinator {
  private inFlight: Promise<void> | null = null;
  private readonly generate: (selectedText: string) => Promise<GenerateAiResult>;
  private readonly callbacks: AiRequestCallbacks;
  private readonly getProjectToken: () => number;
  private readonly structuredGenerate: ((request: GenerateAiRequest) => Promise<GenerateAiResult>) | null;
  private activeRequestToken = 0;
  private readonly getConversationIdentity: (() => RequestIdentity | null) | null;

  constructor(
    generate: (selectedText: string) => Promise<GenerateAiResult>,
    callbacks: AiRequestCallbacks,
    getProjectToken: () => number,
    structuredGenerate: ((request: GenerateAiRequest) => Promise<GenerateAiResult>) | null = null,
    getConversationIdentity: (() => RequestIdentity | null) | null = null,
  ) {
    this.generate = generate;
    this.callbacks = callbacks;
    this.getProjectToken = getProjectToken;
    this.structuredGenerate = structuredGenerate;
    this.getConversationIdentity = getConversationIdentity;
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /**
   * 发起一次首次生成请求。若已有请求进行中，返回 `null` 且不执行第二个 client 调用。
   * 可选 `firstRequest` 用于思维扩展带方向开始；成功/失败仍按冻结选区走 onSuccess/onError。
   */
  request(
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
  ): Promise<void> | null {
    if (this.inFlight) {
      return null;
    }
    const token = this.getProjectToken();
    const requestToken = ++this.activeRequestToken;
    const structured = this.structuredGenerate;
    this.inFlight = this.run(snapshot, token, requestToken, null, () => {
      if (firstRequest && structured) {
        return structured(firstRequest);
      }
      return this.generate(snapshot.selectedText);
    });
    return this.inFlight;
  }

  requestStructured(
    request: GenerateAiRequest,
    identity: { conversationId: number; turnId?: number },
  ): Promise<void> | null {
    const generate = this.structuredGenerate;
    if (this.inFlight || !generate) return null;
    const token = this.getProjectToken();
    const requestToken = ++this.activeRequestToken;
    this.inFlight = this.run(
      null,
      token,
      requestToken,
      identity,
      () => generate(request),
    );
    return this.inFlight;
  }

  private async run(
    snapshot: SelectionSnapshot | null,
    token: number,
    requestToken: number,
    identity: RequestIdentity | null,
    generate: () => Promise<GenerateAiResult>,
  ): Promise<void> {
    let result: GenerateAiResult;
    try {
      result = await generate();
    } catch {
      this.inFlight = null;
      if (this.isStale(token, requestToken, identity)) return;
      const error: GenerateAiError = {
        code: "network",
        message: "AI 请求未能完成，请检查连接后重试",
      };
      if (identity && this.callbacks.onStructuredError) {
        this.callbacks.onStructuredError(error, identity);
      } else if (snapshot) {
        this.callbacks.onError(snapshot, error);
      }
      return;
    }

    this.inFlight = null;
    if (this.isStale(token, requestToken, identity)) return;
    if (result.ok) {
      if (identity && this.callbacks.onStructuredSuccess) {
        this.callbacks.onStructuredSuccess(result.content, identity);
      } else if (snapshot) {
        this.callbacks.onSuccess(snapshot, result.content);
      }
    } else if (identity && this.callbacks.onStructuredError) {
      this.callbacks.onStructuredError(result.error, identity);
    } else if (snapshot) {
      this.callbacks.onError(snapshot, result.error);
    }
  }

  private isStale(token: number, requestToken: number, identity: RequestIdentity | null): boolean {
    if (requestToken !== this.activeRequestToken || token !== this.getProjectToken()) return true;
    return identity !== null &&
      (this.getConversationIdentity === null ||
        !sameIdentity(identity, this.getConversationIdentity()));
  }
}

function sameIdentity(left: RequestIdentity | null, right: RequestIdentity | null): boolean {
  return left !== null && right !== null && left.conversationId === right.conversationId && left.turnId === right.turnId;
}
