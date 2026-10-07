// probe-state.mjs — 只读：制作页当前状态（S7 重试失败诊断）
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
  const sel = byId("making-version-select");
  return {
    makingVisible: vis(byId("module-making")),
    welcome: vis(byId("welcome-page")),
    libraryOpen: byId("module-making")?.classList.contains("making-library-open") ?? false,
    mapBtnActive: byId("making-view-map-btn")?.getAttribute("aria-selected") ?? byId("making-view-map-btn")?.className ?? "",
    chatPaneVisible: vis(byId("making-conversation-pane")),
    inspectorVisible: vis(byId("making-inspector")),
    inspectorTitle: (byId("making-inspector-title")?.textContent ?? "").trim(),
    inspectorState: (byId("making-inspector-state")?.textContent ?? "").trim(),
    chainRows: [...document.querySelectorAll("#making-chain-list .making-chain-row")].map((b) => ({ name: b.querySelector(".making-chain-row-name")?.textContent ?? "", selected: b.classList.contains("selected") })),
    versionSelectExists: !!sel,
    versionSelectVisible: vis(sel),
    versionOptions: sel ? [...sel.options].map((o) => o.textContent.trim()) : [],
    versionValue: sel ? sel.selectedOptions[0]?.textContent.trim() : null,
    enableBtnExists: !!byId("making-enable-btn"),
    enableBtnVisible: vis(byId("making-enable-btn")),
    enableBtnText: (byId("making-enable-btn")?.textContent ?? "").trim(),
    statusActive: vis(byId("making-status-active")),
    statusText: (byId("making-status-text")?.textContent ?? "").trim(),
    statusIdleText: (byId("making-status-idle")?.textContent ?? "").trim()
  };
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 1));
ws.close(); process.exit(0);
