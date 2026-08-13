import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

/**
 * 拆分有序列表后，把尾段列表的 `start` 修正为其首项操作前的实际编号。
 *
 * 拆分后的文档中存在两个 `start` 相同的有序列表（首段与尾段，之间隔着被抬出的
 * 正文段落），按文档顺序第二个即为尾段。若只存在一个同 `start` 的有序列表，说明
 * 本次操作不是拆分，不做任何修改。
 */
export function fixSplitOrderedListStart(
  doc: ProseMirrorNode,
  tr: Transaction,
  originalStart: number,
  trailingStart: number,
): void {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "orderedList" && node.attrs.start === originalStart) {
      positions.push(pos);
    }
  });
  if (positions.length < 2) return;

  const trailingNode = doc.nodeAt(positions[1]);
  if (!trailingNode) return;

  tr.setNodeMarkup(positions[1], trailingNode.type, {
    ...trailingNode.attrs,
    start: trailingStart,
  });
}
