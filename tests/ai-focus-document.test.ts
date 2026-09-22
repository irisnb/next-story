import assert from "node:assert/strict";
import test from "node:test";

import type { JSONContent } from "@tiptap/core";

import { setupAiFeature } from "../src/ai-feature.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import { canonicalNotebookJson } from "../src/structured-notebook.ts";
import type { AppDom } from "../src/dom.ts";
import type { RichTextEditorSelection } from "../src/rich-text-editor.ts";
import type { SelectionEntryEditor } from "../src/selection-entry.ts";
import type { ConversationRecord } from "../src/conversation-archive.ts";
import type {
  ContentTree,
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfigSummary,
  SelectionSnapshot,
} from "../src/types.ts";
import {
  collectText,
  FakeElement,
  installAiFeatureEnvironment,
} from "./ai-panel-dom-fixture.ts";

async function flush(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.example.com/v1",
  model: "m",
  has_api_key: true,
};

/** 作品树：doc-1 / doc-2 可见；doc-secret 关闭 AI 可见性。 */
function storyTree(): ContentTree {
  return {
    root_children: ["doc-1", "doc-2", "doc-secret"],
    nodes: {
      "doc-1": { id: "doc-1", name: "第一稿", kind: "Document", children: [] },
      "doc-2": { id: "doc-2", name: "设定集", kind: "Document", children: [] },
      "doc-secret": { id: "doc-secret", name: "秘密", kind: "Document", children: [], ai_visible: false },
    },
    recycle_bin: [],
  };
}

interface FocusHarness {
  controller: ReturnType<typeof setupAiFeature>;
  requests: GenerateAiRequest[];
  saves: ConversationRecord[];
  windowRoots: FakeElement[];
  body: FakeElement;
  /** 模拟用户切换到另一篇文档查看（不改变讨论关注对象）。 */
  setCurrentDocument(id: string): void;
  submitDirectQuestion(question: string): void;
  restore(): void;
}

function focusHarness(options: {
  editor?: SelectionEntryEditor | null;
  getDocumentVersion?: () => string | null;
} = {}): FocusHarness {
  const env = installAiFeatureEnvironment();
  const requests: GenerateAiRequest[] = [];
  const saves: ConversationRecord[] = [];
  const currentDocument = { id: "doc-1" };
  let nextId = 0;

  const transport: AiSessionTransport = {
    sendViaResidentSession: (_conversationId, request): Promise<GenerateAiResult> => {
      requests.push(request);
      return Promise.resolve({ ok: true, content: "回答" });
    },
    cancelMessage: () => {},
    endSession: () => {},
    endAllSessions: () => {},
    replaySession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    onToolCall: () => () => {},
    onReadingRequest: () => () => {},
    installSessionEventRouting: () => {},
    destroySessionEventRouting: () => {},
  };

  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => currentDocument.id,
    getCurrentEditor: () => options.editor ?? null,
    openConfigPage: () => {},
    getCurrentProjectPath: () => "作品路径",
    getCurrentDocumentTitle: () => "第一稿",
    getCurrentTree: () => storyTree(),
    ...(options.getDocumentVersion !== undefined
      ? { getCurrentDocumentVersion: options.getDocumentVersion }
      : {}),
  }, {
    transport,
    loadConfig: () => Promise.resolve(savedConfig),
    conversationList: () => Promise.resolve({ conversations: [], skipped: [] }),
    conversationSave: (_projectPath, record) => {
      saves.push(record);
      return Promise.resolve();
    },
    conversationDelete: () => Promise.resolve(),
    newConversationId: () => `c-${++nextId}`,
  });

  return {
    controller,
    requests,
    saves,
    windowRoots: env.windowRoots,
    body: env.body,
    setCurrentDocument(id: string): void {
      currentDocument.id = id;
    },
    submitDirectQuestion(question: string): void {
      env.elements.get("ai-new-conversation")!.dispatch("click");
      const win = env.windowRoots[env.windowRoots.length - 1];
      const input = win.queryResults.get('[data-role="direct-question-input"]')!;
      input.value = question;
      input.dispatch("input");
      win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
    },
    restore: () => { env.restore(); },
  };
}

test("关注文档在讨论创建时固定，明确切换后从下一轮生效并持久化", async () => {
  const ui = focusHarness();
  try {
    ui.submitDirectQuestion("这个角色为什么犹豫？");
    await flush();

    // 首轮按发起时的当前文档取材。
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].focus_document_id, "doc-1");

    const conversationId = ui.controller.state.activeConversationId!;
    // 明确切换关注文档（查看其他文档不会自动改绑）。
    assert.equal(
      ui.controller.state.setFocusDocument(conversationId, "doc-2", "设定集"),
      true,
    );

    assert.equal(await ui.controller.submitFollowUp("那他后来怎么想？"), true);
    await flush();

    // 下一轮使用新的关注文档，而不是旧文档。
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.requests[1].focus_document_id, "doc-2");
    // 切换已持久化到讨论档案。
    const lastSave = ui.saves[ui.saves.length - 1];
    assert.equal(lastSave.focus_document_id, "doc-2");
    assert.equal(lastSave.focus_document_title, "设定集");
  } finally {
    ui.restore();
  }
});

