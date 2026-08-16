// 查找与替换：在当前本子可见文字上做字面匹配，返回 ProseMirror 文档坐标，
// 并通过装饰插件高亮全部命中与当前命中。

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface TextMatch {
  from: number;
  to: number;
}

export interface FindReplaceState {
  query: string;
  caseSensitive: boolean;
  matches: TextMatch[];
  activeIndex: number;
}

export const findPluginKey = new PluginKey<FindReplaceState>("findReplace");

function emptyState(): FindReplaceState {
  return { query: "", caseSensitive: false, matches: [], activeIndex: -1 };
}

/**
 * 在文档可见文字中查找字面匹配（按文本块搜索，跨行内标记边界也能命中）。
 * 返回每个命中的文档坐标 [from, to)。
 */
export function findMatchesInDoc(
  doc: PMNode,
  query: string,
  caseSensitive: boolean,
): TextMatch[] {
  if (query === "") return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, "", "");
    const searchable = caseSensitive ? text : text.toLowerCase();
    const textStart = pos + 1;
    let index = 0;
    while (index + needle.length <= searchable.length) {
      const found = searchable.indexOf(needle, index);
      if (found === -1) break;
      matches.push({ from: textStart + found, to: textStart + found + query.length });
      index = found + query.length;
    }
  });
  return matches;
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplaceState>({
        key: findPluginKey,
        state: {
          init: () => emptyState(),
          apply: (tr, previous) => {
            const meta = tr.getMeta(findPluginKey);
            if (meta !== undefined) return meta as FindReplaceState;
            // 文档被替换后保持最近一次 find 状态（命中坐标由调用方在替换后重算刷新）。
            return previous;
          },
        },
        props: {
          decorations(state) {
            const findState = findPluginKey.getState(state);
            if (!findState || findState.matches.length === 0) return DecorationSet.empty;
            const decorations = findState.matches.map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class:
                  index === findState.activeIndex
                    ? "find-match find-match-active"
                    : "find-match",
              }),
            );
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
