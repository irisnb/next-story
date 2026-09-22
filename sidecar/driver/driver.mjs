// driver.mjs — Next Story 常驻 DSH 会话驱动（change: resident-ai-session 任务 2.1–2.4）
//
// 职责：启动 DSH 容器（默认拒绝装配），经 stdin/stdout 行分隔 JSON 协议服务常驻会话。
// stdout 只承载协议消息；一切诊断走 stderr。
// 用法：node driver.mjs --api-base <url> --model <model> [--max-tokens <n>]
// 环境：DEEPSEEK_API_KEY（宿主从钥匙串读出注入，不落盘）、DSH_HOME（宿主指定的版本隔离目录）
//
// 协议 v1（design.md D2）：命令/事件词表的单一真相源是同目录 protocol.json（机器可读：
// 名称、方向、字段、active/planned 状态；change: add-agent-on-demand-reading 设计 D7）。
// 生产 v1 命令面：start_session / send_message / replay_history / replay_done /
//   cancel_message / end_session / shutdown / tool_result（宿主→驱动的工具结果回填）
// 生产 v1 事件面：ready / session_started / delta / message_sent（provider 发送回执，
//   本轮首次观测到回应证据时一次、先于终态）/ message_done / message_failed /
//   replay_ok / session_ended / error / tool_call（驱动→宿主的工具调用，设计 D2）
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

import { createSessionQueues } from "./session-queue.mjs";
import { loadProtocol } from "./protocol.mjs";
import { defineTool } from "@deepseek-ai/dsh-tools";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_CONSECUTIVE_MALFORMED = 10;

// ── 协议单一真相源（任务 1.2，设计 D7）────────────────────────────────────────
// 版本与词表来自 protocol.json；启动时自检本文件实际处理/发出的集合与真相源一致，
// 漂移即拒绝启动（防替身/宿主两端再分叉，审计 P2-5）。
const protocol = loadProtocol();
const PROTOCOL_VERSION = protocol.protocolVersion;

// 本驱动实际处理的入站命令（dispatchCommand/handleCommand 的 switch 依据）。
// shutdown 在 dispatchCommand 单独分流，同样属于命令面。
const HANDLED_COMMANDS = new Set([
  "start_session", "send_message", "replay_history", "replay_done",
  "cancel_message", "end_session", "shutdown", "tool_result",
]);
// 本驱动实际发出的出站事件（emit 调用点全集）。
const EMITTED_EVENTS = new Set([
  "ready", "session_started", "delta", "message_sent", "message_done",
  "message_failed", "replay_ok", "session_ended", "error", "tool_call",
]);

function assertProtocolCoherence() {
  for (const name of protocol.activeCommands) {
    if (!HANDLED_COMMANDS.has(name)) {
      process.stderr.write(`driver: protocol.json 声明的 active 命令未实现：${name}\n`);
      process.exit(1);
    }
  }
  for (const name of HANDLED_COMMANDS) {
    if (!protocol.activeCommands.includes(name)) {
      process.stderr.write(`driver: 实现的命令未在 protocol.json 声明为 active：${name}\n`);
      process.exit(1);
    }
  }
  for (const name of protocol.activeEvents) {
    if (!EMITTED_EVENTS.has(name)) {
      process.stderr.write(`driver: protocol.json 声明的 active 事件未实现：${name}\n`);
      process.exit(1);
    }
  }
  for (const name of EMITTED_EVENTS) {
    if (!protocol.activeEvents.includes(name)) {
      process.stderr.write(`driver: 发出的事件未在 protocol.json 声明为 active：${name}\n`);
      process.exit(1);
    }
  }
}
assertProtocolCoherence();

// ── 参数与环境 ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--api-base") out.apiBase = argv[++i];
    else if (argv[i] === "--model") out.model = argv[++i];
    else if (argv[i] === "--max-tokens") out.maxTokens = Number(argv[++i]);
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

