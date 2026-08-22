import type { AiPanelDom } from "../src/dom.ts";

export type Listener = (event: FakeEvent) => void;

export class FakeClassList {
  private readonly values = new Set<string>();

  constructor(initial: string[] = []) {
    for (const value of initial) this.values.add(value);
  }

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

export class FakeEvent {
  defaultPrevented = false;
  readonly type: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;

  constructor(type: string, key = "", shiftKey = false, isComposing = false) {
    this.type = type;
    this.key = key;
    this.shiftKey = shiftKey;
    this.isComposing = isComposing;
  }

  preventDefault(): void { this.defaultPrevented = true; }
}

export class FakeElement {
  readonly classList: FakeClassList;
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly queryResults = new Map<string, FakeElement | null>();
  textContent = "";
  value = "";
  disabled = false;
  focusCount = 0;
  scrollTop = 0;
  querySelectorCalls = 0;
  readonly id: string;

  constructor(id: string, classes: string[] = []) {
    this.id = id;
    this.classList = new FakeClassList(classes);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(
    type: string,
    options: { key?: string; shiftKey?: boolean; isComposing?: boolean } = {},
  ): FakeEvent {
    const event = new FakeEvent(type, options.key, options.shiftKey, options.isComposing);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  append(...children: FakeElement[]): void { this.children.push(...children); }
  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }
  focus(): void { this.focusCount += 1; }
  querySelector<T>(selector: string): T | null {
    this.querySelectorCalls += 1;
    return (this.queryResults.get(selector) ?? null) as T | null;
  }
}

/** AI 面板契约所需的全部节点 ID（与 index.html 保持一致）。 */
export const AI_PANEL_NODE_IDS = [
  "ai-panel", "ai-snapshot-block", "ai-snapshot-text", "ai-loading",
  "ai-response", "ai-thinking-expansion-prestate", "ai-thinking-expansion-title",
  "ai-thinking-expansion-count", "ai-thinking-expansion-form",
  "ai-thinking-expansion-input", "ai-thinking-expansion-start",
  "ai-error-block", "ai-error-message", "ai-retry", "ai-config-block",
  "ai-go-config", "ai-panel-collapse", "ai-conversation", "ai-follow-up-form",
  "ai-follow-up-input", "ai-follow-up-send", "ai-follow-up-error",
  "ai-follow-up-error-message", "ai-follow-up-retry", "ai-follow-up-edit",
  "btn-toggle-ai",
] as const;

/**
 * 构造一份完整的 AI 面板 DOM 契约 fixture。
 *
 * `elements` 以节点 ID 为键，供断言按 ID 读取；`dom` 是可直接传给
 * `setupAiPanel` 的显式契约。面板的 `.ai-panel-body` 由契约的 `panelBody`
 * 字段提供，不再依赖面板内部查询。
 */
export function createAiPanelDomFixture(): {
  elements: Map<string, FakeElement>;
  dom: AiPanelDom;
} {
  const elements = new Map<string, FakeElement>();
  for (const id of AI_PANEL_NODE_IDS) {
    elements.set(id, new FakeElement(id, ["hidden"]));
  }
  const panelBody = new FakeElement("ai-panel-body", ["ai-panel-body"]);
  const panel = elements.get("ai-panel")!;
  panel.queryResults.set(".ai-panel-body", panelBody);

  const dom = {
    panel,
    panelBody,
    snapshotBlock: elements.get("ai-snapshot-block")!,
    snapshotText: elements.get("ai-snapshot-text")!,
    loading: elements.get("ai-loading")!,
    response: elements.get("ai-response")!,
    thinkingExpansionPrestate: elements.get("ai-thinking-expansion-prestate")!,
    thinkingExpansionTitle: elements.get("ai-thinking-expansion-title")!,
    thinkingExpansionCount: elements.get("ai-thinking-expansion-count")!,
    thinkingExpansionForm: elements.get("ai-thinking-expansion-form")!,
    thinkingExpansionInput: elements.get("ai-thinking-expansion-input")!,
    thinkingExpansionStart: elements.get("ai-thinking-expansion-start")!,
    errorBlock: elements.get("ai-error-block")!,
    errorMessage: elements.get("ai-error-message")!,
    retryBtn: elements.get("ai-retry")!,
    configBlock: elements.get("ai-config-block")!,
    goConfigBtn: elements.get("ai-go-config")!,
    collapseBtn: elements.get("ai-panel-collapse")!,
    toggleBtn: elements.get("btn-toggle-ai")!,
    conversation: elements.get("ai-conversation")!,
    followUpForm: elements.get("ai-follow-up-form")!,
    followUpInput: elements.get("ai-follow-up-input")!,
    followUpSend: elements.get("ai-follow-up-send")!,
    followUpError: elements.get("ai-follow-up-error")!,
    followUpErrorMessage: elements.get("ai-follow-up-error-message")!,
    followUpRetry: elements.get("ai-follow-up-retry")!,
    followUpEdit: elements.get("ai-follow-up-edit")!,
  } as unknown as AiPanelDom;

  return { elements, dom };
}

/**
 * 安装一个按需返回 `FakeElement` 的全局 `document`，用于 `getAppDom()` 组装测试。
 *
 * - `missingIds`：这些 ID 的 `getElementById` 返回 `null`，模拟页面缺节点。
 * - `panelBody`：`#ai-panel` 的 `.ai-panel-body` 查询结果；传 `null` 模拟缺 body。
 */
export function installFakeDocument(options: {
  missingIds?: readonly string[];
  panelBody?: FakeElement | null;
} = {}): { elements: Map<string, FakeElement>; restore(): void } {
  const elements = new Map<string, FakeElement>();
  const missing = new Set(options.missingIds ?? []);
  const panelBody = options.panelBody === undefined
    ? new FakeElement("ai-panel-body", ["ai-panel-body"])
    : options.panelBody;
  if (!missing.has("ai-panel")) {
    const panel = new FakeElement("ai-panel", ["hidden"]);
    panel.queryResults.set(".ai-panel-body", panelBody);
    elements.set("ai-panel", panel);
  }

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => {
      if (missing.has(id)) return null;
      let element = elements.get(id);
      if (!element) {
        element = new FakeElement(id);
        elements.set(id, element);
      }
      return element;
    },
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  return {
    elements,
    restore: () => { globalThis.document = previousDocument; },
  };
}