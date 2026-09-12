import assert from "node:assert/strict";
import test from "node:test";

import { startDirectQuestion } from "../src/ai-feature-direct-question.ts";
import { startSummon } from "../src/ai-feature-first-round.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import { checkSelectionVisibility } from "../src/selection-adapter.ts";
import type {
  GenerateAiRequest,
  LlmConfigSummary,
  SelectionSnapshot,
} from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.example.com/v1",
  model: "test-model",
  has_api_key: true,
};

test("direct question without selection sends a question-only request", async () => {
  const state = new AiPanelState();
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "这个角色为什么犹豫？",
    selection: null,
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(sent, [{
    kind: "direct_question",
    question: "这个角色为什么犹豫？",
  }]);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "这个角色为什么犹豫？",
    selection: null,
    status: "loading",
    streamedText: "",
  });
});

test("direct question with selection sends question and frozen selection", async () => {
  const state = new AiPanelState();
  const selection = snapshot("林站在天台边。");
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "这段里人物在隐瞒什么？",
    selection,
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(sent, [{
    kind: "direct_question",
    question: "这段里人物在隐瞒什么？",
    selected_text: "林站在天台边。",
  }]);
});

test("direct question with selection carries the frozen unsaved body snapshot", async () => {
  const state = new AiPanelState();
  const selection: SelectionSnapshot = {
    documentId: "draft",
    selectedText: "林站在天台边。",
    from: 0,
    to: 7,
    bodySnapshot: '{"format":"next-story-tiptap","version":2,"document":{"type":"doc"}}',
  };
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "这段里人物在隐瞒什么？",
    selection,
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(sent, [{
    kind: "direct_question",
    question: "这段里人物在隐瞒什么？",
    selected_text: "林站在天台边。",
    snapshot: '{"format":"next-story-tiptap","version":2,"document":{"type":"doc"}}',
  }]);
});

test("empty direct question is rejected without sending", async () => {
  const state = new AiPanelState();
  let sent = 0;

  assert.equal(startDirectQuestion({
    state,
    question: "   \n  ",
    selection: null,
    loadConfig: () => Promise.resolve(savedConfig),
    request: () => {
      sent += 1;
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), false);
  await Promise.resolve();

  assert.equal(sent, 0);
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("missing config routes direct question to configuration-required without sending", async () => {
  const state = new AiPanelState();
  let sent = 0;

  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: null,
    loadConfig: () => Promise.resolve(null),
    request: () => {
      sent += 1;
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent, 0);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection: null,
    status: "configuration_required",
  });
});

test("direct question keeps the frozen selection after the editor selection changes", async () => {
  const state = new AiPanelState();
  const submitted = snapshot("首次冻结选区");
  let currentEditorSelection: SelectionSnapshot = submitted;
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: currentEditorSelection,
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);

  currentEditorSelection = {
    documentId: "main",
    selectedText: "后来选中的正文本",
    from: 20,
    to: 28,
  };
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(currentEditorSelection.selectedText, "后来选中的正文本");
  assert.deepEqual(sent, [{
    kind: "direct_question",
    question: "问题",
    selected_text: "首次冻结选区",
  }]);
});

test("direct question preflight result is discarded when the project changes", async () => {
  const state = new AiPanelState();
  let projectToken = 1;
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  let sent = 0;

  assert.equal(startDirectQuestion({
    state,
    question: "旧作品问题",
    selection: snapshot("旧作品选区"),
    loadConfig: () => configPromise,
    request: () => {
      sent += 1;
      return Promise.resolve();
    },
    getProjectToken: () => projectToken,
  }), true);

  projectToken = 2;
  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent, 0, "不得把旧作品的直接提问作为请求发出");
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "旧作品问题",
    selection: snapshot("旧作品选区"),
    status: "loading",
    streamedText: "",
  });
});

test("blocked direct question (single-flight) reports an error without sending", async () => {
  const state = new AiPanelState();
  let requestAttempts = 0;

  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: null,
    loadConfig: () => Promise.resolve(savedConfig),
    request: () => {
      requestAttempts += 1;
      return null;
    },
    getProjectToken: () => 1,
  }), true);
  await Promise.resolve();
  await Promise.resolve();

  // 协调器被询问一次并拒绝（返回 null），不真正发起生成。
  assert.equal(requestAttempts, 1);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection: null,
    status: "error",
    error: { code: "network", message: "已有 AI 请求正在进行，本次请求没有发出。" },
  });
});

