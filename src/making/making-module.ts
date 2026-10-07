import { confirmDialog } from "../app-dialog.ts";
import type { MakingDom } from "../dom.ts";
import {
  chainCreate,
  chainDeactivate,
  chainDelete,
  chainLibraryLoad,
  chainRollback,
  chainSetActive,
  type Chain,
  type ChainLibrary,
  type InvokeFn,
  type ListenFn,
} from "../project-api.ts";
import {
  buildCardPanelView,
  buildChainLibraryRows,
  buildMakingInspectorView,
  buildMakingStatusView,
  describeChainDeletion,
  makingObjectLabel,
} from "./making-view-model.ts";
import {
  setupMakingConversation,
  type MakingConversationController,
  type MakingTrialLauncher,
} from "./making-session-controller.ts";
import {
  setupMakingTrial,
  type MakingTrialLaunchRequest,
  type MakingTrialWorkSource,
} from "./making-trial-controller.ts";
import { mountTrialRecords } from "./making-trial-records.ts";

/**
 * 制作模块页面控制器（add-making-module-core 任务组 7）。
 *
 * 职责与边界：
 * - 三态分离的落点：状态条只读链路库 active 指针（下一轮用什么）；检视标题反映
 *   浏览对象（正在看什么）；制作对话标题反映制作对象（正在制作什么）——浏览
 *   链路不切换制作对象，仅「开始新制作」这一显式动作切换。
 * - 启用／回退／停用／删除全部经用户确认后调用后端命令；失败如实提示，
 *   不显示与事实不符的状态。
 * - 制作对话区由 `making-session-controller` 承载（真实会话接线，车道 F2a）：
 *   会话按链路组织、发送流镜像日常讨论的保存节奏、卡草稿保存经用户确认；
 *   试问 UI 挂点见 `MakingConversationController.setTrialLauncher`。
 */

export interface MakingServices {
  /** 链路库与制作对话命令的 invoke 实现（测试注入；缺省用真实 Tauri invoke）。 */
  readonly call?: InvokeFn;
  /** 事件订阅（测试注入；缺省用真实 Tauri listen）。 */
  readonly listen?: ListenFn;
  /** 确认对话框（测试注入；缺省用 app-dialog 的原生确认）。 */
  readonly confirm?: (message: string) => Promise<boolean>;
  /** 试问入口覆盖（缺省接线试问控制器；测试可替换观察钩子）。 */
  readonly startTrial?: MakingTrialLauncher;
  /** 试问的试用环境来源（测试注入；缺省用 DOM＋最近作品的默认解析）。 */
  readonly trialWork?: MakingTrialWorkSource;
}

/**
 * 制作模块控制器：供 main.ts 装配与后续车道（制作会话接线、designer 视觉细化）
 * 使用的稳定接口。状态在闭包内管理，不外泄可变引用。
 */
