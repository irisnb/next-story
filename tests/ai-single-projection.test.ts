import assert from "node:assert/strict";
import test from "node:test";
import { setupAiDock, type AiDockActions } from "../src/ai-dock.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import { createAiDockDomFixture, installDocument } from "./ai-panel-dom-fixture.ts";

function actions(): AiDockActions {
  return {
    openConfigPage: () => {},
    onSubmitFollowUp: async () => true,
    onRetryFollowUp: async () => true,
    onEditFollowUp: async () => true,
    onRetryStoppedFollowUp: async () => true,
    onRetry: () => {},
    onSubmitDirectQuestion: async () => true,
    onRemoveDirectQuestionSelection: () => {},
    onDirectQuestionFocus: () => {},
    onStop: () => {},
    onClose: () => {},
    onDelete: async () => {},
    onOpenDiscussion: () => {},
    onNewConversation: () => {},
    onRename: async () => true,
    onTogglePin: async () => true,
    onUndoDelete: () => {},
    getUndoNotice: () => null,
    hasWaitTimingData: () => false,
    exportWaitTiming: async () => ({ ok: true, cancelled: false, count: 0 }),
    clearWaitTiming: () => {},
    onSwitchFocusDocument: () => {},
    getVisibleDocuments: () => [],
    resolveDocumentTitle: () => null,
    isDocumentHidden: () => false,
    onResolveReadingRequest: () => {},
    onToggleOnDemandReading: () => {},
  };
}

test("only the current discussion is mounted while background generation remains live", () => {
  const env = installDocument();
  const fixture = createAiDockDomFixture();
  const state = new AiPanelState();
  const controller = setupAiDock(fixture.dom, state, actions());
  try {
    state.beginDirectQuestion("A问题", null);
    const a = state.activeConversationId!;
    state.beginDirectQuestion("B问题", null);
    const b = state.activeConversationId!;
    const bRequest = state.viewOf(b).request;
    const body = fixture.elements.get("ai-dock-body")!;
    assert.equal(body.children.length, 1, "只挂载当前讨论DOM");
    assert.equal(body.children[0].dataset.conversationId, b);
    assert.equal(fixture.elements.has("ai-dock-float-layer"), false);
    state.appendStreamText(a, "A后台回复");
    assert.equal(body.children[0].dataset.conversationId, b, "后台结果不抢投影");
    state.selectDiscussion(a);
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0].dataset.conversationId, a);
    assert.deepEqual(state.viewOf(b).request, bRequest, "切换不改变B请求");
    state.close();
    state.appendStreamText(b, "B后台回复");
    assert.equal(state.isOpen, false, "后台结果不展开面板");
    const aRequest = state.viewOf(a).request;
    assert.equal(aRequest.kind, "direct_question");
    assert.equal(aRequest.kind === "direct_question" && aRequest.streamedText, "A后台回复");
  } finally {
    controller.destroy();
    env.restore();
  }
});

test("switching away and back restores the unsent follow-up from discussion state", () => {
  const env = installDocument();
  const fixture = createAiDockDomFixture();
  const state = new AiPanelState();
  const controller = setupAiDock(fixture.dom, state, actions());
  try {
    state.beginDirectQuestion("A", null);
    const a = state.activeConversationId!;
    state.succeedDirectQuestion("回答", a);
    const input = fixture.windowRoots[fixture.windowRoots.length - 1].queryResults.get('[data-role="follow-up-input"]')!;
    input.value = "尚未发送的追问";
    input.dispatch("input");
    state.beginDirectQuestion("B", null);
    state.selectDiscussion(a);
    const restored = fixture.windowRoots[fixture.windowRoots.length - 1].queryResults.get('[data-role="follow-up-input"]')!;
    assert.equal(restored.value, "尚未发送的追问");
    assert.equal(input.listenerCount("input"), 0, "切换卸载旧输入监听");
  } finally {
    controller.destroy();
    env.restore();
  }
});

test("maximizing keeps the current projection and closing resets the display mode", () => {
  const env = installDocument();
  const fixture = createAiDockDomFixture();
  const state = new AiPanelState();
  const controller = setupAiDock(fixture.dom, state, actions());
  try {
    state.beginDirectQuestion("A", null);
    const root = fixture.elements.get("ai-dock-body")!.children[0];
    const maximize = fixture.elements.get("ai-dock-maximize")!;
    maximize.dispatch("click");
    assert.ok(fixture.elements.get("ai-dock")!.classList.contains("ai-panel-maximized"));
    assert.equal(fixture.elements.get("ai-dock-body")!.children[0], root);
    assert.match((maximize as unknown as HTMLElement).innerHTML, /class="panelicon"/);
    assert.match((maximize as unknown as HTMLElement).innerHTML, /M8 4h12v12h-4M4 8h12v12H4ZM4 12h12/);
    assert.match((maximize as unknown as HTMLElement).innerHTML, /<span>恢复边栏<\/span>/);
    state.close();
    assert.equal(fixture.elements.get("ai-dock")!.classList.contains("ai-panel-maximized"), false);
    state.open();
    assert.match((maximize as unknown as HTMLElement).innerHTML, /M4 4h16v16H4ZM4 8h16/);
    assert.match((maximize as unknown as HTMLElement).innerHTML, /<span>最大化<\/span>/);
    assert.equal(fixture.elements.get("ai-dock-body")!.children[0], root);
  } finally {
    controller.destroy();
    env.restore();
  }
});

test("keyboard resizing changes only panel width and releases its listeners", () => {
  const env = installDocument();
  const fixture = createAiDockDomFixture();
  const state = new AiPanelState();
  const controller = setupAiDock(fixture.dom, state, actions());
  const divider = fixture.elements.get("ai-dock-divider")!;
  try {
    state.beginDirectQuestion("A", null);
    const request = state.viewOf(state.activeConversationId!).request;
    divider.dispatch("keydown", { key: "ArrowLeft" });
    assert.equal(fixture.elements.get("ai-dock")!.style.width, "440px");
    divider.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(fixture.elements.get("ai-dock")!.style.width, "420px");
    assert.deepEqual(state.viewOf(state.activeConversationId!).request, request);
    controller.destroy();
    assert.equal(divider.listenerCount("keydown"), 0);
    assert.equal(divider.listenerCount("pointerdown"), 0);
  } finally {
    controller.destroy();
    env.restore();
  }
});

test("switching discussion restores its reading position without forcing the bottom", () => {
  const env = installDocument();
  const fixture = createAiDockDomFixture();
  const state = new AiPanelState();
  const controller = setupAiDock(fixture.dom, state, actions());
  try {
    state.beginDirectQuestion("A", null);
    const a = state.activeConversationId!;
    state.succeedDirectQuestion("回答", a);
    const body = fixture.windowRoots[0].queryResults.get('[data-role="body"]')!;
    Object.assign(body, { scrollHeight: 2000, clientHeight: 500, scrollTop: 250 });
    body.dispatch("scroll");
    state.beginDirectQuestion("B", null);
    state.selectDiscussion(a);
    const restored = fixture.windowRoots[fixture.windowRoots.length - 1].queryResults.get('[data-role="body"]')!;
    assert.equal(restored.scrollTop, 250);
    state.beginDirectQuestion("C", null);
    assert.equal(body.listenerCount("scroll"), 0);
  } finally {
    controller.destroy();
    env.restore();
  }
});
