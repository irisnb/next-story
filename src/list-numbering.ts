import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import type { OrderedListStyle } from "./structured-notebook.ts";

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

/**
 * 把选区 [from, to) 触及的列表项**直接所属**的有序列表整体设置为指定编号样式
 * （add-list-numbering-formats 底层命令，供工具栏子菜单调用）。
 *
 * 作用口径（与规格 nested-lists「嵌套内切换只影响当前层」一致）：
 * - 「触及的列表项」＝该列表项**自身段落**范围与选区相交（其嵌套子列表范围
 *   不算——父层不因选区位于子列表内而改变，子层不因父项被触及而改变）；
 * - 每个被触及的列表项，其直接所属的完整 `orderedList` 节点被设置样式
 *   （不拆散列表、不动无序列表、未触及的列表不动）；
 * - 样式为缺省 `"1"` 时写回 `null`（与 Tiptap 属性缺省一致，序列化时省略）；
 * - 逐列表 `setNodeMarkup` 进入同一事务：可整体撤销、可整体重做。
 *
 * 返回被修改的列表节点数（样式未变化或选区未触及任何有序列表项时为 0）。
 */
export function setOrderedListStyleInSelection(
  doc: ProseMirrorNode,
  tr: Transaction,
  from: number,
  to: number,
  style: OrderedListStyle,
): number {
  const nextType = style === "1" ? null : style;
  const listPositions = new Set<number>();
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== "listItem") return;
    if (!parent || parent.type.name !== "orderedList") return;
    // 列表项自身内容＝首子节点段落；嵌套子列表不计入父项的触及范围。
    const paragraph = node.firstChild;
    if (!paragraph || paragraph.type.name !== "paragraph") return;
    const paraPos = pos + 1;
    const paraEnd = paraPos + paragraph.nodeSize;
    if (paraEnd <= from || paraPos >= to) return;
    // 直接所属有序列表的位置（resolve 到列表项起点：该深度的节点即所属列表）。
    const resolved = doc.resolve(pos);
    listPositions.add(resolved.before(resolved.depth));
  });
  let changed = 0;
  for (const listPos of listPositions) {
    const listNode = doc.nodeAt(listPos);
    if (!listNode || listNode.type.name !== "orderedList") continue;
    if ((listNode.attrs.type ?? null) === nextType) continue;
    tr.setNodeMarkup(listPos, undefined, { ...listNode.attrs, type: nextType });
    changed += 1;
  }
  return changed;
}