export interface MakingController {
  /** 重读链路库并整体重绘（进入制作页与每次库操作后调用）。 */
  refresh(): Promise<void>;
  /**
   * 切换制作对象（仅经用户显式动作调用；浏览链路不会触发）。
   * 制作会话接线车道据此绑定「继续／新建」入口。
   */
  setMakingObject(chainId: string | null): void;
  /** 当前浏览的链路／版本（只读快照，供后续车道与测试）。 */
  readonly view: { readonly chainId: string | null; readonly versionId: string | null };
  /** 当前制作对象链路 id（null＝未选择）。 */
  readonly makingChainId: string | null;
  /** 制作对话区控制器（会话接线与试问车道挂点）。 */
  readonly conversation: MakingConversationController;
  /** 试问控制器（车道 F2b：发起流、运行状态与授权呈现；供测试与后续车道使用）。 */
  readonly trial: { launch: (request: MakingTrialLaunchRequest) => void };
  /** 窄窗视图切换（「结构检视／制作对话」）；切换只改属性，不重建 DOM。 */
  setNarrowView(view: "inspect" | "chat"): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function setupMaking(dom: MakingDom, services: MakingServices = {}): MakingController {
  const call = services.call;
  const confirm = services.confirm ?? confirmDialog;

  let library: ChainLibrary | null = null;
  let loadError: string | null = null;
  let opError: string | null = null;
  let viewChainId: string | null = null;
  let viewVersionId: string | null = null;
  let makingChainId: string | null = null;
  let expandedCardId: string | null = null;

  function findChain(chainId: string | null): Chain | null {
    if (library === null || chainId === null) return null;
    return library.chains.find((chain) => chain.id === chainId) ?? null;
  }

  // 制作对话区控制器（车道 F2a）：会话按链路组织，制作对象经 setMakingObject 同步。
  const conversation = setupMakingConversation(dom, {
    call,
    listen: services.listen,
    confirm: services.confirm,
    getChain: findChain,
    refreshLibrary: refresh,
    switchMakingObject: (chainId) => { setMakingObject(chainId); },
  });

  // 试问控制器（车道 F2b）：经 F2a 留好的钩子注册后，草稿面板「开始试问」可用。
  // 终态后重读链路库——版本上的试问引用与检视面板的试问记录随之刷新。
  const trial = setupMakingTrial({
    call,
    listen: services.listen,
    work: services.trialWork,
    onSettled: () => { void refresh(); },
  });
  conversation.setTrialLauncher(services.startTrial ?? trial.launch);

  // ========== 渲染 ==========

  function renderStatus(): void {
    const view = buildMakingStatusView(library, loadError);
    dom.statusActive.classList.toggle("hidden", view.kind !== "active");
    dom.statusIdle.classList.toggle("hidden", view.kind !== "idle");
    const errorText = view.kind === "error" ? view.label : opError;
    dom.statusError.classList.toggle("hidden", errorText === null);
    dom.statusError.textContent = errorText ?? "";
    if (view.kind === "active") {
      dom.statusText.textContent = view.label;
    }
  }

  function renderLibrary(): void {
    dom.chainList.replaceChildren();
    if (library === null || library.chains.length === 0) {
      dom.chainList.classList.add("hidden");
      dom.chainEmpty.classList.remove("hidden");
      return;
    }
    dom.chainEmpty.classList.add("hidden");
    dom.chainList.classList.remove("hidden");
    for (const row of buildChainLibraryRows(library)) {
      dom.chainList.append(chainRowElement(row));
    }
  }

  function chainRowElement(row: ReturnType<typeof buildChainLibraryRows>[number]): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "making-chain-row";
    button.dataset.chainId = row.chainId;
    button.setAttribute("role", "listitem");
    if (row.chainId === viewChainId) {
      button.classList.add("selected");
      button.setAttribute("aria-current", "true");
    }
    const name = document.createElement("span");
    name.className = "making-chain-row-name";
    name.textContent = row.name;
    const status = document.createElement("span");
    status.className = "making-chain-row-status";
    if (row.hasNewerDraft) status.classList.add("is-draft");
    status.textContent = row.hasNewerDraft
      ? `${row.statusLabel} · 有第${row.newerDraftIndex}版草稿`
      : row.statusLabel;
    button.append(name, status);
    // 点击只查看：不切换制作对象，也不改变全局当前链路。
    button.addEventListener("click", () => { viewChain(row.chainId); });
    return button;
  }

