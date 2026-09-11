import type { AiDockDom, AiWindowDom } from "../src/dom.ts";

export type Listener = (event: FakeEvent) => void;

export class FakeClassList {
  readonly values = new Set<string>();

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
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly pointerId: number;
  readonly target: unknown;

  constructor(
    type: string,
    options: {
      key?: string;
      shiftKey?: boolean;
      isComposing?: boolean;
      clientX?: number;
      clientY?: number;
      button?: number;
      pointerId?: number;
      target?: unknown;
    } = {},
  ) {
    this.type = type;
    this.key = options.key ?? "";
    this.shiftKey = options.shiftKey ?? false;
    this.isComposing = options.isComposing ?? false;
    this.clientX = options.clientX ?? 0;
    this.clientY = options.clientY ?? 0;
    this.button = options.button ?? 0;
    this.pointerId = options.pointerId ?? 1;
    this.target = options.target;
  }

  preventDefault(): void { this.defaultPrevented = true; }
}

export class FakeElement {
  readonly classList: FakeClassList;
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly queryResults = new Map<string, FakeElement | null>();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  textContent = "";
  value = "";
  disabled = false;
  focusCount = 0;
  scrollTop = 0;
  querySelectorCalls = 0;
  parentElement: FakeElement | null = null;
  readonly id: string;
  tag: string;
  /** 模板元素的内容（供 cloneWindowRoot 使用）。 */
  content: { firstElementChild: FakeElement | null } | null = null;

  constructor(id: string, classes: string[] = []) {
    this.id = id;
    this.tag = "div";
    this.classList = new FakeClassList(classes);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(
    type: string,
    options: { key?: string; shiftKey?: boolean; isComposing?: boolean; clientX?: number; clientY?: number; button?: number; pointerId?: number; target?: unknown } = {},
  ): FakeEvent {
    const event = new FakeEvent(type, options);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  appendChild(child: FakeElement): void { this.append(child); }
  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.append(...children);
  }
  remove(): void {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index !== -1) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }
  }
  contains(node: unknown): boolean {
    return this === node || this.children.some((child) => child.contains(node));
  }
  focus(): void { this.focusCount += 1; }
  querySelector<T>(selector: string): T | null {
    this.querySelectorCalls += 1;
    return (this.queryResults.get(selector) ?? null) as T | null;
  }
  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, right: 420, bottom: 800, width: 420, height: 800 } as DOMRect;
  }
  setPointerCapture(): void {}
  setAttribute(): void {}
  cloneNode(): FakeElement {
    const copy = new FakeElement(this.id);
    for (const cls of this.classList.values) copy.classList.add(cls);
    copy.textContent = this.textContent;
    copy.value = this.value;
    copy.disabled = this.disabled;
    for (const [selector, result] of this.queryResults) {
      copy.queryResults.set(selector, result ? result.cloneNode() : null);
    }
    for (const child of this.children) {
      copy.append(child.cloneNode());
    }
    return copy;
  }
}

/** 窗口模板里所需的全部 `data-role`。 */
export const AI_WINDOW_ROLES = [
  "drag-handle", "grip", "status-dot", "title", "doc", "badge",
  "stop", "more", "close", "body", "resize",
  "snapshot-block", "snapshot-text", "welcome", "loading", "response",
  "error-block", "error-message", "retry", "config-block", "go-config",
  "conversation",
  "follow-up-form", "follow-up-input", "follow-up-send",
  "follow-up-error", "follow-up-error-message", "follow-up-retry", "follow-up-edit",
  "direct-question", "direct-question-selection", "direct-question-selection-text",
  "direct-question-selection-remove", "direct-question-form", "direct-question-input",
  "direct-question-send", "direct-question-error", "direct-question-error-message",
  "direct-question-config", "direct-question-go-config",
] as const;

