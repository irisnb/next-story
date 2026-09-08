// identity.mjs — 验证运行的身份模型（change: dsh-capability-integration-validation 任务 1.2）
//
// 每次验证运行携带作品身份、讨论/会话身份、轮次、消息身份和请求身份。
// 事件路由按 sessionId + requestId 匹配，不能只依赖易重复的局部消息编号（design.md D2）。
// 本模块只做纯函数身份构造与校验，不发送消息、不写文件、不生成网络请求。
import { randomUUID } from "node:crypto";

const REQUIRED_STRING_FIELDS = ["workId", "discussionId", "sessionId", "messageId", "requestId"];

/**
 * 构造一次验证运行的请求身份。requestId 缺省时生成唯一标识（randomUUID）。
 * 不校验字段完整性——完整性由 validateRequestIdentity 显式负责，便于分离构造与校验。
 */
export function createRequestIdentity(fields = {}) {
  const f = fields ?? {};
  const requestId = (typeof f.requestId === "string" && f.requestId.trim() !== "") ? f.requestId : randomUUID();
  return Object.freeze({
    workId: f.workId ?? null,
    discussionId: f.discussionId ?? null,
    sessionId: f.sessionId ?? null,
    turn: f.turn ?? null,
    messageId: f.messageId ?? null,
    requestId,
  });
}

/** 校验身份完整性。返回 { ok, errors }；errors 为人类可读说明数组。 */
export function validateRequestIdentity(identity) {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    return { ok: false, errors: ["身份必须是对象"] };
  }
  const errors = [];
  for (const f of REQUIRED_STRING_FIELDS) {
    if (typeof identity[f] !== "string" || identity[f].trim() === "") {
      errors.push(`缺少身份字段 ${f}（非空字符串）`);
    }
  }
  if (!Number.isInteger(identity.turn) || identity.turn <= 0) {
    errors.push("turn 必须是正整数轮次");
  }
  return { ok: errors.length === 0, errors };
}

/** 事件路由键：sessionId + requestId，用不可见分隔符拼接，避免误并。 */
export function requestKey(identity) {
  return `${identity?.sessionId ?? ""}\u0000${identity?.requestId ?? ""}`;
}

/** 两个身份是否指向同一请求（session + request 都相同）。 */
export function isSameRequest(a, b) {
  return Boolean(a && b && a.sessionId === b.sessionId && a.requestId === b.requestId);
}

/** 两个身份是否属于同一会话。 */
export function isSameSession(a, b) {
  return Boolean(a && b && a.sessionId === b.sessionId);
}