  function renderInspector(): void {
    const chain = findChain(viewChainId);
    if (chain === null) {
      dom.inspectorContent.classList.add("hidden");
      dom.inspectorEmpty.classList.remove("hidden");
      dom.inspectorEmpty.replaceChildren(emptyLine("从左侧选择一条链路，查看它的组装结构。"));
      return;
    }
    if (chain.versions.length === 0) {
      dom.inspectorContent.classList.add("hidden");
      dom.inspectorEmpty.classList.remove("hidden");
      dom.inspectorEmpty.replaceChildren(emptyLine(
        `「${chain.name}」还没有版本。在制作对话里口述要求，助手起草后由你确认保存。`,
      ));
      return;
    }
    const view = library !== null && viewVersionId !== null
      ? buildMakingInspectorView(library, chain.id, viewVersionId)
      : null;
    if (view === null) {
      // 版本指针失效（如删除后）：退回查看最新版本。
      viewVersionId = chain.versions[chain.versions.length - 1].id;
      return renderInspector();
    }
    dom.inspectorEmpty.classList.add("hidden");
    dom.inspectorContent.classList.remove("hidden");
    dom.inspectorTitle.textContent = view.title;
    dom.inspectorState.textContent = view.stateLabel;
    dom.inspectorState.classList.toggle("is-active", view.isActiveVersion);
    dom.inspectorState.classList.toggle("is-draft", !view.isActiveVersion);
    renderVersionOptions(view);
    dom.enableBtn.hidden = view.enableLabel === null;
    if (view.enableLabel !== null) dom.enableBtn.textContent = view.enableLabel;
    renderCards(view);
    renderCardPanel();
  }

  function renderVersionOptions(
    view: NonNullable<ReturnType<typeof buildMakingInspectorView>>,
  ): void {
    const previous = dom.versionSelect.value;
    dom.versionSelect.replaceChildren();
    for (const option of view.versionOptions) {
      const element = document.createElement("option");
      element.value = option.versionId;
      element.textContent = option.label;
      dom.versionSelect.append(element);
    }
    dom.versionSelect.value = view.versionOptions.some((option) => option.versionId === previous)
      ? previous
      : view.versionId;
  }

