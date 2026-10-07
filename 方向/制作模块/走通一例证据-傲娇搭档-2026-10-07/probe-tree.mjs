// probe-tree.mjs — 只读：看内容树与选中文档
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res) => ws.addEventListener("open", res));
const r = await send("Runtime.evaluate", { expression: `(() => {
  // 树：常见容器里找带 selected/active 类的项
  const cands = [...document.querySelectorAll('li, [class*="tree"], [class*="doc"], [class*="item"]')]
    .filter(e => e.children.length <= 3 && (e.innerText || "").trim().length > 0 && (e.innerText || "").trim().length < 40);
  const uniq = new Map();
  for (const e of cands) {
    const t = (e.innerText || "").trim().split("\\n")[0];
    if (!uniq.has(t)) uniq.set(t, e.className && typeof e.className === "string" ? e.className : "");
  }
  return {
    headings: [...document.querySelectorAll("h1,h2,h3")].map(h => (h.innerText || "").trim()).filter(Boolean).slice(0, 15),
    treeGuess: [...uniq.entries()].slice(0, 30),
    editorHead: (document.querySelector(".ProseMirror h1, .ProseMirror h2, [contenteditable] h1, [contenteditable] h2")?.innerText || "").trim(),
    editorWords: (document.querySelector(".ProseMirror, [contenteditable]")?.innerText || "").slice(0, 120)
  };
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 2));
ws.close(); process.exit(0);
