import type { GenerateAiError, GenerateAiResult, SelectionSnapshot } from "./types";

export interface AiRequestCallbacks {
  onSuccess(snapshot: SelectionSnapshot, content: string): void;
  onError(snapshot: SelectionSnapshot, error: GenerateAiError): void;
}

/**
 * 单请求协调器（single-in-flight）。
 *
 * 同一时间只允许一个 AI 请求。生成期间编辑器继续可用（本协调器不碰编辑器 DOM），
 * 但浮动入口会禁用，无法发起第二个请求：当已有请求进行时，`request` 返回 null 且
 * 根本不执行第二个 client 调用，从根上避免结果乱序。
 *
 * 请求结果受当前作品实例令牌隔离：发起时记录令牌，返回时若令牌已变（作品卸载或替换），
 * 迟到结果被忽略，不会更新新作品或重新打开面板。进入配置页不卸载作品，因此令牌不变，
 * 请求可继续完成，但配置页返回不会自动发起第二个调用。
 */
export class AiRequestCoordinator {
  private inFlight: Promise<void> | null = null;
  private readonly generate: (selectedText: string) => Promise<GenerateAiResult>;
  private readonly callbacks: AiRequestCallbacks;
  private readonly getProjectToken: () => number;

  constructor(
    generate: (selectedText: string) => Promise<GenerateAiResult>,
    callbacks: AiRequestCallbacks,
    getProjectToken: () => number,
  ) {
    this.generate = generate;
    this.callbacks = callbacks;
    this.getProjectToken = getProjectToken;
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /**
   * 发起一次生成请求。若已有请求进行中，返回 `null` 且不执行第二个 client 调用。
   */
  request(snapshot: SelectionSnapshot): Promise<void> | null {
    if (this.inFlight) {
      return null;
    }
    const token = this.getProjectToken();
    this.inFlight = this.run(snapshot, token);
    return this.inFlight;
  }

  private async run(snapshot: SelectionSnapshot, token: number): Promise<void> {
    try {
      const result = await this.generate(snapshot.selectedText);
      // 在回调之前解锁，使成功/失败后用户可立即再次召唤
      this.inFlight = null;
      if (token !== this.getProjectToken()) {
        // 作品已被卸载或替换：忽略迟到结果，不污染新作品
        return;
      }
      if (result.ok) {
        this.callbacks.onSuccess(snapshot, result.content);
      } else {
        this.callbacks.onError(snapshot, result.error);
      }
    } catch {
      this.inFlight = null;
      if (token !== this.getProjectToken()) {
        return;
      }
      this.callbacks.onError(snapshot, {
        code: "network",
        message: "AI 请求未能完成，请检查连接后重试",
      });
    }
  }
}
