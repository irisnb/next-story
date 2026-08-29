import assert from "node:assert/strict";
import test from "node:test";

import { startDirectQuestion } from "../src/ai-feature-direct-question.ts";
import { createPreflightGate, startFirstRequest } from "../src/ai-feature-first-request.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
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

test("direct question preflight holds the shared gate and blocks a first-request preflight", async () => {
  const state = new AiPanelState();
  const preflight = createPreflightGate();
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  let sent = 0;

  // 直接提问预检开始（配置加载挂起）
  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: null,
    loadConfig: () => configPromise,
    request: () => { sent += 1; return Promise.resolve(); },
    getProjectToken: () => 1,
    preflight,
  }), true);
  assert.equal(preflight.owner, 1, "直接提问预检应占用共享门禁");

  // 预检期间发起旧选区首轮预检：应被门禁拒绝
  assert.equal(startFirstRequest({
    state,
    snapshot: snapshot("旧选区"),
    loadConfig: () => Promise.resolve(savedConfig),
    request: () => { sent += 1; return Promise.resolve(); },
    preflight,
    getProjectToken: () => 1,
  }), false, "门禁被占用时首轮预检应被拒绝");

  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(preflight.owner, null, "完成后应释放门禁");
  assert.equal(sent, 1, "只有直接提问真正发送");
});

test("direct question preflight is rejected when another first-round preflight holds the gate", async () => {
  const state = new AiPanelState();
  const preflight = createPreflightGate();
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  let sent = 0;

  // 旧选区首轮预检先开始（配置加载挂起）
  assert.equal(startFirstRequest({
    state,
    snapshot: snapshot("旧选区"),
    loadConfig: () => configPromise,
    request: () => { sent += 1; return Promise.resolve(); },
    preflight,
    getProjectToken: () => 1,
  }), true);
  assert.equal(preflight.owner, 1);

  // 门禁被占用时直接提问应被拒绝，且不进入 loading
  assert.equal(startDirectQuestion({
    state,
    question: "问题",
    selection: null,
    loadConfig: () => Promise.resolve(savedConfig),
    request: () => { sent += 1; return Promise.resolve(); },
    getProjectToken: () => 1,
    preflight,
  }), false, "门禁被占用时直接提问应被拒绝");
  assert.equal(state.view.request.kind, "first_preview", "直接提问不应污染首轮预检状态");

  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(preflight.owner, null);
  assert.equal(sent, 1, "只有首轮预检真正发送");
});

test("a direct question preflight invalidated by newConversation does not send the cleared request", async () => {
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
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "旧问题",
    selection: null,
    status: "loading",
    streamedText: "",
  });

  // 预检期间用户新建对话：清空为空白直接提问状态
  assert.equal(state.newConversation(), true);
  assert.deepEqual(state.view.request, { kind: "idle" });

  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(sent, 0, "不得发送已清空的直接提问");
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("a direct question preflight invalidated by newConversation does not enter configuration-required", async () => {
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

  assert.deepEqual(state.view.request, { kind: "idle" }, "不得进入配置引导状态");
});

test("a direct question preflight invalidated by newConversation does not surface a late loadConfig rejection", async () => {
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

  assert.deepEqual(state.view.request, { kind: "idle" }, "迟到的预检失败不得污染空状态");
});

test("preflight gate is released when a direct question preflight is invalidated by newConversation", async () => {
  const state = new AiPanelState();
  const preflight = createPreflightGate();
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
    request: () => Promise.resolve(),
    getProjectToken: () => 1,
    preflight,
  }), true);
  assert.equal(preflight.owner, 1, "预检进行中应锁定单飞");

  state.newConversation();
  configDeferred.resolve?.(savedConfig);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(preflight.owner, null, "finally 应释放预检门禁");
  assert.deepEqual(state.view.request, { kind: "idle" });
});
