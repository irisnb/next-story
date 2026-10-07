// probe-posture-entry.mjs — 只读：姿态组添加入口显示状态诊断
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
  const byId = (id) => document.getElementById(id);
  const addPosture = byId("making-add-posture-btn");
  const addReq = byId("making-add-card-btn");
  return {
    makingVisible: vis(byId("module-making")),
    inspectorTitle: (byId("making-inspector-title")?.textContent ?? "").trim(),
    chainRows: [...document.querySelectorAll("#making-chain-list .making-chain-row")].map((b) => ({ name: b.querySelector(".making-chain-row-name")?.textContent ?? "", selected: b.classList.contains("selected") })),
    postureRows: document.querySelectorAll("#making-posture-card-list > *").length,
    postureCountText: (byId("making-posture-card-count")?.textContent ?? "").trim(),
    reqRows: document.querySelectorAll("#making-card-list > *").length,
    addPostureBtn: addPosture ? { visible: vis(addPosture), hiddenClass: addPosture.classList.contains("hidden"), text: addPosture.textContent.trim() } : null,
    addReqBtn: addReq ? { visible: vis(addReq), hiddenClass: addReq.classList.contains("hidden"), text: addReq.textContent.trim() } : null,
  };
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 1));
ws.close(); process.exit(0);
