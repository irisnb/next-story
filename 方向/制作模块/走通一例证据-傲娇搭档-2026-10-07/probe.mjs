// probe.mjs — 只读探针：看当前界面状态（不点击）
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) { console.error("no target"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
await new Promise((res) => ws.addEventListener("open", res));
const r = await send("Runtime.evaluate", { expression: `(() => {
  const txt = (sel) => [...document.querySelectorAll(sel)].map(e => (e.innerText || "").trim().slice(0, 80)).filter(Boolean);
  return {
    title: document.title,
    bodyHead: (document.body.innerText || "").slice(0, 600),
    buttons: [...document.querySelectorAll("button")].map(b => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean).slice(0, 40),
    hasNewConv: !!document.querySelector("#ai-new-conversation"),
    hasDock: !!document.querySelector("#ai-dock-body"),
    dockWindows: document.querySelectorAll("#ai-dock-body .ai-window").length
  };
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 2));
ws.close(); process.exit(0);
