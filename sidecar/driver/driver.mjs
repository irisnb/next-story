// driver.mjs — Next Story 常驻 DSH 会话驱动（change: resident-ai-session 任务 2.1–2.4）
//
// 职责：启动 DSH 容器（默认拒绝装配），经 stdin/stdout 行分隔 JSON 协议服务常驻会话。
// stdout 只承载协议消息；一切诊断走 stderr。
// 用法：node driver.mjs --api-base <url> --model <model>
// 环境：DEEPSEEK_API_KEY（宿主从钥匙串读出注入，不落盘）、DSH_HOME（宿主指定的版本隔离目录）
//
// 协议 v1（design.md D2）：
//   入站  start_session {session_id, system_prompt?}
//         send_message   {session_id, message_id, text}
//         replay_history {session_id, turns:[{role:"user"|"assistant", text}]}
//         replay_done    {session_id}
//         cancel_message {session_id, message_id}
//         end_session    {session_id}
//         shutdown
//   出站  ready {protocol_version}
//         session_started {session_id}
//         delta     {session_id, message_id, seq, text}
//         message_done   {session_id, message_id, text}
//         message_failed {session_id, message_id, code, message}
//         replay_ok {session_id}
//         session_ended {session_id}
//         error {session_id?, message_id?, code, message}
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_CONSECUTIVE_MALFORMED = 10;

// ── 参数与环境 ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--api-base") out.apiBase = argv[++i];
    else if (argv[i] === "--model") out.model = argv[++i];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!args.apiBase || !args.model || !apiKey) {
  process.stderr.write("driver: missing --api-base/--model or DEEPSEEK_API_KEY\n");
  process.exit(2);
}

function emit(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function diag(line) {
  process.stderr.write(`driver: ${line}\n`);
}

// ── 启动容器（任务 2.1：默认拒绝装配）────────────────────────────────────────
const { boot } = await import("@deepseek-ai/dsh-app-boot");
const { installModelSelection } = await import("@deepseek-ai/dsh-agent");
const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
const { SessionId } = await import("@deepseek-ai/dsh-session");

const runtimePatches = [
  { id: "agent-default-model", config: { provider: "deepseek-official", model: args.model } },
  { id: "llm-deepseek", config: { baseURL: args.apiBase, thinking: "disabled" } },
];

let ctx;
try {
  ctx = await boot("driver", join(__dirname, "cordis.driver.yaml"), runtimePatches);
} catch (error) {
  diag(`boot failed: ${String(error?.stack ?? error)}`);
  process.exit(1);
}
const agents = ctx.get("agents");
const defaultModel = ctx.get("agentDefaultModel");
const selection = defaultModel.currentSelection();
emit({ type: "ready", protocol_version: PROTOCOL_VERSION });

// ── 会话状态 ─────────────────────────────────────────────────────────────────
/** @type {Map<string, {id, systemPrompt, agent: null|object, handle: null|object, busy: boolean, cancelRequested: boolean, seedTurns: array}>} */
const sessions = new Map();
let shuttingDown = false;

function textOfAssistantMessage(event) {
  return (event?.data?.message?.content ?? [])
    .filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function createAgentFor(session, seed) {
  const handle = await agents.create({
    sessionId: SessionId(session.id),
    meta: { cwd: __dirname, ...(seed ? { seedLength: seed.length } : {}) },
    ...(seed ? { seed } : {}),
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: undefined }); },
  });
  session.handle = handle;
  session.agent = handle.agent;
  return session.agent;
}

