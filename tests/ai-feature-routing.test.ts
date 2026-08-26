import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGenerateError,
  openAiConfiguration,
  retryAcceptedRequest,
} from "../src/ai-feature.ts";
import {
  editAndResendFollowUpAcceptedRequest,
  followUpAcceptedRequest,
  retryFollowUpAcceptedRequest,
} from "../src/ai-feature-follow-up.ts";
import {
  buildThinkingExpansionRequest,
  createPreflightGate,
  startFirstRequest,
} from "../src/ai-feature-first-request.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import type {
  GenerateAiError,
  GenerateAiRequest,
  LlmConfigSummary,
  SelectionSnapshot,
} from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

test("routes configuration_required to the configuration panel state", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  const error: GenerateAiError = {
    code: "configuration_required",
    message: "请先配置",
  };

  // 首轮请求在途（预检预览）是合法的失败接收状态；纯 idle 空状态拒绝迟到结果。
  state.previewFirstRequest(snap);
  applyGenerateError(state, snap, error);

  assert.deepEqual(state.view.request, { kind: "configuration_required", snapshot: snap });
});

test("routes non-configuration failures to the ordinary error state", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  const error: GenerateAiError = { code: "authentication", message: "认证失败" };

  state.previewFirstRequest(snap);
  applyGenerateError(state, snap, error);

  assert.deepEqual(state.view.request, { kind: "error", snapshot: snap, error });
});

test("builds thinking expansion first request from frozen selection and trimmed direction", () => {
  const snap = snapshot("冻结选区");

  assert.deepEqual(buildThinkingExpansionRequest(snap, "  追人物的犹豫  "), {
    kind: "first",
    selected_text: "冻结选区",
    thinking_direction: "追人物的犹豫",
  });
});

test("builds thinking expansion first request without blank direction", () => {
  const snap = snapshot("冻结选区");

  assert.deepEqual(buildThinkingExpansionRequest(snap, "   \n  "), {
    kind: "first",
    selected_text: "冻结选区",
  });
});

test("first request preflight previews selection before requiring configuration", async () => {
  const state = new AiPanelState();
  const snap = snapshot("冻结选区");
  const observed: string[] = [];
  const trackedState = new AiPanelState(() => {
    observed.push(trackedState.view.request.kind);
  });

  assert.equal(startFirstRequest({
    state: trackedState,
    snapshot: snap,
    loadConfig: () => Promise.resolve(null),
    request: () => {
      throw new Error("request should not run without config");
    },
    getProjectToken: () => 1,
  }), true);
  await Promise.resolve();

  assert.deepEqual(observed, ["first_preview", "loading", "configuration_required"]);
  assert.deepEqual(trackedState.view.request, {
    kind: "configuration_required",
    snapshot: snap,
    conversationId: 1,
  });
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("discards the preflight result when the project changes during config loading", async () => {
  const state = new AiPanelState();
  const snap = snapshot("旧作品冻结选区");
  let projectToken = 1;
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  const preflight = createPreflightGate();
  let requestedSnapshot: SelectionSnapshot | null = null;

  assert.equal(startFirstRequest({
    state,
    snapshot: snap,
    loadConfig: () => configPromise,
    request: (requestSnapshot) => {
      requestedSnapshot = requestSnapshot;
      return Promise.resolve();
    },
    preflight,
    getProjectToken: () => projectToken,
  }), true);
  assert.equal(preflight.owner, 1, "预检进行中应锁定单飞");

  // 预检期间切换到作品 B：令牌变化后，迟到的配置结果必须被丢弃。
  projectToken = 2;
  configDeferred.resolve?.({ api_base_url: "https://api.example.com", model: "m", has_api_key: true });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requestedSnapshot, null, "不得把旧作品的冻结选区作为请求发出");
  assert.equal(preflight.owner, null);
  // 预检结果被丢弃：面板停留在预览态（作品切换后由应用层 reset），不进入 loading/error。
  assert.deepEqual(state.view.request, { kind: "first_preview", snapshot: snap });
});

test("preflight failure after a project switch is discarded too", async () => {
  const state = new AiPanelState();
  const snap = snapshot("旧作品冻结选区");
  let projectToken = 1;
  const configDeferred: { reject: ((error: Error) => void) | null } = {
    reject: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((_resolve, reject) => {
    configDeferred.reject = reject;
  });

  assert.equal(startFirstRequest({
    state,
    snapshot: snap,
    loadConfig: () => configPromise,
    request: () => {
      throw new Error("request should not run");
    },
    getProjectToken: () => projectToken,
  }), true);

  // 预检失败返回前作品已切换：失败结果同样丢弃，避免污染新作品的 AI 面板。
  projectToken = 2;
  configDeferred.reject?.(new Error("配置读取失败"));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(state.view.request, { kind: "first_preview", snapshot: snap });
});

test("a preflight invalidated by newConversation does not re-activate the cleared request", async () => {
  const state = new AiPanelState();
  const snap = snapshot("冻结选区");
  let requested = 0;
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });

  assert.equal(startFirstRequest({
    state,
    snapshot: snap,
    loadConfig: () => configPromise,
    request: () => {
      requested += 1;
      return Promise.resolve();
    },
    getProjectToken: () => 1,
  }), true);
  assert.equal(state.view.request.kind, "first_preview");

  // 预检期间用户新建对话：清空为空白直接提问状态
  assert.equal(state.newConversation(), true);
  assert.deepEqual(state.view.request, { kind: "idle" });

  // 随后预检返回有配置：不得重新激活已清空的请求
  configDeferred.resolve?.({ api_base_url: "https://api.example.com", model: "m", has_api_key: true });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requested, 0, "不得发送网络请求");
  assert.deepEqual(state.view.request, { kind: "idle" }, "面板保持空白直接提问状态");
});

