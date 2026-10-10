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
  buildChainLibraryRows,
  buildMakingDetail,
  buildMakingMapView,
  buildMakingStatusView,
  describeChainDeletion,
  makingObjectLabel,
  makingTransferPrefill,
  type MakingDetailActionView,
  type MakingDetailModel,
  type MakingDetailSource,
  type MakingMapView,
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
 * 制作模块页面控制器（add-chain-mindmap-v0 导图重构）。
 *
 * 职责与边界：
 * - 三态分离的落点：状态条只读链路库 active 指针（下一轮用什么）；导图标题反映
 *   浏览对象（正在看什么）；制作对话标题反映制作对象（正在制作什么）——浏览
 *   链路不切换制作对象，仅「开始新制作」与详情操作转接这类显式动作切换。
 * - 内容区双标签「导图｜制作对话」：切换只改 data-making-view 属性，不重建 DOM
 *   （保留未发送输入与浏览位置）；标签宽窄常驻，状态条常驻在标签之上。
 * - 统一详情：单一详情状态（来源＋模式）驱动两种呈现——快捷小窗（唯一挂载位，
 *   在图区内、卡区右侧邻接、垂直以图区为基准居中）与全页详情（占满导图视图）。
 *   位置与尺寸统一由挂载结构保证，不随所点对象及其位置变化。
 * - 导图不直接编辑：一切加／改／删经「转制作对话」走既有会话通道；
 *   卡片上无启用开关，启用始终落在链路版本层（沿用既有确认措辞）。
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
 * 制作模块控制器：供 main.ts 装配与后续车道使用的稳定接口。
 * 状态在闭包内管理，不外泄可变引用。
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
  /** 内容区标签切换（「导图｜制作对话」）；切换只改属性，不重建 DOM。 */
  setActiveView(view: "map" | "chat"): void;
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
  // 统一详情状态：当前来源（卡／自定义要求区／底座／每轮动态／添加说明）＋呈现模式。
  let detailSource: MakingDetailSource | null = null;
  let detailMode: "quick" | "full" | null = null;
  let detailReturnFocus: HTMLElement | null = null;

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
  // 终态后重读链路库——版本上的试问引用与详情面板的试问记录随之刷新。
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
    status.textContent = [row.chainId === viewChainId ? "正在查看" : null,
      row.chainId === makingChainId ? "正在制作" : null,
      row.isActiveChain ? `已启用 · 第${row.activeVersionIndex}版` : "未启用",
      row.hasNewerDraft ? `有第${row.newerDraftIndex}版草稿` : null].filter(Boolean).join(" · ");
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
      resetDetail();
      return;
    }
    if (chain.versions.length === 0) {
      dom.inspectorContent.classList.add("hidden");
      dom.inspectorEmpty.classList.remove("hidden");
      dom.inspectorEmpty.replaceChildren(emptyLine(
        `「${chain.name}」还没有版本。在制作对话里口述要求，助手起草后由你确认保存。`,
      ));
      resetDetail();
      return;
    }
    const view = library !== null && viewVersionId !== null
      ? buildMakingMapView(library, chain.id, viewVersionId)
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
    renderZoneCards(view);
    renderWires(view);
    renderDetail();
    syncDetailExpanded();
  }

  function renderVersionOptions(view: MakingMapView): void {
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

  /**
   * 连线渲染：箭头（marker-end）只出现在「分区→组装」「组装→输出」的流线上
   * 按实际节点边界计算；卡片节点在 DOM 结构上不生成任何连线。
   */
  function renderWires(view: MakingMapView): void {
    dom.wirePaths.replaceChildren();
    const graph = dom.graph.getBoundingClientRect();
    const assembly = dom.graph.querySelector<HTMLElement>(".making-assembly-node");
    const output = dom.graph.querySelector<HTMLElement>(".making-output-node");
    const sources = Array.from(dom.graph.querySelectorAll<HTMLElement>(".making-zone"));
    if (!assembly || !output || graph.width <= 0 || graph.height <= 0) return;
    dom.wires.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);
    const inlet = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left - graph.left, y: rect.top - graph.top + rect.height / 2 };
    };
    const outlet = (element: HTMLElement) => {
      const point = inlet(element);
      return { x: point.x + element.getBoundingClientRect().width, y: point.y };
    };
    const target = inlet(assembly);
    const paths = sources.map((source) => {
      const start = outlet(source);
      const junction = start.x + (target.x - start.x) / 2;
      return `M ${start.x} ${start.y} H ${junction} V ${target.y} H ${target.x}`;
    });
    const start = outlet(assembly);
    const end = inlet(output);
    paths.push(`M ${start.x} ${start.y} H ${end.x}`);
    for (const d of paths.slice(0, view.wires.length)) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("marker-end", "url(#making-arrow)");
      dom.wirePaths.append(path);
    }
  }

  /** 自定义提示词区的紧凑卡行（点开＝统一详情快捷小窗，不再有下方展开面板）。 */
  function cardRowElement(card: MakingMapView["customZone"]["requirementGroup"]["cards"][number]): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "making-card-row";
    button.dataset.cardId = card.cardId;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-controls", "making-quick-panel");
    const title = document.createElement("span");
    title.className = "making-card-row-title";
    title.textContent = card.title;
    const hint = document.createElement("span");
    hint.className = "making-card-row-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "详情";
    button.append(title, hint);
    button.addEventListener("click", () => {
      openDetail({ kind: "card", cardId: card.cardId }, button);
    });
    return button;
  }

  /**
   * 自定义要求区的两组渲染（add-posture-slot 任务 4.1）：要求类组（现行）＋
   * 姿态类组（排在要求组下方）；两组共用分区单一滚动区，无独立滚动。
   * 两组添加入口均常驻（2026-10-07 修订：姿态卡每版本可多张，有卡时仍可继续
   * 追加）；多张姿态卡行自然并列渲染（列表渲染本身不设张数上限）。
   */
  function renderZoneCards(view: MakingMapView): void {
    const requirement = view.customZone.requirementGroup;
    const posture = view.customZone.postureGroup;

    dom.cardList.replaceChildren();
    dom.cardCount.textContent = requirement.cardCountLabel;
    dom.noCards.classList.toggle("hidden", requirement.cards.length > 0);
    // 空态说明由视图模型给出（限定要求类；纯姿态版本的「还没有」只指要求卡）。
    dom.noCards.textContent = requirement.emptyNote;
    for (const card of requirement.cards) {
      dom.cardList.append(cardRowElement(card));
    }

    dom.postureCardList.replaceChildren();
    dom.postureCardCount.textContent = posture.cardCountLabel;
    for (const card of posture.cards) {
      dom.postureCardList.append(cardRowElement(card));
    }
    // 姿态类添加入口常驻（与要求类入口同式）：有卡时可继续追加，不因已有姿态卡隐藏。
  }

  // ========== 统一详情（单一详情状态＋两种呈现；挂载结构保证同位同尺寸） ==========

  function openDetail(source: MakingDetailSource, trigger: HTMLElement | null): void {
    detailSource = source;
    detailMode = "quick";
    detailReturnFocus = trigger;
    renderDetail();
    syncDetailExpanded();
  }

  /** 关闭详情并把焦点还给来源模块（键盘可达；关闭即回图区）。 */
  function closeDetail(): void {
    const previous = detailReturnFocus;
    resetDetail();
    previous?.focus({ preventScroll: true });
  }

  /** 复位详情状态（浏览切换、数据失效时调用；不动焦点）。 */
  function resetDetail(): void {
    detailSource = null;
    detailMode = null;
    detailReturnFocus = null;
    dom.quickPanel.classList.add("hidden");
    dom.quickPanel.replaceChildren();
    clearFullMounts();
    dom.graph.classList.remove("hidden");
    dom.fullDetail.classList.add("hidden");
    syncDetailExpanded();
  }

  function clearFullMounts(): void {
    dom.cardPanel.replaceChildren();
    dom.cardPanel.classList.add("hidden");
    dom.fullReadonly.replaceChildren();
    dom.fullReadonly.classList.add("hidden");
  }

  /**
   * 详情渲染：快捷小窗与全页详情由同一 DetailModel 驱动。卡片五项在全页挂载位
   * 随详情一并就绪（含试问记录的按版本读取）；底座／每轮动态挂只读说明。
   * 全页模式下图区整体隐藏（快捷小窗挂在图区内，随之一并让位；返回即恢复）。
   */
  function renderDetail(): void {
    clearFullMounts();
    if (detailSource === null || library === null || viewChainId === null || viewVersionId === null) {
      dom.quickPanel.classList.add("hidden");
      dom.graph.classList.remove("hidden");
      dom.fullDetail.classList.add("hidden");
      return;
    }
    const model = buildMakingDetail(library, viewChainId, viewVersionId, detailSource);
    if (model === null) {
      // 来源失效（卡片或版本已不存在）：诚实关闭，不留悬空详情。
      resetDetail();
      return;
    }
    dom.quickPanel.replaceChildren(quickWindowElement(model));
    dom.quickPanel.dataset.source = model.kind;
    dom.quickPanel.classList.toggle("hidden", detailMode !== "quick");
    if (model.card !== null) {
      dom.cardPanel.classList.remove("hidden");
      dom.cardPanel.append(
        panelSection("身份", model.card.identity),
        panelSection("何时用", model.card.whenToUse),
        panelSection("怎么做", model.card.howTo),
        panelSection("本版变化", model.card.changeLabel),
        trialRecordsPanelSection(model.card.trialsLabel, viewChainId, viewVersionId),
        cardActionsElement(model.actions),
      );
    } else if (model.readonlyItems !== null) {
      dom.fullReadonly.classList.remove("hidden");
      dom.fullReadonly.append(readonlyCopyElement(model.readonlyItems, model.readonlyNote));
    }
    dom.fullEyebrow.textContent = model.eyebrow ?? "";
    dom.graph.classList.toggle("hidden", detailMode === "full");
    dom.fullDetail.classList.toggle("hidden", detailMode !== "full");
  }

  /** 快捷小窗（统一 450×330 挂载位；可关闭；有全页详情者带「打开完整详情」）。 */
  function quickWindowElement(model: MakingDetailModel): HTMLElement {
    const windowEl = document.createElement("section");
    windowEl.className = "making-quick-window";
    windowEl.setAttribute("role", "region");
    windowEl.setAttribute("aria-label", model.title);
    const head = document.createElement("header");
    head.className = "making-quick-head";
    const heading = document.createElement("h4");
    heading.textContent = model.title;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "making-mini-btn";
    closeBtn.textContent = "关闭详情";
    closeBtn.addEventListener("click", () => { closeDetail(); });
    head.append(heading, closeBtn);
    const body = document.createElement("div");
    body.className = "making-quick-body";
    body.tabIndex = 0;
    appendPara(body, model.quickMeta, "making-quick-meta");
    appendPara(body, model.quickSummary, null);
    appendPara(body, model.quickHelp, "making-quick-help");
    appendPara(body, model.quickNote, null);
    if (model.readonlyItems !== null) {
      body.append(readonlyCopyElement(model.readonlyItems, model.readonlyNote));
    }
    if (model.hasFullDetail) {
      const openFull = document.createElement("button");
      openFull.type = "button";
      openFull.className = "making-action-btn making-quick-open";
      openFull.textContent = "打开完整详情";
      openFull.addEventListener("click", () => {
        detailMode = "full";
        renderDetail();
      });
      body.append(openFull);
    }
    windowEl.append(head, body);
    if (model.actions !== null && model.actions.length > 0) {
      const footer = document.createElement("footer");
      footer.className = "making-quick-actions";
      for (const action of model.actions) {
        footer.append(detailActionButton(action));
      }
      windowEl.append(footer);
    }
    return windowEl;
  }

  /** 只读说明组（底座四项／每轮动态三项＋可选尾注；无任何操作或配置控件）。 */
  function readonlyCopyElement(
    items: readonly { readonly title: string; readonly description: string }[],
    note: string | null,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "making-readonly-copy";
    for (const item of items) {
      const paragraph = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = item.title;
      paragraph.append(strong, document.createElement("br"), item.description);
      wrap.append(paragraph);
    }
    if (note !== null) {
      const noteParagraph = document.createElement("p");
      noteParagraph.className = "making-readonly-note";
      noteParagraph.textContent = note;
      wrap.append(noteParagraph);
    }
    return wrap;
  }

  /** 详情底部操作（修改／删除／添加）：统一转入制作对话，导图上不直接编辑。 */
  function detailActionButton(action: MakingDetailActionView): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "making-mini-btn";
    button.textContent = action.label;
    button.addEventListener("click", () => { transferToConversation(action); });
    return button;
  }

  function cardActionsElement(actions: readonly MakingDetailActionView[] | null): HTMLElement {
    const footer = document.createElement("footer");
    footer.className = "making-card-actions";
    if (actions !== null) {
      for (const action of actions) {
        footer.append(detailActionButton(action));
      }
    }
    return footer;
  }

  /** 来源模块的 aria-expanded 同步（快捷小窗唯一，指向它的来源标记展开）。 */
  function syncDetailExpanded(): void {
    const source = detailSource;
    const syncCardRows = (list: HTMLElement): void => {
      for (const node of list.querySelectorAll("button")) {
        const button = node as HTMLButtonElement;
        const expanded = source !== null && source.kind === "card" && source.cardId === button.dataset.cardId;
        button.setAttribute("aria-expanded", expanded ? "true" : "false");
      }
    };
    syncCardRows(dom.cardList);
    syncCardRows(dom.postureCardList);
    dom.zoneCustomTrigger.setAttribute("aria-expanded", source?.kind === "custom-zone" ? "true" : "false");
    dom.addCardBtn.setAttribute("aria-expanded", source?.kind === "add-card" ? "true" : "false");
    dom.addPostureCardBtn.setAttribute("aria-expanded", source?.kind === "add-posture-card" ? "true" : "false");
    dom.baseNode.setAttribute("aria-expanded", source?.kind === "base" ? "true" : "false");
    dom.dynamicNode.setAttribute("aria-expanded", source?.kind === "dynamic" ? "true" : "false");
  }

  /**
   * 详情操作转制作对话：复用既有会话通道（制作对象显式切换＋无会话时开新会话＋
   * 预填输入），切换到「制作对话」标签并聚焦输入；不发明新的编辑通道。
   */
  function transferToConversation(action: MakingDetailActionView): void {
    if (viewChainId === null) return;
    if (makingChainId !== viewChainId) setMakingObject(viewChainId);
    if (conversation.currentConversationId === null) conversation.startNewSession();
    dom.conversationInput.value = makingTransferPrefill(action);
    resetDetail();
    setActiveView("chat");
    dom.conversationInput.focus();
  }

  /** 试问记录栏（车道 F2b 前端）：汇总行＋`trial_list_for_version` 驱动的只读记录列表。 */
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

  function appendPara(parent: HTMLElement, text: string | null, className: string | null): void {
    if (text === null) return;
    const paragraph = document.createElement("p");
    if (className !== null) paragraph.className = className;
    paragraph.textContent = text;
    parent.append(paragraph);
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

  /** 查看链路（只查看）：默认落在最新版本（活跃链路也先看最新草稿，导图标题承担「尚未启用」标注）。 */
  function viewChain(chainId: string, preferredVersionId?: string): void {
    const chain = findChain(chainId);
    if (chain === null) return;
    viewChainId = chainId;
    resetDetail();
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
      resetDetail();
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
      ? buildMakingMapView(library, viewChainId, viewVersionId)
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
      resetDetail();
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
  // 并立即为当前对象开启一个新的制作会话（标题在首条消息后派生）。
  // 空库（没有任何链路）时允许「直接口述」：以未绑定会话开始，保存草稿时才建立链路。
  dom.conversationStartBtn.addEventListener("click", () => {
    const emptyLibrary = library !== null && library.chains.length === 0;
    if (viewChainId === null && !emptyLibrary) {
      opError = "先在链路库选择或新建一条链路，再开始制作。";
      renderStatus();
      return;
    }
    if (viewChainId !== null) setMakingObject(viewChainId);
    conversation.startNewSession();
  });

  // 制作对话表单的提交由会话控制器处理（发送流）；此处不再拦截。

  // ========== 导图交互（三类可点对象＋区级入口 → 统一详情） ==========

  dom.zoneCustomTrigger.addEventListener("click", () => {
    openDetail({ kind: "custom-zone" }, dom.zoneCustomTrigger);
  });
  // 点自定义要求区的空白处同样打开该区的快捷小窗（点在按钮上时交给按钮自身）。
  dom.zoneCustom.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    openDetail({ kind: "custom-zone" }, dom.zoneCustomTrigger);
  });
  dom.addCardBtn.addEventListener("click", () => {
    openDetail({ kind: "add-card" }, dom.addCardBtn);
  });
  // 姿态类添加入口：与要求类入口同式（ghost）——点开统一快捷小窗，「添加」经
  // 详情底部操作转制作对话（沿用现行「＋添加要求卡」转写机制，不改全局启用指针）。
  dom.addPostureCardBtn.addEventListener("click", () => {
    openDetail({ kind: "add-posture-card" }, dom.addPostureCardBtn);
  });
  // 键盘可达补强（add-posture-slot 任务 4.3）：滚动区内条目聚焦时滚动至可见，
  // 配合 CSS scroll-margin 保证焦点标识不被容器边缘裁切。
  dom.zoneScroll.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
  dom.baseNode.addEventListener("click", () => {
    openDetail({ kind: "base" }, dom.baseNode);
  });
  dom.dynamicNode.addEventListener("click", () => {
    openDetail({ kind: "dynamic" }, dom.dynamicNode);
  });

  // 全页详情返回：恢复图区与原来源的快捷小窗（不跳回卡片）。
  dom.fullBackBtn.addEventListener("click", () => {
    if (detailMode !== "full") return;
    detailMode = detailSource !== null ? "quick" : null;
    renderDetail();
  });

  // 内容区标签切换「导图｜制作对话」：只改 data 属性，不重建 DOM（保留未发送输入）；
  // 显式记录并恢复两侧滚动位置（display 切换在部分平台会重置 scrollTop）。
  function setActiveView(view: "map" | "chat"): void {
    const inspectorScroll = dom.inspector.scrollTop;
    const conversationScroll = dom.conversationBody.scrollTop;
    dom.moduleRoot.dataset.makingView = view;
    dom.viewMapBtn.classList.toggle("active", view === "map");
    dom.viewMapBtn.setAttribute("aria-selected", view === "map" ? "true" : "false");
    dom.viewChatBtn.classList.toggle("active", view === "chat");
    dom.viewChatBtn.setAttribute("aria-selected", view === "chat" ? "true" : "false");
    dom.inspector.scrollTop = inspectorScroll;
    dom.conversationBody.scrollTop = conversationScroll;
  }
  dom.viewMapBtn.addEventListener("click", () => setActiveView("map"));
  dom.viewChatBtn.addEventListener("click", () => setActiveView("chat"));

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
      // Escape 先收详情（全页→快捷小窗→关闭），再退新建表单。
      if (detailMode === "full") {
        detailMode = detailSource !== null ? "quick" : null;
        renderDetail();
        return;
      }
      if (detailMode === "quick") {
        closeDetail();
        return;
      }
      dom.newChainForm.classList.add("hidden");
      dom.newChainName.value = "";
    }
  });

  function setMakingObject(chainId: string | null): void {
    makingChainId = chainId;
    renderLibrary();
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
    setActiveView,
  };

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      if (library === null || viewChainId === null || viewVersionId === null) return;
      const view = buildMakingMapView(library, viewChainId, viewVersionId);
      if (view !== null) renderWires(view);
    });
    observer.observe(dom.graph);
  }
  void controller.refresh();
  return controller;
}
