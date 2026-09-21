/**
 * 等待计时采集（change: add-multi-window-and-fast-lane，任务 10.1）。
 *
 * 仅用于真实接入验证（第 10 组）：轻量记录每次 AI 请求的提交时间、应用内排队时长、
 * 首次真实模型回应时间与完成时间。不做产品承诺、不上报外部；通过模块级读取接口与
 * `window.__waitTiming`（devtools 控制台）取数。
 *
 * 关键约定（design D7 / specs ai-request-scheduling「等待分段记录」）：
 * - 「首次真实模型回应」= 首个流式增量或完成事件到达，MUST NOT 用排队/等待/思考文案冒充；
 * - 排队时长 = 入队 → 开始生成；提交到首次回应与提交到完成分开记录。
 *
 * 历史保留（change: app-real-chain-validation，design D3）：
 * - 在途记录仍按讨论存 Map（每讨论至多一条）；轮次到达终态（complete）或被同讨论
 *   新一轮 submit 顶替时，整条记录移入有界历史列表，被顶替的在途记录按原样归档；
 * - 历史列表 FIFO 丢最旧，默认上限 500 条（安全上界，可注入小上限以便测试）；
 * - exportJson / summarize 同步覆盖「历史全量 + 当前在途」；clear 同时清空两者。
 */

export interface WaitTimingRecord {
  readonly conversationId: string;
  readonly kind: string;
  readonly submittedAt: number;
  readonly queuedAt: number | null;
  readonly startedAt: number | null;
  readonly firstResponseAt: number | null;
  readonly completedAt: number | null;
}

/** 单次请求的派生时长（毫秒；未发生的事件为 null）。 */
export interface WaitTimingSummary {
  readonly conversationId: string;
  readonly kind: string;
  readonly queuedDurationMs: number | null;
  readonly firstResponseDurationMs: number | null;
  readonly totalDurationMs: number | null;
}

/** 历史列表容量默认上限（design D3：500 条安全上界，非实测结论；可经构造注入小上限测试）。 */
const DEFAULT_TIMING_HISTORY_LIMIT = 500;

export class WaitTimingCollector {
  /** 在途记录，按讨论为键，每讨论至多一条。 */
  private readonly records = new Map<string, WaitTimingRecord>();
  /** 已归档的历史记录，先入在前；含已终态与被顶替的轮次。 */
  private readonly history: WaitTimingRecord[] = [];
  private readonly historyLimit: number;

  constructor(historyLimit: number = DEFAULT_TIMING_HISTORY_LIMIT) {
    this.historyLimit = historyLimit;
  }

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /** 归档一条记录进有界历史（FIFO 丢最旧）。 */
  private archive(record: WaitTimingRecord): void {
    this.history.push(record);
    while (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }

  /** 记录一次请求的提交。同讨论再次提交时，上一条在途记录按原样归档进历史。 */
  submit(conversationId: string, kind: string): void {
    const previous = this.records.get(conversationId);
    if (previous) {
      this.archive(previous);
    }
    this.records.set(conversationId, {
      conversationId,
      kind,
      submittedAt: this.now(),
      queuedAt: null,
      startedAt: null,
      firstResponseAt: null,
      completedAt: null,
    });
  }

  queued(conversationId: string): void {
    const record = this.records.get(conversationId);
    if (record && record.queuedAt === null) {
      (record as { queuedAt: number | null }).queuedAt = this.now();
    }
  }

  started(conversationId: string): void {
    const record = this.records.get(conversationId);
    if (record && record.startedAt === null) {
      (record as { startedAt: number | null }).startedAt = this.now();
    }
  }

  firstResponse(conversationId: string): void {
    const record = this.records.get(conversationId);
    if (record && record.firstResponseAt === null) {
      (record as { firstResponseAt: number | null }).firstResponseAt = this.now();
    }
  }

  /** 记录完成并把这轮记录移入有界历史（终态归档）。 */
  complete(conversationId: string): void {
    const record = this.records.get(conversationId);
    if (record && record.completedAt === null) {
      (record as { completedAt: number | null }).completedAt = this.now();
      this.records.delete(conversationId);
      this.archive(record);
    }
  }

  /** 全量记录 = 历史全量（先入在前）+ 当前在途。 */
  getRecords(): readonly WaitTimingRecord[] {
    return [...this.history, ...this.records.values()];
  }

  /** 派生时长摘要（排队 / 首次回应 / 总时长）。 */
  summarize(): WaitTimingSummary[] {
    return this.getRecords().map((r) => ({
      conversationId: r.conversationId,
      kind: r.kind,
      queuedDurationMs: r.startedAt !== null && r.queuedAt !== null ? r.startedAt - r.queuedAt : null,
      firstResponseDurationMs:
        r.firstResponseAt !== null && r.startedAt !== null ? r.firstResponseAt - r.startedAt : null,
      totalDurationMs: r.completedAt !== null ? r.completedAt - r.submittedAt : null,
    }));
  }

  exportJson(): string {
    return JSON.stringify({ records: this.getRecords(), summary: this.summarize() }, null, 2);
  }

  clear(): void {
    this.records.clear();
    this.history.length = 0;
  }
}

/** 应用内共享的等待计时采集器单例。 */
export const waitTiming = new WaitTimingCollector();
