import assert from "node:assert/strict";
import test from "node:test";

import { resolveConversationIdentity } from "../src/ai-conversation-identity.ts";

/**
 * 讨论身份解析直测（change: app-real-chain-validation 任务 6.5，design D7）：
 * 守卫语义镜像后端 `ai_send_message` 的 `!trim().is_empty()` 检查——任一为空白
 * 即返回 null（不携带，后端清路由）。
 */

test("resolves identity when both conversation id and project path are present", () => {
  assert.deepEqual(resolveConversationIdentity("c-1", "C:/作品"), {
    conversationId: "c-1",
    conversationProjectPath: "C:/作品",
  });
});

test("keeps surrounding whitespace in resolved values (guard reads trim, does not rewrite)", () => {
  assert.deepEqual(resolveConversationIdentity(" c-1 ", " C:/作品 "), {
    conversationId: " c-1 ",
    conversationProjectPath: " C:/作品 ",
  });
});

test("returns null when either value is blank (including whitespace-only)", () => {
  assert.equal(resolveConversationIdentity("", "C:/作品"), null);
  assert.equal(resolveConversationIdentity("c-1", ""), null);
  assert.equal(resolveConversationIdentity("   ", "C:/作品"), null, "纯空格的讨论 id 视为空白");
  assert.equal(resolveConversationIdentity("c-1", "   "), null, "纯空格的作品路径视为空白");
  assert.equal(resolveConversationIdentity("   ", "   "), null);
});

test("returns null when either value is null or undefined", () => {
  assert.equal(resolveConversationIdentity(null, "C:/作品"), null);
  assert.equal(resolveConversationIdentity(undefined, "C:/作品"), null);
  assert.equal(resolveConversationIdentity("c-1", null), null);
  assert.equal(resolveConversationIdentity("c-1", undefined), null);
  assert.equal(resolveConversationIdentity(null, undefined), null);
  assert.equal(resolveConversationIdentity(undefined, null), null);
});
