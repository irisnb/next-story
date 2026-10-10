import type { AiDockDom } from "./dom.ts";
import { setupAiWindow, windowStatusOf, type AiWindowController, type AiWindowActions } from "./ai-window.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import type { ConversationSummary } from "./conversation-archive.ts";
import {
  buildConversationGroups,
  describeConversationStatus,
  describeWindowStatus,
  displayFocusDocumentTitle,
  type ConversationListItem,
  type ConversationGroup,
} from "./ai-panel-conversation-list.ts";

/** 等待计时导出的结果投影（由接线层把保存对话框与后端结果折算成此形状）。 */
export interface WaitTimingExportOutcome {
  readonly ok: boolean;
  /** 用户关闭保存对话框；此时不产生任何提示。 */
  readonly cancelled: boolean;
  /** 本次导出的记录条数（成功提示条显示用）。 */
  readonly count: number;
  /** 失败时的中文说明。 */
  readonly message?: string;
}

/** 窗口管理器对外动作（由 ai-feature 接线）。 */
export interface AiDockActions {
  openConfigPage: () => void;
  onSubmitFollowUp: (question: string) => Promise<boolean>;
  onRetryFollowUp: () => Promise<boolean>;
  onEditFollowUp: (question: string) => Promise<boolean>;
  onRetryStoppedFollowUp: () => Promise<boolean>;
  onRetry: () => void;
  onSubmitDirectQuestion: (question: string) => Promise<boolean>;
  onRemoveDirectQuestionSelection: () => void;
  onDirectQuestionFocus: () => void;
  /** 停止指定讨论的当前生成。 */
  onStop: (conversationId: string) => void;
  /** 关闭指定讨论的窗口（只结束显示）。 */
  onClose: (conversationId: string) => void;
  /** 删除指定讨论（独立动作，先停后删）。 */
  onDelete: (conversationId: string) => Promise<void>;
  onOpenDiscussion: (summary: ConversationSummary) => void;
  onNewConversation: () => void;
  /** 重命名讨论（持久化自定义标题）。 */
  onRename: (conversationId: string, title: string) => Promise<boolean>;
  /** 置顶 / 取消置顶讨论（持久化）。 */
  onTogglePin: (conversationId: string) => Promise<boolean>;
  /** 撤销最近一次删除。 */
  onUndoDelete: () => void;
  /** 当前可撤销的删除提示（无则 null）。 */
  getUndoNotice: () => { title: string } | null;
  /** 是否有任何等待计时记录（历史全量 + 当前在途）。 */
  hasWaitTimingData: () => boolean;
  /** 导出等待计时数据：弹保存对话框并写入用户选择的位置（设计稿 D2）。 */
  exportWaitTiming: () => Promise<WaitTimingExportOutcome>;
  /** 清空等待计时数据（内存记录；已导出文件不受影响）。 */
  clearWaitTiming: () => void;
  /** 显式切换某讨论的关注文档（查看其他文档不自动改绑）。 */
  onSwitchFocusDocument: (conversationId: string, documentId: string, documentTitle: string) => void;
  /** 当前作品允许 AI 查看的文档（关注文档选择器候选）。 */
  getVisibleDocuments: () => ReadonlyArray<{ id: string; name: string }>;
  /** 按文档 ID 解析文档标题；未知返回 null。 */
  resolveDocumentTitle: (documentId: string) => string | null;
  /** 文档当前是否不允许 AI 查看（隐藏来源必须脱敏）。 */
  isDocumentHidden: (documentId: string) => boolean;
  /** 用户对按需补读授权请求的决定（任务 7.1）：允许 / 拒绝。 */
  onResolveReadingRequest: (conversationId: string, granted: boolean) => void;
  /**
   * 讨论内授权开关（任务 7.2）：开启 / 关闭按需补读。关闭立即阻止后续读取，
   * 不清除已读内容（后端语义）。
   */
  onToggleOnDemandReading: (conversationId: string, granted: boolean) => void;
}

interface WindowEntry {
  readonly controller: AiWindowController;
  readonly cleanups: Array<() => void>;
}

export interface AiDockController {
  destroy(): void;
}

function cloneWindowRoot(template: HTMLTemplateElement): HTMLElement {
  const node = template.content.firstElementChild;
  if (!node) throw new Error("窗口模板缺少根节点");
  return node.cloneNode(true) as HTMLElement;
}

/**
 * 讨论是否为及时召唤类（讨论维度判定）：及时召唤讨论的常规现场材料不自动
 * 附带（快车道隔离），「切换关注文档」入口对它不提供——「从下一轮开始使用」
 * 的承诺无法成立（automatic-story-context delta）。
 *
 * 同形判据与取材注入同源：ai-feature-request-materials.ts 的
 * withFocusDocumentIdentity（首轮 request.kind === "summon"；追问看
 * initialUserMaterial.kind）。停靠区不得反向依赖编排层内部模块（依赖方向
 * 见 ai-module-boundaries 测试），故此处按同形判断实现，两处判据须同步修改。
 * 首轮在途（对话尚未建立）时回退看 pendingFirstRequest.kind，与窗口模块
 * 读取讨论首轮材料的回退次序一致。
 */