test("查看其他文档不改变关注对象，追问仍用原关注文档", async () => {
  const ui = focusHarness();
  try {
    ui.submitDirectQuestion("问题一");
    await flush();
    const conversationId = ui.controller.state.activeConversationId!;
    assert.equal(ui.controller.state.getDiscussion(conversationId)!.focusDocumentId, "doc-1");

    // 用户切换到另一篇文档查看（未做任何明确切换）。
    ui.setCurrentDocument("doc-2");
    assert.equal(
      ui.controller.state.getDiscussion(conversationId)!.focusDocumentId,
      "doc-1",
      "查看其他文档不得自动改绑关注对象",
    );

    assert.equal(await ui.controller.submitFollowUp("追问"), true);
    await flush();
    assert.equal(
      ui.requests[ui.requests.length - 1].focus_document_id,
      "doc-1",
      "追问继续使用原关注文档",
    );
  } finally {
    ui.restore();
  }
});

function editableDoc(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

test("追问按发送时刻取关注文档的最新未保存快照与版本（版本更新）", async () => {
  const docState = { text: "第一版" };
  const version = { value: "v1" };
  const editor: SelectionEntryEditor = {
    element: new FakeElement("editor") as unknown as HTMLElement,
    getDocument: () => editableDoc(docState.text),
    getSelection: () => ({ from: 1, to: 1, head: 1 }) as RichTextEditorSelection,
    coordinatesAt: () => ({ left: 0, right: 1, top: 0, bottom: 10 }),
  };
  const ui = focusHarness({ editor, getDocumentVersion: () => version.value });
  try {
    ui.submitDirectQuestion("问题一");
    await flush();
    assert.equal(ui.requests[0].focus_document_version, "v1");
    assert.equal(ui.requests[0].focus_snapshot, canonicalNotebookJson(editableDoc("第一版")));

    // 发送后继续编辑（未保存）：下一轮追问取最新快照与版本。
    docState.text = "第二版";
    version.value = "v2";
    assert.equal(await ui.controller.submitFollowUp("追问"), true);
    await flush();

    const followUp = ui.requests[ui.requests.length - 1];
    assert.equal(followUp.focus_document_version, "v2");
    assert.equal(followUp.focus_snapshot, canonicalNotebookJson(editableDoc("第二版")));
  } finally {
    ui.restore();
  }
});

test("窗口内的关注文档选择器只列可见文档，选择后从下一轮生效", async () => {
  const ui = focusHarness();
  try {
    ui.submitDirectQuestion("问题一");
    await flush();

    const win = ui.windowRoots[0];
    // 点击窗口头的「切换关注文档」入口打开选择器。
    win.queryResults.get('[data-role="focus-switch"]')!.dispatch("click");

    const menu = ui.body.children.find((el) => el.classList.contains("ai-menu"));
    assert.ok(menu, "关注文档选择器应打开");
    const labels = menu.children.map((child) => collectText(child));
    assert.ok(labels.some((label) => label.includes("第一稿")), "可见文档应出现在选择器");
    assert.ok(labels.some((label) => label.includes("设定集")), "可见文档应出现在选择器");
    assert.ok(!labels.some((label) => label.includes("秘密")), "隐藏文档不得出现在选择器");

    const target = menu.children.find((child) => collectText(child).includes("设定集"))!;
    target.dispatch("click");

    const conversationId = ui.controller.state.activeConversationId!;
    assert.equal(ui.controller.state.getDiscussion(conversationId)!.focusDocumentId, "doc-2");
    // 提示清晰可见。
    const notice = win.queryResults.get('[data-role="focus-notice"]')!;
    assert.match(notice.textContent, /已切换关注文档/);

    assert.equal(await ui.controller.submitFollowUp("追问"), true);
    await flush();
    assert.equal(ui.requests[ui.requests.length - 1].focus_document_id, "doc-2");
  } finally {
    ui.restore();
  }
});

test("及时召唤讨论的追问不携带常规关注文档材料（快车道隔离）", async () => {
  const ui = focusHarness();
  try {
    const snapshot: SelectionSnapshot = { documentId: "doc-1", selectedText: "选区", from: 0, to: 2 };
    ui.controller.state.beginRequest(
      snapshot,
      { kind: "summon", selected_text: "选区" },
      "doc-1",
      "第一稿",
    );
    const conversationId = ui.controller.state.activeConversationId!;
    ui.controller.state.succeed(snapshot, "首答", conversationId);

    assert.equal(await ui.controller.submitFollowUp("继续说说"), true);
    await flush();

    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].kind, "follow_up");
    assert.equal(
      ui.requests[0].focus_document_id,
      undefined,
      "及时召唤追问不得附带常规取材材料",
    );
  } finally {
    ui.restore();
  }
});

// ========== 召唤讨论隐藏「切换关注文档」入口（batch-improvement-candidates 任务组 4） ==========
// 规格来源：automatic-story-context delta——及时召唤类讨论（首轮与既定追问）
// 不提供「切换关注文档」入口：常规现场材料不自动附带，「从下一轮开始使用」
// 的承诺无法成立。判据与取材注入同源（isSummonDiscussion）。

