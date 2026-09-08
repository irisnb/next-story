// tool-lifecycle.mjs — 工具调用生命周期与终态闸门（change: dsh-capability-integration-validation 任务 3.1/3.4）
//
// 记录工具调用开始、成功、失败、用户确认等待/确认/拒绝、取消、超时；每个调用只允许一个终态。
// 取消或超时后的迟到结果记录为 late，不重新打开调用、不改变终态（design.md D3）。
// 本模块纯函数，无 IO。
export const TOOL_TERMINAL_STATES = Object.freeze(["succeeded", "failed", "denied", "cancelled", "timed_out"]);

// 非终态 → 合法事件集合（终态后任何结果事件都按迟到处理）
const TRANSITIONS = {
  started: ["user_confirmation_wait", "tool_success", "tool_failure", "tool_cancel", "tool_timeout"],
  waiting_confirmation: ["user_confirmation_confirm", "user_confirmation_reject", "tool_cancel", "tool_timeout"],
};

// 事件 → 目标状态
const NEXT_STATE = {
  user_confirmation_wait: "waiting_confirmation",
  user_confirmation_confirm: "started",
  user_confirmation_reject: "denied",
  tool_success: "succeeded",
  tool_failure: "failed",
  tool_cancel: "cancelled",
  tool_timeout: "timed_out",
};

export function isTerminalState(state) {
  return TOOL_TERMINAL_STATES.includes(state);
}

export function isTerminalInvocation(invocation) {
  return isTerminalState(invocation?.state);
}

/** 返回当前终态字符串；非终态返回 null。 */
export function terminalStateOf(invocation) {
  return isTerminalInvocation(invocation) ? invocation.state : null;
}

/** 构造一个工具调用，初始状态 started，已记录 tool_start 事件。 */
export function createToolInvocation({ requestId, toolId, tool, capability, startedAt = null }) {
  return {
    requestId,
    toolId,
    tool,
    capability,
    state: "started",
    events: [{ type: "tool_start", tool, capability, at: startedAt }],
    lateResults: [],
  };
}

/**
 * 对一次工具调用应用一个生命周期事件。
 * 返回 { invocation, outcome, error? }：
 *   outcome = "applied" 状态正常推进
 *   outcome = "late"    已是终态，事件作为迟到结果记录（不改变终态）
 *   outcome = "invalid" 当前状态不允许该事件，状态不变
 */
export function applyToolEvent(invocation, event) {
  if (isTerminalInvocation(invocation)) {
    return {
      invocation: { ...invocation, lateResults: [...invocation.lateResults, event] },
      outcome: "late",
    };
  }
  const valid = (TRANSITIONS[invocation.state] ?? []).includes(event?.type);
  if (!valid) {
    return { invocation, outcome: "invalid", error: `event ${event?.type} invalid from state ${invocation.state}` };
  }
  const next = { ...invocation, state: NEXT_STATE[event.type], events: [...invocation.events, event] };
  return { invocation: next, outcome: "applied" };
}
