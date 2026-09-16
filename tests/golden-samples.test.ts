// 金样本测试（upgrade-tiptap-v3 冻结点）：
//   A 层·序列化：语料 → Editor（happy-dom 环境）→ getJSON → canonicalDoc → 与冻结预期逐字节相等；
//   B 层·粘贴行为：(html, plain) 样本 → parseHtmlToBlocks（注入 happy-dom DOMParser）→
//     decidePasteAction → insertContent 注入四种位置 → canonicalDoc → 与冻结预期相等；
//   URL/autolink 用例：冻结 v2 自动链接行为。
//
// 冻结机制：设 GOLDEN_UPDATE=1 运行本文件时，把当前管线输出写入 expected / expected-paste
// 目录（生成冻结预期）；不设时严格断言与冻结预期完全一致。迁移 Tiptap 3 前必须先在 2.27.3
// 上生成全部预期文件，升级后用同一批文件断言不变。
//
// 运行方式（Windows PowerShell）：
//   生成：$env:GOLDEN_UPDATE="1"; node --test tests/golden-samples.test.ts; Remove-Item Env:GOLDEN_UPDATE
//   断言：node --test tests/golden-samples.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { buildRichTextExtensions } from "../src/rich-text-editor.ts";
import {
  NOTEBOOK_FORMAT,
  NOTEBOOK_VERSION,
  canonicalDoc,
  parseNotebookDocumentJson,
  serializeNotebookDocument,
} from "../src/structured-notebook.ts";
import { decidePasteAction, parseHtmlToBlocks } from "../src/controlled-paste.ts";
import { installBrowserEnv, type BrowserEnv } from "./golden/browser-env.ts";
import { corpus } from "./golden/corpus.ts";
import { pasteFixtures } from "./golden/paste-fixtures.ts";

// ---------------------------------------------------------------------------
// 冻结机制
// ---------------------------------------------------------------------------

const GOLDEN_UPDATE = process.env.GOLDEN_UPDATE === "1";
const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), "golden");

/** 断言规范形态与冻结预期逐字节相等；GOLDEN_UPDATE=1 时改为写入冻结预期。 */
function assertGolden(relative: string, actual: unknown): void {
  const path = join(goldenRoot, relative);
  if (GOLDEN_UPDATE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    return;
  }
  let expectedText: string;
  try {
    expectedText = readFileSync(path, "utf8");
  } catch {
    assert.fail(`缺少冻结预期文件 ${relative}（先设 GOLDEN_UPDATE=1 由当前管线生成）`);
    return;
  }
  const expected = JSON.parse(expectedText) as unknown;
  assert.deepEqual(actual, expected, `金样本 ${relative} 与冻结预期不一致`);
  assert.equal(
    JSON.stringify(actual, null, 2),
    JSON.stringify(expected, null, 2),
    `金样本 ${relative} 的字段顺序与冻结预期不一致（变更须重新冻结并说明理由）`,
  );
}

/** 规范形态必须仍是合法格式版本 2 文档。 */
function assertValidNotebook(where: string, canonical: unknown): void {
  assert.doesNotThrow(
    () => parseNotebookDocumentJson(JSON.stringify(serializeNotebookDocument(canonical))),
    `${where}：规范形态未通过格式版本 2 校验`,
  );
}

function createGoldenEditor(env: BrowserEnv, content: JSONContent): Editor {
  return new Editor({
    // happy-dom 元素在运行时完全可用，只是类型上与 lib.dom 不互通，此处做类型桥接
    element: env.window.document.createElement("div") as unknown as HTMLElement,
    extensions: buildRichTextExtensions(),
    content,
  });
}

/** 在文档中定位锚文本的 ProseMirror 位置（文本节点起点 + 锚内偏移）。 */
function textPos(editor: Editor, needle: string): number {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text !== undefined && node.text.includes(needle)) {
      found = pos + node.text.indexOf(needle);
      return false;
    }
    return true;
  });
  if (found === null) {
    assert.fail(`测试夹具问题：文档中找不到锚文本「${needle}」`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// A 层·序列化金样本（任务 2.2 / 2.3）
// ---------------------------------------------------------------------------

test("A 层语料自校验：全部输入为合法格式版本 2 文档", () => {
  for (const entry of corpus) {
    assert.doesNotThrow(
      () =>
        parseNotebookDocumentJson(
          JSON.stringify({ format: NOTEBOOK_FORMAT, version: NOTEBOOK_VERSION, document: entry.doc }),
        ),
      `语料 ${entry.name} 不是合法格式版本 2 文档`,
    );
  }
});

for (const entry of corpus) {
  test(`A 层金样本：${entry.name}（${entry.covers}）`, () => {
    const env = installBrowserEnv();
    try {
      const editor = createGoldenEditor(env, entry.doc);
      try {
        const canonical = canonicalDoc(editor.getJSON());
        assertValidNotebook(`A 层 ${entry.name}`, canonical);
        assertGolden(`expected/${entry.name}.json`, canonical);
      } finally {
        editor.destroy();
      }
    } finally {
      env.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// B 层·粘贴行为金样本（任务 2.4 / 2.5）
// ---------------------------------------------------------------------------

interface InjectionContext {
  /** 注入位置名，同时是预期文件名后缀 expected-paste/<key>-<position>.json。 */
  position: string;
  covers: string;
  doc: JSONContent;
  cursor(editor: Editor): number;
}

const injectionContexts: InjectionContext[] = [
  {
    position: "empty-doc",
    covers: "空文档",
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    cursor: () => 1,
  },
  {
    position: "plain-mid",
    covers: "同格式段落中部",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前半后半" }] },
      ],
    },
    cursor: (editor) => textPos(editor, "前半") + "前半".length,
  },
  {
    position: "marks-boundary",
    covers: "异格式边界",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "前半", marks: [{ type: "bold" }] },
            { type: "text", text: "后半", marks: [{ type: "italic" }] },
          ],
        },
      ],
    },
    cursor: (editor) => textPos(editor, "前半") + "前半".length,
  },
  {
    position: "list-item",
    covers: "列表项内",
    doc: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "列表项甲乙" }] },
              ],
            },
          ],
        },
      ],
    },
    cursor: (editor) => textPos(editor, "列表项") + "列表项".length,
  },
];

