// Capture console messages while triggering an action via existing driver semantics.
// Usage: node console-probe.mjs <seconds> <evalExpression?>
import { spawn } from "node:child_process";

const BASE = "http://127.0.0.1:9222";
const seconds = Number(process.argv[2] ?? 6);
const expr = process.argv[3] ?? "";

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const events = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method) {
    events.push({
      m: msg.method,
      text: msg.params?.text ?? msg.params?.args?.map((a) => a.value ?? a.description).join(" ") ?? "",
      level: msg.params?.level ?? "",
    });
  }
});
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws fail"))); });

await send("Runtime.enable");
await send("Log.enable");
if (expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }).catch((e) => ({ err: String(e) }));
  console.log("EVAL_RESULT:", JSON.stringify(r.result?.value ?? r.err ?? r).slice(0, 300));
}
const until = Date.now() + seconds * 1000;
while (Date.now() < until) await new Promise((r) => setTimeout(r, 300));
console.log("EVENTS_BEGIN");
for (const e of events) console.log(`${e.level || e.m} :: ${String(e.text).slice(0, 400)}`);
console.log("EVENTS_END");
ws.close();
process.exit(0);
