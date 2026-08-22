// 链接弹层：选区（或光标）触及链接时显示弹层并定位，提供打开/编辑/移除链接按钮。
// 只依赖弹层 DOM 节点、编辑器窄能力（getSelection/getDocument/coordinatesAt）与注入的链接动作，
// 不依赖完整编辑器控制器；本地状态（当前弹层指向的 href）由本模块持有。

import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { linkHrefAt, type LinkActions } from "./editor-link-actions.ts";

/** 链接弹层模块所需的编辑器窄能力。 */
export interface LinkPopoverEditorCapabilities {
  getSelection(): { from: number; to: number; head: number };
  getDocument(): JSONContent;
  coordinatesAt(position: number): { left: number; bottom: number };
}

export interface LinkPopoverDeps {
  dom: Pick<AppDom, "linkPopover" | "btnLinkOpen" | "btnLinkEdit" | "btnLinkRemove">;
  /** 返回当前编辑器窄能力；无编辑器时为 null。 */
  getEditor(): LinkPopoverEditorCapabilities | null;
  /** 注入的链接动作（打开/编辑/移除）。 */
  linkActions: LinkActions;
}

export interface LinkPopover {
  /** 隐藏弹层并清空当前 href。 */
  hide(): void;
  /** 根据当前选区刷新弹层：无链接或无编辑器时隐藏。 */
  update(): void;
  /** 移除全部监听。 */
  dispose(): void;
}

export function createLinkPopover(deps: LinkPopoverDeps): LinkPopover {
  const { dom } = deps;
  let popoverHref: string | null = null;

  function hide(): void {
    popoverHref = null;
    dom.linkPopover.classList.add("hidden");
  }

  function update(): void {
    const current = deps.getEditor();
    if (!current) {
      hide();
      return;
    }
    const { from, to, head } = current.getSelection();
    const href = linkHrefAt(current.getDocument(), from, to);
    if (href === null) {
      hide();
      return;
    }
    popoverHref = href;
    const coords = current.coordinatesAt(head);
    dom.linkPopover.classList.remove("hidden");
    const popoverWidth = dom.linkPopover.offsetWidth || 200;
    const viewWidth = window.innerWidth || 1024;
    const left = Math.max(8, Math.min(coords.left, viewWidth - popoverWidth - 8));
    dom.linkPopover.style.left = `${left}px`;
    dom.linkPopover.style.top = `${coords.bottom + 6}px`;
  }

  function onOpen(): void {
    const href = popoverHref;
    hide();
    if (href !== null) deps.linkActions.openLinkHref(href);
  }

  function onEdit(): void {
    const href = popoverHref;
    hide();
    if (href !== null) deps.linkActions.editLinkHref(href);
  }

  function onRemove(): void {
    hide();
    deps.linkActions.removeLinkHref();
  }

  dom.btnLinkOpen.addEventListener("click", onOpen);
  dom.btnLinkEdit.addEventListener("click", onEdit);
  dom.btnLinkRemove.addEventListener("click", onRemove);

  return {
    hide,
    update,
    dispose: () => {
      dom.btnLinkOpen.removeEventListener("click", onOpen);
      dom.btnLinkEdit.removeEventListener("click", onEdit);
      dom.btnLinkRemove.removeEventListener("click", onRemove);
    },
  };
}