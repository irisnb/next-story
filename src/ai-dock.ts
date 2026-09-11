import type { AiDockDom } from "./dom.ts";
import { buildAiWindowDom } from "./dom.ts";
import { setupAiWindow, discussionTitle, windowStatusOf, type AiWindowController, type AiWindowActions } from "./ai-window.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import type { ConversationSummary } from "./conversation-archive.ts";
import {
  buildConversationGroups,
  describeConversationStatus,
  describeWindowStatus,
  type ConversationListItem,
  type ConversationGroup,
} from "./ai-panel-conversation-list.ts";

/** 窗口最小 / 默认尺寸（仅运行期，不持久化）。 */
export const WINDOW_MIN_WIDTH_PX = 300;
export const WINDOW_MIN_HEIGHT_PX = 200;
export const WINDOW_DEFAULT_WIDTH_PX = 380;
export const WINDOW_DEFAULT_HEIGHT_PX = 460;
export const SNAP_THRESHOLD_PX = 8;
/** 拖动阈值：累计位移超过此值才真正开始移动/脱离停靠流，避免轻抖把停靠窗口弹出。 */
export const DRAG_THRESHOLD_PX = 4;

export interface FloatGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 把待定坐标钳制到边界内（拖动 / 缩放共用）。 */
export function clampLeft(left: number, width: number, maxRight: number): number {
  const maxLeft = Math.max(0, maxRight - width);
  return Math.min(Math.max(0, left), maxLeft);
}

export function clampTop(top: number, height: number, maxBottom: number): number {
  const maxTop = Math.max(0, maxBottom - height);
  return Math.min(Math.max(0, top), maxTop);
}

export function clampWidth(width: number): number {
  return Math.max(WINDOW_MIN_WIDTH_PX, width);
}

export function clampHeight(height: number): number {
  return Math.max(WINDOW_MIN_HEIGHT_PX, height);
}

/** 吸附结果：吸附后的起始坐标 + 参考线坐标（被对齐的边）。 */
export interface SnapResult {
  /** 吸附后的 left / top 坐标。 */
  readonly value: number;
  /** 参考线（被对齐边）坐标；未吸附为 null。 */
  readonly guide: number | null;
}

/**
 * 把窗口的起始边（start）或结束边（start + size）吸附到候选边（应用边缘、其它窗口边缘）。
 * 返回吸附后的起始坐标与参考线坐标：贴右/下缘时参考线画在被对齐的边，而非窗口起始坐标。
 */
export function snapResult(
  start: number,
  size: number,
  edges: readonly number[],
  threshold: number = SNAP_THRESHOLD_PX,
): SnapResult {
  let bestValue = start;
  let bestGuide: number | null = null;
  let bestDistance = threshold;
  for (const edge of edges) {
    const startDistance = Math.abs(start - edge);
    if (startDistance < bestDistance) {
      bestDistance = startDistance;
      bestValue = edge;
      bestGuide = edge;
    }
    const endDistance = Math.abs(start + size - edge);
    if (endDistance < bestDistance) {
      bestDistance = endDistance;
      bestValue = edge - size;
      bestGuide = edge;
    }
  }
  return { value: bestValue, guide: bestGuide };
}

/**
 * 并排（平铺）几何：以 `first` 为锚，两窗等宽贴邻、顶边对齐，不越出应用边界。
 * 纯函数，供窗口管理器与测试复用。
 */
export function sideBySideFloatingGeometry(
  first: FloatGeometry,
  second: FloatGeometry,
  bounds: { width: number; height: number },
): { first: FloatGeometry; second: FloatGeometry } {
  const gap = 8;
  const width = Math.max(
    WINDOW_MIN_WIDTH_PX,
    Math.min(Math.floor((bounds.width - gap) / 2), Math.max(first.width, second.width)),
  );
  const height = Math.max(
    WINDOW_MIN_HEIGHT_PX,
    Math.min(Math.max(first.height, second.height), bounds.height),
  );
  let firstLeft = first.left;
  let secondLeft = firstLeft + width + gap;
  if (secondLeft + width > bounds.width) {
    firstLeft = Math.max(0, bounds.width - (width * 2 + gap));
    secondLeft = firstLeft + width + gap;
  }
  const top = Math.max(0, Math.min(first.top, bounds.height - height));
  return {
    first: { left: firstLeft, top, width, height },
    second: { left: secondLeft, top, width, height },
  };
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
}