/** 构造一个窗口根节点 fixture（含全部 data-role 子节点的 queryResults）。 */
export function createAiWindowFixture(conversationId: string): {
  root: FakeElement;
  roles: Map<string, FakeElement>;
} {
  const root = new FakeElement(`ai-window-${conversationId}`, ["ai-window"]);
  const roles = new Map<string, FakeElement>();
  for (const role of AI_WINDOW_ROLES) {
    const el = new FakeElement(`role-${role}`);
    if (role === "snapshot-text" || role === "response" || role === "direct-question-selection-text") {
      el.tag = "pre";
    } else if (role === "follow-up-form" || role === "direct-question-form") {
      el.tag = "form";
    } else if (role === "follow-up-input" || role === "direct-question-input") {
      el.tag = "textarea";
    } else if (role.endsWith("-send") || role === "stop" || role === "more" || role === "close" || role === "retry" || role === "go-config" || role === "follow-up-retry" || role === "follow-up-edit" || role === "direct-question-selection-remove" || role === "direct-question-go-config") {
      el.tag = "button";
    }
    roles.set(role, el);
    root.queryResults.set(`[data-role="${role}"]`, el);
  }
  // 嵌套结构：body 内是各区块，input 内是追问/直接提问表单。
  const body = roles.get("body")!;
  for (const role of ["snapshot-block", "snapshot-text", "welcome", "loading", "response", "conversation", "error-block", "error-message", "retry", "config-block", "go-config", "follow-up-error", "follow-up-error-message", "follow-up-retry", "follow-up-edit"]) {
    body.append(roles.get(role)!);
  }
  const input = new FakeElement("role-input");
  roles.set("input", input);
  root.queryResults.set('[data-role="input"]', input);
  input.append(
    roles.get("follow-up-form")!,
    roles.get("direct-question")!,
  );
  const head = roles.get("drag-handle")!;
  head.append(
    roles.get("grip")!, roles.get("status-dot")!, roles.get("title")!,
    roles.get("doc")!, roles.get("badge")!, roles.get("stop")!,
    roles.get("more")!, roles.get("close")!,
  );
  root.append(head, body, input, roles.get("resize")!);
  return { root, roles };
}

/** 构造一个停靠区 DOM 契约 fixture（含窗口模板，clone 产生新窗口 fixture）。 */
export function createAiDockDomFixture(): {
  elements: Map<string, FakeElement>;
  dom: AiDockDom;
  windowRoots: FakeElement[];
} {
  const elements = new Map<string, FakeElement>();
  const windowRoots: FakeElement[] = [];

  const dock = new FakeElement("ai-dock", ["ai-dock"]);
  const rail = new FakeElement("ai-dock-rail", ["ai-dock-rail", "hidden"]);
  const count = new FakeElement("ai-dock-count");
  const notice = new FakeElement("ai-dock-notice", ["hidden"]);
  const body = new FakeElement("ai-dock-body", ["ai-dock-body"]);
  const floatLayer = new FakeElement("ai-dock-float-layer", ["ai-dock-float-layer"]);
  const listToggleBtn = new FakeElement("ai-conversation-list-toggle");
  const newConversationBtn = new FakeElement("ai-new-conversation");
  const moreBtn = new FakeElement("ai-dock-more");
  const collapseBtn = new FakeElement("ai-dock-collapse");
  const conversationList = new FakeElement("ai-conversation-list", ["hidden"]);
  const conversationListCloseBtn = new FakeElement("ai-conversation-list-close");
  const conversationListItems = new FakeElement("ai-conversation-list-items");
  const conversationListEmpty = new FakeElement("ai-conversation-list-empty", ["hidden"]);
  const listNewConversationBtn = new FakeElement("ai-list-new-conversation");
  const searchInput = new FakeElement("ai-conversation-list-filter");
  const railNewBtn = new FakeElement("ai-rail-new");
  const railListBtn = new FakeElement("ai-rail-list");
  const railMoreBtn = new FakeElement("ai-rail-more");
  const railExpandBtn = new FakeElement("ai-rail-expand");
  const railDot = new FakeElement("ai-rail-dot", ["hidden"]);

  const template = new FakeElement("ai-window-template");
  const templateRoot = createAiWindowFixture("__template__").root;
  template.content = { firstElementChild: templateRoot };
  // cloneWindowRoot 克隆 template.content.firstElementChild；每次克隆生成全新窗口 fixture 并记录。
  templateRoot.cloneNode = () => {
    const win = createAiWindowFixture(`w${windowRoots.length + 1}`);
    windowRoots.push(win.root);
    return win.root;
  };

  for (const el of [dock, rail, count, notice, body, floatLayer, listToggleBtn, newConversationBtn, moreBtn, collapseBtn, conversationList, conversationListCloseBtn, conversationListItems, conversationListEmpty, listNewConversationBtn, searchInput, railNewBtn, railListBtn, railMoreBtn, railExpandBtn, railDot, template]) {
    elements.set(el.id, el);
  }

  const dom = {
    root: dock as unknown as HTMLElement,
    rail: rail as unknown as HTMLElement,
    count: count as unknown as HTMLElement,
    notice: notice as unknown as HTMLElement,
    body: body as unknown as HTMLElement,
    floatLayer: floatLayer as unknown as HTMLElement,
    windowTemplate: template as unknown as HTMLTemplateElement,
    listToggleBtn: listToggleBtn as unknown as HTMLButtonElement,
    newConversationBtn: newConversationBtn as unknown as HTMLButtonElement,
    moreBtn: moreBtn as unknown as HTMLButtonElement,
    collapseBtn: collapseBtn as unknown as HTMLButtonElement,
    conversationList: conversationList as unknown as HTMLElement,
    conversationListCloseBtn: conversationListCloseBtn as unknown as HTMLButtonElement,
    conversationListItems: conversationListItems as unknown as HTMLElement,
    conversationListEmpty: conversationListEmpty as unknown as HTMLElement,
    listNewConversationBtn: listNewConversationBtn as unknown as HTMLButtonElement,
    searchInput: searchInput as unknown as HTMLInputElement,
    railNewBtn: railNewBtn as unknown as HTMLButtonElement,
    railListBtn: railListBtn as unknown as HTMLButtonElement,
    railMoreBtn: railMoreBtn as unknown as HTMLButtonElement,
    railExpandBtn: railExpandBtn as unknown as HTMLButtonElement,
    railDot: railDot as unknown as HTMLElement,
  } as unknown as AiDockDom;

  return { elements, dom, windowRoots };
}

