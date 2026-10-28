import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { confirmInApp } from "../src/app-confirm.ts";

/**
 * 全软件统一应用内确认窗的规格测试（fix-ui-friction-2026-10 · in-app-confirmation）：
 * - 呈现：常规/危险两变体的类名、标题、正文换行与按钮角色；
 * - 几何：取消与确认按钮共用同一条几何规则（128×40、内边距 8px 16px），颜色规则不含几何；
 * - 键盘：Enter 确认（焦点在取消按钮上则取消）、Esc（cancel 事件）取消；
 * - 语义：取消、外部关闭、dialog 不可用与 DOM 异常一律 false，失败不得当作已确认；
 * - 收尾：关闭后 dialog 从 DOM 移除、焦点返回仍连着文档的触发元素；
 * - 并发：同刻多次调用各自独立实例，结果不串。
 *
 * happy-dom 桩说明：happy-dom 不会把 Esc 合成为 dialog 的 cancel 事件、也不会
 * 因 autofocus 属性自动聚焦（组件已用显式 focus() 保证），测试按真实浏览器契约
 * 直接派发 cancel / keydown 事件、断言结构前提（form method="dialog"、autofocus、
 * type=submit），不因此放宽任何断言。
 */

/** 安装 happy-dom 的 document/HTMLElement 全局（模块运行时读取 globalThis）。 */
async function withDom(run: (window: Window) => Promise<void> | void): Promise<void> {
  const window = new Window();
  const previous = new Map(["document", "HTMLElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: window.document },
    HTMLElement: { configurable: true, value: window.HTMLElement },
  });
  try {
    await run(window);
  } finally {
    await window.happyDOM.abort();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

interface ConfirmFixture {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  heading: HTMLHeadingElement;
  body: HTMLParagraphElement;
  cancel: HTMLButtonElement;
  accept: HTMLButtonElement;
}

function queryConfirm(): ConfirmFixture {
  // 复合选择器在 lib.dom 类型上只回 Element；happy-dom 运行时就是 dialog，做类型桥接。
  const dialog = document.querySelector("dialog.app-confirm") as HTMLDialogElement | null;
  assert.ok(dialog, "确认窗应挂载在 document.body");
  const form = dialog.querySelector("form");
  assert.ok(form, "确认窗应包含 form[method=dialog]");
  const heading = dialog.querySelector("h3");
  const body = dialog.querySelector("p");
  const buttons = dialog.querySelectorAll("footer button");
  assert.equal(buttons.length, 2, "footer 恰好两个按钮：取消在左、确认在右");
  return {
    dialog,
    form,
    heading: heading as HTMLHeadingElement,
    body: body as HTMLParagraphElement,
    cancel: buttons[0] as HTMLButtonElement,
    accept: buttons[1] as HTMLButtonElement,
  };
}

function keydownEnter(window: Window, target: Element): void {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
}

function escCancel(window: Window, dialog: HTMLDialogElement): void {
  dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event);
}

// ========== 呈现：常规与危险两变体 ==========

test("常规变体：类名、标题、正文换行与按钮角色", async () => {
  await withDom(async (window) => {
    const pending = confirmInApp({
      title: "启用「情节探索·第4版」？",
      body: "启用后所有项目从下一轮起使用该链路生成。\n当前正在使用的「情节探索·第3版」将被替换。",
      confirmLabel: "启用",
    });
    const view = queryConfirm();
    assert.equal(view.dialog.classList.contains("app-confirm"), true);
    assert.equal(view.dialog.classList.contains("app-confirm-danger"), false, "常规变体不带危险类");
    assert.equal(view.heading.textContent, "启用「情节探索·第4版」？");
    assert.ok(view.body.textContent?.includes("\n"), "正文换行原样保留");
    assert.equal(view.cancel.textContent, "取消");
    assert.equal(view.accept.textContent, "启用");
    assert.equal(view.accept.className, "app-confirm-accept");
    assert.equal(view.dialog.open, true);
    escCancel(window, view.dialog);
    assert.equal(await pending, false);
  });
});

test("危险变体：确认按钮走危险颜色角色", async () => {
  await withDom(async (window) => {
    const pending = confirmInApp({ title: "删除链路？", body: "删除后不可恢复。", confirmLabel: "删除链路", danger: true });
    const view = queryConfirm();
    assert.equal(view.dialog.classList.contains("app-confirm"), true);
    assert.equal(view.dialog.classList.contains("app-confirm-danger"), true, "危险变体在 dialog 上标注危险类");
    assert.equal(view.accept.className, "app-confirm-accept");
    escCancel(window, view.dialog);
    assert.equal(await pending, false);
  });
});

// ========== 几何：取消与确认按钮完全一致 ==========

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `ui-v5.css 缺少规则：${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("按钮几何一致：共用一条 128×40 规则，颜色规则不含几何", () => {
  const css = readFileSync(new URL("../src/ui-v5.css", import.meta.url), "utf8");
  const geometry = ["width", "min-width", "height", "padding"];
  const shared = ruleBlock(css, ".app-confirm footer button {");
  for (const property of geometry) {
    assert.ok(new RegExp(`${property}: `).test(shared), `共用几何规则应声明 ${property}`);
  }
  assert.ok(shared.includes("width: 128px"), "宽 128px");
  assert.ok(shared.includes("min-width: 128px"), "最小宽 128px");
  assert.ok(shared.includes("height: 40px"), "高 40px");
  assert.ok(shared.includes("padding: 8px 16px"), "内边距上下 8px 左右 16px");
  for (const selector of [".app-confirm .app-confirm-cancel {", ".app-confirm .app-confirm-accept {"]) {
    const block = ruleBlock(css, selector);
    for (const property of geometry) {
      assert.equal(new RegExp(`${property}: `).test(block), false, `${selector} 只负责颜色，不得声明 ${property}`);
    }
  }
  assert.ok(ruleBlock(css, ".app-confirm .app-confirm-accept {").includes("var(--color-primary)"), "常规确认按钮用主色");
  assert.ok(ruleBlock(css, ".app-confirm.app-confirm-danger .app-confirm-accept {").includes("var(--color-danger)"), "危险确认按钮用危险色");
  const shell = ruleBlock(css, ".app-confirm {");
  assert.ok(shell.includes("min(640px, calc(100vw - 48px))"), "宽度 min(640px, calc(100vw - 48px))");
  assert.ok(shell.includes("padding: 24px"), "内边距 24px");
  assert.ok(shell.includes("var(--border-control)"), "细边 var(--border-control)");
  assert.ok(shell.includes("var(--radius-sm)"), "圆角 var(--radius-sm)");
  assert.ok(shell.includes("background: white"), "白底");
  assert.ok(shell.includes("margin: auto"), "弹窗居中 margin:auto（全局 * 重置清零浏览器默认居中，验收发现的左上角缺陷）");
  assert.ok(ruleBlock(css, ".making-save-confirm {").includes("margin: auto"), "保存草稿确认窗同规则居中（同病同治）");
  assert.ok(ruleBlock(css, ".app-confirm::backdrop {").includes("#0006"), "遮罩 #0006");
});

// ========== 键盘：Enter 确认、Esc 取消 ==========

test("Enter 确认：结构前提（form method=dialog、autofocus、type=submit）与打开聚焦确认按钮", async () => {
  await withDom(async (window) => {
    const pending = confirmInApp({ title: "停用当前链路？", body: "停用后所有项目下一轮起不使用链路。", confirmLabel: "停用当前链路" });
    const view = queryConfirm();
    assert.equal(view.form.getAttribute("method"), "dialog");
    assert.equal(view.accept.type, "submit");
    assert.equal(view.accept.hasAttribute("autofocus"), true);
    assert.equal(view.cancel.type, "button");
    assert.equal(document.activeElement, view.accept, "打开时焦点在确认按钮");
    keydownEnter(window, view.accept);
    assert.equal(await pending, true);
    assert.equal(document.querySelector("dialog.app-confirm"), null, "关闭后从 DOM 移除");
  });
});

test("Enter 落在取消按钮上则取消，Esc（cancel 事件）取消", async () => {
  await withDom(async (window) => {
    const enterOnCancel = confirmInApp({ title: "启用？", body: "下一轮生效。", confirmLabel: "启用" });
    let view = queryConfirm();
    keydownEnter(window, view.cancel);
    assert.equal(await enterOnCancel, false);

    const esc = confirmInApp({ title: "启用？", body: "下一轮生效。", confirmLabel: "启用" });
    view = queryConfirm();
    escCancel(window, view.dialog);
    assert.equal(await esc, false);
    assert.equal(view.dialog.open, false, "Esc 后 dialog 关闭");
  });
});

// ========== 语义：取消、关闭、异常一律 false ==========

test("点击取消按钮返回 false", async () => {
  await withDom(async () => {
    const pending = confirmInApp({ title: "启用？", body: "下一轮生效。", confirmLabel: "启用" });
    const view = queryConfirm();
    view.cancel.click();
    assert.equal(await pending, false);
  });
});

test("未经确认按钮的外部关闭视为未确认", async () => {
  await withDom(async () => {
    const pending = confirmInApp({ title: "启用？", body: "下一轮生效。", confirmLabel: "启用" });
    const view = queryConfirm();
    view.dialog.close();
    assert.equal(await pending, false);
  });
});

test("DOM 操作失败与 dialog 能力缺失一律返回 false", async () => {
  await withDom(async () => {
    const originalCreate = document.createElement.bind(document);
    const slot = document as unknown as { createElement: unknown };
    slot.createElement = () => {
      throw new Error("DOM unavailable");
    };
    assert.equal(await confirmInApp({ title: "启用？", body: "下一轮生效。", confirmLabel: "启用" }), false);
    slot.createElement = (() => originalCreate("div")) as unknown as typeof document.createElement;
    assert.equal(
      await confirmInApp({ title: "启用？", body: "下一轮生效。", confirmLabel: "启用" }),
      false,
      "createElement 返回无 showModal 的元素时视为未确认",
    );
    slot.createElement = originalCreate;
    assert.equal(document.querySelector("dialog.app-confirm"), null, "失败路径不残留 dialog");
  });
});

// ========== 收尾：移除与焦点归还 ==========

test("关闭后 dialog 移除且焦点返回仍连着文档的触发元素", async () => {
  await withDom(async () => {
    const invoker = document.createElement("button");
    invoker.textContent = "启用第4版";
    document.body.append(invoker);
    invoker.focus();
    const pending = confirmInApp({ title: "启用「情节探索·第4版」？", body: "下一轮生效。", confirmLabel: "启用" });
    assert.notEqual(document.activeElement, invoker, "打开时焦点移入确认窗");
    const view = queryConfirm();
    view.accept.click();
    assert.equal(await pending, true);
    assert.equal(document.querySelector("dialog.app-confirm"), null, "关闭后从 DOM 移除");
    assert.equal(document.activeElement, invoker, "焦点返回触发元素");
  });
});

test("触发元素已断开文档时不强行归还焦点，结果仍正常", async () => {
  await withDom(async () => {
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();
    const pending = confirmInApp({ title: "删除链路？", body: "不可恢复。", confirmLabel: "删除链路", danger: true });
    invoker.remove();
    const view = queryConfirm();
    view.cancel.click();
    assert.equal(await pending, false);
    assert.notEqual(document.activeElement, invoker, "断开的元素不接收焦点");
  });
});

// ========== 并发：同刻多次调用互不串结果 ==========

test("并发实例独立：后开盖前，各自结果不串", async () => {
  await withDom(async () => {
    const first = confirmInApp({ title: "启用「情节探索·第4版」？", body: "下一轮生效。", confirmLabel: "启用" });
    const second = confirmInApp({ title: "删除链路？", body: "不可恢复。", confirmLabel: "删除链路", danger: true });
    assert.equal(document.querySelectorAll("dialog.app-confirm").length, 2, "每次调用各自实例");
    const dialogs = [...document.querySelectorAll("dialog.app-confirm")] as HTMLDialogElement[];
    const [a, b] = dialogs;
    assert.ok(a && b && a !== b);
    (a.querySelector("footer button.app-confirm-accept") as HTMLButtonElement).click();
    (b.querySelector("footer button.app-confirm-cancel") as HTMLButtonElement).click();
    assert.equal(await first, true, "第一个实例确认");
    assert.equal(await second, false, "第二个实例取消");
    assert.equal(document.querySelectorAll("dialog.app-confirm").length, 0, "全部关闭后无残留");
  });
});
