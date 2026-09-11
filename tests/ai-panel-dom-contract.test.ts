import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { buildAiWindowDom, getAppDom } from "../src/dom.ts";
import { setupAiWindow } from "../src/ai-window.ts";
import { createAiWindowFixture, installFakeDocument } from "./ai-panel-dom-fixture.ts";

test("complete page assembly returns a valid AI dock contract", () => {
  const doc = installFakeDocument();
  try {
    const dom = getAppDom();
    const dock = dom.aiDock;
    assert.ok(dock.root);
    assert.ok(dock.rail);
    assert.ok(dock.count);
    assert.ok(dock.notice);
    assert.ok(dock.body);
    assert.ok(dock.floatLayer);
    assert.ok(dock.windowTemplate);
    assert.ok(dock.listToggleBtn);
    assert.ok(dock.newConversationBtn);
    assert.ok(dock.moreBtn);
    assert.ok(dock.collapseBtn);
    assert.ok(dock.conversationList);
    assert.ok(dock.conversationListItems);
    assert.ok(dock.conversationListEmpty);
  } finally {
    doc.restore();
  }
});

test("missing required dock node fails assembly with its identifier", () => {
  const doc = installFakeDocument({ missingIds: ["ai-dock-count"] });
  try {
    assert.throws(() => getAppDom(), /#ai-dock-count/);
  } finally {
    doc.restore();
  }
});

test("buildAiWindowDom assembles a full contract from a window root by role", () => {
  const { root } = createAiWindowFixture("c-1");
  const dom = buildAiWindowDom(root as unknown as HTMLElement);
  assert.ok(dom.root);
  assert.ok(dom.head);
  assert.ok(dom.statusDot);
  assert.ok(dom.title);
  assert.ok(dom.badge);
  assert.ok(dom.stopBtn);
  assert.ok(dom.moreBtn);
  assert.ok(dom.closeBtn);
  assert.ok(dom.conversation);
  assert.ok(dom.followUpForm);
  assert.ok(dom.followUpInput);
  assert.ok(dom.directQuestionInput);
});

test("buildAiWindowDom fails with the missing role identifier when a node is absent", () => {
  const { root, roles } = createAiWindowFixture("c-1");
  root.queryResults.delete('[data-role="snapshot-text"]');
  assert.throws(() => buildAiWindowDom(root as unknown as HTMLElement), /snapshot-text/);
  void roles;
});

test("multiple windows get independent contracts from independent roots", () => {
  const a = createAiWindowFixture("a");
  const b = createAiWindowFixture("b");
  const domA = buildAiWindowDom(a.root as unknown as HTMLElement);
  const domB = buildAiWindowDom(b.root as unknown as HTMLElement);
  assert.notEqual(domA.conversation, domB.conversation, "窗口契约互不共享节点");
  assert.notEqual(domA.root, domB.root);
});

test("setupAiWindow renders from the explicit contract without global lookups and destroys without leaks", () => {
  const { root } = createAiWindowFixture("c-1");
  const previousDocument = globalThis.document;
  let getElementByIdCalls = 0;
  globalThis.document = {
    getElementById: () => { getElementByIdCalls += 1; return null; },
    createElement: (_tag: string) => ({} as HTMLElement),
    createElementNS: () => ({}) as Element,
  } as unknown as Document;

  try {
    const state = new AiPanelState();
    let stopCalls = 0;
    let closeCalls = 0;
    const controller = setupAiWindow(
      root as unknown as HTMLElement,
      state,
      "c-1",
      {
        onRetry: () => {},
        onRetryFollowUp: () => Promise.resolve(true),
        onRetryStoppedFollowUp: () => Promise.resolve(true),
        onGoToConfig: () => {},
        onSubmitFollowUp: () => Promise.resolve(true),
        onEditFollowUp: () => Promise.resolve(true),
        onSubmitDirectQuestion: () => Promise.resolve(true),
        onRemoveDirectQuestionSelection: () => {},
        onDirectQuestionFocus: () => {},
        onStop: () => { stopCalls += 1; },
        onClose: () => { closeCalls += 1; },
      },
    );

    assert.equal(getElementByIdCalls, 0);
    // 状态变化驱动重绘。
    state.beginDirectQuestion("问题", null);
    assert.equal(state.getDiscussion("c-1"), null, "新讨论身份与窗口身份不同");
    state.beginRequest({ documentId: "d", selectedText: "选区", from: 0, to: 2 });
    // 停止按钮触发 stop。
    const stopBtn = root.queryResults.get('[data-role="stop"]')!;
    stopBtn.dispatch("click");
    assert.equal(stopCalls, 1);
    // 关闭按钮触发 close。
    const closeBtn = root.queryResults.get('[data-role="close"]')!;
    closeBtn.dispatch("click");
    assert.equal(closeCalls, 1);

    controller.destroy();
    assert.equal(root.parentElement, null, "销毁后从 DOM 摘除");
  } finally {
    globalThis.document = previousDocument;
  }
});
