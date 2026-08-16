// 本轮自定义 Tiptap 扩展。
//
// - FontSize：Tiptap 2.x 没有官方字号包，这里给 textStyle 标记加 fontSize 全局属性。
// - ParagraphStyle：给 paragraph 与 heading 加行距、段前段后间距、首行缩进、左右缩进的
//   全局属性（textAlign 由官方 @tiptap/extension-text-align 提供）。
//
// 这些属性的 JSON 都会带默认 null 值（ProseMirror computeAttrs 行为），保存时由
// structured-notebook.ts 的 canonicalDoc 丢弃 null，得到干净的规范磁盘形态。

import { Extension } from "@tiptap/core";

export const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

export const ParagraphStyle = Extension.create({
  name: "paragraphStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
          },
          spacingBefore: {
            default: null,
            parseHTML: (element) => element.style.marginTop || null,
            renderHTML: (attributes) =>
              attributes.spacingBefore ? { style: `margin-top: ${attributes.spacingBefore}` } : {},
          },
          spacingAfter: {
            default: null,
            parseHTML: (element) => element.style.marginBottom || null,
            renderHTML: (attributes) =>
              attributes.spacingAfter ? { style: `margin-bottom: ${attributes.spacingAfter}` } : {},
          },
          textIndent: {
            default: null,
            parseHTML: (element) => element.style.textIndent || null,
            renderHTML: (attributes) =>
              attributes.textIndent ? { style: `text-indent: ${attributes.textIndent}` } : {},
          },
          indentLeft: {
            default: null,
            parseHTML: (element) => element.style.marginLeft || null,
            renderHTML: (attributes) =>
              attributes.indentLeft ? { style: `margin-left: ${attributes.indentLeft}` } : {},
          },
          indentRight: {
            default: null,
            parseHTML: (element) => element.style.marginRight || null,
            renderHTML: (attributes) =>
              attributes.indentRight ? { style: `margin-right: ${attributes.indentRight}` } : {},
          },
        },
      },
    ];
  },
});
