import assert from "node:assert/strict";
import test from "node:test";

import type { JSONContent } from "@tiptap/core";

import { setupAiFeature } from "../src/ai-feature.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import { canonicalNotebookJson } from "../src/structured-notebook.ts";
import type { AppDom } from "../src/dom.ts";
import type { RichTextEditorSelection } from "../src/rich-text-editor.ts";
import type { SelectionEntryEditor } from "../src/selection-entry.ts";
import type { GenerateAiRequest } from "../src/types.ts";
import { installAiFeatureEnvironment } from "./ai-panel-dom-fixture.ts";

async function flush(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

interface SelectionAuthHarness {
  controller: ReturnType<typeof setupAiFeature>;
  requests: GenerateAiRequest[];
  setProjectPath: (path: string) => void;
  setDocumentVersion: (version: string | null) => void;
  setHiddenDocumentIds: (ids: readonly string[]) => void;
  submitDirectQuestionWithSelection: (question: string) => void;
  restore: () => void;
}

function selectionAuthHarness(options: {
  documentId?: string;
  projectPath?: string;
  documentVersion?: string;
  hiddenDocumentIds?: readonly string[];
  selectionText?: string;
} = {}): SelectionAuthHarness {
  const env = installAiFeatureEnvironment();
  const elements = env.elements;
  const requests: GenerateAiRequest[] = [];

  const transport: AiSessionTransport = {
    sendViaResidentSession: (_conversationId, request) => {
      requests.push(request);
      return Promise.resolve({ ok: true, content: "回答" });
    },
    cancelMessage: () => {},
    endSession: () => {},
    endAllSessions: () => {},
    replaySession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    installSessionEventRouting: () => {},
  };

  const state: {
    documentId: string;
    projectPath: string;
    documentVersion: string | null;
    hiddenDocumentIds: Set<string>;
  } = {
    documentId: options.documentId ?? "doc-1",
    projectPath: options.projectPath ?? "D:\\作品",
    documentVersion: options.documentVersion ?? "v1",
    hiddenDocumentIds: new Set(options.hiddenDocumentIds ?? []),
  };

  const text = options.selectionText ?? "林站在天台边。";
  const selection: RichTextEditorSelection = { from: 1, to: text.length + 1, head: text.length + 1 };
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  const editor: SelectionEntryEditor = {
    element: env.editor as unknown as HTMLElement,
    getDocument: () => doc,
    getSelection: () => selection,
    coordinatesAt: () => ({ left: 0, right: 1, top: 0, bottom: 10 }),
  };

  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => state.documentId,
    getCurrentEditor: () => editor,
    openConfigPage: () => {},
    getCurrentProjectPath: () => state.projectPath,
    getCurrentDocumentTitle: () => "草稿",
    getCurrentDocumentVersion: () => state.documentVersion ?? null,
  }, {
    transport,
    loadConfig: () => Promise.resolve({ api_base_url: "https://api.example.com/v1", model: "m", has_api_key: true }),
    conversationList: () => Promise.resolve({ conversations: [], skipped: [] }),
    conversationSave: () => Promise.resolve(),
    newConversationId: () => "c-1",
    getHiddenDocumentIds: () => state.hiddenDocumentIds,
  });

  return {
    controller,
    requests,
    setProjectPath: (path) => { state.projectPath = path; },
    setDocumentVersion: (version) => { state.documentVersion = version; },
    setHiddenDocumentIds: (ids) => { state.hiddenDocumentIds = new Set(ids); },
    submitDirectQuestionWithSelection(question) {
      // 展开面板 → 新建空窗口 → 冻结当前选区（携带身份）→ 提交直接提问。
      elements.get("btn-toggle-ai")!.dispatch("click");
      elements.get("ai-new-conversation")!.dispatch("click");
      env.editor.dispatch("mouseup");
      const win = env.windowRoots[env.windowRoots.length - 1];
      const input = win.queryResults.get('[data-role="direct-question-input"]')!;
      input.value = question;
      input.dispatch("input");
      win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
    },
    restore: () => env.restore(),
  };
}

test("production wiring sends an allowed selection with source identity", async () => {
  const ui = selectionAuthHarness();
  try {
    ui.submitDirectQuestionWithSelection("这段里人物在隐瞒什么？");
    await flush();

    assert.deepEqual(ui.requests, [{
      kind: "direct_question",
      question: "这段里人物在隐瞒什么？",
      selected_text: "林站在天台边。",
      document_id: "doc-1",
      project_path: "D:\\作品",
      document_version: "v1",
      snapshot: canonicalNotebookJson({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "林站在天台边。" }] }],
      }),
    }], "允许的选区请求必须携带作品 / 文档 / 版本身份与未保存正文快照");
  } finally {
    ui.restore();
  }
});

test("production wiring rejects a hidden-document selection before sending", async () => {
  const ui = selectionAuthHarness({ hiddenDocumentIds: ["doc-1"] });
  try {
    ui.submitDirectQuestionWithSelection("这段里人物在隐瞒什么？");
    await flush();

    assert.equal(ui.requests.length, 0, "隐藏文档选区不得发送给 AI");
    const request = ui.controller.state.view.request;
    assert.equal(request.kind, "direct_question");
    if (request.kind === "direct_question") {
      assert.equal(request.status, "error");
      assert.match(request.error?.message ?? "", /不允许 AI 查看/);
    }
  } finally {
    ui.restore();
  }
});

test("production wiring rejects a cross-project selection before sending", async () => {
  const ui = selectionAuthHarness();
  try {
    // 冻结选区时作品为 A，随后切换到作品 B：发送前必须按来源作品身份拒绝。
    ui.submitDirectQuestionWithSelection("旧作品的选区");
    ui.setProjectPath("D:\\作品B");
    await flush();

    assert.equal(ui.requests.length, 0, "跨作品选区不得发送给 AI");
    const request = ui.controller.state.view.request;
    assert.equal(request.kind, "direct_question");
    if (request.kind === "direct_question") {
      assert.equal(request.status, "error");
    }
  } finally {
    ui.restore();
  }
});

test("production wiring rejects a stale-version selection before sending", async () => {
  const ui = selectionAuthHarness();
  try {
    // 冻结选区时版本为 v1，随后文档版本推进到 v2：发送前必须拒绝失效版本。
    ui.submitDirectQuestionWithSelection("旧版本的选区");
    ui.setDocumentVersion("v2");
    await flush();

    assert.equal(ui.requests.length, 0, "失效版本选区不得发送给 AI");
    const request = ui.controller.state.view.request;
    assert.equal(request.kind, "direct_question");
    if (request.kind === "direct_question") {
      assert.equal(request.status, "error");
    }
  } finally {
    ui.restore();
  }
});

test("production wiring re-checks permission when it closes during preflight", async () => {
  const ui = selectionAuthHarness();
  try {
    // 先冻结合法选区，再在预检挂起前把来源文档改为隐藏。
    ui.submitDirectQuestionWithSelection("待复核的选区");
    ui.setHiddenDocumentIds(["doc-1"]);
    await flush();

    assert.equal(ui.requests.length, 0, "预检期间关闭权限必须在发送前放弃");
    const request = ui.controller.state.view.request;
    assert.equal(request.kind, "direct_question");
    if (request.kind === "direct_question") {
      assert.equal(request.status, "error");
    }
  } finally {
    ui.restore();
  }
});
