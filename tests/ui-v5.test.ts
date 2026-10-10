import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import type { HTMLSelectElement as HappySelect, HTMLButtonElement as HappyButton } from "happy-dom";
import { readFileSync } from "node:fs";
import { setupUiV5 } from "../src/ui-v5.ts";

test("extra tools retain their node and action, return on resize, and clean up", () => {
  const window = new Window();
  const names = ["document", "window", "HTMLElement", "Element", "KeyboardEvent", "MutationObserver", "ResizeObserver", "localStorage"] as const;
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  let arrange: (() => void) | undefined;
  class ResizeStub {
    constructor(callback: () => void) { arrange = callback; }
    observe(): void {}
    disconnect(): void {}
  }
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === "ResizeObserver" ? ResizeStub : window[name] });
  let dispose: (() => void) | undefined;
  try {
    window.document.body.innerHTML = '<div id="format-toolbar"><button id="bold">粗体</button><button id="image">图片</button><button id="link">链接</button></div>';
    const rail = window.document.getElementById("format-toolbar")!;
    let height = 115;
    Object.defineProperty(rail, "clientHeight", { get: () => height });
    const link = window.document.getElementById("link")!;
    let actions = 0;
    link.addEventListener("click", () => { actions += 1; });
    dispose = setupUiV5();
    arrange!();
    const menu = window.document.getElementById("toolbar-overflow-menu")!;
    assert.equal(link.parentElement, menu);
    link.dispatchEvent(new window.Event("click"));
    assert.equal(actions, 1);
    height = 500;
    arrange!();
    assert.equal(link.parentElement, rail);
    assert.deepEqual(Array.from(rail.children).slice(0, 3).map((node) => node.id), ["bold", "image", "link"]);
    dispose(); dispose = undefined;
    assert.equal(window.document.getElementById("toolbar-overflow-menu"), null);
    assert.equal(window.document.getElementById("ui-tooltip"), null);
    assert.equal(rail.children.length, 3);
  } finally {
    dispose?.();
    names.forEach((name, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
    void window.happyDOM.close();
  }
});

test("writing menus keep real fields, values and handlers while tools overflow and return", () => {
  const window = new Window();
  const names = ["document", "window", "HTMLElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLInputElement", "Element", "KeyboardEvent", "MutationObserver", "ResizeObserver", "localStorage"] as const;
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  let arrange: (() => void) | undefined;
  class ResizeStub {
    constructor(callback: () => void) { arrange = callback; }
    observe(): void {}
    disconnect(): void {}
  }
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === "ResizeObserver" ? ResizeStub : window[name] });
  let dispose: (() => void) | undefined;
  try {
    window.document.body.innerHTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const rail = window.document.getElementById("format-toolbar")!;
    let height = 580;
    Object.defineProperty(rail, "clientHeight", { get: () => height });
    const size = window.document.getElementById("select-font-size") as HappySelect;
    const originalParent = size.parentElement;
    const bold = window.document.getElementById("btn-bold")!;
    const originalBoldMarkup = bold.innerHTML;
    const originalBoldClass = bold.getAttribute("class");
    let changes = 0;
    size.addEventListener("change", () => { changes += 1; });
    dispose = setupUiV5();
    arrange!();
    const trigger = window.document.getElementById("tool-size") as HappyButton;
    trigger.click();
    const sheet = window.document.getElementById("writing-tool-options")!;
    assert.equal(sheet.contains(size), true);
    size.value = "18pt";
    size.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(changes, 1);
    assert.equal(trigger.dataset.value, "18pt（小二）");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    size.disabled = true;
    window.document.dispatchEvent(new window.Event("writing-format-rendered"));
    assert.equal(trigger.disabled, true);
    assert.equal(sheet.classList.contains("hidden"), true);
    const overflow = window.document.getElementById("toolbar-overflow-menu")!;
    const align = window.document.getElementById("btn-align-left")!;
    assert.equal(overflow.contains(align), true);
    height = 1600;
    arrange!();
    assert.equal(align.parentElement, rail);
    assert.equal(rail.firstElementChild?.id, "btn-undo");
    assert.equal(rail.querySelectorAll(".tool-rule").length, 5);
    assert.equal(window.document.getElementById("ordered-list-style-menu")!.querySelectorAll('[role="menuitemradio"]').length, 5);
    assert.equal(window.document.getElementById("ctx-link-create")!.closest("#context-menu") !== null, true);
    dispose(); dispose = undefined;
    assert.equal(size.parentElement, originalParent);
    assert.equal(bold.innerHTML, originalBoldMarkup);
    assert.equal(bold.getAttribute("class"), originalBoldClass);
    assert.equal(window.document.getElementById("writing-tool-options"), null);
  } finally {
    dispose?.();
    names.forEach((name, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
    void window.happyDOM.close();
  }
});
