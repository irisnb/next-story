// driver-client.mjs — 回答可靠性测试器的真实 DSH 驱动客户端（change: add-answer-reliability-tester-core 任务 2.2/2.3）
//
// 复用 driver.mjs 的 JSONL 协议（start_session / replay_history / replay_done /
// send_message / end_session / shutdown；ready / session_started / replay_ok /
// delta / message_done / message_failed / session_ended / error），不修改生产驱动契约。
// 本模块只负责进程生命周期、JSONL 收发、每步超时与终态处理，不包含任何评分逻辑。
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_PATH = join(__dirname, "..", "driver", "driver.mjs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 材料作为种子历史注入（driver 的 system_prompt 字段当前未实际传给 agent，故用 replay 注入）。 */
export function buildSeedTurns(material) {
  return [
    { role: "user", text: `请阅读以下材料，后续所有回答只依据这份材料：\n\n${material.text}` },
    { role: "assistant", text: "好的，我已阅读并记住这份材料。" },
  ];
}

export class DriverClient {
  constructor({ apiBase, model, apiKey, home }) {
    this.apiBase = apiBase;
    this.model = model;
    this.apiKey = apiKey;
    this.home = home;
    this.child = null;
    this.inbox = [];
    this.cursor = 0;
    this.exited = null;
    this.stderrChunks = [];
  }

  static async start(opts) {
    const client = new DriverClient(opts);
    await client.spawn();
    await client.waitReady();
    return client;
  }

  spawn() {
    this.child = spawn(
      process.execPath,
      [DRIVER_PATH, "--api-base", this.apiBase, "--model", this.model],
      {
        cwd: dirname(DRIVER_PATH),
        env: { ...process.env, DEEPSEEK_API_KEY: this.apiKey, DSH_HOME: this.home },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stderr.on("data", (d) => this.stderrChunks.push(d.toString()));
    this.child.on("exit", (code) => { this.exited = code; });
    const rl = readline.createInterface({ input: this.child.stdout, terminal: false });
    rl.on("line", (line) => {
      try { this.inbox.push(JSON.parse(line)); } catch { /* 非协议输出忽略 */ }
    });
  }

  send(msg) {
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  async waitReady(timeoutMs = 60000) {
    const ready = await this.waitFor((e) => e.type === "ready", timeoutMs, "ready");
    return ready;
  }

  async waitFor(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (; this.cursor < this.inbox.length; this.cursor++) {
        const e = this.inbox[this.cursor];
        if (predicate(e)) { this.cursor++; return e; }
      }
      if (this.exited !== null) {
        const err = new Error(`driver 提前退出（code=${this.exited}）：等待 ${label} 失败`);
        err.category = "driver_exited_early";
        throw err;
      }
      await sleep(25);
    }
    const err = new Error(`等待 ${label} 超时（${timeoutMs}ms）`);
    err.category = "timeout";
    throw err;
  }

  async waitMessageDone(sessionId, messageId, timeoutMs) {
    const deltas = [];
    const terminal = await this.waitFor((e) => {
      if (e.type === "delta" && e.session_id === sessionId && e.message_id === messageId) deltas.push(e.text);
      if (e.type === "error" && (e.session_id === sessionId || e.message_id === messageId)) return true;
      return (e.type === "message_done" || e.type === "message_failed")
        && e.session_id === sessionId && e.message_id === messageId;
    }, timeoutMs, `message ${messageId}`);
    return { terminal, deltas, folded: deltas.join("") };
  }

  stderrText() {
    return this.stderrChunks.join("");
  }

  async shutdown(timeoutMs = 10000) {
    if (!this.child || this.exited !== null) return;
    try { this.send({ type: "shutdown" }); } catch { /* 尽力而为 */ }
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { this.child.kill(); } catch { /* 忽略 */ } resolve(); }, timeoutMs);
      this.child.on("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}

/**
 * 对单个案例走完整协议：注入材料种子 → 依次发送前置步骤与最终问题 → 收集每轮终态与回答。
 * 返回结构化运行结果（含 protocol / response / runtimeError），由 runner 负责评分与落盘。
 */
export async function runCase(client, caseDef, defaultTimeoutMs) {
  const caseId = caseDef.id;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const timeoutMs = caseDef.timeoutMs ?? defaultTimeoutMs;
  const sessionId = `rel-${randomUUID()}`;

  const seed = buildSeedTurns(caseDef.material);
  const allTurns = [...(Array.isArray(caseDef.steps) ? caseDef.steps.map((s) => s.text) : []), caseDef.question];

  const stepResults = [];
  const eventSummary = [];
  let runtimeError = null;
  let protocolOutcome = "completed";
  let terminalState = null;
  let finalText = "";
  let finalMessageId = null;
  let deltaCountTotal = 0;

  try {
    client.send({ type: "start_session", session_id: sessionId });
    await client.waitFor((e) => e.type === "session_started" && e.session_id === sessionId, 30000, "session_started");
    eventSummary.push("session_started");

    if (seed.length > 0) {
      client.send({ type: "replay_history", session_id: sessionId, turns: seed });
      client.send({ type: "replay_done", session_id: sessionId });
      await client.waitFor((e) => e.type === "replay_ok" && e.session_id === sessionId, 60000, "replay_ok");
      eventSummary.push("replay_ok");
    }

    for (let i = 0; i < allTurns.length; i++) {
      const messageId = `${caseId}-m${i}`;
      const tStart = Date.now();
      client.send({ type: "send_message", session_id: sessionId, message_id: messageId, text: allTurns[i] });
      const { terminal, deltas } = await client.waitMessageDone(sessionId, messageId, timeoutMs);
      const responseText = terminal.type === "message_done" ? (terminal.text || deltas.join("")) : null;
      const isFinal = i === allTurns.length - 1;
      deltaCountTotal += deltas.length;
      eventSummary.push(terminal.type);

      stepResults.push({
        index: i,
        message_id: messageId,
        text: allTurns[i],
        terminal: terminal.type,
        code: terminal.code ?? null,
        response_text: responseText,
        duration_ms: Date.now() - tStart,
        delta_count: deltas.length,
      });

      if (isFinal) {
        terminalState = terminal.type;
        finalText = responseText ?? "";
        finalMessageId = messageId;
        if (terminal.type === "message_failed") {
          protocolOutcome = "message_failed";
          runtimeError = { category: "message_failed", message: `${terminal.code ?? "unknown"}: ${terminal.message ?? ""}` };
        } else if (terminal.type === "error") {
          protocolOutcome = "protocol_error";
          runtimeError = { category: "protocol_error", message: String(terminal.message ?? terminal.code ?? "协议错误") };
        }
      }
    }

    client.send({ type: "end_session", session_id: sessionId });
    await client.waitFor((e) => e.type === "session_ended" && e.session_id === sessionId, 30000, "session_ended");
    eventSummary.push("session_ended");
  } catch (err) {
    runtimeError = { category: err.category ?? "protocol_error", message: String(err.message ?? err) };
    protocolOutcome = err.category ?? "protocol_error";
    try { client.send({ type: "end_session", session_id: sessionId }); } catch { /* 忽略清理失败 */ }
  }

  return {
    caseId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    protocol: {
      outcome: protocolOutcome,
      terminal_state: terminalState,
      delta_count: deltaCountTotal,
      event_summary: eventSummary,
      session_id: sessionId,
      final_message_id: finalMessageId,
    },
    response: { text: finalText, steps: stepResults },
    runtimeError,
  };
}
