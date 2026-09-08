// isolation.mjs — 会话与请求隔离的事件路由（change: dsh-capability-integration-validation 任务 4.1/4.2/4.3）
//
// 事件按 sessionId + requestId 身份路由；取消/失败/超时/迟到不污染其他请求、其他作品或新请求。
// 未知请求身份被记录为无效，不改变任何活动请求状态（design.md D2）。
// 本模块纯内存状态机，无网络、无文件写入，可在任意注入事件下确定性验证。
import { requestKey, validateRequestIdentity } from "./identity.mjs";

const REQUEST_TERMINAL_STATES = new Set(["completed", "cancelled", "failed"]);

export function createIsolationRegistry() {
  return {
    requests: new Map(), // requestKey -> { identity, state, events, text, tools }
    invalidEvents: [],   // 未知请求身份事件（记录为无效）
    lateEvents: [],      // 已结束请求的迟到事件（记录为迟到，不投递）
  };
}

/** 注册一个活动请求。身份不完整或重复注册返回失败。 */
export function registerRequest(registry, identity) {
  const v = validateRequestIdentity(identity);
  if (!v.ok) return { ok: false, reason: "invalid_identity", errors: v.errors };
  const key = requestKey(identity);
  if (registry.requests.has(key)) return { ok: false, reason: "already_registered", key };
  registry.requests.set(key, { identity, state: "active", events: [], text: [], tools: [] });
  return { ok: true, key };
}

/**
 * 投递一个事件（须携带 sessionId + requestId）。
 * 返回 { outcome, key?, requestState?, reason? }：
 *   delivered      活动请求收到事件
 *   unknown_request 请求身份不存在（记录为无效，不改变任何活动请求）
 *   late_request   请求已结束（记录为迟到，不投递、不改变状态）
 *   invalid_event  事件缺 session/request 标识
 */
export function deliverEvent(registry, event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return { outcome: "invalid_event", reason: "event_must_be_object" };
  }
  const { sessionId, requestId } = event;
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return { outcome: "invalid_event", reason: "missing_session_id" };
  }
  if (typeof requestId !== "string" || requestId.trim() === "") {
    return { outcome: "invalid_event", reason: "missing_request_id" };
  }
  const key = requestKey({ sessionId, requestId });
  const req = registry.requests.get(key);
  if (!req) {
    registry.invalidEvents.push({ event, reason: "unknown_request_identity" });
    return { outcome: "unknown_request", key };
  }
  if (req.state !== "active") {
    registry.lateEvents.push({ event, requestState: req.state });
    return { outcome: "late_request", key, requestState: req.state };
  }
  req.events.push(event);
  if (event.kind === "text") req.text.push(event);
  else if (event.kind === "tool") req.tools.push(event);
  return { outcome: "delivered", key };
}

/** 将请求置为终态（completed/cancelled/failed）。 */
export function finishRequest(registry, identity, state) {
  if (!REQUEST_TERMINAL_STATES.has(state)) {
    return { ok: false, reason: "invalid_terminal_state", state };
  }
  const key = requestKey(identity);
  const req = registry.requests.get(key);
  if (!req) return { ok: false, reason: "unknown_request", key };
  if (req.state !== "active") return { ok: false, reason: "already_terminal", key, state: req.state };
  req.state = state;
  return { ok: true, key, state };
}

export function cancelRequest(registry, identity) {
  return finishRequest(registry, identity, "cancelled");
}

export function isActive(registry, identity) {
  const req = registry.requests.get(requestKey(identity));
  return Boolean(req && req.state === "active");
}

export function requestStateOf(registry, identity) {
  const req = registry.requests.get(requestKey(identity));
  return req ? req.state : null;
}

/** 返回该请求已投递的事件副本。 */
export function eventsFor(registry, identity) {
  const req = registry.requests.get(requestKey(identity));
  return req ? [...req.events] : [];
}