interface WindowEntry {
  readonly controller: AiWindowController;
  placement: "docked" | "floating";
  geometry: FloatGeometry;
  zIndex: number;
  /** document 级监听器清理（Escape 取消拖动/缩放），销毁时移除避免泄漏。 */
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
 * 窗口管理器：把 `AiPanelState` 的窗口结构（打开窗口 + 停靠/浮动 + 聚焦）对账为 DOM。
 *
 * - 每个打开讨论对应一个窗口（一讨论至多一窗口，由状态层保证）；
 * - 窗口几何（位置/尺寸/层叠）由本模块本地持有，不进 reducer、不持久化；
 * - 停靠区收起为窄轨（只隐藏，不停止生成）；浮动窗口独立于停靠区。
 */
export function setupAiDock(
  dom: AiDockDom,
  state: AiPanelState,
  actions: AiDockActions,
): AiDockController {
  const windows = new Map<string, WindowEntry>();
  let zCounter = 0;
  let conversationListOpen = false;
  let pendingDeleteId: string | null = null;
  let renamingId: string | null = null;
  let listFilter = "";
  let expandedEarlier = false;
  let menu: HTMLElement | null = null;
  let sideBySidePair: [string, string] | null = null;
  let snapGuide: HTMLElement | null = null;

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
    };
  }

  function focusWindow(conversationId: string): void {
    state.focusWindow(conversationId);
    raiseWindow(conversationId);
  }

  function raiseWindow(conversationId: string): void {
    const entry = windows.get(conversationId);
    if (!entry || entry.placement !== "floating") return;
    zCounter += 1;
    entry.zIndex = zCounter;
    entry.controller.element.style.zIndex = String(zCounter);
  }

  function createWindow(conversationId: string, placement: "docked" | "floating"): void {
    const root = cloneWindowRoot(dom.windowTemplate);
    root.dataset.conversationId = conversationId;
    const controller = setupAiWindow(root, state, conversationId, buildWindowActions(conversationId));
    const entry: WindowEntry = {
      controller,
      placement,
      geometry: { left: 24, top: 24, width: WINDOW_DEFAULT_WIDTH_PX, height: WINDOW_DEFAULT_HEIGHT_PX },
      zIndex: 0,
      cleanups: [],
    };
    windows.set(conversationId, entry);

    root.addEventListener("pointerdown", () => focusWindow(conversationId));
    entry.cleanups.push(bindDrag(root, controller.dom, conversationId, entry));
    entry.cleanups.push(bindResize(root, controller.dom, entry));
    controller.dom.head.addEventListener("dblclick", () => togglePlacement(conversationId, entry));
    controller.dom.moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openWindowMenu(controller.dom.moreBtn, conversationId);
    });

    placeWindow(entry);
  }

  function destroyWindow(conversationId: string): void {
    const entry = windows.get(conversationId);
    if (!entry) return;
    breakSideBySide(conversationId);
    for (const cleanup of entry.cleanups) cleanup();
    entry.cleanups.length = 0;
    entry.controller.element.classList.remove("dragging");
    document.body.classList.remove("ai-window-dragging");
    hideSnapGuide();
    entry.controller.destroy();
    windows.delete(conversationId);
  }

  function placeWindow(entry: WindowEntry): void {
    const el = entry.controller.element;
    if (entry.placement === "floating") {
      el.classList.add("ai-window-floating");
      el.classList.remove("ai-window-docked");
      el.style.position = "absolute";
      el.style.left = `${entry.geometry.left}px`;
      el.style.top = `${entry.geometry.top}px`;
      el.style.width = `${entry.geometry.width}px`;
      el.style.height = `${entry.geometry.height}px`;
      el.style.zIndex = String(entry.zIndex);
      el.style.flex = "";
      if (el.parentElement !== dom.floatLayer) dom.floatLayer.appendChild(el);
    } else {
      el.classList.add("ai-window-docked");
      el.classList.remove("ai-window-floating");
      el.style.position = "";
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
      el.style.zIndex = "";
      el.style.flex = "";
      if (el.parentElement !== dom.body) dom.body.appendChild(el);
    }
  }

  function togglePlacement(conversationId: string, entry: WindowEntry): void {
    const next: "docked" | "floating" = entry.placement === "docked" ? "floating" : "docked";
    state.setWindowPlacement(conversationId, next);
  }

  // ===== 拖动 / 缩放（同一套规则：内容更新不打断，Esc 回起点，最小尺寸钳制，边界吸附） =====
  interface Gesture {
    startX: number;
    startY: number;
    startRect: FloatGeometry;
    active: boolean;
    /** 累计位移是否已越过拖动阈值（未越过前不真正移动/脱离停靠流）。 */
    moved: boolean;
    pointerId: number | null;
  }

  function newGesture(event: PointerEvent, rect: FloatGeometry): Gesture {
    return {
      startX: event.clientX,
      startY: event.clientY,
      startRect: rect,
      active: true,
      moved: false,
      pointerId: event.pointerId,
    };
  }

  /** 指针是否落在停靠区范围内。 */
  function isOverDock(clientX: number, clientY: number): boolean {
    const dockRect = dom.root.getBoundingClientRect();
    return (
      clientX >= dockRect.left &&
      clientX <= dockRect.right &&
      clientY >= dockRect.top &&
      clientY <= dockRect.bottom
    );
  }

  /** 放置区高亮：拖动进入停靠区时点亮，离开/结束/取消时熄灭。 */
  function setDropTarget(active: boolean): void {
    dom.body.classList.toggle("drop-target", active);
  }

  function bindDrag(root: HTMLElement, winDom: ReturnType<typeof buildAiWindowDom>, conversationId: string, entry: WindowEntry): () => void {
    let gesture: Gesture | null = null;
    winDom.head.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("button")) return;
      if (event.button !== 0) return;
      breakSideBySide(conversationId);
      const rect = root.getBoundingClientRect();
      gesture = newGesture(event, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      winDom.head.setPointerCapture(event.pointerId);
      root.classList.add("dragging");
      document.body.classList.add("ai-window-dragging");
    });
    winDom.head.addEventListener("pointermove", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      gesture.moved = true;
      const bounds = dom.floatLayer.getBoundingClientRect();
      const width = gesture.startRect.width;
      const height = gesture.startRect.height;
      const rawLeft = clampLeft(gesture.startRect.left + dx - bounds.left, width, bounds.width);
      const rawTop = clampTop(gesture.startRect.top + dy - bounds.top, height, bounds.height);
      const leftSnap = snapResult(rawLeft, width, [0, bounds.width, ...edgeCandidates(conversationId, "x")]);
      const topSnap = snapResult(rawTop, height, [0, bounds.height, ...edgeCandidates(conversationId, "y")]);
      setDropTarget(isOverDock(event.clientX, event.clientY));
      if (leftSnap.guide !== null) {
        showSnapGuide("x", leftSnap.guide, topSnap.value, topSnap.value + height);
      } else if (topSnap.guide !== null) {
        showSnapGuide("y", topSnap.guide, leftSnap.value, leftSnap.value + width);
      } else {
        hideSnapGuide();
      }
      applyDragPosition(entry, { left: leftSnap.value, top: topSnap.value, width, height });
    });
    winDom.head.addEventListener("pointerup", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      finishDrag(event.clientX, event.clientY, conversationId, entry, gesture);
      gesture = null;
    });
    winDom.head.addEventListener("pointercancel", () => {
      if (!gesture) return;
      cancelGesture(entry, gesture);
      gesture = null;
    });
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture) {
        cancelGesture(entry, gesture);
        gesture = null;
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }

  function bindResize(root: HTMLElement, winDom: ReturnType<typeof buildAiWindowDom>, entry: WindowEntry): () => void {
    let gesture: Gesture | null = null;
    winDom.resize.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      // 停靠窗口不支持缩放（缩放手柄在停靠态已隐藏；此处兜底）。
      if (entry.placement !== "floating") return;
      const rect = root.getBoundingClientRect();
      gesture = newGesture(event, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      winDom.resize.setPointerCapture(event.pointerId);
      root.classList.add("dragging");
    });
    winDom.resize.addEventListener("pointermove", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const bounds = dom.floatLayer.getBoundingClientRect();
      const width = clampWidth(gesture.startRect.width + dx);
      const height = clampHeight(gesture.startRect.height + dy);
      const left = clampLeft(gesture.startRect.left - bounds.left, width, bounds.width);
      const top = clampTop(gesture.startRect.top - bounds.top, height, bounds.height);
      applyResizeGeometry(entry, { left, top, width, height });
    });
    winDom.resize.addEventListener("pointerup", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture = null;
      root.classList.remove("dragging");
    });
    winDom.resize.addEventListener("pointercancel", () => {
      if (!gesture) return;
      cancelGesture(entry, gesture);
      gesture = null;
    });
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture) {
        cancelGesture(entry, gesture);
        gesture = null;
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }

  function edgeCandidates(excludeId: string, axis: "x" | "y"): number[] {
    const candidates: number[] = [];
    for (const [id, entry] of windows) {
      if (id === excludeId || entry.placement !== "floating") continue;
      const g = entry.geometry;
      if (axis === "x") {
        candidates.push(g.left, g.left + g.width);
      } else {
        candidates.push(g.top, g.top + g.height);
      }
    }
    return candidates;
  }

  /** 拖动中：把窗口脱离停靠流为浮动，并落位几何（会改变父级与 floating 类）。 */
  function applyDragPosition(entry: WindowEntry, geometry: FloatGeometry): void {
    entry.geometry = geometry;
    const el = entry.controller.element;
    if (el.parentElement !== dom.floatLayer) dom.floatLayer.appendChild(el);
    el.classList.add("ai-window-floating");
    el.style.position = "absolute";
    el.style.left = `${geometry.left}px`;
    el.style.top = `${geometry.top}px`;
    el.style.width = `${geometry.width}px`;
    el.style.height = `${geometry.height}px`;
  }

  /** 缩放中：只改浮动窗口的几何，不改停靠归属 / 父级 / floating 类。 */
  function applyResizeGeometry(entry: WindowEntry, geometry: FloatGeometry): void {
    entry.geometry = geometry;
    const el = entry.controller.element;
    el.style.left = `${geometry.left}px`;
    el.style.top = `${geometry.top}px`;
    el.style.width = `${geometry.width}px`;
    el.style.height = `${geometry.height}px`;
  }

  function finishDrag(clientX: number, clientY: number, conversationId: string, entry: WindowEntry, gesture: Gesture): void {
    gesture.active = false;
    entry.controller.element.classList.remove("dragging");
    document.body.classList.remove("ai-window-dragging");
    hideSnapGuide();
    setDropTarget(false);
    // 停靠窗口拖动期间收起停靠区：结束手势并回到停靠流（窗口随停靠区隐藏），不转为浮动（B6）。
    if (entry.placement === "docked" && !state.isOpen) {
      placeWindow(entry);
      return;
    }
    const overDock = isOverDock(clientX, clientY);
    if (entry.placement === "docked") {
      // 停靠窗口：仍在停靠区内则复位回停靠流；拖出则转浮动（落位兜底）。
      if (overDock || !gesture.moved) {
        placeWindow(entry);
      } else {
        state.setWindowPlacement(conversationId, "floating");
      }
    } else if (overDock) {
      state.setWindowPlacement(conversationId, "docked");
    } else {
      placeWindow(entry);
    }
  }

  function cancelGesture(entry: WindowEntry, gesture: Gesture): void {
    entry.controller.element.classList.remove("dragging");
    document.body.classList.remove("ai-window-dragging");
    hideSnapGuide();
    setDropTarget(false);
    // Esc 取消：回到手势起始几何（当前实现回的是最后一次移动位置）。
    if (entry.placement === "floating") {
      entry.geometry = { ...gesture.startRect };
    }
    placeWindow(entry);
  }

  // ===== 并排对照（瞬时布局关系：一方关闭/拖走即解除） =====
  function breakSideBySide(conversationId: string): void {
    if (!sideBySidePair || (sideBySidePair[0] !== conversationId && sideBySidePair[1] !== conversationId)) {
      return;
    }
    const [aId, bId] = sideBySidePair;
    sideBySidePair = null;
    const a = windows.get(aId);
    const b = windows.get(bId);
    if (a) a.controller.element.style.flex = "";
    if (b) b.controller.element.style.flex = "";
  }

  function sideBySide(aId: string, bId: string): void {
    const a = windows.get(aId);
    const b = windows.get(bId);
    if (!a || !b) return;
    // 混合停靠/浮动：先都转浮动（sync 会保留各自屏幕位置），再平铺（P0-10）。
    if (a.placement !== b.placement) {
      if (a.placement === "docked") state.setWindowPlacement(aId, "floating");
      if (b.placement === "docked") state.setWindowPlacement(bId, "floating");
      // setWindowPlacement 会触发 sync，但此刻 sideBySidePair 尚未设置，layoutSideBySide 会提前返回。
    }
    sideBySidePair = [aId, bId];
    layoutSideBySide();
  }

  function layoutSideBySide(): void {
    if (!sideBySidePair) return;
    const a = windows.get(sideBySidePair[0]);
    const b = windows.get(sideBySidePair[1]);
    if (!a || !b) return;
    // 停靠态：两窗等高相邻分栏。
    if (a.placement === "docked" && b.placement === "docked") {
      a.controller.element.style.flex = "1 1 0";
      b.controller.element.style.flex = "1 1 0";
      return;
    }
    // 混合态不应再出现（配对时已转浮动）；若因后续停靠动作出现，解除并排。
    if (a.placement !== "floating" || b.placement !== "floating") {
      sideBySidePair = null;
      a.controller.element.style.flex = "";
      b.controller.element.style.flex = "";
      return;
    }
    // 浮动态：左右平铺（以 first 为锚、等宽贴邻、顶边对齐、不越界）。
    const bounds = dom.floatLayer.getBoundingClientRect();
    const { first, second } = sideBySideFloatingGeometry(a.geometry, b.geometry, {
      width: bounds.width,
      height: bounds.height,
    });
    a.geometry = first;
    b.geometry = second;
    placeWindow(a);
    placeWindow(b);
  }

  // ===== 吸附参考线（靠近 8px 内出现，只画在被对齐边区间内，手势结束消失） =====
  function showSnapGuide(axis: "x" | "y", coordinate: number, start: number, end: number): void {
    if (!snapGuide) {
      snapGuide = document.createElement("div");
      snapGuide.className = "ai-snap-guide";
      snapGuide.style.position = "absolute";
      snapGuide.style.pointerEvents = "none";
      snapGuide.style.zIndex = "9999";
      const tag = document.createElement("span");
      tag.className = "ai-snap-tag";
      tag.textContent = "对齐";
      snapGuide.appendChild(tag);
      dom.floatLayer.appendChild(snapGuide);
    }
    snapGuide.style.borderTop = "none";
    snapGuide.style.borderLeft = "none";
    if (axis === "x") {
      snapGuide.style.left = `${coordinate}px`;
      snapGuide.style.top = `${start}px`;
      snapGuide.style.width = "0px";
      snapGuide.style.height = `${end - start}px`;
      snapGuide.style.borderLeft = "2px dashed var(--color-accent)";
    } else {
      snapGuide.style.left = `${start}px`;
      snapGuide.style.top = `${coordinate}px`;
      snapGuide.style.width = `${end - start}px`;
      snapGuide.style.height = "0px";
      snapGuide.style.borderTop = "2px dashed var(--color-accent)";
    }
  }

  function hideSnapGuide(): void {
    if (snapGuide) {
      snapGuide.remove();
      snapGuide = null;
    }
  }

  // ===== 菜单 =====
  interface MenuItem {
    icon?: string;
    label?: string;
    disabled?: boolean;
    danger?: boolean;
    divider?: boolean;
    action?: () => void;
  }

  function openWindowMenu(anchor: HTMLElement, conversationId: string): void {
    closeMenu();
    const current = windows.get(conversationId);
    const canSideBySide = windows.size >= 2;
    menu = buildMenu([
      { icon: "i-float", label: current?.placement === "floating" ? "停靠窗口" : "浮动窗口", action: () => current && togglePlacement(conversationId, current) },
      { icon: "i-sbs", label: "与…并排对照", disabled: !canSideBySide, action: () => openSideBySideMenu(anchor, conversationId) },
      { icon: "i-reset", label: "恢复默认布局", action: () => { state.resetLayout(); } },
      { divider: true },
      { icon: "i-trash", label: "删除讨论…", danger: true, action: () => { void actions.onDelete(conversationId); } },
    ]);
    positionMenu(menu, anchor);
  }

  function openSideBySideMenu(anchor: HTMLElement, conversationId: string): void {
    closeMenu();
    const others = [...windows.keys()].filter((id) => id !== conversationId);
    if (others.length === 0) return;
    menu = buildMenu(others.map((id) => ({
      icon: "i-sbs",
      label: discussionTitle(state.getDiscussion(id)),
      action: () => sideBySide(conversationId, id),
    })));
    positionMenu(menu, anchor);
  }

  function openDockMenu(anchor: HTMLElement): void {
    closeMenu();
    menu = buildMenu([
      { icon: "i-dock", label: "停靠所有浮动窗口", action: () => dockAllFloating() },
      { icon: "i-reset", label: "恢复默认布局", action: () => { state.resetLayout(); } },
    ]);
    positionMenu(menu, anchor);
  }

  function dockAllFloating(): void {
    for (const [id, entry] of windows) {
      if (entry.placement === "floating") state.setWindowPlacement(id, "docked");
    }
  }

  function buildMenu(items: readonly MenuItem[]): HTMLElement {
    const el = document.createElement("div");
    el.className = "ai-menu";
    for (const item of items) {
      if (item.divider) {
        const sep = document.createElement("div");
        sep.className = "ai-menu-sep";
        el.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      if (item.danger) btn.classList.add("ai-menu-danger");
      if (item.disabled) btn.disabled = true;
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
    document.body.appendChild(menuEl);
    const rect = anchor.getBoundingClientRect();
    menuEl.style.position = "fixed";
    menuEl.style.left = `${Math.max(8, rect.right - 170)}px`;
    menuEl.style.top = `${rect.bottom + 4}px`;
  }

  function closeMenu(): void {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (menu && !menu.contains(event.target as Node)) closeMenu();
  });

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
    if (discussion) return describeWindowStatus(windowStatusOf(discussion.request));
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
    row.append(actionsRow);

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
    if (!conversationListOpen) return;

    const filter = listFilter.trim().toLowerCase();
    const filterActive = filter !== "";
    const allSummaries = filter
      ? state.conversations.filter((summary) =>
          summary.title.toLowerCase().includes(filter) ||
          (summary.focus_document_title ?? "").toLowerCase().includes(filter))
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
    dom.count.textContent = `${state.windows.size} 个讨论`;
    dom.notice.replaceChildren();
    const undo = actions.getUndoNotice();
    if (undo) {
      // 删除撤销提示（停靠区层，不依赖列表是否打开）。
      dom.notice.classList.remove("hidden", "warn");
      dom.notice.classList.add("ok");
      const text = document.createElement("span");
      text.textContent = `已删除「${undo.title}」`;
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
    const open = state.isOpen;
    dom.root.classList.toggle("hidden", !open);
    dom.rail.classList.toggle("hidden", open);
  }

  // ===== 对账 =====
  function sync(): void {
    const openIds = new Set(state.windows.keys());
    for (const [id] of windows) {
      if (!openIds.has(id)) destroyWindow(id);
    }
    for (const [id, placement] of state.windows) {
      const existing = windows.get(id);
      if (!existing) {
        createWindow(id, placement);
      } else if (existing.placement !== placement) {
        existing.placement = placement;
        if (placement === "floating") {
          // 切浮动保留当前屏幕位置与尺寸（双击 / 并排转浮动），而非回到固定默认值（P0-7）。
          const floatBounds = dom.floatLayer.getBoundingClientRect();
          const rect = existing.controller.element.getBoundingClientRect();
          const width = clampWidth(rect.width);
          const height = clampHeight(rect.height);
          existing.geometry = {
            left: clampLeft(rect.left - floatBounds.left, width, floatBounds.width),
            top: clampTop(rect.top - floatBounds.top, height, floatBounds.height),
            width,
            height,
          };
        }
        placeWindow(existing);
      }
    }
    updateDockChrome();
    renderConversationList();
    layoutSideBySide();
  }

  dom.listToggleBtn.addEventListener("click", () => {
    conversationListOpen = !conversationListOpen;
    if (!conversationListOpen) {
      pendingDeleteId = null;
      renamingId = null;
    }
    renderConversationList();
  });
  dom.conversationListCloseBtn.addEventListener("click", () => {
    conversationListOpen = false;
    pendingDeleteId = null;
    renamingId = null;
    renderConversationList();
  });
  dom.listNewConversationBtn.addEventListener("click", () => {
    conversationListOpen = false;
    renderConversationList();
    actions.onNewConversation();
  });
  dom.searchInput.addEventListener("input", () => {
    listFilter = dom.searchInput.value;
    renderConversationList();
  });
  dom.newConversationBtn.addEventListener("click", () => actions.onNewConversation());
  dom.moreBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openDockMenu(dom.moreBtn);
  });
  dom.collapseBtn.addEventListener("click", () => state.close());
  dom.railNewBtn.addEventListener("click", () => { state.open(); actions.onNewConversation(); });
  dom.railListBtn.addEventListener("click", () => { state.open(); conversationListOpen = true; renderConversationList(); });
  dom.railMoreBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openDockMenu(dom.railMoreBtn);
  });
  dom.railExpandBtn.addEventListener("click", () => state.open());

  const unsubscribe = state.subscribe(sync);
  sync();

  return {
    destroy(): void {
      unsubscribe();
      for (const [id] of windows) destroyWindow(id);
      closeMenu();
      hideSnapGuide();
    },
  };
}
