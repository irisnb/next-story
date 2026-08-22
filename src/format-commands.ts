import type {
  DocNode,
  Mark,
  ParagraphAttrs,
  ParagraphNode,
  HeadingNode,
} from "./structured-notebook.ts";
import { collectSharedBlocks } from "./shared-document-models.ts";

export type FormatCommand =
  | { kind: "paragraph" }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "underline" }
  | { kind: "strike" }
  | { kind: "bulletList" }
  | { kind: "orderedList" }
  | { kind: "sinkListItem" }
  | { kind: "liftListItem" }
  | { kind: "clearFormatting" }
  | { kind: "clearCharacterFormat" }
  | { kind: "clearParagraphFormat" }
  | { kind: "textColor"; color: string | null }
  | { kind: "highlight"; color: string | null }
  | { kind: "fontFamily"; font: string | null }
  | { kind: "fontSize"; size: string | null }
  | { kind: "textAlign"; align: "left" | "center" | "right" | "justify" }
  | { kind: "lineHeight"; value: string | null }
  | { kind: "spacingBefore"; value: string | null }
  | { kind: "spacingAfter"; value: string | null }
  | { kind: "textIndent"; value: string | null }
  | { kind: "indentLeft"; value: string | null }
  | { kind: "indentRight"; value: string | null }
  | { kind: "setLink"; href: string }
  | { kind: "unsetLink" }
  | { kind: "undo" }
  | { kind: "redo" };

export type TriState = "off" | "mixed" | "on";

export type ParagraphStyleKind =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6";

export type TextAlignKind = "left" | "center" | "right" | "justify";

export interface FormatState {
  paragraphStyle: ParagraphStyleKind | "mixed";
  bold: TriState;
  italic: TriState;
  underline: TriState;
  strike: TriState;
  /** 列表状态：无 / 无序 / 有序 / 多种 */
  list: "none" | "bullet" | "ordered" | "mixed";
  /** 有效对齐（无属性按默认左对齐），统一值或多种 */
  textAlign: TextAlignKind | "mixed";
  /** 统一值 / 无（默认）/ 多种 */
  textColor: string | null | "mixed";
  highlight: string | null | "mixed";
  fontFamily: string | null | "mixed";
  fontSize: string | null | "mixed";
  lineHeight: string | null | "mixed";
  spacingBefore: string | null | "mixed";
  spacingAfter: string | null | "mixed";
  textIndent: string | null | "mixed";
  indentLeft: string | null | "mixed";
  indentRight: string | null | "mixed";
}

interface TextNodeInfo {
  text: string;
  marks?: Mark[];
}

interface BlockInfo {
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
  kind: "paragraph" | ParagraphStyleKind | "bulletItem" | "orderedItem";
  /** 列表嵌套深度（顶层为 0）。 */
  depth: number;
  textAlign: string | null;
  lineHeight: string | null;
  spacingBefore: string | null;
  spacingAfter: string | null;
  textIndent: string | null;
  indentLeft: string | null;
  indentRight: string | null;
  textNodes: TextNodeInfo[];
}

function textNodes(content: unknown): TextNodeInfo[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((node) => (node as { type?: string }).type === "text")
    .map((node) => {
      const n = node as { text?: string; marks?: Mark[] };
      return { text: n.text ?? "", marks: n.marks };
    });
}

function paragraphAttrsOf(node: { attrs?: ParagraphAttrs }): {
  textAlign: string | null;
  lineHeight: string | null;
  spacingBefore: string | null;
  spacingAfter: string | null;
  textIndent: string | null;
  indentLeft: string | null;
  indentRight: string | null;
} {
  const attrs = node.attrs;
  return {
    textAlign: attrs?.textAlign ?? null,
    lineHeight: attrs?.lineHeight ?? null,
    spacingBefore: attrs?.spacingBefore ?? null,
    spacingAfter: attrs?.spacingAfter ?? null,
    textIndent: attrs?.textIndent ?? null,
    indentLeft: attrs?.indentLeft ?? null,
    indentRight: attrs?.indentRight ?? null,
  };
}

/**
 * 展开文档为扁平的块信息，递归展开嵌套列表并记录深度。
 * 位置模型与 ProseMirror 一致：doc 开/闭 token 不计入位置，第一个 block 从 0 开始。
 * 遍历与位置计算复用共享块遍历器，这里只把共享记录映射为 BlockInfo。
 */
