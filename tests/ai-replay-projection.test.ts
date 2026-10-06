import assert from "node:assert/strict";
import test from "node:test";

import { historyTurnsOf, originOf } from "../src/ai-feature.ts";
import type { ReadonlyTemporaryConversation } from "../src/ai-panel-conversation.ts";
import type { AiReplayTurn } from "../src/ai-session-transport.ts";

/**
 * 信封分层后的重放投影（wire-system-prompt-channel 任务 3.1/3.2）：
 * 标签与后端首轮 user 组装一致（direct_question_user_content /
 * summon_user_content），重放首轮不再拼提示词前缀，也不携带任何制度性条款。
 */

function conversationOf(
  initialUserMaterial: ReadonlyTemporaryConversation["initialUserMaterial"],
  turns: ReadonlyArray<{ question: string; response: string }>,
  firstResponse = "首轮回应",
): ReadonlyTemporaryConversation {
  return {
    initialUserMaterial,
    firstResponse,
    turns,
  } as unknown as ReadonlyTemporaryConversation;
}

test("直接提问投影：标签与后端 direct_question_user_content 一致，无提示词前缀", () => {
  const turns = historyTurnsOf(
    conversationOf(
      { kind: "direct_question", question: "这个角色为什么犹豫？", selected_text: "林站在天台边，没有回头。" },
      [{ question: "他为什么离开？", response: "可能是愧疚。" }],
    ),
  );

  const first = turns[0] as { role: string; text: string };
  assert.equal(first.role, "user");
  assert.equal(
    first.text,
    "用户问题：\n这个角色为什么犹豫？\n\n重点参考材料（可选）：\n林站在天台边，没有回头。",
    "首轮 user 文本＝后端 direct_question_user_content 的标签组装",
  );
  assert.deepEqual(
    turns.slice(1),
    [
      { role: "assistant", text: "首轮回应" },
      { role: "user", text: "他为什么离开？" },
      { role: "assistant", text: "可能是愧疚。" },
    ] satisfies AiReplayTurn[],
    "首轮回应与追问轮次按原样投影",
  );
});

test("直接提问无选区投影：只有问题标签", () => {
  const turns = historyTurnsOf(
    conversationOf({ kind: "direct_question", question: "这段怎么办？", selected_text: undefined }, []),
  );
  assert.equal(turns[0]?.text, "用户问题：\n这段怎么办？");
  assert.ok(!turns[0]?.text.includes("重点参考材料"), "无选区不得出现材料标签");
});

test("及时召唤投影：裸选区原文，无任何标签（与后端 summon_user_content 一致）", () => {
  const turns = historyTurnsOf(
    conversationOf({ kind: "summon", selected_text: "林站在天台边。" }, []),
  );
  assert.equal(turns[0]?.role, "user");
  assert.equal(turns[0]?.text, "林站在天台边。");
  assert.ok(
    !turns[0]?.text.includes("重点参考材料"),
    "召唤投影不得再携带「重点参考材料」标签（后端召唤首轮无标签）",
  );
  assert.ok(
    !turns[0]?.text.includes("用户问题："),
    "召唤投影不得出现直接提问的问题标签",
  );
});

test("重放投影不携带制度性条款（禁止双份投递，信封由 start_session 携带）", () => {
  const direct = historyTurnsOf(
    conversationOf({ kind: "direct_question", question: "问题", selected_text: "材料" }, []),
  );
  const summon = historyTurnsOf(
    conversationOf({ kind: "summon", selected_text: "材料" }, []),
  );
  for (const turns of [direct, summon]) {
    const text = turns.map((turn) => turn.text).join("\n");
    for (const institutional of [
      "你是陪伴剧本创作者思考与探索的助手",
      "不直接修改用户文档",
      "当前请求提供用户直接提出的问题",
      "当前请求只提供冻结选区原文",
      "story-request-reading",
    ]) {
      assert.ok(
        !text.includes(institutional),
        `重放投影不得携带制度性或前缀文本：${institutional}`,
      );
    }
  }
});

test("originOf：按首轮材料来源返回（命令面历史兼容参数）", () => {
  assert.equal(
    originOf(conversationOf({ kind: "direct_question", question: "q", selected_text: undefined }, [])),
    "direct_question",
  );
  assert.equal(
    originOf(conversationOf({ kind: "summon", selected_text: "s" }, [])),
    "summon",
  );
});
