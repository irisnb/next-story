// open-panel.mjs — 点开 AI 面板（真实鼠标），确认新建对话按钮可见
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res) => ws.addEventListener("open", res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}
async function clickRect(elExpr, what) {
  const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) throw new Error("点击目标不存在或不可见: " + what);
  const base = { x: rect.x, y: rect.y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}
const visible = await evaluate(`(() => { const el = document.querySelector("#ai-new-conversation"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; })()`);
if (visible) { console.log("PANEL_ALREADY_OPEN"); ws.close(); process.exit(0); }
// 找「AI 面板」切换按钮
const btn = `[...document.querySelectorAll('button')].find(b => (b.innerText || b.getAttribute("aria-label") || "").trim() === "AI 面板")`;
await clickRect(btn, "AI 面板按钮");
for (let i = 0; i < 20; i++) {
  await sleep(500);
  const ok = await evaluate(`(() => { const el = document.querySelector("#ai-new-conversation"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; })()`);
  if (ok) { console.log("PANEL_OPEN"); ws.close(); process.exit(0); }
}
console.error("PANEL_OPEN_TIMEOUT");
ws.close(); process.exit(1);
