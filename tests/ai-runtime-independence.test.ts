import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiRequestLifecycle } from "../src/ai-feature-request-lifecycle.ts";
import type { AiFeatureContext } from "../src/ai-feature-context.ts";
import type { AiRequestCoordinator } from "../src/ai-request.ts";
import type { AiRequestScheduler } from "../src/ai-request-scheduler.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import type { SelectionSnapshot } from "../src/types.ts";

/**
 * 单面板迁移（update-frontend-ui-v5）业务泳道回归：讨论运行期独立于显示窗口。
 *
 * 断言的行为合同（design/ai-panel-state-structure、resident-ai-session、
 * conversation-persistence、selection-ai-summon）：
 * - 崩溃恢复枚举所有有效讨论，不按当前可见窗口键；
 * - 隐藏/切换只改显示，不停止生成、不取消排队、不释放请求锁；
 * - 读档按讨论身份归入有效讨论，窗口关闭不丢弃；
 * - 重开已有运行期讨论不重新读盘覆盖；
 * - 文档切换清未发送实时选区，但保留该讨论草稿。
 */

function meaningfulSnapshot(documentId = "doc-1"): SelectionSnapshot {
  return {
    documentId,
    selectedText: "重点文字",
    from: 0,
    to: 4,
  };
}

/** 构建两个带运行期对话的讨论：窗口 "1" 可见，窗口 "2" 关闭后仅保留运行态。 */
function twoDiscussionsWithRuntime(): AiPanelState {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题一", null);
  state.succeedDirectQuestion("回答一");
  state.newConversation();
  state.beginDirectQuestion("问题二", null);
  state.succeedDirectQuestion("回答二");
  return state;
}

test("recoverableConversationIds enumerates all runtime discussions regardless of the current projection", () => {
  const state = twoDiscussionsWithRuntime();
  state.selectDiscussion("1"); // 当前投影为 1，讨论 2 不在当前投影

  const recoverable = state.recoverableConversationIds();

  assert.ok(recoverable.includes("1"));
  assert.ok(recoverable.includes("2"), "非当前投影的讨论仍在运行期，须纳入恢复枚举");
});

test("recoverableConversationIds excludes material-restricted discussions", () => {
  const state = twoDiscussionsWithRuntime();
  state.latchRestrictions(["1"]);

  const recoverable = state.recoverableConversationIds();

  assert.equal(recoverable.includes("1"), false, "受限讨论不得重放");
  assert.ok(recoverable.includes("2"));
});

test("hasRuntimeConversation detects runtime state independently of the projection", () => {
  const state = twoDiscussionsWithRuntime();
  state.selectDiscussion("1");

  assert.equal(state.hasRuntimeConversation("2"), true);
  assert.equal(state.hasRuntimeConversation("missing"), false);
});

test("selectDiscussion re-selects an existing runtime discussion without touching its conversation", () => {
  const state = twoDiscussionsWithRuntime();
  state.selectDiscussion("1"); // 先切到另一讨论，使选择 2 成为有效迁移

  const before = state.getDiscussion("2")?.conversation;
  assert.ok(before);

  assert.equal(state.selectDiscussion("2"), true);
  assert.equal(state.activeConversationId, "2", "成为当前投影");
  assert.equal(state.getDiscussion("2")?.conversation, before, "运行期对话对象未被覆盖");

  assert.equal(state.selectDiscussion("missing"), false);
});

test("isOpeningValid stays valid across hide/switch and invalidates on delete", () => {
  const state = new AiPanelState();
  const token = state.beginOpenDiscussion("archive");

  assert.equal(state.isOpeningValid("archive", token), true);
  state.close();

  assert.equal(state.isOpeningValid("archive", token), true, "隐藏只改显示，不使读档失效");
  assert.equal(state.isOpeningValid("archive", undefined), false);

  state.deleteDiscussion("archive");
  assert.equal(state.isOpeningValid("archive", token), false, "删除使读档失效");
});

test("clearUnsentSelection drops the live selection but keeps the per-discussion draft", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("已发送问题", null);
  state.succeedDirectQuestion("回答");
  // 成功后再输入未发送草稿（真实使用中草稿属于已建立的讨论）。
  state.updateDirectQuestionDraft("1", "未发送草稿");
  state.setPendingSelection(meaningfulSnapshot());

  assert.ok(state.view.pendingSelection);

  state.clearUnsentSelection();

  assert.equal(state.view.pendingSelection, null, "未发送实时选区被清除");
  assert.equal(state.view.directQuestionDraft, "未发送草稿", "该讨论草稿保留");
});

interface LifecycleHarness {
  readonly context: AiFeatureContext;
  readonly calls: { cancelQueued: number; cancelMessage: number; coordinatorCancel: number };
  readonly state: AiPanelState;
}

function lifecycleHarness(): LifecycleHarness {
  const state = new AiPanelState();
  const calls = { cancelQueued: 0, cancelMessage: 0, coordinatorCancel: 0 };
  const scheduler = {
    cancelQueued: () => { calls.cancelQueued += 1; },
    cancelAllQueued: () => {},
  } as unknown as AiRequestScheduler;
  const coordinator = {
    cancel: () => { calls.coordinatorCancel += 1; },
    releaseStaleRequestOwnership: () => {},
  } as unknown as AiRequestCoordinator;
  const transport = {
    cancelMessage: () => { calls.cancelMessage += 1; },
    endSession: () => {},
    endAllSessions: () => {},
  } as unknown as AiSessionTransport;
  const context = {
    state,
    getScheduler: () => scheduler,
    getCoordinator: () => coordinator,
    getTransport: () => transport,
    isDestroyed: () => false,
    getProjectToken: () => 0,
  } as unknown as AiFeatureContext;
  return { context, calls, state };
}

function lifecycle(h: LifecycleHarness) {
  return setupAiRequestLifecycle({
    context: h.context,
    persistDiscussion: () => {},
    persistCurrentDiscussion: () => {},
    requestStructured: () => null,
    requestSummon: () => null,
    requestDirectQuestion: () => null,
  });
}

test("hiding the panel does not cancel queued or in-flight generation", () => {
  const h = lifecycleHarness();
  h.state.beginDirectQuestion("进行中的问题", null);

  lifecycle(h).closeWindow("1");

  assert.equal(h.state.isOpen, false, "面板收起");
  assert.equal(h.state.view.request.kind, "direct_question", "在途请求仍在");
  assert.equal(h.calls.cancelQueued, 0, "隐藏不得取消排队");
  assert.equal(h.calls.cancelMessage, 0, "隐藏不得取消在途生成");
  assert.equal(h.calls.coordinatorCancel, 0, "隐藏不得释放请求锁");
});

test("explicit stop still cancels queued and in-flight generation and marks the turn stopped", () => {
  const h = lifecycleHarness();
  h.state.beginDirectQuestion("进行中的问题", null);

  lifecycle(h).stopGeneration("1");

  assert.equal(h.calls.cancelQueued, 1, "显式停止取消排队");
  assert.equal(h.calls.cancelMessage, 1, "显式停止取消在途生成");
  assert.equal(h.calls.coordinatorCancel, 1, "显式停止释放请求锁");
  assert.equal(h.state.view.request.kind, "direct_question");
  if (h.state.view.request.kind === "direct_question") {
    assert.equal(h.state.view.request.status, "stopped");
  }
});
