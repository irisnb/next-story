// repro-cancel.mjs — 复现 test-driver 步骤 7：新会话＋600字长文请求，看首个 delta 前的事件。
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const DRIVER = "D:\\Next Story\\sidecar\\driver\\driver.mjs";
const KEY = process.env.REPRO_KEY ?? "sk-dummy";
const WAIT_MS = Number(process.env.REPRO_WAIT_MS ?? 100000);

const home = join(here, "repro-cancel-home");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });

const child = spawn(process.execPath, [DRIVER, "--api-base", "https://open.bigmodel.cn/api/coding/paas/v4", "--model", "glm-5.3"], {
  cwd: dirname(DRIVER),
  env: { ...process.env, DEEPSEEK_API_KEY: KEY, DSH_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});
const t0 = Date.now();
child.stderr.on("data", (d) => { for (const l of d.toString().split(/\r?\n/).filter(Boolean)) console.log(`[stderr +${Date.now() - t0}ms] ${l}`); });
const rl = readline.createInterface({ input: child.stdout, terminal: false });
const events = [];
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  events.push(m);
  const b = { ...m };
  if (typeof b.text === "string" && b.text.length > 50) b.text = b.text.slice(0, 50) + `…(${b.text.length})`;
  console.log(`[event +${Date.now() - t0}ms] ${JSON.stringify(b)}`);
});
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");

const waitType = async (t, sid, ms) => { const dl = Date.now() + ms; while (Date.now() < dl) { if (events.some((e) => e.type === t && e.session_id === sid)) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

send({ type: "start_session", session_id: "s3" });
await waitType("session_started", "s3", 30000);
send({ type: "send_message", session_id: "s3", message_id: "m4", text: "请写一篇至少600字的武侠短篇小说，从「第一章」开始。" });
// 等首个 delta；期间模型可能发起 story 工具调用（桥接挂起等宿主回填）——
// 扮演宿主回填 tool_result（story-list 空目录，真实形状 {documents:[]}），让轮次继续。
let settledTools = 0;
const ok = await new Promise((resolve) => {
  const dl = Date.now() + WAIT_MS;
  const iv = setInterval(() => {
    if (events.some((e) => e.type === "delta" && e.message_id === "m4")) { clearInterval(iv); resolve("delta"); return; }
    const tc = events.find((e) => e.type === "tool_call" && e.message_id === "m4" && !e.__settled);
    if (tc) {
      tc.__settled = true; settledTools += 1;
      console.log(`[repro +${Date.now() - t0}ms] 回填 tool_result（${tc.tool}，空目录）`);
      send({ type: "tool_result", session_id: "s3", call_id: tc.call_id, ok: true, result: { documents: [] } });
      return;
    }
    if (events.some((e) => (e.type === "message_done" || e.type === "message_failed" || e.type === "error") && (e.message_id === "m4" || e.session_id === "s3"))) { clearInterval(iv); resolve("terminal-no-delta"); return; }
    if (Date.now() > dl) { clearInterval(iv); resolve("timeout"); }
  }, 200);
});
console.log(`首个 delta 判定: ${ok}（回填工具调用 ${settledTools} 次）`);
// 若 delta 已出，尝试取消路径（等 3 秒更多内容再取消）
if (ok === "delta") {
  await new Promise((r) => setTimeout(r, 3000));
  send({ type: "cancel_message", session_id: "s3", message_id: "m4" });
  await new Promise((r) => setTimeout(r, 15000));
}
const terminal = events.find((e) => (e.type === "message_done" || e.type === "message_failed") && e.message_id === "m4");
console.log(`m4 终态: ${terminal ? JSON.stringify({ type: terminal.type, code: terminal.code, len: (terminal.text ?? "").length }) : "未到达"}`);
const sentCount = events.filter((e) => e.type === "message_sent" && e.message_id === "m4").length;
console.log(`message_sent 回执: ${sentCount} 次`);
console.log(`事件计数: ${JSON.stringify(events.reduce((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a; }, {}))}`);
child.kill();
process.exit(0);