function isSummonDiscussion(
  discussion: Readonly<{
    conversation?: Readonly<{ initialUserMaterial?: Readonly<{ kind?: string }> }> | null;
    pendingFirstRequest?: Readonly<{ kind?: string }> | null;
  }> | null | undefined,
): boolean {
  const material =
    discussion?.conversation?.initialUserMaterial ?? discussion?.pendingFirstRequest ?? null;
  return material?.kind === "summon";
}

/**
 * 单面板显示管理器：仅挂载当前讨论，切换只卸载显示控制器。
 * 所有讨论的请求、历史与草稿继续归 AiPanelState 所有。
 */
export function setupAiDock(
  dom: AiDockDom,
  state: AiPanelState,
  actions: AiDockActions,
): AiDockController {
  const windows = new Map<string, WindowEntry>();
  // 仅保存滚动位置；请求、历史与输入草稿仍由状态层持有。
  const scrollMemory = new Map<string, { scrollTop: number; pinnedToBottom: boolean }>();
  let conversationListOpen = false;
  let pendingDeleteId: string | null = null;
  let renamingId: string | null = null;
  let listFilter = "";
  let expandedEarlier = false;
  let menu: HTMLElement | null = null;
  let destroyed = false;
  let maximized = false;
  let panelWidth = 0;
  let resizePointer: number | null = null;
  function setPanelWidth(width: number): void {
    const available = dom.root.parentElement?.getBoundingClientRect().width || 1024;
    panelWidth = Math.max(300, Math.min(width, available / 2));
    dom.root.style.width = maximized ? "100%" : `${panelWidth}px`;
    dom.divider.setAttribute("aria-valuemin", "300");
    dom.divider.setAttribute("aria-valuemax", String(Math.floor(available / 2)));
    dom.divider.setAttribute("aria-valuenow", String(Math.round(panelWidth)));
  }

  function buildWindowActions(conversationId: string): AiWindowActions {
    return {
      onRetry: actions.onRetry,
      onRetryFollowUp: actions.onRetryFollowUp,
      onRetryStoppedFollowUp: actions.onRetryStoppedFollowUp,
      onGoToConfig: actions.openConfigPage,
      onSubmitFollowUp: actions.onSubmitFollowUp,
      onEditFollowUp: actions.onEditFollowUp,
      onSubmitDirectQuestion: actions.onSubmitDirectQuestion,
      onRemoveDirectQuestionSelection: actions.onRemoveDirectQuestionSelection,
      onDirectQuestionFocus: actions.onDirectQuestionFocus,
      onStop: () => actions.onStop(conversationId),
      onClose: () => actions.onClose(conversationId),
      onNewConversation: () => actions.onNewConversation(),
      // 及时召唤讨论不提供「切换关注文档」入口（automatic-story-context delta）：
      // 常规现场材料在这类讨论中不自动附带，「从下一轮开始使用」的承诺无法成立。
      // 窗口头按钮的可见性以 `onOpenFocusPicker !== undefined` 为准（ai-window.ts
      // 契约「缺省不显示入口」），故用 getter 按次求值：召唤讨论返回 undefined 即
      // 隐藏；首轮在途时也能按 pendingFirstRequest 判定（判据与取材注入同源）。
      get onOpenFocusPicker() {
        return isSummonDiscussion(state.getDiscussion(conversationId))
          ? undefined
          : (anchor: HTMLElement) => openFocusDocumentMenu(anchor, conversationId);
      },
      onResolveReadingRequest: (granted) => actions.onResolveReadingRequest(conversationId, granted),
      resolveDocumentTitle: actions.resolveDocumentTitle,
      isDocumentHidden: actions.isDocumentHidden,
    };
  }

  function createWindow(conversationId: string): void {
    const root = cloneWindowRoot(dom.windowTemplate);
    root.dataset.conversationId = conversationId;
    let memory = scrollMemory.get(conversationId);
    if (!memory) {
      memory = { scrollTop: 0, pinnedToBottom: true };
      scrollMemory.set(conversationId, memory);
    }
    const controller = setupAiWindow(root, state, conversationId, buildWindowActions(conversationId), memory);
    const entry: WindowEntry = {
      controller,
      cleanups: [],
    };
    windows.set(conversationId, entry);

    const handleMore = (event: MouseEvent): void => {
      event.stopPropagation();
      openWindowMenu(controller.dom.moreBtn, conversationId);
    };
    controller.dom.moreBtn.addEventListener("click", handleMore);
    entry.cleanups.push(() => controller.dom.moreBtn.removeEventListener("click", handleMore));

    root.classList.add("ai-discussion-projection");
    dom.body.appendChild(root);
  }

  function destroyWindow(conversationId: string): void {
    const entry = windows.get(conversationId);
    if (!entry) return;
    for (const cleanup of entry.cleanups) cleanup();
    entry.cleanups.length = 0;
    entry.controller.destroy();
    windows.delete(conversationId);
  }

  // ===== 菜单 =====
  interface MenuItem {
    icon?: string;
    label?: string;
    disabled?: boolean;
    danger?: boolean;
    divider?: boolean;
    /** 悬停说明（禁用项用它解释为什么点不动）。 */
    title?: string;
    action?: () => void;
  }

  function openWindowMenu(anchor: HTMLElement, conversationId: string): void {
    closeMenu();
    const discussion = state.getDiscussion(conversationId);
    // 及时召唤讨论不提供「切换关注文档」（automatic-story-context delta）：常规
    // 现场材料在这类讨论中不自动附带，「从下一轮开始使用」的承诺无法成立。
    // 判据见上方模块级 isSummonDiscussion（与取材注入同源）。
    // 菜单其余条目照常提供，仅本条目整体不渲染（不是置灰）。
    const summonDiscussion = isSummonDiscussion(discussion);
    const canSwitchFocus =
      !summonDiscussion &&
      discussion !== null &&
      discussion.focusDocumentId !== null &&
      discussion.conversation?.restricted !== true;
    // 按需补读授权开关（任务 7.2）：随时开 / 关。关闭文案明示「不清除已读内容」；
    // 授权与停止生成解耦（停止只结束当前轮，不改授权状态）。
    const readingEnabled = state.onDemandReadingEnabledOf(conversationId);
    menu = buildMenu([
      // 非召唤讨论保留既有行为：无关注文档或受限时条目置灰（不消失）。
      ...(summonDiscussion
        ? []
        : [{
            icon: "i-doc",
            label: "切换关注文档…",
            disabled: !canSwitchFocus,
            action: () => openFocusDocumentMenu(anchor, conversationId),
          }]),
      { icon: "i-info", label: "本次参考了什么", action: () => windows.get(conversationId)?.controller.toggleMaterials() },
      {
        icon: "i-doc",
        label: readingEnabled ? "关闭按需补读（不清除已读内容）" : "开启按需补读",
        action: () => actions.onToggleOnDemandReading(conversationId, !readingEnabled),
      },
      { divider: true },
      { icon: "i-trash", label: "删除讨论…", danger: true, action: () => {
        conversationListOpen = true;
        renamingId = null;
        pendingDeleteId = conversationId;
        dom.searchInput.value = "";
        listFilter = "";
        expandedEarlier = true;
        renderConversationList();
        dom.conversationList.querySelector<HTMLButtonElement>(".ai-cl-confirm .danger")?.focus();
      } },
    ]);
    positionMenu(menu, anchor);
  }

  /**
   * 「切换关注文档」选择器：只列出当前允许 AI 查看的文档；选择后显式改绑，
   * 从下一轮生效。查看其他文档不会自动改绑（任务 3.3）。
   */
  function openFocusDocumentMenu(anchor: HTMLElement, conversationId: string): void {
    closeMenu();
    const current = state.getDiscussion(conversationId)?.focusDocumentId ?? null;
    const documents = actions.getVisibleDocuments();
    if (documents.length === 0) {
      menu = buildMenu([{ label: "没有可切换的文档", disabled: true }]);
    } else {
      menu = buildMenu(documents.map((doc) => ({
        icon: "i-doc",
        label: doc.id === current ? `${doc.name}（当前关注）` : doc.name,
        action: () => {
          if (doc.id === current) return;
          actions.onSwitchFocusDocument(conversationId, doc.id, doc.name);
          // 明确切换后给出清晰提示：从下一轮起使用新关注文档。
          windows.get(conversationId)?.controller.showFocusNotice(
            `已切换关注文档：《${doc.name}》。从下一轮开始使用。`,
          );
        },
      })));
    }
    positionMenu(menu, anchor);
  }

  // ===== 等待计时导出提示（app-real-chain-validation 任务 1.4 / 设计稿 ui-design/notes.md） =====
  // 停靠区层提示条：后出现的顶替先前的；成功态数秒自动消失，警示态与清空确认态
  // 常驻到用户处理或被下一条提示顶替。
  type TimingNotice = { kind: "ok" | "warn" | "confirm"; text: string };
  const TIMING_NOTICE_TIMEOUT_MS = 6000; // 与删除撤销提示同寿命
  let timingNotice: TimingNotice | null = null;
  let timingNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimingNoticeTimer(): void {
    if (timingNoticeTimer) {
      clearTimeout(timingNoticeTimer);
      timingNoticeTimer = null;
    }
  }

  // 顶替规则（设计稿 §6.3：后出现的顶替先前的）：撤销 / 保存失败提示在计时提示
  // 之后出现时（与上次渲染相比发生了变化），计时提示让位。对比「上次渲染值」
  // 而非只看存在性，避免旧的撤销/保存失败提示把刚出的计时提示顶掉。
  let lastUndoTitle: string | null = null;
  let lastSaveError: string | null = null;

  /** 撤销 / 保存失败提示是否比当前计时提示更新（是则计时提示让位）。 */
  function newerDockNoticePreempts(): boolean {
    const undoTitle = actions.getUndoNotice()?.title ?? null;
    const saveError = state.saveError;
    const undoIsNewer = undoTitle !== null && undoTitle !== lastUndoTitle;
    const errorIsNewer = saveError !== null && saveError !== lastSaveError;
    return undoIsNewer || errorIsNewer;
  }

  function showTimingNotice(notice: TimingNotice, autoDismiss: boolean): void {
    clearTimingNoticeTimer();
    timingNotice = notice;
    if (autoDismiss) {
      const timer = setTimeout(() => {
        timingNoticeTimer = null;
        timingNotice = null;
        updateDockChrome();
      }, TIMING_NOTICE_TIMEOUT_MS);
      timer.unref?.();
      timingNoticeTimer = timer;
    }
    updateDockChrome();
  }

  function dismissTimingNotice(): void {
    clearTimingNoticeTimer();
    if (timingNotice === null) return;
    timingNotice = null;
    updateDockChrome();
  }

  function renderTimingNotice(notice: TimingNotice): void {
    if (notice.kind === "confirm") {
      // 清空确认：确认按钮用危险实底（复用 .ai-cl-btn.danger 配色），取消恢复原状。
      dom.notice.classList.remove("hidden", "ok");
      dom.notice.classList.add("warn");
      const text = document.createElement("span");
      text.textContent = notice.text;
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.classList.add("ai-cl-btn", "danger");
      clearBtn.style.marginLeft = "auto";
      clearBtn.textContent = "清空";
      clearBtn.addEventListener("click", () => {
        actions.clearWaitTiming();
        showTimingNotice({ kind: "ok", text: "已清空等待计时数据" }, true);
      });
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.classList.add("ai-cl-btn");
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => dismissTimingNotice());
      dom.notice.append(text, clearBtn, cancelBtn);
      return;
    }
    dom.notice.classList.remove("hidden");
    dom.notice.classList.toggle("ok", notice.kind === "ok");
    dom.notice.classList.toggle("warn", notice.kind === "warn");
    dom.notice.textContent = notice.text;
  }

  /** 导出等待计时数据：取消无提示，成功轻提示（自动消失），失败警示条常驻。 */
  async function exportWaitTiming(): Promise<void> {
    const outcome = await actions.exportWaitTiming();
    if (destroyed) return;
    if (outcome.cancelled) return;
    if (outcome.ok) {
      showTimingNotice({ kind: "ok", text: `已导出等待计时数据（${outcome.count} 条）` }, true);
    } else {
      showTimingNotice({ kind: "warn", text: `导出失败：${outcome.message ?? "未知错误"}` }, false);
    }
  }

  function openDockMenu(anchor: HTMLElement): void {
    closeMenu();
    const hasTiming = actions.hasWaitTimingData();
    const noDataTitle = hasTiming ? undefined : "还没有可导出的计时数据";
    menu = buildMenu([
      {
        icon: "i-export",
        label: "导出等待计时数据（开发者用）…",
        disabled: !hasTiming,
        title: noDataTitle,
        action: () => { void exportWaitTiming(); },
      },
      {
        icon: "i-trash",
        label: "清空等待计时数据…",
        danger: true,
        disabled: !hasTiming,
        title: noDataTitle,
        action: () => showTimingNotice({ kind: "confirm", text: "清空等待计时数据？已导出的文件不受影响。" }, false),
      },
    ]);
    positionMenu(menu, anchor);
  }

  function buildMenu(items: readonly MenuItem[]): HTMLElement {
    const el = document.createElement("div");
    el.className = "ai-menu";
    el.setAttribute("role", "menu");
    el.setAttribute("aria-label", "讨论操作");
    el.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    for (const item of items) {
      if (item.divider) {
        const sep = document.createElement("div");
        sep.className = "ai-menu-sep";
        el.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      if (item.danger) btn.classList.add("ai-menu-danger");
      if (item.disabled) btn.disabled = true;
      if (item.title) btn.title = item.title;
      if (item.icon) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "ai-ic");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", `#${item.icon}`);
        svg.appendChild(use);
        btn.appendChild(svg);
      }
      const label = document.createElement("span");
      label.textContent = item.label ?? "";
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        closeMenu();
        item.action?.();
      });
      el.appendChild(btn);
    }
    return el;
  }

  function positionMenu(menuEl: HTMLElement, anchor: HTMLElement): void {
    menuAnchor = anchor;
    document.body.appendChild(menuEl);
    const rect = anchor.getBoundingClientRect();
    menuEl.style.position = "fixed";
    // 右对齐锚定：按实际渲染宽度把菜单右缘对到锚点右缘。旧实现按 170px 估宽，
    // 菜单项文字变长（如导出等待计时数据）后会把菜单顶出屏幕右缘；
    // offsetWidth 不可用时回退旧估宽，左缘保底 8px。
    menuEl.style.left = `${Math.max(8, rect.right - (menuEl.offsetWidth || 170))}px`;
    menuEl.style.top = `${rect.bottom + 4}px`;
    menuEl.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  let menuAnchor: HTMLElement | null = null;
  function closeMenu(restoreFocus = false): void {
    if (menu) {
      menu.remove();
      menu = null;
    }
    if (restoreFocus && menuAnchor?.isConnected) menuAnchor.focus();
    menuAnchor = null;
  }

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (menu && !menu.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  const handleMenuKeyDown = (event: KeyboardEvent): void => {
    if (menu && event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };
  document.addEventListener("keydown", handleMenuKeyDown);
  const handleMenuScroll = (event: Event): void => {
    if (menu && !menu.contains(event.target as Node)) closeMenu();
  };
  const handleViewportResize = (): void => {
    closeMenu();
    if (panelWidth > 0) setPanelWidth(panelWidth);
  };
  document.addEventListener("scroll", handleMenuScroll, true);
  window.addEventListener("resize", handleViewportResize);

  // ===== 会话列表（第 9 组重做：分组 / 相对时间 / 重命名 / 置顶 / 删除撤销 / 过滤） =====
  function conversationSummaryById(conversationId: string): ConversationSummary | undefined {
    return state.conversations.find((summary) => summary.conversation_id === conversationId);
  }

  function openConversationFromId(conversationId: string): void {
    const summary = conversationSummaryById(conversationId);
    if (!summary) return;
    conversationListOpen = false;
    pendingDeleteId = null;
    renamingId = null;
    actions.onOpenDiscussion(summary);
    renderConversationList();
  }

  /** 列表状态词：打开窗口的讨论用窗口状态，其余用档案终态。 */
  function listStatusOf(summary: ConversationSummary) {
    const discussion = state.getDiscussion(summary.conversation_id);
    if (discussion) return describeWindowStatus(windowStatusOf(discussion.request, state.viewOf(summary.conversation_id).readingRequest != null));
    return describeConversationStatus(summary.last_status);
  }

  function makeIcon(icon: string, extraClass = ""): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", `ai-ic ${extraClass}`.trim());
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${icon}`);
    svg.appendChild(use);
    return svg;
  }

  function buildGroupHeader(group: ConversationGroup): HTMLElement {
    const el = document.createElement("div");
    el.classList.add("ai-cl-group");
    if (group.key === "pinned") {
      el.append(makeIcon("i-pin"));
      const label = document.createElement("span");
      label.textContent = group.label;
      el.append(label);
    } else if (group.key === "earlier") {
      el.classList.toggle("expanded", expandedEarlier);
      const label = document.createElement("span");
      label.textContent = group.label;
      el.append(label);
      const count = document.createElement("span");
      count.classList.add("ai-cl-group-count");
      count.textContent = `${group.items.length} 条`;
      count.append(makeIcon("i-chevron-down", "ai-ic-xs"));
      el.append(count);
      el.addEventListener("click", () => {
        expandedEarlier = !expandedEarlier;
        renderConversationList();
      });
    } else {
      const label = document.createElement("span");
      label.textContent = group.label;
      el.append(label);
    }
    return el;
  }

  function buildMonthHeader(label: string): HTMLElement {
    const el = document.createElement("div");
    el.classList.add("ai-cl-group", "ai-cl-group-sub");
    const span = document.createElement("span");
    span.textContent = label;
    el.append(span);
    return el;
  }

  function startRename(item: ConversationListItem): void {
    renamingId = item.conversationId;
    renderConversationList();
  }

  async function commitRename(conversationId: string, title: string): Promise<void> {
    renamingId = null;
    await actions.onRename(conversationId, title);
    renderConversationList();
  }

  function buildConversationRow(item: ConversationListItem): HTMLElement {
    const row = document.createElement("div");
    row.classList.add("ai-cl-row");
    if (item.isActive) row.classList.add("active");

    const dot = document.createElement("span");
    dot.classList.add("ai-cl-dot", `is-${item.status.tone}`);
    row.append(dot);

    const main = document.createElement("div");
    main.classList.add("ai-cl-main");
    row.append(main);

    if (renamingId === item.conversationId) {
      // 重命名就地编辑：回车保存，Esc 取消。
      const edit = document.createElement("div");
      edit.classList.add("ai-cl-edit");
      const input = document.createElement("input");
      input.type = "text";
      input.value = item.title;
      edit.append(input);
      main.append(edit);
      const meta = document.createElement("div");
      meta.classList.add("ai-cl-meta");
      meta.textContent = `${item.focusDocumentTitle ?? ""} · ${item.status.label} · 回车保存，Esc 取消`;
      main.append(meta);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          void commitRename(item.conversationId, input.value);
        } else if (event.key === "Escape") {
          renamingId = null;
          renderConversationList();
        }
      });
      // 重命名输入框内的点击不冒泡到行点击（D1.8/D1.9、C4）。
      input.addEventListener("click", (event) => event.stopPropagation());
      input.focus();
    } else {
      const title = document.createElement("div");
      title.classList.add("ai-cl-title");
      title.textContent = item.title;
      main.append(title);
      const meta = document.createElement("div");
      meta.classList.add("ai-cl-meta");
      meta.textContent = item.focusDocumentTitle ? `${item.focusDocumentTitle} · ${item.status.label}` : item.status.label;
      main.append(meta);

      if (pendingDeleteId === item.conversationId) {
        row.classList.add("confirming");
        const confirm = document.createElement("div");
        confirm.classList.add("ai-cl-confirm");
        const prompt = document.createElement("span");
        prompt.classList.add("ai-cl-confirm-text");
        prompt.textContent = "删除这个讨论？";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.classList.add("ai-cl-btn");
        cancelBtn.textContent = "取消";
        cancelBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          pendingDeleteId = null;
          renderConversationList();
        });
        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.classList.add("ai-cl-btn", "danger");
        confirmBtn.textContent = "删除";
        confirmBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          pendingDeleteId = null;
          renderConversationList();
          void actions.onDelete(item.conversationId);
        });
        confirm.append(prompt, cancelBtn, confirmBtn);
        // 删除确认区内的点击不冒泡到行点击（D1.8/D1.9、C6）。
        confirm.addEventListener("click", (event) => event.stopPropagation());
        main.append(confirm);
      }
    }

    const time = document.createElement("span");
    time.classList.add("ai-cl-time");
    time.textContent = item.timeLabel;
    row.append(time);

    // 行尾悬停操作（重命名 / 置顶 / 删除）。
    const actionsRow = document.createElement("div");
    actionsRow.classList.add("ai-cl-actions");

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.classList.add("ai-cl-act");
    renameBtn.title = "重命名";
    renameBtn.append(makeIcon("i-pencil", "ai-ic-sm"));
    renameBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      startRename(item);
    });

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.classList.add("ai-cl-act");
    pinBtn.title = item.pinned ? "取消置顶" : "置顶";
    pinBtn.append(makeIcon("i-pin", "ai-ic-sm"));
    pinBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void actions.onTogglePin(item.conversationId);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.classList.add("ai-cl-act", "del");
    deleteBtn.title = "删除";
    deleteBtn.append(makeIcon("i-trash", "ai-ic-sm"));
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingDeleteId = item.conversationId;
      renderConversationList();
    });

    actionsRow.append(renameBtn, pinBtn, deleteBtn);
    if (pendingDeleteId !== item.conversationId) row.append(actionsRow);

    // 行主体点击 = 打开 / 聚焦讨论；行尾按钮点击不冒泡。
    row.addEventListener("click", () => openConversationFromId(item.conversationId));

    return row;
  }

  function renderEmptyState(filterActive: boolean): void {
    dom.conversationListEmpty.replaceChildren();
    if (filterActive) {
      const p = document.createElement("p");
      p.textContent = "没有匹配的讨论";
      dom.conversationListEmpty.append(p);
    } else {
      dom.conversationListEmpty.append(makeIcon("i-empty", "ai-empty-icon"));
      const p = document.createElement("p");
      p.textContent = "还没有讨论。在正文里选中一段，点旁边的「AI」，或者直接在面板提问，就会开始第一个讨论。";
      dom.conversationListEmpty.append(p);
    }
    dom.conversationListEmpty.classList.remove("hidden");
  }

  function renderConversationList(): void {
    dom.conversationList.classList.toggle("hidden", !conversationListOpen);
    dom.listToggleBtn.setAttribute("aria-expanded", String(conversationListOpen));
    if (!conversationListOpen) return;

    const filter = listFilter.trim().toLowerCase();
    const filterActive = filter !== "";
    const allSummaries = filter
      ? state.conversations.filter((summary) =>
          summary.title.toLowerCase().includes(filter) ||
          (displayFocusDocumentTitle(summary) ?? "").toLowerCase().includes(filter))
      : state.conversations;

    const groups = buildConversationGroups(allSummaries, state.focusedConversationId, new Date(), listStatusOf);

    dom.conversationListItems.replaceChildren();
    if (groups.length === 0) {
      renderEmptyState(filterActive);
      return;
    }
    dom.conversationListEmpty.classList.toggle("hidden", true);

    for (const group of groups) {
      dom.conversationListItems.append(buildGroupHeader(group));
      if (group.key === "earlier" && !expandedEarlier) continue;
      if (group.key === "earlier") {
        for (const section of group.monthSections) {
          dom.conversationListItems.append(buildMonthHeader(section.label));
          for (const item of section.items) {
            dom.conversationListItems.append(buildConversationRow(item));
          }
        }
      } else {
        for (const item of group.items) {
          dom.conversationListItems.append(buildConversationRow(item));
        }
      }
    }
  }

  // ===== 停靠区头 / 窄轨 =====
  function updateDockChrome(): void {
    const discussionIds = new Set([
      ...state.conversations.map((summary) => summary.conversation_id),
      ...state.openDiscussionIds.keys(),
    ]);
    dom.count.textContent = String(discussionIds.size);
    dom.notice.replaceChildren();
    // 等待计时提示是最新用户动作的反馈，存在时优先呈现；但撤销 / 保存失败提示
    // 在其后新出现时按顶替规则让位（后出现的顶替先前的）。计时器到点后
    // timingNotice 已被清空，自然回落到撤销 / 保存失败提示。
    if (timingNotice && newerDockNoticePreempts()) {
      clearTimingNoticeTimer();
      timingNotice = null;
    }
    if (timingNotice) {
      renderTimingNotice(timingNotice);
      dom.railDot.classList.add("hidden");
    } else {
      dom.notice.classList.remove("ok", "warn");
      const undo = actions.getUndoNotice();
      lastUndoTitle = undo?.title ?? null;
      lastSaveError = state.saveError;
      if (undo) {
        // 删除撤销提示（停靠区层，不依赖列表是否打开）。
        dom.notice.classList.remove("hidden", "warn");
        dom.notice.classList.add("ok");
        const text = document.createElement("span");
        text.classList.add("ai-dock-notice-text");
        text.textContent = `已删除：${undo.title}`;
        text.title = undo.title;
        dom.notice.append(text);
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.classList.add("ai-dock-notice-undo");
        undoBtn.textContent = "撤销";
        undoBtn.addEventListener("click", () => actions.onUndoDelete());
        dom.notice.append(undoBtn);
        dom.railDot.classList.remove("hidden");
      } else if (state.saveError !== null) {
        dom.notice.classList.remove("hidden", "ok");
        dom.notice.classList.add("warn");
        dom.notice.textContent = state.saveError;
        dom.railDot.classList.remove("hidden");
      } else {
        dom.notice.classList.add("hidden");
        dom.notice.classList.remove("warn", "ok");
        dom.railDot.classList.add("hidden");
      }
    }
    const open = state.isOpen;
    if (!open) {
      maximized = false;
      conversationListOpen = false;
      pendingDeleteId = null;
      renamingId = null;
      closeMenu();
    }
    dom.root.classList.toggle("ai-panel-maximized", maximized);
    dom.maximizeBtn.innerHTML = `<svg class="panelicon" aria-hidden="true" viewBox="0 0 24 24"><path d="${maximized ? "M8 4h12v12h-4M4 8h12v12H4ZM4 12h12" : "M4 4h16v16H4ZM4 8h16"}"/></svg><span>${maximized ? "恢复边栏" : "最大化"}</span>`;
    dom.maximizeBtn.setAttribute("aria-label", maximized ? "恢复边栏" : "最大化 AI 面板");
    dom.maximizeBtn.dataset.tooltip = maximized ? "恢复写作与 AI 并排" : "最大化 AI 面板";
    dom.maximizeBtn.setAttribute("aria-pressed", String(maximized));
    if (panelWidth > 0) dom.root.style.width = maximized ? "100%" : `${panelWidth}px`;
    dom.root.classList.toggle("hidden", !open);
    dom.rail.classList.toggle("hidden", open);
  }

  // ===== 对账 =====
  function sync(): void {
    const currentId = state.focusedConversationId;
    for (const [id] of windows) {
      if (id !== currentId) destroyWindow(id);
    }
    if (currentId !== null && !windows.has(currentId)) {
      createWindow(currentId);
    }
    updateDockChrome();
    renderConversationList();
  }

  const handleListToggle = (): void => {
    conversationListOpen = !conversationListOpen;
    if (!conversationListOpen) {
      pendingDeleteId = null;
      renamingId = null;
    }
    renderConversationList();
  };
  const handleConversationListClose = (): void => {
    conversationListOpen = false;
    pendingDeleteId = null;
    renamingId = null;
    renderConversationList();
  };
  const handleListNewConversation = (): void => {
    conversationListOpen = false;
    renderConversationList();
    actions.onNewConversation();
  };
  const handleSearchInput = (): void => {
    listFilter = dom.searchInput.value;
    renderConversationList();
  };
  const handleNewConversation = (): void => actions.onNewConversation();
  const handleMore = (event: MouseEvent): void => {
    event.stopPropagation();
    openDockMenu(dom.moreBtn);
  };
  const handleCollapse = (): void => state.close();
  const handleMaximize = (): void => {
    maximized = !maximized;
    if (panelWidth === 0) panelWidth = dom.root.getBoundingClientRect().width || 330;
    updateDockChrome();
  };
  const handleDividerKey = (event: KeyboardEvent): void => {
    if (maximized || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    setPanelWidth((panelWidth || dom.root.getBoundingClientRect().width || 330) + (event.key === "ArrowLeft" ? 20 : -20));
  };
  const handleDividerDown = (event: PointerEvent): void => {
    if (maximized || event.button !== 0) return;
    event.preventDefault();
    resizePointer = event.pointerId;
    dom.divider.setPointerCapture(event.pointerId);
  };
  const handleDividerMove = (event: PointerEvent): void => {
    if (resizePointer !== event.pointerId) return;
    setPanelWidth(dom.root.getBoundingClientRect().right - event.clientX);
  };
  const handleDividerEnd = (): void => { resizePointer = null; };
  const handleRailNew = (): void => { state.open(); actions.onNewConversation(); };
  const handleRailList = (): void => { state.open(); conversationListOpen = true; renderConversationList(); };
  const handleRailMore = (event: MouseEvent): void => {
    event.stopPropagation();
    openDockMenu(dom.railMoreBtn);
  };
  const handleRailExpand = (): void => state.open();

  dom.listToggleBtn.addEventListener("click", handleListToggle);
  dom.conversationListCloseBtn.addEventListener("click", handleConversationListClose);
  dom.listNewConversationBtn.addEventListener("click", handleListNewConversation);
  dom.searchInput.addEventListener("input", handleSearchInput);
  dom.newConversationBtn.addEventListener("click", handleNewConversation);
  dom.moreBtn.addEventListener("click", handleMore);
  dom.collapseBtn.addEventListener("click", handleCollapse);
  dom.maximizeBtn.addEventListener("click", handleMaximize);
  dom.divider.addEventListener("keydown", handleDividerKey);
  dom.divider.addEventListener("pointerdown", handleDividerDown);
  dom.divider.addEventListener("pointermove", handleDividerMove);
  dom.divider.addEventListener("pointerup", handleDividerEnd);
  dom.divider.addEventListener("pointercancel", handleDividerEnd);
  dom.divider.addEventListener("lostpointercapture", handleDividerEnd);
  dom.railNewBtn.addEventListener("click", handleRailNew);
  dom.railListBtn.addEventListener("click", handleRailList);
  dom.railMoreBtn.addEventListener("click", handleRailMore);
  dom.railExpandBtn.addEventListener("click", handleRailExpand);

  const unsubscribe = state.subscribe(sync);
  sync();

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleMenuKeyDown);
      document.removeEventListener("scroll", handleMenuScroll, true);
      window.removeEventListener("resize", handleViewportResize);
      dom.listToggleBtn.removeEventListener("click", handleListToggle);
      dom.conversationListCloseBtn.removeEventListener("click", handleConversationListClose);
      dom.listNewConversationBtn.removeEventListener("click", handleListNewConversation);
      dom.searchInput.removeEventListener("input", handleSearchInput);
      dom.newConversationBtn.removeEventListener("click", handleNewConversation);
      dom.moreBtn.removeEventListener("click", handleMore);
      dom.collapseBtn.removeEventListener("click", handleCollapse);
      dom.maximizeBtn.removeEventListener("click", handleMaximize);
      dom.divider.removeEventListener("keydown", handleDividerKey);
      dom.divider.removeEventListener("pointerdown", handleDividerDown);
      dom.divider.removeEventListener("pointermove", handleDividerMove);
      dom.divider.removeEventListener("pointerup", handleDividerEnd);
      dom.divider.removeEventListener("pointercancel", handleDividerEnd);
      dom.divider.removeEventListener("lostpointercapture", handleDividerEnd);
      dom.railNewBtn.removeEventListener("click", handleRailNew);
      dom.railListBtn.removeEventListener("click", handleRailList);
      dom.railMoreBtn.removeEventListener("click", handleRailMore);
      dom.railExpandBtn.removeEventListener("click", handleRailExpand);
      for (const [id] of windows) destroyWindow(id);
      scrollMemory.clear();
      clearTimingNoticeTimer();
      closeMenu();
    },
  };
}
