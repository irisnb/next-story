import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLastDocumentId,
  lastDocumentKey,
  readLastDocumentId,
  writeLastDocumentId,
} from "../src/document-memory.ts";
import { memoryStorageFixture } from "./memory-storage-fixture.ts";

test("last document memory is keyed per project path", () => {
  const storage = memoryStorageFixture();
  writeLastDocumentId(storage, "D:\\作品A", "doc-1");
  writeLastDocumentId(storage, "D:\\作品B", "doc-2");

  assert.equal(readLastDocumentId(storage, "D:\\作品A"), "doc-1");
  assert.equal(readLastDocumentId(storage, "D:\\作品B"), "doc-2");
  assert.equal(readLastDocumentId(storage, "D:\\作品C"), null);
});

test("clearLastDocumentId removes the memory for a project", () => {
  const storage = memoryStorageFixture();
  writeLastDocumentId(storage, "D:\\作品A", "doc-1");
  writeLastDocumentId(storage, "D:\\作品B", "doc-2");
  clearLastDocumentId(storage, "D:\\作品A");

  assert.equal(readLastDocumentId(storage, "D:\\作品A"), null);
  assert.equal(readLastDocumentId(storage, "D:\\作品B"), "doc-2");
});

test("the storage key embeds the project path", () => {
  assert.match(lastDocumentKey("D:\\作品A"), /^next-story\.last-document\./);
});

test("empty document memory is unavailable and a later write replaces it", () => {
  const storage = memoryStorageFixture({ [lastDocumentKey("D:\\作品A")]: "" });
  assert.equal(readLastDocumentId(storage, "D:\\作品A"), null);

  writeLastDocumentId(storage, "D:\\作品A", "doc-1");
  writeLastDocumentId(storage, "D:\\作品A", "doc-2");
  assert.equal(readLastDocumentId(storage, "D:\\作品A"), "doc-2");
});

const privateErrorMessage = "adapter error containing private document text";
const storageErrors = [
  new DOMException(privateErrorMessage, "SecurityError"),
  new DOMException(privateErrorMessage, "QuotaExceededError"),
  new Error(privateErrorMessage),
];

for (const error of storageErrors) {
  for (const operation of ["getItem", "setItem", "removeItem"] as const) {
    test(`${operation} ${error.name} safely degrades document memory and logs no content`, (t) => {
      const projectPath = "D:\\作品A";
      const key = lastDocumentKey(projectPath);
      const storage = memoryStorageFixture({ [key]: "doc-previous" });
      const warning = t.mock.method(console, "warn", () => {});
      const access = t.mock.method(storage, operation, () => { throw error; });

      if (operation === "getItem") {
        assert.equal(readLastDocumentId(storage, projectPath), null);
      } else if (operation === "setItem") {
        assert.doesNotThrow(() => writeLastDocumentId(storage, projectPath, "doc-next"));
      } else {
        assert.doesNotThrow(() => clearLastDocumentId(storage, projectPath));
      }

      assert.equal(access.mock.callCount(), 1, "no retry of failed storage access");
      assert.deepEqual(access.mock.calls[0].arguments,
        operation === "setItem" ? [key, "doc-next"] : [key]);
      assert.equal(storage.data[key], "doc-previous", "failed access leaves stored preference intact");
      assert.equal(warning.mock.callCount(), 1);
      assert.deepEqual(warning.mock.calls[0].arguments, [
        `[document-memory] ${operation} failed; last-document preference unavailable`,
        { errorName: error.name },
      ]);
      assert.ok(!JSON.stringify(warning.mock.calls[0].arguments).includes(privateErrorMessage));
    });
  }
}
