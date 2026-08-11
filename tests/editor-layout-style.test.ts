import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1] ?? "";
}

function hasDeclaration(block: string, property: string, value: string): void {
  assert.match(block, new RegExp(`${property}\\s*:\\s*${value}\\s*;`));
}

test("Tiptap notebooks preserve the bounded writing surface and focus treatment", () => {
  const notebooks = rule(".editor-notebooks");
  const mount = rule(".notebook-textarea");
  const editable = rule(".notebook-textarea .ProseMirror");
  const focusedMount = rule(".notebook-textarea:focus-within");

  hasDeclaration(notebooks, "min-height", "0");
  hasDeclaration(mount, "min-height", "0");
  hasDeclaration(mount, "overflow", "hidden");
  hasDeclaration(mount, "border", "1px solid #e2e8f0");
  hasDeclaration(mount, "border-radius", "8px");

  hasDeclaration(editable, "width", "100%");
  hasDeclaration(editable, "height", "100%");
  hasDeclaration(editable, "padding", "1rem");
  hasDeclaration(editable, "overflow-y", "auto");
  hasDeclaration(editable, "outline", "none");
  hasDeclaration(editable, "font-size", "1rem");
  hasDeclaration(editable, "font-family", "inherit");

  hasDeclaration(focusedMount, "border-color", "#4a5568");
});
