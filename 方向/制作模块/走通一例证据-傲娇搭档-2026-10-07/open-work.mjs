// open-work.mjs — 从最近列表打开测试作品（真实鼠标点击），然后等编辑器就绪
const BASE = "http://127.0.0.1:9222";
const PATH_MARK = "统一真机验收-20260926";
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

// 若已在编辑器内（正文编辑区存在），直接报告
const already = await evaluate(`!!document.querySelector(".ProseMirror, [contenteditable='true']")`);
if (already) { console.log("ALREADY_IN_EDITOR"); ws.close(); process.exit(0); }

const btn = `[...document.querySelectorAll('button')].find(b => (b.innerText || "").includes(${JSON.stringify(PATH_MARK)}))`;
await clickRect(btn, "最近列表·测试作品");

// 等编辑器出现（最多 60s）
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const st = await evaluate(`(() => ({
    editor: !!document.querySelector(".ProseMirror, [contenteditable='true']"),
    docTree: [...document.querySelectorAll('[data-role="doc-tree-item"], .doc-tree-item, [data-role="content-tree"] li')].map(e => (e.innerText || "").trim().slice(0, 40)).filter(Boolean).slice(0, 10)
  }))()`);
  if (st.editor) { console.log("WORK_OPEN"); console.log(JSON.stringify(st.docTree)); ws.close(); process.exit(0); }
}
console.error("WORK_OPEN_TIMEOUT");
ws.close(); process.exit(1);
