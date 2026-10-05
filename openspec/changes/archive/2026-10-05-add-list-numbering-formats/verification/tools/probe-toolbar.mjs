// 测量工具栏「有序列表」行的布局（标签截断回归取证）
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\编号-20261005";
const targets = await (await fetch(`${BASE}/json/list`)).json();
console.log("targets:", JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url, title: t.title }))));
const page = targets.find(
  (t) =>
    t.type === "page" &&
    !t.url.includes("devtools") &&
    !t.url.includes("print") &&
    (t.url.startsWith("http://localhost:1420") || t.url.startsWith("http://tauri.localhost")),
);
if (!page) {
  console.log("NO-PAGE");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
function cdp(method, params = {}, timeoutMs = 30000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(timer);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression, timeoutMs = 30000) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
const info = await ev(`(() => {
  const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { sel, text: (e.textContent || '').trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      clientW: e.clientWidth, scrollW: e.scrollWidth, overflow: cs.overflow, whiteSpace: cs.whiteSpace, minWidth: cs.minWidth, maxWidth: cs.maxWidth }; };
  return { viewport: { w: window.innerWidth, h: window.innerHeight },
    toolbar: pick('#format-toolbar'), row: pick('.ol-style-row'), orderedBtn: pick('#btn-ordered-list'), trigger: pick('#btn-ordered-list-style'),
    bulletBtn: pick('#btn-bullet-list'), undoBtn: pick('#btn-undo') };
})()`);
console.log(JSON.stringify(info, null, 2));
const clip = { x: 0, y: Math.max(0, (info.row?.y ?? 120) - 40), width: 320, height: 160, scale: 2 };
const shot = await cdp("Page.captureScreenshot", { format: "png", clip });
writeFileSync(`${OUT}\\acc-05-toolbar-probe.png`, Buffer.from(shot.data, "base64"));
console.log("shot: acc-05-toolbar-probe.png");
ws.close();
process.exit(0);
