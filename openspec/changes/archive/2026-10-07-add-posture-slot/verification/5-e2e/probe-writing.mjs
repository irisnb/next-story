// probe-writing.mjs — 只读：写作页 AI 停靠区状态（S7 重试诊断）
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
  const wins = [...document.querySelectorAll("#ai-dock-body .ai-window")].map((w) => ({
    dq: vis(w.querySelector('[data-role="direct-question"]')),
    loading: vis(w.querySelector('[data-role="loading"]')),
    stop: vis(w.querySelector('[data-role="stop"]')),
    followUp: vis(w.querySelector('[data-role="follow-up-form"]')),
    err: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    convHead: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim().slice(0, 80),
  }));
  return {
    writingVisible: vis(document.getElementById("module-writing")),
    makingVisible: vis(document.getElementById("module-making")),
    windows: wins.length,
    dockCount: (document.querySelector("#ai-dock-count")?.textContent || "").trim(),
    newConvVisible: vis(document.getElementById("ai-new-conversation")),
    railExpand: vis(document.getElementById("ai-rail-expand")),
    railNew: vis(document.getElementById("ai-rail-new")),
    convListOpen: vis(document.getElementById("ai-conversation-list")) || !!document.querySelector("#ai-conversation-list:not(.hidden)"),
    wins,
  };
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 1));
ws.close(); process.exit(0);
