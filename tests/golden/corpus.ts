// A 层金样本语料：覆盖格式版本 2 grammar 全部结构与边界的合成文档集合。
//
// 约束：每条语料都是合法格式版本 2 文档——marks 按 rank 升序
// （bold, italic, underline, strike, textStyle, highlight, link）、相邻同 marks
// 文本已合并、无 CR/LF、无空 content 数组。测试侧会用 parseNotebookDocumentJson
// 对输入做自校验，冻结预期由当前 2.27.3 管线真实生成，不手写。
import type { JSONContent } from "@tiptap/core";

export interface CorpusEntry {
  /** 语料命名，同时是冻结预期文件名 expected/<name>.json。 */
  name: string;
  /** 覆盖点说明。 */
  covers: string;
  /** 合成输入文档（Tiptap JSONContent，装载进 Editor 后经 getJSON→canonicalDoc 冻结）。 */
  doc: JSONContent;
}

export const corpus: CorpusEntry[] = [
  {
    name: "paragraph-plain",
    covers: "普通文本段落",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "她把伞收起来，雨还没有停。" }] },
      ],
    },
  },
  {
    name: "headings-all-levels",
    covers: "一到六级标题各一",
    doc: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "一级标题" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "二级标题" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "三级标题" }] },
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "四级标题" }] },
        { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "五级标题" }] },
        { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "六级标题" }] },
      ],
    },
  },
  {
    name: "marks-inline-basic",
    covers: "粗体、斜体、下划线、删除线与相邻异格式文本",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "粗体字", marks: [{ type: "bold" }] },
            { type: "text", text: "斜体字", marks: [{ type: "italic" }] },
            { type: "text", text: "下划线字", marks: [{ type: "underline" }] },
            { type: "text", text: "删除线字", marks: [{ type: "strike" }] },
            { type: "text", text: "普通字" },
          ],
        },
      ],
    },
  },
  {
    name: "textstyle-color",
    covers: "textStyle 单属性：颜色（小写 #rrggbb）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "深蓝色的字",
              marks: [{ type: "textStyle", attrs: { color: "#3366cc" } }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "textstyle-font-family",
    covers: "textStyle 单属性：字体（固定字族字符串）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "楷体的字",
              marks: [{ type: "textStyle", attrs: { fontFamily: "KaiTi" } }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "textstyle-font-size",
    covers: "textStyle 单属性：字号（固定档位字符串）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "十八像素的字",
              marks: [{ type: "textStyle", attrs: { fontSize: "18px" } }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "textstyle-combined",
    covers: "textStyle 多属性组合：颜色 + 字体 + 字号",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "暗红宋体二十二的字",
              marks: [
                {
                  type: "textStyle",
                  attrs: { color: "#8b0000", fontFamily: "SimSun", fontSize: "22px" },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "highlight",
    covers: "高亮（恰好 color）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "重点句子",
              marks: [{ type: "highlight", attrs: { color: "#fff3b0" } }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "link",
    covers: "链接（恰好 href）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "参考站点",
              marks: [{ type: "link", attrs: { href: "https://example.com/story" } }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "marks-stacked",
    covers: "同一文本叠满全部七种 mark（按 rank 顺序排列）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "全格式叠加的字",
              marks: [
                { type: "bold" },
                { type: "italic" },
                { type: "underline" },
                { type: "strike" },
                { type: "textStyle", attrs: { color: "#556b2f", fontFamily: "SimHei", fontSize: "20px" } },
                { type: "highlight", attrs: { color: "#ffe066" } },
                { type: "link", attrs: { href: "https://example.com/full" } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "paragraph-attrs-full",
    covers: "段落属性全集与部分属性组合",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            textAlign: "center",
            lineHeight: "1.8",
            spacingBefore: "8px",
            spacingAfter: "12px",
            textIndent: "2em",
            indentLeft: "24px",
            indentRight: "16px",
          },
          content: [{ type: "text", text: "属性齐全的段落" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: "justify", textIndent: "4em" },
          content: [{ type: "text", text: "只有部分属性的段落" }],
        },
      ],
    },
  },
  {
    name: "bullet-list",
    covers: "无序列表（项内含粗体 mark）",
    doc: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "第一项" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "第二项带粗体", marks: [{ type: "bold" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "ordered-list-start-3",
    covers: "有序列表 start=3（非 1 起始）",
    doc: {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "第三条" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "第四条" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "第五条" }] }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "nested-lists",
    covers: "嵌套列表（无序嵌有序 start=4、无序嵌无序）",
    doc: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "水果" }] },
                {
                  type: "orderedList",
                  attrs: { start: 4 },
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "苹果" }] }],
                    },
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "梨" }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "蔬菜" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "菠菜" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "empty-document",
    covers: "空文档（单个省略 content 的空段落）",
    doc: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  },
  {
    name: "empty-paragraphs-edges",
    covers: "首、尾与连续空段落",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "甲" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "乙" }] },
        { type: "paragraph" },
      ],
    },
  },
  {
    name: "empty-heading",
    covers: "省略 content 的空标题",
    doc: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 } },
        { type: "paragraph", content: [{ type: "text", text: "标题后的正文" }] },
      ],
    },
  },
  {
    name: "link-at-text-edges",
    covers: "链接在文本两端边界（段首与段尾）",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "开头的链接",
              marks: [{ type: "link", attrs: { href: "https://example.com/head" } }],
            },
            { type: "text", text: "中间的普通文字" },
            {
              type: "text",
              text: "结尾的链接",
              marks: [{ type: "link", attrs: { href: "https://example.com/tail" } }],
            },
          ],
        },
      ],
    },
  },
  {
    name: "chinese-and-emoji",
    covers: "中文与 emoji 内容",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "她推开门，看见雨落在旧站台上。镜头推进 🎬" }],
        },
      ],
    },
  },
];