test("different discussions preflight concurrently without a shared gate", async () => {
  const state = new AiPanelState();
  const configDeferredA: { resolve: ((config: LlmConfigSummary | null) => void) | null } = { resolve: null };
  const configDeferredB: { resolve: ((config: LlmConfigSummary | null) => void) | null } = { resolve: null };
  const configPromiseA = new Promise<LlmConfigSummary | null>((resolve) => { configDeferredA.resolve = resolve; });
  const configPromiseB = new Promise<LlmConfigSummary | null>((resolve) => { configDeferredB.resolve = resolve; });
  let loadCalls = 0;
  const loadConfig = () => {
    loadCalls += 1;
    return loadCalls === 1 ? configPromiseA : configPromiseB;
  };
  const sent: string[] = [];

  // 讨论 A 直接提问预检挂起。
  assert.equal(startDirectQuestion({
    state,
    question: "问题A",
    selection: null,
    loadConfig,
    getProjectToken: () => 1,
    request: (req) => { sent.push(req.kind); return Promise.resolve(); },
  }), true);
  // 讨论 B 召唤预检：不因作品级门禁被拒绝，独立发起。
  assert.equal(startSummon({
    state,
    snapshot: snapshot("旧选区"),
    loadConfig,
    getProjectToken: () => 1,
    request: (req) => { sent.push(req.kind); return Promise.resolve(); },
  }), true);

  configDeferredA.resolve?.(savedConfig);
  configDeferredB.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent.length, 2, "不同讨论的首轮各自发送，互不阻塞");
});

test("a direct question preflight is not invalidated by newConversation and still sends", async () => {
  const state = new AiPanelState();
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  let sent = 0;

  assert.equal(startDirectQuestion({
    state,
    question: "旧问题",
    selection: null,
    loadConfig: () => configPromise,
    request: () => {
      sent += 1;
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);

  // 预检期间新建对话：不使原讨论的在途预检作废。
  assert.equal(state.newConversation(), true);
  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent, 1, "原讨论的预检照常发送，不因新建对话作废");
});

test("a direct question preflight still enters configuration-required after newConversation", async () => {
  const state = new AiPanelState();
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });

  assert.equal(startDirectQuestion({
    state,
    question: "旧问题",
    selection: null,
    loadConfig: () => configPromise,
    request: () => {
      throw new Error("request should not run");
    },
    getProjectToken: () => 1,
  }), true);

  state.newConversation();
  configDeferred.resolve?.(null);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const request = state.viewOf("1").request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "configuration_required", "配置引导作用于原讨论");
  }
});

test("a direct question preflight still surfaces a late loadConfig rejection after newConversation", async () => {
  const state = new AiPanelState();
  const configDeferred: { reject: ((error: Error) => void) | null } = {
    reject: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((_resolve, reject) => {
    configDeferred.reject = reject;
  });

  assert.equal(startDirectQuestion({
    state,
    question: "旧问题",
    selection: null,
    loadConfig: () => configPromise,
    request: () => {
      throw new Error("request should not run");
    },
    getProjectToken: () => 1,
  }), true);

  state.newConversation();
  configDeferred.reject?.(new Error("配置读取失败"));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const request = state.viewOf("1").request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "error", "迟到的预检失败作用于原讨论");
    assert.match(request.error?.message ?? "", /配置读取失败/);
  }
});

test("direct question with a hidden-document selection is not sent and shows a message", async () => {
  const state = new AiPanelState();
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "这段里人物在隐瞒什么？",
    selection: snapshot("隐藏文档选区"),
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
    checkSelectionAllowed: () => ({ allowed: false }),
  }), true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent.length, 0, "隐藏文档选区不得发送给 AI");
  const request = state.view.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "error");
    assert.match(request.error?.message ?? "", /不允许 AI 查看/);
  }
});

test("direct question without selection is unaffected by the visibility guard", async () => {
  const state = new AiPanelState();
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "这个角色为什么犹豫？",
    selection: null,
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
    checkSelectionAllowed: () => ({ allowed: false }),
  }), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent.length, 1, "无选区的直接提问不受可见性守卫影响");
  assert.deepEqual(sent, [{ kind: "direct_question", question: "这个角色为什么犹豫？" }]);
});

test("permission closed during preflight aborts before sending", async () => {
  const state = new AiPanelState();
  let visible = true;
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  const sent: GenerateAiRequest[] = [];

  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: snapshot("选区"),
    loadConfig: () => configPromise,
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
    checkSelectionAllowed: () => (visible ? { allowed: true } : { allowed: false }),
  }), true);

  // 预检期间（配置读取挂起时）关闭权限。
  visible = false;
  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent.length, 0, "发送前必须重新复核选区权限");
});

test("forged document identity cannot bypass the guard with bare text", async () => {
  const state = new AiPanelState();
  const sent: GenerateAiRequest[] = [];
  const tree = {
    root_children: ["doc-1"],
    nodes: {
      "doc-1": { id: "doc-1", name: "可见", kind: "Document" as const, children: [], ai_visible: true },
    },
    recycle_bin: [],
  };

  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: { documentId: "forged", selectedText: "裸选区文本", from: 0, to: 6 },
    loadConfig: () => Promise.resolve(savedConfig),
    request: (request) => {
      sent.push(request);
      return Promise.resolve();
    },
    getProjectToken: () => 1,
    checkSelectionAllowed: (snap) => checkSelectionVisibility(tree, snap),
  }), true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent.length, 0, "伪造身份的裸文本不得绕过授权");
});
