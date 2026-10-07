// probe-making.mjs — 只读探制作页当前状态
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const t = list.find((x) => x.type === "page" && x.title.includes("Next Story"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener("open", r));
const r = await send("Runtime.evaluate", { expression: `(() => {
  const vis = (el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0;
  const ids = ["making-conversation-active","making-conversation-empty","making-conversation-recent","making-conversation-start-btn","making-conversation-input","making-new-chain-form","making-status-active","making-status-idle"];
  const o = {};
  for (const id of ids) { const el = document.getElementById(id); o[id] = { exists: !!el, visible: el ? vis(el) : false, text: (el?.textContent || "").trim().slice(0, 60) }; }
  o.recentContinue = !!document.querySelector("#making-conversation-recent .making-recent-continue");
  o.startBtns = [...document.querySelectorAll("#module-making button")].map(b => (b.innerText || "").trim()).filter(Boolean).slice(0, 30);
  o.bodyHead = (document.getElementById("module-making")?.innerText || "").slice(0, 600);
  return o;
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 1));
ws.close(); process.exit(0);
