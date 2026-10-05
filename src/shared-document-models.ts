/**
 * 结构化文档节点的最小形状：`type` 必填；`text` 仅文本节点使用；
 * `content` 为子节点列表，递归同型；`attrs` 宽松承载（列表按
 * `{ start, type }` 收窄读取，见 visitList）。
 */
export interface SharedDocumentNode {
  type?: string;
  text?: string;
  content?: SharedDocumentNode[];
  attrs?: unknown;
}

/**
 * 有序列表编号样式（五值域；缺省等同 `"1"`）。
 * 与存储 grammar 的 `orderedList.attrs.type` 取值一致。
 */
export type SharedOrderedListStyle = "1" | "A" | "a" | "I" | "i";

/** 把编号样式值归一化为五值域；非法或缺省回退 `"1"`。 */
export function normalizeOrderedListStyle(raw: unknown): SharedOrderedListStyle {
  return raw === "A" || raw === "a" || raw === "I" || raw === "i" ? raw : "1";
}

/**
 * 大写字母编号（双射二十六进制：1→A、26→Z、27→AA）。
 * `upper` 为假时输出小写形态。
 */
export function letterMarker(value: number, upper: boolean): string {
  let n = Math.floor(value);
  if (n < 1 || !Number.isSafeInteger(n)) return String(n);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode((upper ? 65 : 97) + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * 标准减法式罗马数字（1954→MCMXCIV）；`upper` 为假时输出小写形态。
 * 与浏览器 `ol[type=I]` 的计数样式一致：超过 3999 重复 M（MMMM…），
 * 不引入上划线扩展。
 */
export function romanMarker(value: number, upper: boolean): string {
  let n = Math.floor(value);
  if (n < 1 || !Number.isSafeInteger(n)) return String(n);
  const table: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [num, symbol] of table) {
    while (n >= num) {
      out += symbol;
      n -= num;
    }
  }
  return upper ? out : out.toLowerCase();
}

/** 按编号样式生成列表标记（不含尾部 `. `）。 */
export function orderedListMarker(
  value: number,
  style: SharedOrderedListStyle,
): string {
  switch (style) {
    case "A":
      return letterMarker(value, true);
    case "a":
      return letterMarker(value, false);
    case "I":
      return romanMarker(value, true);
    case "i":
      return romanMarker(value, false);
    default:
      return String(value);
  }
}

/**
 * 按 ProseMirror 位置模型计算节点尺寸：
 * - 文本节点：返回文字长度（text.length）；
 * - 其余节点：返回 2 + 子节点尺寸总和（开/闭 token 各占 1）；
 * - 空块（无 content）：返回 2。
 */
export function nodeSize(node: SharedDocumentNode): number {
  if (node.type === "text") {
    return node.text?.length ?? 0;
  }
  let size = 2;
  if (node.content) {
    for (const child of node.content) {
      size += nodeSize(child);
    }
  }
  return size;
}

/**
 * 共享块遍历记录：文档中每个「行块」（段落、标题或列表项段落）的公共信息。
 * 位置模型与 ProseMirror 一致：doc 开/闭 token 不计入位置，第一个 block 从 0 开始。
 */
export interface SharedBlockRecord {
  /** 该块（段落/标题/列表项段落）的起止位置。 */
  start: number;
  end: number;
  /** 可见文字的起止位置（marks 不占位置）。 */
  textStart: number;
  textEnd: number;
  /** 完整可见文字。 */
  text: string;
  /** 列表嵌套深度（顶层为 0）。 */
  depth: number;
  /** 该块对应的段落/标题节点。 */
  node: SharedDocumentNode;
  /** 列表项上下文：非列表项为 null。 */
  list: {
    kind: "bullet" | "ordered";
    prefix: string;
    style: SharedOrderedListStyle;
    /** 所属列表节点的起止位置（含开闭 token）。 */
    listStart: number;
    listEnd: number;
  } | null;
}

function inlineText(content: SharedDocumentNode[] | undefined): string {
  return (content ?? []).map((node) => node.text ?? "").join("");
}

/**
 * 展开文档为扁平的块记录，递归展开嵌套列表并记录深度。
 * 复用 nodeSize 计算位置；段落/标题与列表项段落都产出记录，
 * 列表项记录携带列表种类、编号样式与按样式生成的纯文本前缀
 * （`- ` 或 `N. ` / `A. ` / `a. ` / `I. ` / `i. `）。
 */
export function collectSharedBlocks(doc: SharedDocumentNode): SharedBlockRecord[] {
  const records: SharedBlockRecord[] = [];

  function visitList(
    list: SharedDocumentNode,
    listPos: number,
    depth: number,
  ): void {
    const isOrdered = list.type === "orderedList";
    const listAttrs =
      (list.attrs as { start?: unknown; type?: unknown } | undefined) ?? {};
    const orderedStart =
      typeof listAttrs.start === "number" && Number.isInteger(listAttrs.start) && listAttrs.start >= 1
        ? listAttrs.start
        : 1;
    const orderedStyle = normalizeOrderedListStyle(listAttrs.type);
    const listEnd = listPos + nodeSize(list);
    let itemPos = listPos + 1;
    let index = 0;
    for (const item of list.content ?? []) {
      const itemEnd = itemPos + nodeSize(item);
      const paragraph = item.content?.[0];
      if (paragraph) {
        const paragraphPos = itemPos + 1;
        const paragraphSize = nodeSize(paragraph);
        const text = inlineText(paragraph.content);
        const textStart = paragraphPos + 1;
        const prefix = isOrdered
          ? `${orderedListMarker(orderedStart + index, orderedStyle)}. `
          : "- ";
        records.push({
          // 行范围用列表项自身段落范围，不含嵌套子列表，避免选中子列表时父项被误判相交。
          start: paragraphPos,
          end: paragraphPos + paragraphSize,
          textStart,
          textEnd: textStart + text.length,
          text,
          depth,
          node: paragraph,
          list: {
            kind: isOrdered ? "ordered" : "bullet",
            prefix,
            style: isOrdered ? orderedStyle : "1",
            listStart: listPos,
            listEnd,
          },
        });
        if (item.content && item.content.length === 2) {
          const nested = item.content[1];
          visitList(nested, paragraphPos + paragraphSize, depth + 1);
        }
      }
      itemPos = itemEnd;
      index += 1;
    }
  }

  // ProseMirror 位置模型：doc 节点的开/闭 token 不计入位置，第一个 block 从 0 开始。
  let pos = 0;
  for (const block of doc.content ?? []) {
    const blockStart = pos;
    const blockEnd = pos + nodeSize(block);
    if (block.type === "paragraph" || block.type === "heading") {
      const text = inlineText(block.content);
      const textStart = blockStart + 1;
      records.push({
        start: blockStart,
        end: blockEnd,
        textStart,
        textEnd: textStart + text.length,
        text,
        depth: 0,
        node: block,
        list: null,
      });
    } else {
      visitList(block, blockStart, 0);
    }
    pos = blockEnd;
  }
  return records;
}
