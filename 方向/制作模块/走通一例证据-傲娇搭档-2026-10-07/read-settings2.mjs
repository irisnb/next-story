// read-settings2.mjs — 切到设置页后读取 LLM 配置（表单懒加载）
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const t = list.find((x) => x.type === "page" && x.title.includes("Next Story"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener("open", r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.value; }
async function clickRect(elExpr) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) throw new Error("目标不可见"); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
await clickRect(`document.getElementById("tab-settings")`);
await sleep(1000);
const cfg = await evaluate(`(() => ({
  baseUrl: document.getElementById("api-base-url")?.value ?? "",
  model: document.getElementById("model-name")?.value ?? "",
  keyLen: (document.getElementById("api-key")?.value ?? "").length,
  maxTokens: document.getElementById("max-tokens")?.value ?? "",
  saveStatus: (document.getElementById("llm-save-status")?.textContent ?? "").trim()
}))()`);
console.log(JSON.stringify(cfg));
if (cfg.keyLen > 0) {
  const key = await evaluate(`(document.getElementById("api-key")?.value ?? "")`);
  const fs = await import("node:fs");
  fs.writeFileSync(process.env.TEMP + "\\opencode\\llm-key.txt", key, "utf8");
  console.log("key written (len=" + key.length + ")");
}
// 切回写作页，还原现场
await clickRect(`document.getElementById("tab-writing")`);
ws.close(); process.exit(0);
