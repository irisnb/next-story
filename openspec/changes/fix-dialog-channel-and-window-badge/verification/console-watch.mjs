// 只读控制台观察器（本次真机轮临时仪器）：订阅 CDP 的 console / exception / log 事件。
// 用法：node console-watch.mjs [毫秒=8000]
const BASE = "http://127.0.0.1:9222";

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) {
  console.error("WATCH_FAIL 未找到 Next Story 页面");
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const args = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    console.log("CONSOLE", m.params.type, String(args).slice(0, 300));
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    const desc = d.exception?.description ?? d.text ?? "";
    console.log("EXCEPTION", String(desc).slice(0, 400).replace(/\n/g, " | "));
  }
  if (m.method === "Log.entryAdded") {
    console.log("LOG", m.params.entry.level, String(m.params.entry.text).slice(0, 300));
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")));
});
await send("Runtime.enable");
await send("Log.enable");
const ms = Number(process.argv[2] ?? 8000);
setTimeout(() => {
  console.log("WATCH_END");
  process.exit(0);
}, ms);
