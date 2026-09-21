// adapter.mjs — 确定性 DSH 驱动适配器（验证专用；协议面对齐 change: add-agent-on-demand-reading 任务组 1）
//
// 与 driver.mjs 使用同一套行分隔 JSON 协议面，但不启动真实 DSH 容器、不调用真实模型/API。
// 它是「可控替身」：用确定性文本流 + 结构化工具往返模拟 Agent Loop 的受控只读工具循环，
// 供验证 harness 在无 API key、无实机 DSH 的环境里重复运行协议、权限、终态与隔离断言。
//
// 协议单一真相源（设计 D7）：命令/事件词表来自同目录 protocol.json，与生产 driver.mjs 共享。
//   - 发出校验：替身发出的每条消息都经协议词表断言，结构性地发不出生产不认识的事件
//     （含 message_sent 回执与 tool_call；旧替身专用事件——工具请求/决策/等待/材料
//     等私有事件——已全部退场，由 protocol.test.mjs 源码扫描钉死）。
//   - 工具循环语义对齐新协议：需要工具时替身发出 tool_call（驱动→宿主），由执行方
//     （测试 harness 扮演宿主）对 fixture 受控只读桥接算出结果，再以 tool_result
//     （宿主→驱动）回填，替身继续该轮生成。替身自身不接任何真实作品数据。
//   - 工具名统一 dash 风格 Agent 工具面（设计 D6）：story-list / story-read /
//     story-search / story-request-reading，与 Rust 网关一致。
//
// 安全边界：工具名授权复用 validation/allowlist.mjs 的 default-deny 判定与
// validation/bridge.mjs 的受控只读映射（越权/未知工具失败关闭）；本模块绝不暴露
// 文件系统 / Shell / 网络 / 写入工具，也绝不触碰生产 cordis.driver.yaml
// （生产默认拒绝配置原样保留，见 config-guard.test.mjs）。
//
// 本模块纯内存、确定性、无 IO、无网络。可作为 import 使用，也可直接作为进程入口（仅本文件被
// node 直接执行时进入 CLI 行协议模式）。

import { randomUUID } from "node:crypto";

import { loadProtocol } from "./protocol.mjs";
import { createIsolationRegistry, registerRequest, finishRequest } from "../validation/isolation.mjs";
import { authorizeReadTool } from "../validation/bridge.mjs";

const protocol = loadProtocol();
export const PROTOCOL_VERSION = protocol.protocolVersion;

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

function searchContinuation(snippets) {
  return `已检索到 ${snippets.length} 处命中片段并继续生成回应。`;
}

function grantedContinuation() {
  return "已获得按需补读授权，继续回答。";
}

function denialContinuation(reason) {
  return `未能读取该材料（${reason}）。`;
}

// 按宿主回填的工具结果选择本轮续文（结果内容属于宿主/执行方，替身只引用不产生）。
function continuationFor(outcome) {
  if (!outcome.ok) return denialContinuation(outcome.error?.reason ?? "tool_failed");
  const result = outcome.result;
  if (Array.isArray(result?.documents)) return listContinuation(result.documents);
  if (Array.isArray(result?.snippets)) return searchContinuation(result.snippets);
  if (result?.material) return successContinuation(result.material);
  if (result?.granted === true) return grantedContinuation();
  if (result?.granted === false) return "未获得按需补读授权，转为有限回答。";
  return "已获得工具结果并继续生成回应。";
}