/** 构造单个窗口的 DOM 契约（直接给 root，不经过模板）。 */
export function createAiWindowDomFixture(conversationId: string): {
  root: FakeElement;
  roles: Map<string, FakeElement>;
} {
  return createAiWindowFixture(conversationId);
}

/**
 * 安装一个按需返回 `FakeElement` 的全局 `document`，用于 `getAppDom()` 组装测试。
 * `missingIds` 中列出的 ID 返回 null，模拟页面缺节点。
 */
export function installFakeDocument(options: {
  missingIds?: readonly string[];
} = {}): { elements: Map<string, FakeElement>; restore(): void } {
  const elements = new Map<string, FakeElement>();
  const missing = new Set(options.missingIds ?? []);
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
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  } as unknown as Document;
  return {
    elements,
    restore: () => { globalThis.document = previousDocument; },
  };
}

/** 导出给测试断言用的窗口契约类型引用（避免误用）。 */
export type { AiWindowDom };

/** 安装供窗口渲染使用的假全局 document（createElement 返回 FakeElement）。 */
export function installDocument(): { restore(): void } {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: {
      classList: new FakeClassList(),
      appendChild: () => {},
      removeChild: () => {},
    },
  } as unknown as Document;
  return { restore: () => { globalThis.document = previousDocument; } };
}

/** 安装 AI feature 集成测试所需的完整假 DOM 环境（停靠区 + 编辑器 + 全局 document）。 */
export function installAiFeatureEnvironment(): {
  elements: Map<string, FakeElement>;
  dom: AiDockDom;
  windowRoots: FakeElement[];
  editor: FakeElement;
  btnToggleAi: FakeElement;
  restore(): void;
} {
  const { elements, dom, windowRoots } = createAiDockDomFixture();
  const editor = new FakeElement("editor-textarea");
  editor.value = "用户正文";
  elements.set("editor-textarea", editor);
  const btnToggleAi = new FakeElement("btn-toggle-ai");
  elements.set("btn-toggle-ai", btnToggleAi);
  const documentRestore = installDocument();
  return {
    elements,
    dom,
    windowRoots,
    editor,
    btnToggleAi,
    restore: () => { documentRestore.restore(); },
  };
}
