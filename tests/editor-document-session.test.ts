import assert from "node:assert/strict";
import test from "node:test";

import { createEditorDocumentSession } from "../src/editor-document-session.ts";
import { emptyNotebookDocument, canonicalNotebookJson } from "../src/structured-notebook.ts";
import type { ProjectTreeState } from "../src/types.ts";

function project(): ProjectTreeState {
  return {
    projectPath: "test-project",
    projectName: "Test",
    tree: {
      root_children: ["doc-a"],
      nodes: { "doc-a": { id: "doc-a", name: "A", kind: "Document", children: [] } },
      recycle_bin: [],
    },
  };
}

test("session ignores a stale document load", async () => {
  let current: ProjectTreeState | null = project();
  const resolvers: Array<(value: string) => void> = [];
  let loaded = 0;
  const session = createEditorDocumentSession({
    dom: { editorTextarea: {} as HTMLElement },
    readDocument: async () => new Promise((resolve) => resolvers.push(resolve)),
    createEditor: () => ({ onEdit: () => () => {}, onSelectionChange: () => () => {} }),
    getProject: () => current,
    getDocumentId: () => "doc-a",
    setProject: (value) => { current = value; },
    setDocumentId: () => {}, setEditor: () => {}, disposeEditor: () => {},
    setBaseline: () => {}, clearBaseline: () => {}, onEdit: () => () => {}, onSelectionChange: () => () => {},
    onLoaded: () => { loaded += 1; }, beforeLoadProject: () => {}, resolveDocumentId: () => "doc-a",
    isDocumentInTree: () => true, firstDocument: () => ({ id: "doc-a" }), hasUnsavedChanges: () => false,
    confirmDiscard: () => true, clearRememberedDocument: () => {},
  });
  const first = session.loadDocument("doc-a");
  const second = session.loadDocument("doc-a");
  resolvers[0](canonicalNotebookJson(emptyNotebookDocument().document));
  resolvers[1](canonicalNotebookJson(emptyNotebookDocument().document));
  await Promise.all([first, second]);
  assert.equal(loaded, 1);
});

test("session applies deleted document fallback to empty state", () => {
  let current = project();
  let documentId: string | null = "doc-a";
  let editor: unknown = {};
  let loadedId: string | null | undefined;
  const session = createEditorDocumentSession({
    dom: { editorTextarea: {} as HTMLElement }, readDocument: async () => "",
    createEditor: () => ({ onEdit: () => () => {}, onSelectionChange: () => () => {} }),
    getProject: () => current, getDocumentId: () => documentId, setProject: (value) => { current = value!; },
    setDocumentId: (value) => { documentId = value; }, setEditor: (value) => { editor = value; },
    disposeEditor: () => {}, setBaseline: () => {}, clearBaseline: () => {}, onEdit: () => () => {}, onSelectionChange: () => () => {},
    onLoaded: (_project, id) => { loadedId = id; }, beforeLoadProject: () => {}, resolveDocumentId: () => "doc-a",
    isDocumentInTree: () => false, firstDocument: () => null, hasUnsavedChanges: () => false,
    confirmDiscard: () => true, clearRememberedDocument: () => {},
  });
  session.applyTree({ root_children: [], nodes: {}, recycle_bin: [] });
  assert.equal(documentId, null);
  assert.equal(editor, null);
  assert.equal(loadedId, null);
  assert.deepEqual(current.tree.root_children, []);
});
