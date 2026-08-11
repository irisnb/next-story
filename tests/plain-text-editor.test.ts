import assert from "node:assert/strict";
import test from "node:test";

import {
  PlainTextEditorAdapter,
  createPlainTextPasteHandler,
  exportPlainText,
  importPlainText,
  serializePlainTextClipboard,
  type PlainTextEditorEngine,
} from "../src/plain-text-editor.ts";

class FakePlainTextEditorEngine implements PlainTextEditorEngine {
  document = importPlainText("初始文字");
  readonly updateListeners = new Set<() => void>();
  focused = false;
  destroyed = false;
  selection = { from: 8, to: 3, head: 3 };
  coordinates = { left: 12, right: 13, top: 24, bottom: 25 };
  lastCoordinatePosition: number | null = null;

  getDocument() {
    return this.document;
  }

  onUpdate(listener: () => void): void {
    this.updateListeners.add(listener);
  }

  offUpdate(listener: () => void): void {
    this.updateListeners.delete(listener);
  }

  focus(): void {
    this.focused = true;
  }

  getSelection() {
    return this.selection;
  }

  coordinatesAt(position: number) {
    this.lastCoordinatePosition = position;
    return this.coordinates;
  }

  destroy(): void {
    this.destroyed = true;
    this.updateListeners.clear();
  }

  emitUpdate(text: string): void {
    this.document = importPlainText(text);
    for (const listener of this.updateListeners) listener();
  }
}

const roundTripCases = [
  { name: "empty text", text: "" },
  { name: "ordinary newlines", text: "第一行\n第二行" },
  { name: "leading blank lines", text: "\n\n开头" },
  { name: "trailing blank lines", text: "结尾\n\n" },
  { name: "consecutive blank lines", text: "甲\n\n\n乙" },
  { name: "Chinese text", text: "她推开门，看见雨落在旧站台上。" },
  { name: "punctuation", text: "“等等！”她问：真的？——真的。" },
  { name: "emoji", text: "镜头推进 🎬，火箭升空 🚀。" },
] as const;

for (const roundTripCase of roundTripCases) {
  test(`round-trips ${roundTripCase.name} without changing visible text`, () => {
    // Given
    const document = importPlainText(roundTripCase.text);

    // When
    const result = exportPlainText(document);

    // Then
    assert.equal(result, roundTripCase.text);
  });
}

test("round-trips 200,000 Chinese characters without changing text", () => {
  // Given
  const text = "剧".repeat(200_000);
  const document = importPlainText(text);

  // When
  const result = exportPlainText(document);

  // Then
  assert.equal(result, text);
});

test("reads the engine document as complete plain text", () => {
  // Given
  const engine = new FakePlainTextEditorEngine();
  const editor = new PlainTextEditorAdapter(engine);

  // When
  const text = editor.getText();

  // Then
  assert.equal(text, "初始文字");
});

test("subscribes to edits and returns a working unsubscribe function", () => {
  // Given
  const engine = new FakePlainTextEditorEngine();
  const editor = new PlainTextEditorAdapter(engine);
  const received: string[] = [];
  const unsubscribe = editor.onEdit((text) => received.push(text));

  // When
  engine.emitUpdate("第一次编辑");
  unsubscribe();
  engine.emitUpdate("第二次编辑");

  // Then
  assert.deepEqual(received, ["第一次编辑"]);
});

test("focus delegates to the editor engine", () => {
  // Given
  const engine = new FakePlainTextEditorEngine();
  const editor = new PlainTextEditorAdapter(engine);

  // When
  editor.focus();

  // Then
  assert.equal(engine.focused, true);
});

test("returns an ordered selection while preserving its head", () => {
  // Given
  const engine = new FakePlainTextEditorEngine();
  const editor = new PlainTextEditorAdapter(engine);

  // When
  const selection = editor.getSelection();

  // Then
  assert.deepEqual(selection, { from: 3, to: 8, head: 3 });
});

test("reads coordinates at the selection head", () => {
  // Given
  const engine = new FakePlainTextEditorEngine();
  const editor = new PlainTextEditorAdapter(engine);

  // When
  const coordinates = editor.getHeadCoordinates();

  // Then
  assert.deepEqual(coordinates, engine.coordinates);
  assert.equal(engine.lastCoordinatePosition, 3);
});

test("destroy removes subscriptions and destroys the editor engine", () => {
  // Given
  const engine = new FakePlainTextEditorEngine();
  const editor = new PlainTextEditorAdapter(engine);
  const received: string[] = [];
  editor.onEdit((text) => received.push(text));

  // When
  editor.destroy();
  engine.emitUpdate("销毁后的编辑");

  // Then
  assert.equal(engine.destroyed, true);
  assert.deepEqual(received, []);
});

test("pastes the plain-text representation of rich clipboard content", () => {
  // Given
  const insertedTexts: string[] = [];
  const handlePaste = createPlainTextPasteHandler((text) => insertedTexts.push(text));
  const clipboardData = {
    getData(type: string): string {
      return type === "text/plain" ? "标题\n第一项\n第二项" : "<h1 style='color:red'>标题</h1><ul><li>第一项</li><li>第二项</li></ul>";
    },
  };

  // When
  const handled = handlePaste({ clipboardData });

  // Then
  assert.equal(handled, true);
  assert.deepEqual(insertedTexts, ["标题\n第一项\n第二项"]);
});

test("preserves plain-text leading, trailing, and consecutive newlines when pasting", () => {
  // Given
  const insertedTexts: string[] = [];
  const handlePaste = createPlainTextPasteHandler((text) => insertedTexts.push(text));
  const clipboardData = {
    getData(type: string): string {
      return type === "text/plain" ? "\n甲\n\n乙\n" : "";
    },
  };

  // When
  const handled = handlePaste({ clipboardData });

  // Then
  assert.equal(handled, true);
  assert.deepEqual(insertedTexts, ["\n甲\n\n乙\n"]);
});

test("copies an internal blank paragraph as exactly one blank line", () => {
  // Given
  const selectedDocument = importPlainText("甲\n\n乙");

  // When
  const clipboardText = serializePlainTextClipboard(selectedDocument);

  // Then
  assert.equal(clipboardText, "甲\n\n乙");
});

test("leaves paste unhandled when clipboard data is unavailable", () => {
  // Given
  const insertedTexts: string[] = [];
  const handlePaste = createPlainTextPasteHandler((text) => insertedTexts.push(text));

  // When
  const handled = handlePaste({ clipboardData: null });

  // Then
  assert.equal(handled, false);
  assert.deepEqual(insertedTexts, []);
});
