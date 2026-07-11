import type { GenerateAiError, SelectionSnapshot } from "./types";

export type PanelVisibility = "open" | "closed";

export type PanelRequestState =
  | { kind: "idle" }
  | { kind: "loading"; snapshot: SelectionSnapshot }
  | { kind: "success"; snapshot: SelectionSnapshot; response: string }
  | { kind: "error"; snapshot: SelectionSnapshot; error: GenerateAiError }
  | { kind: "configuration_required"; snapshot: SelectionSnapshot };

export interface PanelStateView {
  visibility: PanelVisibility;
  request: PanelRequestState;
}

/**
 * AI 面板的显式状态模型。
 *
 * 两个正交维度：
 * - `visibility`：面板展开 / 收起。收起只改这一个维度，不清空 `request`。
 * - `request`：idle / loading / success / error / configuration_required。
 *
 * 首版采用 `replace-current` 结果策略：新请求用新快照替换整个 `request`，
 * 成功后替换当前回复；行为集中在这一模型里，不散落操作 DOM。
 */
export class AiPanelState {
  private visibility: PanelVisibility = "closed";
  private request: PanelRequestState = { kind: "idle" };
  private readonly onChange: () => void;
  private readonly listeners: Array<() => void> = [];

  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
  }

  /** 注册状态变化监听器（面板渲染订阅用）。 */
  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    this.onChange();
    for (const listener of this.listeners) {
      listener();
    }
  }

  get view(): PanelStateView {
    return { visibility: this.visibility, request: this.request };
  }

  get isOpen(): boolean {
    return this.visibility === "open";
  }

  /** 用户点击“召唤 AI”：展开面板并以本次冻结快照进入 loading。 */
  beginRequest(snapshot: SelectionSnapshot): void {
    this.visibility = "open";
    this.request = { kind: "loading", snapshot };
    this.emit();
  }

  /** 生成成功：更新回复，保持当前 visibility（收起期间完成也不自动展开）。 */
  succeed(snapshot: SelectionSnapshot, response: string): void {
    this.request = { kind: "success", snapshot, response };
    this.emit();
  }

  /** 生成失败：保留原冻结快照，保持当前 visibility。 */
  fail(snapshot: SelectionSnapshot, error: GenerateAiError): void {
    this.request = { kind: "error", snapshot, error };
    this.emit();
  }

  /** 缺少 LLM 配置：保留快照并进入配置引导状态，保持当前 visibility。 */
  requireConfiguration(snapshot: SelectionSnapshot): void {
    this.request = { kind: "configuration_required", snapshot };
    this.emit();
  }

  /** 收起面板：只改 visibility，不清除当前请求/回复。 */
  close(): void {
    if (this.visibility === "closed") return;
    this.visibility = "closed";
    this.emit();
  }

  /** 展开面板：只改 visibility，恢复显示当前请求/回复。 */
  open(): void {
    if (this.visibility === "open") return;
    this.visibility = "open";
    this.emit();
  }

  /**
   * 返回重新发起请求所用的快照。仅当处于 error / configuration_required 时有效，
   * 始终来自原冻结快照，不读取当前编辑器选区。需要用户明确点击“重新请求”。
   */
  retrySnapshot(): SelectionSnapshot | null {
    if (this.request.kind === "error") return this.request.snapshot;
    if (this.request.kind === "configuration_required") return this.request.snapshot;
    return null;
  }

  /** 作品卸载或替换后清空面板状态，避免旧内容污染新作品。 */
  reset(): void {
    this.visibility = "closed";
    this.request = { kind: "idle" };
    this.emit();
  }
}
