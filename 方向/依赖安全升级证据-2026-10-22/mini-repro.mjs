// mini-repro.mjs — DSH 0.1.2-rc.1 llm 层挂起复现：逐字捕获 stderr 与协议事件时间线。
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER = "D:\\Next Story\\sidecar\\driver\\driver.mjs";
const API_BASE = process.env.REPRO_API_BASE ?? "https://open.bigmodel.cn/api/coding/paas/v4";
const MODEL = process.env.REPRO_MODEL ?? "glm-5.3";
const KEY = process.env.REPRO_KEY ?? "sk-dummy-pointcheck";
const WAIT_MS = Number(process.env.REPRO_WAIT_MS ?? 90000);

const home = join(__dirname, "repro-home");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });

const child = spawn(process.execPath, [DRIVER, "--api-base", API_BASE, "--model", MODEL], {
  cwd: dirname(DRIVER),
  env: { ...process.env, DEEPSEEK_API_KEY: KEY, DSH_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});

const t0 = Date.now();
const events = [];
const stderrLines = [];
child.stderr.on("data", (d) => {
  for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
    stderrLines.push({ t: Date.now() - t0, line });
    console.log(`[stderr +${Date.now() - t0}ms] ${line}`);
  }
});
const rl = readline.createInterface({ input: child.stdout, terminal: false });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { console.log(`[stdout-raw +${Date.now() - t0}ms] ${line}`); return; }
  events.push(msg);
  const brief = { ...msg };
  if (typeof brief.text === "string" && brief.text.length > 40) brief.text = brief.text.slice(0, 40) + `…(${brief.text.length})`;
  console.log(`[event +${Date.now() - t0}ms] ${JSON.stringify(brief)}`);
});
const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

send({ type: "start_session", session_id: "s1" });
const startedAt = Date.now();
send({ type: "send_message", session_id: "s1", message_id: "m1", text: "用一句话打个招呼。" });

await new Promise((r) => setTimeout(r, WAIT_MS));

console.log("==== 汇总 ====");
console.log(`事件类型计数: ${JSON.stringify(events.reduce((acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; }, {}))}`);
console.log(`m1 终态: ${events.some((e) => (e.type === "message_done" || e.type === "message_failed") && e.message_id === "m1") ? "已到达" : "未到达（挂起）"}`);
console.log(`stderr 行数: ${stderrLines.length}`);
child.kill();
process.exit(0);
