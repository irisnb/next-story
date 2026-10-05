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
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(block, new RegExp(`${property}\\s*:\\s*${escaped}\\s*;`));
}

test("Tiptap notebooks preserve the bounded writing surface and focus treatment", () => {
  const notebooks = rule(".editor-notebooks");
  const mount = rule(".notebook-textarea");
  const editable = rule(".notebook-textarea .ProseMirror");
  const focusedMount = rule(".notebook-textarea:focus-within");

  hasDeclaration(notebooks, "min-height", "0");
  hasDeclaration(mount, "min-height", "0");
  hasDeclaration(mount, "overflow", "hidden");
  hasDeclaration(mount, "border", "var(--border-editor)");
  hasDeclaration(mount, "border-radius", "var(--radius-md)");

  hasDeclaration(editable, "width", "100%");
  hasDeclaration(editable, "height", "100%");
  hasDeclaration(editable, "padding", "1rem");
  hasDeclaration(editable, "overflow-y", "auto");
  hasDeclaration(editable, "outline", "none");
  hasDeclaration(editable, "font-size", "1rem");
  hasDeclaration(editable, "font-family", "inherit");

  hasDeclaration(focusedMount, "border-color", "var(--color-primary)");
});

test("ordered-list numbering flyout keeps the full-width button and a slim handle below it", () => {
  const row = rule(".ol-style-row");
  hasDeclaration(row, "position", "relative");
  hasDeclaration(row, "width", "100%");
  // 回归守卫：行内不得再横向分宽——曾把 70px 标准按钮拆成 47px+21px，
  // 「1. 列表」被裁成「1. 列」。主按钮必须吃满整行宽度。
  assert.doesNotMatch(row, /display\s*:\s*flex/);
  assert.doesNotMatch(row, /gap\s*:/);

  const trigger = rule(".ol-style-trigger");
  // 触发器是按钮下缘的独立窄柄（流内布局），不是叠在按钮上的绝对定位层——
  // 本列按钮零余量，角落叠放曾与「表」字右缘实测重叠 4.8px。
  assert.doesNotMatch(trigger, /position\s*:\s*absolute/);
  hasDeclaration(trigger, "display", "flex");
  hasDeclaration(trigger, "width", "100%");
  hasDeclaration(trigger, "height", "13px");
  hasDeclaration(trigger, "background", "transparent");

  // 角落三角（6px）在 13px 高的柄内旋转展开也不被裁。
  const caret = rule(".ol-style-caret");
  hasDeclaration(caret, "width", "6px");
  hasDeclaration(caret, "height", "6px");
  const caretOpen = rule(".ol-style-trigger[aria-expanded=\"true\"] .ol-style-caret");
  hasDeclaration(caretOpen, "transform", "rotate(-135deg)");
});
