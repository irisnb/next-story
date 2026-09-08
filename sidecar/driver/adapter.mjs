// adapter.mjs — 确定性 DSH 驱动适配器（验证专用，change: dsh-capability-integration-validation）
//
// 与 driver.mjs 使用同一套行分隔 JSON 协议面，但不启动真实 DSH 容器、不调用真实模型/API。
// 它是「可控替身」：用确定性文本流 + 结构化工具事件模拟 Agent Loop 的只读读取往返，
// 供验证 harness 在无 API key、无实机 DSH 的环境里重复运行协议、权限、终态与隔离断言。
//
// 覆盖：只读工具请求、结构化工具事件（tool_start / user_confirmation_wait / confirm /
// reject / tool_success / tool_failure）、确认等待与决策、授权读取后的同轮继续，
// 以及真实 DSH 事件字段不可观测时的明确降级结果（observe()）。
//
// 安全边界：本适配器只复用 validation/allowlist.mjs 的 default-deny 授权与
// validation/bridge.mjs 的受控只读材料边界，绝不暴露文件系统 / Shell / 网络 / 写入工具，
// 也绝不触碰生产 cordis.driver.yaml（生产默认拒绝配置原样保留，见 config-guard.test.mjs）。
//
// 本模块纯内存、确定性、无 IO、无网络。可作为 import 使用，也可直接作为进程入口（仅本文件被
// node 直接执行时进入 CLI 行协议模式）。

import { randomUUID } from "node:crypto";

import { createIsolationRegistry, registerRequest, finishRequest } from "../validation/isolation.mjs";
import { requestKey } from "../validation/identity.mjs";
import { createToolInvocation, applyToolEvent } from "../validation/tool-lifecycle.mjs";
import { authorizeReadTool, readMaterial, listAllowedDocuments } from "../validation/bridge.mjs";
import { STORY_FIXTURE } from "../validation/fixtures/story-fixture.mjs";

export const PROTOCOL_VERSION = 1;

const DELTA_CHUNK = 6;

// ── 确定性替身的文本生成（不依赖真实模型）────────────────────────────────────
function deterministicReply(text) {
  const clipped = (text ?? "").trim().slice(0, 40);
  return `（确定性替身）已收到问题「${clipped}」。这是不依赖真实模型的占位回应。`;
}

function successContinuation(material) {
  return `已读取《${material.documentName}》并继续生成回应。`;
}

function listContinuation(documents) {
  return `已列出 ${documents.length} 篇文档并继续生成回应。`;
}

function denialContinuation(reason) {
  return `未能读取该材料（${reason}）。`;
}