test("及时召唤讨论（对话已建立）不显示窗口头切换入口，窗口菜单隐藏切换条目", async () => {
  const ui = focusHarness();
  try {
    // 建立召唤讨论：首轮成功后 initialUserMaterial.kind === "summon"。
    const snapshot: SelectionSnapshot = { documentId: "doc-1", selectedText: "选区", from: 0, to: 2 };
    ui.controller.state.beginRequest(
      snapshot,
      { kind: "summon", selected_text: "选区" },
      "doc-1",
      "第一稿",
    );
    const conversationId = ui.controller.state.activeConversationId!;
    ui.controller.state.succeed(snapshot, "首答", conversationId);
    await flush();

    const win = ui.windowRoots[0];
    // 窗口头「切换关注文档」按钮隐藏。
    const focusSwitch = win.queryResults.get('[data-role="focus-switch"]')!;
    assert.ok(
      focusSwitch.classList.contains("hidden"),
      "召唤讨论不得显示窗口头切换入口",
    );
    // 入口不可达：点击也不得打开选择器。
    focusSwitch.dispatch("click");
    assert.ok(
      !ui.body.children.some((el) => el.classList.contains("ai-menu")),
      "召唤讨论点击切换按钮不得打开选择器",
    );

    // 窗口菜单：其余条目照常，「切换关注文档…」条目整体不渲染（不是置灰）。
    win.queryResults.get('[data-role="more"]')!.dispatch("click");
    const menu = ui.body.children.find((el) => el.classList.contains("ai-menu"));
    assert.ok(menu, "窗口菜单应打开");
    const labels = menu.children.map((child) => collectText(child));
    assert.ok(
      !labels.some((label) => label.includes("切换关注文档")),
      "召唤讨论的窗口菜单不得提供切换条目",
    );
    assert.ok(
      labels.some((label) => label.includes("本次参考了什么")),
      "其余菜单条目照常提供",
    );
  } finally {
    ui.restore();
  }
});

test("及时召唤首轮在途也不显示切换入口（按待定首轮材料判定）", () => {
  const ui = focusHarness();
  try {
    // 首轮在途：对话尚未建立，按 pendingFirstRequest.kind 判定召唤。
    const snapshot: SelectionSnapshot = { documentId: "doc-1", selectedText: "选区", from: 0, to: 2 };
    ui.controller.state.beginRequest(
      snapshot,
      { kind: "summon", selected_text: "选区" },
      "doc-1",
      "第一稿",
    );

    const win = ui.windowRoots[0];
    const focusSwitch = win.queryResults.get('[data-role="focus-switch"]')!;
    assert.ok(
      focusSwitch.classList.contains("hidden"),
      "召唤首轮在途（对话未建立）也不得显示切换入口",
    );

    // 窗口菜单同样不得提供切换条目。
    win.queryResults.get('[data-role="more"]')!.dispatch("click");
    const menu = ui.body.children.find((el) => el.classList.contains("ai-menu"));
    assert.ok(menu, "窗口菜单应打开");
    const labels = menu.children.map((child) => collectText(child));
    assert.ok(
      !labels.some((label) => label.includes("切换关注文档")),
      "召唤首轮在途的窗口菜单不得提供切换条目",
    );
  } finally {
    ui.restore();
  }
});

test("常规讨论的窗口菜单照常提供切换关注文档条目并可打开选择器", async () => {
  const ui = focusHarness();
  try {
    ui.submitDirectQuestion("问题一");
    await flush();

    const win = ui.windowRoots[0];
    // 窗口头切换入口照常显示（既有行为，见上方选择器测试）。
    const focusSwitch = win.queryResults.get('[data-role="focus-switch"]')!;
    assert.ok(
      !focusSwitch.classList.contains("hidden"),
      "常规讨论窗口头切换入口照常显示",
    );

    // 窗口菜单包含可用（非置灰）的切换条目。
    win.queryResults.get('[data-role="more"]')!.dispatch("click");
    let menu = ui.body.children.find((el) => el.classList.contains("ai-menu"));
    assert.ok(menu, "窗口菜单应打开");
    const switchItem = menu.children.find((child) =>
      collectText(child).includes("切换关注文档"),
    );
    assert.ok(switchItem, "常规讨论的窗口菜单应包含切换条目");
    assert.ok(!switchItem!.disabled, "常规讨论的切换条目应可用");

    // 点击条目打开选择器：列出可见文档。
    switchItem!.dispatch("click");
    menu = ui.body.children.find((el) => el.classList.contains("ai-menu"));
    assert.ok(menu, "选择器应打开");
    const labels = menu.children.map((child) => collectText(child));
    assert.ok(labels.some((label) => label.includes("第一稿")), "选择器应列出可见文档");
    assert.ok(labels.some((label) => label.includes("设定集")), "选择器应列出可见文档");
    assert.ok(!labels.some((label) => label.includes("秘密")), "隐藏文档不得出现在选择器");
  } finally {
    ui.restore();
  }
});
