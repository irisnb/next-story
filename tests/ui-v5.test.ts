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
    // fix-tooltip-rule-ownership D1/D3：底层控件全禁用（如无选区）时触发按钮改置
    // aria-disabled（不置原生 disabled，事件与提示保留），打开的面板随之收起，
    // 点击入口守卫拒绝再次展开；共享提示文字源 data-hint 保持可用。
    size.disabled = true;
    window.document.dispatchEvent(new window.Event("writing-format-rendered"));
    assert.equal(trigger.disabled, false);
    assert.equal(trigger.getAttribute("aria-disabled"), "true");
    assert.equal(sheet.classList.contains("hidden"), true);
    assert.ok(trigger.dataset.hint && trigger.dataset.hint.startsWith("字号"), "禁用态提示文字源（data-hint）仍在");
    trigger.click();
    assert.equal(sheet.classList.contains("hidden"), true, "禁用态点击不得打开工具选项");
    size.disabled = false;
    window.document.dispatchEvent(new window.Event("writing-format-rendered"));
    assert.equal(trigger.getAttribute("aria-disabled"), null);
    trigger.click();
    assert.equal(sheet.classList.contains("hidden"), false, "恢复可用后点击正常打开");
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

test("unavailable-tool reason hints show on the shared tooltip briefly and resist pointer interference", { timeout: 5000 }, async () => {
  // D3 C 案 3.6/3.9：守卫点经 window 事件 ns-toolbar-hint（detail＝{ text, anchor }）
  // 解耦送来原因，共享提示层按锚点按钮矩形定位、短暂呈现（约 1.4 秒）后定时强制
  // 隐藏；展示期悬停/移出不抢位、不提前隐藏；无锚时回退左侧工具栏竖排。
  const window = new Window();
  const names = ["document", "window", "HTMLElement", "Element", "KeyboardEvent", "MutationObserver", "ResizeObserver", "localStorage", "CustomEvent"] as const;
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  class ResizeStub {
    constructor(_callback: () => void) {}
    observe(): void {}
    disconnect(): void {}
  }
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === "ResizeObserver" ? ResizeStub : window[name] });
  let dispose: (() => void) | undefined;
  try {
    window.document.body.innerHTML = '<div id="format-toolbar"><button id="bold" data-hint="粗体">粗体</button></div>';
    dispose = setupUiV5();
    const tip = window.document.getElementById("ui-tooltip") as unknown as HTMLElement;
    assert.equal(tip.classList.contains("hidden"), true, "初始无提示");

    // 守卫点送来原因（新契约：detail＝{ text, anchor }，anchor＝触发按钮）。
    const bold = window.document.getElementById("bold")!;
    window.dispatchEvent(Object.assign(new window.Event("ns-toolbar-hint"), { detail: { text: "先选中文字再用", anchor: bold } }));
    assert.equal(tip.classList.contains("hidden"), false);
    assert.equal(tip.textContent, "先选中文字再用");
    // 按锚点矩形定位（happy-dom 矩形为零值，仅断言定位已落到数值坐标）。
    assert.match(tip.style.left, /^-?\d+(\.\d+)?px$/, "提示横向定位应为数值坐标");
    assert.match(tip.style.top, /^-?\d+(\.\d+)?px$/, "提示纵向定位应为数值坐标");

    // 展示期不受指针事件干扰：悬停不抢位、移出不提前隐藏。
    bold.dispatchEvent(new window.Event("pointerover", { bubbles: true }));
    assert.equal(tip.textContent, "先选中文字再用", "展示期悬停不得替换原因提示");
    bold.dispatchEvent(new window.Event("pointerout", { bubbles: true }));
    assert.equal(tip.classList.contains("hidden"), false, "展示期移出不得提前隐藏");

    // 到期定时强制隐藏；随后正常悬停提示恢复接管。
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal(tip.classList.contains("hidden"), true, "约 1.4 秒后自动隐藏");
    bold.dispatchEvent(new window.Event("pointerover", { bubbles: true }));
    assert.equal(tip.textContent, "粗体", "隐藏后悬停提示恢复正常");
    bold.dispatchEvent(new window.Event("pointerout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 无锚回退（detail.anchor 缺失）：仍显示，不抛错（回退左侧工具栏竖排）。
    window.dispatchEvent(Object.assign(new window.Event("ns-toolbar-hint"), { detail: { text: "没有可撤销的内容" } }));
    assert.equal(tip.classList.contains("hidden"), false, "无锚时仍应显示原因提示");
    assert.equal(tip.textContent, "没有可撤销的内容");
    await new Promise((resolve) => setTimeout(resolve, 1500));

    dispose(); dispose = undefined;
    assert.equal(window.document.getElementById("ui-tooltip"), null);
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
