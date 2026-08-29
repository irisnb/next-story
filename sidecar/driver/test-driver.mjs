// test-driver.mjs — 常驻驱动协议回归测试（change: resident-ai-session 任务 2.5）
// 拉起 driver.mjs 子进程，走完整协议面，逐项断言。DSH 升级后重跑本脚本即可回归。
// 用法：$env:DEEPSEEK_API_KEY = <key>; node test-driver.mjs <api_base> <model>
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [apiBase, model] = process.argv.slice(2);
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiBase || !model || !apiKey) { console.error("usage: node test-driver.mjs <api_base> <model>"); process.exit(2); }

const results = [];
function record(item, ok, detail) {
  results.push({ item, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${item}: ${detail}`);
}

// ── 拉起驱动子进程 ───────────────────────────────────────────────────────────
const home = join(__dirname, ".test-home");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
const child = spawn(process.execPath, [join(__dirname, "driver.mjs"), "--api-base", apiBase, "--model", model], {
  cwd: __dirname,
  env: { ...process.env, DSH_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});

const stderrChunks = [];
child.stderr.on("data", (d) => stderrChunks.push(d.toString()));

const inbox = [];
let exited = null;
child.on("exit", (code) => { exited = code; });
const rl = readline.createInterface({ input: child.stdout, terminal: false });
rl.on("line", (line) => {
  try { inbox.push(JSON.parse(line)); } catch { /* 非协议输出 */ }
});

function send(msg) { child.stdin.write(JSON.stringify(msg) + "\n"); }

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let index = 0;
  while (Date.now() < deadline) {
    for (; index < inbox.length; index++) {
      if (predicate(inbox[index])) return inbox[index];
    }
    if (exited !== null) throw new Error(`driver 提前退出（code=${exited}）：等待 ${label} 失败`);
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`等待 ${label} 超时（${timeoutMs}ms）`);
}

async function waitDone(sessionId, messageId, timeoutMs = 180000) {
  const deltas = [];
  const start = inbox.length;
  const done = await waitFor(
    (e) => {
      if (e.type === "delta" && e.session_id === sessionId && e.message_id === messageId) deltas.push(e.text);
      return (e.type === "message_done" || e.type === "message_failed")
        && e.session_id === sessionId && e.message_id === messageId;
    },
    timeoutMs, `message ${messageId}`,
  );
  return { done, deltas, folded: deltas.join("") };
}

// ── 步骤 1：ready ────────────────────────────────────────────────────────────
try {
  const ready = await waitFor((e) => e.type === "ready", 60000, "ready");
  record("1 ready 握手", ready.protocol_version === 1, `protocol_version=${ready.protocol_version}`);
} catch (e) { record("1 ready 握手", false, String(e.message)); finish(1); }

// ── 步骤 2-4：会话 + 增量 + 流式 + 多轮 ──────────────────────────────────────
try {
  send({ type: "start_session", session_id: "s1" });
  await waitFor((e) => e.type === "session_started" && e.session_id === "s1", 30000, "session_started");
  record("2 start_session", true, "s1 已启动");
} catch (e) { record("2 start_session", false, String(e.message)); finish(1); }

try {
  send({ type: "send_message", session_id: "s1", message_id: "m1", text: "用大约60个字介绍一下什么是黄昏。" });
  const { done, deltas, folded } = await waitDone("s1", "m1");
  record("3 send_message + 流式 delta", done.type === "message_done" && deltas.length >= 1 && done.text.length > 0,
    `delta 数=${deltas.length}，done 全文长度=${done.text?.length}（折叠长度=${folded.length}）`);
} catch (e) { record("3 send_message + 流式 delta", false, String(e.message)); }

try {
  send({ type: "send_message", session_id: "s1", message_id: "m2", text: "我上一条问你的问题是什么？用不超过20个字回答。" });
  const { done } = await waitDone("s1", "m2");
  record("4 多轮上下文连贯", done.type === "message_done" && /黄昏|介绍/.test(done.text ?? ""), `回答="${done.text}"`);
} catch (e) { record("4 多轮上下文连贯", false, String(e.message)); }

try {
  send({ type: "end_session", session_id: "s1" });
  await waitFor((e) => e.type === "session_ended" && e.session_id === "s1", 30000, "session_ended");
  record("5 end_session", true, "s1 已结束");
} catch (e) { record("5 end_session", false, String(e.message)); }

// ── 步骤 6：replay 历史注入（崩溃恢复路径）────────────────────────────────────
try {
  send({ type: "start_session", session_id: "s2" });
  await waitFor((e) => e.type === "session_started" && e.session_id === "s2", 30000, "session_started s2");
  send({
    type: "replay_history", session_id: "s2",
    turns: [
      { role: "user", text: "四乘以七等于多少？" },
      { role: "assistant", text: "四乘以七等于二十八。" },
    ],
  });
  send({ type: "replay_done", session_id: "s2" });
  await waitFor((e) => e.type === "replay_ok" && e.session_id === "s2", 60000, "replay_ok");
  send({ type: "send_message", session_id: "s2", message_id: "m3", text: "根据之前的对话，四乘以七等于多少？用不超过10个字回答。" });
  const { done } = await waitDone("s2", "m3");
  record("6 replay 历史注入 + 追问连贯", done.type === "message_done" && /28|二十八/.test(done.text ?? ""), `回答="${done.text}"`);
} catch (e) { record("6 replay 历史注入 + 追问连贯", false, String(e.message)); }

// ── 步骤 7：取消 ─────────────────────────────────────────────────────────────
try {
  send({ type: "start_session", session_id: "s3" });
  await waitFor((e) => e.type === "session_started" && e.session_id === "s3", 30000, "session_started s3");
  send({ type: "send_message", session_id: "s3", message_id: "m4", text: "请写一篇至少600字的武侠短篇小说，从「第一章」开始。" });
  // 等首个 delta 出现后取消
  await waitFor((e) => e.type === "delta" && e.session_id === "s3" && e.message_id === "m4", 90000, "首个 delta");
  send({ type: "cancel_message", session_id: "s3", message_id: "m4" });
  const { done } = await waitDone("s3", "m4");
  record("7 cancel 取消", done.type === "message_failed" && done.code === "cancelled", `终态=${done.type}/${done.code}`);
  // 取消后追问仍可用
  send({ type: "send_message", session_id: "s3", message_id: "m5", text: "刚才的写作任务被取消了吗？用不超过15个字回答。" });
  const { done: done5 } = await waitDone("s3", "m5");
  record("7b 取消后追问可用", done5.type === "message_done" && (done5.text ?? "").length > 0, `回答="${done5.text}"`);
} catch (e) { record("7 cancel 取消", false, String(e.message)); }

// ── 步骤 8：shutdown + 干净退出 ──────────────────────────────────────────────
try {
  send({ type: "shutdown" });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("10 秒内未退出")), 10000);
    child.on("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  record("8 shutdown 干净退出", exitCode === 0, `exit code=${exitCode}`);
} catch (e) { record("8 shutdown 干净退出", false, String(e.message)); }

// ── 步骤 9：stderr 无 key 泄漏 ───────────────────────────────────────────────
const stderrAll = stderrChunks.join("");
record("9 stderr 无 key 泄漏", !stderrAll.includes(apiKey), `stderr ${stderrAll.length} 字符${stderrAll.includes(apiKey) ? "，含 key！" : ""}`);

// ── 汇总 ─────────────────────────────────────────────────────────────────────
console.log("RESULTS_JSON=" + JSON.stringify(results, null, 2));
const allOk = results.every((r) => r.ok);
console.log(allOk ? "DRIVER TEST: ALL PASS" : "DRIVER TEST: HAS FAILURES");

function finish(code) {
  console.log("RESULTS_JSON=" + JSON.stringify(results, null, 2));
  child.kill();
  process.exit(code);
}
if (!allOk) process.exitCode = 1;
