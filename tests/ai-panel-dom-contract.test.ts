import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiPanel } from "../src/ai-panel.ts";
import { getAppDom } from "../src/dom.ts";
import {
  createAiPanelDomFixture,
  FakeElement,
  installFakeDocument,
} from "./ai-panel-dom-fixture.ts";

test("complete page assembly returns a valid AI panel DOM contract", () => {
  const doc = installFakeDocument();
  try {
    const dom = getAppDom();
    const contract = dom.aiPanelDom;

    assert.ok(contract.panel);
    assert.ok(contract.panelBody);
    assert.ok(contract.snapshotBlock);
    assert.ok(contract.snapshotText);
    assert.ok(contract.loading);
    assert.ok(contract.response);
    assert.ok(contract.thinkingExpansionPrestate);
    assert.ok(contract.thinkingExpansionTitle);
    assert.ok(contract.thinkingExpansionCount);
    assert.ok(contract.thinkingExpansionForm);
    assert.ok(contract.thinkingExpansionInput);
    assert.ok(contract.thinkingExpansionStart);
    assert.ok(contract.errorBlock);
    assert.ok(contract.errorMessage);
    assert.ok(contract.retryBtn);
    assert.ok(contract.configBlock);
    assert.ok(contract.goConfigBtn);
    assert.ok(contract.collapseBtn);
    assert.ok(contract.newConversationBtn);
    assert.ok(contract.toggleBtn);
    assert.ok(contract.conversation);
    assert.ok(contract.followUpForm);
    assert.ok(contract.followUpInput);
    assert.ok(contract.followUpSend);
    assert.ok(contract.followUpError);
    assert.ok(contract.followUpErrorMessage);
    assert.ok(contract.followUpRetry);
    assert.ok(contract.followUpEdit);
    assert.ok(contract.directQuestion);
    assert.ok(contract.directQuestionSelection);
    assert.ok(contract.directQuestionSelectionText);
    assert.ok(contract.directQuestionSelectionRemove);
    assert.ok(contract.directQuestionForm);
    assert.ok(contract.directQuestionInput);
    assert.ok(contract.directQuestionSend);
    assert.ok(contract.directQuestionLoading);
    assert.ok(contract.directQuestionResponse);
    assert.ok(contract.directQuestionError);
    assert.ok(contract.directQuestionErrorMessage);
    assert.ok(contract.directQuestionConfig);
    assert.ok(contract.directQuestionGoConfig);

    // 共享节点与 AppDom 公共字段指向同一元素，避免接线漂移。
    assert.equal(contract.panel, dom.aiPanel);
    assert.equal(contract.response, dom.aiResponse);
    assert.equal(contract.toggleBtn, dom.btnToggleAi);
    assert.equal(contract.conversation, dom.aiConversation);
    assert.equal(contract.followUpForm, dom.aiFollowUpForm);
    assert.equal(contract.followUpInput, dom.aiFollowUpInput);
    assert.equal(contract.followUpSend, dom.aiFollowUpSend);
  } finally {
    doc.restore();
  }
});

test("missing required AI panel node fails assembly with its identifier", () => {
  const doc = installFakeDocument({ missingIds: ["ai-snapshot-text"] });
  try {
    assert.throws(() => getAppDom(), /#ai-snapshot-text/);
  } finally {
    doc.restore();
  }
});

test("missing .ai-panel-body fails assembly with its selector", () => {
  const doc = installFakeDocument({ panelBody: null });
  try {
    assert.throws(() => getAppDom(), /\.ai-panel-body/);
  } finally {
    doc.restore();
  }
});

test("setupAiPanel initializes purely from the explicit contract without global lookups", () => {
  const { dom } = createAiPanelDomFixture();
  const previousDocument = globalThis.document;
  let getElementByIdCalls = 0;
  globalThis.document = {
    getElementById: () => {
      getElementByIdCalls += 1;
      return null;
    },
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  try {
    const state = new AiPanelState();
    setupAiPanel(dom, state, {
      onRetry: () => {},
      onGoToConfig: () => {},
      onStartThinkingExpansion: () => true,
      onSubmitFollowUp: () => Promise.resolve(true),
      onRetryFollowUp: () => Promise.resolve(true),
      onEditFollowUp: () => Promise.resolve(true),
      onSubmitDirectQuestion: () => Promise.resolve(true),
      onRemoveDirectQuestionSelection: () => {},
      onDirectQuestionFocus: () => {},
      onOpenPanel: () => {},
    });

    assert.equal(getElementByIdCalls, 0);
    const panel = dom.panel as unknown as FakeElement;
    const toggleBtn = dom.toggleBtn as unknown as FakeElement;
    const collapseBtn = dom.collapseBtn as unknown as FakeElement;
    assert.equal(panel.querySelectorCalls, 0);
    assert.equal(state.isOpen, false);

    // 交互仍通过契约节点工作：开合、收起。
    toggleBtn.dispatch("click");
    assert.equal(state.isOpen, true);
    collapseBtn.dispatch("click");
    assert.equal(state.isOpen, false);
  } finally {
    globalThis.document = previousDocument;
  }
});