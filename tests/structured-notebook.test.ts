import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  emptyNotebookDocument,
  parseNotebookDocumentJson,
  serializeNotebookDocument,
  validateNotebookDocument,
  canonicalNotebookJson,
  MAX_SAFE_INTEGER,
  type ParagraphNode,
} from "../src/structured-notebook.ts";

interface Sample {
  name: string;
  valid: boolean;
  value: unknown;
}

const samplesUrl = new URL("./fixtures/notebook-samples.json", import.meta.url);
const samples: Sample[] = JSON.parse(readFileSync(samplesUrl, "utf8")).samples;

for (const sample of samples) {
  test(`shared sample "${sample.name}" is ${sample.valid ? "accepted" : "rejected"}`, () => {
    const result = validateNotebookDocument(sample.value);
    assert.equal(result.ok, sample.valid, sample.valid ? "应通过校验" : "应被拒绝");
  });
}

test("rejects text containing an isolated high surrogate", () => {
  const value = {
    format: "next-story-tiptap",
    version: 1,
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a\ud800b" }] },
      ],
    },
  };
  assert.equal(validateNotebookDocument(value).ok, false);
});

test("rejects text containing an isolated low surrogate", () => {
  const value = {
    format: "next-story-tiptap",
    version: 1,
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a\udc00b" }] },
      ],
    },
  };
  assert.equal(validateNotebookDocument(value).ok, false);
});

test("accepts a valid surrogate pair inside text", () => {
  const value = {
    format: "next-story-tiptap",
    version: 1,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "🎬" }] }],
    },
  };
  assert.equal(validateNotebookDocument(value).ok, true);
});

test("emptyNotebookDocument is a valid minimal blank document", () => {
  const empty = emptyNotebookDocument();
  assert.equal(validateNotebookDocument(empty).ok, true);
  assert.deepEqual(empty.document, { type: "doc", content: [{ type: "paragraph" }] });
});

test("serializer merges adjacent identical-mark text", () => {
  const raw = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a", marks: [{ type: "bold" }] },
          { type: "text", text: "b", marks: [{ type: "bold" }] },
        ],
      },
    ],
  };
  const doc = serializeNotebookDocument(raw);
  const paragraph = doc.document.content[0] as ParagraphNode;
  assert.equal(paragraph.type, "paragraph");
  assert.ok(paragraph.content);
  assert.equal(paragraph.content.length, 1);
  assert.equal(paragraph.content[0].text, "ab");
  assert.deepEqual(paragraph.content[0].marks, [{ type: "bold" }]);
});

test("serializer sorts marks bold before italic", () => {
  const raw = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a", marks: [{ type: "italic" }, { type: "bold" }] },
        ],
      },
    ],
  };
  const doc = serializeNotebookDocument(raw);
  const paragraph = doc.document.content[0] as ParagraphNode;
  assert.ok(paragraph.content);
  assert.deepEqual(paragraph.content[0].marks, [
    { type: "bold" },
    { type: "italic" },
  ]);
});

test("serializer produces minimal blank doc for empty content", () => {
  const doc = serializeNotebookDocument({ type: "doc", content: [] });
  assert.deepEqual(doc.document, { type: "doc", content: [{ type: "paragraph" }] });
});

test("serializer output always passes validation", () => {
  const raw = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
      { type: "paragraph", content: [{ type: "text", text: "粗", marks: [{ type: "bold" }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "三" }] }] }] },
    ],
  };
  const doc = serializeNotebookDocument(raw);
  assert.equal(validateNotebookDocument(doc).ok, true);
});

test("serializer preserves nested ordered list type", () => {
  const raw = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父" }] },
              {
                type: "orderedList",
                attrs: { start: 1 },
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const doc = serializeNotebookDocument(raw);
  const outer = doc.document.content[0];
  assert.equal(outer.type, "orderedList");
  if (outer.type === "orderedList") {
    const item = outer.content[0];
    assert.equal(item.content.length, 2);
    assert.equal(item.content[1].type, "orderedList");
  }
});

test("canonicalNotebookJson is deterministic", () => {
  const raw = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };
  assert.equal(canonicalNotebookJson(raw), canonicalNotebookJson(raw));
});

test("parseNotebookDocumentJson round-trips an empty document", () => {
  const json = JSON.stringify(emptyNotebookDocument());
  assert.deepEqual(parseNotebookDocumentJson(json), emptyNotebookDocument());
});

test("parseNotebookDocumentJson rejects malformed JSON", () => {
  assert.throws(() => parseNotebookDocumentJson("{ not json"), /不是合法 JSON/);
});

test("parseNotebookDocumentJson rejects structurally invalid document", () => {
  const json = JSON.stringify({ format: "next-story-tiptap", version: 1, document: { type: "doc", content: [] } });
  assert.throws(() => parseNotebookDocumentJson(json), /空数组/);
});

test("ordered list numbering at MAX_SAFE_INTEGER with one item is accepted", () => {
  const value = {
    format: "next-story-tiptap",
    version: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: MAX_SAFE_INTEGER },
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
      ],
    },
  };
  assert.equal(validateNotebookDocument(value).ok, true);
});

// ---------------------------------------------------------------------------
// 格式版本 3：有序列表编号样式
// ---------------------------------------------------------------------------

test("serializer preserves non-decimal ordered list style", () => {
  const raw = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 2, type: "A" },
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] }],
      },
    ],
  };
  const doc = serializeNotebookDocument(raw);
  assert.equal(doc.version, 3);
  const list = doc.document.content[0];
  assert.equal(list.type, "orderedList");
  if (list.type === "orderedList") {
    assert.deepEqual(list.attrs, { start: 2, type: "A" });
  }
  assert.equal(validateNotebookDocument(doc).ok, true);
});

test("serializer omits style key for decimal default and null attr", () => {
  for (const attrs of [{ start: 1 }, { start: 1, type: null }, { start: 1, type: "1" }, { start: 1, type: "x" }]) {
    const raw = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs,
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
      ],
    };
    const doc = serializeNotebookDocument(raw);
    const list = doc.document.content[0];
    assert.equal(list.type, "orderedList");
    if (list.type === "orderedList") {
      assert.deepEqual(list.attrs, { start: 1 }, `attrs ${JSON.stringify(attrs)} 应规范化省略 type`);
    }
  }
});

test("v3 document with type round-trips through validation", () => {
  const value = {
    format: "next-story-tiptap",
    version: 3,
    document: {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1, type: "I" },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "罗马" }] }] }],
        },
      ],
    },
  };
  assert.equal(validateNotebookDocument(value).ok, true);
  const roundTrip = parseNotebookDocumentJson(JSON.stringify(value));
  const roundTripList = roundTrip.document.content[0];
  assert.equal(roundTripList.type, "orderedList");
  if (roundTripList.type === "orderedList") {
    assert.equal(roundTripList.attrs.type, "I");
  }
});
