import assert from "node:assert/strict";
import test from "node:test";

import { createEditorPersistence } from "../src/editor-persistence.ts";

test("persistence writes the canonical document and updates the save status", async () => {
  let written = "";
  const status = { textContent: "", className: "", classList: { add() {} } };
  const saveButton = { disabled: false };
  const document = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "新内容" }] }],
  };
  const persistence = createEditorPersistence({
    saveStatus: status as HTMLElement,
    saveButton: saveButton as HTMLButtonElement,
    getEditor: () => ({ getDocument: () => document }),
    getProject: () => ({ projectPath: "作品", documentId: "doc" }),
    write: async (_path, _id, content) => { written = content; },
  });

  persistence.setBaseline({ type: "doc", content: [{ type: "paragraph" }] });
  const result = await persistence.save();

  assert.equal(result, true);
  assert.match(written, /"version":2/);
  assert.equal(status.textContent, "已保存");
});
