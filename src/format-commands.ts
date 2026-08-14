import type { DocNode } from "./structured-notebook.ts";

export type FormatCommand =
  | { kind: "paragraph" }
  | { kind: "heading"; level: 1 | 2 }
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "bulletList" }
  | { kind: "orderedList" }
  | { kind: "clearFormatting" }
  | { kind: "undo" }
  | { kind: "redo" };

export type TriState = "off" | "mixed" | "on";

export interface FormatState {
  /** 段落样式：正文 / 一级标题 / 二级标题 / 多种格式 */
  paragraphStyle: "paragraph" | "heading1" | "heading2" | "mixed";
  bold: TriState;
  italic: TriState;
  /** 列表状态：无 / 无序 / 有序 / 多种 */
  list: "none" | "bullet" | "ordered" | "mixed";
}

interface BlockInfo {
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
  kind: "paragraph" | "heading1" | "heading2" | "bulletItem" | "orderedItem";
  textNodes: { text: string; marks?: { type: string }[] }[];
}

function nodeSize(node: unknown): number {
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return (n.text ?? "").length;
  let size = 2;
  for (const child of n.content ?? []) size += nodeSize(child);
  return size;
}

function textNodes(content: unknown): { text: string; marks?: { type: string }[] }[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((node) => (node as { type?: string }).type === "text")
    .map((node) => {
      const n = node as { text?: string; marks?: { type: string }[] };
      return { text: n.text ?? "", marks: n.marks };
    });
}

/** 展开文档为扁平的块信息（列表项按各自列表类型展开）。 */
function collectBlocks(doc: DocNode): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  // ProseMirror 位置模型：doc 节点的开/闭 token 不计入位置，第一个 block 从 0 开始。
  let pos = 0;
  for (const block of doc.content) {
    const blockStart = pos;
    const blockEnd = pos + nodeSize(block);
    if (block.type === "paragraph") {
      const nodes = textNodes(block.content);
      blocks.push({
        start: blockStart,
        end: blockEnd,
        textStart: blockStart + 1,
        textEnd: blockStart + 1 + nodes.reduce((sum, t) => sum + t.text.length, 0),
        kind: "paragraph",
        textNodes: nodes,
      });
    } else if (block.type === "heading") {
      const nodes = textNodes(block.content);
      blocks.push({
        start: blockStart,
        end: blockEnd,
        textStart: blockStart + 1,
        textEnd: blockStart + 1 + nodes.reduce((sum, t) => sum + t.text.length, 0),
        kind: block.attrs.level === 1 ? "heading1" : "heading2",
        textNodes: nodes,
      });
    } else if (block.type === "bulletList") {
      let itemPos = blockStart + 1;
      for (const item of block.content) {
        const itemEnd = itemPos + nodeSize(item);
        const nodes = textNodes(item.content[0].content);
        blocks.push({
          start: itemPos,
          end: itemEnd,
          textStart: itemPos + 2,
          textEnd: itemPos + 2 + nodes.reduce((sum, t) => sum + t.text.length, 0),
          kind: "bulletItem",
          textNodes: nodes,
        });
        itemPos = itemEnd;
      }
    } else {
      let itemPos = blockStart + 1;
      for (const item of block.content) {
        const itemEnd = itemPos + nodeSize(item);
        const nodes = textNodes(item.content[0].content);
        blocks.push({
          start: itemPos,
          end: itemEnd,
          textStart: itemPos + 2,
          textEnd: itemPos + 2 + nodes.reduce((sum, t) => sum + t.text.length, 0),
          kind: "orderedItem",
          textNodes: nodes,
        });
        itemPos = itemEnd;
      }
    }
    pos = blockEnd;
  }
  return blocks;
}

function intersects(block: BlockInfo, from: number, to: number): boolean {
  return block.end > from && block.start < to;
}

/**
 * 从结构化文档与选区位置推导工具栏格式状态（纯函数）。
 * 段落样式与列表按“选区触及的完整块”判断，粗斜体按选区内文字判断。
 */
export function analyzeSelection(doc: DocNode, from: number, to: number): FormatState {
  const blocks = collectBlocks(doc);
  const touched = blocks.filter((block) => intersects(block, from, to));

  // 段落样式
  const styleKinds = touched
    .filter((b) => b.kind === "paragraph" || b.kind === "heading1" || b.kind === "heading2")
    .map((b) => b.kind);
  const uniqueStyles = new Set(styleKinds);
  let paragraphStyle: FormatState["paragraphStyle"];
  if (uniqueStyles.size === 0) paragraphStyle = "mixed";
  else if (uniqueStyles.size === 1) {
    const only = [...uniqueStyles][0];
    paragraphStyle = only as "paragraph" | "heading1" | "heading2";
  } else paragraphStyle = "mixed";

  // 列表状态
  const listKinds = new Set(
    touched
      .filter((b) => b.kind === "bulletItem" || b.kind === "orderedItem")
      .map((b) => (b.kind === "bulletItem" ? "bullet" : "ordered")),
  );
  const nonListItem = touched.some((b) => b.kind !== "bulletItem" && b.kind !== "orderedItem");
  let list: FormatState["list"];
  if (listKinds.size === 0) list = "none";
  else if (listKinds.size === 1) {
    list = nonListItem ? "mixed" : ([...listKinds][0] as "bullet" | "ordered");
  } else list = "mixed";

  // 粗斜体（按选区文字范围）
  const selectedTextNodes: { text: string; marks?: { type: string }[] }[] = [];
  for (const block of blocks) {
    if (!intersects(block, from, to)) continue;
    let offset = block.textStart;
    for (const node of block.textNodes) {
      const nodeStart = offset;
      const nodeEnd = offset + node.text.length;
      offset = nodeEnd;
      if (nodeEnd <= from || nodeStart >= to) continue;
      const sliceFrom = Math.max(nodeStart, from) - nodeStart;
      const sliceTo = Math.min(nodeEnd, to) - nodeStart;
      selectedTextNodes.push({ text: node.text.slice(sliceFrom, sliceTo), marks: node.marks });
    }
  }
  const bold = markTriState(selectedTextNodes, "bold");
  const italic = markTriState(selectedTextNodes, "italic");

  return { paragraphStyle, bold, italic, list };
}

function markTriState(nodes: { text: string; marks?: { type: string }[] }[], mark: string): TriState {
  let total = 0;
  let matched = 0;
  for (const node of nodes) {
    total += node.text.length;
    if (node.marks?.some((m) => m.type === mark)) matched += node.text.length;
  }
  if (matched === 0) return "off";
  if (matched === total) return "on";
  return "mixed";
}