test("a preflight invalidated by newConversation does not enter configuration-required on missing config", async () => {
  const state = new AiPanelState();
  const snap = snapshot("冻结选区");
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });

  assert.equal(startFirstRequest({
    state,
    snapshot: snap,
    loadConfig: () => configPromise,
    request: () => {
      throw new Error("request should not run without config");
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

test("a preflight invalidated by newConversation does not surface a late loadConfig rejection", async () => {
  const state = new AiPanelState();
  const snap = snapshot("冻结选区");
  const configDeferred: { reject: ((error: Error) => void) | null } = {
    reject: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((_resolve, reject) => {
    configDeferred.reject = reject;
  });

  assert.equal(startFirstRequest({
    state,
    snapshot: snap,
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

test("preflight gate is released when a preflight is invalidated by newConversation", async () => {
  const state = new AiPanelState();
  const snap = snapshot("冻结选区");
  const preflight = createPreflightGate();
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });

  assert.equal(startFirstRequest({
    state,
    snapshot: snap,
    loadConfig: () => configPromise,
    request: () => Promise.resolve(),
    preflight,
    getProjectToken: () => 1,
  }), true);
  assert.equal(preflight.owner, 1, "预检进行中应锁定单飞");

  state.newConversation();
  configDeferred.resolve?.({ api_base_url: "https://api.example.com", model: "m", has_api_key: true });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(preflight.owner, null, "finally 应释放预检门禁");
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("first request keeps the submitted snapshot after the editor selection changes", async () => {
  const state = new AiPanelState();
  const submitted = snapshot("首次冻结选区");
  let currentEditorSelection = submitted;
  let requestedSnapshot: SelectionSnapshot | null = null;
  let requestedPayload: GenerateAiRequest | null = null;

  assert.equal(startFirstRequest({
    state,
    snapshot: currentEditorSelection,
    loadConfig: () => Promise.resolve({
      api_base_url: "https://api.example.com",
      model: "test-model",
      has_api_key: true,
    }),
    request: (requestSnapshot, requestPayload) => {
      requestedSnapshot = requestSnapshot;
      requestedPayload = requestPayload ?? {
        kind: "first",
        selected_text: requestSnapshot.selectedText,
      };
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
  assert.deepEqual(requestedSnapshot, submitted);
  assert.deepEqual(requestedPayload, {
    kind: "first",
    selected_text: "首次冻结选区",
  });
});

test("thinking expansion keeps its prestate snapshot after editing and switching notebooks", () => {
  const state = new AiPanelState();
  const submitted = snapshot("扩展冻结选区");
  let currentEditorSelection: SelectionSnapshot = submitted;
  state.beginThinkingExpansion(submitted);

  currentEditorSelection = {
    documentId: "main",
    selectedText: "正文本当前选区",
    from: 9,
    to: 16,
  };

  const request = state.view.request;
  assert.equal(request.kind, "thinking_expansion");
  assert.equal(currentEditorSelection.documentId, "main");
  assert.deepEqual(request.snapshot, submitted);
  assert.deepEqual(buildThinkingExpansionRequest(request.snapshot, "追人物选择"), {
    kind: "first",
    selected_text: "扩展冻结选区",
    thinking_direction: "追人物选择",
  });
});

test("retry enters loading only when the coordinator accepts the request", () => {
  const state = new AiPanelState();
  const snap = snapshot("原选区");
  state.beginRequest(snap);
  state.fail(snap, { code: "network", message: "网络失败" });

  assert.equal(retryAcceptedRequest(state, () => null), false);
  assert.equal(state.view.request.kind, "error");

  assert.equal(retryAcceptedRequest(state, () => Promise.resolve()), true);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: snap,
    conversationId: 1,
    phase: "first",
  });
});

test("retry preserves the thinking expansion direction from the failed first request", () => {
  const state = new AiPanelState();
  const snap = snapshot("冻结选区");
  const firstRequest: GenerateAiRequest = {
    kind: "first",
    selected_text: "冻结选区",
    thinking_direction: "追人物的犹豫",
  };
  let retriedRequest: unknown = null;
  state.beginRequest(snap, firstRequest);
  state.fail(snap, { code: "network", message: "网络失败" });

  assert.equal(retryAcceptedRequest(state, (_snapshot, request) => {
    retriedRequest = request;
    return Promise.resolve();
  }), true);

  assert.deepEqual(retriedRequest, firstRequest);
});

test("first retry uses the failed request snapshot instead of the current editor selection", () => {
  const state = new AiPanelState();
  const submitted = snapshot("重试冻结选区");
  let currentEditorSelection: SelectionSnapshot = submitted;
  let retriedSnapshot: SelectionSnapshot | null = null;
  state.beginRequest(submitted);
  state.fail(submitted, { code: "network", message: "网络失败" });

  currentEditorSelection = {
    documentId: "main",
    selectedText: "重试时的新选区",
    from: 30,
    to: 38,
  };
  assert.equal(retryAcceptedRequest(state, (requestSnapshot) => {
    retriedSnapshot = requestSnapshot;
    return Promise.resolve();
  }), true);

  assert.equal(currentEditorSelection.documentId, "main");
  assert.deepEqual(retriedSnapshot, submitted);
});

test("builds a follow-up payload from the frozen anchor and successful turns exactly once", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("问题一");
  state.succeedFollowUp(1, "回答一");
  state.beginFollowUp("问题二");

  assert.deepEqual(state.followUpRequest(), {
    kind: "follow_up",
    selected_text: "冻结",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "问题一" },
      { role: "assistant", content: "回答一" },
      { role: "user", content: "问题二" },
    ],
  });
});

test("follow-up and its retry keep the conversation anchor after later editor changes", () => {
  const state = new AiPanelState();
  const submitted = snapshot("追问冻结选区");
  let currentEditorSelection: SelectionSnapshot = submitted;
  const payloads: GenerateAiRequest[] = [];
  state.beginRequest(submitted);
  state.succeed(submitted, "首答");

  currentEditorSelection = {
    documentId: "main",
    selectedText: "追问时的新选区",
    from: 40,
    to: 48,
  };
  assert.equal(followUpAcceptedRequest(state, "继续追问", (payload) => {
    payloads.push(payload);
    return Promise.resolve();
  }), true);
  assert.equal(state.failFollowUp(1, { code: "network", message: "网络失败" }), true);

  currentEditorSelection = snapshot("再次改变的草稿选区");
  assert.equal(retryFollowUpAcceptedRequest(state, (payload) => {
    payloads.push(payload);
    return Promise.resolve();
  }), true);

  assert.equal(currentEditorSelection.selectedText, "再次改变的草稿选区");
  assert.deepEqual(payloads, [
    {
      kind: "follow_up",
      selected_text: "追问冻结选区",
      messages: [
        { role: "assistant", content: "首答" },
        { role: "user", content: "继续追问" },
      ],
    },
    {
      kind: "follow_up",
      selected_text: "追问冻结选区",
      messages: [
        { role: "assistant", content: "首答" },
        { role: "user", content: "继续追问" },
      ],
    },
  ]);
});

test("preserves a failed follow-up as configuration-required without auto-requesting", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("需要配置的问题");

  assert.equal(state.requireFollowUpConfiguration(1), true);
  assert.deepEqual(state.view.request, {
    kind: "configuration_required",
    snapshot: anchor,
    conversationId: 1,
    turnId: 1,
  });
  assert.equal(state.retryFollowUpQuestion(), "需要配置的问题");
});

test("rejected follow-up retry preserves the failed question and original error", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("失败问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });

  assert.equal(retryFollowUpAcceptedRequest(state, () => null), false);
  assert.equal(state.retryFollowUpQuestion(), "失败问题");
  assert.equal(state.conversation?.pending?.error?.message, "网络失败");
  assert.equal(state.view.request.kind, "error");
});

test("rejected edit-resend preserves the old failed question and error atomically", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("旧问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });

  assert.equal(editAndResendFollowUpAcceptedRequest(state, "新问题", () => null), false);
  assert.equal(state.conversation?.pending?.question, "旧问题");
  assert.equal(state.conversation?.pending?.error?.message, "网络失败");
  assert.equal(state.retryFollowUpQuestion(), "旧问题");
});

test("accepted edit-resend sends the edited payload then commits question and loading", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("旧问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });
  let sentQuestion = "";

  assert.equal(editAndResendFollowUpAcceptedRequest(state, "新问题", (payload) => {
    if (payload.kind === "follow_up") {
      sentQuestion = payload.messages[payload.messages.length - 1].content;
    }
    return Promise.resolve();
  }), true);

  assert.equal(sentQuestion, "新问题");
  assert.equal(state.conversation?.pending?.question, "新问题");
  assert.equal(state.conversation?.pending?.error, undefined);
  assert.equal(state.view.request.kind, "loading");
});

test("direct question origin follow-up sends the full Q&A payload with origin", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("原问题", snapshot("冻结选区"));
  state.succeedDirectQuestion("首答");
  const payloads: GenerateAiRequest[] = [];

  assert.equal(followUpAcceptedRequest(state, "继续追问", (payload) => {
    payloads.push(payload);
    return Promise.resolve();
  }), true);

  assert.deepEqual(payloads, [{
    kind: "follow_up",
    selected_text: "冻结选区",
    origin: "direct_question",
    messages: [
      { role: "user", content: "原问题" },
      { role: "assistant", content: "首答" },
      { role: "user", content: "继续追问" },
    ],
  }]);
});

test("direct question origin follow-up retry preserves the failed question", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("原问题", null);
  state.succeedDirectQuestion("首答");
  state.beginFollowUp("失败问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });

  assert.equal(state.retryFollowUpQuestion(), "失败问题", "失败后保留原问题供重试");

  const payloads: GenerateAiRequest[] = [];
  assert.equal(retryFollowUpAcceptedRequest(state, (payload) => {
    payloads.push(payload);
    return Promise.resolve();
  }), true);

  assert.deepEqual(payloads, [{
    kind: "follow_up",
    selected_text: "",
    origin: "direct_question",
    messages: [
      { role: "user", content: "原问题" },
      { role: "assistant", content: "首答" },
      { role: "user", content: "失败问题" },
    ],
  }]);
});

test("opening configuration preserves conversation and never auto-fires a request", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("待配置问题");
  state.requireFollowUpConfiguration(1);
  const before = state.conversation;
  let opened = 0;

  openAiConfiguration(() => {
    opened += 1;
  });

  assert.equal(opened, 1);
  assert.deepEqual(state.conversation, before);
  assert.equal(state.retryFollowUpQuestion(), "待配置问题");
});
