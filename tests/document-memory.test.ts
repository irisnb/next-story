import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLastDocumentId,
  lastDocumentKey,
  readLastDocumentId,
  writeLastDocumentId,
  type MemoryStorage,
} from "../src/document-memory.ts";

function memoryFixture(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

test("last document memory is keyed per project path", () => {
  const storage = memoryFixture();
  writeLastDocumentId(storage, "D:\\作品A", "doc-1");
  writeLastDocumentId(storage, "D:\\作品B", "doc-2");

  assert.equal(readLastDocumentId(storage, "D:\\作品A"), "doc-1");
  assert.equal(readLastDocumentId(storage, "D:\\作品B"), "doc-2");
  assert.equal(readLastDocumentId(storage, "D:\\作品C"), null);
});

test("clearLastDocumentId removes the memory for a project", () => {
  const storage = memoryFixture();
  writeLastDocumentId(storage, "D:\\作品A", "doc-1");
  clearLastDocumentId(storage, "D:\\作品A");

  assert.equal(readLastDocumentId(storage, "D:\\作品A"), null);
});

test("the storage key embeds the project path", () => {
  assert.match(lastDocumentKey("D:\\作品A"), /^next-story\.last-document\./);
});
