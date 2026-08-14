import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  RichTextEditorAdapter,
  type RichTextEditorCoordinates,
  type RichTextEditorEngine,
} from "../src/rich-text-editor.ts";
import type { FormatCommand } from "../src/format-commands.ts";

test("legacy textarea mirror coordinate module is absent from production", () => {
  const legacyModule = new URL("../src/caret-coordinates.ts", import.meta.url);

  assert.equal(existsSync(legacyModule), false);
});

class CoordinateEngine implements RichTextEditorEngine {
  readonly coordinateReads: number[] = [];

  getDocument() {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "坐标测试" }] }],
    };
  }

  onUpdate(_listener: () => void): void {}

  offUpdate(_listener: () => void): void {}

  onSelectionUpdate(_listener: () => void): void {}

  offSelectionUpdate(_listener: () => void): void {}

  focus(): void {}

  getSelection() {
    return { from: 1, to: 4, head: 4 };
  }

  coordinatesAt(position: number): RichTextEditorCoordinates {
    this.coordinateReads.push(position);
    return {
      left: position * 10,
      right: position * 10 + 1,
      top: 20,
      bottom: 36,
    };
  }

  runCommand(_command: FormatCommand): boolean {
    return false;
  }

  canUndo(): boolean {
    return false;
  }

  canRedo(): boolean {
    return false;
  }

  destroy(): void {}
}

test("editor coordinates delegate directly to the kernel position API", () => {
  const engine = new CoordinateEngine();
  const editor = new RichTextEditorAdapter(engine);

  const start = editor.coordinatesAt(1);
  const head = editor.coordinatesAt(4);

  assert.deepEqual(engine.coordinateReads, [1, 4]);
  assert.deepEqual(start, { left: 10, right: 11, top: 20, bottom: 36 });
  assert.deepEqual(head, { left: 40, right: 41, top: 20, bottom: 36 });
});
