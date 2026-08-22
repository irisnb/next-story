// 链接共享工具与动作：链接发现（linkHrefAt）与打开/编辑/创建/移除链接的动作工厂。
// 供链接弹层、右键菜单与快捷键共用；只依赖注入的 runFormatCommand 与 openUrl，不依赖完整编辑器控制器。

import type { JSONContent } from "@tiptap/core";

import { nodeSize } from "./shared-document-models.ts";
import type { FormatCommand } from "./format-commands.ts";

/** 与 ProseMirror 一致的节点位置大小（和 format-commands 内部 nodeSize 同一位置模型）。 */
function positionSize(node: JSONContent): number {
  return nodeSize(node);
}

/**
 * 选区（或光标）触及的第一个链接 mark 的 href；没有链接返回 null。
 * 光标情形要求严格落在文本节点内部（边界位置不算在链接上）。
 */
export function linkHrefAt(doc: JSONContent, from: number, to: number): string | null {
  let found: string | null = null;

  function walk(node: JSONContent, nodeStart: number): void {
    if (found !== null) return;
    const size = positionSize(node);
    const nodeEnd = nodeStart + size;
    const touched =
      from === to
        ? nodeStart < from && nodeEnd > from
        : nodeStart < to && nodeEnd > from;
    if (!touched) return;
    if (node.type === "text") {
      const link = node.marks?.find((mark) => mark.type === "link");
      const href = link?.attrs?.href;
      if (typeof href === "string" && href.length > 0) found = href;
      return;
    }
    let childPos = nodeStart + 1;
    for (const child of node.content ?? []) {
      walk(child, childPos);
      childPos += positionSize(child);
    }
  }

  let pos = 0;
  for (const block of doc.content ?? []) {
    walk(block, pos);
    pos += positionSize(block);
  }
  return found;
}

export interface LinkActionsDeps {
  runFormatCommand(command: FormatCommand): boolean;
  openUrl(href: string): Promise<void>;
}

export interface LinkActions {
  openLinkHref(href: string): void;
  editLinkHref(currentHref: string): void;
  createLinkHref(): void;
  removeLinkHref(): void;
}

export function createLinkActions(deps: LinkActionsDeps): LinkActions {
  function openLinkHref(href: string): void {
    const lower = href.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      void deps.openUrl(href).catch(() => alert("无法打开链接，请检查系统默认浏览器设置。"));
    } else {
      alert("此链接不是 http/https 地址，无法打开。");
    }
  }

  function editLinkHref(currentHref: string): void {
    const input = window.prompt("链接地址", currentHref);
    if (input === null) return;
    const href = input.trim();
    if (href === "") return;
    deps.runFormatCommand({ kind: "setLink", href });
  }

  function createLinkHref(): void {
    const input = window.prompt("链接地址");
    if (input === null) return;
    const href = input.trim();
    if (href === "") return;
    deps.runFormatCommand({ kind: "setLink", href });
  }

  function removeLinkHref(): void {
    deps.runFormatCommand({ kind: "unsetLink" });
  }

  return { openLinkHref, editLinkHref, createLinkHref, removeLinkHref };
}