// 从显示历史构造 seed 事件（任务 2.2；结构依据 sidecar/probe/event-template.json，
// 探底 ⑤ 已验证合成 seed 可行）。最小闭合轮次：turn/start → step/start →
// user/message → assistant/chunk(block-start/text-delta/block-end) →
// assistant/message → step/end → turn/end。
function buildSeedEvents(turns, system) {
  const events = [];
  let seq = 0;
  const push = (type, data, extra) => {
    const e = { type, seq: seq++, time: Date.now(), data };
    if (extra) for (const [k, v] of Object.entries(extra)) e[k] = v;
    events.push(e);
    return e;
  };
  turns.forEach((turn, i) => {
    const turnNo = i + 1;
    const userText = turn.role === "user" ? turn.text : "";
    const assistantText = turn.role === "assistant" ? turn.text : "";
    if (!userText && !assistantText) return;
    push("turn/start", { turn: turnNo });
    push("step/start", { turn: turnNo, step: 1 });
    if (userText) {
      push("user/message", {
        content: [{ type: "text", text: userText }],
        source: { kind: "user" }, role: "user", id: randomUUID(),
      }, { surfaceOp: "append" });
    }
    if (assistantText) {
      const chunkSeqs = [];
      chunkSeqs.push(push("assistant/chunk", { turn: turnNo, step: 1, chunk: { type: "block-start", index: 0, blockType: "text" } }).seq);
      chunkSeqs.push(push("assistant/chunk", { turn: turnNo, step: 1, chunk: { type: "text-delta", index: 0, text: assistantText } }).seq);
      chunkSeqs.push(push("assistant/chunk", { turn: turnNo, step: 1, chunk: { type: "block-end", index: 0, block: { type: "text", text: assistantText } } }).seq);
      push("assistant/message", {
        turn: turnNo, step: 1,
        message: {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
          source: { kind: "model", provider: selection.provider, model: selection.model },
          id: randomUUID(),
        },
        usage: {
          inputTokens: Math.ceil((userText.length + assistantText.length) / 2),
          outputTokens: Math.ceil(assistantText.length / 2),
        },
      }, { sourceEventSeqs: chunkSeqs, surfaceOp: "append" });
    }
    push("step/end", { turn: turnNo, step: 1 });
    push("turn/end", { turn: turnNo, reason: { kind: "completed" } });
  });
  return events;
}

