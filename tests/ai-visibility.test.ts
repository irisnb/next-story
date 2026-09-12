import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeSelection,
  checkSelectionVisibility,
  HIDDEN_DOCUMENT_MESSAGE,
} from "../src/selection-adapter.ts";
import { isDocumentAiVisible, hiddenDocumentIdsFromTree } from "../src/types.ts";
import type { ContentTree, SelectionSnapshot } from "../src/types.ts";

test("documents default to AI-visible when the field is absent", () => {
  assert.equal(
    isDocumentAiVisible({ id: "d", name: "x", kind: "Document", children: [] }),
    true,
  );
  assert.equal(isDocumentAiVisible(null), true);
  assert.equal(isDocumentAiVisible(undefined), true);
});

test("explicitly hidden documents are not AI-visible", () => {
  assert.equal(
    isDocumentAiVisible({ id: "d", name: "x", kind: "Document", children: [], ai_visible: false }),
    false,
  );
  assert.equal(
    isDocumentAiVisible({ id: "d", name: "x", kind: "Document", children: [], ai_visible: true }),
    true,
  );
});

const TREE: ContentTree = {
  root_children: ["doc-visible", "folder"],
  nodes: {
    "doc-visible": { id: "doc-visible", name: "可见", kind: "Document", children: [], ai_visible: true },
    "doc-hidden": { id: "doc-hidden", name: "隐藏", kind: "Document", children: [], ai_visible: false },
    folder: { id: "folder", name: "文件夹", kind: "Folder", children: ["doc-hidden"] },
  },
  recycle_bin: [],
};

function snapshot(documentId: string, text = "选区文本"): SelectionSnapshot {
  return { documentId, selectedText: text, from: 0, to: 1 };
}

test("allows a selection from a visible document", () => {
  assert.deepEqual(checkSelectionVisibility(TREE, snapshot("doc-visible")), { allowed: true });
});

test("denies a selection from a hidden document without leaking its name", () => {
  const check = checkSelectionVisibility(TREE, snapshot("doc-hidden"));
  assert.equal(check.allowed, false);
  assert.equal(check.deniedMessage, HIDDEN_DOCUMENT_MESSAGE);
  assert.ok(!check.deniedMessage!.includes("隐藏"), "提示不得泄露隐藏文档名称");
  assert.ok(!check.deniedMessage!.includes("doc-hidden"), "提示不得泄露隐藏文档 ID");
});

test("denies a selection whose document id is forged (not in tree)", () => {
  assert.equal(checkSelectionVisibility(TREE, snapshot("forged-id")).allowed, false);
});

test("denies a selection whose document id points at a folder", () => {
  assert.equal(checkSelectionVisibility(TREE, snapshot("folder")).allowed, false);
});

test("missing tree denies any selection", () => {
  assert.equal(checkSelectionVisibility(null, snapshot("doc-visible")).allowed, false);
});

test("hiddenDocumentIdsFromTree derives hidden document ids and ignores folders", () => {
  assert.deepEqual(
    [...hiddenDocumentIdsFromTree(TREE)].sort(),
    ["doc-hidden"],
  );
  // 树缺失 / 空：返回空集，不引入任何受限。
  assert.equal(hiddenDocumentIdsFromTree(null).size, 0);
  assert.equal(hiddenDocumentIdsFromTree(undefined).size, 0);
});

// ========== 统一选区授权（作品 / 文档 / 版本身份 + 可见性） ==========

function identifiedSnapshot(
  documentId: string,
  overrides: Partial<SelectionSnapshot> = {},
): SelectionSnapshot {
  return {
    documentId,
    selectedText: "选区文本",
    from: 0,
    to: 4,
    ...overrides,
  };
}

test("authorizeSelection allows a visible in-project current-version selection", () => {
  const check = authorizeSelection(
    identifiedSnapshot("doc-visible", { projectPath: "D:\\作品", documentVersion: "v1" }),
    {
      projectPath: "D:\\作品",
      documentVersion: "v1",
      hiddenDocumentIds: new Set(["doc-hidden"]),
    },
  );
  assert.deepEqual(check, { allowed: true });
});

test("authorizeSelection denies a hidden-document selection without leaking its name", () => {
  const check = authorizeSelection(
    identifiedSnapshot("doc-hidden", { projectPath: "D:\\作品", documentVersion: "v1" }),
    {
      projectPath: "D:\\作品",
      documentVersion: "v1",
      hiddenDocumentIds: new Set(["doc-hidden"]),
    },
  );
  assert.equal(check.allowed, false);
  assert.equal(check.deniedMessage, HIDDEN_DOCUMENT_MESSAGE);
  assert.ok(!check.deniedMessage!.includes("doc-hidden"), "提示不得泄露隐藏文档 ID");
});

test("authorizeSelection denies a selection whose source project differs from the current project", () => {
  const check = authorizeSelection(
    identifiedSnapshot("doc-visible", { projectPath: "D:\\作品A", documentVersion: "v1" }),
    {
      projectPath: "D:\\作品B",
      documentVersion: "v1",
      hiddenDocumentIds: new Set(),
    },
  );
  assert.equal(check.allowed, false);
});

test("authorizeSelection denies a selection whose document version is stale", () => {
  const check = authorizeSelection(
    identifiedSnapshot("doc-visible", { projectPath: "D:\\作品", documentVersion: "v1" }),
    {
      projectPath: "D:\\作品",
      documentVersion: "v2",
      hiddenDocumentIds: new Set(),
    },
  );
  assert.equal(check.allowed, false);
});

test("authorizeSelection skips cross-project check when the snapshot lacks a project identity", () => {
  const check = authorizeSelection(
    identifiedSnapshot("doc-visible"),
    { projectPath: "D:\\作品B", documentVersion: "v1", hiddenDocumentIds: new Set() },
  );
  assert.equal(check.allowed, true, "未携带作品身份的选区不做跨作品拒绝");
});

test("authorizeSelection skips version check when the snapshot or current version is absent", () => {
  // 快照未携带版本：不拒绝。
  assert.equal(
    authorizeSelection(
      identifiedSnapshot("doc-visible", { projectPath: "D:\\作品" }),
      { projectPath: "D:\\作品", documentVersion: "v1", hiddenDocumentIds: new Set() },
    ).allowed,
    true,
  );
  // 当前版本未知：不拒绝。
  assert.equal(
    authorizeSelection(
      identifiedSnapshot("doc-visible", { projectPath: "D:\\作品", documentVersion: "v1" }),
      { projectPath: "D:\\作品", documentVersion: null, hiddenDocumentIds: new Set() },
    ).allowed,
    true,
  );
});
