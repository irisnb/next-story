import assert from "node:assert/strict";
import test from "node:test";

import { generateAiThinking, type InvokeFn } from "../src/project-api.ts";
import type { GenerateAiResult } from "../src/types.ts";

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

test("sends only the selected text to the generate command", async () => {
  const { invoke, calls } = fakeInvoke();
  const result = await generateAiThinking("背叛", invoke);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "generate_ai_thinking");

  const args = calls[0].args;
  assert.equal(args.selectedText, "背叛");
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
  await generateAiThinking(" 前后有空格 \n 换行 ", invoke);
  assert.equal(calls[0].args.selectedText, " 前后有空格 \n 换行 ");
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

  const result = await generateAiThinking("x", invoke);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "authentication");
  }
  assert.equal(saveProjectSeen, false, "生成链路不得调用保存命令");
});