// 运行一轮：followup → 轮询转发 delta → whenIdle → message_done / message_failed
function runTurn(session, messageId, text) {
  const agent = session.agent;
  const firstSeq = agent.session.seq;
  let cursor = agent.session.events.length;
  let folded = "";
  session.busy = true;
  session.cancelRequested = false;

  const poll = setInterval(() => {
    try {
      const evs = agent.session.events;
      for (; cursor < evs.length; cursor++) {
        const e = evs[cursor];
        if (e.type === "assistant/chunk") {
          const c = e.data?.chunk;
          if (c?.type === "text-delta" && typeof c.text === "string" && c.text) {
            folded += c.text;
            emit({ type: "delta", session_id: session.id, message_id: messageId, seq: e.seq, text: c.text });
          }
        }
      }
    } catch (error) {
      diag(`poll error: ${String(error)}`);
    }
  }, 30);

  const finish = (msg) => {
    clearInterval(poll);
    session.busy = false;
    emit(msg);
  };

  agent.followup(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
  agent.whenIdle().then(() => {
    const evs = agent.session.events;
    const turnEnd = [...evs].reverse().find((e) => e.seq >= firstSeq && e.type === "turn/end");
    let fullText = "";
    for (const e of evs) {
      if (e.seq >= firstSeq && e.type === "assistant/message") {
        const t = textOfAssistantMessage(e);
        if (t) fullText = t;
      }
    }
    const kind = turnEnd?.data?.reason?.kind;
    if (kind === "completed") {
      finish({ type: "message_done", session_id: session.id, message_id: messageId, text: fullText || folded });
    } else if (session.cancelRequested || kind === "aborted" || kind === "canceled" || kind === "interrupted") {
      finish({ type: "message_failed", session_id: session.id, message_id: messageId, code: "cancelled", message: "生成已被取消" });
    } else {
      const err = turnEnd?.data?.reason?.error;
      finish({
        type: "message_failed", session_id: session.id, message_id: messageId,
        code: String(err?.code ?? kind ?? "internal"),
        message: String(err?.message ?? "生成失败"),
      });
    }
  }).catch((error) => {
    finish({
      type: "message_failed", session_id: session.id, message_id: messageId,
      code: "internal", message: String(error?.message ?? error).slice(0, 300),
    });
  });
}

// ── 命令处理（任务 2.2）──────────────────────────────────────────────────────
async function handleCommand(cmd) {
  const { type } = cmd;
  const sid = cmd.session_id;
  switch (type) {
    case "start_session": {
      if (!sid || typeof sid !== "string") return emit({ type: "error", code: "bad_request", message: "start_session 需要 session_id" });
      if (sessions.has(sid)) return emit({ type: "error", session_id: sid, code: "session_exists", message: "会话已存在" });
      sessions.set(sid, {
        id: sid, systemPrompt: typeof cmd.system_prompt === "string" ? cmd.system_prompt : "",
        agent: null, handle: null, busy: false, cancelRequested: false, seedTurns: [],
      });
      emit({ type: "session_started", session_id: sid });
      return;
    }
    case "replay_history": {
      const session = sessions.get(sid);
      if (!session) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      if (session.agent) return emit({ type: "error", session_id: sid, code: "bad_request", message: "会话已启动，不能再注入历史" });
      if (!Array.isArray(cmd.turns)) return emit({ type: "error", session_id: sid, code: "bad_request", message: "turns 必须是数组" });
      for (const t of cmd.turns) {
        if (t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") {
          session.seedTurns.push({ role: t.role, text: t.text });
        }
      }
      return;
    }
    case "replay_done": {
      const session = sessions.get(sid);
      if (!session) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      if (session.agent) return emit({ type: "error", session_id: sid, code: "bad_request", message: "会话已启动" });
      const seed = session.seedTurns.length > 0 ? buildSeedEvents(session.seedTurns, session.systemPrompt) : undefined;
      await createAgentFor(session, seed);
      session.seedTurns = [];
      emit({ type: "replay_ok", session_id: sid });
      return;
    }
    case "send_message": {
      const session = sessions.get(sid);
      if (!session) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      if (session.busy) return emit({ type: "error", session_id: sid, message_id: cmd.message_id, code: "busy", message: "当前会话已有生成中的请求" });
      if (typeof cmd.text !== "string" || cmd.text.trim() === "") return emit({ type: "error", session_id: sid, message_id: cmd.message_id, code: "bad_request", message: "消息不能为空" });
      if (!session.agent) await createAgentFor(session, undefined);
      runTurn(session, String(cmd.message_id ?? randomUUID()), cmd.text);
      return;
    }
    case "cancel_message": {
      const session = sessions.get(sid);
      if (!session?.agent) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      session.cancelRequested = true;
      try { session.agent.cancel(); } catch (error) { diag(`cancel error: ${String(error)}`); }
      return;
    }
    case "end_session": {
      const session = sessions.get(sid);
      if (!session) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      sessions.delete(sid);
      try { await session.handle?.dispose?.(); } catch (error) { diag(`dispose error: ${String(error)}`); }
      emit({ type: "session_ended", session_id: sid });
      return;
    }
    case "shutdown": {
      shuttingDown = true;
      for (const [, session] of sessions) {
        try { await session.handle?.dispose?.(); } catch { /* 退出路径尽力而为 */ }
      }
      sessions.clear();
      try { await ctx.fiber.dispose(); } catch (error) { diag(`ctx dispose error: ${String(error)}`); }
      process.exit(0);
      return;
    }
    default:
      // 未知消息类型：丢弃（单帧错误不致命），stderr 记诊断
      diag(`unknown message type: ${JSON.stringify(type)}`);
  }
}

// ── stdin 行协议（任务 2.2：帧上限 / 坏帧 / 持续异常）─────────────────────────
let malformedStreak = 0;
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (shuttingDown) return;
  if (line.length > MAX_FRAME_BYTES) {
    emit({ type: "error", code: "frame_too_large", message: "单帧超过上限，已丢弃" });
    return;
  }
  if (line.trim() === "") return;
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    malformedStreak += 1;
    diag(`malformed frame (streak=${malformedStreak})`);
    if (malformedStreak >= MAX_CONSECUTIVE_MALFORMED) {
      diag("too many consecutive malformed frames; exiting as untrusted");
      process.exit(1);
    }
    return;
  }
  malformedStreak = 0;
  handleCommand(cmd).catch((error) => {
    diag(`command error: ${String(error?.stack ?? error)}`);
    emit({
      type: "error",
      session_id: cmd?.session_id,
      message_id: cmd?.message_id,
      code: "internal",
      message: String(error?.message ?? error).slice(0, 300),
    });
  });
});
// 宿主消失（stdin 关闭而无 shutdown）：防止孤儿进程，优雅清理后退出
rl.on("close", () => {
  if (shuttingDown) return;
  diag("stdin closed by host; cleaning up");
  (async () => {
    for (const [, session] of sessions) {
      try { await session.handle?.dispose?.(); } catch { /* 尽力而为 */ }
    }
    try { await ctx.fiber.dispose(); } catch { /* 尽力而为 */ }
  })().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