// ── 工厂 ─────────────────────────────────────────────────────────────────────
export function createDeterministicAdapter(options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : () => Date.now();

  const sessions = new Map(); // session_id -> session
  const registry = createIsolationRegistry();
  const seq = { value: 0 };

  function newSession(id, systemPrompt = "") {
    return {
      id, systemPrompt, busy: null, pendingToolCall: null, seedTurns: [], turnHistory: [], turnNo: 1,
    };
  }

  // 发出校验（任务 1.5 / 设计 D7）：替身只允许发出 protocol.json 认识的事件。
  // 词表外的类型立即抛错——替身结构性地发不出生产不认识的事件。
  function emit(out, message) {
    if (!protocol.knownEvents.has(message.type)) {
      throw new Error(`替身试图发出协议外事件：${message.type}`);
    }
    out.push(message);
  }

  // 一轮生成的收尾：回执（message_sent，先于终态）→ 流式 delta → 终态。
  function emitReplyAndDone(out, session, messageId, text) {
    emit(out, { type: "message_sent", session_id: session.id, message_id: messageId });
    for (let i = 0; i < text.length; i += DELTA_CHUNK) {
      emit(out, {
        type: "delta", session_id: session.id, message_id: messageId,
        seq: seq.value++, text: text.slice(i, i + DELTA_CHUNK),
      });
    }
    emit(out, { type: "message_done", session_id: session.id, message_id: messageId, text });
  }

  // 工具轮：替身发出 tool_call 并挂起轮次（不产生终态），等待宿主 tool_result。
  // 无真实模型，工具计划由命令显式携带（确定性假循环；call_id 缺省由 message_id 派生，保持确定）。
  function startToolRound(out, session, messageId, plan) {
    const auth = authorizeReadTool(plan.tool);
    if (!auth.allowed) {
      // 失败关闭：越权/未知工具不进入工具循环（不发出 tool_call），以 message_failed 终态拒绝。
      emit(out, {
        type: "message_failed", session_id: session.id, message_id: messageId,
        code: auth.reason === "forbidden_capability" ? "tool_forbidden" : "tool_unknown",
        message: `工具 ${plan.tool} 被拒绝（${auth.reason}）`,
      });
      return;
    }
    const callId = typeof plan.call_id === "string" && plan.call_id !== "" ? plan.call_id : `call-${messageId}`;
    const identity = {
      workId: plan.args?.workId ?? "work-wuzhen",
      discussionId: plan.args?.discussionId ?? "discussion-1",
      sessionId: session.id,
      turn: session.turnNo,
      messageId,
      requestId: callId,
    };
    session.turnNo += 1;

    const reg = registerRequest(registry, identity);
    if (!reg.ok) {
      emit(out, { type: "error", session_id: session.id, message_id: messageId, code: reg.reason, message: "请求注册失败" });
      return;
    }

    session.busy = messageId;
    session.pendingToolCall = { callId, tool: plan.tool, args: plan.args ?? {}, identity };
    emit(out, {
      type: "tool_call", session_id: session.id, message_id: messageId,
      call_id: callId, tool: plan.tool, args: plan.args ?? {},
    });
  }

  function handleCommand(cmd) {
    const out = [];
    const sid = cmd?.session_id;

    switch (cmd?.type) {
      case "start_session": {
        if (!sid || typeof sid !== "string") {
          emit(out, { type: "error", code: "bad_request", message: "start_session 需要 session_id" });
          return out;
        }
        if (sessions.has(sid)) {
          emit(out, { type: "error", session_id: sid, code: "session_exists", message: "会话已存在" });
          return out;
        }
        sessions.set(sid, newSession(sid, typeof cmd.system_prompt === "string" ? cmd.system_prompt : ""));
        emit(out, { type: "session_started", session_id: sid });
        return out;
      }

      case "send_message": {
        const session = sessions.get(sid);
        if (!session) { emit(out, { type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        if (session.busy) { emit(out, { type: "error", session_id: sid, message_id: cmd.message_id, code: "busy", message: "当前会话已有生成中的请求" }); return out; }
        if (typeof cmd.text !== "string" || cmd.text.trim() === "") {
          emit(out, { type: "error", session_id: sid, message_id: cmd.message_id, code: "bad_request", message: "消息不能为空" });
          return out;
        }
        const messageId = String(cmd.message_id ?? randomUUID());

        if (cmd.tool_call && typeof cmd.tool_call === "object") {
          startToolRound(out, session, messageId, cmd.tool_call);
          return out;
        }

        const reply = deterministicReply(cmd.text);
        session.turnNo += 1;
        if (cmd.suspend === true) {
          emit(out, { type: "message_sent", session_id: session.id, message_id: messageId });
          for (let i = 0; i < reply.length; i += DELTA_CHUNK) {
            emit(out, {
              type: "delta", session_id: session.id, message_id: messageId,
              seq: seq.value++, text: reply.slice(i, i + DELTA_CHUNK),
            });
          }
          session.busy = messageId;
          return out;
        }
        emitReplyAndDone(out, session, messageId, reply);
        session.turnHistory.push({ role: "user", text: cmd.text });
        session.turnHistory.push({ role: "assistant", text: reply });
        return out;
      }

      // 宿主回填工具结果（新协议语义）：成功/拒绝都继续原轮生成，产出唯一终态。
      // 迟到/未知/已取消的 call_id 一律拒绝，不重开调用。
      case "tool_result": {
        const session = sessions.get(sid);
        if (!session) { emit(out, { type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        const pending = session.pendingToolCall;
        if (!pending || session.busy === null || pending.callId !== cmd.call_id) {
          emit(out, {
            type: "error", session_id: sid, message_id: cmd.message_id,
            code: "tool_call_not_found", message: "没有该身份的挂起工具调用",
          });
          return out;
        }
        const ok = cmd.ok === true;
        const outcome = {
          ok,
          result: ok ? (cmd.result ?? null) : null,
          error: ok ? null : (cmd.error ?? { reason: "tool_failed" }),
        };
        session.busy = null;
        session.pendingToolCall = null;
        finishRequest(registry, pending.identity, "completed");
        emitReplyAndDone(out, session, pending.identity.messageId, continuationFor(outcome));
        return out;
      }

      case "cancel_message": {
        const session = sessions.get(sid);
        if (!session) { emit(out, { type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        if (session.busy !== cmd.message_id) {
          emit(out, { type: "error", session_id: sid, message_id: cmd.message_id, code: "not_in_flight", message: "没有该消息的挂起生成" });
          return out;
        }
        // 等待工具结果的轮次同样可被取消：登记取消终态、作废挂起调用（迟到 tool_result 随后被拒）。
        if (session.pendingToolCall) {
          finishRequest(registry, session.pendingToolCall.identity, "cancelled");
          session.pendingToolCall = null;
        }
        session.busy = null;
        emit(out, { type: "message_failed", session_id: sid, message_id: cmd.message_id, code: "cancelled", message: "生成已被取消" });
        return out;
      }

      case "replay_history": {
        const session = sessions.get(sid);
        if (!session) { emit(out, { type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        for (const t of cmd.turns ?? []) {
          if (t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") {
            session.seedTurns.push({ role: t.role, text: t.text });
          }
        }
        return out;
      }

      case "replay_done": {
        const session = sessions.get(sid);
        if (!session) { emit(out, { type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        session.turnHistory = [...session.seedTurns];
        session.seedTurns = [];
        emit(out, { type: "replay_ok", session_id: sid });
        return out;
      }

      case "end_session": {
        const session = sessions.get(sid);
        if (!session) { emit(out, { type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" }); return out; }
        sessions.delete(sid);
        emit(out, { type: "session_ended", session_id: sid });
        return out;
      }

      case "shutdown": {
        // 生产驱动对 shutdown 不回事件（清理后 exit 0），替身对齐：只清空状态。
        sessions.clear();
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
        reason: "确定性替身未运行真实 DSH Agent Loop；tool_call / tool_result 字段形状取自 protocol.json 单一真相源，未经实机观测。",
      },
      modelLatency: {
        available: false,
        reason: "确定性替身不调用真实模型/API，无真实提交/首字/完成延迟可记录。",
      },
      toolLoopSynthetic: true,
    };
  }

  function exportRecovery(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session_not_found" };
    return {
      ok: true,
      sessionId,
      recoverable: { turns: session.turnHistory.map((t) => ({ role: t.role, text: t.text })) },
      toolMaterial: { recoverable: false, reason: "工具调用与结果不跨重启持久化，属明确降级边界。" },
    };
  }

  return { handleCommand, observe, exportRecovery, state: { registry, sessions } };
}
