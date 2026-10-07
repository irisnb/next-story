// diag-click.mjs — 诊断「开始新制作」点击：遮挡检测＋控制台错误采集
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const t = list.find((x) => x.type === "page" && x.title.includes("Next Story"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let seq = 0; const pend = new Map(); const consoleErrors = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300)); } else if (m.method === "Runtime.exceptionThrown") { consoleErrors.push("exception: " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").slice(0, 300)); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.value; }

// 1. 遮挡检测：elementFromPoint
const diag = await evaluate(`(() => {
  const btn = document.getElementById("making-conversation-start-btn");
  const r = btn.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const chain = (el) => { const a = []; let e = el; while (e && a.length < 6) { a.push(e.tagName + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").filter(Boolean).slice(0, 3).join(".") : "")); e = e.parentElement; } return a; };
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, center: { cx, cy }, hitTag: hit ? hit.tagName : null, hitId: hit?.id ?? null, hitChain: hit ? chain(hit) : null, btnIsHit: btn === hit || btn.contains(hit), viewport: { w: innerWidth, h: innerHeight } };
})()`);
console.log("遮挡检测:", JSON.stringify(diag, null, 1));

// 2. 点击并观察（带控制台采集）
if (diag.btnIsHit) {
  const base = { x: Math.round(diag.center.cx), y: Math.round(diag.center.cy), button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60);
  await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50);
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
  await sleep(2500);
  const after = await evaluate(`(() => { const vis = (el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0; return { empty: vis(document.getElementById("making-conversation-empty")), active: vis(document.getElementById("making-conversation-active")), msgs: document.querySelectorAll("#making-session-messages .making-msg").length }; })()`);
  console.log("点击后:", JSON.stringify(after));
} else {
  console.log("按钮中心被遮挡，实际命中:", diag.hitChain?.join(" <- "));
}
console.log("控制台错误:", consoleErrors.length ? consoleErrors : "无");
ws.close(); process.exit(0);