// ── 工厂 ─────────────────────────────────────────────────────────────────────
export function createDeterministicAdapter(options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : () => Date.now();

  const sessions = new Map(); // session_id -> session
  const registry = createIsolationRegistry();
  const approvals = new Map(); // session_id + request_id -> pending approval state
  const seq = { value: 0 };

  function newSession(id, systemPrompt = "") {
    return {
      id, systemPrompt, busy: null, seedTurns: [], turnHistory: [], turnNo: 1,
    };
  }

  function toolEvent(session, cmd, inv, eventType, extra = {}) {
    return {
      type: "tool_event",
      session_id: session.id,
      request_id: cmd.request_id,
      message_id: cmd.message_id,
      tool: cmd.tool,
      capability: inv.capability,
      state: inv.state,
      event: eventType,
      at: clock(),
      ...extra,
      synthetic: true,
      observed: false,
    };
  }

  function emitDeltas(emit, session, messageId, text) {
    for (let i = 0; i < text.length; i += DELTA_CHUNK) {
      emit({
        type: "delta", session_id: session.id, message_id: messageId,
        seq: seq.value++, text: text.slice(i, i + DELTA_CHUNK),
      });
    }
  }

  function emitDeltasAndDone(emit, session, messageId, text) {
    emitDeltas(emit, session, messageId, text);
    emit({ type: "message_done", session_id: session.id, message_id: messageId, text });
  }

  function resolveToolResult(tool, args) {
    const workId = args?.workId ?? STORY_FIXTURE.mainWorkId;
    if (tool === "story.list") {
      return listAllowedDocuments(STORY_FIXTURE, workId);
    }
    if (tool === "story.read_document") {
      return readMaterial(STORY_FIXTURE, {
        workId, documentId: args?.documentId,
        expectedVersion: args?.expectedVersion ?? null,
        range: args?.range ?? null,
      });
    }
    if (tool === "story.read_snapshot") {
      return readMaterial(STORY_FIXTURE, {
        workId, documentId: args?.documentId,
        expectedVersion: args?.expectedVersion ?? null,
        snapshot: args?.snapshot ?? null,
      });
    }
    return { ok: false, denial: { reason: "unknown_capability" } };
  }

  // 授权读取完成后的同轮继续 / 结构化拒绝。
  function finishToolRead(emit, session, cmd, inv, identity, tool, args) {
    const result = resolveToolResult(tool, args);
    if (result.ok) {
      const r = applyToolEvent(inv, { type: "tool_success" });
      inv = r.invocation;
      emit(toolEvent(session, cmd, inv, "tool_success"));
      if (tool === "story.list") {
        emit({
          type: "tool_list", session_id: session.id, request_id: cmd.request_id, message_id: cmd.message_id,
          documents: result.documents, synthetic: true, observed: false,
        });
        emitDeltasAndDone(emit, session, cmd.message_id, listContinuation(result.documents));
      } else {
        emit({
          type: "tool_material", session_id: session.id, request_id: cmd.request_id, message_id: cmd.message_id,
          material: result.material, synthetic: true, observed: false,
        });
        emitDeltasAndDone(emit, session, cmd.message_id, successContinuation(result.material));
      }
      finishRequest(registry, identity, "completed");
      return;
    }
    const r = applyToolEvent(inv, { type: "tool_failure" });
    inv = r.invocation;
    emit(toolEvent(session, cmd, inv, "tool_failure", { reason: result.denial.reason }));
    emit({
      type: "tool_material", session_id: session.id, request_id: cmd.request_id, message_id: cmd.message_id,
      denial: result.denial, synthetic: true, observed: false,
    });
    emitDeltasAndDone(emit, session, cmd.message_id, denialContinuation(result.denial.reason));
    finishRequest(registry, identity, "completed");
  }

  function handleCommand(cmd) {
    const out = [];
    const emit = (m) => out.push(m);
    const sid = cmd?.session_id;

    switch (cmd?.type) {
      case "start_session": {
        if (!sid || typeof sid !== "string") {
          emit({ type: "error", code: "bad_request", message: "start_session 需要 session_id" });
          return out;
        }
        if (sessions.has(sid)) {
          emit({ type: "error", session_id: sid, code: "session_exists", message: "会话已存在" });
          return out;
        }
        sessions.set(sid, newSession(sid, typeof cmd.system_prompt === "string" ? cmd.system_prompt : ""));
        emit({ type: "session_started", session_id: sid });
        return out;
      }

      case "send_message": {
        const session = sessions.get(sid);
        if (!session) { emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        if (session.busy) { emit({ type: "error", session_id: sid, message_id: cmd.message_id, code: "busy", message: "当前会话已有生成中的请求" }); return out; }
        if (typeof cmd.text !== "string" || cmd.text.trim() === "") {
          emit({ type: "error", session_id: sid, message_id: cmd.message_id, code: "bad_request", message: "消息不能为空" });
          return out;
        }
        const messageId = String(cmd.message_id ?? randomUUID());
        const reply = deterministicReply(cmd.text);
        session.turnNo += 1;
        if (cmd.suspend === true) {
          emitDeltas(emit, session, messageId, reply);
          session.busy = messageId;
          return out;
        }
        emitDeltasAndDone(emit, session, messageId, reply);
        session.turnHistory.push({ role: "user", text: cmd.text });
        session.turnHistory.push({ role: "assistant", text: reply });
        return out;
      }

      case "cancel_message": {
        const session = sessions.get(sid);
        if (!session) { emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        if (session.busy !== cmd.message_id) {
          emit({ type: "error", session_id: sid, message_id: cmd.message_id, code: "not_in_flight", message: "没有该消息的挂起生成" });
          return out;
        }
        session.busy = null;
        emit({ type: "message_failed", session_id: sid, message_id: cmd.message_id, code: "cancelled", message: "生成已被取消" });
        return out;
      }

      case "replay_history": {
        const session = sessions.get(sid);
        if (!session) { emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        for (const t of cmd.turns ?? []) {
          if (t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") {
            session.seedTurns.push({ role: t.role, text: t.text });
          }
        }
        return out;
      }

      case "replay_done": {
        const session = sessions.get(sid);
        if (!session) { emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        session.turnHistory = [...session.seedTurns];
        session.seedTurns = [];
        emit({ type: "replay_ok", session_id: sid });
        return out;
      }

      case "end_session": {
        const session = sessions.get(sid);
        if (!session) { emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        sessions.delete(sid);
        emit({ type: "session_ended", session_id: sid });
        return out;
      }

      case "shutdown": {
        sessions.clear();
        approvals.clear();
        emit({ type: "shutdown_ok" });
        return out;
      }

      case "tool_request": {
        const session = sessions.get(sid);
        if (!session) { emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        const { request_id, message_id, tool, args } = cmd;

        const auth = authorizeReadTool(tool);
        if (!auth.allowed) {
          emit(toolEvent(session, cmd, { capability: auth.capability, state: "failed" }, "tool_failure", { reason: auth.reason }));
          emit({
            type: "message_failed", session_id: sid, message_id,
            code: auth.reason === "forbidden_capability" ? "tool_forbidden" : "tool_unknown",
            message: `工具 ${tool} 被拒绝（${auth.reason}）`,
          });
          return out;
        }

        const identity = {
          workId: args?.workId ?? STORY_FIXTURE.mainWorkId,
          discussionId: args?.discussionId ?? "discussion-1",
          sessionId: session.id,
          turn: session.turnNo,
          messageId: message_id,
          requestId: request_id,
        };
        session.turnNo += 1;

        const reg = registerRequest(registry, identity);
        if (!reg.ok) {
          emit({ type: "error", session_id: sid, message_id, code: reg.reason, message: "请求注册失败" });
          return out;
        }

        let inv = createToolInvocation({
          requestId: request_id, toolId: request_id, tool, capability: auth.capability, startedAt: clock(),
        });
        emit(toolEvent(session, cmd, inv, "tool_start"));

        if (args?.requiresApproval === true) {
          const r = applyToolEvent(inv, { type: "user_confirmation_wait" });
          inv = r.invocation;
          emit(toolEvent(session, cmd, inv, "user_confirmation_wait"));
          emit({
            type: "approval_wait", session_id: sid, request_id, message_id, tool,
            reason: typeof args.approvalReason === "string" ? args.approvalReason : "扩大读取范围需用户确认",
          });
          approvals.set(requestKey({ sessionId: sid, requestId: request_id }), { session, cmd, inv, identity, tool, args });
          return out;
        }

        finishToolRead(emit, session, cmd, inv, identity, tool, args);
        return out;
      }

      case "tool_decision": {
        const pending = approvals.get(requestKey({ sessionId: sid, requestId: cmd.request_id }));
        if (!pending) {
          emit({ type: "error", session_id: sid, request_id: cmd.request_id, code: "approval_not_found", message: "没有待确认的读取请求" });
          return out;
        }
        approvals.delete(requestKey({ sessionId: sid, requestId: cmd.request_id }));
        const { session, cmd: orig, inv, identity, tool, args } = pending;

        if (cmd.decision === "reject") {
          const r = applyToolEvent(inv, { type: "user_confirmation_reject" });
          emit(toolEvent(session, orig, r.invocation, "user_confirmation_reject"));
          emit({
            type: "approval_decision", session_id: session.id, request_id: orig.request_id,
            message_id: orig.message_id, decision: "reject", outcome: "denied",
          });
          emit({
            type: "tool_material", session_id: session.id, request_id: orig.request_id, message_id: orig.message_id,
            denial: { reason: "user_rejected" }, synthetic: true, observed: false,
          });
          emitDeltasAndDone(emit, session, orig.message_id, denialContinuation("user_rejected"));
          finishRequest(registry, identity, "completed");
          return out;
        }

        if (cmd.decision === "confirm") {
          const r = applyToolEvent(inv, { type: "user_confirmation_confirm" });
          emit(toolEvent(session, orig, r.invocation, "user_confirmation_confirm"));
          emit({
            type: "approval_decision", session_id: session.id, request_id: orig.request_id,
            message_id: orig.message_id, decision: "confirm", outcome: "allowed-once",
          });
          finishToolRead(emit, session, orig, r.invocation, identity, tool, args);
          return out;
        }

        emit({ type: "error", session_id: session.id, request_id: orig.request_id, code: "bad_decision", message: "decision 必须是 confirm 或 reject" });
        return out;
      }

      default:
        return out;
    }
  }

  function observe() {
    return {
      realDshEventFields: {
        observable: false,
        degraded: true,
        reason: "确定性适配器未运行真实 DSH Agent Loop；tool/call、tool/result、approval/* 事件字段形状取自 @deepseek-ai/dsh-session 类型契约，未经实机观测。",
      },
      modelLatency: {
        available: false,
        reason: "确定性替身不调用真实模型/API，无真实提交/首字/完成延迟可记录。",
      },
      toolEventsSynthetic: true,
    };
  }

  function exportRecovery(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session_not_found" };
    return {
      ok: true,
      sessionId,
      recoverable: { turns: session.turnHistory.map((t) => ({ role: t.role, text: t.text })) },
      toolMaterial: { recoverable: false, reason: "工具材料与确认等待状态不跨重启持久化，属明确降级边界。" },
    };
  }

  return { handleCommand, observe, exportRecovery, state: { registry, sessions, approvals } };
}
