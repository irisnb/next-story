import assert from "node:assert/strict";
import test from "node:test";

import { generateAiThinking, type InvokeFn } from "../src/project-api.ts";
import type {
  GenerateAiMessage,
  GenerateAiRequest,
  GenerateAiResult,
} from "../src/types.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type _FrontendCannotSubmitSystemRole = Assert<
  Equal<GenerateAiMessage["role"], "user" | "assistant">
>;

/** 记录每次调用的假 invoke。 */
function fakeInvoke() {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const invoke: InvokeFn = (cmd, args) => {
    calls.push({ cmd, args: args ?? {} });
    const ok: GenerateAiResult = { ok: true, content: "思考" };
    return Promise.resolve(ok as never);
  };
  return { invoke, calls };
}

test("sends a structured first request with only the frozen selection", async () => {
  const { invoke, calls } = fakeInvoke();
  const request: GenerateAiRequest = {
    kind: "first",
    selected_text: "背叛",
  };
  const result = await generateAiThinking(request, invoke);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "generate_ai_thinking");

  const args = calls[0].args;
  assert.deepEqual(args.request, request);
  assert.equal("selectedText" in args, false);
  assert.equal("selected_text" in args, false);
  // 不携带任何草稿本 / 正文本 / 保存命令参数
  assert.equal("draftContent" in args, false);
  assert.equal("mainContent" in args, false);
  assert.equal("saveProject" in args, false);
  assert.equal("api_key" in args, false);
  assert.equal("notebook" in args, false);

  assert.deepEqual(result, { ok: true, content: "思考" });
});

test("newlines and spaces in the selection are passed through unchanged", async () => {
  const { invoke, calls } = fakeInvoke();
  await generateAiThinking(
    { kind: "first", selected_text: " 前后有空格 \n 换行 " },
    invoke,
  );
  assert.deepEqual(calls[0].args.request, {
    kind: "first",
    selected_text: " 前后有空格 \n 换行 ",
  });
});

test("sends all successful turns and the current follow-up exactly once", async () => {
  const { invoke, calls } = fakeInvoke();
  const request: GenerateAiRequest = {
    kind: "follow_up",
    selected_text: "冻结选区",
    messages: [
      { role: "assistant", content: "首次回应" },
      { role: "user", content: "第一个问题" },
      { role: "assistant", content: "第一个回答" },
      { role: "user", content: "当前问题" },
    ],
  };

  await generateAiThinking(request, invoke);

  assert.deepEqual(calls[0].args, { request });
  const serialized = JSON.stringify(calls[0].args);
  assert.equal(serialized.match(/当前问题/g)?.length, 1);
  assert.equal(serialized.includes('"role":"system"'), false);
});

test("propagates a structured failure without leaking notebooks or save calls", async () => {
  let saveProjectSeen = false;
  const invoke: InvokeFn = (cmd, args) => {
    if (cmd === "save_project") saveProjectSeen = true;
    const failure: GenerateAiResult = {
      ok: false,
      error: { code: "authentication", message: "认证失败" },
    };
    return Promise.resolve(failure as never);
  };

  const result = await generateAiThinking(
    { kind: "first", selected_text: "x" },
    invoke,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "authentication");
  }
  assert.equal(saveProjectSeen, false, "生成链路不得调用保存命令");
});
