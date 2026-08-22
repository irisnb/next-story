import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLocalStorage,
  sameSelectionSnapshot,
  type SelectionSnapshot,
  type StorageLike,
} from "../src/shared-storage-and-selection-identity.ts";

function snapshot(
  documentId: string,
  selectedText: string,
  from: number,
  to: number,
): SelectionSnapshot {
  return { documentId, selectedText, from, to };
}

function installWindow(value: unknown): () => void {
  const previous = globalThis.window;
  globalThis.window = value as Window & typeof globalThis;
  return () => { globalThis.window = previous; };
}

test("resolveLocalStorage returns a StorageLike adapter when localStorage is available", () => {
  const store = new Map<string, string>();
  const restore = installWindow({
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    },
  });
  try {
    const storage = resolveLocalStorage();
    assert.ok(storage !== null);
    storage!.setItem("k", "v");
    assert.equal(storage!.getItem("k"), "v");
    storage!.removeItem("k");
    assert.equal(storage!.getItem("k"), null);
  } finally {
    restore();
  }
});

test("resolveLocalStorage returns null when window is unavailable", () => {
  const restore = installWindow(undefined);
  try {
    assert.equal(resolveLocalStorage(), null);
  } finally {
    restore();
  }
});

test("resolveLocalStorage returns null when localStorage access throws", () => {
  const restore = installWindow({
    get localStorage(): Storage {
      throw new Error("denied");
    },
  });
  try {
    assert.equal(resolveLocalStorage(), null);
  } finally {
    restore();
  }
});

test("resolveLocalStorage returns null when localStorage is null", () => {
  const restore = installWindow({ localStorage: null });
  try {
    assert.equal(resolveLocalStorage(), null);
  } finally {
    restore();
  }
});

test("sameSelectionSnapshot returns true for identical identity fields", () => {
  const a = snapshot("doc-1", "选中文字", 3, 7);
  assert.equal(sameSelectionSnapshot(a, { ...a }), true);
});

test("sameSelectionSnapshot returns false when any identity field differs", () => {
  const base = snapshot("doc-1", "选中文字", 3, 7);
  assert.equal(sameSelectionSnapshot(base, snapshot("doc-2", "选中文字", 3, 7)), false);
  assert.equal(sameSelectionSnapshot(base, snapshot("doc-1", "别的文字", 3, 7)), false);
  assert.equal(sameSelectionSnapshot(base, snapshot("doc-1", "选中文字", 4, 7)), false);
  assert.equal(sameSelectionSnapshot(base, snapshot("doc-1", "选中文字", 3, 8)), false);
});

test("StorageLike is the shared minimal storage contract", () => {
  const storage: StorageLike = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  assert.equal(typeof storage.getItem, "function");
  assert.equal(typeof storage.setItem, "function");
  assert.equal(typeof storage.removeItem, "function");
});