for (const fixture of pasteFixtures) {
  test(`B 层粘贴样本：${fixture.key}（${fixture.covers}）`, () => {
    const env = installBrowserEnv();
    try {
      const parsed = parseHtmlToBlocks(fixture.html, env.parseHtml);
      const action = decidePasteAction(fixture.plain, fixture.html !== "", parsed);

      if (fixture.expect === "reject") {
        assert.equal(action.kind, "reject", `${fixture.key} 应整次拒绝`);
        if (action.kind === "reject") {
          assert.ok(action.reason.includes("不一致"), `拒绝理由应指向内容不一致：${action.reason}`);
        }
        return;
      }

      assert.equal(action.kind, "insert", `${fixture.key} 应判定为插入`);
      if (action.kind !== "insert") return;

      for (const context of injectionContexts) {
        const editor = createGoldenEditor(env, context.doc);
        try {
          const pos = context.cursor(editor);
          editor.view.dispatch(
            editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
          );
          // 与生产 handlePaste 相同的注入方式
          assert.equal(
            editor.commands.insertContent(action.document.content),
            true,
            `${fixture.key}@${context.position}：insertContent 应成功`,
          );
          const canonical = canonicalDoc(editor.getJSON());
          assertValidNotebook(`B 层 ${fixture.key}@${context.position}`, canonical);
          assertGolden(`expected-paste/${fixture.key}-${context.position}.json`, canonical);
        } finally {
          editor.destroy();
        }
      }
    } finally {
      env.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// URL / autolink 用例（任务 2.6）
// ---------------------------------------------------------------------------

/** 递归收集规范形态中全部 link mark（文本 + href）。 */
function collectLinkMarks(node: unknown, found: { text: string; href: string }[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLinkMarks(item, found);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as {
    type?: unknown;
    text?: unknown;
    marks?: { type?: unknown; attrs?: { href?: unknown } }[];
  };
  if (record.type === "text" && Array.isArray(record.marks)) {
    for (const mark of record.marks) {
      if (mark.type === "link" && typeof mark.attrs?.href === "string") {
        found.push({ text: typeof record.text === "string" ? record.text : "", href: mark.attrs.href });
      }
    }
  }
  for (const value of Object.values(record)) collectLinkMarks(value, found);
}

test("URL/autolink：URL 后紧跟中文不触发自动链接（冻结 v2 现状，记录性断言）", () => {
  const env = installBrowserEnv();
  try {
    const editor = createGoldenEditor(env, { type: "doc", content: [{ type: "paragraph" }] });
    try {
      editor.commands.insertContent("参见 https://example.com/wiki 页面");
      const canonical = canonicalDoc(editor.getJSON());
      assertValidNotebook("URL 用例（无空白结尾）", canonical);
      assertGolden("expected/url-autolink-no-space.json", canonical);
      const links: { text: string; href: string }[] = [];
      collectLinkMarks(canonical, links);
      assert.deepEqual(
        links,
        [],
        "v2 在该输入下不应产生 link mark；若升级后出现链接，即为 linkifyjs 边界差异，须上报用户决策",
      );
    } finally {
      editor.destroy();
    }
  } finally {
    env.restore();
  }
});

test("URL/autolink：URL 后跟空格触发自动链接并冻结 mark 范围", () => {
  const env = installBrowserEnv();
  try {
    const editor = createGoldenEditor(env, { type: "doc", content: [{ type: "paragraph" }] });
    try {
      editor.commands.insertContent("参见 https://example.com/wiki ");
      const canonical = canonicalDoc(editor.getJSON());
      assertValidNotebook("URL 用例（空白结尾）", canonical);
      assertGolden("expected/url-autolink-trailing-space.json", canonical);
      const links: { text: string; href: string }[] = [];
      collectLinkMarks(canonical, links);
      assert.deepEqual(
        links,
        [{ text: "https://example.com/wiki", href: "https://example.com/wiki" }],
        "link mark 应恰好覆盖 URL 区间且规范化为只剩 href",
      );
    } finally {
      editor.destroy();
    }
  } finally {
    env.restore();
  }
});