// DSH 默认 max_tokens=256000（dsh-llm-deepseek DEFAULT_MAX_TOKENS）。智谱等 OpenAI 兼容
// 端点严格校验该参数（智谱 coding 接口允许 [1,131072]，超范围直接 400 INVALID_REQUEST）。
// 默认取 131072（已知最严校验范围内）；宿主可按端点用 --max-tokens 覆盖。
const MAX_TOKENS_DEFAULT = 131072;
const maxTokens = Number.isSafeInteger(args.maxTokens) && args.maxTokens > 0 ? args.maxTokens : MAX_TOKENS_DEFAULT;

const runtimePatches = [
  { id: "agent-default-model", config: { provider: "deepseek-official", model: args.model } },
  { id: "llm-deepseek", config: { baseURL: args.apiBase, thinking: "disabled", maxTokens } },
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
// 按会话串行、跨会话并行的命令队列（P1-3：replay 建 Agent 期间到达的 send
// 不得重复创建 Agent）。取消命令走旁路（见 dispatchCommand），不进队列。
const sessionQueues = createSessionQueues();

function textOfAssistantMessage(event) {
  return (event?.data?.message?.content ?? [])
    .filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ── 工具桥接（add-agent-on-demand-reading 任务 5.1/5.2，设计 D2）──────────────
// Agent 工具面四件套（story-list / story-read / story-search / story-request-reading）：
// 注册的是 DSH 工具声明，实现仅为协议桥接——把模型发起的工具调用以 tool_call 事件
// 交宿主执行，本进程不读取任何作品文件；等宿主 tool_result 回填后作为工具结果
// 喂回模型会话，原轮继续（暂停 = 挂起的工具调用，恢复 = 工具结果返回，设计 D1）。
const STORY_TOOLS = ["story-list", "story-read", "story-search", "story-request-reading"];

const STORY_TOOL_META = {
  "story-list": {
    description: "列出本作品允许 AI 查看的文档目录与各文档当前版本。只读，不修改作品。",
    parameters: {},
  },
  "story-read": {
    description: "读取一篇文档的已保存正文（可带版本与字节范围）。只读已保存内容，不读未保存修改。",
    parameters: {
      document_id: { type: "string", required: true, description: "目标文档稳定 ID（来自 story-list）。" },
      // DSH 编译器规则：required 存在时必须为 true，可选参数直接省略该字段。
      version: { type: "string", description: "期望版本；与当前版本不一致会被拒绝。" },
      range: {
        type: "object", description: "可选正文字节区间（左闭右开）。",
        additionalProperties: false,
        properties: {
          start: { type: "integer", required: true, description: "起始字节偏移。" },
          end: { type: "integer", required: true, description: "结束字节偏移（不含）。" },
        },
      },
    },
  },
  "story-search": {
    description: "按检索词在本作品允许 AI 查看的已保存正文中做字面检索，返回命中片段。",
    parameters: {
      query: { type: "string", required: true, description: "检索词。" },
    },
  },
  "story-request-reading": {
    description: "现有材料不足以回答时，请求用户开启本讨论的按需补读。须说明原因；得到允许后才能读取。",
    parameters: {
      reason: { type: "string", required: true, description: "为什么现有材料不足、需要补读（向用户展示）。" },
    },
  },
};

/** 落定一个挂起的工具调用（幂等：未知 call_id 返回 false）。 */
function settlePendingToolCall(session, callId, value) {
  const pending = session.pendingToolCalls.get(callId);
  if (!pending) return false;
  session.pendingToolCalls.delete(callId);
  pending.resolve(value);
  return true;
}

/** 落定该会话全部挂起工具调用（取消 / 结束会话时兜底，防止轮次悬挂）。 */
function settleAllPendingToolCalls(session, value) {
  for (const callId of [...session.pendingToolCalls.keys()]) {
    settlePendingToolCall(session, callId, value);
  }
}

// 在 Agent 私有作用域注册四件套：工具面只对本会话可见；宿主负责授权与执行。
function registerStoryTools(agentCtx, session) {
  const bridge = (toolName) => defineTool({
    name: toolName,
    description: STORY_TOOL_META[toolName].description,
    parameters: STORY_TOOL_META[toolName].parameters,
    output: {
      // DSH 编译器要求完整形式的 object 节点显式声明 additionalProperties
      // （真实链路 9.2 实测：缺失会在 defineTool 注册期被拒）。工具结果为
      // 动态开放结构（目录/正文/检索/授权结果），取 true。
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    // 宿主侧出处档案是读改写：轮内工具串行，避免并发丢更新。
    isConcurrencySafe: false,
    async execute(args, exec) {
      const callId = String(exec.callId);
      // 停止生成 / 会话结束时经中止信号落定为取消（DSH 侧按中止语义收束本调用）。
      const settleOnAbort = () => settlePendingToolCall(session, callId, { denied: true, reason: "cancelled" });
      exec.signal.addEventListener("abort", settleOnAbort, { once: true });
      emit({
        type: "tool_call", session_id: session.id,
        message_id: session.currentMessageId ?? "",
        call_id: callId, tool: toolName,
        args: args && typeof args === "object" && !Array.isArray(args) ? args : {},
      });
      const value = await new Promise((resolve) => {
        session.pendingToolCalls.set(callId, { resolve });
      });
      exec.signal.removeEventListener("abort", settleOnAbort);
      return value;
    },
  });
  for (const name of STORY_TOOLS) {
    agentCtx.tools.register(bridge(name));
  }
}

async function createAgentFor(session, seed) {
  const handle = await agents.create({
    sessionId: SessionId(session.id),
    meta: { cwd: __dirname, ...(seed ? { seedLength: seed.length } : {}) },
    ...(seed ? { seed } : {}),
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      // 工具面四件套注册在 Agent 私有作用域（任务 5.1）；实现只桥接宿主。
      registerStoryTools(agentCtx, session);
    },
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

// 运行一轮：followup → 轮询转发 delta →（首见 provider 侧证据时一次 message_sent）→ whenIdle → message_done / message_failed
function runTurn(session, messageId, text) {
  const agent = session.agent;
  const firstSeq = agent.session.seq;
  let cursor = agent.session.events.length;
  let folded = "";
  let sentEmitted = false;
  session.busy = true;
  session.currentMessageId = messageId;
  session.cancelRequested = false;

  // provider 发送回执（add-automatic-story-context）：本轮范围内首次观测到
  // provider 侧回应证据（第一个 assistant/chunk 的 text-delta，或 assistant/message）
  // 时发出一次 message_sent，且必须先于终态。取消/失败于任何回应证据之前时不发；
  // 仅组装未到 provider 也不发——回执只反映真实观测，不伪造。
  const maybeEmitSent = (e) => {
    if (sentEmitted || e.seq < firstSeq) return;
    const isTextDelta = e.type === "assistant/chunk" && e.data?.chunk?.type === "text-delta";
    if (isTextDelta || e.type === "assistant/message") {
      sentEmitted = true;
      emit({ type: "message_sent", session_id: session.id, message_id: messageId });
    }
  };

  const poll = setInterval(() => {
    try {
      const evs = agent.session.events;
      for (; cursor < evs.length; cursor++) {
        const e = evs[cursor];
        maybeEmitSent(e);
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
    session.currentMessageId = null;
    emit(msg);
  };

  agent.followup(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
  agent.whenIdle().then(() => {
    const evs = agent.session.events;
    // 兜底扫描：轮询间隙到达的 provider 侧证据也必须在终态前发出 message_sent。
    for (; cursor < evs.length; cursor++) maybeEmitSent(evs[cursor]);
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
        // 工具桥接状态：当前轮消息身份 + 挂起的工具调用（call_id → 落定器）。
        currentMessageId: null, pendingToolCalls: new Map(),
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
    case "tool_result": {
      // 宿主回填工具结果（任务 5.2）：成功/拒绝都作为工具结果喂回模型并继续原轮。
      // 迟到 / 未知 / 已取消的 call_id 一律拒绝，不重开调用（5.3 迟到丢弃）。
      // 拒绝落定透传宿主提供的可选 recovery（协议 tool_result.error.recovery，
      // batch-improvement-candidates ②/design D5）：有则携带、无则不造。
      const session = sessions.get(sid);
      if (!session) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      const callId = typeof cmd.call_id === "string" ? cmd.call_id : "";
      const denial = { denied: true, reason: cmd.error?.reason ?? "tool_failed" };
      if (typeof cmd.error?.recovery === "string" && cmd.error.recovery !== "") {
        denial.recovery = cmd.error.recovery;
      }
      if (!callId || !settlePendingToolCall(session, callId, cmd.ok === true
        ? (cmd.result ?? {})
        : denial)) {
        return emit({
          type: "error", session_id: sid, message_id: session.currentMessageId,
          code: "tool_call_not_found", message: "没有该身份的挂起工具调用",
        });
      }
      return;
    }
    case "cancel_message": {
      const session = sessions.get(sid);
      if (!session?.agent) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      session.cancelRequested = true;
      // 等待工具结果 / 等待授权的轮次同样可被取消（任务 5.3）：落定挂起调用，
      // 让轮次随中止信号收束，不再回填结果。
      settleAllPendingToolCalls(session, { denied: true, reason: "cancelled" });
      try { session.agent.cancel(); } catch (error) { diag(`cancel error: ${String(error)}`); }
      return;
    }
    case "end_session": {
      const session = sessions.get(sid);
      if (!session) return emit({ type: "error", session_id: sid, code: "session_not_found", message: "会话不存在" });
      // 会话身份失效：挂起工具调用一律落定为取消（迟到的 tool_result 随后被拒）。
      settleAllPendingToolCalls(session, { denied: true, reason: "cancelled" });
      sessions.delete(sid);
      try { await session.handle?.dispose?.(); } catch (error) { diag(`dispose error: ${String(error)}`); }
      emit({ type: "session_ended", session_id: sid });
      return;
    }
    default:
      // 未知消息类型：丢弃（单帧错误不致命），stderr 记诊断
      diag(`unknown message type: ${JSON.stringify(type)}`);
  }
}

// ── 命令分发（P1-3：按会话串行；取消旁路；shutdown 全局屏障）─────────────────
function dispatchCommand(cmd) {
  const type = cmd?.type;
  if (type === "cancel_message") {
    // 取消旁路：立即执行，不排队——否则会排在被取消的操作之后。
    return handleCommand(cmd);
  }
  if (type === "shutdown") {
    return handleShutdown();
  }
  if (!HANDLED_COMMANDS.has(type)) {
    // 未知消息类型：直接丢弃（不排队、单帧错误不致命），stderr 记诊断。
    // 词表来自 protocol.json（HANDLED_COMMANDS 已在启动时与真相源自检一致）。
    diag(`unknown message type: ${JSON.stringify(type)}`);
    return Promise.resolve();
  }
  const sid = cmd?.session_id;
  if (typeof sid !== "string" || sid === "") {
    // 无会话身份的命令直接执行（各命令自行回报 bad_request 错误）。
    return handleCommand(cmd);
  }
  // send_message 只串行到 runTurn 启动（handler 返回即生成已在后台运行）；
  // 生成期间同会话的后续 send 由 session.busy 拒绝（最后一层防御）。
  return sessionQueues.enqueue(sid, () => handleCommand(cmd));
}

async function handleShutdown() {
  shuttingDown = true; // 停收新命令
  // 全局屏障：等待各会话队列收束（在途命令完成），再统一清理退出。
  await sessionQueues.drain();
  for (const [, session] of sessions) {
    try { await session.handle?.dispose?.(); } catch { /* 退出路径尽力而为 */ }
  }
  sessions.clear();
  try { await ctx.fiber.dispose(); } catch (error) { diag(`ctx dispose error: ${String(error)}`); }
  process.exit(0);
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
  dispatchCommand(cmd).catch((error) => {
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