function collectBlocks(doc: DocNode): BlockInfo[] {
  return collectSharedBlocks(doc).map((record) => {
    const block = record.node as ParagraphNode | HeadingNode;
    const nodes = textNodes(block.content);
    const kind: BlockInfo["kind"] = record.list
      ? record.list.kind === "bullet"
        ? "bulletItem"
        : "orderedItem"
      : block.type === "heading"
        ? `heading${block.attrs.level}`
        : "paragraph";
    return {
      start: record.start,
      end: record.end,
      textStart: record.textStart,
      textEnd: record.textEnd,
      kind,
      depth: record.depth,
      ...paragraphAttrsOf(block),
      textNodes: nodes,
    };
  });
}

function intersects(block: BlockInfo, from: number, to: number): boolean {
  return block.end > from && block.start < to;
}

function markTriState(nodes: TextNodeInfo[], mark: string): TriState {
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

/** 读取某个带属性 mark 的指定属性值。 */
function markAttr(mark: Mark | undefined, attr: string): string | undefined {
  if (!mark) return undefined;
  if (mark.type === "textStyle" || mark.type === "highlight" || mark.type === "link") {
    const value = (mark.attrs as Record<string, unknown>)[attr];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** 从文本节点集合推导带属性 mark 的属性状态：统一值 / 无 / 多种。 */
function attrTriState(nodes: TextNodeInfo[], markType: string, attr: string): string | null | "mixed" {
  let found: string | null = null;
  let sawValue = false;
  let sawNone = false;
  for (const node of nodes) {
    const value = markAttr(node.marks?.find((m) => m.type === markType), attr);
    if (value === undefined) {
      sawNone = true;
    } else {
      sawValue = true;
      if (found === null) found = value;
      else if (found !== value) return "mixed";
    }
  }
  if (sawValue && !sawNone) return found;
  if (!sawValue && sawNone) return null;
  return "mixed";
}

/** 段落属性（默认 null 表示无）的统一状态。 */
function paragraphAttrState(values: (string | null)[]): string | null | "mixed" {
  const nonNull = values.filter((v): v is string => v !== null);
  if (nonNull.length === 0) return null;
  const first = nonNull[0];
  return nonNull.every((v) => v === first) ? first : "mixed";
}

/** 对齐的统一状态（无属性按默认左对齐）。 */
function textAlignState(values: (string | null)[]): TextAlignKind | "mixed" {
  const effective = values.map((v) => (v === "left" || v === "center" || v === "right" || v === "justify" ? v : "left"));
  const first = effective[0];
  return effective.every((v) => v === first) ? (first as TextAlignKind) : "mixed";
}

/**
 * 从结构化文档与选区位置推导工具栏格式状态（纯函数）。
 * 段落样式、列表与段落属性按“选区触及的完整块”判断，字符标记按选区内文字判断。
 */
export function analyzeSelection(doc: DocNode, from: number, to: number): FormatState {
  const blocks = collectBlocks(doc);
  const touched = blocks.filter((block) => intersects(block, from, to));

  // 段落样式（含一到六级标题）
  const styleKinds = touched
    .filter((b) => b.kind !== "bulletItem" && b.kind !== "orderedItem")
    .map((b) => b.kind) as ParagraphStyleKind[];
  const uniqueStyles = new Set(styleKinds);
  let paragraphStyle: FormatState["paragraphStyle"];
  if (uniqueStyles.size === 0) paragraphStyle = "mixed";
  else if (uniqueStyles.size === 1) paragraphStyle = [...uniqueStyles][0];
  else paragraphStyle = "mixed";

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

  // 段落属性（按触及的完整块）
  const textAlign = textAlignState(touched.map((b) => b.textAlign));
  const lineHeight = paragraphAttrState(touched.map((b) => b.lineHeight));
  const spacingBefore = paragraphAttrState(touched.map((b) => b.spacingBefore));
  const spacingAfter = paragraphAttrState(touched.map((b) => b.spacingAfter));
  const textIndent = paragraphAttrState(touched.map((b) => b.textIndent));
  const indentLeft = paragraphAttrState(touched.map((b) => b.indentLeft));
  const indentRight = paragraphAttrState(touched.map((b) => b.indentRight));

  // 字符标记（按选区文字范围）
  const selectedTextNodes: TextNodeInfo[] = [];
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
  const underline = markTriState(selectedTextNodes, "underline");
  const strike = markTriState(selectedTextNodes, "strike");
  const textColor = attrTriState(selectedTextNodes, "textStyle", "color");
  const fontFamily = attrTriState(selectedTextNodes, "textStyle", "fontFamily");
  const fontSize = attrTriState(selectedTextNodes, "textStyle", "fontSize");
  const highlight = attrTriState(selectedTextNodes, "highlight", "color");

  return {
    paragraphStyle,
    bold,
    italic,
    underline,
    strike,
    list,
    textAlign,
    textColor,
    highlight,
    fontFamily,
    fontSize,
    lineHeight,
    spacingBefore,
    spacingAfter,
    textIndent,
    indentLeft,
    indentRight,
  };
}
