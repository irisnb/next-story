import assert from "node:assert/strict";
import test from "node:test";

import {
  collectFolders,
  firstDocument,
  flattenDocuments,
  isDocumentInTree,
  moveTargets,
  resolveCurrentDocument,
} from "../src/content-tree.ts";
import type { ContentTree } from "../src/types.ts";

const TREE: ContentTree = {
  root_children: ["doc-1", "folder-1"],
  nodes: {
    "doc-1": { id: "doc-1", name: "未命名文档", kind: "Document", children: [] },
    "folder-1": { id: "folder-1", name: "角色", kind: "Folder", children: ["doc-2"] },
    "doc-2": { id: "doc-2", name: "小芳", kind: "Document", children: [] },
  },
  recycle_bin: [
    {
      root_id: "doc-9",
      original_parent: null,
      original_index: 0,
      nodes: { "doc-9": { id: "doc-9", name: "旧文档", kind: "Document", children: [] } },
    },
  ],
};

test("flattenDocuments lists all documents in root order without folders", () => {
  assert.deepEqual(
    flattenDocuments(TREE).map((node) => node.id),
    ["doc-1", "doc-2"],
  );
});

test("firstDocument returns the first document in root order", () => {
  assert.equal(firstDocument(TREE)?.id, "doc-1");
  assert.equal(firstDocument({ root_children: [], nodes: {}, recycle_bin: [] }), null);
});

test("isDocumentInTree distinguishes live documents from folders and recycled nodes", () => {
  assert.equal(isDocumentInTree(TREE, "doc-1"), true);
  assert.equal(isDocumentInTree(TREE, "folder-1"), false);
  assert.equal(isDocumentInTree(TREE, "doc-9"), false);
  assert.equal(isDocumentInTree(TREE, "missing"), false);
});

test("resolveCurrentDocument keeps a valid remembered id and falls back to the first document", () => {
  assert.deepEqual(resolveCurrentDocument(TREE, "doc-2"), {
    documentId: "doc-2",
    invalidMemory: false,
  });
  assert.deepEqual(resolveCurrentDocument(TREE, "doc-9"), {
    documentId: "doc-1",
    invalidMemory: true,
  });
  assert.deepEqual(resolveCurrentDocument(TREE, null), {
    documentId: "doc-1",
    invalidMemory: false,
  });
  assert.deepEqual(
    resolveCurrentDocument({ root_children: [], nodes: {}, recycle_bin: [] }, "doc-x"),
    { documentId: null, invalidMemory: true },
  );
});

test("moveTargets offers the root and folders, excluding self and descendants", () => {
  const targets = moveTargets(TREE, "doc-2");
  assert.deepEqual(targets, [
    { value: null, label: "根级" },
    { value: "folder-1", label: "角色" },
  ]);

  // 文件夹自身不能作为自己的移动目标。
  const folderTargets = moveTargets(TREE, "folder-1");
  assert.deepEqual(folderTargets, [{ value: null, label: "根级" }]);
});

test("collectFolders lists all folders", () => {
  assert.deepEqual(
    collectFolders(TREE).map((node) => node.id),
    ["folder-1"],
  );
});
