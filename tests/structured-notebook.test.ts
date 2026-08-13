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
