/**
 * 结构化文档节点的最小形状：`type` 必填；`text` 仅文本节点使用；
 * `content` 为子节点列表，递归同型。
 */
export interface SharedDocumentNode {
  type?: string;
  text?: string;
  content?: SharedDocumentNode[];
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
  list: { kind: "bullet" | "ordered"; prefix: string } | null;
}

function inlineText(content: SharedDocumentNode[] | undefined): string {
  return (content ?? []).map((node) => node.text ?? "").join("");
}

/**
 * 展开文档为扁平的块记录，递归展开嵌套列表并记录深度。
 * 复用 nodeSize 计算位置；段落/标题与列表项段落都产出记录，
 * 列表项记录携带列表种类与纯文本前缀（`- ` 或 `N. `）。
 */
export function collectSharedBlocks(doc: SharedDocumentNode): SharedBlockRecord[] {
  const records: SharedBlockRecord[] = [];

  function visitList(
    list: SharedDocumentNode,
    listPos: number,
    depth: number,
  ): void {
    const isOrdered = list.type === "orderedList";
    const orderedStart =
      (list as { attrs?: { start?: number } }).attrs?.start ?? 1;
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
        const prefix = isOrdered ? `${orderedStart + index}. ` : "- ";
        records.push({
          // 行范围用列表项自身段落范围，不含嵌套子列表，避免选中子列表时父项被误判相交。
          start: paragraphPos,
          end: paragraphPos + paragraphSize,
          textStart,
          textEnd: textStart + text.length,
          text,
          depth,
          node: paragraph,
          list: { kind: isOrdered ? "ordered" : "bullet", prefix },
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