  function renderCards(
    view: NonNullable<ReturnType<typeof buildMakingInspectorView>>,
  ): void {
    dom.cardList.replaceChildren();
    dom.noCards.classList.toggle("hidden", view.cards.length > 0);
    for (const card of view.cards) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "making-card-row";
      button.dataset.cardId = card.cardId;
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-controls", "making-card-panel");
      const expanded = expandedCardId === card.cardId;
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      const title = document.createElement("span");
      title.className = "making-card-row-title";
      title.textContent = card.title;
      const version = document.createElement("span");
      version.className = "making-card-row-version";
      version.textContent = `第${view.versionIndex}版`;
      const summary = document.createElement("span");
      summary.className = "making-card-row-summary";
      summary.textContent = card.summary;
      button.append(title, version, summary);
      button.addEventListener("click", () => {
        expandedCardId = expandedCardId === card.cardId ? null : card.cardId;
        renderCards(view);
        renderCardPanel();
      });
      dom.cardList.append(button);
    }
  }

  function renderCardPanel(): void {
    dom.cardPanel.replaceChildren();
    const chain = findChain(viewChainId);
    const card = chain === null || viewVersionId === null
      ? null
      : chain.versions.find((version) => version.id === viewVersionId)?.cards
        .find((candidate) => candidate.id === expandedCardId) ?? null;
    if (library === null || chain === null || viewVersionId === null || card === null) {
      dom.cardPanel.classList.add("hidden");
      return;
    }
    const view = buildCardPanelView(library, chain.id, viewVersionId, card);
    if (view === null) {
      dom.cardPanel.classList.add("hidden");
      return;
    }
    dom.cardPanel.classList.remove("hidden");
    dom.cardPanel.append(
      panelSection("身份", view.identity),
      panelSection("何时用", view.whenToUse),
      panelSection("怎么做", view.howTo),
      panelSection("本版变化", view.changeLabel),
      trialRecordsPanelSection(view.trialsLabel, chain.id, viewVersionId),
    );
  }

  /** 试问记录栏（任务 6.2 前端）：汇总行＋`trial_list_for_version` 驱动的只读记录列表。 */
  function trialRecordsPanelSection(summary: string, chainId: string, versionId: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "making-card-panel-section";
    const title = document.createElement("h4");
    title.className = "making-card-panel-heading";
    title.textContent = "试问记录";
    const mount = document.createElement("div");
    section.append(title, mount);
    mountTrialRecords({ container: mount, chainId, versionId, summary, call });
    return section;
  }

  function panelSection(heading: string, body: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "making-card-panel-section";
    const title = document.createElement("h4");
    title.className = "making-card-panel-heading";
    title.textContent = heading;
    const content = document.createElement("p");
    content.className = "making-card-panel-body";
    content.textContent = body;
    section.append(title, content);
    return section;
  }

  function emptyLine(text: string): HTMLElement {
    const line = document.createElement("p");
    line.textContent = text;
    return line;
  }

  function renderConversation(): void {
    dom.conversationObject.textContent = makingObjectLabel(findChain(makingChainId));
  }

  function renderAll(): void {
    renderStatus();
    renderLibrary();
    renderInspector();
    renderConversation();
  }

  // ========== 状态操作 ==========

  /** 查看链路（只查看）：默认落在最新版本（活跃链路也先看最新草稿，检视标题承担「尚未启用」标注）。 */
  function viewChain(chainId: string, preferredVersionId?: string): void {
    const chain = findChain(chainId);
    if (chain === null) return;
    viewChainId = chainId;
    expandedCardId = null;
    if (preferredVersionId !== undefined && chain.versions.some((v) => v.id === preferredVersionId)) {
      viewVersionId = preferredVersionId;
    } else if (chain.versions.length > 0) {
      viewVersionId = chain.versions[chain.versions.length - 1].id;
    } else {
      viewVersionId = null;
    }
    renderLibrary();
    renderInspector();
    // 浏览链路只刷新空态「最近制作会话」列表的数据源，不切换制作对象。
    conversation.onBrowseChain(viewChainId);
  }

  async function runCommand(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      opError = null;
      return true;
    } catch (error) {
      opError = errorMessage(error);
      renderStatus();
      return false;
    }
  }

  /** 重读链路库并整体重绘（进入制作页与每次库操作后调用）。 */
  async function refresh(): Promise<void> {
    try {
      library = await chainLibraryLoad(call);
      loadError = null;
    } catch (error) {
      library = null;
      loadError = errorMessage(error);
    }
    // 浏览指针失效时防御性回退（链路或版本已被删除）。
    if (viewChainId !== null && findChain(viewChainId) === null) {
      viewChainId = null;
      viewVersionId = null;
      expandedCardId = null;
    }
    if (makingChainId !== null && findChain(makingChainId) === null) {
      makingChainId = null;
    }
    renderAll();
    // 同步制作对话区：制作链路被删除时复位空态，并顺带刷新会话列表显示。
    conversation.setChain(makingChainId);
  }

  // ========== 事件接线 ==========

  dom.newChainBtn.addEventListener("click", () => {
    dom.newChainForm.classList.remove("hidden");
    dom.newChainName.value = "";
    dom.newChainName.focus();
  });

  dom.newChainCancel.addEventListener("click", () => {
    dom.newChainForm.classList.add("hidden");
    dom.newChainName.value = "";
  });

  dom.newChainForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = dom.newChainName.value.trim();
    if (name.length === 0) {
      dom.newChainName.focus();
      return;
    }
    void (async () => {
      if (!await runCommand(() => chainCreate(name, call))) return;
      dom.newChainForm.classList.add("hidden");
      dom.newChainName.value = "";
      await refresh();
      // 新建后直接查看新链路（查看动作，不是制作对象切换）。
      if (library !== null && library.chains.length > 0) {
        viewChain(library.chains[library.chains.length - 1].id);
      }
    })();
  });

  dom.versionSelect.addEventListener("change", () => {
    if (viewChainId !== null) viewChain(viewChainId, dom.versionSelect.value);
  });

  dom.enableBtn.addEventListener("click", () => {
    const view = library !== null && viewChainId !== null && viewVersionId !== null
      ? buildMakingInspectorView(library, viewChainId, viewVersionId)
      : null;
    if (view === null || viewChainId === null || viewVersionId === null) return;
    const message = view.isRollback ? view.rollbackConfirm : view.enableConfirm;
    if (message === null) return;
    void (async () => {
      if (!await confirm(message)) return;
      const command = view.isRollback ? chainRollback : chainSetActive;
      if (await runCommand(() => command(viewChainId!, viewVersionId!, call))) {
        await refresh();
      }
    })();
  });

  dom.deleteChainBtn.addEventListener("click", () => {
    const chain = findChain(viewChainId);
    if (chain === null) return;
    void (async () => {
      if (!await confirm(describeChainDeletion(chain))) return;
      const deletedChainId = chain.id;
      if (!await runCommand(() => chainDelete(deletedChainId, call))) return;
      if (makingChainId === deletedChainId) makingChainId = null;
      viewChainId = null;
      viewVersionId = null;
      expandedCardId = null;
      await refresh();
    })();
  });

  dom.deactivateBtn.addEventListener("click", () => {
    void (async () => {
      if (!await confirm(
        "停用当前链路？从下一轮提问开始回到日常陪想；链路、版本与试问档案全部保留。",
      )) return;
      if (await runCommand(() => chainDeactivate(call))) {
        await refresh();
      }
    })();
  });

  // 制作对话：「开始新制作」是制作对象的显式切换动作（浏览链路不会触发），
  // 并立即为该链路开启一个新的制作会话（标题在首条消息后派生）。
  dom.conversationStartBtn.addEventListener("click", () => {
    if (viewChainId === null) {
      opError = "先在链路库选择或新建一条链路，再开始制作。";
      renderStatus();
      return;
    }
    setMakingObject(viewChainId);
    conversation.startNewSession();
  });

  // 制作对话表单的提交由会话控制器处理（发送流）；此处不再拦截。

  // 窄窗视图切换：只改 data 属性，不重建 DOM（保留未发送输入）；显式记录并
  // 恢复两侧滚动位置（display 切换在部分平台会重置 scrollTop）。
  function setNarrowView(view: "inspect" | "chat"): void {
    const inspectorScroll = dom.inspector.scrollTop;
    const conversationScroll = dom.conversationBody.scrollTop;
    dom.moduleRoot.dataset.makingView = view;
    dom.viewInspectBtn.classList.toggle("active", view === "inspect");
    dom.viewInspectBtn.setAttribute("aria-selected", view === "inspect" ? "true" : "false");
    dom.viewChatBtn.classList.toggle("active", view === "chat");
    dom.viewChatBtn.setAttribute("aria-selected", view === "chat" ? "true" : "false");
    dom.inspector.scrollTop = inspectorScroll;
    dom.conversationBody.scrollTop = conversationScroll;
  }
  dom.viewInspectBtn.addEventListener("click", () => setNarrowView("inspect"));
  dom.viewChatBtn.addEventListener("click", () => setNarrowView("chat"));

  // 中等宽度收拢：链路库展开状态（宽窗口下 CSS 不收拢，属性无视觉影响）。
  dom.libraryToggle.addEventListener("click", () => {
    const open = dom.moduleRoot.classList.toggle("making-library-open");
    dom.libraryToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  dom.libraryCloseBtn.addEventListener("click", () => {
    dom.moduleRoot.classList.remove("making-library-open");
    dom.libraryToggle.setAttribute("aria-expanded", "false");
    dom.libraryToggle.focus();
  });

  dom.moduleRoot.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      dom.newChainForm.classList.add("hidden");
      dom.newChainName.value = "";
    }
  });

  function setMakingObject(chainId: string | null): void {
    makingChainId = chainId;
    renderConversation();
    conversation.setChain(chainId);
  }

  const controller: MakingController = {
    refresh,
    setMakingObject,
    get view(): { readonly chainId: string | null; readonly versionId: string | null } {
      return { chainId: viewChainId, versionId: viewVersionId };
    },
    get makingChainId(): string | null {
      return makingChainId;
    },
    conversation,
    trial,
    setNarrowView,
  };

  void controller.refresh();
  return controller;
}
