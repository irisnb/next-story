// try-start.mjs — 点「开始新制作」并观察制作对话区状态变化
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const t = list.find((x) => x.type === "page" && x.title.includes("Next Story"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener("open", r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.value; }
async function clickRect(elExpr) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) throw new Error("目标不可见"); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
const st = async () => evaluate(`(() => {
  const vis = (el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0;
  return {
    pane: vis(document.getElementById("making-conversation-pane")),
    empty: vis(document.getElementById("making-conversation-empty")),
    active: vis(document.getElementById("making-conversation-active")),
    inputVisible: vis(document.getElementById("making-conversation-input")),
    inputDisabled: document.getElementById("making-conversation-input")?.disabled ?? null,
    stopHidden: !document.getElementById("making-conversation-stop") || document.getElementById("making-conversation-stop").hidden,
    sendDisabled: document.getElementById("making-conversation-send")?.disabled ?? null,
    sessionTitle: (document.getElementById("making-session-title")?.textContent ?? "").trim(),
    msgs: document.querySelectorAll("#making-session-messages .making-msg").length,
    pending: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-status.is-pending")]; return els.length ? els[els.length - 1].textContent : null; })()
  };
})()`);
console.log("before:", JSON.stringify(await st()));
await clickRect(`document.getElementById("making-conversation-start-btn")`);
for (let i = 0; i < 12; i++) { await sleep(1000); const s = await st(); console.log(`t+${i + 1}s:`, JSON.stringify(s)); if (s.active) break; }
ws.close(); process.exit(0);
