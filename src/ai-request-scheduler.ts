/**
 * 全局请求调度器（change: add-multi-window-and-fast-lane，第 6 组）。
 *
 * 可配置的全局同时生成上限 + 先到先服务队列：未达上限立即发起，达到上限排队；
 * 名额释放后按序开始。排队中的请求仍占用其所属讨论的单请求锁（讨论内仍至多一轮）。
 * 调度器只管理并发名额与队列；底层生成与讨论级迟到结果隔离由协调器与状态层负责。
 */

export interface ScheduledRequest {
  readonly conversationId: string;
  readonly run: () => Promise<void> | null;
}

export type ScheduleResult = "started" | "queued" | "busy";

/**
 * 全局同时生成上限的默认值。保守但 ≥2：保证「常规生成进行中，及时召唤可并行发起」
 * 的快车道前提；真实接入实测后再据此调整（见 design D4 / D7）。
 */
export const DEFAULT_MAX_CONCURRENT = 2;

export class AiRequestScheduler {
  private readonly maxConcurrent: number;
  private readonly onStart: (conversationId: string) => void;
  private readonly active = new Set<string>();
  private readonly queue: ScheduledRequest[] = [];

  constructor(
    maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
    onStart: (conversationId: string) => void = () => {},
  ) {
    this.maxConcurrent = maxConcurrent;
    this.onStart = onStart;
  }

  /** 当前排队中的请求数。 */
  get queueLength(): number {
    return this.queue.length;
  }

  /** 该讨论是否有请求在生成中或排队中（占用讨论单请求锁）。 */
  isBusy(conversationId: string): boolean {
    return this.active.has(conversationId) || this.queue.some((r) => r.conversationId === conversationId);
  }

  /** 提交请求：立即开始 / 入队 / 拒绝（该讨论已有请求在生成或排队）。 */
  submit(request: ScheduledRequest): ScheduleResult {
    if (this.isBusy(request.conversationId)) return "busy";
    if (this.active.size < this.maxConcurrent) {
      this.start(request);
      return "started";
    }
    this.queue.push(request);
    return "queued";
  }

  /** 取消排队中的请求（停止 / 关闭窗口）。返回是否移除。 */
  cancelQueued(conversationId: string): boolean {
    const index = this.queue.findIndex((r) => r.conversationId === conversationId);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  private start(request: ScheduledRequest): void {
    this.active.add(request.conversationId);
    const promise = request.run();
    if (promise === null) {
      this.active.delete(request.conversationId);
      this.drain();
      return;
    }
    void promise.finally(() => {
      this.active.delete(request.conversationId);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.onStart(next.conversationId);
      this.start(next);
    }
  }
}
